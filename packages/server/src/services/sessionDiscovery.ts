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

/** JSONL에서 첫 번째 유저 메시지 텍스트 추출 */
function readSessionTitle(cwd: string, sessionId: string): string | null {
  try {
    const jsonlPath = resolveSessionJsonlPath(cwd, sessionId);
    if (!jsonlPath) return null;

    const content = fs.readFileSync(jsonlPath, 'utf8');
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
    return direct;
  }
  const cachedDir = sessionDirCache.get(sessionId);
  if (cachedDir) {
    const p = path.join(cachedDir, `${sessionId}.jsonl`);
    if (fs.existsSync(p)) return p;
    sessionDirCache.delete(sessionId);
  }
  try {
    for (const d of fs.readdirSync(PROJECTS_DIR)) {
      const p = path.join(PROJECTS_DIR, d, `${sessionId}.jsonl`);
      if (fs.existsSync(p)) {
        sessionDirCache.set(sessionId, path.join(PROJECTS_DIR, d));
        return p;
      }
    }
  } catch { /* PROJECTS_DIR 없음 */ }
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

/** JSONL에서 유저 메시지 + 뒤따르는 assistant 응답 읽기 (최신순, MAX_AGENT_EVENTS개) */
export function readUserMessages(cwd: string, sessionId: string): AgentEvent[] {
  try {
    const jsonlPath = resolveSessionJsonlPath(cwd, sessionId);
    if (!jsonlPath) return [];

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
    return events.slice(0, MAX_AGENT_EVENTS);
  } catch {
    return [];
  }
}

/**
 * JSONL에서 마지막 user 프롬프트 이후 모든 assistant 텍스트를 합산하여 요약 생성.
 * 여러 턴에 걸친 작업 보고를 하나로 합친다.
 */
export function readLastAssistantMessage(cwd: string, sessionId: string): string | null {
  try {
    const jsonlPath = resolveSessionJsonlPath(cwd, sessionId);
    if (!jsonlPath) return null;

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

    if (parts.length === 0) return null;

    const summary = parts.join('\n\n');
    return summary;
  } catch {
    return null;
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
 * JSONL에서 마지막 assistant 엔트리의 model + usage + 전체 누적 토큰을 반환.
 * 순방향 1회 파싱으로 누적 합산 + 마지막 컨텍스트를 동시에 수집.
 */
export function readContextInfo(cwd: string, sessionId: string): AgentContextInfo | null {
  try {
    const jsonlPath = resolveSessionJsonlPath(cwd, sessionId);
    if (!jsonlPath) return null;

    const content = fs.readFileSync(jsonlPath, 'utf8');
    const lines = content.split('\n');

    let lastModel: string | null = null;
    let lastContextUsed = 0;
    let cumIn = 0;
    let cumOut = 0;

    for (const line of lines) {
      if (!line) continue;
      try {
        const entry: unknown = JSON.parse(line);
        if (typeof entry !== 'object' || entry === null) continue;
        const d = entry as Record<string, unknown>;
        if (d['type'] !== 'assistant') continue;

        const msg = d['message'] as Record<string, unknown> | undefined;
        if (!msg) continue;

        const usage = msg['usage'] as Record<string, unknown> | undefined;
        if (!usage) continue;

        const inputTokens = typeof usage['input_tokens'] === 'number' ? usage['input_tokens'] : 0;
        const outputTokens = typeof usage['output_tokens'] === 'number' ? usage['output_tokens'] : 0;
        const cacheRead = typeof usage['cache_read_input_tokens'] === 'number' ? usage['cache_read_input_tokens'] : 0;
        const cacheCreation = typeof usage['cache_creation_input_tokens'] === 'number' ? usage['cache_creation_input_tokens'] : 0;

        // 누적 합산
        cumIn += inputTokens + cacheRead + cacheCreation;
        cumOut += outputTokens;

        // 마지막 컨텍스트 (덮어쓰기 — 마지막 턴이 최종값)
        const model = typeof msg['model'] === 'string' ? msg['model'] : null;
        if (model) {
          lastModel = model;
          lastContextUsed = inputTokens + cacheRead + cacheCreation;
        }
      } catch {
        // skip parse error
      }
    }

    if (!lastModel) return null;
    const contextMax = getModelContextLimit(lastModel, modelRegistryService.getRegistry());

    return {
      modelName: lastModel,
      contextUsed: lastContextUsed,
      contextMax,
      cumulativeInputTokens: cumIn,
      cumulativeOutputTokens: cumOut,
    };
  } catch {
    return null;
  }
}

/** 바이트 수 → 토큰 추정 */
function estimateTokens(bytes: number): number {
  return Math.round(bytes * TOKEN_BYTES_RATIO);
}

/** 프로젝트 cwd 기준으로 동적 토큰 소스 감지 (CLAUDE.md, 메모리 등) */
function detectTokenSources(cwd: string): { key: string; label: string; estimatedTokens: number }[] {
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

function collectSessionMeta(lines: string[]): SessionMeta {
  const meta: SessionMeta = {
    toolCalls: {},
    hookCount: 0,
    attachmentCount: 0,
    systemEventCount: 0,
    userMessageCount: 0,
    thinkingTurnCount: 0,
  };

  for (const line of lines) {
    if (!line) continue;
    try {
      const entry: unknown = JSON.parse(line);
      if (typeof entry !== 'object' || entry === null) continue;
      const d = entry as Record<string, unknown>;
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
        if (!msg) continue;
        const content = msg['content'];
        if (!Array.isArray(content)) continue;
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
    } catch { /* skip */ }
  }
  return meta;
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
 * JSONL 세션 파일에서 전체 턴별 토큰 사용량 + 누적 카테고리 추정을 반환.
 * 동적으로 프로젝트 파일을 감지하고 JSONL 메타를 수집하여 카테고리를 구성.
 */
export function readSessionTokenData(cwd: string, sessionId: string): SessionTokenData | null {
  try {
    const jsonlPath = resolveSessionJsonlPath(cwd, sessionId);
    if (!jsonlPath) return null;

    const content = fs.readFileSync(jsonlPath, 'utf8');
    const lines = content.split('\n');

    // 턴별 토큰 추출
    const turns: TurnTokenUsage[] = [];
    let turnIndex = 0;

    for (const line of lines) {
      if (!line) continue;
      try {
        const entry: unknown = JSON.parse(line);
        if (typeof entry !== 'object' || entry === null) continue;
        const d = entry as Record<string, unknown>;
        if (d['type'] !== 'assistant') continue;

        const msg = d['message'] as Record<string, unknown> | undefined;
        if (!msg) continue;

        const usage = msg['usage'] as Record<string, unknown> | undefined;
        if (!usage) continue;

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

        turns.push({
          turnIndex,
          timestamp: ts,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheCreateTokens,
          totalContext: inputTokens + cacheReadTokens + cacheCreateTokens,
          model: typeof msg['model'] === 'string' ? msg['model'] : undefined,
          tools,
        });
        turnIndex++;
      } catch { /* skip */ }
    }

    if (turns.length === 0) return null;

    // 상세 메타 수집
    const meta = collectSessionMeta(lines);
    const detailStrings = buildDetailString(meta);

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

    return { sessionId, turns, categories };
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
