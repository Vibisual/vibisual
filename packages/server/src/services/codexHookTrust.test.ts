import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareCodexHooks } from './codexHookTrust.js';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), killTree: vi.fn() }));
vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(), spawn: mocks.spawn,
}));
vi.mock('./processTree.js', async (original) => ({
  ...await original<typeof import('./processTree.js')>(), killTree: mocks.killTree,
}));
vi.mock('./binLocator.js', async (original) => ({
  ...await original<typeof import('./binLocator.js')>(), augmentedEnv: () => ({}),
}));

class Probe extends EventEmitter {
  readonly pid = 123;
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  exit(): void { this.exitCode = 0; this.emit('exit', 0); }
  respond(trustStatus: string): void {
    this.stdout.write(JSON.stringify({ id: 2, result: { data: [{ hooks: [{
      command: 'app-owned-hook', eventName: 'preToolUse', enabled: true,
      key: 'app-hook', currentHash: 'hash', trustStatus,
    }] }] } }) + '\n');
  }
}

function start(controller: AbortController): Promise<string[]> {
  return prepareCodexHooks('test-codex', process.cwd(), [], [
    { command: 'app-owned-hook', eventName: 'preToolUse' },
  ], controller.signal);
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.spawn.mockReset();
  mocks.killTree.mockReset();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('Codex hook preparation has a bounded, cancellable child lifecycle', () => {
  it('stop settles when the child exits even if inherited pipes never close', async () => {
    const child = new Probe();
    mocks.spawn.mockReturnValue(child);
    const controller = new AbortController();
    const settled = vi.fn();
    void start(controller).then(settled, settled);
    controller.abort();
    child.exit();
    await vi.advanceTimersByTimeAsync(0);

    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ message: 'Codex hook preparation cancelled' }));
    expect(child.stdout.destroyed).toBe(true);
    expect(mocks.killTree).toHaveBeenCalledTimes(1);
  });

  it('inspection timeout still settles if neither exit nor close ever arrives', async () => {
    mocks.spawn.mockReturnValue(new Probe());
    const settled = vi.fn();
    void start(new AbortController()).then(settled, settled);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ message: 'Codex hook inspection timed out' }));
  });

  it('an already cancelled preparation never spawns another inspection child', async () => {
    mocks.spawn.mockReturnValue(new Probe());
    const controller = new AbortController();
    controller.abort();
    const settled = vi.fn();
    void start(controller).then(settled, settled);
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.spawn.mock.calls.length).toBe(0);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('both successful hook checks advance on exit and retain verified trust', async () => {
    const first = new Probe();
    const second = new Probe();
    mocks.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const settled = vi.fn();
    void start(new AbortController()).then(settled, settled);
    first.respond('untrusted');
    first.exit();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);

    second.respond('trusted');
    second.exit();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledExactlyOnceWith(['-c', 'hooks.state={"app-hook"={trusted_hash="hash"}}']);
    second.emit('close', 0);
    expect(settled).toHaveBeenCalledTimes(1);
  });
});
