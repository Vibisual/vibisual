import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { X509Certificate } from 'node:crypto';

const mocked = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => mocked.userData }, BrowserWindow: { getAllWindows: () => [] } }));
vi.mock('@vibisual/server', () => ({
  getVoiceEnginePort: () => null,
  handleClientMessage: vi.fn(), handleClientDisconnect: vi.fn(), buildConnectionMessages: () => [],
}));
vi.mock('./terminalManager', () => ({ createTerminal: vi.fn(), writeTerminal: vi.fn(), resizeTerminal: vi.fn(), killTerminal: vi.fn() }));
vi.mock('node:os', async (original) => ({
  ...await original<typeof import('node:os')>(),
  networkInterfaces: () => ({ test: [{ family: 'IPv4', internal: false, address: '127.0.0.1' }] }),
}));
import { initMobileAccess, enableMobileAccess, stopMobileAccess } from './mobileAccess';

interface Response { status: number; headers: IncomingHttpHeaders; body: Buffer }
interface Options { secure?: boolean; body?: string; cookie?: string; headers?: Record<string, string> }
interface Seen { url: string; headers: IncomingHttpHeaders }

const CONTENT = '/api/app/someapp/content/project/doc-1';
const DOCUMENT = `${CONTENT}/scene/index.html?item=clip&v=1`;

describe('mobile listener serving sandboxed app content', () => {
  let ca: string;
  let port: number;
  let httpPort: number;
  let cookie: string;
  let seen: Seen[] = [];

  function request(path: string, options: Options = {}): Promise<Response> {
    const secure = options.secure !== false;
    return new Promise((resolve, reject) => {
      const req = (secure ? httpsRequest : httpRequest)({
        host: '127.0.0.1', port: secure ? port : httpPort, path, ca,
        method: options.body ? 'POST' : 'GET',
        headers: { ...(options.cookie ? { cookie: options.cookie } : {}), ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.end(options.body);
    });
  }

  /** 문서 요청이 받은 권한 경로. */
  async function capabilityPath(url = DOCUMENT): Promise<string> {
    const response = await request(url, { cookie });
    expect(response.status).toBe(302);
    return response.headers.location!;
  }

  beforeAll(async () => {
    mocked.userData = mkdtempSync(join(tmpdir(), 'vibisual-mobile-content-test-'));
    const core = (req: IncomingMessage, res: ServerResponse): void => {
      seen.push({ url: req.url ?? '', headers: req.headers });
      res.statusCode = 200;
      res.setHeader('content-type', 'text/javascript');
      res.end('core body');
    };
    initMobileAccess(core as unknown as Parameters<typeof initMobileAccess>[0]);
    const state = await enableMobileAccess();
    port = state.httpsPort!;
    httpPort = Number(new URL(state.certificateUrl!).port);
    ca = new X509Certificate((await request('/mobile/ca.crt', { secure: false })).body).toString();
    const paired = await request('/mobile/pair', { body: JSON.stringify({ code: state.pairingCode }) });
    cookie = paired.headers['set-cookie']![0]!.split(';')[0]!;
  });

  afterAll(async () => {
    await stopMobileAccess();
    rmSync(mocked.userData, { recursive: true, force: true });
  });

  beforeEach(() => { seen = []; });

  it('sends a sub-resource without the session cookie to the pairing page on the plain path', async () => {
    const response = await request(`${CONTENT}/_shared/engine.js`);
    expect(response.headers['content-type']).toContain('text/html');
    expect(seen).toEqual([]);
  });

  it('moves an authenticated document onto its capability path without reaching the core', async () => {
    const target = await capabilityPath();
    expect(target.startsWith('/mobile/content/')).toBe(true);
    expect(target.endsWith(DOCUMENT)).toBe(true);
    expect(seen).toEqual([]);
  });

  it('serves sibling files through the capability with no cookie', async () => {
    const target = await capabilityPath();
    const sibling = new URL('../_shared/engine.js', `https://phone.invalid${target}`).pathname;
    const response = await request(sibling);
    expect(response.status).toBe(200);
    expect(response.body.toString()).toBe('core body');
    expect(seen[0]?.url).toBe(`${CONTENT}/_shared/engine.js`);
    expect(seen[0]?.headers['x-vibisual-content-base']).toBe(target.slice(0, target.indexOf('/api/')));
    expect(seen[0]?.headers.cookie).toBeUndefined();
  });

  it('refuses a capability used on another document or with a forged value', async () => {
    const target = await capabilityPath();
    expect((await request(target.replace('doc-1', 'doc-2'))).status).toBe(404);
    expect((await request(target.replace('/mobile/content/', '/mobile/content/z'))).status).toBe(404);
    expect(seen).toEqual([]);
  });

  it('does not let a capability walk out of its document scope', async () => {
    const target = await capabilityPath();
    const base = target.slice(0, target.indexOf('/api/'));
    expect((await request(`${base}${CONTENT}/../../../../projects`)).status).toBe(404);
    expect((await request(`${base}${CONTENT}/%2e%2e/%2e%2e/%2e%2e/%2e%2e/projects`)).status).toBe(404);
    expect(seen).toEqual([]);
  });

  it('accepts only reads on a capability path', async () => {
    const target = await capabilityPath();
    expect((await request(target, { body: '{}' })).status).toBe(404);
    expect(seen).toEqual([]);
  });

  it('does not serve a capability path over plain HTTP', async () => {
    const target = await capabilityPath();
    expect((await request(target, { secure: false })).status).toBe(307);
    expect(seen).toEqual([]);
  });

  it('never lets a caller supply the capability header', async () => {
    await request('/api/projects', { cookie, headers: { 'x-vibisual-content-base': '/mobile/content/spoofed' } });
    expect(seen[0]?.url).toBe('/api/projects');
    expect(seen[0]?.headers['x-vibisual-content-base']).toBeUndefined();
  });

  it('bounds an open-ended media range and keeps a closed one', async () => {
    await request('/api/app/someapp/media?path=a.wav', { cookie, headers: { range: 'bytes=1000-' } });
    expect(seen[0]?.headers.range).toBe(`bytes=1000-${1000 + 4 * 1024 * 1024 - 1}`);
    seen = [];
    await request('/api/app/someapp/media?path=a.wav', { cookie, headers: { range: 'bytes=0-1' } });
    expect(seen[0]?.headers.range).toBe('bytes=0-1');
  });
});
