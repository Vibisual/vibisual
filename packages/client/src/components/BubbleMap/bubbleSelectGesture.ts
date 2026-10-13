/**
 * 캔버스 버블의 **선택 제스처 한 벌** — "클릭=선택 / 더블클릭=열기" 를 가르는 상태기계.
 *
 * 이 파일이 있는 이유는 하나다. 캔버스에는 버블 종류가 열 가지가 넘는데(에이전트·폴더·앱·
 * 캡처·플레이·스펙·랩·선반·메모…), 그중 **선택과 더블클릭을 둘 다 가진 버블**에서 규칙이
 * 제각각이면 같은 캔버스에서 손버릇이 갈린다. 실제로 에이전트 버블만 이 상태기계를 들고
 * 있었고 나머지는 **누르는 순간 곧바로 선택**해 버려서, 더블클릭으로 창을 열 때마다 선택
 * 동작(우측 옵션 패널 + 선택 링)이 함께 발동했다 — 사용자 지적의 실체가 그것이다.
 *
 * **규칙**(에이전트 버블이 원래 쓰던 것 그대로):
 *  1. 누른 자리에서 **{@link DRAG_MOVE_THRESHOLD_PX} 이상 움직이면 드래그** — 선택이 아니다.
 *  2. 움직임 없이 뗐으면 **선택 링을 즉시 켠다**(`intent`). 눈에 보이는 반응은 지연 ❌.
 *  3. 더블클릭 동작이 있는 버블이면 **실제 선택은 {@link SELECT_DEFER_MS} 만큼 미룬다.**
 *     그 창 안에 두 번째 누름이 오면 = 더블클릭 의도 → 보류를 접고 링도 끈다.
 *  4. 더블클릭 동작이 없는 버블은 미룰 이유가 없다 — 뗀 자리에서 바로 선택한다.
 *  5. **누름은 왼쪽 버튼만 센다** — 우클릭은 메뉴의 손이다(§6). 우측 패널(DetailPanel)은 왼쪽 클릭
 *     선택에서만 뜬다(2026-10-11 사용자 지시 — 종전에 예외였던 에이전트 버블도 이제 예외가 없다).
 *     왼쪽 버튼으로 오는 우클릭(mac Control+클릭·터치 길게 누르기)은 `contextmenu` 가 누름을 접는다.
 *
 * 링(즉시)과 선택(지연)을 갈라 놓는 것이 핵심이다. 둘을 같이 미루면 단일 클릭이 240ms 늦게
 * 반응하는 것처럼 느껴지고, 둘을 같이 당기면 더블클릭 1타에서 패널이 열렸다 닫히며 깜빡인다.
 *
 * React 없이 단위 테스트할 수 있도록 **순수 코어({@link createBubbleSelectGesture})** 와
 * 얇은 훅({@link useBubbleSelectGesture}) 으로 나눠 둔다.
 */

import { useEffect, useMemo, useRef } from 'react';

/**
 * 더블클릭 동작이 있는 버블이 단일선택(=우측 패널 열림)을 미루는 시간 (ms).
 *
 * 이 창 안에 두 번째 클릭이 오면 단일선택을 취소하고 더블클릭 동작만 수행한다 → 패널 깜빡임 제거.
 */
export const SELECT_DEFER_MS = 240;

/** 이 픽셀 이상 움직이면 클릭이 아니라 드래그 — 선택/패널 이벤트로 새지 않음. */
export const DRAG_MOVE_THRESHOLD_PX = 5;

/**
 * 지금 {@link SELECT_DEFER_MS} 를 기다리는 중인 버블 수 — "더블클릭의 1타일 수도 있는 클릭"이 있는가.
 *
 * 링은 그 1타에 **일부러** 즉시 반응한다(규칙 2). 그래서 링(`selectIntentId`)만 보고 움직이는 표시는
 * 더블클릭 한 번에 켜졌다 꺼진다. 1타에 반응하면 안 되는 쪽(캔버스 선택 초점 — §5.4 #31 (K))은 링 대신
 * 여기에 "링이 확정됐나"를 묻는다. 최신 클릭으로 넘길 때 새 보류를 먼저 걸고 옛 보류를
 * 걷으므로 잠깐 두 건이 겹칠 수 있다. 그 사이 보류가 풀리지 않게 수를 센다.
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

/**
 * 2타를 기다리는 클릭이 있으면 **지금** 고른다 — 누적(다중) 선택 직전에 부른다(§6).
 *
 * 보통 클릭의 실제 선택은 240ms 뒤라, 그 사이에 Ctrl/Cmd·Shift 로 다른 버블을 넣으면 늦게 온 그
 * 클릭이 방금 만든 묶음을 자기 하나로 바꿔 버린다. 누른 순서대로 쌓이게 먼저 끝내 둔다.
 */
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

/**
 * 상태기계가 포인터에서 실제로 보는 것 — React 이벤트든 네이티브든 앞의 세 값이면 된다.
 *
 * 뒤의 셋은 {@link BubbleSelectGestureOptions.ignore} 가 "이 누름은 선택이 아니라 다른 동작"
 * 이라고 판정하면서 그 자리에서 이벤트를 붙잡아야 할 때만 쓴다(예: 테두리 연결 드래그).
 * 상태기계 본체는 이 셋을 부르지 않으므로 테스트에서는 앞의 세 값만 넘기면 된다.
 */
export interface BubbleSelectPointer {
  readonly button: number;
  readonly clientX: number;
  readonly clientY: number;
  /**
   * 수식 키 — 누적(다중) 선택 판정에 쓴다({@link BubbleSelectGestureOptions.toggle}). 판정은
   * `ctrlKey || metaKey` 다(win/linux Ctrl · mac Cmd — mac 의 Control+클릭은 우클릭이라 `contextmenu`
   * 가 누름을 접는다). 없으면 안 눌린 것으로 본다.
   */
  readonly ctrlKey?: boolean | undefined;
  readonly metaKey?: boolean | undefined;
  readonly shiftKey?: boolean | undefined;
  readonly target?: EventTarget | null | undefined;
  readonly stopPropagation?: (() => void) | undefined;
  readonly preventDefault?: (() => void) | undefined;
}

export interface BubbleSelectGestureOptions {
  /**
   * 이 버블에 더블클릭 동작이 있는가.
   *
   * `false` 면 지연이 붙지 않는다 — 더블클릭할 일이 없는 버블의 단일 클릭이 공짜로
   * {@link SELECT_DEFER_MS} 만큼 느려지지 않게 한다.
   */
  readonly doubleClickable: boolean;
  /** 실제 선택(우측 패널까지). 지연이 끝났거나 지연이 없을 때 불린다. */
  readonly select: () => void;
  /**
   * 선택 링만 켜고 끄는 손잡이. 손 뗀 즉시 `true`, 보류를 접을 때 `false`.
   *
   * 링은 캔버스 전체가 한 칸(`graphStore.selectIntentId`)을 나눠 쓰므로, 여기서 켜는 순간
   * 다른 버블의 링은 알아서 꺼진다 — 두 개가 동시에 선택된 것처럼 보이는 일이 없다.
   */
  readonly setIntent: (active: boolean) => void;
  /**
   * 이 누름을 선택으로 치지 않을 조건(버블 위의 버튼·테두리 연결 손잡이·네비게이션 버블 등).
   *
   * `true` 를 돌려주면 press 자체를 기록하지 않는다. 부수효과(연결 드래그 시작 등)를 여기서
   * 함께 처리해도 된다 — 이 술어는 pointerdown 에서 딱 한 번 불린다.
   */
  readonly ignore?: ((e: BubbleSelectPointer) => boolean) | undefined;
  /**
   * 누적(다중) 선택 — Ctrl/Cmd 를 쥐고 움직임 없이 뗐으면 고르지 않고(링·우측 패널 ❌, 지연 ❌) 이것을
   * 부른다. 이 버블을 지금 묶음에 넣거나 뺀다(§6).
   *
   * 이 손잡이를 준 버블에서는 **Shift 누름을 세지 않는다** — Shift 는 박스 선택 키이기도 해서 React Flow
   * 가 버블 위 Shift 누름을 박스 선택 시작으로 가져가므로, Shift 클릭은 캔버스(`BubbleMap`)가 한 곳에서
   * 받는다. 여기서도 세면 한 번 누름에 두 번 뒤집힌다. 없으면 수식 키 클릭도 보통 클릭이다.
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
  /**
   * 지연 없이 지금 고른다(우클릭 메뉴처럼 대상이 이미 확정된 길 — 스펙·랩·선반·플레이 버블).
   * ⚠ 고르면 우측 패널이 뜨는 버블(에이전트·말풍선 카드·앱)의 우클릭에는 쓰지 않는다 — 그 패널은
   * 왼쪽 클릭 선택에서만 뜬다(규칙 5).
   */
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

/**
 * 상태기계 본체. `read` 로 옵션을 그때그때 읽으므로, 리렌더로 콜백이 새로 만들어져도
 * 코어를 다시 만들 필요가 없다(보류 타이머가 끊기지 않는다).
 */
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

  // 링을 먼저 끄고 보류를 접는다 — 순서가 뒤집혀 그 사이에 한 번 그려지면, 보류가 풀린 링이
  // "확정된 선택"으로 읽혀 선택 초점이 한 프레임 켜졌다 꺼진다. 보류 수는 무슨 일이 있어도
  // 돌려놓는다(남으면 선택 초점이 영영 "아직 1타"로 읽혀 굳는다).
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
   * ⚠ **캡처 단계**여야 한다. 드래그 가능한 노드 래퍼에는 React Flow 가 `d3-drag` 를 걸어 두는데,
   * d3-drag 는 누름을 받자마자 `stopImmediatePropagation()` 을 호출한다. React 18 은 핸들러를
   * 루트 컨테이너에 위임하므로 버블 단계 리스너는 통째로 삼켜진다 — "눌러도 선택이 안 되는"
   * 버블이 되는 자리가 여기였다(§5.13 v4.69). 캡처 단계는 래퍼에 닿기 전에 발화해 이를 피한다.
   */
  readonly onPointerDownCapture: (e: React.PointerEvent) => void;
  readonly onPointerMove: (e: React.PointerEvent) => void;
  readonly onPointerUp: (e: React.PointerEvent) => void;
  readonly onPointerCancel: (e: React.PointerEvent) => void;
  /**
   * 메뉴를 부른 누름은 선택이 아니다(규칙 5). 우클릭이 **왼쪽 버튼으로 오는** 자리가 있다 — mac 의
   * Control+클릭, 터치 길게 누르기. 그 누름은 손을 떼기 전에 `contextmenu` 가 먼저 오므로 여기서 접는다
   * (플랫폼 분기 없이 세 OS 가 같은 길). 캡처 단계라 버블 안 조각이 전파를 끊어도 먼저 닿는다.
   */
  readonly onContextMenuCapture: (e: React.MouseEvent) => void;
}

export interface BubbleSelectGesture {
  readonly handlers: BubbleSelectGestureHandlers;
  /** 더블클릭 핸들러의 첫 줄에서 부른다. */
  readonly cancelPendingSelect: () => void;
  /** 우클릭 메뉴처럼 지연 없이 고르는 길. */
  readonly selectNow: () => void;
}

/**
 * {@link createBubbleSelectGesture} 를 컴포넌트에 붙이는 얇은 훅.
 *
 * 옵션은 ref 로 읽으므로 매 렌더마다 콜백을 새로 만들어도 보류 타이머가 끊기지 않는다.
 */
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
    }),
    [core],
  );
}

/**
 * 버블 위의 버튼·입력 위에서 시작한 누름인가 — 여기서 시작한 press 는 선택으로 치지 않는다.
 *
 * 선반의 실행 줄이나 캡처 헤더의 아이콘 툴바처럼 **버블 안에 자기 동작을 가진 조각**이 있는
 * 버블에서 {@link BubbleSelectGestureOptions.ignore} 로 그대로 쓴다.
 */
export function isInteractiveTarget(target: EventTarget | null | undefined): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('button, input, textarea, select, a[href]') !== null;
}
