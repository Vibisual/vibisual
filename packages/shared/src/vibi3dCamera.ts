import type { Vibi3DVec3 } from './vibi3d.js';

export const VIBI3D_CAMERA_ASPECTS = ['9:16', '16:9', '1:1'] as const;
export type Vibi3DCameraAspect = typeof VIBI3D_CAMERA_ASPECTS[number];
export interface Vibi3DCameraView {
  position: Vibi3DVec3; target: Vibi3DVec3;
  /** Millimeters on Three's 35 mm film gauge, or a vertical field of view in degrees; never both. */
  lens?: number; fov?: number; aspect?: Vibi3DCameraAspect;
}
export interface Vibi3DShot extends Vibi3DCameraView { id: string; name: string }
export type Vibi3DCameraCommand = { type: 'camera'; eyeHeight?: number; shot?: { id: string; name: string } } & Partial<Vibi3DCameraView>;
export interface Vibi3DShotRemoveCommand { type: 'shotRemove'; id: string }
export interface ResolvedVibi3DCameraView { position: Vibi3DVec3; target: Vibi3DVec3; fov: number; aspect: number; lens?: number }
export const VIBI3D_SHOT_LIMIT = 64;
type Bag = Record<string, unknown>;
const bag = (value: unknown): value is Bag => !!value && typeof value === 'object' && !Array.isArray(value);
const only = (value: Bag, allowed: readonly string[]): boolean => Object.keys(value).every(key => allowed.includes(key));
const number = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const vec = (value: unknown, max = 1e9): value is Vibi3DVec3 => Array.isArray(value) && value.length === 3 && value.every(n => number(n, -max, max));
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) && value !== 'current';
const name = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value && value !== 'current' && !/[\x00-\x1f\x7f]/.test(value);
export const isVibi3DCameraAspect = (value: unknown): value is Vibi3DCameraAspect => (VIBI3D_CAMERA_ASPECTS as readonly unknown[]).includes(value);
const fields = ['position', 'target', 'lens', 'fov', 'aspect'];
function view(value: unknown, partial: boolean): Partial<Vibi3DCameraView> | null {
  if (!bag(value) || !only(value, fields)) return null;
  for (const key of ['position', 'target']) if (value[key] !== undefined ? !vec(value[key], partial ? 10000 : 1e9) : !partial) return null;
  if (vec(value.position) && vec(value.target) && value.position.every((n, i) => n === (value.target as Vibi3DVec3)[i])) return null;
  if (value.lens !== undefined && !number(value.lens, 5, 500)) return null;
  if (value.fov !== undefined && !number(value.fov, 1, 179)) return null;
  if (value.lens !== undefined && value.fov !== undefined) return null;
  if (value.aspect !== undefined && !isVibi3DCameraAspect(value.aspect)) return null;
  return structuredClone(value) as Partial<Vibi3DCameraView>;
}
export function validateVibi3DCameraView(value: unknown): Vibi3DCameraView | null { return view(value, false) as Vibi3DCameraView | null; }
export function validateVibi3DShot(value: unknown): Vibi3DShot | null {
  if (!bag(value) || !id(value.id) || !name(value.name)) return null;
  const { id: shotId, name: shotName, ...settings } = value, camera = validateVibi3DCameraView(settings);
  return camera ? { id: shotId, name: shotName, ...camera } : null;
}
export function validateVibi3DShots(value: unknown): Vibi3DShot[] | null {
  if (!Array.isArray(value) || value.length > VIBI3D_SHOT_LIMIT) return null;
  const result: Vibi3DShot[] = [], references = new Set<string>();
  for (const raw of value) {
    const shot = validateVibi3DShot(raw); if (!shot || references.has(shot.id) || references.has(shot.name)) return null;
    // A string capture reference cannot ambiguously name another shot's id.
    references.add(shot.id); references.add(shot.name); result.push(shot);
  }
  return result;
}
export function validateVibi3DCameraCommand(value: unknown): Vibi3DCameraCommand | Vibi3DShotRemoveCommand | null {
  if (!bag(value)) return null;
  if (value.type === 'shotRemove') return only(value, ['type', 'id']) && id(value.id) ? { type: 'shotRemove', id: value.id } : null;
  if (value.type !== 'camera' || !only(value, ['type', ...fields, 'eyeHeight', 'shot'])) return null;
  const { type: _type, eyeHeight, shot, ...settings } = value;
  if (eyeHeight !== undefined && !number(eyeHeight, 0, 10000)) return null;
  if (shot !== undefined && (!bag(shot) || !only(shot, ['id', 'name']) || !id(shot.id) || !name(shot.name))) return null;
  // eyeHeight is an explicit Y override; validate the effective position against a provided target.
  const effective = eyeHeight !== undefined && vec(settings.position) ? { ...settings, position: [settings.position[0], eyeHeight, settings.position[2]] } : settings;
  if (!view(effective, true) || Object.keys(value).length === 1) return null;
  return structuredClone(value) as Vibi3DCameraCommand;
}
export function vibi3DCameraAspectRatio(aspect: Vibi3DCameraAspect | undefined, fallback = 1): number {
  return aspect === '9:16' ? 9 / 16 : aspect === '16:9' ? 16 / 9 : aspect === '1:1' ? 1 : number(fallback, 0.01, 100) ? fallback : 1;
}
/** Matches PerspectiveCamera.setFocalLength/getFilmHeight with the default 35 mm film gauge. */
export function resolveVibi3DCameraFov(value: Pick<Vibi3DCameraView, 'lens' | 'fov'>, aspect = 1, fallbackFov = 35): number {
  if (number(value.lens, 5, 500)) return 2 * Math.atan(35 / Math.max(vibi3DCameraAspectRatio(undefined, aspect), 1) / (2 * value.lens)) * 180 / Math.PI;
  return number(value.fov, 1, 179) ? value.fov : number(fallbackFov, 1, 179) ? fallbackFov : 35;
}
export function resolveVibi3DCameraView(value: unknown, aspect = 1, fallbackFov = 35): ResolvedVibi3DCameraView | null {
  const camera = validateVibi3DCameraView(value) ?? validateVibi3DShot(value); if (!camera) return null;
  const ratio = vibi3DCameraAspectRatio(camera.aspect, aspect);
  return { position: [...camera.position], target: [...camera.target], fov: resolveVibi3DCameraFov(camera, ratio, fallbackFov),
    aspect: ratio, ...(camera.lens !== undefined ? { lens: camera.lens } : {}) };
}
export function vibi3DCaptureSize(aspect: Vibi3DCameraAspect = '9:16', quality: 'draft' | 'final' = 'final'): [number, number] {
  if (aspect === '1:1') return [1080, 1080];
  const [short, long] = quality === 'final' ? [1080, 1920] : [720, 1280];
  return aspect === '16:9' ? [long!, short!] : [short!, long!];
}
