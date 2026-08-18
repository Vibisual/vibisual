import type { AgentQuestionItem, AgentQuestions } from '@vibisual/shared';

/**
 * 질문 카드 복사 텍스트 조립 — 카드 전체 / 질문만 / 질문 하나.
 *
 * 종전에는 이 조립이 `AgentQuestionCard` 안 `useCallback` 두 개에 흩어져 있어 "질문 하나만 복사"를
 * 붙이려면 같은 형식(번호 접두어·`[헤더]`·답지 들여쓰기)을 세 번째로 베껴야 했다. 형식이 한 곳에만
 * 있어야 세 버튼이 **같은 모양**의 텍스트를 내놓는다(사용자가 붙여넣고 나서 손볼 게 없다).
 * DOM 을 쓰지 않는 순수 함수라 그대로 단위 테스트한다.
 */

/** 질문 한 줄 — `1. [헤더] 질문본문`. 단일 질문 카드(`multi=false`)면 번호를 붙이지 않는다. */
export function formatQuestionLine(item: AgentQuestionItem, index: number, multi: boolean): string {
  const prefix = multi ? `${index + 1}. ` : '';
  const header = item.header ? `[${item.header}] ` : '';
  return `${prefix}${header}${item.question}`;
}

/** 질문 하나 + 그 제안 답들(`  - `). 질문 행의 복사 글리프가 쓴다. */
export function buildSingleQuestionText(item: AgentQuestionItem, index: number, multi: boolean): string {
  const lines = [formatQuestionLine(item, index, multi)];
  item.prompts.forEach((p) => lines.push(`  - ${p}`));
  return lines.join('\n').trim();
}

/** 카드 전체 — note + 모든 질문(헤더 포함) + 제안 답들. */
export function buildQuestionCardText(questions: AgentQuestions): string {
  const multi = questions.items.length > 1;
  const lines: string[] = [];
  if (questions.note) { lines.push(questions.note, ''); }
  questions.items.forEach((item, i) => {
    lines.push(formatQuestionLine(item, i, multi));
    item.prompts.forEach((p) => lines.push(`  - ${p}`));
    if (i < questions.items.length - 1) lines.push('');
  });
  return lines.join('\n').trim();
}

/** 질문만 — 제안 답 없이 질문 텍스트(헤더 포함)만. */
export function buildQuestionsOnlyText(questions: AgentQuestions): string {
  const multi = questions.items.length > 1;
  return questions.items.map((item, i) => formatQuestionLine(item, i, multi)).join('\n');
}
