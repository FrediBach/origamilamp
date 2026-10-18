export interface ShadowSampleUniform { value: number }
export interface ShadowQualityUniforms { samples: ShadowSampleUniform }

interface QualityOptions {
  samples: ShadowSampleUniform
  enabled: boolean
  animated: boolean
  invalidate: () => void
  visible?: boolean
  interacting?: boolean
}

/** A finite idle schedule: no animation loop or accumulating render requests.
 * Flicker changes illumination rather than geometry, so it can settle at 24
 * samples while avoiding the cost of 256 samples on every animated frame. */
export function createShadowQualityController({ samples, enabled, animated, invalidate, visible = true, interacting = false }: QualityOptions) {
  let disposed = false
  let timers: Array<ReturnType<typeof setTimeout>> = []
  const cancel = () => {
    timers.forEach(clearTimeout)
    timers = []
  }
  const publish = (value: number) => {
    if (disposed || samples.value === value) return
    samples.value = value
    if (visible) invalidate()
  }
  const reset = () => {
    if (disposed) return
    cancel()
    publish(enabled ? 8 : 5)
    if (!enabled || !visible || interacting) return
    timers.push(setTimeout(() => publish(24), 120))
    if (!animated) {
      timers.push(setTimeout(() => publish(64), 350))
      timers.push(setTimeout(() => publish(256), 650))
    }
  }
  reset()
  return {
    reset,
    setInteracting(value: boolean) {
      if (disposed || interacting === value) return
      interacting = value
      reset()
    },
    setVisible(value: boolean) {
      if (disposed || visible === value) return
      visible = value
      // A gesture can end while the document or canvas is hidden.
      interacting = false
      reset()
      if (visible) invalidate()
    },
    dispose() {
      disposed = true
      cancel()
    },
  }
}

