import { useEffect, useState, type RefObject } from 'react';

/**
 * 어떤 요소의 **자기 폭**(px)을 재서 돌려준다. 아직 못 쟀으면 `0`.
 *
 * 왜 필요한가: 앱 안의 창(IDE 창·별창·분할 칸)은 화면이 아니다. 그 안쪽 반응형을 `max-md` 같은
 * **뷰포트** 미디어 쿼리로 짜면, 뷰포트가 1920px 인 데스크톱에서 창만 480px 로 줄였을 때 아무것도
 * 접히지 않아 내용이 창 밖으로 삐져나간다. 컨테이너 기준으로 물어야 하는 자리가 그래서 생긴다.
 *
 * `ResizeObserver` 가 없는 환경(구형 jsdom 등)에서는 마운트 시 한 번만 재고 조용히 넘어간다 —
 * 그때는 판정 쪽이 "아직 못 쟀다"로 폴백하므로 화면이 깨지지 않는다.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 첫 값은 관찰 전에 한 번 — 관찰자가 없는 환경에서도 한 벌은 재고 시작한다.
    setWidth((prev) => (prev === el.clientWidth ? prev : el.clientWidth));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      // `borderBoxSize` 가 있으면 그것을, 없으면 레이아웃 값을 쓴다(Safari 구버전).
      const next = Math.round(
        entry.borderBoxSize?.[0]?.inlineSize ?? entry.target.getBoundingClientRect().width,
      );
      setWidth((prev) => (prev === next ? prev : next));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}
