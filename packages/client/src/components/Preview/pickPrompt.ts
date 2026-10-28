import type { PreviewPickPayload } from '@vibisual/shared';

/** §7.11 — 집은 요소 + 한 문장 → 명령(선택자·보이는 글·좌표로 에이전트의 재탐색을 없앤다). */

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

/** 문장이 비면 빈 문자열 — 호출부는 보내지 않는다(요소만 보내면 턴이 헛돈다). */
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
