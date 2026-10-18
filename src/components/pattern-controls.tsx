import { ParameterControl } from '@/components/parameter-control'
import type { LampParameters } from '@/lib/lamp'
import { cutoutProfile } from '@/lib/cutout-patterns'
import { cn } from '@/lib/utils'

export function PatternControls({ parameters: p, onUpdate }: {
  parameters: LampParameters
  onUpdate: <K extends keyof LampParameters>(key: K, value: LampParameters[K]) => void
}) {
  const enabled = p.cutoutPattern !== 'none'
  const profile = cutoutProfile(p)
  return <section className="pattern-controls" aria-label="Light patterns">
    <div className="control-divider" />
    <fieldset>
      <legend className="field-label">LIGHT PATTERNS</legend>
      <p className="panel-description">Fold a little more light into your shade.</p>
      <div className="pattern-options">
        {([
          { id: 'none', label: 'None', path: 'M3 18H37V5H3Z' },
          { id: 'triangles', label: 'Triangles', path: 'M3 18L10 6L17 18M23 18L30 6L37 18' },
          { id: 'half-circles', label: 'Half circles', path: 'M3 18a8 8 0 0 1 16 0M23 18a7 7 0 0 1 14 0' },
          { id: 'rectangles', label: 'Rectangles', path: 'M4 18V10Q4 6 8 6H13Q17 6 17 10V18M24 18V10Q24 6 28 6H33Q37 6 37 10V18' },
        ] as const).map(option => <button type="button" key={option.id}
          className={cn('attachment-option', p.cutoutPattern === option.id && 'selected')}
          aria-pressed={p.cutoutPattern === option.id} onClick={() => onUpdate('cutoutPattern', option.id)}>
          <svg width="40" height="24" viewBox="0 0 40 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M1 19H39" opacity=".35" /><path d={option.path} /></svg>
          <span>{option.label}</span>
        </button>)}
      </div>
    </fieldset>
    {enabled && <>
      <p className="pattern-description">Thinner TPU, never open holes. Every shape opens at the outside edge so its PLA pulls outward with the separator. Inner folds stay full thickness.</p>
      <ParameterControl label="Pattern repeats" value={p.cutoutCount} min={4} max={32} unit="" onChange={value => onUpdate('cutoutCount', value)} />
      <ParameterControl label="Cutout spacing" value={p.cutoutSpacing} min={5} max={80} unit="%" onChange={value => onUpdate('cutoutSpacing', value)} hint={`${profile.gapMm.toFixed(1)} mm gap along the outside edge · ${profile.mouthMm.toFixed(1)} mm cutout width. Percentage of each repeat; increase for wider gaps and narrower cutouts.`} />
      <ParameterControl label="Pattern every" value={p.cutoutEvery} min={1} max={24} unit="" onChange={value => onUpdate('cutoutEvery', value)} hint={`${p.cutoutEvery === 1 ? 'Every folding membrane' : `Every ${p.cutoutEvery} membranes`}, starting at the first unclamped membrane. ${Math.ceil(Math.max(0, p.pleats * 2 - 2) / p.cutoutEvery)} patterned; skipped membranes stay full thickness.`} />
      <ParameterControl label="Phase per membrane" value={p.cutoutPhase} min={-100} max={100} unit="%" onChange={value => onUpdate('cutoutPhase', value)} hint="0% aligns the patterns; 50% shifts each membrane by half a repeat. Negative values reverse the direction. Phase advances across skipped membranes too." />
      <ParameterControl label="Pattern depth" value={p.cutoutDepth} min={10} max={75} unit="%" onChange={value => onUpdate('cutoutDepth', value)} hint={`${profile.depthMm.toFixed(1)} mm inward from the outside edge. Limited to protect the inner joining band.`} />
      <ParameterControl label="Remaining TPU layers" value={p.cutoutLayers} min={1} max={Math.max(1, p.tpuLayers - 1)} unit="" onChange={value => onUpdate('cutoutLayers', value)} hint={`${(p.cutoutLayers * p.layerHeight).toFixed(2)} mm in the pattern · ${(p.tpuLayers * p.layerHeight).toFixed(2)} mm elsewhere. Full thickness at both clamped ends.`} />
      {p.cutoutLayers >= p.tpuLayers && <p className="light-placement-note" role="status">Increase TPU layers in Print setup, or reduce remaining layers. A pattern must be thinner than the full membrane.</p>}
      <p className="control-hint">Included in both STL files. Test release and strength with the patterned calibration print. Light and shadow are an optical approximation.</p>
    </>}
  </section>
}
