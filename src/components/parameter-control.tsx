import { useId, useRef, useState } from 'react'
import { Slider } from '@/components/ui/slider'
import { committedParameterValue, liveParameterValue } from '@/lib/parameter-value'

interface ParameterControlProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (value: number) => void
  hint?: string
  disabled?: boolean
}

function useParameterBounds(value: number, min: number, max: number) {
  // Recipes can contain valid values beyond the studio's suggested range.
  // Retain an extended range while editing, so its scale does not move under
  // the thumb as an imported value is brought back toward the usual range.
  const [bounds, setBounds] = useState(() => ({ min, max, lower: Math.min(min, value), upper: Math.max(min, max, value) }))
  let lower = bounds.lower
  let upper = bounds.upper
  if (bounds.min !== min || bounds.max !== max || value < lower || value > upper) {
    const limitsChanged = bounds.min !== min || bounds.max !== max
    lower = Math.min(limitsChanged ? min : lower, value)
    upper = Math.max(limitsChanged ? Math.max(min, max) : upper, value)
    setBounds({ min, max, lower, upper })
  }
  return { lower, upper }
}

const ACCESSIBLE_UNITS: Record<string, string> = { mm: 'millimetres', '°': 'degrees', '%': 'percent', K: 'kelvin' }

export function ParameterControl({ label, value, min, max, step = 1, unit = 'mm', onChange, hint, disabled }: ParameterControlProps) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const skipBlurCommit = useRef(false)
  const { lower, upper } = useParameterBounds(value, min, max)
  const accessibleUnit = ACCESSIBLE_UNITS[unit] ?? unit
  const accessibleName = `${label}${accessibleUnit ? ` (${accessibleUnit})` : ''}`
  const commit = () => {
    const next = committedParameterValue(draft ?? '', lower, upper, step)
    if (next !== null && next !== value) onChange(next)
    setDraft(null)
  }
  return <div className="parameter-control" data-disabled={disabled || undefined}>
    <div className="parameter-heading">
      <label htmlFor={id}>{label}</label>
      <div className="number-field">
        <input id={id} type="number" inputMode="decimal" min={lower} max={upper} step={step} value={draft ?? value} disabled={disabled} aria-label={accessibleName}
          onChange={event => {
            const next = event.target.value
            setDraft(next)
            const applied = liveParameterValue(next, lower, upper, step)
            if (applied !== null) onChange(applied)
          }} onBlur={() => {
            if (skipBlurCommit.current) { skipBlurCommit.current = false; return }
            commit()
          }} onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
            if (event.key === 'Escape') { event.preventDefault(); skipBlurCommit.current = true; setDraft(null); event.currentTarget.blur() }
          }}
          aria-describedby={hint ? `${id}-hint` : undefined} />
        {unit && <span aria-hidden="true">{unit}</span>}
      </div>
    </div>
    <Slider aria-label={accessibleName} aria-describedby={hint ? `${id}-hint` : undefined} aria-valuetext={`${value}${accessibleUnit ? ` ${accessibleUnit}` : ''}`} value={[value]} min={lower} max={upper} step={step} disabled={disabled} onValueChange={([next]) => { setDraft(null); onChange(next) }} />
    {hint && <p id={`${id}-hint`} className="control-hint">{hint}</p>}
  </div>
}
