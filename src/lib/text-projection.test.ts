import { describe, expect, it } from 'vitest'
import { Vector3, type BufferGeometry } from 'three'
import { DEFAULT_PARAMETERS, type LampParameters } from './lamp'
import { buildManufacturingGeometry } from './manufacturing'
import { textAtPrintPoint, textProjectionAtPoint, textPrintCoordinates, textGlyphGeometry, textWrapMetrics, textAt, textProjectionConfig } from './text-projection'
import { cutoutContourPoint } from './cutout-patterns'
import { createManufacturingArchive, geometryToSTL } from './export'
import { strFromU8, unzipSync } from 'fflate'

function audit(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position'), indices = geometry.getIndex()!
  const unique = new Map<string, number>()
  const welded = Array.from({ length: position.count }, (_, id) => {
    const key = `${position.getX(id)}/${position.getY(id)}/${position.getZ(id)}`
    if (!unique.has(key)) unique.set(key, id)
    return unique.get(key)!
  })
  const edges = new Map<string, { count: number; sign: number }>()
  let volume = 0, minimumArea = Infinity
  for (let face = 0; face < indices.count; face += 3) {
    const ids = [0, 1, 2].map(n => welded[indices.getX(face + n)])
    const [a, b, c] = ids.map(id => new Vector3().fromBufferAttribute(position, id))
    volume += a.dot(b.clone().cross(c)) / 6
    minimumArea = Math.min(minimumArea, b.clone().sub(a).cross(c.clone().sub(a)).length())
    for (let side = 0; side < 3; side++) {
      const a = ids[side], b = ids[(side + 1) % 3], key = a < b ? `${a}/${b}` : `${b}/${a}`
      const edge = edges.get(key) ?? { count: 0, sign: 0 }
      edge.count++; edge.sign += a < b ? 1 : -1; edges.set(key, edge)
    }
  }
  const bad = [...edges.entries()].filter(([, edge]) => edge.count !== 2 || edge.sign !== 0)
  return { volume, minimumArea, badEdges: bad.length }
}

describe('projected TPU lettering', () => {
  it.each(['circle', 'rounded-rectangle'] as const)('inverts nominal %s contour coordinates', shape => {
    const p = { ...DEFAULT_PARAMETERS, shape, width: 220, depth: 160 }
    for (let step = 0; step < 64; step++) for (const inset of [0, 1.2, 10, 22]) {
      const u = step / 64, [x, y] = cutoutContourPoint(p, u, inset)
      const actual = textPrintCoordinates(p, x, y)
      expect(actual.inset).toBeCloseTo(inset, 7)
      expect(Math.min(Math.abs(actual.u - u), 1 - Math.abs(actual.u - u))).toBeLessThan(1e-8)
    }
  })

  it('anchors the projection to the target height and keeps connectors single-color', () => {
    const p = { ...DEFAULT_PARAMETERS, textEnabled: true }
    const point = cutoutContourPoint(p, .75, p.bandWidth / 2)
    const a = textProjectionAtPoint(p, 22, ...point)
    expect(textProjectionAtPoint({ ...p, expansion: 0, rotation: 150 }, 22, ...point)).toEqual(a)
    for (const inset of [0, p.outerConnector / 2, p.bandWidth - p.innerConnector / 2, p.bandWidth]) {
      expect(textAtPrintPoint(p, 22, ...cutoutContourPoint(p, .75, inset))).toBe(false)
    }
    expect(textAtPrintPoint(p, 0, ...point)).toBe(false)
  })

  const cases: Partial<LampParameters>[] = [
    { shape: 'circle' },
    { shape: 'rounded-rectangle', textRotation: 27, textAzimuth: 35 },
    { cutoutPattern: 'triangles', cutoutPhase: 21 },
    { cutoutPattern: 'half-circles', cutoutEvery: 2, textRotation: -20 },
    { cutoutPattern: 'rectangles', cutoutPhase: -25 },
    { pleats: 24, height: 480, textRotation: 83, textAzimuth: -143 },
    { text: 'B', textRotation: 45 },
    { text: '8', textRotation: -45, textAzimuth: 45 },
    { text: 'O', textAzimuth: 90 }, { text: '8', textAzimuth: -90 },
    { text: 'HI', textAzimuth: 180 }, { text: 'HI', textRotation: 90 },
    { text: 'HI', textRotation: -90 }, { text: 'O', textRotation: 180 },
    { text: 'O', shape: 'circle', textRotation: 45, textAzimuth: 130 },
    { text: 'HI', shape: 'circle', textSize: 300 },
    { text: '?', textSize: 40 }, { text: 'O', textHorizontal: 60, textVertical: 80 },
    { text: 'ORIGAMI', textSize: 120, textAzimuth: 90 },
    { text: 'ORIGAMI', textSize: 120, shape: 'circle', textAzimuth: -80 },
    { text: 'O', textSize: 100, cutoutPattern: 'rectangles', cutoutPhase: 21 },
    { text: 'CURVE', textSize: 100, cutoutPattern: 'half-circles', textRotation: 32 },
    { text: 'OVERLAPOVERLAP', textSize: 120, textRotation: 14 },
    { text: 'O', shape: 'circle', textSize: 100, textAzimuth: 90 },
    { text: 'O', textSize: 100, textAzimuth: (1 - textProjectionConfig(DEFAULT_PARAMETERS).centerU) * 360 },
  ]
  it.each(cases)('partitions the original TPU into closed complementary solids: %j', change => {
    const p = { ...DEFAULT_PARAMETERS, pleats: 4, height: 100, textSize: 60, textEnabled: true, ...change }
    const colored = buildManufacturingGeometry(p)
    const original = buildManufacturingGeometry({ ...p, textEnabled: false })
    const main = audit(colored.tpu), accent = audit(colored.accent!), old = audit(original.tpu)
    expect(main.badEdges).toBe(0)
    expect(accent.badEdges).toBe(0)
    expect(main.minimumArea).toBeGreaterThan(1e-10)
    expect(accent.minimumArea).toBeGreaterThan(1e-10)
    expect(accent.volume).toBeGreaterThan(0)
    expect(main.volume).toBeGreaterThan(0)
    expect((main.volume + accent.volume) / old.volume).toBeCloseTo(1, 5)
    expect(() => geometryToSTL(colored.accent!)).not.toThrow()
    expect(() => geometryToSTL(colored.tpu)).not.toThrow()
    expect(Array.from(colored.pla.getAttribute('position').array)).toEqual(Array.from(original.pla.getAttribute('position').array))
    for (const geometry of [colored.tpu, colored.accent!, colored.pla, original.tpu, original.pla]) geometry.dispose()
  })

  it('exports three registered materials with projection settings and preserves two-part legacy exports', () => {
    const p = { ...DEFAULT_PARAMETERS, textEnabled: true, pleats: 4, height: 100, textSize: 60 }
    const archive = unzipSync(createManufacturingArchive(p))
    expect(Object.keys(archive).filter(key => key.endsWith('.stl'))).toEqual(['shade-tpu.stl', 'shade-text-tpu.stl', 'separators-pla.stl'])
    const recipe = JSON.parse(strFromU8(archive['design.json'])).recipe
    expect(recipe.multicolorText).toMatchObject({ enabled: true, text: 'HI', construction: 'complementary-TPU-volumes-in-existing-membrane-layers' })
    const data = new DataView(archive['shade-text-tpu.stl'].buffer)
    expect(data.getUint32(80, true)).toBeGreaterThan(0)
    let minimumZ = Infinity
    for (let face = 0; face < data.getUint32(80, true); face++) for (let corner = 0; corner < 3; corner++) {
      const z = data.getFloat32(84 + face * 50 + 12 + corner * 12 + 8, true)
      minimumZ = Math.min(minimumZ, z)
      expect(Math.abs(z / p.layerHeight - Math.round(z / p.layerHeight))).toBeLessThan(.0001)
    }
    // A floating accent stays registered to its membrane; it is not dropped to Z=0.
    expect(minimumZ).toBeGreaterThan(0)
    expect(strFromU8(archive['READ-ME.txt'])).toContain('SECOND TPU color')
    const old = unzipSync(createManufacturingArchive({ ...p, textEnabled: false }))
    expect(Object.keys(old).filter(key => key.endsWith('.stl'))).toHaveLength(2)
  })

  it('keeps all printable text triangles independent of preview expansion and viewing rotation', () => {
    const p = { ...DEFAULT_PARAMETERS, textEnabled: true, pleats: 4, height: 100, textSize: 60 }
    const a = buildManufacturingGeometry(p), b = buildManufacturingGeometry({ ...p, expansion: 0, rotation: 93 })
    expect(geometryToSTL(a.accent!)).toEqual(geometryToSTL(b.accent!))
    expect(geometryToSTL(a.tpu)).toEqual(geometryToSTL(b.tpu))
    for (const geometry of [a.tpu, a.pla, a.accent!, b.tpu, b.pla, b.accent!]) geometry.dispose()
  })

  it('gives an actionable error when there are no active membranes for lettering', () => {
    expect(() => createManufacturingArchive({ ...DEFAULT_PARAMETERS, textEnabled: true, pleats: 1 }))
      .toThrow(/Lettering needs active folds/)
  })

  it('uses smoothly sampled heavy vector outlines with real enclosed counters', () => {
    const p = { ...DEFAULT_PARAMETERS, text: 'O', textSize: 100 }
    const glyph = textGlyphGeometry(p)
    expect(glyph.height).toBeGreaterThan(99)
    expect(glyph.height).toBeLessThan(110)
    expect(glyph.polygons[0]).toHaveLength(2)
    expect(glyph.polygons[0][0].length).toBeGreaterThan(100)
    expect(new Set(glyph.polygons[0][0].map(point => point[0].toFixed(3))).size).toBeGreaterThan(30)
  })

  it.each(['circle', 'rounded-rectangle'] as const)('wraps a long word around all sides of a %s and crosses the chart seam', shape => {
    const p = { ...DEFAULT_PARAMETERS, shape, text: 'ORIGAMI', textSize: 120, textEnabled: true }
    const metrics = textWrapMetrics(p), config = textProjectionConfig(p)
    expect(metrics.width).toBeGreaterThan(metrics.perimeter * .75)
    const ink = Array.from({ length: 512 }, (_, i) => i / 512).filter(u => {
      for (let sheet = 1; sheet < p.pleats * 2 - 1; sheet++) for (const inset of [.25, .5, .75]) if (textAt(p, sheet, u, inset)) return true
      return false
    })
    const sides = new Set(ink.map(u => Math.floor((((u - config.centerU + 1) % 1) * 4))))
    expect(sides.size).toBe(4)
    const seam = { ...p, text: 'O', textAzimuth: (1 - config.centerU) * 360, textSize: 100 }
    let seamInk = false
    for (let sheet = 1; sheet < p.pleats * 2 - 1; sheet++) {
      expect(textAt(seam, sheet, 1e-9, .5)).toBe(textAt(seam, sheet, 1 - 1e-9, .5))
      seamInk ||= textAt(seam, sheet, 1e-9, .5)
    }
    expect(seamInk).toBe(true)
  })
})
