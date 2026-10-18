import { ShaderChunk, type WebGLProgramParametersWithUniforms } from 'three'

export const SOFT_SHADOW_MAX_SAMPLES = 256
const VOGEL_SAMPLES = 64

/** Prefixes cover the same disk after scaling by sqrt(64 / sampleCount).
 * Precomputing the angles avoids per-fragment trigonometry at settled quality. */
export const SOFT_SHADOW_DISK: ReadonlyArray<readonly [number, number]> = Array.from({ length: VOGEL_SAMPLES }, (_, index) => {
  const radius = Math.sqrt((index + 0.5) / VOGEL_SAMPLES)
  const angle = index * 2.399963229728653
  return [Math.cos(angle) * radius, Math.sin(angle) * radius] as const
})

/** A dense bilinear grid integrates ordered coverage more evenly than widely
 * separated disk taps. It is used only for the final, stationary image. */
export const SOFT_SHADOW_GRID: ReadonlyArray<readonly [number, number]> = Array.from({ length: SOFT_SHADOW_MAX_SAMPLES }, (_, index) => [
  (index % 16 + 0.5) / 8 - 1,
  (Math.floor(index / 16) + 0.5) / 8 - 1,
] as const)

function filterBlock(source: string, start: string, replacement: (original: string) => string) {
  const from = source.indexOf(start)
  if (from < 0) throw new Error('Native shadow filter no longer matches the supported Three shader.')
  const marker = ') * 0.2;'
  const to = source.indexOf(marker, from)
  if (to < 0) throw new Error('Native shadow filter accumulation was not found.')
  return source.slice(0, from) + replacement(source.slice(from, to + marker.length)) + source.slice(to + marker.length)
}

function buildSoftShadowChunk() {
  let source = ShaderChunk.shadowmap_pars_fragment
  source = filterBlock(source, 'float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;', original => `
    if (softShadowSamples <= 5.0) {
      ${original}
    } else {
      bool dense = softShadowSamples > 64.0;
      int tapCount = dense ? 256 : int(clamp(floor(softShadowSamples + 0.5), 1.0, 64.0));
      float diskScale = dense ? 1.0 : sqrt(64.0 / float(tapCount));
      vec2 filterRadius = max(shadowRadius, 10.0) / shadowMapSize;
      shadow = 0.0;
      for (int tap = 0; tap < 256; tap++) {
        if (tap >= tapCount) break;
        int offsetIndex = dense ? tap + 64 : tap;
        vec2 offset = softShadowOffsets[offsetIndex] * diskScale * filterRadius;
        shadow += texture(shadowMap, vec3(shadowCoord.xy + offset, shadowCoord.z));
      }
      shadow /= float(tapCount);
    }
  `)
  // Skip the planar branch retained above and replace only the cube filter.
  const pointStart = source.indexOf('float getPointShadow( samplerCubeShadow')
  source = source.slice(0, pointStart) + filterBlock(source.slice(pointStart), 'float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;', original => `
    if (softShadowSamples <= 5.0) {
      ${original}
    } else {
      bool dense = softShadowSamples > 64.0;
      int tapCount = dense ? 256 : int(clamp(floor(softShadowSamples + 0.5), 1.0, 64.0));
      float diskScale = dense ? 1.0 : sqrt(64.0 / float(tapCount));
      float filterRadius = max(shadowRadius, 24.0) / shadowMapSize.x;
      shadow = 0.0;
      for (int tap = 0; tap < 256; tap++) {
        if (tap >= tapCount) break;
        int offsetIndex = dense ? tap + 64 : tap;
        vec2 offset = softShadowOffsets[offsetIndex] * diskScale;
        vec3 direction = bd3D + (tangent * offset.x + bitangent * offset.y) * filterRadius;
        shadow += texture(shadowMap, vec4(direction, dp));
      }
      shadow /= float(tapCount);
    }
  `)
  return `
    uniform float softShadowSamples;
    const vec2 softShadowOffsets[320] = vec2[320](
      ${[...SOFT_SHADOW_DISK, ...SOFT_SHADOW_GRID].map(([x, y]) => `vec2(${x.toFixed(10)}, ${y.toFixed(10)})`).join(',\n      ')}
    );
  ` + source
}

const softShadowChunk = buildSoftShadowChunk()

/** Average stochastic material coverage spatially, preserving the renderer's
 * actual depth tests and shadows on every receiving surface. Five samples is
 * the unchanged native filter; 8–64 use a disk, and settled quality above 64
 * selects the bounded 256-tap grid without recompiling. */
export function applySoftShadows(shader: WebGLProgramParametersWithUniforms, uniforms: { samples: { value: number } }) {
  if (!shader.fragmentShader.includes('#include <shadowmap_pars_fragment>')) return
  shader.uniforms.softShadowSamples = uniforms.samples
  shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', softShadowChunk)
}
