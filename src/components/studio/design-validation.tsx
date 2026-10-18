import { ArrowRight, ArrowUpRight, CheckCheck, CircleHelp, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Modal } from './types'
import type { Diagnostic } from '@/lib/lamp'

export function DesignValidation({ diagnostics, experimental, setModal }: {
  diagnostics: Diagnostic[]
  experimental: boolean
  setModal: (modal: Modal) => void
}) {
  const errors = diagnostics.filter(d => d.status === 'error')
  const passed = diagnostics.filter(d => d.status === 'pass').length
  return <section className={cn('validation-bar', errors.length > 0 && 'has-errors')} aria-label="Live feasibility checks">
    <div className="validation-message"><span className="validation-icon">{errors.length ? <TriangleAlert size={20} /> : experimental ? <CircleHelp size={20} /> : <CheckCheck size={21} />}</span><div><h2>{errors.length ? `${errors.length} ${errors.length === 1 ? 'detail needs' : 'details need'} attention` : experimental ? 'A new form to explore' : 'A well-considered starting point'}</h2><p aria-live="polite" aria-atomic="true">{errors.length ? errors[0].title : experimental ? 'Appearance study · manufacturing export paused for this form' : `${passed} geometry checks passed · physical calibration still needed`}</p></div></div><button className="text-button" onClick={() => setModal('checks')}>View checks <ArrowUpRight size={14} /></button><div className="validation-divider" /><Button onClick={() => setModal('export')}>Prepare to make <ArrowRight size={16} /></Button>
  </section>
}
