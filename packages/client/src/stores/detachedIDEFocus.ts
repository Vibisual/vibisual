/**
 * detachedIDEFocus.ts — §5.5 #17-6 (판올림 번호 발급 대기)
 * **밖에 이미 서 있는 IDE 창은 다시 열지 않는다 — 앞으로 세우기만 한다.**
 *
 * IDE 창을 앱 밖으로 꺼내면 앱 안 창은 함께 닫힌다(§5.5 #17-6 (H) — "같은 IDE 가 두 곳에 뜨면
 * 어느 쪽이 진짜인지 알 수 없다"). 그런데 여는 손잡이들은 그 규율을 몰라, 밖에 그 에이전트의
 * IDE 가 펼쳐져 있는데도 앱 안에 같은 IDE 를 하나 더 세웠다(사용자 보고 — "독립으로 빼뒀는데
 * 앱 안의 버블을 더블클릭하면 또 켜진다. 외부에 켜져 있으면 그냥 포커싱만").
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
}): OpenIDEDestination {
  if (!input.hasOverlayApi) return APP;
  if (input.selfIsOverlayWindow) return APP;
  if (input.redock) return APP;
  const found = input.overlays.find((o) => o.agentId === input.agentId);
  // 접힌 버블 위젯은 IDE 가 아니다 — 캔버스 버블은 그대로 유지되는 **미러**이고(§17-6 (A)),
  //   그 상태에서 더블클릭은 앱 안에서 IDE 를 여는 종전 동작 그대로다(두 곳에 뜨는 IDE 가 없다).
  if (!found || !found.expanded) return APP;
  return { kind: 'detached', agentId: found.agentId, projectId: found.projectId };
}
