import { Box, Layers3, PanelTop, SlidersHorizontal } from 'lucide-react'
import type { LampParameters } from '@/lib/lamp'
import { cn } from '@/lib/utils'
import type { ViewMode, Modal, DerivedLamp } from './types'

export function DesignSummary({ parameters, derived, view, setView, setModal }: {
  parameters: LampParameters
  derived: DerivedLamp
  view: ViewMode
  setView: (view: ViewMode) => void
  setModal: (modal: Modal) => void
}) {
  return <section className="design-summary" aria-label="Design dimensions and print views">
    <div className="summary-item"><span>FOOTPRINT</span><strong>{parameters.width} <span>×</span> {parameters.shape === 'circle' ? parameters.width : parameters.depth}<small>mm</small></strong></div>
    <div className="summary-item"><span>DISPLAY HEIGHT</span><strong>{Math.round(derived.displayHeight)}<small>mm</small></strong></div>
    <div className="summary-item"><span>COMPRESSED</span><strong>{derived.compressedHeight.toFixed(1)}<small>mm</small></strong></div>
    <div className="summary-item fold-summary"><span>FULL PLEATS</span><strong>{parameters.pleats}<small>{derived.sheets} sheets</small></strong></div>
    <div className="inspection-actions"><span>LOOK A LITTLE CLOSER</span><div>{([{ id: 'print', name: 'TPU', icon: Box }, { id: 'materials', name: 'Materials', icon: Layers3 }, { id: 'section', name: 'Section', icon: PanelTop }] as const).map(item => <button key={item.id} className={cn('inspection-button', view === item.id && 'active')} onClick={() => setView(item.id)} aria-pressed={view === item.id}><item.icon size={14} />{item.name}</button>)}<button className="inspection-button" onClick={() => setModal('layers')}><SlidersHorizontal size={14} />Layers</button></div></div>
  </section>
}
