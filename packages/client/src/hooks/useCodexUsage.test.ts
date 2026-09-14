import { describe, expect, it } from 'vitest';
import type { ProviderUsage } from '@vibisual/shared';
import { reconcileCodexUsage } from './useCodexUsage.js';

const previous: ProviderUsage = {
  windows: [{ id: 'codex:primary', label: 'Codex', usedPercent: 42, resetsAt: 1000 }],
  fetchedAt: 100,
};

describe('Codex usage refresh stability', () => {
  it('keeps the measured values and actual measurement time when a refresh fails', () => {
    const failed = reconcileCodexUsage(previous, { windows: [], fetchedAt: 200, error: 'unavailable' });
    expect(failed).toEqual({ ...previous, error: 'unavailable' });
    expect(reconcileCodexUsage(failed, { windows: [], fetchedAt: 300, error: 'unavailable' })).toEqual(failed);
    expect(previous.error).toBeUndefined();
  });

  it('accepts a real reset to zero and clears the previous error on recovery', () => {
    const incoming = { windows: [{ ...previous.windows[0]!, usedPercent: 0, resetsAt: 2000 }], fetchedAt: 400 };
    expect(reconcileCodexUsage({ ...previous, error: 'unavailable' }, incoming)).toEqual(incoming);
  });

  it('does not invent measurements on initial failure', () => {
    const failed = { windows: [], fetchedAt: 200, error: 'unavailable' };
    expect(reconcileCodexUsage(null, failed)).toEqual(failed);
  });

  it('keeps row order stable when RPC buckets arrive in a different order without mutating the input', () => {
    const windows = ['z:secondary', 'codex:secondary', 'z:primary', 'codex:primary']
      .map(id => ({ id, label: id, usedPercent: 10 }));
    const first = reconcileCodexUsage(null, { windows, fetchedAt: 100 });
    const second = reconcileCodexUsage(first, { windows: [...windows].reverse(), fetchedAt: 200 });
    expect(first.windows.map(w => w.id)).toEqual(['codex:primary', 'codex:secondary', 'z:primary', 'z:secondary']);
    expect(second.windows).toEqual(first.windows);
    expect(windows[0]!.id).toBe('z:secondary');
  });
});
