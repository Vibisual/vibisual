import * as THREE from 'three';
import { parseCreationBlobRef, type CreationDoc, type CreationLink, type Vibi3DCommand, type Vibi3DMaterial, type Vibi3DMaterialMapSlot } from '@vibisual/shared';
import { creationIntentId } from '../Creation/creationApi.js';
import { creationBlobObject } from '../Creation/creationBlobs.js';
import { CreationUiError } from '../Creation/creationErrors.js';
import { loadImage } from '../Creation/imageRender.js';
import { readTextureSource, renderTextureSource, type RenderedTexture } from './modelImageLink.js';
import { modelTextureRole, pinModelTexture } from './modelTextureReferences.js';
import type { ModelMaterialTextures } from './modelMaterials.js';

function material(command: Vibi3DCommand): Vibi3DMaterial | undefined {
  if (command.type === 'sign' || command.type === 'decal' || command.type === 'mascot') {
    return command.source ? { maps: { map: { source: command.source } } } : undefined;
  }
  return command.type === 'material' || command.type === 'create' ? command.material : undefined;
}
export function hasExternalMaterialSources(commands: readonly Vibi3DCommand[]): boolean {
  return commands.some(command => Object.values(material(command)?.maps ?? {}).some(entry => entry.source.kind !== 'procedural'));
}
/** An agent may add a reference, but advancing an existing reference is exclusively a user operation. */
export function pinnedMaterialRevision(links: CreationLink[], sourceId: string, target: string, slot: Vibi3DMaterialMapSlot, root?: THREE.Object3D): number | undefined {
  const related = new Set([target]); let object: THREE.Object3D | undefined;
  root?.traverse(node => { if (node.userData['vibi3dId'] === target) object = node; });
  const include = (node: THREE.Object3D): void => { const id: unknown = node.userData['vibi3dId']; if (typeof id === 'string') related.add(id); };
  object?.traverse(include);
  for (let parent = object?.parent; parent; parent = parent.parent) include(parent);
  const revisions = new Set(links.filter(link => link.sourceId === sourceId && link.role === modelTextureRole(slot) && link.targets.some(id => related.has(id))).map(link => link.sourceRevision));
  if (revisions.size > 1) throw new CreationUiError('user-decision-required');
  if (revisions.size) return revisions.values().next().value;
  const known = links.filter(link => link.sourceId === sourceId && link.role.startsWith('model-texture')).map(link => link.sourceRevision);
  return known.length ? Math.max(...known) : undefined;
}
async function renderBlobTexture(projectId: string, ref: string): Promise<RenderedTexture> {
  const blob = parseCreationBlobRef(ref); if (!blob) throw new CreationUiError('unsupported-image-source');
  const url = URL.createObjectURL(await creationBlobObject(projectId, blob));
  try {
    const image = await loadImage(url);
    if (image.width > 4096 || image.height > 4096) throw new CreationUiError('source-too-large');
    const texture = new THREE.Texture(image); texture.source.uuid = creationIntentId('texture-blob', ref); texture.needsUpdate = true;
    return { texture, hasAlpha: ['png', 'webp', 'avif', 'gif', 'svg'].includes(blob.ext) };
  } finally { URL.revokeObjectURL(url); }
}
export interface PreparedMaterialSources {
  commands: Vibi3DCommand[];
  materialMaps: Record<number, ModelMaterialTextures>;
  dispose: () => void;
}
/** Resolve immutable images before applying the whole batch. No scene is changed while network reads are pending. */
export async function prepareMaterialSources(projectId: string, document: CreationDoc, commands: readonly Vibi3DCommand[], commandId: string, links = document.links, object?: THREE.Object3D): Promise<PreparedMaterialSources> {
  const next = structuredClone(commands) as Vibi3DCommand[];
  const materialMaps: Record<number, ModelMaterialTextures> = {};
  const owned = new Set<THREE.Texture>();
  const dispose = (): void => { for (const texture of owned) texture.dispose(); owned.clear(); };
  const sources = new Map<string, Promise<{ doc: CreationDoc; rendered: RenderedTexture }>>();
  try {
    for (const [index, command] of next.entries()) {
      const change = material(command);
      if (!change?.maps || (command.type !== 'create' && command.type !== 'material' && command.type !== 'sign' && command.type !== 'decal' && command.type !== 'mascot')) continue;
      const external = Object.entries(change.maps).filter(([, entry]) => entry.source.kind !== 'procedural');
      if (!external.length) continue;
      if (!command.id) command.id = creationIntentId('native-object', commandId, index);
      const target = command.id!;
      for (const [slotValue, entry] of external) {
        const slot = slotValue as Vibi3DMaterialMapSlot; const source = entry.source;
        let rendered: RenderedTexture;
        if (source.kind === 'vibimage') {
          const revision = pinnedMaterialRevision(links, source.docId, target, slot, object);
          const key = JSON.stringify([source.docId, revision]);
          let pending = sources.get(key);
          if (!pending) {
            pending = readTextureSource(projectId, source.docId, revision).then(async doc => {
              const image = await renderTextureSource(doc, projectId); owned.add(image.texture); return { doc, rendered: image };
            }); sources.set(key, pending);
          }
          const found = await pending;
          rendered = { ...found.rendered, texture: found.rendered.texture.clone() }; owned.add(rendered.texture);
          const prior = links.find(link => link.sourceId === source.docId && link.sourceRevision === found.doc.revision && link.role === modelTextureRole(slot) && link.targets.includes(target));
          const linkId = prior?.id ?? creationIntentId(modelTextureRole(slot), document.id, commandId, target, found.doc.id, found.doc.revision);
          pinModelTexture(rendered.texture, found.doc, target, slot, linkId);
        } else if (source.kind === 'blob') { rendered = await renderBlobTexture(projectId, source.ref); owned.add(rendered.texture); }
        else continue;
        if (slot === 'map' && rendered.hasAlpha && change.transparent === undefined) change.transparent = true;
        (materialMaps[index] ??= {})[slot] = rendered.texture;
      }
    }
    return { commands: next, materialMaps, dispose };
  } catch (error) { dispose(); throw error; }
}
