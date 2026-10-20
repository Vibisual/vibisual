import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loaders = vi.hoisted(() => new Map<string, () => Promise<unknown>>());
vi.mock('./registry.js', () => ({
  getInternalApp: (id: string) => {
    const main = loaders.get(id);
    return main ? { shells: { main } } : undefined;
  },
}));

import { peekPrefetchedShell, prefetchAppShell, rememberShell } from './prefetchAppShell.js';

const Shell = (): null => null;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); loaders.clear(); });

describe('§5.13 (X) 39-2 앱 화면 미리 받기', () => {
  it('누르면 바로 받고, 받은 화면은 늦은 로더를 거치지 않고 꺼낼 수 있다', async () => {
    const load = vi.fn(async () => Shell);
    loaders.set('now-app', load);
    expect(peekPrefetchedShell('now-app', 'main')).toBeNull();
    prefetchAppShell('now-app', { now: true });
    prefetchAppShell('now-app', { now: true });
    await vi.waitFor(() => expect(peekPrefetchedShell('now-app', 'main')).toBe(Shell));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('손이 올라가면 한가할 때 받는다 · 그 사이 누르면 바로 받고 나중 차례는 아무것도 안 한다', async () => {
    const load = vi.fn(async () => Shell);
    loaders.set('idle-app', load);
    prefetchAppShell('idle-app');
    prefetchAppShell('idle-app');
    expect(load).not.toHaveBeenCalled();
    prefetchAppShell('idle-app', { now: true });
    expect(load).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('받다가 실패하면 다음 손짓이 다시 받는다 · 없는 앱은 조용하다', async () => {
    const load = vi.fn<() => Promise<unknown>>().mockRejectedValueOnce(new Error('chunk')).mockResolvedValue(Shell);
    loaders.set('flaky-app', load);
    prefetchAppShell('flaky-app', { now: true });
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    prefetchAppShell('flaky-app', { now: true });
    await vi.waitFor(() => expect(peekPrefetchedShell('flaky-app', 'main')).toBe(Shell));
    expect(load).toHaveBeenCalledTimes(2);
    expect(() => prefetchAppShell('missing-app', { now: true })).not.toThrow();
  });

  it('한 번 연 화면은 기억해 다시 열 때 바로 꺼낸다', () => {
    rememberShell('seen-app', 'main', Shell);
    expect(peekPrefetchedShell('seen-app', 'main')).toBe(Shell);
    expect(peekPrefetchedShell('seen-app', 'render')).toBeNull();
  });
});
