/**
 * §5.5 #17-12 ③-6 — **턴이 끝난 이유 한 칸**의 판정 회귀.
 *
 * 값은 전부 **순서**에 있다. 사용자 중지는 무엇보다 앞서야 하고(멈춘 턴의 마지막 줄이 `end_turn` 이어도
 * 사용자는 멈췄다), 실패로 닫힌 턴에 짐작한 `end_turn` 을 적으면 오류 사유와 서로 다른 말을 한다.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeModelStopReason,
  readTurnStopSignal,
  resolveTurnStopReason,
  isNotableTurnStop,
  TURN_STOP_REASONS,
} from '@vibisual/shared';

describe('normalizeModelStopReason — 엔진마다 다른 낱말을 세 낱말로 접는다', () => {
  it('Anthropic 낱말', () => {
    expect(normalizeModelStopReason('end_turn')).toBe('end_turn');
    expect(normalizeModelStopReason('stop_sequence')).toBe('end_turn');
    expect(normalizeModelStopReason('max_tokens')).toBe('max_tokens');
    expect(normalizeModelStopReason('model_context_window_exceeded')).toBe('max_tokens');
    expect(normalizeModelStopReason('refusal')).toBe('refusal');
  });

  it('OpenAI 호환(로컬 엔진) 낱말', () => {
    expect(normalizeModelStopReason('stop')).toBe('end_turn');
    expect(normalizeModelStopReason('length')).toBe('max_tokens');
    expect(normalizeModelStopReason('content_filter')).toBe('refusal');
  });

  it('턴이 이어진다는 낱말과 모르는 낱말은 끝이 아니다', () => {
    expect(normalizeModelStopReason('tool_use')).toBeUndefined();
    expect(normalizeModelStopReason('pause_turn')).toBeUndefined();
    expect(normalizeModelStopReason('tool_calls')).toBeUndefined();
    expect(normalizeModelStopReason('something_new')).toBeUndefined();
    expect(normalizeModelStopReason(null)).toBeUndefined();
    expect(normalizeModelStopReason(3)).toBeUndefined();
  });
});

describe('readTurnStopSignal — Claude 스트림 한 줄', () => {
  it('assistant 줄의 message.stop_reason 을 읽는다(실측 모양)', () => {
    expect(readTurnStopSignal({ type: 'assistant', message: { stop_reason: 'end_turn', content: [] } }))
      .toEqual({ modelStop: 'end_turn' });
    expect(readTurnStopSignal({ type: 'assistant', message: { stop_reason: 'max_tokens' } }))
      .toEqual({ modelStop: 'max_tokens' });
  });

  it('도구 호출 줄·사유 없는 줄은 끝에 대해 말하지 않는다', () => {
    expect(readTurnStopSignal({ type: 'assistant', message: { stop_reason: 'tool_use' } })).toBeUndefined();
    expect(readTurnStopSignal({ type: 'assistant', message: { stop_reason: null } })).toBeUndefined();
    expect(readTurnStopSignal({ type: 'user', message: { stop_reason: 'end_turn' } })).toBeUndefined();
    expect(readTurnStopSignal('not an object')).toBeUndefined();
  });

  it('결과 줄의 턴 상한 신고와 stop_reason 을 읽는다', () => {
    expect(readTurnStopSignal({ type: 'result', subtype: 'error_max_turns', is_error: true }))
      .toEqual({ maxTurns: true });
    expect(readTurnStopSignal({ type: 'result', subtype: 'success', stop_reason: 'refusal' }))
      .toEqual({ modelStop: 'refusal' });
    expect(readTurnStopSignal({ type: 'result', subtype: 'success' })).toBeUndefined();
  });
});

describe('resolveTurnStopReason — 앞선 것이 이긴다', () => {
  it('아무 일 없이 끝나면 end_turn', () => {
    expect(resolveTurnStopReason({})).toBe('end_turn');
    expect(resolveTurnStopReason({ modelStop: 'end_turn' })).toBe('end_turn');
  });

  it('사용자 중지는 무엇보다 앞선다', () => {
    expect(resolveTurnStopReason({ userStopped: true, usageLimited: true, maxTurns: true, modelStop: 'refusal', failed: true }))
      .toBe('cancelled');
  });

  it('한도 정지 > 턴 상한 > 거절 > 출력 상한', () => {
    expect(resolveTurnStopReason({ usageLimited: true, maxTurns: true, modelStop: 'refusal' })).toBe('usage_limit');
    expect(resolveTurnStopReason({ maxTurns: true, modelStop: 'refusal' })).toBe('max_turns');
    expect(resolveTurnStopReason({ modelStop: 'refusal' })).toBe('refusal');
    expect(resolveTurnStopReason({ modelStop: 'max_tokens' })).toBe('max_tokens');
  });

  it('실패로 닫힌 턴은 이유를 모르면 비운다 — 짐작한 end_turn 을 적지 않는다', () => {
    expect(resolveTurnStopReason({ failed: true })).toBeUndefined();
    expect(resolveTurnStopReason({ failed: true, modelStop: 'end_turn' })).toBeUndefined();
  });

  it('실패여도 알아본 이유는 남긴다(턴 상한은 오류 코드와 함께 앉는다)', () => {
    expect(resolveTurnStopReason({ failed: true, maxTurns: true })).toBe('max_turns');
    expect(resolveTurnStopReason({ failed: true, modelStop: 'max_tokens' })).toBe('max_tokens');
  });
});

describe('isNotableTurnStop — 화면은 평범한 끝을 조용히 둔다', () => {
  it('end_turn 과 값 없음만 조용하다', () => {
    expect(isNotableTurnStop(undefined)).toBe(false);
    expect(isNotableTurnStop('end_turn')).toBe(false);
    for (const r of TURN_STOP_REASONS.filter((x) => x !== 'end_turn')) expect(isNotableTurnStop(r)).toBe(true);
  });
});
