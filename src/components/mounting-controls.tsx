import { ChevronDown } from 'lucide-react'
import type { Attachment, LampParameters } from '@/lib/lamp'
import { deriveMounting } from '@/lib/mounting'
import { cn } from '@/lib/utils'

export function MountingControls({ parameters, onChange }: {
  parameters: LampParameters
  onChange: (attachment: Attachment) => void
}) {
  const mounting = deriveMounting(parameters)
  const springs = parameters.attachment === 'springs'
  return <details className="advanced-controls mounting-details">
    <summary>Top and bottom mounting <ChevronDown size={15} /></summary>
    <div className="advanced-body">
      <fieldset className="attachment-picker">
        <legend className="field-label">ATTACHMENT</legend>
        <div className="attachment-options">
          {([{ id: 'bolted', name: 'Bolted supports' }, { id: 'springs', name: 'Metal springs' }] as const).map(option => <button
            key={option.id}
            type="button"
            className={cn('attachment-option', parameters.attachment === option.id && 'selected')}
            aria-pressed={parameters.attachment === option.id}
            onClick={() => onChange(option.id)}
          >
            <svg width="38" height="24" viewBox="0 0 38 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {option.id === 'springs'
                ? <path d="M2 9a3 3 0 1 0 3 3h3c1 0 1-6 3-6s4 12 2 12-2-12 1-12 5 12 3 12-2-12 1-12 5 12 3 12-2-12 1-12 5 12 3 12-1-6 1-6h7a3 3 0 1 0 3-3" />
                : <><rect x="5" y="8" width="28" height="8" rx="2" /><circle cx="10" cy="12" r="1.5" /><circle cx="28" cy="12" r="1.5" /><path d="M3 5v14M35 5v14" /></>}
            </svg>
            <span>{option.name}</span>
            {parameters.attachment === option.id && <span className="selection-dot" />}
          </button>)}
        </div>
      </fieldset>
      <p className="mounting-description">{springs
        ? 'Short metal springs suspend the shade between the upper and lower frame rails, like a trampoline. Four springs at each end pull on perimeter clamps that grip the flat end membranes.'
        : 'Two-piece perimeter clamps hold the flat end membranes. Four bolted supports connect each clamp to the wooden frame.'}</p>
      <dl className="mounting-dimensions">
        <div><dt>Grip around each end</dt><dd>{mounting.gripWidth.toFixed(1)} mm</dd></div>
        <div><dt>Opening inside clamps</dt><dd>{Math.max(0, mounting.minimumOpening).toFixed(0)} mm</dd></div>
        <div><dt>{springs ? 'Metal springs' : 'Frame connections'}</dt><dd>4 top + 4 bottom</dd></div>
      </dl>
      <p className="control-hint">{springs
        ? 'Separate hardware concept, excluded from the shade STL files. Choose spring tension and travel using a physical sample; check clamp grip and long-term TPU deformation.'
        : 'Separate hardware concept, excluded from the shade STL files. Clamp grip, pull force, and long-term deformation need testing with your TPU.'}</p>
    </div>
  </details>
}
