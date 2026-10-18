import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { LampParameters } from '@/lib/lamp'
import { buildPatternLightMaps, patternLightingKey } from '@/lib/pattern-lighting'

type MaterialPatch = {
  compile: THREE.MeshStandardMaterial['onBeforeCompile']
  cacheKey: THREE.MeshStandardMaterial['customProgramCacheKey']
}

/** Filter actual point-light radiance on every receiving material. Existing
 * geometry shadow maps continue to block that light at opaque objects. */
export function PatternLightProjection({ parameters, geometry }: { parameters: LampParameters; geometry: THREE.BufferGeometry }) {
  const { scene, invalidate } = useThree()
  const key = patternLightingKey(parameters)
  const maps = useMemo(() => buildPatternLightMaps(parameters, geometry), [key])
  const patched = useRef(new Map<THREE.MeshStandardMaterial, MaterialPatch>())
  const uniforms = useMemo(() => ({
    cutoutProjection0: { value: null as THREE.Texture | null },
    cutoutProjection1: { value: null as THREE.Texture | null },
    cutoutSourceY: { value: new THREE.Vector2(-1000, -1000) },
    cutoutRotation: { value: 0 },
  }), [])
  uniforms.cutoutProjection0.value = maps[0]?.texture ?? null
  uniforms.cutoutProjection1.value = maps[1]?.texture ?? maps[0]?.texture ?? null
  uniforms.cutoutSourceY.value.set(maps[0]?.sourceY ?? -1000, maps[1]?.sourceY ?? -1000)
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
        material.customProgramCacheKey = () => priorKey + '|cutout-optical-projection-v1'
        material.onBeforeCompile = (shader, renderer) => {
          compile.call(material, shader, renderer)
          Object.assign(shader.uniforms, uniforms)
          shader.fragmentShader = `
            uniform sampler2D cutoutProjection0;
            uniform sampler2D cutoutProjection1;
            uniform vec2 cutoutSourceY;
            uniform float cutoutRotation;
            float shadeRayTransmission(sampler2D opticalMap, vec3 direction, float distanceToLight) {
              float angle = atan(direction.z, direction.x) + cutoutRotation;
              vec2 uv = vec2(fract(angle / 6.28318530718 + 0.5), asin(clamp(direction.y, -1.0, 1.0)) / 3.14159265359 + 0.5);
              // Clamp latitude inside each packed strip to prevent cross-talk.
              uv.y = clamp(uv.y, 0.5 / 96.0, 1.0 - 0.5 / 96.0);
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
              vec3 opticalDirection = inverseTransformDirection(geometryPosition - pointLight.position, viewMatrix);
              float opticalDistance = length(geometryPosition - pointLight.position);
              vec3 opticalSource0 = (viewMatrix * vec4(0.0, cutoutSourceY.x, 0.0, 1.0)).xyz;
              vec3 opticalSource1 = (viewMatrix * vec4(0.0, cutoutSourceY.y, 0.0, 1.0)).xyz;
              if (distance(pointLight.position, opticalSource0) < 0.0001) {
                directLight.color *= shadeRayTransmission(cutoutProjection0, opticalDirection, opticalDistance);
              } else if (distance(pointLight.position, opticalSource1) < 0.0001) {
                directLight.color *= shadeRayTransmission(cutoutProjection1, opticalDirection, opticalDistance);
              }
              }
            `))
        }
        material.needsUpdate = true
      }
    })
  })
  return null
}
