/**
 * BackgroundShellWatcher — Claude Code `run_in_background` Bash의 output 파일을
 * 주기적으로 tail하여 listen 포트를 탐지한다. 포트 발견 시 콜백 호출 후 자동 중지.
 */
import fs from 'node:fs';
import { capMapSize, SESSION_KEYED_MAP_MAX } from '@vibisual/shared';
import { logger } from '../logger.js';
import { scanFileLines } from './jsonlChunkReader.js';
import { isPortAlive, isVibisualLauncherCommand } from './processChecker.js';

const PORT_REGEX = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/;
const PORT_REGEX_GLOBAL = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/g;

/** §7.11 — 광역 후보 정규식(false positive 는 isPortAlive probe 가 걸러 iframe 으로 안 간다). 모두 캡처 그룹 [1] 에 포트 숫자가 있어야 한다(매처가 가정). */
const LOG_PORT_PATTERNS: readonly RegExp[] = [
  // (a) localhost / 127.0.0.1 / 0.0.0.0 prefix
  /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/g,
  // (b) 영문 서버 메시지: "Listening on 3000" / "server on :3999" / "ready on port 4002" / "started 8080"
  /\b(?:listening|server|started|running|ready|live)\s+(?:on\s+)?(?:port\s+|:)?(\d{2,5})\b/gi,
  // (c) port 키 + 숫자: "port 3000" / "port: 3000" / "port=3000" / "PORT 3000"
  /\bport\s*[:=]?\s*(\d{2,5})\b/gi,
  // (d) `:NNNN` 단독 — 공백/구두점/괄호 직후, 숫자나 콜론 뒤가 아님(timestamp `12:34:56` 차단)
  /(?<![\d:])(?<![\w])(?<=[\s,(){}\[\]'"`])(?<!\d):(\d{2,5})\b/g,
];
// ANSI 컬러 이스케이프 제거용 — \x1b(ESC) 제어문자 포함은 의도적
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;
const POLL_INTERVAL_MS = 1500;
/** dev 서버 기동에 여유 + monorepo 에서 server/client 순차 부팅 대응 */
const MAX_POLL_DURATION_MS = 180_000;
const TAIL_BYTES = 16_384;

/** ANSI escape 코드 제거 (Vite/Vitest 컬러 출력 대응) */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

/** 로그 텍스트에서 listen 포트 추출 (ANSI 제거 후 첫 매치만) */
export function extractPortFromLog(text: string): number | undefined {
  const m = stripAnsi(text).match(PORT_REGEX);
  if (!m?.[1]) return undefined;
  const p = parseInt(m[1], 10);
  return p > 0 && p < 65536 ? p : undefined;
}

/**
 * §7.11 / §3.5 — "그 포트는 남이 쓴다" 줄. 여기에만 나온 포트는 우리 서버가 아니다(남의 서버로 살아 있어 probe 가 못 거른다).
 * 실측 문구: Vite `Port 5173 is in use, trying another one...` · Node `EADDRINUSE` · CRA `Something is already running on port 3000.`
 */
const PORT_IN_USE_LINE = /(?:\bis in use\b|\balready in use\b|\bEADDRINUSE\b|\balready running on\b|\bin use by another\b)/i;

function portsMatchedIn(text: string, into: Set<number>): void {
  for (const pattern of LOG_PORT_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      const raw = m[1];
      if (!raw) continue;
      const p = parseInt(raw, 10);
      if (p > 0 && p < 65536) into.add(p);
    }
  }
}

/**
 * 로그의 listen 포트 전부(ANSI 제거, 광역 패턴, unique — false positive 는 probe 가 정리, §7.11). "이미 쓰이고 있다" 줄({@link PORT_IN_USE_LINE})에만
 * 나온 포트는 뺀다 — probe 를 통과해 남의 프리뷰가 선다. 다른 줄(우리 `Local: http://localhost:8080/`)에도 나오면 남긴다(남이 놓은 뒤 우리가 잡은 경우).
 */
export function extractAllPortsFromLog(text: string): number[] {
  const clean = stripAnsi(text);
  const seen = new Set<number>();
  // 포트 유효 범위 + dev/dummy 서버가 흔히 쓰는 1024+ 로 좁혀 1~1023(well-known)
  // 같은 timestamp/sequence noise(`:80`/`:22` 등은 매칭되지만 probe 로 거름)는
  // probe 게이트가 처리. 여기선 숫자 범위만 1차 거름.
  portsMatchedIn(clean, seen);
  if (seen.size === 0 || !PORT_IN_USE_LINE.test(clean)) return [...seen];

  // 줄 단위로 "남이 쓴다" 줄과 나머지 줄을 가른다. 줄 머리에 개행을 붙여 `:NNNN` 패턴의 앞 공백
  // 조건이 전체 텍스트에서와 똑같이 서게 한다.
  const inUse = new Set<number>();
  const elsewhere = new Set<number>();
  for (const line of clean.split(/\r?\n/)) {
    portsMatchedIn(`\n${line}`, PORT_IN_USE_LINE.test(line) ? inUse : elsewhere);
  }
  return [...seen].filter((p) => !inUse.has(p) || elsewhere.has(p));
}

interface WatchEntry {
  outputPath: string;
  startedAt: number;
  lastSize: number;
  timer: NodeJS.Timeout;
  onPortDetected: (port: number) => void;
  /** 이미 서버로 확정(probe 통과)되어 콜백 호출된 포트 — 중복 발사 방지 */
  detectedPorts: Set<number>;
  /** output 에서 추출됐으나 아직 isPortAlive 미확인인 후보 포트.
   *  부팅 레이스(배너에 포트는 찍혔으나 아직 accept 전)를 다음 tick 에서 재확인하기 위해
   *  누적 보관. probe 통과 시 detectedPorts 로 승격. */
  candidatePorts: Set<number>;
  /** async tick 재진입 가드 — probe(await) 가 POLL_INTERVAL 보다 길어질 때 겹침 방지 */
  ticking: boolean;
}

export class BackgroundShellWatcher {
  private watches = new Map<string, WatchEntry>();

  start(shellId: string, outputPath: string, onPortDetected: (port: number) => void): void {
    if (this.watches.has(shellId)) return;
    const entry: WatchEntry = {
      outputPath,
      startedAt: Date.now(),
      lastSize: 0,
      timer: setInterval(() => { void this.tick(shellId); }, POLL_INTERVAL_MS),
      onPortDetected,
      detectedPorts: new Set<number>(),
      candidatePorts: new Set<number>(),
      ticking: false,
    };
    this.watches.set(shellId, entry);
    logger.info(`BackgroundShellWatcher: start shell=${shellId} file=${outputPath}`);
    void this.tick(shellId);
  }

  private async tick(shellId: string): Promise<void> {
    const entry = this.watches.get(shellId);
    if (!entry || entry.ticking) return;
    entry.ticking = true;
    try {
      if (Date.now() - entry.startedAt > MAX_POLL_DURATION_MS) {
        logger.info(`BackgroundShellWatcher: timeout shell=${shellId} (detected ${entry.detectedPorts.size} port(s))`);
        this.stop(shellId);
        return;
      }

      // 1) output 파일의 새 청크에서 후보 포트 수집 (ANSI 제거 후 전역 매칭).
      //    타임아웃 전까지 계속 감시 — monorepo dev 는 server/client 포트가 시간차로 찍힌다.
      try {
        const stat = fs.statSync(entry.outputPath);
        if (stat.size > entry.lastSize) {
          const readFrom = Math.max(0, stat.size - TAIL_BYTES);
          const length = stat.size - readFrom;
          entry.lastSize = stat.size;
          const fd = fs.openSync(entry.outputPath, 'r');
          try {
            const buf = Buffer.alloc(length);
            fs.readSync(fd, buf, 0, length, readFrom);
            for (const port of extractAllPortsFromLog(buf.toString('utf8'))) {
              entry.candidatePorts.add(port);
            }
          } finally {
            fs.closeSync(fd);
          }
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          logger.warn(`BackgroundShellWatcher: read failed shell=${shellId}: ${String(err)}`);
        }
      }

      // 2) 미확정 후보를 TCP probe — listen 응답한 포트만 확정·콜백(§7.11). netstat/curl 의 임시 클라이언트 포트는 응답이 없어 탈락, 배너만 찍힌 부팅 레이스는 다음 tick 에 재확인.
      for (const port of entry.candidatePorts) {
        if (entry.detectedPorts.has(port)) continue;
        const alive = await isPortAlive(port);
        // await 중 stop()/forgetPort() 되었을 수 있어 재확인
        if (!this.watches.has(shellId)) return;
        if (!alive || entry.detectedPorts.has(port)) continue;
        entry.detectedPorts.add(port);
        logger.info(`BackgroundShellWatcher: confirmed server port ${port} for shell=${shellId}`);
        entry.onPortDetected(port);
      }
    } finally {
      const e = this.watches.get(shellId);
      if (e) e.ticking = false;
    }
  }

  /** grace 제거된 위성의 포트를 다시 감지하게 한다 — 같은 포트로 재시작한 서버를 다시 잡는다(§7.11 `checkIframesAlive` 가 부름). candidatePorts 엔 남아 다음 tick 이 다시 probe 한다. */
  forgetPort(shellId: string, port: number): void {
    const entry = this.watches.get(shellId);
    if (!entry) return;
    entry.detectedPorts.delete(port);
  }

  stop(shellId: string): void {
    const entry = this.watches.get(shellId);
    if (!entry) return;
    clearInterval(entry.timer);
    this.watches.delete(shellId);
  }

  stopAll(): void {
    for (const shellId of [...this.watches.keys()]) this.stop(shellId);
  }
}

/**
 * 셸 응답에서 shell_id + output 경로 추출 — 깃발 모양(`...with ID: bspe49nqf. Output is being written to: <path>`)과 120초 승격 모양
 * (`...moved to the background (ID: bspe49nqf). Output ...`)을 다 받는다. 승격 모양은 id 가 괄호 안이라 `\S+?` 로 잡으면 `bspe49nqf)` 가 된다 — 영숫자만 받는다.
 * 출력 파일명이 곧 `<shellId>.output` 이라 경로에서 얻은 id 를 우선한다(안내문 문구가 바뀌어도 안 흔들린다).
 */
export function parseBackgroundShellResponse(
  text: string,
): { shellId: string; outputPath: string } | null {
  const idMatch = text.match(/ID:\s*([A-Za-z0-9_-]+)/);
  // bg 결과는 개행 없는 한 줄이라 `(.+?)(?:\r?\n|$)` 는 뒤 안내문까지 삼킨다 — 출력 파일은 늘 `<shellId>.output` 이므로 거기서 끊고, 옛 정규식은 폴백.
  const pathMatch =
    text.match(/Output is being written to:\s+(.+?\.output)\b/) ??
    text.match(/Output is being written to:\s+(.+?)(?:\r?\n|$)/);
  if (!idMatch?.[1] || !pathMatch?.[1]) return null;
  const outputPath = pathMatch[1].trim();
  const fromPath = /([A-Za-z0-9_-]+)\.output$/.exec(outputPath)?.[1];
  return { shellId: fromPath ?? idMatch[1], outputPath };
}

/** 기존 세션 JSONL에서 아직 살아있는 background shell 목록 추출 */
export interface ActiveBackgroundShell {
  shellId: string;
  outputPath: string;
  command: string;
  toolUseId: string;
  startedAt: number;
}

/**
 * §9 — 트랜스크립트 스캔의 증분 상태. 10초 sweep 이 모든 세션에 돌고 트랜스크립트는 세션당 8~26MB 라 통째 읽기 + 전 줄 파싱이 누적 537GB·CPU 130~160% 였다(실측 2026-08-15).
 * append-only 라 새 줄만 같은 순서로 먹이면 전량과 같다(중간 상태 `pending`·`shells`·`killed` 를 들고 다니고, 크기·mtime 이 같으면 안 읽는다).
 * ⚠ 파일이 줄면(교체·잘림) 상태를 버리고 처음부터 읽는다.
 */
interface ShellScanState {
  /** 마지막으로 **줄까지 완결해** 먹인 바이트 오프셋. */
  offset: number;
  /** 그때의 파일 크기·mtime. 둘 다 같으면 새 줄이 없다는 뜻이다. */
  size: number;
  mtimeMs: number;
  /** 짝을 기다리는 **모든** Bash tool_use: toolUseId → { command, timestamp }.
   *  깃발로 거르지 않는다 — 타임아웃 승격분은 깃발이 없다(⑰). 백그라운드 모양으로 답한 것만
   *  `shells` 로 올라가고 나머지는 결과를 받는 즉시 지워진다. */
  pending: Map<string, { command: string; startedAt: number }>;
  /** tool_result(user entry) 에서 shellId/outputPath 까지 짝지어진 셸들 */
  shells: ActiveBackgroundShell[];
  /** KillShell 이 호출된 shell_id 집합 */
  killed: Set<string>;
}

/** 짝을 기다리는 Bash tool_use 상한 — 전경 Bash 까지 담아서 필요하다(⑰). 답이 영영 안 오는 줄(중단된 턴)이 쌓이지 않게 오래된 것부터 버린다. */
const PENDING_BASH_MAX = 200;

const scanStates = new Map<string, ShellScanState>();

function freshScanState(): ShellScanState {
  return { offset: 0, size: 0, mtimeMs: 0, pending: new Map(), shells: [], killed: new Set() };
}

/** 누적 상태에서 지금 살아있는 셸 목록을 뽑는다(종전 함수 말미의 필터와 동일). */
function activeShellsOf(state: ShellScanState): ActiveBackgroundShell[] {
  // §7.11 — 자체 런처 셸(node scripts/runapp.mjs 등)은 뺀다 — 그 output 은 앱 자신의 로그라 자기 로그를 되읽어 모든 포트를 오등록한다.
  return state.shells.filter(
    (s) => !state.killed.has(s.shellId) && !isVibisualLauncherCommand(s.command),
  );
}

/**
 * §5.3 #9-2 (C-1) — 끊긴 셸까지 포함한 명령 원문(`scanActiveBackgroundShells` 는 산 셸만 준다). 상류가 Windows 에서 `bash.exe` 만 끊어
 * 아래 `grep` 이 고아로 사는 것을 찾을 때 쓴다(anthropics/claude-code#27273·#76353). 증분 상태를 먼저 당겨 디스크를 다시 읽지 않는다.
 */
export function findBackgroundShellCommand(jsonlPath: string, shellId: string): string | undefined {
  scanActiveBackgroundShells(jsonlPath);
  return scanStates.get(jsonlPath)?.shells.find((s) => s.shellId === shellId)?.command;
}

/** 테스트·재기동용 — 증분 캐시를 비운다. */
export function resetBackgroundShellScanCache(): void {
  scanStates.clear();
}

export function scanActiveBackgroundShells(jsonlPath: string): ActiveBackgroundShell[] {
  let st: fs.Stats;
  try {
    st = fs.statSync(jsonlPath);
  } catch {
    scanStates.delete(jsonlPath); // 파일이 사라짐 — 이어 읽을 상태도 의미가 없다
    return [];
  }
  if (!st.isFile()) return [];

  let state = scanStates.get(jsonlPath);
  if (!state || st.size < state.size) {
    // 처음 보는 파일이거나 줄어들었다(교체·잘림) — 이어 읽기를 포기하고 처음부터.
    state = freshScanState();
    scanStates.set(jsonlPath, state);
    // §3.2.4 F축 — 경로가 키라 켜 둘수록 는다. 버려도 다음 호출에서 다시 쌓인다.
    capMapSize(scanStates, SESSION_KEYED_MAP_MAX);
  } else if (st.size === state.size && st.mtimeMs === state.mtimeMs) {
    return activeShellsOf(state); // 새 줄 없음 — 디스크를 건드리지 않는다
  }

  const consumeLine = (line: string): void => {
    const { pending, shells, killed } = state!;
    let entry: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== 'object' || parsed === null) return;
      entry = parsed as Record<string, unknown>;
    } catch { return; }

    const msg = entry['message'] as Record<string, unknown> | undefined;
    if (!msg || !Array.isArray(msg['content'])) return;
    const ts = typeof entry['timestamp'] === 'string' ? Date.parse(entry['timestamp']) : Date.now();

    for (const block of msg['content'] as unknown[]) {
      if (typeof block !== 'object' || block === null) continue;
      const b = block as Record<string, unknown>;

      // assistant → tool_use(Bash) 또는 tool_use(KillShell)
      if (b['type'] === 'tool_use') {
        const name = typeof b['name'] === 'string' ? b['name'] : '';
        const input = b['input'] as Record<string, unknown> | undefined;
        const uid = typeof b['id'] === 'string' ? b['id'] : '';

        // §5.5 #17-9 ⑰ — 깃발이 아니라 하니스의 답으로 판정한다(승격된 셸은 `run_in_background` 가 없다, 실측). 명령문만 들고 있다가 tool_result 가
        // 백그라운드 모양으로 답할 때만 셸로 등록한다 — 깃발만 보면 승격 셸이 끝 표식도 조사도 없이 영원히 남는다.
        if (name === 'Bash' && uid) {
          const cmd = typeof input?.['command'] === 'string' ? (input['command'] as string) : '';
          pending.set(uid, { command: cmd, startedAt: ts });
          // 전경 Bash 까지 담으므로 상한을 둔다 — 짝이 오면 바로 지우지만, 답이 영영 안 오는
          //   줄(중단된 턴)이 남을 수 있다. 결과는 대개 바로 다음 줄이라 이 상한에 안 닿는다.
          capMapSize(pending, PENDING_BASH_MAX);
        } else if (name === 'KillShell' && input) {
          const sid = typeof input['shell_id'] === 'string' ? input['shell_id'] : '';
          if (sid) killed.add(sid);
        }
        continue;
      }

      // user → tool_result: content 텍스트에서 ID + Output 경로 파싱
      if (b['type'] === 'tool_result') {
        const forUid = typeof b['tool_use_id'] === 'string' ? b['tool_use_id'] : '';
        const meta = pending.get(forUid);
        if (!meta) continue;

        let text = '';
        const content = b['content'];
        if (typeof content === 'string') text = content;
        else if (Array.isArray(content)) {
          for (const c of content) {
            if (typeof c === 'object' && c !== null && 'text' in c && typeof (c as Record<string, unknown>)['text'] === 'string') {
              text += (c as Record<string, string>)['text'] + '\n';
            }
          }
        }
        const parsed = parseBackgroundShellResponse(text);
        if (parsed) {
          shells.push({
            shellId: parsed.shellId,
            outputPath: parsed.outputPath,
            command: meta.command,
            toolUseId: forUid,
            startedAt: meta.startedAt,
          });
        }
        pending.delete(forUid);
      }
    }
  };

  // 새로 붙은 구간만 훑는다. `scanFileLines` 는 **완결된 줄만** 먹이고, 반쪽으로 끝난 꼬리는
  // 커밋하지 않으므로(nextOffset 이 그 앞) 다음 호출에서 온전한 줄로 다시 읽힌다.
  const { nextOffset } = scanFileLines(jsonlPath, state.offset, st.size, consumeLine);
  state.offset = nextOffset;
  state.size = st.size;
  state.mtimeMs = st.mtimeMs;

  return activeShellsOf(state);
}
