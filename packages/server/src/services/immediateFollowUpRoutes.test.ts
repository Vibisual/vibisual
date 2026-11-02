import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_COMMAND_DISPATCH_MODE, normalizeAppNodeIds, normalizeCommandDispatchMode,
  type QueuedCommand,
} from '@vibisual/shared';
import { normalizeRunLimits } from './commandRunLimits.js';
import { normalizeExecutionRequirements } from './commandExecutionRequirements.js';
import { prioritizeImmediateFollowUp } from './immediateFollowUpQueue.js';
import { isLiveFollowUpLocked } from './liveFollowUp.js';

// Run the production route callbacks and their interruption helper without
// starting the server or contacting a model, as in commandAttachmentOwnership.
const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');
const source = fs.readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('index.ts', source, ts.ScriptTarget.ES2022, true);
function extract(predicate: (node: import('typescript').Node) => boolean): import('typescript').Node {
  let match: import('typescript').Node | undefined;
  function visit(node: import('typescript').Node): void {
    if (predicate(node)) match = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!match) throw new Error('Missing production follow-up route or helper');
  return match;
}
function route(method: string, url: string): string {
  const node = extract((candidate) => ts.isCallExpression(candidate)
    && candidate.expression.getText(tree) === `app.${method}`
    && !!candidate.arguments[0] && ts.isStringLiteral(candidate.arguments[0])
    && candidate.arguments[0].text === url) as import('typescript').CallExpression;
  return node.arguments[1]!.getText(tree);
}
const interrupt = extract((node) => ts.isFunctionDeclaration(node)
  && node.name?.text === 'interruptForImmediateCommand').getText(tree);
const callbacks = ts.transpileModule(`
  ${interrupt}
  return {
    patch: ${route('patch', '/api/commands/:sessionId/:commandId/mode')},
    post: ${route('post', '/api/commands/:sessionId')},
    delete: ${route('delete', '/api/commands/:sessionId/:commandId')},
    pop: ${route('post', '/api/commands/:sessionId/pop')}
  };
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

type Reply = { status: number; body: { command?: QueuedCommand; interrupted?: boolean; [key: string]: unknown } };
type Response = { status: (code: number) => Response; json: (body: Reply['body']) => void };
type Request = { params: { sessionId: string; commandId?: string }; body: unknown; query: object; get: () => undefined };
type Handler = (req: Request, res: Response) => void;
function command(id: string, overrides: Partial<QueuedCommand> = {}): QueuedCommand {
  return { id, text: `Original ${id}`, timestamp: 1, subAgentId: 'sub-a', status: 'queued', dispatchMode: 'merge', ...overrides };
}

function setup({ processing = true, soft = true, held = false, stopped = true, orchestra = false } = {}) {
  const sessionId = 'session-a';
  const running = command('running', { status: 'executing' });
  const older = command('older');
  const otherSub = command('other-sub', { subAgentId: 'sub-b' });
  const selected = command('selected', { text: 'Stop and do this separately', dispatchMode: 'wait', attachments: ['existing-image.png'] });
  const later = command('later');
  const queue = [running, older, otherSub, selected, later];
  const otherQueue = [command('other-session', { subAgentId: 'sub-other', status: 'executing' })];
  const commandQueues = new Map([['session-a', queue], ['session-other', otherQueue]]);
  const subAgentManager = {
    getSub: () => ({ agentId: 'agent-a' }),
    getPrimarySub: vi.fn(() => undefined),
    create: vi.fn(),
    isSubProcessingCommand: vi.fn(() => processing),
    sealHeldTurnNow: vi.fn(() => held),
    softInterrupt: vi.fn(() => soft),
    stop: vi.fn(() => stopped),
  };
  const scope = {
    commandQueues, prioritizeImmediateFollowUp, subAgentManager, poppedCommands: new Map(),
    settleDispatchCommand: vi.fn(),
    isLiveFollowUpLocked, deliverLiveFollowUp: vi.fn(() => true),
    sealHeirCutByImmediate: vi.fn(() => false),
    logger: { info: vi.fn(), warn: vi.fn() },
    // A live Codex turn must still be interrupted; native steer must never
    // consume the user's queued follow-up in either production route.
    isCodexTurnRunning: vi.fn(() => true),
    steerCodexFollowUp: vi.fn(() => true),
    graphManager: {
      findAgentIdBySession: () => 'agent-a',
      getAgentBySession: () => ({ customCreated: true }),
      getAgentConfig: () => ({ provider: { kind: 'codex-cli' } }),
      getOrchestraRootForAgent: () => orchestra ? process.cwd() : null,
      recordSkillUsageFromCommandText: vi.fn(),
    },
    DEFAULT_COMMAND_DISPATCH_MODE, normalizeCommandDispatchMode, normalizeRunLimits,
    normalizeExecutionRequirements, normalizeAppNodeIds,
    hasForeignSubAgent: () => false, isReadOnlyHookAgent: () => false,
    LOOPBACK_INGRESS_HEADER: 'test-loopback', LOOPBACK_INGRESS_VALUE: '1', orchestraEngineOf: () => 'codex',
    shouldInterceptOrchestra: vi.fn(() => true),
    broadcastSnapshot: vi.fn(), processNextCommand: vi.fn(),
  };
  const handlers = new Function(...Object.keys(scope), callbacks)(...Object.values(scope)) as Record<'patch' | 'post' | 'delete' | 'pop', Handler>;
  function call(method: keyof typeof handlers, body: unknown, commandId = selected.id): Reply {
    let reply: Reply | undefined;
    let status = 200;
    const res: Response = {
      status: (value) => { status = value; return res; },
      json: (result) => { reply = { status, body: result }; },
    };
    handlers[method]({ params: { sessionId, commandId }, body, query: {}, get: () => undefined }, res);
    if (!reply) throw new Error('Route did not respond');
    return reply;
  }
  const patch = (dispatchMode?: unknown, commandId?: string) => call('patch', { dispatchMode }, commandId);
  const post = (dispatchMode?: unknown) => call('post', { text: 'A separate new instruction', subAgentId: 'sub-a', dispatchMode });
  return { ...scope, sessionId, running, older, otherSub, selected, later, queue, otherQueue, patch, post, call };
}

describe('immediate follow-up route semantics', () => {
  it('does not create an orchestra run when posting live input in an orchestra-enabled project', () => {
    const h = setup({ orchestra: true });
    expect(h.post('steer').status).toBe(200);
    expect(h.shouldInterceptOrchestra).not.toHaveBeenCalled();
    expect(h.deliverLiveFollowUp).toHaveBeenCalledOnce();
  });

  it('resolves live input to an existing active session and never spawns a new one', () => {
    const h = setup();
    const reply = h.call('post', { text: 'Apply this here', dispatchMode: 'steer' });
    expect(reply.body.command?.subAgentId).toBe(h.running.subAgentId);
    expect(h.subAgentManager.create).not.toHaveBeenCalled();
    h.queue.length = 0;
    const idleReply = h.call('post', { text: 'No current session', dispatchMode: 'steer' });
    expect(idleReply.body.command?.subAgentId).toBeNull();
    expect(h.subAgentManager.create).not.toHaveBeenCalled();
  });

  it('POST and PATCH steer use only live delivery without interrupting the active turn', () => {
    const h = setup();
    const posted = h.post('steer');
    expect(h.deliverLiveFollowUp).toHaveBeenCalledWith(posted.body.command, h.sessionId);
    expect(h.patch('steer').body.interrupted).toBe(false);
    expect(h.deliverLiveFollowUp).toHaveBeenCalledWith(h.selected, h.sessionId);
    expect(h.subAgentManager.softInterrupt).not.toHaveBeenCalled();
    expect(h.subAgentManager.stop).not.toHaveBeenCalled();
    expect(h.selected.text).toBe('Stop and do this separately');
  });

  it.each(['sending', 'uncertain'] as const)('rejects changing or deleting a %s delivery', (state) => {
    const h = setup();
    h.selected.dispatchMode = 'steer';
    h.selected.liveDelivery = { state };
    expect(h.patch('immediate').status).toBe(409);
    expect(h.call('delete', {}).status).toBe(409);
    expect(h.queue).toContain(h.selected);
    expect(h.subAgentManager.softInterrupt).not.toHaveBeenCalled();
    expect(h.deliverLiveFollowUp).not.toHaveBeenCalled();
  });

  it('retries an unavailable live delivery only after an explicit mode click', () => {
    const h = setup();
    h.selected.dispatchMode = 'steer';
    h.selected.liveDelivery = { state: 'unavailable', reason: 'deliveryRejected' };
    expect(h.patch('steer').status).toBe(200);
    expect(h.selected.liveDelivery).toBeUndefined();
    expect(h.deliverLiveFollowUp).toHaveBeenCalledExactlyOnceWith(h.selected, h.sessionId);
  });

  it.each(['wait', 'merge', 'immediate'] as const)('can explicitly convert an unavailable delivery to %s', (mode) => {
    const h = setup({ processing: false });
    h.selected.dispatchMode = 'steer';
    h.selected.liveDelivery = { state: 'unavailable', reason: 'noActiveTurn' };
    expect(h.patch(mode).status).toBe(200);
    expect(h.selected.liveDelivery).toBeUndefined();
    expect(h.selected.dispatchMode).toBe(mode);
    expect(h.processNextCommand).toHaveBeenCalledOnce();
  });

  it('the legacy pop API never replays live-delivery input as a new turn', () => {
    const h = setup();
    h.selected.dispatchMode = 'steer';
    h.queue.splice(0, h.queue.length, h.selected);
    expect(h.call('pop', {}).body.command).toBeNull();
    expect(h.queue).toEqual([h.selected]);
    h.queue.push(h.later);
    expect(h.call('pop', {}).body.command).toBe(h.later);
    expect(h.queue).toEqual([h.selected]);
  });

  it('PATCH interrupts a live Codex turn while preserving the selected command and all other input', () => {
    const h = setup();
    const before = structuredClone(h.queue);
    const otherBefore = structuredClone(h.otherQueue);
    const reply = h.patch('immediate');

    expect(reply).toEqual({ status: 200, body: { ok: true, command: h.selected, interrupted: true } });
    expect(h.subAgentManager.softInterrupt).toHaveBeenCalledExactlyOnceWith('sub-a');
    expect(h.subAgentManager.stop).not.toHaveBeenCalled();
    expect(h.steerCodexFollowUp).not.toHaveBeenCalled();
    expect(h.processNextCommand).not.toHaveBeenCalled();
    expect(h.queue).toEqual([h.running, h.selected, h.older, h.otherSub, h.later]);
    expect(h.selected).toEqual({ ...before[3], dispatchMode: 'immediate' });
    expect(h.running).toEqual(before[0]);
    expect(h.queue.filter((entry) => entry !== h.selected)).toEqual(before.filter((entry) => entry.id !== h.selected.id));
    expect(h.commandQueues.get('session-other')).toBe(h.otherQueue);
    expect(h.otherQueue).toEqual(otherBefore);
  });

  it.each(['sealHeldTurnNow', 'softInterrupt', 'stop'] as const)('prioritizes the selected command before %s can synchronously dispatch the next turn', (method) => {
    const h = setup({ held: method === 'sealHeldTurnNow', soft: method !== 'stop' });
    let dispatched: QueuedCommand | undefined;
    h.subAgentManager[method].mockImplementation(() => {
      dispatched = h.queue.find((entry) => entry.status === 'queued' && entry.subAgentId === 'sub-a');
      return true;
    });
    expect(h.patch('immediate').body.interrupted).toBe(true);
    expect(dispatched).toBe(h.selected);
    expect(h.processNextCommand).not.toHaveBeenCalled();
  });

  it('falls back to stopping when a soft interrupt cannot be sent', () => {
    const h = setup({ soft: false });
    expect(h.patch('immediate').body.interrupted).toBe(true);
    expect(h.subAgentManager.softInterrupt).toHaveBeenCalledExactlyOnceWith('sub-a');
    expect(h.subAgentManager.stop).toHaveBeenCalledExactlyOnceWith('sub-a');
    expect(h.queue).toContain(h.selected);
    expect(h.selected.status).toBe('queued');
  });

  it('dispatches the prioritized command directly when the session is idle', () => {
    const h = setup({ processing: false });
    expect(h.patch('immediate').body.interrupted).toBe(false);
    expect(h.queue.find((entry) => entry.status === 'queued' && entry.subAgentId === 'sub-a')).toBe(h.selected);
    expect(h.subAgentManager.sealHeldTurnNow).not.toHaveBeenCalled();
    expect(h.subAgentManager.softInterrupt).not.toHaveBeenCalled();
    expect(h.subAgentManager.stop).not.toHaveBeenCalled();
    expect(h.processNextCommand).toHaveBeenCalledExactlyOnceWith(h.sessionId);
  });

  it.each([undefined, 'merge', 'wait'])('PATCH mode %s keeps the current turn and queue order', (mode) => {
    const h = setup();
    const before = [...h.queue];
    expect(h.patch(mode).body.interrupted).toBe(false);
    expect(h.selected.dispatchMode).toBe(mode ?? 'merge');
    expect(h.queue).toEqual(before);
    expect(h.subAgentManager.isSubProcessingCommand).not.toHaveBeenCalled();
    expect(h.subAgentManager.softInterrupt).not.toHaveBeenCalled();
    expect(h.subAgentManager.stop).not.toHaveBeenCalled();
    expect(h.steerCodexFollowUp).not.toHaveBeenCalled();
    expect(h.processNextCommand).not.toHaveBeenCalled();
  });

  it('rejects missing or already running commands without interrupting anything', () => {
    const h = setup();
    expect(h.patch('immediate', 'missing').status).toBe(404);
    expect(h.patch('immediate', h.running.id).status).toBe(409);
    expect(h.subAgentManager.isSubProcessingCommand).not.toHaveBeenCalled();
    expect(h.running.dispatchMode).toBe('merge');
  });

  it('POST immediate keeps a new command distinct and interrupts before it starts', () => {
    const h = setup();
    const before = structuredClone(h.queue);
    const otherBefore = structuredClone(h.otherQueue);
    const reply = h.post('immediate');
    const submitted = reply.body.command!;
    expect(reply.status).toBe(200);
    expect(submitted).toMatchObject({ text: 'A separate new instruction', status: 'queued', dispatchMode: 'immediate', subAgentId: 'sub-a' });
    expect(submitted.id).not.toBe(h.running.id);
    expect(h.queue).toEqual([h.running, submitted, h.older, h.otherSub, h.selected, h.later]);
    expect(h.queue.filter((entry) => entry !== submitted)).toEqual(before);
    expect(h.otherQueue).toEqual(otherBefore);
    expect(h.subAgentManager.softInterrupt).toHaveBeenCalledExactlyOnceWith('sub-a');
    expect(h.steerCodexFollowUp).not.toHaveBeenCalled();
    expect(h.processNextCommand).not.toHaveBeenCalled();
  });

  it.each([undefined, 'merge', 'wait'])('POST mode %s queues a distinct input without interrupting or steering', (mode) => {
    const h = setup();
    const before = structuredClone(h.queue);
    const submitted = h.post(mode).body.command!;
    expect(h.queue.slice(0, -1)).toEqual(before);
    expect(h.queue.at(-1)).toBe(submitted);
    expect(submitted.dispatchMode).toBe(mode ?? 'merge');
    expect(submitted.status).toBe('queued');
    expect(h.subAgentManager.isSubProcessingCommand).not.toHaveBeenCalled();
    expect(h.subAgentManager.softInterrupt).not.toHaveBeenCalled();
    expect(h.subAgentManager.stop).not.toHaveBeenCalled();
    expect(h.steerCodexFollowUp).not.toHaveBeenCalled();
    expect(h.processNextCommand).toHaveBeenCalledExactlyOnceWith(h.sessionId);
  });
});
