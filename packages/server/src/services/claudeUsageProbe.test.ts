import { describe, it, expect } from 'vitest';
import {
  claudeConfigJsonPaths,
  parseCachedUsageUtilization,
  parseScopedWeeklyRows,
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
