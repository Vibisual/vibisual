/**
 * 선택 채널 조정 — 둘이 동시에 선택을 들면 함께 끌린다. 네이티브(일반 버블·엣지) · store(`selectable:false` 노드·메모 상자·작업 엣지 — `selectedAppBubbleId` 등).
 * RF 는 드래그 시작 때 `selected` draggable 을 전부 집고(`getDragItems`), 남의 선택을 내리는 `unselectNodesAndEdges()` 는 아직 선택 전인 노드를 끌 때만 돈다.
 * 그래서 선택이 잡히는 순간 반대편을 내린다 — 방금 손댄 채널이 이긴다.
 * §6 — store 노드도 묶음(`selected`)에 들어 store 채널은 "우측 패널의 한 칸"만 뜻하고, 네이티브 개수엔 그 묶음도 든다(`BubbleMap` 이 지문에 싣는다). 메모 상자는 묶음 ❌.
 */

/** 조정 결과 — 어느 쪽 선택을 내릴 것인가. */
export type CanvasSelectionAction =
  /** 손댈 것 없음(두 채널이 동시에 선택을 들고 있지 않다). */
  | 'none'
  /** React Flow 네이티브 선택(버블·엣지의 `selected`)을 내린다. */
  | 'clear-native'
  /** store 채널 선택(앱·캡처·… 버블, 작업 엣지)을 내린다. */
  | 'clear-store';

export interface CanvasSelectionConflictInput {
  /** store 채널이 지금 들고 있는 선택 id(없으면 null). */
  storeSelectedId: string | null;
  /** React Flow 네이티브로 선택된 노드+엣지 개수. */
  nativeSelectedCount: number;
  /** 직전 조정 이후 store 채널 선택이 바뀌었는가. */
  storeChanged: boolean;
  /** 직전 조정 이후 네이티브 선택이 바뀌었는가. */
  nativeChanged: boolean;
}

/**
 * 한쪽이 비면 `none`. 방금 바뀐 쪽을 남기고 반대편을 내린다. 같은 커밋이거나 둘 다 안 바뀌었으면 store 를 남긴다
 * (store 는 사용자가 누른 결과뿐, 네이티브는 노드 삭제 같은 이유로도 흔들린다).
 */
export function resolveCanvasSelectionConflict(input: CanvasSelectionConflictInput): CanvasSelectionAction {
  const { storeSelectedId, nativeSelectedCount, storeChanged, nativeChanged } = input;
  if (storeSelectedId === null) return 'none';
  if (nativeSelectedCount <= 0) return 'none';
  if (storeChanged) return 'clear-native';
  if (nativeChanged) return 'clear-store';
  return 'clear-native';
}

/** 선택 id 를 이은 원시 문자열 — 매 프레임 좌표가 바뀌어도 집합이 같으면 같아 의존성으로 안전하다. */
export function nativeSelectionKey(
  nodes: readonly { id: string; selected?: boolean }[],
  edges: readonly { id: string; selected?: boolean }[],
): string {
  let key = '';
  for (const n of nodes) if (n.selected) key += `${key ? ',' : ''}n:${n.id}`;
  for (const e of edges) if (e.selected) key += `${key ? ',' : ''}e:${e.id}`;
  return key;
}

/** 지문에서 선택 개수를 센다(빈 문자열이면 0). */
export function nativeSelectionCount(key: string): number {
  if (key === '') return 0;
  let count = 1;
  for (const ch of key) if (ch === ',') count += 1;
  return count;
}
