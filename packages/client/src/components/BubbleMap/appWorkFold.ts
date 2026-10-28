import type { Edge, Node } from '@xyflow/react';
import type { BubbleData, BubbleType } from '@vibisual/shared';
import { fileBaseName } from '@vibisual/shared';

import type { AppWorkPlan } from '../../utils/appWorkView.js';
import { hiddenActivityBubbleIds } from './bubbleVisibility.js';

/**
 * §5.4 #36 (I) — 앱 작업 보기의 접기(표시만 — 데이터·엣지·이력은 그대로). 소유 판정은 [버블 숨기기]와 같은 `hiddenActivityBubbleIds`.
 * 다른 점: 접는 종류를 파일·폴더·도메인(·잔상)으로 좁히고, 위성 작업 파일(`plan.keepIds`)은 빼고, 넘침(`plan.hiddenWorkIds`)은 더한다.
 */
export const APP_WORK_FOLD_TYPES: ReadonlySet<BubbleType> = new Set<BubbleType>([
  'file', 'internal_folder', 'external_folder', 'domain', 'ghost',
  // §5.1 #2-1 (B) — 파일 묶음 버블은 그 구성과 함께 접힌다(구성만 접히고 빈 묶음이 남지 않게). 앱 작업의 연속 번호 묶음은 앱 노드를
  //   부모로 두어 에이전트 소유 사슬에 들지 않으므로 접히지 않는다.
  'bundle',
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

/** Count visible upper-arc satellites by their actual app endpoint, including result files. */
function visibleWorkMoons(nodes: readonly Node[], edges: readonly ActivityLink[], plan: AppWorkPlan): Map<string, Set<string>> {
  const seated = new Set(nodes.filter((node) => node.type === 'bubble' && !node.hidden
    // §5.1 #2-1 (F) ⑦ — 연속 번호의 대표는 묶음 버블로 선다(하나로 센다).
    && (node.data['bubbleType'] === 'file' || node.data['bubbleType'] === 'bundle') && node.data['_despawning'] !== true
    && typeof node.data['_seatAngle'] === 'number' && Number.isFinite(node.data['_seatAngle']))
    .map((node) => node.id));
  const byHub = new Map<string, Set<string>>();
  for (const edge of edges) {
    // Hidden edges still describe ownership: hiding a link does not hide its satellite.
    const hub = plan.hubs.has(edge.source) ? edge.source : plan.hubs.has(edge.target) ? edge.target : null;
    if (hub === null) continue;
    const moon = edge.source === hub ? edge.target : edge.source;
    if (!seated.has(moon)) continue;
    const moons = byHub.get(hub) ?? new Set<string>();
    moons.add(moon);
    byHub.set(hub, moons);
  }
  return byHub;
}

/** 그리는 사본에 표시 값(`_appWorkFolded`·`appWorkOrbit`)을 얹는다. 없으면 원본 배열 그대로. */
export function decorateAppWorkNodes(nodes: Node[], plan: AppWorkPlan, fold: AppWorkFold, edges: readonly ActivityLink[]): Node[] {
  if (plan.hubs.size === 0 && fold.byAgent.size === 0) return nodes;
  const visibleMoons = visibleWorkMoons(nodes, edges, plan);
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
      const moons = visibleMoons.get(node.id)?.size ?? 0;
      if (!hub || (moons === 0 && hub.overflow.length === 0)) return node;
      const overflowNames = hub.overflow.map((f) => fileBaseName(f.path) || f.path);
      const orbit = cached(orbitCache, JSON.stringify([hub.app.glow, moons, overflowNames]), () => ({
        ring: hub.app.glow,
        moons,
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
