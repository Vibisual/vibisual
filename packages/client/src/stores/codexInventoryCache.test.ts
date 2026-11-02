import { expect, it } from 'vitest';
import type { CodexInventory } from '@vibisual/shared';
import { cacheCodexInventory, CODEX_INVENTORY_RECENT_SCOPES } from './codexInventoryCache.js';

const inventory: CodexInventory = { checkedAt: 1, skills: [], mcpServers: [], plugins: [], hooks: [], agentsDocs: [] };

it('bounds closed scopes while retaining every open pane scope', () => {
  const pinned = new Set(['open-a', 'open-b']);
  let cache: Record<string, CodexInventory> = { 'open-a': inventory, 'open-b': inventory };
  for (let i = 0; i < 200; i++) cache = cacheCodexInventory(cache, `closed-${i}`, inventory, pinned);
  expect(Object.keys(cache)).toHaveLength(CODEX_INVENTORY_RECENT_SCOPES + pinned.size);
  expect(cache['open-a']).toBe(inventory);
  expect(cache['open-b']).toBe(inventory);
  expect(cache['closed-0']).toBeUndefined();
  expect(cache['closed-199']).toBe(inventory);
});

it('a refreshed scope becomes recent without mutating the prior cache', () => {
  let cache: Record<string, CodexInventory> = {};
  for (let i = 0; i < CODEX_INVENTORY_RECENT_SCOPES; i++) cache = cacheCodexInventory(cache, `scope-${i}`, inventory, new Set());
  const before = cache;
  cache = cacheCodexInventory(cache, 'scope-0', inventory, new Set());
  cache = cacheCodexInventory(cache, 'new-scope', inventory, new Set());
  expect(cache['scope-0']).toBe(inventory);
  expect(cache['scope-1']).toBeUndefined();
  expect(before['scope-1']).toBe(inventory);
  expect(before['new-scope']).toBeUndefined();
});

it('an unpinned former pane ages out with other closed scopes', () => {
  let cache: Record<string, CodexInventory> = { 'old-pane': inventory };
  for (let i = 0; i < CODEX_INVENTORY_RECENT_SCOPES; i++) cache = cacheCodexInventory(cache, `scope-${i}`, inventory, new Set());
  expect(cache['old-pane']).toBeUndefined();
  expect(Object.keys(cache)).toHaveLength(CODEX_INVENTORY_RECENT_SCOPES);
});
