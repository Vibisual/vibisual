import { describe, expect, it } from 'vitest';
import type { UsageLimitStop } from '@vibisual/shared';
import { OrchestraResultCollector } from './orchestraResultCollector.js';

function collection(): OrchestraResultCollector {
  const collector = new OrchestraResultCollector();
  collector.start('run', 'entry');
  return collector;
}

describe('OrchestraResultCollector', () => {
  it('keeps rework budgets independent for concurrent runs and critique edges', () => {
    const collector = collection();
    collector.start('second', 'entry-2');
    expect(collector.consumeRework('run', 'shared-review', 2)).toBe(true);
    expect(collector.reworkCount('run', 'shared-review')).toBe(1);
    expect(collector.reworkCount('second', 'shared-review')).toBe(0);
    expect(collector.consumeRework('second', 'shared-review', 2)).toBe(true);
    expect(collector.consumeRework('run', 'other-review', 2)).toBe(true);
    expect(collector.reworkCount('run', 'shared-review')).toBe(1);
    expect(collector.reworkCount('second', 'shared-review')).toBe(1);
    expect(collector.reworkCount('run', 'other-review')).toBe(1);
  });

  it('keeps an exhausted budget exhausted across duplicate start calls', () => {
    const collector = collection();
    expect(collector.consumeRework('run', 'review', 1)).toBe(true);
    collector.start('run', 'entry');
    expect(collector.consumeRework('run', 'review', 1)).toBe(false);
    expect(collector.consumeRework('run', 'review', 1)).toBe(false);
    expect(collector.reworkCount('run', 'review')).toBe(1);
    expect(collector.consumeRework('missing', 'review', 1)).toBe(false);
    expect(collector.consumeRework('run', 'disabled', 0)).toBe(false);
  });

  it('releases rework counters when a run finishes or is cancelled', () => {
    for (const cancelled of [false, true]) {
      const collector = collection();
      collector.consumeRework('run', 'review', 1);
      if (cancelled) collector.cancel('run');
      else {
        collector.record('run', { id: 'entry', status: 'completed' });
        collector.finish('run', false);
      }
      expect(collector.reworkCount('run', 'review')).toBe(0);
      expect(collector.consumeRework('run', 'review', 1)).toBe(false);
      collector.start('run', 'new-entry');
      expect(collector.consumeRework('run', 'review', 1)).toBe(true);
    }
  });

  it('waits for both entry completion and all scheduled member work', () => {
    const collector = collection();
    expect(collector.finish('run', false)).toBeNull();
    collector.record('run', { id: 'entry', status: 'completed', result: 'implementation' });
    expect(collector.finish('run', true)).toBeNull();
    expect(collector.activeRunIds()).toEqual(['run']);
    expect(collector.finish('run', false)).toEqual({ commandId: 'entry', status: 'completed', result: 'implementation' });
    expect(collector.activeRunIds()).toEqual([]);
    expect(collector.finish('run', false)).toBeNull();
  });

  it('keeps retry registration idempotent and isolates concurrent runs', () => {
    const collector = collection();
    collector.record('run', { id: 'entry', status: 'completed', result: 'first result' });
    collector.start('run', 'other-entry');
    collector.start('second', 'second-entry');
    expect(collector.isEntry('run', 'entry')).toBe(true);
    expect(collector.isEntry('run', 'other-entry')).toBe(false);
    expect(collector.finish('run', false)?.result).toBe('first result');
    expect(collector.activeRunIds()).toEqual(['second']);
    collector.record('missing', { id: 'entry', status: 'completed' });
    expect(collector.activeRunIds()).toEqual(['second']);
  });

  it('replaces an intermediate rejection after successful rework with the final approval', () => {
    const collector = collection();
    collector.expectCritique('run', 'review');
    collector.record('run', { id: 'entry', status: 'completed', result: 'implementation' });
    collector.record('run', { id: 'review-1', status: 'completed', result: 'fix naming' }, {
      agentId: 'reviewer', critiqueEdgeId: 'review', critiqueVerdict: 'reject',
    });
    expect(collector.finish('run', true)).toBeNull();
    collector.record('run', { id: 'rework', status: 'completed', result: 'naming fixed' }, { reworkAgentId: 'worker' });
    collector.record('run', { id: 'review-2', status: 'completed', result: 'tests pass' }, {
      agentId: 'reviewer', critiqueEdgeId: 'review', critiqueVerdict: 'approve',
    });
    const result = collector.finish('run', false);
    expect(result?.status).toBe('completed');
    expect(result?.result).toContain('implementation');
    expect(result?.result).toContain('Latest rework (worker):\nnaming fixed');
    expect(result?.result).toContain('Critique review (reviewer): approve\ntests pass');
    expect(result?.result).not.toContain('fix naming');
  });

  it('returns only the latest successful rework per worker before the final critique', () => {
    const collector = collection();
    collector.record('run', { id: 'entry', status: 'completed', result: 'initial output' });
    collector.record('run', { id: 'rework-1', status: 'completed', result: 'first correction' }, { reworkAgentId: 'worker' });
    collector.record('run', { id: 'rework-2', status: 'completed', result: 'final correction' }, { reworkAgentId: 'worker' });
    collector.record('run', { id: 'other-rework', status: 'completed', result: 'other worker correction' }, { reworkAgentId: 'other' });
    collector.record('run', { id: 'review', status: 'completed', result: 'verified final correction' }, {
      critiqueEdgeId: 'review-edge', critiqueVerdict: 'approve',
    });
    const result = collector.finish('run', false);
    expect(result?.status).toBe('completed');
    expect(result?.result).toContain('initial output');
    expect(result?.result).not.toContain('first correction');
    expect(result?.result).toContain('Latest rework (worker):\nfinal correction');
    expect(result?.result).toContain('Latest rework (other):\nother worker correction');
    expect(result!.result.indexOf('final correction')).toBeLessThan(result!.result.indexOf('Critique review-edge'));
  });

  it.each(['reject', 'held'] as const)('returns final %s as failure even when the command status is completed', (verdict) => {
    const collector = collection();
    collector.record('run', { id: 'entry', status: 'completed' });
    collector.record('run', { id: 'review', status: 'completed', result: 'report' }, {
      critiqueEdgeId: 'review-edge', critiqueVerdict: verdict,
    });
    expect(collector.finish('run', false)).toMatchObject({ status: 'error', errorMessage: `Critique review-edge: ${verdict}.` });
  });

  it('fails a watcher that was expected but never started instead of waiting forever', () => {
    const collector = collection();
    collector.expectCritique('run', 'review-edge');
    collector.record('run', { id: 'entry', status: 'completed' });
    expect(collector.finish('run', false)).toMatchObject({
      status: 'error', errorMessage: 'Missing critique report for edge review-edge.',
    });
    expect(collector.activeRunIds()).toEqual([]);
  });

  it('requires approval from every expected critique edge', () => {
    const collector = collection();
    collector.record('run', { id: 'entry', status: 'completed' });
    collector.expectCritique('run', 'security');
    collector.expectCritique('run', 'tests');
    collector.record('run', { id: 'review', status: 'completed' }, { critiqueEdgeId: 'security', critiqueVerdict: 'approve' });
    expect(collector.finish('run', false)?.errorMessage).toContain('Missing critique report for edge tests.');
  });

  it('does not reuse an old approval when a newly expected review never reports', () => {
    const collector = collection();
    collector.record('run', { id: 'entry', status: 'completed', result: 'implementation' });
    collector.expectCritique('run', 'review-edge');
    collector.record('run', { id: 'review-first', status: 'completed', result: 'Old implementation approved.' },
      { critiqueEdgeId: 'review-edge', critiqueVerdict: 'approve' });
    collector.expectCritique('run', 'review-edge');
    const result = collector.finish('run', false);
    expect(result).toMatchObject({ status: 'error', errorMessage: 'Missing critique report for edge review-edge.' });
    expect(result?.result).not.toContain('Old implementation approved.');
  });

  it('completes after the newly expected review supplies its own approval', () => {
    const collector = collection();
    collector.record('run', { id: 'entry', status: 'completed', result: 'implementation' });
    collector.expectCritique('run', 'review-edge');
    collector.record('run', { id: 'review-first', status: 'completed', result: 'Old implementation approved.' },
      { critiqueEdgeId: 'review-edge', critiqueVerdict: 'approve' });
    collector.expectCritique('run', 'review-edge');
    expect(collector.finish('run', true)).toBeNull();
    collector.record('run', { id: 'review-second', status: 'completed', result: 'Current implementation approved.' },
      { critiqueEdgeId: 'review-edge', critiqueVerdict: 'approve' });
    const result = collector.finish('run', false);
    expect(result?.status).toBe('completed');
    expect(result?.result).toContain('Current implementation approved.');
    expect(result?.result).not.toContain('Old implementation approved.');
  });

  it.each(['error', 'cancelled'] as const)('preserves member %s even when later reviews approve', (status) => {
    const collector = collection();
    collector.record('run', { id: 'entry', status: 'completed', result: 'implementation' });
    collector.record('run', { id: 'rework', status, errorMessage: 'member stopped', result: 'incomplete changes' });
    collector.record('run', { id: 'review', status: 'completed' }, { critiqueEdgeId: 'review-edge', critiqueVerdict: 'approve' });
    const result = collector.finish('run', false);
    expect(result).toMatchObject({ status: 'error', errorMessage: 'member stopped' });
    expect(result?.result).toContain('incomplete changes');
  });

  it('does not treat a usage-limited member or watcher as success', () => {
    const usageLimit: UsageLimitStop = { kind: 'session', at: 1 };
    for (const critique of [false, true]) {
      const collector = collection();
      collector.record('run', { id: 'entry', status: 'completed' });
      collector.record('run', { id: 'limited', status: 'completed', usageLimit },
        critique ? { critiqueEdgeId: 'review-edge', critiqueVerdict: 'approve' } : {});
      expect(collector.finish('run', false)).toMatchObject({ status: 'error', usageLimit });
    }
  });

  it('rejects failed watcher output and missing parsed verdicts', () => {
    for (const status of ['error', 'completed'] as const) {
      const collector = collection();
      collector.record('run', { id: 'entry', status: 'completed' });
      collector.record('run', { id: 'review', status, result: 'ambiguous report' }, { critiqueEdgeId: 'review-edge' });
      expect(collector.finish('run', false)?.status).toBe('error');
    }
  });

  it('releases a cancelled run and ignores late callbacks', () => {
    const collector = collection();
    expect(collector.entryCommandId('run')).toBe('entry');
    expect(collector.cancel('run')).toBe('entry');
    expect(collector.cancel('run')).toBeUndefined();
    expect(collector.entryCommandId('run')).toBeUndefined();
    collector.record('run', { id: 'entry', status: 'completed', result: 'late' });
    collector.expectCritique('run', 'review');
    expect(collector.isEntry('run', 'entry')).toBe(false);
    expect(collector.finish('run', false)).toBeNull();
    expect(collector.activeRunIds()).toEqual([]);
  });
});
