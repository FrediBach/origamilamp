import { deriveLamp, validateLamp, type Diagnostic, type LampParameters } from './lamp'
import { deriveMounting, MOUNTING } from './mounting'
import { effectiveLightDiameter } from './lighting'

export interface PrintabilityFix {
  label: string
  detail: string
  parameters: LampParameters
}

const margin = 0.001
const scalarErrors = new Set(['finite', 'dimensions', 'dimension-range', 'extrusion-range', 'layers', 'values', 'preview-range', 'lighting-range', 'base-range', 'layer-height', 'cutout-range'])
const severity = { pass: 0, warning: 1, error: 2 }
const effectiveDepth = (p: LampParameters) => p.shape === 'circle' ? p.width : p.depth
const aperture = (p: LampParameters) => Math.min(p.width, effectiveDepth(p)) - 2 * p.bandWidth
const minimumFreeSpan = (p: LampParameters) => Math.max(3, 4 * p.extrusionWidth)
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n))
const isPassing = (diagnostics: Diagnostic[], id: string) => !diagnostics.some(d => d.id === id && d.status !== 'pass')

/** Also compare numeric deficits: an existing error must not get worse just
 * because its severity remains "error" after a proposed change. */
function deficits(p: LampParameters): Record<string, number> {
  const d = deriveLamp(p), mount = deriveMounting(p)
  const opening = aperture(p), light = effectiveLightDiameter(p) + 2 * p.lightClearance
  return {
    aperture: Math.max(0, 20 - opening),
    corners: p.shape === 'rounded-rectangle' ? Math.max(0, p.bandWidth + 0.05 - p.cornerRadius, p.cornerRadius - (Math.min(p.width, p.depth) / 2 - 0.05)) : 0,
    'free-span': Math.max(0, minimumFreeSpan(p) - d.freeSpan),
    connectors: Math.max(0, 2 * p.extrusionWidth - p.innerConnector) + Math.max(0, 2 * p.extrusionWidth - p.outerConnector),
    'build-volume': Math.max(0, p.width - p.bedWidth) + Math.max(0, effectiveDepth(p) - p.bedDepth) + Math.max(0, d.compressedHeight - p.bedHeight),
    'light-clearance': Math.max(0, light - opening),
    'mounting-clearance': Math.max(0, light - mount.minimumOpening),
    'mounting-grip': Math.max(0, 4 - mount.gripWidth),
    'mounting-height': mount.activeLegs ? Math.max(0, mount.minimumMountedHeight - mount.displayHeight) : mount.minimumMountedHeight + 20,
    height: Math.max(0, d.compressedHeight - p.height, p.height - d.estimatedMaxHeight),
    recipe: Math.max(0, d.membraneThickness - 0.8) + Math.max(0, 0.3 - d.separatorThickness),
  }
}

/** Fit the dependent shade settings while keeping all previously satisfied
 * constraints. Printer dimensions, module requirements and calibration are
 * inputs to this calculation, never settings it is allowed to change. */
function reconcile(original: LampParameters, candidate: LampParameters, target: string, diagnostics: Diagnostic[], extraMargin: number): LampParameters | undefined {
  const p = { ...candidate }
  const before = deriveLamp(original), beforeMount = deriveMounting(original)
  const needed = (id: string) => target === id || isPassing(diagnostics, id)

  if (needed('build-volume') && deriveLamp(p).compressedHeight > p.bedHeight) {
    const maxPleats = Math.min(120, Math.floor((p.bedHeight / p.layerHeight + p.separatorLayers) / (2 * (p.tpuLayers + p.separatorLayers))))
    p.pleats = Math.min(p.pleats, maxPleats)
    // Floating point arithmetic can put an exact layer boundary above the bed.
    while (p.pleats > 0 && deriveLamp(p).compressedHeight > p.bedHeight) p.pleats--
    if (p.pleats < 1) return undefined
  }

  const requiredFree = needed('free-span') ? minimumFreeSpan(p) + (deriveLamp(p).freeSpan < minimumFreeSpan(p) ? extraMargin : 0) : before.freeSpan
  const requiredGrip = needed('mounting-grip') ? 4 + (deriveMounting(p).gripWidth < 4 ? extraMargin : 0) : beforeMount.gripWidth
  const minBand = Math.max(p.innerConnector + p.outerConnector + requiredFree, p.outerConnector + 2 + requiredGrip)
  const openingMinimum = (minimum: number) => minimum + (aperture(p) < minimum ? extraMargin : 0)
  let requiredOpening = aperture(original) >= 20 || ['contours', 'aperture-access', 'experimental-profile'].includes(target) ? openingMinimum(20) : aperture(original)
  const lightOpening = effectiveLightDiameter(p) + 2 * p.lightClearance
  requiredOpening = Math.max(requiredOpening, needed('light-clearance') ? openingMinimum(lightOpening) : Math.min(aperture(original), lightOpening))
  requiredOpening = Math.max(requiredOpening, needed('mounting-clearance') ? openingMinimum(lightOpening + 2 * MOUNTING.apertureIntrusion) : Math.min(aperture(original), lightOpening + 2 * MOUNTING.apertureIntrusion))

  const widthLimit = target === 'build-volume' ? p.bedWidth : Math.max(original.width, p.bedWidth)
  const depthLimit = target === 'build-volume' ? p.bedDepth : Math.max(effectiveDepth(original), p.bedDepth)
  const maxBand = (Math.min(widthLimit, depthLimit, 10000) - requiredOpening) / 2
  if (minBand > maxBand) return undefined
  p.bandWidth = clamp(p.bandWidth, minBand, maxBand)
  const minimumDimension = 2 * p.bandWidth + requiredOpening
  p.width = Math.max(p.width, minimumDimension)
  if (p.shape === 'circle') {
    if (p.width > Math.min(widthLimit, depthLimit)) return undefined
    if (p.width !== original.width || p.shape !== original.shape) p.depth = p.width
  } else p.depth = Math.max(p.depth, minimumDimension)
  if (p.width > widthLimit || effectiveDepth(p) > depthLimit) return undefined

  if (p.shape === 'rounded-rectangle' && (needed('contours') || target === 'aperture-access' || target === 'experimental-profile' || p.bandWidth !== original.bandWidth || p.width !== original.width || p.depth !== original.depth)) {
    if (p.cornerRadius <= p.bandWidth + 0.05 || p.cornerRadius >= Math.min(p.width, p.depth) / 2 - 0.05) {
      const low = p.bandWidth + 0.1, high = Math.min(p.width, p.depth) / 2 - 0.1
      if (low > high) return undefined
      p.cornerRadius = clamp(p.cornerRadius, low, high)
    }
  }

  const d = deriveLamp(p)
  const oldHeightDeficit = deficits(original).height
  if (target === 'height' || deficits(p).height > oldHeightDeficit) p.height = clamp(p.height, d.compressedHeight, d.estimatedMaxHeight)

  if (needed('mounting-height')) {
    let mount = deriveMounting(p)
    if (!mount.activeLegs) return undefined
    if (mount.displayHeight < mount.minimumMountedHeight) {
      if (p.height < mount.minimumMountedHeight && d.compressedHeight < mount.minimumMountedHeight) {
        if (d.estimatedMaxHeight < mount.minimumMountedHeight + extraMargin) return undefined
        p.height = mount.minimumMountedHeight + extraMargin
        mount = deriveMounting(p)
      }
      if (d.compressedHeight >= mount.minimumMountedHeight) p.expansion = 0
      else {
        const minimumExpansion = 100 * (mount.minimumMountedHeight + extraMargin - d.compressedHeight) / (p.height - d.compressedHeight)
        if (minimumExpansion > 100) return undefined
        p.expansion = Math.min(100, Math.ceil(minimumExpansion * 100) / 100)
      }
    }
  }
  return p
}

const settingNames: Partial<Record<keyof LampParameters, string>> = {
  shape: 'Shape', width: 'Width', depth: 'Depth', height: 'Target height', pleats: 'Pleats',
  bandWidth: 'Membrane width', cornerRadius: 'Corner radius', twist: 'Twist', modulation: 'Size modulation',
  expansion: 'Expansion', tpuLayers: 'TPU layers', separatorLayers: 'Separator layers',
  cutoutLayers: 'Remaining TPU layers',
  cutoutCount: 'Pattern repeats',
  cutoutSpacing: 'Cutout spacing',
  innerConnector: 'Inner join', outerConnector: 'Outer join',
}
function formatSetting(key: keyof LampParameters, value: LampParameters[keyof LampParameters]) {
  if (key === 'shape') return value === 'rounded-rectangle' ? 'Soft square' : String(value)
  if (typeof value !== 'number') return String(value)
  const number = Number(value.toFixed(3)).toString()
  if (key === 'pleats' || key === 'tpuLayers' || key === 'separatorLayers' || key === 'cutoutLayers' || key === 'cutoutCount') return number
  return `${number}${key === 'twist' ? '°' : key === 'modulation' || key === 'expansion' || key === 'cutoutSpacing' ? '%' : ' mm'}`
}

function isSafeCorrection(original: LampParameters, diagnostics: Diagnostic[], result: LampParameters, target: string) {
  const after = validateLamp(result)
  if (!isPassing(after, target)) return false
  const oldStatuses = new Map(diagnostics.map(d => [d.id, severity[d.status]]))
  if (after.some(d => severity[d.status] > (oldStatuses.get(d.id) ?? 0))) return false
  const oldDeficits = deficits(original)
  return !Object.entries(deficits(result)).some(([id, deficit]) => deficit > oldDeficits[id] + 1e-8)
}

/** Prefer dimensions that are easy to edit by hand. Retain exact feasible
 * boundaries when rounding would bring a warning back or worsen another row. */
function readableSettings(original: LampParameters, diagnostics: Diagnostic[], result: LampParameters, target: string) {
  let p = result
  const increments = { width: 1, depth: 1, height: 0.1, bandWidth: 0.1, cornerRadius: 0.1, innerConnector: 0.1, outerConnector: 0.1 } as const
  for (const [key, step] of Object.entries(increments) as [keyof typeof increments, number][]) {
    if (p[key] === original[key]) continue
    const rounded = Number((Math.round(p[key] / step) * step).toFixed(3))
    const candidate = { ...p, [key]: rounded }
    if (p.shape === 'circle' && (key === 'width' || key === 'depth')) candidate.width = candidate.depth = rounded
    if (isSafeCorrection(original, diagnostics, candidate, target)) p = candidate
  }
  return p
}

/** Returns a reviewable, immutable correction only when it clears this row
 * without creating or worsening another diagnostic. Physical checks remain. */
export function getPrintabilityFix(parameters: LampParameters, diagnosticId: string): PrintabilityFix | undefined {
  const diagnostics = validateLamp(parameters)
  if (isPassing(diagnostics, diagnosticId) || diagnostics.some(d => scalarErrors.has(d.id) && d.status === 'error')) return undefined
  const p = { ...parameters }
  let label: string
  switch (diagnosticId) {
    case 'cutout-thickness':
      label = 'Leave a thinner pattern layer'
      if (p.tpuLayers < 2) p.tpuLayers = 2
      p.cutoutLayers = Math.min(p.cutoutLayers, p.tpuLayers - 1)
      break
    case 'cutout-sheets':
      label = 'Add active folding membranes'
      p.pleats = 2
      break
    case 'cutout-web':
      label = 'Widen the solid gaps'
      while (p.cutoutSpacing < 80 && validateLamp(p).some(item => item.id === 'cutout-web' && item.status === 'error')) p.cutoutSpacing = Math.min(80, Math.ceil(p.cutoutSpacing + 1))
      while (p.cutoutCount > 4 && validateLamp(p).some(item => item.id === 'cutout-web' && item.status === 'error')) p.cutoutCount--
      break
    case 'contours':
    case 'aperture-access': {
      label = aperture(p) < 20 ? 'Open the aperture' : 'Adjust corner radius'
      if (aperture(p) < 20) p.bandWidth = Math.min(p.bandWidth, (Math.min(p.width, effectiveDepth(p)) - 20 - margin) / 2)
      break
    }
    case 'free-span':
      label = 'Widen the folding span'
      p.bandWidth = Math.max(p.bandWidth, p.innerConnector + p.outerConnector + minimumFreeSpan(p) + margin)
      break
    case 'connectors':
      label = 'Widen joining bands'
      p.innerConnector = Math.max(p.innerConnector, 2 * p.extrusionWidth)
      p.outerConnector = Math.max(p.outerConnector, 2 * p.extrusionWidth)
      break
    case 'build-volume': {
      label = 'Fit shade to printer'
      const scale = Math.min(1, p.bedWidth / p.width, p.bedDepth / effectiveDepth(p))
      p.width *= scale
      p.depth = p.shape === 'circle' ? p.width : p.depth * scale
      break
    }
    case 'light-clearance': label = 'Make room for the light'; break
    case 'mounting-clearance': label = 'Enlarge the clamp opening'; break
    case 'mounting-grip':
      label = 'Widen the clamp grip'
      p.bandWidth = Math.max(p.bandWidth, p.outerConnector + 6 + margin)
      break
    case 'mounting-height':
      label = p.pleats === 1 ? 'Add a folding pleat' : 'Make room for the clamps'
      if (p.pleats === 1) p.pleats = 2
      break
    case 'height': label = 'Fit target to preview'; break
    case 'experimental-profile':
      label = p.shape === 'polygon' ? 'Use a plain soft square' : 'Use a constant section'
      if (p.shape === 'polygon') p.shape = 'rounded-rectangle'
      p.twist = 0
      p.modulation = 0
      break
    case 'recipe':
      label = 'Adjust print layers'
      while (p.tpuLayers > 1 && p.tpuLayers * p.layerHeight > 0.8) p.tpuLayers--
      while (p.separatorLayers < 20 && p.separatorLayers * p.layerHeight < 0.3) p.separatorLayers++
      break
    default: return undefined
  }

  // A local correction takes precedence over any dependent adjustments.
  const proposal = isSafeCorrection(parameters, diagnostics, p, diagnosticId) ? p
    : [margin, 0].map(extraMargin => reconcile(parameters, p, diagnosticId, diagnostics, extraMargin))
      .find((candidate): candidate is LampParameters => !!candidate && isSafeCorrection(parameters, diagnostics, candidate, diagnosticId))
  if (!proposal) return undefined
  const result = readableSettings(parameters, diagnostics, proposal, diagnosticId)

  const changes = (Object.keys(parameters) as (keyof LampParameters)[]).filter(key => result[key] !== parameters[key])
  if (!changes.length) return undefined
  const detail = changes.map(key => `${settingNames[key] ?? key}: ${formatSetting(key, parameters[key])} → ${formatSetting(key, result[key])}`).join('; ') + '.'
  return { label, detail: detail + (diagnosticId === 'recipe' ? ' Print the calibration specimen first; separator release and bending still need a physical test.' : ''), parameters: result }
}
