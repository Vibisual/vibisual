/**
 * detachedIDEFocus.ts — §5.5 #17-6 (판올림 번호 발급 대기)
 * **밖에 이미 서 있는 IDE 창은 다시 열지 않는다 — 앞으로 세우기만 한다.**
 *
 * IDE 창을 앱 밖으로 꺼내면 앱 안 창은 함께 닫힌다(§5.5 #17-6 (H) — "같은 IDE 가 두 곳에 뜨면
 * 어느 쪽이 진짜인지 알 수 없다"). 그런데 여는 손잡이들은 그 규율을 몰라, 밖에 그 에이전트의
 * IDE 가 펼쳐져 있는데도 앱 안에 같은 IDE 를 하나 더 세웠다(사용자 보고 — "독립으로 빼뒀는데
 * 앱 안의 버블을 더블클릭하면 또 켜진다. 외부에 켜져 있으면 그냥 포커싱만").
 *
 * (H-27) **접힌 버블도 같은 규율을 탄다.** 밖에 그 에이전트의 창이 버블로 떠 있는데 앱 안에 IDE 를
 * 세우면, 그 버블을 펴는 순간 같은 IDE 가 두 곳에 선다(사용자 지시 — "버블 오버레이로 되어있다면
 * ide창이 열려야하고 즉 2개가 열리는걸 막으라고"). 그래서 버블은 **그 창을 IDE 로 편다** — 펴는 일은
 * 그 창의 렌더가 하고(main 의 재사용 갈래가 [IDE 열기]를 보낸다), 반대로 밖에서 IDE 가 먼저 펴지면
 * 앱 안의 같은 창이 짐을 넘기고 물러난다(`panesYieldingToDetachedIDE`).
 *
 * 판정은 이 파일 하나가 쥔다 — 여는 손잡이가 여럿이라(캔버스 더블클릭 · [창과 버블] 목록 ·
 * 북마크 점프 · 지휘통제실 · 콘티 이력) 손잡이마다 두면 다음에 늘어나는 손잡이가 또 창을
 * 두 벌로 만든다. 그래서 `openIDEOverlay` 가 이 함수를 부르는 자리도 한 곳이다.
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
 * `#overlay=1` 로 뜬 창인가 — **이 창 자신이 독립(오버레이) 창인지**.
 *
 * 창 목록은 모든 창에 함께 밀리므로, 독립 창의 store 에도 **자기 자신**이 들어 있다. 그 창이
 * 자기 IDE 를 펴는 길(`OverlayShell` 의 더블클릭·메뉴 [IDE 열기])까지 여기서 갈리면, 자기를
 * 포커스하기만 하고 IDE 는 영영 안 펴진다.
 *
 * `parseOverlayHash` 를 부르지 않고 접두만 보는 것은 `canDeclareSliceScopeForHash`(useWebSocket)
 * 와 같은 이유다 — 스토어가 레이아웃 모듈에 매이면 안 된다.
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
  /**
   * 밖에서 앱 안으로 **되돌아오는 길**인가(되돌리기 손잡이 ↩ · 합치기 드래그 · 팝아웃 실패 복구).
   * 그 창은 곧 닫히지만 목록에는 아직 남아 있어, 여기서 걸리면 되돌리기가 자기 자신을
   * 포커스하며 앱 안에 아무것도 세우지 못한다.
   */
  redock: boolean;
  /** 오버레이 창을 앞으로 세울 IPC 가 이 창에 있는가(브라우저·구버전 preload 에는 없다). */
  hasOverlayApi: boolean;
  /**
   * (H-27) ⓐ 앱 안에 **그 에이전트의 IDE 창이 이미 서 있는가**(`hasAppIDEPane`). 서 있으면 밖의
   * 버블은 펴지 않는다 — 여는 길이 그 창을 앞으로 올리기만 하므로 두 벌이 되지 않는다.
   * 밖의 창이 **IDE 로 펼쳐져** 있으면 이 값과 무관하게 밖이 이긴다((H-13)).
   */
  appHasPane: boolean;
  /**
   * (H-27) ⓑ 전역 표시 토글(§17-6 (D))이 켜져 있는가. 꺼진 판의 버블은 숨긴 것이라 IDE 가 아니고,
   * 그 판에 밖으로 보내면 스위치가 켜지며 다른 버블까지 모두 나타난다. 펼친 IDE 를 숨긴 판은
   * 종전대로 밖이다((H-13) — 스위치를 켜고 보여 준다).
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
  // (H-27) ② 접힌 버블 위젯 — 그 창을 IDE 로 편다((H-13) ② "접힌 버블 위젯은 IDE 가 아니다"를
  //   사용자 지시로 대체). 앱에 남기는 것은 셋뿐이다.
  //   ⓐ 앱 안에 그 창이 이미 서 있다 — 그 창을 앞으로 올리면 두 벌이 아니다.
  if (input.appHasPane) return APP;
  //   ⓑ 전역 표시가 꺼져 있다 — 숨긴 버블은 IDE 가 아니다.
  if (!input.overlaysVisible) return APP;
  //   ⓒ 창의 프로젝트를 모른다 — main 의 `overlay:open` 이 빈 projectId 를 받지 않는다.
  if (found.projectId === '') return APP;
  return detached;
}

/**
 * (H-27) ⓐ 앱 안에 그 에이전트의 IDE 창이 이미 서 있는가 — `openIDEOverlay` 의 `already` 와
 * **같은 슬롯·같은 에이전트**를 본다(여는 길이 새 창을 세우지 않고 그 창을 올리는 조건이 바로 그것이다).
 * 슬롯 주인은 부르는 쪽이 `openIDEOverlay` 와 같은 순서로 정해 넘긴다(`activeProject ?? agentProjects[agentId]`).
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
 * (H-27) ⑦ **그 창에 세울 세션** — 세션을 골라 여는 손짓(북마크 점프 · 지휘통제실 [이동] · 콘티 이력의
 * 새 콘티 · [창과 버블] 목록의 색 줄)이 `openIDEOverlay` 에 함께 싣는 값.
 *
 * 종전에는 그 손짓들이 창을 연 **다음에** `setIDEActiveSession(id)` 를 창 키 없이 불렀다. 키가 없으면
 * "맨 앞 창"이라, 창이 밖으로 흘러간 판(앱 안에는 서지 않는다)에는 앱 안의 **다른 에이전트 창**에
 * 그 세션이 섰고 밖의 창은 끝내 그 세션으로 서지 않았다. 이제 여는 길이 이 값을 들고 가 앱 안이면
 * 그 에이전트의 창에(`agentIDEPaneKey`), 밖이면 그 창의 렌더에 건넨다(main 은 뜻을 모르고 싣기만 한다).
 */
export interface IDEFocusTarget {
  /** 세울 세션. `null` 이면 메인 탭. */
  sessionId: string | null;
  /** 북마크 점프면 그 항목 자리 — 세션이 선 뒤 `bookmarkScrollTarget` 으로 그 위치까지 내려간다. */
  bookmark?: { text: string; anchorId?: string };
}

/**
 * 창구(`overlay:open` → [IDE 열기])를 건너온 값을 가린다. 세션 칸이 모양에 안 맞으면 `null` — 세우지
 * 않는다(엉뚱한 값으로 탭을 옮기느니 마지막에 보던 세션에 두는 편이 낫다). 북마크 자리만 틀렸으면
 * 세션은 세우고 자리만 버린다.
 */
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

/**
 * (H-27) ⑦ 세션을 세울 **그 에이전트의 창** — `hasAppIDEPane` 과 같은 슬롯 주인에 선 그 에이전트의
 * 창 중 맨 앞(z 가 가장 큰) 것. 없으면 `null` 이다 — 그때는 세우지 않는다(키 없이 부르면 맨 앞의
 * **남의 창**에 선다).
 */
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

/**
 * (H-27) ⑤ 밖에서 그 에이전트의 IDE 가 펴졌을 때 **앱 안에서 물러날 창들**과, 짐을 넘길 **맨 앞 창**.
 *
 * 에이전트만 본다 — 슬롯이 어느 프로젝트 탭에 있든 같은 IDE 다(탭에 가려져 있을 뿐 두 벌이다).
 * 짐은 하나만 넘긴다: 밖의 창은 하나이고, 사용자가 마지막으로 만진 것이 맨 앞(z 가 가장 큰) 창이다.
 */
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
