import { strToU8, zipSync } from 'fflate'
import type { BufferGeometry } from 'three'
import { DEFAULT_PARAMETERS, calibrationParameters, deriveLamp, validateLamp, type LampParameters } from './lamp'
import { buildManufacturingGeometry, type ManufacturingOptions } from './manufacturing'

const SCHEMA_VERSION = 1

export function serializeDesign(parameters: LampParameters): string {
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
      materials: { 'shade-tpu.stl': 'TPU — permanent diffuser', 'separators-pla.stl': 'PLA — remove every separator' },
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
    const value = (source as Record<string, unknown>)[key]
    if (typeof value !== typeof defaultValue || (typeof value === 'number' && !Number.isFinite(value))) throw new Error(`Missing or invalid setting: ${key}.`)
    result[key] = value
  }
  const parameters = result as unknown as LampParameters
  const scalarErrors = new Set(['finite', 'dimensions', 'dimension-range', 'extrusion-range', 'layers', 'values', 'preview-range', 'layer-height'])
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
  const instructions = `ORIGAMI LAMP · ${options.calibration ? 'CALIBRATION SPECIMEN' : 'COMPRESSED SHADE'}
origamilamp.app | millimetres | geometry recipe v1

1. Import shade-tpu.stl and separators-pla.stl together as parts of ONE assembly.
   Preserve their shared origin, transforms and relative Z positions. Do not
   independently drop each part to the build plate. STL does not encode units;
   interpret both files as millimetres. Z is up; the TPU bottom rests at Z=0.
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
5. First print the short specimen with this section, material, layers and mounts.
   Remove every PLA separator, alternating access through the central opening and
   from outside. Check for accidental TPU welds and damaged connectors.
6. Measure comfortably deployed height per full pleat with the intended mounting
   arrangement. Enter that measured pitch into the app. End effects remain an
   estimate. This geometry has NOT been physically release- or fatigue-validated.
7. Support the diffuser with separate, load-spreading attachment hardware. Use the
   LED module manufacturer's clearances, temperature and ventilation requirements.
   The app does not provide electrical design or thermal certification.

THIS ASSEMBLY
${p.pleats} full pleats / ${d.sheets} membrane sheets / ${d.separators} removable PLA separators
${p.width} × ${p.shape === 'circle' ? p.width : p.depth} × ${d.compressedHeight.toFixed(3)} mm compressed
Nominal membranes: ${d.membraneThickness.toFixed(3)} mm; separators: ${d.separatorThickness.toFixed(3)} mm
No fittings, peel tabs, raft, prime tower or process margins are modeled.
Display height, expansion and appearance rotation do not alter these print files.
The included design.json records the specimen parameters and material recipe.
`
  try {
    return zipSync({
      'shade-tpu.stl': geometryToSTL(geometry.tpu),
      'separators-pla.stl': geometryToSTL(geometry.pla),
      'design.json': strToU8(serializeDesign(p)),
      'READ-ME.txt': strToU8(instructions),
    }, { level: 6 })
  } finally {
    geometry.tpu.dispose()
    geometry.pla.dispose()
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
