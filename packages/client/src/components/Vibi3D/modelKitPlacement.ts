import * as THREE from 'three';
import type { Vibi3DKitCommand, Vibi3DKitModule, Vibi3DInstance } from '@vibisual/shared';
import { creationIntentId } from '../Creation/creationApi.js';
import { CreationUiError } from '../Creation/creationErrors.js';
import { assertKitUnlocked, findKitObject, isModelKitInternal, modelKitId } from './modelKitMetadata.js';

type PlacementCommand = Extract<Vibi3DKitCommand, { type: 'place' | 'array' }>;
function snapped(value: number, snap: false | number | undefined): number { return snap === false ? value : Math.round(value / (snap ?? 0.25)) * (snap ?? 0.25); }
function newGroup(id: string): THREE.Group {
  const group = new THREE.Group(); group.uuid = creationIntentId('kit-placement', id); group.name = id; group.userData['vibi3dId'] = id; return group;
}

/** Arrays use integer lattice coordinates as persistent identities, independently of GPU ordering. */
export function placeKitModule(root: THREE.Object3D, module: Vibi3DKitModule, command: PlacementCommand): string {
  let object = findKitObject(root, command.id);
  if (object && (isModelKitInternal(object) || !object.userData[command.type === 'array' ? 'vibi3dArray' : 'vibi3dInstance'])) throw new CreationUiError('object-id-exists');
  const parent = command.parentId ? findKitObject(root, command.parentId) : object?.parent ?? root;
  if (!parent) throw new CreationUiError('object-missing');
  if (isModelKitInternal(parent)) throw new CreationUiError('kit-nested-module');
  for (let node: THREE.Object3D | null = parent; node; node = node.parent) if (node === object || node.userData['vibi3dInstance']) throw new CreationUiError('kit-nested-module');
  if (object) assertKitUnlocked(object);
  // Adding a sibling to a locked branch is allowed; the new parent and its ancestors must themselves be unlocked.
  for (let node: THREE.Object3D | null = parent; node; node = node.parent) if (node.userData['vibi3dLocked']) throw new CreationUiError('object-protected');
  object ??= newGroup(command.id); if (object.parent !== parent) parent.add(object);
  if (command.position) object.position.set(...command.position.map(value => snapped(value, command.snap)) as [number, number, number]);
  if (command.rotation) object.rotation.set(...command.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]);
  if (command.scale) object.scale.fromArray(command.scale);
  if (command.type === 'place') {
    const previous = object.userData['vibi3dInstance'] as Vibi3DInstance | undefined;
    object.userData['vibi3dInstance'] = { moduleId: module.id, moduleRevision: module.revision, placementId: command.id,
      ...(previous?.cell && previous.arrayId ? { cell: previous.cell, arrayId: previous.arrayId } : {}) } satisfies Vibi3DInstance;
    return command.id;
  }
  object.userData['vibi3dArray'] = { moduleId: module.id, moduleRevision: module.revision, counts: [...command.counts], step: [...command.step], snap: command.snap ?? 0.25 };
  // Regrouping does not erase array ownership: reuse the original cell and honor its new parent's locks.
  const old = new Map<string, THREE.Object3D>(), occupied = new Set<string>();
  root.traverse(node => {
    occupied.add(modelKitId(node));
    const instance = node.userData['vibi3dInstance'] as Vibi3DInstance | undefined;
    if (instance?.arrayId === command.id && instance.cell) { assertKitUnlocked(node); old.set(instance.cell.join(','), node); }
  });
  const held = new Set<THREE.Object3D>();
  for (let x = 0; x < command.counts[0]; x++) for (let y = 0; y < command.counts[1]; y++) for (let z = 0; z < command.counts[2]; z++) {
    const key = [x, y, z].join(','), cellId = creationIntentId('kit-cell', command.id, x, y, z);
    if (!old.has(key) && occupied.has(cellId)) throw new CreationUiError('object-id-exists');
    const cell = old.get(key) ?? newGroup(cellId);
    cell.name = `${module.name} (${x}, ${y}, ${z})`; cell.position.set(snapped(x * command.step[0], command.snap), snapped(y * command.step[1], command.snap), snapped(z * command.step[2], command.snap));
    cell.userData['vibi3dInstance'] = { moduleId: module.id, moduleRevision: module.revision, placementId: modelKitId(cell), arrayId: command.id, cell: [x, y, z] } satisfies Vibi3DInstance;
    object.add(cell); held.add(cell);
  }
  root.updateWorldMatrix(true, true);
  for (const cell of old.values()) if (!held.has(cell)) {
    for (const child of [...cell.children]) object.attach(child);
    cell.removeFromParent();
  }
  return command.id;
}
