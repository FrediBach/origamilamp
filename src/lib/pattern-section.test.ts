import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMETERS } from './lamp'
import { patternSectionIntervals } from './pattern-section'

describe('manufacturing pattern section', () => {
  it.each([2, 3, 24])('leaves skipped membranes full thickness at interval %i', cutoutEvery => {
    const p = { ...DEFAULT_PARAMETERS, pleats: 4, shape: 'circle' as const, cutoutPattern: 'half-circles' as const, cutoutCount: 5, cutoutEvery }
    for (let sheet = 0; sheet < p.pleats * 2; sheet++) {
      const selected = sheet > 0 && sheet < p.pleats * 2 - 1 && (sheet - 1) % cutoutEvery === 0
      expect(patternSectionIntervals(p, sheet)).toHaveLength(selected ? 1 : 0)
    }
  })

  it.each(['triangles', 'half-circles', 'rectangles'] as const)('keeps both membrane faces open only to the outside for %s', cutoutPattern => {
    // An odd repeat count puts a pattern centre at -X but no pattern at +X.
    const p = { ...DEFAULT_PARAMETERS, shape: 'circle' as const, cutoutPattern, cutoutCount: 5 }
    const outside = patternSectionIntervals(p, 1)
    const oppositeFace = patternSectionIntervals(p, 2)
    expect(outside).toHaveLength(1)
    expect(oppositeFace).toHaveLength(1)
    expect(outside[0][0]).toBeCloseTo(-90, 5)
    expect(outside[0][1]).toBeCloseTo(-90 + 22 * .55, 5)
    expect(oppositeFace).toEqual(outside)
    expect(oppositeFace[0][1]).toBeLessThan(-68)
    expect(patternSectionIntervals(p, 0)).toEqual([])
    expect(patternSectionIntervals(p, p.pleats * 2 - 1)).toEqual([])
  })
})
