import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('diagnostic notification failure isolation', () => {
  let callbacks: Array<() => void>;
  beforeEach(() => {
    vi.resetModules();
    callbacks = [];
    vi.stubGlobal('queueMicrotask', (callback: () => void) => { callbacks.push(callback); });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('does not throw or retry forever when broadcast fails', async () => {
    const { diagnosticService: service } = await import('./diagnosticService.js');
    service.setOnChange(() => { throw new Error('destroyed webContents'); });
    service.record({ source: 'server', level: 'error', message: 'original failure' });
    expect(callbacks).toHaveLength(1);
    expect(() => callbacks.shift()?.()).not.toThrow();
    expect(callbacks).toHaveLength(0);
    expect(service.getLog().map((entry) => entry.message)).toEqual(['original failure', 'Diagnostic update delivery failed']);
    service.record({ source: 'server', level: 'warn', message: 'another failure' });
    callbacks.shift()?.();
    expect(callbacks).toHaveLength(0);
    expect(service.getLog().filter((entry) => entry.message === 'Diagnostic update delivery failed')).toHaveLength(1);
  });

  it('retains nested diagnostics without scheduling another notification from its own callback', async () => {
    const { diagnosticService: service } = await import('./diagnosticService.js');
    service.setOnChange(() => service.record({ source: 'server', level: 'warn', message: 'nested warning' }));
    service.record({ source: 'server', level: 'error', message: 'outer' });
    callbacks.shift()?.();
    expect(callbacks).toHaveLength(0);
    expect(service.getLog().map((entry) => entry.message)).toEqual(['outer', 'nested warning']);
  });

  it('resumes delivery and coalescing when the normal sink becomes available', async () => {
    const { diagnosticService: service } = await import('./diagnosticService.js');
    service.setOnChange(() => { throw new Error('closed'); });
    service.record({ source: 'server', level: 'error', message: 'first' });
    callbacks.shift()?.();
    const recovered = vi.fn();
    service.setOnChange(recovered);
    service.record({ source: 'server', level: 'warn', message: 'one' });
    service.record({ source: 'server', level: 'warn', message: 'two' });
    expect(callbacks).toHaveLength(1);
    callbacks.shift()?.();
    expect(recovered).toHaveBeenCalledTimes(1);
    expect(service.getLog()).toHaveLength(4);
  });
});
