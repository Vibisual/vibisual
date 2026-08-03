import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer, get as httpsGet, type Server as HttpsServer } from 'node:https';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { Socket, AddressInfo } from 'node:net';
import { app, BrowserWindow } from 'electron';
import { inject, type DispatchFunc } from 'light-my-request';
import { WebSocketServer, WebSocket } from 'ws';
import { Client as NatUpnpClient } from '@runonflux/nat-upnp';
import { generate as generateSelfSigned } from 'selfsigned';
import { handleClientMessage, buildConnectionMessages, type ClientConnection } from '@vibisual/server';
import { createTerminal, writeTerminal, resizeTerminal, killTerminal, type TermSink } from './terminalManager';
import {
  WS_PATH,
  MOBILE_PAIR_CODE_LENGTH,
  MOBILE_PAIR_MAX_ATTEMPTS,
  MOBILE_SESSION_MAX,
  MOBILE_SESSION_COOKIE,
  MOBILE_EXTERNAL_PAIR_CODE_LENGTH,
  MOBILE_PAIR_BAN_MS,
  MOBILE_UPNP_LEASE_S,
  MOBILE_QR_TICKET_TTL_MS,
  MOBILE_QR_TOKEN_BYTES,
  MOBILE_QR_PATH,
  MOBILE_QR_PARAM,
  type MobileAccessState,
  type MobileQrTicket,
  type MobileExternalStatus,
  type MobileExternalReason,
  type WSMessage,
  type AgentConfig,
  type TermCreateFrame,
  type TermWriteFrame,
  type TermResizeFrame,
  type TermKillFrame,
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
//   - 세션 쿠키는 SameSite=Lax — 교차 출처 POST·서브리소스·스크립트가 API 를 못 친다.
//     (Strict 가 아닌 이유는 grantSession 주석 참고: QR 스캔 진입이 구조적으로 막힌다.
//     LAN http 와 외부 https 를 한 쿠키로 공유하므로 Secure 는 붙이지 않는다 — 페어링이 실질 게이트.)
//
// v3.66 — QR 페어링. 주소 타이핑 + 코드 입력을 폰 카메라 스캔 한 번으로 대체한다. 인증 모델은
// 그대로고 **입력 수단만 추가**: 3분짜리 티켓 토큰을 딥링크(MOBILE_QR_PATH?t=…)에 실어 QR 로
// 그리고, 스캔이 그 URL 을 열면 토큰을 상수시간 비교해 **코드 입력과 똑같은 세션 쿠키**를
// 발급한 뒤 `/` 로 302 한다. 티켓은 메모리 전용(미영속)이라 앱을 끄면 사라지고, 실패는 코드
// 입력과 같은 per-IP 밴 카운터를 공유한다.

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

/** §4 v3.66 — QR 페어링 티켓(메모리 전용). 토큰은 딥링크 URL 로만 밖에 나간다. */
interface QrTicket {
  token: string;
  expiresAt: number;
  usedCount: number;
}

let httpServer: HttpServer | null = null;
let httpsServer: HttpsServer | null = null;
let wss: WebSocketServer | null = null;
const wsClients = new Set<WebSocket>();

let persisted: PersistedMobileAccess = defaultPersisted();
let pairingCode: string | null = null;
const pairAttempts = new Map<string, IpAttempt>();
let starting = false;

// §4 v3.66 QR 페어링 티켓 — 영속하지 않는다(앱 종료 = 소멸).
let qrTicket: QrTicket | null = null;
let qrExpiryTimer: ReturnType<typeof setTimeout> | null = null;

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

// ─── §4 v3.66 QR 페어링 티켓 ─────────────────────────────────────────────────

function clearQrTicket(): void {
  if (qrExpiryTimer) {
    clearTimeout(qrExpiryTimer);
    qrExpiryTimer = null;
  }
  qrTicket = null;
}

/** 만료분 지연 정리 — 타이머보다 조회가 먼저 와도 죽은 티켓이 보이지 않게. */
function liveQrTicket(): QrTicket | null {
  if (qrTicket !== null && qrTicket.expiresAt <= Date.now()) clearQrTicket();
  return qrTicket;
}

/**
 * 티켓 딥링크 — 지금 접속 가능한 모든 주소(LAN 인터페이스별 + 외부 https)에 토큰을 붙인다.
 * 주소는 그때그때 계산하므로 외부를 켜거나 끄면 QR 대상 목록도 따라 바뀐다.
 */
function qrTicketUrls(token: string): string[] {
  const bases = lanUrls(httpPortNow());
  const ext = computeExternalUrl();
  if (ext !== null) bases.push(ext);
  const query = `${MOBILE_QR_PATH}?${MOBILE_QR_PARAM}=${token}`;
  return bases.map((base) => `${base}${query}`);
}

function qrTicketView(): MobileQrTicket | null {
  const ticket = liveQrTicket();
  if (ticket === null) return null;
  return { urls: qrTicketUrls(ticket.token), expiresAt: ticket.expiresAt, usedCount: ticket.usedCount };
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
    qrTicket: httpServer !== null ? qrTicketView() : null,
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

/** IPv4-mapped IPv6(`::ffff:a.b.c.d`) 접두를 벗겨 순수 주소로. */
function normalizeIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

/**
 * §4 v3.33 — 이 접속이 **자기 LAN/로컬**에서 온 것인가(= 임베디드 셸 허용 대상).
 * 공인 IP(인터넷·UPnP 경유)면 false → 셸 프레임 거부. loopback·사설 IPv4·IPv6 ULA/link-local 은 LAN.
 */
function isLanClient(ip: string): boolean {
  const a = normalizeIp(ip).toLowerCase();
  if (a === '::1' || a === 'localhost') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(a)) return !isPubliclyRoutable(a); // 사설/loopback IPv4 = LAN
  if (a.startsWith('fe80:')) return true; // link-local
  if (a.startsWith('fc') || a.startsWith('fd')) return true; // ULA (fc00::/7)
  return false;
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

/**
 * §4 v3.33 — WS Origin 검사(ttyd `--check-origin` 등가, 심층 방어). 브라우저 WS 핸드셰이크의
 * Origin 이 접속 Host 와 동일 출처인지 확인해 교차 출처 페이지의 소켓 탈취를 막는다(SameSite=Lax
 * 쿠키 위 이중 방어). 비브라우저(Origin 부재)는 통과 — 쿠키·Host 가드가 여전히 게이트.
 */
function isSameOriginWs(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = (req.headers.host ?? '').toLowerCase();
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

// ─── 페어링 페이지 ───────────────────────────────────────────────────────────

/**
 * 페어링 페이지. `qrNote` 는 §4 v3.66 QR 딥링크가 실패했을 때(만료·잘못된 토큰·차단 중)
 * 왜 자동 접속이 안 됐는지 알리고 수기 코드 입력으로 폴백시키는 안내다.
 */
function pairingPageHtml(locked: boolean, codeLen: number, qrNote: string | null): string {
  const lockedNote = locked
    ? '<p class="err">Too many failed attempts from your device — try again later or regenerate the code on the desktop. / 실패가 누적되어 잠시 차단되었습니다. 잠시 후 다시 시도하거나 데스크톱에서 새 코드를 발급하세요.</p>'
    : '';
  const qrNoteHtml =
    qrNote === 'expired'
      ? '<p class="note">This QR code has expired — issue a new one on the desktop, or enter the pairing code below. / QR 코드가 만료되었습니다. 데스크톱에서 새로 발급하거나 아래에 페어링 코드를 입력해 주세요.</p>'
      : qrNote === 'locked'
        ? '<p class="note">QR pairing is temporarily blocked from this device. / 이 기기에서의 QR 페어링이 잠시 차단되었습니다.</p>'
        : qrNote === 'cookie'
          ? '<p class="note">QR pairing succeeded, but this browser did not keep the session cookie — open the link in your default browser (Safari/Chrome) instead of an in-app browser, and turn off private mode. / QR 페어링 자체는 성공했지만 이 브라우저가 세션 쿠키를 저장하지 않았습니다. 카카오톡·인스타그램 같은 앱 내장 브라우저 대신 기본 브라우저(Safari·Chrome)로 열고, 시크릿 모드를 꺼 주세요.</p>'
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
  .note { margin: 0 0 14px; padding: 10px 12px; border-radius: 10px; font-size: 12px; line-height: 1.5;
          color: #fcd34d; background: rgba(245,158,11,.08); border: 1px solid rgba(245,158,11,.24); }
</style>
</head>
<body>
<div class="card">
  <h1>Vibisual</h1>
  ${qrNoteHtml}
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

/**
 * 페어링 성공 처리 — 세션 토큰을 발급해 영속 목록에 넣고 HttpOnly 쿠키로 심는다.
 * 코드 입력(handlePairRequest)과 QR 딥링크(handleQrRedeem)가 **같은 경로**를 쓴다.
 *
 * §4 v3.87 — `SameSite` 는 반드시 **Lax**. Strict 로 두면 QR 페어링이 구조적으로 깨진다:
 * 쿠키 발급 자체는 되지만, QR 스캔은 **외부 앱(카메라·스캐너·인앱 브라우저)이 시작한 최상위
 * 내비게이션**이라 이어지는 `/` 요청에 브라우저가 Strict 쿠키를 싣지 않는다 → 미인증으로
 * 도착 → 페어링 코드 화면. (코드 입력은 페어링 페이지가 자기 출처에서 fetch 로 받고
 * `location.replace('/')` 로 같은 사이트 안에서 이동해 Strict 조건을 만족했기에 멀쩡했다 —
 * 즉 발급이 아니라 **되돌아오는 길**만 막혔던 것.)
 * Lax 는 최상위 GET 내비게이션에만 쿠키를 허용하고 교차 출처 POST·서브리소스·스크립트
 * 요청은 그대로 막으므로, 실질 방어선(페어링 게이트 · Host IP-리터럴 가드 · WS Origin 검사 ·
 * `/api` 가 전부 POST/WS)은 약해지지 않는다.
 * (LAN http 와 외부 https 를 한 쿠키로 공유하므로 Secure 는 붙이지 않는다.)
 */
function grantSession(res: ServerResponse): void {
  const session = randomBytes(24).toString('hex');
  persisted.sessions = [session, ...persisted.sessions].slice(0, MOBILE_SESSION_MAX);
  savePersisted();
  res.setHeader(
    'set-cookie',
    `${MOBILE_SESSION_COOKIE}=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_COOKIE_MAX_AGE_S}`,
  );
}

/** 실패 1회 기록 — 한도를 넘으면 그 IP 만 일정 시간 차단(코드 입력·QR 공용 카운터). */
function recordPairFailure(ip: string, now: number): IpAttempt {
  const next: IpAttempt = pairAttempts.get(ip) ?? { count: 0, bannedUntil: 0 };
  next.count += 1;
  if (next.count >= MOBILE_PAIR_MAX_ATTEMPTS) {
    next.bannedUntil = now + MOBILE_PAIR_BAN_MS;
    next.count = 0;
    console.warn(`[mobile-access] pairing temporarily banned for ${ip} (repeated failures)`);
  }
  pairAttempts.set(ip, next);
  return next;
}

function redirectTo(res: ServerResponse, location: string): void {
  res.statusCode = 302;
  res.setHeader('location', location);
  res.setHeader('cache-control', 'no-store');
  res.end();
}

/**
 * §4 v3.66 — QR 딥링크(`/mobile/qr?t=…`) 소비. 토큰이 유효하면 코드 입력과 동일한 세션 쿠키를
 * 심고 앱(`/`)으로 302 한다. 실패는 페어링 페이지로 되돌려 수기 입력 폴백을 남긴다.
 */
function handleQrRedeem(req: IncomingMessage, res: ServerResponse): void {
  req.resume();
  // 이미 페어링된 기기가 예전 QR 을 다시 열었을 뿐이면 티켓을 건드리지 않고 앱으로 보낸다.
  if (isAuthedRequest(req)) {
    redirectTo(res, '/');
    return;
  }
  const ip = clientIp(req);
  const now = Date.now();
  const attempt = pairAttempts.get(ip);
  if (attempt && attempt.bannedUntil > now) {
    redirectTo(res, '/?qr=locked');
    return;
  }
  const query = (req.url ?? '').split('?')[1] ?? '';
  const token = new URLSearchParams(query).get(MOBILE_QR_PARAM) ?? '';
  const ticket = liveQrTicket();
  const ok =
    ticket !== null &&
    token.length === ticket.token.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(ticket.token));
  if (!ok || ticket === null) {
    recordPairFailure(ip, now);
    redirectTo(res, '/?qr=expired');
    pushState();
    return;
  }
  pairAttempts.delete(ip);
  ticket.usedCount += 1;
  grantSession(res);
  // §4 v3.87 — `?paired=1` 표식을 달아 보낸다. 정상이면 다음 요청이 쿠키를 물고 와 인증되고
  // handleRequest 가 파라미터를 떼어 `/` 로 한 번 더 보낸다. 그런데도 미인증으로 돌아오면
  // "브라우저가 쿠키를 저장하지 않았다"가 확정되므로(인앱 브라우저·시크릿 모드) 그 사유를
  // 페어링 페이지에 띄운다 — 종전엔 설명 없는 코드 화면이라 원인을 알 길이 없었다.
  redirectTo(res, '/?paired=1');
  console.log(`[mobile-access] device paired via QR from ${ip}`);
  pushState();
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
      grantSession(res);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
      console.log(`[mobile-access] device paired from ${ip}`);
      pushState();
      return;
    }
    const next = recordPairFailure(ip, now);
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

// §4 v3.28 — 정적 번들 gzip. 텍스트 계열만 압축(이미지·woff2 는 이미 압축돼 gzip 이 역효과).
const GZIP_EXT = new Set(['.html', '.js', '.mjs', '.css', '.svg', '.json', '.txt', '.map', '.wasm', '.ttf']);

// 압축본을 (filePath → {mtime, gzip}) 로 메모리 캐시 — 파일당 1회만 압축하고 이후 재사용해
// 매 요청 압축 CPU 를 없앤다(assets 는 immutable 캐시라 요청 자체도 드묾). mtime 이 바뀌면
// (앱 업데이트) 재압축. 전송 바이트가 줄어 오히려 서빙이 빨라진다.
interface GzipCacheEntry { mtimeMs: number; gzip: Buffer }
const gzipCache = new Map<string, GzipCacheEntry>();

function gzipForFile(filePath: string, raw: Buffer, mtimeMs: number): Buffer {
  const cached = gzipCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.gzip;
  const gz = gzipSync(raw, { level: 6 });
  gzipCache.set(filePath, { mtimeMs, gzip: gz });
  return gz;
}

function serveStatic(pathname: string, res: ServerResponse, acceptsGzip: boolean): void {
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
    res.setHeader('vary', 'Accept-Encoding');
    if (acceptsGzip && GZIP_EXT.has(ext) && body.length >= 1024) {
      const gz = gzipForFile(filePath, body, statSync(filePath).mtimeMs);
      res.setHeader('content-encoding', 'gzip');
      res.end(gz);
    } else {
      res.end(body);
    }
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
  const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
  if (req.method === 'POST' && pathname === '/mobile/pair') { handlePairRequest(req, res); return; }
  // §4 v3.66 — QR 딥링크. 인증 전에 처리해야 스캔 즉시 세션을 받는다.
  // §4 v3.87 — 끝 슬래시도 받는다. URL 을 정규화하는 스캐너가 `/mobile/qr/` 로 열면 종전엔
  // 완전일치에서 탈락해 아무 설명 없이 페어링 코드 화면으로 새어 나갔다.
  if ((req.method === 'GET' || req.method === 'HEAD') && (pathname === MOBILE_QR_PATH || pathname === `${MOBILE_QR_PATH}/`)) {
    handleQrRedeem(req, res);
    return;
  }
  if (!isAuthedRequest(req)) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      // §4 v3.87 — QR 로 세션을 발급받고도 미인증으로 돌아왔다면 쿠키가 저장되지 않은 것이다.
      const qrNote = query.get('paired') === '1' ? 'cookie' : query.get('qr');
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(pairingPageHtml(anyBanned(), pairCodeLength(), qrNote));
    } else {
      res.statusCode = 401; res.end();
    }
    req.resume();
    return;
  }
  // §4 v3.87 — 인증된 채로 `?paired=1` 이 남아 있으면 표식을 떼고 깨끗한 `/` 로 보낸다.
  if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/' && query.get('paired') === '1') {
    redirectTo(res, '/');
    req.resume();
    return;
  }
  if (pathname.startsWith('/api') || pathname === '/health' || pathname.startsWith('/iframe-proxy')) {
    dispatchToExpress(req, res);
    return;
  }
  const acceptEncoding = req.headers['accept-encoding'];
  const acceptsGzip = typeof acceptEncoding === 'string' && /\bgzip\b/.test(acceptEncoding);
  serveStatic(pathname, res, acceptsGzip);
  req.resume();
}

// ─── WebSocket 브리지 ────────────────────────────────────────────────────────

/**
 * §4 v3.28 — 모바일 전용 WebSocket 서버. `perMessageDeflate` 로 실시간 이벤트 JSON
 * (에이전트 스트림·터미널 출력·graph_snapshot)을 압축 전송해 셀룰러 데이터를 절약한다
 * (텍스트라 통상 5~10배). 브라우저 native WebSocket 이 핸드셰이크에서 자동 협상하므로
 * 클라이언트 무수정. 데스크톱 렌더러는 IPC 경로라 이 소켓을 안 타 성능 무영향.
 * 성능·메모리를 무시할 수준으로 묶기 위해:
 *   - threshold 1024 — 작고 잦은 프레임은 압축을 건너뛴다(압축 CPU 낭비 방지).
 *   - {server,client}NoContextTakeover — 메시지 간 슬라이딩 윈도우를 안 남겨 연결당
 *     메모리를 상한(ws 가 기본 off 였던 이유가 메모리 — 그 리스크를 제거).
 *   - concurrencyLimit — 동시 deflate 작업 상한.
 */
function createWss(): WebSocketServer {
  return new WebSocketServer({
    noServer: true,
    perMessageDeflate: {
      threshold: 1024,
      serverNoContextTakeover: true,
      clientNoContextTakeover: true,
      concurrencyLimit: 10,
      zlibDeflateOptions: { level: 6 },
    },
  });
}

function bindUpgrade(server: HttpServer | HttpsServer): void {
  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const pathname = (req.url ?? '').split('?')[0] ?? '';
    // §4 v3.33 — Host·인증에 더해 Origin 검사 추가(교차 출처 소켓 탈취 차단).
    if (pathname !== WS_PATH || !isAllowedHost(req.headers.host) || !isSameOriginWs(req) || !isAuthedRequest(req)) {
      socket.destroy();
      return;
    }
    // §4 v3.33 — 이 접속이 LAN(사설/로컬)인지. 임베디드 셸(term_*)은 LAN 접속에서만 허용한다.
    const terminalAllowed = isLanClient(clientIp(req));
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
          if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
          // §4 v3.33 — 터미널 제어 프레임은 out-of-band 분기(그래프 메시지 핸들러 미오염).
          if (msg.type.startsWith('term_')) { handleTerminalFrame(ws, terminalAllowed, msg.type, msg.payload); return; }
          handleClientMessage(msg, conn);
        } catch { /* 비 JSON 프레임 무시 */ }
      });
      ws.on('close', () => { wsClients.delete(ws); pushState(); });
      ws.on('error', () => { /* close 가 정리 */ });
      pushState();
    });
  });
}

// ─── §4 v3.33 모바일 임베디드 터미널 (/ws 다중화) ────────────────────────────
//
// 데스크톱은 IPC(`vibisual:term:*`)로 PTY 에 붙지만, 모바일 브라우저는 `window.api` 가 없어
// 그 IPC 가 없다. 그래서 이 `/ws` 소켓에 터미널 프레임을 얹어 나른다(새 소켓/레이어 ❌).
// 셸은 실제 로컬 프로세스이므로 **LAN 접속(isLanClient)에서만** 생성하고, 외부(공인 IP·UPnP)
// 접속의 create 는 거부해 `term_unavailable(external)` 로 회신한다(§4 v3.33 보안 게이트).

let wsSinkSeq = 0;
const wsSinkIds = new WeakMap<WebSocket, string>();

function wsSinkId(ws: WebSocket): string {
  let id = wsSinkIds.get(ws);
  if (!id) { id = `ws:${++wsSinkSeq}`; wsSinkIds.set(ws, id); }
  return id;
}

function sendTermFrame(ws: WebSocket, type: string, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, payload, timestamp: Date.now() }));
}

/** 이 ws 를 출력 대상으로 하는 TermSink — PTY 바이트를 term_data/term_exit 프레임으로 흘린다. */
function wsTermSink(ws: WebSocket): TermSink {
  return {
    id: wsSinkId(ws),
    sendData: (termId, data) => sendTermFrame(ws, 'term_data', { termId, data }),
    sendExit: (termId, exitCode) => sendTermFrame(ws, 'term_exit', { termId, exitCode }),
    isAlive: () => ws.readyState === WebSocket.OPEN,
  };
}

function handleTerminalFrame(ws: WebSocket, terminalAllowed: boolean, type: string, payload: unknown): void {
  const p = (payload ?? {}) as Partial<TermCreateFrame & TermWriteFrame & TermResizeFrame & TermKillFrame>;
  if (typeof p.termId !== 'string' || !p.termId) return;
  switch (type) {
    case 'term_create': {
      if (!terminalAllowed) {
        // 외부(인터넷) 접속 — 셸을 열지 않고 안내만. 클라는 ack 대신 이 프레임으로 unavailable 처리.
        sendTermFrame(ws, 'term_unavailable', { termId: p.termId, reason: 'external' });
        return;
      }
      const r = createTerminal(wsTermSink(ws), {
        termId: p.termId,
        cwd: typeof p.cwd === 'string' ? p.cwd : '',
        config: p.config as AgentConfig,
        cols: p.cols,
        rows: p.rows,
      });
      sendTermFrame(ws, 'term_ack', { termId: p.termId, ok: r.ok, error: r.error });
      return;
    }
    case 'term_write':
      if (terminalAllowed && typeof p.data === 'string') writeTerminal(p.termId, p.data);
      return;
    case 'term_resize':
      if (terminalAllowed && typeof p.cols === 'number' && typeof p.rows === 'number') {
        resizeTerminal(p.termId, p.cols, p.rows);
      }
      return;
    case 'term_kill':
      killTerminal(p.termId);
      return;
  }
}

/** broadcast sink 팬아웃 — index.ts 의 setBroadcastSink 콜백이 renderer 푸시와 함께 호출한다.
 *  §9 v3.40 — sink 가 다중 창 팬아웃용으로 이미 직렬화한 문자열이 있으면 재사용(재직렬화 방지). */
export function mobileBroadcast(msg: WSMessage, preSerialized?: string): void {
  if (wsClients.size === 0) return;
  const data = preSerialized ?? JSON.stringify(msg);
  for (const ws of wsClients) if (ws.readyState === WebSocket.OPEN) ws.send(data);
}

// ─── LAN 리스너 라이프사이클 ─────────────────────────────────────────────────

let expressAppRef: import('express').Express | null = null;

async function startHttpListener(): Promise<void> {
  if (httpServer || starting) return;
  starting = true;
  try {
    const server = createServer(handleRequest);
    if (!wss) wss = createWss();
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
  clearQrTicket();
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

/**
 * §4 v3.66 — QR 페어링 티켓 발급. 리스너가 켜져 있을 때만 유효하며, 이미 티켓이 있으면
 * 폐기하고 새로 만든다(화면에 살아 있는 QR 은 항상 한 장). 수명은 MOBILE_QR_TICKET_TTL_MS.
 */
export function issueMobileQrTicket(): MobileAccessState {
  if (httpServer) {
    clearQrTicket();
    qrTicket = {
      token: randomBytes(MOBILE_QR_TOKEN_BYTES).toString('hex'),
      expiresAt: Date.now() + MOBILE_QR_TICKET_TTL_MS,
      usedCount: 0,
    };
    qrExpiryTimer = setTimeout(() => {
      clearQrTicket();
      console.log('[mobile-access] QR pairing ticket expired');
      pushState();
    }, MOBILE_QR_TICKET_TTL_MS);
    console.log(`[mobile-access] QR pairing ticket issued (valid ${Math.round(MOBILE_QR_TICKET_TTL_MS / 1000)}s)`);
    pushState();
  }
  return getMobileAccessState();
}

/** §4 v3.66 — QR 티켓 즉시 폐기(3분을 못 기다릴 때). 이미 페어링된 기기는 그대로 유지된다. */
export function revokeMobileQrTicket(): MobileAccessState {
  if (qrTicket !== null) {
    clearQrTicket();
    console.log('[mobile-access] QR pairing ticket revoked');
    pushState();
  }
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
  clearQrTicket();
  await disableExternalInternal();
  await stopHttpListener();
}
