import { useEffect, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { MeshStandardMaterial, PointLight } from 'three'
import type { PreviewLightSource } from '@/lib/lighting'
import { sampleLightFlicker } from '@/lib/light-flicker'

export const LAMP_OUTPUT = { shade: 1.8, emitter: 1.65, led: 0.8, bulb: 0.6 } as const

/** One electrical flutter drives the sources, their cast light, and the
 * transmitted shade glow. Mutating uniforms avoids React renders, geometry
 * work, and glow-texture allocations on every animation frame. */
export function useLampFlicker(lightOn: boolean, intensity: number, amount: number, sources: PreviewLightSource[], shade: RefObject<MeshStandardMaterial | null>) {
  const emitters = useRef<Array<MeshStandardMaterial | null>>([])
  const points = useRef<Array<PointLight | null>>([])
  const elapsed = useRef(0)
  const resume = useRef(true)
  const visible = useRef(true)
  const inView = useRef(true)
  const { gl, invalidate } = useThree()

  useEffect(() => {
    const onVisibility = () => {
      visible.current = !document.hidden
      resume.current = true
      if (visible.current) invalidate()
    }
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    // A mobile user may scroll the preview away while editing controls.
    const observer = new IntersectionObserver(([entry]) => {
      inView.current = entry.isIntersecting
      resume.current = true
      if (entry.isIntersecting) invalidate()
    })
    observer.observe(gl.domElement)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      observer.disconnect()
    }
  }, [gl, invalidate])

  useEffect(() => {
    // Demand rendering can have a long first delta after being idle. Resume
    // from the current phase instead of jumping through the paused interval.
    resume.current = true
    invalidate()
  }, [lightOn, intensity, amount, invalidate])

  useFrame((_, delta) => {
    const power = lightOn ? intensity / 100 : 0
    const active = power > 0 && amount > 0 && visible.current && inView.current
    if (active && !resume.current) elapsed.current += delta
    resume.current = !active
    const brightness = power * sampleLightFlicker(elapsed.current, amount)
    if (shade.current) shade.current.emissiveIntensity = LAMP_OUTPUT.shade * brightness
    for (let index = 0; index < sources.length; index++) {
      const emitter = emitters.current[index]
      const point = points.current[index]
      if (emitter) emitter.emissiveIntensity = LAMP_OUTPUT.emitter * brightness
      if (point) point.intensity = LAMP_OUTPUT[sources[index].kind] * brightness
    }
    // Leave the canvas idle for steady/off light, hidden tabs, and previews
    // outside the viewport. The hook unmounts in manufacturing views.
    if (active) invalidate()
  })

  return { emitters, points }
}
