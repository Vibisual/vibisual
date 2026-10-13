import type { CodexModelEntry } from '@vibisual/shared';

export function modelRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Normalize the public RPC catalog and the legacy read-only fallback separately. */
function modelEntry(value: unknown, rpc: boolean): CodexModelEntry | undefined {
  const rec = modelRecord(value);
  if (!rec || rec.hidden === true || (!rpc && rec.visibility === 'hide')) return undefined;
  const slug = text(rpc ? rec.model : rec.slug);
  if (!slug) return undefined;
  const levels = rpc ? rec.supportedReasoningEfforts : rec.supported_reasoning_levels;
  const reasoningLevels = Array.isArray(levels) ? [...new Set(levels.flatMap((level): string[] => {
    const entry = modelRecord(level);
    const effort = text(entry ? entry[rpc ? 'reasoningEffort' : 'effort'] : level);
    return effort ? [effort] : [];
  }))] : [];
  const model: CodexModelEntry = {
    slug, displayName: text(rpc ? rec.displayName : rec.display_name) ?? slug, reasoningLevels,
  };
  const description = text(rec.description);
  if (description) model.description = description;
  const effort = text(rpc ? rec.defaultReasoningEffort : rec.default_reasoning_level);
  if (effort && reasoningLevels.includes(effort)) model.defaultReasoningLevel = effort;
  const verbositySupport = rpc ? rec.supportsVerbosity : rec.support_verbosity;
  if (typeof verbositySupport === 'boolean') model.supportsVerbosity = verbositySupport;
  const verbosity = text(rpc ? rec.defaultVerbosity : rec.default_verbosity);
  if (verbosity) model.defaultVerbosity = verbosity;
  if (typeof rec.isDefault === 'boolean') model.isDefault = rec.isDefault;
  const modalities = rpc ? rec.inputModalities : rec.input_modalities;
  if (Array.isArray(modalities)) model.inputModalities = modalities.flatMap((value): string[] => {
    const modality = text(value);
    return modality ? [modality] : [];
  });
  // Public app-server docs specify text+image when older catalogs omit this field.
  else if (rpc) model.inputModalities = ['text', 'image'];
  const personality = rpc ? rec.supportsPersonality : rec.supports_personality;
  if (typeof personality === 'boolean') model.supportsPersonality = personality;
  const upgrade = text(rec.upgrade);
  if (upgrade) model.upgrade = upgrade;
  return model;
}

export function parseCodexModelListPage(value: unknown): { models: CodexModelEntry[]; nextCursor?: string } {
  const page = modelRecord(value);
  if (!page || !Array.isArray(page.data)) throw new Error('Codex model catalog response invalid');
  if (page.nextCursor !== undefined && page.nextCursor !== null && typeof page.nextCursor !== 'string') {
    throw new Error('Codex model catalog cursor invalid');
  }
  const models = page.data.flatMap((value): CodexModelEntry[] => {
    const rec = modelRecord(value);
    if (rec?.hidden === true) return [];
    const entry = modelEntry(value, true);
    if (!entry) throw new Error('Codex model catalog entry invalid');
    return [entry];
  });
  return { models, ...(text(page.nextCursor) ? { nextCursor: text(page.nextCursor) } : {}) };
}

/** A local catalog is a fallback, never proof of the signed-in account's access. */
export function parseCodexModelsCache(raw: string): CodexModelEntry[] {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return []; }
  const cache = modelRecord(value);
  if (!cache || !Array.isArray(cache.models)) return [];
  return cache.models.flatMap((value): CodexModelEntry[] => {
    const entry = modelEntry(value, false);
    return entry ? [entry] : [];
  });
}
