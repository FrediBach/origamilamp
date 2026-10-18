import type { PreviewLightSource } from './lighting'
import { pendantIndex } from './shade-transmission'

export const LED_EMISSION_SAMPLES = 5
export const MAX_EMISSION_SAMPLES = LED_EMISSION_SAMPLES

/** Integrate the long LED emitter at real axial positions. Each sample carries
 * an equal share of its power and represents only its own short segment; a
 * single giant blur at the column centre loses depth, occlusion and shadows. */
export function lampEmissionSamples(sources: PreviewLightSource[]) {
  const pendant = pendantIndex(sources)
  return sources.flatMap((source, sourceIndex) => source.kind === 'led'
    ? Array.from({ length: LED_EMISSION_SAMPLES }, (_, sample) => ({
      ...source,
      centerY: source.centerY + ((sample + 0.5) / LED_EMISSION_SAMPLES - 0.5) * source.height,
      height: source.height / LED_EMISSION_SAMPLES,
      sourceIndex,
      powerShare: 1 / LED_EMISSION_SAMPLES,
      inverted: false,
    }))
    : [{ ...source, sourceIndex, powerShare: 1, inverted: sourceIndex === pendant }])
}
