import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachCodexTurn, isCodexTurnRunning, stopCodexTurn } from './codexRunner.js';

class Child extends EventEmitter {
  pid = 123;
  stdin = new Writable({ write(_chunk, _encoding, done) { setImmediate(() => done(new Error('EPIPE'))); } });
  stdout = new PassThrough();
  stderr = new PassThrough();
}
function attach(child: Child, id: string, options: Parameters<typeof attachCodexTurn>[2] = {}) {
  const done = vi.fn(); const kill = vi.fn();
  attachCodexTurn(child as unknown as ChildProcess, { subAgentId: id, onEvent: vi.fn(), onThread: vi.fn(),
    onUsage: vi.fn(), onFileWrites: vi.fn(), onDone: done }, { ...options, killTree: kill });
  return { done, kill };
}
afterEach(() => vi.useRealTimers());

describe('Codex stdio failure settles the owning turn', () => {
  it('handles an actual asynchronous stdin write error and settles only once', async () => {
    const child = new Child(); const h = attach(child, 'stdio-failure');
    child.stdin.write('prompt');
    await new Promise<void>((resolve) => child.stdin.once('close', resolve));
    expect(h.done).toHaveBeenCalledExactlyOnceWith('codex stdin failed: EPIPE', '');
    expect(h.kill).toHaveBeenCalledExactlyOnceWith(child.pid);
    expect(isCodexTurnRunning('stdio-failure')).toBe(false);
    child.emit('close', 1); child.stderr.emit('error', new Error('late'));
    expect(h.done).toHaveBeenCalledTimes(1);
  });

  it('does not reinterpret a stopped turn as failure when its pipe closes', () => {
    const child = new Child(); const h = attach(child, 'stdio-stopped');
    stopCodexTurn('stdio-stopped'); child.stdin.emit('error', new Error('EOF'));
    expect(h.done).not.toHaveBeenCalled();
    child.emit('close', 1); expect(h.done).toHaveBeenCalledExactlyOnceWith(undefined, '');
    expect(h.kill).toHaveBeenCalledTimes(1);
  });

  it('retains the stop deadline, retry kill and pipe cleanup after a queued write error', async () => {
    vi.useFakeTimers();
    const child = new Child(); const h = attach(child, 'stdio-stop-timeout', { stopSettleTimeoutMs: 40 });
    stopCodexTurn('stdio-stop-timeout'); child.stdin.emit('error', new Error('EPIPE'));
    expect(h.done).not.toHaveBeenCalled();
    expect(isCodexTurnRunning('stdio-stop-timeout')).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(h.kill).toHaveBeenCalledTimes(2);
    expect(h.done).toHaveBeenCalledExactlyOnceWith(undefined, '');
    expect(child.stdout.destroyed).toBe(true); expect(child.stderr.destroyed).toBe(true);
    expect(isCodexTurnRunning('stdio-stop-timeout')).toBe(false);
  });

  it('uses exit settlement and flushes the buffered final answer after a stop pipe error', async () => {
    vi.useFakeTimers();
    const child = new Child(); const h = attach(child, 'stdio-stop-exit', { stopSettleTimeoutMs: 5000 });
    child.stdout.write('{"type":"item.completed","item":{"id":"1","type":"agent_message","text":"done"}}');
    stopCodexTurn('stdio-stop-exit'); child.stdin.emit('error', new Error('EPIPE')); child.emit('exit', 0);
    await vi.advanceTimersByTimeAsync(10);
    expect(h.done).toHaveBeenCalledExactlyOnceWith(undefined, 'done');
    expect(h.kill).toHaveBeenCalledTimes(1);
    expect(child.stdout.destroyed).toBe(true); expect(child.stderr.destroyed).toBe(true);
    child.emit('close', 0); expect(h.done).toHaveBeenCalledTimes(1);
  });

  it('preserves a successful completion that closes stdin before a pending write finishes', () => {
    const child = new Child(); const h = attach(child, 'stdio-completed');
    child.stdout.write('{"type":"item.completed","item":{"id":"1","type":"agent_message","text":"done"}}\n{"type":"turn.completed"}\n');
    child.stdin.emit('error', new Error('EOF')); child.emit('close', 0);
    expect(h.done).toHaveBeenCalledExactlyOnceWith(undefined, 'done');
    expect(h.kill).not.toHaveBeenCalled();
  });

  it('late errors from an old child cannot erase a replacement with the same session id', () => {
    const old = new Child(); const first = attach(old, 'stdio-reused');
    old.stdin.emit('error', new Error('EOF'));
    const replacement = new Child(); const second = attach(replacement, 'stdio-reused');
    old.stderr.emit('error', new Error('late')); old.emit('close', 1);
    expect(isCodexTurnRunning('stdio-reused')).toBe(true);
    expect(first.done).toHaveBeenCalledTimes(1); expect(second.done).not.toHaveBeenCalled();
    replacement.emit('close', 0);
  });
});
