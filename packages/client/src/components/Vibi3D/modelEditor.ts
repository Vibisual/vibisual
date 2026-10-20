import * as THREE from 'three';
import {
  validateVibi3DAuthoringCommand, validateVibi3DCommand, validateVibi3DRecipe, validateVibi3DLook, resolveVibi3DLook,
  validateVibi3DArchitectureCommand, validateVibi3DArchitectureRecipe,
  VIBI3D_LIMITS, validateVibi3DKitCommand, validateVibi3DInstance,
  validateVibi3DSignRecipe, validateVibi3DDecalRecipe, validateVibi3DMascotRecipe,
  type Vibi3DCameraKey, type Vibi3DCommand, type Vibi3DNode, type Vibi3DSnapshot, type Vibi3DVec3, type Vibi3DLook, type Vibi3DMaterial, type Vibi3DImageSource,
} from '@vibisual/shared';
import { CreationUiError } from '../Creation/creationErrors.js';
import { applyAuthoring, objectMaterials, readLight, readMaterial, readMotions, viewCamera } from './modelAuthoring.js';
import { captureModel, restoreModel, type ModelState } from './modelHistory.js';
import { modelShadowSettings } from '../Creation/modelShadows.js';
import { mergeModelLook } from './modelLook.js';
import type { ModelMaterialTextures } from './modelMaterials.js';
import { refreshModelMetricUvs } from './modelMetricUvs.js';
import { applyModelArchitecture } from './applyModelArchitecture.js';
import { applyModelKit, refreshModelKit, isModelKitInternal, readModelKitModules, modelKitLockTargets } from './modelKit.js';
import { modelKitEditGuards, assertStaticKitSource } from './modelKitEditGuards.js';
import { applyModelSign } from './applyModelSign.js';
import { applyModelDecal } from './modelDecal.js';
import { applyModelMascot } from './modelMascot.js';
import { markPreparedInstalled } from './modelPreparedGraphics.js';
import { readModelCamera, readModelShots, readActiveModelShot } from './modelCamera.js';
import { syncModelGraphicSource } from './modelGraphicSources.js';

type ColoredMaterial = THREE.Material & { color: THREE.Color };
type MappedMaterial = THREE.Material & { map: THREE.Texture | null; opacity: number; alphaMap?: THREE.Texture | null };
interface HistoryEntry { before: ModelState; after: ModelState }
interface HumanHistory { undo: HistoryEntry[]; redo: HistoryEntry[] }
interface GpuResources { geometries: Set<THREE.BufferGeometry>; materials: Set<THREE.Material>; textures: Set<THREE.Texture>; skeletons: Set<THREE.Skeleton>; instances: Set<THREE.InstancedMesh> }
interface HumanEdits {
  before: ModelState; revision: number; selectedId: string | null; resources: GpuResources;
  undo: HistoryEntry[]; redo: HistoryEntry[]; savedHistory: HumanHistory | null;
}
export interface ModelEditorOptions { fileName?: string; projectId?: string; filePath?: string; historyLimit?: number; sessionId?: string; revision?: number }
/** `merge`: consecutive edits with the same key (one colour drag) stay one undo step. */
export interface ModelApplyOptions {
  merge?: string; materialMaps?: Readonly<Record<number, ModelMaterialTextures>>;
  preparedSigns?: Readonly<Record<number, THREE.Group>>;
  decorationTextures?: Readonly<Record<number, THREE.Texture>>;
  /** Internal user source-link update; never accepted from command JSON. */
  sourceLinkUpdate?: boolean;
}
export interface ModelAsyncApplyOptions extends ModelApplyOptions {
  onProgress?: (progress: number) => void | Promise<void>;
  assertActive?: () => void;
}

function coloredMaterials(object: THREE.Object3D): ColoredMaterial[] {
  return objectMaterials(object).filter((material): material is ColoredMaterial =>
    'color' in material && material.color instanceof THREE.Color);
}
function vector(value: THREE.Vector3): Vibi3DVec3 { return [value.x, value.y, value.z]; }
function cameraMotion(root: THREE.Object3D): Vibi3DSnapshot['cameraMotion'] {
  const stored = root.userData['vibi3dCameraMotion'] as { name?: unknown; keys?: unknown } | undefined;
  if (!stored || typeof stored.name !== 'string') return undefined;
  const valid = validateVibi3DAuthoringCommand({ type: 'cameraMotion', name: stored.name, keys: stored.keys });
  return valid?.type === 'cameraMotion' ? { name: valid.name, keys: valid.keys as Vibi3DCameraKey[] } : undefined;
}

/** Shared by manual controls and AI commands. Playback must be stopped before content edits. */
export class ModelEditor {
  readonly sessionId: string;
  readonly object: THREE.Object3D;
  readonly clips: THREE.AnimationClip[];
  readonly fileName: string;
  readonly projectId: string;
  readonly filePath: string;
  private readonly objects = new Map<string, THREE.Object3D>();
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private readonly historyLimit: number;
  private currentRevision = 0;
  private currentSelectedId: string | null = null;
  private currentLighting = 1;
  private applying = false;
  /** Independent of bounded undo history, so discarding a long human edit never loses earlier agent work. */
  private humanEdits: HumanEdits | null = null;
  /** Saved manual history remains usable until an agent changes the scene underneath it. */
  private savedHumanHistory: HumanHistory | null = null;
  /** The merge key of the edit on top of the undo stack, while nothing else happened after it. */
  private mergeOpen: { key: string; revision: number } | null = null;

  constructor(object: THREE.Object3D, clips: THREE.AnimationClip[] = [], options: ModelEditorOptions = {}) {
    this.sessionId = options.sessionId ?? THREE.MathUtils.generateUUID();
    this.currentRevision = options.revision ?? 0;
    this.object = object;
    this.clips = clips;
    this.fileName = options.fileName || object.name || 'model';
    this.projectId = options.projectId ?? '';
    this.filePath = options.filePath ?? '';
    this.historyLimit = Math.min(100, Math.max(1, Math.trunc(options.historyLimit ?? 50)));
    const lighting: unknown = object.userData['vibi3dLighting'];
    const legacyIntensity = typeof lighting === 'number' && Number.isFinite(lighting) && lighting >= 0 && lighting <= 10 ? lighting : 1;
    this.currentLighting = resolveVibi3DLook(object.userData['vibi3dLook'], legacyIntensity).intensity;
    object.userData['vibi3dLighting'] = this.currentLighting;
    const ownedMaterials = new Set<THREE.Material>();
    object.traverse((node) => {
      const savedId: unknown = node.userData['vibi3dId'];
      const id = typeof savedId === 'string' && savedId.length > 0 && savedId.length <= 200 && !this.objects.has(savedId)
        ? savedId : !this.objects.has(node.uuid) ? node.uuid : THREE.MathUtils.generateUUID();
      node.userData['vibi3dId'] = id;
      this.objects.set(id, node);
      // Each slot owns a material, but may still share immutable textures/geometries.
      // Keeping the first use avoids leaking imported materials that a clone would replace.
      const owner = node as THREE.Mesh;
      const isolate = (material: THREE.Material): THREE.Material => {
        const result = ownedMaterials.has(material) ? material.clone() : material;
        ownedMaterials.add(result);
        return result;
      };
      if (Array.isArray(owner.material)) owner.material = owner.material.map(isolate);
      else if (owner.material) owner.material = isolate(owner.material);
    });
    if (!object.children.some(child => child.userData['vibi3dKitBucket'])
      && [...this.objects.values()].some(node => node.userData['vibi3dInstance'])) {
      refreshModelKit(object); this.reindex();
    }
  }

  get revision(): number { return this.currentRevision; }
  get selectedId(): string | null { return this.currentSelectedId; }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get lighting(): number { return this.currentLighting; }
  get hasHumanEdits(): boolean { return this.humanEdits !== null && this.revision !== this.humanEdits.revision; }
  get canUndoHuman(): boolean { return (this.humanEdits ? this.undoStack : this.savedHumanHistory?.undo ?? []).length > 0; }
  get canRedoHuman(): boolean { return (this.humanEdits ? this.redoStack : this.savedHumanHistory?.redo ?? []).length > 0; }

  /**
   * Call before the first manual mutation. Park the agent's history so human undo cannot cross the boundary.
   * The caller must serialize agent mutations until the human edits are saved or discarded.
   * Returns true only for a new boundary; on a failed/no-op first edit, discard it to restore the parked history.
   */
  beginHumanEdits(): boolean {
    this.checkRevision(this.revision);
    if (this.humanEdits) return false;
    const before = captureModel(this.object, this.clips);
    const resources = this.resources();
    this.humanEdits = {
      before, revision: this.revision, selectedId: this.selectedId, resources,
      undo: this.undoStack.splice(0), redo: this.redoStack.splice(0), savedHistory: this.savedHumanHistory,
    };
    this.undoStack.push(...(this.savedHumanHistory?.undo ?? []));
    this.redoStack.push(...(this.savedHumanHistory?.redo ?? []));
    this.savedHumanHistory = null;
    this.mergeOpen = null;
    return true;
  }

  /** Discard only the manual transaction, retaining all scene data and undo/redo from before it began. */
  discardHumanEdits(): Vibi3DSnapshot {
    this.checkRevision(this.revision);
    const edits = this.humanEdits;
    if (!edits) return this.snapshot();
    const held = this.resources();
    const changed = this.hasHumanEdits;
    this.restore(edits.before);
    this.currentSelectedId = edits.selectedId;
    this.undoStack.splice(0, this.undoStack.length, ...edits.undo);
    this.redoStack.splice(0, this.redoStack.length, ...edits.redo);
    this.savedHumanHistory = edits.savedHistory;
    this.humanEdits = null;
    this.mergeOpen = null;
    this.release(held);
    if (changed) this.currentRevision += 1;
    return this.snapshot();
  }

  /** Seal successfully saved human work against agent undo while retaining the user's own undo/redo. */
  commitHumanEdits(): Vibi3DSnapshot {
    this.checkRevision(this.revision);
    if (!this.humanEdits) return this.snapshot();
    if (!this.hasHumanEdits) return this.discardHumanEdits();
    const held = this.resources();
    this.humanEdits = null;
    this.savedHumanHistory = { undo: this.undoStack.splice(0), redo: this.redoStack.splice(0) };
    this.mergeOpen = null;
    this.release(held);
    return this.snapshot();
  }

  /**
   * Teardown only: release retained baseline GPU copies before the caller disposes the live model.
   * No revision/busy guard: an unmount may cancel a suspended async edit. Its assertActive must reject on resume.
   */
  disposeHistory(): void {
    const held = this.resources();
    this.humanEdits = null;
    this.savedHumanHistory = null;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.mergeOpen = null;
    this.release(held);
  }
  /** Prepared external maps join the same atomic command/history path as ordinary material edits. */
  applyMaterialMaps(id: string, change: Vibi3DMaterial, textures: ModelMaterialTextures, expectedRevision: number, options: { merge?: string } = {}): Vibi3DSnapshot {
    return this.apply({ type: 'material', id, material: change }, expectedRevision, { ...options, materialMaps: { 0: textures }, sourceLinkUpdate: true });
  }
  /**
   * Puts an image on the selected object's texture slots. Only an image with transparent pixels (`hasAlpha`) makes a
   * material transparent; an opaque image keeps the material's own setting. Replaced textures are released.
   */
  applyTexture(id: string, texture: THREE.Texture, expectedRevision: number, source: string, hasAlpha = false, imageSource?: Vibi3DImageSource): Vibi3DSnapshot {
    this.checkRevision(expectedRevision);
    const object = this.requireObject(id);
    modelKitEditGuards(this.object, { type: 'material', id, material: {} }, key => this.objects.get(key), false);
    this.assertUnlocked(object, true);
    const before = captureModel(this.object, this.clips);
    const held = this.resources();
    const targets: MappedMaterial[] = [];
    object.traverse((child) => {
      for (const material of objectMaterials(child)) if ('map' in material) targets.push(material as MappedMaterial);
    });
    if (!targets.length) throw new CreationUiError('no-texture-slot');
    if (imageSource) syncModelGraphicSource(this.object, object, { maps: { map: { source: imageSource } } }, node => this.assertUnlocked(node, false));
    targets.forEach((material) => {
      const previous = material.map;
      const next = previous ? texture.clone() : texture;
      if (previous) {
        next.flipY = previous.flipY; next.channel = previous.channel; next.wrapS = previous.wrapS; next.wrapT = previous.wrapT;
        next.offset.copy(previous.offset); next.repeat.copy(previous.repeat); next.center.copy(previous.center); next.rotation = previous.rotation;
        next.matrixAutoUpdate = previous.matrixAutoUpdate; next.matrix.copy(previous.matrix); next.needsUpdate = true;
      }
      material.map = next;
      // Illuminated graphics use the image for both color and emission, including the local-file texture hand.
      if (material.userData['vibi3dLinkedEmission']) (material as unknown as THREE.MeshStandardMaterial).emissiveMap = next;
      const recipe = material.userData['vibi3dMaterial'];
      if (recipe?.maps?.map) {
        delete recipe.maps.map;
        if (!Object.keys(recipe.maps).length) delete recipe.maps;
      }
      // A manually uploaded image is embedded in the texture itself, with no document pin or procedural source.
      material.userData['vibi3dCustomMaps'] = { ...material.userData['vibi3dCustomMaps'], map: true };
      if (imageSource) {
        const recipe = material.userData['vibi3dMaterial'] ??= {};
        recipe.maps = { ...recipe.maps, map: { source: structuredClone(imageSource) } };
        delete material.userData['vibi3dCustomMaps'].map;
      }
      material.transparent = hasAlpha || material.opacity < 1 || !!material.alphaMap;
      material.needsUpdate = true;
    });
    object.userData['vibi3dTextureSource'] = source;
    this.release(held);
    this.pushHistory(before, undefined);
    this.currentRevision += 1;
    return this.snapshot();
  }
  findObject(id: string): THREE.Object3D | undefined { return this.objects.get(id); }
  getId(object: THREE.Object3D): string | null {
    const id: unknown = object.userData['vibi3dId'];
    return typeof id === 'string' && this.objects.get(id) === object ? id : null;
  }

  snapshot(): Vibi3DSnapshot {
    const nodes: Vibi3DNode[] = [];
    const descendants: THREE.Object3D[] = [];
    this.object.traverse((object) => { descendants.push(object); });
    const subtreeColors = new Map<THREE.Object3D, Set<string>>();
    for (const object of [...descendants].reverse()) {
      const colors = new Set(coloredMaterials(object).map((material) => `#${material.color.getHexString()}`));
      for (const child of object.children) {
        for (const color of subtreeColors.get(child) ?? []) {
          colors.add(color);
          if (colors.size > 1) break;
        }
        if (colors.size > 1) break;
      }
      subtreeColors.set(object, colors);
    }
    for (const object of descendants) {
      if (isModelKitInternal(object)) continue;
      const id = this.getId(object);
      if (!id) continue;
      // A group exposes a color only when all of its color-bearing slots agree.
      const colors = subtreeColors.get(object)!;
      const color = object instanceof THREE.Light ? undefined : colors.size === 1 ? [...colors][0] : undefined;
      const rotation = new THREE.Euler().setFromQuaternion(object.quaternion, 'XYZ');
      // Descriptions read from the file are validated: an imported value out of range is left out, never trusted.
      const stored: unknown = object.userData['vibi3dRecipe'];
      const recipe = stored === undefined ? null : validateVibi3DRecipe(stored);
      const architecture = validateVibi3DArchitectureRecipe(object.userData['vibi3dArchitectureRecipe']);
      const instance = validateVibi3DInstance(object.userData['vibi3dInstance']);
      const sign = validateVibi3DSignRecipe(object.userData['vibi3dSignRecipe']);
      const decal = validateVibi3DDecalRecipe(object.userData['vibi3dDecalRecipe']);
      const mascot = validateVibi3DMascotRecipe(object.userData['vibi3dMascotRecipe']);
      const material = readMaterial(object);
      const light = readLight(object);
      const motions = readMotions(object);
      nodes.push({
        id, parentId: object.parent ? this.getId(object.parent) : null,
        name: object.name || object.type, type: object.type,
        position: vector(object.position),
        rotation: [rotation.x, rotation.y, rotation.z].map(THREE.MathUtils.radToDeg) as Vibi3DVec3,
        scale: vector(object.scale), ...(color === undefined ? {} : { color }),
        ...(recipe ? { recipe } : {}), ...(material ? { material } : {}), ...(light ? { light } : {}),
        ...(architecture ? { architecture } : {}),
        ...(instance ? { instance } : {}),
        ...(sign ? { sign } : {}), ...(decal ? { decal } : {}), ...(mascot ? { mascot } : {}),
        ...(motions.length ? { motions } : {}),
        ...(object instanceof THREE.Mesh || instance ? { shadows: modelShadowSettings(object) } : {}),
        ...(object.userData['vibi3dLocked'] === true ? { locked: true } : {}),
      });
    }
    const camera = readModelCamera(this.object), shots = readModelShots(this.object), activeShot = readActiveModelShot(this.object);
    const motion = cameraMotion(this.object);
    const look = validateVibi3DLook(this.object.userData['vibi3dLook']);
    const kitModules = readModelKitModules(this.object);
    return {
      sessionId: this.sessionId, projectId: this.projectId, fileName: this.fileName,
      revision: this.revision, selectedId: this.selectedId, nodes,
      canUndo: this.canUndo, canRedo: this.canRedo, lighting: this.lighting,
      ...(look ? { look } : {}),
      ...(kitModules.length ? { kitModules } : {}),
      ...(camera ? { camera } : {}), ...(motion ? { cameraMotion: motion } : {}),
      ...(shots.length ? { shots } : {}), ...(activeShot ? { activeShotId: activeShot.id } : {}),
    };
  }

  select(id: string | null): Vibi3DSnapshot {
    if (id !== null && !this.objects.has(id)) throw new CreationUiError('object-missing');
    if (id && isModelKitInternal(this.requireObject(id))) throw new CreationUiError('kit-nested-module');
    this.currentSelectedId = id;
    return this.snapshot();
  }

  /** Validates the entire batch before changing anything; one batch is one undo step. */
  apply(command: Vibi3DCommand | Vibi3DCommand[], expectedRevision: number, options: ModelApplyOptions = {}): Vibi3DSnapshot {
    const transaction = this.applySteps(command, expectedRevision, options);
    for (;;) { const step = transaction.next(); if (step.done) return step.value; }
  }

  /** The same atomic transaction yields between commands without relying on animation frames. */
  async applyAsync(command: Vibi3DCommand | Vibi3DCommand[], expectedRevision: number, options: ModelAsyncApplyOptions = {}): Promise<Vibi3DSnapshot> {
    const transaction = this.applySteps(command, expectedRevision, options);
    let lastYield = 0;
    try {
      options.assertActive?.();
      for (;;) {
        const step = transaction.next();
        if (step.done) return step.value;
        if (step.value === 1 || performance.now() - lastYield >= 16) {
          await options.onProgress?.(step.value);
          await new Promise<void>(resolve => setTimeout(resolve, 0));
          lastYield = performance.now();
        }
        options.assertActive?.();
      }
    } catch (error) {
      // Throw inside the suspended transaction so cancellation restores the original scene and resources.
      try { transaction.throw(error); } catch { /* Preserve the original error. */ }
      throw error;
    }
  }

  private *applySteps(command: Vibi3DCommand | Vibi3DCommand[], expectedRevision: number, options: ModelApplyOptions): Generator<number, Vibi3DSnapshot> {
    this.checkRevision(expectedRevision);
    const input = Array.isArray(command) ? command : [command];
    if (input.length === 0 || input.length > VIBI3D_LIMITS.commandCount) throw new CreationUiError('command-count');
    const commands = input.map((value) => {
      const valid = validateVibi3DCommand(value);
      if (!valid) throw new CreationUiError('invalid-command');
      return valid;
    });
    if (commands.length === 1) {
      const single = commands[0]!;
      if (single.type === 'select') return this.select(single.id);
      if (single.type === 'undo') return this.undo(expectedRevision);
      if (single.type === 'redo') return this.redo(expectedRevision);
      if (single.type === 'stats') return this.snapshot();
    }
    const before = captureModel(this.object, this.clips);
    const held = this.resources();
    const previousSelection = this.currentSelectedId;
    this.applying = true;
    try {
      for (const [index, item] of commands.entries()) {
        if (item.type === 'select' || item.type === 'undo' || item.type === 'redo' || item.type === 'capture' || item.type === 'checkpoint' || item.type === 'propose' || item.type === 'resume' || item.type === 'stats') throw new CreationUiError('command-alone');
        if (item.type === 'create' && item.id && this.objects.has(item.id)) throw new CreationUiError('object-id-exists');
        if (item.type === 'duplicate') {
          let children = 0; this.requireObject(item.id).traverse(() => { children++; });
          if (this.objects.size + children * (item.count ?? 1) > 20000) throw new CreationUiError('object-limit');
        }
        const kit = validateVibi3DKitCommand(item);
        const linkedModules = kit ? [] : modelKitEditGuards(this.object, item, id => this.objects.get(id), options.sourceLinkUpdate === true);
        if (kit?.type === 'kitModule' && kit.sourceId) assertStaticKitSource(this.objects.get(kit.sourceId), this.clips);
        for (const target of this.lockTargets(item)) this.assertUnlocked(this.requireObject(target.id), target.subtree);
        if (kit) applyModelKit(this.object, kit);
        else if (item.type === 'sign') {
          const prepared = options.preparedSigns?.[index];
          if (!prepared) throw new CreationUiError('sign-font-unavailable');
          applyModelSign(this.object, item, prepared);
          markPreparedInstalled(prepared);
        }
        else if (item.type === 'decal') applyModelDecal(this.object, item, options.decorationTextures?.[index]);
        else if (item.type === 'mascot') applyModelMascot(this.object, item, options.decorationTextures?.[index]);
        else if (item.type === 'lighting') this.setLighting(item.intensity);
        else if (item.type === 'look') { const { type: _type, ...look } = item; this.setLook(look); }
        else if (item.type === 'update') {
          const object = this.requireObject(item.id);
          if (item.color !== undefined) {
            let changed = false;
            object.traverse((child) => coloredMaterials(child).forEach((material) => { material.color.set(item.color!); changed = true; }));
            if (!changed) throw new CreationUiError('no-material-color');
          }
          if (item.position) object.position.fromArray(item.position);
          if (item.rotation) object.rotation.set(...item.rotation.map(THREE.MathUtils.degToRad) as Vibi3DVec3, 'XYZ');
          if (item.scale) object.scale.fromArray(item.scale);
          if (item.shadows) {
            let changed = false;
            object.traverse((child) => {
              if (child instanceof THREE.Mesh || child.userData['vibi3dInstance']) { child.userData['vibi3dShadows'] = { ...child.userData['vibi3dShadows'], ...item.shadows }; changed = true; }
            });
            if (!changed) throw new CreationUiError('no-editable-material');
          }
          object.updateMatrix();
          if (item.scale) refreshModelMetricUvs(object);
        } else {
          const architecture = validateVibi3DArchitectureCommand(item);
          if (architecture) applyModelArchitecture(this.object, architecture, id => this.objects.get(id));
          else {
            const authored = validateVibi3DAuthoringCommand(item);
            if (!authored) throw new CreationUiError('invalid-command');
            applyAuthoring(this.object, this.clips, authored, (id) => this.requireObject(id), options.materialMaps?.[index]);
            if (authored.type === 'material') syncModelGraphicSource(this.object, this.requireObject(authored.id), authored.material, node => this.assertUnlocked(node, false));
          }
        }
        if (linkedModules.length) this.object.userData['vibi3dKitModules'] = readModelKitModules(this.object).map(module => linkedModules.includes(module.id) ? { ...module, revision: module.revision + 1 } : module);
        this.reindex();
        yield (index + 1) / (commands.length + 1);
      }
      refreshModelKit(this.object); this.reindex();
      if (this.objects.size > VIBI3D_LIMITS.snapshotNodes) throw new CreationUiError('object-limit');
      this.object.updateMatrixWorld(true);
      yield 1;
      this.release(held);
      this.pushHistory(before, options.merge);
      this.currentRevision += 1;
      if (options.merge) this.mergeOpen = { key: options.merge, revision: this.currentRevision };
      return this.snapshot();
    } catch (error) { const failed = this.resources(); this.restore(before); this.currentSelectedId = previousSelection; this.release(failed); throw error; }
    finally { this.applying = false; }
  }

  undo(expectedRevision = this.revision): Vibi3DSnapshot {
    this.checkRevision(expectedRevision);
    const entry = this.undoStack.pop();
    if (!entry) throw new CreationUiError('nothing-to-undo');
    const held = this.resources();
    this.restore(entry.before);
    this.release(held);
    this.redoStack.push(entry);
    if (!this.humanEdits) this.savedHumanHistory = null;
    this.mergeOpen = null;
    this.currentRevision += 1;
    return this.snapshot();
  }

  redo(expectedRevision = this.revision): Vibi3DSnapshot {
    this.checkRevision(expectedRevision);
    const entry = this.redoStack.pop();
    if (!entry) throw new CreationUiError('nothing-to-redo');
    const held = this.resources();
    this.restore(entry.after);
    this.release(held);
    this.undoStack.push(entry);
    if (!this.humanEdits) this.savedHumanHistory = null;
    this.mergeOpen = null;
    this.currentRevision += 1;
    return this.snapshot();
  }

  /** Which objects a command must find unlocked, and whether locked descendants also stop it. */
  private lockTargets(item: Vibi3DCommand): { id: string; subtree: boolean }[] {
    const kit = validateVibi3DKitCommand(item);
    if (kit) return modelKitLockTargets(this.object, kit);
    const root = this.getId(this.object)!;
    switch (item.type) {
      // (1) A new child only needs its own branch open: a locked sibling or another branch never blocks it.
      case 'create': return [{ id: item.parentId ?? root, subtree: false }];
      case 'building': case 'facade': case 'storefront': case 'rooftop': case 'street': case 'prop': case 'sign': case 'mascot':
        return [...(item.id && this.objects.has(item.id) ? [{ id: item.id, subtree: true }] : []),
          { id: item.parentId ?? (item.id ? this.getId(this.objects.get(item.id)?.parent ?? this.object) : null) ?? root, subtree: false }];
      case 'decal': return [...(item.id && this.objects.has(item.id) ? [{ id: item.id, subtree: true }] : []),
        ...(item.target ? [{ id: item.target, subtree: false }] : [])];
      case 'light': return item.id && this.objects.has(item.id) ? [{ id: item.id, subtree: true }] : [{ id: root, subtree: false }];
      case 'group': return item.ids.map((id) => ({ id, subtree: true }));
      case 'camera': case 'cameraMotion': case 'shotRemove': {
        const camera = viewCamera(this.object, false);
        const id = camera ? this.getId(camera) : null;
        return [{ id: root, subtree: false }, ...(id ? [{ id, subtree: false }] : [])];
      }
      case 'look': case 'lighting': return [{ id: root, subtree: false }];
      case 'protect': case 'select': case 'undo': case 'redo': case 'capture': case 'checkpoint': case 'propose': case 'resume': case 'stats': return [];
      default: return [{ id: item.id, subtree: true }];
    }
  }
  private assertUnlocked(object: THREE.Object3D, subtree: boolean): void {
    let locked = false;
    if (subtree) object.traverse((child) => { if (child.userData['vibi3dLocked']) locked = true; });
    for (let node: THREE.Object3D | null = object; node && !locked; node = node.parent) if (node.userData['vibi3dLocked']) locked = true;
    if (locked) throw new CreationUiError('object-protected');
  }
  private pushHistory(before: ModelState, merge: string | undefined): void {
    if (!this.humanEdits) this.savedHumanHistory = null;
    const after = captureModel(this.object, this.clips);
    const top = this.undoStack[this.undoStack.length - 1];
    if (merge && top && this.mergeOpen?.key === merge && this.mergeOpen.revision === this.currentRevision) top.after = after;
    else {
      this.undoStack.push({ before, after });
      if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    }
    this.redoStack.length = 0;
    this.mergeOpen = null;
  }
  /** Everything the scene or pending human-discard baseline must keep on the GPU. */
  private resources(): GpuResources {
    const held: GpuResources = { geometries: new Set(), materials: new Set(), textures: new Set(), skeletons: new Set(), instances: new Set() };
    this.object.traverse((node) => {
      const geometry = (node as THREE.Mesh).geometry;
      if (geometry) held.geometries.add(geometry);
      if (node instanceof THREE.SkinnedMesh) held.skeletons.add(node.skeleton);
      if (node instanceof THREE.InstancedMesh) held.instances.add(node);
      for (const material of objectMaterials(node)) {
        held.materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) held.textures.add(value);
      }
    });
    const baseline = this.humanEdits?.resources;
    if (baseline) {
      baseline.geometries.forEach(item => held.geometries.add(item));
      baseline.materials.forEach(item => held.materials.add(item));
      baseline.textures.forEach(item => held.textures.add(item));
      baseline.skeletons.forEach(item => held.skeletons.add(item));
      baseline.instances.forEach(item => held.instances.add(item));
    }
    return held;
  }
  /**
   * Releases the GPU copies of geometry, materials, textures and skeletons an edit removed or replaced. The undo
   * history keeps their data; three uploads them again if an undo brings them back.
   */
  private release(before: GpuResources): void {
    const now = this.resources();
    before.geometries.forEach((item) => { if (!now.geometries.has(item)) item.dispose(); });
    before.materials.forEach((item) => { if (!now.materials.has(item)) item.dispose(); });
    before.textures.forEach((item) => { if (!now.textures.has(item)) item.dispose(); });
    before.skeletons.forEach((item) => { if (!now.skeletons.has(item)) item.dispose(); });
    before.instances.forEach((item) => { if (!now.instances.has(item)) item.dispose(); });
  }
  private checkRevision(expected: number): void {
    if (this.applying) throw new CreationUiError('model-busy');
    if (!Number.isSafeInteger(expected) || expected !== this.revision) throw new CreationUiError('model-changed');
  }
  private setLighting(value: number): void {
    this.currentLighting = value;
    this.object.userData['vibi3dLighting'] = value;
    if (validateVibi3DLook(this.object.userData['vibi3dLook'])) this.object.userData['vibi3dLook'] = mergeModelLook(this.object.userData['vibi3dLook'], { intensity: value }, value);
  }
  private setLook(value: Vibi3DLook): void {
    const look = mergeModelLook(this.object.userData['vibi3dLook'], value, this.currentLighting);
    this.object.userData['vibi3dLook'] = look;
    this.currentLighting = resolveVibi3DLook(look, this.currentLighting).intensity;
    this.object.userData['vibi3dLighting'] = this.currentLighting;
  }
  private requireObject(id: string): THREE.Object3D {
    const object = this.objects.get(id);
    if (!object) throw new CreationUiError('object-missing');
    return object;
  }
  private reindex(): void {
    this.objects.clear();
    this.object.traverse((object) => {
      let id: unknown = object.userData['vibi3dId'];
      if (typeof id !== 'string' || this.objects.has(id)) { id = this.objects.has(object.uuid) ? THREE.MathUtils.generateUUID() : object.uuid; object.userData['vibi3dId'] = id; }
      this.objects.set(id as string, object);
    });
    if (this.currentSelectedId && !this.objects.has(this.currentSelectedId)) this.currentSelectedId = null;
  }
  private restore(state: ModelState): void {
    restoreModel(state, this.clips);
    this.currentLighting = resolveVibi3DLook(this.object.userData['vibi3dLook'], Number(this.object.userData['vibi3dLighting'] ?? 1)).intensity;
    this.reindex();
  }
}
