import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three'
import { calibrationParameters, deriveLamp, manufacturingErrors, type LampParameters } from './lamp'
import { buildCutoutLayout, cutoutContourPoint, cutoutPhaseAt, cutoutProfile, cutoutRecessFace, type CutoutLayout } from './cutout-patterns'

export interface ManufacturingOptions { calibration?: boolean }
export interface ManufacturingGeometry { tpu: BufferGeometry; pla: BufferGeometry }
type Point2 = readonly [number, number]

/** All points are CCW. Insetting preserves the straight-edge centers, so widths
 * are normal contour offsets rather than independently scaled rectangles. */
export function offsetContour(p: LampParameters, inset: number): Point2[] {
  if (p.shape === 'circle') {
    const radius = p.width / 2 - inset
    return Array.from({ length: 128 }, (_, i) => {
      const angle = 2 * Math.PI * i / 128
      return [radius * Math.cos(angle), radius * Math.sin(angle)] as const
    })
  }
  if (p.shape !== 'rounded-rectangle') throw new Error('Only circular and rounded-rectangle manufacturing contours are supported.')
  const radius = p.cornerRadius - inset
  if (radius <= 0) throw new Error('The inward contour offset collapses a rounded corner.')
  const cx = p.width / 2 - p.cornerRadius
  const cy = p.depth / 2 - p.cornerRadius
  const centers: Point2[] = [[cx, cy], [-cx, cy], [-cx, -cy], [cx, -cy]]
  return centers.flatMap(([x, y], corner) => Array.from({ length: 17 }, (_, step) => {
    const angle = corner * Math.PI / 2 + step * Math.PI / 32
    return [x + radius * Math.cos(angle), y + radius * Math.sin(angle)] as const
  }))
}

/** Indexed boundary builder; no overlapping closed slabs and no duplicate
 * internal faces. An occupied radial × Z cell shares every boundary vertex
 * with its neighbours. Full membrane cells connect over nonzero-area rims. */
function buildBoundary(p: LampParameters, material: 'TPU' | 'PLA'): BufferGeometry {
  const { sheets } = deriveLamp(p)
  const offsets = [0, p.outerConnector, p.bandWidth - p.innerConnector, p.bandWidth]
  const contours = offsets.map(inset => offsetContour(p, inset))
  const points = contours[0].length
  const intervals = 2 * sheets - 1
  const layerBoundaries: number[] = [0]
  for (let interval = 0; interval < intervals; interval++) {
    layerBoundaries.push(layerBoundaries[interval] + (interval % 2 === 0 ? p.tpuLayers : p.separatorLayers))
  }
  const occupied = (interval: number, band: number) => {
    if (interval < 0 || interval >= intervals || band < 0 || band > 2) return false
    const membrane = interval % 2 === 0
    const connectorBand = Math.floor(interval / 2) % 2 === 0 ? 0 : 2
    return material === 'TPU' ? membrane || band === connectorBand : !membrane && band !== connectorBand
  }
  const positions: number[] = []
  const indices: number[] = []
  const vertices = new Map<string, number>()
  const vertex = (ring: number, point: number, boundary: number) => {
    const canonicalPoint = point % points
    const key = `${ring}/${canonicalPoint}/${boundary}`
    const existing = vertices.get(key)
    if (existing !== undefined) return existing
    const [x, y] = contours[ring][canonicalPoint]
    const index = positions.length / 3
    // Multiplication from an integer layer index avoids cumulative mm errors.
    positions.push(x, y, layerBoundaries[boundary] * p.layerHeight)
    vertices.set(key, index)
    return index
  }
  const quad = (a: number, b: number, c: number, d: number) => indices.push(a, b, d, b, c, d)
  for (let interval = 0; interval < intervals; interval++) {
    for (let band = 0; band < 3; band++) {
      if (!occupied(interval, band)) continue
      for (let point = 0; point < points; point++) {
        const v = (ring: number, next: number, above: number) => vertex(ring, point + next, interval + above)
        if (!occupied(interval - 1, band)) quad(v(band, 0, 0), v(band + 1, 0, 0), v(band + 1, 1, 0), v(band, 1, 0))
        if (!occupied(interval + 1, band)) quad(v(band, 0, 1), v(band, 1, 1), v(band + 1, 1, 1), v(band + 1, 0, 1))
        if (!occupied(interval, band - 1)) quad(v(band, 0, 0), v(band, 1, 0), v(band, 1, 1), v(band, 0, 1))
        if (!occupied(interval, band + 1)) quad(v(band + 1, 0, 0), v(band + 1, 0, 1), v(band + 1, 1, 1), v(band + 1, 1, 0))
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.name = material === 'TPU' ? 'shade-tpu' : 'separators-pla'
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  geometry.userData = {
    material, units: 'mm', axis: 'Z-up', construction: 'shared-vertex-exterior-boundary',
    membraneCount: sheets, separatorCount: sheets - 1,
    layerBoundaries, nominalLayerHeight: p.layerHeight,
    physicalValidation: 'pending',
  }
  return geometry
}

/** Merge coplanar exposed cells into polygons before triangulation. Keep all
 * original boundary vertices: straight runs removed for Earcut are restored
 * afterwards, so the cap still matches every vertical-wall edge exactly. */
function triangulateExposedRegion(layout: CutoutLayout, neighbours: number[][], selected: boolean[]): number[][] {
  const { points, faces } = layout
  const outgoing = new Map<number, number>()
  faces.forEach(({ vertices }, face) => {
    if (!selected[face]) return
    for (let side = 0; side < 3; side++) if (!selected[neighbours[face][side]]) outgoing.set(vertices[side], vertices[(side + 1) % 3])
  })
  const loops: number[][] = []
  while (outgoing.size) {
    const first = outgoing.keys().next().value!
    const loop = [first]
    let next = outgoing.get(first)!
    outgoing.delete(first)
    while (next !== first) {
      loop.push(next)
      const following = outgoing.get(next)
      if (following === undefined) throw new Error('A cutout surface boundary could not be closed.')
      outgoing.delete(next); next = following
    }
    loops.push(loop)
  }
  const edgeKey = (a: number, b: number) => a < b ? `${a}/${b}` : `${b}/${a}`
  const restored = new Map<string, number[]>()
  const simplified = loops.map(loop => {
    const retained = loop.filter((id, i) => {
      const a = points[loop[(i + loop.length - 1) % loop.length]], b = points[id], c = points[loop[(i + 1) % loop.length]]
      return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0
    })
    for (let i = 0; i < retained.length; i++) {
      const a = retained[i], b = retained[(i + 1) % retained.length]
      const chain = [a]
      let cursor = (loop.indexOf(a) + 1) % loop.length
      while (loop[cursor] !== b) { chain.push(loop[cursor]); cursor = (cursor + 1) % loop.length }
      chain.push(b)
      if (chain.length > 2) restored.set(edgeKey(a, b), chain)
    }
    return retained
  })
  const area = (loop: number[]) => loop.reduce((sum, id, i) => {
    const a = points[id], b = points[loop[(i + 1) % loop.length]]
    return sum + a[0] * b[1] - b[0] * a[1]
  }, 0)
  const outers = simplified.filter(loop => area(loop) > 0)
  const holes = simplified.filter(loop => area(loop) < 0)
  const contains = (loop: number[], point: readonly [number, number]) => {
    let inside = false
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = points[loop[i]], b = points[loop[j]]
      if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
    }
    return inside
  }
  const triangles: number[][] = []
  for (const outer of outers) {
    const inner = holes.filter(hole => contains(outer, points[hole[0]]))
    const ids = [...outer, ...inner.flat()]
    const vectors = (loop: number[]) => loop.map(id => new Vector2(...points[id]))
    const faces = ShapeUtils.triangulateShape(vectors(outer), inner.map(vectors))
    for (const local of faces) {
      const triangle = local.map(id => ids[id])
      const boundary: number[] = []
      for (let side = 0; side < 3; side++) {
        const a = triangle[side], b = triangle[(side + 1) % 3]
        const chain = restored.get(edgeKey(a, b))
        if (chain) boundary.push(...(chain[0] === a ? chain : chain.slice().reverse()).slice(0, -1))
        else boundary.push(a)
      }
      // The expanded outline is the original convex triangle with extra
      // collinear edge vertices. Clip only positive-area ears; this restores
      // every edge segment using the minimum number of triangles.
      while (boundary.length > 3) {
        const remainingArea = boundary.reduce((sum, id, i) => {
          const a = points[id], b = points[boundary[(i + 1) % boundary.length]]
          return sum + a[0] * b[1] - b[0] * a[1]
        }, 0)
        const ear = boundary.findIndex((id, i) => {
          const a = points[boundary[(i + boundary.length - 1) % boundary.length]], b = points[id], c = points[boundary[(i + 1) % boundary.length]]
          const earArea = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
          return earArea > 1e-10 && earArea < remainingArea - 1e-10
        })
        if (ear < 0) throw new Error('A cutout surface triangle collapsed.')
        triangles.push([boundary[(ear + boundary.length - 1) % boundary.length], boundary[ear], boundary[(ear + 1) % boundary.length]])
        boundary.splice(ear, 1)
      }
      triangles.push(boundary)
    }
  }
  return triangles
}

interface PreparedLayout {
  layout: CutoutLayout
  neighbours: number[][]
  caps: Map<string, number[][]>
}

function prepareLayout(layout: CutoutLayout): PreparedLayout {
  const neighbours = layout.faces.map(() => [-1, -1, -1])
  const edges = new Map<string, readonly [number, number]>()
  layout.faces.forEach(({ vertices }, face) => {
    for (let side = 0; side < 3; side++) {
      const a = vertices[side], b = vertices[(side + 1) % 3]
      const key = a < b ? `${a}/${b}` : `${b}/${a}`
      const previous = edges.get(key)
      if (previous) {
        neighbours[face][side] = previous[0]
        neighbours[previous[0]][previous[1]] = face
      } else edges.set(key, [face, side])
    }
  })
  return { layout, neighbours, caps: new Map() }
}

/** Each membrane has its own phase-specific planar partition. Its separator
 * ends use the same partitions, with zipper walls joining their contours.
 * This preserves every interface vertex without intersecting all phases in
 * one enormous planar arrangement. Residual skins remain continuous. */
function buildPatternedBoundary(p: LampParameters, layouts: PreparedLayout[], material: 'TPU' | 'PLA'): BufferGeometry {
  const { sheets } = deriveLamp(p)
  const slabs: { sheet: number; kind: 'base' | 'recess' | 'separator' }[] = []
  const layerBoundaries = [0]
  const addSlab = (sheet: number, kind: 'base' | 'recess' | 'separator', layers: number) => {
    slabs.push({ sheet, kind })
    layerBoundaries.push(layerBoundaries[layerBoundaries.length - 1] + layers)
  }
  for (let sheet = 0; sheet < sheets; sheet++) {
    const face = cutoutRecessFace(p, sheet)
    if (face === 'top') {
      addSlab(sheet, 'base', p.cutoutLayers)
      addSlab(sheet, 'recess', p.tpuLayers - p.cutoutLayers)
    } else if (face === 'bottom') {
      addSlab(sheet, 'recess', p.tpuLayers - p.cutoutLayers)
      addSlab(sheet, 'base', p.cutoutLayers)
    } else addSlab(sheet, 'base', p.tpuLayers)
    if (sheet < sheets - 1) addSlab(sheet, 'separator', p.separatorLayers)
  }
  const occupied = (slab: number, cell: CutoutLayout['faces'][number] | undefined) => {
    if (slab < 0 || slab >= slabs.length || !cell) return false
    const { sheet, kind } = slabs[slab]
    const tpu = kind === 'base' || (kind === 'recess'
      ? !cell.outerCutout
      : cell.band === (sheet % 2 === 0 ? 0 : 2))
    return material === 'TPU' ? tpu : !tpu
  }
  const positions: number[] = []
  const indices: number[] = []
  const vertices = new Map<string, number>()
  const vertex = (point: readonly [number, number], boundary: number) => {
    const x = Math.fround(point[0]), y = Math.fround(point[1])
    const key = `${x}/${y}/${boundary}`
    const existing = vertices.get(key)
    if (existing !== undefined) return existing
    const index = positions.length / 3
    positions.push(x, y, layerBoundaries[boundary] * p.layerHeight)
    vertices.set(key, index)
    return index
  }
  for (let boundary = 0; boundary <= slabs.length; boundary++) {
    // Every horizontal material interface touches exactly one membrane;
    // use its footprint on both sides of that shared interface.
    const adjacent = slabs[boundary - 1]?.kind !== 'separator' && boundary > 0 ? slabs[boundary - 1] : slabs[boundary]
    const prepared = layouts[adjacent.sheet]
    const { layout, neighbours, caps } = prepared
    for (const above of [false, true]) {
      const selected = layout.faces.map(cell => above
        ? occupied(boundary - 1, cell) && !occupied(boundary, cell)
        : occupied(boundary, cell) && !occupied(boundary - 1, cell))
      if (!selected.some(Boolean)) continue
      const key = selected.map(value => value ? '1' : '0').join('')
      let triangles = caps.get(key)
      if (!triangles) {
        try { triangles = triangulateExposedRegion(layout, neighbours, selected) }
        catch (cause) { throw new Error(`Pattern membrane ${adjacent.sheet + 1} could not be triangulated.`, { cause }) }
        caps.set(key, triangles)
      }
      for (const [a, b, c] of triangles) {
        const ids = [a, b, c].map(id => vertex(layout.points[id], boundary))
        if (above) indices.push(...ids)
        else indices.push(ids[2], ids[1], ids[0])
      }
    }
  }
  const quad = (a: number, b: number, c: number, d: number) => indices.push(a, b, c, a, c, d)
  for (let slab = 0; slab < slabs.length; slab++) {
    const { sheet, kind } = slabs[slab]
    if (kind !== 'separator') {
      const { layout, neighbours } = layouts[sheet]
      for (let face = 0; face < layout.faces.length; face++) {
        if (!occupied(slab, layout.faces[face])) continue
        const ids = layout.faces[face].vertices
        for (let side = 0; side < 3; side++) {
          if (occupied(slab, layout.faces[neighbours[face][side]])) continue
          const a = layout.points[ids[side]], b = layout.points[ids[(side + 1) % 3]]
          quad(vertex(a, slab), vertex(b, slab), vertex(b, slab + 1), vertex(a, slab + 1))
        }
      }
      continue
    }
    const offsets = [0, p.outerConnector, p.bandWidth - p.innerConnector, p.bandWidth]
    const rings = material === 'TPU' ? (sheet % 2 === 0 ? [0, 1] : [2, 3]) : (sheet % 2 === 0 ? [1, 3] : [0, 2])
    for (let ring = 0; ring < rings.length; ring++) {
      const contour = (membrane: number, boundary: number) => {
        const result: { u: number; id: number }[] = []
        for (const { u } of layouts[membrane].layout.nodes) {
          const id = vertex(cutoutContourPoint(p, u, offsets[rings[ring]]), boundary)
          if (result[result.length - 1]?.id !== id) result.push({ u, id })
        }
        return result
      }
      const lower = contour(sheet, slab), upper = contour(sheet + 1, slab + 1)
      const triangle = (a: number, b: number, c: number) => {
        if (ring === 0) indices.push(a, b, c)
        else indices.push(c, b, a)
      }
      let low = 0, high = 0
      while (low < lower.length - 1 || high < upper.length - 1) {
        const nextLow = lower[low + 1]?.u ?? Infinity, nextHigh = upper[high + 1]?.u ?? Infinity
        if (Math.abs(nextLow - nextHigh) < 1e-10) {
          triangle(lower[low].id, lower[low + 1].id, upper[high + 1].id)
          triangle(lower[low].id, upper[high + 1].id, upper[high].id)
          low++; high++
        } else if (nextLow < nextHigh) {
          triangle(lower[low].id, lower[low + 1].id, upper[high].id)
          low++
        } else {
          triangle(lower[low].id, upper[high + 1].id, upper[high].id)
          high++
        }
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.name = material === 'TPU' ? 'shade-tpu' : 'separators-pla'
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  geometry.userData = {
    material, units: 'mm', axis: 'Z-up', construction: 'shared-vertex-exterior-boundary',
    membraneCount: sheets, separatorCount: sheets - 1,
    layerBoundaries, nominalLayerHeight: p.layerHeight,
    cutoutPattern: p.cutoutPattern, cutoutLayers: p.cutoutLayers,
    cutoutSpacing: p.cutoutSpacing, cutoutEvery: p.cutoutEvery, cutoutPhase: p.cutoutPhase,
    cutoutFace: 'top-odd-bottom-even', extraction: 'outside-perimeter-to-outward-open-separator',
    physicalValidation: 'pending',
  }
  return geometry
}

/** Exact nominal compressed configuration in millimetres, centered in XY,
 * resting at Z=0. Appearance rotation, height and expansion do not affect it. */
export function buildManufacturingGeometry(parameters: LampParameters, options: ManufacturingOptions = {}): ManufacturingGeometry {
  const p = options.calibration ? calibrationParameters(parameters) : parameters
  const errors = manufacturingErrors(p)
  if (errors.length) throw new Error(errors.map(error => `${error.title}: ${error.detail}`).join('\n'))
  if (cutoutProfile(p).enabled) {
    const cache = new Map<string, PreparedLayout>()
    const layouts = Array.from({ length: deriveLamp(p).sheets }, (_, sheet) => {
      const activeSheet = cutoutRecessFace(p, sheet) === null ? 1 : sheet
      const key = cutoutPhaseAt(p, activeSheet).toFixed(10)
      let prepared = cache.get(key)
      if (!prepared) { prepared = prepareLayout(buildCutoutLayout(p, activeSheet)); cache.set(key, prepared) }
      return prepared
    })
    return { tpu: buildPatternedBoundary(p, layouts, 'TPU'), pla: buildPatternedBoundary(p, layouts, 'PLA') }
  }
  return { tpu: buildBoundary(p, 'TPU'), pla: buildBoundary(p, 'PLA') }
}
