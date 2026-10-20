import { validateVibi3DMaterialMapSource, type Vibi3DMaterialParams, type Vibi3DMaterialPreset } from '@vibisual/shared';
import { materialPresetDefaults } from './proceduralMaterialDefaults.js';
import { byte, clamp01, materialHash, materialNoiseSampler, materialRGB } from './proceduralMaterialNoise.js';
import { sampleMaterialPattern, type MaterialPatternContext } from './proceduralMaterialPatterns.js';
export { materialPresetDefaults, materialPresetProperties } from './proceduralMaterialDefaults.js';

export interface MaterialPixelMap { width: number; height: number; data: Uint8Array }
export interface GeneratedMaterialMaps { map: MaterialPixelMap; normalMap: MaterialPixelMap; roughnessMap: MaterialPixelMap; aoMap: MaterialPixelMap }
export interface MaterialMapOptions { seed?: number; wear?: number; params?: Vibi3DMaterialParams; size?: number; resolution?: number; tileSize?: readonly [number, number] }
export const MATERIAL_MAP_SIZES = [32, 64, 128, 256, 512, 1024] as const;
const RELIEF_METERS: Partial<Record<Vibi3DMaterialPreset, number>> = { 'painted-concrete': 0.004, 'wall-tile': 0.008, brick: 0.012,
  pavers: 0.014, granite: 0.003, asphalt: 0.012, kerb: 0.006, 'wood-planks': 0.008, 'corrugated-metal': 0.02,
  aluminium: 0.001, glass: 0.00015, 'awning-fabric': 0.002, plastic: 0.0006, rubber: 0.002, rust: 0.006 };

function createMap(size: number): MaterialPixelMap { return { width: size, height: size, data: new Uint8Array(size * size * 4) }; }
function rgba(map: MaterialPixelMap, index: number, red: number, green = red, blue = red): void {
  const offset = index * 4;
  map.data[offset] = byte(red); map.data[offset + 1] = byte(green); map.data[offset + 2] = byte(blue); map.data[offset + 3] = 255;
}

/**
 * Built-in analytic textures require no downloaded assets or third-party texture license.
 * Pure CPU RGBA bytes are frozen into creation blobs by the material editor; this module never accesses DOM or GPU.
 */
export function generateMaterialMaps(preset: Vibi3DMaterialPreset, options: MaterialMapOptions = {}): GeneratedMaterialMaps {
  const source = validateVibi3DMaterialMapSource({ kind: 'procedural', preset, seed: options.seed ?? 0,
    wear: options.wear ?? 0, params: options.params ?? {} });
  if (!source || source.kind !== 'procedural') throw new RangeError('material-source-invalid');
  const size = options.size ?? options.resolution ?? 512;
  if (!(MATERIAL_MAP_SIZES as readonly number[]).includes(size)) throw new RangeError('material-map-size-invalid');
  // Distinct preset salts prevent every wall, road and prop from sharing an identical stain at the default seed.
  const seed = Array.from(preset).reduce((value, character, index) => materialHash(value, character.charCodeAt(0), index), source.seed!);
  const wear = source.wear!, params = source.params!;
  const verticalWear = ['painted-concrete', 'wall-tile', 'brick', 'wood-planks', 'corrugated-metal', 'aluminium', 'glass', 'emissive-acrylic'].includes(preset);
  const defaults = materialPresetDefaults(preset);
  const tileSize = options.tileSize ?? defaults.tileSize;
  if (!tileSize.every(value => Number.isFinite(value) && value > 0)) throw new RangeError('material-source-invalid');
  const noise = materialNoiseSampler(seed);
  const context: MaterialPatternContext = { preset, seed, params, defaults, noise,
    tileSize, resolution: size,
    primary: materialRGB(params.color ?? defaults.color), secondary: materialRGB(params.secondaryColor ?? defaults.secondaryColor),
    accent: materialRGB(params.accentColor ?? defaults.accentColor) };
  const maps: GeneratedMaterialMaps = { map: createMap(size), normalMap: createMap(size), roughnessMap: createMap(size), aoMap: createMap(size) };
  const heights = new Float64Array(size * size);
  const roughness = params.roughness ?? defaults.roughness;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = y * size + x, u = (x + 0.5) / size, v = (y + 0.5) / size;
    const sample = sampleMaterialPattern(context, u, v);
    // Long vertical stains, larger patches and dirt in patterned edges share the same seeded surface coordinates.
    const streak = wear ? clamp01((noise(u, v, 48, 3, 41) - 0.5) * 2.3) : 0;
    const stain = wear ? clamp01((noise(u, v, 5, 5, 42) - 0.34) * 1.3) : 0;
    const edge = Math.max(sample.edge, clamp01(1 - Math.min(u, v, 1 - u, 1 - v) * 18) * 0.3);
    const dirt = wear * clamp01(streak * (verticalWear ? 0.22 : 0) + stain * 0.75 + edge * 0.35);
    const grain = noise(u, v, 128, 128, 43);
    const brightness = (1 + (grain - 0.5) * 0.075 * (params.contrast ?? 0.55)) * (1 - dirt * 0.62);
    rgba(maps.map, index, sample.color[0] * brightness, sample.color[1] * brightness * (1 - dirt * 0.035), sample.color[2] * brightness * (1 - dirt * 0.085));
    rgba(maps.roughnessMap, index, clamp01(roughness + sample.roughness + dirt * 0.22) * 255);
    rgba(maps.aoMap, index, clamp01(1 - sample.cavity * (preset === 'pavers' ? 0.24 : 0.48) - dirt * 0.19) * 255);
    heights[index] = sample.height + dirt * 0.025 + (grain - 0.5) * wear * 0.02;
  }
  const strength = (params.normalStrength ?? defaults.normalStrength) * (RELIEF_METERS[preset] ?? 0.001) * size / 2;
  const heightAt = (x: number, y: number): number => heights[((y + size) % size) * size + (x + size) % size]!;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * strength / tileSize[0];
    const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * strength / tileSize[1];
    const length = Math.sqrt(dx * dx + dy * dy + 1);
    rgba(maps.normalMap, y * size + x, (1 - dx / length) * 127.5, (1 - dy / length) * 127.5, (1 + 1 / length) * 127.5);
  }
  return maps;
}
