import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig, QueuedCommand } from '@vibisual/shared';
import { subAgentManager } from './subAgentManager.js';
import { isCodexTurnRunning, isCodexAppServerTurnRunning, steerCodexAppServerTurn } from './codexRunner.js';
import { isLiveFollowUpPending, trySendLiveFollowUp } from './liveFollowUp.js';

// Only the process/configuration boundaries are replaced. The manager, runner,
// RPC parser, native event mapper and queue acknowledgement path remain real.
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
  error?: { code: number; message: string };
}

class NativeChild extends EventEmitter {
  readonly pid = 990_001;
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly requests: Packet[] = [];

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
  message(id: string, text: string, phase: string): void {
    this.send({ method: 'item/completed', params: { threadId: 'native-thread', turnId: 'native-turn',
      item: { id, type: 'agentMessage', text, phase } } });
  }
  complete(): void {
    this.send({ method: 'turn/completed', params: { threadId: 'native-thread',
      turn: { id: 'native-turn', status: 'completed', items: [] } } });
  }
}

const children: NativeChild[] = [];
const created: string[] = [];
let serial = 0;
const config = (): AgentConfig => ({
  model: 'opus', tools: [], skills: [], permissionMode: 'auto',
  provider: { kind: 'codex-cli', modelId: 'fixture-model' },
} as AgentConfig);

async function flush(): Promise<void> { for (let index = 0; index < 12; index++) await Promise.resolve(); }

beforeEach(() => {
  vi.useFakeTimers();
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

async function start() {
  const sub = subAgentManager.create(`native-integration-${++serial}`, `native-followup-${serial}`);
  created.push(sub.id);
  const base: QueuedCommand = { id: `base-${serial}`, text: 'Fix the button and verify it',
    timestamp: Date.now(), status: 'queued', subAgentId: sub.id };
  const queue = [base];
  const archived: QueuedCommand[] = [];
  const stream = vi.fn();
  const onComplete = vi.fn(() => archived.push(structuredClone(base)));
  const onChange = vi.fn();
  const onSettled = vi.fn();
  subAgentManager.setOnComplete(onComplete);
  subAgentManager.setOnStreamEvent(stream);
  subAgentManager.execute(base, process.cwd(), 'Application developer context', config(), 'Live task context', { customParent: true });
  const child = children.at(-1)!;
  expect(child).toBeDefined();
  const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1] as string[] | undefined;
  expect(spawnArgs?.[0]).toBe('app-server');
  child.reply('initialize', {}); await flush();
  child.reply('config/read', { config: { developer_instructions: 'Native developer context' } }); await flush();
  child.reply('thread/start', { thread: { id: 'native-thread' } }); await flush();
  child.send({ method: 'turn/started', params: { threadId: 'native-thread', turn: { id: 'native-turn', status: 'inProgress', items: [] } } });
  child.reply('turn/start', { turn: { id: 'native-turn', status: 'inProgress' } }); await flush();
  expect(sub.sessionId).toBe('native-thread');
  expect(base.status).toBe('executing');
  const options = { getQueue: () => queue, canSend: isCodexAppServerTurnRunning,
    send: (id: string, input: { text: string; attachments?: string[] }) => steerCodexAppServerTurn(id, { text: input.text, images: input.attachments }),
    onChange, onReceived: () => {}, onSettled };
  const followUp = (text: string, attachments?: string[]): QueuedCommand => {
    const command: QueuedCommand = { id: `follow-${++serial}`, text, timestamp: Date.now(), subAgentId: sub.id,
      status: 'queued', dispatchMode: 'steer', ...(attachments ? { attachments } : {}) };
    queue.push(command);
    return command;
  };
  return { sub, base, queue, child, archived, stream, onComplete, onChange, onSettled, options, followUp };
}

describe('native Codex follow-up through the real command manager', () => {
  it.each([undefined, 'merge', 'wait', 'immediate'] as const)('preserves a %s follow-up until explicitly switched to steer', async (dispatchMode) => {
    const run = await start();
    const originalText = run.base.text;
    const incoming = run.followUp('Keep this follow-up visible');
    incoming.dispatchMode = dispatchMode;

    expect(trySendLiveFollowUp(incoming, run.options)).toBe(false);
    await flush();
    expect(run.queue).toEqual([run.base, incoming]);
    expect(incoming.status).toBe('queued');
    expect(isLiveFollowUpPending(incoming.id)).toBe(false);
    expect(run.base.text).toBe(originalText);
    expect(run.child.requests.some((request) => request.method === 'turn/steer')).toBe(false);
    expect(run.onComplete).not.toHaveBeenCalled();

    incoming.dispatchMode = 'steer';
    expect(trySendLiveFollowUp(incoming, run.options)).toBe(true);
    run.child.reply('turn/steer', {}); await flush();
    expect(run.queue).toEqual([run.base]);
    expect(run.base).toMatchObject({ status: 'executing', text: originalText,
      followUps: [expect.objectContaining({ id: incoming.id, text: incoming.text })] });
    expect(run.child.requests.filter((request) => request.method === 'turn/steer')).toHaveLength(1);
    expect(run.child.requests.some((request) => request.method === 'turn/interrupt')).toBe(false);
  });

  it('keeps commentary and accepted follow-ups in one active command, including completion racing an acknowledgement', async () => {
    const run = await start();
    const originalId = run.base.id;
    run.child.message('progress', 'I found the affected code; implementing the fix next.', 'commentary');
    expect(run.stream).toHaveBeenCalledWith(expect.objectContaining({ turnId: originalId, eventType: 'text', content: expect.stringContaining('implementing') }));
    expect(run.base.status).toBe('executing');
    expect(run.base.result).toBeUndefined();
    expect(subAgentManager.isSubProcessingCommand(run.sub.id)).toBe(true);
    expect(run.onComplete).not.toHaveBeenCalled();

    const first = run.followUp('Use the attached design', ['C:/fixtures/button.png']);
    expect(trySendLiveFollowUp(first, run.options)).toBe(true);
    expect(run.child.last('turn/steer').params).toMatchObject({ expectedTurnId: 'native-turn', input: [
      { type: 'text', text: first.text }, { type: 'localImage', path: 'C:/fixtures/button.png' },
    ] });
    run.child.reply('turn/steer', {}); await flush();
    expect(run.queue).toEqual([run.base]);
    expect(run.base).toMatchObject({ id: originalId, status: 'executing',
      followUps: [expect.objectContaining({ id: first.id, text: first.text, attachments: first.attachments })] });
    expect(run.base.mergedCount).toBeUndefined();
    expect(run.base.attachments).toBeUndefined();
    expect(run.onComplete).not.toHaveBeenCalled();

    const second = run.followUp('Include the keyboard case');
    expect(trySendLiveFollowUp(second, run.options)).toBe(true);
    run.child.message('final', 'Implemented and verified both cases.', 'final_answer');
    run.child.complete();
    expect(run.onComplete).not.toHaveBeenCalled();
    expect(run.base.status).toBe('executing');
    expect(isLiveFollowUpPending(second.id)).toBe(true);
    run.child.reply('turn/steer', {}); await flush();
    expect(run.base.text).toBe('Fix the button and verify it');
    expect(run.base.followUps?.map((message) => message.text)).toEqual([first.text, second.text]);
    expect(run.onComplete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(run.onComplete).toHaveBeenCalledOnce();
    expect(run.archived).toEqual([expect.objectContaining({ id: originalId, text: run.base.text, followUps: run.base.followUps,
      status: 'completed', result: 'Implemented and verified both cases.' })]);
    expect(run.queue).toEqual([run.base]);
    expect(isCodexTurnRunning(run.sub.id)).toBe(false);
    expect(run.sub.status).toBe('idle');
    expect(spawn).toHaveBeenCalledOnce();
    expect(run.child.requests.filter((request) => request.method === 'turn/start')).toHaveLength(1);
    expect(run.child.requests.some((request) => request.method === 'turn/interrupt')).toBe(false);
  });

  it('keeps a rejected follow-up visible awaiting an explicit user choice', async () => {
    const run = await start();
    const originalText = run.base.text;
    const incoming = run.followUp('Check the keyboard case too');
    expect(trySendLiveFollowUp(incoming, run.options)).toBe(true);
    run.child.send({ id: run.child.last('turn/steer').id, error: { code: -32600, message: 'No active turn' } });
    await flush();
    expect(run.onSettled).toHaveBeenCalledOnce();
    expect(incoming.liveDelivery).toEqual({ state: 'unavailable', reason: 'deliveryRejected' });
    expect(isLiveFollowUpPending(incoming.id)).toBe(false);
    expect(incoming.status).toBe('queued');
    expect(run.base.text).toBe(originalText);
    expect(run.onComplete).not.toHaveBeenCalled();
    run.child.message('final', 'Original task completed.', 'final_answer');
    run.child.complete();
    expect(run.archived).toEqual([expect.objectContaining({ id: run.base.id, text: originalText, status: 'completed' })]);
    expect(run.queue).toEqual([run.base, incoming]);
    expect(incoming.status).toBe('queued');
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('surfaces an unknown delivery without replay or interruption while the original work continues', async () => {
    const run = await start();
    const originalText = run.base.text;
    const incoming = run.followUp('Apply the additional change');
    expect(trySendLiveFollowUp(incoming, run.options)).toBe(true);
    await vi.advanceTimersByTimeAsync(30_001);
    expect(run.onSettled).toHaveBeenCalledOnce();
    expect(incoming).toMatchObject({ status: 'queued', liveDelivery: { state: 'uncertain', reason: 'deliveryUnknown' } });
    expect(run.base).toMatchObject({ text: originalText, status: 'executing' });
    expect(run.onComplete).not.toHaveBeenCalled();
    expect(isCodexTurnRunning(run.sub.id)).toBe(true);
    expect(trySendLiveFollowUp(incoming, run.options)).toBe(true);
    run.child.message('continuing', 'The original fix is still in progress.', 'commentary');
    expect(run.onComplete).not.toHaveBeenCalled();
    run.child.message('final', 'Original fix completed.', 'final_answer');
    run.child.complete();
    expect(run.archived).toEqual([expect.objectContaining({ id: run.base.id, text: originalText, result: 'Original fix completed.' })]);
    expect(run.child.requests.filter((request) => request.method === 'turn/steer')).toHaveLength(1);
    expect(run.child.requests.filter((request) => request.method === 'turn/start')).toHaveLength(1);
    expect(spawn).toHaveBeenCalledOnce();
  });
});
