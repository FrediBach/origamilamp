import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DEFAULT_PARAMETERS, type LampParameters } from './lamp'
import { buildExpandedGeometry } from './preview-geometry'
import { buildPatternLightMap, buildPatternLightMaps, createOpticalCaster, patternLightingKey, transmissionBefore } from './pattern-lighting'
import { deriveLighting } from './lighting'
import { applyPatternTransmission } from './shade-material'
import { cutoutProfile } from './cutout-patterns'

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
        // A collapsed joining band represents both membranes plus their
        // retained TPU connector, with full inner and patterned outer rims.
        if (sheet < p.pleats * 2 - 2) {
          expect(thicknessAt(sheet, sheet % 2 ? 0.98 : 0.02)).toBeCloseTo((sheet % 2 ? 1.6 : 0.4) + p.separatorLayers * p.layerHeight)
        }
      }
      expect(thicknessAt(0, 0.02)).toBeCloseTo(1 + p.separatorLayers * p.layerHeight)
      expect(thicknessAt(0, 0.1)).toBe(0.8)
    } finally { caster.dispose(); geometry.dispose() }
  })

  it.each([1, 2, 3, 4, 5])('thins only every %ith active membrane and sums both sides of shared creases', cutoutEvery => {
    const p = { ...pattern, cutoutEvery }
    const geometry = buildExpandedGeometry(p)
    const caster = createOpticalCaster(p, geometry)
    const thicknessAt = (sheet: number, inset: number) => {
      const ray = rayThroughPrintPoint(geometry, sheet, 0.126, inset)
      return caster.trace(ray.origin, ray.direction)[0]?.thickness
    }
    const sheetThickness = (sheet: number) => sheet > 0 && sheet < p.pleats * 2 - 1 && (sheet - 1) % cutoutEvery === 0 ? 0.2 : 0.8
    const separator = p.separatorLayers * p.layerHeight
    try {
      for (let sheet = 1; sheet < p.pleats * 2 - 1; sheet++) {
        expect(thicknessAt(sheet, 0.1)).toBe(sheetThickness(sheet))
        if (sheet < p.pleats * 2 - 2) {
          expect(thicknessAt(sheet, sheet % 2 ? 0.98 : 0.02)).toBeCloseTo(sheet % 2
            ? 1.6 + separator : sheetThickness(sheet) + sheetThickness(sheet + 1) + separator)
        }
      }
      for (const terminal of [0, p.pleats * 2 - 1]) {
        expect(thicknessAt(terminal, 0.1)).toBe(0.8)
        const neighbour = terminal === 0 ? 1 : terminal - 1
        expect(thicknessAt(terminal, 0.02)).toBeCloseTo(0.8 + sheetThickness(neighbour) + separator)
      }
    } finally { caster.dispose(); geometry.dispose() }
  })

  it.each(['triangles', 'half-circles', 'rectangles'] as const)('changes %s optical coverage with spacing while retaining center depth', cutoutPattern => {
    const narrowGaps = { ...pattern, cutoutPattern, cutoutSpacing: 10 }
    const wideGaps = { ...narrowGaps, cutoutSpacing: 80 }
    const geometry = buildExpandedGeometry(narrowGaps)
    const narrow = createOpticalCaster(narrowGaps, geometry)
    const wide = createOpticalCaster(wideGaps, geometry)
    try {
      const shoulder = rayThroughPrintPoint(geometry, 1, 0.17, 0.1)
      expect(narrow.trace(shoulder.origin, shoulder.direction)[0].thickness).toBe(0.2)
      expect(wide.trace(shoulder.origin, shoulder.direction)[0].thickness).toBe(0.8)
      const center = rayThroughPrintPoint(geometry, 1, 0.125, 0.5)
      expect(narrow.trace(center.origin, center.direction)[0].thickness).toBe(0.2)
      expect(wide.trace(center.origin, center.direction)[0].thickness).toBe(0.2)
    } finally { narrow.dispose(); wide.dispose(); geometry.dispose() }
  })

  it.each([-100, -50, -25, 25, 50, 100])('moves optical recesses by %i%% of a repeat per physical membrane, including skipped sheets and wrapping', cutoutPhase => {
    const p = { ...pattern, cutoutPhase, cutoutSpacing: 60 }
    const geometry = buildExpandedGeometry(p)
    const wrap = (value: number) => ((value % 1) + 1) % 1
    try {
      for (const cutoutEvery of [1, 2, 3]) {
        const caster = createOpticalCaster({ ...p, cutoutEvery }, geometry)
        try {
          for (let sheet = 1; sheet < p.pleats * 2 - 1; sheet++) {
            const center = wrap((0.5 + (sheet - 1) * cutoutPhase / 100) / p.cutoutCount)
            const centerRay = rayThroughPrintPoint(geometry, sheet, center, 0.1)
            const gapRay = rayThroughPrintPoint(geometry, sheet, wrap(center + 0.5 / p.cutoutCount), 0.1)
            expect(caster.trace(centerRay.origin, centerRay.direction)[0].thickness).toBe((sheet - 1) % cutoutEvery === 0 ? 0.2 : 0.8)
            expect(caster.trace(gapRay.origin, gapRay.direction)[0].thickness).toBe(0.8)
          }
        } finally { caster.dispose() }
      }
    } finally { geometry.dispose() }
  })

  it('evaluates each neighbouring membrane at its own phase in a shared outer crease', () => {
    const p = { ...pattern, cutoutPhase: 50, cutoutSpacing: 60 }
    const geometry = buildExpandedGeometry(p)
    const caster = createOpticalCaster(p, geometry)
    const skipped = createOpticalCaster({ ...p, cutoutEvery: 2 }, geometry)
    const thicknessAt = (source: ReturnType<typeof createOpticalCaster>, u: number) => {
      const ray = rayThroughPrintPoint(geometry, 2, u, 0.02)
      return source.trace(ray.origin, ray.direction)[0].thickness
    }
    const separator = p.separatorLayers * p.layerHeight
    try {
      // Sheet 2 is half a repeat ahead of sheet 1; sheet 3 is a full repeat
      // ahead. Their disjoint recesses must each contribute their own depth.
      expect(thicknessAt(caster, 0.25)).toBeCloseTo(0.2 + 0.8 + separator)
      expect(thicknessAt(caster, 0.375)).toBeCloseTo(0.8 + 0.2 + separator)
      expect(thicknessAt(caster, 0.3125)).toBeCloseTo(1.6 + separator)
      expect(thicknessAt(skipped, 0.25)).toBeCloseTo(1.6 + separator)
      expect(thicknessAt(skipped, 0.375)).toBeCloseTo(0.8 + 0.2 + separator)
    } finally { skipped.dispose(); caster.dispose(); geometry.dispose() }
  })

  it.each([10, 80])('rounds the inside rectangle corners in optical transmission at %i%% spacing', cutoutSpacing => {
    const p: LampParameters = { ...pattern, cutoutPattern: 'rectangles', cutoutCount: 16, cutoutSpacing, cutoutPhase: 25 }
    const profile = cutoutProfile(p)
    const geometry = buildExpandedGeometry(p)
    const caster = createOpticalCaster(p, geometry)
    const sheet = 2
    const center = (0.5 + p.cutoutPhase / 100) / p.cutoutCount
    const r = profile.rectangleCornerMm
    const x = profile.rectangleSideHalfWidthMm - r + r * Math.SQRT1_2
    const cornerDepth = profile.depthMm - r + r * Math.SQRT1_2
    const thicknessAt = (u: number, depth: number) => {
      const ray = rayThroughPrintPoint(geometry, sheet, u, depth / p.bandWidth)
      return caster.trace(ray.origin, ray.direction)[0].thickness
    }
    try {
      // The centre keeps its flat inner edge. On either side the quarter-circle
      // corner retains full TPU where a square rectangle would still be thin.
      expect(thicknessAt(center, profile.depthMm - 0.1)).toBe(0.2)
      for (const side of [-1, 1]) {
        const u = center + side * x / profile.outerPerimeterMm
        expect(thicknessAt(u, cornerDepth - 0.1)).toBe(0.2)
        expect(thicknessAt(u, (cornerDepth + profile.depthMm) / 2)).toBe(0.8)
        expect(thicknessAt(u, 0.1 * p.bandWidth)).toBe(0.2)
      }
    } finally { caster.dispose(); geometry.dispose() }
  })

  it('uses the same spacing, cadence, phase, rounded corners and joint thickness in the visible material', () => {
    const p = { ...pattern, cutoutSpacing: 60, cutoutEvery: 3, cutoutPhase: -25 }
    const profile = cutoutProfile(p)
    const shader = {
      uniforms: {}, vertexShader: '#include <begin_vertex>',
      fragmentShader: '#include <lights_fragment_begin>\n#include <emissivemap_fragment>',
    } as THREE.WebGLProgramParametersWithUniforms
    const glow = new THREE.Texture()
    applyPatternTransmission(shader, p, glow)
    expect(shader.uniforms.cutoutProfile.value).toEqual([0.2, 3, 0.8, 0.2])
    expect(shader.uniforms.cutoutJoining.value).toEqual([p.separatorLayers * p.layerHeight, p.outerConnector / p.bandWidth])
    expect(shader.uniforms.cutoutPlacement.value).toEqual([-0.25, profile.mouthMm / 2, profile.rectangleSideHalfWidthMm, profile.rectangleCornerMm])
    expect(shader.vertexShader).toContain('vCutoutJoin = cutoutJoin;')
    expect(shader.fragmentShader).toContain('mod(floor(sheet + 0.5) - 1.0, cutoutProfile.y)')
    expect(shader.fragmentShader).toContain('cutoutMask(vCutoutJoin)')
    expect(shader.fragmentShader).toContain('(floor(sheet + 0.5) - 1.0) * cutoutPlacement.x')
    expect(shader.fragmentShader).toContain('fract(vCutoutCoord.x * cutoutSettings.x - phase)')
    expect(shader.fragmentShader).toContain('sqrt(max(0.0, cutoutPlacement.w * cutoutPlacement.w - offset * offset))')
    expect(shader.fragmentShader).toContain('neighbourThickness + cutoutJoining.x')
    const plain = { uniforms: {}, vertexShader: '', fragmentShader: '#include <emissivemap_fragment>' } as THREE.WebGLProgramParametersWithUniforms
    applyPatternTransmission(plain, { ...p, cutoutPattern: 'none' }, glow)
    expect(plain.uniforms.cutoutShape.value).toBe(-1)
    expect(plain.fragmentShader).toContain('neighbourThickness + cutoutJoining.x')
    glow.dispose()
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
    expect(patternLightingKey({ ...pattern, cutoutSpacing: 60 })).not.toBe(patternLightingKey(pattern))
    expect(patternLightingKey({ ...pattern, cutoutEvery: 3 })).not.toBe(patternLightingKey(pattern))
    expect(patternLightingKey({ ...pattern, cutoutPhase: 25 })).not.toBe(patternLightingKey(pattern))
  })

  it('does not crash the viewer on an invalid intermediate mesh', () => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([NaN, 0, 0, 0, 0, 0, 1, 0, 0], 3))
    expect(buildPatternLightMaps(pattern, geometry)).toEqual([])
    geometry.dispose()
  })
})
