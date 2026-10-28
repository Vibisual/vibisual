/**
 * §5.5 #17-17 ⑳(g) — **선이 사라지지 않게**(파생 노드 배열을 넘기는 캔버스용). controlled React Flow 는 잰 치수를 `onNodesChange` `dimensions` 로만 알리고,
 * `measured` 로 돌려주지 않으면 새 노드 객체마다 `handleBounds` 를 지워(`adoptUserNodes`) 그 노드의 선이 안 그려진다. 잰 치수를 도로 싣고, 미리 아는 캔버스는 `fallback` 으로 첫 프레임부터.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Node, NodeChange } from '@xyflow/react';

/** 노드 한 칸의 잰 치수. */
export type MeasuredSize = { width: number; height: number };

/** 잰 치수 표 — 노드 id 로 찾는다. */
export type MeasuredSizes = Record<string, MeasuredSize>;

/** `dimensions` 변경만 표에 담는다. 바뀐 게 없으면 **같은 표**를 돌려준다 — 프레임마다 오는 변경에 새 객체를 지으면 헛렌더한다. */
export function collectMeasured(prev: MeasuredSizes, changes: NodeChange[]): MeasuredSizes {
  let next = prev;
  for (const change of changes) {
    if (change.type !== 'dimensions') continue;
    const size = change.dimensions;
    if (!size) continue;
    if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) continue;
    if (size.width <= 0 || size.height <= 0) continue;
    const cur = prev[change.id];
    if (cur && cur.width === size.width && cur.height === size.height) continue;
    if (next === prev) next = { ...prev };
    next[change.id] = { width: size.width, height: size.height };
  }
  return next;
}

/** 지금 없는 노드의 치수는 버린다 — 표는 스스로 줄지 않아 세션을 옮기는 동안 옛 id 가 끝없이 쌓인다. */
export function pruneMeasured(prev: MeasuredSizes, liveIds: Iterable<string>): MeasuredSizes {
  const live = new Set(liveIds);
  const keys = Object.keys(prev);
  if (keys.every((id) => live.has(id))) return prev;
  const next: MeasuredSizes = {};
  for (const id of keys) {
    const size = prev[id];
    if (size && live.has(id)) next[id] = size;
  }
  return next;
}

/**
 * 노드마다 `measured` 를 실어 준다 — 잰 값이 먼저고, 없으면 넘겨받은 기본 치수다.
 * 이미 실려 있는 노드는 그대로 둔다(부르는 쪽이 스스로 실었으면 그쪽이 진실이다).
 */
export function withMeasured(nodes: Node[], sizes: MeasuredSizes, fallback?: MeasuredSize): Node[] {
  return nodes.map((node) => {
    if (node.measured) return node;
    const size = sizes[node.id] ?? fallback;
    return size ? { ...node, measured: { width: size.width, height: size.height } } : node;
  });
}

/**
 * @param nodes 매 렌더 새로 지어지는 파생 노드 배열(신원이 계속 바뀐다).
 * @param fallback 치수를 미리 아는 캔버스의 기본값 — 모듈 상수를 넘겨라(매 렌더 새 객체면 헛렌더가 는다).
 */
export function useMeasuredFlowNodes(
  nodes: Node[],
  fallback?: MeasuredSize,
): { nodes: Node[]; onNodesChange: (changes: NodeChange[]) => void } {
  const [sizes, setSizes] = useState<MeasuredSizes>({});

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setSizes((prev) => collectMeasured(prev, changes));
  }, []);

  useEffect(() => {
    setSizes((prev) => pruneMeasured(prev, nodes.map((n) => n.id)));
  }, [nodes]);

  const measured = useMemo(() => withMeasured(nodes, sizes, fallback), [nodes, sizes, fallback]);

  return { nodes: measured, onNodesChange };
}
