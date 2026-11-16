/**
 * 떠 있는 판·툴팁을 포털할 곳. 전체 화면 중에는 그 요소 밖이 그려지지 않으므로 그 안에 세운다(§5.13 37-24 (E)).
 * 평소에는 문서 몸.
 */
export function overlayRoot(): HTMLElement {
  const fs = document.fullscreenElement;
  return fs instanceof HTMLElement ? fs : document.body;
}
