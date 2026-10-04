import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { exec, spawn } from 'node:child_process';
import { loopbackUrlVariants, previewUrlForServer } from '@vibisual/shared';
import { logger } from '../logger.js';
import { killTree } from './processTree.js';

const TCP_TIMEOUT = 1000;
const HTTP_PROBE_TIMEOUT = 2500;

/** 단일 호스트에 TCP connect 시도 */
function probeHost(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (alive: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(TCP_TIMEOUT);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

/** 포트가 열려있는지 TCP connect로 확인 — IPv4/IPv6 둘 다 시도, 하나라도 성공하면 alive */
export function isPortAlive(port: number): Promise<boolean> {
  return Promise.all([probeHost(port, '127.0.0.1'), probeHost(port, '::1')])
    .then(([v4, v6]) => v4 || v6);
}

/**
 * 신고된 **정확한 URL**(경로·쿼리 포함)에 실제 HTTP GET 을 보내 에러 아닌 응답(2xx/3xx)을
 * 주는지 확인한다. `isPortAlive` 는 TCP listen 만 보므로 `python -m http.server` 처럼
 * 포트는 살아있어도 그 경로가 404 인 경우(사용자 보고: "접속도 안 되는데 왜 켜지냐")를
 * 걸러내지 못한다 — iframe 신고 위성 생성 게이트에서 이 함수로 URL 응답을 추가 검증한다.
 * status < 400 이면 serving, 4xx/5xx·연결 실패·타임아웃은 not serving. 본문은 안 읽고 즉시 파기.
 */
export function isUrlServing(rawUrl: string, timeoutMs = HTTP_PROBE_TIMEOUT): Promise<boolean> {
  return probeUrl(rawUrl, timeoutMs).then((r) => r.ok);
}

/**
 * §7.11 — **접속되는 이름**으로 바꿔 가며 물어, 실제로 응답한 주소를 돌려준다(없으면 null).
 *
 * 같은 서버라도 이름에 따라 붙고 안 붙고가 갈린다: Vite 를 `localhost` 로 열면 Windows 에서는
 * IPv6(`::1`)에만 바인딩돼 `http://127.0.0.1:8080` 은 ECONNREFUSED 다. 한 이름만 묻고 접었던
 * 예전 게이트는 그 서버를 "죽었다"고 판정해 프리뷰를 영영 안 만들었다(실측: `127.0.0.1` 거절,
 * `localhost`·`[::1]` 200). 그래서 루프백 주소는 별칭을 차례로 물어본다.
 *
 * 돌려준 주소를 그대로 iframe 에 실으면 **화면에서도 확실히 열린다** — "확인한 주소"와
 * "보여 주는 주소"가 갈리지 않는다. 루프백이 아닌 주소는 별칭이 없으므로 자기 자신만 시도한다.
 */
export async function resolveServingUrl(
  rawUrl: string,
  timeoutMs = HTTP_PROBE_TIMEOUT,
): Promise<string | null> {
  return (await resolveServingTarget(rawUrl, timeoutMs))?.url ?? null;
}

/** 응답한 주소 + 그 응답이 무엇이었는지(`Content-Type`). 프리뷰 주소 판정에 필요하다. */
export interface ServingTarget {
  /** 실제로 2xx/3xx 를 준 주소(별칭 순회 결과). */
  url: string;
  /** 그 응답의 `Content-Type` 헤더. 안 보내는 서버도 있어 optional. */
  contentType?: string;
}

/** {@link resolveServingUrl} 과 같은 별칭 순회를 하되, 응답의 `Content-Type` 까지 들고 온다. */
export async function resolveServingTarget(
  rawUrl: string,
  timeoutMs = HTTP_PROBE_TIMEOUT,
): Promise<ServingTarget | null> {
  const candidates = loopbackUrlVariants(rawUrl);
  for (const candidate of candidates.length > 0 ? candidates : [rawUrl]) {
    const res = await probeUrl(candidate, timeoutMs);
    if (res.ok) return { url: candidate, contentType: res.contentType };
  }
  return null;
}

/**
 * §7.11 — **프리뷰 버블에 실을 주소**를 정한다(응답하지 않으면 null).
 *
 * {@link resolveServingUrl} 이 "어느 이름으로 불러야 붙는가"를 풀었다면, 이쪽은 "그 주소를
 * 그대로 열어도 되는가"를 푼다. 감지 폴백이 주운 주소는 대개 에이전트가 확인차 친 API 경로라
 * (`curl …/api/backtest/state`) 그대로 열면 사람이 볼 화면이 아니라 JSON 이 뜬다. 판정 규칙은
 * shared `previewUrlForServer` 한 곳에 있고(순수 함수 — 서버·클라가 같은 답을 낸다), 여기서는
 * 그 답이 원래 주소와 다를 때 **정문이 실제로 응답하는지 한 번 더 확인**한다. 정문이 죽어 있으면
 * 확인된 원래 주소를 그대로 쓴다 — 열리는 주소를 버리고 안 열리는 주소로 바꾸지 않는다.
 */
export async function resolvePreviewUrl(
  rawUrl: string,
  timeoutMs = HTTP_PROBE_TIMEOUT,
): Promise<string | null> {
  const target = await resolveServingTarget(rawUrl, timeoutMs);
  if (!target) return null;
  const preview = previewUrlForServer(target.url, target.contentType);
  if (preview === target.url) return target.url;
  const rootTarget = await resolveServingTarget(preview, timeoutMs);
  return rootTarget?.url ?? target.url;
}

function probeUrl(rawUrl: string, timeoutMs: number): Promise<{ ok: boolean; contentType?: string }> {
  return new Promise((resolve) => {
    let parsed: URL;
    try { parsed = new URL(rawUrl); } catch { resolve({ ok: false }); return; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { resolve({ ok: false }); return; }
    const lib = parsed.protocol === 'https:' ? https : http;
    let settled = false;
    const done = (ok: boolean, contentType?: string): void => {
      if (settled) return;
      settled = true;
      resolve({ ok, contentType });
    };
    try {
      // localhost self-signed 대비 rejectUnauthorized:false — 표시용 probe 라 인증서 무관.
      const req = lib.request(rawUrl, { method: 'GET', timeout: timeoutMs, rejectUnauthorized: false }, (res) => {
        const status = res.statusCode ?? 0;
        const ct = res.headers['content-type'];
        res.destroy(); // 상태코드·헤더만 필요 — 본문은 버린다
        done(status >= 200 && status < 400, typeof ct === 'string' ? ct : undefined);
      });
      req.once('timeout', () => { req.destroy(); done(false); });
      req.once('error', () => done(false));
      req.end();
    } catch { done(false); }
  });
}

/** 포트 점유자 조회 명령 1회당 상한. 넘으면 "못 봤다"로 보고 다음 후보로 넘어간다. */
const PORT_LOOKUP_TIMEOUT_MS = 3000;

/**
 * {@link killByPortDetailed} 의 결과 구분.
 *
 * `not-listening`(포트가 비어 있다)과 `no-tool`(볼 도구가 없어서 못 봤다)을 **반드시 나눠야 한다** —
 * 예전 구현은 POSIX 에서 `lsof` 하나만 쓰고 exec 에러를 통째로 삼켜 둘 다 `false` 로 뭉갰다.
 * `lsof` 는 macOS 엔 항상 있지만 최소구성 Linux(컨테이너·서버 배포판)엔 없는 경우가 있어서,
 * 그런 환경의 사용자는 "포트 킬이 그냥 안 먹는다"만 겪고 이유를 알 길이 없었다.
 */
export type KillByPortOutcome =
  /** 점유 프로세스를 찾아 종료를 지시했다. */
  | 'killed'
  /** 조회는 성공했고 그 포트를 LISTEN 중인 프로세스가 없다. */
  | 'not-listening'
  /** 이 시스템에 포트 점유자를 조회할 도구가 하나도 없다(= 결과를 모른다, 비어 있다는 뜻이 아니다). */
  | 'no-tool'
  /** 포트 번호가 유효하지 않다. */
  | 'invalid-port'
  /** 우리 자신(또는 부모) 프로세스가 그 포트를 쥐고 있어 자살을 거부했다. */
  | 'self';

export interface KillByPortResult {
  killed: boolean;
  outcome: KillByPortOutcome;
  /** 실제로 종료를 지시한 PID 들. */
  pids: number[];
  /** 점유자를 찾아낸 조회 수단(`netstat` · `lsof` · `ss` · `fuser` · `/proc/net/tcp`). */
  via?: string;
}

// ─── 포트 점유자 조회 출력 파서 (순수 함수 — 플랫폼 무관하게 단위 테스트 가능) ───

function uniquePositiveInts(values: number[]): number[] {
  return [...new Set(values)].filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * 포트를 LISTEN 중인 소켓 하나 — **누가(pid) 어느 주소에(address) 묶였나.**
 *
 * §7.11 — 한 포트에 주인이 둘일 수 있다. Windows·macOS 는 서로 다른 프로세스가 같은 포트를
 * 다른 주소로 동시에 잡는다(실측 2026-10-01: 한 프로젝트의 `node serve.js` 가 `::`(=`0.0.0.0`+`[::]`),
 * 옆 프로젝트의 vite 가 `[::1]` 에 같은 8080 으로 공존). `localhost`·`[::1]` 접속은 `[::1]` 리스너로,
 * `127.0.0.1` 은 와일드카드로 간다 — 그래서 "이 포트는 누구 것인가"가 아니라 "**이 주소는 누구에게
 * 닿는가**"를 물어야 하고, 그러려면 리스너마다 주소가 필요하다.
 *
 * `address` 는 {@link normalizeListenAddress} 로 접은 모양(`::1` · `::` · `0.0.0.0` · `127.0.0.1` · `*`).
 * 주소를 주지 않는 도구(fuser)의 결과는 `undefined` — "모두 후보"로 읽는다.
 */
export interface PortListener {
  pid: number;
  address?: string;
}

/**
 * 리스너 주소를 한 모양으로 접는다. 대괄호·존 접미(`%lo`·`%12`)·대소문자를 걷고,
 * IPv4 사상 주소(`::ffff:127.0.0.1`)는 IPv4 로 되돌린다. `*` 는 그대로 둔다(패밀리 미상 와일드카드).
 */
export function normalizeListenAddress(raw: string): string {
  let a = raw.trim().toLowerCase();
  if (a.startsWith('[') && a.includes(']')) a = a.slice(1, a.indexOf(']'));
  const zone = a.indexOf('%');
  if (zone >= 0) a = a.slice(0, zone);
  const mapped = a.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped?.[1]) return mapped[1];
  return a;
}

/** `host:port` 끝의 포트를 떼고 주소만 돌려준다(`[::1]:8080` → `::1`). 포트가 다르면 null. */
function splitEndpoint(endpoint: string, port: number): string | null {
  const colon = endpoint.lastIndexOf(':');
  if (colon <= 0) return null;
  if (endpoint.slice(colon + 1) !== String(port)) return null;
  return normalizeListenAddress(endpoint.slice(0, colon));
}

/**
 * Windows `netstat -ano` 출력에서 해당 포트를 LISTEN 중인 소켓(pid + 주소)을 뽑는다.
 *
 * ⚠ 두 함정을 함께 막는다.
 *  - **IPv6 표를 봐야 한다.** 종전 `netstat -ano -p TCP` 는 IPv4 표만 준다. Windows 의 Vite 는
 *    `localhost` 로 열면 `[::1]` 에만 묶이므로 그 서버가 **영영 안 보였다** — 소속 판정이 늘
 *    "못 읽음"으로 떨어져 남의 프로젝트 프리뷰가 붙고 안 걷혔다(실측 2026-10-01). 호출부는
 *    `-p` 없이 TCP·TCPv6 를 함께 읽는다.
 *  - **상태 단어는 번역된다.** 독일어 Windows 는 `LISTENING` 대신 `ABHÖREN` 을 찍는다. LISTEN 소켓의
 *    상대 주소는 언제나 와일드카드(`0.0.0.0:0` · `[::]:0` · `*:*`)이므로 그것으로도 판정한다
 *    (`-a` 는 bound-nonlistening 소켓을 보이지 않는다 — 그건 `-q` 의 몫이다).
 *  - 예전 `findstr :4800` 은 `127.0.0.1:48000` 도 잡았다 — 포트는 끝자리까지 정확히 맞춘다.
 */
export function parseNetstatListeners(stdout: string, port: number): PortListener[] {
  const out: PortListener[] = [];
  const seen = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const f = line.trim().split(/\s+/);
    // Proto Local Foreign State PID — UDP 는 State 칸이 없고 애초에 대상이 아니다.
    if (f.length < 5 || f[0]?.toUpperCase() !== 'TCP') continue;
    const address = splitEndpoint(f[1] ?? '', port);
    if (address === null) continue;
    const foreign = f[2] ?? '';
    const state = f[3] ?? '';
    const listening = state.toUpperCase() === 'LISTENING' || /^(?:0\.0\.0\.0:0|\[::\]:0|\*:\*)$/.test(foreign);
    if (!listening) continue;
    const pid = Number(f[f.length - 1]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const key = `${String(pid)}@${address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ pid, address });
  }
  return out;
}

/** 리스너 목록 → PID 목록(중복 제거). */
export function listenerPids(listeners: readonly PortListener[]): number[] {
  return uniquePositiveInts(listeners.map((l) => l.pid));
}

/** Windows `netstat -ano` 출력에서 해당 포트를 LISTEN 중인 PID — {@link parseNetstatListeners} 의 PID 만. */
export function parseNetstatListeningPids(stdout: string, port: number): number[] {
  return listenerPids(parseNetstatListeners(stdout, port));
}

/** `lsof -t` 출력 = PID 한 줄에 하나. */
export function parseLsofPids(stdout: string): number[] {
  return uniquePositiveInts(
    stdout.split(/\r?\n/).map((l) => Number(l.trim())).filter((n) => !Number.isNaN(n)),
  );
}

/**
 * `lsof -iTCP:<port> -sTCP:LISTEN -P -n -F ptn` 출력 → 리스너(pid + 주소).
 *
 * 줄 머리 글자가 필드다: `p<pid>` · `f<fd>`(파일 하나의 시작) · `t<IPv4|IPv6>` · `n<주소:포트>`.
 * `*:8080` 은 패밀리를 `t` 로 가른다(IPv4 → `0.0.0.0`, IPv6 → `::`). `t` 가 없으면 `*` 로 둔다.
 */
export function parseLsofListeners(stdout: string, port: number): PortListener[] {
  const out: PortListener[] = [];
  const seen = new Set<string>();
  let pid = 0;
  let family = '';
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length < 2) continue;
    const tag = line[0];
    const value = line.slice(1);
    if (tag === 'p') { pid = Number(value); family = ''; continue; }
    if (tag === 'f') { family = ''; continue; }
    if (tag === 't') { family = value.toUpperCase(); continue; }
    if (tag !== 'n' || !Number.isInteger(pid) || pid <= 0) continue;
    let address = splitEndpoint(value.replace(/\s*\(LISTEN\)\s*$/i, ''), port);
    if (address === null) continue;
    if (address === '*') address = family === 'IPV4' ? '0.0.0.0' : family === 'IPV6' ? '::' : '*';
    const key = `${String(pid)}@${address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ pid, address });
  }
  return out;
}

/** `ss -lptn` 출력의 `users:(("node",pid=1234,fd=23))` 에서 PID 추출. */
export function parseSsPids(stdout: string): number[] {
  const out: number[] = [];
  for (const m of stdout.matchAll(/pid=(\d+)/g)) out.push(Number(m[1]));
  return uniquePositiveInts(out);
}

/**
 * `ss -lptnH 'sport = :<port>'` 출력 → 리스너(pid + 주소).
 * 칸: State Recv-Q Send-Q 로컬주소:포트 상대주소:포트 users:((…)). `*:8080` 은 이중 스택 와일드카드다.
 * `-p` 권한이 없어 `pid=` 가 빠진 줄은 리스너를 만들지 않는다(다음 도구로 넘어가게).
 */
export function parseSsListeners(stdout: string, port: number): PortListener[] {
  const out: PortListener[] = [];
  const seen = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 5) continue;
    const address = splitEndpoint(f[3] ?? '', port);
    if (address === null) continue;
    for (const m of line.matchAll(/pid=(\d+)/g)) {
      const pid = Number(m[1]);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      const key = `${String(pid)}@${address}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ pid, address });
    }
  }
  return out;
}

/** `fuser -n tcp <port>` 출력에서 PID 추출.
 *  구버전은 `4800/tcp:` 머리표를 stderr 로, 신버전은 stdout 으로 보낸다 — 머리표를 먼저 걷어낸다
 *  (안 걷으면 포트 번호 4800 자체를 PID 로 오독한다). */
export function parseFuserPids(stdout: string): number[] {
  const body = stdout.replace(/^\s*\d+\/\w+:\s*/gm, ' ');
  return uniquePositiveInts(
    body.split(/\s+/).map((t) => Number(t.trim())).filter((n) => !Number.isNaN(n)),
  );
}

/**
 * Linux `/proc/net/tcp`(+`tcp6`) 에서 해당 포트를 LISTEN(`st=0A`) 중인 소켓의 inode 목록 추출.
 * 외부 도구가 하나도 없는 최소 컨테이너에서 쓰는 마지막 수단 — 커널이 직접 주는 진실이라
 * "도구가 없어서 모름"을 "포트가 비었다"로 오인할 여지가 없다.
 */
export function parseProcNetTcpListenInodes(content: string, port: number): string[] {
  return [...new Set(parseProcNetTcpListeners(content, port).map((l) => l.inode))];
}

/**
 * `/proc/net/tcp`(+`tcp6`)의 16진 주소 → 사람이 읽는 주소. 커널은 32비트 낱말을 **호스트 바이트
 * 순서**로 찍으므로(리틀엔디언 = x86·ARM) 낱말마다 바이트를 뒤집는다.
 * IPv6 는 우리가 쓰는 모양만 접는다(`::` · `::1` · `::ffff:a.b.c.d` → IPv4). 그 밖은 접지 않은 8조각.
 */
export function decodeProcNetAddress(hex: string, littleEndian = true): string | null {
  if (!/^[0-9A-Fa-f]+$/.test(hex) || (hex.length !== 8 && hex.length !== 32)) return null;
  const bytes: number[] = [];
  for (let w = 0; w < hex.length; w += 8) {
    const word = [0, 2, 4, 6].map((i) => parseInt(hex.slice(w + i, w + i + 2), 16));
    bytes.push(...(littleEndian ? word.reverse() : word));
  }
  if (bytes.length === 4) return bytes.join('.');
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
  if (groups.every((g) => g === 0)) return '::';
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return '::1';
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) return bytes.slice(12).join('.');
  return groups.map((g) => g.toString(16)).join(':');
}

/** `/proc/net/tcp(6)` 에서 해당 포트를 LISTEN(`st=0A`) 중인 소켓의 inode + 주소. */
export function parseProcNetTcpListeners(content: string, port: number): { inode: string; address?: string }[] {
  const hex = port.toString(16).toUpperCase().padStart(4, '0');
  const out: { inode: string; address?: string }[] = [];
  const seen = new Set<string>();
  for (const raw of content.split(/\r?\n/)) {
    const f = raw.trim().split(/\s+/);
    // sl local_address rem_address st tx rx tr tm retrnsmt uid timeout inode
    if (f.length < 10) continue;
    const local = f[1];
    if (!local || !local.toUpperCase().endsWith(`:${hex}`)) continue;
    if (f[3] !== '0A') continue; // 0A = TCP_LISTEN
    const inode = f[9];
    if (!inode || !/^\d+$/.test(inode) || seen.has(inode)) continue;
    seen.add(inode);
    const address = decodeProcNetAddress(local.slice(0, local.lastIndexOf(':')));
    out.push(address ? { inode, address } : { inode });
  }
  return out;
}

/** inode → PID 역매핑. `/proc/<pid>/fd/*` 심볼릭 링크가 `socket:[<inode>]` 를 가리킨다. */
function mapSocketInodesToPids(inodes: Set<string>): Map<string, number[]> {
  const found = new Map<string, number[]>();
  if (inodes.size === 0) return found;
  let pidDirs: string[];
  try { pidDirs = fs.readdirSync('/proc'); } catch { return found; }
  for (const name of pidDirs) {
    if (!/^\d+$/.test(name)) continue;
    let fds: string[];
    try { fds = fs.readdirSync(`/proc/${name}/fd`); } catch { continue; } // 남의 프로세스 = EACCES
    for (const fd of fds) {
      let link: string;
      try { link = fs.readlinkSync(`/proc/${name}/fd/${fd}`); } catch { continue; }
      const m = link.match(/^socket:\[(\d+)\]$/);
      if (!m?.[1] || !inodes.has(m[1])) continue;
      const list = found.get(m[1]) ?? [];
      if (!list.includes(Number(name))) list.push(Number(name));
      found.set(m[1], list);
    }
  }
  return found;
}

/** 조회 1회의 결과. `available:false` = 그 도구가 이 시스템에 없거나 응답하지 않았다(≠ 포트가 비었다). */
type LookupResult = { available: true; listeners: PortListener[] } | { available: false };

/** 셸 한 줄을 돌려 stdout 을 파서에 넘긴다. 명령 부재(exit 127)·타임아웃은 `available:false`. */
function runLookup(cmd: string, parse: (stdout: string) => PortListener[]): Promise<LookupResult> {
  return new Promise((resolve) => {
    exec(cmd, { timeout: PORT_LOOKUP_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const e = err as Error & { code?: number | string; killed?: boolean };
        // sh 는 명령을 못 찾으면 127 로 끝낸다. Windows 는 ENOENT. 둘 다 "결과 없음"이 아니라 "못 봤다".
        const missing =
          e.code === 127 ||
          e.code === 'ENOENT' ||
          e.killed === true ||
          /not found|not recognized|No such file/i.test(String(stderr ?? ''));
        if (missing) { resolve({ available: false }); return; }
        // 그 외 비정상 종료(lsof/fuser 는 "찾은 게 없음"을 exit 1 로 알린다) = 조회 성공, 결과 0건.
        resolve({ available: true, listeners: parse(String(stdout ?? '')) });
        return;
      }
      resolve({ available: true, listeners: parse(stdout) });
    });
  });
}

/** PID 만 주는 도구(fuser)의 결과 — 주소를 모르므로 `address` 를 비워 "모두 후보"로 둔다. */
function pidsAsListeners(pids: number[]): PortListener[] {
  return pids.map((pid) => ({ pid }));
}

/** Linux `/proc/net/tcp` 직접 읽기. 파일이 없으면(=macOS 등) `available:false`. */
function lookupViaProc(port: number): LookupResult {
  const sockets: { inode: string; address?: string }[] = [];
  let any = false;
  for (const p of ['/proc/net/tcp', '/proc/net/tcp6']) {
    try { sockets.push(...parseProcNetTcpListeners(fs.readFileSync(p, 'utf8'), port)); any = true; } catch { /* 없으면 건너뜀 */ }
  }
  if (!any) return { available: false };
  if (sockets.length === 0) return { available: true, listeners: [] };
  const byInode = mapSocketInodesToPids(new Set(sockets.map((s) => s.inode)));
  const listeners: PortListener[] = [];
  for (const s of sockets) {
    for (const pid of byInode.get(s.inode) ?? []) listeners.push(s.address ? { pid, address: s.address } : { pid });
  }
  return { available: true, listeners };
}

/**
 * §7.11 — **이 주소로 접속하면 어느 리스너에 닿는가.** 호스트별 계층(앞 계층에 리스너가 있으면 그것)이다.
 *
 *  - `[::1]`     : `::1` → `::`·`*`(IPv6 와일드카드 = 이중 스택 포함)
 *  - `127.x.x.x` : 그 주소 → `0.0.0.0`·`*` → `::`(이중 스택이 IPv4 사상으로 받는다)
 *  - `localhost` : IPv6 계층 먼저, 그다음 IPv4 — Node(undici)·Chromium 모두 `::1` 부터 시도하고
 *                  거절되면 `127.0.0.1` 로 넘어간다.
 *  - 그 밖(LAN 주소 등): 계층을 모른다 → `null`(호출부가 "모두 후보"로 읽는다).
 *
 * 특정 주소에 묶인 소켓이 와일드카드보다 먼저다 — Windows·BSD 는 둘이 공존할 때 특정 주소가 이긴다.
 */
export function listenerTiersForHost(host: string): string[][] | null {
  const h = normalizeListenAddress(host);
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0' || h === '::' || h === '*') {
    return [['::1'], ['::', '*'], ['127.0.0.1'], ['0.0.0.0']];
  }
  if (h === '::1') return [['::1'], ['::', '*']];
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return [[h], ['0.0.0.0', '*'], ['::']];
  return null;
}

/**
 * 리스너 목록 중 **그 호스트로 접속했을 때 실제로 받는 것들**(첫 계층). 닿는 것이 없으면 빈 배열.
 * 주소를 모르는 리스너가 하나라도 섞였거나(fuser) 계층을 모르는 호스트면 전부 돌려준다 — 가를 수 없을 때
 * 가른 척하지 않는다.
 */
export function reachableListeners(listeners: readonly PortListener[], host: string): PortListener[] {
  if (listeners.length === 0) return [];
  if (listeners.some((l) => l.address === undefined)) return [...listeners];
  const tiers = listenerTiersForHost(host);
  if (!tiers) return [...listeners];
  for (const tier of tiers) {
    const hit = listeners.filter((l) => l.address !== undefined && tier.includes(l.address));
    if (hit.length > 0) return hit;
  }
  return [];
}

/** URL 의 호스트(대괄호 벗김). 파싱이 안 되면 null. */
export function urlHostname(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  try { return new URL(rawUrl).hostname.replace(/^\[|\]$/g, '').toLowerCase() || null; } catch { return null; }
}

/**
 * 포트 리스너 조회 결과 — {@link killByPortDetailed} · 포트 인계 · §7.11 소속 판정의 공통 반환.
 *
 * `anyToolWorked` 가 **결과의 신뢰도**다. `listeners` 가 비었을 때 이 값이 false 면 "볼 도구가 없어서
 * 못 봤다"이고, true 면 "정말 아무도 LISTEN 하지 않는다"이다 — 두 경우의 처방이 다르다.
 */
export interface PortListenerLookup {
  listeners: PortListener[];
  anyToolWorked: boolean;
  via?: string;
}

/**
 * 포트를 LISTEN 중인 소켓(pid + 묶인 주소)을 찾는다(종료하지 않는다).
 *
 * 조회 수단은 플랫폼별 후보를 순서대로 시도하고, 하나라도 "동작했다"면 그 결과를 채택한다.
 *   - Windows: `netstat -ano` (TCP + **TCPv6** — `-p TCP` 는 IPv4 만 준다)
 *   - POSIX  : `lsof -F ptn` → `ss` → `fuser`(주소 없음) → `/proc/net/tcp(6)`
 *
 * {@link killByPortDetailed}(죽이기)·§7.11 포트 인계(살려 둔 채 기동 명령 읽기)·§7.11 프로젝트 격리
 * (누구 서버인가)가 **같은 조회 경로를 공유**해야 한다 — 한쪽만 도구 후보가 늘거나 파서가 고쳐지면
 * "끌 수는 있는데 넘겨받지는 못하는" 비대칭이 생긴다.
 *
 * @param platform 세 OS 를 한 기기에서 테스트하기 위해 인자로 받는다(기본 = 실제 플랫폼).
 */
export async function findPortListeners(
  port: number,
  platform: NodeJS.Platform = process.platform,
): Promise<PortListenerLookup> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { listeners: [], anyToolWorked: false };
  }

  const candidates: { via: string; run: () => Promise<LookupResult> | LookupResult }[] = platform === 'win32'
    ? [
        { via: 'netstat', run: () => runLookup('netstat -ano', (o) => parseNetstatListeners(o, port)) },
      ]
    : [
        { via: 'lsof', run: () => runLookup(`lsof -iTCP:${port} -sTCP:LISTEN -P -n -F ptn`, (o) => parseLsofListeners(o, port)) },
        { via: 'ss', run: () => runLookup(`ss -lptnH 'sport = :${port}'`, (o) => parseSsListeners(o, port)) },
        { via: 'fuser', run: () => runLookup(`fuser -n tcp ${port} 2>/dev/null`, (o) => pidsAsListeners(parseFuserPids(o))) },
        { via: '/proc/net/tcp', run: () => lookupViaProc(port) },
      ];

  let anyToolWorked = false;
  for (const c of candidates) {
    const res = await c.run();
    if (!res.available) continue;
    anyToolWorked = true;
    // 이 도구는 못 찾음 — **여기서 멈추지 않는다.** 비특권 사용자의 `ss -p` 는 LISTEN 줄은 보여주되
    //   `pid=` 를 감추고, `lsof` 는 남의 소유 프로세스를 아예 안 보여준다. 즉 "0건"은 "포트가 비었다"의
    //   증거가 아니다. 다음 도구(최종적으로 커널의 /proc/net/tcp)까지 다 본 뒤에 판정한다.
    if (res.listeners.length === 0) continue;
    return { listeners: res.listeners, anyToolWorked: true, via: c.via };
  }
  return { listeners: [], anyToolWorked };
}

/**
 * 포트 점유자 PID 조회 결과 — {@link findPortListeners} 의 PID 만 본 모양(주소가 필요 없는 호출부용).
 */
export interface PortOwnerLookup {
  pids: number[];
  anyToolWorked: boolean;
  via?: string;
}

/** 포트를 LISTEN 중인 프로세스의 PID 를 찾는다(종료하지 않는다). 주소별로 가르려면 {@link findPortListeners}. */
export async function findPortOwnerPids(port: number): Promise<PortOwnerLookup> {
  const lookup = await findPortListeners(port);
  return {
    pids: listenerPids(lookup.listeners),
    anyToolWorked: lookup.anyToolWorked,
    ...(lookup.via ? { via: lookup.via } : {}),
  };
}

/** {@link killByPortDetailed} 의 범위 — 지정하면 **그 주소로 접속했을 때 닿는 리스너만** 죽인다. */
export interface KillByPortOptions {
  /**
   * 그 서버를 부르는 주소의 호스트(`localhost` · `127.0.0.1` · `::1` …). 비우면 포트의 리스너 전부.
   *
   * §7.11 — 한 포트에 주인이 둘일 수 있다(위 {@link PortListener}). 프로젝트 A 의 Stop 이
   * 같은 포트를 `[::1]` 로 잡은 프로젝트 B 의 서버까지 트리째 죽이면 안 된다.
   */
  host?: string;
}

/**
 * 포트를 LISTEN 중인 프로세스를 찾아 **트리째** 종료한다.
 *
 * 조회는 {@link findPortListeners} 에 위임한다. 전부 없으면 `no-tool` — 호출자가 "포트가 비었다"와
 * 구분할 수 있다. `host` 를 주면 그 주소가 닿는 리스너만 죽이고, 닿는 것이 없으면 `not-listening`
 * (그 주소의 서버는 이미 없다 — 같은 포트의 남은 리스너는 남의 것이다).
 *
 * 종료는 {@link killTree} 로 위임한다(이전엔 `taskkill /F`(트리 아님) / `kill`(SIGTERM, 손자 잔존)을
 * 여기서 따로 재구현했다). `respawn` 이 띄운 dev 서버는 `shell:true` 라 최상단이 셸이고 실제 서버는
 * 그 자식 — 단일 kill 로는 포트가 안 놓인다.
 */
export async function killByPortDetailed(port: number, options: KillByPortOptions = {}): Promise<KillByPortResult> {
  // 보안: port 는 셸 문자열에 보간되므로 정수가 아니면 즉시 거부(인젝션 차단).
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { killed: false, outcome: 'invalid-port', pids: [] };
  }

  const found = await findPortListeners(port);
  const scoped = options.host !== undefined ? reachableListeners(found.listeners, options.host) : found.listeners;
  if (options.host !== undefined && found.listeners.length > 0 && scoped.length === 0) {
    logger.info(`killByPort(${port}): nothing reachable via ${options.host} — other listeners left untouched`);
    return { killed: false, outcome: 'not-listening', pids: [], ...(found.via ? { via: found.via } : {}) };
  }
  const lookup: PortOwnerLookup = {
    pids: listenerPids(scoped),
    anyToolWorked: found.anyToolWorked,
    ...(found.via ? { via: found.via } : {}),
  };
  if (lookup.pids.length > 0) {
    // 자살 방지: 우리 자신/부모가 그 포트를 쥐고 있으면 죽이지 않는다(그룹 킬이면 앱 전체가 내려간다).
    const targets = lookup.pids.filter((pid) => pid !== process.pid && pid !== process.ppid);
    if (targets.length === 0) {
      logger.warn(`killByPort(${port}): port is held by this process — refusing to kill self`);
      return { killed: false, outcome: 'self', pids: lookup.pids, ...(lookup.via ? { via: lookup.via } : {}) };
    }
    for (const pid of targets) killTree(pid);
    logger.info(`killByPort(${port}): killed tree(s) ${targets.join(', ')} via ${lookup.via}`);
    return { killed: true, outcome: 'killed', pids: targets, ...(lookup.via ? { via: lookup.via } : {}) };
  }

  if (!lookup.anyToolWorked) {
    logger.warn(
      `killByPort(${port}): no way to inspect port owners on this system — ` +
        `install one of lsof / iproute2(ss) / psmisc(fuser), or run on a kernel exposing /proc/net/tcp`,
    );
    return { killed: false, outcome: 'no-tool', pids: [] };
  }
  return { killed: false, outcome: 'not-listening', pids: [] };
}

/** 포트를 점유 중인 프로세스를 kill. 세부 사유가 필요하면 {@link killByPortDetailed} 를 쓸 것.
 *  `options.host` 를 주면 그 주소가 닿는 리스너만 죽인다(§7.11 — 한 포트 두 주인). */
export function killByPort(port: number, options: KillByPortOptions = {}): Promise<boolean> {
  return killByPortDetailed(port, options).then((r) => r.killed);
}

/**
 * 명령어를 백그라운드로 재실행 (detached).
 * 보안 계약: `command` 는 **서버가 구성한 상수/탐지된 dev 명령**만 허용한다.
 * 클라이언트/사용자 자유입력을 절대 이 함수로 전달하지 말 것 — `cmd /c <command>`
 * 로 셸 실행되므로 그대로 RCE 싱크가 된다.
 */
export function respawn(command: string, cwd?: string): void {
  const effectiveCwd = cwd ?? process.cwd();
  logger.info(`respawn: cwd="${effectiveCwd}" cmd="${command}"`);
  try {
    // §7.11 v2.27 — `shell: true` 위임 (이전 `spawn('cmd', ['/c', command])` 폐기).
    //   이전 방식은 cmd 의 `/c` 가 첫·마지막 `"` 한 쌍을 무조건 strip 하는 단일 규칙과 충돌해
    //   `node -e "..."` 처럼 중첩 따옴표 명령이 깨졌다. libuv 가 args 를 `\"` 로 escape 해도
    //   cmd 가 그 escape 를 풀어주지 않아 node 에 backslash 가 섞인 malformed JS 가 전달.
    //   `shell: true` 는 Windows 에서 내부적으로 `cmd /d /s /c "<command>"` 를 쓰며 `/s` 플래그가
    //   따옴표 strip 을 꺼서 명령 문자열이 1글자 변경 없이 cmd 에 도달 — 사용자가 직접 친 것과 동일.
    //   비-Windows 에선 system shell(`/bin/sh`)로 위임. cmd/sh OS 분기를 옵션 한 줄로 통합.
    const child = spawn(command, {
      shell: true,
      cwd: effectiveCwd,
      detached: true,
      stdio: 'ignore',
      // §7.11 v2.22 — Windows 에서 cmd 새 콘솔 윈도우 깜빡임 차단. 비-Windows 에선 무시.
      windowsHide: true,
    });
    // §7.11 v2.22 — 이전엔 spawn 오류를 silent swallow 해서 "왜 안 켜지냐" 진단이 불가능했다.
    //   detached + unref 라 부모는 대기 안 하지만 error 이벤트는 즉시 잡아 로그.
    child.on('error', (err) => {
      logger.error(`respawn failed: cwd="${effectiveCwd}" cmd="${command}" — ${String(err)}`);
    });
    child.on('exit', (code, signal) => {
      // detached 자식이라 비정상 즉시 종료도 사용자가 알기 어렵다 — exit code 가 0 이 아니면 로그.
      // 단 dev 서버처럼 장수명 프로세스는 exit 이벤트가 거의 안 오므로 노이즈는 적음.
      if (code !== null && code !== 0) {
        logger.warn(`respawn exited early: code=${code} signal=${signal ?? 'none'} cmd="${command}"`);
      }
    });
    child.unref();
  } catch (err) {
    logger.error(`respawn spawn() threw: cwd="${effectiveCwd}" cmd="${command}" — ${String(err)}`);
  }
}

/** 명령어 텍스트에서 포트 번호 추출 — env var / 플래그 / URL 흔한 패턴 cover.
 *  §7.11 v2.20 inline-cmd 가드의 1차 추출기. probe 명령은 호출자가 isProbeCommand 로 먼저 거름. */
export function extractPort(text: string): number | undefined {
  // 흔한 env var 형태: PORT=, SERVER_PORT=, API_PORT=, HTTP_PORT=, LISTEN_PORT=, APP_PORT=, BACKEND_PORT=, FRONTEND_PORT=
  const envMatch = text.match(/\b(?:PORT|SERVER_PORT|API_PORT|HTTP_PORT|LISTEN_PORT|APP_PORT|BACKEND_PORT|FRONTEND_PORT)=(\d{2,5})\b/);
  if (envMatch?.[1]) return parseInt(envMatch[1], 10);

  // 흔한 플래그: --port N, --port=N, -p N, -p=N, --listen N, --bind :N, --bind 0.0.0.0:N
  const flagMatch = text.match(/(?:--port[=\s]|-p[=\s]|--listen[=\s])(\d{2,5})/i);
  if (flagMatch?.[1]) return parseInt(flagMatch[1], 10);
  const bindMatch = text.match(/--bind[=\s][^\s]*?:(\d{2,5})/i);
  if (bindMatch?.[1]) return parseInt(bindMatch[1], 10);

  // §7.11 — `python -m http.server 8777 [--bind 127.0.0.1]` / `SimpleHTTPServer 8777`:
  //   포트가 **위치 인자**라 위 플래그/env 패턴에 안 걸린다. 게다가 http.server 의 기동 배너
  //   ("Serving HTTP on … port 8777")는 stdout 으로 나가는데 파이프(bg .output)일 땐 블록
  //   버퍼링돼 flush 되지 않아 output 파일엔 접근로그(포트 없음)만 남는다 → watcher 도 포트를
  //   못 잡아 iframe 위성이 영영 안 생긴다. 명령어 문자열에서 직접 위치 포트를 뽑아 이 사각지대를
  //   메운다. `(?<![\d.]) … (?![\d.])` 로 IP 옥텟(`127.0.0.1`)은 건너뛰고 순수 포트 토큰만 잡는다
  //   (`--bind 127.0.0.1 8777` 처럼 포트가 flag 인자 뒤여도 안전).
  const pyHttpMatch = text.match(/\b(?:http\.server|SimpleHTTPServer)\b[^\n]*?(?<![\d.])\b(\d{2,5})\b(?![\d.])/i);
  if (pyHttpMatch?.[1]) return parseInt(pyHttpMatch[1], 10);

  // URL 형태: localhost:N, 127.0.0.1:N, 0.0.0.0:N
  const urlMatch = text.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/);
  if (urlMatch?.[1]) return parseInt(urlMatch[1], 10);

  return undefined;
}

/** 읽기·probe·진단류 명령어 패턴 (§7.11 v2.20).
 *  inline-cmd 단축 경로에서 이 패턴이 매칭되면 iframe/ServerEntry 생성 skip(watcher 에 위임).
 *  목적: `curl http://localhost:3001` 같은 명령이 살아있는 서버를 때릴 때, cmd 에서 추출된 3001
 *  포트가 진짜 listen 중이라 모든 후속 probe 를 통과 → 그 curl 셸이 마치 서버처럼 등록되는
 *  false positive 차단. 단어 경계로 강하게 매칭(파일경로/패스 안에 우연히 들어가지 않게). */
const PROBE_COMMAND_PATTERNS: readonly RegExp[] = [
  /(?:^|[\s;&|`(])curl(?:\s|$)/i,
  /(?:^|[\s;&|`(])wget(?:\s|$)/i,
  /(?:^|[\s;&|`(])http(?:ie)?(?:\s|$)/i,
  /(?:^|[\s;&|`(])nc(?:\s|$)/i,
  /(?:^|[\s;&|`(])netcat(?:\s|$)/i,
  /(?:^|[\s;&|`(])netstat(?:\s|$)/i,
  /(?:^|[\s;&|`(])ss(?:\s|$)/i,
  /(?:^|[\s;&|`(])lsof(?:\s|$)/i,
  /(?:^|[\s;&|`(])telnet(?:\s|$)/i,
  /(?:^|[\s;&|`(])ping(?:\s|$)/i,
  /(?:^|[\s;&|`(])dig(?:\s|$)/i,
  /(?:^|[\s;&|`(])host(?:\s|$)/i,
  /(?:^|[\s;&|`(])ab(?:\s|$)/i,
  /(?:^|[\s;&|`(])hey(?:\s|$)/i,
  /(?:^|[\s;&|`(])siege(?:\s|$)/i,
  /(?:^|[\s;&|`(])wrk(?:\s|$)/i,
  /(?:^|[\s;&|`(])k6\s+run\b/i,
  /(?:^|[\s;&|`(])fetch\s+http/i,
  // Windows 전용 변형
  /(?:^|[\s;&|`(])(?:Test-NetConnection|Invoke-WebRequest|Invoke-RestMethod|tnc|iwr|irm)(?:\s|$)/i,
];

export function isProbeCommand(text: string): boolean {
  return PROBE_COMMAND_PATTERNS.some((p) => p.test(text));
}

/**
 * §7.11 — **우리 자신이 듣고 있는 포트들**. 감지가 Vibisual 을 "에이전트가 띄운 서버"로
 * 오인하지 않게 막는 유일한 자리다.
 *
 * 스폰된 에이전트는 카드 엔드포인트(`/api/agent-report` 등)를 `curl http://127.0.0.1:<포트>` 로
 * 수시로 친다. 그 주소는 당연히 살아 있으므로, 걸러내지 않으면 **모든 세션에서 Vibisual 자신의
 * 프리뷰 버블**이 생긴다. 프로세스 전역 사실이라 모듈 상태로 두고 부팅 때 한 번 채운다.
 */
const vibisualOwnPorts = new Set<number>();

export function setVibisualOwnPorts(ports: readonly (number | null | undefined)[]): void {
  vibisualOwnPorts.clear();
  for (const p of ports) {
    if (typeof p === 'number' && Number.isInteger(p) && p > 0 && p <= 65535) vibisualOwnPorts.add(p);
  }
}

export function isVibisualOwnPort(port: number): boolean {
  return vibisualOwnPorts.has(port);
}

/** §7.11 v2.24 — JS/TS 코드 텍스트에서 흔한 listen 선언 패턴을 sniff. file·inline-eval 공용 헬퍼. */
export function extractPortFromCodeText(content: string): number | undefined {
  // 1) .listen(N), .listen(N, ...), .listen({port: N})
  const listenMatch =
    content.match(/\.listen\s*\(\s*(\d{2,5})\b/) ??
    content.match(/\.listen\s*\(\s*\{\s*port\s*:\s*(\d{2,5})\b/);
  if (listenMatch?.[1]) return parseInt(listenMatch[1], 10);

  // 2) const/let PORT = N, var PORT = N
  const constMatch = content.match(/\b(?:const|let|var)\s+(?:PORT|port|SERVER_PORT|API_PORT)\s*=\s*(\d{2,5})\b/);
  if (constMatch?.[1]) return parseInt(constMatch[1], 10);

  // 3) port: N (객체 리터럴), PORT: N
  const objMatch = content.match(/\b(?:port|PORT)\s*:\s*(\d{2,5})\b/);
  if (objMatch?.[1]) return parseInt(objMatch[1], 10);

  // 4) process.env.PORT || N, process.env.PORT ?? N
  const envFallbackMatch = content.match(/process\.env\.(?:PORT|SERVER_PORT|API_PORT)\s*(?:\|\||\?\?)\s*(\d{2,5})\b/);
  if (envFallbackMatch?.[1]) return parseInt(envFallbackMatch[1], 10);

  return undefined;
}

/** §7.11 v2.20 — `node <script>.[mc]?js|.ts` 명령어가 cmd 에 포트를 안 적은 경우,
 *  그 스크립트 파일을 직접 읽어 listen 선언 패턴에서 포트를 sniff.
 *  보안: 파일 크기 64KB 상한, 확장자 화이트리스트, node 가 직접 지목한 경로만(import 추적 ❌). */
const SCRIPT_FILE_SIZE_LIMIT = 64 * 1024;
const SCRIPT_EXT_WHITELIST = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']);

export function extractPortFromScriptFile(cmd: string, cwd?: string): number | undefined {
  // 명령어 토큰 분해 — 첫 `node`/`tsx`/`ts-node`/`bun` 다음에 오는 스크립트 경로 토큰을 찾는다
  const runnerMatch = cmd.match(/\b(?:node|tsx|ts-node|bun)\s+(?:--?\S+\s+)*(\S+)/);
  const scriptToken = runnerMatch?.[1];
  if (!scriptToken) return undefined;

  // 따옴표 제거
  const cleaned = scriptToken.replace(/^["']|["']$/g, '');
  const ext = path.extname(cleaned).toLowerCase();
  if (!SCRIPT_EXT_WHITELIST.has(ext)) return undefined;

  // cwd 와 결합해 절대 경로
  const baseCwd = cwd ?? process.cwd();
  const resolved = path.isAbsolute(cleaned) ? cleaned : path.resolve(baseCwd, cleaned);

  // 파일 존재 + 크기 확인
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return undefined;
  }
  if (!stat.isFile() || stat.size <= 0) return undefined;

  // 64KB 까지만 읽음
  let content: string;
  try {
    const readLen = Math.min(stat.size, SCRIPT_FILE_SIZE_LIMIT);
    const fd = fs.openSync(resolved, 'r');
    try {
      const buf = Buffer.alloc(readLen);
      fs.readSync(fd, buf, 0, readLen, 0);
      content = buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
  }

  return extractPortFromCodeText(content);
}

/** §7.11 v2.24 — `node -e "<code>"` / `node --eval "<code>"` / `node -p` / `--print` /
 *  `bun -e` 같은 인라인 eval 명령에서 따옴표 안의 코드를 추출해 listen 패턴을 sniff.
 *  따옴표는 `"..."` / `'...'` 양쪽 지원, escape 는 `\\.` 로 1차 처리. */
export function extractPortFromInlineEval(cmd: string): number | undefined {
  // runner + -e/--eval/-p/--print 플래그 + 따옴표 또는 일반 토큰
  // 매칭 우선순위: 큰따옴표 > 작은따옴표 > 따옴표 없는 토큰(공백 없는 짧은 코드)
  const evalFlagRe = /\b(?:node|tsx|ts-node|bun)\s+(?:[^-]\S*\s+)*(?:-e|--eval|-p|--print)\s+/;
  const flagPos = cmd.search(evalFlagRe);
  if (flagPos === -1) return undefined;
  const m = cmd.match(evalFlagRe);
  if (!m) return undefined;
  const after = cmd.slice(flagPos + m[0].length);

  // 따옴표 추출 — escape 처리(`\\.` = 모든 이스케이프 시퀀스 1회 소비)
  let code: string | undefined;
  if (after.startsWith('"')) {
    const closeMatch = after.slice(1).match(/^((?:\\.|[^"\\])*)"/);
    if (closeMatch?.[1] !== undefined) code = closeMatch[1];
  } else if (after.startsWith("'")) {
    const closeMatch = after.slice(1).match(/^((?:\\.|[^'\\])*)'/);
    if (closeMatch?.[1] !== undefined) code = closeMatch[1];
  } else {
    // 따옴표 없는 짧은 인라인 — 공백 전까지
    const noQuoteMatch = after.match(/^(\S+)/);
    if (noQuoteMatch?.[1]) code = noQuoteMatch[1];
  }
  if (!code) return undefined;

  return extractPortFromCodeText(code);
}

/** 장시간 실행되는 서버/데몬을 강하게 시사하는 명령어 패턴.
 *  여기 매칭되면 포트가 아직 안 뜨더라도 즉시 ServerEntry 등록.
 *  (설치/빌드/조회 등 일회성 명령은 매칭되지 않음) */
const SERVER_COMMAND_PATTERNS: readonly RegExp[] = [
  // Node/JS dev
  /\bvite(?!\s+build)\b/i,
  /\bnext\s+dev\b/i,
  /\bwebpack-dev-server\b/i,
  /\bwebpack\s+serve\b/i,
  /\brollup\s+(?:-w|--watch)\b/i,
  /\besbuild\s+.*--watch\b/i,
  /\bnodemon\b/i,
  /\bts-node-dev\b/i,
  /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|watch)\b/i,
  // 파일명이 server/app/index/main 그 자체일 때만 — 경로 prefix 는 허용.
  // `[^\s]*…[^\s]*` 로 두면 `node scripts/runapp.mjs` 의 "run|app|.mjs" 처럼
  // 런처 스크립트가 'app' 부분매칭으로 서버 오판된다(§7.11 v2.4).
  /\bnode\s+(?:[^\s]*[/\\])?(?:server|app|index|main)\.[mc]?js\b/i,
  // Python
  /\buvicorn\b/i,
  /\bgunicorn\b/i,
  /\bhypercorn\b/i,
  /\bflask\s+run\b/i,
  /\bpython\s+(?:-m\s+)?manage\.py\s+runserver\b/i,
  /\bpython\s+-m\s+http\.server\b/i,
  /\bpython\s+-m\s+SimpleHTTPServer\b/i,
  /\bsanic\b/i,
  // Ruby
  /\brails\s+s(?:erver)?\b/i,
  /\brackup\b/i,
  /\bpuma\b/i,
  /\bthin\s+start\b/i,
  // PHP
  /\bphp\s+-S\b/i,
  /\bartisan\s+serve\b/i,
  /\bsymfony\s+serve?\b/i,
  // Go / Rust / .NET / JVM
  /\bgo\s+run\b/i,
  /\bair\b(?!\w)/i,
  /\bcargo\s+(?:run|watch)\b/i,
  /\bdotnet\s+(?:run|watch)\b/i,
  /\bmvn\s+spring-boot:run\b/i,
  /\bgradle\s+bootRun\b/i,
  // Generic static / live
  /\bhttp-server\b/i,
  /\blive-server\b/i,
  /\bbrowser-sync\b/i,
  /(?:^|\s)serve\s+(?:-|[./])/i,
  // Vibisual
  /\brunserver\.mjs\b/i,
];

export function looksLikeServerCommand(text: string): boolean {
  return SERVER_COMMAND_PATTERNS.some((p) => p.test(text));
}

/** Vibisual 자체 런처/실행 스크립트 명령어 패턴 (§7.11 v2.4).
 *  이런 명령의 bash output 파일에는 실행된 Vibisual 앱 자신의 stdout 로그
 *  (`iframe satellite created: localhost:PORT` 등 `localhost:PORT` 멘션 다수)가
 *  흘러든다. 서버 감지가 그 파일을 tail 하면 자기 로그를 다시 읽어 과거에 찍은
 *  모든 포트를 서버로 오등록하는 self-ingestion 루프가 생긴다. 이런 명령의 셸은
 *  서버/iframe 감지에서 전면 제외한다(watcher 미부착·ServerEntry 미등록). */
const VIBISUAL_LAUNCHER_PATTERNS: readonly RegExp[] = [
  /\brunapp\.mjs\b/i,
  /\belectron-vite\b/i,
];

export function isVibisualLauncherCommand(text: string): boolean {
  return VIBISUAL_LAUNCHER_PATTERNS.some((p) => p.test(text));
}
