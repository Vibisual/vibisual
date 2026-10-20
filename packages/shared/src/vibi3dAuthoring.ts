import type { Vibi3DVec3 } from './vibi3d.js';
import { validateVibi3DMaterial, type Vibi3DMaterial } from './vibi3dMaterials.js';
export { validateVibi3DMaterial, type Vibi3DMaterial } from './vibi3dMaterials.js';
import { validateVibi3DRecipe, type Vibi3DRecipe } from './vibi3dGeometry.js';
export { VIBI3D_SHAPES, validateVibi3DRecipe, type Vibi3DRecipe } from './vibi3dGeometry.js';
import { validateVibi3DCameraCommand, type Vibi3DCameraCommand, type Vibi3DShotRemoveCommand } from './vibi3dCamera.js';

export const VIBI3D_LIGHTS = ['directional', 'point', 'spot', 'hemisphere', 'ambient'] as const;
export type Vibi3DLightKind = typeof VIBI3D_LIGHTS[number];
export interface Vibi3DMotionKey { time: number; position?: Vibi3DVec3; rotation?: Vibi3DVec3; scale?: Vibi3DVec3; }
export interface Vibi3DCameraKey { time: number; position: Vibi3DVec3; target: Vibi3DVec3; }
export interface Vibi3DLight { kind: Vibi3DLightKind; intensity: number; color: string }
export type Vibi3DAuthoringCommand =
  | { type: 'create'; id?: string; name: string; parentId?: string; recipe: Vibi3DRecipe; position?: Vibi3DVec3; material?: Vibi3DMaterial }
  | { type: 'geometry'; id: string; recipe: Vibi3DRecipe }
  | { type: 'duplicate'; id: string; count?: number; offset?: Vibi3DVec3 }
  | { type: 'delete'; id: string }
  | { type: 'group'; ids: string[]; name: string }
  | { type: 'material'; id: string; material: Vibi3DMaterial }
  | { type: 'protect'; id: string; locked: boolean }
  | Vibi3DCameraCommand | Vibi3DShotRemoveCommand
  /** Named motion of one object; `previousName` renames (the old clip is replaced). Keys may move, turn and scale. */
  | { type: 'motion'; id: string; name: string; keys: Vibi3DMotionKey[]; previousName?: string }
  | { type: 'motionRemove'; id: string; name: string }
  /** Creates a light (no `id` or a new `id`) or changes an existing light. */
  | { type: 'light'; id?: string; name?: string; kind?: Vibi3DLightKind; position?: Vibi3DVec3; intensity?: number; color?: string }
  /** Keyframed path of the view camera (the camera videos and stills use when no camera props override it). */
  | { type: 'cameraMotion'; name: string; keys: Vibi3DCameraKey[] };

type Bag = Record<string, unknown>;
const bag = (v: unknown): v is Bag => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 10000;
const vec = (v: unknown): v is Vibi3DVec3 => Array.isArray(v) && v.length === 3 && v.every(finite);
const hex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const only = (v: Bag, names: string[]): boolean => Object.keys(v).every((key) => names.includes(key));
export function validateVibi3DMotionKeys(keys: unknown): Vibi3DMotionKey[] | null {
  if (!Array.isArray(keys) || keys.length < 2 || keys.length > 256) return null;
  let previous = -1;
  for (const key of keys) {
    if (!bag(key) || !only(key, ['time', 'position', 'rotation', 'scale']) || !finite(key.time) || key.time < 0 || key.time <= previous) return null;
    previous = key.time;
    if (!['position', 'rotation', 'scale'].some((p) => key[p] !== undefined)) return null;
    for (const p of ['position', 'rotation', 'scale']) if (key[p] !== undefined && (!vec(key[p]) || (p === 'scale' && key[p].some((n) => n === 0)))) return null;
  }
  return structuredClone(keys) as Vibi3DMotionKey[];
}
function cameraKeys(keys: unknown): Vibi3DCameraKey[] | null {
  if (!Array.isArray(keys) || keys.length < 2 || keys.length > 256) return null;
  let previous = -1;
  for (const key of keys) {
    if (!bag(key) || !only(key, ['time', 'position', 'target']) || !finite(key.time) || key.time <= previous || key.time < 0
      || !vec(key.position) || !vec(key.target) || key.position.every((n, i) => n === (key.target as Vibi3DVec3)[i])) return null;
    previous = key.time;
  }
  return structuredClone(keys) as Vibi3DCameraKey[];
}
export function validateVibi3DLight(value: unknown): Vibi3DLight | null {
  if (!bag(value) || !VIBI3D_LIGHTS.includes(value.kind as Vibi3DLightKind) || !finite(value.intensity) || value.intensity < 0 || !hex(value.color)) return null;
  return { kind: value.kind as Vibi3DLightKind, intensity: value.intensity, color: value.color.toLowerCase() };
}
export function validateVibi3DAuthoringCommand(value: unknown): Vibi3DAuthoringCommand | null {
  if (!bag(value)) return null;
  if (value.type === 'wall') {
    const { type: _type, id, name = 'Wall', parentId, position, material, ...dimensions } = value;
    if (!only(dimensions, ['width', 'height', 'thickness', 'openings', 'creaseAngle'])) return null;
    return validateVibi3DAuthoringCommand({ type: 'create', name, recipe: { kind: 'wall', ...dimensions },
      ...(id === undefined ? {} : { id }), ...(parentId === undefined ? {} : { parentId }),
      ...(position === undefined ? {} : { position }), ...(material === undefined ? {} : { material }) });
  }
  if (value.type === 'create' && only(value, ['type', 'id', 'name', 'parentId', 'recipe', 'position', 'material']) && text(value.name)
    && (value.id === undefined || text(value.id)) && (value.parentId === undefined || text(value.parentId)) && (value.position === undefined || vec(value.position))
    && validateVibi3DRecipe(value.recipe) && (value.material === undefined || validateVibi3DMaterial(value.material))) {
    return { ...structuredClone(value), ...(value.material !== undefined ? { material: validateVibi3DMaterial(value.material)! } : {}) } as Extract<Vibi3DAuthoringCommand, { type: 'create' }>;
  }
  const camera = validateVibi3DCameraCommand(value); if (camera) return camera;
  if (value.type === 'group' && only(value, ['type', 'ids', 'name']) && text(value.name) && Array.isArray(value.ids) && value.ids.length > 0
    && value.ids.length <= 100 && value.ids.every(text)) return structuredClone(value) as Extract<Vibi3DAuthoringCommand, { type: 'group' }>;
  if (value.type === 'cameraMotion' && only(value, ['type', 'name', 'keys']) && text(value.name)) {
    const keys = cameraKeys(value.keys);
    return keys ? { type: 'cameraMotion', name: value.name, keys } : null;
  }
  if (value.type === 'light' && only(value, ['type', 'id', 'name', 'kind', 'position', 'intensity', 'color'])
    && (value.id === undefined || text(value.id)) && (value.name === undefined || text(value.name))
    && (value.kind === undefined || VIBI3D_LIGHTS.includes(value.kind as Vibi3DLightKind)) && (value.position === undefined || vec(value.position))
    && (value.intensity === undefined || (finite(value.intensity) && value.intensity >= 0 && value.intensity <= 100))
    && (value.color === undefined || hex(value.color)) && Object.keys(value).length > 1) {
    return structuredClone(value) as Extract<Vibi3DAuthoringCommand, { type: 'light' }>;
  }
  if (!text(value.id)) return null;
  if (value.type === 'delete' && only(value, ['type', 'id'])) return { type: 'delete', id: value.id };
  if (value.type === 'protect' && only(value, ['type', 'id', 'locked']) && typeof value.locked === 'boolean') return { type: 'protect', id: value.id, locked: value.locked };
  if (value.type === 'geometry' && only(value, ['type', 'id', 'recipe'])) {
    const recipe = validateVibi3DRecipe(value.recipe);
    return recipe ? { type: 'geometry', id: value.id, recipe } : null;
  }
  if (value.type === 'material') {
    const { type: _type, id: _id, ...settings } = value;
    if (Object.hasOwn(settings, 'material') && !only(settings, ['material'])) return null;
    const material = validateVibi3DMaterial(Object.hasOwn(settings, 'material') ? settings.material : settings);
    return material ? { type: 'material', id: value.id, material } : null;
  }
  if (value.type === 'duplicate' && only(value, ['type', 'id', 'count', 'offset']) && (value.offset === undefined || vec(value.offset))
    && (value.count === undefined || (Number.isInteger(value.count) && Number(value.count) > 0 && Number(value.count) <= 100))) {
    return structuredClone(value) as Extract<Vibi3DAuthoringCommand, { type: 'duplicate' }>;
  }
  if (value.type === 'motionRemove' && only(value, ['type', 'id', 'name']) && text(value.name)) return { type: 'motionRemove', id: value.id, name: value.name };
  if (value.type === 'motion' && only(value, ['type', 'id', 'name', 'keys', 'previousName']) && text(value.name)
    && (value.previousName === undefined || text(value.previousName))) {
    const keys = validateVibi3DMotionKeys(value.keys);
    return keys ? { type: 'motion', id: value.id, name: value.name, keys, ...(value.previousName ? { previousName: value.previousName as string } : {}) } : null;
  }
  return null;
}
