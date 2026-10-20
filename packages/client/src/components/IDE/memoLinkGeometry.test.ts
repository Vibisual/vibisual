import { describe, expect, it } from 'vitest';
import { visibleMemoLinkAnchor } from './memoLinkGeometry.js';

const viewport = { left: 20, right: 220, top: 100, bottom: 180 };

describe('visibleMemoLinkAnchor', () => {
  it('첫 줄을 위로 스크롤해도 화면에 남은 다음 줄에 상자를 붙인다', () => {
    expect(visibleMemoLinkAnchor([
      { left: 30, right: 120, top: 60, bottom: 80 },
      { left: 30, right: 200, top: 110, bottom: 130 },
      { left: 30, right: 100, top: 130, bottom: 150 },
    ], viewport)).toEqual({ left: 30, top: 110, bottom: 130 });
  });

  it('일부만 보이는 줄은 입력칸의 보이는 부분에 붙인다', () => {
    expect(visibleMemoLinkAnchor([
      { left: 10, right: 100, top: 90, bottom: 110 },
    ], viewport)).toEqual({ left: 20, top: 100, bottom: 110 });
  });

  it('경계에만 닿거나 전부 가려진 줄에는 상자를 띄우지 않는다', () => {
    expect(visibleMemoLinkAnchor([
      { left: 30, right: 120, top: 80, bottom: 100 },
      { left: 30, right: 120, top: 180, bottom: 200 },
      { left: 220, right: 250, top: 120, bottom: 140 },
    ], viewport)).toBeNull();
    expect(visibleMemoLinkAnchor([], viewport)).toBeNull();
  });
});
