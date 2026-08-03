import { describe, it, expect } from 'vitest';
import {
  centeredGeom,
  clampGeom,
  clampPosition,
  defaultFloatSize,
  resolveFloatingWindowConfig,
  windowStyle,
} from './floatingWindowGeom.js';

// §5.9 v3.34 / §5.10 v3.77 — 창 기하는 window 없이 검증한다(뷰포트를 인자로 받는 순수 함수).

const cfg = resolveFloatingWindowConfig();
const wide = { w: 1920, h: 1080 };

describe('defaultFloatSize', () => {
  it('넓은 화면에서는 비율이 아니라 상한을 쓴다', () => {
    expect(defaultFloatSize(wide, cfg)).toEqual({ w: 960, h: 640 });
  });

  it('좁은 화면에서는 하한을 지키되 뷰포트를 넘지 않는다', () => {
    const size = defaultFloatSize({ w: 700, h: 500 }, cfg);
    expect(size.w).toBe(420); // 700 × 0.6
    expect(size.h).toBeLessThanOrEqual(500 - cfg.headerH - cfg.viewportMargin);
  });

  it('뷰포트가 최소 크기보다 작아도 창이 화면보다 커지지 않는다', () => {
    const size = defaultFloatSize({ w: 300, h: 240 }, cfg);
    expect(size.w).toBeLessThanOrEqual(300 - cfg.viewportMargin);
    expect(size.h).toBeLessThanOrEqual(240 - cfg.headerH - cfg.viewportMargin);
  });
});

describe('clampPosition', () => {
  const size = { w: 800, h: 600 };

  it('왼쪽/위로 밀어도 최소 가시량을 남긴다', () => {
    expect(clampPosition(-5000, -5000, size, wide, cfg)).toEqual({ x: -size.w + cfg.keepVisible.x, y: 0 });
  });

  it('오른쪽/아래로 밀어도 창을 잃지 않는다', () => {
    expect(clampPosition(9999, 9999, size, wide, cfg)).toEqual({
      x: wide.w - cfg.keepVisible.x,
      y: wide.h - cfg.keepVisible.y,
    });
  });

  it('화면 안이면 그대로 둔다', () => {
    expect(clampPosition(120, 80, size, wide, cfg)).toEqual({ x: 120, y: 80 });
  });
});

describe('clampGeom', () => {
  it('뷰포트가 줄면 창 크기도 함께 줄여 화면 안으로 되돌린다', () => {
    const shrunk = clampGeom({ x: 1500, y: 900, w: 1200, h: 900 }, { w: 800, h: 600 }, cfg);
    expect(shrunk.w).toBeLessThanOrEqual(800 - cfg.viewportMargin);
    expect(shrunk.h).toBeLessThanOrEqual(600 - cfg.headerH - cfg.viewportMargin);
    expect(shrunk.x).toBeLessThanOrEqual(800 - cfg.keepVisible.x);
    expect(shrunk.y).toBeLessThanOrEqual(600 - cfg.keepVisible.y);
  });
});

describe('centeredGeom', () => {
  it('가운데에 놓고 계단식 오프셋만큼 밀어낸다', () => {
    const a = centeredGeom(wide, cfg, 0);
    const b = centeredGeom(wide, cfg, 32);
    expect(a.x).toBe(Math.round((wide.w - a.w) / 2));
    expect(b.x - a.x).toBe(32);
    expect(b.y - a.y).toBe(32);
  });

  it('앱 헤더 아래에서 시작한다', () => {
    expect(centeredGeom({ w: 1024, h: 300 }, cfg, 0).y).toBeGreaterThanOrEqual(0);
  });
});

describe('windowStyle', () => {
  const geom = { x: 100, y: 120, w: 800, h: 600 };

  it('floating 은 저장된 좌표 그대로', () => {
    expect(windowStyle(geom, 'floating', cfg)).toEqual({ left: 100, top: 120, width: 800, height: 600 });
  });

  it('maximized 는 앱 헤더 아래 전면', () => {
    expect(windowStyle(geom, 'maximized', cfg)).toEqual({ left: 0, top: cfg.headerH, right: 0, bottom: 0 });
  });

  it('minimized 는 폭을 유지한 채 셰이드 높이만 남긴다', () => {
    const shaded = resolveFloatingWindowConfig({ shadeH: 44 });
    expect(windowStyle(geom, 'minimized', shaded)).toEqual({ left: 100, top: 120, width: 800, height: 44 });
  });

  it('잠긴 전체화면은 mode 와 무관하게 전면', () => {
    expect(windowStyle(geom, 'floating', cfg, true)).toEqual({ left: 0, top: cfg.headerH, right: 0, bottom: 0 });
  });
});
