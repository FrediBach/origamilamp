import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cutoutRecessFace } from '@/lib/cutout-patterns'
import { mm, type LayerView } from './model'

export function LayerNavigation({ id, model, onSelect }: { id: string; model: LayerView; onSelect: (layer: number) => void }) {
  const { p, d, layer, totalLayers, layerKind, textSheet, stride, topPatternSheet, bottomPatternSheet } = model
  return <div className="li-layer-control">
    <div className="li-slider-label">
      <label htmlFor={`${id}-layer`}>Print layer <strong>{layer + 1}</strong><span> / {totalLayers}</span></label>
      <span>{mm(p.layerHeight)} per layer</span>
    </div>
    <div className="li-slider-row">
      <button type="button" className="li-step" aria-label="Previous print layer" disabled={layer === 0} onClick={() => onSelect(layer - 1)}><ChevronLeft size={17} aria-hidden="true" /></button>
      <input id={`${id}-layer`} type="range" min={0} max={totalLayers - 1} step={1} value={layer} onChange={event => onSelect(Number(event.target.value))} aria-valuetext={`Layer ${layer + 1} of ${totalLayers}. ${layerKind}. Z ${mm(layer * p.layerHeight)} to ${mm((layer + 1) * p.layerHeight)}.`} />
      <button type="button" className="li-step" aria-label="Next print layer" disabled={layer === totalLayers - 1} onClick={() => onSelect(layer + 1)}><ChevronRight size={17} aria-hidden="true" /></button>
    </div>
    <div className="li-jumps" aria-label="Example print layers">
      <span>Jump to</span>
      <button type="button" onClick={() => onSelect(0)}>Membrane</button>
      {textSheet >= 0 && <button type="button" onClick={() => onSelect(textSheet * stride + (cutoutRecessFace(p, textSheet) === 'bottom' ? p.tpuLayers - p.cutoutLayers : 0))}>Text accent</button>}
      {topPatternSheet !== undefined && <button type="button" onClick={() => onSelect(topPatternSheet * stride + p.cutoutLayers)}>Top pattern layer</button>}
      {bottomPatternSheet !== undefined && <button type="button" onClick={() => onSelect(bottomPatternSheet * stride)}>Bottom pattern layer</button>}
      <button type="button" onClick={() => onSelect(p.tpuLayers)}>Outer join</button>
      {d.separators > 1 && <button type="button" onClick={() => onSelect(stride + p.tpuLayers)}>Inner join</button>}
    </div>
  </div>
}
