import { describe, expect, it, vi } from 'vitest';
import { CodexModelCatalogClient } from './codexModelCatalogClient.js';

const catalog = { models: [{ slug: 'next-model', displayName: 'Next', reasoningLevels: ['max', 'ultra'] }], checkedAt: 1 };

describe('Codex catalog requests', () => {
  it('coalesces simultaneous window, focus and selector requests', async () => {
    let finish!: (response: Response) => void;
    const request = vi.fn<typeof fetch>(() => new Promise((resolve) => { finish = resolve; }));
    const client = new CodexModelCatalogClient(request);
    const first = client.refresh(false);
    const second = client.refresh(false);
    expect(second).toBe(first);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/api/codex-models', { method: 'GET' });
    finish(new Response(JSON.stringify(catalog)));
    await expect(first).resolves.toEqual(catalog);
  });

  it('reserves force refresh for an explicit refresh request', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(catalog)));
    await new CodexModelCatalogClient(request).refresh(true);
    expect(request).toHaveBeenCalledWith('/api/codex-models/refresh', { method: 'POST' });
  });

  it('queues one forced refresh after an in-flight GET instead of losing manual intent', async () => {
    const finish: ((response: Response) => void)[] = [];
    const request = vi.fn<typeof fetch>(() => new Promise((resolve) => { finish.push(resolve); }));
    const client = new CodexModelCatalogClient(request);
    const get = client.refresh(false);
    const manual = client.refresh(true);
    expect(client.refresh(true)).toBe(manual);
    expect(request).toHaveBeenCalledTimes(1);
    finish[0]!(new Response(JSON.stringify(catalog)));
    await get;
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith('/api/codex-models/refresh', { method: 'POST' });
    const fresh = { ...catalog, checkedAt: 2 };
    finish[1]!(new Response(JSON.stringify(fresh)));
    await expect(manual).resolves.toEqual(fresh);
  });

  it('returns no replacement catalog on failures and permits retry', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [] }), { status: 503 }))
      .mockResolvedValueOnce(new Response('broken'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify(catalog)));
    const client = new CodexModelCatalogClient(request);
    for (let i = 0; i < 3; i++) await expect(client.refresh(false)).resolves.toBeNull();
    await expect(client.refresh(false)).resolves.toEqual(catalog);
  });

  it('a GET consumer refreshing again joins the queued POST without a promise cycle', async () => {
    const finish: ((response: Response) => void)[] = [];
    const request = vi.fn<typeof fetch>(() => new Promise((resolve) => { finish.push(resolve); }));
    const client = new CodexModelCatalogClient(request);
    const get = client.refresh(false);
    // Register this callback before queueing force, so it runs first as the GET settles.
    const followup = get.then(() => client.refresh(false));
    const manual = client.refresh(true);
    finish[0]!(new Response(JSON.stringify(catalog)));
    await get;
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith('/api/codex-models/refresh', { method: 'POST' });
    const fresh = { ...catalog, checkedAt: 2 };
    finish[1]!(new Response(JSON.stringify(fresh)));
    await expect(Promise.all([manual, followup])).resolves.toEqual([fresh, fresh]);
  });
});
