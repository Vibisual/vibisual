import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { QueuedCommand } from '@vibisual/shared';
import { ensureOrchestraEntryEdge, ensureOrchestraMemberReturns, orchestraCritiqueFirings, orchestraRunForDispatch } from './orchestraDispatch.js';
import { resolveEdgeCommandMode } from './taskEdgeDelegation.js';
import { createDispatchJobRegistry } from './taskEdgeDispatchJobs.js';
vi.mock('./userDefaultsService.js', () => ({ userDefaultsService: { get: () => ({ updatedAt: 1 }), subscribe: () => () => {} } }));
vi.mock('./appState.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./appState.js')>(), appStateAddOpenProject: () => false,
}));
const { ProjectGraph } = await import('./projectGraph.js');
const { ProjectGraphManager } = await import('./projectGraphManager.js');
const fixtureDirs: string[] = [];
function fixtureProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vibi-orchestra-'));
  fixtureDirs.push(dir);
  return dir;
}
afterEach(() => { for (const dir of fixtureDirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('orchestra dispatch round trip', () => {
  it('creates real conductor and return edges, reuses them, and persists both through a checkpoint', () => {
    const graph = new ProjectGraphManager();
    const project = graph.registerProject(fixtureProject());
    const conductor = graph.createCustomAgent('conductor', undefined, project.name);
    const worker = graph.createCustomAgent('worker', undefined, project.name);
    if (!conductor || !worker) throw new Error('fixture agents were not created');
    const run = { agentId: conductor.id };
    const edge = ensureOrchestraEntryEdge(graph, run, worker.id);
    expect(edge).toMatchObject({ sourceAgentId: conductor.id, targetAgentId: worker.id, returnFormat: 'both', forwardMode: 'manual' });
    expect(graph.getBundleArtifact(edge.id)).toMatchObject({ sourceAgentId: worker.id, targetAgentId: conductor.id });
    expect(ensureOrchestraEntryEdge(graph, run, worker.id).id).toBe(edge.id);
    expect(Object.keys(graph.getTaskEdgesSnapshot())).toHaveLength(2);
    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(graph.toProjectCheckpoint(project.name));
    expect(restored.getTaskEdge(edge.id)).toMatchObject({ sourceAgentId: conductor.id, targetAgentId: worker.id });
    expect(restored.getBundleArtifact(edge.id)?.targetAgentId).toBe(conductor.id);
  });

  it('repairs return paths only for participating primary member command edges', () => {
    const graph = new ProjectGraphManager();
    graph.registerProject(fixtureProject());
    const command = graph.createTaskEdge('a', 'b', 'implement', 'manual', null, { returnFormat: 'summary' });
    const unrelated = graph.createTaskEdge('a', 'outside', 'other work', 'manual', null, { returnFormat: 'summary' });
    const critique = graph.createTaskEdge('reviewer', 'b', 'verify', 'auto', null, { kind: 'critique' });
    ensureOrchestraMemberReturns(graph, ['a', 'b', 'reviewer']);
    expect(graph.getBundleArtifact(command.id)?.targetAgentId).toBe('a');
    expect(unrelated.returnFormat).toBe('summary');
    expect(critique.returnFormat).toBeUndefined();
  });

  it('propagates the calling session run instead of another concurrent run sharing members', () => {
    const command = (id: string, subAgentId: string, orchestraRunId?: string): QueuedCommand =>
      ({ id, subAgentId, orchestraRunId, timestamp: 1, text: 'work', status: 'executing' });
    const queues = [[command('one', 'sub1', 'run1')], [command('two', 'sub2', 'run2')], [command('normal', 'sub3')]];
    expect(orchestraRunForDispatch(queues, 'sub1')).toBe('run1');
    expect(orchestraRunForDispatch(queues, 'sub2')).toBe('run2');
    expect(orchestraRunForDispatch(queues, 'sub3')).toBeUndefined();
    expect(orchestraRunForDispatch(queues, undefined)).toBeUndefined();
  });

  it('keeps collected evidence isolated to its requesting session without exposing mutable ledger data', () => {
    const jobs = createDispatchJobRegistry();
    const base = { edgeId: 'edge', sourceAgentId: 'conductor', targetAgentId: 'worker', expectsResult: true };
    jobs.register({ ...base, cmdId: 'one', requesterSubAgentId: 'sub1' });
    jobs.register({ ...base, cmdId: 'two', requesterSubAgentId: 'sub2' });
    jobs.finish('one', { status: 'completed', result: 'done' });
    jobs.markDelivered('one');
    const evidence = jobs.listForRequester('sub1');
    expect(evidence.map((job) => job.cmdId)).toEqual(['one']);
    expect(evidence[0]?.deliveredAt).toBeTypeOf('number');
    evidence[0]!.status = 'error';
    expect(jobs.listForRequester('sub1')[0]?.status).toBe('completed');
  });

  it('stamps the shared command mode so conducting turns keep their own tools', () => {
    const graph = new ProjectGraphManager();
    const project = graph.registerProject(fixtureProject());
    const conductor = graph.createCustomAgent('conductor', undefined, project.name);
    const worker = graph.createCustomAgent('worker', undefined, project.name);
    if (!conductor || !worker) throw new Error('fixture agents were not created');
    const edge = ensureOrchestraEntryEdge(graph, { agentId: conductor.id }, worker.id);
    // 빈 칸이면 후방호환 폴백이 도구 박탈로 읽는다 — 저장된 값 자체를 확인한다.
    expect(edge.commandMode).toBe('shared');
    expect(resolveEdgeCommandMode(edge)).toBe('shared');
    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(graph.toProjectCheckpoint(project.name));
    expect(restored.getTaskEdge(edge.id)?.commandMode).toBe('shared');
  });
});

describe('orchestra critique firing', () => {
  const cmd = (over: Partial<QueuedCommand>): QueuedCommand =>
    ({ id: 'c', subAgentId: 'sub', timestamp: 1, text: 'work', status: 'completed', ...over } as QueuedCommand);
  const lookup = (runs: Record<string, string>, edges: Record<string, { kind?: string; bundleRole?: string }> = {}, stopped: string[] = []) => ({
    findRun: (runId: string) => (runs[runId] ? { agentId: runs[runId]! } : undefined),
    findEdge: (edgeId: string | undefined) => (edgeId ? edges[edgeId] : undefined) as never,
    isUserStopped: (c: QueuedCommand) => stopped.includes(c.id),
  });

  it('fires for a critic the conductor never declared, once per run', () => {
    const done = [cmd({ id: 'a', orchestraRunId: 'run1', result: 'first', edgeId: 'e1' }),
      cmd({ id: 'b', orchestraRunId: 'run1', result: 'second', edgeId: 'e2' }),
      cmd({ id: 'c2', orchestraRunId: 'run2', result: 'other', edgeId: 'e3' })];
    const { firings, plainFallback } = orchestraCritiqueFirings(done, 'worker',
      lookup({ run1: 'conductor', run2: 'conductor2' }));
    expect(firings).toEqual([{ runId: 'run1', result: 'first', freshCycle: true },
      { runId: 'run2', result: 'other', freshCycle: true }]);
    expect(plainFallback).toBe(false);
  });

  it('skips the conductor own turn, user-stopped commands and critique responses', () => {
    const runs = { run1: 'worker' };
    expect(orchestraCritiqueFirings([cmd({ id: 'a', orchestraRunId: 'run1' })], 'worker', lookup(runs)))
      .toEqual({ firings: [], plainFallback: false });
    expect(orchestraCritiqueFirings([cmd({ id: 'a', orchestraRunId: 'run2' })], 'worker',
      lookup({ run2: 'conductor' }, {}, ['a']))).toEqual({ firings: [], plainFallback: false });
    expect(orchestraCritiqueFirings([cmd({ id: 'a', orchestraRunId: 'run2', edgeId: 'e' })], 'worker',
      lookup({ run2: 'conductor' }, { e: { kind: 'critique' } }))).toEqual({ firings: [], plainFallback: false });
  });

  it('marks a rework answer as the same cycle and falls back when no live run owns the work', () => {
    const { firings } = orchestraCritiqueFirings([cmd({ id: 'a', orchestraRunId: 'run1', edgeId: 'e', result: 'again' })],
      'worker', lookup({ run1: 'conductor' }, { e: { bundleRole: 'auto-rework' } }));
    expect(firings[0]?.freshCycle).toBe(false);
    expect(orchestraCritiqueFirings([cmd({ id: 'a', orchestraRunId: 'gone' })], 'worker', lookup({})))
      .toEqual({ firings: [], plainFallback: true });
    expect(orchestraCritiqueFirings([cmd({ id: 'a' })], 'worker', lookup({})))
      .toEqual({ firings: [], plainFallback: true });
  });
});
