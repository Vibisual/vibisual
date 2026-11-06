import { describe, it, expect } from 'vitest';
import {
  assembleProbeSnapshot,
  claudeConfigJsonPaths,
  parseCachedUsageUtilization,
  parseScopedWeeklyRows,
  parseUsageReport,
  readUsageStream,
} from './claudeUsageProbe.js';

// §4 — `claude -p "/usage"` probe 의 순수 파서들.
//   실행(spawn)은 여기서 다루지 않는다 — 값의 해석이 틀리면 화면이 조용히 거짓말을 하므로
//   그 해석만 고정한다.

/** 실제 `~/.claude.json` 에서 우리가 읽는 부분만 떼어낸 표본(값은 축약). */
const SAMPLE = JSON.stringify({
  someOtherKey: 1,
  cachedUsageUtilization: {
    fetchedAtMs: 1_787_750_397_992,
    accountUuid: 'uuid-not-read',
    utilization: {
      five_hour: { utilization: 16, resets_at: '2026-08-27T02:00:00.057325+00:00' },
      seven_day: { utilization: 87, resets_at: '2026-09-02T18:00:00.057360+00:00' },
      seven_day_opus: null,
      nimbus_quill: { utilization: 0, resets_at: null },
      extra_usage: {
        is_enabled: false,
        monthly_limit: 5000,
        used_credits: 250,
        utilization: 5,
        currency: 'USD',
        decimal_places: 2,
      },
    },
  },
});

describe('parseCachedUsageUtilization', () => {
  it('5시간·7일 창과 리셋 시각을 epoch ms 로 옮겨 담는다', () => {
    const snap = parseCachedUsageUtilization(SAMPLE);
    expect(snap).not.toBeNull();
    expect(snap?.fetchedAt).toBe(1_787_750_397_992);
    expect(snap?.session).toEqual({ percent: 16, resetsAt: Date.parse('2026-08-27T02:00:00.057325+00:00') });
    expect(snap?.weekly).toEqual({ percent: 87, resetsAt: Date.parse('2026-09-02T18:00:00.057360+00:00') });
  });

  it('사용 크레딧은 decimal_places 를 되돌려 표시 단위로 담는다', () => {
    const snap = parseCachedUsageUtilization(SAMPLE);
    expect(snap?.extraCredits).toEqual({
      enabled: false,
      utilization: 5,
      usedCredits: 2.5,
      monthlyLimit: 50,
      currency: 'USD',
    });
  });

  it('리셋 시각이 null 이면 그 창은 시각 없이 담는다', () => {
    const raw = JSON.stringify({
      cachedUsageUtilization: { fetchedAtMs: 1, utilization: { five_hour: { utilization: 3, resets_at: null } } },
    });
    expect(parseCachedUsageUtilization(raw)?.session).toEqual({ percent: 3 });
  });

  it('JSON 이 아니거나 캐시 블록이 없으면 null — 추측하지 않는다', () => {
    expect(parseCachedUsageUtilization('not json')).toBeNull();
    expect(parseCachedUsageUtilization('{}')).toBeNull();
    expect(parseCachedUsageUtilization(JSON.stringify({ cachedUsageUtilization: { utilization: {} } }))).toBeNull();
  });

  it('퍼센트는 0~100 으로 자른다', () => {
    const raw = JSON.stringify({
      cachedUsageUtilization: { fetchedAtMs: 1, utilization: { five_hour: { utilization: 140 } } },
    });
    expect(parseCachedUsageUtilization(raw)?.session?.percent).toBe(100);
  });
});

/** 2.1.317 이 적는 꼴 — 인증된 Ultra 계정(5시간 창 없음). 값·식별자는 바꿔 적었다. */
const SAMPLE_2_1_317 = {
  oauthAccount: { emailAddress: 'someone@example.com', organizationUuid: 'org-not-read', planDisplayName: 'Ultra' },
  cachedUsageUtilization: {
    fetchedAtMs: 1_793_724_786_176,
    accountUuid: 'uuid-not-read',
    utilization: {
      five_hour: null,
      seven_day: { utilization: 4, resets_at: '2026-11-10T14:59:59.858544+00:00' },
      iguana_necktie: { utilization: 100, resets_at: '2026-11-05T07:59:00+00:00', limit_dollars: 250 },
      extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null, currency: null, decimal_places: null, user_disabled: true },
      limits: [
        { kind: 'weekly_all', group: 'weekly', percent: 4, severity: 'normal', resets_at: '2026-11-10T14:59:59.858544+00:00', scope: null, is_active: true },
        {
          kind: 'weekly_scoped', group: 'weekly', percent: 0, severity: 'normal', resets_at: '2026-11-10T15:00:00+00:00',
          scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: false,
        },
      ],
      spend: {
        used: { amount_minor: 0, currency: 'USD', exponent: 2 },
        limit: null, percent: 0, severity: 'normal', enabled: false, disabled_reason: null,
        cap: null, balance: null, auto_reload: null, can_purchase_credits: false, can_toggle: false,
      },
    },
  },
};

describe('parseCachedUsageUtilization — CLI 표시 목록(limits[])', () => {
  it('표시 목록에 없는 5시간 창은 비운다 — 0% 로 지어내지 않는다', () => {
    const snap = parseCachedUsageUtilization(JSON.stringify(SAMPLE_2_1_317));
    expect(snap?.listed).toBe(true);
    expect(snap?.session).toBeUndefined();
    expect(snap?.weekly).toEqual({ percent: 4, resetsAt: Date.parse('2026-11-10T14:59:59.858544+00:00') });
  });

  it('모델별 줄은 표시명·초기화 시각·is_active 를 목록에서 그대로 받는다', () => {
    expect(parseCachedUsageUtilization(JSON.stringify(SAMPLE_2_1_317))?.scoped).toEqual([
      { label: 'Fable', percent: 0, resetsAt: Date.parse('2026-11-10T15:00:00+00:00'), isActive: false },
    ]);
  });

  it('플랜 이름은 CLI 가 적은 공식 표시명 — 같은 객체의 이메일·식별자는 싣지 않는다', () => {
    const snap = parseCachedUsageUtilization(JSON.stringify(SAMPLE_2_1_317));
    expect(snap?.planName).toBe('Ultra');
    expect(JSON.stringify(snap)).not.toContain('example.com');
    expect(JSON.stringify(snap)).not.toContain('org-not-read');
  });

  it('5시간 줄이 목록에 있으면 그대로 받는다(Pro·Max)', () => {
    const raw = JSON.stringify({
      cachedUsageUtilization: {
        fetchedAtMs: 1,
        utilization: {
          five_hour: { utilization: 99, resets_at: '2026-11-04T05:00:00+00:00' },
          limits: [{ kind: 'session', group: 'session', percent: 40, resets_at: '2026-11-04T03:00:00+00:00', scope: null }],
        },
      },
    });
    expect(parseCachedUsageUtilization(raw)?.session).toEqual({ percent: 40, resetsAt: Date.parse('2026-11-04T03:00:00+00:00') });
  });

  it('목록에 아는 줄이 없으면 옛 창 키로 폴백한다', () => {
    const raw = JSON.stringify({
      cachedUsageUtilization: {
        fetchedAtMs: 1,
        utilization: { five_hour: { utilization: 12 }, limits: [{ kind: 'mystery', group: 'other', percent: 5 }] },
      },
    });
    const snap = parseCachedUsageUtilization(raw);
    expect(snap?.listed).toBeUndefined();
    expect(snap?.session).toEqual({ percent: 12 });
  });

  it('plan 표시명이 문자열이 아니면 없는 것으로 본다', () => {
    const raw = JSON.stringify({ ...SAMPLE_2_1_317, oauthAccount: { planDisplayName: 42 } });
    expect(parseCachedUsageUtilization(raw)?.planName).toBeUndefined();
  });
});

describe('parseCachedUsageUtilization — 사용 크레딧 spend', () => {
  it('금액 꼴이 확인된 칸만 — 한도가 없으면 사용률도 싣지 않는다', () => {
    expect(parseCachedUsageUtilization(JSON.stringify(SAMPLE_2_1_317))?.extraCredits).toEqual({
      enabled: false,
      usedCredits: 0,
      currency: 'USD',
    });
  });

  it('한도·잔액·자동 충전이 오면 표시 단위로 옮긴다', () => {
    const sample = structuredClone(SAMPLE_2_1_317) as unknown as {
      cachedUsageUtilization: { utilization: { spend: Record<string, unknown> } };
    };
    Object.assign(sample.cachedUsageUtilization.utilization.spend, {
      enabled: true,
      used: { amount_minor: 1234, currency: 'USD', exponent: 2 },
      limit: { amount_minor: 5000, currency: 'USD', exponent: 2 },
      balance: { amount_minor: 800, currency: 'USD', exponent: 2 },
      auto_reload: { enabled: true },
      percent: 24.68,
    });
    expect(parseCachedUsageUtilization(JSON.stringify(sample))?.extraCredits).toEqual({
      enabled: true,
      utilization: 24.68,
      usedCredits: 12.34,
      monthlyLimit: 50,
      balance: 8,
      autoReload: true,
      currency: 'USD',
    });
  });

  it('모양을 모르는 칸은 금액으로 읽지 않는다', () => {
    const sample = structuredClone(SAMPLE_2_1_317) as unknown as {
      cachedUsageUtilization: { utilization: { spend: Record<string, unknown> } };
    };
    Object.assign(sample.cachedUsageUtilization.utilization.spend, { limit: 5000, balance: { amount: 8 }, auto_reload: 'on' });
    const credits = parseCachedUsageUtilization(JSON.stringify(sample))?.extraCredits;
    expect(credits?.monthlyLimit).toBeUndefined();
    expect(credits?.balance).toBeUndefined();
    expect(credits?.autoReload).toBeUndefined();
  });

  it('spend 가 없는 옛 판은 extra_usage 를 쓴다', () => {
    expect(parseCachedUsageUtilization(SAMPLE)?.extraCredits?.monthlyLimit).toBe(50);
  });
});

describe('parseScopedWeeklyRows', () => {
  const OUTPUT = [
    'You are currently using your subscription to power your Claude Code usage',
    '',
    'Current session: 3% used · resets Aug 27, 2:59am (Asia/Seoul)',
    'Current week (all models): 15% used · resets Sep 2, 2:59am (Asia/Seoul)',
    'Current week (Fable): 0% used',
    'Current week (Opus): 42% used',
  ].join('\n');

  it('모델별 주간 한도 줄만 집는다(전체 창은 제외 — 이미 JSON 에 있다)', () => {
    expect(parseScopedWeeklyRows(OUTPUT)).toEqual([
      { label: 'Fable', percent: 0 },
      { label: 'Opus', percent: 42 },
    ]);
  });

  it('문구가 달라지면 빈 배열 — 5시간·7일 창은 JSON 에서 그대로 나온다', () => {
    expect(parseScopedWeeklyRows('completely different output')).toEqual([]);
  });
});

describe('claudeConfigJsonPaths', () => {
  it('CLAUDE_CONFIG_DIR 를 먼저 보고, 없으면 홈 디렉터리', () => {
    const paths = claudeConfigJsonPaths('/base', '/cfg');
    expect(paths).toHaveLength(2);
    expect(paths[0]?.replace(/\\/g, '/')).toBe('/cfg/.claude.json');
    expect(paths[1]?.replace(/\\/g, '/')).toBe('/base/.claude.json');
  });

  it('설정 디렉터리가 없으면 홈 하나만', () => {
    expect(claudeConfigJsonPaths('/base')).toHaveLength(1);
    expect(claudeConfigJsonPaths('/base', '   ')).toHaveLength(1);
  });
});

/** 2.1.317 `-p "/usage" --output-format stream-json --verbose` 의 `usage_report` — 키·모양은 실측, 값은 바꿔 적었다. */
const REPORT_2_1_317 = {
  session: { total_cost_usd: 0, total_api_duration_ms: 0, total_duration_ms: 0, total_lines_added: 0, total_lines_removed: 0, model_usage: {} },
  rate_limits: {
    limits: [
      { kind: 'weekly_all', group: 'weekly', percent: 6, resets_at: '2026-11-10T14:59:59.520623+00:00', scope: null, severity: 'normal', is_active: true },
      {
        kind: 'weekly_scoped', group: 'weekly', percent: 0, resets_at: '2026-11-10T15:00:00+00:00',
        scope: { model: { display_name: 'Fable' }, surface: null }, severity: 'normal', is_active: false,
      },
    ],
    extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null, currency: null },
  },
};

/** 실측 줄 순서(init → `/usage` 결과를 싣는 assistant → result). 공식 구조를 안 주면 그 키가 빠진 옛 판의 꼴이 된다. */
function usageStream(report: unknown, resultText = 'Current week (all models): 6% used'): string {
  return [
    JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-opus-5-5', claude_code_version: '2.1.317' }),
    JSON.stringify({ type: 'assistant', message: { model: '<synthetic>', role: 'assistant', content: [] }, usage_report: report, local_command_run: { command: 'usage', args: '' } }),
    JSON.stringify({ type: 'result', subtype: 'success', num_turns: 0, total_cost_usd: 0, result: resultText, local_command: 'usage' }),
  ].join('\n');
}

describe('usage_report — /usage 의 공식 구조가 먼저(§4 v3.60 ⑧)', () => {
  const NOW = Date.parse('2026-11-04T00:00:00Z');

  it('stream-json 에서 공식 구조와 결과 본문을 꺼낸다 — 섞여 든 stderr·깨진 줄은 건너뛴다', () => {
    const stream = readUsageStream(`warning: a stderr line\r\n${usageStream(REPORT_2_1_317)}\r\n{broken`);
    expect(stream.report).toEqual(REPORT_2_1_317);
    expect(stream.resultText).toBe('Current week (all models): 6% used');
    expect(readUsageStream('').report).toBeUndefined();
  });

  it('5시간 줄이 없는 계정은 비우고, 모델별 줄은 표시명·초기화 시각·is_active 를 그대로', () => {
    const snap = parseUsageReport(REPORT_2_1_317, NOW);
    expect(snap?.session).toBeUndefined();
    expect(snap?.weekly).toEqual({ percent: 6, resetsAt: Date.parse('2026-11-10T14:59:59.520623+00:00') });
    expect(snap?.scoped).toEqual([{ label: 'Fable', percent: 0, resetsAt: Date.parse('2026-11-10T15:00:00+00:00'), isActive: false }]);
    expect(snap?.listed).toBe(true);
    expect(snap?.fetchedAt).toBe(NOW);
    expect(snap?.extraCredits).toEqual({ enabled: false });
  });

  it('extra_usage 의 금액 칸은 단위가 적혀 있지 않아 담지 않는다 — 켬/끔·사용률만', () => {
    const snap = parseUsageReport({
      rate_limits: {
        limits: REPORT_2_1_317.rate_limits.limits,
        extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 1234, utilization: 24.68, currency: 'USD' },
      },
    }, NOW);
    expect(snap?.extraCredits).toEqual({ enabled: true, utilization: 24.68, currency: 'USD' });
  });

  it('rate_limits 가 null·빈 목록·모르는 줄뿐이면 null — 캐시로 내려간다', () => {
    expect(parseUsageReport({ rate_limits: null }, NOW)).toBeNull();
    expect(parseUsageReport({ rate_limits: { limits: [] } }, NOW)).toBeNull();
    expect(parseUsageReport({ rate_limits: { limits: [{ kind: 'mystery', group: 'other', percent: 3 }] } }, NOW)).toBeNull();
    expect(parseUsageReport(undefined, NOW)).toBeNull();
  });

  it('한도는 공식 구조에서, 크레딧·플랜명은 캐시에서 잇는다', () => {
    const cached = parseCachedUsageUtilization(JSON.stringify(SAMPLE_2_1_317))!;
    const snap = assembleProbeSnapshot(usageStream(REPORT_2_1_317), cached, NOW)!;
    expect(snap.weekly?.percent).toBe(6);
    expect(snap.scoped.map((s) => s.label)).toEqual(['Fable']);
    expect(snap.fetchedAt).toBe(NOW);
    expect(snap.planName).toBe('Ultra');
    expect(snap.extraCredits).toEqual(cached.extraCredits);
  });

  it('공식 구조가 없는 옛 판은 캐시 그대로 — 캐시에 표시 목록도 없으면 결과 본문에서 모델별 줄을 집는다', () => {
    const cached = parseCachedUsageUtilization(JSON.stringify(SAMPLE_2_1_317))!;
    expect(assembleProbeSnapshot(usageStream(undefined), cached, NOW)).toEqual(cached);
    const legacy = parseCachedUsageUtilization(SAMPLE)!;
    const snap = assembleProbeSnapshot(usageStream(undefined, 'Current week (all models): 6% used\nCurrent week (Fable): 2% used'), legacy, NOW)!;
    expect(snap.scoped).toEqual([{ label: 'Fable', percent: 2 }]);
    expect(assembleProbeSnapshot('', null, NOW)).toBeNull();
  });
});
