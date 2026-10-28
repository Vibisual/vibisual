import * as THREE from 'three';
import type { CreationCandidateSummary } from '@vibisual/shared';
import { createStudioLights, planStudioLights, type StudioLights } from '../Creation/studioLighting.js';
import type { LoadedModel } from './modelIO.js';
import { visibleModelBounds } from './modelBounds.js';
import { applyModelCameraView, readActiveModelShot, readModelCamera } from './modelCamera.js';

/**
 * §5.13 (R-10) — candidate preview lifecycle without React/WebGL (testable): one renderer per review, one scene swapping the shown source,
 * parsed sources cached by key so switching never parses again.
 */
export interface PreviewRenderer {
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
}
export interface PreviewStageOptions {
  createRenderer: () => PreviewRenderer;
  cache: PreviewModelCache;
  width: number;
  height: number;
  /** Studio reflections (RoomEnvironment + PMREM) for the real renderer; tests pass nothing. */
  environment?: (scene: THREE.Scene, renderer: PreviewRenderer, level: number) => void;
  /** The real UI supplies the common look renderer; lifecycle tests keep their minimal renderer. */
  renderView?: (scene: THREE.Scene, renderer: PreviewRenderer, camera: THREE.PerspectiveCamera, object: THREE.Object3D) => void;
  /** Releases the environment texture (before disposing, and after a lost GL context comes back empty). */
  releaseEnvironment?: (renderer: PreviewRenderer) => void;
}

/** Parsed sources by key ('doc@3', 'candidate:id@createdAt'), least recently used first; at most `limit` stay parsed. */
export class PreviewModelCache {
  private readonly entries = new Map<string, Promise<LoadedModel>>();
  private disposed = false;
  constructor(
    private readonly parse: (payload: unknown) => Promise<LoadedModel>,
    private readonly release: (model: LoadedModel) => void,
    private readonly limit = 4,
  ) {}
  get size(): number { return this.entries.size; }
  get(key: string, payload: () => unknown): Promise<LoadedModel> {
    if (this.disposed) return Promise.reject(new Error('preview-closed'));
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }
    const entry = Promise.resolve().then(payload).then((value) => this.parse(value));
    // A failed read may be retried.
    entry.catch(() => { if (this.entries.get(key) === entry) this.entries.delete(key); });
    this.entries.set(key, entry);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value as string;
      const evicted = this.entries.get(oldest)!;
      this.entries.delete(oldest);
      void evicted.then((model) => this.release(model), () => undefined);
    }
    return entry;
  }
  /** Releases every parsed source, including ones still parsing (released when they finish). */
  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) void entry.then((model) => this.release(model), () => undefined);
    this.entries.clear();
  }
}

export class CandidatePreviewStage {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private renderer: PreviewRenderer | null = null;
  private readonly lights: StudioLights = createStudioLights();
  private shown: THREE.Object3D | null = null;
  private wanted = '';
  private disposed = false;
  private renderers = 0;

  constructor(private readonly options: PreviewStageOptions) {
    this.camera = new THREE.PerspectiveCamera(45, options.width / Math.max(1, options.height), 0.001, 10000);
    this.scene.background = new THREE.Color(0x0b0d12);
    this.scene.add(this.lights.ambient, this.lights.key);
  }
  /** How many renderers this stage made (one for its lifetime). */
  get rendererCount(): number { return this.renderers; }
  get current(): THREE.Object3D | null { return this.shown; }

  /** Shows one source; only the newest request wins. True when it is on screen. */
  async show(key: string, payload: () => unknown): Promise<boolean> {
    this.wanted = key;
    const model = await this.options.cache.get(key, payload);
    if (this.disposed || this.wanted !== key) return false;
    if (this.shown !== model.object) {
      if (this.shown) this.scene.remove(this.shown);
      this.scene.add(model.object);
      this.shown = model.object;
      this.frame(model.object);
    }
    this.render();
    return true;
  }
  render(): void {
    if (this.disposed || !this.shown) return;
    if (!this.renderer) { this.renderer = this.options.createRenderer(); this.renderers += 1; }
    const lighting: unknown = this.shown.userData['vibi3dLighting'];
    const level = typeof lighting === 'number' && Number.isFinite(lighting) && lighting >= 0 ? lighting : 1;
    planStudioLights(this.lights, this.shown, level);
    this.options.environment?.(this.scene, this.renderer, level);
    if (this.options.renderView) this.options.renderView(this.scene, this.renderer, this.camera, this.shown);
    else this.renderer.render(this.scene, this.camera);
  }
  /** A lost GL context came back: three re-uploads the scene, the environment is made again, then one draw. */
  contextRestored(): void {
    if (this.renderer) this.options.releaseEnvironment?.(this.renderer);
    this.render();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.shown) this.scene.remove(this.shown);
    this.shown = null;
    this.options.cache.dispose();
    if (this.renderer) {
      this.options.releaseEnvironment?.(this.renderer);
      this.renderer.dispose();
      this.renderer = null;
    }
  }
  /** The saved camera when the source has one (as when it opens in Vibi3D), otherwise a 3/4 framing. */
  private frame(object: THREE.Object3D): void {
    const view = readActiveModelShot(object) ?? readModelCamera(object);
    this.camera.fov = 45;
    if (!applyModelCameraView(this.camera, view, { aspect: this.options.width / Math.max(1, this.options.height) })) {
      const box = visibleModelBounds(object);
      const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
      const size = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
      this.camera.position.copy(center).add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(radius / Math.sin(Math.PI / 8) * 1.6));
      this.camera.lookAt(center);
    }
    this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
  }
}

/**
 * The polled candidate list with unchanged entries kept as the same objects (by id, createdAt and status), and the
 * previous array itself returned when nothing changed — so a poll never re-reads or re-renders an open candidate.
 */
export function mergeCandidateSummaries(previous: CreationCandidateSummary[], next: CreationCandidateSummary[]): CreationCandidateSummary[] {
  const known = new Map(previous.map((item) => [item.id, item]));
  let changed = previous.length !== next.length;
  const merged = next.map((item, index) => {
    const old = known.get(item.id);
    const same = old && old.createdAt === item.createdAt && old.status === item.status && old.baseRevision === item.baseRevision && old.label === item.label;
    if (!same || previous[index] !== old) changed = true;
    return same ? old : item;
  });
  return changed ? merged : previous;
}
