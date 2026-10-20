import * as THREE from 'three';
import { VIBI3D_LIMITS, type Vibi3DKitCommand } from '@vibisual/shared';
import { CreationUiError } from '../Creation/creationErrors.js';
import { buildModelKitBuiltin } from './modelKitBuiltins.js';
import { cloneKitPrototype } from './modelKitPrototype.js';
import { placeKitModule } from './modelKitPlacement.js';
import { assertKitUnlocked, findKitObject, isModelKitInternal, kitLibrary, kitPlacements, modelKitId, readModelKitModules } from './modelKitMetadata.js';
export { isModelKitInternal, readModelKitModules } from './modelKitMetadata.js';
export { refreshModelKit, updateModelKitMatrices } from './modelKitRender.js';

export function modelKitLockTargets(root: THREE.Object3D, command: Vibi3DKitCommand): { id: string; subtree: boolean }[] {
  if (command.type === 'stats') return [];
  if (command.type === 'kitModule') return [{ id: modelKitId(root), subtree: false }, ...kitPlacements(root, command.id).map(node => ({ id: modelKitId(node), subtree: true }))];
  const existing = findKitObject(root, command.id);
  return [{ id: command.parentId ?? modelKitId(existing?.parent ?? root), subtree: false }, ...(existing ? [{ id: command.id, subtree: true }] : [])];
}

/** Logical edits only. The editor validates/rolls back the batch and calls refreshModelKit once after all commands. */
export function applyModelKit(root: THREE.Object3D, command: Vibi3DKitCommand): string {
  if (command.type === 'stats') return modelKitId(root);
  const modules = readModelKitModules(root);
  if (command.type !== 'kitModule') {
    const module = modules.find(value => value.id === command.moduleId); if (!module) throw new CreationUiError('kit-module-missing');
    if (command.expectedModuleRevision !== undefined && command.expectedModuleRevision !== module.revision) throw new CreationUiError('kit-module-changed');
    return placeKitModule(root, module, command);
  }
  const previous = modules.find(module => module.id === command.id);
  if (previous ? command.expectedModuleRevision !== previous.revision : command.expectedModuleRevision !== undefined) throw new CreationUiError('kit-module-changed');
  if (!previous && modules.length >= VIBI3D_LIMITS.modules) throw new CreationUiError('kit-placement-limit');
  for (const placement of kitPlacements(root, command.id)) assertKitUnlocked(placement);
  if (root.userData['vibi3dLocked']) throw new CreationUiError('object-protected');
  const source = command.builtin ? buildModelKitBuiltin(command.builtin, command.id) : findKitObject(root, command.sourceId!);
  if (!source) throw new CreationUiError('object-missing');
  if (source === root || isModelKitInternal(source)) throw new CreationUiError('kit-nested-module');
  const { object, partCount } = cloneKitPrototype(source, command.id), library = kitLibrary(root);
  if (previous) library.children.find(node => modelKitId(node) === previous.prototypeId)?.removeFromParent();
  library.add(object);
  const next = { id: command.id, name: command.name ?? previous?.name ?? command.builtin ?? (source.name || command.id),
    revision: (previous?.revision ?? 0) + 1, prototypeId: modelKitId(object), partCount, ...(command.builtin ? { builtin: command.builtin } : {}) };
  root.userData['vibi3dKitModules'] = previous ? modules.map(module => module.id === previous.id ? next : module) : [...modules, next];
  return command.id;
}
