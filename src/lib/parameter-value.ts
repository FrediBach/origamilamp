/** Empty and partial numeric drafts should not change the applied parameter. */
function parseDraft(draft: string): number | null {
  if (draft.trim() === '') return null
  const value = Number(draft)
  return Number.isFinite(value) ? value : null
}

export function liveParameterValue(draft: string, lower: number, upper: number, step: number): number | null {
  const value = parseDraft(draft)
  if (value === null || value < lower || value > upper) return null
  const steps = (value - lower) / step
  return Math.abs(steps - Math.round(steps)) < 0.00001 ? value : null
}

export function committedParameterValue(draft: string, lower: number, upper: number, step: number): number | null {
  const value = parseDraft(draft)
  if (value === null) return null
  const rounded = lower + Math.round((value - lower) / step) * step
  return Number(Math.min(upper, Math.max(lower, rounded)).toFixed(3))
}
