import { describe, it, expect } from 'vitest';
import {
  WINDOW_PULL_OUT,
  centeredGeom,
  clampGeom,
  clampPosition,
  defaultFloatSize,
  edgeNudgeOffset,
  isCursorOutsideViewport,
  isCursorPinnedToViewportEdge,
  isWindowPulledFullyOut,
  overflowPastClampPosition,
  pullOutGhostDecision,
  resolveFloatingWindowConfig,
  windowStyle,
} from './floatingWindowGeom.js';

// §5.9 / §5.10 — 창 기하는 window 없이 검증한다(뷰포트를 인자로 받는 순수 함수).

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

// §5.13 (S-10) — 밖으로 빼는 동안의 **가상 창**. IDE 창(§5.5 #17-6 (H-6)(H-7)(H-17)(H-22))과 내부 앱
// 창이 같은 판정을 쓴다 — 켜는 이유·무장하는 이유가 창 종류마다 갈리면 같은 손짓이 다르게 보인다.
describe('가상 창 판정 — pullOutGhostDecision (S-10)', () => {
  const vp = { w: 1280, h: 800 };
  const base = { beyond: 0, fullyOut: false, cursor: { x: 640, y: 400 }, vp, edgeDwell: false };

  it('앱 안에서 평범하게 끌면 선이 없다', () => {
    expect(pullOutGhostDecision(base)).toEqual({ show: false, armed: false, outside: false });
  });

  it('놓을 수 있는 자리를 GHOST_ENTER_PX 넘게 넘어서야 선이 뜨고, GHOST_COMMIT_PX 부터 무장한다', () => {
    // 화면 끝에 창을 붙여 두는(파킹) 평범한 손짓에는 선이 번쩍이지 않는다.
    expect(pullOutGhostDecision({ ...base, beyond: WINDOW_PULL_OUT.GHOST_ENTER_PX }).show).toBe(false);
    expect(pullOutGhostDecision({ ...base, beyond: WINDOW_PULL_OUT.GHOST_ENTER_PX + 1 })).toMatchObject({ show: true, armed: false });
    expect(pullOutGhostDecision({ ...base, beyond: WINDOW_PULL_OUT.GHOST_COMMIT_PX })).toMatchObject({ show: true, armed: true });
  });

  it('커서가 앱 밖으로 나가는 순간(여유 0) 선이 뜨고 무장한다 — 잡은 지점과 무관하다', () => {
    expect(pullOutGhostDecision({ ...base, cursor: { x: vp.w + 1, y: 400 } })).toEqual({ show: true, armed: true, outside: true });
  });

  it('창을 완전히 빼내면 무장한다', () => {
    expect(pullOutGhostDecision({ ...base, fullyOut: true })).toMatchObject({ show: true, armed: true });
  });

  it('가장자리 버팀은 선을 먼저 띄우고, 끝까지 버텨야 무장한다', () => {
    expect(pullOutGhostDecision({ ...base, edgeDwell: true })).toMatchObject({ show: true, armed: false });
    expect(pullOutGhostDecision({ ...base, edgeDwell: true, edgeArmed: true })).toMatchObject({ show: true, armed: true });
  });

  it('한 번 밖을 밟은 판은 도로 들어와도 선이지만, 무장은 지금 자리가 정한다', () => {
    // 도로 들어와 놓는 손은 "여기 놓겠다"이지 "밖으로 빼겠다"가 아니다.
    expect(pullOutGhostDecision({ ...base, escaped: true })).toEqual({ show: true, armed: false, outside: false });
  });
});

describe('가상 창 보조 판정 (S-10)', () => {
  const vp = { w: 1280, h: 800 };
  const size = { w: 600, h: 400 };

  it('클램프 초과량은 놓을 수 있는 자리에서 더 간 만큼 — 두 축 중 큰 쪽, 한계 안이면 0', () => {
    const parkedX = vp.w - cfg.keepVisible.x;
    expect(overflowPastClampPosition({ x: parkedX, y: 100, ...size }, vp, cfg)).toBe(0);
    expect(overflowPastClampPosition({ x: parkedX + 30, y: 100, ...size }, vp, cfg)).toBe(30);
    expect(overflowPastClampPosition({ x: 100, y: -50, ...size }, vp, cfg)).toBe(50);
  });

  it('완전히 빼냈는가 — 한 픽셀이라도 겹치면 아니다', () => {
    expect(isWindowPulledFullyOut({ x: vp.w - 1, y: 0, ...size }, vp)).toBe(false);
    expect(isWindowPulledFullyOut({ x: vp.w, y: 0, ...size }, vp)).toBe(true);
    expect(isWindowPulledFullyOut({ x: -size.w, y: 0, ...size }, vp)).toBe(true);
    expect(isWindowPulledFullyOut({ x: 0, y: vp.h, ...size }, vp)).toBe(true);
  });

  it('가장자리 버팀의 밀어 내기는 막힌 그 변 밖으로만 — 가운데면 0', () => {
    const n = WINDOW_PULL_OUT.EDGE_NUDGE_PX;
    expect(edgeNudgeOffset({ x: vp.w - 1, y: 400 }, vp)).toEqual({ dx: n, dy: 0 });
    expect(edgeNudgeOffset({ x: 0, y: 400 }, vp)).toEqual({ dx: -n, dy: 0 });
    expect(edgeNudgeOffset({ x: 640, y: vp.h - 1 }, vp)).toEqual({ dx: 0, dy: n });
    expect(edgeNudgeOffset({ x: 640, y: 0 }, vp)).toEqual({ dx: 0, dy: -n });
    expect(edgeNudgeOffset({ x: 640, y: 400 }, vp)).toEqual({ dx: 0, dy: 0 });
  });
});
