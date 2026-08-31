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
   * 왼쪽 버튼만 선택으로 칠지. 기본 `true`.
   *
   * 에이전트 버블은 예외로 `false` 다 — 우클릭도 그 버블을 고른 것으로 쳐 왔고(메뉴가 뜬 대상이
   * 무엇인지 화면에 보여야 한다), 그 손버릇을 이 정리가 바꾸지 않는다.
   */
  readonly leftButtonOnly?: boolean | undefined;
}

export interface BubbleSelectGestureCore {
  pointerDown: (e: BubbleSelectPointer) => void;
  pointerMove: (e: BubbleSelectPointer) => void;
  pointerUp: () => void;
  pointerCancel: () => void;
  /** 더블클릭 핸들러의 **첫 줄**에서 부른다 — 보류 중 단일선택과 링을 함께 접는다. */
  cancelPendingSelect: () => void;
  /** 지연 없이 지금 고른다(우클릭 메뉴처럼 대상이 이미 확정된 길). */
  selectNow: () => void;
  /** 언마운트 정리 — 보류 타이머를 남기지 않는다. */
  dispose: () => void;
}

interface PressState {
  x: number;
  y: number;
  moved: boolean;
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

  const clearPending = (): void => {
    if (pending === null) return;
    clearTimeout(pending);
    pending = null;
  };

  const cancelPendingSelect = (): void => {
    const hadPending = pending !== null;
    clearPending();
    if (hadPending) read().setIntent(false);
  };

  return {
    pointerDown(e) {
      const o = read();
      if (o.ignore?.(e) === true) { press = null; return; }
      if ((o.leftButtonOnly ?? true) && e.button !== 0) { press = null; return; }

      // 보류 중인데 다시 눌렀다 = 더블클릭 의도. 보류·링을 접고, 이번 press 는 선택으로
      // 잇지 않도록 `moved` 로 마킹한다(2타의 pointerup 이 다시 선택을 걸면 안 된다).
      if (pending !== null) {
        clearPending();
        o.setIntent(false);
        press = { x: e.clientX, y: e.clientY, moved: true };
        return;
      }
      press = { x: e.clientX, y: e.clientY, moved: false };
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
      // 링은 지연 없이 — 눈에 보이는 반응이 늦으면 클릭이 씹힌 것처럼 느껴진다.
      o.setIntent(true);
      if (!o.doubleClickable) { o.select(); return; }
      clearPending();
      pending = setTimeout(() => {
        pending = null;
        read().select();
      }, SELECT_DEFER_MS);
    },

    pointerCancel() {
      press = null;
    },

    cancelPendingSelect,

    selectNow() {
      clearPending();
      press = null;
      const o = read();
      o.setIntent(true);
      o.select();
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
