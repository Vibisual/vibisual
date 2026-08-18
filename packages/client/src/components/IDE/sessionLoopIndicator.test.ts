import { describe, it, expect } from 'vitest';
import type { SessionLoop } from '@vibisual/shared';
import { serializeRunningLoops, parseRunningLoops } from './sessionLoopIndicator.js';

/**
 * §5.5 #17-11 ⑩ v5.02 — 세션 탭의 반복 루프 표시 산식 회귀.
 *
 * 고정하는 약속: ① 아이콘은 `enabled` 인 탭에만 뜬다(끄면 그 자리에서 사라진다),
 * ② 같은 상태면 같은 문자열이 나온다(값이 안 바뀌었는데 탭바가 다시 그려지지 않게),
 * ③ 왕복(직렬화→파싱)이 진행 표기를 그대로 보존한다(툴팁의 `완료/목표`).
 */

function loop(over: Partial<SessionLoop> = {}): SessionLoop {
  return {
    agentId: 'agent-1',
    subAgentId: 'sub-a',
    command: 'run tests',
    mode: 'count',
    total: 5,
    completed: 2,
    enabled: true,
    intervalMs: 0,
    stopOnError: true,
    contextMode: 'none',
    spentCostUsd: 0,
    spentTokens: 0,
    oneTaskPerRound: false,
    commitEachRound: false,
    status: 'running',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe('serializeRunningLoops — 켜진 루프만 프리미티브 한 줄로', () => {
  it('루프가 없으면 빈 문자열', () => {
    expect(serializeRunningLoops(undefined)).toBe('');
    expect(serializeRunningLoops({})).toBe('');
  });

  it('꺼진 루프는 빠진다 — 끄면 아이콘이 사라진다는 약속', () => {
    const loops = { 'sub-a': loop({ enabled: false, status: 'stopped' }) };
    expect(serializeRunningLoops(loops)).toBe('');
  });

  it('켜진 것만 남긴다', () => {
    const loops = {
      'sub-a': loop({ subAgentId: 'sub-a' }),
      'sub-b': loop({ subAgentId: 'sub-b', enabled: false }),
    };
    expect(parseRunningLoops(serializeRunningLoops(loops)).has('sub-a')).toBe(true);
    expect(parseRunningLoops(serializeRunningLoops(loops)).has('sub-b')).toBe(false);
  });

  it('키 순서가 달라도 같은 문자열 — 순서만 흔들린 스냅샷은 리렌더를 만들지 않는다', () => {
    const a = loop({ subAgentId: 'sub-a' });
    const b = loop({ subAgentId: 'sub-b', completed: 7 });
    expect(serializeRunningLoops({ 'sub-a': a, 'sub-b': b }))
      .toBe(serializeRunningLoops({ 'sub-b': b, 'sub-a': a }));
  });

  it('회차가 오르면 문자열도 바뀐다 — 툴팁 진행이 따라가야 한다', () => {
    const before = serializeRunningLoops({ 'sub-a': loop({ completed: 2 }) });
    const after = serializeRunningLoops({ 'sub-a': loop({ completed: 3 }) });
    expect(after).not.toBe(before);
  });
});

describe('parseRunningLoops — 탭 조회용 Map 왕복', () => {
  it('count 루프는 완료/목표를 보존한다', () => {
    const map = parseRunningLoops(serializeRunningLoops({ 'sub-a': loop({ completed: 2, total: 5 }) }));
    expect(map.get('sub-a')).toEqual({ completed: 2, total: 5 });
  });

  it('무한 루프는 목표가 null', () => {
    const map = parseRunningLoops(
      serializeRunningLoops({ 'sub-a': loop({ mode: 'infinite', total: undefined, completed: 9 }) }),
    );
    expect(map.get('sub-a')).toEqual({ completed: 9, total: null });
  });

  it('목표 미지정 count 는 0 으로 — 활동바 배지와 같은 표기', () => {
    const map = parseRunningLoops(serializeRunningLoops({ 'sub-a': loop({ total: undefined }) }));
    expect(map.get('sub-a')?.total).toBe(0);
  });

  it('빈 문자열·깨진 줄은 조용히 건너뛴다', () => {
    expect(parseRunningLoops('').size).toBe(0);
    expect(parseRunningLoops('sub-a|2;sub-b|1|3').size).toBe(1);
  });
});
