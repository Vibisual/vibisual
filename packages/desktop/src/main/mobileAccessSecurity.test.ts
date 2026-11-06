import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { X509Certificate } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

const mocked = vi.hoisted(() => ({ userData: '', enginePort: null as number | null }));
vi.mock('electron', () => ({ app: { getPath: () => mocked.userData }, BrowserWindow: { getAllWindows: () => [] } }));
vi.mock('@vibisual/server', () => ({
  getVoiceEnginePort: () => mocked.enginePort,
  handleClientMessage: vi.fn(), handleClientDisconnect: vi.fn(), buildConnectionMessages: () => [],
}));
vi.mock('./terminalManager', () => ({ createTerminal: vi.fn(), writeTerminal: vi.fn(), resizeTerminal: vi.fn(), killTerminal: vi.fn() }));
vi.mock('node:os', async (original) => ({
  ...await original<typeof import('node:os')>(),
  networkInterfaces: () => ({ test: [{ family: 'IPv4', internal: false, address: '127.0.0.1' }] }),
}));
import { initMobileAccess, enableMobileAccess, disableExternalAccess, getMobileAccessState, issueMobileQrTicket, stopMobileAccess } from './mobileAccess';

interface Response { status: number; headers: IncomingHttpHeaders; body: Buffer }

describe('real mobile listener HTTPS and voice upgrade boundary', () => {
  let ca: string;
  let port: number;
  let httpPort: number;
  let cookie: string;
  let engine: WebSocketServer;

  function request(path: string, options: { secure?: boolean; host?: string; body?: string; cookie?: string } = {}): Promise<Response> {
    const secure = options.secure !== false;
    return new Promise((resolve, reject) => {
      const req = (secure ? httpsRequest : httpRequest)({
        host: '127.0.0.1', port: secure ? port : httpPort, path, ca,
        method: options.body ? 'POST' : 'GET',
        headers: { ...(options.host ? { host: options.host } : {}), ...(options.cookie ? { cookie: options.cookie } : {}), ...(options.body ? { 'content-type': 'application/json' } : {}) },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.end(options.body);
    });
  }

  function upgrade(options: { origin?: string; host?: string; cookie?: string; secure?: boolean } = {}): Promise<WebSocket> {
    const secure = options.secure !== false;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${secure ? 'wss' : 'ws'}://127.0.0.1:${secure ? port : httpPort}/api/voice-asr/socket`, {
        ca, origin: options.origin ?? `https://127.0.0.1:${port}`, handshakeTimeout: 2000,
        headers: { ...(options.host ? { host: options.host } : {}), ...(options.cookie ? { cookie: options.cookie } : {}) },
      });
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });
  }

  beforeAll(async () => {
    mocked.userData = mkdtempSync(join(tmpdir(), 'vibisual-mobile-tls-test-'));
    initMobileAccess({} as Parameters<typeof initMobileAccess>[0]);
    const state = await enableMobileAccess();
    port = state.httpsPort!;
    httpPort = Number(new URL(state.certificateUrl!).port);
    const certificate = await request('/mobile/ca.crt', { secure: false });
    ca = new X509Certificate(certificate.body).toString();
    const paired = await request('/mobile/pair', { body: JSON.stringify({ code: state.pairingCode }) });
    cookie = paired.headers['set-cookie']![0]!.split(';')[0]!;
    engine = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => engine.once('listening', resolve));
    const address = engine.address();
    if (!address || typeof address === 'string') throw new Error('missing test engine port');
    mocked.enginePort = address.port;
  });

  afterAll(async () => {
    await stopMobileAccess();
    for (const client of engine.clients) client.terminate();
    await new Promise<void>((resolve) => engine.close(() => resolve()));
    rmSync(mocked.userData, { recursive: true, force: true });
  });

  it('advertises LAN and QR HTTPS without enabling Internet access', () => {
    const state = issueMobileQrTicket();
    expect(state.externalEnabled).toBe(false);
    expect(state.addresses.every((address) => address.url.startsWith('https://'))).toBe(true);
    expect(state.qrTicket!.targets.every((address) => address.url.startsWith('https://'))).toBe(true);
    expect(state.certFingerprint).toBe(new X509Certificate(ca).fingerprint256);
  });

  it('redirects old HTTP QR URLs without consuming the pairing ticket', async () => {
    const ticket = getMobileAccessState().qrTicket!;
    const path = new URL(ticket.targets[0]!.url).pathname + new URL(ticket.targets[0]!.url).search;
    const result = await request(path, { secure: false });
    expect(result.status).toBe(307);
    expect(result.headers.location).toBe(`https://127.0.0.1:${port}${path}`);
    expect(getMobileAccessState().qrTicket!.usedCount).toBe(0);
  });

  it('only exposes the public CA as the unauthenticated HTTP bootstrap download', async () => {
    const result = await request('/mobile/ca.crt', { secure: false });
    expect(result.status).toBe(200);
    expect(new X509Certificate(result.body).ca).toBe(true);
    expect(result.headers['content-type']).toBe('application/x-x509-ca-cert');
    expect((await request('/mobile/ca.crt', { secure: false, host: 'evil.example' })).status).toBe(403);
  });

  it('rejects voice sockets with no pairing cookie, a foreign origin, or a foreign Host', async () => {
    await expect(upgrade()).rejects.toThrow();
    await expect(upgrade({ cookie, origin: 'https://evil.example' })).rejects.toThrow();
    await expect(upgrade({ cookie, host: 'evil.example' })).rejects.toThrow();
    await expect(upgrade({ cookie, origin: `http://127.0.0.1:${port}` })).rejects.toThrow();
    await expect(upgrade({ cookie, secure: false })).rejects.toThrow();
  });

  it('accepts a paired same-origin WSS voice connection and keeps LAN HTTPS when external access is off', async () => {
    const ws = await upgrade({ cookie });
    expect(ws.readyState).toBe(WebSocket.OPEN);
    await disableExternalAccess();
    expect(getMobileAccessState().httpsPort).toBe(port);
    expect((await request('/mobile/ca.crt')).status).toBe(200);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.terminate();
  });
});
