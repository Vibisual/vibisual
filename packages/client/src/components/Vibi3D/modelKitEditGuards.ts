import type * as THREE from 'three';
import type { Vibi3DCommand } from '@vibisual/shared';
import { CreationUiError } from '../Creation/creationErrors.js';
import { assertKitUnlocked, isModelKitInternal, kitPlacements, modelKitId, readModelKitModules } from './modelKitMetadata.js';

/** A normal subtree edit must not silently change private prototypes or bypass module revisions. */
export function modelKitEditGuards(root: THREE.Object3D, command: Vibi3DCommand,
  find: (id: string) => THREE.Object3D | undefined, sourceLinkUpdate: boolean): string[] {
  if (command.type === 'shotRemove') return []; // Shot ids belong to root metadata, not editable object ids.
  const references = 'id' in command && command.id ? [command.id] : command.type === 'group' ? [...command.ids] : [];
  if ('parentId' in command && command.parentId) references.push(command.parentId);
  if (command.type === 'decal' && command.target) references.push(command.target);
  const changed = new Set<string>(), modules = readModelKitModules(root);
  const materialEdit = command.type === 'material' || command.type === 'update' && (command.color !== undefined || command.shadows !== undefined);
  for (const id of references) {
    const target = find(id); if (!target) continue;
    const privateNodes: THREE.Object3D[] = [];
    if (materialEdit) target.traverse(node => { if (isModelKitInternal(node)) privateNodes.push(node); });
    else if (isModelKitInternal(target)) privateNodes.push(target);
    if (!privateNodes.length) continue;
    if (!sourceLinkUpdate || command.type !== 'material') throw new CreationUiError('kit-nested-module');
    // SourceConnections is the sole user operation allowed to advance a prototype's pinned image.
    for (const node of privateNodes) {
      let prototype: THREE.Object3D | null = node;
      while (prototype && !prototype.userData['vibi3dKitPrototype']) prototype = prototype.parent;
      if (!prototype) continue; // Derived GPU copies are replaced when the module refreshes.
      const module = modules.find(value => value.prototypeId === modelKitId(prototype!));
      if (!module) throw new CreationUiError('kit-module-missing');
      changed.add(module.id);
    }
    if (!changed.size) throw new CreationUiError('kit-nested-module');
  }
  for (const moduleId of changed) for (const placement of kitPlacements(root, moduleId)) assertKitUnlocked(placement);
  return [...changed];
}

export function assertStaticKitSource(source: THREE.Object3D | undefined, clips: THREE.AnimationClip[]): void {
  if (!source || !clips.length) return;
  const names = new Set<string>(); source.traverse(node => { names.add(node.uuid); if (node.name) names.add(node.name); });
  if (clips.some(clip => clip.tracks.some(track => [...names].some(name => track.name.startsWith(`${name}.`) || track.name.startsWith(`${name}/`))))) {
    throw new CreationUiError('kit-instance-animation');
  }
}
