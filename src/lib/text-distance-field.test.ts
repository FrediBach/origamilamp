import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMETERS } from './lamp'
import { buildTextMaskAtlas, textMaskKey } from './shade-material'
import { textGlyphGeometry } from './text-projection'
import { polygonContains } from './text-font'
import { buildGlyphDistanceField } from './text-distance-field'

function sample(field: ReturnType<typeof buildGlyphDistanceField>, x: number, y: number) {
  const px = x * field.scale + field.padding - 0.5, py = y * field.scale + field.padding - 0.5
  const left = Math.floor(px), bottom = Math.floor(py), tx = px - left, ty = py - bottom
  const data = field.texture.image.data!
  const read = (dx: number, dy: number) => data[Math.max(0, Math.min(field.height - 1, bottom + dy)) * field.width + Math.max(0, Math.min(field.width - 1, left + dx))] / 255
  return (read(0, 0) * (1 - tx) + read(1, 0) * tx) * (1 - ty) + (read(0, 1) * (1 - tx) + read(1, 1) * tx) * ty
}

describe('smooth vector lettering', () => {
  it('preserves curved glyph counters and matches the shared manufacturing outlines', () => {
    const p = { ...DEFAULT_PARAMETERS, textEnabled: true, text: 'BO', textSize: 100 }
    const glyph = textGlyphGeometry(p), field = buildTextMaskAtlas(p)!
    try {
      expect(field.height).toBeGreaterThan(1000)
      let covered = 0, empty = 0
      for (let row = 0; row < 25; row++) for (let column = 0; column < 35; column++) {
        const x = (column + 0.37) / 35 * glyph.width, y = (row + 0.29) / 25 * glyph.height
        const distance = sample(field, x, y)
        if (Math.abs(distance - 0.5) < 0.07) continue // Less than one pixel from the vector edge.
        const inside = glyph.polygons.some(polygon => polygonContains(polygon, x, y))
        expect(distance > 0.5).toBe(inside)
        if (inside) covered++; else empty++
      }
      expect(covered).toBeGreaterThan(100)
      expect(empty).toBeGreaterThan(100)
    } finally { field.texture.dispose() }
  })

  it('stores subpixel edge distance instead of binary sheet pixels and stays cached while projecting', () => {
    const field = buildGlyphDistanceField({ width: 100, height: 100, polygons: [[[[0, 50], [50, 0], [100, 50], [50, 100]]]] }, 256)
    try {
      const values = Array.from({ length: 40 }, (_, index) => sample(field, 25 + (index / 39 - 0.5) * 4, 25))
      expect(new Set(values.map(value => value.toFixed(4))).size).toBeGreaterThan(25)
      expect(values[0]).toBeLessThan(0.5)
      expect(values.at(-1)).toBeGreaterThan(0.5)
      for (let index = 1; index < values.length; index++) expect(values[index] - values[index - 1]).toBeLessThan(0.04)
    } finally { field.texture.dispose() }
    const p = { ...DEFAULT_PARAMETERS, textEnabled: true }
    expect(textMaskKey(p)).toBe(textMaskKey({ ...p, textRotation: 45, textAzimuth: 90, textHorizontal: 20, textVertical: 80, expansion: 20, pleats: 60, textColor: 'brown' }))
  })
})
