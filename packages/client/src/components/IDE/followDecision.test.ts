import { describe, it, expect } from 'vitest';
import { decideFollow } from './followDecision.js';

/**
 * 바닥 자동추종 판정 회귀 테스트.
 * v3.08 핵심: 스트리밍으로 마지막 항목이 자라면 virtuoso 가 위쪽 버퍼를 재측정하며 스스로 scrollTop 을
 * 보정해 scroll 이벤트를 쏘는데, 그 순간 dist 가 임계를 넘는다. 사용자 위로-제스처가 없으면 추종 유지.
 * v3.15 핵심: 위로-제스처 + 위로 이동이면 **거리 무관 즉시 해제** — 바닥 임계 안쪽의 잔잔한 휠-업이
 * 재무장돼 워치독이 도로 붙이던("살짝 올리면 다시 밑에 붙고, 세게 올려야만 올라감") 증상 차단.
 */
const T = 80; // FOLLOW_BOTTOM_THRESHOLD

describe('decideFollow', () => {
  it('바닥에 아래로/제자리 이동으로 닿으면(dist<threshold) 추종 ON — 직접 내렸든 워치독이 붙였든 재무장', () => {
    expect(decideFollow({ dist: 0, threshold: T, prevFollow: false, userUpIntent: false, goingUp: false })).toBe(true);
    expect(decideFollow({ dist: 79, threshold: T, prevFollow: false, userUpIntent: true, goingUp: false })).toBe(true);
  });

  it('[회귀 v3.08] 스트리밍 성장으로 dist 가 커져도(사용자 제스처 없음) 추종 유지 — "위로 말림" 차단', () => {
    // 새 단어가 그려져 dist=500 까지 벌어진 프로그램/측정 scroll. userUpIntent=false 이므로 추종 유지.
    expect(decideFollow({ dist: 500, threshold: T, prevFollow: true, userUpIntent: false, goingUp: false })).toBe(true);
    expect(decideFollow({ dist: 1200, threshold: T, prevFollow: true, userUpIntent: false, goingUp: true })).toBe(true);
  });

  it('사용자가 직접 위로 올려(userUpIntent) 바닥에서 멀어지면 추종 OFF(그 자리 고정)', () => {
    expect(decideFollow({ dist: 300, threshold: T, prevFollow: true, userUpIntent: true, goingUp: true })).toBe(false);
  });

  it('[회귀 v3.15] 바닥 임계 안쪽의 잔잔한 휠-업도 즉시 해제 — "세게 올려야만 올라감" 차단', () => {
    // 한 칸 휠-업으로 dist=30(임계 미만)만 벌어진 경우 — 옛 규칙은 재무장해 워치독이 도로 붙였다.
    expect(decideFollow({ dist: 30, threshold: T, prevFollow: true, userUpIntent: true, goingUp: true })).toBe(false);
    expect(decideFollow({ dist: 5, threshold: T, prevFollow: true, userUpIntent: true, goingUp: true })).toBe(false);
  });

  it('[회귀 v3.15] 해제 직후 위로 이동인 프로그램 보정이 임계 안이어도 재무장하지 않는다(스냅백 금지)', () => {
    expect(decideFollow({ dist: 30, threshold: T, prevFollow: false, userUpIntent: false, goingUp: true })).toBe(false);
  });

  it('위로 올려 읽는 중(추종 OFF) 새 출력이 와도(제스처 없음) 계속 OFF — 끌려내려가지 않음', () => {
    expect(decideFollow({ dist: 600, threshold: T, prevFollow: false, userUpIntent: false, goingUp: false })).toBe(false);
  });

  it('OFF 상태에서 다시 바닥까지 내리면 자동 추종 재개', () => {
    expect(decideFollow({ dist: 10, threshold: T, prevFollow: false, userUpIntent: false, goingUp: false })).toBe(true);
  });

  it('추종 중 위로 이동인 프로그램 보정(제스처 없음)은 임계 안이면 추종 유지(v3.08 불변)', () => {
    expect(decideFollow({ dist: 20, threshold: T, prevFollow: true, userUpIntent: false, goingUp: true })).toBe(true);
  });

  it('경계값: dist === threshold 는 바닥 아님(미만일 때만 바닥)', () => {
    // 제스처 없음 → 직전 상태 유지
    expect(decideFollow({ dist: T, threshold: T, prevFollow: true, userUpIntent: false, goingUp: false })).toBe(true);
    expect(decideFollow({ dist: T, threshold: T, prevFollow: false, userUpIntent: false, goingUp: false })).toBe(false);
  });
});
