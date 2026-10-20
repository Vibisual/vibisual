import type { Vibi3DVec3 } from './vibi3d.js';
import { VIBI3D_LIMITS } from './vibi3dLimits.js';

export const VIBI3D_BUILTIN_MODULES = ['korean-retail/window', 'korean-retail/storefront-glass', 'korean-retail/storefront-wood',
  'korean-retail/storefront-shutter', 'street/bollard', 'street/bench', 'street/planter', 'street/light'] as const;
export type Vibi3DBuiltinModule = typeof VIBI3D_BUILTIN_MODULES[number];
export const VIBI3D_BUILTIN_KITS = VIBI3D_BUILTIN_MODULES;
export interface Vibi3DKitModule { id: string; name: string; revision: number; prototypeId: string; builtin?: Vibi3DBuiltinModule; partCount?: number; instances?: number }
/** The GPU instance index is transient and never an external identity. */
export interface Vibi3DInstance { moduleId: string; moduleRevision: number; placementId: string; arrayId?: string; cell?: Vibi3DVec3 }
export interface Vibi3DPlacement {
  id: string; moduleId: string; expectedModuleRevision?: number; parentId?: string;
  position?: Vibi3DVec3; rotation?: Vibi3DVec3; scale?: Vibi3DVec3; snap?: false | number;
}
export interface Vibi3DArray { moduleId: string; moduleRevision: number; counts: Vibi3DVec3; step: Vibi3DVec3; snap?: false | number }
export type Vibi3DKitCommand =
  | ({ type: 'kitModule'; id: string; name?: string; expectedModuleRevision?: number } & ({ sourceId: string; builtin?: never } | { builtin: Vibi3DBuiltinModule; sourceId?: never }))
  | ({ type: 'place' } & Vibi3DPlacement)
  | ({ type: 'array'; counts: Vibi3DVec3; step: Vibi3DVec3 } & Vibi3DPlacement)
  | { type: 'stats' };

type Bag = Record<string, unknown>;
const bag = (value: unknown): value is Bag => !!value && typeof value === 'object' && !Array.isArray(value);
const only = (value: Bag, allowed: readonly string[]): boolean => Object.keys(value).every(key => allowed.includes(key));
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const revision = (value: unknown): value is number => integer(value, 1, Number.MAX_SAFE_INTEGER);
const vec = (value: unknown): value is Vibi3DVec3 => Array.isArray(value) && value.length === 3
  && value.every(item => typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 10000);
const snap = (value: unknown): boolean => value === false || (typeof value === 'number' && Number.isFinite(value) && value >= 0.001 && value <= 100);
const builtin = (value: unknown): value is Vibi3DBuiltinModule => (VIBI3D_BUILTIN_MODULES as readonly unknown[]).includes(value);
export function validateVibi3DArrayCounts(value: unknown): Vibi3DVec3 | null {
  return vec(value) && value.every(item => integer(item, 1, VIBI3D_LIMITS.placements))
    && value[0] * value[1] * value[2] <= VIBI3D_LIMITS.placements ? [...value] : null;
}
export function validateVibi3DKitCommand(value: unknown): Vibi3DKitCommand | null {
  if (!bag(value)) return null;
  if (value.type === 'stats') return only(value, ['type']) ? { type: 'stats' } : null;
  if (!id(value.id) || (value.expectedModuleRevision !== undefined && !revision(value.expectedModuleRevision))) return null;
  if (value.type === 'kitModule') {
    if (!only(value, ['type', 'id', 'name', 'sourceId', 'builtin', 'expectedModuleRevision'])
      || (value.name !== undefined && (typeof value.name !== 'string' || !value.name.length || value.name.length > 200))
      || !((id(value.sourceId) && value.builtin === undefined) || (builtin(value.builtin) && value.sourceId === undefined))) return null;
    return structuredClone(value) as Vibi3DKitCommand;
  }
  if (!['place', 'array'].includes(String(value.type)) || !id(value.moduleId) || (value.parentId !== undefined && !id(value.parentId))
    || !only(value, ['type', 'id', 'moduleId', 'expectedModuleRevision', 'parentId', 'position', 'rotation', 'scale', 'snap', ...(value.type === 'array' ? ['counts', 'step'] : [])])) return null;
  if (['position', 'rotation', 'scale'].some(key => value[key] !== undefined && !vec(value[key]))
    || (Array.isArray(value.scale) && value.scale.some(item => item <= 0)) || (value.snap !== undefined && !snap(value.snap))) return null;
  if (value.type === 'array' && (!validateVibi3DArrayCounts(value.counts) || !vec(value.step)
    || (value.counts as Vibi3DVec3).some((count, axis) => count > 1 && (value.step as Vibi3DVec3)[axis] === 0))) return null;
  return structuredClone(value) as Vibi3DKitCommand;
}
export function validateVibi3DInstance(value: unknown): Vibi3DInstance | null {
  if (!bag(value) || !only(value, ['moduleId', 'moduleRevision', 'placementId', 'arrayId', 'cell'])
    || !id(value.moduleId) || !revision(value.moduleRevision) || !id(value.placementId)
    || ((value.arrayId === undefined) !== (value.cell === undefined)) || (value.arrayId !== undefined && !id(value.arrayId))
    || (value.cell !== undefined && (!vec(value.cell) || !value.cell.every(item => integer(item, 0, VIBI3D_LIMITS.placements - 1))))) return null;
  return structuredClone(value) as unknown as Vibi3DInstance;
}
export function validateVibi3DKitModules(value: unknown): Vibi3DKitModule[] | null {
  if (!Array.isArray(value) || value.length > VIBI3D_LIMITS.modules) return null;
  const ids = new Set<string>(); const prototypes = new Set<string>();
  for (const item of value) {
    if (!bag(item) || !only(item, ['id', 'name', 'revision', 'prototypeId', 'builtin', 'partCount', 'instances']) || !id(item.id) || ids.has(item.id)
      || typeof item.name !== 'string' || !item.name.length || item.name.length > 200 || !revision(item.revision) || !id(item.prototypeId) || prototypes.has(item.prototypeId)
      || (item.builtin !== undefined && !builtin(item.builtin)) || (item.partCount !== undefined && !integer(item.partCount, 0, VIBI3D_LIMITS.moduleParts))
      || (item.instances !== undefined && !integer(item.instances, 0, VIBI3D_LIMITS.placements))) return null;
    ids.add(item.id); prototypes.add(item.prototypeId);
  }
  return structuredClone(value) as Vibi3DKitModule[];
}
