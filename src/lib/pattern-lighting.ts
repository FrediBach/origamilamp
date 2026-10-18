import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { LampParameters } from './lamp'
import { cutoutAt, cutoutProfile } from './cutout-patterns'
import { deriveLighting, type PreviewLightSource } from './lighting'
import { deriveMounting } from './mounting'
import { buildExpandedGeometry } from './preview-geometry'
import { luminousCenter, pendantIndex } from './shade-transmission'

// A finite optical-depth map, not an opaque shadow or an additive floor decal.
// Ordinary point-light shadow maps still account for wood, clamps and furniture.
export const OPTICAL_LAYERS = 8
const ATTENUATION_PER_MM = 1.1
export type OpticalCrossing = { distance: number; transmission: number; thickness: number }

/** Include only dependencies which change the actual optical geometry. Power,
 * flicker, colour and room materials update lighting without rebuilding maps. */
export function patternLightingKey(p: LampParameters) {
  return JSON.stringify([
    p.shape, p.width, p.depth, p.height, p.sides, p.pleats, p.bandWidth, p.cornerRadius,
    p.twist, p.modulation, p.expansion, p.layerHeight, p.tpuLayers, p.separatorLayers,
    p.innerConnector, p.outerConnector, p.extrusionWidth, p.cutoutPattern,
    p.cutoutCount, p.cutoutSpacing, p.cutoutEvery, p.cutoutPhase, p.cutoutDepth, p.cutoutLayers, deriveMounting(p).lowerY,
    deriveLighting(p).sources,
  ])
}

/** Coordinates and intersections are in metres in the shade's local frame. */
export function createOpticalCaster(p: LampParameters, geometry?: THREE.BufferGeometry) {
  // BVH construction reorders triangles; keep the visible geometry untouched.
  const sourceGeometry = geometry ?? buildExpandedGeometry(p)
  const mesh = sourceGeometry.clone()
  if (!geometry) sourceGeometry.dispose()
  const bvh = new MeshBVH(mesh, { maxLeafTris: 8 })
  const coord = mesh.getAttribute('cutoutCoord')
  const joinedSheet = mesh.getAttribute('cutoutJoin')
  const position = mesh.getAttribute('position')
  const profile = cutoutProfile(p)
  const triangle = new THREE.Triangle()
  const barycentric = new THREE.Vector3()
  const nominal = new THREE.Vector3()
  const vertex = new THREE.Vector3()
  const normal = new THREE.Vector3()
  return {
    trace(origin: THREE.Vector3, direction: THREE.Vector3): OpticalCrossing[] {
      const hits = bvh.raycast(new THREE.Ray(origin, direction), THREE.DoubleSide, 0.00001).sort((a, b) => a.distance - b.distance)
      const crossings: OpticalCrossing[] = []
      let previous = -1
      for (const hit of hits) {
        // A ray on a diagonal/crease can hit two triangles of one membrane.
        if (!hit.face || hit.distance - previous < 1e-6) continue
        previous = hit.distance
        const indices = [hit.face.a, hit.face.b, hit.face.c]
        triangle.set(...indices.map(index => new THREE.Vector3().fromBufferAttribute(position, index)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3])
        triangle.getBarycoord(hit.point, barycentric)
        nominal.set(0, 0, 0)
        indices.forEach((index, i) => nominal.addScaledVector(vertex.fromBufferAttribute(coord, index), barycentric.getComponent(i)))
        const sheet = Math.round(nominal.z)
        let thickness = cutoutAt(p, sheet, nominal.x, nominal.y) ? profile.remainingThickness : profile.normalThickness
        const adjacent = joinedSheet ? Math.round(joinedSheet.getX(indices[0])) : -1
        const terminal = sheet === 0 || sheet === p.pleats * 2 - 1
        // Terminal flanges share only their outer joining strip. Every other
        // joined triangle is already confined to its flat crease band.
        if (adjacent >= 0 && (!terminal || nominal.y <= p.outerConnector / p.bandWidth)) {
          thickness += p.separatorLayers * p.layerHeight
            + (cutoutAt(p, adjacent, nominal.x, nominal.y) ? profile.remainingThickness : profile.normalThickness)
        }
        triangle.getNormal(normal)
        // The finite thickness and strong scattering of TPU bound grazing paths.
        const path = thickness / Math.max(0.15, Math.abs(normal.dot(direction)))
        crossings.push({ distance: hit.distance, transmission: Math.exp(-ATTENUATION_PER_MM * path), thickness })
      }
      return crossings
    },
    dispose() { mesh.dispose() },
  }
}

/** Useful for testing that internal hardware is lit before a membrane and that
 * another fold attenuates the ray again instead of creating an open light hole. */
export function transmissionBefore(crossings: OpticalCrossing[], distance: number) {
  return crossings.reduce((transmission, crossing) => crossing.distance < distance ? transmission * crossing.transmission : transmission, 1)
}

function blurTransmission(data: Float32Array, width: number, height: number, sigmaX: number, sigmaY: number) {
  // Blur transmission, never depth. This approximates a frosted finite emitter
  // plus TPU forward scattering while preserving which surfaces a ray crosses.
  for (const [axis, sigma] of [[0, sigmaX], [1, sigmaY]]) {
    const radius = Math.min(18, Math.ceil(sigma * 2))
    const weights = Array.from({ length: 2 * radius + 1 }, (_, i) => Math.exp(-0.5 * ((i - radius) / sigma) ** 2))
    const sum = weights.reduce((a, b) => a + b, 0)
    const copy = data.slice()
    for (let layer = 0; layer < OPTICAL_LAYERS; layer++) {
      const band = Math.floor(layer / 2)
      const channel = (layer % 2) * 2 + 1
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let transmission = 0
        for (let offset = -radius; offset <= radius; offset++) {
          const tx = axis === 0 ? (x + offset + width) % width : x
          const ty = axis === 1 ? Math.max(0, Math.min(height - 1, y + offset)) : y
          transmission += copy[((band * height + ty) * width + tx) * 4 + channel] * weights[offset + radius]
        }
        data[((band * height + y) * width + x) * 4 + channel] = transmission / sum
      }
    }
  }
}

export function buildPatternLightMap(p: LampParameters, source: PreviewLightSource, inverted = false, width = 192, height = 96, caster?: ReturnType<typeof createOpticalCaster>) {
  const opticalCaster = caster ?? createOpticalCaster(p)
  const data = new Float32Array(width * height * OPTICAL_LAYERS / 2 * 4)
  const sourceY = luminousCenter(source, inverted) / 1000
  const origin = new THREE.Vector3(0, sourceY - deriveMounting(p).lowerY / 1000, 0)
  const direction = new THREE.Vector3()
  for (let y = 0; y < height; y++) {
    const latitude = ((y + 0.5) / height - 0.5) * Math.PI
    for (let x = 0; x < width; x++) {
      const longitude = ((x + 0.5) / width - 0.5) * Math.PI * 2
      direction.set(Math.cos(latitude) * Math.cos(longitude), Math.sin(latitude), Math.cos(latitude) * Math.sin(longitude))
      const crossings = opticalCaster.trace(origin, direction)
      for (let layer = 0; layer < OPTICAL_LAYERS; layer++) {
        const offset = ((Math.floor(layer / 2) * height + y) * width + x) * 4 + (layer % 2) * 2
        const crossing = crossings[layer]
        // Empty samples carry unit transmission and zero depth, so bilinear
        // filtering at the silhouette never interpolates against infinity.
        data[offset] = crossing?.distance ?? 0
        data[offset + 1] = crossing?.transmission ?? 1
        // Extreme compressed views can cross more sheets than map layers.
        // Keep all their attenuation instead of silently dropping those folds.
        if (layer === OPTICAL_LAYERS - 1) for (const remainder of crossings.slice(OPTICAL_LAYERS)) data[offset + 1] *= remainder.transmission
      }
    }
  }
  if (!caster) opticalCaster.dispose()
  const radius = Math.max(15, Math.min(p.width, p.shape === 'circle' ? p.width : p.depth) / 2 - p.bandWidth / 2)
  const sigmaX = Math.max(0.65, width * Math.atan(source.diameter / (4 * radius)) / (Math.PI * 2))
  const sigmaY = Math.max(0.65, height * Math.atan((source.kind === 'led' ? source.height : source.diameter) / (4 * radius)) / Math.PI)
  blurTransmission(data, width, height, sigmaX, sigmaY)
  // Half-float linear filtering is available in WebGL2 without relying on the
  // optional full-float linear-filter extension (including Safari GPUs).
  const packed = Uint16Array.from(data, value => THREE.DataUtils.toHalfFloat(value))
  const texture = new THREE.DataTexture(packed, width, height * OPTICAL_LAYERS / 2, THREE.RGBAFormat, THREE.HalfFloatType)
  texture.wrapS = THREE.RepeatWrapping
  texture.minFilter = texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return { texture, sourceY }
}

export function buildPatternLightMaps(p: LampParameters, geometry: THREE.BufferGeometry) {
  if (!(p.layerHeight > 0 && p.tpuLayers > 0) || !Number.isFinite(p.layerHeight * p.tpuLayers)) return []
  const positions = geometry.getAttribute('position')
  // Invalid intermediate form values should stay editable rather than making
  // the BVH throw and permanently replacing the viewer with its error fallback.
  if (!positions || positions.count < 3 || !Array.from(positions.array).every(Number.isFinite)) return []
  const { sources } = deriveLighting(p)
  if (sources.some(source => ![source.centerY, source.height, source.diameter].every(Number.isFinite))) return []
  const pendant = pendantIndex(sources)
  const caster = createOpticalCaster(p, geometry)
  try { return sources.map((source, index) => buildPatternLightMap(p, source, index === pendant, 192, 96, caster)) }
  finally { caster.dispose() }
}
