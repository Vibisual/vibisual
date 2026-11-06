import fs from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueuedCommand } from '@vibisual/shared';
import { isLiveFollowUpLocked, trySendLiveFollowUp } from './liveFollowUp.js';

// Exercise the production server wrapper and real delivery state machine without
// importing index.ts, which would start the HTTP server and engine processes.
const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');
const source = fs.readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('index.ts', source, ts.ScriptTarget.ES2022, true);
let wrapper: import('typescript').FunctionDeclaration | undefined;
function visit(node: import('typescript').Node): void {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'deliverLiveFollowUp') wrapper = node;
  ts.forEachChild(node, visit);
}
visit(tree);
if (!wrapper) throw new Error('Missing production deliverLiveFollowUp wrapper');
const compiled = ts.transpileModule(`${wrapper.getText(tree)}\nreturn deliverLiveFollowUp;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function deferred() {
  let resolve!: (accepted: boolean) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<boolean>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
let sequence = 0;
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const finish of cleanup.splice(0)) await finish();
  vi.restoreAllMocks();
});

function harness(engine: 'codex' | 'claude' = 'codex') {
  const sessionId = `live-route-session-${++sequence}`;
  const subAgentId = `live-route-sub-${sequence}`;
  function command(label: string, overrides: Partial<QueuedCommand> = {}): QueuedCommand {
    return {
      id: `${sessionId}-${label}`, text: label, timestamp: 10, subAgentId,
      status: 'queued', dispatchMode: 'steer', ...overrides,
    };
  }
  const base = command('base', { text: 'Original task', status: 'executing', attachments: ['original.png'] });
  const incoming = command('incoming', { text: '  Additional instruction\n', attachments: ['addition.png'] });
  const queue = [base, incoming];
  const commandQueues = new Map([[sessionId, queue]]);
  const acknowledgements: ReturnType<typeof deferred>[] = [];
  let available = true;
  function send() {
    const acknowledgement = deferred();
    acknowledgements.push(acknowledgement);
    return acknowledgement.promise;
  }
  const changes: string[] = [];
  const scope = {
    commandQueues, trySendLiveFollowUp,
    isCodexAppServerTurnRunning: vi.fn((id: string) => available && engine === 'codex' && id === subAgentId),
    steerCodexAppServerTurn: vi.fn((_id: string, _input: { text: string; images?: string[] }) => send()),
    subAgentManager: {
      canSendLiveFollowUp: vi.fn((id: string) => available && engine === 'claude' && id === subAgentId),
      sendLiveFollowUp: vi.fn((_id: string, _input: { id: string; text: string; attachments?: string[] }, _onReceived?: () => void) => send()),
    },
    graphManager: { invalidateCommandSnapshot: vi.fn((_id: string) => { changes.push('invalidate'); }) },
    scheduleCheckpoint: vi.fn(() => { changes.push('checkpoint'); }),
    broadcastSnapshot: vi.fn(() => { changes.push('broadcast'); }),
    processNextCommand: vi.fn(),
  };
  const deliver = new Function(...Object.keys(scope), compiled)(...Object.values(scope)) as
    (command: QueuedCommand, sessionId: string) => boolean;
  cleanup.push(async () => {
    // A failed assertion must not leave the real delivery module's reservations
    // pending, or start more sends while cleaning up its queue.
    available = false;
    for (const acknowledgement of acknowledgements) acknowledgement.resolve(false);
    await flush();
  });
  return {
    ...scope, sessionId, subAgentId, base, incoming, queue, command, acknowledgements, changes,
    deliver: (input: QueuedCommand = incoming) => deliver(input, sessionId),
    transport: engine === 'codex' ? scope.steerCodexAppServerTurn : scope.subAgentManager.sendLiveFollowUp,
  };
}

describe('production live follow-up routing', () => {
  it.each(['codex', 'claude'] as const)('sends through %s and persists an acknowledged separate message', async (engine) => {
    vi.spyOn(Date, 'now').mockReturnValue(500);
    const h = harness(engine);
    const original = structuredClone(h.base);

    expect(h.deliver()).toBe(true);
    expect(h.incoming.liveDelivery).toEqual({ state: 'sending' });
    expect(h.queue).toEqual([h.base, h.incoming]);
    expect(h.base).toEqual(original);
    if (engine === 'codex') {
      expect(h.steerCodexAppServerTurn).toHaveBeenCalledExactlyOnceWith(h.subAgentId, {
        text: h.incoming.text, images: ['addition.png'],
      });
      expect(h.subAgentManager.canSendLiveFollowUp).not.toHaveBeenCalled();
      expect(h.subAgentManager.sendLiveFollowUp).not.toHaveBeenCalled();
    } else {
      expect(h.subAgentManager.canSendLiveFollowUp).toHaveBeenCalledWith(h.subAgentId);
      // §5.5 #17-18 ⑬ — the message id written to Claude is the transcript key kept on the command.
      expect(h.incoming.liveTarget).toEqual({ commandId: h.base.id, messageId: expect.any(String) });
      expect(h.subAgentManager.sendLiveFollowUp).toHaveBeenCalledExactlyOnceWith(h.subAgentId, {
        id: h.incoming.id, text: h.incoming.text, timestamp: 10, attachments: ['addition.png'],
        messageId: h.incoming.liveTarget?.messageId,
      }, expect.any(Function));
      expect(h.steerCodexAppServerTurn).not.toHaveBeenCalled();
    }
    expect(h.changes).toEqual(['invalidate', 'checkpoint', 'broadcast']);
    expect(h.processNextCommand).not.toHaveBeenCalled();

    h.acknowledgements[0]!.resolve(true);
    await flush();

    expect(h.queue).toEqual([h.base]);
    expect(h.base).toEqual({ ...original, followUps: [{
      id: h.incoming.id, text: h.incoming.text, timestamp: 10, deliveredAt: 500, attachments: ['addition.png'],
    }] });
    expect(h.changes).toEqual(['invalidate', 'checkpoint', 'broadcast', 'invalidate', 'checkpoint', 'broadcast']);
    expect(h.graphManager.invalidateCommandSnapshot.mock.calls).toEqual([[h.sessionId], [h.sessionId]]);
    expect(h.scheduleCheckpoint).toHaveBeenCalledTimes(2);
    expect(h.broadcastSnapshot).toHaveBeenCalledTimes(2);
    expect(h.processNextCommand).toHaveBeenCalledExactlyOnceWith(h.sessionId);
  });

  it.each(['codex', 'claude'] as const)('serially drains only untouched steer inputs for the same sub through %s', async (engine) => {
    const h = harness(engine);
    const skipped = [
      h.command('other-sub', { subAgentId: 'another-sub' }),
      h.command('wait', { dispatchMode: 'wait' }),
      h.command('merge', { dispatchMode: 'merge' }),
      h.command('immediate', { dispatchMode: 'immediate' }),
      h.command('unavailable', { liveDelivery: { state: 'unavailable', reason: 'deliveryRejected' } }),
      h.command('uncertain', { liveDelivery: { state: 'uncertain', reason: 'deliveryUnknown' } }),
      h.command('sending', { liveDelivery: { state: 'sending' } }),
      h.command('completed', { status: 'completed' }),
    ];
    const before = structuredClone(skipped);
    const next = h.command('next');
    const last = h.command('last');
    h.queue.push(...skipped, next, last);

    expect(h.deliver()).toBe(true);
    expect(h.deliver(next)).toBe(true);
    expect(h.transport).toHaveBeenCalledOnce();
    expect(next.liveDelivery).toBeUndefined();
    h.acknowledgements[0]!.resolve(true);
    await flush();
    expect(h.transport).toHaveBeenCalledTimes(2);
    expect(next.liveDelivery).toEqual({ state: 'sending' });
    expect(last.liveDelivery).toBeUndefined();

    h.acknowledgements[1]!.resolve(true);
    await flush();
    expect(h.transport).toHaveBeenCalledTimes(3);
    expect(last.liveDelivery).toEqual({ state: 'sending' });
    h.acknowledgements[2]!.resolve(true);
    await flush();

    expect(h.base.followUps?.map((input) => input.id)).toEqual([h.incoming.id, next.id, last.id]);
    expect(h.queue).toEqual([h.base, ...skipped]);
    expect(skipped).toEqual(before);
    expect(h.processNextCommand.mock.calls).toEqual([[h.sessionId], [h.sessionId], [h.sessionId]]);
  });

  it('sends the next Claude input as soon as Claude queued the previous one (§5.5 #17-18 ⑫)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(700);
    const h = harness('claude');
    const received = h.command('received', { liveDelivery: { state: 'received', receivedAt: 1 } });
    const next = h.command('next');
    h.queue.push(received, next);

    expect(h.deliver()).toBe(true);
    expect(next.liveDelivery).toBeUndefined();
    const onReceived = h.subAgentManager.sendLiveFollowUp.mock.calls[0]![2]!;
    onReceived();
    expect(h.incoming.liveDelivery).toEqual({ state: 'received', receivedAt: 700 });
    expect(isLiveFollowUpLocked(h.incoming)).toBe(true);
    expect(next.liveDelivery).toEqual({ state: 'sending' });
    expect(received.liveDelivery).toEqual({ state: 'received', receivedAt: 1 });
    expect(h.subAgentManager.sendLiveFollowUp).toHaveBeenCalledTimes(2);
    expect(h.processNextCommand).not.toHaveBeenCalled();

    h.acknowledgements[0]!.resolve(true);
    h.acknowledgements[1]!.resolve(true);
    await flush();
    expect(h.base.followUps?.map((input) => input.id)).toEqual([h.incoming.id, next.id]);
    expect(h.queue).toEqual([h.base, received]);
  });

  it('continues past a synchronous scope rejection and delivers the following eligible input', async () => {
    const h = harness();
    const rejected = h.command('requires-another-app', { appNodeIds: ['different-app'] });
    const eligible = h.command('eligible');
    h.queue.push(rejected, eligible);
    h.deliver();
    h.acknowledgements[0]!.resolve(true);
    await flush();

    expect(rejected.liveDelivery).toEqual({ state: 'unavailable', reason: 'turnScope' });
    expect(h.queue).toContain(rejected);
    expect(eligible.liveDelivery).toEqual({ state: 'sending' });
    expect(h.transport).toHaveBeenCalledTimes(2);
    expect(h.steerCodexAppServerTurn).toHaveBeenLastCalledWith(h.subAgentId, { text: eligible.text, images: undefined });
    expect(h.scheduleCheckpoint).toHaveBeenCalledTimes(4);

    h.acknowledgements[1]!.resolve(true);
    await flush();
    expect(h.queue).toEqual([h.base, rejected]);
    expect(h.base.followUps?.map((input) => input.id)).toEqual([h.incoming.id, eligible.id]);
  });

  it('marks every remaining live input unavailable when the active command ends before acknowledgement', async () => {
    const h = harness('claude');
    const remaining = [h.command('next'), h.command('last')];
    h.queue.push(...remaining);
    h.deliver();
    h.base.status = 'completed';
    h.acknowledgements[0]!.resolve(true);
    await flush();

    expect(h.transport).toHaveBeenCalledOnce();
    expect(remaining.map((input) => input.liveDelivery)).toEqual([
      { state: 'unavailable', reason: 'noActiveTurn' },
      { state: 'unavailable', reason: 'noActiveTurn' },
    ]);
    expect(h.queue).toEqual([h.base, ...remaining]);
    expect(h.base.followUps?.map((input) => input.id)).toEqual([h.incoming.id]);
    expect(h.scheduleCheckpoint).toHaveBeenCalledTimes(4);
    expect(h.processNextCommand).toHaveBeenCalledExactlyOnceWith(h.sessionId);
  });

  it.each(['codex', 'claude'] as const)('retains uncertain %s input without replay while delivering later untouched input', async (engine) => {
    const h = harness(engine);
    const next = h.command('next');
    h.queue.push(next);
    h.deliver();
    const rejectedAt = Date.now();
    h.acknowledgements[0]!.reject(new Error('Acknowledgement connection closed'));
    await flush();

    expect(h.incoming.liveDelivery).toEqual({ state: 'uncertain', reason: 'deliveryUnknown', decidedAt: expect.any(Number) });
    expect(h.incoming.liveDelivery!.decidedAt).toBeGreaterThanOrEqual(rejectedAt);
    expect(isLiveFollowUpLocked(h.incoming)).toBe(true);
    expect(h.queue).toContain(h.incoming);
    expect(h.base.followUps).toBeUndefined();
    expect(next.liveDelivery).toEqual({ state: 'sending' });
    expect(h.transport).toHaveBeenCalledTimes(2);
    expect(h.deliver()).toBe(true);
    expect(h.transport).toHaveBeenCalledTimes(2);

    h.acknowledgements[1]!.resolve(true);
    await flush();
    expect(h.queue).toEqual([h.base, h.incoming]);
    expect(h.base.followUps?.map((input) => input.id)).toEqual([next.id]);
    expect(h.deliver()).toBe(true);
    expect(h.transport).toHaveBeenCalledTimes(2);
  });

  it('drains from the current session queue after its array is replaced during a pending send', async () => {
    const h = harness();
    h.deliver();
    const next = h.command('added-after-replacement');
    const replacement = [h.base, h.incoming, next];
    h.commandQueues.set(h.sessionId, replacement);
    h.acknowledgements[0]!.resolve(true);
    await flush();

    expect(replacement).toEqual([h.base, next]);
    expect(next.liveDelivery).toEqual({ state: 'sending' });
    expect(h.transport).toHaveBeenCalledTimes(2);
    h.acknowledgements[1]!.resolve(true);
    await flush();
    expect(replacement).toEqual([h.base]);
    expect(h.base.followUps?.map((input) => input.id)).toEqual([h.incoming.id, next.id]);
  });
});
