import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DISPATCH_STATUS_WAIT_MAX_MS,
  createDispatchJobRegistry,
  createDispatchWaiterHub,
  parseDispatchStatusWaitMs,
  waitForDispatchStatus,
  type DispatchJob,
} from './taskEdgeDispatchJobs.js';

const base = { edgeId: 'edge-a', sourceAgentId: 'agent-src', targetAgentId: 'agent-dst' };

/** 손으로 돌리는 시계 — 제한시간과 완료가 같은 틈에 오는 경우를 순서대로 만든다. */
function manualTimers() {
  const pending = new Map<number, () => void>();
  let seq = 0;
  return {
    setTimer: (fn: () => void) => { const id = ++seq; pending.set(id, fn); return id; },
    clearTimer: (handle: unknown) => { pending.delete(handle as number); },
    fire: () => { const fns = [...pending.values()]; pending.clear(); for (const fn of fns) fn(); },
    count: () => pending.size,
  };
}

function setup() {
  const jobs = createDispatchJobRegistry();
  const waiters = createDispatchWaiterHub<DispatchJob>();
  jobs.register({ ...base, cmdId: 'cmd-1' });
  const initial = jobs.markExecuting('cmd-1')!;
  const timers = manualTimers();
  const replies: { job: DispatchJob; waited: boolean; timedOut: boolean }[] = [];
  const current = () => { const found = jobs.get('cmd-1'); return found.ok ? found.job : undefined; };
  const settle = (result: string) => {
    const job = jobs.finish('cmd-1', { status: 'completed', result });
    if (job) waiters.settle('cmd-1', job);
  };
  const start = (waitMs: number, from: DispatchJob = initial) => waitForDispatchStatus({
    cmdId: 'cmd-1', initial: from, waitMs, waiters, current,
    respond: (job, meta) => replies.push({ job, ...meta }),
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  return { jobs, waiters, initial, timers, replies, settle, start };
}

describe('§5.3 #10-2 ⑨ — 상태 조회 대기(parseDispatchStatusWaitMs)', () => {
  it('keeps the old instant lookup for absent or invalid values and caps long waits', () => {
    for (const raw of [undefined, null, '', ' ', 'abc', '-5', '0', 0, -1, Number.NaN, Number.POSITIVE_INFINITY, {}]) {
      expect(parseDispatchStatusWaitMs(raw)).toBe(0);
    }
    expect(parseDispatchStatusWaitMs('1500')).toBe(1500);
    expect(parseDispatchStatusWaitMs(['2000', '9'])).toBe(2000);
    expect(parseDispatchStatusWaitMs(12.7)).toBe(12);
    expect(parseDispatchStatusWaitMs('999999999')).toBe(DISPATCH_STATUS_WAIT_MAX_MS);
    // 부르는 쪽 Node fetch 의 헤더 대기(300초)보다 짧아야 한 번의 조회가 클라이언트 쪽에서 먼저 끊기지 않는다.
    expect(DISPATCH_STATUS_WAIT_MAX_MS).toBeLessThan(300_000);
  });
});

describe('§5.3 #10-2 ⑨ — 상태 조회 대기(waitForDispatchStatus)', () => {
  it('answers at once without waitMs or when the job is already finished', () => {
    const t = setup();
    t.start(0);
    expect(t.replies).toEqual([{ job: t.initial, waited: false, timedOut: false }]);
    expect(t.waiters.count()).toBe(0);
    expect(t.timers.count()).toBe(0);

    const finished = t.jobs.finish('cmd-1', { status: 'error', errorMessage: 'boom' })!;
    t.start(60_000, finished);
    expect(t.replies[1]).toEqual({ job: finished, waited: false, timedOut: false });
    expect(t.waiters.count()).toBe(0);
  });

  it('holds an unchanged executing status and answers once with the finished result', () => {
    const t = setup();
    t.start(60_000);
    expect(t.replies).toEqual([]);
    expect(t.waiters.count('cmd-1')).toBe(1);
    t.settle('three files changed');
    expect(t.replies).toHaveLength(1);
    expect(t.replies[0]).toMatchObject({ waited: true, timedOut: false, job: { status: 'completed', result: 'three files changed' } });
    // 완료가 이긴 뒤의 시계는 두 번째 응답을 만들지 않는다.
    expect(t.timers.count()).toBe(0);
    t.timers.fire();
    expect(t.replies).toHaveLength(1);
  });

  it('releases only the wait on timeout; the result finished later is still in the ledger for the same cmdId', () => {
    const t = setup();
    t.start(60_000);
    t.timers.fire();
    expect(t.replies).toEqual([{ job: expect.objectContaining({ status: 'executing' }), waited: true, timedOut: true }]);
    expect(t.waiters.count()).toBe(0);
    t.settle('late result');
    expect(t.replies).toHaveLength(1);
    // 같은 cmdId 로 다시 기다리면 끝난 결과를 곧바로 받는다 — 제한시간이 결과를 버리지 않는다.
    const again = t.jobs.get('cmd-1');
    expect(again.ok && again.job.status).toBe('completed');
    t.start(60_000, again.ok ? again.job : t.initial);
    expect(t.replies[1]).toMatchObject({ waited: false, timedOut: false, job: { status: 'completed', result: 'late result' } });
  });

  it('lets the ledger win when completion and the timer land in the same gap', () => {
    const t = setup();
    t.start(60_000);
    // 장부에는 끝이 적혔지만 대기에 건네기 전에 시계가 먼저 돈 경우.
    t.jobs.finish('cmd-1', { status: 'completed', result: 'raced' });
    t.timers.fire();
    expect(t.replies).toEqual([{ job: expect.objectContaining({ status: 'completed', result: 'raced' }), waited: true, timedOut: false }]);
    expect(t.waiters.count()).toBe(0);
  });

  it('does not lose a result that finished between the lookup and attaching the wait', () => {
    const t = setup();
    const stale = t.initial;
    t.jobs.finish('cmd-1', { status: 'completed', result: 'finished in between' });
    t.start(60_000, stale);
    expect(t.replies).toEqual([{ job: expect.objectContaining({ status: 'completed', result: 'finished in between' }), waited: false, timedOut: false }]);
    expect(t.waiters.count()).toBe(0);
    expect(t.timers.count()).toBe(0);
  });

  it('a closed connection drops only its wait; the job keeps running and never answers a dead socket', () => {
    const t = setup();
    const stop = t.start(60_000);
    stop();
    stop();
    expect(t.waiters.count()).toBe(0);
    expect(t.timers.count()).toBe(0);
    t.settle('after close');
    expect(t.replies).toEqual([]);
    const job = t.jobs.get('cmd-1');
    expect(job.ok && job.job.result).toBe('after close');
  });

  it('keeps a cancelled job a failure, not a pending success', () => {
    const t = setup();
    t.start(60_000);
    const job = t.jobs.finish('cmd-1', { status: 'cancelled', result: '[Stopped by user]' })!;
    t.waiters.settle('cmd-1', job);
    expect(t.replies[0]).toMatchObject({ waited: true, timedOut: false, job: { status: 'cancelled' } });
  });
});

describe('§5.3 #10-2 ⑨ — 조회 대기 배선', () => {
  it('wires the status route through the bounded wait and releases it on close', () => {
    const s = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    const start = s.indexOf("app.get('/api/task-edges/dispatch/:cmdId', (req, res) => {");
    const end = s.indexOf("app.post('/api/task-edges/dispatch/:cmdId/cancel', (req, res) => {");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const route = s.slice(start, end);
    expect(route).toContain('waitForDispatchStatus({');
    expect(route).toContain('parseDispatchStatusWaitMs(');
    expect(route).toContain("res.on('close', () => { if (!res.writableEnded) stop(); });");
    // 붙든 뒤 풀 때 조회 자격을 다시 가른다.
    const lookup = 'lookupDispatchJobForRequest(req, cmdId';
    expect(route.indexOf(lookup)).toBeGreaterThan(-1);
    expect(route.indexOf(lookup)).toBeLessThan(route.lastIndexOf(lookup));
  });
});
