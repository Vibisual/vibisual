import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { observeChildStreamErrors } from './childStreamErrors.js';

describe('child stdio errors have their own event boundary', () => {
  it('handles a later writable callback error even though write itself returned normally', async () => {
    const failure = Object.assign(new Error('closed pipe'), { code: 'EPIPE' });
    const stdin = new Writable({ write(_chunk, _encoding, done) { setImmediate(() => done(failure)); } });
    const report = vi.fn();
    observeChildStreamErrors({ stdin } as ChildProcess, report);
    expect(() => stdin.write('한글😀')).not.toThrow();
    expect(report).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => stdin.once('close', resolve));
    expect(report).toHaveBeenCalledWith('stdin', failure);
  });

  it.each(['stdin', 'stdout', 'stderr'] as const)('keeps the %s observer after operation teardown', async (name) => {
    const stream = new PassThrough(); const report = vi.fn();
    observeChildStreamErrors({ [name]: stream } as unknown as ChildProcess, report);
    stream.destroy(new Error('first transport failure'));
    await new Promise<void>((resolve) => stream.once('close', resolve));
    expect(() => stream.emit('error', new Error('late completion'))).not.toThrow();
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('survives a real child closing its input pipe before a large write', async () => {
    const child = spawn(process.execPath, ['-e',
      "require('node:fs').closeSync(0);process.stdout.write('READY');setTimeout(()=>{},150)",
    ], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const failures: string[] = [];
    observeChildStreamErrors(child, (name, error) => failures.push(`${name}:${(error as NodeJS.ErrnoException).code}`));
    const closed = once(child, 'close');
    try {
      await once(child.stdout!, 'data');
      expect(() => child.stdin!.write(Buffer.alloc(4 * 1024 * 1024))).not.toThrow();
      await closed;
      // Windows reports EOF here; POSIX generally reports EPIPE. Both belong to this pipe.
      expect(failures.some((failure) => /^stdin:(EOF|EPIPE|ECONNRESET|ERR_STREAM_DESTROYED)$/.test(failure))).toBe(true);
    } finally { if (child.exitCode === null) child.kill(); }
  });
});
