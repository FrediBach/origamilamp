import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMETERS, deriveLamp, manufacturingErrors, validateLamp } from './lamp'
import { MOUNTING, deriveMounting } from './mounting'
import { previewContour } from './preview-geometry'
import { buildManufacturingGeometry } from './manufacturing'

describe('terminal flange mounting', () => {
  it('overlaps both terminal flanges while leaving the outer fold exits free', () => {
    const p = { ...DEFAULT_PARAMETERS, shape: 'circle' as const }
    const mount = deriveMounting(p)
    const innerFlange = previewContour(p, p.bandWidth)[0].length()
    const outerFlange = previewContour(p, 0)[0].length()
    const innerClamp = previewContour(p, p.bandWidth + mount.apertureIntrusion)[0].length()
    const outerClamp = previewContour(p, p.bandWidth - mount.gripWidth)[0].length()

    expect(outerClamp - innerFlange).toBeCloseTo(8, 8)
    expect(innerFlange - innerClamp).toBeCloseTo(6, 8)
    expect(outerFlange - p.outerConnector - outerClamp).toBeGreaterThanOrEqual(2)
    // Screws located halfway into the aperture lip do not pierce the TPU.
    const screwCentre = innerFlange - mount.apertureIntrusion / 2
    expect(screwCentre + MOUNTING.screwRadius).toBeLessThan(innerFlange)
    expect(screwCentre - MOUNTING.screwRadius).toBeGreaterThan(innerClamp)
    expect(mount.canMount).toBe(true)
    expect(mount.upperY - mount.lowerY).toBeCloseTo(deriveLamp(p).displayHeight, 8)
    // Both links touch the rail top rather than passing through the wood.
    for (const [railY, linkY] of [[mount.lowerRailY, mount.lowerLinkY], [mount.upperRailY, mount.upperLinkY]]) {
      expect(railY + MOUNTING.frameRailHeight / 2).toBeCloseTo(linkY - MOUNTING.plateThickness / 2, 8)
    }
    const halfMembrane = p.tpuLayers * p.layerHeight / 2
    expect(mount.lowerLinkY + MOUNTING.plateThickness / 2).toBeCloseTo(mount.lowerY - halfMembrane - MOUNTING.plateThickness, 8)
    expect(mount.upperLinkY - MOUNTING.plateThickness / 2).toBeCloseTo(mount.upperY + halfMembrane + MOUNTING.plateThickness, 8)
  })

  it('accounts for both inward clamp lips when checking light clearance', () => {
    const p = { ...DEFAULT_PARAMETERS, shape: 'circle' as const, width: 100 }
    const diagnostics = validateLamp(p)
    expect(deriveMounting(p).minimumOpening).toBe(44)
    expect(diagnostics).toContainEqual(expect.objectContaining({ id: 'light-clearance', status: 'pass' }))
    expect(diagnostics).toContainEqual(expect.objectContaining({ id: 'mounting-clearance', status: 'error' }))
    expect(manufacturingErrors(p)).toContainEqual(expect.objectContaining({ id: 'mounting-clearance' }))
  })

  it('uses the circular diameter or the narrower rectangular dimension for clearance', () => {
    expect(deriveMounting({ ...DEFAULT_PARAMETERS, shape: 'circle', depth: 80 }).minimumOpening).toBe(124)
    expect(deriveMounting({ ...DEFAULT_PARAMETERS, width: 220, depth: 140 }).minimumOpening).toBe(84)
  })

  it('allows a printable narrow-band specimen while identifying an inadequate clamp grip', () => {
    const p = { ...DEFAULT_PARAMETERS, shape: 'circle' as const, bandWidth: 5.4, pleats: 4, height: 100 }
    const mount = deriveMounting(p)
    expect(mount.gripWidth).toBeCloseTo(2.2, 8)
    expect(p.bandWidth - mount.gripWidth - p.outerConnector).toBeCloseTo(2, 8)
    expect(mount.canMount).toBe(false)
    expect(validateLamp(p)).toContainEqual(expect.objectContaining({ id: 'mounting-grip', status: 'warning' }))
    expect(manufacturingErrors(p)).toEqual([])
    const print = buildManufacturingGeometry(p)
    print.tpu.dispose()
    print.pla.dispose()
  })

  it('reserves two membranes from the available axial span and keeps load validation pending', () => {
    const derived = deriveLamp(DEFAULT_PARAMETERS)
    expect(derived.activeLegs).toBe(2 * DEFAULT_PARAMETERS.pleats - 2)
    expect(derived.estimatedMaxHeight).toBeCloseTo(derived.activeLegs * derived.freeSpan, 8)
    expect(validateLamp(DEFAULT_PARAMETERS)).toContainEqual(expect.objectContaining({ id: 'mounting-load', status: 'warning' }))
  })

  it('does not present one-pleat specimens or overlapping clamp pairs as mounted designs', () => {
    const singlePleat = { ...DEFAULT_PARAMETERS, pleats: 1 }
    const collapsed = { ...DEFAULT_PARAMETERS, pleats: 4, expansion: 0 }
    for (const p of [singlePleat, collapsed]) {
      expect(deriveMounting(p).canMount).toBe(false)
      expect(validateLamp(p)).toContainEqual(expect.objectContaining({ id: 'mounting-height', status: 'warning' }))
      expect(manufacturingErrors(p)).toEqual([])
    }
    expect(deriveMounting(singlePleat).displayHeight).toBeCloseTo(1.2, 8)
  })
})
