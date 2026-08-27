/**
 * 캔버스 선택 채널 조정 — "클릭·클릭인데 두 개가 같이 끌려오는" 버그를 막는 한 곳.
 *
 * 캔버스에는 선택 채널이 **둘** 있다.
 *  - **네이티브 채널**: 일반 버블·엣지. React Flow 가 스스로 `selected` 를 켜고 끈다(`flowNodes`).
 *  - **store 채널**: 앱·캡처·플레이·스펙·랩·선반 버블과 메모 상자, 그리고 작업 엣지. 이들은
 *    `selectable:false` 로 두고 선택을 store 한 채널(`selectedAppBubbleId` 등)로만 받는다.
 *
 * ⚠ 두 채널이 **동시에** 선택을 들고 있으면 화면에서 다중 선택처럼 동작한다. React Flow 는
 * 드래그를 시작할 때 `selectable` 을 보지 않고 **`selected` 이면서 draggable 인 노드를 전부**
 * 한 덩어리로 집어 든다(`@xyflow/system` 의 `getDragItems` — `node.selected || node.id === nodeId`).
 * 그래서 일반 버블을 한 번 클릭해 네이티브 선택이 켜진 뒤 앱 버블을 클릭하면, 앱 버블은
 * `selectable:false` 라 React Flow 의 선택 초기화 경로를 타지 않아 **두 노드가 모두 selected 로
 * 남고, 둘 중 하나만 끌어도 나머지가 따라 움직인다.**
 *
 * React Flow 가 스스로 이 사고를 막아 주는 경로는 하나뿐이다 — 드래그를 시작한 노드가 **아직
 * 선택 전**일 때만 `unselectNodesAndEdges()` 로 남의 선택을 내려 준다(`startDrag`). 이미 클릭해
 * 선택해 둔 버블을 다시 잡아 끄는 이 경우는 그 조건에 걸리지 않는다. 그러니 **선택이 잡히는
 * 그 순간에 우리가 반대편 채널을 내려야** 한다.
 *
 * 규칙은 한 줄이다 — **방금 손댄 채널이 이긴다.** 그래야 "클릭 → 앱 버블 클릭"(store 가 이김)과
 * "앱 버블 선택 중 박스 드래그로 버블 여러 개 선택"(네이티브가 이김) 이 둘 다 자연스럽다.
 *
 * DOM·React 없이 단위 테스트할 수 있게 순수 함수로 둔다.
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
 * 두 채널이 동시에 선택을 들고 있을 때 어느 쪽을 내릴지 정한다.
 *
 * - 한쪽이 비어 있으면 충돌이 아니다 → `none`.
 * - 방금 바뀐 쪽이 사용자의 마지막 행동이므로 그쪽을 남기고 반대편을 내린다.
 * - 둘 다 같은 커밋에서 바뀌었으면 store 를 남긴다 — store 선택은 사용자가 그 버블을 직접
 *   누른 결과뿐이지만, 네이티브 쪽은 노드가 지워지는 등 사용자 행동이 아닌 이유로도 흔들린다.
 * - 둘 다 안 바뀐 채로 충돌이 남아 있으면(첫 마운트 등) 역시 store 를 남겨 수렴시킨다.
 */
export function resolveCanvasSelectionConflict(input: CanvasSelectionConflictInput): CanvasSelectionAction {
  const { storeSelectedId, nativeSelectedCount, storeChanged, nativeChanged } = input;
  if (storeSelectedId === null) return 'none';
  if (nativeSelectedCount <= 0) return 'none';
  if (storeChanged) return 'clear-native';
  if (nativeChanged) return 'clear-store';
  return 'clear-native';
}

/**
 * 네이티브 선택의 지문 — 선택된 id 를 이어 붙인 문자열.
 *
 * 물리 엔진이 매 프레임 좌표를 바꿔도 **선택 집합이 그대로면 같은 문자열**이라, 이걸 의존성으로
 * 쓰면 조정 로직이 좌표 변화에는 반응하지 않는다(원시값이라 zustand·useEffect 비교도 안전하다).
 */
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
