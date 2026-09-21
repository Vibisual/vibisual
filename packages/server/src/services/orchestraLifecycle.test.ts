import { describe, expect, it, vi } from 'vitest';
import type { OrchestraPlan, OrchestraRun, QueuedCommand } from '@vibisual/shared';
import { ensureOrchestraEntryEdge, ensureOrchestraMemberReturns, orchestraRunForDispatch } from './orchestraDispatch.js';
import { OrchestraResultCollector } from './orchestraResultCollector.js';
import { applyOrchestraPlan, checkOrchestraPlanGraph, settleConductorTurn } from './orchestraRuntime.js';
import { createDispatchJobRegistry, dispatchOutcomeFromCommand } from './taskEdgeDispatchJobs.js';
import type { DispatchJob, DispatchJobRegistry } from './taskEdgeDispatchJobs.js';

vi.mock('./userDefaultsService.js', () => ({ userDefaultsService: { get: () => ({ updatedAt: 1 }), subscribe: () => () => {} } }));
const { ProjectGraphManager } = await import('./projectGraphManager.js');
const { ProjectGraph } = await import('./projectGraph.js');

function job(jobs: DispatchJobRegistry, commandId: string): DispatchJob {
  const lookup = jobs.get(commandId);
  if (!lookup.ok) throw new Error(`Missing dispatch job ${commandId}`);
  return lookup.job;
}

/** Real graph bundles, dispatch ledger, result aggregation and run settlement share one fixture. */
function lifecycle() {
  const graph = new ProjectGraphManager();
  const project = graph.registerProject(process.cwd());
  const conductor = graph.createCustomAgent('conductor', undefined, project.name);
  const entry = graph.createCustomAgent('architect', undefined, project.name);
  const worker = graph.createCustomAgent('coder', undefined, project.name);
  const reviewer = graph.createCustomAgent('verifier', undefined, project.name);
  if (!conductor || !entry || !worker || !reviewer) throw new Error('Fixture agents must belong to the registered project');
  const workerEdge = graph.createTaskEdge(entry.id, worker.id, 'implement', 'manual', null, { returnFormat: 'summary' });
  const reviewEdge = graph.createTaskEdge(reviewer.id, worker.id, 'verify', 'auto', null, { kind: 'critique', critiqueAuthority: 'force-rework' });
  const run: OrchestraRun = {
    runId: 'orc-lifecycle', projectPath: project.path, agentId: conductor.id, commandId: 'conductor-command',
    userRequest: 'Implement and verify the change', engine: 'claude', phase: 'conducting', startedAt: 1000,
    memberAgentIds: [entry.id, worker.id, reviewer.id], inputTokens: 0, outputTokens: 0,
  };
  const plan: OrchestraPlan = { intent: 'feature', topology: 'pipeline', entryAgentId: entry.id, chosen: [] };
  const conductorCommand: QueuedCommand = {
    id: run.commandId, subAgentId: 'conductor-session', text: run.userRequest, timestamp: 1000,
    status: 'executing', orchestraRunId: run.runId,
  };
  expect(checkOrchestraPlanGraph(run, plan, [], Object.values(graph.getTaskEdgesSnapshot()))).toEqual({ ok: true });
  const planned = applyOrchestraPlan(run, plan, [], 1200);
  graph.addOrchestraRun(planned);
  const entryEdge = ensureOrchestraEntryEdge(graph, planned, entry.id);
  ensureOrchestraMemberReturns(graph, planned.memberAgentIds);
  const jobs = createDispatchJobRegistry({ now: () => 2000 });
  jobs.register({ cmdId: 'entry-command', edgeId: entryEdge.id, sourceAgentId: conductor.id,
    targetAgentId: entry.id, requesterSubAgentId: 'conductor-session', expectsResult: true, requestKey: run.runId });
  jobs.markExecuting('entry-command');
  const collector = new OrchestraResultCollector();
  collector.start(run.runId, 'entry-command');
  return { graph, project, conductor, entry, worker, reviewer, workerEdge, reviewEdge, entryEdge,
    run: planned, conductorCommand, jobs, collector };
}

describe('orchestra lifecycle across graph, ledger and completion guards', () => {
  it('returns only the final verified result after rejection, rework, approval and conductor receipt', () => {
    const f = lifecycle();
    expect(f.graph.getBundleArtifact(f.entryEdge.id)?.targetAgentId).toBe(f.conductor.id);
    expect(f.graph.getBundleArtifact(f.workerEdge.id)?.targetAgentId).toBe(f.entry.id);
    const reworkEdge = f.graph.getBundleAutoRework(f.reviewEdge.id);
    expect(reworkEdge).toMatchObject({ sourceAgentId: f.reviewer.id, targetAgentId: f.worker.id, bundleRole: 'auto-rework' });

    const inherited = orchestraRunForDispatch([[f.conductorCommand]], f.conductorCommand.subAgentId ?? undefined);
    expect(inherited).toBe(f.run.runId);
    const entryCommand: QueuedCommand = { ...f.conductorCommand, id: 'entry-command', subAgentId: 'entry-session', edgeId: f.entryEdge.id };
    expect(orchestraRunForDispatch([[entryCommand]], 'entry-session')).toBe(f.run.runId);
    f.jobs.register({ cmdId: 'worker-command', edgeId: f.workerEdge.id, sourceAgentId: f.entry.id,
      targetAgentId: f.worker.id, requesterSubAgentId: 'entry-session', expectsResult: true });
    f.jobs.finish('worker-command', { status: 'completed', result: 'implementation v1' });
    f.jobs.markDelivered('worker-command');
    f.collector.record(f.run.runId, { id: 'worker-command', status: 'completed', result: 'implementation v1' });
    f.collector.record(f.run.runId, { id: 'entry-command', status: 'completed', result: 'Collected worker implementation.' });
    f.collector.expectCritique(f.run.runId, f.reviewEdge.id);
    f.collector.record(f.run.runId, { id: 'review-first', status: 'completed', result: 'Fix the failing test.' },
      { critiqueEdgeId: f.reviewEdge.id, critiqueVerdict: 'reject' });
    expect(f.collector.consumeRework(f.run.runId, f.reviewEdge.id, 3)).toBe(true);
    expect(f.collector.finish(f.run.runId, true)).toBeNull();
    expect(job(f.jobs, 'entry-command').status).toBe('executing');
    expect(f.jobs.listUndelivered({ requesterSubAgentId: 'conductor-session' }).map((entry) => entry.cmdId)).toEqual(['entry-command']);
    expect(f.jobs.listUndelivered({ requesterSubAgentId: 'entry-session' })).toEqual([]);

    f.collector.record(f.run.runId, { id: 'rework-command', status: 'completed', result: 'Fixed implementation.' },
      { reworkAgentId: f.worker.id });
    f.collector.record(f.run.runId, { id: 'review-final', status: 'completed', result: 'All tests pass.' },
      { critiqueEdgeId: f.reviewEdge.id, critiqueVerdict: 'approve', agentId: f.reviewer.id });
    const outcome = f.collector.finish(f.run.runId, false);
    if (!outcome) throw new Error('The finished verification chain must produce a result');
    expect(outcome.status).toBe('completed');
    f.jobs.finish(outcome.commandId, outcome);
    expect(job(f.jobs, 'entry-command').result).toContain('Fixed implementation.');
    expect(job(f.jobs, 'entry-command').result).toContain('All tests pass.');
    expect(job(f.jobs, 'entry-command').result).not.toContain('Fix the failing test.');
    const done: QueuedCommand = { ...f.conductorCommand, status: 'completed', stopReason: 'end_turn' };
    expect(settleConductorTurn(f.run, done, 5000, f.jobs.listForRequester('conductor-session')).phase).toBe('error');
    f.jobs.markDelivered('entry-command');
    const completed = settleConductorTurn(f.run, done, 5000, f.jobs.listForRequester('conductor-session'));
    expect(completed.phase).toBe('completed');
    f.graph.updateOrchestraRun(f.run.runId, () => completed);
    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(f.graph.toProjectCheckpoint(f.project.name));
    expect(restored.findOrchestraRun(f.run.runId)).toEqual(completed);
    expect(restored.getBundleArtifact(f.entryEdge.id)?.targetAgentId).toBe(f.conductor.id);
  });

  it.each(['held', 'missing', 'reviewer-stopped', 'rework-stopped', 'entry-stopped'] as const)
  ('surfaces %s through the collected dispatch result instead of completing the conductor run', (failure) => {
    const f = lifecycle();
    const stopped = dispatchOutcomeFromCommand({ status: 'completed', result: '[Stopped by user]' });
    if (!stopped) throw new Error('A stopped command must have a terminal outcome');
    f.collector.record(f.run.runId, { id: 'entry-command', status: 'completed', result: 'Provisional implementation.',
      ...(failure === 'entry-stopped' ? stopped : {}) });
    f.collector.expectCritique(f.run.runId, f.reviewEdge.id);
    if (failure !== 'missing') {
      f.collector.record(f.run.runId, { id: 'review-command', status: 'completed', result: 'Verification response.',
        ...(failure === 'reviewer-stopped' ? stopped : {}) },
      { critiqueEdgeId: f.reviewEdge.id, critiqueVerdict: failure === 'held' ? 'held' : 'approve' });
    }
    if (failure === 'rework-stopped') f.collector.record(f.run.runId, { id: 'rework-command', ...stopped });
    const outcome = f.collector.finish(f.run.runId, false);
    if (!outcome) throw new Error('A quiet failed chain must terminate, not wait forever');
    expect(outcome.status).toBe('error');
    f.jobs.finish(outcome.commandId, outcome);
    f.jobs.markDelivered(outcome.commandId);
    expect(settleConductorTurn(f.run, { ...f.conductorCommand, status: 'completed' }, 5000,
      f.jobs.listForRequester('conductor-session')).phase).toBe('error');
    expect(f.collector.activeRunIds()).toEqual([]);
  });

  it('preserves provisional collection and one ledger job across request-key retries', () => {
    const f = lifecycle();
    f.collector.expectCritique(f.run.runId, f.reviewEdge.id);
    f.collector.record(f.run.runId, { id: 'entry-command', status: 'completed', result: 'Awaiting review.' });
    expect(f.collector.finish(f.run.runId, true)).toBeNull();
    const retry = f.jobs.register({ cmdId: 'duplicate-command', edgeId: f.entryEdge.id, sourceAgentId: f.conductor.id,
      targetAgentId: f.entry.id, requesterSubAgentId: 'conductor-session', expectsResult: true, requestKey: f.run.runId });
    expect(retry.reused).toBe(true);
    expect(retry.job.cmdId).toBe('entry-command');
    f.collector.start(f.run.runId, retry.job.cmdId);
    f.collector.record(f.run.runId, { id: 'review-command', status: 'completed', result: 'Verified.' },
      { critiqueEdgeId: f.reviewEdge.id, critiqueVerdict: 'approve' });
    const outcome = f.collector.finish(f.run.runId, false);
    expect(outcome).toMatchObject({ commandId: 'entry-command', status: 'completed' });
    expect(outcome?.result).toContain('Awaiting review.');
    expect(f.jobs.size()).toBe(1);
    expect(f.collector.finish(f.run.runId, false)).toBeNull();
  });
});
