/**
 * §5.4 #36 — 전환과 연결의 **화면 쪽 순수 판정** 한 벌.
 *
 * 카드(`AgentCardNode`)·버블 메뉴(`BubbleContextMenu`)·캔버스(`BubbleMap`)·선(`RefLinkEdge`·`CurvedEdge`·
 * `TaskEdgeComponent`)이 같은 답을 내야 하는 것만 여기 둔다. DOM 을 만지지 않으므로 그대로 단위 테스트된다.
 *
 * **코어는 앱 이름을 모른다(§5.13 (P-4))** — 이 파일에 앱 이름을 적지 않는다. 앱의 이름·여는 확장자는
 * 부르는 쪽이 레지스트리에서 꺼내 넘긴다.
 */

import type { AgentConfig, AppBubble, BubbleData } from '@vibisual/shared';
import { REF_LINK_STYLE, linkedFileName } from '@vibisual/shared';

// ─── (A) 전환 — 누가 카드가 될 수 있나 ───

/**
 * 이 버블을 입력 카드로 바꿀 수 있는가.
 *
 * 커스텀 에이전트만이다(코덱스·All Model 포함). 훅 버블은 입력이 없고(§5.5 #17-29), CMD 는 입력이 터미널의
 * 것이며(§4 v2.63), 휴지통 안의 버려진 에이전트는 입력을 받지 않는다. **서버 `setAgentForm` 과 같은 조건**이다 —
 * 한쪽만 넓히면 화면은 카드로 바꿨는데 서버가 409 로 되돌리는 깜빡임이 생긴다.
 */
export function canUseAgentCard(
  data: Pick<BubbleData, 'bubbleType' | 'customCreated' | 'trashed'> | undefined | null,
  config: Pick<AgentConfig, 'executionMode'> | undefined | null,
): boolean {
  if (!data) return false;
  if (data.bubbleType !== 'agent' || data.customCreated !== true || data.trashed === true) return false;
  return config?.executionMode !== 'interactive-terminal';
}

/**
 * 지금 이 노드를 카드로 그려야 하는가(형태 칸 + 커스텀 에이전트).
 * 휴지통 안의 버려진 에이전트는 카드였어도 버블로 그린다 — 그 화면은 고르는 자리지 입력하는 자리가 아니다.
 */
export function isAgentCardForm(data: Pick<BubbleData, 'bubbleType' | 'customCreated' | 'agentForm' | 'trashed'> | undefined | null): boolean {
  return !!data && data.bubbleType === 'agent' && data.customCreated === true && data.agentForm === 'card' && data.trashed !== true;
}

/**
 * 카드에서 보낼 세션 — **버블이 보여 주는 세션과 같은 우선순위**(`BubbleNode` 의 effective sub).
 * 도는 세션 → 그 IDE 창에서 고른 탭 → 마지막으로 고른 탭 → 없으면 null(서버 기본).
 * 버블은 A 세션을 보여 주는데 카드는 B 로 보내면, 사용자는 자기가 친 글이 어디로 갔는지 모른다.
 */
export function pickCardSession(
  subs: readonly { id: string; status: string }[] | undefined,
  ideActiveSessionId: string | null | undefined,
  stickySelectedSubId: string | null | undefined,
): string | null {
  if (!subs || subs.length === 0) return null;
  const running = subs.find((s) => s.status === 'active');
  if (running) return running.id;
  if (ideActiveSessionId && subs.some((s) => s.id === ideActiveSessionId)) return ideActiveSessionId;
  if (stickySelectedSubId && subs.some((s) => s.id === stickySelectedSubId)) return stickySelectedSubId;
  return null;
}

// ─── (B) 연결 — 누가 누구를 참조하나 ───

/**
 * 이 에이전트를 참조하는 앱 노드들(만든 순). `projectName` 을 주면 그 프로젝트 것만 — 다른 탭의 노드가
 * 같은 에이전트 id 를 들고 있을 일은 없지만, 프로젝트 격리(§3.5)는 판정마다 지킨다.
 */
export function linkedAppBubblesOf(
  appBubbles: readonly AppBubble[],
  agentId: string,
  projectName?: string | null,
): AppBubble[] {
  return appBubbles
    .filter((b) => (projectName ? b.projectName === projectName : true) && (b.linkedAgentIds ?? []).includes(agentId))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * 위 목록의 **지문** — 구독은 이 문자열로 한다(파생 선택자 함정: 배열을 돌려주면 매 스냅샷 새 참조라
 * 무변화에도 카드가 다시 그려진다). 좌표는 넣지 않는다 — 앱 노드를 끄는 매 프레임 카드가 깨면 안 된다.
 */
export function linkedAppBubblesKey(
  appBubbles: readonly AppBubble[],
  agentId: string,
  projectName?: string | null,
): string {
  return linkedAppBubblesOf(appBubbles, agentId, projectName)
    .map((b) => `${b.id}\u0001${b.appId}\u0001${b.title ?? ''}\u0001${b.file ?? ''}`)
    .join('\u0002');
}

/**
 * 화면에 그릴 참조선 하나 — 출발(에이전트)·도착(앱 노드)·지문용 키.
 * 끝점 둘이 **지금 화면에 있을 때만** 만든다(어느 한쪽이 없으면 React Flow 가 고아 선을 경고한다).
 */
export interface RefLinkPair {
  id: string;
  agentId: string;
  appBubbleId: string;
}

export function refLinkPairs(
  appBubbles: readonly AppBubble[],
  visibleAgentIds: ReadonlySet<string>,
  projectName?: string | null,
): RefLinkPair[] {
  const out: RefLinkPair[] = [];
  for (const b of appBubbles) {
    if (projectName && b.projectName !== projectName) continue;
    for (const agentId of b.linkedAgentIds ?? []) {
      if (!visibleAgentIds.has(agentId)) continue;
      out.push({ id: `ref-${agentId}-${b.id}`, agentId, appBubbleId: b.id });
    }
  }
  return out;
}

/** 참조선 목록의 지문 — 이 문자열이 바뀔 때만 선을 다시 짓는다(앱 노드는 드래그 중 매 프레임 좌표가 바뀐다). */
export function refLinkPairsKey(pairs: readonly RefLinkPair[]): string {
  return pairs.map((p) => p.id).join('|');
}

// ─── (C) 노드가 결과를 받는다 — 참조 칩이 명령에 붙이는 것 ───

/** 보낼 때 본문에 붙는 앱 노드 하나의 사실. 이름·확장자는 레지스트리에서 꺼낸 값이다. */
export interface LinkedOutputNode {
  id: string;
  /** 앱의 제품 이름(브랜드 — 번역 대상 ❌). */
  appName: string;
  /** 노드에 보이는 이름(사용자 제목 → 담긴 파일 이름 → 앱 이름). */
  label: string;
  /** 그 노드가 받는 확장자(소문자, 마침표 포함). 비면 "아무 파일". */
  accepts: readonly string[];
  /** 지금 담긴 파일(루트 기준 상대 경로). */
  file?: string | undefined;
}

/** 노드에 보일 이름 — 사용자 제목이 우선, 없으면 담긴 파일 이름, 그것도 없으면 앱 이름. */
export function appNodeLabel(bubble: Pick<AppBubble, 'title' | 'file'>, appName: string): string {
  const title = bubble.title?.trim();
  if (title) return title;
  if (bubble.file) return linkedFileName(bubble.file);
  return appName;
}

/** 블록이 시작되는 표식 — 본문과 섞이지 않게(그리고 두 번 붙지 않게) 이 줄로 가른다. */
export const LINKED_OUTPUT_MARK = 'Linked canvas nodes (Vibisual)';

/**
 * 참조 칩이 켜진 노드들의 **에이전트 프로토콜 블록**.
 *
 * 화면 라벨이 아니라 에이전트에게 주는 규약이라 영어다(`vibi3dAgentPrompt`·`buildAudioDelegatePrompt` 선례).
 * 자격 증명 **값**은 싣지 않는다 — 환경 변수 이름만 적는다(그 값은 이미 세션 환경에 있다).
 */
export function buildLinkedOutputBrief(nodes: readonly LinkedOutputNode[]): string {
  if (nodes.length === 0) return '';
  const lines = nodes.map((n) => {
    const accepts = n.accepts.length > 0 ? n.accepts.join(' ') : 'any file';
    const holds = n.file ? JSON.stringify(n.file) : 'nothing yet';
    return `- node ${n.id} · ${n.appName} ${JSON.stringify(n.label)} · accepts ${accepts} · holds ${holds}`;
  });
  return [
    '---',
    `${LINKED_OUTPUT_MARK}: the user linked these canvas nodes to you. Put the results this request asks for into them.`,
    ...lines,
    'To deliver a result: create the file inside this project, then POST "$VIBISUAL_BASE/api/app-bubbles/<node id>/output" with the header "x-vibisual-hook-token: $VIBISUAL_TOKEN" (or $VIBISUAL_HOOK_AUTH) and JSON {"file":"<path relative to the project root>"}.',
    'Report a node as delivered only after that call returns {"ok":true}. Never print the token or put it in a URL. If the connection values are unavailable, say so instead of guessing.',
  ].join('\n');
}

/** 본문 + 블록. 켜진 노드가 없거나 본문이 이미 블록을 갖고 있으면 본문 그대로다(두 번 붙지 않게). */
export function withLinkedOutputBrief(text: string, nodes: readonly LinkedOutputNode[]): string {
  const brief = buildLinkedOutputBrief(nodes);
  if (!brief || text.includes(LINKED_OUTPUT_MARK)) return text;
  return `${text.trimEnd()}\n\n${brief}`;
}

// ─── 기하 — 판 테두리와 참조선 ───

/**
 * 중심에서 단위 벡터 `(nx, ny)` 방향으로 나간 반직선이 **사각 테두리**와 만나는 거리.
 * 원(정사각 버블)은 반지름 그대로다 — 원 반지름으로 사각을 재면 가로로 다가오는 선이 판 안쪽에서 끊긴다.
 */
export function rectBorderDistance(halfW: number, halfH: number, nx: number, ny: number): number {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const tx = ax > 1e-6 ? halfW / ax : Number.POSITIVE_INFINITY;
  const ty = ay > 1e-6 ? halfH / ay : Number.POSITIVE_INFINITY;
  const t = Math.min(tx, ty);
  return Number.isFinite(t) ? t : Math.max(halfW, halfH);
}

/** 정사각이 아닌 노드인가(카드). 1px 은 측정 반올림으로 본다. */
export function isRectNode(width: number, height: number): boolean {
  return Math.abs(width - height) > 1;
}

/**
 * 노드 박스에서 그 방향 끝점까지의 거리 — 정사각이면 원(반지름), 아니면 판 테두리.
 * 선 끝점을 정하는 세 곳(`CurvedEdge`·`TaskEdgeComponent`·`RefLinkEdge`)이 이 한 함수를 쓴다.
 */
export function nodeBorderDistance(width: number, height: number, nx: number, ny: number): number {
  if (!isRectNode(width, height)) return Math.min(width, height) / 2;
  return rectBorderDistance(width / 2, height / 2, nx, ny);
}

/** 참조선 경로 — 옆구리에서 나가 옆구리로 들어가는 수평 S 곡선. */
export interface RefLinkGeometry {
  path: string;
  /** 곡선의 한가운데(t=0.5) — [연결 끊기] 단추 자리. */
  midX: number;
  midY: number;
}

export function refLinkPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  /** 출발 쪽 접선 방향 — 오른쪽으로 나가면 1, 왼쪽이면 -1. */
  side: 1 | -1,
): RefLinkGeometry {
  const reach = Math.min(
    REF_LINK_STYLE.curveMax,
    Math.max(REF_LINK_STYLE.curveMin, Math.abs(tx - sx) * REF_LINK_STYLE.curveRatio),
  );
  const c1x = sx + side * reach;
  const c2x = tx - side * reach;
  const path = `M ${sx},${sy} C ${c1x},${sy} ${c2x},${ty} ${tx},${ty}`;
  // 3차 베지어 t=0.5 = (P0 + 3·P1 + 3·P2 + P3) / 8
  const midX = (sx + 3 * c1x + 3 * c2x + tx) / 8;
  const midY = (sy + 3 * sy + 3 * ty + ty) / 8;
  return { path, midX, midY };
}

/**
 * 두 박스(중심·반폭·반높이) 사이 참조선의 끝점. 앞에 있는 쪽으로 나가 마주 보는 옆구리로 들어간다.
 * 출발이 원(버블 형태)이면 원의 옆구리다 — 카드로 펼쳐도, 버블로 접어도 선이 같은 문법으로 붙는다.
 */
export function refLinkEndpoints(
  src: { cx: number; cy: number; halfW: number; halfH: number },
  dst: { cx: number; cy: number; halfW: number; halfH: number },
): { sx: number; sy: number; tx: number; ty: number; side: 1 | -1 } {
  const side: 1 | -1 = dst.cx >= src.cx ? 1 : -1;
  return {
    sx: src.cx + side * src.halfW,
    sy: src.cy,
    tx: dst.cx - side * dst.halfW,
    ty: dst.cy,
    side,
  };
}
