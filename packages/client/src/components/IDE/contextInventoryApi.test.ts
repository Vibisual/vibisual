import { afterEach, describe, expect, it, vi } from 'vitest';
import { readContextInventory, resetContextOverrides, writeContextOverride } from './contextInventoryApi.js';

afterEach(() => vi.unstubAllGlobals());

describe('context inventory requests', () => {
  it('loads the selected agent and session without mixing query separators into their IDs', async () => {
    const inventory = { agentId: 'agent/a', items: [] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(inventory)));
    vi.stubGlobal('fetch', fetchMock);
    expect(await readContextInventory('agent/a', 'tab&one')).toEqual(inventory);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/context-inventory/agent%2Fa?sub=tab%26one');
  });

  it('persists a Codex override at the selected session layer and can restore inheritance', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await writeContextOverride('agent', 'tab', 'session', 'codex.instructions', false);
    await writeContextOverride('agent', 'tab', 'session', 'codex.instructions', null);
    for (const [index, enabled] of [false, null].entries()) {
      const [url, init] = fetchMock.mock.calls[index]!;
      expect(url).toBe('/api/context-overrides/agent');
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body)).toEqual({ sourceId: 'codex.instructions', enabled, scope: 'session', subAgentId: 'tab' });
    }
  });

  it('resets only the selected layer and omits absent sessions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await resetContextOverrides('agent', 'tab&one', 'session');
    await resetContextOverrides('agent', null, 'project');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/context-overrides/agent?scope=session&sub=tab%26one', { method: 'DELETE' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/context-overrides/agent?scope=project', { method: 'DELETE' });
  });

  it.each([400, 403, 500])('rejects HTTP %s for reads, toggles and resets instead of accepting it as success', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(null, { status }))));
    await expect(readContextInventory('agent', null)).rejects.toThrow(String(status));
    await expect(writeContextOverride('agent', null, 'agent', 'codex.skills', false)).rejects.toThrow(String(status));
    await expect(resetContextOverrides('agent', null, 'agent')).rejects.toThrow(String(status));
  });
});
