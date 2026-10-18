import { Color, type Texture, type WebGLProgramParametersWithUniforms, ShaderChunk } from 'three'
import type { LampParameters } from './lamp'
import { cutoutProfile } from './cutout-patterns'
import { TEXT_COLORS, textGlyphGeometry, textProjectionConfig } from './text-projection'
import { buildGlyphDistanceField } from './text-distance-field'

/** Glyph outlines alone determine the distance field. Projection, material,
 * folds, light and camera settings reuse that same continuous text texture. */
export function textMaskKey(p: LampParameters) {
  return JSON.stringify([p.textEnabled, ...(p.textEnabled ? [p.text, p.textSize] : [])])
}

export function buildTextMaskAtlas(p: LampParameters) {
  if (!p.textEnabled || !p.text.trim()) return null
  return buildGlyphDistanceField(textGlyphGeometry(p))
}

export function textShaderKey(p: LampParameters) {
  return `text-vector-distance-v2-${textProjectionConfig(p).copies}`
}

/** Extra absorption relative to the unpigmented diffuser, in inverse mm.
 * Palette transmission is an appearance estimate for a 0.4 mm membrane. */
export function textPigmentAbsorption(p: LampParameters) {
  return Math.max(0, -Math.log(TEXT_COLORS[p.textColor].transmission) / 0.4 - 1.1)
}

/** The preview geometry carries its undeformed print coordinates. Both surface
 * color and native light shadow passes must interpolate exactly these values. */
function applyPrintCoordinates(shader: WebGLProgramParametersWithUniforms) {
  if (!shader.vertexShader.includes('varying vec3 vCutoutCoord;')) {
    shader.vertexShader = 'attribute vec3 cutoutCoord; varying vec3 vCutoutCoord;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCutoutCoord = cutoutCoord;')
  }
  // Keep this declaration ahead of every function that reads it, including
  // when a second material extension prepends its own helper functions.
  shader.fragmentShader = 'varying vec3 vCutoutCoord;\n' + shader.fragmentShader.replace('varying vec3 vCutoutCoord;\n', '')
}

/** One shared, continuous vector mask for the visible shade and every native
 * shadow pass. It deliberately has no dependencies on the surface lighting. */
function applyTextProjection(shader: WebGLProgramParametersWithUniforms, p: LampParameters, atlas: NonNullable<ReturnType<typeof buildTextMaskAtlas>>) {
  const projection = textProjectionConfig(p)
  // A reflected rounded rectangle starts at the other end of its right-hand
  // straight, so its print-coordinate seam differs from a reflected circle.
  const reflection = p.shape === 'rounded-rectangle' ? 1 - (p.depth - 2 * p.cornerRadius) / projection.perimeter : 0
  shader.uniforms.textPigmentMap = { value: atlas.texture }
  shader.uniforms.textPigmentBounds = { value: [p.outerConnector / p.bandWidth, 1 - p.innerConnector / p.bandWidth] }
  shader.uniforms.textGlyphTexture = { value: [atlas.scale, atlas.padding, atlas.width, atlas.height] }
  shader.uniforms.textProjection = { value: [projection.perimeter, projection.centerU, projection.horizontalOffset, projection.verticalCenter] }
  shader.uniforms.textGlyphRotation = { value: [projection.cos, projection.sin, projection.width / 2, projection.height / 2] }
  shader.uniforms.textSheetProjection = { value: [projection.rise, p.outerConnector, projection.span, reflection] }
  shader.uniforms.textSheetSettings = { value: [p.bandWidth, p.pleats * 2 - 1] }
  shader.fragmentShader = `
    uniform sampler2D textPigmentMap;
    uniform vec2 textPigmentBounds;
    uniform vec4 textGlyphTexture;
    uniform vec4 textProjection;
    uniform vec4 textGlyphRotation;
    uniform vec4 textSheetProjection;
    uniform vec2 textSheetSettings;
    float glyphCoverage(vec2 point) {
      vec2 uv = (point * textGlyphTexture.x + textGlyphTexture.y) / textGlyphTexture.zw;
      float distanceToEdge = (texture2D(textPigmentMap, uv).r - 0.5) * 16.0;
      float aa = max(fwidth(distanceToEdge), 0.6);
      return smoothstep(-aa, aa, distanceToEdge);
    }
    float textCoverage() {
      float pigmentCoverage = 0.0;
      float pigmentSheet = floor(vCutoutCoord.z + 0.5);
      if (pigmentSheet > 0.5 && pigmentSheet < textSheetSettings.y - 0.5) {
        float foldFraction = clamp((vCutoutCoord.y * textSheetSettings.x - textSheetProjection.y) / textSheetProjection.z, 0.0, 1.0);
        float pigmentHeight = (pigmentSheet - 1.0 + mix(1.0 - foldFraction, foldFraction, mod(pigmentSheet, 2.0))) * textSheetProjection.x;
        float printU = fract(textSheetProjection.w - vCutoutCoord.x);
        float horizontal = (printU - textProjection.y) * textProjection.x - textProjection.z;
        float vertical = pigmentHeight - textProjection.w;
        for (int copy = -${projection.copies}; copy <= ${projection.copies}; copy++) {
          float s = horizontal + float(copy) * textProjection.x;
          vec2 glyphPoint = vec2(s * textGlyphRotation.x + vertical * textGlyphRotation.y,
            -s * textGlyphRotation.y + vertical * textGlyphRotation.x) + textGlyphRotation.zw;
          pigmentCoverage = max(pigmentCoverage, glyphCoverage(glyphPoint));
        }
        pigmentCoverage *= step(textPigmentBounds.x, vCutoutCoord.y) * step(vCutoutCoord.y, textPigmentBounds.y);
      }
      return pigmentCoverage;
    }
  ` + shader.fragmentShader
  applyPrintCoordinates(shader)
}

export function applyTextTransmission(shader: WebGLProgramParametersWithUniforms, p: LampParameters, atlas: NonNullable<ReturnType<typeof buildTextMaskAtlas>>) {
  applyTextProjection(shader, p, atlas)
  shader.uniforms.textPigmentColor = { value: new Color(TEXT_COLORS[p.textColor].hex) }
  shader.uniforms.textPigmentAbsorption = { value: textPigmentAbsorption(p) }
  shader.fragmentShader = 'uniform vec3 textPigmentColor; uniform float textPigmentAbsorption;\n' + shader.fragmentShader
  shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
    #include <map_fragment>
    float pigmentCoverage = textCoverage();
    diffuseColor.rgb = mix(diffuseColor.rgb, textPigmentColor, pigmentCoverage);
  `)
  shader.fragmentShader = shader.fragmentShader.replace('totalEmissiveRadiance *= membraneGlow;', `
    float pigmentThickness = mix(cutoutProfile.z, cutoutProfile.w, cutoutMask(vCutoutCoord.z));
    membraneGlow *= mix(1.0, exp(-textPigmentAbsorption * pigmentThickness), pigmentCoverage);
    totalEmissiveRadiance *= membraneGlow;
  `)
}

/** Native depth/distance shadows preserve the projected glyph silhouette.
 * Object-space alpha hashing provides partial material transmission without
 * camera-dependent noise. Internal lamps already account for unpigmented TPU
 * in their optical maps; external lighting needs the base absorption here. */
export function applyTextShadow(shader: WebGLProgramParametersWithUniforms, p: LampParameters, atlas: ReturnType<typeof buildTextMaskAtlas>, external = false) {
  const thickness = p.tpuLayers * p.layerHeight
  const baseOpacity = external ? 1 - Math.exp(-1.1 * thickness) : 0
  const glyphOpacity = external
    ? 1 - Math.pow(TEXT_COLORS[p.textColor].transmission, thickness / 0.4)
    : 1 - Math.exp(-textPigmentAbsorption(p) * thickness)
  shader.uniforms.textShadowOpacities = { value: [baseOpacity, glyphOpacity] }
  const hasText = p.textEnabled && atlas !== null
  if (hasText) applyTextProjection(shader, p, atlas)
  // Keep Three's native depth encoding and alpha-hash implementation. Defining
  // this here also makes the helper safe when the caller omits alphaHash=true.
  const enableHash = '#ifndef USE_ALPHAHASH\n#define USE_ALPHAHASH\n#endif\n'
  shader.vertexShader = enableHash + shader.vertexShader
  shader.fragmentShader = enableHash + 'uniform vec2 textShadowOpacities;\n' + shader.fragmentShader
  shader.fragmentShader = shader.fragmentShader.replace('#include <alphahash_fragment>', `
    diffuseColor.a = mix(textShadowOpacities.x, textShadowOpacities.y, ${hasText ? 'textCoverage()' : '0.0'});
    #include <alphahash_fragment>
  `)
}

/** Internal light is scattered through the diffuser by its smooth glow map.
 * Also applying opaque point-light shading makes nearly horizontal folds flip
 * from lit to unlit at bulb height, creating a false dark band. Exclude that
 * direct contribution on the shade only; the room still uses the point lights
 * and their shadows. Ceiling, daylight and studio directional lighting retain
 * their ordinary crease shading and shadows on the diffuser. */
export function applyShadeTransmission(shader: WebGLProgramParametersWithUniforms) {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <lights_fragment_begin>',
    ShaderChunk.lights_fragment_begin.replace(
      '#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )',
      '#if 0 // Point-source transmission is supplied by the shade glow map.',
    ),
  )
}

/** The mask is evaluated in the sheet's original print coordinates, so twisting
 * or opening the shade cannot slide the light pattern across the membrane. */
export function applyPatternTransmission(shader: WebGLProgramParametersWithUniforms, parameters: LampParameters, thinGlow: Texture) {
  applyShadeTransmission(shader)
  const profile = cutoutProfile(parameters)
  shader.uniforms.cutoutThinGlow = { value: thinGlow }
  shader.uniforms.cutoutSettings = { value: [profile.count, profile.depthMm, parameters.bandWidth, parameters.pleats * 2 - 1] }
  shader.uniforms.cutoutProfile = { value: [profile.mouthFraction / 2, profile.every, profile.normalThickness, profile.remainingThickness] }
  shader.uniforms.cutoutJoining = { value: [parameters.separatorLayers * parameters.layerHeight, parameters.outerConnector / parameters.bandWidth] }
  shader.uniforms.cutoutPlacement = { value: [profile.phaseStep, profile.mouthMm / 2, profile.rectangleSideHalfWidthMm, profile.rectangleCornerMm] }
  shader.uniforms.cutoutShape = { value: !profile.enabled ? -1 : parameters.cutoutPattern === 'triangles' ? 0 : parameters.cutoutPattern === 'half-circles' ? 1 : 2 }
  shader.vertexShader = 'attribute float cutoutJoin; varying float vCutoutJoin;\n' + shader.vertexShader
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCutoutJoin = cutoutJoin;')
  shader.fragmentShader = `
    uniform sampler2D cutoutThinGlow;
    uniform vec4 cutoutSettings;
    uniform vec4 cutoutProfile;
    uniform vec2 cutoutJoining;
    uniform vec4 cutoutPlacement;
    uniform float cutoutShape;
    varying float vCutoutJoin;
    float cutoutMask(float sheet) {
      if (cutoutShape < -0.5 || sheet < 0.5 || sheet >= cutoutSettings.w - 0.5) return 0.0;
      if (mod(floor(sheet + 0.5) - 1.0, cutoutProfile.y) > 0.5) return 0.0;
      // Physical membrane indices preserve the phase increment across skipped
      // sheets. A shared crease calls this again with its neighbour's index.
      float phase = (floor(sheet + 0.5) - 1.0) * cutoutPlacement.x;
      float across = abs(fract(vCutoutCoord.x * cutoutSettings.x - phase) - 0.5) / cutoutProfile.x;
      float depth = cutoutSettings.y;
      if (cutoutShape < 0.5) depth *= max(0.0, 1.0 - across);
      else if (cutoutShape < 1.5) depth *= sqrt(max(0.0, 1.0 - across * across));
      else {
        float x = across * cutoutPlacement.y;
        float cornerStart = cutoutPlacement.z - cutoutPlacement.w;
        if (x > cutoutPlacement.z) {
          depth = max(0.0, (cutoutPlacement.y - x) * (depth - cutoutPlacement.w)
            / (cutoutPlacement.y - cutoutPlacement.z));
        } else if (x > cornerStart) {
          float offset = x - cornerStart;
          depth = depth - cutoutPlacement.w + sqrt(max(0.0, cutoutPlacement.w * cutoutPlacement.w - offset * offset));
        }
      }
      // Both sheet faces release into an outside-open PLA separator. Sheet
      // parity changes the print face, never the radial opening of the recess.
      float distanceToEdge = depth - cutoutSettings.z * vCutoutCoord.y;
      float aa = max(fwidth(distanceToEdge), 0.025);
      return (1.0 - step(1.0, across)) * smoothstep(-aa, aa, distanceToEdge);
    }
  ` + shader.fragmentShader
  shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
    #ifdef USE_EMISSIVEMAP
      vec4 normalGlow = texture2D(emissiveMap, vEmissiveMapUv);
      vec4 thinGlow = texture2D(cutoutThinGlow, vEmissiveMapUv);
      vec3 membraneGlow = mix(normalGlow.rgb, thinGlow.rgb, cutoutMask(vCutoutCoord.z));
      bool terminal = vCutoutCoord.z < 0.5 || vCutoutCoord.z >= cutoutSettings.w - 0.5;
      if (vCutoutJoin >= 0.0 && (!terminal || vCutoutCoord.y <= cutoutJoining.y)) {
        // The flat crease stands for two joined membranes plus the TPU left
        // between them. Each membrane keeps its own pattern selection.
        float neighbourThickness = mix(cutoutProfile.z, cutoutProfile.w, cutoutMask(vCutoutJoin));
        membraneGlow *= exp(-1.1 * (neighbourThickness + cutoutJoining.x));
      }
      totalEmissiveRadiance *= membraneGlow;
    #endif
  `)
  applyPrintCoordinates(shader)
}
