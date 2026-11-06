import * as THREE from 'three';
import type { Vibi3DMaterial, Vibi3DMaterialMapSlot, Vibi3DMaterialMapSource } from '@vibisual/shared';
import { generateMaterialMaps, materialPresetProperties, type GeneratedMaterialMaps } from './proceduralMaterialPixels.js';
import { creationIntentId } from '../Creation/creationApi.js';
import { generateMaterialMapsAsync } from './proceduralMaterialWorkerClient.js';

type Source = Extract<Vibi3DMaterialMapSource, { kind: 'procedural' }>;
type Textures = Partial<Record<Vibi3DMaterialMapSlot, THREE.Texture>>;
export type MaterialPixelCache = Map<string, { pixels: GeneratedMaterialMaps; textures: Textures; bytes?: number; pending?: Promise<void>; clones?: WeakRef<THREE.Texture>[] }>;
type PixelEntry = MaterialPixelCache extends Map<string, infer T> ? T : never;
const SHARED_PIXEL_BYTES = 64 * 1024 * 1024;
const sharedPixels: MaterialPixelCache = new Map();
// A live scene Source keeps its bake discoverable after LRU eviction, without retaining closed documents.
const liveSources = new WeakMap<THREE.Source<unknown>, PixelEntry>();
const livePixels = new Map<string, WeakRef<PixelEntry>>();
const collectedPixels = new FinalizationRegistry<string>(key => { if (!livePixels.get(key)?.deref()) livePixels.delete(key); });
let sharedBytes = 0;
interface GenerationBatch { pending: Set<Promise<void>>; active: boolean }
let generationBatch: GenerationBatch | undefined;

/** Scope only synchronous scene construction; callers await before rendering or committing history. */
export function collectMaterialGeneration<T>(create: () => T): { value: T; ready: Promise<void> } {
  // Node authoring/tests have no browser UI thread; browser failures must still reject through the worker path.
  if (typeof window === 'undefined' && typeof Worker === 'undefined') return { value: create(), ready: Promise.resolve() };
  const previous = generationBatch, batch: GenerationBatch = { pending: new Set(), active: true }; generationBatch = batch;
  try {
    const value = create();
    const ready = Promise.allSettled(batch.pending).then(results => {
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') { batch.active = false; throw failed.reason; }
    });
    return { value, ready };
  } catch (error) { batch.active = false; throw error; }
  finally { generationBatch = previous; }
}

/** Dependent atlas work returns an installer so a failed synchronous transaction cannot receive a late mutation. */
export function deferMaterialGeneration(compute: () => Promise<() => void>, settled: () => void = () => undefined): boolean {
  const batch = generationBatch; if (!batch) return false;
  const pending = Promise.all([...batch.pending]).then(async () => {
    if (!batch.active) return;
    const install = await compute(); if (batch.active) install();
  }).finally(settled);
  batch.pending.add(pending); void pending.catch(() => undefined); return true;
}

function slotPixels(entry: PixelEntry, slot: Vibi3DMaterialMapSlot, source: Source) {
  const pixels = slot === 'normalMap' || slot === 'roughnessMap' || slot === 'aoMap' ? entry.pixels[slot] : entry.pixels.map;
  if (slot !== 'metalnessMap' && slot !== 'alphaMap') return pixels;
  const value = slot === 'alphaMap' ? 255 : Math.round((source.params?.metalness ?? materialPresetProperties(source.preset).metalness ?? 0) * 255);
  const data = new Uint8Array(pixels.width * pixels.height * 4);
  // Native bulk fill copies one RGBA word without a JavaScript pixel loop.
  new Uint32Array(data.buffer).fill(new Uint32Array(new Uint8Array([value, value, value, 255]).buffer)[0]!);
  return { ...pixels, data };
}

export function proceduralTexture(texture: THREE.Texture | null): boolean { return texture?.userData['vibi3dProceduralVersion'] === 2; }

/** One bake owns immutable pixels, while each material owns its independent UV transform. */
export function cachedMaterialTexture(cache: MaterialPixelCache, slot: Vibi3DMaterialMapSlot, source: Source, values: Vibi3DMaterial): THREE.Texture {
  const tileSize = values.tileSize ?? materialPresetProperties(source.preset).tileSize!;
  const resolution = source.resolution ?? values.resolution ?? 512;
  const key = JSON.stringify([source.preset, source.seed ?? 0, source.wear ?? 0, resolution, tileSize,
    Object.entries(source.params ?? {}).sort(([a], [b]) => a.localeCompare(b))]);
  let entry = cache.get(key) ?? sharedPixels.get(key) ?? livePixels.get(key)?.deref();
  if (!entry) {
    const options = { ...source, resolution, tileSize };
    const placeholder = { width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) };
    entry = { pixels: generationBatch ? { map: placeholder, normalMap: placeholder, roughnessMap: placeholder, aoMap: placeholder }
      : generateMaterialMaps(source.preset, options), textures: {}, bytes: resolution * resolution * 16 };
    if (generationBatch) {
      const target = entry;
      target.pending = generateMaterialMapsAsync(source.preset, options).then(pixels => {
        target.pixels = pixels;
        for (const [name, texture] of Object.entries(target.textures)) {
          texture.source.data = slotPixels(target, name as Vibi3DMaterialMapSlot, source); texture.needsUpdate = true;
        }
        for (const weak of target.clones ?? []) { const clone = weak.deref(); if (clone) clone.needsUpdate = true; }
        delete target.pending; delete target.clones;
      }, error => {
        if (sharedPixels.get(key) === target) { sharedPixels.delete(key); sharedBytes -= target.bytes!; }
        if (livePixels.get(key)?.deref() === target) livePixels.delete(key);
        throw error;
      });
      // Construction can throw before its transaction starts awaiting the collected jobs.
      void target.pending.catch(() => undefined);
    }
    livePixels.set(key, new WeakRef(entry)); collectedPixels.register(entry, key);
    const bytes = entry.bytes!;
    while (sharedBytes + bytes > SHARED_PIXEL_BYTES && sharedPixels.size) {
      const oldest = sharedPixels.keys().next().value!; const removed = sharedPixels.get(oldest)!;
      sharedBytes -= removed.bytes ?? Object.values(removed.pixels).reduce((sum, map) => sum + map.data.byteLength, 0); sharedPixels.delete(oldest);
    }
    sharedPixels.set(key, entry); sharedBytes += bytes;
  }
  if (sharedPixels.has(key)) { sharedPixels.delete(key); sharedPixels.set(key, entry); }
  cache.set(key, entry);
  if (entry.pending) {
    if (!generationBatch) throw new Error('material-generation-pending');
    generationBatch.pending.add(entry.pending);
  }
  let texture = entry.textures[slot];
  if (!texture) {
    const pixels = slotPixels(entry, slot, source);
    texture = new THREE.DataTexture(pixels.data, pixels.width, pixels.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.source.uuid = creationIntentId('procedural-pixels-v2', key, slot);
    liveSources.set(texture.source, entry);
    texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 8; texture.userData['vibi3dProceduralVersion'] = 2;
    if (slot === 'map' && source.preset === 'glass' && source.params?.fakeInterior) texture.userData['vibi3dInteriorMap'] = true;
    texture.needsUpdate = true; entry.textures[slot] = texture;
  }
  const clone = texture.clone();
  if (entry.pending) (entry.clones ??= []).push(new WeakRef(clone));
  return clone;
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
