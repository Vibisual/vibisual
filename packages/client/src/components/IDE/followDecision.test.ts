import { describe, it, expect } from 'vitest';
import { decideFollow } from './followDecision.js';

/**
 * 바닥 자동추종 판정 회귀 테스트.
 * 재현하는 핵심 버그: 스트리밍으로 마지막 항목이 자라면 virtuoso 가 위쪽 버퍼를 재측정하며 스스로 scrollTop 을
 * 보정해 scroll 이벤트를 쏘는데, 그 순간 dist 가 임계를 넘는다. 옛 코드는 그 dist 만 보고 추종을 꺼서 화면이
 * "위로 말려 올라갔다". decideFollow 는 사용자 위로-제스처가 없으면 그 경우 추종을 유지해야 한다.
 */
const T = 80; // FOLLOW_BOTTOM_THRESHOLD

describe('decideFollow', () => {
  it('바닥에 닿으면(dist<threshold) 항상 추종 ON — pin 이 붙였든 직접 내렸든 재무장', () => {
    expect(decideFollow({ dist: 0, threshold: T, prevFollow: false, userUpIntent: false })).toBe(true);
    expect(decideFollow({ dist: 79, threshold: T, prevFollow: false, userUpIntent: true })).toBe(true);
  });

  it('[회귀] 스트리밍 성장으로 dist 가 커져도(사용자 제스처 없음) 추종을 유지한다 — "위로 말림" 차단', () => {
    // 새 단어가 그려져 dist=500 까지 벌어진 프로그램/측정 scroll. userUpIntent=false 이므로 추종 유지.
    expect(decideFollow({ dist: 500, threshold: T, prevFollow: true, userUpIntent: false })).toBe(true);
    expect(decideFollow({ dist: 1200, threshold: T, prevFollow: true, userUpIntent: false })).toBe(true);
  });

  it('사용자가 직접 위로 올려(userUpIntent) 바닥에서 멀어지면 추종 OFF(그 자리 고정)', () => {
    expect(decideFollow({ dist: 300, threshold: T, prevFollow: true, userUpIntent: true })).toBe(false);
  });

  it('위로 올려 읽는 중(추종 OFF) 새 출력이 와도(제스처 없음) 계속 OFF — 끌려내려가지 않음', () => {
    expect(decideFollow({ dist: 600, threshold: T, prevFollow: false, userUpIntent: false })).toBe(false);
  });

  it('OFF 상태에서 다시 바닥까지 내리면 자동 추종 재개', () => {
    expect(decideFollow({ dist: 10, threshold: T, prevFollow: false, userUpIntent: false })).toBe(true);
  });

  it('경계값: dist === threshold 는 바닥 아님(미만일 때만 바닥)', () => {
    // 제스처 없음 → 직전 상태 유지
    expect(decideFollow({ dist: T, threshold: T, prevFollow: true, userUpIntent: false })).toBe(true);
    expect(decideFollow({ dist: T, threshold: T, prevFollow: false, userUpIntent: false })).toBe(false);
  });
});
