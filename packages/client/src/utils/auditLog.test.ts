import { describe, expect, it } from 'vitest';
import type { AuditEntry, ProjectAuditLog } from '@vibisual/shared';
import { AUDIT_RISK_KINDS } from '@vibisual/shared';
import {
  decisionToneClass,
  findAuditLog,
  formatAuditTime,
  matchesAuditFilter,
  riskLabelKey,
  riskToneClass,
} from './auditLog.js';

// SCENARIO.md §5.22 / §7.20 — 감사 화면 헬퍼의 회귀 테스트.
//
// 이 파일이 지키는 약속은 둘이다. ① **세 화면이 같은 색·같은 라벨**을 쓴다(헤더 필·타임라인·
// 승인 카드가 어긋나면 그 즉시 못 믿는 화면이 된다), ② **여기서 판정을 다시 하지 않는다** —
// 필터는 서버가 준 줄을 고르기만 하고 위험을 새로 매기지 않는다.

function entry(partial: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'audit-1',
    at: Date.now(),
    projectName: 'demo',
    sessionId: 'sess-1',
    toolName: 'Bash',
    summary: 'rm -rf build',
    riskKinds: [],
    ...partial,
  };
}

function log(partial: Partial<ProjectAuditLog> = {}): ProjectAuditLog {
  return {
    projectName: 'demo',
    entries: [],
    boundary: { escalateRisky: true, kinds: {} },
    counts: { total: 0, risky: 0, denied: 0, escalated: 0, todayRisky: 0 },
    updatedAt: 0,
    ...partial,
  };
}

describe('findAuditLog', () => {
  it('보고 있는 프로젝트의 원장만 돌려주고 없으면 지어내지 않는다', () => {
    const logs = [log({ projectName: 'a' }), log({ projectName: 'b' })];
    expect(findAuditLog(logs, 'b')?.projectName).toBe('b');
    expect(findAuditLog(logs, 'c')).toBeUndefined();
    expect(findAuditLog(logs, null)).toBeUndefined();
  });
});

describe('필터 — 고르기만 하고 판정하지 않는다', () => {
  const plain = entry({ id: 'plain' });
  const risky = entry({ id: 'risky', riskKinds: ['delete'] });
  const denied = entry({ id: 'denied', riskKinds: ['network'], decision: 'deny' });
  const allowed = entry({ id: 'allowed', riskKinds: ['config'], decision: 'allow' });

  it('전체는 전부, 위험은 위험만, 거부는 거부만', () => {
    const all = [plain, risky, denied, allowed];
    expect(all.filter((e) => matchesAuditFilter(e, 'all'))).toHaveLength(4);
    expect(all.filter((e) => matchesAuditFilter(e, 'risky')).map((e) => e.id)).toEqual(['risky', 'denied', 'allowed']);
    expect(all.filter((e) => matchesAuditFilter(e, 'denied')).map((e) => e.id)).toEqual(['denied']);
  });

  it('결정이 없는 줄은 거부 탭에 오지 않는다(묻지 않은 것 ≠ 허용/거부)', () => {
    expect(matchesAuditFilter(plain, 'denied')).toBe(false);
    expect(matchesAuditFilter(allowed, 'denied')).toBe(false);
  });
});

describe('색과 라벨 — 세 화면이 같은 값을 본다', () => {
  it('위험 3종이 서로 다른 색을 갖는다', () => {
    const tones = AUDIT_RISK_KINDS.map((k) => riskToneClass(k));
    expect(new Set(tones).size).toBe(AUDIT_RISK_KINDS.length);
  });

  it('라벨 키는 위험 종류에서 그대로 파생된다(컴포넌트마다 새로 적지 않는다)', () => {
    expect(AUDIT_RISK_KINDS.map((k) => riskLabelKey(k))).toEqual([
      'panel.audit.risk.delete',
      'panel.audit.risk.network',
      'panel.audit.risk.config',
    ]);
  });

  it('허용과 거부는 눈에 띄게 다른 색이다', () => {
    expect(decisionToneClass('allow')).not.toBe(decisionToneClass('deny'));
    expect(decisionToneClass('deny')).toContain('red');
  });
});

describe('시각 표기', () => {
  it('오늘 것은 시:분:초, 지난 날짜는 날짜까지 적는다', () => {
    const now = new Date(2026, 7, 20, 15, 4, 5).getTime();
    expect(formatAuditTime(now, now)).toBe('15:04:05');
    const yesterday = new Date(2026, 7, 19, 9, 7, 0).getTime();
    expect(formatAuditTime(yesterday, now)).toBe('08-19 09:07');
  });
});
