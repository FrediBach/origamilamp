import type { LampParameters } from './lamp'

/** Separate, conceptual mounting hardware. All dimensions are millimetres. */
export const MOUNTING = {
  gripWidth: 8,
  apertureIntrusion: 6,
  plateThickness: 3,
  screwRadius: 1.5,
  bracketWidth: 10,
  framePostWidth: 12,
  frameRailHeight: 14,
  shadeBottom: 66,
  springShadeLift: 24,
  springRailOffset: 34,
  springClampEyeOffset: 11,
  springFrameEyeInset: 4,
  springMaxRadialSpan: 42,
  springCoilRadius: 2.6,
  springWireRadius: 0.55,
  springEyeRadius: 3,
  springHookRadius: 2.3,
  springTurns: 10,
} as const

export function deriveMounting(p: LampParameters) {
  const sheets = 2 * p.pleats
  const activeLegs = Math.max(0, sheets - 2)
  const membraneThickness = p.tpuLayers * p.layerHeight
  const compressedHeight = (sheets * p.tpuLayers + (sheets - 1) * p.separatorLayers) * p.layerHeight
  // The terminal washers are reserved as flat gripping flanges. A one-pleat
  // specimen still prints, but has no free membrane left for this arrangement.
  const displayHeight = activeLegs > 0
    ? compressedHeight + (p.height - compressedHeight) * p.expansion / 100
    : compressedHeight
  const gripWidth = Math.min(MOUNTING.gripWidth, Math.max(0, p.bandWidth - p.outerConnector - 2))
  const effectiveDepth = p.shape === 'circle' ? p.width : p.depth
  const minimumOpening = Math.min(p.width, effectiveDepth) - 2 * (p.bandWidth + MOUNTING.apertureIntrusion)
  const minimumMountedHeight = Math.max(20, 2 * (2 * MOUNTING.plateThickness + membraneThickness + 3))
  const linkOffset = membraneThickness / 2 + MOUNTING.plateThickness * 1.5
  const springs = p.attachment === 'springs'
  // Lower springs need room beneath the flange and above the base board.
  const lowerY = MOUNTING.shadeBottom + (springs ? MOUNTING.springShadeLift : 0)
  const upperY = lowerY + displayHeight
  const lowerLinkY = lowerY - linkOffset
  const upperLinkY = upperY + linkOffset
  // Each support rests on top of its oak rail; bolts pass through both.
  const railOffset = (MOUNTING.plateThickness + MOUNTING.frameRailHeight) / 2
  return {
    gripWidth,
    apertureIntrusion: MOUNTING.apertureIntrusion,
    minimumOpening,
    lowerY,
    upperY,
    lowerLinkY,
    upperLinkY,
    // Imported recipes can have much thicker flanges than the normal UI range.
    // Keep the eye's rim and shank clear of the outside of its supporting lug.
    springClampEyeOffset: Math.max(MOUNTING.springClampEyeOffset, linkOffset + 6),
    lowerRailY: springs ? lowerY - MOUNTING.springRailOffset : lowerLinkY - railOffset,
    upperRailY: springs ? upperY + MOUNTING.springRailOffset : upperLinkY - railOffset,
    displayHeight,
    activeLegs,
    minimumMountedHeight,
    canMount: activeLegs > 0 && displayHeight >= minimumMountedHeight && minimumOpening > 0 && gripWidth >= 4,
  }
}
