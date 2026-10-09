import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTitlebarDrag } from './useTitlebarDrag.js';

const lifecycle = vi.hoisted(() => ({ cleanups: [] as Array<() => void> }));

// 이 훅은 ref 와 창 리스너만 사용한다. DOM 없이 실제 이벤트 수명과 IPC 순서를 실행한다.
vi.mock('react', () => ({
  useRef: <T>(initial: T): { current: T } => ({ current: initial }),
  useCallback: <T>(fn: T): T => fn,
  useEffect: (effect: () => (() => void) | void): void => {
    const cleanup = effect();
    if (cleanup) lifecycle.cleanups.push(cleanup);
  },
}));

type Phase = 'start' | 'move' | 'end';

function setup() {
  const listeners: Array<{ type: string; fn: (event: object) => void; capture: boolean }> = [];
  const moveSelf = vi.fn((_phase: Phase): Promise<boolean> => Promise.resolve(true));
  const host = {
    api: { window: { moveSelf } },
    addEventListener: (type: string, fn: (event: object) => void, capture: boolean) => {
      listeners.push({ type, fn, capture });
    },
    removeEventListener: (type: string, fn: (event: object) => void, capture: boolean) => {
      const at = listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
      if (at >= 0) listeners.splice(at, 1);
    },
  };
  vi.stubGlobal('window', host);
  const down = useTitlebarDrag();
  const unmount = lifecycle.cleanups[lifecycle.cleanups.length - 1]!;
  return {
    host,
    down,
    unmount,
    moveSelf,
    phases: () => moveSelf.mock.calls.map(([phase]) => phase),
    listening: () => listeners.map((l) => l.type).sort(),
    dispatch: (type: string, event: object = {}) => {
      for (const listener of listeners.filter((l) => l.type === type)) listener.fn(event);
    },
  };
}

function press(button = 0) {
  return {
    button,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.MouseEvent<HTMLElement>;
}

function pending() {
  let resolve!: (value: boolean) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<boolean>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

afterEach(() => {
  for (const cleanup of lifecycle.cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
});

describe('로고 창 이동 — 최대화 복원 중에도 같은 손짓을 이어 간다', () => {
  it('누름 → 창 이동 → 실제 해제를 같은 IPC 순서로 보낸다', () => {
    const rig = setup();
    const event = press();
    rig.down(event);
    rig.dispatch('mousemove', { buttons: 1 });
    rig.dispatch('mousemove', { buttons: 1 });
    rig.dispatch('mouseup', { button: 0, buttons: 0 });

    expect(rig.phases()).toEqual(['start', 'move', 'move', 'end']);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(rig.listening()).toEqual([]);
  });

  it('복원의 pointercancel·캡처 상실 뒤에도 이동하다 mouseup 에서 끝난다', () => {
    const rig = setup();
    rig.down(press());
    rig.dispatch('mousemove', { buttons: 1 });
    rig.dispatch('pointercancel', { pointerId: 1 });
    rig.dispatch('lostpointercapture', { pointerId: 1 });
    expect(rig.phases()).toEqual(['start', 'move']);
    rig.dispatch('mousemove', { buttons: 1 });
    rig.dispatch('mouseup', { button: 0, buttons: 0 });
    expect(rig.phases()).toEqual(['start', 'move', 'move', 'end']);
    expect(rig.listening()).toEqual([]);
  });

  it('창 밖에서 mouseup 을 놓쳐도 다음 이동의 buttons 가 해제를 알려 준다', () => {
    const rig = setup();
    rig.down(press());
    rig.dispatch('mousemove', { buttons: 0 });
    rig.dispatch('mousemove', { buttons: 0 });
    rig.dispatch('mouseup', { button: 0, buttons: 0 });
    expect(rig.phases()).toEqual(['start', 'end']);
    expect(rig.listening()).toEqual([]);
  });

  it.each(['blur', 'pagehide', 'unmount'])('%s 에서 한 번 끝내고 창 리스너를 거둔다', (type) => {
    const rig = setup();
    rig.down(press());
    expect(rig.listening()).toEqual(['blur', 'mousemove', 'mouseup', 'pagehide']);
    if (type === 'unmount') rig.unmount();
    else rig.dispatch(type);
    rig.unmount();
    rig.dispatch('mousemove', { buttons: 1 });
    rig.dispatch('mouseup', { button: 0, buttons: 0 });
    expect(rig.phases()).toEqual(['start', 'end']);
    expect(rig.listening()).toEqual([]);
  });

  it('다른 버튼은 시작하지 않으며 왼쪽을 쥔 채 오른쪽을 떼도 끝나지 않는다', () => {
    const rig = setup();
    const right = press(2);
    rig.down(right);
    expect(rig.phases()).toEqual([]);
    expect(right.preventDefault).not.toHaveBeenCalled();
    expect(rig.listening()).toEqual([]);

    rig.down(press());
    rig.dispatch('mouseup', { button: 2, buttons: 1 });
    rig.dispatch('mousemove', { buttons: 1 });
    expect(rig.phases()).toEqual(['start', 'move']);
    rig.dispatch('mouseup', { button: 0, buttons: 2 });
    expect(rig.phases()).toEqual(['start', 'move', 'end']);
  });

  it('이동 API 가 없는 창은 손짓을 가로채지 않는다', () => {
    const rig = setup();
    vi.stubGlobal('window', { ...rig.host, api: undefined });
    const event = press();
    rig.down(event);
    expect(rig.phases()).toEqual([]);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(rig.listening()).toEqual([]);
  });

  it('더블클릭의 두 누름·해제는 각각 종료되며 지연 응답으로 다시 시작하지 않는다', async () => {
    const rig = setup();
    const first = pending();
    rig.moveSelf.mockReturnValueOnce(first.promise);
    rig.down(press());
    rig.dispatch('mouseup', { button: 0, buttons: 0 });
    rig.down(press());
    rig.dispatch('mouseup', { button: 0, buttons: 0 });
    first.resolve(true);
    await first.promise;
    expect(rig.phases()).toEqual(['start', 'end', 'start', 'end']);
    expect(rig.listening()).toEqual([]);
  });

  it.each(['refused', 'rejected'])('이전 손짓의 늦은 %s 응답은 새 손짓을 끝내지 않는다', async (result) => {
    const rig = setup();
    const first = pending();
    rig.moveSelf.mockReturnValueOnce(first.promise);
    rig.down(press());
    // 다음 누름이 먼저 와도 이전 판을 끝낸 뒤 새 판을 연다.
    rig.down(press());
    if (result === 'refused') first.resolve(false);
    else first.reject(new Error('previous request failed'));
    await Promise.resolve();
    rig.dispatch('mousemove', { buttons: 1 });
    expect(rig.phases()).toEqual(['start', 'end', 'start', 'move']);
    rig.dispatch('mouseup', { button: 0, buttons: 0 });
    expect(rig.phases()).toEqual(['start', 'end', 'start', 'move', 'end']);
  });

  it('현재 이동이 거절되면 종료하고 리스너를 거둔다', async () => {
    const rig = setup();
    rig.down(press());
    rig.moveSelf.mockResolvedValueOnce(false);
    rig.dispatch('mousemove', { buttons: 1 });
    await Promise.resolve();
    expect(rig.phases()).toEqual(['start', 'move', 'end']);
    expect(rig.listening()).toEqual([]);
  });

  it('시작·종료 IPC 가 실패해도 이벤트 정리는 끝나고 다음 누름을 받을 수 있다', async () => {
    const rig = setup();
    rig.moveSelf
      .mockRejectedValueOnce(new Error('start failed'))
      .mockRejectedValueOnce(new Error('end failed'));
    rig.down(press());
    await Promise.resolve();
    await Promise.resolve();
    expect(rig.phases()).toEqual(['start', 'end']);
    expect(rig.listening()).toEqual([]);
    rig.down(press());
    rig.dispatch('mouseup', { button: 0, buttons: 0 });
    expect(rig.phases()).toEqual(['start', 'end', 'start', 'end']);
  });

  it('preload 의 동기 예외도 창에 리스너를 남기지 않는다', () => {
    const rig = setup();
    rig.moveSelf.mockImplementation(() => { throw new Error('disposed preload'); });
    expect(() => rig.down(press())).not.toThrow();
    expect(rig.phases()).toEqual(['start', 'end']);
    expect(rig.listening()).toEqual([]);
  });
});
