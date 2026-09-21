import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createMainDiagnostics } from './mainDiagnostics';

describe('main diagnostics contain their own failures', () => {
  it('records to disk before publishing or touching a broken console', () => {
    const order: string[] = [];
    const diagnostics = createMainDiagnostics({
      persist: () => { order.push('disk'); },
      publish: () => { order.push('publish'); throw new Error('destroyed renderer'); },
      console: () => { order.push('console'); throw new Error('EPIPE'); },
    });
    expect(() => diagnostics.report('uncaughtException', new Error('original'))).not.toThrow();
    diagnostics.report('unhandledRejection', 'next');
    expect(order).toEqual(['disk', 'publish', 'console', 'disk', 'publish']);
  });

  it.each(['EPIPE', 'EOF', 'ECONNRESET'])('contains asynchronous %s on stdout/stderr once per stream', (code) => {
    const persist = vi.fn(); const publish = vi.fn(); const mirror = vi.fn();
    const diagnostics = createMainDiagnostics({ persist, publish, console: mirror });
    const out = new EventEmitter(); const err = new EventEmitter();
    const dispose = diagnostics.guardStreams(out, err);
    for (let i = 0; i < 3; i += 1) {
      expect(() => out.emit('error', Object.assign(new Error(code), { code }))).not.toThrow();
      expect(() => err.emit('error', Object.assign(new Error(code), { code }))).not.toThrow();
    }
    expect(persist).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(mirror).not.toHaveBeenCalled();
    diagnostics.report('unhandledRejection', 'later error');
    expect(persist).toHaveBeenCalledTimes(3);
    expect(mirror).not.toHaveBeenCalled();
    dispose();
    expect(out.listenerCount('error')).toBe(0);
    expect(err.listenerCount('error')).toBe(0);
  });

  it('avoids recursive reports and still allows a later independent error', () => {
    const persist = vi.fn();
    const diagnostics = createMainDiagnostics({
      persist,
      publish: () => diagnostics.report('uncaughtException', 'recursive sink'),
      console: vi.fn(),
    });
    diagnostics.report('uncaughtException', 'first');
    diagnostics.report('unhandledRejection', 'second');
    expect(persist.mock.calls.map(([message]) => message)).toEqual(['uncaughtException: first', 'unhandledRejection: second']);
  });

  it('contains disk failure and hostile error serialization', () => {
    const publish = vi.fn();
    const diagnostics = createMainDiagnostics({
      persist: () => { throw new Error('disk full'); }, publish, console: vi.fn(),
    });
    const value = { toString(): string { throw new Error('conversion failed'); } };
    expect(() => diagnostics.report('unhandledRejection', value)).not.toThrow();
    expect(publish).toHaveBeenCalledWith('unhandledRejection: Unprintable error value', undefined);
  });
});
