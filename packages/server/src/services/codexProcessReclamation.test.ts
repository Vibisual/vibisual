import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachCodexTurn, isCodexTurnRunning, type CodexTurnLifecycleOptions } from './codexRunner.js';
import { killTree, processGroupSpawnOptions } from './processTree.js';

const ANSWER = '{"type":"item.completed","item":{"id":"answer","type":"agent_message","text":"done"}}\n';
const COMPLETED = '{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":3}}\n';

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  constructor(readonly pid: number) { super(); }
  asChild(): ChildProcess { return this as unknown as ChildProcess; }
}

const children: FakeChild[] = [];
let sequence = 0;
function attach(options: CodexTurnLifecycleOptions = {}) {
  const id = `codex-reclamation-${++sequence}`;
  const child = new FakeChild(8000 + sequence);
  children.push(child);
  const done = vi.fn();
  const kill = vi.fn();
  const thread = vi.fn();
  const usage = vi.fn();
  const event = vi.fn();
  attachCodexTurn(child.asChild(), {
    subAgentId: id, onEvent: event, onThread: thread, onUsage: usage,
    onFileWrites: vi.fn(), onDone: done,
  }, { ...options, killTree: kill });
  return { id, child, done, kill, thread, usage, event };
}

afterEach(() => {
  for (const child of children.splice(0)) child.emit('close', 0);
  vi.useRealTimers();
});

describe('Codex completed process reclamation', () => {
  it('allows normal shutdown and preserves the thread used to resume later', async () => {
    vi.useFakeTimers();
    const h = attach();
    h.child.stdout.write('{"type":"thread.started","thread_id":"persisted-thread"}\n' + ANSWER + COMPLETED);
    await vi.advanceTimersByTimeAsync(4900);
    expect(h.kill).not.toHaveBeenCalled();
    expect(h.done).not.toHaveBeenCalled();
    h.child.emit('exit', 0);
    h.child.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.thread).toHaveBeenCalledExactlyOnceWith('persisted-thread');
    expect(h.usage).toHaveBeenCalledOnce();
    expect(h.done).toHaveBeenCalledExactlyOnceWith(undefined, 'done');
    expect(h.kill).not.toHaveBeenCalled();
    expect(isCodexTurnRunning(h.id)).toBe(false);
  });

  it('reclaims a completed process within a bounded deadline even with continuing output', async () => {
    vi.useFakeTimers();
    const h = attach();
    h.child.stdout.write(ANSWER + COMPLETED);
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      h.child.stderr.write('shutdown heartbeat\n');
      h.child.stdout.write(COMPLETED); // duplicate completion must not extend the grace
    }
    await vi.advanceTimersByTimeAsync(10);
    expect(h.kill).toHaveBeenCalledExactlyOnceWith(h.child.pid);
    expect(h.done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3010);
    expect(h.kill).toHaveBeenCalledTimes(2);
    expect(h.done).toHaveBeenCalledExactlyOnceWith(undefined, 'done');
    expect(isCodexTurnRunning(h.id)).toBe(false);
    for (const stream of [h.child.stdin, h.child.stdout, h.child.stderr]) expect(stream.destroyed).toBe(true);
    expect(h.child.stdout.listenerCount('data')).toBe(0);
    expect(h.child.stderr.listenerCount('data')).toBe(0);
    h.child.emit('exit', 1);
    h.child.emit('close', 1);
    h.child.stderr.emit('error', new Error('late EPIPE'));
    expect(h.done).toHaveBeenCalledTimes(1);
  });

  it('preserves successful completion when reclamation causes an error exit or pipe error', async () => {
    vi.useFakeTimers();
    const h = attach({ completionExitGraceMs: 50 });
    h.child.stdout.write(ANSWER + COMPLETED);
    h.kill.mockImplementation(() => {
      h.child.stderr.emit('error', new Error('EOF'));
      h.child.emit('exit', 1);
    });
    await vi.advanceTimersByTimeAsync(70);
    expect(h.kill).toHaveBeenCalledTimes(1);
    expect(h.done).toHaveBeenCalledExactlyOnceWith(undefined, 'done');
  });

  it('preserves the actual failure when a failed turn needs reclamation', async () => {
    vi.useFakeTimers();
    const h = attach({ completionExitGraceMs: 50 });
    h.child.stdout.write('{"type":"turn.failed","error":{"message":"quota exceeded"}}\n');
    h.kill.mockImplementation(() => { h.child.emit('exit', 1); h.child.emit('close', 1); });
    await vi.advanceTimersByTimeAsync(70);
    expect(h.done).toHaveBeenCalledExactlyOnceWith('quota exceeded', '');
    expect(h.kill).toHaveBeenCalledTimes(1);
  });

  it('does not arm reclamation for quiet reasoning, running tools, or an approval wait', async () => {
    vi.useFakeTimers();
    const h = attach({ completionExitGraceMs: 50 });
    h.child.stdout.write('{"type":"turn.started"}\n' +
      '{"type":"item.started","item":{"id":"cmd","type":"command_execution","command":"long-build","status":"in_progress"}}\n');
    h.child.stderr.write('waiting for approval\n');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.kill).not.toHaveBeenCalled();
    expect(h.done).not.toHaveBeenCalled();
    expect(isCodexTurnRunning(h.id)).toBe(true);
  });

  it('releases inherited pipes after normal exit without close and flushes a final partial line', async () => {
    vi.useFakeTimers();
    const h = attach({ exitCloseGraceMs: 50 });
    h.child.stdout.write(ANSWER.trimEnd());
    h.child.emit('exit', 0);
    await vi.advanceTimersByTimeAsync(70);
    expect(h.done).toHaveBeenCalledExactlyOnceWith(undefined, 'done');
    expect(h.kill).not.toHaveBeenCalled();
    for (const stream of [h.child.stdin, h.child.stdout, h.child.stderr]) expect(stream.destroyed).toBe(true);
    expect(h.child.stdout.listenerCount('data')).toBe(0);
  });

  it('does not kill an exited PID when expiry and exit occur on the same event loop turn', async () => {
    vi.useFakeTimers();
    const h = attach({ completionExitGraceMs: 50, exitCloseGraceMs: 10 });
    h.child.stdout.write(ANSWER + COMPLETED);
    vi.advanceTimersByTime(50); // queues the completion setImmediate
    h.child.emit('exit', 0);
    await vi.advanceTimersByTimeAsync(30);
    expect(h.kill).not.toHaveBeenCalled();
    expect(h.done).toHaveBeenCalledExactlyOnceWith(undefined, 'done');
  });

  it('actually terminates a completed child that would otherwise keep running', async () => {
    const id = `codex-reclamation-real-${++sequence}`;
    const child = spawn(process.execPath, ['-e',
      `process.stdout.write(${JSON.stringify(ANSWER + COMPLETED)}); setInterval(() => {}, 60000);`,
    ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, ...processGroupSpawnOptions() });
    let deadline: NodeJS.Timeout | undefined;
    try {
      const result = await new Promise<{ error: string | undefined; text: string }>((resolve, reject) => {
        deadline = setTimeout(() => reject(new Error('completed child was not reclaimed')), 10_000);
        attachCodexTurn(child, {
          subAgentId: id, onEvent: vi.fn(), onThread: vi.fn(), onUsage: vi.fn(), onFileWrites: vi.fn(),
          onDone: (error, text) => resolve({ error, text }),
        }, { completionExitGraceMs: 50 });
      });
      expect(result).toEqual({ error: undefined, text: 'done' });
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      expect(isCodexTurnRunning(id)).toBe(false);
      expect(child.stdout.destroyed).toBe(true);
    } finally {
      clearTimeout(deadline);
      if (child.exitCode === null && child.signalCode === null) killTree(child.pid);
    }
  }, 15_000);
});
