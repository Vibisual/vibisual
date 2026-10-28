import type { BubbleType, NodeStatus, TidySort } from '@vibisual/shared';
import { TIDY_BAND_ORDER, TIDY_LAYOUT } from '@vibisual/shared';
import { tidyBandOf } from './tidyLayout.js';
import type { LinkEdgeRef } from './linkedBubbles.js';

/** §5.4 #33 (I) 정리 — 누구와 함께, 몇 번째로 앉나("어디에"는 `tidyLayout.ts`). 기하가 기준을 몰라야 새 기준을 표 한 줄로 늘린다(§3.3). */

/** 무리를 나눌 때 보는 버블 한 장. 기하에 필요한 지름·좌표는 여기 없다(그쪽은 `TidyItem`). */
export interface TidySortItem {
  id: string;
  bubbleType: BubbleType;
  status: NodeStatus;
  /** **`heatValueOf` 의 그 값**이어야 한다(§5.24) — 다른 자면 히트맵을 켜고 정리했을 때 색과 자리가 다른 말을 한다. */
  heat: number;
  /** 마지막 활동 시각(ms). **잰 적이 없으면 `undefined`** — 0("가장 오래전")과 다른 뜻이다. */
  lastActivity?: number;
}

/** 무리 나눔의 결과 — 누가 어느 무리이고, 무리들이 어떤 순서로 서고, 무리 안에서 누가 먼저인가. */
export interface TidyGrouping {
  /** 버블 id → 무리 키. 목록에 없는 버블은 `TIDY_GROUP_NONE` 으로 읽는다. */
  readonly groupById: ReadonlyMap<string, string>;
  /** 줄 세우기에선 위→아래(앞이 급함), 덩어리에선 채우는 순서(앞이 안쪽 — 서열이 아니라 자리 효율). */
  readonly order: readonly string[];
  /** §5.4 #33 (I-2) 무리 안 순서(작을수록 왼쪽, 줄 세우기만). 순위를 낼 수 없는 것은 넣지 않는다 — 기하가 `id` 순으로 세운다(억지 순서 ❌). */
  readonly rankById: ReadonlyMap<string, number>;
  /** §5.4 #33 (I-3) 무리 키 → 가운데 고정 버블(덩어리만). `lineage` 의 에이전트가 든다 — 가장자리면 무리의 주인이 안 보인다. `kind` 는 비어 있다. */
  readonly anchorByGroup: ReadonlyMap<string, string>;
}

/** 순위·주인이 없는 기준의 자리. 새 `TidyGrouping` 을 만들 때마다 빈 맵을 짓지 않기 위한 것. */
const NO_RANK: ReadonlyMap<string, number> = new Map();
const NO_ANCHOR: ReadonlyMap<string, string> = new Map();

/** 어느 무리에도 들지 않은 것들이 모이는 자리. **감추지 않는다** — 그것도 답의 절반이다. */
export const TIDY_GROUP_NONE = '__none__';
/** `recent` 에서 활동을 잰 적이 없는 버블 — 0 과 섞으면 "가장 오래전"으로 읽힌다(§5.4 #33 I-2). */
export const TIDY_GROUP_UNMEASURED = '__unmeasured__';
/** 분위 무리의 키 — `q0` 이 가장 뜨겁고/최근이다(동심 띠의 안쪽). */
export function tidyQuantileKey(bucket: number): string {
  return `q${bucket}`;
}

/** `lineage` 무리의 중심 종류. §5.1 #2-2 등장 영역(`spawnZoneSeating.ts`)도 이 목록을 쓴다 — 두 벌이면 정리한 중심과 새 버블의 중심이 갈린다. */
export const LINEAGE_HUB_TYPES: ReadonlySet<BubbleType> = new Set<BubbleType>(['agent', 'auto', 'pipeline']);

/** 연속값을 **순위로** 자른다(절대 기준이면 롱테일로 한 칸에 몰린다, §5.24). **동점은 반드시 같은 칸** — 인덱스로 자르면 같은 값이 갈린다. */
function quantileGroups(
  entries: readonly { id: string; value: number }[],
  groupById: Map<string, string>,
  rankById: Map<string, number>,
): string[] {
  if (entries.length === 0) return [];
  const sorted = [...entries].sort((a, b) => (b.value - a.value) || (a.id < b.id ? -1 : 1));
  const buckets = TIDY_LAYOUT.QUANTILE_BUCKETS;
  const order: string[] = [];
  let prevValue = Number.NaN;
  let prevBucket = 0;
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i]!;
    const bucket = entry.value === prevValue
      ? prevBucket
      : Math.min(buckets - 1, Math.floor((i * buckets) / sorted.length));
    const key = tidyQuantileKey(bucket);
    if (order[order.length - 1] !== key) order.push(key);
    groupById.set(entry.id, key);
    // 칸 안 순서는 이 정렬의 자리 그대로다(§5.4 #33 I-2) — 칸만 나누면 한 칸 안이 다시 흩어진다.
    rankById.set(entry.id, i);
    prevValue = entry.value;
    prevBucket = bucket;
  }
  return order;
}

/** 개수가 많은 무리를 앞에(= 안쪽에) 둔다. 동률이면 키 순 — 같은 입력이 늘 같은 그림을 내게. */
function byCountDesc(counts: Map<string, number>): (a: string, b: string) => number {
  return (a, b) => ((counts.get(b) ?? 0) - (counts.get(a) ?? 0)) || (a < b ? -1 : 1);
}

/** ① `status` — (A) 의 다섯 띠(기본). 띠 안은 활동이 최근인 쪽이 왼쪽(§5.4 #33 I-2). */
function groupByStatus(items: readonly TidySortItem[]): TidyGrouping {
  const groupById = new Map<string, string>();
  const rankById = new Map<string, number>();
  const present = new Set<string>();
  for (const item of items) {
    // 정리 대상만 들어오므로 `null` 은 나오지 않지만, 들어와도 "나머지" 띠로 앉힌다(빠뜨림 ❌).
    const band = tidyBandOf(item.bubbleType, item.status) ?? 'other';
    groupById.set(item.id, band);
    present.add(band);
    rankById.set(item.id, -(item.lastActivity ?? 0));
  }
  return {
    groupById,
    order: TIDY_BAND_ORDER.filter((b) => present.has(b)),
    rankById,
    anchorByGroup: NO_ANCHOR,
  };
}

/** ② `kind` — 무리 키는 버블 종류(§2.2) 그대로. 큰 갈래로 뭉치지 않는다(파일+도메인이면 "유사한 것끼리"가 깨진다). */
function groupByKind(items: readonly TidySortItem[]): TidyGrouping {
  const groupById = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const item of items) {
    groupById.set(item.id, item.bubbleType);
    counts.set(item.bubbleType, (counts.get(item.bubbleType) ?? 0) + 1);
  }
  // 덩어리 기하는 순위를 쓰지 않는다 — `kind` 는 (I) 개편에서 한 픽셀도 바뀌지 않는 하나다.
  return {
    groupById,
    order: [...counts.keys()].sort(byCountDesc(counts)),
    rankById: NO_RANK,
    anchorByGroup: NO_ANCHOR,
  };
}

/** ③ `heat` — 많이 만진 순. 축(읽기/쓰기)은 호출부가 §5.24 히트맵에서 읽어 `heat` 에 담아 준다. */
function groupByHeat(items: readonly TidySortItem[]): TidyGrouping {
  const groupById = new Map<string, string>();
  const rankById = new Map<string, number>();
  const order = quantileGroups(items.map((i) => ({ id: i.id, value: i.heat })), groupById, rankById);
  return { groupById, order, rankById, anchorByGroup: NO_ANCHOR };
}

/** ④ `recent` — 최근에 만진 순. 잰 적이 없는 것은 맨 아랫 칸으로 따로 모은다. */
function groupByRecent(items: readonly TidySortItem[]): TidyGrouping {
  const groupById = new Map<string, string>();
  const rankById = new Map<string, number>();
  const measured: { id: string; value: number }[] = [];
  let unmeasured = 0;
  for (const item of items) {
    if (typeof item.lastActivity === 'number' && item.lastActivity > 0) {
      measured.push({ id: item.id, value: item.lastActivity });
    } else {
      groupById.set(item.id, TIDY_GROUP_UNMEASURED);
      unmeasured++;
    }
  }
  // 잰 적 없는 것들에는 순위를 주지 않는다 — 없는 순서를 지어내면 그 줄이 거짓말을 한다(id 순).
  const order = quantileGroups(measured, groupById, rankById);
  if (unmeasured > 0) order.push(TIDY_GROUP_UNMEASURED);
  return { groupById, order, rankById, anchorByGroup: NO_ANCHOR };
}

/**
 * ⑤ `lineage` — 중심은 에이전트, 무리는 1촉으로 닿은 버블. 근거는 **화면에 그려진 엣지**(`computeLinkGroup` 과 같은 이유).
 * 여러 에이전트에 걸친 버블은 가장 최근 쪽으로(§2.1 한 버블 한 자리). 에이전트는 제 덩어리 가운데에 고정(`anchorByGroup`, I-3).
 */
function groupByLineage(items: readonly TidySortItem[], edges: readonly LinkEdgeRef[]): TidyGrouping {
  const byId = new Map<string, TidySortItem>();
  for (const item of items) byId.set(item.id, item);

  const hubs: TidySortItem[] = items.filter((i) => LINEAGE_HUB_TYPES.has(i.bubbleType));
  if (hubs.length === 0) {
    // 에이전트가 하나도 없으면 나눌 축이 없다 — 통째로 한 덩어리다(억지로 쪼개면 뜻이 없다).
    const groupById = new Map<string, string>();
    for (const item of items) groupById.set(item.id, TIDY_GROUP_NONE);
    return {
      groupById,
      order: items.length > 0 ? [TIDY_GROUP_NONE] : [],
      rankById: NO_RANK,
      anchorByGroup: NO_ANCHOR,
    };
  }

  // 활동이 최근인 에이전트가 먼저 집는다 — 겹친 버블의 주인을 정하는 규칙이자 무리가 서는 순서.
  const hubOrder = [...hubs].sort((a, b) =>
    ((b.lastActivity ?? 0) - (a.lastActivity ?? 0)) || (a.id < b.id ? -1 : 1));
  const hubRank = new Map<string, number>();
  hubOrder.forEach((h, i) => hubRank.set(h.id, i));

  const groupById = new Map<string, string>();
  for (const hub of hubOrder) groupById.set(hub.id, hub.id); // 에이전트는 제 무리의 중심

  const claim = (nodeId: string, hubId: string): void => {
    if (!byId.has(nodeId)) return;            // 화면 밖이거나 정리 대상이 아닌 것
    if (hubRank.has(nodeId)) return;          // 에이전트는 남의 무리에 들지 않는다
    const cur = groupById.get(nodeId);
    if (cur === undefined) { groupById.set(nodeId, hubId); return; }
    if ((hubRank.get(hubId) ?? Infinity) < (hubRank.get(cur) ?? Infinity)) groupById.set(nodeId, hubId);
  };
  for (const e of edges) {
    if (hubRank.has(e.source)) claim(e.target, e.source);
    if (hubRank.has(e.target)) claim(e.source, e.target);
  }

  const used = new Set<string>();
  let orphans = 0;
  for (const item of items) {
    const g = groupById.get(item.id);
    if (g === undefined) { groupById.set(item.id, TIDY_GROUP_NONE); orphans++; }
    else used.add(g);
  }
  const order = hubOrder.map((h) => h.id).filter((id) => used.has(id));
  if (orphans > 0) order.push(TIDY_GROUP_NONE);
  // 무리 키가 곧 주인의 id 다 — 그 한 장이 덩어리 가운데에 앉는다. 주인 없는 마지막 덩어리
  // (`TIDY_GROUP_NONE`)는 비워 둔다: 가운데에 세울 것이 없다는 사실도 그림의 일부다.
  const anchorByGroup = new Map<string, string>();
  for (const id of order) if (id !== TIDY_GROUP_NONE) anchorByGroup.set(id, id);
  return { groupById, order, rankById: NO_RANK, anchorByGroup };
}

/** `lineage` 만 화면의 엣지를 본다. 나머지 넷은 버블 자신이 든 값으로 갈린다. */
export interface TidyGroupingContext {
  edges?: readonly LinkEdgeRef[];
}

/** §5.4 #33 (I) — 새 기준은 `TIDY_SORTS` 한 줄 + 여기 한 갈래로만. 배치는 네 칸(`groupById`·`order`·`rankById`·`anchorByGroup`)만 읽는다. */
export function computeTidyGrouping(
  items: readonly TidySortItem[],
  sort: TidySort,
  ctx: TidyGroupingContext = {},
): TidyGrouping {
  switch (sort) {
    case 'kind': return groupByKind(items);
    case 'heat': return groupByHeat(items);
    case 'recent': return groupByRecent(items);
    case 'lineage': return groupByLineage(items, ctx.edges ?? []);
    case 'status':
    default: return groupByStatus(items);
  }
}
