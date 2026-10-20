import { decorationBag as bag, decorationKeys as keys, decorationNumber as number, decorationVector as vector,
  decorationId, decorationSize, decorationIdentity, validateVibi3DImageSource, type Vibi3DImageSource } from './vibi3dDecorationValues.js';
import type { Vibi3DVec3 } from './vibi3d.js';

export interface Vibi3DDecalRecipe {
  target: string;
  /** Position and outward normal are expressed in the target mesh's local coordinates. */
  position: Vibi3DVec3; normal: Vibi3DVec3;
  /** Width, height, optional projection depth, in meters. */
  size: [number, number, number?]; rotation?: number;
  source: Vibi3DImageSource;
  /** auto uses surface projection; flat explicitly selects an offset alpha plane. */
  projection?: 'auto' | 'flat' | 'surface';
}
export type Vibi3DDecalCommand = { type: 'decal'; id?: string; name?: string } & Partial<Vibi3DDecalRecipe>;
function recipe(value: unknown, partial: boolean): Partial<Vibi3DDecalRecipe> | null {
  if (!bag(value) || !keys(value, ['target', 'position', 'normal', 'size', 'rotation', 'source', 'projection'])) return null;
  if (value.target !== undefined ? !decorationId(value.target) : !partial) return null;
  if (value.position !== undefined ? !vector(value.position) : !partial) return null;
  if (value.normal !== undefined ? !vector(value.normal) || Math.hypot(...value.normal) < 1e-8 : !partial) return null;
  if (value.size !== undefined ? !decorationSize(value.size) : !partial) return null;
  if (value.rotation !== undefined && !number(value.rotation, -360, 360)) return null;
  if (value.projection !== undefined && !['auto', 'flat', 'surface'].includes(value.projection as string)) return null;
  const source = value.source === undefined ? undefined : validateVibi3DImageSource(value.source);
  if (source === null || (!partial && !source)) return null;
  return { ...structuredClone(value), ...(source ? { source } : {}) } as Partial<Vibi3DDecalRecipe>;
}
export function validateVibi3DDecalRecipe(value: unknown): Vibi3DDecalRecipe | null { return recipe(value, false) as Vibi3DDecalRecipe | null; }
export function validateVibi3DDecalCommand(value: unknown): Vibi3DDecalCommand | null {
  if (!bag(value) || value.type !== 'decal') return null;
  const { type: _type, id: _id, name: _name, ...settings } = value;
  const identity = decorationIdentity(value, true), result = recipe(settings, true);
  return identity && result ? { type: 'decal', ...identity, ...result } as Vibi3DDecalCommand : null;
}
