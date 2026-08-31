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

/** 체크박스로 고른 답 한 벌 — 전송과 복사가 **같은 것**을 내놓게 하는 중간 산물. */
export interface CheckedAnswers {
  /** 고른 답 본문들 — 질문 순서 → 답지 순서. */
  prompts: string[];
  /** 질문 잠금(질문마다 첫 선택 답 기준) — `questionIdx → promptIdx`. 전송할 때만 쓴다. */
  lockNext: Record<number, number>;
}

/**
 * 체크박스로 고른 답을 모은다 — **이미 답한 질문(`answered`)의 체크는 세지 않는다**(그 질문은 잠겨
 * 있어 다시 답할 수 없으므로, 남아 있던 체크는 유효한 선택이 아니다).
 *
 * 전송(`선택한 N개 전송`)과 복사(`선택 복사`)가 이 함수 하나를 함께 쓴다 — 각자 조립하면 "붙여넣은
 * 것"과 "보낸 것"이 서로 달라지고, 그 차이는 사용자가 붙여넣기 전에는 알 수 없다.
 */
export function collectCheckedAnswers(
  questions: AgentQuestions,
  selected: Readonly<Record<number, ReadonlySet<number>>>,
  answered: Readonly<Record<number, number>>,
): CheckedAnswers {
  const prompts: string[] = [];
  const lockNext: Record<number, number> = {};
  questions.items.forEach((item, qi) => {
    if (answered[qi] !== undefined) return;
    const set = selected[qi];
    if (!set || set.size === 0) return;
    item.prompts.forEach((p, pi) => {
      if (!set.has(pi)) return;
      prompts.push(p);
      if (lockNext[qi] === undefined) lockNext[qi] = pi;
    });
  });
  return { prompts, lockNext };
}

/**
 * 고른 답 한 벌을 하나의 텍스트로 — 답 사이는 빈 줄. **전송도 복사도 이 함수를 지난다**(그래서 붙여넣은
 * 것과 보낸 것이 글자까지 같다).
 *
 * 질문 줄을 얹지 않는 이유: 이 텍스트의 쓰임은 "내가 고른 답을 그대로 붙여넣어 조금 고쳐 보내기"라
 * 질문 원문은 붙여넣는 쪽에서 지워야 하는 군더더기다(질문까지 필요하면 `카드 전체 복사`가 있다).
 */
export function formatCheckedAnswers(collected: CheckedAnswers): string {
  return collected.prompts.join('\n\n');
}
