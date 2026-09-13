import { describe, it, expect } from 'vitest';
import {
  placeHoverTooltip,
  TOOLTIP_EDGE_MARGIN,
  TOOLTIP_GAP,
  type TooltipAnchor,
} from './hoverTooltipPlacement.js';

const VIEWPORT = { width: 1280, height: 800 };

function anchorAt(left: number, top: number, width = 100, height = 18): TooltipAnchor {
  return { left, right: left + width, top, bottom: top + height, width };
}

describe('placeHoverTooltip', () => {
  it('화면 한가운데 라벨은 아래 가운데에 놓는다', () => {
    const a = anchorAt(600, 400);
    const p = placeHoverTooltip(a, { width: 200, height: 40 }, VIEWPORT);
    expect(p.left).toBe(600 + 50 - 100);
    expect(p.top).toBe(a.bottom + TOOLTIP_GAP);
    expect(p.flipped).toBe(false);
  });

  it('사이드바처럼 왼쪽 끝 라벨은 왼쪽 여백으로 당긴다', () => {
    // 좁은 사이드바(w-52) 안 라벨 — 가운데 정렬만 하면 left 가 음수가 된다.
    const p = placeHoverTooltip(anchorAt(12, 300, 160), { width: 340, height: 44 }, VIEWPORT);
    expect(p.left).toBe(TOOLTIP_EDGE_MARGIN);
  });

  it('오른쪽 끝 라벨은 오른쪽 여백 안으로 당긴다', () => {
    const p = placeHoverTooltip(anchorAt(1200, 300, 70), { width: 320, height: 40 }, VIEWPORT);
    expect(p.left).toBe(VIEWPORT.width - 320 - TOOLTIP_EDGE_MARGIN);
    expect(p.left + 320 + TOOLTIP_EDGE_MARGIN).toBeLessThanOrEqual(VIEWPORT.width);
  });

  it('목록 맨 아래 행은 라벨 위로 뒤집는다', () => {
    const a = anchorAt(300, 770);
    const p = placeHoverTooltip(a, { width: 200, height: 60 }, VIEWPORT);
    expect(p.flipped).toBe(true);
    expect(p.top).toBe(a.top - TOOLTIP_GAP - 60);
  });

  it('위로 뒤집어도 안 들어가면 아래에 그대로 둔다', () => {
    // 박스가 화면보다 높은 극단 — 위로 뒤집으면 상단이 잘려 라벨 첫 줄조차 안 보인다.
    const a = anchorAt(300, 700);
    const p = placeHoverTooltip(a, { width: 200, height: 780 }, VIEWPORT);
    expect(p.flipped).toBe(false);
    expect(p.top).toBe(a.bottom + TOOLTIP_GAP);
  });

  it('박스가 화면보다 넓어도 left 는 여백 아래로 내려가지 않는다', () => {
    const p = placeHoverTooltip(anchorAt(400, 200), { width: 1400, height: 40 }, VIEWPORT);
    expect(p.left).toBe(TOOLTIP_EDGE_MARGIN);
  });

  it('좁은 화면(폰)에서도 좌우 여백을 지킨다', () => {
    const phone = { width: 390, height: 844 };
    const p = placeHoverTooltip(anchorAt(330, 100, 50), { width: 300, height: 40 }, phone);
    expect(p.left).toBeGreaterThanOrEqual(TOOLTIP_EDGE_MARGIN);
    expect(p.left + 300).toBeLessThanOrEqual(phone.width - TOOLTIP_EDGE_MARGIN);
  });
});
