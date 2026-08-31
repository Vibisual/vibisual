// §5.9 v3.34 / §5.10 v3.77 — "앱 내부 IDE식 창"의 순수 기하 계산.
//
// 캡처 창(CaptureWindow)과 기억 라이브러리(BrainLibraryOverlay)가 같은 창 거동을 쓰면서 좌표 계산이
// 두 곳이 됐다 → captureWindowManager 선례대로 **window 바인딩과 분리한 순수 함수**로 모아 단위
// 테스트 가능하게 둔다. 뷰포트는 인자로 받는다(전역 window 참조 ❌ — 테스트에서 값만 바꿔 넣는다).

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
 * §5.13 (S-3) — 창을 **앱 밖으로 끌어내는** 손짓의 문턱.
 *
 * 앱 안 창은 IDE 창(§5.5 #17-6)·내부 앱 창 둘 다 같은 손짓으로 밖에 나가야 한다. 기준이 두 벌이면
 * 같은 동작이 창 종류마다 다르게 반응하므로 수치도 판정도 여기 한 곳에 둔다(IDE 의 `IDE_FLOAT` 는
 * 이 값을 그대로 받아 쓴다).
 */
export const WINDOW_PULL_OUT = {
  /** 커서가 앱 창 밖으로 이만큼 더 나가야 "밖으로 꺼낸다"로 읽는다(px). */
  MARGIN: 24,
  /**
   * 화면 끝에 **막혀** 더 나갈 수 없을 때 "밖으로 밀고 있다"로 읽어 주는 안쪽 띠(px).
   *
   * 단일 모니터에 앱이 최대화돼 있으면 커서는 뷰포트를 한 픽셀도 벗어나지 못한다 — 그 사람에게
   * `MARGIN` 은 영영 닿지 않는 문턱이라 끌어내기라는 손짓 자체가 없는 것과 같다.
   */
  EDGE_PX: 3,
  /** 그 띠에 이만큼 버티면 밖으로 나간 것과 **같이** 본다(ms). 스치기만 한 손은 걸리지 않게. */
  EDGE_DWELL_MS: 500,
} as const;

/**
 * 커서가 앱 창 **밖으로** 나갔는가 — 그 자리에서 손을 떼면 이 창은 독립 OS 창이 된다.
 *
 * 여유(margin)를 두는 까닭: 0 이면 창을 화면 가장자리까지 끌기만 해도 튀어나가고, 너무 크면
 * 모니터가 하나이고 앱이 최대화된 사용자는 커서를 그만큼 밖으로 낼 수 없어 손이 닿지 않는다
 * (그 사람은 아래 `isCursorPinnedToViewportEdge` 가 받는다).
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
 * 커서가 뷰포트 **가장자리에 막혀** 있는가 — 밖으로 더 밀고 싶어도 화면이 없어서 못 미는 자리.
 *
 * 무장 여부는 부르는 쪽이 **시간**으로 가른다(이 함수는 자리만 본다) — 스쳐 지나간 손이 창을
 * 밖으로 던지면 안 되기 때문이다.
 *
 * 오른쪽·아래 경계에서 `-1` 을 빼는 까닭: 브라우저가 주는 `clientX/Y` 의 최대값은 `w-1`/`h-1`
 * 이라, `w` 를 그대로 견주면 끝까지 밀어도 띠 안에 들어오지 않는다.
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
