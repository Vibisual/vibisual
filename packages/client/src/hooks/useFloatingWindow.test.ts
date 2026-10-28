import { afterEach, describe, expect, it, vi } from 'vitest';
import { WINDOW_PULL_OUT } from './floatingWindowGeom.js';
import { useFloatingWindow, type FloatingWindowPullOutRelease } from './useFloatingWindow.js';

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

type Release = (info: FloatingWindowPullOutRelease) => void | Promise<boolean>;

/** main 의 선 다리(`window.api.overlay`) 흉내 — 부탁을 그대로 적어 둔다. */
function overlayApi() {
  return {
    ghostShow: vi.fn((_payload: Record<string, unknown>) => Promise.resolve(true)),
    ghostNudge: vi.fn((_payload: { dx: number; dy: number }) => Promise.resolve(true)),
    ghostHide: vi.fn(() => Promise.resolve(true)),
  };
}

function setup(opts: { overlay?: ReturnType<typeof overlayApi>; release?: Release; pullOut?: boolean } = {}) {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  vi.stubGlobal('window', {
    innerWidth: 1000, innerHeight: 800,
    setTimeout, clearTimeout, setInterval, clearInterval,
    ...(opts.overlay ? { api: { overlay: opts.overlay } } : {}),
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: (event: unknown) => void) => { listeners.get(type)?.delete(fn); },
  });
  const release = vi.fn<Release>(opts.release ?? (() => undefined)); const armed = vi.fn();
  const fw = useFloatingWindow(opts.pullOut === false ? {} : {
    pullOut: { enabled: true, onArmedChange: armed, onRelease: release, ghost: { label: 'Studio', hint: (a: boolean) => (a ? 'release' : 'pull') } },
  });
  fw.windowRef.current = { getBoundingClientRect: () => ({ left: 100, top: 100, width: 600, height: 400 }) } as HTMLDivElement;
  const press = { button: 0, clientX: 150, clientY: 120, screenX: 550, screenY: 220,
    target: { closest: () => null }, preventDefault: vi.fn() } as unknown as React.MouseEvent<HTMLElement>;
  const dispatch = (type: string, event: unknown = {}) => { for (const fn of [...(listeners.get(type) ?? [])]) fn(event); };
  return { fw, release, armed, press, dispatch, listeners };
}

/** 앱 밖(뷰포트 1000 너머)으로 끈다 — 커서가 밖이면 선이 뜨고 무장한다. */
const OUTSIDE = { clientX: 1200, clientY: 200, screenX: 1600, screenY: 300 };
/** 비동기 대답(꺼내기 결과)이 돌아올 틈. */
const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };

afterEach(() => { for (const cleanup of lifecycle.cleanups.splice(0)) cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('floating app titlebar transfer', () => {
  it('places the detached window at the screen cursor rather than the clamped embedded position', () => {
    const s = setup(); s.fw.titleBarProps.onMouseDown(s.press);
    s.dispatch('mousemove', OUTSIDE);
    expect(s.release).not.toHaveBeenCalled();
    s.dispatch('mouseup', { button: 0 });
    // main 의 선 다리가 없는 판(웹·구버전 preload) — 새 창은 렌더러가 잰 자리에 선다.
    expect(s.release).toHaveBeenCalledWith({ geom: expect.objectContaining({ w: 600, h: 400 }), screenPosition: { x: 1550, y: 280 }, fromGhost: false });
    expect(s.listeners.get('mousemove')?.size).toBe(0);
  });
  it('returning inside before release cancels a previously armed pop-out', () => {
    const s = setup(); s.fw.titleBarProps.onMouseDown(s.press);
    s.dispatch('mousemove', OUTSIDE);
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
    s.dispatch('mousemove', OUTSIDE);
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

// §5.13 (S-10) — 앱 안 창을 밖으로 끄는 동안 IDE 창과 같은 가상 창(§5.5 #17-6 (H-6)(H-17)(H-19))이 손을 따라간다.
describe('§5.13 (S-10) 밖으로 빼는 동안의 가상 창', () => {
  it('커서가 앱 밖으로 나가면 main 의 선을 창 크기·잡은 지점 그대로 부탁한다(이름·안내 포함)', () => {
    const overlay = overlayApi();
    const s = setup({ overlay }); s.fw.titleBarProps.onMouseDown(s.press);
    s.dispatch('mousemove', OUTSIDE);
    expect(overlay.ghostShow).toHaveBeenCalledWith({ width: 600, height: 400, grabX: 50, grabY: 20, label: 'Studio', armed: true, hint: 'release' });
  });

  it('무장한 채 놓으면 선을 그 자리에 멈추고(settled), 새 창이 그 선을 쓰게 한다', () => {
    const overlay = overlayApi();
    const s = setup({ overlay, release: () => new Promise<boolean>(() => undefined) });
    s.fw.titleBarProps.onMouseDown(s.press);
    s.dispatch('mousemove', OUTSIDE);
    s.dispatch('mouseup', { button: 0 });
    expect(overlay.ghostShow).toHaveBeenLastCalledWith(expect.objectContaining({ armed: true, settled: true }));
    expect(s.release).toHaveBeenCalledWith(expect.objectContaining({ fromGhost: true, screenPosition: { x: 1550, y: 280 } }));
    // 열리는 동안 선은 그대로 서 있다 — 걷으면 새 창이 뜨기까지 손 아래가 빈다.
    expect(overlay.ghostHide).not.toHaveBeenCalled();
  });

  it('새 창이 열리면 선은 main 이 걷는다 — 렌더러는 걷지 않는다', async () => {
    const overlay = overlayApi();
    const s = setup({ overlay, release: () => Promise.resolve(true) });
    s.fw.titleBarProps.onMouseDown(s.press);
    s.dispatch('mousemove', OUTSIDE);
    s.dispatch('mouseup', { button: 0 });
    await settle();
    expect(overlay.ghostHide).not.toHaveBeenCalled();
  });

  it('못 열면 선을 걷는다 — 본체는 앱 안 제자리에 되살아난다', async () => {
    const overlay = overlayApi();
    const s = setup({ overlay, release: () => Promise.resolve(false) });
    s.fw.titleBarProps.onMouseDown(s.press);
    s.dispatch('mousemove', OUTSIDE);
    s.dispatch('mouseup', { button: 0 });
    await settle();
    expect(overlay.ghostHide).toHaveBeenCalledOnce();
  });

  it('밖을 밟고 도로 들어와 놓으면 내보내지 않고 선을 걷는다 — 놓을 때까지는 선이다', () => {
    const overlay = overlayApi();
    const s = setup({ overlay }); s.fw.titleBarProps.onMouseDown(s.press);
    s.dispatch('mousemove', OUTSIDE);
    s.dispatch('mousemove', { clientX: 450, clientY: 200, screenX: 850, screenY: 300 });
    // (H-22) 도로 들어와도 선은 그대로다 — 꺼지는 자리는 뗌 하나다.
    expect(overlay.ghostHide).not.toHaveBeenCalled();
    s.dispatch('mouseup', { button: 0 });
    expect(s.release).not.toHaveBeenCalled();
    expect(overlay.ghostHide).toHaveBeenCalledOnce();
  });

  it('Esc 로 끊으면 선을 걷고 내보내지 않는다', () => {
    const overlay = overlayApi();
    const s = setup({ overlay }); s.fw.titleBarProps.onMouseDown(s.press);
    s.dispatch('mousemove', OUTSIDE);
    s.dispatch('keydown', { key: 'Escape', preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() });
    expect(overlay.ghostHide).toHaveBeenCalledOnce();
    expect(s.release).not.toHaveBeenCalled();
  });

  // (S-10 ⑧) 최대화한 단일 모니터에서 커서는 왼쪽 벽(clientX 0)에 막힌다 — IDE 창(§5.5 #17-6 (H-3)(H-6))처럼 버티면 선이 뜨고, 밖으로 밀리다, 다 버티면 무장한다.
  it('왼쪽 벽에 막힌 채 버티면 선이 먼저 뜨고 왼쪽 밖으로 밀려 나가다 무장한다 — 놓으면 밀린 그 자리로 나간다', async () => {
    vi.useFakeTimers();
    const overlay = overlayApi();
    const s = setup({ overlay, release: () => new Promise<boolean>(() => undefined) });
    s.fw.titleBarProps.onMouseDown(s.press);
    s.dispatch('mousemove', { clientX: 0, clientY: 200, screenX: 400, screenY: 300 });
    // 벽에 닿은 그 순간은 아직이다 — 스쳐 지나간 손에 선이 번쩍이면 안 된다.
    expect(overlay.ghostShow).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(WINDOW_PULL_OUT.EDGE_GHOST_MS + 2 * WINDOW_PULL_OUT.EDGE_TICK_MS);
    // 선이 먼저 뜬다 — 창 크기·잡은 지점 그대로, 아직 무장 전이라 안내는 "끌어내면".
    expect(overlay.ghostShow).toHaveBeenCalledWith(expect.objectContaining({ width: 600, height: 400, grabX: 50, grabY: 20, armed: false, hint: 'pull' }));
    // 버티는 동안 선은 **왼쪽** 밖으로 밀려 나간다 — 어디로 빠지는지가 놓기 전에 보인다.
    expect(overlay.ghostNudge).toHaveBeenCalled();
    expect(overlay.ghostNudge.mock.calls.every(([o]) => o.dx < 0 && o.dy === 0)).toBe(true);
    expect(s.armed).not.toHaveBeenCalledWith(true);

    await vi.advanceTimersByTimeAsync(WINDOW_PULL_OUT.EDGE_DWELL_MS);
    expect(s.armed).toHaveBeenLastCalledWith(true);
    expect(overlay.ghostNudge).toHaveBeenLastCalledWith({ dx: -WINDOW_PULL_OUT.EDGE_NUDGE_PX, dy: 0 });

    s.dispatch('mouseup', { button: 0 });
    expect(overlay.ghostShow).toHaveBeenLastCalledWith(expect.objectContaining({ armed: true, settled: true }));
    // 새 창은 밀린 선의 자리에 선다 — 손 아래(잡은 지점 50·20)에서 밀어 낸 만큼 더 왼쪽.
    expect(s.release).toHaveBeenCalledWith(expect.objectContaining({
      fromGhost: true,
      screenPosition: { x: 400 - 50 - WINDOW_PULL_OUT.EDGE_NUDGE_PX, y: 280 },
    }));
  });

  it('앱 안에서 평범하게 끌면 선을 부탁하지 않는다', () => {
    const overlay = overlayApi();
    const s = setup({ overlay }); s.fw.titleBarProps.onMouseDown(s.press);
    s.dispatch('mousemove', { clientX: 400, clientY: 300, screenX: 800, screenY: 400 });
    s.dispatch('mouseup', { button: 0 });
    expect(overlay.ghostShow).not.toHaveBeenCalled();
    expect(s.release).not.toHaveBeenCalled();
  });

  it('끌어내기가 없는 창(캡처 창 등)은 종전 그대로 — 밖으로 끌어도 선이 없다', () => {
    const overlay = overlayApi();
    const s = setup({ overlay, pullOut: false }); s.fw.titleBarProps.onMouseDown(s.press);
    s.dispatch('mousemove', OUTSIDE);
    s.dispatch('mouseup', { button: 0 });
    expect(overlay.ghostShow).not.toHaveBeenCalled();
    expect(s.fw.pullOutGhost).toBeNull();
  });
});
