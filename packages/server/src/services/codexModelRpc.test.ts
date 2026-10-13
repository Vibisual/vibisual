import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryCodexModelList } from './codexModelRpc.js';
import { CODEX_MODEL_DISCOVERY } from './codexModelRpcConfig.js';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), killTree: vi.fn() }));
vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(), spawn: mocks.spawn,
}));
vi.mock('./processTree.js', async (original) => ({
  ...await original<typeof import('./processTree.js')>(), killTree: mocks.killTree,
}));
vi.mock('./binLocator.js', async (original) => ({
  ...await original<typeof import('./binLocator.js')>(), augmentedEnv: (env: NodeJS.ProcessEnv) => env,
}));

class Probe extends EventEmitter {
  readonly pid = 456;
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly sent: Array<{ id?: number; method: string; params?: Record<string, unknown> }> = [];
  readonly kill = vi.fn();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  constructor() {
    super();
    this.stdin.on('data', (chunk: Buffer) => this.sent.push(JSON.parse(chunk.toString())));
  }
  exit(): void { this.exitCode = 0; this.emit('exit', 0); }
  reply(id: number, result: unknown): void { this.stdout.write(JSON.stringify({ id, result }) + '\n'); }
}

beforeEach(() => { vi.useFakeTimers(); mocks.spawn.mockReset(); mocks.killTree.mockReset(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

function fixture(exitOnKill = true): Probe {
  const child = new Probe();
  mocks.spawn.mockReturnValue(child);
  if (exitOnKill) mocks.killTree.mockImplementation(() => child.exit());
  return child;
}

describe('Codex official catalog subprocess', () => {
  it.each(['win32', 'darwin', 'linux'] as const)('initializes, pages and cleans up on %s without inference', async (platform) => {
    const child = fixture();
    const result = queryCodexModelList('codex', '/codex-home', { platform });
    expect(child.sent.map((m) => m.method)).toEqual(['initialize']);
    child.reply(1, { userAgent: 'fixture' });
    expect(child.sent.map((m) => m.method)).toEqual(['initialize', 'initialized', 'model/list']);
    child.reply(2, { data: [{ model: 'first', isDefault: true }], nextCursor: 'page-2' });
    expect(child.sent.at(-1)?.params).toEqual({ limit: 100, includeHidden: false, cursor: 'page-2' });
    child.reply(3, { data: [{ model: 'second' }, { model: 'hidden', hidden: true }], nextCursor: null });
    expect((await result).map((m) => m.slug)).toEqual(['first', 'second']);
    const options = mocks.spawn.mock.calls[0]?.[2];
    expect(options.windowsHide).toBe(true);
    expect(options.env.CODEX_HOME).toBe('/codex-home');
    expect(options.detached).toBe(platform === 'win32' ? undefined : true);
    expect(mocks.killTree).toHaveBeenCalledWith(child.pid, platform);
    expect(child.stdout.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out and settles when neither exit nor close arrives', async () => {
    const child = fixture(false);
    const result = queryCodexModelList('codex', '/home', { timeoutMs: 20, shutdownMs: 10 });
    const rejected = expect(result).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(30);
    await rejected;
    expect(child.kill).toHaveBeenCalledOnce();
    expect(child.stdin.destroyed && child.stdout.destroyed && child.stderr.destroyed).toBe(true);
  });

  it.each(['stdin', 'stdout', 'stderr'] as const)('handles asynchronous %s errors', async (stream) => {
    const child = fixture();
    const result = queryCodexModelList('codex', '/home');
    const rejected = expect(result).rejects.toThrow('stream failed');
    child[stream].emit('error', new Error('private diagnostics'));
    await rejected;
    child[stream].emit('error', new Error('late pipe error'));
    expect(child.stdout.destroyed).toBe(true);
  });

  it('rejects initialization errors without exposing RPC diagnostics', async () => {
    const child = fixture();
    const result = queryCodexModelList('codex', '/home');
    const rejected = expect(result).rejects.toThrow('Codex model catalog request failed');
    child.stdout.write(JSON.stringify({ id: 1, error: { message: 'private diagnostics' } }) + '\n');
    await rejected;
    expect(child.sent.map((m) => m.method)).toEqual(['initialize']);
  });

  it('rejects cyclic pagination instead of publishing a partial list', async () => {
    const child = fixture();
    const result = queryCodexModelList('codex', '/home');
    const rejected = expect(result).rejects.toThrow('pagination did not finish');
    child.reply(1, {});
    child.reply(2, { data: [{ model: 'partial' }], nextCursor: 'repeat' });
    child.reply(3, { data: [], nextCursor: 'repeat' });
    await rejected;
  });

  it('bounds unreadable output before it can grow without limit', async () => {
    const child = fixture();
    const result = queryCodexModelList('codex', '/home');
    const rejected = expect(result).rejects.toThrow('output too large');
    child.stdout.write(Buffer.alloc(CODEX_MODEL_DISCOVERY.maxOutputBytes + 1, 'x'));
    await rejected;
  });

  it('rejects spawn failure and premature exit', async () => {
    mocks.spawn.mockImplementationOnce(() => { throw new Error('spawn failed'); });
    await expect(queryCodexModelList('codex', '/home')).rejects.toThrow('spawn failed');
    const child = fixture();
    const result = queryCodexModelList('codex', '/home');
    const rejected = expect(result).rejects.toThrow('exited before completion');
    child.exit();
    await rejected;
    expect(child.stdout.destroyed).toBe(true);
  });
});
