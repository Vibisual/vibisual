/**
 * §5.19 (D)(H) 엔진이 거절했을 때 — **이유를 읽고, 문맥은 우리가 잘라 준다.**
 *
 * 2026-08-21 사용자 보고("all 모델 버블인데 왜 에러난거야"): 화면에는 `[local] this model does
 * not support tools` 다음에 `engine responded 400` 이 떴다. 그런데 그 모델은 바로 앞 턴까지
 * `Bash` 를 잘 부르고 있었고, 엔진(llama.cpp b10509)이 실제로 보낸 것은 도구 이야기가 아니라
 * 이것이었다 —
 * `{"error":{"message":"request (3010 tokens) exceeds the available context size (2048 tokens),
 * try increasing it","type":"exceed_context_size_error","n_prompt_tokens":3010,"n_ctx":2048}}`
 * (같은 빌드에 같은 요청을 넣어 그대로 받아 낸 본문이다).
 *
 * 사고는 셋이 겹쳤다 — ① 거절 이유를 안 읽고 **전부 "도구 미지원"으로** 읽어 멀쩡한 모델에
 * 낙인을 찍었고 ② 그 낙인이 설정에 박혀 다음 턴까지 갔고 ③ 도구만 뺀 같은 요청이 같은 이유로
 * 또 거절되자 `engine responded 400` 한 줄로 죽었다. §5.19 (D) 는 "컨텍스트를 넘기면 잘라
 * 주는 일도 우리 몫이다" 라고 이미 말하고 있었는데 그 몫이 비어 있었다.
 *
 * 그래서 이 시험이 지키는 것: **이유를 가른다 · 짝을 깨지 않고 자른다 · 이번 턴은 안 건드린다.**
 */
import { describe, it, expect } from 'vitest';
import {
  classifyEngineError,
  estimateMessageChars,
  trimHistoryForRetry,
  capHistoryForContext,
  overflowDropChars,
  shouldOfferTools,
} from './localRunner.js';

/** 실제 엔진이 돌려준 본문 그대로(2026-08-21 llama.cpp b10509 실측). */
const OVERFLOW_BODY = JSON.stringify({
  error: {
    code: 400,
    message: 'request (3010 tokens) exceeds the available context size (2048 tokens), try increasing it',
    type: 'exceed_context_size_error',
    n_prompt_tokens: 3010,
    n_ctx: 2048,
  },
});

describe('classifyEngineError — 400 하나를 세 가지로 가른다', () => {
  it('문맥 초과는 문맥 초과로 읽고 수치까지 건진다', () => {
    const info = classifyEngineError(400, OVERFLOW_BODY);
    expect(info.kind).toBe('context-overflow');
    expect(info.promptTokens).toBe(3010);
    expect(info.contextTokens).toBe(2048);
    expect(info.message).toContain('exceeds the available context size');
  });

  it('수치 필드가 없는 빌드여도 문장에서 건져 낸다', () => {
    const info = classifyEngineError(
      400,
      JSON.stringify({
        error: { message: 'request (17300 tokens) exceeds the available context size (16384 tokens), try increasing it' },
      }),
    );
    expect(info.kind).toBe('context-overflow');
    expect(info.promptTokens).toBe(17300);
    expect(info.contextTokens).toBe(16384);
  });

  it('도구를 모르는 엔진만 no-tools 다', () => {
    const info = classifyEngineError(500, JSON.stringify({ error: { message: 'tools param requires --jinja flag' } }));
    expect(info.kind).toBe('no-tools');
  });

  it('그 밖의 사고를 도구 탓으로 넘겨짚지 않는다 — 이것이 이번 사고의 뿌리다', () => {
    const info = classifyEngineError(500, JSON.stringify({ error: { message: 'failed to load model' } }));
    expect(info.kind).toBe('other');
    // 원문이 살아야 사용자도 우리도 무엇이 잘못됐는지 안다.
    expect(info.message).toBe('failed to load model');
  });

  it('JSON 이 아니어도 본문을 버리지 않는다', () => {
    const info = classifyEngineError(502, 'upstream connect error');
    expect(info.kind).toBe('other');
    expect(info.message).toBe('upstream connect error');
  });

  it('본문이 아예 비면 상태 코드라도 남긴다', () => {
    expect(classifyEngineError(503, '').message).toContain('503');
  });
});

/** 이력 + 이번 턴. `keepFrom` 부터가 이번 턴이다. */
const CONVERSATION = [
  { role: 'system' as const, content: 'RULES' },
  { role: 'user' as const, content: '첫 질문' },
  { role: 'assistant' as const, content: '', tool_calls: [{ id: 'c1', type: 'function' as const, function: { name: 'Bash', arguments: '{}' } }] },
  { role: 'tool' as const, content: '첫 도구 결과', tool_call_id: 'c1' },
  { role: 'assistant' as const, content: '첫 답' },
  { role: 'user' as const, content: '둘째 질문' },
  { role: 'assistant' as const, content: '둘째 답' },
  // ↓ 여기부터 이번 턴 (keepFrom = 7)
  { role: 'user' as const, content: '이번 질문' },
  { role: 'assistant' as const, content: '', tool_calls: [{ id: 'c9', type: 'function' as const, function: { name: 'Bash', arguments: '{}' } }] },
  { role: 'tool' as const, content: '이번 도구 결과', tool_call_id: 'c9' },
];
const KEEP_FROM = 7;

describe('trimHistoryForRetry — 오래된 쪽부터 덩이째', () => {
  it('system 과 이번 턴은 한 줄도 건드리지 않는다', () => {
    const out = trimHistoryForRetry(CONVERSATION, KEEP_FROM, 1);
    expect(out).not.toBeNull();
    expect(out?.[0]).toEqual({ role: 'system', content: 'RULES' });
    expect(out?.slice(-3)).toEqual(CONVERSATION.slice(KEEP_FROM));
  });

  it('assistant→tool 짝을 반쪽만 남기지 않는다', () => {
    // 첫 덩이(user)만 겨우 덜리는 크기를 준 뒤, 남은 것 중 tool 이 홀로 서지 않는지 본다.
    let cur: ReturnType<typeof trimHistoryForRetry> = [...CONVERSATION];
    let keep = KEEP_FROM;
    for (let i = 0; i < 5 && cur; i += 1) {
      const next = trimHistoryForRetry(cur, keep, 1);
      if (!next) break;
      keep -= cur.length - next.length;
      cur = next;
      for (const [idx, m] of cur.entries()) {
        if (m.role !== 'tool') continue;
        const prev = cur[idx - 1];
        // tool 앞에는 반드시 그 호출을 낸 assistant 나 다른 tool 이 서 있어야 한다.
        expect(prev?.role === 'assistant' || prev?.role === 'tool').toBe(true);
      }
    }
  });

  it('요청한 만큼 덜릴 때까지 여러 덩이를 한 번에 덜어 낸다', () => {
    const all = estimateMessageChars(CONVERSATION.slice(1, KEEP_FROM));
    const out = trimHistoryForRetry(CONVERSATION, KEEP_FROM, all);
    // 지난 이력이 통째로 빠지고 system + 이번 턴만 남는다.
    expect(out).toEqual([CONVERSATION[0], ...CONVERSATION.slice(KEEP_FROM)]);
  });

  it('더 덜 것이 없으면 null — 그때는 사람에게 말해야 한다', () => {
    const onlyThisTurn = [CONVERSATION[0]!, ...CONVERSATION.slice(KEEP_FROM)];
    expect(trimHistoryForRetry(onlyThisTurn, 1, 9999)).toBeNull();
  });

  it('system 이 없는 이력도 같은 규칙으로 다룬다', () => {
    const noSys = CONVERSATION.slice(1);
    const out = trimHistoryForRetry(noSys, KEEP_FROM - 1, 1);
    expect(out).not.toBeNull();
    expect(out?.length).toBeLessThan(noSys.length);
    expect(out?.[0]?.role).not.toBe('tool');
  });
});

describe('capHistoryForContext — 저장할 때 접어 둔다', () => {
  it('예산을 넘으면 오래된 덩이부터 덜어 낸다', () => {
    const history = CONVERSATION.slice(1); // 저장 이력에는 system 이 없다
    const budget = Math.floor(estimateMessageChars(history) / 2);
    const out = capHistoryForContext(history, budget);
    expect(estimateMessageChars(out)).toBeLessThanOrEqual(budget);
    // 최근 것이 남아야 한다 — 다음 턴이 이어지려면 끝이 필요하지 앞이 필요한 게 아니다.
    expect(out.at(-1)).toEqual(history.at(-1));
  });

  it('예산 안이면 한 줄도 건드리지 않는다', () => {
    const history = CONVERSATION.slice(1);
    expect(capHistoryForContext(history, 10_000_000)).toEqual(history);
  });

  it('아무리 좁아도 마지막 한 덩이는 남긴다 — 빈 이력을 저장하지 않는다', () => {
    const out = capHistoryForContext(CONVERSATION.slice(1), 1);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('overflowDropChars — 한 덩이씩 깎으며 되던지지 않는다', () => {
  it('엔진이 준 수치가 있으면 넘긴 만큼을 한 번에 덜어 낸다', () => {
    const drop = overflowDropChars({ promptTokens: 3010, contextTokens: 2048 }, 5_000, 2048);
    // (3010 - floor(2048*0.9)) * 3 = (3010 - 1843) * 3
    expect(drop).toBe((3010 - 1843) * 3);
  });

  it('수치가 없으면 지난 이력의 4분의 1을 덜어 낸다', () => {
    expect(overflowDropChars({}, 4_000, 16384)).toBe(1_000);
  });

  it('이미 창 안에 드는 수치를 받아도 0 을 돌려주지 않는다(무한 되던짐 방지)', () => {
    expect(overflowDropChars({ promptTokens: 100, contextTokens: 16384 }, 4_000, 16384)).toBeGreaterThan(0);
  });
});

describe('shouldOfferTools — 잘못 박힌 "도구 미지원"이 영영 남지 않는다', () => {
  it('루트나 권한 창구가 없으면 도구를 주지 않는다', () => {
    expect(shouldOfferTools({ hasRoot: false, hasBroker: true, probedThisRun: false })).toBe(false);
    expect(shouldOfferTools({ hasRoot: true, hasBroker: false, probedThisRun: false })).toBe(false);
  });

  it('판정이 없거나 ok 면 싣는다', () => {
    expect(shouldOfferTools({ hasRoot: true, hasBroker: true, probedThisRun: false })).toBe(true);
    expect(shouldOfferTools({ hasRoot: true, hasBroker: true, verdict: 'ok', probedThisRun: true })).toBe(true);
    expect(shouldOfferTools({ hasRoot: true, hasBroker: true, verdict: 'unknown', probedThisRun: true })).toBe(true);
  });

  it('이번 실행에서 확인한 none 만 가로막는다', () => {
    expect(shouldOfferTools({ hasRoot: true, hasBroker: true, verdict: 'none', probedThisRun: true })).toBe(false);
  });

  it('지난 실행에 박힌 none 은 한 번 더 물어본다 — 이번 사고로 잘못 박힌 버블이 스스로 회복하는 길', () => {
    expect(shouldOfferTools({ hasRoot: true, hasBroker: true, verdict: 'none', probedThisRun: false })).toBe(true);
  });
});
