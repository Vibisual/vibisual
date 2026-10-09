import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFloatingWindow } from './useFloatingWindow.js';

const lifecycle = vi.hoisted(() => ({ cleanups: [] as Array<() => void> }));
vi.mock('react', () => ({
  useRef: <T>(current: T) => ({ current }),
  useCallback: <T>(fn: T): T => fn,
  useState: <T>(initial: T | (() => T)) => {
    let value = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [value, (next: T | ((old: T) => T)) => { value = typeof next === 'function' ? (next as (old: T) => T)(value) : next; }];
  },
  useEffect: (effect: () => void | (() => void)) => { const cleanup = effect(); if (cleanup) lifecycle.cleanups.push(cleanup); },
}));

function setup() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  vi.stubGlobal('window', {
    innerWidth: 1000, innerHeight: 800,
    setTimeout, clearTimeout,
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: (event: unknown) => void) => { listeners.get(type)?.delete(fn); },
  });
  const release = vi.fn(); const armed = vi.fn();
  const fw = useFloatingWindow({ pullOut: { enabled: true, onArmedChange: armed, onRelease: release } });
  fw.windowRef.current = { getBoundingClientRect: () => ({ left: 100, top: 100, width: 600, height: 400 }) } as HTMLDivElement;
  const press = { button: 0, clientX: 150, clientY: 120, screenX: 550, screenY: 220,
    target: { closest: () => null }, preventDefault: vi.fn() } as unknown as React.MouseEvent<HTMLElement>;
  const dispatch = (type: string, event: unknown = {}) => { for (const fn of [...(listeners.get(type) ?? [])]) fn(event); };
  return { fw, release, armed, press, dispatch, listeners };
}

afterEach(() => { for (const cleanup of lifecycle.cleanups.splice(0)) cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('floating app titlebar transfer', () => {
  it('places the detached window at the screen cursor rather than the clamped embedded position', () => {
    const s = setup(); s.fw.titleBarProps.onMouseDown(s.press);
    s.dispatch('mousemove', { clientX: 1200, clientY: 200, screenX: 1600, screenY: 300 });
    expect(s.release).not.toHaveBeenCalled();
    s.dispatch('mouseup', { button: 0 });
    expect(s.release).toHaveBeenCalledWith({ geom: expect.objectContaining({ w: 600, h: 400 }), screenPosition: { x: 1550, y: 280 } });
    expect(s.listeners.get('mousemove')?.size).toBe(0);
  });
  it('returning inside before release cancels a previously armed pop-out', () => {
    const s = setup(); s.fw.titleBarProps.onMouseDown(s.press);
    s.dispatch('mousemove', { clientX: 1200, clientY: 200, screenX: 1600, screenY: 300 });
    s.dispatch('mousemove', { clientX: 450, clientY: 200, screenX: 850, screenY: 300 });
    s.dispatch('mouseup', { button: 0 });
    expect(s.release).not.toHaveBeenCalled(); expect(s.armed).toHaveBeenLastCalledWith(false);
  });
  it('holds the screen edge before arming when the app is maximized', () => {
    vi.useFakeTimers(); const s = setup(); s.fw.titleBarProps.onMouseDown(s.press);
    s.dispatch('mousemove', { clientX: 999, clientY: 200, screenX: 999, screenY: 200 });
    vi.advanceTimersByTime(499); expect(s.armed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(s.armed).toHaveBeenLastCalledWith(true);
    s.dispatch('mouseup', { button: 0 }); expect(s.release).toHaveBeenCalledOnce();
  });
  it.each(['blur', 'keydown'])('%s cancels the gesture and releases listeners', type => {
    const s = setup(); s.fw.titleBarProps.onMouseDown(s.press);
    s.dispatch('mousemove', { clientX: 1200, clientY: 200, screenX: 1600, screenY: 300 });
    s.dispatch(type, { key: 'Escape', preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() });
    s.dispatch('mouseup', { button: 0 });
    expect(s.release).not.toHaveBeenCalled(); expect(s.listeners.get('mouseup')?.size).toBe(0);
  });
  it('unmount during edge dwell cannot detach later', () => {
    vi.useFakeTimers(); const s = setup(); s.fw.titleBarProps.onMouseDown(s.press);
    s.dispatch('mousemove', { clientX: 999, clientY: 200, screenX: 999, screenY: 200 });
    for (const cleanup of lifecycle.cleanups.splice(0)) cleanup();
    vi.advanceTimersByTime(1000); s.dispatch('mouseup', { button: 0 });
    expect(s.release).not.toHaveBeenCalled(); expect(s.armed).not.toHaveBeenCalled();
  });
});
