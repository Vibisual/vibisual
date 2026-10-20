import * as THREE from 'three';
import type { Vibi3DMascotRecipe, Vibi3DMaterial, Vibi3DRecipe, Vibi3DVec3 } from '@vibisual/shared';
import { creationIntentId } from '../Creation/creationApi.js';
import { makeGeometry } from './modelGeometry.js';
import { createModelMaterial } from './modelMaterials.js';

class MascotParts {
  readonly root = new THREE.Group();
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  constructor(private readonly id: string) { this.root.userData['vibi3dId'] = id; }
  add(key: string, recipe: Vibi3DRecipe, position: Vibi3DVec3, material: Vibi3DMaterial): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
    const signature = JSON.stringify(material);
    let surface = this.materials.get(signature);
    if (!surface) { surface = createModelMaterial(material); this.materials.set(signature, surface); }
    const geometry = makeGeometry(recipe); geometry.uuid = creationIntentId('mascot-geometry', this.id, key, recipe);
    const object = new THREE.Mesh(geometry, surface.clone());
    object.uuid = creationIntentId('mascot-object', this.id, key); object.name = key;
    object.userData = { vibi3dId: creationIntentId('mascot-part', this.id, key), vibi3dMascotOwner: this.id, vibi3dMascotPart: key, vibi3dRecipe: structuredClone(recipe) };
    object.position.fromArray(position); this.root.add(object); return object;
  }
}

/** An original friendly round figure assembled from editable native shapes; no generated or downloaded assets. */
export function buildRoundMascot(recipe: Vibi3DMascotRecipe, id: string): THREE.Group {
  const parts = new MascotParts(id), unit = (recipe.height ?? 1.6) / 0.98;
  const body = recipe.colors?.body ?? '#e9b34b', accent = recipe.colors?.accent ?? '#507f91', face = recipe.colors?.face ?? '#252c36';
  const plastic = (color: string): Vibi3DMaterial => ({ preset: 'plastic', params: { color }, wear: 0.08, seed: 13, physical: { clearcoat: 0.6 }, tileSize: [0.5, 0.5] });
  const add = (key: string, geometry: Vibi3DRecipe, position: Vibi3DVec3, material: Vibi3DMaterial): THREE.Mesh => {
    const scaled = { ...geometry };
    for (const key of ['width', 'height', 'depth', 'radius', 'bevelRadius', 'tube'] as const) if (scaled[key] !== undefined) scaled[key] = scaled[key]! * unit;
    if (scaled.points) scaled.points = scaled.points.map(point => point.map(value => value * unit) as Vibi3DVec3);
    return parts.add(key, scaled, position.map(value => value * unit) as Vibi3DVec3, material);
  };
  add('body', { kind: 'capsule', radius: 0.2, height: 0.5 }, [0, 0.4, 0], { preset: 'awning-fabric', seed: 21, wear: 0.12,
    params: { color: accent, secondaryColor: accent, accentColor: '#f0e7d5', normalStrength: 0.4 }, tileSize: [0.3, 0.3] });
  add('head', { kind: 'sphere', radius: 0.23 }, [0, 0.75, 0], plastic(body));
  for (const side of [-1, 1] as const) {
    const key = side < 0 ? 'left' : 'right';
    add(`${key}-shoe`, { kind: 'roundedBox', width: 0.19, height: 0.12, depth: 0.28, bevelRadius: 0.05, bevelSegments: 3 }, [side * 0.115, 0.06, 0.03], plastic(accent));
    const arm = add(`${key}-arm`, { kind: 'capsule', radius: 0.055, height: 0.32 }, [side * 0.265, 0.43, 0], plastic(body)); arm.rotation.z = side * 0.28;
    add(`${key}-eye`, { kind: 'sphere', radius: 0.027 }, [side * 0.082, 0.78, 0.21], plastic(face));
    const cheek = add(`${key}-cheek`, { kind: 'sphere', radius: 0.035 }, [side * 0.135, 0.714, 0.187], plastic('#d37c65')); cheek.scale.set(1, 0.55, 0.3);
  }
  add('smile', { kind: 'path', tube: 0.008, points: [[-0.06, 0.7, 0.219], [0, 0.68, 0.226], [0.06, 0.7, 0.219]] }, [0, 0, 0], plastic(face));
  return parts.root;
}

export function buildStandeeMascot(recipe: Vibi3DMascotRecipe, id: string, texture: THREE.Texture): THREE.Group {
  const parts = new MascotParts(id), height = recipe.height ?? 1.6;
  const image = texture.image as { width?: number; height?: number } | undefined;
  const aspect = image?.width && image.height ? Math.min(10, Math.max(0.1, image.width / image.height)) : 1;
  const imageMesh = parts.add('image', { kind: 'plane', width: height * aspect, height }, [0, height / 2, 0], { color: '#ffffff' });
  imageMesh.material.dispose();
  imageMesh.material = createModelMaterial({ color: '#ffffff', roughness: 0.7, maps: { map: { source: recipe.source! } }, transparent: true, alphaTest: 0.05, side: 'double' }, { map: texture });
  imageMesh.material.map!.wrapS = imageMesh.material.map!.wrapT = THREE.ClampToEdgeWrapping;
  const pin: unknown = imageMesh.material.map!.userData['vibi3dSource'];
  if (pin && typeof pin === 'object') imageMesh.material.map!.userData['vibi3dSource'] = { ...pin, target: imageMesh.userData['vibi3dId'] };
  imageMesh.userData['vibi3dUvMode'] = 'image'; imageMesh.userData['vibi3dDecal'] = true;
  parts.add('base', { kind: 'cylinder', radius: Math.max(height * 0.12, height * aspect * 0.18), height: height * 0.05 }, [0, height * 0.025, 0],
    { preset: 'plastic', params: { color: recipe.colors?.accent ?? '#507f91' }, wear: 0.12, seed: 7 });
  return parts.root;
}
