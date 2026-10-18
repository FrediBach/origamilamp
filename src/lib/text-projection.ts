import { ShapeUtils, Vector2 } from 'three'
import * as clipping from 'polygon-clipping'
import type { Pair, Polygon } from 'polygon-clipping'
import type { LampParameters } from './lamp'
import { buildCutoutLayout, cutoutContourPoint, cutoutProfile, cutoutRecessFace, type CutoutLayout } from './cutout-patterns'
import { boldTextGeometry, polygonContains } from './text-font'

export const TEXT_COLORS = {
  black: { name: 'Black', hex: '#24211e', transmission: 0.012 },
  brown: { name: 'Brown', hex: '#63422e', transmission: 0.025 },
  beige: { name: 'Beige', hex: '#bda57f', transmission: 0.13 },
} as const

type Point = readonly [number, number]

/** Invert the supported constant-section contours. u remains the nominal
 * outside-perimeter parameter; inset is a true normal offset in millimetres. */
export function textPrintCoordinates(p: LampParameters, x: number, y: number): { u: number; inset: number; nx: number; ny: number } {
  const tau = 2 * Math.PI
  if (p.shape === 'circle' || p.shape === 'polygon') {
    const angle = (Math.atan2(y, x) + tau) % tau
    const radius = Math.hypot(x, y)
    return { u: angle / tau, inset: p.width / 2 - radius, nx: Math.cos(angle), ny: Math.sin(angle) }
  }
  const cx = p.width / 2 - p.cornerRadius, cy = p.depth / 2 - p.cornerRadius
  const qx = Math.max(-cx, Math.min(cx, x)), qy = Math.max(-cy, Math.min(cy, y))
  const dx = x - qx, dy = y - qy, radius = Math.hypot(dx, dy)
  const nx = radius ? dx / radius : 0, ny = radius ? dy / radius : 1
  const arc = Math.PI * p.cornerRadius / 2
  const lengths = [arc, 2 * cx, arc, 2 * cy, arc, 2 * cx, arc, 2 * cy]
  let section: number, along: number
  if (x > cx && y >= cy) { section = 0; along = Math.atan2(dy, dx) * p.cornerRadius }
  else if (y >= cy && x >= -cx) { section = 1; along = cx - x }
  else if (x <= -cx && y > cy) { section = 2; along = (Math.atan2(dy, dx) - Math.PI / 2) * p.cornerRadius }
  else if (x <= -cx && y >= -cy) { section = 3; along = cy - y }
  else if (x < -cx && y <= -cy) { section = 4; along = (Math.atan2(dy, dx) + Math.PI) * p.cornerRadius }
  else if (y <= -cy && x <= cx) { section = 5; along = x + cx }
  else if (x >= cx && y < -cy) { section = 6; along = (Math.atan2(dy, dx) + Math.PI / 2) * p.cornerRadius }
  else { section = 7; along = y + cy }
  const distance = lengths.slice(0, section).reduce((sum, value) => sum + value, 0) + along
  return { u: distance / lengths.reduce((sum, value) => sum + value, 0), inset: p.cornerRadius - radius, nx, ny }
}

export function textGlyphGeometry(p: Pick<LampParameters, 'text' | 'textSize'>) { return boldTextGeometry(p.text, p.textSize) }

export function textProjectionConfig(p: LampParameters) {
  const { width, height } = textGlyphGeometry(p)
  const perimeter = cutoutProfile(p).outerPerimeterMm
  const front = textPrintCoordinates(p, 0, -(p.shape === 'circle' ? p.width : p.depth) / 2).u
  const centerU = ((front + p.textAzimuth / 360) % 1 + 1) % 1
  const angle = p.textRotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle)
  const activeLegs = Math.max(0, p.pleats * 2 - 2)
  const targetHeight = activeLegs ? p.height : (p.tpuLayers * 2 + p.separatorLayers) * p.layerHeight
  const span = p.bandWidth - p.innerConnector - p.outerConnector
  const horizontalSpan = Math.abs(width * cos) + Math.abs(height * sin)
  return { perimeter, centerU, width, height, cos, sin, targetHeight, activeLegs, span,
    rise: activeLegs ? targetHeight / activeLegs : 0, horizontalOffset: p.textHorizontal,
    verticalCenter: targetHeight * p.textVertical / 100, horizontalSpan, copies: Math.ceil(horizontalSpan / perimeter) + 1 }
}

export function textWrapMetrics(p: LampParameters) {
  const { width, height, perimeter, horizontalSpan } = textProjectionConfig(p)
  return { width, height, perimeter, horizontalSpan }
}

type PlacedPolygon = { polygon: Polygon; minX: number; maxX: number; minY: number; maxY: number }
function createProjection(p: LampParameters) {
  const config = textProjectionConfig(p), { polygons } = textGlyphGeometry(p)
  const { perimeter, centerU, width, height, cos, sin, copies } = config
  const placed: PlacedPolygon[] = []
  for (let copy = -copies; copy <= copies; copy++) for (const glyph of polygons) {
    const polygon = glyph.map(ring => ring.map(([x, y]): Pair => [
      (x - width / 2) * cos - (y - height / 2) * sin + centerU * perimeter + p.textHorizontal + copy * perimeter,
      (x - width / 2) * sin + (y - height / 2) * cos + config.verticalCenter,
    ]))
    const all = polygon.flat()
    const bounds = { minX: Math.min(...all.map(v => v[0])), maxX: Math.max(...all.map(v => v[0])), minY: Math.min(...all.map(v => v[1])), maxY: Math.max(...all.map(v => v[1])) }
    if (bounds.maxX < 0 || bounds.minX > perimeter) continue
    placed.push({ polygon, ...bounds })
  }
  const heightAt = (sheet: number, inset: number) => {
    const f = Math.max(0, Math.min(1, (inset - p.outerConnector) / config.span))
    return sheet <= 0 ? 0 : sheet >= p.pleats * 2 - 1 ? config.targetHeight : ((sheet - 1) + (sheet % 2 ? f : 1 - f)) * config.rise
  }
  const chart = (sheet: number, x: number, y: number): [number, number] => {
    const { u, inset } = textPrintCoordinates(p, x, y)
    return [u * perimeter, heightAt(sheet, inset)]
  }
  const project = (sheet: number, x: number, y: number): [number, number, number] => {
    const [s, z] = chart(sheet, x, y)
    const raw = s - centerU * perimeter - p.textHorizontal
    const horizontal = ((raw + perimeter / 2) % perimeter + perimeter) % perimeter - perimeter / 2
    const vertical = z - config.verticalCenter
    return [horizontal * cos + vertical * sin + width / 2, -horizontal * sin + vertical * cos + height / 2, 1]
  }
  const at = (sheet: number, x: number, y: number) => {
    if (!p.textEnabled || sheet <= 0 || sheet >= p.pleats * 2 - 1) return false
    const { inset } = textPrintCoordinates(p, x, y)
    if (inset <= p.outerConnector || inset >= p.bandWidth - p.innerConnector) return false
    const [s, z] = chart(sheet, x, y)
    return placed.some(({ polygon, minX, maxX, minY, maxY }) => s >= minX && s <= maxX && z >= minY && z <= maxY && polygonContains(polygon, s, z))
  }
  return { project, at, placed, config, heightAt }
}

const samplerCache = new WeakMap<LampParameters, ReturnType<typeof createProjection>>()
function sampler(p: LampParameters) {
  let value = samplerCache.get(p)
  if (!value) { value = createProjection(p); samplerCache.set(p, value) }
  return value
}
export function textProjectionAtPoint(p: LampParameters, sheet: number, x: number, y: number): [number, number, number] { return sampler(p).project(sheet, x, y) }
export function textAtPrintPoint(p: LampParameters, sheet: number, x: number, y: number): boolean { return sampler(p).at(sheet, x, y) }
export function textProjectionPoint(p: LampParameters, sheet: number, u: number, insetFraction: number): [number, number, number] {
  return textProjectionAtPoint(p, sheet, ...cutoutContourPoint(p, u, insetFraction * p.bandWidth))
}
export function textAt(p: LampParameters, sheet: number, u: number, insetFraction: number): boolean {
  return textAtPrintPoint(p, sheet, ...cutoutContourPoint(p, u, insetFraction * p.bandWidth))
}

export interface TextLayout extends CutoutLayout {
  faces: (CutoutLayout['faces'][number] & { accent: boolean })[]
  pointInsets: number[]
  pointUs: number[]
}

/** Clip smooth glyph outlines against each existing membrane cell in the
 * unwrapped perimeter-height chart. Restore all shared-edge subdivisions after
 * triangulation so both TPU colors and every joining band remain conforming.
 * Inactive sheets reuse phase one's footprint, exactly as the uncolored solid
 * generator does, preserving every interface with the unchanged PLA part. */
export function buildTextLayout(p: LampParameters, sheet: number, source = buildCutoutLayout(p, cutoutRecessFace(p, sheet) === null ? 1 : sheet)): TextLayout {
  const result: TextLayout = { points: [], faces: [], nodes: source.nodes, pointInsets: [], pointUs: [] }
  const { placed, config, heightAt } = sampler(p)
  const positions = new Map<string, number>()
  const sourceEdges = new Map<string, Map<number, number>>()
  const outlineChains = new Map<string, number[]>()
  const sourceCoordinates = source.points.map(([x, y]) => {
    const value = textPrintCoordinates(p, x, y)
    const fixed = [0, p.outerConnector, p.bandWidth - p.innerConnector, p.bandWidth].find(v => Math.abs(v - value.inset) < .0001)
    return { ...value, inset: fixed ?? value.inset }
  })
  const addPoint = (x: number, y: number, inset: number, u: number) => {
    const px = Math.abs(x) < 1e-8 ? 0 : Math.fround(x), py = Math.abs(y) < 1e-8 ? 0 : Math.fround(y), key = `${px}/${py}`
    const previous = positions.get(key)
    if (previous !== undefined) return previous
    const id = result.points.length
    result.points.push([px, py]); result.pointInsets.push(inset); result.pointUs.push(((u % 1) + 1) % 1); positions.set(key, id)
    return id
  }
  const originalIds = source.points.map(([x, y], id) => addPoint(x, y, sourceCoordinates[id].inset, sourceCoordinates[id].u))
  const edgeKey = (a: number, b: number) => a < b ? `${a}/${b}` : `${b}/${a}`
  const edgePoint = (a: number, b: number, t: number, id: number) => {
    const key = edgeKey(a, b)
    let values = sourceEdges.get(key)
    if (!values) { values = new Map([[0, originalIds[Math.min(a, b)]], [1, originalIds[Math.max(a, b)]]]); sourceEdges.set(key, values) }
    values.set(Math.round((a < b ? t : 1 - t) * 1e9) / 1e9, id)
  }
  for (const face of source.faces) {
    const ids = face.vertices, info = ids.map(id => ({ ...sourceCoordinates[id] }))
    if (Math.max(...info.map(v => v.u)) - Math.min(...info.map(v => v.u)) > .5) info.forEach(v => { if (v.u < .5) v.u += 1 })
    const chart: Pair[] = info.map(v => [v.u * config.perimeter, heightAt(sheet, v.inset)])
    const [a, b, c] = chart
    const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    const minX = Math.min(...chart.map(v => v[0])), maxX = Math.max(...chart.map(v => v[0]))
    const minY = Math.min(...chart.map(v => v[1])), maxY = Math.max(...chart.map(v => v[1]))
    const glyphs = p.textEnabled && face.band === 1 && sheet > 0 && sheet < p.pleats * 2 - 1
      ? placed.filter(g => g.maxX >= minX && g.minX <= maxX && g.maxY >= minY && g.minY <= maxY).map(g => g.polygon) : []
    if (!glyphs.length || Math.abs(denominator) < 1e-9) { result.faces.push({ ...face, vertices: ids.map(id => originalIds[id]) as [number, number, number], accent: false }); continue }
    const glyphMask = glyphs.length === 1 ? [glyphs[0]] : clipping.union(...glyphs as [Polygon, ...Polygon[]])
    const tri: Polygon = [[...chart, chart[0]]]
    const accent = clipping.intersection(tri, glyphMask), base = clipping.difference(tri, glyphMask)
    const pointId = ([s, z]: Pair) => {
      let weights = [((b[1] - c[1]) * (s - c[0]) + (c[0] - b[0]) * (z - c[1])) / denominator,
        ((c[1] - a[1]) * (s - c[0]) + (a[0] - c[0]) * (z - c[1])) / denominator, 0]
      weights[2] = 1 - weights[0] - weights[1]
      weights = weights.map(w => Math.abs(w) < 1e-8 ? 0 : Math.abs(w - 1) < 1e-8 ? 1 : w)
      const exact = weights.findIndex(w => w === 1)
      if (exact >= 0) return originalIds[ids[exact]]
      const edge = weights.findIndex(w => w === 0)
      if (edge >= 0) {
        const ia = (edge + 1) % 3, ib = (edge + 2) % 3
        const t = Math.round(weights[ib] / (weights[ia] + weights[ib]) * 1e9) / 1e9
        weights = [0, 0, 0]; weights[ia] = 1 - t; weights[ib] = t
      }
      const x = ids.reduce((sum, id, i) => sum + source.points[id][0] * weights[i], 0), y = ids.reduce((sum, id, i) => sum + source.points[id][1] * weights[i], 0)
      const id = addPoint(x, y, info.reduce((sum, v, i) => sum + v.inset * weights[i], 0), info.reduce((sum, v, i) => sum + v.u * weights[i], 0))
      if (edge >= 0) { const ia = (edge + 1) % 3, ib = (edge + 2) % 3; edgePoint(ids[ia], ids[ib], weights[ib], id) }
      return id
    }
    for (const [polygons, color] of [[base, false], [accent, true]] as const) for (const polygon of polygons) {
      const rings = polygon.map(ring => {
        const original = ring.slice(0, -1), originalIds = original.map(pointId)
        const retained = original.map((_, i) => i).filter(i => {
          const a = original[(i + original.length - 1) % original.length], b = original[i], c = original[(i + 1) % original.length]
          const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
          return Math.abs(cross) > 1e-8 * Math.max(1, Math.hypot(c[0] - a[0], c[1] - a[1]))
        })
        for (let i = 0; i < retained.length; i++) {
          const a = retained[i], b = retained[(i + 1) % retained.length], chain = [originalIds[a]]
          for (let cursor = (a + 1) % original.length; cursor !== b; cursor = (cursor + 1) % original.length) chain.push(originalIds[cursor])
          chain.push(originalIds[b])
          if (chain.length > 2) outlineChains.set(edgeKey(chain[0], chain[chain.length - 1]), chain)
        }
        return retained.map(i => original[i])
      })
      if (rings[0].length < 3) continue
      const flat = rings.flat(), points = flat.map(pointId)
      const triangles = ShapeUtils.triangulateShape(rings[0].map(v => new Vector2(...v)), rings.slice(1).map(ring => ring.map(v => new Vector2(...v))))
      for (const triangle of triangles) {
        const vertices = triangle.map(i => points[i]) as [number, number, number]
        const [ca, cb, cc] = triangle.map(i => flat[i])
        const chartArea = (cb[0] - ca[0]) * (cc[1] - ca[1]) - (cb[1] - ca[1]) * (cc[0] - ca[0])
        if (Math.abs(chartArea) < 1e-8) {
          const pair = [[0, 1, 2], [1, 2, 0], [2, 0, 1]].sort((left, right) => {
            const distance = (order: number[]) => { const a = flat[triangle[order[0]]], b = flat[triangle[order[1]]]; return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 }
            return distance(right) - distance(left)
          })[0]
          const chain = [vertices[pair[0]], vertices[pair[2]], vertices[pair[1]]]
          outlineChains.set(edgeKey(chain[0], chain[2]), chain)
          continue
        }
        const [pa, pb, pc] = vertices.map(id => result.points[id])
        const area = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0])
        if (Math.abs(area) <= 1e-9) continue
        if (area < 0) [vertices[1], vertices[2]] = [vertices[2], vertices[1]]
        result.faces.push({ ...face, vertices, accent: color })
      }
    }
  }
  // Every original cell edge shares the same sorted split points, including
  // connector cells whose height-chart triangles collapse to horizontal lines.
  const chains = new Map<string, number[]>(outlineChains)
  for (const values of sourceEdges.values()) {
    const points = [...values.entries()].sort((a, b) => a[0] - b[0]).map(([, id]) => id)
      .filter((id, i, all) => !i || id !== all[i - 1])
    for (let left = 0; left < points.length - 2; left++) for (let right = left + 2; right < points.length; right++) chains.set(edgeKey(points[left], points[right]), points.slice(left, right + 1))
  }
  const faces = result.faces; result.faces = []
  for (const face of faces) {
    const outline: number[] = []
    for (let side = 0; side < 3; side++) {
      const a = face.vertices[side], b = face.vertices[(side + 1) % 3], chain = chains.get(edgeKey(a, b))
      if (chain) outline.push(...(chain[0] === a ? chain : chain.slice().reverse()).slice(0, -1))
      else outline.push(a)
    }
    if (outline.length === 3) { result.faces.push({ ...face, vertices: outline as [number, number, number] }); continue }
    // A centroid fan preserves every edge split without clipping away the last
    // positive-area ear and leaving a float32 sliver along a straight edge.
    const uv = face.vertices.map(id => result.pointUs[id])
    if (Math.max(...uv) - Math.min(...uv) > .5) uv.forEach((u, i) => { if (u < .5) uv[i] += 1 })
    const center = addPoint(
      face.vertices.reduce((sum, id) => sum + result.points[id][0], 0) / 3,
      face.vertices.reduce((sum, id) => sum + result.points[id][1], 0) / 3,
      face.vertices.reduce((sum, id) => sum + result.pointInsets[id], 0) / 3,
      uv.reduce((sum, u) => sum + u, 0) / 3,
    )
    for (let side = 0; side < outline.length; side++) {
      const a = outline[side], b = outline[(side + 1) % outline.length]
      if (a !== b) result.faces.push({ ...face, vertices: [a, b, center] })
    }
  }
  return relievePinchedCorners(p, result)
}

/** A concave glyph corner can exactly touch a connector or recess boundary.
 * Put a one-extrusion-width base-TPU bridge around that zero-width contact.
 * The volumes still partition the membrane, including after STL vertex welding. */
function relievePinchedCorners(p: LampParameters, layout: TextLayout): TextLayout {
  const edges = new Map<string, { ids: number[]; faces: number[] }>()
  layout.faces.forEach((face, index) => {
    for (let side = 0; side < 3; side++) {
      const a = face.vertices[side], b = face.vertices[(side + 1) % 3], key = a < b ? `${a}/${b}` : `${b}/${a}`
      let edge = edges.get(key)
      if (!edge) { edge = { ids: [a, b], faces: [] }; edges.set(key, edge) }
      edge.faces.push(index)
    }
  })
  const pinches = new Set<number>()
  for (const mode of [0, 1, 2]) {
    const crossings = new Map<number, number>()
    const selected = (face: number | undefined) => {
      if (face === undefined) return false
      const cell = layout.faces[face]
      return mode === 0 ? cell.accent : !cell.outerCutout && (mode === 1 ? cell.accent : !cell.accent)
    }
    for (const edge of edges.values()) if (selected(edge.faces[0]) !== selected(edge.faces[1])) {
      for (const id of edge.ids) crossings.set(id, (crossings.get(id) ?? 0) + 1)
    }
    for (const [id, count] of crossings) if (count > 2) pinches.add(id)
  }
  if (!pinches.size) return layout
  const halfWidth = p.extrusionWidth / 2
  const centers = [...pinches].map(id => layout.points[id])
  const cuts = centers.flatMap(([x, y]) => [{ axis: 'x' as const, value: x - halfWidth }, { axis: 'x' as const, value: x + halfWidth }, { axis: 'y' as const, value: y - halfWidth }, { axis: 'y' as const, value: y + halfWidth }])
  type ReliefVertex = { x: number; y: number; inset: number; u: number }
  const result: TextLayout = { points: [], faces: [], pointInsets: [], pointUs: [], nodes: layout.nodes }
  const vertices = new Map<string, number>()
  const index = (v: ReliefVertex) => {
    const x = Math.abs(v.x) < 1e-9 ? 0 : Math.fround(v.x), y = Math.abs(v.y) < 1e-9 ? 0 : Math.fround(v.y), key = `${x}/${y}`
    const previous = vertices.get(key)
    if (previous !== undefined) return previous
    const id = result.points.length
    result.points.push([x, y]); result.pointInsets.push(v.inset); result.pointUs.push(((v.u % 1) + 1) % 1); vertices.set(key, id)
    return id
  }
  const clip = (polygon: ReliefVertex[], axis: 'x' | 'y', value: number, positive: boolean) => {
    const result: ReliefVertex[] = []
    polygon.forEach((a, i) => {
      const b = polygon[(i + 1) % polygon.length], da = a[axis] - value, db = b[axis] - value
      if (positive ? da >= -1e-10 : da <= 1e-10) result.push(a)
      if ((da < -1e-10 && db > 1e-10) || (da > 1e-10 && db < -1e-10)) {
        const t = da / (da - db), point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, inset: a.inset + (b.inset - a.inset) * t, u: a.u + (b.u - a.u) * t }
        point[axis] = value; result.push(point)
      }
    })
    return result
  }
  for (const face of layout.faces) {
    const initial = face.vertices.map(id => ({ x: layout.points[id][0], y: layout.points[id][1], inset: layout.pointInsets[id], u: layout.pointUs[id] }))
    if (Math.max(...initial.map(v => v.u)) - Math.min(...initial.map(v => v.u)) > .5) initial.forEach(v => { if (v.u < .5) v.u += 1 })
    let polygons = [initial]
    for (const { axis, value } of cuts) if (value > Math.min(...initial.map(v => v[axis])) + 1e-9 && value < Math.max(...initial.map(v => v[axis])) - 1e-9) {
      polygons = polygons.flatMap(polygon => [clip(polygon, axis, value, false), clip(polygon, axis, value, true)].filter(polygon => polygon.length >= 3))
    }
    for (const polygon of polygons) {
      const x = polygon.reduce((sum, v) => sum + v.x, 0) / polygon.length, y = polygon.reduce((sum, v) => sum + v.y, 0) / polygon.length
      const accent = face.accent && !centers.some(([cx, cy]) => Math.abs(x - cx) < halfWidth && Math.abs(y - cy) < halfWidth)
      const ids = polygon.map(index).filter((id, i, all) => id !== all[(i + all.length - 1) % all.length])
      for (let i = 1; i < ids.length - 1; i++) {
        const [a, b, c] = [ids[0], ids[i], ids[i + 1]].map(id => result.points[id])
        if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 1e-10) result.faces.push({ ...face, accent, vertices: [ids[0], ids[i], ids[i + 1]] })
      }
    }
  }
  return result
}

/** Printable footprint before the alternating pattern recess removes layers. */
export function textPolygons(p: LampParameters, sheet: number): Point[][] {
  if (!p.textEnabled) return []
  const layout = buildTextLayout(p, sheet)
  return layout.faces.filter(face => face.accent).map(face => face.vertices.map(id => layout.points[id]))
}
