/**
 * §4 (스트림 3종) — **CLI 가 주는데 우리가 못 받던 것**들이 실제로 도착하는지 못 박는 자리.
 *
 * 이 셋은 플래그를 붙이는 것만으로는 안 된다. 특히 ①은 설치본 실측이 이렇다:
 *   - 전달된 서브에이전트 텍스트는 **완성 `assistant` 메시지로만** 오고 **델타가 없다**.
 *   - 그런데 우리 파서는 partial 모드에서 완성 text/thinking 블록을 **버린다**(델타와 중복이라서).
 *   → 그대로 두면 플래그를 켜도 화면에 한 글자도 안 나온다. 인자·타입·저장이 전부 멀쩡한 채
 *     기능만 없는, 어느 검사에도 안 걸리는 종류의 사고다.
 *
 * 그래서 여기서는 "플래그가 나가는가"가 아니라 **"그 줄이 이벤트가 되는가"** 를 검사한다.
 */
import { describe, it, expect } from 'vitest';
import { parseStreamLine } from './subAgentManager.js';

const SUB = 'sub-1';
const PARENT = 'agent-1';

/** partial(= `--include-partial-messages`) 켠 상태로 한 줄 파싱 — 우리 기본 스폰과 같은 조건. */
const parsePartial = (obj: Record<string, unknown>) =>
  parseStreamLine(obj, SUB, PARENT, { partialMessages: true });

/** 중첩 서브에이전트가 한 말 한 줄(실측 원문 모양). */
const nestedAssistant = (blocks: unknown[], parent = 'toolu_parent') => ({
  type: 'assistant',
  parent_tool_use_id: parent,
  message: { role: 'assistant', content: blocks },
});

describe('① --forward-subagent-text — 중첩 서브에이전트의 말', () => {
  it('partial 모드에서도 방출된다 — 이 줄들은 델타가 없어서 버리면 끝이다', () => {
    const events = parsePartial(nestedAssistant([{ type: 'text', text: 'PONG' }]));
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('text');
    expect(events[0]!.content).toBe('PONG');
  });

  it('어느 Task 밑인지 함께 실린다 — 없으면 부모가 한 말과 구분되지 않는다', () => {
    const events = parsePartial(nestedAssistant([{ type: 'text', text: 'PONG' }], 'toolu_abc'));
    expect(events[0]!.nestedUnderToolUseId).toBe('toolu_abc');
  });

  it('사고 블록도 같은 규칙으로 온다', () => {
    const events = parsePartial(nestedAssistant([{ type: 'thinking', thinking: '어디 보자' }]));
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('thinking');
    expect(events[0]!.nestedUnderToolUseId).toBe('toolu_parent');
  });

  it('중첩이 부른 도구도 소속을 들고 온다', () => {
    const events = parsePartial(nestedAssistant([{ type: 'tool_use', id: 'toolu_inner', name: 'Read', input: { file_path: 'a.ts' } }]));
    expect(events[0]!.eventType).toBe('tool_use');
    expect(events[0]!.toolUseId).toBe('toolu_inner');
    expect(events[0]!.nestedUnderToolUseId).toBe('toolu_parent');
  });

  it('부모 자신의 말은 종전 그대로 — partial 이면 완성 블록을 여전히 버린다(중복 방지)', () => {
    const own = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '내가 한 말' }] } };
    expect(parsePartial(own)).toHaveLength(0);
    // partial 이 아니면 종전처럼 나온다.
    expect(parseStreamLine(own, SUB, PARENT, {})).toHaveLength(1);
  });

  it('부모의 말에는 소속 표식이 붙지 않는다', () => {
    const own = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '내가 한 말' }] } };
    const events = parseStreamLine(own, SUB, PARENT, {});
    expect(events[0]!.nestedUnderToolUseId).toBeUndefined();
  });
});

describe('② --replay-user-messages — 명령 접수 확인', () => {
  it('되돌아온 사용자 메시지는 칩 한 줄이 된다 — 본문을 두 번 그리지 않는다', () => {
    const events = parsePartial({
      type: 'user',
      isReplay: true,
      message: { role: 'user', content: [{ type: 'text', text: '아주 긴 명령 본문' }] },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('system');
    expect(events[0]!.content).toContain('command_received');
    expect(events[0]!.content).not.toContain('아주 긴 명령 본문');
  });

  it('평범한 user 줄(도구 결과)은 종전 그대로 간다', () => {
    const events = parsePartial({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_x', content: '결과' }] },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('tool_result');
    expect(events[0]!.toolUseId).toBe('toolu_x');
  });

  it('중첩 서브에이전트의 도구 결과도 소속을 들고 온다', () => {
    const events = parsePartial({
      type: 'user',
      parent_tool_use_id: 'toolu_parent',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_inner', content: '결과' }] },
    });
    expect(events[0]!.nestedUnderToolUseId).toBe('toolu_parent');
  });
});

describe('③ --prompt-suggestions — 다음 프롬프트 제안', () => {
  it('제안 글이 있으면 칩으로 나온다', () => {
    const events = parsePartial({ type: 'prompt_suggestion', suggestion: '테스트도 붙여 주세요' });
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('system');
    expect(events[0]!.content).toContain('prompt_suggestion');
    expect(events[0]!.content).toContain('테스트도 붙여 주세요');
  });

  it('모양이 다르면 **아무것도 만들지 않는다** — 본문을 지어내지 않는다', () => {
    expect(parsePartial({ type: 'prompt_suggestion', foo: 42 })).toHaveLength(0);
    expect(parsePartial({ type: 'prompt_suggestion' })).toHaveLength(0);
  });

  it('모르는 타입은 종전처럼 조용히 버려진다 — 새 이벤트가 스트림을 깨지 않는다는 근거', () => {
    expect(parsePartial({ type: 'rate_limit_event', foo: 1 })).toHaveLength(0);
    expect(parsePartial({ type: '완전히_새로운_타입' })).toHaveLength(0);
  });
});
