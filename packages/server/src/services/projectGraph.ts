import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { validatePathWithinRoot } from './pathValidator.js';
// 경로 대소문자 정책 SSOT — win32/darwin 만 접고 linux 는 접지 않는다(`shared/pathCase.ts`).
import { CASE_INSENSITIVE_FS, pathKey, samePath } from './pathKey.js';
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
  ProjectAgentCounts,
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
  DebugBreakpoint,
  AppBubble,
  CaptureBubble,
  PlayBubble,
  PlayRecipe,
  SpecDoc,
  SpecItem,
  ReviewRequest,
  ReviewDecision,
  ReviewRequestStatus,
  ReviewFileChange,
  LabRun,
  ShelfBubble,
  ShelfItem,
  ShelfItemKind,
  ShelfItemRun,
  ShelfRunStatus,
  ShelfImportDraftItem,
  LabVariant,
  LabVariantConfig,
  LabResult,
  Conti,
  ContiFrame,
  ContiElement,
  ActiveContiWork,
  ContiRenderLink,
  StoryboardPresetId,
  ContiWorkSource,
  ToolDurationEntry,
  CompactCount,
  AutoAgentSummary,
  AutoAgentRun,
  AutoAgentRunStatus,
  VerificationAttempt,
  EscalationReason,
  AgentReport,
  AgentQuestions,
  AgentReview,
  AgentList,
  AgentFeedback,
  BrainInjectionEvent,
  BrainSummary,
  SessionLoop,
  VerificationRun,
  VerifyVerdict,
  SessionLoopContextMode,
  SessionGoal,
  SessionGoalStatus,
  SessionGoalProgress,
  SessionGoalProgressSource,
  SessionGoalStep,
  SessionGoalStepStatus,
  ContextOverrides,
  ContextOverrideMap,
} from '@vibisual/shared';
import { LOCAL_AGENT_COLOR, ALL_MODEL_DEFAULT_LABEL_RE, MAX_BASH_HISTORY, MAX_FILE_EDITS, MAX_WRITE_DIFF_BYTES, DEFAULT_MAX_SATELLITES, SATELLITE_MAX_BOUNDS, MAX_AGENTS, SATELLITE_TYPES, AGENT_FADE_DURATION, BUBBLE_TTL, GHOST_FADE_DURATION, FILE_EXISTENCE_MISS_THRESHOLD, FRONTEND_SERVER_PATTERNS, IFRAME_DEAD_GRACE_MS, parseModelFamily, DEFAULT_AGENT_CONFIG, AVAILABLE_AGENT_TOOLS, BACKFILL_AGENT_TOOLS, DEFAULT_UI_LOCALE, COMMENT_BOX_DEFAULTS, READ_TOOLS, TASK_EDGE_AUTO_REWORK_COMMAND_LABEL, AGENT_REPORT_MAX_PER_AGENT, AGENT_QUESTIONS_MAX_PER_AGENT, AGENT_REVIEWS_MAX_PER_AGENT, AGENT_LISTS_MAX_PER_AGENT, AGENT_FEEDBACK_MAX_PER_AGENT, DELETED_AGENT_TOMBSTONE_MAX, CMD_AGENT_COLOR, MAX_AGENT_EVENTS, BRAIN_INJECTIONS_MAX_PER_AGENT, SESSION_GOAL_NOTE_MAX, SESSION_GOAL_HISTORY_MAX, SESSION_GOAL_STEPS_MAX, SESSION_GOAL_STEP_TEXT_MAX, SESSION_GOAL_TEXT_MAX, AUTO_AGENT_RUN_MAX_PER_AGENT, AUTO_AGENT_RUN_DEFAULT_REWORK_BUDGET, isExpiredByDays, capMapSize, SESSION_KEYED_MAP_MAX, ROOT_NODE_KEY_PREFIX, LEGACY_ROOT_NODE_KEY, SPEC_TITLE_MAX, SPEC_BODY_MAX, SPEC_MAX_ITEMS, SPEC_ITEM_TEXT_MAX, REVIEW_FILES_MAX, REVIEW_DIFF_MAX_BYTES, REVIEW_REQUESTS_MAX_PER_PROJECT, REVIEW_DECISIONS_MAX, REVIEW_REASON_MAX, LAB_TITLE_MAX, LAB_TASK_MAX, LAB_VARIANT_LABEL_MAX, LAB_RULES_APPEND_MAX, LAB_SUMMARY_MAX, LAB_MAX_VARIANTS, LAB_RUNS_MAX_PER_PROJECT, SHELF_TITLE_MAX, SHELF_LABEL_MAX, SHELF_COMMAND_MAX, SHELF_PROMPT_MAX, SHELF_MAX_ITEMS, SHELF_BUBBLES_MAX_PER_PROJECT, SHELF_RUN_OUTPUT_MAX_CHARS, normalizeShelfIcon, normalizeShelfColor, isSessionRunning, agentBadgeShare, VERIFICATION_RUNS_MAX_PER_SESSION, VERIFICATION_ATTEMPTS_MAX, VERIFICATION_REASON_MAX } from '@vibisual/shared';
import type { ServerKind, UiLocale, ExecutionMode, AgentProvider, ModelRegistry } from '@vibisual/shared';
// §5.22 — 권한·감사 경계.
import type { AuditBoundaryConfig, AuditDecisionSource, ProjectAuditLog } from '@vibisual/shared';
import { COST_MAP_ACTIVE_WINDOW_MS } from '@vibisual/shared';
// §7.11 — 루프백 주소 판정·추출(감지 폴백이 background 셸 밖의 서버도 회수하는 자리).
import {
  extractLoopbackUrls,
  parseLoopbackUrl,
  LOOPBACK_SNIFF_URLS_PER_BASH,
  LOOPBACK_SNIFF_PROBE_TTL_MS,
} from '@vibisual/shared';
import { EdgeManager } from './edgeManager.js';
import { extractBashReadPaths } from './bashReadPaths.js';
import { extractPort, extractPortFromInlineEval, extractPortFromScriptFile, isPortAlive, resolveServingUrl, isProbeCommand, isVibisualLauncherCommand, isVibisualOwnPort } from './processChecker.js';
import { BackgroundShellWatcher, parseBackgroundShellResponse, scanActiveBackgroundShells, stripAnsi } from './backgroundShellWatcher.js';
import { subAgentManager, getCmdSessionIds } from './subAgentManager.js';
import { CostMapService } from './costMap.js';
import type { CostSweepSession } from './costMap.js';
import { AuditLogService } from './auditLog.js';
import type { AuditRecordInput } from './auditLog.js';
import { sanitizeContiOnLoad } from './contiManager.js';
import { isShortAlive as isAgentViewShortAlive, isShortWorking as isAgentViewShortWorking, readRoster as readAgentViewRoster } from './claudeAgentViewService.js';
import { pipelineManager } from './pipelineManager.js';
import { getBrainService } from './brainService.js';
import { brainEnabledFor } from './brainActivation.js';
import type { LocalSession, AgentContextInfo } from './sessionDiscovery.js';
import { resolveSessionTitle, readUserMessages, readLastAssistantMessage, readContextInfo, discoverSessions, findPidBySession, isSessionInUse, getSessionJsonlPath, listJsonlSessionIds, findEntrypointBySession, isSessionInterrupted, readSessionTokenData } from './sessionDiscovery.js';
import { logger } from '../logger.js';
import { appStateGetRetention } from './appState.js';
import { isLiveWorktreeDir, isWorktreeUnderConstruction } from './worktreeLiveness.js';
import { dbg } from './debugLog.js';
import { userDefaultsService } from './userDefaultsService.js';

// ─── 유틸 (순수 함수) ───

/**
 * §5.14 v4.62 — 디스크에서 올라온 플레이 버블의 실행 상태를 내린다.
 *
 * 버튼·레시피·좌표는 사용자의 것이라 그대로 살리되, `running`/`starting` 은 **앱과 함께 죽은
 * 프로세스**의 잔상이다. 그대로 복원하면 캔버스에 "실행 중"이라고 적힌 채 아무 데도 안 붙는
 * 프리뷰가 뜬다(§3.2 왕복 함정과 같은 계열 — 살아 있는 것과 저장된 것을 구분하지 않은 실수).
 */
/**
 * 인스턴스 간 id 충돌을 막는 꼬리.
 *
 * `Date.now()` + **인스턴스별** 카운터만으로는 부족하다. `ProjectGraph` 는 하나가 아니라
 * 프로젝트·워크트리마다 있어서, 두 인스턴스가 같은 밀리초에 첫 항목을 만들면 카운터가 둘 다 1 이라
 * **완전히 같은 id** 가 나온다. 그 뒤 `mergeFromCheckpoint` 의 합집합에서 한쪽이 조용히 사라진다 —
 * 에러도 경고도 없이 사용자가 만든 문서 하나가 없어지는 종류의 손실이다.
 *
 * 이 파일의 다른 id 들(`comment-`·`app-`·`capture-`·`play-` …)은 이미 이 조각을 물고 있었고,
 * 카운터를 쓰는 쪽만 빠져 있었다. 2026-08-28 CI 에서 `projectGraphSpecDocs.test.ts` 의
 * "머지 복원은 있던 것을 덮지 않는다"가 세 OS 에서 한꺼번에 빨개져 드러났다(로컬 재현 15회 중 9회).
 * 시간에 기대는 테스트라 그동안은 운 좋게 통과했을 뿐이고, 결함은 8/19부터 있었다.
 *
 * ⚠️ id 의 **모양**을 파싱하는 코드는 없다(세션 키 판별도 맵 조회로 한다) — 그래서 꼬리를
 *    덧붙여도 안전하다. 이미 저장된 id 는 그대로 유효하다.
 */
function idTail(): string {
  return Math.random().toString(36).slice(2, 6);
}
function sanitizePlayBubbleOnLoad(bubble: PlayBubble): PlayBubble {
  const { url: _url, port: _port, error: _error, ...rest } = bubble;
  return { ...rest, status: 'idle', previewOpen: false };
}

/**
 * §5.15 — 디스크에서 올라온 스펙 한 장을 정규화한다.
 *
 * 실행 상태가 없으므로 내릴 것은 없고, **구버전·손상 체크포인트에서 빠졌을 수 있는 필드만**
 * 채운다(`items` 가 배열이 아니면 빈 배열, `bodyRevision` 이 없으면 0). 사람이 쓴 문장 자체는
 * 손대지 않는다 — 여기서 자르면 사용자가 쓴 것이 조용히 사라진다.
 */
function sanitizeSpecDocOnLoad(doc: SpecDoc): SpecDoc {
  return {
    ...doc,
    title: typeof doc.title === 'string' ? doc.title : '',
    body: typeof doc.body === 'string' ? doc.body : '',
    items: Array.isArray(doc.items) ? doc.items.filter((it) => it && typeof it.id === 'string') : [],
    bodyRevision: typeof doc.bodyRevision === 'number' ? doc.bodyRevision : 0,
  };
}

/**
 * §5.16 — 디스크에서 올라온 리뷰 한 건을 정규화한다.
 *
 * 실행 상태가 없으므로 내릴 것은 없고, 구버전·손상 체크포인트에서 빠졌을 수 있는 필드만 채운다.
 * 사람이 쓴 반려 사유는 손대지 않는다 — 여기서 자르면 판단 근거가 조용히 사라진다.
 */
function sanitizeReviewRequestOnLoad(req: ReviewRequest): ReviewRequest {
  const status: ReviewRequestStatus =
    req.status === 'approved' || req.status === 'rejected' || req.status === 'held' ? req.status : 'pending';
  return {
    ...req,
    files: Array.isArray(req.files) ? req.files.filter((f) => f && typeof f.path === 'string') : [],
    diff: typeof req.diff === 'string' ? req.diff : '',
    status,
    decisions: Array.isArray(req.decisions) ? req.decisions.filter((d) => d && typeof d.id === 'string') : [],
  };
}

/**
 * §5.18 — 변형이 흔드는 설정 축만 남긴다. 여기 없는 키는 기준 에이전트 설정에서 온다.
 * 빈 문자열은 "이 축은 안 흔든다"는 뜻이므로 필드 자체를 떨어뜨린다(빈 값으로 덮어써서
 * 기준 설정의 모델이 사라지는 사고를 막는다).
 */
function sanitizeLabVariantConfig(cfg: LabVariantConfig | undefined): LabVariantConfig {
  const out: LabVariantConfig = {};
  if (!cfg) return out;
  if (typeof cfg.model === 'string' && cfg.model.trim() !== '') out.model = cfg.model.trim();
  if (typeof cfg.effort === 'string' && cfg.effort.trim() !== '') out.effort = cfg.effort.trim();
  if (typeof cfg.permissionMode === 'string' && cfg.permissionMode.trim() !== '') {
    out.permissionMode = cfg.permissionMode.trim();
  }
  if (typeof cfg.maxTurns === 'number' && Number.isFinite(cfg.maxTurns) && cfg.maxTurns > 0) {
    out.maxTurns = Math.floor(cfg.maxTurns);
  }
  if (typeof cfg.rulesAppend === 'string' && cfg.rulesAppend.trim() !== '') {
    out.rulesAppend = cfg.rulesAppend.slice(0, LAB_RULES_APPEND_MAX);
  }
  return out;
}

/**
 * §5.18 — 디스크에서 올라온 랩 한 장을 정규화한다.
 *
 * 앱과 함께 죽은 프로세스는 아무것도 돌고 있지 않으므로 **`running` 잔상을 내린다**(플레이 버블의
 * `running → idle` 강등과 같은 규율). 사람이 쓴 과제 문장·측정된 결과값은 손대지 않는다.
 */
function sanitizeLabRunOnLoad(run: LabRun): LabRun {
  const variants: LabVariant[] = Array.isArray(run.variants)
    ? run.variants
      .filter((v) => v && typeof v.id === 'string')
      .map((v) => {
        const result = v.result;
        if (!result) return { ...v, config: sanitizeLabVariantConfig(v.config) };
        // 재시작 직후에 도는 변형은 없다 — 끊긴 것으로 표시해 표가 거짓말하지 않게 한다.
        const status = result.status === 'running' || result.status === 'pending' ? 'stopped' : result.status;
        return { ...v, config: sanitizeLabVariantConfig(v.config), result: { ...result, status } };
      })
    : [];
  const hasResult = variants.some((v) => v.result !== undefined);
  return {
    ...run,
    title: typeof run.title === 'string' ? run.title : '',
    task: typeof run.task === 'string' ? run.task : '',
    variants,
    status: hasResult ? 'done' : 'draft',
  };
}

/**
 * §5.20 — 디스크에서 올라온 선반 한 장을 정규화한다.
 *
 * 앱과 함께 죽은 프로세스는 아무것도 돌고 있지 않으므로 **`running` 잔상을 내린다**(랩·플레이 버블과
 * 같은 규율 — 그대로 살리면 화면이 "지금 돌고 있다"고 거짓말한다). 아이콘·색은 고정 목록 안으로
 * 되돌린다 — 예전 버전이 남긴 값이나 손으로 고친 체크포인트가 화면에 아무 글리프나 그리지 못하게.
 */
function sanitizeShelfBubbleOnLoad(bubble: ShelfBubble): ShelfBubble {
  const items: ShelfItem[] = Array.isArray(bubble.items)
    ? bubble.items
      .filter((i) => i && typeof i.id === 'string')
      .slice(0, SHELF_MAX_ITEMS)
      .map((i) => {
        const kind: ShelfItemKind = i.kind === 'prompt' ? 'prompt' : 'command';
        const run = i.lastRun;
        const next: ShelfItem = {
          ...i,
          kind,
          icon: normalizeShelfIcon(i.icon, kind),
          color: normalizeShelfColor(i.color),
        };
        // 재시작 직후에 도는 항목은 없다 — 끊긴 것으로 표시한다.
        if (run && run.status === 'running') {
          next.lastRun = { ...run, status: 'failed', error: run.error ?? 'interrupted by restart' };
        }
        return next;
      })
    : [];
  return {
    ...bubble,
    title: typeof bubble.title === 'string' ? bubble.title : '',
    items,
  };
}
/**
 * §2.4 — 디스크에서 올라온 버블의 "활동중" 잔상을 내린다.
 *
 * 재시작 직후엔 아무 일도 일어나고 있지 않다. 저장된 `active`/`completed` 는 앱과 함께 죽은
 * 세션의 잔상이라, 그대로 살리면 아무도 만지지 않는 버블이 펄스 링을 단 채 캔버스에 남는다.
 * 에이전트 버블은 예전부터 이 규칙을 받았지만(v1.60/v1.73) 파일/폴더 버블은 빠져 있어서,
 * 같은 증상이 한 층 아래에서 되풀이됐다 — 에이전트는 얌전히 꺼져 있는데 그 에이전트가 만졌던
 * 파일·폴더만 계속 빛나는 상태. 그 노드들은 `isAlive` 의 5분 TTL 도 통과해(active 는 항상 alive)
 * 영영 사라지지 않았다.
 *
 * 레거시 체크포인트의 `awaiting_input` 도 여기서 함께 정규화한다(status 유니온에서 빠졌으므로 raw 비교).
 */
function demoteStaleActivityOnLoad(bubble: BubbleData): void {
  if (
    bubble.status === 'active'
    || bubble.status === 'completed'
    || (bubble.status as string) === 'awaiting_input'
  ) {
    bubble.status = 'idle';
    bubble.fadeStartedAt = undefined;
  }
}

function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * 노드/프로젝트 Map 키 — 슬래시 통일 + 끝 슬래시 제거 + **그 플랫폼이 실제로 무시할 때만** 소문자.
 *
 * 예전에는 무조건 소문자로 접었다. Windows 는 파일시스템이 대소문자를 안 가려 옳았지만 Linux 는
 * `Feature-X` 와 `feature-x` 가 실재하는 별개 폴더라, 두 프로젝트·워크트리가 한 키로 뭉개져
 * 한쪽 등록이 다른 쪽을 **에러 한 줄 없이** 덮어썼다. 정책은 `shared/pathCase.ts` 한 곳.
 */
function normalize(filePath: string): string {
  return foldCase(filePath.replace(/\\/g, '/').replace(/\/+$/, ''));
}

/**
 * 이미 정규화된 상대 경로를 `normalize()` 결과와 맞물리게 접는다.
 * 노드 키를 만드는 자리에서만 쓴다(확장자·검색어 소문자화와 혼동 금지).
 */
function foldCase(s: string): string {
  return CASE_INSENSITIVE_FS ? s.toLowerCase() : s;
}

/** cwd + 상대경로를 합쳐서 `..`/`.` 까지 collapse 한 정규화 경로.
 *  단순 `normalize()` 는 backslash/lowercase 만 처리하고 `..` 를 그대로 둬서
 *  `path: '..\\foo'` 같은 입력이 들어오면 가짜 `..` segment 가 폴더 버블로 박힌다.
 *  (사례: Grep `..\\TEST\\xxx` → `..` 폴더 + 자식 segment 들이 마스터 트리에 새겨짐) */
function resolveRelative(cwd: string, relPath: string): string {
  const joined = `${cwd}/${relPath}`.replace(/\\/g, '/');
  return foldCase(path.posix.normalize(joined).replace(/\/+$/, ''));
}

/** normalize() 결과가 절대 경로인지 (Windows 드라이브 또는 POSIX root).
 *  드라이브 문자는 대소문자를 가리지 않는다 — `normalize()` 가 더 이상 무조건 소문자로 접지 않으므로
 *  소문자만 보면 대소문자 구분 FS 에서 `C:/…` 를 상대경로로 오판한다. */
function isAbsoluteNormalized(normalizedPath: string): boolean {
  return /^[a-zA-Z]:\//.test(normalizedPath) || normalizedPath.startsWith('/');
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

/** §2.1 #3 — Bash 로 읽은 경로에 붙일 도구 이름. `READ_TOOLS` 에 속해야 엣지가 읽기 방향으로 선다. */
const BASH_READ_TOOL_NAME = 'Read';

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

/** §7.11 v2.29 — iframe 위성 dedup 용 정규화 키 = 포트 문자열. host alias(localhost/127.0.0.1)·경로·쿼리를
 *  무시하고 포트만 남긴다(한 프로젝트 안에서 포트는 서버를 유일하게 가리킴). 파싱 실패면 null. */
function iframePortKey(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.port || (u.protocol === 'https:' ? '443' : '80');
  } catch {
    return null;
  }
}

/**
 * §5.5 #17-17 ⑨ v4.59 — 디스크에서 읽은 에이전트 설정의 도구 목록 백필(복원·병합 공용).
 *
 * `TodoWrite` 는 v4.59 전까지 `AVAILABLE_AGENT_TOOLS` 에 없어 **설정창에 체크박스로 존재한 적이
 * 없었다**. 그러니 옛 설정에 그 항목이 없는 것은 "사용자가 껐다"가 아니라 "고를 기회가 없었다"이며,
 * 그대로 두면 판올림 전에 만든 에이전트는 계속 계획을 세우지 못해 목표창(#17-17)이 빈 채로 남는다.
 * 복원·병합 경로에서만 채우므로, 사용자가 앞으로 이 도구를 직접 해제하면 그 선택은 그대로 유지된다.
 */
function backfillAgentConfigTools(config: AgentConfig): AgentConfig {
  if (!Array.isArray(config.tools)) return config;
  const missing = BACKFILL_AGENT_TOOLS.filter((t) => !config.tools.includes(t));
  if (missing.length === 0) return config;
  return { ...config, tools: [...config.tools, ...missing] };
}

/**
 * §5.5 #17-17 v4.46 — 디스크에서 읽은 세션 목표 정규화(복원·병합 공용).
 * 구버전 체크포인트에는 없던 필드가 있을 수 있어 기본값을 채우고, 퍼센트·이력 길이를 계약대로 조인다
 * (여기서 안 조이면 손상된 파일 하나가 UI 게이지를 이상하게 만든다).
 */
function normalizeSessionGoal(goal: SessionGoal): SessionGoal {
  const history: SessionGoalProgress[] = Array.isArray(goal.history)
    ? goal.history.filter((h): h is SessionGoalProgress => !!h && typeof h.at === 'number')
    : [];
  // §5.5 #17-17 v4.47 — v4.46 판본 체크포인트에는 steps 가 없다(빈 배열로 보충).
  const steps: SessionGoalStep[] = Array.isArray(goal.steps)
    ? goal.steps
        .filter((s): s is SessionGoalStep => !!s && typeof s.text === 'string')
        .slice(0, SESSION_GOAL_STEPS_MAX)
    : [];
  return {
    ...goal,
    // v4.46~47 판본에는 authoredBy 가 없다 — 자동 관리(세션 소유)를 기본으로 본다(v4.50 ①).
    authoredBy: goal.authoredBy === 'user' ? 'user' : 'session',
    steps,
    // 단계가 있으면 저장된 숫자를 믿지 않고 체크리스트에서 다시 센다(둘이 어긋난 파일 방어).
    percent: steps.length > 0
      ? deriveGoalPercent(steps)
      : Math.max(0, Math.min(100, Math.round(goal.percent ?? 0))),
    status: goal.status ?? 'active',
    history: history.slice(Math.max(0, history.length - SESSION_GOAL_HISTORY_MAX)),
    revision: typeof goal.revision === 'number' ? goal.revision : 0,
  };
}

/**
 * §5.5 #17-17 v4.50 — 세션 명령에서 목표 머리글 한 줄을 뽑는다(자동 생성 전용).
 * 사이드바 폭(w-52)에 들어갈 길이로 접고, 줄바꿈·연속 공백은 한 칸으로 눌러 한 줄로 만든다.
 */
function summarizeGoalSeed(command: string): string {
  const flat = command.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length > GOAL_SEED_MAX ? `${flat.slice(0, GOAL_SEED_MAX).trimEnd()}…` : flat;
}

/** 자동 생성 목표 머리글의 최대 길이 — 사용자가 적거나 에이전트가 다듬은 문장에는 적용되지 않는다. */
const GOAL_SEED_MAX = 200;

/** §5.5 #17-17 v4.47 — 체크리스트에서 퍼센트 파생 (`done/전체`). 단계가 없으면 0. */
function deriveGoalPercent(steps: SessionGoalStep[]): number {
  if (steps.length === 0) return 0;
  const done = steps.filter((s) => s.status === 'done').length;
  return Math.round((done / steps.length) * 100);
}

/**
 * §5.5 #17-17 v4.47 ⑧ — 들어온 단계 목록으로 체크리스트를 다시 세운다.
 *
 * **본문이 같은 기존 단계의 id 를 재사용**하는 것이 핵심 — 에이전트가 목록을 통째로 다시 보내도
 * 사용자가 보고 있던 항목이 새 id 로 갈려 체크박스가 튀거나 리스트가 깜빡이지 않는다.
 * 같은 본문이 여러 번 나오면 앞에서부터 하나씩 소비한다(중복 항목도 각자 id 를 유지).
 */
function rebuildGoalSteps(
  prev: SessionGoalStep[],
  incoming: { text: string; status?: SessionGoalStepStatus }[],
  now: number,
): SessionGoalStep[] {
  const pool = new Map<string, SessionGoalStep[]>();
  for (const p of prev) {
    const list = pool.get(p.text);
    if (list) list.push(p);
    else pool.set(p.text, [p]);
  }
  const out: SessionGoalStep[] = [];
  for (const raw of incoming.slice(0, SESSION_GOAL_STEPS_MAX)) {
    const text = (raw?.text ?? '').trim().slice(0, SESSION_GOAL_STEP_TEXT_MAX);
    if (!text) continue;
    const status: SessionGoalStepStatus =
      raw.status === 'done' || raw.status === 'in_progress' ? raw.status : 'pending';
    const reuse = pool.get(text)?.shift();
    out.push(
      reuse
        ? { ...reuse, status, updatedAt: reuse.status === status ? reuse.updatedAt : now }
        : { id: `gs-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, text, status, updatedAt: now },
    );
  }
  return out;
}

/** 단계 목록이 실질적으로 같은가 (본문·순서·상태 전부 동일). 무의미한 이력 적재 차단용. */
function sameGoalSteps(a: SessionGoalStep[], b: SessionGoalStep[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.text === b[i]?.text && s.status === b[i]?.status);
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

/**
 * §5.5 #17-11 ⑪·⑫ — 디스크에서 올라온 루프 설정 1건을 지금 타입으로 맞춘다.
 *
 * 루프는 **사용자가 짜 넣은 설정**이라 옛 체크포인트를 버릴 수 없다. 새로 생긴 필드는 전부
 * "꺼짐 = 종전 동작" 으로 채우고, ⑪ 이 잠깐 썼던 `autoCompact: boolean` 은 `contextMode` 로 승계한다.
 * 순수 함수 — 입력을 건드리지 않고 새 객체를 돌려준다(테스트가 이 승계를 지킨다).
 */
/**
 * §5.5 #17-35 — 디스크에서 올라온 검증 한 건을 안전한 모양으로 되돌린다.
 *
 * 구버전 체크포인트엔 이 필드 자체가 없고, 손상된 파일에서 배열이 아닌 것이 올라올 수도 있다.
 * 여기서 막지 않으면 화면이 아니라 **복원 자체가** 터진다(§3.2 로드 게이트 완화 규율).
 */
export function normalizeVerificationRun(run: VerificationRun): VerificationRun {
  const attempts = Array.isArray(run.attempts)
    ? run.attempts
        .filter((a) => a && typeof a === 'object' && typeof a.command === 'string')
        .slice(0, VERIFICATION_ATTEMPTS_MAX)
    : [];
  const verdict: VerifyVerdict =
    run.verdict === 'pass' || run.verdict === 'fail' || run.verdict === 'held' ? run.verdict : 'unknown';
  return {
    ...run,
    attempts,
    verdict,
    reason: typeof run.reason === 'string' ? run.reason.slice(0, VERIFICATION_REASON_MAX) : undefined,
  };
}

export function normalizeSessionLoop(loop: SessionLoop): SessionLoop {
  const legacyAutoCompact = (loop as SessionLoop & { autoCompact?: boolean }).autoCompact === true;
  const mode = loop.contextMode;
  const contextMode: SessionLoopContextMode =
    mode === 'compact' || mode === 'clear' || mode === 'none'
      ? mode
      : (legacyAutoCompact ? 'compact' : 'none');
  const normalized: SessionLoop = {
    ...loop,
    contextMode,
    spentCostUsd: typeof loop.spentCostUsd === 'number' && loop.spentCostUsd > 0 ? loop.spentCostUsd : 0,
    spentTokens: typeof loop.spentTokens === 'number' && loop.spentTokens > 0 ? loop.spentTokens : 0,
    oneTaskPerRound: loop.oneTaskPerRound === true,
    commitEachRound: loop.commitEachRound === true,
  };
  delete (normalized as SessionLoop & { autoCompact?: boolean }).autoCompact;
  return normalized;
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
   * §7.11 — `sniffLoopbackServers` 의 probe 문. 키 `"{세션}|{포트}"` → 마지막으로 찔러 본 시각.
   * 에이전트는 한 세션에서 Bash 를 수백 번 돌리므로 문이 없으면 같은 주소에 매번 TCP+HTTP 를
   * 날린다. 영속 대상 ❌ — 재기동하면 다시 한 번 확인하는 편이 옳다.
   */
  private loopbackSniffProbedAt = new Map<string, number>();
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
   * §5.3 #10-3 v4.98 — 검증 런 (autoAgentSessionId → AutoAgentRun[], 최신이 뒤).
   * 영속화 대상 (ProjectCheckpoint.autoAgentRuns). ring buffer 캡 = AUTO_AGENT_RUN_MAX_PER_AGENT.
   * `autoAgentSummaries` 와 달리 요청마다 레코드가 늘어난다(덮어쓰지 않는다).
   */
  private autoAgentRuns = new Map<string, AutoAgentRun[]>();
  /**
   * §4 v2.52 — 에이전트 작업 신고 (agentId → AgentReport[]). did/userActions 색 구분용.
   * 영속화 대상 (ProjectCheckpoint.agentReports). ring buffer 캡 = AGENT_REPORT_MAX_PER_AGENT.
   */
  private agentReports = new Map<string, AgentReport[]>();
  /**
   * §5.10 Project Brain — 주입 이벤트 (agentId → BrainInjectionEvent[]). "기억 N장 참조" 칩 +
   * Brain→에이전트 일시 엣지 연출용 신호(카드 id/title 만). **런타임 전용 — 체크포인트 미영속**
   * (재시작 시 자연 비움; 주입 이력은 카드 refCount 로 남는다). ring buffer 캡 = BRAIN_INJECTIONS_MAX_PER_AGENT.
   */
  private brainInjections = new Map<string, BrainInjectionEvent[]>();
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
   * §4 v3.21 — 에이전트 피드백 (agentId → AgentFeedback[]). 좋아요/싫어요 → 규칙 되먹임용.
   * 영속화 대상 (ProjectCheckpoint.agentFeedbacks). ring buffer 캡 = AGENT_FEEDBACK_MAX_PER_AGENT.
   */
  private agentFeedbacks = new Map<string, AgentFeedback[]>();
  /**
   * §5.5 #17-11 v3.79 — 세션 반복 실행(루프) 설정 (subAgentId → SessionLoop).
   * 키가 **세션 탭 ID** 인 것이 핵심 — 탭마다 다른 반복 명령을 갖는다.
   * 영속화 대상 (ProjectCheckpoint.sessionLoops) — 사용자가 짜 넣은 설정 + 진행 카운트라
   * 재시작 후에도 이어져야 한다(회차 발사·정지 판단은 index.ts 런타임이 담당).
   */
  private sessionLoops = new Map<string, SessionLoop>();
  /**
   * §5.5 #17-35 — 검증 실행 이력 (subAgentId → VerificationRun[], **최신이 앞**).
   * 루프·목표와 같은 키 축(세션 탭)이다. 세션당 `VERIFICATION_RUNS_MAX_PER_SESSION` 건에서 자른다 —
   * 값 길이만 자르고 개수를 안 막으면 체크포인트가 무한히 자란다(§9).
   * 영속화 대상 (ProjectCheckpoint.verificationRuns) — "무엇이 언제 실제로 돌아서 통과했는가" 는
   * 세션이 끝나도 남아야 할 근거다. identity.json 은 아니다(실행 기록 ≠ 정체성 — §5.16 과 같은 판단).
   */
  private verificationRuns = new Map<string, VerificationRun[]>();
  /**
   * §5.5 #17-17 v4.46 — 세션 목표 (subAgentId → SessionGoal).
   * 루프와 같은 키 축(세션 탭)이지만 실행 주체가 아니라 **방향**이다 — 명령을 발사하지 않고
   * 매 턴 dispatchContext 에 다시 실려 세션을 조향하고, 진행률 퍼센트를 사용자에게 답한다.
   * 영속화 대상 (ProjectCheckpoint.sessionGoals + identity.json — 사용자가 쓴 문장이라 정체성).
   */
  private sessionGoals = new Map<string, SessionGoal>();
  /**
   * §5.5 #17-28 — 컨텍스트 주입원 오버라이드. 프로젝트 층 하나 + 세션 탭별 층.
   *
   * 여기 담기는 것은 **사용자의 뜻**뿐이다(무엇이 존재하고 몇 토큰인지는 조회 때마다 다시 잰다).
   * 영속화 대상 (ProjectCheckpoint.contextOverrides) — 잃으면 껐던 것이 조용히 다시 실린다.
   */
  private contextOverridesProject = new Map<string, Map<string, boolean>>();
  /** subAgentId → { 소속 에이전트(프로젝트 필터용), 값 }. 소속을 함께 들지 않으면 체크포인트를 못 가른다. */
  private contextOverridesSession = new Map<string, { agentId: string; values: Map<string, boolean> }>();
  private contextOverridesUpdatedAt = 0;
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
  /**
   * §5.5 #17-20 ⑩ v4.94 — 프로젝트별 중단점(projectName → 목록).
   * 세션이 없어도 남는 사용자 표식이라 체크포인트로 영속한다(세션·콜스택·변수는 프로세스 수명).
   */
  private debugBreakpoints = new Map<string, DebugBreakpoint[]>();
  /** §5.9 화면/프로그램 캡처 버블 (id → CaptureBubble). 사용자 생성 독립 캔버스 요소. */
  private captureBubbles = new Map<string, CaptureBubble>();
  /** §5.13 v4.45 — 내부 앱 버블(범용). 앱이 늘어도 이 Map 하나로 끝난다. */
  private appBubbles = new Map<string, AppBubble>();
  /** §5.14 v4.62 — 플레이 버블(이 프로젝트를 켜는 버튼 + 확정된 실행 레시피). */
  private playBubbles = new Map<string, PlayBubble>();
  /** §5.15 — 스펙 보드(요구사항 본문 + 수용 기준 + 거기서 나온 작업 카드 연결). */
  private specDocs = new Map<string, SpecDoc>();
  /** 스펙·항목 id 발급 카운터. 한 밀리초에 여러 항목을 만들 때 id 가 겹치지 않게 한다. */
  private specIdCounter = 0;
  /** §5.16 — 리뷰·승인 레인(격리 변경분 + 사람이 내린 결정 이력). */
  private reviewRequests = new Map<string, ReviewRequest>();
  /** 리뷰·결정 id 발급 카운터. 같은 밀리초에 둘을 만들어도 id 가 겹치지 않게 한다. */
  private reviewIdCounter = 0;
  /** §5.18 — 에이전트 랩(과제 하나 + 설정 조합 N개 + 그 결과). */
  private labRuns = new Map<string, LabRun>();
  /** 랩·변형 id 발급 카운터. 같은 밀리초에 여러 변형을 만들 때 id 가 겹치지 않게 한다. */
  private labIdCounter = 0;
  /** §5.20 — 스크립트 선반(자주 쓰는 명령·프롬프트 한 장). */
  private shelfBubbles = new Map<string, ShelfBubble>();
  /** 선반·항목 id 발급 카운터. 같은 밀리초에 여러 줄을 만들어도 id 가 겹치지 않게 한다. */
  private shelfIdCounter = 0;
  /**
   * §5.21 — 비용·토큰 지도. 원장은 세션 하나이고 에이전트·프로젝트 합계는 거기서 접은 파생이라
   * 이 인스턴스 하나가 자기 프로젝트들의 원장을 전부 들고 있다.
   */
  private costMapService = new CostMapService();
  /**
   * §5.22 — 권한·감사 원장. 훅 이벤트가 지나가는 자리에서 한 줄씩 적고, 승인 창구의 결정도
   * **같은 줄**에 적힌다(요청 원장·결정 원장을 따로 두지 않는다).
   */
  /**
   * §3.2.3 B축 — 보관 줄 수는 **사용자 설정**에서 온다(`0`=무제한). 서비스가 앱 상태를 직접
   * 읽지 않고 여기서 물려 주는 이유는 그 서비스의 단위 테스트를 사용자 파일에서 떼기 위해서다.
   */
  private auditLogService = new AuditLogService(() => appStateGetRetention().auditEntryMaxPerProject);
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

  /**
   * §9 "저장은 바뀐 프로젝트만" — 이 인스턴스가 지난 저장 이후 바뀌었는지 판정하는 단조 카운터.
   *
   * ⚠ 이 값 하나로 "저장이 필요 없다"를 단정하면 안 된다. 체크포인트에는 인스턴스 **밖** 싱글턴
   *   (`subAgentManager`·`pipelineManager`·카드류)에서 오는 값이 함께 담기는데 그쪽 변경은 여기를
   *   올리지 않는다. 호출자는 반드시 `CHECKPOINT_QUIET_SWEEP_MS` 주기 강제 재구축과 짝지어 쓴다.
   */
  getMutationVersion(): number {
    return this.mutationVersion;
  }

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
  /** 루트 노드 키 접두사 (프로젝트별: __root__:프로젝트명).
   *  영속 계층의 빈 체크포인트 판정과 같은 기준을 써야 해서 공유 상수를 그대로 쓴다. */
  private static readonly ROOT_PREFIX = ROOT_NODE_KEY_PREFIX;

  /** 하위 호환용 레거시 키 */
  private static readonly LEGACY_ROOT_KEY = LEGACY_ROOT_NODE_KEY;

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
      this.ensureRootNode(existing.name, existing);
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
    this.ensureRootNode(info.name, info);

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
      // v3.71: 폴더만 남은 좀비(= `git worktree remove`/외부 정리 후 잠금 파일·untracked 잔여물만
      // 남은 디렉토리)는 워크트리로 등록하지 않는다. 등록하면 그 인스턴스의 오토세이브가
      // 사용자가 지운 폴더를 다시 만들어내는 고리가 된다.
      if (!isLiveWorktreeDir(wtCwd)) continue;
      // 지금 `git worktree add` 가 돌고 있는 폴더는 아직 발견 대상이 아니다. `.git` 은 체크아웃이
      // 끝나기 전에 이미 붙으므로 살아있음 판정만으로는 반쯤 만들어진 워크트리를 걸러내지 못한다.
      // 여기서 주워 버리면 **좌표 없는** 버블이 먼저 태어나, 사용자가 고른 자리 대신 방사형
      // 레이아웃 자리에 앉은 채로 굳는다(뒤늦게 오는 진짜 좌표는 클라 캐시에 막혀 무시된다).
      if (isWorktreeUnderConstruction(wtCwd)) continue;
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
      // v3.71: 이미 죽은 워크트리(`.git` 없음)는 버블을 (재)생성하지 않는다 — ghost 가 fade 로 사라진
      // 뒤 이 스윕이 인메모리 프로젝트 엔트리만 보고 버블을 되살리던 경로였다.
      if (!isLiveWorktreeDir(info.path)) continue;
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

  /**
   * 프로젝트별 루트 폴더 노드가 없으면 생성.
   *
   * ⚠ 워크트리 프로젝트에는 만들지 않는다 — 워크트리의 화면 표현은 자기 루트 버블이 아니라
   *   **부모 캔버스의 워크트리 버블**(`ensureWorktreeNode`, 부모 이름으로 귀속)이고, 주기 스윕
   *   `migrateWorktreeProjects()` → `reparentWorktreeArtifacts()` 가 어차피 이 루트 노드를 지운다.
   *   만들었다 지우는 왕복이 남아 있으면 부팅 직후 저장본에만 루트 노드가 실려, 그 뒤 정상적으로
   *   비어 있는 저장본이 §3.2.1-3 통째-0 가드에 매 저장마다 걸린다(경고 무한 반복의 발화점).
   *   호출부가 `info` 를 넘겨 주면 그것으로, 아니면 등록된 프로젝트에서 이름으로 찾아 판정한다
   *   (복원 경로는 `graph.projects` 가 비어 있을 수 있어 `info` 를 직접 받는 쪽이 확실하다).
   */
  private ensureRootNode(projectName: string, info?: ProjectInfo): void {
    const key = ProjectGraph.rootKeyFor(projectName);
    if (this.nodes.has(key)) return;
    const owner = info ?? this.getProjectByName(projectName);
    if (owner?.parentProjectPath) return; // 워크트리 — 부모 캔버스의 워크트리 버블이 대신한다
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
    // §5.19 (B) — 준비 중이던 All Model 버블이 **모델을 무는 순간** 라벨의 주인공이 모델명으로 바뀐다.
    //   생성 시 명명(createCustomAgent)의 뒷짝이라 이름 규칙 둘이 한 파일 안에 나란히 산다.
    //   사용자가 직접 바꾼 이름은 기본 라벨 모양이 아니라서 여기 걸리지 않는다 — 지키려고 플래그를
    //   따로 두지 않는 이유다.
    const boundName = config.provider?.modelName?.trim();
    const hadModel = !!this.agentConfigs.get(agentId)?.provider?.modelId;
    if (boundName && config.provider?.modelId && !hadModel) {
      for (const agent of this.agents.values()) {
        if (agent.id !== agentId) continue;
        if (ALL_MODEL_DEFAULT_LABEL_RE.test(agent.label)) this.updateBubbleLabel(agentId, this.uniqueLabel(boundName));
        break;
      }
    }
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

  /** 경로 대조 키 — 대소문자를 실제로 무시하는 FS(win32/darwin)에서만 접는다(`shared/pathCase.ts`).
   *  예전에는 win32 만 봤는데, mac 의 기본 APFS 볼륨도 대소문자를 가리지 않는다. */
  private static pathCompareKey(p: string): string {
    return pathKey(path.resolve(p));
  }

  /** Manager용: 이 절대경로가 **지금 버블로 떠 있는 노드**의 경로인지.
   *  §2.1 #5 v1.55 의 "외부 폴더/파일 클릭 → OS 탐색기·에디터로 열기" 판정에 쓴다 —
   *  `external_folder` 는 정의상 프로젝트 루트 **밖**이라 루트 경계만 보는 가드로는 늘 거절됐다.
   *  화면에 없는 임의 절대경로는 여기서도 false(가드의 원래 취지 유지). */
  hasNodeAbsolutePath(absPath: string): boolean {
    const target = ProjectGraph.pathCompareKey(absPath);
    for (const [key, node] of this.nodes) {
      const abs = node.absolutePath ?? this.resolveAbsolutePath(key);
      if (abs && ProjectGraph.pathCompareKey(abs) === target) return true;
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
        // §5.10 — 휴지통 에이전트는 원래 캔버스 좌표 보존(복구 시 제자리 복귀). 갱신 무시.
        if (agent.trashed) return true;
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
        if (!bubble) continue;
        // §5.10 — 휴지통 에이전트의 위치는 "버려지기 전 캔버스 좌표"다. 휴지통 내부 뷰의 임시 배치가
        //   여기로 흘러들면 복구해도 제자리로 못 돌아가므로 trashed 동안엔 위치 갱신을 받지 않는다.
        if (bubble.trashed) continue;
        bubble.position = { x, y };
      }
    }
  }

  /** 버블 라벨 변경 (사용자 수동 지정) */
  updateBubbleLabel(nodeId: string, label: string): void {
    for (const agent of this.agents.values()) {
      if (agent.id === nodeId) {
        this.customLabels.set(nodeId, label);
        agent.label = label;
        // §3.2 스냅샷 캐시 — 이름을 바꿔 놓고 판을 올리지 않으면 곧바로 이어지는 broadcast 가
        //   **옛 이름을 실은 캐시**를 그대로 내보낸다(TTL 이 지나야 제 이름이 뜬다). 바뀐 이름은
        //   저장돼야 하는 상태이기도 해서, 판 올림이 체크포인트 저장 판정까지 함께 맞춘다.
        this.bumpMutationVersion();
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

  // §5.10 — 구 restoreCustomAgentBubble(C 복구)은 휴지통(restoreTrashedAgent)이 후신이 되어 제거됨.

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
    options?: { executionMode?: ExecutionMode; provider?: AgentProvider },
  ): BubbleData {
    this.agentCounter += 1;
    const sessionId = `custom-${Date.now().toString(36)}-${this.agentCounter}-${idTail()}`;
    // §4 v2.63 — CMD(인터랙티브 터미널) 에이전트는 생성 시점에 executionMode + 구분 색 + 이름을 baked.
    const cmdMode = options?.executionMode === 'interactive-terminal';
    // §5.19 (C) — All Model(로컬 LLM) 버블. CMD 와 같은 자리에서 갈리는 세 번째 갈래이고,
    //   라벨의 주인공은 에이전트 이름이 아니라 **모델명**이다(캔버스에서 무엇을 물었는지 바로 읽히게).
    const localMode = !!options?.provider;
    const localName = options?.provider?.modelName?.trim();
    const baseName = label
      || (localMode ? (localName || `All Model ${this.agentCounter}`) : `${cmdMode ? 'CMD' : 'Custom'} Agent ${this.agentCounter}`);
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
      // §5.19 — provider 도 같은 규약이다: userDefaults 에서 상속하지 않고 **생성 시 명시된 것만** baked.
      //   이 값이 없으면 이 에이전트는 지금까지와 똑같은 claude 경로를 탄다.
      ...(localMode && options?.provider ? { provider: options.provider } : {}),
      ...(cmdMode ? { color: CMD_AGENT_COLOR } : {}),
      ...(localMode ? { color: LOCAL_AGENT_COLOR } : {}),
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
    const sessionId = `auto-${Date.now().toString(36)}-${this.agentCounter}-${idTail()}`;
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

  // ── §5.3 #10-3 v4.98 — 검증 런 ────────────────────────────────────────────
  //
  // 완료를 LLM 이 쓴 문장이 아니라 **서버가 보관한 증거**로 판정하기 위한 저장소.
  // 판정(`ok`, `verified`)은 전부 이 클래스가 계산한다 — 에이전트가 주장할 수 없다.

  /** 새 검증 런 시작. 같은 auto-agent 의 이전 런은 지우지 않고 뒤에 쌓는다. */
  createAutoAgentRun(params: {
    autoAgentId: string;
    userRequest: string;
    acceptanceCriteria?: string[];
    baselineRevision?: string;
    reworkBudget?: number;
    selfTest?: boolean;
  }): AutoAgentRun {
    const run: AutoAgentRun = {
      runId: `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      autoAgentId: params.autoAgentId,
      userRequest: params.userRequest,
      acceptanceCriteria: params.acceptanceCriteria ?? [],
      baselineRevision: params.baselineRevision,
      attempts: [],
      reworkUsed: 0,
      reworkBudget: params.reworkBudget ?? AUTO_AGENT_RUN_DEFAULT_REWORK_BUDGET,
      status: 'running',
      selfTest: params.selfTest,
      startedAt: Date.now(),
    };
    const list = this.autoAgentRuns.get(params.autoAgentId) ?? [];
    list.push(run);
    // ring buffer — 오래된 런부터 밀어낸다.
    while (list.length > AUTO_AGENT_RUN_MAX_PER_AGENT) list.shift();
    this.autoAgentRuns.set(params.autoAgentId, list);
    this.bumpMutationVersion();
    return run;
  }

  /** runId 로 런 조회 (어느 auto-agent 소속이든) */
  getAutoAgentRun(runId: string): AutoAgentRun | null {
    for (const list of this.autoAgentRuns.values()) {
      const found = list.find((r) => r.runId === runId);
      if (found) return found;
    }
    return null;
  }

  /** 그 auto-agent 의 런 목록 (최신이 뒤) */
  listAutoAgentRuns(autoAgentId: string): AutoAgentRun[] {
    return this.autoAgentRuns.get(autoAgentId) ?? [];
  }

  /** 그 auto-agent 의 가장 최근 running 런 (없으면 null) */
  getActiveAutoAgentRun(autoAgentId: string): AutoAgentRun | null {
    const list = this.autoAgentRuns.get(autoAgentId) ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const run = list[i]!;
      if (run.status === 'running') return run;
    }
    return null;
  }

  /**
   * 검증 증거 1건 적재.
   * **`ok` 는 인자로 받지 않고 `exitCode === 0` 으로 서버가 계산한다** — 에이전트가
   * "통과했다"고 주장하는 것과 실제로 통과한 것을 구분하기 위한 지점이다.
   */
  appendVerificationAttempt(
    runId: string,
    attempt: Omit<VerificationAttempt, 'id' | 'ok'>,
  ): AutoAgentRun | null {
    const run = this.getAutoAgentRun(runId);
    if (!run) return null;
    run.attempts.push({
      ...attempt,
      id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      ok: attempt.exitCode === 0,
    });
    this.bumpMutationVersion();
    return run;
  }

  /** 재작업 1회 소모. 예산을 넘겼으면 false (호출부가 에스컬레이션한다). */
  consumeAutoAgentRework(runId: string): { run: AutoAgentRun; withinBudget: boolean } | null {
    const run = this.getAutoAgentRun(runId);
    if (!run) return null;
    const next = run.reworkUsed + 1;
    if (next > run.reworkBudget) return { run, withinBudget: false };
    run.reworkUsed = next;
    this.bumpMutationVersion();
    return { run, withinBudget: true };
  }

  /**
   * 런을 닫는다.
   * **`verified` 는 통과 증거가 1개 이상일 때만 허용** — 증거 없이 verified 를 요청하면
   * `escalated`(`no-evidence`) 로 떨어진다. 이것이 "완료는 서버가 소유한다"의 집행 지점이다.
   */
  closeAutoAgentRun(
    runId: string,
    desired: AutoAgentRunStatus,
    escalation?: EscalationReason,
  ): AutoAgentRun | null {
    const run = this.getAutoAgentRun(runId);
    if (!run) return null;
    if (desired === 'verified' && !run.attempts.some((a) => a.ok)) {
      run.status = 'escalated';
      run.escalation = 'no-evidence';
    } else {
      run.status = desired;
      run.escalation = desired === 'escalated' ? (escalation ?? 'verification-failed') : undefined;
    }
    run.endedAt = Date.now();
    this.bumpMutationVersion();
    return run;
  }

  /** 판정 기록 (표시용 — 판정 자체로 런이 닫히지는 않는다) */
  setAutoAgentRunVerdict(runId: string, verdict: AutoAgentRun['lastVerdict'], reason?: string): AutoAgentRun | null {
    const run = this.getAutoAgentRun(runId);
    if (!run) return null;
    run.lastVerdict = verdict;
    run.lastVerdictReason = reason;
    this.bumpMutationVersion();
    return run;
  }

  /** 전체 런 맵 (broadcast 스냅샷·체크포인트용) */
  getAutoAgentRunsRecord(): Record<string, AutoAgentRun[]> | undefined {
    if (this.autoAgentRuns.size === 0) return undefined;
    return Object.fromEntries(this.autoAgentRuns);
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
   * §5.10 Project Brain — 주입 이벤트 추가 (agentId → BrainInjectionEvent[], append + ring buffer 캡).
   * 스폰 브리핑/파일 경고/능동 검색이 카드를 주입한 순간에 호출. 런타임 전용(체크포인트 미영속).
   *
   * ## v3.78 — **같은 카드 묶음은 칩을 새로 만들지 않는다(도배 차단)**
   *
   * 스폰 브리핑은 **명령을 dispatch 할 때마다** 돌고, 상시 규칙+top-K 는 대개 그대로라 카드 묶음이
   * 매번 똑같다. 종전에는 그때마다 이벤트를 append 해서 IDE 스트림에 `기억 3장 참조` 칩이 턴 수만큼
   * 쌓였다(실측 스크린샷 7개 연속). 같은 계기(trigger)로 **같은 카드 집합**이 다시 들어오면 새 칩을
   * 만들지 않고 기존 칩의 `repeatCount`·`lastAt` 만 올린다.
   *
   * `at`(최초 주입 시각)은 **일부러 그대로 둔다** — 스트림은 ts 로 정렬되므로 여기서 시각을 갱신하면
   * 칩이 매 턴 아래로 뛰어다니며 재정렬을 유발한다(§5.5 스크롤 안정성).
   */
  addBrainInjection(ev: BrainInjectionEvent): void {
    const list = this.brainInjections.get(ev.agentId) ?? [];
    const sig = `${ev.trigger}::${[...ev.cardIds].sort().join(',')}`;
    const dup = list.find((e) => `${e.trigger}::${[...e.cardIds].sort().join(',')}` === sig);
    if (dup) {
      dup.repeatCount = (dup.repeatCount ?? 1) + 1;
      dup.lastAt = ev.at;
    } else {
      list.push(ev);
      if (list.length > BRAIN_INJECTIONS_MAX_PER_AGENT) {
        list.splice(0, list.length - BRAIN_INJECTIONS_MAX_PER_AGENT);
      }
    }
    this.brainInjections.set(ev.agentId, list);
    // §3.2.4 F축 — 값에는 링버퍼 캡이 있었지만 **키(에이전트)에는 없었다**. 표시용 파생물이라 안전.
    capMapSize(this.brainInjections, SESSION_KEYED_MAP_MAX);
    this.bumpMutationVersion();
  }

  /** §5.10 — 주입 이벤트 전체 맵 (broadcast 스냅샷용). 빈 맵이면 undefined. */
  getBrainInjectionsRecord(): Record<string, BrainInjectionEvent[]> | undefined {
    if (this.brainInjections.size === 0) return undefined;
    const out: Record<string, BrainInjectionEvent[]> = {};
    for (const [k, v] of this.brainInjections) out[k] = [...v];
    return out;
  }

  /**
   * §5.10 — Brain 카드가 REST 로 변경됐을 때 호출(스냅샷 캐시 무효화 → 다음 getSnapshot 이
   * getBrainService 요약을 재계산). brainService 는 projectGraph 밖이라 mutationVersion 을
   * 자동으로 못 올리므로 이 창구가 필요.
   */
  notifyBrainChanged(): void {
    this.bumpMutationVersion();
  }

  /**
   * §5.10 — 이 그래프 프로젝트 루트의 Brain 요약(스냅샷 탑재분). 루트/이름/카드 없으면 undefined.
   * v3.70 — projectName 1차 키로 싣는다. 카드 저장이 프로젝트별로 갈라져 있으므로 요약도 갈라져야
   * 여러 프로젝트가 열렸을 때 Manager 병합에서 서로 덮어쓰거나 합산되지 않는다.
   */
  getBrainSummary(): Record<string, BrainSummary> | undefined {
    // §5.10 v2 (H) 게이트 ③ 표시 — 꺼진 두뇌는 요약을 내지 않는다.
    //   요약이 없으면 스냅샷에 brain 이 안 실리고, 클라가 Brain 버블을 그리지 않는다.
    if (!brainEnabledFor(this.root)) return undefined;
    if (!this.root) return undefined;
    const name = this.getPrimaryProjectName();
    if (!name) return undefined;
    const svc = getBrainService(this.root);
    if (!svc.hasAnyCards()) return undefined;
    return { [name]: svc.getSummary() };
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

  /**
   * §4 v3.21 — 에이전트 피드백 upsert (targetId 별 1건 — 같은 대상 재평가는 verdict 교체).
   * `verdict:null` 은 평가 철회(해당 target 피드백 제거). ring buffer 캡 = AGENT_FEEDBACK_MAX_PER_AGENT.
   */
  setAgentFeedback(feedback: AgentFeedback): void {
    const arr = (this.agentFeedbacks.get(feedback.agentId) ?? []).filter(
      (f) => !(f.targetType === feedback.targetType && f.targetId === feedback.targetId),
    );
    arr.push(feedback);
    if (arr.length > AGENT_FEEDBACK_MAX_PER_AGENT) {
      arr.splice(0, arr.length - AGENT_FEEDBACK_MAX_PER_AGENT);
    }
    this.agentFeedbacks.set(feedback.agentId, arr);
    this.bumpMutationVersion();
  }

  /** §4 v3.21 — 피드백 철회 (해당 target 의 기존 평가 제거). 제거했으면 true. */
  removeAgentFeedback(agentId: string, targetType: string, targetId: string): boolean {
    const arr = this.agentFeedbacks.get(agentId);
    if (!arr) return false;
    const next = arr.filter((f) => !(f.targetType === targetType && f.targetId === targetId));
    if (next.length === arr.length) return false;
    if (next.length === 0) this.agentFeedbacks.delete(agentId);
    else this.agentFeedbacks.set(agentId, next);
    this.bumpMutationVersion();
    return true;
  }

  /** §4 v3.21 — 피드백 전체 맵 (broadcast 스냅샷/체크포인트용). 빈 맵이면 undefined. */
  getAgentFeedbacksRecord(): Record<string, AgentFeedback[]> | undefined {
    if (this.agentFeedbacks.size === 0) return undefined;
    const out: Record<string, AgentFeedback[]> = {};
    for (const [k, v] of this.agentFeedbacks) out[k] = [...v];
    return out;
  }

  /** §4 v3.21 — 한 에이전트의 피드백 목록 (스폰 다이제스트 주입/distill 용). */
  getAgentFeedbacksForAgent(agentId: string): AgentFeedback[] {
    return [...(this.agentFeedbacks.get(agentId) ?? [])];
  }

  // ─── §5.5 #17-11 v3.79 — 세션 반복 실행(루프) ───

  /** 한 세션 탭의 루프 설정 (없으면 undefined). */
  getSessionLoop(subAgentId: string): SessionLoop | undefined {
    return this.sessionLoops.get(subAgentId);
  }

  /** 루프 설정 저장(생성/전체 교체). 호출자가 이미 정규화한 값을 넣는다. */
  setSessionLoop(loop: SessionLoop): void {
    this.sessionLoops.set(loop.subAgentId, loop);
    this.bumpMutationVersion();
  }

  /** 루프 부분 갱신 (진행 카운트·상태·타이머 필드). 대상이 없으면 undefined. */
  updateSessionLoop(subAgentId: string, patch: Partial<SessionLoop>): SessionLoop | undefined {
    const cur = this.sessionLoops.get(subAgentId);
    if (!cur) return undefined;
    const next: SessionLoop = { ...cur, ...patch, updatedAt: Date.now() };
    this.sessionLoops.set(subAgentId, next);
    this.bumpMutationVersion();
    return next;
  }

  /** 루프 설정 삭제 (세션 탭 닫힘/사용자 삭제). 지웠으면 true. */
  deleteSessionLoop(subAgentId: string): boolean {
    if (!this.sessionLoops.delete(subAgentId)) return false;
    this.bumpMutationVersion();
    return true;
  }

  /** 한 에이전트에 속한 루프 전부 (전체 중지·에이전트 제거 시 순회용). */
  getSessionLoopsForAgent(agentId: string): SessionLoop[] {
    const out: SessionLoop[] = [];
    for (const loop of this.sessionLoops.values()) {
      if (loop.agentId === agentId) out.push(loop);
    }
    return out;
  }

  /** 한 에이전트의 루프 전부 삭제 (에이전트 영구 제거). 지운 subAgentId 목록. */
  deleteSessionLoopsForAgent(agentId: string): string[] {
    const removed: string[] = [];
    for (const [subId, loop] of this.sessionLoops) {
      if (loop.agentId === agentId) removed.push(subId);
    }
    for (const subId of removed) this.sessionLoops.delete(subId);
    if (removed.length > 0) this.bumpMutationVersion();
    return removed;
  }

  /** 루프 전체 맵 (broadcast 스냅샷/체크포인트용). 빈 맵이면 undefined. */
  getSessionLoopsRecord(): Record<string, SessionLoop> | undefined {
    if (this.sessionLoops.size === 0) return undefined;
    const out: Record<string, SessionLoop> = {};
    for (const [k, v] of this.sessionLoops) out[k] = { ...v };
    return out;
  }

  // ─── §5.5 #17-35 — 검증(Verify) ───

  /** 한 세션 탭의 검증 이력(최신 우선). 없으면 빈 배열. */
  getVerificationRuns(subAgentId: string): VerificationRun[] {
    return this.verificationRuns.get(subAgentId) ?? [];
  }

  /**
   * 그 탭에서 아직 안 끝난 검증(있으면).
   * 겹쳐 쏘지 않기 위한 판정 — 루프의 "큐에 안 끝난 명령이 있으면 쏘지 않는다"와 같은 규율.
   */
  getActiveVerificationRun(subAgentId: string): VerificationRun | undefined {
    return this.getVerificationRuns(subAgentId).find((r) => r.status === 'queued' || r.status === 'running');
  }

  /** 검증 한 건 추가(최신이 앞). 세션당 상한을 넘으면 오래된 것부터 잘린다. */
  addVerificationRun(run: VerificationRun): VerificationRun {
    const list = this.verificationRuns.get(run.subAgentId) ?? [];
    const next = [run, ...list].slice(0, VERIFICATION_RUNS_MAX_PER_SESSION);
    this.verificationRuns.set(run.subAgentId, next);
    this.bumpMutationVersion();
    return run;
  }

  /** id 로 찾기 — REST 는 subAgentId 를 모르고 들어온다. */
  findVerificationRun(runId: string): VerificationRun | undefined {
    for (const list of this.verificationRuns.values()) {
      const hit = list.find((r) => r.id === runId);
      if (hit) return hit;
    }
    return undefined;
  }

  /** 검증 부분 갱신(상태·판정·증거). 대상이 없으면 undefined. */
  updateVerificationRun(runId: string, patch: Partial<VerificationRun>): VerificationRun | undefined {
    for (const [subId, list] of this.verificationRuns) {
      const idx = list.findIndex((r) => r.id === runId);
      if (idx < 0) continue;
      const next: VerificationRun = { ...list[idx]!, ...patch };
      const copy = [...list];
      copy[idx] = next;
      this.verificationRuns.set(subId, copy);
      this.bumpMutationVersion();
      return next;
    }
    return undefined;
  }

  /** 검증 한 줄 삭제(사용자가 목록에서 지움). 지웠으면 true. */
  deleteVerificationRun(runId: string): boolean {
    for (const [subId, list] of this.verificationRuns) {
      const next = list.filter((r) => r.id !== runId);
      if (next.length === list.length) continue;
      if (next.length === 0) this.verificationRuns.delete(subId);
      else this.verificationRuns.set(subId, next);
      this.bumpMutationVersion();
      return true;
    }
    return false;
  }

  /** 한 에이전트의 검증 전부 삭제(에이전트 영구 제거). 지운 건수. */
  deleteVerificationRunsForAgent(agentId: string): number {
    let removed = 0;
    for (const [subId, list] of [...this.verificationRuns]) {
      const next = list.filter((r) => r.agentId !== agentId);
      if (next.length === list.length) continue;
      removed += list.length - next.length;
      if (next.length === 0) this.verificationRuns.delete(subId);
      else this.verificationRuns.set(subId, next);
    }
    if (removed > 0) this.bumpMutationVersion();
    return removed;
  }

  /** 검증 전체 맵 (broadcast 스냅샷/체크포인트용). 빈 맵이면 undefined. */
  getVerificationRunsRecord(): Record<string, VerificationRun[]> | undefined {
    if (this.verificationRuns.size === 0) return undefined;
    const out: Record<string, VerificationRun[]> = {};
    for (const [k, v] of this.verificationRuns) out[k] = v.map((r) => ({ ...r, attempts: [...r.attempts] }));
    return out;
  }

  // ─── §5.5 #17-28 — 컨텍스트 주입원 오버라이드 ───

  /**
   * 오버라이드 한 건 설정. `enabled` 가 `null` 이면 **오버라이드 해제**(= 기본값으로 되돌림)다.
   * 끔(false)만이 아니라 켬(true)도 저장하는 이유 — 기본값이 나중에 꺼짐으로 바뀌어도 사용자가
   * 명시적으로 켠 것은 켜진 채여야 한다("여기가 최종"의 양방향).
   */
  setContextOverride(
    scope: { projectKey?: string; subAgentId?: string; agentId?: string },
    sourceId: string,
    enabled: boolean | null,
  ): void {
    if (!sourceId) return;
    if (scope.subAgentId) {
      const cur = this.contextOverridesSession.get(scope.subAgentId)
        ?? { agentId: scope.agentId ?? '', values: new Map<string, boolean>() };
      if (scope.agentId) cur.agentId = scope.agentId;
      if (enabled === null) cur.values.delete(sourceId);
      else cur.values.set(sourceId, enabled);
      if (cur.values.size === 0) this.contextOverridesSession.delete(scope.subAgentId);
      else this.contextOverridesSession.set(scope.subAgentId, cur);
    } else if (scope.projectKey) {
      const cur = this.contextOverridesProject.get(scope.projectKey) ?? new Map<string, boolean>();
      if (enabled === null) cur.delete(sourceId);
      else cur.set(sourceId, enabled);
      if (cur.size === 0) this.contextOverridesProject.delete(scope.projectKey);
      else this.contextOverridesProject.set(scope.projectKey, cur);
    } else {
      return; // 어느 층인지 모르면 아무것도 하지 않는다(조용한 오적용 방지).
    }
    this.contextOverridesUpdatedAt = Date.now();
    this.bumpMutationVersion();
  }

  /** 한 층의 오버라이드를 통째로 비운다(= 전부 기본값). 지운 게 있으면 true. */
  clearContextOverrides(scope: { projectKey?: string; subAgentId?: string }): boolean {
    let changed = false;
    if (scope.subAgentId) changed = this.contextOverridesSession.delete(scope.subAgentId);
    else if (scope.projectKey) changed = this.contextOverridesProject.delete(scope.projectKey);
    if (!changed) return false;
    this.contextOverridesUpdatedAt = Date.now();
    this.bumpMutationVersion();
    return true;
  }

  /** 세션 탭이 닫힐 때 그 탭의 오버라이드도 함께 정리(좀비 설정 차단 — 루프·목표와 같은 규칙). */
  deleteContextOverridesForSession(subAgentId: string): boolean {
    if (!this.contextOverridesSession.delete(subAgentId)) return false;
    this.contextOverridesUpdatedAt = Date.now();
    this.bumpMutationVersion();
    return true;
  }

  /**
   * 오버라이드 전체 (스냅샷/게이트 공용). 아무것도 없으면 undefined.
   * `agentIds` 를 주면 그 에이전트들에 속한 세션 층만 담는다(프로젝트별 체크포인트가 쓴다).
   */
  getContextOverrides(filter?: { projectKey?: string; agentIds?: Set<string> }): ContextOverrides | undefined {
    const projects: Record<string, ContextOverrideMap> = {};
    for (const [key, map] of this.contextOverridesProject) {
      if (filter?.projectKey && key !== filter.projectKey) continue;
      if (map.size === 0) continue;
      const rec: ContextOverrideMap = {};
      for (const [k, v] of map) rec[k] = v;
      projects[key] = rec;
    }
    const sessions: Record<string, ContextOverrideMap> = {};
    for (const [sub, entry] of this.contextOverridesSession) {
      if (filter?.agentIds && !filter.agentIds.has(entry.agentId)) continue;
      if (entry.values.size === 0) continue;
      const rec: ContextOverrideMap = {};
      for (const [k, v] of entry.values) rec[k] = v;
      sessions[sub] = rec;
    }
    if (Object.keys(projects).length === 0 && Object.keys(sessions).length === 0) return undefined;
    return { projects, sessions, updatedAt: this.contextOverridesUpdatedAt };
  }

  /**
   * 체크포인트 복원·병합용 — **없는 키만** 채운다(메모리에 있는 현재 뜻을 디스크가 이기지 않게).
   * 세션 층의 소속 에이전트는 저장 포맷에 없으므로 복원 시 세션→에이전트 역참조로 다시 채운다.
   */
  restoreContextOverrides(saved: ContextOverrides | undefined): void {
    if (!saved) return;
    for (const [projectKey, rec] of Object.entries(saved.projects ?? {})) {
      const cur = this.contextOverridesProject.get(projectKey) ?? new Map<string, boolean>();
      for (const [k, v] of Object.entries(rec)) {
        if (!cur.has(k)) cur.set(k, v);
      }
      if (cur.size > 0) this.contextOverridesProject.set(projectKey, cur);
    }
    for (const [sub, rec] of Object.entries(saved.sessions ?? {})) {
      const cur = this.contextOverridesSession.get(sub)
        ?? { agentId: this.getAgentIdForSubAgent(sub) ?? '', values: new Map<string, boolean>() };
      if (!cur.agentId) cur.agentId = this.getAgentIdForSubAgent(sub) ?? '';
      for (const [k, v] of Object.entries(rec)) {
        if (!cur.values.has(k)) cur.values.set(k, v);
      }
      if (cur.values.size > 0) this.contextOverridesSession.set(sub, cur);
    }
    if (saved.updatedAt > this.contextOverridesUpdatedAt) this.contextOverridesUpdatedAt = saved.updatedAt;
  }

  /** subAgentId → 소속 에이전트 버블 id. 못 찾으면 undefined(오버라이드는 그대로 살아 있고 필터에서만 빠진다). */
  private getAgentIdForSubAgent(subAgentId: string): string | undefined {
    for (const sub of subAgentManager.getAllSubsFlat()) {
      if (sub.id === subAgentId) return sub.parentAgentId;
    }
    return undefined;
  }

  // ─── §5.5 #17-17 v4.46 — 세션 목표(Goal) ───

  /** 한 세션 탭의 목표 (없으면 undefined). */
  getSessionGoal(subAgentId: string): SessionGoal | undefined {
    return this.sessionGoals.get(subAgentId);
  }

  /**
   * 목표 저장(생성/문장 수정/상태 변경). 진행률·이력은 보존한다 —
   * 사용자가 목표를 다듬는 것과 진행을 되감는 것은 다른 일이기 때문.
   * 문장이 실제로 바뀌면 `revision++` → plan 자동 폴백이 다시 열린다(③).
   */
  setSessionGoal(input: {
    agentId: string;
    subAgentId: string;
    text: string;
    status?: SessionGoalStatus;
    /** §5.5 #17-17 v4.47 — 최초 생성 시 함께 세우는 단계(이후 편집은 진행 갱신 경로로 간다). */
    steps?: { text: string; status?: SessionGoalStepStatus }[];
    /** §5.5 #17-17 v4.50 — 문장을 쓴 주체. 사용자가 손대면 'user' 로 굳어 자동 교체가 멈춘다(⑧). */
    authoredBy?: 'session' | 'user';
    /** §5.5 #17-17 v4.50 — 이 목표가 딸려 나온 세션 명령(자동 교체 판단 기준). */
    sourceCommand?: string;
  }): SessionGoal {
    const now = Date.now();
    const prev = this.sessionGoals.get(input.subAgentId);
    const textChanged = !prev || prev.text !== input.text;
    const steps = input.steps ? rebuildGoalSteps(prev?.steps ?? [], input.steps, now) : (prev?.steps ?? []);
    const next: SessionGoal = {
      agentId: input.agentId,
      subAgentId: input.subAgentId,
      text: input.text,
      // 문장을 실제로 바꾼 주체만 주인을 갱신한다 — 상태만 바꾸는 저장이 주인을 뒤집지 않게.
      authoredBy: textChanged ? (input.authoredBy ?? 'user') : (prev?.authoredBy ?? input.authoredBy ?? 'session'),
      ...(input.sourceCommand !== undefined
        ? { sourceCommand: input.sourceCommand }
        : prev?.sourceCommand !== undefined ? { sourceCommand: prev.sourceCommand } : {}),
      steps,
      // 단계가 있으면 퍼센트는 언제나 체크리스트에서 나온다(①③).
      percent: steps.length > 0 ? deriveGoalPercent(steps) : (prev?.percent ?? 0),
      status: input.status ?? prev?.status ?? 'active',
      ...(prev?.note !== undefined ? { note: prev.note } : {}),
      history: prev ? [...prev.history] : [],
      revision: prev ? prev.revision + (textChanged ? 1 : 0) : 0,
      ...(prev?.lastExplicitRevision !== undefined ? { lastExplicitRevision: prev.lastExplicitRevision } : {}),
      ...(prev?.lastExplicitAt !== undefined ? { lastExplicitAt: prev.lastExplicitAt } : {}),
      ...(prev?.lastProgressAt !== undefined ? { lastProgressAt: prev.lastProgressAt } : {}),
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    this.sessionGoals.set(input.subAgentId, next);
    this.bumpMutationVersion();
    return next;
  }

  /**
   * 진행 갱신 — 단계 체크리스트(우선) 또는 퍼센트 숫자(단계가 없을 때만).
   *
   * §5.5 #17-17 ③ 우선순위:
   *  - **단계가 하나라도 있으면 퍼센트는 오직 `done/전체`** 다. 들어온 숫자는 무시된다.
   *  - 단계가 없을 때만 숫자를 받되, 명시 신고(agent·user)가 지금 개정판에 한 번이라도 왔으면
   *    `plan` 자동 폴백은 덮지 않는다(목표를 고치면 `revision` 이 올라 폴백이 다시 열린다).
   *
   * 사용자의 체크박스 조작·단계 추가·삭제도 이 문으로 온다(`source:'user'`) — 진행 이력이
   * 한 곳에만 쌓이게 하기 위해서다. 실제로 바뀐 게 없으면 undefined(이력을 더럽히지 않는다).
   */
  noteSessionGoalProgress(
    subAgentId: string,
    input: {
      percent?: number;
      note?: string;
      steps?: { text: string; status?: SessionGoalStepStatus }[];
      /** §5.5 #17-17 v4.50 — 에이전트가 자기 목표 문장을 다듬을 때(사용자가 쓴 문장은 못 덮는다). */
      goal?: string;
      source: SessionGoalProgressSource;
    },
  ): SessionGoal | undefined {
    const cur = this.sessionGoals.get(subAgentId);
    if (!cur) return undefined;
    const explicit = input.source !== 'plan';
    const now = Date.now();

    // 목표 문장 갱신 — 세션이 쓴 목표일 때만. 사용자가 고친 문장은 세션이 덮지 않는다(⑧).
    const goalText = input.goal?.trim() ? input.goal.trim().slice(0, SESSION_GOAL_TEXT_MAX) : undefined;
    const textChanged = !!goalText && goalText !== cur.text && cur.authoredBy !== 'user';

    // 단계 목록이 왔으면 본문 일치로 기존 id 를 재사용해 다시 세운다(체크박스가 튀지 않게 — ⑧).
    const nextSteps = input.steps ? rebuildGoalSteps(cur.steps, input.steps, now) : cur.steps;
    const stepsChanged = input.steps ? !sameGoalSteps(cur.steps, nextSteps) : false;

    let percent: number;
    if (nextSteps.length > 0) {
      percent = deriveGoalPercent(nextSteps);
    } else {
      if (!explicit && cur.lastExplicitRevision === cur.revision) return undefined;
      if (input.percent === undefined) return undefined; // 단계도 숫자도 없으면 갱신할 게 없다
      percent = Math.max(0, Math.min(100, Math.round(input.percent)));
    }

    const note = input.note?.trim() ? input.note.trim().slice(0, SESSION_GOAL_NOTE_MAX) : undefined;
    const changed = stepsChanged || textChanged || percent !== cur.percent || (note !== undefined && note !== cur.note);
    if (!changed) return undefined;

    const entry: SessionGoalProgress = { at: now, percent, source: input.source, ...(note ? { note } : {}) };
    const history = [...cur.history, entry];
    if (history.length > SESSION_GOAL_HISTORY_MAX) history.splice(0, history.length - SESSION_GOAL_HISTORY_MAX);

    const next: SessionGoal = {
      ...cur,
      ...(textChanged ? { text: goalText!, revision: cur.revision + 1 } : {}),
      steps: nextSteps,
      percent,
      ...(note ? { note } : {}),
      history,
      lastProgressAt: now,
      ...(explicit ? { lastExplicitRevision: cur.revision, lastExplicitAt: now } : {}),
      updatedAt: now,
    };
    this.sessionGoals.set(subAgentId, next);
    this.bumpMutationVersion();
    return next;
  }

  /**
   * §5.5 #17-17 v4.50 ① — **세션이 스스로 세운 계획을 목표 창으로 옮긴다.**
   *
   * 이 기능의 주인은 사용자가 아니라 세션이다: 세션이 `TodoWrite` 로 "이 일을 이렇게 하겠다"고
   * 마음먹는 순간 훅이 이 메서드를 부르고, 그 순간 목표 카드가 **태어난다**(문장 = 지금 수행 중인
   * 명령, 단계 = 그 계획). 이후 계획이 갱신될 때마다 체크리스트가 그대로 따라간다.
   *
   * 자동 교체: 세션이 쓴 목표(`authoredBy==='session'`)는 **새 명령이 오면 새 목표로 갈아탄다** —
   * 한 세션이 명령을 여러 개 처리해도 화면은 항상 "지금 하는 일"을 가리킨다. 사용자가 문장을
   * 고친 목표(`'user'`)는 건드리지 않는다(사용자가 준 방향을 다음 명령이 지우면 안 되므로).
   *
   * 반영됐으면 갱신된 목표, 바뀐 게 없으면 undefined.
   */
  syncSessionGoalFromPlan(
    subAgentId: string,
    input: { agentId: string; command?: string; steps: { text: string; status?: SessionGoalStepStatus }[] },
  ): SessionGoal | undefined {
    if (input.steps.length === 0) return undefined;
    const cur = this.sessionGoals.get(subAgentId);
    const command = input.command?.trim() ? input.command.trim() : undefined;

    // (a) 아직 목표가 없다 = 이 세션이 처음으로 일을 벌였다 → 목표 카드를 만든다.
    // (b) 세션이 쓴 목표인데 명령이 바뀌었다 = 새 일을 시작했다 → 새 목표로 갈아탄다.
    const isNewWork = !!cur && cur.authoredBy === 'session' && !!command && cur.sourceCommand !== command;
    if (!cur || isNewWork) {
      // 명령 전문은 몇 백 줄일 수도 있다 — 사이드바 머리글로 읽히게 첫 문단만 짧게 세운다.
      //   에이전트가 나중에 `goal` 신고로 제대로 된 한 문장으로 다듬는다(⑧ b).
      const text = summarizeGoalSeed(command ?? cur?.text ?? '');
      if (!text) return undefined; // 목표라고 부를 문장조차 없으면 카드를 만들지 않는다
      return this.setSessionGoal({
        agentId: input.agentId,
        subAgentId,
        text,
        status: 'active',
        // 새 일이면 옛 단계를 물려받지 않게 이전 목록을 비우고 시작한다.
        steps: isNewWork ? this.replaceGoalSteps(subAgentId, input.steps) : input.steps,
        authoredBy: 'session',
        ...(command ? { sourceCommand: command } : {}),
      });
    }

    // (c) 같은 일의 계획 갱신 → 체크리스트만 따라 움직인다.
    return this.noteSessionGoalProgress(subAgentId, { steps: input.steps, source: 'plan' });
  }

  /**
   * §5.5 #17-17 ⑨ v4.59 — **목표는 계획을 기다리지 않는다. 명령이 뜨는 순간 태어난다.**
   *
   * v4.50 은 카드 출생을 `TodoWrite` 훅 **하나에** 묶었다. 그래서 계획을 세우지 않는 세션에서는
   * 목표창이 영원히 비어 있었다(실측: 279 세션 중 계획을 세운 세션 1개 → 목표 0개). 명령이 세션
   * 탭으로 발사되는 순간 그 명령 머리글로 카드를 세워, 사이드바가 항상 **"지금 이 세션이 하는 일"**
   * 을 가리키게 한다. 단계는 비어 있다가 계획이 오면 `syncSessionGoalFromPlan` 이 붙인다.
   *
   * 자동 교체 규칙은 계획 경로와 같다 — 세션이 쓴 목표만 새 명령에 갈아타고, 사용자가 고친
   * 문장(`authoredBy==='user'`)은 건드리지 않는다(⑧). 같은 명령이 다시 오면 아무것도 하지 않는다.
   */
  seedSessionGoalFromCommand(
    subAgentId: string,
    input: { agentId: string; command: string },
  ): SessionGoal | undefined {
    const command = input.command.trim();
    const text = summarizeGoalSeed(command);
    if (!text) return undefined; // 목표라고 부를 문장조차 없으면 카드를 만들지 않는다
    const cur = this.sessionGoals.get(subAgentId);
    if (cur) {
      if (cur.authoredBy === 'user') return undefined; // 사용자가 준 방향은 명령이 지우지 않는다
      if (cur.sourceCommand === command) return undefined; // 같은 일 — 이미 이 명령으로 서 있다
      this.resetGoalForNewWork(subAgentId); // 새 일 — 옛 단계·퍼센트·메모를 물려받지 않는다
    }
    return this.setSessionGoal({
      agentId: input.agentId,
      subAgentId,
      text,
      status: 'active',
      steps: [],
      authoredBy: 'session',
      sourceCommand: command,
    });
  }

  /** 새 일로 갈아탈 때 옛 단계를 먼저 비운다(id 재사용이 옛 목록을 끌고 오지 않게). */
  private replaceGoalSteps(
    subAgentId: string,
    steps: { text: string; status?: SessionGoalStepStatus }[],
  ): { text: string; status?: SessionGoalStepStatus }[] {
    this.resetGoalForNewWork(subAgentId);
    return steps;
  }

  /**
   * 새 일로 갈아타기 직전 청소 — 단계·퍼센트·진행 메모를 비운다.
   * 계획이 함께 오는 경로는 곧바로 새 단계에서 퍼센트가 파생되지만, 계획 없이 명령만으로 태어나는
   * 경로(`seedSessionGoalFromCommand`)에서는 이 청소가 없으면 **지난 목표의 퍼센트·메모가 새 목표에
   * 그대로 얹힌다**(0% 여야 할 새 일이 80% 로 보이는 증상).
   */
  private resetGoalForNewWork(subAgentId: string): void {
    const cur = this.sessionGoals.get(subAgentId);
    if (!cur) return;
    const { note: _dropped, ...rest } = cur;
    this.sessionGoals.set(subAgentId, { ...rest, steps: [], percent: 0 });
  }

  /** 목표 삭제 (세션 탭 닫힘/사용자 해제). 지웠으면 true. */
  deleteSessionGoal(subAgentId: string): boolean {
    if (!this.sessionGoals.delete(subAgentId)) return false;
    this.bumpMutationVersion();
    return true;
  }

  /** 한 에이전트에 속한 목표 전부 (에이전트 제거 시 순회용). */
  getSessionGoalsForAgent(agentId: string): SessionGoal[] {
    const out: SessionGoal[] = [];
    for (const goal of this.sessionGoals.values()) {
      if (goal.agentId === agentId) out.push(goal);
    }
    return out;
  }

  /** 한 에이전트의 목표 전부 삭제 (에이전트 영구 제거). 지운 subAgentId 목록. */
  deleteSessionGoalsForAgent(agentId: string): string[] {
    const removed: string[] = [];
    for (const [subId, goal] of this.sessionGoals) {
      if (goal.agentId === agentId) removed.push(subId);
    }
    for (const subId of removed) this.sessionGoals.delete(subId);
    if (removed.length > 0) this.bumpMutationVersion();
    return removed;
  }

  /** 목표 전체 맵 (broadcast 스냅샷/체크포인트용). 빈 맵이면 undefined. */
  getSessionGoalsRecord(): Record<string, SessionGoal> | undefined {
    if (this.sessionGoals.size === 0) return undefined;
    const out: Record<string, SessionGoal> = {};
    for (const [k, v] of this.sessionGoals) out[k] = { ...v, steps: [...v.steps], history: [...v.history] };
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

  // ─── §5.10 Project Brain — 커스텀 에이전트 휴지통 ───

  /**
   * 커스텀 에이전트를 휴지통으로 이동(즉시 소멸/묘비 기록 ❌). identity 보존을 위해 Map·묘비를
   * 건드리지 않고 `trashed`/`trashedAt` 플래그만 세운다(§3.2.1 급감 가드 관계 유지 — 묘비는
   * 영구 삭제 시에만 찍는다). 활성 상태는 idle 로 내려 활성 집계에서 빠진다. 반환=성공 여부.
   */
  trashCustomAgent(sessionId: string): boolean {
    const agent = this.agents.get(sessionId);
    if (!agent || !agent.customCreated) return false;
    if (agent.trashed) return true;
    agent.trashed = true;
    agent.trashedAt = Date.now();
    agent.status = 'idle';
    agent.fadeStartedAt = undefined;
    // 활성 참조·엣지 정리(휴지통 버블은 그래프 활동에서 빠진다).
    const activeIds = this.getActiveAgentIds(agent.id);
    this.removeAgentRefs(agent.id, activeIds);
    this.mainEdges.removeAgentRefs(agent.id, activeIds);
    this.innerEdges.removeAgentRefs(agent.id, activeIds);
    this.bumpMutationVersion();
    logger.info(`Custom agent trashed: "${agent.label}" (${sessionId.slice(0, 8)})`);
    return true;
  }

  /** 버블 id(에이전트 id) 로 휴지통 이동 — 매칭되는 커스텀 에이전트 세션을 찾아 trashCustomAgent 위임. */
  trashCustomAgentByBubbleId(bubbleId: string): boolean {
    for (const [sid, agent] of this.agents) {
      if (agent.id === bubbleId && agent.customCreated) return this.trashCustomAgent(sid);
    }
    return false;
  }

  /**
   * 세션 키(`custom-…`) 또는 버블 id(`agent-…`) 로 커스텀 에이전트의 세션 키를 해소.
   * 클라(DetailPanel)는 선택된 **버블 id** 만 들고 있어서 세션 키를 모른다 — 두 형태를 모두 받는다.
   */
  resolveCustomAgentSessionId(idOrSessionId: string): string | null {
    const direct = this.agents.get(idOrSessionId);
    if (direct?.customCreated) return idOrSessionId;
    const normalized = idOrSessionId.startsWith('sat-') ? idOrSessionId.slice(4) : idOrSessionId;
    for (const [sid, agent] of this.agents) {
      if (agent.customCreated && agent.id === normalized) return sid;
    }
    return null;
  }

  /** 휴지통에서 복구 — trashed 플래그 해제(identity·설정·개별 기억 그대로). 반환=성공 여부. */
  restoreTrashedAgent(sessionIdOrBubbleId: string): boolean {
    const sessionId = this.resolveCustomAgentSessionId(sessionIdOrBubbleId);
    if (!sessionId) return false;
    const agent = this.agents.get(sessionId);
    if (!agent || !agent.customCreated) return false;
    if (!agent.trashed) return false;
    agent.trashed = undefined;
    agent.trashedAt = undefined;
    this.bumpMutationVersion();
    logger.info(`Custom agent restored from trash: "${agent.label}" (${sessionId.slice(0, 8)})`);
    return true;
  }

  /**
   * 휴지통 에이전트 영구 삭제 — 기존 removeBubble 커스텀 분기(묘비 기록)에 위임 + 개별 기억
   * 카드 디렉토리 삭제. 확인 팝업 승인 후 REST 에서만 호출. 반환=성공 여부.
   */
  permanentlyDeleteTrashedAgent(sessionIdOrBubbleId: string): boolean {
    const sessionId = this.resolveCustomAgentSessionId(sessionIdOrBubbleId);
    if (!sessionId) return false;
    const agent = this.agents.get(sessionId);
    if (!agent || !agent.customCreated) return false;
    // v4.84 — **휴지통에 있는 것만** 지운다(복구 경로와 대칭). 종전엔 이 확인이 없어 살아 있는
    //   커스텀 에이전트 id 가 흘러들면 휴지통을 거치지 않고 묘비까지 남기며 사라질 수 있었다.
    //   일괄 삭제(`POST /api/trash/purge`)가 생겨 한 번에 넘어오는 id 수가 늘었으므로 여기서 막는다.
    if (!agent.trashed) return false;
    const agentId = agent.id;
    // 개별 기억 카드 파일 삭제(있으면).
    if (this.root) {
      try { getBrainService(this.root).deleteAgentCards(agentId); } catch { /* best effort */ }
    }
    // v4.67 — sub-streams jsonl 도 함께 정리. 기억 카드와 같은 성격의 사이드카 파일인데
    // 종전엔 지우는 경로가 없어 영구 삭제한 에이전트의 스트림이 디스크에 계속 남았다.
    // 묘비가 남아 되살아날 수 없는 이 경로에서만 지운다(복구 경로에는 배선 ❌).
    try { subAgentManager.purgeAgentStreams(agentId); } catch { /* best effort */ }
    // removeBubble 커스텀 분기 = agents.delete + addTombstone + 엣지/콘티 cascade.
    this.removeBubble(agentId, { force: true, purgeTaskEdges: true });
    return true;
  }

  /** 이 그래프가 소유한 휴지통(trashed) 커스텀 에이전트 목록(내부 뷰용). */
  getTrashedCustomAgents(): BubbleData[] {
    const out: BubbleData[] = [];
    for (const agent of this.agents.values()) {
      if (agent.customCreated && agent.trashed) out.push(agent);
    }
    return out;
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
        this.agentFeedbacks.delete(agent.id);
        this.deleteSessionLoopsForAgent(agent.id);
        this.deleteSessionGoalsForAgent(agent.id);
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

      // §5.22 — 감사 원장 한 줄. 이 자리가 "모든 도구 호출이 지나가는 유일한 길"이라
      // 새 감시 계층 없이 여기 얹는다. 디스크는 이 경로가 이미 쓰는 코얼레스 저장에 맡긴다.
      this.recordAuditFromHook(payload, agent);

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

        // §2.1 #3 — Bash 로 읽은 파일도 같은 파일/폴더 버블 경로를 탄다(도구명은 `Read` 로 정규화).
        // 이게 없으면 `sed`/`cat` 으로 읽는 동안 캔버스는 직전 Edit/Write 상태로 얼어붙는다.
        if (specialType === 'bash') this.routeBashReadPaths(agent, payload);
        return result;
      }

      const filePath = extractFilePath(payload.tool_input, payload.tool_name);
      if (!filePath) return null;
      return this.routeToolFilePath(agent, payload, filePath, payload.tool_name);
    } catch (err) {
      logger.error('processHookEvent failed', err);
      return null;
    }
  }

  /** 도구가 만진 파일 경로 **1건**을 폴더/파일 버블 + 엣지로 라우팅한다.
   *  `Read`/`Write`/`Edit`/`Grep`/`Glob` 훅 경로와 §2.1 #3 Bash 읽기 경로가 **같은 길**을 쓴다
   *  (라우팅 규칙이 두 벌이 되면 한쪽만 고쳐져 어긋난다). `filePathIn` 은 이미 `normalize()` 된 경로. */
  private routeToolFilePath(
    agent: BubbleData,
    payload: HookEventPayload,
    filePathIn: string,
    toolName: string,
    opts?: { isDirectory?: boolean; allowWorktreeMigration?: boolean },
  ): ProcessResult | null {
    let filePath = filePathIn;

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
    // Bash 읽기(§2.1 #3)는 "그 워크트리로 옮겨 앉았다" 는 신호가 아니라 이주 판정을 태우지 않는다.
    if ((opts?.allowWorktreeMigration ?? true)
      && this.maybeMigrateAgentToWorktree(payload.session_id, agent.id, filePath, toolName)) {
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
    const isDirectoryPath = opts?.isDirectory ?? DIRECTORY_PATH_TOOLS.has(toolName);

    let topFolderPath: string | null;
    if (fileProject) {
      // 파일이 알려진 프로젝트(마스터 또는 워크트리) 내부.
      // 워크트리 home + 다른 프로젝트의 파일(부모 마스터 또는 다른 워크트리) → "내 워크트리에서 외부" 로 처리.
      if (isHomeWorktree && fileProject.path !== sessionProjectInfo!.path) {
        const wtKey = normalize(sessionProjectInfo!.path);
        const wtPrefix = `wt${hashString(wtKey).toString(36)}__`;
        topFolderPath = this.processExternalFile(
          filePath, toolName, agent.id, isDirectoryPath,
          wtKey, wtPrefix, sessionProjectInfo!.name,
          payload.tool_response, payload.cwd ?? sessionCwd,
        );
      } else {
        // 정상 internal 라우팅 — 파일의 owning project 기준
        // (마스터 home + 워크트리 파일이면 자동으로 워크트리 namespace 로 들어감 — processInternalFile 의 isWorktree 분기)
        topFolderPath = this.processInternalFile(
          filePath, toolName, agent.id, fileProject.path, isDirectoryPath,
        );
      }
    } else {
      // 파일이 어떤 프로젝트에도 속하지 않음 → external. 워크트리 home 이면 워크트리 children scope.
      const wtKey = isHomeWorktree ? normalize(sessionProjectInfo!.path) : null;
      const wtPrefix = wtKey ? `wt${hashString(wtKey).toString(36)}__` : '';
      // §2.1 #5 — 외부 폴더·위성도 **그 작업을 한 세션이 속한 탭 프로젝트**로 귀속시킨다.
      //   종전엔 워크트리 home 이 아니면 null 을 넘겨 nodeProjectNames 에 안 실렸는데,
      //   toProjectCheckpoint 의 노드 필터(getProjectNodePaths)가 그 기록으로만 소속을
      //   판정하므로 external_folder 가 체크포인트에 0건 저장 → 재시작 시 통째로 사라졌다.
      const extProjName = isHomeWorktree
        ? sessionProjectInfo!.name
        : this.resolveOwnerTabProjectName(sessionCwd ?? payload.cwd);
      topFolderPath = this.processExternalFile(
        filePath, toolName, agent.id, isDirectoryPath,
        wtKey, wtPrefix, extProjName,
        payload.tool_response, payload.cwd ?? sessionCwd,
      );
    }

    if (!topFolderPath) return null;

    const topFolder = this.nodes.get(topFolderPath);
    if (!topFolder) return null;

    const edge = this.mainEdges.upsert(agent.id, agent, topFolder, toolName, agent.id);

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
        this.mainEdges.upsert(agent.id, agent, wtBubble, toolName, agent.id);
      }
    }

    logger.debug(`${toolName} → ${filePath} (top: ${topFolderPath})`);
    return { agent, topFolder, edge };
  }

  /** §2.1 #3 — Bash 명령에서 **읽기로 확실한 경로만** 뽑아 같은 파일/폴더 버블 경로로 흘린다.
   *  도구명을 `Read` 로 정규화해 기존 방향 규칙(`READ_TOOLS`)을 그대로 타게 한다.
   *  디스크에 실재하는 **파일**만 채택 — 디렉터리는 `tool_response` 로 결과 파일을 뽑을 수 없어
   *  §2.1 v2.28 invariant(외부 폴더 ↔ 위성 ≥ 1)를 못 지키고, 존재하지 않는 경로는 오탐이다. */
  private routeBashReadPaths(agent: BubbleData, payload: HookEventPayload): void {
    const cmd = typeof payload.tool_input?.['command'] === 'string' ? payload.tool_input['command'] : '';
    if (!cmd) return;
    let candidates: string[];
    try {
      candidates = extractBashReadPaths(cmd);
    } catch (err) {
      logger.debug('extractBashReadPaths failed', err);
      return;
    }
    for (const rawPath of candidates) {
      let isFile = false;
      try {
        isFile = fs.statSync(rawPath).isFile();
      } catch {
        isFile = false;
      }
      if (!isFile) continue;
      this.routeToolFilePath(agent, payload, normalize(rawPath), BASH_READ_TOOL_NAME, {
        isDirectory: false,
        allowWorktreeMigration: false,
      });
    }
  }

  /** 세션 cwd → 그 세션이 속한 **탭** 프로젝트 이름(워크트리면 부모 탭). 못 찾으면 null. */
  private resolveOwnerTabProjectName(sessionCwd: string | undefined): string | null {
    if (!sessionCwd) return null;
    const proj = this.projects.get(normalize(sessionCwd)) ?? this.getProjectForCwd(sessionCwd);
    if (!proj) return null;
    return this.resolveTabProjectName(proj, sessionCwd);
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
    // active 상태 에이전트만 필터 (§5.10 휴지통 에이전트는 활성 참조로 치지 않는다 — getActiveAgentIds 와 같은 규칙)
    const activeIds: string[] = [];
    if (refs) {
      for (const agentId of refs) {
        for (const agent of this.agents.values()) {
          if (agent.id === agentId && agent.status === 'active' && !agent.trashed) {
            activeIds.push(agentId);
            break;
          }
        }
      }
    }
    if (activeIds.length > 0) {
      enriched.activeAgentIds = activeIds;
      return enriched;
    }

    // §2.4 — file/folder 버블의 "활동중"은 저장값이 아니라 **지금 그 파일을 만지고 있는 에이전트**에서
    // 파생한다. 저장 status 를 그대로 믿으면, 에이전트를 idle 로 내리면서 노드까지 못 내린 경로
    // (체크포인트 복원 · dev 서버 keep-alive · dormant 부활 등)에서 아무도 만지지 않는 파일이 계속
    // 펄스 링을 달고 있게 된다. 바로 위 worktree 분기와 getSnapshot 의 bash/iframe 위성이 이미 쓰는
    // 규칙을 파일/폴더에도 그대로 적용해, 새 idle 경로가 생겨도 표시가 어긋나지 않게 한다.
    // (저장 노드는 건드리지 않고 스냅샷 파생값만 덮으므로, 다시 만지면 자동으로 active 로 복귀한다.)
    if (
      (enriched.status === 'active' || enriched.status === 'completed')
      && (node.bubbleType === 'file'
        || node.bubbleType === 'internal_folder'
        || node.bubbleType === 'external_folder')
    ) {
      enriched.status = 'idle';
    }
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
    // §5.10 — 휴지통 에이전트는 여전히 스냅샷에 실리지만(플래그 노출) 활성 수 집계에선 제외.
    const activeCount = aliveAgents.filter((a) => a.status === 'active' && !a.trashed).length;
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
      // §5.5 #17-9 v3.51 — 지금 백단에서 도는 Task 서브에이전트(런타임 전용, 영속화 ❌ — 체크포인트
      //   직렬화(toCheckpoint/toProjectCheckpoint)에는 절대 넣지 않는다). 하나도 없으면 undefined →
      //   클라 활동바 항목/배지/패널이 자동으로 사라진다.
      runningSubagentTasks: subAgentManager.getRunningSubagentTasks(),
      // §5.5 #17-9 ⑦(b) — 방금 끝난 자식(부모별 최근 5건 + 결과 발췌). 같은 이유로 런타임 전용이다.
      finishedSubagentTasks: subAgentManager.getFinishedSubagentTasks(),
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
      captureBubbles: this.getCaptureBubbles(),
      appBubbles: this.getAppBubbles(),
      playBubbles: this.getPlayBubbles(),
      specDocs: this.getSpecDocs(),
      reviewRequests: this.getReviewRequests(),
      labRuns: this.getLabRuns(),
      shelfBubbles: this.getShelfBubbles(),
      // §5.21 — 전선용 지도(세션 날짜 분해는 빼고 실는다 — 그건 체크포인트 몫).
      costMaps: this.costMapService.getSnapshot(),
      // §5.22 — 감사 원장(집계는 서버가 접어서 실어 준다 — 클라가 다시 세지 않는다).
      auditLogs: this.auditLogService.getSnapshot(),
      debugBreakpoints: this.debugBreakpoints.size > 0
        ? Object.fromEntries([...this.debugBreakpoints].map(([k, v]) => [k, [...v]]))
        : undefined,
      layoutBoundsByProject: this.layoutBoundsByProject.size > 0
        ? Object.fromEntries(this.layoutBoundsByProject)
        : undefined,
      contis: this.contis.size > 0 ? this.getContisRecord() : undefined,
      activeContiWork: this.activeContiWork.size > 0 ? this.getActiveContiWorkRecord() : undefined,
      recentToolDurations: this.recentToolDurations.size > 0 ? this.getRecentToolDurations() : undefined,
      compactCounts: this.compactCounts.size > 0 ? this.getCompactCounts() : undefined,
      skillUsageCounts: this.getSkillUsageCountsRecord(),
      autoAgentSummaries: this.autoAgentSummaries.size > 0 ? this.getAutoAgentSummaries() : undefined,
      autoAgentRuns: this.getAutoAgentRunsRecord(),
      agentReports: this.getAgentReportsRecord(),
      agentQuestions: this.getAgentQuestionsRecord(),
      agentReviews: this.getAgentReviewsRecord(),
      agentLists: this.getAgentListsRecord(),
      agentFeedbacks: this.getAgentFeedbacksRecord(),
      sessionLoops: this.getSessionLoopsRecord(),
      // §5.5 #17-35 — 검증 이력(세션 탭 키). 루프와 같은 자리에 나란히 실린다.
      verificationRuns: this.getVerificationRunsRecord(),
      sessionGoals: this.getSessionGoalsRecord(),
      // §5.5 #17-28 — 주입원 오버라이드. 화면이 "무엇이 꺼져 있는지"를 스냅샷만으로도 알 수 있게.
      contextOverrides: this.getContextOverrides(),
      brain: this.getBrainSummary(),
      brainInjections: this.getBrainInjectionsRecord(),
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
      // §5.5 #17-20 ⑩ v4.94 — 이 프로젝트의 중단점(메모리 포맷)
      debugBreakpoints: this.debugBreakpoints.get(project.name)?.length
        ? [...(this.debugBreakpoints.get(project.name) as DebugBreakpoint[])]
        : undefined,
      captureBubbles: this.captureBubbles.size > 0 ? [...this.captureBubbles.values()] : undefined,
      appBubbles: this.appBubbles.size > 0 ? [...this.appBubbles.values()] : undefined,
      playBubbles: this.playBubbles.size > 0 ? [...this.playBubbles.values()] : undefined,
      specDocs: this.specDocs.size > 0 ? [...this.specDocs.values()] : undefined,
      reviewRequests: this.reviewRequests.size > 0 ? [...this.reviewRequests.values()] : undefined,
      labRuns: this.labRuns.size > 0 ? [...this.labRuns.values()] : undefined,
      shelfBubbles: this.shelfBubbles.size > 0 ? [...this.shelfBubbles.values()] : undefined,
      // §5.21 — 비용·토큰 지도(세션 날짜 분해 포함).
      costMap: this.costMapService.toCheckpoint(project.name),
      // §5.22 — 감사 원장. 결정 이력은 재계산이 불가능하므로 빠뜨리면 영영 없다.
      auditLog: this.auditLogService.toCheckpoint(project.name),
      layoutBoundsHalfWidth: this.layoutBoundsByProject.get(project.name)?.hw,
      layoutBoundsHalfHeight: this.layoutBoundsByProject.get(project.name)?.hh,
      contis: this.contis.size > 0 ? this.getContisRecord() : undefined,
      compactCounts: this.compactCounts.size > 0 ? this.getCompactCounts() : undefined,
      skillUsageCounts: this.getSkillUsageCountsFlat(),
      autoAgentSummaries: this.autoAgentSummaries.size > 0 ? this.getAutoAgentSummaries() : undefined,
      autoAgentRuns: this.getAutoAgentRunsRecord(),
      agentReports: this.getAgentReportsRecord(),
      agentQuestions: this.getAgentQuestionsRecord(),
      agentReviews: this.getAgentReviewsRecord(),
      agentLists: this.getAgentListsRecord(),
      agentFeedbacks: this.getAgentFeedbacksRecord(),
      sessionLoops: this.getSessionLoopsRecord(),
      // §5.5 #17-35 — 검증 이력(세션 탭 키). 루프와 같은 자리에 나란히 실린다.
      verificationRuns: this.getVerificationRunsRecord(),
      sessionGoals: this.getSessionGoalsRecord(),
      contextOverrides: this.getContextOverrides(),
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

    // v4.67 — 노드가 실재하는 경로의 편집만 저장한다.
    //   `projectNodePaths` 는 `nodeProjectNames`(경로→프로젝트 귀속 기록)에서 오는데, 노드가
    //   사라진 뒤에도 이 귀속 기록은 남는다. 반면 화면으로 나가는 `buildFileEditsRecord` 는
    //   `this.nodes.get(relPath)` 가 없으면 건너뛰고, 바로 위 노드 필터도 같은 기준으로
    //   `graph.nodes` 에서 뺀다. 즉 노드 없는 경로의 편집은 저장·백업·복원만 되고 UI 에는
    //   영영 도달하지 못하는 죽은 데이터였다(실측 94키 1.15MB, 백업 4벌 포함 4.6MB).
    //   기준을 노드 필터와 일치시켜 그만큼을 덜어낸다 — 화면에 보이던 것은 하나도 줄지 않는다.
    const fileEdits: Record<string, FileEdit[]> = {};
    for (const [filePath, edits] of this.fileEdits) {
      if (projectNodePaths.has(filePath) && this.nodes.has(filePath)) fileEdits[filePath] = edits;
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
      // §5.5 #17-20 ⑩ v4.94 — 중단점(디스크 포맷). 여기 빠뜨리면 껐다 켜면 사라진다.
      debugBreakpoints: (() => {
        const list = this.debugBreakpoints.get(project.name);
        return list && list.length > 0 ? [...list] : undefined;
      })(),
      // §5.9 — 캡처 버블 필터: 이 프로젝트 소속만
      captureBubbles: (() => {
        const bubbles = [...this.captureBubbles.values()].filter((b) => b.projectName === project.name);
        return bubbles.length > 0 ? bubbles : undefined;
      })(),
      appBubbles: (() => {
        const bubbles = [...this.appBubbles.values()].filter((b) => b.projectName === project.name);
        return bubbles.length > 0 ? bubbles : undefined;
      })(),
      // §5.14 v4.62 — 플레이 버블도 이 프로젝트 소속만(디스크 포맷 — 여기 빠지면 껐다 켤 때 사라진다).
      playBubbles: (() => {
        const bubbles = [...this.playBubbles.values()].filter((b) => b.projectName === project.name);
        return bubbles.length > 0 ? bubbles : undefined;
      })(),
      // §5.15 — 스펙 보드도 같은 규칙. 사람이 쓴 문장이라 여기 빠지면 껐다 켤 때 그대로 사라진다.
      specDocs: (() => {
        const docs = [...this.specDocs.values()].filter((d) => d.projectName === project.name);
        return docs.length > 0 ? docs : undefined;
      })(),
      // §5.16 — 리뷰·승인 레인도 같은 규칙. 여기 빠지면 사람이 내린 승인·반려 판단이 껐다 켤 때 사라진다.
      reviewRequests: (() => {
        const reqs = [...this.reviewRequests.values()].filter((r) => r.projectName === project.name);
        return reqs.length > 0 ? reqs : undefined;
      })(),
      // §5.18 — 에이전트 랩도 같은 규칙. 여기 빠지면 사람이 쓴 과제와 측정된 표가 껐다 켤 때 사라진다.
      labRuns: (() => {
        const runs = [...this.labRuns.values()].filter((r) => r.projectName === project.name);
        return runs.length > 0 ? runs : undefined;
      })(),
      // §5.20 — 선반도 같은 규칙. 여기 빠지면 사람이 모아 둔 명령·프롬프트가 껐다 켤 때 사라진다.
      shelfBubbles: (() => {
        const list = [...this.shelfBubbles.values()].filter((b) => b.projectName === project.name);
        return list.length > 0 ? list : undefined;
      })(),
      // §5.21 — 비용·토큰 지도. 트랜스크립트가 지워지면 다시 접을 수 없으므로 디스크 포맷에도 싣는다.
      costMap: this.costMapService.toCheckpoint(project.name),
      // §5.22 — 감사 원장. **여기가 이 항목에서 가장 조용히 깨질 자리** — 결정 이력은
      // 어디서도 재계산할 수 없어서 디스크 포맷에서 빠지면 껐다 켠 순간 영영 없다.
      auditLog: this.auditLogService.toCheckpoint(project.name),
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
      // §5.3 #10-3 v4.98 — 검증 런: 이 프로젝트 소속 auto-agent(세션 id)분만 필터해 영속.
      //   ⚠ 키가 버블 id 가 아니라 **sessionId** 라 projectSessions 로 거른다(아래 카드류와 다름).
      //   여기를 빠뜨리면 화면에는 보이는데 껐다 켜면 증거가 사라진다 — v2.55·v1.59 와 같은 함정이며
      //   실제로 이번 라운드에도 처음엔 빠뜨렸다가 왕복 테스트가 잡았다.
      autoAgentRuns: (() => {
        const out: Record<string, AutoAgentRun[]> = {};
        for (const [autoAgentId, runs] of this.autoAgentRuns) {
          if (projectSessions.has(autoAgentId) && runs.length > 0) out[autoAgentId] = [...runs];
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
      // §4 v3.21 — 에이전트 피드백: 이 프로젝트 소속 에이전트(버블 id)분만 필터해 영속(agentReports 와 동형).
      //   (v2.55 영속화 함정 사전 반영 — 디스크 포맷인 toProjectCheckpoint 에 반드시 포함.)
      agentFeedbacks: (() => {
        const out: Record<string, AgentFeedback[]> = {};
        for (const [agentId, fbs] of this.agentFeedbacks) {
          if (projectBubbleIds.has(agentId) && fbs.length > 0) out[agentId] = [...fbs];
        }
        return Object.keys(out).length > 0 ? out : undefined;
      })(),
      // §5.5 #17-11 v3.79 — 세션 루프: 키는 세션 탭이지만 소속 판정은 loop.agentId 로 한다
      //   (agentReports 와 동형 — 디스크 포맷이라 여기 빠뜨리면 껐다 켜면 루프가 사라진다).
      sessionLoops: (() => {
        const out: Record<string, SessionLoop> = {};
        for (const [subId, loop] of this.sessionLoops) {
          if (projectBubbleIds.has(loop.agentId)) out[subId] = { ...loop };
        }
        return Object.keys(out).length > 0 ? out : undefined;
      })(),
      // §5.5 #17-35 — 검증 이력: 루프와 동형(키는 세션 탭, 소속 판정은 run.agentId).
      //   **디스크 포맷이라 여기 빠뜨리면 껐다 켜면 검증 이력이 통째로 사라진다**(v2.55 함정).
      verificationRuns: (() => {
        const out: Record<string, VerificationRun[]> = {};
        for (const [subId, list] of this.verificationRuns) {
          const mine = list.filter((r) => projectBubbleIds.has(r.agentId));
          if (mine.length > 0) out[subId] = mine.map((r) => ({ ...r, attempts: [...r.attempts] }));
        }
        return Object.keys(out).length > 0 ? out : undefined;
      })(),
      // §5.5 #17-17 v4.46 — 세션 목표: 루프와 동형(키는 세션 탭, 소속 판정은 goal.agentId).
      //   디스크 포맷이라 여기 빠뜨리면 껐다 켜면 목표가 통째로 사라진다(v2.55 함정).
      sessionGoals: (() => {
        const out: Record<string, SessionGoal> = {};
        for (const [subId, goal] of this.sessionGoals) {
          if (projectBubbleIds.has(goal.agentId)) out[subId] = { ...goal, steps: [...goal.steps], history: [...goal.history] };
        }
        return Object.keys(out).length > 0 ? out : undefined;
      })(),
      // §5.5 #17-28 — 주입원 오버라이드: 프로젝트 층은 이 프로젝트 키 하나, 세션 층은 이 프로젝트의
      //   에이전트에 속한 것만. 디스크 포맷이라 여기 빠뜨리면 껐다 켜면 껐던 것이 다시 실린다.
      contextOverrides: this.getContextOverrides({ projectKey: projectName, agentIds: projectBubbleIds }),
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

    // 에이전트 병합 — 디스크에서 올라온 것이므로 복원 경로와 같은 규칙으로 "활동중"을 내린다.
    //   이미 있는 키는 **살아 있는 인스턴스의 것**이라 절대 건드리지 않는다(돌고 있는 세션을 꺼뜨리게 된다).
    for (const [k, v] of Object.entries(cp.graph.agents)) {
      if (this.agents.has(k)) continue;
      demoteStaleActivityOnLoad(v);
      this.agents.set(k, v);
    }

    // 노드 병합 — 위와 같은 규칙. 프로젝트를 둘 이상 연 사람에게만 드러나는 자리라 함께 막는다.
    for (const [k, v] of Object.entries(cp.graph.nodes)) {
      if (this.nodes.has(k)) continue;
      demoteStaleActivityOnLoad(v);
      this.nodes.set(k, v);
    }

    // 프로젝트 병합 — **키는 저장분을 믿지 않고 `normalize(v.path)` 로 다시 만든다.**
    // 예전 체크포인트는 플랫폼과 무관하게 소문자 키로 적혀 있어, linux 에서 그대로 쓰면
    // `this.projects.get(normalize(cwd))` 가 영영 못 찾아 프로젝트가 미등록으로 보인다(하위호환).
    for (const [k, v] of Object.entries(cp.graph.projects)) {
      const key = v?.path ? normalize(v.path) : k;
      if (!this.projects.has(key)) this.projects.set(key, v);
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

    // §4 v3.21 — 에이전트 피드백 병합. id 중복 제거 후, 같은 대상(targetType+targetId)은
    // upsert 의미론에 맞춰 최신(createdAt 큰) 1건만 남긴다.
    if (cp.agentFeedbacks) {
      for (const [agentId, fbs] of Object.entries(cp.agentFeedbacks)) {
        if (!Array.isArray(fbs) || fbs.length === 0) continue;
        const merged = [...(this.agentFeedbacks.get(agentId) ?? [])];
        const seen = new Set(merged.map((f) => f.id));
        for (const f of fbs) if (!seen.has(f.id)) merged.push(f);
        merged.sort((a, b) => a.createdAt - b.createdAt);
        const byTarget = new Map<string, AgentFeedback>();
        for (const f of merged) byTarget.set(`${f.targetType}:${f.targetId}`, f);
        const collapsed = [...byTarget.values()].sort((a, b) => a.createdAt - b.createdAt);
        if (collapsed.length > AGENT_FEEDBACK_MAX_PER_AGENT) {
          collapsed.splice(0, collapsed.length - AGENT_FEEDBACK_MAX_PER_AGENT);
        }
        this.agentFeedbacks.set(agentId, collapsed);
      }
    }

    // §5.5 #17-11 v3.79 — 세션 루프 병합. 키(subAgentId)가 세션 단위로 유일하므로,
    // 이미 메모리에 있는 쪽(현재 도는 설정)을 이기지 않게 **없는 것만** 채운다.
    if (cp.sessionLoops) {
      for (const [subId, loop] of Object.entries(cp.sessionLoops)) {
        if (!loop || typeof loop !== 'object') continue;
        // §5.5 #17-11 ⑪·⑫ — 구버전 체크포인트 보정(없으면 새 옵션 전부 꺼짐 = 기존 동작).
        if (!this.sessionLoops.has(subId)) this.sessionLoops.set(subId, normalizeSessionLoop(loop));
      }
    }

    // §5.5 #17-35 — 검증 이력 병합. 루프와 같은 규칙 — 키(subAgentId)가 세션 단위로 유일하므로
    // 이미 메모리에 있는 쪽(지금 도는 검증)을 이기지 않게 **없는 탭만** 채운다.
    if (cp.verificationRuns) {
      for (const [subId, list] of Object.entries(cp.verificationRuns)) {
        if (!Array.isArray(list) || list.length === 0) continue;
        if (this.verificationRuns.has(subId)) continue;
        this.verificationRuns.set(
          subId,
          list.filter((r) => r && typeof r === 'object').map(normalizeVerificationRun).slice(0, VERIFICATION_RUNS_MAX_PER_SESSION),
        );
      }
    }

    // §5.5 #17-17 v4.46 — 세션 목표 병합. 루프와 동일 규칙(키가 세션 단위로 유일하므로
    // 메모리에 이미 있는 쪽을 이기지 않게 **없는 것만** 채운다).
    if (cp.sessionGoals) {
      for (const [subId, goal] of Object.entries(cp.sessionGoals)) {
        if (!goal || typeof goal !== 'object') continue;
        if (!this.sessionGoals.has(subId)) this.sessionGoals.set(subId, normalizeSessionGoal(goal));
      }
    }

    // §5.5 #17-28 — 주입원 오버라이드 병합(없는 키만 채우는 같은 규칙).
    this.restoreContextOverrides(cp.contextOverrides);

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
            // §5.5 #17-12 ③ — 하단 상태바가 "오류" 한 단어 대신 "앱 재기동으로 끊김" 이라고 말하게 하고,
            //   세션이 남아 있으면 그 대화 끝에도 같은 사유를 한 줄 남긴다.
            subAgentManager.markCommandError(cmd.subAgentId, cmd, {
              code: 'orphaned',
              ...(sub ? {} : { detail: 'subagent missing' }),
            });
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
        if (!this.agentConfigs.has(agentId)) this.agentConfigs.set(agentId, backfillAgentConfigTools(config));
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

    // §5.5 #17-20 ⑩ v4.94 — 중단점 병합(멀티프로젝트 보트에서 이 프로젝트 몫만 채운다).
    // 이미 들고 있으면 덮어쓰지 않는다 — 켜져 있던 쪽이 최신이다.
    if (cp.debugBreakpoints && !this.debugBreakpoints.has(cp.project.name)) {
      this.debugBreakpoints.set(cp.project.name, cp.debugBreakpoints.map((bp) => ({ ...bp })));
    }

    // §5.9 — 캡처 버블 병합 (중복 ID 는 기존 유지)
    if (cp.captureBubbles) {
      for (const bubble of cp.captureBubbles) {
        if (this.captureBubbles.has(bubble.id)) continue;
        this.captureBubbles.set(bubble.id, { ...bubble });
      }
    }

    // §5.13 v4.45 — 내부 앱 버블도 같은 규칙(있던 것을 덮지 않는 합집합).
    if (cp.appBubbles) {
      for (const bubble of cp.appBubbles) {
        if (this.appBubbles.has(bubble.id)) continue;
        this.appBubbles.set(bubble.id, { ...bubble });
      }
    }

    // §5.14 v4.62 — 플레이 버블도 같은 규칙. 프로세스는 재기동과 함께 사라졌으므로 상태만 내린다.
    if (cp.playBubbles) {
      for (const bubble of cp.playBubbles) {
        if (this.playBubbles.has(bubble.id)) continue;
        this.playBubbles.set(bubble.id, sanitizePlayBubbleOnLoad(bubble));
      }
    }

    // §5.15 — 스펙 보드 병합(id 기준 합집합). 실행 상태가 없으므로 내릴 것도 없다.
    if (cp.specDocs) {
      for (const doc of cp.specDocs) {
        if (this.specDocs.has(doc.id)) continue;
        this.specDocs.set(doc.id, sanitizeSpecDocOnLoad(doc));
      }
    }

    // §5.16 — 리뷰 병합(id 기준 합집합). 결정 이력은 사람이 내린 판단이라 덮어쓰지 않는다.
    if (cp.reviewRequests) {
      for (const r of cp.reviewRequests) {
        if (this.reviewRequests.has(r.id)) continue;
        this.reviewRequests.set(r.id, sanitizeReviewRequestOnLoad(r));
      }
    }

    // §5.18 — 랩 병합(id 기준 합집합). 측정된 결과는 사람이 판단할 근거라 덮어쓰지 않는다.
    if (cp.labRuns) {
      for (const r of cp.labRuns) {
        if (this.labRuns.has(r.id)) continue;
        this.labRuns.set(r.id, sanitizeLabRunOnLoad(r));
      }
    }

    // §5.21 — 비용 지도 병합(세션 id 기준 합집합, 겹치면 턴을 더 많이 읽은 쪽).
    this.costMapService.merge(cp.costMap);

    // §5.22 — 감사 원장 병합(id 기준 합집합). 지금 돌고 있는 원장이 디스크보다 새것이라 덮지 않는다.
    this.auditLogService.merge(cp.auditLog);

    // §5.20 — 선반 병합(id 기준 합집합). 사람이 모아 둔 줄은 덮어쓰지 않는다.
    if (cp.shelfBubbles) {
      for (const b of cp.shelfBubbles) {
        if (this.shelfBubbles.has(b.id)) continue;
        this.shelfBubbles.set(b.id, sanitizeShelfBubbleOnLoad(b));
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
      this.ensureRootNode(info.name, info);
    }
    this.ensureRootNode(cp.project.name, cp.project);

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
    // 키를 저장분에서 그대로 받지 않고 `normalize(info.path)` 로 다시 만든다 — 예전 저장분은
    // 플랫폼과 무관하게 소문자 키라, linux 에서 그대로 실으면 조회가 전부 빗나간다(하위호환).
    this.projects = new Map(
      Object.entries(cp.graph.projects).map(([k, v]) => [v?.path ? normalize(v.path) : k, v] as const),
    );
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
      demoteStaleActivityOnLoad(agent);
    }
    for (const node of this.nodes.values()) {
      node.lastActivity = now;
      // 에이전트와 **같은 규칙**을 파일/폴더 버블에도 적용한다. 종전엔 이 루프가 lastActivity 만
      // 갱신하고 status 는 그대로 둬서, 껐다 켜면 에이전트는 idle 인데 그 에이전트가 만졌던
      // 파일·폴더만 활동중으로 빛나 있었다(실측: 체크포인트에 active 로 굳은 노드 260개).
      // active 노드는 isAlive 의 5분 TTL 도 통과해 영영 정리되지 않는다는 점까지 함께 풀린다.
      demoteStaleActivityOnLoad(node);
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
      this.agentConfigs = new Map(
        Object.entries(cp.agentConfigs).map(([id, cfg]) => [id, backfillAgentConfigTools(cfg)]),
      );
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

    // §5.5 #17-20 ⑩ v4.94 — 중단점 복원
    this.debugBreakpoints = new Map();
    if (cp.debugBreakpoints && cp.debugBreakpoints.length > 0) {
      this.debugBreakpoints.set(cp.project.name, cp.debugBreakpoints.map((bp) => ({ ...bp })));
    }

    // §5.9 — 캡처 버블 복원
    this.captureBubbles = new Map();
    if (cp.captureBubbles) {
      for (const bubble of cp.captureBubbles) {
        this.captureBubbles.set(bubble.id, { ...bubble });
      }
    }

    // §5.13 v4.45 — 내부 앱 버블 복원.
    this.appBubbles = new Map();
    if (cp.appBubbles) {
      for (const bubble of cp.appBubbles) {
        this.appBubbles.set(bubble.id, { ...bubble });
      }
    }

    // §5.14 v4.62 — 플레이 버블 복원. 버튼·레시피는 그대로, 실행 상태는 초기화한다
    //   (프로세스는 앱과 함께 죽었으므로 running 인 채로 살아나면 거짓말이 된다).
    this.playBubbles = new Map();
    if (cp.playBubbles) {
      for (const bubble of cp.playBubbles) {
        this.playBubbles.set(bubble.id, sanitizePlayBubbleOnLoad(bubble));
      }
    }

    // §5.15 — 스펙 보드 복원. 사람이 쓴 문장 그대로 살린다(정규화만).
    this.specDocs = new Map();
    if (cp.specDocs) {
      for (const doc of cp.specDocs) {
        this.specDocs.set(doc.id, sanitizeSpecDocOnLoad(doc));
      }
    }

    // §5.16 — 리뷰 복원. 사람이 쓴 반려 사유와 결정 시각을 그대로 살린다(정규화만).
    this.reviewRequests = new Map();
    if (cp.reviewRequests) {
      for (const r of cp.reviewRequests) {
        this.reviewRequests.set(r.id, sanitizeReviewRequestOnLoad(r));
      }
    }

    // §5.18 — 랩 복원. 사람이 쓴 과제와 측정된 표를 그대로 살린다(도는 잔상만 내린다).
    this.labRuns = new Map();
    if (cp.labRuns) {
      for (const r of cp.labRuns) {
        this.labRuns.set(r.id, sanitizeLabRunOnLoad(r));
      }
    }

    // §5.21 — 비용 지도 복원. 없으면 빈 원장으로 시작한다(옛 체크포인트 호환).
    this.costMapService.restore(cp.costMap);

    // §5.22 — 감사 원장 복원(경계 스위치도 함께). 없으면 빈 원장 + 기본 스위치(전부 묻는다).
    this.auditLogService.restore(cp.auditLog);

    // §5.20 — 선반 복원. 사람이 모아 둔 명령·프롬프트를 그대로 살린다(도는 잔상만 내린다).
    this.shelfBubbles = new Map();
    if (cp.shelfBubbles) {
      for (const b of cp.shelfBubbles) {
        this.shelfBubbles.set(b.id, sanitizeShelfBubbleOnLoad(b));
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

    // §5.3 #10-3 v4.98 — 검증 런 복원. 증거는 "무엇을 근거로 완료라고 했는가"라
    //   세션을 넘어 남아야 한다(§3.2.1 영속 5지점 중 ④).
    this.autoAgentRuns.clear();
    if (cp.autoAgentRuns) {
      for (const [id, runs] of Object.entries(cp.autoAgentRuns)) {
        if (Array.isArray(runs)) {
          this.autoAgentRuns.set(id, runs.filter((r) => r && typeof r === 'object'));
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

    // §4 v3.21 — 에이전트 피드백 복원
    this.agentFeedbacks.clear();
    if (cp.agentFeedbacks) {
      for (const [agentId, fbs] of Object.entries(cp.agentFeedbacks)) {
        if (Array.isArray(fbs) && fbs.length > 0) {
          this.agentFeedbacks.set(agentId, [...fbs]);
        }
      }
    }

    // §5.5 #17-11 v3.79 — 세션 루프 복원. 서버가 죽는 동안 걸려 있던 회차는 이어받을 수 없으므로
    //   `running` 은 `waiting` 으로 되돌리고 대조용 `pendingCommandId` 를 비운다 —
    //   그래야 부팅 후 스윕이 "실행 중인 회차 없음"으로 보고 다음 회차를 정상 발사한다
    //   (이걸 안 하면 죽은 명령 id 를 영원히 기다려 루프가 멈춘 채로 살아 있는 것처럼 보인다).
    // §5.5 #17-35 — 검증 이력 복원. 서버가 죽는 동안 돌던 검증은 이어받을 수 없으므로
    //   `queued`/`running` 은 `stopped` 로 내리고 대조용 `pendingCommandId` 를 비운다 —
    //   그래야 그 탭에서 새 검증을 바로 시작할 수 있다(죽은 명령 id 를 영원히 기다리지 않는다).
    this.verificationRuns.clear();
    if (cp.verificationRuns) {
      for (const [subId, list] of Object.entries(cp.verificationRuns)) {
        if (!Array.isArray(list) || list.length === 0) continue;
        const restored = list
          .filter((r) => r && typeof r === 'object')
          .map((r) => {
            const run = normalizeVerificationRun(r);
            if (run.status === 'queued' || run.status === 'running') {
              return { ...run, status: 'stopped' as const, pendingCommandId: undefined };
            }
            return run;
          })
          .slice(0, VERIFICATION_RUNS_MAX_PER_SESSION);
        if (restored.length > 0) this.verificationRuns.set(subId, restored);
      }
    }

    this.sessionLoops.clear();
    if (cp.sessionLoops) {
      for (const [subId, loop] of Object.entries(cp.sessionLoops)) {
        if (!loop || typeof loop !== 'object') continue;
        // §5.5 #17-11 ⑪·⑫ — 구버전 체크포인트엔 새 필드가 없다(없으면 전부 꺼짐 = 기존 동작).
        const restored: SessionLoop = normalizeSessionLoop(loop);
        if (restored.status === 'running') {
          restored.status = restored.enabled ? 'waiting' : 'stopped';
          restored.pendingCommandId = undefined;
          // 회차 사이 압축도 서버가 죽는 동안 사라졌다 — 대조 id 를 비워야 다음 회차가 나간다.
          restored.pendingCompactCommandId = undefined;
          restored.nextRunAt = Date.now();
        }
        this.sessionLoops.set(subId, restored);
      }
    }

    // §5.5 #17-17 v4.46 — 세션 목표 복원. 루프와 달리 진행 중인 "회차"가 없어 되돌릴 상태가 없다 —
    //   문장·퍼센트·이력을 그대로 이어받으면 된다(구버전 체크포인트는 누락 필드를 정규화로 보충).
    this.sessionGoals.clear();
    if (cp.sessionGoals) {
      for (const [subId, goal] of Object.entries(cp.sessionGoals)) {
        if (!goal || typeof goal !== 'object') continue;
        this.sessionGoals.set(subId, normalizeSessionGoal(goal));
      }
    }

    // §5.5 #17-28 — 주입원 오버라이드 복원. 되돌릴 진행 상태가 없어 목표와 같이 그대로 이어받는다.
    //   이 프로젝트의 몫만 담긴 체크포인트라 다른 프로젝트의 키를 지우면 안 된다 → clear ❌, 병합 ○.
    this.restoreContextOverrides(cp.contextOverrides);

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
      this.ensureRootNode(info.name, info);
    }
    // primary project 루트도 보장
    this.ensureRootNode(cp.project.name, cp.project);

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
            // §5.5 #17-12 ③ — 하단 상태바가 "오류" 한 단어 대신 "앱 재기동으로 끊김" 이라고 말하게 하고,
            //   세션이 남아 있으면 그 대화 끝에도 같은 사유를 한 줄 남긴다.
            subAgentManager.markCommandError(cmd.subAgentId, cmd, {
              code: 'orphaned',
              ...(sub ? {} : { detail: 'subagent missing' }),
            });
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
  /** §9 v3.89 — bash 히스토리 사본 메모(파일편집과 동형: 앞에 추가 + 뒤 잘라내기만 일어난다). */
  private bashHistoryViewCache = new WeakMap<
    BashEntry[],
    { len: number; head: BashEntry | undefined; out: BashEntry[] }
  >();

  private buildBashHistoryRecord(): Record<string, BashEntry[]> {
    const result: Record<string, BashEntry[]> = {};
    for (const [sessionId, entries] of this.bashHistory) {
      const bubbleId = this.bashBubbleId(sessionId);
      const memo = this.bashHistoryViewCache.get(entries);
      if (memo !== undefined && memo.len === entries.length && memo.head === entries[0]) {
        result[bubbleId] = memo.out;
        continue;
      }
      const out = [...entries];
      this.bashHistoryViewCache.set(entries, { len: entries.length, head: entries[0], out });
      result[bubbleId] = out;
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

    // §5.10 — 휴지통에 들어간 커스텀 에이전트는 활성 집계 대상에서 제외(active/completed 로 튀지 않음).
    if (found.trashed) return false;

    // §5.3 #12-1 v1.91 — 권한 승인 대기 중이면 훅이 동기 hold 중인 "블록된 활성" 상태.
    // sub 집계가 비활성으로 보여도 completed 로 강등 ❌ — 결정/타임아웃까지 active 유지.
    if (this.permissionWaitingAgents.has(parentAgentId)) {
      if (found.status !== 'active') {
        this.bumpMutationVersion();
        found.status = 'active';
        found.fadeStartedAt = undefined;
        found.lastActivity = Date.now();
        return true;
      }
      return false;
    }

    // §5.3 #12-1 v3.43 — 백그라운드 서브에이전트 대차대조: 부모(감독관) 턴이 끝나 sub 가 idle
    // 이어도, 이 에이전트가 스스로 띄운 Task/Agent 서브에이전트의 SubagentStop 이 아직 안 왔으면
    // "대기 중인 활성"이다. permissionWaitingAgents(v1.91)와 동형의 completed 강등 차단 —
    // 별도 상태·비주얼 없이 기존 active 그대로 유지(자식이 일하는 중 = 사용자에겐 "활동 중").
    // §5.3 #12-1 — 훅 대차대조(Task/Agent 자식) **또는** 스트림으로만 보이는 백그라운드 작업
    //   (`Bash run_in_background` · `Monitor`). 후자를 안 보면 그 작업을 기다리는 감독관 버블이
    //   "끝난 것"으로 내려간다 — 사용자 보고 "서브가 시킨 거 대기 중인데 끝난 걸로 착각한다".
    if (subAgentManager.hasPendingSubagentTasks(parentAgentId)
      || subAgentManager.hasLiveBackgroundTasks(parentAgentId)) {
      if (found.status !== 'active') {
        this.bumpMutationVersion();
        found.status = 'active';
        found.fadeStartedAt = undefined;
        found.lastActivity = Date.now();
        return true;
      }
      found.lastActivity = Date.now();
      return false;
    }

    const subs = subAgentManager.getAllSubs(parentAgentId);
    // liveness 가드 — sub.status 가 순간 비활성으로 읽혀도 자식이 아직 한 턴을 처리 중이면 active 로 본다.
    //   persistent result 직후 finalize→idle 과 다음 명령 dispatch 사이의 창, 또는 in-process
    //   Task/위임 워커가 아직 도는 창에서 부모(감독관) 버블이 조기 completed 로 튀는 것을 막는다.
    //   sweepIdle(§ isSubRunning) 이 살아있는 자식을 지키는 것과 동형. idle 대기 자식은 제외되므로
    //   진짜 끝났을 때는 정상 완료된다.
    const anyActive = subs.some(
      (s) => s.status === 'active' || subAgentManager.isSubProcessingCommand(s.id),
    );
    const prevStatus = found.status;

    if (anyActive) {
      if (prevStatus !== 'active') {
        this.bumpMutationVersion();
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

    // §5.5 #17-11 v3.92 — "지금 도는 게 없다" ≠ "일이 끝났다".
    // 한 턴이 끝나면 sub 는 다음 명령이 dispatch 되기 전까지 잠깐 idle 이 된다. 그 찰나에 이 함수가
    // 불리면 큐에 다음 명령이 줄 서 있어도(사용자가 여러 개 보냈거나 루프가 다음 회차를 예약했어도)
    // 부모 버블이 completed 로 튀고 — 엣지가 뜯기고 완료음까지 울린 뒤 다음 명령에 다시 active 로
    // 돌아온다 = "아직 안 끝났는데 계속 완료 처리". 완료 판정의 기준을 "지금 도는 것"에서
    // **"이 에이전트에 낼 일이 남았는가"** 로 넓힌다.
    if (this.hasPendingAgentWork(parentAgentId)) {
      found.lastActivity = Date.now();
      return false;
    }

    // 실패로 끝난 세션이 하나라도 있으면 **완료가 아니라 실패**다. 종전에는 `NodeStatus` 에 `error` 가
    // 없어서 이 경우도 아래 completed 로 내려갔고, 캔버스에서 실패가 완료로 보이는 데다 완료음까지
    // 울렸다(`completionChime` 은 `→ completed` 전이에 반응한다). `SubAgentStatus.error` 를 그대로
    // 버블까지 올려 두 축이 같은 말을 하게 한다.
    if (subs.some((s) => s.status === 'error')) {
      if (found.status !== 'error') {
        this.bumpMutationVersion();
        found.status = 'error';
        found.fadeStartedAt = undefined;
        found.lastActivity = Date.now();
        return true;
      }
      return false;
    }

    // active 아님 — 직전이 active 였으면 completed 로 (기존 에이전트 completed 경로와 동일 처리)
    if (prevStatus === 'active') {
      // 상태가 실제로 바뀌었으니 스냅샷 캐시(mutationVersion + 200ms TTL)를 무효화한다 —
      // 안 하면 직후 broadcast 가 낡은 캐시를 그대로 실어 보내 전이가 한 박자 늦게(또는 안) 보인다.
      this.bumpMutationVersion();
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

  /**
   * §5.5 #17-11 v3.92 — 이 커스텀 에이전트에 **아직 낼 일**이 남았는가(= 완료로 볼 수 없는가).
   *
   * - ① 큐에 대기 중인 명령(`queued`) — 사용자가 여러 개 보냈거나 루프가 다음 회차를 넣어 둔 경우.
   *   명령 사이의 빈틈은 "완료"가 아니라 "다음 것을 기다리는 중"이다.
   * - ② 진행 중 세션 루프(`enabled && running|waiting`) — 회차 사이 대기(`intervalMs`)도 도는 중이다.
   *   루프가 `done`/`error`/`stopped` 로 꺼지면 여기서 빠져 정상적으로 completed 로 간다.
   *
   * `executing` 명령은 일부러 세지 않는다 — 그건 sub liveness(`anyActive`)가 판정하는 몫이고,
   * 자식이 죽었는데 `executing` 으로 굳은 명령까지 활성으로 치면 버블이 영영 안 끝난다.
   */
  private hasPendingAgentWork(parentAgentId: string): boolean {
    for (const loop of this.sessionLoops.values()) {
      if (loop.agentId !== parentAgentId) continue;
      if (loop.enabled && (loop.status === 'running' || loop.status === 'waiting')) return true;
    }
    for (const [sessionId, cmds] of this.commandQueuesRef) {
      if (!cmds.some((c) => c.status === 'queued')) continue;
      if (this.resolveCommandOwnerAgentId(sessionId) === parentAgentId) return true;
    }
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
    // §3.2.4 F축 — 세션당 5건 캡은 있었으나 세션 키가 무제한이었다. 소요시간 표시용이라 안전.
    capMapSize(this.recentToolDurations, SESSION_KEYED_MAP_MAX);
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

  /**
   * §5.3 — 사용자 인터럽트로 Stop 훅이 발사되지 않는 Claude Code 한계 보완.
   * active 상태인 Hook 에이전트(커스텀/서브 제외) 중, 세션 JSONL 의 마지막 대화 엔트리가
   * 사용자 인터럽트/도구 거부 sentinel 로 끝난 세션 ID 목록을 반환한다.
   * 호출부(index.ts)가 이들에 markStop 을 걸어 "누락된 Stop 훅"을 대신 시뮬레이트한다.
   * (커스텀/서브 에이전트는 recomputeAllCustomAgentStatuses 축이 별도라 여기서 제외.)
   */
  findInterruptedActiveSessions(): string[] {
    const out: string[] = [];
    for (const [sessionId, agent] of this.agents) {
      if (agent.status !== 'active') continue;
      if (agent.customCreated) continue;
      const cwd = this.sessionCwds.get(sessionId);
      if (!cwd) continue;
      if (isSessionInterrupted(cwd, sessionId)) out.push(sessionId);
    }
    return out;
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
        // v4.67 — dbg 도 같은 게이트 안으로. 종전엔 게이트 밖이라 iframe 보존이 지속되는 동안
        // 2초마다 같은 줄이 계속 쌓였다(진입 1회만 남겨도 진단에 필요한 정보는 동일).
        dbg('removeAgentBySession.keep-iframe', { sessionId, label: agent.label, projectName, cwd });
      }
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
    this.agentFeedbacks.delete(agent.id);
    this.deleteSessionLoopsForAgent(agent.id);
    this.deleteSessionGoalsForAgent(agent.id);
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
      // §5.3 #12-1 v3.43 — 백그라운드 서브에이전트가 아직 도는 에이전트도 제외(대기 중인 활성).
      if (subAgentManager.hasPendingSubagentTasks(agent.id)) continue;
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
      // §5.3 #12-1 v3.43 — 백그라운드 서브에이전트가 아직 도는 동안도 fade/expire 보류.
      if (subAgentManager.hasPendingSubagentTasks(agent.id)) continue;
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
        // v3.71: worktree 버블은 "폴더가 있는가" 가 아니라 "아직 살아있는 git 워크트리인가" 로 본다.
        // `git worktree remove` 후 잠금 파일·잔여물로 폴더만 남은 좀비를 살아있는 것으로 오인하면
        // 버블이 캔버스에 영구 잔존한다(사용자는 지웠는데 화면엔 남는 상태).
        const missing = node.bubbleType === 'worktree'
          ? !isLiveWorktreeDir(absPath)
          : !fs.existsSync(absPath);
        if (missing) {
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

      // `normalize()` 가 만든 노드 키와 맞물리도록 같은 규칙으로 접는다(linux 는 접지 않는다).
      const relPath = foldCase(relDir ? `${relDir}/${entry.name}` : entry.name);

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
    // 내부 경로는 toRelative/normalize 와 같은 규칙으로 접는다(linux 는 접지 않는다).
    const normFolder = ProjectGraph.isRootKey(folderPath) ? folderPath : foldCase(folderPath);
    const normFile = foldCase(filePath);
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
    const normFile = foldCase(filePath);
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
    const childKey = foldCase(filePath);
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
  /**
   * §9 스코프드 구독 — **범위 밖 프로젝트의 탭 배지를 위한 경량 집계**.
   *
   * 탭바는 프로젝트마다 "에이전트 N개 · 실행 중 N개 · 끝남 N개"를 보여 준다. 그런데 스코프드
   * 구독은 **안 보는 프로젝트의 `agents` 배열을 스냅샷에서 뺀다** — 그대로 두면 배경 탭 배지가
   * 전부 0 으로 보인다(최적화가 아니라 기능 손상). 그래서 무거운 슬라이스와 무관하게 이 집계만은
   * **항상 전 프로젝트**를 싣는다. 프로젝트당 수십 바이트라 전선 비용이 사실상 없다.
   *
   * ⚠ 필터는 `getSnapshot()` 의 `aliveAgents` 와 **같은 기준**이어야 한다(살아 있음 · 숨김 아님 ·
   *   파이프라인 자식 아님). 어긋나면 배지 숫자가 캔버스와 다르게 보인다.
   */
  /**
   * §9 배경 탭 유휴 해제 — **지금 일하는 것이 하나라도 있는가.**
   *
   * 하나라도 참이면 이 프로젝트는 화면에 없어도 내려놓지 않는다. "안 보이니 꺼도 된다"가 아니라
   * "안 보이고 **아무 일도 없을 때만**" 내려놓는다는 것이 이 정리를 자동화해도 되는 근거다.
   *  · active 에이전트 — 지금 돌고 있는 세션
   *  · 대기 명령 — 곧 돌 세션(비워지기 전에 내리면 그 명령이 갈 곳을 잃는다)
   *  · 살아 있는 dev server(iframe 위성) — §7.11 "명시 stop 전까지 살아있다"
   *  · running 플레이 버블(§5.14) — 우리가 띄운 프로세스가 물려 있다
   */
  hasRunningWork(): boolean {
    if (this.getActiveAgentCount() > 0) return true;
    for (const [sessionId, cmds] of this.commandQueuesRef) {
      if (cmds.length > 0 && this.agents.has(sessionId)) return true;
    }
    for (const agent of this.agents.values()) {
      if (agent.persistSatellites?.some((sat) => sat.bubbleType === 'iframe' && sat.iframeAlive === true)) return true;
    }
    for (const bubble of this.playBubbles.values()) {
      if (bubble.status === 'running') return true;
    }
    return false;
  }

  /**
   * §9 배경 탭 유휴 해제 — 이 인스턴스에서 **가장 최근에 무언가 일어난 시각**(epoch ms).
   * 기록이 하나도 없으면 0(= 아주 오래됨)을 돌려준다. 판정은 호출자 몫.
   */
  getLastActivityAt(): number {
    let last = 0;
    for (const agent of this.agents.values()) {
      const at = agent.lastActivity ?? 0;
      if (at > last) last = at;
    }
    for (const node of this.nodes.values()) {
      const at = node.lastActivity ?? 0;
      if (at > last) last = at;
    }
    return last;
  }

  /**
   * §9 — 이 인스턴스의 활성 에이전트 수. **구독 범위 밖 프로젝트도 세어야** 헤더의 "지금 몇 개
   * 돌고 있나"가 줄지 않는다. 판정은 `getSnapshot()` 의 `activeCount` 와 같은 기준
   * (살아 있음 · 숨김 아님 · 파이프라인 자식 아님 · active · 휴지통 아님).
   */
  getActiveAgentCount(): number {
    let count = 0;
    for (const [sessionId, agent] of this.agents) {
      if (!this.isAlive(agent) || this.isAgentHidden(sessionId) || agent.pipelineParentId) continue;
      if (agent.status === 'active' && !agent.trashed) count += 1;
    }
    return count;
  }

  /**
   * §9 탭·헤더 배지의 SSOT — 프로젝트별 에이전트/세션 집계.
   *
   * **휴지통은 세지 않는다.** 캔버스가 `trashed` 버블을 숨기므로(BubbleMap), 숫자에만 남으면
   * "에이전트 20개 중 1개 실행 중"처럼 화면 어디에도 없는 20 이 나온다(사용자 보고).
   *
   * **`sessions`/`running` 은 세션 축**이다. 사용자가 "동작 중"으로 세는 단위는 버블이 아니라
   * 세션이라(한 커스텀 에이전트가 세션 다섯을 동시에 돌린다) 버블 축 `active` 만으로는
   * 실제로 도는 수를 영영 못 보여준다. 판정은 공용 `isSessionRunning` 하나로 클라와 맞춘다.
   */
  getAgentCountsByProject(): Record<string, ProjectAgentCounts> {
    const runningTasksAll = subAgentManager.getRunningSubagentTasks();
    const result: Record<string, ProjectAgentCounts> = {};
    for (const [sessionId, agent] of this.agents) {
      if (!this.isAlive(agent) || this.isAgentHidden(sessionId) || agent.pipelineParentId) continue;
      if (agent.trashed) continue;
      const cwd = this.sessionCwds.get(sessionId);
      if (cwd === undefined) continue;
      const proj = this.getProjectForCwd(cwd);
      const name = proj?.name ?? (path.basename(cwd) || 'unknown');
      const bucket = result[name] ?? (result[name] = { total: 0, active: 0, completed: 0, sessions: 0, running: 0 });
      bucket.total += 1;
      if (agent.status === 'active') bucket.active += 1;
      else if (agent.status === 'completed') bucket.completed += 1;

      // 세션 축 — 버블이 도는 것으로 보이는 창(권한 대기·자식 Task 대기)에는 세션이 조용해도
      //   사용자에게는 "하나가 도는 중"이므로 최소 1 을 보장한다.
      const bubbleRunning = agent.status === 'active' || agent.status === 'awaiting_permission';
      const subs = subAgentManager.getAllSubs(agent.id);
      const cmds = this.commandQueuesRef.get(sessionId) ?? [];
      const tasks = runningTasksAll?.[agent.id] ?? [];
      const sessionRunning = subs.map((sub) => isSessionRunning({
        subStatus: sub.status,
        hasExecutingCommand: cmds.some((c) => c.status === 'executing' && c.subAgentId === sub.id),
        runningTaskCount: tasks.filter((t) => t.subAgentId === sub.id).length,
        hasQueuedCommand: false,
        acknowledged: false,
      }));
      const share = agentBadgeShare({ bubbleRunning, sessionRunning });
      bucket.sessions += share.sessions;
      bucket.running += share.running;
    }
    return result;
  }

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

  /** §5.5 #17-28 — agentId → 그 에이전트 세션이 실제로 도는 폴더. 못 찾으면 null. */
  getAgentCwdByAgentId(agentId: string): string | null {
    for (const [sessionId, cwd] of this.sessionCwds) {
      const agent = this.agents.get(sessionId);
      if (agent?.id === agentId) return cwd || null;
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

  /**
   * §5.10 v3.49 — 이 에이전트가 참조한 "파일처럼 보이는" 노드 경로들(피드 related 랭킹 ctx.files 용, best-effort).
   * nodeAgentRefs(노드→에이전트) 역방향에서 이 에이전트가 있는 키를 모아, worktree prefix 를 벗기고
   * 확장자가 있는(=파일) 것만 반환한다. 폴더/합성 키는 제외. read-only — 스냅샷/체크포인트 무관.
   */
  getFileRefsForAgent(agentId: string, limit = 12): string[] {
    const out: string[] = [];
    for (const [nodePath, refs] of this.nodeAgentRefs) {
      if (!refs.has(agentId)) continue;
      const stripped = nodePath.replace(/^wt[0-9a-z]+__/, '');
      // 확장자가 있는 것만 파일로 간주(폴더/root 합성 키 배제).
      if (!/\.[a-z0-9]+$/i.test(stripped)) continue;
      out.push(stripped);
      if (out.length >= limit) break;
    }
    return out;
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
    // §3.6 v4.89 — 실패한 도구도 **끝난 도구**다. `PostToolUseFailure` 를 사후로 안 세면
    //   같은 tool_use_id 로 사전 엔트리가 한 번 더 만들어져 히스토리에 중복으로 남는다.
    const isPost = payload.hook_event_name === 'PostToolUse'
      || payload.hook_event_name === 'PostToolUseFailure';
    const toolUseId = payload.tool_use_id;

    if (isPost) {
      const output = extractBashOutput(payload.tool_response);
      // PostToolUse → 기존 엔트리에 output 매칭
      if (toolUseId) {
        const existing = this.bashEntryIndex.get(toolUseId);
        if (existing) {
          existing.output = output;
        }
      }
      // run_in_background 응답에서 shell_id + output 경로 파싱 → 파일 감시 시작
      if (payload.tool_input['run_in_background'] === true) {
        this.attachBackgroundShell(payload);
      }
      // §7.11 — 끝난 Bash 의 명령어·출력에 찍힌 루프백 주소도 훑는다(background 밖의 서버 회수).
      this.sniffLoopbackServers(payload, output);
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

  /**
   * §7.11 감지 폴백 확장 — **끝난 Bash 의 명령어와 출력에 찍힌 루프백 주소**로 프리뷰를 만든다.
   *
   * 종전 감지는 `run_in_background: true` 한 갈래에서만 출발했다. 그래서 에이전트가
   * **이미 떠 있던 서버를 그대로 쓴 경우**(사용자 보고: "Vite 는 이미 떠 있던 것을 그대로
   * 썼습니다 — 새로 띄우지 않았습니다")에는 붙을 셸이 없어 프리뷰가 영영 안 생겼다. 그런데
   * 그런 세션에도 단서는 넘친다 — 에이전트는 살아있는지 확인하려고 그 주소를 반드시 한 번은
   * 친다(`curl http://localhost:8080`). **그 주소야말로 "방금 응답한 것을 확인한 서버"** 다.
   *
   * 그래서 v2.20 의 probe 명령 제외(`isProbeCommand`)를 여기에는 적용하지 않는다 — 그 가드는
   * "이 **셸**을 서버로 등록하지 마라"는 뜻이지 "이 **주소**는 서버가 아니다"가 아니기 때문이다.
   * 대신 여기서는 위성만 만들고 `registerServerPort`(셸=서버 등록)는 하지 않는다. 기동 명령을
   * 모르니 ServerEntry 는 `ensureReportedServerEntry` 의 "신고 전용"(Restart 불가, Stop 가능)
   * 자리로 등록한다 — 나중에 진짜 셸이 같은 포트를 잡으면 v3.85 승격 경로가 덮어쓴다.
   *
   * 오탐은 세 문으로 막는다: ① 우리 자신의 포트 제외(에이전트는 카드 엔드포인트를 계속 친다)
   * ② `isPortAlive` + `resolveServingUrl` 실응답 게이트 ③ (세션,포트)당 TTL probe 문.
   * 사용자가 지운 프리뷰는 되살리지 않는다(`fromNewBash=false` → `dismissedIframes` 존중).
   */
  private sniffLoopbackServers(payload: HookEventPayload, output: string): void {
    const sessionId = payload.session_id;
    if (!this.agents.has(sessionId)) return;
    const command = typeof payload.tool_input?.['command'] === 'string' ? payload.tool_input['command'] : '';
    // 우리 자신을 띄우는 명령(runapp 등)이 연 포트는 사용자의 서버가 아니다.
    if (isVibisualLauncherCommand(command)) return;

    // 출력이 먼저다 — 명령어에 적힌 주소보다 "실제로 응답을 받아 찍힌 주소"가 더 믿을 만하다.
    const candidates = [
      ...extractLoopbackUrls(stripAnsi(output), LOOPBACK_SNIFF_URLS_PER_BASH),
      ...extractLoopbackUrls(command, LOOPBACK_SNIFF_URLS_PER_BASH),
    ];
    if (candidates.length === 0) return;

    const now = Date.now();
    let picked = 0;
    const seenPorts = new Set<number>();
    for (const rawUrl of candidates) {
      if (picked >= LOOPBACK_SNIFF_URLS_PER_BASH) break;
      const parsed = parseLoopbackUrl(rawUrl);
      if (!parsed) continue;
      const { port } = parsed;
      if (seenPorts.has(port)) continue;
      seenPorts.add(port);
      if (isVibisualOwnPort(port)) continue;

      // (세션,포트) TTL 문 — 에이전트는 Bash 를 수백 번 돌린다. 이 문이 없으면 같은 주소에
      // 매번 TCP+HTTP probe 를 날려 세션이 길수록 조용히 느려진다.
      const gateKey = `${sessionId}|${String(port)}`;
      const last = this.loopbackSniffProbedAt.get(gateKey);
      if (last !== undefined && now - last < LOOPBACK_SNIFF_PROBE_TTL_MS) continue;
      this.loopbackSniffProbedAt.set(gateKey, now);
      capMapSize(this.loopbackSniffProbedAt, SESSION_KEYED_MAP_MAX);
      picked += 1;

      void isPortAlive(port).then(async (alive) => {
        if (!alive || !this.agents.has(sessionId)) return;
        const servingUrl = await resolveServingUrl(rawUrl);
        if (!servingUrl || !this.agents.has(sessionId)) return;
        // fromNewBash=false — 이건 "새로 띄웠다"는 신호가 아니라 "여기 서버가 있더라"는 관찰이다.
        // 사용자가 지운 프리뷰가 그 다음 curl 한 번에 되살아나면 지운 의미가 없다.
        this.createIframeSatellite(sessionId, command, port, undefined, output || undefined, false, servingUrl);
        this.ensureReportedServerEntry(sessionId, servingUrl, port);
        this.onSnapshotChange?.();
      }).catch(() => { /* probe 실패 — 표시 전용이라 조용히 무시 */ });
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

    // §7.11 v3.85 — 같은 포트의 "신고 전용"(명령 미상) entry 가 있으면 진짜 명령으로 승격한다.
    // 신고가 먼저 오고 watcher 가 나중에 그 서버를 잡는 순서에서 포트당 entry 가 2개로 갈라지는 것을 막는다.
    const promoted = this.promoteReportedServerEntry(command, port, shellId, outputFile);
    if (promoted) return false;

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
   * §7.11 v3.85 — 에이전트 신고로 만들어진 iframe 위성에 짝이 되는 ServerEntry 를 보장한다.
   * 이미 그 포트의 entry 가 있으면(감지 경로가 먼저 잡은 진짜 entry) 아무것도 하지 않는다 —
   * 포트당 1행(§7.11 v2.1) 을 지켜야 ServerList 에 같은 서버가 두 번 뜨지 않는다.
   * 기동 명령은 알 수 없으므로 `reportedOnly` 로 표시하고 `command` 에는 표시용 URL 을 넣는다.
   */
  private ensureReportedServerEntry(sessionId: string, url: string, port: number): void {
    for (const entries of this.runningServers.values()) {
      if (entries.some((e) => e.port === port)) return;
    }
    let servers = this.runningServers.get(sessionId);
    if (!servers) { servers = []; this.runningServers.set(sessionId, servers); }
    servers.push({
      id: `report-${hashString(`${sessionId}#${port}`)}__p${port}`,
      command: url,
      port,
      startedAt: Date.now(),
      alive: true,
      reportedOnly: true,
    });
    this.bumpMutationVersion();
    logger.info(`Server registered from agent report (port ${port}): ${url.slice(0, 80)}`);
  }

  /**
   * §7.11 v3.85 — 같은 포트의 `reportedOnly` entry 를 실제 감지된 명령으로 승격한다.
   * @returns 승격했으면 true(= 호출자는 새 entry 를 만들지 않는다).
   */
  private promoteReportedServerEntry(
    command: string,
    port: number,
    shellId: string | undefined,
    outputFile: string | undefined,
  ): boolean {
    for (const entries of this.runningServers.values()) {
      const reported = entries.find((e) => e.port === port && e.reportedOnly === true);
      if (!reported) continue;
      reported.command = command;
      if (shellId) reported.shellId = shellId;
      if (outputFile) reported.outputFile = outputFile;
      reported.alive = true;
      reported.reportedOnly = undefined;
      this.bumpMutationVersion();
      logger.info(`Server entry promoted (port ${port}): "${command.slice(0, 80)}"`);
      return true;
    }
    return false;
  }

  /**
   * §7.11 v2.29 — 에이전트가 `POST /api/agent-iframe` 로 신고한 서버 URL 로 iframe 위성을 직접 생성한다.
   * 명령어·로그 정규식 추측 없이 결정론적(신고 = 주 경로). "진짜 서버만" 원칙: isPortAlive 로 listen 이
   * 확인된 뒤에만 위성을 만들고(살아있는 서버만), 신고가 accept 보다 살짝 빠른 boot race 는 몇 차례 재시도로
   * 흡수한다. "중첩 금지": createIframeSatellite 의 (세션,포트) 키 + dedupeIframeSatellitesByUrl 포트 정규화가
   * 같은 서버 재신고·감지 폴백을 하나로 합류시킨다.
   * @returns agentId→세션 해석 + URL 파싱이 성립하면 true(위성 자체는 probe 통과 후 async 생성).
   */
  reportIframeFromAgent(agentId: string, rawUrl: string): boolean {
    const sessionId = this.findSessionByAgentId(agentId);
    if (!sessionId) return false;
    let parsed: URL;
    try { parsed = new URL(rawUrl); } catch { return false; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const port = parsed.port
      ? parseInt(parsed.port, 10)
      : (parsed.protocol === 'https:' ? 443 : 80);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return false;

    const tryCreate = (retriesLeft: number): void => {
      void isPortAlive(port).then(async (alive) => {
        // await 중 세션이 사라졌을 수 있어 재확인
        if (!this.agents.has(sessionId)) return;
        // 포트 listen 만으론 부족 — 신고된 정확한 URL 이 실제로 비-에러 응답(2xx/3xx)을
        // 주는지까지 확인한다. `python -m http.server` 처럼 포트는 살아있어도 그 경로가
        // 404 면 위성을 만들지 않는다(사용자 보고: "iframe 접속도 안 되는데 왜 켜지냐").
        // 그리고 **접속되는 이름**으로 바꿔 가며 묻는다 — `127.0.0.1` 로 신고됐는데 서버가
        // IPv6(`::1`) 에만 바인딩된 경우(Windows 의 Vite 가 그렇다) 한 이름만 묻고 접으면
        // 살아있는 서버를 죽었다고 판정한다. 응답한 그 주소를 그대로 위성에 실어, 확인한
        // 주소와 화면에 여는 주소가 갈리지 않게 한다.
        const servingUrl = alive ? await resolveServingUrl(rawUrl) : null;
        if (!this.agents.has(sessionId)) return; // HTTP probe await 사이 재확인
        if (servingUrl) {
          this.createIframeSatellite(sessionId, servingUrl, port, undefined, undefined, true, servingUrl);
          // §7.11 v3.85 — 위성만 만들고 끝내면 매칭 ServerEntry 가 없어 IframeServerCard 의
          // Restart/Stop 이 통째로 disabled 된다(v2.21 strict 1:1 의 반대 방향 orphan).
          this.ensureReportedServerEntry(sessionId, servingUrl, port);
          this.onSnapshotChange?.();
        } else if (retriesLeft > 0) {
          setTimeout(() => tryCreate(retriesLeft - 1), 1500);
        } else {
          const why = alive ? `url 404/에러 응답` : `port ${port} not alive`;
          logger.info(`agent-iframe: ${why} — 위성 생성 보류 (${rawUrl.slice(0, 80)})`);
        }
      }).catch(() => { /* probe 실패 — 조용히 무시 */ });
    };
    tryCreate(3);
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
    /** §7.11 v2.29 — 에이전트가 신고한 정확한 URL(경로·쿼리 포함). 있으면 기본 `http://localhost:{port}`
     *  대신 이 값을 위성 url 로 쓴다(사용자가 원하던 바로 그 페이지가 프리뷰로 열리게). */
    displayUrl?: string,
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
      // §7.11 v2.29 — 에이전트가 명시 URL(경로 포함)을 신고했으면 표시 URL 을 그걸로 갱신한다.
      //   감지 폴백이 먼저 `http://localhost:{port}`(경로 없음)로 만들었어도, 신고가 오면
      //   사용자가 원하던 바로 그 페이지(예: /mirror-engine-autoplay.html)로 덮어써 프리뷰가 맞게 열린다.
      if (displayUrl) existing.url = displayUrl;
      // 같은 URL을 가진 다른 에이전트의 오래된 iframe은 제거 (이 에이전트로 이동)
      if (existing.url) this.dedupeIframeSatellitesByUrl(existing.url, sessionId);
      return;
    }

    const kind = detectServerKind(command, logText);
    const url = displayUrl ?? `http://localhost:${port}`;

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
    // §7.11 v2.29 — 매칭을 **포트 정규화**로 한다(문자열 정확일치 ❌). 신고 경로는 `http://127.0.0.1:8777/page.html`,
    //   감지 폴백은 `http://localhost:8777`(경로 없음)처럼 같은 서버를 다른 문자열로 만든다 — exact 비교면
    //   둘이 안 합쳐져 **중첩 버블**이 생긴다. 한 ProjectGraph(=한 프로젝트) 안에서 포트는 서버 1개를 유일하게
    //   가리키므로 포트로 접으면 host alias·경로차와 무관하게 하나로 합류한다.
    const wantedPort = iframePortKey(url);
    if (wantedPort === null) return;
    // 대상 수집 — (sessionId, index, lastActivity)
    const candidates: { sessionId: string; index: number; lastActivity: number }[] = [];
    for (const [sid, agent] of this.agents) {
      if (!agent.persistSatellites) continue;
      agent.persistSatellites.forEach((sat, idx) => {
        if (sat.bubbleType === 'iframe' && iframePortKey(sat.url) === wantedPort) {
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
   *
   * v3.69: 그 집합을 sessionCwds **+ 워커 세션**(workerSessionsByOwner) 에서 빌드한다 —
   * 커스텀 에이전트의 셸 JSONL 은 워커 세션 이름으로만 존재하기 때문. 아래 상세 주석 참조.
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
    // 훑는 대상이 자기 소유 세션으로 한정되므로 다른 프로젝트 세션의 셸은 절대 들어오지 않음(§3.5).
    //
    // §7.11 v3.69 — 스캔 대상 = sessionCwds + workerSessionsByOwner 의 워커 세션.
    //   커스텀 에이전트는 sessionCwds 에 커스텀 키(`custom-…`)로 저장되는데 background shell 의
    //   JSONL 은 **워커 세션 이름**으로 디스크에 있다. 워커를 빼고 sessionCwds 만 훑으면
    //   `getSessionJsonlPath(cwd, 'custom-…')` 파일이 아예 없어 매번 skip → 집합이 **항상 빈 채**로
    //   남고 shellOk 가 영원히 false → 포트가 살아 있어도 dim 후 60초 grace 로 자동 제거된다
    //   (= 커스텀 에이전트가 띄운 dev server 는 예외 없이 꺼짐).
    //   위성 **생성** 경로인 rehydrateBackgroundShells 는 이미 워커 세션을 훑고 있었다 —
    //   생성과 생사확인의 스캔 대상은 반드시 같이 움직여야 한다(한쪽만 바꾸면 이 버그가 재발).
    const scanTargets = new Map<string, string>(); // 세션id → 그 세션의 cwd
    for (const [sid, cwd] of this.sessionCwds) {
      scanTargets.set(sid, cwd);
      const mapped = this.workerSessionsByOwner.get(sid);
      if (mapped) for (const [ws, wcwd] of mapped) scanTargets.set(ws, wcwd || cwd);
    }

    const activeShellIds = new Set<string>();
    for (const [sid, cwd] of scanTargets) {
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
   * `routeToolFilePath` 의 **세 갈래를 모두** 미러한다 —
   *   ① internal: 파일의 owning project 기준 상대경로(+ worktree namespace prefix, processInternalFile)
   *   ② external: 어느 프로젝트에도 없는 파일 → `__ext__<부모폴더>/<파일명>` (processExternalFile)
   *   ③ 워크트리 home 세션이 다른 프로젝트 파일을 만진 경우 → ② 에 워크트리 prefix
   * recordFileEdit 가 키를 따로 계산해서 scan(`manual`) 노드/워크트리 노드/외부 위성과 키가
   * 어긋나 diff 가 안 붙던 문제 차단.
   */
  private canonicalFileKey(absPath: string, sessionCwd?: string): string {
    const norm = normalize(absPath);
    const sessionProject = sessionCwd ? this.projects.get(normalize(sessionCwd)) ?? null : null;
    const isHomeWorktree = !!sessionProject?.parentProjectPath;
    const fileProject = this.getProjectForCwd(norm);

    // 라우팅(routeToolFilePath)의 갈림을 **그대로** 따라간다.
    //  - 파일이 어느 등록 프로젝트에도 없다 → external
    //  - 워크트리 home 세션이 **다른** 프로젝트 파일을 만졌다(= 내 워크트리에서 외부) → external
    // 이 두 갈래를 안 따라가면 노드 키는 `__ext__…` 인데 diff 키는 절대경로라 서로 못 만난다 —
    // 파일 버블은 떠 있는데 내용이 비고(buildFileEditsRecord 의 node 조회 실패),
    // toProjectCheckpoint 의 노드 필터에서도 통째로 버려져 껐다 켜면 흔적조차 없다.
    const routedExternal = !fileProject
      || (isHomeWorktree && fileProject.path !== sessionProject!.path);

    if (fileProject && !routedExternal) {
      const rel = this.toRelative(norm, fileProject.path);
      if (rel) {
        // worktree 파일은 부모와 격리하는 네임스페이스 prefix (processInternalFile 5197행과 동일 규칙)
        if (fileProject.parentProjectPath) {
          return `wt${hashString(normalize(fileProject.path)).toString(36)}__${rel}`;
        }
        return rel;
      }
    }

    const wtPrefix = isHomeWorktree
      ? `wt${hashString(normalize(sessionProject!.path)).toString(36)}__`
      : '';
    return this.externalFileNodeKey(norm, wtPrefix);
  }

  /**
   * 외부 파일의 **직속 부모 폴더** 절대경로 (§2.1 v1.55 평탄화 규칙).
   * `processExternalFile` 과 `canonicalFileKey` 가 이 한 곳을 공유한다 — 규칙이 두 벌이 되면
   * 한쪽만 고쳐져 파일 버블 키와 diff 키가 어긋난다.
   */
  private externalParentFolder(normAbs: string): string {
    const folderAbs = path.dirname(normAbs).replace(/\\/g, '/');
    // 의미있는 부모 없음 → 경로 자체를 폴더로 폴백
    if (!folderAbs || folderAbs === '.' || folderAbs === '/') return normAbs;
    return folderAbs;
  }

  /** 외부 파일 위성의 노드 키 — `registerExternalSatellite` 가 실제로 쓰는 키와 같아야 한다. */
  private externalFileNodeKey(normAbs: string, wtPrefix = ''): string {
    return `${wtPrefix}__ext__${this.externalParentFolder(normAbs)}/${path.basename(normAbs)}`;
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
    // 라우팅과 **같은** 세션 cwd 를 쓴다(routeToolFilePath 와 동일 — payload.cwd 폴백 ❌).
    const key = this.canonicalFileKey(absPath, this.sessionCwds.get(payload.session_id));

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

    // 노드별 unlimitedFileEdits=true 면 사용자가 "이 파일은 다 남겨라"를 명시한 것이므로
    // 아래 세 축(병합창·나이·경로 LRU) 전부에서 제외한다 — 상한이 사용자 지정을 뒤집으면 안 된다.
    const fileNode = this.nodes.get(key);
    const unlimited = fileNode?.unlimitedFileEdits === true;
    const retention = appStateGetRetention();

    // ─── D축 병합창 (§3.2.3) ───
    // 같은 파일을 병합창 안에서 연달아 고치면 마지막 항목에 합친다(VS Code `mergeWindow` 와 같은 뜻).
    // 에이전트는 한 파일을 연속 수정하는 일이 잦아, 이게 없으면 MAX_FILE_EDITS(20)가 한 턴 만에 차서
    // 그 파일의 이력이 통째로 밀려난다. 합칠 때 **oldString 은 처음 것을 유지**해야 diff 가
    // "그 창 전체의 변화"를 가리킨다.
    // ⚠ head 를 **제자리 수정하지 않고 새 객체로 교체**한다 — `fileEditsViewCache` 가
    //   (length, head 참조) 로 "안 바뀐 파일"을 판정하므로, 제자리 수정하면 스냅샷이 옛 내용을
    //   그대로 재사용해 화면이 갱신되지 않는다(§9 v3.89 메모의 "엔트리는 불변" 전제).
    const head = list[0];
    const withinMergeWindow =
      !unlimited
      && retention.fileEditMergeWindowMs > 0
      && head !== undefined
      && head.filePath === entry.filePath
      && entry.timestamp - head.timestamp <= retention.fileEditMergeWindowMs;

    if (withinMergeWindow && head) {
      list[0] = { ...head, newString: entry.newString, timestamp: entry.timestamp };
    } else {
      list.unshift(entry);
    }

    // B축 — 파일당 항목 수 (기존 동작 그대로)
    if (!unlimited && list.length > MAX_FILE_EDITS) {
      list.length = MAX_FILE_EDITS;
    }
    // A축 — 이 파일의 오래된 편집 정리(리스트가 ≤20건이라 뜨거운 경로에서도 싸다)
    if (!unlimited) this.pruneFileEditListByAge(key, list, retention.fileEditRetentionDays);
    // E축 — 편집 이력을 든 **경로 키 개수** 상한(우리에게 없던 축 — 597개까지 늘었던 자리)
    this.enforceFileEditPathCap(retention.maxFileEditPaths);

    logger.debug(`Recorded file ${tool.toLowerCase()}: ${key} (${list.length} total${withinMergeWindow ? ', merged' : ''})`);
  }

  /**
   * A축 — 한 파일의 편집 이력에서 보존 기간이 지난 것을 버린다(§3.2.3).
   * 리스트는 최신순(`unshift`)이라 **뒤에서부터** 자르면 된다. 전부 만료면 키 자체를 지운다
   * (빈 배열을 남기면 E축 경로 상한에 헛자리로 잡힌다).
   */
  private pruneFileEditListByAge(key: string, list: FileEdit[], days: number): void {
    if (days <= 0 || list.length === 0) return; // 0 = 무제한
    let keep = list.length;
    while (keep > 0 && isExpiredByDays(list[keep - 1]?.timestamp ?? 0, days)) keep -= 1;
    if (keep === list.length) return;
    if (keep === 0) this.fileEdits.delete(key);
    else list.length = keep;
  }

  /**
   * E축 — 편집 이력을 들고 있는 **파일 경로 키 개수** 상한. 마지막 편집이 가장 오래된 경로부터 버린다(LRU).
   *
   * 종전에 `fileEdits.delete` 는 소스에 존재조차 하지 않았고, 유일한 방벽이던 "노드 살아있는 경로만
   * 저장"(v4.67 필터)은 `pruneExpired()` 가 비활성이라 걸러 낼 대상이 안 생겼다 — 그래서 597키까지 늘었다.
   */
  private enforceFileEditPathCap(maxPaths: number): void {
    if (maxPaths <= 0 || this.fileEdits.size <= maxPaths) return; // 0 = 무제한
    const candidates: { key: string; lastAt: number }[] = [];
    for (const [k, edits] of this.fileEdits) {
      if (this.nodes.get(k)?.unlimitedFileEdits) continue; // 사용자 명시 보존은 건드리지 않는다
      candidates.push({ key: k, lastAt: edits[0]?.timestamp ?? 0 });
    }
    const overflow = this.fileEdits.size - maxPaths;
    if (overflow <= 0 || candidates.length === 0) return;
    candidates.sort((a, b) => a.lastAt - b.lastAt); // 오래된 것 먼저
    for (let i = 0; i < Math.min(overflow, candidates.length); i += 1) {
      this.fileEdits.delete(candidates[i]?.key ?? '');
    }
  }

  /**
   * §3.2.3 — 편집 이력 전체 정리. **부팅 시 1회 + 보존 설정 변경 시** 호출한다.
   *
   * `recordFileEdit` 경로는 "방금 손댄 파일"만 늙히므로, 한동안 건드리지 않은 경로는 여기서만 정리된다.
   * 반환값은 저장소 사용량 화면이 "얼마나 회수했는지" 그대로 보여 주는 데 쓴다(조용히 지우지 않는다).
   */
  pruneFileEditRetention(): { removedEdits: number; removedPaths: number } {
    const retention = appStateGetRetention();
    let removedEdits = 0;
    let removedPaths = 0;

    if (retention.fileEditRetentionDays > 0) {
      for (const [k, list] of Array.from(this.fileEdits)) {
        if (this.nodes.get(k)?.unlimitedFileEdits) continue;
        const before = list.length;
        this.pruneFileEditListByAge(k, list, retention.fileEditRetentionDays);
        const after = this.fileEdits.has(k) ? list.length : 0;
        removedEdits += before - after;
        if (!this.fileEdits.has(k)) removedPaths += 1;
      }
    }

    const beforePaths = this.fileEdits.size;
    this.enforceFileEditPathCap(retention.maxFileEditPaths);
    removedPaths += beforePaths - this.fileEdits.size;

    // ⚠ 내부 Map 을 직접 건드렸으므로 스냅샷 캐시를 무효화해야 화면·테스트에 반영된다
    //   (mutationVersion 누락 = "고쳤는데 안 보인다"로 오진하는 자리).
    if (removedEdits > 0 || removedPaths > 0) {
      this.bumpMutationVersion();
      logger.info(`fileEdits retention: removed ${removedEdits} edit(s), ${removedPaths} path(s) — ${this.fileEdits.size} path(s) remain`);
    }
    return { removedEdits, removedPaths };
  }

  /**
   * §9 v3.89 — 파일별 보정 결과 메모. 키는 원본 배열 자체(WeakMap → 파일이 사라지면 함께 수거).
   *
   * 종전엔 스냅샷 재구축마다 **모든 파일의 모든 edit 을 새 객체로 다시 만들었다**. 실측 저장소
   * 기준 1,194건·2.2MB 를 매번 다시 할당·복사한 셈이고, 이건 편집한 파일이 쌓일수록 무거워진다.
   * edit 엔트리는 만들어진 뒤 바뀌지 않고, 리스트는 **앞에 추가(unshift) + 뒤 잘라내기**만 하므로
   * (길이, 첫 원소) 가 그대로면 내용도 그대로다 — 그때는 지난 배열을 그대로 재사용한다.
   * 참조가 유지되므로 스냅샷 소비자(클라 structuralShare)도 "안 바뀐 파일"을 알아본다.
   */
  private fileEditsViewCache = new WeakMap<
    FileEdit[],
    { len: number; head: FileEdit | undefined; absPath: string; out: FileEdit[] }
  >();

  /** 파일별 edit history → file node ID 기준 Record */
  private buildFileEditsRecord(): Record<string, FileEdit[]> {
    const result: Record<string, FileEdit[]> = {};
    for (const [relPath, edits] of this.fileEdits) {
      const node = this.nodes.get(relPath);
      if (!node) continue;
      // filePath 누락된 기존 엔트리 보정 (root + 상대경로).
      // 외부 위성 키는 그 자체가 절대경로를 품고 있어(`[wt…]__ext__<abs>`) root 를 앞에 붙이면
      // 존재하지 않는 경로가 된다 — 접두사를 걷어 낸 뒤쪽이 곧 절대경로다.
      const extAt = relPath.indexOf('__ext__');
      const absPath = extAt >= 0
        ? relPath.slice(extAt + '__ext__'.length)
        : this.root ? `${this.root}/${relPath}` : relPath;
      const memo = this.fileEditsViewCache.get(edits);
      if (
        memo !== undefined &&
        memo.len === edits.length &&
        memo.head === edits[0] &&
        memo.absPath === absPath
      ) {
        result[node.id] = memo.out;
        continue;
      }
      const out = edits.map((e) => ({
        ...e,
        filePath: e.filePath || absPath,
      }));
      this.fileEditsViewCache.set(edits, { len: edits.length, head: edits[0], absPath, out });
      result[node.id] = out;
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
      // §5.10 — 휴지통 에이전트는 활성 참조로 치지 않는다.
      if (agent.trashed) continue;
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
    const normFolder = ProjectGraph.isRootKey(folderPath) ? folderPath : foldCase(folderPath);
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
    const key = foldCase(nodePath);
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
    const folderAbs = isDirectory ? normAbs : this.externalParentFolder(normAbs);

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
      // 키 산출은 canonicalFileKey 와 같은 헬퍼로 — 두 벌이 되면 diff 가 이 버블에 안 붙는다.
      const fileKey = this.externalFileNodeKey(normAbs, wtPrefix);
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

  // ─── §5.5 #17-20 ⑩ v4.94 공통 디버그 층 — 중단점 ─────────────────────────

  /** 이 프로젝트에 찍힌 중단점(없으면 빈 배열). */
  getDebugBreakpoints(projectName: string): DebugBreakpoint[] {
    return [...(this.debugBreakpoints.get(projectName) ?? [])];
  }

  /**
   * 중단점 **전량 교체**. 화면이 한 줄을 토글할 때마다 그 프로젝트의 목록 전체를 보낸다 —
   * DAP `setBreakpoints` 가 파일 단위 전량 교체라 축을 맞춰 두면 어긋날 일이 없다.
   */
  setDebugBreakpoints(projectName: string, breakpoints: DebugBreakpoint[]): DebugBreakpoint[] {
    const normalized: DebugBreakpoint[] = breakpoints
      .filter((bp) => typeof bp?.file === 'string' && bp.file.length > 0 && Number.isFinite(bp.line) && bp.line > 0)
      .map((bp) => ({
        file: bp.file,
        line: Math.floor(bp.line),
        enabled: bp.enabled !== false,
        ...(bp.verified !== undefined ? { verified: bp.verified } : {}),
      }));
    if (normalized.length === 0) this.debugBreakpoints.delete(projectName);
    else this.debugBreakpoints.set(projectName, normalized);
    // Map 을 직접 건드렸으므로 스냅샷 캐시를 무효화한다(빠뜨리면 화면·테스트에 안 보인다).
    this.bumpMutationVersion();
    return normalized;
  }

  // ─── §5.9 화면/프로그램 캡처 버블 — 사용자 생성 독립 캔버스 요소 (CommentBox 패턴) ───

  /** 캡처 버블 생성. 서버에서 ID 발급. */
  // ─── §5.13 v4.45 내부 앱 버블 (범용) ───
  //
  // 앱마다 버블 타입을 새로 만들지 않는다 — `appId` 만 다른 같은 그릇이다. 앱을 계속
  // 늘리기로 한 이상, 앱 하나가 코어에 남기는 자국이 상수여야 한다.

  createAppBubble(input: {
    projectName: string;
    appId: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    title?: string;
    ref?: string;
  }): AppBubble {
    const id = `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const bubble: AppBubble = {
      id,
      projectName: input.projectName,
      appId: input.appId,
      x: input.x,
      y: input.y,
      width: input.width ?? 200,
      height: input.height ?? 200,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.ref === undefined ? {} : { ref: input.ref }),
      createdAt: Date.now(),
    };
    this.appBubbles.set(id, bubble);
    // Map 을 직접 만졌으므로 스냅샷 캐시(mutationVersion + 200ms TTL)를 무효화한다.
    // 빠뜨리면 생성 직후의 broadcastSnapshot 이 **버블 없는 캐시본**을 그대로 내보내,
    // 다음 활동이 있을 때까지 캔버스에 아무것도 안 뜬다.
    this.bumpMutationVersion();
    return bubble;
  }

  updateAppBubble(
    id: string,
    updates: Partial<Omit<AppBubble, 'id' | 'projectName' | 'appId' | 'createdAt'>>,
  ): AppBubble | null {
    const bubble = this.appBubbles.get(id);
    if (!bubble) return null;
    if (updates.x !== undefined) bubble.x = updates.x;
    if (updates.y !== undefined) bubble.y = updates.y;
    if (updates.width !== undefined) bubble.width = updates.width;
    if (updates.height !== undefined) bubble.height = updates.height;
    if (updates.title !== undefined) bubble.title = updates.title;
    if (updates.ref !== undefined) bubble.ref = updates.ref;
    if (updates.preservePinned !== undefined) bubble.preservePinned = updates.preservePinned;
    this.bumpMutationVersion();
    return bubble;
  }

  /** 삭제. 핀이 걸려 있으면 거절한다(§2.4 preserve-pin). */
  deleteAppBubble(id: string): boolean {
    const bubble = this.appBubbles.get(id);
    if (bubble?.preservePinned === true) return false;
    const removed = this.appBubbles.delete(id);
    if (removed) this.bumpMutationVersion();
    return removed;
  }

  getAppBubble(id: string): AppBubble | undefined {
    return this.appBubbles.get(id);
  }

  getAppBubbles(): AppBubble[] {
    return [...this.appBubbles.values()];
  }

  /** 기존 ID 그대로 수용 (체크포인트 복원/머지용). */
  acceptAppBubble(bubble: AppBubble): boolean {
    if (this.appBubbles.has(bubble.id)) return false;
    this.appBubbles.set(bubble.id, { ...bubble });
    this.bumpMutationVersion();
    return true;
  }

  createCaptureBubble(input: {
    projectName: string;
    x: number;
    y: number;
    width: number;
    height: number;
    sourceId: string;
    sourceName: string;
    sourceKind: CaptureBubble['sourceKind'];
  }): CaptureBubble {
    const id = `capture-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    const bubble: CaptureBubble = {
      id,
      projectName: input.projectName,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      sourceId: input.sourceId,
      sourceName: input.sourceName,
      sourceKind: input.sourceKind,
      createdAt: now,
      updatedAt: now,
    };
    this.captureBubbles.set(id, bubble);
    return bubble;
  }

  /** 캡처 버블 업데이트. 위치/크기/소스 등 부분 갱신. */
  updateCaptureBubble(
    id: string,
    updates: Partial<Omit<CaptureBubble, 'id' | 'projectName' | 'createdAt' | 'updatedAt'>>,
  ): CaptureBubble | null {
    const bubble = this.captureBubbles.get(id);
    if (!bubble) return null;
    if (updates.x !== undefined) bubble.x = updates.x;
    if (updates.y !== undefined) bubble.y = updates.y;
    if (updates.width !== undefined) bubble.width = updates.width;
    if (updates.height !== undefined) bubble.height = updates.height;
    if (updates.sourceId !== undefined) bubble.sourceId = updates.sourceId;
    if (updates.sourceName !== undefined) bubble.sourceName = updates.sourceName;
    if (updates.sourceKind !== undefined) bubble.sourceKind = updates.sourceKind;
    bubble.updatedAt = Date.now();
    return bubble;
  }

  /** 캡처 버블 삭제. */
  deleteCaptureBubble(id: string): boolean {
    return this.captureBubbles.delete(id);
  }

  /** 캡처 버블 단일 조회. */
  getCaptureBubble(id: string): CaptureBubble | undefined {
    return this.captureBubbles.get(id);
  }

  /** 이 인스턴스가 소유한 모든 캡처 버블 (스냅샷/체크포인트 공통). */
  getCaptureBubbles(): CaptureBubble[] {
    return [...this.captureBubbles.values()];
  }

  /** 기존 ID 그대로 수용 (체크포인트 복원/머지용). */
  acceptCaptureBubble(bubble: CaptureBubble): boolean {
    if (this.captureBubbles.has(bubble.id)) return false;
    this.captureBubbles.set(bubble.id, bubble);
    return true;
  }

  // ─── §5.14 v4.62 — 플레이 버블 ───

  createPlayBubble(input: {
    projectName: string;
    x: number;
    y: number;
    width: number;
    height: number;
    title?: string;
    recipe?: PlayRecipe;
  }): PlayBubble {
    const id = `play-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    const bubble: PlayBubble = {
      id,
      projectName: input.projectName,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.recipe !== undefined ? { recipe: input.recipe } : {}),
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    };
    this.playBubbles.set(id, bubble);
    this.bumpMutationVersion();
    return bubble;
  }

  /**
   * 플레이 버블 부분 갱신 — 좌표·크기·제목·레시피·실행 상태 전부 이 문 하나로 들어온다.
   *
   * `recipe` 는 통째로 교체한다(부분 병합 ❌ — 반쪽만 바뀐 레시피는 무엇이 실행될지 알 수 없다).
   */
  updatePlayBubble(
    id: string,
    updates: Partial<Omit<PlayBubble, 'id' | 'projectName' | 'createdAt' | 'updatedAt'>>,
  ): PlayBubble | null {
    const bubble = this.playBubbles.get(id);
    if (!bubble) return null;
    const writable = bubble as unknown as Record<string, unknown>;
    for (const key of [
      'x', 'y', 'width', 'height', 'previewX', 'previewY', 'previewWidth', 'previewHeight',
      'title', 'recipe', 'status', 'url', 'port', 'error', 'lastStartedAt', 'previewOpen', 'preservePinned',
      // §5.17 (C) — 이 목록에 없으면 값이 조용히 버려진다. 영속 자체는 레코드가 통째로 저장되므로
      //   여기 한 줄이 곧 "누가 만든 화면인지" 를 재시작 뒤에도 남기는 전부다.
      'ownerAgentId',
    ] as const) {
      if (!(key in updates)) continue;
      const value = updates[key];
      // `undefined` 를 그대로 대입하면 JSON 직렬화에서는 사라지지만 in-memory 에는 키가 남아
      // `'port' in bubble` 류 판정이 어긋난다 — 명시적으로 지운다.
      if (value === undefined) delete writable[key];
      else writable[key] = value;
    }
    bubble.updatedAt = Date.now();
    this.bumpMutationVersion();
    return bubble;
  }

  /** 삭제. §2.4 preserve-pin 이 걸려 있으면 거절한다(앱 버블과 같은 규칙). */
  deletePlayBubble(id: string): boolean {
    const bubble = this.playBubbles.get(id);
    if (!bubble) return false;
    if (bubble.preservePinned === true) return false;
    const removed = this.playBubbles.delete(id);
    if (removed) this.bumpMutationVersion();
    return removed;
  }

  getPlayBubble(id: string): PlayBubble | undefined {
    return this.playBubbles.get(id);
  }

  getPlayBubbles(): PlayBubble[] {
    return [...this.playBubbles.values()];
  }

  /** 기존 ID 그대로 수용 (체크포인트 복원/머지용). */
  acceptPlayBubble(bubble: PlayBubble): boolean {
    if (this.playBubbles.has(bubble.id)) return false;
    this.playBubbles.set(bubble.id, { ...bubble });
    this.bumpMutationVersion();
    return true;
  }

  // ─── §5.15 — 스펙 보드 ───

  createSpecDoc(input: {
    projectName: string;
    x: number;
    y: number;
    width: number;
    height: number;
    title?: string;
    body?: string;
    items?: string[];
  }): SpecDoc {
    this.specIdCounter += 1;
    const id = `spec-${Date.now().toString(36)}-${this.specIdCounter.toString(36)}-${idTail()}`;
    const now = Date.now();
    const doc: SpecDoc = {
      id,
      projectName: input.projectName,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      title: (input.title ?? '').slice(0, SPEC_TITLE_MAX),
      body: (input.body ?? '').slice(0, SPEC_BODY_MAX),
      items: (input.items ?? [])
        .slice(0, SPEC_MAX_ITEMS)
        .map((text) => this.newSpecItem(text)),
      bodyRevision: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.specDocs.set(id, doc);
    this.bumpMutationVersion();
    return doc;
  }

  /** 수용 기준 한 줄을 새 항목으로. id 는 여기서만 발급한다. */
  private newSpecItem(text: string): SpecItem {
    this.specIdCounter += 1;
    return {
      id: `sitem-${Date.now().toString(36)}-${this.specIdCounter.toString(36)}-${idTail()}`,
      text: text.slice(0, SPEC_ITEM_TEXT_MAX),
    };
  }

  /**
   * 스펙 부분 갱신 — 좌표·크기·제목·본문·항목 목록이 전부 이 문 하나로 들어온다.
   *
   * **개정 번호는 여기서만 오른다.** `body` 또는 항목 텍스트가 실제로 달라졌을 때만 +1 하고,
   * 좌표·크기·제목·`done` 토글은 올리지 않는다 — 그건 스펙 내용이 아니라서, 버블을 옮겼다는
   * 이유로 하위 작업 카드가 전부 "스펙 변경됨" 이 되면 그 배지는 아무 뜻도 없어진다.
   */
  updateSpecDoc(
    id: string,
    updates: Partial<Omit<SpecDoc, 'id' | 'projectName' | 'createdAt' | 'updatedAt' | 'bodyRevision'>>,
  ): SpecDoc | null {
    const doc = this.specDocs.get(id);
    if (!doc) return null;
    let contentChanged = false;

    for (const key of ['x', 'y', 'width', 'height'] as const) {
      const value = updates[key];
      if (typeof value === 'number') doc[key] = value;
    }
    if (typeof updates.title === 'string') doc.title = updates.title.slice(0, SPEC_TITLE_MAX);
    if (typeof updates.preservePinned === 'boolean') doc.preservePinned = updates.preservePinned;
    if (typeof updates.body === 'string') {
      const next = updates.body.slice(0, SPEC_BODY_MAX);
      if (next !== doc.body) contentChanged = true;
      doc.body = next;
    }
    if (Array.isArray(updates.items)) {
      const prevText = new Map(doc.items.map((it) => [it.id, it.text]));
      const next: SpecItem[] = [];
      for (const raw of updates.items.slice(0, SPEC_MAX_ITEMS)) {
        if (!raw || typeof raw.text !== 'string') continue;
        // id 가 없거나 모르는 항목이면 새로 발급 — 클라이언트가 id 를 지어내지 못하게 한다.
        const existing = typeof raw.id === 'string' ? doc.items.find((it) => it.id === raw.id) : undefined;
        const text = raw.text.slice(0, SPEC_ITEM_TEXT_MAX);
        if (!existing) {
          contentChanged = true;
          next.push({ ...this.newSpecItem(text), ...(raw.done === true ? { done: true } : {}) });
          continue;
        }
        if (prevText.get(existing.id) !== text) contentChanged = true;
        const merged: SpecItem = { ...existing, text };
        if (raw.done === true) merged.done = true;
        else delete merged.done;
        next.push(merged);
      }
      // 항목이 사라지는 것도 스펙 내용의 변경이다(남은 카드가 근거를 잃는다).
      if (next.length !== doc.items.length) contentChanged = true;
      doc.items = next;
    }

    if (contentChanged) doc.bodyRevision += 1;
    doc.updatedAt = Date.now();
    this.bumpMutationVersion();
    return doc;
  }

  /** 수용 기준 한 줄 추가. 내용 변경이므로 개정 번호가 오른다. */
  addSpecItem(id: string, text: string): SpecDoc | null {
    const doc = this.specDocs.get(id);
    if (!doc) return null;
    if (doc.items.length >= SPEC_MAX_ITEMS) return doc;
    doc.items.push(this.newSpecItem(text));
    doc.bodyRevision += 1;
    doc.updatedAt = Date.now();
    this.bumpMutationVersion();
    return doc;
  }

  /**
   * 한 항목에 작업 카드를 매단다. 카드를 만든 **그 시점의 개정 번호**를 함께 박아,
   * 이후 스펙이 바뀌면 두 숫자의 차이가 "스펙 변경됨" 의 근거가 된다.
   */
  attachSpecTask(specId: string, itemId: string, taskAgentId: string, taskSessionId: string): SpecItem | null {
    const doc = this.specDocs.get(specId);
    if (!doc) return null;
    const item = doc.items.find((it) => it.id === itemId);
    if (!item) return null;
    item.taskAgentId = taskAgentId;
    // 재확인(regenerate) 경로는 세션 키를 모른 채 들어올 수 있다 — 빈 값으로 덮지 않는다.
    if (taskSessionId) item.taskSessionId = taskSessionId;
    item.generatedRevision = doc.bodyRevision;
    doc.updatedAt = Date.now();
    this.bumpMutationVersion();
    return item;
  }

  /** 항목에서 카드 연결만 끊는다(에이전트 버블 자체는 건드리지 않는다 — 사용자 작업물). */
  detachSpecTask(specId: string, itemId: string): boolean {
    const doc = this.specDocs.get(specId);
    if (!doc) return false;
    const item = doc.items.find((it) => it.id === itemId);
    if (!item) return false;
    delete item.taskAgentId;
    delete item.taskSessionId;
    delete item.generatedRevision;
    doc.updatedAt = Date.now();
    this.bumpMutationVersion();
    return true;
  }

  /** 삭제. §2.4 preserve-pin 이 걸려 있으면 거절한다(플레이·앱 버블과 같은 규칙). */
  deleteSpecDoc(id: string): boolean {
    const doc = this.specDocs.get(id);
    if (!doc) return false;
    if (doc.preservePinned === true) return false;
    const removed = this.specDocs.delete(id);
    if (removed) this.bumpMutationVersion();
    return removed;
  }

  getSpecDoc(id: string): SpecDoc | undefined {
    return this.specDocs.get(id);
  }

  getSpecDocs(): SpecDoc[] {
    return [...this.specDocs.values()];
  }

  /** 기존 ID 그대로 수용 (체크포인트 복원/머지용). */
  acceptSpecDoc(doc: SpecDoc): boolean {
    if (this.specDocs.has(doc.id)) return false;
    this.specDocs.set(doc.id, sanitizeSpecDocOnLoad(doc));
    this.bumpMutationVersion();
    return true;
  }

  // ─── §5.16 — 리뷰·승인 레인 (머지 전에 사람이 붙잡는 자리) ───

  /**
   * §5.16 — 리뷰 한 건 생성. **id 발급은 여기서만** 한다.
   *
   * 개수 캡(`REVIEW_REQUESTS_MAX_PER_PROJECT`)은 같은 프로젝트 안에서만 적용하고, 넘칠 때는
   * **결정이 끝난 것부터** 오래된 순으로 버린다 — 사람이 아직 판단하지 않은 pending 을 조용히
   * 치우면 그 변경분이 본선에 들어갈 길이 함께 사라진다.
   */
  createReviewRequest(input: {
    projectName: string;
    parentProjectName?: string;
    agentId: string;
    subAgentId?: string;
    worktreeNodeId?: string;
    worktreePath: string;
    branch?: string;
    baseBranch?: string;
    files: ReviewFileChange[];
    filesTruncated?: boolean;
    diff: string;
    diffTruncated?: boolean;
  }): ReviewRequest {
    this.reviewIdCounter += 1;
    const now = Date.now();
    const files = input.files.slice(0, REVIEW_FILES_MAX);
    const req: ReviewRequest = {
      id: `review-${now.toString(36)}-${this.reviewIdCounter.toString(36)}-${idTail()}`,
      projectName: input.projectName,
      ...(input.parentProjectName ? { parentProjectName: input.parentProjectName } : {}),
      agentId: input.agentId,
      ...(input.subAgentId ? { subAgentId: input.subAgentId } : {}),
      ...(input.worktreeNodeId ? { worktreeNodeId: input.worktreeNodeId } : {}),
      worktreePath: input.worktreePath,
      ...(input.branch ? { branch: input.branch } : {}),
      ...(input.baseBranch ? { baseBranch: input.baseBranch } : {}),
      files,
      ...(input.filesTruncated === true || files.length < input.files.length ? { filesTruncated: true } : {}),
      diff: input.diff.slice(0, REVIEW_DIFF_MAX_BYTES),
      ...(input.diffTruncated === true || input.diff.length > REVIEW_DIFF_MAX_BYTES ? { diffTruncated: true } : {}),
      status: 'pending',
      decisions: [],
      createdAt: now,
      updatedAt: now,
    };
    this.reviewRequests.set(req.id, req);
    this.pruneReviewRequests(req.projectName);
    this.bumpMutationVersion();
    return req;
  }

  /** 프로젝트당 개수 캡 — 결정이 끝난 것부터 오래된 순으로 버린다(pending 은 남긴다). */
  private pruneReviewRequests(projectName: string): void {
    const mine = [...this.reviewRequests.values()].filter((r) => r.projectName === projectName);
    if (mine.length <= REVIEW_REQUESTS_MAX_PER_PROJECT) return;
    const decided = mine
      .filter((r) => r.status !== 'pending')
      .sort((a, b) => a.updatedAt - b.updatedAt);
    let over = mine.length - REVIEW_REQUESTS_MAX_PER_PROJECT;
    for (const r of decided) {
      if (over <= 0) break;
      this.reviewRequests.delete(r.id);
      over -= 1;
    }
    // 전부 pending 이라 못 줄였으면 그대로 둔다 — 판단 대기분을 버리는 것보다 낫다.
  }

  getReviewRequest(id: string): ReviewRequest | undefined {
    return this.reviewRequests.get(id);
  }

  /** 모든 리뷰 (스냅샷/체크포인트 직렬화 공통). */
  getReviewRequests(): ReviewRequest[] {
    return [...this.reviewRequests.values()];
  }

  /**
   * 그 에이전트에게 **아직 결정 안 난** 리뷰가 있나 — 있으면 새로 만들지 않는다(§5.16 조건 (d)).
   * 보류(`held`)도 "아직 판단 중"이라 새 카드를 겹쳐 만들지 않는다.
   */
  findOpenReviewRequestByAgent(agentId: string): ReviewRequest | undefined {
    let best: ReviewRequest | undefined;
    for (const r of this.reviewRequests.values()) {
      if (r.agentId !== agentId) continue;
      if (r.status !== 'pending' && r.status !== 'held') continue;
      if (!best || r.createdAt > best.createdAt) best = r;
    }
    return best;
  }

  /**
   * §5.16 — 결정 한 건 적재. id/시각은 서버가 stamp 한다.
   *
   * `status` 는 마지막 결정에서 나오는 파생값이고 **여기서만** 계산한다(§3.1). 승인했는데 병합이
   * 실패했으면(`mergeOk === false`) 상태를 `pending` 으로 되돌린다 — 부모를 정리한 뒤 다시 승인할
   * 자리를 남겨야 한다(그 실패 사실은 결정 이력에 그대로 남는다).
   */
  recordReviewDecision(
    id: string,
    input: Omit<ReviewDecision, 'id' | 'decidedAt'> & { decidedAt?: number },
  ): ReviewRequest | null {
    const req = this.reviewRequests.get(id);
    if (!req) return null;
    this.reviewIdCounter += 1;
    const now = input.decidedAt ?? Date.now();
    const decision: ReviewDecision = {
      id: `rdec-${now.toString(36)}-${this.reviewIdCounter.toString(36)}-${idTail()}`,
      kind: input.kind,
      ...(input.reason ? { reason: input.reason.slice(0, REVIEW_REASON_MAX) } : {}),
      decidedAt: now,
      ...(input.mergeOk !== undefined ? { mergeOk: input.mergeOk } : {}),
      ...(input.mergeError ? { mergeError: input.mergeError } : {}),
      ...(input.conflicts && input.conflicts.length > 0 ? { conflicts: input.conflicts.slice(0, REVIEW_FILES_MAX) } : {}),
      ...(input.reworkDispatched !== undefined ? { reworkDispatched: input.reworkDispatched } : {}),
    };
    req.decisions.push(decision);
    if (req.decisions.length > REVIEW_DECISIONS_MAX) {
      req.decisions.splice(0, req.decisions.length - REVIEW_DECISIONS_MAX);
    }
    req.status = decision.kind === 'approve'
      ? (decision.mergeOk === false ? 'pending' : 'approved')
      : decision.kind === 'reject' ? 'rejected' : 'held';
    req.updatedAt = now;
    this.bumpMutationVersion();
    return req;
  }

  /** 사람이 치운다 — 서버가 결정 안 난 리뷰를 스스로 지우지는 않는다(§5.16 경계). */
  deleteReviewRequest(id: string): boolean {
    const removed = this.reviewRequests.delete(id);
    if (removed) this.bumpMutationVersion();
    return removed;
  }

  /** 기존 ID 그대로 수용 (체크포인트 복원/머지용). */
  acceptReviewRequest(req: ReviewRequest): boolean {
    if (this.reviewRequests.has(req.id)) return false;
    this.reviewRequests.set(req.id, sanitizeReviewRequestOnLoad(req));
    this.bumpMutationVersion();
    return true;
  }

  // ─── §5.18 — 에이전트 랩 (같은 과제를 설정만 바꿔 N벌) ───

  /**
   * §5.18 — 랩 한 장을 캔버스에 놓는다. **id 발급은 여기서만** 한다.
   *
   * 변형 없이 시작해도 되고(패널에서 짠다), 초기 변형을 함께 받아도 된다.
   */
  createLabRun(input: {
    projectName: string;
    x: number;
    y: number;
    width: number;
    height: number;
    title?: string;
    task?: string;
    baseAgentId?: string;
    variants?: { label?: string; config?: LabVariantConfig }[];
  }): LabRun {
    this.labIdCounter += 1;
    const id = `lab-${Date.now().toString(36)}-${this.labIdCounter.toString(36)}-${idTail()}`;
    const now = Date.now();
    const run: LabRun = {
      id,
      projectName: input.projectName,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      title: (input.title ?? '').slice(0, LAB_TITLE_MAX),
      task: (input.task ?? '').slice(0, LAB_TASK_MAX),
      variants: (input.variants ?? [])
        .slice(0, LAB_MAX_VARIANTS)
        .map((v, i) => this.newLabVariant(v.label ?? `V${i + 1}`, v.config ?? {})),
      status: 'draft',
      ...(input.baseAgentId ? { baseAgentId: input.baseAgentId } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.labRuns.set(id, run);
    this.pruneLabRuns(run.projectName);
    this.bumpMutationVersion();
    return run;
  }

  /** 변형 한 벌을 만든다. id 는 여기서만 발급한다. */
  private newLabVariant(label: string, config: LabVariantConfig): LabVariant {
    this.labIdCounter += 1;
    return {
      id: `lvar-${Date.now().toString(36)}-${this.labIdCounter.toString(36)}-${idTail()}`,
      label: label.slice(0, LAB_VARIANT_LABEL_MAX) || 'V',
      config: sanitizeLabVariantConfig(config),
    };
  }

  /** 프로젝트당 개수 캡 — 도는 랩은 남기고 끝난 것부터 오래된 순으로 버린다(§9 키 개수 캡). */
  private pruneLabRuns(projectName: string): void {
    const mine = [...this.labRuns.values()].filter((r) => r.projectName === projectName);
    if (mine.length <= LAB_RUNS_MAX_PER_PROJECT) return;
    const idle = mine.filter((r) => r.status !== 'running').sort((a, b) => a.updatedAt - b.updatedAt);
    let over = mine.length - LAB_RUNS_MAX_PER_PROJECT;
    for (const r of idle) {
      if (over <= 0) break;
      if (r.preservePinned === true) continue;
      this.labRuns.delete(r.id);
      over -= 1;
    }
  }

  /**
   * 랩 부분 갱신 — 좌표·크기·제목·과제·기준 에이전트가 이 문 하나로 들어온다.
   *
   * **도는 중에는 과제를 못 바꾼다** — 그 표가 무엇을 비교한 것인지 알 수 없게 되기 때문이다.
   * 변형 목록은 `setLabVariants` 로만 바꾼다(실행 결과를 실수로 지우지 않게 문을 나눈다).
   */
  updateLabRun(
    id: string,
    updates: Partial<Pick<LabRun, 'x' | 'y' | 'width' | 'height' | 'title' | 'task' | 'baseAgentId' | 'preservePinned'>>,
  ): LabRun | null {
    const run = this.labRuns.get(id);
    if (!run) return null;

    for (const key of ['x', 'y', 'width', 'height'] as const) {
      const v = updates[key];
      if (typeof v === 'number' && Number.isFinite(v)) run[key] = v;
    }
    if (typeof updates.title === 'string') run.title = updates.title.slice(0, LAB_TITLE_MAX);
    if (typeof updates.task === 'string' && run.status !== 'running') {
      run.task = updates.task.slice(0, LAB_TASK_MAX);
    }
    if (typeof updates.baseAgentId === 'string') run.baseAgentId = updates.baseAgentId;
    if (typeof updates.preservePinned === 'boolean') run.preservePinned = updates.preservePinned;

    run.updatedAt = Date.now();
    this.bumpMutationVersion();
    return run;
  }

  /**
   * 변형 목록 통째 교체(패널의 편집 결과). **이미 실행된 변형의 결과는 지키고** 설정만 덮는다 —
   * 표에 남은 측정값이 편집 한 번에 사라지면 비교의 근거가 없어진다.
   */
  setLabVariants(id: string, variants: { id?: string; label?: string; config?: LabVariantConfig }[]): LabRun | null {
    const run = this.labRuns.get(id);
    if (!run) return null;
    const byId = new Map(run.variants.map((v) => [v.id, v]));
    const next: LabVariant[] = [];
    for (const incoming of variants.slice(0, LAB_MAX_VARIANTS)) {
      const prev = incoming.id ? byId.get(incoming.id) : undefined;
      if (prev) {
        next.push({
          ...prev,
          label: (incoming.label ?? prev.label).slice(0, LAB_VARIANT_LABEL_MAX) || prev.label,
          config: sanitizeLabVariantConfig(incoming.config ?? prev.config),
        });
      } else {
        next.push(this.newLabVariant(incoming.label ?? `V${next.length + 1}`, incoming.config ?? {}));
      }
    }
    run.variants = next;
    if (run.promotedVariantId && !next.some((v) => v.id === run.promotedVariantId)) {
      delete run.promotedVariantId;
    }
    run.updatedAt = Date.now();
    this.recomputeLabStatus(run);
    this.bumpMutationVersion();
    return run;
  }

  /** 변형 한 벌 추가(패널의 [+ 변형 추가]). 상한을 넘으면 null. */
  addLabVariant(id: string, label: string, config?: LabVariantConfig): LabRun | null {
    const run = this.labRuns.get(id);
    if (!run) return null;
    if (run.variants.length >= LAB_MAX_VARIANTS) return null;
    run.variants.push(this.newLabVariant(label, config ?? {}));
    run.updatedAt = Date.now();
    this.bumpMutationVersion();
    return run;
  }

  /** 변형 한 벌 제거. 만들어진 에이전트·워크트리는 남는다(사람이 만든 작업물을 데려가지 않는다). */
  removeLabVariant(id: string, variantId: string): LabRun | null {
    const run = this.labRuns.get(id);
    if (!run) return null;
    const before = run.variants.length;
    run.variants = run.variants.filter((v) => v.id !== variantId);
    if (run.variants.length === before) return run;
    if (run.promotedVariantId === variantId) delete run.promotedVariantId;
    run.updatedAt = Date.now();
    this.recomputeLabStatus(run);
    this.bumpMutationVersion();
    return run;
  }

  /**
   * 실행이 걸린 변형에 카드·워크트리 정보를 붙이고 `pending → running` 으로 올린다.
   * 서버의 실행 경로(`/api/lab-runs/:id/start`)가 워크트리와 에이전트를 만든 직후에 부른다.
   */
  attachLabVariantRun(
    id: string,
    variantId: string,
    info: {
      agentId: string;
      sessionId: string;
      worktreeProjectName?: string;
      worktreePath?: string;
      branch?: string;
      startedAt?: number;
    },
  ): LabRun | null {
    const run = this.labRuns.get(id);
    if (!run) return null;
    const variant = run.variants.find((v) => v.id === variantId);
    if (!variant) return null;
    const now = info.startedAt ?? Date.now();
    variant.agentId = info.agentId;
    variant.sessionId = info.sessionId;
    if (info.worktreeProjectName) variant.worktreeProjectName = info.worktreeProjectName;
    if (info.worktreePath) variant.worktreePath = info.worktreePath;
    if (info.branch) variant.branch = info.branch;
    variant.result = { status: 'running', startedAt: now };
    run.startedAt = run.startedAt ?? now;
    delete run.finishedAt;
    run.updatedAt = now;
    this.recomputeLabStatus(run);
    this.bumpMutationVersion();
    return run;
  }

  /**
   * 그 턴이 끝났다 — 변형에 결과를 적는다. 명령 완료 콜백(`setOnComplete`)에서만 부른다.
   *
   * **못 읽은 값은 넣지 않는다**(§5.18) — 호출부가 `undefined` 로 주면 그 필드는 비운 채 둔다.
   */
  finishLabVariant(
    id: string,
    variantId: string,
    result: Omit<LabResult, 'startedAt'> & { startedAt?: number },
  ): LabRun | null {
    const run = this.labRuns.get(id);
    if (!run) return null;
    const variant = run.variants.find((v) => v.id === variantId);
    if (!variant) return null;
    const now = Date.now();
    const startedAt = result.startedAt ?? variant.result?.startedAt;
    const finishedAt = result.finishedAt ?? now;
    const merged: LabResult = {
      status: result.status,
      ...(startedAt !== undefined ? { startedAt } : {}),
      finishedAt,
      ...(startedAt !== undefined ? { durationMs: Math.max(0, finishedAt - startedAt) } : {}),
      ...(result.filesChanged !== undefined ? { filesChanged: result.filesChanged } : {}),
      ...(result.additions !== undefined ? { additions: result.additions } : {}),
      ...(result.deletions !== undefined ? { deletions: result.deletions } : {}),
      ...(result.inputTokens !== undefined ? { inputTokens: result.inputTokens } : {}),
      ...(result.outputTokens !== undefined ? { outputTokens: result.outputTokens } : {}),
      ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
      ...(result.model ? { model: result.model } : {}),
      ...(result.summary ? { summary: result.summary.slice(0, LAB_SUMMARY_MAX) } : {}),
      ...(result.error ? { error: result.error.slice(0, LAB_SUMMARY_MAX) } : {}),
    };
    variant.result = merged;
    run.updatedAt = now;
    this.recomputeLabStatus(run);
    if (run.status === 'done') run.finishedAt = now;
    this.bumpMutationVersion();
    return run;
  }

  /** 승격한 변형을 표에 남긴다(`기본값` 배지). 실제 설정 저장은 호출부가 `setAgentConfig` 로 한다. */
  markLabPromoted(id: string, variantId: string): LabRun | null {
    const run = this.labRuns.get(id);
    if (!run) return null;
    if (!run.variants.some((v) => v.id === variantId)) return null;
    run.promotedVariantId = variantId;
    run.updatedAt = Date.now();
    this.bumpMutationVersion();
    return run;
  }

  /** 파생 상태 계산 — 서버만 한다(§3.1). 하나라도 도는 중이면 running, 하나라도 끝났으면 done. */
  private recomputeLabStatus(run: LabRun): void {
    const results = run.variants.map((v) => v.result).filter((r): r is LabResult => r !== undefined);
    if (results.some((r) => r.status === 'running')) {
      run.status = 'running';
      return;
    }
    run.status = results.length > 0 ? 'done' : 'draft';
  }

  /** 이 에이전트가 어느 랩의 어느 변형인지 역인덱스 — 완료 콜백이 한 번에 찾는다. */
  findLabVariantByAgent(agentId: string): { run: LabRun; variant: LabVariant } | undefined {
    for (const run of this.labRuns.values()) {
      const variant = run.variants.find((v) => v.agentId === agentId);
      if (variant) return { run, variant };
    }
    return undefined;
  }

  /** 삭제. §2.4 preserve-pin 이 걸려 있으면 거절한다(스펙·플레이 버블과 같은 규칙). */
  deleteLabRun(id: string): boolean {
    const run = this.labRuns.get(id);
    if (!run) return false;
    if (run.preservePinned === true) return false;
    const removed = this.labRuns.delete(id);
    if (removed) this.bumpMutationVersion();
    return removed;
  }

  getLabRun(id: string): LabRun | undefined {
    return this.labRuns.get(id);
  }

  getLabRuns(): LabRun[] {
    return [...this.labRuns.values()];
  }

  /** 기존 ID 그대로 수용 (체크포인트 복원/머지용). */
  acceptLabRun(run: LabRun): boolean {
    if (this.labRuns.has(run.id)) return false;
    this.labRuns.set(run.id, sanitizeLabRunOnLoad(run));
    this.bumpMutationVersion();
    return true;
  }

  // ─── §5.20 스크립트 선반 (Shelf) ───

  /**
   * §5.20 — 선반 한 장을 캔버스에 놓는다.
   *
   * 항목 없이 시작해도 되고(패널·우클릭에서 채운다), 초기 항목을 함께 받아도 된다
   * (가져오기가 이 문으로 들어온다).
   */
  createShelfBubble(input: {
    projectName: string;
    x: number;
    y: number;
    width: number;
    height: number;
    title?: string;
    items?: ShelfImportDraftItem[];
  }): ShelfBubble {
    this.shelfIdCounter += 1;
    const id = `shelf-${Date.now().toString(36)}-${this.shelfIdCounter.toString(36)}-${idTail()}`;
    const now = Date.now();
    const bubble: ShelfBubble = {
      id,
      projectName: input.projectName,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      title: (input.title ?? '').slice(0, SHELF_TITLE_MAX),
      items: (input.items ?? []).slice(0, SHELF_MAX_ITEMS).map((it) => this.newShelfItem(it)),
      createdAt: now,
      updatedAt: now,
    };
    this.shelfBubbles.set(id, bubble);
    this.pruneShelfBubbles(bubble.projectName);
    this.bumpMutationVersion();
    return bubble;
  }

  /** 항목 한 줄을 만든다. id 는 여기서만 발급하고 아이콘·색은 고정 목록 안으로 강제한다. */
  private newShelfItem(draft: ShelfImportDraftItem): ShelfItem {
    this.shelfIdCounter += 1;
    const now = Date.now();
    const kind: ShelfItemKind = draft.kind === 'prompt' ? 'prompt' : 'command';
    const command = (draft.command ?? '').slice(0, SHELF_COMMAND_MAX);
    const prompt = (draft.prompt ?? '').slice(0, SHELF_PROMPT_MAX);
    return {
      id: `sitem-${Date.now().toString(36)}-${this.shelfIdCounter.toString(36)}-${idTail()}`,
      label: (draft.label || '').slice(0, SHELF_LABEL_MAX) || (kind === 'command' ? 'command' : 'prompt'),
      kind,
      ...(kind === 'command' ? { command } : { prompt }),
      icon: normalizeShelfIcon(draft.icon, kind),
      color: normalizeShelfColor(draft.color),
      createdAt: now,
      updatedAt: now,
    };
  }

  /** 프로젝트당 개수 캡 — 오래된 것부터 버리되 고정된 선반은 남긴다(§9 키 개수 캡). */
  private pruneShelfBubbles(projectName: string): void {
    const mine = [...this.shelfBubbles.values()].filter((b) => b.projectName === projectName);
    if (mine.length <= SHELF_BUBBLES_MAX_PER_PROJECT) return;
    const old = [...mine].sort((a, b) => a.updatedAt - b.updatedAt);
    let over = mine.length - SHELF_BUBBLES_MAX_PER_PROJECT;
    for (const b of old) {
      if (over <= 0) break;
      if (b.preservePinned === true) continue;
      this.shelfBubbles.delete(b.id);
      over -= 1;
    }
  }

  /** 선반 부분 갱신 — 좌표·크기·제목·핀이 이 문 하나로 들어온다(항목은 별도 문). */
  updateShelfBubble(
    id: string,
    updates: Partial<Pick<ShelfBubble, 'x' | 'y' | 'width' | 'height' | 'title' | 'preservePinned'>>,
  ): ShelfBubble | null {
    const bubble = this.shelfBubbles.get(id);
    if (!bubble) return null;
    if (typeof updates.x === 'number') bubble.x = updates.x;
    if (typeof updates.y === 'number') bubble.y = updates.y;
    if (typeof updates.width === 'number') bubble.width = updates.width;
    if (typeof updates.height === 'number') bubble.height = updates.height;
    if (typeof updates.title === 'string') bubble.title = updates.title.slice(0, SHELF_TITLE_MAX);
    if (typeof updates.preservePinned === 'boolean') bubble.preservePinned = updates.preservePinned;
    bubble.updatedAt = Date.now();
    this.bumpMutationVersion();
    return bubble;
  }

  /** 항목 한 줄 추가. 상한을 넘으면 `null`(호출부가 409 로 돌려준다). */
  addShelfItem(id: string, draft: ShelfImportDraftItem): ShelfBubble | null {
    const bubble = this.shelfBubbles.get(id);
    if (!bubble) return null;
    if (bubble.items.length >= SHELF_MAX_ITEMS) return null;
    bubble.items.push(this.newShelfItem(draft));
    bubble.updatedAt = Date.now();
    this.bumpMutationVersion();
    return bubble;
  }

  /**
   * 항목 한 줄 수정.
   *
   * **실행 결과(`lastRun`)는 이 문으로 지워지지 않는다** — 이름을 고쳤다고 마지막 실행이 없던 일이
   * 되면, 화면이 "한 번도 안 눌렀다"고 거짓말한다. 종류를 바꾸면 그때만 결과를 비운다(셸 결과와
   * 프롬프트 결과는 서로 다른 것을 말하기 때문).
   */
  updateShelfItem(
    id: string,
    itemId: string,
    updates: Partial<Pick<ShelfItem, 'label' | 'kind' | 'command' | 'cwd' | 'prompt' | 'targetAgentId' | 'icon' | 'color'>>,
  ): ShelfBubble | null {
    const bubble = this.shelfBubbles.get(id);
    if (!bubble) return null;
    const item = bubble.items.find((i) => i.id === itemId);
    if (!item) return null;

    if (typeof updates.label === 'string') item.label = updates.label.slice(0, SHELF_LABEL_MAX);
    if (updates.kind === 'command' || updates.kind === 'prompt') {
      if (updates.kind !== item.kind) {
        item.kind = updates.kind;
        delete item.lastRun;
      }
    }
    if (typeof updates.command === 'string') item.command = updates.command.slice(0, SHELF_COMMAND_MAX);
    if (typeof updates.prompt === 'string') item.prompt = updates.prompt.slice(0, SHELF_PROMPT_MAX);
    if (typeof updates.cwd === 'string') {
      const cwd = updates.cwd.trim();
      if (cwd) item.cwd = cwd;
      else delete item.cwd;
    }
    if (typeof updates.targetAgentId === 'string') {
      const target = updates.targetAgentId.trim();
      if (target) item.targetAgentId = target;
      else delete item.targetAgentId;
    }
    if (updates.icon !== undefined) item.icon = normalizeShelfIcon(updates.icon, item.kind);
    if (updates.color !== undefined) item.color = normalizeShelfColor(updates.color);
    item.updatedAt = Date.now();
    bubble.updatedAt = item.updatedAt;
    this.bumpMutationVersion();
    return bubble;
  }

  /** 항목 한 줄 삭제. */
  removeShelfItem(id: string, itemId: string): ShelfBubble | null {
    const bubble = this.shelfBubbles.get(id);
    if (!bubble) return null;
    const next = bubble.items.filter((i) => i.id !== itemId);
    if (next.length === bubble.items.length) return null;
    bubble.items = next;
    bubble.updatedAt = Date.now();
    this.bumpMutationVersion();
    return bubble;
  }

  /** 항목 순서 바꾸기 — 목록에 있는 id 만, 빠진 것은 뒤에 그대로 남긴다. */
  reorderShelfItems(id: string, order: string[]): ShelfBubble | null {
    const bubble = this.shelfBubbles.get(id);
    if (!bubble) return null;
    const byId = new Map(bubble.items.map((i) => [i.id, i]));
    const out: ShelfItem[] = [];
    for (const itemId of order) {
      const hit = byId.get(itemId);
      if (!hit) continue;
      byId.delete(itemId);
      out.push(hit);
    }
    bubble.items = [...out, ...byId.values()];
    bubble.updatedAt = Date.now();
    this.bumpMutationVersion();
    return bubble;
  }

  /**
   * §5.20 — 가져오기. 초안은 이미 `normalizeShelfImport` 를 통과한 것만 들어온다.
   *
   * `replace=true` 면 통째 교체, 아니면 덧붙이기(기본). 상한을 넘는 분은 조용히 버리고
   * 몇 개가 들어갔는지 돌려준다 — 화면이 "20개 중 12개만 들어왔다"고 말할 수 있어야 한다.
   */
  importShelfItems(id: string, drafts: ShelfImportDraftItem[], replace: boolean): { bubble: ShelfBubble; added: number; dropped: number } | null {
    const bubble = this.shelfBubbles.get(id);
    if (!bubble) return null;
    const base = replace ? [] : bubble.items;
    const room = Math.max(0, SHELF_MAX_ITEMS - base.length);
    const taken = drafts.slice(0, room);
    bubble.items = [...base, ...taken.map((d) => this.newShelfItem(d))];
    bubble.updatedAt = Date.now();
    this.bumpMutationVersion();
    return { bubble, added: taken.length, dropped: drafts.length - taken.length };
  }

  /** 실행 시작 — 그 줄의 마지막 결과를 `running` 으로 갈아 끼운다. */
  startShelfItemRun(id: string, itemId: string, seed?: { agentId?: string; sessionId?: string }): ShelfItem | null {
    const bubble = this.shelfBubbles.get(id);
    if (!bubble) return null;
    const item = bubble.items.find((i) => i.id === itemId);
    if (!item) return null;
    item.lastRun = {
      status: 'running',
      startedAt: Date.now(),
      ...(seed?.agentId ? { agentId: seed.agentId } : {}),
      ...(seed?.sessionId ? { sessionId: seed.sessionId } : {}),
    };
    item.updatedAt = item.lastRun.startedAt;
    bubble.updatedAt = item.updatedAt;
    this.bumpMutationVersion();
    return item;
  }

  /**
   * 실행 종료 — 결과를 그 줄에 적는다.
   *
   * **못 읽은 값은 채우지 않는다**(§5.20) — `undefined` 로 온 필드는 건드리지 않아 화면이 `—` 로 그린다.
   */
  finishShelfItemRun(
    id: string,
    itemId: string,
    result: Partial<Omit<ShelfItemRun, 'status' | 'startedAt'>> & { status: ShelfRunStatus },
  ): ShelfItem | null {
    const bubble = this.shelfBubbles.get(id);
    if (!bubble) return null;
    const item = bubble.items.find((i) => i.id === itemId);
    if (!item) return null;
    const prev = item.lastRun;
    const startedAt = prev?.startedAt ?? Date.now();
    const finishedAt = result.finishedAt ?? Date.now();
    const output = result.output !== undefined
      ? result.output.slice(-SHELF_RUN_OUTPUT_MAX_CHARS)
      : undefined;
    item.lastRun = {
      ...(prev ?? {}),
      status: result.status,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
      ...(output !== undefined ? { output } : {}),
      ...(result.outputTruncated !== undefined ? { outputTruncated: result.outputTruncated } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
      ...(result.agentId !== undefined ? { agentId: result.agentId } : {}),
      ...(result.sessionId !== undefined ? { sessionId: result.sessionId } : {}),
    };
    item.updatedAt = finishedAt;
    bubble.updatedAt = finishedAt;
    this.bumpMutationVersion();
    return item;
  }

  /** 선반 삭제. 고정된 선반은 거절한다(§2.4 preserve-pin). */
  deleteShelfBubble(id: string): boolean {
    const bubble = this.shelfBubbles.get(id);
    if (!bubble) return false;
    if (bubble.preservePinned === true) return false;
    const removed = this.shelfBubbles.delete(id);
    if (removed) this.bumpMutationVersion();
    return removed;
  }

  /**
   * §5.20 — 이 에이전트가 지금 어느 선반 줄의 프롬프트를 처리 중인가.
   *
   * 도는 줄만 돌려준다 — 이미 마감된 줄까지 잡으면 그 뒤에 사람이 그 카드에 직접 시킨 일이
   * 선반 결과로 덮어써진다(랩 변형 마감과 같은 규율).
   */
  findShelfItemByAgent(agentId: string): { bubble: ShelfBubble; item: ShelfItem } | undefined {
    for (const bubble of this.shelfBubbles.values()) {
      for (const item of bubble.items) {
        if (item.lastRun?.status === 'running' && item.lastRun.agentId === agentId) {
          return { bubble, item };
        }
      }
    }
    return undefined;
  }

  getShelfBubble(id: string): ShelfBubble | undefined {
    return this.shelfBubbles.get(id);
  }

  getShelfBubbles(): ShelfBubble[] {
    return [...this.shelfBubbles.values()];
  }

  /** §3.2.2 identity 복구 — 이미 있는 id 는 건드리지 않는다(디스크가 메모리를 덮지 않게). */
  acceptShelfBubble(bubble: ShelfBubble): boolean {
    if (this.shelfBubbles.has(bubble.id)) return false;
    this.shelfBubbles.set(bubble.id, sanitizeShelfBubbleOnLoad(bubble));
    this.bumpMutationVersion();
    return true;
  }


  // ─── §5.22 — 권한·감사 경계 ───

  /**
   * 훅 이벤트 한 건을 감사 원장에 적는다(`processHookEvent` 안에서만 불린다).
   *
   * 실패해도 그래프 처리를 멈추지 않는다 — 감사는 기록이지 판정이 아니다.
   */
  private recordAuditFromHook(payload: HookEventPayload, agent: BubbleData): void {
    try {
      if (!payload.tool_name) return;
      const projectName = this.getAgentProjectName(agent.id)
        ?? this.projects.get(normalize(this.sessionCwds.get(payload.session_id) ?? ''))?.name
        ?? null;
      if (!projectName) return;
      // 타임라인 좌측 dot 색은 그 에이전트의 설정 색(버블과 같은 색). 없으면 클라 기본값이 쓴다.
      const agentColor = this.agentConfigs.get(agent.id)?.color;
      this.auditLogService.record({
        projectName,
        sessionId: payload.session_id,
        agentId: agent.id,
        agentLabel: agent.label,
        ...(agentColor ? { agentColor } : {}),
        toolName: payload.tool_name,
        toolInput: payload.tool_input ?? null,
        ...(payload.tool_use_id ? { toolUseId: payload.tool_use_id } : {}),
        roots: this.getAuditRoots(projectName, payload.cwd ?? this.sessionCwds.get(payload.session_id)),
      });
    } catch (err) {
      logger.debug('[audit] hook record skipped', err);
    }
  }

  /**
   * §5.22 `outside` — 이 호출이 머물러야 할 경계.
   *
   * **프로젝트 루트와 그 세션의 cwd 둘 다** 돌려준다(어느 하나에라도 들어가면 안이다).
   * 승인 창구와 훅 경로가 **같은 이 함수**를 써야 한 호출이 두 화면에서 다르게 판정되지 않는다.
   * 루트를 못 찾으면 빈 배열 — 그때는 `outside` 판정 자체가 열리지 않는다(없는 근거로 위험을
   * 지어내면 프로젝트 등록 전 몇 초의 호출이 전부 밖으로 찍힌다).
   */
  getAuditRoots(projectName: string, cwd?: string | null): string[] {
    const roots: string[] = [];
    const projectPath = projectName ? this.getProjectByName(projectName)?.path : undefined;
    if (projectPath) roots.push(projectPath);
    if (cwd && cwd.trim() && !roots.some((r) => samePath(r, cwd))) roots.push(cwd.trim());
    return roots;
  }

  /**
   * 승인 창구(`/api/permission-check`)가 먼저 적는 줄. `tool_use_id` 가 없는 자리라
   * 뒤따라오는 훅 이벤트가 찾아올 수 있게 표식을 걸어 둔다.
   */
  recordAuditCall(input: AuditRecordInput): string | null {
    try {
      const id = this.auditLogService.record(input).id;
      // §9 — 스냅샷 캐시는 mutationVersion 으로 무효화된다. 여기를 빼면 방금 적은 줄이
      //   200ms 동안 화면과 체크포인트 양쪽에서 안 보인다(내부 mutate 의 고전적 함정).
      this.bumpMutationVersion();
      return id;
    } catch (err) {
      logger.debug('[audit] call record skipped', err);
      return null;
    }
  }

  /** 승인 카드가 뜬 줄에 "물었다"는 표식. */
  markAuditEscalated(projectName: string, entryId: string): void {
    this.auditLogService.markEscalated(projectName, entryId);
    this.bumpMutationVersion();
  }

  /** 사람(또는 정책)의 답을 그 줄에 적는다. */
  recordAuditDecision(
    projectName: string,
    entryId: string,
    decision: 'allow' | 'deny',
    source: AuditDecisionSource,
    reason?: string,
  ): boolean {
    const ok = this.auditLogService.recordDecision(projectName, entryId, decision, source, reason);
    if (ok) this.bumpMutationVersion();
    return ok;
  }

  /**
   * §3.2.3 — 보존 설정이 바뀐 직후 지금 들고 있는 원장 전부에 새 상한을 적용한다.
   * 잘린 줄이 있으면 true(호출부가 브로드캐스트·저장을 결정한다).
   */
  applyAuditRetention(): boolean {
    const changed = this.auditLogService.applyRetention();
    if (changed) this.bumpMutationVersion();
    return changed;
  }

  /** 그 프로젝트의 경계 스위치(없으면 기본 = 전부 묻는다). */
  getAuditBoundary(projectName: string): AuditBoundaryConfig {
    return this.auditLogService.getBoundary(projectName);
  }

  /** 경계 스위치 갱신 — 부분 페이로드도 나머지 값을 잃지 않는다. */
  setAuditBoundary(projectName: string, patch: Partial<AuditBoundaryConfig>): AuditBoundaryConfig {
    const next = this.auditLogService.setBoundary(projectName, patch);
    this.bumpMutationVersion();
    return next;
  }

  /** 조회용 — 그 프로젝트의 원장 한 장(없으면 undefined). */
  getAuditLog(projectName: string): ProjectAuditLog | undefined {
    return this.auditLogService.getSnapshot().find((l) => l.projectName === projectName);
  }

  // ─── §5.21 — 비용·토큰 지도 ───

  /**
   * 세션 원장을 한 번 훑는다. 바뀐 게 있으면 true(호출부가 브로드캐스트·저장을 결정).
   *
   * **활성 세션만** 넘긴다 — 이미 원장에 있고 한동안 조용한 세션은 값이 변할 수 없다.
   * 그 뒤로도 스캐너가 mtime·size 로 한 번 더 걸러 변화 없으면 파일을 열지 않는다.
   */
  sweepCostMap(registry: ModelRegistry | null, now: number = Date.now()): boolean {
    const sessions: CostSweepSession[] = [];
    for (const sub of subAgentManager.getAllSubsFlat()) {
      if (!sub.sessionId) continue;
      const projectName = this.getAgentProjectName(sub.parentAgentId);
      const cwd = this.getAgentCwdByAgentId(sub.parentAgentId);
      if (!projectName || !cwd) continue;
      const quiet = now - (sub.lastActivityAt || 0) > COST_MAP_ACTIVE_WINDOW_MS;
      if (quiet && this.costMapService.hasSession(projectName, sub.sessionId)) continue;
      sessions.push({
        sessionId: sub.sessionId,
        agentId: sub.parentAgentId,
        subAgentId: sub.id,
        label: sub.label,
        cwd,
        projectName,
      });
    }
    if (sessions.length === 0) return false;

    const changed = this.costMapService.sweep(
      sessions,
      (cwd, sessionId) => readSessionTokenData(cwd, sessionId)?.turns ?? null,
      registry,
      now,
    );
    if (changed) this.bumpMutationVersion();
    return changed;
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

  /**
   * §5.13 (Q) — 출력 프리셋 지정.
   *
   * `updatedAt` 은 건드리지 않는다 — 히스토리의 "edited" 마커는 *컷이 바뀐 것*을 뜻하는데,
   * 판형만 고른 것을 수정으로 세면 사용자가 고치지도 않은 콘티가 고쳐진 것처럼 보인다.
   */
  setContiPreset(contiId: string, presetId: StoryboardPresetId): Conti | null {
    const c = this.contis.get(contiId);
    if (!c) return null;
    c.presetId = presetId;
    this.bumpMutationVersion();
    return c;
  }

  /**
   * §5.13 (Q) — 콘티를 받아 간 앱의 산출물 기록.
   *
   * 한 콘티가 들고 있는 것은 **마지막 한 건**이다. 넘길 때마다 쌓으면 체크포인트가
   * 사용자 산출물이 아닌 이력으로 부푼다(§3.2.3 보존 정책) — 지난 문서는 앱 쪽 목록에 남는다.
   */
  setContiRenderLink(contiId: string, link: ContiRenderLink): Conti | null {
    const c = this.contis.get(contiId);
    if (!c) return null;
    c.render = link;
    this.bumpMutationVersion();
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
