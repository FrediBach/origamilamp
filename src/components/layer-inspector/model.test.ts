import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMETERS, deriveLamp, type LampParameters } from '@/lib/lamp'
import { deriveLayerView, findTextSection, sectionIntervals, type TextLayout } from './model'

function view(p: LampParameters, layer: number, textLayout: TextLayout = []) {
  return deriveLayerView(p, deriveLamp(p), layer, textLayout, findTextSection(p, textLayout))
}

const parameters: LampParameters = { ...DEFAULT_PARAMETERS, pleats: 4, tpuLayers: 3, separatorLayers: 2 }

describe('layer inspector model', () => {
  it('transitions from membranes to alternating joins without adding a terminal separator', () => {
    expect(view(parameters, 0).layerKind).toBe('Full TPU membrane')
    expect(view(parameters, 2).membrane).toBe(true)
    expect(view(parameters, 3).layerKind).toBe('Outer join + PLA separator')
    expect(view(parameters, 5).layerKind).toBe('Full TPU membrane')
    expect(view(parameters, 8).layerKind).toBe('Inner join + PLA separator')
    const last = view(parameters, 10_000)
    expect(last.totalLayers).toBe(38)
    expect(last.layer).toBe(37)
    expect(last.sheet).toBe(7)
    expect(last.membrane).toBe(true)
    expect(last.startSheet).toBe(2)
  })

  it('keeps the selected layer within the displayed section as the schedule shrinks', () => {
    const shortened = { ...parameters, pleats: 2 }
    const last = view(shortened, 37)
    expect(last.layer).toBe(17)
    expect(last.shownSheets).toBe(4)
    expect(last.startSheet).toBe(0)
    expect(last.activeY).toBe(last.sectionBottom - 18 * last.layerPx)
  })

  it('distinguishes top and bottom recess layers from their continuous membranes', () => {
    const p: LampParameters = { ...parameters, cutoutPattern: 'triangles', cutoutEvery: 1, cutoutLayers: 1 }
    expect(view(p, 0).topPatternSheet).toBe(1)
    expect(view(p, 0).bottomPatternSheet).toBe(2)
    expect(view(p, 5).recessedLayer).toBe(false)
    expect(view(p, 6).recessedLayer).toBe(true)
    expect(view(p, 6).footprintDescription).toContain('separator above')
    expect(view(p, 10).recessedLayer).toBe(true)
    expect(view(p, 10).footprintDescription).toContain('separator below')
    expect(view(p, 12).recessedLayer).toBe(false)
    expect(view(p, 37).patternedSheet).toBe(false)
  })

  it('shows accent material only on its membrane and chooses the largest text sheet', () => {
    const small: [number, number][] = [[-2, -80], [2, -80], [2, -78], [-2, -78]]
    const large: [number, number][] = [[-4, -80], [4, -80], [4, -76], [-4, -76]]
    const layout: TextLayout = [[], [small], [large]]
    const p = { ...parameters, textEnabled: true }
    expect(findTextSection(p, layout).sheet).toBe(2)
    expect(findTextSection(p, []).fraction).toBeNull()
    expect(view(p, 10, layout).layerKind).toBe('Two-color TPU membrane')
    expect(view(p, 13, layout).accent).toEqual([])
    expect(view(p, 13, layout).hasAccent).toBe(false)
  })

  it('clips and merges overlapping accent intervals along the fixed radial section', () => {
    const rectangle = (from: number, to: number): [number, number][] => [[from, -1], [to, -1], [to, 1], [from, 1]]
    expect(sectionIntervals([rectangle(-2, 3), rectangle(2, 5), rectangle(7, 12)], [0, 0], [10, 0]))
      .toEqual([[0, 0.5], [0.7, 1]])
    expect(sectionIntervals([rectangle(20, 30)], [0, 0], [10, 0])).toEqual([])
  })
})
