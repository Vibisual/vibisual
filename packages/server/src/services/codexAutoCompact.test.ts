import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCodexTurn } from './codexRunner.js';

vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(),
  spawn: vi.fn(),
}));
vi.mock('./codexCli.js', async (original) => ({
  ...await original<typeof import('./codexCli.js')>(),
  getCodexBin: () => process.execPath,
}));

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
}

let child: FakeChild;
beforeEach(() => {
  child = new FakeChild();
  vi.mocked(spawn).mockReset().mockReturnValue(child as unknown as ChildProcess);
});
afterEach(() => child.emit('close', 0));

// Exercise the real runner: testing buildCodexExecArgs alone missed the dropped setting.
describe.each([undefined, 'existing-thread'])('Codex auto-compaction (resume: %s)', (resumeThreadId) => {
  function launch(autoCompactTokenLimit?: number): readonly string[] {
    runCodexTurn({
      subAgentId: 'codex-auto-compact-test', cwd: process.cwd(), model: 'test-model',
      prompt: 'Test prompt', resumeThreadId, autoCompactTokenLimit,
      onEvent: vi.fn(), onThread: vi.fn(), onUsage: vi.fn(), onFileWrites: vi.fn(), onDone: vi.fn(),
    });
    expect(spawn).toHaveBeenCalledOnce();
    const args = vi.mocked(spawn).mock.calls[0]![1] as readonly string[];
    if (resumeThreadId) expect(args).toContain(resumeThreadId);
    else expect(args).not.toContain('resume');
    return args;
  }

  it('passes the configured threshold to the spawned Codex process', () => {
    const args = launch(90000);
    const index = args.indexOf('model_auto_compact_token_limit=90000');
    expect(index).toBeGreaterThan(0);
    expect(args[index - 1]).toBe('-c');
  });

  it('inherits Codex settings when the app threshold is unset', () => {
    const args = launch();
    expect(args.some((arg) => arg.startsWith('model_auto_compact_token_limit='))).toBe(false);
  });
});
