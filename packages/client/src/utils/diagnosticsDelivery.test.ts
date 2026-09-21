import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('renderer diagnostics delivery isolation', () => {
  const originalError = console.error;
  const originalWarn = console.warn;

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('window', new EventTarget());
    console.error = vi.fn();
    console.warn = vi.fn();
  });

  afterEach(() => {
    console.error = originalError;
    console.warn = originalWarn;
    vi.unstubAllGlobals();
  });

  it('keeps failed reports in order and retries after reconnect without throwing', async () => {
    const diagnostics = await import('./diagnostics.js');
    diagnostics.installRendererDiagnostics();
    const broken = vi.fn(() => { throw new Error('IPC unavailable'); });
    diagnostics.setDiagnosticsSender(broken);
    expect(() => console.error('첫 오류 日本語 😀')).not.toThrow();
    expect(() => console.warn('second')).not.toThrow();
    expect(broken).toHaveBeenCalledTimes(1);
    const received: string[] = [];
    diagnostics.setDiagnosticsSender((message) => { received.push(message.payload.message); });
    expect(received).toEqual(['첫 오류 日本語 😀', 'second']);
  });

  it('bounds the offline queue and flushes each remaining report once', async () => {
    const diagnostics = await import('./diagnostics.js');
    diagnostics.installRendererDiagnostics();
    for (let i = 0; i < 120; i += 1) console.warn(`warning ${i}`);
    const received: string[] = [];
    const deliver = (message: { payload: { message: string } }): void => { received.push(message.payload.message); };
    diagnostics.setDiagnosticsSender(deliver);
    diagnostics.setDiagnosticsSender(deliver);
    expect(received).toHaveLength(100);
    expect(received[0]).toBe('warning 20');
    expect(received[99]).toBe('warning 119');
  });

  it('contains cyclic values, BigInt and hostile conversions without losing later messages', async () => {
    const diagnostics = await import('./diagnostics.js');
    diagnostics.installRendererDiagnostics();
    const received: string[] = [];
    diagnostics.setDiagnosticsSender((message) => { received.push(message.payload.message); });
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const hostile = { toJSON() { throw new Error('bad json'); }, toString() { throw new Error('bad string'); } };
    expect(() => console.error(circular, BigInt(42), hostile)).not.toThrow();
    console.warn('العربية हिन्दी e\u0301 👩‍💻 <>&"');
    expect(received[0]).toContain('42 [Unprintable diagnostic value]');
    expect(received[1]).toBe('العربية हिन्दी e\u0301 👩‍💻 <>&"');
  });

  it('does not recurse when a sender logs and preserves reports after disconnect during delivery', async () => {
    const diagnostics = await import('./diagnostics.js');
    diagnostics.installRendererDiagnostics();
    console.error('one');
    console.error('two');
    const received: string[] = [];
    diagnostics.setDiagnosticsSender((message) => {
      received.push(message.payload.message);
      console.error('sender log');
      diagnostics.setDiagnosticsSender(null);
    });
    expect(received).toEqual(['one']);
    diagnostics.setDiagnosticsSender((message) => { received.push(message.payload.message); });
    expect(received).toEqual(['one', 'two']);
  });

  it('accepts non-Error throws and non-string promise rejections', async () => {
    const diagnostics = await import('./diagnostics.js');
    diagnostics.installRendererDiagnostics();
    const received: string[] = [];
    diagnostics.setDiagnosticsSender((message) => { received.push(message.payload.message); });
    const thrown = Object.assign(new Event('error'), { error: { message: 42 }, message: 'Uncaught object' });
    const rejection = Object.assign(new Event('unhandledrejection'), { reason: BigInt(42) });
    expect(() => window.dispatchEvent(thrown)).not.toThrow();
    expect(() => window.dispatchEvent(rejection)).not.toThrow();
    expect(received).toEqual(['Uncaught object', 'Unhandled rejection: 42']);
  });
});
