import type { ContextInventory, ContextScopeLevel } from '@vibisual/shared';

/** A rejected HTTP response must never leave an optimistic switch looking saved. */
async function checkedFetch(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Context request failed: ${response.status}`);
  return response;
}

export async function readContextInventory(agentId: string, subAgentId: string | null): Promise<ContextInventory> {
  const query = subAgentId ? `?sub=${encodeURIComponent(subAgentId)}` : '';
  const response = await checkedFetch(`/api/context-inventory/${encodeURIComponent(agentId)}${query}`);
  return response.json() as Promise<ContextInventory>;
}

export async function writeContextOverride(
  agentId: string,
  subAgentId: string | null,
  scope: ContextScopeLevel,
  sourceId: string,
  enabled: boolean | null,
): Promise<void> {
  await checkedFetch(`/api/context-overrides/${encodeURIComponent(agentId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceId, enabled, scope, ...(subAgentId ? { subAgentId } : {}) }),
  });
}

export async function resetContextOverrides(
  agentId: string,
  subAgentId: string | null,
  scope: ContextScopeLevel,
): Promise<void> {
  const query = `?scope=${scope}${subAgentId ? `&sub=${encodeURIComponent(subAgentId)}` : ''}`;
  await checkedFetch(`/api/context-overrides/${encodeURIComponent(agentId)}${query}`, { method: 'DELETE' });
}
