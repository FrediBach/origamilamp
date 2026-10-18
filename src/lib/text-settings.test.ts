import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMETERS, manufacturingErrors } from './lamp'
import { parseDesign, serializeDesign } from './export'

describe('multicolor text recipes', () => {
  it('opens older recipes with lettering disabled', () => {
    const recipe = JSON.parse(serializeDesign(DEFAULT_PARAMETERS))
    for (const key of Object.keys(recipe.parameters)) if (key.startsWith('text')) delete recipe.parameters[key]
    expect(parseDesign(JSON.stringify(recipe))).toEqual(DEFAULT_PARAMETERS)
  })

  it('preserves every projection setting and color', () => {
    const parameters = { ...DEFAULT_PARAMETERS, textEnabled: true, text: 'HELLO!', textColor: 'brown' as const, textSize: 80, textRotation: -90, textAzimuth: 130, textHorizontal: -42, textVertical: 63 }
    expect(parseDesign(serializeDesign(parameters))).toEqual(parameters)
    expect(manufacturingErrors(parameters)).toEqual([])
  })

  it.each([
    { textEnabled: 'true' }, { textEnabled: null }, { text: null }, { text: 'lowercase' },
    { text: 'UNSUPPORTED ♥' }, { text: 'A'.repeat(25) }, { textColor: 'red' },
    { textSize: 39 }, { textSize: 301 }, { textSize: '120' },
    { textRotation: -181 }, { textRotation: 181 }, { textAzimuth: -181 }, { textAzimuth: 181 },
    { textHorizontal: -151 }, { textHorizontal: 151 }, { textVertical: -1 }, { textVertical: 101 },
  ])('rejects malformed projection settings: %j', change => {
    const recipe = { schemaVersion: 1, parameters: { ...DEFAULT_PARAMETERS, ...change } }
    expect(() => parseDesign(JSON.stringify(recipe))).toThrow()
  })

  it('keeps blank text editable but prevents an empty enabled export', () => {
    const parameters = { ...DEFAULT_PARAMETERS, textEnabled: true, text: '  ' }
    expect(parseDesign(serializeDesign(parameters))).toEqual(parameters)
    expect(manufacturingErrors(parameters)).toContainEqual(expect.objectContaining({ id: 'text-content' }))
    expect(manufacturingErrors({ ...parameters, textEnabled: false })).toEqual([])
  })

  it('requires a folding membrane beyond the two clamped ends', () => {
    expect(manufacturingErrors({ ...DEFAULT_PARAMETERS, pleats: 1, textEnabled: true }))
      .toContainEqual(expect.objectContaining({ id: 'text-sheets' }))
  })
})
