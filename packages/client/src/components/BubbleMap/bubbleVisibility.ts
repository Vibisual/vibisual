import type { Edge, Node } from '@xyflow/react';
import type { BubbleData, BubbleType } from '@vibisual/shared';
import { isActivityEdge } from './linkView.js';
import { isBundleNodeId } from '../../utils/constellationView.js';

type AgentVisibility = Pick<BubbleData, 'id' | 'bubbleType' | 'bubblesHidden'>;
type ActivityLink = Pick<Edge, 'id' | 'source' | 'target' | 'type'>;
type Satellite = Pick<BubbleData, 'id' | 'bubbleType'>;

const ACTIVITY_BUBBLE_TYPES: ReadonlySet<BubbleType> = new Set([
  'internal_folder', 'external_folder', 'file', 'domain', 'bash', 'ghost', 'iframe', 'conti', 'auto',
  // §5.1 #2-1 (B) — 묶음 버블은 구성 파일의 자리다. 빠지면 부모 폴더가 숨을 때 묶음과 그 구성만 남고, 구성으로 가는 소유 사슬도 끊긴다.
  'bundle',
]);
const NO_HIDDEN_BUBBLES: ReadonlySet<string> = new Set();

/**
 * Only activity bubbles owned exclusively by agents with `bubblesHidden` are hidden.
 * Ownership runs from agents to activity endpoints, then from parents to satellites.
 * It never passes through another agent, navigation bubble, or user-created app node.
 * Raw satellite refs matter: the layout deduplicates shared files to their first parent.
 */
export function hiddenActivityBubbleIds(
  nodes: readonly Node[],
  edges: readonly ActivityLink[],
  agents: readonly AgentVisibility[],
  satellites: Readonly<Record<string, readonly Satellite[]>> = {},
  /**
   * 숨길 수 있는 버블 종류 — 기본은 모든 활동 버블. §5.4 #36 (I) 앱 작업 보기의 접기는 파일·폴더·도메인(·잔상)만 접는다
   * (iframe·콘티 같은 다른 축은 그대로). 소유를 잇는 관계는 이 값과 무관하게 같은 그래프를 탄다.
   */
  eligibleTypes: ReadonlySet<BubbleType> = ACTIVITY_BUBBLE_TYPES,
): ReadonlySet<string> {
  const hiddenAgents = new Set<string>();
  const shownAgents = new Set<string>();
  for (const agent of agents) {
    if (agent.bubbleType !== 'agent') continue;
    (agent.bubblesHidden === true ? hiddenAgents : shownAgents).add(agent.id);
  }
  if (hiddenAgents.size === 0) return NO_HIDDEN_BUBBLES;

  const eligible = new Set<string>();
  const protectedIds = new Set<string>();
  for (const node of nodes) {
    if (node.type === 'bubble' && eligibleTypes.has(node.data.bubbleType as BubbleType)
      && node.data.customCreated !== true) eligible.add(node.id);
    else protectedIds.add(node.id);
  }

  const children = new Map<string, Set<string>>();
  const relate = (parentId: string, childId: string): void => {
    if (protectedIds.has(childId) || parentId === childId) return;
    const list = children.get(parentId) ?? new Set<string>();
    list.add(childId);
    children.set(parentId, list);
  };
  const isAgent = (id: string): boolean => hiddenAgents.has(id) || shownAgents.has(id);
  for (const edge of edges) {
    if (!isActivityEdge(edge)) continue;
    // Read and write edges have opposite directions; both express the same owner.
    if (isAgent(edge.source)) relate(edge.source, edge.target);
    if (isAgent(edge.target)) relate(edge.target, edge.source);
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
      relate(satellite.id, `sat-${satellite.id}`);
    }
  }
  for (const node of nodes) {
    if (!eligible.has(node.id)) continue;
    if (typeof node.parentId === 'string') relate(node.parentId, node.id);
    if (typeof node.data.parentId === 'string') relate(node.data.parentId, node.id);
    // A shared active file can carry an owner not represented by its deduplicated edge.
    const owners = node.data.activeAgentIds;
    if (Array.isArray(owners)) {
      for (const owner of owners) {
        if (typeof owner !== 'string') continue;
        if (!hiddenAgents.has(owner)) shownAgents.add(owner);
        relate(owner, node.id);
      }
    }
  }

  const descendantsOf = (owners: ReadonlySet<string>): Set<string> => {
    const reached = new Set(owners);
    const queue = [...owners];
    for (let i = 0; i < queue.length; i += 1) {
      for (const child of children.get(queue[i]!) ?? []) {
        if (reached.has(child)) continue;
        reached.add(child);
        queue.push(child);
      }
    }
    return reached;
  };
  const hiddenOwned = descendantsOf(hiddenAgents);
  const shownOwned = descendantsOf(shownAgents);
  const hidden = new Set<string>();
  for (const id of eligible) {
    if (hiddenOwned.has(id) && !shownOwned.has(id)) hidden.add(id);
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
