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

/** §7.11 v2.24 — 광역 후보 추출용 정규식 union. 각 매치는 isPortAlive probe 게이트로 자연 정리되므로
 *  광범위하게 잡아도 false positive 가 iframe 으로 승격되지 않는다.
 *  주의: 모두 캡처 그룹 [1] 에 포트 숫자가 들어가야 한다(매처가 가정). */
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

/** 로그 텍스트에서 listen 포트 전부 추출 (ANSI 제거 후 광역 패턴 union 매칭, unique).
 *  §7.11 v2.24 — 단일 `localhost:N` 정규식만으론 `dummy server on :3999` 같은 흔한 메시지를
 *  못 잡아 LOG_PORT_PATTERNS union 으로 확장. false positive 는 isPortAlive probe 가 정리. */
export function extractAllPortsFromLog(text: string): number[] {
  const clean = stripAnsi(text);
  const seen = new Set<number>();
  for (const pattern of LOG_PORT_PATTERNS) {
    for (const m of clean.matchAll(pattern)) {
      const raw = m[1];
      if (!raw) continue;
      const p = parseInt(raw, 10);
      // 포트 유효 범위 + dev/dummy 서버가 흔히 쓰는 1024+ 로 좁혀 1~1023(well-known)
      // 같은 timestamp/sequence noise(`:80`/`:22` 등은 매칭되지만 probe 로 거름)는
      // probe 게이트가 처리. 여기선 숫자 범위만 1차 거름.
      if (p > 0 && p < 65536) seen.add(p);
    }
  }
  return [...seen];
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

      // 2) 미확정 후보를 TCP probe — listen 응답한 포트만 서버로 확정 후 콜백 발사.
      //    "서버임을 확인하고 리스트에 넣는다"(SCENARIO §7.11 v2.4). netstat/curl 이
      //    출력한 임시 클라이언트 포트는 listen 이 아니라 probe 에 응답하지 않아 자동 탈락.
      //    부팅 레이스(배너만 찍히고 아직 accept 전)는 후보로 남아 다음 tick 에서 재확인.
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

  /** grace 제거된 위성의 포트를 재감지 허용 — 서버가 같은 포트로 재시작하면 다시 콜백.
   *  (SCENARIO §7.11 v2.4 — checkIframesAlive 의 grace 자동 제거 경로가 호출.)
   *  candidatePorts 에는 남겨 두므로 다음 tick 이 재 probe → 살아 있으면 재확정. */
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
 * Claude Code 백그라운드 셸 응답에서 shell_id + output 경로 추출.
 *
 * **두 모양을 다 받는다** — 깃발로 띄운 것과, 120초 타임아웃으로 **승격된** 것:
 *   ① `...running in background with ID: bspe49nqf. Output is being written to: <path>`
 *   ② `...did not complete within its 120s timeout and was moved to the background
 *      (ID: bspe49nqf). Output is being written to: <path>`
 * ②는 id 가 **괄호 안**이라, 종전의 `/ID:\s+(\S+?)[.\s]/` 로 잡으면 닫는 괄호가 딸려 와
 * `bspe49nqf)` 가 된다(그 id 로는 어떤 조회도 맞지 않는다). 셸 id 는 하니스가 만드는 짧은
 * 영숫자 토큰이므로 **그 글자만** 받는다.
 *
 * 그리고 출력 파일명이 곧 `<shellId>.output` 이라, **경로에서 얻은 id 를 우선**한다 —
 * 안내문 문구가 또 바뀌어도 이쪽은 흔들리지 않는다.
 */
export function parseBackgroundShellResponse(
  text: string,
): { shellId: string; outputPath: string } | null {
  const idMatch = text.match(/ID:\s*([A-Za-z0-9_-]+)/);
  // 현 Claude Code bg 결과는 개행 없는 한 줄:
  //   "...Output is being written to: <path>.output. You will be notified ..."
  // `(.+?)(?:\r?\n|$)` 는 개행이 없어 뒤 안내문까지 경로에 흡수한다 → 경로 깨짐.
  // 하니스 출력 파일은 항상 `<shellId>.output` 이므로 `.output` 에서 끊는다.
  // 구 포맷(개행 종결 등) 대비 기존 정규식을 폴백으로 유지.
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
 * §9 — 세션 트랜스크립트 스캔의 **증분 상태**.
 *
 * **왜**: 이 스캔은 `SESSION_SCAN_INTERVAL`(10초) sweep 이 **등록된 모든 세션**에 대해 돌린다.
 * 종전 구현은 그때마다 트랜스크립트를 `readFileSync` 로 통째로 읽고 전 줄을 `JSON.parse` 했다.
 * 트랜스크립트는 세션당 8~26MB 까지 자라므로, 이 한 경로가 메인 프로세스 누적 읽기 537GB
 * (디스크 총량 2.3GB 의 약 230배) · CPU 상시 130~160% 의 주범이었다(실측 2026-08-15).
 *
 * 트랜스크립트는 **append-only** 라, 새로 붙은 줄만 같은 순서로 먹이면 결과가 전량 재스캔과
 * 같다. 그래서 파싱 중간 상태(`pending`·`shells`·`killed`)를 그대로 들고 다닌다.
 * 파일이 그대로면(크기·mtime 동일) 디스크를 아예 건드리지 않는다.
 *
 * ⚠ 파일이 **줄어들면** 이어 읽기가 어긋난다(교체·잘림) — 그때는 상태를 버리고 처음부터 다시 읽는다.
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

/**
 * 짝을 기다리는 Bash tool_use 의 상한. **전경 Bash 까지 담기 때문에** 필요하다(⑰).
 * tool_result 는 대개 바로 다음 줄이라 실사용에서는 몇 개를 넘지 않는다 — 답이 영영 안 오는
 * 줄(중단된 턴)만 남고, 그것이 무한정 쌓이지 않도록 오래된 것부터 버린다.
 */
const PENDING_BASH_MAX = 200;

const scanStates = new Map<string, ShellScanState>();

function freshScanState(): ShellScanState {
  return { offset: 0, size: 0, mtimeMs: 0, pending: new Map(), shells: [], killed: new Set() };
}

/** 누적 상태에서 지금 살아있는 셸 목록을 뽑는다(종전 함수 말미의 필터와 동일). */
function activeShellsOf(state: ShellScanState): ActiveBackgroundShell[] {
  // §7.11 v2.4 — Vibisual 자체 런처 셸(node scripts/runapp.mjs 등)은 제외한다.
  // 그 output 파일은 실행된 Vibisual 앱 자신의 로그라, 감지가 자기 로그를 되읽어
  // 모든 포트를 서버로 오등록하는 self-ingestion 루프를 만든다.
  return state.shells.filter(
    (s) => !state.killed.has(s.shellId) && !isVibisualLauncherCommand(s.command),
  );
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

        // §5.5 #17-9 ⑰ — **깃발이 아니라 하니스의 답으로 판정한다.**
        //   종전에는 `run_in_background === true` 인 tool_use 만 담았다. 그런데 전경 Bash 가
        //   120초 제한을 넘으면 하니스가 **말없이 백그라운드로 옮긴다**, 그리고 그 tool_use 에는
        //   깃발이 없다(실측: `run_in_background: undefined` + 결과문 "moved to the background").
        //   그래서 승격된 셸은 이 목록에 통째로 빠졌고, 명령 원문을 못 찾아 조용한 항목
        //   조사(⑭)의 후보조차 되지 못했다 — 끝 표식도 조사도 없이 영원히 남는 유일한 부류였다.
        //   여기서는 Bash 호출의 명령문만 들고 있다가, 아래 tool_result 가 **백그라운드 모양으로
        //   답할 때만** 실제 셸로 등록한다(깃발 ❌, 관측 사실 ⭕).
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
