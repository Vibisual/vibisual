import { SPEC_GATE_STRENGTHS, type SpecReadingSettings } from '@vibisual/shared';
import { normalizeSpecSettings } from '@vibisual/plugins';

/** UI preference edits merge into the server's current settings, never a stale full client copy. */
export function patchSpecReadingPreferences(
  current: SpecReadingSettings | undefined,
  patch: unknown,
): SpecReadingSettings | null {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
  const values = patch as Record<string, unknown>;
  const keys = Object.keys(values);
  if (keys.length === 0 || keys.some((key) => key !== 'strength' && key !== 'roots')) return null;
  const next: Partial<SpecReadingSettings> = { ...current };
  if ('strength' in values) {
    const strength = SPEC_GATE_STRENGTHS.find((candidate) => candidate === values.strength);
    if (!strength) return null;
    next.strength = strength;
  }
  if ('roots' in values) {
    if (!Array.isArray(values.roots) || !values.roots.every((root): root is string => typeof root === 'string')) return null;
    next.roots = values.roots;
  }
  return normalizeSpecSettings(next);
}
