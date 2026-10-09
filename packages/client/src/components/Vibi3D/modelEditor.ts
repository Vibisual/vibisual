import * as THREE from 'three';
import { validateVibi3DCommand, type Vibi3DCommand, type Vibi3DNode, type Vibi3DSnapshot, type Vibi3DVec3 } from '@vibisual/shared';

type ColoredMaterial = THREE.Material & { color: THREE.Color };
type MaterialObject = THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
interface ObjectState {
  object: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  colors: Array<{ material: ColoredMaterial; color: THREE.Color }>;
}
interface EditState { objects: ObjectState[]; lighting: number }
interface HistoryEntry { before: EditState; after: EditState }
export interface ModelEditorOptions { fileName?: string; projectId?: string; filePath?: string; historyLimit?: number }

function materials(object: THREE.Object3D): THREE.Material[] {
  const material = (object as MaterialObject).material;
  return Array.isArray(material) ? material : material ? [material] : [];
}
function coloredMaterials(object: THREE.Object3D): ColoredMaterial[] {
  return materials(object).filter((material): material is ColoredMaterial =>
    'color' in material && material.color instanceof THREE.Color);
}
function vector(value: THREE.Vector3): Vibi3DVec3 { return [value.x, value.y, value.z]; }

/** Shared by manual controls and AI commands. Playback must be stopped before content edits. */
export class ModelEditor {
  readonly sessionId = THREE.MathUtils.generateUUID();
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

  constructor(object: THREE.Object3D, clips: THREE.AnimationClip[] = [], options: ModelEditorOptions = {}) {
    this.object = object;
    this.clips = clips;
    this.fileName = options.fileName || object.name || 'model';
    this.projectId = options.projectId ?? '';
    this.filePath = options.filePath ?? '';
    this.historyLimit = Math.min(100, Math.max(1, Math.trunc(options.historyLimit ?? 50)));
    const lighting: unknown = object.userData['vibi3dLighting'];
    this.currentLighting = typeof lighting === 'number' && Number.isFinite(lighting) && lighting >= 0 && lighting <= 10 ? lighting : 1;
    object.userData['vibi3dLighting'] = this.currentLighting;
    const ownedMaterials = new Set<THREE.Material>();
    object.traverse((node) => {
      const savedId: unknown = node.userData['vibi3dId'];
      const id = typeof savedId === 'string' && savedId.length > 0 && savedId.length <= 200 && !this.objects.has(savedId)
        ? savedId : THREE.MathUtils.generateUUID();
      node.userData['vibi3dId'] = id;
      this.objects.set(id, node);
      // Each slot owns a material, but may still share immutable textures/geometries.
      // Keeping the first use avoids leaking imported materials that a clone would replace.
      const owner = node as MaterialObject;
      const isolate = (material: THREE.Material): THREE.Material => {
        const result = ownedMaterials.has(material) ? material.clone() : material;
        ownedMaterials.add(result);
        return result;
      };
      if (Array.isArray(owner.material)) owner.material = owner.material.map(isolate);
      else if (owner.material) owner.material = isolate(owner.material);
    });
  }

  get revision(): number { return this.currentRevision; }
  get selectedId(): string | null { return this.currentSelectedId; }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get lighting(): number { return this.currentLighting; }
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
      const id = this.getId(object);
      if (!id) continue;
      // A group exposes a color only when all of its color-bearing slots agree.
      const colors = subtreeColors.get(object)!;
      const color = colors.size === 1 ? [...colors][0] : undefined;
      const rotation = new THREE.Euler().setFromQuaternion(object.quaternion, 'XYZ');
      nodes.push({
        id, parentId: object.parent ? this.getId(object.parent) : null,
        name: object.name || object.type, type: object.type,
        position: vector(object.position),
        rotation: [rotation.x, rotation.y, rotation.z].map(THREE.MathUtils.radToDeg) as Vibi3DVec3,
        scale: vector(object.scale), ...(color === undefined ? {} : { color }),
      });
    }
    return {
      sessionId: this.sessionId, projectId: this.projectId, fileName: this.fileName,
      revision: this.revision, selectedId: this.selectedId, nodes,
      canUndo: this.canUndo, canRedo: this.canRedo, lighting: this.lighting,
    };
  }

  select(id: string | null): Vibi3DSnapshot {
    if (id !== null && !this.objects.has(id)) throw new Error('Object does not exist in the current model.');
    this.currentSelectedId = id;
    return this.snapshot();
  }

  /** Validates the entire batch before changing anything; one batch is one undo step. */
  apply(command: Vibi3DCommand | Vibi3DCommand[], expectedRevision: number): Vibi3DSnapshot {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== this.currentRevision) {
      throw new Error('The model changed. Read its latest revision before editing.');
    }
    const input = Array.isArray(command) ? command : [command];
    if (input.length === 0 || input.length > 100) throw new Error('Provide between 1 and 100 commands.');
    const commands = input.map((value) => {
      const valid = validateVibi3DCommand(value);
      if (!valid) throw new Error('Invalid 3D command.');
      return valid;
    });
    if (commands.length === 1) {
      const single = commands[0]!;
      if (single.type === 'select') return this.select(single.id);
      if (single.type === 'undo') return this.undo(expectedRevision);
      if (single.type === 'redo') return this.redo(expectedRevision);
    }
    const affected = new Set<THREE.Object3D>();
    for (const item of commands) {
      if (item.type === 'lighting') continue;
      if (item.type !== 'update') throw new Error('Selection, history, and capture commands must run separately.');
      const object = this.objects.get(item.id);
      if (!object) throw new Error('Object does not exist in the current model.');
      affected.add(object);
      if (item.color !== undefined) {
        let colored = false;
        object.traverse((child) => {
          if (coloredMaterials(child).length > 0) { affected.add(child); colored = true; }
        });
        if (!colored) throw new Error('This object has no editable material color.');
      }
    }
    const before = this.capture(affected);
    for (const item of commands) {
      if (item.type === 'lighting') {
        this.setLighting(item.intensity);
      } else if (item.type === 'update') {
        const object = this.objects.get(item.id)!;
        if (item.position) object.position.fromArray(item.position);
        if (item.rotation) object.rotation.set(...item.rotation.map(THREE.MathUtils.degToRad) as Vibi3DVec3, 'XYZ');
        if (item.scale) object.scale.fromArray(item.scale);
        if (item.color !== undefined) object.traverse((child) => coloredMaterials(child).forEach((material) => material.color.set(item.color!)));
        object.updateMatrix();
      }
    }
    this.object.updateMatrixWorld(true);
    this.undoStack.push({ before, after: this.capture(affected) });
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.currentRevision += 1;
    return this.snapshot();
  }

  undo(expectedRevision = this.revision): Vibi3DSnapshot {
    this.checkRevision(expectedRevision);
    const entry = this.undoStack.pop();
    if (!entry) throw new Error('There is no edit to undo.');
    this.restore(entry.before);
    this.redoStack.push(entry);
    this.currentRevision += 1;
    return this.snapshot();
  }

  redo(expectedRevision = this.revision): Vibi3DSnapshot {
    this.checkRevision(expectedRevision);
    const entry = this.redoStack.pop();
    if (!entry) throw new Error('There is no edit to redo.');
    this.restore(entry.after);
    this.undoStack.push(entry);
    this.currentRevision += 1;
    return this.snapshot();
  }

  private checkRevision(expected: number): void {
    if (!Number.isSafeInteger(expected) || expected !== this.revision) throw new Error('The model changed. Read its latest revision before editing.');
  }
  private setLighting(value: number): void {
    this.currentLighting = value;
    this.object.userData['vibi3dLighting'] = value;
  }
  private capture(objects: Set<THREE.Object3D>): EditState {
    return {
      lighting: this.lighting,
      objects: [...objects].map((object) => ({
        object, position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(),
        colors: coloredMaterials(object).map((material) => ({ material, color: material.color.clone() })),
      })),
    };
  }
  private restore(state: EditState): void {
    for (const entry of state.objects) {
      entry.object.position.copy(entry.position);
      entry.object.quaternion.copy(entry.quaternion);
      entry.object.scale.copy(entry.scale);
      for (const entryColor of entry.colors) entryColor.material.color.copy(entryColor.color);
      entry.object.updateMatrix();
    }
    this.setLighting(state.lighting);
    this.object.updateMatrixWorld(true);
  }
}
