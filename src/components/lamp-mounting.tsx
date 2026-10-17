import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { LampParameters } from '@/lib/lamp'
import { deriveMounting, MOUNTING } from '@/lib/mounting'
import { previewContour } from '@/lib/preview-geometry'

interface LampMountingProps {
  parameters: LampParameters
  /** Distance between the oak frame's side-rail centre lines, in metres. */
  frameWidth: number
  frameDepth: number
}

const PLATE = MOUNTING.plateThickness / 1000
const SHAFT_RADIUS = MOUNTING.screwRadius / 1000
const BORE_RADIUS = SHAFT_RADIUS + 0.00015
const DIRECTIONS = [new THREE.Vector2(1, 0), new THREE.Vector2(0, 1), new THREE.Vector2(-1, 0), new THREE.Vector2(0, -1)]

/** Contours use X/Z; Shape uses X/Y. The reflection and final rotation preserve
 * the preview's positive X/Z twist, which is opposite Three's Y rotation. */
function plateGeometry(outline: THREE.Vector2[], holes: THREE.Vector2[][], bores: THREE.Vector2[]) {
  const shape = new THREE.Shape(outline.map(point => new THREE.Vector2(point.x, -point.y)))
  for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(point => new THREE.Vector2(point.x, -point.y))))
  for (const point of bores) {
    const bore = new THREE.Path()
    bore.absarc(point.x, -point.y, BORE_RADIUS, 0, Math.PI * 2, true)
    shape.holes.push(bore)
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: PLATE, bevelEnabled: false, steps: 1, curveSegments: 12 })
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, -PLATE / 2, 0)
  geometry.computeBoundingSphere()
  return geometry
}

function cross(a: THREE.Vector2, b: THREE.Vector2) {
  return a.x * b.y - a.y * b.x
}

/** Locate a cardinal attachment on the actual rotated perimeter, including
 * polygon faces and rounded corners, rather than using its bounding box. */
function radiusOnRay(contour: THREE.Vector2[], direction: THREE.Vector2) {
  let radius = 0
  for (let index = 0; index < contour.length; index += 1) {
    const a = contour[index]
    const edge = contour[(index + 1) % contour.length].clone().sub(a)
    const denominator = cross(direction, edge)
    if (Math.abs(denominator) < 1e-12) continue
    const distance = cross(a, edge) / denominator
    const fraction = cross(a, direction) / denominator
    if (distance > 0 && fraction >= -1e-8 && fraction <= 1 + 1e-8) radius = Math.max(radius, distance)
  }
  return radius
}

function Fastener({ point, bottom, top }: { point: THREE.Vector2; bottom: number; top: number }) {
  return <group position={[point.x, 0, point.y]}>
    <mesh position={[0, (bottom + top) / 2 - 0.0005, 0]} castShadow>
      <cylinderGeometry args={[SHAFT_RADIUS, SHAFT_RADIUS, top - bottom + 0.003, 12]} />
      <meshStandardMaterial color="#77756b" metalness={0.7} roughness={0.38} />
    </mesh>
    {[top + 0.00035, bottom - 0.00035].map(y => <mesh key={y} position={[0, y, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[0.0028, 0.0028, 0.0007, 20]} />
      <meshStandardMaterial color="#a38a59" metalness={0.65} roughness={0.38} />
    </mesh>)}
    <mesh position={[0, top + 0.0015, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[0.0027, 0.0027, 0.0016, 20]} />
      <meshStandardMaterial color="#b69b64" metalness={0.7} roughness={0.36} />
    </mesh>
    {/* A narrow dark recess makes the slotted screw head readable up close. */}
    <mesh position={[0, top + 0.00231, 0]}>
      <boxGeometry args={[0.0037, 0.00003, 0.00045]} />
      <meshStandardMaterial color="#514a38" roughness={0.8} />
    </mesh>
    <mesh position={[0, bottom - 0.0016, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[0.0029, 0.0029, 0.0018, 6]} />
      <meshStandardMaterial color="#a38a59" metalness={0.65} roughness={0.4} />
    </mesh>
  </group>
}

/** Separate assembly hardware, never included in the printable shade export.
 * Both terminal membranes are captured between two rigid perimeter jaws. The
 * bolts sit inside the aperture lip, so they do not puncture the TPU flange. */
export function LampMounting({ parameters, frameWidth, frameDepth }: LampMountingProps) {
  const mounting = deriveMounting(parameters)
  const membrane = parameters.tpuLayers * parameters.layerHeight / 1000
  const assemblies = useMemo(() => {
    const mount = deriveMounting(parameters)
    if (!mount.canMount) return []
    return [false, true].map(upper => {
      const angle = upper ? THREE.MathUtils.degToRad(parameters.twist) : 0
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const contour = (inset: number) => previewContour(parameters, inset).map(point => new THREE.Vector2(
        (point.x * cos - point.y * sin) / 1000,
        (point.x * sin + point.y * cos) / 1000,
      ))
      const outer = contour(parameters.bandWidth - mount.gripWidth)
      const inner = contour(parameters.bandWidth + mount.apertureIntrusion)
      const screwContour = contour(parameters.bandWidth + mount.apertureIntrusion / 2)
      const screws = DIRECTIONS.map(direction => direction.clone().multiplyScalar(radiusOnRay(screwContour, direction)))
      const jaw = plateGeometry(outer, [inner], screws)
      const y = (upper ? mount.upperY : mount.lowerY) / 1000
      const linkY = (upper ? mount.upperLinkY : mount.lowerLinkY) / 1000
      const links = DIRECTIONS.map((direction, index) => {
        const screw = screws[index]
        const radius = screw.length()
        const frameRadius = (direction.x ? frameWidth : frameDepth) / 2
        const frameScrew = direction.clone().multiplyScalar(frameRadius)
        const tangent = new THREE.Vector2(-direction.y, direction.x).multiplyScalar(MOUNTING.bracketWidth / 2000)
        // The link laps over the clamp bolt and extends across the oak rail.
        const start = direction.clone().multiplyScalar(radius - 0.0027)
        const end = direction.clone().multiplyScalar(frameRadius + MOUNTING.framePostWidth / 2000 - 0.001)
        const outline = [start.clone().add(tangent), end.clone().add(tangent), end.clone().sub(tangent), start.clone().sub(tangent)]
        return { geometry: plateGeometry(outline, [], [screw, frameScrew]), screw, frameScrew }
      })
      return { upper, jaw, y, linkY, links }
    })
  }, [parameters, frameWidth, frameDepth])

  useEffect(() => () => {
    for (const assembly of assemblies) {
      assembly.jaw.dispose()
      for (const link of assembly.links) link.geometry.dispose()
    }
  }, [assemblies])

  if (!mounting.canMount) return null
  return <group name="top-and-bottom-tension-mounts">
    {assemblies.map(assembly => <group key={assembly.upper ? 'top' : 'bottom'}>
      {[-1, 1].map(sign => <mesh key={sign} geometry={assembly.jaw} position={[0, assembly.y + sign * (membrane / 2 + PLATE / 2), 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#625f50" metalness={0.5} roughness={0.48} />
      </mesh>)}
      {assembly.links.map((link, index) => <group key={index}>
        <mesh geometry={link.geometry} position={[0, assembly.linkY, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#625f50" metalness={0.5} roughness={0.48} />
        </mesh>
        <Fastener
          point={link.screw}
          bottom={assembly.y - membrane / 2 - PLATE - (assembly.upper ? 0 : PLATE)}
          top={assembly.y + membrane / 2 + PLATE + (assembly.upper ? PLATE : 0)}
        />
        <Fastener point={link.frameScrew} bottom={assembly.linkY - PLATE / 2 - MOUNTING.frameRailHeight / 1000} top={assembly.linkY + PLATE / 2} />
      </group>)}
    </group>)}
  </group>
}
