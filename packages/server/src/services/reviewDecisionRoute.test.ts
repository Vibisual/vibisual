import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { createReviewDecisionHandler } from './reviewDecisionRoute.js';

vi.mock('./userDefaultsService.js', () => ({ userDefaultsService: { get: () => ({ updatedAt: 1 }), subscribe: () => () => {} } }));
const { ProjectGraph } = await import('./projectGraph.js');
let graph: InstanceType<typeof ProjectGraph>;
let server: Server;
let base: string;
let id: string;
const enqueue = vi.fn(() => true);
const merge = vi.fn<(nodeId: string) => Promise<{ ok: true; branch: string } | { ok: false; httpStatus: number; error: string }>>();
const publish = vi.fn();
function review(agentId = 'agent-a', subAgentId = 'session-b') {
  return graph.createReviewRequest({ projectName: 'fixture', agentId, subAgentId, worktreeNodeId: `worktree-${agentId}`, worktreePath: '/fixture', files: [], diff: '' });
}
function post(kind: string, reviewId = id) {
  return fetch(`${base}/api/review-requests/${reviewId}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, reason: 'fix it', reworkPrompt: 'reviewer prompt' }) });
}
beforeEach(async () => {
  graph = new ProjectGraph(); id = review().id;
  enqueue.mockReset().mockReturnValue(true); publish.mockReset(); merge.mockReset().mockResolvedValue({ ok: true, branch: 'work' });
  const app = express(); app.use(express.json());
  app.post('/api/review-requests/:id/decision', createReviewDecisionHandler({
    getReview: (key) => graph.getReviewRequest(key), recordDecision: (key, input) => graph.recordReviewDecision(key, input),
    enqueue, merge, publish, logInfo: () => {}, logError: () => {},
  }));
  await new Promise<void>((done) => { server = app.listen(0, '127.0.0.1', () => done()); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing fixture port');
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => { await new Promise<void>((done, reject) => server.close((err) => err ? reject(err) : done())); });

describe('review decisions are scoped and applied once', () => {
  it('reject dispatches once to the review session and a terminal review cannot be changed again', async () => {
    expect((await post('reject')).status).toBe(200);
    expect((await post('reject')).status).toBe(409);
    expect((await post('approve')).status).toBe(409);
    expect(enqueue).toHaveBeenCalledExactlyOnceWith('agent-a', 'reviewer prompt', 'rvw', 'session-b');
    expect(merge).not.toHaveBeenCalled();
    expect(graph.getReviewRequest(id)?.decisions).toHaveLength(1);
    expect(graph.recordReviewDecision(id, { kind: 'hold' })).toBeNull();
  });

  it('a delayed approval excludes all concurrent decisions for that review, but not another session', async () => {
    let finish!: (value: { ok: true; branch: string }) => void;
    merge.mockReturnValueOnce(new Promise((done) => { finish = done; }));
    const first = post('approve');
    await vi.waitFor(() => expect(merge).toHaveBeenCalledTimes(1));
    expect((await post('approve')).status).toBe(409);
    expect((await post('reject')).status).toBe(409);
    const other = review('agent-b', 'session-c');
    expect((await post('reject', other.id)).status).toBe(200);
    expect(enqueue).toHaveBeenCalledExactlyOnceWith('agent-b', 'reviewer prompt', 'rvw', 'session-c');
    finish({ ok: true, branch: 'work' }); expect((await first).status).toBe(200);
    expect(merge).toHaveBeenCalledTimes(1);
    expect(graph.getReviewRequest(id)?.decisions).toHaveLength(1);
  });

  it.each(['failure', 'throw'])('a merge %s releases ownership so a deliberate retry can succeed', async (failure) => {
    if (failure === 'throw') merge.mockRejectedValueOnce(new Error('fixture failure'));
    else merge.mockResolvedValueOnce({ ok: false, httpStatus: 409, error: 'parent-dirty' });
    expect((await post('approve')).status).toBe(failure === 'throw' ? 500 : 409);
    expect(graph.getReviewRequest(id)?.status).toBe('pending');
    expect((await post('approve')).status).toBe(200);
    expect(graph.getReviewRequest(id)?.status).toBe('approved');
  });

  it('a repeated hold is idempotent while the held review remains actionable', async () => {
    expect((await post('hold')).status).toBe(200);
    expect((await post('hold')).status).toBe(200);
    expect(graph.getReviewRequest(id)?.decisions).toHaveLength(1);
    expect(enqueue).not.toHaveBeenCalled(); expect(merge).not.toHaveBeenCalled();
    expect((await post('approve')).status).toBe(200);
    expect(graph.getReviewRequest(id)?.decisions).toHaveLength(2);
  });

  it('a restored terminal decision remains closed after a checkpoint round trip', () => {
    graph.recordReviewDecision(id, { kind: 'approve', mergeOk: true });
    const restored = new ProjectGraph();
    restored.acceptReviewRequest(JSON.parse(JSON.stringify(graph.getReviewRequest(id))));
    expect(restored.recordReviewDecision(id, { kind: 'reject', reason: 'late' })).toBeNull();
    expect(restored.getReviewRequest(id)?.status).toBe('approved');
    expect(restored.getReviewRequest(id)?.decisions).toHaveLength(1);
  });
});
