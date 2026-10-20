import * as THREE from 'three';
import { validateVibi3DArchitectureRecipe, type Vibi3DArchitectureCommand, type Vibi3DArchitectureRecipe } from '@vibisual/shared';
import { CreationUiError } from '../Creation/creationErrors.js';
import { buildArchitectureObject } from './modelArchitecture.js';
import { disposeModel } from './modelIO.js';
import { refreshModelMetricUvs } from './modelMetricUvs.js';

const idOf = (node: THREE.Object3D): string => String(node.userData['vibi3dId'] ?? node.uuid);
const keyOf = (node: THREE.Object3D): string | undefined => node.userData['vibi3dArchitectureKey'] as string | undefined;
const bag = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function mergeRecipe(previous: Record<string, unknown>, changes: Record<string, unknown>): Record<string, unknown> {
  const result = { ...previous };
  for (const [key, value] of Object.entries(changes)) {
    const before = previous[key];
    result[key] = bag(value) && bag(before) && (value.kind === undefined || before.kind === value.kind) ? mergeRecipe(before, value) : value;
  }
  return result;
}
interface ManualChild { object: THREE.Object3D; parent: THREE.Object3D; world: THREE.Matrix4 }

/** Rebuild owned parts while retaining real object identities, animation bindings and manually added children. */
function reconcile(existing: THREE.Object3D, fresh: THREE.Object3D, owner: string): THREE.Object3D {
  existing.updateWorldMatrix(true, true);
  const formerOwner = existing.userData['vibi3dArchitectureOwner'] ?? idOf(existing);
  const owned = new Set<THREE.Object3D>([existing]);
  existing.traverse(node => { if (node.userData['vibi3dArchitectureOwner'] === formerOwner) owned.add(node); });
  const oldIds = new Map([...owned].map(node => [idOf(node), node]));
  const oldKeys = new Map([...owned].flatMap(node => keyOf(node) ? [[keyOf(node)!, node] as const] : []));
  const manual: ManualChild[] = [];
  for (const node of owned) for (const child of node.children) if (!owned.has(child)) manual.push({ object: child, parent: node, world: child.matrixWorld.clone() });
  const replacements = new Map<THREE.Object3D, THREE.Object3D>();
  fresh.position.copy(existing.position); fresh.quaternion.copy(existing.quaternion); fresh.scale.copy(existing.scale);
  fresh.uuid = existing.uuid;
  function copy(source: THREE.Object3D, root = false): THREE.Object3D {
    const matched = root ? existing : oldIds.get(idOf(source)) ?? (keyOf(source) ? oldKeys.get(keyOf(source)!) : undefined);
    const target = matched?.constructor === source.constructor ? matched : source;
    const children = [...source.children];
    if (matched) replacements.set(matched, target);
    if (target !== source) {
      const stableId = idOf(target);
      target.name = source.name; target.position.copy(source.position); target.quaternion.copy(source.quaternion); target.scale.copy(source.scale);
      target.userData = { ...target.userData, ...structuredClone(source.userData), vibi3dId: stableId, vibi3dArchitectureOwner: owner };
      if (source.userData['vibi3dArchitectureDetail'] !== 'architectural') delete target.userData['vibi3dArchitectureDetail'];
      for (const field of ['vibi3dRecipe', 'vibi3dFoliageRecipe']) if (!(field in source.userData)) delete target.userData[field];
      if (target instanceof THREE.Mesh && source instanceof THREE.Mesh) { target.geometry = source.geometry; target.material = source.material; }
      target.clear();
    } else source.clear();
    for (const child of children) target.add(copy(child));
    target.updateMatrix(); return target;
  }
  const result = copy(fresh, true); result.updateWorldMatrix(true, true);
  for (const child of manual) {
    const parent = replacements.get(child.parent);
    if (parent) parent.add(child.object);
    else {
      result.add(child.object);
      child.object.matrix.copy(result.matrixWorld).invert().multiply(child.world);
      child.object.matrix.decompose(child.object.position, child.object.quaternion, child.object.scale);
    }
  }
  return result;
}

export function applyModelArchitecture(root: THREE.Object3D, command: Vibi3DArchitectureCommand, find: (id: string) => THREE.Object3D | undefined): void {
  const { type, id: inputId, name, parentId, position, rotation, ...settings } = command;
  const existing = inputId ? find(inputId) : undefined;
  const previous = existing ? validateVibi3DArchitectureRecipe(existing.userData['vibi3dArchitectureRecipe']) : null;
  if (existing && (!previous || previous.kind !== type || existing === root)) throw new CreationUiError('object-id-exists');
  const parent = parentId ? find(parentId) : existing?.parent ?? root;
  if (!parent) throw new CreationUiError('object-missing');
  for (let node: THREE.Object3D | null = parent; node; node = node.parent) if (node === existing) throw new CreationUiError('root-not-groupable');
  const defaults = previous ?? { detail: 'architectural' };
  const recipe = validateVibi3DArchitectureRecipe(mergeRecipe(defaults as unknown as Record<string, unknown>, { ...settings, kind: type }));
  if (!recipe) throw new CreationUiError('invalid-command');
  const id = inputId ?? THREE.MathUtils.generateUUID();
  const fresh = buildArchitectureObject(recipe as Vibi3DArchitectureRecipe, id);
  try {
    const formerOwner = existing?.userData['vibi3dArchitectureOwner'] ?? id;
    const replaceable = new Set<THREE.Object3D>();
    existing?.traverse(node => { if (node === existing || node.userData['vibi3dArchitectureOwner'] === formerOwner) replaceable.add(node); });
    const ids = new Set<string>();
    fresh.traverse(node => {
      const key = idOf(node); const conflict = find(key);
      if (ids.has(key) || (conflict && !replaceable.has(conflict))) throw new CreationUiError('object-id-exists');
      ids.add(key);
    });
    if (existing) fresh.name = name ?? existing.name;
    else if (name !== undefined) fresh.name = name;
    const result = existing ? reconcile(existing, fresh, id) : fresh;
    if (existing && existing.parent !== parent) parent.attach(result); else parent.add(result);
    if (position) result.position.fromArray(position);
    if (rotation) result.rotation.set(...rotation.map(THREE.MathUtils.degToRad) as [number, number, number]);
    result.updateMatrix(); refreshModelMetricUvs(result);
  } catch (error) { disposeModel(fresh); throw error; }
}
