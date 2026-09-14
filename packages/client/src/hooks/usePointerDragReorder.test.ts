/**
 * usePointerDragReorder.test.ts — §5.4 #14-2 (F-6) **탭은 꾹 누르지 않고 끌어서 든다 — 그 손짓을 실제로 돌려 본다.**
 *
 * `tabPointerDrag.test.ts` 는 소스 문자열로 "두 탭바가 끌기 문을 켰는가"를 보고, `pointerDragGeom.test.ts`
 * 는 문턱의 값을 본다. 그 둘로는 **훅이 손짓 순서대로 무엇을 하는가**(문턱 안에서 떼면 클릭이 살아남는가 ·
 * 넘기면 기다림 없이 드는가 · 터치는 여전히 기다리는가)가 잡히지 않는다.
 *
 * 클라 테스트에는 DOM 이 없다(jsdom 미설치). 그래서 ⓐ React 는 **한 번만 그리는** 가짜로 바꾸고
 * (`useRef`·`useCallback` 은 받은 것을 그대로 돌려주고, `useState` 의 setter 와 effect 는 아무것도 하지 않는다)
 * ⓑ 창은 리스너·타이머를 받아 두는 `window` 스텁으로 세운다(`detachedFollowRelease.test.ts` 와 같은 방식).
 * 훅의 판정은 전부 ref 와 창 리스너 위에서 돌므로, 이 둘만으로 탭바가 타는 **그 코드 경로**를 그대로 탄다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePointerDragReorder, type PointerDragReorderOptions } from './usePointerDragReorder.js';
import { POINTER_DRAG } from './pointerDragGeom.js';

vi.mock('react', () => ({
  useCallback: <T>(fn: T): T => fn,
  useRef: <T>(initial: T): { current: T } => ({ current: initial }),
  useState: <T>(initial: T): [T, (next: T) => void] => [initial, () => { /* 한 번만 그린다 */ }],
  useEffect: (): void => { /* 한 번만 그린다 — 정리·자동 스크롤 루프는 여기서 보지 않는다 */ },
  useLayoutEffect: (): void => { /* 위와 같다 */ },
}));

/** 훅이 실제로 부르는 것(`getBoundingClientRect`·`setPointerCapture`·`closest`·`getAttribute`·offset)만 가진 DOM 조각. */
class FakeElement {
  readonly captured: number[] = [];

  constructor(
    private readonly box: { left: number; top: number; width: number; height: number },
    private readonly opts: { key?: string; ignore?: boolean } = {},
  ) {}

  get offsetLeft(): number { return this.box.left; }
  get offsetTop(): number { return this.box.top; }
  get offsetWidth(): number { return this.box.width; }
  get offsetHeight(): number { return this.box.height; }

  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
    const { left, top, width, height } = this.box;
    return { left, top, right: left + width, bottom: top + height, width, height };
  }

  setPointerCapture(pointerId: number): void { this.captured.push(pointerId); }

  closest(): FakeElement | null { return this.opts.ignore ? this : null; }

  getAttribute(name: string): string | null { return name === 'data-tab-key' ? (this.opts.key ?? null) : null; }
}

interface Rig {
  dispatch: (type: string, ev: object) => void;
  listening: () => string[];
  timers: Array<{ id: number; ms: number; fn: () => void }>;
  fire: () => void;
}

// ─── `window` 스텁 — 건 리스너·타이머를 그대로 들여다본다 ────────────────────────
function installWindow(): Rig {
  const listeners: Array<{ type: string; fn: (ev: unknown) => void }> = [];
  const timers: Rig['timers'] = [];
  let seq = 0;
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: (ev: unknown) => void) => { listeners.push({ type, fn }); },
    removeEventListener: (type: string, fn: (ev: unknown) => void) => {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    setTimeout: (fn: () => void, ms: number) => { seq += 1; timers.push({ id: seq, ms, fn }); return seq; },
    clearTimeout: (id: number) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  // `e.target instanceof Element`(무시할 자리) · `child instanceof HTMLElement`(칸 재기)가 이 조각을 알아보게.
  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('HTMLElement', FakeElement);
  return {
    dispatch: (type, ev) => { for (const l of listeners.filter((x) => x.type === type)) l.fn(ev); },
    listening: () => listeners.map((l) => l.type).sort(),
    timers,
    fire: () => { for (const t of timers.splice(0)) t.fn(); },
  };
}

/** 탭 두 개(a: 80~208, b: 208~336)가 선 가로 줄 — 프로젝트 탭 줄과 같은 모양(`w-32` = 128px). */
function setup(over: Partial<PointerDragReorderOptions> = {}) {
  const rig = installWindow();
  const tabA = new FakeElement({ left: 80, top: 0, width: 128, height: 36 }, { key: 'a' });
  const tabB = new FakeElement({ left: 208, top: 0, width: 128, height: 36 }, { key: 'b' });
  const container = {
    scrollLeft: 0,
    scrollTop: 0,
    children: [tabA, tabB],
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 36, width: 600, height: 36 }),
  };
  const calls = {
    start: [] as string[],
    move: [] as string[],
    commit: [] as Array<{ next: string[] | null; x: number; y: number; key: string }>,
    cancel: [] as string[],
  };
  const api = usePointerDragReorder({
    axis: 'x',
    container: container as unknown as HTMLElement,
    keyAttribute: 'data-tab-key',
    order: ['a', 'b'],
    onDragStart: (key) => { calls.start.push(key); },
    onDragMove: (key) => { calls.move.push(key); },
    onCommit: (next, p, key) => { calls.commit.push({ next, x: p.x, y: p.y, key }); },
    onCancel: (key) => { calls.cancel.push(key); },
    ...over,
  });
  const ghost = { style: { transform: '' } };
  api.ghostRef.current = ghost as unknown as HTMLDivElement;
  return { rig, api, tabA, calls, ghost };
}

function press(
  el: FakeElement,
  over: { x?: number; y?: number; button?: number; pointerId?: number; pointerType?: string; target?: FakeElement } = {},
): React.PointerEvent<HTMLElement> {
  const x = over.x ?? 100;
  const y = over.y ?? 10;
  return {
    button: over.button ?? 0,
    pointerId: over.pointerId ?? 1,
    pointerType: over.pointerType ?? 'mouse',
    clientX: x,
    clientY: y,
    screenX: x + 1000,
    screenY: y + 100,
    target: over.target ?? el,
    currentTarget: el,
  } as unknown as React.PointerEvent<HTMLElement>;
}

function moveTo(x: number, y: number, over: { buttons?: number; pointerId?: number } = {}): object {
  return { clientX: x, clientY: y, screenX: x + 1000, screenY: y + 100, buttons: over.buttons ?? 1, pointerId: over.pointerId ?? 1 };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('§5.4 #14-2 (F-6) 끌기 문 — 두 탭바가 켠 그대로 손짓을 돌려 본다', () => {
  it('문턱 안에서 떼면 클릭이다 — 들리지 않고, 그 탭을 여는 click 도 삼키지 않는다', () => {
    const { rig, api, tabA, calls } = setup({ activation: 'drag' });
    api.onPointerDown(press(tabA), 'a');
    // 끌기 문은 기다리지 않는다 — 누르는 순간 걸린 타이머가 없다.
    expect(rig.timers).toHaveLength(0);
    rig.dispatch('pointermove', moveTo(103, 10));
    // 3·4 → 5px. 문턱과 같으면 아직 클릭이다(손 떨림이 끌기가 되지 않는다).
    rig.dispatch('pointermove', moveTo(103, 14));
    rig.dispatch('pointerup', {});
    expect(calls.start).toEqual([]);
    expect(calls.commit).toEqual([]);
    expect(tabA.captured).toEqual([]);
    expect(api.consumeClick()).toBe(false);
    // 손을 떼면 창에 건 귀도 전부 걷힌다.
    expect(rig.listening()).toEqual([]);
  });

  it('문턱을 넘는 그 움직임에서 곧장 든다 — 기다림 없음, 잡은 지점은 처음 누른 자리', () => {
    const { rig, api, tabA, calls, ghost } = setup({ activation: 'drag' });
    api.onPointerDown(press(tabA, { x: 100, y: 10 }), 'a');
    rig.dispatch('pointermove', moveTo(106, 10));
    expect(calls.start).toEqual(['a']);
    // 같은 움직임이 아래로 흘러 끄는 처리(고스트·밀어내기·줄 밖 판정)까지 받는다 — 한 박자 늦지 않게.
    expect(calls.move).toEqual(['a']);
    expect(tabA.captured).toEqual([1]);
    // 누른 자리 (100,10) 은 탭(80,0) 안의 (20,10). 106 까지 끌었으니 고스트는 탭 원래 자리에서 6px 옆이다
    //   — 문턱을 넘은 자리로 쟀다면 80px 에 떠서 손보다 6px 뒤처진다.
    expect(ghost.style.transform).toBe('translate3d(86px, 0px, 0)');
    expect(rig.timers).toHaveLength(0);
  });

  it('옆 탭의 중앙선을 넘기고 놓으면 새 순서로 커밋하고, 뒤따르는 click 한 번은 삼킨다', () => {
    const { rig, api, tabA, calls } = setup({ activation: 'drag' });
    api.onPointerDown(press(tabA, { x: 100, y: 10 }), 'a');
    rig.dispatch('pointermove', moveTo(106, 10));
    // b 는 208~336 — 중앙선 272 를 넘는다.
    rig.dispatch('pointermove', moveTo(280, 12));
    rig.dispatch('pointerup', {});
    expect(calls.commit).toEqual([{ next: ['b', 'a'], x: 280, y: 12, key: 'a' }]);
    expect(api.consumeClick()).toBe(true);
    expect(api.consumeClick()).toBe(false);
    expect(rig.listening()).toEqual([]);
  });

  it('아래로 끌어도 든다 — 두 축을 함께 잰다(별창 분리·본문 분할로 곧장 이어진다)', () => {
    const { rig, api, tabA, calls } = setup({ activation: 'drag' });
    api.onPointerDown(press(tabA, { x: 100, y: 10 }), 'a');
    rig.dispatch('pointermove', moveTo(100, 16));
    expect(calls.start).toEqual(['a']);
  });

  it('주 버튼이 이미 떨어졌으면 들지 않고 누름을 버린다 — 떼고 지나가는 마우스에 탭이 붙지 않는다', () => {
    const { rig, api, tabA, calls } = setup({ activation: 'drag' });
    api.onPointerDown(press(tabA), 'a');
    rig.dispatch('pointermove', moveTo(300, 10, { buttons: 0 }));
    expect(calls.start).toEqual([]);
    expect(rig.listening()).toEqual([]);
    rig.dispatch('pointermove', moveTo(400, 10, { buttons: 0 }));
    expect(calls.start).toEqual([]);
  });

  it('다른 포인터의 움직임은 이 누름의 것이 아니다', () => {
    const { rig, api, tabA, calls } = setup({ activation: 'drag' });
    api.onPointerDown(press(tabA, { pointerId: 1 }), 'a');
    rig.dispatch('pointermove', moveTo(300, 10, { pointerId: 7, buttons: 0 }));
    expect(calls.start).toEqual([]);
    rig.dispatch('pointermove', moveTo(106, 10, { pointerId: 1 }));
    expect(calls.start).toEqual(['a']);
  });

  it('들기 전 Esc 는 누름만 버린다 — 되돌릴 것이 없으니 onCancel 도, click 삼킴도 없다', () => {
    const { rig, api, tabA, calls } = setup({ activation: 'drag' });
    api.onPointerDown(press(tabA), 'a');
    rig.dispatch('keydown', { key: 'Escape' });
    rig.dispatch('pointermove', moveTo(300, 10));
    expect(calls.start).toEqual([]);
    expect(calls.cancel).toEqual([]);
    expect(api.consumeClick()).toBe(false);
  });

  it('끄는 중 Esc 는 되돌린다 — 커밋 없이 onCancel, 뒤따르는 click 은 삼킨다', () => {
    const { rig, api, tabA, calls } = setup({ activation: 'drag' });
    api.onPointerDown(press(tabA), 'a');
    rig.dispatch('pointermove', moveTo(280, 10));
    rig.dispatch('keydown', { key: 'Escape' });
    expect(calls.cancel).toEqual(['a']);
    expect(calls.commit).toEqual([]);
    expect(api.consumeClick()).toBe(true);
    expect(rig.listening()).toEqual([]);
  });

  it('닫기 버튼 위에서 시작된 누르기는 받지 않는다(`ignoreSelector`) — 닫기는 닫기로 남는다', () => {
    const { rig, api, tabA, calls } = setup({ activation: 'drag', ignoreSelector: 'button' });
    const closeButton = new FakeElement({ left: 190, top: 10, width: 16, height: 16 }, { ignore: true });
    api.onPointerDown(press(tabA, { target: closeButton }), 'a');
    expect(rig.listening()).toEqual([]);
    rig.dispatch('pointermove', moveTo(300, 10));
    expect(calls.start).toEqual([]);
  });

  it('우클릭은 받지 않는다 — 컨텍스트 메뉴의 것이다', () => {
    const { rig, api, tabA } = setup({ activation: 'drag' });
    api.onPointerDown(press(tabA, { button: 2 }), 'a');
    expect(rig.listening()).toEqual([]);
  });

  it('터치는 끌기를 청해도 꾹 누르기다 — 조금 밀려도 버티면 든다', () => {
    const { rig, api, tabA, calls } = setup({ activation: 'drag' });
    api.onPointerDown(press(tabA, { pointerType: 'touch' }), 'a');
    expect(rig.timers.map((t) => t.ms)).toEqual([POINTER_DRAG.longPressMs]);
    // 스크롤 축으로 6px — 꾹 누르기의 취소 임계(10px) 안이라 누름은 살아 있고, 거리로 들지도 않는다.
    rig.dispatch('pointermove', moveTo(106, 10));
    expect(calls.start).toEqual([]);
    rig.fire();
    expect(calls.start).toEqual(['a']);
  });

  it('터치로 줄을 밀면 들지 않는다 — 손가락으로 탭 줄을 넘기는 스크롤이 남는다', () => {
    const { rig, api, tabA, calls } = setup({ activation: 'drag' });
    api.onPointerDown(press(tabA, { pointerType: 'touch' }), 'a');
    rig.dispatch('pointermove', moveTo(115, 10));
    expect(rig.timers).toHaveLength(0);
    rig.fire();
    expect(calls.start).toEqual([]);
  });
});

describe('기본값(활동바)은 꾹 누르기 그대로다 — (F-6) 은 탭 줄에 대한 지시였다 (§5.5 #16-1 (E))', () => {
  it('마우스로 문턱을 넘게 끌어도 기다린다 — 타이머가 차야 든다', () => {
    const { rig, api, tabA, calls } = setup({ axis: 'y' });
    api.onPointerDown(press(tabA), 'a');
    expect(rig.timers.map((t) => t.ms)).toEqual([POINTER_DRAG.longPressMs]);
    // 세로 6px — 끌기 문이었다면 들었을 거리지만, 꾹 누르기에서는 취소 임계(10px) 안의 떨림일 뿐이다.
    rig.dispatch('pointermove', moveTo(100, 16));
    expect(calls.start).toEqual([]);
    rig.fire();
    expect(calls.start).toEqual(['a']);
  });
});
