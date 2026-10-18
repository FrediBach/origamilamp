import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

/** A closed book with an uncropped portrait cover facing up. */
export function SceneBook({ cover, title, position, width, depth, thickness }: {
  cover: string
  title: string
  position: [number, number, number]
  width: number
  depth: number
  thickness: number
}) {
  const material = useRef<THREE.MeshStandardMaterial>(null)
  const { gl, invalidate } = useThree()

  useEffect(() => {
    const coverMaterial = material.current
    if (!coverMaterial) return
    let active = true
    // Own the texture here so switching rooms releases it without a shared cache.
    const texture = new THREE.TextureLoader().load(cover, () => {
      if (active) invalidate()
      else texture.dispose()
    }, undefined, () => {
      // A missing cover should leave the book and the rest of the room usable.
      if (active) {
        coverMaterial.map = null
        coverMaterial.needsUpdate = true
        invalidate()
      }
      texture.dispose()
    })
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
    coverMaterial.map = texture
    coverMaterial.needsUpdate = true
    return () => {
      active = false
      coverMaterial.map = null
      coverMaterial.needsUpdate = true
      texture.dispose()
    }
  }, [cover, gl, invalidate])

  return <group name={title} position={position} rotation={[0, Math.PI / 2, 0]}>
    <mesh castShadow receiveShadow>
      <boxGeometry args={[width, thickness, depth]} />
      <meshStandardMaterial color="#eee9df" roughness={0.9} />
    </mesh>
    <mesh position={[0, thickness / 2 + 0.0001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[width, depth]} />
      <meshStandardMaterial ref={material} color="#ffffff" roughness={0.8} />
    </mesh>
  </group>
}
