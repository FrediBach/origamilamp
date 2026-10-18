import { describe, expect, it } from 'vitest'
import { committedParameterValue, liveParameterValue } from './parameter-value'

describe('numeric parameter drafts', () => {
  it.each(['', ' ', '-', '1e', 'NaN', 'Infinity'])('keeps the applied value for an incomplete draft %j', draft => {
    expect(liveParameterValue(draft, 0, 100, 1)).toBeNull()
    expect(committedParameterValue(draft, 0, 100, 1)).toBeNull()
  })

  it('applies aligned fractional steps despite floating point noise', () => {
    expect(liveParameterValue('0.3', 0.1, 0.8, 0.1)).toBe(0.3)
    expect(liveParameterValue('0.35', 0.1, 0.8, 0.1)).toBeNull()
    expect(committedParameterValue('0.36', 0.1, 0.8, 0.1)).toBe(0.4)
  })

  it('clamps drafts only on commit and rounds relative to the actual lower bound', () => {
    expect(liveParameterValue('-20', -10, 25, 5)).toBeNull()
    expect(liveParameterValue('30', -10, 25, 5)).toBeNull()
    expect(committedParameterValue('-20', -10, 25, 5)).toBe(-10)
    expect(committedParameterValue('30', -10, 25, 5)).toBe(25)
    expect(committedParameterValue('4', 2, 20, 3)).toBe(5)
    expect(liveParameterValue('0', -10, 25, 5)).toBe(0)
  })
})
