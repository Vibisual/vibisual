import { describe, expect, it } from 'vitest';

import { pinchSpan, pinchView, type PinchPoint, type PinchStart } from './imageViewerPinch.js';

/** §5.13 (R-9) — 핀치: 벌린 만큼 커지고, 시작 때 손가락 가운데 아래 점이 끝까지 그 아래 붙어 있다. */

const stage = { w: 400, h: 300 };
const limits = { min: 0.05, max: 16 };

/** 무대 좌표 P 에 보이는 그림 위의 점 — 그림 중심에서 떨어진 거리(그림 px). `VibimageViewer` 의 transform 과 같은 모형. */
function imagePointAt(at: PinchPoint, view: { scale: number; offset: PinchPoint }): PinchPoint {
  return { x: (at.x - stage.w / 2 - view.offset.x) / view.scale, y: (at.y - stage.h / 2 - view.offset.y) / view.scale };
}

function start(over: Partial<PinchStart> = {}): PinchStart {
  return { distance: 100, mid: { x: 300, y: 100 }, scale: 1, offset: { x: 0, y: 0 }, ...over };
}

describe('pinchSpan — 두 손가락의 거리와 가운데', () => {
  it('거리는 두 점 사이 직선, 가운데는 두 점의 평균', () => {
    expect(pinchSpan({ x: 0, y: 0 }, { x: 30, y: 40 })).toEqual({ distance: 50, mid: { x: 15, y: 20 } });
  });
});

describe('pinchView — 핀치 중의 배율과 자리', () => {
  it('손가락 사이가 두 배로 벌어지면 배율도 두 배', () => {
    expect(pinchView(start(), 200, { x: 300, y: 100 }, stage, limits).scale).toBe(2);
  });

  it('벌리는 동안 시작할 때 손가락 가운데 아래 있던 점이 그 자리에 남는다', () => {
    const begin = start({ scale: 0.5, offset: { x: -20, y: 10 } });
    const before = imagePointAt(begin.mid, begin);
    const view = pinchView(begin, 300, begin.mid, stage, limits);
    expect(view.scale).toBeCloseTo(1.5);
    const after = imagePointAt(begin.mid, view);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('거리를 그대로 둔 채 가운데를 옮기면 그만큼 끌린다(배율은 그대로)', () => {
    const view = pinchView(start({ offset: { x: 5, y: -5 } }), 100, { x: 340, y: 70 }, stage, limits);
    expect(view.scale).toBe(1);
    expect(view.offset).toEqual({ x: 45, y: -35 });
  });

  it('벌리며 끌어도 시작 때의 점은 지금 손가락 가운데에 붙어 있다', () => {
    const begin = start({ scale: 2, offset: { x: 30, y: -12 } });
    const before = imagePointAt(begin.mid, begin);
    const now = { x: 120, y: 220 };
    const view = pinchView(begin, 60, now, stage, limits);
    const after = imagePointAt(now, view);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('배율은 한계 안으로 묶이고, 묶여도 그 점은 손가락 가운데에 남는다', () => {
    const begin = start({ scale: 8 });
    const before = imagePointAt(begin.mid, begin);
    const view = pinchView(begin, 1000, begin.mid, stage, limits);
    expect(view.scale).toBe(limits.max);
    const after = imagePointAt(begin.mid, view);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(pinchView(start({ scale: 0.1 }), 1, begin.mid, stage, limits).scale).toBe(limits.min);
  });

  it('시작 거리가 0(두 손가락이 한 점)이면 배율은 그대로 두고 끌기만 따른다', () => {
    const view = pinchView(start({ distance: 0, scale: 1.25 }), 80, { x: 310, y: 100 }, stage, limits);
    expect(view.scale).toBe(1.25);
    expect(view.offset).toEqual({ x: 10, y: 0 });
  });
});
