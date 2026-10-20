import type { Vibi3DVec3 } from './vibi3d.js';
import { isSimpleVibi3DPolygon } from './vibi3dPolygons.js';

export const VIBI3D_ARCHITECTURE_KINDS = ['building', 'facade', 'storefront', 'rooftop', 'street', 'prop'] as const;
export const VIBI3D_PROP_KINDS = ['utilityPole', 'wire', 'streetLight', 'tree', 'bollard', 'bench', 'sandwichBoard', 'planter'] as const;
export type Vibi3DPropKind = typeof VIBI3D_PROP_KINDS[number];
export type Vibi3DFootprint = { kind: 'rect'; width: number; depth: number }
  /** The remaining arms have wingWidth/wingDepth; the removed corner is positive X/Z. */
  | { kind: 'l'; width: number; depth: number; wingWidth: number; wingDepth: number }
  | { kind: 'polygon'; points: [number, number][] };
export interface Vibi3DBuildingParams { footprint?: Vibi3DFootprint; floors?: number; groundFloorHeight?: number; upperFloorHeight?: number; roof?: 'flat' | 'pitched' }
export type Vibi3DFacadeModule = 'window' | 'solid' | 'balcony' | 'open';
export interface Vibi3DFacadeParams {
  width?: number; height?: number; floors?: number; floorHeights?: number[]; bays?: number; bayWidth?: number;
  floorModules?: Vibi3DFacadeModule[][]; windowDepth?: number; bandHeight?: number; eavesDepth?: number; acDensity?: number;
  side?: 'front' | 'back' | 'left' | 'right';
}
export interface Vibi3DStorefrontParams {
  width?: number; height?: number; depth?: number; style?: 'glass' | 'wood' | 'shutter';
  door?: 'left' | 'right' | 'center' | 'none'; signBandHeight?: number;
  awning?: boolean | { depth?: number; drop?: number; height?: number; colors?: [string, string] };
  projectingSign?: boolean;
}
export interface Vibi3DRooftopParams { width?: number; depth?: number; railingHeight?: number; waterTank?: boolean | { radius?: number; height?: number }; antenna?: boolean }
export interface Vibi3DStreetParams {
  length?: number; roadWidth?: number; sidewalkWidth?: number; sidewalks?: 'left' | 'right' | 'both'; lanes?: number;
  laneMarkings?: boolean; kerbHeight?: number; crosswalk?: boolean; manholes?: number; blockColors?: [string, string];
}
export interface Vibi3DPropParams { style?: Vibi3DPropKind; width?: number; height?: number; depth?: number; radius?: number; path?: Vibi3DVec3[]; sag?: number }
export interface Vibi3DArchitectureParams {
  building: Vibi3DBuildingParams; facade: Vibi3DFacadeParams; storefront: Vibi3DStorefrontParams;
  rooftop: Vibi3DRooftopParams; street: Vibi3DStreetParams; prop: Vibi3DPropParams;
}
export type Vibi3DArchitectureKind = keyof Vibi3DArchitectureParams;
export type Vibi3DArchitectureDetail = 'draft' | 'architectural';
/** All recipe frames use X width, +Y up, +Z front, centered X/Z and floor Y=0. */
export type Vibi3DArchitectureRecipe = { [K in Vibi3DArchitectureKind]: { kind: K; detail?: Vibi3DArchitectureDetail } & Vibi3DArchitectureParams[K] }[Vibi3DArchitectureKind];
export interface Vibi3DArchitectureIdentity { id?: string; name?: string; parentId?: string; position?: Vibi3DVec3; rotation?: Vibi3DVec3 }
export type Vibi3DArchitectureCommand = { [K in Vibi3DArchitectureKind]: { type: K; detail?: Vibi3DArchitectureDetail } & Vibi3DArchitectureIdentity & Vibi3DArchitectureParams[K] }[Vibi3DArchitectureKind];

type Bag = Record<string, unknown>;
type Bounds = readonly [number, number];
const fields: Record<Vibi3DArchitectureKind, readonly string[]> = {
  building: ['footprint', 'floors', 'groundFloorHeight', 'upperFloorHeight', 'roof'],
  facade: ['width', 'height', 'floors', 'floorHeights', 'bays', 'bayWidth', 'floorModules', 'windowDepth', 'bandHeight', 'eavesDepth', 'acDensity', 'side'],
  storefront: ['width', 'height', 'depth', 'style', 'door', 'signBandHeight', 'awning', 'projectingSign'],
  rooftop: ['width', 'depth', 'railingHeight', 'waterTank', 'antenna'],
  street: ['length', 'roadWidth', 'sidewalkWidth', 'sidewalks', 'lanes', 'laneMarkings', 'kerbHeight', 'crosswalk', 'manholes', 'blockColors'],
  prop: ['style', 'width', 'height', 'depth', 'radius', 'path', 'sag'],
};
const numeric: Record<string, Bounds> = { width: [0.25, 200], height: [0.05, 200], depth: [0.05, 200], radius: [0.01, 20],
  groundFloorHeight: [1, 12], upperFloorHeight: [1, 10], bayWidth: [0.25, 20], windowDepth: [0, 2], bandHeight: [0, 2],
  eavesDepth: [0, 5], acDensity: [0, 1], signBandHeight: [0, 3], railingHeight: [0, 5], length: [1, 500],
  roadWidth: [1, 50], sidewalkWidth: [0.25, 20], kerbHeight: [0, 0.5], sag: [0, 100] };
const integers: Record<string, Bounds> = { floors: [1, 20], bays: [1, 50], lanes: [1, 8], manholes: [0, 20] };
const enums: Record<string, readonly string[]> = { roof: ['flat', 'pitched'], side: ['front', 'back', 'left', 'right'],
  door: ['left', 'right', 'center', 'none'], sidewalks: ['left', 'right', 'both'] };
const bag = (v: unknown): v is Bag => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown, range: Bounds): v is number => typeof v === 'number' && Number.isFinite(v) && v >= range[0] && v <= range[1];
const only = (v: Bag, allowed: readonly string[]): boolean => Object.keys(v).every(key => allowed.includes(key));
const choice = (v: unknown, allowed: readonly string[]): boolean => typeof v === 'string' && allowed.includes(v);
const vector = (v: unknown): v is Vibi3DVec3 => Array.isArray(v) && v.length === 3 && v.every(item => number(item, [-10000, 10000]));
const colors = (v: unknown): v is [string, string] => Array.isArray(v) && v.length === 2 && v.every(item => typeof item === 'string' && /^#[0-9a-f]{6}$/i.test(item));
function footprint(v: unknown): boolean {
  if (!bag(v)) return false;
  if (v.kind === 'polygon') return only(v, ['kind', 'points']) && Array.isArray(v.points) && v.points.length <= 64
    && v.points.every(point => Array.isArray(point) && point.length === 2 && point.every(coordinate => number(coordinate, [-200, 200])))
    && isSimpleVibi3DPolygon(v.points as [number, number][]);
  if (!choice(v.kind, ['rect', 'l']) || !only(v, v.kind === 'l' ? ['kind', 'width', 'depth', 'wingWidth', 'wingDepth'] : ['kind', 'width', 'depth'])
    || !number(v.width, [0.25, 200]) || !number(v.depth, [0.25, 200])) return false;
  return v.kind !== 'l' || (number(v.wingWidth, [0.1, v.width]) && v.wingWidth < v.width && number(v.wingDepth, [0.1, v.depth]) && v.wingDepth < v.depth);
}
function toggle(v: unknown, bounds: Record<string, Bounds>, withColors = false): boolean {
  return typeof v === 'boolean' || (bag(v) && only(v, [...Object.keys(bounds), ...(withColors ? ['colors'] : [])])
    && Object.entries(bounds).every(([key, range]) => v[key] === undefined || number(v[key], range)) && (!withColors || v.colors === undefined || colors(v.colors)));
}
/** Shared layout arithmetic keeps validation and generated window openings on the same dimensions. */
export function resolveVibi3DFacadeLayout(value: Vibi3DFacadeParams): { width: number; bays: number; bayWidth: number; floorHeights: number[]; bandHeight: number } {
  const width = value.width ?? (value.bayWidth !== undefined ? value.bayWidth * (value.bays ?? 3) : 12);
  const bays = value.bays ?? (value.bayWidth !== undefined ? Math.max(1, Math.ceil(width / value.bayWidth)) : 3);
  const floors = value.floors ?? 4;
  const floorHeights = value.floorHeights ? [...value.floorHeights]
    : Array.from({ length: floors }, (_, floor) => value.height !== undefined ? value.height / floors : floor === 0 ? 4.2 : 3.1);
  return { width, bays, bayWidth: width / bays, floorHeights, bandHeight: value.bandHeight ?? 0.18 };
}
function validProportions(value: Vibi3DArchitectureRecipe): boolean {
  if (value.kind === 'building') return (value.groundFloorHeight ?? 4.2) + ((value.floors ?? 4) - 1) * (value.upperFloorHeight ?? 3.1) <= 200;
  if (value.kind === 'facade') {
    const layout = resolveVibi3DFacadeLayout(value);
    return layout.width <= 200 && layout.bays <= 50 && layout.bayWidth >= 0.25 && layout.floorHeights.reduce((sum, height) => sum + height, 0) <= 200
      && layout.floorHeights.every(height => height >= 1 && height - layout.bandHeight >= 0.5);
  }
  if (value.kind === 'storefront') return (value.width ?? 4) >= 0.75 && (value.height ?? 4.2) >= 1
    && (value.height ?? 4.2) - (value.signBandHeight ?? 0.65) > 0.2;
  return true;
}
function recipe(value: unknown, incomplete: boolean): Vibi3DArchitectureRecipe | null {
  if (!bag(value) || !choice(value.kind, VIBI3D_ARCHITECTURE_KINDS)) return null;
  const kind = value.kind as Vibi3DArchitectureKind;
  if (!only(value, ['kind', 'detail', ...fields[kind]]) || (value.detail !== undefined && !choice(value.detail, ['draft', 'architectural']))) return null;
  for (const [key, range] of Object.entries(numeric)) if (value[key] !== undefined && !number(value[key], range)) return null;
  for (const [key, range] of Object.entries(integers)) if (value[key] !== undefined && (!number(value[key], range) || !Number.isInteger(value[key]))) return null;
  for (const [key, options] of Object.entries(enums)) if (value[key] !== undefined && !choice(value[key], options)) return null;
  for (const key of ['projectingSign', 'antenna', 'laneMarkings', 'crosswalk']) if (value[key] !== undefined && typeof value[key] !== 'boolean') return null;
  if (value.footprint !== undefined && !footprint(value.footprint)) return null;
  if (value.style !== undefined && !choice(value.style, kind === 'prop' ? VIBI3D_PROP_KINDS : ['glass', 'wood', 'shutter'])) return null;
  if (value.floorHeights !== undefined && (!Array.isArray(value.floorHeights) || !value.floorHeights.length || value.floorHeights.length > 20
    || !value.floorHeights.every(item => number(item, [1, 12])) || value.floorHeights.reduce((sum, item) => sum + item, 0) > 200)) return null;
  if (value.floorModules !== undefined && (!Array.isArray(value.floorModules) || !value.floorModules.length || value.floorModules.length > 20
    || !value.floorModules.every(row => Array.isArray(row) && row.length > 0 && row.length <= 50 && row.every(item => choice(item, ['window', 'solid', 'balcony', 'open']))))) return null;
  if (value.awning !== undefined && !toggle(value.awning, { depth: [0.1, 5], drop: [0, 2], height: [0.5, 10] }, true)) return null;
  if (value.waterTank !== undefined && !toggle(value.waterTank, { radius: [0.1, 20], height: [0.1, 20] })) return null;
  if (value.blockColors !== undefined && !colors(value.blockColors)) return null;
  if (value.path !== undefined && (!Array.isArray(value.path) || value.path.length < 2 || value.path.length > 128 || !value.path.every(vector)
    || value.path.some((point, index, path) => index > 0 && point.every((coordinate: number, axis: number) => coordinate === path[index - 1]![axis])))) return null;
  if (!incomplete && kind === 'prop' && value.style === 'wire' && !value.path) return null;
  if (!incomplete && !validProportions(value as unknown as Vibi3DArchitectureRecipe)) return null;
  const result = structuredClone(value);
  if (colors(result.blockColors)) result.blockColors = result.blockColors.map(color => color.toLowerCase());
  if (bag(result.awning) && colors(result.awning.colors)) result.awning.colors = result.awning.colors.map(color => color.toLowerCase());
  return result as unknown as Vibi3DArchitectureRecipe;
}
export function validateVibi3DArchitectureRecipe(value: unknown): Vibi3DArchitectureRecipe | null { return recipe(value, false); }
export function validateVibi3DArchitectureCommand(value: unknown): Vibi3DArchitectureCommand | null {
  if (!bag(value)) return null;
  const { type, id, name, parentId, position, rotation, ...params } = value;
  if (Object.hasOwn(params, 'kind')) return null;
  for (const text of [id, name, parentId]) if (text !== undefined && (typeof text !== 'string' || !text.length || text.length > 200)) return null;
  if ((position !== undefined && !vector(position)) || (rotation !== undefined && !vector(rotation))) return null;
  const result = recipe({ kind: type, ...params }, true); if (!result) return null;
  const { kind, ...settings } = result;
  return { type: kind, ...settings, ...(id !== undefined ? { id } : {}), ...(name !== undefined ? { name } : {}),
    ...(parentId !== undefined ? { parentId } : {}), ...(position !== undefined ? { position: [...position as Vibi3DVec3] } : {}),
    ...(rotation !== undefined ? { rotation: [...rotation as Vibi3DVec3] } : {}) } as Vibi3DArchitectureCommand;
}
