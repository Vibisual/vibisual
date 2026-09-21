import { describe, expect, it } from 'vitest';
import type { VerificationRun } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';

function checkpoint(status: VerificationRun['status'], automated: boolean) {
  const graph = new ProjectGraph();
  const projectName = graph.registerProject(process.cwd()).name;
  const agent = graph.createCustomAgent('Verifier', undefined, projectName);
  const run: VerificationRun = {
    id: 'ver-merge-fixture', agentId: agent.id, subAgentId: 'sub-merge-fixture', projectName,
    status, verdict: status === 'done' ? 'pass' : 'unknown', recipeSource: 'none',
    startedAt: 123, pendingCommandId: status === 'done' ? undefined : 'cmd-from-closed-process',
    attempts: [{ kind: 'run', command: 'test-fixture', exitCode: 0 }], reason: 'Retained historical explanation.',
    ...(automated ? { target: { kind: 'browser' as const, url: 'http://localhost:9000/' },
      requiredSteps: 1, procedure: [{ atMs: 0, text: 'Click save', action: { kind: 'click' as const, selector: '#save' } }],
      evidence: [{ id: 'image-1', rel: 'ver-merge-fixture/image-1.png', sha256: 'fixture-hash', width: 1280, height: 720, capturedAt: 124 }],
    } : {}),
  };
  graph.addVerificationRun(run);
  return { run, cp: graph.toProjectCheckpoint(projectName) };
}

describe('verification history loaded by checkpoint merge', () => {
  it.each([
    ['running', true], ['queued', true], ['running', false], ['queued', false],
  ] as const)('releases a stale %s reservation (automated=%s) while retaining its evidence', (status, automated) => {
    const { cp, run } = checkpoint(status, automated);
    const merged = new ProjectGraph();
    merged.mergeFromCheckpoint(cp);
    const restored = merged.getVerificationRuns(run.subAgentId)[0]!;
    expect(restored.status).toBe('stopped');
    expect(restored.verdict).toBe('unknown');
    expect(restored.pendingCommandId).toBeUndefined();
    expect(restored.reason).toBe(run.reason);
    expect(restored.evidence).toEqual(run.evidence);
    expect(restored.procedure).toEqual(run.procedure);
    expect(merged.getActiveVerificationRun(run.subAgentId)).toBeUndefined();
    // The same session can now accept a fresh run instead of reporting already-running forever.
    merged.addVerificationRun({ ...run, id: 'ver-new-process', status: 'running', pendingCommandId: 'cmd-new-process' });
    expect(merged.getActiveVerificationRun(run.subAgentId)?.id).toBe('ver-new-process');
  });

  it('keeps the verdict and attempts of completed legacy history', () => {
    const { cp, run } = checkpoint('done', false);
    const merged = new ProjectGraph();
    merged.mergeFromCheckpoint(cp);
    expect(merged.getVerificationRuns(run.subAgentId)[0]).toMatchObject({
      id: run.id, status: 'done', verdict: 'pass', reason: run.reason, attempts: run.attempts,
    });
    expect(merged.getVerificationRuns(run.subAgentId)[0]?.target).toBeUndefined();
  });

  it('preserves a live in-memory tab and its active command when the same disk tab is merged', () => {
    const { cp, run } = checkpoint('running', true);
    const merged = new ProjectGraph();
    const live = { ...run, id: 'ver-live', pendingCommandId: 'cmd-live', reason: 'The current live process owns this run.' };
    merged.addVerificationRun(live);
    merged.mergeFromCheckpoint(cp);
    expect(merged.getVerificationRuns(run.subAgentId)).toHaveLength(1);
    expect(merged.getActiveVerificationRun(run.subAgentId)).toMatchObject({ id: live.id, status: 'running', pendingCommandId: 'cmd-live', reason: live.reason });
  });
});
