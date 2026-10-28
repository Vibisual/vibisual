// §5.9 / §5.10 — 앱 안 IDE식 떠 있는 창의 순수 기하 계산.
// 떠 있는 창들이 같은 거동을 쓰므로 좌표 계산을 window 바인딩과 분리한 순수 함수로 모아 단위 시험한다(captureWindowManager 선례).
// 뷰포트는 인자로 받는다(전역 window 참조 ❌ — 시험에서 값만 바꿔 넣는다).

/** 창 3상태 — 최소화는 "타이틀바만 남기는 셰이드"로, 닫기와 다르다(창은 그 자리에 남는다). */
export type FloatingWindowMode = 'floating' | 'maximized' | 'minimized';

export interface FloatingWindowGeom {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FloatingWindowSnapshot {
  geom: FloatingWindowGeom;
  mode: FloatingWindowMode;
}

export interface Viewport {
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

/** 화면 밖으로 밀렸을 때 남겨둘 가시량(가로/세로). */
export interface KeepVisible {
  x: number;
  y: number;
}

/** 창 거동 기본값 — 모든 수치는 여기 한 곳(매직넘버 산개 ❌). */
export const FLOATING_WINDOW_DEFAULTS = {
  /** floating 기본 크기 = 뷰포트 × 비율. */
  SIZE_RATIO: { w: 0.6, h: 0.62 } as Size,
  /** 리사이즈 하한. */
  MIN_SIZE: { w: 320, h: 200 } as Size,
  /** floating 기본 크기 상한(넓은 모니터에서 창이 무한정 커지지 않게). */
  MAX_DEFAULT_SIZE: { w: 960, h: 640 } as Size,
  /** 앱 통합 타이틀바(Header h-9 = 36px) — 최대화는 그 아래부터. */
  HEADER_H: 36,
  /** 최소화(셰이드) 시 남길 높이 — 0 이면 그 창은 최소화를 쓰지 않는다. */
  SHADE_H: 0,
  /** 드래그로 인식하는 이동 임계(px) — 클릭과 구분. */
  DRAG_THRESHOLD: 4,
  /** 화면 밖으로 밀어도 남겨두는 최소 가시 폭/높이(px) — 창을 완전히 잃지 않게. */
  KEEP_VISIBLE: { x: 80, y: 40 } as KeepVisible,
  /** 뷰포트 대비 창 크기 여백(px). */
  VIEWPORT_MARGIN: 16,
} as const;

/**
 * §5.13 (S-3) — 창을 앱 밖으로 끌어내는 손짓의 문턱. IDE 창(§5.5 #17-6)과 내부 앱 창이 같은 손짓으로 나가므로 수치·판정을 여기 한 곳에 둔다
 * (두 벌이면 창 종류마다 다르게 반응한다 — IDE 의 `IDE_FLOAT` 도 이 값을 받아 쓴다).
 */
export const WINDOW_PULL_OUT = {
  /** 커서가 앱 창 밖으로 이만큼 더 나가야 "밖으로 꺼낸다"로 읽는다(px). */
  MARGIN: 24,
  /**
   * 화면 끝에 막혀 더 나갈 수 없을 때 "밖으로 밀고 있다"로 읽어 주는 안쪽 띠(px).
   * 단일 모니터에 앱이 최대화돼 있으면 커서가 뷰포트를 벗어나지 못해 `MARGIN` 에 영영 닿지 않는다.
   */
  EDGE_PX: 3,
  /** 그 띠에 이만큼 버티면 밖으로 나간 것과 **같이** 본다(ms). 스치기만 한 손은 걸리지 않게. */
  EDGE_DWELL_MS: 500,
  /**
   * §5.5 #17-6 (H-6)·§5.13 (S-10) 놓을 수 있는 자리를 이만큼 넘어서면 가상 창 윤곽선을 켠다(px).
   * 문턱은 뷰포트가 아니라 클램프 한계 기준 — 창을 화면 끝에 바짝 붙여 두는 것(최소 가시량만 남기고 파킹)은 정상 동작이라 뷰포트 기준이면 그때마다 선이 번쩍인다.
   */
  GHOST_ENTER_PX: 24,
  /**
   * (H-6) 손을 뗐을 때 **그대로 내보낼** 문턱(px, 놓을 수 있는 자리 기준). 켜는 문턱과 벌려 둔다 —
   * 화면 끝에 붙여 두려다 몇 십 픽셀 더 간 손이 창을 밖으로 던지면 안 된다.
   */
  GHOST_COMMIT_PX: 120,
  /** (H-6) 선이 **이미** 떠 있을 때의 가장자리 버팀(ms) — 밖으로 밀어낸 신호가 화면에 있는데 처음부터 다시 기다릴 이유가 없다. */
  EDGE_DWELL_ARMED_MS: 220,
  /** (H-6) 가장자리 버팀 중 선을 **먼저** 띄우는 시점(ms) — 기다리는 동안 무슨 일이 일어나는지 그림으로 보여 준다. */
  EDGE_GHOST_MS: 120,
  /** 버팀 시계의 결(ms) — 선이 변 밖으로 밀려 나가는 것이 끊겨 보이지 않을 만큼만 잦게. */
  EDGE_TICK_MS: 32,
  /**
   * (H-6) 버티는 동안 선을 그 변 밖으로 밀어 내는 거리(px). **완전히** 밀지 않는다 — 단일 모니터에
   * 앱이 최대화돼 있으면 밖에 보일 자리가 없어, 다 밀면 선이 화면에서 사라진다.
   */
  EDGE_NUDGE_PX: 72,
  /**
   * (H-22) main 의 선에 **아직 끌고 있다**고 알리는 주기(ms). 그 선은 클릭통과 창이라 main 이 수명
   * 그물(20초)로 스스로 걷는데, 판이 길면 그 그물이 끌고 있는 손 아래에서 걷힌다.
   */
  GHOST_KEEPALIVE_MS: 5_000,
} as const;

/**
 * 커서가 앱 창 밖으로 나갔는가 — 그 자리에서 손을 떼면 이 창은 독립 OS 창이 된다.
 * 여유(margin)가 0 이면 화면 가장자리까지 끌기만 해도 튀어나가고, 너무 크면 최대화된 단일 모니터에서 닿지 않는다(그 경우는 `isCursorPinnedToViewportEdge` 가 받는다).
 */
export function isCursorOutsideViewport(
  cursor: { x: number; y: number },
  vp: Viewport,
  margin: number = WINDOW_PULL_OUT.MARGIN,
): boolean {
  return cursor.x < -margin
    || cursor.y < -margin
    || cursor.x > vp.w + margin
    || cursor.y > vp.h + margin;
}

/**
 * 커서가 뷰포트 가장자리에 막혀 있는가(밖으로 더 밀 화면이 없는 자리). 무장은 부르는 쪽이 시간으로 가른다 — 스쳐 지나간 손이 창을 밖으로 던지면 안 된다.
 * 오른쪽·아래 경계에서 `-1` 을 빼는 까닭: `clientX/Y` 최대값은 `w-1`/`h-1` 이라 `w` 로 견주면 끝까지 밀어도 띠 안에 들지 않는다.
 */
export function isCursorPinnedToViewportEdge(
  cursor: { x: number; y: number },
  vp: Viewport,
  edge: number = WINDOW_PULL_OUT.EDGE_PX,
): boolean {
  return cursor.x <= edge
    || cursor.y <= edge
    || cursor.x >= vp.w - 1 - edge
    || cursor.y >= vp.h - 1 - edge;
}

/**
 * §5.5 #17-6 (H-6) 창이 앱 화면과 더는 겹치지 않는가 = 완전히 빼냈다.
 * 커서 기준 판정(밖·가장자리 버팀)만 두면 최대화된 단일 모니터에서는 기다리는 것 말고 길이 없다 — 창을 밖으로 밀어낸 것을 그대로 읽는 판정을 하나 더 둔다.
 */
export function isWindowPulledFullyOut(geom: FloatingWindowGeom, vp: Viewport): boolean {
  return geom.x >= vp.w
    || geom.y >= vp.h
    || geom.x + geom.w <= 0
    || geom.y + geom.h <= 0;
}

/** (H-7) 지금 윤곽선을 그려야 하는가 — 그리고 지금 손을 떼도 그대로 나가는가. */
export interface PullOutGhostDecision {
  show: boolean;
  armed: boolean;
  /**
   * (H-22) 이번 판정에서 커서가 **앱 밖**이었는가 — 부르는 쪽이 이 한 비트를 걸쇠로 물어 둔다.
   * 판정 자체는 기억을 갖지 않는다(같은 입력이면 같은 답이어야 테스트가 값을 고정할 수 있다).
   */
  outside: boolean;
}

/**
 * §5.5 #17-6 (H-7)(H-17)(H-22)·§5.13 (S-10) — 윤곽선을 켜는 이유와 무장하는 이유, 판정은 한 곳.
 * IDE 창과 내부 앱 창이 같은 손짓으로 나가므로 둘 다 이 함수를 부른다(§5.13 (S-3)). 창마다 다른 것은 "놓을 수 있는 자리"(클램프)라,
 * 초과량(`beyond`)과 완전 이탈(`fullyOut`)은 부르는 쪽이 자기 클램프로 재서 넘긴다.
 * - 켠다: 한 번 밖을 밟은 판 · 커서가 앱 밖 · 완전히 빼냄 · 클램프를 `GHOST_ENTER_PX` 넘김 · 가장자리 버팀 중.
 * - 무장: 커서가 앱 밖 · 완전히 빼냄 · 클램프를 `GHOST_COMMIT_PX` 넘김 · 가장자리 버팀 완료. 밖을 밟은 걸쇠(`escaped`)는 선만 세우고 무장하지 않는다
 *   — 도로 들어와 놓는 손은 "여기 놓겠다"다(선의 밝기가 그 차이를 미리 말한다).
 */
export function pullOutGhostDecision(input: {
  /** 가두지 않은 지금 자리가 놓을 수 있는 자리를 몇 px 넘어섰는가(두 축 중 큰 쪽, 0 이면 안 넘었다). */
  beyond: number;
  /** 가두지 않은 지금 자리가 앱 화면과 더는 겹치지 않는가. */
  fullyOut: boolean;
  /** 앱 창 안 좌표의 커서(`clientX/Y`) — 밖으로 나가면 음수·뷰포트 초과가 된다. */
  cursor: { x: number; y: number };
  vp: Viewport;
  /** 가장자리 버팀이 선을 띄울 만큼 진행됐는가(시간 판정은 부르는 쪽 몫). */
  edgeDwell: boolean;
  /** 가장자리 버팀을 끝까지 채웠는가 — 나가는 일은 손을 뗄 때만 일어나므로 이 순간은 선을 밝힐 뿐이다. */
  edgeArmed?: boolean;
  /** 이번 판에서 커서가 한 번이라도 앱 밖으로 나갔는가 — 나갔으면 도로 들어와도 선은 서 있는다. */
  escaped?: boolean;
}): PullOutGhostDecision {
  const outside = isCursorOutsideViewport(input.cursor, input.vp, 0);
  return {
    show: !!input.escaped || outside || input.fullyOut || input.beyond > WINDOW_PULL_OUT.GHOST_ENTER_PX || input.edgeDwell,
    armed: outside || input.fullyOut || input.beyond >= WINDOW_PULL_OUT.GHOST_COMMIT_PX || !!input.edgeArmed,
    outside,
  };
}

/**
 * (H-6) 가장자리 버팀 동안 선을 그 변 **밖으로** 밀어 낼 방향(px) — 어디로 빠지는지만 말하면 된다.
 * 커서가 그 변의 띠(`EDGE_PX`) 안에 없으면 0.
 */
export function edgeNudgeOffset(
  cursor: { x: number; y: number },
  vp: Viewport,
  nudge: number = WINDOW_PULL_OUT.EDGE_NUDGE_PX,
  edge: number = WINDOW_PULL_OUT.EDGE_PX,
): { dx: number; dy: number } {
  if (cursor.x >= vp.w - 1 - edge) return { dx: nudge, dy: 0 };
  if (cursor.x <= edge) return { dx: -nudge, dy: 0 };
  if (cursor.y >= vp.h - 1 - edge) return { dx: 0, dy: nudge };
  if (cursor.y <= edge) return { dx: 0, dy: -nudge };
  return { dx: 0, dy: 0 };
}

/** 훅·순수 함수가 함께 쓰는 확정 설정(기본값이 모두 채워진 형태). */
export interface FloatingWindowConfig {
  sizeRatio: Size;
  minSize: Size;
  maxDefaultSize: Size;
  headerH: number;
  shadeH: number;
  dragThreshold: number;
  keepVisible: KeepVisible;
  viewportMargin: number;
}

/** 부분 설정 + 기본값 → 확정 설정. */
export function resolveFloatingWindowConfig(partial: Partial<FloatingWindowConfig> = {}): FloatingWindowConfig {
  const d = FLOATING_WINDOW_DEFAULTS;
  return {
    sizeRatio: partial.sizeRatio ?? d.SIZE_RATIO,
    minSize: partial.minSize ?? d.MIN_SIZE,
    maxDefaultSize: partial.maxDefaultSize ?? d.MAX_DEFAULT_SIZE,
    headerH: partial.headerH ?? d.HEADER_H,
    shadeH: partial.shadeH ?? d.SHADE_H,
    dragThreshold: partial.dragThreshold ?? d.DRAG_THRESHOLD,
    keepVisible: partial.keepVisible ?? d.KEEP_VISIBLE,
    viewportMargin: partial.viewportMargin ?? d.VIEWPORT_MARGIN,
  };
}

/** floating 기본 크기 — 뷰포트 비율에 상/하한을 적용하고, 뷰포트 자체를 넘지 않게 자른다. */
export function defaultFloatSize(vp: Viewport, cfg: FloatingWindowConfig): Size {
  const wanted = {
    w: Math.min(cfg.maxDefaultSize.w, Math.max(cfg.minSize.w, Math.round(vp.w * cfg.sizeRatio.w))),
    h: Math.min(cfg.maxDefaultSize.h, Math.max(cfg.minSize.h, Math.round(vp.h * cfg.sizeRatio.h))),
  };
  // 창이 뷰포트보다 커지면 이동·리사이즈로도 복구가 어렵다 → 뷰포트(여백 제외)로 캡.
  return {
    w: Math.max(1, Math.min(wanted.w, vp.w - cfg.viewportMargin)),
    h: Math.max(1, Math.min(wanted.h, vp.h - cfg.headerH - cfg.viewportMargin)),
  };
}

/** 위치만 클램프 — 창이 화면 밖으로 완전히 나가지 않게 최소 가시량을 남긴다. */
export function clampPosition(x: number, y: number, size: Size, vp: Viewport, cfg: FloatingWindowConfig): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, -size.w + cfg.keepVisible.x), vp.w - cfg.keepVisible.x),
    y: Math.min(Math.max(y, 0), vp.h - cfg.keepVisible.y),
  };
}

/**
 * §5.13 (S-10) 가두지 않은 자리가 **놓을 수 있는 자리**(`clampPosition`)를 몇 px 넘어섰는가 — 두 축 중
 * 큰 쪽(0 이면 안 넘었다). 뷰포트 밖으로 얼마나 나갔는지가 아니라 클램프에서 얼마나 더 갔는지를 재야,
 * 창을 화면 끝에 붙여 두는 평범한 손짓과 밖으로 빼내려는 손짓이 갈린다(IDE 의 `overflowPastClamp` 와 같은 뜻).
 */
export function overflowPastClampPosition(geom: FloatingWindowGeom, vp: Viewport, cfg: FloatingWindowConfig): number {
  const c = clampPosition(geom.x, geom.y, { w: geom.w, h: geom.h }, vp, cfg);
  return Math.max(Math.abs(geom.x - c.x), Math.abs(geom.y - c.y));
}

/** 크기·위치를 현재 뷰포트에 맞춰 클램프 — 뷰포트가 줄었을 때(창 리사이즈·회전) 호출. */
export function clampGeom(geom: FloatingWindowGeom, vp: Viewport, cfg: FloatingWindowConfig): FloatingWindowGeom {
  const w = Math.max(Math.min(geom.w, Math.max(cfg.minSize.w, vp.w - cfg.viewportMargin)), 1);
  const h = Math.max(Math.min(geom.h, Math.max(cfg.minSize.h, vp.h - cfg.headerH - cfg.viewportMargin)), 1);
  const pos = clampPosition(geom.x, geom.y, { w, h }, vp, cfg);
  return { ...pos, w, h };
}

/** 최초 위치 — 화면 가운데 + 계단식 오프셋(여러 창이 정확히 겹치지 않게). */
export function centeredGeom(vp: Viewport, cfg: FloatingWindowConfig, cascade = 0): FloatingWindowGeom {
  const { w, h } = defaultFloatSize(vp, cfg);
  const x = Math.max(8, Math.round((vp.w - w) / 2) + cascade);
  const y = Math.max(cfg.headerH, Math.round((vp.h - h) / 2) + cascade);
  return clampGeom({ x, y, w, h }, vp, cfg);
}

/**
 * 상태 → `position:fixed` 창에 그대로 붙일 위치·크기 스타일.
 * - maximized(또는 잠긴 전체화면): 앱 헤더 아래 전면.
 * - minimized: 폭은 유지하고 높이만 셰이드(타이틀바)로.
 * - floating: 저장된 geom 그대로.
 */
export function windowStyle(
  geom: FloatingWindowGeom,
  mode: FloatingWindowMode,
  cfg: FloatingWindowConfig,
  lockFullScreen = false,
): React.CSSProperties {
  if (lockFullScreen || mode === 'maximized') {
    return { left: 0, top: cfg.headerH, right: 0, bottom: 0 };
  }
  if (mode === 'minimized') {
    return { left: geom.x, top: geom.y, width: geom.w, height: cfg.shadeH || cfg.minSize.h };
  }
  return { left: geom.x, top: geom.y, width: geom.w, height: geom.h };
}
