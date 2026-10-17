import { useEffect, useMemo } from 'react'
import type { MeshStandardMaterial } from 'three'
import { createWoodMaterials, woodBoxGeometry, type GrainAxis } from '@/lib/wood-texture'
import type { WoodSpecies } from '@/lib/wood'

export function useWoodMaterials(species: WoodSpecies, shared?: MeshStandardMaterial[]) {
  const materials = useMemo(() => shared ?? createWoodMaterials(species), [species, shared])
  useEffect(() => () => {
    if (shared) return
    materials.forEach(material => {
      material.map?.dispose()
      material.bumpMap?.dispose()
      material.dispose()
    })
  }, [materials, shared])
  return materials
}

export function WoodBox({ position, size, grain, materials, offset = 0 }: {
  position: [number, number, number]
  size: [number, number, number]
  grain: GrainAxis
  materials: MeshStandardMaterial[]
  offset?: number
}) {
  const [x, y, z] = position
  const [width, height, depth] = size
  const geometry = useMemo(() => woodBoxGeometry([width, height, depth], [x, y, z], grain, offset), [width, height, depth, x, y, z, grain, offset])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh position={position} geometry={geometry} material={materials} castShadow receiveShadow />
}
