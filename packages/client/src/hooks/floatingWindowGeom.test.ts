import { describe, it, expect } from 'vitest';
import {
  WINDOW_PULL_OUT,
  centeredGeom,
  clampGeom,
  clampPosition,
  defaultFloatSize,
  isCursorOutsideViewport,
  isCursorPinnedToViewportEdge,
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

// §5.13 (S-3) — 창을 앱 밖으로 끌어내는 손짓. IDE 창(§5.5 #17-6)과 내부 앱 창이 **같은 기준**을
// 쓰는지가 여기서 지켜진다(기준이 두 벌이면 창 종류마다 다른 자리에서 반응한다).
describe('끌어내기 판정 — 커서가 앱 밖으로', () => {
  const vp = { w: 1280, h: 800 };

  it('창 안에서는 아무리 가장자리에 붙어도 밖이 아니다', () => {
    expect(isCursorOutsideViewport({ x: 0, y: 0 }, vp)).toBe(false);
    expect(isCursorOutsideViewport({ x: 1279, y: 799 }, vp)).toBe(false);
  });

  it('여유(MARGIN)만큼 더 나가야 밖으로 친다 — 경계에 걸친 손은 걸리지 않는다', () => {
    expect(isCursorOutsideViewport({ x: vp.w + WINDOW_PULL_OUT.MARGIN, y: 400 }, vp)).toBe(false);
    expect(isCursorOutsideViewport({ x: vp.w + WINDOW_PULL_OUT.MARGIN + 1, y: 400 }, vp)).toBe(true);
    expect(isCursorOutsideViewport({ x: 400, y: -WINDOW_PULL_OUT.MARGIN - 1 }, vp)).toBe(true);
  });
});

describe('끌어내기 판정 — 화면 끝에 막힌 손', () => {
  const vp = { w: 1280, h: 800 };

  it('가운데에서는 걸리지 않는다', () => {
    expect(isCursorPinnedToViewportEdge({ x: 640, y: 400 }, vp)).toBe(false);
  });

  it('오른쪽·아래 끝은 w-1 / h-1 이 최대값이라 그 자리도 띠 안이다', () => {
    // 이 -1 이 없으면 단일 모니터 최대화 사용자는 끝까지 밀어도 영영 띠에 들어오지 못한다.
    expect(isCursorPinnedToViewportEdge({ x: vp.w - 1, y: 400 }, vp)).toBe(true);
    expect(isCursorPinnedToViewportEdge({ x: 640, y: vp.h - 1 }, vp)).toBe(true);
  });

  it('왼쪽·위 끝도 같은 띠', () => {
    expect(isCursorPinnedToViewportEdge({ x: 0, y: 400 }, vp)).toBe(true);
    expect(isCursorPinnedToViewportEdge({ x: 640, y: 0 }, vp)).toBe(true);
  });

  it('띠 바로 안쪽은 아직 아니다', () => {
    const inside = WINDOW_PULL_OUT.EDGE_PX + 1;
    expect(isCursorPinnedToViewportEdge({ x: inside, y: 400 }, vp)).toBe(false);
  });
});
