import type { IDEViewType } from '../../stores/graphStore.js';

/**
 * §5.19 (G) — 로컬 버블(All Model)의 IDE 좌측 활동바에 남는 항목.
 *
 * 같은 IDE 를 쓰되 같은 얼굴을 하지는 않는다. 클로드 CLI 에 매인 항목(MCP·컨텍스트 주입원·
 * 스킬·훅·플러그인·백그라운드 서브에이전트)은 로컬 프로바이더에 **존재하지 않는 기능**이라,
 * 입구만 남겨 두면 눌러 본 사용자가 빈 화면을 본다 — 없는 기능의 입구는 거짓말이다.
 *
 * 남는 것은 프로바이더와 무관하게 뜻이 통하는 것들뿐이다:
 * 파일(폴더) · 디버그/실행 · 북마크 · 세션 요약 · 목표 · 루프.
 */
export const LOCAL_PROVIDER_VIEWS: readonly IDEViewType[] = [
  'files', 'debug', 'bookmarks', 'summary', 'goal', 'loop',
];

/** 이 항목이 지금 에이전트에게 뜻이 있는가. 로컬이 아니면(=클로드) 종전 그대로 전부 보인다. */
export function isViewAllowedForProvider(view: IDEViewType, isLocalProvider: boolean): boolean {
  return !isLocalProvider || LOCAL_PROVIDER_VIEWS.includes(view);
}

/**
 * 지금 열려 있는 뷰가 이 에이전트에게 없는 것이면 대신 열 뷰.
 * 클로드 버블을 보다가 로컬 버블로 갈아탔을 때 사이드바가 빈 화면으로 남지 않게 한다.
 */
export function fallbackViewForProvider(view: IDEViewType, isLocalProvider: boolean): IDEViewType {
  return isViewAllowedForProvider(view, isLocalProvider) ? view : 'files';
}
