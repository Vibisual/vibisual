import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  ORCHESTRA_ANALYSIS_TABLE_HEADER,
  ORCHESTRA_STRATEGIES,
  ORCHESTRA_STRATEGY_IDS,
  findOrchestraStrategy,
  isOrchestraStrategyId,
  orchestraAnalysisMarkdown,
  orchestraStrategyRow,
} from '@vibisual/shared';

/**
 * §5.3 #10-4 — 분석 원문 카탈로그.
 *
 * 사용자 지시는 "지난번에 분석한거 그대로 넣을수 있게"였다. 그래서 원문 전체를 **해시로 고정**한다 —
 * 한 글자라도 고치면 여기서 떨어진다. 원문을 고쳐야 할 일이 생기면 원문은 두고 `apply` 칸을 고친다.
 */

/** 2026-09-16 토큰 감사 답변의 해당 구간(표·합산·실측 넷·우수 사례·바로 바꿀 값·출처). */
const ANALYSIS_SHA256 = 'ada978b7785a71fa1f9586cd221982b6c72e5e43f48433f48019fe36625cf2cf';
const ANALYSIS_LENGTH = 6383;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('orchestraAnalysisMarkdown — 원문 그대로', () => {
  it('빼는 방안이 없으면 원문과 바이트까지 같다', () => {
    const md = orchestraAnalysisMarkdown();
    expect(md).toHaveLength(ANALYSIS_LENGTH);
    expect(sha256(md)).toBe(ANALYSIS_SHA256);
    expect(orchestraAnalysisMarkdown({ exclude: [] })).toBe(md);
  });

  it('표는 머리 다음에 13행이 원문 순서로 온다', () => {
    const lines = orchestraAnalysisMarkdown().split('\n');
    const head = lines.indexOf(ORCHESTRA_ANALYSIS_TABLE_HEADER);
    expect(head).toBeGreaterThanOrEqual(0);
    const rows = lines.slice(head + 2, head + 2 + ORCHESTRA_STRATEGIES.length);
    expect(rows).toEqual(ORCHESTRA_STRATEGIES.map(orchestraStrategyRow));
    expect(lines[head + 2 + ORCHESTRA_STRATEGIES.length]).toBe('');
  });

  it('exclude 는 표에서 그 행만 뺀다 — 나머지 글은 그대로', () => {
    const full = orchestraAnalysisMarkdown();
    const web = findOrchestraStrategy('web');
    const shell = findOrchestraStrategy('shell');
    if (!web || !shell) throw new Error('catalog lost a row');
    const expected = full.replace(`${orchestraStrategyRow(web)}\n`, '').replace(`${orchestraStrategyRow(shell)}\n`, '');
    const md = orchestraAnalysisMarkdown({ exclude: ['web', 'shell'] });
    expect(md).toBe(expected);
    expect(md).not.toContain(orchestraStrategyRow(web));
    expect(md.split('\n')).toHaveLength(full.split('\n').length - 2);
  });

  it('모르는 id 를 빼라고 해도 원문 그대로', () => {
    expect(orchestraAnalysisMarkdown({ exclude: ['nope'] })).toBe(orchestraAnalysisMarkdown());
  });
});

describe('ORCHESTRA_STRATEGIES', () => {
  it('13행, # 는 1..13 차례, id 는 겹치지 않는다', () => {
    expect(ORCHESTRA_STRATEGIES).toHaveLength(13);
    expect(ORCHESTRA_STRATEGIES.map((s) => s.no)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    expect(new Set(ORCHESTRA_STRATEGY_IDS).size).toBe(13);
    expect(ORCHESTRA_STRATEGY_IDS).toEqual(ORCHESTRA_STRATEGIES.map((s) => s.id));
  });

  it('11·12·13 은 참고 전용 — 지휘자가 만질 손잡이가 없다', () => {
    for (const s of ORCHESTRA_STRATEGIES) {
      if (s.no >= 11) {
        expect(s.apply.selectable).toBe(false);
        expect(s.apply.knobs).toEqual([]);
        expect(s.apply.memberRule).toBe('');
        expect(s.apply.topology).toBe('');
      } else {
        expect(s.apply.selectable).toBe(true);
      }
    }
  });

  it('고를 수 있는 방안은 만질 칸이 하나 이상이고 지시문 조항이나 편성 원칙 중 하나는 있다', () => {
    for (const s of ORCHESTRA_STRATEGIES.filter((x) => x.apply.selectable)) {
      expect(s.apply.knobs.length).toBeGreaterThan(0);
      expect(s.apply.memberRule !== '' || s.apply.topology !== '').toBe(true);
    }
  });
});

describe('isOrchestraStrategyId · findOrchestraStrategy', () => {
  it('카탈로그 id 만 참이다 — 객체 원형 키도 거짓', () => {
    expect(isOrchestraStrategyId('subagents')).toBe(true);
    expect(isOrchestraStrategyId('other')).toBe(true);
    expect(isOrchestraStrategyId('toString')).toBe(false);
    expect(isOrchestraStrategyId('')).toBe(false);
    expect(isOrchestraStrategyId(1)).toBe(false);
    expect(isOrchestraStrategyId(null)).toBe(false);
  });

  it('id 로 행을 찾는다', () => {
    expect(findOrchestraStrategy('output')?.no).toBe(2);
    expect(findOrchestraStrategy('constructor')).toBeUndefined();
  });
});
