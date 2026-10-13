/**
 * canvasMultiSelect.ts — §6 **여러 개 고르기도 캔버스 전체가 한 규칙이다.**
 *
 * 캔버스의 "고른 묶음"은 React Flow 노드의 `selected` 한 칸이다(박스 선택·묶음 끌기·`Delete` 일괄·
 * 묶음 우클릭이 전부 이 칸을 본다). 종전에는 이 칸을 **일반 버블만** 쓸 수 있었다 — 앱·캡처·플레이·
 * 스펙·랩·선반 노드는 `selectable:false` 라 박스 선택이 통째로 건너뛰었고(사용자 보고: "새로 만든
 * 버블들이 선택이 잘 안 된다"), Shift 클릭은 박스 선택 키와 겹쳐 버블에 닿지 않았고, Ctrl/Cmd 클릭은
 * 무리 잡기(§5.4 #31)로만 쓰였다. 그래서 묶음을 만드는 길이 버블 종류마다 갈렸다.
 *
 * 이제 규칙은 하나다.
 *  - **보통 클릭** = 그 노드 하나만 고른다(묶음을 그 하나로 바꾼다).
 *  - **Ctrl/Cmd 클릭 · Shift 클릭** = 그 노드를 묶음에 넣거나 뺀다(링·우측 패널은 건드리지 않는다).
 *  - **Shift+드래그** = 상자에 걸친 노드를 모두 고른다(걸치기만 해도 든다 — `SelectionMode.Partial`).
 * 노드 종류는 묻지 않는다. 묶음에서 빠지는 것은 노드가 스스로 `selectable:false` 로 빠진 것(메모 상자·
 * 실패 표식)과 네비게이션 골격(뒤로 가기)뿐이다.
 *
 * 이 파일은 **DOM·React Flow 런타임을 들이지 않는 순수 판정**만 둔다(타입만 가져온다) — 클라 시험에는
 * DOM 이 없고, `@xyflow/react` 를 통째로 흉내 내는 시험도 있어서다. React Flow 스토어를 만지는 손잡이는
 * `useCanvasNodeSelection.ts` 에 있다.
 */
import type { EdgeSelectionChange, NodeSelectionChange } from '@xyflow/react';

/**
 * 묶음에 들지 않는 골격 버블 — 뒤로 가기는 고르는 대상이 아니다(클릭 제스처의 `ignore` 와 같은 목록).
 * 고르게 두면 묶음을 끌 때 함께 끌려가 화면의 "돌아가는 문"이 엉뚱한 데로 옮겨 간다.
 */
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
 * React Flow 가 노드를 "고를 수 있는 것"으로 볼지 — **박스 선택이 도는 동안만** 켠다.
 *
 * 켜 두면 React Flow 가 클릭마다 스스로 고르고(`handleNodeClick`) 끌기 시작에 또 고르는데, 그 판정은
 * 우리 규칙(5px 문턱 · 더블클릭 240ms 보류 · Ctrl/Cmd 누적)과 따로 돈다. 그래서 Ctrl 클릭 한 번에
 * 우리가 넣은 것을 React Flow 가 "새로 하나만 고르기"로 덮어 묶음이 사라졌고, 더블클릭으로 창을 열어도
 * 1타에서 고른 것이 바뀌었다. 클릭은 우리 제스처 하나가 고르고, React Flow 에는 상자 안 노드를 세는
 * 일만 맡긴다. 이미 고른 것(`selected`)은 이 값과 무관하게 묶음으로 함께 끌린다.
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
 * 고르기 한 번이 낳는 변경 — React Flow 가 박스 선택에서 내는 것과 **같은 꼴**(`select` 변경)이라
 * 같은 창구(`onNodesChange`/`onEdgesChange`)로 흐른다. 그 노드가 화면에 없으면 아무것도 바꾸지 않는다
 * (다른 캔버스·이미 사라진 노드의 클릭이 지금 묶음을 비우면 안 된다).
 *
 * - `replace` — 그 노드만 남긴다. 함께 골라져 있던 선(엣지)도 내린다(박스 선택이 노드 사이 선을 같이 고른다).
 * - `toggle` — 그 노드만 뒤집는다. 다른 것은 그대로다.
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

/**
 * store 가 좌표를 쥔 노드(앱·캡처·플레이·스펙·랩·선반)의 묶음 칸에 `select` 변경을 먹인다.
 *
 * 이 노드들은 store 에서 매번 새로 지어지므로 `selected` 를 노드 객체에 둘 수 없다 — 캔버스가 id 집합으로
 * 들고 있다가 지을 때 칠한다. 바뀐 것이 없으면 **같은 집합을 그대로** 돌려준다(헛 렌더 방지).
 */
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

/**
 * store 채널 한 칸(`selectedAppBubbleId` 등 — 우측 패널이 보는 것)이 이 노드를 가리키는가.
 * 플레이 버블은 레코드 하나가 노드 둘(표지 · `<id>__preview`)로 그려지므로 둘 다 그 레코드의 것이다.
 */
export function ownedByStoreSelection(nodeId: string, storeSelectedId: string | null): boolean {
  if (storeSelectedId === null) return false;
  return nodeId === storeSelectedId || nodeId === `${storeSelectedId}__preview`;
}

/**
 * 반대편 채널을 내릴 때(§ `canvasSelectionChannel`) store 노드 묶음에서 **방금 store 채널이 고른 그 노드만**
 * 남긴다. 보통 클릭은 "묶음을 그 하나로"와 "그 노드의 패널"을 함께 거는데, 둘이 서로 다른 렌더에 실려
 * 도착할 수 있다 — 그 사이 조정이 그 노드까지 지우면 방금 고른 것이 묶음에서 빠진다.
 */
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
