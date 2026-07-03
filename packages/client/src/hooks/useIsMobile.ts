import { useEffect, useState, useRef, useCallback } from 'react';

// 모바일 웹 접속(§4 v3.16) 반응형 분기용 미디어쿼리 훅.
// 데스크톱 Electron 은 뷰포트가 넓고 포인터가 fine 이라 두 훅 모두 false → 기존 동작 불변.

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
export function useIsNarrowViewport(): boolean {
  return useMediaQuery('(max-width: 767px)');
}

export interface LongPressHandlers {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  onTouchCancel: (e: React.TouchEvent) => void;
}

/**
 * 터치 롱프레스 → 우클릭 대체. 터치엔 우클릭(contextmenu)이 없어 캔버스/탭의 컨텍스트 메뉴에
 * 닿을 수 없던 것을 보완한다. 한 손가락으로 `delay`ms 이상 누르고 있으면(그동안 `moveTolerance`
 * 이상 움직이지 않으면) onLongPress 를 화면 좌표와 함께 호출한다. 팬/핀치(움직임·다중 터치)는
 * 자동 취소되어 스크롤·확대와 충돌하지 않는다.
 */
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
