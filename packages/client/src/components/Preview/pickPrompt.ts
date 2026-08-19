import type { PreviewPickPayload } from '@vibisual/shared';

/**
 * §7.11 (판올림 번호 발급 대기) — 프리뷰에서 집은 요소 + 사용자의 한 문장을 **명령**으로 조립.
 *
 * "헤더 오른쪽 그 버튼" 처럼 말로 가리키던 것을 선택자·보이는 글·좌표로 바꿔, 에이전트가 코드에서
 * 다시 찾는 왕복을 없앤다. 조립을 컴포넌트가 아니라 여기 두는 이유는 `diffCommentPrompt.ts` 와 같다.
 */

/** 명령에 붙는 줄머리 — 화면에서 번역해 넣는다(모듈이 언어를 정하지 않는다). */
export interface PickPromptLabels {
  page: string;
  element: string;
  selector: string;
  text: string;
  request: string;
}

export const DEFAULT_PICK_PROMPT_LABELS: PickPromptLabels = {
  page: 'page',
  element: 'element',
  selector: 'selector',
  text: 'visible text',
  request: 'request',
};

/** `div#hero.card.wide` — 화면에서 보이는 그대로의 요소 이름. */
export function describePickedElement(pick: PreviewPickPayload): string {
  let out = pick.tagName;
  if (pick.id !== undefined && pick.id !== '') out += `#${pick.id}`;
  for (const c of pick.classes.slice(0, 3)) {
    if (c !== '') out += `.${c}`;
  }
  if (pick.testId !== undefined && pick.testId !== '') out += `[data-testid=${pick.testId}]`;
  return out;
}

/**
 * 집은 요소 + 사용자 문장 → 명령 텍스트.
 *
 * 사용자 문장이 비면 빈 문자열을 돌려주고, 호출부는 그때 아무 것도 보내지 않는다
 * (요소만 보내면 "이걸 어쩌라는 것인가"가 되어 턴 하나가 헛돈다).
 */
export function buildPickPrompt(
  pick: PreviewPickPayload,
  request: string,
  header: string,
  labels: PickPromptLabels = DEFAULT_PICK_PROMPT_LABELS,
): string {
  const body = request.trim();
  if (body === '') return '';
  const lines = [
    header,
    `- ${labels.page}: ${pick.pageUrl}`,
    `- ${labels.element}: ${describePickedElement(pick)}`,
    `- ${labels.selector}: ${pick.selector}`,
  ];
  if (pick.textSnippet !== '') lines.push(`- ${labels.text}: "${pick.textSnippet}"`);
  lines.push(`${labels.request}: ${body}`);
  return lines.join('\n');
}
