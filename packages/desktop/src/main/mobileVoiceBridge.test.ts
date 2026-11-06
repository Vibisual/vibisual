import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMobileVoiceBridge, MOBILE_VOICE_SOCKET_PATH, type MobileVoiceBridge } from './mobileVoiceBridge';

const listeners: Server[] = [];
const sockets: WebSocket[] = [];
const engines: WebSocketServer[] = [];
const bridges: MobileVoiceBridge[] = [];

async function listen(server: Server): Promise<number> {
  listeners.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing port');
  return address.port;
}

async function engine() {
  const server = createServer();
  const ws = new WebSocketServer({ server });
  engines.push(ws);
  ws.on('connection', (client) => sockets.push(client));
  return { ws, port: await listen(server) };
}

async function listener(port: number | null, external = false) {
  const report = vi.fn();
  const bridge = createMobileVoiceBridge(report);
  bridges.push(bridge);
  const server = createServer();
  server.on('upgrade', (req, socket, head) => bridge.upgrade(req, socket, head, port, external));
  return { bridge, report, port: await listen(server) };
}

function browser(port: number): WebSocket {
  const client = new WebSocket(`ws://127.0.0.1:${port}${MOBILE_VOICE_SOCKET_PATH}`);
  sockets.push(client);
  client.on('error', () => {});
  return client;
}

afterEach(async () => {
  for (const bridge of bridges.splice(0)) bridge.close();
  for (const client of sockets.splice(0)) client.terminate();
  for (const ws of engines.splice(0)) ws.close();
  await Promise.all(listeners.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

describe('mobile voice relay', () => {
  it('relays binary PCM, the text Done command, and final results without changing frame types', async () => {
    const recognizer = await engine();
    const audio = Buffer.from(new Float32Array([0.1, -0.2, 0.3]).buffer);
    const received: { data: Buffer; binary: boolean }[] = [];
    recognizer.ws.on('connection', (client) => client.on('message', (data, binary) => {
      received.push({ data: Buffer.from(data as Buffer), binary });
      if (!binary && String(data) === 'Done') {
        client.send(JSON.stringify({ text: '모바일 음성', is_final: true }));
        client.send('Done!');
        client.close(1000);
      }
    }));
    const mobile = await listener(recognizer.port);
    const client = browser(mobile.port);
    const results: { text: string; binary: boolean }[] = [];
    client.on('message', (data, binary) => results.push({ text: String(data), binary }));
    await once(client, 'open');
    const ended = once(client, 'close');
    client.send(audio);
    client.send('Done');
    await ended;
    expect(received).toEqual([{ data: audio, binary: true }, { data: Buffer.from('Done'), binary: false }]);
    expect(results).toEqual([
      { text: JSON.stringify({ text: '모바일 음성', is_final: true }), binary: false },
      { text: 'Done!', binary: false },
    ]);
    expect(mobile.report).not.toHaveBeenCalled();
  });

  it('rejects an inactive engine before upgrading the browser', async () => {
    const mobile = await listener(null);
    const client = browser(mobile.port);
    const status = await new Promise<number | undefined>((resolve) => {
      client.once('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode); });
    });
    expect(status).toBe(503);
    expect(client.readyState).not.toBe(WebSocket.OPEN);
  });

  it('finishes the engine handshake before the browser can begin sending audio', async () => {
    const engineServer = createServer();
    const ws = new WebSocketServer({ noServer: true });
    engines.push(ws);
    let accept: (() => void) | undefined;
    const requested = new Promise<void>((resolve) => {
      engineServer.on('upgrade', (req, socket, head) => {
        accept = () => ws.handleUpgrade(req, socket, head, (client) => sockets.push(client));
        resolve();
      });
    });
    const mobile = await listener(await listen(engineServer));
    const client = browser(mobile.port);
    const opened = once(client, 'open');
    await requested;
    expect(client.readyState).toBe(WebSocket.CONNECTING);
    accept?.();
    await opened;
    expect(client.readyState).toBe(WebSocket.OPEN);
  });

  it('reports an upstream handshake failure without opening a recording connection', async () => {
    const unavailable = createServer((_req, res) => { res.writeHead(503); res.end(); });
    const mobile = await listener(await listen(unavailable));
    const client = browser(mobile.port);
    const status = await new Promise<number | undefined>((resolve) => {
      client.once('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode); });
    });
    expect(status).toBe(502);
    expect(client.readyState).not.toBe(WebSocket.OPEN);
    expect(mobile.report).toHaveBeenCalledTimes(1);
  });

  it('disconnects external voice sessions while preserving LAN sessions on the same listener', async () => {
    const recognizer = await engine();
    const bridge = createMobileVoiceBridge(vi.fn());
    bridges.push(bridge);
    const server = createServer();
    server.on('upgrade', (req, socket, head) => {
      bridge.upgrade(req, socket, head, recognizer.port, req.headers['x-test-external'] === '1');
    });
    const port = await listen(server);
    const external = new WebSocket(`ws://127.0.0.1:${port}${MOBILE_VOICE_SOCKET_PATH}`, { headers: { 'x-test-external': '1' } });
    sockets.push(external);
    const lan = browser(port);
    await Promise.all([once(external, 'open'), once(lan, 'open')]);
    const ended = once(external, 'close');
    bridge.closeExternalConnections();
    await ended;
    expect(lan.readyState).toBe(WebSocket.OPEN);
  });

  it('closes both sides when the listener is disabled and rejects subsequent upgrades', async () => {
    const recognizer = await engine();
    const connected = once(recognizer.ws, 'connection');
    const mobile = await listener(recognizer.port);
    const client = browser(mobile.port);
    await once(client, 'open');
    const [upstream] = await connected as [WebSocket];
    const ended = Promise.all([once(client, 'close'), once(upstream, 'close')]);
    mobile.bridge.close();
    await ended;
    const late = browser(mobile.port);
    const status = await new Promise<number | undefined>((resolve) => {
      late.once('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode); });
    });
    expect(status).toBe(503);
  });

  it('disconnects oversized input without an unhandled socket error', async () => {
    const recognizer = await engine();
    const connected = once(recognizer.ws, 'connection');
    const mobile = await listener(recognizer.port);
    const client = browser(mobile.port);
    await once(client, 'open');
    const [upstream] = await connected as [WebSocket];
    const ended = Promise.all([once(client, 'close'), once(upstream, 'close')]);
    client.send(Buffer.alloc(64 * 1024 + 1));
    await ended;
    expect(mobile.report).toHaveBeenCalledTimes(1);
  });
});
