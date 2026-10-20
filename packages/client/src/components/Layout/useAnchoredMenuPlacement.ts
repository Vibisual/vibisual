import { useLayoutEffect, type RefObject } from 'react';
import { visibleViewport } from '../BubbleMap/canvasMenuPlacement.js';
import { ANCHORED_MENU_GAP, placeAnchoredMenu, type AnchoredMenuAlign } from './anchoredMenuPlacement.js';

/**
 * `placeAnchoredMenu` 를 DOM 에 거는 손. 상자는 `fixed` 클래스로 그리고 left/top 만 여기서 정한다.
 *
 * 그리기 전에 재고(useLayoutEffect — 첫 칠이 엉뚱한 자리에 번쩍이지 않는다), 상자·트리거 크기가 바뀌거나
 * 창 크기·스크롤이 움직이면 다시 잰다 — 스크롤 목록 안의 카드가 움직여도 메뉴가 트리거를 따라간다
 * (`IDEContextMenuPanel` 과 같은 배선). 상자는 DOM 상으로는 그 자리에 남으므로 바깥 누름 판정·클릭
 * 전파는 종전 그대로다.
 *
 * ⚠ 상자의 조상에 `transform`·`filter`·`backdrop-filter`·`container-type` 이 있으면 `fixed` 가 그 조상에
 * 갇힌다 — 그런 자리에서는 이 훅이 아니라 포털을 써라.
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
