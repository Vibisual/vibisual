/**
 * BackgroundShellWatcher — Claude Code `run_in_background` Bash의 output 파일을
 * 주기적으로 tail하여 listen 포트를 탐지한다. 포트 발견 시 콜백 호출 후 자동 중지.
 */
import fs from 'node:fs';
import { logger } from '../logger.js';
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

/** Claude Code Bash run_in_background tool_response 텍스트에서 shell_id + output 경로 추출 */
export function parseBackgroundShellResponse(
  text: string,
): { shellId: string; outputPath: string } | null {
  const idMatch = text.match(/ID:\s+(\S+?)[.\s]/);
  // 현 Claude Code bg 결과는 개행 없는 한 줄:
  //   "...Output is being written to: <path>.output. You will be notified ..."
  // `(.+?)(?:\r?\n|$)` 는 개행이 없어 뒤 안내문까지 경로에 흡수한다 → 경로 깨짐.
  // 하니스 출력 파일은 항상 `<shellId>.output` 이므로 `.output` 에서 끊는다.
  // 구 포맷(개행 종결 등) 대비 기존 정규식을 폴백으로 유지.
  const pathMatch =
    text.match(/Output is being written to:\s+(.+?\.output)\b/) ??
    text.match(/Output is being written to:\s+(.+?)(?:\r?\n|$)/);
  if (!idMatch?.[1] || !pathMatch?.[1]) return null;
  return { shellId: idMatch[1], outputPath: pathMatch[1].trim() };
}

/** 기존 세션 JSONL에서 아직 살아있는 background shell 목록 추출 */
export interface ActiveBackgroundShell {
  shellId: string;
  outputPath: string;
  command: string;
  toolUseId: string;
  startedAt: number;
}

export function scanActiveBackgroundShells(jsonlPath: string): ActiveBackgroundShell[] {
  if (!fs.existsSync(jsonlPath)) return [];

  // 1) bg Bash invocation: assistant tool_use → { toolUseId, command, timestamp }
  const pending = new Map<string, { command: string; startedAt: number }>();
  // 2) tool_result (user entry) → toolUseId와 매칭되는 shellId/outputPath
  const shells: ActiveBackgroundShell[] = [];
  // 3) KillShell이 호출된 shell_id 집합
  const killed = new Set<string>();

  let content: string;
  try {
    content = fs.readFileSync(jsonlPath, 'utf8');
  } catch {
    return [];
  }

  for (const line of content.split('\n')) {
    if (!line) continue;
    let entry: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== 'object' || parsed === null) continue;
      entry = parsed as Record<string, unknown>;
    } catch { continue; }

    const msg = entry['message'] as Record<string, unknown> | undefined;
    if (!msg || !Array.isArray(msg['content'])) continue;
    const ts = typeof entry['timestamp'] === 'string' ? Date.parse(entry['timestamp']) : Date.now();

    for (const block of msg['content'] as unknown[]) {
      if (typeof block !== 'object' || block === null) continue;
      const b = block as Record<string, unknown>;

      // assistant → tool_use(Bash, run_in_background=true) 또는 tool_use(KillShell)
      if (b['type'] === 'tool_use') {
        const name = typeof b['name'] === 'string' ? b['name'] : '';
        const input = b['input'] as Record<string, unknown> | undefined;
        const uid = typeof b['id'] === 'string' ? b['id'] : '';

        if (name === 'Bash' && input?.['run_in_background'] === true && uid) {
          const cmd = typeof input['command'] === 'string' ? input['command'] : '';
          pending.set(uid, { command: cmd, startedAt: ts });
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
  }

  // §7.11 v2.4 — Vibisual 자체 런처 셸(node scripts/runapp.mjs 등)은 제외한다.
  // 그 output 파일은 실행된 Vibisual 앱 자신의 로그라, 감지가 자기 로그를 되읽어
  // 모든 포트를 서버로 오등록하는 self-ingestion 루프를 만든다.
  return shells.filter(
    (s) => !killed.has(s.shellId) && !isVibisualLauncherCommand(s.command),
  );
}
