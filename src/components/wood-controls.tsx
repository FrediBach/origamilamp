import { useId, type CSSProperties } from 'react'
import { Check, Link2 } from 'lucide-react'
import type { LampParameters } from '@/lib/lamp'
import { WOOD_FINISHES, WOOD_SPECIES, type WoodSpecies } from '@/lib/wood'
import { cn } from '@/lib/utils'

function WoodSwatch({ species }: { species: WoodSpecies }) {
  const finish = WOOD_FINISHES[species]
  return <span className="wood-swatch" data-wood={species} aria-hidden="true" style={{
    '--wood-color': finish.color,
    '--wood-dark': finish.darkColor,
    '--wood-light': finish.lightColor,
    '--wood-grain-opacity': finish.grainContrast,
  } as CSSProperties} />
}

export function WoodPicker({ label, value, onChange, matchFrame }: {
  label: string
  value: WoodSpecies | 'match-frame'
  onChange: (value: WoodSpecies | 'match-frame') => void
  matchFrame?: WoodSpecies
}) {
  const descriptionId = useId()
  const species = value === 'match-frame' ? matchFrame ?? 'oak' : value
  const selected = WOOD_FINISHES[species]

  return <fieldset className="wood-picker" aria-describedby={descriptionId}>
    <legend className="field-label">{label}</legend>
    {matchFrame && <button
      type="button"
      className={cn('wood-match-option', value === 'match-frame' && 'selected')}
      aria-label="Match frame"
      aria-pressed={value === 'match-frame'}
      onClick={() => onChange('match-frame')}
    >
      <Link2 size={14} aria-hidden="true" />
      <span>Match frame <small>{WOOD_FINISHES[matchFrame].name}</small></span>
      {value === 'match-frame' && <Check size={14} aria-hidden="true" />}
    </button>}
    <div className="wood-options">
      {WOOD_SPECIES.map(species => <button
        key={species}
        type="button"
        className={cn('wood-option', value === species && 'selected')}
        aria-pressed={value === species}
        onClick={() => onChange(species)}
      >
        <WoodSwatch species={species} />
        <span>{WOOD_FINISHES[species].name}</span>
        {value === species && <span className="wood-selection"><Check size={11} aria-hidden="true" /></span>}
      </button>)}
    </div>
    <p id={descriptionId} className="wood-description"><strong>{selected.name}.</strong> {selected.description}</p>
  </fieldset>
}

export function WoodControls({ parameters, onUpdate }: {
  parameters: LampParameters
  onUpdate: <K extends keyof LampParameters>(key: K, value: LampParameters[K]) => void
}) {
  return <section className="wood-controls" aria-label="Wooden support structure">
    <WoodPicker label="Support wood" value={parameters.frameWood} onChange={species => {
      if (species !== 'match-frame') onUpdate('frameWood', species)
    }} />
  </section>
}
