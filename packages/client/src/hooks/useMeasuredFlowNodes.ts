/**
 * §5.5 #17-17 ⑳(g) — **선이 사라지지 않게 하는 한 겹.** React Flow 에 파생 노드 배열을 넘기는
 * 모든 캔버스가 함께 쓴다(무대 지도 · 디버그 패널).
 *
 * React Flow 는 controlled 모드(`nodes` prop)에서 자기가 잰 노드 치수를
 * `onNodesChange` 의 `dimensions` 변경으로만 알려 준다. 그 치수를 받아 노드에 `measured` 로
 * **돌려주지 않으면**, 라이브러리는 새 노드 객체가 올 때마다 그 노드의 손잡이 치수(`handleBounds`)를
 * 지운다 — 라이브러리 주석이 그렇게 적혀 있다("if user re-initializes the node or removes `measured`
 * for whatever reason, we reset the handleBounds so that the node gets re-measured", `adoptUserNodes`).
 * 손잡이 치수가 없는 노드에 붙은 **선은 그려지지 않는다**(`getEdgePosition` 이 null 을 돌려주고
 * `EdgeWrapper` 가 아무것도 그리지 않는다).
 *
 * 그래서 목록이 갱신되거나 노드를 끌 때마다 선이 사라졌다 — 다시 재는 관찰자(ResizeObserver)가
 * 도는 노드는 살아 돌아오고 그렇지 못한 노드의 선은 그대로 없어져서, 화면에는 "어떤 선은 있고
 * 어떤 선은 없는" 그림이 남았다(사용자 지적 "안보이는것도 있잖아 그래프가 일단 정상적으로 보여야지").
 * 노드 자체는 손잡이 치수 없이도 그려지므로 **노드는 멀쩡한데 선만 빠지는** 모양이 된다.
 *
 * 이 훅은 그 왕복을 닫는다 — 잰 치수를 받아 두었다가 노드에 도로 실어 준다. 치수를 미리 아는
 * 캔버스는 `fallback` 으로 첫 프레임부터 실어 보낼 수 있다(첫 측정 전 한 프레임의 깜빡임까지 없앤다).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Node, NodeChange } from '@xyflow/react';

/** 노드 한 칸의 잰 치수. */
export type MeasuredSize = { width: number; height: number };

/** 잰 치수 표 — 노드 id 로 찾는다. */
export type MeasuredSizes = Record<string, MeasuredSize>;

/**
 * `dimensions` 변경만 골라 표에 담는다. 바뀐 것이 없으면 **같은 표**를 그대로 돌려준다 —
 * React Flow 는 프레임마다 변경을 흘려보내므로 여기서 새 객체를 만들면 그만큼 헛되이 다시 그린다.
 */
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

/**
 * 지금 없는 노드의 치수는 버린다. 표는 노드가 사라져도 스스로 줄지 않으므로, 세션을 옮겨 다니는
 * 동안 옛 id 가 계속 쌓인다 — 키 개수에 상한이 없으면 그것만으로 용량 결함이 된다.
 */
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
 * 파생 노드 배열을 그대로 넘기는 캔버스가 쓰는 창구.
 *
 * @param nodes 매 렌더 새로 지어지는 노드 배열(파생이라 신원이 계속 바뀐다 — 그게 이 훅이 필요한 이유다).
 * @param fallback 치수를 미리 아는 캔버스의 기본값(모듈 상수를 넘겨라 — 매 렌더 새 객체를 만들면 헛렌더가 는다).
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
