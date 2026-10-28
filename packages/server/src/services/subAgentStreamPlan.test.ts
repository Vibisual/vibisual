import { describe, it, expect } from 'vitest';
import { parseStreamLine } from './subAgentManager.js';

/** §5.5 #17-17 ⑨ / #17-12 ② — **계획(TodoWrite) input 은 미리보기 상한(300자)에 잘리면 안 된다** — 잘린 JSON 은 파싱이 실패해 계획 블록·목표 동기화가 에러 없이 안 뜬다. */

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
