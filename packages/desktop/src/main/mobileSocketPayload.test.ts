import { once } from 'node:events';
import http from 'node:http';
import { WebSocket } from 'ws';
import { describe, expect, it } from 'vitest';
import { createMobileWebSocketServer, createMobileSocketSender, MOBILE_WS_MAX_PAYLOAD_BYTES } from './mobileSocketSafety';

describe('mobile WebSocket incoming payload boundary', () => {
  it.each([false, true])('rejects oversized input while preserving healthy connections (compression=%s)', async (compression) => {
    const errors: Error[] = [];
    const wss = createMobileWebSocketServer(compression, (err) => errors.push(err));
    const server = http.createServer();
    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (peer) => {
        createMobileSocketSender(peer, (err) => errors.push(err));
        peer.on('message', (data) => peer.send(String(data)));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture not listening');
    const url = `ws://127.0.0.1:${address.port}`;
    const oversized = new WebSocket(url);
    const healthy = new WebSocket(url);
    oversized.on('error', () => {});
    healthy.on('error', () => {});
    try {
      await Promise.all([once(oversized, 'open'), once(healthy, 'open')]);
      const closed = once(oversized, 'close');
      oversized.send('x'.repeat(MOBILE_WS_MAX_PAYLOAD_BYTES + 1));
      await closed;
      expect(errors.some((err) => (err as Error & { code?: string }).code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH')).toBe(true);
      const reply = once(healthy, 'message');
      healthy.send('한字🙂');
      expect(String((await reply)[0])).toBe('한字🙂');
      expect(healthy.readyState).toBe(WebSocket.OPEN);
    } finally {
      oversized.terminate();
      healthy.terminate();
      for (const peer of wss.clients) peer.terminate();
      await Promise.all([
        new Promise<void>((resolve) => wss.close(() => resolve())),
        new Promise<void>((resolve) => server.close(() => resolve())),
      ]);
    }
  });
});
