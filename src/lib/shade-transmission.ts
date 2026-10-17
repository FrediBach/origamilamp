import type { LampParameters } from './lamp'
import type { deriveLighting, PreviewLightSource } from './lighting'
import { deriveMounting } from './mounting'

const ATTENUATION_PER_MM = 1.1

// The higher of two bulbs hangs from the frame; the lower stands on the base.
// Keep rendering and transmitted light aligned when their heights cross.
export function pendantIndex(sources: PreviewLightSource[]): number {
  if (sources.length < 2) return -1
  return sources[0].centerY > sources[1].centerY ? 0 : 1
}

// Assembly centres include the socket. The luminous envelope sits toward the
// bulb's wider end, which points down when the bulb hangs from the frame.
export function luminousCenter(source: PreviewLightSource, inverted: boolean): number {
  return source.centerY + (source.kind === 'bulb' ? source.height * 0.19 * (inverted ? -1 : 1) : 0)
}

/** An appearance approximation, not a calibrated optical law for TPU.
 * Only permanent membrane thickness attenuates the light; removed PLA does not.
 * A broadened axial spread represents diffusion through the folded shade. */
export function deriveShadeTransmission(p: LampParameters) {
  const thickness = p.layerHeight * p.tpuLayers
  const radialDistance = Math.max(15, Math.min(p.width, p.shape === 'circle' ? p.width : p.depth) / 2 - p.bandWidth / 2)
  return {
    thickness,
    transmission: Math.exp(-ATTENUATION_PER_MM * thickness),
    radialDistance,
    spread: radialDistance * 3,
  }
}

/** Sample transmitted glow from bottom to top of the displayed shade.
 * Values remain below one without clipping overlapping sources into plateaus. */
export function sampleShadeGlow(p: LampParameters, lighting: ReturnType<typeof deriveLighting>, samples = 128): number[] {
  if (!Number.isInteger(samples) || samples < 2) throw new RangeError('Shade glow needs at least two samples.')
  const { thickness, transmission, spread } = deriveShadeTransmission(p)
  const { displayHeight } = deriveMounting(p)
  const pendant = pendantIndex(lighting.sources)
  const falloff = (y: number, center: number) => {
    const distanceRatio = (y - center) / spread
    const pathRatio = Math.sqrt(1 + distanceRatio ** 2)
    const obliqueTransmission = Math.exp(-ATTENUATION_PER_MM * thickness * (pathRatio - 1))
    return obliqueTransmission / (1 + distanceRatio ** 2)
  }
  return Array.from({ length: samples }, (_, row) => {
    const y = lighting.shadeBottom + row / (samples - 1) * displayHeight
    let incident = 0
    lighting.sources.forEach((source, index) => {
      if (source.kind === 'led') {
        // Spread the column's light along its length, with the same total
        // relative power as the previous preview approximation.
        for (let sample = 0; sample < 7; sample += 1) {
          incident += falloff(y, source.centerY + (sample / 6 - 0.5) * source.height * 0.9) / 4
        }
      } else incident += falloff(y, luminousCenter(source, index === pendant))
    })
    return -Math.expm1(-1.6 * incident) * transmission
  })
}
