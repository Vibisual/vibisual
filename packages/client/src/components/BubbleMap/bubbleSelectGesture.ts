/**
 * 캔버스 버블의 선택 제스처 한 벌 — 클릭=선택 / 더블클릭=열기(버블 종류마다 규칙이 갈리면 더블클릭 때 패널·링이 함께 뜬다).
 *  1. {@link DRAG_MOVE_THRESHOLD_PX} 이상 움직이면 드래그. 2. 움직임 없이 떼면 링을 즉시 켠다(`intent`).
 *  3. 더블클릭 동작이 있으면 선택을 {@link SELECT_DEFER_MS} 미루고, 그 안에 2타가 오면 보류·링을 접는다. 4. 없으면 바로 선택.
 *  5. 왼쪽 버튼만 — 우클릭은 메뉴 몫(§6), 우측 패널은 왼쪽 클릭에서만. 왼쪽으로 오는 우클릭(mac Control+클릭·길게 누르기)은 `contextmenu` 가 접는다.
 * 링(즉시)과 선택(지연)을 가르는 것이 핵심 — 같이 미루면 클릭이 늦고, 같이 당기면 1타에 패널이 깜빡인다. 순수 코어 + 얇은 훅으로 나눠 테스트한다.
 */

import { useEffect, useMemo, useRef } from 'react';

/** 더블클릭 동작이 있는 버블이 선택(=우측 패널)을 미루는 시간(ms) — 이 안의 2타면 선택을 취소한다. */
export const SELECT_DEFER_MS = 240;

/** 이 픽셀 이상 움직이면 클릭이 아니라 드래그 — 선택/패널 이벤트로 새지 않음. */
export const DRAG_MOVE_THRESHOLD_PX = 5;

/**
 * {@link SELECT_DEFER_MS} 대기 중인 버블 수. 링은 1타에 일부러 켜지므로, 1타에 반응하면 안 되는 쪽(선택 초점 §5.4 #31 (K))은 링 대신 이것을 본다.
 * 새 보류를 먼저 걸고 옛 것을 걷어 잠깐 둘이 겹치므로 불리언이 아니라 센다.
 */
let deferredSelectCount = 0;
const deferredSelectListeners = new Set<() => void>();
// The ring and selected bubble are shared across gestures; their deferred owner must be shared too.
let cancelDeferredOwner: (() => void) | null = null;
/** 같은 보류의 다른 손잡이 — 기다리던 선택을 지금 끝낸다(아래 `flushDeferredBubbleSelect`). */
let commitDeferredOwner: (() => void) | null = null;

/** Cancel the previous click without touching the current ring (e.g. when a marquee takes over). */
export function cancelDeferredBubbleSelect(): void {
  cancelDeferredOwner?.();
}

/** 누적 선택 직전에 보류된 클릭을 지금 고른다(§6) — 240ms 뒤 늦게 온 선택이 방금 만든 묶음을 자기 하나로 바꾸지 않게. */
export function flushDeferredBubbleSelect(): void {
  commitDeferredOwner?.();
}

function shiftDeferredSelects(delta: 1 | -1): void {
  deferredSelectCount += delta;
  for (const listener of deferredSelectListeners) listener();
}

/** 1타의 실제 선택을 미뤄 두고 2타를 기다리는 버블이 하나라도 있는가. */
export function isSelectDeferred(): boolean {
  return deferredSelectCount > 0;
}

/** `useSyncExternalStore` 용 구독. */
export function subscribeSelectDeferred(listener: () => void): () => void {
  deferredSelectListeners.add(listener);
  return () => { deferredSelectListeners.delete(listener); };
}

/** 본체는 앞의 세 값만 본다. 뒤의 셋은 `ignore` 가 그 자리에서 이벤트를 붙잡을 때(테두리 연결 드래그 등)만 — 시험엔 세 값이면 된다. */
export interface BubbleSelectPointer {
  readonly button: number;
  readonly clientX: number;
  readonly clientY: number;
  /** 판정은 `ctrlKey || metaKey`(mac 의 Control+클릭은 우클릭이라 `contextmenu` 가 접는다). 없으면 안 눌림. */
  readonly ctrlKey?: boolean | undefined;
  readonly metaKey?: boolean | undefined;
  readonly shiftKey?: boolean | undefined;
  readonly target?: EventTarget | null | undefined;
  readonly stopPropagation?: (() => void) | undefined;
  readonly preventDefault?: (() => void) | undefined;
}

export interface BubbleSelectGestureOptions {
  /** `false` 면 지연이 없다 — 더블클릭할 일 없는 버블의 클릭이 공짜로 느려지지 않게. */
  readonly doubleClickable: boolean;
  /** 실제 선택(우측 패널까지). 지연이 끝났거나 지연이 없을 때 불린다. */
  readonly select: () => void;
  /** 링 손잡이 — 뗀 즉시 `true`, 보류를 접을 때 `false`. 캔버스가 한 칸(`selectIntentId`)을 나눠 써 다른 버블 링은 저절로 꺼진다. */
  readonly setIntent: (active: boolean) => void;
  /** `true` 면 press 를 기록하지 않는다. pointerdown 에 한 번만 불리므로 부수효과(연결 드래그 시작 등)를 여기서 해도 된다. */
  readonly ignore?: ((e: BubbleSelectPointer) => boolean) | undefined;
  /**
   * Ctrl/Cmd 를 쥐고 움직임 없이 떼면 고르지 않고(링·패널·지연 ❌) 이것으로 묶음에 넣고 뺀다(§6). 없으면 보통 클릭.
   * Shift 는 세지 않는다 — RF 가 버블 위 Shift 누름을 박스 선택으로 가져가 캔버스(`BubbleMap`)가 받으므로, 여기서도 세면 두 번 뒤집힌다.
   */
  readonly toggle?: (() => void) | undefined;
}

export interface BubbleSelectGestureCore {
  pointerDown: (e: BubbleSelectPointer) => void;
  pointerMove: (e: BubbleSelectPointer) => void;
  pointerUp: () => void;
  pointerCancel: () => void;
  /** 더블클릭 핸들러의 **첫 줄**에서 부른다 — 보류 중 단일선택과 링을 함께 접는다. */
  cancelPendingSelect: () => void;
  /** 지연 없이 지금 고른다(대상이 확정된 길 — 스펙·랩·선반·플레이의 우클릭). 우측 패널이 뜨는 버블의 우클릭엔 쓰지 않는다(규칙 5). */
  selectNow: () => void;
  /** 언마운트 정리 — 보류 타이머를 남기지 않는다. */
  dispose: () => void;
}

interface PressState {
  x: number;
  y: number;
  moved: boolean;
  /** Ctrl/Cmd 를 쥐고 누른 누적(다중) 선택인가 — `toggle` 을 준 버블에서만 켜진다. */
  additive: boolean;
}

/** 옵션을 `read` 로 그때그때 읽어 리렌더로 콜백이 바뀌어도 보류 타이머가 안 끊긴다. */
export function createBubbleSelectGesture(
  read: () => BubbleSelectGestureOptions,
): BubbleSelectGestureCore {
  let press: PressState | null = null;
  let pending: ReturnType<typeof setTimeout> | null = null;

  const releaseOwner = (): void => {
    if (cancelDeferredOwner !== clearPending) return;
    cancelDeferredOwner = null;
    commitDeferredOwner = null;
  };

  const clearPending = (): void => {
    if (pending === null) return;
    clearTimeout(pending);
    pending = null;
    releaseOwner();
    shiftDeferredSelects(-1);
  };

  // 보류를 지금 끝낸다 — 타이머가 다 돈 것과 같은 길이다(선택을 먼저 걸고 보류를 푼다 — 풀린 순간 링이
  // "확정된 선택"으로 읽히므로). 타이머 자신도 이 함수를 부른다.
  const commitPending = (): void => {
    if (pending === null) return;
    clearTimeout(pending);
    pending = null;
    releaseOwner();
    try { read().select(); } finally { shiftDeferredSelects(-1); }
  };

  const selectImmediately = (): void => {
    const cancelPrevious = cancelDeferredOwner;
    const o = read();
    // Publish the new intent before releasing the old wait: otherwise its ring briefly becomes
    // a committed focus. The previous owner must never clear the newly selected bubble's ring.
    try { o.setIntent(true); o.select(); } finally { cancelPrevious?.(); }
  };

  // 링을 먼저 끄고 보류를 접는다 — 뒤집히면 한 프레임 확정 선택으로 읽혀 초점이 깜빡인다. 보류 수는 반드시 돌려놓는다(남으면 초점이 "아직 1타"로 굳는다).
  const cancelPendingSelect = (): void => {
    if (pending === null) return;
    try { read().setIntent(false); } finally { clearPending(); }
  };

  return {
    pointerDown(e) {
      const o = read();
      if (o.ignore?.(e) === true) { press = null; return; }
      // 규칙 5 — 우클릭·가운데 버튼은 선택이 아니다(링도 우측 패널도 켜지 않는다).
      if (e.button !== 0) { press = null; return; }
      // §6 — Shift 클릭은 캔버스가 받는다(`toggle` 주석). 누적 손잡이가 없는 버블은 종전대로 보통 클릭이다.
      if (o.toggle !== undefined && e.shiftKey === true) { press = null; return; }
      const additive = o.toggle !== undefined && (e.ctrlKey === true || e.metaKey === true);

      // 보류 중인데 다시 눌렀다 = 더블클릭 의도. 보류·링을 접고, 이번 press 는 선택으로
      // 잇지 않도록 `moved` 로 마킹한다(2타의 pointerup 이 다시 선택을 걸면 안 된다).
      if (pending !== null) {
        cancelPendingSelect();
        press = { x: e.clientX, y: e.clientY, moved: true, additive };
        return;
      }
      press = { x: e.clientX, y: e.clientY, moved: false, additive };
    },

    pointerMove(e) {
      if (press === null || press.moved) return;
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) <= DRAG_MOVE_THRESHOLD_PX) return;
      press.moved = true;
      // 드래그로 확정 — 보류가 있었다면 접는다. 링은 아직 켠 적이 없으므로 건드리지 않는다.
      clearPending();
    },

    pointerUp() {
      const p = press;
      press = null;
      if (p === null || p.moved) return; // 드래그였거나 더블클릭 2타 → 선택 없음

      const o = read();
      // §6 누적(다중) 선택 — 고르지 않고 묶음에 넣거나 뺀다. 링·우측 패널은 그대로, 기다림도 없다.
      //   앞서 누른 버블이 2타를 기다리고 있으면 그 선택을 먼저 끝낸다(누른 순서대로 쌓이게).
      if (p.additive && o.toggle !== undefined) {
        flushDeferredBubbleSelect();
        o.toggle();
        return;
      }
      // 링은 지연 없이 — 눈에 보이는 반응이 늦으면 클릭이 씹힌 것처럼 느껴진다.
      if (!o.doubleClickable) { selectImmediately(); return; }
      clearPending();
      const cancelPrevious = cancelDeferredOwner;
      // 선택을 먼저 걸고 보류를 푼다 — 위 `cancelPendingSelect` 와 같은 이유(풀린 순간 링이 확정이다).
      pending = setTimeout(commitPending, SELECT_DEFER_MS);
      cancelDeferredOwner = clearPending;
      commitDeferredOwner = commitPending;
      // 보류를 먼저 걸고 링을 켠다(같은 손 안이라 지연은 없다). 링이 켜진 순간 보류가 없으면 그 1타가
      // "확정된 선택"으로 읽혀 선택 초점이 한 프레임 넘어갔다 돌아온다 — `cancelPendingSelect` 의 거울.
      shiftDeferredSelects(1);
      try { o.setIntent(true); } finally { cancelPrevious?.(); }
    },

    pointerCancel() {
      press = null;
    },

    cancelPendingSelect,

    selectNow() {
      press = null;
      selectImmediately();
    },

    dispose() {
      clearPending();
      press = null;
    },
  };
}

/** 버블 최상위 요소에 그대로 펼쳐 넣는 핸들러 묶음. */
export interface BubbleSelectGestureHandlers {
  /**
   * ⚠ 캡처 단계여야 한다 — 노드 래퍼의 `d3-drag` 가 `stopImmediatePropagation()` 하고 React 18 은 루트 위임이라
   * 버블 단계 리스너는 삼켜진다("눌러도 선택 안 됨", §5.13).
   */
  readonly onPointerDownCapture: (e: React.PointerEvent) => void;
  readonly onPointerMove: (e: React.PointerEvent) => void;
  readonly onPointerUp: (e: React.PointerEvent) => void;
  readonly onPointerCancel: (e: React.PointerEvent) => void;
  /** 메뉴를 부른 누름은 선택이 아니다(규칙 5). mac Control+클릭·터치 길게 누르기는 왼쪽 버튼이라 `contextmenu` 로 접는다(플랫폼 분기 없이 같은 길). */
  readonly onContextMenuCapture: (e: React.MouseEvent) => void;
}

export interface BubbleSelectGesture {
  readonly handlers: BubbleSelectGestureHandlers;
  /** 더블클릭 핸들러의 첫 줄에서 부른다. */
  readonly cancelPendingSelect: () => void;
  /** 우클릭 메뉴처럼 지연 없이 고르는 길. */
  readonly selectNow: () => void;
  /** 누름이 다른 손짓(테두리 크기 조절 등)으로 넘어가면 접는다 — 손이 노드 밖을 다녀오면 움직임 문턱으로는 못 잡는다. */
  readonly cancelPress: () => void;
}

/** 옵션을 ref 로 읽어 매 렌더 새 콜백이어도 보류 타이머가 안 끊긴다. */
export function useBubbleSelectGesture(options: BubbleSelectGestureOptions): BubbleSelectGesture {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const core = useMemo(() => createBubbleSelectGesture(() => optionsRef.current), []);
  useEffect(() => () => core.dispose(), [core]);

  return useMemo(
    () => ({
      handlers: {
        onPointerDownCapture: (e: React.PointerEvent) => core.pointerDown(e),
        onPointerMove: (e: React.PointerEvent) => core.pointerMove(e),
        onPointerUp: () => core.pointerUp(),
        onPointerCancel: () => core.pointerCancel(),
        onContextMenuCapture: () => core.pointerCancel(),
      },
      cancelPendingSelect: () => core.cancelPendingSelect(),
      selectNow: () => core.selectNow(),
      cancelPress: () => core.pointerCancel(),
    }),
    [core],
  );
}

/** 버블 안 버튼·입력에서 시작한 누름은 선택이 아니다 — 선반 실행 줄·캡처 툴바처럼 자기 동작을 가진 조각에서 `ignore` 로 쓴다. */
export function isInteractiveTarget(target: EventTarget | null | undefined): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('button, input, textarea, select, a[href]') !== null;
}
