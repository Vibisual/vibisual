import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutoGoalState } from '@vibisual/shared';
import { AutoGoalClient } from './autoGoalClient.js';

function state(observed: number): AutoGoalState {
  return { enabled: true, observed, analyzedAt: 1, candidates: [], skills: [], minRuns: 3 };
}
function response(observed: number): Response {
  return new Response(JSON.stringify({ ok: true, state: state(observed), settings: { enabledProject: true } }));
}
function deferred(): { promise: Promise<Response>; resolve: (value: Response) => void } {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => vi.unstubAllGlobals());

describe('procedure state requests', () => {
  it('keeps an old project response out of the newly selected project even if abort is ignored', async () => {
    const old = deferred();
    const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(response(20));
    vi.stubGlobal('fetch', fetcher);
    const first = new AutoGoalClient('/old', 'agent', 'session');
    first.start();
    first.stop();
    const next = new AutoGoalClient('/new', 'agent', 'session');
    next.start();
    await vi.waitFor(() => expect(next.getSnapshot().state?.observed).toBe(20));
    old.resolve(response(10));
    await old.promise;
    await Promise.resolve();
    expect(first.getSnapshot().state).toBeNull();
    expect(next.getSnapshot().state?.observed).toBe(20);
    expect(fetcher.mock.calls[0]?.[1].signal.aborted).toBe(true);
    expect(fetcher.mock.calls[1]?.[0]).toContain('projectPath=%2Fnew&agentId=agent&subAgentId=session');
    next.stop();
  });

  it('keeps the latest refresh when an older request finishes last', async () => {
    const old = deferred();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(response(7)));
    const client = new AutoGoalClient('/project');
    client.start();
    await client.refresh();
    old.resolve(response(1));
    await old.promise;
    await Promise.resolve();
    expect(client.getSnapshot().state?.observed).toBe(7);
    client.stop();
  });

  it('supports effect cleanup and restart without accepting a pre-cleanup response', async () => {
    const old = deferred();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(response(9)));
    const client = new AutoGoalClient('/project');
    client.start();
    client.stop();
    client.start();
    await vi.waitFor(() => expect(client.getSnapshot().state?.observed).toBe(9));
    old.resolve(response(2));
    await old.promise;
    await Promise.resolve();
    expect(client.getSnapshot().state?.observed).toBe(9);
    client.stop();
  });

  it('surfaces failed reads and a manual refresh recovers instead of treating them as empty success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }))).mockResolvedValueOnce(response(5)));
    const client = new AutoGoalClient('/project');
    client.start();
    await vi.waitFor(() => expect(client.getSnapshot().error).toBe('load'));
    expect(client.getSnapshot().state).toBeNull();
    await client.refresh();
    expect(client.getSnapshot().error).toBeNull();
    expect(client.getSnapshot().state?.observed).toBe(5);
    client.stop();
  });

  it('serializes mutations, preserves revision, and reads back the server result without optimistic state', async () => {
    const write = deferred();
    const fetcher = vi.fn().mockResolvedValueOnce(response(3)).mockReturnValueOnce(write.promise).mockResolvedValueOnce(response(4));
    vi.stubGlobal('fetch', fetcher);
    const client = new AutoGoalClient('/project');
    client.start();
    await vi.waitFor(() => expect(client.getSnapshot().state?.observed).toBe(3));
    const pending = client.mutate('/api/auto-goal/skills/one/retire', { projectPath: '/project', revision: 'current-body' });
    await client.mutate('/api/auto-goal/skills/one/retire', {});
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(client.getSnapshot().saving).toBe(true);
    expect(client.getSnapshot().state?.observed).toBe(3);
    expect(JSON.parse(fetcher.mock.calls[1]?.[1].body)).toEqual({ projectPath: '/project', revision: 'current-body' });
    write.resolve(new Response(JSON.stringify({ ok: true })));
    await pending;
    expect(client.getSnapshot().state?.observed).toBe(4);
    expect(client.getSnapshot().saving).toBe(false);
    client.stop();
  });

  it('keeps a failed mutation visible across background refresh, then lets the user refresh', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(3)).mockResolvedValueOnce(new Response('{}', { status: 409 })).mockImplementation(() => Promise.resolve(response(4))));
    const client = new AutoGoalClient('/project');
    client.start();
    await vi.waitFor(() => expect(client.getSnapshot().state?.observed).toBe(3));
    await client.mutate('/api/auto-goal/skills/one/request-review', { projectPath: '/project', revision: 'outdated' });
    expect(client.getSnapshot().error).toBe('save');
    expect(client.getSnapshot().state?.observed).toBe(3);
    await client.refresh(false);
    expect(client.getSnapshot().error).toBe('save');
    await client.refresh();
    expect(client.getSnapshot().error).toBeNull();
    client.stop();
  });
});
