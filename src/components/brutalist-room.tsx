import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

type Vector3Tuple = [number, number, number]

// Cast concrete stays available offline, with fine pores and broad tonal variation.
function concreteTexture() {
  const size = 256
  const data = new Uint8Array(size * size * 4)
  let seed = 7183
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const noise = seed / 4294967296
      const cloud = Math.sin(x * 0.043 + Math.sin(y * 0.027) * 2) * 5
        + Math.cos(y * 0.061 + x * 0.019) * 3
      const value = 224 + cloud + noise * 18 - (noise < 0.025 ? 35 : 0)
      const index = (y * size + x) * 4
      data[index] = data[index + 1] = data[index + 2] = value
      data[index + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.repeat.set(3, 3)
  texture.needsUpdate = true
  return texture
}

function Slab({ position, size, color, concrete, metal = false, castShadow = true }: {
  position: Vector3Tuple
  size: Vector3Tuple
  color: string
  concrete?: THREE.Texture
  metal?: boolean
  castShadow?: boolean
}) {
  return <mesh position={position} castShadow={castShadow} receiveShadow>
    <boxGeometry args={size} />
    <meshStandardMaterial color={color} map={concrete} bumpMap={concrete} bumpScale={0.002}
      roughness={metal ? 0.34 : 0.92} metalness={metal ? 0.78 : 0} />
  </mesh>
}

function Glass({ position, size }: { position: Vector3Tuple; size: Vector3Tuple }) {
  return <mesh position={position}>
    <boxGeometry args={size} />
    {/* A lightly tinted pane avoids a costly full-scene transmission pass and
        lets the courtyard remain visible without blocking the daylight. */}
    <meshPhysicalMaterial color="#b5ced0" metalness={0.12} roughness={0.08}
      transparent opacity={0.19} depthWrite={false} side={THREE.DoubleSide}
      clearcoat={1} clearcoatRoughness={0.06} />
  </mesh>
}

export function BrutalistRoom({ floorY }: { floorY: number }) {
  const concrete = useMemo(concreteTexture, [])
  useEffect(() => () => concrete.dispose(), [concrete])

  return <group position={[0, floorY, 0]}>
    <Slab position={[0, -0.04, 0.75]} size={[6, 0.08, 3.5]} color="#a4a7a4" concrete={concrete} />
    {/* Flush joints keep the lamp feet on the same continuous concrete floor. */}
    {[-2, -0.8, 0.4, 1.6].map(x => <Slab key={`floor-x-${x}`} position={[x, 0.0005, 0.75]}
      size={[0.004, 0.001, 3.5]} color="#858b89" castShadow={false} />)}
    {[-1, 0.2, 1.4].map(z => <Slab key={`floor-z-${z}`} position={[0, 0.0005, z]}
      size={[6, 0.001, 0.004]} color="#858b89" castShadow={false} />)}

    {/* Heavy concrete planes meet a slender, full-height steel window wall. */}
    <Slab position={[0.87, 1.15, -1.04]} size={[3.18, 2.3, 0.16]} color="#aeb1ae" concrete={concrete} />
    <Slab position={[2.43, 1.15, 0.42]} size={[0.16, 2.3, 3]} color="#989e9c" concrete={concrete} />
    <Slab position={[-0.73, 1.15, -0.98]} size={[0.13, 2.3, 0.25]} color="#9b9f9c" concrete={concrete} />
    <Slab position={[-0.1, 2.22, -0.93]} size={[5, 0.16, 0.28]} color="#a1a5a2" concrete={concrete} />
    {[0.58, 1.16, 1.74].map(y => <Slab key={`wall-y-${y}`} position={[0.87, y, -0.958]}
      size={[3.18, 0.004, 0.003]} color="#858b88" castShadow={false} />)}
    {[0.34, 1.4].map(x => <Slab key={`wall-x-${x}`} position={[x, 1.15, -0.958]}
      size={[0.004, 2.3, 0.003]} color="#858b88" castShadow={false} />)}
    {[-0.48, 0.1, 0.58, 1.16, 1.64, 2.22].flatMap(x => [0.18, 0.98, 1.34, 2.1].map(y =>
      <mesh key={`tie-${x}-${y}`} position={[x, y, -0.955]}>
        <circleGeometry args={[0.008, 12]} />
        <meshStandardMaterial color="#747b78" roughness={1} />
      </mesh>,
    ))}

    {/* An enclosed, pale gravel court gives the glazing depth and a view. */}
    <Slab position={[-1.74, -0.02, -1.825]} size={[1.9, 0.03, 1.65]} color="#b6bcb8" concrete={concrete} />
    <Slab position={[-1.74, 0.64, -2.62]} size={[1.9, 1.3, 0.12]} color="#b9c0bc" concrete={concrete} />
    <Slab position={[-2.68, 1.15, -1.8]} size={[0.12, 2.3, 1.75]} color="#a1aaa6" concrete={concrete} />
    <Slab position={[-1.93, 0.2, -2.02]} size={[0.46, 0.4, 0.4]} color="#8e9793" concrete={concrete} />
    <Slab position={[-1.84, 0.67, -2.02]} size={[0.07, 0.54, 0.07]} color="#596464" metal />
    {[-2.63, -1.7, -0.78].map(x => <Slab key={`mullion-${x}`} position={[x, 1.09, -0.99]}
      size={[0.026, 2.18, 0.045]} color="#424e50" metal />)}
    {[0.025, 2.16].map(y => <Slab key={`window-rail-${y}`} position={[-1.7, y, -0.99]}
      size={[1.88, 0.035, 0.045]} color="#424e50" metal />)}
    {[-2.165, -1.24].map(x => <group key={`pane-${x}`}>
      <Glass position={[x, 1.09, -0.99]} size={[0.9, 2.1, 0.008]} />
      <Slab position={[x + 0.442, 1.09, -0.983]} size={[0.004, 2.1, 0.003]} color="#c2d4d2" metal castShadow={false} />
    </group>)}

    {/* Brushed steel supports and a green glass edge read clearly beside the lamp. */}
    <group position={[-0.64, 0, -0.43]}>
      {[-0.29, 0.29].map(x => <group key={`table-leg-${x}`}>
        <Slab position={[x, 0.108, 0]} size={[0.016, 0.216, 0.27]} color="#78888b" metal />
        <Slab position={[x, 0.008, 0]} size={[0.12, 0.016, 0.3]} color="#78888b" metal />
      </group>)}
      <Slab position={[0, 0.2, 0]} size={[0.6, 0.018, 0.018]} color="#78888b" metal />
      <Glass position={[0, 0.225, 0]} size={[0.76, 0.018, 0.35]} />
      <Slab position={[0, 0.225, 0.175]} size={[0.76, 0.006, 0.003]} color="#739b96" metal castShadow={false} />
      <Slab position={[0.18, 0.248, -0.015]} size={[0.16, 0.027, 0.12]} color="#c8c8bc" />
      <Slab position={[0.17, 0.267, -0.01]} size={[0.14, 0.011, 0.11]} color="#414b4b" />
      <mesh position={[-0.19, 0.292, 0]} castShadow receiveShadow>
        <torusGeometry args={[0.055, 0.012, 12, 40]} />
        <meshStandardMaterial color="#8e9b9f" metalness={0.86} roughness={0.26} />
      </mesh>
    </group>

    {/* A cantilevered bench and charcoal cushion soften the far concrete wall. */}
    <Slab position={[1.03, 0.21, -0.7]} size={[1.04, 0.09, 0.48]} color="#a2a7a3" concrete={concrete} />
    <Slab position={[1.03, 0.1, -0.79]} size={[0.64, 0.2, 0.2]} color="#929995" concrete={concrete} />
    <Slab position={[1.03, 0.27, -0.68]} size={[0.83, 0.035, 0.36]} color="#4e5858" />
  </group>
}
