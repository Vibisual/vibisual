import { describe, expect, it } from 'vitest';
import { COMMAND_ACTIVITY_LIMITS, MAX_BASH_HISTORY, mineAutoGoalCandidates } from '@vibisual/shared';
import type { BashEntry } from '@vibisual/shared';
import { bashEntryBytes, boundedBashEntry, trimCommandActivity } from './commandActivityRetention.js';

const row = (id: number, status: BashEntry['status'] = 'success'): BashEntry => ({ id: `r${id}`, command: `echo ${id}`, timestamp: id, status });
describe('bounded command history', () => {
  it('caps entries per session and total session keys', () => {
    const history = new Map<string, BashEntry[]>([['one', Array.from({ length: 100 }, (_, i) => row(i))]]);
    expect(trimCommandActivity(history)).toHaveLength(100 - MAX_BASH_HISTORY);
    for (let i = 0; i < 200; i++) history.set(`s${i}`, [row(100 + i)]);
    trimCommandActivity(history);
    expect(history.size).toBeLessThanOrEqual(COMMAND_ACTIVITY_LIMITS.historySessions);
  });
  it('enforces graph-wide entry and byte budgets, including metadata', () => {
    const history = new Map<string, BashEntry[]>();
    for (let session = 0; session < 20; session++) history.set(`s${session}`, Array.from({ length: 50 }, (_, i) => row(session * 50 + i)));
    trimCommandActivity(history);
    expect([...history.values()].flat()).toHaveLength(COMMAND_ACTIVITY_LIMITS.historyEntries);
    for (const list of history.values()) for (const entry of list) entry.output = 'x'.repeat(16_384);
    trimCommandActivity(history);
    expect([...history.values()].flat().reduce((sum, entry) => sum + bashEntryBytes(entry), 0)).toBeLessThanOrEqual(COMMAND_ACTIVITY_LIMITS.historyBytes);
  });
  it('keeps running calls ahead of completed records when the global budget is full', () => {
    const pending = row(-1, 'running');
    const history = new Map<string, BashEntry[]>([['pending', [pending]]]);
    for (let i = 0; i < 128; i++) history.set(`s${i}`, [row(i)]);
    trimCommandActivity(history);
    expect(history.get('pending')).toEqual([pending]);
    expect(history.has('s0')).toBe(false);
  });
  it('marks clipped text and bounds app metadata without losing identity links', () => {
    const original = { ...row(1), command: 'x'.repeat(20_000), output: 'y'.repeat(20_000),
      apps: [{ id: 'blender', name: 'Blender', executable: 'b'.repeat(5000), detection: 'command' as const }], appNodeIds: ['app-one'] };
    const bounded = boundedBashEntry(original);
    expect(bounded.commandTruncated && bounded.outputTruncated).toBe(true);
    expect(bounded.apps?.[0]?.executable).toHaveLength(COMMAND_ACTIVITY_LIMITS.pathChars);
    expect(bounded.appNodeIds).toEqual(['app-one']);
    expect(original.command).toHaveLength(20_000);
  });
  it('never treats a truncated command prefix as a complete successful procedure', () => {
    const history = [row(1), { ...row(2), commandTruncated: true }, row(3)];
    const result = mineAutoGoalCandidates({ bashHistory: { session: history } });
    expect(result.observed).toBe(2);
    expect(result.candidates).toEqual([]);
  });
});
