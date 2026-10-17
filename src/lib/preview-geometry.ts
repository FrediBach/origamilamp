import * as THREE from 'three'
import { deriveLamp, type LampParameters } from './lamp'

const SEGMENTS = 96

/** A visual approximation only. The manufacturing solids are generated separately. */
export function buildExpandedGeometry(parameters: LampParameters) {
  const derived = deriveLamp(parameters)
  const legs = derived.sheets
  const height = derived.displayHeight / 1000
  const freeSpan = Math.max(0.1, derived.freeSpan)
  const legRise = Math.max(0, (derived.displayHeight - derived.compressedHeight) / legs)
  // Increasing axial rise consumes the free membrane length. Both contours move
  // toward the band's centreline; retaining both radii would imply stretch.
  const freeDepth = Math.sqrt(Math.max(0, freeSpan ** 2 - legRise ** 2))
  const apparentBand = Math.max(0.7, freeDepth + parameters.innerConnector + parameters.outerConnector)
  const contourInset = Math.max(0, (parameters.bandWidth - apparentBand) / 2)
  const outer = previewContour(parameters, contourInset)
  const inner = previewContour(parameters, contourInset + apparentBand)
  const positions: number[] = []
  const indices: number[] = []
  const uv: number[] = []

  for (let leg = 0; leg < legs; leg += 1) {
    const offset = positions.length / 3
    for (let edge = 0; edge < 2; edge += 1) {
      const row = leg + edge
      const fraction = row / legs
      const contour = row % 2 === 0 ? inner : outer
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

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

function previewContour(parameters: LampParameters, inset: number): THREE.Vector2[] {
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
