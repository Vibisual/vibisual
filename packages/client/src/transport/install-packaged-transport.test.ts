import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class NativeWebSocket { constructor(readonly url: string) {} }
class TestCloseEvent extends Event {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
  constructor(type: string, init: CloseEventInit) {
    super(type);
    this.code = init.code ?? 0; this.reason = init.reason ?? ''; this.wasClean = init.wasClean ?? false;
  }
}
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
let sockets: WebSocket[];

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('CloseEvent', TestCloseEvent);
  sockets = [];
});
afterEach(() => {
  for (const socket of sockets) { socket.onclose = null; socket.close(); }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function harness() {
  const handshake = deferred();
  const listeners = new Set<(payload: unknown) => void>();
  const api = {
    connect: vi.fn(() => handshake.promise),
    onMessage: vi.fn((cb: (payload: unknown) => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; }),
    send: vi.fn(async () => {}),
    request: vi.fn(),
  };
  vi.stubGlobal('window', { WebSocket: NativeWebSocket, fetch: vi.fn(), api });
  await import('./install-packaged-transport.js');
  const socket = () => { const ws = new window.WebSocket('/ws'); sockets.push(ws); return ws; };
  const push = (value: unknown) => { for (const listener of listeners) listener(value); };
  return { handshake, api, listeners, socket, push };
}

describe('packaged IPC WebSocket handshake', () => {
  it('stays connecting until main accepts; then opens before delivering the buffered initial snapshot', async () => {
    const h = await harness();
    const ws = h.socket();
    const events: unknown[] = [];
    ws.onopen = () => { events.push('open'); h.push('from-open-handler'); };
    ws.onmessage = (event) => events.push(event.data);
    await settle();
    h.push('connection_ack');
    h.push('graph_snapshot');
    expect(ws.readyState).toBe(ws.CONNECTING);
    expect(events).toEqual([]);
    expect(() => ws.send('too early')).toThrow('WebSocket is not OPEN');
    h.handshake.resolve();
    await settle();
    expect(ws.readyState).toBe(ws.OPEN);
    expect(events).toEqual(['open', 'connection_ack', 'graph_snapshot', 'from-open-handler']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['reject', 'throw', 'timeout'] as const)('owns %s failure with error and exactly one abnormal close so the caller can retry', async (failure) => {
    const h = await harness();
    if (failure === 'throw') h.api.connect.mockImplementationOnce(() => { throw new Error('handler missing'); });
    const ws = h.socket();
    const events: string[] = [];
    ws.onopen = () => events.push('open');
    ws.onerror = () => { events.push('error'); ws.close(); }; // The real useWebSocket does this.
    ws.onclose = (event) => { events.push(`close:${event.code}:${event.wasClean}`); };
    await settle();
    if (failure === 'reject') h.handshake.reject(new Error('No handler registered'));
    if (failure === 'timeout') await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect(ws.readyState).toBe(ws.CLOSED);
    expect(events).toEqual(['error', 'close:1006:false']);
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers with a new handshake after onclose schedules a retry; stale success cannot reopen the old socket', async () => {
    const h = await harness();
    const ws = h.socket();
    let retry: WebSocket | undefined;
    ws.onclose = () => { setTimeout(() => { retry = h.socket(); }, 1000); };
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    h.api.connect.mockResolvedValueOnce();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(retry?.readyState).toBe(retry?.OPEN);
    expect(h.listeners.size).toBe(1);
    h.handshake.resolve();
    await settle();
    expect(ws.readyState).toBe(ws.CLOSED);
    expect(h.api.connect).toHaveBeenCalledTimes(2);
    expect(h.listeners.size).toBe(1);
  });

  it.each(['resolve', 'reject'] as const)('closing during the handshake discards buffered messages and ignores late %s', async (outcome) => {
    const h = await harness();
    const ws = h.socket();
    const opened = vi.fn(); const received = vi.fn(); const closed = vi.fn(); const error = vi.fn();
    ws.onopen = opened; ws.onmessage = received; ws.onclose = closed; ws.onerror = error;
    await settle();
    h.push('initial snapshot');
    ws.close();
    if (outcome === 'resolve') h.handshake.resolve(); else h.handshake.reject(new Error('late rejection'));
    await settle();
    h.push('later snapshot');
    expect(opened).not.toHaveBeenCalled();
    expect(received).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledOnce();
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not subscribe or invoke main after an immediate caller close', async () => {
    const h = await harness();
    h.socket().close();
    await settle();
    expect(h.api.connect).not.toHaveBeenCalled();
    expect(h.api.onMessage).not.toHaveBeenCalled();
  });

  it('leaves external WebSockets on the native transport', async () => {
    const h = await harness();
    expect(new window.WebSocket('wss://example.test/stream')).toBeInstanceOf(NativeWebSocket);
    expect(h.api.connect).not.toHaveBeenCalled();
  });
});
