import type { CodexInventory } from '@vibisual/shared';

/** Recent closed scopes are bounded; currently open panes retain their own inventory. */
export const CODEX_INVENTORY_RECENT_SCOPES = 32;

export function cacheCodexInventory(
  previous: Record<string, CodexInventory>,
  scope: string,
  inventory: CodexInventory,
  pinned: ReadonlySet<string>,
): Record<string, CodexInventory> {
  const next = { ...previous };
  // Object insertion order tracks publication recency without timestamps or another cache.
  delete next[scope];
  next[scope] = inventory;
  const recent = Object.keys(next).filter(key => !pinned.has(key));
  for (const key of recent.slice(0, Math.max(0, recent.length - CODEX_INVENTORY_RECENT_SCOPES))) delete next[key];
  return next;
}
