import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DEFAULT_PARAMETERS, type LampParameters } from './lamp'
import { buildExpandedGeometry } from './preview-geometry'
import { buildPatternLightMap, buildPatternLightMaps, createOpticalCaster, patternLightingKey, transmissionBefore } from './pattern-lighting'
import { deriveLighting } from './lighting'

const pattern: LampParameters = {
  ...DEFAULT_PARAMETERS, shape: 'circle', pleats: 4, height: 80,
  cutoutPattern: 'triangles', cutoutCount: 4, cutoutDepth: 75, cutoutLayers: 1, tpuLayers: 4,
}

/** Aim through a particular nominal print point after expansion. This checks
 * the geometry's sheet ownership as well as the thickness used by the caster. */
function rayThroughPrintPoint(geometry: THREE.BufferGeometry, sheet: number, u: number, inset: number) {
  const positions = geometry.getAttribute('position')
  const coordinates = geometry.getAttribute('cutoutCoord')
  const indices = geometry.getIndex()!
  const target = new THREE.Vector3(u, inset, sheet)
  for (let i = 0; i < indices.count; i += 3) {
    const ids = [0, 1, 2].map(corner => indices.getX(i + corner))
    if (ids.some(id => coordinates.getZ(id) !== sheet)) continue
    const nominal = new THREE.Triangle(...ids.map(id => new THREE.Vector3().fromBufferAttribute(coordinates, id)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3])
    const barycentric = nominal.getBarycoord(target, new THREE.Vector3())
    if (!barycentric || Math.min(barycentric.x, barycentric.y, barycentric.z) < -1e-7) continue
    const world = new THREE.Triangle(...ids.map(id => new THREE.Vector3().fromBufferAttribute(positions, id)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3])
    const point = world.a.clone().multiplyScalar(barycentric.x).addScaledVector(world.b, barycentric.y).addScaledVector(world.c, barycentric.z)
    const direction = world.getNormal(new THREE.Vector3())
    return { origin: point.addScaledVector(direction, -0.0001), direction }
  }
  throw new Error(`No rendered sheet ${sheet} at print point ${u}, ${inset}`)
}

describe('patterned light transport', () => {
  it.each(['triangles', 'half-circles', 'rectangles'] as const)('keeps %s thin only toward the outside on both folded sheet faces', cutoutPattern => {
    const p = { ...pattern, cutoutPattern }
    const geometry = buildExpandedGeometry(p)
    const caster = createOpticalCaster(p, geometry)
    const thicknessAt = (sheet: number, inset: number) => {
      const ray = rayThroughPrintPoint(geometry, sheet, 0.126, inset)
      return caster.trace(ray.origin, ray.direction)[0]?.thickness
    }
    try {
      for (let sheet = 1; sheet < p.pleats * 2 - 1; sheet++) {
        expect(thicknessAt(sheet, 0.1)).toBe(0.2)
        expect(thicknessAt(sheet, 0.9)).toBe(0.8)
        // Each shared band is drawn once: odd sheets own the inner creases,
        // even sheets own the outside creases. Neither may invert the mask.
        if (sheet < p.pleats * 2 - 2) {
          expect(thicknessAt(sheet, sheet % 2 ? 0.98 : 0.02)).toBe(sheet % 2 ? 0.8 : 0.2)
        }
      }
      expect(thicknessAt(-1, 0.02)).toBe(0.8)
    } finally { caster.dispose(); geometry.dispose() }
  })

  it('attenuates the unpatterned baseline and never makes a thin recess transmit less than full TPU', () => {
    const plain: LampParameters = { ...pattern, cutoutPattern: 'none', lightSource: 'bulb', bulbDiameter: 20 }
    const none = createOpticalCaster(plain)
    const rectangles = createOpticalCaster({ ...plain, cutoutPattern: 'rectangles' })
    try {
      const origin = new THREE.Vector3(0, 0.035, 0)
      for (let i = 0; i < 36; i++) {
        const angle = i / 36 * Math.PI * 2
        const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle))
        const full = transmissionBefore(none.trace(origin, direction), 1)
        const patterned = transmissionBefore(rectangles.trace(origin, direction), 1)
        expect(full).toBeLessThan(1)
        expect(patterned).toBeGreaterThanOrEqual(full - 1e-8)
      }
      const map = buildPatternLightMap(plain, deriveLighting(plain).sources[0], false, 32, 16, none)
      const data = map.texture.image.data as Uint16Array
      expect(Array.from(data).filter((_, i) => i % 2 === 1).some(value => THREE.DataUtils.fromHalfFloat(value) < 0.9)).toBe(true)
      map.texture.dispose()
    } finally { none.dispose(); rectangles.dispose() }
  })

  it('transmits more through an actual thin recess, while retaining TPU attenuation', () => {
    const caster = createOpticalCaster(pattern)
    try {
      const origin = new THREE.Vector3(0, 0.035, 0)
      const recess = caster.trace(origin, new THREE.Vector3(Math.SQRT1_2, 0, Math.SQRT1_2))
      const web = caster.trace(origin, new THREE.Vector3(1, 0, 0))
      expect(recess.length).toBeGreaterThan(0)
      expect(recess.some(hit => hit.thickness === 0.2)).toBe(true)
      expect(web.every(hit => hit.thickness === 0.8)).toBe(true)
      expect(transmissionBefore(recess, 1)).toBeGreaterThan(transmissionBefore(web, 1))
      expect(transmissionBefore(recess, 1)).toBeLessThan(1)
      expect(transmissionBefore(recess, 0.01)).toBe(1)
    } finally { caster.dispose() }
  })

  it('traces a different cast pattern when the physical recess shape changes', () => {
    const triangle = createOpticalCaster(pattern)
    const rectangle = createOpticalCaster({ ...pattern, cutoutPattern: 'rectangles' })
    try {
      const origin = new THREE.Vector3(0, 0.035, 0)
      const angle = 0.16 * Math.PI * 2
      const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle))
      expect(transmissionBefore(rectangle.trace(origin, direction), 1))
        .toBeGreaterThan(transmissionBefore(triangle.trace(origin, direction), 1))
    } finally { triangle.dispose(); rectangle.dispose() }
  })

  it('attenuates oblique rays more strongly and compounds intervening membranes', () => {
    const geometry = buildExpandedGeometry(pattern)
    const positions = geometry.getAttribute('position')
    const indices = geometry.getIndex()!
    // First active triangle follows the 96×2 terminal flange triangles.
    const triangle = new THREE.Triangle(...[0, 1, 2].map(corner => new THREE.Vector3().fromBufferAttribute(positions, indices.getX(96 * 6 + corner))) as [THREE.Vector3, THREE.Vector3, THREE.Vector3])
    const point = triangle.getMidpoint(new THREE.Vector3())
    const normal = triangle.getNormal(new THREE.Vector3())
    const tangent = triangle.b.clone().sub(triangle.a).normalize()
    const oblique = normal.clone().multiplyScalar(0.3).addScaledVector(tangent, Math.sqrt(1 - 0.3 ** 2))
    const caster = createOpticalCaster(pattern, geometry)
    try {
      const perpendicularHits = caster.trace(point.clone().addScaledVector(normal, -0.0001), normal)
      const obliqueHits = caster.trace(point.clone().addScaledVector(oblique, -0.0001), oblique)
      expect(perpendicularHits[0].thickness).toBe(obliqueHits[0].thickness)
      expect(obliqueHits[0].transmission).toBeLessThan(perpendicularHits[0].transmission)
      const crossings = [{ distance: 0.1, transmission: 0.7, thickness: 0.2 }, { distance: 0.2, transmission: 0.5, thickness: 0.4 }]
      expect(transmissionBefore(crossings, 0.05)).toBe(1)
      expect(transmissionBefore(crossings, 0.15)).toBe(0.7)
      expect(transmissionBefore(crossings, 0.25)).toBeCloseTo(0.35)
    } finally { caster.dispose(); geometry.dispose() }
  })

  it('uses full terminal membranes and follows changed source positions', () => {
    const caster = createOpticalCaster(pattern)
    try {
      const upwards = caster.trace(new THREE.Vector3(0.075, 0.07, 0), new THREE.Vector3(0, 1, 0))
      expect(upwards.at(-1)?.thickness).toBe(0.8)
      const direction = new THREE.Vector3(Math.SQRT1_2, 0, Math.SQRT1_2)
      expect(caster.trace(new THREE.Vector3(0, 0.025, 0), direction))
        .not.toEqual(caster.trace(new THREE.Vector3(0, 0.035, 0), direction))
    } finally { caster.dispose() }
  })

  it('keeps optical maps cached while power, flicker, colour, wood and scene rotation change', () => {
    const unchangedGeometry = { ...pattern, lightIntensity: 50, lightFlicker: 80, lightTemperature: 5000, ceilingLightIntensity: 0, frameWood: 'walnut' as const, rotation: 45 }
    expect(patternLightingKey(unchangedGeometry)).toBe(patternLightingKey(pattern))
    expect(patternLightingKey({ ...pattern, bulbHeight: 80, lightSource: 'bulb' })).not.toBe(patternLightingKey(pattern))
    expect(patternLightingKey({ ...pattern, cutoutDepth: 30 })).not.toBe(patternLightingKey(pattern))
  })

  it('does not crash the viewer on an invalid intermediate mesh', () => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([NaN, 0, 0, 0, 0, 0, 1, 0, 0], 3))
    expect(buildPatternLightMaps(pattern, geometry)).toEqual([])
    geometry.dispose()
  })
})
