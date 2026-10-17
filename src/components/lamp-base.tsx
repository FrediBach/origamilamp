import { useMemo } from 'react'
import type { MeshStandardMaterial } from 'three'
import type { LampParameters } from '@/lib/lamp'
import { baseFootprint, buildBaseParts, deriveBase } from '@/lib/base'
import { WoodBox, useWoodMaterials } from '@/components/wood-box'

export function LampBase({ parameters, frameWidth, frameDepth, frameMaterials }: {
  parameters: LampParameters
  frameWidth: number
  frameDepth: number
  frameMaterials: MeshStandardMaterial[]
}) {
  const species = !parameters.electronicsBox || parameters.boxWood === 'match-frame' ? parameters.frameWood : parameters.boxWood
  const wood = useWoodMaterials(species, species === parameters.frameWood ? frameMaterials : undefined)
  const panels = useMemo(() => buildBaseParts(parameters, frameWidth * 1000, frameDepth * 1000), [parameters, frameWidth, frameDepth])
  const base = deriveBase(parameters)
  const footprint = baseFootprint(frameWidth * 1000, frameDepth * 1000)
  return <group>
    {panels.map(panel => <WoodBox
      key={panel.id}
      position={panel.position.map(value => value / 1000) as [number, number, number]}
      size={panel.size.map(value => value / 1000) as [number, number, number]}
      grain={panel.id === 'wall-left' || panel.id === 'wall-right' ? 'z' : 'x'}
      materials={wood}
      offset={panel.kind === 'lid' ? 0.41 : panel.kind === 'board' ? 0.16 : panel.id.startsWith('wall-rear') ? 0.67 : 0.23}
    />)}
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
