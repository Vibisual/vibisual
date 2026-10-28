/**
 * §6 — 여러 개 고르기도 캔버스 전체가 한 규칙이다. "고른 묶음" = React Flow 노드 `selected` 한 칸(박스·묶음 끌기·`Delete` 일괄·묶음 메뉴가 본다).
 * 보통 클릭 = 그 하나로 · Ctrl/Cmd·Shift 클릭 = 넣고 빼기(링·패널 ❌) · Shift+드래그 = 걸친 것 모두(`SelectionMode.Partial`).
 * 종류는 묻지 않는다 — 스스로 `selectable:false` 인 것(메모 상자·실패 표식)과 뒤로 가기만 빠진다.
 * 순수 판정만(타입만 import — DOM 없는 시험·`@xyflow/react` 를 흉내 내는 시험이 있다). 스토어 손잡이는 `useCanvasNodeSelection.ts`.
 */
import type { EdgeSelectionChange, NodeSelectionChange } from '@xyflow/react';

/** 뒤로 가기는 묶음 ❌ — 함께 끌리면 화면의 "돌아가는 문"이 엉뚱한 데로 간다(클릭 제스처 `ignore` 와 같은 목록). */
export const NAV_BUBBLE_IDS: ReadonlySet<string> = new Set(['__root_back__', '__interior_back__']);

/** 판정에 필요한 것만 — React Flow 의 `Node` 도 이 모양을 만족한다. */
export interface MultiSelectableNode {
  readonly id: string;
  readonly selectable?: boolean | undefined;
}

/** 이 노드가 묶음(박스·Shift·Ctrl/Cmd)에 들 수 있는가. */
export function isCanvasMultiSelectable(node: MultiSelectableNode): boolean {
  return node.selectable !== false && !NAV_BUBBLE_IDS.has(node.id);
}

/**
 * 박스 선택 중에만 켠다 — 켜 두면 RF 가 클릭·끌기마다 스스로 골라 우리 규칙(5px·240ms 보류·Ctrl/Cmd 누적)을 덮는다
 * (Ctrl 묶음이 사라지고 더블클릭 1타에 고른 것이 바뀐다). 이미 `selected` 인 것은 이 값과 무관하게 함께 끌린다.
 */
export function flowSelectable(node: MultiSelectableNode, marqueeActive: boolean): boolean {
  return marqueeActive && isCanvasMultiSelectable(node);
}

/** 고르기 한 번의 방식 — 보통 클릭은 `replace`, 수식 키 클릭은 `toggle`. */
export type CanvasSelectMode = 'replace' | 'toggle';

interface SelectableItem {
  readonly id: string;
  readonly selected?: boolean | undefined;
}

/**
 * RF 박스 선택과 같은 `select` 변경 꼴이라 같은 창구로 흐른다. 화면에 없는 노드면 아무것도 안 바꾼다(남의 클릭이 묶음을 비우면 안 된다).
 * `replace` 는 함께 골라진 엣지도 내린다.
 */
export function canvasSelectionChanges(
  nodes: Iterable<SelectableItem>,
  edges: Iterable<SelectableItem>,
  id: string,
  mode: CanvasSelectMode,
): { nodes: NodeSelectionChange[]; edges: EdgeSelectionChange[] } {
  const nodeChanges: NodeSelectionChange[] = [];
  const edgeChanges: EdgeSelectionChange[] = [];
  let found = false;
  for (const n of nodes) {
    if (n.id === id) {
      found = true;
      if (mode === 'toggle') nodeChanges.push({ type: 'select', id, selected: n.selected !== true });
      else if (n.selected !== true) nodeChanges.push({ type: 'select', id, selected: true });
      continue;
    }
    if (mode === 'replace' && n.selected === true) nodeChanges.push({ type: 'select', id: n.id, selected: false });
  }
  if (!found) return { nodes: [], edges: [] };
  if (mode === 'replace') {
    for (const e of edges) if (e.selected === true) edgeChanges.push({ type: 'select', id: e.id, selected: false });
  }
  return { nodes: nodeChanges, edges: edgeChanges };
}

/** store 노드는 매번 새로 지어져 `selected` 를 id 집합으로 들고 칠한다. 안 바뀌면 같은 집합을 돌려준다(헛 렌더 방지). */
export function applySelectChanges(
  prev: ReadonlySet<string>,
  changes: readonly { readonly id: string; readonly selected: boolean }[],
): ReadonlySet<string> {
  let next: Set<string> | null = null;
  for (const c of changes) {
    const has = (next ?? prev).has(c.id);
    if (has === c.selected) continue;
    next ??= new Set(prev);
    if (c.selected) next.add(c.id); else next.delete(c.id);
  }
  return next ?? prev;
}

/** 플레이는 레코드 하나가 노드 둘(표지 · `<id>__preview`)이라 둘 다 그 레코드 것이다. */
export function ownedByStoreSelection(nodeId: string, storeSelectedId: string | null): boolean {
  if (storeSelectedId === null) return false;
  return nodeId === storeSelectedId || nodeId === `${storeSelectedId}__preview`;
}

/** 반대편 채널을 내릴 때 store 채널이 방금 고른 노드만 남긴다 — 보통 클릭의 "묶음을 하나로"와 "패널"이 다른 렌더에 도착할 수 있어서다. */
export function keepStoreSelectionOnly(
  prev: ReadonlySet<string>,
  storeSelectedId: string | null,
): ReadonlySet<string> {
  let removed = false;
  const next = new Set<string>();
  for (const id of prev) {
    if (ownedByStoreSelection(id, storeSelectedId)) next.add(id);
    else removed = true;
  }
  return removed ? next : prev;
}
