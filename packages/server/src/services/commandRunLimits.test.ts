import { describe, expect, it } from 'vitest';
import { CREATION_QUALITY_LIMITS } from '@vibisual/shared';
import { RUN_LIMIT_BOUNDS, effectiveMaxTurns, normalizeRunLimits, runLimitMs } from './commandRunLimits.js';

/** §5.13 (R-10) — "quick draft / refine" are real per-command limits, not prompt wording. */
describe('command run limits', () => {
  it('accepts only bounded whole turns and finite minutes', () => {
    expect(normalizeRunLimits({ maxTurns: 24, maxMinutes: 10 })).toEqual({ maxTurns: 24, maxMinutes: 10 });
    expect(normalizeRunLimits({ maxTurns: 2.5, maxMinutes: Infinity })).toBeUndefined();
    expect(normalizeRunLimits({ maxTurns: RUN_LIMIT_BOUNDS.maxTurns.max + 1, maxMinutes: 0 })).toBeUndefined();
    expect(normalizeRunLimits({ maxMinutes: 40, extra: 'ignored' })).toEqual({ maxMinutes: 40 });
    expect(normalizeRunLimits('24')).toBeUndefined();
    expect(normalizeRunLimits(null)).toBeUndefined();
  });
  it('the tighter turn cap wins; no cap on either side means none', () => {
    expect(effectiveMaxTurns(0, { maxTurns: 24 })).toBe(24);
    expect(effectiveMaxTurns(10, { maxTurns: 24 })).toBe(10);
    expect(effectiveMaxTurns(50, { maxTurns: 24 })).toBe(24);
    expect(effectiveMaxTurns(0, undefined)).toBe(0);
    expect(effectiveMaxTurns(12, {})).toBe(12);
  });
  it('time limits apply to every engine in milliseconds', () => {
    expect(runLimitMs({ maxMinutes: 10 })).toBe(600_000);
    expect(runLimitMs({ maxTurns: 5 })).toBeNull();
    expect(runLimitMs(undefined)).toBeNull();
  });
  it('the two stages the creation apps send are within bounds', () => {
    for (const limits of Object.values(CREATION_QUALITY_LIMITS)) expect(normalizeRunLimits(limits)).toEqual(limits);
    // A missing refine cap compares against 0 and fails — both stages must carry a turn cap.
    expect(CREATION_QUALITY_LIMITS.draft.maxTurns).toBeLessThan(CREATION_QUALITY_LIMITS.refine.maxTurns ?? 0);
  });
});
