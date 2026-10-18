import { useId, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Layers3 } from 'lucide-react'
import { deriveLamp, validateLamp, type LampParameters } from '@/lib/lamp'
import { cutoutContourPoint, cutoutDepthAt, cutoutLayerRange, cutoutPhaseAt, cutoutPolygons, cutoutProfile, cutoutRecessFace } from '@/lib/cutout-patterns'
import { TEXT_COLORS, textPolygons, textPrintCoordinates } from '@/lib/text-projection'
import './layer-inspector.css'

const TPU = '#f1e4c9'
const PLA = '#9caa90'
const INK = '#635e50'
const BLOCKING_CHECKS = new Set(['finite', 'dimensions', 'layers', 'contours', 'free-span', 'connectors', 'layer-height', 'values', 'cutout-range', 'cutout-thickness', 'cutout-sheets', 'cutout-web', 'text-range', 'text-content', 'text-sheets'])

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

function ringPath(p: LampParameters, outside: number, inside: number) {
  return `${contourPath(p, outside)} ${contourPath(p, inside)}`
}

const mm = (value: number) => `${value.toFixed(2).replace(/0$/, '')} mm`

type Point = readonly [number, number]

/** Intersect the same accent polygons used for printing with one fixed radial
 * section. Parameters run from the aperture (0) to the outside edge (1). */
function sectionIntervals(polygons: readonly (readonly Point[])[], inner: Point, outer: Point) {
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

export function LayerInspector({ parameters: p }: { parameters: LampParameters }) {
  const id = useId()
  const [requestedLayer, setRequestedLayer] = useState(0)
  const d = deriveLamp(p)
  const errors = validateLamp(p).filter(item => item.status === 'error' &&
    BLOCKING_CHECKS.has(item.id))
  const textLayout = useMemo(() => {
    if (!p.textEnabled || errors.length || p.shape === 'polygon') return []
    return Array.from({ length: d.sheets }, (_, sheet) => textPolygons(p, sheet))
  }, [p, d.sheets, errors.length])
  const textSection = useMemo(() => {
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
  }, [p, textLayout])
  const textSheet = textSection.sheet
  const textColor = TEXT_COLORS[p.textColor]

  if (errors.length) {
    return <div className="layer-inspector li-invalid" role="status">
      <Layers3 size={28} aria-hidden="true" />
      <h3>Adjust the print geometry first</h3>
      <p>The layer inspector needs a valid layer schedule and open, non-overlapping contour offsets.</p>
      <ul>{errors.map(error => <li key={error.id}>{error.detail}</li>)}</ul>
    </div>
  }

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

  return <div className="layer-inspector">
    <div className="li-summary">
      <div>
        <span className="li-eyebrow">Compressed print · {d.sheets} membranes</span>
        <h3>{layerKind}</h3>
      </div>
      <span className="li-z">Z {mm(layer * p.layerHeight)}–{mm((layer + 1) * p.layerHeight)}</span>
    </div>

    <div className="li-layer-control">
      <div className="li-slider-label">
        <label htmlFor={`${id}-layer`}>Print layer <strong>{layer + 1}</strong><span> / {totalLayers}</span></label>
        <span>{mm(p.layerHeight)} per layer</span>
      </div>
      <div className="li-slider-row">
        <button type="button" className="li-step" aria-label="Previous print layer" disabled={layer === 0} onClick={() => setRequestedLayer(layer - 1)}><ChevronLeft size={17} aria-hidden="true" /></button>
        <input id={`${id}-layer`} type="range" min={0} max={totalLayers - 1} step={1} value={layer} onChange={event => setRequestedLayer(Number(event.target.value))} aria-valuetext={`Layer ${layer + 1} of ${totalLayers}. ${layerKind}. Z ${mm(layer * p.layerHeight)} to ${mm((layer + 1) * p.layerHeight)}.`} />
        <button type="button" className="li-step" aria-label="Next print layer" disabled={layer === totalLayers - 1} onClick={() => setRequestedLayer(layer + 1)}><ChevronRight size={17} aria-hidden="true" /></button>
      </div>
      <div className="li-jumps" aria-label="Example print layers">
        <span>Jump to</span>
        <button type="button" onClick={() => setRequestedLayer(0)}>Membrane</button>
        {textSheet >= 0 && <button type="button" onClick={() => setRequestedLayer(textSheet * stride + (cutoutRecessFace(p, textSheet) === 'bottom' ? p.tpuLayers - p.cutoutLayers : 0))}>Text accent</button>}
        {topPatternSheet !== undefined && <button type="button" onClick={() => setRequestedLayer(topPatternSheet * stride + p.cutoutLayers)}>Top pattern layer</button>}
        {bottomPatternSheet !== undefined && <button type="button" onClick={() => setRequestedLayer(bottomPatternSheet * stride)}>Bottom pattern layer</button>}
        <button type="button" onClick={() => setRequestedLayer(p.tpuLayers)}>Outer join</button>
        {d.separators > 1 && <button type="button" onClick={() => setRequestedLayer(stride + p.tpuLayers)}>Inner join</button>}
      </div>
    </div>

    <div className="li-diagrams">
      <section className="li-diagram-panel" aria-labelledby={`${id}-footprint-heading`}>
        <div className="li-panel-heading"><h4 id={`${id}-footprint-heading`}>Material footprint</h4><span>Top view</span></div>
        {p.shape === 'polygon' ? <div className="li-unsupported"><Layers3 size={26} aria-hidden="true" /><p>Polygon contours are an appearance preview. Choose a circle or rounded rectangle to inspect exact printable offsets.</p></div> :
          <svg className="li-footprint" viewBox={`${-margin} ${-margin} ${p.width + 2 * margin} ${effectiveDepth + 2 * margin}`} role="img" aria-labelledby={`${id}-footprint-title ${id}-footprint-desc`}>
            <title id={`${id}-footprint-title`}>{layerKind}, top view</title>
            <desc id={`${id}-footprint-desc`}>{recessedLayer ? `PLA fills the ${recessFace} pattern recesses at the outer edge, connected to the separator ${recessFace === 'top' ? 'above' : 'below'}. A continuous TPU membrane remains ${recessFace === 'top' ? 'below' : 'above'} the recesses. All patterned PLA pulls out from outside.` : membrane ? 'The entire washer-shaped footprint is TPU, with an open central aperture.' : `TPU occupies the ${outerJoin ? 'outer' : 'inner'} joining rim. PLA occupies the remaining membrane footprint and can be removed from the ${outerJoin ? 'central aperture' : 'outside'}.`} {hasAccent && `${textColor.name} TPU replaces the base TPU in the projected text regions; it is part of this membrane, with no added thickness.`} Outer footprint {p.width} by {effectiveDepth} millimetres, membrane band {p.bandWidth} millimetres.</desc>
            <path d={ringPath(p, 0, p.bandWidth)} fill={membrane ? TPU : PLA} fillRule="evenodd" stroke={INK} strokeWidth={outlineWidth} />
            {hasAccent && <path data-material="accent-tpu" d={accent.map(polygon => `M ${polygon.map(([px, py]) => `${px + p.width / 2},${effectiveDepth / 2 - py}`).join(' L ')} Z`).join(' ')} fill={textColor.hex} />}
            {recesses.map((polygon, index) => <polygon key={index} points={polygon.map(([px, py]) => `${px + p.width / 2},${effectiveDepth / 2 - py}`).join(' ')} fill={PLA} stroke={INK} strokeWidth={outlineWidth * 0.65} />)}
            {!membrane && <path d={ringPath(p, outerJoin ? 0 : p.bandWidth - p.innerConnector, outerJoin ? p.outerConnector : p.bandWidth)} fill={TPU} fillRule="evenodd" stroke={INK} strokeWidth={outlineWidth * 0.65} />}
            <text x={p.width / 2} y={-margin * 0.38} textAnchor="middle" fill={INK} fontSize={diagramText}>{p.width} mm</text>
            <text x={p.width / 2} y={effectiveDepth / 2 - diagramText * 0.15} textAnchor="middle" fill={INK} fontSize={diagramText}>Open aperture</text>
            <text x={p.width / 2} y={effectiveDepth / 2 + diagramText * 1.3} textAnchor="middle" fill={INK} fontSize={diagramText * 0.82}>{mm(p.width - 2 * p.bandWidth)}{p.shape !== 'circle' ? ` × ${mm(effectiveDepth - 2 * p.bandWidth)}` : ' diameter'}</text>
            <text x={p.width / 2} y={effectiveDepth + margin * 0.68} textAnchor="middle" fill={INK} fontSize={diagramText * 0.86}>{recessedLayer ? 'PLA exits at the outer edge' : membrane ? `${p.bandWidth} mm full membrane band` : `${outerJoin ? p.outerConnector : p.innerConnector} mm TPU ${outerJoin ? 'outer' : 'inner'} join`}</text>
          </svg>}
      </section>

      <section className="li-diagram-panel" aria-labelledby={`${id}-section-heading`}>
        <div className="li-panel-heading"><h4 id={`${id}-section-heading`}>Through the wall</h4><span>{textSheet >= 0 ? 'Text section · Z enlarged' : pattern.enabled ? 'Fixed radial section · Z enlarged' : 'Section · Z enlarged'}</span></div>
        <svg className="li-section" viewBox="0 0 320 270" role="img" aria-labelledby={`${id}-section-title ${id}-section-desc`}>
          <title id={`${id}-section-title`}>Alternating rim joins in section</title>
          <desc id={`${id}-section-desc`}>Membranes {startSheet + 1} to {startSheet + shownSheets} of {d.sheets}, from bottom to top. TPU sheets are connected alternately on the outer right edge and inner left edge. PLA fills each remaining gap. The outlined horizontal strip is selected print layer {layer + 1}. Vertical thickness is enlarged for inspection. {textSheet >= 0 ? 'The section passes through a text region on the membrane with the largest text footprint and stays fixed around the shade; lettering can move out of this section on other membranes.' : pattern.enabled && 'The section stays at the first active membrane’s pattern centre; phased patterns can move out of this section on other membranes.'}</desc>
          {Array.from({ length: shownSheets }, (_, index) => {
            const actualSheet = startSheet + index
            const sheetBottom = sectionBottom - index * stride * layerPx
            const connectOuter = actualSheet % 2 === 0
            const connectorPx = sectionWidth * (connectOuter ? p.outerConnector : p.innerConnector) / p.bandWidth
            const sectionRecess = cutoutLayerRange(p, actualSheet)
            const recessDepth = sectionRecess ? cutoutDepthAt(p, sectionFraction, actualSheet) : 0
            const textIntervals = sectionIntervals(textLayout[actualSheet] ?? [], sectionInner, sectionOuter)
            return <g key={actualSheet}>
              <rect x={x} y={sheetBottom - membranePx} width={sectionWidth} height={membranePx} fill={TPU} stroke={INK} strokeWidth="0.65" />
              {textIntervals.map(([from, to], index) => <rect key={index} data-material="accent-tpu" x={x + sectionWidth * from} y={sheetBottom - membranePx} width={sectionWidth * (to - from)} height={membranePx} fill={textColor.hex} />)}
              {sectionRecess && recessDepth > 1e-8 && <rect x={x + sectionWidth * (1 - recessDepth / p.bandWidth)} y={sheetBottom - sectionRecess[1] * layerPx} width={sectionWidth * recessDepth / p.bandWidth} height={(sectionRecess[1] - sectionRecess[0]) * layerPx} fill={PLA} stroke={INK} strokeWidth="0.65" />}
              {index < shownSheets - 1 && <>
                <rect x={x} y={sheetBottom - membranePx - separatorPx} width={sectionWidth} height={separatorPx} fill={PLA} stroke={INK} strokeWidth="0.65" />
                <rect x={connectOuter ? x + sectionWidth - connectorPx : x} y={sheetBottom - membranePx - separatorPx} width={connectorPx} height={separatorPx} fill={TPU} stroke={INK} strokeWidth="0.65" />
              </>}
              <text x={x - 10} y={sheetBottom - membranePx / 2 + 3} textAnchor="end" fill={INK} fontSize="9">{actualSheet + 1}</text>
            </g>
          })}
          <rect x={x - 3} y={activeY} width={sectionWidth + 6} height={layerPx} fill="none" stroke="#ab3e2b" strokeWidth="1.7" />
          <path d={`M ${x + sectionWidth + 18} ${activeY + layerPx / 2 - 4} l -6 4 l 6 4`} fill="none" stroke="#ab3e2b" strokeWidth="1.7" />
          <text x={x} y="240" fill={INK} fontSize="11">Inner rim</text>
          <text x={x + sectionWidth} y="240" textAnchor="end" fill={INK} fontSize="11">Outer rim</text>
          <text x={x} y="255" fill={INK} fontSize="9">Aperture side</text>
          <text x={x + sectionWidth} y="255" textAnchor="end" fill={INK} fontSize="9">Room side</text>
        </svg>
      </section>
    </div>

    <div className="li-legend" aria-label="Material legend">
      <span><i style={{ background: TPU }} aria-hidden="true" />TPU · permanent shade</span>
      {p.textEnabled && <span><i style={{ background: textColor.hex }} aria-hidden="true" />{textColor.name} TPU · text accent</span>}
      <span><i style={{ background: PLA }} aria-hidden="true" />PLA · removable separator</span>
      <span><i className="li-selected-swatch" aria-hidden="true" />Selected layer</span>
    </div>

    <div className="li-detail" aria-live="polite" aria-atomic="true">
      <strong>{membrane ? `Membrane ${sheet + 1} of ${d.sheets}` : `Gap ${sheet + 1} of ${d.separators} · membranes ${sheet + 1} and ${sheet + 2}`}</strong>
      {p.textEnabled && <p className="li-text-detail">{hasAccent ? `${textColor.name} TPU forms the text within this membrane. The accent replaces base TPU at the same layer height; both joining rims keep their original TPU.` : membrane ? 'The projected text does not intersect this membrane.' : 'Joining rims keep the original TPU. The text accent is confined to the membranes between these rims.'}</p>}
      {membrane && patternedSheet && <p>Pattern phase: {Number((cutoutPhaseAt(p, sheet) * 100).toFixed(2))}% of one repeat.</p>}
      {pattern.enabled && membrane && !patternedSheet && sheet > 0 && sheet < d.sheets - 1 && <p>This membrane is skipped by the pattern interval of {p.cutoutEvery} membranes.</p>}
      <p>{recessedLayer ? `PLA fills the ${recessFace} recesses and joins the separator ${recessFace === 'top' ? 'above' : 'below'}. Peel it out from outside the shade. ${p.cutoutLayers} continuous TPU layer(s), ${mm(pattern.remainingThickness)}, remain ${recessFace === 'top' ? 'below' : 'above'} each pattern.` : membrane ? patternedSheet ? `This layer is continuous TPU. The ${recessFace === 'top' ? 'upper' : 'lower'} ${p.tpuLayers - p.cutoutLayers} layer(s) contain the outside-opening pattern recesses; the inner fold stays ${mm(d.membraneThickness)} thick.` : `All ${p.tpuLayers} layers of this ${mm(d.membraneThickness)} membrane use TPU across the full band. The open centre stays empty.` : `This ${mm(d.separatorThickness)} gap contains both materials: a ${mm(outerJoin ? p.outerConnector : p.innerConnector)} TPU join at the ${outerJoin ? 'outer' : 'inner'} rim and PLA everywhere else in the band. Remove this separator from ${outerJoin ? 'inside the central aperture' : 'outside the shade'}.`}</p>
    </div>
    <p className="li-note">Nominal material layout · {mm(d.compressedHeight)} compressed height · use the same first-layer height. Separator release and folding still require a calibration print.</p>
  </div>
}
