import { decorationBag as bag, decorationKeys as keys, decorationNumber as number, decorationHex as hex,
  decorationIdentity, validateVibi3DImageSource, type Vibi3DDecorationIdentity, type Vibi3DImageSource } from './vibi3dDecorationValues.js';

export interface Vibi3DMascotRecipe {
  /** Native curved primitives, or an alpha image standee; no generated 3D asset. */
  style: 'round' | 'standee'; height?: number;
  colors?: { body?: string; accent?: string; face?: string };
  source?: Vibi3DImageSource;
}
export type Vibi3DMascotCommand = { type: 'mascot' } & Vibi3DDecorationIdentity & Partial<Vibi3DMascotRecipe>;
function recipe(value: unknown, partial: boolean): Partial<Vibi3DMascotRecipe> | null {
  if (!bag(value) || !keys(value, ['style', 'height', 'colors', 'source'])) return null;
  if (value.style !== undefined ? !['round', 'standee'].includes(value.style as string) : !partial) return null;
  if (value.height !== undefined && !number(value.height, 0.1, 20)) return null;
  if (value.colors !== undefined && (!bag(value.colors) || !keys(value.colors, ['body', 'accent', 'face']) || !Object.values(value.colors).every(hex))) return null;
  const source = value.source === undefined ? undefined : validateVibi3DImageSource(value.source);
  if (source === null || (!partial && ((value.style === 'standee' && !source) || (value.style === 'round' && source)))) return null;
  const result = structuredClone(value);
  if (bag(result.colors)) for (const key of Object.keys(result.colors)) result.colors[key] = (result.colors[key] as string).toLowerCase();
  if (source) result.source = source;
  return result as Partial<Vibi3DMascotRecipe>;
}
export function validateVibi3DMascotRecipe(value: unknown): Vibi3DMascotRecipe | null { return recipe(value, false) as Vibi3DMascotRecipe | null; }
export function validateVibi3DMascotCommand(value: unknown): Vibi3DMascotCommand | null {
  if (!bag(value) || value.type !== 'mascot') return null;
  const { type: _type, id: _id, name: _name, parentId: _parent, position: _position, rotation: _rotation, ...settings } = value;
  const identity = decorationIdentity(value), result = recipe(settings, true);
  return identity && result ? { type: 'mascot', ...identity, ...result } : null;
}
