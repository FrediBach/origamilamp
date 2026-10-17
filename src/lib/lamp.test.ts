import { describe, expect, it } from 'vitest'
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3, type BufferGeometry } from 'three'
import { strFromU8, unzipSync } from 'fflate'
import { DEFAULT_PARAMETERS, calibrationParameters, deriveLamp, manufacturingErrors, validateLamp, type LampParameters } from './lamp'
import { buildManufacturingGeometry, offsetContour } from './manufacturing'
import { createManufacturingArchive, geometryToSTL, parseDesign, serializeDesign } from './export'
import { WOOD_FINISHES, WOOD_SPECIES } from './wood'

/** Independent mesh audit: geometric degeneracy, duplicate faces, every edge's
 * two opposite incidences, connected surface count, Euler characteristic and
 * oriented tetrahedral volume. This examines output triangles, not cell data. */
function auditMesh(geometry: BufferGeometry) {
  const p = geometry.getAttribute('position')
  const index = geometry.getIndex()!
  const parent = Array.from({ length: p.count }, (_, vertex) => vertex)
  const root = (vertex: number): number => {
    while (parent[vertex] !== vertex) { parent[vertex] = parent[parent[vertex]]; vertex = parent[vertex] }
    return vertex
  }
  const edges = new Map<string, { count: number; orientation: number }>()
  const faces = new Set<string>()
  let volume = 0
  let minDoubleArea = Infinity
  for (let face = 0; face < index.count; face += 3) {
    const ids = [index.getX(face), index.getX(face + 1), index.getX(face + 2)]
    const [a, b, c] = ids.map(id => new Vector3().fromBufferAttribute(p, id))
    minDoubleArea = Math.min(minDoubleArea, b.clone().sub(a).cross(c.clone().sub(a)).length())
    volume += a.dot(b.clone().cross(c)) / 6
    faces.add([...ids].sort((left, right) => left - right).join('/'))
    for (let side = 0; side < 3; side++) {
      const from = ids[side], to = ids[(side + 1) % 3]
      parent[root(to)] = root(from)
      const key = from < to ? `${from}/${to}` : `${to}/${from}`
      const edge = edges.get(key) ?? { count: 0, orientation: 0 }
      edge.count++
      edge.orientation += from < to ? 1 : -1
      edges.set(key, edge)
    }
  }
  return {
    volume, minDoubleArea,
    invalidEdges: [...edges.values()].filter(edge => edge.count !== 2 || edge.orientation !== 0).length,
    duplicateFaces: index.count / 3 - faces.size,
    components: new Set(parent.map((_, vertex) => root(vertex))).size,
    euler: p.count - edges.size + index.count / 3,
  }
}

function sectionArea(p: LampParameters, inset: number) {
  if (p.shape === 'circle') return Math.PI * (p.width / 2 - inset) ** 2
  return (p.width - 2 * inset) * (p.depth - 2 * inset) - (4 - Math.PI) * (p.cornerRadius - inset) ** 2
}

describe('bellows parameters and diagnostics', () => {
  it('matches the brief’s canonical 50-pleat print-height arithmetic', () => {
    const d = deriveLamp({ ...DEFAULT_PARAMETERS, pleats: 50 })
    expect(d.sheets).toBe(100)
    expect(d.separators).toBe(99)
    expect(d.compressedHeight).toBeCloseTo(79.6, 10)
  })
  it('keeps physical validation pending and checks every geometric setting', () => {
    expect(manufacturingErrors(DEFAULT_PARAMETERS)).toEqual([])
    expect(validateLamp(DEFAULT_PARAMETERS)).toContainEqual(expect.objectContaining({ id: 'calibration', status: 'warning' }))
    expect(validateLamp({ ...DEFAULT_PARAMETERS, lightDiameter: 150 })).toContainEqual(expect.objectContaining({ id: 'light-clearance', status: 'error' }))
    expect(validateLamp({ ...DEFAULT_PARAMETERS, height: 1500 })).toContainEqual(expect.objectContaining({ id: 'height', status: 'warning' }))
  })
  it('describes spring calibration without changing shade manufacture eligibility', () => {
    const p = { ...DEFAULT_PARAMETERS, attachment: 'springs' as const }
    expect(manufacturingErrors(p)).toEqual([])
    expect(validateLamp(p)).toContainEqual(expect.objectContaining({
      id: 'mounting-load', status: 'warning', detail: expect.stringContaining('Four short metal extension springs at each end'),
    }))
    expect(deriveLamp(p)).toEqual(deriveLamp(DEFAULT_PARAMETERS))
  })
  it('accepts an optional electronics box without changing shade print arithmetic', () => {
    const p = { ...DEFAULT_PARAMETERS, electronicsBox: true, electronicsBoxHeight: 120 }
    expect(manufacturingErrors(p)).toEqual([])
    expect(deriveLamp(p)).toEqual(deriveLamp(DEFAULT_PARAMETERS))
  })
  it.each([false, true])('checks internal box height even when enabled is %s', electronicsBox => {
    expect(validateLamp({ ...DEFAULT_PARAMETERS, electronicsBox, electronicsBoxHeight: 19 })).toContainEqual(expect.objectContaining({ id: 'base-range', status: 'error' }))
    expect(validateLamp({ ...DEFAULT_PARAMETERS, electronicsBox, electronicsBoxHeight: 121 })).toContainEqual(expect.objectContaining({ id: 'base-range', status: 'error' }))
  })
  it.each([
    { bandWidth: 95 }, { bandWidth: 3 }, { cornerRadius: 12 }, { cornerRadius: 90 },
    { pleats: 4.5 }, { tpuLayers: 1.5 }, { separatorLayers: 0 }, { layerHeight: 0.01 },
    { innerConnector: 0.2 }, { width: 300 }, { bedHeight: 10 }, { width: NaN },
    { width: 1e20, bedWidth: 1e20 }, { extrusionWidth: 1e-20, outerConnector: 1e-18 },
    { shape: 'circle' as const, width: 44.001, lightDiameter: 0.0001, lightClearance: 0 },
  ])('rejects invalid manufacture settings: %j', (change) => {
    const p = { ...DEFAULT_PARAMETERS, ...change }
    expect(() => deriveLamp(p)).not.toThrow()
    expect(() => validateLamp(p)).not.toThrow()
    expect(manufacturingErrors(p).length).toBeGreaterThan(0)
    expect(() => buildManufacturingGeometry(p)).toThrow()
  })
  it.each([{ twist: 12 }, { modulation: 10 }, { shape: 'polygon' as const }])('gates unsupported variable geometry: %j', (change) => {
    const p = { ...DEFAULT_PARAMETERS, ...change }
    expect(validateLamp(p)).toContainEqual(expect.objectContaining({ id: 'experimental-profile', status: 'warning' }))
    expect(() => createManufacturingArchive(p)).toThrow(/preview only/)
  })
})

describe('manufacturing boundary solids', () => {
  const cases: Partial<LampParameters>[] = [
    { shape: 'circle', pleats: 1 },
    { shape: 'rounded-rectangle', width: 220, depth: 140, pleats: 4 },
    { shape: 'rounded-rectangle', pleats: 60 },
    { shape: 'circle', pleats: 4, bandWidth: 5.4, height: 100 },
    { shape: 'rounded-rectangle', pleats: 4, bandWidth: 5.4, cornerRadius: 6, height: 100, layerHeight: 0.12, tpuLayers: 3, separatorLayers: 3 },
  ]
  it.each(cases)('is watertight, consistently wound and connected for %j', (change) => {
    const p = { ...DEFAULT_PARAMETERS, ...change }
    const { tpu, pla } = buildManufacturingGeometry(p)
    const d = deriveLamp(p)
    const tpuAudit = auditMesh(tpu), plaAudit = auditMesh(pla)
    for (const audit of [tpuAudit, plaAudit]) {
      expect(audit.invalidEdges).toBe(0)
      expect(audit.duplicateFaces).toBe(0)
      expect(audit.minDoubleArea).toBeGreaterThan(1e-7)
      expect(audit.volume).toBeGreaterThan(0)
      expect(audit.euler).toBe(0)
    }
    expect(tpuAudit.components).toBe(1)
    expect(plaAudit.components).toBe(d.separators)
    const membraneArea = sectionArea(p, 0) - sectionArea(p, p.bandWidth)
    const outerJoinArea = sectionArea(p, 0) - sectionArea(p, p.outerConnector)
    const innerJoinArea = sectionArea(p, p.bandWidth - p.innerConnector) - sectionArea(p, p.bandWidth)
    const expectedTPU = membraneArea * d.membraneThickness * d.sheets + d.separatorThickness * (Math.ceil(d.separators / 2) * outerJoinArea + Math.floor(d.separators / 2) * innerJoinArea)
    expect(tpuAudit.volume / expectedTPU).toBeCloseTo(1, 3)
    expect((tpuAudit.volume + plaAudit.volume) / (membraneArea * d.compressedHeight)).toBeCloseTo(1, 3)
    for (const geometry of [tpu, pla]) {
      const vertices = geometry.getAttribute('position')
      let layerMismatch = 0
      for (let vertex = 0; vertex < vertices.count; vertex++) layerMismatch = Math.max(layerMismatch, Math.abs(vertices.getZ(vertex) / p.layerHeight - Math.round(vertices.getZ(vertex) / p.layerHeight)))
      expect(layerMismatch).toBeLessThan(0.0001)
      geometry.dispose()
    }
  })

  it('uses normal offsets at rounded corners and straight edges', () => {
    const outer = offsetContour(DEFAULT_PARAMETERS, 0)
    const inner = offsetContour(DEFAULT_PARAMETERS, DEFAULT_PARAMETERS.bandWidth)
    outer.forEach(([x, y], i) => expect(Math.hypot(x - inner[i][0], y - inner[i][1])).toBeCloseTo(DEFAULT_PARAMETERS.bandWidth, 8))
  })

  it('has alternating material interiors and an unobstructed removal direction at every gap', () => {
    const p = { ...DEFAULT_PARAMETERS, pleats: 4 }
    const geometry = buildManufacturingGeometry(p)
    const material = new MeshBasicMaterial({ side: DoubleSide })
    const meshes = { tpu: new Mesh(geometry.tpu, material), pla: new Mesh(geometry.pla, material) }
    const inside = (mesh: Mesh, point: Vector3) => {
      const hits = new Raycaster(point, new Vector3(1, 0, 0)).intersectObject(mesh)
      const distances = hits.map(hit => Math.round(hit.distance * 1e6))
      return new Set(distances).size % 2 === 1
    }
    for (let sheet = 0; sheet < 8; sheet++) {
      const z = sheet * 0.8
      for (const x of [68.6, 79, 89.4]) {
        expect(inside(meshes.tpu, new Vector3(x, 0.731, z + 0.2))).toBe(true)
        expect(inside(meshes.pla, new Vector3(x, 0.731, z + 0.2))).toBe(false)
      }
      expect(inside(meshes.tpu, new Vector3(0, 0.731, z + 0.2))).toBe(false)
      if (sheet === 7) continue
      for (const [band, x] of [89.4, 79, 68.6].entries()) {
        const isConnector = band === (sheet % 2 === 0 ? 0 : 2)
        const point = new Vector3(x, 0.731, z + 0.6)
        expect(inside(meshes.tpu, point)).toBe(isConnector)
        expect(inside(meshes.pla, point)).toBe(!isConnector)
      }
      const escape = new Raycaster(new Vector3(79, 0.731, z + 0.6), new Vector3(sheet % 2 === 0 ? -1 : 1, 0, 0), 0, sheet % 2 === 0 ? 79 : 20)
      expect(escape.intersectObject(meshes.tpu)).toHaveLength(0)
    }
    geometry.tpu.dispose(); geometry.pla.dispose(); material.dispose()
  })

  it('leaves print vertices unchanged when appearance settings change', () => {
    const a = buildManufacturingGeometry(DEFAULT_PARAMETERS)
    const b = buildManufacturingGeometry({ ...DEFAULT_PARAMETERS, height: 550, expansion: 20, rotation: 90, material: 'white', frameWood: 'walnut', boxWood: 'ash' })
    expect(b.tpu.getAttribute('position').array).toEqual(a.tpu.getAttribute('position').array)
    expect(b.pla.getAttribute('position').array).toEqual(a.pla.getAttribute('position').array)
    Object.values(a).forEach(mesh => mesh.dispose()); Object.values(b).forEach(mesh => mesh.dispose())
  })

  it('exports a full-perimeter specimen with four pleats and the original section', () => {
    const p = calibrationParameters(DEFAULT_PARAMETERS)
    const geometry = buildManufacturingGeometry(DEFAULT_PARAMETERS, { calibration: true })
    expect(p.pleats).toBe(4)
    expect(geometry.tpu.boundingBox!.max.z).toBeCloseTo(6, 5)
    expect(geometry.tpu.boundingBox!.max.x - geometry.tpu.boundingBox!.min.x).toBe(180)
    expect(auditMesh(geometry.pla).components).toBe(7)
    geometry.tpu.dispose(); geometry.pla.dispose()
  })
})

describe('registered exports and design files', () => {
  it('round trips every design setting and rejects malformed imports', () => {
    expect(parseDesign(serializeDesign(DEFAULT_PARAMETERS))).toEqual(DEFAULT_PARAMETERS)
    expect(() => parseDesign('{}')).toThrow(/version/)
    expect(() => parseDesign('{')).toThrow(/JSON/)
    expect(() => parseDesign(JSON.stringify({ schemaVersion: 1, parameters: { ...DEFAULT_PARAMETERS, width: '180' } }))).toThrow(/width/)
    expect(() => parseDesign(JSON.stringify({ schemaVersion: 1, parameters: { ...DEFAULT_PARAMETERS, expansion: 200 } }))).toThrow(/range/)
  })
  it.each(WOOD_SPECIES)('round trips the %s wood on the support frame and box', species => {
    const p = { ...DEFAULT_PARAMETERS, frameWood: species, boxWood: species }
    const serialized = serializeDesign(p)
    expect(parseDesign(serialized)).toEqual(p)
    const { mounting, electronicsBox } = JSON.parse(serialized).recipe
    expect(mounting.frameWood).toEqual({ species, name: WOOD_FINISHES[species].name })
    expect(electronicsBox.wood).toEqual({ selection: species, species, name: WOOD_FINISHES[species].name })
  })
  it('keeps the match-frame selection while resolving the current frame finish in the recipe', () => {
    const p = { ...DEFAULT_PARAMETERS, frameWood: 'cherry' as const }
    const serialized = serializeDesign(p)
    expect(parseDesign(serialized).boxWood).toBe('match-frame')
    expect(JSON.parse(serialized).recipe.electronicsBox.wood).toEqual({
      selection: 'match-frame', species: 'cherry', name: WOOD_FINISHES.cherry.name,
    })
  })
  it.each([false, true])('records the actual base-board wood when the box is enabled: %s', electronicsBox => {
    const p = { ...DEFAULT_PARAMETERS, frameWood: 'walnut' as const, boxWood: 'ash' as const, electronicsBox }
    const recipe = JSON.parse(serializeDesign(p)).recipe
    expect(recipe.mounting.baseWood.species).toBe(electronicsBox ? 'ash' : 'walnut')
    expect(recipe.electronicsBox.wood.species).toBe('ash')
  })
  it.each([['frameWood'], ['boxWood'], ['frameWood', 'boxWood']])('migrates only absent version 1 wood fields: %j', (...missingFields) => {
    const document = JSON.parse(serializeDesign(DEFAULT_PARAMETERS))
    missingFields.forEach(key => { delete document.parameters[key] })
    expect(parseDesign(JSON.stringify(document))).toEqual(DEFAULT_PARAMETERS)
  })
  it.each(['frameWood', 'boxWood'])('rejects explicit invalid %s even when the box is disabled', field => {
    for (const value of [null, 1, true, '', 'mahogany', 'OAK', {}, []]) {
      const parameters = { ...DEFAULT_PARAMETERS, electronicsBox: false, [field]: value }
      expect(() => parseDesign(JSON.stringify({ schemaVersion: 1, parameters }))).toThrow(/frameWood|boxWood|Unsupported design value/)
      expect(validateLamp(parameters as LampParameters)).toContainEqual(expect.objectContaining({ id: 'values', status: 'error' }))
    }
    if (field === 'frameWood') {
      expect(() => parseDesign(JSON.stringify({ schemaVersion: 1, parameters: { ...DEFAULT_PARAMETERS, frameWood: 'match-frame' } }))).toThrow(/Unsupported design value/)
    }
  })
  it.each([false, true])('exports selected wood instructions without changing STL geometry (calibration: %s)', calibration => {
    const p = { ...DEFAULT_PARAMETERS, pleats: 4, electronicsBox: true }
    const original = unzipSync(createManufacturingArchive(p, { calibration }))
    const changed = unzipSync(createManufacturingArchive({ ...p, frameWood: 'walnut', boxWood: 'maple' }, { calibration }))
    expect(changed['shade-tpu.stl']).toEqual(original['shade-tpu.stl'])
    expect(changed['separators-pla.stl']).toEqual(original['separators-pla.stl'])
    expect(parseDesign(strFromU8(changed['design.json']))).toEqual(expect.objectContaining({ frameWood: 'walnut', boxWood: 'maple' }))
    const instructions = strFromU8(changed['READ-ME.txt'])
    expect(instructions).toContain(`Support frame wood: ${WOOD_FINISHES.walnut.name}. Base board wood: ${WOOD_FINISHES.maple.name}.`)
    expect(instructions).toContain(`Configured optional box wood: ${WOOD_FINISHES.maple.name}.`)
    expect(instructions).toContain(`Wood finish: ${WOOD_FINISHES.maple.name}.`)
    expect(instructions).not.toContain('oak frame')
    expect(strFromU8(original['READ-ME.txt'])).toContain('(matches the support frame)')
  })
  it.each(['bolted', 'springs'] as const)('round trips the %s attachment and hardware recipe', attachment => {
    const p = { ...DEFAULT_PARAMETERS, attachment }
    const serialized = serializeDesign(p)
    expect(parseDesign(serialized)).toEqual(p)
    const { mounting } = JSON.parse(serialized).recipe
    expect(mounting.attachment).toBe(attachment)
    expect(mounting.frameConnection).toBe(attachment === 'springs' ? 'short-metal-extension-springs' : 'rigid-bolted-links')
    expect(mounting.frameConnectionsPerEnd).toBe(4)
    expect(mounting.hardwareIncludedInSTLs).toBe(false)
    if (attachment === 'springs') expect(mounting.springs).toEqual(expect.objectContaining({ count: 8, selection: expect.stringContaining('physical calibration') }))
    else expect(mounting.springs).toBeUndefined()
  })
  it('migrates version 1 designs without attachment to the original bolted supports', () => {
    const document = JSON.parse(serializeDesign(DEFAULT_PARAMETERS))
    delete document.parameters.attachment
    expect(parseDesign(JSON.stringify(document))).toEqual(DEFAULT_PARAMETERS)
  })
  it.each([null, 1, true, '', 'elastic-cord', {}, []])('rejects an explicit unsupported attachment: %j', attachment => {
    const document = { schemaVersion: 1, parameters: { ...DEFAULT_PARAMETERS, attachment } }
    expect(() => parseDesign(JSON.stringify(document))).toThrow(/attachment|Unsupported design value/)
  })
  it.each([
    { electronicsBox: false, electronicsBoxHeight: 20 },
    { electronicsBox: true, electronicsBoxHeight: 40 },
    { electronicsBox: true, electronicsBoxHeight: 120 },
  ])('round trips electronics box settings and hardware recipe: %j', settings => {
    const p = { ...DEFAULT_PARAMETERS, ...settings }
    const serialized = serializeDesign(p)
    expect(parseDesign(serialized)).toEqual(p)
    expect(JSON.parse(serialized).recipe.electronicsBox).toEqual(expect.objectContaining({
      enabled: settings.electronicsBox,
      type: 'wooden-base-compartment',
      internalHeightMillimetres: settings.electronicsBoxHeight,
      status: 'space-reservation-only',
      hardwareIncludedInSTLs: false,
    }))
  })
  it.each([['electronicsBox'], ['electronicsBoxHeight'], ['electronicsBox', 'electronicsBoxHeight']])('migrates absent version 1 base fields: %j', (...missingFields) => {
    const document = JSON.parse(serializeDesign(DEFAULT_PARAMETERS))
    missingFields.forEach(key => { delete document.parameters[key] })
    expect(parseDesign(JSON.stringify(document))).toEqual(DEFAULT_PARAMETERS)
  })
  it.each([null, 1, 'true', '', {}, []])('rejects an explicit invalid electronics box switch: %j', electronicsBox => {
    const document = { schemaVersion: 1, parameters: { ...DEFAULT_PARAMETERS, electronicsBox } }
    expect(() => parseDesign(JSON.stringify(document))).toThrow(/electronicsBox/)
  })
  it.each([null, true, '40', '', {}, [], 0, 19, 121, -40])('rejects an explicit invalid box height even when disabled: %j', electronicsBoxHeight => {
    const document = { schemaVersion: 1, parameters: { ...DEFAULT_PARAMETERS, electronicsBox: false, electronicsBoxHeight } }
    expect(() => parseDesign(JSON.stringify(document))).toThrow(/electronicsBoxHeight|Electronics box height/)
  })
  it.each([false, true])('records box instructions with unchanged STL geometry (calibration: %s)', calibration => {
    const p = { ...DEFAULT_PARAMETERS, pleats: 4, attachment: 'springs' as const }
    const ordinary = unzipSync(createManufacturingArchive(p, { calibration }))
    const boxed = unzipSync(createManufacturingArchive({ ...p, electronicsBox: true, electronicsBoxHeight: 75 }, { calibration }))
    expect(boxed['shade-tpu.stl']).toEqual(ordinary['shade-tpu.stl'])
    expect(boxed['separators-pla.stl']).toEqual(ordinary['separators-pla.stl'])
    expect(parseDesign(strFromU8(boxed['design.json']))).toEqual(expect.objectContaining({ electronicsBox: true, electronicsBoxHeight: 75 }))
    const instructions = strFromU8(boxed['READ-ME.txt'])
    expect(instructions).toContain('wooden base box with 75 mm usable internal height')
    expect(instructions).toContain('The wooden box and lid are separate hardware, NOT included in these STL files.')
    expect(instructions).toContain('electrical design separately')
    expect(strFromU8(ordinary['READ-ME.txt'])).toContain('Electronics box: Disabled; configured internal height is 40 mm')
  })
  it.each([false, true])('exports spring instructions with identical STL geometry (calibration: %s)', calibration => {
    const p = { ...DEFAULT_PARAMETERS, pleats: 4 }
    const bolted = unzipSync(createManufacturingArchive(p, { calibration }))
    const springs = unzipSync(createManufacturingArchive({ ...p, attachment: 'springs' }, { calibration }))
    expect(springs['shade-tpu.stl']).toEqual(bolted['shade-tpu.stl'])
    expect(springs['separators-pla.stl']).toEqual(bolted['separators-pla.stl'])
    expect(parseDesign(strFromU8(springs['design.json'])).attachment).toBe('springs')
    const instructions = strFromU8(springs['READ-ME.txt'])
    expect(instructions).toContain('Four short metal extension springs per end (eight total)')
    expect(instructions).toContain('Balance opposing spring pairs at both the top and bottom')
    expect(instructions).toContain('NOT included in these STL files')
    expect(instructions).not.toContain('Four bolted supports per end')
  })
  it('retains editable geometric conflicts but never exports them', () => {
    const invalid = { ...DEFAULT_PARAMETERS, bandWidth: 60 }
    expect(parseDesign(serializeDesign(invalid))).toEqual(invalid)
    expect(() => createManufacturingArchive(invalid)).toThrow()
  })
  it.each([
    { parameters: { ...DEFAULT_PARAMETERS, pleats: 1 }, reason: 'no-active-folds' },
    { parameters: { ...DEFAULT_PARAMETERS, shape: 'circle' as const, pleats: 4, bandWidth: 5.4, height: 100 }, reason: 'insufficient-terminal-grip' },
  ])('exports the mounting limitation with a printable $reason specimen', ({ parameters, reason }) => {
    const files = unzipSync(createManufacturingArchive(parameters, { calibration: true }))
    const design = JSON.parse(strFromU8(files['design.json']))
    const instructions = strFromU8(files['READ-ME.txt'])
    expect(design.recipe.mounting.eligibility).toBe('requires-adjusted-end-attachment')
    expect(design.recipe.mounting.limitations).toContainEqual(expect.objectContaining({ code: reason }))
    expect(design.recipe.mounting.hardwareIncludedInSTLs).toBe(false)
    expect(instructions).toContain('NOT compatible with the shown two-piece end-clamp arrangement')
    expect(instructions).toContain(design.recipe.mounting.limitations[0].detail)
    expect(instructions).toContain('NOT included in these STL files')
    expect(instructions).not.toContain('Hold BOTH ends under tension')
    expect(instructions).not.toContain('Measure comfortably deployed height per full pleat')
    expect(files['shade-tpu.stl'].byteLength).toBeGreaterThan(84)
    expect(files['separators-pla.stl'].byteLength).toBeGreaterThan(84)
  })
  it('retains mounting calibration eligibility when only the preview is collapsed', () => {
    const p = { ...DEFAULT_PARAMETERS, pleats: 4, height: 80, expansion: 0 }
    const files = unzipSync(createManufacturingArchive(p))
    const mounting = JSON.parse(strFromU8(files['design.json'])).recipe.mounting
    const expandedMounting = JSON.parse(serializeDesign({ ...p, expansion: 100 })).recipe.mounting
    expect(mounting).toEqual(expandedMounting)
    expect(mounting.eligibility).toBe('candidate-for-physical-calibration')
    expect(mounting.limitations).toEqual([])
    expect(strFromU8(files['READ-ME.txt'])).toContain('Measure comfortably deployed height per full pleat')
    expect(strFromU8(files['READ-ME.txt'])).not.toContain('NOT compatible')
  })
  it('packages both aligned binary STLs and specimen instructions', () => {
    const files = unzipSync(createManufacturingArchive(DEFAULT_PARAMETERS, { calibration: true }))
    expect(Object.keys(files).sort()).toEqual(['READ-ME.txt', 'design.json', 'separators-pla.stl', 'shade-tpu.stl'])
    expect(parseDesign(strFromU8(files['design.json'])).pleats).toBe(4)
    expect(strFromU8(files['READ-ME.txt'])).toContain('7 removable PLA separators')
    expect(strFromU8(files['READ-ME.txt'])).toContain('NOT been physically')
    const geometry = buildManufacturingGeometry(DEFAULT_PARAMETERS, { calibration: true })
    expect(files['shade-tpu.stl']).toEqual(geometryToSTL(geometry.tpu))
    for (const name of ['shade-tpu.stl', 'separators-pla.stl']) {
      const file = files[name]
      const data = new DataView(file.buffer, file.byteOffset, file.byteLength)
      const count = data.getUint32(80, true)
      expect(file.length).toBe(84 + count * 50)
      let minZ = Infinity
      for (let triangle = 0; triangle < count; triangle++) for (let corner = 0; corner < 3; corner++) minZ = Math.min(minZ, data.getFloat32(84 + triangle * 50 + 12 + corner * 12 + 8, true))
      expect(minZ).toBeCloseTo(name === 'shade-tpu.stl' ? 0 : 0.4, 6)
    }
    geometry.tpu.dispose(); geometry.pla.dispose()
  })
})
