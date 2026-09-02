/**
 * turnSteps.test.ts — §5.5 #17-39 단계 자국의 **숫자 규칙**을 못박는다.
 *
 * 여기서 지키는 것 셋:
 *  1) 시간 단위 자르기(사진의 `1분 13초` 가 그대로 나와야 한다).
 *  2) 자국을 남길 문턱 — 순간 사고에 한 줄을 내주지 않는다.
 *  3) 런 봉인 규칙 — **버퍼 끝에 걸린 런은 자국이 되지 않는다**(자라는 자국 ❌).
 */
import { describe, it, expect } from 'vitest';
import type { SubAgentStreamEvent } from '@vibisual/shared';
import {
  describeStepDuration, shouldTraceThinking, shouldTraceWriting, collectThinkRuns, toolGroupElapsedMs,
  THINK_TRACE_MIN_CHARS, THINK_TRACE_MIN_MS, WRITE_TRACE_MIN_CHARS,
} from './turnSteps.js';

const evt = (id: string, ts: number, eventType: SubAgentStreamEvent['eventType'], content = ''): SubAgentStreamEvent =>
  ({ id, subAgentId: 'S', parentAgentId: 'P', timestamp: ts, eventType, content });

/** 파서가 건너뛰는 둘(펄스·숨김 system)과 같은 규칙 — 런을 끊지 않는다. */
const skipPulse = (e: SubAgentStreamEvent): boolean =>
  e.eventType === 'system' && /^\s*\[(thinking_tokens|status)\]/.test(e.content);

describe('describeStepDuration', () => {
  it('1초 미만은 뭉친다 — `0초` 라고 적지 않는다', () => {
    expect(describeStepDuration(0)).toEqual({ kind: 'under' });
    expect(describeStepDuration(999)).toEqual({ kind: 'under' });
    // 음수·NaN 같은 망가진 값도 조용히 접는다(화면에 NaN 이 뜨는 쪽이 훨씬 나쁘다).
    expect(describeStepDuration(-5)).toEqual({ kind: 'under' });
    expect(describeStepDuration(Number.NaN)).toEqual({ kind: 'under' });
  });

  it('분 미만은 초, 시간 미만은 분+초 — 사진의 `1분 13초` 가 그대로 나온다', () => {
    expect(describeStepDuration(1_000)).toEqual({ kind: 'sec', sec: 1 });
    expect(describeStepDuration(59_999)).toEqual({ kind: 'sec', sec: 59 });
    expect(describeStepDuration(73_000)).toEqual({ kind: 'minSec', min: 1, sec: 13 });
    expect(describeStepDuration(60_000)).toEqual({ kind: 'minSec', min: 1, sec: 0 });
  });

  it('한 시간을 넘으면 시간+분(초는 버린다 — 그 자리에서 초는 뜻이 없다)', () => {
    expect(describeStepDuration(3_600_000)).toEqual({ kind: 'hourMin', hour: 1, min: 0 });
    expect(describeStepDuration(2 * 3_600_000 + 5 * 60_000 + 30_000)).toEqual({ kind: 'hourMin', hour: 2, min: 5 });
  });
});

describe('자국을 남길 문턱', () => {
  it('분량 **또는** 시간 중 하나만 넘어도 남긴다', () => {
    // 길게 한 번 생각 — 시간은 짧아도 분량이 넘는다.
    expect(shouldTraceThinking({ chars: THINK_TRACE_MIN_CHARS, startedAt: 0, endedAt: 0 })).toBe(true);
    // 짧게 끊어 생각 — 분량은 적어도 시간이 넘는다.
    expect(shouldTraceThinking({ chars: 1, startedAt: 0, endedAt: THINK_TRACE_MIN_MS })).toBe(true);
  });

  it('둘 다 못 넘는 순간 사고는 남기지 않는다(한 줄이 곧 소음이 되는 자리)', () => {
    expect(shouldTraceThinking({ chars: THINK_TRACE_MIN_CHARS - 1, startedAt: 0, endedAt: THINK_TRACE_MIN_MS - 1 })).toBe(false);
  });

  it('작성 자국은 분량으로만 판단한다 — 짧은 대답 밑에 숫자를 달지 않는다', () => {
    expect(shouldTraceWriting(WRITE_TRACE_MIN_CHARS)).toBe(true);
    expect(shouldTraceWriting(WRITE_TRACE_MIN_CHARS - 1)).toBe(false);
  });
});

describe('collectThinkRuns', () => {
  it('연속 사고를 한 런으로 합치고, 사고가 아닌 이벤트에서 봉인한다', () => {
    const events = [
      evt('a', 100, 'text', '앞'),
      evt('b', 200, 'thinking', 'x'.repeat(50)),
      evt('c', 900, 'thinking', 'y'.repeat(50)),
      evt('d', 1_000, 'text', '뒤'),
    ];
    const runs = collectThinkRuns(events, skipPulse);
    expect(runs).toEqual([{ firstId: 'b', startedAt: 200, endedAt: 900, chars: 100 }]);
  });

  it('펄스·숨김 칩은 런을 끊지 않는다(파서가 건너뛰는 것과 같은 규칙)', () => {
    const events = [
      evt('b', 0, 'thinking', 'x'.repeat(40)),
      evt('p', 500, 'system', '[thinking_tokens]'),
      evt('c', 1_000, 'thinking', 'y'.repeat(40)),
      evt('d', 1_100, 'tool_use', 'in'),
    ];
    expect(collectThinkRuns(events, skipPulse)).toEqual([{ firstId: 'b', startedAt: 0, endedAt: 1_000, chars: 80 }]);
  });

  it('버퍼 끝에 걸린 런은 자국이 되지 않는다 — 아직 끝났다는 증거가 없다', () => {
    const open = [evt('a', 0, 'text', '앞'), evt('b', 100, 'thinking', 'z'.repeat(500))];
    expect(collectThinkRuns(open, skipPulse)).toEqual([]);
    // 뒤이어 무엇이든 오면 그때 자국이 선다(그 순간이 끝난 시각이다).
    const sealed = [...open, evt('c', 5_000, 'text', '뒤')];
    expect(collectThinkRuns(sealed, skipPulse)).toEqual([{ firstId: 'b', startedAt: 100, endedAt: 100, chars: 500 }]);
  });

  it('문턱을 못 넘는 런은 봉인돼도 자국이 되지 않는다', () => {
    const events = [evt('b', 0, 'thinking', 'x'), evt('c', 10, 'text', '뒤')];
    expect(collectThinkRuns(events, skipPulse)).toEqual([]);
  });
});

describe('toolGroupElapsedMs', () => {
  it('묶음 안 시각의 폭으로 잰다 — 호출이 하나뿐이면 0(잴 수 없다)', () => {
    expect(toolGroupElapsedMs([])).toBe(0);
    expect(toolGroupElapsedMs([100])).toBe(0);
    expect(toolGroupElapsedMs([100, 5_100])).toBe(5_000);
    // 순서가 뒤섞여 들어와도 폭은 같다(정렬을 전제하지 않는다).
    expect(toolGroupElapsedMs([5_100, 100, 3_000])).toBe(5_000);
  });
});
