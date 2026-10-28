/**
 * §5.4 #36 — 말풍선·메뉴·캔버스·선·꽃잎이 같은 답을 내야 하는 화면 쪽 순수 판정(DOM 없음 → 단위 테스트).
 * 코어는 앱 이름을 모른다(§5.13 (P-4)) — 앱 이름을 적지 않고, 앱의 이름·확장자는 부르는 쪽이 레지스트리에서 넘긴다.
 */

import type { AgentConfig, AppBubble, BubbleData, CommandExecutionRequirements, CreationRunLimits } from '@vibisual/shared';
import { AGENT_CARD, REF_BLOOM, REF_LINK_STYLE, linkedFileName } from '@vibisual/shared';
import { refLinkVisible } from './linkView.js';

// ─── (A) 전환 — 누가 말풍선을 펼칠 수 있나 ───

/**
 * 입력 말풍선을 펼칠 수 있는가(이름의 "카드" = 저장값 `agentForm:'card'`). 커스텀 에이전트만(코덱스·All Model 포함, 훅·CMD·휴지통 ❌).
 * 서버 `setAgentForm` 과 같은 조건 — 한쪽만 넓히면 펼쳤다가 409 로 되돌아가며 깜빡인다.
 */
export function canUseAgentCard(
  data: Pick<BubbleData, 'bubbleType' | 'customCreated' | 'trashed'> | undefined | null,
  config: Pick<AgentConfig, 'executionMode'> | undefined | null,
): boolean {
  if (!data) return false;
  if (data.bubbleType !== 'agent' || data.customCreated !== true || data.trashed === true) return false;
  return config?.executionMode !== 'interactive-terminal';
}

/** 휴지통 안 에이전트는 말풍선이었어도 버블로 그린다 — 고르는 자리지 입력하는 자리가 아니다. */
export function isAgentCardForm(data: Pick<BubbleData, 'bubbleType' | 'customCreated' | 'agentForm' | 'trashed'> | undefined | null): boolean {
  return !!data && data.bubbleType === 'agent' && data.customCreated === true && data.agentForm === 'card' && data.trashed !== true;
}

/**
 * 버블이 보여 주는 세션과 같은 우선순위(`BubbleNode` effective sub): 도는 세션 → IDE 에서 고른 탭 → 마지막 탭 → null(서버 기본).
 * 어긋나면 친 글이 어느 세션으로 갔는지 모른다.
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

/** `projectName` 을 주면 그 프로젝트 것만 — 프로젝트 격리(§3.5)는 판정마다 지킨다. */
export function linkedAppBubblesOf(
  appBubbles: readonly AppBubble[],
  agentId: string,
  projectName?: string | null,
): AppBubble[] {
  return appBubbles
    .filter((b) => (projectName ? b.projectName === projectName : true) && (b.linkedAgentIds ?? []).includes(agentId))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** 지문으로 구독한다(배열은 매 스냅샷 새 참조라 헛 렌더). 좌표는 넣지 않는다 — 앱 노드를 끄는 매 프레임 말풍선이 깨면 안 된다. */
export function linkedAppBubblesKey(
  appBubbles: readonly AppBubble[],
  agentId: string,
  projectName?: string | null,
): string {
  return linkedAppBubblesOf(appBubbles, agentId, projectName)
    .map((b) => `${b.id}\u0001${b.appId}\u0001${b.title ?? ''}\u0001${b.file ?? ''}`)
    .join('\u0002');
}

/** 끝점 둘이 화면에 있을 때만 만든다(없으면 React Flow 가 고아 선을 경고한다). */
export interface RefLinkPair {
  id: string;
  agentId: string;
  appBubbleId: string;
}

export function refLinkPairs(
  appBubbles: readonly AppBubble[],
  visibleAgentIds: ReadonlySet<string>,
  projectName?: string | null,
  /** §5.4 #36 (H) ① — 연결선을 감춘 에이전트들. 그 에이전트의 줄과, 노드에서 감춘(`linksHidden`) 줄은 만들지 않는다. */
  hiddenAgentIds?: ReadonlySet<string>,
): RefLinkPair[] {
  const out: RefLinkPair[] = [];
  for (const b of appBubbles) {
    if (projectName && b.projectName !== projectName) continue;
    for (const agentId of b.linkedAgentIds ?? []) {
      if (!visibleAgentIds.has(agentId)) continue;
      // 판정은 `linkView.ts` 한 벌 — 메뉴·캔버스·앱 노드가 같은 답을 낸다. 연결(`linkedAgentIds`)은 그대로다.
      if (!refLinkVisible(agentId, b, hiddenAgentIds)) continue;
      out.push({ id: `ref-${agentId}-${b.id}`, agentId, appBubbleId: b.id });
    }
  }
  return out;
}

/** 위성줄 목록의 지문 — 이 문자열이 바뀔 때만 선을 다시 짓는다(앱 노드는 드래그 중 매 프레임 좌표가 바뀐다). */
export function refLinkPairsKey(pairs: readonly RefLinkPair[]): string {
  return pairs.map((p) => p.id).join('|');
}

// ─── (C) 노드가 결과를 받는다 — 위성 칩이 명령에 붙이는 것 ───

/** 보낼 때 본문에 붙는 앱 노드 하나의 사실. 이름·확장자는 레지스트리에서 꺼낸 값이다. */
export interface LinkedOutputNode {
  executionRequirements?: CommandExecutionRequirements & { runLimits?: CreationRunLimits };
  id: string;
  /** 앱의 제품 이름(브랜드 — 번역 대상 ❌). */
  appName: string;
  /** 노드에 보이는 이름(사용자 제목 → 담긴 파일 이름 → 앱 이름). */
  label: string;
  /** 그 노드가 받는 확장자(소문자, 마침표 포함). 비면 "아무 파일". */
  accepts: readonly string[];
  /** 지금 담긴 파일(루트 기준 상대 경로). */
  file?: string | undefined;
  /** §5.4 #36 (C) — 앱 몫 브리프(레지스트리 `agentBrief`). 있으면 공통 `/output` 문구 대신 이것이 노드를 말한다(영상 노드는 작업 문서다). */
  brief?: string | undefined;
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

/** 에이전트에게 주는 규약이라 영어다. 자격 증명 값은 싣지 않는다 — 환경 변수 이름만(값은 이미 세션 환경에 있다). */
export function buildLinkedOutputBrief(nodes: readonly LinkedOutputNode[]): string {
  if (nodes.length === 0) return '';
  // 앱이 자기 브리프를 낸 노드(작업 문서)와 공통 문구를 받는 노드(결과 파일)를 가른다 — 공통 납품 문구는 공통 노드가
  //   있을 때만 붙는다. 작업 문서 노드에 "파일을 만들어 넣어라"를 함께 붙이면 에이전트가 다시 완성 파일을 굽는다.
  const fileNodes = nodes.filter((n) => !n.brief);
  const briefNodes = nodes.filter((n) => !!n.brief);
  const fileLines = fileNodes.map((n) => {
    const accepts = n.accepts.length > 0 ? n.accepts.join(' ') : 'any file';
    const holds = n.file ? JSON.stringify(n.file) : 'nothing yet';
    return `- node ${n.id} · ${n.appName} ${JSON.stringify(n.label)} · accepts ${accepts} · holds ${holds}`;
  });
  const lines = [
    '---',
    `${LINKED_OUTPUT_MARK}: the user linked these canvas nodes to you. Put the results this request asks for into them.`,
    ...fileLines,
  ];
  if (fileNodes.length > 0) {
    lines.push(
      'To deliver a result: create the file inside this project, then POST "$VIBISUAL_BASE/api/app-bubbles/<node id>/output" with the header "x-vibisual-hook-token: $VIBISUAL_TOKEN" (or $VIBISUAL_HOOK_AUTH) and JSON {"file":"<path relative to the project root>"}.',
      'Report a node as delivered only after that call returns {"ok":true}.',
    );
  }
  for (const n of briefNodes) lines.push((n.brief ?? '').trim());
  lines.push('Never print the token or put it in a URL. If the connection values are unavailable, say so instead of guessing.');
  return lines.join('\n');
}

/** 본문 + 블록. 켜진 노드가 없거나 본문이 이미 블록을 갖고 있으면 본문 그대로다(두 번 붙지 않게). */
export function withLinkedOutputBrief(text: string, nodes: readonly LinkedOutputNode[]): string {
  const brief = buildLinkedOutputBrief(nodes);
  if (!brief || text.includes(LINKED_OUTPUT_MARK)) return text;
  return `${text.trimEnd()}\n\n${brief}`;
}

// ─── 기하 — 말풍선의 실루엣 · 위성줄 · 꽃잎 ───

/** 원(접혀 남은 버블)의 중심 — 노드 좌표계(좌상단 원점). 전환 때 버블 중심을 이 점에 맞춘다. */
export function agentCardDiscCenter(): { x: number; y: number } {
  return {
    x: AGENT_CARD.balloonWidth + AGENT_CARD.balloonGap + AGENT_CARD.discSize / 2,
    y: AGENT_CARD.height / 2,
  };
}

/** 궤도 위 한 각(도, 화면 좌표 — 0 = 오른쪽, 음수 = 위)의 자리 — 원 중심 기준 오프셋. */
export function orbitPoint(angleDeg: number, radius: number = AGENT_CARD.orbitRadius): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
}

/** 궤도에 찍을 이어진 앱 점들의 각(도). 상한을 넘는 것은 찍지 않는다 — 전부는 위성 칩 줄이 말한다. */
export function orbitDotAngles(count: number): number[] {
  const n = Math.max(0, Math.min(count, AGENT_CARD.orbitDotMax));
  return Array.from({ length: n }, (_, i) => AGENT_CARD.orbitDotStartDeg + i * AGENT_CARD.orbitDotStepDeg);
}

/** 반직선이 사각 테두리와 만나는 거리 — 원 반지름으로 사각을 재면 가로로 오는 선이 판 안에서 끊긴다. */
export function rectBorderDistance(halfW: number, halfH: number, nx: number, ny: number): number {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const tx = ax > 1e-6 ? halfW / ax : Number.POSITIVE_INFINITY;
  const ty = ay > 1e-6 ? halfH / ay : Number.POSITIVE_INFINITY;
  const t = Math.min(tx, ty);
  return Number.isFinite(t) ? t : Math.max(halfW, halfH);
}

/** 정사각이 아닌 노드인가(말풍선·앱 노드). 1px 은 측정 반올림으로 본다. */
export function isRectNode(width: number, height: number): boolean {
  return Math.abs(width - height) > 1;
}

/** 말풍선 노드의 경계 상자인가 — 고정 크기라 크기로 가린다(1px 은 측정 반올림). */
export function isAgentCardBox(width: number, height: number): boolean {
  return Math.abs(width - AGENT_CARD.width) <= 1 && Math.abs(height - AGENT_CARD.height) <= 1;
}

/**
 * 말풍선 + 궤도 원 실루엣을 마지막으로 빠져나가는 거리(경계 상자로 끊으면 원 위·아래에서 선이 허공에 멈춘다).
 * 가운데가 말풍선 안이라 "말풍선을 나가는 거리"와 "궤도 원을 나가는 먼 쪽 거리" 중 큰 쪽이다.
 */
export function agentCardBorderDistance(nx: number, ny: number): number {
  const cx = AGENT_CARD.width / 2;
  const cy = AGENT_CARD.height / 2;
  // ① 말풍선 [0, balloonWidth] × [0, height] — 안에서 나가는 거리.
  const tx = nx > 1e-9 ? (AGENT_CARD.balloonWidth - cx) / nx : nx < -1e-9 ? -cx / nx : Number.POSITIVE_INFINITY;
  const ty = ny > 1e-9 ? (AGENT_CARD.height - cy) / ny : ny < -1e-9 ? -cy / ny : Number.POSITIVE_INFINITY;
  const balloon = Math.min(tx, ty);
  // ② 궤도 원 — |C + t·n − D|² = R² 의 큰 근(t² + 2bt + c = 0).
  const d = agentCardDiscCenter();
  const fx = cx - d.x;
  const fy = cy - d.y;
  const b = fx * nx + fy * ny;
  const c = fx * fx + fy * fy - AGENT_CARD.orbitRadius * AGENT_CARD.orbitRadius;
  const disc = b * b - c;
  const orbit = disc >= 0 ? -b + Math.sqrt(disc) : 0;
  return Math.max(Number.isFinite(balloon) ? balloon : 0, orbit);
}

/** 말풍선 = 실루엣, 정사각(버블) = 원, 그 밖(앱 노드) = 테두리. 선 끝점 세 곳(`CurvedEdge`·`TaskEdgeComponent`·`RefLinkEdge`)이 이 함수 하나를 쓴다. */
export function nodeBorderDistance(width: number, height: number, nx: number, ny: number): number {
  if (isAgentCardBox(width, height)) return agentCardBorderDistance(nx, ny);
  if (!isRectNode(width, height)) return Math.min(width, height) / 2;
  return rectBorderDistance(width / 2, height / 2, nx, ny);
}

/** 노드 상자(중심·반폭·반높이) — 선 끝점을 재는 단위. */
export interface NodeBox {
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
}

/** 원 하나(중심·반지름) — 위성줄이 나가는 자리. */
export interface OrbitOrigin {
  x: number;
  y: number;
  r: number;
}

/** 말풍선이면 원 중심 + 궤도 반지름에서 나온다(줄은 말풍선이 아니라 에이전트에서), 버블이면 그 원. */
export function refLinkOrigin(src: NodeBox): OrbitOrigin {
  if (isAgentCardBox(src.halfW * 2, src.halfH * 2)) {
    const d = agentCardDiscCenter();
    return { x: src.cx - src.halfW + d.x, y: src.cy - src.halfH + d.y, r: AGENT_CARD.orbitRadius };
  }
  return { x: src.cx, y: src.cy, r: Math.min(src.halfW, src.halfH) };
}

/** 원 둘레에서 `(x, y)` 쪽을 향한 점. 손이 원 중심 위에 있으면 오른쪽 점. */
export function pointOnOrbitToward(o: OrbitOrigin, x: number, y: number): { x: number; y: number } {
  const dx = x - o.x;
  const dy = y - o.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: o.x + o.r, y: o.y };
  return { x: o.x + (dx / len) * o.r, y: o.y + (dy / len) * o.r };
}

/** 두 끝 모두 원 중심 ↔ 앱 노드 중심 직선 위다(옆구리에서 옆구리로 ❌). */
export function refLinkEnds(src: NodeBox, dst: NodeBox): { sx: number; sy: number; tx: number; ty: number } {
  const o = refLinkOrigin(src);
  const dx = dst.cx - o.x;
  const dy = dst.cy - o.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;
  const reach = nodeBorderDistance(dst.halfW * 2, dst.halfH * 2, -nx, -ny);
  return { sx: o.x + nx * o.r, sy: o.y + ny * o.r, tx: dst.cx - nx * reach, ty: dst.cy - ny * reach };
}

/** 위성줄 경로 — 두 끝을 잇는 직선에서 아래로 처진 2차 곡선. */
export interface RefLinkGeometry {
  path: string;
  /** 곡선의 한가운데(t=0.5) — [연결 끊기] 단추 자리. */
  midX: number;
  midY: number;
}

/** 줄의 처짐(px) — 길이에 비례하되 하한·상한 사이(짧은 줄도 줄로 보이고, 긴 줄이 바닥까지 늘어지지 않게). */
export function refLinkSag(length: number): number {
  return Math.min(REF_LINK_STYLE.sagMax, Math.max(REF_LINK_STYLE.sagMin, length * REF_LINK_STYLE.sagRatio));
}

export function refLinkPath(sx: number, sy: number, tx: number, ty: number): RefLinkGeometry {
  const sag = refLinkSag(Math.hypot(tx - sx, ty - sy));
  const qx = (sx + tx) / 2;
  const qy = (sy + ty) / 2 + sag;
  // 2차 베지어 t=0.5 = (P0 + 2·Q + P2) / 4 — 직선 가운데에서 처짐의 절반만큼 아래.
  return {
    path: `M ${sx},${sy} Q ${qx},${qy} ${tx},${ty}`,
    midX: (sx + 2 * qx + tx) / 4,
    midY: (sy + 2 * qy + ty) / 4,
  };
}

// ─── 꽃잎 고르기 — 놓은 자리에 앱들이 핀다 ───

/** `facing` 은 라디안(화면 좌표 — 0 = 오른쪽, π/2 = 아래). 좌우 같은 간격으로 펴고, 많으면 `maxSpreadDeg` 안으로 좁힌다. */
export function bloomPetalOffsets(count: number, facing: number): { dx: number; dy: number }[] {
  if (count <= 0) return [];
  const stepDeg = count > 1 ? Math.min(REF_BLOOM.stepDeg, REF_BLOOM.maxSpreadDeg / (count - 1)) : 0;
  const step = (stepDeg * Math.PI) / 180;
  const first = facing - (step * (count - 1)) / 2;
  return Array.from({ length: count }, (_, i) => {
    const a = first + step * i;
    return { dx: Math.cos(a) * REF_BLOOM.radius, dy: Math.sin(a) * REF_BLOOM.radius };
  });
}

/**
 * 꽃 전체(가운데 고리 + 꽃잎)가 화면 안에 들도록 가운데를 안쪽으로 민다. 화면이 꽃보다 작으면 왼쪽·위를 지킨다.
 */
export function clampBloomCenter(
  x: number,
  y: number,
  offsets: readonly { dx: number; dy: number }[],
  viewW: number,
  viewH: number,
): { x: number; y: number } {
  const pad = REF_BLOOM.seedSize / 2 + REF_BLOOM.margin;
  let minDx = 0;
  let maxDx = 0;
  let minDy = 0;
  let maxDy = 0;
  for (const o of offsets) {
    minDx = Math.min(minDx, o.dx);
    maxDx = Math.max(maxDx, o.dx);
    minDy = Math.min(minDy, o.dy);
    maxDy = Math.max(maxDy, o.dy);
  }
  return {
    x: Math.max(pad - minDx, Math.min(x, viewW - pad - maxDx)),
    y: Math.max(pad - minDy, Math.min(y, viewH - pad - maxDy)),
  };
}

/** 꽃 아래 이름이 화면 밖으로 반쯤 나가지 않게 이름의 가로 가운데만 안쪽으로 민다(`clampBloomCenter` 는 꽃잎만 본다). 화면보다 넓으면 가운데. */
export function clampCaptionCenterX(x: number, width: number, viewW: number, margin: number): number {
  const half = width / 2;
  const min = margin + half;
  const max = viewW - margin - half;
  if (min > max) return viewW / 2;
  return Math.max(min, Math.min(x, max));
}

/** 한 축 — 그 구간이 [margin, view - margin] 안에 들도록 옮길 양. 구간이 화면보다 크면 앞(왼쪽·위)을 맞춘다. */
function axisShiftToShow(start: number, length: number, view: number, margin: number): number {
  if (length + margin * 2 > view) return margin - start;
  if (start < margin) return margin - start;
  const overflow = start + length - (view - margin);
  return overflow > 0 ? -overflow : 0;
}

/** 모자란 만큼만 옮긴다 — 다 보이면 `null`(고를 때마다 출렁이지 않게). 줌은 건드리지 않는다. */
export function viewportShiftToShow(
  rect: { x: number; y: number; width: number; height: number },
  viewport: { x: number; y: number; zoom: number },
  view: { width: number; height: number },
  margin: number,
): { dx: number; dy: number } | null {
  const sx = rect.x * viewport.zoom + viewport.x;
  const sy = rect.y * viewport.zoom + viewport.y;
  const dx = axisShiftToShow(sx, rect.width * viewport.zoom, view.width, margin);
  const dy = axisShiftToShow(sy, rect.height * viewport.zoom, view.height, margin);
  return dx === 0 && dy === 0 ? null : { dx, dy };
}
