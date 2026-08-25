/**
 * §5.19 (D) 로컬 턴 스트림 — 델타 해석 + 조각 합치기 테스트.
 *
 * 회귀 방지 대상 — 2026-08-20 실측 사고. 엔진은 멀쩡히 답하고 상태도 "완료"인데 **말풍선이
 * 텅 비어** 사용자에게는 아무 일도 안 일어난 것으로 보였다. 원인은 우리가 `delta.content` 만
 * 읽은 것 — 추론 모델은 생각을 `reasoning_content` 로 따로 보내므로, 생각만 하다 끝난 턴은
 * 우리 눈에 한 글자도 안 보인다(실측: content 0자 / reasoning_content 4,096자).
 *
 * 조건은 둘이다 — **생각을 버리지 말 것**, 그리고 **한 조각도 잃지 말 것**(합치기는 전선을
 * 아끼려는 것이지 내용을 줄이려는 것이 아니다).
 */
import { describe, it, expect } from 'vitest';
import { parseChatDelta, createStreamCoalescer } from './localRunner.js';

/** 실제로 엔진이 보내온 줄의 모양(실측 payload 를 그대로 줄인 것). */
function sse(delta: Record<string, unknown>, finish: string | null = null): string {
  return JSON.stringify({
    choices: [{ index: 0, delta, finish_reason: finish }],
    object: 'chat.completion.chunk',
  });
}

// ─────────────────────────────────────────────────────────────
describe('parseChatDelta — 생각과 본문을 모두 읽는다', () => {
  it('본문 델타를 읽는다', () => {
    expect(parseChatDelta(sse({ content: '안녕' }))).toEqual({ text: '안녕', thinking: '', finishReason: null, toolCalls: [], promptTokens: null, completionTokens: null });
  });

  it('추론 델타를 읽는다 — 이걸 놓쳐서 빈 말풍선이 나왔다', () => {
    expect(parseChatDelta(sse({ reasoning_content: '음…' }))).toEqual({ text: '', thinking: '음…', finishReason: null, toolCalls: [], promptTokens: null, completionTokens: null });
  });

  it('한 줄에 둘 다 있어도 각자 자리로 간다', () => {
    const d = parseChatDelta(sse({ content: 'A', reasoning_content: 'B' }));
    expect(d?.text).toBe('A');
    expect(d?.thinking).toBe('B');
  });

  it('finish_reason 을 전한다 — 예산을 다 쓰고 끝난 턴을 설명할 근거가 된다', () => {
    expect(parseChatDelta(sse({}, 'length'))?.finishReason).toBe('length');
    expect(parseChatDelta(sse({ content: '끝' }, 'stop'))?.finishReason).toBe('stop');
  });

  it('role 만 오는 첫 줄은 빈 델타로 읽는다(내용 없음이지 오류 아님)', () => {
    expect(parseChatDelta(sse({ role: 'assistant', content: null }))).toEqual({ text: '', thinking: '', finishReason: null, toolCalls: [], promptTokens: null, completionTokens: null });
  });

  it('조각난 줄은 null — 다음 청크에서 이어져야 한다', () => {
    expect(parseChatDelta('{"choices":[{"delta":{"cont')).toBeNull();
  });

  it('추론만 4,096조각 와도 본문은 0자 — 사고 당시의 스트림을 그대로 재현', () => {
    let text = '';
    let thinking = '';
    let finish: string | null = null;
    for (let i = 0; i < 4096; i += 1) {
      const d = parseChatDelta(sse({ reasoning_content: '?' }));
      text += d?.text ?? '';
      thinking += d?.thinking ?? '';
    }
    finish = parseChatDelta(sse({}, 'length'))?.finishReason ?? null;
    expect(text).toBe('');
    expect(thinking).toHaveLength(4096);
    expect(finish).toBe('length');
  });
});

// ─────────────────────────────────────────────────────────────
describe('createStreamCoalescer — 모으되 잃지 않는다', () => {
  /** 시간을 손에 쥔 채로 만든다(기본 Date.now 면 시험이 시계에 흔들린다). */
  function make(): { events: Array<[string, string]>; c: ReturnType<typeof createStreamCoalescer>; tick: (ms: number) => void } {
    const events: Array<[string, string]> = [];
    let clock = 0;
    const c = createStreamCoalescer((t, content) => events.push([t, content]), () => clock);
    return { events, c, tick: (ms) => { clock += ms; } };
  }

  it('짧은 조각들은 뭉쳐서 한 번에 나간다 — 토큰마다 이벤트를 내지 않는다', () => {
    const { events, c } = make();
    for (const ch of ['가', '나', '다']) c.push('text', ch);
    expect(events).toHaveLength(0); // 아직 붙잡고 있다
    c.flush();
    expect(events).toEqual([['text', '가나다']]);
  });

  it('길이 상한을 넘으면 그 자리에서 나간다', () => {
    const { events, c } = make();
    c.push('text', 'x'.repeat(240));
    expect(events).toEqual([['text', 'x'.repeat(240)]]);
  });

  it('느린 모델은 조각마다 흘러간다 — 화면이 멈춘 것처럼 보이면 안 된다', () => {
    const { events, c, tick } = make();
    c.push('text', 'A');
    expect(events).toHaveLength(0);
    tick(200); // 다음 토큰이 한참 뒤에 왔다
    c.push('text', 'B');
    expect(events).toEqual([['text', 'AB']]);
  });

  it('생각과 본문은 섞이지 않는다 — 종류가 바뀌면 먼저 흘려보낸다', () => {
    const { events, c } = make();
    c.push('thinking', '음');
    c.push('thinking', '…');
    c.push('text', '답');
    c.flush();
    expect(events).toEqual([['thinking', '음…'], ['text', '답']]);
  });

  it('빈 조각은 무시한다', () => {
    const { events, c } = make();
    c.push('text', '');
    c.flush();
    expect(events).toHaveLength(0);
  });

  it('붙잡은 것이 없으면 flush 는 아무것도 내지 않는다(여러 번 불러도 안전)', () => {
    const { events, c } = make();
    c.flush();
    c.flush();
    expect(events).toHaveLength(0);
  });

  it('한 글자도 잃지 않는다 — 넣은 것과 나온 것이 같아야 한다', () => {
    const { events, c, tick } = make();
    const pieces = Array.from({ length: 1000 }, (_, i) => `t${String(i)}`);
    for (const [i, p] of pieces.entries()) {
      c.push('text', p);
      if (i % 7 === 0) tick(130); // 들쭉날쭉한 도착 간격
    }
    c.flush();
    expect(events.map(([, content]) => content).join('')).toBe(pieces.join(''));
    expect(events.length).toBeLessThan(pieces.length); // 이벤트 수는 확실히 줄어 있어야 한다
  });
});
