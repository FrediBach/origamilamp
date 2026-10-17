import type { LampParameters } from './lamp'

/** Separate wooden hardware; all dimensions and coordinates are millimetres. */
export const BASE = {
  boardBottom: 36,
  boardThickness: 12,
  wallThickness: 6,
  lidThickness: 6,
  footprintInset: 8,
  // Clears the lower bolted rails while retaining a 3.5 mm wall ledge.
  lidEdgeInset: 2.5,
  cableOpening: 10,
} as const

export function deriveBase(p: LampParameters) {
  const boardTop = BASE.boardBottom + BASE.boardThickness
  const internalHeight = p.electronicsBox ? p.electronicsBoxHeight : 0
  const cavityTop = boardTop + internalHeight
  const topY = cavityTop + (p.electronicsBox ? BASE.lidThickness : 0)
  return {
    enabled: p.electronicsBox,
    boardBottom: BASE.boardBottom,
    boardTop,
    internalHeight,
    cavityBottom: boardTop,
    cavityTop,
    lidBottom: cavityTop,
    topY,
    lift: topY - boardTop,
    wallThickness: BASE.wallThickness,
    lidThickness: BASE.lidThickness,
  }
}

/** Frame dimensions are post-center spacing, obtained from the expanded mesh. */
export function baseFootprint(frameWidthMM: number, frameDepthMM: number) {
  const outerWidth = frameWidthMM - BASE.footprintInset
  const outerDepth = frameDepthMM - BASE.footprintInset
  return {
    outerWidth,
    outerDepth,
    internalWidth: outerWidth - 2 * BASE.wallThickness,
    internalDepth: outerDepth - 2 * BASE.wallThickness,
  }
}

export interface BasePanel {
  id: string
  kind: 'board' | 'wall' | 'lid'
  position: [number, number, number]
  size: [number, number, number]
}

/** Actual hollow panels, including through-openings for a rear cable and lid
 * cable. The lid's small edge setback leaves a visible removable-cover seam. */
export function buildBaseParts(p: LampParameters, frameWidthMM: number, frameDepthMM: number): BasePanel[] {
  const base = deriveBase(p)
  const { outerWidth: width, outerDepth: depth, internalWidth } = baseFootprint(frameWidthMM, frameDepthMM)
  const panels: BasePanel[] = [{
    id: 'board', kind: 'board', position: [0, BASE.boardBottom + BASE.boardThickness / 2, 0],
    size: [width, BASE.boardThickness, depth],
  }]
  if (!base.enabled) return panels
  const wall = BASE.wallThickness
  const middleY = (base.cavityBottom + base.cavityTop) / 2
  const halfOpening = BASE.cableOpening / 2
  panels.push(
    { id: 'wall-left', kind: 'wall', position: [-(width - wall) / 2, middleY, 0], size: [wall, base.internalHeight, depth] },
    { id: 'wall-right', kind: 'wall', position: [(width - wall) / 2, middleY, 0], size: [wall, base.internalHeight, depth] },
    { id: 'wall-front', kind: 'wall', position: [0, middleY, (depth - wall) / 2], size: [internalWidth, base.internalHeight, wall] },
  )
  const rearZ = -(depth - wall) / 2
  const rearSideWidth = (internalWidth - BASE.cableOpening) / 2
  const rearCapHeight = (base.internalHeight - BASE.cableOpening) / 2
  panels.push(
    { id: 'wall-rear-left', kind: 'wall', position: [-(halfOpening + rearSideWidth / 2), middleY, rearZ], size: [rearSideWidth, base.internalHeight, wall] },
    { id: 'wall-rear-right', kind: 'wall', position: [halfOpening + rearSideWidth / 2, middleY, rearZ], size: [rearSideWidth, base.internalHeight, wall] },
    { id: 'wall-rear-bottom', kind: 'wall', position: [0, base.cavityBottom + rearCapHeight / 2, rearZ], size: [BASE.cableOpening, rearCapHeight, wall] },
    { id: 'wall-rear-top', kind: 'wall', position: [0, base.cavityTop - rearCapHeight / 2, rearZ], size: [BASE.cableOpening, rearCapHeight, wall] },
  )
  const lidWidth = width - 2 * BASE.lidEdgeInset
  const lidDepth = depth - 2 * BASE.lidEdgeInset
  const lidY = base.lidBottom + BASE.lidThickness / 2
  const lidSideWidth = (lidWidth - BASE.cableOpening) / 2
  // Offset the pass-through toward the rear, leaving wood under the central
  // lamp support. Every panel is solid; neither opening is painted onto a box.
  const holeZ = -depth / 4
  const rearLidDepth = lidDepth / 2 + holeZ - halfOpening
  const frontLidDepth = lidDepth / 2 - holeZ - halfOpening
  panels.push(
    { id: 'lid-left', kind: 'lid', position: [-(halfOpening + lidSideWidth / 2), lidY, 0], size: [lidSideWidth, BASE.lidThickness, lidDepth] },
    { id: 'lid-right', kind: 'lid', position: [halfOpening + lidSideWidth / 2, lidY, 0], size: [lidSideWidth, BASE.lidThickness, lidDepth] },
    { id: 'lid-rear', kind: 'lid', position: [0, lidY, -lidDepth / 2 + rearLidDepth / 2], size: [BASE.cableOpening, BASE.lidThickness, rearLidDepth] },
    { id: 'lid-front', kind: 'lid', position: [0, lidY, lidDepth / 2 - frontLidDepth / 2], size: [BASE.cableOpening, BASE.lidThickness, frontLidDepth] },
  )
  return panels
}
