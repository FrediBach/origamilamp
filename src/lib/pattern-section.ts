import type { LampParameters } from './lamp'
import { cutoutPolygons } from './cutout-patterns'

/** Intersections of the exact manufactured pattern polygons with model Y=0.
 * Half-open edge tests count shared polygon vertices once. */
export function patternSectionIntervals(p: LampParameters, sheet: number): [number, number][] {
  return cutoutPolygons(p, sheet).flatMap(polygon => {
    const intersections: number[] = []
    for (let index = 0; index < polygon.length; index++) {
      const [ax, ay] = polygon[index]
      const [bx, by] = polygon[(index + 1) % polygon.length]
      if ((ay > 0) === (by > 0)) continue
      intersections.push(ax + (bx - ax) * -ay / (by - ay))
    }
    intersections.sort((a, b) => a - b)
    const result: [number, number][] = []
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      if (intersections[index + 1] - intersections[index] > 1e-8) result.push([intersections[index], intersections[index + 1]])
    }
    return result
  })
}
