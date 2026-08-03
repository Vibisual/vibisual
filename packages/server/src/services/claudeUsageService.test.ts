import { describe, it, expect } from 'vitest';
import { buildPlanLabel, normalizeLimits, pickPrimaryWindows } from './claudeUsageService.js';

// §4 v3.62 — `/api/oauth/usage` 응답 정규화 테스트.
// 실제 응답(Max 20x 계정)을 그대로 픽스처로 둔다 — 필드명이 바뀌면 여기서 먼저 깨진다.

const REAL_RESPONSE = {
  five_hour: { utilization: 1, resets_at: '2026-07-29T16:40:00.359655+00:00' },
  seven_day: { utilization: 7, resets_at: '2026-08-04T18:00:00.359680+00:00' },
  seven_day_opus: null,
  extra_usage: {
    is_enabled: false,
    monthly_limit: null,
    used_credits: null,
    utilization: null,
    user_disabled: true,
  },
  limits: [
    { kind: 'session', group: 'session', percent: 1, severity: 'normal', resets_at: '2026-07-29T16:40:00.359655+00:00', scope: null, is_active: false },
    { kind: 'weekly_all', group: 'weekly', percent: 7, severity: 'normal', resets_at: '2026-08-04T18:00:00.359680+00:00', scope: null, is_active: true },
    { kind: 'weekly_scoped', group: 'weekly', percent: 0, severity: 'normal', resets_at: null, scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: false },
  ],
};

describe('buildPlanLabel', () => {
  it('subscriptionType 과 rateLimitTier 의 배수를 합쳐 표시명을 만든다', () => {
    expect(buildPlanLabel('max', 'default_claude_max_20x')).toBe('Max (20x)');
    expect(buildPlanLabel('max', 'default_claude_max_5x')).toBe('Max (5x)');
  });

  it('배수 표기가 없으면 타입만 쓴다', () => {
    expect(buildPlanLabel('pro', 'default_claude_pro')).toBe('Pro');
    expect(buildPlanLabel('pro')).toBe('Pro');
  });

  it('구독 정보가 없으면 undefined', () => {
    expect(buildPlanLabel(undefined, 'default_claude_max_20x')).toBeUndefined();
  });
});

describe('normalizeLimits', () => {
  it('limits 배열을 그대로 정규화한다 (모델별 항목 포함)', () => {
    const out = normalizeLimits(REAL_RESPONSE);
    expect(out).toHaveLength(3);

    const session = out[0]!;
    expect(session.kind).toBe('session');
    expect(session.percent).toBe(1);
    expect(session.resetsAt).toBe(Date.parse('2026-07-29T16:40:00.359655+00:00'));
    expect(session.isActive).toBe(false);

    const scoped = out[2]!;
    expect(scoped.scopeLabel).toBe('Fable');
    // resets_at 이 null 이면 필드 자체가 없어야 한다(0 으로 굳으면 "방금 리셋" 으로 오표시).
    expect(scoped.resetsAt).toBeUndefined();
  });

  it('limits 배열이 없으면 five_hour/seven_day 로 합성한다', () => {
    const { limits: _drop, ...noArray } = REAL_RESPONSE;
    const out = normalizeLimits(noArray);
    expect(out.map((l) => l.kind)).toEqual(['session', 'weekly_all']);
    expect(out[1]!.percent).toBe(7);
  });

  it('percent 가 없는 항목은 버린다', () => {
    const out = normalizeLimits({ limits: [{ kind: 'session', group: 'session', severity: 'normal' }] });
    expect(out).toEqual([]);
  });

  it('응답이 비어도 예외 없이 빈 배열', () => {
    expect(normalizeLimits({})).toEqual([]);
  });
});

describe('pickPrimaryWindows', () => {
  it('세션/주간 전체를 §4 v1.50 RateLimitInfo 모양으로 뽑는다', () => {
    const w = pickPrimaryWindows(normalizeLimits(REAL_RESPONSE));
    expect(w.used5h).toBe(1);
    expect(w.used7d).toBe(7);
    expect(w.resetAt5h).toBe(Date.parse('2026-07-29T16:40:00.359655+00:00'));
  });

  it('모델별(scoped) 항목을 주간 전체로 오인하지 않는다', () => {
    const w = pickPrimaryWindows([
      { kind: 'weekly_scoped', group: 'weekly', percent: 42, severity: 'normal', scopeLabel: 'Fable', isActive: true },
    ]);
    expect(w.used7d).toBeUndefined();
  });

  it('빈 목록이면 빈 객체', () => {
    expect(pickPrimaryWindows([])).toEqual({});
  });
});
