import type { AgentQuestionItem, AgentQuestions } from '@vibisual/shared';

/** 제안 인덱스(0 이상)와 겹치지 않는 직접 답변의 선택 키. */
export const CUSTOM_ANSWER_INDEX = -1;

/** 짧은 직접 답도 어느 질문에 대한 답인지 복사·전송할 때 함께 남긴다. */
export function buildCustomAnswerText(item: AgentQuestionItem, index: number, multi: boolean, answer: string): string {
  const text = answer.trim();
  return text ? `${formatQuestionLine(item, index, multi)}\n${text}` : '';
}

/** 질문 카드 복사 텍스트 조립 — 형식(번호·`[헤더]`·답지 들여쓰기)을 이 한 곳에 둬 세 버튼이 같은 모양을 낸다. */

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

/** 체크로 고른 답을 모은다 — 이미 답한(`answered`, 잠긴) 질문의 남은 체크는 세지 않는다. 전송과 복사가 함께 쓴다(붙여넣은 것 = 보낸 것). */
export function collectCheckedAnswers(
  questions: AgentQuestions,
  selected: Readonly<Record<number, ReadonlySet<number>>>,
  answered: Readonly<Record<number, number>>,
  customAnswers: Readonly<Record<number, string>> = {},
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
    if (set.has(CUSTOM_ANSWER_INDEX)) {
      const text = buildCustomAnswerText(item, qi, questions.items.length > 1, customAnswers[qi] ?? '');
      if (text) {
        prompts.push(text);
        if (lockNext[qi] === undefined) lockNext[qi] = CUSTOM_ANSWER_INDEX;
      }
    }
  });
  return { prompts, lockNext };
}

/** 고른 답을 한 텍스트로(답 사이 빈 줄, 전송·복사 공용). 질문 줄은 얹지 않는다 — 붙여넣어 고쳐 보내는 용도라 군더더기다(질문까지는 `카드 전체 복사`). */
export function formatCheckedAnswers(collected: CheckedAnswers): string {
  return collected.prompts.join('\n\n');
}
