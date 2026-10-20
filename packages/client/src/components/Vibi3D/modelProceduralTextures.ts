import * as THREE from 'three';
import type { Vibi3DMaterial, Vibi3DMaterialMapSlot, Vibi3DMaterialMapSource } from '@vibisual/shared';
import { generateMaterialMaps, materialPresetProperties, type GeneratedMaterialMaps } from './proceduralMaterialPixels.js';
import { creationIntentId } from '../Creation/creationApi.js';

type Source = Extract<Vibi3DMaterialMapSource, { kind: 'procedural' }>;
type Textures = Partial<Record<Vibi3DMaterialMapSlot, THREE.Texture>>;
export type MaterialPixelCache = Map<string, { pixels: GeneratedMaterialMaps; textures: Textures }>;
type PixelEntry = MaterialPixelCache extends Map<string, infer T> ? T : never;
const SHARED_PIXEL_BYTES = 64 * 1024 * 1024;
const sharedPixels: MaterialPixelCache = new Map();
// A live scene Source keeps its bake discoverable after LRU eviction, without retaining closed documents.
const liveSources = new WeakMap<THREE.Source<unknown>, PixelEntry>();
const livePixels = new Map<string, WeakRef<PixelEntry>>();
const collectedPixels = new FinalizationRegistry<string>(key => { if (!livePixels.get(key)?.deref()) livePixels.delete(key); });
let sharedBytes = 0;

export function proceduralTexture(texture: THREE.Texture | null): boolean { return texture?.userData['vibi3dProceduralVersion'] === 2; }

/** One bake owns immutable pixels, while each material owns its independent UV transform. */
export function cachedMaterialTexture(cache: MaterialPixelCache, slot: Vibi3DMaterialMapSlot, source: Source, values: Vibi3DMaterial): THREE.Texture {
  const tileSize = values.tileSize ?? materialPresetProperties(source.preset).tileSize!;
  const resolution = source.resolution ?? values.resolution ?? 512;
  const key = JSON.stringify([source.preset, source.seed ?? 0, source.wear ?? 0, resolution, tileSize,
    Object.entries(source.params ?? {}).sort(([a], [b]) => a.localeCompare(b))]);
  let entry = cache.get(key) ?? sharedPixels.get(key) ?? livePixels.get(key)?.deref();
  if (!entry) {
    entry = { pixels: generateMaterialMaps(source.preset, { ...source, resolution, tileSize }), textures: {} };
    livePixels.set(key, new WeakRef(entry)); collectedPixels.register(entry, key);
    const bytes = Object.values(entry.pixels).reduce((sum, map) => sum + map.data.byteLength, 0);
    while (sharedBytes + bytes > SHARED_PIXEL_BYTES && sharedPixels.size) {
      const oldest = sharedPixels.keys().next().value!; const removed = sharedPixels.get(oldest)!;
      sharedBytes -= Object.values(removed.pixels).reduce((sum, map) => sum + map.data.byteLength, 0); sharedPixels.delete(oldest);
    }
    sharedPixels.set(key, entry); sharedBytes += bytes;
  }
  if (sharedPixels.has(key)) { sharedPixels.delete(key); sharedPixels.set(key, entry); }
  cache.set(key, entry);
  let texture = entry.textures[slot];
  if (!texture) {
    const pixels = slot === 'normalMap' || slot === 'roughnessMap' || slot === 'aoMap' ? entry.pixels[slot] : entry.pixels.map;
    let data = pixels.data;
    if (slot === 'metalnessMap' || slot === 'alphaMap') {
      data = new Uint8Array(pixels.width * pixels.height * 4);
      const value = slot === 'alphaMap' ? 255 : Math.round((source.params?.metalness ?? materialPresetProperties(source.preset).metalness ?? 0) * 255);
      for (let n = 0; n < data.length; n += 4) { data[n] = data[n + 1] = data[n + 2] = value; data[n + 3] = 255; }
    }
    texture = new THREE.DataTexture(data, pixels.width, pixels.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.source.uuid = creationIntentId('procedural-pixels-v2', key, slot);
    liveSources.set(texture.source, entry);
    texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 8; texture.userData['vibi3dProceduralVersion'] = 2;
    if (slot === 'map' && source.preset === 'glass' && source.params?.fakeInterior) texture.userData['vibi3dInteriorMap'] = true;
    texture.needsUpdate = true; entry.textures[slot] = texture;
  }
  return texture.clone();
}

export function configureMaterialTexture(texture: THREE.Texture, slot: Vibi3DMaterialMapSlot, values: Vibi3DMaterial): void {
  texture.colorSpace = slot === 'map' || slot === 'emissiveMap' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  const interior = texture.userData['vibi3dInteriorMap'] === true;
  texture.wrapS = texture.wrapT = interior ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  const tile = values.tileSize ?? [1, 1];
  texture.repeat.set(interior ? 1 : 1 / tile[0], interior ? 1 : 1 / tile[1]);
  texture.rotation = interior ? 0 : THREE.MathUtils.degToRad(values.rotation ?? 0);
  texture.offset.fromArray(interior ? [0, 0] : values.offset ?? [0, 0]);
  if (interior) texture.channel = 2;
  if (proceduralTexture(texture)) texture.uuid = creationIntentId('procedural-texture-v2', texture.source.uuid, slot, texture.channel,
    texture.repeat.toArray(), texture.rotation, texture.offset.toArray());
  texture.matrixAutoUpdate = true; texture.updateMatrix(); texture.needsUpdate = true;
}
