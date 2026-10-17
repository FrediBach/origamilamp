import { ShaderChunk, type WebGLProgramParametersWithUniforms } from 'three'

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
