import { LayerDetails } from './layer-inspector/details'
import { LayerSection } from './layer-inspector/section'
import { LayerFootprint } from './layer-inspector/footprint'
import { LayerNavigation } from './layer-inspector/navigation'
import { deriveLayerView, findTextSection } from './layer-inspector/model'
import { useId, useMemo, useState } from 'react'
import { Layers3 } from 'lucide-react'
import { deriveLamp, validateLamp, type LampParameters } from '@/lib/lamp'
import { TEXT_COLORS, textPolygons } from '@/lib/text-projection'
import { mm } from './layer-inspector/model'
import { TPU, PLA } from './layer-inspector/colors'

import './layer-inspector.css'

const BLOCKING_CHECKS = new Set(['finite', 'dimensions', 'layers', 'contours', 'free-span', 'connectors', 'layer-height', 'values', 'cutout-range', 'cutout-thickness', 'cutout-sheets', 'cutout-web', 'text-range', 'text-content', 'text-sheets'])

export function LayerInspector({ parameters: p }: { parameters: LampParameters }) {
  const id = useId()
  const [requestedLayer, setRequestedLayer] = useState(0)
  const d = deriveLamp(p)
  const errors = validateLamp(p).filter(item => item.status === 'error' &&
    BLOCKING_CHECKS.has(item.id))
  const textLayout = useMemo(() => {
    if (!p.textEnabled || errors.length || p.shape === 'polygon') return []
    return Array.from({ length: d.sheets }, (_, sheet) => textPolygons(p, sheet))
  }, [p, d.sheets, errors.length])
  const textSection = useMemo(() => findTextSection(p, textLayout), [p, textLayout])
  const textColor = TEXT_COLORS[p.textColor]

  if (errors.length) {
    return <div className="layer-inspector li-invalid" role="status">
      <Layers3 size={28} aria-hidden="true" />
      <h3>Adjust the print geometry first</h3>
      <p>The layer inspector needs a valid layer schedule and open, non-overlapping contour offsets.</p>
      <ul>{errors.map(error => <li key={error.id}>{error.detail}</li>)}</ul>
    </div>
  }

  const model = deriveLayerView(p, d, requestedLayer, textLayout, textSection)
  const { layer, layerKind } = model

  return <div className="layer-inspector">
    <div className="li-summary">
      <div>
        <span className="li-eyebrow">Compressed print · {d.sheets} membranes</span>
        <h3>{layerKind}</h3>
      </div>
      <span className="li-z">Z {mm(layer * p.layerHeight)}–{mm((layer + 1) * p.layerHeight)}</span>
    </div>

    <LayerNavigation id={id} model={model} onSelect={setRequestedLayer} />
    <div className="li-diagrams">
      <LayerFootprint id={id} model={model} />

      <LayerSection id={id} model={model} />
    </div>

    <div className="li-legend" aria-label="Material legend">
      <span><i style={{ background: TPU }} aria-hidden="true" />TPU · permanent shade</span>
      {p.textEnabled && <span><i style={{ background: textColor.hex }} aria-hidden="true" />{textColor.name} TPU · text accent</span>}
      <span><i style={{ background: PLA }} aria-hidden="true" />PLA · removable separator</span>
      <span><i className="li-selected-swatch" aria-hidden="true" />Selected layer</span>
    </div>

    <LayerDetails model={model} />
    <p className="li-note">Nominal material layout · {mm(d.compressedHeight)} compressed height · use the same first-layer height. Separator release and folding still require a calibration print.</p>
  </div>
}
