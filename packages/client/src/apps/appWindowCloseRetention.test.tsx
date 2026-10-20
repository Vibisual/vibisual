import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAppWindowCloseGuard } from './appWindowCloseGuard.js';
import { registerAppWindowCloseRetention, requestAppWindowClose, useAppWindowCloseRetention } from './appWindowCloseRetention.js';
import { useAppWindowsStore } from './appWindows.js';

const cleanups: Array<() => void> = [];
let view: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => view?.unmount()); view = undefined;
  for (const off of cleanups.splice(0)) off();
  useAppWindowsStore.setState({ windows: [], outside: [] });
  vi.unstubAllGlobals();
});

describe('retained app close', () => {
  it('waits for human consent, coalesces repeated closes, then hides the same live editor', async () => {
    useAppWindowsStore.setState({ windows: [{ id: 'live', appId: 'vibi3d', projectId: '/project', ref: 'doc', focusAt: 1 }] });
    let answer!: (value: boolean) => void;
    const ask = vi.fn(() => new Promise<boolean>(resolve => { answer = resolve; }));
    cleanups.push(registerAppWindowCloseGuard('live', ask), registerAppWindowCloseRetention('live', () => true));
    const close = vi.fn();
    const first = requestAppWindowClose('live', close);
    expect(requestAppWindowClose('live', close)).toBe(first);
    expect(useAppWindowsStore.getState().windows[0]?.background).toBeUndefined();
    answer(false); expect(await first).toBe(false);
    expect(close).not.toHaveBeenCalled();
    const second = requestAppWindowClose('live', close);
    answer(true); expect(await second).toBe(true);
    expect(useAppWindowsStore.getState().windows).toEqual([
      { id: 'live', appId: 'vibi3d', projectId: '/project', ref: 'doc', focusAt: 1, background: true },
    ]);
    expect(close).not.toHaveBeenCalled();
  });

  it('closes ordinary windows and fails closed if a retained native window cannot hide', async () => {
    const close = vi.fn();
    expect(await requestAppWindowClose('ordinary', close)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    cleanups.push(registerAppWindowCloseRetention('@detached', () => true));
    vi.stubGlobal('window', { api: { app: { hideSelf: vi.fn().mockResolvedValue(false) } } });
    expect(await requestAppWindowClose('@detached', close)).toBe(false);
    expect(close).toHaveBeenCalledOnce();
  });

  it('tracks the current native editor without replacing it and releases retention on unmount', async () => {
    const setCloseRetention = vi.fn().mockResolvedValue(true), hideSelf = vi.fn().mockResolvedValue(true), close = vi.fn();
    vi.stubGlobal('window', { api: { app: { setCloseRetention, hideSelf } } });
    function Host({ loaded }: { loaded: boolean }) {
      useAppWindowCloseRetention({}, () => loaded);
      return null;
    }
    act(() => { view = create(createElement(Host, { loaded: false })); });
    expect(setCloseRetention).toHaveBeenLastCalledWith(false);
    act(() => view!.update(createElement(Host, { loaded: true })));
    expect(setCloseRetention).toHaveBeenLastCalledWith(true);
    act(() => view!.update(createElement(Host, { loaded: true })));
    expect(setCloseRetention).toHaveBeenCalledTimes(2);
    expect(await requestAppWindowClose('@detached', close)).toBe(true);
    expect(hideSelf).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
    act(() => view!.unmount()); view = undefined;
    expect(setCloseRetention).toHaveBeenLastCalledWith(false);
    expect(await requestAppWindowClose('@detached', close)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });
});
