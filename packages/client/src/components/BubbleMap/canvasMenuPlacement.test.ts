import { describe, expect, it } from 'vitest';
import {
  MENU_VIEWPORT_MARGIN,
  placeCanvasMenu,
  placeCanvasSubmenu,
  type MenuAnchor,
  type MenuSize,
  type MenuViewport,
} from './canvasMenuPlacement.js';

const desktop: MenuViewport = { left: 0, top: 0, width: 1440, height: 900 };
const margin = MENU_VIEWPORT_MARGIN;

function expectWithinViewport(position: { left: number; top: number }, size: MenuSize, viewport: MenuViewport): void {
  expect(position.left).toBeGreaterThanOrEqual(viewport.left + margin);
  expect(position.top).toBeGreaterThanOrEqual(viewport.top + margin);
  expect(position.left + size.width).toBeLessThanOrEqual(viewport.left + viewport.width - margin);
  expect(position.top + size.height).toBeLessThanOrEqual(viewport.top + viewport.height - margin);
}

describe('placeCanvasMenu', () => {
  it('keeps the pointer origin when the actual menu fits', () => {
    expect(placeCanvasMenu({ x: 420, y: 210 }, { width: 280, height: 320 }, desktop))
      .toEqual({ left: 420, top: 210 });
  });

  it('keeps the complete measured menu visible at the bottom-right corner', () => {
    const size = { width: 340, height: 520 };
    const position = placeCanvasMenu({ x: 1439, y: 899 }, size, desktop);
    expect(position).toEqual({ left: 1092, top: 372 });
    expectWithinViewport(position, size, desktop);
  });

  it('clamps a pointer outside the top-left edge', () => {
    expect(placeCanvasMenu({ x: -25, y: -100 }, { width: 260, height: 200 }, desktop))
      .toEqual({ left: margin, top: margin });
  });

  it('uses the visible viewport offset rather than the document origin', () => {
    const viewport = { left: 160, top: 240, width: 640, height: 360 };
    const size = { width: 320, height: 260 };
    const position = placeCanvasMenu({ x: 790, y: 595 }, size, viewport);
    expect(position).toEqual({ left: 472, top: 332 });
    expectWithinViewport(position, size, viewport);
  });

  it('repositions an open menu after the viewport shrinks', () => {
    const point = { x: 1000, y: 700 };
    const size = { width: 300, height: 360 };
    const before = placeCanvasMenu(point, size, desktop);
    const resized = { ...desktop, width: 720, height: 480 };
    const after = placeCanvasMenu(point, size, resized);
    expect(after.left).toBeLessThan(before.left);
    expect(after.top).toBeLessThan(before.top);
    expectWithinViewport(after, size, resized);
  });

  it('starts oversized natural measurements at the near edge until the caller constrains size', () => {
    const viewport = { left: 40, top: 90, width: 320, height: 240 };
    expect(placeCanvasMenu({ x: 200, y: 180 }, { width: 500, height: 800 }, viewport))
      .toEqual({ left: 48, top: 98 });
  });
});

describe('placeCanvasSubmenu', () => {
  const size = { width: 300, height: 240 };

  it('prefers the right when both sides fit, with no hover gap', () => {
    const anchor = { left: 500, top: 100, width: 260, height: 48 };
    expect(placeCanvasSubmenu(anchor, size, desktop))
      .toEqual({ left: 760, top: 100, side: 'right', maxHeight: 884 });
  });

  it('flips a Codex submenu left when the parent is at the right edge', () => {
    const anchor = { left: 1172, top: 257, width: 260, height: 48 };
    const position = placeCanvasSubmenu(anchor, size, desktop);
    expect(position).toEqual({ left: 872, top: 257, side: 'left', maxHeight: 884 });
    expect(position.left + size.width).toBe(anchor.left);
    expectWithinViewport(position, size, desktop);
  });

  it('accepts an exact fit at the right viewport margin', () => {
    const anchor = { left: 872, top: 100, width: 260, height: 48 };
    expect(placeCanvasSubmenu(anchor, size, desktop))
      .toEqual({ left: 1132, top: 100, side: 'right', maxHeight: 884 });
    expect(placeCanvasSubmenu({ ...anchor, left: 873 }, size, desktop).side).toBe('left');
  });

  it('moves a tall app list upward while preserving the selected side', () => {
    const anchor = { left: 100, top: 800, width: 260, height: 48 };
    const tall = { width: 320, height: 720 };
    const position = placeCanvasSubmenu(anchor, tall, desktop);
    expect(position).toEqual({ left: 360, top: 172, side: 'right', maxHeight: 884 });
    expectWithinViewport(position, tall, desktop);
  });

  it.each([
    { anchorLeft: 20, expectedLeft: 20 },
    { anchorLeft: 160, expectedLeft: 32 },
  ])('uses vertical room without covering a narrow-screen trigger at x=$anchorLeft', ({ anchorLeft, expectedLeft }) => {
    const viewport = { left: 0, top: 0, width: 360, height: 480 };
    const narrowSize = { width: 320, height: 320 };
    const anchor = { left: anchorLeft, top: 300, width: 180, height: 48 };
    const position = placeCanvasSubmenu(anchor, narrowSize, viewport);
    expect(position).toEqual({ left: expectedLeft, top: 8, side: 'above', maxHeight: 292 });
    expect(position.top + position.maxHeight).toBe(anchor.top);
    expectWithinViewport(position, { ...narrowSize, height: position.maxHeight }, viewport);
  });

  it.each([
    { anchorTop: 100, expectedTop: 148, side: 'below', maxHeight: 644 },
    { anchorTop: 600, expectedTop: 360, side: 'above', maxHeight: 592 },
  ] as const)('opens $side when that vertical side fits the complete submenu', ({ anchorTop, expectedTop, side, maxHeight }) => {
    const viewport = { left: 0, top: 0, width: 360, height: 800 };
    const anchor = { left: 8, top: anchorTop, width: 344, height: 48 };
    expect(placeCanvasSubmenu(anchor, size, viewport))
      .toEqual({ left: 8, top: expectedTop, side, maxHeight });
  });

  it('caps a tall submenu to the roomier vertical side for scrolling', () => {
    const viewport = { left: 0, top: 0, width: 320, height: 480 };
    const anchor = { left: 8, top: 200, width: 304, height: 48 };
    expect(placeCanvasSubmenu(anchor, { width: 304, height: 400 }, viewport))
      .toEqual({ left: 8, top: 248, side: 'below', maxHeight: 224 });
  });

  it('accounts for visual viewport offsets when deciding which side fits', () => {
    const viewport = { left: 200, top: 300, width: 640, height: 400 };
    const anchor = { left: 600, top: 660, width: 220, height: 40 };
    const position = placeCanvasSubmenu(anchor, size, viewport);
    expect(position).toEqual({ left: 300, top: 452, side: 'left', maxHeight: 384 });
    expectWithinViewport(position, size, viewport);
  });

  it('can flip sides after a viewport resize', () => {
    const anchor = { left: 500, top: 100, width: 220, height: 48 };
    expect(placeCanvasSubmenu(anchor, size, desktop).side).toBe('right');
    const resized = { ...desktop, width: 800 };
    const position = placeCanvasSubmenu(anchor, size, resized);
    expect(position.side).toBe('left');
    expectWithinViewport(position, size, resized);
  });

  it('keeps viewport-constrained menus inside all edges across sizes, offsets and pointer positions', () => {
    const viewports: MenuViewport[] = [
      desktop,
      { left: 0, top: 0, width: 320, height: 240 },
      { left: 80, top: 120, width: 390, height: 520 },
    ];
    for (const viewport of viewports) {
      for (const naturalSize of [{ width: 256, height: 120 }, { width: 460, height: 1000 }]) {
        const constrainedSize = {
          width: Math.min(naturalSize.width, viewport.width - 2 * margin),
          height: Math.min(naturalSize.height, viewport.height - 2 * margin),
        };
        for (const fractionX of [0, 0.5, 1]) {
          for (const fractionY of [0, 0.5, 1]) {
            const point = { x: viewport.left + viewport.width * fractionX, y: viewport.top + viewport.height * fractionY };
            const parentSize = { width: Math.min(280, viewport.width - 2 * margin), height: 100 };
            const parent = placeCanvasMenu(point, parentSize, viewport);
            const anchor: MenuAnchor = { ...parent, width: parentSize.width, height: 48 };
            expectWithinViewport(placeCanvasMenu(point, constrainedSize, viewport), constrainedSize, viewport);
            const submenu = placeCanvasSubmenu(anchor, constrainedSize, viewport);
            const renderedSize = { ...constrainedSize, height: Math.min(constrainedSize.height, submenu.maxHeight) };
            expectWithinViewport(submenu, renderedSize, viewport);
            const separateFromTrigger = submenu.left + renderedSize.width <= anchor.left
              || submenu.left >= anchor.left + anchor.width
              || submenu.top + renderedSize.height <= anchor.top
              || submenu.top >= anchor.top + anchor.height;
            expect(separateFromTrigger).toBe(true);
          }
        }
      }
    }
  });
});
