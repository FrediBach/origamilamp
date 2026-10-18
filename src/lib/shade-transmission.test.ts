import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMETERS, type LampParameters, type LightSource } from './lamp'
import { deriveLighting } from './lighting'
import { deriveShadeTransmission, luminousCenter, pendantIndex, sampleShadeGlow, shadeGlowInputs } from './shade-transmission'

const sample = (p: LampParameters, count = 129) => sampleShadeGlow(p, deriveLighting(p), count)
const maximumIndex = (values: number[]) => values.indexOf(Math.max(...values))

describe('shade transmission', () => {
  it('spreads a centred bulb softly toward the ends instead of leaving a tight bright spot', () => {
    const p: LampParameters = { ...DEFAULT_PARAMETERS, lightSource: 'bulb', bulbHeight: 50 }
    const values = sample(p)
    const { radialDistance } = deriveShadeTransmission(p)
    const source = deriveLighting(p).sources[0]
    const distanceToBottom = luminousCenter(source, false) - deriveLighting(p).shadeBottom
    const previousNormalizedTail = radialDistance ** 2 / (radialDistance ** 2 + distanceToBottom ** 2)
    const normalizedTail = values[0] / Math.max(...values)
    expect(normalizedTail).toBeGreaterThan(previousNormalizedTail * 3)
    expect(normalizedTail).toBeLessThan(0.8)
    expect(Math.max(...values.slice(1).map((value, index) => Math.abs(value - values[index])))).toBeLessThan(0.02)
  })

  it.each(['led', 'bulb', 'two-bulbs'] as LightSource[])('makes thinner TPU brighter across the entire %s shade without clipping', lightSource => {
    const p: LampParameters = { ...DEFAULT_PARAMETERS, lightSource, bulbHeight: 25, secondBulbHeight: 75 }
    const thin = sample({ ...p, tpuLayers: 1 })
    const thick = sample({ ...p, tpuLayers: 4 })
    thin.forEach((value, index) => {
      expect(value).toBeGreaterThan(thick[index])
      expect(value).toBeLessThan(1)
      expect(thick[index]).toBeGreaterThan(0)
    })
    expect(new Set(thin).size).toBeGreaterThan(thin.length / 2)
  })

  it('attenuates the far glow more than the peak as TPU gets thicker', () => {
    const p: LampParameters = { ...DEFAULT_PARAMETERS, lightSource: 'bulb', bulbHeight: 50 }
    const thin = sample({ ...p, tpuLayers: 1 })
    const thick = sample({ ...p, tpuLayers: 4 })
    expect(thick[0] / Math.max(...thick)).toBeLessThan(thin[0] / Math.max(...thin))
  })

  it('uses physical TPU thickness independently of layer count or removed PLA', () => {
    const p: LampParameters = { ...DEFAULT_PARAMETERS, lightSource: 'two-bulbs' }
    const equivalent = { ...p, layerHeight: 0.1, tpuLayers: 4 }
    const moreSeparators = { ...p, separatorLayers: 10 }
    expect(deriveShadeTransmission(equivalent)).toEqual(deriveShadeTransmission(p))
    expect(sample(equivalent)).toEqual(sample(p))
    expect(deriveShadeTransmission(moreSeparators)).toEqual(deriveShadeTransmission(p))
    expect(sample(moreSeparators)).toEqual(sample(p))
    expect(deriveShadeTransmission({ ...p, bandWidth: 30 }).thickness).toBe(0.4)
  })

  it('moves the glow with bulb height and follows the luminous envelope orientation', () => {
    const p: LampParameters = { ...DEFAULT_PARAMETERS, lightSource: 'bulb' }
    expect(maximumIndex(sample({ ...p, bulbHeight: 0 }))).toBeLessThan(maximumIndex(sample({ ...p, bulbHeight: 100 })))
    const two: LampParameters = { ...p, lightSource: 'two-bulbs', bulbHeight: 20, secondBulbHeight: 80 }
    const { sources } = deriveLighting(two)
    expect(pendantIndex(sources)).toBe(1)
    expect(luminousCenter(sources[0], false)).toBeGreaterThan(sources[0].centerY)
    expect(luminousCenter(sources[1], true)).toBeLessThan(sources[1].centerY)
    expect(pendantIndex([...sources].reverse())).toBe(0)
    expect(sample({ ...two, bulbHeight: 80, secondBulbHeight: 20 })).toEqual(sample(two))
    const values = sample(two)
    values.forEach((value, index) => expect(value).toBeCloseTo(values[values.length - 1 - index], 12))
    expect(pendantIndex(deriveLighting(p).sources)).toBe(-1)
  })

  it('keeps valid thin, thick, compressed, tall, and overlapping-source previews finite and bounded', () => {
    const extremes: Partial<LampParameters>[] = [
      { layerHeight: 0.08, tpuLayers: 1 },
      { layerHeight: 0.4, tpuLayers: 20 },
      { expansion: 0, bulbDiameter: 10000 },
      { width: 10000, depth: 10000, height: 10000 },
      { width: 60, depth: 60, bandWidth: 20, height: 10000 },
      { bulbHeight: 50, secondBulbHeight: 50 },
    ]
    for (const lightSource of ['led', 'bulb', 'two-bulbs'] as const) {
      for (const changes of extremes) {
        sample({ ...DEFAULT_PARAMETERS, lightSource, ...changes }).forEach(value => {
          expect(Number.isFinite(value)).toBe(true)
          expect(value).toBeGreaterThanOrEqual(0)
          expect(value).toBeLessThan(1)
        })
      }
    }
  })
})

describe('glow texture dependencies', () => {
  const inputs = (p: LampParameters, layers = p.tpuLayers) => shadeGlowInputs(p, deriveLighting(p), layers)

  it('reuses optical inputs when only power, warmth, pigment or wood changes', () => {
    const p = { ...DEFAULT_PARAMETERS }
    expect(inputs({ ...p, lightIntensity: 25, lightTemperature: 6500, lightFlicker: 50, textColor: 'brown', frameWood: 'walnut' })).toEqual(inputs(p))
  })

  it('changes optical inputs for bulb movement, geometry and thin-membrane thickness', () => {
    const p: LampParameters = { ...DEFAULT_PARAMETERS, lightSource: 'bulb', bulbHeight: 20 }
    expect(inputs({ ...p, bulbHeight: 80 })).not.toEqual(inputs(p))
    expect(inputs({ ...p, width: p.width + 20, depth: p.depth + 20 })).not.toEqual(inputs(p))
    expect(inputs(p, 1).thickness).toBe(p.layerHeight)
    expect(inputs(p, 2).thickness).toBe(p.layerHeight * 2)
  })
})
