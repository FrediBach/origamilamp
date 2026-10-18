import type { LampParameters, deriveLamp } from '@/lib/lamp'

export type ViewMode = 'room' | 'studio' | 'print' | 'materials' | 'section'
export type Modal = 'export' | 'checks' | 'guide' | 'layers' | null
export type DerivedLamp = ReturnType<typeof deriveLamp>
export type ParameterUpdate = <K extends keyof LampParameters>(key: K, value: LampParameters[K]) => void
