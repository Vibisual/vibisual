import { describe, it, expect } from 'vitest';
import {
  DETACHED_WINDOW,
  detachGhostFrame,
  detachedWindowPlacement,
} from '@vibisual/shared';

// shared 의 순수 기하는 server 테스트에서 검증한다(windowDragRegion.test.ts 선례).
//
// §5.4 #14-1 (H) — 탭을 떼어 내는 동안 커서에 매달리는 선은 **곧 설 별창 그 자체**다. 선의 크기·
// 잡은 지점(렌더러)과 별창의 크기·자리(main)가 어긋나면, 놓는 순간 창이 선과 다른 자리·크기로
// 튄다 — 고치려던 "손을 따라오지 않는 느낌"이 놓는 순간에 되살아난다. 창을 띄우지 않고 여기서 고정한다.

const BIG = { width: 1920, height: 1040 };

describe('detachGhostFrame — 선의 크기는 곧 설 별창의 크기다', () => {
  it('넉넉한 화면에서는 별창 기본 크기 그대로', () => {
    const f = detachGhostFrame({ grab: { x: 40, y: 18 }, avail: BIG });
    expect(f.width).toBe(DETACHED_WINDOW.defaultWidth);
    expect(f.height).toBe(DETACHED_WINDOW.defaultHeight);
  });

  it('작은 화면에서는 작업 영역 안으로 줄인다 — 넘친 선은 어디에 서는지 말하지 못한다', () => {
    const f = detachGhostFrame({ grab: { x: 40, y: 18 }, avail: { width: 1280, height: 680 } });
    // 가로는 1280 × 0.92 = 1177 이 기본 1100 보다 커서 그대로, 세로는 680 × 0.92 = 625 로 줄어든다.
    expect(f.width).toBe(1100);
    expect(f.height).toBe(Math.floor(680 * DETACHED_WINDOW.maxAvailRatio));
    expect(f.height).toBeLessThan(680);
  });

  it('아주 작은 화면이어도 별창 최소 크기보다 작아지지 않는다(창이 그보다 작게 설 수 없다)', () => {
    const f = detachGhostFrame({ grab: { x: 40, y: 18 }, avail: { width: 400, height: 300 } });
    expect(f.width).toBe(DETACHED_WINDOW.minWidth);
    expect(f.height).toBe(DETACHED_WINDOW.minHeight);
  });

  it('화면 크기를 모르면(없음·0·NaN) 기본 크기 그대로 — 지레짐작으로 줄이지 않는다', () => {
    for (const avail of [null, { width: 0, height: 0 }, { width: Number.NaN, height: Number.NaN }]) {
      const f = detachGhostFrame({ grab: { x: 40, y: 18 }, avail });
      expect(f.width).toBe(DETACHED_WINDOW.defaultWidth);
      expect(f.height).toBe(DETACHED_WINDOW.defaultHeight);
    }
  });
});

describe('detachGhostFrame — 잡은 지점은 손에 든 탭에서 이어 온다', () => {
  it('탭 이름이 선의 이름 자리로 이어지게 가로를 옮긴다', () => {
    const f = detachGhostFrame({ grab: { x: 40, y: 18 }, avail: BIG });
    expect(f.grabX).toBe(40 + DETACHED_WINDOW.labelAlignPx);
    expect(f.grabY).toBe(18);
  });

  it('옮기는 양은 두 그림의 이름 들여쓰기 차다 — 탭 px-2.5(10) 대 선 이름 띠(여백 10 + 점 8 + 틈 6)', () => {
    expect(DETACHED_WINDOW.labelAlignPx).toBe((10 + 8 + 6) - 10);
  });

  it('세로는 이름 띠 안으로 묶는다 — 띠 밖을 잡은 채로 서면 창 본문을 잡고 끄는 그림이 된다', () => {
    const bar = DETACHED_WINDOW.ghostBarHeight;
    const inset = DETACHED_WINDOW.grabBarInsetPx;
    expect(detachGhostFrame({ grab: { x: 40, y: 0 }, avail: BIG }).grabY).toBe(inset);
    expect(detachGhostFrame({ grab: { x: 40, y: 36 }, avail: BIG }).grabY).toBe(bar - inset);
    expect(detachGhostFrame({ grab: { x: 40, y: 500 }, avail: BIG }).grabY).toBe(bar - inset);
  });

  it('가로는 선의 좌우 끝에 붙지 않는다(끝을 잡으면 선이 손에서 빠진 것처럼 보인다)', () => {
    const edge = DETACHED_WINDOW.grabEdgePx;
    expect(detachGhostFrame({ grab: { x: -50, y: 18 }, avail: BIG }).grabX).toBe(edge);
    const wide = detachGhostFrame({ grab: { x: 5000, y: 18 }, avail: BIG });
    expect(wide.grabX).toBe(wide.width - edge);
  });

  it('잡은 지점이 숫자가 아니면 이름 띠 왼쪽 위로 — 선 기하가 NaN 으로 무너지지 않는다', () => {
    const f = detachGhostFrame({ grab: { x: Number.NaN, y: Number.NaN }, avail: BIG });
    expect(Number.isFinite(f.grabX)).toBe(true);
    expect(Number.isFinite(f.grabY)).toBe(true);
    expect(f.grabY).toBe(DETACHED_WINDOW.ghostBarHeight / 2);
  });
});

describe('detachedWindowPlacement — 별창은 멈춘 선의 자리·크기 그대로 선다', () => {
  it('선이 있으면 그 자리·크기 그대로(정수로)', () => {
    expect(detachedWindowPlacement({
      ghost: { x: 2310.4, y: 140.6, width: 1100, height: 720 },
      cursor: { x: 0, y: 0 },
    })).toEqual({ x: 2310, y: 141, width: 1100, height: 720 });
  });

  it('놓은 자리 그대로 — 손을 뗀 커서에서 잡은 지점을 뺀 선의 자리가 곧 창의 자리다', () => {
    const f = detachGhostFrame({ grab: { x: 52, y: 20 }, avail: BIG });
    const cursor = { x: 2800, y: 400 };
    const ghost = { x: cursor.x - f.grabX, y: cursor.y - f.grabY, width: f.width, height: f.height };
    expect(detachedWindowPlacement({ ghost, cursor })).toEqual(ghost);
  });

  it('왼쪽·위 모니터(음수 좌표)에서도 그 자리 그대로', () => {
    expect(detachedWindowPlacement({
      ghost: { x: -1800, y: -300, width: 1100, height: 720 },
    })).toEqual({ x: -1800, y: -300, width: 1100, height: 720 });
  });

  it('선이 최소보다 작다고 해도 창은 최소 크기 아래로 서지 않는다', () => {
    const p = detachedWindowPlacement({ ghost: { x: 10, y: 10, width: 100, height: 50 } });
    expect(p.width).toBe(DETACHED_WINDOW.minWidth);
    expect(p.height).toBe(DETACHED_WINDOW.minHeight);
  });

  it('선이 없으면 종전 자리 — 커서가 머리줄 가운데·위에서 18px', () => {
    expect(detachedWindowPlacement({ ghost: null, cursor: { x: 1000, y: 300 } })).toEqual({
      width: DETACHED_WINDOW.defaultWidth,
      height: DETACHED_WINDOW.defaultHeight,
      x: 1000 - DETACHED_WINDOW.defaultWidth / 2,
      y: 300 - DETACHED_WINDOW.cursorGrabY,
    });
  });

  it('선의 값이 깨져 있으면 선을 믿지 않고 커서 자리로 간다', () => {
    const p = detachedWindowPlacement({
      ghost: { x: Number.NaN, y: 10, width: 1100, height: 720 },
      cursor: { x: 1000, y: 300 },
    });
    expect(p.x).toBe(1000 - DETACHED_WINDOW.defaultWidth / 2);
  });

  it('선도 커서도 없으면 크기만 준다 — 자리는 OS 가 정한다', () => {
    const p = detachedWindowPlacement({ ghost: null });
    expect(p).toEqual({ width: DETACHED_WINDOW.defaultWidth, height: DETACHED_WINDOW.defaultHeight });
    expect('x' in p).toBe(false);
  });
});
