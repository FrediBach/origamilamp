import { createContext, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Camera } from 'three'

import { createShadowQualityController, type ShadowQualityUniforms } from '@/lib/shadow-quality'

const baselineUniforms: ShadowQualityUniforms = { samples: { value: 5 } }
const ShadowQualityContext = createContext<ShadowQualityUniforms>(baselineUniforms)

export function useShadowQuality() {
  return useContext(ShadowQualityContext)
}

type QualityController = ReturnType<typeof createShadowQualityController>
interface ControlsEvents {
  addEventListener: (type: 'start' | 'change' | 'end', callback: () => void) => void
  removeEventListener: (type: 'start' | 'change' | 'end', callback: () => void) => void
}

export function ShadowQualityProvider({ enabled, animated, sceneKey, children }: {
  enabled: boolean
  animated: boolean
  sceneKey: string
  children: ReactNode
}) {
  const uniforms = useRef<ShadowQualityUniforms>({ samples: { value: enabled ? 8 : 5 } }).current
  const controller = useRef<QualityController | null>(null)
  const interacting = useRef(false)
  const inView = useRef(true)
  const documentVisible = useRef(true)
  const gl = useThree(state => state.gl)
  const invalidate = useThree(state => state.invalidate)
  const camera = useThree(state => state.camera)
  const controls = useThree(state => state.controls)
  const width = useThree(state => state.size.width)
  const height = useThree(state => state.size.height)
  const dpr = useThree(state => state.viewport.dpr)
  const cameraSnapshot = useRef<{ camera: Camera | null, values: Float64Array }>({ camera: null, values: new Float64Array(32) })

  useLayoutEffect(() => {
    documentVisible.current = !document.hidden
    const next = createShadowQualityController({
      samples: uniforms.samples, enabled, animated, invalidate,
      visible: documentVisible.current && inView.current,
      interacting: interacting.current,
    })
    controller.current = next
    return () => {
      next.dispose()
      if (controller.current === next) controller.current = null
    }
  }, [uniforms, enabled, animated, sceneKey, camera, width, height, dpr, invalidate])

  useEffect(() => {
    const visibilityChanged = () => {
      documentVisible.current = !document.hidden
      const visible = documentVisible.current && inView.current
      if (!visible) interacting.current = false
      controller.current?.setVisible(visible)
    }
    visibilityChanged()
    document.addEventListener('visibilitychange', visibilityChanged)
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => {
      inView.current = entry.isIntersecting
      visibilityChanged()
    })
    observer?.observe(gl.domElement)
    return () => {
      document.removeEventListener('visibilitychange', visibilityChanged)
      observer?.disconnect()
    }
  }, [gl])

  useEffect(() => {
    if (!controls) return
    const events = controls as unknown as ControlsEvents
    const start = () => { interacting.current = true; controller.current?.setInteracting(true) }
    const change = () => controller.current?.reset()
    const end = () => { interacting.current = false; controller.current?.setInteracting(false) }
    events.addEventListener('start', start)
    events.addEventListener('change', change)
    events.addEventListener('end', end)
    return () => {
      events.removeEventListener('start', start)
      events.removeEventListener('change', change)
      events.removeEventListener('end', end)
      end()
    }
  }, [controls])

  useLayoutEffect(() => {
    if (!enabled) return
    const previousAutoUpdate = gl.shadowMap.autoUpdate
    const dirty = () => {
      // Context restoration replaces gl.shadowMap; always use its current value.
      gl.shadowMap.autoUpdate = false
      gl.shadowMap.needsUpdate = true
      controller.current?.reset()
      if (documentVisible.current && inView.current) invalidate()
    }
    dirty()
    gl.domElement.addEventListener('webglcontextrestored', dirty)
    return () => {
      gl.domElement.removeEventListener('webglcontextrestored', dirty)
      gl.shadowMap.autoUpdate = previousAutoUpdate
      gl.shadowMap.needsUpdate = true
    }
    // Light cameras and casters are fixed in world space. Camera movement and
    // quality-only renders reuse their maps; geometry/light changes dirty them.
  }, [enabled, sceneKey, gl, invalidate])

  useFrame(() => {
    // Observe frames already requested by controls or application changes.
    // This observer never runs its own RAF, including after refinement ends.
    camera.updateMatrixWorld()
    const snapshot = cameraSnapshot.current
    const world = camera.matrixWorld.elements, projection = camera.projectionMatrix.elements
    let changed = snapshot.camera !== camera
    for (let index = 0; index < 16; index++) {
      if (Math.abs(snapshot.values[index] - world[index]) > 1e-10 || Math.abs(snapshot.values[index + 16] - projection[index]) > 1e-10) changed = true
      snapshot.values[index] = world[index]
      snapshot.values[index + 16] = projection[index]
    }
    const wasInitialized = snapshot.camera !== null
    snapshot.camera = camera
    if (changed && wasInitialized) controller.current?.reset()
  })

  return <ShadowQualityContext.Provider value={uniforms}>{children}</ShadowQualityContext.Provider>
}
