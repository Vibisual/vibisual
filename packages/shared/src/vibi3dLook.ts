/** Shared scene values only; renderer modules stay in the Vibi3D app chunk. */
export type Vibi3DLookPreset = 'studio' | 'daylight' | 'sunset' | 'overcast' | 'night-street';
export type Vibi3DToneMapping = 'none' | 'aces' | 'agx' | 'neutral';
export interface Vibi3DSun { azimuth: number; elevation: number; intensity: number; color: string }
export interface Vibi3DShadows { enabled: boolean; mapSize: number; bias: number; normalBias: number; radius: number }
export interface Vibi3DAO { enabled: boolean; intensity: number; radius: number }
export interface Vibi3DBloom { enabled: boolean; strength: number; threshold: number; radius: number }
export interface Vibi3DFog { enabled: boolean; color: string; density: number }
export interface Vibi3DLook {
  preset?: Vibi3DLookPreset;
  /** The existing single lighting level; multiplies the preset's lights/environment. */
  intensity?: number;
  exposure?: number;
  toneMapping?: Vibi3DToneMapping;
  sun?: Partial<Vibi3DSun>;
  shadows?: boolean | Partial<Vibi3DShadows>;
  ao?: boolean | Partial<Vibi3DAO>;
  bloom?: boolean | Partial<Vibi3DBloom>;
  fog?: boolean | Partial<Vibi3DFog>;
  quality?: 'auto' | 'draft' | 'final';
}
export interface ResolvedVibi3DLook {
  preset: Vibi3DLookPreset;
  intensity: number;
  exposure: number;
  toneMapping: Vibi3DToneMapping;
  sun: Vibi3DSun;
  shadows: Vibi3DShadows;
  ao: Vibi3DAO;
  bloom: Vibi3DBloom;
  fog: Vibi3DFog;
  quality: 'auto' | 'draft' | 'final';
}
export interface Vibi3DNodeShadows { cast: boolean; receive: boolean }

const studio: ResolvedVibi3DLook = {
  preset: 'studio', intensity: 1, exposure: 1, toneMapping: 'none', quality: 'auto',
  // Matches the legacy key position [3, 5, 4]; the studio renderer keeps its RoomEnvironment/fill.
  sun: { azimuth: 36.86989764584402, elevation: 45, intensity: 1.4, color: '#ffffff' },
  shadows: { enabled: false, mapSize: 2048, bias: -0.0001, normalBias: 0.02, radius: 2 },
  ao: { enabled: false, intensity: 1, radius: 1 },
  bloom: { enabled: false, strength: 0.15, threshold: 1, radius: 0.35 },
  fog: { enabled: false, color: '#d7e6f2', density: 0.002 },
};
// Meter-sized buildings need local contact shade, not a 1.5 m dark halo around every ledge.
const outdoorAO = { enabled: true, intensity: 0.55, radius: 0.4 };
const outdoorShadows = { ...studio.shadows, enabled: true, radius: 1 };
/** Presets describe light and color; quality changes resolution/sampling, never these values. */
export const VIBI3D_LOOK_PRESETS: Readonly<Record<Vibi3DLookPreset, ResolvedVibi3DLook>> = {
  studio,
  daylight: { ...studio, preset: 'daylight', toneMapping: 'aces',
    sun: { azimuth: 135, elevation: 50, intensity: 3, color: '#fff4dd' },
    shadows: outdoorShadows, ao: outdoorAO,
    bloom: { ...studio.bloom, enabled: true, strength: 0.1 }, fog: { ...studio.fog, enabled: true } },
  sunset: { ...studio, preset: 'sunset', toneMapping: 'aces', exposure: 0.95,
    sun: { azimuth: 255, elevation: 9, intensity: 2.3, color: '#ffd19a' },
    shadows: outdoorShadows, ao: outdoorAO,
    bloom: { ...studio.bloom, enabled: true }, fog: { ...studio.fog, enabled: true, color: '#f4cbb0', density: 0.003 } },
  overcast: { ...studio, preset: 'overcast', toneMapping: 'aces', exposure: 1.1,
    sun: { azimuth: 135, elevation: 60, intensity: 0.55, color: '#e2ebff' },
    ao: { ...outdoorAO, intensity: 0.7 }, fog: { ...studio.fog, enabled: true, density: 0.004 } },
  'night-street': { ...studio, preset: 'night-street', toneMapping: 'aces', exposure: 1.2,
    sun: { azimuth: 210, elevation: 25, intensity: 0.12, color: '#b5cdff' },
    shadows: outdoorShadows, ao: outdoorAO,
    bloom: { ...studio.bloom, enabled: true, strength: 0.45, threshold: 0.75 },
    fog: { ...studio.fog, enabled: true, color: '#27364e', density: 0.006 } },
};
type Bag = Record<string, unknown>;
type Rule = readonly [number, number] | readonly string[] | 'boolean' | 'color' | 'mapSize';
const schemas: Record<string, Record<string, Rule>> = {
  sun: { azimuth: [-360, 360], elevation: [-90, 90], intensity: [0, 100], color: 'color' },
  shadows: { enabled: 'boolean', mapSize: 'mapSize', bias: [-0.05, 0.05], normalBias: [0, 1], radius: [0, 16] },
  ao: { enabled: 'boolean', intensity: [0, 5], radius: [0.01, 10] },
  bloom: { enabled: 'boolean', strength: [0, 5], threshold: [0, 10], radius: [0, 1] },
  fog: { enabled: 'boolean', color: 'color', density: [0, 0.1] },
};
const scalar: Record<string, Rule> = { preset: Object.keys(VIBI3D_LOOK_PRESETS), intensity: [0, 10], exposure: [0, 10],
  toneMapping: ['none', 'aces', 'agx', 'neutral'], quality: ['auto', 'draft', 'final'] };
function bag(value: unknown): value is Bag { return !!value && typeof value === 'object' && !Array.isArray(value); }
function accepted(value: unknown, rule: Rule): boolean {
  if (rule === 'boolean') return typeof value === 'boolean';
  if (rule === 'color') return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  if (rule === 'mapSize') return typeof value === 'number' && [256, 512, 1024, 2048, 4096].includes(value);
  return typeof rule[0] === 'number'
    ? typeof value === 'number' && Number.isFinite(value) && value >= rule[0] && value <= (rule[1] as number)
    : typeof value === 'string' && (rule as readonly string[]).includes(value);
}
function fields(value: Bag, schema: Record<string, Rule>): Bag | null {
  const result: Bag = {};
  for (const [key, item] of Object.entries(value)) {
    const rule = Object.hasOwn(schema, key) ? schema[key] : undefined;
    if (!rule || !accepted(item, rule)) return null;
    result[key] = rule === 'color' ? (item as string).toLowerCase() : item;
  }
  return result;
}
/** Strict bounded settings, also used for persisted metadata. Missing settings keep legacy defaults. */
export function validateVibi3DLook(value: unknown): Vibi3DLook | null {
  if (!bag(value)) return null;
  const result: Bag = {};
  for (const [key, item] of Object.entries(value)) {
    if (Object.hasOwn(schemas, key)) {
      if (key !== 'sun' && typeof item === 'boolean') result[key] = item;
      else {
        const parsed = bag(item) ? fields(item, schemas[key]!) : null;
        if (!parsed) return null;
        result[key] = parsed;
      }
    } else {
      const parsed = fields({ [key]: item }, scalar);
      if (!parsed) return null;
      Object.assign(result, parsed);
    }
  }
  return result as Vibi3DLook;
}
export function validateVibi3DNodeShadows(value: unknown): Partial<Vibi3DNodeShadows> | null {
  if (!bag(value) || !Object.keys(value).length) return null;
  return fields(value, { cast: 'boolean', receive: 'boolean' });
}
function effect<T extends { enabled: boolean }>(base: T, value: boolean | Partial<T> | undefined): T {
  return { ...base, ...(typeof value === 'boolean' ? { enabled: value } : value) };
}
export function resolveVibi3DLook(value?: unknown, legacyIntensity = 1): ResolvedVibi3DLook {
  const parsed = validateVibi3DLook(value) ?? {};
  const preset = VIBI3D_LOOK_PRESETS[parsed.preset ?? 'studio'];
  const legacy = Number.isFinite(legacyIntensity) && legacyIntensity >= 0 && legacyIntensity <= 10 ? legacyIntensity : 1;
  return { ...preset, ...parsed, intensity: parsed.intensity ?? legacy,
    sun: { ...preset.sun, ...parsed.sun }, shadows: effect(preset.shadows, parsed.shadows),
    ao: effect(preset.ao, parsed.ao), bloom: effect(preset.bloom, parsed.bloom), fog: effect(preset.fog, parsed.fog) };
}
