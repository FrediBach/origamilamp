import type { LampParameters } from './lamp'
import { deriveMounting, MOUNTING } from './mounting'

export interface PreviewLightSource {
  kind: 'led' | 'bulb'
  /** World coordinates and full hardware dimensions, in millimetres. */
  centerY: number
  diameter: number
  height: number
  positionPercent: number
}

/** The inactive source keeps its dimensions when switching source types. */
export function effectiveLightDiameter(p: LampParameters): number {
  return p.lightSource === 'led' ? p.lightDiameter : p.bulbDiameter
}

/** Approximate visible colour, not a calibrated colour-temperature simulation. */
export function lightTemperatureColor(kelvin: number): string {
  const stops = [
    { temperature: 1800, rgb: [255, 156, 65] },
    { temperature: 2700, rgb: [255, 211, 145] },
    { temperature: 4000, rgb: [255, 235, 208] },
    { temperature: 6500, rgb: [232, 241, 255] },
  ]
  const temperature = Math.min(6500, Math.max(1800, kelvin))
  const upper = stops.findIndex(stop => stop.temperature >= temperature)
  const a = stops[Math.max(0, upper - 1)], b = stops[upper]
  const fraction = a === b ? 0 : (temperature - a.temperature) / (b.temperature - a.temperature)
  return '#' + a.rgb.map((channel, index) => Math.round(channel + (b.rgb[index] - channel) * fraction).toString(16).padStart(2, '0')).join('')
}

/** Appearance only: neither placement nor warmth alters the manufactured shade.
 * A compressed shade may be too short for the selected hardware; retain its
 * real dimensions and report the conflict instead of shrinking a bulb to fit. */
export function deriveLighting(p: LampParameters) {
  const mount = deriveMounting(p)
  const centerY = (mount.lowerY + mount.upperY) / 2
  const clampInset = MOUNTING.plateThickness + p.layerHeight * p.tpuLayers / 2
  const availableHeight = Math.max(0, mount.displayHeight - 2 * clampInset)
  const diameter = effectiveLightDiameter(p)
  const height = p.lightSource === 'led' ? mount.displayHeight * 0.86 : diameter * 1.65
  const travel = Math.max(0, availableHeight - height)
  const positions = p.lightSource === 'led' ? [50] : p.lightSource === 'bulb' ? [p.bulbHeight] : [p.bulbHeight, p.secondBulbHeight]
  const sources: PreviewLightSource[] = positions.map(positionPercent => ({
    kind: p.lightSource === 'led' ? 'led' : 'bulb',
    centerY: centerY + travel * (positionPercent / 100 - 0.5),
    diameter,
    height,
    positionPercent,
  }))
  return {
    color: lightTemperatureColor(p.lightTemperature),
    temperature: p.lightTemperature,
    shadeBottom: mount.lowerY,
    fitsVertically: height <= availableHeight,
    bulbsOverlap: sources.length === 2 && Math.abs(sources[0].centerY - sources[1].centerY) < height,
    sources,
  }
}
