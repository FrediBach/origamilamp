import { expect, it } from 'vitest'
import { DEFAULT_PARAMETERS, type LampParameters } from './lamp'
import { buildTextLayout, textAtPrintPoint, textGlyphGeometry, textPrintCoordinates, textProjectionAtPoint } from './text-projection'
import { cutoutContourPoint } from './cutout-patterns'

function distanceToSegment(x: number, y: number, a: readonly number[], b: readonly number[]) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / Math.max(1e-20, dx * dx + dy * dy)))
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)
}

it('keeps analytic preview and optical masks aligned with the manufactured glyph edges', () => {
  let totalArea = 0, mismatchArea = 0
  for (const shape of ['circle', 'rounded-rectangle'] as const) {
    const p: LampParameters = { ...DEFAULT_PARAMETERS, shape, pleats: 4, height: 100, textEnabled: true, text: 'BO', textSize: 60, textRotation: 37, textAzimuth: 39 }
    const rings = textGlyphGeometry(p).polygons.flat()
    for (let sheet = 1; sheet < p.pleats * 2 - 1; sheet++) {
      const layout = buildTextLayout(p, sheet)
      for (const face of layout.faces) {
        if (face.band !== 1) continue
        const us = face.vertices.map(id => layout.pointUs[id])
        if (Math.max(...us) - Math.min(...us) > 0.5) us.forEach((u, index) => { if (u < 0.5) us[index]++ })
        // Both the shader and optical caster interpolate the original material
        // chart through each triangle, so use those preserved coordinates.
        const [x, y] = cutoutContourPoint(p, us.reduce((a, b) => a + b, 0) / 3, face.vertices.reduce((sum, id) => sum + layout.pointInsets[id], 0) / 3)
        const [a, b, c] = face.vertices.map(id => layout.points[id])
        const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2
        totalArea += area
        if (face.accent === textAtPrintPoint(p, sheet, x, y)) continue
        mismatchArea += area
        const { inset } = textPrintCoordinates(p, x, y)
        // The print boundary uses short chords; its centroid can lie a few
        // microns beyond the exact normal-offset crease used by the sampler.
        if (Math.min(Math.abs(inset - p.outerConnector), Math.abs(inset - p.bandWidth + p.innerConnector)) < 0.05) continue
        const [gx, gy] = textProjectionAtPoint(p, sheet, x, y)
        // Manufacturing uses affine charts on sampled curves; the optical
        // sampler evaluates the continuous contour. Compare against the actual
        // vector outline, including its counters, rather than a bitmap grid.
        const distanceToEdge = Math.min(...rings.flatMap(ring => ring.map((a, i) => distanceToSegment(gx, gy, a, ring[(i + 1) % ring.length]))))
        expect(distanceToEdge, JSON.stringify({ shape, sheet, x, y, gx, gy, accent: face.accent })).toBeLessThan(0.5)
      }
    }
  }
  expect(mismatchArea / totalArea).toBeLessThan(0.01)
})
