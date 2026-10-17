import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMETERS, type LampParameters } from './lamp'
import { MOUNTING } from './mounting'
import { buildExpandedGeometry, previewFrameDimensions } from './preview-geometry'

function frameMeasurements(parameters: LampParameters) {
  const geometry = buildExpandedGeometry(parameters)
  try {
    const frame = previewFrameDimensions(geometry)
    const positions = geometry.getAttribute('position')
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    let clearance = Infinity
    const halfRail = MOUNTING.framePostWidth / 2000
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const x = positions.getX(vertex)
      const z = positions.getZ(vertex)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minZ = Math.min(minZ, z)
      maxZ = Math.max(maxZ, z)
      clearance = Math.min(clearance, frame.width / 2 - halfRail - Math.abs(x), frame.depth / 2 - halfRail - Math.abs(z))
    }
    return { ...frame, minX, maxX, minZ, maxZ, clearance }
  } finally {
    geometry.dispose()
  }
}

describe('preview support frame', () => {
  it.each([-180, -90, -45, 0, 45, 90, 180])('keeps a circular shade the same size with %s degrees of twist', twist => {
    const frame = frameMeasurements({ ...DEFAULT_PARAMETERS, shape: 'circle', depth: 120, twist })
    expect(frame.width).toBeCloseTo(0.215, 7)
    expect(frame.depth).toBeCloseTo(0.215, 7)
    expect(frame.clearance).toBeCloseTo(0.0115, 7)
  })

  it('preserves the existing clearance for an untwisted rectangular shade', () => {
    const frame = frameMeasurements({ ...DEFAULT_PARAMETERS, width: 220, depth: 160, cornerRadius: 28 })
    expect(frame.width).toBeCloseTo(0.255, 7)
    expect(frame.depth).toBeCloseTo(0.195, 7)
    expect(frame.clearance).toBeCloseTo(0.0115, 7)
  })

  it('fits rounded corners at 45 degrees without reserving the missing square corners', () => {
    const frame = frameMeasurements({ ...DEFAULT_PARAMETERS, twist: 45 })
    const roundedSpan = (180 - 2 * 30) * Math.SQRT2 + 2 * 30
    const expected = (roundedSpan + 35) / 1000
    // The rendered contour samples the circular arcs, so its span can be
    // fractionally smaller than the analytic rounded-square silhouette.
    expect(frame.width).toBeLessThanOrEqual(expected + 1e-7)
    expect(frame.width).toBeGreaterThan(expected - 0.0005)
    expect(frame.depth).toBeCloseTo(frame.width, 7)
    expect(frame.width).toBeLessThan((180 * Math.SQRT2 + 35) / 1000 - 0.020)
    expect(frame.clearance).toBeCloseTo(0.0115, 7)
  })

  it.each([-35, 35])('clears intermediate pleat bulges with 90 degrees of twist and %s%% modulation', modulation => {
    const frame = frameMeasurements({ ...DEFAULT_PARAMETERS, depth: 120, pleats: 25, twist: 90, modulation })
    // Both terminal flanges fit within 180 mm on each axis. The larger
    // intermediate contours must still determine the support dimensions.
    expect(frame.width).toBeGreaterThan(0.215)
    expect(frame.depth).toBeGreaterThan(0.215)
    expect(frame.clearance).toBeCloseTo(0.0115, 7)
  })

  it('keeps an asymmetric polygon inside a frame centered on the mounting axis', () => {
    const frame = frameMeasurements({ ...DEFAULT_PARAMETERS, shape: 'polygon', sides: 3, depth: 130 })
    expect(Math.abs(frame.minX)).toBeGreaterThan(frame.maxX + 0.020)
    expect(Math.abs(frame.minZ)).toBeGreaterThan(frame.maxZ + 0.010)
    // Using only bounding-box size would lose clearance on the longer side.
    expect(frame.width).toBeGreaterThan(frame.maxX - frame.minX + 0.035 + 0.020)
    expect(frame.depth).toBeGreaterThan(frame.maxZ - frame.minZ + 0.035 + 0.010)
    expect(frame.clearance).toBeCloseTo(0.0115, 7)
  })
})
