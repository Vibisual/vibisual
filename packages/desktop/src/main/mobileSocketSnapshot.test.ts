import http from 'node:http';
import { WebSocket } from 'ws';
import { describe, expect, it } from 'vitest';
import { createMobileWebSocketServer, createMobileSocketSender, MOBILE_WS_MAX_BUFFERED_BYTES } from './mobileSocketSafety';

describe('initial mobile snapshot and live deltas on real ws transports', () => {
  it.each([false, true])('delivers ack, oversized snapshot and delta in order (compression=%s)', async (compression) => {
    const failures: Error[] = [];
    const accepted: boolean[] = [];
    const received: Array<number | string> = [];
    const wss = createMobileWebSocketServer(compression, (error) => failures.push(error));
    const server = http.createServer();
    const snapshotBytes = MOBILE_WS_MAX_BUFFERED_BYTES + 1;
    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (peer) => {
        const send = createMobileSocketSender(peer, (error) => failures.push(error));
        accepted.push(send('connection_ack'));
        accepted.push(send('x'.repeat(snapshotBytes)));
        accepted.push(send('graph_delta'));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture did not listen');
    const client = new WebSocket(`ws://127.0.0.1:${address.port}`, { maxPayload: snapshotBytes + 1024 });
    const allReceived = new Promise<void>((resolve, reject) => {
      client.on('error', reject);
      client.on('close', () => { if (received.length < 3) reject(new Error('snapshot connection closed early')); });
      client.on('message', (data) => {
        const bytes = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
        received.push(bytes.length > 100 ? bytes.length : bytes.toString('utf8'));
        if (received.length === 3) resolve();
      });
    });
    try {
      await allReceived;
      expect(accepted).toEqual([true, true, true]);
      expect(received).toEqual(['connection_ack', snapshotBytes, 'graph_delta']);
      expect(failures).toEqual([]);
    } finally {
      client.terminate();
      for (const peer of wss.clients) peer.terminate();
      await Promise.all([
        new Promise<void>((resolve) => wss.close(() => resolve())),
        new Promise<void>((resolve) => server.close(() => resolve())),
      ]);
    }
  }, 15000);
});
