// SCENARIO.md §5.5 #17-6 (H-4) ③ — **오갈 때 손을 놓지 않는다.**
//
// 독립 창을 끌다 앱 안으로 들어오면 그 순간 앱 안 IDE 창으로 돌아온다. 그런데 그때 사용자의
// 손은 **아직 눌려 있다** — 이어받지 않으면 창은 돌아왔는데 움직이지 않아, 한 번 놓았다 다시
// 잡아야 한다(한 손짓이 두 동강 난다). 그래서 돌아오는 창은 밖에서 끌던 드래그를 **그대로
// 이어받는다**.
//
// 문제는 그 신호가 도착하는 곳과 쓰는 곳이 다르다는 것이다: 신호는 창이 서기 **전에**
// `useOverlayReveal` 로 오고, 쓰는 것은 그 뒤에 마운트되는 `AgentIDEOverlay` 다. 스토어에 두면
// 영속·스냅샷 왕복에 딸려 다녀(§3.2.1) 다음 실행에서 유령 드래그가 되므로, **그 한 순간만
// 사는 모듈 지역 상자**에 둔다 — 여기 있는 것은 전부 순수 함수라 창을 띄우지 않고 확인할 수 있다.

/** 밖에서 끌던 창이 앱 안으로 들고 오는 것 — 잡은 자리와 크기. */
export interface PaneDragResume {
  agentId: string;
  /** 창 좌상단에서 커서까지의 **비율**(0~1). 창 크기가 달라져도 잡은 자리가 손 아래 그대로 있게. */
  grabRatioX: number;
  grabRatioY: number;
  /** 밖에서 끌던 창의 크기(px) — 앱 안 창 크기를 정할 때의 밑값. */
  width: number;
  height: number;
  /**
   * 돌아오는 그 순간 커서가 있던 **화면 좌표**(DIP).
   *
   * 이것이 없으면 새로 선 창은 첫 `mousemove` 가 올 때까지 **옛 자리**(밖으로 나가기 전 앉아
   * 있던 곳)에 떠 있다 — 한 프레임이라도 엉뚱한 데 떴다 손 아래로 튀면 창이 깜빡인 것처럼 보인다.
   */
  cursor: { x: number; y: number } | null;
  /** 맡긴 시각(ms) — 받을 창이 끝내 안 서면 걷는다. */
  at: number;
}

export interface PaneDragResumeInput {
  agentId: string;
  /** 창 좌상단에서 커서까지의 거리(px). */
  grabX: number;
  grabY: number;
  width: number;
  height: number;
  cursor?: { x: number; y: number } | undefined;
}

/**
 * 이 시간이 지나면 걷는다(ms). 받을 창은 신호 직후에 서므로 넉넉하다.
 *
 * 시한이 없으면, 받을 창이 어떤 이유로든 서지 않았을 때 그 짐이 남아 **한참 뒤에 연 창**이
 * 누르지도 않은 드래그를 이어받는다(창이 커서를 따라다니는 유령 동작).
 */
export const PANE_DRAG_RESUME_TTL_MS = 5000;

let pending: PaneDragResume | null = null;

/** 잡은 지점을 비율로 접어 맡긴다. 크기가 0 이면 비율을 낼 수 없으므로 위쪽 가운데로 둔다. */
export function putPaneDragResume(input: PaneDragResumeInput, now: number = Date.now()): PaneDragResume {
  const w = Number.isFinite(input.width) && input.width > 0 ? input.width : 0;
  const h = Number.isFinite(input.height) && input.height > 0 ? input.height : 0;
  const gx = Number.isFinite(input.grabX) ? input.grabX : 0;
  const gy = Number.isFinite(input.grabY) ? input.grabY : 0;
  const resume: PaneDragResume = {
    agentId: input.agentId,
    grabRatioX: w > 0 ? Math.min(1, Math.max(0, gx / w)) : 0.5,
    grabRatioY: h > 0 ? Math.min(1, Math.max(0, gy / h)) : 0,
    width: w,
    height: h,
    cursor: input.cursor
      && Number.isFinite(input.cursor.x)
      && Number.isFinite(input.cursor.y)
      ? { x: input.cursor.x, y: input.cursor.y }
      : null,
    at: now,
  };
  pending = resume;
  return resume;
}

/**
 * 그 에이전트의 짐을 꺼낸다 — **한 번 꺼내면 사라진다**(같은 짐을 두 창이 나눠 쓰면 둘 다
 * 커서를 따라다닌다). 다른 에이전트의 것이면 손대지 않고 그대로 둔다.
 */
export function takePaneDragResume(agentId: string, now: number = Date.now()): PaneDragResume | null {
  const cur = pending;
  if (!cur) return null;
  if (now - cur.at > PANE_DRAG_RESUME_TTL_MS) {
    pending = null;
    return null;
  }
  if (cur.agentId !== agentId) return null;
  pending = null;
  return cur;
}

/** 드래그가 끝났는데 아무도 안 꺼내 갔을 때 걷는다(고아 짐 ❌). */
export function clearPaneDragResume(): void {
  pending = null;
}
