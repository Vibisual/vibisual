import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { observePtyTransportErrors } from './ptyTransportErrors';

describe('node-pty transport error compatibility', () => {
  it('observes the separate Windows input socket asynchronous error', async () => {
    const input = new Writable({ write(_chunk, _encoding, done) { setImmediate(() => done(new Error('EPIPE'))); } });
    const terminal = Object.assign(new EventEmitter(), { _agent: { inSocket: input } });
    const report = vi.fn(); observePtyTransportErrors(terminal, report);
    input.write('prompt');
    await new Promise<void>((resolve) => input.once('close', resolve));
    expect(report).toHaveBeenCalledWith('input', expect.objectContaining({ message: 'EPIPE' }));
    expect(() => input.emit('error', new Error('late'))).not.toThrow();
  });

  it('adds the external output observer required by node-pty before its error is emitted', () => {
    const terminal = new EventEmitter(); const report = vi.fn();
    terminal.on('error', (error) => { if (terminal.listenerCount('error') < 2) throw error; });
    observePtyTransportErrors(terminal, report);
    expect(() => terminal.emit('error', new Error('EIO'))).not.toThrow();
    expect(report).toHaveBeenCalledWith('output', expect.objectContaining({ message: 'EIO' }));
  });

  it.each(['linux', 'darwin', 'win32'] as const)('leaves normal EIO closure to node-pty exit on %s', (platform) => {
    const terminal = new EventEmitter(); const report = vi.fn();
    observePtyTransportErrors(terminal, report, platform);
    for (const code of ['EIO', 'read EIO', 'errno 5']) {
      expect(() => terminal.emit('error', Object.assign(new Error('closed'), { code }))).not.toThrow();
    }
    expect(report).not.toHaveBeenCalled();
  });

  it.each(['linux', 'darwin'] as const)('preserves transient POSIX EAGAIN on %s', (platform) => {
    const terminal = new EventEmitter(); const report = vi.fn();
    // node-pty's internal return does not prevent subsequent socket listeners.
    terminal.on('error', () => {});
    observePtyTransportErrors(terminal, report, platform);
    terminal.emit('error', Object.assign(new Error('try again'), { code: 'EAGAIN' }));
    expect(report).not.toHaveBeenCalled();
  });

  it('does not suppress Windows output EAGAIN or input errors with benign output codes', () => {
    const input = new EventEmitter(); const terminal = Object.assign(new EventEmitter(), { _agent: { inSocket: input } });
    const report = vi.fn(); observePtyTransportErrors(terminal, report, 'win32');
    terminal.emit('error', Object.assign(new Error('retry'), { code: 'EAGAIN' }));
    expect(report).toHaveBeenCalledWith('output', expect.objectContaining({ code: 'EAGAIN' }));
    for (const code of ['EAGAIN', 'EIO', 'errno 5', 'EPIPE']) {
      input.emit('error', Object.assign(new Error('input failed'), { code }));
      expect(report).toHaveBeenLastCalledWith('input', expect.objectContaining({ code }));
    }
  });

  it.each([undefined, null, {}, { _agent: {} }, { _agent: { inSocket: {} } }])('tolerates absent Windows internals %j', (value) => {
    expect(() => observePtyTransportErrors(value, vi.fn())).not.toThrow();
  });
});
