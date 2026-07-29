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

/**
 * 저전력(발열 억제) 모드 — 굵은 포인터(모바일·터치)면 true. 켜지면 App 이 `document.documentElement`
 * 에 `vibisual-low-power` 클래스를 걸어 index.css 가 캔버스의 흐르는 엣지·장식용 무한 애니메이션·
 * backdrop-blur 등 폰 GPU 부하를 끈다(§4 v3.39 모바일 발열 대응).
 *
 * §4 v3.41 정정: 발열 대상이 아닌 **데스크톱은 여기 포함하지 않는다**. 종전엔 `prefers-reduced-motion`
 * 도 트리거로 삼아, Windows '동작 줄이기(애니메이션 효과 끄기)'를 켠 PC 까지 저전력에 걸려 active
 * 버블의 활동 펄스 링이 통째로 꺼졌다. 이제 `(pointer: coarse)`(진짜 터치 기기)만 판정 →
 * 데스크톱은 모션 설정과 무관하게 기존 연출 그대로.
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
