/**
 * §5.23 웹 버블 묶기 — `getSnapshot` 이 싣기 직전에 에이전트별로 호스트 버블을 묶는다(`AppState.webGroup`): (A) 같은 사이트 (B) 비슷한 종류 (C) 에이전트마다 최대 N개.
 * 실어 보내는 모양만 바꾼다 — 장부·`domainEntries`·체크포인트는 그대로라 끄면 다음 스냅샷에서 원래대로 돌아온다.
 * 에이전트마다 따로 판정하고, 읽은 에이전트 모두가 묶은 호스트만 화면에서 빠진다. 고정한 호스트는 묶지도 세지도 않고, 구성원 하나인 묶음은 만들지 않는다.
 * **입력 배열·객체를 고치지 않는다** — 서버가 스냅샷 객체를 200ms 캐시해 되돌려 주므로 고치면 다음 호출이 오염된다.
 */
import { WEB_GROUP_DEFAULTS, WEB_GROUP_MAX_BOUNDS, WEB_KEY_MARK, WEB_KINDS } from './constants.js';
import type {
  ActivityEdge,
  BubbleData,
  NodeStatus,
  WebFoldHost,
  WebFoldInfo,
  WebFoldScope,
  WebGroupSettings,
  WebKind,
} from './types.js';
import { webKindOfHost, webKindOfSite, webSiteOf } from './webHostKind.js';
import { webHostFromNodeKey } from './webToolEntry.js';

/** 접힌 버블 id 의 머리 — 뒤에 에이전트 id 가 붙는다. */
export const WEB_FOLD_ID_PREFIX = 'webfold-';
/**
 * 묶음 id 의 칸 구분자. URL 경로에 그대로 실리는 글자라 고른다 — 단일 지우기(`DELETE /api/bubble/:id`)는 id 를
 * 인코딩하지 않아 `/` 를 쓰면 경로가 갈라진다. 에이전트 버블 id(`agent-<숫자>`)와 호스트에는 `~` 가 올 수 없다.
 */
export const WEB_FOLD_ID_SEPARATOR = '~';

/** 묶음의 이름표 — 없으면 그 에이전트의 나머지(또는 전부) 묶음이다. */
export type WebFoldPart = { site: string } | { kind: WebKind };

/**
 * 접힌 버블 id 를 만든다. 조립은 여기 한 곳.
 * - 나머지·전부: `webfold-<에이전트>` (종전 접어 보기 id 그대로)
 * - 사이트: `webfold-<에이전트>~site~<사이트>` · 종류: `webfold-<에이전트>~kind~<종류>`
 */
export function webFoldId(agentId: string, part?: WebFoldPart): string {
  const head = `${WEB_FOLD_ID_PREFIX}${agentId}`;
  if (!part) return head;
  const sep = WEB_FOLD_ID_SEPARATOR;
  return 'site' in part ? `${head}${sep}site${sep}${part.site}` : `${head}${sep}kind${sep}${part.kind}`;
}

/** 접힌 버블 id 에서 에이전트 id 를 되꺼낸다. 접힌 버블 id 가 아니면 `null`. 해체도 여기 한 곳. */
export function webFoldAgentId(id: string): string | null {
  if (!id.startsWith(WEB_FOLD_ID_PREFIX)) return null;
  const rest = id.slice(WEB_FOLD_ID_PREFIX.length);
  const cut = rest.indexOf(WEB_FOLD_ID_SEPARATOR);
  const agentId = cut < 0 ? rest : rest.slice(0, cut);
  return agentId.length > 0 ? agentId : null;
}

/**
 * 접힌 버블의 `path` = `__web__/<접힌 id 에서 머리를 뗀 것>`(에이전트 id 만 받아도 같다). `__web__` 표식이라 루트 패널 "표시됨" 이 행으로 만들지 않는다.
 * `/` 는 호스트에 올 수 없어(`webHostFromNodeKey` 도 거절) 이 모양은 어떤 호스트 키와도 겹치지 않는다.
 */
export function webFoldNodePath(foldIdOrAgentId: string): string {
  const key = foldIdOrAgentId.startsWith(WEB_FOLD_ID_PREFIX)
    ? foldIdOrAgentId.slice(WEB_FOLD_ID_PREFIX.length)
    : foldIdOrAgentId;
  return `${WEB_KEY_MARK}/${key}`;
}

// ─── 설정 ───

/** (C) 최대 개수 하나를 범위 안으로. 숫자로 못 읽으면 기본값. */
export function normalizeWebGroupMax(value: unknown): number {
  const n = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return WEB_GROUP_DEFAULTS.maxPerAgent;
  return Math.min(WEB_GROUP_MAX_BOUNDS.MAX, Math.max(WEB_GROUP_MAX_BOUNDS.MIN, Math.floor(n)));
}

/** 묶기 설정 정규화 — 빠진 칸·모양이 틀린 칸은 기본값(`WEB_GROUP_DEFAULTS`)으로. 정본은 여기 한 곳. */
export function normalizeWebGroupSettings(raw: unknown): WebGroupSettings {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const sameSite = r['sameSite'];
  const byKind = r['byKind'];
  return {
    sameSite: typeof sameSite === 'boolean' ? sameSite : WEB_GROUP_DEFAULTS.sameSite,
    byKind: typeof byKind === 'boolean' ? byKind : WEB_GROUP_DEFAULTS.byKind,
    maxPerAgent: normalizeWebGroupMax(r['maxPerAgent']),
  };
}

/** 이 설정이 무엇이든 묶을 수 있는가 — 셋 다 꺼져 있으면(0 · 끔 · 끔) 호스트마다 버블 하나다. */
export function isWebGroupActive(settings: WebGroupSettings): boolean {
  return settings.sameSite || settings.byKind || settings.maxPerAgent > 0;
}

/** 두 설정이 같은가 — 바뀐 것이 없으면 판을 올리지 않으려고 쓴다. */
export function sameWebGroupSettings(a: WebGroupSettings, b: WebGroupSettings): boolean {
  return a.sameSite === b.sameSite && a.byKind === b.byKind && a.maxPerAgent === b.maxPerAgent;
}

// ─── 묶기 ───

/** 접힌 버블 하나가 대신한 것. 지우기가 속한 호스트로 풀릴 때 서버가 이 목록을 쓴다. */
export interface WebFoldGroup {
  agentId: string;
  /** 접힌 호스트 노드 id — 최신이 앞. */
  hostIds: string[];
  /** 무엇으로 묶었나. */
  scope: WebFoldScope;
}

export interface WebFoldInput {
  /** 이번 스냅샷의 최상위 버블(이미 생존 필터를 거친 복사본). */
  topFolders: BubbleData[];
  edges: ActivityEdge[];
  /** 이번 스냅샷에 실리는 에이전트 id. 이 밖의 에이전트와만 이어진 호스트는 묶지 않는다. */
  agentIds: ReadonlySet<string>;
  /** 호스트 노드 id → 그 호스트에 쌓인 항목 수. */
  entryCount: (nodeId: string) => number;
  /**
   * 호스트 노드 id → 그 호스트에서 읽은 주소(**최신이 앞**). (B) 종류를 경로로 가르는 근거다.
   * 없으면 경로를 보지 않는다(표에 있는 사이트만 종류가 선다).
   */
  urlsOf?: (nodeId: string) => readonly string[];
  /** 접힌 버블 id → 사용자가 옮겨 둔 자리. 없으면 최신 호스트의 자리를 물려받는다. */
  positionOf?: (foldId: string) => { x: number; y: number } | undefined;
}

export interface WebFoldResult {
  topFolders: BubbleData[];
  edges: ActivityEdge[];
  /** 접힌 버블 id → 대신한 호스트들. 묶은 것이 없으면 비어 있고, 그때 두 배열은 입력 그대로다. */
  folds: Map<string, WebFoldGroup>;
}

/** 묶을 수 있는 호스트 버블인가 — 도메인이고, 고정하지 않았고, 이미 접힌 버블이 아니다. */
function isFoldableHost(node: BubbleData): boolean {
  return node.bubbleType === 'domain' && !node.pinned && !node.preservePinned && !node.webFold;
}

/** 호스트 버블의 호스트 — 라벨은 사용자가 바꿀 수 있어 노드 키(`__web__<호스트>`)를 먼저 믿는다. */
function hostOf(node: BubbleData): string {
  return webHostFromNodeKey(node.path) ?? node.label;
}

/** 최신이 앞 — 마지막 활동 시각이 같으면 라벨·id 순으로 고정한다(스냅샷마다 순서가 흔들리지 않게). */
function compareLatestFirst(a: BubbleData, b: BubbleData): number {
  const diff = (b.lastActivity ?? 0) - (a.lastActivity ?? 0);
  if (diff !== 0) return diff;
  if (a.label !== b.label) return a.label < b.label ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** (A) 를 거친 한 단위 — 같은 사이트면 사이트 하나, (A) 를 끄면 호스트 하나. */
interface Unit {
  key: string;
  site: string;
  /** 구성원 호스트 — 최신이 앞. */
  hosts: BubbleData[];
  lastActivity: number;
  entries: number;
}

/** 단위도 최신이 앞 — 같으면 많이 읽은 쪽, 그다음 키 순(흔들리지 않게). */
function compareUnits(a: Unit, b: Unit): number {
  if (a.lastActivity !== b.lastActivity) return b.lastActivity - a.lastActivity;
  if (a.entries !== b.entries) return b.entries - a.entries;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function buildUnits(members: readonly BubbleData[], settings: WebGroupSettings, input: WebFoldInput): Unit[] {
  const byKey = new Map<string, Unit>();
  for (const m of members) {
    const site = webSiteOf(hostOf(m));
    const key = settings.sameSite ? `site:${site}` : `host:${m.id}`;
    let unit = byKey.get(key);
    if (!unit) {
      unit = { key, site, hosts: [], lastActivity: 0, entries: 0 };
      byKey.set(key, unit);
    }
    unit.hosts.push(m);
    unit.lastActivity = Math.max(unit.lastActivity, m.lastActivity ?? 0);
    unit.entries += input.entryCount(m.id);
  }
  return [...byKey.values()].sort(compareUnits);
}

/** 한 에이전트 몫의 화면 칸 — 따로 서는 단위이거나, 단위 여럿을 묶은 묶음이다. */
type PlanItem =
  | { type: 'unit'; unit: Unit }
  | { type: 'bucket'; scope: 'kind' | 'rest' | 'agent'; kind?: WebKind; units: Unit[] };

interface Bucket {
  scope: 'kind' | 'rest';
  kind?: WebKind;
  units: Unit[];
}

/**
 * 한 에이전트의 단위들을 화면 칸으로 나눈다(§5.23 묶기 (B)(C)).
 *
 * - N=0: (B) 가 켜져 있으면 구성원 둘 이상인 종류만 묶고, 나머지는 따로 선다. 꺼져 있으면 전부 따로.
 * - 단위 수 ≤ N: 더 묶지 않는다.
 * - (B) 꺼짐: 최근 N−1 단위가 따로 서고 나머지가 한 묶음.
 * - (B) 켜짐: 종류 묶음(구성원 많은 종류부터)과 "그 밖의 웹"이 N 을 넘지 않게 세우고, 남은 자리에 최근 단위부터 따로 세운다.
 *   구성원이 하나 남은 묶음은 그 단위로 선다(개수는 같고 이름이 정확하다).
 */
function planAgent(units: Unit[], settings: WebGroupSettings, kindOf: (unit: Unit) => WebKind | undefined): PlanItem[] {
  const max = settings.maxPerAgent;
  const asUnits = (): PlanItem[] => units.map((unit) => ({ type: 'unit', unit }));

  if (max === 0) {
    if (!settings.byKind) return asUnits();
    const byKind = new Map<WebKind, Unit[]>();
    for (const u of units) {
      const kind = kindOf(u);
      if (!kind) continue;
      const list = byKind.get(kind);
      if (list) list.push(u);
      else byKind.set(kind, [u]);
    }
    const items: PlanItem[] = [];
    const emitted = new Set<WebKind>();
    for (const u of units) {
      const kind = kindOf(u);
      const group = kind ? byKind.get(kind) : undefined;
      if (!kind || !group || group.length < 2) {
        items.push({ type: 'unit', unit: u });
        continue;
      }
      if (emitted.has(kind)) continue;
      emitted.add(kind);
      items.push({ type: 'bucket', scope: 'kind', kind, units: group });
    }
    return items;
  }

  if (units.length <= max) return asUnits();

  if (!settings.byKind) {
    const head: PlanItem[] = units.slice(0, max - 1).map((unit) => ({ type: 'unit', unit }));
    return [...head, { type: 'bucket', scope: head.length === 0 ? 'agent' : 'rest', units: units.slice(max - 1) }];
  }

  // (B) 종류 묶음 — **많이 읽은 종류부터**(읽은 항목 수 → 호스트 수 → 최근 → 정본 순서). 단위(사이트) 수로 세면
  //   호스트 여럿을 품은 사이트 하나(`github.com`)나 검색 의사 호스트처럼 자주 쓰는 한 곳이 작은 종류로 밀려난다.
  const named = new Map<WebKind, Unit[]>();
  const rest: Unit[] = [];
  for (const u of units) {
    const kind = kindOf(u);
    if (!kind) {
      rest.push(u);
      continue;
    }
    const list = named.get(kind);
    if (list) list.push(u);
    else named.set(kind, [u]);
  }
  const weight = (list: readonly Unit[]): { reads: number; hosts: number; recent: number } => ({
    reads: list.reduce((n, u) => n + u.entries, 0),
    hosts: list.reduce((n, u) => n + u.hosts.length, 0),
    recent: list[0]!.lastActivity,
  });
  const ranked = [...named.entries()]
    .map(([kind, list]) => ({ kind, list, w: weight(list) }))
    .sort((a, b) =>
      (b.w.reads - a.w.reads)
      || (b.w.hosts - a.w.hosts)
      || (b.w.recent - a.w.recent)
      || (WEB_KINDS.indexOf(a.kind) - WEB_KINDS.indexOf(b.kind)))
    .map(({ kind, list }): [WebKind, Unit[]] => [kind, list]);
  while (ranked.length > 0 && ranked.length + (rest.length > 0 ? 1 : 0) > max) {
    rest.push(...ranked.pop()![1]);
  }
  rest.sort(compareUnits);
  const buckets: Bucket[] = ranked.map(([kind, list]) => ({ scope: 'kind', kind, units: list }));
  if (rest.length > 0) buckets.push({ scope: 'rest', units: rest });

  // 남은 자리 — 최근 단위부터 따로 세운다. 구성원이 둘 이상 남은 묶음에서만 꺼낸다(하나 남은 묶음은 어차피 그 단위로 선다).
  const bucketOf = new Map<Unit, Bucket>();
  for (const b of buckets) for (const u of b.units) bucketOf.set(u, b);
  const remaining = new Map<Bucket, number>(buckets.map((b) => [b, b.units.length]));
  const promoted = new Set<Unit>();
  let slots = max - buckets.length;
  for (const u of units) {
    if (slots <= 0) break;
    const b = bucketOf.get(u)!;
    const left = remaining.get(b)!;
    if (left < 2) continue;
    promoted.add(u);
    remaining.set(b, left - 1);
    slots--;
  }

  const items: PlanItem[] = [];
  const emitted = new Set<Bucket>();
  for (const u of units) {
    const b = bucketOf.get(u)!;
    if (promoted.has(u) || remaining.get(b)! < 2) {
      items.push({ type: 'unit', unit: u });
      continue;
    }
    if (emitted.has(b)) continue;
    emitted.add(b);
    items.push({
      type: 'bucket',
      scope: b.scope,
      ...(b.kind !== undefined ? { kind: b.kind } : {}),
      units: b.units.filter((x) => !promoted.has(x)),
    });
  }
  // 그 에이전트의 전부를 품은 나머지 묶음은 "그 밖"이 아니라 "웹" 이다.
  const only = items.length === 1 ? items[0] : undefined;
  if (only && only.type === 'bucket' && only.scope === 'rest') items[0] = { ...only, scope: 'agent' };
  return items;
}

/** 묶음 하나 → 접힌 버블 하나. 구성원은 최신이 앞이어야 한다. */
function buildFoldNode(
  foldId: string,
  agentId: string,
  members: readonly BubbleData[],
  info: { scope: WebFoldScope; site?: string; kind?: WebKind },
  input: WebFoldInput,
): BubbleData {
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

  const webFold: WebFoldInfo = { agentId, hosts, scope: info.scope };
  if (info.site !== undefined) webFold.site = info.site;
  if (info.kind !== undefined) webFold.kind = info.kind;

  const status: NodeStatus = anyActive ? 'active' : latest.status;
  const position = input.positionOf?.(foldId) ?? latest.position;
  const fold: BubbleData = {
    id: foldId,
    // 서버에는 i18n 런타임이 없다 — 라벨은 사이트 묶음이면 사이트, 아니면 최신 호스트로 두고, 제목("문서"·"웹")과
    //   "도메인 N곳"은 클라가 번역한다(`webFoldTitle`).
    label: info.scope === 'site' && info.site !== undefined ? info.site : latest.label,
    bubbleType: 'domain',
    path: webFoldNodePath(foldId),
    status,
    activity,
    childCount: 0,
    webFold,
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

/** (에이전트, 호스트) 짝 키 — 그 에이전트가 그 호스트를 묶었나. */
function pairKey(agentId: string, hostId: string): string {
  return `${agentId}\u0000${hostId}`;
}

/**
 * 호스트 버블들을 설정대로 묶는다. 접힌 버블은 첫 구성원 자리(배열 순서)에 서고(그리기 순서 고정), 묶인 호스트의 엣지 대신 에이전트로 가는 읽기 엣지 하나가 선다.
 * 묶을 것이 없으면 입력 배열을 그대로 돌려준다.
 */
export function groupWebBubbles(input: WebFoldInput, settingsRaw: WebGroupSettings): WebFoldResult {
  const { topFolders, edges, agentIds } = input;
  const unchanged: WebFoldResult = { topFolders, edges, folds: new Map() };
  const settings = normalizeWebGroupSettings(settingsRaw);
  if (!isWebGroupActive(settings)) return unchanged;

  const candidates = new Map<string, BubbleData>();
  for (const node of topFolders) {
    if (isFoldableHost(node)) candidates.set(node.id, node);
  }
  if (candidates.size === 0) return unchanged;

  // 에이전트 → 이어진 호스트들 · (에이전트, 호스트) → 그 사이 엣지들 · 호스트 → 읽은 에이전트들.
  // 엣지 방향은 가리지 않는다(읽기는 호스트 → 에이전트).
  const hostsByAgent = new Map<string, Set<string>>();
  const edgesByPair = new Map<string, ActivityEdge[]>();
  const readersByHost = new Map<string, Set<string>>();
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
    let readers = readersByHost.get(hostId);
    if (!readers) { readers = new Set(); readersByHost.set(hostId, readers); }
    readers.add(agentId);
    const key = pairKey(agentId, hostId);
    const list = edgesByPair.get(key);
    if (list) list.push(edge);
    else edgesByPair.set(key, [edge]);
  }
  if (hostsByAgent.size === 0) return unchanged;

  // 종류는 비싸지 않지만 스냅샷마다 돈다 — 단위마다 한 번만 잰다.
  const urlsOf = input.urlsOf;
  const kindMemo = new Map<Unit, WebKind | undefined>();
  const kindOf = (unit: Unit): WebKind | undefined => {
    if (kindMemo.has(unit)) return kindMemo.get(unit);
    const kind = unit.hosts.length === 1
      ? webKindOfHost(hostOf(unit.hosts[0]!), urlsOf?.(unit.hosts[0]!.id) ?? [])
      : webKindOfSite(unit.site, unit.hosts.map((h) => ({ host: hostOf(h), urls: urlsOf?.(h.id) ?? [] })));
    kindMemo.set(unit, kind);
    return kind;
  };

  const folds = new Map<string, WebFoldGroup>();
  const foldNodes = new Map<string, BubbleData>();
  const foldEdges: ActivityEdge[] = [];
  const foldsByHost = new Map<string, string[]>();
  const foldedPairs = new Set<string>();
  for (const [agentId, hostSet] of hostsByAgent) {
    const members = [...hostSet].map((id) => candidates.get(id)!).sort(compareLatestFirst);
    const units = buildUnits(members, settings, input);
    for (const item of planAgent(units, settings, kindOf)) {
      let foldId: string;
      let hosts: BubbleData[];
      let info: { scope: WebFoldScope; site?: string; kind?: WebKind };
      if (item.type === 'unit') {
        // 호스트 하나짜리 단위는 그 호스트가 제 버블로 선다 — 묶을 것이 없다.
        if (item.unit.hosts.length < 2) continue;
        foldId = webFoldId(agentId, { site: item.unit.site });
        hosts = item.unit.hosts;
        info = { scope: 'site', site: item.unit.site };
      } else {
        hosts = item.units.flatMap((u) => u.hosts).sort(compareLatestFirst);
        if (item.scope === 'kind' && item.kind !== undefined) {
          foldId = webFoldId(agentId, { kind: item.kind });
          info = { scope: 'kind', kind: item.kind };
        } else {
          foldId = webFoldId(agentId);
          info = { scope: item.scope === 'kind' ? 'rest' : item.scope };
        }
      }

      foldNodes.set(foldId, buildFoldNode(foldId, agentId, hosts, info, input));
      folds.set(foldId, { agentId, hostIds: hosts.map((h) => h.id), scope: info.scope });
      for (const h of hosts) {
        const owners = foldsByHost.get(h.id);
        if (owners) owners.push(foldId);
        else foldsByHost.set(h.id, [foldId]);
        foldedPairs.add(pairKey(agentId, h.id));
      }

      // 접힌 버블의 화살표 하나 — 가장 최근 구성원 엣지의 라벨·시각을 따르고, 하나라도 켜져 있으면 켜진다.
      let newest: ActivityEdge | null = null;
      let anyActive = false;
      for (const h of hosts) {
        for (const e of edgesByPair.get(pairKey(agentId, h.id)) ?? []) {
          if (newest === null || e.timestamp > newest.timestamp) newest = e;
          if (e.isActive) anyActive = true;
        }
      }
      if (newest !== null) {
        foldEdges.push({
          id: `${agentId}-${foldId}-read`,
          source: foldId,
          target: agentId,
          label: newest.label,
          timestamp: newest.timestamp,
          isActive: anyActive,
        });
      }
    }
  }
  if (folds.size === 0) return unchanged;

  // 읽은 에이전트 모두가 묶은 호스트만 화면에서 빠진다 — 한 에이전트라도 따로 세우면 그 호스트는 남는다.
  const hidden = new Set<string>();
  for (const [hostId, readers] of readersByHost) {
    if (!foldsByHost.has(hostId)) continue;
    let all = true;
    for (const agentId of readers) {
      if (!foldedPairs.has(pairKey(agentId, hostId))) { all = false; break; }
    }
    if (all) hidden.add(hostId);
  }

  const nextTopFolders: BubbleData[] = [];
  const placed = new Set<string>();
  for (const node of topFolders) {
    if (!hidden.has(node.id)) nextTopFolders.push(node);
    const owners = foldsByHost.get(node.id);
    if (!owners) continue;
    for (const foldId of owners) {
      if (placed.has(foldId)) continue;
      placed.add(foldId);
      nextTopFolders.push(foldNodes.get(foldId)!);
    }
  }

  const nextEdges: ActivityEdge[] = [];
  for (const edge of edges) {
    if (hidden.has(edge.source) || hidden.has(edge.target)) continue;
    // 그 에이전트가 묶은 호스트와의 화살표 — 묶음 화살표 하나가 대신한다.
    if (foldedPairs.has(pairKey(edge.source, edge.target)) || foldedPairs.has(pairKey(edge.target, edge.source))) continue;
    nextEdges.push(edge);
  }
  for (const e of foldEdges) nextEdges.push(e);

  return { topFolders: nextTopFolders, edges: nextEdges, folds };
}
