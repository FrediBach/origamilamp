import type { LampParameters } from './lamp'

const TAU = 2 * Math.PI
const RECTANGLE_DRAFT = 0.04

function outerPerimeter(p: LampParameters): number {
  if (p.shape === 'circle') return Math.PI * p.width
  if (p.shape === 'rounded-rectangle') return 2 * (p.width + p.depth - 4 * p.cornerRadius) + TAU * p.cornerRadius
  let perimeter = 0
  for (let side = 0; side < p.sides; side++) {
    const a = cutoutContourPoint(p, side / p.sides, 0)
    const b = cutoutContourPoint(p, (side + 1) / p.sides, 0)
    perimeter += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  return perimeter
}

/** Manufacturing and optics share nominal, unexpanded sheet coordinates:
 * u follows the outer perimeter counterclockwise, and inset runs outer→inner. */
export function cutoutProfile(p: LampParameters) {
  const count = Math.max(4, Math.min(32, Math.round(p.cutoutCount || 12)))
  const gapFraction = Math.max(5, Math.min(80, Number.isFinite(p.cutoutSpacing) ? p.cutoutSpacing : 30)) / 100
  const mouthFraction = 1 - gapFraction
  const every = Math.max(1, Math.min(24, Math.round(Number.isFinite(p.cutoutEvery) ? p.cutoutEvery : 1)))
  const phaseStep = Math.max(-100, Math.min(100, Number.isFinite(p.cutoutPhase) ? p.cutoutPhase : 0)) / 100
  const outerPerimeterMm = outerPerimeter(p)
  const pitchMm = outerPerimeterMm / count
  const normalThickness = p.tpuLayers * p.layerHeight
  const remainingThickness = p.cutoutLayers * p.layerHeight
  const webMm = p.extrusionWidth
  const depthMm = Math.max(0, Math.min(
    p.bandWidth * p.cutoutDepth / 100,
    p.bandWidth - Math.max(p.innerConnector, p.outerConnector) - webMm,
  ))
  const rectangleSideHalfWidthMm = pitchMm * mouthFraction / 2 * (1 - RECTANGLE_DRAFT)
  const rectangleCornerMm = Math.min(depthMm * .3, rectangleSideHalfWidthMm * .45)
  return {
    enabled: p.cutoutPattern !== 'none' && p.pleats > 1 && depthMm > 0 && remainingThickness > 0 && remainingThickness < normalThickness,
    count, depthMm, normalThickness, remainingThickness, halfWidth: mouthFraction / (2 * count), webMm,
    gapFraction, mouthFraction, every, phaseStep, outerPerimeterMm, gapMm: pitchMm * gapFraction, mouthMm: pitchMm * mouthFraction,
    rectangleSideHalfWidthMm, rectangleCornerMm,
  }
}

/** Phase is measured in repeat pitches and advances on every physical
 * membrane, including skipped ones. Sheet one is the zero-phase reference. */
export function cutoutPhaseAt(p: LampParameters, sheet: number): number {
  const cycles = (sheet - 1) * cutoutProfile(p).phaseStep
  return ((cycles % 1) + 1) % 1
}

/** Each active sheet recess faces the adjacent outward-open separator gap.
 * Odd sheets open upward, even sheets downward; the opposite gap has an
 * outer TPU join and must never receive patterned PLA. */
export function cutoutRecessFace(p: LampParameters, sheet: number): 'top' | 'bottom' | null {
  const { enabled, every } = cutoutProfile(p)
  if (!enabled || sheet <= 0 || sheet >= p.pleats * 2 - 1 || (sheet - 1) % every !== 0) return null
  return sheet % 2 === 1 ? 'top' : 'bottom'
}

/** Half-open print-layer range within a membrane that contains the recess. */
export function cutoutLayerRange(p: LampParameters, sheet: number): readonly [number, number] | null {
  const face = cutoutRecessFace(p, sheet)
  if (face === null) return null
  return face === 'top' ? [p.cutoutLayers, p.tpuLayers] : [0, p.tpuLayers - p.cutoutLayers]
}

/** Depth of the open recess at u, measured inward from the outside perimeter.
 * Each section widens monotonically toward the mouth; even rectangles have
 * a small draft instead of an enclosed keyhole or a reverse-facing shoulder. */
export function cutoutDepthAt(p: LampParameters, perimeterFraction: number, sheet = 1): number {
  const profile = cutoutProfile(p)
  if (!profile.enabled) return 0
  const cycle = ((perimeterFraction * profile.count - cutoutPhaseAt(p, sheet)) % 1 + 1) % 1
  const across = Math.abs(cycle - 0.5) / (profile.mouthFraction / 2)
  if (across >= 1 - 1e-12) return 0
  if (p.cutoutPattern === 'triangles') return profile.depthMm * (1 - across)
  if (p.cutoutPattern === 'half-circles') return profile.depthMm * Math.sqrt(Math.max(0, 1 - across * across))
  if (p.cutoutPattern === 'rectangles') {
    const halfMouth = profile.mouthMm / 2, side = profile.rectangleSideHalfWidthMm, radius = profile.rectangleCornerMm
    const x = across * halfMouth
    if (x <= side - radius) return profile.depthMm
    if (x <= side) return profile.depthMm - radius + Math.sqrt(Math.max(0, radius * radius - (x - side + radius) ** 2))
    return (halfMouth - x) * (profile.depthMm - radius) / (halfMouth - side)
  }
  return 0
}

export function cutoutAt(p: LampParameters, sheet: number, perimeterFraction: number, radialInsetFraction: number): boolean {
  if (cutoutRecessFace(p, sheet) === null || radialInsetFraction < 0 || radialInsetFraction > 1) return false
  const fromFreeEdge = radialInsetFraction * p.bandWidth
  const depth = cutoutDepthAt(p, perimeterFraction, sheet)
  return depth > 0 && fromFreeEdge < depth
}

/** Circular/rounded-rectangle points with true normal contour offsets. The
 * perimeter parameter is fixed to the OUTER outline, avoiding any pattern
 * drift between the printable layers and the expanded optical simulation. */
export function cutoutContourPoint(p: LampParameters, perimeterFraction: number, inset: number): readonly [number, number] {
  const u = ((perimeterFraction % 1) + 1) % 1
  if (p.shape === 'circle') {
    const angle = u * TAU
    const radius = p.width / 2 - inset
    return [radius * Math.cos(angle), radius * Math.sin(angle)]
  }
  if (p.shape === 'polygon') {
    const side = u * p.sides
    const corner = Math.floor(side)
    const t = side - corner
    const a = corner / p.sides * TAU + Math.PI / 4
    const b = (corner + 1) / p.sides * TAU + Math.PI / 4
    return [((1 - t) * Math.cos(a) + t * Math.cos(b)) * (p.width / 2 - inset), ((1 - t) * Math.sin(a) + t * Math.sin(b)) * (p.depth / 2 - inset)]
  }
  const r = p.cornerRadius
  const cx = p.width / 2 - r
  const cy = p.depth / 2 - r
  const arc = Math.PI * r / 2
  const lengths = [arc, 2 * cx, arc, 2 * cy, arc, 2 * cx, arc, 2 * cy]
  let distance = u * lengths.reduce((sum, length) => sum + length, 0)
  for (let section = 0; section < 8; section++) {
    const length = lengths[section]
    if (distance > length && section < 7) { distance -= length; continue }
    const t = length > 0 ? Math.min(1, distance / length) : 0
    if (section % 2 === 0) {
      const corner = section / 2
      const angle = (corner + t) * Math.PI / 2
      const centerX = corner === 0 || corner === 3 ? cx : -cx
      const centerY = corner < 2 ? cy : -cy
      return [centerX + (r - inset) * Math.cos(angle), centerY + (r - inset) * Math.sin(angle)]
    }
    if (section === 1) return [cx * (1 - 2 * t), p.depth / 2 - inset]
    if (section === 3) return [-p.width / 2 + inset, cy * (1 - 2 * t)]
    if (section === 5) return [cx * (2 * t - 1), -p.depth / 2 + inset]
    return [p.width / 2 - inset, cy * (2 * t - 1)]
  }
  return [p.width / 2 - inset, cy]
}

/** Include curve tangencies, pattern tips and mouths explicitly. These are
 * boundary-aligned samples, not a voxel grid or a staircase approximation. */
export function cutoutPerimeterSamples(p: LampParameters, sheet = 1): number[] {
  const samples = [0, 1]
  if (p.shape === 'rounded-rectangle') {
    const arc = Math.PI * p.cornerRadius / 2
    const lengths = [arc, p.width - 2 * p.cornerRadius, arc, p.depth - 2 * p.cornerRadius, arc, p.width - 2 * p.cornerRadius, arc, p.depth - 2 * p.cornerRadius]
    const perimeter = lengths.reduce((sum, length) => sum + length, 0)
    let distance = 0
    lengths.forEach((length, section) => {
      const steps = section % 2 === 0 ? 16 : 1
      for (let step = 0; step <= steps; step++) samples.push((distance + length * step / steps) / perimeter)
      distance += length
    })
  } else {
    for (let i = 1; i < 128; i++) samples.push(i / 128)
  }
  const { count, halfWidth, enabled, rectangleSideHalfWidthMm, rectangleCornerMm, outerPerimeterMm } = cutoutProfile(p)
  const phase = cutoutPhaseAt(p, sheet) / count
  const add = (u: number) => samples.push(((u % 1) + 1) % 1)
  if (enabled) for (let slot = 0; slot < count; slot++) {
    const center = (slot + 0.5) / count + phase
    if (p.cutoutPattern === 'half-circles') {
      for (let step = 0; step <= 16; step++) add(center + halfWidth * Math.cos(Math.PI * step / 16))
    } else {
      add(center - halfWidth); add(center); add(center + halfWidth)
      if (p.cutoutPattern === 'rectangles') for (const sign of [-1, 1]) for (let step = 0; step <= 8; step++) {
        add(center + sign * (rectangleSideHalfWidthMm - rectangleCornerMm + rectangleCornerMm * Math.cos(Math.PI / 2 * step / 8)) / outerPerimeterMm)
      }
    }
  }
  return samples.sort((a, b) => a - b).filter((value, index, all) => index === 0 || value - all[index - 1] > 1e-10)
}

interface CutoutNode { u: number; depth: number }
export interface CutoutFace {
  vertices: readonly [number, number, number]
  band: number
  outerCutout: boolean
}
export interface CutoutLayout {
  points: (readonly [number, number])[]
  faces: CutoutFace[]
  nodes: CutoutNode[]
}

/** A conforming planar arrangement of the outside-open recess boundaries and
 * all connector edges. Crossing points split both neighbours, so extrusion
 * produces shared vertices without T-junctions or overlapping closed slabs. */
export function buildCutoutLayout(p: LampParameters, sheet = 1): CutoutLayout {
  const samples = cutoutPerimeterSamples(p, sheet)
  const boundaries = (depth: number) => [0, p.outerConnector, p.bandWidth - p.innerConnector, p.bandWidth, depth]
  const rawNodes: CutoutNode[] = []
  for (let i = 0; i < samples.length - 1; i++) {
    const u0 = samples[i], u1 = samples[i + 1]
    const depth0 = cutoutDepthAt(p, u0, sheet), depth1 = cutoutDepthAt(p, u1, sheet)
    const a = boundaries(depth0), b = boundaries(depth1)
    const splits = [0]
    for (let left = 0; left < a.length; left++) for (let right = left + 1; right < a.length; right++) {
      const difference0 = a[left] - a[right], difference1 = b[left] - b[right]
      const denominator = difference0 - difference1
      if (Math.abs(denominator) < 1e-10) continue
      const t = difference0 / denominator
      if (t > 1e-9 && t < 1 - 1e-9) splits.push(t)
    }
    splits.sort((left, right) => left - right).filter((t, index, all) => index === 0 || t - all[index - 1] > 1e-9).forEach(t => {
      rawNodes.push({ u: u0 + (u1 - u0) * t, depth: depth0 + (depth1 - depth0) * t })
    })
  }
  rawNodes.push({ u: 1, depth: cutoutDepthAt(p, 1, sheet) })
  // Distinct mathematical samples can become one float32 contour vertex
  // while their recess tips round to opposite sides of a float32 boundary.
  // Coalesce these sub-resolution angular strips BEFORE triangulation rather
  // than dropping their inverted/sliver faces and leaving an open mesh.
  const resolution = Math.max(p.width, p.depth) * 2 ** -22 / cutoutProfile(p).outerPerimeterMm
  const anchors = new Set(cutoutPerimeterSamples({ ...p, cutoutPattern: 'none' }).map(u => u.toFixed(12)))
  const fixedDepths = [0, p.outerConnector, p.bandWidth - p.innerConnector, p.bandWidth]
  const snappedDepth = (depth: number) => fixedDepths.find(value => Math.abs(value - depth) < 1e-9)
  const nodes: CutoutNode[] = []
  for (const node of rawNodes) {
    const previous = nodes[nodes.length - 1]
    if (!previous || node.u - previous.u >= resolution) { nodes.push({ ...node }); continue }
    const keepNext = node.u === 1 || (previous.u !== 0 && anchors.has(node.u.toFixed(12)))
    // Retain exact contour tangencies and connector crossings whenever two
    // nearby samples merge, even if those anchors came from different nodes.
    previous.depth = snappedDepth(previous.depth) ?? snappedDepth(node.depth) ?? (keepNext ? node.depth : previous.depth)
    if (keepNext) previous.u = node.u
  }
  // u=0 and u=1 are one physical vertex. A near-seam crossing can merge
  // into only one end of the linear list, so apply its snap to both ends.
  const first = nodes[0], last = nodes[nodes.length - 1]
  first.depth = last.depth = snappedDepth(first.depth) ?? snappedDepth(last.depth) ?? first.depth
  const points: (readonly [number, number])[] = []
  const faces: CutoutFace[] = []
  const vertices = new Map<string, number>()
  const vertex = (node: number, inset: number) => {
    const [x, y] = cutoutContourPoint(p, nodes[node].u, inset)
    // STL and GPU coordinates are float32. Canonicalizing at that precision
    // merges mathematically coincident crossing vertices consistently.
    const px = Math.fround(x), py = Math.fround(y)
    const key = `${px}/${py}`
    const existing = vertices.get(key)
    if (existing !== undefined) return existing
    const index = points.length
    points.push([px, py]); vertices.set(key, index)
    return index
  }
  for (let node = 0; node < nodes.length - 1; node++) {
    const a = boundaries(nodes[node].depth), b = boundaries(nodes[node + 1].depth)
    const midpoint = a.map((value, index) => (value + b[index]) / 2)
    const ordered = midpoint.map((_, index) => index).sort((left, right) => midpoint[left] - midpoint[right])
      .filter((value, index, all) => index === 0 || midpoint[value] - midpoint[all[index - 1]] > 1e-8)
    for (let row = 0; row < ordered.length - 1; row++) {
      const low = ordered[row], high = ordered[row + 1]
      const inset = (midpoint[low] + midpoint[high]) / 2
      const depth = (nodes[node].depth + nodes[node + 1].depth) / 2
      const corners = [vertex(node, a[low]), vertex(node + 1, b[low]), vertex(node + 1, b[high]), vertex(node, a[high])]
        .filter((value, index, all) => value !== all[(index + all.length - 1) % all.length])
      const region = {
        band: inset < p.outerConnector ? 0 : inset > p.bandWidth - p.innerConnector ? 2 : 1,
        outerCutout: inset < depth - 1e-8,
      }
      for (let i = 1; i < corners.length - 1; i++) {
        const ids = [corners[0], corners[i], corners[i + 1]] as const
        const [pa, pb, pc] = ids.map(id => points[id])
        const area = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0])
        if (area > 1e-10) faces.push({ vertices: ids, ...region })
      }
    }
  }
  return { points, faces, nodes }
}

/** Recess outlines in print XY millimetres, following the same piecewise
 * linear boundaries as the printable solids. Intended for layer inspection. */
export function cutoutPolygons(p: LampParameters, sheet: number): (readonly [number, number])[][] {
  if (cutoutRecessFace(p, sheet) === null) return []
  const { nodes } = buildCutoutLayout(p, sheet)
  // Begin in a gap so a recess crossing u=0 stays one complete polygon.
  // The layout includes u=0 and u=1 as the same physical seam vertex.
  const gap = nodes.findIndex(node => node.depth <= 1e-8)
  const ring = nodes.slice(0, -1)
  const ordered = [...ring.slice(gap), ...ring.slice(0, gap), ring[gap]]
  const polygons: (readonly [number, number])[][] = []
  let start = -1
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].depth > 1e-8 && start < 0) start = Math.max(0, i - 1)
    if (start >= 0 && (ordered[i].depth <= 1e-8 || i === ordered.length - 1)) {
      const run = ordered.slice(start, i + 1)
      const mouth = run.map(({ u }) => cutoutContourPoint(p, u, 0))
      const boundary = run.slice().reverse().map(({ u, depth }) => cutoutContourPoint(p, u, depth))
      const polygon = [...mouth, ...boundary].filter((point, index, all) => {
        const previous = all[(index + all.length - 1) % all.length]
        return Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 1e-8
      })
      polygons.push(polygon)
      start = -1
    }
  }
  return polygons
}

/** Conservatively bound retained web width by measuring at the tighter inner
 * contour, although all recess mouths are outside. Short chords underestimate
 * arc width and preserve the existing two-extrusion-path safety allowance. */
export function cutoutMinimumWeb(p: LampParameters): number {
  const { count, halfWidth, every } = cutoutProfile(p)
  const phases = new Set<number>([0])
  for (let sheet = 1; sheet < p.pleats * 2 - 1; sheet += every) phases.add(Math.round(cutoutPhaseAt(p, sheet) * 1e10) / 1e10)
  let minimum = Infinity
  for (const phase of phases) for (let slot = 0; slot < count; slot++) {
    const from = (slot + 0.5 + phase) / count + halfWidth
    const to = (slot + 1.5 + phase) / count - halfWidth
    let length = 0
    let previous = cutoutContourPoint(p, from, p.bandWidth)
    for (let step = 1; step <= 16; step++) {
      const next = cutoutContourPoint(p, from + (to - from) * step / 16, p.bandWidth)
      length += Math.hypot(next[0] - previous[0], next[1] - previous[1])
      previous = next
    }
    minimum = Math.min(minimum, length)
  }
  return minimum
}
