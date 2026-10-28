/**
 * §4 — `--include-hook-events` 훅 줄이 이벤트가 되는가(소음 목록에 있으면 플래그를 켜도 화면이 그대로다).
 * 안 켠 세션은 바이트 단위로 같아야 한다 — 소음 판정이 새면 훅 줄이 복원 예산을 먹는다.
 */
import { describe, it, expect } from 'vitest';
import { parseStreamLine } from './subAgentManager.js';
import { parseSystemSubtype, parseSystemTaskInfo, HOOK_STREAM_SUBTYPES } from '@vibisual/shared';

const SUB = 'sub-1';
const PARENT = 'agent-1';

const parseOn = (obj: Record<string, unknown>) => parseStreamLine(obj, SUB, PARENT, { hookEvents: true });
const parseOff = (obj: Record<string, unknown>) => parseStreamLine(obj, SUB, PARENT, {});

/** 실측 훅 줄의 뼈대 — CLI 는 `system` 줄의 subtype 으로 훅을 흘린다. */
const hookLine = (subtype: string, extra: Record<string, unknown> = {}) => ({
  type: 'system',
  subtype,
  hook_event_name: 'PreToolUse',
  ...extra,
});

// ─────────────────────────────────────────────────────────────
describe('끈 세션 — 종전 그대로 버린다', () => {
  it('훅 줄 넷 모두 이벤트가 되지 않는다', () => {
    for (const subtype of HOOK_STREAM_SUBTYPES) {
      expect(parseOff(hookLine(subtype)), subtype).toHaveLength(0);
    }
  });

  it('옵션 자체를 안 넘겨도 같다(기본값이 끔)', () => {
    expect(parseStreamLine(hookLine('hook_started'), SUB, PARENT)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────
describe('켠 세션 — 훅 줄이 한 줄로 선다', () => {
  it('훅 줄 넷 모두 system 칩이 된다', () => {
    for (const subtype of HOOK_STREAM_SUBTYPES) {
      const events = parseOn(hookLine(subtype));
      expect(events, subtype).toHaveLength(1);
      expect(events[0]!.eventType, subtype).toBe('system');
      expect(parseSystemSubtype(events[0]!.content), subtype).toBe(subtype);
    }
  });

  it('라벨 자리에는 어떤 훅이 떴는지가 선다 — 사용자가 켜는 이유가 그것이다', () => {
    const info = parseSystemTaskInfo(parseOn(hookLine('hook_started'))[0]!.content);
    expect(info?.description).toBe('PreToolUse');
  });

  it('훅 이름이 있으면 이벤트 이름 옆에 함께 적는다', () => {
    const info = parseSystemTaskInfo(
      parseOn(hookLine('hook_started', { hook_name: 'vibisual-gate' }))[0]!.content,
    );
    expect(info?.description).toBe('PreToolUse — vibisual-gate');
  });

  it('출력과 소요 시간이 있으면 함께 싣는다', () => {
    const info = parseSystemTaskInfo(
      parseOn(hookLine('hook_response', { output: '승인됨', duration_ms: 1234 }))[0]!.content,
    );
    expect(info?.summary).toBe('승인됨');
    expect(info?.durationMs).toBe(1234);
  });

  it('같은 훅의 시작·응답은 같은 id 로 묶인다', () => {
    const a = parseSystemTaskInfo(parseOn(hookLine('hook_started'))[0]!.content);
    const b = parseSystemTaskInfo(parseOn(hookLine('hook_response'))[0]!.content);
    expect(a?.id).toBe(b?.id);
  });
});

// ─────────────────────────────────────────────────────────────
describe('모양이 문서화되지 않은 자리 — 지어내지 않는다', () => {
  it('어떤 훅인지 모르면 줄을 만들지 않는다', () => {
    expect(parseOn({ type: 'system', subtype: 'hook_started' })).toHaveLength(0);
    expect(parseOn({ type: 'system', subtype: 'hook_started', hook_event_name: '   ' })).toHaveLength(0);
  });

  it('판본이 다른 필드 이름을 써도 훑어낸다', () => {
    const info = parseSystemTaskInfo(
      parseOn({ type: 'system', subtype: 'hook_progress', event: 'PostToolUse' })[0]!.content,
    );
    expect(info?.description).toBe('PostToolUse');
  });

  it('소요 시간이 숫자가 아니면 싣지 않는다', () => {
    const info = parseSystemTaskInfo(
      parseOn(hookLine('hook_response', { duration_ms: 'fast' }))[0]!.content,
    );
    expect(info?.durationMs).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
describe('훅이 아닌 소음은 켜도 그대로 버린다', () => {
  it('init · notification · turn_duration 은 여전히 안 나온다', () => {
    for (const subtype of ['init', 'notification', 'turn_duration']) {
      expect(parseOn({ type: 'system', subtype }), subtype).toHaveLength(0);
    }
  });

  it('평범한 system 줄은 켜든 끄든 종전 그대로 한 줄이다', () => {
    for (const parse of [parseOn, parseOff]) {
      const events = parse({ type: 'system', subtype: 'compact_boundary' });
      expect(events).toHaveLength(1);
      expect(parseSystemSubtype(events[0]!.content)).toBe('compact_boundary');
    }
  });
});
