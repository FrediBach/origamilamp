import { ArrowUpRight, Check, ChevronDown, Circle, Hexagon, Layers3, Leaf, RotateCcw, SlidersHorizontal, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ParameterControl } from '@/components/parameter-control'
import { LightControls } from '@/components/light-controls'
import { MountingControls } from '@/components/mounting-controls'
import { BaseControls } from '@/components/base-controls'
import { WoodControls } from '@/components/wood-controls'
import { PatternControls } from '@/components/pattern-controls'
import { TextControls } from '@/components/text-controls'
import type { LampParameters, Shape } from '@/lib/lamp'
import { cn } from '@/lib/utils'
import type { Modal, DerivedLamp, ParameterUpdate } from './types'

interface DesignControlsProps {
  parameters: LampParameters
  derived: DerivedLamp
  lightOn: boolean
  setLightOn: (on: boolean) => void
  update: ParameterUpdate
  reset: () => void
  setModal: (modal: Modal) => void
}

export function DesignControls({ parameters, derived, lightOn, setLightOn, update, reset, setModal }: DesignControlsProps) {
  function control(key: keyof LampParameters, label: string, min: number, max: number, unit = 'mm', step = 1, hint?: string, disabled = false) {
    return <ParameterControl label={label} value={parameters[key] as number} min={min} max={max} step={step} unit={unit} hint={hint} disabled={disabled} onChange={value => update(key, value)} />
  }
  return <aside className="controls-panel" id="design-controls" aria-label="Lamp design controls">
    <div className="panel-title"><div><span className="section-number">01</span><h2>Your lamp</h2></div><Button variant="ghost" size="icon" onClick={reset} aria-label="Reset all design settings" title="Reset design"><RotateCcw size={16} /></Button></div>
    <Tabs defaultValue="form" className="control-tabs">
      <TabsList aria-label="Design settings"><TabsTrigger value="form">Form</TabsTrigger><TabsTrigger value="finish">Finish</TabsTrigger><TabsTrigger value="print">Print setup</TabsTrigger></TabsList>
      <TabsContent value="form">
        <fieldset className="shape-picker"><legend className="field-label">CROSS SECTION</legend><div className="shape-options">
          {([{ id: 'rounded-rectangle', name: 'Soft square', icon: Square }, { id: 'circle', name: 'Circle', icon: Circle }, { id: 'polygon', name: 'Polygon', icon: Hexagon }] as const).map(({ id, name, icon: Icon }) => <button key={id} aria-pressed={parameters.shape === id} className={cn('shape-option', parameters.shape === id && 'selected')} onClick={() => update('shape', id as Shape)}><Icon size={23} strokeWidth={1.3} /><span>{name}</span>{parameters.shape === id && <span className="selection-dot" />}</button>)}
        </div></fieldset>
        {parameters.shape === 'polygon' && control('sides', 'Number of sides', 3, 12, '', 1, 'Appearance study · printing not yet supported.')}
        <div className="control-pair">{control('width', parameters.shape === 'circle' ? 'Diameter' : 'Width', 100, 260)}{control('depth', 'Depth', 100, 260, 'mm', 1, undefined, parameters.shape === 'circle')}</div>
        {control('height', 'Display height', 150, 1000, 'mm', 10)}
        {control('pleats', 'Full pleats', 8, 60, '', 1, `${derived.sheets} membrane sheets · ${derived.separators} removable separators`)}
        <div className="control-divider" />
        <div className="control-section-title"><span className="field-label">FOLD CHARACTER</span><SlidersHorizontal size={14} /></div>
        {control('bandWidth', 'Membrane width', 8, 40)}
        <PatternControls parameters={parameters} onUpdate={update} />
        <details className="advanced-controls"><summary>Fine-tune your form <ChevronDown size={15} /></summary><div className="advanced-body">
          {parameters.shape === 'rounded-rectangle' && control('cornerRadius', 'Corner radius', 10, Math.floor(Math.min(parameters.width, parameters.depth) / 2 - 1))}
          {control('rotation', 'Object rotation', -180, 180, '°', 5)}
          {control('twist', 'Twist', -90, 90, '°', 5, 'Experimental appearance only. Requires a new print geometry model.')}
          {control('modulation', 'Size modulation', 0, 35, '%', 1, 'Sculpt the silhouette. Appearance study only.')}
          {control('expansion', 'Preview expansion', 10, 100, '%', 1, 'Changes the appearance preview; print geometry stays compressed.')}
        </div></details>
      </TabsContent>
      <TabsContent value="finish">
        <LightControls parameters={parameters} lightOn={lightOn} onLightChange={setLightOn} onUpdate={update} />
        <div className="control-divider" />
        <p className="field-label">DIFFUSER TONE</p><p className="panel-description">Quiet colours, softly illuminated.</p>
        <div className="material-options">{([{ id: 'ivory', name: 'Warm ivory', caption: 'A warm, paper-like glow', color: '#eee3cc' }, { id: 'natural', name: 'Natural flax', caption: 'Earthy and softly textured', color: '#cdbb94' }, { id: 'white', name: 'Chalk white', caption: 'Clean and understated', color: '#fbfbf7' }] as const).map(material => <button key={material.id} className={cn('material-option', parameters.material === material.id && 'selected')} aria-pressed={parameters.material === material.id} onClick={() => update('material', material.id)}><span className="material-swatch" style={{ background: material.color }} /><span><strong>{material.name}</strong><small>{material.caption}</small></span>{parameters.material === material.id && <Check size={16} />}</button>)}</div>
        <div className="quiet-note"><Leaf size={18} /><p>Glow responds to the {derived.membraneThickness.toFixed(2)} mm TPU membrane. Adjust layer height and TPU layers in Print setup. Colour and light spread are visual approximations.</p></div>
        <TextControls parameters={parameters} onUpdate={update} />
        <WoodControls parameters={parameters} onUpdate={update} />
        <MountingControls parameters={parameters} onChange={attachment => update('attachment', attachment)} />
        <BaseControls parameters={parameters} onUpdate={update} />
      </TabsContent>
      <TabsContent value="print">
        <div className="recipe-label"><span className="status-dot" /> {parameters.textEnabled ? '2 TPU colors + PLA' : 'TPU + removable PLA'} <span>{parameters.textEnabled ? '3' : '2'} tools</span></div>
        {control('layerHeight', 'Layer height', 0.1, 0.3, 'mm', 0.05)}
        <div className="control-pair">{control('tpuLayers', 'TPU layers', 1, 5, '', 1)}{control('separatorLayers', 'PLA layers', 1, 5, '', 1)}</div>
        <p className="control-hint">TPU membrane: {derived.membraneThickness.toFixed(2)} mm. Thinner membranes transmit more light and spread the glow farther in the preview.</p>
        <p className="control-hint">Uniform first and subsequent layer heights. No variable layer height.</p>
        <div className="control-divider" /><p className="field-label">CONNECTOR BANDS</p>
        <div className="control-pair">{control('innerConnector', 'Inner rim', 0.6, 3, 'mm', 0.1)}{control('outerConnector', 'Outer rim', 0.6, 3, 'mm', 0.1)}</div>
        {control('extrusionWidth', 'Extrusion width', 0.25, 0.8, 'mm', 0.05)}
        <details className="advanced-controls"><summary>Printer & calibration <ChevronDown size={15} /></summary><div className="advanced-body">{control('bedWidth', 'Usable bed width', 100, 400)}{control('bedDepth', 'Usable bed depth', 100, 400)}{control('bedHeight', 'Usable build height', 80, 500)}{control('measuredPitch', 'Measured pleat pitch', 0, 40, 'mm', 0.5, 'Set to 0 until measured on a short calibration print.')}</div></details>
        <Button className="full-width inspect-layers-button" variant="outline" onClick={() => setModal('layers')}><Layers3 size={16} /> Inspect print layers <ArrowUpRight size={13} /></Button>
      </TabsContent>
    </Tabs>
  </aside>
}
