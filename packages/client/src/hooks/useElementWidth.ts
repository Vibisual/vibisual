import { useEffect, useState, type RefObject } from 'react';

/** 요소의 **자기 폭**(px, 못 쟀으면 `0`). 앱 안 창은 뷰포트가 아니다 — `max-md` 로는 창만 줄였을 때 안 접힌다. `ResizeObserver` 가 없으면 마운트 때 한 번만 잰다. */
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
