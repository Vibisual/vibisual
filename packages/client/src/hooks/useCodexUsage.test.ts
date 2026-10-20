import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodexAuthStatus, ProviderUsage } from '@vibisual/shared';
import { reconcileCodexUsage, refreshCodexUsage, useCodexUsage } from './useCodexUsage.js';

const previous: ProviderUsage = {
  windows: [{ id: 'codex:primary', label: 'Codex', usedPercent: 42, resetsAt: 1000 }],
  fetchedAt: 100,
};

describe('Codex usage refresh stability', () => {
  it('keeps the measured values and actual measurement time when a refresh fails', () => {
    const failed = reconcileCodexUsage(previous, { windows: [], fetchedAt: 200, error: 'unavailable' });
    expect(failed).toEqual({ ...previous, error: 'unavailable' });
    expect(reconcileCodexUsage(failed, { windows: [], fetchedAt: 300, error: 'unavailable' })).toEqual(failed);
    expect(previous.error).toBeUndefined();
  });

  it('accepts a real reset to zero and clears the previous error on recovery', () => {
    const incoming = { windows: [{ ...previous.windows[0]!, usedPercent: 0, resetsAt: 2000 }], fetchedAt: 400 };
    expect(reconcileCodexUsage({ ...previous, error: 'unavailable' }, incoming)).toEqual(incoming);
  });

  it('does not invent measurements on initial failure', () => {
    const failed = { windows: [], fetchedAt: 200, error: 'unavailable' };
    expect(reconcileCodexUsage(null, failed)).toEqual(failed);
  });

  it('retains credit-only and reset-pass-only measurements when refresh fails', () => {
    for (const measurement of [
      { credits: { hasCredits: true, unlimited: false, balance: '12.50' } },
      { credits: { hasCredits: false, unlimited: false, balance: '0' } },
      { resetCredits: { availableCount: 2 } },
      { resetCredits: { availableCount: 0, credits: [] } },
    ]) {
      const previous = { windows: [], fetchedAt: 100, ...measurement };
      expect(reconcileCodexUsage(previous, { windows: [], fetchedAt: 200, error: 'unavailable' }))
        .toEqual({ ...previous, error: 'unavailable' });
    }
  });

  it('accepts a real credit-only update and zero remaining passes, clearing stale errors', () => {
    const previous = { windows: [], fetchedAt: 100, error: 'unavailable', credits: { hasCredits: true, unlimited: true } };
    const incoming = { windows: [], fetchedAt: 200, credits: { hasCredits: false, unlimited: false, balance: '0' }, resetCredits: { availableCount: 0 } };
    expect(reconcileCodexUsage(previous, incoming)).toEqual(incoming);
  });

  it('keeps row order stable when RPC buckets arrive in a different order without mutating the input', () => {
    const windows = ['z:secondary', 'codex:secondary', 'z:primary', 'codex:primary']
      .map(id => ({ id, label: id, usedPercent: 10 }));
    const first = reconcileCodexUsage(null, { windows, fetchedAt: 100 });
    const second = reconcileCodexUsage(first, { windows: [...windows].reverse(), fetchedAt: 200 });
    expect(first.windows.map(w => w.id)).toEqual(['codex:primary', 'codex:secondary', 'z:primary', 'z:secondary']);
    expect(second.windows).toEqual(first.windows);
    expect(windows[0]!.id).toBe('z:secondary');
  });
});

describe('Codex usage account boundaries', () => {
  let renderer: ReactTestRenderer | undefined;
  let snapshot: ReturnType<typeof useCodexUsage>;
  function Observer({ auth, enabled = true }: { auth: CodexAuthStatus | null; enabled?: boolean }) {
    snapshot = useCodexUsage(enabled, auth);
    return null;
  }
  function response(balance: string): Response {
    return { ok: true, json: async () => ({ windows: [], fetchedAt: 100,
      credits: { hasCredits: true, unlimited: false, balance } }) } as Response;
  }
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
  }
  afterEach(() => {
    act(() => { renderer?.unmount(); });
    renderer = undefined;
    vi.unstubAllGlobals();
  });

  it('clears the previous balance before a new account refresh fails', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response('10')).mockRejectedValueOnce(new Error('unavailable'));
    vi.stubGlobal('fetch', fetch);
    const auth = { loggedIn: true, account: 'failure-a@example.com', checkedAt: 100 };
    await act(async () => { renderer = create(createElement(Observer, { auth })); });
    expect(snapshot!.usage?.credits?.balance).toBe('10');
    await act(async () => { renderer!.update(createElement(Observer, {
      auth: { loggedIn: true, account: 'failure-b@example.com', checkedAt: 200 },
    })); });
    expect(snapshot!.usage?.credits).toBeUndefined();
    expect(snapshot!.usage?.error).toBe('unavailable');
  });

  it('does not let an old account response overwrite the new account result', async () => {
    const old = deferred<Response>();
    const current = deferred<Response>();
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    vi.stubGlobal('fetch', fetch);
    await act(async () => { renderer = create(createElement(Observer, {
      auth: { loggedIn: true, account: 'late-a@example.com', checkedAt: 100 },
    })); });
    await act(async () => { renderer!.update(createElement(Observer, {
      auth: { loggedIn: true, account: 'late-b@example.com', checkedAt: 200 },
    })); });
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => { current.resolve(response('20')); });
    expect(snapshot!.usage?.credits?.balance).toBe('20');
    await act(async () => { old.resolve(response('10')); });
    expect(snapshot!.usage?.credits?.balance).toBe('20');
  });

  it('keeps the new account request busy and deduplicated when the old account request finishes first', async () => {
    const old = deferred<Response>();
    const current = deferred<Response>();
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    vi.stubGlobal('fetch', fetch);
    await act(async () => { renderer = create(createElement(Observer, {
      auth: { loggedIn: true, account: 'first-a@example.com', checkedAt: 100 },
    })); });
    await act(async () => { renderer!.update(createElement(Observer, {
      auth: { loggedIn: true, account: 'first-b@example.com', checkedAt: 200 },
    })); });
    const currentRequest = refreshCodexUsage();
    await act(async () => { old.resolve(response('10')); });
    expect(snapshot!.usage).toBeNull();
    expect(snapshot!.busy).toBe(true);
    expect(refreshCodexUsage()).toBe(currentRequest);
    await act(async () => { current.resolve(response('20')); await currentRequest; });
    expect(snapshot!.usage?.credits?.balance).toBe('20');
  });

  it('clears balances on logout while disabled and preserves same-account data through ordinary auth polls and failures', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response('10')).mockRejectedValueOnce(new Error('unavailable'));
    vi.stubGlobal('fetch', fetch);
    const auth = { loggedIn: true, account: 'stable@example.com', checkedAt: 100 };
    await act(async () => { renderer = create(createElement(Observer, { auth })); });
    await act(async () => { renderer!.update(createElement(Observer, { auth: { ...auth, checkedAt: 200 } })); });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await refreshCodexUsage(); });
    expect(snapshot!.usage?.credits?.balance).toBe('10');
    expect(snapshot!.usage?.error).toBe('unavailable');
    await act(async () => { renderer!.update(createElement(Observer, {
      auth: { loggedIn: false, checkedAt: 300 }, enabled: false,
    })); });
    expect(snapshot!.usage).toBeNull();
  });

  it('treats a new unnamed-auth revision as an account boundary', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response('10')).mockRejectedValueOnce(new Error('unavailable'));
    vi.stubGlobal('fetch', fetch);
    await act(async () => { renderer = create(createElement(Observer, { auth: { loggedIn: true, checkedAt: 100 } })); });
    await act(async () => { renderer!.update(createElement(Observer, { auth: { loggedIn: true, checkedAt: 200 } })); });
    expect(snapshot!.usage?.credits).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
