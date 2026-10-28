/** Viewport coordinates are CSS pixels, including a visual viewport's offset. */
export interface MenuViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MenuSize {
  width: number;
  height: number;
}

export interface MenuAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const MENU_VIEWPORT_MARGIN = 8;

/** 화면 크기를 읽는 자리 — 시험이 가짜 창을 넣을 수 있게 필요한 칸만 받는다. */
export interface ViewportSource {
  innerWidth: number;
  innerHeight: number;
  visualViewport?: Pick<VisualViewport, 'offsetLeft' | 'offsetTop' | 'width' | 'height'> | null;
}

/** 보이는 화면(시각 뷰포트) 기준 — 폰 키보드·핀치 확대엔 `innerHeight` 가 그대로라 창 크기로 재면 상자가 키보드 밑에 깔린다. 없으면 창 크기. */
export function visibleViewport(win: ViewportSource = window): MenuViewport {
  const v = win.visualViewport;
  return {
    left: v?.offsetLeft ?? 0,
    top: v?.offsetTop ?? 0,
    width: v?.width ?? win.innerWidth,
    height: v?.height ?? win.innerHeight,
  };
}

/** The caller constrains the rendered size; an oversized measurement starts at the near edge. */
function clampAxis(position: number, size: number, origin: number, extent: number): number {
  const start = origin + MENU_VIEWPORT_MARGIN;
  const end = Math.max(start, origin + extent - MENU_VIEWPORT_MARGIN - size);
  return Math.max(start, Math.min(position, end));
}

/** Keep the menu near the pointer while retaining all of its measured, constrained size. */
export function placeCanvasMenu(
  point: { x: number; y: number },
  size: MenuSize,
  viewport: MenuViewport,
): { left: number; top: number } {
  return {
    left: clampAxis(point.x, size.width, viewport.left, viewport.width),
    top: clampAxis(point.y, size.height, viewport.top, viewport.height),
  };
}

/**
 * Prefer the right side, then the left. Narrow viewports use space below or above the
 * trigger so opening a submenu cannot turn the intended trigger click into an action.
 * Flush edges leave no empty hover gap between menu and submenu.
 */
export function placeCanvasSubmenu(
  anchor: MenuAnchor,
  size: MenuSize,
  viewport: MenuViewport,
): { left: number; top: number; side: 'left' | 'right' | 'above' | 'below'; maxHeight: number } {
  const right = anchor.left + anchor.width;
  const rightRoom = viewport.left + viewport.width - MENU_VIEWPORT_MARGIN - right;
  const leftRoom = anchor.left - viewport.left - MENU_VIEWPORT_MARGIN;
  const viewportHeight = Math.max(0, viewport.height - MENU_VIEWPORT_MARGIN * 2);
  if (rightRoom >= size.width || leftRoom >= size.width) {
    const side = rightRoom >= size.width ? 'right' : 'left';
    return {
      left: clampAxis(side === 'right' ? right : anchor.left - size.width, size.width, viewport.left, viewport.width),
      top: clampAxis(anchor.top, Math.min(size.height, viewportHeight), viewport.top, viewport.height),
      side,
      maxHeight: viewportHeight,
    };
  }

  const bottom = anchor.top + anchor.height;
  const belowRoom = Math.max(0, viewport.top + viewport.height - MENU_VIEWPORT_MARGIN - bottom);
  const aboveRoom = Math.max(0, anchor.top - viewport.top - MENU_VIEWPORT_MARGIN);
  const side = belowRoom >= size.height
    ? 'below'
    : aboveRoom >= size.height || aboveRoom > belowRoom
      ? 'above'
      : 'below';
  const maxHeight = Math.min(viewportHeight, side === 'below' ? belowRoom : aboveRoom);
  const height = Math.min(size.height, maxHeight);
  return {
    left: clampAxis(anchor.left, size.width, viewport.left, viewport.width),
    top: clampAxis(side === 'below' ? bottom : anchor.top - height, height, viewport.top, viewport.height),
    side,
    maxHeight,
  };
}
