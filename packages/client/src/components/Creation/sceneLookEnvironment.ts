import * as THREE from 'three';
// Sky is the maintained MIT-licensed three example; no downloaded sky or HDRI assets.
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { ResolvedVibi3DLook } from '@vibisual/shared';
import { preserveEnvironmentRenderer } from './sceneEnvironmentState.js';

interface SkyEntry { sky: Sky; target: THREE.WebGLRenderTarget | null }
const environments = new WeakMap<THREE.WebGLRenderer, Map<string, SkyEntry>>();
const MAX_SKIES = 4;

export function sceneSunDirection(azimuth: number, elevation: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuth), el = THREE.MathUtils.degToRad(elevation);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

function makeSky(look: ResolvedVibi3DLook): Sky {
  const sky = new Sky();
  sky.name = 'Vibi3D sky'; sky.userData['vibi3dLookHelper'] = true;
  sky.scale.setScalar(10000); sky.frustumCulled = false;
  const uniforms = sky.material.uniforms;
  uniforms['turbidity']!.value = look.preset === 'overcast' ? 12 : 2;
  uniforms['rayleigh']!.value = look.preset === 'overcast' ? 0.6 : 2;
  uniforms['mieCoefficient']!.value = look.preset === 'overcast' ? 0.05 : 0.005;
  uniforms['mieDirectionalG']!.value = 0.8;
  // The analytic Sky's horizon extends below the earth. Keep that bright hemisphere out of ground-facing IBL.
  // Calibrate the example's radiance to our directional-light units once, identically for background and PMREM.
  uniforms['vibi3dSkyRadiance'] = { value: look.preset === 'night-street' ? 0.015 : 0.2 };
  uniforms['vibi3dGroundRadiance'] = { value: look.preset === 'night-street' ? 0.002 : 0.035 };
  uniforms['cloudCoverage']!.value = look.preset === 'overcast' ? 0.7 : 0;
  sky.material.fragmentShader = sky.material.fragmentShader.replace('uniform float time;',
    'uniform float time;\nuniform float vibi3dSkyRadiance;\nuniform float vibi3dGroundRadiance;')
    .replace('#include <tonemapping_fragment>', `
      gl_FragColor.rgb *= vibi3dSkyRadiance;
      gl_FragColor.rgb = mix(vec3(vibi3dGroundRadiance), gl_FragColor.rgb, smoothstep(-0.08, 0.02, direction.y));
      #include <tonemapping_fragment>`);
  (uniforms['sunPosition']!.value as THREE.Vector3).copy(sceneSunDirection(look.sun.azimuth, look.sun.elevation));
  return sky;
}

/** Environment maps are GL-context resources, bounded and cached by physical sky parameters. */
export function applySceneSky(scene: THREE.Scene, renderer: THREE.WebGLRenderer, look: ResolvedVibi3DLook, visible: boolean): void {
  let cache = environments.get(renderer);
  if (!cache) { cache = new Map(); environments.set(renderer, cache); }
  const key = JSON.stringify([look.preset, look.sun.azimuth, look.sun.elevation]);
  let entry = cache.get(key);
  if (!entry) {
    const sky = makeSky(look);
    const environment = new THREE.Scene(); environment.add(sky);
    const generator = new THREE.PMREMGenerator(renderer);
    const restore = preserveEnvironmentRenderer(renderer), disc = sky.material.uniforms['showSunDisc'], previousDisc = disc?.value;
    let target: THREE.WebGLRenderTarget | null = null;
    try {
      // The directional light supplies the sun disc, avoiding a second sharp sun in PMREM reflections.
      if (disc) disc.value = false;
      target = generator.fromScene(environment, 0.04, 0.1, 20000);
    } catch { target = null; } finally {
      restore(); if (disc) disc.value = previousDisc;
      generator.dispose(); environment.remove(sky);
    }
    entry = { sky, target }; cache.set(key, entry);
    while (cache.size > MAX_SKIES) {
      const oldest = cache.keys().next().value!;
      disposeSky(cache.get(oldest)!); cache.delete(oldest);
    }
  } else { cache.delete(key); cache.set(key, entry); }
  for (const child of [...scene.children]) if (child.userData['vibi3dLookHelper'] === true && child instanceof Sky && child !== entry.sky) scene.remove(child);
  if (entry.sky.parent !== scene) scene.add(entry.sky);
  entry.sky.visible = visible;
  scene.environment = entry.target?.texture ?? null;
  scene.environmentIntensity = look.intensity * (look.preset === 'night-street' ? 0.25 : 1);
}

export function hideSceneSky(scene: THREE.Scene): void {
  for (const child of scene.children) if (child instanceof Sky && child.userData['vibi3dLookHelper'] === true) child.visible = false;
}
function disposeSky(entry: SkyEntry): void {
  entry.sky.removeFromParent(); entry.sky.geometry.dispose(); entry.sky.material.dispose(); entry.target?.dispose();
}
export function releaseSceneSky(renderer: THREE.WebGLRenderer): void {
  environments.get(renderer)?.forEach(disposeSky); environments.delete(renderer);
}
