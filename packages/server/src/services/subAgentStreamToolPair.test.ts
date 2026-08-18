import { describe, it, expect } from 'vitest';
import { parseStreamLine } from './subAgentManager.js';

/**
 * §5.5 #17-27 ⑪ — **도구 결과도 자기 호출의 `tool_use_id` 를 달고 나가야 한다.**
 *
 * `SubAgentStreamEvent.toolUseId` 규약은 처음부터 양쪽(호출·결과)을 전제했는데 결과 쪽이 비어 있었다.
 * 그래서 클라 [추종]은 호출 순서(FIFO)로 짐작할 수밖에 없었고, **결과가 끝내 오지 않는 호출**
 * (중지·거부·창 밖에서 시작된 호출)이 하나만 있어도 그 뒤 전부가 한 칸씩 밀려 방금 고친 파일 대신
 * 직전 파일을 따라갔다(실측: 실제 세션 하나에서 `tool_use` 31 : `tool_result` 30 · 어긋남 2건).
 * 값은 원문 라인에 이미 있으므로 새로 만들 것은 없고, **빠뜨리지 않는 것**만이 요건이다.
 */

describe('parseStreamLine — 도구 호출·결과 짝짓기 키', () => {
  it('assistant 의 tool_use 는 자기 id 를 싣는다', () => {
    const events = parseStreamLine({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_edit_1', name: 'Edit', input: { file_path: 'a.ts', old_string: 'a', new_string: 'b' } },
        ],
      },
    }, 'sub-a', 'agent-1');
    expect(events).toHaveLength(1);
    expect(events[0]!.toolUseId).toBe('toolu_edit_1');
  });

  it('user 메시지의 tool_result 는 참조하는 tool_use_id 를 싣는다', () => {
    const events = parseStreamLine({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'toolu_edit_1', content: 'ok' }],
      },
    }, 'sub-a', 'agent-1');
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('tool_result');
    expect(events[0]!.toolUseId).toBe('toolu_edit_1');
  });

  it('한 메시지에 결과가 여러 개면 각자 자기 id 를 싣는다(병렬 도구 호출)', () => {
    const events = parseStreamLine({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_b', content: 'B' },
          { type: 'tool_result', tool_use_id: 'toolu_a', content: 'A' },
        ],
      },
    }, 'sub-a', 'agent-1');
    expect(events.map((e) => e.toolUseId)).toEqual(['toolu_b', 'toolu_a']);
  });

  it('최상위 tool_result 형태도 같은 키를 싣는다', () => {
    const events = parseStreamLine({
      type: 'tool_result',
      tool_result: { tool_use_id: 'toolu_top', name: 'Write', content: 'done' },
    }, 'sub-a', 'agent-1');
    expect(events[0]!.toolUseId).toBe('toolu_top');
    expect(events[0]!.toolName).toBe('Write');
  });

  it('id 가 없는 옛 라인은 undefined 로 두고 조용히 지난다(클라가 FIFO 로 폴백한다)', () => {
    const events = parseStreamLine({
      type: 'user',
      message: { content: [{ type: 'tool_result', content: 'ok' }] },
    }, 'sub-a', 'agent-1');
    expect(events).toHaveLength(1);
    expect(events[0]!.toolUseId).toBeUndefined();
  });
});
