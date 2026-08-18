import { describe, it, expect } from 'vitest';
import { parseStreamLine } from './subAgentManager.js';

/**
 * §5.5 #17-17 ⑨ / #17-12 ② v4.59 — **계획(TodoWrite) input 은 잘리면 안 된다.**
 *
 * 도구 input 미리보기 상한(300자)이 계획 JSON 도 잘라내고 있었다. 잘린 문자열은 `JSON.parse` 가
 * 실패하므로 (a) IDE 계획 블록(`parsePlanTodos`)은 계획을 못 알아보고 일반 도구 상자로 폴백하고,
 * (b) 스트림 폴백 경로의 목표 단계 동기화도 조용히 통과해 버린다 — 둘 다 **에러 없이 그냥 안 뜬다**.
 * 항목 두어 개만 넘어도 300자를 넘기므로 실사용에서는 거의 항상 걸린다.
 */

function assistantTodoWrite(todos: { content: string; status: string }[]): Record<string, unknown> {
  return {
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', id: 'toolu_plan_1', name: 'TodoWrite', input: { todos } },
      ],
    },
  };
}

describe('parseStreamLine — 계획 도구 input 보존', () => {
  it('TodoWrite 는 300자를 넘어도 잘리지 않아 계획 전체가 파싱된다', () => {
    const todos = Array.from({ length: 8 }, (_, i) => ({
      content: `${i + 1}번째 단계 — 이 문장은 미리보기 상한을 확실히 넘기려고 충분히 길게 적는다`,
      status: i === 0 ? 'completed' : i === 1 ? 'in_progress' : 'pending',
    }));

    const events = parseStreamLine(assistantTodoWrite(todos), 'sub-a', 'agent-1');
    expect(events).toHaveLength(1);
    expect(events[0]!.toolName).toBe('TodoWrite');
    expect(events[0]!.content.length).toBeGreaterThan(300); // 잘렸다면 여기서 끝난다

    const parsed = JSON.parse(events[0]!.content) as { todos: { content: string; status: string }[] };
    expect(parsed.todos).toHaveLength(8);
    expect(parsed.todos[0]!.status).toBe('completed');
    expect(parsed.todos[1]!.status).toBe('in_progress');
  });

  it('계획이 아닌 도구의 input 미리보기 상한은 그대로다(비용 회귀 방지)', () => {
    const long = 'x'.repeat(1000);
    const events = parseStreamLine({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: long } }] },
    }, 'sub-a', 'agent-1');

    expect(events).toHaveLength(1);
    expect(events[0]!.content.length).toBe(300);
  });
});
