/**
 * §5.5 #17-40 — 탭이 꽉 차면 **인라인 `+`(새 세션)** 는 물러난다.
 *
 * 세션 탭 줄에는 `+` 가 둘이다 — 마지막 탭 바로 옆에 붙어 따라다니는 **인라인** 하나(크롬식),
 * 탭바 오른쪽 끝에 고정된 하나. 탭이 적을 때는 둘이 멀리 떨어져 각자 뜻이 분명하지만, 세션이
 * 늘어 탭이 폭을 다 먹으면 인라인 `+` 가 오른쪽 `+` 바로 옆까지 밀려와 **같은 버튼이 두 번**
 * 찍힌 것처럼 보인다(사용자 보고 — "세션들이 많아져서 서로 붙게 된 경우"). 그때는 인라인 쪽을
 * 감춘다. 오른쪽 고정 `+` 는 스크롤 영역 밖이라 항상 그 자리에 있으므로 **세션을 새로 만들 길이
 * 사라지지는 않는다.**
 *
 * 판정을 여기 순수 함수로 두는 이유는 두 가지다.
 * 1. DOM 좌표(`offsetLeft`/`offsetWidth`/`clientWidth`)만 받는 계산이라 그대로 단위 테스트가 된다
 *    (#17-9 ④(b) `hiddenRunningTabs.ts` 선례).
 * 2. **자기 자신의 폭을 세지 않는다** — 인라인 버튼이 지금 떠 있는지와 무관하게 *탭이 끝나는
 *    자리*만으로 답을 낸다. 자기가 차지한 폭을 세면 "숨겼더니 자리가 남아서 다시 뜨고, 뜨니까
 *    다시 좁아져 숨는" 진동이 생긴다.
 */

/** 인라인 `+` 버튼의 가로 크기(px) — 탭바의 `h-8 w-8` 과 같은 값. */
export const INLINE_NEW_WIDTH = 32;

/**
 * 인라인 `+` 와 오른쪽 고정 `+` 사이에 최소한 남아 있어야 하는 빈 자리(px).
 * 이보다 좁으면 두 아이콘이 한 덩어리로 읽힌다 — 그게 "붙었다"의 정의다.
 */
export const INLINE_NEW_MIN_GAP = 24;

/**
 * 인라인 `+` 를 보일 것인가.
 *
 * @param tabsRight   마지막 세션 탭의 오른쪽 끝(스크롤 콘텐츠 좌표계, `offsetLeft + offsetWidth`).
 *                    탭이 없으면 0.
 * @param clientWidth 세션 탭 스크롤 영역의 보이는 폭. 이 폭의 오른쪽 경계 바로 너머가 고정 `+` 다.
 *
 * 탭이 넘쳐 스크롤이 생긴 경우(`tabsRight > clientWidth`)도 자연히 거짓이 된다 — 끝까지 밀면
 * 인라인 `+` 가 고정 `+` 에 그대로 맞닿기 때문이다.
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
