import { describe, expect, it } from 'vitest'
import { sampleLightFlicker } from './light-flicker'

const samples = (amount: number, count = 120 * 60, startTime = 0) => Array.from({ length: count }, (_, index) => sampleLightFlicker(startTime + index / 60, amount))

const range = (values: number[]) => Math.max(...values) - Math.min(...values)

function standardDeviation(values: number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
}

describe('bulb flicker', () => {
  it('is exactly steady when switched off, at any time', () => {
    for (const time of [-1000, 0, 0.123, 23, 100000, Infinity, NaN]) {
      expect(sampleLightFlicker(time, 0)).toBe(1)
    }
  })

  it('supports deep dimming without blackouts or bright flashes', () => {
    for (const amount of [1, 25, 50, 100]) {
      const values = samples(amount, 600 * 60)
      expect(Math.min(...values)).toBeGreaterThanOrEqual(0.17)
      expect(Math.max(...values)).toBeLessThanOrEqual(1.03)
    }
  })

  it('shows a substantial change within the first two seconds at full strength', () => {
    expect(range(samples(100, 2 * 60 + 1))).toBeGreaterThan(0.5)
  })

  it('keeps changing visibly in every three-second window, including long sessions', () => {
    for (const startTime of [0, 3600, 86400]) {
      const values = samples(100, 120 * 60, startTime)
      let smallestRange = Infinity
      for (let start = 0; start + 3 * 60 < values.length; start++) {
        smallestRange = Math.min(smallestRange, range(values.slice(start, start + 3 * 60 + 1)))
      }
      expect(smallestRange).toBeGreaterThan(0.35)
    }
  })

  it('is deterministic regardless of the sequence or rate of samples', () => {
    const time = 13.571
    const expected = sampleLightFlicker(time, 70)
    samples(30)
    expect(sampleLightFlicker(time, 70)).toBe(expected)
    const at30fps = Array.from({ length: 300 }, (_, index) => sampleLightFlicker(index / 30, 100))
    const at60fps = samples(100, 600).filter((_, index) => index % 2 === 0)
    expect(at30fps).toEqual(at60fps)
  })

  it('smooths every frame and remains continuous across its noise boundaries', () => {
    const values = samples(100)
    const frameChanges = values.slice(1).map((value, index) => Math.abs(value - values[index]))
    expect(Math.max(...frameChanges)).toBeLessThan(0.065)
    for (let index = 0; index < 500; index++) {
      const time = index / 7
      expect(Math.abs(sampleLightFlicker(time + 0.000001, 100) - sampleLightFlicker(time - 0.000001, 100))).toBeLessThan(0.00001)
    }
  })

  it('increases variation smoothly with the single amount control', () => {
    const low = standardDeviation(samples(25))
    const middle = standardDeviation(samples(50))
    const high = standardDeviation(samples(100))
    expect(low).toBeGreaterThan(0.005)
    expect(middle).toBeGreaterThan(low * 1.5)
    expect(high).toBeGreaterThan(middle * 1.5)
    expect(high).toBeGreaterThan(0.2)
    expect(high).toBeLessThan(0.3)
    expect(Math.min(...samples(50))).toBeGreaterThan(0.58)
    expect(Math.abs(sampleLightFlicker(14, 50) - sampleLightFlicker(14, 50.001))).toBeLessThan(0.0001)
  })

  it('does not settle into a regular repeating pulse', () => {
    const values = samples(100)
    const deviation = standardDeviation(values)
    for (const periodSeconds of [0.6, 1, 1.2, 1.5, 2, 3, 4, 5, 8, 10, 15, 20]) {
      const lag = periodSeconds * 60
      const differences = values.slice(lag).map((value, index) => value - values[index])
      expect(standardDeviation(differences)).toBeGreaterThan(deviation * 0.7)
    }
  })

  it('changes only strength when adjusted, even after a long running session', () => {
    for (const time of [0, 14, 600, 3600, 86400]) {
      const fullDeviation = sampleLightFlicker(time, 100) - 1
      for (const amount of [1, 25, 50, 99]) {
        expect(sampleLightFlicker(time, amount) - 1).toBeCloseTo(fullDeviation * amount / 100, 12)
        expect(Math.abs(sampleLightFlicker(time, amount + 1) - sampleLightFlicker(time, amount))).toBeLessThan(0.0084)
      }
    }
  })

  it('clamps the amount and safely ignores non-finite input', () => {
    expect(sampleLightFlicker(10, -10)).toBe(1)
    expect(sampleLightFlicker(10, 150)).toBe(sampleLightFlicker(10, 100))
    expect(sampleLightFlicker(NaN, 50)).toBe(1)
    expect(sampleLightFlicker(Infinity, 50)).toBe(1)
    expect(sampleLightFlicker(10, NaN)).toBe(1)
  })
})
