import { strToU8, zipSync } from 'fflate'
import type { BufferGeometry } from 'three'
import { DEFAULT_PARAMETERS, calibrationParameters, deriveLamp, validateLamp, type LampParameters } from './lamp'
import { buildManufacturingGeometry, type ManufacturingOptions } from './manufacturing'
import { deriveMounting, MOUNTING } from './mounting'
import { WOOD_FINISHES } from './wood'
import { cutoutProfile } from './cutout-patterns'
import { TEXT_COLORS, textWrapMetrics } from './text-projection'

const SCHEMA_VERSION = 1
const OPTIONAL_V1_SETTINGS = new Set(['lightSource', 'lightIntensity', 'lightTemperature', 'lightFlicker', 'bulbDiameter', 'bulbHeight', 'secondBulbHeight', 'ceilingLightTemperature', 'ceilingLightIntensity', 'attachment', 'electronicsBox', 'electronicsBoxHeight', 'frameWood', 'boxWood', 'cutoutPattern', 'cutoutCount', 'cutoutSpacing', 'cutoutEvery', 'cutoutPhase', 'cutoutDepth', 'cutoutLayers', 'textEnabled', 'text', 'textColor', 'textSize', 'textRotation', 'textAzimuth', 'textHorizontal', 'textVertical'])

/** Eligibility of the terminal sheets, independent of the preview's current
 * expansion. A collapsed view does not prevent later assembly at a valid height. */
function endMountingEligibility(parameters: LampParameters) {
  const mounting = deriveMounting(parameters)
  const limitations: { code: string; detail: string }[] = []
  if (!mounting.activeLegs) limitations.push({
    code: 'no-active-folds',
    detail: 'The two flat terminal membranes leave no active folding span. Use at least two pleats for this mounting arrangement.',
  })
  if (mounting.gripWidth < 4) limitations.push({
    code: 'insufficient-terminal-grip',
    detail: `Only ${mounting.gripWidth.toFixed(1)} mm of terminal grip is available; this clamp concept needs at least 4 mm. Widen the membrane band or design a different attachment.`,
  })
  return {
    eligibility: limitations.length ? 'requires-adjusted-end-attachment' : 'candidate-for-physical-calibration',
    limitations,
  }
}

export function serializeDesign(parameters: LampParameters): string {
  const mounting = deriveMounting(parameters)
  const boxWood = parameters.boxWood === 'match-frame' ? parameters.frameWood : parameters.boxWood
  const baseWood = parameters.electronicsBox ? boxWood : parameters.frameWood
  return JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    application: 'origamilamp.app',
    units: 'mm',
    parameters,
    recipe: {
      profile: 'constant-section-explicit-materials-v1',
      status: 'unvalidated-physical-prototype',
      firstLayerHeight: parameters.layerHeight,
      variableLayerHeight: false,
      materials: {
        'shade-tpu.stl': 'TPU — permanent diffuser',
        ...(parameters.textEnabled ? { 'shade-text-tpu.stl': `TPU — permanent ${TEXT_COLORS[parameters.textColor].name.toLowerCase()} lettering` } : {}),
        'separators-pla.stl': 'PLA — remove every separator',
      },
      multicolorText: {
        enabled: parameters.textEnabled, text: parameters.text, color: parameters.textColor,
        letterHeightMillimetres: parameters.textSize, rotationDegrees: parameters.textRotation,
        projectionAzimuthDegrees: parameters.textAzimuth, horizontalOffsetMillimetres: parameters.textHorizontal,
        verticalPositionPercent: parameters.textVertical,
        font: 'Helvetiker Bold', projection: 'continuous-outer-perimeter-arclength-wrap-at-target-deployed-height',
        ...textWrapMetrics(parameters),
        overflow: 'Text longer than one circumference continues around the shade; overlapping lettering merges into the same accent TPU.',
        construction: 'complementary-TPU-volumes-in-existing-membrane-layers',
        retainedBaseTPU: 'Both joining bands and both clamped terminal membranes stay in the base TPU color.',
        assignment: 'Use compatible base and accent TPU plus removable PLA. Import all STL parts together and preserve their shared origin. Verify color-boundary adhesion on the calibration specimen.',
        opticalPreview: 'Illustrative pigment-dependent attenuation, not measured transmission for a specific filament.',
      },
      lightPattern: {
        shape: parameters.cutoutPattern,
        repeats: parameters.cutoutCount,
        spacingPercent: parameters.cutoutSpacing,
        outsideGapMillimetres: cutoutProfile(parameters).gapMm,
        everyMembranes: parameters.cutoutEvery,
        phasePerMembranePercent: parameters.cutoutPhase,
        phaseReference: 'One pattern repeat; zero offset at the first unclamped membrane, advancing across every membrane including skipped ones.',
        rectangleInnerCornerRadiusMillimetres: parameters.cutoutPattern === 'rectangles' ? cutoutProfile(parameters).rectangleCornerMm : 0,
        schedule: 'Start at the first unclamped membrane, then repeat at this membrane interval. Skipped membranes and both clamped ends stay full thickness.',
        depthPercent: parameters.cutoutDepth,
        remainingTPULayers: parameters.cutoutLayers,
        remainingThicknessMillimetres: parameters.cutoutLayers * parameters.layerHeight,
        construction: 'alternating-face-recesses-in-outward-open-PLA-separators',
        releaseEdge: 'outer',
        release: 'All recesses widen toward the outside edge. Selected odd-indexed active membranes are recessed on top, selected even-indexed active membranes on the bottom, joining only outward-open PLA separators. Skipped membranes, inner folds and both terminal membranes remain full thickness.',
      },
      mounting: {
        type: 'top-and-bottom-two-piece-perimeter-clamps',
        status: 'concept-needs-physical-load-testing',
        ...endMountingEligibility(parameters),
        flatTerminalMembranes: 2,
        gripWidthMillimetres: mounting.gripWidth,
        apertureIntrusionMillimetres: MOUNTING.apertureIntrusion,
        clampPlateThicknessMillimetres: MOUNTING.plateThickness,
        attachment: parameters.attachment,
        frameWood: { species: parameters.frameWood, name: WOOD_FINISHES[parameters.frameWood].name },
        baseWood: { species: baseWood, name: WOOD_FINISHES[baseWood].name },
        frameConnection: parameters.attachment === 'springs' ? 'short-metal-extension-springs' : 'rigid-bolted-links',
        frameConnectionsPerEnd: 4,
        ...(parameters.attachment === 'springs' ? {
          springs: {
            count: 8,
            arrangement: 'four-per-end-between-terminal-clamp-and-frame',
            selection: 'Choose spring rate, initial tension, working travel and retained hooks through physical calibration; preview dimensions are illustrative.',
          },
        } : {}),
        hardwareIncludedInSTLs: false,
      },
      electronicsBox: {
        enabled: parameters.electronicsBox,
        type: 'wooden-base-compartment',
        wood: { selection: parameters.boxWood, species: boxWood, name: WOOD_FINISHES[boxWood].name },
        internalHeightMillimetres: parameters.electronicsBoxHeight,
        status: 'space-reservation-only',
        hardwareIncludedInSTLs: false,
        notes: 'The wooden box reserves space for electronics and wiring. Component fit, cable routing, ventilation and electrical design require separate verification.',
      },
      bridgeDirectionStartingPointDegrees: 45,
      notes: 'The 45° bridge direction is a starting point, not a fold angle or alternating-layer instruction. Explicit PLA parts may produce solid infill instead of bridge paths; inspect the first TPU path above PLA. No printer-specific process profile is included.',
    },
  }, null, 2)
}

/** Reject incomplete/unversioned files. Geometry conflicts remain editable and
 * are diagnosed live; malformed or out-of-range scalar settings are rejected. */
export function parseDesign(text: string): LampParameters {
  let document: unknown
  try { document = JSON.parse(text) } catch { throw new Error('This file is not valid JSON.') }
  if (!document || typeof document !== 'object' || !('schemaVersion' in document) || document.schemaVersion !== SCHEMA_VERSION || !('parameters' in document)) {
    throw new Error('Use an Origami Lamp design file with schema version 1.')
  }
  const source = document.parameters
  if (!source || typeof source !== 'object') throw new Error('The design file is missing its parameter object.')
  const result: Record<string, unknown> = {}
  for (const [key, defaultValue] of Object.entries(DEFAULT_PARAMETERS)) {
    // Later controls were added to version 1. Only absent fields receive
    // defaults; explicit nulls, wrong types and unsupported values stay errors.
    const value = Object.hasOwn(source, key) ? (source as Record<string, unknown>)[key]
      : OPTIONAL_V1_SETTINGS.has(key) ? defaultValue : undefined
    if (typeof value !== typeof defaultValue || (typeof value === 'number' && !Number.isFinite(value))) throw new Error(`Missing or invalid setting: ${key}.`)
    result[key] = value
  }
  const parameters = result as unknown as LampParameters
  const scalarErrors = new Set(['finite', 'dimensions', 'dimension-range', 'extrusion-range', 'layers', 'values', 'preview-range', 'lighting-range', 'base-range', 'layer-height', 'cutout-range', 'text-range'])
  const errors = validateLamp(parameters).filter(diagnostic => diagnostic.status === 'error' && scalarErrors.has(diagnostic.id))
  if (parameters.cornerRadius < 0) throw new Error('Corner radius cannot be negative.')
  if (errors.length) throw new Error(errors.map(error => error.title).join(' · '))
  return parameters
}

/** Binary STL intentionally uses unchanged millimetre coordinates. STL itself
 * has no reliable units or material assignment; the recipe supplies both. */
export function geometryToSTL(geometry: BufferGeometry): Uint8Array {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const triangleCount = (index ? index.count : position.count) / 3
  const buffer = new ArrayBuffer(84 + triangleCount * 50)
  const bytes = new Uint8Array(buffer)
  bytes.set(strToU8(`origamilamp.app | ${geometry.name} | millimetres | Z-up`).subarray(0, 80))
  const data = new DataView(buffer)
  data.setUint32(80, triangleCount, true)
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const vertices = [0, 1, 2].map(corner => {
      const vertex = index ? index.getX(triangle * 3 + corner) : triangle * 3 + corner
      return [position.getX(vertex), position.getY(vertex), position.getZ(vertex)]
    })
    const [a, b, c] = vertices
    const u = b.map((value, axis) => value - a[axis])
    const v = c.map((value, axis) => value - a[axis])
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const length = Math.hypot(...normal)
    if (!Number.isFinite(length) || length <= 1e-10) throw new Error('A degenerate triangle prevented STL export.')
    const floats = [...normal.map(value => value / length), ...vertices.flat()]
    floats.forEach((value, offset) => data.setFloat32(84 + triangle * 50 + offset * 4, value, true))
  }
  return bytes
}

export function createManufacturingArchive(parameters: LampParameters, options: ManufacturingOptions = {}): Uint8Array {
  const p = options.calibration ? calibrationParameters(parameters) : parameters
  const geometry = buildManufacturingGeometry(parameters, options)
  const d = deriveLamp(p)
  const textInstructions = p.textEnabled ? `Multicolor text: "${p.text}" in ${TEXT_COLORS[p.textColor].name.toLowerCase()} TPU.
Assign shade-text-tpu.stl to the SECOND TPU color, using a TPU compatible with the base.
The two TPU files are complementary volumes in the same membrane layers; this is
not a raised overlay. Keep both joining bands and terminal clamp membranes in
base TPU for uninterrupted folds and grips. Patterned PLA recesses retain their
original geometry. Import all three files together; never auto-center or drop
the accent part independently. Test color-boundary adhesion and folding strength.
Wrapped Helvetiker Bold lettering: ${p.textSize} mm cap height, ${p.textRotation}° text rotation,
${p.textAzimuth}° around the shade, ${p.textHorizontal} mm horizontal offset,
${p.textVertical}% vertical placement. It is fixed to the target deployed height;
preview expansion and viewing rotation do not move the printed lettering.
Text follows true outer-perimeter distance continuously around corners and the
back. Text exceeding one circumference wraps further; overlapping ink merges.`
    : 'Multicolor text: disabled; one permanent TPU color.'
  const endMounting = endMountingEligibility(p)
  const incompatibleMount = endMounting.limitations.length > 0
  const frameWoodName = WOOD_FINISHES[p.frameWood].name
  const boxWoodName = WOOD_FINISHES[p.boxWood === 'match-frame' ? p.frameWood : p.boxWood].name
  const baseWoodName = p.electronicsBox ? boxWoodName : frameWoodName
  const patternInstructions = p.cutoutPattern === 'none' ? 'Light patterns: disabled; full-thickness TPU membranes.'
    : `Light patterns: ${p.cutoutPattern}, ${p.cutoutCount} repeats, ${p.cutoutDepth}% depth.
Spacing: ${p.cutoutSpacing}% of each repeat, ${cutoutProfile(p).gapMm.toFixed(2)} mm between cutout mouths along the outside edge.
Pattern every ${p.cutoutEvery} membrane(s), starting at the first unclamped membrane.
This interval counts folded membranes, not individual printer layers. Skipped membranes remain full thickness.
Phase advance: ${p.cutoutPhase}% of one pattern repeat per membrane, starting at zero
on the first unclamped membrane. Skipped membranes count toward the phase advance.
${p.cutoutPattern === 'rectangles' ? `Rectangle inner corners are rounded to ${cutoutProfile(p).rectangleCornerMm.toFixed(2)} mm radius; their outside mouths remain open.` : ''}
Remaining patterned TPU: ${p.cutoutLayers} complete layer(s), ${(p.cutoutLayers * p.layerHeight).toFixed(3)} mm; these are NOT through-holes.
Recesses open ONLY at the outside edge. Selected odd-indexed membranes have top
recesses, connected to the separator above; selected even-indexed membranes have
bottom recesses, connected to the separator below. Each joins an outward-open
PLA separator. The remaining TPU lies below top recesses and above bottom recesses.
Pull the patterned PLA outward. Inner folds stay full thickness with no recesses.
The two terminal clamping membranes remain full thickness. Inspect the pattern
layers as well as both connector layers. Peel the raised PLA tongues out with
their separator; check every thin region for tears or retained PLA. Test this
pattern with the short specimen before making the full shade.`
  const electronicsInstructions = p.electronicsBox
    ? `Enabled: wooden base box with ${p.electronicsBoxHeight} mm usable internal height.
   Wood finish: ${boxWoodName}${p.boxWood === 'match-frame' ? ' (matches the support frame)' : ''}.
   The wooden box and lid are separate hardware, NOT included in these STL files.
   This reserves space only; verify component fit, cable routing, ventilation and
   electrical design separately.`
    : `Disabled; configured internal height is ${p.electronicsBoxHeight} mm if enabled later.
   Configured wood finish: ${boxWoodName}${p.boxWood === 'match-frame' ? ' (matches the support frame)' : ''}.
   No electronics compartment is included in these STL files.`
  const frameInstructions = p.attachment === 'springs'
    ? `Four short metal extension springs per end (eight total) connect the clamps
   to the frame, suspending the shade like a trampoline. Fit retained hooks to
   the clamp and frame anchors; do not hook springs through the thin TPU.
   Balance opposing spring pairs at both the top and bottom. Select spring rate,
   initial tension and working travel with a physical specimen; confirm the
   hooks remain retained throughout the intended movement. The preview does not
   calculate spring force or predict dynamic motion.`
    : `Four bolted supports per end connect the clamp to the ${frameWoodName.toLowerCase()} frame.`
  const deploymentInstructions = p.attachment === 'springs'
    ? `Remove PLA before fitting clamps. Support the shade while attaching the
   lower and upper spring sets, then balance their tension at a measured
   comfortable height. Do not force the target height or exceed the selected
   springs' working travel.`
    : `Remove PLA before fitting clamps. Secure the bottom first; deploy to a measured
   comfortable height, then secure the upper clamp. Do not force the target height.`
  const calibrationInstructions = incompatibleMount
    ? `6. Use this specimen for separator-release and connector-bonding checks only.
   The mounting limitations below prevent deployment calibration with the shown
   flat-end clamps. This geometry has NOT been physically release- or fatigue-validated.`
    : `6. Measure comfortably deployed height per full pleat with the intended mounting
   arrangement. Enter that measured pitch into the app. End effects remain an
   estimate. This geometry has NOT been physically release- or fatigue-validated.`
  const mountingInstructions = incompatibleMount
    ? `7. This specimen is NOT compatible with the shown two-piece end-clamp arrangement.
${endMounting.limitations.map(limitation => `   ${limitation.detail}`).join('\n')}
   Do not deploy this specimen using the shown flat-end clamps. Adjust the design
   or independently design and test an alternative attachment before calibrating
   deployed pitch.`
    : `7. Hold BOTH ends under tension. The appearance model reserves the first and last
   TPU membranes as flat gripping flanges. At each end, two separate rigid clamp
   rings sandwich the inner portion of that flange; leave the outer joining band
   free to bend. ${frameInstructions}
   Clamp screws sit inside the free aperture, not through the thin TPU.
   ${deploymentInstructions}`
  const instructions = `ORIGAMI LAMP · ${options.calibration ? 'CALIBRATION SPECIMEN' : 'COMPRESSED SHADE'}
origamilamp.app | millimetres | geometry recipe v1

1. Import shade-tpu.stl${p.textEnabled ? ', shade-text-tpu.stl and ' : ' and '}separators-pla.stl together as parts of ONE assembly.
   Preserve their shared origin, transforms and relative Z positions. Do not
   independently drop each part to the build plate. STL does not encode units;
   interpret all files as millimetres. Z is up; the TPU bottom rests at Z=0.
2. Assign shade-tpu.stl to TPU and separators-pla.stl to removable PLA. A compatible
   multimaterial printer is required. Material-to-tool mapping is manual.
3. Use a constant ${p.layerHeight} mm layer height, including the first layer:
   ${p.tpuLayers} TPU membrane layers and ${p.separatorLayers} separator layers.
   Connectors remain TPU during separator layers. Disable duplicate automatic
   supports in the modeled separator volumes. No process/G-code profile is supplied.
4. Inspect one membrane layer and BOTH alternating connector layers. Confirm
   continuous TPU joins and filled PLA separator regions. Check that the slicer
   has not repaired away the fold gaps. At the first TPU layer above PLA, inspect
   whether the paths are bridges, surfaces or infill. 45 degrees is only a bridge
   direction starting point; it does not rotate the model or alternate layers.
5. First print the short specimen with this section, material and layer recipe.
   Remove every PLA separator, alternating access through the central opening and
   from outside. Check for accidental TPU welds and damaged connectors.
${calibrationInstructions}
${mountingInstructions}
   The shown rings, ${p.attachment === 'springs' ? 'springs, anchors' : 'brackets'}, fasteners and frame are a mounting CONCEPT and are
   NOT included in these STL files. Grip, tension and creep require physical tests;
   there is no calculated clamp force, fastener torque or load rating.
8. Use the light source manufacturer's clearances, temperature and ventilation
   requirements. Clamp lips extend ${MOUNTING.apertureIntrusion} mm into each side of the aperture;
   inspect the actual assembled opening. The app does not provide electrical
   design or thermal certification.
9. Electronics box: ${electronicsInstructions}

THIS ASSEMBLY
${p.pleats} full pleats / ${d.sheets} membrane sheets / ${d.separators} removable PLA separators
${p.width} × ${p.shape === 'circle' ? p.width : p.depth} × ${d.compressedHeight.toFixed(3)} mm compressed
Nominal membranes: ${d.membraneThickness.toFixed(3)} mm; separators: ${d.separatorThickness.toFixed(3)} mm
${patternInstructions}
${textInstructions}
No fittings, peel tabs, raft, prime tower or process margins are modeled.
Attachment: ${p.attachment === 'springs' ? 'short metal springs, four at the top and four at the bottom' : 'bolted supports, four per end'} (separate hardware).
Support frame wood: ${frameWoodName}. Base board wood: ${baseWoodName}.
Configured optional box wood: ${boxWoodName}${p.boxWood === 'match-frame' ? ' (matches the support frame)' : ''}.
${p.textEnabled ? 'Target deployed height determines the text projection. Expansion' : 'Display height, expansion'}, viewing rotation, attachment, wood finishes, electronics box settings, light placement, warmth, flicker and lamp or ceiling intensity do not alter these print files.
The included design.json records the specimen parameters and material recipe.
`
  try {
    return zipSync({
      'shade-tpu.stl': geometryToSTL(geometry.tpu),
      ...(geometry.accent ? { 'shade-text-tpu.stl': geometryToSTL(geometry.accent) } : {}),
      'separators-pla.stl': geometryToSTL(geometry.pla),
      'design.json': strToU8(serializeDesign(p)),
      'READ-ME.txt': strToU8(instructions),
    }, { level: 6 })
  } finally {
    geometry.tpu.dispose()
    geometry.pla.dispose()
    geometry.accent?.dispose()
  }
}

function download(data: Uint8Array, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(data).buffer], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Downloads need the URL to survive the click's navigation task.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadDesign(p: LampParameters): void {
  download(strToU8(serializeDesign(p)), 'origami-lamp-design.json', 'application/json')
}

export function downloadSTLs(p: LampParameters, options: ManufacturingOptions = {}): void {
  download(createManufacturingArchive(p, options), options.calibration ? 'origami-lamp-calibration.zip' : 'origami-lamp-manufacturing.zip', 'application/zip')
}
