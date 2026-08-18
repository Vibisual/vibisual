import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import {
  createInsideGestureLatch,
  isPointWithinViewport,
  shouldDismissOnBackdropRelease,
} from './popupDismiss.js';
import type { ViewportSize } from './popupDismiss.js';

/**
 * 팝업 닫기 배선 — **모든 팝업이 이 두 훅 중 하나를 쓴다.**
 *
 * 규약: *팝업 안에서 시작한 제스처는 그 팝업을 닫지 못한다.* 판정 근거는
 * [popupDismiss.ts](./popupDismiss.ts) 주석 참고(백드롭 click 은 press·release 의 공통 조상에
 * 오기 때문에, 패널 안에서 눌러 창 밖까지 끌고 나가면 백드롭 클릭으로 오인된다).
 *
 * - 백드롭(전면 스크림)이 있는 모달   → `useBackdropDismiss`
 * - 백드롭 없이 문서 클릭으로 닫는 메뉴/팝오버 → `useOutsidePressDismiss`
 *
 * 새 팝업을 만들 때도 직접 `onClick={onClose}` 나 `addEventListener('mousedown')` 을 쓰지 말고
 * 이 훅을 쓴다.
 */

/** click 이벤트가 발생하는 주 버튼. */
const PRIMARY_BUTTON = 0;

function currentViewport(): ViewportSize {
  return { w: window.innerWidth, h: window.innerHeight };
}

export interface BackdropDismissHandlers<T extends Element> {
  onMouseDown: (e: ReactMouseEvent<T>) => void;
  onClick: (e: ReactMouseEvent<T>) => void;
}

/**
 * 백드롭 요소에 그대로 펼쳐 넣는 닫기 핸들러 한 쌍.
 *
 * ```tsx
 * const backdrop = useBackdropDismiss(onClose);
 * <div className="fixed inset-0 …" {...backdrop}> <Panel /> </div>
 * ```
 *
 * 백드롭 **자신**을 누르고 백드롭 **자신**에서 뗐을 때만 닫는다. 패널 안에서 시작한 드래그(텍스트
 * 선택·슬라이더·스크롤바)는 어디서 끝나든, 창 밖까지 나갔다 와도 닫지 않는다.
 */
export function useBackdropDismiss<T extends Element = HTMLDivElement>(
  onDismiss: () => void,
): BackdropDismissHandlers<T> {
  // 호출자가 매 렌더 새 콜백을 줘도 핸들러 정체성이 흔들리지 않게 ref 로 고정.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const pressedOnBackdropRef = useRef(false);

  const onMouseDown = useCallback((e: ReactMouseEvent<T>): void => {
    pressedOnBackdropRef.current = e.button === PRIMARY_BUTTON && e.target === e.currentTarget;
  }, []);

  const onClick = useCallback((e: ReactMouseEvent<T>): void => {
    const pressedOnBackdrop = pressedOnBackdropRef.current;
    pressedOnBackdropRef.current = false;
    const dismiss = shouldDismissOnBackdropRelease({
      pressedOnBackdrop,
      releasedOnBackdrop: e.target === e.currentTarget,
      releaseWithinViewport: isPointWithinViewport({ x: e.clientX, y: e.clientY }, currentViewport()),
    });
    if (dismiss) onDismissRef.current();
  }, []);

  return { onMouseDown, onClick };
}

export type OutsidePressEvent = 'mousedown' | 'pointerdown';

export interface OutsidePressDismissOptions {
  /** 바깥을 눌렀을 때 호출. */
  readonly onDismiss: () => void;
  /** false 면 리스너를 걸지 않는다(팝업이 닫혀 있는 동안). 기본 true. */
  readonly enabled?: boolean;
  /** 이 요소들 안에서 일어난 press 는 "안"으로 본다(패널·트리거 버튼 등). */
  readonly refs?: ReadonlyArray<RefObject<HTMLElement | null>>;
  /** ref 로 표현할 수 없는 "안" 판정(포털·data 속성 기반 등). */
  readonly isInside?: (target: Element | null) => boolean;
  /** 캡처 단계로 들을지. React Flow 처럼 중간에서 전파를 끊는 화면 위에선 true 가 필요하다. 기본 true. */
  readonly capture?: boolean;
  /** 들을 press 이벤트. 기본 `['mousedown']`. */
  readonly events?: ReadonlyArray<OutsidePressEvent>;
  /** 열린 직후 이 시간 안의 press 는 무시(팝업을 연 그 제스처의 잔여 이벤트 회피). 기본 0. */
  readonly graceMs?: number;
  /** 이 press 를 애초에 닫기 후보로 볼지(버튼 종류 등). 기본: 전부 후보. */
  readonly shouldConsider?: (e: MouseEvent) => boolean;
}

/** 제스처가 끝났다고 보는 이벤트 — 여기서 "안에서 시작한 제스처" 잠금을 푼다. */
const RELEASE_EVENTS = ['mouseup', 'pointerup', 'pointercancel', 'dragend'] as const;

/**
 * 백드롭 없이 문서 전체를 듣는 팝오버·컨텍스트 메뉴용 닫기.
 *
 * 팝업 안에서 시작한 제스처가 아직 안 끝났으면(창 밖으로 끌고 나간 드래그 포함) 그 사이 도착하는
 * 바깥 press 를 닫기 사유로 치지 않는다. 화면 밖 좌표에서 온 press 도 무시한다.
 */
export function useOutsidePressDismiss(options: OutsidePressDismissOptions): void {
  const { enabled = true, capture = true, events } = options;

  // 매 렌더 새로 만들어지는 콜백·배열 때문에 리스너가 재등록되지 않도록 최신 옵션을 ref 로 넘긴다.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // 이벤트 목록은 배열이라 그대로 의존성에 넣으면 매 렌더 재등록된다 — 문자열 키로 고정.
  const eventsKey = (events ?? ['mousedown']).join(',');

  useEffect(() => {
    if (!enabled) return;
    const latch = createInsideGestureLatch();
    const attachedAt = Date.now();
    const pressEvents = eventsKey.split(',') as OutsidePressEvent[];

    const handlePress = (raw: Event): void => {
      const e = raw as MouseEvent;
      const opts = optionsRef.current;
      if (opts.shouldConsider && !opts.shouldConsider(e)) return;
      if (Date.now() - attachedAt < (opts.graceMs ?? 0)) return;
      const target = e.target instanceof Element ? e.target : null;
      const insidePopup =
        (opts.refs?.some((ref) => (target ? (ref.current?.contains(target) ?? false) : false)) ?? false)
        || (opts.isInside?.(target) ?? false);
      const dismiss = latch.press({
        insidePopup,
        withinViewport: isPointWithinViewport({ x: e.clientX, y: e.clientY }, currentViewport()),
      });
      if (dismiss) opts.onDismiss();
    };
    const handleRelease = (): void => latch.release();

    for (const name of pressEvents) window.addEventListener(name, handlePress, capture);
    for (const name of RELEASE_EVENTS) window.addEventListener(name, handleRelease, true);
    // 포커스가 창을 떠나면 뗀 이벤트를 못 받을 수 있다 — 잠금이 남지 않게 여기서도 푼다.
    window.addEventListener('blur', handleRelease);

    return () => {
      for (const name of pressEvents) window.removeEventListener(name, handlePress, capture);
      for (const name of RELEASE_EVENTS) window.removeEventListener(name, handleRelease, true);
      window.removeEventListener('blur', handleRelease);
    };
  }, [enabled, capture, eventsKey]);
}
