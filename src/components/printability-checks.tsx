import { useMemo, useRef, useState } from 'react'
import { CircleCheck, RotateCcw, TriangleAlert, WandSparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getPrintabilityFix } from '@/lib/printability-fixes'
import type { Diagnostic, LampParameters } from '@/lib/lamp'
import { cn } from '@/lib/utils'

interface PrintabilityChecksProps {
  parameters: LampParameters
  diagnostics: Diagnostic[]
  onCorrect: (parameters: LampParameters) => void
}

export function PrintabilityChecks({ parameters, diagnostics, onCorrect }: PrintabilityChecksProps) {
  const [correction, setCorrection] = useState<{ before: LampParameters; after: LampParameters } | null>(null)
  const [message, setMessage] = useState('')
  const feedback = useRef<HTMLDivElement>(null)
  const fixes = useMemo(() => new Map(diagnostics
    .filter(diagnostic => diagnostic.status !== 'pass')
    .map(diagnostic => [diagnostic.id, getPrintabilityFix(parameters, diagnostic.id)])), [parameters, diagnostics])
  const canUndo = correction && parameters === correction.after

  function correct(id: string) {
    const fix = getPrintabilityFix(parameters, id)
    if (!fix) return
    setCorrection({ before: parameters, after: fix.parameters })
    setMessage(`Correction applied. ${fix.detail}`)
    onCorrect(fix.parameters)
    // The action disappears when its check passes; keep keyboard focus in the dialog.
    requestAnimationFrame(() => feedback.current?.focus())
  }

  function undo() {
    if (!canUndo) return
    onCorrect(correction.before)
    setCorrection(null)
    setMessage('Correction undone. Your previous settings are restored.')
    requestAnimationFrame(() => feedback.current?.focus())
  }

  return <>
    <div ref={feedback} className="check-feedback" role="status" tabIndex={-1} aria-atomic="true">
      {message && <><p>{message}</p>{canUndo && <Button variant="ghost" size="sm" onClick={undo}><RotateCcw size={14} />Undo correction</Button>}</>}
    </div>
    <div className="checks-list">
      {diagnostics.map(diagnostic => {
        const fix = fixes.get(diagnostic.id)
        return <div className={cn('check-row', `check-${diagnostic.status}`)} key={diagnostic.id}>
          {diagnostic.status === 'pass' ? <CircleCheck size={18} /> : <TriangleAlert size={18} />}
          <div className="check-content">
            <h3>{diagnostic.title}</h3>
            <p>{diagnostic.detail}</p>
            {fix && <div className="check-correction">
              <p id={`fix-${diagnostic.id}`}>{fix.detail}</p>
              <Button variant="outline" size="sm" aria-describedby={`fix-${diagnostic.id}`} onClick={() => correct(diagnostic.id)}><WandSparkles size={14} />{fix.label}</Button>
            </div>}
          </div>
        </div>
      })}
    </div>
  </>
}
