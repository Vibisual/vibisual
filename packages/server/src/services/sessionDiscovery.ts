import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync, spawn } from 'node:child_process';
import {
  INITIAL_AGENT_COUNT, MAX_AGENT_EVENTS, getModelContextLimit,
  TOKEN_BYTES_RATIO, TOKEN_FIXED_CATEGORIES,
} from '@vibisual/shared';
import { modelRegistryService } from './modelRegistryService.js';
import type { AgentEvent, TodoItem, TurnTokenUsage, TokenCategoryEstimate, SessionTokenData } from '@vibisual/shared';
import { logger } from '../logger.js';
import { dbg } from './debugLog.js';
import { resolveClaudeBin } from './claudeBin.js';

/** `claude` CLI 바이너리 SSOT 경로 (subAgentManager/contiManager 와 동일). */
const CLAUDE_BIN = resolveClaudeBin().binPath;

/**
 * Claude Code 세션 ID 안전 문자셋. 세션 ID 는 UUID 계열(hex + 하이픈)이며
 * 세션 JSON/훅 페이로드에서 유입되므로, spawn 인자로 쓰기 전 반드시 검증한다.
 * (shell:false 로도 차단되지만 방어 심층 — 이상 ID 면 아예 spawn 하지 않음.)
 */
const SAFE_SESSION_ID = /^[0-9a-fA-F-]{8,64}$/;

/** 세션 진입점 — session.json.entrypoint에서 추출. 영속 정책 판단에 사용. */
export type SessionEntrypoint = 'vscode' | 'cli' | 'unknown';

/** 로컬 Claude Code 세션 정보 */
export interface LocalSession {
  pid: number;
  sessionId: string;
  cwd: string;
  /** 세션 제목 (첫 유저 메시지) or "ProjectName (new)" fallback */
  title: string;
  projectName: string;
  /** JSONL에서 제목을 읽었는지 여부 (false면 재스캔 대상) */
  hasTitle: boolean;
  startedAt: number;
  /** 어디서 켠 세션인지 — VSCode는 닫아도 유지, CLI는 프로세스 종료 시 제거 */
  entrypoint: SessionEntrypoint;
}

/** session.json의 entrypoint 문자열 → SessionEntrypoint */
export function parseEntrypoint(raw: unknown): SessionEntrypoint {
  if (typeof raw !== 'string') return 'unknown';
  const s = raw.toLowerCase();
  if (s.includes('vscode')) return 'vscode';
  if (s.includes('claude-code') || s === 'claude' || s.includes('cli')) return 'cli';
  return 'unknown';
}

const SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const MAX_TITLE_LENGTH = 40;

/** sessionId → entrypoint 조회. 세션 파일이 없으면 'unknown' */
export function findEntrypointBySession(sessionId: string): SessionEntrypoint {
  try {
    const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const raw: unknown = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf8'));
        if (typeof raw !== 'object' || raw === null) continue;
        const d = raw as Record<string, unknown>;
        if (d['sessionId'] === sessionId) return parseEntrypoint(d['entrypoint']);
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }
  return 'unknown';
}

/** sessionId → cwd 조회 (세션 파일에서). sessionCwds에 없을 때의 폴백. */
export function findCwdBySession(sessionId: string): string | null {
  try {
    const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const raw: unknown = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf8'));
        if (typeof raw !== 'object' || raw === null) continue;
        const d = raw as Record<string, unknown>;
        if (d['sessionId'] === sessionId && typeof d['cwd'] === 'string') {
          return d['cwd'];
        }
      } catch { /* skip */ }
    }
    return null;
  } catch {
    return null;
  }
}

/** sessionId → PID 조회 (세션 파일에서) */
export function findPidBySession(sessionId: string): number | null {
  try {
    const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const raw: unknown = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf8'));
        if (typeof raw !== 'object' || raw === null) continue;
        const d = raw as Record<string, unknown>;
        if (d['sessionId'] === sessionId && typeof d['pid'] === 'number') {
          return d['pid'];
        }
      } catch { /* skip */ }
    }
    return null;
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * §5.7 #24 단일 생존 판정 결과 — `~/.claude/sessions/<PID>.json` 한 파일의 파싱 + 판정.
 * 에이전트를 추가하는 경로(discoverSessions/seedAgents)와 제거하는
 * 경로(SessionLifecycleManager.pollOnce → readAliveSessionIds)가 동일한 레코드를
 * 거쳐, add/remove 가 같은 기준을 쓰도록 한다.
 */
export interface SessionLiveness {
  /** 세션 JSON 파일명 (진단 로그용) */
  file: string;
  sessionId: string;
  pid: number;
  cwd: string;
  entrypoint: SessionEntrypoint;
  startedAt: number;
  /** §5.7 #24 (a) PID alive + (c) entrypoint=vscode 둘 다 통과 = 살아있는 Hook 에이전트 후보. */
  live: boolean;
  /** live=false 사유 (또는 'ok') — 진단 로그용. */
  reason: string;
}

/**
 * v1.2 Session Liveness Watcher (§5.7 #24) — **단일 생존 판정 함수**.
 * `~/.claude/sessions/*.json` 을 한 번 읽어, 각 세션이 Hook 에이전트 버블 후보로
 * 살아있는지를 (a) PID alive + (c) entrypoint=vscode 기준으로 판정한다.
 *
 * 에이전트를 "추가하는" 경로(discoverSessions/seedAgents)와 "제거하는"
 * 경로(SessionLifecycleManager.pollOnce → readAliveSessionIds)가 **모두 이 함수**를
 * 거치게 하여, 한쪽만 통과하고 다른쪽은 탈락하는 비대칭(=10초 주기 버블 깜빡임)을
 * 원천 차단한다. (b) cwd-프로젝트 일치는 프로젝트 스코프라 discoverSessions 가
 * 이 판정 위에 추가로 적용한다.
 */
export function scanSessionLiveness(): SessionLiveness[] {
  const out: SessionLiveness[] = [];
  try {
    const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const raw: unknown = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf8'));
        if (typeof raw !== 'object' || raw === null) {
          out.push({ file, sessionId: '', pid: 0, cwd: '', entrypoint: 'unknown', startedAt: 0, live: false, reason: 'not-object' });
          continue;
        }
        const d = raw as Record<string, unknown>;
        const sessionId = typeof d['sessionId'] === 'string' ? d['sessionId'] : '';
        const pid = typeof d['pid'] === 'number' ? d['pid'] : 0;
        const cwd = typeof d['cwd'] === 'string' ? d['cwd'] : '';
        const entrypoint = parseEntrypoint(d['entrypoint']);
        const startedAt = typeof d['startedAt'] === 'number' ? d['startedAt'] : 0;
        const base = { file, sessionId, pid, cwd, entrypoint, startedAt };
        if (!sessionId || !pid) { out.push({ ...base, live: false, reason: 'missing-sid-or-pid' }); continue; }
        if (!isProcessAlive(pid)) { out.push({ ...base, live: false, reason: 'pid-dead' }); continue; }
        if (entrypoint !== 'vscode') { out.push({ ...base, live: false, reason: 'not-vscode' }); continue; }
        out.push({ ...base, live: true, reason: 'ok' });
      } catch (e) {
        out.push({ file, sessionId: '', pid: 0, cwd: '', entrypoint: 'unknown', startedAt: 0, live: false, reason: `parse-error: ${String(e)}` });
      }
    }
  } catch { /* ignore */ }
  return out;
}

/**
 * 살아있는(=Hook 에이전트 버블로 노출 가능한) 세션 ID 집합.
 * 훅 에이전트 버블 lifecycle 판정 소스(마스터) — `scanSessionLiveness` 의 얇은 래퍼.
 */
let lastAliveDiagKey = '';
export function readAliveSessionIds(): Set<string> {
  const scan = scanSessionLiveness();
  const result = new Set<string>();
  for (const s of scan) {
    if (s.live) result.add(s.sessionId);
  }
  const curKey = JSON.stringify(scan);
  if (curKey !== lastAliveDiagKey) {
    lastAliveDiagKey = curKey;
    dbg('readAliveSessionIds.diff', scan);
  }
  return result;
}

/**
 * Windows 한정: 현재 실행 중인 claude.exe PID 집합.
 * Claude Code CLI/VSCode는 claude.exe로 돌아가므로, 세션 PID가 이 집합에 없으면
 * 원래 프로세스는 죽었고 PID가 재사용됐거나 비활성 상태.
 * 10초에 한 번 호출되는 용도라 성능 부담 없음.
 */
export function getAliveNodePids(): Set<number> {
  const pids = new Set<number>();
  if (process.platform !== 'win32') return pids; // non-Windows: 빈 집합 → isProcessAlive로 폴백
  try {
    const out = execSync('tasklist /NH /FO CSV /FI "IMAGENAME eq claude.exe"', {
      encoding: 'utf8',
      timeout: 5000,
    });
    for (const line of out.split(/\r?\n/)) {
      const m = /^"claude\.exe","(\d+)"/.exec(line.trim());
      if (m) pids.add(parseInt(m[1]!, 10));
    }
  } catch (err) {
    logger.warn('getAliveNodePids failed', err);
  }
  return pids;
}

/**
 * `claude -p --session-id <id> "x"` 를 짧은 timeout으로 실행하여 세션이 "이미 사용 중"인지 판정.
 *
 * 동작 원리:
 *   - 세션이 다른 Claude Code 프로세스에서 활성 → stderr에 "already in use" 즉시 출력 후 종료 (~0.5s)
 *   - 세션이 비활성 → 새 Claude Code가 프롬프트 실행 시도 (수 초 이상 소요) → timeout으로 kill
 *
 * **중요**: `--session-id` 체크는 세션의 원래 cwd에서 실행해야만 동작한다.
 * 다른 cwd에서 실행하면 "already in use"가 나오지 않아 활성 세션도 비활성으로 오판정한다.
 */
/** isSessionInUse 실행 결과를 외부(인덱스)에서 구독 — WS broadcast용 */
export type LivenessProbeListener = (result: {
  sessionId: string;
  cwd: string;
  inUse: boolean;
  durationMs: number;
  reason: string;
  output: string;
  command: string;
}) => void;
let probeListener: LivenessProbeListener | null = null;
export function setLivenessProbeListener(fn: LivenessProbeListener | null): void {
  probeListener = fn;
}

export function isSessionInUse(sessionId: string, cwd: string, timeoutMs = 1500): Promise<boolean> {
  const shortId = sessionId.slice(0, 8);
  const t0 = Date.now();
  if (!SAFE_SESSION_ID.test(sessionId)) {
    logger.warn(`[isSessionInUse] REJECT unsafe sessionId sess=${shortId} (셸 인젝션 방지)`);
    return Promise.resolve(false);
  }
  const args = ['-p', 'x', '--resume', sessionId];
  const cmdLine = `${CLAUDE_BIN} -p "x" --resume ${sessionId}`;
  logger.info(`[isSessionInUse] SPAWN sess=${shortId} cwd=${cwd} cmd=${cmdLine}`);
  return new Promise((resolve) => {
    // 보안: shell:false + 해석된 CLAUDE_BIN. shell:true 는 win32 cmd.exe 가
    // sessionId 를 재파싱해 인젝션 가능했음 — SAFE_SESSION_ID 검증과 함께 차단.
    const child = spawn(
      CLAUDE_BIN,
      args,
      { shell: false, windowsHide: true, cwd },
    );
    let buf = '';
    let settled = false;
    const finish = (result: boolean, reason: string): void => {
      if (settled) return;
      settled = true;
      // Windows: child.kill()은 직접 자식만 신호하고 하위 프로세스 트리를
      // 종료하지 않는다. taskkill /T /F 로 트리 전체를 강제 종료한다.
      if (process.platform === 'win32') {
        if (child.pid != null && child.exitCode === null) {
          try {
            const tk = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
            tk.on('error', () => { /* ignore */ });
          } catch { /* ignore */ }
        }
      } else {
        try { child.kill(); } catch { /* ignore */ }
      }
      const dur = Date.now() - t0;
      logger.info(
        `[isSessionInUse] RESULT sess=${shortId} inUse=${result} dur=${dur}ms via=${reason} ` +
        `cmd=${cmdLine} cwd=${cwd} buf=${JSON.stringify(buf)}`,
      );
      if (probeListener) {
        try {
          probeListener({ sessionId, cwd, inUse: result, durationMs: dur, reason, output: buf, command: cmdLine });
        } catch (err) {
          logger.warn('probeListener threw', err);
        }
      }
      resolve(result);
    };
    const onData = (chunk: Buffer): void => {
      buf += chunk.toString('utf8');
      if (/already in use/i.test(buf)) finish(true, 'regex-match');
    };
    child.stderr.on('data', onData);
    child.stdout.on('data', onData);
    child.on('error', (err) => {
      logger.warn(`[isSessionInUse] SPAWN ERROR sess=${shortId} err=${String(err)}`);
      finish(false, 'spawn-error');
    });
    // 'exit'는 stdio 드레인 전에 발화할 수 있어 regex가 empty buf에 걸림 → 'close' 사용
    child.on('close', (code) => finish(/already in use/i.test(buf), `close-code=${code}`));
    setTimeout(() => finish(/already in use/i.test(buf), 'timeout'), timeoutMs);
  });
}

/**
 * 세션이 최근에 활동했는지 — JSONL 파일이 존재하고 mtime이 windowMs 이내인지.
 * Windows의 rename 기반 락 테스트가 Claude Code의 파일 핸들을 감지하지 못하므로
 * 실제 활동 신호인 mtime으로 대체. Claude Code는 user/assistant/tool 이벤트마다
 * JSONL에 append하므로, mtime이 최근이면 사용 중이라고 판정 가능.
 */
export function isSessionRecentlyActive(
  cwd: string,
  sessionId: string,
  windowMs: number,
): boolean {
  try {
    const slug = cwdToSlug(cwd);
    const jsonlPath = path.join(PROJECTS_DIR, slug, `${sessionId}.jsonl`);
    if (!fs.existsSync(jsonlPath)) return false;
    const stat = fs.statSync(jsonlPath);
    return Date.now() - stat.mtimeMs < windowMs;
  } catch {
    return false;
  }
}

/**
 * @deprecated Windows에서 Claude Code의 파일 핸들을 감지하지 못함.
 * isSessionRecentlyActive 사용할 것.
 */
export function isSessionJsonlLocked(cwd: string, sessionId: string): boolean {
  const slug = cwdToSlug(cwd);
  const jsonlPath = path.join(PROJECTS_DIR, slug, `${sessionId}.jsonl`);
  return isSessionFileLocked(jsonlPath);
}

/**
 * JSONL 파일을 현재 외부 프로세스가 append로 열고 있는지 판정.
 * Claude Code CLI/VSCode는 세션 동안 세션 JSONL을 계속 잡고 있어서,
 * 자기 자신으로 rename 시도가 EBUSY/EPERM으로 실패한다.
 * 커스텀 SubAgent(Task/Agent 툴 등)는 JSONL 핸들을 잡지 않으므로 성공 → 제외.
 */
export function isSessionFileLocked(jsonlPath: string): boolean {
  try {
    if (!fs.existsSync(jsonlPath)) return false;
    fs.renameSync(jsonlPath, jsonlPath);
    return false;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') return true;
    return false;
  }
}

/**
 * cwd → 프로젝트 slug.
 * Claude Code 실제 폴더명과 일치시키기 위해 디렉토리를 직접 탐색.
 * 매칭 실패 시 fallback으로 단순 변환.
 */
function cwdToSlug(cwd: string): string {
  // 단순 변환 (: \ / _ . → -)
  // `.` 변환은 worktree 경로(`.claude/worktrees/…`)를 Claude Code JSONL 디렉토리
  // (`--claude-worktrees-…`)에 매칭시키기 위해 필요.
  const simpleSlugs = [
    cwd.replace(/:/g, '-').replace(/[\\/]/g, '-').replace(/\./g, '-').replace(/_/g, '-'),
    cwd.replace(/:/g, '-').replace(/[\\/]/g, '-').replace(/\./g, '-'),
    cwd.replace(/:/g, '-').replace(/[\\/]/g, '-').replace(/_/g, '-'),
    cwd.replace(/:/g, '-').replace(/[\\/]/g, '-'),
  ];

  // PROJECTS_DIR에서 case-insensitive 매칭
  try {
    const dirs = fs.readdirSync(PROJECTS_DIR);
    for (const slug of simpleSlugs) {
      const match = dirs.find((d) => d.toLowerCase() === slug.toLowerCase());
      if (match) return match;
    }
  } catch { /* PROJECTS_DIR 없음 — fallback */ }

  return simpleSlugs[0]!;
}

/**
 * §9 v3.89 — 세션 제목 캐시. 제목은 **첫 user 메시지**라 한 번 잡히면 다시 바뀌지 않는다
 * (JSONL 은 append-only). 못 찾은 경우만 파일이 자란 뒤 재시도한다.
 */
const sessionTitleCache = new Map<string, string>();
const sessionTitleMissSize = new Map<string, number>();
/** 제목 탐색 시 우선 읽어보는 파일 앞부분 크기. 첫 user 메시지는 파일 맨 앞에 있다. */
const TITLE_HEAD_BYTES = 256 * 1024;

/** 파일 앞부분만 문자열로 읽는다(마지막 미완결 줄은 잘라낸다). */
function readHead(jsonlPath: string, maxBytes: number): string {
  let fd: number | null = null;
  try {
    fd = fs.openSync(jsonlPath, 'r');
    const buf = Buffer.allocUnsafe(maxBytes);
    const read = fs.readSync(fd, buf, 0, maxBytes, 0);
    if (read <= 0) return '';
    const lastNewline = buf.lastIndexOf(0x0a, read - 1);
    const end = lastNewline >= 0 ? lastNewline : read;
    return buf.subarray(0, end).toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* 무시 */ } }
  }
}

/** JSONL에서 첫 번째 유저 메시지 텍스트 추출 */
function readSessionTitle(cwd: string, sessionId: string): string | null {
  try {
    const jsonlPath = resolveSessionJsonlPath(cwd, sessionId);
    if (!jsonlPath) return null;

    const known = sessionTitleCache.get(jsonlPath);
    if (known !== undefined) return known;

    const size = fs.statSync(jsonlPath).size;
    // 직전에 못 찾았고 파일도 안 자랐으면 결과가 같다 — 다시 읽지 않는다.
    const missedAt = sessionTitleMissSize.get(jsonlPath);
    if (missedAt !== undefined && missedAt >= size) return null;

    // 제목은 파일 맨 앞에 있으므로 앞부분만 읽어보고, 거기 없을 때만 전체를 읽는다.
    const head = readHead(jsonlPath, TITLE_HEAD_BYTES);
    const fromHead = head ? scanTitle(head) : null;
    if (fromHead !== null) {
      sessionTitleCache.set(jsonlPath, fromHead);
      sessionTitleMissSize.delete(jsonlPath);
      return fromHead;
    }
    if (size <= TITLE_HEAD_BYTES) {
      sessionTitleMissSize.set(jsonlPath, size);
      return null;
    }

    const full = scanTitle(fs.readFileSync(jsonlPath, 'utf8'));
    if (full !== null) {
      sessionTitleCache.set(jsonlPath, full);
      sessionTitleMissSize.delete(jsonlPath);
    } else {
      sessionTitleMissSize.set(jsonlPath, size);
    }
    return full;
  } catch {
    return null;
  }
}

/** JSONL 텍스트에서 첫 user 메시지 제목을 뽑는다(없으면 null). */
function scanTitle(content: string): string | null {
  try {
    // 줄 단위 파싱 — 첫 user 메시지만 찾으면 중단
    for (const line of content.split('\n')) {
      if (!line) continue;
      try {
        const entry: unknown = JSON.parse(line);
        if (typeof entry !== 'object' || entry === null) continue;
        const d = entry as Record<string, unknown>;
        if (d['type'] !== 'user') continue;

        const msg = d['message'] as Record<string, unknown> | undefined;
        if (!msg || !Array.isArray(msg['content'])) continue;

        for (const block of msg['content'] as unknown[]) {
          if (typeof block !== 'object' || block === null) continue;
          const b = block as Record<string, unknown>;
          if (b['type'] === 'text' && typeof b['text'] === 'string') {
            let text = b['text']
              .replace(/<[^>]+>/g, '')  // XML 태그 제거
              .trim();
            if (text.length > MAX_TITLE_LENGTH) {
              text = text.slice(0, MAX_TITLE_LENGTH) + '…';
            }
            return text || null;
          }
        }
      } catch {
        // skip parse error
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** 특정 세션의 제목을 다시 조회 (JSONL 생성 대기용) */
export function resolveSessionTitle(cwd: string, sessionId: string): string | null {
  return readSessionTitle(cwd, sessionId);
}

/** cwd에 해당하는 프로젝트 슬러그 하위 JSONL 파일들의 sessionId 목록 */
export function listJsonlSessionIds(cwd: string): { sessionId: string; jsonlPath: string }[] {
  try {
    const slug = cwdToSlug(cwd);
    const dir = path.join(PROJECTS_DIR, slug);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({
        sessionId: f.replace(/\.jsonl$/, ''),
        jsonlPath: path.join(dir, f),
      }));
  } catch {
    return [];
  }
}

/** sessionId → 해석된 JSONL 디렉토리 캐시.
 *  Claude Code `--isolation worktree` 처럼 실제 실행 cwd 가 부모 cwd 와 달라
 *  cwd-slug 직행이 빗나가는 경우의 전역 탐색 결과를 보존(핫패스 재스캔 방지). */
const sessionDirCache = new Map<string, string>();

/**
 * §9 v3.89 — "이 sessionId 는 어디에도 없다" 를 기억하는 부정 캐시(sessionId → 재탐색 가능 시각).
 *
 * 전역 탐색(3)은 `~/.claude/projects` 의 **모든 프로젝트 디렉토리**에 대해 existsSync 를 도는데,
 * JSONL 이 아직 안 만들어진 세션(스폰 직후 sub)·이미 지워진 세션은 **매 호출마다 그 스캔을 통째로
 * 반복**했다. getSnapshot 은 에이전트·서브 수만큼 이 함수를 부르므로(초당 최대 5회 재구축) 없는
 * 세션 하나가 영구적인 디렉토리 스캔 루프가 된다. 짧은 TTL 을 둬 "잠시 후 다시 찾아본다" 는
 * 기존 의미(파일이 나중에 생기면 잡힘)는 유지하면서 스캔 빈도만 낮춘다.
 */
const sessionPathMissCache = new Map<string, number>();
const SESSION_PATH_MISS_TTL_MS = 3000;

/**
 * cwd + sessionId → **실제 존재하는** 세션 JSONL 절대경로 (없으면 null).
 *  1) cwd-slug 직행 — 기존 동작, 핫패스.
 *  2) miss 시 `~/.claude/projects/<*>/<sessionId>.jsonl` 전역 탐색.
 *     sessionId 는 전역 유니크 UUID 라 디렉토리(=cwd-slug)와 무관하게 유일 매칭된다.
 *     서브에이전트가 `--isolation worktree` 로 워크트리 cwd 에서 돌아 부모 cwd-slug 와
 *     어긋나도 컨텍스트/토큰/메시지를 정확히 찾는다(버블 모델·물결 누락 원인 제거).
 */
export function resolveSessionJsonlPath(cwd: string, sessionId: string): string | null {
  const direct = path.join(PROJECTS_DIR, cwdToSlug(cwd), `${sessionId}.jsonl`);
  if (fs.existsSync(direct)) {
    sessionDirCache.set(sessionId, path.dirname(direct));
    sessionPathMissCache.delete(sessionId);
    return direct;
  }
  const cachedDir = sessionDirCache.get(sessionId);
  if (cachedDir) {
    const p = path.join(cachedDir, `${sessionId}.jsonl`);
    if (fs.existsSync(p)) return p;
    sessionDirCache.delete(sessionId);
  }
  // 직전 전역 탐색이 빈손이었고 TTL 이 안 지났으면 스캔 자체를 건너뛴다.
  const retryAt = sessionPathMissCache.get(sessionId);
  if (retryAt !== undefined && Date.now() < retryAt) return null;
  try {
    for (const d of fs.readdirSync(PROJECTS_DIR)) {
      const p = path.join(PROJECTS_DIR, d, `${sessionId}.jsonl`);
      if (fs.existsSync(p)) {
        sessionDirCache.set(sessionId, path.join(PROJECTS_DIR, d));
        sessionPathMissCache.delete(sessionId);
        return p;
      }
    }
  } catch { /* PROJECTS_DIR 없음 */ }
  sessionPathMissCache.set(sessionId, Date.now() + SESSION_PATH_MISS_TTL_MS);
  return null;
}

/** cwd + sessionId → 세션 JSONL 파일 절대 경로 (존재 여부와 무관 — 존재 파일 우선, 없으면 cwd-slug 기본). */
export function getSessionJsonlPath(cwd: string, sessionId: string): string {
  return (
    resolveSessionJsonlPath(cwd, sessionId)
    ?? path.join(PROJECTS_DIR, cwdToSlug(cwd), `${sessionId}.jsonl`)
  );
}

/** 마크다운/코드블록 제거하여 깨끗한 텍스트로 변환 */
function stripMarkdown(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, '')           // 코드블록 제거
    .replace(/`([^`]+)`/g, '$1')              // 인라인 코드 → 텍스트만
    .replace(/<[^>]+>/g, '')                   // XML/HTML 태���
    .replace(/^#{1,6}\s+/gm, '')              // 마크다운 헤더
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1') // bold/italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [링크](url) → 텍스트만
    .replace(/^[\s]*[-*]\s+/gm, '')           // 불릿 마커
    .replace(/^[\s]*\d+\.\s+/gm, '')         // 숫자 리스트 마커
    .replace(/^[\s]*[-]{3,}[\s]*$/gm, '')       // 수평선 (단독 줄만)
    .replace(/^\|[-\s|:]+\|$/gm, '')          // 테이블 구분선 (|---|---|)
    .replace(/\|/g, ' ')                       // 테이블 파이프 → 공백
    .replace(/\n{3,}/g, '\n\n')               // 과도한 줄바꿈 축소
    .trim();
}

/** JSONL 엔트리에서 텍스트 블록 추출 */
function extractText(entry: Record<string, unknown>): string | null {
  const msg = entry['message'] as Record<string, unknown> | undefined;
  if (!msg) return null;

  // §4 v2.68 — CMD(인터랙티브 REPL) 의 user 메시지는 content 가 평문 문자열이다(헤드리스/도구 경로는
  //   블록 배열). 문자열만 처리하던 기존 분기는 이를 건너뛰어 사용자가 친 입력이 Results 에서 누락됐다.
  const content = msg['content'];
  if (typeof content === 'string') {
    const cleaned = stripMarkdown(content);
    return cleaned || null;
  }
  if (!Array.isArray(content)) return null;

  const texts: string[] = [];
  for (const block of content as unknown[]) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as Record<string, unknown>;
    if (b['type'] === 'text' && typeof b['text'] === 'string') {
      const cleaned = stripMarkdown(b['text']);
      if (cleaned) texts.push(cleaned);
    }
  }
  return texts.length > 0 ? texts.join('\n') : null;
}

/** JSONL assistant 엔트리에서 마지막 TodoWrite tool_use의 todos 추출 */
function extractTodos(entry: Record<string, unknown>): TodoItem[] | null {
  const msg = entry['message'] as Record<string, unknown> | undefined;
  if (!msg || !Array.isArray(msg['content'])) return null;

  let lastTodos: TodoItem[] | null = null;
  for (const block of msg['content'] as unknown[]) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as Record<string, unknown>;
    if (b['type'] !== 'tool_use' || b['name'] !== 'TodoWrite') continue;
    const input = b['input'] as Record<string, unknown> | undefined;
    if (!input || !Array.isArray(input['todos'])) continue;

    const items: TodoItem[] = [];
    for (const raw of input['todos'] as unknown[]) {
      if (typeof raw !== 'object' || raw === null) continue;
      const t = raw as Record<string, unknown>;
      const content = typeof t['content'] === 'string' ? t['content'] : '';
      const status = typeof t['status'] === 'string' ? t['status'] : 'pending';
      if (!content) continue;
      items.push({
        content,
        status: status as TodoItem['status'],
      });
    }
    if (items.length > 0) lastTodos = items;
  }
  return lastTodos;
}

/**
 * §9 v3.89 — 대화 이벤트 추출 결과 캐시(파일 크기·mtime 키).
 *
 * `buildAgentEvents()` 는 5초 TTL 이지만, 만료될 때마다 **살아있는 세션 전부**에 대해 수 MB 짜리
 * JSONL 을 통째로 읽고 전 줄을 파싱했다(세션 20개면 5초마다 300ms 급 끊김). 파일이 안 바뀌었으면
 * 결과도 같다.
 *
 * ⚠ 호출부(`buildAgentEvents`)가 돌려받은 이벤트 객체를 **직접 수정**한다(`source`/`queuedAt` 표시,
 * completed 요약을 `response` 에 덧붙임). 캐시 원본을 그대로 주면 그 수정이 누적돼 요약이 호출
 * 횟수만큼 겹쳐 붙는다 — 그래서 **매번 얕은 복사본**을 돌려준다(엔트리 최대 MAX_AGENT_EVENTS 개라
 * 파일 재파싱과 비교할 수 없이 싸다).
 */
const userMessagesCache = new Map<string, { fileSize: number; mtimeMs: number; events: AgentEvent[] }>();

/**
 * 파일별 캐시 상한(세션 수 기준). 넘으면 가장 오래 들어온 것부터 버린다(Map 은 삽입 순서 보존).
 * 대화 본문·요약 원문을 들고 있으므로 무제한이면 오래 켜둔 앱에서 메모리가 계속 는다 —
 * 느려짐을 고치려다 메모리를 새게 두지 않기 위한 상한.
 */
const SESSION_TEXT_CACHE_MAX = 64;

function trimCache(cache: Map<string, unknown>): void {
  while (cache.size > SESSION_TEXT_CACHE_MAX) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** 캐시 원본 보호용 얕은 복사(호출부가 이벤트 필드를 덮어쓰므로 필수). */
function cloneAgentEvents(events: AgentEvent[]): AgentEvent[] {
  return events.map((e) => ({ ...e }));
}

/** JSONL에서 유저 메시지 + 뒤따르는 assistant 응답 읽기 (최신순, MAX_AGENT_EVENTS개) */
export function readUserMessages(cwd: string, sessionId: string): AgentEvent[] {
  try {
    const jsonlPath = resolveSessionJsonlPath(cwd, sessionId);
    if (!jsonlPath) return [];

    const stat = fs.statSync(jsonlPath);
    const cached = userMessagesCache.get(jsonlPath);
    if (cached && cached.fileSize === stat.size && cached.mtimeMs === stat.mtimeMs) {
      return cloneAgentEvents(cached.events);
    }

    const content = fs.readFileSync(jsonlPath, 'utf8');
    const rawLines = content.split('\n');

    // 1차: 모든 엔트리를 파싱하여 type + 텍스트 + todos 배열로 변환
    const parsed: { type: string; text: string; ts: number; todos?: TodoItem[] }[] = [];
    for (const line of rawLines) {
      if (!line) continue;
      try {
        const entry: unknown = JSON.parse(line);
        if (typeof entry !== 'object' || entry === null) continue;
        const d = entry as Record<string, unknown>;
        const type = typeof d['type'] === 'string' ? d['type'] : '';
        if (type !== 'user' && type !== 'assistant') continue;

        const text = extractText(d);
        const todos = type === 'assistant' ? extractTodos(d) : null;

        // 텍스트도 없고 todos도 없으면 skip
        if (!text && !todos) continue;

        const ts = typeof d['timestamp'] === 'string'
          ? new Date(d['timestamp']).getTime()
          : Date.now();
        parsed.push({ type, text: text ?? '', ts, todos: todos ?? undefined });
      } catch {
        // skip
      }
    }

    // 2차: user → 다음 user 전까지 모든 assistant 텍스트 + 마지막 todos 합산
    const events: AgentEvent[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const entry = parsed[i]!;
      if (entry.type !== 'user') continue;

      // i+1부터 다음 user 직전까지 assistant 텍스트 + todos 수집
      const parts: string[] = [];
      let lastTodos: TodoItem[] | undefined;
      for (let j = i + 1; j < parsed.length && parsed[j]!.type !== 'user'; j++) {
        const a = parsed[j]!;
        if (a.type === 'assistant') {
          if (a.text) parts.push(a.text);
          if (a.todos) lastTodos = a.todos;
        }
      }

      const response = parts.length > 0 ? parts.join('\n\n') : undefined;

      events.push({
        id: `msg-${entry.ts}-${events.length}`,
        message: entry.text,
        response,
        timestamp: entry.ts,
        source: 'user',
        todos: lastTodos,
      });
    }

    events.reverse();
    const recent = events.slice(0, MAX_AGENT_EVENTS);
    userMessagesCache.set(jsonlPath, { fileSize: stat.size, mtimeMs: stat.mtimeMs, events: recent });
    trimCache(userMessagesCache);
    return cloneAgentEvents(recent);
  } catch {
    return [];
  }
}

/**
 * JSONL에서 마지막 user 프롬프트 이후 모든 assistant 텍스트를 합산하여 요약 생성.
 * 여러 턴에 걸친 작업 보고를 하나로 합친다.
 */
/**
 * §9 v3.89 — 요약 추출 결과 캐시(파일 크기·mtime 키). **실패(null)도 캐시**한다.
 *
 * `resolveMissingSummaries()` 는 "summary 가 아직 없는 completed 에이전트" 를 매 스냅샷 재구축마다
 * 다시 시도하는데, 그 세션에서 요약을 못 뽑으면(마지막 user 뒤 assistant 텍스트가 없는 경우)
 * **영원히** 매번 수 MB 짜리 JSONL 을 통째로 읽고 전 줄을 파싱했다. 파일이 그대로면 결과도 같으므로
 * 재시도는 파일이 바뀐 뒤에만 의미가 있다 — 재시도 의미는 유지하면서 헛읽기만 없앤다.
 */
const lastAssistantCache = new Map<string, { fileSize: number; mtimeMs: number; value: string | null }>();

export function readLastAssistantMessage(cwd: string, sessionId: string): string | null {
  try {
    const jsonlPath = resolveSessionJsonlPath(cwd, sessionId);
    if (!jsonlPath) return null;

    const stat = fs.statSync(jsonlPath);
    const cached = lastAssistantCache.get(jsonlPath);
    if (cached && cached.fileSize === stat.size && cached.mtimeMs === stat.mtimeMs) {
      return cached.value;
    }
    const remember = (value: string | null): string | null => {
      lastAssistantCache.set(jsonlPath, { fileSize: stat.size, mtimeMs: stat.mtimeMs, value });
      trimCache(lastAssistantCache);
      return value;
    };

    const content = fs.readFileSync(jsonlPath, 'utf8');
    const rawLines = content.split('\n');

    // 전체 파싱 → type + 텍스트 배열
    const entries: { type: string; text: string }[] = [];
    for (const line of rawLines) {
      if (!line) continue;
      try {
        const entry: unknown = JSON.parse(line);
        if (typeof entry !== 'object' || entry === null) continue;
        const d = entry as Record<string, unknown>;
        const type = typeof d['type'] === 'string' ? d['type'] : '';
        if (type !== 'user' && type !== 'assistant') continue;
        const text = extractText(d);
        entries.push({ type, text: text ?? '' });
      } catch {
        // skip
      }
    }

    // 마지막 user 인덱스 찾기
    let lastUserIdx = -1;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i]!.type === 'user') { lastUserIdx = i; break; }
    }

    // 마지막 user 이후 모든 assistant 텍스트 합산
    const parts: string[] = [];
    const start = lastUserIdx >= 0 ? lastUserIdx + 1 : 0;
    for (let i = start; i < entries.length; i++) {
      const e = entries[i]!;
      if (e.type === 'assistant' && e.text) parts.push(e.text);
    }

    if (parts.length === 0) return remember(null);

    const summary = parts.join('\n\n');
    return remember(summary);
  } catch {
    return null;
  }
}

/**
 * 세션 JSONL 의 끝부분(maxBytes)만 읽어 완전한 줄 배열로 반환.
 * 대용량 세션 파일 전체를 매번 readFileSync 하는 부담 없이 "마지막 엔트리"만 확인하는 핫패스용.
 * 파일 앞을 잘랐다면 첫 줄은 불완전할 수 있어 버린다.
 */
function readTailLines(jsonlPath: string, maxBytes = 128 * 1024): string[] {
  let fd: number | null = null;
  try {
    const size = fs.statSync(jsonlPath).size;
    const start = size > maxBytes ? size - maxBytes : 0;
    const length = size - start;
    if (length <= 0) return [];
    const buf = Buffer.alloc(length);
    fd = fs.openSync(jsonlPath, 'r');
    fs.readSync(fd, buf, 0, length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0 && lines.length > 1) lines.shift();
    return lines;
  } catch {
    return [];
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

/**
 * Claude Code 가 사용자 인터럽트(Esc/Ctrl+C)·도구 거부 시 트랜스크립트에 남기는 sentinel.
 * Stop 훅은 사용자 인터럽트에서 발사되지 않으므로(공식 명세), 이 sentinel 이 마지막 대화
 * 엔트리(user)로 남으면 "턴이 인터럽트로 끝났다"로 판정한다.
 */
const INTERRUPT_SENTINELS = [
  "The user doesn't want to proceed with this tool use",
  '[Request interrupted by user',
  'Tool interrupted by user',
];

/**
 * 세션 JSONL 의 마지막 user/assistant 엔트리가 "사용자 인터럽트/도구 거부로 끝난 턴"인지 판정.
 * - 마지막 대화 엔트리가 `user` 타입이고 인터럽트 sentinel 을 포함하면 true.
 * - 사용자가 인터럽트 후 작업을 이어가면 마지막 엔트리가 assistant 가 되어 false(오해소 방지).
 * - 인터럽트로 끝난 게 아닌 정상/진행 중 세션은 false → 실행 중 긴 도구 호출을 조기 종료시키지 않음.
 * Stop 훅이 안 오는 인터럽트 케이스에서 stuck-active 버블을 해소하기 위한 신호.
 */
export function isSessionInterrupted(cwd: string, sessionId: string): boolean {
  try {
    const jsonlPath = resolveSessionJsonlPath(cwd, sessionId);
    if (!jsonlPath) return false;
    const lines = readTailLines(jsonlPath);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line) continue;
      let entry: unknown;
      try { entry = JSON.parse(line); } catch { continue; }
      if (typeof entry !== 'object' || entry === null) continue;
      const d = entry as Record<string, unknown>;
      // 서브에이전트(Task) 의 sidechain 엔트리는 같은 세션 JSONL 에 섞여 쌓인다. 이를
      // 본 에이전트의 "마지막 대화 엔트리"로 오인하면, 조사 서브에이전트가 도는 동안
      // 부모 Hook 버블이 인터럽트로 오판(markStop → completed)돼 "종료된 것처럼" 보인다.
      // 인터럽트 판정은 본 에이전트 자신의 턴에만 적용 — sidechain 은 건너뛴다.
      if (d['isSidechain'] === true) continue;
      const type = d['type'];
      if (type !== 'user' && type !== 'assistant') continue;
      // 마지막 대화 엔트리가 assistant 면 인터럽트로 끝난 턴이 아니다.
      if (type === 'assistant') return false;
      // user 엔트리 — message 직렬화 문자열에서 sentinel 포함 여부로 판정.
      const serialized = JSON.stringify(d['message'] ?? d);
      return INTERRUPT_SENTINELS.some((s) => serialized.includes(s));
    }
    return false;
  } catch {
    return false;
  }
}

/** 에이전트 컨텍스트 정보 (JSONL 마지막 assistant 엔트리에서 추출) */
export interface AgentContextInfo {
  modelName: string;
  contextUsed: number;
  contextMax: number;
  /** 누적 입력 토큰 (input + cacheRead + cacheCreate, 전체 턴 합산) */
  cumulativeInputTokens: number;
  /** 누적 출력 토큰 (전체 턴 합산) */
  cumulativeOutputTokens: number;
}

/**
 * §9 v3.89 — `readContextInfo` 증분 누적 상태(파일별).
 *
 * **왜 필요한가**: 이 함수는 `getSnapshot` 의 에이전트 enrich 루프에서 **에이전트마다 1회 + 마지막
 * sub 1회 + 소유 sub 전원 1회** 호출된다. 종전 구현은 매 호출마다 세션 JSONL **전체**를
 * `readFileSync` + 줄 단위 `JSON.parse` 했다. 실측(이 저장소의 실제 세션 파일 2.6MB) 기준
 * 1회 15ms — 에이전트 5 + sub 15 이면 스냅샷 재구축 1회에 **300ms 이상**이 파일 파싱에 갔고,
 * 스냅샷은 최대 200ms 주기로 재구축되므로 Electron 메인 스레드가 사실상 이 루프에 점유됐다.
 * **세션이 길어질수록 JSONL 이 커져 더 느려진다** — "쓸수록 느려진다" 의 정체.
 *
 * **어떻게 고치나**: JSONL 은 append-only 다. 파일별로 (크기·mtime·마지막 완결 줄 오프셋 +
 * 누적값)을 들고 있다가,
 *   - 크기·mtime 이 그대로면 → 파일을 **열지도 않고** 지난 결과를 돌려준다(stat 1회, ~0.02ms).
 *   - 뒤에 붙기만 했으면 → **붙은 바이트만** 읽어 누적을 이어간다(O(신규 바이트)).
 *   - 줄었거나(rotate/재작성) 이상하면 → 전체 재파싱으로 안전 복귀.
 * 결과값은 전체 재파싱과 **바이트 단위로 동일**하다(같은 줄을 같은 순서로 딱 한 번씩 먹인다).
 */
interface ContextScanState {
  /** 마지막으로 본 파일 크기(바이트). */
  fileSize: number;
  /** 마지막으로 본 mtime(ms). */
  mtimeMs: number;
  /** 완결된 줄까지 파싱을 마친 오프셋(다음 읽기 시작점). 잘린 마지막 줄은 포함하지 않는다. */
  parsedBytes: number;
  cumIn: number;
  cumOut: number;
  lastModel: string | null;
  lastContextUsed: number;
  /**
   * 마지막 개행 뒤에 남은 미완결 꼬리. 보통 빈 문자열(세션 JSONL 은 개행으로 끝난다)이지만,
   * 프로세스가 개행 없이 끝난 파일에서도 **전체 재파싱과 같은 값**이 나오도록 결과 계산에만 반영한다
   * (누적 상태에는 커밋하지 않는다 — 다음에 뒷부분이 더 붙으면 그때 온전한 줄로 한 번만 먹는다).
   */
  pendingTail: string;
}

const contextScanCache = new Map<string, ContextScanState>();

/** 한 줄(assistant 엔트리)을 누적 상태에 반영. 전체/증분 경로가 공유하는 유일한 파싱 지점. */
function feedContextLine(state: ContextScanState, line: string): void {
  if (!line) return;
  try {
    const entry: unknown = JSON.parse(line);
    if (typeof entry !== 'object' || entry === null) return;
    const d = entry as Record<string, unknown>;
    if (d['type'] !== 'assistant') return;

    const msg = d['message'] as Record<string, unknown> | undefined;
    if (!msg) return;

    const usage = msg['usage'] as Record<string, unknown> | undefined;
    if (!usage) return;

    const inputTokens = typeof usage['input_tokens'] === 'number' ? usage['input_tokens'] : 0;
    const outputTokens = typeof usage['output_tokens'] === 'number' ? usage['output_tokens'] : 0;
    const cacheRead = typeof usage['cache_read_input_tokens'] === 'number' ? usage['cache_read_input_tokens'] : 0;
    const cacheCreation = typeof usage['cache_creation_input_tokens'] === 'number' ? usage['cache_creation_input_tokens'] : 0;

    // 누적 합산
    state.cumIn += inputTokens + cacheRead + cacheCreation;
    state.cumOut += outputTokens;

    // 마지막 컨텍스트 (덮어쓰기 — 마지막 턴이 최종값)
    const model = typeof msg['model'] === 'string' ? msg['model'] : null;
    if (model) {
      state.lastModel = model;
      state.lastContextUsed = inputTokens + cacheRead + cacheCreation;
    }
  } catch {
    // skip parse error
  }
}

/**
 * 파일의 [start, end) 구간을 읽어 **완결된 줄만** 누적에 먹이고, 다음 시작 오프셋을 돌려준다.
 * 잘린 꼬리(마지막 개행 뒤)는 다음 호출에서 온전해진 뒤 처리한다 —
 * 스트리밍 중 반쯤 쓰인 줄을 두 번 세거나 놓치지 않기 위함.
 */
function feedRange(state: ContextScanState, jsonlPath: string, start: number, end: number): number {
  const length = end - start;
  if (length <= 0) { state.pendingTail = ''; return start; }
  let fd: number | null = null;
  try {
    fd = fs.openSync(jsonlPath, 'r');
    const buf = Buffer.allocUnsafe(length);
    const read = fs.readSync(fd, buf, 0, length, start);
    if (read <= 0) { state.pendingTail = ''; return start; }
    const lastNewline = buf.lastIndexOf(0x0a, read - 1); // '\n'
    // 개행이 하나도 없으면 아직 줄이 완결되지 않은 것 — 커밋하지 않고 꼬리로만 들고 간다.
    if (lastNewline < 0) {
      state.pendingTail = buf.subarray(0, read).toString('utf8');
      return start;
    }
    const complete = buf.subarray(0, lastNewline).toString('utf8');
    for (const line of complete.split('\n')) feedContextLine(state, line);
    state.pendingTail = lastNewline + 1 < read
      ? buf.subarray(lastNewline + 1, read).toString('utf8')
      : '';
    return start + lastNewline + 1;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* 무시 */ } }
  }
}

/**
 * JSONL에서 마지막 assistant 엔트리의 model + usage + 전체 누적 토큰을 반환.
 * 순방향 1회 파싱으로 누적 합산 + 마지막 컨텍스트를 동시에 수집한다.
 * 같은 파일을 다시 물으면 **붙은 부분만** 읽어 이어간다(위 `ContextScanState` 주석 참조).
 */
export function readContextInfo(cwd: string, sessionId: string): AgentContextInfo | null {
  try {
    const jsonlPath = resolveSessionJsonlPath(cwd, sessionId);
    if (!jsonlPath) return null;

    const stat = fs.statSync(jsonlPath);
    const cached = contextScanCache.get(jsonlPath);

    let state: ContextScanState;
    if (
      cached !== undefined &&
      cached.fileSize === stat.size &&
      cached.mtimeMs === stat.mtimeMs
    ) {
      // 변경 없음 — 파일을 열지 않는다.
      state = cached;
    } else if (cached !== undefined && stat.size >= cached.parsedBytes) {
      // append 만 일어난 경우 — 붙은 부분만 이어 읽는다.
      state = cached;
      state.parsedBytes = feedRange(state, jsonlPath, state.parsedBytes, stat.size);
      state.fileSize = stat.size;
      state.mtimeMs = stat.mtimeMs;
    } else {
      // 첫 조회 또는 파일이 줄어듦(재작성/rotate) — 전체 재파싱.
      state = {
        fileSize: stat.size,
        mtimeMs: stat.mtimeMs,
        parsedBytes: 0,
        cumIn: 0,
        cumOut: 0,
        lastModel: null,
        lastContextUsed: 0,
        pendingTail: '',
      };
      state.parsedBytes = feedRange(state, jsonlPath, 0, stat.size);
      contextScanCache.set(jsonlPath, state);
    }

    // 미완결 꼬리(개행 없이 끝난 마지막 줄)는 결과에만 반영 — 누적 상태는 건드리지 않는다.
    let view = state;
    if (state.pendingTail) {
      view = { ...state };
      feedContextLine(view, state.pendingTail);
    }

    if (!view.lastModel) return null;
    // contextMax 는 모델 레지스트리(런타임 갱신)에 의존하므로 캐시하지 않고 매번 계산한다.
    const contextMax = getModelContextLimit(view.lastModel, modelRegistryService.getRegistry());

    return {
      modelName: view.lastModel,
      contextUsed: view.lastContextUsed,
      contextMax,
      cumulativeInputTokens: view.cumIn,
      cumulativeOutputTokens: view.cumOut,
    };
  } catch {
    return null;
  }
}

/** 바이트 수 → 토큰 추정 */
function estimateTokens(bytes: number): number {
  return Math.round(bytes * TOKEN_BYTES_RATIO);
}

/** §9 — 토큰 소스 감지 결과 캐시. 루트 탐색(existsSync 상향 순회) + `cwdToSlug`(PROJECTS_DIR readdir)
 *  + memory 디렉토리 stat 이 매 호출마다 도는데, CLAUDE.md·메모리 크기는 초 단위로 변하지 않는다. */
const TOKEN_SOURCES_TTL_MS = 30_000;
const tokenSourcesCache = new Map<string, { at: number; sources: { key: string; label: string; estimatedTokens: number }[] }>();

/** 프로젝트 cwd 기준으로 동적 토큰 소스 감지 (CLAUDE.md, 메모리 등) */
function detectTokenSources(cwd: string): { key: string; label: string; estimatedTokens: number }[] {
  const cached = tokenSourcesCache.get(cwd);
  if (cached && Date.now() - cached.at < TOKEN_SOURCES_TTL_MS) return cached.sources;
  const sources = detectTokenSourcesUncached(cwd);
  tokenSourcesCache.set(cwd, { at: Date.now(), sources });
  return sources;
}

function detectTokenSourcesUncached(cwd: string): { key: string; label: string; estimatedTokens: number }[] {
  const sources: { key: string; label: string; estimatedTokens: number }[] = [];

  // cwd에서 위로 올라가며 프로젝트 루트 찾기
  let projectRoot = cwd;
  let dir = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml')) ||
        fs.existsSync(path.join(dir, 'package.json'))) {
      projectRoot = dir;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // CLAUDE.md 검색 (프로젝트 루트 + cwd)
  for (const candidate of [projectRoot, cwd]) {
    const claudeMdPath = path.join(candidate, 'CLAUDE.md');
    try {
      if (fs.existsSync(claudeMdPath)) {
        const size = fs.statSync(claudeMdPath).size;
        sources.push({ key: 'claude_md', label: 'CLAUDE.md', estimatedTokens: estimateTokens(size) });
        break;
      }
    } catch { /* skip */ }
  }

  // 메모리 파일 (~/.claude/projects/SLUG/memory/)
  try {
    const slug = cwdToSlug(cwd);
    const memoryDir = path.join(PROJECTS_DIR, slug, 'memory');
    if (fs.existsSync(memoryDir)) {
      let totalBytes = 0;
      const files = fs.readdirSync(memoryDir);
      for (const f of files) {
        try {
          totalBytes += fs.statSync(path.join(memoryDir, f)).size;
        } catch { /* skip */ }
      }
      if (totalBytes > 0) {
        sources.push({ key: 'memory', label: 'Memory', estimatedTokens: estimateTokens(totalBytes) });
      }
    }
  } catch { /* skip */ }

  return sources;
}

/** JSONL 엔트리에서 상세 메타 수집 (도구 호출 수, 시스템 이벤트 등) */
interface SessionMeta {
  toolCalls: Record<string, number>;
  hookCount: number;
  attachmentCount: number;
  systemEventCount: number;
  userMessageCount: number;
  thinkingTurnCount: number;
}

function createSessionMeta(): SessionMeta {
  return {
    toolCalls: {},
    hookCount: 0,
    attachmentCount: 0,
    systemEventCount: 0,
    userMessageCount: 0,
    thinkingTurnCount: 0,
  };
}

/** 파싱된 엔트리 1건을 메타 누산기에 반영. 전 필드가 단조 누적이라 증분 스캔에 그대로 쓸 수 있다. */
function feedSessionMeta(meta: SessionMeta, d: Record<string, unknown>): void {
  const type = d['type'];

  if (type === 'user') {
    meta.userMessageCount++;
  } else if (type === 'system') {
    meta.systemEventCount++;
    const hc = d['hookCount'];
    if (typeof hc === 'number') meta.hookCount += hc;
  } else if (type === 'attachment') {
    meta.attachmentCount++;
  } else if (type === 'assistant') {
    const msg = d['message'] as Record<string, unknown> | undefined;
    if (!msg) return;
    const content = msg['content'];
    if (!Array.isArray(content)) return;
    for (const block of content as unknown[]) {
      if (typeof block !== 'object' || block === null) continue;
      const b = block as Record<string, unknown>;
      if (b['type'] === 'tool_use' && typeof b['name'] === 'string') {
        meta.toolCalls[b['name']] = (meta.toolCalls[b['name']] ?? 0) + 1;
      }
      if (b['type'] === 'thinking') {
        meta.thinkingTurnCount++;
      }
    }
  }
}

/** 메타 정보를 카테고리 detail 문자열로 변환 */
function buildDetailString(meta: SessionMeta): Record<string, string> {
  const details: Record<string, string> = {};

  // System Prompt details
  const sysItems: string[] = [];
  if (meta.hookCount > 0) sysItems.push(`${meta.hookCount} hooks`);
  if (meta.systemEventCount > 0) sysItems.push(`${meta.systemEventCount} system events`);
  if (sysItems.length > 0) details['system_prompt'] = sysItems.join(', ');

  // Tool Schemas details
  const toolNames = Object.keys(meta.toolCalls);
  if (toolNames.length > 0) {
    const sorted = toolNames.sort((a, b) => (meta.toolCalls[b] ?? 0) - (meta.toolCalls[a] ?? 0));
    const top5 = sorted.slice(0, 5).map((t) => `${t}: ${meta.toolCalls[t]}`);
    const detail = top5.join(', ');
    details['tool_schemas'] = sorted.length > 5 ? `${detail}, +${sorted.length - 5} more` : detail;
  }

  // Conversation details
  const convItems: string[] = [];
  if (meta.userMessageCount > 0) convItems.push(`${meta.userMessageCount} messages`);
  if (meta.thinkingTurnCount > 0) convItems.push(`${meta.thinkingTurnCount} thinking`);
  if (meta.attachmentCount > 0) convItems.push(`${meta.attachmentCount} attachments`);
  if (convItems.length > 0) details['conversation'] = convItems.join(', ');

  return details;
}

/**
 * §9 — 토큰 스캔 증분 상태. `ContextScanState`(readContextInfo) 와 같은 원리다:
 * JSONL 은 append-only 이므로 **붙은 바이트만** 파싱해 turns·meta 를 누적하고,
 * 파일이 안 변했으면 파일을 아예 열지 않는다.
 *
 * 이 캐시가 없던 시절이 `/api/tokens/:sessionId` 요청마다 **세션 JSONL 전체를
 * readFileSync + 전 줄 JSON.parse ×2벌**(turns 루프 + collectSessionMeta) 하던
 * 경로였다. DetailPanel 이 에이전트 activity 가 오를 때마다(=도구 이벤트마다)
 * 이 엔드포인트를 때렸고, 자체 턴이 비면 서브에이전트 세션까지 연쇄 호출해
 * 수 MB 짜리 파일 수십 개를 한 번에 읽어 Electron 메인 스레드를 수백 ms 씩 잡았다.
 */
interface TokenScanState {
  fileSize: number;
  mtimeMs: number;
  /** 완결된 줄까지 파싱한 바이트 오프셋 */
  parsedBytes: number;
  turns: TurnTokenUsage[];
  meta: SessionMeta;
  /** 개행 없이 끝난 마지막 줄 — 결과에만 반영하고 누적 상태엔 커밋하지 않는다(ContextScanState 와 동일). */
  pendingTail: string;
}

const tokenScanCache = new Map<string, TokenScanState>();
/** 캐시 파일 수 상한 — 넘으면 가장 먼저 들어온 항목부터 버린다(무한 증가 방지). */
const TOKEN_SCAN_CACHE_MAX = 64;

/** 한 줄(JSONL 엔트리)을 turns + meta 양쪽에 반영. 라인당 JSON.parse 1회. */
function feedTokenLine(state: TokenScanState, line: string): void {
  if (!line) return;
  let d: Record<string, unknown>;
  try {
    const entry: unknown = JSON.parse(line);
    if (typeof entry !== 'object' || entry === null) return;
    d = entry as Record<string, unknown>;
  } catch {
    return; // 손상 라인 skip
  }

  feedSessionMeta(state.meta, d);

  if (d['type'] !== 'assistant') return;
  const msg = d['message'] as Record<string, unknown> | undefined;
  if (!msg) return;
  const usage = msg['usage'] as Record<string, unknown> | undefined;
  if (!usage) return;

  const inputTokens = typeof usage['input_tokens'] === 'number' ? usage['input_tokens'] : 0;
  const outputTokens = typeof usage['output_tokens'] === 'number' ? usage['output_tokens'] : 0;
  const cacheReadTokens = typeof usage['cache_read_input_tokens'] === 'number' ? usage['cache_read_input_tokens'] : 0;
  const cacheCreateTokens = typeof usage['cache_creation_input_tokens'] === 'number' ? usage['cache_creation_input_tokens'] : 0;

  const ts = typeof d['timestamp'] === 'string'
    ? new Date(d['timestamp']).getTime()
    : Date.now();

  const tools: string[] = [];
  const msgContent = msg['content'];
  if (Array.isArray(msgContent)) {
    for (const block of msgContent as unknown[]) {
      if (typeof block !== 'object' || block === null) continue;
      const b = block as Record<string, unknown>;
      if (b['type'] === 'tool_use' && typeof b['name'] === 'string') {
        if (!tools.includes(b['name'])) tools.push(b['name']);
      }
    }
  }

  state.turns.push({
    turnIndex: state.turns.length,
    timestamp: ts,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreateTokens,
    totalContext: inputTokens + cacheReadTokens + cacheCreateTokens,
    model: typeof msg['model'] === 'string' ? msg['model'] : undefined,
    tools,
  });
}

/**
 * [start, end) 를 읽어 **완결된 줄만** 누적에 먹이고 다음 시작 오프셋을 반환.
 * 잘린 꼬리는 다음 호출에서 온전해진 뒤 처리한다(feedRange 와 동일 규약).
 */
function feedTokenRange(state: TokenScanState, jsonlPath: string, start: number, end: number): number {
  const length = end - start;
  if (length <= 0) { state.pendingTail = ''; return start; }
  let fd: number | null = null;
  try {
    fd = fs.openSync(jsonlPath, 'r');
    const buf = Buffer.allocUnsafe(length);
    const read = fs.readSync(fd, buf, 0, length, start);
    if (read <= 0) { state.pendingTail = ''; return start; }
    const lastNewline = buf.lastIndexOf(0x0a, read - 1); // '\n'
    // 개행이 하나도 없으면 아직 줄이 완결되지 않은 것 — 커밋하지 않고 꼬리로만 들고 간다.
    if (lastNewline < 0) {
      state.pendingTail = buf.subarray(0, read).toString('utf8');
      return start;
    }
    const complete = buf.subarray(0, lastNewline).toString('utf8');
    for (const line of complete.split('\n')) feedTokenLine(state, line);
    state.pendingTail = lastNewline + 1 < read
      ? buf.subarray(lastNewline + 1, read).toString('utf8')
      : '';
    return start + lastNewline + 1;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* 무시 */ } }
  }
}

/** 파일 상태를 최신으로 맞춘 스캔 상태 반환(변경 없으면 파일 미개봉). */
function scanTokenState(jsonlPath: string): TokenScanState | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(jsonlPath);
  } catch {
    return null;
  }

  const cached = tokenScanCache.get(jsonlPath);

  if (cached && cached.fileSize === stat.size && cached.mtimeMs === stat.mtimeMs) {
    return cached; // 변경 없음 — 열지 않는다
  }

  if (cached && stat.size >= cached.parsedBytes) {
    // append 만 일어남 — 붙은 부분만 이어 읽는다
    cached.parsedBytes = feedTokenRange(cached, jsonlPath, cached.parsedBytes, stat.size);
    cached.fileSize = stat.size;
    cached.mtimeMs = stat.mtimeMs;
    return cached;
  }

  // 첫 조회 또는 파일이 줄어듦(재작성/rotate) — 전체 재파싱
  const state: TokenScanState = {
    fileSize: stat.size,
    mtimeMs: stat.mtimeMs,
    parsedBytes: 0,
    turns: [],
    meta: createSessionMeta(),
    pendingTail: '',
  };
  state.parsedBytes = feedTokenRange(state, jsonlPath, 0, stat.size);
  if (tokenScanCache.size >= TOKEN_SCAN_CACHE_MAX) {
    const oldest = tokenScanCache.keys().next().value;
    if (oldest !== undefined) tokenScanCache.delete(oldest);
  }
  tokenScanCache.set(jsonlPath, state);
  return state;
}

/**
 * JSONL 세션 파일에서 전체 턴별 토큰 사용량 + 누적 카테고리 추정을 반환.
 * 동적으로 프로젝트 파일을 감지하고 JSONL 메타를 수집하여 카테고리를 구성.
 */
export function readSessionTokenData(cwd: string, sessionId: string): SessionTokenData | null {
  try {
    const jsonlPath = resolveSessionJsonlPath(cwd, sessionId);
    if (!jsonlPath) return null;

    const state = scanTokenState(jsonlPath);
    if (!state) return null;

    // 미완결 꼬리(개행 없이 끝난 마지막 줄)는 결과에만 반영 — 누적 상태는 건드리지 않는다.
    // turns/meta 를 복사해 먹여야 캐시가 오염되지 않는다(feedTokenLine 이 둘 다 변형).
    let view = state;
    if (state.pendingTail) {
      view = {
        ...state,
        turns: [...state.turns],
        meta: { ...state.meta, toolCalls: { ...state.meta.toolCalls } },
      };
      feedTokenLine(view, state.pendingTail);
    }
    const turns = view.turns;

    if (turns.length === 0) return null;

    // 상세 메타 — 증분 스캔이 누적해 둔 값을 그대로 쓴다(라인 재파싱 ❌).
    const detailStrings = buildDetailString(view.meta);

    // 누적 카테고리 추정 (전체 세션 기준)
    // 고정 오버헤드는 매 턴 반복 → 턴 수 × 1턴 오버헤드
    const turnCount = turns.length;
    const dynamicSources = detectTokenSources(cwd);
    const fixedPerTurn = TOKEN_FIXED_CATEGORIES.map((c) => ({ ...c, estimatedTokens: c.estimate }));
    const perTurnSources = [...dynamicSources, ...fixedPerTurn];

    const allCategories: { key: string; label: string; estimatedTokens: number; detail?: string }[] =
      perTurnSources.map((c) => ({
        key: c.key,
        label: c.label,
        estimatedTokens: c.estimatedTokens * turnCount,
        detail: detailStrings[c.key],
      }));

    // 누적 합산
    let cumulativeContext = 0;
    for (const t of turns) cumulativeContext += t.totalContext;

    const fixedTotal = allCategories.reduce((sum, c) => sum + c.estimatedTokens, 0);
    const conversationTokens = Math.max(0, cumulativeContext - fixedTotal);
    allCategories.push({
      key: 'conversation',
      label: 'Conversation History',
      estimatedTokens: conversationTokens,
      detail: detailStrings['conversation'],
    });

    // 퍼센트 + 내림차순
    const categories: TokenCategoryEstimate[] = allCategories
      .map((c) => ({
        key: c.key,
        label: c.label,
        estimatedTokens: c.estimatedTokens,
        percentage: cumulativeContext > 0 ? Math.round((c.estimatedTokens / cumulativeContext) * 100) : 0,
        detail: c.detail,
      }))
      .sort((a, b) => b.estimatedTokens - a.estimatedTokens);

    // turns 배열은 캐시가 계속 append 하는 실물이므로 복사본을 넘긴다
    // (호출부가 정렬·turnIndex 재부여 등으로 건드려도 캐시가 오염되지 않게).
    return { sessionId, turns: [...turns], categories };
  } catch (err) {
    logger.error(`readSessionTokenData failed: ${sessionId}`, err);
    return null;
  }
}

/** cwd 정규화 (비교용) */
function normalizeCwd(cwd: string): string {
  return cwd.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

/** projectCwd → 직전 스캔 시그니처. 같은 결과면 로그를 재출력하지 않는다(ServerLogPopup 도배 방지). */
const lastDiscoverySignature = new Map<string, string>();

/**
 * ~/.claude/sessions/ 에서 같은 프로젝트의 살아있는 세션만 반환.
 * @param projectCwd 현재 프로젝트 cwd — 이 경로의 세션만 포함
 * startedAt 기준 최신순 정렬, INITIAL_AGENT_COUNT개까지.
 *
 * §5.7 #24: 생존 판정((a) PID alive + (c) entrypoint=vscode)은 `scanSessionLiveness`
 * 단일 함수에 위임 — pollOnce/readAliveSessionIds(제거 경로)와 완전히 같은 기준을
 * 쓴다. 여기서는 그 위에 (b) cwd-프로젝트 일치만 추가로 적용한다.
 */
export function discoverSessions(projectCwd: string): LocalSession[] {
  try {
    const normalizedProject = normalizeCwd(projectCwd);
    const sessions: LocalSession[] = [];

    for (const s of scanSessionLiveness()) {
      // §5.7 #24 (a) PID alive + (c) entrypoint=vscode — 추가/제거 공유 단일 판정.
      // 죽은 PID 의 stale 세션 JSON(완료된 스킬/서브에이전트 서브프로세스 등)을
      // 여기서 걸러내야 seedAgents 가 다시 띄우지 않는다(깜빡임 차단).
      if (!s.live || !s.cwd) continue;

      // §5.7 #24 (b) cwd-프로젝트 일치 — 같은 프로젝트 OR 프로젝트 루트의 서브폴더.
      const nCwd = normalizeCwd(s.cwd);
      if (nCwd !== normalizedProject && !nCwd.startsWith(normalizedProject + '/')) continue;

      const projectName = path.basename(s.cwd) || `PID ${s.pid}`;
      const resolved = readSessionTitle(s.cwd, s.sessionId);
      const hasTitle = resolved !== null;
      const title = resolved ?? `${projectName} (new)`;

      sessions.push({
        pid: s.pid,
        sessionId: s.sessionId,
        cwd: s.cwd,
        title,
        projectName,
        hasTitle,
        startedAt: s.startedAt,
        entrypoint: s.entrypoint,
      });
    }

    sessions.sort((a, b) => b.startedAt - a.startedAt);
    const result = sessions.slice(0, INITIAL_AGENT_COUNT);

    // SESSION_SCAN_INTERVAL 마다 프로젝트별로 호출된다 — 결과가 직전과 같으면 로그를 찍지
    // 않는다. (안 그러면 변화 없는 주기 스캔이 ServerLogPopup 을 INFO 로 도배한다.)
    const signature = `${sessions.length}:${result.map((s) => s.sessionId).join(',')}`;
    if (lastDiscoverySignature.get(normalizedProject) !== signature) {
      lastDiscoverySignature.set(normalizedProject, signature);
      logger.info(`Discovered ${sessions.length} sessions for project, using ${result.length}`);
    }
    return result;
  } catch (err) {
    logger.error('Session discovery failed', err);
    return [];
  }
}
