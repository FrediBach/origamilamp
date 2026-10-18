import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMETERS } from './lamp'
import { deriveLighting } from './lighting'
import { lampEmissionSamples, LED_EMISSION_SAMPLES } from './light-emission'
import { luminousCenter } from './shade-transmission'

describe('finite light emitters', () => {
  it('integrates the LED along its physical length while conserving its total power', () => {
    const { sources } = deriveLighting(DEFAULT_PARAMETERS)
    const samples = lampEmissionSamples(sources), source = sources[0]
    expect(samples).toHaveLength(LED_EMISSION_SAMPLES)
    expect(samples.reduce((sum, sample) => sum + sample.powerShare, 0)).toBeCloseTo(1)
    expect(samples.reduce((sum, sample) => sum + sample.centerY * sample.powerShare, 0)).toBeCloseTo(source.centerY)
    expect(samples[0].centerY - samples[0].height / 2).toBeCloseTo(source.centerY - source.height / 2)
    expect(samples.at(-1)!.centerY + samples.at(-1)!.height / 2).toBeCloseTo(source.centerY + source.height / 2)
    for (let index = 1; index < samples.length; index++) expect(samples[index].centerY - samples[index - 1].centerY).toBeCloseTo(source.height / LED_EMISSION_SAMPLES)
  })

  it('keeps both bulb projections aligned with their luminous envelopes and pendant orientation', () => {
    const { sources } = deriveLighting({ ...DEFAULT_PARAMETERS, lightSource: 'two-bulbs', bulbHeight: 80, secondBulbHeight: 20 })
    const samples = lampEmissionSamples(sources)
    expect(samples).toHaveLength(2)
    expect(samples.map(sample => sample.powerShare)).toEqual([1, 1])
    expect(samples.map(sample => sample.inverted)).toEqual([true, false])
    expect(luminousCenter(samples[0], samples[0].inverted)).toBeLessThan(sources[0].centerY)
    expect(luminousCenter(samples[1], samples[1].inverted)).toBeGreaterThan(sources[1].centerY)
  })
})
