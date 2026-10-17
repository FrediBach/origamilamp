import * as THREE from 'three'
import { MOUNTING } from './mounting'

/** Attachment centres, in metres. A short rigid lug takes up extra distance
 * when modulation or twist puts the frame far beyond a terminal flange. */
export function springAnchors(screw: THREE.Vector2, direction: THREE.Vector2, frameRadius: number, flangeY: number, railY: number, upper: boolean, eyeOffset: number = MOUNTING.springClampEyeOffset) {
  const frameEyeRadius = frameRadius - (MOUNTING.framePostWidth / 2 + MOUNTING.springFrameEyeInset) / 1000
  const clampEyeRadius = Math.max(screw.length(), frameEyeRadius - MOUNTING.springMaxRadialSpan / 1000)
  const clampPoint = direction.clone().multiplyScalar(clampEyeRadius)
  const framePoint = direction.clone().multiplyScalar(frameEyeRadius)
  return {
    clampPoint,
    framePoint,
    start: new THREE.Vector3(clampPoint.x, flangeY + (upper ? 1 : -1) * eyeOffset / 1000, clampPoint.y),
    end: new THREE.Vector3(framePoint.x, railY, framePoint.y),
  }
}

/** A continuous wire: two open hooks, short straight transitions and ten
 * helical turns. The hooks pass through the eye centres and curl outside them,
 * so the spring is visibly linked to the mounting eyes at both ends. */
export function springWireCurve(start: THREE.Vector3, end: THREE.Vector3) {
  const axis = end.clone().sub(start).normalize()
  const tangent = new THREE.Vector3(-axis.z, 0, axis.x).normalize()
  const normal = new THREE.Vector3().crossVectors(axis, tangent).normalize()
  const length = start.distanceTo(end)
  const hookRadius = MOUNTING.springHookRadius / 1000
  const coilRadius = MOUNTING.springCoilRadius / 1000
  const lead = 0.008
  const points: THREE.Vector3[] = []
  const point = (distance: number, across: number, depth = 0) => start.clone().addScaledVector(axis, distance).addScaledVector(tangent, across).addScaledVector(normal, depth)
  for (let index = 0; index <= 36; index++) {
    const angle = Math.PI * (0.3 + 1.7 * index / 36)
    points.push(point(hookRadius * (1 + Math.cos(angle)), hookRadius * Math.sin(angle)))
  }
  points.push(point((2 * hookRadius + lead) / 2, coilRadius / 2))
  for (let index = 0; index <= MOUNTING.springTurns * 24; index++) {
    const fraction = index / (MOUNTING.springTurns * 24)
    const angle = fraction * MOUNTING.springTurns * Math.PI * 2
    points.push(point(lead + fraction * (length - 2 * lead), coilRadius * Math.cos(angle), coilRadius * Math.sin(angle)))
  }
  points.push(point(length - (2 * hookRadius + lead) / 2, coilRadius / 2))
  for (let index = 36; index >= 0; index--) {
    const angle = Math.PI * (0.3 + 1.7 * index / 36)
    points.push(point(length - hookRadius * (1 + Math.cos(angle)), hookRadius * Math.sin(angle)))
  }
  return new THREE.CatmullRomCurve3(points, false, 'centripetal')
}

export function buildSpringGeometry(start: THREE.Vector3, end: THREE.Vector3) {
  const geometry = new THREE.TubeGeometry(springWireCurve(start, end), 384, MOUNTING.springWireRadius / 1000, 8, false)
  geometry.computeBoundingSphere()
  return geometry
}
