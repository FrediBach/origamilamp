/** A stable lattice value, so preview brightness depends on time rather than frame rate. */
function noiseValue(index: number): number {
  let value = Math.imul(index ^ 0x68bc21eb, 0x45d9f3b)
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  value ^= value >>> 16
  return (value >>> 0) / 0xffffffff * 2 - 1
}

/** Quintic interpolation gives the filament a smooth response, including at cell boundaries. */
function smoothNoise(time: number): number {
  const cell = Math.floor(time)
  const fraction = time - cell
  const blend = fraction * fraction * fraction * (fraction * (fraction * 6 - 15) + 10)
  const start = noiseValue(cell)
  return start + (noiseValue(cell + 1) - start) * blend
}

const intervalSeconds = 0.6

function transitionTime(index: number): number {
  // Irregular timing, with at least 0.44 seconds for every filament transition.
  return index * intervalSeconds + noiseValue(index + 941) * 0.08
}

function transitionBrightness(index: number): number {
  // Every pair contains one dim and one bright value, in a random order. This
  // prevents long stretches of imperceptible flutter without a regular pulse.
  const brightFirst = noiseValue(Math.floor(index / 2) + 713) > 0
  const bright = (index % 2 === 0) === brightFirst
  return bright
    ? 0.935 + noiseValue(index + 218) * 0.085
    : 0.315 + noiseValue(index + 218) * 0.135
}

/**
 * Smooth filament fades and fine flutter, with irregular timing and depth.
 * Returns one shared multiplier for emitted light and its visible glow. Zero is exactly steady.
 */
export function sampleLightFlicker(timeSeconds: number, amountPercent: number): number {
  const amount = Number.isFinite(amountPercent) ? Math.min(100, Math.max(0, amountPercent)) / 100 : 0
  if (amount === 0 || !Number.isFinite(timeSeconds)) return 1

  // Keep phase independent of strength: turning the control after a long
  // session should deepen the current flutter, not jump to a different moment.
  const time = timeSeconds + 0.22
  let interval = Math.floor(time / intervalSeconds)
  if (time < transitionTime(interval)) interval--
  else if (time >= transitionTime(interval + 1)) interval++

  const start = transitionTime(interval)
  const fraction = (time - start) / (transitionTime(interval + 1) - start)
  const blend = fraction * fraction * fraction * (fraction * (fraction * 6 - 15) + 10)
  const from = transitionBrightness(interval)
  const to = transitionBrightness(interval + 1)
  const flutter = smoothNoise(time * 4.31 + 37.2) * 0.01
  const brightness = from + (to - from) * blend + flutter
  return 1 + (brightness - 1) * amount
}
