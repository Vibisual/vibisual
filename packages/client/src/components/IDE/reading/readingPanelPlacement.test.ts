import { describe, expect, it } from 'vitest';
import {
  placeReadingPanel,
  READING_PANEL_COMPACT_BELOW,
  READING_PANEL_WIDTH,
  sameReadingPanelPlacement,
  visibleBounds,
} from './readingPanelPlacement.js';

/** 상단 바 버튼 칸(24px 정사각, 제목줄 h-10 가운데). */
const button = (left: number, top = 8): { left: number; top: number; right: number; bottom: number } =>
  ({ left, top, right: left + 24, bottom: top + 24 });

/** 패널이 경계 안(여백 8px 포함)에 다 들어오는가 — 뷰포트 좌표로 되돌려 본다. */
function panelEdges(anchorLeft: number, p: { left: number; width: number }): { left: number; right: number } {
  return { left: anchorLeft + p.left, right: anchorLeft + p.left + p.width };
}

describe('placeReadingPanel — 가로 자리·폭', () => {
  it('넓은 창에서는 종전처럼 320px 폭으로 버튼 오른쪽 변에 맞춘다', () => {
    const anchor = button(1500);
    const p = placeReadingPanel(anchor, { left: 0, top: 0, right: 1920, bottom: 1080 });
    expect(p.width).toBe(READING_PANEL_WIDTH);
    expect(panelEdges(anchor.left, p).right).toBe(anchor.right);
  });

  it('떼어 낸 좁은 창: 버튼 오른쪽에 붙이면 왼쪽이 잘리는 자리면 창 안으로 밀어 넣는다', () => {
    // 떼어 낸 창 480px — [읽기] 오른쪽에 새로고침·설정·전체화면·닫기가 있어 버튼이 가운데쯤이다.
    const anchor = button(200);
    const p = placeReadingPanel(anchor, { left: 0, top: 0, right: 480, bottom: 600 });
    const edges = panelEdges(anchor.left, p);
    expect(p.width).toBe(READING_PANEL_WIDTH);
    expect(edges.left).toBe(8);
    expect(edges.right).toBeLessThanOrEqual(480 - 8);
  });

  it('창이 패널보다 좁으면 폭을 창에 맞춰 줄인다(여백 8px 씩)', () => {
    const anchor = button(200);
    const p = placeReadingPanel(anchor, { left: 0, top: 0, right: 300, bottom: 600 });
    expect(p.width).toBe(300 - 16);
    expect(panelEdges(anchor.left, p)).toEqual({ left: 8, right: 292 });
  });

  it('창이 화면 가운데 떠 있으면 뷰포트가 아니라 그 창의 왼쪽 변을 넘지 않는다', () => {
    const anchor = button(640);
    const p = placeReadingPanel(anchor, { left: 500, top: 100, right: 980, bottom: 700 });
    expect(panelEdges(anchor.left, p).left).toBe(508);
  });

  it('버튼이 창 오른쪽 가장자리에 붙어 있으면 오른쪽 변도 창 안에 둔다', () => {
    const anchor = button(990);
    const p = placeReadingPanel(anchor, { left: 0, top: 0, right: 1000, bottom: 800 });
    expect(panelEdges(anchor.left, p).right).toBe(992);
  });

  it('창이 여백보다도 좁아도 폭·자리가 음수·NaN 이 되지 않는다', () => {
    const p = placeReadingPanel(button(2), { left: 0, top: 0, right: 10, bottom: 100 });
    expect(p.width).toBe(0);
    expect(Number.isFinite(p.left)).toBe(true);
  });
});

describe('placeReadingPanel — 높이', () => {
  it('최대 높이는 버튼 아래(간격 4px)부터 창 아래 변까지에서 여백을 뺀 값이다', () => {
    const p = placeReadingPanel(button(1500, 8), { left: 0, top: 0, right: 1920, bottom: 1000 });
    expect(p.maxHeight).toBe(1000 - 8 - (32 + 4));
    expect(p.compact).toBe(false);
  });

  it('창 최소 높이(320px)에서는 안내·근거 문단까지 스크롤 안으로 넣는다', () => {
    const p = placeReadingPanel(button(200, 8), { left: 0, top: 0, right: 480, bottom: 320 });
    expect(p.maxHeight).toBeLessThan(READING_PANEL_COMPACT_BELOW);
    expect(p.compact).toBe(true);
  });

  it('창 아래가 버튼보다 위로 잘려 있어도 음수 높이를 내지 않는다', () => {
    const p = placeReadingPanel(button(200, 8), { left: 0, top: 0, right: 480, bottom: 20 });
    expect(p.maxHeight).toBe(0);
  });
});

describe('visibleBounds', () => {
  const viewport = { w: 1280, h: 800 };

  it('IDE 창을 못 찾으면 뷰포트 전체가 경계다', () => {
    expect(visibleBounds(null, viewport)).toEqual({ left: 0, top: 0, right: 1280, bottom: 800 });
  });

  it('화면 밖으로 반쯤 밀려난 떠 있는 창은 보이는 부분만 경계로 삼는다', () => {
    expect(visibleBounds({ left: -200, top: 600, right: 400, bottom: 1100 }, viewport))
      .toEqual({ left: 0, top: 600, right: 400, bottom: 800 });
  });

  it('창이 통째로 화면 밖이어도 뒤집힌 사각형을 내지 않는다', () => {
    const b = visibleBounds({ left: 1400, top: 900, right: 1900, bottom: 1300 }, viewport);
    expect(b.right).toBeGreaterThanOrEqual(b.left);
    expect(b.bottom).toBeGreaterThanOrEqual(b.top);
  });
});

describe('sameReadingPanelPlacement', () => {
  it('값이 같으면 같은 자리로 본다(창 크기 이벤트마다 다시 그리지 않게)', () => {
    const p = placeReadingPanel(button(200), { left: 0, top: 0, right: 480, bottom: 600 });
    expect(sameReadingPanelPlacement(p, { ...p })).toBe(true);
    expect(sameReadingPanelPlacement(null, p)).toBe(false);
    expect(sameReadingPanelPlacement(p, { ...p, maxHeight: p.maxHeight - 1 })).toBe(false);
  });
});
