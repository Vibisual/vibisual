import { describe, it, expect } from 'vitest';
import { clampUsagePct, usageTextToneClass, usageBarToneClass } from './usageLimits.js';

// SCENARIO.md §4 v3.64 — "1% 가 100% 로 보이던" 회귀 방지.
//
// Claude 앱은 1% 인데 Vibisual 만 빨간 100% 를 띄워 사용자를 놀라게 한 사고가 있었다.
// 원인은 "0~1 이면 비율이니 ×100" 이라는 추측이었다. 값 1 은 "1%" 와 "100%" 어느 쪽으로도
// 읽히므로 추측으로는 풀 수 없다 — 단위를 퍼센트로 고정한 지금 규약을 여기서 못 박는다.

describe('clampUsagePct', () => {
  it('1 은 1% 다 — 절대 100% 로 부풀리지 않는다 (v3.64 회귀)', () => {
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
