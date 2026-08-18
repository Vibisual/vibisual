/**
 * §5.5 #17-9 ⑦(b) 확장 — 잃어버린 자식 보고 구조.
 *
 * 여기서 지키는 것은 **"마지막 말"의 정의**다. 트랜스크립트 꼬리에는 도구 호출만 든 assistant 줄이
 * 잔뜩 쌓이는데, 그걸 보고로 착각하면 카드에 빈 글이 뜨고 사용자는 "복구했다면서 왜 아무것도 없냐"를
 * 보게 된다. 실측 트랜스크립트(`a2e867f0bd3d6bbcb`, 209줄)의 마지막 세 줄이 정확히 그 모양이었다.
 */

import { describe, it, expect } from 'vitest';
import { extractLastAssistantText } from './subagentResultRescue.js';
import { SUBAGENT_RESULT_MAX } from './subagentActivity.js';

/** assistant 한 줄 만들기 — 실제 JSONL 모양 그대로. */
function assistantLine(blocks: unknown[]): string {
  return JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: blocks } });
}
function textBlock(text: string): unknown { return { type: 'text', text }; }
function toolUseBlock(name: string): unknown { return { type: 'tool_use', name, input: {} }; }
function userLine(text: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
}

describe('extractLastAssistantText', () => {
  it('마지막 assistant 본문을 돌려준다', () => {
    const lines = [
      userLine('작업해라'),
      assistantLine([textBlock('먼저 읽겠습니다.')]),
      assistantLine([textBlock('상태 확인 완료 — item 1은 f648758로 커밋됐다.')]),
    ];
    expect(extractLastAssistantText(lines)).toBe('상태 확인 완료 — item 1은 f648758로 커밋됐다.');
  });

  it('도구 호출만 든 assistant 줄은 건너뛴다 — 그게 꼬리의 기본 모양이다', () => {
    const lines = [
      assistantLine([textBlock('조사 완료. 결과를 질문 번호별로 정리한다.')]),
      assistantLine([toolUseBlock('Bash')]),
      assistantLine([toolUseBlock('Read')]),
    ];
    expect(extractLastAssistantText(lines)).toBe('조사 완료. 결과를 질문 번호별로 정리한다.');
  });

  it('같은 줄의 text 블록들을 이어 붙인다', () => {
    const lines = [assistantLine([textBlock('앞부분 '), toolUseBlock('Read'), textBlock('뒷부분')])];
    expect(extractLastAssistantText(lines)).toBe('앞부분 뒷부분');
  });

  it('깨진 줄(꼬리 절단 조각)은 조용히 넘긴다', () => {
    const lines = ['{"type":"assis', assistantLine([textBlock('멀쩡한 보고')]), '}}}not json'];
    expect(extractLastAssistantText(lines)).toBe('멀쩡한 보고');
  });

  it('assistant 가 없거나 본문이 비면 undefined', () => {
    expect(extractLastAssistantText([userLine('a'), userLine('b')])).toBeUndefined();
    expect(extractLastAssistantText([assistantLine([textBlock('   ')])])).toBeUndefined();
    expect(extractLastAssistantText([])).toBeUndefined();
  });

  it('결과 예산(1,200자)을 넘으면 말줄임으로 자른다 — 카드 한 장이 스트림을 먹지 않게', () => {
    const long = 'ㄱ'.repeat(SUBAGENT_RESULT_MAX + 500);
    const out = extractLastAssistantText([assistantLine([textBlock(long)])]);
    expect(out).toHaveLength(SUBAGENT_RESULT_MAX);
    expect(out?.endsWith('…')).toBe(true);
  });

  it('user 줄의 글은 절대 보고로 쓰지 않는다 — 그건 우리가 준 지시다', () => {
    const lines = [assistantLine([textBlock('진짜 보고')]), userLine('<task-notification>…</task-notification>')];
    expect(extractLastAssistantText(lines)).toBe('진짜 보고');
  });
});
