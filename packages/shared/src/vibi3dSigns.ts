import { decorationBag as bag, decorationKeys as keys, decorationNumber as number, decorationHex as hex,
  decorationSize, decorationIdentity, validateVibi3DImageSource, type Vibi3DDecorationIdentity, type Vibi3DImageSource } from './vibi3dDecorationValues.js';

export const VIBI3D_SIGN_KINDS = ['fascia', 'projecting', 'panel', 'channel', 'window', 'banner', 'rooftop'] as const;
/** Stable bundled font roles: renderers resolve these to the same OFL font files on every OS. */
export const VIBI3D_SIGN_FONTS = ['sans', 'serif', 'display'] as const;
export type Vibi3DSignKind = typeof VIBI3D_SIGN_KINDS[number];
export type Vibi3DSignFont = typeof VIBI3D_SIGN_FONTS[number];
export interface Vibi3DSignRecipe {
  kind: Vibi3DSignKind; text?: string; font?: Vibi3DSignFont; weight?: number; color?: string;
  /** Outline width in meters, not screen pixels. */
  outline?: { color: string; width: number };
  background?: string | false; layout?: 'horizontal' | 'vertical';
  /** Width, height, optional depth, in meters. Local front is +Z. */
  size?: [number, number, number?]; lit?: boolean; source?: Vibi3DImageSource;
}
export type Vibi3DSignCommand = { type: 'sign' } & Vibi3DDecorationIdentity & Partial<Vibi3DSignRecipe>;
const fields = ['kind', 'text', 'font', 'weight', 'color', 'outline', 'background', 'layout', 'size', 'lit', 'source'];
function recipe(value: unknown, partial: boolean): Partial<Vibi3DSignRecipe> | null {
  if (!bag(value) || !keys(value, fields)) return null;
  if (value.kind !== undefined ? !(VIBI3D_SIGN_KINDS as readonly unknown[]).includes(value.kind) : !partial) return null;
  if (value.text !== undefined && (typeof value.text !== 'string' || Array.from(value.text).length > 256 || /[\x00-\x09\x0b-\x1f\x7f]/.test(value.text))) return null;
  if (value.font !== undefined && !(VIBI3D_SIGN_FONTS as readonly unknown[]).includes(value.font)) return null;
  if (value.weight !== undefined && (!number(value.weight, 100, 900) || value.weight % 100 !== 0)) return null;
  if (value.color !== undefined && !hex(value.color)) return null;
  if (value.background !== undefined && value.background !== false && !hex(value.background)) return null;
  if (value.outline !== undefined && (!bag(value.outline) || !keys(value.outline, ['color', 'width']) || !hex(value.outline.color) || !number(value.outline.width, 0, 0.2))) return null;
  if (value.layout !== undefined && !['horizontal', 'vertical'].includes(value.layout as string)) return null;
  if (value.size !== undefined && !decorationSize(value.size)) return null;
  if (value.lit !== undefined && typeof value.lit !== 'boolean') return null;
  const source = value.source === undefined ? undefined : validateVibi3DImageSource(value.source);
  if (source === null || (!partial && !source && !(typeof value.text === 'string' && value.text.trim()))) return null;
  const result = structuredClone(value);
  for (const key of ['color', 'background']) if (hex(result[key])) result[key] = result[key].toLowerCase();
  if (bag(result.outline)) result.outline.color = (result.outline.color as string).toLowerCase();
  if (source) result.source = source;
  return result as Partial<Vibi3DSignRecipe>;
}
export function validateVibi3DSignRecipe(value: unknown): Vibi3DSignRecipe | null { return recipe(value, false) as Vibi3DSignRecipe | null; }
export function validateVibi3DSignCommand(value: unknown): Vibi3DSignCommand | null {
  if (!bag(value) || value.type !== 'sign') return null;
  const { type: _type, id: _id, name: _name, parentId: _parent, position: _position, rotation: _rotation, ...settings } = value;
  const identity = decorationIdentity(value), result = recipe(settings, true);
  return identity && result ? { type: 'sign', ...identity, ...result } : null;
}
