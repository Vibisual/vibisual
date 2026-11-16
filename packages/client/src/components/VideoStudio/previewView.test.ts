import { describe, expect, it } from 'vitest';

import { PREVIEW_ZOOM, actualFrame, clampFrame, fitFrame, panFrame, wheelFactor, zoomFrame, zoomPercent } from './previewView.js';

const SIZE = { width: 1920, height: 1080 };
const BOX = { w: 960, h: 600 };

describe('미리보기 자유 보기 계산 (§5.13 37-24 (F))', () => {
  it('맞춤은 비율을 지켜 가운데 선다', () => {
    expect(fitFrame(BOX, SIZE)).toEqual({ left: 0, top: 30, scale: 0.5 });
    expect(fitFrame({ w: 0, h: 0 }, SIZE).scale).toBe(0);
  });

  it('100% 는 문서 픽셀 그대로 가운데 선다(칸보다 크면 밖으로 나간다)', () => {
    expect(actualFrame(BOX, SIZE)).toEqual({ left: -480, top: -240, scale: 1 });
    expect(actualFrame({ w: 2000, h: 1200 }, SIZE)).toEqual({ left: 40, top: 60, scale: 1 });
  });

  it('휠은 포인터 아래의 문서 점을 그 자리에 둔 채 키운다', () => {
    const from = fitFrame(BOX, SIZE);
    const px = 300;
    const py = 200;
    const docX = (px - from.left) / from.scale;
    const docY = (py - from.top) / from.scale;
    const next = zoomFrame(from, px, py, 1.5, SIZE, BOX);
    expect(next.scale).toBeCloseTo(0.75);
    expect(next.left + docX * next.scale).toBeCloseTo(px);
    expect(next.top + docY * next.scale).toBeCloseTo(py);
  });

  it('배율은 한계 안에 묶인다', () => {
    const from = fitFrame(BOX, SIZE);
    expect(zoomFrame(from, 0, 0, 1000, SIZE, BOX).scale).toBe(PREVIEW_ZOOM.max);
    expect(zoomFrame(from, 0, 0, 0.0001, SIZE, BOX).scale).toBe(PREVIEW_ZOOM.min);
    // 칸을 못 잰 판(배율 0)은 건드리지 않는다.
    const unmeasured = { left: 0, top: 0, scale: 0 };
    expect(zoomFrame(unmeasured, 0, 0, 2, SIZE, BOX)).toBe(unmeasured);
  });

  it('위로 굴리면 커지고, 줄 단위·집기 delta 를 같은 눈금으로 읽고, 한 번에 튀지 않는다', () => {
    expect(wheelFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0, false)).toBeLessThan(1);
    expect(wheelFactor(-100, 0, false) * wheelFactor(100, 0, false)).toBeCloseTo(1);
    expect(wheelFactor(-3, 1, false)).toBeCloseTo(wheelFactor(-3 * PREVIEW_ZOOM.linePx, 0, false));
    expect(wheelFactor(-10, 0, true)).toBeGreaterThan(wheelFactor(-10, 0, false));
    expect(wheelFactor(-100000, 0, false)).toBe(PREVIEW_ZOOM.stepMax);
    expect(wheelFactor(100000, 0, false)).toBe(PREVIEW_ZOOM.stepMin);
  });

  it('끌면 그만큼 옮기되 판이 칸 밖으로 다 나가지 않는다', () => {
    const from = fitFrame(BOX, SIZE);
    expect(panFrame(from, 40, -10, SIZE, BOX)).toEqual({ left: 40, top: 20, scale: 0.5 });
    const far = panFrame(from, 99999, 99999, SIZE, BOX);
    expect(far.left).toBe(BOX.w - PREVIEW_ZOOM.keepVisible);
    expect(far.top).toBe(BOX.h - PREVIEW_ZOOM.keepVisible);
    const back = panFrame(from, -99999, -99999, SIZE, BOX);
    expect(back.left).toBe(PREVIEW_ZOOM.keepVisible - SIZE.width * 0.5);
    expect(back.top).toBe(PREVIEW_ZOOM.keepVisible - SIZE.height * 0.5);
  });

  it('남길 폭보다 작은 판은 통째로 칸 안에 남는다', () => {
    const tiny = clampFrame({ left: -500, top: 9999, scale: 0.01 }, SIZE, BOX);
    expect(tiny.left).toBeCloseTo(0);
    expect(tiny.top).toBeCloseTo(BOX.h - SIZE.height * 0.01);
  });

  it('배율 표기', () => {
    expect(zoomPercent(0.666)).toBe('67%');
    expect(zoomPercent(1)).toBe('100%');
  });
});
