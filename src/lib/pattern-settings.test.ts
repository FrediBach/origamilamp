import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMETERS, manufacturingErrors, validateLamp, type LampParameters } from './lamp'
import { parseDesign, serializeDesign } from './export'
import { getPrintabilityFix } from './printability-fixes'

describe('light pattern settings and recipe compatibility', () => {
  it('opens old recipes with patterns disabled and preserves their print settings', () => {
    const document = JSON.parse(serializeDesign({ ...DEFAULT_PARAMETERS, tpuLayers: 1 }))
    for (const key of ['cutoutPattern', 'cutoutCount', 'cutoutSpacing', 'cutoutEvery', 'cutoutPhase', 'cutoutDepth', 'cutoutLayers']) delete document.parameters[key]
    expect(parseDesign(JSON.stringify(document))).toEqual({ ...DEFAULT_PARAMETERS, tpuLayers: 1 })
  })

  it('keeps existing patterned recipes at their original spacing and membrane schedule', () => {
    const p = { ...DEFAULT_PARAMETERS, cutoutPattern: 'half-circles' as const, cutoutCount: 16, tpuLayers: 4 }
    const document = JSON.parse(serializeDesign(p))
    delete document.parameters.cutoutSpacing
    delete document.parameters.cutoutEvery
    expect(parseDesign(JSON.stringify(document))).toEqual(p)
    expect(parseDesign(JSON.stringify(document))).toMatchObject({ cutoutSpacing: 30, cutoutEvery: 1 })
  })

  it('opens recipes from before phase control with aligned patterns', () => {
    const p = { ...DEFAULT_PARAMETERS, cutoutPattern: 'rectangles' as const, cutoutEvery: 3, cutoutSpacing: 45 }
    const document = JSON.parse(serializeDesign(p))
    delete document.parameters.cutoutPhase
    expect(parseDesign(JSON.stringify(document))).toEqual(p)
    expect(parseDesign(JSON.stringify(document)).cutoutPhase).toBe(0)
  })

  it.each(['triangles', 'half-circles', 'rectangles'] as const)('round-trips %s and records release instructions', cutoutPattern => {
    const p = { ...DEFAULT_PARAMETERS, cutoutPattern, cutoutCount: 17, cutoutSpacing: 55, cutoutEvery: 3, cutoutPhase: -25, cutoutDepth: 65, tpuLayers: 3, cutoutLayers: 2 }
    const json = serializeDesign(p)
    expect(parseDesign(json)).toEqual(p)
    expect(JSON.parse(json).recipe.lightPattern).toMatchObject({ shape: cutoutPattern, spacingPercent: 55, everyMembranes: 3, phasePerMembranePercent: -25, remainingThicknessMillimetres: 0.4, releaseEdge: 'outer', construction: 'alternating-face-recesses-in-outward-open-PLA-separators' })
    const radius = JSON.parse(json).recipe.lightPattern.rectangleInnerCornerRadiusMillimetres
    if (cutoutPattern === 'rectangles') expect(radius).toBeGreaterThan(0)
    else expect(radius).toBe(0)
    expect(manufacturingErrors(p)).toEqual([])
  })

  it.each([
    { cutoutPattern: 'holes' }, { cutoutPattern: null }, { cutoutCount: 3 },
    { cutoutCount: 33 }, { cutoutCount: 4.5 }, { cutoutDepth: 9 }, { cutoutDepth: 76 },
    { cutoutLayers: 0 }, { cutoutLayers: 20 }, { cutoutLayers: 1.5 },
    { cutoutSpacing: 4 }, { cutoutSpacing: 81 }, { cutoutSpacing: null }, { cutoutSpacing: '30' },
    { cutoutEvery: 0 }, { cutoutEvery: 25 }, { cutoutEvery: 1.5 }, { cutoutEvery: null },
    { cutoutPhase: -101 }, { cutoutPhase: 101 }, { cutoutPhase: null }, { cutoutPhase: '25' },
  ])('rejects malformed pattern settings: %j', change => {
    expect(() => parseDesign(JSON.stringify({ schemaVersion: 1, parameters: { ...DEFAULT_PARAMETERS, ...change } }))).toThrow()
  })

  it.each([{ tpuLayers: 1 }, { cutoutLayers: 2 }, { cutoutLayers: 3 }, { pleats: 1 }])('retains editable conflicts but blocks their manufacture: %j', change => {
    const p: LampParameters = { ...DEFAULT_PARAMETERS, cutoutPattern: 'triangles', ...change }
    expect(parseDesign(serializeDesign(p))).toEqual(p)
    expect(manufacturingErrors(p).length).toBeGreaterThan(0)
    const id = change.pleats === 1 ? 'cutout-sheets' : 'cutout-thickness'
    expect(validateLamp(p)).toContainEqual(expect.objectContaining({ id, status: 'error' }))
  })

  it('offers a usable thickness correction while preserving the chosen pattern', () => {
    const p: LampParameters = { ...DEFAULT_PARAMETERS, cutoutPattern: 'rectangles', tpuLayers: 1 }
    const fix = getPrintabilityFix(p, 'cutout-thickness')
    expect(fix?.parameters).toMatchObject({ cutoutPattern: 'rectangles', tpuLayers: 2, cutoutLayers: 1 })
    expect(manufacturingErrors(fix!.parameters)).toEqual([])
  })

  it('widens gaps to restore printable webs without changing the repeat count or schedule', () => {
    const p: LampParameters = { ...DEFAULT_PARAMETERS, cutoutPattern: 'rectangles', cutoutCount: 32, cutoutSpacing: 5, cutoutEvery: 3 }
    expect(validateLamp(p)).toContainEqual(expect.objectContaining({ id: 'cutout-web', status: 'error' }))
    const fix = getPrintabilityFix(p, 'cutout-web')
    expect(fix?.parameters).toMatchObject({ cutoutPattern: 'rectangles', cutoutCount: 32, cutoutEvery: 3 })
    expect(fix!.parameters.cutoutSpacing).toBeGreaterThan(p.cutoutSpacing)
    expect(manufacturingErrors(fix!.parameters)).toEqual([])
  })
})
