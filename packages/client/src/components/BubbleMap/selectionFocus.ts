/** Display-only graph distances. Moving a linked group still uses linkedBubbles.ts. */
export interface SelectionFocusNode {
  readonly id: string;
  readonly type?: string;
  readonly selected?: boolean;
  readonly hidden?: boolean;
}

export interface SelectionFocusEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly hidden?: boolean;
}

function selectionIdentity(node: SelectionFocusNode, currentFolderId: string | null): string | null {
  if (node.id === '__root_home__') return currentFolderId;
  if (node.id.startsWith('sat-')) return node.id.slice(4);
  if (node.type === 'playPreviewNode' && node.id.endsWith('__preview')) {
    return node.id.slice(0, -'__preview'.length);
  }
  return node.id;
}

/** Every visible node drawn for one logical selection: satellite/folder and two-part play bubbles. */
export function selectionIdentityIds(
  nodes: readonly SelectionFocusNode[],
  selectionId: string | null,
  currentFolderId: string | null,
): string[] {
  if (selectionId === null) return [];
  return nodes
    .filter((node) => !node.hidden && selectionIdentity(node, currentFolderId) === selectionId)
    .map((node) => node.id);
}

/**
 * Nodes at the center of the focus. `pendingId` is a click still waiting out the double-click window:
 * React Flow has already moved its native selection there, so that alone does not contradict the center.
 */
export function selectionFocusIds(
  nodes: readonly SelectionFocusNode[],
  selectionId: string | null,
  currentFolderId: string | null,
  pendingId: string | null = null,
): string[] {
  if (selectionId === null) return [];
  const visible = nodes.filter((node) => !node.hidden);
  const center = visible.filter((node) => selectionIdentity(node, currentFolderId) === selectionId);
  // Native multi-selection is an editing gesture: do not put any member in the background.
  const nativeSelection = visible.filter((node) => node.type === 'bubble' && node.selected);
  if (nativeSelection.length > 1) return [];
  // A marquee can change native selection without sending a new click intent. Only a native center can
  // be contradicted that way: store-owned bubbles never take native selection, so a native leftover beside
  // one is the previous selection the canvas is about to release, not a new choice.
  if (nativeSelection.length === 1 && center.some((node) => node.type === 'bubble')) {
    const nativeId = selectionIdentity(nativeSelection[0]!, currentFolderId);
    if (nativeId !== selectionId && nativeId !== pendingId) return [];
  }
  return center.map((node) => node.id);
}

/**
 * Where the focus sits. The ring lights on the first click by design, but a bubble with a double-click
 * action selects only after the double-click window; until then the previous focus holds. A double-click
 * therefore never dims the map, and moving between focuses never passes through an all-lit frame.
 */
export function nextSelectionFocusCenter(
  held: string | null,
  intentId: string | null,
  selectDeferred: boolean,
): string | null {
  if (intentId === null) return null;
  return selectDeferred ? held : intentId;
}

/** The bubble just pressed answers at once, even while its selection still waits for a second click. */
export function liftSelectionDistances(
  distances: ReadonlyMap<string, number> | null,
  liftIds: readonly string[],
): ReadonlyMap<string, number> | null {
  if (distances === null || liftIds.length === 0) return distances;
  const lifted = new Map(distances);
  for (const id of liftIds) lifted.set(id, 0);
  return lifted;
}

/** Undirected breadth-first search using only edges whose endpoints exist in this view. */
export function computeSelectionDistances(
  focusIds: readonly string[],
  nodes: readonly SelectionFocusNode[],
  edges: readonly SelectionFocusEdge[],
): ReadonlyMap<string, number> | null {
  const visibleIds = new Set(nodes.filter((node) => !node.hidden).map((node) => node.id));
  const distances = new Map<string, number>();
  const queue: string[] = [];
  for (const id of focusIds) {
    if (!visibleIds.has(id) || distances.has(id)) continue;
    distances.set(id, 0);
    queue.push(id);
  }
  if (queue.length === 0) return null;

  const neighbors = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.hidden || !visibleIds.has(edge.source) || !visibleIds.has(edge.target)) continue;
    const sources = neighbors.get(edge.source) ?? [];
    sources.push(edge.target);
    neighbors.set(edge.source, sources);
    const targets = neighbors.get(edge.target) ?? [];
    targets.push(edge.source);
    neighbors.set(edge.target, targets);
  }
  // An index avoids shift()'s repeated array copies on large connected graphs.
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor]!;
    const nextDistance = distances.get(id)! + 1;
    for (const neighbor of neighbors.get(id) ?? []) {
      if (distances.has(neighbor)) continue;
      distances.set(neighbor, nextDistance);
      queue.push(neighbor);
    }
  }
  return distances;
}

/** A line takes the distance of its farther endpoint, with direct lines at level one. */
export function selectionEdgeDistance(
  distances: ReadonlyMap<string, number>,
  edge: SelectionFocusEdge,
): number | undefined {
  if (edge.hidden) return undefined;
  const source = distances.get(edge.source);
  const target = distances.get(edge.target);
  return source === undefined || target === undefined ? undefined : Math.max(1, source, target);
}

export function selectionDistanceClass(distance: number | undefined, levels: readonly string[], unrelated: string): string {
  return distance === undefined ? unrelated : levels[Math.min(distance, levels.length - 1)]!;
}
