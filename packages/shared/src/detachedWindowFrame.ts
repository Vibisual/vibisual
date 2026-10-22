/**
 * §5.4 #14-1 (H) — 탭을 떼어 내는 동안의 **가상 창**과, 놓은 뒤 별창이 설 **자리·크기**의 순수 기하.
 *
 * 탭을 끌어 탭 띠 밖으로 가져가면 손에 들린 탭 대신 **곧 설 별창 크기 그대로의 윤곽선**이 커서에
 * 매달린다 — §5.5 #17-6 (H-6) IDE 창 · §5.13 (S-10) 앱 창과 같은 가상 창이다. 앱 창 밖은 렌더러가
 * 그릴 수 없으므로 그 선은 main 의 클릭통과 창(`ghostFrame.ts`)이 앱 경계 밖까지 이어 그리고, 손을
 * 떼면 별창이 **그 선의 자리·크기 그대로** 선다. 종전에는 손에 든 탭이 앱 창 안의 DOM 이라 앱
 * 경계에서 잘려 사라졌다(사용자 보고 — "앱의 경계에서 그림이 사라져서 내 마우스를 따라오지 않는 느낌").
 *
 * 선의 크기·잡은 지점은 렌더러가, 별창의 크기·자리는 main 이 정한다. 두 쪽이 **같은 값**을 봐야
 * 선은 1100 인데 창은 다른 크기로 서거나, 선이 없을 때의 자리 규칙이 갈리는 일이 없다 — 그래서
 * 여기 한 곳이 쥔다.
 *
 * ⚠️ 이 파일은 브라우저에서도 로드되는 shared 다 — 화면·창 API 를 부르지 않고 **숫자만** 본다
 * (`windowDragRegion.ts` 와 같은 규약). 창을 띄우지 않고 단위 테스트로 세 OS 를 함께 고정한다.
 */

/** 별창과 그 가상 창의 모든 수치 — 값 조정은 여기 한 곳(매직넘버 산개 ❌). */
export const DETACHED_WINDOW = {
  /** 별창 기본 크기(DIP). 선이 없는 길(우클릭 [별창으로 분리])도 이 크기로 선다. */
  defaultWidth: 1100,
  defaultHeight: 720,
  /** 별창 최소 크기(DIP). */
  minWidth: 480,
  minHeight: 320,
  /**
   * 작은 화면에서 선(=곧 설 창)이 차지할 수 있는 작업 영역 비율.
   *
   * 1100×720 은 1280×720 노트북의 작업 영역을 넘는다 — 넘친 선은 놓기 전부터 화면 밖에 걸쳐
   * "어디에 서는지"를 말하지 못하고, 그 크기로 선 창은 머리줄이나 아래 변이 화면 밖으로 나간다.
   */
  maxAvailRatio: 0.92,
  /** 선이 없을 때 커서가 창 머리줄의 어디에 오는가 — 가로는 가운데, 세로는 위에서 이만큼(종전 자리 그대로). */
  cursorGrabY: 18,
  /** 선의 이름 띠 높이(px) — `ghostFrame.ts` 의 `.bar` 와 앱 안 윤곽선의 `h-[34px]` 와 같은 값. */
  ghostBarHeight: 34,
  /**
   * 탭 이름의 들여쓰기(10px — 탭의 `px-2.5`)와 선 이름 띠의 이름 들여쓰기(24px — 여백 10 + 점 8 +
   * 틈 6)의 차. 잡은 지점을 이만큼 옮겨야 띠 밖으로 나가는 순간 탭 이름이 선의 이름 자리로
   * 그대로 이어진다(손 아래에서 이름이 옆으로 튀지 않는다).
   */
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
 * 떼어 내는 동안 커서에 매달릴 **선의 크기와 잡은 지점**.
 *
 * 크기는 곧 설 별창의 크기다(놓으면 창이 이 선을 그대로 이어받는다). 잡은 지점은 손에 들고 있던
 * 탭에서 옮겨 온다 — 가로는 탭 이름이 선의 이름 자리에 오도록 `labelAlignPx` 만큼, 세로는 이름 띠
 * 안으로 묶는다(띠 밖을 잡은 채로 서면 창 본문을 잡고 끄는 그림이 된다).
 *
 * @param input.grab 손에 든 탭 안에서 잡은 지점(탭 좌상단 기준 px).
 * @param input.avail 그 앱 창이 놓인 화면의 작업 영역 크기(DIP). 모르면 null — 기본 크기 그대로.
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
 * 별창이 설 **크기와 자리**.
 *
 * - 손을 뗀 자리에 **멈춘 선**이 있으면 그 자리·크기 그대로 선다(§5.5 #17-6 (H-17) ④ "놓은 그 자리
 *   그 크기 그대로"와 같은 규율). 선의 경계는 main 이 직접 읽은 값이다 — 렌더러가 보낸 화면 좌표는
 *   배율이 다른 모니터에서 엉뚱한 화면을 가리킨다((H) 와 같은 이유).
 * - 선이 없으면(우클릭 [별창으로 분리] · 선을 못 띄우는 환경) 종전대로 커서가 머리줄 가운데에 오는 자리.
 * - 그것도 없으면 크기만 주고 자리는 OS 에 맡긴다.
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
