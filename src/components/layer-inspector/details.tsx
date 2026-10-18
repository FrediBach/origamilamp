import { cutoutPhaseAt } from '@/lib/cutout-patterns'
import type { LayerView } from './model'

export function LayerDetails({ model }: { model: LayerView }) {
  const { p, d, textColor, sheet, membrane, patternedSheet, hasAccent, detail, skippedPatternSheet } = model
  return <div className="li-detail" aria-live="polite" aria-atomic="true">
    <strong>{membrane ? `Membrane ${sheet + 1} of ${d.sheets}` : `Gap ${sheet + 1} of ${d.separators} · membranes ${sheet + 1} and ${sheet + 2}`}</strong>
    {p.textEnabled && <p className="li-text-detail">{hasAccent ? `${textColor.name} TPU forms the text within this membrane. The accent replaces base TPU at the same layer height; both joining rims keep their original TPU.` : membrane ? 'The projected text does not intersect this membrane.' : 'Joining rims keep the original TPU. The text accent is confined to the membranes between these rims.'}</p>}
    {membrane && patternedSheet && <p>Pattern phase: {Number((cutoutPhaseAt(p, sheet) * 100).toFixed(2))}% of one repeat.</p>}
    {skippedPatternSheet && <p>This membrane is skipped by the pattern interval of {p.cutoutEvery} membranes.</p>}
    <p>{detail}</p>
  </div>
}
