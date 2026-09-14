/**
 * webFoldView.ts — §5.23 접어 보기 · **에이전트마다 웹 버블 하나**.
 *
 * 옵션(`AppState.webFoldPerAgent`)을 켜면 서버 `getSnapshot` 이 이 함수로 한 에이전트가 읽은 호스트
 * 버블들을 버블 하나로 접어 싣는다. 바꾸는 것은 **실어 보내는 모양뿐**이다 — 노드·엣지 장부,
 * 기록(`domainEntries`), 체크포인트는 그대로라 옵션을 끄면 다음 스냅샷에서 호스트마다 버블 하나로
 * 돌아온다(기본 보기와 병행).
 *
 * 누구의 것인가는 **화살표가 정한다** — 이번 스냅샷에 실리는 에이전트와 엣지로 이어진 호스트만 접는다.
 * 두 에이전트가 같은 호스트를 읽었으면 그 호스트는 두 접힌 버블에 다 들어간다. 고정한 호스트는
 * 사용자가 따로 세워 둔 것이라 접지 않는다.
 *
 * 순수 함수 모듈이다 — 디스크 접근 ❌ · 시각 읽기 ❌ · **입력 배열과 객체를 고치지 않는다**
 * (서버는 200ms 동안 스냅샷 객체를 캐시해 되돌려 주므로, 그 객체를 고치면 다음 호출이 오염된다).
 */
import { WEB_KEY_MARK } from './constants.js';
import type { ActivityEdge, BubbleData, NodeStatus, WebFoldHost } from './types.js';

/** 접힌 버블 id 의 머리 — 뒤에 에이전트 id 가 붙는다. */
export const WEB_FOLD_ID_PREFIX = 'webfold-';

/** 접힌 버블 id 를 만든다. 조립은 여기 한 곳. */
export function webFoldId(agentId: string): string {
  return `${WEB_FOLD_ID_PREFIX}${agentId}`;
}

/** 접힌 버블 id 에서 에이전트 id 를 되꺼낸다. 접힌 버블 id 가 아니면 `null`. 해체도 여기 한 곳. */
export function webFoldAgentId(id: string): string | null {
  if (!id.startsWith(WEB_FOLD_ID_PREFIX)) return null;
  const agentId = id.slice(WEB_FOLD_ID_PREFIX.length);
  return agentId.length > 0 ? agentId : null;
}

/**
 * 접힌 버블의 `path` — `__web__/<에이전트 id>`.
 *
 * 표식(`__web__`)으로 시작하므로 루트 패널 "표시됨" 이 합성 키로 걸러 행으로 만들지 않는다.
 * `/` 를 끼우는 이유 — 호스트는 URL 파서가 뽑아 `/` 를 품을 수 없으므로(`webHostFromNodeKey` 도
 * `/` 가 든 키를 거절한다) 이 모양은 어떤 호스트 키와도 같아질 수 없다.
 */
export function webFoldNodePath(agentId: string): string {
  return `${WEB_KEY_MARK}/${agentId}`;
}

/** 접힌 버블 하나가 대신한 것. 지우기가 속한 호스트로 풀릴 때 서버가 이 목록을 쓴다. */
export interface WebFoldGroup {
  agentId: string;
  /** 접힌 호스트 노드 id — 최신이 앞. */
  hostIds: string[];
}

export interface WebFoldInput {
  /** 이번 스냅샷의 최상위 버블(이미 생존 필터를 거친 복사본). */
  topFolders: BubbleData[];
  edges: ActivityEdge[];
  /** 이번 스냅샷에 실리는 에이전트 id. 이 밖의 에이전트와만 이어진 호스트는 접지 않는다. */
  agentIds: ReadonlySet<string>;
  /** 호스트 노드 id → 그 호스트에 쌓인 항목 수. */
  entryCount: (nodeId: string) => number;
  /** 접힌 버블 id → 사용자가 옮겨 둔 자리. 없으면 최신 호스트의 자리를 물려받는다. */
  positionOf?: (foldId: string) => { x: number; y: number } | undefined;
}

export interface WebFoldResult {
  topFolders: BubbleData[];
  edges: ActivityEdge[];
  /** 접힌 버블 id → 대신한 호스트들. 접은 것이 없으면 비어 있고, 그때 두 배열은 입력 그대로다. */
  folds: Map<string, WebFoldGroup>;
}

/** 접을 수 있는 호스트 버블인가 — 도메인이고, 고정하지 않았고, 이미 접힌 버블이 아니다. */
function isFoldableHost(node: BubbleData): boolean {
  return node.bubbleType === 'domain' && !node.pinned && !node.preservePinned && !node.webFold;
}

/** 최신이 앞 — 마지막 활동 시각이 같으면 라벨·id 순으로 고정한다(스냅샷마다 순서가 흔들리지 않게). */
function compareLatestFirst(a: BubbleData, b: BubbleData): number {
  const diff = (b.lastActivity ?? 0) - (a.lastActivity ?? 0);
  if (diff !== 0) return diff;
  if (a.label !== b.label) return a.label < b.label ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 에이전트 하나가 읽은 호스트들 → 접힌 버블 하나. */
function buildFoldNode(
  agentId: string,
  members: BubbleData[],
  input: WebFoldInput,
): BubbleData {
  const foldId = webFoldId(agentId);
  const latest = members[0]!;

  let anyActive = false;
  let lastActivity = 0;
  let activity = 0;
  let readCount = 0;
  let writeCount = 0;
  const activeAgentIds = new Set<string>();
  const hosts: WebFoldHost[] = [];
  for (const m of members) {
    if (m.status === 'active') anyActive = true;
    lastActivity = Math.max(lastActivity, m.lastActivity ?? 0);
    activity = Math.max(activity, m.activity);
    // §5.24 척도의 최댓값은 노드마다 잰다 — 합하면 접힌 버블 하나가 척도를 넘어 색이 포화된다.
    readCount = Math.max(readCount, m.readCount ?? 0);
    writeCount = Math.max(writeCount, m.writeCount ?? 0);
    for (const id of m.activeAgentIds ?? []) activeAgentIds.add(id);
    hosts.push({
      id: m.id,
      host: m.label,
      entryCount: input.entryCount(m.id),
      status: m.status,
      ...(m.lastActivity !== undefined ? { lastActivity: m.lastActivity } : {}),
      ...(m.maxWebEntries !== undefined ? { maxWebEntries: m.maxWebEntries } : {}),
    });
  }

  const status: NodeStatus = anyActive ? 'active' : latest.status;
  const position = input.positionOf?.(foldId) ?? latest.position;
  const fold: BubbleData = {
    id: foldId,
    // 서버에는 i18n 런타임이 없다 — 라벨은 최신 호스트로 두고, 제목·"호스트 N곳"은 클라가 번역한다.
    label: latest.label,
    bubbleType: 'domain',
    path: webFoldNodePath(agentId),
    status,
    activity,
    childCount: 0,
    webFold: { agentId, hosts },
  };
  if (lastActivity > 0) fold.lastActivity = lastActivity;
  if (latest.lastTool !== undefined) fold.lastTool = latest.lastTool;
  if (readCount > 0) fold.readCount = readCount;
  if (writeCount > 0) fold.writeCount = writeCount;
  if (activeAgentIds.size > 0) fold.activeAgentIds = [...activeAgentIds];
  if (!anyActive && latest.fadeStartedAt !== undefined) fold.fadeStartedAt = latest.fadeStartedAt;
  if (position) fold.position = position;
  return fold;
}

/**
 * 호스트 버블들을 에이전트마다 하나로 접는다.
 *
 * - 접힌 버블은 **첫 구성원이 있던 자리**(배열 순서)에 선다 — 캔버스의 그리기 순서가 흔들리지 않게.
 * - 구성원에 닿는 엣지는 전부 빠지고, 접힌 버블마다 에이전트로 가는 읽기 엣지 **하나**가 선다.
 * - 접을 것이 없으면 입력 배열을 그대로 돌려준다(새 배열을 만들지 않는다).
 */
export function foldWebBubblesPerAgent(input: WebFoldInput): WebFoldResult {
  const { topFolders, edges, agentIds } = input;
  const candidates = new Map<string, BubbleData>();
  for (const node of topFolders) {
    if (isFoldableHost(node)) candidates.set(node.id, node);
  }
  if (candidates.size === 0) return { topFolders, edges, folds: new Map() };

  // 에이전트 → 이어진 호스트들 · 그 사이 엣지들. 엣지 방향은 가리지 않는다(읽기는 호스트 → 에이전트).
  const hostsByAgent = new Map<string, Set<string>>();
  const edgesByAgent = new Map<string, ActivityEdge[]>();
  for (const edge of edges) {
    let hostId: string | null = null;
    let agentId: string | null = null;
    if (candidates.has(edge.source) && agentIds.has(edge.target)) {
      hostId = edge.source;
      agentId = edge.target;
    } else if (candidates.has(edge.target) && agentIds.has(edge.source)) {
      hostId = edge.target;
      agentId = edge.source;
    }
    if (hostId === null || agentId === null) continue;
    let hostSet = hostsByAgent.get(agentId);
    if (!hostSet) { hostSet = new Set(); hostsByAgent.set(agentId, hostSet); }
    hostSet.add(hostId);
    const list = edgesByAgent.get(agentId);
    if (list) list.push(edge);
    else edgesByAgent.set(agentId, [edge]);
  }
  if (hostsByAgent.size === 0) return { topFolders, edges, folds: new Map() };

  const folds = new Map<string, WebFoldGroup>();
  const foldNodes = new Map<string, BubbleData>();
  const foldEdges: ActivityEdge[] = [];
  const foldsByHost = new Map<string, string[]>();
  for (const [agentId, hostSet] of hostsByAgent) {
    const members = [...hostSet].map((id) => candidates.get(id)!).sort(compareLatestFirst);
    const foldId = webFoldId(agentId);
    foldNodes.set(foldId, buildFoldNode(agentId, members, input));
    folds.set(foldId, { agentId, hostIds: members.map((m) => m.id) });
    for (const m of members) {
      const owners = foldsByHost.get(m.id);
      if (owners) owners.push(foldId);
      else foldsByHost.set(m.id, [foldId]);
    }

    // 접힌 버블의 화살표 하나 — 가장 최근 구성원 엣지의 라벨·시각을 따르고, 하나라도 켜져 있으면 켜진다.
    const memberEdges = edgesByAgent.get(agentId) ?? [];
    let newest = memberEdges[0]!;
    let anyActive = false;
    for (const e of memberEdges) {
      if (e.timestamp > newest.timestamp) newest = e;
      if (e.isActive) anyActive = true;
    }
    foldEdges.push({
      id: `${agentId}-${foldId}-read`,
      source: foldId,
      target: agentId,
      label: newest.label,
      timestamp: newest.timestamp,
      isActive: anyActive,
    });
  }

  const nextTopFolders: BubbleData[] = [];
  const placed = new Set<string>();
  for (const node of topFolders) {
    const owners = foldsByHost.get(node.id);
    if (!owners) {
      nextTopFolders.push(node);
      continue;
    }
    for (const foldId of owners) {
      if (placed.has(foldId)) continue;
      placed.add(foldId);
      nextTopFolders.push(foldNodes.get(foldId)!);
    }
  }

  const nextEdges: ActivityEdge[] = [];
  for (const edge of edges) {
    if (foldsByHost.has(edge.source) || foldsByHost.has(edge.target)) continue;
    nextEdges.push(edge);
  }
  for (const e of foldEdges) nextEdges.push(e);

  return { topFolders: nextTopFolders, edges: nextEdges, folds };
}
