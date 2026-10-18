import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMETERS, manufacturingErrors, validateLamp, type LampParameters } from './lamp'
import { parseDesign, serializeDesign } from './export'
import { getPrintabilityFix } from './printability-fixes'

describe('light pattern settings and recipe compatibility', () => {
  it('opens old recipes with patterns disabled and preserves their print settings', () => {
    const document = JSON.parse(serializeDesign({ ...DEFAULT_PARAMETERS, tpuLayers: 1 }))
    for (const key of ['cutoutPattern', 'cutoutCount', 'cutoutDepth', 'cutoutLayers']) delete document.parameters[key]
    expect(parseDesign(JSON.stringify(document))).toEqual({ ...DEFAULT_PARAMETERS, tpuLayers: 1 })
  })

  it.each(['triangles', 'half-circles', 'rectangles'] as const)('round-trips %s and records release instructions', cutoutPattern => {
    const p = { ...DEFAULT_PARAMETERS, cutoutPattern, cutoutCount: 17, cutoutDepth: 65, tpuLayers: 3, cutoutLayers: 2 }
    const json = serializeDesign(p)
    expect(parseDesign(json)).toEqual(p)
    expect(JSON.parse(json).recipe.lightPattern).toMatchObject({ shape: cutoutPattern, remainingThicknessMillimetres: 0.4, releaseEdge: 'outer', construction: 'alternating-face-recesses-in-outward-open-PLA-separators' })
    expect(manufacturingErrors(p)).toEqual([])
  })

  it.each([
    { cutoutPattern: 'holes' }, { cutoutPattern: null }, { cutoutCount: 3 },
    { cutoutCount: 33 }, { cutoutCount: 4.5 }, { cutoutDepth: 9 }, { cutoutDepth: 76 },
    { cutoutLayers: 0 }, { cutoutLayers: 20 }, { cutoutLayers: 1.5 },
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
})
