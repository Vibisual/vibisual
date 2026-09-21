import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { spawnBackground } from './claudeAgentViewService.js';

const mock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async (importOriginal) => ({ ...await importOriginal<typeof import('node:child_process')>(), spawn: mock.spawn }));
vi.mock('./claudeBin.js', () => ({ getClaudeBin: () => ({ binPath: 'test-claude' }), noteClaudeSpawnFailure: vi.fn() }));

describe('background launcher stdio error', () => {
  it.each(['stdin', 'stdout', 'stderr'] as const)('rejects only its launch operation for %s errors', async (name) => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    mock.spawn.mockReturnValueOnce(child);
    const result = spawnBackground('', [], process.cwd());
    const rejected = expect(result).rejects.toThrow(`claude --bg ${name} failed: transport closed`);
    child[name].destroy(new Error('transport closed'));
    await rejected;
    expect(child.kill).toHaveBeenCalledTimes(1);
    child.emit('close', 1);
    expect(() => child[name].emit('error', new Error('late'))).not.toThrow();
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});
