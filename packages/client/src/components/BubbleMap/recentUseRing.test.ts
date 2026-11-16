import { describe, expect, it } from 'vitest';
import {
  RECENT_USE_RING,
  RECENT_USE_OTHER_AGENT,
  isRecentUseBubble,
  normalizeRecentUseRingCount,
  recentUseFocus,
  recentUseRingLook,
  recentUseRingStrength,
  recentUseStrength,
  normalizeAgentFieldForCompare,
} from '@vibisual/shared';

describe('§5.1 #3-5 최근 사용 링 판정', () => {
  it('개수는 기본·범위·0(끔)을 지킨다', () => {
    expect(normalizeRecentUseRingCount(undefined)).toBe(RECENT_USE_RING.defaultCount);
    expect(normalizeRecentUseRingCount(0)).toBe(0);
    expect(normalizeRecentUseRingCount(-3)).toBe(RECENT_USE_RING.countMin);
    expect(normalizeRecentUseRingCount(999)).toBe(RECENT_USE_RING.countMax);
    expect(normalizeRecentUseRingCount(3.9)).toBe(3);
  });

  it('설정 비교에서 0 은 미설정과 다르고, 기본 개수는 미설정과 같다', () => {
    expect(normalizeAgentFieldForCompare('recentUseRings', 0)).not.toBe(normalizeAgentFieldForCompare('recentUseRings', undefined));
    expect(normalizeAgentFieldForCompare('recentUseRings', RECENT_USE_RING.defaultCount)).toBe(normalizeAgentFieldForCompare('recentUseRings', undefined));
  });

  it('가장 최근이 가장 세고 뒤로 갈수록 줄어든다', () => {
    const s = [0, 1, 2, 3, 4].map((rank) => recentUseStrength(rank, 5));
    expect(s[0]).toBe(1);
    for (let i = 1; i < s.length; i += 1) expect(s[i]!).toBeLessThan(s[i - 1]!);
    expect(recentUseStrength(5, 5)).toBe(0);
    expect(recentUseStrength(0, 0)).toBe(0);
  });

  it('번짐·밝기도 순위를 따라 줄고, 가장 최근의 시작 불투명도는 0.4 를 넘지 않는다', () => {
    const looks = [1, 0.8, 0.6, 0.4, 0.2].map(recentUseRingLook);
    for (let i = 1; i < looks.length; i += 1) {
      expect(looks[i]!.reachPx).toBeLessThan(looks[i - 1]!.reachPx);
      expect(looks[i]!.alpha).toBeLessThan(looks[i - 1]!.alpha);
    }
    expect(looks[0]!.alpha).toBeLessThanOrEqual(0.4);
    expect(recentUseRingLook(0)).toEqual({ reachPx: 0, alpha: 0 });
  });

  it('함께 쓴 버블은 가장 가까운 순위 하나, 고른 에이전트가 있으면 그 순위만', () => {
    const marks = [{ agentId: 'A', rank: 3, limit: 5 }, { agentId: 'B', rank: 0, limit: 5 }];
    expect(recentUseRingStrength(marks, null)).toBe(1);
    expect(recentUseRingStrength(marks, 'A')).toBeCloseTo(0.4);
    expect(recentUseRingStrength(marks, RECENT_USE_OTHER_AGENT)).toBe(0);
    expect(recentUseRingStrength(undefined, null)).toBe(0);
  });

  it('고른 것이 이 버블을 쓴 에이전트·다른 에이전트·에이전트 아님을 가른다', () => {
    const marks = [{ agentId: 'A', rank: 0, limit: 5 }];
    const isAgent = (id: string): boolean => id === 'A' || id === 'B';
    expect(recentUseFocus('A', marks, isAgent)).toBe('A');
    expect(recentUseFocus('B', marks, isAgent)).toBe(RECENT_USE_OTHER_AGENT);
    expect(recentUseFocus('file-1', marks, isAgent)).toBeNull();
    expect(recentUseFocus(null, marks, isAgent)).toBeNull();
  });

  it('링을 두르는 것은 에이전트가 쓰는 버블뿐이다', () => {
    expect(isRecentUseBubble({ bubbleType: 'file' })).toBe(true);
    expect(isRecentUseBubble({ bubbleType: 'domain' })).toBe(true);
    expect(isRecentUseBubble({ bubbleType: 'bash' })).toBe(false);
    expect(isRecentUseBubble({ bubbleType: 'agent' })).toBe(false);
    expect(isRecentUseBubble({ bubbleType: 'worktree' })).toBe(false);
  });
});
