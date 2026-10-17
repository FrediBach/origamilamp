import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMETERS, deriveLamp, type LampParameters } from './lamp'
import { buildExpandedGeometry } from './preview-geometry'
import { buildManufacturingGeometry } from './manufacturing'

function radialExtents(parameters: LampParameters) {
  const geometry = buildExpandedGeometry(parameters)
  const positions = geometry.getAttribute('position')
  let inner = Infinity, outer = -Infinity, top = -Infinity
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const radius = Math.hypot(positions.getX(vertex), positions.getZ(vertex)) * 1000
    inner = Math.min(inner, radius)
    outer = Math.max(outer, radius)
    top = Math.max(top, positions.getY(vertex) * 1000)
  }
  geometry.dispose()
  return { inner, outer, top }
}

describe('expanded appearance geometry', () => {
  it('interprets modulation as an actual percentage of section size', () => {
    const plain = buildExpandedGeometry({ ...DEFAULT_PARAMETERS, shape: 'circle' })
    const modulated = buildExpandedGeometry({ ...DEFAULT_PARAMETERS, shape: 'circle', modulation: 25 })
    const a = plain.getAttribute('position')
    const b = modulated.getAttribute('position')
    let compared = 0
    for (let i = 0; i < a.count; i++) {
      if (Math.abs(a.getY(i) - 0.12) > 1e-7) continue
      const initial = Math.hypot(a.getX(i), a.getZ(i))
      const changed = Math.hypot(b.getX(i), b.getZ(i))
      expect(changed / initial).toBeCloseTo(1.25, 5)
      compared++
    }
    expect(compared).toBeGreaterThan(0)
    plain.dispose()
    modulated.dispose()
  })
  it('uses a 12–16–20 free-span triangle and keeps the contour centerline fixed', () => {
    // 20 mm of free span with 12 mm axial rise leaves 16 mm radial span.
    // Adding the two 1 mm joining bands gives an apparent band of 18 mm.
    // The original [68, 90] mm radii therefore contract symmetrically to [70, 88].
    const base: LampParameters = { ...DEFAULT_PARAMETERS, shape: 'circle', pleats: 10, innerConnector: 1, outerConnector: 1 }
    const compressed = deriveLamp(base).compressedHeight
    const p = { ...base, height: compressed + 20 * 12 }
    const result = radialExtents(p)
    expect(result.inner).toBeCloseTo(70, 4)
    expect(result.outer).toBeCloseTo(88, 4)
    expect(result.inner + result.outer).toBeCloseTo(158, 4)
    expect(result.top).toBeCloseTo(p.height, 4)
    const freeRadialSpan = result.outer - result.inner - 2
    expect(Math.hypot(freeRadialSpan, 12)).toBeCloseTo(20, 4)
  })

  it('contracts monotonically while expansion increases and stays finite at the span limit', () => {
    const base: LampParameters = { ...DEFAULT_PARAMETERS, shape: 'circle', pleats: 10, innerConnector: 1, outerConnector: 1 }
    const compressed = deriveLamp(base).compressedHeight
    const p = { ...base, height: compressed + 20 * 20 }
    const closed = radialExtents({ ...p, expansion: 0 })
    const halfway = radialExtents({ ...p, expansion: 50 })
    const open = radialExtents({ ...p, expansion: 100 })
    expect(closed.inner).toBeCloseTo(68, 4)
    expect(closed.outer).toBeCloseTo(90, 4)
    expect(closed.top).toBeCloseTo(compressed, 4)
    expect(halfway.inner).toBeGreaterThan(closed.inner)
    expect(halfway.outer).toBeLessThan(closed.outer)
    expect(open.inner).toBeCloseTo(78, 4)
    expect(open.outer).toBeCloseTo(80, 4)
    expect(open.top).toBeCloseTo(p.height, 4)
  })

  it('does not mutate the canonical parameters or previously generated print buffers', () => {
    const p = Object.freeze({ ...DEFAULT_PARAMETERS })
    const before = JSON.stringify(p)
    const print = buildManufacturingGeometry(p)
    const tpuPositions = Array.from(print.tpu.getAttribute('position').array)
    const plaPositions = Array.from(print.pla.getAttribute('position').array)
    for (const expansion of [0, 35, 100]) {
      const preview = buildExpandedGeometry({ ...p, expansion, height: 600 })
      preview.dispose()
    }
    expect(JSON.stringify(p)).toBe(before)
    expect(Array.from(print.tpu.getAttribute('position').array)).toEqual(tpuPositions)
    expect(Array.from(print.pla.getAttribute('position').array)).toEqual(plaPositions)
    expect(print.tpu.boundingBox!.max.z).toBeCloseTo(38, 6)
    print.tpu.dispose()
    print.pla.dispose()
  })
})
