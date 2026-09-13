import { describe, expect, it } from 'vitest';
import { parseCodexUsage } from './codexUsageService.js';
describe('Codex account limits', () => {
  it('prefers multiple buckets, preserves zero and converts seconds to milliseconds', () => {
    const result = parseCodexUsage({ rateLimits: { primary: { usedPercent: 99 } }, rateLimitsByLimitId: {
      codex: { primary: { usedPercent: 0, resetsAt: 123, windowDurationMins: 300 }, secondary: { usedPercent: 47, windowDurationMins: 10080 } },
      review: { primary: { usedPercent: 22 } },
    } }, 10);
    expect(result.windows).toHaveLength(3);
    expect(result.windows[0]).toEqual({ id: 'codex:primary', label: 'codex', usedPercent: 0, resetsAt: 123000, windowDurationMins: 300 });
    expect(result.fetchedAt).toBe(10);
  });
  it('supports legacy responses without manufacturing missing limits', () => {
    expect(parseCodexUsage({ rateLimits: { primary: { usedPercent: 20 }, secondary: null } }).windows).toHaveLength(1);
    for (const data of [null, {}, { rateLimits: { primary: { usedPercent: null } } }]) {
      expect(parseCodexUsage(data).windows).toEqual([]);
      expect(parseCodexUsage(data).error).toBe('unavailable');
    }
  });
});
