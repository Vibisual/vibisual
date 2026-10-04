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
