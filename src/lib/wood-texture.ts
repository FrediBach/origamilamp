import { BoxGeometry, DataTexture, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial, RepeatWrapping, RGBAFormat, SRGBColorSpace } from 'three'
import { WOOD_FINISHES, type WoodSpecies } from './wood'

export type GrainAxis = 'x' | 'y' | 'z'
type Tuple = [number, number, number]

// One texture tile represents a 120 mm wide, 800 mm long piece of timber.
// UVs use metres, so wide panels and slender rails share the same grain scale.
export const WOOD_TILE_WIDTH = 0.12
export const WOOD_TILE_LENGTH = 0.8
const TAU = Math.PI * 2
const smooth = (v: number) => v * v * (3 - 2 * v)
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const fract = (v: number) => v - Math.floor(v)
const hash = (x: number, y: number) => fract(Math.sin(x * 127.1 + y * 311.7 + 74.7) * 43758.5453)
const wrap = (v: number, period: number) => (v % period + period) % period

/** Periodic value noise makes the maps seamless, including tall custom lamps. */
function noise(x: number, y: number, periodX: number, periodY: number) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const u = smooth(fract(x)), v = smooth(fract(y))
  const sample = (dx: number, dy: number) => hash(wrap(ix + dx, periodX), wrap(iy + dy, periodY))
  return mix(mix(sample(0, 0), sample(1, 0), u), mix(sample(0, 1), sample(1, 1), u), v)
}

function rgb(hex: string) {
  return [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16))
}

export function woodTexturePixels(species: WoodSpecies, endGrain: boolean, width = endGrain ? 256 : 512, height = endGrain ? 256 : 1024) {
  const finish = WOOD_FINISHES[species]
  const base = rgb(finish.color), dark = rgb(finish.darkColor), light = rgb(finish.lightColor)
  const color = new Uint8Array(width * height * 4)
  const relief = new Uint8Array(width * height * 4)
  const oak = species === 'oak' || species === 'smoked-oak'
  const ringCount = species === 'maple' ? 31 : species === 'cherry' ? 25 : species === 'walnut' ? 19 : 22
  for (let row = 0; row < height; row++) {
    const v = row / height
    for (let column = 0; column < width; column++) {
      const u = column / width
      const broad = noise(u * 8, v * 4, 8, 4)
      const fiber = noise(u * 128, v * 32, 128, 32)
      const fine = hash(column, row)
      let phase: number
      if (endGrain) {
        // Curved growth rings on a periodic domain keep wide sawn board ends
        // continuous when they span more than one texture tile.
        const radius = Math.sqrt(3.2 - 1.3 * Math.cos((u + 0.17) * TAU) - 1.2 * Math.cos((v + 0.31) * TAU))
        phase = radius * ringCount * 0.6 + broad * 0.5
      } else {
        // Unequal growth bands meander along the board. The slow elliptical
        // modulation opens occasional cathedral figures without zebra stripes.
        const bend = Math.sin(v * TAU) * 0.9 + Math.sin(v * TAU * 3 + 0.7) * 0.45
        const cathedral = Math.sin(u * TAU + Math.sin(v * TAU * 2) * 1.4) * (1.8 + Math.cos(v * TAU * 2 + 0.8) * 1.4)
        const unevenGrowth = noise(u * 8, 0.5, 8, 1) * 2.6
        phase = u * ringCount + bend + cathedral + unevenGrowth + noise(u * 16, v * 8, 16, 8) * 0.35
      }
      const ring = (Math.sin(phase * TAU) + 1) / 2
      // Latewood varies in strength along each fibre. Unbroken, equally dark
      // bands read as laminated plywood, especially on the broad box walls.
      const latewood = Math.pow(ring, 12) * (endGrain ? 1 : 0.3 + noise(u * 32, v * 12, 32, 12) * 0.7)
      const earlywood = Math.pow(1 - ring, 2)
      const poreNoise = noise(u * 256, v * (endGrain ? 256 : 128), 256, endGrain ? 256 : 128)
      const pores = Math.max(0, (poreNoise - 0.57) / 0.43) * (0.3 + latewood * 0.7) * finish.poreStrength
      // Short medullary ray flecks distinguish the open-grained oak finishes.
      const ray = oak && !endGrain ? Math.pow(noise(u * 32, v * 256, 32, 256), 12) * 0.25 : 0
      const darken = Math.min(0.86, latewood * finish.grainContrast * 0.75 + pores * 0.55 + (1 - broad) * 0.11)
      const brighten = earlywood * 0.15 + broad * 0.16 + ray
      const index = (row * width + column) * 4
      for (let channel = 0; channel < 3; channel++) {
        color[index + channel] = Math.round(mix(mix(base[channel], dark[channel], darken), light[channel], brighten) + (fiber - 0.5) * 3 + (fine - 0.5) * 1.5)
      }
      const depth = Math.round(182 - pores * 115 - latewood * finish.poreStrength * 27 + (fiber - 0.5) * 10)
      relief[index] = relief[index + 1] = relief[index + 2] = depth
      color[index + 3] = relief[index + 3] = 255
    }
  }
  return { color, relief, width, height }
}

function texture(data: Uint8Array, width: number, height: number, color: boolean) {
  const map = new DataTexture(data, width, height, RGBAFormat)
  map.wrapS = map.wrapT = RepeatWrapping
  map.magFilter = LinearFilter
  map.minFilter = LinearMipmapLinearFilter
  map.generateMipmaps = true
  map.anisotropy = 8
  if (color) map.colorSpace = SRGBColorSpace
  map.needsUpdate = true
  return map
}

/** Shared materials for the side faces and sawn ends of one finish. */
export function createWoodMaterials(species: WoodSpecies) {
  const finish = WOOD_FINISHES[species]
  return [false, true].map(endGrain => {
    const pixels = woodTexturePixels(species, endGrain)
    const map = texture(pixels.color, pixels.width, pixels.height, true)
    const bumpMap = texture(pixels.relief, pixels.width, pixels.height, false)
    return new MeshStandardMaterial({
      map, bumpMap, bumpScale: 0.00009 * finish.poreStrength,
      roughness: finish.roughness + (endGrain ? 0.04 : 0),
      // Natural timber remains diffuse; the room's lights supply its brightness.
      metalness: 0,
    })
  })
}

/** A board uses its longitudinal axis on every side, and end grain on its cuts.
 * Absolute coordinates preserve a continuous grain across split cable panels. */
export function woodBoxGeometry(size: Tuple, position: Tuple, grain: GrainAxis, offset = 0) {
  const geometry = new BoxGeometry(...size)
  const vertices = geometry.getAttribute('position')
  const normals = geometry.getAttribute('normal')
  const uv = geometry.getAttribute('uv')
  const axis = grain === 'x' ? 0 : grain === 'y' ? 1 : 2
  const across = [0, 1, 2].filter(value => value !== axis)
  for (let i = 0; i < vertices.count; i++) {
    const point = [vertices.getX(i) + position[0], vertices.getY(i) + position[1], vertices.getZ(i) + position[2]]
    const normal = [normals.getX(i), normals.getY(i), normals.getZ(i)]
    const end = Math.abs(normal[axis]) > 0.5
    uv.setXY(i,
      (end ? point[across[0]] : point[across[0]] + point[across[1]]) / WOOD_TILE_WIDTH + offset,
      (end ? point[across[1]] / WOOD_TILE_WIDTH : point[axis] / WOOD_TILE_LENGTH) + offset * 0.37,
    )
  }
  for (const group of geometry.groups) {
    const vertex = geometry.index!.getX(group.start)
    const normal = [normals.getX(vertex), normals.getY(vertex), normals.getZ(vertex)]
    group.materialIndex = Math.abs(normal[axis]) > 0.5 ? 1 : 0
  }
  return geometry
}
