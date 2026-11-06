import * as THREE from 'three';
import { validateVibi3DMaterial, validateVibi3DRecipe, type Vibi3DMaterialMapSlot } from '@vibisual/shared';
import { creationIntentId } from '../Creation/creationApi.js';
import { cachedMaterialTexture, proceduralTexture, type MaterialPixelCache } from './modelProceduralTextures.js';
import { materialNoise, clamp01 } from './proceduralMaterialNoise.js';
import { normalizedSurfaceUvs } from './modelSurfaceUvs.js';

const ATLAS_SLOTS = ['map', 'aoMap'] as const;
const SURFACE_WEAR = { edgeMeters: 0.06, baseMeters: 0.38, dripMeters: 1.2, dripWidth: 0.065, colorStrength: 0.5, aoStrength: 0.28 };

function sample(data: Uint8Array, width: number, height: number, u: number, v: number, channel: number): number {
  const x = ((u % 1 + 1) % 1) * width - 0.5, y = ((v % 1 + 1) % 1) * height - 0.5;
  const left = Math.floor(x), bottom = Math.floor(y), tx = x - left, ty = y - bottom;
  const at = (a: number, b: number): number => data[(((b + height) % height) * width + (a + width) % width) * 4 + channel]!;
  return (at(left, bottom) * (1 - tx) + at(left + 1, bottom) * tx) * (1 - ty)
    + (at(left, bottom + 1) * (1 - tx) + at(left + 1, bottom + 1) * tx) * ty;
}

/** Architectural walls bake real opening runoff and footing dirt once, independently from repeating surface normals. */
export function refreshModelSurfaceWear(mesh: THREE.Mesh, scale: THREE.Vector3): void {
  if (mesh.userData['vibi3dArchitectureDetail'] !== 'architectural' || mesh.userData['vibi3dLocked']) return;
  const recipe = validateVibi3DRecipe(mesh.userData['vibi3dRecipe']);
  if (!recipe || recipe.kind !== 'wall') return;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const item of materials) {
    if (!(item instanceof THREE.MeshStandardMaterial) || !proceduralTexture(item.map) || item.map?.userData['vibi3dInteriorMap']) continue;
    const values = validateVibi3DMaterial(item.userData['vibi3dMaterial']);
    if (!values?.preset || !values.wear || values.maps?.map || item.userData['vibi3dCustomMaps']?.map) continue;
    const key = JSON.stringify([recipe, scale.toArray(), values]);
    if (item.userData['vibi3dSurfaceWear'] === key) continue;
    const width = (recipe.width ?? 1) * scale.x, height = (recipe.height ?? 1) * scale.y;
    const resolution = values.resolution ?? 512, pixelsX = Math.max(32, Math.round(resolution * Math.min(1, width / height)));
    const pixelsY = Math.max(32, Math.round(resolution * Math.min(1, height / width)));
    const tile = values.tileSize ?? [1, 1], angle = THREE.MathUtils.degToRad(values.rotation ?? 0), offset = values.offset ?? [0, 0];
    const masks = new Float32Array(pixelsX * pixelsY);
    for (let y = 0; y < pixelsY; y++) for (let x = 0; x < pixelsX; x++) {
      const px = (x + 0.5) / pixelsX * width, py = (y + 0.5) / pixelsY * height;
      const irregular = 0.45 + materialNoise(values.seed ?? 0, px / width, py / height, 23, 4, 401) * 0.55;
      let dirt = clamp01(1 - py / SURFACE_WEAR.baseMeters) * 0.42;
      dirt += clamp01(1 - Math.min(px, width - px, height - py) / SURFACE_WEAR.edgeMeters) * 0.12;
      for (const opening of recipe.openings ?? []) {
        const bottom = opening.y * scale.y, left = opening.x * scale.x, right = (opening.x + opening.w) * scale.x;
        const below = bottom - py;
        if (below < 0 || below > SURFACE_WEAR.dripMeters) continue;
        const corner = Math.min(Math.abs(px - left), Math.abs(px - right));
        const drip = Math.exp(-((corner / SURFACE_WEAR.dripWidth) ** 2)) * 0.9;
        const wash = px >= left && px <= right ? 0.12 : 0;
        dirt += (drip + wash) * (1 - below / SURFACE_WEAR.dripMeters) * irregular;
      }
      masks[y * pixelsX + x] = clamp01(dirt * values.wear);
    }
    const cache: MaterialPixelCache = new Map();
    for (const slot of ATLAS_SLOTS) {
      if (values.maps?.[slot] || item.userData['vibi3dCustomMaps']?.[slot]) continue;
      const base = cachedMaterialTexture(cache, slot, { kind: 'procedural', preset: values.preset, seed: values.seed, wear: values.wear, params: values.params, resolution: values.resolution }, values) as THREE.DataTexture;
      const pixels = base.image.data as Uint8Array, data = new Uint8Array(pixelsX * pixelsY * 4);
      for (let y = 0; y < pixelsY; y++) for (let x = 0; x < pixelsX; x++) {
        const u = ((x + 0.5) / pixelsX * width - width / 2) / tile[0], v = (y + 0.5) / pixelsY * height / tile[1];
        const tu = Math.cos(angle) * u + Math.sin(angle) * v + offset[0], tv = -Math.sin(angle) * u + Math.cos(angle) * v + offset[1];
        const index = y * pixelsX + x, shade = 1 - masks[index]! * (slot === 'map' ? SURFACE_WEAR.colorStrength : SURFACE_WEAR.aoStrength);
        for (let channel = 0; channel < 3; channel++) data[index * 4 + channel] = Math.round(sample(pixels, base.image.width, base.image.height, tu, tv, channel) * shade);
        data[index * 4 + 3] = 255;
      }
      const texture = new THREE.DataTexture(data, pixelsX, pixelsY, THREE.RGBAFormat, THREE.UnsignedByteType);
      texture.userData = { vibi3dProceduralVersion: 2 }; texture.channel = 3;
      texture.uuid = creationIntentId('surface-wear', mesh.uuid, key, slot); texture.source.uuid = creationIntentId('surface-wear-pixels', key, slot);
      texture.colorSpace = slot === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.anisotropy = 8; texture.needsUpdate = true;
      item[slot as Vibi3DMaterialMapSlot] = texture;
    }
    mesh.geometry = normalizedSurfaceUvs(mesh.geometry, 3); item.userData['vibi3dSurfaceWear'] = key; item.needsUpdate = true;
  }
}
