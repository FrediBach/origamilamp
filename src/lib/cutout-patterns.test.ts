import { describe, expect, it } from 'vitest'
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3, type BufferGeometry } from 'three'
import { DEFAULT_PARAMETERS, deriveLamp, manufacturingErrors, type LampParameters } from './lamp'
import { buildManufacturingGeometry } from './manufacturing'
import { buildCutoutLayout, cutoutAt, cutoutContourPoint, cutoutDepthAt, cutoutPolygons, cutoutProfile, cutoutMinimumWeb, cutoutRecessFace, cutoutLayerRange } from './cutout-patterns'

function audit(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position'), index = geometry.getIndex()!
  const parents = Array.from({ length: position.count }, (_, i) => i)
  const root = (n: number): number => { while (parents[n] !== n) { parents[n] = parents[parents[n]]; n = parents[n] } return n }
  const edges = new Map<string, { count: number; orientation: number }>()
  const triangles = new Set<string>()
  let volume = 0, minArea = Infinity
  for (let i = 0; i < index.count; i += 3) {
    const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
    const [a, b, c] = ids.map(id => new Vector3().fromBufferAttribute(position, id))
    volume += a.dot(b.clone().cross(c)) / 6
    minArea = Math.min(minArea, b.clone().sub(a).cross(c.clone().sub(a)).length())
    triangles.add([...ids].sort((x, y) => x - y).join('/'))
    for (let side = 0; side < 3; side++) {
      const a = ids[side], b = ids[(side + 1) % 3]
      parents[root(a)] = root(b)
      const key = a < b ? `${a}/${b}` : `${b}/${a}`
      const edge = edges.get(key) ?? { count: 0, orientation: 0 }
      edge.count++; edge.orientation += a < b ? 1 : -1
      edges.set(key, edge)
    }
  }
  return {
    volume, minArea, components: new Set(parents.map((_, i) => root(i))).size,
    badEdges: [...edges.values()].filter(edge => edge.count !== 2 || edge.orientation !== 0).length,
    duplicateFaces: index.count / 3 - triangles.size,
    euler: position.count - edges.size + index.count / 3,
  }
}

const patterns = ['triangles', 'half-circles', 'rectangles'] as const

describe('outside-open thinner TPU patterns', () => {
  it.each(patterns)('changes the outside gap without moving pattern centres or depth: %s', cutoutPattern => {
    const p = { ...DEFAULT_PARAMETERS, shape: 'circle' as const, pleats: 4, cutoutPattern }
    const profiles = [5, 30, 80].map(cutoutSpacing => cutoutProfile({ ...p, cutoutSpacing }))
    expect(profiles[1].mouthFraction).toBeCloseTo(0.7)
    for (const cutoutSpacing of [5, 30, 80]) {
      const changed = { ...p, cutoutSpacing }
      const profile = cutoutProfile(changed)
      expect(profile.gapFraction).toBeCloseTo(cutoutSpacing / 100)
      expect(profile.outerPerimeterMm).toBeCloseTo(Math.PI * p.width)
      expect(profile.gapMm + profile.mouthMm).toBeCloseTo(Math.PI * p.width / p.cutoutCount)
      expect(cutoutPolygons(changed, 1)).toHaveLength(p.cutoutCount)
      for (let slot = 0; slot < p.cutoutCount; slot++) {
        const center = (slot + 0.5) / p.cutoutCount
        expect(cutoutDepthAt(changed, center)).toBeCloseTo(profile.depthMm)
        expect(cutoutDepthAt(changed, center + profile.halfWidth * 0.99)).toBeGreaterThan(0)
        expect(cutoutDepthAt(changed, center + profile.halfWidth * 1.01)).toBe(0)
      }
    }
    expect(profiles[0].mouthMm).toBeGreaterThan(profiles[1].mouthMm)
    expect(profiles[2].gapMm).toBeGreaterThan(profiles[1].gapMm)
    expect(cutoutMinimumWeb({ ...p, cutoutSpacing: 80 })).toBeGreaterThan(cutoutMinimumWeb({ ...p, cutoutSpacing: 5 }))
  })

  it('bounds spacing and intervals and reports the rounded-rectangle outside perimeter', () => {
    const p = { ...DEFAULT_PARAMETERS, shape: 'rounded-rectangle' as const }
    expect(cutoutProfile({ ...p, cutoutSpacing: 0, cutoutEvery: 0 })).toMatchObject({ gapFraction: .05, every: 1 })
    expect(cutoutProfile({ ...p, cutoutSpacing: 100, cutoutEvery: 30 })).toMatchObject({ gapFraction: .8, every: 24 })
    expect(cutoutProfile({ ...p, cutoutSpacing: NaN, cutoutEvery: NaN })).toMatchObject({ gapFraction: .3, every: 1 })
    expect(cutoutProfile(p).outerPerimeterMm).toBeCloseTo(2 * (p.width + p.depth - 4 * p.cornerRadius) + 2 * Math.PI * p.cornerRadius)
  })

  it.each([1, 2, 3, 24])('patterns every %ith active membrane while preserving physical release faces and solid ends', cutoutEvery => {
    for (const pleats of [1, 2, 4]) {
      const p = { ...DEFAULT_PARAMETERS, pleats, cutoutEvery, cutoutPattern: 'triangles' as const }
      const center = 0.5 / p.cutoutCount
      for (let sheet = 0; sheet < pleats * 2; sheet++) {
        const selected = sheet > 0 && sheet < pleats * 2 - 1 && (sheet - 1) % cutoutEvery === 0
        expect(cutoutRecessFace(p, sheet)).toBe(selected ? sheet % 2 === 1 ? 'top' : 'bottom' : null)
        expect(cutoutAt(p, sheet, center, 0)).toBe(selected)
        expect(cutoutPolygons(p, sheet)).toHaveLength(selected ? p.cutoutCount : 0)
        if (!selected) expect(cutoutLayerRange(p, sheet)).toBeNull()
      }
    }
  })

  it.each(patterns)('keeps every recess open to the outside with untouched inner rims and terminal sheets: %s', cutoutPattern => {
    const p = { ...DEFAULT_PARAMETERS, pleats: 4, cutoutPattern }
    const { count, depthMm, remainingThickness, normalThickness, webMm } = cutoutProfile(p)
    expect(remainingThickness).toBeGreaterThan(0)
    expect(remainingThickness).toBeLessThan(normalThickness)
    expect(depthMm).toBeLessThanOrEqual(p.bandWidth - Math.max(p.innerConnector, p.outerConnector) - webMm)
    for (let slot = 0; slot < count; slot++) {
      const center = (slot + 0.5) / count
      expect(cutoutDepthAt(p, center)).toBeCloseTo(depthMm, 6)
      expect(cutoutDepthAt(p, slot / count)).toBe(0)
      for (let sheet = 1; sheet < 7; sheet++) for (const offset of [-0.3, -0.15, 0, 0.15, 0.3]) {
        const u = center + offset / count
        let hadPocket = false
        for (let step = 100; step >= 0; step--) {
          const radial = step / 100
          const pocket = cutoutAt(p, sheet, u, radial)
          // Walk toward the outside on EVERY sheet, including even sheets.
          // Once in PLA, no TPU can block its outward release path.
          if (hadPocket) expect(pocket).toBe(true)
          hadPocket ||= pocket
        }
        expect(hadPocket).toBe(true)
        expect(cutoutAt(p, sheet, u, 0)).toBe(true)
        expect(cutoutAt(p, sheet, u, 1 - p.innerConnector / (2 * p.bandWidth))).toBe(false)
      }
      expect(cutoutAt(p, 0, center, 0.1)).toBe(false)
      expect(cutoutAt(p, 7, center, 0.1)).toBe(false)
    }
  })

  it.each([1, 2, 3])('puts recess layers against only the outward-open separator with %i residual layers', cutoutLayers => {
    const p = { ...DEFAULT_PARAMETERS, pleats: 4, cutoutPattern: 'triangles' as const, tpuLayers: 4, cutoutLayers }
    for (let sheet = 0; sheet < 8; sheet++) {
      if (sheet === 0 || sheet === 7) {
        expect(cutoutRecessFace(p, sheet)).toBeNull()
        expect(cutoutLayerRange(p, sheet)).toBeNull()
        continue
      }
      const odd = sheet % 2 === 1
      expect(cutoutRecessFace(p, sheet)).toBe(odd ? 'top' : 'bottom')
      expect(cutoutLayerRange(p, sheet)).toEqual(odd ? [cutoutLayers, 4] : [0, 4 - cutoutLayers])
      // The adjacent gap must have an INNER join and an open outside rim.
      const separator = odd ? sheet : sheet - 1
      expect(separator % 2).toBe(1)
    }
    expect(cutoutRecessFace({ ...p, cutoutPattern: 'none' }, 1)).toBeNull()
    expect(cutoutLayerRange({ ...p, cutoutLayers: 4 }, 2)).toBeNull()
  })

  it.each(patterns.flatMap(cutoutPattern => [
    { cutoutPattern, shape: 'circle' as const, pleats: 4, cutoutDepth: 75 },
    { cutoutPattern, shape: 'rounded-rectangle' as const, pleats: 4, cutoutDepth: 55 },
    { cutoutPattern, shape: 'rounded-rectangle' as const, pleats: 2, bandWidth: 5.4, cornerRadius: 6, height: 100, cutoutCount: 32, cutoutDepth: 10, tpuLayers: 4, cutoutLayers: 3 },
    { cutoutPattern, shape: 'circle' as const, pleats: 4, cutoutSpacing: 5, cutoutEvery: 2 },
    { cutoutPattern, shape: 'rounded-rectangle' as const, pleats: 4, cutoutSpacing: 80, cutoutEvery: 3, cutoutCount: 7 },
    { cutoutPattern, shape: 'circle' as const, pleats: 2, cutoutSpacing: 80, cutoutEvery: 24, cutoutCount: 4 },
  ]))('prints complementary manifold solids with all separator tongues attached: %j', change => {
    const p: LampParameters = { ...DEFAULT_PARAMETERS, ...change }
    const geometry = buildManufacturingGeometry(p)
    const solid = buildManufacturingGeometry({ ...p, cutoutPattern: 'none' })
    const tpu = audit(geometry.tpu), pla = audit(geometry.pla)
    for (const result of [tpu, pla]) {
      expect(result.badEdges).toBe(0)
      expect(result.duplicateFaces).toBe(0)
      expect(result.minArea).toBeGreaterThan(1e-9)
      expect(result.volume).toBeGreaterThan(0)
      expect(result.euler).toBe(0)
    }
    expect(tpu.components).toBe(1)
    expect(pla.components).toBe(deriveLamp(p).separators)
    expect(tpu.volume).toBeLessThan(audit(solid.tpu).volume)
    expect(pla.volume).toBeGreaterThan(audit(solid.pla).volume)
    // The two materials still fill exactly one annular compressed stack.
    const layout = buildCutoutLayout(p)
    const areas = layout.faces.map(face => {
      const [a, b, c] = face.vertices.map(id => layout.points[id])
      return ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2
    })
    const area = areas.reduce((sum, value) => sum + value, 0)
    expect((tpu.volume + pla.volume) / (area * deriveLamp(p).compressedHeight)).toBeCloseTo(1, 6)
    const outsideJoinArea = areas.reduce((sum, value, face) => sum + (layout.faces[face].band === 0 ? value : 0), 0)
    const insideJoinArea = areas.reduce((sum, value, face) => sum + (layout.faces[face].band === 2 ? value : 0), 0)
    const recessArea = areas.reduce((sum, value, face) => sum + (layout.faces[face].outerCutout ? value : 0), 0)
    const expectedTpu = area * deriveLamp(p).sheets * p.tpuLayers * p.layerHeight
      + (outsideJoinArea * p.pleats + insideJoinArea * (p.pleats - 1)) * p.separatorLayers * p.layerHeight
      - recessArea * Math.ceil((deriveLamp(p).sheets - 2) / p.cutoutEvery) * (p.tpuLayers - p.cutoutLayers) * p.layerHeight
    expect(tpu.volume / expectedTpu).toBeCloseTo(1, 6)
    for (const mesh of Object.values(geometry)) {
      const position = mesh.getAttribute('position')
      for (let i = 0; i < position.count; i++) expect(position.getZ(i) / p.layerHeight).toBeCloseTo(Math.round(position.getZ(i) / p.layerHeight), 4)
    }
    Object.values(geometry).forEach(mesh => mesh.dispose()); Object.values(solid).forEach(mesh => mesh.dispose())
  })

  it.each([
    { cutoutPattern: 'triangles' as const, cutoutCount: 7, cutoutDepth: 50 },
    { cutoutPattern: 'half-circles' as const, cutoutCount: 13, cutoutDepth: 50 },
    { cutoutPattern: 'rectangles' as const, cutoutCount: 31, cutoutDepth: 75 },
    { cutoutPattern: 'half-circles' as const, cutoutCount: 4, cutoutDepth: 10, innerConnector: 2.4 },
  ])('preserves manifold boundaries at coincident tips and irregular counts: %j', change => {
    const p = { ...DEFAULT_PARAMETERS, pleats: 3, ...change }
    const geometry = buildManufacturingGeometry(p)
    const tpu = audit(geometry.tpu), pla = audit(geometry.pla)
    expect(tpu.badEdges).toBe(0)
    expect(pla.badEdges).toBe(0)
    expect(tpu.components).toBe(1)
    expect(pla.components).toBe(5)
    expect(tpu.minArea).toBeGreaterThan(1e-9)
    expect(pla.minArea).toBeGreaterThan(1e-9)
    geometry.tpu.dispose(); geometry.pla.dispose()
  })

  it.each(patterns.flatMap(cutoutPattern => [
    { cutoutPattern, shape: 'circle' as const, cutoutEvery: 1, cutoutSpacing: 30, cutoutCount: 12 },
    { cutoutPattern, shape: 'rounded-rectangle' as const, cutoutEvery: 1, cutoutSpacing: 30, cutoutCount: 12 },
    { cutoutPattern, shape: 'circle' as const, cutoutEvery: 2, cutoutSpacing: 5, cutoutCount: 4 },
    { cutoutPattern, shape: 'rounded-rectangle' as const, cutoutEvery: 3, cutoutSpacing: 80, cutoutCount: 4 },
  ]))('prints outward release paths, correctly oriented residual skins and no inside recesses: %j', change => {
    // Unequal recess/residual thickness catches an accidental top-only slab
    // schedule that a symmetric one-layer / one-layer membrane would hide.
    const p = { ...DEFAULT_PARAMETERS, pleats: 4, ...change, tpuLayers: 4, cutoutLayers: 1 }
    const geometry = buildManufacturingGeometry(p)
    const material = new MeshBasicMaterial({ side: DoubleSide })
    const tpu = new Mesh(geometry.tpu, material), pla = new Mesh(geometry.pla, material)
    const inside = (mesh: Mesh, point: Vector3) => new Set(new Raycaster(point, new Vector3(0.9231, 0.3846, 0.00017).normalize()).intersectObject(mesh).map(hit => Math.round(hit.distance * 1e5))).size % 2 === 1
    for (let sheet = 1; sheet < 7; sheet++) {
      const z = sheet * (p.tpuLayers + p.separatorLayers) * p.layerHeight
      const top = sheet % 2 === 1
      const recessLayers = p.tpuLayers - p.cutoutLayers
      const pocketZ = z + (top ? p.cutoutLayers + recessLayers / 2 : recessLayers / 2) * p.layerHeight
      const skinZ = z + (top ? p.cutoutLayers / 2 : recessLayers + p.cutoutLayers / 2) * p.layerHeight
      const floorZ = z + (top ? p.cutoutLayers : recessLayers) * p.layerHeight
      for (let slot = 0; slot < p.cutoutCount; slot++) for (const offset of [-0.2, 0.07, 0.2]) {
        const u = (slot + 0.5 + offset * cutoutProfile(p).mouthFraction / .7) / p.cutoutCount
        const distance = cutoutDepthAt(p, u) * 0.45
        const inset = distance
        const [x, y] = cutoutContourPoint(p, u, inset)
        const pocket = new Vector3(x, y, pocketZ)
        if ((sheet - 1) % p.cutoutEvery !== 0) {
          // Skipped membranes must contain full-thickness TPU at the same
          // pattern footprint, with no hidden PLA skin on either face.
          for (const point of [pocket, new Vector3(x, y, skinZ)]) {
            expect(inside(tpu, point)).toBe(true)
            expect(inside(pla, point)).toBe(false)
          }
          continue
        }
        expect(inside(pla, pocket)).toBe(true)
        expect(inside(tpu, pocket)).toBe(false)
        expect(inside(tpu, new Vector3(x, y, skinZ))).toBe(true)
        expect(inside(pla, new Vector3(x, y, skinZ))).toBe(false)
        const floor = new Raycaster(pocket, new Vector3(0, 0, top ? -1 : 1)).intersectObject(tpu)[0]
        expect(floor.point.z).toBeCloseTo(floorZ, 5)
        expect(floor.face!.normal.z).toBeCloseTo(top ? 1 : -1, 10)
        const underside = new Raycaster(pocket, new Vector3(0, 0, top ? -1 : 1)).intersectObject(tpu)
          .find(hit => Math.abs(hit.point.z - floorZ) > 1e-5)!
        expect(Math.abs(underside.point.z - floorZ)).toBeCloseTo(p.cutoutLayers * p.layerHeight, 5)
        const next = cutoutContourPoint(p, u, inset + 0.1)
        const direction = new Vector3(x - next[0], y - next[1], 0).normalize()
        expect(new Raycaster(pocket, direction, 0, distance + 0.1).intersectObject(tpu)).toHaveLength(0)
        // The same pocket joins the outward-open separator above the odd
        // sheet or below the even one, without crossing another TPU skin.
        const towardGap = new Vector3(0, 0, top ? 1 : -1)
        const toGap = recessLayers * p.layerHeight / 2 + p.separatorLayers * p.layerHeight / 2
        expect(new Raycaster(pocket, towardGap, 0, toGap).intersectObject(tpu)).toHaveLength(0)
        expect(inside(pla, pocket.clone().addScaledVector(towardGap, toGap))).toBe(true)
        const [innerX, innerY] = cutoutContourPoint(p, u, p.bandWidth - p.innerConnector / 2)
        expect(inside(tpu, new Vector3(innerX, innerY, pocketZ))).toBe(true)
        expect(inside(pla, new Vector3(innerX, innerY, pocketZ))).toBe(false)
      }
    }
    for (const sheet of [0, 7]) for (let slot = 0; slot < p.cutoutCount; slot++) {
      const u = (slot + 0.5) / p.cutoutCount
      const [x, y] = cutoutContourPoint(p, u, cutoutDepthAt(p, u) * 0.45)
      for (const layer of [0.25, p.tpuLayers - 0.25]) {
        const point = new Vector3(x, y, (sheet * (p.tpuLayers + p.separatorLayers) + layer) * p.layerHeight)
        expect(inside(tpu, point)).toBe(true)
        expect(inside(pla, point)).toBe(false)
      }
    }
    geometry.tpu.dispose(); geometry.pla.dispose(); material.dispose()
  })

  it('blocks dense patterns whose full-thickness webs cannot fit two extrusion paths', () => {
    const p = { ...DEFAULT_PARAMETERS, shape: 'circle' as const, width: 66, lightDiameter: 8, lightClearance: 0, cutoutPattern: 'triangles' as const, cutoutCount: 32 }
    expect(cutoutMinimumWeb(p)).toBeLessThan(2 * p.extrusionWidth)
    expect(manufacturingErrors(p)).toContainEqual(expect.objectContaining({ id: 'cutout-web' }))
    expect(() => buildManufacturingGeometry(p)).toThrow(/Patterns leave too little solid TPU/)
    const spaced = { ...p, cutoutSpacing: 80 }
    expect(cutoutMinimumWeb(spaced)).toBeGreaterThan(2 * p.extrusionWidth)
    expect(manufacturingErrors(spaced)).not.toContainEqual(expect.objectContaining({ id: 'cutout-web' }))
  })

  it.each(patterns)('exposes the same outside-connected polygon footprints on odd and even sheets: %s', cutoutPattern => {
    const p = { ...DEFAULT_PARAMETERS, pleats: 4, cutoutPattern }
    for (const sheet of [1, 2]) {
      const polygons = cutoutPolygons(p, sheet)
      expect(polygons).toHaveLength(p.cutoutCount)
      expect(polygons.every(polygon => polygon.length >= 3)).toBe(true)
    }
    expect(cutoutPolygons(p, 1)).toEqual(cutoutPolygons(p, 2))
    expect(cutoutPolygons(p, 0)).toEqual([])
    expect(cutoutPolygons(p, 7)).toEqual([])
  })
})
