import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runCodexAppServerTurn, isCodexAppServerTurnRunning, steerCodexAppServerTurn,
  stopCodexAppServerTurn, noteCodexAppServerActivity, type CodexAppServerTurnArgs,
} from './codexAppServerRunner.js';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), kill: vi.fn(), guard: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('./processTree.js', () => ({ killTree: mocks.kill, processGroupSpawnOptions: () => ({}) }));
vi.mock('./processGuard.js', () => ({ processGuard: { guardChild: mocks.guard } }));
vi.mock('./binLocator.js', () => ({ augmentedEnv: (env: NodeJS.ProcessEnv) => env }));
vi.mock('./claudeCliRun.js', () => ({
  buildCliInvocation: (file: string, args: string[]) => ({ file, args, shell: false }),
}));

interface Message { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown }
class Child extends EventEmitter {
  readonly pid = 928;
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly sent: Message[] = [];
  constructor() { super(); this.stdin.on('data', (chunk: Buffer) => this.sent.push(JSON.parse(chunk.toString()))); }
  send(message: Message): void { this.stdout.write(JSON.stringify(message) + '\n'); }
  notify(method: string, params: Record<string, unknown>): void { this.send({ method, params }); }
  last(method: string): Message {
    const request = this.sent.filter(message => message.method === method).at(-1);
    expect(request, `missing ${method}`).toBeDefined(); return request!;
  }
  reply(method: string, result: unknown): void { this.send({ id: this.last(method).id, result }); }
  complete(status = 'completed'): void {
    this.notify('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status, items: [] } });
  }
}

let sequence = 0;
const fixtures: Array<{ child: Child; args: CodexAppServerTurnArgs }> = [];
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    fixture.child.emit('close', 0);
    stopCodexAppServerTurn(fixture.args.subAgentId);
  }
  await vi.runOnlyPendingTimersAsync(); vi.clearAllTimers(); vi.useRealTimers();
});
async function flush(): Promise<void> { for (let index = 0; index < 6; index++) await Promise.resolve(); }
function setup(overrides: Partial<CodexAppServerTurnArgs> = {}) {
  const child = new Child(); mocks.spawn.mockReturnValue(child);
  const args: CodexAppServerTurnArgs = {
    subAgentId: `native-${++sequence}`, cwd: '/workspace', model: 'model', prompt: 'Fix the app',
    binPath: 'codex', configArgs: ['-c', 'approval_policy="on-request"'], developerInstructions: 'App instructions',
    onDone: vi.fn(), onEvent: vi.fn(), onFileWrites: vi.fn(), onThread: vi.fn(), onUsage: vi.fn(),
    onActivity: vi.fn(), onIdle: vi.fn(), ...overrides,
  };
  fixtures.push({ child, args });
  runCodexAppServerTurn(args, { requestTimeoutMs: 100, shutdownMs: 50, stopSettleTimeoutMs: 20,
    exitDrainMs: 10, idleCheckMs: 5, idleNoticeMs: 15 });
  return { child, args };
}
async function initialize(child: Child, config: Record<string, unknown> = { developer_instructions: 'Native instructions' }): Promise<void> {
  child.reply('initialize', {}); await flush();
  child.reply('config/read', { config }); await flush();
}
async function start(child: Child, resume = false): Promise<void> {
  await initialize(child);
  child.reply(resume ? 'thread/resume' : 'thread/start', { thread: { id: 'thread-1' } }); await flush();
  child.notify('turn/started', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'inProgress', items: [] } });
  child.reply('turn/start', { turn: { id: 'turn-1', status: 'inProgress' } }); await flush();
}

describe('native Codex app-server transport', () => {
  it('uses native configuration, thread and typed user input without replacing base instructions', async () => {
    const { child, args } = setup({ images: ['/image.png'], reasoningEffort: 'high', commandId: 'command-1',
      ownerAgentId: 'agent-1', ownerTermId: 'term-1', env: { VIBISUAL_TOKEN: 'fixture-token' } });
    expect(child.last('initialize').params).toMatchObject({ capabilities: { experimentalApi: true } });
    await start(child);
    expect(child.sent.map(message => message.method)).toEqual(['initialize', 'initialized', 'config/read', 'thread/start', 'turn/start']);
    expect(child.last('config/read').params).toEqual({ cwd: '/workspace', includeLayers: false });
    expect(child.last('thread/start').params).toEqual({ cwd: '/workspace', model: 'model',
      developerInstructions: 'Native instructions\n\nApp instructions' });
    expect(child.last('turn/start').params).toEqual({ threadId: 'thread-1', effort: 'high', clientUserMessageId: 'command-1',
      input: [{ type: 'text', text: 'Fix the app', text_elements: [] }, { type: 'localImage', path: '/image.png' }] });
    expect(mocks.spawn.mock.calls[0]?.[1]).toEqual(['app-server', '-c', 'approval_policy="on-request"']);
    expect(mocks.spawn.mock.calls[0]?.[2].env).toMatchObject({ VIBISUAL_OWNER_AGENT_ID: 'agent-1', VIBISUAL_OWNER_TERM_ID: 'term-1',
      VIBISUAL_CODEX_COMMAND_ID: 'command-1', VIBISUAL_SUBAGENT_ID: args.subAgentId, VIBISUAL_HOOK_AUTH: 'fixture-token' });
    expect(mocks.guard).toHaveBeenCalledWith(child, { parentAgentId: 'agent-1', subAgentId: args.subAgentId }, 'codex', { reapOnExit: false });
    expect(args.onThread).toHaveBeenCalledWith('thread-1');
  });

  it('resumes the same thread and leaves native developer defaults untouched when app context is empty', async () => {
    const { child } = setup({ resumeThreadId: 'thread-1', developerInstructions: '', model: '' });
    await start(child, true);
    expect(child.last('thread/resume').params).toEqual({ threadId: 'thread-1', excludeTurns: true, cwd: '/workspace' });
    expect(child.sent.some(message => message.method === 'thread/start')).toBe(false);
  });

  it('fails closed when effective configuration or resume identity is invalid', async () => {
    const first = setup(); first.child.reply('initialize', {}); await flush();
    first.child.reply('config/read', {}); await flush();
    expect(first.args.onDone).toHaveBeenCalledWith(expect.stringContaining('effective configuration'), '');
    expect(first.child.sent.some(message => message.method === 'thread/start')).toBe(false);
    const second = setup({ resumeThreadId: 'thread-1' }); await initialize(second.child);
    second.child.reply('thread/resume', { thread: { id: 'different-thread' } }); await flush();
    expect(second.args.onDone).toHaveBeenCalledWith(expect.stringContaining('different thread'), '');
    expect(second.child.sent.some(message => message.method === 'turn/start')).toBe(false);
  });

  it('steers the active turn without a second turn or process', async () => {
    const { child, args } = setup(); await start(child);
    const steering = steerCodexAppServerTurn(args.subAgentId, { text: 'Also fix the button', images: ['/button.png'] });
    expect(child.last('turn/steer').params).toEqual({ threadId: 'thread-1', expectedTurnId: 'turn-1', input: [
      { type: 'text', text: 'Also fix the button', text_elements: [] }, { type: 'localImage', path: '/button.png' },
    ] });
    child.reply('turn/steer', {}); expect(await steering).toBe(true);
    expect(mocks.spawn).toHaveBeenCalledOnce(); expect(mocks.kill).not.toHaveBeenCalled();
    expect(child.sent.filter(message => message.method === 'turn/start')).toHaveLength(1);
  });

  it('returns false before an active turn and on explicit steering rejection only', async () => {
    const { child, args } = setup();
    expect(await steerCodexAppServerTurn(args.subAgentId, { text: 'wait' })).toBe(false);
    await start(child);
    const steering = steerCodexAppServerTurn(args.subAgentId, { text: 'follow-up' });
    child.send({ id: child.last('turn/steer').id, error: { code: -32600, message: 'No active turn' } });
    expect(await steering).toBe(false); expect(args.onDone).not.toHaveBeenCalled();
  });

  it('never replays a steer after an ambiguous acknowledgement timeout', async () => {
    const { child, args } = setup(); await start(child);
    const steering = steerCodexAppServerTurn(args.subAgentId, { text: 'follow-up' });
    const rejected = expect(steering).rejects.toThrow('delivery is unknown');
    await vi.advanceTimersByTimeAsync(101); await rejected;
    expect(child.sent.filter(message => message.method === 'turn/steer')).toHaveLength(1);
    expect(mocks.spawn).toHaveBeenCalledOnce(); expect(args.onDone).not.toHaveBeenCalled();
  });

  it('lets the steering caller update its command before a simultaneous completion', async () => {
    const { child, args } = setup(); await start(child);
    const order: string[] = []; vi.mocked(args.onDone).mockImplementation(() => order.push('done'));
    const steering = steerCodexAppServerTurn(args.subAgentId, { text: 'follow-up' }).then(value => { order.push('acknowledged'); return value; });
    child.complete(); expect(args.onDone).not.toHaveBeenCalled();
    child.reply('turn/steer', {}); expect(await steering).toBe(true);
    expect(order).toEqual(['acknowledged']);
    await vi.advanceTimersByTimeAsync(0); expect(order).toEqual(['acknowledged', 'done']);
    expect(isCodexAppServerTurnRunning(args.subAgentId)).toBe(false);
  });

  it('lets an ambiguous steering failure reach the caller before process failure completion', async () => {
    const { child, args } = setup(); await start(child);
    const order: string[] = []; vi.mocked(args.onDone).mockImplementation(() => order.push('done'));
    const steering = steerCodexAppServerTurn(args.subAgentId, { text: 'follow-up' }).catch(() => { order.push('unknown'); });
    child.stdin.emit('error', new Error('EPIPE')); await steering;
    expect(order).toEqual(['unknown']); await vi.advanceTimersByTimeAsync(0); expect(order).toEqual(['unknown', 'done']);
  });

  it('interrupts only when explicitly stopped and bounds a missing interrupt response', async () => {
    const { child, args } = setup(); await start(child);
    expect(stopCodexAppServerTurn(args.subAgentId)).toBe(true);
    expect(child.last('turn/interrupt').params).toEqual({ threadId: 'thread-1', turnId: 'turn-1' });
    expect(mocks.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(21);
    expect(mocks.kill).toHaveBeenCalled(); expect(args.onDone).toHaveBeenCalledExactlyOnceWith(undefined, '');
  });

  it('does not terminate a living turn for quiet compaction or a long tool', async () => {
    const { child, args } = setup(); await start(child);
    await vi.advanceTimersByTimeAsync(1000);
    expect(args.onIdle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ stalled: false }));
    expect(args.onDone).not.toHaveBeenCalled(); expect(mocks.kill).not.toHaveBeenCalled();
    noteCodexAppServerActivity(args.subAgentId); await vi.advanceTimersByTimeAsync(20);
    expect(args.onIdle).toHaveBeenCalledTimes(2);
  });

  it('ignores foreign turn completion and waits for native turn/completed, not assistant text', async () => {
    const { child, args } = setup(); await start(child);
    child.notify('item/completed', { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'message', type: 'agentMessage', text: 'Done', phase: 'final_answer' } });
    expect(args.onDone).not.toHaveBeenCalled();
    child.notify('turn/completed', { threadId: 'thread-1', turn: { id: 'other-turn', status: 'completed', items: [] } });
    child.notify('turn/completed', { threadId: 'other-thread', turn: { id: 'turn-1', status: 'completed', items: [] } });
    expect(args.onDone).not.toHaveBeenCalled(); child.complete();
    expect(args.onDone).toHaveBeenCalledExactlyOnceWith(undefined, 'Done');
    child.emit('exit', 0); child.emit('close', 0); expect(args.onDone).toHaveBeenCalledOnce();
  });

  it('drains a terminal packet after process exit and bounds inherited open pipes', async () => {
    const first = setup(); await start(first.child); first.child.emit('exit', 0);
    expect(first.args.onDone).not.toHaveBeenCalled(); first.child.complete();
    expect(first.args.onDone).toHaveBeenCalledWith(undefined, '');
    const second = setup(); await start(second.child); second.child.emit('exit', 1);
    await vi.advanceTimersByTimeAsync(11);
    expect(second.args.onDone).toHaveBeenCalledWith(expect.stringContaining('exited before turn completion (1)'), '');
    expect(second.child.stdout.destroyed).toBe(true);
  });

  it.each(['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval'])(
    'fails closed for an unconnected interactive responder: %s', async method => {
      const { child, args } = setup(); await start(child);
      child.send({ id: 'server-approval', method, params: {} });
      const response = child.sent.find(message => message.id === 'server-approval');
      if (method === 'item/permissions/requestApproval') expect(response?.result).toEqual({ permissions: {}, scope: 'turn' });
      else if (method.endsWith('/requestApproval')) expect(response?.result).toEqual({ decision: 'cancel' });
      else expect(response?.error).toMatchObject({ code: -32601 });
      expect(args.onDone).toHaveBeenCalledWith(expect.stringContaining('unavailable interactive responder'), '');
      expect(mocks.kill).toHaveBeenCalled();
    },
  );

  it('returns a recoverable tool error for native input without inventing an answer or ending the turn', async () => {
    const { child, args } = setup(); await start(child);
    child.send({ id: 'input', method: 'item/tool/requestUserInput', params: { questions: [] } });
    expect(child.sent.find(message => message.id === 'input')?.error).toMatchObject({ code: -32601,
      message: expect.stringContaining('Vibisual question card') });
    expect(args.onEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'system' }));
    expect(args.onDone).not.toHaveBeenCalled(); expect(mocks.kill).not.toHaveBeenCalled();
    expect(isCodexAppServerTurnRunning(args.subAgentId)).toBe(true);
    child.complete(); expect(args.onDone).toHaveBeenCalledExactlyOnceWith(undefined, '');
  });

  it('bounds initialization and never falls back to another native or exec invocation', async () => {
    const { child, args } = setup(); await vi.advanceTimersByTimeAsync(101);
    expect(args.onDone).toHaveBeenCalledWith(expect.stringContaining('initialize acknowledgement timed out'), '');
    expect(mocks.spawn).toHaveBeenCalledOnce(); expect(child.sent).toHaveLength(1);
  });

  it('closes pending MCP cards on actual failure without a live-call inactivity deadline', async () => {
    const { child, args } = setup(); await start(child);
    child.notify('item/started', { threadId: 'thread-1', turnId: 'turn-1', item: {
      type: 'mcpToolCall', id: 'mcp-1', server: 'fixture', tool: 'wait', arguments: {}, status: 'inProgress',
    } });
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(vi.mocked(args.onEvent).mock.calls.filter(([event]) => event.eventType === 'tool_result')).toHaveLength(0);
    child.emit('close', 1);
    expect(args.onEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'tool_result', toolUseId: 'mcp-1',
      content: expect.stringContaining('turn failed') }));
  });

  it('routes manual compaction to the native API and waits beyond the acknowledgement', async () => {
    const { child, args } = setup({ prompt: '/compact', resumeThreadId: 'thread-1' });
    await initialize(child); child.reply('thread/resume', { thread: { id: 'thread-1' } }); await flush();
    expect(child.last('thread/compact/start').params).toEqual({ threadId: 'thread-1' });
    child.reply('thread/compact/start', {}); await flush();
    expect(args.onDone).not.toHaveBeenCalled(); expect(child.sent.some(message => message.method === 'turn/start')).toBe(false);
    child.notify('turn/started', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'inProgress', items: [] } });
    expect(await steerCodexAppServerTurn(args.subAgentId, { text: 'next task' })).toBe(false);
    child.complete(); expect(args.onDone).toHaveBeenCalledExactlyOnceWith(undefined, '');
  });

  it('publishes the thread identity before native compaction progress', async () => {
    const order: string[] = [];
    const { child } = setup({ onThread: () => order.push('thread'), onProgress: () => order.push('progress') });
    await start(child);
    child.notify('item/started', { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'contextCompaction', id: 'compact-1' } });
    expect(order).toEqual(['thread', 'progress']);
  });

  it('clears caller identity without publishing an unpersisted thread or invoking a process', () => {
    const order: string[] = [];
    const { args } = setup({ prompt: ' /clear ', resumeThreadId: 'old-thread',
      onThreadReset: () => order.push('reset'), onDone: vi.fn(() => order.push('done')) });
    expect(order).toEqual(['reset', 'done']); expect(args.onThread).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(args.onDone).toHaveBeenCalledExactlyOnceWith(undefined, '');
  });

  it('does not create an unpersisted empty thread when there is no history to compact', () => {
    const { args } = setup({ prompt: '/compact' });
    expect(mocks.spawn).not.toHaveBeenCalled(); expect(args.onThread).not.toHaveBeenCalled();
    expect(args.onDone).toHaveBeenCalledExactlyOnceWith(undefined, '');
  });

  it('reports unsupported control arguments without silently dropping them or invoking the model', () => {
    const { args } = setup({ prompt: '/compact keep only files' });
    expect(args.onDone).toHaveBeenCalledWith(expect.stringContaining('does not accept additional instructions'), '');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
