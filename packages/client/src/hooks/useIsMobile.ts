import { useEffect, useState, useRef, useCallback } from 'react';

// 모바일 웹 접속(§4) 반응형 분기용 미디어쿼리 훅. 데스크톱 Electron 은 뷰포트가 넓고 포인터가 fine 이라 둘 다 false.

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const on = (): void => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/** 터치 기기(굵은 포인터) — 핀치 줌 범위 확장 등 터치 인터랙션 대상 판정. */
export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)');
}

/** 좁은 뷰포트(폰 세로 폭) — 사이드 패널을 바텀시트로 전환하는 등 레이아웃 분기. */
/** 좁은 뷰포트 기준 — 훅과 즉시 조회가 **같은 문자열**을 봐야 판정이 갈리지 않는다. */
const NARROW_VIEWPORT_QUERY = '(max-width: 767px)';

export function useIsNarrowViewport(): boolean {
  return useMediaQuery(NARROW_VIEWPORT_QUERY);
}

/**
 * 떠 있는 창을 **화면 전체로 고정**할지 — 폰 폭이거나 터치 기기(끌기·크기 조절이 마우스 이벤트라 손가락으론 못 옮긴다)면 true.
 * ⚠ 두 훅을 **언제나 둘 다** 부른다 — `a() || b()` 면 훅 순서가 바뀐다.
 */
export function useFloatingWindowFullScreenLock(): boolean {
  const narrow = useIsNarrowViewport();
  const coarse = useCoarsePointer();
  return narrow || coarse;
}

/** `useIsNarrowViewport` 와 **같은 기준**을 훅 밖(이벤트 콜백 등)에서 한 번 읽을 때. */
export function isNarrowViewportNow(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(NARROW_VIEWPORT_QUERY).matches;
}

/**
 * 저전력 — `(pointer: coarse)` 면 true(App 이 `vibisual-low-power` 를 걸어 index.css 가 흐르는 엣지·무한 애니메이션·blur 를 끈다 — §4).
 * `prefers-reduced-motion` 을 넣지 마라 — Windows 애니메이션 효과를 끈 데스크톱의 펄스 링까지 꺼진다.
 */
export function useLowPowerMode(): boolean {
  return useMediaQuery('(pointer: coarse)');
}

export interface LongPressHandlers {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  onTouchCancel: (e: React.TouchEvent) => void;
}

/** 터치 롱프레스 → 우클릭 대체(터치엔 contextmenu 가 없다). 한 손가락으로 `delay`ms 이상, `moveTolerance` 안에서 누르면 onLongPress. 움직임·다중 터치는 취소돼 팬/핀치와 안 부딪힌다. */
export function useLongPress(
  onLongPress: (x: number, y: number, target: EventTarget | null) => void,
  { delay = 500, moveTolerance = 12 }: { delay?: number; moveTolerance?: number } = {},
): LongPressHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number; target: EventTarget | null } | null>(null);

  const clear = useCallback((): void => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    start.current = null;
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent): void => {
    if (e.touches.length !== 1) { clear(); return; }
    const touch = e.touches[0];
    if (!touch) return;
    start.current = { x: touch.clientX, y: touch.clientY, target: e.target };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const s = start.current;
      if (s) onLongPress(s.x, s.y, s.target);
    }, delay);
  }, [clear, delay, onLongPress]);

  const onTouchMove = useCallback((e: React.TouchEvent): void => {
    const s = start.current;
    if (!s || e.touches.length !== 1) { clear(); return; }
    const touch = e.touches[0];
    if (!touch) return;
    if (Math.abs(touch.clientX - s.x) > moveTolerance || Math.abs(touch.clientY - s.y) > moveTolerance) {
      clear();
    }
  }, [clear, moveTolerance]);

  return { onTouchStart, onTouchMove, onTouchEnd: clear, onTouchCancel: clear };
}
