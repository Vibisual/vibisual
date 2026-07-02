import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { validatePathWithinRoot } from './pathValidator.js';
import type {
  BubbleData,
  BubbleType,
  BashEntry,
  ServerEntry,
  AgentEvent,
  ActivityEdge,
  EdgeSnapshot,
  FileEdit,
  HookEventPayload,
  GraphSnapshot,
  AgentPhase,
  ProjectInfo,
  ProjectCheckpoint,
  QueuedCommand,
  FolderFileEntry,
  GhostChangeType,
  GhostInfo,
  PipelineType,
  AgentConfig,
  TaskEdge,
  TaskEdgeStatus,
  TaskEdgeForwardMode,
  TaskEdgeKind,
  TaskEdgeMessageFormat,
  TaskEdgeReturnFormat,
  TaskEdgePriority,
  TaskEdgeCritiqueTiming,
  TaskEdgeCritiqueAuthority,
  TaskEdgeCommandMode,
  SubAgent,
  CommentBox,
  Conti,
  ContiFrame,
  ContiElement,
  ActiveContiWork,
  ContiWorkSource,
  ToolDurationEntry,
  CompactCount,
  AutoAgentSummary,
  AgentReport,
  AgentQuestions,
  AgentReview,
  AgentList,
} from '@vibisual/shared';
import { MAX_BASH_HISTORY, MAX_FILE_EDITS, MAX_WRITE_DIFF_BYTES, DEFAULT_MAX_SATELLITES, SATELLITE_MAX_BOUNDS, MAX_AGENTS, SATELLITE_TYPES, AGENT_FADE_DURATION, BUBBLE_TTL, GHOST_FADE_DURATION, FILE_EXISTENCE_MISS_THRESHOLD, FRONTEND_SERVER_PATTERNS, IFRAME_DEAD_GRACE_MS, parseModelFamily, DEFAULT_AGENT_CONFIG, AVAILABLE_AGENT_TOOLS, DEFAULT_UI_LOCALE, COMMENT_BOX_DEFAULTS, READ_TOOLS, TASK_EDGE_AUTO_REWORK_COMMAND_LABEL, AGENT_REPORT_MAX_PER_AGENT, AGENT_QUESTIONS_MAX_PER_AGENT, AGENT_REVIEWS_MAX_PER_AGENT, AGENT_LISTS_MAX_PER_AGENT, DELETED_AGENT_TOMBSTONE_MAX, CMD_AGENT_COLOR, MAX_AGENT_EVENTS } from '@vibisual/shared';
import type { ServerKind, UiLocale, ExecutionMode } from '@vibisual/shared';
import { EdgeManager } from './edgeManager.js';
import { extractPort, extractPortFromInlineEval, extractPortFromScriptFile, isPortAlive, isProbeCommand, isVibisualLauncherCommand } from './processChecker.js';
import { BackgroundShellWatcher, parseBackgroundShellResponse, scanActiveBackgroundShells } from './backgroundShellWatcher.js';
import { subAgentManager, getCmdSessionIds } from './subAgentManager.js';
import { sanitizeContiOnLoad } from './contiManager.js';
import { isShortAlive as isAgentViewShortAlive, isShortWorking as isAgentViewShortWorking, readRoster as readAgentViewRoster } from './claudeAgentViewService.js';
import { pipelineManager } from './pipelineManager.js';
import type { LocalSession, AgentContextInfo } from './sessionDiscovery.js';
import { resolveSessionTitle, readUserMessages, readLastAssistantMessage, readContextInfo, discoverSessions, findPidBySession, isSessionInUse, getSessionJsonlPath, listJsonlSessionIds, findEntrypointBySession } from './sessionDiscovery.js';
import { logger } from '../logger.js';
import { dbg } from './debugLog.js';
import { userDefaultsService } from './userDefaultsService.js';

// ─── 유틸 (순수 함수) ───

function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function normalize(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

/** cwd + 상대경로를 합쳐서 `..`/`.` 까지 collapse 한 정규화 경로.
 *  단순 `normalize()` 는 backslash/lowercase 만 처리하고 `..` 를 그대로 둬서
 *  `path: '..\\foo'` 같은 입력이 들어오면 가짜 `..` segment 가 폴더 버블로 박힌다.
 *  (사례: Grep `..\\TEST\\xxx` → `..` 폴더 + 자식 segment 들이 마스터 트리에 새겨짐) */
function resolveRelative(cwd: string, relPath: string): string {
  const joined = `${cwd}/${relPath}`.replace(/\\/g, '/');
  return path.posix.normalize(joined).toLowerCase().replace(/\/+$/, '');
}

/** normalize() 결과가 절대 경로인지 (Windows 드라이브 또는 POSIX root). */
function isAbsoluteNormalized(normalizedPath: string): boolean {
  return /^[a-z]:\//.test(normalizedPath) || normalizedPath.startsWith('/');
}

/** git 워크트리 → 메인 워크트리(부모 repo) 해석 결과 캐시. key=normalizedCwd, value=결과|null. */
const gitWorktreeParentCache = new Map<string, { parentPath: string; worktreeName: string } | null>();

/** `git rev-parse` 로 cwd 가 **연결된(linked) 워크트리**인지 판정하고 메인 워크트리 경로를 돌려준다.
 *  Claude Code `--isolation worktree` 는 워크트리를 repo 의 `.claude/worktrees/` 가 아니라
 *  `~/.claude/worktrees/<name>` 등 임의 위치에 만들 수 있어, 경로 패턴만으론 부모를 잘못 잡는다
 *  (예: 부모를 사용자 홈으로 오인 → 이주/attribution 실패 → 작업이 `(ext)` 고아로 표시).
 *  git 의 `--show-toplevel`(현재 워크트리 루트) ≠ `--git-common-dir`의 부모(메인 워크트리 루트)
 *  이면 linked 워크트리로 확정한다. 결과는 cwd 단위 캐시(첫 등록 시 1회만 git 호출). */
export function resolveGitWorktreeParent(
  normalizedCwd: string,
): { parentPath: string; worktreeName: string } | null {
  if (gitWorktreeParentCache.has(normalizedCwd)) return gitWorktreeParentCache.get(normalizedCwd)!;
  let result: { parentPath: string; worktreeName: string } | null = null;
  try {
    const out = execFileSync(
      'git',
      ['-C', normalizedCwd, 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'],
      { windowsHide: true, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] },
    ).toString();
    const [topRaw, commonRaw] = out.split('\n').map((s) => s.trim()).filter(Boolean);
    if (topRaw && commonRaw) {
      const wtRoot = normalize(topRaw);
      // linked 워크트리의 common-dir 은 `<메인repo>/.git` → 부모 = 그 디렉토리.
      // 메인 워크트리면 common-dir 이 `<repo>/.git` 이고 toplevel==repo 라 부모가 자기 자신 → 워크트리 아님.
      const commonDir = normalize(commonRaw);
      const mainRoot = normalize(path.dirname(commonRaw));
      if (/(^|\/)\.git$/.test(commonDir) && mainRoot && mainRoot !== wtRoot) {
        result = { parentPath: mainRoot, worktreeName: path.basename(wtRoot) };
      }
    }
  } catch { /* git 없음 / repo 아님 — 워크트리 아님으로 처리 */ }
  gitWorktreeParentCache.set(normalizedCwd, result);
  return result;
}

/** worktree cwd 감지.
 *  1) `<parent>/.claude/worktrees/<name>` 경로 패턴 — git 호출 없는 핫패스(기존 동작 보존).
 *  2) miss 시 `git rev-parse` 로 linked 워크트리 판정(임의 위치 워크트리 인식).
 *  입력은 `normalize()` 결과(lowercase, forward-slash)여야 한다.
 *  반환 `parentPath`는 normalized. `parentAbsPath`가 있으면 부모 cwd 를 문자열 prefix 가
 *  아니라 그 절대경로로 직접 등록해야 한다(임의 위치 워크트리는 prefix slice 불가). */
function detectWorktree(
  normalizedCwd: string,
): { parentPath: string; worktreeName: string; parentAbsPath?: string } | null {
  const m = normalizedCwd.match(/^(.+?)\/\.claude\/worktrees\/([^/]+)\/?$/);
  if (m) return { parentPath: m[1]!, worktreeName: m[2]! };
  const git = resolveGitWorktreeParent(normalizedCwd);
  if (git) return { ...git, parentAbsPath: git.parentPath };
  return null;
}

/** 도구별 파일 경로 추출 */
const FILE_PATH_KEYS: Record<string, string> = {
  Read: 'file_path',
  Write: 'file_path',
  Edit: 'file_path',
  Grep: 'path',
  Glob: 'path',
};

/** Grep/Glob의 path는 보통 디렉토리 — 파일 취급하면 (ext) 레이블/타입이 꼬인다. */
const DIRECTORY_PATH_TOOLS = new Set(['Grep', 'Glob']);

function extractFilePath(
  toolInput: Record<string, unknown>,
  toolName: string,
): string | null {
  const key = FILE_PATH_KEYS[toolName];
  if (!key) return null;
  const raw = toolInput[key];
  return typeof raw === 'string' ? normalize(raw) : null;
}

/** tool_response에서 Bash 출력 텍스트 추출 */
function extractBashOutput(response: Record<string, unknown> | undefined): string {
  if (!response) return '';
  // content 배열 형태: [{ type: 'text', text: '...' }]
  const content = response['content'];
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const item of content) {
      if (typeof item === 'object' && item !== null && 'text' in item) {
        const text = (item as Record<string, unknown>)['text'];
        if (typeof text === 'string') texts.push(text);
      }
    }
    if (texts.length > 0) return texts.join('\n');
  }
  // stdout/stderr 형태
  const stdout = response['stdout'];
  const stderr = response['stderr'];
  const parts: string[] = [];
  if (typeof stdout === 'string' && stdout) parts.push(stdout);
  if (typeof stderr === 'string' && stderr) parts.push(`[stderr] ${stderr}`);
  if (parts.length > 0) return parts.join('\n');
  // 단순 문자열
  if (typeof response['output'] === 'string') return response['output'];
  return '';
}

/** tool_response 에서 텍스트 본문을 관대하게 추출 (Grep/Glob 등 — content 가 string 인 경우 포함). */
function extractToolText(response: Record<string, unknown> | undefined): string {
  if (!response) return '';
  const content = response['content'];
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const item of content) {
      if (typeof item === 'string') { texts.push(item); continue; }
      if (typeof item === 'object' && item !== null && 'text' in item) {
        const text = (item as Record<string, unknown>)['text'];
        if (typeof text === 'string') texts.push(text);
      }
    }
    if (texts.length > 0) return texts.join('\n');
  }
  for (const key of ['stdout', 'output', 'text', 'result']) {
    const v = response[key];
    if (typeof v === 'string' && v) return v;
  }
  return '';
}

/**
 * Grep/Glob 디렉토리 호출의 tool_response 에서 매치된 결과 파일의 절대경로 목록 추출 (§2.1 v2.7).
 *  - Grep `files_with_matches` / Glob: 줄당 1 경로 (`Found N files` 헤더·`No files found` 제외)
 *  - Grep `content`(`path:line:text`) / `count`(`path:count`): 줄 선두의 path 토큰
 * Grep/Glob 출력 경로는 backslash 가능·cwd 또는 검색 폴더(folderAbs) 기준 상대(혹은 절대)다.
 * 두 base 로 해석을 시도하되, **실제 디스크에 존재하는 파일**이면서 `folderAbs` 하위인 것만 채택해
 * 잘못된 base 로 만들어진 가짜 경로를 배제한다. normalize(소문자·forward-slash) 후 중복 제거.
 * `limit` 개를 채우면 조기 종료.
 */
function extractDirToolFiles(
  toolResponse: Record<string, unknown> | undefined,
  cwd: string | undefined,
  folderAbs: string,
  limit: number,
): string[] {
  if (limit <= 0) return [];
  const folderNorm = normalize(folderAbs);
  const bases = [folderAbs, cwd].filter((b): b is string => !!b);
  if (bases.length === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();

  // Claude Code Grep `files_with_matches` / Glob 의 실제 tool_response 는
  // `{filenames: string[], numFiles, mode?, truncated?, durationMs?}` 구조 — 텍스트 파싱 전에 우선 사용.
  // 절대경로(또는 cwd 기준 상대경로)로 들어오므로 text 파싱과 동일한 검증(폴더 하위 + 실존)을 거친다.
  const structured = toolResponse?.['filenames'];
  if (Array.isArray(structured)) {
    for (const raw of structured) {
      if (out.length >= limit) break;
      if (typeof raw !== 'string' || !raw) continue;
      const candidate = raw.replace(/\\/g, '/');
      for (const base of bases) {
        let resolved: string;
        try { resolved = path.resolve(base, candidate); } catch { continue; }
        const norm = normalize(resolved);
        if (norm === folderNorm || !norm.startsWith(`${folderNorm}/`)) continue;
        if (seen.has(norm)) break;
        let isFile = false;
        try { isFile = fs.statSync(resolved).isFile(); } catch { isFile = false; }
        if (!isFile) continue;
        seen.add(norm);
        out.push(norm);
        break;
      }
    }
    return out;
  }

  // 텍스트 fallback — Grep `content`/`count` 모드 또는 legacy `content: string` 응답.
  const text = extractToolText(toolResponse);
  if (!text) return [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (out.length >= limit) break;
    const line = rawLine.trim();
    if (!line) continue;
    if (/^Found \d+ (files?|matches?)$/i.test(line)) continue;
    if (/^No files found$/i.test(line)) continue;
    // content(`path:line:text`) / count(`path:count`) 모드 → 선두 path 토큰만
    let candidate = line;
    const contentM = line.match(/^(.+?):\d+:/);
    const countM = line.match(/^(.+?):\d+$/);
    if (contentM) candidate = contentM[1]!;
    else if (countM) candidate = countM[1]!;
    candidate = candidate.trim().replace(/\\/g, '/');
    if (!candidate) continue;
    // 두 base 로 해석 → folderAbs 하위 + 실존 파일인 첫 결과 채택
    for (const base of bases) {
      let resolved: string;
      try {
        resolved = path.resolve(base, candidate);
      } catch {
        continue;
      }
      const norm = normalize(resolved);
      if (norm === folderNorm || !norm.startsWith(`${folderNorm}/`)) continue;
      if (seen.has(norm)) break;
      let isFile = false;
      try {
        isFile = fs.statSync(resolved).isFile();
      } catch {
        isFile = false;
      }
      if (!isFile) continue;
      seen.add(norm);
      out.push(norm);
      break;
    }
  }
  return out;
}

/** 파일 경로 없는 특수 도구 → BubbleType 매핑 */
const SPECIAL_TOOL_TYPES: Record<string, BubbleType> = {
  Bash: 'bash',
};

/** Bash 명령어 + 선택적 로그 텍스트로 프론트엔드/백엔드 서버 판별 */
function detectServerKind(command: string, logText?: string): ServerKind {
  const haystack = (command + ' ' + (logText ?? '')).toLowerCase();
  for (const pattern of FRONTEND_SERVER_PATTERNS) {
    if (haystack.includes(pattern)) return 'frontend';
  }
  return 'backend';
}

/** `<root>/.vibisual/dev-server.json` 를 cwd 기준으로 위로 탐색하여 읽는다. */
function readDevServerMarker(
  startCwd: string | undefined,
): { port: number; clientPort: number } | null {
  if (!startCwd) return null;
  let dir = startCwd;
  for (let i = 0; i < 10; i++) {
    try {
      const markerPath = path.join(dir, '.vibisual', 'dev-server.json');
      if (fs.existsSync(markerPath)) {
        const data = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as Record<string, unknown>;
        const port = typeof data.port === 'number' ? data.port : null;
        const clientPort = typeof data.clientPort === 'number' ? data.clientPort : null;
        if (port != null && clientPort != null) return { port, clientPort };
        return null;
      }
    } catch { /* ignore & keep walking */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ─── ProjectGraph 클래스 ───

export interface ProcessResult {
  agent: BubbleData;
  topFolder?: BubbleData;
  edge?: ActivityEdge;
}

export class ProjectGraph {
  private root: string | null = null;
  /** 등록된 프로젝트 목록 (normalized path → ProjectInfo). cwd 기반 자동 증가 */
  private projects = new Map<string, ProjectInfo>();
  /** session_id → 에이전트 BubbleData (세션별 독립 에이전트) */
  private agents = new Map<string, BubbleData>();
  /** 에이전트 번호 카운터 (라벨: Agent 1, Agent 2, …) */
  private agentCounter = 0;
  /** 제목 미확정 에이전트 (sessionId → cwd). JSONL 생성 대기 후 재조회 대상 */
  private pendingTitles = new Map<string, string>();
  /** sessionId → cwd (JSONL 유저 메시지 읽기용) */
  private sessionCwds = new Map<string, string>();
  /** sessionId → PID (CLI/VSCode 실제 프로세스만). 점유 검사 대상 집합. */
  private sessionPids = new Map<string, number>();
  /**
   * 워크트리 이주 read 누적 카운트.
   * sessionId → (worktree 정규화 path → 누적 read 횟수). 임계치 도달 시 이주 트리거.
   * 이주는 단방향 아님(v1.76) — 같은 root repo 안에서 워크트리 경계를 넘을 때마다 재평가한다
   * (부모→워크트리, 워크트리 A→워크트리 B). 자기 워크트리 내부 작업은 재이주 안 함(thrash 방지),
   * 부모/타 repo 파일 접근은 external 처리되어 이주 트리거가 아니다.
   */
  private agentWorktreeReadCounts = new Map<string, Map<string, number>>();
  /** read 임계치 — 워크트리 내부를 N회 읽으면 이주 확정. 단일 write/edit 은 즉시 이주. */
  private static readonly WORKTREE_READ_MIGRATION_THRESHOLD = 3;
  /**
   * v1.6 SCENARIO §5.7 #24: VSCode 창 닫힘 등으로 lifecycle이 제거 신호를 보낸 에이전트의 스냅샷.
   * 같은 cwd로 새 SessionStart 훅이 들어오면 restoreDormantForCwd로 다시 살아난다.
   */
  private dormantAgents = new Map<
    string,
    { agent: BubbleData; cwd: string; pid: number; removedAt: number }
  >();
  /** 사용자 지정 라벨 (agentId → label). 자동 이름보다 우선 */
  private customLabels = new Map<string, string>();
  /**
   * §3.2.1-3 v2.63 — 사용자가 명시적으로 삭제한 커스텀 에이전트 sessionId 묘비.
   * identity.json 의 shrink guard 가 "정상 삭제 vs 복원 실패"를 구분하는 신호이자,
   * 부활 시 이 sessionId 는 되살리지 않게 하는 차단 목록. removeBubble(커스텀) 에서 기록.
   */
  private deletedCustomAgents = new Set<string>();
  /** 에이전트 이벤트 캐시 (agent ID → events) + 갱신 시각 */
  private agentEventsCache: { data: Record<string, AgentEvent[]>; updatedAt: number } = { data: {}, updatedAt: 0 };
  private static readonly EVENT_CACHE_TTL = 5_000;
  /** pop된 명령 메타 참조 (index.ts에서 주입, source 매칭용) */
  private poppedCommandsRef: Map<string, { text: string; queuedAt: number; poppedAt: number }[]> = new Map();
  /** 명령 대기열 참조 (index.ts에서 주입, snapshot에 포함) */
  private commandQueuesRef: Map<string, QueuedCommand[]> = new Map();

  /** index.ts에서 poppedCommands Map 참조 주입 */
  setPoppedCommandsRef(ref: Map<string, { text: string; queuedAt: number; poppedAt: number }[]>): void {
    this.poppedCommandsRef = ref;
  }

  /** index.ts에서 commandQueues Map 참조 주입 */
  setCommandQueuesRef(ref: Map<string, QueuedCommand[]>): void {
    this.commandQueuesRef = ref;
  }

  /** 완료/에러 명령 아카이브 참조 (index.ts에서 주입) */
  private completedCommandArchiveRef: Map<string, QueuedCommand[]> = new Map();
  setCompletedCommandArchiveRef(ref: Map<string, QueuedCommand[]>): void {
    this.completedCommandArchiveRef = ref;
  }

  /**
   * §5.5 #17-4 v2.36 — 프로젝트별 스킬 사용 카운트 (skill name → count).
   * `POST /api/commands/:sessionId` 가 명령 텍스트 줄머리 `/skill-name` 매칭마다 증분.
   * 클라 SkillsView 가 정렬 키·배지로 사용. 영속화 대상.
   */
  private skillUsageCounts = new Map<string, number>();

  /** 명령 텍스트 줄머리 `/<word>` 토큰들에 대해 카운트 증분 + broadcast 트리거. */
  recordSkillUsageFromCommandText(text: string): void {
    if (!text) return;
    const matches = text.match(/^\/([A-Za-z0-9_-]+)/gm);
    if (!matches || matches.length === 0) return;
    for (const m of matches) {
      const name = m.slice(1);
      if (!name) continue;
      this.skillUsageCounts.set(name, (this.skillUsageCounts.get(name) ?? 0) + 1);
    }
    this.bumpMutationVersion();
  }

  /**
   * snapshot 직렬화용 — `{ [projectName]: { [skillName]: count } }`.
   * 빈 맵 또는 primary project 미확정이면 undefined.
   * 여러 ProjectGraph 인스턴스의 카운트가 mergeSnapshots 에서 projectName 1차 키로 보존된다.
   */
  getSkillUsageCountsRecord(): Record<string, Record<string, number>> | undefined {
    if (this.skillUsageCounts.size === 0) return undefined;
    const primary = this.getPrimaryProject();
    if (!primary) return undefined;
    const inner: Record<string, number> = {};
    for (const [k, v] of this.skillUsageCounts) inner[k] = v;
    return { [primary.name]: inner };
  }

  /** checkpoint 직렬화용 — flat skillName → count (체크포인트는 이미 프로젝트별 파일이라 1차 키 불필요). */
  getSkillUsageCountsFlat(): Record<string, number> | undefined {
    if (this.skillUsageCounts.size === 0) return undefined;
    const out: Record<string, number> = {};
    for (const [k, v] of this.skillUsageCounts) out[k] = v;
    return out;
  }

  /** 프로젝트 루트 경로 (외부에서 경로 검증용) */
  getRoot(): string | null {
    return this.root;
  }

  private nodes = new Map<string, BubbleData>();
  private childrenMap = new Map<string, Set<string>>();
  private topLevelPaths = new Set<string>();
  /** 폴더별 최근 작업 파일 (folder relative path → file relative paths) */
  private satelliteMap = new Map<string, Set<string>>();
  /** 위성 버블 위치 — 클라이언트가 계산한 위치를 서버에 동기화 (sat-{nodeId} → {x,y}) */
  private satellitePositions = new Map<string, { x: number; y: number }>();
  /** 폴더별 위성 표시 상한 — 노드의 maxSatellites 우선, 없으면 기본값(§7.5). */
  private folderMaxSatellites(folderPath: string): number {
    const node = this.nodes.get(folderPath);
    const m = node?.maxSatellites;
    if (typeof m === 'number' && Number.isFinite(m)) {
      return Math.min(SATELLITE_MAX_BOUNDS.MAX, Math.max(SATELLITE_MAX_BOUNDS.MIN, Math.floor(m)));
    }
    return DEFAULT_MAX_SATELLITES;
  }

  /** 에이���트 위성 (agent ID → 특수 도구 node path Set) */
  // agentSpecialPaths 제거 — bash/iframe 위성은 agent.persistSatellites[]로 이동

  /** 노드별 연결된 에이전트 참조 (node path → agent ID Set). 에이전트가 idle 될 때 제거 */
  private nodeAgentRefs = new Map<string, Set<string>>();
  /** 노드별 소속 프로젝트 이름 (node key → projectName). ProjectInfo.path로 경로 해석 */
  private nodeProjectNames = new Map<string, string>();
  /**
   * 노드별 연속 "fs.existsSync 실패" 관측 횟수 (node key → count).
   * checkFileExistence 디바운스용 — 런타임 전용(체크포인트 미저장, 재기동 시 self-heal).
   * 존재 확인되면 엔트리 삭제, FILE_EXISTENCE_MISS_THRESHOLD 도달 시에만 ghost 전환.
   */
  private existenceMissCount = new Map<string, number>();

  /** 에이전트(session)별 Bash 히스토리 (session_id → 최신순 엔트리) */
  private bashHistory = new Map<string, BashEntry[]>();
  /** tool_use_id → BashEntry 빠른 조회용 (PostToolUse에서 output 매칭) */
  private bashEntryIndex = new Map<string, BashEntry>();
  /** 에이전트(session)별 서버 목록 (session_id → 서버) */
  private runningServers = new Map<string, ServerEntry[]>();
  /**
   * 사용자가 Delete 키로 지운 iframe — (sessionId → Set<port>).
   * 서버가 여전히 살아있어도 shell watcher 로그/rehydrate 경로로는 재생성 금지.
   * 새 Bash `run_in_background` 훅이 들어오면 해제되어 재생성 허용.
   */
  private dismissedIframes = new Map<string, Set<number>>();
  /**
   * §7.11 — 오너 에이전트 키 → {실제 워커 claude 세션 → 그 워커 cwd} 매핑.
   * 커스텀/서브 에이전트는 agents 맵·sessionCwds 에 커스텀 키(`custom-…`)로 저장되지만,
   * background shell(dev 서버)의 JSONL 은 **실제 claude 워커 세션 이름**으로 디스크에 있다.
   * processHookEvent 의 redirect 가 hook session_id 를 워커→오너 키로 rewrite 할 때 이 매핑을
   * 쌓아두면, 오너 키로만 들어온 rehydrate 가 워커 JSONL 을 찾아 shell 을 잡고 위성은 오너에
   * 붙일 수 있다. (일반 세션은 매핑이 없어 자기 세션만 스캔 — 기존 동작 불변.)
   */
  private workerSessionsByOwner = new Map<string, Map<string, string>>();
  /**
   * §7.7 v2.3 denoise — "Keeping agent X alive" 로그를 이미 찍은 세션.
   * removeAgentBySession 은 lifecycle poll 마다(2초) 호출되므로, live iframe 보존
   * 메시지를 매번 찍으면 ServerLogPopup 이 도배된다 → 상태 진입 시 1회만 로깅.
   */
  private keepAliveLogged = new Set<string>();
  /** background shell 파일 감시자 (port 탐지용) */
  private shellWatcher = new BackgroundShellWatcher();
  /** 스냅샷 변경 콜백 (비동기 이벤트 — 파일 감시자 포트 탐지 등) */
  private onSnapshotChange?: () => void;
  /** 파일별 수정 기록 (normalized file path → 최신순 FileEdit[]) */
  private fileEdits = new Map<string, FileEdit[]>();

  /** 메인 뷰 엣지 (agent ↔ top folder) */
  private mainEdges = new EdgeManager();
  /** 폴더 내부 엣지 (parent ↔ child at every level) */
  private innerEdges = new EdgeManager();

  /** 단조 증가 시퀀스 (체크포인트 seq) */
  private seq = 0;

  /** 초기 세션 로딩 활성화 여부 (나중에 옵션창에서 토글) */
  private autoLoadSessions = true;

  /** 탭 닫기로 숨긴 프로젝트 (데이터 보존, 스냅샷에서만 제외) */
  private hiddenProjects = new Set<string>();

  /** 에이전트별 설정 (agent ID → AgentConfig). 디테일 패널에서 편집, checkpoint에 저장 */
  private agentConfigs = new Map<string, AgentConfig>();
  /** 에이전트(session)별 관측된 도구 (session_id → Set<tool_name>). 훅 이벤트에서 자동 수집 */
  private observedTools = new Map<string, Set<string>>();
  /** 사용자가 직접 수동 편집한 에이전트 설정 (agent ID Set). 수동 편집 시 자동 동기화 비활성화 */
  private manuallyConfigured = new Set<string>();

  /** 에이전트 간 작업 흐름 엣지 (TaskEdge ID → TaskEdge) */
  private taskEdges = new Map<string, TaskEdge>();

  /**
   * §5.3 #10-2 v2.37 — Auto Agent 가 생성한 서브 군의 메타 (autoAgentSessionId → AutoAgentSummary).
   * 영속화 대상 (ProjectCheckpoint.autoAgentSummaries).
   */
  private autoAgentSummaries = new Map<string, AutoAgentSummary>();
  /**
   * §4 v2.52 — 에이전트 작업 신고 (agentId → AgentReport[]). did/userActions 색 구분용.
   * 영속화 대상 (ProjectCheckpoint.agentReports). ring buffer 캡 = AGENT_REPORT_MAX_PER_AGENT.
   */
  private agentReports = new Map<string, AgentReport[]>();
  /**
   * §4 v2.60 — 에이전트 질문 카드 (agentId → AgentQuestions[]). 질문 + 제안 프롬프트.
   * 영속화 대상 (ProjectCheckpoint.agentQuestions). ring buffer 캡 = AGENT_QUESTIONS_MAX_PER_AGENT.
   */
  private agentQuestions = new Map<string, AgentQuestions[]>();
  /**
   * §4 v2.70 — 에이전트 검수 요청 카드 (agentId → AgentReview[]). changes/checkpoints 검수용.
   * 영속화 대상 (ProjectCheckpoint.agentReviews). ring buffer 캡 = AGENT_REVIEWS_MAX_PER_AGENT.
   */
  private agentReviews = new Map<string, AgentReview[]>();
  /**
   * §4 v2.84 — 에이전트 번호 목록 정렬 카드 (agentId → AgentList[]). 번호/순서 목록 정렬용.
   * 영속화 대상 (ProjectCheckpoint.agentLists). ring buffer 캡 = AGENT_LISTS_MAX_PER_AGENT.
   */
  private agentLists = new Map<string, AgentList[]>();
  /**
   * §5.3 #12-1 v1.91 — 현재 권한 승인 팝업 대기 중인 에이전트 id 집합.
   * PreToolUse 훅이 동기 hold(최대 60s) 하는 동안 에이전트는 "블록된 활성" 상태다.
   * 이 집합에 든 에이전트는 recompute/sweep/expire 가 completed·idle 로 강등하지 못한다
   * (훅 hold 중 sub 가 비활성처럼 보여 집계가 completed 로 넘기던 버그 차단).
   */
  private permissionWaitingAgents = new Set<string>();

  /** §5.3 #12-1 v1.91 — 권한 대기 진입/해제. index.ts /api/permission-check 가 broker.request 전후로 호출. */
  setPermissionWaiting(agentId: string, waiting: boolean): void {
    if (waiting) this.permissionWaitingAgents.add(agentId);
    else this.permissionWaitingAgents.delete(agentId);
    // 대기 진입 즉시 버블을 active 로 (팝업 뜨자마자 UI 가 "대기=활성" 반영).
    if (waiting) {
      for (const agent of this.agents.values()) {
        if (agent.id === agentId) {
          agent.status = 'active';
          agent.fadeStartedAt = undefined;
          agent.lastActivity = Date.now();
          break;
        }
      }
    }
  }
  /** 언리얼 블프 스타일 Comment Box (id → CommentBox). 메인 캔버스 배경 주석. v1.45 */
  private commentBoxes = new Map<string, CommentBox>();
  /** §5.3 #28 v1.47 — 콘티 (contiId → Conti). 에이전트 cascade 삭제. */
  private contis = new Map<string, Conti>();

  /**
   * §5.3 #28 (L) v1.58 — 콘티 인플라이트 작업 추적 (agentId → ActiveContiWork).
   * 트리거 측에서 workId 발급, 첫 응답에 contiId 머지. 영속화 ❌.
   */
  private activeContiWork = new Map<string, ActiveContiWork>();

  /** §4 v1.50 — 에이전트(session)별 도구 실행 시간 ring buffer (최근 5건). 영속화 ❌. */
  private recentToolDurations = new Map<string, ToolDurationEntry[]>();
  /** §4 v1.50 — 에이전트(session)별 컨텍스트 컴팩션 카운트 + 마지막 시각. ProjectCheckpoint 영속. */
  private compactCounts = new Map<string, CompactCount>();
  private uiLocale: UiLocale = DEFAULT_UI_LOCALE;
  /**
   * 프로젝트별 루트 캔버스 바운딩 박스 크기(half-width/height). 키 = projectName.
   * 미설정(map miss)이면 클라이언트가 기본값을 사용. 사용자가 핸들로 조절하면
   * PATCH 로 업데이트되어 해당 프로젝트 체크포인트에 저장.
   */
  private layoutBoundsByProject = new Map<string, { hw: number; hh: number }>();

  // ─── 성능 최적화: 내부 캐시 (public API / 타입 변경 없음) ───

  /**
   * (2a) enrichNode statSync mtime TTL 캐시.
   * absPath → { size: number; cachedAt: number } | null (null = 파일 없음 음성 캐시)
   */
  private static readonly STAT_CACHE_TTL = 3_000; // ms
  private static readonly STAT_MISS_TTL  = 1_000; // 파일 없음 음성 캐시
  private statCache = new Map<string, { size: number; cachedAt: number } | null>();

  /**
   * (2b) getSnapshot 결과 캐시.
   * mutationVersion 이 바뀌거나 TTL 이 지나면 재계산.
   * TTL 상한은 worst-case staleness 자가치유 안전망 — mutationVersion 누락 경로 대비.
   */
  private static readonly SNAPSHOT_CACHE_TTL = 200; // ms — 클라 coalescence(16ms) 한참 위
  /** 상태 변경을 추적하는 단조증가 버전 카운터 */
  private mutationVersion = 0;
  private snapshotCache: { snapshot: GraphSnapshot; version: number; cachedAt: number } | null = null;

  /** 상태 변경 진입점에서 호출 — mutationVersion 증가 + 스냅샷 캐시 무효화 */
  private bumpMutationVersion(): void {
    this.mutationVersion += 1;
    // 캐시 참조를 null 로 교체해 같은 tick 의 getSnapshot 이 즉시 재계산하도록 보장
    this.snapshotCache = null;
  }

  // ─── 히스토리 API ───

  /** seq 증가 (체크포인트 저장용) */
  incrementSeq(): void {
    this.seq += 1;
  }

  /** 현재 seq 번호 */
  getSeq(): number {
    return this.seq;
  }

  /** 주 프로젝트 이름 (save 폴더명). 없으면 null.
   *  this.root는 normalize()로 소문자화되므로, 원본 케이스는 projects 맵에서 가져온다.
   */
  getPrimaryProjectName(): string | null {
    if (this.root) {
      const normalized = normalize(this.root);
      const info = this.projects.get(normalized);
      if (info) return info.name;
      return path.basename(this.root);
    }
    for (const info of this.projects.values()) {
      return info.name;
    }
    return null;
  }

  /** 주 프로젝트 정보 */
  getPrimaryProject(): ProjectInfo | null {
    if (this.root) {
      const normalized = normalize(this.root);
      const info = this.projects.get(normalized);
      if (info) return info;
      // projects에 없으면 root에서 생성
      return { name: path.basename(this.root), path: this.root.replace(/\\/g, '/') };
    }
    for (const info of this.projects.values()) return info;
    return null;
  }

  // ─── 공개 API ───

  /**
   * cwd에서 프로젝트 등록. 이미 있으면 무시.
   * 원본 케이스 보존 (forward slash 변환만).
   */
  /** 루트 노드 키 접두사 (프로젝트별: __root__:프로젝트명) */
  private static readonly ROOT_PREFIX = '__root__:';

  /** 하위 호환용 레거시 키 */
  private static readonly LEGACY_ROOT_KEY = '__root__';

  /** 프로젝트명 → 루트 키 */
  private static rootKeyFor(projectName: string): string {
    return `${ProjectGraph.ROOT_PREFIX}${projectName}`;
  }

  /** 루트 키인지 판별 */
  private static isRootKey(key: string): boolean {
    return key.startsWith(ProjectGraph.ROOT_PREFIX) || key === ProjectGraph.LEGACY_ROOT_KEY;
  }

  /** 루트 키에서 프로젝트명 추출 */
  private static projectNameFromRootKey(key: string): string | null {
    if (key.startsWith(ProjectGraph.ROOT_PREFIX)) {
      return key.substring(ProjectGraph.ROOT_PREFIX.length);
    }
    return null;
  }

  registerProject(cwd: string): ProjectInfo {
    const normalized = normalize(cwd);

    // worktree cwd 감지 — 부모 프로젝트 auto-register + worktree 노드 생성 후 worktree ProjectInfo 반환
    const wt = detectWorktree(normalized);
    if (wt) {
      // git 해석 워크트리는 부모가 cwd 의 문자열 prefix 가 아니므로 절대경로 직접 사용.
      // `.claude/worktrees/` 패턴은 prefix slice 로 원본 케이스 보존(기존 동작).
      const parentOrigCwd = wt.parentAbsPath ?? cwd.replace(/\\/g, '/').slice(0, wt.parentPath.length);
      const parentInfo = this.registerProject(parentOrigCwd);

      const existingWt = this.projects.get(normalized);
      if (!existingWt) {
        const wtInfo: ProjectInfo = {
          name: path.basename(cwd),
          path: cwd.replace(/\\/g, '/'),
          parentProjectPath: parentInfo.path,
          worktreeName: wt.worktreeName,
        };
        this.projects.set(normalized, wtInfo);
        logger.info(`Worktree registered: "${wtInfo.name}" under "${parentInfo.name}" (${wtInfo.path})`);
      }
      // 부모 top-level에 worktree 노드 보장
      this.ensureWorktreeNode(parentInfo.name, wt.worktreeName, normalized);
      // worktree cwd 내부 세션 탐색도 수행 (부모 소속으로 라우팅됨)
      this.discoverAndSeed(cwd);
      return this.projects.get(normalized)!;
    }

    const existing = this.projects.get(normalized);
    if (existing) {
      if (!this.root) {
        this.root = normalized;
        logger.info(`Project root set via register: ${this.root}`);
      }
      // SSOT §5.4 #14 (v1.34): 사용자 close 의도는 훅보다 강함. 이미 hidden 인 프로젝트는
      // 훅의 registerProject 재호출로 자동 unhide 하지 않는다. 복구는 사용자 명시 액션
      // (POST /api/projects/open-folder → showProject)만 수행한다.
      this.ensureRootNode(existing.name);
      return existing;
    }

    const info: ProjectInfo = {
      name: path.basename(cwd),
      path: cwd.replace(/\\/g, '/'),
    };
    this.projects.set(normalized, info);
    if (!this.root) {
      this.root = normalized;
      logger.info(`Project root set via register: ${this.root}`);
    }
    logger.info(`Project registered: "${info.name}" (${info.path})`);

    // 루트 노드 자동 생성
    this.ensureRootNode(info.name);

    // 새 프로젝트 → 기존 세션 탐색 + 에이전트 시딩 (기존 프로젝트와 동일 초기화)
    this.discoverAndSeed(cwd);

    // `<project>/.claude/worktrees/<name>` 하위 디렉토리를 자동 스캔하여 worktree 버블 사전 생성 (v1.12)
    this.discoverWorktrees(info);

    return info;
  }

  /** `<parent>/.claude/worktrees` 디스크 스캔 → 각 하위 디렉토리를 worktree 프로젝트로 등록 + 버블 생성.
   *  hook 이벤트가 들어오기 전에도 부모 캔버스에 worktree 버블이 떠 있도록 한다(v1.12).
   *  이미 등록된 worktree 는 `registerProject` idempotent + `ensureWorktreeNode` 가드로 스킵. */
  private discoverWorktrees(parentInfo: ProjectInfo): void {
    // worktree 프로젝트 자체에서는 재귀 스캔 금지
    if (parentInfo.parentProjectPath) return;
    const wtRoot = path.join(parentInfo.path.replace(/\//g, path.sep), '.claude', 'worktrees');
    let entries: fs.Dirent[];
    try {
      if (!fs.existsSync(wtRoot)) return;
      entries = fs.readdirSync(wtRoot, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      const wtCwd = path.join(wtRoot, entry.name);
      const normalizedWt = normalize(wtCwd);
      // 사용자가 명시적으로 삭제한 worktree 버블이 `ghost` 로 남아있다면 부활시키지 않는다.
      const existingNode = this.nodes.get(normalizedWt);
      if (existingNode?.bubbleType === 'ghost') continue;
      // registerProject 는 worktree cwd 를 받으면 내부에서 ensureWorktreeNode 를 호출 → 멱등.
      this.registerProject(wtCwd);
    }
  }

  /** 부모 프로젝트 캔버스 top-level에 worktree 버블 보장.
   *  신규 생성 시 같은 상위 디렉토리(`.claude/worktrees`)에 최근 ghost 된 worktree가 있으면
   *  `tryMigrateFromGhost`로 rename 연결(v1.12). */
  private ensureWorktreeNode(parentName: string, worktreeName: string, normalizedWtCwd: string): void {
    const key = normalizedWtCwd;
    if (this.nodes.has(key)) return;
    this.nodes.set(key, {
      id: `worktree-${hashString(key)}`,
      label: worktreeName,
      bubbleType: 'worktree',
      path: key,
      status: 'idle',
      activity: 0,
      lastActivity: Date.now(),
      childCount: 0,
    });
    this.topLevelPaths.add(key);
    this.nodeProjectNames.set(key, parentName);
    // 같은 `.claude/worktrees` 부모 아래의 최근 deleted ghost → rename 으로 전환
    this.tryMigrateFromGhost(key);
  }

  /** cwd가 worktree면 부모 프로젝트, 아니면 자기 자신의 ProjectInfo. 미등록이면 null. */
  private resolveHostProject(cwd: string): ProjectInfo | null {
    const info = this.projects.get(normalize(cwd));
    if (!info) return null;
    if (info.parentProjectPath) {
      const parent = this.projects.get(normalize(info.parentProjectPath));
      if (parent) return parent;
    }
    return info;
  }

  /** 프로젝트 cwd에 해당하는 로컬 세션을 탐색하여 에이전트로 시딩 */
  discoverAndSeed(cwd: string): void {
    const sessions = discoverSessions(cwd);
    if (sessions.length > 0) {
      this.seedAgents(sessions);
    }
  }

  /** 등록된 모든 프로젝트에 대해 새 세션 탐색 + 시딩 (주기적 스캔용) */
  scanAllProjects(): boolean {
    // 기존(체크포인트 복원 포함) 프로젝트 중 worktree 패턴을 뒤늦게 감지하여 부모 종속으로 마이그레이션.
    // projectGraph에 `registerProject` 변경 이전에 저장된 데이터를 최신 규칙으로 승격한다.
    this.migrateWorktreeProjects();

    // 부모 프로젝트별 `.claude/worktrees` 디렉토리를 다시 스캔 — 런타임 중 새 worktree 가 만들어져도 감지(v1.12)
    for (const info of [...this.projects.values()]) {
      if (info.parentProjectPath) continue;
      this.discoverWorktrees(info);
    }

    if (!this.autoLoadSessions) return false;
    let seeded = false;
    for (const info of this.projects.values()) {
      const sessions = discoverSessions(info.path);
      const newSessions = sessions.filter((s) => !this.agents.has(s.sessionId));
      if (newSessions.length > 0) {
        this.seedAgents(newSessions);
        seeded = true;
      }
    }
    return seeded;
  }

  /** 과거 체크포인트에서 복원된 프로젝트 중 `<parent>/.claude/worktrees/<name>` 패턴을
   *  뒤늦게 감지해 `parentProjectPath`를 부여하고 부모 캔버스에 worktree 노드를 생성한다.
   *  멱등 — 이미 변환된 프로젝트도 top-level 이관 누락 보정 목적으로 재실행. */
  private migrateWorktreeProjects(): void {
    for (const [normalizedKey, info] of [...this.projects.entries()]) {
      const wt = detectWorktree(normalizedKey);
      if (!wt) continue;
      const parentOrigCwd = wt.parentAbsPath ?? info.path.slice(0, wt.parentPath.length);
      const parentInfo = this.registerProject(parentOrigCwd);
      const wasFresh = !info.parentProjectPath;
      if (wasFresh) {
        info.parentProjectPath = parentInfo.path;
        info.worktreeName = wt.worktreeName;
      }
      this.ensureWorktreeNode(parentInfo.name, wt.worktreeName, normalizedKey);
      // top-level 노드를 worktree 버블 자식으로 이관 (이미 이관된 경우 no-op)
      this.reparentWorktreeArtifacts(info.name, parentInfo.name, normalizedKey);
      if (wasFresh) logger.info(`Worktree migrated: "${info.name}" → parent "${parentInfo.name}"`);
    }
    // 네임스페이스 prefix 가 라벨에 섞여있는 레거시 노드 라벨 정리
    for (const node of this.nodes.values()) {
      const m = node.label.match(/^wt[0-9a-z]+__(.+)$/);
      if (m) node.label = m[1]!;
    }
  }

  /** 마이그레이션 시 구 root 노드만 정리. 과거에 worktree 버블 자식으로 잘못 이관된
   *  top-level 노드는 복구하여 부모/해당 프로젝트 캔버스로 되돌린다. */
  private reparentWorktreeArtifacts(oldName: string, _parentName: string, worktreeBubbleKey: string): void {
    // 구 root 노드 제거
    const oldRootKey = ProjectGraph.rootKeyFor(oldName);
    if (this.nodes.has(oldRootKey)) {
      this.nodes.delete(oldRootKey);
      this.topLevelPaths.delete(oldRootKey);
      this.nodeProjectNames.delete(oldRootKey);
    }
    // 과거 버그로 worktree 버블의 children 에 잘못 이관된 노드를 top-level 로 복구.
    // 새 훅은 네임스페이스 키로 저장되므로 이 집합에는 비-네임스페이스 키만 남아있다.
    const misplaced = this.childrenMap.get(worktreeBubbleKey);
    if (misplaced) {
      for (const childPath of [...misplaced]) {
        // 네임스페이스 키(`wt<hash>__`)로 시작하는 새 worktree 전용 노드는 유지
        if (childPath.startsWith('wt') && childPath.includes('__')) continue;
        this.topLevelPaths.add(childPath);
        misplaced.delete(childPath);
      }
      if (misplaced.size === 0) this.childrenMap.delete(worktreeBubbleKey);
    }
  }

  /** 프로젝트별 루트 폴더 노드가 없으면 생성 */
  private ensureRootNode(projectName: string): void {
    const key = ProjectGraph.rootKeyFor(projectName);
    if (this.nodes.has(key)) return;
    this.nodes.set(key, {
      id: `root-${hashString(key)}`,
      label: projectName,
      bubbleType: 'root',
      path: key,
      status: 'idle',
      activity: 0,
      lastActivity: Date.now(),
      childCount: 0,
    });
    this.topLevelPaths.add(key);
  }

  /** projectName으로 ProjectInfo 조회 */
  getProjectByName(name: string): ProjectInfo | undefined {
    for (const info of this.projects.values()) {
      if (info.name === name) return info;
    }
    return undefined;
  }

  /** 등록된 프로젝트 이름 목록 */
  getProjectNames(): string[] {
    return [...this.projects.values()].map((info) => info.name);
  }

  /** 전체 프로젝트 목록 (name → ProjectInfo) */
  getProjects(): Record<string, ProjectInfo> {
    const result: Record<string, ProjectInfo> = {};
    for (const info of this.projects.values()) {
      result[info.name] = info;
    }
    return result;
  }

  /** 정규화된 경로(this.projects 키)로 등록된 ProjectInfo 조회.
   *  Manager 가 인스턴스 루트가 worktree(parentProjectPath 보유)인지 판정하는 데 사용한다. */
  getProjectInfoByPath(normalizedPath: string): ProjectInfo | null {
    return this.projects.get(normalizedPath) ?? null;
  }

  /** 프로젝트 숨기기 — 데이터 보존, 스냅샷에서만 제외 */
  hideProject(name: string): boolean {
    let found = false;
    for (const v of this.projects.values()) {
      if (v.name === name) { found = true; break; }
    }
    if (!found) return false;
    this.hiddenProjects.add(name);
    logger.info(`Project hidden: "${name}"`);
    return true;
  }

  /** 프로젝트 숨기기 해제 — 스냅샷에 다시 포함 */
  showProject(name: string): boolean {
    if (!this.hiddenProjects.has(name)) return false;
    this.hiddenProjects.delete(name);
    logger.info(`Project shown: "${name}"`);
    return true;
  }

  /** 프로젝트가 숨겨져 있는지 확인 */
  isProjectHidden(name: string): boolean {
    return this.hiddenProjects.has(name);
  }

  // ─── 에이전트 설정 ───

  /** 에이전트 설정 조회 (없으면 undefined) */
  getAgentConfig(agentId: string): AgentConfig | undefined {
    return this.agentConfigs.get(agentId);
  }

  /** 에이전트 설정 저장 (사용자 수동 편집) */
  setAgentConfig(agentId: string, config: AgentConfig): void {
    this.agentConfigs.set(agentId, config);
    this.manuallyConfigured.add(agentId);
    logger.info(`Agent config updated (manual): ${agentId}`);
  }

  /** 전체 에이전트 설정 스냅샷 */
  getAgentConfigsSnapshot(): Record<string, AgentConfig> {
    return Object.fromEntries(this.agentConfigs);
  }

  /** 훅 이벤트에서 관측한 도구를 기록 */
  recordObservedTool(sessionId: string, toolName: string): void {
    let tools = this.observedTools.get(sessionId);
    if (!tools) { tools = new Set(); this.observedTools.set(sessionId, tools); }
    tools.add(toolName);
  }

  /**
   * 실제 에이전트 정보(모델) → AgentConfig 자동 동기화.
   * 사용자가 수동 편집한 에이전트는 건너뜀.
   * 도구 목록은 동기화하지 않음 — 관측된 도구 ≠ 허용 도구 (기본은 전체 허용).
   * getSnapshot() 시점에 호출하여 항상 최신 상태 반영.
   */
  private syncDetectedAgentConfigs(enrichedAgents: BubbleData[]): void {
    const allToolsSet = new Set(AVAILABLE_AGENT_TOOLS);

    for (const agent of enrichedAgents) {
      if (agent.bubbleType !== 'agent') continue;
      // 수동 편집된 에이전트는 자동 동기화 스킵
      if (this.manuallyConfigured.has(agent.id)) continue;

      const detectedModel = parseModelFamily(agent.modelName);

      const existing = this.agentConfigs.get(agent.id);

      // 수동 편집 안 한 에이전트: 도구는 항상 전체 허용 (기본값)
      const existingToolsAreDefault = !existing?.tools
        || (existing.tools.length === allToolsSet.size && existing.tools.every((t) => allToolsSet.has(t)));
      const needsToolFix = existing && !existingToolsAreDefault;

      const newModel = detectedModel ?? existing?.model ?? DEFAULT_AGENT_CONFIG.model;
      const modelChanged = !existing || existing.model !== newModel;

      if (!modelChanged && !needsToolFix) continue;

      const config: AgentConfig = {
        ...(existing ?? { ...DEFAULT_AGENT_CONFIG }),
        model: newModel,
        tools: [...DEFAULT_AGENT_CONFIG.tools],
      };
      this.agentConfigs.set(agent.id, config);
      logger.debug(`Agent config auto-synced: ${agent.id} (model=${newModel}${needsToolFix ? ', tools reset to all' : ''})`);
    }
  }

  /** 프로젝트 제거 — 연관 에이전트/노드/엣지/히스토리 전부 정리 (실제 삭제 필요 시만 사용) */
  removeProject(name: string): boolean {
    // 프로젝트 찾기
    let projectKey: string | null = null;
    for (const [k, v] of this.projects) {
      if (v.name === name) { projectKey = k; break; }
    }
    if (!projectKey) return false;

    // 해당 프로젝트에 속한 세션 ID + 에이전트 ID 수집
    const sessionIds = new Set<string>();
    const agentIds = new Set<string>();
    for (const [sessionId, cwd] of this.sessionCwds) {
      if (normalize(cwd) === projectKey) {
        sessionIds.add(sessionId);
        const agent = this.agents.get(sessionId);
        if (agent) agentIds.add(agent.id);
      }
    }

    // 해당 프로젝트 소속 노드 ID 수집 (엣지 정리용)
    const removedNodeIds = new Set<string>();
    for (const [nodePath, projName] of this.nodeProjectNames) {
      if (projName === name) {
        const node = this.nodes.get(nodePath);
        if (node) removedNodeIds.add(node.id);
      }
    }

    // 엣지 정리 — 제거될 노드/에이전트 참조 엣지 삭제
    const allRemovedIds = new Set([...removedNodeIds, ...agentIds]);
    this.mainEdges.removeByPredicate((e) =>
      allRemovedIds.has(e.source) || allRemovedIds.has(e.target)
    );
    this.innerEdges.removeByPredicate((e) =>
      allRemovedIds.has(e.source) || allRemovedIds.has(e.target)
    );

    // 에이전트 + 관련 데이터 제거
    for (const sessionId of sessionIds) {
      const agent = this.agents.get(sessionId);
      if (agent) {
        for (const [, refs] of this.nodeAgentRefs) refs.delete(agent.id);
        // persistSatellites 노드도 nodes에서 제거 (프로젝트 teardown — §3.5,
        // 핀 보존 안 함: 프로젝트가 사라지면 고아 노드를 남기지 않는다)
        for (const sat of agent.persistSatellites ?? []) {
          this.nodes.delete(sat.path);
          this.existenceMissCount.delete(sat.path);
        }
      }
      this.agents.delete(sessionId);
      this.sessionCwds.delete(sessionId);
      this.pendingTitles.delete(sessionId);
      this.bashHistory.delete(sessionId);
      this.runningServers.delete(sessionId);
      this.commandQueuesRef.delete(sessionId);
      this.completedCommandArchiveRef.delete(sessionId);
      this.poppedCommandsRef.delete(sessionId);
    }

    // 노드 제거
    for (const [nodePath, projName] of this.nodeProjectNames) {
      if (projName === name) {
        this.nodes.delete(nodePath);
        this.nodeProjectNames.delete(nodePath);
        this.childrenMap.delete(nodePath);
        this.topLevelPaths.delete(nodePath);
        this.satelliteMap.delete(nodePath);
        this.nodeAgentRefs.delete(nodePath);
      }
    }

    // 프로젝트 삭제
    this.hiddenProjects.delete(name);
    this.projects.delete(projectKey);
    if (this.root === projectKey) {
      this.root = this.projects.size > 0 ? this.projects.keys().next().value ?? null : null;
    }

    logger.info(`Project removed: "${name}"`);
    return true;
  }

  agentCount(): number {
    return this.agents.size;
  }

  /** Manager용: agentId가 이 인스턴스에 존재하는지 */
  hasAgentId(agentId: string): boolean {
    for (const a of this.agents.values()) {
      if (a.id === agentId) return true;
    }
    return false;
  }

  /** Manager용: nodeId가 이 인스턴스에 존재하는지 */
  hasNodeId(nodeId: string): boolean {
    for (const n of this.nodes.values()) {
      if (n.id === nodeId) return true;
    }
    return false;
  }

  /** Manager용: 위성(persistSatellites)에 nodeId가 존재하는지.
   *  위성은 nodes/agents 맵에 없고 agent.persistSatellites 배열에만 있어서 별도 탐색 필요.
   *  이게 없으면 ProjectGraphManager.removeBubble 가드가 위성 ID 를 못 찾아 silent skip 한다. */
  hasSatelliteId(nodeId: string): boolean {
    for (const a of this.agents.values()) {
      if (!a.persistSatellites) continue;
      for (const s of a.persistSatellites) {
        if (s.id === nodeId) return true;
      }
    }
    return false;
  }

  /** preserve-pin 여부 (§2.4 v1.28). 대상 없으면 false. */
  isPreservePinnedById(nodeId: string): boolean {
    for (const n of this.nodes.values()) {
      if (n.id === nodeId) return n.preservePinned === true;
    }
    for (const a of this.agents.values()) {
      if (a.id === nodeId) return a.preservePinned === true;
    }
    return false;
  }

  /** 버블 위치 업데이트 (클라이언트 드래그 후 저장) */
  updateBubblePosition(nodeId: string, x: number, y: number): boolean {
    // 위성 버블 위치
    if (nodeId.startsWith('sat-')) {
      this.satellitePositions.set(nodeId, { x, y });
      return true;
    }
    // 에이전트에서 찾기
    for (const agent of this.agents.values()) {
      if (agent.id === nodeId) {
        agent.position = { x, y };
        return true;
      }
    }
    // 노드에서 찾기
    for (const node of this.nodes.values()) {
      if (node.id === nodeId) {
        node.position = { x, y };
        return true;
      }
    }
    logger.warn(`updateBubblePosition: node not found — id="${nodeId}"`);
    return false;
  }

  /** 버블 위치 일괄 업데이트 (물리 엔진 위치 저장 — 히스토리 미기록) */
  updateBubblePositionsBatch(positions: Array<{ id: string; x: number; y: number }>): void {
    // id → BubbleData 역인덱스 (agents는 sessionId 키라 순회 필요)
    const idMap = new Map<string, BubbleData>();
    for (const a of this.agents.values()) idMap.set(a.id, a);
    for (const n of this.nodes.values()) idMap.set(n.id, n);

    for (const { id, x, y } of positions) {
      if (id.startsWith('sat-')) {
        this.satellitePositions.set(id, { x, y });
      } else {
        const bubble = idMap.get(id);
        if (bubble) bubble.position = { x, y };
      }
    }
  }

  /** 버블 라벨 변경 (사용자 수동 지정) */
  updateBubbleLabel(nodeId: string, label: string): void {
    for (const agent of this.agents.values()) {
      if (agent.id === nodeId) {
        this.customLabels.set(nodeId, label);
        agent.label = label;
        return;
      }
    }
  }

  /** agent ID → session ID 조회 */
  findSessionByAgentId(agentId: string): string | null {
    for (const [sessionId, agent] of this.agents) {
      if (agent.id === agentId) return sessionId;
    }
    return null;
  }

  /** sessionId → BubbleData 조회 */
  getAgentBySession(sessionId: string): BubbleData | null {
    return this.agents.get(sessionId) ?? null;
  }

  /** sessionId → agentId 역방향 조회 */
  findAgentIdBySession(sessionId: string): string | null {
    return this.agents.get(sessionId)?.id ?? null;
  }

  /** 현재 등록된 세션 ID 목록 (customCreated·pipeline 합성 세션 제외 — 실제 Claude CLI 세션만) */
  getSessionIds(): string[] {
    const ids: string[] = [];
    for (const [sessionId, agent] of this.agents) {
      if (agent.customCreated) continue;
      if (agent.pipelineParentId) continue;
      ids.push(sessionId);
    }
    return ids;
  }

  /** 현재 이 인스턴스에 살아있는 커스텀 에이전트의 sessionId 집합.
   *  복구 목록 계산(이미 캔버스에 있는 것은 "복구 대상" 제외) + B 진단(worktree/hidden 인스턴스에
   *  커스텀이 섞여 라이브에서 빠지는 케이스 탐지)에 공용. */
  getCustomAgentSessionIds(): string[] {
    const ids: string[] = [];
    for (const [sessionId, agent] of this.agents) {
      if (agent.customCreated) ids.push(sessionId);
    }
    return ids;
  }

  /**
   * §3.2.2 (C 복구) — identity.json 에서 되살린 커스텀 에이전트 정체성을 이 인스턴스의 라이브
   * 그래프에 재삽입한다. sessionId/agentId 를 그대로 유지해 config·과거 sub 스트림이 재연결된다.
   * 이미 살아있으면 위치만 갱신하고 기존 버블 반환. 반환: 재삽입/갱신된 버블(실패 시 null).
   */
  restoreCustomAgentBubble(
    identityAgent: BubbleData,
    config: AgentConfig | undefined,
    label: string | undefined,
    cwd: string | null,
    position?: { x: number; y: number },
  ): BubbleData | null {
    const sessionId = identityAgent.path;
    if (!sessionId) return null;
    // 이미 캔버스에 있으면 위치만 이동(중복 삽입 방지).
    const existing = this.agents.get(sessionId);
    if (existing) {
      if (position) existing.position = position;
      existing.status = existing.status === 'disappearing' ? 'idle' : existing.status;
      this.bumpMutationVersion();
      return existing;
    }
    // 사용자 명시 삭제 묘비였다면 되살리며 해제(사용자가 직접 복구를 택함).
    this.deletedCustomAgents.delete(sessionId);
    const agent: BubbleData = {
      ...identityAgent,
      status: 'idle',
      activity: 0,
      lastActivity: Date.now(),
      customCreated: true,
      ...(position ? { position } : {}),
    };
    this.agents.set(sessionId, agent);
    if (label) this.customLabels.set(agent.id, label);
    if (config) this.agentConfigs.set(agent.id, config);
    if (cwd) {
      this.sessionCwds.set(sessionId, cwd);
      this.registerProject(cwd);
    }
    this.bumpMutationVersion();
    logger.info(`Custom agent restored: "${agent.label}" (session ${sessionId.slice(0, 8)})`);
    return agent;
  }

  /** sessionId → cwd 조회 (서브에이전트 세션 ID도 부모 cwd로 해석) */
  getAgentCwd(sessionId: string): string | null {
    const direct = this.sessionCwds.get(sessionId);
    if (direct) return direct;
    // 서브에이전트 세션 ID → 부모 에이전트 cwd fallback
    for (const subs of subAgentManager.getAllSubsFlat()) {
      if (subs.sessionId === sessionId) {
        const parentCwd = this.sessionCwds.get(subs.parentAgentId);
        if (parentCwd) return parentCwd;
        // parentAgentId가 agentId일 수 있음 — agents Map에서 path로 조회
        for (const [path, agent] of this.agents) {
          if (agent.id === subs.parentAgentId) {
            return this.sessionCwds.get(path) ?? null;
          }
        }
      }
    }
    return null;
  }

  /** 캔버스에서 사용자가 직접 커스텀 에이전트 생성 */
  createCustomAgent(
    label: string,
    position?: { x: number; y: number },
    projectName?: string | null,
    options?: { executionMode?: ExecutionMode },
  ): BubbleData {
    this.agentCounter += 1;
    const sessionId = `custom-${Date.now().toString(36)}-${this.agentCounter}`;
    // §4 v2.63 — CMD(인터랙티브 터미널) 에이전트는 생성 시점에 executionMode + 구분 색 + 이름을 baked.
    const cmdMode = options?.executionMode === 'interactive-terminal';
    const baseName = label || `${cmdMode ? 'CMD' : 'Custom'} Agent ${this.agentCounter}`;
    const uniqueName = this.uniqueLabel(baseName);
    const agent: BubbleData = {
      id: `agent-${hashString(sessionId)}`,
      label: uniqueName,
      bubbleType: 'agent',
      path: sessionId,
      status: 'idle',
      activity: 0,
      lastActivity: Date.now(),
      customCreated: true,
      position,
    };
    this.agents.set(sessionId, agent);
    // §4 v2.42 — 신규 에이전트 기본 설정 = DEFAULT_AGENT_CONFIG 위에 userDefaults.agentConfig 머지.
    // 사용자가 Options 창에서 정의한 디폴트가 새 에이전트에 자동 적용. 기존 에이전트엔 영향 ❌.
    const userAgentDefaults = userDefaultsService.get().agentConfig ?? {};
    // §4 v2.63 — 우클릭 "CMD Agent" 전용. 사용자 토글 ❌ — 2트랙(헤드리스 하네스 vs 인터랙티브 cmd) 분리.
    this.agentConfigs.set(agent.id, {
      ...DEFAULT_AGENT_CONFIG,
      ...userAgentDefaults,
      tools: userAgentDefaults.tools ? [...userAgentDefaults.tools] : [...DEFAULT_AGENT_CONFIG.tools],
      skills: userAgentDefaults.skills ? [...userAgentDefaults.skills] : [...DEFAULT_AGENT_CONFIG.skills],
      // §4 v2.63 — executionMode 는 userDefaults 에서 **절대 상속하지 않는다**(레거시 토글 잔재 차단).
      //   CMD 는 우클릭 "CMD Agent"(명시 options) 로만 baked. 일반 커스텀 에이전트는 항상 헤드리스.
      executionMode: cmdMode ? 'interactive-terminal' as const : undefined,
      ...(cmdMode ? { color: CMD_AGENT_COLOR } : {}),
    });
    // activeProject name → 해당 프로젝트의 원본 cwd 조회
    const cwd = this.resolveProjectCwd(projectName ?? null);
    if (cwd) {
      this.sessionCwds.set(sessionId, cwd);
      this.registerProject(cwd);
    }
    return agent;
  }

  /**
   * §5.3 #10-2 v2.37 — Auto Agent 메타 버블 생성. 커스텀 에이전트와 구조 동일하되 `bubbleType='auto'`.
   * Auto Agent 는 사용자 자연어 요청을 받아 서브 커스텀 에이전트 군을 자동 spawn 하는 메타 동작 전담.
   * 자체는 일반 작업(코드/탐색) ❌. customCreated=true 로 표기 — 영속화·삭제 cascade 등 기존 경로 재사용.
   */
  createAutoAgent(label: string, position?: { x: number; y: number }, projectName?: string | null): BubbleData {
    this.agentCounter += 1;
    const sessionId = `auto-${Date.now().toString(36)}-${this.agentCounter}`;
    const baseName = label || `Auto Agent ${this.agentCounter}`;
    const uniqueName = this.uniqueLabel(baseName);
    const agent: BubbleData = {
      id: `agent-${hashString(sessionId)}`,
      label: uniqueName,
      bubbleType: 'auto',
      path: sessionId,
      status: 'idle',
      activity: 0,
      lastActivity: Date.now(),
      customCreated: true,
      position,
    };
    this.agents.set(sessionId, agent);
    const cwd = this.resolveProjectCwd(projectName ?? null);
    if (cwd) {
      this.sessionCwds.set(sessionId, cwd);
      this.registerProject(cwd);
    }
    // 초기 빈 요약 슬롯 — 사용자가 메시지 보내기 전까지 phase='idle'
    this.autoAgentSummaries.set(sessionId, {
      autoAgentId: sessionId,
      complexity: 'low',
      topology: 'autopilot',
      spawnedAgentIds: [],
      entryAgentId: '',
      userRequest: '',
      phase: 'idle',
      startedAt: Date.now(),
      askQuestionsEnabled: true,
    });
    return agent;
  }

  /** §5.3 #10-2 v2.37 — 특정 auto-agent 의 요약 메타 조회 */
  getAutoAgentSummary(autoAgentId: string): AutoAgentSummary | null {
    return this.autoAgentSummaries.get(autoAgentId) ?? null;
  }

  /** §5.3 #10-2 v2.37 — 요약 메타 갱신 (런타임에서 phase 진행 시 호출) */
  setAutoAgentSummary(autoAgentId: string, summary: AutoAgentSummary): void {
    this.autoAgentSummaries.set(autoAgentId, summary);
  }

  /** §5.3 #10-2 v2.37 — 요약 메타 부분 갱신 (phase·finalSummary 등) */
  updateAutoAgentSummary(autoAgentId: string, patch: Partial<AutoAgentSummary>): AutoAgentSummary | null {
    const existing = this.autoAgentSummaries.get(autoAgentId);
    if (!existing) return null;
    const next: AutoAgentSummary = { ...existing, ...patch };
    this.autoAgentSummaries.set(autoAgentId, next);
    return next;
  }

  /** §5.3 #10-2 v2.37 — 전체 요약 메타 맵 (broadcast 스냅샷용) */
  getAutoAgentSummaries(): Record<string, AutoAgentSummary> {
    return Object.fromEntries(this.autoAgentSummaries);
  }

  /**
   * §4 v2.52 — 에이전트 작업 신고 추가 (agentId → AgentReport[], append + ring buffer 캡).
   * 커스텀/스폰 에이전트가 `POST /api/agent-report` 로 보낸 did/userActions 구조화 신고를 적재.
   */
  addAgentReport(report: AgentReport): void {
    const list = this.agentReports.get(report.agentId) ?? [];
    list.push(report);
    if (list.length > AGENT_REPORT_MAX_PER_AGENT) {
      list.splice(0, list.length - AGENT_REPORT_MAX_PER_AGENT);
    }
    this.agentReports.set(report.agentId, list);
    this.bumpMutationVersion();
  }

  /** §4 v2.52 — 작업 신고 전체 맵 (broadcast 스냅샷/체크포인트용). 빈 맵이면 undefined. */
  getAgentReportsRecord(): Record<string, AgentReport[]> | undefined {
    if (this.agentReports.size === 0) return undefined;
    const out: Record<string, AgentReport[]> = {};
    for (const [k, v] of this.agentReports) out[k] = [...v];
    return out;
  }

  /**
   * §4 v2.60 — 에이전트 질문 카드 추가 (agentId → AgentQuestions[], append + ring buffer 캡).
   * 커스텀/스폰 에이전트가 `POST /api/agent-questions` 로 보낸 질문 + 제안 프롬프트를 적재.
   */
  addAgentQuestions(q: AgentQuestions): void {
    const list = this.agentQuestions.get(q.agentId) ?? [];
    list.push(q);
    if (list.length > AGENT_QUESTIONS_MAX_PER_AGENT) {
      list.splice(0, list.length - AGENT_QUESTIONS_MAX_PER_AGENT);
    }
    this.agentQuestions.set(q.agentId, list);
    this.bumpMutationVersion();
  }

  /** §4 v2.60 — 질문 카드 전체 맵 (broadcast 스냅샷/체크포인트용). 빈 맵이면 undefined. */
  getAgentQuestionsRecord(): Record<string, AgentQuestions[]> | undefined {
    if (this.agentQuestions.size === 0) return undefined;
    const out: Record<string, AgentQuestions[]> = {};
    for (const [k, v] of this.agentQuestions) out[k] = [...v];
    return out;
  }

  /**
   * §4 v2.70 — 에이전트 검수 요청 카드 추가 (agentId → AgentReview[], append + ring buffer 캡).
   * 커스텀/스폰 에이전트가 `POST /api/agent-review` 로 보낸 changes/checkpoints 검수 요청을 적재.
   */
  addAgentReview(review: AgentReview): void {
    const list = this.agentReviews.get(review.agentId) ?? [];
    list.push(review);
    if (list.length > AGENT_REVIEWS_MAX_PER_AGENT) {
      list.splice(0, list.length - AGENT_REVIEWS_MAX_PER_AGENT);
    }
    this.agentReviews.set(review.agentId, list);
    this.bumpMutationVersion();
  }

  /** §4 v2.70 — 검수 요청 카드 전체 맵 (broadcast 스냅샷/체크포인트용). 빈 맵이면 undefined. */
  getAgentReviewsRecord(): Record<string, AgentReview[]> | undefined {
    if (this.agentReviews.size === 0) return undefined;
    const out: Record<string, AgentReview[]> = {};
    for (const [k, v] of this.agentReviews) out[k] = [...v];
    return out;
  }

  /**
   * §4 v2.84 — 에이전트 번호 목록 정렬 카드 추가 (agentId → AgentList[], append + ring buffer 캡).
   * 커스텀/스폰 에이전트가 `POST /api/agent-list` 로 보낸 번호 목록을 적재.
   */
  addAgentList(list: AgentList): void {
    const arr = this.agentLists.get(list.agentId) ?? [];
    arr.push(list);
    if (arr.length > AGENT_LISTS_MAX_PER_AGENT) {
      arr.splice(0, arr.length - AGENT_LISTS_MAX_PER_AGENT);
    }
    this.agentLists.set(list.agentId, arr);
    this.bumpMutationVersion();
  }

  /** §4 v2.84 — 번호 목록 정렬 카드 전체 맵 (broadcast 스냅샷/체크포인트용). 빈 맵이면 undefined. */
  getAgentListsRecord(): Record<string, AgentList[]> | undefined {
    if (this.agentLists.size === 0) return undefined;
    const out: Record<string, AgentList[]> = {};
    for (const [k, v] of this.agentLists) out[k] = [...v];
    return out;
  }

  /** 캔버스에서 파이프라인 에이전트 생성 (부모 1 + 자식 4 원자적 생성) */
  createPipeline(
    type: PipelineType,
    label: string,
    position?: { x: number; y: number },
    projectName?: string | null,
  ): BubbleData {
    const result = pipelineManager.create(type, label, position);
    // 부모를 agents Map에 등록 (스냅샷에 포함되도록)
    this.agents.set(result.parent.path, result.parent);
    // 자식들도 agents Map에 등록
    for (const child of result.children) {
      this.agents.set(child.path, child);
    }
    // 프로젝트 연결
    const cwd = this.resolveProjectCwd(projectName ?? null);
    if (cwd) {
      this.sessionCwds.set(result.parent.path, cwd);
      this.registerProject(cwd);
    }
    return result.parent;
  }

  /** projectName → 원본 cwd 조회 (projects Map에서 이름으로 검색) */
  private resolveProjectCwd(projectName: string | null): string | null {
    if (projectName) {
      for (const info of this.projects.values()) {
        if (info.name === projectName) return info.path;
      }
    }
    // fallback: 첫 번째 프로젝트 or root
    const first = [...this.projects.values()][0];
    if (first?.path) return first.path;
    // v2.62 — projects 가 아직 비어도(부팅 초기/하이드레이트 전) primary/root 로 폴백.
    // 여기서 null 을 돌려주면 createCustomAgent 가 sessionCwds 등록을 통째로 스킵 →
    // 그 커스텀 에이전트가 toProjectCheckpoint 의 getProjectSessionIds 필터에서 탈락 →
    // 다음 저장 때 조용히 소멸하던 직접 원인(§3.2.1). 항상 cwd 를 확보한다.
    return this.getPrimaryProject()?.path ?? this.root ?? null;
  }

  /**
   * §3.2.1-3 v2.63 — 명시 삭제 묘비 기록 + 단조 증가 상한(DELETED_AGENT_TOMBSTONE_MAX).
   * Set 은 삽입 순서를 보존하므로 한도 초과 시 가장 오래된 묘비부터 버린다.
   * (sessionId 는 전역 유니크라 재생성되지 않아 안전하게 prune 할 길이 없으므로 상한만 둠.)
   */
  private addTombstone(sessionId: string): void {
    this.deletedCustomAgents.add(sessionId);
    while (this.deletedCustomAgents.size > DELETED_AGENT_TOMBSTONE_MAX) {
      const oldest = this.deletedCustomAgents.values().next().value;
      if (oldest === undefined) break;
      this.deletedCustomAgents.delete(oldest);
    }
  }

  /** 버블 삭제 (노드 ID 기준). 에이전트가 다시 사용하면 재생성됨. 루트 버블은 삭제 불가.
   *  v1.85 — `purgeTaskEdges`: 에이전트 분기에서 그 에이전트에 붙은 Task Edge 까지 cascade 제거할지.
   *  **사용자 명시 삭제 경로만 true**. 자동 disappear/만료 호출은 기본 false → 엣지 dormant 보존. */
  removeBubble(nodeId: string, opts: { force?: boolean; purgeTaskEdges?: boolean } = {}): void {
    // 클라이언트가 위성을 렌더할 때 ID 에 'sat-' prefix 를 붙임([satellite.ts]).
    // 서버 측 위성 원본 ID 와 매칭되도록 strip — 안 그러면 iframe/file 위성 Delete 가
    // silent skip 된다.
    if (nodeId.startsWith('sat-')) nodeId = nodeId.slice(4);

    // 루트 버블은 삭제 금지
    for (const node of this.nodes.values()) {
      if (node.id === nodeId && node.bubbleType === 'root') {
        logger.info(`Bubble removal blocked: root node "${node.label}" cannot be deleted`);
        return;
      }
    }

    // preserve-pin 가드 (§2.4 v1.28) — force=true(내부 이관/리네임) 외엔 삭제 거부
    if (!opts.force) {
      for (const node of this.nodes.values()) {
        if (node.id === nodeId && node.preservePinned) {
          logger.info(`Bubble removal blocked: "${node.label}" is preserve-pinned`);
          return;
        }
      }
      for (const agent of this.agents.values()) {
        if (agent.id === nodeId && agent.preservePinned) {
          logger.info(`Bubble removal blocked: agent "${agent.label}" is preserve-pinned`);
          return;
        }
      }
    }

    // iframe 위성 삭제 — 에이전트의 persistSatellites에서 제거 + dismissed 기록
    for (const [sessionId, agent] of this.agents) {
      if (!agent.persistSatellites) continue;
      const idx = agent.persistSatellites.findIndex(
        (s) => s.id === nodeId && s.bubbleType === 'iframe',
      );
      if (idx < 0) continue;
      const sat = agent.persistSatellites[idx]!;
      agent.persistSatellites.splice(idx, 1);
      // 포트 추출 → dismissed 기록 (새 Bash 훅이 들어오기 전까진 재생성 금지)
      const port = sat.url?.match(/:(\d+)(?:\/|$)/)?.[1];
      if (port) {
        let ports = this.dismissedIframes.get(sessionId);
        if (!ports) { ports = new Set(); this.dismissedIframes.set(sessionId, ports); }
        ports.add(parseInt(port, 10));
      }
      if (sat.shellId) this.shellWatcher.stop(sat.shellId);
      logger.info(`Bubble removed: iframe "${sat.label}" (port ${port ?? '?'} dismissed)`);
      return;
    }

    // 에이전트 삭제
    for (const [sessionId, agent] of this.agents) {
      if (agent.id === nodeId) {
        // §3.2.1-3 v2.63 — 커스텀 에이전트의 명시적 삭제는 묘비에 기록한다.
        // 이게 없으면 identity.json shrink guard 가 정상 삭제를 복원 실패로 오인해
        // 막아버려, 재시작 시 삭제했던 에이전트가 유령으로 부활한다.
        if (agent.customCreated) this.addTombstone(sessionId);
        this.agents.delete(sessionId);
        this.sessionCwds.delete(sessionId);
        this.pendingTitles.delete(sessionId);
        const activeIds = this.getActiveAgentIds(agent.id);
        this.mainEdges.removeAgentRefs(agent.id, activeIds);
        this.innerEdges.removeAgentRefs(agent.id, activeIds);
        this.removeAgentRefs(agent.id, activeIds);
        // 사용자 삭제 → 버블이 사라지므로 해당 엣지도 완전 제거(고아 엣지 방지)
        this.mainEdges.removeByPredicate((e) => e.source === agent.id || e.target === agent.id);
        this.innerEdges.removeByPredicate((e) => e.source === agent.id || e.target === agent.id);
        // v1.85 — Task Edge 는 사용자 산출물. 사용자 명시 삭제(purgeTaskEdges)에서만 cascade 제거.
        // 자동 disappear/만료(기본 false)에는 보존 → 에이전트 재등장 시 자동 재연결.
        if (opts.purgeTaskEdges) {
          for (const [tid, te] of this.taskEdges) {
            if (te.sourceAgentId === agent.id || te.targetAgentId === agent.id) {
              this.taskEdges.delete(tid);
            }
          }
        }
        // 에이전트 영구 위성 노드 제거 (preserve-pin 보존 — §2.4 v1.28)
        this.dropAgentSatellites(agent, `removeBubble agent=${agent.id}`);
        // §5.3 #28 v1.47 — 콘티 cascade
        const removedContis: string[] = [];
        for (const [cid, c] of this.contis) {
          if (c.agentId === agent.id) {
            this.contis.delete(cid);
            removedContis.push(cid);
          }
        }
        if (removedContis.length > 0) {
          logger.info(`Cascaded ${removedContis.length} conti(s) for removed agent "${agent.label}"`);
        }
        // §5.3 #28 (L) v1.58 — 콘티 작업 트래커 cascade
        this.activeContiWork.delete(agent.id);
        // 메모리 누수 방지 — 사용자 명시 삭제 시 per-agent Map/Set 정리(좀비 카드 누적 차단)
        this.agentConfigs.delete(agent.id);
        this.agentReports.delete(agent.id);
        this.agentQuestions.delete(agent.id);
        this.agentReviews.delete(agent.id);
        this.agentLists.delete(agent.id);
        this.manuallyConfigured.delete(agent.id);
        this.observedTools.delete(sessionId);
        logger.info(`Bubble removed: agent "${agent.label}"`);
        return;
      }
    }

    // 일반 노드 삭제 (폴더/파일)
    for (const [nodePath, node] of this.nodes) {
      if (node.id === nodeId) {
        // worktree 버블(정상/ghost 모두) 제거 시 this.projects 엔트리도 함께 정리 —
        // 그렇지 않으면 migrateWorktreeProjects 가 다음 스캔에서 ensureWorktreeNode 로 부활시킨다(v1.12).
        const isWorktreeNode = node.bubbleType === 'worktree'
          || (node.bubbleType === 'ghost' && node.ghostInfo?.originalBubbleType === 'worktree');
        if (isWorktreeNode) {
          if (this.projects.delete(nodePath)) {
            logger.info(`Worktree project entry cleared on bubble remove: "${nodePath}"`);
          }
          this.nodeProjectNames.delete(nodePath);
        }
        // 사라질 노드 id 수집(삭제 전) — 엣지 퍼지용
        const removedIds = new Set<string>([node.id]);
        const children = this.childrenMap.get(nodePath);
        if (children) {
          for (const cp of children) {
            const cn = this.nodes.get(cp);
            if (cn) removedIds.add(cn.id);
          }
        }
        this.nodes.delete(nodePath);
        this.topLevelPaths.delete(nodePath);
        this.nodeAgentRefs.delete(nodePath);
        this.existenceMissCount.delete(nodePath);
        // 자식/위성도 함께 제거
        if (children) {
          for (const cp of children) {
            this.nodes.delete(cp);
            this.nodeAgentRefs.delete(cp);
            this.existenceMissCount.delete(cp);
          }
          this.childrenMap.delete(nodePath);
        }
        this.satelliteMap.delete(nodePath);
        // 위성 맵에서도 제거 (FolderFileTree 체크 해제 연동)
        for (const [, set] of this.satelliteMap) {
          set.delete(nodePath);
          if (children) {
            for (const cp of children) set.delete(cp);
          }
        }
        // 사용자 삭제 → 연결 엣지 완전 제거(고아 방지). ghost 변환 경로는 이 분기 오지 않음.
        this.mainEdges.removeByPredicate((e) => removedIds.has(e.source) || removedIds.has(e.target));
        this.innerEdges.removeByPredicate((e) => removedIds.has(e.source) || removedIds.has(e.target));
        logger.info(`Bubble removed: node "${node.label}"`);
        return;
      }
    }
  }

  setAutoLoadSessions(enabled: boolean): void {
    this.autoLoadSessions = enabled;
  }

  isAutoLoadSessions(): boolean {
    return this.autoLoadSessions;
  }


  /** 같은 프로젝트명이 이미 있으면 번호 붙여서 고유 라벨 생성 */
  private uniqueLabel(baseName: string): string {
    const existing = [...this.agents.values()]
      .map((a) => a.label)
      .filter((l) => l === baseName || l.startsWith(`${baseName} #`));
    if (existing.length === 0) return baseName;
    return `${baseName} #${existing.length + 1}`;
  }

  /** 가장 오래 사용 안 한 idle 에이전트를 제거. 제거 성공 시 true */
  private evictLru(): boolean {
    let oldest: { key: string; time: number } | null = null;
    for (const [key, a] of this.agents) {
      if (a.status === 'active') continue;
      const t = a.lastActivity ?? 0;
      if (!oldest || t < oldest.time) {
        oldest = { key, time: t };
      }
    }
    if (!oldest) return false;
    const evicted = this.agents.get(oldest.key);
    this.agents.delete(oldest.key);
    this.pendingTitles.delete(oldest.key);
    if (evicted) logger.info(`Evicted LRU agent "${evicted.label}"`);
    return true;
  }

  /** 로컬 세션 목록에서 에이전트 버블을 사전 생성 (idle 상태) */
  seedAgents(sessions: LocalSession[]): void {
    if (!this.autoLoadSessions) return;
    // 서브에이전트 세션 ID 집합 — 앱 내부에서 생성한 세션은 별도 버블로 만들지 않음
    const subSessionIds = new Set(
      subAgentManager.getAllSubsFlat()
        .map((s) => s.sessionId)
        .filter((id) => id !== ''),
    );
    for (const session of sessions) {
      // 비활성화: LRU 에빅션 없음
      // if (this.agents.size >= MAX_AGENTS && !this.evictLru()) break;
      if (this.agents.has(session.sessionId)) {
        // 체크포인트 복원된 에이전트는 sessionPids가 비어있으므로 보강
        if (!this.sessionPids.has(session.sessionId)) {
          this.sessionPids.set(session.sessionId, session.pid);
        }
        continue;
      }
      // 앱 내부 서브에이전트 세션은 건너뜀 — 이미 부모 에이전트 하위에서 관리됨
      if (subSessionIds.has(session.sessionId)) {
        logger.debug(`Skipping sub-agent session: ${session.sessionId}`);
        continue;
      }
      // 아직 유저 메시지가 없는 세션은 건너뜀 — 제목 확정 후 다음 폴링에서 추가
      if (!session.hasTitle) continue;

      this.agentCounter += 1;
      const label = session.title;
      const agent: BubbleData = {
        id: `agent-${hashString(session.sessionId)}`,
        label,
        bubbleType: 'agent',
        path: session.sessionId,
        status: 'idle',
        activity: 0,
        lastActivity: Date.now(),
      };
      this.agents.set(session.sessionId, agent);

      this.sessionCwds.set(session.sessionId, session.cwd);
      this.sessionPids.set(session.sessionId, session.pid);
      // 서브폴더 세션이라도 이 인스턴스의 프로젝트 루트에 등록 (서브폴더를 별개 프로젝트로 만들지 않음)
      const projectCwd = this.root ? this.root : session.cwd;
      this.registerProject(projectCwd);

      logger.info(`Seeded agent "${label}" (PID ${session.pid})`);

      // JSONL 기반 background shell 복원 (이미 실행 중이던 dev 서버 등)
      this.rehydrateBackgroundShells(session.sessionId, session.cwd);
    }
  }

  /**
   * background shell 복원.
   * - 등록된 세션(sessionCwds)에 대해 각각 스캔
   * - 추가로 프로젝트 JSONL 디렉터리 전체를 훑어서, sessionCwds에 없는 세션이라도
   *   살아있는 bg shell이 있으면 에이전트를 자동 재생성하여 iframe을 복원
   *   (이미 expire된 세션이지만 dev 서버는 살아있는 경우 대응)
   */
  rehydrateAllBackgroundShells(): void {
    // v1.2 (SCENARIO §5.7 #24): 기동 시 버블 소스는 체크포인트 단 하나.
    // JSONL 전역 스캔으로 새 에이전트를 부활시키던 로직은 제거 — 체크포인트에 없는
    // 세션이 "후두두둑" 생성되어 다른 프로젝트 것과 섞이는 문제를 유발했다.
    // 체크포인트에 이미 존재하는 에이전트의 background shell만 재수화한다.
    for (const [sessionId, cwd] of this.sessionCwds) {
      this.rehydrateBackgroundShells(sessionId, cwd);
    }

    // URL 단위 dedup — 같은 서버를 여러 에이전트가 열었으면 최신 것만 남김
    this.dedupeAllIframeSatellites();
  }

  /** dead/expire된 세션을 JSONL 기반으로 최소 정보만 가지고 agent Map에 다시 등록 */
  private resurrectAgentFromJsonl(sessionId: string, cwd: string): void {
    if (this.agents.has(sessionId)) return;
    const title = resolveSessionTitle(cwd, sessionId) ?? `session ${sessionId.slice(0, 8)}`;
    this.agentCounter += 1;
    const agent: BubbleData = {
      id: `agent-${hashString(sessionId)}`,
      label: title,
      bubbleType: 'agent',
      path: sessionId,
      status: 'idle',
      activity: 0,
      lastActivity: Date.now(),
    };
    this.agents.set(sessionId, agent);
    this.sessionCwds.set(sessionId, cwd);
    logger.info(`Resurrected agent for active bg shell: session=${sessionId.slice(0, 8)} title="${title}"`);
  }

  /** DEBUG: 각 세션별 background shell 스캔 결과 */
  getBackgroundShellDiagnosis(): unknown {
    const out: unknown[] = [];
    for (const [sessionId, cwd] of this.sessionCwds) {
      const jsonlPath = getSessionJsonlPath(cwd, sessionId);
      const jsonlExists = fs.existsSync(jsonlPath);
      const shells = jsonlExists ? scanActiveBackgroundShells(jsonlPath) : [];
      const hasAgent = this.agents.has(sessionId);
      out.push({
        sessionId,
        cwd,
        jsonlPath,
        jsonlExists,
        hasAgent,
        shellsFound: shells.length,
        shells: shells.map((s) => ({
          shellId: s.shellId,
          outputPath: s.outputPath,
          outputExists: fs.existsSync(s.outputPath),
          command: s.command,
        })),
      });
    }
    return out;
  }

  /** 세션 JSONL을 스캔하여 살아있는 background shell을 iframe 위성으로 복원 */
  private rehydrateBackgroundShells(sessionId: string, cwd: string): void {
    try {
      // §7.11 — 스캔 대상 = 오너 세션 자신 + (커스텀/서브면) 매핑된 실제 워커 claude 세션들.
      // 커스텀 에이전트는 agents 맵·sessionCwds 에 커스텀 키(`custom-…`)로 저장되는데
      // background shell 의 JSONL 은 워커 세션 이름으로 디스크에 있어, 오너 키로만 스캔하면
      // JSONL 을 못 찾아 영영 watcher 가 안 붙는다(= dev 서버 iframe 위성 누락). 워커 JSONL 을
      // 함께 훑되, 위성·ServerEntry 는 오너(sessionId)에 붙여 createIframeSatellite 의
      // `this.agents.get(sessionId)` 가 성공하게 한다. (일반 세션은 매핑이 없어 자기만 스캔.)
      const scanTargets = new Map<string, string>(); // realSessionId → 그 세션의 cwd
      scanTargets.set(sessionId, cwd);
      const mapped = this.workerSessionsByOwner.get(sessionId);
      if (mapped) for (const [ws, wcwd] of mapped) scanTargets.set(ws, wcwd || cwd);

      let servers = this.runningServers.get(sessionId);
      if (!servers) { servers = []; this.runningServers.set(sessionId, servers); }

      let totalActives = 0;
      for (const [scanId, scanCwd] of scanTargets) {
        const jsonlPath = getSessionJsonlPath(scanCwd, scanId);
        const actives = scanActiveBackgroundShells(jsonlPath);
        if (actives.length === 0) continue;
        totalActives += actives.length;

        for (const s of actives) {
          // output 파일 자체가 없어졌으면 스킵
          if (!fs.existsSync(s.outputPath)) continue;

          // §7.11 v2.20 — probe 명령(curl/wget/nc 등)은 rehydrate 도 skip.
          // 명령어에서 추출되는 localhost:N 은 launch 가 아니라 probe 대상이라 서버로 보면 안 됨.
          if (isProbeCommand(s.command)) continue;

          // 기존 엔트리 백필 (PreToolUse에서 서버 판정되어 이미 등록된 경우)
          const existing = servers.find(
            (e) => e.shellId === s.shellId || e.id === s.toolUseId,
          );
          if (existing) {
            if (!existing.shellId) existing.shellId = s.shellId;
            if (!existing.outputFile) existing.outputFile = s.outputPath;
          }

          // 명령어에서 즉시 추출 시도 — 성공하면 서버 확정 → 누락됐으면 지금 등록.
          // §7.11 v2.20/v2.24 — extractPort 가 cmd 에서 못 잡으면 inline eval(`node -e "..."`) →
          // script file(`node server.js`) 순으로 fallback.
          const inlinePort = extractPort(s.command)
            ?? extractPortFromInlineEval(s.command)
            ?? extractPortFromScriptFile(s.command, scanCwd);
          if (inlinePort) {
            this.createIframeSatellite(sessionId, s.command, inlinePort, s.shellId);
            this.ensureServerEntryForShell(sessionId, s.toolUseId, s.command, s.shellId, s.outputPath, inlinePort);
            continue;
          }

          // §7.11 v2.21 — looksLikeServerCommand placeholder 분기 폐기.
          // strict 1:1: ServerEntry 는 watcher 가 isPortAlive 로 port 실제 확인한 시점에만
          // createIframeSatellite + ensureServerEntryForShell 짝으로 등록한다.
          // (이전 v2.1 의 placeholder 등록은 watcher 가 port 끝내 못 잡으면 영구 잔존 → 1:1 위반)
          this.shellWatcher.start(s.shellId, s.outputPath, (port) => {
            let log = '';
            try { log = fs.readFileSync(s.outputPath, 'utf8'); } catch { /* ignore */ }
            this.createIframeSatellite(sessionId, s.command, port, s.shellId, log);
            this.ensureServerEntryForShell(sessionId, s.toolUseId, s.command, s.shellId, s.outputPath, port);
            this.onSnapshotChange?.();
          });
        }
      }

      if (totalActives > 0) logger.info(`Rehydrated ${totalActives} background shell(s) for owner=${sessionId} (scanned ${scanTargets.size} session(s))`);
    } catch (err) {
      logger.warn(`rehydrateBackgroundShells failed for ${sessionId}: ${String(err)}`);
    }
  }

  /** 제목 미확정 에이전트가 있는지 */
  hasPendingTitles(): boolean {
    return this.pendingTitles.size > 0;
  }

  /** 미확정 제목 재조회. 변경된 건수 반환 */
  resolvePendingTitles(): number {
    let changed = 0;
    for (const [sessionId, cwd] of this.pendingTitles) {
      const title = resolveSessionTitle(cwd, sessionId);
      if (!title) continue;

      const agent = this.agents.get(sessionId);
      if (agent && !this.customLabels.has(agent.id)) {
        agent.label = title;
        changed += 1;
        logger.info(`Resolved title for agent: "${title}"`);
      }
      this.pendingTitles.delete(sessionId);
    }
    return changed;
  }

  processHookEvent(payload: HookEventPayload): ProcessResult | null {
    this.bumpMutationVersion();
    try {
      if (!payload.tool_name || !payload.tool_input) return null;

      // 서브에이전트 세션이면 부모 에이전트 세션으로 리라이트.
      // 서브에이전트가 fired 한 hook 의 session_id 는 자체 sessionId 라 this.agents 에 없어
      // touchAgent 가 떠돌이 ghost 버블을 매번 새로 만들고 파일/폴더 엣지가 거기에 붙는다.
      // 부모 agent.id → parent session_id 로 redirect 해 부모 버블이 대신 attribution 받게 한다.
      if (!this.agents.has(payload.session_id)) {
        const workerSessionId = payload.session_id;
        // §4 v2.64 — CMD(인터랙티브 터미널) 소유자 태그(`_vibisualOwnerAgentId`)는 라우트
        //   (/api/hook-event)에서 이미 session_id 를 그 CMD 버블 세션으로 rewrite 하므로
        //   여기 도달 시점엔 agents.has(session_id) 가 참 → 이 블록을 타지 않는다. 별도 redirect 불필요.

        // v1.68: agent-view 복구 후 서브에이전트 hook 의 session_id 는 supervisor 가 준
        // agentViewSessionId 라 sub.sessionId 매칭만으론 놓쳐 orphan 버블이 새로 생긴다.
        // 두 키 모두로 부모를 찾아 원래 명령을 낸 커스텀 에이전트에 흡수시킨다.
        const sub = subAgentManager.getAllSubsFlat().find(
          (s) => s.sessionId === workerSessionId || s.agentViewSessionId === workerSessionId,
        );
        if (sub) {
          for (const [sid, agent] of this.agents) {
            if (agent.id === sub.parentAgentId) {
              payload.session_id = sid;
              break;
            }
          }
        }

        // cwd 폴백 — sub.sessionId 가 아직 미해석(resolveSessionIdForShort 폴링 중)이거나
        // 워크트리 격리로 hook session 이 sub 기록과 어긋나면 위 매칭이 빗나가
        // touchAgent 가 워크트리 워커 ghost 를 만들어 커스텀 부모가 영영 고립된다.
        // payload.cwd 가 git 워크트리면, 그 워크트리의 부모 프로젝트에 속한
        // customCreated 에이전트(서브를 띄운 주체)에게 귀속시킨다 — 가장 최근 활동 sub 기준.
        // §17 경계 보존 — 진짜 외부 Claude Code 훅 세션(entrypoint=vscode)은 이 워크트리
        // 폴백으로 커스텀 부모에 **절대** 흡수하지 않는다. 이 폴백의 정당한 대상은 우리가
        // 띄운 헤드리스(`claude -p`) 워크트리 워커뿐 — vscode 진입점이면 사용자가 직접 켠
        // 독립 세션이므로 자체 Hook 에이전트 버블을 갖도록 흘려보낸다(Hook≠Custom 불합치).
        if (!this.agents.has(payload.session_id) && payload.cwd
          && findEntrypointBySession(workerSessionId) !== 'vscode') {
          const parentSid = this.resolveWorktreeOwnerSession(payload.cwd);
          if (parentSid) payload.session_id = parentSid;
        }

        // §5.7 #23-2 — 데몬(Agent View) 워커 세션은 **절대** 새 버블을 만들지 않는다.
        // 데몬의 목적은 "재시작 시점에 진행 중이던 1개 커스텀 에이전트 프롬프트의 연속성"
        // 하나뿐이다. 위 redirect 들이 모두 빗나가도(부팅 직후 부모 버블 미복원 /
        // agentViewSessionId 폴링 중) 이 세션이 (a) 매칭된 sub 의 워커이거나
        // (b) 데몬 roster 의 살아있는 worker 면, touchAgent 가 orphan(모래시계) 버블을
        // 찍지 못하게 이벤트를 흘려보낸다. 원래 명령을 낸 커스텀 부모 버블은 체크포인트에서
        // 이미 복원돼 있고, reattachAgentViewOnBoot 가 watcher 를 붙이는 순간 그 버블로
        // 스트림이 자연 귀속된다 — 새 버블을 찍으면 사용자가 금지한 "자동 막 생성" 이 된다.
        // v1.77 (Direction A) — isManagedSession 추가: legacy 커스텀 워커도 sub.sessionId
        // 캡처 후엔 managed 로 잡혀 새 버블을 절대 안 찍는다(데몬 외 경로까지 일반화).
        if (!this.agents.has(payload.session_id)
          && (sub
            || this.isDaemonWorkerSession(workerSessionId)
            || subAgentManager.isManagedSession(workerSessionId))) {
          return null;
        }

        // §7.11 — 워커→오너 rewrite 가 성사됐으면 매핑 기록(오너 → {워커세션: 워커cwd}).
        // background shell 의 JSONL 은 워커 세션 이름으로 디스크에 있으므로, 오너 키로만 가진
        // attachBackgroundShell / 주기 sweep 의 rehydrate 가 이 매핑으로 워커 JSONL 을 찾는다.
        if (payload.session_id !== workerSessionId && this.agents.has(payload.session_id) && payload.cwd) {
          let m = this.workerSessionsByOwner.get(payload.session_id);
          if (!m) { m = new Map(); this.workerSessionsByOwner.set(payload.session_id, m); }
          m.set(workerSessionId, payload.cwd);
        }
      }

      // KillShell PostToolUse → 매칭 iframe 위성 제거
      if (payload.tool_name === 'KillShell' && payload.hook_event_name === 'PostToolUse') {
        this.handleKillShell(payload);
      }

      // 세션별 cwd 저장 + 프로젝트 자동 등록 (서브폴더 세션은 루트에 등록)
      if (payload.cwd && !this.sessionCwds.has(payload.session_id)) {
        this.sessionCwds.set(payload.session_id, payload.cwd);
        const projectCwd = this.root ? this.root : payload.cwd;
        this.registerProject(projectCwd);
      }
      if (!this.root && payload.cwd) {
        this.root = normalize(payload.cwd);
        logger.info(`Project root set: ${this.root}`);
      }

      // 워크트리 isolation 세션 명시 등록.
      // 위 블록은 root 가 잡혀 있으면 projectCwd=root 만 등록 → 서브에이전트가
      // `--isolation worktree` 로 만든 워크트리 cwd 는 영영 미등록 → getProjectForCwd 가
      // 못 찾아 작업이 `(ext)` 고아로 뜨고 커스텀 에이전트 attribution/이주가 안 된다.
      // payload.cwd 가 (경로패턴 밖이라도) git linked 워크트리면 명시 등록(registerProject 멱등 —
      // detectWorktree 가 부모 자동 등록 + 워크트리 버블 생성 + parentProjectPath 부여).
      if (payload.cwd && this.root) {
        const cwdNorm = normalize(payload.cwd);
        if (cwdNorm !== normalize(this.root) && !this.projects.has(cwdNorm) && detectWorktree(cwdNorm)) {
          this.registerProject(payload.cwd);
        }
      }

      // Edit 수정 기록
      this.recordFileEdit(payload);

      // Bash 기록은 에이전트 제한과 무관하게 기록
      const specialType = SPECIAL_TOOL_TYPES[payload.tool_name];
      if (specialType === 'bash') {
        this.recordBashEntry(payload);
      }

      const agent = this.touchAgent(payload.session_id, payload.cwd);
      if (!agent) return null;
      agent.lastTool = payload.tool_name;

      // 관측 도구 기록 (AgentConfig 자동 동기화용)
      if (payload.tool_name) {
        this.recordObservedTool(payload.session_id, payload.tool_name);
      }

      // 파일 경로 없는 특수 도구 → 전용 버블
      if (specialType) {
        const result = this.processSpecialTool(agent, payload.tool_name, specialType);
        if (specialType === 'bash') {
          const cmd = typeof payload.tool_input['command'] === 'string' ? payload.tool_input['command'] : '';
          // `/runserver` 는 서버 재사용 시 foreground 로 즉시 종료될 수 있어
          // run_in_background 여부와 무관하게, **이 bash 가 귀속된 바로 그 세션**
          // (= 방금 bash 위성이 붙은 agent)에 마커→iframe 위성을 생성한다.
          // cwd 순회/전역 탐색 없음 — "bash 보고 한다" 원칙. cold-start provisional
          // 마커 레이스(마커 미존재)는 후속 라운드 — 현재는 서버 재사용/마커 존재 복구.
          if (/runserver\.mjs\b/i.test(cmd)) {
            const sessionCwd = this.sessionCwds.get(payload.session_id) ?? payload.cwd;
            const marker = readDevServerMarker(sessionCwd);
            if (marker) {
              this.createIframeSatellite(payload.session_id, cmd, marker.port, undefined, undefined, true);
              this.createIframeSatellite(payload.session_id, cmd, marker.clientPort, undefined, 'vite', true);
              // §7.11 v2.1 — foreground runserver(서버 재사용 시 즉시 종료)도 ServerEntry 등록 → ServerList 노출
              this.registerServerPort(payload.session_id, cmd, marker.port, undefined, undefined, payload.tool_use_id);
              this.registerServerPort(payload.session_id, cmd, marker.clientPort, undefined, undefined, payload.tool_use_id);
            }
          } else if (payload.tool_input?.['run_in_background'] === true) {
            // §7.11 v2.20 — probe 명령(curl/wget/nc 등)은 inline-cmd 단축 경로 skip.
            // 그 명령의 cmd 에 들어간 localhost:N 은 서버 launch 가 아니라 probe 대상이므로,
            // 그 셸이 서버처럼 등록되는 false positive 를 차단(watcher 경로도 동일 셸엔 부착되지만
            // probe 명령은 listen 소켓을 열지 않으므로 자연히 아무 포트도 안 잡힘).
            if (!isProbeCommand(cmd)) {
              const sessionCwd = this.sessionCwds.get(payload.session_id) ?? payload.cwd;
              const port = extractPort(cmd)
                ?? extractPortFromInlineEval(cmd)
                ?? extractPortFromScriptFile(cmd, sessionCwd);
              if (port) {
                this.createIframeSatellite(payload.session_id, cmd, port, undefined, undefined, true);
                // §7.11 v2.25 — iframe ↔ ServerEntry 대칭 보강: recordBashEntry 가 같은 port 를
                // 못 잡았거나(별도 추출기 구성) 다른 갈래로 누락된 경우에도 1:1 invariant 유지.
                // registerServerPort 는 같은 toolUseId 면 samePort 매치로 no-op (idempotent).
                this.registerServerPort(payload.session_id, cmd, port, undefined, undefined, payload.tool_use_id);
              }
            }
          }
        }
        return result;
      }

      let filePath = extractFilePath(payload.tool_input, payload.tool_name);
      if (!filePath) return null;

      let sessionCwd = this.sessionCwds.get(payload.session_id);
      // Grep/Glob 등이 상대 경로(`packages`)로 호출되면 cwd 기준 절대 경로로 승격.
      // 안 하면 isInternal이 false로 떨어져 `(ext) packages` 로 잘못 표시됨.
      if (!isAbsoluteNormalized(filePath)) {
        const cwdForResolve = payload.cwd ?? sessionCwd;
        if (cwdForResolve) {
          filePath = resolveRelative(cwdForResolve, filePath);
        }
      }
      // 워크트리 이주 검사 — 에이전트가 워크트리 내부 파일을 건드리면 그 워크트리로 이주
      // (부모→WT, 같은 repo면 WT A→WT B 재이주 포함, v1.76).
      // write/edit 1회 즉시, read 누적 N회. 이주 후엔 sessionCwds 가 워크트리 path 라
      // 후속 projectPath 계산이 워크트리 기준이 되어 외부(부모) 파일은 external 로 표시된다.
      if (this.maybeMigrateAgentToWorktree(payload.session_id, agent.id, filePath, payload.tool_name)) {
        sessionCwd = this.sessionCwds.get(payload.session_id);
      }
      const sessionProjectInfo = sessionCwd ? this.projects.get(normalize(sessionCwd)) ?? null : null;
      const isHomeWorktree = !!sessionProjectInfo?.parentProjectPath;

      // §5.7 #26 — 파일 경로가 미등록 워크트리 내부면 등록.
      // 부모-cwd 에이전트가 워크트리 파일 작업 시 payload.cwd 기반 등록(위 블록)만으로는
      // 워크트리 namespace/엣지가 성립하지 않으므로, 파일 경로에서 워크트리 루트를 추출해 보완 등록한다.
      try {
        const wtRootMatch = filePath.match(/^(.+?\/\.claude\/worktrees\/[^/]+)(?:\/|$)/);
        if (wtRootMatch) {
          const worktreeRoot = wtRootMatch[1]!;
          const worktreeRootNorm = normalize(worktreeRoot);
          if (
            this.root &&
            worktreeRootNorm !== normalize(this.root) &&
            !this.projects.has(worktreeRootNorm) &&
            detectWorktree(worktreeRootNorm)
          ) {
            this.registerProject(worktreeRoot);
          }
        }
      } catch (err) {
        logger.debug('worktree file-path registration skipped', err);
      }

      // 파일 라우팅의 핵심: "파일이 속한 프로젝트" 를 파일 경로 자체로 판정한다(세션 cwd 기준 ❌).
      // 그래야 마스터 cwd 에이전트가 워크트리 파일을 만져도 처음부터 워크트리 namespace 로 정확히 들어가
      // 마스터 캔버스에 `.claude/worktrees/...` 같은 잘못된 경로가 안 박힌다.
      const fileProject = this.getProjectForCwd(filePath);
      const isDirectoryPath = DIRECTORY_PATH_TOOLS.has(payload.tool_name);

      let topFolderPath: string | null;
      if (fileProject) {
        // 파일이 알려진 프로젝트(마스터 또는 워크트리) 내부.
        // 워크트리 home + 다른 프로젝트의 파일(부모 마스터 또는 다른 워크트리) → "내 워크트리에서 외부" 로 처리.
        if (isHomeWorktree && fileProject.path !== sessionProjectInfo!.path) {
          const wtKey = normalize(sessionProjectInfo!.path);
          const wtPrefix = `wt${hashString(wtKey).toString(36)}__`;
          topFolderPath = this.processExternalFile(
            filePath, payload.tool_name, agent.id, isDirectoryPath,
            wtKey, wtPrefix, sessionProjectInfo!.name,
            payload.tool_response, payload.cwd ?? sessionCwd,
          );
        } else {
          // 정상 internal 라우팅 — 파일의 owning project 기준
          // (마스터 home + 워크트리 파일이면 자동으로 워크트리 namespace 로 들어감 — processInternalFile 의 isWorktree 분기)
          topFolderPath = this.processInternalFile(
            filePath, payload.tool_name, agent.id, fileProject.path, isDirectoryPath,
          );
        }
      } else {
        // 파일이 어떤 프로젝트에도 속하지 않음 → external. 워크트리 home 이면 워크트리 children scope.
        const wtKey = isHomeWorktree ? normalize(sessionProjectInfo!.path) : null;
        const wtPrefix = wtKey ? `wt${hashString(wtKey).toString(36)}__` : '';
        const wtProjName = isHomeWorktree ? sessionProjectInfo!.name : null;
        topFolderPath = this.processExternalFile(
          filePath, payload.tool_name, agent.id, isDirectoryPath,
          wtKey, wtPrefix, wtProjName,
          payload.tool_response, payload.cwd ?? sessionCwd,
        );
      }

      if (!topFolderPath) return null;

      const topFolder = this.nodes.get(topFolderPath);
      if (!topFolder) return null;

      const edge = this.mainEdges.upsert(agent.id, agent, topFolder, payload.tool_name, agent.id);

      // 부모 캔버스 가시 엣지: 파일이 워크트리에 라우팅됐고 에이전트가 그 워크트리에
      // home 이 아니면(=마스터/부모 캔버스에서 워크트리로 작업) topFolder 는 wt-prefixed
      // 자식이라 부모 캔버스에서 숨겨져 라인이 안 뜬다. 부모 캔버스에 함께 떠 있는
      // **워크트리 버블 노드**로도 엣지를 걸어 "이 에이전트가 이 워크트리에서 작업 중"을
      // 보이게 한다(드릴다운 시 기존 파일 단위 엣지로 자연 상세화).
      // 무조건 생성 — 에이전트가 워크트리에 이주(home)했든 부모 캔버스에 남아있든,
      // 워크트리 버블은 부모 탭 스코프(nodeProjects=parent)라 어느 캔버스에서든 렌더된다.
      // 이주 케이스에 엣지를 스킵하면 부모 캔버스에서 커스텀 버블이 워크트리와 끊겨 보인다.
      // (agent 는 결코 worktree 버블 자신이 아니므로 self-edge 없음.)
      if (fileProject?.parentProjectPath) {
        const wtBubble = this.nodes.get(normalize(fileProject.path));
        if (wtBubble && wtBubble.bubbleType === 'worktree' && wtBubble.id !== agent.id) {
          this.mainEdges.upsert(agent.id, agent, wtBubble, payload.tool_name, agent.id);
        }
      }

      logger.debug(`${payload.tool_name} → ${filePath} (top: ${topFolderPath})`);
      return { agent, topFolder, edge };
    } catch (err) {
      logger.error('processHookEvent failed', err);
      return null;
    }
  }

  /** 노드에 activeAgentIds + absolutePath + fileSize + satelliteFileCount 부착한 복사본 반환 */
  private enrichNode(nodePath: string, node: BubbleData): BubbleData {
    // 노드 자체가 absolutePath 를 들고 있으면(§2.1 v1.55 외부 폴더) 그걸 우선 — resolve 폴백 null 로 덮어쓰지 않도록.
    const resolvedAbs = this.resolveAbsolutePath(nodePath);
    const absPath = node.absolutePath ?? resolvedAbs ?? undefined;
    const enriched: BubbleData = { ...node, absolutePath: absPath };

    // file 타입: 디스크 크기 부착 (2a: statSync TTL 캐시로 핫패스 디스크 I/O 절감)
    if (node.bubbleType === 'file' && absPath) {
      const now = Date.now();
      const cached = this.statCache.get(absPath);
      if (cached !== undefined) {
        // 캐시 히트 — TTL 체크
        const ttl = cached === null ? ProjectGraph.STAT_MISS_TTL : ProjectGraph.STAT_CACHE_TTL;
        if (now - (cached?.cachedAt ?? 0) < ttl) {
          if (cached !== null) enriched.fileSize = cached.size;
          // null(음성 캐시) 이면 fileSize 미설정 — 기존 동작과 동일
        } else {
          // TTL 만료 → 재조회
          try {
            const stat = fs.statSync(absPath);
            if (stat.isFile()) {
              const entry = { size: stat.size, cachedAt: now };
              this.statCache.set(absPath, entry);
              enriched.fileSize = stat.size;
            } else {
              this.statCache.delete(absPath);
            }
          } catch {
            // 파일 없음 — 음성 캐시 기록
            this.statCache.set(absPath, null);
          }
        }
      } else {
        // 캐시 미스 → 최초 조회
        try {
          const stat = fs.statSync(absPath);
          if (stat.isFile()) {
            this.statCache.set(absPath, { size: stat.size, cachedAt: now });
            enriched.fileSize = stat.size;
          }
        } catch {
          this.statCache.set(absPath, null);
        }
      }
    }

    // 폴더 타입: satelliteFileCount 를 satelliteMap 으로부터 항상 최신화
    // (§2.1 v1.55 — UI 카운트 SSOT. external_folder 는 평탄화로 satellite 만 가짐)
    if (node.bubbleType === 'external_folder' || node.bubbleType === 'internal_folder') {
      const sat = this.satelliteMap.get(nodePath);
      enriched.satelliteFileCount = sat ? sat.size : 0;
    }

    // worktree 타입: 내부에서 도는 active 에이전트를 집계해 파일 버블과 동일하게
    // status='active' + activeAgentIds 부착(SSOT §5.4 #26 활성 상태 집계, v1.71).
    // 저장 노드 status(idle)는 그대로 두고 스냅샷 파생값만 덮으므로, 내부 에이전트가
    // 모두 idle 되면 다음 enrichNode 에서 자동으로 idle 풍경으로 복귀한다.
    if (node.bubbleType === 'worktree') {
      const wtPrefix = `wt${hashString(nodePath).toString(36)}__`;
      const wtActive = new Set<string>();
      // (a) worktree namespace 로 carry 된 파일/폴더를 ref 하는 active 에이전트
      for (const [k, kRefs] of this.nodeAgentRefs) {
        if (!k.startsWith(wtPrefix)) continue;
        for (const agentId of kRefs) {
          for (const agent of this.agents.values()) {
            if (agent.id === agentId && agent.status === 'active') { wtActive.add(agentId); break; }
          }
        }
      }
      // (b) 세션 cwd 가 이 worktree 프로젝트로 해석되는 active 에이전트(파일 ref 전이라도 포함)
      const wtInfo = this.projects.get(normalize(nodePath));
      if (wtInfo) {
        const wtPathNorm = normalize(wtInfo.path);
        for (const [sessionId, cwd] of this.sessionCwds) {
          const agent = this.agents.get(sessionId);
          if (!agent || agent.status !== 'active') continue;
          const proj = this.getProjectForCwd(cwd);
          if (proj && normalize(proj.path) === wtPathNorm) wtActive.add(agent.id);
        }
      }
      if (wtActive.size > 0) {
        enriched.status = 'active';
        enriched.activeAgentIds = [...wtActive];
      }
      return enriched;
    }

    const refs = this.nodeAgentRefs.get(nodePath);
    if (!refs || refs.size === 0) return enriched;
    // active 상태 에이전트만 필터
    const activeIds: string[] = [];
    for (const agentId of refs) {
      for (const agent of this.agents.values()) {
        if (agent.id === agentId && agent.status === 'active') {
          activeIds.push(agentId);
          break;
        }
      }
    }
    if (activeIds.length > 0) enriched.activeAgentIds = activeIds;
    return enriched;
  }

  /**
   * 스냅샷 생존 필터 — §2.4: 에이전트가 엣지로 읽고/쓴 file·folder 버블 정리.
   *
   * 에이전트 완료(`setAgentStatus('completed')`) 시 `removeAgentRefs` 가 연결된
   * file/internal_folder/external_folder 버블을 `idle` 로 내리고 `lastActivity` 를 찍는다.
   * 그 후 BUBBLE_TTL(5분) 경과하면 이 필터가 false → `getSnapshot` 에서 제외 → 클라에서 사라짐.
   *
   * 제외(항상 alive):
   *  - file/internal_folder/external_folder 외 타입(agent/root/back/ghost/iframe/pipeline/
   *    worktree/bash 위성 등)은 각자 별도 라이프사이클(세션 liveness·ghost fade·
   *    bash 부모추종·상주 등)이 있어 이 TTL 정리 대상이 아니다.
   *  - 고정 버블(`preservePinned`/`pinned`, §2.4 v1.28) — 모든 소멸 경로 차단.
   *  - `active`/`completed` 노드 — 작업 중.
   *  - 다른 active 에이전트가 쓰는 중이면 `removeAgentRefs` 가 애초에 idle 로 안 내려
   *    (active 유지) 여기서 자연히 살아남는다.
   */
  private isAlive(node: BubbleData): boolean {
    if (
      node.bubbleType !== 'file' &&
      node.bubbleType !== 'internal_folder' &&
      node.bubbleType !== 'external_folder'
    ) {
      return true;
    }
    if (node.preservePinned || node.pinned) return true;
    if (node.status === 'active' || node.status === 'completed') return true;
    if (!node.lastActivity) return true;
    return Date.now() - node.lastActivity < BUBBLE_TTL;
  }

  /** 노드가 숨긴 프로젝트 소속인지 확인 */
  private isNodeHidden(nodePath: string): boolean {
    if (this.hiddenProjects.size === 0) return false;
    // root 키 → 프로젝트 이름 추출
    if (ProjectGraph.isRootKey(nodePath)) {
      const projName = ProjectGraph.projectNameFromRootKey(nodePath);
      return projName !== null && this.hiddenProjects.has(projName);
    }
    const projName = this.nodeProjectNames.get(nodePath);
    return projName !== undefined && this.hiddenProjects.has(projName);
  }

  /** 에이전트가 숨긴 프로젝트 소속인지 확인 */
  private isAgentHidden(sessionId: string): boolean {
    if (this.hiddenProjects.size === 0) return false;
    const cwd = this.sessionCwds.get(sessionId);
    if (!cwd) return false;
    const normalized = normalize(cwd);
    const proj = this.projects.get(normalized);
    return proj !== undefined && this.hiddenProjects.has(proj.name);
  }

  getSnapshot(): GraphSnapshot {
    // (2b) 스냅샷 캐시 — mutationVersion 불변 + TTL 이내이면 재계산 생략
    const nowMs = Date.now();
    if (this.snapshotCache !== null) {
      const { snapshot: cached, version, cachedAt } = this.snapshotCache;
      if (
        version === this.mutationVersion &&
        nowMs - cachedAt < ProjectGraph.SNAPSHOT_CACHE_TTL
      ) {
        return cached;
      }
    }

    // 서버에서 TTL 필터링 — 클라이언트는 그대로 렌더링
    // 숨긴 프로젝트의 노드/에이전트는 스냅샷에서 제외
    const topFolders = [...this.topLevelPaths]
      .map((p) => ({ key: p, node: this.nodes.get(p) }))
      .filter((e): e is { key: string; node: BubbleData } => e.node !== undefined && this.isAlive(e.node) && !this.isNodeHidden(e.key))
      .map((e) => this.enrichNode(e.key, e.node));

    const children: Record<string, BubbleData[]> = {};
    for (const [parentPath, childPaths] of this.childrenMap) {
      const parent = this.nodes.get(parentPath);
      if (!parent || !this.isAlive(parent)) continue;
      children[parent.id] = [...childPaths]
        .map((cp) => ({ key: cp, node: this.nodes.get(cp) }))
        .filter((e): e is { key: string; node: BubbleData } => e.node !== undefined && this.isAlive(e.node))
        .map((e) => this.enrichNode(e.key, e.node));
    }

    // 폴더 내부 엣지: 부모 ID별로 그룹핑
    const innerEdges: Record<string, ActivityEdge[]> = {};
    for (const [parentPath] of this.childrenMap) {
      const parent = this.nodes.get(parentPath);
      if (!parent) continue;
      const edges = this.innerEdges.getByGroup(parent.id);
      if (edges.length > 0) innerEdges[parent.id] = edges;
    }

    // 위성 파일 (folder ID → 최근 작업 파일 BubbleData[])
    const satellites: Record<string, BubbleData[]> = {};
    for (const [folderPath, filePaths] of this.satelliteMap) {
      const folder = this.nodes.get(folderPath);
      if (!folder || !this.isAlive(folder)) continue;
      const files: BubbleData[] = [];
      for (const fp of filePaths) {
        const node = this.nodes.get(fp);
        if (node && SATELLITE_TYPES.has(node.bubbleType) && this.isAlive(node)) {
          files.push(this.enrichNode(fp, node));
        }
      }
      if (files.length > 0) satellites[folder.id] = files;
    }

    // 에이전트 영구 위성 (bash/iframe — agent.persistSatellites에서 직접 읽기)
    // - bash: completed 단계 없음. 부모 idle일 때만 idle, 그 외(active/completed)는 active 유지.
    // - iframe: 부모 에이전트 상태와 무관하게 dev server 자체의 생사로 결정.
    //   iframeAlive === true → active, false 또는 undefined → idle.
    //   (이전 v1.29 부모 status 미러링은 사용자 작업 단계마다 위성이 같이 깜빡거리는 부작용
    //   유발 — 사용자 요청으로 제거. iframe 은 dev server 의 독립 라이프사이클 가짐.)
    for (const agent of this.agents.values()) {
      if (!agent.persistSatellites || agent.persistSatellites.length === 0) continue;
      const bubbles = agent.persistSatellites
        .filter((s) => this.isAlive(s))
        .map((s) => {
          const enriched = this.enrichNode(s.path, s);
          if (s.bubbleType === 'bash') {
            enriched.status = agent.status === 'idle' ? 'idle' : 'active';
          } else if (s.bubbleType === 'iframe') {
            enriched.status = s.iframeAlive === true ? 'active' : 'idle';
          } else {
            enriched.status = agent.status;
          }
          return enriched;
        });
      if (bubbles.length > 0) {
        const existing = satellites[agent.id];
        satellites[agent.id] = existing ? [...existing, ...bubbles] : bubbles;
      }
    }

    // completed 에이전트 중 summary 미확보 → JSONL 재시도
    this.resolveMissingSummaries();

    // 에이전트 페이즈 + 활성 수 (서버에서 계산)
    const aliveAgents = [...this.agents.entries()]
      .filter(([sessionId, a]) => this.isAlive(a) && !this.isAgentHidden(sessionId) && !a.pipelineParentId)
      .map(([, a]) => {
        // Hook 에이전트: 서브에이전트가 있으면 isParentAgent 설정
        if (a.bubbleType === 'agent' && !a.customCreated) {
          const subs = subAgentManager.getAllSubs(a.id);
          if (subs.length > 0) return { ...a, isParentAgent: true };
        }
        return a;
      });
    const activeCount = aliveAgents.filter((a) => a.status === 'active').length;
    // const agentPhase: AgentPhase = activeCount > 0 ? 'working'
    //   : aliveAgents.length > 0 ? 'completed'
    //   : 'waiting';
    const agentPhase: AgentPhase = 'working';

    // 에이전트 버블에 model/context + 토큰 사용량 주입
    const enrichedAgents = aliveAgents.map((a) => {
      // cwd 없어도 readContextInfo 는 sessionId 전역 탐색 폴백이 있어 시도한다
      // (워크트리 isolation 세션은 sessionCwds 가 부모/미등록이라 cwd 가 비거나 어긋남).
      const cwd = this.sessionCwds.get(a.path) ?? '';
      const ctx = readContextInfo(cwd, a.path);

      const ownIn = ctx?.cumulativeInputTokens ?? 0;
      const ownOut = ctx?.cumulativeOutputTokens ?? 0;

      // 서브에이전트 토큰 합산 + 최근 활동 sub 탐색.
      // 커스텀 에이전트는 자체 Claude 세션이 없으므로 "마지막으로 사용한 sub" 기준으로 context/model 표시.
      // (일반 에이전트도 ctx 가 비면 동일 경로로 sub fallback — 기존 동작과 호환)
      const subs = subAgentManager.getAllSubs(a.id);
      let subIn = 0;
      let subOut = 0;
      let latestSub: SubAgent | null = null;
      for (const s of subs) {
        subIn += s.totalInputTokens ?? 0;
        subOut += s.totalOutputTokens ?? 0;
        if (!s.sessionId) continue;
        if (!latestSub || s.lastActivityAt > latestSub.lastActivityAt) {
          latestSub = s;
        }
      }
      const subCtx: AgentContextInfo | null =
        latestSub ? readContextInfo(cwd, latestSub.sessionId) : null;

      // 커스텀 에이전트는 subCtx 우선(= 마지막 sub 기준). 그 외는 자체 세션 정보 우선.
      const preferSub = Boolean(a.customCreated);
      const modelName = preferSub
        ? (subCtx?.modelName ?? latestSub?.modelName ?? ctx?.modelName)
        : (ctx?.modelName ?? subCtx?.modelName ?? latestSub?.modelName);
      const contextUsed = preferSub
        ? (subCtx?.contextUsed ?? ctx?.contextUsed)
        : (ctx?.contextUsed ?? subCtx?.contextUsed);
      const contextMax = preferSub
        ? (subCtx?.contextMax ?? ctx?.contextMax)
        : (ctx?.contextMax ?? subCtx?.contextMax);
      // 커스텀일 때만, 그리고 sub 쪽 데이터가 실제로 쓰였을 때만 sub 라벨 첨부.
      const contextSourceSubLabel = preferSub && latestSub && (subCtx?.modelName || latestSub.modelName)
        ? latestSub.label
        : undefined;

      const totalIn = ownIn + subIn;
      const totalOut = ownOut + subOut;

      // 어떤 토큰 정보도 없으면 기본값만 반환
      if (!modelName && totalIn === 0) return { ...a };

      return {
        ...a,
        modelName,
        contextUsed,
        contextMax,
        ownInputTokens: ownIn,
        ownOutputTokens: ownOut,
        totalInputTokens: totalIn,
        totalOutputTokens: totalOut,
        ...(contextSourceSubLabel ? { contextSourceSubLabel } : {}),
      };
    });

    // 실제 에이전트 정보 → AgentConfig 자동 동기화
    this.syncDetectedAgentConfigs(enrichedAgents);

    // 숨긴 프로젝트는 탭바에서 제외. worktree 프로젝트는 부모 안으로 흡수되므로 탭 노출 금지.
    const visibleProjects: Record<string, ProjectInfo> = {};
    for (const info of this.projects.values()) {
      if (this.hiddenProjects.has(info.name)) continue;
      if (info.parentProjectPath) continue; // worktree — 부모 탭 안에서만 보임
      visibleProjects[info.name] = info;
    }

    const snapshot: GraphSnapshot = {
      projects: visibleProjects,
      agents: enrichedAgents,
      topFolders,
      children,
      edges: this.mainEdges.getAll(),
      innerEdges,
      satellites,
      bashHistory: this.buildBashHistoryRecord(),
      runningServers: this.buildRunningServersRecord(),
      agentEvents: this.buildAgentEvents(),
      agentProjects: this.buildAgentProjects(),
      nodeProjects: this.buildNodeProjects(),
      fileEdits: this.buildFileEditsRecord(),
      commandQueues: this.buildCommandQueuesRecord(),
      completedCommands: this.buildCompletedCommandsRecord(),
      // subAgents 스냅샷에 contextUsed/contextMax 주입 — 클라이언트가 IDE에서 선택한 sub로
      // 커스텀 에이전트 버블 게이지를 전환할 때 필요. (서버는 부모 cwd + sub.sessionId 만 알면 JSONL 읽기 가능.)
      subAgents: (() => {
        const raw = subAgentManager.getSnapshot();
        const out: Record<string, SubAgent[]> = {};
        // 이 인스턴스가 "소유한" agentId 와 해당 cwd 를 먼저 구축.
        // 다른 인스턴스의 agent 는 여기서 건드리지 않는다 — graphManager.mergeSnapshots 에서
        // 각 인스턴스가 자기 것만 출력하면 enrich 된 sub 가 덮어써지지 않는다.
        // (이전엔 이 인스턴스가 해당 agent 를 모를 때 sub 를 그대로 내보내서,
        //  실제 소유 인스턴스의 enriched sub 를 덮어쓰는 타이밍이 있었다.)
        const ownedAgentCwd = new Map<string, string>();
        for (const [sid, ag] of this.agents) {
          const cwd = this.sessionCwds.get(sid);
          if (cwd) ownedAgentCwd.set(ag.id, cwd);
        }
        for (const [agentId, subs] of Object.entries(raw)) {
          const cwd = ownedAgentCwd.get(agentId);
          if (!cwd) continue; // 다른 인스턴스 소유 — 여기선 출력하지 않음
          out[agentId] = subs.map((s) => {
            if (!s.sessionId) return s;
            const info = readContextInfo(cwd, s.sessionId);
            if (!info) return s;
            return {
              ...s,
              contextUsed: info.contextUsed,
              contextMax: info.contextMax,
              modelName: s.modelName ?? info.modelName,
            };
          });
        }
        return out;
      })(),
      agentPhase,
      activeAgentCount: activeCount,
      satellitePositions: Object.fromEntries(this.satellitePositions),
      pipelineChildren: pipelineManager.getChildrenSnapshot(),
      pipelines: pipelineManager.getPipelinesSnapshot(),
      agentConfigs: this.getAgentConfigsSnapshot(),
      taskEdges: this.getTaskEdgesSnapshot(),
      // sessionSources/Statuses는 Manager 레벨에서 sessionLifecycle이 주입
      sessionSources: {},
      sessionStatuses: {},
      worktreeProjects: this.buildWorktreeProjectsRecord(),
      uiLocale: this.uiLocale,
      commentBoxes: this.getCommentBoxes(),
      layoutBoundsByProject: this.layoutBoundsByProject.size > 0
        ? Object.fromEntries(this.layoutBoundsByProject)
        : undefined,
      contis: this.contis.size > 0 ? this.getContisRecord() : undefined,
      activeContiWork: this.activeContiWork.size > 0 ? this.getActiveContiWorkRecord() : undefined,
      recentToolDurations: this.recentToolDurations.size > 0 ? this.getRecentToolDurations() : undefined,
      compactCounts: this.compactCounts.size > 0 ? this.getCompactCounts() : undefined,
      skillUsageCounts: this.getSkillUsageCountsRecord(),
      autoAgentSummaries: this.autoAgentSummaries.size > 0 ? this.getAutoAgentSummaries() : undefined,
      agentReports: this.getAgentReportsRecord(),
      agentQuestions: this.getAgentQuestionsRecord(),
      agentReviews: this.getAgentReviewsRecord(),
      agentLists: this.getAgentListsRecord(),
    };

    // (2b) 계산 결과를 캐시에 저장
    this.snapshotCache = { snapshot, version: this.mutationVersion, cachedAt: nowMs };
    return snapshot;
  }

  getUiLocale(): UiLocale {
    return this.uiLocale;
  }

  setUiLocale(locale: UiLocale): boolean {
    if (this.uiLocale === locale) return false;
    this.uiLocale = locale;
    return true;
  }

  /** 루트 캔버스 바운딩 박스 — projectName 키로 저장. 변경되면 true 반환(체크포인트 dirty). */
  setLayoutBounds(projectName: string, hw: number, hh: number): boolean {
    const cur = this.layoutBoundsByProject.get(projectName);
    if (cur && cur.hw === hw && cur.hh === hh) return false;
    this.layoutBoundsByProject.set(projectName, { hw, hh });
    return true;
  }


  /** worktree 버블 ID → worktree 프로젝트명 매핑. 드릴다운 시 클라이언트 에이전트 필터 전환용. */
  private buildWorktreeProjectsRecord(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const info of this.projects.values()) {
      if (!info.parentProjectPath) continue;
      const wtKey = normalize(info.path);
      const node = this.nodes.get(wtKey);
      if (node) result[node.id] = info.name;
    }
    return result;
  }

  /** v2 체크포인트 직렬화 (Record 기반 깔끔한 포맷) */
  toCheckpoint(): ProjectCheckpoint {
    const project = this.getPrimaryProject() ?? { name: 'unknown', path: '' };

    const agents: Record<string, BubbleData> = {};
    for (const [k, v] of this.agents) agents[k] = v;
    const nodes: Record<string, BubbleData> = {};
    for (const [k, v] of this.nodes) nodes[k] = v;
    const projects: Record<string, ProjectInfo> = {};
    for (const [k, v] of this.projects) projects[k] = v;

    const childrenMap: Record<string, string[]> = {};
    for (const [k, v] of this.childrenMap) childrenMap[k] = [...v];
    const satelliteMap: Record<string, string[]> = {};
    for (const [k, v] of this.satelliteMap) satelliteMap[k] = [...v];
    // agentSpecialPaths 제거 — bash/iframe은 agent.persistSatellites에 직접 포함
    const nodeAgentRefs: Record<string, string[]> = {};
    for (const [k, v] of this.nodeAgentRefs) nodeAgentRefs[k] = [...v];
    const sessionCwds: Record<string, string> = {};
    for (const [k, v] of this.sessionCwds) sessionCwds[k] = v;
    const nodeProjectRoots: Record<string, string> = {};
    for (const [k, v] of this.nodeProjectNames) nodeProjectRoots[k] = v;

    const bashHistory: Record<string, BashEntry[]> = {};
    for (const [k, v] of this.bashHistory) bashHistory[k] = v;
    const runningServers: Record<string, ServerEntry[]> = {};
    for (const [k, v] of this.runningServers) runningServers[k] = v;
    const fileEdits: Record<string, FileEdit[]> = {};
    for (const [k, v] of this.fileEdits) fileEdits[k] = v;

    return {
      version: 1,
      project,
      seq: this.seq,
      savedAt: Date.now(),

      graph: {
        agentCounter: this.agentCounter,
        agents,
        nodes,
        projects,
        hierarchy: {
          topLevelPaths: [...this.topLevelPaths],
          childrenMap,
          satelliteMap,
        },
        refs: {
          nodeAgentRefs,
          sessionCwds,
          nodeProjectRoots,
        },
      },

      activity: {
        bashHistory,
        runningServers,
        fileEdits,
      },

      edges: {
        main: this.mainEdges.toSnapshot(),
        inner: this.innerEdges.toSnapshot(),
      },

      subAgents: subAgentManager.getSnapshot(),
      archivedSubAgents: (() => {
        const snap = subAgentManager.getArchiveSnapshot();
        return Object.keys(snap).length > 0 ? snap : undefined;
      })(),
      subAgentCounter: subAgentManager.getCounter(),
      customLabels: Object.fromEntries(this.customLabels),
      commandQueues: this.serializeCommandQueues(),
      completedCommands: this.serializeCompletedCommands(),
      hiddenProjects: this.hiddenProjects.size > 0 ? [...this.hiddenProjects] : undefined,
      pipelines: pipelineManager.getPipelinesSnapshot(),
      agentConfigs: this.agentConfigs.size > 0 ? Object.fromEntries(this.agentConfigs) : undefined,
      observedTools: this.observedTools.size > 0
        ? Object.fromEntries([...this.observedTools].map(([k, v]) => [k, [...v]]))
        : undefined,
      manuallyConfigured: this.manuallyConfigured.size > 0 ? [...this.manuallyConfigured] : undefined,
      taskEdges: this.taskEdges.size > 0 ? Object.fromEntries(this.taskEdges) : undefined,
      dismissedIframes: this.dismissedIframes.size > 0
        ? Object.fromEntries([...this.dismissedIframes].map(([k, v]) => [k, [...v]]))
        : undefined,
      uiLocale: this.uiLocale,
      commentBoxes: this.commentBoxes.size > 0 ? [...this.commentBoxes.values()] : undefined,
      layoutBoundsHalfWidth: this.layoutBoundsByProject.get(project.name)?.hw,
      layoutBoundsHalfHeight: this.layoutBoundsByProject.get(project.name)?.hh,
      contis: this.contis.size > 0 ? this.getContisRecord() : undefined,
      compactCounts: this.compactCounts.size > 0 ? this.getCompactCounts() : undefined,
      skillUsageCounts: this.getSkillUsageCountsFlat(),
      autoAgentSummaries: this.autoAgentSummaries.size > 0 ? this.getAutoAgentSummaries() : undefined,
      agentReports: this.getAgentReportsRecord(),
      agentQuestions: this.getAgentQuestionsRecord(),
      agentReviews: this.getAgentReviewsRecord(),
      agentLists: this.getAgentListsRecord(),
    };
  }

  /** 명령 큐/아카이브 키(sessionId) → 소유 agentId 해석.
   *  직접 세션이면 그 agent. 아니면 서브에이전트(워크트리 isolation / agent-view 포함)의
   *  sessionId·agentViewSessionId 매칭으로 부모 커스텀 에이전트에 귀속한다 —
   *  processHookEvent(서브세션→부모 리라이트)와 동일한 robust 매핑. 이게 없으면
   *  워크트리/agent-view 세션 키로 쌓인 result 가 `this.agents.get` 실패로 통째 누락된다
   *  (DetailPanel "Prompts (0)" 의 직접 원인). */
  private resolveCommandOwnerAgentId(sessionId: string): string | null {
    const direct = this.agents.get(sessionId);
    if (direct) return direct.id;
    const sub = subAgentManager.getAllSubsFlat().find(
      (s) => s.sessionId === sessionId || s.agentViewSessionId === sessionId,
    );
    return sub?.parentAgentId ?? null;
  }

  /** completedCommandArchive → agentId 기반 Record (GraphSnapshot용) */
  private buildCompletedCommandsRecord(): Record<string, QueuedCommand[]> {
    const result: Record<string, QueuedCommand[]> = {};
    for (const [sessionId, cmds] of this.completedCommandArchiveRef) {
      if (cmds.length === 0) continue;
      const agentId = this.resolveCommandOwnerAgentId(sessionId);
      if (!agentId) continue;
      // 같은 부모로 매핑되는 키가 여럿일 수 있어 누적(덮어쓰기 ❌).
      result[agentId] = result[agentId] ? [...result[agentId], ...cmds] : [...cmds];
    }
    return result;
  }

  /** commandQueues 직렬화 (sessionId → QueuedCommand[], 비어있는 건 제외) */
  private serializeCommandQueues(): Record<string, QueuedCommand[]> {
    const result: Record<string, QueuedCommand[]> = {};
    for (const [sessionId, cmds] of this.commandQueuesRef) {
      if (cmds.length > 0) result[sessionId] = [...cmds];
    }
    return result;
  }

  /** completedCommandArchive 직렬화 (sessionId → QueuedCommand[], 비어있는 건 제외) */
  private serializeCompletedCommands(): Record<string, QueuedCommand[]> | undefined {
    const result: Record<string, QueuedCommand[]> = {};
    let hasAny = false;
    for (const [sessionId, cmds] of this.completedCommandArchiveRef) {
      if (cmds.length > 0) { result[sessionId] = [...cmds]; hasAny = true; }
    }
    return hasAny ? result : undefined;
  }

  // ─── 프로젝트별 필터링 헬퍼 ───

  /** 프로젝트에 속하는 세션 ID 집합 */
  /** ProjectInfo → "탭 프로젝트명". 워크트리는 부모 탭에 흡수되므로(§3.5, line 1960)
   *  parentProjectPath 체인을 따라 최상위 non-worktree 조상의 name 으로 접는다. */
  private resolveTabProjectName(proj: ProjectInfo | null, fallbackCwd: string): string {
    let cur = proj;
    const seen = new Set<string>();
    while (cur?.parentProjectPath && !seen.has(cur.path)) {
      seen.add(cur.path);
      const parent = this.projects.get(normalize(cur.parentProjectPath));
      if (!parent) break;
      cur = parent;
    }
    return cur?.name ?? path.basename(fallbackCwd);
  }

  private getProjectSessionIds(projectName: string): Set<string> {
    const result = new Set<string>();
    for (const [sessionId, cwd] of this.sessionCwds) {
      // 세션 cwd 가 워크트리여도 그 세션의 대화/명령/결과는 부모 탭에 귀속시킨다.
      // 안 그러면 워크트리 이주 세션의 completedCommands 가 부모 체크포인트에서 빠지고
      // (휘발성) 워크트리 체크포인트로만 남아 워크트리 정리 시 통째 소실된다.
      // (node/file 스코프는 getProjectNodePaths 가 워크트리별로 별도 유지 — 별개 축.)
      const proj = this.getProjectForCwd(cwd);
      const name = this.resolveTabProjectName(proj, cwd);
      if (name === projectName) result.add(sessionId);
    }
    // v2.62 — 안전망: customCreated 에이전트인데 sessionCwds 에 cwd 매핑이 아예 없는
    // (등록 누락/구버전 체크포인트) 경우, primary 프로젝트 탭에 귀속시켜 저장 필터에서
    // 탈락하지 않게 한다. cwd 가 있는 세션은 위 워크트리-귀속 규칙 그대로(중복 add 무해).
    // 이미 다른 프로젝트로 귀속된 세션은 건드리지 않는다(sessionCwds.has 가드).
    if (projectName === this.getPrimaryProjectName()) {
      for (const [sessionId, agent] of this.agents) {
        if (agent.customCreated && !this.sessionCwds.has(sessionId)) {
          result.add(sessionId);
        }
      }
    }
    return result;
  }

  /** 프로젝트에 속하는 노드 경로 집합 */
  /** 이 탭(projectName)에 흡수되는 프로젝트명 집합 = 자기 자신 + 모든 자식 워크트리.
   *  워크트리는 부모 탭에 흡수되므로(§3.5) 체크포인트도 부모 탭에 self-contained 로 저장돼야
   *  서버 재시작 후 "에이전트가 워크트리 안에 있던" 상태가 복원된다. (isolation 워크트리는
   *  repo 밖이라 discoverProjectMetas 가 독립 발견 못 함 → 부모 체크포인트가 유일 소스.) */
  private projectNamesForTab(tabName: string): Set<string> {
    const names = new Set<string>([tabName]);
    for (const info of this.projects.values()) {
      if (this.resolveTabProjectName(info, info.path) === tabName) names.add(info.name);
    }
    return names;
  }

  private getProjectNodePaths(projectName: string): Set<string> {
    const result = new Set<string>();
    const tabNames = this.projectNamesForTab(projectName);
    for (const [nodePath, name] of this.nodeProjectNames) {
      if (tabNames.has(name)) result.add(nodePath);
    }
    // 프로젝트 루트 키도 포함
    const rootKey = ProjectGraph.rootKeyFor(projectName);
    if (this.nodes.has(rootKey)) result.add(rootKey);
    return result;
  }

  /** 프로젝트에 속하는 버블 ID 집합 (에이전트 + 노드) */
  private getProjectBubbleIds(
    projectSessions: Set<string>,
    projectNodePaths: Set<string>,
  ): Set<string> {
    const result = new Set<string>();
    for (const [sessionId, agent] of this.agents) {
      if (projectSessions.has(sessionId)) {
        result.add(agent.id);
        // 에이전트 영구 위성(bash/iframe)도 포함 — 위성 위치 필터링에 필요
        for (const sat of agent.persistSatellites ?? []) {
          result.add(sat.id);
        }
      }
    }
    for (const nodePath of projectNodePaths) {
      const node = this.nodes.get(nodePath);
      if (node) result.add(node.id);
    }
    return result;
  }

  /** EdgeSnapshot에서 허용된 버블 ID만 포함하는 필터링된 스냅샷 생성 */
  private filterEdgeSnapshot(snapshot: EdgeSnapshot, allowedIds: Set<string>): EdgeSnapshot {
    const edges: Record<string, ActivityEdge> = {};
    const groups: Record<string, string> = {};
    const refs: Record<string, string[]> = {};

    for (const [edgeId, edge] of Object.entries(snapshot.edges)) {
      if (allowedIds.has(edge.source) && allowedIds.has(edge.target)) {
        edges[edgeId] = edge;
        const group = snapshot.groups[edgeId];
        if (group !== undefined) groups[edgeId] = group;
        const refList = snapshot.refs[edgeId];
        if (refList) refs[edgeId] = refList.filter((id) => allowedIds.has(id));
      }
    }

    return { edges, groups, refs };
  }

  /** 프로젝트별 필터링된 체크포인트 생성 — 해당 프로젝트 데이터만 포함 */
  toProjectCheckpoint(projectName: string): ProjectCheckpoint {
    const project = this.getProjectByName(projectName) ?? { name: projectName, path: '' };
    const projectSessions = this.getProjectSessionIds(projectName);
    const projectNodePaths = this.getProjectNodePaths(projectName);
    const projectBubbleIds = this.getProjectBubbleIds(projectSessions, projectNodePaths);

    // 에이전트 필터
    const agents: Record<string, BubbleData> = {};
    for (const [sessionId, agent] of this.agents) {
      if (projectSessions.has(sessionId)) agents[sessionId] = agent;
    }

    // 노드 필터
    const nodes: Record<string, BubbleData> = {};
    for (const nodePath of projectNodePaths) {
      const node = this.nodes.get(nodePath);
      if (node) nodes[nodePath] = node;
    }

    // 프로젝트 정보 — 이 탭 + 흡수되는 자식 워크트리 ProjectInfo 까지 함께 저장.
    // 워크트리 ProjectInfo(parentProjectPath 포함)가 부모 체크포인트에 있어야
    // 재시작 후 getProjectForCwd(워크트리경로)가 해석돼 에이전트가 워크트리 안에 남는다.
    const projects: Record<string, ProjectInfo> = {};
    for (const [k, v] of this.projects) {
      if (this.resolveTabProjectName(v, v.path) === projectName) projects[k] = v;
    }

    // 계층 구조 필터
    const topLevelPaths = [...this.topLevelPaths].filter((p) => projectNodePaths.has(p));

    const childrenMap: Record<string, string[]> = {};
    for (const [parent, children] of this.childrenMap) {
      if (projectNodePaths.has(parent)) {
        const filtered = [...children].filter((c) => projectNodePaths.has(c));
        if (filtered.length > 0) childrenMap[parent] = filtered;
      }
    }

    const satelliteMap: Record<string, string[]> = {};
    for (const [folder, files] of this.satelliteMap) {
      if (projectNodePaths.has(folder)) {
        const filtered = [...files].filter((f) => projectNodePaths.has(f));
        if (filtered.length > 0) satelliteMap[folder] = filtered;
      }
    }

    // 참조 필터
    const nodeAgentRefs: Record<string, string[]> = {};
    for (const [nodePath, agentIds] of this.nodeAgentRefs) {
      if (projectNodePaths.has(nodePath)) {
        nodeAgentRefs[nodePath] = [...agentIds];
      }
    }

    const sessionCwds: Record<string, string> = {};
    for (const [sessionId, cwd] of this.sessionCwds) {
      if (projectSessions.has(sessionId)) sessionCwds[sessionId] = cwd;
    }

    const nodeProjectRoots: Record<string, string> = {};
    for (const nodePath of projectNodePaths) {
      const name = this.nodeProjectNames.get(nodePath);
      if (name) nodeProjectRoots[nodePath] = name;
    }

    // 활동 데이터 필터
    const bashHistory: Record<string, BashEntry[]> = {};
    for (const [sessionId, entries] of this.bashHistory) {
      if (projectSessions.has(sessionId)) bashHistory[sessionId] = entries;
    }

    const runningServers: Record<string, ServerEntry[]> = {};
    for (const [sessionId, entries] of this.runningServers) {
      if (projectSessions.has(sessionId)) runningServers[sessionId] = entries;
    }

    const fileEdits: Record<string, FileEdit[]> = {};
    for (const [filePath, edits] of this.fileEdits) {
      if (projectNodePaths.has(filePath)) fileEdits[filePath] = edits;
    }

    // 엣지 필터
    const mainSnapshot = this.filterEdgeSnapshot(this.mainEdges.toSnapshot(), projectBubbleIds);
    const innerSnapshot = this.filterEdgeSnapshot(this.innerEdges.toSnapshot(), projectBubbleIds);

    // SubAgent 필터
    const allSubAgents = subAgentManager.getSnapshot();
    const filteredSubAgents: Record<string, import('@vibisual/shared').SubAgent[]> = {};
    for (const [agentId, subs] of Object.entries(allSubAgents)) {
      if (projectBubbleIds.has(agentId)) filteredSubAgents[agentId] = subs;
    }
    const allArchivedSubs = subAgentManager.getArchiveSnapshot();
    const filteredArchivedSubs: Record<string, import('@vibisual/shared').SubAgent[]> = {};
    for (const [agentId, subs] of Object.entries(allArchivedSubs)) {
      if (projectBubbleIds.has(agentId)) filteredArchivedSubs[agentId] = subs;
    }

    // customLabels 필터
    const customLabels: Record<string, string> = {};
    for (const [agentId, label] of this.customLabels) {
      if (projectBubbleIds.has(agentId)) customLabels[agentId] = label;
    }

    // commandQueues 필터
    const commandQueues: Record<string, QueuedCommand[]> = {};
    for (const [sessionId, cmds] of this.commandQueuesRef) {
      if (projectSessions.has(sessionId) && cmds.length > 0) {
        commandQueues[sessionId] = [...cmds];
      }
    }

    // completedCommands archive 필터 — 이 프로젝트에 속한 세션의 완료 이력만
    const completedCommands: Record<string, QueuedCommand[]> = {};
    for (const [sessionId, cmds] of this.completedCommandArchiveRef) {
      if (projectSessions.has(sessionId) && cmds.length > 0) {
        completedCommands[sessionId] = [...cmds];
      }
    }

    // agentConfigs 필터
    const filteredAgentConfigs: Record<string, AgentConfig> = {};
    for (const [agentId, config] of this.agentConfigs) {
      if (projectBubbleIds.has(agentId)) filteredAgentConfigs[agentId] = config;
    }

    // taskEdges 필터 (v1.85) — projectId 보유 엣지는 그 값으로 스코프(엔드포인트 에이전트가
    // 만료·소멸해도 보존). legacy(projectId 미설정) 엣지만 기존 양끝-생존 기준 폴백.
    const filteredTaskEdges: Record<string, TaskEdge> = {};
    for (const [id, edge] of this.taskEdges) {
      const belongs = edge.projectId !== undefined
        ? edge.projectId === projectName
        : projectBubbleIds.has(edge.sourceAgentId) && projectBubbleIds.has(edge.targetAgentId);
      if (belongs) filteredTaskEdges[id] = edge;
    }

    return {
      version: 1,
      project,
      seq: this.seq,
      savedAt: Date.now(),

      graph: {
        agentCounter: this.agentCounter,
        agents,
        nodes,
        projects,
        hierarchy: { topLevelPaths, childrenMap, satelliteMap },
        refs: { nodeAgentRefs, sessionCwds, nodeProjectRoots },
      },

      activity: { bashHistory, runningServers, fileEdits },

      edges: { main: mainSnapshot, inner: innerSnapshot },

      subAgents: Object.keys(filteredSubAgents).length > 0 ? filteredSubAgents : undefined,
      archivedSubAgents: Object.keys(filteredArchivedSubs).length > 0 ? filteredArchivedSubs : undefined,
      subAgentCounter: subAgentManager.getCounter(),
      customLabels: Object.keys(customLabels).length > 0 ? customLabels : undefined,
      commandQueues: Object.keys(commandQueues).length > 0 ? commandQueues : undefined,
      completedCommands: Object.keys(completedCommands).length > 0 ? completedCommands : undefined,
      agentConfigs: Object.keys(filteredAgentConfigs).length > 0 ? filteredAgentConfigs : undefined,
      taskEdges: Object.keys(filteredTaskEdges).length > 0 ? filteredTaskEdges : undefined,
      observedTools: this.observedTools.size > 0
        ? Object.fromEntries(
            [...this.observedTools]
              .filter(([sid]) => projectSessions.has(sid))
              .map(([k, v]) => [k, [...v]])
          )
        : undefined,
      manuallyConfigured: this.manuallyConfigured.size > 0
        ? [...this.manuallyConfigured].filter((id) => projectBubbleIds.has(id))
        : undefined,
      dismissedIframes: this.dismissedIframes.size > 0
        ? Object.fromEntries(
            [...this.dismissedIframes]
              .filter(([sid]) => projectSessions.has(sid))
              .map(([k, v]) => [k, [...v]])
          )
        : undefined,
      // v1.6: dormant 에이전트 스냅샷 — cwd가 이 프로젝트 루트 하위면 포함
      dormantAgents: this.dormantAgents.size > 0
        ? Object.fromEntries(
            [...this.dormantAgents].filter(([, d]) => {
              if (!this.root) return true;
              return normalize(d.cwd).startsWith(normalize(this.root));
            }),
          )
        : undefined,
      // 인스턴스 전역 상태 — 프로젝트 필터와 무관하게 그대로 저장.
      // 누락 시 DELETE /api/projects 로 숨긴 탭이 재시작 후 부활하는 등 영속성 버그 발생.
      hiddenProjects: this.hiddenProjects.size > 0 ? [...this.hiddenProjects] : undefined,
      pipelines: pipelineManager.getPipelinesSnapshot(),
      uiLocale: this.uiLocale,
      // v1.45 — Comment Box 필터: 이 프로젝트 소속만
      commentBoxes: (() => {
        const boxes = [...this.commentBoxes.values()].filter((b) => b.projectName === project.name);
        return boxes.length > 0 ? boxes : undefined;
      })(),
      layoutBoundsHalfWidth: this.layoutBoundsByProject.get(project.name)?.hw,
      layoutBoundsHalfHeight: this.layoutBoundsByProject.get(project.name)?.hh,
      // §5.3 #28 v1.47 — 콘티: 이 프로젝트 에이전트 소유분만 필터.
      // (v1.47 도입 시 직렬화 누락 → v1.59 hotfix. 미설정 체크포인트는 빈 contis 로 복원.)
      contis: (() => {
        const out: Record<string, Conti> = {};
        for (const [cid, c] of this.contis) {
          if (projectBubbleIds.has(c.agentId)) out[cid] = c;
        }
        return Object.keys(out).length > 0 ? out : undefined;
      })(),
      // §4 v2.52/v2.55 — 작업 신고: 이 프로젝트 소속 에이전트(버블 id)분만 필터해 영속.
      //   (v2.52 도입 시 getSnapshot/toCheckpoint 에만 넣고 정작 디스크 포맷인 toProjectCheckpoint 에
      //    빠뜨려, 껐다 켜면 신고 카드가 사라지던 버그 → v2.55 hotfix. contis 누락(v1.59)과 동형.)
      agentReports: (() => {
        const out: Record<string, AgentReport[]> = {};
        for (const [agentId, reports] of this.agentReports) {
          if (projectBubbleIds.has(agentId) && reports.length > 0) out[agentId] = [...reports];
        }
        return Object.keys(out).length > 0 ? out : undefined;
      })(),
      // §4 v2.60 — 질문 카드: 이 프로젝트 소속 에이전트(버블 id)분만 필터해 영속(agentReports 와 동형).
      agentQuestions: (() => {
        const out: Record<string, AgentQuestions[]> = {};
        for (const [agentId, qs] of this.agentQuestions) {
          if (projectBubbleIds.has(agentId) && qs.length > 0) out[agentId] = [...qs];
        }
        return Object.keys(out).length > 0 ? out : undefined;
      })(),
      // §4 v2.70 — 검수 요청 카드: 이 프로젝트 소속 에이전트(버블 id)분만 필터해 영속(agentReports 와 동형).
      //   (v2.55 영속화 함정 사전 반영 — 디스크 포맷인 toProjectCheckpoint 에 반드시 포함.)
      agentReviews: (() => {
        const out: Record<string, AgentReview[]> = {};
        for (const [agentId, reviews] of this.agentReviews) {
          if (projectBubbleIds.has(agentId) && reviews.length > 0) out[agentId] = [...reviews];
        }
        return Object.keys(out).length > 0 ? out : undefined;
      })(),
      // §4 v2.84 — 번호 목록 정렬 카드: 이 프로젝트 소속 에이전트(버블 id)분만 필터해 영속(agentReviews 와 동형).
      agentLists: (() => {
        const out: Record<string, AgentList[]> = {};
        for (const [agentId, lists] of this.agentLists) {
          if (projectBubbleIds.has(agentId) && lists.length > 0) out[agentId] = [...lists];
        }
        return Object.keys(out).length > 0 ? out : undefined;
      })(),
      // §3.2.1-3 v2.63 — 명시 삭제된 커스텀 에이전트 묘비. 이미 삭제돼 세션이 없으므로
      //   프로젝트 필터를 걸 키가 없다 → 전체 묘비를 그대로 싣는다(다른 프로젝트 sessionId 가
      //   섞여도 그 프로젝트엔 해당 세션이 존재하지 않아 무해, 부활 차단에만 쓰임).
      deletedCustomAgentIds: this.deletedCustomAgents.size > 0
        ? [...this.deletedCustomAgents]
        : undefined,
    };
  }

  /** 프로젝트별 체크포인트를 기존 상태에 병합 (복원 시 여러 프로젝트 합치기) */
  mergeFromCheckpoint(cp: ProjectCheckpoint): void {
    this.bumpMutationVersion();
    // 카운터: 최대값 유지
    this.agentCounter = Math.max(this.agentCounter, cp.graph.agentCounter);
    this.seq = Math.max(this.seq, cp.seq);

    // root가 없으면 설정
    if (!this.root) this.root = normalize(cp.project.path);

    // 에이전트 병합
    for (const [k, v] of Object.entries(cp.graph.agents)) {
      if (!this.agents.has(k)) this.agents.set(k, v);
    }

    // 노드 병합
    for (const [k, v] of Object.entries(cp.graph.nodes)) {
      if (!this.nodes.has(k)) this.nodes.set(k, v);
    }

    // 프로젝트 병합
    for (const [k, v] of Object.entries(cp.graph.projects)) {
      if (!this.projects.has(k)) this.projects.set(k, v);
    }

    // 계층 병합
    for (const p of cp.graph.hierarchy.topLevelPaths) {
      this.topLevelPaths.add(p);
    }
    for (const [k, v] of Object.entries(cp.graph.hierarchy.childrenMap)) {
      const existing = this.childrenMap.get(k);
      if (existing) { for (const c of v) existing.add(c); }
      else this.childrenMap.set(k, new Set(v));
    }
    for (const [k, v] of Object.entries(cp.graph.hierarchy.satelliteMap)) {
      if (ProjectGraph.isRootKey(k)) continue;
      const existing = this.satelliteMap.get(k);
      if (existing) { for (const f of v) existing.add(f); }
      else this.satelliteMap.set(k, new Set(v));
    }

    // 참조 병합 (agentSpecialPaths는 agent.persistSatellites로 이동 — 스킵)
    for (const [k, v] of Object.entries(cp.graph.refs.nodeAgentRefs)) {
      const existing = this.nodeAgentRefs.get(k);
      if (existing) { for (const id of v) existing.add(id); }
      else this.nodeAgentRefs.set(k, new Set(v));
    }
    for (const [k, v] of Object.entries(cp.graph.refs.sessionCwds)) {
      if (!this.sessionCwds.has(k)) this.sessionCwds.set(k, v);
    }
    for (const [k, v] of Object.entries(cp.graph.refs.nodeProjectRoots ?? {})) {
      if (!this.nodeProjectNames.has(k)) this.nodeProjectNames.set(k, v);
    }

    // 활동 데이터 병합
    for (const [k, v] of Object.entries(cp.activity.bashHistory)) {
      if (!this.bashHistory.has(k)) {
        this.bashHistory.set(k, v);
        for (const entry of v) this.bashEntryIndex.set(entry.id, entry);
      }
    }
    for (const [k, v] of Object.entries(cp.activity.runningServers)) {
      if (!this.runningServers.has(k)) this.runningServers.set(k, v);
    }
    for (const [k, v] of Object.entries(cp.activity.fileEdits)) {
      if (!this.fileEdits.has(k)) {
        this.fileEdits.set(k, v);
        for (const e of v) this.fileEditSeen.add(e.id);
      }
    }

    // v1.6: dormant 에이전트 병합
    if (cp.dormantAgents) {
      for (const [k, v] of Object.entries(cp.dormantAgents)) {
        if (!this.dormantAgents.has(k) && !this.agents.has(k)) {
          this.dormantAgents.set(k, v);
        }
      }
    }

    // 엣지 병합
    this.mainEdges.mergeFromSnapshot(cp.edges.main);
    this.innerEdges.mergeFromSnapshot(cp.edges.inner);

    // subAgent 병합 — cp.project로 해당 프로젝트의 sub-streams 디렉토리에서 스트림 복원
    // archivedSubAgents도 함께 병합
    if (cp.subAgents) {
      subAgentManager.mergeSnapshot(cp.subAgents, cp.subAgentCounter ?? 0, cp.project, cp.archivedSubAgents);
    }

    // hiddenProjects 병합
    if (cp.hiddenProjects) {
      for (const name of cp.hiddenProjects) this.hiddenProjects.add(name);
    }

    // customLabels 병합
    if (cp.customLabels) {
      for (const [agentId, label] of Object.entries(cp.customLabels)) {
        if (!this.customLabels.has(agentId)) {
          this.customLabels.set(agentId, label);
          for (const agent of this.agents.values()) {
            if (agent.id === agentId) { agent.label = label; break; }
          }
        }
      }
    }

    // commandQueues 병합
    if (cp.commandQueues) {
      for (const [sessionId, cmds] of Object.entries(cp.commandQueues)) {
        if (!this.commandQueuesRef.has(sessionId)) {
          this.commandQueuesRef.set(sessionId, [...cmds]);
        }
      }
    }

    // completedCommands archive 병합
    if (cp.completedCommands) {
      for (const [sessionId, cmds] of Object.entries(cp.completedCommands)) {
        if (!this.completedCommandArchiveRef.has(sessionId)) {
          this.completedCommandArchiveRef.set(sessionId, [...cmds]);
        }
      }
    }

    // §4 v2.55 — 작업 신고 병합 (agentId 키, 기존 우선 + 신규 id 만 추가, createdAt 정렬 후 캡 유지).
    //   restoreFromCheckpoint 는 clear 후 set 이지만, merge 경로(다중 프로젝트 합치기)는 누적이어야 한다.
    if (cp.agentReports) {
      for (const [agentId, reports] of Object.entries(cp.agentReports)) {
        if (!Array.isArray(reports) || reports.length === 0) continue;
        const existing = this.agentReports.get(agentId);
        if (!existing) {
          this.agentReports.set(agentId, [...reports]);
        } else {
          const seen = new Set(existing.map((r) => r.id));
          for (const r of reports) if (!seen.has(r.id)) existing.push(r);
          existing.sort((a, b) => a.createdAt - b.createdAt);
          if (existing.length > AGENT_REPORT_MAX_PER_AGENT) {
            existing.splice(0, existing.length - AGENT_REPORT_MAX_PER_AGENT);
          }
        }
      }
    }

    // §4 v2.60 — 질문 카드 병합 (agentReports 와 동형).
    if (cp.agentQuestions) {
      for (const [agentId, qs] of Object.entries(cp.agentQuestions)) {
        if (!Array.isArray(qs) || qs.length === 0) continue;
        const existing = this.agentQuestions.get(agentId);
        if (!existing) {
          this.agentQuestions.set(agentId, [...qs]);
        } else {
          const seen = new Set(existing.map((q) => q.id));
          for (const q of qs) if (!seen.has(q.id)) existing.push(q);
          existing.sort((a, b) => a.createdAt - b.createdAt);
          if (existing.length > AGENT_QUESTIONS_MAX_PER_AGENT) {
            existing.splice(0, existing.length - AGENT_QUESTIONS_MAX_PER_AGENT);
          }
        }
      }
    }

    // §4 v2.70 — 검수 요청 카드 병합 (agentReports/agentQuestions 와 동형).
    if (cp.agentReviews) {
      for (const [agentId, reviews] of Object.entries(cp.agentReviews)) {
        if (!Array.isArray(reviews) || reviews.length === 0) continue;
        const existing = this.agentReviews.get(agentId);
        if (!existing) {
          this.agentReviews.set(agentId, [...reviews]);
        } else {
          const seen = new Set(existing.map((r) => r.id));
          for (const r of reviews) if (!seen.has(r.id)) existing.push(r);
          existing.sort((a, b) => a.createdAt - b.createdAt);
          if (existing.length > AGENT_REVIEWS_MAX_PER_AGENT) {
            existing.splice(0, existing.length - AGENT_REVIEWS_MAX_PER_AGENT);
          }
        }
      }
    }

    // §4 v2.84 — 번호 목록 정렬 카드 병합 (agentReviews 와 동형).
    if (cp.agentLists) {
      for (const [agentId, lists] of Object.entries(cp.agentLists)) {
        if (!Array.isArray(lists) || lists.length === 0) continue;
        const existing = this.agentLists.get(agentId);
        if (!existing) {
          this.agentLists.set(agentId, [...lists]);
        } else {
          const seen = new Set(existing.map((l) => l.id));
          for (const l of lists) if (!seen.has(l.id)) existing.push(l);
          existing.sort((a, b) => a.createdAt - b.createdAt);
          if (existing.length > AGENT_LISTS_MAX_PER_AGENT) {
            existing.splice(0, existing.length - AGENT_LISTS_MAX_PER_AGENT);
          }
        }
      }
    }

    // §5.7 #23-2 v1.60 — agent-view 생존 sub 의 status 를 'active' 로 되돌려 orphan 봉합 회피.
    // restore 가 status='active' → 'idle' 로 강등한 후 아래 orphan 정리가 봉합해버리므로,
    // 그 직전에 **실제 턴 진행 중**인 worker 만 'active' 로 복원 (isShortWorking = roster + state.json).
    // isShortAlive 만 보면 끝난 worker(roster 엔 남았지만 state='idle'/'done') 가 잘못 부활해
    // 부모 에이전트가 idle→active→completed 사이클을 타는 버그가 발생.
    // 실제 watcher 재부착은 postListenBoot 에서 비동기로 진행됨.
    for (const sub of subAgentManager.getAllSubsFlat()) {
      if (sub.agentViewShort && isAgentViewShortWorking(sub.agentViewShort)) {
        sub.status = 'active';
      }
    }

    // v1.33 reconcile: 고아 executing 정리. 서버 재기동/tsx watch 리스타트 등으로
    // 자식 프로세스는 죽었는데 cmd.status='executing' 만 체크포인트에 남은 경우를 탐지.
    // 참조된 subAgent 가 (a) 존재 안 함, (b) active 아님 이면 'error' 로 봉합 + 사유 기록.
    for (const queue of this.commandQueuesRef.values()) {
      for (const cmd of queue) {
        if (cmd.status !== 'executing') continue;
        const sub = cmd.subAgentId ? subAgentManager.getSub(cmd.subAgentId) : undefined;
        if (!sub || sub.status !== 'active') {
          // v1.79→v1.80 (Direction A 보강) — 커스텀 에이전트의 끊긴 명령은 죽은 `[orphaned]`
          // 에러로 두지 않고, 보존된 세션(sub.sessionId)으로 **매 재시작마다** 자동 재개한다.
          // v1.79 의 one-shot(`!restartResumed`) 가드는 잘못이었다 — 서버를 2번 이상 재시작하면
          // 2번째부터 무조건 `[orphaned]` 로 떨어졌다. 이 reconcile 은 **실제 서버 재시작 시에만**
          // 도므로 자가구동 무한루프가 성립 불가(매 재개는 사용자의 실제 재시작 1건에 대응);
          // 죽은 sessionId 는 execute() 의 스테일 세션 자가복구가 fresh 로 정상화하므로 wedge 도
          // 없다. 따라서 횟수 캡 없이 항상 재개. `restartResumed` 는 진단용 누적 표식(게이트 ❌).
          const parentIsCustom =
            !!sub
            && [...this.agents.values()].some((a) => a.id === sub.parentAgentId && a.customCreated);
          if (sub && parentIsCustom && sub.sessionId) {
            cmd.status = 'queued';
            cmd.restartResumed = true;
            cmd.result = undefined;
            if (sub.status !== 'idle') sub.status = 'idle';
            logger.info(`[restart-resume] custom cmd re-queued on session ${sub.sessionId.slice(0, 12)} (sub=${sub.id})`);
          } else {
            cmd.status = 'error';
            cmd.result = `[orphaned] 서버 재기동으로 이 명령의 실행 컨텍스트가 끊겨 종료 처리됨.${sub ? '' : ' 참조 서브에이전트 소실.'}`;
          }
        }
      }
    }

    // 마이그레이션: 병합된 commandQueues에 남아있는 completed/error → archive로 이동
    for (const [sessionId, queue] of this.commandQueuesRef) {
      const done = queue.filter((c) => c.status === 'completed' || c.status === 'error');
      if (done.length === 0) continue;
      let archive = this.completedCommandArchiveRef.get(sessionId);
      if (!archive) { archive = []; this.completedCommandArchiveRef.set(sessionId, archive); }
      archive.push(...done);
      const remaining = queue.filter((c) => c.status === 'queued' || c.status === 'executing');
      this.commandQueuesRef.set(sessionId, remaining);
    }

    // agentConfigs 병합
    if (cp.agentConfigs) {
      for (const [agentId, config] of Object.entries(cp.agentConfigs)) {
        if (!this.agentConfigs.has(agentId)) this.agentConfigs.set(agentId, config);
      }
    }

    // observedTools 병합
    if (cp.observedTools) {
      for (const [sessionId, tools] of Object.entries(cp.observedTools)) {
        const existing = this.observedTools.get(sessionId);
        if (existing) {
          for (const t of tools) existing.add(t);
        } else {
          this.observedTools.set(sessionId, new Set(tools));
        }
      }
    }

    // manuallyConfigured 병합
    if (cp.manuallyConfigured) {
      for (const id of cp.manuallyConfigured) this.manuallyConfigured.add(id);
    }

    // taskEdges 병합 — restore 와 동일하게 executing → idle 리셋
    // (merge 는 보조 프로젝트 CP 경로라 없는 key 만 추가)
    if (cp.taskEdges) {
      for (const [id, edge] of Object.entries(cp.taskEdges)) {
        if (this.taskEdges.has(id)) continue;
        const normalized = edge.status === 'executing'
          ? { ...edge, status: 'idle' as const }
          : edge;
        this.taskEdges.set(id, normalized);
      }
    }

    // v1.45 — Comment Box 병합 (중복 ID 는 기존 유지)
    if (cp.commentBoxes) {
      for (const box of cp.commentBoxes) {
        if (this.commentBoxes.has(box.id)) continue;
        this.commentBoxes.set(box.id, { ...box });
      }
    }

    // §5.3 #28 v1.47 — 콘티 병합 (v1.59 hotfix — toProjectCheckpoint 누락 픽스와 짝).
    // workId/updatedAt 누락 시 폴백 (restoreFromCheckpoint 와 같은 정책).
    if (cp.contis) {
      for (const [cid, c] of Object.entries(cp.contis)) {
        if (this.contis.has(cid)) continue;
        const restored: Conti = sanitizeContiOnLoad({
          ...c,
          workId: typeof (c as Partial<Conti>).workId === 'string' ? (c as Conti).workId : '',
          updatedAt: typeof (c as Partial<Conti>).updatedAt === 'number' ? (c as Conti).updatedAt : c.createdAt,
        });
        this.contis.set(cid, restored);
      }
    }

    // §3.2.1-3 v2.63 — 묘비 병합(누적, 상한 적용). 여러 프로젝트 합칠 때 삭제 이력 유실 방지.
    if (cp.deletedCustomAgentIds) {
      for (const sid of cp.deletedCustomAgentIds) this.addTombstone(sid);
    }

    // 루트 캔버스 바운딩 박스: 해당 프로젝트 키에 저장(이미 있으면 보존)
    if (cp.layoutBoundsHalfWidth != null && cp.layoutBoundsHalfHeight != null) {
      if (!this.layoutBoundsByProject.has(cp.project.name)) {
        this.layoutBoundsByProject.set(cp.project.name, {
          hw: cp.layoutBoundsHalfWidth,
          hh: cp.layoutBoundsHalfHeight,
        });
      }
    }

    // lastActivity 갱신
    const now = Date.now();
    for (const [k] of Object.entries(cp.graph.agents)) {
      const agent = this.agents.get(k);
      if (agent) agent.lastActivity = now;
    }
    for (const [k] of Object.entries(cp.graph.nodes)) {
      const node = this.nodes.get(k);
      if (node) node.lastActivity = now;
    }

    // 루트 노드 보장
    for (const info of Object.values(cp.graph.projects)) {
      this.ensureRootNode(info.name);
    }
    this.ensureRootNode(cp.project.name);

    // 구 체크포인트 호환: 미스코프 node id 재해싱
    this.regenerateScopedNodeIds();

    logger.info(
      `Checkpoint merged: ${cp.project.name} (seq=${cp.seq}, ` +
      `${Object.keys(cp.graph.agents).length} agents, ` +
      `${Object.keys(cp.graph.nodes).length} nodes)`,
    );
  }

  /** v2 체크포인트에서 복원 */
  restoreFromCheckpoint(cp: ProjectCheckpoint): void {
    this.bumpMutationVersion();
    this.root = normalize(cp.project.path);
    this.seq = cp.seq;
    this.uiLocale = cp.uiLocale ?? DEFAULT_UI_LOCALE;
    this.agentCounter = cp.graph.agentCounter;
    this.agents = new Map(Object.entries(cp.graph.agents));
    this.nodes = new Map(Object.entries(cp.graph.nodes));
    this.projects = new Map(Object.entries(cp.graph.projects));
    this.topLevelPaths = new Set(cp.graph.hierarchy.topLevelPaths);
    this.childrenMap = new Map(
      Object.entries(cp.graph.hierarchy.childrenMap).map(([k, v]) => [k, new Set(v)]),
    );
    this.satelliteMap = new Map(
      Object.entries(cp.graph.hierarchy.satelliteMap)
        .filter(([k]) => !ProjectGraph.isRootKey(k))
        .map(([k, v]) => [k, new Set(v)]),
    );
    // agentSpecialPaths는 agent.persistSatellites로 이동 — 복원 불필요
    this.nodeAgentRefs = new Map(
      Object.entries(cp.graph.refs.nodeAgentRefs).map(([k, v]) => [k, new Set(v)]),
    );
    this.sessionCwds = new Map(Object.entries(cp.graph.refs.sessionCwds));
    this.nodeProjectNames = new Map(Object.entries(cp.graph.refs.nodeProjectRoots ?? {}));
    this.bashHistory = new Map(Object.entries(cp.activity.bashHistory));
    this.runningServers = new Map(Object.entries(cp.activity.runningServers));
    this.fileEdits = new Map(Object.entries(cp.activity.fileEdits));

    // 파생 인덱스 재구축
    this.fileEditSeen.clear();
    for (const edits of this.fileEdits.values()) {
      for (const e of edits) this.fileEditSeen.add(e.id);
    }

    // 복원 시 lastActivity 갱신 → 클라이언트 TTL 리셋.
    // status는 idle로 리셋 — 재시작 직후엔 아무 일도 일어나고 있지 않으므로.
    // v1.60: completed 도 idle 로 강등. completed 는 "방금 active→끝났음" 의 60초 휘발성 셀러브레이션이지
    // 영속 상태가 아님. 다운타임을 건너온 셀러브레이션은 의미 없음.
    // 진짜 살아있는 sub 은 바로 아래 supervisor roster 동기 점검(2582 라인)에서 active 로 부활되고,
    // 부모 에이전트도 reattach 직후 첫 sweep 에서 active 로 자연 승격된다.
    const now = Date.now();
    for (const agent of this.agents.values()) {
      agent.lastActivity = now;
      // v1.73 — 레거시 체크포인트에 영속된 'awaiting_input'(모래시계)도 idle 로 정규화.
      //         이게 없으면 서버 재시작 때 죽은 모래시계가 그대로 부활해 연속성이 끊겨 보인다.
      //         (status 유니온에서 제거됐으므로 raw string 비교.)
      if (
        agent.status === 'active'
        || agent.status === 'completed'
        || (agent.status as string) === 'awaiting_input'
      ) {
        agent.status = 'idle';
        agent.fadeStartedAt = undefined;
      }
    }
    for (const node of this.nodes.values()) {
      node.lastActivity = now;
      // 안전장치: ghost + idle(비pinned) 노드는 disappearing 재설정
      if (node.bubbleType === 'ghost' && node.status !== 'disappearing' && !node.ghostInfo?.pinned && !node.preservePinned) {
        node.status = 'disappearing';
        node.disappearStartedAt = now;
        node.disappearAt = now + GHOST_FADE_DURATION;
      }
    }

    // bashEntryIndex 재구축
    this.bashEntryIndex.clear();
    for (const entries of this.bashHistory.values()) {
      for (const entry of entries) this.bashEntryIndex.set(entry.id, entry);
    }

    // v1.6: dormant 에이전트 복원
    this.dormantAgents = new Map(Object.entries(cp.dormantAgents ?? {}));
    if (this.dormantAgents.size > 0) {
      logger.info(`Restored ${this.dormantAgents.size} dormant agent snapshot(s) from checkpoint`);
    }

    // 엣지 복원 (v2 Record 기반)
    this.mainEdges.restoreFromSnapshot(cp.edges.main);
    this.innerEdges.restoreFromSnapshot(cp.edges.inner);

    // subagent 복원 — cp.project로 해당 프로젝트의 sub-streams 디렉토리에서 스트림 복원
    // archivedSubAgents(탭 닫힌 이력)도 함께 복원 → 폴더 버튼 "다시 열기" 리스트 복원
    //
    // subAgentManager 는 전역 싱글톤 — 부팅 시 N개 프로젝트가 순차 hydrate 되면 매 호출마다
    // registry.clear() 가 일어나 마지막 프로젝트의 sub 만 살아남는 버그 회피용으로 mergeSnapshot 사용.
    // (다른 프로젝트의 parent agentId 는 서로 겹치지 않으므로 누적이 항상 안전.)
    if (cp.subAgents) {
      subAgentManager.mergeSnapshot(cp.subAgents, cp.subAgentCounter ?? 0, cp.project, cp.archivedSubAgents);
    }

    // hiddenProjects 복원
    if (cp.hiddenProjects) {
      for (const name of cp.hiddenProjects) this.hiddenProjects.add(name);
    }

    // pipelines 복원
    if (cp.pipelines) {
      pipelineManager.restore(cp.pipelines, this.agents);
    }

    // agentConfigs 복원
    if (cp.agentConfigs) {
      this.agentConfigs = new Map(Object.entries(cp.agentConfigs));
      // §4 v2.63 — 색 기반 레거시 토글 마이그레이션은 제거. executionMode 가 이제 PUT 에서 보존되는
      //   에이전트 정체성이라, CMD 에이전트 색을 teal 에서 바꾸면 색 휴리스틱이 executionMode 를 잘못
      //   지우는 footgun 이 된다. 누수 원인은 createCustomAgent(상속 차단) + userDefaultsService(잔재 정리)
      //   에서 이미 막혔고 기존 데이터는 정리·영속화 완료. executionMode 를 그대로 신뢰한다.
    }

    // observedTools 복원
    if (cp.observedTools) {
      for (const [sessionId, tools] of Object.entries(cp.observedTools)) {
        this.observedTools.set(sessionId, new Set(tools));
      }
    }

    // manuallyConfigured 복원
    if (cp.manuallyConfigured) {
      for (const id of cp.manuallyConfigured) this.manuallyConfigured.add(id);
    }

    // taskEdges 복원
    if (cp.taskEdges) {
      this.taskEdges = new Map(Object.entries(cp.taskEdges));
      // 복원 시 executing → idle (프로세스 이미 종료)
      for (const edge of this.taskEdges.values()) {
        if (edge.status === 'executing') edge.status = 'idle';
      }
    }

    // v1.45 — Comment Box 복원
    this.commentBoxes = new Map();
    if (cp.commentBoxes) {
      for (const box of cp.commentBoxes) {
        this.commentBoxes.set(box.id, { ...box });
      }
    }

    // v1.47 — Conti 복원
    // §5.3 #28 (L) v1.58 — 이전 체크포인트 호환: workId/updatedAt 누락 시 폴백 채움
    this.contis = new Map();
    if (cp.contis) {
      for (const [cid, c] of Object.entries(cp.contis)) {
        const restored: Conti = sanitizeContiOnLoad({
          ...c,
          workId: typeof (c as Partial<Conti>).workId === 'string' ? (c as Conti).workId : '',
          updatedAt: typeof (c as Partial<Conti>).updatedAt === 'number' ? (c as Conti).updatedAt : c.createdAt,
        });
        this.contis.set(cid, restored);
      }
    }
    // §5.3 #28 (L) v1.58 — 인플라이트 작업 트래커는 영속화 ❌ — 서버 재기동 시 비움
    this.activeContiWork.clear();

    // §3.2.1-3 v2.63 — 명시 삭제 묘비 복원(전체 교체). 부활 차단·shrink guard 신호 유지.
    this.deletedCustomAgents = new Set(cp.deletedCustomAgentIds ?? []);

    // §4 v1.50 — compactCounts 복원 (도구 시간/한도는 런타임이라 복원 ❌)
    this.compactCounts.clear();
    if (cp.compactCounts) {
      for (const [sid, c] of Object.entries(cp.compactCounts)) {
        this.compactCounts.set(sid, c);
      }
    }

    // §5.5 #17-4 v2.36 — 프로젝트별 스킬 사용 카운트 복원
    this.skillUsageCounts.clear();
    if (cp.skillUsageCounts) {
      for (const [name, n] of Object.entries(cp.skillUsageCounts)) {
        if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
          this.skillUsageCounts.set(name, n);
        }
      }
    }

    // §5.3 #10-2 v2.37 — Auto Agent 요약 메타 복원
    this.autoAgentSummaries.clear();
    if (cp.autoAgentSummaries) {
      for (const [id, summary] of Object.entries(cp.autoAgentSummaries)) {
        if (summary && typeof summary === 'object') {
          this.autoAgentSummaries.set(id, summary);
        }
      }
    }

    // §4 v2.52 — 에이전트 작업 신고 복원
    this.agentReports.clear();
    if (cp.agentReports) {
      for (const [agentId, reports] of Object.entries(cp.agentReports)) {
        if (Array.isArray(reports) && reports.length > 0) {
          this.agentReports.set(agentId, [...reports]);
        }
      }
    }

    // §4 v2.60 — 에이전트 질문 카드 복원
    this.agentQuestions.clear();
    if (cp.agentQuestions) {
      for (const [agentId, qs] of Object.entries(cp.agentQuestions)) {
        if (Array.isArray(qs) && qs.length > 0) {
          this.agentQuestions.set(agentId, [...qs]);
        }
      }
    }

    // §4 v2.70 — 에이전트 검수 요청 카드 복원
    this.agentReviews.clear();
    if (cp.agentReviews) {
      for (const [agentId, reviews] of Object.entries(cp.agentReviews)) {
        if (Array.isArray(reviews) && reviews.length > 0) {
          this.agentReviews.set(agentId, [...reviews]);
        }
      }
    }

    // §4 v2.84 — 에이전트 번호 목록 정렬 카드 복원
    this.agentLists.clear();
    if (cp.agentLists) {
      for (const [agentId, lists] of Object.entries(cp.agentLists)) {
        if (Array.isArray(lists) && lists.length > 0) {
          this.agentLists.set(agentId, [...lists]);
        }
      }
    }

    // 루트 캔버스 바운딩 박스 복원 (이 프로젝트 한정)
    if (cp.layoutBoundsHalfWidth != null && cp.layoutBoundsHalfHeight != null) {
      this.layoutBoundsByProject.set(cp.project.name, {
        hw: cp.layoutBoundsHalfWidth,
        hh: cp.layoutBoundsHalfHeight,
      });
    }

    // dismissedIframes 복원
    if (cp.dismissedIframes) {
      this.dismissedIframes = new Map(
        Object.entries(cp.dismissedIframes).map(([k, v]) => [k, new Set(v)]),
      );
    }

    // customLabels 복원 → 에이전트 라벨에 반영
    if (cp.customLabels) {
      this.customLabels = new Map(Object.entries(cp.customLabels));
      for (const [agentId, label] of this.customLabels) {
        for (const agent of this.agents.values()) {
          if (agent.id === agentId) { agent.label = label; break; }
        }
      }
    }

    // 레거시 __root__ 노드 → 프로젝트별 키로 마이그레이션
    if (this.nodes.has(ProjectGraph.LEGACY_ROOT_KEY)) {
      const legacyNode = this.nodes.get(ProjectGraph.LEGACY_ROOT_KEY)!;
      const newKey = ProjectGraph.rootKeyFor(cp.project.name);
      this.nodes.delete(ProjectGraph.LEGACY_ROOT_KEY);
      this.topLevelPaths.delete(ProjectGraph.LEGACY_ROOT_KEY);
      this.nodes.set(newKey, { ...legacyNode, path: newKey, id: `root-${hashString(newKey)}` });
      this.topLevelPaths.add(newKey);
      // 레거시 root 위성 제거 (root에는 위성 없음)
      this.satelliteMap.delete(ProjectGraph.LEGACY_ROOT_KEY);
    }

    // 모든 등록 프로젝트에 루트 노드 보장
    for (const info of this.projects.values()) {
      this.ensureRootNode(info.name);
    }
    // primary project 루트도 보장
    this.ensureRootNode(cp.project.name);

    // commandQueues 복원 (외부에서 주입된 ref Map에 데이터 주입)
    if (cp.commandQueues) {
      for (const [sessionId, cmds] of Object.entries(cp.commandQueues)) {
        this.commandQueuesRef.set(sessionId, [...cmds]);
      }
    }

    // completedCommands archive 복원
    if (cp.completedCommands) {
      for (const [sessionId, cmds] of Object.entries(cp.completedCommands)) {
        this.completedCommandArchiveRef.set(sessionId, [...cmds]);
      }
    }

    // §5.7 #23-2 v1.60 — agent-view 생존 sub 의 status 복원 (위 merge 경로와 동일).
    // isShortWorking: roster + state.json='working'/'needs-input' 둘 다 통과해야 active 복원.
    for (const sub of subAgentManager.getAllSubsFlat()) {
      if (sub.agentViewShort && isAgentViewShortWorking(sub.agentViewShort)) {
        sub.status = 'active';
      }
    }

    // v1.33 reconcile: 고아 executing 정리 (위 merge 경로와 동일 규칙). 참조 서브가 없거나
    // active 가 아니면 'error' 로 봉합해 무한 Executing 상태를 끊는다.
    for (const queue of this.commandQueuesRef.values()) {
      for (const cmd of queue) {
        if (cmd.status !== 'executing') continue;
        const sub = cmd.subAgentId ? subAgentManager.getSub(cmd.subAgentId) : undefined;
        if (!sub || sub.status !== 'active') {
          // v1.79→v1.80 (Direction A 보강) — 커스텀 에이전트의 끊긴 명령은 죽은 `[orphaned]`
          // 에러로 두지 않고, 보존된 세션(sub.sessionId)으로 **매 재시작마다** 자동 재개한다.
          // v1.79 의 one-shot(`!restartResumed`) 가드는 잘못이었다 — 서버를 2번 이상 재시작하면
          // 2번째부터 무조건 `[orphaned]` 로 떨어졌다. 이 reconcile 은 **실제 서버 재시작 시에만**
          // 도므로 자가구동 무한루프가 성립 불가(매 재개는 사용자의 실제 재시작 1건에 대응);
          // 죽은 sessionId 는 execute() 의 스테일 세션 자가복구가 fresh 로 정상화하므로 wedge 도
          // 없다. 따라서 횟수 캡 없이 항상 재개. `restartResumed` 는 진단용 누적 표식(게이트 ❌).
          const parentIsCustom =
            !!sub
            && [...this.agents.values()].some((a) => a.id === sub.parentAgentId && a.customCreated);
          if (sub && parentIsCustom && sub.sessionId) {
            cmd.status = 'queued';
            cmd.restartResumed = true;
            cmd.result = undefined;
            if (sub.status !== 'idle') sub.status = 'idle';
            logger.info(`[restart-resume] custom cmd re-queued on session ${sub.sessionId.slice(0, 12)} (sub=${sub.id})`);
          } else {
            cmd.status = 'error';
            cmd.result = `[orphaned] 서버 재기동으로 이 명령의 실행 컨텍스트가 끊겨 종료 처리됨.${sub ? '' : ' 참조 서브에이전트 소실.'}`;
          }
        }
      }
    }

    // 마이그레이션: 기존 commandQueues에 남아있는 completed/error 항목을 archive로 이동
    for (const [sessionId, queue] of this.commandQueuesRef) {
      const done = queue.filter((c) => c.status === 'completed' || c.status === 'error');
      if (done.length === 0) continue;
      let archive = this.completedCommandArchiveRef.get(sessionId);
      if (!archive) { archive = []; this.completedCommandArchiveRef.set(sessionId, archive); }
      archive.push(...done);
      const remaining = queue.filter((c) => c.status === 'queued' || c.status === 'executing');
      this.commandQueuesRef.set(sessionId, remaining);
    }

    // NOTE: agentEvents는 체크포인트에 저장하지 않음.
    // buildAgentEvents()가 JSONL 파일에서 실시간 파싱하여 생성하는 런타임 파생 데이터이므로
    // 서버 재시작 시 JSONL이 남아있으면 자동 복원됨.

    // 구 체크포인트 호환: 미스코프 node id 를 현재 스코프 규칙으로 재해싱 (프로젝트 간 merge 충돌 방지)
    this.regenerateScopedNodeIds();

    logger.info(`Checkpoint restored: ${cp.project.name} (seq=${cp.seq}, ${this.agents.size} agents, ${this.nodes.size} nodes)`);
  }

  /** 모든 idle 상태 에이전트의 파일/폴더 엣지를 삭제. 기동 시 1회 청소용.
   *  runtime 에서는 markAgentIdle 이 담당 — 이 메서드는 과거 체크포인트 보정 전용.
   *  반환값: 삭제된 엣지 수 (main+inner 합계). */
  sweepIdleAgentFileFolderEdges(): number {
    const mainBefore = this.mainEdges.getAll().length;
    const innerBefore = this.innerEdges.getAll().length;
    const ids = this.collectFileFolderBubbleIds();
    for (const agent of this.agents.values()) {
      if (agent.bubbleType !== 'agent') continue;
      if (agent.status === 'idle') this.removeAgentFileFolderEdges(agent.id, ids);
    }
    const mainAfter = this.mainEdges.getAll().length;
    const innerAfter = this.innerEdges.getAll().length;
    return (mainBefore - mainAfter) + (innerBefore - innerAfter);
  }

  /** 전체 서버 목록 (flat, refresh/stop/restart용) */
  getRunningServers(): ServerEntry[] {
    const all: ServerEntry[] = [];
    for (const entries of this.runningServers.values()) {
      all.push(...entries);
    }
    return all;
  }

  /** §7.11 v2.22 — 주어진 ServerEntry id 의 owning session 정보를 찾는다.
   *  /api/restart-server 가 원래 명령이 실행됐던 cwd 로 respawn 하기 위해 사용. */
  findServerOwnerSession(serverId: string): { sessionId: string; cwd: string | undefined } | null {
    for (const [sessionId, entries] of this.runningServers) {
      if (entries.some((e) => e.id === serverId)) {
        return { sessionId, cwd: this.sessionCwds.get(sessionId) };
      }
    }
    return null;
  }

  /**
   * §7.11 v2.23 — /api/restart-server 가 respawn 직후 호출.
   * 매칭 iframe 위성의 `shellId` 를 비우고 `iframeDeadAt` 을 클리어한다.
   * Vibisual 이 직접 띄운 detached child 는 Claude JSONL 에 active 로 기록되지 않아
   * v1.48 owning-shell 검사(`activeShellIds.has(sat.shellId)`)를 영원히 false 로 만든다.
   * shellId 를 비우면 그 검사가 port-only fallback(`: true`)으로 떨어져 포트만 살아 있으면
   * `checkIframesAlive` 가 정상적으로 alive 로 전환.
   * @returns 실제로 변경된 위성이 있으면 true
   */
  noteIframeRespawnedByServerId(serverId: string): boolean {
    let port: number | undefined;
    let shellId: string | undefined;
    for (const entries of this.runningServers.values()) {
      const hit = entries.find((s) => s.id === serverId);
      if (hit) { port = hit.port; shellId = hit.shellId; break; }
    }
    if (port == null && !shellId) return false;

    let changed = false;
    for (const agent of this.agents.values()) {
      if (!agent.persistSatellites) continue;
      for (const sat of agent.persistSatellites) {
        if (sat.bubbleType !== 'iframe') continue;
        const match = (shellId && sat.shellId === shellId)
          || (port != null && sat.url?.includes(`:${port}`));
        if (!match) continue;
        // shellId 분리 — owning-shell 검사 우회
        if (sat.shellId !== undefined) {
          sat.shellId = undefined;
          changed = true;
        }
        // grace 시계 클리어 — 부활 직후 즉시 grace 제거되지 않게
        if (sat.iframeDeadAt !== undefined) {
          sat.iframeDeadAt = undefined;
          changed = true;
        }
      }
    }
    return changed;
  }

  /**
   * ServerEntry.id로 매칭되는 iframe 위성의 iframeAlive=false 즉시 플립.
   * /api/stop-server 핸들러가 killByPort 직후 호출 — 5초 스윕(checkIframesAlive) 지연 없이
   * 버블 status 가 active → idle(부모 agent.status 미러링)로 전환되도록 보장(SCENARIO §7.11 v1.29).
   * @returns 실제로 변경된 위성이 있으면 true
   */
  markIframeStoppedByServerId(serverId: string): boolean {
    // ServerEntry 에서 shellId 또는 port 를 먼저 확인
    let shellId: string | undefined;
    let port: number | undefined;
    for (const entries of this.runningServers.values()) {
      const hit = entries.find((s) => s.id === serverId);
      if (hit) { shellId = hit.shellId; port = hit.port; break; }
    }
    if (!shellId && port == null) return false;

    let changed = false;
    for (const agent of this.agents.values()) {
      if (!agent.persistSatellites) continue;
      for (const sat of agent.persistSatellites) {
        if (sat.bubbleType !== 'iframe') continue;
        const match = (shellId && sat.shellId === shellId)
          || (port != null && sat.url?.includes(`:${port}`));
        if (match && sat.iframeAlive !== false) {
          sat.iframeAlive = false;
          changed = true;
        }
      }
    }
    return changed;
  }


  /** 같은 서버를 가리키는 ServerEntry 중복 머지.
   *  여러 등록 경로(PreToolUse hook / attachBackgroundShell / rehydrate / sweep)가
   *  shellId·outputFile·port 백필 타이밍이 어긋나 같은 서버를 두 entry 로 만드는 경우 정리.
   *  매칭 키: (1) shellId 동일 (2) outputFile 동일 (3) command 동일 (port 충돌 없을 때).
   *  머지 시 더 풍부한 정보(shellId/outputFile/port/alive/오래된 startedAt) 보존. */
  dedupRunningServers(): boolean {
    let changed = false;
    for (const [sid, entries] of this.runningServers) {
      if (entries.length <= 1) continue;
      const out: ServerEntry[] = [];

      const tryMerge = (target: ServerEntry, src: ServerEntry): void => {
        if (!target.shellId && src.shellId) target.shellId = src.shellId;
        if (!target.outputFile && src.outputFile) target.outputFile = src.outputFile;
        if (target.port == null && src.port != null) target.port = src.port;
        if (src.alive) target.alive = true;
        if (src.startedAt < target.startedAt) target.startedAt = src.startedAt;
      };

      // §7.11 v2.1 — ServerEntry 는 포트 단위라 머지는 같은 포트끼리만.
      // 한쪽이 포트-미상 placeholder(port null)면 실제 포트 entry 로 흡수 허용.
      const portCompat = (a: ServerEntry, b: ServerEntry): boolean =>
        a.port == null || b.port == null || a.port === b.port;

      for (const e of entries) {
        // 1) shellId 동일 + 포트 호환
        let matched = e.shellId
          ? out.find((x) => x.shellId === e.shellId && portCompat(x, e))
          : undefined;
        // 2) outputFile 동일 + 포트 호환
        if (!matched && e.outputFile) {
          matched = out.find((x) => x.outputFile === e.outputFile && portCompat(x, e));
        }
        // 3) command 동일 + 포트 호환
        if (!matched) {
          matched = out.find((x) => x.command === e.command && portCompat(x, e));
        }

        if (matched) { tryMerge(matched, e); changed = true; }
        else out.push(e);
      }

      if (out.length !== entries.length) {
        logger.info(`dedupRunningServers: session=${sid.slice(0, 8)} ${entries.length} → ${out.length}`);
        this.runningServers.set(sid, out);
      }
    }
    return changed;
  }

  /** session_id → bash bubble ID 변환 */
  private bashBubbleId(sessionId: string): string {
    return `special-${hashString(`__special__bash__${sessionId}`)}`;
  }

  /** 에이전트별 bash history → bash bubble ID 기준 Record */
  private buildBashHistoryRecord(): Record<string, BashEntry[]> {
    const result: Record<string, BashEntry[]> = {};
    for (const [sessionId, entries] of this.bashHistory) {
      const bubbleId = this.bashBubbleId(sessionId);
      result[bubbleId] = [...entries];
    }
    return result;
  }

  /** 에이전트별 running servers → bash bubble ID 기준 Record */
  private buildRunningServersRecord(): Record<string, ServerEntry[]> {
    const result: Record<string, ServerEntry[]> = {};
    for (const [sessionId, entries] of this.runningServers) {
      const bubbleId = this.bashBubbleId(sessionId);
      // §7.11 v2.4 — 죽은 entry 도 스냅샷에 포함한다. IframeServerCard 가 멈춘 서버의
      // serverId 를 매칭해 Start/Restart 버튼을 활성화하려면 dead entry 가 필요하다.
      // ServerList(§7.11 v2.1 — alive-only)는 클라이언트에서 alive 필터링한다.
      if (entries.length > 0) result[bubbleId] = entries.map((s) => ({ ...s }));
    }
    return result;
  }

  /** 에이전트 idle 전환 + 연결 노드/엣지 ref 해제 → 참조 0이면 idle.
   *  이 에이전트 버블과 파일/폴더 버블을 잇던 엣지는 **삭제**(다시 참조 시 자동 재생성). */
  /**
   * 에이전트를 idle 로 내린다.
   * @param purgeNodes 사용자 확인 dismiss 경로에서만 `true` — 그 에이전트가 전유하던
   *   file/folder 버블을 idle 대신 즉시 제거(§2.4 "확인 dismiss → 전유 file/folder 즉시 소멸", v1.82).
   *   자동 timeout idle(`expireCompletedAgents`/idle 스윕)은 `false`(기본) — 5분 TTL grace 유지.
   */
  markAgentIdle(sessionId?: string, purgeNodes = false): void {
    this.bumpMutationVersion();
    if (sessionId) {
      const agent = this.agents.get(sessionId);
      if (agent) {
        agent.status = 'idle';
        agent.fadeStartedAt = undefined;
        agent.summary = undefined;
        if (agent.persistSatellites) {
          for (const sat of agent.persistSatellites) sat.status = 'idle';
        }
        const activeIds = this.getActiveAgentIds(agent.id);
        if (purgeNodes) this.removeAgentRefsPurging(agent.id, activeIds);
        else this.removeAgentRefs(agent.id, activeIds);
        this.mainEdges.removeAgentRefs(agent.id, activeIds);
        this.innerEdges.removeAgentRefs(agent.id, activeIds);
        this.removeAgentFileFolderEdges(agent.id);
      }
    }
  }

  /** 파일/폴더 버블 ID 집합. this.nodes 가 path-keyed 이라 bubble id → bubbleType 역인덱스가 필요. */
  private collectFileFolderBubbleIds(): Set<string> {
    const ids = new Set<string>();
    for (const n of this.nodes.values()) {
      if (n.bubbleType === 'file'
        || n.bubbleType === 'internal_folder'
        || n.bubbleType === 'external_folder') {
        ids.add(n.id);
      }
    }
    return ids;
  }

  /** 에이전트 버블과 파일/폴더 버블 사이의 엣지를 메인/이너 양쪽에서 삭제. */
  private removeAgentFileFolderEdges(agentBubbleId: string, fileFolderIds?: Set<string>): void {
    const ids = fileFolderIds ?? this.collectFileFolderBubbleIds();
    const pred = (edge: ActivityEdge): boolean => {
      if (edge.source === agentBubbleId) return ids.has(edge.target);
      if (edge.target === agentBubbleId) return ids.has(edge.source);
      return false;
    };
    this.mainEdges.removeByPredicate(pred);
    this.innerEdges.removeByPredicate(pred);
  }

  /**
   * 커스텀 에이전트 상태를 소속 서브에이전트 집계로 재계산.
   * - sub 중 하나라도 status==='active' → 커스텀 에이전트 active (fadeStartedAt 클리어)
   * - active 가 전혀 없고 이전이 active 였으면 → completed 로 전이(기존 setAgentStatus 와 동일한 fadeStartedAt 세팅)
   * - 그 외(전부 idle 이고 이미 idle/completed) → 변화 없음
   * 반환값: 상태가 바뀌면 true (호출자가 broadcast 필요 여부 판단용).
   */
  recomputeCustomAgentStatus(parentAgentId: string): boolean {
    // §4 v2.64 — CMD(인터랙티브 터미널) 에이전트는 서브 집계로 상태를 매기지 않는다.
    //   자기 인터랙티브 claude 세션의 redirect 된 hook 스트림(touchAgent active + Stop completed)
    //   으로 상태가 정해진다 — Hook 에이전트와 동일. 서브가 0개라 여기서 강등하면 활동 중에도
    //   10초 sweep 마다 completed 로 튀어 엣지가 뜯기는 오완료 회귀가 난다.
    if (this.agentConfigs.get(parentAgentId)?.executionMode === 'interactive-terminal') {
      return false;
    }
    let found: BubbleData | null = null;
    let foundSessionId: string | null = null;
    for (const [sid, agent] of this.agents) {
      if (agent.id === parentAgentId && agent.customCreated) {
        found = agent;
        foundSessionId = sid;
        break;
      }
    }
    if (!found || !foundSessionId) return false;

    // §5.3 #12-1 v1.91 — 권한 승인 대기 중이면 훅이 동기 hold 중인 "블록된 활성" 상태.
    // sub 집계가 비활성으로 보여도 completed 로 강등 ❌ — 결정/타임아웃까지 active 유지.
    if (this.permissionWaitingAgents.has(parentAgentId)) {
      if (found.status !== 'active') {
        found.status = 'active';
        found.fadeStartedAt = undefined;
        found.lastActivity = Date.now();
        return true;
      }
      return false;
    }

    const subs = subAgentManager.getAllSubs(parentAgentId);
    const anyActive = subs.some((s) => s.status === 'active');
    const prevStatus = found.status;

    if (anyActive) {
      if (prevStatus !== 'active') {
        found.status = 'active';
        found.fadeStartedAt = undefined;
        found.lastActivity = Date.now();
        found.activity += 1;
        return true;
      }
      // 이미 active 여도 활동 신호는 갱신
      found.lastActivity = Date.now();
      return false;
    }

    // active 아님 — 직전이 active 였으면 completed 로 (기존 에이전트 completed 경로와 동일 처리)
    if (prevStatus === 'active') {
      found.status = 'completed';
      found.fadeStartedAt = Date.now();
      found.lastActivity = Date.now();
      const activeIds = this.getActiveAgentIds(found.id);
      this.removeAgentRefs(found.id, activeIds);
      this.mainEdges.removeAgentRefs(found.id, activeIds);
      this.innerEdges.removeAgentRefs(found.id, activeIds);
      return true;
    }

    // v1.60: 이력 기반 idle→completed 승격은 제거.
    // 이유: completed 는 "방금 active→끝났음" 의 휘발성 셀러브레이션이지 영속 상태가 아니다.
    // 이 블록은 dismiss 후나 재기동 직후의 idle 을 sweep 한 번에 다시 completed 로 끌어올려
    // 시안 글로우 무한 부활의 원흉이었다. error 는 sub 자체 배지로 보이게 두고,
    // active → completed 한 갈래(위 블록)만 트리거로 사용한다.
    return false;
  }

  /** 모든 customCreated 에이전트에 대해 recomputeCustomAgentStatus 일괄 실행.
   *  재기동 직후 정합성 보정 + 주기적 sweep 용. 변화 발생 시 true. */
  recomputeAllCustomAgentStatuses(): boolean {
    let changed = false;
    for (const agent of this.agents.values()) {
      if (!agent.customCreated) continue;
      if (this.recomputeCustomAgentStatus(agent.id)) changed = true;
    }
    return changed;
  }

  /**
   * §4 v1.49 — Notification 이벤트 서브타입을 받아 에이전트 버블에 *시각 신호*만 부여.
   * `awaiting_permission` 은 transient 상태이므로 `setAgentStatus('completed')` 의
   * cleanup(엣지 정리·summary 추출) 경로를 타지 않는다.
   * 후속 PreToolUse/PostToolUse 이벤트가 오면 `touchAgent` 가 자연스럽게 'active' 로 덮어쓴다.
   * v1.73 — `awaiting_input`(모래시계) 제거. 입력 대기는 더 이상 시각 상태로 두지 않는다.
   */
  setAgentNotificationStatus(
    sessionId: string,
    status: 'awaiting_permission',
  ): void {
    this.bumpMutationVersion();
    const agent = this.agents.get(sessionId);
    if (!agent) return;
    if (agent.status === 'completed' || agent.status === 'disappearing') return;
    agent.status = status;
    agent.lastActivity = Date.now();
  }

  /** §4 v1.50 — PostToolUse `duration_ms` 캡처. agent 별 ring buffer(최근 5건). */
  recordToolDuration(sessionId: string, tool: string, durationMs: number): void {
    this.bumpMutationVersion();
    if (!this.agents.has(sessionId)) return;
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    const arr = this.recentToolDurations.get(sessionId) ?? [];
    arr.unshift({ ts: Date.now(), tool, durationMs });
    if (arr.length > 5) arr.length = 5;
    this.recentToolDurations.set(sessionId, arr);
  }

  /** §4 v1.50 — PreCompact 카운터 증가. 영속화 대상. */
  recordCompact(sessionId: string): void {
    this.bumpMutationVersion();
    if (!this.agents.has(sessionId)) return;
    const prev = this.compactCounts.get(sessionId);
    this.compactCounts.set(sessionId, {
      count: (prev?.count ?? 0) + 1,
      lastAt: Date.now(),
    });
  }

  getRecentToolDurations(): Record<string, ToolDurationEntry[]> {
    const out: Record<string, ToolDurationEntry[]> = {};
    for (const [sid, arr] of this.recentToolDurations) {
      if (arr.length > 0) out[sid] = arr;
    }
    return out;
  }

  getCompactCounts(): Record<string, CompactCount> {
    const out: Record<string, CompactCount> = {};
    for (const [sid, c] of this.compactCounts) out[sid] = c;
    return out;
  }

  setCompactCounts(map: Record<string, CompactCount>): void {
    this.compactCounts.clear();
    for (const [sid, c] of Object.entries(map)) {
      this.compactCounts.set(sid, c);
    }
  }

  /** 에이전트 상태 직접 설정 (completed 전환용). 엣지도 idle 전환. */
  setAgentStatus(sessionId: string, status: 'completed'): void {
    this.bumpMutationVersion();
    const agent = this.agents.get(sessionId);
    if (!agent) return;

    agent.status = status;
    agent.fadeStartedAt = Date.now();

    const activeIds = this.getActiveAgentIds(agent.id);
    this.removeAgentRefs(agent.id, activeIds);
    this.mainEdges.removeAgentRefs(agent.id, activeIds);
    this.innerEdges.removeAgentRefs(agent.id, activeIds);

    if (status === 'completed') {
      const cwd = this.sessionCwds.get(sessionId);
      if (cwd) {
        agent.summary = readLastAssistantMessage(cwd, sessionId) ?? undefined;
      }
    }
  }

  /** completed 상태인데 summary가 없는 에이전트 → JSONL 재시도 */
  private resolveMissingSummaries(): void {
    for (const [sessionId, agent] of this.agents) {
      if (agent.status !== 'completed' || agent.summary) continue;
      const cwd = this.sessionCwds.get(sessionId);
      if (!cwd) continue;
      agent.summary = readLastAssistantMessage(cwd, sessionId) ?? undefined;
    }
  }

  /** v1.86 — 이 에이전트가 살아있는 dev server(iframe 위성, `iframeAlive===true`)를 호스팅 중인가.
   *  §812 "dev server 는 명시 stop 전까지 살아있다" — 호스팅 중이면 isSessionInUse prune 제외
   *  (세션이 끝나 not-in-use 가 돼도 서버 프로세스는 살아있으므로 버블+위성을 제거하면 안 됨). */
  private agentHasLiveIframe(agent: BubbleData): boolean {
    return (agent.persistSatellites ?? []).some(
      (s) => s.bubbleType === 'iframe' && s.iframeAlive === true,
    );
  }

  /**
   * 비활성 에이전트 버블 제거. 시작 시 1회 + 주기적으로 호출.
   *
   * 활성 판정: `claude -p --session-id <id> "x"` 실행 시 "already in use" 에러가 나면 활성.
   * 다른 Claude Code 프로세스가 이 sessionId에 연결 중이면 CLI가 즉시 거부하는 동작을 이용.
   * timeout(1.5s) 이상 걸리면 → API 호출 시작 전에 kill → 비활성으로 판정.
   *
   * 사용자 요청: "활성중인 것들로 체크한다" — 이미 복원된 에이전트(this.agents)만 체크,
   * session.json 전수 검사하지 않음.
   */
  async pruneStaleRestoredAgents(): Promise<string[]> {
    type Cand = { sessionId: string; cwd: string };
    const candidates: Cand[] = [];
    const cwdMissing: string[] = [];
    for (const [sessionId, agent] of this.agents) {
      if (agent.bubbleType !== 'agent') continue;
      if (agent.customCreated) continue;
      // v1.86 — 살아있는 dev server(iframe) 호스트는 prune 제외 (§812 / §7.11).
      if (this.agentHasLiveIframe(agent)) continue;
      const cwd = this.sessionCwds.get(sessionId);
      if (!cwd) {
        cwdMissing.push(sessionId);
        this.removeAgent(sessionId);
        continue;
      }
      candidates.push({ sessionId, cwd });
    }
    logger.info(
      `[prune] begin: candidates=${candidates.length} cwdMissing=${cwdMissing.length} ` +
      `totalAgents=${this.agents.size} sessionCwdEntries=${this.sessionCwds.size}`,
    );
    if (cwdMissing.length > 0) {
      logger.info(`[prune] removed (no cwd): ${cwdMissing.map(s => s.slice(0,8)).join(',')}`);
    }
    if (candidates.length === 0) return [];

    // cwd별로 실행해야만 "already in use" 판정이 정확. 병렬 체크.
    const results = await Promise.all(
      candidates.map(async ({ sessionId, cwd }) => {
        const t0 = Date.now();
        const inUse = await isSessionInUse(sessionId, cwd);
        return { sessionId, inUse, durationMs: Date.now() - t0, timestamp: t0 };
      }),
    );
    // 디버그 필드 업데이트 (제거 여부 무관, 클라이언트가 debug mode로 확인)
    for (const r of results) {
      const agent = this.agents.get(r.sessionId);
      if (agent) {
        agent.lastLivenessCheck = {
          timestamp: r.timestamp,
          inUse: r.inUse,
          durationMs: r.durationMs,
        };
      }
    }
    const removed = results.filter((r) => !r.inUse).map((r) => r.sessionId);
    for (const id of removed) this.removeAgent(id);
    if (removed.length > 0) {
      logger.info(`Pruned ${removed.length} inactive agents (not in use by Claude Code)`);
    }
    return removed;
  }

  /**
   * sessionPids에 등록된 에이전트 중 Claude Code가 더 이상 점유하지 않는 세션 제거.
   * pruneStaleRestoredAgents와 동일 판정(isSessionInUse) 사용.
   */
  async checkAgentLiveness(): Promise<string[]> {
    if (this.sessionPids.size === 0) return [];
    type Cand = { sessionId: string; cwd: string };
    const cands: Cand[] = [];
    for (const sessionId of this.sessionPids.keys()) {
      // v1.86 — 살아있는 dev server(iframe) 호스트는 prune 제외 (§812 / §7.11).
      const ag = this.agents.get(sessionId);
      if (ag && this.agentHasLiveIframe(ag)) continue;
      const cwd = this.sessionCwds.get(sessionId);
      if (!cwd) { this.removeAgent(sessionId); continue; }
      cands.push({ sessionId, cwd });
    }
    const results = await Promise.all(
      cands.map(async ({ sessionId, cwd }) => ({
        sessionId,
        inUse: await isSessionInUse(sessionId, cwd),
      })),
    );
    const dead = results.filter((r) => !r.inUse).map((r) => r.sessionId);
    for (const sessionId of dead) {
      this.removeAgent(sessionId);
      logger.info(`Agent not in use → removed (session: ${sessionId})`);
    }
    return dead;
  }

  /** 외부 호출용 래퍼 — sessionLifecycle이 dead 판정 시 호출 */
  removeAgentBySession(sessionId: string): boolean {
    this.bumpMutationVersion();
    const agent = this.agents.get(sessionId);
    if (!agent) { dbg('removeAgentBySession.miss', { sessionId }); return false; }
    // §3.2.1 (A 가드) — 커스텀 에이전트는 lifecycle onDead 로 절대 제거하지 않는다.
    //   getSessionIds() 가 이미 custom 을 제외하므로 정상 흐름에선 여기 도달하지 않지만,
    //   워커 세션이 우회 등록되는 등의 경로를 이중 안전망으로 명시 차단(작업 중 소실 사고 방지 + B 진단).
    if (agent.customCreated) {
      logger.warn(
        `removeAgentBySession BLOCKED (custom-agent guard): "${agent.label}" (session ${sessionId.slice(0, 8)}) — ` +
        `custom bubbles are never auto-removed by lifecycle.`,
      );
      return false;
    }
    // iframe 위성 중 실제로 포트가 살아있는 것만 보존 근거로 인정.
    // v1.2: 포트가 죽은 iframe 위성이 에이전트 제거를 막지 않도록 iframeAlive 체크.
    const hasLiveIframe = agent.persistSatellites?.some(
      (s) => s.bubbleType === 'iframe' && s.iframeAlive === true,
    );
    const cwd = this.sessionCwds.get(sessionId);
    const projectName = cwd ? this.projects.get(normalize(cwd))?.name : undefined;
    if (hasLiveIframe) {
      // §7.7 v2.3 — poll 마다 반복 호출되므로 상태 진입 시 1회만 로깅(로그 도배 방지).
      if (!this.keepAliveLogged.has(sessionId)) {
        this.keepAliveLogged.add(sessionId);
        logger.info(`Keeping agent ${sessionId.slice(0, 8)} alive — has active iframe (dev server running)`);
      }
      dbg('removeAgentBySession.keep-iframe', { sessionId, label: agent.label, projectName, cwd });
      agent.status = 'idle';
      return false;
    }
    // 보존 상태를 벗어나 실제 제거 경로 → 다음 보존 진입 시 다시 1회 로깅되도록 플래그 클리어.
    this.keepAliveLogged.delete(sessionId);
    dbg('removeAgentBySession.remove', { sessionId, label: agent.label, projectName, cwd, instanceRoot: this.root });
    // v1.6: VSCode 재오픈 시 복원할 수 있도록 스냅샷 보관 후 실제 제거.
    const pid = this.sessionPids.get(sessionId);
    if (cwd && pid !== undefined) {
      this.dormantAgents.set(sessionId, {
        agent,
        cwd,
        pid,
        removedAt: Date.now(),
      });
      logger.info(
        `Dormant snapshot: agent "${agent.label}" (session ${sessionId.slice(0, 8)}) ` +
        `parked for cwd ${cwd}`,
      );
    }
    this.removeAgent(sessionId);
    return true;
  }

  /**
   * v1.6 SCENARIO §5.7 #24: SessionStart 훅이 cwd로 들어왔을 때, 같은 cwd로 잠들어있던
   * dormant 에이전트 스냅샷을 다시 살린다. 복원된 에이전트 sessionId 배열 반환.
   */
  restoreDormantForCwd(cwd: string): string[] {
    this.bumpMutationVersion();
    const target = normalize(cwd);
    const restored: string[] = [];
    for (const [sessionId, data] of [...this.dormantAgents]) {
      if (normalize(data.cwd) !== target) continue;
      // 핵심 맵 재삽입
      data.agent.lastActivity = Date.now();
      if (data.agent.status === 'active') data.agent.status = 'idle';
      this.agents.set(sessionId, data.agent);
      this.sessionCwds.set(sessionId, data.cwd);
      this.sessionPids.set(sessionId, data.pid);
      // persistSatellites 노드도 같이 살림 (있던 dev 서버 등 위성 시각화 보존)
      for (const sat of data.agent.persistSatellites ?? []) {
        if (!this.nodes.has(sat.path)) this.nodes.set(sat.path, sat);
      }
      // 프로젝트 등록 (root 일치 시 재등록 안전)
      const projectCwd = this.root ? this.root : data.cwd;
      this.registerProject(projectCwd);
      this.dormantAgents.delete(sessionId);
      restored.push(sessionId);
      logger.info(
        `Restored dormant agent "${data.agent.label}" (session ${sessionId.slice(0, 8)}) ` +
        `for cwd ${cwd}`,
      );
    }
    return restored;
  }

  /** 현재 추적 중인 실제 CLI/VSCode 세션 (sessionPids 기반) */
  listTrackedSessions(): Array<{ sessionId: string; pid: number; cwd: string }> {
    const result: Array<{ sessionId: string; pid: number; cwd: string }> = [];
    for (const [sessionId, pid] of this.sessionPids) {
      const cwd = this.sessionCwds.get(sessionId);
      if (cwd) result.push({ sessionId, pid, cwd });
    }
    return result;
  }

  /**
   * 에이전트 persistSatellites 노드를 nodes 맵에서 제거.
   * SSOT §2.4 v1.28: preserve-pin(`preservePinned=true`) 노드는 모든 삭제 경로에서 보존.
   * 무로그 소멸 추적용으로 drop/kept 건수를 로깅한다.
   */
  private dropAgentSatellites(agent: BubbleData, reason: string): void {
    const sats = agent.persistSatellites ?? [];
    if (sats.length === 0) return;
    let dropped = 0;
    let kept = 0;
    for (const sat of sats) {
      if (sat.preservePinned === true) { kept++; continue; }
      this.nodes.delete(sat.path);
      this.existenceMissCount.delete(sat.path);
      dropped++;
    }
    if (dropped > 0 || kept > 0) {
      logger.debug(
        `Satellites dropped: ${dropped} kept(pinned): ${kept} ` +
        `(agent "${agent.label}", reason: ${reason})`,
      );
    }
  }

  /** 에이전트 버블 + 관련 상태/엣지 완전 제거 */
  private removeAgent(sessionId: string): void {
    const agent = this.agents.get(sessionId);
    if (!agent) return;
    const caller = new Error().stack?.split('\n').slice(2, 6).join(' | ');
    // §3.2.1 (A 가드) — 커스텀 에이전트(customCreated)는 사용자 명시 삭제(removeBubble → this.agents.delete)
    //   외 어떤 자동 경로로도 제거하지 않는다. removeAgent 는 lifecycle/liveness prune 전용이라,
    //   여기 커스텀이 도달했다는 것 자체가 "작업 중 커스텀 버블 소실" 사고의 진원이다. 지우지 않고
    //   caller 스택과 함께 경고만 남긴다(B 진단 — 실제 발화 경로 확정용).
    if (agent.customCreated) {
      logger.warn(
        `removeAgent BLOCKED (custom-agent guard): "${agent.label}" (session ${sessionId.slice(0, 8)}) — ` +
        `auto-removal of custom bubbles is forbidden (only explicit user delete). caller: ${caller}`,
      );
      return;
    }
    dbg('removeAgent', { sessionId, label: agent.label, instanceRoot: this.root, caller });

    // 엣지에서 이 에이전트 참조 제거
    this.mainEdges.removeByPredicate((e) => e.source === agent.id || e.target === agent.id);
    this.innerEdges.removeByPredicate((e) => e.source === agent.id || e.target === agent.id);

    // node→agent 역참조 제거
    for (const [, refs] of this.nodeAgentRefs) refs.delete(agent.id);

    // persistSatellites 노드 제거 (preserve-pin 보존 — §2.4 v1.28)
    this.dropAgentSatellites(agent, `removeAgent session=${sessionId.slice(0, 8)}`);

    this.agents.delete(sessionId);
    this.sessionCwds.delete(sessionId);
    this.sessionPids.delete(sessionId);
    this.pendingTitles.delete(sessionId);
    this.bashHistory.delete(sessionId);
    this.runningServers.delete(sessionId);
    this.commandQueuesRef.delete(sessionId);
    this.completedCommandArchiveRef.delete(sessionId);
    this.poppedCommandsRef.delete(sessionId);
    this.agentWorktreeReadCounts.delete(sessionId);
    // 메모리 누수 방지 — 에이전트 영구 제거 시 per-agent Map/Set 정리(좀비 카드 누적 차단)
    this.agentConfigs.delete(agent.id);
    this.agentReports.delete(agent.id);
    this.agentQuestions.delete(agent.id);
    this.agentReviews.delete(agent.id);
    this.agentLists.delete(agent.id);
    this.manuallyConfigured.delete(agent.id);
    this.observedTools.delete(sessionId);
  }

  /**
   * 마지막 활동 시각으로부터 thresholdMs 초과한 active/completed 에이전트 → idle 전환.
   * 활동 시각 = max(agent.lastActivity, 연결된 subAgent.lastActivityAt, completedCommands/queue timestamp).
   * 수동 dismiss·좀비 제거와 별개 축. 변환된 세션 ID 목록 반환.
   */
  sweepIdleAgents(thresholdMs: number): string[] {
    const now = Date.now();
    const expired: string[] = [];
    for (const [sessionId, agent] of this.agents) {
      if (agent.status !== 'active' && agent.status !== 'completed') continue;
      // §5.3 #12-1 v1.91 — 권한 승인 대기 중인 에이전트는 idle sweep 제외(블록된 활성).
      if (this.permissionWaitingAgents.has(agent.id)) continue;
      let last = agent.lastActivity ?? 0;
      const subs = subAgentManager.getAllSubs(agent.id);
      let hasRunningSub = false;
      for (const s of subs) {
        if (subAgentManager.isSubRunning(s.id)) hasRunningSub = true;
        if (s.lastActivityAt > last) last = s.lastActivityAt;
      }
      // 거짓-완료 방지 — 실행 중인 sub 가 하나라도 있으면 부모는 idle sweep 후보에서 제외.
      // lastActivityAt staleness(긴 단일 도구 호출 등) 로 살아있는 부모를 만료시키지 않는다.
      if (hasRunningSub) continue;
      const completed = this.completedCommandArchiveRef.get(sessionId);
      if (completed) {
        for (const c of completed) {
          if (c.timestamp > last) last = c.timestamp;
        }
      }
      const queue = this.commandQueuesRef.get(sessionId);
      if (queue) {
        for (const c of queue) {
          if (c.timestamp > last) last = c.timestamp;
        }
      }
      if (last === 0) continue; // 활동 기록 없음 — 판정 보류
      if (now - last > thresholdMs) {
        expired.push(sessionId);
      }
    }
    for (const sessionId of expired) {
      this.markAgentIdle(sessionId);
    }
    return expired;
  }

  /**
   * completed 상태인 에이전트 중 fadeStartedAt + AGENT_FADE_DURATION 경과 시 자동 idle 전환.
   * 변환된 세션 ID 목록 반환.
   */
  expireCompletedAgents(): string[] {
    const now = Date.now();
    const expired: string[] = [];
    for (const [sessionId, agent] of this.agents) {
      if (agent.status !== 'completed') continue;
      // §5.3 #12-1 v1.91 — 권한 대기 중이면 fade/expire 보류.
      if (this.permissionWaitingAgents.has(agent.id)) continue;
      if (!agent.fadeStartedAt) continue;
      if (now - agent.fadeStartedAt >= AGENT_FADE_DURATION) {
        expired.push(sessionId);
      }
    }
    for (const sessionId of expired) {
      this.markAgentIdle(sessionId);
    }
    return expired;
  }

  // ─── Ghost 버블 시스템 ───

  // ─── 범용 소멸 (disappearing) ───

  /**
   * 버블을 disappearing 상태로 전환. durationSec초 후 서버가 실제 삭제.
   * 모든 버블 타입에 동일하게 적용.
   */
  setDisappear(nodeId: string, durationSec: number): void {
    for (const node of this.nodes.values()) {
      if (node.id === nodeId) {
        if (node.preservePinned) {
          logger.info(`Disappear skipped: "${node.label}" is preserve-pinned`);
          return;
        }
        const now = Date.now();
        node.status = 'disappearing';
        node.disappearStartedAt = now;
        node.disappearAt = now + durationSec * 1000;
        logger.info(`Disappearing: "${node.label}" in ${durationSec}s`);
        return;
      }
    }
    // 에이전트도 대상
    for (const agent of this.agents.values()) {
      if (agent.id === nodeId) {
        if (agent.preservePinned) {
          logger.info(`Disappear skipped: agent "${agent.label}" is preserve-pinned`);
          return;
        }
        const now = Date.now();
        agent.status = 'disappearing';
        agent.disappearStartedAt = now;
        agent.disappearAt = now + durationSec * 1000;
        logger.info(`Disappearing: agent "${agent.label}" in ${durationSec}s`);
        return;
      }
    }
  }

  /**
   * 사용자 preserve-pin 토글 (§2.4 v1.28).
   * true로 올릴 때 이미 disappearing 중이면 idle로 되돌려 자동 소멸 취소.
   * ghost 버블은 `ghostInfo.pinned`도 함께 동기화해 fade 차단.
   * 반환: 토글 후 값(true/false). 대상 없음=null.
   */
  togglePreservePinned(nodeId: string): boolean | null {
    const apply = (target: BubbleData): boolean => {
      const next = !target.preservePinned;
      target.preservePinned = next;
      if (next) {
        if (target.status === 'disappearing') {
          target.status = 'idle';
          target.disappearStartedAt = undefined;
          target.disappearAt = undefined;
        }
        if (target.ghostInfo) target.ghostInfo.pinned = true;
        logger.info(`Preserve-pin ON: "${target.label}"`);
      } else {
        logger.info(`Preserve-pin OFF: "${target.label}"`);
      }
      return next;
    };
    for (const node of this.nodes.values()) {
      if (node.id === nodeId) return apply(node);
    }
    for (const agent of this.agents.values()) {
      if (agent.id === nodeId) return apply(agent);
    }
    // §7.11 v2.4 — 위성(persistSatellites)도 대상. iframe 위성을 고정핀으로 고정하면
    // checkIframesAlive 의 grace 자동 제거에서 제외된다(죽은 dev server 보존).
    for (const agent of this.agents.values()) {
      if (!agent.persistSatellites) continue;
      for (const sat of agent.persistSatellites) {
        if (sat.id === nodeId) return apply(sat);
      }
    }
    return null;
  }

  /**
   * disappearing 상태 + disappearAt 경과한 버블을 실제 삭제.
   * 반환: 제거된 건수.
   */
  pruneDisappearing(): number {
    this.bumpMutationVersion();
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [nodePath, node] of this.nodes) {
      if (node.status !== 'disappearing' || !node.disappearAt) continue;
      if (node.preservePinned) continue;
      if (now >= node.disappearAt) {
        toRemove.push(nodePath);
      }
    }

    for (const nodePath of toRemove) {
      const node = this.nodes.get(nodePath);
      if (node) {
        this.removeBubble(node.id);
        logger.debug(`Disappeared: "${node.label}"`);
      }
    }

    // 에이전트도 확인
    const agentIds: string[] = [];
    for (const [sessionId, agent] of this.agents) {
      if (agent.status !== 'disappearing' || !agent.disappearAt) continue;
      if (agent.preservePinned) continue;
      if (now >= agent.disappearAt) {
        agentIds.push(sessionId);
      }
    }
    for (const sessionId of agentIds) {
      const agent = this.agents.get(sessionId);
      if (agent) {
        this.removeBubble(agent.id);
        logger.debug(`Disappeared: agent "${agent.label}"`);
      }
    }

    return toRemove.length + agentIds.length;
  }

  /**
   * disappearing 버블의 소멸 중단/재개 토글.
   * 중단 시 status→idle, 필드 클리어.
   * 재개 시 다시 disappearing + 타이머 리셋.
   * 반환: true=소멸 중단됨(pinned), false=소멸 재개됨, null=대상 없음.
   */
  toggleDisappearPause(nodeId: string, durationSec: number): boolean | null {
    for (const node of this.nodes.values()) {
      if (node.id !== nodeId) continue;

      if (node.status === 'disappearing') {
        // 소멸 중단
        node.status = 'idle';
        node.disappearStartedAt = undefined;
        node.disappearAt = undefined;
        // ghost pinned 동기화
        if (node.ghostInfo) node.ghostInfo.pinned = true;
        logger.info(`Disappear paused: "${node.label}"`);
        return true;
      } else {
        // 소멸 재개
        const now = Date.now();
        node.status = 'disappearing';
        node.disappearStartedAt = now;
        node.disappearAt = now + durationSec * 1000;
        if (node.ghostInfo) node.ghostInfo.pinned = false;
        logger.info(`Disappear resumed: "${node.label}" in ${durationSec}s`);
        return false;
      }
    }
    return null;
  }

  // ─── Ghost 버블 ───

  /**
   * 파일/폴더/worktree 노드를 ghost로 전환 + disappearing 설정.
   * 위성/독립 위치 유지. 에이전트/루트/bash/이미 ghost인 노드는 건너뜀.
   */
  private convertToGhost(nodePath: string, changeType: GhostChangeType, toPath?: string): void {
    const node = this.nodes.get(nodePath);
    if (!node) return;
    if (node.bubbleType === 'agent' || node.bubbleType === 'root' ||
        node.bubbleType === 'bash' || node.bubbleType === 'ghost') return;

    // ghost로 넘어가면 이후 checkFileExistence 가 스킵하므로 누적 miss 정리
    this.existenceMissCount.delete(nodePath);

    const now = Date.now();
    // preserve-pin 가드 (§2.4 v1.28): ghost 전환은 허용하되 자동 fade 차단
    const preserved = node.preservePinned === true;
    const ghostInfo: GhostInfo = {
      changeType,
      originalBubbleType: node.bubbleType,
      fromPath: nodePath,
      toPath,
      ghostedAt: now,
      pinned: preserved,
    };

    node.bubbleType = 'ghost';
    node.ghostInfo = ghostInfo;
    node.pinned = false;
    if (preserved) {
      node.status = 'idle';
      node.disappearStartedAt = undefined;
      node.disappearAt = undefined;
    } else {
      node.status = 'disappearing';
      node.disappearStartedAt = now;
      node.disappearAt = now + GHOST_FADE_DURATION;
    }

    logger.info(`Ghost: "${node.label}" (${changeType}${toPath ? ` → ${toPath}` : ''})${preserved ? ' [preserved]' : ''}`);
  }

  /**
   * 모든 파일/폴더 노드의 디스크 경로를 검증.
   * 사라진 경로 → ghost + disappearing 전환. 반환: ghost로 전환된 건수.
   */
  checkFileExistence(): number {
    this.bumpMutationVersion();
    let converted = 0;
    for (const [nodePath, node] of this.nodes) {
      if (node.bubbleType === 'ghost' || node.bubbleType === 'agent' ||
          node.bubbleType === 'root' || node.bubbleType === 'bash') continue;
      // `__special__` 가상 버블만 스킵. `__ext__` 외부 노드는 resolveAbsolutePath 가 실경로로 변환하므로 통과시킨다.
      if (nodePath.startsWith('__special__')) continue;

      const absPath = this.resolveAbsolutePath(nodePath);
      if (!absPath) continue;

      try {
        if (!fs.existsSync(absPath)) {
          // 디바운스: 연속 miss가 임계에 도달해야 진짜 삭제로 판정.
          // 에디터 atomic-save(temp+rename)·git·빌드툴이 파일을 찰나 치우는 동안의
          // 단발 miss로 실재 파일이 ghost→소멸되던 버그 방지.
          const misses = (this.existenceMissCount.get(nodePath) ?? 0) + 1;
          if (misses >= FILE_EXISTENCE_MISS_THRESHOLD) {
            this.existenceMissCount.delete(nodePath);
            this.convertToGhost(nodePath, 'deleted');
            converted++;
          } else {
            this.existenceMissCount.set(nodePath, misses);
          }
        } else {
          // 다시 존재하면 누적 miss 리셋 (transient 복구)
          this.existenceMissCount.delete(nodePath);
        }
      } catch {
        // 접근 불가 시 무시 (miss 카운트도 건드리지 않음 — 권한 일시 오류로 소멸 금지)
      }
    }
    return converted;
  }

  /**
   * 새 노드 생성 시 같은 디렉토리의 최근 ghost에서 데이터 이관 시도.
   * rename 감지: 같은 부모 디렉토리 + ghost 생성 30초 이내 → rename으로 추정.
   * 이관 대상: fileEdits, nodeAgentRefs, activity 수.
   */
  private tryMigrateFromGhost(newNodePath: string): void {
    const newParent = newNodePath.includes('/')
      ? newNodePath.substring(0, newNodePath.lastIndexOf('/'))
      : '';
    const now = Date.now();
    /** rename 감지 허용 시간 (ms) */
    const RENAME_WINDOW = 30_000;

    let bestGhost: { path: string; node: BubbleData } | null = null;
    let bestAge = Infinity;

    for (const [nodePath, node] of this.nodes) {
      if (node.bubbleType !== 'ghost' || !node.ghostInfo) continue;
      if (node.ghostInfo.changeType !== 'deleted') continue; // 이미 renamed인 건 스킵

      const ghostParent = nodePath.includes('/')
        ? nodePath.substring(0, nodePath.lastIndexOf('/'))
        : '';
      if (ghostParent !== newParent) continue;

      const age = now - node.ghostInfo.ghostedAt;
      if (age > RENAME_WINDOW) continue;

      // 같은 디렉토리에서 가장 최근 ghost 선택
      if (age < bestAge) {
        bestAge = age;
        bestGhost = { path: nodePath, node };
      }
    }

    if (!bestGhost || !bestGhost.node.ghostInfo) return;

    // rename으로 전환
    bestGhost.node.ghostInfo.changeType = 'renamed';
    bestGhost.node.ghostInfo.toPath = newNodePath;

    // fileEdits 이관 (ghost 경로 → 새 경로)
    const oldEdits = this.fileEdits.get(bestGhost.path);
    if (oldEdits && oldEdits.length > 0) {
      const newEdits = this.fileEdits.get(newNodePath) ?? [];
      this.fileEdits.set(newNodePath, [...newEdits, ...oldEdits]);
    }

    // nodeAgentRefs 이관
    const oldRefs = this.nodeAgentRefs.get(bestGhost.path);
    if (oldRefs && oldRefs.size > 0) {
      let newRefs = this.nodeAgentRefs.get(newNodePath);
      if (!newRefs) {
        newRefs = new Set();
        this.nodeAgentRefs.set(newNodePath, newRefs);
      }
      for (const ref of oldRefs) newRefs.add(ref);
    }

    // activity 이관
    const newNode = this.nodes.get(newNodePath);
    if (newNode) {
      newNode.activity += bestGhost.node.activity;
    }

    logger.info(`Ghost rename detected: "${bestGhost.node.label}" → "${newNodePath}"`);
  }

  /**
   * idle 상태 + BUBBLE_TTL 경과한 노드/에이전트를 서버 메모리에서 실제 삭제.
   * 반환: 삭제된 건수.
   */
  /** 비활성화: idle 버블 자동 삭제 없음 */
  pruneExpired(): number {
    return 0;
  }

  /** 노드 키 → 절대 경로 변환 (가상 버블은 null, 경로 탈출 시 null) */
  resolveAbsolutePath(key: string): string | null {
    if (key.startsWith('__special__')) return null;
    if (key.startsWith('__ext__')) return key.substring(7);
    // 워크트리 네임스페이스 키 `wt<hash36>__...` 처리
    //  - `wt<hash>____ext__<absPath>` (외부 폴더/파일) → absPath 그대로 반환
    //  - `wt<hash>__<relativePath>` (워크트리 내부 파일/폴더) → worktree cwd 하위 경로로 해석
    if (/^wt[0-9a-z]+__/.test(key)) {
      const sep = key.indexOf('__');
      const rest = key.substring(sep + 2);
      // 외부 폴더/파일 케이스: rest 가 `__ext__` 로 시작
      // (§2.1 v1.55 — 평탄화된 외부 폴더 키는 `wt<hash>____ext__<absPath>` 또는 그 폴더의 satellite 파일 `wt<hash>____ext__<absPath>/<name>`)
      if (rest.startsWith('__ext__')) {
        return rest.substring(7);
      }
      const hashPart = key.substring(2, sep);
      // hash 매칭하는 worktree 찾기
      for (const info of this.projects.values()) {
        if (!info.parentProjectPath) continue;
        const wtHash = hashString(normalize(info.path)).toString(36);
        if (wtHash === hashPart) {
          return validatePathWithinRoot(rest, info.path);
        }
      }
      return null;
    }
    if (ProjectGraph.isRootKey(key)) {
      const projName = ProjectGraph.projectNameFromRootKey(key);
      if (projName) {
        const proj = this.getProjectByName(projName);
        if (proj) return proj.path;
      }
      return this.root ?? null;
    }
    if (path.isAbsolute(key)) return key;
    // 노드별 프로젝트 이름 → ProjectInfo.path로 루트 해석
    const projectName = this.nodeProjectNames.get(key);
    const root = projectName ? (this.getProjectByName(projectName)?.path ?? this.root) : this.root;
    if (!root) return null;
    // path traversal 방지: root 내부 경로만 허용
    return validatePathWithinRoot(key, root);
  }

  /** 비활성화: 디스크 삭제된 파일 버블 자동 제거 안 함 (수동 삭제만 허용) */
  pruneDeletedFiles(): string[] {
    return [];
  }

  // ─── 폴더 파일 트리 ───

  /** 무시할 디렉토리 이름 */
  private static readonly IGNORED_DIRS: ReadonlySet<string> = new Set([
    'node_modules', '.git', '.next', 'dist', 'build', '.cache', '.turbo',
    'coverage', '.svelte-kit', '__pycache__', '.venv', 'save',
  ]);

  /** 폴더 노드의 파일 트리를 디스크에서 읽어 반환 */
  listFolderFiles(nodePath: string): FolderFileEntry[] | null {
    const absPath = this.resolveAbsolutePath(nodePath);
    if (!absPath) return null;
    try {
      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) return null;
    } catch { return null; }

    // 이 폴더에 등록된 위성 파일 경로 Set
    const satSet = this.satelliteMap.get(nodePath) ?? new Set<string>();

    // root 키는 relDir을 빈 문자열로 시작 (파일 경로가 'packages/...' 형태가 되도록)
    const relDir = ProjectGraph.isRootKey(nodePath) ? '' : nodePath;
    return this.readDirTree(absPath, relDir, satSet);
  }

  /** 재귀적으로 디렉토리 트리 읽기 */
  private readDirTree(absDir: string, relDir: string, satSet: Set<string>): FolderFileEntry[] {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch { return []; }

    const result: FolderFileEntry[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.isDirectory()) continue;
      if (entry.isDirectory() && ProjectGraph.IGNORED_DIRS.has(entry.name)) continue;

      // normalize로 소문자 변환된 경로와 매칭하기 위해 소문자 사용
      const relPath = (relDir ? `${relDir}/${entry.name}` : entry.name).toLowerCase();

      if (entry.isDirectory()) {
        const children = this.readDirTree(path.join(absDir, entry.name), relPath, satSet);
        result.push({
          name: entry.name,
          relativePath: relPath,
          isDirectory: true,
          children,
          isSatellite: satSet.has(relPath),
        });
      } else {
        result.push({
          name: entry.name,
          relativePath: relPath,
          isDirectory: false,
          isSatellite: satSet.has(relPath),
        });
      }
    }

    // 디렉토리 먼저, 파일 나중 (각각 알파벳 순)
    result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return result;
  }

  /** 위성 토글 — show: true면 위성 등록, false면 제거. 파일/폴더 모두 지원 */
  toggleSatellite(folderPath: string, filePath: string, show: boolean): boolean {
    // 내부 경로는 소문자로 정규화 (toRelative/normalize와 일치)
    const normFolder = ProjectGraph.isRootKey(folderPath) ? folderPath : folderPath.toLowerCase();
    const normFile = filePath.toLowerCase();
    // 폴더의 프로젝트 정보로 파일 경로 해석 (다중 프로젝트 대응)
    const folderProjectName = this.nodeProjectNames.get(normFolder);
    const projectRoot = folderProjectName
      ? (this.getProjectByName(folderProjectName)?.path ?? this.root)
      : this.root;
    const absFile = projectRoot ? validatePathWithinRoot(normFile, projectRoot) : this.resolveAbsolutePath(normFile);
    if (!absFile || !fs.existsSync(absFile)) {
      logger.warn(`toggleSatellite failed: folder=${normFolder} file=${normFile} root=${projectRoot ?? 'null'} abs=${absFile ?? 'null'}`);
      return false;
    }
    folderPath = normFolder;
    filePath = normFile;
    // 파일에도 프로젝트 이름 기록 (향후 resolveAbsolutePath에서 활용)
    if (folderProjectName) this.nodeProjectNames.set(normFile, folderProjectName);

    const isDir = fs.statSync(absFile).isDirectory();

    if (show) {
      // 노드가 없으면 생성 (위성 전용 — children/topLevel에는 등록하지 않음)
      const bubbleType: BubbleType = isDir ? 'internal_folder' : 'file';
      // 수동 토글로 꺼낸 노드는 에이전트 툴 활동이 아니므로 idle pre-state로 교정
      // (upsertNode는 툴 이벤트 전용이라 무조건 status='active'를 박음 — toggleRootChild와 동일 교정)
      const manualNodes: BubbleData[] = [];
      manualNodes.push(this.upsertNode(filePath, bubbleType, 'manual', !isDir));

      // 계층 생성: folderPath ~ filePath 사이의 중간 폴더 노드 + parent-child 등록
      const fileSegments = filePath.split('/');
      const folderDepth = ProjectGraph.isRootKey(folderPath)
        ? 0
        : folderPath.split('/').length;

      // 중간 폴더들 (folderPath 바로 아래 ~ 파일 직전)
      for (let i = folderDepth; i < fileSegments.length - 1; i++) {
        const intermediatePath = fileSegments.slice(0, i + 1).join('/');
        const parentPath: string = i === 0
          ? (ProjectGraph.isRootKey(folderPath) ? folderPath : fileSegments[0] ?? folderPath)
          : fileSegments.slice(0, i).join('/');
        manualNodes.push(this.upsertNode(intermediatePath, 'internal_folder', 'manual', false));
        if (folderProjectName) this.nodeProjectNames.set(intermediatePath, folderProjectName);
        // folderDepth === 0 이면 최상위이므로 topLevelPaths에 추가
        if (i === 0 && ProjectGraph.isRootKey(folderPath)) {
          this.topLevelPaths.add(intermediatePath);
        }
        if (i > folderDepth || (i === folderDepth && !ProjectGraph.isRootKey(folderPath))) {
          this.registerChild(parentPath, intermediatePath);
        } else if (i === 0 && ProjectGraph.isRootKey(folderPath)) {
          // root key의 직접 자식은 registerChild 불필요 (topLevelPaths로 관리)
        }
      }

      // 파일을 직접 부모에 등록
      const fileParent = fileSegments.length > 1
        ? fileSegments.slice(0, -1).join('/')
        : folderPath;
      if (fileSegments.length > 1) {
        this.registerChild(fileParent, filePath);
      } else if (ProjectGraph.isRootKey(folderPath)) {
        // 단일 세그먼트 파일은 topLevelPaths에 추가
        this.topLevelPaths.add(filePath);
      }

      // 위성 등록 — folderPath + 모든 중간 폴더에 등록 (각 계층에서 자식 폴더에 위성이 붙도록)
      const satFolders: string[] = [folderPath];
      for (let i = folderDepth; i < fileSegments.length - 1; i++) {
        satFolders.push(fileSegments.slice(0, i + 1).join('/'));
      }
      for (const sf of satFolders) {
        let set = this.satelliteMap.get(sf);
        if (!set) { set = new Set(); this.satelliteMap.set(sf, set); }
        set.add(filePath);
      }
      // 이전 코드 호환: childrenMap에 잘못 등록된 항목 정리
      const kids = this.childrenMap.get(folderPath);
      if (kids) kids.delete(filePath);

      // 수동 토글 노드 idle 교정 — 라이브 툴 이벤트가 도착하면 upsertNode가 다시 active로 올림
      for (const n of manualNodes) {
        n.status = 'idle';
        n.activity = 0;
      }
    } else {
      // 위성에서만 제거 (노드는 유지)
      for (const [, set] of this.satelliteMap) {
        set.delete(filePath);
      }
      // 사용자가 체크 해제 → 해당 파일에 연결된 엣지 제거(고아 라인 방지)
      const target = this.nodes.get(filePath);
      if (target) {
        this.mainEdges.removeByPredicate((e) => e.source === target.id || e.target === target.id);
        this.innerEdges.removeByPredicate((e) => e.source === target.id || e.target === target.id);
      }
    }

    return true;
  }

  /** 루트 패널에서 파일/폴더를 독립 버블로 캔버스에 추가/제거 */
  toggleRootChild(projectName: string, filePath: string, show: boolean): boolean {
    const proj = this.getProjectByName(projectName);
    if (!proj) return false;
    const normFile = filePath.toLowerCase();
    const absPath = proj.path + '/' + normFile;
    if (!fs.existsSync(absPath)) return false;

    if (show) {
      const isDir = fs.statSync(absPath).isDirectory();
      const bubbleType: BubbleType = isDir ? 'internal_folder' : 'file';
      const node = this.upsertNode(normFile, bubbleType, 'manual', !isDir);
      node.status = 'idle';
      node.pinned = true;
      this.topLevelPaths.add(normFile);
      this.nodeProjectNames.set(normFile, projectName);
    } else {
      const node = this.nodes.get(normFile);
      if (node) {
        node.pinned = false;
        // 사용자가 체크 해제 → 해당 노드에 연결된 엣지 제거(고아 라인 방지)
        this.mainEdges.removeByPredicate((e) => e.source === node.id || e.target === node.id);
        this.innerEdges.removeByPredicate((e) => e.source === node.id || e.target === node.id);
      }
      this.topLevelPaths.delete(normFile);
    }

    return true;
  }

  /** 폴더 내부 Root에서 자식 버블 추가/제거 */
  toggleFolderChild(parentPath: string, filePath: string, show: boolean): boolean {
    const parentNode = this.nodes.get(parentPath);
    if (!parentNode) return false;
    // filePath is already a full relative path from listFolderFiles (e.g., "packages/client/src/utils")
    const childKey = filePath.toLowerCase();
    const absChild = this.resolveAbsolutePath(childKey);
    if (!absChild || !fs.existsSync(absChild)) return false;

    if (show) {
      const isDir = fs.statSync(absChild).isDirectory();
      const bubbleType: BubbleType = isDir ? 'internal_folder' : 'file';
      const node = this.upsertNode(childKey, bubbleType, 'manual', !isDir);
      node.status = 'idle';
      node.pinned = true;
      this.registerChild(parentPath, childKey);
    } else {
      const node = this.nodes.get(childKey);
      if (node) {
        node.pinned = false;
        // 사용자가 체크 해제 → 해당 노드에 연결된 엣지 제거(고아 라인 방지)
        this.mainEdges.removeByPredicate((e) => e.source === node.id || e.target === node.id);
        this.innerEdges.removeByPredicate((e) => e.source === node.id || e.target === node.id);
      }
      const children = this.childrenMap.get(parentPath);
      if (children) {
        children.delete(childKey);
        if (parentNode) parentNode.childCount = children.size;
      }
    }

    return true;
  }

  // ─── 내부 메서드 ───

  /** JSONL에서 에이전트별 유저 메시지 읽기 (캐시 TTL 5초) */
  private buildAgentEvents(): Record<string, AgentEvent[]> {
    const now = Date.now();
    if (now - this.agentEventsCache.updatedAt < ProjectGraph.EVENT_CACHE_TTL) {
      return this.agentEventsCache.data;
    }
    const result: Record<string, AgentEvent[]> = {};
    for (const [sessionId, cwd] of this.sessionCwds) {
      const agent = this.agents.get(sessionId);
      if (!agent) continue;
      // §4 v2.68 — CMD(인터랙티브 터미널) 결과 소싱. CMD 대화는 합성 세션(custom-…)이 아니라 claude
      //   대화 UUID(.jsonl)에 쌓인다(hook 이 session_id 를 합성 세션으로 rewrite → readUserMessages(cwd,
      //   합성세션)은 항상 빈 배열). recordCmdTermSession 이 적어둔 termId→UUID 맵에서 UUID 들을 모아
      //   각각 읽어 합친다(세션 탭이 여러 개면 여러 UUID). 병합 시 id 에 UUID 접두 → React 키 충돌 방지.
      const isCmd = this.agentConfigs.get(agent.id)?.executionMode === 'interactive-terminal';
      let events: AgentEvent[];
      if (isCmd) {
        const merged: AgentEvent[] = [];
        for (const uuid of getCmdSessionIds(agent.id)) {
          for (const e of readUserMessages(cwd, uuid)) {
            merged.push({ ...e, id: `${uuid}:${e.id}` });
          }
        }
        merged.sort((a, b) => b.timestamp - a.timestamp);
        events = merged.slice(0, MAX_AGENT_EVENTS);
      } else {
        events = readUserMessages(cwd, sessionId);
      }
      if (events.length === 0) continue;

      // poppedCommands 매칭 — JSONL user 메시지 텍스트 ↔ pop된 명령 텍스트
      const popped = this.poppedCommandsRef.get(sessionId);
      for (const evt of events) {
        const match = popped?.find((p) => p.text === evt.message);
        if (match) {
          evt.source = 'queue';
          evt.queuedAt = match.queuedAt;
        } else {
          evt.source = 'user';
        }
      }

      // completed 에이전트: 마지막 프롬프트의 response에 summary 합산
      if (agent.summary && events.length > 0) {
        const last = events[0]!; // 최신순이므로 [0]이 마지막 프롬프트
        const existing = last.response ?? '';
        last.response = existing
          ? `${existing}\n\n${agent.summary}`
          : agent.summary;
      }

      result[agent.id] = events;
    }
    this.agentEventsCache = { data: result, updatedAt: now };
    return result;
  }

  /** cwd → 가장 깊이 매치하는 ProjectInfo (worktree와 부모가 모두 매치되면 worktree 우선). 없으면 null. */
  private getProjectForCwd(cwd: string): ProjectInfo | null {
    const norm = normalize(cwd);
    let best: ProjectInfo | null = null;
    let bestLen = -1;
    for (const info of this.projects.values()) {
      const rootNorm = normalize(info.path);
      const match = norm === rootNorm || norm.startsWith(rootNorm + '/');
      if (!match) continue;
      if (rootNorm.length > bestLen) {
        best = info;
        bestLen = rootNorm.length;
      }
    }
    return best;
  }

  /**
   * 워크트리 이주 검사 + 실행.
   * - 에이전트가 워크트리 내부 파일을 건드리면 그 워크트리로 이주. 단방향 아님(v1.76):
   *   같은 root repo 안에서 부모→WT 뿐 아니라 WT A→WT B 도 재이주.
   * - 자기 워크트리 내부 작업은 재이주 ❌(thrash 방지), 부모/타 repo 파일은 external 로 표시.
   * - 트리거: write/edit 1회 즉시, read 누적 WORKTREE_READ_MIGRATION_THRESHOLD 회.
   * - migration 이 일어났으면 true 반환 (호출자는 projectPath 재계산 가능).
   */
  private maybeMigrateAgentToWorktree(sessionId: string, agentId: string, filePath: string, toolName: string): boolean {
    const currentCwd = this.sessionCwds.get(sessionId);
    if (!currentCwd) return false;
    const currentProject = this.getProjectForCwd(currentCwd);
    if (!currentProject) return false;
    // 파일 경로의 소속 프로젝트 — 워크트리가 아니면 무시
    const targetProject = this.getProjectForCwd(filePath);
    if (!targetProject || !targetProject.parentProjectPath) return false;
    // 같은 root repo 안에서만 재이주. master/부모는 자기 path 가 root, 워크트리는 parentProjectPath 가 root.
    // → master→워크트리뿐 아니라 워크트리 A→워크트리 B 도 (같은 repo면) 이주한다(단방향 락 제거, v1.76).
    const currentRoot = normalize(currentProject.parentProjectPath ?? currentProject.path);
    if (currentRoot !== normalize(targetProject.parentProjectPath)) return false; // 다른 repo 워크트리 → 무관
    // 이미 그 워크트리 안(자기 워크트리 내부 작업)이면 재이주 안 함 — 단방향 락 대체, thrash 방지.
    if (normalize(targetProject.path) === normalize(currentProject.path)) return false;

    const targetKey = normalize(targetProject.path);
    const isReadOnly = READ_TOOLS.has(toolName);

    if (!isReadOnly) {
      this.executeWorktreeMigration(sessionId, agentId, targetProject);
      return true;
    }

    // read 계열 누적
    let counts = this.agentWorktreeReadCounts.get(sessionId);
    if (!counts) {
      counts = new Map();
      this.agentWorktreeReadCounts.set(sessionId, counts);
    }
    const next = (counts.get(targetKey) ?? 0) + 1;
    counts.set(targetKey, next);
    if (next >= ProjectGraph.WORKTREE_READ_MIGRATION_THRESHOLD) {
      this.executeWorktreeMigration(sessionId, agentId, targetProject);
      return true;
    }
    return false;
  }

  /**
   * 실제 이주 동작 — sessionCwds 를 워크트리 path 로 갱신하고, 에이전트가 이전 위치(마스터/부모
   * 또는 다른 워크트리)에서 만지던 노드/엣지를 워크트리 namespace 로 carry. 단순 삭제 ❌ —
   * 사용자가 작업해온 흔적이 워크트리 안에 그대로 보여야 함. (A→B 재이주 시 이미 namespace 된
   * A 노드는 carry 가 skip 하여 A 캔버스에 잔존, 에이전트만 B 로 재홈 — 이중 prefix 차단.)
   *
   * carry 정책:
   *  - 단독 ref(이 에이전트만 만진 노드): 키를 `wtPrefix + 기존키` 로 re-key, 워크트리 children 으로 재부착, 엣지 id 도 remap.
   *  - 공유 ref(다른 에이전트도 만지는 노드): 마스터 캔버스에 남겨두되 이 에이전트의 ref 만 끊는다. (그 노드는 다른 에이전트의 view 를 깨면 안 되므로)
   */
  private executeWorktreeMigration(sessionId: string, agentId: string, target: ProjectInfo): void {
    const prevCwd = this.sessionCwds.get(sessionId) ?? '';
    this.sessionCwds.set(sessionId, target.path);
    this.agentWorktreeReadCounts.delete(sessionId);

    const worktreeBubbleKey = normalize(target.path);
    const wtPrefix = `wt${hashString(worktreeBubbleKey).toString(36)}__`;

    this.carryAgentNodesToWorktree(agentId, worktreeBubbleKey, wtPrefix, target.name);

    logger.info(
      `Agent migrated to worktree: session=${sessionId.slice(0, 8)} ` +
      `agentId=${agentId} from="${prevCwd}" to="${target.path}"`,
    );
    dbg('agent.migrate.worktree', { sessionId, agentId, from: prevCwd, to: target.path });
  }

  /**
   * 에이전트가 ref 한 노드를 워크트리 namespace 로 carry.
   *  단독 ref → re-key 후 워크트리 children 으로 재부착. nodes/topLevelPaths/childrenMap/satelliteMap/nodeAgentRefs/nodeProjectNames + 엣지 id 모두 갱신.
   *  공유 ref → 이 에이전트만 ref 에서 빠진다(다른 에이전트의 캔버스를 보존).
   *  worktree/root 타입 또는 이미 wt-namespaced 된 키는 carry 대상이 아님.
   */
  private carryAgentNodesToWorktree(agentId: string, worktreeBubbleKey: string, wtPrefix: string, projectName: string): void {
    const ownedKeys: string[] = [];
    for (const [nodePath, refs] of this.nodeAgentRefs) {
      if (refs.has(agentId)) ownedKeys.push(nodePath);
    }
    if (ownedKeys.length === 0) return;

    const idMap = new Map<string, string>();
    const otherActive = this.getActiveAgentIds(agentId);

    // 깊은 키부터 처리해야 부모를 처리할 때 자식이 이미 새 키로 바뀐 상태가 보장된다 (childrenMap 일관성).
    ownedKeys.sort((a, b) => b.split('/').length - a.split('/').length);

    for (const oldKey of ownedKeys) {
      const refs = this.nodeAgentRefs.get(oldKey);
      if (!refs) continue;
      const node = this.nodes.get(oldKey);

      // 비rekey 대상: 노드가 이미 사라졌거나 worktree/root/이미 namespaced
      const isAlreadyNamespaced = /^wt[0-9a-z]+__/.test(oldKey);
      const isExtKey = oldKey.startsWith('__ext__') || /^wt[0-9a-z]+__ext__/.test(oldKey);
      const skipRekey =
        !node ||
        node.bubbleType === 'worktree' ||
        node.bubbleType === 'root' ||
        isAlreadyNamespaced ||
        isExtKey;

      if (skipRekey) {
        // 단순 ref/edge 정리만
        refs.delete(agentId);
        if (refs.size === 0) this.nodeAgentRefs.delete(oldKey);
        continue;
      }

      // 활성 에이전트 기준 unique 판정 — idle 한 과거 에이전트의 잔여 ref 는 carry 에 영향 안 줌.
      // 같은 파일을 다른 ACTIVE 에이전트도 만지는 경우만 "공유" 로 판정해 carry 스킵(다른 에이전트 캔버스 보존).
      let sharedWithActive = false;
      for (const otherId of refs) {
        if (otherId !== agentId && otherActive.has(otherId)) {
          sharedWithActive = true;
          break;
        }
      }
      if (sharedWithActive) {
        refs.delete(agentId);
        continue;
      }

      // 단독 ref → re-key
      const newKey = `${wtPrefix}${oldKey}`;
      const newId = node!.bubbleType === 'file'
        ? `file-${hashString(`${this.nodeScope()}::${newKey}`)}`
        : `folder-${hashString(`${this.nodeScope()}::${newKey}`)}`;
      const oldId = node!.id;

      // nodes Map 이전
      this.nodes.delete(oldKey);
      node!.path = newKey;
      node!.id = newId;
      this.nodes.set(newKey, node!);
      idMap.set(oldId, newId);

      // nodeAgentRefs 이전
      this.nodeAgentRefs.delete(oldKey);
      this.nodeAgentRefs.set(newKey, new Set([agentId]));

      // topLevelPaths: 마스터 top-level 이었으면 worktree children 으로 이전
      const wasTopLevel = this.topLevelPaths.has(oldKey);
      if (wasTopLevel) {
        this.topLevelPaths.delete(oldKey);
        this.registerChild(worktreeBubbleKey, newKey);
      }

      // childrenMap: 부모의 children set 안의 oldKey → newKey 치환
      for (const [, childSet] of this.childrenMap) {
        if (childSet.has(oldKey)) {
          childSet.delete(oldKey);
          childSet.add(newKey);
        }
      }
      // 자기 자신이 부모로서 가진 children 컬렉션도 키 이전
      const ownChildren = this.childrenMap.get(oldKey);
      if (ownChildren) {
        this.childrenMap.delete(oldKey);
        this.childrenMap.set(newKey, ownChildren);
      }

      // satelliteMap: 부모 키로 가진 sats 이전 + 다른 부모의 sats set 안의 oldKey → newKey
      const ownSats = this.satelliteMap.get(oldKey);
      if (ownSats) {
        this.satelliteMap.delete(oldKey);
        this.satelliteMap.set(newKey, ownSats);
      }
      for (const [, satSet] of this.satelliteMap) {
        if (satSet.has(oldKey)) {
          satSet.delete(oldKey);
          satSet.add(newKey);
        }
      }

      // nodeProjectNames 이전 → worktree project 로 갱신
      this.nodeProjectNames.delete(oldKey);
      this.nodeProjectNames.set(newKey, projectName);
    }

    // 엣지 id remap (mainEdges + innerEdges)
    if (idMap.size > 0) {
      this.mainEdges.remapIds(idMap);
      this.innerEdges.remapIds(idMap);
    }

    // 공유 노드들의 엣지 cleanup (이 에이전트만 ref 에서 제거 — 다른 에이전트가 살아있으면 idle 안 됨)
    this.mainEdges.removeAgentRefs(agentId, otherActive);
    this.innerEdges.removeAgentRefs(agentId, otherActive);

    logger.info(`Carried ${idMap.size} unique nodes + ${ownedKeys.length - idMap.size} shared cleared for agent=${agentId} → worktree=${projectName}`);
    dbg('agent.carry.worktree', {
      agentId,
      worktreeBubbleKey,
      projectName,
      ownedTotal: ownedKeys.length,
      uniqueRekeyed: idMap.size,
      sharedCleared: ownedKeys.length - idMap.size,
    });
  }

  /** agent ID → project name 매핑. worktree 세션은 PID.json cwd가 부모이든 worktree이든 worktree 소속으로 stamp (todo0417 A-2). */
  private buildAgentProjects(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [sessionId, cwd] of this.sessionCwds) {
      const agent = this.agents.get(sessionId);
      if (!agent) continue;
      const proj = this.getProjectForCwd(cwd);
      result[agent.id] = proj?.name ?? (path.basename(cwd) || 'unknown');
    }
    return result;
  }

  /** agentId → project name (소속 확인용, 못 찾으면 null). SSOT §3.5 프로젝트 독립성 검증용. */
  getAgentProjectName(agentId: string): string | null {
    for (const [sessionId, cwd] of this.sessionCwds) {
      const agent = this.agents.get(sessionId);
      if (agent?.id !== agentId) continue;
      const proj = this.getProjectForCwd(cwd);
      return proj?.name ?? (path.basename(cwd) || 'unknown');
    }
    return null;
  }

  /** agentId → 소속 프로젝트의 디스크 path (스킬 스캔 등 경로 작업용). 못 찾으면 null. */
  getAgentProjectPath(agentId: string): string | null {
    for (const [sessionId, cwd] of this.sessionCwds) {
      const agent = this.agents.get(sessionId);
      if (agent?.id !== agentId) continue;
      return this.getProjectForCwd(cwd)?.path ?? (cwd || null);
    }
    return null;
  }

  /** node ID → project basename 매핑 (topFolders 프로젝트 필터용) */
  private buildNodeProjects(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [nodePath, projectName] of this.nodeProjectNames) {
      const node = this.nodes.get(nodePath);
      if (node) result[node.id] = projectName;
    }
    // root 노드도 포함
    for (const info of this.projects.values()) {
      const key = ProjectGraph.rootKeyFor(info.name);
      const node = this.nodes.get(key);
      if (node) result[node.id] = info.name;
    }
    return result;
  }

  /** commandQueues sessionId → agentId 변환 (스냅샷용) */
  private buildCommandQueuesRecord(): Record<string, QueuedCommand[]> {
    const result: Record<string, QueuedCommand[]> = {};
    for (const [sessionId, cmds] of this.commandQueuesRef) {
      if (cmds.length === 0) continue;
      const agentId = this.resolveCommandOwnerAgentId(sessionId);
      if (!agentId) continue;
      result[agentId] = result[agentId] ? [...result[agentId], ...cmds] : [...cmds];
    }
    return result;
  }

  /** Bash 명령을 히스토리에 기록 / output 매칭 */
  private recordBashEntry(payload: HookEventPayload): void {
    if (!payload.tool_input) return;
    const isPost = payload.hook_event_name === 'PostToolUse';
    const toolUseId = payload.tool_use_id;

    if (isPost) {
      // PostToolUse → 기존 엔트리에 output 매칭
      if (toolUseId) {
        const existing = this.bashEntryIndex.get(toolUseId);
        if (existing) {
          existing.output = extractBashOutput(payload.tool_response);
        }
      }
      // run_in_background 응답에서 shell_id + output 경로 파싱 → 파일 감시 시작
      if (payload.tool_input['run_in_background'] === true) {
        this.attachBackgroundShell(payload);
      }
      return;
    }

    // PreToolUse → 새 엔트리 생성
    const command = typeof payload.tool_input['command'] === 'string'
      ? payload.tool_input['command']
      : '';
    if (!command) return;

    const sid = payload.session_id;
    const entry: BashEntry = {
      id: toolUseId ?? `bash-${Date.now()}-${hashString(command)}`,
      command,
      timestamp: Date.now(),
    };

    let list = this.bashHistory.get(sid);
    if (!list) { list = []; this.bashHistory.set(sid, list); }
    list.unshift(entry);
    if (toolUseId) {
      this.bashEntryIndex.set(toolUseId, entry);
    }
    if (list.length > MAX_BASH_HISTORY) {
      const removed = list.pop();
      if (removed) this.bashEntryIndex.delete(removed.id);
    }

    // run_in_background → 서버 판정.
    // §7.11 v2.21 — strict 1:1: ServerEntry 는 port 가 확정된 시점에만 등록(placeholder ❌).
    // §7.11 v2.24/v2.25 — port 추출은 (extractPort → extractPortFromInlineEval → extractPortFromScriptFile)
    //   3단계 fallback. 같은 PreToolUse 의 Bash 특수도구 블록의 추출기 구성과 대칭이어야 1:1 깨지지 않음.
    // §7.11 v2.20 — probe 명령(curl/wget 등)은 inline-cmd 단축 경로 전면 skip.
    if (payload.tool_input['run_in_background'] === true && !isProbeCommand(command)) {
      const sessionCwd = this.sessionCwds.get(sid) ?? payload.cwd;
      const port = extractPort(command)
        ?? extractPortFromInlineEval(command)
        ?? extractPortFromScriptFile(command, sessionCwd);
      if (port !== undefined) {
        this.registerServerPort(sid, command, port, undefined, undefined, entry.id);
      } else {
        logger.info(`Server registration deferred (no inline port; watcher will probe): "${command.slice(0, 80)}"`);
      }
    }
  }

  /** shellWatcher가 포트를 감지했을 때 매칭 ServerEntry 를 생성하거나 메타 백필한다
   *  (§7.11 v2.21 — strict 1:1: port required). */
  private ensureServerEntryForShell(
    sessionId: string,
    toolUseId: string | undefined,
    command: string,
    shellId: string,
    outputFile: string | undefined,
    port: number,
  ): void {
    this.registerServerPort(sessionId, command, port, shellId, outputFile, toolUseId);
  }

  /**
   * §7.11 v2.21 — ServerEntry 를 **(sessionId, shellId?, port)** 단위로 등록/백필한다.
   * strict 1:1: port 는 required — placeholder 등록 경로 폐기됨(v2.1 의 port=undefined 분기 삭제).
   * 한 background 셸이 여러 포트(monorepo 4800+5173)를 열면 포트마다 entry 1개씩 만들어
   * ServerList 가 살아있는 iframe 위성과 1:1 대응하게 한다.
   * @returns 새 entry 생성됐으면 true(스냅샷 변경). 동일 port 기존 entry 백필이면 false.
   */
  private registerServerPort(
    sessionId: string,
    command: string,
    port: number,
    shellId: string | undefined,
    outputFile: string | undefined,
    toolUseId: string | undefined,
  ): boolean {
    let servers = this.runningServers.get(sessionId);
    if (!servers) { servers = []; this.runningServers.set(sessionId, servers); }

    const baseId = toolUseId ?? (shellId ? `bg-${shellId}` : `cmd-${hashString(command)}`);
    const idFor = (p: number): string => `${baseId}__p${p}`;

    // 같은 셸/명령에 속하는 entry 판정 — 중복 판정 공통 술어
    const sameShell = (s: ServerEntry): boolean =>
      (shellId !== undefined && s.shellId === shellId)
      || (toolUseId !== undefined && (s.id === baseId || s.id.startsWith(`${baseId}__p`)))
      || (s.shellId === undefined && s.command === command);

    // 같은 port 의 기존 entry → 메타 백필 (신규 아님)
    const samePort = servers.find((s) => s.port === port && sameShell(s));
    if (samePort) {
      if (shellId && !samePort.shellId) samePort.shellId = shellId;
      if (outputFile && !samePort.outputFile) samePort.outputFile = outputFile;
      samePort.alive = true;
      return false;
    }

    // 새 포트 entry
    servers.push({
      id: idFor(port), command, port,
      startedAt: Date.now(), alive: true, shellId, outputFile,
    });
    logger.info(`Server registered (port ${port}): "${command.slice(0, 80)}"`);
    return true;
  }

  /**
   * 에이전트 위성으로 iframe 버블 생성 — agent.persistSatellites에 직접 저장.
   * @param fromNewBash true면 dismissed 집합을 해제하고 재생성 허용 (사용자가 Bash로
   *   서버를 새로 시작한 경우). false면 dismissed에 포함된 포트는 skip
   *   (shell watcher 로그 / rehydrate 경로).
   */
  private createIframeSatellite(
    sessionId: string,
    command: string,
    port: number,
    shellId?: string,
    logText?: string,
    fromNewBash = false,
  ): void {
    const iframeKey = `__special__iframe__${sessionId}__${port}`;

    const agent = this.agents.get(sessionId);
    if (!agent) return;

    const dismissedPorts = this.dismissedIframes.get(sessionId);
    if (fromNewBash) {
      // 새 Bash 서버 시작 → 이전 Delete 기록 해제
      dismissedPorts?.delete(port);
    } else if (dismissedPorts?.has(port)) {
      // 사용자가 지웠고 새 Bash도 아니면 재생성 금지
      return;
    }

    if (!agent.persistSatellites) agent.persistSatellites = [];

    // 이미 존재하면 활성화만 (serverKind 재판정 — 로그가 새로 왔을 수 있음).
    // fromNewBash=false 인 idempotent sweep 호출은 status/iframeAlive 강제 활성화 ❌ —
    // 그대로 두면 checkIframesAlive 가 5초마다 dim 시킨 죽은 위성을 다시 active 로 깨워
    // 10초 주기로 깜빡거리는 버그가 발생한다. 메타데이터(shellId/serverKind) 백필만 한다.
    const existing = agent.persistSatellites.find((s) => s.path === iframeKey);
    if (existing) {
      if (fromNewBash) {
        existing.status = 'active';
        existing.lastActivity = Date.now();
        existing.iframeAlive = true;
      }
      if (shellId && !existing.shellId) existing.shellId = shellId;
      if (logText && existing.serverKind !== 'frontend') {
        existing.serverKind = detectServerKind(command, logText);
      }
      // 같은 URL을 가진 다른 에이전트의 오래된 iframe은 제거 (이 에이전트로 이동)
      if (existing.url) this.dedupeIframeSatellitesByUrl(existing.url, sessionId);
      return;
    }

    const kind = detectServerKind(command, logText);
    const url = `http://localhost:${port}`;

    agent.persistSatellites.push({
      id: `special-${hashString(iframeKey)}`,
      label: `localhost:${port}`,
      bubbleType: 'iframe',
      path: iframeKey,
      status: 'active',
      activity: 1,
      lastActivity: Date.now(),
      url,
      serverKind: kind,
      shellId,
      iframeAlive: true,
    });

    logger.info(`iframe satellite created: ${url} (${kind}) → Bash ${sessionId} shell=${shellId ?? '-'}`);
    // 같은 URL을 가진 다른 에이전트의 iframe은 제거 (가장 최근 실행한 이 에이전트만 유지)
    this.dedupeIframeSatellitesByUrl(url, sessionId);
  }

  /**
   * 동일 URL을 가진 iframe 위성이 여러 에이전트에 걸쳐 있으면, keepSessionId로 지정된
   * 에이전트의 것만 유지하고 나머지는 제거. keepSessionId가 없으면 lastActivity가 가장
   * 최근인 것만 유지.
   */
  private dedupeIframeSatellitesByUrl(url: string, keepSessionId?: string): void {
    // 대상 수집 — (sessionId, index, lastActivity)
    const candidates: { sessionId: string; index: number; lastActivity: number }[] = [];
    for (const [sid, agent] of this.agents) {
      if (!agent.persistSatellites) continue;
      agent.persistSatellites.forEach((sat, idx) => {
        if (sat.bubbleType === 'iframe' && sat.url === url) {
          candidates.push({ sessionId: sid, index: idx, lastActivity: sat.lastActivity ?? 0 });
        }
      });
    }
    if (candidates.length <= 1) return;

    // keeper 결정
    let keeper: { sessionId: string; index: number } | null = null;
    if (keepSessionId && candidates.some((c) => c.sessionId === keepSessionId)) {
      keeper = candidates.find((c) => c.sessionId === keepSessionId) ?? null;
    } else {
      const latest = candidates.reduce((a, b) => (a.lastActivity >= b.lastActivity ? a : b));
      keeper = latest;
    }
    if (!keeper) return;

    // keeper 이외 제거 — 인덱스 영향 방지 위해 세션별로 역순 제거
    const toRemoveBySession = new Map<string, number[]>();
    for (const c of candidates) {
      if (c.sessionId === keeper.sessionId && c.index === keeper.index) continue;
      let arr = toRemoveBySession.get(c.sessionId);
      if (!arr) { arr = []; toRemoveBySession.set(c.sessionId, arr); }
      arr.push(c.index);
    }
    for (const [sid, indices] of toRemoveBySession) {
      const agent = this.agents.get(sid);
      if (!agent?.persistSatellites) continue;
      indices.sort((a, b) => b - a);
      for (const idx of indices) agent.persistSatellites.splice(idx, 1);
    }
    logger.info(`iframe dedup: url=${url} kept on session=${keeper.sessionId.slice(0, 8)}, removed ${candidates.length - 1} duplicate(s)`);
  }

  /** 모든 iframe 위성에 대해 URL 단위 dedup (rehydrate 후 일괄 정리용) */
  dedupeAllIframeSatellites(): void {
    const urls = new Set<string>();
    for (const agent of this.agents.values()) {
      for (const sat of agent.persistSatellites ?? []) {
        if (sat.bubbleType === 'iframe' && sat.url) urls.add(sat.url);
      }
    }
    for (const url of urls) this.dedupeIframeSatellitesByUrl(url);
  }

  /** 스냅샷 변경 콜백 설정 (비동기 감시 이벤트에서 broadcast 트리거용) */
  setOnSnapshotChange(cb: () => void): void {
    this.onSnapshotChange = cb;
  }

  /** PostToolUse Bash run_in_background 응답에서 shell_id + output 경로 추출 후 감시 시작 */
  private attachBackgroundShell(payload: HookEventPayload): void {
    const responseText = extractBashOutput(payload.tool_response);
    const parsed = responseText ? parseBackgroundShellResponse(responseText) : null;
    if (!parsed) {
      // §7.11 — 현 Claude Code(SDK-CLI) 의 run_in_background Bash 는 PostToolUse hook 의
      // tool_response 에 "Command running in background … Output is being written to: <path>"
      // 텍스트를 주지 않고, 구조화 필드 `backgroundTaskId` + 빈 stdout/stderr 만 준다
      // (예: {stdout:"",stderr:"",interrupted:false,backgroundTaskId:"buis02lww"}). 그래서
      // extractBashOutput 가 빈 문자열을 돌려주고 텍스트 파싱(parseBackgroundShellResponse)이 실패한다.
      // → 이 경로가 막히면 `npm run dev` 처럼 포트가 명령어에 없고 출력 배너에만 찍히는 dev 서버는
      //   watcher 가 끝내 안 붙어 iframe 위성이 생기지 않는다(부팅 시 rehydrate 만 우연히 잡던 상태).
      // shellId(=backgroundTaskId)와 output 경로는 **세션 JSONL 의 tool_result.content 문자열**에
      // 그대로 남으므로, JSONL 을 읽는 rehydrateBackgroundShells 로 위임해 watcher 를 붙인다
      // (§7.11 "BackgroundShellWatcher 단일 경로" + 기존 인프라 재사용). JSONL flush 레이스 대비로
      // 즉시 + 2s 지연 1회 재시도(rehydrate·watcher.start·createIframeSatellite 모두 멱등).
      //
      // §7.11 — 과거엔 `tool_response.backgroundTaskId` 존재를 게이트로 두었으나, 이 구조화
      // 필드는 Claude Code(SDK-CLI) 버전·spawn 경로(헤드리스 커스텀 에이전트 등)에 따라
      // 이름/위치가 달라지거나 누락될 수 있어, 게이트가 어긋나면 `npm run dev` 류 dev 서버가
      // 영영 iframe 위성을 못 얻는 회귀가 났다(실측: rehydrate 파이프라인 자체는 정상인데
      // 호출이 안 됨). attachBackgroundShell 는 호출부(recordBashEntry)에서 이미
      // `run_in_background === true` 일 때만 진입하므로, parse 실패 = "백그라운드 셸인데
      // tool_response 에 텍스트가 없다"가 확정이다 → 구조화 필드 유무와 무관하게 항상
      // JSONL(=진실원천)로 위임한다. (추가 안전망: SESSION_SCAN_INTERVAL 주기 sweep 의
      // rehydrateAllBackgroundShells 가 이 PostToolUse 가 아예 안 닿은 경우까지 보강.)
      const sessionId = payload.session_id;
      const cwd = this.sessionCwds.get(sessionId) ?? payload.cwd;
      if (cwd) {
        this.rehydrateBackgroundShells(sessionId, cwd);
        setTimeout(() => {
          const cwdRetry = this.sessionCwds.get(sessionId) ?? cwd;
          this.rehydrateBackgroundShells(sessionId, cwdRetry);
          this.onSnapshotChange?.();
        }, 2000);
      }
      return;
    }

    const sessionId = payload.session_id;
    const toolUseId = payload.tool_use_id;
    const command = typeof payload.tool_input?.['command'] === 'string'
      ? payload.tool_input['command'] as string
      : '';

    // §7.11 v2.4 — Vibisual 자체 런처(node scripts/runapp.mjs 등)는 서버 감지 전면 제외.
    // 그 셸의 output 파일은 실행된 Vibisual 앱 자신의 로그라, watcher 가 자기 로그를
    // 되읽어 모든 포트를 서버로 오등록하는 self-ingestion 루프를 만든다.
    if (isVibisualLauncherCommand(command)) return;

    // §7.11 v2.20 — probe 명령(curl/wget/nc 등)은 inline-cmd 단축 경로·watcher 둘 다 skip.
    // probe 는 listen 소켓을 안 열어서 watcher 가 어차피 아무것도 못 잡지만, 그 셸을
    // ServerEntry 로 등록해 두면 죽은 entry 가 ServerList 상단에 좀비처럼 남는다.
    if (isProbeCommand(command)) return;

    // 이미 서버로 등록된 엔트리가 있으면 shellId/outputFile 백필
    const servers = this.runningServers.get(sessionId);
    if (servers) {
      const target = servers.find((s) =>
        (toolUseId && s.id === toolUseId) || (!s.shellId && s.command === command),
      );
      if (target) {
        target.shellId = parsed.shellId;
        target.outputFile = parsed.outputPath;
      }
    }

    // runserver 스크립트 감지 — 기존 서버가 이미 살아있으면 스크립트가 spawn 없이
    // 즉시 종료하므로 output 감시만으로는 포트를 잡을 수 없다. 마커 파일로 현재 트리의
    // server/client 포트를 찾아 현재 세션에 iframe 위성을 만들어 놓는다(dedup이 이어서
    // 과거 에이전트의 동일 URL iframe을 정리).
    if (/runserver\.mjs\b/i.test(command)) {
      const sessionCwd = this.sessionCwds.get(sessionId) ?? payload.cwd;
      const marker = readDevServerMarker(sessionCwd);
      if (marker) {
        this.createIframeSatellite(sessionId, command, marker.port, parsed.shellId, undefined, true);
        this.createIframeSatellite(sessionId, command, marker.clientPort, parsed.shellId, 'vite', true);
        // §7.11 v2.1 — server·client 두 포트 각각 ServerEntry 등록 (ServerList ↔ iframe 1:1)
        this.ensureServerEntryForShell(sessionId, toolUseId, command, parsed.shellId, parsed.outputPath, marker.port);
        this.ensureServerEntryForShell(sessionId, toolUseId, command, parsed.shellId, parsed.outputPath, marker.clientPort);
        return;
      }
    }

    // 명령어 문자열에서 포트 즉시 추출 시도 (--port=... / env var / inline eval / node script.js sniff)
    // §7.11 v2.20 — 위 isProbeCommand 가드를 이미 통과한 명령만 여기 도달.
    // §7.11 v2.24 — node -e "..." 같은 인라인 eval 도 fallback 추가.
    const cwdForScript = this.sessionCwds.get(sessionId) ?? payload.cwd;
    const inlinePort = extractPort(command)
      ?? extractPortFromInlineEval(command)
      ?? extractPortFromScriptFile(command, cwdForScript);
    if (inlinePort) {
      this.createIframeSatellite(sessionId, command, inlinePort, parsed.shellId, undefined, true);
      this.ensureServerEntryForShell(sessionId, toolUseId, command, parsed.shellId, parsed.outputPath, inlinePort);
      return;
    }

    // 없으면 output 파일 감시 → 포트 탐지 시 iframe 위성 생성 + ServerEntry 늦은 등록.
    // (포트가 끝내 안 뜨면 ServerEntry 생성 자체가 안 됨 → installer/빌드 걸러짐)
    this.shellWatcher.start(parsed.shellId, parsed.outputPath, (port) => {
      let log = '';
      try { log = fs.readFileSync(parsed.outputPath, 'utf8'); } catch { /* ignore */ }
      this.createIframeSatellite(sessionId, command, port, parsed.shellId, log, true);
      // 포트 감지 = 서버 증명 → 엔트리 생성 or port/shellId 백필
      this.ensureServerEntryForShell(sessionId, toolUseId, command, parsed.shellId, parsed.outputPath, port);
      this.onSnapshotChange?.();
    });
  }

  /** KillShell PostToolUse → 매칭되는 iframe 위성 제거 */
  handleKillShell(payload: HookEventPayload): boolean {
    const shellId = typeof payload.tool_input?.['shell_id'] === 'string'
      ? payload.tool_input['shell_id'] as string
      : undefined;
    if (!shellId) return false;

    this.shellWatcher.stop(shellId);

    let removed = false;
    for (const agent of this.agents.values()) {
      if (!agent.persistSatellites) continue;
      const before = agent.persistSatellites.length;
      agent.persistSatellites = agent.persistSatellites.filter(
        (s) => !(s.bubbleType === 'iframe' && s.shellId === shellId),
      );
      if (agent.persistSatellites.length < before) removed = true;
    }
    // ServerEntry 비활성 처리
    for (const entries of this.runningServers.values()) {
      for (const e of entries) {
        if (e.shellId === shellId) e.alive = false;
      }
    }
    if (removed) logger.info(`KillShell: removed iframe satellite for shell=${shellId}`);
    return removed;
  }

  /**
   * 주기적 iframe 생사 확인 — 포트가 닫혀도 버블은 유지, iframeAlive 필드만 토글.
   * (삭제는 오직 사용자 Delete 키 또는 KillShell 훅을 통해서만 일어남)
   *
   * v1.48: 단순 TCP probe 만으로는 §3.5 프로젝트 격리 위반 — 다른 ProjectGraph 가 같은
   * 포트(예: Expo 8081) 를 띄우면 stale 위성이 부활. owning shellId 검증 추가:
   * 자기 ProjectGraph 의 active background shell 집합에 포함될 때만 alive=true 인정.
   */
  async checkIframesAlive(): Promise<boolean> {
    const targets: { agentSessionId: string; port: number; index: number; shellId?: string }[] = [];
    for (const [sessionId, agent] of this.agents) {
      if (!agent.persistSatellites) continue;
      agent.persistSatellites.forEach((s, index) => {
        if (s.bubbleType === 'iframe' && s.url) {
          const m = s.url.match(/:(\d+)(?:\/|$)/);
          if (m?.[1]) {
            targets.push({
              agentSessionId: sessionId,
              port: parseInt(m[1], 10),
              index,
              shellId: s.shellId,
            });
          }
        }
      });
    }
    if (targets.length === 0) return false;

    // v1.48: 자기 ProjectGraph 의 active shellId 집합 빌드 (sweep 당 1회).
    // sessionCwds 만 순회하므로 다른 프로젝트 세션의 셸은 절대 들어오지 않음(§3.5).
    const activeShellIds = new Set<string>();
    for (const [sid, cwd] of this.sessionCwds) {
      try {
        const jsonlPath = getSessionJsonlPath(cwd, sid);
        if (!fs.existsSync(jsonlPath)) continue;
        for (const sh of scanActiveBackgroundShells(jsonlPath)) {
          activeShellIds.add(sh.shellId);
        }
      } catch { /* ignore — 한 세션 스캔 실패가 전체 sweep 을 막지 않게 */ }
    }

    const results = await Promise.all(targets.map(async (t) => ({ t, portAlive: await isPortAlive(t.port) })));
    let changed = false;
    for (const { t, portAlive } of results) {
      const agent = this.agents.get(t.agentSessionId);
      if (!agent?.persistSatellites) continue;
      const target = agent.persistSatellites[t.index];
      if (!target || target.bubbleType !== 'iframe') continue;
      // v1.48: shellId 가 있으면 owning shell 도 살아있어야 alive 인정.
      // shellId 없는 레거시 위성은 port-only 동작 유지(후방호환).
      const shellOk = t.shellId ? activeShellIds.has(t.shellId) : true;
      const alive = portAlive && shellOk;
      if (target.iframeAlive !== alive) {
        target.iframeAlive = alive;
        // SSOT: 생사에 따라 status도 동기화 — 클라는 이 값을 그대로 렌더
        target.status = alive ? 'active' : 'idle';
        if (alive) target.lastActivity = Date.now();
        changed = true;
        const reason = !portAlive ? 'port closed' : !shellOk ? 'owning shell dead' : 'port up + shell alive';
        logger.info(`iframe satellite ${alive ? 'revived' : 'dimmed'} (port ${t.port}, ${reason})`);
      }
      // §7.11 v2.1 — grace 시계: 죽은 채로 처음 본 시각 기록 / 부활 시 클리어.
      // (transition 여부와 무관 — markIframeStopped 로 이미 false 인 위성도 여기서 stamp.)
      if (!alive) {
        if (target.iframeDeadAt === undefined) target.iframeDeadAt = Date.now();
      } else if (target.iframeDeadAt !== undefined) {
        target.iframeDeadAt = undefined;
      }
      // ServerEntry alive 동기화 — 한 port 는 한 process 만 점유 가능하므로
      // 가장 최근 startedAt 1개만 alive=true 로 유지하고 나머지는 dead 처리.
      // (서버 재기동마다 stale entry 가 7개씩 누적되어 "실행 중" 7번 표시되는 버그 방지)
      const sameByPort: ServerEntry[] = [];
      for (const entries of this.runningServers.values()) {
        for (const e of entries) {
          if (e.port === t.port) sameByPort.push(e);
        }
      }
      if (!alive) {
        for (const e of sameByPort) e.alive = false;
      } else {
        sameByPort.sort((a, b) => b.startedAt - a.startedAt);
        sameByPort.forEach((e, i) => { e.alive = i === 0; });
      }
    }
    // §7.11 v2.21 — strict 1:1 self-healing:
    //   (a) `port === undefined` orphan placeholder(기존 영속/runtime 잔존) 즉시 제거.
    //   (b) port 가 있지만 매칭 iframe 위성이 없는 orphan ServerEntry 도 제거.
    //   v2.21 이후 새 placeholder 는 생성되지 않지만, 체크포인트 복원이나 과거 코드로 등록된
    //   stale entry 를 sweep 마다 정리한다.
    {
      const iframePorts = new Set<number>();
      for (const agent of this.agents.values()) {
        if (!agent.persistSatellites) continue;
        for (const s of agent.persistSatellites) {
          if (s.bubbleType === 'iframe' && s.url) {
            const m = s.url.match(/:(\d+)(?:\/|$)/);
            if (m?.[1]) iframePorts.add(parseInt(m[1], 10));
          }
        }
      }
      for (const [sid, entries] of this.runningServers) {
        const before = entries.length;
        const kept = entries.filter((e) => e.port !== undefined && iframePorts.has(e.port));
        if (kept.length !== before) {
          this.runningServers.set(sid, kept);
          changed = true;
          for (const removed of entries) {
            if (!kept.includes(removed)) {
              logger.info(`ServerEntry orphan removed (no matching iframe): "${removed.command.slice(0, 80)}" (port=${removed.port ?? 'undefined'})`);
            }
          }
        }
      }
    }

    // §7.11 v2.1 — grace(IFRAME_DEAD_GRACE_MS) 초과한 죽은 iframe 위성 자동 제거
    // (+ 같은 port 의 dead ServerEntry 동반 제거). 사용자 Delete / KillShell 즉시 제거와 병행.
    // §7.11 v2.4 — 사용자가 고정핀(preservePinned)으로 고정한 위성은 grace 가 지나도
    //   제거하지 않는다(죽은 dev server 라도 IframeServerCard 의 Restart/Start/Stop 으로
    //   계속 다룰 수 있게). 또 제거 시 그 포트를 watcher 에 forgetPort 해 재감지를 허용한다.
    const nowMs = Date.now();
    for (const agent of this.agents.values()) {
      if (!agent.persistSatellites) continue;
      const expired = agent.persistSatellites.filter(
        (s) => s.bubbleType === 'iframe'
          && s.iframeAlive === false
          && s.preservePinned !== true
          && s.iframeDeadAt !== undefined
          && nowMs - s.iframeDeadAt > IFRAME_DEAD_GRACE_MS,
      );
      if (expired.length === 0) continue;
      const expiredPorts = new Set<number>();
      for (const s of expired) {
        const m = s.url?.match(/:(\d+)(?:\/|$)/);
        if (m?.[1]) {
          const port = parseInt(m[1], 10);
          expiredPorts.add(port);
          // 서버가 같은 포트로 재시작하면 watcher 가 재감지 → 위성 재등장.
          if (s.shellId) this.shellWatcher.forgetPort(s.shellId, port);
        }
      }
      agent.persistSatellites = agent.persistSatellites.filter((s) => !expired.includes(s));
      changed = true;
      for (const s of expired) {
        logger.info(`iframe satellite auto-removed (dead > ${IFRAME_DEAD_GRACE_MS}ms): ${s.url ?? s.path}`);
      }
      if (expiredPorts.size > 0) {
        for (const [sid, entries] of this.runningServers) {
          const kept = entries.filter(
            (e) => !(e.port !== undefined && !e.alive && expiredPorts.has(e.port)),
          );
          if (kept.length !== entries.length) this.runningServers.set(sid, kept);
        }
      }
    }

    // 같은 서버 가리키는 중복 entries 머지 (dead entry 는 보존 — Start/Restart UX 위해)
    if (this.dedupRunningServers()) changed = true;
    return changed;
  }

  /** tool_use_id 중복 방지 (Pre + Post 양쪽 모두 기록 방지) */
  private fileEditSeen = new Set<string>();

  /**
   * fileEdits 맵 키를 사용자가 클릭하는 노드 키와 동일하게 산출한다.
   * processInternalFile 의 키 규칙(파일의 owning project 기준 상대경로 + worktree namespace prefix)을
   * 그대로 미러 — recordFileEdit 가 세션 cwd 프로젝트 기준으로 키를 따로 계산해서
   * scan(`manual`) 노드/워크트리 노드와 키가 어긋나 diff 가 안 붙던 문제 차단.
   */
  private canonicalFileKey(absPath: string): string {
    const norm = normalize(absPath);
    const fileProject = this.getProjectForCwd(norm);
    if (fileProject) {
      const rel = this.toRelative(norm, fileProject.path);
      if (rel) {
        // worktree 파일은 부모와 격리하는 네임스페이스 prefix (processInternalFile 5197행과 동일 규칙)
        if (fileProject.parentProjectPath) {
          return `wt${hashString(normalize(fileProject.path)).toString(36)}__${rel}`;
        }
        return rel;
      }
    }
    return norm;
  }

  /** Write diff 한 쪽 본문 대용량 가드 — 초과분은 잘라 표식 추가(스냅샷/메모리 폭증 방지) */
  private clampDiffSide(text: string): string {
    if (text.length <= MAX_WRITE_DIFF_BYTES) return text;
    return `${text.slice(0, MAX_WRITE_DIFF_BYTES)}\n…[truncated ${text.length - MAX_WRITE_DIFF_BYTES} chars]`;
  }

  /**
   * Edit / Write 도구 호출 → 파일 수정 기록 추가 (Pre/Post 모두 수용, dedup).
   * - Edit: tool_input.old_string → new_string.
   * - Write: 디스크 직전 내용 → tool_input.content 로 diff 합성. old 는 PreToolUse 시점
   *   디스크에서 읽어야 정확(Post 는 이미 새 내용). 신규 파일 / Pre 미수신 / 읽기 실패 → old="".
   * 확장자 필터 없음 — 모니터링 세션이 쓴 모든 파일(.md/.json/.ts/.lock 등) 캡처.
   */
  private recordFileEdit(payload: HookEventPayload): void {
    const tool = payload.tool_name;
    if ((tool !== 'Edit' && tool !== 'Write') || !payload.tool_input) return;

    // tool_use_id 중복 방지 (Pre/Post 같은 uid). add 는 엔트리 확정 직전에 — 중도 bail 한
    // Pre 가 후속 Post 를 막지 않도록.
    const uid = payload.tool_use_id;
    if (uid && this.fileEditSeen.has(uid)) return;

    const rawPath = payload.tool_input['file_path'];
    if (typeof rawPath !== 'string') return;
    const absPath = normalize(rawPath);
    const key = this.canonicalFileKey(absPath);

    let oldStr: string;
    let newStr: string;

    if (tool === 'Edit') {
      const o = payload.tool_input['old_string'];
      const n = payload.tool_input['new_string'];
      if (typeof o !== 'string' || typeof n !== 'string') return;
      oldStr = o;
      newStr = n;
    } else {
      // Write — content = 새 전체 본문
      const content = payload.tool_input['content'];
      if (typeof content !== 'string') return;
      newStr = content;
      oldStr = '';
      // 쓰기 직전 디스크 내용(= old). PreToolUse 만 정확 — Post 는 이미 덮어쓴 상태라 old 복구 불가.
      if (payload.hook_event_name === 'PreToolUse') {
        try {
          const fsPath = rawPath.replace(/[\\/]/g, path.sep);
          const st = fs.existsSync(fsPath) ? fs.statSync(fsPath) : null;
          if (st && st.isFile()) {
            // 훅 경로 차단 방지 — 거대 파일은 통째 읽지 않고 경계 prefix 만(어차피 clamp 됨)
            const cap = MAX_WRITE_DIFF_BYTES + 64;
            if (st.size <= cap) {
              oldStr = fs.readFileSync(fsPath, 'utf8');
            } else {
              const fd = fs.openSync(fsPath, 'r');
              try {
                const buf = Buffer.allocUnsafe(cap);
                const read = fs.readSync(fd, buf, 0, cap, 0);
                oldStr = buf.toString('utf8', 0, read);
              } finally {
                fs.closeSync(fd);
              }
            }
          }
        } catch {
          oldStr = ''; // 바이너리/권한/인코딩 실패 → 신규 취급
        }
      }
    }

    oldStr = this.clampDiffSide(oldStr);
    newStr = this.clampDiffSide(newStr);

    // 원본 경로 (forward slash, 원래 대소문자 유지 → VS Code에서 열기용)
    const originalPath = rawPath.replace(/\\/g, '/');

    const entry: FileEdit = {
      id: uid ?? `edit-${Date.now()}`,
      filePath: originalPath,
      oldString: oldStr,
      newString: newStr,
      timestamp: Date.now(),
    };

    if (uid) this.fileEditSeen.add(uid);

    let list = this.fileEdits.get(key);
    if (!list) { list = []; this.fileEdits.set(key, list); }
    list.unshift(entry);
    // 노드별 unlimitedFileEdits=true 면 트림 스킵(무한 저장), 아니면 MAX_FILE_EDITS 상한
    const fileNode = this.nodes.get(key);
    if (!fileNode?.unlimitedFileEdits && list.length > MAX_FILE_EDITS) {
      list.length = MAX_FILE_EDITS;
    }

    logger.debug(`Recorded file ${tool.toLowerCase()}: ${key} (${list.length} total)`);
  }

  /** 파일별 edit history → file node ID 기준 Record */
  private buildFileEditsRecord(): Record<string, FileEdit[]> {
    const result: Record<string, FileEdit[]> = {};
    for (const [relPath, edits] of this.fileEdits) {
      const node = this.nodes.get(relPath);
      if (!node) continue;
      // filePath 누락된 기존 엔트리 보정 (root + 상대경로)
      const absPath = this.root ? `${this.root}/${relPath}` : relPath;
      result[node.id] = edits.map((e) => ({
        ...e,
        filePath: e.filePath || absPath,
      }));
    }
    return result;
  }

  /** Bash 등 특수 도구 — 에이전트 persistSatellites에 직접 저장 */
  private processSpecialTool(
    agent: BubbleData,
    toolName: string,
    bubbleType: BubbleType,
  ): ProcessResult {
    const key = `__special__${bubbleType}__${agent.path}`;

    if (!agent.persistSatellites) agent.persistSatellites = [];
    let sat = agent.persistSatellites.find((s) => s.path === key);
    if (!sat) {
      sat = {
        id: `special-${hashString(key)}`,
        label: toolName,
        bubbleType,
        path: key,
        status: 'active',
        activity: 0,
        lastActivity: Date.now(),
        lastTool: toolName,
      };
      agent.persistSatellites.push(sat);
    }
    sat.status = 'active';
    sat.activity += 1;
    sat.lastActivity = Date.now();
    sat.lastTool = toolName;

    logger.debug(`${toolName} → [${bubbleType}] satellite of ${agent.label}`);
    return { agent };
  }

  /** 노드에 에이전트 참조 추가 (활성 에이전트 추적) */
  private addAgentRef(nodePath: string, agentId: string): void {
    let refs = this.nodeAgentRefs.get(nodePath);
    if (!refs) { refs = new Set(); this.nodeAgentRefs.set(nodePath, refs); }
    refs.add(agentId);
  }

  /** excludeId 제외한 현재 active 에이전트 ID Set */
  private getActiveAgentIds(excludeId: string): Set<string> {
    const ids = new Set<string>();
    for (const [, agent] of this.agents) {
      if (agent.id !== excludeId && agent.status === 'active') {
        ids.add(agent.id);
      }
    }
    return ids;
  }

  /** 특정 에이전트의 모든 노드 참조 제거 → 참조 0인 노드 idle 전환 */
  private removeAgentRefs(agentId: string, activeIds?: Set<string>): void {
    const now = Date.now();
    const otherActiveIds = activeIds ?? this.getActiveAgentIds(agentId);
    for (const [nodePath, refs] of this.nodeAgentRefs) {
      refs.delete(agentId);
      let hasActiveRef = false;
      for (const ref of refs) {
        if (otherActiveIds.has(ref)) { hasActiveRef = true; break; }
      }
      if (!hasActiveRef) {
        const node = this.nodes.get(nodePath);
        if (node) {
          node.status = node.bubbleType === 'ghost' ? 'disappearing' : 'idle';
          node.lastActivity = now;
        }
        refs.clear();
      }
    }
  }

  /**
   * 사용자가 `completed` 에이전트를 확인(클릭/dismiss)했을 때 호출 (§2.4 "확인 dismiss → 전유 file/folder 즉시 소멸", v1.82).
   * `removeAgentRefs` 와 동일하게 참조를 끊되, **이 에이전트가 전유하던**(다른 active 에이전트 참조 0)
   * file/internal_folder/external_folder 버블은 idle 로 내리지 않고 **즉시 `removeBubble`** 한다
   * (페이드/disappearing/5분 TTL 거치지 않음). `preservePinned`/`pinned` 은 존중하여 idle 로만 둔다.
   * 비-file/folder 노드는 기존 `removeAgentRefs` 와 동일하게 idle.
   * 자동 timeout idle 경로에서는 호출하지 않는다(5분 TTL grace 유지).
   * @returns 즉시 제거된 버블 id 목록
   */
  private removeAgentRefsPurging(agentId: string, activeIds?: Set<string>): string[] {
    const now = Date.now();
    const otherActiveIds = activeIds ?? this.getActiveAgentIds(agentId);
    const toRemove: string[] = [];
    for (const [nodePath, refs] of this.nodeAgentRefs) {
      // 이 에이전트가 쓰던 노드만 대상 — 무관한 고아는 건드리지 않음
      if (!refs.has(agentId)) continue;
      refs.delete(agentId);
      let hasActiveRef = false;
      for (const ref of refs) {
        if (otherActiveIds.has(ref)) { hasActiveRef = true; break; }
      }
      if (hasActiveRef) continue; // 다른 active 에이전트가 사용 중 → 유지
      const node = this.nodes.get(nodePath);
      if (node) {
        const isFileFolder =
          node.bubbleType === 'file' ||
          node.bubbleType === 'internal_folder' ||
          node.bubbleType === 'external_folder';
        if (isFileFolder && !node.preservePinned && !node.pinned) {
          toRemove.push(node.id); // 즉시 제거 대상 (refs 순회 후 일괄 처리)
        } else {
          // 핀 고정 또는 비-file/folder → 기존 동작(idle)
          node.status = node.bubbleType === 'ghost' ? 'disappearing' : 'idle';
          node.lastActivity = now;
        }
      }
      refs.clear();
    }
    // nodeAgentRefs 순회가 끝난 뒤 제거 — removeBubble 이 nodeAgentRefs 를 변이하므로
    for (const id of toRemove) this.removeBubble(id);
    return toRemove;
  }

  /** 폴더에 위성 파일 등록 (폴더별 maxSatellites 상한, 최신 우선) */
  private registerSatellite(folderPath: string, filePath: string): void {
    let set = this.satelliteMap.get(folderPath);
    if (!set) {
      set = new Set();
      this.satelliteMap.set(folderPath, set);
    }
    // 이미 있으면 삭제 후 재추가 (최신으로 이동)
    set.delete(filePath);
    set.add(filePath);
    // 상한 초과 시 가장 오래된 것부터 FIFO 제거 (상한이 1보다 크게 줄어든 경우 대비 while)
    this.trimSatellites(folderPath, set);
  }

  /** satelliteMap set 을 폴더 상한까지 FIFO(오래된 것부터)로 줄인다. */
  private trimSatellites(folderPath: string, set: Set<string>): void {
    const cap = this.folderMaxSatellites(folderPath);
    while (set.size > cap) {
      const first = set.values().next().value;
      if (first === undefined) break;
      set.delete(first);
    }
  }

  /**
   * 폴더 버블의 위성 표시 상한 설정 (§7.5 — 사용자 패널 편집).
   * 노드에 maxSatellites 저장 + 기존 위성 set 을 새 상한까지 즉시 FIFO 트림.
   * 폴더 노드를 못 찾으면 false.
   */
  setFolderMaxSatellites(folderPath: string, max: number): boolean {
    const normFolder = ProjectGraph.isRootKey(folderPath) ? folderPath : folderPath.toLowerCase();
    const node = this.nodes.get(normFolder);
    if (!node || (node.bubbleType !== 'internal_folder' && node.bubbleType !== 'external_folder')) {
      return false;
    }
    const clamped = Math.min(
      SATELLITE_MAX_BOUNDS.MAX,
      Math.max(SATELLITE_MAX_BOUNDS.MIN, Math.floor(max)),
    );
    node.maxSatellites = clamped;
    const set = this.satelliteMap.get(normFolder);
    if (set) this.trimSatellites(normFolder, set);
    return true;
  }

  /**
   * 파일 버블의 diff 무한 저장 토글 (§7.4 — 디테일 패널 체크박스).
   * 노드에 unlimitedFileEdits 저장. limited 로 되돌리면(=false) 기존 fileEdits 리스트를
   * 즉시 MAX_FILE_EDITS 까지 FIFO 트림(maxSatellites 즉시 트림 선례와 동일).
   * 파일 노드를 못 찾으면 false.
   */
  setFileEditsUnlimited(nodePath: string, unlimited: boolean): boolean {
    const key = nodePath.toLowerCase();
    const node = this.nodes.get(key);
    if (!node || node.bubbleType !== 'file') return false;
    node.unlimitedFileEdits = unlimited;
    if (!unlimited) {
      const list = this.fileEdits.get(key);
      if (list && list.length > MAX_FILE_EDITS) list.length = MAX_FILE_EDITS;
    }
    return true;
  }

  private isInternal(absolutePath: string, root?: string | null): boolean {
    const r = root ?? this.root;
    if (!r) return true;
    return normalize(absolutePath).startsWith(normalize(r));
  }

  private toRelative(absolutePath: string, root?: string | null): string | null {
    const r = root ?? this.root;
    if (!r) return null;
    const normAbs = normalize(absolutePath);
    const normRoot = normalize(r);
    if (!normAbs.startsWith(normRoot)) return null;
    const rel = normAbs.substring(normRoot.length).replace(/^\//, '');
    return rel || null;
  }

  /** payload.cwd 가 git 워크트리일 때, 그 워크트리의 **부모 프로젝트에 속한
   *  customCreated 에이전트**(서브를 띄운 주체)의 세션키를 반환. 없으면 null.
   *  redirect 의 sub.sessionId 매칭이 빗나갈 때의 결정적 폴백 — orphan 워크트리 워커
   *  버블 생성을 막고 작업/엣지를 커스텀 부모에 귀속시킨다. */
  private resolveWorktreeOwnerSession(cwd: string): string | null {
    const norm = normalize(cwd);
    // 워크트리 부모 프로젝트명 해석.
    let parentName: string | null = null;
    const wtProj = this.getProjectForCwd(norm);
    if (wtProj?.parentProjectPath) {
      const parent = this.projects.get(normalize(wtProj.parentProjectPath));
      parentName = parent?.name ?? path.basename(wtProj.parentProjectPath);
    } else {
      const wt = detectWorktree(norm);
      if (wt) {
        const pPath = wt.parentAbsPath ?? wt.parentPath;
        const parent = this.projects.get(normalize(pPath));
        parentName = parent?.name ?? path.basename(pPath);
      }
    }
    if (!parentName) return null;

    let bestSid: string | null = null;
    let bestActivity = -1;
    for (const [sid, agent] of this.agents) {
      if (!agent.customCreated) continue;
      const acwd = this.sessionCwds.get(sid) ?? '';
      const aTab = this.resolveTabProjectName(this.getProjectForCwd(acwd), acwd);
      if (aTab !== parentName) continue;
      const subs = subAgentManager.getAllSubs(agent.id);
      if (subs.length === 0) continue; // 서브를 띄운 적 없는 커스텀은 후보 아님
      const recent = subs.reduce((m, s) => Math.max(m, s.lastActivityAt ?? 0), 0);
      if (recent > bestActivity) { bestActivity = recent; bestSid = sid; }
    }
    return bestSid;
  }

  /** §5.7 #23-2 — sessionId 가 데몬(Agent View) roster 의 살아있는 worker 세션이면 true.
   *  부팅 직후 sub 매핑이 아직 안 풀린 데몬 워커 hook 이 touchAgent 로 orphan(모래시계)
   *  버블을 찍는 것을 막는 sync 가드. roster 파일이 없으면(=데몬 비활성) false → 일반 경로 유지. */
  private isDaemonWorkerSession(sessionId: string): boolean {
    const r = readAgentViewRoster();
    if (!r) return false;
    for (const w of Object.values(r.workers)) {
      if (w?.sessionId === sessionId) return true;
    }
    return false;
  }

  private touchAgent(sessionId: string, cwd?: string): BubbleData | null {
    let agent = this.agents.get(sessionId);
    const isNew = !agent;
    if (!agent) {
      this.agentCounter += 1;
      // JSONL 제목 → cwd basename → 제네릭 fallback
      const jsonlTitle = cwd ? resolveSessionTitle(cwd, sessionId) : null;
      const baseName = jsonlTitle ?? (cwd ? path.basename(cwd) : `Agent ${this.agentCounter}`);
      const label = this.uniqueLabel(baseName);
      agent = {
        id: `agent-${hashString(sessionId)}`,
        label,
        bubbleType: 'agent',
        path: sessionId,
        status: 'active',
        activity: 0,
        lastActivity: Date.now(),
      };
      this.agents.set(sessionId, agent);
      if (!jsonlTitle && cwd) {
        this.pendingTitles.set(sessionId, cwd);
      }
      // 훅 이벤트는 실제 CLI/VSCode 세션에서만 오므로 PID 해석 → 점유 추적 대상에 등록
      const resolvedPid = findPidBySession(sessionId);
      if (resolvedPid !== null) this.sessionPids.set(sessionId, resolvedPid);
    }
    const prevStatus = agent.status;
    agent.status = 'active';
    agent.fadeStartedAt = undefined;
    agent.activity += 1;
    agent.lastActivity = Date.now();
    if (prevStatus !== 'active') {
    }
    if (isNew) dbg('touchAgent.create', { sessionId, label: agent.label, cwd, instanceRoot: this.root });
    return agent;
  }

  /** 인스턴스 스코프 키 — 프로젝트 간 node.id 충돌 방지용(해시 입력에 prefix).
   *  merge 시 "docs" 같은 공통 경로가 서로 덮어쓰지 않도록 인스턴스마다 고유해야 한다. */
  private nodeScope(): string {
    return this.root ?? '';
  }

  /** 복원된 구 체크포인트의 미스코프 node id 를 새 스코프 규칙으로 일괄 재해싱.
   *  edges 의 source/target/edgeId 도 맞춰 재작성. root 노드는 이미 프로젝트명 스코프라 건너뜀. */
  private regenerateScopedNodeIds(): void {
    const scope = this.nodeScope();
    if (!scope) return;
    const idMap = new Map<string, string>();
    for (const [key, node] of this.nodes) {
      if (ProjectGraph.isRootKey(key)) continue;
      const scopedKey = `${scope}::${key}`;
      let newId: string;
      if (node.bubbleType === 'file') {
        newId = `file-${hashString(scopedKey)}`;
      } else if (node.bubbleType === 'root') {
        continue;
      } else {
        // internal_folder / external_folder / ghost / iframe / pipeline 등
        newId = `folder-${hashString(scopedKey)}`;
      }
      if (node.id !== newId) {
        idMap.set(node.id, newId);
        node.id = newId;
      }
    }
    if (idMap.size === 0) return;
    this.mainEdges.remapIds(idMap);
    this.innerEdges.remapIds(idMap);
    logger.info(`Regenerated ${idMap.size} node ids under scope "${scope}"`);
  }

  private upsertNode(
    relativePath: string,
    bubbleType: BubbleType,
    toolName: string,
    isFile: boolean,
  ): BubbleData {
    let node = this.nodes.get(relativePath);
    if (!node) {
      let label = relativePath.includes('/')
        ? relativePath.substring(relativePath.lastIndexOf('/') + 1)
        : relativePath;
      // worktree 네임스페이스 prefix 는 라벨에서 제거 (표시는 원래 폴더명)
      const nsMatch = label.match(/^wt[0-9a-z]+__(.+)$/);
      if (nsMatch) label = nsMatch[1]!;
      const scopedKey = `${this.nodeScope()}::${relativePath}`;
      node = {
        id: isFile ? `file-${hashString(scopedKey)}` : `folder-${hashString(scopedKey)}`,
        label,
        bubbleType,
        path: relativePath,
        status: 'active',
        activity: 0,
        lastActivity: Date.now(),
        lastTool: toolName,
        childCount: 0,
      };
      this.nodes.set(relativePath, node);
      // 새 노드 생성 시 같은 디렉토리 ghost에서 rename 감지 + 데이터 이관
      this.tryMigrateFromGhost(relativePath);
    } else if (node.bubbleType === 'ghost' && node.ghostInfo) {
      // 같은 경로가 다시 나타남 → ghost 해제 + disappearing 클리어
      logger.info(`Ghost revived: "${node.label}" (was ${node.ghostInfo.changeType})`);
      node.bubbleType = node.ghostInfo.originalBubbleType;
      node.ghostInfo = undefined;
      node.disappearStartedAt = undefined;
      node.disappearAt = undefined;
    } else if (node.status === 'disappearing') {
      // disappearing 상태인 노드가 다시 활성화 → 소멸 취소
      node.disappearStartedAt = undefined;
      node.disappearAt = undefined;
    }
    node.status = 'active';
    node.activity += 1;
    node.lastActivity = Date.now();
    node.lastTool = toolName;
    return node;
  }

  private registerChild(parentPath: string, childPath: string): void {
    let children = this.childrenMap.get(parentPath);
    if (!children) {
      children = new Set();
      this.childrenMap.set(parentPath, children);
    }
    children.add(childPath);
    const parent = this.nodes.get(parentPath);
    if (parent) parent.childCount = children.size;
  }

  /** 내부 파일 처리 → 계층 생성 + 내부 엣지 + 에이전트 참조 등록 */
  private processInternalFile(filePath: string, toolName: string, agentId?: string, projectPath?: string | null, isDirectory = false): string | null {
    const root = projectPath ?? this.root;
    const normalizedRoot = root ? normalize(root) : null;
    const projectInfo = normalizedRoot ? this.projects.get(normalizedRoot) : null;
    const projectName = root ? path.basename(root) : null;
    const relativePath = this.toRelative(filePath, projectPath);
    if (!relativePath) return null;

    const segments = relativePath.split('/');
    if (segments.length === 0 || !segments[0]) return null;

    // worktree cwd 의 파일은 네임스페이스 키로 저장해 부모와 완전 격리.
    // 최상위 경로는 worktree 버블의 children 으로 등록되어 드릴다운 시 노출.
    const isWorktree = !!projectInfo?.parentProjectPath;
    const worktreeBubbleKey = isWorktree ? normalizedRoot : null;
    const keyPrefix = isWorktree ? `wt${hashString(normalizedRoot!).toString(36)}__` : '';

    const topFolder = `${keyPrefix}${segments[0]}`;
    const finalRelKey = `${keyPrefix}${relativePath}`;

    if (segments.length === 1) {
      const leafType: BubbleType = isDirectory ? 'internal_folder' : 'file';
      this.upsertNode(finalRelKey, leafType, toolName, !isDirectory);
      if (worktreeBubbleKey) {
        this.registerChild(worktreeBubbleKey, finalRelKey);
      } else {
        this.topLevelPaths.add(finalRelKey);
      }
      if (projectName) this.nodeProjectNames.set(finalRelKey, projectName);
      if (agentId) this.addAgentRef(finalRelKey, agentId);
      return finalRelKey;
    }

    // 최상위 폴더 — worktree면 worktree 버블 자식, 아니면 top-level
    if (worktreeBubbleKey) {
      this.registerChild(worktreeBubbleKey, topFolder);
    } else {
      this.topLevelPaths.add(topFolder);
    }
    this.upsertNode(topFolder, 'internal_folder', toolName, false);
    if (projectName) this.nodeProjectNames.set(topFolder, projectName);
    if (agentId) this.addAgentRef(topFolder, agentId);

    // 중간 폴더들 (worktree면 동일 prefix 적용)
    for (let i = 1; i < segments.length - 1; i++) {
      const folderPath = `${keyPrefix}${segments.slice(0, i + 1).join('/')}`;
      const parentPath = `${keyPrefix}${segments.slice(0, i).join('/')}`;
      this.upsertNode(folderPath, 'internal_folder', toolName, false);
      if (projectName) this.nodeProjectNames.set(folderPath, projectName);
      this.registerChild(parentPath, folderPath);
      if (agentId) this.addAgentRef(folderPath, agentId);
    }

    // 말단 노드 (디렉토리 or 파일)
    const leafParent = `${keyPrefix}${segments.slice(0, -1).join('/')}`;
    const leafType: BubbleType = isDirectory ? 'internal_folder' : 'file';
    this.upsertNode(finalRelKey, leafType, toolName, !isDirectory);
    if (projectName) this.nodeProjectNames.set(finalRelKey, projectName);
    this.registerChild(leafParent, finalRelKey);
    if (agentId) this.addAgentRef(finalRelKey, agentId);

    // 각 계층에 내부 엣지 생성
    for (let i = 1; i < segments.length; i++) {
      const parentPath = `${keyPrefix}${segments.slice(0, i).join('/')}`;
      const childPath = `${keyPrefix}${segments.slice(0, i + 1).join('/')}`;
      const parentNode = this.nodes.get(parentPath);
      const childNode = this.nodes.get(childPath);
      if (parentNode && childNode) {
        const innerEdge = this.innerEdges.upsert(parentNode.id, parentNode, childNode, toolName, agentId);
      }
    }

    // 모든 상위 폴더에 이 노드를 위성으로 등록 (파일일 때만 — 디렉토리는 자체가 자식 폴더)
    if (!isDirectory) {
      for (let i = 0; i < segments.length - 1; i++) {
        const folderPath = `${keyPrefix}${segments.slice(0, i + 1).join('/')}`;
        this.registerSatellite(folderPath, finalRelKey);
      }
    }

    return topFolder;
  }

  /** 외부 파일/폴더 처리 — §2.1 v1.55 평탄화.
   *  드라이브 루트부터 펼치는 1자형 폴더 체인 ❌. 에이전트가 만진 파일의 **직속 부모 폴더 1개**만
   *  `external_folder` 버블로 업서트하고 그 폴더에 파일을 satellite 로 등록한다.
   *  같은 부모 폴더 안의 다른 파일이 들어오면 같은 버블에 누적 (라벨/카운트/satellite 갱신).
   *
   *  worktreeBubbleKey + wtPrefix 가 주어지면 외부 폴더가 워크트리 버블의 children 으로 들어가고
   *  키는 wtPrefix 로 네임스페이스됨(이주된 에이전트의 외부 접근이 부모 캔버스 top-level 을 오염시키지 않게).
   */
  private processExternalFile(
    absolutePath: string,
    toolName: string,
    agentId?: string,
    isDirectory = false,
    worktreeBubbleKey?: string | null,
    wtPrefix = '',
    projectName?: string | null,
    toolResponse?: Record<string, unknown>,
    dirToolCwd?: string,
  ): string | null {
    const normAbs = absolutePath.replace(/\\/g, '/');
    // 파일이면 부모 폴더가 외부 폴더, 디렉토리면 그 디렉토리 자체가 외부 폴더
    let folderAbs = isDirectory ? normAbs : path.dirname(normAbs).replace(/\\/g, '/');
    if (!folderAbs || folderAbs === '.' || folderAbs === '/') {
      // 의미있는 부모 없음 → absolutePath 자체를 폴더로 폴백
      folderAbs = normAbs;
    }

    const folderKey = `${wtPrefix}__ext__${folderAbs}`;

    // §2.1 v2.28 invariant — external_folder 버블 ↔ 위성 ≥ 1.
    // Grep/Glob 결과 0/파싱 실패면 폴더 자체도 생성하지 않는다(폴더만 떠 있고 위성 0 금지).
    // Read/Edit/Write 단일 파일은 항상 위성 1개를 동반하므로 invariant 자동 충족.
    let resultFiles: string[] = [];
    if (isDirectory) {
      // 폴더 노드 미존재 상태에서도 maxSatellites 기본값을 알 수 있어야 함 (folderMaxSatellites 는 폴더 없으면 default 반환).
      const cap = this.folderMaxSatellites(folderKey);
      resultFiles = extractDirToolFiles(toolResponse, dirToolCwd, folderAbs, cap);
      if (resultFiles.length === 0) return null;
    }

    // 외부 폴더 1개 업서트 + 계층 등록
    this.ensureExternalFolder(folderKey, folderAbs, toolName);
    if (worktreeBubbleKey) {
      this.registerChild(worktreeBubbleKey, folderKey);
    } else {
      this.topLevelPaths.add(folderKey);
    }
    if (projectName) this.nodeProjectNames.set(folderKey, projectName);
    if (agentId) this.addAgentRef(folderKey, agentId);

    // 파일 노드 + satellite 등록
    if (!isDirectory) {
      // Read/Edit/Write — 만진 파일 1개를 폴더 위성으로 (§2.1 v1.55)
      const fileName = path.basename(normAbs);
      const fileKey = `${folderKey}/${fileName}`;
      this.registerExternalSatellite(folderKey, fileKey, toolName, agentId, projectName);
    } else {
      // Grep/Glob — tool_response 의 매치 결과 파일을 폴더 위성으로 (§2.1 v2.7).
      // 결과가 하위 디렉토리에 있어도 중간 폴더 버블 없이 grep 한 폴더 1개의 위성으로 평탄화.
      // 결과 0/파싱 실패 케이스는 위에서 early return (§2.1 v2.28 invariant).
      for (const absFile of resultFiles) {
        const fileKey = `${wtPrefix}__ext__${absFile}`;
        this.registerExternalSatellite(folderKey, fileKey, toolName, agentId, projectName);
      }
    }

    return folderKey;
  }

  /** 외부 폴더의 파일 위성 1개 등록 — 노드/계층/내부 엣지/satellite/카운트 갱신 (§2.1). */
  private registerExternalSatellite(
    folderKey: string,
    fileKey: string,
    toolName: string,
    agentId?: string,
    projectName?: string | null,
  ): void {
    this.upsertNode(fileKey, 'file', toolName, true);
    this.registerChild(folderKey, fileKey);
    this.registerSatellite(folderKey, fileKey);
    const folderNode = this.nodes.get(folderKey);
    const fileNode = this.nodes.get(fileKey);
    if (folderNode && fileNode) {
      this.innerEdges.upsert(folderNode.id, folderNode, fileNode, toolName, agentId);
      // 외부 폴더의 satellite 파일 수 즉시 갱신 (§2.1 v1.55 — UI 카운트 SSOT)
      const sat = this.satelliteMap.get(folderKey);
      folderNode.satelliteFileCount = sat ? sat.size : 0;
    }
    if (projectName) this.nodeProjectNames.set(fileKey, projectName);
    if (agentId) this.addAgentRef(fileKey, agentId);
  }

  /** external_folder 버블을 업서트 — 라벨은 전체 절대경로(§2.1 v1.55).
   *  과거 버그/구버전 잔존으로 file 타입으로 등록됐다면 external_folder 로 상향 보정. */
  private ensureExternalFolder(key: string, absolutePath: string, toolName: string): void {
    const existing = this.nodes.get(key);
    if (!existing) {
      this.nodes.set(key, {
        id: `folder-${hashString(`${this.nodeScope()}::${key}`)}`,
        label: `(ext) ${absolutePath}`,
        bubbleType: 'external_folder',
        path: absolutePath,
        absolutePath,
        status: 'active',
        activity: 1,
        lastActivity: Date.now(),
        lastTool: toolName,
        childCount: 0,
        satelliteFileCount: 0,
      });
      return;
    }
    if (existing.bubbleType === 'file') {
      existing.bubbleType = 'external_folder';
      existing.id = `folder-${hashString(`${this.nodeScope()}::${key}`)}`;
      existing.satelliteFileCount = existing.satelliteFileCount ?? 0;
    }
    existing.label = `(ext) ${absolutePath}`;
    existing.path = absolutePath;
    existing.absolutePath = absolutePath;
    existing.status = 'active';
    existing.activity += 1;
    existing.lastActivity = Date.now();
    existing.lastTool = toolName;
  }

  // ─── Task Edge (에이전트 간 작업 흐름) ───

  /** Task Edge 생성. v1.18: kind/messageFormat/returnFormat/timeoutMs/retryCount/cacheEnabled/priority 고급 옵션 지원.
   *  v1.32: bundleId/bundleRole 로 command↔artifact 자매 엣지를 같은 번들에 묶어 생성할 수 있음. */
  /** v1.85 — agentId → 그 에이전트 세션이 귀속되는 탭 프로젝트 이름.
   *  getProjectSessionIds(2494-2506) 와 동일 규칙(워크트리 세션은 부모 탭 귀속)으로 산출해
   *  toProjectCheckpoint 필터와 정합. 못 찾으면 undefined. */
  private resolveAgentTabProject(agentId: string): string | undefined {
    for (const [sessionId, agent] of this.agents) {
      if (agent.id !== agentId) continue;
      const cwd = this.sessionCwds.get(sessionId);
      if (!cwd) break;
      const proj = this.getProjectForCwd(cwd);
      return this.resolveTabProjectName(proj, cwd);
    }
    return undefined;
  }

  createTaskEdge(
    sourceAgentId: string,
    targetAgentId: string,
    command: string,
    forwardMode: TaskEdgeForwardMode,
    templateId: string | null,
    options?: {
      kind?: TaskEdgeKind;
      messageFormat?: TaskEdgeMessageFormat;
      messageSchema?: string;
      returnFormat?: TaskEdgeReturnFormat;
      timeoutMs?: number;
      retryCount?: number;
      cacheEnabled?: boolean;
      priority?: TaskEdgePriority;
      bundleId?: string;
      bundleRole?: 'primary' | 'auto-artifact' | 'auto-rework';
      delegationPolicy?: 'strict' | 'auto';
      critiqueTiming?: TaskEdgeCritiqueTiming;
      critiqueAuthority?: TaskEdgeCritiqueAuthority;
      maxReworkCount?: number;
      commandMode?: TaskEdgeCommandMode;
    },
  ): TaskEdge {
    const id = `tedge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    // v1.85 — 엣지를 탭 프로젝트에 귀속(소스 우선, 없으면 타겟, 그래도 없으면 인스턴스 primary).
    // 엔드포인트 에이전트가 만료·소멸해도 toProjectCheckpoint 가 이 값으로 영속한다.
    const projectId =
      this.resolveAgentTabProject(sourceAgentId) ??
      this.resolveAgentTabProject(targetAgentId) ??
      this.getPrimaryProjectName() ??
      undefined;
    const edge: TaskEdge = {
      id,
      sourceAgentId,
      targetAgentId,
      command,
      status: 'idle',
      forwardMode,
      templateId,
      createdAt: Date.now(),
      ...(projectId !== undefined && { projectId }),
      ...(options?.kind !== undefined && { kind: options.kind }),
      ...(options?.messageFormat !== undefined && { messageFormat: options.messageFormat }),
      ...(options?.messageSchema !== undefined && { messageSchema: options.messageSchema }),
      ...(options?.returnFormat !== undefined && { returnFormat: options.returnFormat }),
      ...(options?.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
      ...(options?.retryCount !== undefined && { retryCount: options.retryCount }),
      ...(options?.cacheEnabled !== undefined && { cacheEnabled: options.cacheEnabled }),
      ...(options?.priority !== undefined && { priority: options.priority }),
      ...(options?.bundleId !== undefined && { bundleId: options.bundleId }),
      ...(options?.bundleRole !== undefined && { bundleRole: options.bundleRole }),
      ...(options?.delegationPolicy !== undefined && { delegationPolicy: options.delegationPolicy }),
      ...(options?.critiqueTiming !== undefined && { critiqueTiming: options.critiqueTiming }),
      ...(options?.critiqueAuthority !== undefined && { critiqueAuthority: options.critiqueAuthority }),
      ...(options?.maxReworkCount !== undefined && { maxReworkCount: options.maxReworkCount }),
      ...(options?.commandMode !== undefined && { commandMode: options.commandMode }),
    };
    this.taskEdges.set(id, edge);
    return edge;
  }

  /** v1.32 — returnFormat='both' 인 command 엣지에 대해 자동 artifact 자매 엣지를 생성하거나 제거해 번들 동기화.
   *  - both 로 바뀌고 짝이 없으면 생성 (반대 방향, kind='artifact', bundleRole='auto-artifact')
   *  - both 가 아니게 바뀌고 짝이 있으면 제거
   *  primary 엣지 자체는 호출자가 이미 생성/수정했다고 가정. bundleId 가 없으면 primary 에 새로 부여. */
  syncBundleForReturnFormat(primaryEdgeId: string): void {
    const primary = this.taskEdges.get(primaryEdgeId);
    if (!primary) return;
    const wantBundle = primary.returnFormat === 'both' && (primary.kind ?? 'command') === 'command';
    const existing = primary.bundleId
      ? Array.from(this.taskEdges.values()).find(
          (e) => e.bundleId === primary.bundleId && e.id !== primary.id && e.bundleRole === 'auto-artifact',
        )
      : undefined;

    if (wantBundle && !existing) {
      if (!primary.bundleId) {
        primary.bundleId = `bundle-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        primary.bundleRole = 'primary';
      }
      // artifact 자매 엣지: 방향 반대, 같은 번들. command 엣지와 달리 사용자 편집 대상 아님.
      this.createTaskEdge(
        primary.targetAgentId,
        primary.sourceAgentId,
        '',
        primary.forwardMode,
        null,
        {
          kind: 'artifact',
          messageFormat: primary.messageFormat,
          returnFormat: 'artifact',
          bundleId: primary.bundleId,
          bundleRole: 'auto-artifact',
        },
      );
    } else if (!wantBundle && existing) {
      this.taskEdges.delete(existing.id);
      delete primary.bundleId;
      delete primary.bundleRole;
    } else if (wantBundle && existing) {
      // forwardMode 동기화만 — 방향/kind 는 고정.
      existing.forwardMode = primary.forwardMode;
    }
  }

  /** v1.54 — `kind='critique' + critiqueAuthority='force-rework'` 인 critique 엣지에 대해
   *  자동 command 자매 엣지(`bundleRole='auto-rework'`)를 생성/제거해 번들 동기화.
   *  - critiqueAuthority 가 force-rework 이고 짝이 없으면 생성 (방향 동일, kind='command', 표준 라벨)
   *  - force-rework 가 아니게 바뀌고(또는 kind 가 critique 가 아니게 바뀌고) 짝이 있으면 제거
   *  primary 엣지 자체는 호출자가 이미 생성/수정했다고 가정. bundleId 가 없으면 primary 에 새로 부여.
   *  v1.32 의 syncBundleForReturnFormat 과 동일 패턴이며 서로 직교(다른 kind 를 보기 때문). */
  syncReworkBundleForCritique(primaryEdgeId: string): void {
    const primary = this.taskEdges.get(primaryEdgeId);
    if (!primary) return;
    const wantBundle =
      primary.kind === 'critique' &&
      (primary.critiqueAuthority ?? 'force-rework') === 'force-rework';
    const existing = primary.bundleId
      ? Array.from(this.taskEdges.values()).find(
          (e) => e.bundleId === primary.bundleId && e.id !== primary.id && e.bundleRole === 'auto-rework',
        )
      : undefined;

    if (wantBundle && !existing) {
      if (!primary.bundleId) {
        primary.bundleId = `bundle-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        primary.bundleRole = 'primary';
      }
      // auto-rework 자매 엣지: 방향 동일(감시자→작업자), kind='command'. 사용자 편집 불가.
      this.createTaskEdge(
        primary.sourceAgentId,
        primary.targetAgentId,
        TASK_EDGE_AUTO_REWORK_COMMAND_LABEL,
        primary.forwardMode,
        null,
        {
          kind: 'command',
          bundleId: primary.bundleId,
          bundleRole: 'auto-rework',
        },
      );
    } else if (!wantBundle && existing) {
      this.taskEdges.delete(existing.id);
      // primary 가 auto-artifact 짝도 안 가지고 있으면 bundleId 자체를 비운다.
      const stillBundled = Array.from(this.taskEdges.values()).some(
        (e) => e.bundleId === primary.bundleId && e.id !== primary.id,
      );
      if (!stillBundled) {
        delete primary.bundleId;
        delete primary.bundleRole;
      }
    } else if (wantBundle && existing) {
      // forwardMode 동기화만 — 방향/kind/command 본문은 고정.
      existing.forwardMode = primary.forwardMode;
    }
  }

  /** v1.54 — 같은 번들의 auto-rework 자매 엣지 조회 (DetailPanel Bundle 섹션용) */
  getBundleAutoRework(primaryEdgeId: string): TaskEdge | undefined {
    const primary = this.taskEdges.get(primaryEdgeId);
    if (!primary || !primary.bundleId) return undefined;
    for (const edge of this.taskEdges.values()) {
      if (edge.id !== primary.id && edge.bundleId === primary.bundleId && edge.bundleRole === 'auto-rework') {
        return edge;
      }
    }
    return undefined;
  }

  /** v1.32 — 번들 동반 삭제. primary 삭제 시 auto-artifact 짝도 제거.
   *  auto-artifact 쪽이 삭제되는 경우는 드물지만(정상 경로 아님) 똑같이 짝도 제거해 고아 방지. */
  deleteTaskEdgeCascade(id: string): boolean {
    const edge = this.taskEdges.get(id);
    if (!edge) return false;
    const bundleId = edge.bundleId;
    const removed = this.taskEdges.delete(id);
    if (bundleId) {
      for (const [sibId, sib] of this.taskEdges) {
        if (sib.bundleId === bundleId) this.taskEdges.delete(sibId);
      }
    }
    return removed;
  }

  /** v1.32 — edgeId → edge 직접 조회 (dispatch/result 매칭 내부용) */
  getTaskEdge(id: string): TaskEdge | undefined {
    return this.taskEdges.get(id);
  }

  /** v1.55 — `targetAgentId === agentId` 이고 `kind='critique' + bundleRole='primary'` 인 엣지 목록.
   *  타겟 에이전트가 작업을 끝냈을 때 발사할 critique 감시자 엣지를 조회. force-rework/comment-only 모두 포함
   *  (comment-only 도 watcher 는 발사되며, 거부 시 rework 만 안 보낼 뿐). */
  getIncomingCritiqueEdges(targetAgentId: string): TaskEdge[] {
    const result: TaskEdge[] = [];
    for (const edge of this.taskEdges.values()) {
      if (
        edge.targetAgentId === targetAgentId &&
        edge.kind === 'critique' &&
        (edge.bundleRole ?? 'primary') === 'primary'
      ) {
        result.push(edge);
      }
    }
    return result;
  }

  /** v1.55 — critique 사이클의 reworkCount 조정. fresh=true 면 0 으로 리셋, 아니면 +1 후 반환. */
  bumpCritiqueReworkCount(edgeId: string, mode: 'reset' | 'increment'): number {
    const edge = this.taskEdges.get(edgeId);
    if (!edge) return 0;
    if (mode === 'reset') edge.reworkCount = 0;
    else edge.reworkCount = (edge.reworkCount ?? 0) + 1;
    return edge.reworkCount;
  }

  /** v1.55 — maxReworkCount 초과 시 critique 강등: `critiqueAuthority='comment-only'` 로 변경.
   *  반환: 변경된 edge (자매 동기화는 호출자가 별도로 `syncReworkBundleForCritique` 호출). */
  downgradeCritiqueAuthority(edgeId: string): TaskEdge | undefined {
    const edge = this.taskEdges.get(edgeId);
    if (!edge || edge.kind !== 'critique') return undefined;
    edge.critiqueAuthority = 'comment-only';
    return edge;
  }

  /** v1.32 — 같은 번들의 artifact 자매 엣지 조회 */
  getBundleArtifact(primaryEdgeId: string): TaskEdge | undefined {
    const primary = this.taskEdges.get(primaryEdgeId);
    if (!primary || !primary.bundleId) return undefined;
    for (const edge of this.taskEdges.values()) {
      if (edge.id !== primary.id && edge.bundleId === primary.bundleId && edge.bundleRole === 'auto-artifact') {
        return edge;
      }
    }
    return undefined;
  }

  /** v1.32 — 특정 에이전트를 source 로 가진 엣지 목록 (시스템 프롬프트 주입용) */
  getOutboundTaskEdges(sourceAgentId: string): TaskEdge[] {
    const out: TaskEdge[] = [];
    for (const edge of this.taskEdges.values()) {
      if (edge.sourceAgentId === sourceAgentId && (edge.bundleRole ?? 'primary') === 'primary') {
        out.push(edge);
      }
    }
    return out;
  }

  /** Task Edge 업데이트. v1.18: 고급 옵션 전부 갱신 가능. */
  updateTaskEdge(
    id: string,
    updates: {
      command?: string;
      forwardMode?: TaskEdgeForwardMode;
      kind?: TaskEdgeKind;
      messageFormat?: TaskEdgeMessageFormat;
      messageSchema?: string;
      returnFormat?: TaskEdgeReturnFormat;
      timeoutMs?: number;
      retryCount?: number;
      cacheEnabled?: boolean;
      priority?: TaskEdgePriority;
      delegationPolicy?: 'strict' | 'auto';
      critiqueTiming?: TaskEdgeCritiqueTiming;
      critiqueAuthority?: TaskEdgeCritiqueAuthority;
      maxReworkCount?: number;
      commandMode?: TaskEdgeCommandMode;
    },
  ): TaskEdge | null {
    const edge = this.taskEdges.get(id);
    if (!edge) return null;
    if (updates.command !== undefined) edge.command = updates.command;
    if (updates.forwardMode !== undefined) edge.forwardMode = updates.forwardMode;
    if (updates.kind !== undefined) edge.kind = updates.kind;
    if (updates.messageFormat !== undefined) edge.messageFormat = updates.messageFormat;
    if (updates.messageSchema !== undefined) edge.messageSchema = updates.messageSchema;
    if (updates.returnFormat !== undefined) edge.returnFormat = updates.returnFormat;
    if (updates.timeoutMs !== undefined) edge.timeoutMs = updates.timeoutMs;
    if (updates.retryCount !== undefined) edge.retryCount = updates.retryCount;
    if (updates.cacheEnabled !== undefined) edge.cacheEnabled = updates.cacheEnabled;
    if (updates.priority !== undefined) edge.priority = updates.priority;
    if (updates.delegationPolicy !== undefined) edge.delegationPolicy = updates.delegationPolicy;
    if (updates.critiqueTiming !== undefined) edge.critiqueTiming = updates.critiqueTiming;
    if (updates.critiqueAuthority !== undefined) edge.critiqueAuthority = updates.critiqueAuthority;
    if (updates.maxReworkCount !== undefined) edge.maxReworkCount = updates.maxReworkCount;
    if (updates.commandMode !== undefined) edge.commandMode = updates.commandMode;
    return edge;
  }

  /** Task Edge 삭제 */
  deleteTaskEdge(id: string): boolean {
    return this.taskEdges.delete(id);
  }

  /** Task Edge 를 기존 ID·필드 그대로 이 인스턴스로 수용. 오배치된 엣지를 올바른 인스턴스로
   *  옮길 때 사용(마이그레이션). 이미 같은 ID 가 있으면 덮어쓰지 않고 false. */
  acceptTaskEdge(edge: TaskEdge): boolean {
    if (this.taskEdges.has(edge.id)) return false;
    this.taskEdges.set(edge.id, edge);
    return true;
  }

  /** Task Edge 상태 변경 (서버 내부용) */
  setTaskEdgeStatus(id: string, status: TaskEdgeStatus, result?: string, errorMessage?: string): void {
    const edge = this.taskEdges.get(id);
    if (!edge) return;
    edge.status = status;
    if (status === 'executing') edge.lastExecutedAt = Date.now();
    if (result !== undefined) edge.lastResult = result;
    if (errorMessage !== undefined) edge.errorMessage = errorMessage;
  }

  /** 특정 에이전트가 소스인 auto Task Edge 조회 (완료 시 자동 전파용) */
  getAutoForwardEdges(sourceAgentId: string): TaskEdge[] {
    const result: TaskEdge[] = [];
    for (const edge of this.taskEdges.values()) {
      if (edge.sourceAgentId === sourceAgentId && edge.forwardMode === 'auto' && edge.status === 'idle') {
        result.push(edge);
      }
    }
    return result;
  }

  /** Task Edge 스냅샷 (GraphSnapshot용) */
  getTaskEdgesSnapshot(): Record<string, TaskEdge> {
    return Object.fromEntries(this.taskEdges);
  }

  // ─── Comment Box (v1.45) — 언리얼 블프 스타일 주석 ───

  /** Comment Box 생성. 서버에서 ID 발급. */
  createCommentBox(input: {
    projectName: string;
    x: number;
    y: number;
    width: number;
    height: number;
    text?: string;
    color?: string;
    textColor?: string;
    fontSize?: number;
    opacity?: number;
    childNodeIds?: string[];
  }): CommentBox {
    const id = `comment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    const box: CommentBox = {
      id,
      projectName: input.projectName,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      text: input.text ?? '',
      color: input.color ?? COMMENT_BOX_DEFAULTS.DEFAULT_COLOR,
      ...(input.textColor !== undefined && { textColor: input.textColor }),
      ...(input.fontSize !== undefined && { fontSize: input.fontSize }),
      ...(input.opacity !== undefined && { opacity: input.opacity }),
      childNodeIds: input.childNodeIds ?? [],
      createdAt: now,
      updatedAt: now,
    };
    this.commentBoxes.set(id, box);
    return box;
  }

  /** Comment Box 업데이트. 위치/크기/스타일/자식 목록 등 부분 갱신. */
  updateCommentBox(
    id: string,
    updates: Partial<Omit<CommentBox, 'id' | 'projectName' | 'createdAt' | 'updatedAt'>>,
  ): CommentBox | null {
    const box = this.commentBoxes.get(id);
    if (!box) return null;
    if (updates.x !== undefined) box.x = updates.x;
    if (updates.y !== undefined) box.y = updates.y;
    if (updates.width !== undefined) box.width = updates.width;
    if (updates.height !== undefined) box.height = updates.height;
    if (updates.text !== undefined) box.text = updates.text;
    if (updates.color !== undefined) box.color = updates.color;
    if (updates.textColor !== undefined) box.textColor = updates.textColor;
    if (updates.fontSize !== undefined) box.fontSize = updates.fontSize;
    if (updates.opacity !== undefined) box.opacity = updates.opacity;
    if (updates.childNodeIds !== undefined) box.childNodeIds = [...updates.childNodeIds];
    box.updatedAt = Date.now();
    return box;
  }

  /** Comment Box 삭제. */
  deleteCommentBox(id: string): boolean {
    return this.commentBoxes.delete(id);
  }

  /** Comment Box 단일 조회. */
  getCommentBox(id: string): CommentBox | undefined {
    return this.commentBoxes.get(id);
  }

  /** 이 인스턴스가 소유한 모든 Comment Box (스냅샷/체크포인트 공통). */
  getCommentBoxes(): CommentBox[] {
    return [...this.commentBoxes.values()];
  }

  /** 기존 ID 그대로 수용 (체크포인트 복원/머지용). */
  acceptCommentBox(box: CommentBox): boolean {
    if (this.commentBoxes.has(box.id)) return false;
    this.commentBoxes.set(box.id, box);
    return true;
  }

  // ─── §5.3 #28 v1.47 — 콘티모드 (Conti) ───

  /** 콘티 단건 조회 */
  getConti(id: string): Conti | undefined {
    return this.contis.get(id);
  }

  /** 모든 콘티 (snapshot/checkpoint 직렬화 공통) */
  getContis(): Conti[] {
    return [...this.contis.values()];
  }

  /** agentId 가 소유한 콘티 (createdAt asc) */
  getContisByAgent(agentId: string): Conti[] {
    return [...this.contis.values()]
      .filter((c) => c.agentId === agentId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** 콘티 신규 추가 (id 는 미리 발급됨, ContiManager.contiId.conti() 또는 호출자 발급) */
  addConti(c: Conti): void {
    this.contis.set(c.id, c);
  }

  /** 콘티 삭제 */
  deleteConti(id: string): boolean {
    return this.contis.delete(id);
  }

  /** 콘티에 frame append. 반환=신규 frame. id 는 호출자 발급. */
  addContiFrame(contiId: string, frame: ContiFrame): ContiFrame | null {
    const c = this.contis.get(contiId);
    if (!c) return null;
    c.frames.push(frame);
    return frame;
  }

  /** 콘티 frame 인덱스 기반 삭제 */
  deleteContiFrame(contiId: string, frameIndex: number): boolean {
    const c = this.contis.get(contiId);
    if (!c) return false;
    if (frameIndex < 0 || frameIndex >= c.frames.length) return false;
    c.frames.splice(frameIndex, 1);
    return true;
  }

  /** §5.3 #28 v1.59 — 콘티 frame 순서 변경 (드래그앤드롭). 같은 인덱스/범위 밖이면 무동작. */
  moveContiFrame(contiId: string, fromIndex: number, toIndex: number): boolean {
    const c = this.contis.get(contiId);
    if (!c) return false;
    if (fromIndex < 0 || fromIndex >= c.frames.length) return false;
    if (toIndex < 0 || toIndex >= c.frames.length) return false;
    if (fromIndex === toIndex) return false;
    const [moved] = c.frames.splice(fromIndex, 1);
    if (!moved) return false;
    c.frames.splice(toIndex, 0, moved);
    c.updatedAt = Date.now();
    return true;
  }

  /** 콘티 frame title/action patch (LLM 미경유) */
  patchContiFrame(
    contiId: string,
    frameIndex: number,
    updates: { title?: string; action?: string },
  ): ContiFrame | null {
    const c = this.contis.get(contiId);
    if (!c) return null;
    const f = c.frames[frameIndex];
    if (!f) return null;
    if (updates.title !== undefined) f.title = updates.title.slice(0, 200);
    if (updates.action !== undefined) f.action = updates.action.slice(0, 400);
    return f;
  }

  /** 콘티 element 단건 교체 (LLM patch 결과 적용) */
  replaceContiElement(
    contiId: string,
    frameId: string,
    elementId: string,
    next: ContiElement,
  ): ContiElement | null {
    const c = this.contis.get(contiId);
    if (!c) return null;
    const f = c.frames.find((x) => x.id === frameId);
    if (!f) return null;
    const idx = f.elements.findIndex((e) => e.id === elementId);
    if (idx < 0) return null;
    f.elements[idx] = next;
    return next;
  }

  /** 콘티 element 단건 조회 — patch LLM 호출 전 현재값 확보용 */
  findContiElement(
    contiId: string,
    frameId: string,
    elementId: string,
  ): { conti: Conti; frame: ContiFrame; element: ContiElement } | null {
    const c = this.contis.get(contiId);
    if (!c) return null;
    const f = c.frames.find((x) => x.id === frameId);
    if (!f) return null;
    const e = f.elements.find((x) => x.id === elementId);
    if (!e) return null;
    return { conti: c, frame: f, element: e };
  }

  /** snapshot/checkpoint 직렬화 (Object) */
  getContisRecord(): Record<string, Conti> {
    return Object.fromEntries(this.contis);
  }

  /**
   * §5.3 #28 (L) v1.58 — 콘티 frames 통째 교체 (수정 케이스). title 도 같이 갱신,
   * updatedAt 만 bump. id/agentId/workId/createdAt 은 보존.
   */
  updateContiFrames(contiId: string, frames: ContiFrame[], title?: string): Conti | null {
    const c = this.contis.get(contiId);
    if (!c) return null;
    c.frames = frames;
    if (title !== undefined) c.title = title.slice(0, 200);
    c.updatedAt = Date.now();
    return c;
  }

  /** §5.3 #28 (L) v1.58 — 콘티 작업 트래커 (agentId → ActiveContiWork) */
  getActiveContiWork(agentId: string): ActiveContiWork | undefined {
    return this.activeContiWork.get(agentId);
  }

  /** 모든 인플라이트 작업 (snapshot 직렬화용) */
  getActiveContiWorkRecord(): Record<string, ActiveContiWork> {
    return Object.fromEntries(this.activeContiWork);
  }

  /** 작업 시작 — workId 발급 후 트래커에 저장. 이미 있으면 덮어쓰지 않고 기존 반환. */
  startContiWork(agentId: string, source: ContiWorkSource): ActiveContiWork {
    const existing = this.activeContiWork.get(agentId);
    if (existing) return existing;
    const work: ActiveContiWork = {
      workId: `work-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      source,
      startedAt: Date.now(),
    };
    this.activeContiWork.set(agentId, work);
    return work;
  }

  /** 첫 응답으로 Conti 가 만들어진 뒤 호출 — contiId 머지. */
  attachContiIdToWork(agentId: string, contiId: string): boolean {
    const w = this.activeContiWork.get(agentId);
    if (!w) return false;
    w.contiId = contiId;
    return true;
  }

  /** 사용자가 명시적으로 새 콘티 작업을 시작하고 싶을 때 호출 — 기존 트래커 항목 폐기 후 새로 발급. */
  resetContiWork(agentId: string, source: ContiWorkSource): ActiveContiWork {
    this.activeContiWork.delete(agentId);
    return this.startContiWork(agentId, source);
  }
}

/** 싱글턴 인스턴스 */
export const projectGraph = new ProjectGraph();
