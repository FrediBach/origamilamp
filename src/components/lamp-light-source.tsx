import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { LampParameters } from '@/lib/lamp'
import { deriveLighting, type PreviewLightSource } from '@/lib/lighting'
import { deriveMounting, MOUNTING } from '@/lib/mounting'
import { luminousCenter, pendantIndex, sampleShadeGlow } from '@/lib/shade-transmission'

type Lighting = ReturnType<typeof deriveLighting>

/** Thickness-dependent transmitted glow, separate from opaque surface shading. */
export function useShadeGlow(parameters: LampParameters, lighting: Lighting) {
  const texture = useMemo(() => {
    const glow = sampleShadeGlow(parameters, lighting)
    const data = new Uint8Array(glow.length * 4)
    glow.forEach((brightness, row) => {
      const value = Math.round(255 * brightness)
      data.set([value, value, value, 255], row * 4)
    })
    const result = new THREE.DataTexture(data, 1, glow.length, THREE.RGBAFormat)
    result.magFilter = result.minFilter = THREE.LinearFilter
    result.needsUpdate = true
    return result
  }, [parameters, lighting])
  useEffect(() => () => texture.dispose(), [texture])
  return texture
}

function Support({ bottom, top, radius = 0.0018 }: { bottom: number; top: number; radius?: number }) {
  const height = (top - bottom) / 1000
  if (height <= 0) return null
  return <mesh position={[0, (bottom + top) / 2000, 0]} castShadow>
    <cylinderGeometry args={[radius, radius, height, 12]} />
    <meshStandardMaterial color="#625c4b" roughness={0.7} metalness={0.3} />
  </mesh>
}

function Bulb({ source, inverted, lightOn, color }: { source: PreviewLightSource; inverted: boolean; lightOn: boolean; color: string }) {
  const radius = source.diameter / 2000
  const height = source.height / 1000
  const profile = useMemo(() => {
    const curve = new THREE.SplineCurve([
      [0.36, -0.19], [0.38, -0.12], [0.58, -0.015], [0.88, 0.11],
      [1, 0.23], [0.94, 0.34], [0.72, 0.43], [0.4, 0.485], [0, 0.5],
    ].map(([r, y]) => new THREE.Vector2(r * radius, y * height)))
    // The sampled profile keeps the selected diameter, including at its widest
    // point. Bulbs that do not fit remain full-size in the preview.
    return curve.getPoints(64).map(point => new THREE.Vector2(Math.max(0, Math.min(radius, point.x)), Math.min(height / 2, point.y)))
  }, [radius, height])
  return <group position={[0, source.centerY / 1000, 0]} rotation={[0, 0, inverted ? Math.PI : 0]}>
    <mesh castShadow>
      <latheGeometry args={[profile, 48]} />
      <meshStandardMaterial color="#f5f2e9" emissive={color} emissiveIntensity={lightOn ? 1.65 : 0} roughness={0.48} />
      {/* The frosted envelope transmits the lamp light but still casts its
          silhouette in the ceiling light's depth shadow map. */}
      <meshDistanceMaterial attach="customDistanceMaterial" depthWrite={false} colorWrite={false} />
    </mesh>
    <mesh position={[0, -height * 0.245, 0]} castShadow>
      <cylinderGeometry args={[radius * 0.37, radius * 0.43, height * 0.11, 32]} />
      <meshStandardMaterial color="#e2dfd4" roughness={0.48} />
    </mesh>
    <mesh position={[0, -height * 0.395, 0]} castShadow>
      <cylinderGeometry args={[radius * 0.43, radius * 0.4, height * 0.21, 32]} />
      <meshStandardMaterial color="#817c6b" roughness={0.45} metalness={0.7} />
    </mesh>
    {[0, 1, 2, 3].map(ring => <mesh key={ring} position={[0, -height * (0.32 + ring * 0.045), 0]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[radius * 0.43, radius * 0.025, 6, 32]} />
      <meshStandardMaterial color="#a59d87" roughness={0.4} metalness={0.75} />
    </mesh>)}
  </group>
}

export function LampLightSources({ parameters, lighting, lightOn }: { parameters: LampParameters; lighting: Lighting; lightOn: boolean }) {
  const mounting = deriveMounting(parameters)
  const topSupportY = mounting.upperY + MOUNTING.plateThickness
  const pendant = pendantIndex(lighting.sources)
  return <group>
    {pendant >= 0 && mounting.minimumOpening > 0 && <mesh position={[0, topSupportY / 1000, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry args={[0.0015, 0.0015, (mounting.minimumOpening + 8) / 1000, 12]} />
      <meshStandardMaterial color="#625c4b" roughness={0.7} metalness={0.3} />
    </mesh>}
    {lighting.sources.map((source, index) => <group key={`${source.kind}-${index}`}>
      {source.kind === 'led' ? <>
        <Support bottom={48} top={source.centerY - source.height / 2} />
        <mesh position={[0, source.centerY / 1000, 0]} castShadow>
          <cylinderGeometry args={[source.diameter / 2000, source.diameter / 2000, source.height / 1000, 32]} />
          <meshStandardMaterial color="#f5f2e9" emissive={lighting.color} emissiveIntensity={lightOn ? 1.65 : 0} roughness={0.55} />
          <meshDistanceMaterial attach="customDistanceMaterial" depthWrite={false} colorWrite={false} />
        </mesh>
      </> : <>
        {index === pendant
          ? <Support bottom={source.centerY + source.height / 2} top={topSupportY} radius={0.0011} />
          : <Support bottom={48} top={source.centerY - source.height / 2} />}
        <Bulb source={source} inverted={index === pendant} color={lighting.color} lightOn={lightOn} />
      </>}
      {lightOn && <pointLight
        position={[0, luminousCenter(source, index === pendant) / 1000, 0]}
        color={lighting.color}
        intensity={source.kind === 'led' ? 0.8 : 0.6}
        distance={3}
        decay={2}
        castShadow
        shadow-mapSize={[512, 512]}
        shadow-camera-near={0.005}
        shadow-normalBias={0.001}
        shadow-bias={-0.00005}
        shadow-radius={3}
      />}
    </group>)}
  </group>
}
