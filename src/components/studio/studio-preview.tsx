import { lazy, Suspense, useMemo } from 'react'
import { Box, Maximize2, Move3D, PanelTop, RotateCcw, Sun, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { OrigamiMark } from '@/components/brand'
import { TEXT_COLOR_OPTIONS as TEXT_COLORS } from '@/lib/text-colors'
import type { RoomStyle } from '@/components/lamp-viewer'
import type { LampParameters } from '@/lib/lamp'
import { cn } from '@/lib/utils'
import { deriveMounting } from '@/lib/mounting'
import type { ViewMode } from './types'
import type { Dispatch, SetStateAction } from 'react'

const LampViewer = lazy(() => import('@/components/lamp-viewer').then(module => ({ default: module.LampViewer })))

interface SceneLabelProps {
  parameters: LampParameters
  view: ViewMode
  roomStyle: RoomStyle
  manufacturingView: boolean
}

const SCENE_CAPTIONS = {
  tatami: { title: 'THE TATAMI ROOM', description: 'Warm oak. Soft light. Space to breathe.' },
  brutalist: { title: 'THE BRUTALIST ROOM', description: 'Concrete. Brushed metal. Light through glass.' },
  studio: { title: 'THE FORM STUDY', description: 'Every fold, from every angle.' },
  manufacturing: { title: 'THE PRINT STUDY', description: 'Exact compressed geometry · millimetres' },
}

function SceneLabel({ parameters, view, roomStyle, manufacturingView }: SceneLabelProps) {
  const mounting = useMemo(() => deriveMounting(parameters), [parameters])
  const caption = SCENE_CAPTIONS[view === 'room' ? roomStyle : manufacturingView ? 'manufacturing' : 'studio']
  const mountingLabel = mounting.canMount
    ? parameters.attachment === 'springs' ? 'Top + bottom springs · suspension concept' : 'Top + bottom clamps · mounting concept'
    : 'Mounting needs adjustment · view checks'
  return <div className="scene-label">
    <span>{caption.title}</span>
    <p>{caption.description}</p>
    {!manufacturingView && <p className="mounting-preview-label">{mountingLabel}</p>}
    {manufacturingView && <div className="material-legend">
      <span><i className="legend-tpu" />TPU · shade</span>
      {parameters.textEnabled && <span><i style={{ background: TEXT_COLORS.find(color => color.id === parameters.textColor)?.color }} />TPU · text</span>}
      {view !== 'print' && <span><i className="legend-pla" />PLA · separator</span>}
    </div>}
  </div>
}

interface StudioPreviewProps {
  parameters: LampParameters
  view: ViewMode
  setView: (view: ViewMode) => void
  roomStyle: RoomStyle
  setRoomStyle: (style: RoomStyle) => void
  lightOn: boolean
  setLightOn: (on: boolean) => void
  resetKey: number
  setResetKey: Dispatch<SetStateAction<number>>
  wideView: boolean
  setWideView: Dispatch<SetStateAction<boolean>>
}

export function StudioPreview({ parameters, view, setView, roomStyle, setRoomStyle, lightOn, setLightOn, resetKey, setResetKey, wideView, setWideView }: StudioPreviewProps) {
  const manufacturingView = view === 'print' || view === 'materials' || view === 'section'
  return <section className="preview-panel" aria-label="Interactive lamp preview">
    <div className="preview-toolbar">
      <div className="preview-environments">
        <div className="view-toggle" role="group" aria-label="Preview environment"><button className={cn(view === 'room' && 'active')} onClick={() => setView('room')} aria-pressed={view === 'room'}><PanelTop size={15} /> In a room</button><button className={cn(view === 'studio' && 'active')} onClick={() => setView('studio')} aria-pressed={view === 'studio'}><Box size={15} /> Studio</button></div>
        {view === 'room' && <div className="view-toggle room-style-toggle" role="group" aria-label="Room style">{([{ id: 'tatami', name: 'Tatami' }, { id: 'brutalist', name: 'Brutalist' }] as const).map(room => <button key={room.id} className={cn(roomStyle === room.id && 'active')} aria-pressed={roomStyle === room.id} onClick={() => setRoomStyle(room.id)}>{room.name}</button>)}</div>}
      </div>
      <span className="preview-caption"><span className="live-dot" /> LIVE PREVIEW</span><Button variant="ghost" size="icon" className="expand-preview" aria-label={wideView ? 'Restore split view' : 'Expand preview'} onClick={() => setWideView(value => !value)} title="Expand preview">{wideView ? <X size={16} /> : <Maximize2 size={16} />}</Button>
    </div>
    <div className="canvas-container"><Suspense fallback={<div className="viewer-loading"><OrigamiMark /><span>Finding the right light…</span></div>}><LampViewer parameters={parameters} mode={view} roomStyle={roomStyle} lightOn={lightOn} resetKey={resetKey} /></Suspense></div>
    <SceneLabel parameters={parameters} view={view} roomStyle={roomStyle} manufacturingView={manufacturingView} />
    <div className="preview-actions">{!manufacturingView && <div className="light-pill"><Sun size={15} /><label htmlFor="preview-light">Light</label><Switch id="preview-light" checked={lightOn} onCheckedChange={setLightOn} /></div>}<Button variant="secondary" size="icon" aria-label="Reset camera view" title="Reset camera" onClick={() => setResetKey(value => value + 1)}><RotateCcw size={16} /></Button></div>
    <div className="preview-bottom"><span className="orbit-hint"><Move3D size={14} /> Drag to orbit <span>·</span> Scroll to zoom</span><span className="approximate-label">{manufacturingView ? 'Nominal print geometry' : 'Approximate expanded form'}</span></div>
  </section>
}
