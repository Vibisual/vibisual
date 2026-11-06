import * as THREE from 'three';
import { generateSurfaceWearPixels, type SurfaceWearInput } from '@vibisual/compute';
import { validateVibi3DMaterial, validateVibi3DRecipe } from '@vibisual/shared';
import { creationIntentId } from '../Creation/creationApi.js';
import { cachedMaterialTexture, deferMaterialGeneration, proceduralTexture, type MaterialPixelCache } from './modelProceduralTextures.js';
import { generateSurfaceWearAsync } from './proceduralMaterialWorkerClient.js';
import { normalizedSurfaceUvs } from './modelSurfaceUvs.js';

const ATLAS_SLOTS = ['map', 'aoMap'] as const;
const pendingWear = new WeakMap<THREE.Material, { key: string }>();

/** Base pixels and dependent atlases finish inside the editor transaction before rendering/history. */
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
    if (item.userData['vibi3dSurfaceWear'] === key || pendingWear.get(item)?.key === key) continue;
    const width = (recipe.width ?? 1) * scale.x, height = (recipe.height ?? 1) * scale.y;
    const resolution = values.resolution ?? 512, pixelsX = Math.max(32, Math.round(resolution * Math.min(1, width / height)));
    const pixelsY = Math.max(32, Math.round(resolution * Math.min(1, height / width)));
    const tile = values.tileSize ?? [1, 1], angle = THREE.MathUtils.degToRad(values.rotation ?? 0), offset = values.offset ?? [0, 0];
    const cache: MaterialPixelCache = new Map();
    const bases = ATLAS_SLOTS.map(slot => cachedMaterialTexture(cache, slot, { kind: 'procedural', preset: values.preset!, seed: values.seed,
      wear: values.wear, params: values.params, resolution: values.resolution }, values) as THREE.DataTexture);
    const input = (): SurfaceWearInput => ({ bases: [bases[0]!.image.data as Uint8Array, bases[1]!.image.data as Uint8Array],
      baseWidth: bases[0]!.image.width, baseHeight: bases[0]!.image.height, pixelsX, pixelsY, width, height, tile, angle, offset,
      wear: values.wear!, seed: values.seed ?? 0, openings: recipe.openings ?? [], scale: [scale.x, scale.y] });
    const install = (pixels: [Uint8Array, Uint8Array]): void => {
      for (const [index, slot] of ATLAS_SLOTS.entries()) {
        if (values.maps?.[slot] || item.userData['vibi3dCustomMaps']?.[slot]) continue;
        const texture = new THREE.DataTexture(pixels[index]!, pixelsX, pixelsY, THREE.RGBAFormat, THREE.UnsignedByteType);
        texture.userData = { vibi3dProceduralVersion: 2 }; texture.channel = 3;
        texture.uuid = creationIntentId('surface-wear', mesh.uuid, key, slot); texture.source.uuid = creationIntentId('surface-wear-pixels', key, slot);
        texture.colorSpace = slot === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.anisotropy = 8; texture.needsUpdate = true;
        item[slot] = texture;
      }
      mesh.geometry = normalizedSurfaceUvs(mesh.geometry, 3); item.userData['vibi3dSurfaceWear'] = key; item.needsUpdate = true;
    };
    const token = { key }; pendingWear.set(item, token);
    const settled = (): void => { if (pendingWear.get(item) === token) pendingWear.delete(item); };
    if (!deferMaterialGeneration(async () => {
      const pixels = await generateSurfaceWearAsync(input()); return () => install(pixels);
    }, settled)) {
      try { install(generateSurfaceWearPixels(input())); } finally { settled(); }
    }
  }
}
