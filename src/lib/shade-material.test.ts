import { afterAll, describe, expect, it } from 'vitest'
import { ShaderChunk, ShaderLib, Texture, type WebGLProgramParametersWithUniforms } from 'three'
import { DEFAULT_PARAMETERS, type LampParameters } from './lamp'
import { applyPatternTransmission, applyShadeTransmission, applyTextTransmission, buildTextMaskAtlas } from './shade-material'
import { applySoftShadows } from './soft-shadows'

const glow = new Texture()
const lettered: LampParameters = { ...DEFAULT_PARAMETERS, textEnabled: true, text: 'O', cutoutPattern: 'triangles' }
const atlas = buildTextMaskAtlas(lettered)!
afterAll(() => {
  glow.dispose()
  atlas.texture.dispose()
})

function standardShader() {
  return {
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
    uniforms: {},
  } as WebGLProgramParametersWithUniforms
}

describe('thin TPU diffuse lighting', () => {
  it('adds back-face diffuse transmission without replacing native front-face or specular shading', () => {
    const shader = standardShader()
    applyShadeTransmission(shader)
    const source = shader.fragmentShader
    const wrapperStart = source.indexOf('void RE_Direct_Shade(')
    const wrapperEnd = source.indexOf('#undef RE_Direct', wrapperStart)
    expect(wrapperStart).toBeGreaterThan(source.indexOf('#include <lights_physical_pars_fragment>'))
    expect(wrapperEnd).toBeGreaterThan(wrapperStart)
    const wrapper = source.slice(wrapperStart, wrapperEnd)
    expect(wrapper).toContain('RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);')
    expect(wrapper).toContain('max(-dot(geometryNormal, directLight.direction), 0.0)')
    expect(wrapper).toContain('backLight * shadeDiffuseTransmission * directLight.color')
    expect(wrapper).toContain('BRDF_Lambert(material.diffuseContribution)')
    expect(wrapper.match(/reflectedLight\.(?:direct|indirect)(?:Diffuse|Specular)\s*\+=/g)).toEqual(['reflectedLight.directDiffuse +='])
    expect(source).toContain('#define RE_Direct RE_Direct_Shade')
    expect(source.indexOf('#define RE_Direct RE_Direct_Shade')).toBeLessThan(source.indexOf('void main()'))
    expect(source).toContain('#include <lights_fragment_maps>')
    expect(source).toContain('#include <lights_fragment_end>')
    expect(source).toContain('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;')
    expect(shader.vertexShader).toBe(ShaderLib.standard.vertexShader)
  })

  it('preserves external light shadows and falloff while keeping internal point-light shading disabled', () => {
    const shader = standardShader()
    applyPatternTransmission(shader, DEFAULT_PARAMETERS, glow)
    const source = shader.fragmentShader
    // Direct-light blocks remain the renderer's original code: spot/directional
    // shadows still attenuate the light before front reflection or back-face
    // transmission is accumulated.
    const externalStart = '#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )'
    const indirectStart = '#if defined( RE_IndirectDiffuse )'
    expect(source).toContain(ShaderChunk.lights_fragment_begin.slice(
      ShaderChunk.lights_fragment_begin.indexOf(externalStart),
      ShaderChunk.lights_fragment_begin.indexOf(indirectStart),
    ))
    expect(source).not.toContain('#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )')
    expect(source).toMatch(/#if 0[^\n]*\n\s*PointLight pointLight;/)
    expect(source).toContain('getPointLightInfo( pointLight, geometryPosition, directLight );')
  })

  it('transmits ambient and opposite-hemisphere light using membrane absorption while retaining the native front response', () => {
    const shader = standardShader()
    applyPatternTransmission(shader, DEFAULT_PARAMETERS, glow)
    const source = shader.fragmentShader
    const main = source.slice(source.indexOf('void main()'))
    const absorption = main.indexOf('shadeDiffuseTransmission = exp(-1.1 * shadeOpticalThickness);')
    const ambient = main.indexOf('vec3 irradiance = getAmbientLightIrradiance( ambientLightColor ) * (1.0 + shadeDiffuseTransmission);')
    expect(absorption).toBeGreaterThanOrEqual(0)
    expect(ambient).toBeGreaterThan(absorption)
    // A single hemisphere sample on the viewed face would leave downward
    // folds dark. Preserve it and transmit the scene's actual opposite side,
    // with the same thickness/crease attenuation as directional transmission.
    expect(main).toContain('irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );')
    expect(main).toMatch(/irradiance \+= shadeDiffuseTransmission \* getHemisphereLightIrradiance\( hemisphereLights\[ i \], -geometryNormal \);\s*}\s*#pragma unroll_loop_end/)
    expect(main.match(/getHemisphereLightIrradiance\( hemisphereLights\[ i \], -geometryNormal \)/g)).toHaveLength(1)
    expect(main).toContain('irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );')
    expect(main).toContain('irradiance += getLightProbeGridIrradiance( probeWorldPos, probeWorldNormal );')
    expect(main).toContain(ShaderChunk.lights_fragment_begin.slice(ShaderChunk.lights_fragment_begin.indexOf('#if defined( RE_IndirectSpecular )')))
    expect(main).toContain('#include <lights_fragment_end>')
  })

  it.each(['none', 'triangles', 'half-circles', 'rectangles'] as const)('uses physical membrane and crease thickness with %s patterns even when the lamp is off', cutoutPattern => {
    const shader = standardShader()
    applyPatternTransmission(shader, { ...DEFAULT_PARAMETERS, cutoutPattern, tpuLayers: 4, cutoutLayers: 1 }, glow)
    expect(shader.uniforms.cutoutProfile.value.slice(2)).toEqual([0.8, 0.2])
    expect(shader.uniforms.cutoutShape.value).toBe(cutoutPattern === 'none' ? -1 : cutoutPattern === 'triangles' ? 0 : cutoutPattern === 'half-circles' ? 1 : 2)
    const source = shader.fragmentShader
    const main = source.slice(source.indexOf('void main()'))
    const thickness = main.indexOf('float shadeOpticalThickness = mix(cutoutProfile.z, cutoutProfile.w, cutoutMask(vCutoutCoord.z));')
    const crease = main.indexOf('shadeOpticalThickness += joiningThickness;')
    const transmission = main.indexOf('shadeDiffuseTransmission = exp(-1.1 * shadeOpticalThickness);')
    const emissiveMap = main.indexOf('#ifdef USE_EMISSIVEMAP')
    const lights = main.indexOf('vec3 geometryPosition = - vViewPosition;')
    expect(thickness).toBeGreaterThanOrEqual(0)
    expect(crease).toBeGreaterThan(thickness)
    expect(transmission).toBeGreaterThan(crease)
    expect(emissiveMap).toBeGreaterThan(transmission)
    expect(lights).toBeGreaterThan(emissiveMap)
    expect(main).toContain('if (vCutoutJoin >= 0.0 && (!terminal || vCutoutCoord.y <= cutoutJoining.y))')
    expect(main).toContain('cutoutMask(vCutoutJoin)')
    expect(main).toContain('joiningThickness = neighbourThickness + cutoutJoining.x;')
    expect(main).toContain('membraneGlow *= exp(-1.1 * joiningThickness);')
    // Terminal sheets and unscheduled membranes retain the full TPU thickness.
    expect(source).toContain('sheet < 0.5 || sheet >= cutoutSettings.w - 0.5')
    expect(source).toContain('mod(floor(sheet + 0.5) - 1.0, cutoutProfile.y)')
  })

  it('attenuates external transmission through the same glyph coverage and pigment as the internal glow', () => {
    const shader = standardShader()
    applyPatternTransmission(shader, lettered, glow)
    applyTextTransmission(shader, lettered, atlas)
    const source = shader.fragmentShader
    const main = source.slice(source.indexOf('void main()'))
    const coverage = main.indexOf('float pigmentCoverage = textCoverage();')
    const attenuation = main.indexOf('shadeDiffuseTransmission *= mix(1.0, exp(-textPigmentAbsorption * shadeOpticalThickness), pigmentCoverage);')
    expect(coverage).toBeGreaterThanOrEqual(0)
    expect(attenuation).toBeGreaterThan(coverage)
    expect(attenuation).toBeLessThan(main.indexOf('#ifdef USE_EMISSIVEMAP'))
    expect(attenuation).toBeLessThan(main.indexOf('vec3 irradiance = getAmbientLightIrradiance( ambientLightColor ) * (1.0 + shadeDiffuseTransmission);'))
    expect(attenuation).toBeLessThan(main.indexOf('irradiance += shadeDiffuseTransmission * getHemisphereLightIrradiance( hemisphereLights[ i ], -geometryNormal );'))
    expect(main).toContain('membraneGlow *= mix(1.0, exp(-textPigmentAbsorption * pigmentThickness), pigmentCoverage);')
    expect(shader.uniforms.textPigmentAbsorption.value).toBeGreaterThan(0)
    expect(source.match(/float pigmentCoverage = textCoverage\(\);/g)).toHaveLength(1)
    expect(shader.vertexShader.match(/attribute vec3 cutoutCoord;/g)).toHaveLength(1)
    expect(source.match(/varying vec3 vCutoutCoord;/g)).toHaveLength(1)
    expect(source.indexOf('varying vec3 vCutoutCoord;')).toBeLessThan(source.indexOf('float textCoverage()'))
  })

  it('composes with soft shadows in either patch order and keeps refinement on its shared uniform', () => {
    const before = standardShader(), after = standardShader()
    const uniforms = { samples: { value: 24 } }
    applySoftShadows(before, uniforms)
    for (const shader of [before, after]) {
      applyPatternTransmission(shader, lettered, glow)
      applyTextTransmission(shader, lettered, atlas)
    }
    applySoftShadows(after, uniforms)
    expect(before.fragmentShader).toBe(after.fragmentShader)
    expect(before.vertexShader).toBe(after.vertexShader)
    expect(before.uniforms.softShadowSamples).toBe(uniforms.samples)
    expect(after.uniforms.softShadowSamples).toBe(uniforms.samples)
    expect(after.fragmentShader.match(/void RE_Direct_Shade\(/g)).toHaveLength(1)
    expect(after.fragmentShader).toContain('texture(shadowMap, vec3(shadowCoord.xy + offset, shadowCoord.z))')
    const source = after.fragmentShader
    uniforms.samples.value = 256
    expect(after.uniforms.softShadowSamples.value).toBe(256)
    expect(after.fragmentShader).toBe(source)
  })
})
