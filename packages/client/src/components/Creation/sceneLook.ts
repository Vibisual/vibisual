import * as THREE from 'three';
import { resolveVibi3DLook, validateVibi3DLook, type ResolvedVibi3DLook } from '@vibisual/shared';
import { STUDIO_LIGHT, studioEnvironment } from './studioLighting.js';
import { modelShadowSettings } from './modelShadows.js';
import { applySceneSky, hideSceneSky, releaseSceneSky, sceneSunDirection } from './sceneLookEnvironment.js';
import { releaseSceneEffects, renderSceneEffects } from './sceneLookEffects.js';
import type { SceneLookQuality } from './sceneLookQuality.js';
import { visibleModelBounds } from './modelBounds.js';
import { updateModelKitMatrices } from './modelInstanceMatrices.js';
import { clearSceneRaster, recordDirectSceneRaster } from './sceneLookRaster.js';

export interface StudioViewOptions {
  object: THREE.Object3D | null;
  quality?: SceneLookQuality;
  mode?: 'lit' | 'clay' | 'wire' | 'ao';
  background?: 'preserve' | 'sky';
}
interface RendererState { tone: THREE.ToneMapping; exposure: number; shadows: boolean; shadowType: THREE.ShadowMapType; lights: Set<THREE.DirectionalLight> }
interface SceneState { fog: THREE.Scene['fog'] }
const rendererStates = new WeakMap<THREE.WebGLRenderer, RendererState>();
const sceneStates = new WeakMap<THREE.Scene, SceneState>();
const TONES = { none: THREE.NoToneMapping, aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping } as const;

function remember(scene: THREE.Scene, renderer: THREE.WebGLRenderer): RendererState {
  let state = rendererStates.get(renderer);
  if (!state) {
    state = { tone: renderer.toneMapping, exposure: renderer.toneMappingExposure, shadows: renderer.shadowMap.enabled,
      shadowType: renderer.shadowMap.type, lights: new Set() };
    rendererStates.set(renderer, state);
  }
  if (!sceneStates.has(scene)) sceneStates.set(scene, { fog: scene.fog });
  return state;
}

function lights(scene: THREE.Scene): { ambient?: THREE.HemisphereLight; key?: THREE.DirectionalLight } {
  const ambient = scene.children.find(child => child.userData['vibi3dStudioLight'] === 'ambient');
  const key = scene.children.find(child => child.userData['vibi3dStudioLight'] === 'key');
  return { ...(ambient instanceof THREE.HemisphereLight ? { ambient } : {}), ...(key instanceof THREE.DirectionalLight ? { key } : {}) };
}

function legacy(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
  const state = rendererStates.get(renderer), sceneState = sceneStates.get(scene);
  hideSceneSky(scene);
  if (state) {
    renderer.toneMapping = state.tone; renderer.toneMappingExposure = state.exposure;
    renderer.shadowMap.enabled = state.shadows; renderer.shadowMap.type = state.shadowType;
  }
  if (sceneState) scene.fog = sceneState.fog;
  const rig = lights(scene);
  if (rig.key) {
    rig.key.color.set(0xffffff); rig.key.position.set(...STUDIO_LIGHT.keyPosition); rig.key.target.position.set(0, 0, 0);
    rig.key.target.updateMatrixWorld(); rig.key.castShadow = false;
  }
  if (rig.ambient) { rig.ambient.color.set(0xffffff); rig.ambient.groundColor.set(0x334155); }
  // Callers already apply their legacy level, authored-light visibility and video overrides. Keep those values.
}

function applyLights(scene: THREE.Scene, object: THREE.Object3D, look: ResolvedVibi3DLook, state: RendererState, maxTextureSize: number): void {
  const rig = lights(scene), studio = look.preset === 'studio';
  if (rig.ambient) {
    if (!studio) rig.ambient.visible = true;
    rig.ambient.color.set(studio ? 0xffffff : 0xb6d5ff);
    rig.ambient.groundColor.set(studio ? 0x334155 : 0x536057);
    // PMREM already supplies sky diffuse irradiance. Adding a hemisphere again erased sun/shade contrast.
    rig.ambient.intensity = look.intensity * (studio ? STUDIO_LIGHT.ambient : scene.environment ? 0
      : look.preset === 'overcast' ? 0.45 : look.preset === 'night-street' ? 0.04 : 0.18);
  }
  if (!rig.key) return;
  const key = rig.key; state.lights.add(key);
  if (!studio) key.visible = true;
  key.color.set(look.sun.color); key.intensity = look.sun.intensity * look.intensity;
  const box = visibleModelBounds(object), sphere = box.getBoundingSphere(new THREE.Sphere());
  const center = box.isEmpty() ? new THREE.Vector3() : sphere.center;
  const radius = box.isEmpty() ? 2 : Math.max(2, sphere.radius * 1.1);
  key.target.position.copy(center); key.target.userData['vibi3dLookHelper'] = true;
  if (key.target.parent !== scene) scene.add(key.target);
  key.position.copy(center).addScaledVector(sceneSunDirection(look.sun.azimuth, look.sun.elevation), radius * 3);
  key.target.updateMatrixWorld(); key.updateMatrixWorld();
  key.castShadow = look.shadows.enabled;
  // One bounded building uses a fitted orthographic shadow. CSM is unnecessary for this finite scene extent.
  const camera = key.shadow.camera;
  camera.left = camera.bottom = -radius; camera.right = camera.top = radius;
  camera.near = 0.1; camera.far = radius * 6; camera.updateProjectionMatrix();
  const mapSize = Math.min(look.shadows.mapSize, maxTextureSize);
  if (key.shadow.mapSize.x !== mapSize) { key.shadow.dispose(); key.shadow.map = null; }
  key.shadow.mapSize.setScalar(mapSize);
  key.shadow.bias = look.shadows.bias; key.shadow.normalBias = look.shadows.normalBias; key.shadow.radius = look.shadows.radius;
}

/** The single draw boundary for editor, nodes, previews, stills, video and diagnostic captures. */
export function renderStudioView(scene: THREE.Scene, renderer: THREE.WebGLRenderer, camera: THREE.Camera, options: StudioViewOptions): void {
  const object = options.object, mode = options.mode ?? 'lit';
  clearSceneRaster(renderer);
  if (object) updateModelKitMatrices(object);
  const stored = object ? validateVibi3DLook(object.userData['vibi3dLook']) : null;
  // Existing test/integration ports need only render(); no new GPU obligations are imposed on them.
  if (!('isWebGLRenderer' in renderer) || renderer.isWebGLRenderer !== true) { renderer.render(scene, camera); recordDirectSceneRaster(renderer); return; }
  if (!object || (!stored && mode !== 'ao')) { legacy(scene, renderer); renderer.render(scene, camera); recordDirectSceneRaster(renderer); return; }
  const level = typeof object.userData['vibi3dLighting'] === 'number' ? object.userData['vibi3dLighting'] as number : 1;
  const look = resolveVibi3DLook(stored, level), state = remember(scene, renderer);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = TONES[look.toneMapping]; renderer.toneMappingExposure = look.exposure;
  // r185 merges soft PCF into PCFShadowMap; using the deprecated alias reconfigures it on every draw.
  renderer.shadowMap.enabled = look.shadows.enabled; renderer.shadowMap.type = THREE.PCFShadowMap;
  scene.fog = look.fog.enabled && mode === 'lit' ? new THREE.FogExp2(look.fog.color, look.fog.density) : null;
  if (look.preset === 'studio') {
    hideSceneSky(scene); scene.environment = studioEnvironment(renderer); scene.environmentIntensity = look.intensity;
  } else applySceneSky(scene, renderer, look, mode === 'lit' && options.background !== 'preserve');
  applyLights(scene, object, look, state, renderer.capabilities.maxTextureSize);
  const originals: { mesh: THREE.Mesh; cast: boolean; receive: boolean }[] = [];
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    originals.push({ mesh: child, cast: child.castShadow, receive: child.receiveShadow });
    const flags = modelShadowSettings(child); child.castShadow = flags.cast; child.receiveShadow = flags.receive;
  });
  try {
    // A default studio remains the original direct render path, including the original AA behaviour.
    if (look.preset === 'studio' && !look.ao.enabled && !look.bloom.enabled && mode !== 'ao') {
      renderer.render(scene, camera); recordDirectSceneRaster(renderer);
    }
    else renderSceneEffects(scene, renderer, camera, look, options.quality ?? look.quality, mode);
  } finally {
    // Rendering must not alter locked serialized nodes, dirty state, history or future exports.
    originals.forEach(({ mesh, cast, receive }) => { mesh.castShadow = cast; mesh.receiveShadow = receive; });
  }
}

export function releaseSceneLook(renderer: THREE.WebGLRenderer): void {
  clearSceneRaster(renderer);
  releaseSceneEffects(renderer); releaseSceneSky(renderer);
  rendererStates.get(renderer)?.lights.forEach(light => { light.shadow.dispose(); light.shadow.map = null; });
  rendererStates.delete(renderer);
}
