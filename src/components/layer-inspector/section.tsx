import { cutoutDepthAt, cutoutLayerRange } from '@/lib/cutout-patterns'
import { sectionIntervals, type LayerView } from './model'
import { TPU, PLA, INK } from './colors'

export function LayerSection({ id, model }: { id: string; model: LayerView }) {
  const { p, d, textLayout, textSheet, textColor, layer, stride, pattern, shownSheets, startSheet, layerPx, sectionBottom, membranePx, separatorPx, sectionWidth, x, activeY, sectionFraction, sectionInner, sectionOuter } = model
  return <section className="li-diagram-panel" aria-labelledby={`${id}-section-heading`}>
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
}
