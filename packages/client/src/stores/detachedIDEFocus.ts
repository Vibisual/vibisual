/**
 * §5.5 #17-6 — 밖에 이미 서 있는 IDE 창은 다시 열지 않고 앞으로 세운다(같은 IDE 가 두 곳에 서지 않게).
 * (H-27) 밖에 접힌 버블이면 그 창을 IDE 로 편다(펴는 일은 그 창의 렌더). 밖에서 먼저 펴지면 앱 안 창이 짐을 넘기고 물러난다.
 * 판정은 이 파일 하나, `openIDEOverlay` 가 부르는 자리도 한 곳 — 여는 손잡이마다 두면 새 손잡이가 또 두 벌을 만든다.
 */

/** main 의 `listOverlays()` 가 밀어 주는 창 한 줄(창 목록은 그쪽이 SSOT). */
export interface OverlayWindowInfo {
  agentId: string;
  projectId: string;
  /** 그 창이 지금 **IDE 로 펼쳐져** 있는가(거짓이면 접힌 버블 위젯이다). */
  expanded: boolean;
}

/** 앱 안에서 IDE 를 여는 손짓이 실제로 닿아야 할 곳. */
export type OpenIDEDestination =
  | { kind: 'app' }
  | { kind: 'detached'; agentId: string; projectId: string };

const APP: OpenIDEDestination = { kind: 'app' };

/**
 * 이 창 자신이 `#overlay=1` 독립 창인가 — 창 목록엔 자기도 있어, 자기 IDE 를 펴는 길까지 여기서 갈리면 영영 안 펴진다.
 * `parseOverlayHash` 대신 접두만 본다 — 스토어가 레이아웃 모듈에 매이면 안 된다.
 */
export function isOverlayWindowHash(hash: string): boolean {
  const h = hash.replace(/^#/, '');
  if (h.length === 0) return false;
  return new URLSearchParams(h).get('overlay') === '1';
}

export function resolveOpenIDEDestination(input: {
  agentId: string;
  /** 지금 서 있는 오버레이 창들(main 이 밀어 준 목록 그대로). */
  overlays: readonly OverlayWindowInfo[];
  /** 이 창 자신이 독립 창인가(`isOverlayWindowHash`). */
  selfIsOverlayWindow: boolean;
  /** 밖에서 앱 안으로 되돌아오는 길인가(↩·합치기 드래그·팝아웃 실패 복구). 그 창은 목록에 아직 남아 있어, 걸리면 자기를 포커스하고 앱 안에 아무것도 못 세운다. */
  redock: boolean;
  /** 오버레이 창을 앞으로 세울 IPC 가 이 창에 있는가(브라우저·구버전 preload 에는 없다). */
  hasOverlayApi: boolean;
  /**
   * (H-27) ⓐ 앱 안에 그 에이전트의 IDE 창이 이미 서 있는가(`hasAppIDEPane`) — 서 있으면 밖의 버블은 펴지 않는다.
   * 밖이 IDE 로 펼쳐져 있으면 이 값과 무관하게 밖이 이긴다((H-13)).
   */
  appHasPane: boolean;
  /**
   * (H-27) ⓑ 전역 표시 토글(§17-6 (D))이 켜져 있는가. 꺼진 판의 버블은 숨긴 것이라 IDE 가 아니다(보내면 스위치가 켜져 다른 버블까지 나타난다).
   * 펼친 IDE 를 숨긴 판은 밖이다((H-13)).
   */
  overlaysVisible: boolean;
}): OpenIDEDestination {
  if (!input.hasOverlayApi) return APP;
  if (input.selfIsOverlayWindow) return APP;
  if (input.redock) return APP;
  const found = input.overlays.find((o) => o.agentId === input.agentId);
  if (!found) return APP;
  const detached: OpenIDEDestination = { kind: 'detached', agentId: found.agentId, projectId: found.projectId };
  if (found.expanded) return detached;
  // (H-27) ② 접힌 버블 위젯 — 그 창을 IDE 로 편다. 앱에 남기는 것은 셋뿐이다.
  //   ⓐ 앱 안에 그 창이 이미 서 있다 — 그 창을 앞으로 올리면 두 벌이 아니다.
  if (input.appHasPane) return APP;
  //   ⓑ 전역 표시가 꺼져 있다 — 숨긴 버블은 IDE 가 아니다.
  if (!input.overlaysVisible) return APP;
  //   ⓒ 창의 프로젝트를 모른다 — main 의 `overlay:open` 이 빈 projectId 를 받지 않는다.
  if (found.projectId === '') return APP;
  return detached;
}

/**
 * (H-27) ⓐ — `openIDEOverlay` 의 `already` 와 같은 슬롯·같은 에이전트를 본다.
 * 슬롯 주인은 부르는 쪽이 같은 순서로 정해 넘긴다(`activeProject ?? agentProjects[agentId]`).
 */
export function hasAppIDEPane(
  panes: readonly { projectId: string | null; agentId: string | null }[],
  ownerProject: string | null | undefined,
  agentId: string,
): boolean {
  if (!ownerProject) return false;
  return panes.some((o) => o.projectId === ownerProject && !!o.agentId && o.agentId === agentId);
}

/**
 * (H-27) ⑦ 그 창에 세울 세션 — 세션을 골라 여는 손짓이 `openIDEOverlay` 에 싣는다(앱 안이면 `agentIDEPaneKey` 창에, 밖이면 그 창의 렌더에).
 * 창을 연 뒤 `setIDEActiveSession(id)` 를 키 없이 부르지 마라 — 맨 앞의 다른 에이전트 창에 서고 밖의 창은 안 바뀐다.
 */
export interface IDEFocusTarget {
  /** 세울 세션. `null` 이면 메인 탭. */
  sessionId: string | null;
  /** 북마크 점프면 그 항목 자리 — 세션이 선 뒤 `bookmarkScrollTarget` 으로 그 위치까지 내려간다. */
  bookmark?: { text: string; anchorId?: string };
}

/** `overlay:open` 을 건너온 값을 가린다. 세션 칸이 모양에 안 맞으면 `null`(세우지 않고 보던 세션에 둔다). 북마크 자리만 틀리면 자리만 버린다. */
export function coerceIDEFocusTarget(raw: unknown): IDEFocusTarget | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as { sessionId?: unknown; bookmark?: unknown };
  let sessionId: string | null;
  if (r.sessionId === null) sessionId = null;
  else if (typeof r.sessionId === 'string' && r.sessionId.length > 0) sessionId = r.sessionId;
  else return null;
  const target: IDEFocusTarget = { sessionId };
  if (typeof r.bookmark === 'object' && r.bookmark !== null) {
    const b = r.bookmark as { text?: unknown; anchorId?: unknown };
    if (typeof b.text === 'string') {
      target.bookmark = typeof b.anchorId === 'string' && b.anchorId.length > 0
        ? { text: b.text, anchorId: b.anchorId }
        : { text: b.text };
    }
  }
  return target;
}

/** (H-27) ⑦ — `hasAppIDEPane` 과 같은 슬롯 주인에 선 그 에이전트 창 중 z 최대. 없으면 `null` — 세우지 않는다(키 없이 부르면 남의 창에 선다). */
export function agentIDEPaneKey(
  panes: readonly { paneKey: string; projectId: string | null; agentId: string | null; z: number }[],
  ownerProject: string | null | undefined,
  agentId: string,
): string | null {
  if (!ownerProject) return null;
  let front: { paneKey: string; z: number } | null = null;
  for (const pane of panes) {
    if (pane.projectId !== ownerProject || !pane.agentId || pane.agentId !== agentId) continue;
    if (front === null || pane.z > front.z) front = pane;
  }
  return front ? front.paneKey : null;
}

/** (H-27) ⑤ 밖에서 그 에이전트의 IDE 가 펴질 때 앱 안에서 물러날 창들(에이전트만 본다 — 탭과 무관하게 같은 IDE)과 짐을 넘길 z 최대 창 하나. */
export function panesYieldingToDetachedIDE<P extends { paneKey: string; agentId: string | null; z: number }>(
  panes: readonly P[],
  agentId: string,
): { front: P | null; paneKeys: string[] } {
  let front: P | null = null;
  const paneKeys: string[] = [];
  for (const pane of panes) {
    if (!pane.agentId || pane.agentId !== agentId) continue;
    paneKeys.push(pane.paneKey);
    if (front === null || pane.z > front.z) front = pane;
  }
  return { front, paneKeys };
}
