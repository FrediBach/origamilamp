import { DataTexture, LinearFilter, RedFormat, UnsignedByteType } from 'three'

type Point = readonly [number, number]
type Polygon = readonly (readonly Point[])[]

/** Exact separable squared Euclidean distance transform, linear in image size. */
function distanceTransform(mask: Uint8Array, width: number, height: number, target: number) {
  const size = Math.max(width, height)
  const values = new Float64Array(size), distances = new Float64Array(size)
  const vertices = new Int32Array(size), limits = new Float64Array(size + 1)
  const result = new Float32Array(width * height)
  const transform = (count: number) => {
    let k = 0
    vertices[0] = 0; limits[0] = -Infinity; limits[1] = Infinity
    for (let q = 1; q < count; q++) {
      let crossing = ((values[q] + q * q) - (values[vertices[k]] + vertices[k] * vertices[k])) / (2 * (q - vertices[k]))
      while (crossing <= limits[k]) {
        k--
        crossing = ((values[q] + q * q) - (values[vertices[k]] + vertices[k] * vertices[k])) / (2 * (q - vertices[k]))
      }
      vertices[++k] = q; limits[k] = crossing; limits[k + 1] = Infinity
    }
    k = 0
    for (let q = 0; q < count; q++) {
      while (limits[k + 1] < q) k++
      distances[q] = (q - vertices[k]) ** 2 + values[vertices[k]]
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) values[x] = mask[y * width + x] === target ? 0 : 1e10
    transform(width)
    for (let x = 0; x < width; x++) result[y * width + x] = distances[x]
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) values[y] = result[y * width + x]
    transform(height)
    for (let y = 0; y < height; y++) result[y * width + x] = distances[y]
  }
  return result
}

/** Rasterize closed vector outlines including counters, then retain their
 * signed edge distance. Shader derivatives keep those edges smooth as the
 * camera zooms; the source remains one continuous glyph plane, not sheet tiles. */
export function buildGlyphDistanceField(glyph: { polygons: readonly Polygon[]; width: number; height: number }, capPixels = 1024) {
  const padding = 12, spread = 8
  const scale = Math.min(capPixels / Math.max(1, glyph.height), (4096 - 2 * padding) / Math.max(1, glyph.width))
  const width = Math.max(32, Math.ceil(glyph.width * scale) + 2 * padding)
  const height = Math.max(32, Math.ceil(glyph.height * scale) + 2 * padding)
  const mask = new Uint8Array(width * height)
  for (const polygon of glyph.polygons) {
    const edges = polygon.flatMap(ring => ring.map((a, index) => [a, ring[(index + 1) % ring.length]] as const))
    for (let row = 0; row < height; row++) {
      const y = (row + 0.5 - padding) / scale
      const crossings: number[] = []
      for (const [[ax, ay], [bx, by]] of edges) if ((ay > y) !== (by > y)) crossings.push(ax + (bx - ax) * (y - ay) / (by - ay))
      crossings.sort((a, b) => a - b)
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const start = Math.max(0, Math.ceil(crossings[i] * scale + padding - 0.5))
        const end = Math.min(width, Math.ceil(crossings[i + 1] * scale + padding - 0.5))
        mask.fill(1, row * width + start, row * width + end)
      }
    }
  }
  const toOutside = distanceTransform(mask, width, height, 0)
  const toInside = distanceTransform(mask, width, height, 1)
  const data = Uint8Array.from(mask, (inside, index) => {
    const distance = (Math.sqrt(inside ? toOutside[index] : toInside[index]) - 0.5) * (inside ? 1 : -1)
    return Math.round(255 * Math.max(0, Math.min(1, 0.5 + distance / (2 * spread))))
  })
  const texture = new DataTexture(data, width, height, RedFormat, UnsignedByteType)
  texture.minFilter = texture.magFilter = LinearFilter
  texture.needsUpdate = true
  return { texture, scale, padding, width, height, spread }
}
