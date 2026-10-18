import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMETERS } from './lamp'
import { textSectionIntervals } from './text-section'

describe('lettering section caps', () => {
  it.each(['circle', 'rounded-rectangle'] as const)('intersects the actual %s accent footprint and keeps joining bands clear', shape => {
    const p = { ...DEFAULT_PARAMETERS, shape, pleats: 4, height: 80, textEnabled: true, text: 'I', textSize: 60, textAzimuth: 90 }
    const expected = [p.width / 2 - p.bandWidth + p.innerConnector, p.width / 2 - p.outerConnector]
    const right = textSectionIntervals(p, 3)
    expect(right).toHaveLength(1)
    expect(right[0][0]).toBeCloseTo(expected[0], 4)
    expect(right[0][1]).toBeCloseTo(expected[1], 4)
    const left = textSectionIntervals({ ...p, textAzimuth: -90 }, 3)
    expect(left).toHaveLength(1)
    expect(left[0][0]).toBeCloseTo(-expected[1], 4)
    expect(left[0][1]).toBeCloseTo(-expected[0], 4)
    expect(textSectionIntervals(p, 0)).toEqual([])
    expect(textSectionIntervals({ ...p, textEnabled: false }, 3)).toEqual([])
  })
})
