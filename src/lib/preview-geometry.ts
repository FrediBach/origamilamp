import * as THREE from 'three'
import { deriveLamp, type LampParameters } from './lamp'
import { cutoutContourPoint } from './cutout-patterns'

const SEGMENTS = 96

/** Rail centre-line spacing in metres, fitted to the rendered shade. */
export function previewFrameDimensions(geometry: THREE.BufferGeometry) {
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const { min, max } = geometry.boundingBox!
  // Keep the frame centred on the lamp, including asymmetric polygon profiles.
  // The 35 mm allowance leaves 11.5 mm per side inside the 12 mm oak rails.
  return {
    width: 2 * Math.max(Math.abs(min.x), Math.abs(max.x)) + 0.035,
    depth: 2 * Math.max(Math.abs(min.z), Math.abs(max.z)) + 0.035,
  }
}

/** A visual approximation only. The manufacturing solids are generated separately. */
export function buildExpandedGeometry(parameters: LampParameters) {
  const derived = deriveLamp(parameters)
  const legs = derived.sheets
  const height = derived.displayHeight / 1000
  const freeSpan = Math.max(0.1, derived.freeSpan)
  const legRise = derived.activeLegs > 0 ? Math.max(0, derived.displayHeight / derived.activeLegs) : 0
  // Flat terminal washers preserve the nominal section for the mounting rings.
  // The active outer joins keep that same outline. Increasing axial rise uses
  // free membrane length and retracts the inner creases towards those joins.
  const freeDepth = Math.sqrt(Math.max(0, freeSpan ** 2 - legRise ** 2))
  const apparentBand = Math.max(0.7, freeDepth + parameters.innerConnector + parameters.outerConnector)
  const outer = previewContour(parameters, 0)
  const inner = previewContour(parameters, apparentBand)
  const terminalInner = previewContour(parameters, parameters.bandWidth)
  const outerFreeEdge = previewContour(parameters, parameters.outerConnector)
  const innerFreeEdge = previewContour(parameters, apparentBand - parameters.innerConnector)
  const positions: number[] = []
  const indices: number[] = []
  const uv: number[] = []
  const cutoutCoordinates: number[] = []
  const joinedSheets: number[] = []

  type Row = { contour: THREE.Vector2[]; fraction: number; inset: number }
  function addStrip(from: Row, to: Row, sheet = -1, joinedSheet = -1) {
    const offset = positions.length / 3
    for (const { contour, fraction, inset } of [from, to]) {
      const modulation = 1 + (parameters.modulation / 100) * Math.sin(fraction * Math.PI * 2)
      const angle = THREE.MathUtils.degToRad(parameters.twist) * fraction
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      for (let index = 0; index <= SEGMENTS; index += 1) {
        const point = contour[index % SEGMENTS]
        const x = (point.x / 1000) * modulation
        const z = (point.y / 1000) * modulation
        positions.push(x * cos - z * sin, fraction * height, x * sin + z * cos)
        uv.push(index / SEGMENTS, fraction)
        // Keep nominal print coordinates through the folded/deformed preview.
        // Optical masks therefore match the exported recesses, not world Y.
        cutoutCoordinates.push(index / SEGMENTS, inset / parameters.bandWidth, sheet)
        // A collapsed crease represents both membranes and their retained
        // TPU connector. Preserve its other sheet for independent cadence.
        joinedSheets.push(joinedSheet)
      }
    }
    for (let index = 0; index < SEGMENTS; index += 1) {
      const a = offset + index
      const b = a + 1
      const c = a + SEGMENTS + 1
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }

  // Sheet 0 and sheet N−1 are full, flat annular flanges. Their free inner
  // edges fit the clamps; their outer rims remain joined to the active bellows.
  addStrip({ contour: terminalInner, fraction: 0, inset: parameters.bandWidth }, { contour: outer, fraction: 0, inset: 0 }, 0, derived.activeLegs ? 1 : -1)
  for (let leg = 1; leg < legs - 1; leg += 1) {
    const start = (leg - 1) / derived.activeLegs
    const end = leg / derived.activeLegs
    const rows: Row[] = leg % 2 === 1
      ? [{ contour: outer, fraction: start, inset: 0 }, { contour: outerFreeEdge, fraction: start, inset: parameters.outerConnector }, { contour: innerFreeEdge, fraction: end, inset: parameters.bandWidth - parameters.innerConnector }, { contour: inner, fraction: end, inset: parameters.bandWidth }]
      : [{ contour: inner, fraction: start, inset: parameters.bandWidth }, { contour: innerFreeEdge, fraction: start, inset: parameters.bandWidth - parameters.innerConnector }, { contour: outerFreeEdge, fraction: end, inset: parameters.outerConnector }, { contour: outer, fraction: end, inset: 0 }]
    // Joining bands remain flat at each crease, so the actual sloping free
    // span follows the right triangle used above rather than stretching it.
    // Draw shared bands once; the terminal flanges already cover the end bands.
    addStrip(rows[1], rows[2], leg)
    if (leg < legs - 2) addStrip(rows[2], rows[3], leg, leg + 1)
  }
  if (!derived.activeLegs) {
    // A two-sheet specimen has no active span after reserving both flanges.
    // Keep the flat sheets connected at their outer rim in the compressed view.
    addStrip({ contour: outer, fraction: 0, inset: 0 }, { contour: outer, fraction: 1, inset: 0 })
  }
  addStrip({ contour: outer, fraction: 1, inset: 0 }, { contour: terminalInner, fraction: 1, inset: parameters.bandWidth }, legs - 1, derived.activeLegs ? legs - 2 : -1)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setAttribute('cutoutCoord', new THREE.Float32BufferAttribute(cutoutCoordinates, 3))
  geometry.setAttribute('cutoutJoin', new THREE.Float32BufferAttribute(joinedSheets, 1))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

/** Contour points are millimetres in the viewer's XZ plane. */
export function previewContour(parameters: LampParameters, inset: number): THREE.Vector2[] {
  if (parameters.cutoutPattern !== 'none') {
    return Array.from({ length: SEGMENTS }, (_, i) => new THREE.Vector2(...cutoutContourPoint(parameters, i / SEGMENTS, inset)))
  }
  const width = Math.max(2, parameters.width - 2 * inset)
  const depth = parameters.shape === 'circle' ? width : Math.max(2, parameters.depth - 2 * inset)
  if (parameters.shape === 'circle') {
    return Array.from({ length: SEGMENTS }, (_, i) => {
      const angle = (i / SEGMENTS) * Math.PI * 2
      return new THREE.Vector2(Math.cos(angle) * width / 2, Math.sin(angle) * depth / 2)
    })
  }

  if (parameters.shape === 'polygon') {
    const sides = Math.max(3, Math.round(parameters.sides))
    return Array.from({ length: SEGMENTS }, (_, i) => {
      const side = (i / SEGMENTS) * sides
      const start = Math.floor(side)
      const fraction = side - start
      const a = (start / sides) * Math.PI * 2 + Math.PI / 4
      const b = ((start + 1) / sides) * Math.PI * 2 + Math.PI / 4
      return new THREE.Vector2(
        THREE.MathUtils.lerp(Math.cos(a), Math.cos(b), fraction) * width / 2,
        THREE.MathUtils.lerp(Math.sin(a), Math.sin(b), fraction) * depth / 2,
      )
    })
  }

  const radius = Math.min(Math.max(0.01, parameters.cornerRadius - inset), width / 2, depth / 2)
  const path = new THREE.Path()
  const w = width / 2
  const d = depth / 2
  path.moveTo(w - radius, -d)
  path.lineTo(-w + radius, -d)
  path.absarc(-w + radius, -d + radius, radius, -Math.PI / 2, -Math.PI, true)
  path.lineTo(-w, d - radius)
  path.absarc(-w + radius, d - radius, radius, Math.PI, Math.PI / 2, true)
  path.lineTo(w - radius, d)
  path.absarc(w - radius, d - radius, radius, Math.PI / 2, 0, true)
  path.lineTo(w, -d + radius)
  path.absarc(w - radius, -d + radius, radius, 0, -Math.PI / 2, true)
  return path.getSpacedPoints(SEGMENTS).slice(0, SEGMENTS)
}
