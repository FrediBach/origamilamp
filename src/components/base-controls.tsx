import { useId, useMemo } from 'react'
import { ParameterControl } from '@/components/parameter-control'
import { Switch } from '@/components/ui/switch'
import { WoodPicker } from '@/components/wood-controls'
import type { LampParameters } from '@/lib/lamp'
import { BASE, baseFootprint } from '@/lib/base'
import { buildExpandedGeometry, previewFrameDimensions } from '@/lib/preview-geometry'

export function BaseControls({ parameters, onUpdate }: {
  parameters: LampParameters
  onUpdate: <K extends keyof LampParameters>(key: K, value: LampParameters[K]) => void
}) {
  const id = useId()
  const footprint = useMemo(() => {
    if (!parameters.electronicsBox) return null
    const geometry = buildExpandedGeometry(parameters)
    try {
      const frame = previewFrameDimensions(geometry)
      return baseFootprint(frame.width * 1000, frame.depth * 1000)
    } finally {
      geometry.dispose()
    }
  }, [parameters])

  return <section className="base-controls" aria-label="Electronics compartment">
    <div className="switch-row">
      <div><label htmlFor={id}>Wooden electronics box</label><p id={`${id}-description`}>Room for wiring at the base.</p></div>
      <Switch id={id} checked={parameters.electronicsBox} onCheckedChange={enabled => onUpdate('electronicsBox', enabled)} aria-describedby={`${id}-description`} />
    </div>
    {footprint && <div className="base-settings">
      <WoodPicker label="Box wood" value={parameters.boxWood} matchFrame={parameters.frameWood} onChange={wood => onUpdate('boxWood', wood)} />
      <ParameterControl label="Internal box height" value={parameters.electronicsBoxHeight} min={20} max={120} step={5} unit="mm" onChange={height => onUpdate('electronicsBoxHeight', height)} hint="Clear space below the lid. The shade and supports rise with the box." />
      <dl className="mounting-dimensions base-dimensions">
        <div><dt>Internal space</dt><dd>{Math.floor(footprint.internalWidth + 1e-4)} × {Math.floor(footprint.internalDepth + 1e-4)} × {parameters.electronicsBoxHeight} mm</dd></div>
        <div><dt>Walls / lid</dt><dd>{BASE.wallThickness} / {BASE.lidThickness} mm</dd></div>
      </dl>
      <p className="control-hint">Follows the frame footprint, with a removable lid and openings for cables. Wooden hardware is separate from the shade STL files.</p>
    </div>}
  </section>
}
