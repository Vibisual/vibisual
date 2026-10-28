import { useMemo, useState, useSyncExternalStore } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { useGraphStore } from '../../stores/graphStore.js';
import { useLinkFocusPhase } from '../../stores/linkFocus.js';
import { isSelectDeferred, subscribeSelectDeferred } from './bubbleSelectGesture.js';
import { flowSelectable } from './canvasMultiSelect.js';
import { SELECTION_FOCUS } from './constants.js';
import {
  computeSelectionDistances,
  liftSelectionDistances,
  nextSelectionFocusCenter,
  selectionDistanceClass,
  selectionEdgeDistance,
  selectionFocusIds,
  selectionIdentityIds,
} from './selectionFocus.js';

interface Presentation<T> { className: string; rendered: T }
interface NodePresentation extends Presentation<Node> { selectable: boolean }

/** The center lives in state: a click still waiting out the double-click window must keep showing the previous focus. */
function useSelectionFocusCenter(): { centerId: string | null; pendingId: string | null } {
  const intentId = useGraphStore((state) => state.selectIntentId);
  const selectDeferred = useSyncExternalStore(subscribeSelectDeferred, isSelectDeferred);
  const [held, setHeld] = useState<string | null>(null);
  const centerId = nextSelectionFocusCenter(held, intentId, selectDeferred);
  // Adjusting state while rendering: React re-runs this render before anything is committed.
  if (centerId !== held) setHeld(centerId);
  return { centerId, pendingId: selectDeferred && intentId !== centerId ? intentId : null };
}

/**
 * Presentation only: never write these classes or derived edge data back to graph/layout state.
 * §6 — `marquee` 동안만 노드를 React Flow 에 선택 가능(`flowSelectable`)으로 내보낸다. 상시면 그 판정이 우리 규칙(5px 문턱·더블클릭 보류·Ctrl/Cmd 누적)과 따로 돌아 Ctrl 클릭 묶음을 덮어쓴다.
 */
export function useSelectionFocus(nodes: Node[], edges: Edge[], marquee = false): { nodes: Node[]; edges: Edge[] } {
  const { centerId, pendingId } = useSelectionFocusCenter();
  const currentFolderId = useGraphStore((state) => state.currentFolderId);
  const linkPhase = useLinkFocusPhase();
  // React Flow also caches by the node object's identity. A physics update to one node
  // must not invalidate every unchanged node/edge; weak keys release departed snapshots.
  const cache = useMemo(() => ({
    nodes: new WeakMap<Node, NodePresentation>(),
    edges: new WeakMap<Edge, Presentation<Edge>>(),
  }), []);
  // Position/status frames do not change connectivity. Memoize BFS by topology and selection,
  // including hidden nodes/edges, rather than the arrays that physics replaces every frame.
  const graphKey = JSON.stringify([
    nodes.map((node) => [node.id, node.type, !!node.hidden, !!node.selected]),
    edges.map((edge) => [edge.id, edge.source, edge.target, !!edge.hidden, !!edge.selected]),
  ]);
  const distances = useMemo(() => {
    if (linkPhase !== 'off' || edges.some((edge) => edge.selected)) return null;
    const centered = computeSelectionDistances(
      selectionFocusIds(nodes, centerId, currentFolderId), nodes, edges,
    );
    return liftSelectionDistances(centered, selectionIdentityIds(nodes, pendingId, currentFolderId));
    // graphKey contains every node/edge field used above; coordinates deliberately stay out.
  }, [graphKey, centerId, pendingId, currentFolderId, linkPhase]);

  const focusedNodes = useMemo(() => nodes.map((node) => {
    const emphasis = distances === null ? SELECTION_FOCUS.restore : selectionDistanceClass(
      distances.get(node.id), SELECTION_FOCUS.nodes, SELECTION_FOCUS.unrelatedNode,
    );
    const className = [node.className, SELECTION_FOCUS.nodeTransition, emphasis].filter(Boolean).join(' ');
    const selectable = flowSelectable(node, marquee);
    const previous = cache.nodes.get(node);
    if (previous?.className === className && previous.selectable === selectable) return previous.rendered;
    const rendered = { ...node, className, selectable };
    cache.nodes.set(node, { className, selectable, rendered });
    return rendered;
  }), [nodes, distances, cache, marquee]);

  const focusedEdges = useMemo(() => edges.map((edge) => {
    const emphasis = distances === null ? SELECTION_FOCUS.restore : selectionDistanceClass(
      selectionEdgeDistance(distances, edge), SELECTION_FOCUS.edges, SELECTION_FOCUS.unrelatedEdge,
    );
    const selectionFocusClassName = [SELECTION_FOCUS.edgeTransition, emphasis].filter(Boolean).join(' ');
    const className = [edge.className, selectionFocusClassName].filter(Boolean).join(' ');
    const previous = cache.edges.get(edge);
    if (previous?.className === className) return previous.rendered;
    const rendered = {
      ...edge,
      className,
      // Task-edge icons/pulses live in a portal outside the SVG edge wrapper.
      ...(edge.type === 'taskEdge' ? { data: { ...edge.data, selectionFocusClassName } } : {}),
    };
    cache.edges.set(edge, { className, rendered });
    return rendered;
  }), [edges, distances, cache]);

  return { nodes: focusedNodes, edges: focusedEdges };
}
