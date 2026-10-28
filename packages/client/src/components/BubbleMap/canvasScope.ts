/**
 * §5.7 #26 · §5.9 / §5.13~§5.15 / §5.18 / §5.20 — 이 캔버스가 그 버블을 그릴 수 있는 자리인가.
 * 캡처·앱·플레이·스펙·랩·선반은 메인 뷰에서만 렌더된다(산식 첫 줄 `if (currentFolderId !== null || interiorView !== null) return []`)
 * — 그릴 수 없는 자리에선 만들지도 메뉴에 내지도 않는다(만들면 부모 탭에 유령이 앉는다).
 * 메뉴(감추기)와 생성(막기)이 같은 답을 써야 해서 여기 한 곳이다 — 어긋나면 다른 길로 만들어진다(picker 를 연 채 폴더로 들어가기).
 * 에이전트 5종·워크트리 생성은 `selectEffectiveProject` 로 귀속되고 폴더 안에서도 그려져 해당 없다.
 */
export interface CanvasScopeState {
  /** 드릴다운한 폴더(워크트리 버블 포함). null 이면 최상위 캔버스. */
  currentFolderId: string | null;
  /** 휴지통 · 묶음 안 같은 내부 뷰(`InteriorView`). null 이면 평범한 캔버스. 종류는 여기서 가르지 않는다. */
  interiorView: { readonly kind: string } | null;
}

/** 위 여섯 종의 렌더 조건과 글자 그대로 같은 식 — 렌더 쪽이 바뀌면 같이 바꿀 것. */
export function isMainCanvasView(state: CanvasScopeState): boolean {
  return state.currentFolderId === null && state.interiorView === null;
}

/** 프로젝트 없이 만들면 어느 탭에도 안 붙은 버블이 생긴다. */
export function canCreateMainViewBubble(
  state: CanvasScopeState & { activeProject: string | null },
): boolean {
  return isMainCanvasView(state) && !!state.activeProject;
}
