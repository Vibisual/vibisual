import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { exec, spawn } from 'node:child_process';
import { logger } from '../logger.js';

const TCP_TIMEOUT = 1000;

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

const IS_WIN = process.platform === 'win32';

/** 포트를 점유 중인 프로세스를 kill */
export function killByPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    // 보안: port 는 셸 문자열에 보간되므로 정수가 아니면 즉시 거부(인젝션 차단).
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      resolve(false);
      return;
    }
    const findCmd = IS_WIN
      ? `netstat -ano | findstr LISTENING | findstr :${port}`
      : `lsof -iTCP:${port} -sTCP:LISTEN -P -n -t`;

    exec(findCmd, (err, stdout) => {
      if (err || !stdout.trim()) { resolve(false); return; }

      const pid = IS_WIN
        ? stdout.match(/LISTENING\s+(\d+)/)?.[1]
        : stdout.trim().split('\n')[0];

      if (!pid) { resolve(false); return; }

      const killCmd = IS_WIN ? `taskkill /PID ${pid} /F` : `kill ${pid}`;
      exec(killCmd, (killErr) => resolve(!killErr));
    });
  });
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
