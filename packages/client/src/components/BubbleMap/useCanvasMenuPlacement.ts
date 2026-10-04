import { useLayoutEffect, useState, type RefObject } from 'react';
import {
  MENU_VIEWPORT_MARGIN,
  placeCanvasMenu,
  placeCanvasSubmenu,
  type MenuViewport,
} from './canvasMenuPlacement.js';
import type { SubmenuKey } from './contextMenuSubmenu.js';

type SubmenuSide = 'left' | 'right' | 'above' | 'below';

function currentViewport(): MenuViewport {
  const viewport = window.visualViewport;
  return {
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
  };
}

/** Measure before paint; fixed submenus can escape the scrolling parent list. */
export function useCanvasMenuPlacement(
  x: number,
  y: number,
  open: SubmenuKey | null,
  menuRef: RefObject<HTMLDivElement>,
  listRef: RefObject<HTMLDivElement>,
  triggerRef: RefObject<HTMLButtonElement>,
  submenuRef: RefObject<HTMLDivElement>,
): SubmenuSide {
  const [side, setSide] = useState<SubmenuSide>('right');

  // Run after every commit: gated/translated rows can move inside a capped list.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const list = listRef.current;
    if (!menu || !list) return;

    const update = (): void => {
      const viewport = currentViewport();
      const maxWidth = `${Math.max(0, viewport.width - MENU_VIEWPORT_MARGIN * 2)}px`;
      const maxHeight = `${Math.max(0, viewport.height - MENU_VIEWPORT_MARGIN * 2)}px`;
      menu.style.maxWidth = maxWidth;
      list.style.maxHeight = maxHeight;
      const position = placeCanvasMenu({ x, y }, menu.getBoundingClientRect(), viewport);
      menu.style.left = `${position.left}px`;
      menu.style.top = `${position.top}px`;

      const trigger = triggerRef.current;
      const child = submenuRef.current;
      if (!trigger || !child) return;
      child.style.maxWidth = maxWidth;
      child.style.maxHeight = maxHeight;
      // min-width must yield even on very narrow or zoomed viewports.
      child.style.minWidth = `min(${open === 'apps' ? '18rem' : '16rem'}, ${maxWidth})`;
      const placement = placeCanvasSubmenu(
        trigger.getBoundingClientRect(), child.getBoundingClientRect(), viewport,
      );
      child.style.maxHeight = `${placement.maxHeight}px`;
      child.style.left = `${placement.left}px`;
      child.style.top = `${placement.top}px`;
      setSide((previous) => previous === placement.side ? previous : placement.side);
    };

    update();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    for (const element of [menu, list, triggerRef.current, submenuRef.current]) {
      if (element) observer?.observe(element);
    }
    window.addEventListener('resize', update);
    // Scrolling the parent list moves the row anchoring a fixed submenu.
    list.addEventListener('scroll', update);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      list.removeEventListener('scroll', update);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
    };
  });

  return side;
}
