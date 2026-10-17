import { describe, expect, it } from 'vitest'
import { BASE, baseFootprint, buildBaseParts, deriveBase, type BasePanel } from './base'
import { DEFAULT_PARAMETERS } from './lamp'
import { deriveLighting } from './lighting'
import { deriveMounting, MOUNTING } from './mounting'
import { buildExpandedGeometry, previewFrameDimensions } from './preview-geometry'

function contains(panel: BasePanel, point: [number, number, number]) {
  return point.every((value, axis) => Math.abs(value - panel.position[axis]) <= panel.size[axis] / 2)
}

function overlaps(a: BasePanel, b: BasePanel) {
  return a.position.every((value, axis) => Math.abs(value - b.position[axis]) < (a.size[axis] + b.size[axis]) / 2 - 1e-8)
}

describe('optional wooden electronics base', () => {
  it('retains the original board and mounting when disabled, regardless of stored cavity height', () => {
    const p = { ...DEFAULT_PARAMETERS, electronicsBox: false, electronicsBoxHeight: 120 }
    expect(deriveBase(p)).toMatchObject({ boardBottom: 36, boardTop: 48, internalHeight: 0, topY: 48, lift: 0 })
    expect(buildBaseParts(p, 215, 195)).toEqual([{ id: 'board', kind: 'board', position: [0, 42, 0], size: [207, 12, 187] }])
    expect(deriveMounting(p).lowerY).toBe(66)
  })

  it.each([20, 40, 120])('reserves %s mm of usable internal height, separately from floor and lid', electronicsBoxHeight => {
    const p = { ...DEFAULT_PARAMETERS, electronicsBox: true, electronicsBoxHeight }
    const base = deriveBase(p)
    expect(base.cavityBottom).toBe(48)
    expect(base.cavityTop - base.cavityBottom).toBe(electronicsBoxHeight)
    expect(base.topY).toBe(48 + electronicsBoxHeight + 6)
    expect(base.lift).toBe(electronicsBoxHeight + 6)
    const panels = buildBaseParts(p, 215, 195)
    const point: [number, number, number] = [0, (base.cavityBottom + base.cavityTop) / 2, 0]
    expect(panels.some(panel => contains(panel, point))).toBe(false)
    expect(panels.every(panel => panel.size.every(value => value > 0))).toBe(true)
  })

  it('derives the usable footprint from the actual expanded support frame', () => {
    const p = { ...DEFAULT_PARAMETERS, electronicsBox: true, twist: 90, modulation: 30, depth: 120 }
    const geometry = buildExpandedGeometry(p)
    try {
      const frame = previewFrameDimensions(geometry)
      const footprint = baseFootprint(frame.width * 1000, frame.depth * 1000)
      expect(footprint.outerWidth).toBeCloseTo(frame.width * 1000 - 8, 8)
      expect(footprint.outerDepth).toBeCloseTo(frame.depth * 1000 - 8, 8)
      expect(footprint.internalWidth).toBeCloseTo(footprint.outerWidth - 12, 8)
      expect(footprint.internalDepth).toBeCloseTo(footprint.outerDepth - 12, 8)
    } finally {
      geometry.dispose()
    }
  })

  it('has open cable passages through both rear wall and lid, with solid wood under the light support', () => {
    const p = { ...DEFAULT_PARAMETERS, electronicsBox: true, electronicsBoxHeight: 20 }
    const base = deriveBase(p)
    const footprint = baseFootprint(215, 195)
    const panels = buildBaseParts(p, 215, 195)
    const middleY = (base.cavityBottom + base.cavityTop) / 2
    for (const z of [-footprint.outerDepth / 2 - 1, -footprint.outerDepth / 2 + 3, -footprint.internalDepth / 2 + 1]) {
      expect(panels.some(panel => contains(panel, [0, middleY, z]))).toBe(false)
    }
    for (const y of [base.lidBottom - 1, base.lidBottom + 3, base.topY + 1]) {
      expect(panels.some(panel => contains(panel, [0, y, -footprint.outerDepth / 4]))).toBe(false)
    }
    expect(panels.some(panel => contains(panel, [0, base.topY - 1, 0]))).toBe(true)
    expect(panels.some(panel => contains(panel, [BASE.cableOpening, middleY, -footprint.outerDepth / 2 + 3]))).toBe(true)
  })

  it.each(['bolted', 'springs'] as const)('lifts the %s mounting and light together without changing clearances', attachment => {
    const original = { ...DEFAULT_PARAMETERS, attachment, electronicsBox: false }
    const p = { ...original, electronicsBox: true, electronicsBoxHeight: 120 }
    const base = deriveBase(p)
    const oldMount = deriveMounting(original)
    const mount = deriveMounting(p)
    for (const key of ['lowerY', 'upperY', 'lowerLinkY', 'upperLinkY', 'lowerRailY', 'upperRailY'] as const) {
      expect(mount[key] - oldMount[key]).toBeCloseTo(base.lift, 8)
    }
    expect(mount.displayHeight).toBe(oldMount.displayHeight)
    expect(mount.minimumOpening).toBe(oldMount.minimumOpening)
    expect(mount.canMount).toBe(oldMount.canMount)
    const light = deriveLighting(p)
    const oldLight = deriveLighting(original)
    light.sources.forEach((source, i) => {
      expect(source.centerY - oldLight.sources[i].centerY).toBeCloseTo(base.lift, 8)
      expect(source.centerY - source.height / 2 - base.topY).toBeCloseTo(oldLight.sources[i].centerY - oldLight.sources[i].height / 2 - 48, 8)
    })
    const w = 215, d = 195
    const rails: BasePanel[] = [
      { id: 'front', kind: 'wall', position: [0, mount.lowerRailY, d / 2], size: [w + 12, MOUNTING.frameRailHeight, 12] },
      { id: 'back', kind: 'wall', position: [0, mount.lowerRailY, -d / 2], size: [w + 12, MOUNTING.frameRailHeight, 12] },
      { id: 'left', kind: 'wall', position: [-w / 2, mount.lowerRailY, 0], size: [12, MOUNTING.frameRailHeight, d] },
      { id: 'right', kind: 'wall', position: [w / 2, mount.lowerRailY, 0], size: [12, MOUNTING.frameRailHeight, d] },
    ]
    for (const panel of buildBaseParts(p, w, d)) {
      expect(rails.some(rail => overlaps(panel, rail)), `${panel.id} clears all lower rails`).toBe(false)
    }
  })
})
