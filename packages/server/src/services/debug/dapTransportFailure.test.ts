import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { debugSessionManager } from './debugSessionManager.js';

const mock = vi.hoisted(() => ({ spawn: vi.fn(), broadcast: vi.fn(), connect: vi.fn() }));
vi.mock('node:child_process', async (importOriginal) => ({ ...await importOriginal<typeof import('node:child_process')>(), spawn: mock.spawn }));
vi.mock('../../broadcastBus.js', () => ({ broadcast: mock.broadcast }));
vi.mock('../processChecker.js', () => ({ isPortAlive: async () => false }));
vi.mock('node:net', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:net')>();
  return { ...original, default: { ...original, connect: mock.connect } };
});
beforeEach(() => vi.clearAllMocks());

function adapter(blockCommand?: string) {
  const stdout = new PassThrough();
  const stdin = new Writable({ write(chunk, _encoding, done) {
    const request = JSON.parse(String(chunk).split('\r\n\r\n')[1]!);
    done();
    if (request.command === blockCommand) return;
    const body = JSON.stringify({ type: 'response', request_seq: request.seq, success: true, body: {} });
    queueMicrotask(() => stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`));
  } });
  return Object.assign(new EventEmitter(), { stdin, stdout, stderr: new PassThrough(), kill: vi.fn() });
}
function events(runId: string) {
  return mock.broadcast.mock.calls.map(([message]) => message.payload).filter((payload) => payload.state?.runId === runId);
}

describe('DAP stdio lifecycle failure', () => {
  it('rejects pending initialize and ends only the adapter session on async stdin error', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new Writable({ write(_chunk, _encoding, done) { setImmediate(() => done(new Error('EPIPE'))); } }),
      stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
    });
    mock.spawn.mockReturnValueOnce(child);
    const start = debugSessionManager.start({ runId: 'transport-failure', runtime: 'python', projectPath: process.cwd(), port: 1 });
    const state = debugSessionManager.findByRun('transport-failure');
    await expect(start).rejects.toThrow('session-closed');
    expect(debugSessionManager.findByRun('transport-failure')).toBeNull();
    expect(child.kill).toHaveBeenCalledTimes(1);
    const messages = mock.broadcast.mock.calls.map(([message]) => message);
    expect(messages.filter((message) => message.payload.kind === 'terminated')).toHaveLength(1);
    expect(messages.some((message) => message.payload.state.error === 'adapter stdin: EPIPE')).toBe(true);
    child.emit('exit', 1);
    expect(() => child.stdin.emit('error', new Error('late'))).not.toThrow();
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(state?.status).toBe('ended');
    expect(state?.error).toBe('adapter stdin: EPIPE');
    expect(events('transport-failure').map((event) => event.kind)).toEqual(['state', 'terminated']);
  });

  it('cannot resurrect a session whose transport fails during configurationDone', async () => {
    const child = adapter('configurationDone'); mock.spawn.mockReturnValueOnce(child);
    const start = debugSessionManager.start({ runId: 'finalize-failure', runtime: 'python', projectPath: process.cwd(), port: 1 });
    const rejected = expect(start).rejects.toThrow('session-closed');
    await new Promise<void>((resolve) => setImmediate(resolve));
    child.stdout.emit('error', new Error('read failed'));
    await rejected;
    expect(debugSessionManager.findByRun('finalize-failure')).toBeNull();
    expect(events('finalize-failure').map((event) => event.state.status)).toEqual(['connecting', 'ended']);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('a late old-child error cannot terminate the replacement for the same run', async () => {
    const old = adapter('initialize'); mock.spawn.mockReturnValueOnce(old);
    const first = debugSessionManager.start({ runId: 'reused-run', runtime: 'python', projectPath: process.cwd(), port: 1 });
    const rejected = expect(first).rejects.toThrow('session-closed');
    old.stdin.emit('error', new Error('old pipe')); await rejected;
    const current = adapter(); mock.spawn.mockReturnValueOnce(current);
    const replacement = await debugSessionManager.start({ runId: 'reused-run', runtime: 'python', projectPath: process.cwd(), port: 1 });
    old.emit('exit', 1); old.stderr.emit('error', new Error('late'));
    expect(debugSessionManager.findByRun('reused-run')).toBe(replacement);
    expect(replacement.status).toBe('running'); expect(current.kill).not.toHaveBeenCalled();
    expect(events('reused-run').filter((event) => event.kind === 'terminated')).toHaveLength(1);
    await debugSessionManager.stop(replacement.sessionId);
  });

  it('reports termination once when the transport fails during an explicit disconnect', async () => {
    const child = adapter('disconnect'); mock.spawn.mockReturnValueOnce(child);
    const state = await debugSessionManager.start({ runId: 'disconnect-failure', runtime: 'python', projectPath: process.cwd(), port: 1 });
    const stopped = debugSessionManager.stop(state.sessionId);
    child.stdin.emit('error', new Error('disconnect pipe')); await stopped;
    child.emit('exit', 0);
    expect(events('disconnect-failure').filter((event) => event.kind === 'terminated')).toHaveLength(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect a TCP adapter after its already established connection fails', async () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    const socket = new PassThrough();
    mock.spawn.mockReturnValueOnce(child);
    mock.connect.mockImplementation(() => {
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    });
    const start = debugSessionManager.start({ runId: 'tcp-failure', runtime: 'go', projectPath: process.cwd(), port: 1 });
    const rejected = expect(start).rejects.toThrow('session-closed');
    await new Promise<void>((resolve) => setImmediate(resolve));
    socket.destroy(new Error('ECONNRESET'));
    await rejected;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(mock.connect).toHaveBeenCalledTimes(1);
    expect(debugSessionManager.findByRun('tcp-failure')).toBeNull();
    expect(() => socket.emit('error', new Error('late'))).not.toThrow();
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});
