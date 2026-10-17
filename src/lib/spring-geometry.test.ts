import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DEFAULT_PARAMETERS, type LampParameters } from './lamp'
import { deriveMounting, MOUNTING } from './mounting'
import { buildExpandedGeometry, previewFrameDimensions } from './preview-geometry'
import { buildSpringGeometry, springAnchors, springWireCurve } from './spring-geometry'

describe('spring suspension hardware', () => {
  it.each([
    {},
    { shape: 'circle', twist: 180 },
    { depth: 120, twist: 90, modulation: 35 },
    { shape: 'polygon', sides: 3, depth: 130, twist: -45, modulation: -35 },
    { tpuLayers: 20, layerHeight: 0.4 },
  ] satisfies Partial<LampParameters>[])('keeps the coils and hooks clear of shade, oak rails and base for %o', overrides => {
    const parameters: LampParameters = { ...DEFAULT_PARAMETERS, ...overrides, attachment: 'springs' }
    const shade = buildExpandedGeometry(parameters)
    const frame = previewFrameDimensions(shade)
    const mount = deriveMounting(parameters)
    try {
      for (const upper of [false, true]) {
        for (const direction of [new THREE.Vector2(1, 0), new THREE.Vector2(0, 1), new THREE.Vector2(-1, 0), new THREE.Vector2(0, -1)]) {
          const frameRadius = (direction.x ? frame.width : frame.depth) / 2
          const flangeY = (upper ? mount.upperY : mount.lowerY) / 1000
          const railY = (upper ? mount.upperRailY : mount.lowerRailY) / 1000
          // Even an attachment near the aperture centre must retain a short
          // spring: the rigid lug spans the rest of an oversized frame gap.
          const screw = direction.clone().multiplyScalar(0.025)
          const anchors = springAnchors(screw, direction, frameRadius, flangeY, railY, upper, mount.springClampEyeOffset)
          const linkY = (upper ? mount.upperLinkY : mount.lowerLinkY) / 1000
          const eyeOuterRadius = (MOUNTING.springEyeRadius + 0.8) / 1000
          expect(Math.abs(anchors.start.y - linkY) - eyeOuterRadius).toBeGreaterThan(MOUNTING.plateThickness / 2000)
          const wire = buildSpringGeometry(anchors.start, anchors.end)
          try {
            expect(anchors.start.distanceTo(anchors.end)).toBeLessThan(0.05)
            expect(anchors.clampPoint.length()).toBeGreaterThanOrEqual(screw.length())
            expect((anchors.end.y - anchors.start.y) * (upper ? 1 : -1)).toBeGreaterThan(0)
            const vertices = wire.getAttribute('position')
            for (let index = 0; index < vertices.count; index++) {
              const x = vertices.getX(index), y = vertices.getY(index), z = vertices.getZ(index)
              expect([x, y, z].every(Number.isFinite)).toBe(true)
              expect((y - flangeY) * (upper ? 1 : -1)).toBeGreaterThan(MOUNTING.plateThickness / 1000)
              expect(Math.abs(x)).toBeLessThan(frame.width / 2 - MOUNTING.framePostWidth / 2000)
              expect(Math.abs(z)).toBeLessThan(frame.depth / 2 - MOUNTING.framePostWidth / 2000)
              expect(y).toBeGreaterThan(0.048)
            }
          } finally {
            wire.dispose()
          }
        }
      }
    } finally {
      shade.dispose()
    }
  })

  it('threads both open end hooks through the anchor eyes and winds ten visible turns', () => {
    const start = new THREE.Vector3(0.065, 0.079, 0)
    const end = new THREE.Vector3(0.0975, 0.056, 0)
    const axis = end.clone().sub(start).normalize()
    const tangent = new THREE.Vector3(-axis.z, 0, axis.x).normalize()
    const normal = new THREE.Vector3().crossVectors(axis, tangent).normalize()
    const curve = springWireCurve(start, end)
    const samples = curve.getPoints(4000)
    for (const eye of [start, end]) {
      // A hook reaches the open centre, then curls beyond the eye radius so
      // its return leg sits on the other side of the eye's metal perimeter.
      expect(Math.min(...samples.map(point => point.distanceTo(eye)))).toBeLessThan(0.0001)
      const hook = samples.filter(point => point.distanceTo(eye) < 0.0048)
      expect(Math.max(...hook.map(point => point.distanceTo(eye)))).toBeGreaterThan((MOUNTING.springEyeRadius + 0.8) / 1000)
    }
    const coils = curve.points.slice(38, 38 + MOUNTING.springTurns * 24 + 1)
    const angles = coils.map(point => {
      const local = point.clone().sub(start)
      const a = local.dot(tangent), b = local.dot(normal)
      expect(Math.hypot(a, b)).toBeCloseTo(MOUNTING.springCoilRadius / 1000, 9)
      return Math.atan2(b, a)
    })
    const wraps = angles.slice(1).filter((angle, index) => angle - angles[index] < -Math.PI).length
    expect(wraps).toBe(MOUNTING.springTurns)
  })
})
