import { isCreationDocId, parseCreationBlobRef } from './creation.js';

export const VIBI3D_MATERIAL_PRESETS = ['painted-concrete', 'wall-tile', 'brick', 'granite', 'pavers', 'asphalt', 'kerb',
  'wood-planks', 'corrugated-metal', 'aluminium', 'glass', 'awning-fabric', 'emissive-acrylic', 'plastic', 'rubber', 'rust'] as const;
export type Vibi3DMaterialPreset = typeof VIBI3D_MATERIAL_PRESETS[number];
export const VIBI3D_MATERIAL_MAP_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'emissiveMap'] as const;
export type Vibi3DMaterialMapSlot = typeof VIBI3D_MATERIAL_MAP_SLOTS[number];
export const VIBI3D_MATERIAL_RESOLUTIONS = [128, 256, 512, 1024] as const;
export type Vibi3DMaterialResolution = typeof VIBI3D_MATERIAL_RESOLUTIONS[number];
export interface Vibi3DMaterialParams {
  color?: string; secondaryColor?: string; accentColor?: string;
  scale?: number; contrast?: number; roughness?: number; metalness?: number; normalStrength?: number;
  /** Pattern widths in meters. */
  stripeWidth?: number; groutWidth?: number;
  /** Glass only: bake a seeded room into the color map, without adding geometry or fetching assets. */
  fakeInterior?: boolean;
}
export type Vibi3DMaterialMapSource =
  | { kind: 'vibimage'; docId: string }
  | { kind: 'blob'; ref: string }
  | { kind: 'procedural'; preset: Vibi3DMaterialPreset; seed?: number; params?: Vibi3DMaterialParams; wear?: number; resolution?: Vibi3DMaterialResolution };
export type Vibi3DMaterialMaps = Partial<Record<Vibi3DMaterialMapSlot, { source: Vibi3DMaterialMapSource }>>;
export interface Vibi3DPhysicalMaterial { transmission?: number; ior?: number; thickness?: number; clearcoat?: number }
export interface Vibi3DMaterial {
  color?: string; roughness?: number; metalness?: number; opacity?: number;
  emissive?: string; emissiveIntensity?: number;
  maps?: Vibi3DMaterialMaps;
  /** Real world meters per complete repeat, independent of the object's size. */
  tileSize?: [number, number];
  /** Degrees around the texture origin. */
  rotation?: number;
  offset?: [number, number];
  alphaTest?: number; transparent?: boolean; side?: 'front' | 'back' | 'double';
  physical?: Vibi3DPhysicalMaterial;
  envMapIntensity?: number;
  polygonOffset?: boolean; polygonOffsetFactor?: number; polygonOffsetUnits?: number;
  preset?: Vibi3DMaterialPreset; params?: Vibi3DMaterialParams; wear?: number; seed?: number;
  /** New procedural bakes default to 512; existing embedded pixels are never resized on load. */
  resolution?: Vibi3DMaterialResolution;
}
type Bag = Record<string, unknown>;
type Bounds = readonly [number, number];
const parameterNumbers: Record<string, Bounds> = { scale: [0.05, 20], contrast: [0, 1], roughness: [0, 1], metalness: [0, 1],
  normalStrength: [0, 3], stripeWidth: [0.01, 2], groutWidth: [0.001, 0.2] };
const physicalNumbers: Record<string, Bounds> = { transmission: [0, 1], ior: [1, 2.5], thickness: [0, 100], clearcoat: [0, 1] };
const materialNumbers: Record<string, Bounds> = { roughness: [0, 1], metalness: [0, 1], opacity: [0, 1], emissiveIntensity: [0, 100],
  rotation: [-360, 360], alphaTest: [0, 1], envMapIntensity: [0, 100], polygonOffsetFactor: [-100, 100], polygonOffsetUnits: [-100, 100], wear: [0, 1] };
const bag = (value: unknown): value is Bag => !!value && typeof value === 'object' && !Array.isArray(value);
const only = (value: Bag, allowed: readonly string[]): boolean => Object.keys(value).every(key => allowed.includes(key));
const finite = (value: unknown, bounds: Bounds): value is number => typeof value === 'number' && Number.isFinite(value) && value >= bounds[0] && value <= bounds[1];
const hex = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const preset = (value: unknown): value is Vibi3DMaterialPreset => typeof value === 'string' && (VIBI3D_MATERIAL_PRESETS as readonly string[]).includes(value);
const seed = (value: unknown): value is number => finite(value, [0, 0xffffffff]) && Number.isInteger(value);
const resolution = (value: unknown): value is Vibi3DMaterialResolution => typeof value === 'number' && (VIBI3D_MATERIAL_RESOLUTIONS as readonly number[]).includes(value);
function numericFields(value: Bag, bounds: Record<string, Bounds>): boolean {
  return Object.entries(bounds).every(([key, range]) => value[key] === undefined || finite(value[key], range));
}
export function validateVibi3DMaterialParams(value: unknown): Vibi3DMaterialParams | null {
  const colors = ['color', 'secondaryColor', 'accentColor'];
  if (!bag(value) || !only(value, [...colors, ...Object.keys(parameterNumbers), 'fakeInterior']) || !numericFields(value, parameterNumbers)
    || (value.fakeInterior !== undefined && typeof value.fakeInterior !== 'boolean')) return null;
  const result = { ...value };
  for (const key of colors) {
    if (value[key] !== undefined) { if (!hex(value[key])) return null; result[key] = value[key].toLowerCase(); }
  }
  return result;
}
export function validateVibi3DMaterialMapSource(value: unknown): Vibi3DMaterialMapSource | null {
  if (!bag(value)) return null;
  if (value.kind === 'vibimage' && only(value, ['kind', 'docId']) && isCreationDocId(value.docId)) return { kind: 'vibimage', docId: value.docId };
  if (value.kind === 'blob' && only(value, ['kind', 'ref'])) {
    const blob = parseCreationBlobRef(value.ref);
    return blob && ['png', 'jpg', 'webp', 'gif', 'avif', 'bmp', 'svg'].includes(blob.ext) ? { kind: 'blob', ref: value.ref as string } : null;
  }
  if (value.kind !== 'procedural' || !only(value, ['kind', 'preset', 'seed', 'params', 'wear', 'resolution']) || !preset(value.preset)
    || (value.resolution !== undefined && !resolution(value.resolution))
    || (value.seed !== undefined && !seed(value.seed)) || (value.wear !== undefined && !finite(value.wear, [0, 1]))) return null;
  const params = value.params === undefined ? undefined : validateVibi3DMaterialParams(value.params);
  if (params === null) return null;
  return { kind: 'procedural', preset: value.preset, ...(value.seed !== undefined ? { seed: value.seed as number } : {}),
    ...(params ? { params } : {}), ...(value.wear !== undefined ? { wear: value.wear as number } : {}),
    ...(value.resolution !== undefined ? { resolution: value.resolution as Vibi3DMaterialResolution } : {}) };
}
export function validateVibi3DMaterialMaps(value: unknown): Vibi3DMaterialMaps | null {
  if (!bag(value) || !Object.keys(value).length || !only(value, VIBI3D_MATERIAL_MAP_SLOTS)) return null;
  const result: Vibi3DMaterialMaps = {};
  for (const slot of VIBI3D_MATERIAL_MAP_SLOTS) {
    if (value[slot] === undefined) continue;
    const entry = value[slot];
    if (!bag(entry) || !only(entry, ['source'])) return null;
    const source = validateVibi3DMaterialMapSource(entry.source); if (!source) return null;
    result[slot] = { source };
  }
  return result;
}
/** No URL, shader source or arbitrary material properties cross the command boundary. */
export function validateVibi3DMaterial(value: unknown): Vibi3DMaterial | null {
  const special = ['color', 'emissive', 'maps', 'tileSize', 'offset', 'transparent', 'side', 'physical', 'polygonOffset', 'preset', 'params', 'seed', 'resolution'];
  if (!bag(value) || !Object.keys(value).length || !only(value, [...special, ...Object.keys(materialNumbers)]) || !numericFields(value, materialNumbers)) return null;
  const result = { ...value };
  for (const key of ['color', 'emissive']) {
    if (value[key] !== undefined) { if (!hex(value[key])) return null; result[key] = value[key].toLowerCase(); }
  }
  for (const key of ['transparent', 'polygonOffset']) if (value[key] !== undefined && typeof value[key] !== 'boolean') return null;
  if (value.side !== undefined && (typeof value.side !== 'string' || !['front', 'back', 'double'].includes(value.side))) return null;
  if (value.preset !== undefined && !preset(value.preset)) return null;
  if (value.seed !== undefined && !seed(value.seed)) return null;
  if (value.resolution !== undefined && !resolution(value.resolution)) return null;
  for (const key of ['tileSize', 'offset'] as const) {
    const pair = value[key]; const bounds: Bounds = key === 'tileSize' ? [0.001, 10000] : [-10000, 10000];
    if (pair !== undefined && (!Array.isArray(pair) || pair.length !== 2 || !pair.every(item => finite(item, bounds)))) return null;
  }
  if (value.physical !== undefined && (!bag(value.physical) || !Object.keys(value.physical).length
    || !only(value.physical, Object.keys(physicalNumbers)) || !numericFields(value.physical, physicalNumbers))) return null;
  for (const key of ['params', 'maps'] as const) {
    if (value[key] === undefined) continue;
    const parsed = key === 'params' ? validateVibi3DMaterialParams(value[key]) : validateVibi3DMaterialMaps(value[key]);
    if (!parsed) return null; result[key] = parsed;
  }
  return structuredClone(result) as Vibi3DMaterial;
}
