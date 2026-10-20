import * as THREE from 'three';
import { VIBI3D_MATERIAL_MAP_SLOTS, type Vibi3DMaterial, type Vibi3DMaterialPreset } from '@vibisual/shared';
import { creationIntentId } from '../Creation/creationApi.js';
import { createModelMaterial } from './modelMaterials.js';

/** Semantic part identities let regeneration keep selected glyphs, locks and manually added children. */
export class SignParts {
  readonly root = new THREE.Group();
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  constructor(readonly id: string) { this.identify(this.root, 'root'); }
  private identify(object: THREE.Object3D, key: string): void {
    object.uuid = creationIntentId('sign-node', this.id, key); object.name = key;
    object.userData = { vibi3dId: key === 'root' ? this.id : creationIntentId('sign-part', this.id, key), vibi3dDecorationOwner: this.id, vibi3dDecorationKey: key };
  }
  material(key: string, preset: Vibi3DMaterialPreset, settings: Vibi3DMaterial = {}): THREE.MeshStandardMaterial {
    const recipe = { preset, seed: 0, wear: 0.12, ...settings }, cacheKey = JSON.stringify(recipe);
    let base = this.materials.get(cacheKey); if (!base) { base = createModelMaterial(recipe); this.materials.set(cacheKey, base); }
    const material = base.clone();
    Object.assign(material, { uuid: creationIntentId('sign-material', this.id, key, recipe) });
    for (const slot of VIBI3D_MATERIAL_MAP_SLOTS) if (material[slot]) {
      material[slot] = material[slot]!.clone();
      material[slot]!.uuid = creationIntentId('sign-map', this.id, key, slot, recipe); material[slot]!.source.uuid = creationIntentId('sign-pixels', recipe, slot);
    }
    return material;
  }
  mesh(key: string, geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number] = [0, 0, 0], image = false): THREE.Mesh {
    // BufferGeometry keeps authored UVs and channel contours independent of parameterized geometry serializers.
    const stable = new THREE.BufferGeometry().copy(geometry); stable.uuid = creationIntentId('sign-geometry', this.id, key, Array.from(stable.getAttribute('position').array));
    const mesh = new THREE.Mesh(stable, material); this.identify(mesh, key); mesh.position.fromArray(position);
    if (image) mesh.userData['vibi3dUvMode'] = 'image'; this.root.add(mesh); return mesh;
  }
  box(key: string, size: [number, number, number], position: [number, number, number], preset: Vibi3DMaterialPreset = 'aluminium'): THREE.Mesh {
    return this.mesh(key, new THREE.BoxGeometry(...size), this.material(key, preset), position);
  }
}
