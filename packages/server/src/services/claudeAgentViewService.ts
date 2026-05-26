/**
 * §5.7 #23-2 v1.60 — Claude Code Agent View (per-user supervisor) 통합 서비스.
 *
 * 책임:
 * - Agent View 활성화 게이트 (`isAgentViewEnabled`) — 버전 v2.1.139+ && !disableAgentView 점검.
 * - `claude --bg` 백그라운드 디스패치 (`spawnBackground`) — short id 캡처 + roster 에서 sessionId 회수.
 * - 라이프사이클 명령 (`stopSession` / `respawnSession` / `rmSession` / `respawnAllSessions`) — 짧은 subprocess.
 * - 디스크 상태 읽기 (`readRoster` / `readJobState`) — supervisor 가 쓰는 평범한 JSON 파일.
 * - 부팅 시 reconcile 진입점 (`reconcileOnBoot`) — 살아있는 worker 매칭 + 사라진 worker 의 최종 상태 회수.
 *
 * 비고:
 * - 본 모듈은 어떤 BubbleData/SubAgent 도 직접 만지지 않는다. 호출자(subAgentManager / index.ts)가
 *   service 출력을 받아 자기 데이터에 적용한다 — 책임 분리.
 * - `--bg` 가 `--session-id <uuid>` 를 명시적으로 거부하므로 sessionId 는 supervisor 가 할당한 것을
 *   roster.json 또는 state.json 에서 읽어와야 한다.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentViewRosterEntry, AgentViewJobState } from '@vibisual/shared';
import { logger } from '../logger.js';
import { resolveClaudeBin } from './claudeBin.js';
import { getClaudeVersionInfo } from './claudeVersionService.js';
import { getSessionJsonlPath } from './sessionDiscovery.js';

const CLAUDE_BIN = resolveClaudeBin().binPath;

const HOME = os.homedir();
const ROSTER_PATH = path.join(HOME, '.claude', 'daemon', 'roster.json');
const JOBS_DIR = path.join(HOME, '.claude', 'jobs');
const SETTINGS_PATH = path.join(HOME, '.claude', 'settings.json');

/** Agent View 가 처음 등장한 안정 버전 — docs: v2.1.139 (2026-05-11). */
export const AGENT_VIEW_MIN_VERSION = '2.1.139';

/** Background spawn stdout 의 short id 라인 — 정규식 한 곳에서 관리. */
const BACKGROUNDED_SHORT_RE = /^backgrounded · ([0-9a-f]{8})\b/m;

/** spawn `--bg` 의 자식이 spawn 후 자체 종료할 때까지의 최대 대기 (안전망). */
const BG_SPAWN_TIMEOUT_MS = 15_000;

/** roster.json 에서 sessionId 찾기까지의 폴링 최대치 (state.json 도 같은 윈도우 안에서 시도). */
const SESSION_ID_RESOLVE_TIMEOUT_MS = 5_000;
const SESSION_ID_RESOLVE_INTERVAL_MS = 100;

/** `isAgentViewEnabled` 결과 메모이즈 (서버 라이프 동안). 분기 게이트 안정성 위해. */
let cachedEnabled: { value: boolean; reason: string; at: number } | null = null;
/** 메모 무효화까지 보존할 ms — 너무 길면 사용자 업데이트 후 다음 부팅 까지 옛 판정 유지 */
const ENABLED_CACHE_TTL_MS = 60_000;

/** `~/.claude/settings.json` 의 `disableAgentView` 필드 + 환경변수 점검. */
function isAgentViewDisabledByConfig(): { disabled: boolean; reason?: string } {
  if (process.env.CLAUDE_CODE_DISABLE_AGENT_VIEW) {
    return { disabled: true, reason: 'env CLAUDE_CODE_DISABLE_AGENT_VIEW set' };
  }
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return { disabled: false };
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed['disableAgentView'] === true) {
      return { disabled: true, reason: 'settings.json disableAgentView=true' };
    }
  } catch { /* settings 파일 손상은 무시 (Agent View 활성 쪽으로 폴백) */ }
  return { disabled: false };
}

/** semver 비교: a >= b 면 true. parse 실패 시 false (safe → legacy path). */
function semverGte(a: string, b: string): boolean {
  const parse = (v: string): number[] => (v.split(/[-+]/)[0] ?? '').split('.').map((n) => parseInt(n, 10) || 0);
  const A = parse(a);
  const B = parse(b);
  const len = Math.max(A.length, B.length);
  for (let i = 0; i < len; i++) {
    const ai = A[i] ?? 0;
    const bi = B[i] ?? 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return true;
}

/**
 * Agent View 가 현재 환경에서 활성화되어 있는가?
 * 게이트: `claude --version >= 2.1.139` && `!disableAgentView`(settings + env).
 * 결과는 60초 캐시. forceRefresh=true 로 즉시 재판정 가능.
 */
export async function isAgentViewEnabled(forceRefresh = false): Promise<{ enabled: boolean; reason: string }> {
  const now = Date.now();
  if (!forceRefresh && cachedEnabled && now - cachedEnabled.at < ENABLED_CACHE_TTL_MS) {
    return { enabled: cachedEnabled.value, reason: cachedEnabled.reason };
  }

  const cfg = isAgentViewDisabledByConfig();
  if (cfg.disabled) {
    const out = { enabled: false, reason: cfg.reason ?? 'disabled by config' };
    cachedEnabled = { value: false, reason: out.reason, at: now };
    return out;
  }

  let version: string | null = null;
  try {
    const info = await getClaudeVersionInfo(false);
    version = info.current;
  } catch (err) {
    const reason = `version check failed: ${err instanceof Error ? err.message : String(err)}`;
    cachedEnabled = { value: false, reason, at: now };
    return { enabled: false, reason };
  }

  if (!version) {
    const reason = 'version unknown';
    cachedEnabled = { value: false, reason, at: now };
    return { enabled: false, reason };
  }
  if (!semverGte(version, AGENT_VIEW_MIN_VERSION)) {
    const reason = `version ${version} < ${AGENT_VIEW_MIN_VERSION}`;
    cachedEnabled = { value: false, reason, at: now };
    return { enabled: false, reason };
  }

  const reason = `version ${version} >= ${AGENT_VIEW_MIN_VERSION}, no opt-out`;
  cachedEnabled = { value: true, reason, at: now };
  return { enabled: true, reason };
}

/** 메모 캐시 무효화 — 예: 사용자가 모달에서 Claude Code 업데이트 직후 호출. */
export function invalidateAgentViewEnabledCache(): void {
  cachedEnabled = null;
}

/** 결과 페이로드: spawnBackground 성공 시 반환. */
export interface AgentViewSpawnResult {
  short: string;
  sessionId: string;
  jsonlPath: string;
}

/** stdout 에서 `backgrounded · <short>` 라인 추출. 없으면 null. */
export function parseBackgroundedShort(stdout: string): string | null {
  const m = stdout.match(BACKGROUNDED_SHORT_RE);
  return m ? (m[1] ?? null) : null;
}

/** 짧은 wait 후 roster.json / state.json 에서 sessionId 회수. 둘 다 실패 시 null. */
async function resolveSessionIdForShort(short: string): Promise<string | null> {
  const started = Date.now();
  while (Date.now() - started < SESSION_ID_RESOLVE_TIMEOUT_MS) {
    // 1) roster 우선 — 가장 빨리 채워짐
    const roster = readRoster();
    const w = roster?.workers?.[short];
    if (w?.sessionId) return w.sessionId;
    // 2) state.json 폴백
    const state = readJobState(short);
    if (state?.sessionId) return state.sessionId;
    await new Promise((r) => setTimeout(r, SESSION_ID_RESOLVE_INTERVAL_MS));
  }
  return null;
}

/**
 * `claude --bg` 로 백그라운드 세션을 시작한다.
 *
 * - prompt 는 **stdin UTF-8** 으로 전달(v1.33 Windows 인코딩 픽스와 같은 이유 — argv 의 CJK 가 OEM 디코딩
 *   되어 깨질 수 있음. stdin pipe 는 UTF-8 보존이 검증됨).
 * - extraArgs 는 buildConfigArgs() 결과(`--model` / `--permission-mode` / `--tools` / `--isolation` 등) 를
 *   그대로 받는다. `--session-id` 는 supervisor 가 거부하므로 호출자가 빼두어야 한다.
 * - 자식은 ~1초 안에 stdout 에 `backgrounded · <short>` 인쇄 후 자체 종료. timeout(15s) 이면 reject.
 */
export async function spawnBackground(
  prompt: string,
  extraArgs: string[],
  cwd: string,
  envExtra?: Record<string, string>,
): Promise<AgentViewSpawnResult> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    let stdout = '';
    let stderr = '';

    const args = ['--bg', ...extraArgs];

    const child = spawn(CLAUDE_BIN, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      env: {
        ...process.env,
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        PYTHONIOENCODING: 'utf-8',
        ...envExtra,
      },
    });

    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      try { child.kill(); } catch { /* ignore */ }
      reject(new Error(`claude --bg timed out after ${BG_SPAWN_TIMEOUT_MS}ms (stdout="${stdout.slice(0, 200)}")`));
    }, BG_SPAWN_TIMEOUT_MS);

    child.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      reject(err);
    });

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (c: string) => { stdout += c; });
    child.stderr?.on('data', (c: string) => { stderr += c; });

    child.on('close', (code) => {
      if (resolved) return;
      clearTimeout(timer);
      // exit code 0 이어도 short 못 잡으면 실패. 다양한 stderr 경고는 무시.
      const short = parseBackgroundedShort(stdout);
      if (!short) {
        resolved = true;
        const detail = stderr ? ` stderr="${stderr.slice(0, 200)}"` : '';
        reject(new Error(`claude --bg returned no short id (exit=${code}, stdout="${stdout.slice(0, 200)}")${detail}`));
        return;
      }
      // sessionId 회수 — 비동기. resolveSessionIdForShort 가 자체 폴링/타임아웃.
      resolveSessionIdForShort(short).then((sessionId) => {
        if (resolved) return;
        resolved = true;
        if (!sessionId) {
          reject(new Error(`could not resolve sessionId for short=${short} within ${SESSION_ID_RESOLVE_TIMEOUT_MS}ms`));
          return;
        }
        const jsonlPath = getSessionJsonlPath(cwd, sessionId);
        resolve({ short, sessionId, jsonlPath });
      }).catch((err) => {
        if (resolved) return;
        resolved = true;
        reject(err);
      });
    });

    // prompt → stdin (UTF-8). 빈 문자열도 허용 (idle session — docs: "idle — send a prompt to start").
    try {
      child.stdin?.setDefaultEncoding('utf8');
      if (prompt) child.stdin?.write(prompt, 'utf8');
      child.stdin?.end();
    } catch (err) {
      logger.warn(`spawnBackground stdin write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

/**
 * roster.json 에서 특정 short 가 살아있는지 sync 점검.
 * 부팅 시퀀스 중(restore 직후) orphan 정리 로직이 agent-view sub 를 잘못 봉합하지 않도록
 * sync 가드용. roster 파일이 없거나 short 가 없으면 false.
 */
export function isShortAlive(short: string): boolean {
  const r = readRoster();
  return !!r?.workers?.[short];
}

/**
 * v1.60: short 가 **실제로 턴을 처리 중인지** 점검.
 * roster.json + state.json 둘 다 본다:
 * - roster 에 없으면 false (worker 자체가 없음)
 * - state.json.state === 'working' | 'needs-input' → true (현재 턴 진행 중)
 * - 그 외('idle' | 'done' | 'failed' | 'stopped' | state.json 없음) → false
 *
 * 용도: restore 직후 sub.status='active' 복원 시, 끝난 worker(roster 엔 남았지만 turn 안 굴림)
 * 를 잘못 active 로 부활시켜 부모 에이전트가 idle→active→completed 사이클 타는 것 방지.
 */
export function isShortWorking(short: string): boolean {
  if (!isShortAlive(short)) return false;
  const s = readJobState(short);
  return s?.state === 'working' || s?.state === 'needs-input';
}

/** `~/.claude/daemon/roster.json` 1회 읽기. 파일 없거나 깨졌으면 null. */
export function readRoster(): { workers: Record<string, AgentViewRosterEntry> } | null {
  try {
    if (!fs.existsSync(ROSTER_PATH)) return null;
    const raw = fs.readFileSync(ROSTER_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { workers?: Record<string, AgentViewRosterEntry> };
    if (!parsed.workers || typeof parsed.workers !== 'object') return null;
    return { workers: parsed.workers };
  } catch (err) {
    logger.warn(`readRoster failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** `~/.claude/jobs/<short>/state.json` 1회 읽기. */
export function readJobState(short: string): AgentViewJobState | null {
  try {
    const p = path.join(JOBS_DIR, short, 'state.json');
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw) as AgentViewJobState;
  } catch (err) {
    logger.warn(`readJobState(${short}) failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** fire-and-forget 헬퍼 — short subprocess 1회 발사. exitCode 만 promise. */
function fireSubcommand(args: string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c) => { stdout += c.toString(); });
    child.stderr?.on('data', (c) => { stderr += c.toString(); });
    child.on('error', () => resolve({ exitCode: -1, stdout, stderr }));
    child.on('close', (code) => resolve({ exitCode: code, stdout, stderr }));
  });
}

export function stopSession(short: string): Promise<void> {
  return fireSubcommand(['stop', short]).then((r) => {
    if (r.exitCode !== 0) logger.warn(`claude stop ${short} exit=${r.exitCode} stderr="${r.stderr.slice(0, 120)}"`);
  });
}

export function respawnSession(short: string): Promise<void> {
  return fireSubcommand(['respawn', short]).then((r) => {
    if (r.exitCode !== 0) logger.warn(`claude respawn ${short} exit=${r.exitCode} stderr="${r.stderr.slice(0, 120)}"`);
  });
}

export function rmSession(short: string): Promise<void> {
  return fireSubcommand(['rm', short]).then((r) => {
    if (r.exitCode !== 0) logger.warn(`claude rm ${short} exit=${r.exitCode} stderr="${r.stderr.slice(0, 120)}"`);
  });
}

export function respawnAllSessions(): Promise<void> {
  return fireSubcommand(['respawn', '--all']).then((r) => {
    logger.info(`claude respawn --all exit=${r.exitCode} stdout="${r.stdout.slice(0, 200)}"`);
  });
}

/**
 * 부팅 시 호출되는 reconcile 진입점.
 *
 * @param knownShorts — 우리 체크포인트가 들고 있는 모든 (bubbleId → agentViewShort) 매핑의 short 목록.
 *                     호출자가 graphManager 에서 추출해 넘긴다.
 * @returns 분류 결과: alive (살아있는 short), gone (roster 에 없는 short).
 *
 * 본 함수는 데이터 구조만 분류해 돌려준다. 실제 watcher 재부착이나 버블 상태 마무리는
 * 호출자(index.ts boot sequence)가 결과를 받아 graphManager 와 watcher 에 위임한다.
 */
export function reconcileOnBoot(knownShorts: string[]): {
  alive: { short: string; sessionId: string; cwd: string }[];
  gone: { short: string; finalState: AgentViewJobState | null }[];
} {
  const alive: { short: string; sessionId: string; cwd: string }[] = [];
  const gone: { short: string; finalState: AgentViewJobState | null }[] = [];
  const roster = readRoster();

  for (const short of knownShorts) {
    const w = roster?.workers?.[short];
    if (w?.sessionId && w?.cwd) {
      alive.push({ short, sessionId: w.sessionId, cwd: w.cwd });
    } else {
      gone.push({ short, finalState: readJobState(short) });
    }
  }

  if (alive.length > 0) {
    logger.info(`[agent-view reconcile] alive=${alive.length} gone=${gone.length}`);
  }
  return { alive, gone };
}
