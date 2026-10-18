import { deriveLamp, type LampParameters } from '@/lib/lamp'
import { cutoutContourPoint, cutoutLayerRange, cutoutPolygons, cutoutProfile, cutoutRecessFace } from '@/lib/cutout-patterns'
import { TEXT_COLORS, textPolygons, textPrintCoordinates } from '@/lib/text-projection'

/** A true normal offset for the supported circular and rounded-rectangle contours. */
function contourPath(p: LampParameters, offset: number) {
  const width = p.width - 2 * offset
  const depth = (p.shape === 'circle' ? p.width : p.depth) - 2 * offset
  if (p.shape === 'circle') {
    const radius = width / 2
    const cx = p.width / 2
    const cy = p.width / 2
    return `M ${cx - radius} ${cy} a ${radius} ${radius} 0 1 0 ${2 * radius} 0 a ${radius} ${radius} 0 1 0 ${-2 * radius} 0 Z`
  }
  const radius = p.cornerRadius - offset
  const x = offset
  const y = offset
  return `M ${x + radius} ${y} H ${x + width - radius} A ${radius} ${radius} 0 0 1 ${x + width} ${y + radius} V ${y + depth - radius} A ${radius} ${radius} 0 0 1 ${x + width - radius} ${y + depth} H ${x + radius} A ${radius} ${radius} 0 0 1 ${x} ${y + depth - radius} V ${y + radius} A ${radius} ${radius} 0 0 1 ${x + radius} ${y} Z`
}

export function ringPath(p: LampParameters, outside: number, inside: number) {
  return `${contourPath(p, outside)} ${contourPath(p, inside)}`
}

export const mm = (value: number) => `${value.toFixed(2).replace(/0$/, '')} mm`

export type Point = readonly [number, number]

/** Intersect the same accent polygons used for printing with one fixed radial
 * section. Parameters run from the aperture (0) to the outside edge (1). */
export function sectionIntervals(polygons: readonly (readonly Point[])[], inner: Point, outer: Point) {
  const direction = [outer[0] - inner[0], outer[1] - inner[1]]
  const intervals = polygons.flatMap(polygon => {
    const crossings: number[] = []
    polygon.forEach((a, index) => {
      const b = polygon[(index + 1) % polygon.length]
      const edge = [b[0] - a[0], b[1] - a[1]]
      const determinant = direction[0] * edge[1] - direction[1] * edge[0]
      if (Math.abs(determinant) < 1e-10) return
      const delta = [a[0] - inner[0], a[1] - inner[1]]
      const alongEdge = (delta[0] * direction[1] - delta[1] * direction[0]) / determinant
      if (alongEdge < 0 || alongEdge >= 1) return
      crossings.push((delta[0] * edge[1] - delta[1] * edge[0]) / determinant)
    })
    crossings.sort((a, b) => a - b)
    const pieces: [number, number][] = []
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const from = Math.max(0, crossings[index])
      const to = Math.min(1, crossings[index + 1])
      if (to - from > 1e-8) pieces.push([from, to])
    }
    return pieces
  }).sort((a, b) => a[0] - b[0])
  return intervals.reduce<[number, number][]>((merged, interval) => {
    const last = merged.at(-1)
    if (last && interval[0] <= last[1] + 1e-8) last[1] = Math.max(last[1], interval[1])
    else merged.push([...interval])
    return merged
  }, [])
}

function textSectionFraction(p: LampParameters, polygon: readonly Point[]) {
  const centre = polygon.reduce((point, [x, y]) => [point[0] + x / polygon.length, point[1] + y / polygon.length], [0, 0])
  return textPrintCoordinates(p, centre[0], centre[1]).u
}

function polygonArea(polygon: readonly Point[]) {
  return Math.abs(polygon.reduce((area, [x, y], index) => {
    const next = polygon[(index + 1) % polygon.length]
    return area + x * next[1] - next[0] * y
  }, 0)) / 2
}

export type TextLayout = ReturnType<typeof textPolygons>[]

export function findTextSection(p: LampParameters, textLayout: TextLayout) {
  let sheet = -1
  let area = 0
  let polygon: readonly Point[] | undefined
  textLayout.forEach((polygons, index) => {
    const total = polygons.reduce((sum, region) => sum + polygonArea(region), 0)
    if (total <= area) return
    area = total
    sheet = index
    polygon = polygons.reduce((largest, region) => polygonArea(region) > polygonArea(largest) ? region : largest)
  })
  return { sheet, fraction: polygon ? textSectionFraction(p, polygon) : null }
}

/** Nominal print-layer state and diagram coordinates, independent of React. */
export function deriveLayerView(p: LampParameters, d: ReturnType<typeof deriveLamp>, requestedLayer: number, textLayout: TextLayout, textSection: ReturnType<typeof findTextSection>) {
  const textSheet = textSection.sheet
  const textColor = TEXT_COLORS[p.textColor]
  const totalLayers = d.sheets * p.tpuLayers + d.separators * p.separatorLayers
  const layer = Math.min(requestedLayer, totalLayers - 1)
  const stride = p.tpuLayers + p.separatorLayers
  const sheet = Math.floor(layer / stride)
  const withinBlock = layer % stride
  const membrane = withinBlock < p.tpuLayers
  const pattern = cutoutProfile(p)
  const recessFace = cutoutRecessFace(p, sheet)
  const recessLayers = cutoutLayerRange(p, sheet)
  const patternedSheet = recessLayers !== null
  const recessedLayer = membrane && recessLayers !== null && withinBlock >= recessLayers[0] && withinBlock < recessLayers[1]
  const recesses = recessedLayer ? cutoutPolygons(p, sheet) : []
  const accent = membrane ? textLayout[sheet] ?? [] : []
  const hasAccent = accent.length > 0
  const sheets = Array.from({ length: d.sheets }, (_, index) => index)
  const topPatternSheet = sheets.find(index => cutoutRecessFace(p, index) === 'top')
  const bottomPatternSheet = sheets.find(index => cutoutRecessFace(p, index) === 'bottom')
  const outerJoin = sheet % 2 === 0
  const layerKind = membrane ? recessedLayer ? hasAccent ? 'Two-color TPU + PLA recesses' : 'Patterned TPU + PLA recesses' : hasAccent ? 'Two-color TPU membrane' : 'Full TPU membrane' : `${outerJoin ? 'Outer' : 'Inner'} join + PLA separator`
  const effectiveDepth = p.shape === 'circle' ? p.width : p.depth
  const margin = Math.max(p.width, effectiveDepth) * 0.13
  const outlineWidth = Math.max(p.width, effectiveDepth) * 0.003
  const diagramText = Math.max(p.width, effectiveDepth) * 0.045
  const shownSheets = Math.min(6, d.sheets)
  const startSheet = Math.min(Math.max(0, sheet - 2), d.sheets - shownSheets)
  const sectionLayerCount = shownSheets * p.tpuLayers + (shownSheets - 1) * p.separatorLayers
  const layerPx = Math.min(7, 180 / sectionLayerCount)
  const sectionBottom = 215
  const membranePx = p.tpuLayers * layerPx
  const separatorPx = p.separatorLayers * layerPx
  const sectionWidth = 220
  const x = 48
  const activeY = sectionBottom - (layer - startSheet * stride + 1) * layerPx
  const sectionFraction = textSection.fraction ?? 0.5 / pattern.count
  const sectionInner = cutoutContourPoint(p, sectionFraction, p.bandWidth)
  const sectionOuter = cutoutContourPoint(p, sectionFraction, 0)

  const footprintDescription = recessedLayer ? `PLA fills the ${recessFace} pattern recesses at the outer edge, connected to the separator ${recessFace === 'top' ? 'above' : 'below'}. A continuous TPU membrane remains ${recessFace === 'top' ? 'below' : 'above'} the recesses. All patterned PLA pulls out from outside.` : membrane ? 'The entire washer-shaped footprint is TPU, with an open central aperture.' : `TPU occupies the ${outerJoin ? 'outer' : 'inner'} joining rim. PLA occupies the remaining membrane footprint and can be removed from the ${outerJoin ? 'central aperture' : 'outside'}.`
  const footprintCaption = recessedLayer ? 'PLA exits at the outer edge' : membrane ? `${p.bandWidth} mm full membrane band` : `${outerJoin ? p.outerConnector : p.innerConnector} mm TPU ${outerJoin ? 'outer' : 'inner'} join`
  const detail = recessedLayer ? `PLA fills the ${recessFace} recesses and joins the separator ${recessFace === 'top' ? 'above' : 'below'}. Peel it out from outside the shade. ${p.cutoutLayers} continuous TPU layer(s), ${mm(pattern.remainingThickness)}, remain ${recessFace === 'top' ? 'below' : 'above'} each pattern.` : membrane ? patternedSheet ? `This layer is continuous TPU. The ${recessFace === 'top' ? 'upper' : 'lower'} ${p.tpuLayers - p.cutoutLayers} layer(s) contain the outside-opening pattern recesses; the inner fold stays ${mm(d.membraneThickness)} thick.` : `All ${p.tpuLayers} layers of this ${mm(d.membraneThickness)} membrane use TPU across the full band. The open centre stays empty.` : `This ${mm(d.separatorThickness)} gap contains both materials: a ${mm(outerJoin ? p.outerConnector : p.innerConnector)} TPU join at the ${outerJoin ? 'outer' : 'inner'} rim and PLA everywhere else in the band. Remove this separator from ${outerJoin ? 'inside the central aperture' : 'outside the shade'}.`
  const skippedPatternSheet = pattern.enabled && membrane && !patternedSheet && sheet > 0 && sheet < d.sheets - 1
  return {
    p, d, textLayout, textSheet, textColor,
    totalLayers, layer, stride, sheet, membrane, patternedSheet, recessedLayer, outerJoin, layerKind,
    pattern, recesses, accent, hasAccent, topPatternSheet, bottomPatternSheet, skippedPatternSheet,
    effectiveDepth, margin, outlineWidth, diagramText, footprintDescription, footprintCaption, detail,
    shownSheets, startSheet, layerPx, sectionBottom, membranePx, separatorPx, sectionWidth, x, activeY,
    sectionFraction, sectionInner, sectionOuter,
  }
}

export type LayerView = ReturnType<typeof deriveLayerView>

