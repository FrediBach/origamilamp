import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, CircleHelp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { OrigamiMark } from '@/components/brand'
import type { RoomStyle } from '@/components/lamp-viewer'
import { DEFAULT_PARAMETERS, calibrationParameters, deriveLamp, manufacturingErrors, validateLamp, type LampParameters } from '@/lib/lamp'
import { downloadDesign, downloadSTLs, parseDesign, serializeDesign } from '@/lib/export'
import { cn } from '@/lib/utils'
import { StudioDialogs } from '@/components/studio/studio-dialogs'
import { DesignValidation } from '@/components/studio/design-validation'
import { DesignSummary } from '@/components/studio/design-summary'
import { StudioPreview } from '@/components/studio/studio-preview'
import { DesignControls } from '@/components/studio/design-controls'
import type { ViewMode, Modal } from '@/components/studio/types'

const STORAGE_KEY = 'origamilamp.design.v1'

function getInitialParameters(): LampParameters {
  try { const stored = localStorage.getItem(STORAGE_KEY); return stored ? parseDesign(stored) : { ...DEFAULT_PARAMETERS } } catch { return { ...DEFAULT_PARAMETERS } }
}

function App() {
  const [parameters, setParameters] = useState<LampParameters>(getInitialParameters)
  const [view, setView] = useState<ViewMode>('room')
  const [roomStyle, setRoomStyle] = useState<RoomStyle>('tatami')
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
  const diagnostics = useMemo(() => validateLamp(parameters), [parameters])
  const errors = diagnostics.filter(d => d.status === 'error')
  const experimental = parameters.twist !== 0 || parameters.modulation !== 0 || parameters.shape === 'polygon'
  const canExport = !errors.length && !experimental
  const canCalibrate = manufacturingErrors(calibrationParameters(parameters)).length === 0

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

  function reset() { setParameters({ ...DEFAULT_PARAMETERS }); setResetKey(value => value + 1); setNotice('Your canvas is ready. Default design restored.') }
  async function exportMeshes(calibration: boolean) {
    setExporting(true)
    await new Promise(resolve => setTimeout(resolve, 30))
    try { downloadSTLs(parameters, { calibration }); setNotice(calibration ? 'Calibration package downloaded. Start with this short test print.' : 'Print package downloaded. Import all STLs together in millimetres.'); } catch (error) { setNotice(error instanceof Error ? error.message : 'The export could not be prepared.') } finally { setExporting(false) }
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
        <DesignControls parameters={parameters} derived={derived} lightOn={lightOn} setLightOn={setLightOn} update={update} reset={reset} setModal={setModal} />

        <StudioPreview parameters={parameters} view={view} setView={setView} roomStyle={roomStyle} setRoomStyle={setRoomStyle} lightOn={lightOn} setLightOn={setLightOn} resetKey={resetKey} setResetKey={setResetKey} wideView={wideView} setWideView={setWideView} />
      </div>

      <DesignSummary parameters={parameters} derived={derived} view={view} setView={setView} setModal={setModal} />

      <DesignValidation diagnostics={diagnostics} experimental={experimental} setModal={setModal} />

    </main>

    <footer className="site-footer"><a href="https://fredibach.com" target="_blank" rel="noreferrer">© 2026 by Fredi Bach</a></footer>

    <StudioDialogs modal={modal} setModal={setModal} parameters={parameters} derived={derived} diagnostics={diagnostics} setParameters={setParameters} canExport={canExport} canCalibrate={canCalibrate} experimental={experimental} exporting={exporting} exportMeshes={exportMeshes} setNotice={setNotice} importRef={importRef} dialogOpener={dialogOpener} />
    <input ref={importRef} type="file" accept=".json,application/json" className="visually-hidden" aria-label="Import a saved design recipe" tabIndex={-1} onChange={async event => { const file = event.target.files?.[0]; if (!file) return; try { if (file.size > 100_000) throw new Error('This recipe is too large. Choose an Origami Lamp JSON file under 100 KB.'); setParameters(parseDesign(await file.text())); setNotice('Your saved design is back in the studio.'); setModal(null) } catch (error) { setNotice(error instanceof Error ? error.message : 'This recipe could not be read.') } event.target.value = '' }} />
    {notice && <div className="toast" role="status"><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16} /></button></div>}
  </>
}

export default App
