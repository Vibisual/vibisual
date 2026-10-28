/**
 * §5.7 #23-2 — Claude Code Agent View(per-user supervisor) 통합 서비스: 활성화 게이트(`isAgentViewEnabled`) · `claude --bg` 디스패치(`spawnBackground`) · `stopSession`/`rmSession` · 디스크 상태 읽기(`readRoster`/`readJobState`) · 부팅 reconcile(`reconcileOnBoot`).
 * BubbleData/SubAgent 는 만지지 않는다 — 호출자(subAgentManager / index.ts)가 결과를 자기 데이터에 적용한다.
 * `--bg` 는 `--session-id <uuid>` 를 거부하므로 sessionId 는 supervisor 가 할당한 것을 roster.json·state.json 에서 읽어 와야 한다.
 */
import { spawn } from 'node:child_process';
import { observeChildStreamErrors } from './childStreamErrors.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentViewRosterEntry, AgentViewJobState } from '@vibisual/shared';
import { logger } from '../logger.js';
import { claudeSpawnEnv, getClaudeBin, noteClaudeSpawnFailure } from './claudeBin.js';
import { getClaudeVersionInfo } from './claudeVersionService.js';
import { getSessionJsonlPath } from './sessionDiscovery.js';
import { processGroupSpawnOptions } from './processTree.js';

const CLAUDE_BIN = (): string => getClaudeBin().binPath;

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
/** 판정 메모를 두는 시간(ms) — 너무 길면 CLI 를 갱신한 뒤에도 옛 판정이 남는다. */
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
 * - prompt 는 **stdin UTF-8** 으로 넘긴다 — Windows 에서 argv 의 CJK 가 OEM 디코딩으로 깨질 수 있고, stdin pipe 는 UTF-8 이 보존된다.
 * - extraArgs 는 buildConfigArgs() 결과(`--model`·`--permission-mode`·`--tools`·`--isolation` 등)를 그대로 받는다. `--session-id` 는 supervisor 가 거부하므로 호출자가 빼 둔다.
 * - 자식은 ~1초 안에 stdout 에 `backgrounded · <short>` 를 찍고 끝난다. timeout(15s)이면 reject.
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

    const child = spawn(CLAUDE_BIN(), args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      // POSIX 한정 detached — `--bg` 런처는 금방 끝나도 뒤에 남는 워커는 오래 산다. 그룹을 떼어 두면 서버 프로세스 그룹에 가는 신호(터미널 Ctrl+C 등)에 워커가 휩쓸리지 않는다.
      // killTree 는 쓰지 않는다(정지 경로는 `claude stop <short>`). unref() 도 붙이지 않는다.
      ...processGroupSpawnOptions(),
      // §4 (앱 전용 엔진) ⑤ — 앱 전용 실행본이면 엔진 자체 갱신을 끈다.
      env: claudeSpawnEnv({
        ...process.env,
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        PYTHONIOENCODING: 'utf-8',
        ...envExtra,
      }),
    });

    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      try { child.kill(); } catch { /* ignore */ }
      reject(new Error(`claude --bg timed out after ${BG_SPAWN_TIMEOUT_MS}ms (stdout="${stdout.slice(0, 200)}")`));
    }, BG_SPAWN_TIMEOUT_MS);

    observeChildStreamErrors(child, (stream, error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      // Only the short-lived launcher belongs to this failure; never kill its background worker tree.
      try { child.kill(); } catch { /* launcher already exited */ }
      reject(new Error(`claude --bg ${stream} failed: ${error.message}`));
    });

    child.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      // §4 (실행본 자가 복구) — ENOENT 면 캐시된 실행본이 사라진 것: 다음 호출이 재해석하도록 버린다.
      noteClaudeSpawnFailure(err);
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

/** roster.json 에서 그 short 가 살아 있는지 sync 점검 — 부팅(restore 직후) orphan 정리가 agent-view sub 를 잘못 봉합하지 않게. 파일이나 short 가 없으면 false. */
export function isShortAlive(short: string): boolean {
  const r = readRoster();
  return !!r?.workers?.[short];
}

/**
 * short 가 **실제로 턴을 처리 중인지** — roster 에 없으면 false, state.json 이 `working`·`needs-input` 이면 true, 그 밖(`idle`·`done`·`failed`·`stopped`·파일 없음)은 false.
 * restore 직후 끝난 worker(roster 엔 남았지만 턴을 안 굴림)를 active 로 되살려 부모가 idle→active→completed 를 도는 것을 막는다.
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
    // detached 를 **일부러 안 붙인다** — `claude stop|rm <short>` 는 손자를 만들지 않고 즉시 끝나는
    //   하위명령이라 프로세스 그룹이 필요 없다(우리도 killTree 로 회수하지 않는다).
    const child = spawn(CLAUDE_BIN(), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
      env: claudeSpawnEnv(),
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c) => { stdout += c.toString(); });
    child.stderr?.on('data', (c) => { stderr += c.toString(); });
    child.on('error', (err) => { noteClaudeSpawnFailure(err); resolve({ exitCode: -1, stdout, stderr }); });
    child.on('close', (code) => resolve({ exitCode: code, stdout, stderr }));
  });
}

export function stopSession(short: string): Promise<void> {
  return fireSubcommand(['stop', short]).then((r) => {
    if (r.exitCode !== 0) logger.warn(`claude stop ${short} exit=${r.exitCode} stderr="${r.stderr.slice(0, 120)}"`);
  });
}

export function rmSession(short: string): Promise<void> {
  return fireSubcommand(['rm', short]).then((r) => {
    if (r.exitCode !== 0) logger.warn(`claude rm ${short} exit=${r.exitCode} stderr="${r.stderr.slice(0, 120)}"`);
  });
}

/**
 * 부팅 시 reconcile 진입점 — 분류만 돌려준다(watcher 재부착·버블 마무리는 호출자 index.ts 부팅 시퀀스가 graphManager·watcher 에 맡긴다).
 * @param knownShorts 체크포인트가 든 모든 (bubbleId → agentViewShort) 매핑의 short 목록(호출자가 graphManager 에서 뽑는다).
 * @returns alive(살아 있는 short), gone(roster 에 없는 short).
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
