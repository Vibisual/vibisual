import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueuedCommand, SubAgent } from '@vibisual/shared';
import { SubAgentManager } from './subAgentManager.js';
import { terminateChildTree } from './processTree.js';
import { apiCreditService } from './apiCreditService.js';

vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(), spawn: vi.fn(),
}));
vi.mock('./claudeBin.js', async (original) => ({
  ...await original<typeof import('./claudeBin.js')>(),
  getClaudeBin: () => ({ binPath: 'fixture-claude', source: 'path' }),
  claudeSpawnEnv: (env: NodeJS.ProcessEnv) => env,
}));
vi.mock('./processGuard.js', () => ({ processGuard: { guardChild: vi.fn() } }));
vi.mock('./processTree.js', async (original) => ({
  ...await original<typeof import('./processTree.js')>(), terminateChildTree: vi.fn(),
  forceCloseAfterExit: vi.fn(), processGroupSpawnOptions: () => ({}),
}));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

class Child extends EventEmitter {
  readonly pid = 990_001;
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly messages: Record<string, unknown>[] = [];
  readonly exitCode = null;
  readonly signalCode = null;
  constructor() {
    super();
    this.stdin.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().trim().split('\n')) this.messages.push(JSON.parse(line));
    });
  }
  send(message: Record<string, unknown>): void { this.stdout.write(`${JSON.stringify(message)}\n`); }
  model(text = 'Continuing the same task'): void {
    this.send({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
  }
}

interface Internals {
  currentTurnId: Map<string, string>;
  persistentInFlightCmd: Map<string, { cmd: QueuedCommand }>;
  _executeViaLegacy(command: QueuedCommand, sub: SubAgent, cwd: string, prompt: string,
    config: string[], maxTurns: number, maxBudgetUsd?: number): void;
}
const fixtures: Array<{ manager: SubAgentManager; sub: SubAgent; child: Child }> = [];
let serial = 0;
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(spawn).mockReset();
  vi.mocked(terminateChildTree).mockClear();
});
afterEach(async () => {
  for (const { manager, sub, child } of fixtures.splice(0)) {
    manager.setOnComplete(() => {});
    child.emit('close', 0);
    await vi.advanceTimersByTimeAsync(0);
    manager.remove(sub.id);
  }
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup(maxBudgetUsd = 0) {
  const child = new Child();
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
  const manager = new SubAgentManager();
  const sub = manager.create(`claude-live-${++serial}`);
  const base: QueuedCommand = { id: `base-${serial}`, text: 'Original task', timestamp: Date.now(),
    startedAt: Date.now(), status: 'executing', subAgentId: sub.id };
  const internals = manager as unknown as Internals;
  internals.currentTurnId.set(sub.id, base.id);
  const onComplete = vi.fn();
  manager.setOnComplete(onComplete);
  manager.setOnSubStatusChange(() => {});
  internals._executeViaLegacy(base, sub, process.cwd(), base.text, [], 0, maxBudgetUsd);
  fixtures.push({ manager, sub, child });
  child.send({ type: 'system', subtype: 'init', session_id: `session-${serial}` });
  child.model();
  const input = { id: `follow-${serial}`, text: '추가 조건을 반영해 주세요', attachments: ['C:/fixtures/design.png'] };
  const replay = () => child.send({ type: 'user', isReplay: true, uuid: child.messages.at(-1)?.uuid,
    parent_tool_use_id: null, session_id: sub.sessionId });
  return { child, manager, sub, base, internals, onComplete, input, replay };
}

describe('Claude live follow-up manager wiring', () => {
  it('injects input without interrupting, overwriting ownership, or replacing the original prompt', async () => {
    const run = setup();
    const args = vi.mocked(spawn).mock.calls[0]?.[1];
    expect(args).toContain('--replay-user-messages');
    expect(run.manager.canSendLiveFollowUp(run.sub.id)).toBe(true);
    const owner = run.internals.persistentInFlightCmd.get(run.sub.id);
    const delivered = run.manager.sendLiveFollowUp(run.sub.id, run.input);
    expect(run.child.messages.at(-1)).toMatchObject({ type: 'user', priority: 'next' });
    expect(run.internals.persistentInFlightCmd.get(run.sub.id)).toBe(owner);
    expect(run.internals.currentTurnId.get(run.sub.id)).toBe(run.base.id);
    expect(run.base).toMatchObject({ text: 'Original task', status: 'executing' });
    expect(run.base.attachments).toBeUndefined();
    expect(run.child.messages.some((message) => message.type === 'control_request')).toBe(false);
    expect(terminateChildTree).not.toHaveBeenCalled();
    expect(run.onComplete).not.toHaveBeenCalled();
    run.replay();
    await expect(delivered).resolves.toBe(true);
    expect(run.onComplete).not.toHaveBeenCalled();

    run.child.send({ type: 'result', subtype: 'success', result: 'Original task plus additional condition',
      queued_turn_count: 0, user_message_uuids: [run.child.messages.at(-1)?.uuid] });
    await vi.advanceTimersByTimeAsync(0);
    expect(run.onComplete).toHaveBeenCalledOnce();
    expect(run.base).toMatchObject({ status: 'completed', text: 'Original task', result: 'Original task plus additional condition' });
    expect(run.manager.canSendLiveFollowUp(run.sub.id)).toBe(false);
  });

  // §5.5 #17-18 ⑫ — input sent during a long thought is dequeued well after the 30 s receipt bound.
  it('confirms receipt from the queued lifecycle line and delivers when Claude dequeues it minutes later', async () => {
    const run = setup();
    const onReceived = vi.fn();
    const outcome = vi.fn();
    const delivered = run.manager.sendLiveFollowUp(run.sub.id, run.input, onReceived);
    void delivered.then(() => outcome('delivered'), () => outcome('unknown'));
    const uuid = run.child.messages.at(-1)?.uuid;
    run.child.send({ type: 'command_lifecycle', command_uuid: uuid, state: 'queued', uuid: 'line-1', session_id: run.sub.sessionId });
    await vi.advanceTimersByTimeAsync(0);
    expect(onReceived).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(107_000);
    expect(outcome).not.toHaveBeenCalled();
    expect(run.onComplete).not.toHaveBeenCalled();
    expect(run.base.status).toBe('executing');

    run.replay();
    run.child.send({ type: 'command_lifecycle', command_uuid: uuid, state: 'started', uuid: 'line-2', session_id: run.sub.sessionId });
    await expect(delivered).resolves.toBe(true);
    run.child.model('Applying the additional condition');
    run.child.send({ type: 'result', subtype: 'success', result: 'Applied', queued_turn_count: 0, user_message_uuids: [uuid] });
    await vi.advanceTimersByTimeAsync(0);
    expect(run.onComplete).toHaveBeenCalledOnce();
    expect(run.base).toMatchObject({ status: 'completed', result: 'Applied' });
  });

  it('keeps the active app command across a result emitted before the live input was received', async () => {
    const run = setup();
    const delivered = run.manager.sendLiveFollowUp(run.sub.id, run.input);
    run.child.send({ type: 'result', subtype: 'success', result: 'Old result', queued_turn_count: 0 });
    run.replay(); await delivered;
    await vi.advanceTimersByTimeAsync(0);
    expect(run.onComplete).not.toHaveBeenCalled();
    expect(run.base.status).toBe('executing');
    run.child.model('Picking up the additional condition');
    expect(run.internals.currentTurnId.get(run.sub.id)).toBe(run.base.id);
    run.child.send({ type: 'result', subtype: 'success', result: 'Updated result', queued_turn_count: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(run.onComplete).toHaveBeenCalledOnce();
    expect(run.base.result).toBe('Updated result');
  });

  it('reports uncertain receipt before closing the command and does not resend it after process exit', async () => {
    const run = setup();
    const order: string[] = [];
    run.manager.setOnComplete(() => order.push('completed'));
    const pending = run.manager.sendLiveFollowUp(run.sub.id, run.input).catch(() => order.push('unconfirmed'));
    run.child.emit('close', 1);
    await pending;
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['unconfirmed', 'completed']);
    expect(run.base.status).toBe('error');
    expect(run.child.messages).toHaveLength(2);
    await expect(run.manager.sendLiveFollowUp(run.sub.id, run.input)).resolves.toBe(false);
  });

  it('records usage and stop metadata from a provisional result even when the final result omits them', async () => {
    const run = setup();
    const delivered = run.manager.sendLiveFollowUp(run.sub.id, run.input);
    run.child.send({ type: 'result', subtype: 'success', result: 'Provisional answer', queued_turn_count: 1,
      total_input_tokens: 1200, total_output_tokens: 300, stop_reason: 'max_tokens' });
    expect(run.sub.totalInputTokens).toBe(1200);
    expect(run.sub.totalOutputTokens).toBe(300);
    expect(run.base.status).toBe('executing');
    expect(run.base.result).toBeUndefined();
    expect(run.onComplete).not.toHaveBeenCalled();

    run.replay();
    await delivered;
    run.child.model('Processing the queued addition');
    run.child.send({ type: 'result', subtype: 'success', result: 'Updated answer', queued_turn_count: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(run.onComplete).toHaveBeenCalledOnce();
    expect(run.base).toMatchObject({ status: 'completed', result: 'Updated answer', stopReason: 'max_tokens' });
    expect(run.sub.totalInputTokens).toBe(1200);
    expect(run.sub.totalOutputTokens).toBe(300);
  });

  it('preserves a provisional result usage limit when the child exits before another result arrives', async () => {
    const noteLimit = vi.spyOn(apiCreditService, 'noteSubscriptionLimit').mockImplementation(() => {});
    const run = setup();
    const pending = run.manager.sendLiveFollowUp(run.sub.id, run.input).catch(() => false);
    run.child.send({ type: 'result', subtype: 'error_during_execution', is_error: true,
      result: "You've hit your session limit", queued_turn_count: 1, total_input_tokens: 1500, total_output_tokens: 400 });
    expect(run.sub.usageLimit).toMatchObject({ kind: 'session', message: "You've hit your session limit" });
    expect(noteLimit).toHaveBeenCalledOnce();
    expect(run.onComplete).not.toHaveBeenCalled();

    run.child.emit('close', 1);
    await expect(pending).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(run.base.status).toBe('error');
    expect(run.sub.usageLimit).toMatchObject({ kind: 'session', message: "You've hit your session limit" });
    expect(run.sub.totalInputTokens).toBe(1500);
    expect(run.sub.totalOutputTokens).toBe(400);
    expect(noteLimit).toHaveBeenCalledOnce();
  });

  it('keeps explicit immediate interruption available while a live receipt is pending', async () => {
    const run = setup();
    const order: string[] = [];
    run.manager.setOnComplete(() => order.push('completed'));
    const pending = run.manager.sendLiveFollowUp(run.sub.id, run.input).catch(() => order.push('unconfirmed'));
    expect(run.manager.softInterrupt(run.sub.id)).toBe(true);
    expect(run.child.messages.at(-1)).toMatchObject({ type: 'control_request', request: { subtype: 'interrupt' } });
    expect(run.manager.canSendLiveFollowUp(run.sub.id)).toBe(false);
    run.child.send({ type: 'result', subtype: 'success', result: 'Interrupted' });
    await pending;
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['unconfirmed', 'completed']);
    expect(run.base.status).toBe('completed');
    expect(run.base.text).toBe('Original task');
    expect(run.child.messages.filter((message) => message.type === 'user')).toHaveLength(2);
    expect(terminateChildTree).not.toHaveBeenCalled();
  });

  it('does not claim live delivery for a one-shot Claude process or after its stdin closes', async () => {
    const once = setup(1);
    expect(once.manager.canSendLiveFollowUp(once.sub.id)).toBe(false);
    await expect(once.manager.sendLiveFollowUp(once.sub.id, once.input)).resolves.toBe(false);
    expect(once.child.messages).toHaveLength(1);
    const persistent = setup();
    persistent.child.stdin.end();
    expect(persistent.manager.canSendLiveFollowUp(persistent.sub.id)).toBe(false);
    await expect(persistent.manager.sendLiveFollowUp(persistent.sub.id, persistent.input)).resolves.toBe(false);
    expect(persistent.child.messages).toHaveLength(1);
  });
});
