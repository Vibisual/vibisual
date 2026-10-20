import * as THREE from 'three';
import { VIBI3D_MATERIAL_MAP_SLOTS, type Vibi3DArchitectureDetail, type Vibi3DMaterial, type Vibi3DMaterialPreset, type Vibi3DRecipe, type Vibi3DVec3 } from '@vibisual/shared';
import { creationIntentId } from '../Creation/creationApi.js';
import { createModelMaterial } from './modelMaterials.js';
import { makeGeometry } from './modelGeometry.js';
import { ARCHITECTURAL_DETAIL as A } from './architectureDetailConfig.js';
import { configureMaterialTexture } from './modelProceduralTextures.js';

export const ARCHITECTURE_DETAILS = {
  slab: 0.2, wall: 0.18, frame: 0.07, sill: 0.1, glass: 0.025, rail: 0.045, pipe: 0.035,
  facade: { width: 12, floors: 4, ground: 4.2, upper: 3.1, bays: 3, windowDepth: 0.18, band: 0.18, eaves: 0.24, acDensity: 0.25, windowRatio: 0.8, sillHeight: 0.85, headHeight: 0.4 },
  storefront: { width: 4, height: 4.2, depth: 0.35, signBand: 0.65, doorWidth: 0.95, awningDepth: 1.3, awningDrop: 0.3, awningHeight: 3.0, colors: ['#b83636', '#f4eee2'] as [string, string] },
  roof: { width: 12, depth: 9, railingHeight: 1.1, tankRadius: 0.8, tankHeight: 1.8 },
  street: { length: 18, road: 6, sidewalk: 3, kerb: 0.15, colors: ['#d9d9d0', '#8b8e8d'] as [string, string] },
  colors: { interior: '#414b50', greenery: '#567448', soil: '#4a3827', ceramic: '#a56f4d', marking: '#ecebe2', fixture: '#f8efce' },
} as const;

/** Generated identities describe a semantic part, never a position in Object3D.children. */
export class ArchitectureParts {
  readonly root = new THREE.Group();
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  constructor(readonly id: string, readonly detail: Vibi3DArchitectureDetail = 'draft') { this.identify(this.root, 'root'); this.root.userData['vibi3dId'] = id; }
  get detailed(): boolean { return this.detail === 'architectural'; }
  private identify<T extends THREE.Object3D>(object: T, path: string): T {
    object.uuid = creationIntentId('architecture-node', this.id, path);
    object.name = path.split('/').at(-1)!;
    object.userData['vibi3dId'] = path === 'root' ? this.id : creationIntentId('architecture-part', this.id, path);
    object.userData['vibi3dArchitectureOwner'] = this.id;
    object.userData['vibi3dArchitecturePath'] = path;
    object.userData['vibi3dArchitectureKey'] = path;
    if (this.detailed) object.userData['vibi3dArchitectureDetail'] = 'architectural';
    return object;
  }
  private path(parent: THREE.Object3D, key: string): string { return `${parent.userData['vibi3dArchitecturePath']}/${key}`; }
  group(parent: THREE.Object3D, key: string, position: Vibi3DVec3 = [0, 0, 0]): THREE.Group {
    const group = this.identify(new THREE.Group(), this.path(parent, key)); group.position.fromArray(position); parent.add(group); return group;
  }
  material(preset: Vibi3DMaterialPreset, settings: Vibi3DMaterial = {}): THREE.MeshStandardMaterial {
    const recipe: Vibi3DMaterial = { preset, wear: 0.3, seed: 0, ...settings };
    const { rotation: _rotation, offset: _offset, ...pixels } = recipe;
    const key = creationIntentId('architecture-material-v1', pixels);
    let prototype = this.materials.get(key);
    if (!prototype) {
      prototype = createModelMaterial(pixels); Object.assign(prototype, { uuid: key });
      for (const slot of VIBI3D_MATERIAL_MAP_SLOTS) {
        const texture = prototype[slot]; if (!texture) continue;
        texture.uuid = creationIntentId('architecture-texture-v1', key, slot);
      }
      this.materials.set(key, prototype);
    }
    const material = prototype.clone();
    const values: Vibi3DMaterial = { ...material.userData['vibi3dMaterial'], ...recipe };
    material.userData['vibi3dMaterial'] = structuredClone(values);
    for (const slot of VIBI3D_MATERIAL_MAP_SLOTS) if (prototype[slot]) {
      const texture = prototype[slot]!.clone(); texture.uuid = creationIntentId('architecture-map-transform', key, slot, values.tileSize, values.rotation, values.offset);
      configureMaterialTexture(texture, slot, values); material[slot] = texture;
    }
    return material;
  }
  mesh(parent: THREE.Object3D, key: string, recipe: Vibi3DRecipe, position: Vibi3DVec3,
    preset: Vibi3DMaterialPreset, settings?: Vibi3DMaterial): THREE.Mesh {
    const mesh = this.bufferMesh(parent, key, makeGeometry(recipe), recipe, position, preset, settings);
    mesh.userData['vibi3dRecipe'] = structuredClone(recipe); return mesh;
  }
  /** Composite native parts retain their own exact generator input, rather than impersonating a primitive recipe. */
  bufferMesh(parent: THREE.Object3D, key: string, geometry: THREE.BufferGeometry, input: unknown, position: Vibi3DVec3,
    preset: Vibi3DMaterialPreset, settings?: Vibi3DMaterial): THREE.Mesh {
    const path = this.path(parent, key), material = this.material(preset, settings);
    Object.assign(geometry, { uuid: creationIntentId('architecture-geometry', this.id, path, input) });
    Object.assign(material, { uuid: creationIntentId('architecture-material', this.id, path) });
    const mesh = this.identify(new THREE.Mesh(geometry, material), path); mesh.position.fromArray(position); parent.add(mesh); return mesh;
  }
  box(parent: THREE.Object3D, key: string, size: Vibi3DVec3, position: Vibi3DVec3, preset: Vibi3DMaterialPreset = 'painted-concrete', settings?: Vibi3DMaterial): THREE.Mesh {
    return this.mesh(parent, key, { kind: 'box', width: size[0], height: size[1], depth: size[2] }, position, preset, settings);
  }
  roundedBox(parent: THREE.Object3D, key: string, size: Vibi3DVec3, position: Vibi3DVec3, preset: Vibi3DMaterialPreset = 'aluminium', settings?: Vibi3DMaterial, radius: number = A.edge.radius): THREE.Mesh {
    return this.mesh(parent, key, { kind: 'roundedBox', width: size[0], height: size[1], depth: size[2],
      bevelRadius: Math.min(radius, Math.min(...size) * A.edge.maximumFraction), bevelSegments: A.edge.segments }, position, preset, settings);
  }
  cylinder(parent: THREE.Object3D, key: string, radius: number, height: number, position: Vibi3DVec3, preset: Vibi3DMaterialPreset = 'aluminium', radiusTop = radius): THREE.Mesh {
    return this.mesh(parent, key, { kind: 'cylinder', radius, radiusTop, height }, position, preset);
  }
  sphere(parent: THREE.Object3D, key: string, radius: number, position: Vibi3DVec3, preset: Vibi3DMaterialPreset, settings?: Vibi3DMaterial): THREE.Mesh {
    return this.mesh(parent, key, { kind: 'sphere', radius }, position, preset, settings);
  }
  pathMesh(parent: THREE.Object3D, key: string, points: Vibi3DVec3[], tube: number, preset: Vibi3DMaterialPreset = 'aluminium'): THREE.Mesh {
    return this.mesh(parent, key, { kind: 'path', points, tube }, [0, 0, 0], preset);
  }
}
