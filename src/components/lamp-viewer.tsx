import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { ContactShadows, Html, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { deriveLamp, type LampParameters } from '@/lib/lamp'
import { buildManufacturingGeometry } from '@/lib/manufacturing'
import { patternSectionIntervals } from '@/lib/pattern-section'
import { textSectionIntervals } from '@/lib/text-section'
import { cutoutLayerRange, cutoutPhaseAt, cutoutProfile } from '@/lib/cutout-patterns'
import { buildExpandedGeometry, previewFrameDimensions } from '@/lib/preview-geometry'
import { deriveMounting, MOUNTING } from '@/lib/mounting'
import { deriveBase } from '@/lib/base'
import { deriveLighting, lightTemperatureColor } from '@/lib/lighting'
import { applyPatternTransmission, applyTextTransmission, applyTextShadow, buildTextMaskAtlas, textShaderKey } from '@/lib/shade-material'
import { TEXT_COLORS } from '@/lib/text-projection'
import { patternLightingKey } from '@/lib/pattern-lighting'
import { PatternLightProjection } from '@/components/pattern-light-projection'
import { LampMounting } from '@/components/lamp-mounting'
import { LampBase } from '@/components/lamp-base'
import { LampLightSources, useShadeGlow } from '@/components/lamp-light-source'
import { BrutalistRoom } from '@/components/brutalist-room'
import { SceneBook } from '@/components/scene-book'
import akiraCover from '@/assets/books/akira-1.jpg'
import { WoodBox, useWoodMaterials } from '@/components/wood-box'
import { LAMP_OUTPUT } from '@/components/use-lamp-flicker'
import { ShadowQualityProvider, useShadowQuality } from '@/components/shadow-quality'
import { applySoftShadows } from '@/lib/soft-shadows'

export type PreviewMode = 'room' | 'studio' | 'print' | 'materials' | 'section'
export type RoomStyle = 'tatami' | 'brutalist'

interface LampViewerProps {
  parameters: LampParameters
  mode: PreviewMode
  roomStyle?: RoomStyle
  lightOn: boolean
  resetKey: number
  onReady?: () => void
}

type Vector3Tuple = [number, number, number]
type TextureKind = 'wood' | 'tatami' | 'paper' | 'plaster'
type KeyboardCommand = { action: 'left' | 'right' | 'in' | 'out' | 'home' | null; sequence: number }

// Furniture and contact shadows share the visible floor surface, not Y=0.
const ROOM_FLOOR_Y = -0.01
const STUDIO_FLOOR_Y = -0.004

// Deterministic textures keep the entire scene available offline.
function surfaceTexture(kind: TextureKind) {
  const size = 128
  const data = new Uint8Array(size * size * 4)
  let seed = 3917
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const noise = seed / 4294967296
      // Fine, low-contrast longitudinal grain. Broad repeated sine bands make
      // small oak components look striped rather than naturally textured.
      const grain = Math.sin(x * 1.4 + Math.sin(y * 0.08) * 0.4 + Math.sin(y * 0.017) * 0.6) * 1.8
        + Math.sin(x * 0.29 + Math.sin(y * 0.04) * 0.3) * 1.5
      const weave = (x % 4 === 0 ? -16 : 0) + (y % 16 === 0 ? -7 : 0)
      const value = kind === 'wood' ? 242 + grain + noise * 3
        : kind === 'tatami' ? 231 + weave + noise * 9
          : kind === 'paper' ? 238 + noise * 16 : 240 + noise * 12
      const index = (y * size + x) * 4
      data[index] = value
      data[index + 1] = value
      data[index + 2] = value
      data[index + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.repeat.set(kind === 'tatami' ? 8 : kind === 'wood' ? 1 : 2, kind === 'tatami' ? 12 : kind === 'wood' ? 1 : 2)
  texture.needsUpdate = true
  return texture
}

function useSurfaceTexture(kind: TextureKind) {
  const texture = useMemo(() => surfaceTexture(kind), [kind])
  useEffect(() => () => texture.dispose(), [texture])
  return texture
}

function Box({ position, size, color, map, rotation, castShadow = true }: {
  position: Vector3Tuple
  size: Vector3Tuple
  color: string
  map?: THREE.Texture
  rotation?: Vector3Tuple
  castShadow?: boolean
}) {
  return <mesh position={position} rotation={rotation} castShadow={castShadow} receiveShadow>
    <boxGeometry args={size} />
    <meshStandardMaterial color={color} map={map} roughness={0.9} />
  </mesh>
}

function Lamp({ parameters, lightOn, floorY }: Pick<LampViewerProps, 'parameters' | 'lightOn'> & { floorY: number }) {
  const shadowQuality = useShadowQuality()
  const opticalKey = patternLightingKey(parameters)
  const geometryKey = patternLightingKey(parameters, false)
  const geometry = useMemo(() => buildExpandedGeometry(parameters), [geometryKey])
  const { width: w, depth: d } = useMemo(() => previewFrameDimensions(geometry), [geometry])
  useEffect(() => () => geometry.dispose(), [geometry])
  const wood = useWoodMaterials(parameters.frameWood)
  const mounting = deriveMounting(parameters)
  const lighting = useMemo(() => deriveLighting(parameters), [parameters])
  const shadeGlow = useShadeGlow(parameters, lighting)
  const thinGlow = useShadeGlow(parameters, lighting, true)
  const { textEnabled, text, textSize } = parameters
  const textAtlas = useMemo(() => buildTextMaskAtlas({ textEnabled, text, textSize }), [textEnabled, text, textSize])
  useEffect(() => () => textAtlas?.texture.dispose(), [textAtlas])
  const patterned = cutoutProfile(parameters).enabled
  const shadeMaterial = useRef<THREE.MeshStandardMaterial>(null)
  // Spring rails sit beyond both flanges to pull the bellows apart.
  const lowerRailY = mounting.lowerRailY / 1000
  const upperRailY = mounting.upperRailY / 1000
  const railHeight = MOUNTING.frameRailHeight / 1000
  const postBottom = floorY
  const postTop = upperRailY + railHeight / 2
  const colors = { ivory: '#e8dfcb', natural: '#d7c7a6', white: '#f5f1e6' }
  // Keep the former paper map's mean linear reflectance without its stretched noise.
  const shadeColor = new THREE.Color(colors[parameters.material]).multiplyScalar(0.918)
  return <group rotation={[0, THREE.MathUtils.degToRad(parameters.rotation), 0]}>
    <mesh geometry={geometry} position={[0, mounting.lowerY / 1000, 0]} castShadow receiveShadow>
      <meshDistanceMaterial
        key={`text-distance-ordered-${opticalKey}`}
        attach="customDistanceMaterial"
        onBeforeCompile={shader => applyTextShadow(shader, parameters, textAtlas, false)}
        customProgramCacheKey={() => `text-distance-ordered-${textAtlas ? textShaderKey(parameters) : 'plain'}`}
      />
      <meshDepthMaterial
        key={`text-depth-ordered-${opticalKey}`}
        attach="customDepthMaterial"
        onBeforeCompile={shader => applyTextShadow(shader, parameters, textAtlas, true)}
        customProgramCacheKey={() => `text-depth-ordered-${textAtlas ? textShaderKey(parameters) : 'plain'}`}
      />
      <meshStandardMaterial
        key={`${opticalKey}-${thinGlow.uuid}`}
        ref={shadeMaterial}
        userData={{ isTPUDiffuser: true }}
        onBeforeCompile={shader => {
          applyPatternTransmission(shader, parameters, thinGlow)
          if (textAtlas) applyTextTransmission(shader, parameters, textAtlas)
          applySoftShadows(shader, shadowQuality)
        }}
        customProgramCacheKey={() => `${patterned ? 'shade-pattern-transmission-v6' : 'shade-transmission-v6'}${textAtlas ? textShaderKey(parameters) : ''}|soft-shadows-v2`}
        color={shadeColor}
        roughness={0.86}
        side={THREE.DoubleSide}
        emissive={lighting.color}
        emissiveMap={shadeGlow}
        emissiveIntensity={lightOn ? LAMP_OUTPUT.shade * parameters.lightIntensity / 100 : 0}
      />
    </mesh>
    {/* Separate hardware captures both terminal sheets and carries their pull. */}
    <LampMounting parameters={parameters} frameWidth={w} frameDepth={d} />
    {[-1, 1].flatMap(x => [-1, 1].map(z => <WoodBox key={`${x}-${z}`} position={[x * w / 2, (postTop + postBottom) / 2, z * d / 2]} size={[0.012, postTop - postBottom, 0.012]} grain="y" materials={wood} offset={x * 0.27 + z * 0.43} />))}
    {[lowerRailY, upperRailY].flatMap(y => [
      <WoodBox key={`front-${y}`} position={[0, y, d / 2]} size={[w + 0.012, railHeight, 0.012]} grain="x" materials={wood} offset={0.18 + y} />,
      <WoodBox key={`back-${y}`} position={[0, y, -d / 2]} size={[w + 0.012, railHeight, 0.012]} grain="x" materials={wood} offset={0.59 + y} />,
      <WoodBox key={`left-${y}`} position={[-w / 2, y, 0]} size={[0.012, railHeight, d]} grain="z" materials={wood} offset={0.32 + y} />,
      <WoodBox key={`right-${y}`} position={[w / 2, y, 0]} size={[0.012, railHeight, d]} grain="z" materials={wood} offset={0.73 + y} />,
    ])}
    <LampBase parameters={parameters} frameWidth={w} frameDepth={d} frameMaterials={wood} />
    <LampLightSources parameters={parameters} lighting={lighting} lightOn={lightOn} shadeMaterial={shadeMaterial} />
    <PatternLightProjection parameters={parameters} geometry={geometry} />
  </group>
}

function Shoji({ position, width, height = 1.9 }: { position: Vector3Tuple; width: number; height?: number }) {
  const wood = useSurfaceTexture('wood')
  const paper = useSurfaceTexture('paper')
  return <group position={position}>
    <Box position={[0, height / 2, -0.018]} size={[width, height, 0.016]} color="#e8e4d7" map={paper} castShadow={false} />
    {Array.from({ length: 5 }, (_, i) => <Box key={`v-${i}`} position={[-width / 2 + i * width / 4, height / 2, 0]} size={[i === 0 || i === 4 ? 0.026 : 0.013, height, 0.022]} color="#a58c69" map={wood} />)}
    {Array.from({ length: 9 }, (_, i) => <Box key={`h-${i}`} position={[0, i * height / 8, 0.001]} size={[width, i === 0 || i === 8 ? 0.028 : 0.012, 0.024]} color="#aa9070" map={wood} />)}
    <mesh position={[width / 2 - 0.047, 0.82, 0.018]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.016, 0.016, 0.005, 24]} />
      <meshStandardMaterial color="#514e43" roughness={0.8} />
    </mesh>
  </group>
}

function Branch({ from, to, radius = 0.007, color = '#5b5140' }: { from: Vector3Tuple; to: Vector3Tuple; radius?: number; color?: string }) {
  const { middle, length, quaternion } = useMemo(() => {
    const start = new THREE.Vector3(...from)
    const end = new THREE.Vector3(...to)
    const direction = end.clone().sub(start)
    return {
      middle: start.clone().add(end).multiplyScalar(0.5),
      length: direction.length(),
      quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()),
    }
  }, [from, to])
  return <mesh position={middle} quaternion={quaternion} castShadow>
    <cylinderGeometry args={[radius * 0.55, radius, length, 6]} />
    <meshStandardMaterial color={color} roughness={1} />
  </mesh>
}

function GardenFoliage() {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const { invalidate } = useThree()
  useLayoutEffect(() => {
    if (!mesh.current) return
    const object = new THREE.Object3D()
    const color = new THREE.Color()
    let seed = 8251
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
    for (let index = 0; index < 900; index += 1) {
      const angle = random() * Math.PI * 2
      const radius = Math.sqrt(random())
      const x = -0.8 + Math.cos(angle) * radius * 0.68
      const y = 0.54 + Math.sin(angle) * radius * 0.16 + (random() - 0.5) * 0.18
      const z = -1.5 + (random() - 0.5) * 0.44
      object.position.set(x, y, z)
      object.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI)
      const size = 0.014 + random() * 0.018
      object.scale.set(size * 1.8, size * 0.25, size)
      object.updateMatrix()
      mesh.current.setMatrixAt(index, object.matrix)
      color.setHSL(0.2 + random() * 0.055, 0.16 + random() * 0.12, 0.27 + random() * 0.19)
      mesh.current.setColorAt(index, color)
    }
    mesh.current.instanceMatrix.needsUpdate = true
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
    mesh.current.computeBoundingSphere()
    invalidate()
  }, [invalidate])
  return <instancedMesh ref={mesh} args={[undefined, undefined, 900]} castShadow receiveShadow>
    <sphereGeometry args={[1, 6, 4]} />
    <meshStandardMaterial roughness={0.95} />
  </instancedMesh>
}

function Garden() {
  return <group>
    <Box position={[-0.7, 0.55, -2]} size={[3, 2.4, 0.08]} color="#c3c9b3" castShadow={false} />
    {/* Keep the garden ground behind the threshold, outside the tatami room. */}
    <Box position={[-0.7, -0.01, -1.675]} size={[2.8, 0.025, 1.35]} color="#9c9d82" castShadow={false} />
    <Branch from={[-0.8, 0, -1.5]} to={[-0.68, 0.62, -1.5]} radius={0.025} color="#6b6653" />
    <Branch from={[-0.75, 0.29, -1.5]} to={[-1.19, 0.56, -1.48]} radius={0.014} color="#6b6653" />
    <Branch from={[-0.72, 0.39, -1.5]} to={[-0.22, 0.62, -1.6]} radius={0.012} color="#6b6653" />
    <Branch from={[-0.72, 0.37, -1.5]} to={[-0.91, 0.7, -1.44]} radius={0.01} color="#6b6653" />
    <GardenFoliage />
    {[[-0.8, -1.2, 0.17], [-1.22, -1.35, 0.11], [-0.4, -1.66, 0.14]].map(([x, z, scale], i) => <mesh key={`${x},${z}`} position={[x, scale / 2, z]} scale={[scale * 1.6, scale, scale]} rotation={[0.2, i, 0.1]}>
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial color="#9b9d8b" roughness={1} />
    </mesh>)}
  </group>
}

function Vase() {
  const points = useMemo(() => new THREE.SplineCurve([[0, 0], [0.032, 0], [0.045, 0.02], [0.047, 0.065], [0.033, 0.11], [0.019, 0.13], [0.021, 0.142], [0.016, 0.142], [0.015, 0.126]].map(([x, y]) => new THREE.Vector2(x, y))).getPoints(48), [])
  return <group>
    <mesh castShadow receiveShadow>
      <latheGeometry args={[points, 40]} />
      <meshStandardMaterial color="#8a9381" roughness={0.67} />
    </mesh>
    <Branch from={[0, 0.1, 0]} to={[0.04, 0.43, 0.02]} radius={0.002} />
    <Branch from={[0.01, 0.25, 0.01]} to={[-0.07, 0.37, 0.01]} radius={0.0014} />
    <Branch from={[0.022, 0.32, 0.01]} to={[0.11, 0.4, 0]} radius={0.0014} />
    {[[0.035, 0.42, 0.02], [-0.064, 0.36, 0.01], [0.105, 0.393, 0]].map((position, i) => <mesh key={position.join(",")} position={position as Vector3Tuple} scale={[0.025, 0.009, 0.012]} rotation={[0, 0, i - 0.2]}>
      <sphereGeometry args={[1, 8, 6]} />
      <meshStandardMaterial color="#6d7959" roughness={1} />
    </mesh>)}
  </group>
}

function JapaneseRoom() {
  const wood = useSurfaceTexture('wood')
  const tatami = useSurfaceTexture('tatami')
  const plaster = useSurfaceTexture('plaster')
  return <group>
    <Box position={[0, ROOM_FLOOR_Y - 0.025, 0]} size={[6, 0.05, 5]} color="#c6c0a7" map={tatami} />
    {[-2.1, -1.15, -0.2, 0.75, 1.7].map(x => <Box key={x} position={[x, -0.008, 0]} size={[0.019, 0.005, 4.8]} color="#7c8170" castShadow={false} />)}
    {[-1.5, 0.4, 2.3].map(z => <Box key={z} position={[0, -0.007, z]} size={[5, 0.006, 0.016]} color="#808470" castShadow={false} />)}
    <Box position={[1.73, 1.05, -0.95]} size={[1.4, 2.1, 0.09]} color="#d4cdbb" map={plaster} />
    <Box position={[2.43, 1.05, 0.5]} size={[0.09, 2.1, 3]} color="#d4cebe" map={plaster} />
    <Box position={[0.2, 1.97, -0.91]} size={[4.6, 0.09, 0.1]} color="#b29470" map={wood} />
    <Box position={[0.2, 0.035, -0.89]} size={[4.6, 0.075, 0.18]} color="#a58d6e" map={wood} />
    {[-1.9, -0.45, 1.03, 2.39].map(x => <Box key={x} position={[x, 1.0, -0.91]} size={[0.056, 2, 0.085]} color="#a98e69" map={wood} />)}
    <Shoji position={[0.29, 0.075, -0.88]} width={1.42} height={1.85} />
    <Shoji position={[-2.27, 0.075, -0.91]} width={0.74} height={1.85} />
    <Garden />
    <Box position={[-1.15, 0.08, -0.9]} size={[1.45, 0.04, 0.32]} color="#a58d6e" map={wood} />
    {/* A low, quiet arrangement leaves the walking area around the lamp open. */}
    <group position={[-0.65, ROOM_FLOOR_Y, -0.43]}>
      <Box position={[0, 0.19, 0]} size={[0.69, 0.035, 0.29]} color="#9c7b54" map={wood} />
      {[-0.25, 0.25].map(x => <Box key={x} position={[x, 0.09, 0]} size={[0.035, 0.18, 0.24]} color="#96774f" map={wood} />)}
      <group position={[-0.15, 0.208, 0]}><Vase /></group>
      <Box position={[0.12, 0.217, 0.02]} size={[0.13, 0.015, 0.09]} color="#e2ddcd" />
      <SceneBook cover={akiraCover} title="Akira · Book 1" position={[0.11, 0.231, 0.018]}
        width={0.085} depth={0.085 * 2085 / 1445} thickness={0.012} />
    </group>
  </group>
}

/** Exact section at model Y=0. Each rectangle follows the same integer layer
 * boundaries and rim widths as the manufacturing body; these are cut faces. */
function sectionSurfaces(parameters: LampParameters) {
  const data: { tpu: number[]; pla: number[]; accent: number[] } = { tpu: [], pla: [], accent: [] }
  const outer = parameters.width / 2000
  const inner = outer - parameters.bandWidth / 1000
  const { sheets } = deriveLamp(parameters)
  const patternSections = new Map<string, [number, number][]>()
  let accentIntervals: [number, number][] = []
  const addRect = (material: keyof typeof data, a: number, b: number, y1: number, y2: number) => {
    if (b - a < 1e-10 || y2 - y1 < 1e-10) return
    data[material].push(a, y1, 0.000002, b, y1, 0.000002, b, y2, 0.000002, a, y1, 0.000002, b, y2, 0.000002, a, y2, 0.000002)
  }
  const directRect = (material: 'tpu' | 'pla', a: number, b: number, y1: number, y2: number) => {
    if (material === 'pla' || !accentIntervals.length) { addRect(material, a, b, y1, y2); return }
    const edges = [a, b, ...accentIntervals.flat().filter(x => x > a && x < b)].sort((x, y) => x - y)
    for (let index = 0; index < edges.length - 1; index++) {
      const left = edges[index], right = edges[index + 1], center = (left + right) / 2
      addRect(accentIntervals.some(([start, end]) => center >= start && center <= end) ? 'accent' : 'tpu', left, right, y1, y2)
    }
  }
  const rect = (material: 'tpu' | 'pla', x1: number, x2: number, y1: number, y2: number) => {
    for (const sign of [-1, 1]) {
      const a = sign === 1 ? x1 : -x2
      const b = sign === 1 ? x2 : -x1
      directRect(material, a, b, y1, y2)
    }
  }
  for (let sheet = 0; sheet < sheets; sheet += 1) {
    accentIntervals = parameters.textEnabled ? textSectionIntervals(parameters, sheet).map(([a, b]) => [a / 1000, b / 1000]) : []
    const layer = sheet * (parameters.tpuLayers + parameters.separatorLayers)
    const bottom = layer * parameters.layerHeight / 1000
    const top = (layer + parameters.tpuLayers) * parameters.layerHeight / 1000
    const recessLayers = cutoutLayerRange(parameters, sheet)
    if (recessLayers) {
      const recessBottom = bottom + recessLayers[0] * parameters.layerHeight / 1000
      const recessTop = bottom + recessLayers[1] * parameters.layerHeight / 1000
      rect('tpu', inner, outer, bottom, recessBottom)
      rect('tpu', inner, outer, recessTop, top)
      const phase = cutoutPhaseAt(parameters, sheet).toFixed(10)
      let recesses = patternSections.get(phase)
      if (!recesses) {
        recesses = patternSectionIntervals(parameters, sheet).map(([a, b]) => [a / 1000, b / 1000])
        patternSections.set(phase, recesses)
      }
      for (const [left, right] of [[-outer, -inner], [inner, outer]]) {
        const boundaries = [left, right, ...recesses.flat().filter(x => x > left && x < right)].sort((a, b) => a - b)
        for (let index = 0; index < boundaries.length - 1; index++) {
          const a = boundaries[index], b = boundaries[index + 1], middle = (a + b) / 2
          directRect(recesses.some(([start, end]) => middle >= start && middle <= end) ? 'pla' : 'tpu', a, b, recessBottom, recessTop)
        }
      }
    } else rect('tpu', inner, outer, bottom, top)
    if (sheet === sheets - 1) continue
    const next = (layer + parameters.tpuLayers + parameters.separatorLayers) * parameters.layerHeight / 1000
    if (sheet % 2 === 0) {
      const edge = outer - parameters.outerConnector / 1000
      rect('tpu', edge, outer, top, next)
      rect('pla', inner, edge, top, next)
    } else {
      const edge = inner + parameters.innerConnector / 1000
      rect('tpu', inner, edge, top, next)
      rect('pla', edge, outer, top, next)
    }
  }
  const geometry = (positions: number[]) => {
    const result = new THREE.BufferGeometry()
    result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    result.computeVertexNormals()
    return result
  }
  return { tpu: geometry(data.tpu), pla: geometry(data.pla), accent: geometry(data.accent) }
}

function ManufacturingModel({ parameters, mode }: { parameters: LampParameters; mode: PreviewMode }) {
  const model = useMemo(() => {
    try {
      return buildManufacturingGeometry(parameters)
    } catch {
      return null
    }
  }, [parameters])
  useEffect(() => () => { model?.tpu.dispose(); model?.pla.dispose(); model?.accent?.dispose() }, [model])
  const caps = useMemo(() => model && mode === 'section' ? sectionSurfaces(parameters) : null, [parameters, mode, model])
  useEffect(() => () => { caps?.tpu.dispose(); caps?.pla.dispose(); caps?.accent.dispose() }, [caps])
  const clip = useMemo(() => [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)], [])
  if (!model) return <Html center><div style={{ width: 240, padding: 18, textAlign: 'center', background: '#f8f6efee', color: '#625b4e', border: '1px solid #d9d4c6', borderRadius: 3, fontSize: 12, lineHeight: 1.6 }}>Resolve the geometry checks to inspect a printable model. Sculpted profiles are available in the appearance preview.</div></Html>
  return <>
    <group rotation={[-Math.PI / 2, 0, 0]} scale={0.001}>
    <mesh geometry={model.tpu} castShadow receiveShadow>
      <meshStandardMaterial color="#f1e4c9" roughness={0.73} side={THREE.DoubleSide} clippingPlanes={mode === 'section' ? clip : undefined} clipShadows />
    </mesh>
    {model.accent && <mesh geometry={model.accent} castShadow receiveShadow>
      <meshStandardMaterial color={TEXT_COLORS[parameters.textColor].hex} roughness={0.8} side={THREE.DoubleSide} clippingPlanes={mode === 'section' ? clip : undefined} clipShadows />
    </mesh>}
    {mode !== 'print' && <mesh geometry={model.pla} castShadow receiveShadow>
      <meshStandardMaterial color="#9caa90" roughness={0.9} side={THREE.DoubleSide} clippingPlanes={mode === 'section' ? clip : undefined} clipShadows />
    </mesh>}
    </group>
    {caps && <>
      <mesh geometry={caps.tpu}><meshStandardMaterial color="#f1e4c9" side={THREE.DoubleSide} roughness={0.9} /></mesh>
      <mesh geometry={caps.pla}><meshStandardMaterial color="#9caa90" side={THREE.DoubleSide} roughness={0.9} /></mesh>
      <mesh geometry={caps.accent}><meshStandardMaterial color={TEXT_COLORS[parameters.textColor].hex} side={THREE.DoubleSide} roughness={0.9} /></mesh>
    </>}
  </>
}

/** Ambient, ceiling and daylight illumination for the selected viewing environment. */
function SceneLighting({ mode, roomStyle, ceilingLightTemperature, ceilingLightIntensity }: {
  mode: PreviewMode
  roomStyle: RoomStyle
  ceilingLightTemperature: number
  ceilingLightIntensity: number
}) {
  const brutalist = roomStyle === 'brutalist'
  return <>
    <color attach="background" args={[mode === 'room' ? brutalist ? '#d7e0e1' : '#dfded2' : '#ebeae4']} />
    {mode === 'room' ? <>
      {/* Approximate diffuse room bounce: broad sky/floor fill keeps the wood's
          outward faces readable, while the ceiling contributes reflected light
          with its own warmth and intensity. The direct lights retain shadows. */}
      <ambientLight intensity={0.22} color={brutalist ? '#f0f5fa' : '#fffaee'} />
      <hemisphereLight args={brutalist ? ['#e9f1fa', '#b0b5b1', 1.15] : ['#f7f5ed', '#c3b49a', 1.05]} />
      <ambientLight color={lightTemperatureColor(ceilingLightTemperature)} intensity={0.3 * ceilingLightIntensity / 100} />
      {/* Both rooms share the ceiling fixture. The brutalist glazing adds
          crisper daylight shadows from its steel mullions. */}
      <spotLight position={[-0.15, 2.25, 0.2]} color={lightTemperatureColor(ceilingLightTemperature)} intensity={6.5 * ceilingLightIntensity / 100} angle={1.08} penumbra={0.65} distance={5} decay={2}
        castShadow={ceilingLightIntensity > 0} shadow-mapSize={[2048, 2048]} shadow-camera-near={0.1} shadow-camera-far={5}
        shadow-normalBias={0.001} shadow-bias={-0.00005} shadow-radius={4} />
      <directionalLight position={[-1.5, 2, -2.2]} intensity={brutalist ? 0.7 : 0.4} color="#e9f0ff"
        castShadow={brutalist} shadow-mapSize={[1024, 1024]} shadow-camera-left={-3} shadow-camera-right={3}
        shadow-camera-top={3} shadow-camera-bottom={-2} shadow-camera-near={0.1} shadow-camera-far={8}
        shadow-normalBias={0.002} shadow-bias={-0.0001} shadow-radius={3} />
    </> : <>
      <ambientLight intensity={0.3} color="#fffaee" />
      <hemisphereLight args={['#f7f5ed', '#a09b88', 0.95]} />
      <directionalLight position={[-2, 3, 1]} intensity={2.15} color="#fff5e5" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-2.5} shadow-camera-right={2.5} shadow-camera-top={3} shadow-camera-bottom={-1.5} shadow-normalBias={0.0015} shadow-bias={-0.0001} shadow-radius={4} />
      <directionalLight position={[2, 1.2, 3]} intensity={0.3} color="#f0f4ff" />
      <pointLight position={[-0.35, 1.1, 0.65]} intensity={0.38} color="#fff4df" distance={2.7} decay={2} />
    </>}
  </>
}

/** Room architecture or the neutral floor and print grid surrounding the model. */
function SceneEnvironment({ mode, roomStyle, floorY, manufacturing }: {
  mode: PreviewMode
  roomStyle: RoomStyle
  floorY: number
  manufacturing: boolean
}) {
  const brutalist = roomStyle === 'brutalist'
  return <>
    {mode === 'room' ? brutalist ? <BrutalistRoom floorY={floorY} /> : <JapaneseRoom /> : <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, floorY, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#e6e4dc" roughness={1} />
      </mesh>
      {manufacturing && <gridHelper args={[0.6, 30, '#bcbab1', '#d4d2c9']} position={[0, -0.002, 0]} />}
    </>}
  </>
}

function Scene({ parameters, mode, roomStyle = 'tatami', lightOn, resetKey, keyboard, onReady }: LampViewerProps & { keyboard: KeyboardCommand }) {
  const { camera, invalidate } = useThree()
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const { displayHeight, compressedHeight } = deriveLamp(parameters)
  const mounting = deriveMounting(parameters)
  const manufacturing = mode === 'print' || mode === 'materials' || mode === 'section'
  const floorY = mode === 'room' ? ROOM_FLOOR_Y : STUDIO_FLOOR_Y
  const height = manufacturing ? compressedHeight / 1000 : parameters.attachment === 'springs'
    ? (mounting.upperRailY + MOUNTING.frameRailHeight / 2) / 1000
    : (displayHeight + deriveBase(parameters).lift) / 1000 + 0.1
  const footprint = Math.max(parameters.width, parameters.depth) / 1000
  // Leave a little floor margin around the full-length frame feet.
  const fit = Math.max(height * (manufacturing ? 1.95 : 2.05), footprint * 2.6, 0.22)
  const targetY = manufacturing ? height / 2 : height * 0.48

  const resetCamera = useCallback(() => {
    const distance = fit
    const theta = 0.46
    camera.position.set(Math.sin(theta) * distance, targetY + distance * (manufacturing ? 0.76 : 0.25), Math.cos(theta) * distance)
    camera.lookAt(0, targetY, 0)
    camera.updateProjectionMatrix()
    controls.current?.target.set(0, targetY, 0)
    controls.current?.update()
    invalidate()
  }, [camera, fit, targetY, manufacturing, invalidate])

  useEffect(() => { resetCamera() }, [resetCamera, resetKey, mode])
  const lastCommand = useRef(0)
  useEffect(() => {
    if (!keyboard.action || lastCommand.current === keyboard.sequence) return
    lastCommand.current = keyboard.sequence
    if (keyboard.action === 'home') { resetCamera(); return }
    const target = controls.current?.target ?? new THREE.Vector3(0, targetY, 0)
    const spherical = new THREE.Spherical().setFromVector3(new THREE.Vector3().subVectors(camera.position, target))
    if (keyboard.action === 'left' || keyboard.action === 'right') spherical.theta += keyboard.action === 'left' ? -0.15 : 0.15
    else spherical.radius = THREE.MathUtils.clamp(spherical.radius * (keyboard.action === 'out' ? 1.1 : 0.9), 0.12, 4.5)
    camera.position.copy(new THREE.Vector3().setFromSpherical(spherical).add(target))
    camera.lookAt(target)
    controls.current?.update()
    invalidate()
  }, [keyboard, camera, targetY, resetCamera, invalidate])

  useEffect(() => { onReady?.() }, [onReady])

  return <>
    <SceneLighting mode={mode} roomStyle={roomStyle} ceilingLightTemperature={parameters.ceilingLightTemperature} ceilingLightIntensity={parameters.ceilingLightIntensity} />
    <SceneEnvironment mode={mode} roomStyle={roomStyle} floorY={floorY} manufacturing={manufacturing} />
    {manufacturing ? <ManufacturingModel parameters={parameters} mode={mode} /> : <Lamp parameters={parameters} lightOn={lightOn} floorY={floorY} />}
    {/* The furnished room uses the lights' cast shadows. ContactShadows captures
        all visible geometry, including architecture, so reserve that extra
        grounding pass for isolated models to avoid phantom floor patches. */}
    {mode !== 'room' && <ContactShadows position={[0, floorY + 0.001, 0]} opacity={0.48} scale={1.5} blur={2.1} far={0.85} resolution={512} frames={1} key={`${mode}-${parameters.width}-${parameters.depth}-${parameters.height}-${parameters.expansion}-${parameters.twist}-${parameters.modulation}-${parameters.rotation}-${parameters.attachment}-${parameters.electronicsBox}-${parameters.electronicsBoxHeight}-${parameters.lightSource}-${parameters.lightDiameter}-${parameters.bulbDiameter}-${parameters.bulbHeight}-${parameters.secondBulbHeight}`} />}
    <OrbitControls ref={controls} makeDefault enableDamping={false} enablePan minDistance={0.12} maxDistance={4.5} minPolarAngle={0.15} maxPolarAngle={Math.PI / 2 - 0.015} target={[0, targetY, 0]} />
  </>
}

function ViewerFallback() {
  return <div className="viewer-fallback" role="status" style={{ height: '100%', minHeight: 320, display: 'grid', placeContent: 'center', padding: 32, textAlign: 'center', background: '#e9e5da', color: '#54574d' }}>
    <svg width="104" height="160" viewBox="0 0 104 160" fill="none" aria-hidden="true" style={{ margin: '0 auto 20px' }}>
      <path d="M17 153V7h70v146M17 12h70M17 144h70" stroke="#a68b63" strokeWidth="4" />
      {Array.from({ length: 16 }, (_, i) => <path key={i} d={`M23 ${17 + i * 7.5}L81 ${20 + i * 7.5}L23 ${24 + i * 7.5}`} stroke="#c6bc9e" strokeWidth="2" />)}
    </svg>
    <strong>3D preview is unavailable</strong>
    <p style={{ maxWidth: 320, marginTop: 8, fontSize: 13 }}>Enable WebGL to explore the room. Your settings, geometry checks, and exports remain available.</p>
  </div>
}

class ViewerBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <ViewerFallback /> : this.props.children }
}

export function LampViewer(props: LampViewerProps) {
  const [keyboard, setKeyboard] = useState<KeyboardCommand>({ action: null, sequence: 0 })
  const isManufacturing = ['print', 'materials', 'section'].includes(props.mode)
  return <ViewerBoundary>
    <div
      className="lamp-canvas"
      style={{ width: '100%', height: '100%', minHeight: 300, touchAction: 'none' }}
      tabIndex={0}
      role="region"
      aria-label={`${isManufacturing ? 'Compressed manufacturing model' : 'Approximate expanded lamp'} 3D preview. Drag to orbit, scroll to zoom. Keyboard: left and right arrows orbit; plus and minus zoom; Home resets.`}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          setKeyboard(current => ({ action: event.key === 'ArrowLeft' ? 'left' : 'right', sequence: current.sequence + 1 }))
        } else if (event.key === '+' || event.key === '=' || event.key === '-') {
          event.preventDefault()
          setKeyboard(current => ({ action: event.key === '-' ? 'out' : 'in', sequence: current.sequence + 1 }))
        } else if (event.key === 'Home') {
          event.preventDefault()
          setKeyboard(current => ({ action: 'home', sequence: current.sequence + 1 }))
        }
      }}
    >
      <Canvas
        shadows="percentage"
        frameloop="demand"
        dpr={[1, 1.75]}
        camera={{ position: [0.7, 0.7, 1.3], fov: 35, near: 0.01, far: 30 }}
        // ContactShadows needs transparent clears for its offscreen texture.
        // The scene background still keeps the visible room opaque.
        gl={{ antialias: true, alpha: true, localClippingEnabled: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.12 }}
        fallback={<ViewerFallback />}
      >
        <ShadowQualityProvider
          enabled={!isManufacturing}
          sceneKey={JSON.stringify([props.parameters, props.mode, props.roomStyle, props.lightOn])}
          animated={props.lightOn && props.parameters.lightIntensity > 0 && props.parameters.lightFlicker > 0}
        >
          <Scene {...props} keyboard={keyboard} />
        </ShadowQualityProvider>
      </Canvas>
    </div>
  </ViewerBoundary>
}
