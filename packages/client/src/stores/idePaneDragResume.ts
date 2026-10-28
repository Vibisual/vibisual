// §5.5 #17-6 (H-4) ③ — **오갈 때 손을 놓지 않는다**: 끌던 독립 창이 앱 안으로 돌아오면 그 드래그를 이어받는다. 신호는 창이 서기 전에
// `useOverlayReveal` 로 오고 쓰는 것은 뒤에 마운트되는 `AgentIDEOverlay` 라 모듈 지역 상자에 둔다 — 스토어면 영속 왕복에 딸려(§3.2.1) 유령 드래그가 된다.

/** 밖에서 끌던 창이 앱 안으로 들고 오는 것 — 잡은 자리와 크기. */
export interface PaneDragResume {
  agentId: string;
  /** 창 좌상단에서 커서까지의 **비율**(0~1). 창 크기가 달라져도 잡은 자리가 손 아래 그대로 있게. */
  grabRatioX: number;
  grabRatioY: number;
  /** 밖에서 끌던 창의 크기(px) — 앱 안 창 크기를 정할 때의 밑값. */
  width: number;
  height: number;
  /** 돌아오는 순간 커서의 **화면 좌표**(DIP) — 없으면 새 창이 첫 `mousemove` 까지 옛 자리에 떴다 튀어 깜빡인다. */
  cursor: { x: number; y: number } | null;
  /** §5.5 #17-6 (H-17) — 손이 **아직 눌려 있는가.** 거짓이면 자리·크기만 물려받는다(이어받으면 놓은 뒤에도 커서를 따라다닌다). */
  dragging: boolean;
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
  /** (H-17) 손이 아직 눌려 있는가 — 없으면 **눌린 채**로 본다(종전 판의 뜻을 그대로 잇는다). */
  dragging?: boolean | undefined;
}

/** 이 시간(ms)이 지나면 걷는다 — 시한이 없으면 받을 창이 안 섰을 때 한참 뒤에 연 창이 누르지도 않은 드래그를 이어받는다. */
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
    dragging: input.dragging !== false,
    at: now,
  };
  pending = resume;
  return resume;
}

/**
 * §5.5 #17-6 (H-14) — 꺼내지 **않고** 들여다본다: 첫 렌더 자리는 `peek`, 레이아웃 효과가 `take`(첫 렌더에서 꺼내면 효과가 빈손이 된다).
 * 시한이 지난 짐도 여기서는 걷지 않는다 — 걷는 것은 `takePaneDragResume` 한 곳.
 */
export function peekPaneDragResume(agentId: string, now: number = Date.now()): PaneDragResume | null {
  const cur = pending;
  if (!cur) return null;
  if (now - cur.at > PANE_DRAG_RESUME_TTL_MS) return null;
  if (cur.agentId !== agentId) return null;
  return cur;
}

/**
 * 그 에이전트의 짐을 꺼낸다 — **한 번 꺼내면 사라진다**(같은 짐을 두 창이 나눠 쓰면 둘 다
 * 커서를 따라다닌다). 다른 에이전트의 것이면 손대지 않고 그대로 둔다.
 */
export function takePaneDragResume(agentId: string, now: number = Date.now()): PaneDragResume | null {
  const cur = peekPaneDragResume(agentId, now);
  if (!cur) {
    // 시한이 지난 짐은 **꺼내려는 손**이 걷는다 — 남겨 두면 한참 뒤에 연 창이 누르지도
    //   않은 드래그를 이어받는다(창이 커서를 따라다니는 유령 동작).
    if (pending && now - pending.at > PANE_DRAG_RESUME_TTL_MS) pending = null;
    return null;
  }
  pending = null;
  return cur;
}

/** 드래그가 끝났는데 아무도 안 꺼내 갔을 때 걷는다(고아 짐 ❌). */
export function clearPaneDragResume(): void {
  pending = null;
}
