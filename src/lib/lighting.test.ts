import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMETERS, validateLamp, type LampParameters } from './lamp'
import { parseDesign, serializeDesign } from './export'
import { deriveLighting, effectiveLightDiameter, lightTemperatureColor } from './lighting'
import { buildManufacturingGeometry } from './manufacturing'
import { deriveMounting, MOUNTING } from './mounting'
import { getPrintabilityFix } from './printability-fixes'

const lightingFields = ['lightSource', 'lightTemperature', 'bulbDiameter', 'bulbHeight', 'secondBulbHeight', 'ceilingLightTemperature', 'ceilingLightIntensity'] as const

describe('saved light settings', () => {
  it('restores older version 1 recipes and stored designs with their original geometry', () => {
    const oldParameters: Record<string, unknown> = { ...DEFAULT_PARAMETERS, width: 204, lightDiameter: 44 }
    for (const field of lightingFields) delete oldParameters[field]
    const restored = parseDesign(JSON.stringify({ schemaVersion: 1, parameters: oldParameters }))
    expect(restored).toEqual({ ...DEFAULT_PARAMETERS, width: 204, lightDiameter: 44 })
    expect(deriveLighting(restored).sources).toHaveLength(1)
    expect(deriveLighting(restored).sources[0].kind).toBe('led')
  })

  it('defaults only missing new settings and preserves individually supplied settings', () => {
    const partial: Record<string, unknown> = { ...DEFAULT_PARAMETERS, lightSource: 'two-bulbs', bulbHeight: 18 }
    delete partial.lightTemperature
    delete partial.secondBulbHeight
    expect(parseDesign(JSON.stringify({ schemaVersion: 1, parameters: partial }))).toEqual({ ...DEFAULT_PARAMETERS, lightSource: 'two-bulbs', bulbHeight: 18 })
    delete partial.width
    expect(() => parseDesign(JSON.stringify({ schemaVersion: 1, parameters: partial }))).toThrow(/width/)
  })

  it('adds ceiling defaults to a saved design without changing its lamp settings', () => {
    const oldParameters: Record<string, unknown> = { ...DEFAULT_PARAMETERS, lightSource: 'bulb', lightTemperature: 2200, bulbHeight: 72 }
    delete oldParameters.ceilingLightTemperature
    delete oldParameters.ceilingLightIntensity
    expect(parseDesign(JSON.stringify({ schemaVersion: 1, parameters: oldParameters }))).toEqual({
      ...oldParameters, ceilingLightTemperature: 4000, ceilingLightIntensity: 100,
    })
  })

  it('round trips bulb placements, independent lamp and ceiling warmth, intensity, and inactive source dimensions', () => {
    const parameters: LampParameters = { ...DEFAULT_PARAMETERS, lightSource: 'two-bulbs', lightTemperature: 4800, ceilingLightTemperature: 2200, ceilingLightIntensity: 45, lightDiameter: 26, bulbDiameter: 75, bulbHeight: 12, secondBulbHeight: 83 }
    expect(parseDesign(serializeDesign(parameters))).toEqual(parameters)
  })

  it.each([
    { lightSource: 'fluorescent' }, { lightSource: null }, { lightTemperature: '2700' },
    { lightTemperature: null }, { lightTemperature: 1799 }, { lightTemperature: 6501 },
    { bulbDiameter: 0 }, { bulbDiameter: -1 }, { bulbDiameter: 10001 },
    { bulbHeight: -1 }, { bulbHeight: 101 }, { secondBulbHeight: -1 }, { secondBulbHeight: 101 },
    { ceilingLightTemperature: '4000' }, { ceilingLightTemperature: null }, { ceilingLightTemperature: 1799 }, { ceilingLightTemperature: 6501 },
    { ceilingLightIntensity: '100' }, { ceilingLightIntensity: null }, { ceilingLightIntensity: -1 }, { ceilingLightIntensity: 201 },
  ])('rejects explicit invalid settings instead of replacing them: %j', change => {
    expect(() => parseDesign(JSON.stringify({ schemaVersion: 1, parameters: { ...DEFAULT_PARAMETERS, ...change } }))).toThrow()
  })

  it('accepts the full placement and temperature ranges', () => {
    for (const lightTemperature of [1800, 6500]) {
      for (const ceilingLightIntensity of [0, 200]) {
        const p = { ...DEFAULT_PARAMETERS, bulbHeight: 0, secondBulbHeight: 100, lightTemperature, ceilingLightTemperature: lightTemperature, ceilingLightIntensity }
        expect(parseDesign(serializeDesign(p))).toEqual(p)
      }
    }
  })

  it('rejects non-finite ceiling settings before generating geometry', () => {
    for (const field of ['ceilingLightTemperature', 'ceilingLightIntensity'] as const) {
      for (const value of [NaN, Infinity, -Infinity]) {
        expect(validateLamp({ ...DEFAULT_PARAMETERS, [field]: value })).toEqual([
          expect.objectContaining({ id: 'finite', status: 'error' }),
        ])
      }
    }
  })
})

describe('light appearance and placement', () => {
  it('moves smoothly from amber to a cool white without changing the source dimensions', () => {
    const channel = (color: string, offset: number) => parseInt(color.slice(offset, offset + 2), 16)
    const temperatures = [1800, 2700, 4000, 6500]
    const colors = temperatures.map(lightTemperatureColor)
    colors.forEach(color => expect(color).toMatch(/^#[0-9a-f]{6}$/))
    const blue = colors.map(color => channel(color, 5))
    expect(blue).toEqual([...blue].sort((a, b) => a - b))
    expect(channel(colors[0], 1)).toBeGreaterThan(channel(colors[0], 5))
    expect(channel(colors[3], 5)).toBeGreaterThan(channel(colors[3], 1))
    expect(lightTemperatureColor(4500)).not.toBe(lightTemperatureColor(4000))
    expect(deriveLighting({ ...DEFAULT_PARAMETERS, lightTemperature: 1800 }).sources).toEqual(deriveLighting({ ...DEFAULT_PARAMETERS, lightTemperature: 6500 }).sources)
  })

  it('retains the LED column and its own diameter when switching back from bulbs', () => {
    const parameters = { ...DEFAULT_PARAMETERS, lightDiameter: 32, bulbDiameter: 75 }
    expect(effectiveLightDiameter(parameters)).toBe(32)
    expect(effectiveLightDiameter({ ...parameters, lightSource: 'bulb' })).toBe(75)
    expect(effectiveLightDiameter({ ...parameters, lightSource: 'two-bulbs' })).toBe(75)
    const mount = deriveMounting(parameters)
    const light = deriveLighting(parameters)
    expect(light.sources).toHaveLength(1)
    expect(light.sources[0]).toEqual({ id: 'led', kind: 'led', centerY: mount.lowerY + mount.displayHeight / 2, diameter: 32, height: mount.displayHeight * 0.86, positionPercent: 50 })
  })

  it('places each full-size bulb inside the shade and clear of the end-clamp plates at either travel limit', () => {
    const p: LampParameters = { ...DEFAULT_PARAMETERS, lightSource: 'two-bulbs', bulbHeight: 0, secondBulbHeight: 100 }
    const mount = deriveMounting(p)
    const light = deriveLighting(p)
    const [bottom, top] = light.sources
    expect(light.sources).toHaveLength(2)
    expect(light.shadeBottom).toBe(mount.lowerY)
    expect(bottom.centerY - bottom.height / 2).toBeGreaterThanOrEqual(mount.lowerY + MOUNTING.plateThickness)
    expect(top.centerY + top.height / 2).toBeLessThanOrEqual(mount.upperY - MOUNTING.plateThickness)
    expect(light.fitsVertically).toBe(true)
    expect(light.bulbsOverlap).toBe(false)
    const centered = deriveLighting({ ...p, lightSource: 'bulb', bulbHeight: 50 }).sources[0]
    expect(centered.centerY).toBe((mount.lowerY + mount.upperY) / 2)
  })

  it('moves either bulb independently and identifies coincident bulbs', () => {
    const p: LampParameters = { ...DEFAULT_PARAMETERS, lightSource: 'two-bulbs', bulbHeight: 10, secondBulbHeight: 90 }
    const initial = deriveLighting(p)
    const moveFirst = deriveLighting({ ...p, bulbHeight: 20 })
    expect(moveFirst.sources[0].centerY).toBeGreaterThan(initial.sources[0].centerY)
    expect(moveFirst.sources[1]).toEqual(initial.sources[1])
    const moveSecond = deriveLighting({ ...p, secondBulbHeight: 80 })
    expect(moveSecond.sources[0]).toEqual(initial.sources[0])
    expect(moveSecond.sources[1].centerY).toBeLessThan(initial.sources[1].centerY)
    expect(deriveLighting({ ...p, secondBulbHeight: 10 }).bulbsOverlap).toBe(true)
  })

  it('retains bulb identities across crossing, coincident heights and source switches', () => {
    const p: LampParameters = { ...DEFAULT_PARAMETERS, lightSource: 'two-bulbs', bulbHeight: 10, secondBulbHeight: 90 }
    const ids = deriveLighting(p).sources.map(source => source.id)
    expect(new Set(ids).size).toBe(2)
    for (const heights of [{ bulbHeight: 90, secondBulbHeight: 10 }, { bulbHeight: 50, secondBulbHeight: 50 }]) {
      expect(deriveLighting({ ...p, ...heights }).sources.map(source => source.id)).toEqual(ids)
    }
    expect(deriveLighting({ ...p, lightSource: 'bulb' }).sources[0].id).toBe(ids[0])
    expect(deriveLighting({ ...p, lightSource: 'led' }).sources[0].id).not.toBe(ids[0])
  })

  it('keeps actual bulb hardware size when a compressed shade is too short', () => {
    const expanded: LampParameters = { ...DEFAULT_PARAMETERS, lightSource: 'two-bulbs', bulbHeight: 0, secondBulbHeight: 100 }
    const compressed = { ...expanded, expansion: 0 }
    const before = deriveLighting(expanded), after = deriveLighting(compressed)
    const mount = deriveMounting(compressed)
    expect(after.fitsVertically).toBe(false)
    expect(after.bulbsOverlap).toBe(true)
    after.sources.forEach((source, index) => {
      expect(source.height).toBe(before.sources[index].height)
      expect(source.diameter).toBe(before.sources[index].diameter)
      expect(source.centerY).toBe((mount.lowerY + mount.upperY) / 2)
    })
  })
})

describe('light clearance and manufacturing', () => {
  it.each(['bulb', 'two-bulbs'] as const)('checks the selected %s diameter and preserves hardware when correcting the opening', lightSource => {
    const p = { ...DEFAULT_PARAMETERS, lightSource, bulbDiameter: 150, lightDiameter: 20, bulbHeight: 8, secondBulbHeight: 91, lightTemperature: 4200 }
    for (const id of ['light-clearance', 'mounting-clearance']) {
      expect(validateLamp(p)).toContainEqual(expect.objectContaining({ id, status: 'error' }))
      const corrected = getPrintabilityFix(p, id)!.parameters
      expect(corrected).toBeDefined()
      expect(validateLamp(corrected)).toContainEqual(expect.objectContaining({ id, status: 'pass' }))
      for (const key of [...lightingFields, 'lightDiameter', 'lightClearance'] as const) expect(corrected[key]).toBe(p[key])
    }
    const led = { ...p, lightSource: 'led' as const }
    expect(validateLamp(led)).toContainEqual(expect.objectContaining({ id: 'light-clearance', status: 'pass' }))
    expect(validateLamp(led)).toContainEqual(expect.objectContaining({ id: 'mounting-clearance', status: 'pass' }))
  })

  it('never shrinks a bulb or its clearance to manufacture a correction', () => {
    const p: LampParameters = { ...DEFAULT_PARAMETERS, lightSource: 'bulb', bulbDiameter: 300 }
    expect(getPrintabilityFix(p, 'mounting-clearance')).toBeUndefined()
  })

  it('leaves all print vertices and triangles unchanged by source, placement, warmth, and ceiling light', () => {
    const p = { ...DEFAULT_PARAMETERS, pleats: 4 }
    const a = buildManufacturingGeometry(p)
    const b = buildManufacturingGeometry({ ...p, lightSource: 'two-bulbs', lightTemperature: 6500, ceilingLightTemperature: 1800, ceilingLightIntensity: 0, bulbHeight: 0, secondBulbHeight: 100, bulbDiameter: 80 })
    try {
      for (const key of ['tpu', 'pla'] as const) {
        expect(b[key].getAttribute('position').array).toEqual(a[key].getAttribute('position').array)
        expect(b[key].getIndex()!.array).toEqual(a[key].getIndex()!.array)
      }
    } finally {
      Object.values(a).forEach(geometry => geometry.dispose())
      Object.values(b).forEach(geometry => geometry.dispose())
    }
  })
})
