/**
 * 질문 카드 복사 텍스트 — 전체 / 질문만 / 질문 하나가 **같은 형식**을 내는지.
 *
 * 세 버튼이 각자 형식을 만들면 사용자가 붙여넣은 뒤 번호·들여쓰기를 손봐야 한다. 특히 "질문 하나만
 * 복사"는 카드 전체 복사에서 그 질문 구획을 오려낸 것과 글자 단위로 같아야 한다 — 그걸 여기서 못 박는다.
 */
import { describe, it, expect } from 'vitest';
import type { AgentQuestions } from '@vibisual/shared';
import {
  formatQuestionLine,
  buildSingleQuestionText,
  buildQuestionCardText,
  buildQuestionsOnlyText,
  collectCheckedAnswers,
  formatCheckedAnswers,
} from './questionCardText.js';

const MULTI: AgentQuestions = {
  id: 'q1',
  agentId: 'agent-1',
  note: '두 가지만 정해 주세요.',
  createdAt: 0,
  items: [
    { question: '대량 이동을 지금 할까요?', header: '이동 타이밍', prompts: ['지금 옮겨 주세요.', '다음 턴에 하죠.'] },
    { question: '헤더는 어디에 둘까요?', prompts: ['Public/ 아래로.'] },
  ],
};

const SINGLE: AgentQuestions = {
  id: 'q2',
  agentId: 'agent-1',
  createdAt: 0,
  items: [{ question: '이대로 진행할까요?', prompts: [] }],
};

describe('formatQuestionLine', () => {
  it('다중 질문은 번호 + [헤더] 접두어', () => {
    expect(formatQuestionLine(MULTI.items[0]!, 0, true)).toBe('1. [이동 타이밍] 대량 이동을 지금 할까요?');
  });

  it('단일 질문 카드는 번호를 붙이지 않는다', () => {
    expect(formatQuestionLine(SINGLE.items[0]!, 0, false)).toBe('이대로 진행할까요?');
  });

  it('헤더가 없으면 대괄호도 없다', () => {
    expect(formatQuestionLine(MULTI.items[1]!, 1, true)).toBe('2. 헤더는 어디에 둘까요?');
  });
});

describe('buildQuestionCardText', () => {
  it('note + 질문 + 답지(들여쓰기), 질문 사이 빈 줄', () => {
    expect(buildQuestionCardText(MULTI)).toBe(
      [
        '두 가지만 정해 주세요.',
        '',
        '1. [이동 타이밍] 대량 이동을 지금 할까요?',
        '  - 지금 옮겨 주세요.',
        '  - 다음 턴에 하죠.',
        '',
        '2. 헤더는 어디에 둘까요?',
        '  - Public/ 아래로.',
      ].join('\n'),
    );
  });

  it('note 없는 단일 질문 — 앞뒤 빈 줄 없이 한 줄', () => {
    expect(buildQuestionCardText(SINGLE)).toBe('이대로 진행할까요?');
  });
});

describe('buildQuestionsOnlyText', () => {
  it('답지를 빼고 질문 줄만', () => {
    expect(buildQuestionsOnlyText(MULTI)).toBe('1. [이동 타이밍] 대량 이동을 지금 할까요?\n2. 헤더는 어디에 둘까요?');
  });
});

describe('buildSingleQuestionText', () => {
  it('질문 하나 + 그 답지들', () => {
    expect(buildSingleQuestionText(MULTI.items[0]!, 0, true)).toBe(
      '1. [이동 타이밍] 대량 이동을 지금 할까요?\n  - 지금 옮겨 주세요.\n  - 다음 턴에 하죠.',
    );
  });

  it('카드 전체 복사에서 그 질문 구획을 오려낸 것과 글자까지 같다', () => {
    const whole = buildQuestionCardText(MULTI).split('\n\n');
    // [0]=note, [1]=1번 구획, [2]=2번 구획
    expect(whole[1]).toBe(buildSingleQuestionText(MULTI.items[0]!, 0, true));
    expect(whole[2]).toBe(buildSingleQuestionText(MULTI.items[1]!, 1, true));
  });

  it('답지가 없으면 질문 한 줄만', () => {
    expect(buildSingleQuestionText(SINGLE.items[0]!, 0, false)).toBe('이대로 진행할까요?');
  });
});

/**
 * 체크박스로 고른 답 — `선택 복사` 와 `선택한 N개 전송` 이 **같은 것**을 내놓아야 한다.
 * 사용자 보고: 답지에 체크를 해 놨는데 `선택 복사` 버튼이 회색이라 누를 수 없었다(원천이 드래그 선택
 * 하나뿐이었다). 여기서는 그 "고른 것"의 조립 규칙을 못 박는다.
 */
describe('collectCheckedAnswers', () => {
  it('고른 답만 질문/답 순서대로 모은다', () => {
    const selected = { 0: new Set([1]), 1: new Set([0]) };
    expect(collectCheckedAnswers(MULTI, selected, {}).prompts).toEqual(['다음 턴에 하죠.', 'Public/ 아래로.']);
  });

  it('한 질문에서 여러 개를 골라도 그 질문의 답지 순서를 지킨다', () => {
    const selected = { 0: new Set([1, 0]) }; // 넣은 순서가 뒤집혀 있어도 화면 순서대로.
    expect(collectCheckedAnswers(MULTI, selected, {}).prompts).toEqual(['지금 옮겨 주세요.', '다음 턴에 하죠.']);
  });

  it('이미 답한 질문의 체크는 세지 않는다 — 그 질문은 잠겨 다시 답할 수 없다', () => {
    const selected = { 0: new Set([0]), 1: new Set([0]) };
    expect(collectCheckedAnswers(MULTI, selected, { 0: 1 }).prompts).toEqual(['Public/ 아래로.']);
  });

  it('질문 잠금은 그 질문에서 첫 번째로 고른 답 기준', () => {
    const selected = { 0: new Set([1, 0]) };
    expect(collectCheckedAnswers(MULTI, selected, {}).lockNext).toEqual({ 0: 0 });
  });

  it('아무것도 안 골랐으면 빈 벌', () => {
    expect(collectCheckedAnswers(MULTI, {}, {})).toEqual({ prompts: [], lockNext: {} });
    expect(collectCheckedAnswers(MULTI, { 0: new Set() }, {})).toEqual({ prompts: [], lockNext: {} });
  });
});

describe('formatCheckedAnswers', () => {
  it('답 사이는 빈 줄, 질문 줄은 얹지 않는다 — 전송도 이 함수를 지나므로 붙여넣은 것과 보낸 것이 같다', () => {
    const selected = { 0: new Set([0]), 1: new Set([0]) };
    expect(formatCheckedAnswers(collectCheckedAnswers(MULTI, selected, {}))).toBe('지금 옮겨 주세요.\n\nPublic/ 아래로.');
  });

  it('하나만 고르면 그 답 한 벌 그대로', () => {
    expect(formatCheckedAnswers(collectCheckedAnswers(MULTI, { 1: new Set([0]) }, {}))).toBe('Public/ 아래로.');
  });

  it('고른 게 없으면 빈 문자열 — 버튼이 헛된 복사 피드백을 내지 않는다', () => {
    expect(formatCheckedAnswers(collectCheckedAnswers(MULTI, {}, {}))).toBe('');
  });
});
