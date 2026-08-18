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
