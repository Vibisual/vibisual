import { describe, it, expect } from 'vitest';
import { MENU_VIEWPORT_MARGIN, type MenuSize, type MenuViewport } from '../BubbleMap/canvasMenuPlacement.js';
import { ANCHORED_MENU_GAP, placeAnchoredMenu } from './anchoredMenuPlacement.js';

const DESKTOP: MenuViewport = { left: 0, top: 0, width: 1920, height: 1080 };
const PHONE: MenuViewport = { left: 0, top: 0, width: 360, height: 740 };
const margin = MENU_VIEWPORT_MARGIN;

function expectInside(position: { left: number; top: number }, size: MenuSize, viewport: MenuViewport): void {
  expect(position.left).toBeGreaterThanOrEqual(viewport.left + margin);
  expect(position.top).toBeGreaterThanOrEqual(viewport.top + margin);
  expect(position.left + size.width).toBeLessThanOrEqual(viewport.left + viewport.width - margin);
  expect(position.top + size.height).toBeLessThanOrEqual(viewport.top + viewport.height - margin);
}

describe('placeAnchoredMenu', () => {
  it('자리가 넉넉한 데스크톱에서는 종전 right-0 + mt-1 과 같은 자리다', () => {
    // 헤더 [창과 버블] 배지 — 오른쪽 변을 트리거에 맞추고 트리거 아래 4px.
    const anchor = { left: 1500, top: 4, width: 60, height: 28 };
    const position = placeAnchoredMenu(anchor, { width: 288, height: 400 }, DESKTOP, 'end');
    expect(position).toEqual({ left: 1560 - 288, top: 32 + ANCHORED_MENU_GAP, side: 'below' });
  });

  it('start 는 종전 left-0 과 같다 — 간격 0 이면 트리거 바로 아래', () => {
    const anchor = { left: 120, top: 0, width: 180, height: 36 };
    expect(placeAnchoredMenu(anchor, { width: 288, height: 300 }, DESKTOP, 'start', 0))
      .toEqual({ left: 120, top: 36, side: 'below' });
  });

  it('폰에서 오른쪽 맞춤 목록이 왼쪽 밖으로 나가면 왼쪽 여백 안으로 당긴다', () => {
    const anchor = { left: 200, top: 40, width: 50, height: 28 };
    const size = { width: 288, height: 400 };
    const position = placeAnchoredMenu(anchor, size, PHONE, 'end');
    expect(position.left).toBe(margin);
    expect(position.top).toBe(68 + ANCHORED_MENU_GAP);
    expectInside(position, size, PHONE);
  });

  it('폰에서 왼쪽 맞춤 목록이 오른쪽 밖으로 나가면 오른쪽 여백 안으로 당긴다', () => {
    const anchor = { left: 120, top: 0, width: 150, height: 36 };
    const size = { width: 288, height: 300 };
    const position = placeAnchoredMenu(anchor, size, PHONE, 'start', 0);
    expect(position.left).toBe(PHONE.width - margin - size.width);
    expectInside(position, size, PHONE);
  });

  it('아래 자리가 모자라면 트리거 위로 뒤집는다', () => {
    // 지휘통제실 목록 맨 아래 카드의 [더보기].
    const anchor = { left: 300, top: 700, width: 24, height: 24 };
    const size = { width: 192, height: 140 };
    const viewport = { left: 0, top: 0, width: 1280, height: 800 };
    const position = placeAnchoredMenu(anchor, size, viewport, 'end');
    expect(position).toEqual({ left: 324 - 192, top: 700 - ANCHORED_MENU_GAP - 140, side: 'above' });
  });

  it('위아래 둘 다 모자라면 넓은 쪽을 쓰고 화면 안에 넣는다', () => {
    const anchor = { left: 100, top: 300, width: 24, height: 24 };
    const size = { width: 200, height: 480 };
    const viewport = { left: 0, top: 0, width: 800, height: 500 };
    const position = placeAnchoredMenu(anchor, size, viewport, 'end');
    expect(position.side).toBe('above');
    expectInside(position, size, viewport);
  });

  it('center 는 트리거 가운데에 맞추고, 가장자리에서는 여백 안으로 당긴다', () => {
    const size = { width: 300, height: 180 };
    expect(placeAnchoredMenu({ left: 600, top: 100, width: 40, height: 20 }, size, DESKTOP, 'center', 6))
      .toEqual({ left: 620 - 150, top: 126, side: 'below' });
    const nearRight = placeAnchoredMenu({ left: 340, top: 100, width: 16, height: 16 }, size, PHONE, 'center', 6);
    expect(nearRight.left).toBe(PHONE.width - margin - size.width);
    expectInside(nearRight, size, PHONE);
  });

  it('핀치 확대로 보이는 칸이 옮겨 갔으면 그 칸을 기준으로 당긴다', () => {
    const viewport = { left: 160, top: 240, width: 320, height: 400 };
    const size = { width: 240, height: 200 };
    const position = placeAnchoredMenu({ left: 170, top: 250, width: 30, height: 20 }, size, viewport, 'end');
    expectInside(position, size, viewport);
  });
});
