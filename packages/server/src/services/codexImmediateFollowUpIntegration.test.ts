import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig, QueuedCommand } from '@vibisual/shared';
import { subAgentManager } from './subAgentManager.js';
import { isCodexTurnRunning } from './codexRunner.js';
import { killTree } from './processTree.js';

// Keep command ownership, stop/finalization, native RPC and resume behavior real.
// Only subprocess creation and local machine configuration are replaced.
vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(), spawn: vi.fn(),
}));
vi.mock('./codexCli.js', async (original) => ({
  ...await original<typeof import('./codexCli.js')>(), getCodexBin: () => process.execPath,
}));
vi.mock('./codexConfigService.js', async (original) => ({
  ...await original<typeof import('./codexConfigService.js')>(),
  codexWindowsSandboxConfigured: () => true,
  readCodexEffectiveConfigFor: () => ({ layers: [] }),
}));
vi.mock('./binLocator.js', async (original) => ({
  ...await original<typeof import('./binLocator.js')>(), augmentedEnv: (env: NodeJS.ProcessEnv) => env,
}));
vi.mock('./processGuard.js', () => ({ processGuard: { guardChild: vi.fn() } }));
vi.mock('./processTree.js', () => ({ killTree: vi.fn(), processGroupSpawnOptions: () => ({}) }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

interface Packet {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
}

let serial = 0;
class NativeChild extends EventEmitter {
  readonly pid = 991_000 + ++serial;
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly requests: Packet[] = [];
  threadId = '';
  turnId = '';

  constructor() {
    super();
    this.stdin.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().trim().split('\n')) this.requests.push(JSON.parse(line));
    });
  }
  send(packet: Packet): void { this.stdout.write(`${JSON.stringify(packet)}\n`); }
  last(method: string): Packet {
    const packet = this.requests.filter((request) => request.method === method).at(-1);
    expect(packet, `missing native request ${method}`).toBeDefined();
    return packet!;
  }
  reply(method: string, result: unknown): void { this.send({ id: this.last(method).id, result }); }
  answer(text: string): void {
    this.send({ method: 'item/completed', params: { threadId: this.threadId, turnId: this.turnId,
      item: { id: `answer-${this.pid}`, type: 'agentMessage', text, phase: 'final_answer' } } });
  }
  complete(status = 'completed'): void {
    this.send({ method: 'turn/completed', params: { threadId: this.threadId,
      turn: { id: this.turnId, status, items: [] } } });
  }
}

const children: NativeChild[] = [];
const created: string[] = [];
const config = (): AgentConfig => ({
  model: 'opus', tools: [], skills: [], permissionMode: 'auto',
  provider: { kind: 'codex-cli', modelId: 'fixture-model' },
} as AgentConfig);
async function flush(): Promise<void> { for (let index = 0; index < 12; index++) await Promise.resolve(); }

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(killTree).mockClear();
  vi.mocked(spawn).mockReset().mockImplementation(() => {
    const child = new NativeChild();
    children.push(child);
    return child as unknown as ChildProcess;
  });
  subAgentManager.setOnSubStatusChange(() => {});
  subAgentManager.setOnComplete(() => {});
});

afterEach(async () => {
  subAgentManager.setOnComplete(() => {});
  subAgentManager.setOnStreamEvent(() => {});
  for (const child of children.splice(0)) child.emit('close', 0);
  await flush();
  await vi.advanceTimersByTimeAsync(0);
  for (const id of created.splice(0)) subAgentManager.remove(id);
  vi.clearAllTimers();
  vi.useRealTimers();
});

async function activate(child: NativeChild, threadId: string, resume: boolean): Promise<void> {
  child.threadId = threadId;
  child.turnId = `turn-${child.pid}`;
  child.reply('initialize', {}); await flush();
  child.reply('config/read', { config: { developer_instructions: 'Native developer context' } }); await flush();
  const method = resume ? 'thread/resume' : 'thread/start';
  if (resume) expect(child.last(method).params).toMatchObject({ threadId, excludeTurns: true });
  child.reply(method, { thread: { id: threadId } }); await flush();
  child.send({ method: 'turn/started', params: { threadId,
    turn: { id: child.turnId, status: 'inProgress', items: [] } } });
  child.reply('turn/start', { turn: { id: child.turnId, status: 'inProgress' } }); await flush();
}

async function setup(started = true) {
  const sub = subAgentManager.create(`immediate-integration-${++serial}`, `immediate-followup-${serial}`);
  created.push(sub.id);
  const base: QueuedCommand = { id: `base-${serial}`, text: 'Original work',
    timestamp: Date.now(), status: 'queued', subAgentId: sub.id };
  const incoming: QueuedCommand = { id: `follow-${serial}`, text: 'Run this correction now',
    timestamp: Date.now() + 1, status: 'queued', subAgentId: sub.id, dispatchMode: 'immediate',
    attachments: ['C:/fixtures/correction.png'] };
  const queue = [base];
  const archived: QueuedCommand[] = [];
  const execute = (command: QueuedCommand): void => subAgentManager.execute(
    command, process.cwd(), 'Application developer context', config(), 'Live task context', { customParent: true },
  );
  // The real server's completion callback also archives the settled command before
  // dispatching queued work. Execute synchronously to catch old-turn cleanup races.
  const onComplete = vi.fn(() => {
    for (const command of [...queue]) {
      if (command.status === 'completed' || command.status === 'error') {
        archived.push(structuredClone(command));
        queue.splice(queue.indexOf(command), 1);
      }
    }
    const next = queue.find((command) => command.status === 'queued');
    if (next) execute(next);
  });
  subAgentManager.setOnComplete(onComplete);
  execute(base);
  const child = children.at(-1)!;
  const threadId = `thread-${serial}`;
  if (started) await activate(child, threadId, false);
  queue.push(incoming);
  return { sub, base, incoming, queue, archived, onComplete, child, threadId };
}

describe('immediate Codex follow-up interrupts and resumes as a separate command', () => {
  it.each(['acknowledged', 'unresponsive'] as const)('preserves both inputs and resumes after an %s interrupt', async (response) => {
    const run = await setup();
    expect(subAgentManager.stop(run.sub.id)).toBe(true);
    expect(run.child.last('turn/interrupt').params).toEqual({ threadId: run.threadId, turnId: run.child.turnId });
    expect(run.base).toMatchObject({ status: 'executing', text: 'Original work' });
    expect(run.incoming).toMatchObject({ status: 'queued', text: 'Run this correction now' });
    expect(run.queue).toEqual([run.base, run.incoming]);
    expect(run.onComplete).not.toHaveBeenCalled();
    if (response === 'acknowledged') {
      run.child.reply('turn/interrupt', {});
      run.child.complete('interrupted');
      await flush();
    } else {
      await vi.advanceTimersByTimeAsync(3_001);
      expect(killTree).toHaveBeenCalledWith(run.child.pid, process.platform);
    }
    expect(run.archived).toEqual([expect.objectContaining({ id: run.base.id, text: 'Original work',
      status: 'completed', stopReason: 'cancelled', result: '[Stopped by user]' })]);
    expect(run.queue).toEqual([run.incoming]);
    expect(run.incoming.status).toBe('executing');
    expect(run.base.mergedCount).toBeUndefined();
    expect(run.base.attachments).toBeUndefined();
    expect(spawn).toHaveBeenCalledTimes(2);

    const resumed = children.at(-1)!;
    await activate(resumed, run.threadId, true);
    expect(resumed.last('turn/start').params).toMatchObject({ clientUserMessageId: run.incoming.id, input: [
      { type: 'text', text: run.incoming.text, text_elements: [] },
      { type: 'localImage', path: 'C:/fixtures/correction.png' },
    ] });
    expect(children.flatMap((child) => child.requests).some((request) => request.method === 'turn/steer')).toBe(false);

    // The interrupted subprocess may close after the new turn already started.
    run.child.emit('close', 0); await flush();
    expect(run.incoming.status).toBe('executing');
    expect(isCodexTurnRunning(run.sub.id)).toBe(true);
    expect(run.onComplete).toHaveBeenCalledOnce();
    resumed.answer('Correction completed');
    resumed.complete(); await flush();
    expect(run.archived[1]).toMatchObject({ id: run.incoming.id, text: run.incoming.text,
      attachments: run.incoming.attachments, status: 'completed', result: 'Correction completed' });
    expect(run.archived[1]?.stopReason).not.toBe('cancelled');
    expect(run.onComplete).toHaveBeenCalledTimes(2);
    expect(run.queue).toEqual([]);
  });

  it('marks a stop during native initialization on the old command without cancelling its replacement', async () => {
    const run = await setup(false);
    expect(subAgentManager.stop(run.sub.id)).toBe(true);
    await flush();
    expect(run.archived).toEqual([expect.objectContaining({ id: run.base.id, status: 'completed',
      stopReason: 'cancelled', result: '[Stopped by user]' })]);
    expect(run.queue).toEqual([run.incoming]);
    expect(run.incoming.status).toBe('executing');
    const replacement = children.at(-1)!;
    expect(replacement).not.toBe(run.child);
    await activate(replacement, run.threadId, false);
    replacement.answer('Replacement completed');
    replacement.complete(); await flush();
    expect(run.archived[1]).toMatchObject({ id: run.incoming.id, status: 'completed', result: 'Replacement completed' });
    expect(run.archived[1]?.stopReason).not.toBe('cancelled');
    expect(run.onComplete).toHaveBeenCalledTimes(2);
  });
});
