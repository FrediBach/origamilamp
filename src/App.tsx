import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Box, Check, CheckCheck, ChevronDown, Circle, CircleHelp, FileJson, Hexagon, Layers3, Leaf, Lightbulb, LoaderCircle, Maximize2, Move3D, PanelTop, RotateCcw, SlidersHorizontal, Square, Sun, Upload, X, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ParameterControl } from '@/components/parameter-control'
import { OrigamiMark } from '@/components/brand'
import { LayerInspector } from '@/components/layer-inspector'
import { PrintabilityChecks } from '@/components/printability-checks'
import { LightControls } from '@/components/light-controls'
import { DEFAULT_PARAMETERS, calibrationParameters, deriveLamp, manufacturingErrors, validateLamp, type LampParameters, type Shape } from '@/lib/lamp'
import { downloadDesign, downloadSTLs, parseDesign, serializeDesign } from '@/lib/export'
import { cn } from '@/lib/utils'
import { deriveMounting } from '@/lib/mounting'

const LampViewer = lazy(() => import('@/components/lamp-viewer').then(module => ({ default: module.LampViewer })))
type ViewMode = 'room' | 'studio' | 'print' | 'materials' | 'section'
type Modal = 'export' | 'checks' | 'guide' | 'layers' | null
const STORAGE_KEY = 'origamilamp.design.v1'

function getInitialParameters(): LampParameters {
  try { const stored = localStorage.getItem(STORAGE_KEY); return stored ? parseDesign(stored) : { ...DEFAULT_PARAMETERS } } catch { return { ...DEFAULT_PARAMETERS } }
}

function App() {
  const [parameters, setParameters] = useState<LampParameters>(getInitialParameters)
  const [view, setView] = useState<ViewMode>('room')
  const [lightOn, setLightOn] = useState(true)
  const [resetKey, setResetKey] = useState(0)
  const [modal, setModalState] = useState<Modal>(null)
  const [notice, setNotice] = useState('')
  const [storageAvailable, setStorageAvailable] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [wideView, setWideView] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const dialogOpener = useRef<HTMLElement | null>(null)
  const derived = useMemo(() => deriveLamp(parameters), [parameters])
  const mounting = useMemo(() => deriveMounting(parameters), [parameters])
  const diagnostics = useMemo(() => validateLamp(parameters), [parameters])
  const errors = diagnostics.filter(d => d.status === 'error')
  const warnings = diagnostics.filter(d => d.status === 'warning')
  const passed = diagnostics.filter(d => d.status === 'pass').length
  const experimental = parameters.twist !== 0 || parameters.modulation !== 0 || parameters.shape === 'polygon'
  const canExport = !errors.length && !experimental
  const canCalibrate = manufacturingErrors(calibrationParameters(parameters)).length === 0
  const manufacturingView = view === 'print' || view === 'materials' || view === 'section'

  function setModal(next: Modal) {
    if (next && !modal) dialogOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setModalState(next)
  }

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, serializeDesign(parameters)); setStorageAvailable(true) } catch { setStorageAvailable(false) }
  }, [parameters])
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6500); return () => clearTimeout(timer) }, [notice])

  function update<K extends keyof LampParameters>(key: K, value: LampParameters[K]) {
    setParameters(previous => {
      const next = { ...previous, [key]: value }
      if (next.shape === 'circle') next.depth = next.width
      return next
    })
  }
  function control(key: keyof LampParameters, label: string, min: number, max: number, unit = 'mm', step = 1, hint?: string, disabled = false) {
    return <ParameterControl label={label} value={parameters[key] as number} min={min} max={max} step={step} unit={unit} hint={hint} disabled={disabled} onChange={value => update(key, value)} />
  }
  function reset() { setParameters({ ...DEFAULT_PARAMETERS }); setResetKey(value => value + 1); setNotice('Your canvas is ready. Default design restored.') }
  async function exportMeshes(calibration: boolean) {
    setExporting(true)
    await new Promise(resolve => setTimeout(resolve, 30))
    try { downloadSTLs(parameters, { calibration }); setNotice(calibration ? 'Calibration package downloaded. Start with this short test print.' : 'Print package downloaded. Import both STLs together in millimetres.'); } catch (error) { setNotice(error instanceof Error ? error.message : 'The export could not be prepared.') } finally { setExporting(false) }
  }

  return <>
    <a className="skip-link" href="#design-controls">Skip to design controls</a>
    <header className="site-header">
      <a className="brand" href="#" aria-label="Origami Lamp home"><OrigamiMark /><span>origami<span className="brand-light">lamp</span><span className="brand-dot">.</span></span></a>
      <p className="header-slogan">The Art of Folding Light</p>
      <div className="header-actions"><span className="local-state"><span className={cn('status-dot', !storageAvailable && 'warning-dot')} />{storageAvailable ? 'Saved on this device' : 'Device storage unavailable'}</span><Button variant="ghost" size="icon" className="help-button" aria-label="Help: the process" aria-haspopup="dialog" title="Help: the process" onClick={() => setModal('guide')}><CircleHelp size={19} /></Button><Button variant="outline" size="sm" onClick={() => { downloadDesign(parameters); setNotice('Design saved as a reusable JSON file.') }}><ArrowDownToLine size={15} /> Save design</Button></div>
    </header>

    <main className="main-shell">
      <h1 className="visually-hidden">Origami Lamp Studio</h1>

      <div className={cn('workspace', wideView && 'workspace-wide')}>
        <aside className="controls-panel" id="design-controls" aria-label="Lamp design controls">
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
              <div className="quiet-note"><Leaf size={18} /><p>The look of washi. The flexibility of TPU. Colour and glow are visual approximations of the final print.</p></div>
              <details className="advanced-controls mounting-details"><summary>Top and bottom mounting <ChevronDown size={15} /></summary><div className="advanced-body">
                <p className="mounting-description">Two-piece perimeter clamps hold the flat end membranes. Four bolted supports connect each clamp to the wooden frame.</p>
                <dl className="mounting-dimensions"><div><dt>Grip around each end</dt><dd>{mounting.gripWidth.toFixed(1)} mm</dd></div><div><dt>Opening inside clamps</dt><dd>{Math.max(0, mounting.minimumOpening).toFixed(0)} mm</dd></div><div><dt>Frame connections</dt><dd>4 top + 4 bottom</dd></div></dl>
                <p className="control-hint">Separate hardware concept, excluded from the shade STL files. Clamp grip, pull force, and long-term deformation need testing with your TPU.</p>
              </div></details>
            </TabsContent>
            <TabsContent value="print">
              <div className="recipe-label"><span className="status-dot" /> TPU + removable PLA <span>2 tools</span></div>
              {control('layerHeight', 'Layer height', 0.1, 0.3, 'mm', 0.05)}
              <div className="control-pair">{control('tpuLayers', 'TPU layers', 1, 5, '', 1)}{control('separatorLayers', 'PLA layers', 1, 5, '', 1)}</div>
              <p className="control-hint">Uniform first and subsequent layer heights. No variable layer height.</p>
              <div className="control-divider" /><p className="field-label">CONNECTOR BANDS</p>
              <div className="control-pair">{control('innerConnector', 'Inner rim', 0.6, 3, 'mm', 0.1)}{control('outerConnector', 'Outer rim', 0.6, 3, 'mm', 0.1)}</div>
              {control('extrusionWidth', 'Extrusion width', 0.25, 0.8, 'mm', 0.05)}
              <details className="advanced-controls"><summary>Printer & calibration <ChevronDown size={15} /></summary><div className="advanced-body">{control('bedWidth', 'Usable bed width', 100, 400)}{control('bedDepth', 'Usable bed depth', 100, 400)}{control('bedHeight', 'Usable build height', 80, 500)}{control('measuredPitch', 'Measured pleat pitch', 0, 40, 'mm', 0.5, 'Set to 0 until measured on a short calibration print.')}</div></details>
              <Button className="full-width inspect-layers-button" variant="outline" onClick={() => setModal('layers')}><Layers3 size={16} /> Inspect print layers <ArrowUpRight size={13} /></Button>
            </TabsContent>
          </Tabs>
        </aside>

        <section className="preview-panel" aria-label="Interactive lamp preview">
          <div className="preview-toolbar"><div className="view-toggle" role="group" aria-label="Preview environment"><button className={cn(view === 'room' && 'active')} onClick={() => setView('room')} aria-pressed={view === 'room'}><PanelTop size={15} /> In a room</button><button className={cn(view === 'studio' && 'active')} onClick={() => setView('studio')} aria-pressed={view === 'studio'}><Box size={15} /> Studio</button></div><span className="preview-caption"><span className="live-dot" /> LIVE PREVIEW</span><Button variant="ghost" size="icon" className="expand-preview" aria-label={wideView ? 'Restore split view' : 'Expand preview'} onClick={() => setWideView(value => !value)} title="Expand preview">{wideView ? <X size={16} /> : <Maximize2 size={16} />}</Button></div>
          <div className="canvas-container"><Suspense fallback={<div className="viewer-loading"><OrigamiMark /><span>Finding the right light…</span></div>}><LampViewer parameters={parameters} mode={view} lightOn={lightOn} resetKey={resetKey} /></Suspense></div>
          <div className="scene-label"><span>{view === 'room' ? 'THE TATAMI ROOM' : view === 'studio' ? 'THE FORM STUDY' : 'THE PRINT STUDY'}</span><p>{view === 'room' ? 'Warm oak. Soft light. Space to breathe.' : view === 'studio' ? 'Every fold, from every angle.' : 'Exact compressed geometry · millimetres'}</p>{!manufacturingView && <p className="mounting-preview-label">{mounting.canMount ? 'Top + bottom clamps · mounting concept' : 'Mounting needs adjustment · view checks'}</p>}{manufacturingView && <div className="material-legend"><span><i className="legend-tpu" />TPU · shade</span>{view !== 'print' && <span><i className="legend-pla" />PLA · separator</span>}</div>}</div>
          <div className="preview-actions">{!manufacturingView && <div className="light-pill"><Sun size={15} /><label htmlFor="preview-light">Light</label><Switch id="preview-light" checked={lightOn} onCheckedChange={setLightOn} /></div>}<Button variant="secondary" size="icon" aria-label="Reset camera view" title="Reset camera" onClick={() => setResetKey(value => value + 1)}><RotateCcw size={16} /></Button></div>
          <div className="preview-bottom"><span className="orbit-hint"><Move3D size={14} /> Drag to orbit <span>·</span> Scroll to zoom</span><span className="approximate-label">{manufacturingView ? 'Nominal print geometry' : 'Approximate expanded form'}</span></div>
        </section>
      </div>

      <section className="design-summary" aria-label="Design dimensions and print views">
        <div className="summary-item"><span>FOOTPRINT</span><strong>{parameters.width} <span>×</span> {parameters.shape === 'circle' ? parameters.width : parameters.depth}<small>mm</small></strong></div>
        <div className="summary-item"><span>DISPLAY HEIGHT</span><strong>{Math.round(derived.displayHeight)}<small>mm</small></strong></div>
        <div className="summary-item"><span>COMPRESSED</span><strong>{derived.compressedHeight.toFixed(1)}<small>mm</small></strong></div>
        <div className="summary-item fold-summary"><span>FULL PLEATS</span><strong>{parameters.pleats}<small>{derived.sheets} sheets</small></strong></div>
        <div className="inspection-actions"><span>LOOK A LITTLE CLOSER</span><div>{([{ id: 'print', name: 'TPU', icon: Box }, { id: 'materials', name: 'Materials', icon: Layers3 }, { id: 'section', name: 'Section', icon: PanelTop }] as const).map(item => <button key={item.id} className={cn('inspection-button', view === item.id && 'active')} onClick={() => setView(item.id)} aria-pressed={view === item.id}><item.icon size={14} />{item.name}</button>)}<button className="inspection-button" onClick={() => setModal('layers')}><SlidersHorizontal size={14} />Layers</button></div></div>
      </section>

      <section className={cn('validation-bar', errors.length > 0 && 'has-errors')} aria-label="Live feasibility checks">
        <div className="validation-message"><span className="validation-icon">{errors.length ? <TriangleAlert size={20} /> : experimental ? <CircleHelp size={20} /> : <CheckCheck size={21} />}</span><div><h2>{errors.length ? `${errors.length} ${errors.length === 1 ? 'detail needs' : 'details need'} attention` : experimental ? 'A new form to explore' : 'A well-considered starting point'}</h2><p aria-live="polite" aria-atomic="true">{errors.length ? errors[0].title : experimental ? 'Appearance study · manufacturing export paused for this form' : `${passed} geometry checks passed · physical calibration still needed`}</p></div></div><button className="text-button" onClick={() => setModal('checks')}>View checks <ArrowUpRight size={14} /></button><div className="validation-divider" /><Button onClick={() => setModal('export')}>Prepare to make <ArrowRight size={16} /></Button>
      </section>

    </main>

    <footer className="site-footer"><a href="https://fredibach.com" target="_blank" rel="noreferrer">© 2026 by Fredi Bach</a></footer>

    <Dialog open={modal !== null} onOpenChange={open => { if (!open) setModal(null) }}><DialogContent className={modal === 'layers' ? 'dialog-wide' : undefined} onCloseAutoFocus={event => { event.preventDefault(); dialogOpener.current?.focus() }}>
      {modal === 'checks' && <><p className="eyebrow">CHECKED AS YOU CREATE</p><DialogTitle>Room for a little confidence.</DialogTitle><DialogDescription>Geometry is checked after every setting change. A physical test is still part of the process.</DialogDescription><PrintabilityChecks parameters={parameters} diagnostics={diagnostics} onCorrect={setParameters} /><div className="dialog-note">{passed} passed · {warnings.length} to consider · {errors.length} to resolve. Geometry checks do not predict force, fatigue, separator release, or thermal performance.</div></>}
      {modal === 'export' && <><p className="eyebrow">FROM FORM TO OBJECT</p><DialogTitle>Good things begin with a test.</DialogTitle><DialogDescription>Print a short specimen, check the release, then give your full design a little room to unfold.</DialogDescription><div className="export-summary"><span>{parameters.width} × {parameters.depth} mm footprint</span><span>{derived.compressedHeight.toFixed(1)} mm print height</span><span>{derived.separators} PLA separators</span></div>{!canExport && <div className="export-warning"><TriangleAlert size={18} /><p>{experimental ? 'Twist, size modulation, and polygon profiles are appearance studies. Return to a constant circle or soft square with twist and modulation at zero to export.' : 'Resolve the geometry errors before exporting the full design. A smaller calibration specimen remains available when it fits.'} <button onClick={() => setModal('checks')}>Review checks</button></p></div>}<button className="export-option" disabled={!canCalibrate || exporting} onClick={() => void exportMeshes(true)}><span className="export-option-icon"><Layers3 size={23} /></span><span><strong>Start with a calibration print <span className="tag">RECOMMENDED</span></strong><small>A short bellows specimen · TPU + PLA + setup notes</small></span>{exporting ? <LoaderCircle className="spin" size={18} /> : <ArrowDownToLine size={18} />}</button><button className="export-option" disabled={!canExport || exporting} onClick={() => void exportMeshes(false)}><span className="export-option-icon"><Box size={23} /></span><span><strong>Export the full design</strong><small>Registered STL pair in a ZIP · compressed configuration</small></span><ArrowDownToLine size={18} /></button><p className="dialog-note">Import both STLs together as one assembly in millimetres. Assign TPU to the shade and PLA to the separators. The package contains geometry, not a tested slicer profile. Top and bottom clamps, frame, fasteners, and LED hardware are separate and are not included in these files.</p><div className="dialog-bottom-actions"><Button variant="outline" onClick={() => { downloadDesign(parameters); setNotice('Design recipe downloaded.') }}><FileJson size={16} /> Save recipe</Button><Button variant="ghost" onClick={() => importRef.current?.click()}><Upload size={16} /> Import recipe</Button></div></>}
      {modal === 'layers' && <><p className="eyebrow">ANATOMY OF A FOLD</p><DialogTitle>One layer at a time.</DialogTitle><DialogDescription>See how the permanent TPU joins alternate around the removable PLA.</DialogDescription><LayerInspector parameters={parameters} /></>}
      {modal === 'guide' && <><p className="eyebrow">LESS, BUT CONSIDERED</p><DialogTitle>A flat print. A softer space.</DialogTitle><DialogDescription>A flexible accordion shade, designed in your browser and made on a multimaterial FDM printer.</DialogDescription><div className="process-list"><article><span>01</span><div><h3>Find your form</h3><p>Begin with a circle or soft square. Adjust the dimensions and folds, and explore the approximate appearance in a quiet, balanced tatami room.</p></div></article><article><span>02</span><div><h3>Understand the fold</h3><p>TPU membranes join alternately at the outside and inside rims. PLA fills the space between them during printing. Inspect the layers and review the geometry checks.</p></div></article><article><span>03</span><div><h3>Make a little, learn a lot</h3><p>Print the calibration specimen first. Remove every PLA separator and measure a comfortable pitch per full pleat using your intended mounting arrangement.</p></div></article><article><span>04</span><div><h3>Bring it into the light</h3><p>Capture the flat lower end membrane between two rigid clamp rings and bolt it to the frame. Expand the shade to its calibrated height, then secure its upper end the same way. Keep the outer fold joins free to bend and check the LED clearance inside both clamps.</p></div></article></div><div className="quiet-note"><Lightbulb size={20} /><p>The expanded form and warm glow are visual studies. Physical release, expansion, mounting, and thermal performance remain unvalidated until tested.</p></div><a className="source-link" href="https://www.youtube.com/watch?v=7Q6UgnpUG1g" target="_blank" rel="noreferrer">Bellows construction inspired by Josh Makeshift <ArrowUpRight size={14} /></a></>}
    </DialogContent></Dialog>
    <input ref={importRef} type="file" accept=".json,application/json" className="visually-hidden" aria-label="Import a saved design recipe" tabIndex={-1} onChange={async event => { const file = event.target.files?.[0]; if (!file) return; try { if (file.size > 100_000) throw new Error('This recipe is too large. Choose an Origami Lamp JSON file under 100 KB.'); setParameters(parseDesign(await file.text())); setNotice('Your saved design is back in the studio.'); setModal(null) } catch (error) { setNotice(error instanceof Error ? error.message : 'This recipe could not be read.') } event.target.value = '' }} />
    {notice && <div className="toast" role="status"><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16} /></button></div>}
  </>
}

export default App
