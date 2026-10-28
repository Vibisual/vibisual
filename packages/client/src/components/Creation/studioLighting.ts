import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { STUDIO_LIGHT } from './studioLightLevels.js';
import { releaseSceneLook } from './sceneLook.js';
import { preserveEnvironmentRenderer } from './sceneEnvironmentState.js';

/**
 * §5.13 (R-10) — one studio light for every 3D picture (view, candidate preview, video scenes, product stills) so preview and output match.
 * Metals need an environment — without it 0.8-metalness gold renders dark brown — so all use three's RoomEnvironment via PMREM.
 */
export { STUDIO_LIGHT };
export { renderStudioView, type StudioViewOptions } from './sceneLook.js';
export { readStudioViewRaster } from './sceneLookRaster.js';

const environments = new WeakMap<THREE.WebGLRenderer, THREE.WebGLRenderTarget | null>();
/** Per renderer (PMREM textures belong to the GL context that made them). Null when it cannot prefilter (lost or limited context) — the view then uses only the direct studio lights, never fails. */
export function studioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture | null {
  if (environments.has(renderer)) return environments.get(renderer)?.texture ?? null;
  let target: THREE.WebGLRenderTarget | null = null;
  const room = new RoomEnvironment();
  const restore = preserveEnvironmentRenderer(renderer);
  let pmrem: THREE.PMREMGenerator | null = null;
  try {
    pmrem = new THREE.PMREMGenerator(renderer);
    target = pmrem.fromScene(room, 0.04);
  } catch { target = null; } finally { restore(); room.dispose(); pmrem?.dispose(); }
  // The target owns the framebuffer too: disposing only its texture leaked that resource after closing previews.
  environments.set(renderer, target);
  return target?.texture ?? null;
}
/** Call before disposing a renderer (or after its context was lost). */
export function releaseStudioEnvironment(renderer: THREE.WebGLRenderer): void {
  releaseSceneLook(renderer);
  environments.get(renderer)?.dispose();
  environments.delete(renderer);
}

export interface StudioLights { ambient: THREE.HemisphereLight; key: THREE.DirectionalLight }
/** The two direct lights, at the studio defaults (callers scale their intensity with the source's lighting value). */
export function createStudioLights(): StudioLights {
  const ambient = new THREE.HemisphereLight(0xffffff, 0x334155, STUDIO_LIGHT.ambient);
  const key = new THREE.DirectionalLight(0xffffff, STUDIO_LIGHT.key);
  ambient.userData['vibi3dStudioLight'] = 'ambient'; key.userData['vibi3dStudioLight'] = 'key';
  key.position.set(...STUDIO_LIGHT.keyPosition);
  return { ambient, key };
}
export function setStudioLightLevel(lights: StudioLights, level: number): void {
  lights.ambient.intensity = STUDIO_LIGHT.ambient * level;
  lights.key.intensity = STUDIO_LIGHT.key * level;
}
/**
 * A model that brings its own lights is lit by them: the studio fill hides when it has a hemisphere/ambient light,
 * the studio key hides when it has any other light. Every view uses this rule, so preview and output match.
 */
export function studioLightPlan(object: THREE.Object3D): { ambient: boolean; key: boolean } {
  let fill = false; let direct = false;
  object.traverse((child) => {
    if (!(child instanceof THREE.Light)) return;
    if (child instanceof THREE.HemisphereLight || child instanceof THREE.AmbientLight) fill = true; else direct = true;
  });
  return { ambient: !fill, key: !direct };
}
export function planStudioLights(lights: StudioLights, object: THREE.Object3D | null, level: number): void {
  const plan = object ? studioLightPlan(object) : { ambient: true, key: true };
  lights.ambient.visible = plan.ambient;
  lights.key.visible = plan.key;
  setStudioLightLevel(lights, level);
}
/** Reflections for metals/glass, identical in every view. */
export function applyStudioEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer, level = 1): void {
  scene.environment = studioEnvironment(renderer);
  scene.environmentIntensity = STUDIO_LIGHT.environment * level;
}
