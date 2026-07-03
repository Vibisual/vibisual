import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer, get as httpsGet, type Server as HttpsServer } from 'node:https';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Socket, AddressInfo } from 'node:net';
import { app, BrowserWindow } from 'electron';
import { inject, type DispatchFunc } from 'light-my-request';
import { WebSocketServer, WebSocket } from 'ws';
import { Client as NatUpnpClient } from '@runonflux/nat-upnp';
import { generate as generateSelfSigned } from 'selfsigned';
import { handleClientMessage, buildConnectionMessages, type ClientConnection } from '@vibisual/server';
import {
  WS_PATH,
  MOBILE_PAIR_CODE_LENGTH,
  MOBILE_PAIR_MAX_ATTEMPTS,
  MOBILE_SESSION_MAX,
  MOBILE_SESSION_COOKIE,
  MOBILE_EXTERNAL_PAIR_CODE_LENGTH,
  MOBILE_PAIR_BAN_MS,
  MOBILE_UPNP_LEASE_S,
  type MobileAccessState,
  type MobileExternalStatus,
  type MobileExternalReason,
  type WSMessage,
} from '@vibisual/shared';

// 모바일 웹 접속 모드 — SCENARIO.md §4 v3.16 + v3.20(UPnP 외부 개방).
//
// hook loopback 리스너(index.ts)와 별개의 **opt-in** 리스너. 사용자가 File 메뉴에서 켰을 때만
// 0.0.0.0(LAN)에 바인드하여 renderer 정적 서빙 + /api light-my-request 재디스패치 + /ws
// WebSocket 브리지를 제공한다. 브라우저에선 window.api 가 없어 transport 어댑터가 native
// fetch/WebSocket 폴백으로 동작하므로 클라이언트 소스는 무수정(§3.7 v1.93).
//
// v3.20 — 외부(인터넷) 접속. 릴레이 서버(비용)·사용자 수동 포트포워딩 요구 대신, 앱이 사용자
// 공유기에 UPnP IGD 로 포트를 직접 연다(Plex 원격 액세스 방식). 외부 노출은 도청 방지를 위해
// 자체 서명 HTTPS 로만 뚫고, UPnP 매핑을 그 HTTPS 포트로 연결한다. UPnP 미지원/CGNAT 는
// 감지해 수동 포트포워딩 안내로 폴백한다.
//
// 보안 모델:
//   - 기본 OFF. LAN·외부 모두 opt-in. 꺼져 있으면 소켓을 하나도 열지 않는다.
//   - 페어링: 데스크톱 모달의 코드를 폰에서 입력 → HttpOnly 세션 쿠키. 외부가 켜지면 코드가
//     강한 영숫자 12자로 승격된다(공인망 무차별 대입 내성).
//   - IP 별 실패 차단: 한 IP 가 MOBILE_PAIR_MAX_ATTEMPTS 회 실패하면 MOBILE_PAIR_BAN_MS 동안
//     그 IP 만 차단(전역 잠금이 아니라 per-IP — 소유자 lockout·공격자 DoS 동시 방지).
//   - Host 헤더 IP-리터럴 가드 — DNS rebinding 차단.
//   - 세션 쿠키는 SameSite=Strict — 교차 출처 스크립트가 API 를 못 친다. (LAN http 와 외부
//     https 를 한 쿠키로 공유하므로 Secure 는 붙이지 않는다 — 페어링이 실질 게이트.)

const PERSIST_FILENAME = 'mobile-access.json';
const TLS_FILENAME = 'mobile-tls.json';
const PAIR_BODY_LIMIT = 10 * 1024;
const SESSION_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60; // 30일

interface PersistedMobileAccess {
  enabled: boolean;
  externalEnabled: boolean;
  /** 마지막으로 실제 바인드된 LAN HTTP 포트 — 다음 켜기에서 같은 포트 선호(URL 안정). */
  port: number;
  /** 마지막으로 바인드된 HTTPS 포트(외부용). */
  httpsPort: number;
  /** 발급된 세션 토큰들(최신 우선, MOBILE_SESSION_MAX 캡). */
  sessions: string[];
}

interface PersistedTls {
  key: string; // PEM
  cert: string; // PEM
}

interface IpAttempt {
  count: number;
  bannedUntil: number;
}

let httpServer: HttpServer | null = null;
let httpsServer: HttpsServer | null = null;
let wss: WebSocketServer | null = null;
const wsClients = new Set<WebSocket>();

let persisted: PersistedMobileAccess = defaultPersisted();
let pairingCode: string | null = null;
const pairAttempts = new Map<string, IpAttempt>();
let starting = false;

// UPnP 외부 개방 상태.
let upnpClient: NatUpnpClient | null = null;
let externalStatus: MobileExternalStatus = 'idle';
let externalReason: MobileExternalReason = null;
let publicIp: string | null = null;
let externalPort: number | null = null;
let upnpRenewTimer: ReturnType<typeof setInterval> | null = null;

function defaultPersisted(): PersistedMobileAccess {
  return { enabled: false, externalEnabled: false, port: 0, httpsPort: 0, sessions: [] };
}

function persistPath(): string {
  return join(app.getPath('userData'), PERSIST_FILENAME);
}
function tlsPath(): string {
  return join(app.getPath('userData'), TLS_FILENAME);
}

function loadPersisted(): PersistedMobileAccess {
  const p = persistPath();
  if (!existsSync(p)) return defaultPersisted();
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return defaultPersisted();
    const obj = parsed as Record<string, unknown>;
    return {
      enabled: obj['enabled'] === true,
      externalEnabled: obj['externalEnabled'] === true,
      port: typeof obj['port'] === 'number' && obj['port'] > 0 ? obj['port'] : 0,
      httpsPort: typeof obj['httpsPort'] === 'number' && obj['httpsPort'] > 0 ? obj['httpsPort'] : 0,
      sessions: Array.isArray(obj['sessions'])
        ? (obj['sessions'] as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, MOBILE_SESSION_MAX)
        : [],
    };
  } catch (err) {
    console.warn(`[mobile-access] failed to read ${p}: ${String(err)}`);
    return defaultPersisted();
  }
}

function savePersisted(): void {
  try {
    writeFileSync(persistPath(), JSON.stringify(persisted, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.warn(`[mobile-access] failed to persist: ${String(err)}`);
  }
}

/** 자체 서명 인증서 — 한 번 만들면 userData 에 영속(재시작해도 지문 유지 → 폰 "이 기기 신뢰"가 지속). */
async function loadOrCreateTls(): Promise<PersistedTls> {
  const p = tlsPath();
  if (existsSync(p)) {
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8')) as Partial<PersistedTls>;
      if (typeof parsed.key === 'string' && typeof parsed.cert === 'string') {
        return { key: parsed.key, cert: parsed.cert };
      }
    } catch { /* 손상 시 재생성 */ }
  }
  const notAfter = new Date();
  notAfter.setFullYear(notAfter.getFullYear() + 10);
  const pems = await generateSelfSigned([{ name: 'commonName', value: 'Vibisual Mobile Access' }], {
    notAfterDate: notAfter,
    keySize: 2048,
    algorithm: 'sha256',
  });
  const tls: PersistedTls = { key: pems.private, cert: pems.cert };
  try {
    writeFileSync(p, JSON.stringify(tls, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.warn(`[mobile-access] failed to persist TLS cert: ${String(err)}`);
  }
  return tls;
}

function pairCodeLength(): number {
  return persisted.externalEnabled ? MOBILE_EXTERNAL_PAIR_CODE_LENGTH : MOBILE_PAIR_CODE_LENGTH;
}

function newPairingCode(): string {
  if (persisted.externalEnabled) {
    // 혼동되는 글자(0/O/1/I/l) 제외한 영숫자.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < MOBILE_EXTERNAL_PAIR_CODE_LENGTH; i++) {
      out += alphabet[randomInt(0, alphabet.length)];
    }
    return out;
  }
  const max = 10 ** MOBILE_PAIR_CODE_LENGTH;
  return String(randomInt(0, max)).padStart(MOBILE_PAIR_CODE_LENGTH, '0');
}

function lanUrls(port: number | null): string[] {
  if (port === null) return [];
  const urls: string[] = [];
  const nets = networkInterfaces();
  for (const infos of Object.values(nets)) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) urls.push(`http://${info.address}:${port}`);
    }
  }
  return urls;
}

function httpPortNow(): number | null {
  const addr = httpServer?.address();
  return addr && typeof addr === 'object' ? (addr as AddressInfo).port : null;
}
function httpsPortNow(): number | null {
  const addr = httpsServer?.address();
  return addr && typeof addr === 'object' ? (addr as AddressInfo).port : null;
}

function anyBanned(): boolean {
  const now = Date.now();
  for (const a of pairAttempts.values()) if (a.bannedUntil > now) return true;
  return false;
}

/**
 * 외부 접속 URL 계산 — 공인 IP 를 확보했고 CGNAT 가 아니면 접속 주소를 제공한다.
 *  - UPnP 자동 개방 성공(active): 매핑된 공인 포트로.
 *  - 자동 실패(error, 수동 포트포워딩 대상): 공인 IP + HTTPS 포트로. 포워딩만 해두면 이 주소로 접속.
 * CGNAT 는 구조적으로 불가하므로 제외. 외부 OFF/mapping 중엔 publicIp 가 없어 null.
 */
function computeExternalUrl(): string | null {
  if (!publicIp || externalReason === 'cgnat') return null;
  if (externalStatus === 'active' && externalPort) return `https://${publicIp}:${externalPort}`;
  const httpsPort = httpsPortNow();
  if (externalStatus === 'error' && httpsPort) return `https://${publicIp}:${httpsPort}`;
  return null;
}

export function getMobileAccessState(): MobileAccessState {
  const port = httpPortNow();
  return {
    enabled: httpServer !== null,
    port,
    urls: lanUrls(port),
    pairingCode: httpServer !== null ? pairingCode : null,
    clientCount: wsClients.size,
    pairingLocked: anyBanned(),
    externalEnabled: persisted.externalEnabled,
    externalStatus,
    externalUrl: computeExternalUrl(),
    externalReason,
    publicIp,
    externalPort,
    httpsPort: httpsPortNow(),
  };
}

function pushState(): void {
  const state = getMobileAccessState();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('vibisual:mobile:status', state);
  }
}

// ─── 인증 ────────────────────────────────────────────────────────────────────

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

function isAuthedRequest(req: IncomingMessage): boolean {
  const token = parseCookies(req.headers.cookie)[MOBILE_SESSION_COOKIE];
  if (!token) return false;
  const candidate = Buffer.from(token);
  return persisted.sessions.some((s) => {
    const known = Buffer.from(s);
    return known.length === candidate.length && timingSafeEqual(known, candidate);
  });
}

function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown';
}

/** Host 헤더 가드 — DNS rebinding 차단(정상 접속은 항상 IP-리터럴 또는 localhost). */
function isAllowedHost(host: string | undefined): boolean {
  if (!host) return false;
  const bare = host.replace(/:\d+$/, '');
  if (bare === 'localhost') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) return true;
  if (/^\[[0-9a-fA-F:.]+\]$/.test(bare)) return true;
  return false;
}

// ─── 페어링 페이지 ───────────────────────────────────────────────────────────

function pairingPageHtml(locked: boolean, codeLen: number): string {
  const lockedNote = locked
    ? '<p class="err">Too many failed attempts from your device — try again later or regenerate the code on the desktop. / 실패가 누적되어 잠시 차단되었습니다. 잠시 후 다시 시도하거나 데스크톱에서 새 코드를 발급하세요.</p>'
    : '';
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
<title>Vibisual — Pair</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #030712; color: #e5e7eb; font-family: system-ui, -apple-system, sans-serif; }
  .card { width: min(90vw, 360px); padding: 28px 24px; border: 1px solid rgba(255,255,255,.08);
          border-radius: 16px; background: rgba(17,24,39,.9); }
  h1 { margin: 0 0 4px; font-size: 20px; }
  p { margin: 6px 0 16px; font-size: 13px; color: #9ca3af; line-height: 1.5; }
  input { width: 100%; box-sizing: border-box; padding: 12px; font-size: 20px; letter-spacing: .28em;
          text-align: center; text-transform: uppercase; color: #fff; background: rgba(255,255,255,.04);
          border: 1px solid rgba(255,255,255,.12); border-radius: 10px; outline: none; }
  input:focus { border-color: #38bdf8; }
  button { width: 100%; margin-top: 14px; padding: 12px; font-size: 15px; font-weight: 600;
           color: #030712; background: #38bdf8; border: 0; border-radius: 10px; cursor: pointer; }
  .err { color: #f87171; min-height: 18px; margin: 10px 0 0; }
</style>
</head>
<body>
<div class="card">
  <h1>Vibisual</h1>
  <p>Enter the pairing code shown in the desktop app (File &gt; Mobile Access).<br/>
     데스크톱 앱(File &gt; Mobile Access)에 표시된 페어링 코드를 입력해 주세요.</p>
  <form id="f">
    <input id="code" inputmode="text" autocomplete="one-time-code" maxlength="${codeLen}" autofocus />
    <button type="submit">Connect</button>
    <p class="err" id="err"></p>
  </form>
  ${lockedNote}
</div>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('err');
  err.textContent = '';
  try {
    const res = await fetch('/mobile/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: document.getElementById('code').value.trim().toUpperCase() }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) { location.replace('/'); return; }
    err.textContent = data.locked
      ? 'Temporarily locked — try again later. / 잠시 차단됨 — 잠시 후 다시 시도하세요.'
      : 'Wrong code. / 코드가 올바르지 않습니다.';
  } catch {
    err.textContent = 'Connection failed. / 연결에 실패했습니다.';
  }
});
</script>
</body>
</html>`;
}

function handlePairRequest(req: IncomingMessage, res: ServerResponse): void {
  const ip = clientIp(req);
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > PAIR_BODY_LIMIT) { res.statusCode = 413; res.end(); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('error', () => { try { res.statusCode = 400; res.end(); } catch { /* socket gone */ } });
  req.on('end', () => {
    if (res.writableEnded) return;
    res.setHeader('content-type', 'application/json');
    const now = Date.now();
    const attempt = pairAttempts.get(ip);
    if (attempt && attempt.bannedUntil > now) {
      res.statusCode = 429;
      res.end(JSON.stringify({ ok: false, locked: true }));
      return;
    }
    let code = '';
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { code?: unknown };
      if (typeof parsed.code === 'string') code = parsed.code;
    } catch { /* 잘못된 JSON → 빈 코드로 실패 처리 */ }
    // 상수시간 비교(길이 일치 시).
    const ok =
      pairingCode !== null &&
      code.length === pairingCode.length &&
      timingSafeEqual(Buffer.from(code), Buffer.from(pairingCode));
    if (ok) {
      pairAttempts.delete(ip);
      const session = randomBytes(24).toString('hex');
      persisted.sessions = [session, ...persisted.sessions].slice(0, MOBILE_SESSION_MAX);
      savePersisted();
      res.setHeader(
        'set-cookie',
        `${MOBILE_SESSION_COOKIE}=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_COOKIE_MAX_AGE_S}`,
      );
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
      console.log(`[mobile-access] device paired from ${ip}`);
      pushState();
      return;
    }
    const next: IpAttempt = attempt ?? { count: 0, bannedUntil: 0 };
    next.count += 1;
    if (next.count >= MOBILE_PAIR_MAX_ATTEMPTS) {
      next.bannedUntil = now + MOBILE_PAIR_BAN_MS;
      next.count = 0;
      console.warn(`[mobile-access] pairing temporarily banned for ${ip} (repeated failures)`);
    }
    pairAttempts.set(ip, next);
    res.statusCode = 401;
    res.end(JSON.stringify({ ok: false, locked: next.bannedUntil > now }));
    pushState();
  });
}

// ─── 정적 서빙 ───────────────────────────────────────────────────────────────

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

function rendererRoot(): string {
  return resolve(join(__dirname, '../renderer'));
}

function serveStatic(pathname: string, res: ServerResponse): void {
  const root = rendererRoot();
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let filePath = resolve(join(root, rel));
  if (filePath !== root && !filePath.startsWith(root + '\\') && !filePath.startsWith(root + '/')) {
    res.statusCode = 403; res.end(); return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    if (extname(rel) === '') filePath = join(root, 'index.html');
    else { res.statusCode = 404; res.end(); return; }
  }
  try {
    const body = readFileSync(filePath);
    const ext = extname(filePath).toLowerCase();
    res.statusCode = 200;
    res.setHeader('content-type', MIME_BY_EXT[ext] ?? 'application/octet-stream');
    res.setHeader('cache-control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    res.end(body);
  } catch (err) {
    res.statusCode = 500;
    res.end(`static serve failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── API 재디스패치 ──────────────────────────────────────────────────────────

function dispatchToExpress(req: IncomingMessage, res: ServerResponse): void {
  const expressApp = expressAppRef;
  if (!expressApp) { res.statusCode = 503; res.end('server core not ready'); return; }
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('error', () => { try { res.statusCode = 400; res.end(); } catch { /* socket gone */ } });
  req.on('end', () => {
    const headers = { ...req.headers } as Record<string, string | string[]>;
    delete headers['cookie']; // 세션 쿠키는 이 리스너 인증용 — 코어에 흘리지 않는다.
    void inject(expressApp as unknown as DispatchFunc, {
      method: (req.method ?? 'GET') as 'GET',
      url: req.url ?? '/',
      headers,
      payload: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
    }).then((injected) => {
      res.statusCode = injected.statusCode;
      for (const [k, v] of Object.entries(injected.headers)) {
        if (v == null) continue;
        const key = k.toLowerCase();
        if (key === 'transfer-encoding' || key === 'connection' || key === 'content-length') continue;
        res.setHeader(k, Array.isArray(v) ? v.map(String) : String(v));
      }
      res.end(injected.rawPayload);
    }).catch((err: unknown) => {
      res.statusCode = 500;
      res.end(`mobile dispatch failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  });
}

// ─── 공용 요청 핸들러 (HTTP·HTTPS 공유) ──────────────────────────────────────

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  if (!isAllowedHost(req.headers.host)) {
    res.statusCode = 403; res.end('forbidden host'); req.resume(); return;
  }
  const pathname = (req.url ?? '').split('?')[0] ?? '';
  if (req.method === 'POST' && pathname === '/mobile/pair') { handlePairRequest(req, res); return; }
  if (!isAuthedRequest(req)) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(pairingPageHtml(anyBanned(), pairCodeLength()));
    } else {
      res.statusCode = 401; res.end();
    }
    req.resume();
    return;
  }
  if (pathname.startsWith('/api') || pathname === '/health' || pathname.startsWith('/iframe-proxy')) {
    dispatchToExpress(req, res);
    return;
  }
  serveStatic(pathname, res);
  req.resume();
}

// ─── WebSocket 브리지 ────────────────────────────────────────────────────────

function bindUpgrade(server: HttpServer | HttpsServer): void {
  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const pathname = (req.url ?? '').split('?')[0] ?? '';
    if (pathname !== WS_PATH || !isAllowedHost(req.headers.host) || !isAuthedRequest(req)) {
      socket.destroy();
      return;
    }
    wss?.handleUpgrade(req, socket, head, (ws) => {
      wsClients.add(ws);
      const conn: ClientConnection = {
        send: (data: string): void => {
          if (ws.readyState === WebSocket.OPEN) ws.send(data);
        },
      };
      for (const m of buildConnectionMessages()) conn.send(JSON.stringify(m));
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw)) as { type?: string; payload?: unknown };
          if (msg && typeof msg === 'object') handleClientMessage(msg, conn);
        } catch { /* 비 JSON 프레임 무시 */ }
      });
      ws.on('close', () => { wsClients.delete(ws); pushState(); });
      ws.on('error', () => { /* close 가 정리 */ });
      pushState();
    });
  });
}

/** broadcast sink 팬아웃 — index.ts 의 setBroadcastSink 콜백이 renderer 푸시와 함께 호출한다. */
export function mobileBroadcast(msg: WSMessage): void {
  if (wsClients.size === 0) return;
  const data = JSON.stringify(msg);
  for (const ws of wsClients) if (ws.readyState === WebSocket.OPEN) ws.send(data);
}

// ─── LAN 리스너 라이프사이클 ─────────────────────────────────────────────────

let expressAppRef: import('express').Express | null = null;

async function startHttpListener(): Promise<void> {
  if (httpServer || starting) return;
  starting = true;
  try {
    const server = createServer(handleRequest);
    if (!wss) wss = new WebSocketServer({ noServer: true });
    bindUpgrade(server);
    await listenWithFallback(server, persisted.port, '0.0.0.0');
    httpServer = server;
    persisted.port = httpPortNow() ?? 0;
    console.log(`[mobile-access] LAN http on 0.0.0.0:${persisted.port} (pairing required)`);
  } finally {
    starting = false;
  }
}

async function listenWithFallback(
  server: HttpServer | HttpsServer,
  preferredPort: number,
  host: string,
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    let triedFallback = false;
    const onError = (err: NodeJS.ErrnoException): void => {
      if (!triedFallback && preferredPort > 0) {
        triedFallback = true;
        console.warn(`[mobile-access] preferred port ${preferredPort} unavailable (${err.code ?? err.message}) — dynamic fallback`);
        server.listen(0, host);
        return;
      }
      rejectPromise(err);
    };
    server.on('error', onError);
    server.listen(preferredPort > 0 ? preferredPort : 0, host, () => {
      server.removeListener('error', onError);
      resolvePromise();
    });
  });
}

async function stopHttpListener(): Promise<void> {
  const s = httpServer;
  httpServer = null;
  for (const ws of wsClients) { try { ws.terminate(); } catch { /* gone */ } }
  wsClients.clear();
  wss?.close();
  wss = null;
  if (s) {
    await new Promise<void>((r) => s.close(() => r()));
    console.log('[mobile-access] LAN http stopped');
  }
}

// ─── HTTPS(외부) 리스너 ──────────────────────────────────────────────────────

async function startHttpsListener(): Promise<void> {
  if (httpsServer) return;
  const tls = await loadOrCreateTls();
  const server = createHttpsServer({ key: tls.key, cert: tls.cert }, handleRequest);
  if (!wss) wss = new WebSocketServer({ noServer: true });
  bindUpgrade(server);
  await listenWithFallback(server, persisted.httpsPort, '0.0.0.0');
  httpsServer = server;
  persisted.httpsPort = httpsPortNow() ?? 0;
  console.log(`[mobile-access] external https on 0.0.0.0:${persisted.httpsPort}`);
}

async function stopHttpsListener(): Promise<void> {
  const s = httpsServer;
  httpsServer = null;
  if (s) {
    await new Promise<void>((r) => s.close(() => r()));
    console.log('[mobile-access] external https stopped');
  }
}

// ─── UPnP 외부 개방 ──────────────────────────────────────────────────────────

/** 공인 IP 가 실제로 인터넷에서 닿을 수 있는지 — 사설/CGNAT 대역이면 외부 개방 불가. */
function isPubliclyRoutable(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return false; // 10/8
  if (a === 172 && b >= 16 && b <= 31) return false; // 172.16/12
  if (a === 192 && b === 168) return false; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64/10 CGNAT
  if (a === 169 && b === 254) return false; // 링크로컬
  if (a === 127) return false;
  return true;
}

/** 공개 IP 에코 서비스(HTTPS·읽기전용) — UPnP getPublicIp 실패 시 공인 IP 폴백 조회. */
const PUBLIC_IP_SERVICES = ['https://api.ipify.org', 'https://icanhazip.com', 'https://ifconfig.me/ip'];

function fetchPublicIp(url: string): Promise<string | null> {
  return new Promise((resolvePromise) => {
    const req = httpsGet(url, { timeout: 4000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolvePromise(null); return; }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => { data += c; if (data.length > 100) req.destroy(); });
      res.on('end', () => resolvePromise(data.trim()));
    });
    req.on('error', () => resolvePromise(null));
    req.on('timeout', () => { req.destroy(); resolvePromise(null); });
  });
}

/** 공인 IP 폴백 조회 — 여러 서비스를 순차 시도(하나라도 IPv4 반환하면 채택). */
async function resolvePublicIpFallback(): Promise<string | null> {
  for (const url of PUBLIC_IP_SERVICES) {
    const ip = await fetchPublicIp(url).catch(() => null);
    if (ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
  }
  return null;
}

async function mapUpnp(): Promise<void> {
  const httpsPort = httpsPortNow();
  if (httpsPort === null) throw new Error('https listener not ready');
  externalStatus = 'mapping';
  externalReason = null;
  pushState();

  const client = new NatUpnpClient({ timeout: 5000 });
  upnpClient = client;

  // 1) 공인 IP 조회 — UPnP IGD 우선, 실패하면 공개 IP 서비스로 폴백(주소는 반드시 보여준다).
  let ip: string | null = null;
  let upnpUsable = true;
  try {
    ip = await client.getPublicIp();
  } catch {
    upnpUsable = false;
    ip = await resolvePublicIpFallback();
    console.warn('[mobile-access] UPnP getPublicIp failed — router UPnP off/unsupported (public IP via fallback)');
  }
  publicIp = ip;

  // 공인 IP 를 아예 못 구함 → 수동 안내로 폴백(주소 표시는 불가).
  if (!ip) {
    finalizeExternalManualFallback();
    return;
  }

  // 2) CGNAT/사설 IP 면 포트를 열어도 외부에서 못 닿음 — 구조적 불가.
  if (!isPubliclyRoutable(ip)) {
    externalStatus = 'unavailable';
    externalReason = 'cgnat';
    externalPort = null;
    console.warn(`[mobile-access] public IP ${ip} is CGNAT/private — external access not possible without a VPN`);
    pushState();
    return;
  }

  // 3) UPnP 사용 가능하면 포트 매핑 생성 — 공인 포트 = HTTPS 포트(안정성 위해 동일 번호 시도).
  if (upnpUsable) {
    try {
      await client.createMapping({
        public: httpsPort,
        private: { port: httpsPort },
        protocol: 'tcp',
        description: 'Vibisual Mobile Access',
        ttl: MOBILE_UPNP_LEASE_S,
      });
      externalPort = httpsPort;
      externalStatus = 'active';
      externalReason = null;
      console.log(`[mobile-access] UPnP mapped ${ip}:${httpsPort} -> :${httpsPort} (https)`);
      pushState();
      return;
    } catch {
      console.warn('[mobile-access] UPnP createMapping failed — manual port forward required');
    }
  }

  // 4) 자동 개방 실패/미지원 — 수동 포트포워딩 안내(공인 IP 는 확보됨). computeExternalUrl 이
  //    같은 공인 IP + HTTPS 포트로 접속 주소를 채워, 포워딩만 해두면 그 주소로 접속 가능.
  finalizeExternalManualFallback();
}

/** 자동 개방 실패 시 상태 확정 — error(upnp) 로 두되, 공인 IP 는 유지해 안내/수동 URL 에 쓴다. */
function finalizeExternalManualFallback(): void {
  externalStatus = 'error';
  externalReason = 'upnp';
  externalPort = null;
  pushState();
}

async function unmapUpnp(): Promise<void> {
  if (upnpRenewTimer) { clearInterval(upnpRenewTimer); upnpRenewTimer = null; }
  const client = upnpClient;
  upnpClient = null;
  const port = externalPort;
  externalStatus = 'idle';
  externalReason = null;
  publicIp = null;
  externalPort = null;
  if (client && port !== null) {
    try {
      await client.removeMapping({ public: port, protocol: 'tcp' });
      console.log(`[mobile-access] UPnP unmapped :${port}`);
    } catch { /* 매핑이 이미 만료됐거나 공유기 미응답 — 무시 */ }
  }
  try { client?.close(); } catch { /* noop */ }
}

// ─── 공개 API (index.ts / ipc.ts) ───────────────────────────────────────────

/** bootBackend 에서 1회 호출 — Express 참조 저장 + 이전 실행에서 켜져 있었으면 자동 재기동. */
export function initMobileAccess(expressApp: import('express').Express): void {
  expressAppRef = expressApp;
  persisted = loadPersisted();
  if (persisted.enabled) {
    pairingCode = newPairingCode();
    void (async () => {
      try {
        await startHttpListener();
        if (persisted.externalEnabled) await startExternalInternal();
      } catch (err) {
        console.warn('[mobile-access] auto-start failed:', err);
      }
      pushState();
    })();
  }
}

export async function enableMobileAccess(): Promise<MobileAccessState> {
  if (!httpServer) {
    pairingCode = newPairingCode();
    try {
      await startHttpListener();
      persisted.enabled = true;
      savePersisted();
    } catch (err) {
      console.warn('[mobile-access] enable failed:', err);
    }
  }
  pushState();
  return getMobileAccessState();
}

export async function disableMobileAccess(): Promise<MobileAccessState> {
  await disableExternalInternal();
  await stopHttpListener();
  pairingCode = null;
  pairAttempts.clear();
  persisted.enabled = false;
  savePersisted();
  pushState();
  return getMobileAccessState();
}

async function startExternalInternal(): Promise<void> {
  await startHttpsListener();
  await mapUpnp();
  // active 일 때만 주기 갱신(공유기가 임대 만료로 매핑 삭제하는 것 방지).
  if (upnpRenewTimer) clearInterval(upnpRenewTimer);
  upnpRenewTimer = setInterval(() => {
    if (externalStatus === 'active') void mapUpnp().catch(() => {});
  }, (MOBILE_UPNP_LEASE_S / 2) * 1000);
}

async function disableExternalInternal(): Promise<void> {
  await unmapUpnp();
  await stopHttpsListener();
}

export async function enableExternalAccess(): Promise<MobileAccessState> {
  // 외부는 LAN 리스너가 켜져 있어야 의미가 있다 — 안 켜져 있으면 먼저 켠다.
  if (!httpServer) await enableMobileAccess();
  persisted.externalEnabled = true;
  savePersisted();
  // 외부가 켜졌으니 페어링 코드를 강한 코드로 승격(즉시 재발급).
  pairingCode = newPairingCode();
  pairAttempts.clear();
  try {
    await startExternalInternal();
  } catch (err) {
    externalStatus = 'error';
    externalReason = 'upnp';
    console.warn('[mobile-access] enable external failed:', err);
  }
  pushState();
  return getMobileAccessState();
}

export async function disableExternalAccess(): Promise<MobileAccessState> {
  persisted.externalEnabled = false;
  savePersisted();
  await disableExternalInternal();
  // LAN 전용으로 복귀 — 코드를 다시 6자리로 재발급.
  if (httpServer) pairingCode = newPairingCode();
  pairAttempts.clear();
  pushState();
  return getMobileAccessState();
}

/** 새 페어링 코드 발급 — IP 차단 해제 겸용. 기존 세션(이미 페어링된 폰)은 유지된다. */
export function regenMobilePairingCode(): MobileAccessState {
  if (httpServer) {
    pairingCode = newPairingCode();
    pairAttempts.clear();
    pushState();
  }
  return getMobileAccessState();
}

/** before-quit — 소켓·UPnP 매핑 정리(hook 리스너 close 와 병렬). */
export async function stopMobileAccess(): Promise<void> {
  await disableExternalInternal();
  await stopHttpListener();
}
