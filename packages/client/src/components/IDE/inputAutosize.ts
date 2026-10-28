// IDE 명령 입력 textarea 자동 높이 — CSS `field-sizing: content`(Chromium 123+, Electron 31=126)에 맡기고 미지원만 JS 폴백(JS autogrow 는 키마다 강제 레이아웃이라 긴 세션 타이핑이 늦어진다).
// ⚠ 지원 환경에서 인라인 `height` 를 남기지 마라 — 자동 확장이 리마운트까지 죽는다(그래서 autosizeInput 이 지운다).

export const INPUT_FIELD_SIZING =
  typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content');

// 입력창 최대 높이 = 9줄(leading-7 = 28px/줄, 28*9=252). 이 값을 넘으면 스크롤로 전환.
//   종전 120px(≈4줄)은 너무 낮아 조금만 써도 위 줄이 스크롤 밖으로 밀려 가려졌다.
export const INPUT_MAX_HEIGHT = 252;

export function autosizeInput(el: HTMLTextAreaElement): void {
  if (INPUT_FIELD_SIZING) {
    // 자가 치유: 어떤 경로가 인라인 height 를 남겼다면 걷어내 field-sizing 을 복원한다.
    //   el.style.height 는 인라인 스타일 문자열 읽기라 강제 reflow 가 없다 — 타이핑 핫패스 안전.
    if (el.style.height) el.style.height = '';
    return;
  }
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_HEIGHT)}px`;
}
