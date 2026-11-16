import { describe, expect, it } from 'vitest';
import { REVIEW_SCORE_WEIGHTS } from '../constants.js';
import type { MotionFinding } from './motionReview.js';
import { REVIEW_SCORE_CODES, compareFindings, scoreFindings } from './reviewScore.js';

const f = (id: string, code: MotionFinding['code'], level: MotionFinding['level'] = 'warn'): MotionFinding => ({ id, code, level, t: 0, message: id });

describe('§5.13 (G) review score', () => {
  it('score = max(0, 100 - sum(weight x count)) with every code, its count, weight and points shown', () => {
    const s = scoreFindings([f('blank:0', 'blank', 'error'), f('read-time:a:0', 'read-time'), f('read-time:b:1', 'read-time'), f('silence:2', 'silence', 'info')]);
    expect(s.penalty).toBe(REVIEW_SCORE_WEIGHTS.blank + 2 * REVIEW_SCORE_WEIGHTS['read-time'] + REVIEW_SCORE_WEIGHTS.silence);
    expect(s.score).toBe(100 - s.penalty);
    expect(s.counts).toEqual({ error: 1, warn: 2, info: 1 });
    expect(s.byCode.map((c) => c.code)).toEqual(REVIEW_SCORE_CODES);
    expect(s.byCode.find((c) => c.code === 'read-time')).toEqual({ code: 'read-time', count: 2, weight: 2, points: 4 });
    expect(s.byCode.reduce((n, c) => n + c.points, 0)).toBe(s.penalty);
  });

  it('never goes below 0 but the penalty keeps counting', () => {
    const many = Array.from({ length: 15 }, (_, i) => f(`blank:${i}`, 'blank', 'error'));
    expect(scoreFindings(many)).toMatchObject({ score: 0, penalty: 150 });
  });

  it('has a weight for every check, heaviest first', () => {
    for (const code of REVIEW_SCORE_CODES) expect(REVIEW_SCORE_WEIGHTS[code]).toBeGreaterThan(0);
    const weights = REVIEW_SCORE_CODES.map((c) => REVIEW_SCORE_WEIGHTS[c]);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
  });

  it('pairs findings by their stable id: introduced, resolved, kept and the change per code', () => {
    const base = [f('read-time:t1:0', 'read-time'), f('safe-area:t2:Hi', 'safe-area')];
    const target = [f('safe-area:t2:Hi', 'safe-area'), f('text-overlap:t1+t2:a|b', 'text-overlap')];
    const c = compareFindings(target, base);
    expect(c.findings.map((x) => [x.id, x.introduced])).toEqual([['safe-area:t2:Hi', false], ['text-overlap:t1+t2:a|b', true]]);
    expect(c.resolved.map((x) => x.id)).toEqual(['read-time:t1:0']);
    expect(c.delta).toMatchObject({ introduced: 1, resolved: 1, kept: 1 });
    expect(c.delta.penalty).toBe(REVIEW_SCORE_WEIGHTS['text-overlap'] - REVIEW_SCORE_WEIGHTS['read-time']);
    expect(c.delta.score).toBe(-c.delta.penalty);
    expect(c.delta.byCode.find((x) => x.code === 'read-time')).toEqual({ code: 'read-time', before: 1, after: 0, change: -1 });
    expect(c.delta.byCode.find((x) => x.code === 'text-overlap')).toEqual({ code: 'text-overlap', before: 0, after: 1, change: 1 });
  });

  it('gives the same numbers for the same findings', () => {
    const list = [f('blank:0', 'blank', 'error'), f('off-beat:c2', 'off-beat', 'info')];
    expect(scoreFindings(list)).toEqual(scoreFindings([...list]));
    expect(compareFindings(list, [])).toEqual(compareFindings([...list], []));
  });
});
