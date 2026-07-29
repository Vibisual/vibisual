// IDE 명령 입력 textarea 자동 높이 — IDEMainArea(TerminalInput)와 IDESidebar(insertSkill)가 공유.
//
// 자동 높이는 CSS `field-sizing: content` 에 위임한다 (Chromium 123+ — Electron 31=Chromium 126).
//   기존 JS autogrow(height='auto' 플립 → scrollHeight 읽기)는 키 입력마다 강제 동기 레이아웃을
//   핸들러+effect 2회 유발했고, 높이 변경이 flex 조상(스트림 영역)까지 더럽혀 세션이 길어질수록
//   타이핑 에코가 늦어졌다. 지원 브라우저에선 JS 높이 조작을 전부 끄고 브라우저 레이아웃 패스에
//   맡긴다(입력 시 캐럿 가시성도 네이티브가 유지). 미지원 환경만 JS 폴백.
//
// ⚠ field-sizing 지원 환경에서 이 textarea 에 인라인 `height` 를 절대 남기지 말 것.
//   명시 height 가 있으면 field-sizing 의 내용 기반 높이 계산이 통째로 무력화돼, 컴포넌트가
//   리마운트되기 전까지 자동 확장이 죽는다(사이드바 스킬 클릭 경로가 구식 120px 상한 인라인
//   height 를 박아 "간헐적으로 안 늘어나고 프로젝트 전환 후 복귀하면 늘어나는" 버그의 원인이었음).
//   그래서 지원 환경의 autosizeInput 은 no-op 이 아니라 "남은 인라인 height 제거"까지 수행한다.

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
