import { useMemo } from 'react'
import type { Texture } from 'three'
import type { LampParameters } from '@/lib/lamp'
import { baseFootprint, buildBaseParts, deriveBase } from '@/lib/base'

export function LampBase({ parameters, frameWidth, frameDepth, wood }: {
  parameters: LampParameters
  frameWidth: number
  frameDepth: number
  wood: Texture
}) {
  const panels = useMemo(() => buildBaseParts(parameters, frameWidth * 1000, frameDepth * 1000), [parameters, frameWidth, frameDepth])
  const base = deriveBase(parameters)
  const footprint = baseFootprint(frameWidth * 1000, frameDepth * 1000)
  return <group>
    {panels.map(panel => <mesh
      key={panel.id}
      position={panel.position.map(value => value / 1000) as [number, number, number]}
      castShadow receiveShadow
    >
      <boxGeometry args={panel.size.map(value => value / 1000) as [number, number, number]} />
      <meshStandardMaterial color={panel.kind === 'lid' ? '#b99162' : '#b38a59'} map={wood} roughness={0.9} />
    </mesh>)}
    {base.enabled && [-1, 1].flatMap(x => [-1, 1].map(z => <mesh
      key={`lid-screw-${x}-${z}`}
      position={[x * (footprint.outerWidth / 2 - 4) / 1000, (base.topY + 0.15) / 1000, z * (footprint.outerDepth / 2 - 4) / 1000]}
      castShadow
    >
      <cylinderGeometry args={[0.0011, 0.0011, 0.0003, 12]} />
      <meshStandardMaterial color="#71664e" metalness={0.6} roughness={0.55} />
    </mesh>))}
  </group>
}
