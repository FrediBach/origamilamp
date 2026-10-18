import { Layers3 } from 'lucide-react'
import { ringPath, mm, type LayerView } from './model'
import { TPU, PLA, INK } from './colors'

export function LayerFootprint({ id, model }: { id: string; model: LayerView }) {
  const { p, textColor, membrane, recesses, accent, hasAccent, outerJoin, layerKind, effectiveDepth, margin, outlineWidth, diagramText, footprintDescription, footprintCaption } = model
  return <section className="li-diagram-panel" aria-labelledby={`${id}-footprint-heading`}>
    <div className="li-panel-heading"><h4 id={`${id}-footprint-heading`}>Material footprint</h4><span>Top view</span></div>
    {p.shape === 'polygon' ? <div className="li-unsupported"><Layers3 size={26} aria-hidden="true" /><p>Polygon contours are an appearance preview. Choose a circle or rounded rectangle to inspect exact printable offsets.</p></div> :
      <svg className="li-footprint" viewBox={`${-margin} ${-margin} ${p.width + 2 * margin} ${effectiveDepth + 2 * margin}`} role="img" aria-labelledby={`${id}-footprint-title ${id}-footprint-desc`}>
        <title id={`${id}-footprint-title`}>{layerKind}, top view</title>
        <desc id={`${id}-footprint-desc`}>{footprintDescription} {hasAccent && `${textColor.name} TPU replaces the base TPU in the projected text regions; it is part of this membrane, with no added thickness.`} Outer footprint {p.width} by {effectiveDepth} millimetres, membrane band {p.bandWidth} millimetres.</desc>
        <path d={ringPath(p, 0, p.bandWidth)} fill={membrane ? TPU : PLA} fillRule="evenodd" stroke={INK} strokeWidth={outlineWidth} />
        {hasAccent && <path data-material="accent-tpu" d={accent.map(polygon => `M ${polygon.map(([px, py]) => `${px + p.width / 2},${effectiveDepth / 2 - py}`).join(' L ')} Z`).join(' ')} fill={textColor.hex} />}
        {recesses.map((polygon, index) => <polygon key={index} points={polygon.map(([px, py]) => `${px + p.width / 2},${effectiveDepth / 2 - py}`).join(' ')} fill={PLA} stroke={INK} strokeWidth={outlineWidth * 0.65} />)}
        {!membrane && <path d={ringPath(p, outerJoin ? 0 : p.bandWidth - p.innerConnector, outerJoin ? p.outerConnector : p.bandWidth)} fill={TPU} fillRule="evenodd" stroke={INK} strokeWidth={outlineWidth * 0.65} />}
        <text x={p.width / 2} y={-margin * 0.38} textAnchor="middle" fill={INK} fontSize={diagramText}>{p.width} mm</text>
        <text x={p.width / 2} y={effectiveDepth / 2 - diagramText * 0.15} textAnchor="middle" fill={INK} fontSize={diagramText}>Open aperture</text>
        <text x={p.width / 2} y={effectiveDepth / 2 + diagramText * 1.3} textAnchor="middle" fill={INK} fontSize={diagramText * 0.82}>{mm(p.width - 2 * p.bandWidth)}{p.shape !== 'circle' ? ` × ${mm(effectiveDepth - 2 * p.bandWidth)}` : ' diameter'}</text>
        <text x={p.width / 2} y={effectiveDepth + margin * 0.68} textAnchor="middle" fill={INK} fontSize={diagramText * 0.86}>{footprintCaption}</text>
      </svg>}
  </section>
}
