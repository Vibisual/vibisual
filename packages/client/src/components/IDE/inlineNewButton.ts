/** §5.5 #17-40 — 탭이 꽉 차면 인라인 `+` 는 물러난다(고정 `+` 와 붙어 두 번 찍힌 듯 보인다 — 고정 `+` 는 늘 있다). 자기 폭은 세지 않는다 — 세면 숨김↔표시가 진동한다. */

/** 인라인 `+` 버튼의 가로 크기(px) — 탭바의 `h-8 w-8` 과 같은 값. */
export const INLINE_NEW_WIDTH = 32;

/**
 * 인라인 `+` 와 오른쪽 고정 `+` 사이에 최소한 남아 있어야 하는 빈 자리(px).
 * 이보다 좁으면 두 아이콘이 한 덩어리로 읽힌다 — 그게 "붙었다"의 정의다.
 */
export const INLINE_NEW_MIN_GAP = 24;

/**
 * 인라인 `+` 를 보일 것인가.
 * @param tabsRight 마지막 탭 오른쪽 끝(스크롤 콘텐츠 좌표, `offsetLeft + offsetWidth`, 없으면 0).
 * @param clientWidth 탭 스크롤 영역의 보이는 폭(그 너머가 고정 `+`). 넘쳐 스크롤이 생기면 자연히 거짓.
 */
export function shouldShowInlineNew(
  tabsRight: number,
  clientWidth: number,
  buttonWidth: number = INLINE_NEW_WIDTH,
  minGap: number = INLINE_NEW_MIN_GAP,
): boolean {
  // 아직 폭을 재지 못한 순간(마운트 직후·숨은 창)은 화면을 건드리지 않는다 — 기본값은 보임.
  if (clientWidth <= 0) return true;
  return tabsRight + buttonWidth + minGap <= clientWidth;
}
