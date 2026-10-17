import { BufferGeometry, Float32BufferAttribute } from 'three'
import { calibrationParameters, deriveLamp, manufacturingErrors, type LampParameters } from './lamp'

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

/** Exact nominal compressed configuration in millimetres, centered in XY,
 * resting at Z=0. Appearance rotation, height and expansion do not affect it. */
export function buildManufacturingGeometry(parameters: LampParameters, options: ManufacturingOptions = {}): ManufacturingGeometry {
  const p = options.calibration ? calibrationParameters(parameters) : parameters
  const errors = manufacturingErrors(p)
  if (errors.length) throw new Error(errors.map(error => `${error.title}: ${error.detail}`).join('\n'))
  return { tpu: buildBoundary(p, 'TPU'), pla: buildBoundary(p, 'PLA') }
}
