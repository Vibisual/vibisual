/**
 * IDE 제목 줄 손짓 판정 — 제목 줄 DOM 안에서 시작한 **누름·더블클릭**을 제목 줄의 것
 * (창 끌기 · 최대화 토글 · 이름 편집)으로 받을지, **그 자리의 것**으로 둘지 한 곳에서 정한다.
 *
 * 왜 따로 두는가: 제목 줄 DOM 안에는 버튼만 있는 게 아니다. 이름 바꾸기 입력칸, 그리고 제목 줄
 * 버튼이 펼치는 팝업(읽기 설정 · 붙이기 메뉴)이 같은 DOM 가지 아래 그려진다. 종전 판정은
 * "버튼인가 · 이름인가" 둘만 봐서, 그 안에서 시작한 손짓이 제목 줄까지 올라와
 *   ① 이름 입력칸 더블클릭(낱말 고르기)이 이름 편집을 **처음부터 다시 시작해 친 글자를 지웠고**
 *   ② 팝업 안 빈 곳(안내 글 · 여백 · 슬라이더) 더블클릭이 **창을 최대화/복원했고**
 *   ③ 붙이기 메뉴 안 빈 곳을 누른 채 움직이면 **창이 끌려갔다**.
 * 판정은 DOM 없이 시험할 수 있게 `closest` 하나만 요구한다(클라 시험에는 DOM 이 없다).
 */

/** 제목 줄 버튼이 펼친 팝업의 바깥 상자에 다는 표식 — 그 안의 손짓은 팝업의 것이다. */
export const TITLE_BAR_POPUP_ATTR = 'data-ide-titlebar-popup';

/** 제목 줄 손짓으로 받지 않는 자리 — 글자를 받는 칸과, 제목 줄 버튼이 펼친 팝업 안. */
export const TITLE_BAR_FOREIGN_SELECTOR = `input, textarea, select, [${TITLE_BAR_POPUP_ATTR}]`;

/** 에이전트 이름(표시 글자 · 바꾸는 입력칸 모두)에 다는 표식. */
const AGENT_NAME_SELECTOR = '[data-ide-agent-name]';

/** 판정이 요구하는 최소 계약 — `Element.closest` 와 같은 뜻. */
export interface TitleBarGestureTarget {
  closest(selector: string): unknown;
}

export type TitleBarDoubleClickAction = 'rename' | 'maximize' | 'none';

/** 제목 줄 더블클릭이 할 일. 이름 위면 이름 편집, 빈 곳이면 최대화 토글, 나머지는 아무것도. */
export function titleBarDoubleClickAction(target: TitleBarGestureTarget): TitleBarDoubleClickAction {
  // 입력칸 안의 더블클릭은 낱말 고르기다 — 이름 입력칸에도 이름 표식이 붙어 있어 이 줄이 먼저여야 한다.
  if (target.closest(TITLE_BAR_FOREIGN_SELECTOR)) return 'none';
  if (target.closest(AGENT_NAME_SELECTOR)) return 'rename';
  if (target.closest('button')) return 'none';
  return 'maximize';
}

/** 제목 줄 누름이 창 끌기를 시작하는가. 버튼 · 이름 · 입력칸 · 팝업 안에서 시작한 누름은 아니다. */
export function titleBarPressStartsDrag(target: TitleBarGestureTarget): boolean {
  return !target.closest(TITLE_BAR_FOREIGN_SELECTOR)
    && !target.closest(AGENT_NAME_SELECTOR)
    && !target.closest('button');
}
