import * as THREE from 'three';
import { VIBI3D_MATERIAL_MAP_SLOTS, type CreationLink, type Vibi3DMaterialMapSlot } from '@vibisual/shared';
import { creationIntentId } from '../Creation/creationApi.js';

export const MODEL_TEXTURE_ROLE = 'model-texture';
export function modelTextureRole(slot: Vibi3DMaterialMapSlot): string { return slot === 'map' ? MODEL_TEXTURE_ROLE : `${MODEL_TEXTURE_ROLE}:${slot}`; }
export function modelTextureSlot(role: string): Vibi3DMaterialMapSlot | null {
  if (role === MODEL_TEXTURE_ROLE) return 'map';
  const slot = role.slice(MODEL_TEXTURE_ROLE.length + 1);
  return role.startsWith(`${MODEL_TEXTURE_ROLE}:`) && (VIBI3D_MATERIAL_MAP_SLOTS as readonly string[]).includes(slot) ? slot as Vibi3DMaterialMapSlot : null;
}
interface TexturePin { docId: string; revision: number; linkId: string; target: string; slot: Vibi3DMaterialMapSlot }
export function pinModelTexture(texture: THREE.Texture, source: { id: string; revision: number }, target: string, slot: Vibi3DMaterialMapSlot, linkId: string): void {
  texture.source.uuid = creationIntentId('texture-image', source.id, source.revision);
  texture.userData['vibi3dSource'] = { docId: source.id, revision: source.revision, linkId, target, slot } satisfies TexturePin;
  texture.uuid = creationIntentId('texture', linkId, target, slot);
}
function pin(texture: THREE.Texture): TexturePin | null {
  const value = texture.userData['vibi3dSource'] as Partial<TexturePin> | undefined;
  return value && typeof value.docId === 'string' && Number.isInteger(value.revision) && value.revision! > 0
    && typeof value.linkId === 'string' && typeof value.target === 'string' && (VIBI3D_MATERIAL_MAP_SLOTS as readonly unknown[]).includes(value.slot)
    ? value as TexturePin : null;
}
function ancestors(object: THREE.Object3D): string[] {
  const result: string[] = [];
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    const id: unknown = node.userData['vibi3dId']; if (typeof id === 'string') result.push(id);
  }
  return result;
}
/** Derive links from the actual texture state, including undo/redo and duplicate, without mutating locked nodes. */
export function modelTextureReferences(object: THREE.Object3D, previous: CreationLink[]): CreationLink[] {
  const found = new Map<string, CreationLink>();
  object.traverse(child => {
    // GPU buckets are derived from prototypes. Keep source links on editable data, never transient render copies.
    for (let parent: THREE.Object3D | null = child; parent; parent = parent.parent) if (parent.userData['vibi3dKitBucket']) return;
    const targets = ancestors(child); if (!targets.length) return;
    const materials = (child as THREE.Mesh).material;
    for (const material of Array.isArray(materials) ? materials : materials ? [materials] : []) {
      for (const slot of VIBI3D_MATERIAL_MAP_SLOTS) {
        if (slot === 'emissiveMap' && material.userData['vibi3dLinkedEmission']) continue;
        const texture = (material as unknown as Record<string, unknown>)[slot]; if (!(texture instanceof THREE.Texture)) continue;
        const source = pin(texture);
        const old = previous.find(link => modelTextureSlot(link.role) === slot && link.targets.some(target => targets.includes(target))
          && texture.source.uuid === creationIntentId('texture-image', link.sourceId, link.sourceRevision));
        const target = source && targets.includes(source.target) ? source.target : old?.targets.find(id => targets.includes(id)) ?? targets[0]!;
        const link: CreationLink | null = source ? { id: source.linkId, sourceId: source.docId, sourceRevision: source.revision, role: modelTextureRole(slot), targets: [] }
          : old ? { ...old, targets: [] } : null;
        if (!link) continue;
        const existing = found.get(link.id) ?? link;
        if (!existing.targets.includes(target)) existing.targets.push(target);
        found.set(link.id, existing);
      }
    }
  });
  return [...previous.filter(link => modelTextureSlot(link.role) === null), ...found.values()];
}
