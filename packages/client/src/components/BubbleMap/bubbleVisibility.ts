import type { Edge, Node } from '@xyflow/react';
import type { BubbleData, BubbleType } from '@vibisual/shared';
import { isActivityEdge } from './linkView.js';
import { isBundleNodeId } from '../../utils/constellationView.js';

type AgentVisibility = Pick<BubbleData, 'id' | 'bubbleType' | 'bubblesHidden'>;
type ActivityLink = Pick<Edge, 'id' | 'source' | 'target' | 'type'>;
type Satellite = Pick<BubbleData, 'id' | 'bubbleType' | 'activeAgentIds' | 'ownerAgentIds'>;

interface OwnerInfo {
  readonly active: readonly string[];
  readonly owners: readonly string[];
}

const ACTIVITY_BUBBLE_TYPES: ReadonlySet<BubbleType> = new Set([
  'internal_folder', 'external_folder', 'file', 'domain', 'bash', 'ghost', 'iframe', 'conti', 'auto',
  // §5.1 #2-1 (B) — 묶음 버블은 구성 파일의 자리다. 빠지면 부모 폴더가 숨을 때 묶음과 그 구성만 남고, 구성으로 가는 소유 사슬도 끊긴다.
  'bundle',
]);
const NO_HIDDEN_BUBBLES: ReadonlySet<string> = new Set();
const NO_IDS: readonly string[] = [];

function idsOf(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : NO_IDS;
}

function sameSet(a: ReadonlySet<string> | undefined, b: ReadonlySet<string>): boolean {
  if (a === undefined) return b.size === 0;
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * §5.4 #36 (H) ①-1 — a bubble hides only when it has a connected agent and every connected agent hides bubbles.
 * Connected = agents whose line reaches it; otherwise its own owners among the agents connected to its parents;
 * otherwise (bundles, junctions) the parents' agents. A parent never lends its agents to a child that names its own.
 * Ownership never passes through another agent, navigation bubble, or user-created app node.
 */
export function hiddenActivityBubbleIds(
  nodes: readonly Node[],
  edges: readonly ActivityLink[],
  agents: readonly AgentVisibility[],
  satellites: Readonly<Record<string, readonly Satellite[]>> = {},
  /** 기본은 모든 활동 버블. §5.4 #36 (I) 접기는 파일·폴더·도메인(·잔상)만 — 소유 관계 그래프는 이 값과 무관하다. */
  eligibleTypes: ReadonlySet<BubbleType> = ACTIVITY_BUBBLE_TYPES,
): ReadonlySet<string> {
  const hiddenAgents = new Set<string>();
  const knownAgents = new Set<string>();
  for (const agent of agents) {
    if (agent.bubbleType !== 'agent') continue;
    knownAgents.add(agent.id);
    if (agent.bubblesHidden === true) hiddenAgents.add(agent.id);
  }
  if (hiddenAgents.size === 0) return NO_HIDDEN_BUBBLES;

  // A drawn satellite (`sat-X`) is the same bubble as its raw entry `X` — the layout keeps only the first parent's copy.
  const alias = new Map<string, string>();
  for (const list of Object.values(satellites)) {
    for (const satellite of list) alias.set(`sat-${satellite.id}`, satellite.id);
  }
  const key = (id: string): string => alias.get(id) ?? id;

  const eligible: string[] = [];
  const protectedIds = new Set<string>();
  const ownerInfo = new Map<string, OwnerInfo>();
  const noteOwners = (id: string, data: { activeAgentIds?: unknown; ownerAgentIds?: unknown }): void => {
    const at = key(id);
    const prev = ownerInfo.get(at);
    const active = idsOf(data.activeAgentIds);
    const owners = idsOf(data.ownerAgentIds);
    ownerInfo.set(at, prev === undefined ? { active, owners } : {
      active: [...new Set([...prev.active, ...active])],
      owners: [...new Set([...prev.owners, ...owners])],
    });
  };
  for (const node of nodes) {
    const type = node.data.bubbleType as BubbleType;
    if (node.type === 'bubble' && (ACTIVITY_BUBBLE_TYPES.has(type) || eligibleTypes.has(type))
      && node.data.customCreated !== true) {
      noteOwners(node.id, node.data);
      if (eligibleTypes.has(type)) eligible.push(node.id);
    } else protectedIds.add(node.id);
  }

  const lines = new Map<string, Set<string>>();
  const parents = new Map<string, Set<string>>();
  const children = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, at: string, value: string): void => {
    const set = map.get(at);
    if (set) set.add(value);
    else map.set(at, new Set([value]));
  };
  const relate = (parentId: string, childId: string): void => {
    if (protectedIds.has(childId)) return;
    const child = key(childId);
    if (knownAgents.has(parentId)) {
      add(lines, child, parentId);
      return;
    }
    const parent = key(parentId);
    if (protectedIds.has(parentId) || parent === child) return;
    add(parents, child, parent);
    add(children, parent, child);
  };
  for (const edge of edges) {
    if (!isActivityEdge(edge)) continue;
    // Read and write edges have opposite directions; both express the same line.
    if (knownAgents.has(edge.source)) relate(edge.source, edge.target);
    if (knownAgents.has(edge.target)) relate(edge.target, edge.source);
    // Includes synthetic satellites (for example conti) absent from store.satellites.
    if (edge.id.startsWith('sat-edge-')) {
      if (edge.source.startsWith('sat-')) relate(edge.target, edge.source);
      if (edge.target.startsWith('sat-')) relate(edge.source, edge.target);
      // §5.1 #2-1 (B) — 묶음 버블과 그 구성은 한 무리다. 원 둘레에 선 묶음(`bundle-…`)에는 활동선이 닿지 않아(에이전트 선은
      //   중심 파일로 옮겨 간다) 구성에서 거슬러 잇는다 — 위성 자리의 묶음(`sat-bundle-…`)은 위 두 줄이 이미 양쪽을 잇는다.
      if (isBundleNodeId(edge.source) || isBundleNodeId(edge.target)) {
        relate(edge.source, edge.target);
        relate(edge.target, edge.source);
      }
    }
  }
  for (const [parentId, list] of Object.entries(satellites)) {
    for (const satellite of list) {
      if (!ACTIVITY_BUBBLE_TYPES.has(satellite.bubbleType)) continue;
      relate(parentId, satellite.id);
      noteOwners(satellite.id, satellite);
    }
  }
  for (const node of nodes) {
    if (protectedIds.has(node.id)) continue;
    if (typeof node.parentId === 'string') relate(node.parentId, node.id);
    if (typeof node.data.parentId === 'string') relate(node.data.parentId, node.id);
  }

  const connected = new Map<string, ReadonlySet<string>>();
  const connectedOf = (id: string): ReadonlySet<string> => {
    const info = ownerInfo.get(id);
    const active = info?.active ?? NO_IDS;
    const line = lines.get(id);
    if (line) return active.length === 0 ? line : new Set([...line, ...active]);
    const inherited = new Set<string>();
    for (const parent of parents.get(id) ?? []) {
      for (const agentId of connected.get(parent) ?? []) inherited.add(agentId);
    }
    // Owner records outlive lines (§2.4), so only owners still connected through a parent count.
    const own = new Set(active);
    for (const agentId of info?.owners ?? NO_IDS) if (inherited.has(agentId)) own.add(agentId);
    return own.size > 0 ? own : inherited;
  };
  const queue = [...new Set([...lines.keys(), ...ownerInfo.keys(), ...parents.keys()])];
  const pending = new Set(queue);
  // A child's own owners can narrow it once its parent resolves, so cycles get a bounded number of revisits.
  const limit = (queue.length + 1) * 16;
  for (let i = 0; i < queue.length && i < limit; i += 1) {
    const id = queue[i]!;
    pending.delete(id);
    const next = connectedOf(id);
    if (sameSet(connected.get(id), next)) continue;
    connected.set(id, next);
    for (const child of children.get(id) ?? []) {
      if (pending.has(child)) continue;
      pending.add(child);
      queue.push(child);
    }
  }

  const hidden = new Set<string>();
  for (const id of eligible) {
    const agentIds = connected.get(key(id));
    if (agentIds === undefined || agentIds.size === 0) continue;
    let allHidden = true;
    for (const agentId of agentIds) {
      if (!hiddenAgents.has(agentId)) {
        allHidden = false;
        break;
      }
    }
    if (allHidden) hidden.add(id);
  }
  return hidden.size === 0 ? NO_HIDDEN_BUBBLES : hidden;
}

/** Apply only to render inputs. Always call with source nodes so showing restores their original flags. */
export function applyBubbleVisibilityToNodes(nodes: readonly Node[], hiddenIds: ReadonlySet<string>): Node[] {
  if (hiddenIds.size === 0) return nodes as Node[];
  let changed = false;
  const out = nodes.map((node) => {
    if (!hiddenIds.has(node.id) || (node.hidden === true && node.selected !== true)) return node;
    changed = true;
    return { ...node, hidden: true, ...(node.selected === true ? { selected: false } : {}) };
  });
  return changed ? out : nodes as Node[];
}

/** Hide all incident edges, including custom edges, without deleting graph connections. */
export function applyBubbleVisibilityToEdges(edges: readonly Edge[], hiddenIds: ReadonlySet<string>): Edge[] {
  if (hiddenIds.size === 0) return edges as Edge[];
  let changed = false;
  const out = edges.map((edge) => {
    if ((!hiddenIds.has(edge.source) && !hiddenIds.has(edge.target)) || (edge.hidden === true && edge.selected !== true)) return edge;
    changed = true;
    return { ...edge, hidden: true, ...(edge.selected === true ? { selected: false } : {}) };
  });
  return changed ? out : edges as Edge[];
}
