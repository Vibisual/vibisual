import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 스크롤하는 동안 스크롤바를 띄우는 상태 — 앱 공용 `.scrollbar-thin`(기본 숨김 + hover 페이드인)의
 * **두 번째 입구**.
 *
 * 스크롤바를 숨기면 화면은 깨끗해지지만, 마우스를 올리기 전에는 "여기 더 있다"는 신호도 함께
 * 사라진다. 휠·터치·키보드로 굴리기만 하는 경로에는 hover 가 오지 않기 때문이다. 그래서 스크롤이
 * 오는 동안 `data-scrolling` 을 켜고, 멎은 뒤 잠깐 더 두었다가 끈다 — 색은 hover 와 같은 값이라
 * (index.css `.scrollbar-thin[data-scrolling='true']`) 어느 경로로 떠도 모양이 같다.
 *
 * 스크롤 컨테이너에 그대로 펼쳐 쓴다:
 * ```tsx
 * const reveal = useScrollReveal();
 * <div className="scrollbar-thin overflow-auto" {...reveal}>…</div>
 * ```
 */

/**
 * 스크롤이 멎은 뒤 스크롤바를 더 두는 시간(ms).
 *
 * 경합을 미루는 값이 아니라 **눈이 따라올 시간**이다 — 손을 떼는 즉시 사라지면 방금 어디까지 왔는지
 * 확인할 틈이 없고, 너무 길면 숨김이 무의미해진다.
 */
const SCROLL_REVEAL_HOLD_MS = 900;

/** 스크롤 컨테이너에 그대로 펼치는 props. */
export interface ScrollRevealProps {
  'data-scrolling': 'true' | 'false';
  onScroll: () => void;
}

export function useScrollReveal(holdMs: number = SCROLL_REVEAL_HOLD_MS): ScrollRevealProps {
  const [scrolling, setScrolling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 언마운트 때 타이머를 거둔다 — 사라진 컴포넌트를 깨우는 타이머는 경고만 남기고 아무 일도 못 한다.
  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);

  const handleScroll = useCallback(() => {
    // 이미 켜져 있으면 상태를 다시 쓰지 않는다 — 스크롤 한 번에 이벤트가 수십 번 오므로
    // 매번 setState 하면 그 프레임마다 리렌더가 걸린다(연장은 타이머만 다시 건다).
    setScrolling((on) => (on ? on : true));
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setScrolling(false);
    }, holdMs);
  }, [holdMs]);

  return { 'data-scrolling': scrolling ? 'true' : 'false', onScroll: handleScroll };
}
