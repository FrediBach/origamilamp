import { afterAll, describe, expect, it } from 'vitest'
import { ShaderLib, Texture, type WebGLProgramParametersWithUniforms } from 'three'
import { DEFAULT_PARAMETERS, type LampParameters } from './lamp'
import { applyPatternTransmission, applyTextShadow, applyTextTransmission, buildTextMaskAtlas, shadowCoverageThreshold } from './shade-material'
import { TEXT_COLORS } from './text-projection'

const parameters = { ...DEFAULT_PARAMETERS, textEnabled: true, text: 'O', textRotation: 23, textAzimuth: 170 }
const atlas = buildTextMaskAtlas(parameters)!
afterAll(() => atlas.texture.dispose())

function materialShader(kind: 'standard' | 'depth' | 'distance') {
  return {
    vertexShader: ShaderLib[kind].vertexShader,
    fragmentShader: ShaderLib[kind].fragmentShader,
    uniforms: {},
  } as WebGLProgramParametersWithUniforms
}

function coverageFunction(shader: WebGLProgramParametersWithUniforms) {
  const source = shader.fragmentShader
  const start = source.indexOf('float glyphCoverage(')
  return source.slice(start, source.indexOf('return pigmentCoverage;', start) + 'return pigmentCoverage;'.length)
}

describe('native lettering shadows', () => {
  it.each(['circle', 'rounded-rectangle'] as const)('shares the exact folded %s mask between the surface and both shadow passes', shape => {
    const p = { ...parameters, shape }
    const visible = materialShader('standard'), point = materialShader('distance'), external = materialShader('depth')
    const glow = new Texture()
    applyPatternTransmission(visible, p, glow)
    applyTextTransmission(visible, p, atlas)
    applyTextShadow(point, p, atlas)
    applyTextShadow(external, p, atlas, true)
    try {
      // Native shadow coverage must retain counters, projection rotation and
      // repeated perimeter copies using the very same distance-field code.
      expect(coverageFunction(point)).toEqual(coverageFunction(visible))
      expect(coverageFunction(external)).toEqual(coverageFunction(visible))
      for (const key of ['textPigmentMap', 'textPigmentBounds', 'textGlyphTexture', 'textProjection', 'textGlyphRotation', 'textSheetProjection', 'textSheetSettings']) {
        expect(point.uniforms[key].value).toEqual(visible.uniforms[key].value)
        expect(external.uniforms[key].value).toEqual(visible.uniforms[key].value)
      }
      for (const shader of [visible, point, external]) {
        expect(shader.vertexShader.match(/attribute vec3 cutoutCoord;/g)).toHaveLength(1)
        expect(shader.fragmentShader.match(/varying vec3 vCutoutCoord;/g)).toHaveLength(1)
        expect(shader.fragmentShader.indexOf('varying vec3 vCutoutCoord;')).toBeLessThan(shader.fragmentShader.indexOf('float textCoverage()'))
      }
    } finally { glow.dispose() }
  })

  it.each(['depth', 'distance'] as const)('keeps the native %s encoding and applies ordered coverage before writing depth', kind => {
    const shader = materialShader(kind)
    const output = shader.fragmentShader.split('#include <alphahash_fragment>')[1]
    applyTextShadow(shader, parameters, atlas, kind === 'depth')
    expect(shader.fragmentShader.endsWith(output)).toBe(true)
    expect(shader.fragmentShader).toContain('#include <alphahash_pars_fragment>')
    expect(shader.fragmentShader).toContain('diffuseColor.a = mix(textShadowOpacities.x, textShadowOpacities.y, textCoverage());')
    expect(shader.fragmentShader).not.toContain('#include <alphahash_fragment>')
    expect(shader.fragmentShader).toContain('if (diffuseColor.a < textShadowThreshold()) discard;')
    expect(shader.fragmentShader).toContain('const float textShadowBayer[64]')
    expect(shader.fragmentShader).toContain('gl_FragCoord.x * c - gl_FragCoord.y * s')
    expect(shader.fragmentShader).not.toContain('cutoutSettings')
  })

  it.each(['black', 'brown', 'beige'] as const)('accounts for %s transmission once across base transport and native glyph shadows', textColor => {
    for (const tpuLayers of [1, 2, 4]) {
      const p: LampParameters = { ...parameters, textColor, tpuLayers }
      const point = materialShader('distance'), external = materialShader('depth')
      applyTextShadow(point, p, atlas)
      applyTextShadow(external, p, atlas, true)
      const [pointBase, pointGlyph] = point.uniforms.textShadowOpacities.value as number[]
      const [externalBase, externalGlyph] = external.uniforms.textShadowOpacities.value as number[]
      const baseTransmission = Math.exp(-1.1 * p.tpuLayers * p.layerHeight)
      const totalTransmission = Math.pow(TEXT_COLORS[textColor].transmission, p.tpuLayers * p.layerHeight / 0.4)
      expect(pointBase).toBe(0)
      expect(baseTransmission * (1 - pointGlyph)).toBeCloseTo(totalTransmission, 10)
      expect(1 - externalBase).toBeCloseTo(baseTransmission, 10)
      expect(1 - externalGlyph).toBeCloseTo(totalTransmission, 10)
    }
  })

  it('keeps base transmission unchanged when lettering is disabled or blank', () => {
    for (const external of [false, true]) {
      const lettered = materialShader('depth')
      applyTextShadow(lettered, parameters, atlas, external)
      for (const p of [{ ...parameters, textEnabled: false }, { ...parameters, text: '' }]) {
        const shader = materialShader('depth')
        applyTextShadow(shader, p, null, external)
        expect(shader.uniforms.textShadowOpacities.value[0]).toBe(lettered.uniforms.textShadowOpacities.value[0])
        expect(shader.uniforms.textPigmentMap).toBeUndefined()
        expect(shader.fragmentShader).not.toContain('textCoverage()')
        expect(shader.fragmentShader).toContain('mix(textShadowOpacities.x, textShadowOpacities.y, 0.0)')
      }
    }
  })

  it.each(['depth', 'distance'] as const)('preserves native alpha hashing for plain %s shadows', kind => {
    const shader = materialShader(kind)
    const output = shader.fragmentShader.split('#include <alphahash_fragment>')[1]
    applyTextShadow(shader, { ...parameters, textEnabled: false }, null, kind === 'depth')
    expect(shader.vertexShader).toContain('#define USE_ALPHAHASH')
    expect(shader.fragmentShader).toContain('#define USE_ALPHAHASH')
    expect(shader.fragmentShader).toContain('#include <alphahash_fragment>')
    expect(shader.fragmentShader.endsWith(output)).toBe(true)
    expect(shader.fragmentShader).not.toContain('textShadowBayer')
    expect(shader.vertexShader).not.toContain('attribute vec3 cutoutCoord;')
  })

  it('keeps enabled blank lettering on the ordered filter path', () => {
    const shader = materialShader('depth')
    applyTextShadow(shader, { ...parameters, text: '' }, null, true)
    expect(shader.fragmentShader).toContain('textShadowBayer')
    expect(shader.fragmentShader).not.toContain('#include <alphahash_fragment>')
    expect(shader.fragmentShader).not.toContain('#define USE_ALPHAHASH')
    expect(shader.uniforms.textPigmentMap).toBeUndefined()
  })

  it('distributes all 64 coverage thresholds evenly in every unrotated tile', () => {
    const thresholds = Array.from({ length: 64 }, (_, index) => shadowCoverageThreshold(index % 8 + 0.5, Math.floor(index / 8) + 0.5, 0)).sort((a, b) => a - b)
    expect(thresholds).toEqual(Array.from({ length: 64 }, (_, index) => (index + 0.5) / 64))
    for (const opacity of [0.2, 0.35, 0.55, 0.8, 0.98]) {
      expect(Math.abs(thresholds.filter(value => value <= opacity).length / 64 - opacity)).toBeLessThanOrEqual(1 / 128)
    }
  })

  it.each([1, 17, 35])('preserves cumulative transmission across three consecutive sheets starting at %i', firstSheet => {
    // Integer translations alone would align or invert a half-opacity Bayer
    // checkerboard, making two membranes transmit either 50% or 0%, not 25%.
    const transmission = 0.5
    const counts = [0, 0, 0]
    const size = 192
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let passes = true
      for (let sheet = 0; sheet < 3; sheet++) {
        passes = passes && shadowCoverageThreshold(x + 0.5, y + 0.5, firstSheet + sheet) > 1 - transmission
        if (passes) counts[sheet]++
      }
    }
    counts.forEach((count, layer) => expect(Math.abs(count / size ** 2 - transmission ** (layer + 1))).toBeLessThan(0.012))
  })
})
