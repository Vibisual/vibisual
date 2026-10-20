import { validateVibi3DMaterialMapSource, type Vibi3DMaterialMapSource } from './vibi3dMaterials.js';
import type { Vibi3DVec3 } from './vibi3d.js';

export type Vibi3DImageSource = Exclude<Vibi3DMaterialMapSource, { kind: 'procedural' }>;
export interface Vibi3DDecorationIdentity { id?: string; name?: string; parentId?: string; position?: Vibi3DVec3; rotation?: Vibi3DVec3 }
export type DecorationBag = Record<string, unknown>;
export const decorationBag = (value: unknown): value is DecorationBag => !!value && typeof value === 'object' && !Array.isArray(value);
export const decorationKeys = (value: DecorationBag, allowed: readonly string[]): boolean => Object.keys(value).every(key => allowed.includes(key));
export const decorationNumber = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
export const decorationHex = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export const decorationId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
export const decorationVector = (value: unknown): value is Vibi3DVec3 => Array.isArray(value) && value.length === 3 && value.every(number => decorationNumber(number, -10000, 10000));
export function validateVibi3DImageSource(value: unknown): Vibi3DImageSource | null {
  const source = validateVibi3DMaterialMapSource(value);
  return source && source.kind !== 'procedural' ? source : null;
}
export function decorationSize(value: unknown): value is [number, number, number?] {
  return Array.isArray(value) && (value.length === 2 || value.length === 3)
    && value.slice(0, 2).every(number => decorationNumber(number, 0.01, 100))
    && (value.length === 2 || decorationNumber(value[2], 0.001, 10));
}
/** Reusable identity fields are data only; no executable or URL fields are accepted. */
export function decorationIdentity(value: DecorationBag, decal = false): Vibi3DDecorationIdentity | null {
  if (value.id !== undefined && !decorationId(value.id)) return null;
  if (value.name !== undefined && (typeof value.name !== 'string' || !value.name.length || value.name.length > 200)) return null;
  if (value.parentId !== undefined && (decal || !decorationId(value.parentId))) return null;
  if (!decal && ((value.position !== undefined && !decorationVector(value.position)) || (value.rotation !== undefined && !decorationVector(value.rotation)))) return null;
  return { ...(value.id !== undefined ? { id: value.id as string } : {}), ...(value.name !== undefined ? { name: value.name as string } : {}),
    ...(value.parentId !== undefined ? { parentId: value.parentId as string } : {}),
    ...(!decal && value.position !== undefined ? { position: [...value.position as Vibi3DVec3] } : {}),
    ...(!decal && value.rotation !== undefined ? { rotation: [...value.rotation as Vibi3DVec3] } : {}) };
}
