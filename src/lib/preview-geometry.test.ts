import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMETERS, deriveLamp, type LampParameters } from './lamp'
import { buildExpandedGeometry, previewContour } from './preview-geometry'
import { buildManufacturingGeometry } from './manufacturing'

function radialExtents(parameters: LampParameters) {
  const geometry = buildExpandedGeometry(parameters)
  const positions = geometry.getAttribute('position')
  const displayHeight = deriveLamp(parameters).displayHeight
  let inner = Infinity, outer = -Infinity, top = -Infinity, activeInner = Infinity, activeOuter = -Infinity
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const radius = Math.hypot(positions.getX(vertex), positions.getZ(vertex)) * 1000
    const y = positions.getY(vertex) * 1000
    inner = Math.min(inner, radius)
    outer = Math.max(outer, radius)
    top = Math.max(top, y)
    if (y > 1e-5 && y < displayHeight - 1e-5) {
      activeInner = Math.min(activeInner, radius)
      activeOuter = Math.max(activeOuter, radius)
    }
  }
  geometry.dispose()
  return { inner, outer, activeInner, activeOuter, top }
}

describe('expanded appearance geometry', () => {
  it('interprets modulation as an actual percentage of section size', () => {
    const plain = buildExpandedGeometry({ ...DEFAULT_PARAMETERS, shape: 'circle', pleats: 25 })
    const modulated = buildExpandedGeometry({ ...DEFAULT_PARAMETERS, shape: 'circle', pleats: 25, modulation: 25 })
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
  it('uses an actual 12–16–20 free-span triangle while preserving the outer mounting outline', () => {
    // 20 mm of free span with 12 mm axial rise leaves 16 mm radial span.
    // Adding the two 1 mm joining bands gives an apparent band of 18 mm.
    // The outer join stays at 90 mm, so active inner creases retract to 72 mm.
    // The terminal washers retain the full nominal [68, 90] mm band.
    const base: LampParameters = { ...DEFAULT_PARAMETERS, shape: 'circle', pleats: 10, innerConnector: 1, outerConnector: 1 }
    const p = { ...base, height: deriveLamp(base).activeLegs * 12 }
    const result = radialExtents(p)
    expect(result.inner).toBeCloseTo(68, 4)
    expect(result.outer).toBeCloseTo(90, 4)
    expect(result.activeInner).toBeCloseTo(72, 4)
    expect(result.activeOuter).toBeCloseTo(90, 4)
    expect(result.top).toBeCloseTo(p.height, 4)
    const freeRadialSpan = result.activeOuter - result.activeInner - 2
    expect(Math.hypot(freeRadialSpan, 12)).toBeCloseTo(20, 4)
    const geometry = buildExpandedGeometry(p)
    const positions = geometry.getAttribute('position')
    const from = 2 * 97 // first active free span, following the flat terminal flange
    const to = from + 97
    const dx = (positions.getX(to) - positions.getX(from)) * 1000
    const dy = (positions.getY(to) - positions.getY(from)) * 1000
    const dz = (positions.getZ(to) - positions.getZ(from)) * 1000
    expect(Math.hypot(dx, dz)).toBeCloseTo(16, 4)
    expect(dy).toBeCloseTo(12, 4)
    expect(Math.hypot(dx, dy, dz)).toBeCloseTo(20, 4)
    geometry.dispose()
  })

  it('retracts inner active creases while expansion increases and stays finite at the span limit', () => {
    const base: LampParameters = { ...DEFAULT_PARAMETERS, shape: 'circle', pleats: 10, innerConnector: 1, outerConnector: 1 }
    const compressed = deriveLamp(base).compressedHeight
    const p = { ...base, height: deriveLamp(base).activeLegs * 20 }
    const closed = radialExtents({ ...p, expansion: 0 })
    const halfway = radialExtents({ ...p, expansion: 50 })
    const open = radialExtents({ ...p, expansion: 100 })
    expect(closed.inner).toBeCloseTo(68, 4)
    expect(closed.outer).toBeCloseTo(90, 4)
    expect(closed.top).toBeCloseTo(compressed, 4)
    expect(halfway.activeInner).toBeGreaterThan(closed.activeInner)
    expect(halfway.outer).toBeCloseTo(closed.outer, 4)
    expect(open.activeInner).toBeCloseTo(88, 4)
    expect(open.outer).toBeCloseTo(90, 4)
    expect(open.inner).toBeCloseTo(68, 4)
    expect(open.top).toBeCloseTo(p.height, 4)
  })

  it.each(['circle', 'rounded-rectangle', 'polygon'] as const)('keeps full flat %s flanges aligned with the mounting contours', shape => {
    const p = { ...DEFAULT_PARAMETERS, shape, twist: 37, modulation: 20 }
    const geometry = buildExpandedGeometry(p)
    const vertices = geometry.getAttribute('position')
    const contours = [previewContour(p, p.bandWidth), previewContour(p, 0)]
    const rowSize = contours[0].length + 1
    const angle = p.twist * Math.PI / 180
    for (const end of ['lower', 'upper'] as const) {
      const firstVertex = end === 'lower' ? 0 : vertices.count - 2 * rowSize
      for (let row = 0; row < 2; row++) {
        const contour = contours[end === 'lower' ? row : 1 - row]
        for (let point = 0; point < rowSize; point++) {
          const vertex = firstVertex + row * rowSize + point
          const nominal = contour[point % contour.length]
          const rotation = end === 'lower' ? 0 : angle
          expect(vertices.getX(vertex) * 1000).toBeCloseTo(nominal.x * Math.cos(rotation) - nominal.y * Math.sin(rotation), 4)
          expect(vertices.getZ(vertex) * 1000).toBeCloseTo(nominal.x * Math.sin(rotation) + nominal.y * Math.cos(rotation), 4)
          expect(vertices.getY(vertex) * 1000).toBeCloseTo(end === 'lower' ? 0 : p.height, 4)
        }
      }
    }
    geometry.dispose()
  })

  it('keeps a one-pleat specimen finite and compressed instead of inventing active spans', () => {
    const p = { ...DEFAULT_PARAMETERS, pleats: 1, height: 600 }
    const d = deriveLamp(p)
    const geometry = buildExpandedGeometry(p)
    const positions = geometry.getAttribute('position')
    expect(d.activeLegs).toBe(0)
    expect(d.displayHeight).toBe(d.compressedHeight)
    expect(Array.from(positions.array).every(Number.isFinite)).toBe(true)
    const levels = new Set(Array.from({ length: positions.count }, (_, index) => Number((positions.getY(index) * 1000).toFixed(5))))
    const sorted = [...levels].sort((a, b) => a - b)
    expect(sorted).toHaveLength(2)
    expect(sorted[0]).toBe(0)
    expect(sorted[1]).toBeCloseTo(d.compressedHeight, 5)
    geometry.dispose()
  })

  it('draws each flat crease band and terminal flange once without overlapping mirrored faces', () => {
    const p = { ...DEFAULT_PARAMETERS, shape: 'circle' as const, pleats: 4, height: 80 }
    const geometry = buildExpandedGeometry(p)
    const positions = geometry.getAttribute('position')
    const indices = geometry.getIndex()!
    const horizontalAreas = new Map<string, number>()
    const faces = new Set<string>()
    for (let triangle = 0; triangle < indices.count; triangle += 3) {
      const vertices = [0, 1, 2].map(corner => {
        const index = indices.getX(triangle + corner)
        return [positions.getX(index), positions.getY(index), positions.getZ(index)]
      })
      const signature = vertices.map(point => point.map(value => value.toFixed(8)).join(',')).sort().join('/')
      expect(faces.has(signature)).toBe(false)
      faces.add(signature)
      const [a, b, c] = vertices
      if (Math.abs(a[1] - b[1]) > 1e-8 || Math.abs(a[1] - c[1]) > 1e-8) continue
      const area = Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])) * 500000
      const level = (a[1] * 1000).toFixed(4)
      horizontalAreas.set(level, (horizontalAreas.get(level) ?? 0) + area)
    }
    const derived = deriveLamp(p)
    const outerRadius = p.width / 2
    const freeDepth = Math.sqrt(derived.freeSpan ** 2 - (p.height / derived.activeLegs) ** 2)
    const innerRadius = outerRadius - freeDepth - p.innerConnector - p.outerConnector
    const segments = previewContour(p, 0).length
    const polygonFactor = segments / 2 * Math.sin(2 * Math.PI / segments)
    expect(horizontalAreas.size).toBe(derived.activeLegs + 1)
    for (let level = 0; level <= derived.activeLegs; level++) {
      const terminal = level === 0 || level === derived.activeLegs
      const [inner, outer] = terminal ? [outerRadius - p.bandWidth, outerRadius]
        : level % 2 === 1 ? [innerRadius, innerRadius + p.innerConnector]
          : [outerRadius - p.outerConnector, outerRadius]
      const expectedArea = polygonFactor * (outer ** 2 - inner ** 2)
      const actualArea = horizontalAreas.get((p.height * level / derived.activeLegs).toFixed(4))!
      expect(actualArea / expectedArea).toBeCloseTo(1, 5)
    }
    geometry.dispose()
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
