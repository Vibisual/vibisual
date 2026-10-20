import * as THREE from 'three';

import { validateVibi3DLook, type CreationValue } from '@vibisual/shared';
import { resolveCreationBlobs } from './creationBlobs.js';
import { CreationUiError } from './creationErrors.js';
import { parseModelAsset } from './modelAsset.js';
export { parseModelAsset } from './modelAsset.js';
import { STUDIO_LIGHT, applyStudioEnvironment, createStudioLights, releaseStudioEnvironment, renderStudioView, studioLightPlan } from './studioLighting.js';
import { firstModelPick, selectionModelBounds, visibleModelBounds } from './modelBounds.js';
import { applyModelOutputCamera, MODEL_SCENE_DEFAULTS, type ModelOutputOptions } from './modelSceneCamera.js';
export { MODEL_SCENE_DEFAULTS, type ModelOutputOptions } from './modelSceneCamera.js';

/**
 * §5.13 (R-10) — the deterministic product renderer shared by Vibistudio model items and Vibimage product stills
 * (same camera rules, same time base, same studio light as the Vibi3D view).
 */
export interface ModelBoxRect { x: number; y: number; width: number; height: number }
export interface ModelHit {
  objectId: string;
  tag: string;
  text: string;
  /** In the rendered frame's pixels (0..width, 0..height). */
  rect: ModelBoxRect;
  properties: Record<string, unknown>;
}

function number(value: unknown, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
/** One instance per timeline item: the same asset at two times never shares mutable animation state. */
export class ModelScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(MODEL_SCENE_DEFAULTS.fov, 1, MODEL_SCENE_DEFAULTS.near, MODEL_SCENE_DEFAULTS.far);
  readonly duration: number;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions: { action: THREE.AnimationAction; clip: THREE.AnimationClip }[];
  private readonly center: THREE.Vector3;
  private readonly size: number;
  private readonly lights = createStudioLights();
  /** The turntable turns around the model's own centre, not the scene origin. */
  private readonly pivot = new THREE.Group();
  private readonly offset = new THREE.Group();
  private readonly sourceLights: { light: THREE.Light; intensity: number }[] = [];
  private readonly sourceCamera: THREE.PerspectiveCamera | undefined;
  private readonly level: number;

  constructor(readonly object: THREE.Object3D, clips: THREE.AnimationClip[]) {
    const box = visibleModelBounds(object);
    this.center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    this.size = box.isEmpty() ? 1 : Math.max(...box.getSize(new THREE.Vector3()).toArray(), 0.01);
    this.pivot.position.copy(this.center);
    this.offset.position.copy(this.center).negate();
    this.offset.add(object);
    this.pivot.add(this.offset);
    this.scene.add(this.pivot, this.lights.ambient, this.lights.key);
    const lighting: unknown = object.userData['vibi3dLighting'];
    this.level = typeof lighting === 'number' && Number.isFinite(lighting) && lighting >= 0 ? lighting : 1;
    this.mixer = new THREE.AnimationMixer(object);
    let camera: THREE.PerspectiveCamera | undefined;
    object.traverse(child => {
      if (child instanceof THREE.Light) this.sourceLights.push({ light: child, intensity: child.intensity });
      if (child instanceof THREE.PerspectiveCamera && child.userData['vibi3dViewCamera'] === true) camera = child;
    });
    this.sourceCamera = camera;
    const plan = studioLightPlan(object);
    this.lights.ambient.visible = plan.ambient;
    this.lights.key.visible = plan.key;
    // A clip plays once and holds its last pose: seeking past its end never wraps to the start.
    this.actions = clips.map(clip => {
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      return { action, clip };
    });
    this.duration = Math.max(0, ...clips.map(clip => clip.duration));
  }

  private seekClips(time: number): void {
    for (const { action, clip } of this.actions) {
      action.enabled = true;
      action.paused = false;
      action.time = Math.min(Math.max(0, time), clip.duration);
    }
    this.mixer.update(0);
  }

  seekFrame(width: number, height: number, time: number, p: Readonly<Record<string, unknown>> = {}): void {
    this.seekClips(time);
    this.pivot.rotation.y = number(p['turntable'], 0) * time * Math.PI / 180;
    applyModelOutputCamera(this.camera, this.object, this.sourceCamera, this.center, this.size, width, height, time, p);
    // A saved look is the light authority across editor, still and video; old documents keep item overrides.
    const legacyLightProps: Readonly<Record<string, unknown>> = validateVibi3DLook(this.object.userData['vibi3dLook']) === null ? p : {};
    this.lights.ambient.intensity = number(legacyLightProps['ambientLight'], STUDIO_LIGHT.ambient * this.level);
    this.lights.key.intensity = number(legacyLightProps['keyLight'], STUDIO_LIGHT.key * this.level);
    this.sourceLights.forEach(({ light, intensity }) => {
      const ambient = light instanceof THREE.HemisphereLight || light instanceof THREE.AmbientLight;
      light.intensity = number(legacyLightProps[ambient ? 'ambientLight' : 'keyLight'], intensity);
    });
    this.scene.updateMatrixWorld(true);
  }

  /** Seek + studio environment + draw, synchronously: nothing else can use the renderer in between. */
  renderTo(
    renderer: THREE.WebGLRenderer, width: number, height: number, time: number, props: Readonly<Record<string, unknown>> = {},
    environment: (scene: THREE.Scene, renderer: THREE.WebGLRenderer, level: number) => void = applyStudioEnvironment,
    renderView: typeof renderStudioView = renderStudioView,
  ): void {
    this.seekFrame(width, height, time, props);
    environment(this.scene, renderer, this.level);
    renderView(this.scene, renderer, this.camera, { object: this.object, quality: 'final', background: props['modelBackground'] === 'sky' ? 'sky' : 'preserve' });
  }

  /** Raycast at (x, y) in a frame of `width × height` pixels after `seekFrame`. */
  pickAt(x: number, y: number, width: number, height: number): ModelHit | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(x / width * 2 - 1, 1 - y / height * 2), this.camera);
    const object = firstModelPick(this.object, ray.intersectObject(this.object, true));
    if (!object) return null;
    const id = String(object.userData['vibi3dId'] ?? object.uuid);
    const material = (object as THREE.Mesh).material;
    const bounds = selectionModelBounds(this.object, object);
    const points = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(
      i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z).project(this.camera));
    const left = Math.max(0, Math.min(...points.map(p => (p.x + 1) * width / 2)));
    const top = Math.max(0, Math.min(...points.map(p => (1 - p.y) * height / 2)));
    const right = Math.min(width, Math.max(...points.map(p => (p.x + 1) * width / 2)));
    const bottom = Math.min(height, Math.max(...points.map(p => (1 - p.y) * height / 2)));
    return {
      objectId: id, tag: object.type, text: object.name || id,
      rect: { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) },
      properties: {
        position: object.position.toArray(), scale: object.scale.toArray(), rotation: object.rotation.toArray().slice(0, 3),
        material: Array.isArray(material) ? material.map(m => m.name) : material?.name ?? null, recipe: object.userData['vibi3dRecipe'] ?? null,
      },
    };
  }

  dispose(): void {
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.object);
    this.lights.key.shadow.dispose();
    const textures = new Set<THREE.Texture>();
    const skeletons = new Set<THREE.Skeleton>();
    this.object.traverse(object => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        material.dispose();
      }
      if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
    });
    textures.forEach(texture => { texture.dispose(); if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close(); });
    skeletons.forEach(skeleton => skeleton.dispose());
    this.scene.clear();
  }
}

/**
 * Product stills use the same source, camera, light and deterministic time as video frames. Blob references in the
 * stored source are resolved first.
 */
export async function renderModelSourceStill(projectId: string, payload: CreationValue, width: number, height: number, time = 0, options: ModelOutputOptions = {}): Promise<Blob> {
  const resolved = await resolveCreationBlobs(projectId, payload);
  const parts = await parseModelAsset(new TextEncoder().encode(JSON.stringify(resolved)).buffer as ArrayBuffer, 'source.vibi3d');
  const model = new ModelScene(parts.object, parts.clips);
  let renderer: THREE.WebGLRenderer | undefined;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(width, height, false); renderer.setClearColor(0, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    model.renderTo(renderer, width, height, time, { ...options });
    const canvas = renderer.domElement;
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new CreationUiError('model-export-failed')), 'image/png'));
  } finally {
    model.dispose();
    if (renderer) { releaseStudioEnvironment(renderer); renderer.dispose(); renderer.forceContextLoss(); }
  }
}
