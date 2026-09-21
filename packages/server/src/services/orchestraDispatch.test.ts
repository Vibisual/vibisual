import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { QueuedCommand } from '@vibisual/shared';
import { ensureOrchestraEntryEdge, ensureOrchestraMemberReturns, orchestraRunForDispatch } from './orchestraDispatch.js';
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
});
