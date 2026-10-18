import { useId } from 'react'
import { ParameterControl } from '@/components/parameter-control'
import { Switch } from '@/components/ui/switch'
import type { LampParameters, TextColor } from '@/lib/lamp'
import { TEXT_COLORS as TEXT_PALETTE, textWrapMetrics } from '@/lib/text-projection'
import { cn } from '@/lib/utils'

export const TEXT_COLORS: { id: TextColor; label: string; color: string }[] = [
  ...(['black', 'brown', 'beige'] as const).map(id => ({ id, label: TEXT_PALETTE[id].name, color: TEXT_PALETTE[id].hex })),
]

export function TextControls({ parameters: p, onUpdate }: {
  parameters: LampParameters
  onUpdate: <K extends keyof LampParameters>(key: K, value: LampParameters[K]) => void
}) {
  const id = useId()
  const wrap = p.textEnabled ? textWrapMetrics(p) : null
  const overlaps = wrap !== null && wrap.horizontalSpan > wrap.perimeter
  const fitsAtMinimum = wrap === null || wrap.horizontalSpan * 40 / p.textSize <= wrap.perimeter * .95
  const fittedSize = wrap ? Math.max(40, Math.min(300, Math.floor(p.textSize * wrap.perimeter * .95 / Math.max(1, wrap.horizontalSpan)))) : p.textSize
  const number = (key: 'textSize' | 'textRotation' | 'textAzimuth' | 'textHorizontal' | 'textVertical', label: string, min: number, max: number, unit: string, hint?: string) =>
    <ParameterControl label={label} value={p[key]} min={min} max={max} unit={unit} onChange={value => onUpdate(key, value)} hint={hint} />

  return <section className="text-controls" aria-label="Multicolor lettering">
    <div className="control-divider" />
    <div className="switch-row">
      <div><label htmlFor={`${id}-enabled`}>Multicolor text</label><p id={`${id}-description`}>Bold lettering wrapped around the shade.</p></div>
      <Switch id={`${id}-enabled`} checked={p.textEnabled} onCheckedChange={enabled => onUpdate('textEnabled', enabled)} aria-describedby={`${id}-description`} />
    </div>
    {p.textEnabled && <div className="text-settings">
      <label className="field-label" htmlFor={`${id}-text`}>Text</label>
      <input id={`${id}-text`} className="text-content-input" type="text" value={p.text} maxLength={24} autoComplete="off" spellCheck={false}
        aria-describedby={`${id}-text-help`} onChange={event => onUpdate('text', event.target.value.toUpperCase().replace(/[^A-Z0-9 .!?-]/g, '').slice(0, 24))} />
      <p className="control-hint" id={`${id}-text-help`}>Up to 24 characters: A–Z, 0–9, spaces and . ! ? −. Short words keep the letters large.</p>
      <fieldset className="text-color-picker">
        <legend className="field-label">Text color</legend>
        <div className="text-color-options">{TEXT_COLORS.map(color => <button key={color.id} type="button" className={cn('text-color-option', p.textColor === color.id && 'selected')}
          aria-pressed={p.textColor === color.id} onClick={() => onUpdate('textColor', color.id)}>
          <span className="text-color-swatch" style={{ background: color.color }} aria-hidden="true" />{color.label}
        </button>)}</div>
      </fieldset>
      {number('textSize', 'Letter height', 40, 300, 'mm')}
      {wrap && <div className="text-wrap-fit">
        <p className="control-hint">Text covers {Math.round(wrap.horizontalSpan)} mm of the {Math.round(wrap.perimeter)} mm perimeter.</p>
        {overlaps && <>
          <p className="control-hint" role="status">The ends overlap around the shade. {fitsAtMinimum ? 'Reduce the size to fit in one turn.' : 'Shorten the text to fit in one turn.'}</p>
          {fitsAtMinimum && fittedSize < p.textSize && <button className="text-fit-button" type="button" onClick={() => onUpdate('textSize', fittedSize)}>Fit around shade</button>}
        </>}
      </div>}
      {number('textRotation', 'Text rotation', -180, 180, '°')}
      {number('textAzimuth', 'Around the shade', -180, 180, '°', 'Move the text around the perimeter. 0° centers it on the front.')}
      {number('textHorizontal', 'Horizontal offset', -150, 150, 'mm', 'Slide along the surface, continuing around corners and the back.')}
      {number('textVertical', 'Vertical placement', 0, 100, '%', '0% is the bottom; 100% is the top. Only text beyond the top and bottom is cropped.')}
      <p className="control-hint text-print-note">Smooth, heavy letter outlines fill the TPU membranes and wrap continuously around the shade. Fold joins keep the base color. Placement follows the full display height, so the lettering folds with preview expansion.</p>
      <p className="control-hint">Black and brown block most of the lamp light. Beige casts a lighter shadow. Export includes two TPU colors and removable PLA; test their bond on a calibration print.</p>
      <p className="control-hint">A small bulb casts sharper letter shapes. The LED column casts softer shadows.</p>
    </div>}
  </section>
}
