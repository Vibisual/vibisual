import { validateVibi3DLook, type Vibi3DLook } from '@vibisual/shared';

/** Preserve independent controls; selecting another preset starts from its defaults. */
export function mergeModelLook(current: unknown, patch: Vibi3DLook, intensity = 1): Vibi3DLook {
  const previous = validateVibi3DLook(current) ?? {};
  const base: Vibi3DLook = patch.preset !== undefined && patch.preset !== (previous.preset ?? 'studio')
    ? { intensity: previous.intensity ?? intensity } : previous;
  const next: Vibi3DLook = { ...base, ...patch };
  if (patch.sun) next.sun = { ...base.sun, ...patch.sun };
  for (const field of ['shadows', 'ao', 'bloom', 'fog'] as const) {
    const change = patch[field]; const before = base[field];
    if (change && typeof change === 'object') {
      Object.assign(next, { [field]: { ...(typeof before === 'boolean' ? { enabled: before } : before), ...change } });
    }
  }
  next.intensity ??= intensity;
  return next;
}
