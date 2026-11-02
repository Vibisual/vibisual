import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueuedCommand } from '@vibisual/shared';
import { isLiveFollowUpLocked, isLiveFollowUpPending, trySendLiveFollowUp, type LiveFollowUpOptions } from './liveFollowUp.js';

let sequence = 0;
function command(partial: Partial<QueuedCommand> = {}): QueuedCommand {
  const id = `live-follow-${++sequence}`;
  return { id, text: id, timestamp: sequence, subAgentId: 'session-a', status: 'queued', dispatchMode: 'steer', ...partial };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const outstanding: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const finish of outstanding.splice(0)) await finish();
  vi.restoreAllMocks();
});

function harness(initialQueue: QueuedCommand[]) {
  let queue: QueuedCommand[] | undefined = initialQueue;
  const acknowledgement = deferred<boolean>();
  const settled = deferred<void>();
  const options = {
    getQueue: vi.fn(() => queue),
    canSend: vi.fn(() => true),
    send: vi.fn<LiveFollowUpOptions['send']>(() => acknowledgement.promise),
    onChange: vi.fn(),
    onSettled: vi.fn(() => settled.resolve()),
  };
  outstanding.push(async () => {
    acknowledgement.resolve(false);
    if (options.send.mock.calls.length > 0) await settled.promise;
  });
  return { options, acknowledgement, settled: settled.promise, replaceQueue: (replacement: QueuedCommand[] | undefined) => { queue = replacement; } };
}

describe('live follow-up delivery', () => {
  it('keeps a separate acknowledged message while preserving the original command and all its metadata', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(500);
    const previous = { id: 'accepted-before', text: 'Earlier addition', timestamp: 1, deliveredAt: 2 };
    const base = command({ status: 'executing', text: 'Original task', startedAt: 10, attachments: ['original.png'],
      appNodeIds: ['app-a'], mergedCount: 2, inputTokens: 100, followUps: [previous] });
    const original = structuredClone(base);
    const incoming = command({ text: '  Keep my exact additional input\n', timestamp: 100, attachments: ['addition.png'], appNodeIds: ['app-a'] });
    const other = command({ subAgentId: 'session-b' });
    const queue = [base, other, incoming];
    const h = harness(queue);

    expect(trySendLiveFollowUp(incoming, h.options)).toBe(true);
    expect(incoming.liveDelivery).toEqual({ state: 'sending' });
    expect(isLiveFollowUpPending(incoming.id)).toBe(true);
    expect(isLiveFollowUpLocked(incoming)).toBe(true);
    expect(base).toEqual(original);
    expect(queue).toEqual([base, other, incoming]);
    expect(h.options.send).toHaveBeenCalledExactlyOnceWith('session-a', expect.objectContaining({
      id: incoming.id, text: incoming.text, attachments: ['addition.png'],
    }));

    h.acknowledgement.resolve(true);
    await h.settled;
    expect(queue).toEqual([base, other]);
    expect(base).toEqual({ ...original, followUps: [previous, {
      id: incoming.id, text: incoming.text, timestamp: 100, deliveredAt: 500, attachments: ['addition.png'],
    }] });
    expect(queue[0]).toBe(base);
    expect(isLiveFollowUpPending(incoming.id)).toBe(false);
    expect(h.options.onSettled).toHaveBeenCalledOnce();
  });

  it('records exactly the submitted input even if a caller later mutates its queued object', async () => {
    const base = command({ status: 'executing' });
    const incoming = command({ text: 'Submitted text', timestamp: 100, attachments: ['submitted.png'] });
    const h = harness([base, incoming]);
    expect(trySendLiveFollowUp(incoming, h.options)).toBe(true);
    incoming.text = 'Unsent edit';
    incoming.timestamp = 999;
    incoming.attachments!.push('unsent.png');
    h.acknowledgement.resolve(true);
    await h.settled;
    expect(base.followUps).toEqual([expect.objectContaining({ id: incoming.id, text: 'Submitted text', timestamp: 100, attachments: ['submitted.png'] })]);
    expect(h.options.send.mock.calls[0]?.[1]).toMatchObject({ text: 'Submitted text', attachments: ['submitted.png'] });
  });

  it('deduplicates calls while pending and does not replay an already accepted object', async () => {
    const base = command({ status: 'executing' });
    const incoming = command();
    const h = harness([base, incoming]);
    expect(trySendLiveFollowUp(incoming, h.options)).toBe(true);
    expect(trySendLiveFollowUp(incoming, h.options)).toBe(true);
    expect(h.options.send).toHaveBeenCalledOnce();
    h.acknowledgement.resolve(true);
    await h.settled;
    trySendLiveFollowUp(incoming, h.options);
    expect(h.options.send).toHaveBeenCalledOnce();
    expect(base.followUps).toHaveLength(1);
  });

  it.each(['Acknowledgement timeout', 'Connection closed'])('retains uncertain delivery without changing the base or automatically replaying: %s', async (message) => {
    const base = command({ status: 'executing' });
    const original = structuredClone(base);
    const incoming = command({ attachments: ['keep.png'] });
    const queue = [base, incoming];
    const h = harness(queue);
    expect(trySendLiveFollowUp(incoming, h.options)).toBe(true);
    h.acknowledgement.reject(new Error(message));
    await h.settled;
    expect(base).toEqual(original);
    expect(queue).toEqual([base, incoming]);
    expect(incoming).toMatchObject({ status: 'queued', attachments: ['keep.png'], liveDelivery: { state: 'uncertain', reason: 'deliveryUnknown' } });
    expect(incoming.error).toBeUndefined();
    expect(isLiveFollowUpPending(incoming.id)).toBe(false);
    expect(isLiveFollowUpLocked(incoming)).toBe(true);
    expect(trySendLiveFollowUp(incoming, h.options)).toBe(true);
    expect(h.options.send).toHaveBeenCalledOnce();
  });

  it.each(['sending', 'uncertain'] as const)('does not replay a persisted %s marker without a runtime reservation', (state) => {
    const base = command({ status: 'executing' });
    const incoming = command({ liveDelivery: { state } });
    const h = harness([base, incoming]);
    expect(isLiveFollowUpPending(incoming.id)).toBe(false);
    expect(isLiveFollowUpLocked(incoming)).toBe(true);
    expect(trySendLiveFollowUp(incoming, h.options)).toBe(true);
    expect(h.options.send).not.toHaveBeenCalled();
  });

  it('keeps a definite rejection visible and editable without repeatedly attempting delivery', async () => {
    const base = command({ status: 'executing' });
    const original = structuredClone(base);
    const incoming = command();
    const queue = [base, incoming];
    const h = harness(queue);
    expect(trySendLiveFollowUp(incoming, h.options)).toBe(true);
    h.acknowledgement.resolve(false);
    await h.settled;
    expect(queue).toEqual([base, incoming]);
    expect(base).toEqual(original);
    expect(incoming.liveDelivery).toEqual({ state: 'unavailable', reason: 'deliveryRejected' });
    expect(isLiveFollowUpLocked(incoming)).toBe(false);
    expect(trySendLiveFollowUp(incoming, h.options)).toBe(false);
    expect(h.options.send).toHaveBeenCalledOnce();
  });

  it('reports unsupported transport without sending or consuming the input', () => {
    const base = command({ status: 'executing' });
    const incoming = command();
    const queue = [base, incoming];
    const h = harness(queue);
    h.options.canSend.mockReturnValue(false);
    expect(trySendLiveFollowUp(incoming, h.options)).toBe(false);
    expect(incoming.liveDelivery).toEqual({ state: 'unavailable', reason: 'unsupported' });
    expect(queue).toEqual([base, incoming]);
    expect(h.options.send).not.toHaveBeenCalled();
  });

  it.each(['unassigned', 'none', 'completed', 'other-session', 'multiple'] as const)('requires one active command in the same session: %s', (scenario) => {
    const incoming = command({ ...(scenario === 'unassigned' ? { subAgentId: null } : {}) });
    const base = command({ status: scenario === 'completed' ? 'completed' : 'executing',
      ...(scenario === 'other-session' ? { subAgentId: 'session-b' } : {}) });
    const queue = scenario === 'none' ? [incoming] : scenario === 'multiple'
      ? [base, command({ status: 'executing' }), incoming] : [base, incoming];
    const h = harness(queue);
    expect(trySendLiveFollowUp(incoming, h.options)).toBe(false);
    expect(incoming.liveDelivery).toEqual({ state: 'unavailable', reason: 'noActiveTurn' });
    expect(h.options.canSend).not.toHaveBeenCalled();
    expect(h.options.send).not.toHaveBeenCalled();
  });

  it.each([
    { edgeId: 'edge' }, { orchestraRunId: 'orchestra' }, { silent: true },
    { executionRequirements: { localTransport: true } }, { runLimits: { maxTurns: 2 } },
    { waitForCommandIds: ['earlier'] }, { text: '/compact' },
  ] satisfies Partial<QueuedCommand>[])('rejects per-turn scope on either the base or incoming input: %j', (scope) => {
    for (const scopeOnBase of [false, true]) {
      const base = command({ status: 'executing', ...(scopeOnBase ? scope : {}) });
      const incoming = command(scopeOnBase ? {} : scope);
      const h = harness([base, incoming]);
      expect(trySendLiveFollowUp(incoming, h.options)).toBe(false);
      expect(incoming.liveDelivery).toEqual({ state: 'unavailable', reason: 'turnScope' });
      expect(h.options.send).not.toHaveBeenCalled();
    }
  });

  it.each([
    [{ appNodeIds: ['app-a'] }, {}],
    [{}, { appNodeIds: ['app-a'] }],
    [{ appNodeIds: ['app-a'] }, { appNodeIds: ['app-b'] }],
    [{ appNodesOff: true }, {}],
  ] satisfies [Partial<QueuedCommand>, Partial<QueuedCommand>][])('does not change the active app scope: %j -> %j', (baseScope, incomingScope) => {
    const base = command({ status: 'executing', ...baseScope });
    const incoming = command(incomingScope);
    const h = harness([base, incoming]);
    expect(trySendLiveFollowUp(incoming, h.options)).toBe(false);
    expect(incoming.liveDelivery).toEqual({ state: 'unavailable', reason: 'turnScope' });
    expect(h.options.send).not.toHaveBeenCalled();
  });

  it('removes accepted input from the latest queue when another session completion replaced the array', async () => {
    const base = command({ status: 'executing' });
    const other = command({ status: 'executing', subAgentId: 'session-b' });
    const incoming = command();
    const originalQueue = [base, other, incoming];
    const h = harness(originalQueue);
    expect(trySendLiveFollowUp(incoming, h.options)).toBe(true);
    other.status = 'completed';
    const newQueue = originalQueue.filter((entry) => entry !== other);
    h.replaceQueue(newQueue);
    h.acknowledgement.resolve(true);
    await h.settled;
    expect(newQueue).toEqual([base]);
    expect(base.followUps?.map((entry) => entry.id)).toEqual([incoming.id]);
  });

  it('retains an acknowledged message when completion moved the original command into history', async () => {
    const base = command({ status: 'executing' });
    const incoming = command();
    const h = harness([base, incoming]);
    expect(trySendLiveFollowUp(incoming, h.options)).toBe(true);
    base.status = 'completed';
    base.result = 'Finished';
    const archive = [base];
    const newQueue = [incoming];
    h.replaceQueue(newQueue);
    h.acknowledgement.resolve(true);
    await h.settled;
    expect(newQueue).toEqual([]);
    expect(archive[0]).toMatchObject({ status: 'completed', result: 'Finished', followUps: [expect.objectContaining({ id: incoming.id })] });
  });

  it('serializes one session, preserves delivery order, and releases its reservation before settlement callbacks', async () => {
    const base = command({ status: 'executing' });
    const first = command();
    const second = command();
    const queue = [base, first, second];
    const a = harness(queue);
    const b = harness(queue);
    expect(trySendLiveFollowUp(first, a.options)).toBe(true);
    expect(trySendLiveFollowUp(second, b.options)).toBe(true);
    expect(b.options.send).not.toHaveBeenCalled();
    expect(second.liveDelivery).toBeUndefined();
    expect(isLiveFollowUpLocked(second)).toBe(false);
    let pendingAtSettlement: boolean | undefined;
    let startedAtSettlement = false;
    const settleFirst = a.options.onSettled.getMockImplementation()!;
    a.options.onSettled.mockImplementationOnce(() => {
      pendingAtSettlement = isLiveFollowUpPending(first.id);
      startedAtSettlement = trySendLiveFollowUp(second, b.options);
      settleFirst();
    });
    a.acknowledgement.resolve(true);
    await a.settled;
    expect(pendingAtSettlement).toBe(false);
    expect(startedAtSettlement).toBe(true);
    expect(b.options.send).toHaveBeenCalledOnce();
    b.acknowledgement.resolve(true);
    await b.settled;
    expect(base.followUps?.map((entry) => entry.id)).toEqual([first.id, second.id]);
    expect(queue).toEqual([base]);
  });

  it('allows another session to deliver while the first session waits for acknowledgement', async () => {
    const baseA = command({ status: 'executing' });
    const baseB = command({ status: 'executing', subAgentId: 'session-b' });
    const inputA = command();
    const inputB = command({ subAgentId: 'session-b' });
    const queue = [baseA, baseB, inputA, inputB];
    const a = harness(queue);
    const b = harness(queue);
    expect(trySendLiveFollowUp(inputA, a.options)).toBe(true);
    expect(trySendLiveFollowUp(inputB, b.options)).toBe(true);
    expect(a.options.send).toHaveBeenCalledOnce();
    expect(b.options.send).toHaveBeenCalledOnce();
    b.acknowledgement.resolve(true);
    await b.settled;
    expect(baseA.followUps).toBeUndefined();
    expect(baseB.followUps?.map((entry) => entry.id)).toEqual([inputB.id]);
    expect(isLiveFollowUpPending(inputA.id)).toBe(true);
    a.acknowledgement.resolve(true);
    await a.settled;
    expect(queue).toEqual([baseA, baseB]);
  });

  it.each([undefined, 'wait', 'merge', 'immediate'] as const)('leaves %s input to the normal queue policy', (dispatchMode) => {
    const base = command({ status: 'executing' });
    const incoming = command({ dispatchMode });
    const queue = [base, incoming];
    const before = structuredClone(queue);
    const h = harness(queue);
    expect(trySendLiveFollowUp(incoming, h.options)).toBe(false);
    expect(queue).toEqual(before);
    expect(h.options.send).not.toHaveBeenCalled();
  });

  it('does not send a missing input or one that was already dispatched', () => {
    const base = command({ status: 'executing' });
    const h = harness([base]);
    expect(trySendLiveFollowUp(command(), h.options)).toBe(false);
    expect(trySendLiveFollowUp(base, h.options)).toBe(false);
    h.replaceQueue(undefined);
    expect(trySendLiveFollowUp(command(), h.options)).toBe(false);
    expect(h.options.send).not.toHaveBeenCalled();
  });
});
