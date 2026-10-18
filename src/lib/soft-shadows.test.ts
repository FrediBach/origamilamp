import { describe, expect, it } from 'vitest'
import { ShaderChunk, type WebGLProgramParametersWithUniforms } from 'three'
import { applySoftShadows, SOFT_SHADOW_DISK, SOFT_SHADOW_GRID, SOFT_SHADOW_MAX_SAMPLES } from './soft-shadows'

function patchedShader(samples = 64) {
  const shader = { uniforms: {}, vertexShader: 'unchanged vertex', fragmentShader: '#include <shadowmap_pars_fragment>' } as WebGLProgramParametersWithUniforms
  const uniforms = { samples: { value: samples } }
  applySoftShadows(shader, uniforms)
  return { shader, uniforms }
}

describe('smooth partial-transmission shadows', () => {
  it('retains native depth comparisons, frustum checks, reverse-depth handling and intensity', () => {
    const { shader } = patchedShader()
    for (const line of ShaderChunk.shadowmap_pars_fragment.split('\n')) {
      if (/shadowCoord\.xyz \/=|shadowCoord\.z \+=|viewSpaceZ|inFrustum|frustumTest|#ifdef USE_REVERSED_DEPTH_BUFFER|dp [+-]= shadowBias|return mix\( 1\.0, shadow, shadowIntensity \)/.test(line)) {
        expect(shader.fragmentShader).toContain(line)
      }
    }
    expect(shader.vertexShader).toBe('unchanged vertex')
    expect(shader.fragmentShader.match(/for \(int tap = 0; tap < 256; tap\+\+\)/g)).toHaveLength(2)
    expect(shader.fragmentShader.match(/if \(tap >= tapCount\) break;/g)).toHaveLength(2)
    expect(shader.fragmentShader).toContain('texture(shadowMap, vec3(shadowCoord.xy + offset, shadowCoord.z))')
    expect(shader.fragmentShader).toContain('texture(shadowMap, vec4(direction, dp))')
  })

  it('preserves the original five-tap filters when refinement is disabled', () => {
    const { shader } = patchedShader(5)
    const originalFilters = Array.from(ShaderChunk.shadowmap_pars_fragment.matchAll(/float phi = interleavedGradientNoise[\s\S]*?\) \* 0\.2;/g), match => match[0])
    expect(originalFilters).toHaveLength(2)
    for (const original of originalFilters) expect(shader.fragmentShader).toContain(original)
    expect(shader.fragmentShader.match(/if \(softShadowSamples <= 5\.0\)/g)).toHaveLength(2)
  })

  it('updates progressive quality through one shared uniform without changing shader source', () => {
    const { shader, uniforms } = patchedShader(8)
    const source = shader.fragmentShader
    uniforms.samples.value = 24
    expect(shader.uniforms.softShadowSamples.value).toBe(24)
    uniforms.samples.value = 256
    expect(shader.uniforms.softShadowSamples.value).toBe(256)
    expect(shader.fragmentShader).toBe(source)
    applySoftShadows(shader, uniforms)
    expect(shader.fragmentShader).toBe(source)
  })

  it.each([8, 24, 64])('keeps the %i-tap prefix distributed across the same circular footprint', count => {
    const scale = Math.sqrt(SOFT_SHADOW_DISK.length / count)
    const disk = SOFT_SHADOW_DISK.slice(0, count).map(([x, y]) => [x * scale, y * scale])
    expect(Math.max(...disk.map(([x, y]) => Math.hypot(x, y)))).toBeLessThan(1)
    expect(Math.max(...disk.map(([x, y]) => Math.hypot(x, y)))).toBeGreaterThan(0.96)
    expect(Math.hypot(...[0, 1].map(axis => disk.reduce((sum, point) => sum + point[axis], 0) / count))).toBeLessThan(0.1)
  })

  it('covers the final footprint evenly with a bounded 16 by 16 grid', () => {
    expect(SOFT_SHADOW_GRID).toHaveLength(SOFT_SHADOW_MAX_SAMPLES)
    expect(SOFT_SHADOW_MAX_SAMPLES).toBe(256)
    for (const axis of [0, 1]) {
      expect(new Set(SOFT_SHADOW_GRID.map(point => point[axis])).size).toBe(16)
      expect(SOFT_SHADOW_GRID.reduce((sum, point) => sum + point[axis], 0)).toBe(0)
      expect(Math.max(...SOFT_SHADOW_GRID.map(point => Math.abs(point[axis])))).toBeLessThan(1)
    }
  })

  it.each([0.15, 0.45, 0.65])('reduces partial-transmission noise while conserving mean light at transmission %f', transmission => {
    // A repeatable binary coverage map stands for alpha-hashed material. Each
    // hardware PCF lookup bilinearly averages four depth comparisons.
    const bit = (x: number, y: number) => {
      let value = Math.imul(x, 374761393) + Math.imul(y, 668265263)
      value = Math.imul(value ^ (value >>> 13), 1274126177)
      return ((value ^ (value >>> 16)) >>> 0) / 4294967296 < transmission ? 1 : 0
    }
    const bilinear = (x: number, y: number) => {
      const ix = Math.floor(x), iy = Math.floor(y), dx = x - ix, dy = y - iy
      return bit(ix, iy) * (1 - dx) * (1 - dy) + bit(ix + 1, iy) * dx * (1 - dy)
        + bit(ix, iy + 1) * (1 - dx) * dy + bit(ix + 1, iy + 1) * dx * dy
    }
    const errors = (disk: ReadonlyArray<readonly [number, number]>, scale: number) => {
      let sum = 0, square = 0, samples = 0
      for (let y = 16; y < 480; y += 17) for (let x = 16; x < 480; x += 19) {
        const value = disk.reduce((total, [dx, dy]) => total + bilinear(x + dx * scale, y + dy * scale), 0) / disk.length
        sum += value
        square += (value - transmission) ** 2
        samples++
      }
      return { mean: sum / samples, rms: Math.sqrt(square / samples) }
    }
    const original = errors(SOFT_SHADOW_DISK.slice(0, 5), Math.sqrt(64 / 5) * 1.5)
    const settled = errors(SOFT_SHADOW_GRID, 12)
    expect(settled.rms).toBeLessThan(original.rms * 0.4)
    expect(settled.mean).toBeCloseTo(transmission, 2)
  })
})
