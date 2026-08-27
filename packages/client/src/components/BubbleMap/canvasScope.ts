/**
 * canvasScope.ts — §5.7 #26 · §5.9 / §5.13~§5.15 / §5.18 / §5.20 —
 * **이 캔버스가 그 버블을 그릴 수 있는 자리인가.**
 *
 * 캡처·앱·플레이·스펙·랩·선반 여섯 종은 전부 "메인 뷰에서만 렌더"다 — 각 노드 산식이
 * `if (currentFolderId !== null || interiorView !== null) return []` 로 시작한다.
 * 그런데 **우클릭 메뉴에는 그 게이트가 없었다.** 그래서 워크트리(또는 아무 폴더)로 드릴다운한
 * 상태에서 이 항목들을 누르면:
 *   ① 프로젝트는 `activeProject`(= 부모 탭)로 잡히고,
 *   ② 만들어진 버블은 지금 보고 있는 화면에 **그려지지 않으며**,
 *   ③ 사용자는 "눌렀는데 아무 일도 안 일어났다"고 읽고, 실제로는 부모 캔버스에 유령이 하나 앉는다.
 *
 * 워크트리 안에서 만든 것은 워크트리 안에서 돌아야 한다는 규약(§5.7 #26)과 정면으로 어긋나므로,
 * **그릴 수 없는 자리에서는 만들지도 않고 메뉴에 내지도 않는다.** 판정을 여기 한 곳에 두는 이유는
 * 메뉴(감추는 쪽)와 생성 손잡이(막는 쪽)가 반드시 같은 답을 써야 하기 때문이다 — 둘이 어긋나면
 * 감췄는데 다른 길로 만들어지거나(캡처 picker 를 열어 둔 채 폴더로 들어가는 경로), 반대로
 * 메뉴엔 있는데 눌러도 아무 일이 없는 지금 상태가 그대로 남는다.
 *
 * 에이전트 5종(커스텀·CMD·All Model·Auto·파이프라인)과 워크트리 생성은 **여기 해당하지 않는다** —
 * 그쪽은 `selectEffectiveProject` 로 워크트리에 제대로 귀속되고 폴더 안에서도 그려진다.
 */
export interface CanvasScopeState {
  /** 드릴다운한 폴더(워크트리 버블 포함). null 이면 최상위 캔버스. */
  currentFolderId: string | null;
  /** 휴지통 같은 내부 뷰. null 이면 평범한 캔버스. */
  interiorView: { kind: 'trash' } | null;
}

/**
 * 메인 뷰(최상위 캔버스)인가. 위 여섯 종의 **렌더 조건과 글자 그대로 같은 식**이다 —
 * 렌더 쪽 조건이 바뀌면 이 함수도 함께 바뀌어야 하고, 그래서 한 줄로 붙여 둔다.
 */
export function isMainCanvasView(state: CanvasScopeState): boolean {
  return state.currentFolderId === null && state.interiorView === null;
}

/**
 * 지금 자리에서 "메인 뷰 전용 버블"을 만들 수 있는가.
 *
 * 만들 수 있으려면 그릴 자리가 있어야 하고(메인 뷰), 귀속시킬 프로젝트가 있어야 한다.
 * 프로젝트가 없을 때 조용히 만들어 두면 어느 탭에도 안 붙은 버블이 생긴다.
 */
export function canCreateMainViewBubble(
  state: CanvasScopeState & { activeProject: string | null },
): boolean {
  return isMainCanvasView(state) && !!state.activeProject;
}
