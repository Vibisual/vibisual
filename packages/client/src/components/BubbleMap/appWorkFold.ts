import type { Edge, Node } from '@xyflow/react';
import type { BubbleData, BubbleType } from '@vibisual/shared';
import { fileBaseName } from '@vibisual/shared';

import type { AppWorkPlan } from '../../utils/appWorkView.js';
import { hiddenActivityBubbleIds } from './bubbleVisibility.js';

/**
 * §5.4 #36 (I) — 앱 작업 보기의 **접기**. 초점이 선 에이전트의 활동 버블 중 초점 작업물이 아닌 것을 표시에서만 숨긴다.
 *
 * 소유 판정은 ①-1 [버블 숨기기]와 **같은 함수**(`hiddenActivityBubbleIds`) — 다른 에이전트도 쓰는 버블은 그 에이전트가 보여
 * 주면 남는다. 다른 점은 둘이다: 접는 종류를 파일·폴더·도메인(·잔상)으로 좁히고(iframe·콘티는 다른 축), 위성으로 서는 작업
 * 파일(`plan.keepIds`)은 빼고, 연속 번호의 나머지·넘침(`plan.hiddenWorkIds`)은 더한다. 데이터·엣지·이력은 그대로다.
 */
export const APP_WORK_FOLD_TYPES: ReadonlySet<BubbleType> = new Set<BubbleType>([
  'file', 'internal_folder', 'external_folder', 'domain', 'ghost',
]);

const NONE: ReadonlySet<string> = new Set();

type AgentVisibility = Pick<BubbleData, 'id' | 'bubbleType' | 'bubblesHidden'>;
type ActivityLink = Pick<Edge, 'id' | 'source' | 'target' | 'type'>;
type Satellite = Pick<BubbleData, 'id' | 'bubbleType'>;

export interface AppWorkFold {
  /** 표시에서 숨길 노드 id. */
  readonly hidden: ReadonlySet<string>;
  /** 에이전트 id → 그 에이전트 때문에 접힌 버블(화면에 있던 것만 · 이름은 툴팁). */
  readonly byAgent: ReadonlyMap<string, { readonly count: number; readonly names: readonly string[] }>;
}

export const EMPTY_APP_WORK_FOLD: AppWorkFold = { hidden: NONE, byAgent: new Map() };

function labelOf(node: Node): string {
  const data = node.data as Partial<BubbleData> | undefined;
  return typeof data?.label === 'string' && data.label !== '' ? data.label : node.id;
}

export function appWorkFoldOf(
  nodes: readonly Node[],
  edges: readonly ActivityLink[],
  agents: readonly AgentVisibility[],
  satellites: Readonly<Record<string, readonly Satellite[]>>,
  plan: AppWorkPlan,
): AppWorkFold {
  if (plan.focusByAgent.size === 0) return EMPTY_APP_WORK_FOLD;
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const hidden = new Set<string>();
  const byAgent = new Map<string, { count: number; names: string[] }>();
  // ①-1 [버블 숨기기]가 이미 숨긴 것 — 접힌 개수에 넣지 않는다(그 에이전트가 말할 몫이 아니다).
  const explicit = hiddenActivityBubbleIds(nodes, edges, agents, satellites, APP_WORK_FOLD_TYPES);
  for (const agentId of plan.focusByAgent.keys()) {
    // 그 에이전트 하나만 "숨김"으로 놓고 판정한다 — 다른 에이전트는 종전 그대로(①-1 로 숨긴 것은 숨긴 채).
    const marked = agents.map((a) => (a.id === agentId ? { ...a, bubblesHidden: true } : a));
    const owned = hiddenActivityBubbleIds(nodes, edges, marked, satellites, APP_WORK_FOLD_TYPES);
    const names: string[] = [];
    for (const id of owned) {
      if (plan.keepIds.has(id) || explicit.has(id)) continue;
      hidden.add(id);
      const node = byId.get(id);
      if (node && !node.hidden) names.push(labelOf(node));
    }
    byAgent.set(agentId, { count: names.length, names: names.sort((a, b) => a.localeCompare(b)) });
  }
  for (const id of plan.hiddenWorkIds) hidden.add(id);
  return { hidden: hidden.size === 0 ? NONE : hidden, byAgent };
}

// ─── 그리는 사본의 표시 전용 값 ───

/** 에이전트 원의 접힌 개수 점(§5.4 #36 (I)). */
export interface AppWorkFoldedBadge {
  readonly count: number;
  readonly names: readonly string[];
}

/** 앱 노드의 작업 궤도(§5.1 #2-1 (F) ⑤⑧) — 위성이 있을 때만 흐린 반원 궤도 · 넘친 개수 점. */
export interface AppWorkOrbitInfo {
  readonly ring: string;
  readonly moons: number;
  readonly overflow: number;
  readonly overflowNames: readonly string[];
}

const badgeCache = new Map<string, AppWorkFoldedBadge>();
const orbitCache = new Map<string, AppWorkOrbitInfo>();
const DECO_CACHE_MAX = 256;

function cached<T>(cache: Map<string, T>, key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size >= DECO_CACHE_MAX) cache.clear();
  const value = make();
  cache.set(key, value);
  return value;
}

/** 같은 원본 노드 · 같은 표시 값이면 같은 사본 — 매 스냅샷 새 객체를 만들면 그 노드가 매번 다시 그려진다. */
const decorated = new WeakMap<Node, { readonly deco: unknown; readonly out: Node }>();

function withDeco(node: Node, key: string, deco: unknown): Node {
  const hit = decorated.get(node);
  if (hit && hit.deco === deco) return hit.out;
  const out = { ...node, data: { ...node.data, [key]: deco } } as Node;
  decorated.set(node, { deco, out });
  return out;
}

/**
 * §5.4 #36 (I) — 그리는 노드 사본에 앱 작업 보기의 표시 값을 얹는다: 에이전트(`bubble`)에는 접힌 개수 점(`_appWorkFolded`),
 * 앱 노드(`appNode`)에는 작업 궤도와 넘침(`appWorkOrbit`). 없으면 원본 배열을 그대로 돌려준다.
 */
export function decorateAppWorkNodes(nodes: Node[], plan: AppWorkPlan, fold: AppWorkFold): Node[] {
  if (plan.hubs.size === 0 && fold.byAgent.size === 0) return nodes;
  let changed = false;
  const out = nodes.map((node) => {
    if (node.type === 'bubble') {
      const f = fold.byAgent.get(node.id);
      if (!f || f.count === 0) return node;
      const badge = cached(badgeCache, JSON.stringify([f.count, f.names]), () => ({ count: f.count, names: f.names }));
      changed = true;
      return withDeco(node, '_appWorkFolded', badge);
    }
    if (node.type === 'appNode') {
      const hub = plan.hubs.get(node.id);
      if (!hub || (hub.work.length === 0 && hub.overflow.length === 0)) return node;
      const overflowNames = hub.overflow.map((f) => fileBaseName(f.path) || f.path);
      const orbit = cached(orbitCache, JSON.stringify([hub.app.glow, hub.work.length, overflowNames]), () => ({
        ring: hub.app.glow,
        moons: hub.work.length,
        overflow: hub.overflow.length,
        overflowNames,
      }));
      changed = true;
      return withDeco(node, 'appWorkOrbit', orbit);
    }
    return node;
  });
  return changed ? out : nodes;
}
