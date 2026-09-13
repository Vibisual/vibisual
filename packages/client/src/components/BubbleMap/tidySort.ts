import type { BubbleType, NodeStatus, TidySort } from '@vibisual/shared';
import { TIDY_BAND_ORDER, TIDY_LAYOUT } from '@vibisual/shared';
import { tidyBandOf } from './tidyLayout.js';
import type { LinkEdgeRef } from './linkedBubbles.js';

/**
 * §5.4 #33 (I) **버블 정리 — 무엇을 기준으로 무리를 짓나.**
 *
 * `tidyLayout.ts` 가 "어디에 앉히나"(순수 기하)를 쥔다면 여기는 **"누구와 함께, 몇 번째로
 * 앉나"** 만 쥔다. 둘을 갈라 두는 이유는 기하가 기준을 몰라야 새 기준을 표 한 줄로 늘릴 수
 * 있기 때문이다(§3.3) — 실제로 아래 다섯은 전부 같은 두 기하(`rows`/`clusters`) 위에서 돈다.
 *
 * **UI 없이 검증한다**(`tidyLayout`·`bubbleTextFit` 선례) — 무리 나눔은 입력과 출력이 둘 다
 * 순수 값이라 렌더링 없이 확인하는 편이 정확하다(`tidySort.test.ts`).
 */

/** 무리를 나눌 때 보는 버블 한 장. 기하에 필요한 지름·좌표는 여기 없다(그쪽은 `TidyItem`). */
export interface TidySortItem {
  id: string;
  bubbleType: BubbleType;
  status: NodeStatus;
  /**
   * 히트 축 값 — **색·지름이 쓰는 `heatValueOf` 가 낸 그 값**이어야 한다(§5.24 가 척도와 축을
   * 한 벌로 묶은 것과 같은 규율). 다른 자로 재면 히트맵을 켜고 정리했을 때 색과 자리가 서로
   * 다른 말을 한다.
   */
  heat: number;
  /** 마지막 활동 시각(ms). **잰 적이 없으면 `undefined`** — 0("가장 오래전")과 다른 뜻이다. */
  lastActivity?: number;
}

/** 무리 나눔의 결과 — 누가 어느 무리이고, 무리들이 어떤 순서로 서고, 무리 안에서 누가 먼저인가. */
export interface TidyGrouping {
  /** 버블 id → 무리 키. 목록에 없는 버블은 `TIDY_GROUP_NONE` 으로 읽는다. */
  readonly groupById: ReadonlyMap<string, string>;
  /**
   * 무리 키의 순서. 줄 세우기에서는 **위→아래**이고(앞이 더 급한/뜨거운/최근),
   * 덩어리에서는 자리를 채워 가는 순서다(앞이 안쪽 — 서열이 아니라 자리 효율).
   */
  readonly order: readonly string[];
  /**
   * §5.4 #33 (I-2) 무리 **안에서** 서는 순서 — **작을수록 앞(왼쪽)**. 줄 세우기 기하만 쓴다.
   *
   * 칸을 다섯으로 자르는 것으로 끝나면 한 칸 안 열 개가 아무 순서로 늘어서 "왜 이 자리인가"에
   * 답하지 못한다 — 그 칸만 다시 "흩어진 것"으로 읽힌다. 순위를 낼 수 없는 무리(잰 적 없는
   * 것들)는 **여기 없다** — 그때는 기하가 `id` 순으로 세운다(억지 순서 ❌).
   *
   * 값의 뜻은 기준마다 다르고(`-히트` · `-마지막 활동`) **기하는 그 뜻을 알지 못한다.**
   */
  readonly rankById: ReadonlyMap<string, number>;
  /**
   * §5.4 #33 (I-3) 무리 키 → 그 무리의 **가운데에 고정할 버블**. 덩어리 기하만 쓴다.
   *
   * `lineage` 의 에이전트가 여기 든다 — 주인이 덩어리 가장자리에 앉으면 덩어리들이 전부
   * "그냥 뭉친 공"으로 보여 무엇이 그 무리를 만들었는지가 화면에 남지 않는다. `kind` 에는
   * 가운데에 세울 주인이 없으므로 **비어 있고, 그래서 `kind` 의 그림은 바뀌지 않는다.**
   */
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

/** 에이전트 계열 — `lineage` 에서 무리의 **중심**이 되는 종류. */
const LINEAGE_HUB_TYPES: ReadonlySet<BubbleType> = new Set<BubbleType>(['agent', 'auto', 'pipeline']);

/**
 * 연속값을 **순위로** 자른다 — 절대 기준으로 자르면 프로젝트마다 전부 한 칸에 몰린다
 * (§5.24 가 램프에서 겪은 롱테일이 그대로 재현된다).
 *
 * **동점은 반드시 같은 칸이다.** 인덱스만으로 자르면 486회짜리 둘이 경계에 걸렸을 때 하나는
 * 안쪽 띠, 하나는 바깥 띠에 앉아 **같은 값이 다른 말을 하는** 그림이 된다.
 */
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

/**
 * ① `status` — (A) 의 다섯 띠. 기본값.
 *
 * **띠 안 순서는 활동이 최근인 쪽이 왼쪽이다**(§5.4 #33 I-2 셋째 글머리). 띠 안에 순위가 없다고
 * 자리를 아무렇게나 주면 그 칸만 다시 "흩어진 것"으로 읽힌다 — 같은 `running` 이라도 방금 무언가
 * 한 에이전트를 먼저 보고 싶은 것이 이 기준을 고른 이유다.
 */
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

/**
 * ② `kind` — **유사한 것끼리.** 무리 키는 버블 종류(§2.2) 그대로다.
 *
 * 종류를 큰 갈래로 뭉치지 않는다 — 파일과 도메인을 한 덩어리로 묶으면 "유사한 것끼리"라는
 * 이 기준의 유일한 약속이 깨진다. 실제로 있는 종류만 덩어리가 생기므로 덩어리 수는 저절로 적다.
 */
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
 * ⑤ `lineage` — **누가 무엇을 건드렸나.** 무리의 중심은 에이전트고, 무리는 그 에이전트에
 * 1촉으로 닿은 버블들이다.
 *
 * **근거는 화면에 그려진 엣지다** — 스토어의 관계가 아니라(`computeLinkGroup`(#31) 과 같은
 * 규율이자 같은 이유: 뷰마다 그려지는 선이 다르므로 스토어를 보면 화면에 없는 버블까지 든다).
 *
 * **여러 에이전트에 걸친 버블은 활동이 가장 최근인 에이전트 쪽으로 간다** — 한 버블은 한 자리에만
 * 앉을 수 있고, 두 곳에 그리면 §2.1 이 금지한 "같은 버블이 두 자리에" 가 된다.
 *
 * **그리고 그 에이전트는 제 덩어리의 가운데에 고정된다**(`anchorByGroup`). 주인이 가장자리에
 * 앉으면 덩어리들이 전부 "그냥 뭉친 공"으로 보여 무엇이 이 무리를 만들었는지가 화면에 남지
 * 않는다 — 가운데 한 장이 곧 그 무리의 이름표다(§5.4 #33 I-3).
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

/**
 * §5.4 #33 (I) — 이 기준에서 누가 누구와 함께 앉는가.
 *
 * **새 기준은 `TIDY_SORTS` 한 줄 + 여기 한 갈래로만.** 배치 쪽(`computeTidyLayout`)은 이 결과의
 * 네 칸(`groupById`·`order`·`rankById`·`anchorByGroup`)을 읽을 뿐 기준 이름도, 그 수가 무엇을
 * 센 것인지도 알지 못한다.
 */
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
