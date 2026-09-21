import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';

const previous = {
  model: 'sonnet', tools: ['Read'], permissionMode: 'default', skills: [],
  provider: { kind: 'local-llama', modelId: 'old', modelName: 'Old' },
} as AgentConfig;
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status });
beforeEach(() => {
  useGraphStore.setState({ agentConfigs: { a: previous }, localModelWindow: { agentId: 'a' }, openIDEOverlay: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe('local model binding', () => {
  it('returns the server rejection without hiding the setup window or changing the model', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'A shard is missing.' }, 400)));
    expect(await useGraphStore.getState().bindLocalModel('a', 'next', 'Next')).toEqual({ ok: false, error: 'A shard is missing.' });
    expect(useGraphStore.getState().agentConfigs.a).toEqual(previous);
    expect(useGraphStore.getState().localModelWindow).toEqual({ agentId: 'a' });
    expect(useGraphStore.getState().openIDEOverlay).not.toHaveBeenCalled();
  });

  it('shows the failure when automatic entry needs to open the setup window', async () => {
    useGraphStore.setState({ localModelWindow: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'Model unavailable' }, 400)));
    await useGraphStore.getState().bindLocalModel('a', 'next', 'Next');
    expect(useGraphStore.getState().localModelWindow).toEqual({ agentId: 'a', error: 'Model unavailable' });
  });

  it('only closes the window and opens the IDE after successful binding', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ ok: true }));
    vi.stubGlobal('fetch', fetcher);
    expect(await useGraphStore.getState().bindLocalModel('a', 'next', 'Next')).toEqual({ ok: true });
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body).tools).toEqual(['Read']);
    expect(useGraphStore.getState().agentConfigs.a?.provider?.modelId).toBe('next');
    expect(useGraphStore.getState().localModelWindow).toBeNull();
    expect(useGraphStore.getState().openIDEOverlay).toHaveBeenCalledExactlyOnceWith('a');
  });

  it.each(['close', 'other'] as const)('late completion cannot reopen or replace a window after %s', async (action) => {
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    const pending = useGraphStore.getState().bindLocalModel('a', 'next', 'Next');
    const currentWindow = action === 'close' ? null : { agentId: 'b' };
    useGraphStore.setState({ localModelWindow: currentWindow });
    finish(json({ ok: true }));
    expect(await pending).toEqual({ ok: true });
    expect(useGraphStore.getState().localModelWindow).toEqual(currentWindow);
    expect(useGraphStore.getState().openIDEOverlay).not.toHaveBeenCalled();
  });

  it('uses HTTP status if an intermediary returned an HTML error page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<h1>Proxy error</h1>', { status: 502 })));
    expect(await useGraphStore.getState().bindLocalModel('a', 'next', 'Next')).toEqual({ ok: false, error: 'HTTP 502' });
  });

  it('uses the saved server configuration instead of stale counters from the old model', async () => {
    const config = { ...previous, provider: { kind: 'local-llama', modelId: 'next', modelName: 'Next', contextUsed: 0, toolSupport: 'unknown' } } as AgentConfig;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: true, config })));
    expect(await useGraphStore.getState().bindLocalModel('a', 'next', 'Next')).toEqual({ ok: true });
    expect(useGraphStore.getState().agentConfigs.a).toEqual(config);
  });

  it('does not claim success when the server kept the previous model', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: true, config: previous })));
    expect((await useGraphStore.getState().bindLocalModel('a', 'next', 'Next')).ok).toBe(false);
    expect(useGraphStore.getState().agentConfigs.a).toEqual(previous);
    expect(useGraphStore.getState().openIDEOverlay).not.toHaveBeenCalled();
  });
});
