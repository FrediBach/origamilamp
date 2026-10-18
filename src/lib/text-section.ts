import type { LampParameters } from './lamp'
import { textPolygons } from './text-projection'

/** Exact accent intersections with the manufacturing section plane, before
 * pattern recesses remove their corresponding print layers. */
export function textSectionIntervals(p: LampParameters, sheet: number): [number, number][] {
  const intervals: [number, number][] = []
  for (const polygon of textPolygons(p, sheet)) {
    const intersections: number[] = []
    for (let index = 0; index < polygon.length; index++) {
      const [ax, ay] = polygon[index]
      const [bx, by] = polygon[(index + 1) % polygon.length]
      if ((ay > 0) === (by > 0)) continue
      intersections.push(ax + (bx - ax) * -ay / (by - ay))
    }
    intersections.sort((a, b) => a - b)
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      if (intersections[index + 1] - intersections[index] > 1e-8) intervals.push([intersections[index], intersections[index + 1]])
    }
  }
  intervals.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const interval of intervals) {
    const previous = merged.at(-1)
    if (previous && interval[0] <= previous[1] + 1e-5) previous[1] = Math.max(previous[1], interval[1])
    else merged.push([...interval])
  }
  return merged
}
