import { describe, expect, it } from 'vitest'
import { NoColorSpace, RepeatWrapping, SRGBColorSpace } from 'three'
import { createWoodMaterials, woodBoxGeometry, woodTexturePixels, WOOD_TILE_LENGTH, WOOD_TILE_WIDTH, type GrainAxis } from './wood-texture'
import { WOOD_SPECIES, type WoodSpecies } from './wood'

type Tuple = [number, number, number]

function faceVertices(size: Tuple, position: Tuple, grain: GrainAxis, normal: Tuple, offset = 0) {
  const geometry = woodBoxGeometry(size, position, grain, offset)
  try {
    const vertices = geometry.getAttribute('position')
    const normals = geometry.getAttribute('normal')
    const uv = geometry.getAttribute('uv')
    return Array.from({ length: vertices.count }, (_, index) => index)
      .filter(index => normal.every((value, axis) => normals.getComponent(index, axis) === value))
      .map(index => ({
        point: position.map((value, axis) => value + vertices.getComponent(index, axis)),
        uv: [uv.getX(index), uv.getY(index)],
      }))
  } finally {
    geometry.dispose()
  }
}

function averageLuminance(species: WoodSpecies, endGrain: boolean) {
  const { color } = woodTexturePixels(species, endGrain, 96, 128)
  let luminance = 0
  const linear = (channel: number) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  for (let index = 0; index < color.length; index += 4) {
    luminance += 0.2126 * linear(color[index]) + 0.7152 * linear(color[index + 1]) + 0.0722 * linear(color[index + 2])
  }
  return luminance / (color.length / 4)
}

describe('wood board mapping', () => {
  it.each(['x', 'y', 'z'] as const)('uses end grain only on the two %s-axis cuts', grain => {
    const geometry = woodBoxGeometry([0.31, 0.023, 0.17], [0.2, 0.3, -0.1], grain)
    try {
      const normals = geometry.getAttribute('normal')
      const grainAxis = ['x', 'y', 'z'].indexOf(grain)
      const ends = geometry.groups.filter(group => group.materialIndex === 1)
      expect(ends).toHaveLength(2)
      expect(geometry.groups.filter(group => group.materialIndex === 0)).toHaveLength(4)
      for (const group of ends) {
        const vertex = geometry.index!.getX(group.start)
        expect(Math.abs(normals.getComponent(vertex, grainAxis))).toBe(1)
      }
    } finally {
      geometry.dispose()
    }
  })

  it.each(['x', 'y', 'z'] as const)('keeps the same physical grain scale along a %s-axis board', grain => {
    const axis = ['x', 'y', 'z'].indexOf(grain)
    const across = (axis + 1) % 3
    const normalAxis = (axis + 2) % 3
    const size: Tuple = [0.012, 0.012, 0.012]
    size[axis] = WOOD_TILE_LENGTH * 0.5
    size[across] = WOOD_TILE_WIDTH * 0.25
    const normal: Tuple = [0, 0, 0]
    normal[normalAxis] = 1
    const face = faceVertices(size, [0.2, 0.3, -0.1], grain, normal)
    expect(face).toHaveLength(4)
    const alongRange = Math.max(...face.map(vertex => vertex.uv[1])) - Math.min(...face.map(vertex => vertex.uv[1]))
    const acrossRange = Math.max(...face.map(vertex => vertex.uv[0])) - Math.min(...face.map(vertex => vertex.uv[0]))
    expect(alongRange).toBeCloseTo(0.5, 6)
    expect(acrossRange).toBeCloseTo(0.25, 6)
    // Two points at the same longitudinal station share their grain coordinate,
    // so the long fibres cannot turn across the member's width.
    const grouped = new Map<number, number[]>()
    for (const vertex of face) {
      const station = vertex.point[axis]
      grouped.set(station, [...(grouped.get(station) ?? []), vertex.uv[1]])
    }
    expect(grouped.size).toBe(2)
    for (const values of grouped.values()) expect(values[0]).toBeCloseTo(values[1], 7)
  })

  it('preserves grain at a seam when a cable panel is split into separate meshes', () => {
    const normal: Tuple = [0, 0, 1]
    const left = faceVertices([0.08, 0.04, 0.006], [-0.04, 0.08, -0.1], 'x', normal, 0.67)
    const right = faceVertices([0.12, 0.04, 0.006], [0.06, 0.08, -0.1], 'x', normal, 0.67)
    const leftSeam = left.filter(vertex => Math.abs(vertex.point[0]) < 1e-8).sort((a, b) => a.point[1] - b.point[1])
    const rightSeam = right.filter(vertex => Math.abs(vertex.point[0]) < 1e-8).sort((a, b) => a.point[1] - b.point[1])
    expect(leftSeam).toHaveLength(2)
    expect(rightSeam).toHaveLength(2)
    leftSeam.forEach((vertex, index) => vertex.uv.forEach((value, channel) => expect(value).toBeCloseTo(rightSeam[index].uv[channel], 6)))
  })
})

describe('wood texture appearance', () => {
  it.each(WOOD_SPECIES)('creates opaque, varied, bounded colour and relief for %s', species => {
    for (const endGrain of [false, true]) {
      const { color, relief, width, height } = woodTexturePixels(species, endGrain, 64, 96)
      expect(color).toHaveLength(width * height * 4)
      expect(relief).toHaveLength(color.length)
      const colors = new Set<string>()
      const depths = new Set<number>()
      let minChannel = 255, maxChannel = 0, invalidAlpha = 0, nonGrayRelief = 0
      for (let index = 0; index < color.length; index += 4) {
        colors.add(`${color[index]},${color[index + 1]},${color[index + 2]}`)
        depths.add(relief[index])
        // Exclude clipped or wrapped channels rather than only checking the
        // Uint8Array's automatic 0–255 representation.
        for (let channel = 0; channel < 3; channel++) {
          minChannel = Math.min(minChannel, color[index + channel])
          maxChannel = Math.max(maxChannel, color[index + channel])
          if (relief[index + channel] !== relief[index]) nonGrayRelief++
        }
        if (color[index + 3] !== 255 || relief[index + 3] !== 255) invalidAlpha++
      }
      expect(minChannel).toBeGreaterThan(16)
      expect(maxChannel).toBeLessThan(245)
      expect(invalidAlpha).toBe(0)
      expect(nonGrayRelief).toBe(0)
      expect(colors.size).toBeGreaterThan(50)
      expect(Math.min(...depths)).toBeGreaterThan(0)
      expect(Math.max(...depths)).toBeLessThan(255)
      expect(depths.size).toBeGreaterThan(10)
    }
  })

  it.each([false, true])('preserves the lightness order maple > oak > walnut (end grain: %s)', endGrain => {
    const maple = averageLuminance('maple', endGrain)
    const oak = averageLuminance('oak', endGrain)
    const walnut = averageLuminance('walnut', endGrain)
    expect(maple).toBeGreaterThan(oak * 1.5)
    expect(oak).toBeGreaterThan(walnut * 1.8)
  })

  it.each([false, true])('repeats without a distinct tile-edge colour jump (end grain: %s)', endGrain => {
    const { color, width, height } = woodTexturePixels('oak', endGrain)
    let adjacentX = 0, adjacentY = 0, seamX = 0, seamY = 0
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        for (let channel = 0; channel < 3; channel++) {
          const value = color[(row * width + column) * 4 + channel]
          if (column < width - 1) adjacentX += Math.abs(value - color[(row * width + column + 1) * 4 + channel])
          else seamX += Math.abs(value - color[row * width * 4 + channel])
          if (row < height - 1) adjacentY += Math.abs(value - color[((row + 1) * width + column) * 4 + channel])
          else seamY += Math.abs(value - color[column * 4 + channel])
        }
      }
    }
    // Border pixels sample neighbouring points rather than identical points.
    // Their average jump should resemble the texture's ordinary pixel changes,
    // including the deliberately irregular fine fibres and pores.
    expect(seamX / (height * 3)).toBeLessThan(adjacentX / ((width - 1) * height * 3) * 1.4 + 0.2)
    expect(seamY / (width * 3)).toBeLessThan(adjacentY / ((height - 1) * width * 3) * 1.4 + 0.2)
  })

  it('uses un-tinted sRGB colour and linear relief maps on diffuse timber', () => {
    const materials = createWoodMaterials('oak')
    try {
      expect(materials).toHaveLength(2)
      for (const material of materials) {
        expect(material.color.getHex()).toBe(0xffffff)
        expect(material.metalness).toBe(0)
        expect(material.roughness).toBeGreaterThan(0.6)
        expect(material.roughness).toBeLessThan(1)
        expect(material.map!.colorSpace).toBe(SRGBColorSpace)
        expect(material.bumpMap!.colorSpace).toBe(NoColorSpace)
        expect(material.map!.wrapS).toBe(RepeatWrapping)
        expect(material.map!.wrapT).toBe(RepeatWrapping)
        expect(material.bumpScale).toBeGreaterThan(0)
        expect(material.bumpScale).toBeLessThan(0.0002)
      }
    } finally {
      materials.forEach(material => {
        material.map!.dispose()
        material.bumpMap!.dispose()
        material.dispose()
      })
    }
  })
})
