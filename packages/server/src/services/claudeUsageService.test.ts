import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildPlanLabel, severityForPercent, buildClaudeUsage } from './claudeUsageService.js';
import type { RateLimitInfo } from '@vibisual/shared';

// §4 — 사용량 표시값은 statusLine 이 보고한 창(`RateLimitInfo`)에서 파생된다.
// 종전의 `/api/oauth/usage` 응답 정규화 테스트는 그 경로를 걷어내며 함께 폐기했다.

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

/** 자격증명 파일이 없는 환경(플랜 표시명 없음)으로 고정 — 테스트가 실제 홈 디렉터리를 타지 않게. */
beforeEach(() => {
  vi.spyOn(require('node:fs'), 'readFileSync').mockImplementation(() => {
    throw new Error('no credentials in test');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildPlanLabel', () => {
  it('subscriptionType 과 rateLimitTier 의 배수를 합쳐 표시명을 만든다', () => {
    expect(buildPlanLabel('max', 'default_claude_max_20x')).toBe('Max (20x)');
  });

  it('배수 표기가 없으면 타입만 쓴다', () => {
    expect(buildPlanLabel('pro')).toBe('Pro');
  });

  it('구독 정보가 없으면 undefined', () => {
    expect(buildPlanLabel(undefined, 'default_claude_max_20x')).toBeUndefined();
  });
});

describe('severityForPercent', () => {
  it('임계 아래는 normal', () => {
    expect(severityForPercent(0)).toBe('normal');
    expect(severityForPercent(69)).toBe('normal');
  });

  it('경고 임계부터 warning', () => {
    expect(severityForPercent(70)).toBe('warning');
    expect(severityForPercent(89)).toBe('warning');
  });

  it('위험 임계부터 critical', () => {
    expect(severityForPercent(90)).toBe('critical');
    expect(severityForPercent(100)).toBe('critical');
  });
});

describe('buildClaudeUsage', () => {
  it('5시간·7일 창을 session / weekly_all 로 옮겨 담는다', () => {
    const rate: RateLimitInfo = {
      used5h: 23,
      resetAt5h: NOW + HOUR,
      used7d: 41,
      resetAt7d: NOW + 24 * HOUR,
      updatedAt: NOW,
    };
    const info = buildClaudeUsage(rate, NOW);
    expect(info.source).toBe('statusline');
    expect(info.error).toBeUndefined();
    expect(info.limits).toEqual([
      { kind: 'session', group: 'session', percent: 23, severity: 'normal', resetsAt: NOW + HOUR, isActive: true },
      { kind: 'weekly_all', group: 'weekly', percent: 41, severity: 'normal', resetsAt: NOW + 24 * HOUR, isActive: true },
    ]);
  });

  it('한쪽 창만 와도 그것만 담는다', () => {
    const info = buildClaudeUsage({ used5h: 5, updatedAt: NOW }, NOW);
    expect(info.limits).toHaveLength(1);
    expect(info.limits[0]?.kind).toBe('session');
    expect(info.limits[0]?.resetsAt).toBeUndefined();
  });

  it('리셋 시각이 지난 창은 0% 로 본다 — "지났는데 아직 100%" 를 막는다', () => {
    const rate: RateLimitInfo = { used5h: 100, resetAt5h: NOW - 1, updatedAt: NOW - HOUR };
    const info = buildClaudeUsage(rate, NOW);
    expect(info.limits[0]?.percent).toBe(0);
    expect(info.limits[0]?.severity).toBe('normal');
    // 만료된 리셋 시각은 카운트다운에 쓰이면 안 되므로 싣지 않는다.
    expect(info.limits[0]?.resetsAt).toBeUndefined();
  });

  it('범위를 벗어난 값은 0~100 으로 자른다', () => {
    expect(buildClaudeUsage({ used5h: 140, updatedAt: NOW }, NOW).limits[0]?.percent).toBe(100);
    expect(buildClaudeUsage({ used5h: -3, updatedAt: NOW }, NOW).limits[0]?.percent).toBe(0);
  });

  it('1%는 1%로 남는다 — v3.64 가 고친 비율/퍼센트 중의성 회귀 못', () => {
    expect(buildClaudeUsage({ used5h: 1, updatedAt: NOW }, NOW).limits[0]?.percent).toBe(1);
  });

  it('값이 하나도 없으면 오류로 표시해 수집기 스위치를 띄운다', () => {
    const info = buildClaudeUsage(undefined, NOW);
    expect(info.limits).toEqual([]);
    expect(info.error).toBe('no-credentials');
  });

  it('숫자가 아닌 값은 창으로 세지 않는다', () => {
    const info = buildClaudeUsage({ used5h: Number.NaN, updatedAt: NOW }, NOW);
    expect(info.limits).toEqual([]);
  });
});
