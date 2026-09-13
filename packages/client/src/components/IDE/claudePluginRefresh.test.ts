/**
 * §5.5 #17-33 ⑦ — 갱신 판정 테스트.
 *
 * 이 판정이 틀리면 두 방향으로 조용히 망가진다:
 *  - 너무 물러서 판정 → 마켓 클론이 다시 몇 주씩 멈춘다(실측 36일이 그 상태였다).
 *  - 너무 세게 판정 → 매 주기마다 같은 것을 끝없이 다시 올려 사용자 회선과 CLI 를 축낸다.
 *
 * 화면 배지("새 판 N개")와 자동 갱신이 **같은 함수**를 읽으므로, 여기가 틀리면 적어 둔 수와
 * 실제로 올라가는 것이 어긋난다. 그래서 스폰이 아니라 순수 함수 자리에서 못 박는다.
 */
import { describe, expect, it } from 'vitest';

import {
  CLAUDE_PLUGIN_REFRESH_DEFAULTS,
  CLAUDE_PLUGIN_REFRESH_MAX_INTERVAL_HOURS,
  CLAUDE_PLUGIN_REFRESH_MIN_INTERVAL_HOURS,
  annotatePluginUpdates,
  comparePluginVersions,
  isPluginRefreshDue,
  normalizePluginRefreshSettings,
  pluginsNeedingUpdate,
  type ClaudeMarketPlugin,
  type ClaudePluginEntry,
} from '@vibisual/shared';

const HOUR = 60 * 60 * 1000;

/** 설치본 한 줄 — 판 비교에 안 쓰이는 칸은 기본값으로 채운다. */
function installed(over: Partial<ClaudePluginEntry> & { id: string; version: string }): ClaudePluginEntry {
  return {
    name: over.id.split('@')[0] ?? over.id,
    marketplace: over.id.split('@')[1] ?? '',
    scope: 'user',
    placement: 'global',
    enabled: true,
    ...over,
  };
}

/** 마켓 한 줄. */
function market(id: string, version?: string): ClaudeMarketPlugin {
  return { id, name: id.split('@')[0] ?? id, marketplace: id.split('@')[1] ?? '', installed: true, ...(version ? { version } : {}) };
}

describe('comparePluginVersions', () => {
  it('숫자 마디를 앞에서부터 견준다', () => {
    expect(comparePluginVersions('1.2.3', '1.2.4')).toBe(-1);
    expect(comparePluginVersions('1.3.0', '1.2.9')).toBe(1);
    expect(comparePluginVersions('2.0.0', '2.0.0')).toBe(0);
  });

  it('마디 수가 달라도 없는 쪽을 0 으로 본다', () => {
    expect(comparePluginVersions('1.2', '1.2.1')).toBe(-1);
    expect(comparePluginVersions('1.2.0', '1.2')).toBe(0);
  });

  it('접두 v · 날짜 판도 숫자만 뽑아 견준다', () => {
    expect(comparePluginVersions('v1.0.0', '1.0.1')).toBe(-1);
    expect(comparePluginVersions('2026.09.01', '2026.08.04')).toBe(1);
  });

  it('두 자리 마디를 문자열로 견주지 않는다 (10 > 9)', () => {
    // 문자열 비교였다면 '1.10.0' < '1.9.0' 으로 뒤집혀 영영 안 올라간다.
    expect(comparePluginVersions('1.10.0', '1.9.0')).toBe(1);
  });

  it('숫자가 없는 판은 비교하지 않는다(null)', () => {
    expect(comparePluginVersions('unknown', '1.0.0')).toBeNull();
    expect(comparePluginVersions('1.0.0', 'unknown')).toBeNull();
    expect(comparePluginVersions('', '')).toBeNull();
  });
});

describe('pluginsNeedingUpdate', () => {
  it('마켓 판이 더 높은 것만 고른다', () => {
    const out = pluginsNeedingUpdate(
      [installed({ id: 'a@mp', version: '1.0.0' }), installed({ id: 'b@mp', version: '2.0.0' })],
      [market('a@mp', '1.1.0'), market('b@mp', '2.0.0')],
    );
    expect(out.map((p) => p.id)).toEqual(['a@mp']);
    expect(out[0]?.latestVersion).toBe('1.1.0');
    expect(out[0]?.updateAvailable).toBe(true);
  });

  it('마켓에 없는 설치본은 올릴 대상이 아니다', () => {
    expect(pluginsNeedingUpdate([installed({ id: 'gone@mp', version: '0.1.0' })], [])).toEqual([]);
  });

  it('판을 견줄 수 없으면 건너뛴다 — 매 주기 헛도는 것을 막는다', () => {
    const out = pluginsNeedingUpdate(
      [installed({ id: 'x@mp', version: 'unknown' })],
      [market('x@mp', '3.0.0')],
    );
    expect(out).toEqual([]);
  });

  it('마켓이 판을 안 밝히면 건너뛴다', () => {
    expect(pluginsNeedingUpdate([installed({ id: 'x@mp', version: '1.0.0' })], [market('x@mp')])).toEqual([]);
  });

  it('다른 프로젝트에 매인 것은 여기서 올리지 않는다', () => {
    const out = pluginsNeedingUpdate(
      [installed({ id: 'z@mp', version: '1.0.0', placement: 'other-project', scope: 'project' })],
      [market('z@mp', '9.9.9')],
    );
    expect(out).toEqual([]);
  });

  it('꺼져 있어도 깔려 있으면 올린다 — 켜는 순간 최신이어야 한다', () => {
    const out = pluginsNeedingUpdate(
      [installed({ id: 'off@mp', version: '1.0.0', enabled: false })],
      [market('off@mp', '1.2.0')],
    );
    expect(out.map((p) => p.id)).toEqual(['off@mp']);
  });
});

describe('annotatePluginUpdates', () => {
  it('원본을 건드리지 않고 표식만 새긴다', () => {
    const src = [installed({ id: 'a@mp', version: '1.0.0' }), installed({ id: 'b@mp', version: '5.0.0' })];
    const out = annotatePluginUpdates(src, [market('a@mp', '1.1.0'), market('b@mp', '5.0.0')]);
    expect(out[0]?.updateAvailable).toBe(true);
    expect(out[0]?.latestVersion).toBe('1.1.0');
    expect(out[1]?.updateAvailable).toBeUndefined();
    expect(src[0]?.updateAvailable).toBeUndefined();
  });

  it('세는 수와 고르는 대상이 같다 — 배지와 실제가 어긋나지 않는다', () => {
    const inst = [
      installed({ id: 'a@mp', version: '1.0.0' }),
      installed({ id: 'b@mp', version: '1.0.0' }),
      installed({ id: 'c@mp', version: 'unknown' }),
    ];
    const mk = [market('a@mp', '2.0.0'), market('b@mp', '1.0.0'), market('c@mp', '2.0.0')];
    expect(annotatePluginUpdates(inst, mk).filter((p) => p.updateAvailable).length)
      .toBe(pluginsNeedingUpdate(inst, mk).length);
  });
});

describe('normalizePluginRefreshSettings', () => {
  it('없으면 기본값 — 기본은 둘 다 켬', () => {
    expect(normalizePluginRefreshSettings(undefined)).toEqual(CLAUDE_PLUGIN_REFRESH_DEFAULTS);
    expect(normalizePluginRefreshSettings(null)).toEqual(CLAUDE_PLUGIN_REFRESH_DEFAULTS);
  });

  it('끈 값은 그대로 지킨다 — 껐는데 되살아나면 그게 가장 나쁘다', () => {
    const s = normalizePluginRefreshSettings({ market: false, plugins: false, intervalHours: 12 });
    expect(s).toEqual({ market: false, plugins: false, intervalHours: 12 });
  });

  it('주기는 하한·상한으로 죈다', () => {
    expect(normalizePluginRefreshSettings({ intervalHours: 0 }).intervalHours)
      .toBe(CLAUDE_PLUGIN_REFRESH_MIN_INTERVAL_HOURS);
    expect(normalizePluginRefreshSettings({ intervalHours: 99999 }).intervalHours)
      .toBe(CLAUDE_PLUGIN_REFRESH_MAX_INTERVAL_HOURS);
    expect(normalizePluginRefreshSettings({ intervalHours: Number.NaN }).intervalHours)
      .toBe(CLAUDE_PLUGIN_REFRESH_DEFAULTS.intervalHours);
  });

  it('엉뚱한 타입이 와도 기본값으로 접는다', () => {
    expect(normalizePluginRefreshSettings({ market: 'yes', plugins: 1, intervalHours: '6' }))
      .toEqual(CLAUDE_PLUGIN_REFRESH_DEFAULTS);
  });
});

describe('isPluginRefreshDue', () => {
  const s = normalizePluginRefreshSettings({ intervalHours: 24 });
  const now = 1_800_000_000_000;

  it('한 번도 안 했으면 항상 지금이다 — 36일 멈춰 있던 것이 이 상태였다', () => {
    expect(isPluginRefreshDue(now, undefined, s)).toBe(true);
    expect(isPluginRefreshDue(now, 0, s)).toBe(true);
  });

  it('주기가 안 찼으면 안 한다', () => {
    expect(isPluginRefreshDue(now, now - 23 * HOUR, s)).toBe(false);
  });

  it('주기가 정확히 찼으면 한다', () => {
    expect(isPluginRefreshDue(now, now - 24 * HOUR, s)).toBe(true);
  });

  it('시계가 뒤로 가 미래 시각이 찍혀 있어도 한다 — 안 그러면 그 컴퓨터는 영영 안 돈다', () => {
    expect(isPluginRefreshDue(now, now + 100 * HOUR, s)).toBe(true);
  });

  it('주기를 바꾸면 판정도 따라간다', () => {
    const hourly = normalizePluginRefreshSettings({ intervalHours: 1 });
    expect(isPluginRefreshDue(now, now - 2 * HOUR, hourly)).toBe(true);
    expect(isPluginRefreshDue(now, now - 30 * 60 * 1000, hourly)).toBe(false);
  });
});
