import { deriveMounting } from './mounting'
import { effectiveLightDiameter } from './lighting'

export type Shape = 'rounded-rectangle' | 'circle' | 'polygon'
export type LightSource = 'led' | 'bulb' | 'two-bulbs'

export interface LampParameters {
  shape: Shape
  width: number
  depth: number
  height: number
  sides: number
  pleats: number
  bandWidth: number
  cornerRadius: number
  twist: number
  modulation: number
  expansion: number
  layerHeight: number
  tpuLayers: number
  separatorLayers: number
  innerConnector: number
  outerConnector: number
  extrusionWidth: number
  bedWidth: number
  bedDepth: number
  bedHeight: number
  lightDiameter: number
  lightSource: LightSource
  lightTemperature: number
  bulbDiameter: number
  bulbHeight: number
  secondBulbHeight: number
  lightClearance: number
  measuredPitch: number
  rotation: number
  material: 'ivory' | 'natural' | 'white'
}

export interface Diagnostic {
  id: string
  status: 'pass' | 'warning' | 'error'
  title: string
  detail: string
}

export const DEFAULT_PARAMETERS: LampParameters = {
  shape: 'rounded-rectangle', width: 180, depth: 180, height: 480,
  sides: 6, pleats: 24, bandWidth: 22, cornerRadius: 30,
  twist: 0, modulation: 0, expansion: 100,
  layerHeight: 0.2, tpuLayers: 2, separatorLayers: 2,
  innerConnector: 1.2, outerConnector: 1.2, extrusionWidth: 0.4,
  bedWidth: 256, bedDepth: 256, bedHeight: 256,
  lightDiameter: 32, lightSource: 'led', lightTemperature: 2700,
  bulbDiameter: 60, bulbHeight: 35, secondBulbHeight: 70,
  lightClearance: 12, measuredPitch: 0,
  rotation: 0, material: 'ivory',
}

/** Nominal manufacturing arithmetic. Expansion and target height never change print geometry. */
export function deriveLamp(p: LampParameters) {
  const sheets = 2 * p.pleats
  const separators = sheets - 1
  const membraneThickness = p.layerHeight * p.tpuLayers
  const separatorThickness = p.layerHeight * p.separatorLayers
  const compressedHeight = (sheets * p.tpuLayers + separators * p.separatorLayers) * p.layerHeight
  const freeSpan = p.bandWidth - p.innerConnector - p.outerConnector
  const { activeLegs, displayHeight } = deriveMounting(p)
  // Terminal membranes stay flat in their clamps. Only the remaining membrane
  // spans contribute axial rise; this is an arclength bound, not a force model.
  const estimatedMaxHeight = Math.max(compressedHeight, Math.max(0, freeSpan) * activeLegs)
  return { sheets, separators, membraneThickness, separatorThickness, compressedHeight, freeSpan, activeLegs, estimatedMaxHeight, displayHeight }
}

export function validateLamp(p: LampParameters): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const add = (id: string, status: Diagnostic['status'], title: string, detail: string) => diagnostics.push({ id, status, title, detail })
  const finite = Object.entries(p).every(([, value]) => typeof value !== 'number' || Number.isFinite(value))
  if (!finite) {
    add('finite', 'error', 'A setting is not a finite number', 'Enter finite numeric dimensions and print settings before generating geometry.')
    return diagnostics
  }
  const d = deriveLamp(p)
  const mount = deriveMounting(p)
  const effectiveDepth = p.shape === 'circle' ? p.width : p.depth
  const positive = [p.width, effectiveDepth, p.height, p.bandWidth, p.layerHeight, p.innerConnector, p.outerConnector, p.extrusionWidth, p.bedWidth, p.bedDepth, p.bedHeight, p.lightDiameter, p.bulbDiameter].every(n => n > 0)
  if (!positive || p.lightClearance < 0 || p.measuredPitch < 0) add('dimensions', 'error', 'Dimensions must be positive', 'Use positive dimensions, and non-negative light clearance and measured pitch.')
  if ([p.width, p.depth, p.height, p.bedWidth, p.bedDepth, p.bedHeight, p.lightDiameter, p.bulbDiameter, p.lightClearance, p.measuredPitch].some(n => n > 10000)) add('dimension-range', 'error', 'Dimension outside the supported range', 'Dimensions must be no greater than 10,000 mm to preserve manufacturing mesh precision.')
  if (p.extrusionWidth < 0.2 || p.extrusionWidth > 1.2) add('extrusion-range', 'error', 'Extrusion width outside the supported range', 'Use an intended extrusion width from 0.20 to 1.20 mm, then confirm the paths in your slicer.')
  if (![p.pleats, p.tpuLayers, p.separatorLayers].every(n => Number.isInteger(n) && n >= 1) || p.pleats > 120 || p.tpuLayers > 20 || p.separatorLayers > 20) {
    add('layers', 'error', 'Use whole pleats and print layers', 'Use 1–120 full pleats and 1–20 layers per membrane and separator.')
  } else {
    add('layers', 'pass', 'Layer schedule aligned', `${d.sheets} membranes · ${d.separators} removable separators · ${d.compressedHeight.toFixed(1)} mm compressed. Use the same first-layer height.`)
  }
  if (!['circle', 'rounded-rectangle', 'polygon'].includes(p.shape) || !['ivory', 'natural', 'white'].includes(p.material) || !['led', 'bulb', 'two-bulbs'].includes(p.lightSource)) add('values', 'error', 'Unsupported design value', 'Choose a supported shape, material appearance and light source.')
  if (p.expansion < 0 || p.expansion > 100 || Math.abs(p.twist) > 180 || Math.abs(p.modulation) > 100 || !Number.isInteger(p.sides) || p.sides < 3 || p.sides > 32) add('preview-range', 'error', 'Preview setting out of range', 'Expansion: 0–100%; twist: ±180°; modulation: ±100%; polygon sides: 3–32.')
  if (p.lightTemperature < 1800 || p.lightTemperature > 6500 || p.bulbHeight < 0 || p.bulbHeight > 100 || p.secondBulbHeight < 0 || p.secondBulbHeight > 100) add('lighting-range', 'error', 'Light setting out of range', 'Light temperature: 1,800–6,500 K; each bulb height: 0–100% of its available vertical travel.')
  const aperture = Math.min(p.width, effectiveDepth) - 2 * p.bandWidth
  if (aperture <= 0) add('contours', 'error', 'The inner aperture has collapsed', 'Reduce membrane band width or increase the outer dimensions.')
  else if (aperture < 20) add('aperture-access', 'error', 'The opening is too small for this prototype', 'This prototype requires a nominal opening of at least 20 mm for separator access. Actual removal still needs a calibration test.')
  else if (p.shape === 'rounded-rectangle' && (p.cornerRadius <= p.bandWidth + 0.05 || p.cornerRadius >= Math.min(p.width, p.depth) / 2 - 0.05)) {
    add('contours', 'error', 'Corner offsets need more room', 'Corner radius must exceed band width by 0.05 mm and remain at least 0.05 mm below half the smaller dimension. Sharp inner corners are not supported yet.')
  } else add('contours', 'pass', 'Aperture stays open', `${aperture.toFixed(1)} mm minimum opening; alternating separators remain accessible from inside and outside.`)
  const minFreeSpan = Math.max(3, 4 * p.extrusionWidth)
  if (d.freeSpan < minFreeSpan) add('free-span', 'error', 'Too little free membrane', `Retain at least ${minFreeSpan.toFixed(1)} mm between the two joining bands. Current free span: ${d.freeSpan.toFixed(1)} mm.`)
  else add('free-span', 'pass', 'Folding span available', `${d.freeSpan.toFixed(1)} mm free membrane between alternating rim joins. Release and bending still require a test print.`)
  if (Math.min(p.innerConnector, p.outerConnector) < 2 * p.extrusionWidth - 1e-8) add('connectors', 'error', 'Joining bands are too narrow', 'Each TPU joining band must fit at least two intended extrusion widths.')
  else add('connectors', 'pass', 'Joining bands have printable width', `${p.innerConnector.toFixed(1)} / ${p.outerConnector.toFixed(1)} mm inner / outer joins. Check the actual paths in your slicer.`)
  if (p.layerHeight < 0.08 || p.layerHeight > 0.4) add('layer-height', 'error', 'Layer height outside supported range', 'Use a constant layer height from 0.08 to 0.40 mm, including the first layer.')
  if (d.membraneThickness > 0.8 || d.separatorThickness < 0.3) add('recipe', 'warning', 'Recipe needs release testing', 'Thick membranes or thin separators may resist bending or fuse. Print the calibration specimen first.')
  if (p.width > p.bedWidth || effectiveDepth > p.bedDepth || d.compressedHeight > p.bedHeight) add('build-volume', 'error', 'Compressed shade exceeds the build volume', 'Increase the usable build dimensions or reduce the shade footprint, layers or pleat count. Rotation only affects the appearance preview.')
  else add('build-volume', 'pass', 'Compressed geometry fits', `${p.width.toFixed(0)} × ${effectiveDepth.toFixed(0)} × ${d.compressedHeight.toFixed(1)} mm. Usable build area must already reserve space for margins and process structures.`)
  const requiredLightOpening = effectiveLightDiameter(p) + 2 * p.lightClearance
  if (aperture < requiredLightOpening) add('light-clearance', 'error', 'Light source clearance is too small', `The aperture needs at least ${requiredLightOpening.toFixed(1)} mm for the selected light source and clearance. Check the expanded fit physically too.`)
  else add('light-clearance', 'pass', 'Nominal light clearance available', 'This checks the undeployed aperture only. Use an external mount and the light source’s specified thermal and ventilation clearances.')
  if (mount.minimumOpening < requiredLightOpening) add('mounting-clearance', 'error', 'Mounting clamps reduce light clearance', `The clamp opening is ${mount.minimumOpening.toFixed(1)} mm after the two 6 mm inward lips. The light source and its selected clearance need ${requiredLightOpening.toFixed(1)} mm.`)
  else add('mounting-clearance', 'pass', 'Light fits through the mounting clamps', `${mount.minimumOpening.toFixed(1)} mm clear opening after the clamp lips. Confirm the light source’s ventilation and thermal requirements separately.`)
  if (mount.gripWidth < 4) add('mounting-grip', 'warning', 'Terminal bands need a wider grip', `Only ${mount.gripWidth.toFixed(1)} mm is available for the clamp. Increase membrane band width to leave at least 4 mm of grip and room for the outer fold exit. The printable shade is unchanged.`)
  if (!mount.activeLegs) add('mounting-height', 'warning', 'One pleat cannot use this mounting arrangement', 'The first and last membranes are held flat as gripping flanges, leaving no active folding span. The preview stays compressed; use at least two pleats for a mounted preview. A one-pleat calibration print remains available.')
  else if (d.displayHeight < mount.minimumMountedHeight) add('mounting-height', 'warning', 'Too little space between the end clamps', `The clamp arrangement needs at least ${mount.minimumMountedHeight.toFixed(1)} mm of displayed height. Expand the preview to inspect the separate mounting hardware.`)
  add('mounting-load', 'warning', 'Attachment load needs a physical test', 'Rigid perimeter clamps capture the top and bottom terminal membranes and attach to an external frame. Grip, sustained tension and TPU deformation need testing with the chosen material; the hardware is separate from the shade export.')
  if (p.height < d.compressedHeight || p.height > d.estimatedMaxHeight) add('height', 'warning', 'Display height exceeds the preview envelope', 'The target is outside the approximate free-span envelope with two flat terminal flanges. Lower the target or add pleats; a physical sample determines achievable deployment.')
  if (p.shape === 'polygon' || p.twist !== 0 || p.modulation !== 0) add('experimental-profile', 'warning', 'Sculpted form is preview only', 'Polygon sides, twist and size modulation do not have validated shared connector contours. Reset these to export a constant-section shade.')
  if (p.measuredPitch > 0) {
    const calibratedHeight = p.measuredPitch * p.pleats
    add('calibration', 'warning', 'Measured pitch applied as an estimate', `${calibratedHeight.toFixed(0)} mm at ${p.measuredPitch.toFixed(1)} mm per pleat; about ${Math.ceil(p.height / p.measuredPitch)} pleats for this target. End effects, mounts and this specimen’s release still need checking.`)
  } else add('calibration', 'warning', 'Physical validation pending', 'Geometry checks cannot certify folding, separator release or deployed height. Export a four-pleat specimen, test it, then enter its comfortable measured pitch.')
  return diagnostics
}

/** Warnings do not imply physical approval. Unsupported geometry must never be exported. */
export function manufacturingErrors(p: LampParameters): Diagnostic[] {
  return validateLamp(p).filter(d => d.status === 'error' || d.id === 'experimental-profile')
}

export function calibrationParameters(p: LampParameters): LampParameters {
  const pleats = Math.min(4, p.pleats)
  return { ...p, pleats, height: p.measuredPitch > 0 ? pleats * p.measuredPitch : p.height * pleats / p.pleats }
}
