import { once } from 'node:events';
import type { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CdpClient } from './cdpClient.js';
import { inspectorFixture } from './cdpTestFixture.js';

vi.mock('@vibisual/shared', async (original) => ({
  ...await original<typeof import('@vibisual/shared')>(),
  DEBUG_ADAPTER_READY_TIMEOUT_MS: 80,
}));

const fixtures: Awaited<ReturnType<typeof inspectorFixture>>[] = [];
const clients: CdpClient[] = [];
async function setup(options: Parameters<typeof inspectorFixture>[0] = {}) {
  const f = await inspectorFixture(options);
  fixtures.push(f);
  const onEvent = vi.fn();
  const onClosed = vi.fn();
  const client = new CdpClient(onEvent, onClosed);
  clients.push(client);
  return { f, client, onEvent, onClosed };
}
function socketOf(client: CdpClient): WebSocket {
  const socket = (client as unknown as { socket: WebSocket | null }).socket;
  if (!socket) throw new Error('expected a test-owned socket');
  return socket;
}
afterEach(async () => {
  for (const client of clients.splice(0)) client.dispose('test finished');
  await Promise.all(fixtures.splice(0).map((f) => f.close()));
  vi.restoreAllMocks();
});

describe('CDP connection lifecycle', () => {
  it('connects, exchanges a response, and keeps late shutdown errors contained', async () => {
    const { f, client } = await setup();
    f.wss.on('connection', (ws) => ws.on('message', (raw) => {
      ws.send(JSON.stringify({ id: JSON.parse(String(raw)).id, result: { value: '한字🙂' } }));
    }));
    await client.connect(f.port);
    await expect(client.send('Runtime.evaluate')).resolves.toEqual({ value: '한字🙂' });
    const socket = socketOf(client);
    client.dispose('done');
    expect(() => socket.emit('error', new Error('late network reset'))).not.toThrow();
  });

  it('rejects a failed handshake without unhandled late errors', async () => {
    const { f, client, onClosed } = await setup({ rejectUpgrade: true });
    const upgraded = once(f.server, 'upgrade');
    const connected = client.connect(f.port);
    const rejection = expect(connected).rejects.toThrow('403');
    await upgraded;
    const socket = socketOf(client);
    await rejection;
    expect(() => socket.emit('error', new Error('deferred handshake error'))).not.toThrow();
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('bounds a stalled WebSocket handshake', async () => {
    const { f, client } = await setup({ holdUpgrade: true });
    await expect(client.connect(f.port)).rejects.toThrow(/timed out/i);
  });

  it('disposal cancels a pending handshake and never reopens the disposed client', async () => {
    const { f, client, onClosed } = await setup({ holdUpgrade: true });
    const upgraded = once(f.server, 'upgrade');
    const pending = client.connect(f.port);
    const rejected = expect(pending).rejects.toThrow('cancelled by user');
    await upgraded;
    const socket = socketOf(client);
    client.dispose('cancelled by user');
    await rejected;
    expect(() => socket.emit('error', new Error('abort failed'))).not.toThrow();
    socket.emit('open');
    await expect(client.send('Runtime.enable')).rejects.toThrow('disconnected');
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('disposal cancels HTTP discovery before a WebSocket is created', async () => {
    const { f, client } = await setup({ respond: () => { /* wait for cancellation */ } });
    const requested = once(f.server, 'request');
    const pending = client.connect(f.port);
    const rejected = expect(pending).rejects.toThrow('disconnected');
    await requested;
    client.dispose('cancel');
    await rejected;
    expect(f.wss.clients.size).toBe(0);
  });

  it('closes once on a runtime network error and immediately rejects pending calls', async () => {
    const { f, client, onClosed } = await setup();
    await client.connect(f.port);
    const socket = socketOf(client);
    const pending = client.send('Runtime.enable');
    const rejected = expect(pending).rejects.toThrow('inspector-error');
    expect(() => socket.emit('error', new Error('connection reset'))).not.toThrow();
    await rejected;
    socket.emit('close');
    socket.emit('error', new Error('second reset'));
    expect(onClosed).toHaveBeenCalledExactlyOnceWith('inspector-error');
  });

  it('rejects a failed asynchronous write immediately instead of waiting for the response timeout', async () => {
    const { f, client } = await setup();
    await client.connect(f.port);
    vi.spyOn(socketOf(client), 'send').mockImplementation(((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error) => void;
      queueMicrotask(() => callback(new Error('write failed')));
    }) as WebSocket['send']);
    await expect(client.send('Runtime.enable')).rejects.toThrow('write failed');
    expect((client as unknown as { pending: Map<number, unknown> }).pending.size).toBe(0);
  });

  it('ignores malformed and scalar JSON frames while still dispatching valid events', async () => {
    const { f, client, onEvent } = await setup();
    await client.connect(f.port);
    const socket = socketOf(client);
    for (const raw of ['null', '[]', '7', 'true', '"text"', 'invalid']) {
      expect(() => socket.emit('message', Buffer.from(raw))).not.toThrow();
    }
    socket.emit('message', Buffer.from('{"method":"Debugger.paused","params":{"reason":"breakpoint"}}'));
    expect(onEvent).toHaveBeenCalledExactlyOnceWith({ method: 'Debugger.paused', params: { reason: 'breakpoint' } });
  });

  it('contains user callback exceptions at the WebSocket event boundary', async () => {
    const { f, client, onEvent, onClosed } = await setup();
    await client.connect(f.port);
    onEvent.mockImplementation(() => { throw new Error('event consumer failed'); });
    onClosed.mockImplementation(() => { throw new Error('close consumer failed'); });
    expect(() => socketOf(client).emit('message', Buffer.from('{"method":"Debugger.paused"}'))).not.toThrow();
    expect(onClosed).toHaveBeenCalledExactlyOnceWith('inspector-message-error');
  });
});
