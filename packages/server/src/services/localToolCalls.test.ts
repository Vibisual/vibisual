/**
 * §5.19 (H) 스트림으로 오는 도구 호출 — 조각을 잃지 않고 온전한 호출로 모은다.
 *
 * 도구 호출은 본문과 **같은 SSE 자리**에 오는데, 이름과 인자가 여러 줄에 걸쳐 쪼개져 온다.
 * 중간에 파싱하면 늘 실패하고, 조각을 하나라도 흘리면 모델이 "파일을 고치겠다"고 한 말이
 * 우리 쪽에서 아무 일도 아닌 것이 된다(그리고 사용자는 왜 안 고쳐졌는지 알 길이 없다).
 *
 * 조건은 셋 — **조각을 index 로 모을 것**, **id 가 없으면 우리가 만들 것**(짝지을 키가
 * 없으면 도구 카드가 어긋난다), **못 읽는 JSON 이라도 버리지 말 것**(도구가 "무엇이 빠졌다"
 * 고 말해 주면 모델이 고쳐 쓴다).
 */
import { describe, it, expect } from 'vitest';
import { LOCAL_TOOL_REPEAT_LIMIT } from '@vibisual/shared';
import {
  parseChatDelta,
  createToolCallAccumulator,
  parseToolArguments,
  repeatedCallNotice,
} from './localRunner.js';

/** 엔진이 보내오는 한 줄의 모양(실측 payload 를 줄인 것). */
function sse(delta: Record<string, unknown>, finish: string | null = null): string {
  return JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }], object: 'chat.completion.chunk' });
}

// ─────────────────────────────────────────────────────────────
describe('parseChatDelta — 도구 호출도 같은 자리에서 읽는다', () => {
  it('본문만 있는 줄은 도구 조각이 비어 있다', () => {
    const d = parseChatDelta(sse({ content: '안녕' }));
    expect(d?.text).toBe('안녕');
    expect(d?.toolCalls).toEqual([]);
  });

  it('첫 조각에서 id 와 이름을 읽는다', () => {
    const d = parseChatDelta(sse({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'Read', arguments: '' } }] }));
    expect(d?.toolCalls[0]).toEqual({ index: 0, id: 'call_1', name: 'Read', argumentsFragment: '' });
  });

  it('이어지는 조각은 인자 파편만 온다', () => {
    const d = parseChatDelta(sse({ tool_calls: [{ index: 0, function: { arguments: '{"pa' } }] }));
    expect(d?.toolCalls[0]).toEqual({ index: 0, argumentsFragment: '{"pa' });
  });

  it('index 가 없으면 배열 순서를 쓴다 — 그걸로라도 짝을 지어야 한다', () => {
    const d = parseChatDelta(sse({ tool_calls: [{ function: { name: 'Glob' } }] }));
    expect(d?.toolCalls[0]?.index).toBe(0);
  });
});

describe('createToolCallAccumulator — 조각을 잃지 않는다', () => {
  it('여러 줄에 쪼개진 한 호출을 온전히 모은다', () => {
    const acc = createToolCallAccumulator();
    acc.push([{ index: 0, id: 'call_1', name: 'Read' }]);
    acc.push([{ index: 0, argumentsFragment: '{"path":' }]);
    acc.push([{ index: 0, argumentsFragment: '"src/a.ts"}' }]);
    const calls = acc.collect();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.function.name).toBe('Read');
    expect(parseToolArguments(calls[0]?.function.arguments ?? '').args).toEqual({ path: 'src/a.ts' });
  });

  it('한 턴에 여러 호출이 와도 index 로 갈린다(순서 유지)', () => {
    const acc = createToolCallAccumulator();
    acc.push([
      { index: 0, id: 'a', name: 'Read', argumentsFragment: '{"path":"x"}' },
      { index: 1, id: 'b', name: 'Grep', argumentsFragment: '{"pattern":"y"}' },
    ]);
    const calls = acc.collect();
    expect(calls.map((c) => c.function.name)).toEqual(['Read', 'Grep']);
    expect(calls.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('id 를 안 주는 엔진이면 우리가 만든다 — 짝지을 키가 없으면 카드가 어긋난다', () => {
    const acc = createToolCallAccumulator();
    acc.push([{ index: 0, name: 'Glob', argumentsFragment: '{}' }]);
    const id = acc.collect()[0]?.id ?? '';
    expect(id.length).toBeGreaterThan(0);
  });

  it('이름 없는 조각만 온 자리는 호출로 세지 않는다', () => {
    const acc = createToolCallAccumulator();
    acc.push([{ index: 0, argumentsFragment: '{"path":"x"}' }]);
    expect(acc.collect()).toHaveLength(0);
  });
});

describe('parseToolArguments — 고쳐 보고, 그래도 안 되면 사유를 돌려준다', () => {
  it('온전한 JSON 은 그대로', () => {
    expect(parseToolArguments('{"a":1}')).toEqual({ args: { a: 1 } });
  });

  it('빈 문자열은 빈 인자 — 인자 없는 도구도 있다(사유 ❌)', () => {
    expect(parseToolArguments('')).toEqual({ args: {} });
  });

  it('코드펜스로 감싸 보내도 읽는다', () => {
    expect(parseToolArguments('```json{"path":"a.ts"}```').args).toEqual({ path: 'a.ts' });
  });

  it('앞뒤에 말을 붙여도 바깥 중괄호만 본다', () => {
    expect(parseToolArguments('here you go: {"path":"a.ts"} done').args).toEqual({ path: 'a.ts' });
  });

  it('마지막 쉼표를 남겨도 읽는다', () => {
    expect(parseToolArguments('{"path":"a.ts",}').args).toEqual({ path: 'a.ts' });
  });

  it('중간에서 잘린 문자열을 닫아 준다 — 창이 끝나면 실제로 이렇게 온다', () => {
    expect(parseToolArguments('{"command":"ls -la').args).toEqual({ command: 'ls -la' });
  });

  it('중첩된 것도 열린 만큼 닫는다', () => {
    expect(parseToolArguments('{"a":{"b":[1,2').args).toEqual({ a: { b: [1, 2] } });
  });

  it('끝내 못 읽으면 **사유**를 함께 준다 — 모델이 자기 JSON 이 깨진 걸 알아야 고쳐 쓴다', () => {
    const out = parseToolArguments('{"a":');
    expect(out.args).toEqual({});
    expect(out.error).toBeTruthy();
  });

  it('객체가 아닌 온전한 JSON 도 사유를 준다(빈 인자로 조용히 실행하지 않는다)', () => {
    const out = parseToolArguments('[1,2]');
    expect(out.args).toEqual({});
    expect(out.error).toContain('array');
  });
});

describe('repeatedCallNotice — 헛도는 것과 다시 돌려 보는 것을 가른다', () => {
  it('상한까지는 그대로 실행한다 — 고친 뒤 같은 테스트를 다시 돌리는 것은 정당하다', () => {
    const seen = new Map<string, number>();
    for (let i = 0; i < LOCAL_TOOL_REPEAT_LIMIT; i += 1) {
      expect(repeatedCallNotice(seen, 'Bash', '{"command":"pnpm test"}')).toBeNull();
    }
  });

  it('상한을 넘으면 실행 대신 사실을 알린다', () => {
    const seen = new Map<string, number>();
    for (let i = 0; i < LOCAL_TOOL_REPEAT_LIMIT; i += 1) repeatedCallNotice(seen, 'Bash', '{}');
    expect(repeatedCallNotice(seen, 'Bash', '{}')).toContain('repeated call');
  });

  it('인자가 다르면 다른 호출이다 — 진행 중인 작업을 막지 않는다', () => {
    const seen = new Map<string, number>();
    for (let i = 0; i < LOCAL_TOOL_REPEAT_LIMIT + 2; i += 1) {
      expect(repeatedCallNotice(seen, 'Read', `{"path":"f${String(i)}.ts"}`)).toBeNull();
    }
  });

  it('도구가 다르면 다른 호출이다', () => {
    const seen = new Map<string, number>();
    for (let i = 0; i < LOCAL_TOOL_REPEAT_LIMIT; i += 1) repeatedCallNotice(seen, 'Read', '{}');
    expect(repeatedCallNotice(seen, 'Grep', '{}')).toBeNull();
  });
});
