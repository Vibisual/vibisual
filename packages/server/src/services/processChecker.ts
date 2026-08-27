import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { exec, spawn } from 'node:child_process';
import { loopbackUrlVariants } from '@vibisual/shared';
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
  return probeUrlServing(rawUrl, timeoutMs);
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
  const candidates = loopbackUrlVariants(rawUrl);
  for (const candidate of candidates.length > 0 ? candidates : [rawUrl]) {
    if (await probeUrlServing(candidate, timeoutMs)) return candidate;
  }
  return null;
}

function probeUrlServing(rawUrl: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let parsed: URL;
    try { parsed = new URL(rawUrl); } catch { resolve(false); return; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { resolve(false); return; }
    const lib = parsed.protocol === 'https:' ? https : http;
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      // localhost self-signed 대비 rejectUnauthorized:false — 표시용 probe 라 인증서 무관.
      const req = lib.request(rawUrl, { method: 'GET', timeout: timeoutMs, rejectUnauthorized: false }, (res) => {
        const status = res.statusCode ?? 0;
        res.destroy(); // 상태코드만 필요 — 본문은 버린다
        done(status >= 200 && status < 400);
      });
      req.once('timeout', () => { req.destroy(); done(false); });
      req.once('error', () => done(false));
      req.end();
    } catch { done(false); }
  });
}

const IS_WIN = process.platform === 'win32';

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

/** Windows `netstat -ano -p TCP` 출력에서 해당 포트를 LISTENING 중인 PID 추출.
 *  ⚠ 예전 구현의 `findstr :4800` 은 `127.0.0.1:48000` 도 매칭했다 — 포트를 정규식으로 못 박는다. */
export function parseNetstatListeningPids(stdout: string, port: number): number[] {
  const re = new RegExp(`^\\s*TCP\\s+\\S+:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)\\s*$`);
  const out: number[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(re);
    if (m?.[1]) out.push(Number(m[1]));
  }
  return uniquePositiveInts(out);
}

/** `lsof -t` 출력 = PID 한 줄에 하나. */
export function parseLsofPids(stdout: string): number[] {
  return uniquePositiveInts(
    stdout.split(/\r?\n/).map((l) => Number(l.trim())).filter((n) => !Number.isNaN(n)),
  );
}

/** `ss -lptn` 출력의 `users:(("node",pid=1234,fd=23))` 에서 PID 추출. */
export function parseSsPids(stdout: string): number[] {
  const out: number[] = [];
  for (const m of stdout.matchAll(/pid=(\d+)/g)) out.push(Number(m[1]));
  return uniquePositiveInts(out);
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
  const hex = port.toString(16).toUpperCase().padStart(4, '0');
  const out: string[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const f = raw.trim().split(/\s+/);
    // sl local_address rem_address st tx rx tr tm retrnsmt uid timeout inode
    if (f.length < 10) continue;
    const local = f[1];
    if (!local || !local.toUpperCase().endsWith(`:${hex}`)) continue;
    if (f[3] !== '0A') continue; // 0A = TCP_LISTEN
    const inode = f[9];
    if (inode && /^\d+$/.test(inode)) out.push(inode);
  }
  return [...new Set(out)];
}

/** inode → PID 역매핑. `/proc/<pid>/fd/*` 심볼릭 링크가 `socket:[<inode>]` 를 가리킨다. */
function findPidsBySocketInodes(inodes: Set<string>): number[] {
  if (inodes.size === 0) return [];
  const found: number[] = [];
  let pidDirs: string[];
  try { pidDirs = fs.readdirSync('/proc'); } catch { return []; }
  for (const name of pidDirs) {
    if (!/^\d+$/.test(name)) continue;
    let fds: string[];
    try { fds = fs.readdirSync(`/proc/${name}/fd`); } catch { continue; } // 남의 프로세스 = EACCES
    for (const fd of fds) {
      let link: string;
      try { link = fs.readlinkSync(`/proc/${name}/fd/${fd}`); } catch { continue; }
      const m = link.match(/^socket:\[(\d+)\]$/);
      if (m?.[1] && inodes.has(m[1])) { found.push(Number(name)); break; }
    }
  }
  return uniquePositiveInts(found);
}

/** 조회 1회의 결과. `available:false` = 그 도구가 이 시스템에 없거나 응답하지 않았다(≠ 포트가 비었다). */
type LookupResult = { available: true; pids: number[] } | { available: false };

/** 셸 한 줄을 돌려 stdout 을 파서에 넘긴다. 명령 부재(exit 127)·타임아웃은 `available:false`. */
function runLookup(cmd: string, parse: (stdout: string) => number[]): Promise<LookupResult> {
  return new Promise((resolve) => {
    exec(cmd, { timeout: PORT_LOOKUP_TIMEOUT_MS, windowsHide: true }, (err, stdout, stderr) => {
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
        resolve({ available: true, pids: parse(String(stdout ?? '')) });
        return;
      }
      resolve({ available: true, pids: parse(stdout) });
    });
  });
}

/** Linux `/proc/net/tcp` 직접 읽기. 파일이 없으면(=macOS 등) `available:false`. */
function lookupViaProc(port: number): LookupResult {
  let content = '';
  let any = false;
  for (const p of ['/proc/net/tcp', '/proc/net/tcp6']) {
    try { content += fs.readFileSync(p, 'utf8') + '\n'; any = true; } catch { /* 없으면 건너뜀 */ }
  }
  if (!any) return { available: false };
  const inodes = new Set(parseProcNetTcpListenInodes(content, port));
  if (inodes.size === 0) return { available: true, pids: [] };
  return { available: true, pids: findPidsBySocketInodes(inodes) };
}

/**
 * 포트를 LISTEN 중인 프로세스를 찾아 **트리째** 종료한다.
 *
 * 조회 수단은 플랫폼별 후보를 순서대로 시도하고, 하나라도 "동작했다"면 그 결과를 채택한다.
 *   - Windows: `netstat -ano -p TCP`
 *   - POSIX  : `lsof` → `ss` → `fuser` → `/proc/net/tcp`
 * 전부 없으면 `no-tool` — 호출자가 "포트가 비었다"와 구분할 수 있다.
 *
 * 종료는 {@link killTree} 로 위임한다(이전엔 `taskkill /F`(트리 아님) / `kill`(SIGTERM, 손자 잔존)을
 * 여기서 따로 재구현했다). `respawn` 이 띄운 dev 서버는 `shell:true` 라 최상단이 셸이고 실제 서버는
 * 그 자식 — 단일 kill 로는 포트가 안 놓인다.
 */
export async function killByPortDetailed(port: number): Promise<KillByPortResult> {
  // 보안: port 는 셸 문자열에 보간되므로 정수가 아니면 즉시 거부(인젝션 차단).
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { killed: false, outcome: 'invalid-port', pids: [] };
  }

  const candidates: { via: string; run: () => Promise<LookupResult> | LookupResult }[] = IS_WIN
    ? [
        { via: 'netstat', run: () => runLookup('netstat -ano -p TCP', (o) => parseNetstatListeningPids(o, port)) },
      ]
    : [
        { via: 'lsof', run: () => runLookup(`lsof -iTCP:${port} -sTCP:LISTEN -P -n -t`, parseLsofPids) },
        { via: 'ss', run: () => runLookup(`ss -lptnH 'sport = :${port}'`, parseSsPids) },
        { via: 'fuser', run: () => runLookup(`fuser -n tcp ${port} 2>/dev/null`, parseFuserPids) },
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
    if (res.pids.length === 0) continue;
    // 자살 방지: 우리 자신/부모가 그 포트를 쥐고 있으면 죽이지 않는다(그룹 킬이면 앱 전체가 내려간다).
    const targets = res.pids.filter((pid) => pid !== process.pid && pid !== process.ppid);
    if (targets.length === 0) {
      logger.warn(`killByPort(${port}): port is held by this process — refusing to kill self`);
      return { killed: false, outcome: 'self', pids: res.pids, via: c.via };
    }
    for (const pid of targets) killTree(pid);
    logger.info(`killByPort(${port}): killed tree(s) ${targets.join(', ')} via ${c.via}`);
    return { killed: true, outcome: 'killed', pids: targets, via: c.via };
  }

  if (!anyToolWorked) {
    logger.warn(
      `killByPort(${port}): no way to inspect port owners on this system — ` +
        `install one of lsof / iproute2(ss) / psmisc(fuser), or run on a kernel exposing /proc/net/tcp`,
    );
    return { killed: false, outcome: 'no-tool', pids: [] };
  }
  return { killed: false, outcome: 'not-listening', pids: [] };
}

/** 포트를 점유 중인 프로세스를 kill. 세부 사유가 필요하면 {@link killByPortDetailed} 를 쓸 것. */
export function killByPort(port: number): Promise<boolean> {
  return killByPortDetailed(port).then((r) => r.killed);
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
