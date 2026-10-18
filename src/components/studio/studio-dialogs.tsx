import { ArrowDownToLine, ArrowUpRight, Box, FileJson, Layers3, Lightbulb, LoaderCircle, Upload, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { LayerInspector } from '@/components/layer-inspector'
import { PrintabilityChecks } from '@/components/printability-checks'
import type { LampParameters } from '@/lib/lamp'
import { downloadDesign } from '@/lib/export'
import type { Modal, DerivedLamp } from './types'
import type { RefObject } from 'react'
import type { Diagnostic } from '@/lib/lamp'

interface ExportDialogProps {
  parameters: LampParameters
  derived: DerivedLamp
  canExport: boolean
  canCalibrate: boolean
  experimental: boolean
  exporting: boolean
  exportMeshes: (calibration: boolean) => Promise<void>
  setModal: (modal: Modal) => void
  setNotice: (notice: string) => void
  importRef: RefObject<HTMLInputElement | null>
}

interface StudioDialogsProps extends ExportDialogProps {
  modal: Modal
  diagnostics: Diagnostic[]
  setParameters: (parameters: LampParameters) => void
  dialogOpener: RefObject<HTMLElement | null>
}

function ChecksDialog({ parameters, diagnostics, setParameters }: Pick<StudioDialogsProps, 'parameters' | 'diagnostics' | 'setParameters'>) {
  const passed = diagnostics.filter(d => d.status === 'pass').length
  const warnings = diagnostics.filter(d => d.status === 'warning')
  const errors = diagnostics.filter(d => d.status === 'error')
  return <><p className="eyebrow">CHECKED AS YOU CREATE</p><DialogTitle>Room for a little confidence.</DialogTitle><DialogDescription>Geometry is checked after every setting change. A physical test is still part of the process.</DialogDescription><PrintabilityChecks parameters={parameters} diagnostics={diagnostics} onCorrect={setParameters} /><div className="dialog-note">{passed} passed · {warnings.length} to consider · {errors.length} to resolve. Geometry checks do not predict force, fatigue, separator release, or thermal performance.</div></>
}

function ExportDialog({ parameters, derived, canExport, canCalibrate, experimental, exporting, exportMeshes, setModal, setNotice, importRef }: ExportDialogProps) {
  return <><p className="eyebrow">FROM FORM TO OBJECT</p><DialogTitle>Good things begin with a test.</DialogTitle><DialogDescription>Print a short specimen, check the release, then give your full design a little room to unfold.</DialogDescription><div className="export-summary"><span>{parameters.width} × {parameters.depth} mm footprint</span><span>{derived.compressedHeight.toFixed(1)} mm print height</span><span>{derived.separators} PLA separators</span></div>{!canExport && <div className="export-warning"><TriangleAlert size={18} /><p>{experimental ? 'Twist, size modulation, and polygon profiles are appearance studies. Return to a constant circle or soft square with twist and modulation at zero to export.' : 'Resolve the geometry errors before exporting the full design. A smaller calibration specimen remains available when it fits.'} <button onClick={() => setModal('checks')}>Review checks</button></p></div>}<button className="export-option" disabled={!canCalibrate || exporting} onClick={() => void exportMeshes(true)}><span className="export-option-icon"><Layers3 size={23} /></span><span><strong>Start with a calibration print <span className="tag">RECOMMENDED</span></strong><small>A short bellows specimen · {parameters.textEnabled ? '2 TPU colors + PLA' : 'TPU + PLA'} + setup notes</small></span>{exporting ? <LoaderCircle className="spin" size={18} /> : <ArrowDownToLine size={18} />}</button><button className="export-option" disabled={!canExport || exporting} onClick={() => void exportMeshes(false)}><span className="export-option-icon"><Box size={23} /></span><span><strong>Export the full design</strong><small>{parameters.textEnabled ? 'Three registered STLs' : 'Registered STL pair'} in a ZIP · compressed configuration</small></span><ArrowDownToLine size={18} /></button><p className="dialog-note">Import all STLs together as one assembly in millimetres. {parameters.textEnabled ? 'Assign the shade and text parts to compatible TPU colors, and the separators to PLA. Keep the shared origin of all three parts.' : 'Assign TPU to the shade and PLA to the separators.'} The package contains geometry, not a tested slicer profile. Top and bottom clamps, springs, wooden frame and electronics box, fasteners, and light hardware are separate and are not included in these files.</p><div className="dialog-bottom-actions"><Button variant="outline" onClick={() => { downloadDesign(parameters); setNotice('Design recipe downloaded.') }}><FileJson size={16} /> Save recipe</Button><Button variant="ghost" onClick={() => importRef.current?.click()}><Upload size={16} /> Import recipe</Button></div></>
}

function LayersDialog({ parameters }: { parameters: LampParameters }) {
  return <><p className="eyebrow">ANATOMY OF A FOLD</p><DialogTitle>One layer at a time.</DialogTitle><DialogDescription>See how the permanent TPU joins alternate around the removable PLA.</DialogDescription><LayerInspector parameters={parameters} /></>
}

function GuideDialog() {
  return <><p className="eyebrow">LESS, BUT CONSIDERED</p><DialogTitle>A flat print. A softer space.</DialogTitle><DialogDescription>A flexible accordion shade, designed in your browser and made on a multimaterial FDM printer.</DialogDescription><div className="process-list"><article><span>01</span><div><h3>Find your form</h3><p>Begin with a circle or soft square. Adjust the dimensions and folds, and explore the approximate appearance in a warm tatami room or a modernist room of concrete, metal, and glass.</p></div></article><article><span>02</span><div><h3>Understand the fold</h3><p>TPU membranes join alternately at the outside and inside rims. PLA fills the space between them during printing. Inspect the layers and review the geometry checks.</p></div></article><article><span>03</span><div><h3>Make a little, learn a lot</h3><p>Print the calibration specimen first. Remove every PLA separator and measure a comfortable pitch per full pleat using your intended mounting arrangement.</p></div></article><article><span>04</span><div><h3>Bring it into the light</h3><p>Choose bolted supports or short metal springs in Finish → Top and bottom mounting. Both grip the flat end membranes between rigid perimeter clamps. Springs suspend the shade from above and below, like a trampoline. Fit both ends at a tested deployment height, keep the outer fold joins free to bend, and check the light clearance inside both clamps. Enable the wooden electronics box in Finish to reserve space for wiring below the lamp; adjust its internal height to suit your components.</p></div></article></div><div className="quiet-note"><Lightbulb size={20} /><p>The expanded form and warm glow are visual studies. Physical release, expansion, mounting, and thermal performance remain unvalidated until tested.</p></div><a className="source-link" href="https://www.youtube.com/watch?v=7Q6UgnpUG1g" target="_blank" rel="noreferrer">Bellows construction inspired by Josh Makeshift <ArrowUpRight size={14} /></a></>
}

export function StudioDialogs(props: StudioDialogsProps) {
  const { modal, setModal, parameters, diagnostics, setParameters, dialogOpener } = props
  return <Dialog open={modal !== null} onOpenChange={open => { if (!open) setModal(null) }}><DialogContent className={modal === 'layers' ? 'dialog-wide' : undefined} onCloseAutoFocus={event => { event.preventDefault(); dialogOpener.current?.focus() }}>
      {modal === 'checks' && <ChecksDialog parameters={parameters} diagnostics={diagnostics} setParameters={setParameters} />}
      {modal === 'export' && <ExportDialog {...props} />}
      {modal === 'layers' && <LayersDialog parameters={parameters} />}
      {modal === 'guide' && <GuideDialog />}
    </DialogContent></Dialog>
}
