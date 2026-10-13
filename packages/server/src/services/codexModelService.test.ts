import { describe, expect, it, vi } from 'vitest';
import { CODEX_MODELS_REFRESH_INTERVAL_MS, type CodexModelEntry, type CodexModelCatalog } from '@vibisual/shared';
import { CodexModelService } from './codexModelService.js';
import { parseCodexModelListPage, parseCodexModelsCache } from './codexModelCatalog.js';
import { CODEX_MODEL_DISCOVERY } from './codexModelRpcConfig.js';

const model = (slug: string): CodexModelEntry => ({ slug, displayName: slug, reasoningLevels: ['medium'] });
function setup() {
  let now = 1_000;
  let context: { key: string; bin: string | null; home: string; authKey?: string } = {
    key: 'runtime-a', bin: 'codex', home: '/home-a', authKey: 'account-a',
  };
  const query = vi.fn<(...args: string[]) => Promise<CodexModelEntry[]>>().mockResolvedValue([model('live')]);
  const cache = vi.fn(() => [model('disk')]);
  const service = new CodexModelService({ context: () => context, query, cache, now: () => now });
  return { service, query, cache,
    tick: (ms: number): void => { now += ms; },
    context: (change: Partial<typeof context>): void => { context = { ...context, ...change }; },
  };
}

describe('official model catalog metadata', () => {
  it('uses declared effort/default/capabilities/upgrade without hardcoded model names', () => {
    const { models } = parseCodexModelListPage({ data: [{
      model: 'next-generation', displayName: 'Next generation', description: 'fixture',
      supportedReasoningEfforts: [{ reasoningEffort: 'extreme' }, { reasoningEffort: 'low' }],
      defaultReasoningEffort: 'extreme', inputModalities: ['text'],
      supportsPersonality: false, isDefault: true, upgrade: 'replacement',
    }, { model: 'hidden', hidden: true }], nextCursor: null });
    expect(models).toEqual([{
      slug: 'next-generation', displayName: 'Next generation', description: 'fixture',
      reasoningLevels: ['extreme', 'low'], defaultReasoningLevel: 'extreme', inputModalities: ['text'],
      supportsPersonality: false, isDefault: true, upgrade: 'replacement',
    }]);
  });

  it('distinguishes authoritative empty, hidden-only and malformed visible pages', () => {
    expect(parseCodexModelListPage({ data: [] }).models).toEqual([]);
    expect(parseCodexModelListPage({ data: [{ hidden: true }] }).models).toEqual([]);
    for (const page of [{}, { data: 'invalid' }, { data: [null] }, { data: [{ id: 'id-only' }] }]) {
      expect(() => parseCodexModelListPage(page)).toThrow();
    }
    expect(parseCodexModelListPage({ data: [{ model: 'old-schema' }] }).models[0]?.inputModalities).toEqual(['text', 'image']);
    expect(parseCodexModelsCache(JSON.stringify({ models: [{ slug: 'retired', visibility: 'hide' }] }))).toEqual([]);
  });
});

describe('Codex model catalog cache lifetime', () => {
  it('shares concurrent requests, respects TTL, and explicit refresh bypasses TTL', async () => {
    const { service, query, tick } = setup();
    const first = service.refresh();
    expect(service.refresh({ force: true })).toBe(first);
    const catalog = await first;
    expect(service.get()).toBe(catalog);
    await service.refresh();
    expect(query).toHaveBeenCalledOnce();
    tick(CODEX_MODELS_REFRESH_INTERVAL_MS);
    await service.refresh();
    await service.refresh({ force: true });
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('keeps last good data and success time on failure, then recovers after retry TTL', async () => {
    const { service, query, tick } = setup();
    await service.refresh();
    tick(50);
    query.mockRejectedValueOnce(new Error('network diagnostic'));
    const stale = await service.refresh({ force: true });
    expect(stale).toMatchObject({ models: [model('live')], source: 'app-server', stale: true, fetchedAt: 1_000, checkedAt: 1_050 });
    expect(stale.error).not.toContain('network diagnostic');
    await service.refresh();
    expect(query).toHaveBeenCalledTimes(2);
    tick(CODEX_MODEL_DISCOVERY.retryMs);
    expect(await service.refresh()).toMatchObject({ stale: false, source: 'app-server' });
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('uses disk only on initial failure and never revives it after successful empty discovery', async () => {
    const { service, query } = setup();
    query.mockRejectedValueOnce(new Error('unavailable'));
    expect(await service.refresh()).toMatchObject({ source: 'cache', stale: true, models: [model('disk')] });
    query.mockResolvedValueOnce([]);
    expect(await service.refresh({ force: true })).toMatchObject({ source: 'app-server', stale: false, models: [] });
    query.mockRejectedValueOnce(new Error('unavailable'));
    expect(await service.refresh({ force: true })).toMatchObject({ source: 'app-server', stale: true, models: [] });
  });

  it('only supplements matching verbosity metadata, never membership/defaults/efforts', async () => {
    const { service, cache, query } = setup();
    cache.mockReturnValue([{ ...model('live'), reasoningLevels: ['wrong'], isDefault: true, supportsVerbosity: true, defaultVerbosity: 'low' }, model('retired')]);
    query.mockResolvedValue([{ ...model('live'), isDefault: false }]);
    expect((await service.refresh()).models).toEqual([{
      ...model('live'), isDefault: false, supportsVerbosity: true, defaultVerbosity: 'low',
    }]);
  });

  it('does not invalidate on unknown auth probes, but drops the former account on identity change', async () => {
    const { service, context, query } = setup();
    const first = await service.refresh();
    context({ authKey: undefined });
    expect(await service.refresh()).toBe(first);
    expect(query).toHaveBeenCalledOnce();
    context({ authKey: 'account-b' });
    expect(service.get()).toBeNull();
    query.mockRejectedValueOnce(new Error('failed'));
    const next = await service.refresh();
    expect(next.source).toBe('cache');
    expect(next.models.map((entry) => entry.slug)).not.toContain('live');
  });

  it('invalidates explicit login/runtime changes and prevents late old-account overwrite', async () => {
    const { service, context, query } = setup();
    let finishOld!: (models: CodexModelEntry[]) => void;
    query.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    const old = service.refresh();
    context({ key: 'runtime-b', home: '/home-b', authKey: 'account-b' });
    query.mockResolvedValueOnce([model('new-account')]);
    const current = await service.refresh();
    finishOld([model('old-account')]);
    expect(await old).toBe(current);
    expect(service.get()?.models).toEqual([model('new-account')]);
    service.invalidate();
    expect(service.get()).toBeNull();
    await service.refresh();
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('returns fallback without spawning when CLI is unavailable', async () => {
    const { service, context, query } = setup();
    context({ bin: null, key: 'missing' });
    expect(await service.refresh()).toMatchObject({ source: 'cache', stale: true });
    expect(query).not.toHaveBeenCalled();
  });

  it('publishes the current account when invalidated after refresh commits but before its consumer runs', async () => {
    const { service, context, query } = setup();
    let finishOld!: (models: CodexModelEntry[]) => void;
    query.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    query.mockResolvedValueOnce([model('current-account')]);
    const consume = vi.fn((catalog: CodexModelCatalog) => {
      expect(catalog).toBe(service.get());
    });
    const published = service.publish(consume, { force: true });
    finishOld([model('former-account')]);
    // Probe completion, then refresh's cache commit: publication is still queued after finally.
    await Promise.resolve();
    await Promise.resolve();
    expect(service.get()?.models).toEqual([model('former-account')]);
    expect(consume).not.toHaveBeenCalled();
    context({ authKey: 'account-b' });
    service.invalidate();
    await published;
    expect(consume).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ models: [model('current-account')] }));
    expect(query).toHaveBeenCalledTimes(2);
  });
});
