import { describe, it, expect } from 'vitest';
import type { ClaudeUsageLimit } from '@vibisual/shared';
import { clampUsagePct, pickClaudePillLimit, usageTextToneClass, usageBarToneClass } from './usageLimits.js';

// §4 — "1% 가 100% 로 보이던" 회귀 방지. 값 1 은 "1%" 와 "100%" 어느 쪽으로도 읽혀 "0~1 이면 비율" 추측으로는 풀 수 없다 — 단위를 퍼센트로 고정한 규약을 못 박는다.

describe('clampUsagePct', () => {
  it('1 은 1% 다 — 절대 100% 로 부풀리지 않는다 (회귀)', () => {
    expect(clampUsagePct(1)).toBe(1);
  });

  it('소수점 사용률도 그대로 퍼센트로 읽는다', () => {
    expect(clampUsagePct(0.5)).toBe(0.5);
    expect(clampUsagePct(0)).toBe(0);
  });

  it('일반 퍼센트 값은 그대로 통과한다', () => {
    expect(clampUsagePct(2)).toBe(2);
    expect(clampUsagePct(22)).toBe(22);
    expect(clampUsagePct(100)).toBe(100);
  });

  it('범위 밖 값만 잘라낸다', () => {
    expect(clampUsagePct(120)).toBe(100);
    expect(clampUsagePct(-5)).toBe(0);
  });

  it('숫자가 아닌 값은 0 으로 떨어뜨린다(NaN 이 화면에 새지 않게)', () => {
    expect(clampUsagePct(Number.NaN)).toBe(0);
    expect(clampUsagePct(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('사용률 색 임계', () => {
  it('낮은 사용률은 안전색 — 1% 가 위험색으로 보이면 안 된다', () => {
    expect(usageTextToneClass(1)).toContain('emerald');
    expect(usageBarToneClass(1)).toContain('emerald');
  });

  it('70% 부터 경고, 90% 부터 위험', () => {
    expect(usageTextToneClass(69)).toContain('emerald');
    expect(usageTextToneClass(70)).toContain('amber');
    expect(usageTextToneClass(89)).toContain('amber');
    expect(usageTextToneClass(90)).toContain('red');
    expect(usageBarToneClass(100)).toContain('red');
  });
});

describe('pickClaudePillLimit — 헤더 필이 보일 한도', () => {
  const row = (kind: string, group: string, percent: number, scopeLabel?: string): ClaudeUsageLimit =>
    ({ kind, group, percent, severity: 'normal', isActive: true, ...(scopeLabel ? { scopeLabel } : {}) });

  it('5시간 한도가 있으면 그것(Pro·Max)', () => {
    expect(pickClaudePillLimit([row('session', 'session', 12), row('weekly_all', 'weekly', 80)], null))
      .toEqual({ kind: 'fiveHour', percent: 12 });
  });

  it('5시간 한도가 없으면 주간(모든 모델) — 모델별 줄은 고르지 않는다(인증된 Ultra)', () => {
    expect(pickClaudePillLimit([row('weekly_scoped', 'weekly', 95, 'Fable'), row('weekly_all', 'weekly', 4)], null))
      .toEqual({ kind: 'weekly', percent: 4 });
  });

  it('서버 표가 있으면 옛 statusLine 5시간 값으로 되돌아가지 않는다', () => {
    expect(pickClaudePillLimit([row('weekly_all', 'weekly', 4)], { used5h: 37 })).toEqual({ kind: 'weekly', percent: 4 });
  });

  it('서버 표가 비었을 때만 statusLine 원본 — 그것도 없으면 null(`-`)', () => {
    expect(pickClaudePillLimit([], { used5h: 37, used7d: 3 })).toEqual({ kind: 'fiveHour', percent: 37 });
    expect(pickClaudePillLimit(undefined, { used7d: 3 })).toEqual({ kind: 'weekly', percent: 3 });
    expect(pickClaudePillLimit(undefined, null)).toBeNull();
  });
});
