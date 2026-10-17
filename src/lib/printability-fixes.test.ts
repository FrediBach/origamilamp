import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMETERS, deriveLamp, validateLamp, type LampParameters } from './lamp'
import { deriveMounting } from './mounting'
import { getPrintabilityFix } from './printability-fixes'

function fix(id: string, changes: Partial<LampParameters>) {
  const original = { ...DEFAULT_PARAMETERS, ...changes }
  const snapshot = { ...original }
  const before = validateLamp(original)
  expect(before.some(d => d.id === id && d.status !== 'pass')).toBe(true)
  const correction = getPrintabilityFix(original, id)
  expect(correction, `Expected a correction for ${id}`).toBeDefined()
  expect(original).toEqual(snapshot)
  const result = correction!.parameters
  expect(result).not.toBe(original)
  const after = validateLamp(result)
  expect(after.some(d => d.id === id && d.status !== 'pass')).toBe(false)
  const ranks = { pass: 0, warning: 1, error: 2 }
  for (const diagnostic of after) {
    const previous = before.find(d => d.id === diagnostic.id)
    expect(ranks[diagnostic.status], diagnostic.id).toBeLessThanOrEqual(previous ? ranks[previous.status] : 0)
  }
  for (const key of ['bedWidth', 'bedDepth', 'bedHeight', 'lightDiameter', 'lightClearance', 'measuredPitch', 'extrusionWidth', 'layerHeight'] as const) {
    expect(result[key], `${key} must remain a user-supplied requirement`).toBe(original[key])
  }
  expect(correction!.detail).toContain('→')
  expect(after).toContainEqual(expect.objectContaining({ id: 'mounting-load', status: 'warning' }))
  expect(after).toContainEqual(expect.objectContaining({ id: 'calibration', status: 'warning' }))
  return correction!
}

describe('printability corrections', () => {
  it.each([10, 22.05, 89.95, 90, 900])('moves corner radius %s inside both strict offset bounds', cornerRadius => {
    const { parameters: p, detail } = fix('contours', { cornerRadius })
    expect(p.cornerRadius).toBeGreaterThan(p.bandWidth + 0.05)
    expect(p.cornerRadius).toBeLessThan(Math.min(p.width, p.depth) / 2 - 0.05)
    expect(p.width).toBe(180)
    expect(p.bandWidth).toBe(22)
    expect(detail).toContain('Corner radius:')
  })

  it('opens a collapsed aperture and repairs its coupled corner offsets', () => {
    const { parameters: p } = fix('contours', { bandWidth: 95 })
    expect(Math.min(p.width, p.depth) - 2 * p.bandWidth).toBeGreaterThanOrEqual(20)
    expect(p.bandWidth).toBeLessThan(95)
    expect(p.cornerRadius).toBeGreaterThan(p.bandWidth + 0.05)
  })

  it('corrects separator access without exchanging it for a corner error', () => {
    const { parameters: p } = fix('aperture-access', { bandWidth: 82 })
    expect(validateLamp(p)).toContainEqual(expect.objectContaining({ id: 'contours', status: 'pass' }))
  })

  it('widens the free membrane while respecting grip and corner constraints', () => {
    const { parameters: p } = fix('free-span', { bandWidth: 4, cornerRadius: 10 })
    expect(deriveLamp(p).freeSpan).toBeGreaterThanOrEqual(3)
    expect(p.bandWidth).toBeGreaterThan(4)
  })

  it('widens joining bands and preserves a just-sufficient folding span', () => {
    const original = { bandWidth: 5, innerConnector: 0.4, outerConnector: 1.2, height: 100 }
    const { parameters: p } = fix('connectors', original)
    expect(p.innerConnector).toBe(0.8)
    expect(p.outerConnector).toBe(1.2)
    expect(deriveLamp(p).freeSpan).toBeGreaterThanOrEqual(3)
  })

  it('keeps a fractional extrusion boundary above the free-span minimum', () => {
    const { parameters: p } = fix('free-span', { extrusionWidth: 1.1, innerConnector: 2.2, outerConnector: 2.2, bandWidth: 8.79, height: 100 })
    expect(deriveLamp(p).freeSpan).toBeGreaterThanOrEqual(4.4)
  })

  it('shrinks a shade footprint to the actual printer area', () => {
    const { parameters: p, detail } = fix('build-volume', { width: 400, depth: 300 })
    expect(p.width).toBeLessThanOrEqual(p.bedWidth)
    expect(p.depth).toBeLessThanOrEqual(p.bedDepth)
    expect(detail).toContain('Width:')
  })

  it('reduces pleats and adjusts the target when the stack exceeds build height', () => {
    const { parameters: p, detail } = fix('build-volume', { bedHeight: 20 })
    expect(p.pleats).toBeLessThan(DEFAULT_PARAMETERS.pleats)
    expect(deriveLamp(p).compressedHeight).toBeLessThanOrEqual(20)
    expect(p.height).toBeLessThanOrEqual(deriveLamp(p).estimatedMaxHeight)
    expect(detail).toContain('Pleats:')
    expect(detail).toContain('Target height:')
  })

  it('keeps a stack that already fits exactly at a fractional layer boundary', () => {
    const original = { ...DEFAULT_PARAMETERS, layerHeight: 0.08, tpuLayers: 1, separatorLayers: 1, pleats: 15, bedHeight: 4.72, twist: 5 }
    expect(deriveLamp(original).compressedHeight).toBe(original.bedHeight)
    const { parameters: p } = fix('experimental-profile', original)
    expect(p).toEqual({ ...original, twist: 0 })
  })

  it.each(['light-clearance', 'mounting-clearance'])('makes room for the module without changing its requirements: %s', id => {
    const { parameters: p } = fix(id, { lightDiameter: 150 })
    expect(p.width).toBeGreaterThan(180)
    expect(p.depth).toBeGreaterThan(180)
    if (id === 'mounting-clearance') expect(deriveMounting(p).minimumOpening).toBeGreaterThanOrEqual(174)
  })

  it('can narrow the membrane to fit a larger module when the printer prevents widening', () => {
    const { parameters: p } = fix('mounting-clearance', { lightDiameter: 150, bedWidth: 210, bedDepth: 210, height: 100 })
    expect(p.width).toBeLessThanOrEqual(210)
    expect(p.depth).toBeLessThanOrEqual(210)
    expect(p.bandWidth).toBeLessThan(22)
  })

  it('widens the mounting grip with a floating point margin', () => {
    const { parameters: p } = fix('mounting-grip', { bandWidth: 6.9, outerConnector: 1.7, height: 100 })
    expect(deriveMounting(p).gripWidth).toBeGreaterThanOrEqual(4)
  })

  it('expands a collapsed preview enough to separate the mounting clamps', () => {
    const { parameters: p } = fix('mounting-height', { pleats: 4, height: 80, expansion: 0 })
    expect(p.expansion).toBeGreaterThan(0)
    expect(p.expansion).toBeLessThan(100)
    expect(p.height).toBe(80)
    expect(deriveMounting(p).displayHeight).toBeGreaterThanOrEqual(deriveMounting(p).minimumMountedHeight)
  })

  it('adds an active pleat to a one-pleat mounted preview', () => {
    const { parameters: p, label } = fix('mounting-height', { pleats: 1, height: 30 })
    expect(p.pleats).toBe(2)
    expect(label).toBe('Add a folding pleat')
  })

  it('allows full expansion when the preview envelope exactly meets the clamp height', () => {
    const { parameters: p } = fix('mounting-height', { pleats: 2, bandWidth: 12.4, height: 20, expansion: 0 })
    expect(p.expansion).toBe(100)
    expect(p.height).toBe(20)
    expect(p.pleats).toBe(2)
  })

  it('preserves a pre-existing clearance deficit when widening a folding span', () => {
    const original = { ...DEFAULT_PARAMETERS, bandWidth: 4, lightDiameter: 150 }
    const { parameters: p } = fix('free-span', original)
    expect(Math.min(p.width, p.depth) - 2 * p.bandWidth).toBeGreaterThanOrEqual(Math.min(original.width, original.depth) - 2 * original.bandWidth)
    expect(deriveMounting(p).minimumOpening).toBeGreaterThanOrEqual(deriveMounting(original).minimumOpening)
  })

  it.each([1, 1500])('fits an out-of-range target height %s to the preview envelope', height => {
    const { parameters: p } = fix('height', { height })
    const d = deriveLamp(p)
    expect(p.height).toBeGreaterThanOrEqual(d.compressedHeight)
    expect(p.height).toBeLessThanOrEqual(d.estimatedMaxHeight)
    expect(p.pleats).toBe(DEFAULT_PARAMETERS.pleats)
  })

  it('converts an experimental polygon to an explicitly named plain soft square', () => {
    const { parameters: p, label, detail } = fix('experimental-profile', { shape: 'polygon', twist: 25, modulation: 20, cornerRadius: 4 })
    expect(p.shape).toBe('rounded-rectangle')
    expect(p.twist).toBe(0)
    expect(p.modulation).toBe(0)
    expect(label).toContain('soft square')
    expect(detail).toContain('Shape: polygon → Soft square')
    expect(detail).toContain('Twist: 25° → 0°')
    expect(detail).toContain('Size modulation: 20% → 0%')
  })

  it('preserves a circle when removing twist and modulation', () => {
    const { parameters: p } = fix('experimental-profile', { shape: 'circle', twist: 10, modulation: 5 })
    expect(p.shape).toBe('circle')
    expect(p.width).toBe(p.depth)
  })

  it('allows a local profile reset while leaving an unrelated impossible aperture for manual correction', () => {
    const original = { ...DEFAULT_PARAMETERS, shape: 'circle' as const, width: 5, depth: 5, twist: 10 }
    const { parameters: p } = fix('experimental-profile', original)
    expect(p).toEqual({ ...original, twist: 0 })
  })

  it('preserves passing exact-boundary dimensions when correcting an unrelated profile', () => {
    const original = { ...DEFAULT_PARAMETERS, shape: 'circle' as const, width: 82.4, depth: 82.4, bedWidth: 82.4, bedDepth: 82.4, bandWidth: 7.2, lightDiameter: 44, lightClearance: 6, twist: 5, height: 100 }
    const { parameters: p } = fix('experimental-profile', original)
    expect(p).toEqual({ ...original, twist: 0 })
  })

  it('preserves an already valid corner close to the strict boundary', () => {
    const { parameters: p } = fix('height', { cornerRadius: 22.06, height: 1500 })
    expect(p.cornerRadius).toBe(22.06)
  })

  it.each(['build-volume', 'mounting-clearance'])('preserves circular geometry during %s', id => {
    const { parameters: p } = fix(id, id === 'build-volume'
      ? { shape: 'circle', width: 300, depth: 300, bedWidth: 256, bedDepth: 210 }
      : { shape: 'circle', lightDiameter: 150, bedWidth: 256, bedDepth: 230 })
    expect(p.shape).toBe('circle')
    expect(p.width).toBe(p.depth)
    expect(p.width).toBeLessThanOrEqual(Math.min(p.bedWidth, p.bedDepth))
  })

  it('corrects numerical recipe risks without claiming physical validation', () => {
    const { parameters: p, detail } = fix('recipe', { tpuLayers: 5, separatorLayers: 1, measuredPitch: 15 })
    const d = deriveLamp(p)
    expect(d.membraneThickness).toBeLessThanOrEqual(0.8)
    expect(d.separatorThickness).toBeGreaterThanOrEqual(0.3)
    expect(p.tpuLayers).toBe(4)
    expect(p.separatorLayers).toBe(2)
    expect(detail).toContain('physical test')
    expect(detail).toContain('calibration specimen')
    expect(p.measuredPitch).toBe(15)
  })

  it('reduces pleats if increasing separator layers would overflow the printer', () => {
    const { parameters: p } = fix('recipe', { tpuLayers: 2, separatorLayers: 1, bedHeight: 30 })
    expect(p.separatorLayers).toBe(2)
    expect(p.pleats).toBeLessThan(24)
    expect(deriveLamp(p).compressedHeight).toBeLessThanOrEqual(30)
  })

  it.each([
    ['mounting-clearance', { lightDiameter: 300 }],
    ['build-volume', { bedWidth: 20, bedDepth: 20 }],
    ['build-volume', { bedHeight: 0.1 }],
    ['build-volume', { bedHeight: 1.2 }],
    ['mounting-height', { pleats: 1, height: 30, bedHeight: 2 }],
  ] as const)('omits an infeasible correction for %s with %j', (id, changes) => {
    expect(getPrintabilityFix({ ...DEFAULT_PARAMETERS, ...changes }, id)).toBeUndefined()
  })

  it.each(['calibration', 'mounting-load', 'layers', 'unknown'])('does not invent an automatic answer to %s', id => {
    expect(getPrintabilityFix(DEFAULT_PARAMETERS, id)).toBeUndefined()
  })

  it.each([{ width: NaN }, { width: -1 }, { pleats: 1.5 }, { layerHeight: 0.01 }, { lightClearance: -1 }, { extrusionWidth: 2 }, { expansion: 120 }])('leaves malformed inputs for manual correction: %j', changes => {
    expect(getPrintabilityFix({ ...DEFAULT_PARAMETERS, ...changes, cornerRadius: 10 }, 'contours')).toBeUndefined()
  })

  it('does not show a correction for passing checks', () => {
    for (const d of validateLamp(DEFAULT_PARAMETERS).filter(d => d.status === 'pass')) expect(getPrintabilityFix(DEFAULT_PARAMETERS, d.id)).toBeUndefined()
  })
})
