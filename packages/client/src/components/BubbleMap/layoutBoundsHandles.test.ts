import { describe, it, expect } from 'vitest';
import { LAYOUT_BOUNDS_DEFAULT } from '@vibisual/shared';
import {
  BOUNDS_CORNER_HIT,
  BOUNDS_EDGE_HIT,
  BOUNDS_HANDLES,
  BOUNDS_MAX_HALF,
  BOUNDS_MIN_HALF,
  handleCursor,
  handleRect,
  resizeBounds,
  type BoundsHandle,
} from './layoutBoundsHandles.js';

/**
 * SSOT §5.4 #42 — 캔버스 배치 상자는 변과 모서리 어디서든 끌어 크기를 바꾼다.
 * 종전에는 변 띠 넷만 있어 모서리에서 두 띠가 겹치고 바깥 한 칸이 비었다 — 대각선으로 잡을 자리가 없었다.
 */

/** 그 점을 받는 손잡이들 — 칸은 [left, left+width) × [top, top+height). */
function hitsAt(x: number, y: number, w: number, h: number): BoundsHandle[] {
  return BOUNDS_HANDLES.filter((handle) => {
    const r = handleRect(handle, w, h);
    return x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height;
  });
}

const W = LAYOUT_BOUNDS_DEFAULT.hw * 2;
const H = LAYOUT_BOUNDS_DEFAULT.hh * 2;
const HALF_EDGE = BOUNDS_EDGE_HIT / 2;

describe('resizeBounds — 모서리는 가로·세로를 함께, 변은 자기 축만', () => {
  const start = { hw: 1500, hh: 1100 };

  it('모서리를 바깥으로 끌면 두 축이 함께 커진다 (네 모서리 모두)', () => {
    expect(resizeBounds('se', start, 100, 60)).toEqual({ hw: 1600, hh: 1160 });
    expect(resizeBounds('nw', start, -100, -60)).toEqual({ hw: 1600, hh: 1160 });
    expect(resizeBounds('ne', start, 100, -60)).toEqual({ hw: 1600, hh: 1160 });
    expect(resizeBounds('sw', start, -100, 60)).toEqual({ hw: 1600, hh: 1160 });
  });

  it('모서리를 안으로 끌면 두 축이 함께 준다', () => {
    expect(resizeBounds('se', start, -100, -60)).toEqual({ hw: 1400, hh: 1040 });
    expect(resizeBounds('nw', start, 100, 60)).toEqual({ hw: 1400, hh: 1040 });
  });

  it('변은 대각선으로 끌어도 자기 축만 바꾼다', () => {
    expect(resizeBounds('e', start, 100, 60)).toEqual({ hw: 1600, hh: 1100 });
    expect(resizeBounds('w', start, -100, 60)).toEqual({ hw: 1600, hh: 1100 });
    expect(resizeBounds('s', start, 100, 60)).toEqual({ hw: 1500, hh: 1160 });
    expect(resizeBounds('n', start, 100, -60)).toEqual({ hw: 1500, hh: 1160 });
  });

  it('상·하한에서 두 축이 따로 멈춘다', () => {
    expect(resizeBounds('se', start, -1e6, -1e6)).toEqual({ hw: BOUNDS_MIN_HALF, hh: BOUNDS_MIN_HALF });
    expect(resizeBounds('nw', start, -1e6, -1e6)).toEqual({ hw: BOUNDS_MAX_HALF, hh: BOUNDS_MAX_HALF });
    expect(resizeBounds('ne', start, 1e6, 0)).toEqual({ hw: BOUNDS_MAX_HALF, hh: 1100 });
  });
});

describe('handleRect — 테두리 둘레의 어느 점이든 손잡이 하나만 받는다', () => {
  it('꼭짓점 둘레는 통째로 그 모서리의 것이다 (종전에 비던 바깥 한 칸 포함)', () => {
    const corners: Array<[BoundsHandle, number, number]> = [
      ['nw', 0, 0],
      ['ne', W, 0],
      ['sw', 0, H],
      ['se', W, H],
    ];
    const bad: string[] = [];
    for (const [handle, cx, cy] of corners) {
      for (let dx = -HALF_EDGE; dx < HALF_EDGE; dx++) {
        for (let dy = -HALF_EDGE; dy < HALF_EDGE; dy++) {
          const hits = hitsAt(cx + dx, cy + dy, W, H);
          if (hits.length !== 1 || hits[0] !== handle) bad.push(`${handle} (${dx},${dy}) → [${hits.join(',')}]`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('변 띠 전체에 빈칸도 겹침도 없다 — 기본 크기와 최소 크기', () => {
    for (const [w, h] of [[W, H], [BOUNDS_MIN_HALF * 2, BOUNDS_MIN_HALF * 2]] as const) {
      const bad: string[] = [];
      for (let off = -HALF_EDGE; off < HALF_EDGE; off++) {
        for (let x = -HALF_EDGE; x < w + HALF_EDGE; x += 3) {
          for (const y of [off, h + off]) {
            const n = hitsAt(x, y, w, h).length;
            if (n !== 1) bad.push(`(${x},${y}) ${n}`);
          }
        }
        for (let y = -HALF_EDGE; y < h + HALF_EDGE; y += 3) {
          for (const x of [off, w + off]) {
            const n = hitsAt(x, y, w, h).length;
            if (n !== 1) bad.push(`(${x},${y}) ${n}`);
          }
        }
      }
      expect(bad).toEqual([]);
    }
  });

  it('변 가운데는 그 변이, 모서리 칸 바로 옆은 아직 모서리다', () => {
    expect(hitsAt(W / 2, 0, W, H)).toEqual(['n']);
    expect(hitsAt(W / 2, H, W, H)).toEqual(['s']);
    expect(hitsAt(0, H / 2, W, H)).toEqual(['w']);
    expect(hitsAt(W, H / 2, W, H)).toEqual(['e']);
    expect(hitsAt(BOUNDS_CORNER_HIT / 2 - 1, 0, W, H)).toEqual(['nw']);
    expect(hitsAt(BOUNDS_CORNER_HIT / 2, 0, W, H)).toEqual(['n']);
  });

  it('상자 안쪽과 바깥 먼 곳은 클릭이 지나간다', () => {
    expect(hitsAt(W / 2, H / 2, W, H)).toEqual([]);
    expect(hitsAt(BOUNDS_EDGE_HIT, BOUNDS_EDGE_HIT, W, H)).toEqual([]);
    expect(hitsAt(-BOUNDS_CORNER_HIT, -BOUNDS_CORNER_HIT, W, H)).toEqual([]);
  });
});

describe('handleCursor', () => {
  it('모서리는 대각선, 변은 가로·세로 커서', () => {
    expect(handleCursor('nw')).toBe('nwse-resize');
    expect(handleCursor('se')).toBe('nwse-resize');
    expect(handleCursor('ne')).toBe('nesw-resize');
    expect(handleCursor('sw')).toBe('nesw-resize');
    expect(handleCursor('n')).toBe('ns-resize');
    expect(handleCursor('s')).toBe('ns-resize');
    expect(handleCursor('w')).toBe('ew-resize');
    expect(handleCursor('e')).toBe('ew-resize');
  });
});
