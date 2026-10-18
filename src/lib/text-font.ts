import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import fontData from '../assets/fonts/helvetiker_bold.typeface.json'
import type { MultiPolygon, Pair, Ring } from 'polygon-clipping'

const font = new FontLoader().parse(fontData)
const cache = new Map<string, { polygons: MultiPolygon; width: number; height: number }>()

/** Helvetiker Bold outlines, with the original MAGENTA license bundled beside
 * the font. Curves are sampled densely enough to keep 300 mm letters smooth. */
export function boldTextGeometry(text: string, size: number) {
  const key = `${text}/${size}`
  const existing = cache.get(key)
  if (existing) return existing
  const shapes = font.generateShapes(text, size / 1.013)
  const polygons: MultiPolygon = shapes.map(shape => {
    const { shape: outer, holes } = shape.extractPoints(24)
    return [outer, ...holes].map(points => points.map(point => [point.x, point.y] as Pair))
  })
  const points = polygons.flat(2)
  const minX = points.length ? Math.min(...points.map(point => point[0])) : 0
  const minY = points.length ? Math.min(...points.map(point => point[1])) : 0
  const width = points.length ? Math.max(...points.map(point => point[0])) - minX : 0
  const height = points.length ? Math.max(...points.map(point => point[1])) - minY : size
  for (const polygon of polygons) for (const ring of polygon) for (const point of ring) { point[0] -= minX; point[1] -= minY }
  const result = { polygons, width, height }
  cache.set(key, result)
  if (cache.size > 32) cache.delete(cache.keys().next().value!)
  return result
}

export function ringContains(ring: Ring, x: number, y: number) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j]
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

export function polygonContains(polygon: MultiPolygon[number], x: number, y: number) {
  return ringContains(polygon[0], x, y) && !polygon.slice(1).some(hole => ringContains(hole, x, y))
}
