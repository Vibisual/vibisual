import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DISPATCH_REQUEST_KEY_MAX,
  DISPATCH_STATUS_GRANTS_MAX,
  createDispatchJobRegistry,
  createDispatchWaiterHub,
  decideDispatchJobAccess,
  dispatchOutcomeFromCommand,
  dispatchRequestFingerprint,
  dispatchStatusGrantInstructions,
  formatUndeliveredDispatchJobs,
  isDispatchJobSucceeded,
  isDispatchRequestKeyConflict,
  isDispatchResultUndelivered,
  parseDispatchRequestKey,
  parseDispatchStatusGrants,
  parseDispatchWait,
  resolveDispatchRequester,
  toDispatchJobView,
  undeliveredDispatchResultInstructions,
} from './taskEdgeDispatchJobs.js';

const base = { edgeId: 'edge-a', sourceAgentId: 'agent-src', targetAgentId: 'agent-dst' };

function clock(start = 1_000) {
  let at = start;
  return { now: () => at, advance: (ms: number) => { at += ms; } };
}

describe('taskEdgeDispatchJobs', () => {
  it('keeps the result after the waiting connection is gone, so it can be recovered by cmdId', () => {
    const jobs = createDispatchJobRegistry();
    jobs.register({ ...base, cmdId: 'cmd-1' });
    expect(jobs.markExecuting('cmd-1')?.status).toBe('executing');
    jobs.finish('cmd-1', { status: 'completed', result: 'done: 3 files changed' });

    const lookup = jobs.get('cmd-1', 'agent-src');
    expect(lookup).toMatchObject({ ok: true, job: { status: 'completed', result: 'done: 3 files changed' } });
  });

  it('returns the existing job for a retry with the same request key instead of running it twice', () => {
    const jobs = createDispatchJobRegistry();
    const first = jobs.register({ ...base, cmdId: 'cmd-1', requestKey: 'retry-key' });
    const retry = jobs.register({ ...base, cmdId: 'cmd-2', requestKey: 'retry-key' });
    expect(first.reused).toBe(false);
    expect(retry).toMatchObject({ reused: true, job: { cmdId: 'cmd-1' } });
    expect(jobs.get('cmd-2')).toEqual({ ok: false, reason: 'not-found' });

    jobs.finish('cmd-1', { status: 'completed', result: 'ok' });
    expect(jobs.register({ ...base, cmdId: 'cmd-3', requestKey: 'retry-key' })).toMatchObject({
      reused: true,
      job: { cmdId: 'cmd-1', status: 'completed', result: 'ok' },
    });
    expect(jobs.findByRequestKey('agent-src', 'edge-a', 'retry-key')?.cmdId).toBe('cmd-1');
  });

  it('scopes request keys by source agent and edge, and ignores blank keys', () => {
    const jobs = createDispatchJobRegistry();
    jobs.register({ ...base, cmdId: 'cmd-1', requestKey: 'k' });
    expect(jobs.register({ ...base, sourceAgentId: 'agent-other', cmdId: 'cmd-2', requestKey: 'k' }).reused).toBe(false);
    expect(jobs.register({ ...base, edgeId: 'edge-b', cmdId: 'cmd-3', requestKey: 'k' }).reused).toBe(false);
    expect(jobs.register({ ...base, cmdId: 'cmd-4', requestKey: '   ' }).reused).toBe(false);
    expect(jobs.register({ ...base, cmdId: 'cmd-5', requestKey: '   ' }).reused).toBe(false);
  });

  it('applies the same ownership rule as dispatch: a named requester must be the source agent', () => {
    const jobs = createDispatchJobRegistry();
    jobs.register({ ...base, cmdId: 'cmd-1' });
    expect(jobs.get('cmd-1', 'agent-intruder')).toEqual({ ok: false, reason: 'forbidden' });
    expect(jobs.get('cmd-1').ok).toBe(true);
    expect(jobs.get('cmd-missing', 'agent-src')).toEqual({ ok: false, reason: 'not-found' });
  });

  it('keeps the first terminal status, so a child exit after cancel does not overwrite it', () => {
    const jobs = createDispatchJobRegistry();
    jobs.register({ ...base, cmdId: 'cmd-1' });
    jobs.finish('cmd-1', { status: 'cancelled', errorMessage: 'cancelled by source' });
    jobs.finish('cmd-1', { status: 'error', errorMessage: '[Stopped by user]' });
    jobs.markExecuting('cmd-1');
    expect(jobs.get('cmd-1')).toMatchObject({ ok: true, job: { status: 'cancelled', errorMessage: 'cancelled by source' } });
    expect(jobs.finish('cmd-unknown', { status: 'completed' })).toBeUndefined();
  });

  it('bounds finished jobs by count and age without evicting active ones', () => {
    const time = clock();
    const jobs = createDispatchJobRegistry({ maxFinished: 2, finishedTtlMs: 10_000, now: time.now });
    jobs.register({ ...base, cmdId: 'active' });
    for (const id of ['f1', 'f2', 'f3']) {
      jobs.register({ ...base, cmdId: id, requestKey: id });
      time.advance(1);
      jobs.finish(id, { status: 'completed', result: id });
    }
    expect(jobs.get('f1').ok).toBe(false);
    expect(jobs.get('f2').ok).toBe(true);
    expect(jobs.get('active').ok).toBe(true);

    time.advance(10_000);
    expect(jobs.get('f3').ok).toBe(false);
    expect(jobs.get('active').ok).toBe(true);
    expect(jobs.size()).toBe(1);
    expect(jobs.register({ ...base, cmdId: 'f3-rerun', requestKey: 'f3' }).reused).toBe(false);
  });

  it('hands out copies, so callers cannot mutate the ledger', () => {
    const jobs = createDispatchJobRegistry();
    const { job } = jobs.register({ ...base, cmdId: 'cmd-1' });
    job.status = 'completed';
    const lookup = jobs.get('cmd-1');
    expect(lookup.ok && lookup.job.status).toBe('queued');
  });
});

describe('taskEdgeDispatchJobs — access, request parsing, waiters, outcomes', () => {
  it('requires a named requester for loopback ingress, so omitting agentId cannot bypass ownership', () => {
    const jobs = createDispatchJobRegistry();
    jobs.register({ ...base, cmdId: 'cmd-1' });
    expect(jobs.get('cmd-1', { fromLoopback: true })).toEqual({ ok: false, reason: 'requester-required' });
    // 이름 없는 바깥 호출에는 작업이 있는지조차 답하지 않는다.
    expect(jobs.get('cmd-missing', { fromLoopback: true })).toEqual({ ok: false, reason: 'requester-required' });
    expect(jobs.get('cmd-1', { fromLoopback: true, requesterAgentId: 'agent-intruder' })).toEqual({ ok: false, reason: 'forbidden' });
    expect(jobs.get('cmd-1', { fromLoopback: true, requesterAgentId: 'agent-src' }).ok).toBe(true);
    // 앱 화면(IPC)은 사용자다.
    expect(jobs.get('cmd-1', { fromLoopback: false }).ok).toBe(true);
    expect(decideDispatchJobAccess('agent-src')).toEqual({ ok: true });
    expect(decideDispatchJobAccess('agent-src', { fromLoopback: true })).toEqual({ ok: false, reason: 'requester-required' });
  });

  it('collapses requester ids from header, query and body, and rejects conflicting ones', () => {
    expect(resolveDispatchRequester(undefined, '  ', undefined)).toEqual({ ok: true });
    expect(resolveDispatchRequester('agent-src', 'agent-src')).toEqual({ ok: true, agentId: 'agent-src' });
    expect(resolveDispatchRequester(['agent-src'], undefined, ' agent-src ')).toEqual({ ok: true, agentId: 'agent-src' });
    expect(resolveDispatchRequester('agent-src', 'agent-other')).toEqual({ ok: false, reason: 'conflicting-requester' });
    expect(resolveDispatchRequester(['agent-src', 'agent-other'])).toEqual({ ok: false, reason: 'conflicting-requester' });
  });

  it('parses the wait flag and the request key defensively', () => {
    expect(parseDispatchWait(undefined, undefined)).toBe(true);
    expect(parseDispatchWait('false')).toBe(false);
    expect(parseDispatchWait(['0'])).toBe(false);
    expect(parseDispatchWait(undefined, false)).toBe(false);
    expect(parseDispatchWait('maybe', 'no')).toBe(false);
    expect(parseDispatchWait('true', false)).toBe(true);
    expect(parseDispatchRequestKey()).toEqual({ ok: true });
    expect(parseDispatchRequestKey(undefined, ' k ')).toEqual({ ok: true, requestKey: 'k' });
    expect(parseDispatchRequestKey('k', 'k')).toEqual({ ok: true, requestKey: 'k' });
    expect(parseDispatchRequestKey('a', 'b')).toEqual({ ok: false, reason: 'conflicting-request-key' });
    expect(parseDispatchRequestKey('x'.repeat(DISPATCH_REQUEST_KEY_MAX + 1))).toEqual({ ok: false, reason: 'request-key-too-long' });
  });

  it('flags a request key reused with a different instruction and never exposes the fingerprint', () => {
    const jobs = createDispatchJobRegistry();
    const { job } = jobs.register({ ...base, cmdId: 'cmd-1', requestKey: 'k', fingerprint: dispatchRequestFingerprint('do the thing') });
    expect(isDispatchRequestKeyConflict(job, dispatchRequestFingerprint('do the thing'))).toBe(false);
    expect(isDispatchRequestKeyConflict(job, dispatchRequestFingerprint('do another thing'))).toBe(true);
    expect(isDispatchRequestKeyConflict(job, undefined)).toBe(false);
    expect(toDispatchJobView(job)).not.toHaveProperty('fingerprint');
    expect(job.fingerprint).toBeDefined();
  });

  it('releases one waiter on timeout or close without touching the others, and settles the rest exactly once', () => {
    const hub = createDispatchWaiterHub<string>();
    const got: string[] = [];
    const releaseA = hub.add('cmd-1', (v) => got.push(`a:${v}`));
    hub.add('cmd-1', (v) => got.push(`b:${v}`));
    hub.add('cmd-1', () => { throw new Error('socket gone'); });
    releaseA();
    releaseA();
    expect(hub.count('cmd-1')).toBe(2);
    expect(hub.settle('cmd-1', 'done')).toBe(2);
    expect(got).toEqual(['b:done']);
    expect(hub.settle('cmd-1', 'again')).toBe(0);
    expect(hub.count()).toBe(0);
  });

  it('maps a finished command to the job outcome: a user stop is cancelled, a usage-limit stop is not success', () => {
    expect(dispatchOutcomeFromCommand({ status: 'executing' })).toBeUndefined();
    expect(dispatchOutcomeFromCommand({ status: 'queued' })).toBeUndefined();
    expect(dispatchOutcomeFromCommand({ status: 'completed', result: 'ok' })).toEqual({ status: 'completed', result: 'ok' });
    expect(dispatchOutcomeFromCommand({ status: 'error', result: 'boom' })).toEqual({ status: 'error', result: 'boom', errorMessage: 'boom' });
    expect(dispatchOutcomeFromCommand({ status: 'error' })).toEqual({ status: 'error', errorMessage: 'subagent error' });
    expect(dispatchOutcomeFromCommand({ status: 'completed', result: '[Stopped by user]\n\npartial' })).toMatchObject({
      status: 'cancelled',
      result: '[Stopped by user]\n\npartial',
    });

    const time = clock(1_000);
    const jobs = createDispatchJobRegistry({ now: time.now });
    const limit = { kind: 'session' as const, at: 5_000, message: "You've hit your session limit" };
    jobs.register({ ...base, cmdId: 'cmd-1' });
    const outcome = dispatchOutcomeFromCommand({ status: 'completed', result: limit.message }, limit);
    expect(outcome).toBeDefined();
    if (!outcome) return;
    const finished = jobs.finish('cmd-1', outcome);
    expect(finished).toMatchObject({ status: 'completed', usageLimit: { kind: 'session' } });
    expect(finished && isDispatchJobSucceeded(finished)).toBe(false);
    expect(isDispatchJobSucceeded({ status: 'completed' })).toBe(true);

    // 이 작업이 생기기 전에 선 한도 표식은 이 작업의 사실이 아니다.
    time.advance(10);
    jobs.register({ ...base, cmdId: 'cmd-2' });
    expect(jobs.finish('cmd-2', { status: 'completed', result: 'ok', usageLimit: { ...limit, at: 10 } })?.usageLimit).toBeUndefined();
  });

  it('records a cancel request without inventing a terminal state', () => {
    const jobs = createDispatchJobRegistry();
    jobs.register({ ...base, cmdId: 'cmd-1' });
    jobs.markExecuting('cmd-1');
    expect(jobs.markCancelRequested('cmd-1')).toMatchObject({ status: 'executing', cancelRequestedAt: expect.any(Number) });
    expect(jobs.get('cmd-1')).toMatchObject({ ok: true, job: { status: 'executing' } });
    jobs.finish('cmd-1', { status: 'cancelled', result: '[Stopped by user]', errorMessage: 'stopped by user' });
    expect(jobs.get('cmd-1')).toMatchObject({ ok: true, job: { status: 'cancelled', cancelRequestedAt: expect.any(Number) } });
    expect(jobs.markCancelRequested('cmd-unknown')).toBeUndefined();
  });
});

/*
 * 장부는 순수 모듈이지만 **끝 상태를 적는 자리는 index.ts 안의 클로저**라 밖에서 부를 수 없다. 한 자리라도 배선이
 * 빠지면 그 작업은 장부에서 영영 진행 중이고 동기 대기는 풀리지 않는다 — 화면에는 아무것도 안 뜬다. 그래서
 * 배선이 살아 있는지를 소스로 고정한다(§5.3 #9-1 게이트 배선 검사와 같은 수법).
 */
describe('§5.3 #10-2 — 위임 결과 복구 배선', () => {
  const server = (): string => readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

  it('opens the status and cancel routes next to dispatch', () => {
    const s = server();
    expect(s).toContain("app.get('/api/task-edges/dispatch/:cmdId', (req, res) => {");
    expect(s).toContain("app.post('/api/task-edges/dispatch/:cmdId/cancel', (req, res) => {");
  });

  it('writes the ledger before the command enters the queue', () => {
    const s = server();
    const start = s.indexOf("app.post('/api/task-edges/dispatch', (req, res) => {");
    const end = s.indexOf("app.get('/api/task-edges/dispatch/:cmdId'");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const handler = s.slice(start, end);
    expect(handler.indexOf('dispatchJobs.register({')).toBeGreaterThan(-1);
    expect(handler.indexOf('dispatchJobs.register({')).toBeLessThan(handler.indexOf('queue.push(cmd);'));
    // 재시도는 서브에이전트를 만들기 전에 가른다 — 뒤에 두면 재사용하면서도 빈 탭이 하나 남는다.
    expect(handler.indexOf('dispatchJobs.findByRequestKey(')).toBeLessThan(handler.indexOf('subAgentManager.create('));
  });

  it('settles the ledger at every place a command leaves the queue', () => {
    const s = server();
    // 완료 콜백 1 · stop-session 2 · stop-all 2 · 좀비 봉합 1 · 큐에서 지우기 1 · 취소 1
    expect(s.split('settleDispatchCommand(').length - 1).toBeGreaterThanOrEqual(8);
    expect(s).toContain('for (const cmd of sealed) settleDispatchCommand(cmd, { updateEdge: true });');
  });

  it('cancels through the existing stop, and a timeout only releases the wait', () => {
    const s = server();
    expect(s).toContain('const stopped = cmd.subAgentId ? subAgentManager.stop(cmd.subAgentId) : false;');
    expect(s).not.toContain('dispatch timeout (');
    expect(s).not.toContain('pendingDispatches.set(');
  });

  it('lets external processes reach the new routes through the loopback listener', () => {
    const desktop = readFileSync(new URL('../../../desktop/src/main/index.ts', import.meta.url), 'utf8');
    expect(desktop).toContain("!path.startsWith('/api/task-edges/dispatch/') &&");
  });
});

/*
 * §5.3 #10-2 위임 조회 — 부모가 띄운 작업 X 의 결과 확인을 다른 에이전트에게 맡기는 경우.
 * 조회 권한은 요청자가 자기 id 를 무엇이라 적든 넓어지지 않는다 — 서버 장부에 있는 **살아 있는 위임 Y**
 * (대상 = 조회자, 목록에 X, Y 의 소스가 X 를 읽을 수 있음)만이 근거다.
 */
describe('§5.3 #10-2 — 위임 조회(명시적 위임 관계·작업 범위)', () => {
  const PARENT = 'agent-parent';
  const CHECKER = 'agent-checker';
  const read = (requesterAgentId: string) => ({ requesterAgentId, fromLoopback: true, purpose: 'read' as const });
  const cancel = (requesterAgentId: string) => ({ requesterAgentId, fromLoopback: true, purpose: 'cancel' as const });

  /** 부모가 작업 X·Z 를 띄우고, X 만 확인하라고 CHECKER 에게 Y 를 맡긴 장부. */
  function delegatedLedger() {
    const jobs = createDispatchJobRegistry();
    jobs.register({ edgeId: 'edge-work', sourceAgentId: PARENT, targetAgentId: 'agent-worker', cmdId: 'job-x' });
    jobs.register({ edgeId: 'edge-work', sourceAgentId: PARENT, targetAgentId: 'agent-worker', cmdId: 'job-z' });
    expect(jobs.authorizeStatusGrants(PARENT, ['job-x'])).toEqual({ ok: true });
    jobs.register({ edgeId: 'edge-check', sourceAgentId: PARENT, targetAgentId: CHECKER, cmdId: 'job-y', statusGrants: ['job-x'] });
    jobs.markExecuting('job-y');
    return jobs;
  }

  it('lets the original owner read its own job, with or without a delegation outstanding', () => {
    const jobs = delegatedLedger();
    expect(jobs.get('job-x', read(PARENT))).toMatchObject({ ok: true, job: { cmdId: 'job-x' } });
    expect(jobs.get('job-z', read(PARENT)).ok).toBe(true);
    expect(jobs.get('job-x', cancel(PARENT)).ok).toBe(true);
  });

  it('lets the explicitly delegated checker read the granted job while its delegation runs', () => {
    const jobs = delegatedLedger();
    expect(jobs.get('job-x', read(CHECKER))).toMatchObject({ ok: true, job: { cmdId: 'job-x', sourceAgentId: PARENT } });
    // 대기열에 있는 동안(아직 executing 전)도 위임은 살아 있다.
    jobs.register({ edgeId: 'edge-check', sourceAgentId: PARENT, targetAgentId: 'agent-queued', cmdId: 'job-y2', statusGrants: ['job-z'] });
    expect(jobs.get('job-z', read('agent-queued')).ok).toBe(true);
  });

  it('refuses unrelated agents, including the worker of the job and a delegate that was given no grant', () => {
    const jobs = delegatedLedger();
    jobs.register({ edgeId: 'edge-check', sourceAgentId: PARENT, targetAgentId: 'agent-plain', cmdId: 'job-plain' });
    for (const stranger of ['agent-stranger', 'agent-worker', 'agent-plain']) {
      expect(jobs.get('job-x', read(stranger))).toEqual({ ok: false, reason: 'forbidden' });
    }
    // 이름을 밝히지 않은 바깥 호출은 위임자라도 들어오지 못한다.
    expect(jobs.get('job-x', { fromLoopback: true, purpose: 'read' })).toEqual({ ok: false, reason: 'requester-required' });
  });

  it('refuses the delegate outside the granted scope: other jobs, its own delegation job, and cancelling', () => {
    const jobs = delegatedLedger();
    expect(jobs.get('job-z', read(CHECKER))).toEqual({ ok: false, reason: 'forbidden' });
    expect(jobs.get('job-y', read(CHECKER))).toEqual({ ok: false, reason: 'forbidden' });
    expect(jobs.get('job-x', cancel(CHECKER))).toEqual({ ok: false, reason: 'forbidden' });
    // 목적을 밝히지 않은 조회(옛 호출 모양)는 위임을 받지 않는다 — 소유자 판정만 한다.
    expect(jobs.get('job-x', CHECKER)).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('ends the grant when the delegation finishes, and hands the same scope to the next turn only while it is live', () => {
    const jobs = delegatedLedger();
    expect(jobs.activeStatusGrantsFor('job-y')).toEqual(['job-x']);
    expect(jobs.activeStatusGrantsFor('job-x')).toEqual([]);
    expect(jobs.activeStatusGrantsFor('job-missing')).toEqual([]);
    jobs.finish('job-y', { status: 'completed', result: 'checked' });
    expect(jobs.get('job-x', read(CHECKER))).toEqual({ ok: false, reason: 'forbidden' });
    expect(jobs.activeStatusGrantsFor('job-y')).toEqual([]);
    expect(jobs.get('job-x', read(PARENT)).ok).toBe(true);
  });

  it('only lets an agent grant what it can read itself, checked before anything is created', () => {
    const jobs = delegatedLedger();
    expect(jobs.authorizeStatusGrants(PARENT, [])).toEqual({ ok: true });
    expect(jobs.authorizeStatusGrants(PARENT, ['job-x', 'job-z'])).toEqual({ ok: true });
    expect(jobs.authorizeStatusGrants(PARENT, ['job-x', 'job-missing'])).toEqual({ ok: false, reason: 'not-found', cmdId: 'job-missing' });
    expect(jobs.authorizeStatusGrants('agent-stranger', ['job-x'])).toEqual({ ok: false, reason: 'forbidden', cmdId: 'job-x' });
    // 위임받은 쪽은 받은 범위 안에서만 다시 넘길 수 있다.
    expect(jobs.authorizeStatusGrants(CHECKER, ['job-x'])).toEqual({ ok: true });
    expect(jobs.authorizeStatusGrants(CHECKER, ['job-x', 'job-z'])).toEqual({ ok: false, reason: 'forbidden', cmdId: 'job-z' });
  });

  it('follows a re-delegation chain only while every upstream delegation is live', () => {
    const jobs = delegatedLedger();
    jobs.register({ edgeId: 'edge-deputy', sourceAgentId: CHECKER, targetAgentId: 'agent-deputy', cmdId: 'job-y-deputy', statusGrants: ['job-x'] });
    expect(jobs.get('job-x', read('agent-deputy')).ok).toBe(true);
    jobs.finish('job-y', { status: 'cancelled', errorMessage: 'stopped by user' });
    expect(jobs.get('job-x', read('agent-deputy'))).toEqual({ ok: false, reason: 'forbidden' });
    expect(jobs.authorizeStatusGrants(CHECKER, ['job-x'])).toEqual({ ok: false, reason: 'forbidden', cmdId: 'job-x' });
  });

  it('does not trust a grant list alone: a delegation from an agent that cannot read the job opens nothing, and loops terminate', () => {
    const jobs = delegatedLedger();
    // 확인 절차를 건너뛰고 장부에 들어간 목록이라도, 넘긴 쪽이 읽을 수 없으면 받는 쪽도 읽을 수 없다.
    jobs.register({ edgeId: 'edge-forged', sourceAgentId: 'agent-stranger', targetAgentId: 'agent-accomplice', cmdId: 'job-forged', statusGrants: ['job-x'] });
    expect(jobs.get('job-x', read('agent-accomplice'))).toEqual({ ok: false, reason: 'forbidden' });
    jobs.register({ edgeId: 'edge-loop', sourceAgentId: 'agent-loop-a', targetAgentId: 'agent-loop-b', cmdId: 'job-loop-1', statusGrants: ['job-z'] });
    jobs.register({ edgeId: 'edge-loop', sourceAgentId: 'agent-loop-b', targetAgentId: 'agent-loop-a', cmdId: 'job-loop-2', statusGrants: ['job-z'] });
    expect(jobs.get('job-z', read('agent-loop-a'))).toEqual({ ok: false, reason: 'forbidden' });
    expect(jobs.get('job-z', read('agent-loop-b'))).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('keeps the grant list out of reach of callers that mutate what they passed in or got back', () => {
    const jobs = createDispatchJobRegistry();
    jobs.register({ edgeId: 'edge-work', sourceAgentId: PARENT, targetAgentId: 'agent-worker', cmdId: 'job-x' });
    const grants = ['job-x', 'job-x'];
    const { job } = jobs.register({ edgeId: 'edge-check', sourceAgentId: PARENT, targetAgentId: CHECKER, cmdId: 'job-y', statusGrants: grants });
    grants.push('job-other');
    job.statusGrants?.push('job-other');
    expect(jobs.activeStatusGrantsFor('job-y')).toEqual(['job-x']);
    jobs.activeStatusGrantsFor('job-y').push('job-other');
    expect(jobs.activeStatusGrantsFor('job-y')).toEqual(['job-x']);
  });

  it('grants read access only through the delegated-reader predicate, never cancel', () => {
    expect(decideDispatchJobAccess(PARENT, read(CHECKER), () => true)).toEqual({ ok: true });
    expect(decideDispatchJobAccess(PARENT, read(CHECKER), () => false)).toEqual({ ok: false, reason: 'forbidden' });
    expect(decideDispatchJobAccess(PARENT, cancel(CHECKER), () => true)).toEqual({ ok: false, reason: 'forbidden' });
    expect(decideDispatchJobAccess(PARENT, { requesterAgentId: CHECKER }, () => true)).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('parses the grant list from header, query or body and refuses to widen it silently', () => {
    expect(parseDispatchStatusGrants(undefined, null, undefined)).toEqual({ ok: true, cmdIds: [] });
    expect(parseDispatchStatusGrants(' job-x , job-y ,, job-x ')).toEqual({ ok: true, cmdIds: ['job-x', 'job-y'] });
    expect(parseDispatchStatusGrants(['job-x', 'job-y'], undefined, ['job-y', 'job-x'])).toEqual({ ok: true, cmdIds: ['job-x', 'job-y'] });
    expect(parseDispatchStatusGrants('job-x', 'job-x,job-z')).toEqual({ ok: false, reason: 'conflicting-status-grants' });
    expect(parseDispatchStatusGrants(undefined, undefined, [1])).toEqual({ ok: false, reason: 'invalid-status-grants' });
    const tooMany = Array.from({ length: DISPATCH_STATUS_GRANTS_MAX + 1 }, (_, i) => `job-${i}`);
    expect(parseDispatchStatusGrants(tooMany.join(','))).toEqual({ ok: false, reason: 'too-many-status-grants' });
    expect(parseDispatchStatusGrants('x'.repeat(DISPATCH_REQUEST_KEY_MAX + 1))).toEqual({ ok: false, reason: 'status-grant-too-long' });
  });

  it('makes the grant list part of the request fingerprint without changing fingerprints that carry none', () => {
    expect(dispatchRequestFingerprint('check it', [])).toBe(dispatchRequestFingerprint('check it'));
    expect(dispatchRequestFingerprint('check it', ['job-x', 'job-z'])).toBe(dispatchRequestFingerprint('check it', ['job-z', 'job-x']));
    const jobs = createDispatchJobRegistry();
    const { job } = jobs.register({ ...base, cmdId: 'cmd-1', requestKey: 'k', fingerprint: dispatchRequestFingerprint('check it', ['job-x']) });
    // 같은 요청 키로 다른 권한을 달고 오면 옛 작업을 돌려주지 않는다.
    expect(isDispatchRequestKeyConflict(job, dispatchRequestFingerprint('check it'))).toBe(true);
    expect(isDispatchRequestKeyConflict(job, dispatchRequestFingerprint('check it', ['job-z']))).toBe(true);
    expect(isDispatchRequestKeyConflict(job, dispatchRequestFingerprint('check it', ['job-x']))).toBe(false);
  });

  it('tells a Claude delegate to look up with its own id, and says nothing without grants', () => {
    expect(dispatchStatusGrantInstructions([])).toBe('');
    const text = dispatchStatusGrantInstructions(['job-x', 'job-z']);
    expect(text).toContain('`job-x`, `job-z`');
    expect(text).toContain('/api/task-edges/dispatch/<cmdId>?agentId=$VIBISUAL_PARENT_AGENT_ID');
    expect(text).toContain('x-vibisual-hook-token: $VIBISUAL_TOKEN');
    expect(text).not.toContain('/cancel');
  });
});

describe('§5.3 #10-2 — 위임 조회 배선', () => {
  const server = (): string => readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

  it('checks the grant list against the edge source before creating the target session or the job', () => {
    const s = server();
    const start = s.indexOf("app.post('/api/task-edges/dispatch', (req, res) => {");
    const handler = s.slice(start, s.indexOf("app.get('/api/task-edges/dispatch/:cmdId'"));
    expect(handler).toContain("parseDispatchStatusGrants(req.headers['x-vibisual-status-cmd-ids'], q.statusCmdIds, jsonBody.statusCmdIds)");
    expect(handler).toContain('dispatchRequestFingerprint(instruction, statusGrants)');
    const check = handler.indexOf('dispatchJobs.authorizeStatusGrants(edge.sourceAgentId, statusGrants)');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(handler.indexOf('subAgentManager.create('));
    expect(check).toBeLessThan(handler.indexOf('dispatchJobs.register({'));
    expect(handler).toContain("'status-grant-forbidden'");
  });

  it('delegates reads only: status lookups say read, cancel says cancel, and the reader gets its own id back', () => {
    const s = server();
    expect(s).toContain("lookupDispatchJobForRequest(req, cmdId, 'read')");
    expect(s).toContain("lookupDispatchJobForRequest(req, req.params.cmdId, 'cancel')");
    expect(s).toContain('dispatchStatusUrl(again.job, found.requesterAgentId)');
  });

  it('carries live grants into the delegated turn for both Claude and Codex', () => {
    const s = server();
    expect(s).toContain('dispatchJobs.activeStatusGrantsFor(next.id)');
    expect(s).toContain('dispatchStatusGrantInstructions(statusGrantsForTurn)');
    expect(s).toContain('statusCmdIds: statusGrantsForTurn');
  });
});

/*
 * §5.3 #10-2 결과 미수신 — 끝남과 받음은 다른 사실이다. 반환 엣지가 있는 위임은 부른 세션이 끝난 결과를 실제로 받기 전까지
 * "받지 못함"으로 남고, 그동안 그 세션의 턴은 완료로 끝나지 않는다. 조회가 막히면 cmdId 를 쥔 채 남고, 다시 되면 같은 작업을 받는다.
 */
describe('§5.3 #10-2 — 결과 미수신(받음 표식·이어 받기·중복 방지)', () => {
  const PARENT_SUB = 'sub-parent';
  const expecting = { ...base, expectsResult: true, requesterSubAgentId: PARENT_SUB };
  const mine = { requesterSubAgentId: PARENT_SUB };

  it('delayed completion: a running job is never marked received, and leaves the list only once its finished result is handed over', () => {
    const t = clock();
    const jobs = createDispatchJobRegistry({ now: t.now });
    jobs.register({ ...expecting, cmdId: 'cmd-slow', fingerprint: dispatchRequestFingerprint('slow work') });
    jobs.markExecuting('cmd-slow');
    // 대기가 결과 없이 풀린 자리(202 제한시간·wait=false 선반환) — 받았다고 적지 않는다.
    expect(jobs.markDelivered('cmd-slow')?.deliveredAt).toBeUndefined();
    expect(jobs.listUndelivered(mine).map((job) => [job.cmdId, job.status])).toEqual([['cmd-slow', 'executing']]);

    t.advance(60_000);
    jobs.finish('cmd-slow', { status: 'completed', result: 'late result' });
    // 끝났어도 아직 건네지 않았다.
    expect(jobs.listUndelivered(mine)).toMatchObject([{ cmdId: 'cmd-slow', status: 'completed', result: 'late result' }]);

    t.advance(5);
    const receivedAt = t.now();
    expect(jobs.markDelivered('cmd-slow')?.deliveredAt).toBe(receivedAt);
    expect(jobs.listUndelivered(mine)).toEqual([]);
    t.advance(5);
    expect(jobs.markDelivered('cmd-slow')?.deliveredAt).toBe(receivedAt);
    expect(jobs.markDelivered('cmd-missing')).toBeUndefined();
  });

  it('resume after a temporary lookup error: the job keeps its cmdId, a re-dispatch of the same instruction gets it back, and the result arrives later', () => {
    const jobs = createDispatchJobRegistry();
    const fingerprint = dispatchRequestFingerprint('run the tests');
    const sameWork = { sourceAgentId: base.sourceAgentId, edgeId: base.edgeId, fingerprint, requesterSubAgentId: PARENT_SUB };
    jobs.register({ ...expecting, cmdId: 'cmd-first', requestKey: 'key-1', fingerprint });
    jobs.markExecuting('cmd-first');

    // 조회가 거절·실패하면 장부에는 아무것도 적히지 않는다 — 받지 못한 결과로 남고, 턴 실패 사유에 이 cmdId 가 실린다.
    expect(formatUndeliveredDispatchJobs(jobs.listUndelivered(mine))).toBe('cmd-first (executing)');
    // 모델이 새 요청 키로 같은 일을 다시 띄워도 요청 키로는 못 찾지만, 받지 못한 같은 지시로 찾는다 — 새 작업을 만들지 않는다.
    expect(jobs.findByRequestKey(base.sourceAgentId, base.edgeId, 'key-2')).toBeUndefined();
    expect(jobs.findUndeliveredDuplicate(sameWork)?.cmdId).toBe('cmd-first');

    jobs.finish('cmd-first', { status: 'completed', result: 'all green' });
    expect(jobs.findUndeliveredDuplicate(sameWork)).toMatchObject({ cmdId: 'cmd-first', status: 'completed', result: 'all green' });
    // 조회가 다시 되면 같은 cmdId 로 결과를 받는다.
    expect(jobs.get('cmd-first', { requesterAgentId: base.sourceAgentId, fromLoopback: true, purpose: 'read' }))
      .toMatchObject({ ok: true, job: { cmdId: 'cmd-first', status: 'completed', result: 'all green' } });
    jobs.markDelivered('cmd-first');
    expect(jobs.listUndelivered(mine)).toEqual([]);
    // 받고 난 뒤의 같은 지시는 새 일이다.
    expect(jobs.findUndeliveredDuplicate(sameWork)).toBeUndefined();
    expect(jobs.size()).toBe(1);
  });

  it('failed results are results too: an error or cancelled job still has to be received, with its status visible', () => {
    const t = clock();
    const jobs = createDispatchJobRegistry({ now: t.now });
    jobs.register({ ...expecting, cmdId: 'cmd-err' });
    t.advance(1);
    jobs.register({ ...expecting, cmdId: 'cmd-stopped' });
    jobs.finish('cmd-err', { status: 'error', errorMessage: 'build failed' });
    jobs.finish('cmd-stopped', { status: 'cancelled', errorMessage: 'stopped by user' });

    const pending = jobs.listUndelivered(mine);
    expect(formatUndeliveredDispatchJobs(pending)).toBe('cmd-err (error), cmd-stopped (cancelled)');
    expect(pending.some((job) => isDispatchJobSucceeded(job))).toBe(false);
    expect(jobs.markDelivered('cmd-err')).toMatchObject({ status: 'error', errorMessage: 'build failed' });
    expect(jobs.listUndelivered(mine).map((job) => job.cmdId)).toEqual(['cmd-stopped']);
  });

  it('holds no turn for a cancel the requester asked for, or for a dispatch without a return channel', () => {
    const jobs = createDispatchJobRegistry();
    jobs.register({ ...expecting, cmdId: 'cmd-cancel' });
    jobs.markCancelRequested('cmd-cancel');
    jobs.register({ ...base, cmdId: 'cmd-one-way', requesterSubAgentId: PARENT_SUB });
    jobs.finish('cmd-one-way', { status: 'completed', result: 'nobody waits' });
    expect(jobs.listUndelivered()).toEqual([]);

    expect(isDispatchResultUndelivered({ expectsResult: true })).toBe(true);
    expect(isDispatchResultUndelivered({ expectsResult: true, deliveredAt: 1 })).toBe(false);
    expect(isDispatchResultUndelivered({ expectsResult: true, cancelRequestedAt: 1 })).toBe(false);
    expect(isDispatchResultUndelivered({})).toBe(false);
  });

  it('prevents duplicates only for the same session, edge, source and instruction', () => {
    const t = clock();
    const jobs = createDispatchJobRegistry({ now: t.now });
    const fingerprint = dispatchRequestFingerprint('deploy preview');
    jobs.register({ ...expecting, cmdId: 'cmd-mine', fingerprint });
    const find = (over: Partial<{ sourceAgentId: string; edgeId: string; fingerprint: string; requesterSubAgentId: string | undefined }>) =>
      jobs.findUndeliveredDuplicate({ sourceAgentId: base.sourceAgentId, edgeId: base.edgeId, fingerprint, requesterSubAgentId: PARENT_SUB, ...over })?.cmdId;

    expect(find({})).toBe('cmd-mine');
    // 다른 세션이 띄운 같은 지시는 그 세션의 몫이다 — 넘겨주면 원래 세션이 결과를 영영 못 받는다.
    expect(find({ requesterSubAgentId: 'sub-other' })).toBeUndefined();
    expect(find({ requesterSubAgentId: undefined })).toBeUndefined();
    expect(find({ edgeId: 'edge-b' })).toBeUndefined();
    expect(find({ sourceAgentId: 'agent-other' })).toBeUndefined();
    expect(find({ fingerprint: dispatchRequestFingerprint('deploy production') })).toBeUndefined();
    // 같은 지시라도 조회 권한 목록이 다르면 다른 요청이다.
    expect(find({ fingerprint: dispatchRequestFingerprint('deploy preview', ['job-x']) })).toBeUndefined();

    // 지문 없이 적힌 작업은 무엇이었는지 모르므로 묶지 않는다.
    const unknown = createDispatchJobRegistry();
    unknown.register({ ...expecting, cmdId: 'cmd-no-fingerprint' });
    expect(unknown.findUndeliveredDuplicate({ sourceAgentId: base.sourceAgentId, edgeId: base.edgeId, fingerprint, requesterSubAgentId: PARENT_SUB })).toBeUndefined();

    // 둘이면 가장 최근 것, 취소를 요청한 것은 이어 받지 않는다.
    t.advance(1);
    jobs.register({ ...expecting, cmdId: 'cmd-mine-later', fingerprint });
    expect(find({})).toBe('cmd-mine-later');
    jobs.markCancelRequested('cmd-mine-later');
    expect(find({})).toBe('cmd-mine');
  });

  it('drops received results before unreceived ones when the ledger overflows, and still honours the finished TTL', () => {
    const t = clock();
    const jobs = createDispatchJobRegistry({ now: t.now, maxFinished: 2, finishedTtlMs: 10_000 });
    jobs.register({ ...expecting, cmdId: 'cmd-oldest-unreceived' });
    jobs.finish('cmd-oldest-unreceived', { status: 'completed', result: 'r0' });
    t.advance(1);
    jobs.register({ ...expecting, cmdId: 'cmd-received' });
    jobs.finish('cmd-received', { status: 'completed', result: 'r1' });
    jobs.markDelivered('cmd-received');
    t.advance(1);
    jobs.register({ ...base, cmdId: 'cmd-one-way' });
    jobs.finish('cmd-one-way', { status: 'completed', result: 'r2' });

    expect(jobs.get('cmd-oldest-unreceived', 'agent-src').ok).toBe(true);
    expect(jobs.get('cmd-received', 'agent-src')).toEqual({ ok: false, reason: 'not-found' });
    expect(jobs.get('cmd-one-way', 'agent-src').ok).toBe(true);

    // 메모리 상한은 그대로다 — 제한 시간이 지나면 받지 못한 결과도 걷힌다(그 뒤로는 턴을 붙들지 않는다).
    t.advance(10_000);
    expect(jobs.listUndelivered()).toEqual([]);
    expect(jobs.size()).toBe(0);
  });

  it('tells the next Claude turn which results to pick up by cmdId without dispatching again, and says nothing when none are waiting', () => {
    expect(undeliveredDispatchResultInstructions([])).toBe('');
    const text = undeliveredDispatchResultInstructions([{ cmdId: 'cmd-a', status: 'executing' }, { cmdId: 'cmd-b', status: 'error' }]);
    expect(text).toContain('cmd-a (executing), cmd-b (error)');
    expect(text).toContain('/api/task-edges/dispatch/<cmdId>?agentId=$VIBISUAL_PARENT_AGENT_ID&waitMs=60000');
    expect(text).toContain('x-vibisual-hook-token: $VIBISUAL_TOKEN');
    expect(text).toContain('Do not dispatch the same work again.');
    expect(text).toContain('tell the user with its cmdId');
    expect(text).not.toContain('/cancel');
  });

  it('keeps the requesting session out of the job view', () => {
    const jobs = createDispatchJobRegistry();
    const { job } = jobs.register({ ...expecting, cmdId: 'cmd-1', fingerprint: 'fp' });
    const view = toDispatchJobView(job);
    expect(view).not.toHaveProperty('requesterSubAgentId');
    expect(view).not.toHaveProperty('fingerprint');
    expect(view).toMatchObject({ cmdId: 'cmd-1', expectsResult: true });
  });
});

describe('§5.3 #10-2 — 결과 미수신 배선', () => {
  const server = (): string => readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
  const dispatchHandler = (s: string): string =>
    s.slice(s.indexOf("app.post('/api/task-edges/dispatch', (req, res) => {"), s.indexOf("app.get('/api/task-edges/dispatch/:cmdId'"));

  it('binds a dispatch to the calling session and reuses its unreceived job before creating anything', () => {
    const handler = dispatchHandler(server());
    expect(handler).toContain("resolveDispatchRequesterSub(req.headers['x-vibisual-source-subagent'], edge.sourceAgentId)");
    const reuse = handler.indexOf('dispatchJobs.findUndeliveredDuplicate(');
    expect(reuse).toBeGreaterThan(-1);
    expect(reuse).toBeLessThan(handler.indexOf('subAgentManager.create('));
    expect(reuse).toBeLessThan(handler.indexOf('dispatchJobs.register({'));
    expect(handler).toContain('...(artifactTargetLive ? { expectsResult: true } : {}),');
    expect(handler).toContain('...(requesterSubAgentId !== undefined ? { requesterSubAgentId } : {}),');
  });

  it('marks a result received only after a finished response is fully written, and never reads a pending reply as success', () => {
    const s = server();
    expect(s).toContain('if (job.expectsResult !== true || !isTerminalDispatchJobStatus(job.status)) return;');
    expect(s).toContain("res.once('finish', () => { if (!res.destroyed) dispatchJobs.markDelivered(job.cmdId); });");
    // 조회는 띄운 에이전트 자신의 것만 받음으로 적는다 — 위임 조회자·앱 화면이 읽은 것은 그 턴이 받은 것이 아니다.
    expect(s).toContain('if (found.requesterAgentId !== undefined && found.requesterAgentId === again.job.sourceAgentId) markDispatchDeliveredOnFinish(res, again.job);');
    expect(s).toContain('ok: isTerminalDispatchJobStatus(job.status) ? isDispatchJobSucceeded(job) : !pending,');
    // 대기 결과 3 · 요청 키 재시도 1 · 같은 지시 재사용 1 · 선반환 1 · 조회 1
    expect(s.split('markDispatchDeliveredOnFinish(res, ').length - 1).toBeGreaterThanOrEqual(7);
  });

  it('keeps a turn with unreceived results from finishing as completed, and hands the list to the next turn on both providers', () => {
    const s = server();
    expect(s).toContain('subAgentManager.setPendingDispatchResultsProvider(pendingDispatchResultsFor);');
    expect(s).toContain('undeliveredDispatchResultInstructions(undeliveredForTurn)');
    expect(s).toContain('pendingResults: undeliveredForTurn.map(');
    const manager = readFileSync(new URL('./subAgentManager.ts', import.meta.url), 'utf8');
    // 세션 판정 자동 종료 · 에이전트 뷰 · 코덱스 · 로컬 · 레거시 close
    expect(manager.split('this.failIfDispatchResultMissing(sub, cmd);').length - 1).toBeGreaterThanOrEqual(5);
  });

  it('carries the calling session id through curl, the Codex bridge and its MCP process', () => {
    expect(server()).toContain('-H "x-vibisual-source-subagent: $VIBISUAL_SUBAGENT_ID"');
    const bridge = readFileSync(new URL('../../../../hooks/codex-edges.mjs', import.meta.url), 'utf8');
    expect(bridge).toContain("'x-vibisual-source-subagent': process.env.VIBISUAL_SUBAGENT_ID ?? '',");
    const runner = readFileSync(new URL('./codexRunner.ts', import.meta.url), 'utf8');
    expect(runner).toContain('VIBISUAL_SUBAGENT_ID: args.subAgentId');
  });
});
