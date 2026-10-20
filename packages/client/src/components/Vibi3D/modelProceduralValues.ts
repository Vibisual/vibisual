import type { Vibi3DMaterial } from '@vibisual/shared';
import { materialPresetDefaults } from './proceduralMaterialPixels.js';

/** Absolute authored PBR values are baked once; Three's color/roughness multipliers remain neutral. */
export function normalizeProceduralValues(merged: Vibi3DMaterial, change: Vibi3DMaterial, previous: Vibi3DMaterial, version: unknown, switching: boolean): void {
  if (!merged.preset) return;
  const defaults = materialPresetDefaults(merged.preset);
  const authored = version === 2 && !switching;
  merged.color = change.color ?? change.params?.color ?? (authored ? previous.color : previous.params?.color) ?? defaults.color;
  merged.roughness = change.roughness ?? change.params?.roughness
    ?? (authored ? previous.roughness : previous.params?.roughness) ?? defaults.roughness;
  merged.params = { ...merged.params, color: merged.color, roughness: merged.roughness };
  merged.resolution ??= 512;
}
