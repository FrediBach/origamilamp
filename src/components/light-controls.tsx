import { Cylinder, Lightbulb } from 'lucide-react'
import { ParameterControl } from '@/components/parameter-control'
import { Switch } from '@/components/ui/switch'
import type { LampParameters } from '@/lib/lamp'
import { deriveLighting } from '@/lib/lighting'
import { cn } from '@/lib/utils'

interface LightControlsProps {
  parameters: LampParameters
  lightOn: boolean
  onLightChange: (enabled: boolean) => void
  onUpdate: <K extends keyof LampParameters>(key: K, value: LampParameters[K]) => void
}

export function LightControls({ parameters, lightOn, onLightChange, onUpdate }: LightControlsProps) {
  const lighting = deriveLighting(parameters)
  const bulbs = parameters.lightSource !== 'led'
  const positionHint = (index: number) => `${Math.round(lighting.sources[index].centerY - lighting.shadeBottom)} mm above the shade base. Move from bottom to top.`

  return <div className="light-controls">
    <fieldset className="light-source-picker">
      <legend className="field-label">LIGHT SOURCE</legend>
      <div className="light-source-options">
        {([{ id: 'led', label: 'LED column' }, { id: 'bulb', label: 'One bulb' }, { id: 'two-bulbs', label: 'Two bulbs' }] as const).map(source => <button
          key={source.id}
          type="button"
          className={cn('light-source-option', parameters.lightSource === source.id && 'selected')}
          aria-pressed={parameters.lightSource === source.id}
          onClick={() => onUpdate('lightSource', source.id)}
        >
          <span className="light-source-icon" aria-hidden="true">{source.id === 'led' ? <Cylinder size={23} strokeWidth={1.4} /> : <><Lightbulb size={23} strokeWidth={1.4} />{source.id === 'two-bulbs' && <Lightbulb size={23} strokeWidth={1.4} />}</>}</span>
          <span>{source.label}</span>
          {parameters.lightSource === source.id && <span className="selection-dot" />}
        </button>)}
      </div>
    </fieldset>
    <div className="switch-row light-preview-switch"><div><label htmlFor="finish-light">Preview light</label><p>Room and studio illumination</p></div><Switch id="finish-light" checked={lightOn} onCheckedChange={onLightChange} /></div>
    <div className="light-warmth-control">
      <ParameterControl label="Light warmth" value={parameters.lightTemperature} min={1800} max={6500} step={100} unit="K" onChange={value => onUpdate('lightTemperature', value)} />
      <div className="light-warmth-labels" aria-hidden="true"><span>Candlelight</span><span className="light-color-swatch" style={{ backgroundColor: lighting.color }} /><span>Daylight</span></div>
    </div>
    {bulbs && <div className="bulb-position-controls">
      <ParameterControl label="Bulb height" value={parameters.bulbHeight} min={0} max={100} unit="%" hint={positionHint(0)} onChange={value => onUpdate('bulbHeight', value)} />
      {parameters.lightSource === 'two-bulbs' && <ParameterControl label="Second bulb height" value={parameters.secondBulbHeight} min={0} max={100} unit="%" hint={positionHint(1)} onChange={value => onUpdate('secondBulbHeight', value)} />}
      {(!lighting.fitsVertically || lighting.bulbsOverlap) && <p className="light-placement-note" role="status">{!lighting.fitsVertically ? 'This light source needs more vertical room. Increase the display height or preview expansion to inspect its fit.' : 'The bulbs overlap at these heights. Move them farther apart.'}</p>}
    </div>}
    <p className="field-label light-clearance-label">LIGHT SOURCE CLEARANCE</p>
    {bulbs
      ? <ParameterControl label="Bulb diameter" value={parameters.bulbDiameter} min={20} max={100} unit="mm" onChange={value => onUpdate('bulbDiameter', value)} />
      : <ParameterControl label="LED module diameter" value={parameters.lightDiameter} min={10} max={100} unit="mm" onChange={value => onUpdate('lightDiameter', value)} />}
    <ParameterControl label="Required radial clearance" value={parameters.lightClearance} min={5} max={30} unit="mm" onChange={value => onUpdate('lightClearance', value)} />
    <p className="control-hint">Clearance includes the top and bottom clamps. Use the space required by your selected light source. Bulbs and fittings are approximate preview shapes.</p>
  </div>
}
