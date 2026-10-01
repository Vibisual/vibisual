import { useLayoutEffect, useState, type RefObject } from 'react';
import { placeReadingPanel, sameReadingPanelPlacement, visibleBounds, type ReadingPanelPlacement } from './readingPanelPlacement.js';

/**
 * §5.5 #17-22 ① — [읽기] 패널을 IDE 창 안에 넣는 자리를 재는 훅(판정은 `readingPanelPlacement.ts`).
 *
 * 기준 상자는 패널의 `offsetParent`(= 버튼 칸), 경계는 패널을 품은 IDE 창(`[data-ide-overlay]`)이다.
 * 레이아웃 단계에서 재므로 첫 페인트부터 제자리에 그려진다. 창 크기가 바뀌면(떼어 낸 창을 늘리고
 * 줄이거나 도크 폭이 바뀌면) 다시 잰다 — 창을 끌거나 가장자리를 잡는 것은 바깥 누름이라 패널이 먼저 닫힌다.
 */
export function useReadingPanelPlacement(panelRef: RefObject<HTMLElement | null>): ReadingPanelPlacement | null {
  const [placement, setPlacement] = useState<ReadingPanelPlacement | null>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchorEl = panel?.offsetParent ?? panel?.parentElement ?? null;
    if (!panel || !anchorEl) return;
    const windowEl = panel.closest('[data-ide-overlay]');

    const measure = (): void => {
      const bounds = visibleBounds(windowEl?.getBoundingClientRect() ?? null, { w: window.innerWidth, h: window.innerHeight });
      const next = placeReadingPanel(anchorEl.getBoundingClientRect(), bounds);
      setPlacement((prev) => (sameReadingPanelPlacement(prev, next) ? prev : next));
    };

    measure();
    window.addEventListener('resize', measure);
    const observer = windowEl && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (windowEl) observer?.observe(windowEl);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [panelRef]);

  return placement;
}
