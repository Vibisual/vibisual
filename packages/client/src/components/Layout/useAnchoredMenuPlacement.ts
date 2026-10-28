import { useLayoutEffect, type RefObject } from 'react';
import { visibleViewport } from '../BubbleMap/canvasMenuPlacement.js';
import { ANCHORED_MENU_GAP, placeAnchoredMenu, type AnchoredMenuAlign } from './anchoredMenuPlacement.js';

/**
 * `placeAnchoredMenu` 를 DOM 에 건다 — 상자는 `fixed`, left/top 만 정한다. 그리기 전(useLayoutEffect)과 크기·창·스크롤 변화 때 잰다(`IDEContextMenuPanel` 과 같다).
 * DOM 상 제자리라 바깥 누름 판정은 그대로. ⚠ 조상에 `transform`·`filter`·`backdrop-filter`·`container-type` 이 있으면 `fixed` 가 갇힌다 — 포털을 써라.
 */
export function useAnchoredMenuPlacement(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
  align: AnchoredMenuAlign = 'end',
  gap: number = ANCHORED_MENU_GAP,
): void {
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;

    const update = (): void => {
      const position = placeAnchoredMenu(
        anchor.getBoundingClientRect(), menu.getBoundingClientRect(), visibleViewport(), align, gap,
      );
      menu.style.left = `${position.left}px`;
      menu.style.top = `${position.top}px`;
    };

    update();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(menu);
    observer?.observe(anchor);
    window.addEventListener('resize', update);
    // 캡처로 듣는다 — 카드를 담은 목록 칸의 스크롤은 window 로 올라오지 않는다.
    window.addEventListener('scroll', update, true);
    const visual = window.visualViewport;
    visual?.addEventListener('resize', update);
    visual?.addEventListener('scroll', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      visual?.removeEventListener('resize', update);
      visual?.removeEventListener('scroll', update);
    };
  }, [open, anchorRef, menuRef, align, gap]);
}
