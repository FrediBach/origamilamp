import { ShaderChunk, type Texture, type WebGLProgramParametersWithUniforms } from 'three'
import type { LampParameters } from './lamp'
import { cutoutProfile } from './cutout-patterns'

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
  shader.vertexShader = 'attribute vec3 cutoutCoord; attribute float cutoutJoin; varying vec3 vCutoutCoord; varying float vCutoutJoin;\n' + shader.vertexShader
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCutoutCoord = cutoutCoord;\nvCutoutJoin = cutoutJoin;')
  shader.fragmentShader = `
    uniform sampler2D cutoutThinGlow;
    uniform vec4 cutoutSettings;
    uniform vec4 cutoutProfile;
    uniform vec2 cutoutJoining;
    uniform vec4 cutoutPlacement;
    uniform float cutoutShape;
    varying vec3 vCutoutCoord;
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
}
