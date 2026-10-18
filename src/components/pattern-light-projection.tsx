import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { LampParameters } from '@/lib/lamp'
import { buildPatternLightMaps, OPTICAL_MAP_HEIGHT, patternLightingKey } from '@/lib/pattern-lighting'
import { lampEmissionSamples, MAX_EMISSION_SAMPLES } from '@/lib/light-emission'
import { deriveLighting } from '@/lib/lighting'
import { luminousCenter } from '@/lib/shade-transmission'

type MaterialPatch = {
  compile: THREE.MeshStandardMaterial['onBeforeCompile']
  cacheKey: THREE.MeshStandardMaterial['customProgramCacheKey']
}

/** Filter actual point-light radiance on every receiving material. Existing
 * geometry shadow maps continue to block that light at opaque objects. */
export function PatternLightProjection({ parameters, geometry }: { parameters: LampParameters; geometry: THREE.BufferGeometry }) {
  const { scene, invalidate } = useThree()
  const key = patternLightingKey(parameters, false)
  const [settled, setSettled] = useState(() => ({ key, maps: buildPatternLightMaps(parameters, geometry) }))
  const maps = settled.maps
  useEffect(() => {
    if (settled.key === key) return
    // Let geometry edits finish before tracing the extended emitter. Letter
    // edits update native shadows immediately without rebuilding these maps;
    // each optical map stays paired with its source coordinates while dragging.
    const timer = window.setTimeout(() => {
      setSettled({ key, maps: buildPatternLightMaps(parameters, geometry) })
    }, 150)
    return () => window.clearTimeout(timer)
  }, [key, geometry])
  const patched = useRef(new Map<THREE.MeshStandardMaterial, MaterialPatch>())
  const uniforms = useMemo(() => ({
    ...Object.fromEntries(Array.from({ length: MAX_EMISSION_SAMPLES }, (_, index) => [`cutoutProjection${index}`, { value: null as THREE.Texture | null }])),
    cutoutSourceY: { value: new Float32Array(MAX_EMISSION_SAMPLES).fill(-1000) },
    cutoutCurrentSourceY: { value: new Float32Array(MAX_EMISSION_SAMPLES).fill(-1000) },
    cutoutRotation: { value: 0 },
  }), [])
  const currentSources = lampEmissionSamples(deriveLighting(parameters).sources)
  for (let index = 0; index < MAX_EMISSION_SAMPLES; index++) {
    (uniforms as Record<string, { value: unknown }>)[`cutoutProjection${index}`].value = maps[index]?.texture ?? maps[0]?.texture ?? null
    uniforms.cutoutSourceY.value[index] = (maps[index] ?? maps[0])?.sourceY ?? -1000
    const current = currentSources[index]
    uniforms.cutoutCurrentSourceY.value[index] = current ? luminousCenter(current, current.inverted) / 1000 : -1000
  }
  uniforms.cutoutRotation.value = parameters.rotation * Math.PI / 180

  useEffect(() => {
    invalidate()
    return () => { maps.forEach(map => map.texture.dispose()) }
  }, [maps, invalidate])
  useEffect(() => {
    const materials = patched.current
    return () => {
      materials.forEach((original, material) => {
        material.onBeforeCompile = original.compile
        material.customProgramCacheKey = original.cacheKey
        material.needsUpdate = true
      })
      materials.clear()
    }
  }, [])

  // Room switches and wood changes create new materials. Patch those before
  // their first render without rebuilding any ray maps or touching their maps.
  useFrame(() => {
    scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial) || material.userData.isTPUDiffuser || patched.current.has(material)) continue
        const compile = material.onBeforeCompile
        const cacheKey = material.customProgramCacheKey
        const priorKey = cacheKey.call(material)
        patched.current.set(material, { compile, cacheKey })
        material.customProgramCacheKey = () => priorKey + '|cutout-optical-projection-v3'
        material.onBeforeCompile = (shader, renderer) => {
          compile.call(material, shader, renderer)
          Object.assign(shader.uniforms, uniforms)
          shader.fragmentShader = `
            ${Array.from({ length: MAX_EMISSION_SAMPLES }, (_, index) => `uniform sampler2D cutoutProjection${index};`).join('\n')}
            uniform float cutoutSourceY[${MAX_EMISSION_SAMPLES}];
            uniform float cutoutCurrentSourceY[${MAX_EMISSION_SAMPLES}];
            uniform float cutoutRotation;
            float shadeRayTransmission(sampler2D opticalMap, vec3 direction, float distanceToLight) {
              float angle = atan(direction.z, direction.x) + cutoutRotation;
              vec2 uv = vec2(fract(angle / 6.28318530718 + 0.5), asin(clamp(direction.y, -1.0, 1.0)) / 3.14159265359 + 0.5);
              // Clamp latitude inside each packed strip to prevent cross-talk.
              uv.y = clamp(uv.y, 0.5 / ${OPTICAL_MAP_HEIGHT}.0, 1.0 - 0.5 / ${OPTICAL_MAP_HEIGHT}.0);
              float transmission = 1.0;
              for (int band = 0; band < 4; band++) {
                vec4 crossing = texture2D(opticalMap, vec2(uv.x, (uv.y + float(band)) / 4.0));
                transmission *= mix(1.0, crossing.y, smoothstep(crossing.x - 0.0005, crossing.x + 0.0005, distanceToLight));
                transmission *= mix(1.0, crossing.w, smoothstep(crossing.z - 0.0005, crossing.z + 0.0005, distanceToLight));
              }
              return transmission;
            }
          ` + shader.fragmentShader
          shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>',
            THREE.ShaderChunk.lights_fragment_begin.replace('getPointLightInfo( pointLight, geometryPosition, directLight );', `
              getPointLightInfo( pointLight, geometryPosition, directLight );
              {
              ${Array.from({ length: MAX_EMISSION_SAMPLES }, (_, index) => `
                ${index ? 'else ' : ''}if (distance(pointLight.position, (viewMatrix * vec4(0.0, cutoutCurrentSourceY[${index}], 0.0, 1.0)).xyz) < 0.0001) {
                  vec3 opticalSource = (viewMatrix * vec4(0.0, cutoutSourceY[${index}], 0.0, 1.0)).xyz;
                  vec3 opticalRay = geometryPosition - opticalSource;
                  vec3 opticalDirection = inverseTransformDirection(opticalRay, viewMatrix);
                  float opticalDistance = length(opticalRay);
                  directLight.color *= shadeRayTransmission(cutoutProjection${index}, opticalDirection, opticalDistance);
                }
              `).join('\n')}
              }
            `))
        }
        material.needsUpdate = true
      }
    })
  })
  return null
}
