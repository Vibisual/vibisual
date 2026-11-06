import { generateMaterialPixels } from '@vibisual/compute';
import { validateVibi3DMaterialMapSource, type Vibi3DMaterialParams, type Vibi3DMaterialPreset } from '@vibisual/shared';
import { materialPresetDefaults } from './proceduralMaterialDefaults.js';
import { materialRGB } from './proceduralMaterialNoise.js';
export { materialPresetDefaults, materialPresetProperties } from './proceduralMaterialDefaults.js';

export interface MaterialPixelMap { width: number; height: number; data: Uint8Array }
export interface GeneratedMaterialMaps { map: MaterialPixelMap; normalMap: MaterialPixelMap; roughnessMap: MaterialPixelMap; aoMap: MaterialPixelMap }
export interface MaterialMapOptions { seed?: number; wear?: number; params?: Vibi3DMaterialParams; size?: number; resolution?: number; tileSize?: readonly [number, number] }
export const MATERIAL_MAP_SIZES = [32, 64, 128, 256, 512, 1024] as const;
const PRESETS = ['painted-concrete', 'wall-tile', 'brick', 'granite', 'pavers', 'asphalt', 'kerb', 'wood-planks', 'corrugated-metal', 'aluminium', 'glass', 'awning-fabric', 'emissive-acrylic', 'plastic', 'rubber', 'rust'];
const RELIEF_METERS = [0.004, 0.008, 0.012, 0.003, 0.014, 0.012, 0.006, 0.008, 0.02, 0.001, 0.00015, 0.002, 0.001, 0.0006, 0.002, 0.006];

/** Synchronous worker/non-UI entry; interactive callers use generateMaterialMapsAsync. */
export function generateMaterialMaps(preset: Vibi3DMaterialPreset, options: MaterialMapOptions = {}): GeneratedMaterialMaps {
  const source = validateVibi3DMaterialMapSource({ kind: 'procedural', preset, seed: options.seed ?? 0, wear: options.wear ?? 0, params: options.params ?? {} });
  if (!source || source.kind !== 'procedural') throw new RangeError('material-source-invalid');
  const size = options.size ?? options.resolution ?? 512;
  if (!(MATERIAL_MAP_SIZES as readonly number[]).includes(size)) throw new RangeError('material-map-size-invalid');
  const defaults = materialPresetDefaults(preset), params = source.params!;
  const tileSize = options.tileSize ?? defaults.tileSize;
  if (!tileSize.every(value => Number.isFinite(value) && value > 0)) throw new RangeError('material-source-invalid');
  const id = PRESETS.indexOf(preset);
  const config = new Float64Array(24);
  config.set([source.wear!, params.scale ?? 1, params.contrast ?? 0.55, params.roughness ?? defaults.roughness,
    params.normalStrength ?? defaults.normalStrength, params.groutWidth ?? (preset === 'pavers' ? 0.003 : preset === 'wall-tile' || preset === 'kerb' ? 0.008 : 0.012),
    params.stripeWidth ?? 0.2, params.fakeInterior === true ? 1 : 0, ...tileSize,
    ...materialRGB(params.color ?? defaults.color), ...materialRGB(params.secondaryColor ?? defaults.secondaryColor),
    ...materialRGB(params.accentColor ?? defaults.accentColor), RELIEF_METERS[id]!]);
  const pixels = generateMaterialPixels(id, source.seed!, size, config), length = size * size * 4;
  const map = (index: number): MaterialPixelMap => ({ width: size, height: size, data: pixels.subarray(index * length, (index + 1) * length) });
  return { map: map(0), normalMap: map(1), roughnessMap: map(2), aoMap: map(3) };
}
