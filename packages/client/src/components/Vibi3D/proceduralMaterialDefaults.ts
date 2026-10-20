import type { Vibi3DMaterial, Vibi3DMaterialPreset } from '@vibisual/shared';

export interface ProceduralMaterialDefaults {
  /** These colors are baked into the color map; use a white material tint to avoid applying them twice. */
  color: string; secondaryColor: string; accentColor: string;
  roughness: number; metalness: number; normalStrength: number;
  /** Width and height of one texture repeat, in metres. */
  tileSize: [number, number];
  physical?: { transmission: number; ior: number; thickness: number; clearcoat: number };
  emissive?: string; emissiveIntensity?: number;
}
const surface = (color: string, secondaryColor: string, roughness: number, tileSize: [number, number],
  metalness = 0, normalStrength = 1, accentColor = '#69645d'): ProceduralMaterialDefaults =>
  ({ color, secondaryColor, accentColor, roughness, metalness, normalStrength, tileSize });

const DEFAULTS: Record<Vibi3DMaterialPreset, ProceduralMaterialDefaults> = {
  'painted-concrete': surface('#dfded8', '#b8b7af', 0.86, [2, 2], 0, 0.45),
  'wall-tile': surface('#e1dfd7', '#cbc8be', 0.52, [1.2, 1.2], 0, 0.9, '#85857f'),
  brick: surface('#a7593e', '#77412f', 0.9, [1.2, 0.6], 0, 1.15, '#a6a396'),
  granite: surface('#aaa9a4', '#555652', 0.76, [1, 1], 0, 0.5, '#e2e0d6'),
  pavers: surface('#d7d6ce', '#858784', 0.88, [1.2, 1.2], 0, 1.1, '#aaa99f'),
  asphalt: surface('#383c3e', '#747574', 0.96, [2, 2], 0, 0.6, '#929189'),
  kerb: surface('#bdbeb9', '#8c8f8b', 0.88, [1, 0.3], 0, 0.7),
  'wood-planks': surface('#9d7149', '#503925', 0.79, [1.2, 2.4], 0, 0.85, '#352b22'),
  'corrugated-metal': surface('#939c9b', '#657273', 0.48, [1, 2], 0.72, 1.8),
  aluminium: surface('#c4cdcf', '#889a9e', 0.31, [1, 1], 0.92, 0.16),
  glass: { ...surface('#d7eaf0', '#a4c4cf', 0.08, [2, 2], 0, 0.04),
    physical: { transmission: 0.9, ior: 1.5, thickness: 0.04, clearcoat: 1 } },
  'awning-fabric': surface('#ba3431', '#eeece3', 0.91, [1.2, 1.2], 0, 0.4),
  'emissive-acrylic': { ...surface('#efece2', '#d7d4c9', 0.34, [1, 1], 0, 0.12),
    emissive: '#fff3dc', emissiveIntensity: 0.65 },
  plastic: { ...surface('#cdb887', '#b59b6e', 0.38, [1, 1], 0, 0.18),
    physical: { transmission: 0, ior: 1.46, thickness: 0, clearcoat: 0.3 } },
  rubber: surface('#292a29', '#454741', 0.97, [0.5, 0.5], 0, 0.28),
  rust: surface('#9d4724', '#4b3025', 0.97, [1, 1], 0.15, 1.1, '#d0843a'),
};

/** Return a fresh value so editing one material never mutates the library defaults. */
export function materialPresetDefaults(preset: Vibi3DMaterialPreset): ProceduralMaterialDefaults {
  const value = DEFAULTS[preset];
  if (!value) throw new RangeError('material-preset-invalid');
  return { ...value, tileSize: [...value.tileSize], ...(value.physical ? { physical: { ...value.physical } } : {}) };
}

/** The maps already contain their colors and roughness: avoid multiplying either value twice. */
export function materialPresetProperties(preset: Vibi3DMaterialPreset): Vibi3DMaterial {
  const value = materialPresetDefaults(preset);
  return { color: '#ffffff', roughness: 1, metalness: value.metalness, tileSize: value.tileSize,
    ...(value.physical ? { physical: value.physical } : {}),
    ...(value.emissive ? { emissive: value.emissive, emissiveIntensity: value.emissiveIntensity } : {}) };
}
