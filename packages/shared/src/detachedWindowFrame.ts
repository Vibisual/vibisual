/**
 * §5.4 #14-1 (H) — 탭을 떼어 내는 동안의 가상 창과 놓은 뒤 별창 자리·크기의 순수 기하(§5.5 #17-6 (H-6)·§5.13 (S-10) 과 같은 가상 창).
 * 선은 main 의 클릭통과 창(`ghostFrame.ts`)이 그린다 — 앱 창 안 DOM 이면 앱 경계에서 잘린다. 놓으면 그 자리·크기로 선다.
 * 선은 렌더러가, 창은 main 이 정하므로 같은 값을 여기 한 곳이 쥔다. shared 라 숫자만 본다(세 OS 단위 테스트).
 */

/** 별창과 그 가상 창의 모든 수치 — 값 조정은 여기 한 곳(매직넘버 산개 ❌). */
export const DETACHED_WINDOW = {
  /** 별창 기본 크기(DIP). 선이 없는 길(우클릭 [별창으로 분리])도 이 크기로 선다. */
  defaultWidth: 1100,
  defaultHeight: 720,
  /** 별창 최소 크기(DIP). */
  minWidth: 480,
  minHeight: 320,
  /** 작은 화면에서 선(=곧 설 창)이 쓸 작업 영역 비율 — 1100×720 은 1280×720 노트북을 넘어 머리줄·아래 변이 화면 밖으로 나간다. */
  maxAvailRatio: 0.92,
  /** 선이 없을 때 커서가 창 머리줄의 어디에 오는가 — 가로는 가운데, 세로는 위에서 이만큼(종전 자리 그대로). */
  cursorGrabY: 18,
  /** 선의 이름 띠 높이(px) — `ghostFrame.ts` 의 `.bar` 와 앱 안 윤곽선의 `h-[34px]` 와 같은 값. */
  ghostBarHeight: 34,
  /** 탭 이름 들여쓰기(10px)와 선 이름 띠 들여쓰기(24px = 여백 10 + 점 8 + 틈 6)의 차 — 띠 밖으로 나가는 순간 이름이 옆으로 튀지 않게. */
  labelAlignPx: 14,
  /** 잡은 지점이 선의 좌우 끝에 붙지 않게 두는 여유(px) — 끝을 잡으면 선이 손에서 빠진 것처럼 보인다. */
  grabEdgePx: 16,
  /** 잡은 지점이 이름 띠의 위아래 끝에 붙지 않게 두는 여유(px). */
  grabBarInsetPx: 6,
} as const;

/** 떼어 내는 동안의 선 — main 의 `ghostShow` 에 그대로 넘기는 크기와 잡은 지점(선 좌상단에서 커서까지). */
export interface DetachGhostFrame {
  width: number;
  height: number;
  grabX: number;
  grabY: number;
}

/** 화면 좌표계의 네모(DIP) — Electron `BrowserWindow.getBounds()` 와 같은 모양. */
export interface DetachedWindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 별창을 세울 크기와 자리. 자리가 없으면 OS 가 정한다. */
export interface DetachedWindowPlacement {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

function clamp(value: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.min(hi, Math.max(lo, value));
}

/** 한 축의 크기 — 기본 크기를 작업 영역 비율 안으로 줄이되 최소보다 작아지지 않는다. */
function fitLength(base: number, min: number, avail: number | undefined): number {
  if (avail === undefined || !Number.isFinite(avail) || avail <= 0) return base;
  return Math.max(min, Math.min(base, Math.floor(avail * DETACHED_WINDOW.maxAvailRatio)));
}

/**
 * 떼어 내는 동안 매달릴 선의 크기(= 곧 설 창)와 잡은 지점. 가로는 `labelAlignPx` 만큼 옮기고 세로는 이름 띠 안으로 묶는다(밖이면 본문을 잡고 끄는 그림).
 * @param input.grab 탭 좌상단 기준 잡은 지점(px).
 * @param input.avail 그 화면의 작업 영역 크기(DIP). 모르면 null — 기본 크기.
 */
export function detachGhostFrame(input: {
  grab: { x: number; y: number };
  avail: { width: number; height: number } | null;
}): DetachGhostFrame {
  const W = DETACHED_WINDOW;
  const width = fitLength(W.defaultWidth, W.minWidth, input.avail?.width);
  const height = fitLength(W.defaultHeight, W.minHeight, input.avail?.height);
  const gx = Number.isFinite(input.grab.x) ? input.grab.x : 0;
  const gy = Number.isFinite(input.grab.y) ? input.grab.y : W.ghostBarHeight / 2;
  return {
    width,
    height,
    grabX: Math.round(clamp(gx + W.labelAlignPx, W.grabEdgePx, width - W.grabEdgePx)),
    grabY: Math.round(clamp(gy, W.grabBarInsetPx, W.ghostBarHeight - W.grabBarInsetPx)),
  };
}

/**
 * 별창 크기·자리: 멈춘 선이 있으면 그대로(§5.5 #17-6 (H-17) ④ — 경계는 main 이 읽은 값, 렌더러 좌표는 배율이 다른 모니터에서 어긋난다) →
 * 선이 없으면 커서가 머리줄 가운데에 오는 자리 → 그것도 없으면 크기만 주고 자리는 OS 에.
 */
export function detachedWindowPlacement(input: {
  ghost: DetachedWindowRect | null;
  cursor?: { x: number; y: number } | null;
}): DetachedWindowPlacement {
  const W = DETACHED_WINDOW;
  const g = input.ghost;
  if (g && Number.isFinite(g.x) && Number.isFinite(g.y) && Number.isFinite(g.width) && Number.isFinite(g.height)) {
    return {
      width: Math.max(W.minWidth, Math.round(g.width)),
      height: Math.max(W.minHeight, Math.round(g.height)),
      x: Math.round(g.x),
      y: Math.round(g.y),
    };
  }
  const c = input.cursor;
  if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) {
    return {
      width: W.defaultWidth,
      height: W.defaultHeight,
      x: Math.round(c.x - W.defaultWidth / 2),
      y: Math.round(c.y - W.cursorGrabY),
    };
  }
  return { width: W.defaultWidth, height: W.defaultHeight };
}
