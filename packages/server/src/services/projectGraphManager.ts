/**
 * ProjectGraphManager — 싱글턴 ProjectGraph 의 공개 API 그대로, 안에서 cwd 별 인스턴스로 라우팅하는 파사드.
 * TODO: task edges 를 ProjectGraph → Manager 레벨로 이동
 */

import path from 'node:path';
import fs from 'node:fs';
import type {
  BubbleData,
  GraphSnapshot,
  SpecReadingSettings,
  AutoGoalSettings,
  OrchestraSettings,
  ConfigTrimSettings,
  ConfigTrimRun,
  OrchestraRun,
  SpecReadingState,
  ProjectAgentCounts,
  HookEventPayload,
  ProjectInfo,
  ProjectCheckpoint,
  ProjectMetaSnapshot,
  QueuedCommand,
  ServerEntry,
  FolderFilePage,
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
  AgentPhase,
  ActivityEdge,
  UiLocale,
  CommentBox,
  DebugBreakpoint,
  AppBubble,
  CaptureBubble,
  PlayBubble,
  PlayRecipe,
  SpecDoc,
  ReviewRequest,
  LabRun,
  ShelfBubble,
  ProjectCostMap,
  ProjectAuditLog,
  CompactMarker,
  CompactWatchState,
  FilePreimage,
  ProjectInsuranceLedger,
  AuditBoundaryConfig,
  AuditDecisionSource,
  ModelRegistry,
  ShelfItem,
  ShelfItemRun,
  ShelfRunStatus,
  ShelfImportDraftItem,
  LabVariant,
  LabVariantConfig,
  LabResult,
  ReviewDecision,
  ReviewFileChange,
  SpecItem,
  Conti,
  ContiFrame,
  ContiElement,
  ActiveContiWork,
  ContiWorkSource,
  ContiRenderLink,
  StoryboardPresetId,
  RateLimitInfo,
  ClaudeUsageInfo,
  ClaudeAuthStatus,
  ClaudeSetupState,
  CodexAuthStatus,
  CodexSetupState,
  CodexHookState,
  CodexModelCatalog,
  CodexInventory,
  CodexReviewRun,
  ExecutionMode,
  AgentProvider,
} from '@vibisual/shared';
import { DEFAULT_AUDIT_BOUNDARY, DEFAULT_UI_LOCALE, EXTERNAL_TOP_BUDGET_DEFAULT, GOAL_ACTION_MAX, ROOT_NODE_KEY_PREFIX } from '@vibisual/shared';
import { WEB_GROUP_OFF, normalizeWebGroupSettings, webFoldAgentId, type WebGroupSettings } from '@vibisual/shared';
import type { GoalActionCard } from '@vibisual/shared';
import type { IframeTabVerdict } from '@vibisual/shared';
// §9 슬라이스 스코프 — 규칙 전문은 `shared/src/sliceScope.ts` 머리말이 단독 소유한다.
import {
  heatQuantileSamples,
  isSliceScopeGroup,
  resolveAutoGoalProjectRoot,
  resolveSliceShipSet,
  stripScopedOutSlices,
  type ScopableSliceKey,
  type SliceScopeGroup,
} from '@vibisual/shared';
import { ProjectGraph, resolveGitWorktreeParent, type ProcessResult } from './projectGraph.js';
// §5.22 — 권한·감사 경계(승인 창구가 원장에 적을 때 쓰는 입력 모양).
import type { AuditRecordInput } from './auditLog.js';
import { loadCheckpointByMeta, loadIdentityFromDir, writeCheckpoint, projectDirForInfo, discoverProjectMetas } from './statePersistence.js';
// §5.3 #12-3 — 자물쇠. 메모리에 없는(stub) 프로젝트의 자물쇠도 집행에 들어가야 한다(아래 `stubPathLocks`).
import { normalizePathLocks } from '@vibisual/shared';
import type { PathLock, PathLockTarget } from '@vibisual/shared';
// §5.4 #36 (C) — 결과 전달 경로 판정(루트 안 · 상대 경로화). 플랫폼은 인자로 넘긴다.
import { isAppBubbleId, projectRelativePath } from '@vibisual/shared';
import { appStateAddOpenProject, loadAppState, publicAppState } from './appState.js';
import { apiCreditService } from './apiCreditService.js';
import { diagnosticService } from './diagnosticService.js';
import { modelRegistryService } from './modelRegistryService.js';
import { getEngineState } from './localEngineService.js';
import { peekLocalHardware } from './localHardwareService.js';
import { listDownloads, listModels } from './localModelService.js';
import { listLoadedModels } from './localRunner.js';
import { userDefaultsService } from './userDefaultsService.js';
import { logger } from '../logger.js';
import { dbg, dbgOnChange } from './debugLog.js';
// 경로 대소문자 정책 SSOT — win32/darwin 만 접고 linux 는 접지 않는다.
import { HOST_PLATFORM, isWithinRoot, pathKey } from './pathKey.js';

// ─── 유틸 ───

/**
 * projectGraph.ts 의 `normalize` 와 반드시 같은 규칙(인스턴스·스텁 Map 키). 대소문자는 실제로 무시하는 FS 에서만 접는다
 * — linux 에서 접으면 케이스만 다른 두 프로젝트가 한 인스턴스로 뭉개져 서로 덮어쓴다.
 */
function normalize(filePath: string): string {
  return pathKey(filePath);
}

/**
 * §3.2.1-4 — read-only 격리(또는 미하이드레이트 디스크 데이터가 있는) 경로에서 `registerProject` 가 빈 인스턴스 생성을 거부할 때 던진다
 * — 빈 그래프가 디스크 checkpoint 를 덮는 손실을 끊는다. 호출처는 그 이벤트를 드롭한다.
 */
export class ReadOnlyProjectError extends Error {
  constructor(public readonly projectPath: string) {
    super(`Project is read-only isolated (load-error) and re-hydrate failed: ${projectPath}`);
    this.name = 'ReadOnlyProjectError';
  }
}

/** cwd 에서 위로 올라가 아래 마커가 있는 폴더를 루트로 본다(없으면 cwd) — 모노레포 서브패키지 세션이 별도 탭으로 뜨지 않게. */
const PROJECT_ROOT_MARKERS = [
  'pnpm-workspace.yaml',
  'lerna.json',
  'nx.json',
  'rush.json',
  '.git',
];

/**
 * `none` = 끝까지 올라가도 표식이 없어 cwd 를 그대로 돌려줬다. `resolveHookProjectRoot` 가 이걸로 열린 프로젝트의 평범한 하위 폴더를 가려낸다
 * (cwd 를 루트로 삼으면 유령 프로젝트가 선다, §3.5).
 */
export type ProjectRootVia = 'worktree' | 'marker' | 'none';

export function resolveProjectRootInfo(cwd: string): { root: string; via: ProjectRootVia } {
  // worktree cwd 감지 → 부모 인스턴스로 라우팅 (SSOT §5.7 #26, todo0417 A-1)
  // worktree 디렉토리도 자체 .git/package.json 을 가지므로 마커 검색이 worktree 자기 자신을 프로젝트 루트로 잘못 인식,
  // 그 결과 같은 worktree 세션이 부모 인스턴스와 worktree 인스턴스 양쪽에서 seed 되어 스냅샷 merge 시 중복 렌더됨.
  const normalized = cwd.replace(/\\/g, '/');
  const wtMatch = normalized.match(/^(.+?)\/\.claude\/worktrees\/[^/]+\/?/);
  if (wtMatch) {
    // 원본 케이스 보존 (cwd는 원본, normalized는 slash 변환본)
    return { root: cwd.slice(0, wtMatch[1]!.length), via: 'worktree' };
  }

  // git-linked 워크트리(임의 위치) → 부모로 라우팅. `--isolation worktree` 는 `.claude/worktrees/` 밖에도 만들어 경로 패턴으로는 못 잡는다
  // — 놓치면 `agent-<hex>` 유령 인스턴스가 저장 순회에 남아 덮어쓰기 가드 경고를 반복한다(§5.7 #26). resolveGitWorktreeParent 는 cwd 캐시라 git 은 첫 1회만.
  const gitWt = resolveGitWorktreeParent(normalize(cwd));
  if (gitWt) return { root: gitWt.parentPath, via: 'worktree' };

  let dir = path.resolve(cwd);
  const { root } = path.parse(dir);
  while (dir && dir !== root) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      try {
        if (fs.existsSync(path.join(dir, marker))) return { root: dir, via: 'marker' };
      } catch { /* ignore */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { root: cwd, via: 'none' };
}

function resolveProjectRoot(cwd: string): string {
  return resolveProjectRootInfo(cwd).root;
}

/**
 * §3.5 — 훅 cwd 를 어느 열린 프로젝트에 붙일지(순수 판정). 표식 탐색만 쓰면 표식 없는 프로젝트의 하위 폴더(`cd research/x`)가 유령 인스턴스·탭이 된다(실측). `knownRoots` 를 먼저 본다:
 * ① 표식 루트가 열린 프로젝트면 그대로 ② cwd 를 품은 열린 프로젝트가 없으면 표식 루트 ③ 표식 없음(`none`)이면 cwd 를 품은 가장 깊은 열린 프로젝트
 * ④ 표식 루트가 열린 프로젝트보다 위(모노레포 하위 패키지를 연 경우)면 열린 쪽 ⑤ 그 밖(안의 독립 저장소·워크트리)은 표식 루트.
 * 경로 비교는 `isWithinRoot`/`pathKey` 하나로(대소문자는 OS 가 실제로 무시할 때만 접는다).
 */
export function pickHookProjectRoot(
  found: { root: string; via: ProjectRootVia },
  cwd: string,
  knownRoots: readonly string[],
  within: (child: string, root: string) => boolean = isWithinRoot,
  keyOf: (p: string) => string = normalize,
): string {
  const foundKey = keyOf(found.root);
  if (knownRoots.some((r) => keyOf(r) === foundKey)) return found.root;
  let opened: string | null = null;
  for (const r of knownRoots) {
    if (!within(cwd, r)) continue;
    if (opened === null || keyOf(r).length > keyOf(opened).length) opened = r;
  }
  if (opened === null) return found.root;
  if (found.via === 'none') return opened;
  if (found.via === 'marker' && within(opened, found.root)) return opened;
  return found.root;
}

/** 빈 스냅샷 — 인스턴스가 없을 때 반환 */
function emptySnapshot(): GraphSnapshot {
  return {
    projects: {},
    agents: [],
    topFolders: [],
    children: {},
    edges: [],
    innerEdges: {},
    satellites: {},
    bashHistory: {},
    runningServers: {},
    agentEvents: {},
    agentProjects: {},
    nodeProjects: {},
    fileEdits: {},
    domainEntries: {},
    commandQueues: {},
    completedCommands: {},
    subAgents: {},
    agentPhase: 'waiting' as AgentPhase,
    activeAgentCount: 0,
    satellitePositions: {},
    pipelineChildren: {},
    pipelines: {},
    agentConfigs: {},
    taskEdges: {},
    sessionSources: {},
    sessionStatuses: {},
    worktreeProjects: {},
    stubProjects: {},
    commentBoxes: [],
    captureBubbles: [],
    appBubbles: [],
    playBubbles: [],
    specDocs: [],
    reviewRequests: [],
    labRuns: [],
    shelfBubbles: [],
    costMaps: [],
    auditLogs: [],
    contis: {},
  };
}

/** 배열은 이어붙이고 Record 는 Object.assign. 다중 프로젝트의 모든 방송이 여기를 지나므로 **새 필드는 여기도 추가**해야 화면에 나온다(시험용 export). */
export function mergeSnapshots(a: GraphSnapshot, b: GraphSnapshot): GraphSnapshot {
  const activeCount = a.activeAgentCount + b.activeAgentCount;
  // 어느 한 쪽이라도 working이면 working, 아니면 a 기준
  const agentPhase: AgentPhase =
    a.agentPhase === 'working' || b.agentPhase === 'working'
      ? 'working'
      : a.agentPhase === 'completed' || b.agentPhase === 'completed'
        ? 'completed'
        : 'waiting';

  return {
    projects: { ...a.projects, ...b.projects },
    agents: [...a.agents, ...b.agents],
    topFolders: [...a.topFolders, ...b.topFolders],
    children: { ...a.children, ...b.children },
    edges: [...a.edges, ...b.edges] as ActivityEdge[],
    innerEdges: { ...a.innerEdges, ...b.innerEdges },
    satellites: { ...a.satellites, ...b.satellites },
    bashHistory: { ...a.bashHistory, ...b.bashHistory },
    runningServers: { ...a.runningServers, ...b.runningServers },
    agentEvents: { ...a.agentEvents, ...b.agentEvents },
    agentProjects: { ...a.agentProjects, ...b.agentProjects },
    nodeProjects: { ...a.nodeProjects, ...b.nodeProjects },
    fileEdits: { ...a.fileEdits, ...b.fileEdits },
    domainEntries: { ...a.domainEntries, ...b.domainEntries },
    commandQueues: { ...a.commandQueues, ...b.commandQueues },
    completedCommands: { ...a.completedCommands, ...b.completedCommands },
    subAgents: { ...a.subAgents, ...b.subAgents },
    // §5.5 #17-9 — subAgentManager 가 싱글턴이라 양쪽 값이 같다 → agentId 키 spread(b 우선).
    //   양쪽 다 없으면 필드를 생략해 클라 아이콘이 사라진다.
    runningSubagentTasks: (() => {
      const av = a.runningSubagentTasks;
      const bv = b.runningSubagentTasks;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §5.5 #17-9 ⑦(b) — "방금 끝난 것" 도 같은 싱글턴에서 오므로 같은 규약(b 우선, 둘 다 없으면 생략).
    //   여기 빠뜨리면 프로젝트를 여럿 열었을 때만 결과 구역이 사라진다.
    finishedSubagentTasks: (() => {
      const av = a.finishedSubagentTasks;
      const bv = b.finishedSubagentTasks;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    agentPhase,
    activeAgentCount: activeCount,
    satellitePositions: { ...a.satellitePositions, ...b.satellitePositions },
    pipelineChildren: { ...a.pipelineChildren, ...b.pipelineChildren },
    pipelines: { ...a.pipelines, ...b.pipelines },
    agentConfigs: { ...a.agentConfigs, ...b.agentConfigs },
    // task edges는 Manager 레벨에서 별도 관리 — merge 시 b가 덮어씀 (중복 없음)
    taskEdges: { ...a.taskEdges, ...b.taskEdges },
    sessionSources: { ...a.sessionSources, ...b.sessionSources },
    sessionStatuses: { ...a.sessionStatuses, ...b.sessionStatuses },
    // worktree 버블 ID → worktree 프로젝트명 매핑. SSOT §5.7 #26. 누락되면 클라이언트가
    // 드릴다운 시 effectiveAgentProject 를 부모로 fallback하여 부모 agent가 worktree 뷰에 누출됨.
    worktreeProjects: { ...(a.worktreeProjects ?? {}), ...(b.worktreeProjects ?? {}) },
    uiLocale: a.uiLocale ?? b.uiLocale,
    stubProjects: { ...(a.stubProjects ?? {}), ...(b.stubProjects ?? {}) },
    // Comment Box — id 기준 dedup, 같은 id 면 b(최근 인스턴스) 우선.
    commentBoxes: (() => {
      const map = new Map<string, CommentBox>();
      for (const c of a.commentBoxes ?? []) map.set(c.id, c);
      for (const c of b.commentBoxes ?? []) map.set(c.id, c);
      return Array.from(map.values());
    })(),
    // §5.9 — 캡처 버블 합치기 (id 기준 dedup, 같은 id 면 b 우선)
    captureBubbles: (() => {
      const map = new Map<string, CaptureBubble>();
      for (const c of a.captureBubbles ?? []) map.set(c.id, c);
      for (const c of b.captureBubbles ?? []) map.set(c.id, c);
      return Array.from(map.values());
    })(),
    // §5.14 — 플레이 버블도 같은 규칙(빠뜨리면 다중 프로젝트에서 사라진다).
    playBubbles: (() => {
      const map = new Map<string, PlayBubble>();
      for (const c of a.playBubbles ?? []) map.set(c.id, c);
      for (const c of b.playBubbles ?? []) map.set(c.id, c);
      return Array.from(map.values());
    })(),
    // §5.15 — 스펙 보드도 같은 규칙. 여기서 빠뜨리면 프로젝트를 둘 이상 연 순간
    // 스펙이 방송 스냅샷에서 통째로 사라진다(앱 버블이 그렇게 사라졌던 전례를 따른다).
    specDocs: (() => {
      const map = new Map<string, SpecDoc>();
      for (const c of a.specDocs ?? []) map.set(c.id, c);
      for (const c of b.specDocs ?? []) map.set(c.id, c);
      return Array.from(map.values());
    })(),
    // §5.16 — 리뷰·승인 레인도 같은 규칙. 빠뜨리면 프로젝트를 둘 이상 연 순간 리뷰 카드가
    // 방송 스냅샷에서 사라져 승인·반려 자리가 통째로 없어진다.
    reviewRequests: (() => {
      const map = new Map<string, ReviewRequest>();
      for (const c of a.reviewRequests ?? []) map.set(c.id, c);
      for (const c of b.reviewRequests ?? []) map.set(c.id, c);
      return Array.from(map.values());
    })(),
    // §5.18 — 에이전트 랩도 같은 규칙. 빠뜨리면 프로젝트를 둘 이상 연 순간 랩 표지와 비교 표가
    // 방송 스냅샷에서 통째로 사라진다.
    labRuns: (() => {
      const map = new Map<string, LabRun>();
      for (const c of a.labRuns ?? []) map.set(c.id, c);
      for (const c of b.labRuns ?? []) map.set(c.id, c);
      return Array.from(map.values());
    })(),
    // §5.20 — 스크립트 선반도 같은 규칙. 빠뜨리면 프로젝트를 둘 이상 연 순간 선반이 통째로 사라진다.
    shelfBubbles: (() => {
      const map = new Map<string, ShelfBubble>();
      for (const c of a.shelfBubbles ?? []) map.set(c.id, c);
      for (const c of b.shelfBubbles ?? []) map.set(c.id, c);
      return Array.from(map.values());
    })(),
    // §5.21 — 비용·토큰 지도는 **프로젝트 이름**이 키다. 빠뜨리면 프로젝트를 둘 이상 연 순간
    // 배지와 팝업이 통째로 비어 보인다(서버는 재고 있는데 전선에서 사라진다).
    costMaps: (() => {
      const map = new Map<string, ProjectCostMap>();
      for (const c of a.costMaps ?? []) map.set(c.projectName, c);
      for (const c of b.costMaps ?? []) map.set(c.projectName, c);
      return Array.from(map.values());
    })(),
    // §5.22 — 감사 원장도 프로젝트 이름이 키다. 빠뜨리면 프로젝트를 둘 이상 연 순간
    // 타임라인이 통째로 비어 보인다(서버는 적고 있는데 전선에서 사라진다).
    auditLogs: (() => {
      const map = new Map<string, ProjectAuditLog>();
      for (const c of a.auditLogs ?? []) map.set(c.projectName, c);
      for (const c of b.auditLogs ?? []) map.set(c.projectName, c);
      return Array.from(map.values());
    })(),
    // §5.13 — 내부 앱 버블도 같은 규칙. 빠뜨리면 다중 프로젝트에서
    // 앱 버블이 방송에서 사라진다.
    appBubbles: (() => {
      const map = new Map<string, AppBubble>();
      for (const c of a.appBubbles ?? []) map.set(c.id, c);
      for (const c of b.appBubbles ?? []) map.set(c.id, c);
      return Array.from(map.values());
    })(),
    // §5.5 #17-20 ⑩ — 중단점은 projectName 키라 spread 로 안전(b 우선).
    // 빠뜨리면 다중 프로젝트에서 사라진다.
    debugBreakpoints: (() => {
      const merged = { ...(a.debugBreakpoints ?? {}), ...(b.debugBreakpoints ?? {}) };
      return Object.keys(merged).length > 0 ? merged : undefined;
    })(),
    // 루트 캔버스 바운딩 박스 — projectName 키로 머지 (b 우선)
    layoutBoundsByProject: { ...(a.layoutBoundsByProject ?? {}), ...(b.layoutBoundsByProject ?? {}) },
    // §5.3 #12-3 — 자물쇠도 프로젝트 이름 키다. 빠뜨리면 프로젝트를 둘 이상 연 순간 글리프·메뉴가
    //   "안 잠김"으로 보인다(집행은 서버가 하므로 계속 묻는데 화면만 거짓말을 한다).
    pathLocks: { ...(a.pathLocks ?? {}), ...(b.pathLocks ?? {}) },
    contis: { ...(a.contis ?? {}), ...(b.contis ?? {}) },
    // §4 — 도구 시간·컴팩션 수는 sessionId 키(b 우선). rateLimits 는 글로벌.
    recentToolDurations: { ...(a.recentToolDurations ?? {}), ...(b.recentToolDurations ?? {}) },
    compactCounts: { ...(a.compactCounts ?? {}), ...(b.compactCounts ?? {}) },
    rateLimits: b.rateLimits ?? a.rateLimits,
    claudeUsage: b.claudeUsage ?? a.claudeUsage,
    // §4 — 로그인 상태도 글로벌 1건(계정은 머신 단위).
    claudeAuth: b.claudeAuth ?? a.claudeAuth,
    // §4 API 크레딧 — 글로벌 1건(설정·장부는 머신 단위).
    apiCredits: b.apiCredits ?? a.apiCredits,
    // §4 (첫 실행 설치 온보딩) — CLI 설치 판정도 글로벌 1건(설치는 기기 단위).
    claudeSetup: b.claudeSetup ?? a.claudeSetup,
    // §5.25 — 코덱스 상태 셋도 같은 규칙(글로벌 1건).
    codexAuth: b.codexAuth ?? a.codexAuth,
    codexSetup: b.codexSetup ?? a.codexSetup,
    codexHooks: b.codexHooks ?? a.codexHooks,
    codexModels: b.codexModels ?? a.codexModels,
    codexInventory: b.codexInventory ?? a.codexInventory,
    codexReviews: b.codexReviews ?? a.codexReviews,
    // §5.5 #17-4 — projectName 키라 spread 로 안전하다
    // (인스턴스마다 primary 하나라 키가 겹치지 않는다).
    skillUsageCounts: (() => {
      const av = a.skillUsageCounts;
      const bv = b.skillUsageCounts;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §5.3 #10-2 — Auto Agent 요약(agentId/sessionId 키, b 우선).
    autoAgentSummaries: (() => {
      const av = a.autoAgentSummaries;
      const bv = b.autoAgentSummaries;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §5.3 #10-3 — 검증 런(autoAgentId 키, b 우선).
    //   빠뜨리면 다중 프로젝트에서만 런이 사라진다 — 단일 프로젝트 시험으론 안 잡힌다.
    autoAgentRuns: (() => {
      const av = a.autoAgentRuns;
      const bv = b.autoAgentRuns;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §4 — 에이전트 작업 신고(agentId 키, b 우선).
    agentReports: (() => {
      const av = a.agentReports;
      const bv = b.agentReports;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
// §5.5 #17-36 — 메인 탭 스티키 메모 (agentId 1차 키 → 단순 spread 안전, b 우선).
    //   여기 빠지면 **프로젝트를 2개 이상 열었을 때만** 메모가 사라진다(단일 프로젝트 테스트로는 안 잡힌다).
    agentMemos: (() => {
      const av = a.agentMemos;
      const bv = b.agentMemos;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
        // §4 — 에이전트 질문 카드(agentReports 와 동형).
    agentQuestions: (() => {
      const av = a.agentQuestions;
      const bv = b.agentQuestions;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §4 — 에이전트 검수 요청 카드(agentReports 와 동형).
    agentReviews: (() => {
      const av = a.agentReviews;
      const bv = b.agentReviews;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §4 — 에이전트 번호 목록 정렬 카드(agentReports 와 동형).
    agentLists: (() => {
      const av = a.agentLists;
      const bv = b.agentLists;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §4 — 에이전트 피드백(agentReports 와 동형).
    agentFeedbacks: (() => {
      const av = a.agentFeedbacks;
      const bv = b.agentFeedbacks;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §5.5 #17-11 — 세션 루프(subAgentId 키, b 우선).
    //   빠지면 다중 프로젝트 병합 때 루프 설정이 사라진다.
    sessionLoops: (() => {
      const av = a.sessionLoops;
      const bv = b.sessionLoops;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §5.5 #17-17 — 세션 목표(subAgentId 키). 빠지면 다중 프로젝트
    //   병합 때 목표·퍼센트가 사라진다.
    sessionGoals: (() => {
      const av = a.sessionGoals;
      const bv = b.sessionGoals;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §5.5 #17-17 ⑪(a) — 종류 카드는 `key` 1차 키. **여기 빠져 있었다** — 프로젝트를 2개 이상 열면
    //   병합 순간 종류 표가 통째로 사라져 무대의 색·글리프가 전부 중립 점이 되고 종류 서랍이 빈다
    //   (카드는 디스크에 그대로 있는 표시 전용 결함 — 바로 위 두 카드가 겪은 그것과 같은 결).
    visualKinds: (() => {
      const av = a.visualKinds;
      const bv = b.visualKinds;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §5.5 #17-17 ⑫(a) — 팔레트는 **배열**이라 spread 로 합쳐지지 않는다. id 로 접고(같은 id 면 많이
    //   배운 쪽), 산식과 **같은 순서**로 다시 세운 뒤 상한에서 자른다 — 프로젝트를 2개 연 순간
    //   팔레트만 다른 규칙으로 서면 사용자는 자기 습관을 알아볼 수 없다.
    goalActions: (() => {
      const av = a.goalActions;
      const bv = b.goalActions;
      if (!av && !bv) return undefined;
      const byId = new Map<string, GoalActionCard>();
      for (const card of [...(av ?? []), ...(bv ?? [])]) {
        const cur = byId.get(card.id);
        if (!cur || card.useCount > cur.useCount) byId.set(card.id, card);
      }
      return [...byId.values()]
        .sort((x, y) => {
          if (!!x.pinned !== !!y.pinned) return x.pinned ? -1 : 1;
          if (x.useCount !== y.useCount) return y.useCount - x.useCount;
          return (y.lastUsedAt ?? 0) - (x.lastUsedAt ?? 0) || x.id.localeCompare(y.id);
        })
        .slice(0, GOAL_ACTION_MAX);
    })(),
    // §5.10 — 자동 목표 요약(projectName 키).
    //   빠지면 다중 프로젝트에서 절차 파일이 있는데도 점검 카드가 "0개"로 보인다.
    autoGoal: (() => {
      const av = a.autoGoal;
      const bv = b.autoGoal;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §5.3 #10-4 — 오케스트라 요약도 projectName 1차 키 → 단순 spread 안전. 빠지면 프로젝트를 2개 이상
    //   열었을 때 한쪽의 켬/끔·지휘 기록이 화면에서 사라진다(자동 목표가 적어 둔 그 결함).
    orchestra: (() => {
      const av = a.orchestra;
      const bv = b.orchestra;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §5.3 #10-5 — 설정 덜어내기 요약도 projectName 1차 키 → 단순 spread 안전.
    configTrim: (() => {
      const av = a.configTrim;
      const bv = b.configTrim;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §5.5 #17-28 — 주입원 오버라이드는 층이 셋이라 한 겹 안쪽(`projects`/`agents`/`sessions`)까지 합친다.
    //   겉만 spread 하면 다중 프로젝트에서 한쪽의 껐던 설정이 사라진다. **층을 늘리면 여기도 늘린다.**
    contextOverrides: (() => {
      const av = a.contextOverrides;
      const bv = b.contextOverrides;
      if (!av && !bv) return undefined;
      return {
        projects: { ...(av?.projects ?? {}), ...(bv?.projects ?? {}) },
        agents: { ...(av?.agents ?? {}), ...(bv?.agents ?? {}) },
        sessions: { ...(av?.sessions ?? {}), ...(bv?.sessions ?? {}) },
        updatedAt: Math.max(av?.updatedAt ?? 0, bv?.updatedAt ?? 0),
      };
    })(),
  };
}

// 전역 유일 표시명(식별=path, 이름=표시)

/** projectId 정규화 — appState.normPath / projectGraph.normalize 와 동일 semantics.
 *  대소문자는 그 플랫폼이 실제로 무시할 때만 접는다(linux 는 접지 않는다). */
function normPathId(p: string): string {
  return pathKey(p);
}

/** 같은 basename·다른 경로 충돌 시 최소 부모 세그먼트로 결정적·대칭 구분자 산출. */
function pathDiscriminator(p: string, others: string[]): string {
  const partsOf = (x: string): string[] => normPathId(x).split('/').filter(Boolean);
  const mine = partsOf(p);
  const oth = others.filter((o) => normPathId(o) !== normPathId(p)).map(partsOf);
  for (let depth = 1; depth < mine.length; depth++) {
    const tail = mine.slice(mine.length - 1 - depth, mine.length - 1).join('/');
    if (!tail) continue;
    const collides = oth.some((o) => o.slice(o.length - 1 - depth, o.length - 1).join('/') === tail);
    if (!collides) return tail;
  }
  let h = 0;
  const s = normPathId(p);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36).slice(0, 6);
}

/** id(normPath) → 전역 유일 표시명. 단일 basename 은 평문, 충돌 그룹만 `name (구분자)`. */
function computeUniqueDisplayNames(items: { id: string; name: string; path: string }[]): Map<string, string> {
  const byBase = new Map<string, { id: string; name: string; path: string }[]>();
  for (const it of items) {
    const b = it.name.toLowerCase();
    const arr = byBase.get(b);
    if (arr) arr.push(it);
    else byBase.set(b, [it]);
  }
  const out = new Map<string, string>();
  for (const group of byBase.values()) {
    const distinct = new Map<string, { id: string; name: string; path: string }>();
    for (const it of group) distinct.set(it.id, it);
    if (distinct.size <= 1) {
      for (const it of distinct.values()) out.set(it.id, it.name);
      continue;
    }
    const paths = [...distinct.values()].map((d) => d.path);
    for (const it of distinct.values()) {
      out.set(it.id, `${it.name} (${pathDiscriminator(it.path, paths)})`);
    }
  }
  return out;
}

/** 단일 프로젝트 인스턴스의 서브스냅샷에서 프로젝트명을 from→to 로 일괄 치환.
 *  인스턴스 sub-snapshot 은 자기 프로젝트 1개만 참조하므로 평면 치환이 안전·완결. */
function relabelSubSnapshot(snap: GraphSnapshot, from: string, to: string): GraphSnapshot {
  if (from === to) return snap;
  const renameKey = <V>(rec: Record<string, V> | undefined): Record<string, V> | undefined => {
    if (!rec || !(from in rec)) return rec;
    const next: Record<string, V> = {};
    for (const [k, v] of Object.entries(rec)) next[k === from ? to : k] = v;
    return next;
  };
  const renameVal = (rec: Record<string, string> | undefined): Record<string, string> | undefined => {
    if (!rec) return rec;
    let touched = false;
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (v === from) { next[k] = to; touched = true; } else next[k] = v;
    }
    return touched ? next : rec;
  };
  const projects = { ...snap.projects };
  if (from in projects) {
    const info = projects[from]!;
    delete projects[from];
    projects[to] = { ...info, name: to };
  }
  return {
    ...snap,
    projects,
    agentProjects: renameVal(snap.agentProjects) ?? snap.agentProjects,
    nodeProjects: renameVal(snap.nodeProjects) ?? snap.nodeProjects,
    worktreeProjects: renameVal(snap.worktreeProjects),
    gitDirty: renameKey(snap.gitDirty),
    layoutBoundsByProject: renameKey(snap.layoutBoundsByProject),
    // §5.3 #12-3 — 자물쇠도 projectName 키라 표시명으로 relabel(클라가 activeProject 로 찾는다).
    pathLocks: renameKey(snap.pathLocks),
    commentBoxes: snap.commentBoxes?.map((c) => (c.projectName === from ? { ...c, projectName: to } : c)),
    captureBubbles: snap.captureBubbles?.map((c) => (c.projectName === from ? { ...c, projectName: to } : c)),
    appBubbles: snap.appBubbles?.map((c) => (c.projectName === from ? { ...c, projectName: to } : c)),
    playBubbles: snap.playBubbles?.map((c) => (c.projectName === from ? { ...c, projectName: to } : c)),
    specDocs: snap.specDocs?.map((c) => (c.projectName === from ? { ...c, projectName: to } : c)),
    reviewRequests: snap.reviewRequests?.map((c) => (c.projectName === from ? { ...c, projectName: to } : c)),
    labRuns: snap.labRuns?.map((c) => (c.projectName === from ? { ...c, projectName: to } : c)),
    shelfBubbles: snap.shelfBubbles?.map((c) => (c.projectName === from ? { ...c, projectName: to } : c)),
    costMaps: snap.costMaps?.map((c) => (c.projectName === from ? { ...c, projectName: to } : c)),
    auditLogs: snap.auditLogs?.map((c) => (c.projectName === from ? { ...c, projectName: to } : c)),
    // §5.5 #17-4 — projectName 1차 키 relabel.
    skillUsageCounts: renameKey(snap.skillUsageCounts),
    // §5.10 — 자동 목표 요약도 projectName 1차 키라 함께 relabel 해야
    //   클라(activeProject 키 조회)가 같은 이름으로 찾을 수 있다.
    autoGoal: renameKey(snap.autoGoal),
    // §5.3 #10-4 — 오케스트라 요약도 projectName 1차 키라 함께 relabel.
    orchestra: renameKey(snap.orchestra),
    // §5.3 #10-5 — 설정 덜어내기 요약도 projectName 1차 키라 함께 relabel.
    configTrim: renameKey(snap.configTrim),
  };
}

// ─── ProjectGraphManager 클래스 ───

export class ProjectGraphManager {
  /** normalized cwd → ProjectGraph 인스턴스 */
  private instances = new Map<string, ProjectGraph>();

  /** B 진단(§3.2.2) — getSnapshot 이 라이브에서 제외한 인스턴스(worktree/hidden)에서 발견한
   *  커스텀 에이전트 sessionId. 같은 sessionId 를 매 스냅샷마다 재경고하지 않도록 1회만 로깅. */
  private warnedHiddenCustomAgents = new Set<string>();

  /** §4 — Claude.ai 한도 사용률(글로벌 1건, 외부 statusline 스크립트가 푸시). */
  private globalRateLimits?: RateLimitInfo;

  /** §4 — Claude 앱 `/usage` 와 같은 원천(OAuth)의 사용량(글로벌 1건). */
  private globalClaudeUsage?: ClaudeUsageInfo;

  /** §4 — Claude 계정 로그인 상태(글로벌 1건, `claude auth status`). */
  private globalClaudeAuth?: ClaudeAuthStatus;

  /** §4 (첫 실행 설치 온보딩) — `claude` CLI 설치 판정 (글로벌 1건, 기기 단위). */
  private globalClaudeSetup?: ClaudeSetupState;
  /** §5.25 — 코덱스 상태 셋도 글로벌 1건이다(계정·설치·훅 전부 기기 단위). */
  private globalCodexAuth?: CodexAuthStatus;
  private globalCodexSetup?: CodexSetupState;
  private globalCodexHooks?: CodexHookState;
  private globalCodexModels?: CodexModelCatalog;
  private globalCodexInventory?: CodexInventory;
  private globalCodexReviews?: CodexReviewRun[];

  /** project name → stub 메타 (hydrated 인스턴스가 없는 프로젝트) */
  private stubs = new Map<string, ProjectMetaSnapshot>();

  /**
   * §5.3 #12-3 — stub 프로젝트의 자물쇠(키 = 정규화 경로). 유휴 해제 중에도 집행에서 빠지면 다른 세션이 잠긴 파일을 연다
   * — 내릴 때 넘겨받고, 부팅 뒤 안 올라온 탭은 처음 물을 때 `identity.json` 에서 읽는다. 올라오면 인스턴스가 정본이라 이 칸은 안 읽힌다.
   */
  private stubPathLocks = new Map<string, { name: string; locks: PathLock[] }>();

  /** hydrate 진행 중인 project name 집합 — 동시 hydrate 방지 */
  private hydrating = new Set<string>();

  /** session_id → normalized cwd (세션 라우팅) */
  private sessionRouting = new Map<string, string>();

  /** Manager 레벨 작업 흐름 엣지 (TaskEdge ID → TaskEdge)
   *  TODO: ProjectGraph 내 taskEdges를 여기로 이동 */
  private taskEdges = new Map<string, TaskEdge>();

  /** sessionLifecycle이 주입하는 스냅샷 보조 데이터 — getSnapshot에서 합침 */
  private lifecycleSnapshotProvider:
    | (() => {
        sessionSources: Record<string, import('@vibisual/shared').SessionSource>;
        sessionStatuses: Record<string, import('@vibisual/shared').SessionLifeStatus>;
      })
    | null = null;

  setLifecycleSnapshotProvider(
    fn: () => {
      sessionSources: Record<string, import('@vibisual/shared').SessionSource>;
      sessionStatuses: Record<string, import('@vibisual/shared').SessionLifeStatus>;
    },
  ): void {
    this.lifecycleSnapshotProvider = fn;
  }

  /** GitStatusService가 주입하는 dirty 플래그 맵 (§7.6 root 버블 dirty dot 용) */
  private gitDirtyProvider: (() => Record<string, boolean>) | null = null;

  setGitDirtyProvider(fn: () => Record<string, boolean>): void {
    this.gitDirtyProvider = fn;
  }

  /**
   * §5.11 — 플러그인 집행 실측(projectPath → pluginId → 값). 방송 지점이 스무 곳이 넘어 호출부마다 얹으면 빠진다
   * — `gitDirty` 처럼 provider 로 한 곳에서 채운다(그래프는 플러그인을 모른다).
   */
  private pluginFactsProvider: (() => Record<string, Record<string, import('@vibisual/shared').PluginFactMap>> | undefined) | null = null;

  setPluginFactsProvider(fn: () => Record<string, Record<string, import('@vibisual/shared').PluginFactMap>> | undefined): void {
    this.pluginFactsProvider = fn;
  }

  /** hydrateProject / unloadProject 성공 직후 호출되는 콜백 (broadcast 트리거용) */
  private mutatedCallback: (() => void) | null = null;

  setOnMutated(fn: () => void): void {
    this.mutatedCallback = fn;
  }

  /** 탭 닫기로 숨긴 프로젝트 이름 (Manager 레벨) */
  private hiddenProjects = new Set<string>();

  // ─── 참조 주입 (index.ts에서 호출) ───

  private poppedCommandsRef: Map<string, { text: string; queuedAt: number; poppedAt: number }[]> = new Map();
  private commandQueuesRef: Map<string, QueuedCommand[]> = new Map();
  private completedCommandArchiveRef: Map<string, QueuedCommand[]> = new Map();

  setPoppedCommandsRef(ref: Map<string, { text: string; queuedAt: number; poppedAt: number }[]>): void {
    this.poppedCommandsRef = ref;
    for (const inst of this.instances.values()) inst.setPoppedCommandsRef(ref);
  }

  setCommandQueuesRef(ref: Map<string, QueuedCommand[]>): void {
    this.commandQueuesRef = ref;
    for (const inst of this.instances.values()) inst.setCommandQueuesRef(ref);
  }

  setCompletedCommandArchiveRef(ref: Map<string, QueuedCommand[]>): void {
    this.completedCommandArchiveRef = ref;
    for (const inst of this.instances.values()) inst.setCompletedCommandArchiveRef(ref);
  }

  // ─── 인스턴스 조회 헬퍼 ───

  /** session_id → 인스턴스 조회 */
  private getInstanceForSession(sessionId: string): ProjectGraph | null {
    const cwd = this.sessionRouting.get(sessionId);
    return cwd ? (this.instances.get(cwd) ?? null) : null;
  }

  /** §3.5 — 이 세션 키의 버블을 실제로 가진 인스턴스(둘 이상이면 커스텀 버블 주인). `sessionRouting` 은 휘발성 캐시라 틀릴 수 있다 — 버블이 있는 곳이 사실이다. */
  private findSessionHolder(sessionId: string): { key: string; inst: ProjectGraph } | null {
    let first: { key: string; inst: ProjectGraph } | null = null;
    for (const [key, inst] of this.instances) {
      const agent = inst.getAgentBySession(sessionId);
      if (!agent) continue;
      if (agent.customCreated) return { key, inst };
      if (!first) first = { key, inst };
    }
    return first;
  }

  /**
   * 다른 인스턴스도 이 세션 키를 쥐었나(`setSessionHeldElsewhere`) — 공유 맵(명령 큐·완료 이력)은 전 프로젝트가 한 키로 쓰므로,
   * 제 사본을 치운다고 주인의 큐까지 지우면 안 된다.
   */
  private isSessionHeldByOtherInstance(sessionId: string, self: ProjectGraph): boolean {
    for (const inst of this.instances.values()) {
      if (inst !== self && inst.getAgentBySession(sessionId)) return true;
    }
    return false;
  }

  /** 열린 최상위 프로젝트의 루트인가(hydrate 된 인스턴스 또는 stub). */
  private isOpenProjectRoot(rootCwd: string): boolean {
    const key = normalize(rootCwd);
    return this.listOpenProjectRoots().some((r) => normalize(r) === key);
  }

  /** project name → 인스턴스 조회. primary 일치 우선, worktree 이름처럼 primary 가 아닌 경우 인스턴스의 projects Map 포함 여부로 매치 (todo0417 B-2). */
  private getInstanceByName(name: string): ProjectGraph | null {
    for (const inst of this.instances.values()) {
      if (inst.getPrimaryProject()?.name === name) return inst;
    }
    for (const inst of this.instances.values()) {
      if (inst.getProjectByName(name)) return inst;
    }
    // 클라는 전역 유일 표시명("client (other)")이나 path 를 보낼 수 있다 —
    // raw name 이 안 맞으면 여기서 한 번 더 해소한다(단일 chokepoint).
    const resolved = this.resolveProjectRef(name);
    if (resolved) return this.getInstanceByPath(resolved.path);
    return null;
  }

  /** agentId를 가진 인스턴스 탐색 */
  private findInstanceByAgentId(agentId: string): ProjectGraph | null {
    for (const inst of this.instances.values()) {
      if (inst.hasAgentId(agentId)) return inst;
    }
    return null;
  }

  /** nodeId를 가진 인스턴스 탐색 */
  private findInstanceByNodeId(nodeId: string): ProjectGraph | null {
    for (const inst of this.instances.values()) {
      if (inst.hasNodeId(nodeId)) return inst;
    }
    return null;
  }

  /** 첫 번째(primary) 인스턴스 */
  private primaryInstance(): ProjectGraph | null {
    const first = this.instances.values().next();
    return first.done ? null : first.value;
  }

  /**
   * §4 온보딩 — 인스턴스가 없을 때도 사는 UI 언어. 온보딩 창은 프로젝트가 없을 때 뜨므로, 인스턴스에만 두면 고른 언어가 사라지고 첫 인스턴스의 `'en'` 이 되돌린다
   * — 매니저가 들고 새 인스턴스에 씨앗으로 준다. 영속 SSOT 는 `ProjectCheckpoint.uiLocale` 이고, 이 값은 자기 값이 없는 인스턴스에만 실린다.
   */
  private uiLocale: UiLocale = DEFAULT_UI_LOCALE;

  /** §2.1 (B) — 최상위 외부 폴더 예산의 씨앗. 새로 서는 인스턴스가 이 값을 물려받는다. */
  private externalTopBudget: number = EXTERNAL_TOP_BUDGET_DEFAULT;

  /** §5.23 웹 버블 묶기 씨앗(새 인스턴스가 물려받는다). 기본은 **묶지 않음**, 앱이 부팅 때 저장값(없으면 `WEB_GROUP_DEFAULTS` — 켬)을 넣는다. */
  private webGroup: WebGroupSettings = { ...WEB_GROUP_OFF };

  getUiLocale(): UiLocale {
    return this.primaryInstance()?.getUiLocale() ?? this.uiLocale;
  }

  /** primary 인스턴스에 저장 + 전 인스턴스에 전파(스냅샷 일관성). 변경이 있었으면 true. */
  setUiLocale(locale: UiLocale): boolean {
    // 인스턴스가 0개여도 **여기서는 반드시 남는다** — 온보딩 중에 고른 언어가 사는 자리.
    const seedChanged = this.uiLocale !== locale;
    this.uiLocale = locale;
    let changed = false;
    for (const inst of this.instances.values()) {
      if (inst.setUiLocale(locale)) changed = true;
    }
    return changed || seedChanged;
  }

  /** §2.1 (B) — 외부 폴더 예산을 모든 인스턴스에 먹이고 씨앗으로도 남긴다(`setUiLocale` 과 같은 이유 — 나중에 hydrate 되는 탭만 기본값이 되지 않게). */
  setExternalTopBudget(budget: number): void {
    this.externalTopBudget = budget;
    for (const inst of this.instances.values()) inst.setExternalTopBudget(budget);
  }

  /** §5.23 — 묶기 설정을 모든 인스턴스에 먹이고 씨앗으로 남긴다(나중에 hydrate 되는 탭만 호스트별 버블로 갈리지 않게). */
  setWebGroupSettings(settings: WebGroupSettings): void {
    this.webGroup = normalizeWebGroupSettings(settings);
    for (const inst of this.instances.values()) inst.setWebGroupSettings(this.webGroup);
  }

  getWebGroupSettings(): WebGroupSettings {
    return { ...this.webGroup };
  }

  // ─── 새 인스턴스 생성 헬퍼 ───

  private scenarioSeedCache: string | null = null;
  private scenarioSeedByRoot = new Map<string, string>();

  private createInstance(cwd: string): ProjectGraph {
    const inst = new ProjectGraph();
    // §4 (첫 실행 온보딩) — 지금 쓰고 있는 UI 언어를 물려준다. 이 한 줄이 없으면 온보딩 중에
    //   고른 언어가, 폴더를 고르는 순간 서는 이 인스턴스의 기본값 'en' 에 덮여 되돌아간다.
    //   저장된 값이 있는 프로젝트는 `restoreFromCheckpoint` 가 곧바로 자기 값으로 바꾼다.
    inst.setUiLocale(this.uiLocale);
    // §2.1 (B) — 외부 폴더 예산도 같은 이유로 물려준다. 이 줄이 없으면 나중에 hydrate 되는
    //   프로젝트만 기본값(12)으로 돌아, 같은 앱 안에서 탭마다 화면 밀도가 달라진다.
    inst.setExternalTopBudget(this.externalTopBudget);
    // §5.23 — 웹 버블 묶기도 같은 이유로 물려준다.
    inst.setWebGroupSettings(this.webGroup);
    inst.setPoppedCommandsRef(this.poppedCommandsRef);
    inst.setCommandQueuesRef(this.commandQueuesRef);
    inst.setCompletedCommandArchiveRef(this.completedCommandArchiveRef);
    // §5.1 #2-1 (C) — 내용 언급을 다 읽어 별자리 근거가 바뀌면 화면을 다시 민다(16ms 디바운스 — 새 타이머 ❌).
    //   함수로 넘긴다: 콜백은 나중에 주입될 수 있다(`setOnMutated`).
    inst.setOnAsyncChange(() => this.mutatedCallback?.());
    // §3.5 — 위 세 맵은 전 인스턴스 공유 객체다. 같은 세션 키를 다른 인스턴스가 쥐고 있으면 그 줄은 남긴다
    //   (아니면 주인의 큐·이력을 남이 지운다 — 실측 2026-09-30).
    inst.setSessionHeldElsewhere((sessionId) => this.isSessionHeldByOtherInstance(sessionId, inst));
    // §7.11 (프로젝트 격리) — "이 포트 서버가 남의 것인가"는 열린 프로젝트 전부를 알아야 한다. 값이 아니라 함수로 준다(이 인스턴스는 아직 `instances` 밖이다).
    //   `instances` 만으론 부족하다(막 켠 직후엔 hydrate 된 탭 하나뿐이라 격리가 안 선다) — hydrate 와 무관한 `openProjects`(AppState SSOT)와 합집합.
    inst.setKnownProjectRootsProvider(() => {
      const roots = new Set<string>(this.instances.keys());
      for (const p of loadAppState().openProjects) roots.add(p);
      return [...roots];
    });
    if (this.onSnapshotChange) inst.setOnSnapshotChange(this.onSnapshotChange);
    const key = normalize(cwd);

    if (!this.scenarioSeedByRoot.get(key)) {
      const selfMd = this.tryReadProjectScenario(cwd);
      if (selfMd) this.scenarioSeedByRoot.set(key, selfMd);
    }
    return inst;
  }

  private tryReadProjectScenario(rootCwd: string): string | null {
    const candidates = [
      path.join(rootCwd, 'docs', 'SCENARIO.md'),
      path.join(rootCwd, 'SCENARIO.md'),
      path.join(rootCwd, 'CLAUDE.md'),
      path.join(rootCwd, 'README.md'),
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
      } catch { /* next */ }
    }
    return null;
  }

  private onSnapshotChange?: () => void;

  /** 비동기 감시 이벤트(포트 탐지 등)에서 broadcast를 트리거하는 콜백 등록 */
  setOnSnapshotChange(cb: () => void): void {
    this.onSnapshotChange = cb;
    for (const inst of this.instances.values()) inst.setOnSnapshotChange(cb);
  }

  /** 모든 인스턴스에서 iframe 생사 확인 → 죽은 것 제거 (index.ts 주기 호출용) */
  async checkIframesAlive(): Promise<boolean> {
    let changed = false;
    for (const inst of this.instances.values()) {
      if (await inst.checkIframesAlive()) changed = true;
    }
    return changed;
  }

  /** 모든 인스턴스에서 JSONL 기반 background shell 복원 (startup 1회) */
  rehydrateAllBackgroundShells(): void {
    for (const inst of this.instances.values()) {
      inst.rehydrateAllBackgroundShells();
    }
  }

  /** DEBUG: background shell 복원 진단 정보 */
  diagnoseBackgroundShells(): unknown {
    const instances: unknown[] = [];
    for (const [key, inst] of this.instances) {
      instances.push({
        instanceKey: key,
        primaryProject: inst.getPrimaryProject()?.name,
        sessions: inst.getBackgroundShellDiagnosis(),
      });
    }
    return { instanceCount: this.instances.size, instances };
  }

  // Stub/Hydrate/Unload lifecycle — 키는 projectId(정규화 path). raw name 키면 같은 basename 다른 경로 둘이 열릴 때
  // registerStub 가 덮어써 부팅 때 한 프로젝트가 사라진다(§3.5). 외부 인자(name|path)는 stubRefToKey 로 해소한다.

  /** ref(path 우선, raw name 폴백) → 정규화 path 키. */
  private stubRefToKey(ref: string): string | null {
    if (!ref) return null;
    const k = normalize(ref);
    if (this.stubs.has(k)) return k;
    for (const [sk, meta] of this.stubs) {
      if (meta.project.name === ref) return sk;
    }
    // path/표시명 폴백 — resolveProjectRef 가 해소한 path 의 stub 키.
    const resolved = this.resolveProjectRef(ref);
    if (resolved) {
      const rk = normalize(resolved.path);
      if (this.stubs.has(rk)) return rk;
    }
    return null;
  }

  /** path 로 hydrated 인스턴스 조회 (instances 는 normalize(path) 키). */
  private getInstanceByPath(p: string): ProjectGraph | null {
    return this.instances.get(normalize(p)) ?? null;
  }

  /** stub 등록. 같은 path 가 hydrated 면 no-op. 더 오래된 stub 이면 skip. 키=정규화 path. */
  registerStub(meta: ProjectMetaSnapshot): void {
    const key = normalize(meta.project.path);
    const name = meta.project.name;
    if (this.getInstanceByPath(meta.project.path)) {
      logger.debug(`registerStub: "${name}" (${meta.project.path}) already hydrated — skip`);
      return;
    }
    const existing = this.stubs.get(key);
    if (existing && existing.lastSavedAt >= meta.lastSavedAt) {
      return;
    }
    if (meta.project.parentProjectPath !== undefined) {
      if (!this.getInstanceByPath(meta.project.parentProjectPath) && !this.stubs.has(normalize(meta.project.parentProjectPath))) {
        logger.warn(`registerStub: worktree "${name}" registered without a known parent project`);
      }
    }
    this.stubs.set(key, meta);
  }

  /** stub 으로 등록됐고 같은 path 의 hydrated 인스턴스가 없으면 true. ref=path|name. */
  isStubbed(ref: string): boolean {
    const key = this.stubRefToKey(ref);
    if (!key) return false;
    const meta = this.stubs.get(key);
    return !!meta && !this.getInstanceByPath(meta.project.path);
  }

  /** stub → checkpoint 로드 → 인스턴스 복원. worktree면 부모를 먼저 재귀 hydrate. ref=path|name. */
  hydrateProject(ref: string): { ok: boolean; reason?: 'not-found' | 'already-hydrated' | 'load-error' } {
    const key = this.stubRefToKey(ref);
    if (!key) return { ok: false, reason: 'not-found' };
    const meta = this.stubs.get(key);
    if (!meta) return { ok: false, reason: 'not-found' };

    if (this.getInstanceByPath(meta.project.path)) {
      return { ok: false, reason: 'already-hydrated' };
    }
    if (this.hydrating.has(key)) {
      return { ok: false, reason: 'already-hydrated' };
    }

    this.hydrating.add(key);
    try {
      if (meta.project.parentProjectPath !== undefined) {
        const parentPath = meta.project.parentProjectPath;
        if (this.isStubbed(parentPath)) {
          const parentResult = this.hydrateProject(parentPath);
          if (!parentResult.ok && parentResult.reason !== 'already-hydrated') {
            logger.warn(`hydrateProject: parent "${parentPath}" hydrate failed (${parentResult.reason}) — continuing with "${meta.project.name}"`);
          }
        }
      }

      const cp = loadCheckpointByMeta(meta);
      if (!cp) {
        logger.warn(`hydrateProject: failed to load checkpoint for "${meta.project.name}" (${meta.project.path})`);
        return { ok: false, reason: 'load-error' };
      }

      this.restoreFromCheckpoint(cp);
      this.stubs.delete(key);
      logger.info(`hydrateProject: "${meta.project.name}" (${meta.project.path}) hydrated`);
      this.postHydrateMaintenance(meta.project.name);
      this.mutatedCallback?.();
      return { ok: true };
    } finally {
      this.hydrating.delete(key);
    }
  }

  /** hydrated 인스턴스를 flush → destroy → stub으로 강등. ref=path|name. */
  unloadProject(ref: string): { ok: boolean; reason?: 'not-found' | 'not-hydrated' } {
    const resolved = this.resolveProjectRef(ref);
    const inst = resolved ? this.getInstanceByPath(resolved.path) : this.getInstanceByName(ref);
    const stubKey = resolved ? normalize(resolved.path) : this.stubRefToKey(ref);
    const stub = stubKey ? this.stubs.get(stubKey) : undefined;
    if (!inst) {
      return stub ? { ok: false, reason: 'not-hydrated' } : { ok: false, reason: 'not-found' };
    }
    const rawName = resolved?.rawName ?? ref;
    // §5.4 #14 — × 로 닫은(hidden) 프로젝트는 stub 으로 강등하지 않고 남은 stub 도 지운다 — 닫기 2단 흐름(`DELETE` → `unload-project`)에서 되살아나 두 번 눌러야 닫힌다.
    //   닫지 않은 배경 탭의 유휴 해제는 stub 을 남긴다(아니면 탭이 사라진다).
    const closedByUser = inst.isProjectHidden(rawName) || this.hiddenProjects.has(rawName);

    try {
      const cp = inst.toProjectCheckpoint(rawName);
      writeCheckpoint(cp);
    } catch (err) {
      logger.warn(`unloadProject: checkpoint flush failed for "${rawName}": ${err instanceof Error ? err.message : String(err)}`);
    }

    const projectInfo = inst.getProjectByName(rawName) ?? inst.getPrimaryProject();

    for (const [key, i] of this.instances) {
      if (i === inst) {
        this.instances.delete(key);
        break;
      }
    }
    for (const [sid, key] of this.sessionRouting) {
      if (!this.instances.has(key)) this.sessionRouting.delete(sid);
    }

    if (projectInfo && closedByUser) {
      // 닫은 탭은 stub 으로 돌려놓지 않는다. DELETE 가 먼저 지웠어도, 순서가 뒤바뀌어 이 unload 가
      // 먼저 도착했어도 결과가 같도록 여기서 한 번 더 지운다(어느 쪽이 먼저든 탭은 사라진 채 유지).
      this.stubs.delete(normalize(projectInfo.path));
      logger.info(`unloadProject: "${rawName}" unloaded → closed (user-closed tab, stub 유지 ❌)`);
      this.mutatedCallback?.();
      return { ok: true };
    }

    if (projectInfo) {
      // checkpointPath: 직전 unload 직전 DELETE /api/projects/:name 가 stub 을 비웠을 수도 있어
      // stub?.checkpointPath 만 의존하면 빈 문자열이 박혀 다음 hydrate 가 빈 경로로 실패한다.
      // writeCheckpoint 가 방금 저장한 실제 디스크 경로를 projectDirForInfo 로 직접 계산해 채운다.
      let resolvedCheckpointPath = stub?.checkpointPath ?? '';
      if (!resolvedCheckpointPath) {
        try {
          resolvedCheckpointPath = path.join(projectDirForInfo(projectInfo), 'checkpoint.json');
        } catch (err) {
          logger.warn(`unloadProject: failed to resolve checkpointPath for "${rawName}": ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      const nowMeta: ProjectMetaSnapshot = {
        project: projectInfo,
        lastSavedAt: Date.now(),
        createdAt: stub?.createdAt ?? Date.now(),
        checkpointPath: resolvedCheckpointPath,
        isHydrated: false,
      };
      this.stubs.set(normalize(projectInfo.path), nowMeta);
      // §5.3 #12-3 — 내려가는 동안에도 자물쇠는 집행된다. 인스턴스가 들고 있던 것을 넘겨받는다.
      this.stubPathLocks.set(normalize(projectInfo.path), { name: rawName, locks: inst.getPathLocks(rawName) });
    }

    logger.info(`unloadProject: "${rawName}" unloaded → stub`);
    this.mutatedCallback?.();
    return { ok: true };
  }

  /** hydrate 성공 직후 정합성 보정. 실패해도 hydrate 결과는 유지. */
  private postHydrateMaintenance(name: string): void {
    try {
      const orphans = this.cleanupOrphanWorktreeInstances();
      if (orphans > 0) logger.info(`postHydrate[${name}]: removed ${orphans} orphan worktree instance(s)`);
    } catch (err) {
      logger.warn(`postHydrate[${name}]: cleanupOrphanWorktreeInstances failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      const relocated = this.reassignMisroutedTaskEdges();
      if (relocated > 0) logger.info(`postHydrate[${name}]: relocated ${relocated} misrouted task edge(s)`);
    } catch (err) {
      logger.warn(`postHydrate[${name}]: reassignMisroutedTaskEdges failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** stub 프로젝트 메타 전체 반환 (snapshot 합성용) */
  getStubProjects(): Record<string, ProjectMetaSnapshot> {
    return Object.fromEntries(this.stubs);
  }

  /** DELETE /api/projects/:name 뒤 탭이 stub 으로 남지 않게 지운다. hydrated 인스턴스는 건드리지 않는다. 지웠으면 true. */
  removeStubFromMap(ref: string): boolean {
    const key = this.stubRefToKey(ref);
    return key ? this.stubs.delete(key) : false;
  }

  /**
   * §3.2.1-4 — hydrate 가 실패한 stub 을 read-only 로 표시한다(빈 인스턴스 생성을 막는 신호, 표시했으면 true).
   * 지우지 않아야 디스크가 남아 다음 부팅·registerProject 가 백업 복구를 다시 시도한다.
   */
  markStubReadOnly(ref: string, reason: 'load-error'): boolean {
    const key = this.stubRefToKey(ref);
    if (!key) return false;
    const meta = this.stubs.get(key);
    if (!meta) return false;
    this.stubs.set(key, { ...meta, readOnly: true, readOnlyReason: reason });
    logger.warn(`markStubReadOnly: "${meta.project.name}" (${meta.project.path}) isolated read-only (${reason})`);
    return true;
  }

  /** ref(path|name) 이 read-only 격리된 stub 인가. */
  isReadOnly(ref: string): boolean {
    const key = this.stubRefToKey(ref);
    const meta = key ? this.stubs.get(key) : undefined;
    return !!meta?.readOnly;
  }

  /** 프로젝트 name 이 read-only 격리 상태인가(path 해소 경유). */
  isProjectReadOnly(name: string): boolean {
    const resolved = this.resolveProjectRef(name);
    return this.isReadOnly(resolved?.path ?? name);
  }

  /**
   * §3.2.1-4 2차 안전망 — 아직 hydrate 안 된 rootCwd 의 디스크에 영속 데이터(`.vibisual/save` checkpoint/identity·`.bak1`)가 있나.
   * true 면 registerProject 가 hydrate 를 다시 시도하고 실패하면 생성을 거부한다.
   */
  hasUnhydratedDiskData(rootCwd: string): boolean {
    if (this.getInstanceByPath(rootCwd)) return false; // 이미 hydrate 됨 — 보호 불필요
    const saveDir = path.join(rootCwd, '.vibisual', 'save');
    const exists = (f: string): boolean => {
      try { return fs.existsSync(path.join(saveDir, f)); } catch { return false; }
    };
    return exists('checkpoint.json') || exists('checkpoint.json.bak1')
        || exists('identity.json') || exists('identity.json.bak1');
  }

  /** project.path → project name 역매핑 헬퍼 (stub 조회용) */
  private resolveProjectName(projectPath: string): string | null {
    const normPath = normalize(projectPath);
    for (const [name, meta] of this.stubs) {
      if (normalize(meta.project.path) === normPath) return name;
    }
    for (const inst of this.instances.values()) {
      const proj = inst.getPrimaryProject();
      if (proj && normalize(proj.path) === normPath) return proj.name;
    }
    return null;
  }

  /** {path, rawName} 으로 해소한다. 표시명은 전역 유일화로 raw name 과 다를 수 있어 path 를 먼저 맞추고, 실패하면 raw name·stub key(후방호환). */
  resolveProjectRef(ref: string): { path: string; rawName: string } | null {
    if (!ref) return null;
    const k = normalize(ref);
    for (const inst of this.instances.values()) {
      const pp = inst.getPrimaryProject();
      if (pp && normalize(pp.path) === k) return { path: pp.path, rawName: pp.name };
    }
    for (const meta of this.stubs.values()) {
      if (normalize(meta.project.path) === k) return { path: meta.project.path, rawName: meta.project.name };
    }
    // 이름 폴백 (raw name / stub key)
    for (const inst of this.instances.values()) {
      const pp = inst.getPrimaryProject();
      if (pp && pp.name === ref) return { path: pp.path, rawName: pp.name };
    }
    for (const [sk, meta] of this.stubs) {
      if (sk === ref || meta.project.name === ref) return { path: meta.project.path, rawName: meta.project.name };
    }
    // 전역 유일 표시명 폴백 — getSnapshot 과 동일 산식으로 재계산해 역매핑.
    const items: { id: string; name: string; path: string }[] = [];
    const byId = new Map<string, { path: string; rawName: string }>();
    for (const inst of this.instances.values()) {
      const pp = inst.getPrimaryProject();
      if (!pp) continue;
      const id = normPathId(pp.path);
      items.push({ id, name: pp.name, path: pp.path });
      byId.set(id, { path: pp.path, rawName: pp.name });
    }
    for (const meta of this.stubs.values()) {
      const id = normPathId(meta.project.path);
      if (byId.has(id)) continue;
      items.push({ id, name: meta.project.name, path: meta.project.path });
      byId.set(id, { path: meta.project.path, rawName: meta.project.name });
    }
    for (const [id, disp] of computeUniqueDisplayNames(items)) {
      if (disp === ref) return byId.get(id) ?? null;
    }
    return null;
  }

  /**
   * §5.4 #14-3 — 탭 닫기 [닫기]가 멈출 에이전트 id. `ref` 는 닫기와 같은 `resolveProjectRef` 로 푼다(규칙이 둘이면 닫는 것과 멈추는 것이 갈린다).
   * `null` = 모든 인스턴스. 단위는 인스턴스 — 그 안의 워크트리 자식도 함께 회수한다(§5.7 #26).
   */
  listAgentIdsForProject(ref: string | null): string[] {
    const out: string[] = [];
    if (ref === null) {
      for (const inst of this.instances.values()) out.push(...inst.listAgentIds());
      return out;
    }
    const resolved = this.resolveProjectRef(ref);
    if (!resolved) return out;
    const key = normalize(resolved.path);
    // 인스턴스 키는 등록 시점의 rootCwd 라 보통 primaryProject.path 와 같지만, 하위 폴더로
    // 등록됐다 루트로 승격된 경우를 대비해 못 찾으면 primaryProject 로 한 번 더 훑는다.
    let inst = this.instances.get(key);
    if (!inst) {
      for (const candidate of this.instances.values()) {
        const pp = candidate.getPrimaryProject();
        if (pp && normalize(pp.path) === key) { inst = candidate; break; }
      }
    }
    if (inst) out.push(...inst.listAgentIds());
    return out;
  }

  // ─── 프로젝트 등록 ───

  /** cwd로 새 ProjectGraph 인스턴스 등록 (이미 있으면 기존 반환) */
  registerProject(cwd: string): ProjectInfo {
    // 서브디렉터리 → 프로젝트 루트로 승격 (모노레포 서브패키지가 별도 탭으로 뜨지 않게)
    return this.registerProjectAtRoot(resolveProjectRoot(cwd), cwd);
  }

  /**
   * §3.5 — 훅 cwd 로 등록: 열린 프로젝트의 평범한 하위 폴더면 그 프로젝트로 붙인다(`pickHookProjectRoot`).
   * 사용자가 고른 폴더용 `registerProject` 에는 넣지 않는다 — 열린 부모 안의 하위 폴더를 따로 여는 길이 막힌다.
   */
  registerProjectForHookCwd(cwd: string): ProjectInfo {
    return this.registerProjectAtRoot(this.resolveHookProjectRoot(cwd), cwd);
  }

  /** 훅 cwd → 붙일 프로젝트 루트. 판정은 `pickHookProjectRoot` 가 하고 여기서는 열린 루트 목록만 모은다. */
  private resolveHookProjectRoot(cwd: string): string {
    return pickHookProjectRoot(resolveProjectRootInfo(cwd), cwd, this.listOpenProjectRoots());
  }

  /** 열린 최상위 루트(hydrate 인스턴스 + stub). 워크트리는 탭이 아니라 뺀다(§5.7 #26). 경로는 원래 모양. */
  private listOpenProjectRoots(): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (p: string): void => {
      const k = normalize(p);
      if (seen.has(k)) return;
      seen.add(k);
      out.push(p);
    };
    for (const [key, inst] of this.instances) {
      const pp = inst.getPrimaryProject();
      if (pp?.parentProjectPath) continue;
      push(pp && normalize(pp.path) === key ? pp.path : key);
    }
    for (const meta of this.stubs.values()) {
      if (meta.project.parentProjectPath !== undefined) continue;
      push(meta.project.path);
    }
    return out;
  }

  /** 정해진 루트로 등록 — 다시 해석하지 않는다(표식 탐색이 호출자의 루트를 뒤집지 않게). */
  private registerProjectAtRoot(rootCwd: string, cwd: string): ProjectInfo {
    const key = normalize(rootCwd);
    let inst = this.instances.get(key);
    if (!inst) {
      // stub 조회·hydrate 는 path 기준(이름 충돌 무관).
      if (this.isStubbed(rootCwd)) {
        const wasReadOnly = this.isReadOnly(rootCwd);
        logger.info(`ProjectGraphManager: auto-hydrating stub for cwd "${rootCwd}"${wasReadOnly ? ' [read-only retry]' : ''}`);
        const result = this.hydrateProject(rootCwd);
        if (result.ok) {
          const hydratedInst = this.instances.get(key);
          if (hydratedInst) return hydratedInst.registerProject(rootCwd);
        } else if (wasReadOnly || this.hasUnhydratedDiskData(rootCwd)) {
          // §3.2.1-4 — 디스크 데이터가 있는데 hydrate 실패: 빈 인스턴스로 덮지 않게
          // read-only + 생성 거부(호출처가 이벤트를 드롭한다).
          this.markStubReadOnly(rootCwd, 'load-error');
          throw new ReadOnlyProjectError(rootCwd);
        } else {
          logger.warn(`ProjectGraphManager: auto-hydrate failed for "${rootCwd}" (${result.reason}) — creating fresh instance`);
        }
      } else if (this.hasUnhydratedDiskData(rootCwd)) {
        // §3.2.1-4 2차 안전망 — stub 없이 디스크 데이터만 있으면 stub 을 다시 올려 hydrate,
        // 실패하면 read-only + 거부.
        const metas = discoverProjectMetas([rootCwd]);
        const meta = metas.find((m) => normalize(m.project.path) === key);
        if (meta) {
          this.registerStub(meta);
          const r = this.hydrateProject(rootCwd);
          if (r.ok) {
            const hi = this.instances.get(key);
            if (hi) return hi.registerProject(rootCwd);
          }
          this.markStubReadOnly(rootCwd, 'load-error');
          logger.warn(`registerProject: disk data present but hydrate failed for "${rootCwd}" — read-only, refusing empty instance`);
          throw new ReadOnlyProjectError(rootCwd);
        }
        // meta 빌드 실패(project.json 없음 등) — 진짜 신규로 폴백.
      }
      if (!inst) {
        inst = this.createInstance(rootCwd);
        this.instances.set(key, inst);
        logger.info(`ProjectGraphManager: new instance for "${rootCwd}" (from cwd "${cwd}")`);
      }
    }
    const info = inst.registerProject(rootCwd);
    // top-level 프로젝트만 openProjects 에 넣는다(워크트리는 부모 캔버스 버블, §5.7 #26).
    // hook 자동 등록도 이 경로를 탄다.
    if (!info.parentProjectPath) {
      // 식별은 info.path, info.name 은 표시명 캐시.
      const added = appStateAddOpenProject(info.path, info.name);
      if (added) logger.info(`AppState: openProjects += ${info.path} ("${info.name}")`);
    }
    return info;
  }

  // ─── 라우팅: 세션 기반 ───

  processHookEvent(payload: HookEventPayload): ProcessResult | null {
    let inst = this.getInstanceForSession(payload.session_id);
    let routedBy = inst ? 'session-routing' : 'cwd-lookup';

    /*
     * §3.5 — **세션의 버블을 이미 가진 프로젝트가 주인**, cwd 는 그다음이다.
     * 라우팅 표는 휘발성(유휴 해제가 지우고 `custom-…` 세션은 첫 도구 이벤트 전엔 없다)이라 cwd 만 보면 `cd` 한 하위 폴더가 유령 프로젝트가 된다.
     * 실측(2026-09-30): 그 유령의 훅 버블을 2초마다 지우며 공유 명령 큐·이력까지 지워 이력 32건을 잃었다. 버블 주인이 있으면 그리로 보내고 표를 고친다.
     */
    if (!inst || !inst.getAgentBySession(payload.session_id)) {
      const holder = this.findSessionHolder(payload.session_id);
      if (holder && holder.inst !== inst) {
        inst = holder.inst;
        routedBy = 'session-owner';
        this.sessionRouting.set(payload.session_id, holder.key);
      }
    }

    if (!inst && payload.cwd) {
      // 서브디렉터리 cwd → 프로젝트 루트 키로 승격 — 열린 프로젝트의 평범한 하위 폴더는 그 프로젝트다(§3.5)
      const rootCwd = this.resolveHookProjectRoot(payload.cwd);
      const key = normalize(rootCwd);
      inst = this.instances.get(key) ?? null;
      if (!inst) {
        // 우리가 띄운 세션(소유자 태그)은 **새 프로젝트를 만들지 않는다** — 그 세션의 주인 버블은 이미 어느
        //   프로젝트에 있다. 아직 안 깬 열린 프로젝트(stub)면 깨우고, 모르는 폴더면 이벤트를 흘려보낸다.
        if (payload._vibisualOwnerAgentId && !this.isOpenProjectRoot(rootCwd)) {
          dbg('manager.processHookEvent.ownerTaggedNoProject', { sessionId: payload.session_id, cwd: payload.cwd, owner: payload._vibisualOwnerAgentId });
          return null;
        }
        // 새 프로젝트 자동 등록 (루트 기준)
        try {
          this.registerProjectAtRoot(rootCwd, payload.cwd);
        } catch (e) {
          if (e instanceof ReadOnlyProjectError) {
            // §3.2.1-4 — read-only 격리 프로젝트: 디스크를 덮지 않게 이벤트를 버린다.
            logger.warn(`processHookEvent: dropping event for read-only isolated project (${payload.cwd})`);
            return null;
          }
          throw e;
        }
        inst = this.instances.get(key) ?? null;
      }
      this.sessionRouting.set(payload.session_id, key);
    }

    if (!inst) {
      logger.warn(`ProjectGraphManager.processHookEvent: no instance for session=${payload.session_id}`);
      dbg('manager.processHookEvent.noInstance', { sessionId: payload.session_id, cwd: payload.cwd, tool: payload.tool_name });
      return null;
    }
    // 진단 가치는 라우팅에 있다 — 이벤트마다 남기면 로그가 무한히 자라므로(실측 2위) 세션별 라우팅이 바뀔 때만 남긴다
    // (오라우팅·이동은 signature 가 바뀌어 반드시 남는다).
    dbgOnChange(
      `manager.route:${payload.session_id}`,
      `${payload.cwd}|${routedBy}|${inst.getRoot()}`,
      'manager.processHookEvent',
      {
        sessionId: payload.session_id,
        cwd: payload.cwd,
        tool: payload.tool_name,
        event: payload.hook_event_name,
        routedBy,
        instanceRoot: inst.getRoot(),
      },
    );
    return inst.processHookEvent(payload);
  }

  getAgentBySession(sessionId: string): BubbleData | null {
    const inst = this.getInstanceForSession(sessionId);
    const routed = inst?.getAgentBySession(sessionId) ?? null;
    if (routed) return routed;
    // fallback: 표에 줄이 없거나(커스텀 버블은 첫 도구 이벤트 전까지 없다) 표가 가리키는 곳에 버블이 없으면
    //   **가진 곳**을 찾는다. 표만 믿고 null 을 돌려주면 명령 접수는 "세션 없음"(404)으로, 실행(`processNextCommand`)은
    //   말없이 멈춘다 — 입력이 먹지 않는 탭의 한 갈래였다(§3.5).
    return this.findSessionHolder(sessionId)?.inst.getAgentBySession(sessionId) ?? null;
  }

  getAgentCwd(sessionId: string): string | null {
    const inst = this.getInstanceForSession(sessionId);
    const routed = inst?.getAgentCwd(sessionId) ?? null;
    if (routed) return routed;
    const held = this.findSessionHolder(sessionId)?.inst.getAgentCwd(sessionId) ?? null;
    if (held) return held;
    // fallback: 모든 인스턴스에서 검색(서브에이전트 세션 → 부모 cwd 해석 포함)
    for (const i of this.instances.values()) {
      if (i === inst) continue;
      const cwd = i.getAgentCwd(sessionId);
      if (cwd) return cwd;
    }
    return null;
  }

  findAgentIdBySession(sessionId: string): string | null {
    const inst = this.getInstanceForSession(sessionId);
    const routed = inst?.findAgentIdBySession(sessionId) ?? null;
    if (routed !== null) return routed;
    return this.findSessionHolder(sessionId)?.inst.findAgentIdBySession(sessionId) ?? null;
  }

  setAgentStatus(sessionId: string, status: 'completed'): void {
    const inst = this.getInstanceForSession(sessionId);
    if (inst) { inst.setAgentStatus(sessionId, status); return; }
    // fallback: 전체 탐색
    for (const i of this.instances.values()) {
      i.setAgentStatus(sessionId, status);
    }
  }

  /** §4 — Notification 서브타입 시각 신호(awaiting_permission). */
  setAgentNotificationStatus(
    sessionId: string,
    status: 'awaiting_permission',
  ): void {
    const inst = this.getInstanceForSession(sessionId);
    if (inst) { inst.setAgentNotificationStatus(sessionId, status); return; }
    for (const i of this.instances.values()) {
      i.setAgentNotificationStatus(sessionId, status);
    }
  }

  /** §4 — PostToolUse `duration_ms` 적재(세션 소속 인스턴스에 위임). */
  recordToolDuration(sessionId: string, tool: string, durationMs: number): void {
    const inst = this.getInstanceForSession(sessionId);
    if (inst) { inst.recordToolDuration(sessionId, tool, durationMs); return; }
    for (const i of this.instances.values()) i.recordToolDuration(sessionId, tool, durationMs);
  }

  /**
   * §5.25 (F) "쓴 내용도 남는다" — 프로바이더(코덱스) 쓰기의 수정 이력 한 줄. 같은 쓰기의 사후 이벤트를
   * `processHookEvent` 로 흘린 **뒤에** 부른다 — 그때 라우팅 표가 버블을 세운 인스턴스를 가리킨다.
   */
  recordProviderFileEdit(
    sessionId: string,
    filePath: string,
    edit: { id: string; oldString: string; newString: string },
  ): boolean {
    const inst = this.getInstanceForSession(sessionId) ?? this.findSessionHolder(sessionId)?.inst ?? null;
    return inst ? inst.recordProviderFileEdit(sessionId, filePath, edit) : false;
  }

  /** §4 — PreCompact 카운터. */
  recordCompact(sessionId: string): void {
    const inst = this.getInstanceForSession(sessionId);
    if (inst) { inst.recordCompact(sessionId); return; }
    for (const i of this.instances.values()) i.recordCompact(sessionId);
  }

  /** §5.5 #17-4 — 명령 텍스트의 `/skill-name` 매칭마다 사용 카운트 증분. */
  recordSkillUsageFromCommandText(sessionId: string, text: string): void {
    const inst = this.getInstanceForSession(sessionId);
    if (inst) { inst.recordSkillUsageFromCommandText(text); return; }
    // fallback: 어디에도 매핑 안 되면 무시 (orphan session — 보통 발생 안 함)
  }

  /** §4 — Claude.ai 한도 사용률 갱신(글로벌, statusline 외부 푸시). */
  setRateLimits(info: Partial<Omit<RateLimitInfo, 'updatedAt'>>): void {
    this.globalRateLimits = {
      ...this.globalRateLimits,
      ...info,
      updatedAt: Date.now(),
    };
  }

  getRateLimits(): RateLimitInfo | undefined {
    return this.globalRateLimits;
  }

  /** §4 — Claude 사용량(OAuth 직접 조회) 갱신 — 서비스가 정규화한 값 그대로. */
  setClaudeUsage(info: ClaudeUsageInfo): void {
    this.globalClaudeUsage = info;
  }

  getClaudeUsage(): ClaudeUsageInfo | undefined {
    return this.globalClaudeUsage;
  }

  /** §4 — Claude 로그인 상태 갱신(claudeAuthService 판정값 그대로). */
  setClaudeAuth(status: ClaudeAuthStatus): void {
    this.globalClaudeAuth = status;
  }

  getClaudeAuth(): ClaudeAuthStatus | undefined {
    return this.globalClaudeAuth;
  }

  /** §4 (첫 실행 설치 온보딩) — CLI 설치 판정 갱신(claudeSetupService 가 판정한 값 그대로 보관). */
  setClaudeSetup(state: ClaudeSetupState): void {
    this.globalClaudeSetup = state;
  }

  getClaudeSetup(): ClaudeSetupState | undefined {
    return this.globalClaudeSetup;
  }

  /** §5.25 (E) — 코덱스 로그인 상태 갱신(codexAuthService 가 판정한 값 그대로 보관). */
  setCodexAuth(status: CodexAuthStatus): void {
    this.globalCodexAuth = status;
  }

  getCodexAuth(): CodexAuthStatus | undefined {
    return this.globalCodexAuth;
  }

  /** §5.25 (D) — 코덱스 CLI 설치 판정 갱신. */
  setCodexSetup(state: CodexSetupState): void {
    this.globalCodexSetup = state;
  }

  getCodexSetup(): CodexSetupState | undefined {
    return this.globalCodexSetup;
  }

  /** §5.25 (I) — 코덱스 훅 설치 상태 갱신. */
  setCodexHooks(state: CodexHookState): void {
    this.globalCodexHooks = state;
  }

  getCodexHooks(): CodexHookState | undefined {
    return this.globalCodexHooks;
  }

  /** §5.25 (G) — 코덱스 모델 목록 갱신(읽어 온 캐시 그대로 보관 — 우리가 표를 들지 않는다). */
  setCodexModels(catalog: CodexModelCatalog): void {
    this.globalCodexModels = catalog;
  }

  getCodexModels(): CodexModelCatalog | undefined {
    return this.globalCodexModels;
  }

  /** §5.25 (M) — 코덱스가 들고 있는 MCP·스킬·플러그인·훅·`AGENTS.md`. 읽은 그대로 보관한다. */
  setCodexInventory(inventory: CodexInventory): void {
    this.globalCodexInventory = inventory;
  }

  getCodexInventory(): CodexInventory | undefined {
    return this.globalCodexInventory;
  }

  /** §5.25 (N) — 코덱스 리뷰 이력. 최근 것이 앞이고, 화면이 `agentId` 로 걸러 본다. */
  setCodexReviews(runs: CodexReviewRun[]): void {
    this.globalCodexReviews = runs;
  }

  getCodexReviews(): CodexReviewRun[] | undefined {
    return this.globalCodexReviews;
  }

  /** 커스텀 에이전트 상태를 소속 서브에이전트 집계로 재계산. 한 번이라도 바뀐 인스턴스가 있으면 true. */
  recomputeCustomAgentStatus(parentAgentId: string): boolean {
    let changed = false;
    for (const i of this.instances.values()) {
      if (i.recomputeCustomAgentStatus(parentAgentId)) changed = true;
    }
    return changed;
  }

  /** 전체 인스턴스의 모든 customCreated 에이전트 상태 일괄 재계산. */
  recomputeAllCustomAgentStatuses(): boolean {
    let changed = false;
    for (const i of this.instances.values()) {
      if (i.recomputeAllCustomAgentStatuses()) changed = true;
    }
    return changed;
  }

  /** @returns 확인 dismiss(`purgeNodes=true`)로 즉시 제거된 버블 id 목록. 그 외 경로는 빈 배열. */
  markAgentIdle(sessionId?: string, purgeNodes = false): string[] {
    if (sessionId) {
      const inst = this.getInstanceForSession(sessionId);
      if (inst) return inst.markAgentIdle(sessionId, purgeNodes);
      const purged: string[] = [];
      for (const i of this.instances.values()) {
        purged.push(...i.markAgentIdle(sessionId, purgeNodes));
      }
      return purged;
    }
    for (const i of this.instances.values()) i.markAgentIdle();
    return [];
  }

  /** 모든 인스턴스에서 idle 에이전트의 파일/폴더 엣지를 일괄 삭제. 기동 청소용.
   *  반환값: 삭제된 엣지 총합. 0보다 크면 호출자가 체크포인트 저장 필요. */
  sweepIdleAgentFileFolderEdges(): number {
    let total = 0;
    for (const inst of this.instances.values()) {
      total += inst.sweepIdleAgentFileFolderEdges();
    }
    return total;
  }

  // ─── 라우팅: 프로젝트 이름 기반 ───

  /**
   * §4 온보딩 ③ — 연 프로젝트 폴더가 하나라도 있나. 기준은 탭바(`getVisibleTopLevelProjects`)와 같다 — 워크트리·× 로 닫은 탭은 세지 않는다
   * (안 보이는 탭에 에이전트가 매이면 "만들었는데 아무 일도 없다").
   */
  hasOpenProject(): boolean {
    return this.getVisibleTopLevelProjects().length > 0;
  }

  /**
   * 인스턴스가 없으면 `null`. `registerProject(process.cwd())` 로 임시 등록하지 마라 — Finder 로 띄운 mac 앱은 cwd 가 `/` 라
   * 이름 빈 탭과 루트에 매인 에이전트가 생긴다. 부른 쪽이 폴더 선택으로 되돌린다(§4 온보딩 ③).
   */
  createCustomAgent(
    label: string,
    position?: { x: number; y: number },
    projectName?: string | null,
    options?: { executionMode?: ExecutionMode; provider?: AgentProvider },
  ): BubbleData | null {
    const inst = projectName
      ? (this.getInstanceByName(projectName) ?? this.primaryInstance())
      : this.primaryInstance();
    if (!inst) return null;
    return inst.createCustomAgent(label, position, projectName, options);
  }

  /**
   * §5.3 #10-4 — `createCustomAgent` 가 이 이름으로 만들 때의 프로젝트 뿌리(라우팅은 위와 한 벌, 인스턴스 없으면 null).
   * 오케스트라 멤버가 "런과 같은 프로젝트인가"를 만들기 전에 잰다 — 뒤에 재면 거절 때 버블이 이미 있다.
   */
  getCustomAgentTargetRoot(projectName?: string | null): string | null {
    const inst = projectName
      ? (this.getInstanceByName(projectName) ?? this.primaryInstance())
      : this.primaryInstance();
    return inst?.getRoot() ?? null;
  }

  /**
   * §5.3 #10-2 — Auto Agent 메타 버블 생성. 라우팅은 createCustomAgent 와 같다
   *  (인스턴스 없으면 `null`, 임시 등록 ❌).
   */
  createAutoAgent(
    label: string,
    position?: { x: number; y: number },
    projectName?: string | null,
  ): BubbleData | null {
    const inst = projectName
      ? (this.getInstanceByName(projectName) ?? this.primaryInstance())
      : this.primaryInstance();
    if (!inst) return null;
    return inst.createAutoAgent(label, position, projectName);
  }

  /** §5.3 #10-2 — auto-agent sessionId 로 요약 메타 조회. */
  getAutoAgentSummary(autoAgentSessionId: string): import('@vibisual/shared').AutoAgentSummary | null {
    for (const inst of this.instances.values()) {
      const s = inst.getAutoAgentSummary(autoAgentSessionId);
      if (s) return s;
    }
    return null;
  }

  /** §5.3 #10-2 — 요약 메타 부분 갱신. */
  updateAutoAgentSummary(
    autoAgentSessionId: string,
    patch: Partial<import('@vibisual/shared').AutoAgentSummary>,
  ): import('@vibisual/shared').AutoAgentSummary | null {
    for (const inst of this.instances.values()) {
      const updated = inst.updateAutoAgentSummary(autoAgentSessionId, patch);
      if (updated) return updated;
    }
    return null;
  }

  /** §5.3 #10-2 — 이 auto-agent 를 소유한 인스턴스(projectName 조회용). */
  findInstanceByAutoAgentSession(autoAgentSessionId: string): ProjectGraph | null {
    for (const inst of this.instances.values()) {
      if (inst.getAutoAgentSummary(autoAgentSessionId)) return inst;
    }
    // 요약 맵이 비어도(복원·재하이드레이션으로 휘발) auto 버블이 살아 있으면 그 인스턴스 — 버블이 SSOT 다
    // (processRequest 는 요약이 없으면 새로 만든다).
    for (const inst of this.instances.values()) {
      const bubble = inst.getAgentBySession(autoAgentSessionId);
      if (bubble && bubble.bubbleType === 'auto') return inst;
    }
    return null;
  }

  // §5.3 #10-3 — 검증 런 위임
  // 런은 auto-agent 소유 인스턴스에 살고 판정(ok/verified)은 전부 ProjectGraph 가 한다.

  /** 전체 auto-agent 요약 맵 (모든 인스턴스 합산) */
  getAutoAgentSummaries(): Record<string, import('@vibisual/shared').AutoAgentSummary> {
    const out: Record<string, import('@vibisual/shared').AutoAgentSummary> = {};
    for (const inst of this.instances.values()) Object.assign(out, inst.getAutoAgentSummaries());
    return out;
  }

  createAutoAgentRun(params: {
    autoAgentId: string;
    userRequest: string;
    acceptanceCriteria?: string[];
    baselineRevision?: string;
    reworkBudget?: number;
    selfTest?: boolean;
  }): import('@vibisual/shared').AutoAgentRun | null {
    const inst = this.findInstanceByAutoAgentSession(params.autoAgentId) ?? this.primaryInstance();
    if (!inst) return null;
    return inst.createAutoAgentRun(params);
  }

  getAutoAgentRun(runId: string): import('@vibisual/shared').AutoAgentRun | null {
    for (const inst of this.instances.values()) {
      const run = inst.getAutoAgentRun(runId);
      if (run) return run;
    }
    return null;
  }

  listAutoAgentRuns(autoAgentId: string): import('@vibisual/shared').AutoAgentRun[] {
    for (const inst of this.instances.values()) {
      const runs = inst.listAutoAgentRuns(autoAgentId);
      if (runs.length > 0) return runs;
    }
    return [];
  }

  getActiveAutoAgentRun(autoAgentId: string): import('@vibisual/shared').AutoAgentRun | null {
    for (const inst of this.instances.values()) {
      const run = inst.getActiveAutoAgentRun(autoAgentId);
      if (run) return run;
    }
    return null;
  }

  appendVerificationAttempt(
    runId: string,
    attempt: Omit<import('@vibisual/shared').VerificationAttempt, 'id' | 'ok'>,
  ): import('@vibisual/shared').AutoAgentRun | null {
    for (const inst of this.instances.values()) {
      const run = inst.appendVerificationAttempt(runId, attempt);
      if (run) return run;
    }
    return null;
  }

  consumeAutoAgentRework(runId: string): { run: import('@vibisual/shared').AutoAgentRun; withinBudget: boolean } | null {
    for (const inst of this.instances.values()) {
      const res = inst.consumeAutoAgentRework(runId);
      if (res) return res;
    }
    return null;
  }

  closeAutoAgentRun(
    runId: string,
    desired: import('@vibisual/shared').AutoAgentRunStatus,
    escalation?: import('@vibisual/shared').EscalationReason,
  ): import('@vibisual/shared').AutoAgentRun | null {
    for (const inst of this.instances.values()) {
      const run = inst.closeAutoAgentRun(runId, desired, escalation);
      if (run) return run;
    }
    return null;
  }

  setAutoAgentRunVerdict(
    runId: string,
    verdict: import('@vibisual/shared').VerificationVerdict,
    reason?: string,
  ): import('@vibisual/shared').AutoAgentRun | null {
    for (const inst of this.instances.values()) {
      const run = inst.setAutoAgentRunVerdict(runId, verdict, reason);
      if (run) return run;
    }
    return null;
  }

  /** 파이프라인 버블 생성 위임 — 인스턴스가 없으면 `null`(임시 등록 ❌, 사유는 `createCustomAgent` 머리말). */
  createPipeline(
    type: import('@vibisual/shared').PipelineType,
    label: string,
    position?: { x: number; y: number },
    projectName?: string | null,
  ): BubbleData | null {
    const inst = projectName
      ? (this.getInstanceByName(projectName) ?? this.primaryInstance())
      : this.primaryInstance();
    if (!inst) return null;
    return inst.createPipeline(type, label, position, projectName);
  }

  toggleRootChild(projectName: string, filePath: string, show: boolean, rootAbsPath?: string | null): boolean {
    // 이름보다 절대경로가 세다 — 표시명이 전역 유일화(`client (other)`)돼 이름 매칭이 빗나가도
    // 클라가 스냅샷에서 들고 온 루트 절대경로면 인스턴스를 정확히 찍는다.
    const inst = this.instanceForNodePath(`${ROOT_NODE_KEY_PREFIX}${projectName}`, rootAbsPath)
      ?? this.primaryInstance();
    return inst ? inst.toggleRootChild(projectName, filePath, show) : false;
  }

  /**
   * §9 — `toProjectCheckpoint(name)` 이 읽을 그 인스턴스의 변경 카운터. `null`(못 찾음)이면 호출자는 "저장 필요"로 본다
   * — 판정 실패가 조용한 미저장이 되면 안 된다.
   */
  getProjectMutationVersion(name: string): number | null {
    const inst = this.getInstanceByName(name) ?? this.primaryInstance();
    return inst ? inst.getMutationVersion() : null;
  }

  /** §9 — 저장할 프로젝트의 seq 만 올린다. `seq` 가 본문에 실려, 전부 올리면 안 바뀐 프로젝트도 매번 달라져 `SaveScheduler` 지문 비교(쓰기 생략)가 죽는다. */
  incrementSeqForProjects(names: string[]): void {
    const bumped = new Set<ProjectGraph>();
    for (const name of names) {
      const inst = this.getInstanceByName(name) ?? this.primaryInstance();
      if (!inst || bumped.has(inst)) continue;
      bumped.add(inst);
      inst.incrementSeq();
    }
  }

  toProjectCheckpoint(name: string): ProjectCheckpoint {
    const inst = this.getInstanceByName(name) ?? this.primaryInstance();
    if (!inst) {
      throw new Error(`ProjectGraphManager.toProjectCheckpoint: no instance for "${name}"`);
    }
    return inst.toProjectCheckpoint(name);
  }

  // ─── 라우팅: agentId/nodeId 기반 (전체 탐색) ───

  getAgentConfig(agentId: string): AgentConfig | undefined {
    return this.findInstanceByAgentId(agentId)?.getAgentConfig(agentId);
  }

  /** §4 — 작업 신고 적재. agentId 소속 인스턴스로, 없으면 primary 폴백. */
  addAgentReport(report: import('@vibisual/shared').AgentReport): boolean {
    const inst = this.findInstanceByAgentId(report.agentId) ?? this.primaryInstance();
    if (!inst) return false;
    inst.addAgentReport(report);
    return true;
  }

/**
   * §5.5 #17-36 — 메인 탭 스티키 메모 저장. agentId 소속 인스턴스로 라우팅(addAgentReport 와 동형).
   * @returns 실제로 내용이 바뀌었으면 true(= 브로드캐스트·저장할 값어치가 있다).
   */
  setAgentMemos(agentId: string, memos: import('@vibisual/shared').SessionMemo[]): boolean {
    const inst = this.findInstanceByAgentId(agentId) ?? this.primaryInstance();
    if (!inst) return false;
    return inst.setAgentMemos(agentId, memos);
  }

  /** §5.5 #17-36 — 메인 탭 메모 조회(없으면 빈 배열). */
  getAgentMemos(agentId: string): import('@vibisual/shared').SessionMemo[] {
    const inst = this.findInstanceByAgentId(agentId) ?? this.primaryInstance();
    return inst ? inst.getAgentMemos(agentId) : [];
  }

  /** §4 — 질문 카드 적재(addAgentReport 와 동형 라우팅). */
  addAgentQuestions(q: import('@vibisual/shared').AgentQuestions): boolean {
    const inst = this.findInstanceByAgentId(q.agentId) ?? this.primaryInstance();
    if (!inst) return false;
    inst.addAgentQuestions(q);
    return true;
  }

  /** §4 — 검수 요청 카드 적재(addAgentReport 와 동형 라우팅). */
  addAgentReview(review: import('@vibisual/shared').AgentReview): boolean {
    const inst = this.findInstanceByAgentId(review.agentId) ?? this.primaryInstance();
    if (!inst) return false;
    inst.addAgentReview(review);
    return true;
  }

  /** §4 — 번호 목록 정렬 카드 적재(addAgentReport 와 동형 라우팅). */
  addAgentList(list: import('@vibisual/shared').AgentList): boolean {
    const inst = this.findInstanceByAgentId(list.agentId) ?? this.primaryInstance();
    if (!inst) return false;
    inst.addAgentList(list);
    return true;
  }

  /** §7.11 — 에이전트 서버 iframe 신고. agentId 소속 인스턴스의 그 세션에 위성을 만든다. */
  reportAgentIframe(agentId: string, url: string): boolean {
    const inst = this.findInstanceByAgentId(agentId);
    if (!inst) return false;
    return inst.reportIframeFromAgent(agentId, url);
  }

  /** §4 — 피드백 upsert(addAgentReport 와 동형 라우팅). */
  setAgentFeedback(feedback: import('@vibisual/shared').AgentFeedback): boolean {
    const inst = this.findInstanceByAgentId(feedback.agentId) ?? this.primaryInstance();
    if (!inst) return false;
    inst.setAgentFeedback(feedback);
    return true;
  }

  /** §4 — 피드백 철회(그 target 의 기존 평가 제거). */
  removeAgentFeedback(agentId: string, targetType: string, targetId: string): boolean {
    const inst = this.findInstanceByAgentId(agentId) ?? this.primaryInstance();
    if (!inst) return false;
    return inst.removeAgentFeedback(agentId, targetType, targetId);
  }

  /** §4 — 한 에이전트의 피드백 목록(스폰 다이제스트 주입·distill 용). */
  getAgentFeedbacksForAgent(agentId: string): import('@vibisual/shared').AgentFeedback[] {
    const inst = this.findInstanceByAgentId(agentId);
    return inst ? inst.getAgentFeedbacksForAgent(agentId) : [];
  }

  // §5.5 #17-11 — 세션 루프
  // subAgentId 키라 agentId 로 인스턴스를 못 찾는 조회는 순회한다(열린 탭 수 수준).

  /** 세션 탭 하나의 루프 설정. */
  getSessionLoop(subAgentId: string): import('@vibisual/shared').SessionLoop | undefined {
    for (const inst of this.instances.values()) {
      const loop = inst.getSessionLoop(subAgentId);
      if (loop) return loop;
    }
    return undefined;
  }

  /** 루프 설정 저장(생성/전체 교체). loop.agentId 소속 인스턴스로 라우팅, 없으면 primary 폴백. */
  setSessionLoop(loop: import('@vibisual/shared').SessionLoop): boolean {
    const inst = this.findInstanceByAgentId(loop.agentId) ?? this.primaryInstance();
    if (!inst) return false;
    inst.setSessionLoop(loop);
    return true;
  }

  /** 루프 부분 갱신 (진행 카운트·상태). 대상이 없으면 undefined. */
  updateSessionLoop(
    subAgentId: string,
    patch: Partial<import('@vibisual/shared').SessionLoop>,
  ): import('@vibisual/shared').SessionLoop | undefined {
    for (const inst of this.instances.values()) {
      if (!inst.getSessionLoop(subAgentId)) continue;
      return inst.updateSessionLoop(subAgentId, patch);
    }
    return undefined;
  }

  /** 루프 설정 삭제. */
  deleteSessionLoop(subAgentId: string): boolean {
    for (const inst of this.instances.values()) {
      if (inst.deleteSessionLoop(subAgentId)) return true;
    }
    return false;
  }

  /** 한 에이전트에 속한 루프 전부. */
  getSessionLoopsForAgent(agentId: string): import('@vibisual/shared').SessionLoop[] {
    const inst = this.findInstanceByAgentId(agentId);
    return inst ? inst.getSessionLoopsForAgent(agentId) : [];
  }

  /** 전 프로젝트의 루프 전부 (주기 스윕용). */
  listSessionLoops(): import('@vibisual/shared').SessionLoop[] {
    const out: import('@vibisual/shared').SessionLoop[] = [];
    for (const inst of this.instances.values()) {
      const rec = inst.getSessionLoopsRecord();
      if (rec) out.push(...Object.values(rec));
    }
    return out;
  }

  // ─── §5.5 #17-35 — 검증(Verify) ───
  //
  // 루프와 같은 규약 — 키가 subAgentId(세션 탭)라 조회는 인스턴스를 순회한다(열린 탭 수 수준).

  /** 세션 탭 하나의 검증 이력(최신 우선). */
  getVerificationRuns(subAgentId: string): import('@vibisual/shared').VerificationRun[] {
    for (const inst of this.instances.values()) {
      const list = inst.getVerificationRuns(subAgentId);
      if (list.length > 0) return list;
    }
    return [];
  }

  /** 그 탭에서 아직 안 끝난 검증(겹쳐 쏘지 않기 위한 판정). */
  getActiveVerificationRun(subAgentId: string): import('@vibisual/shared').VerificationRun | undefined {
    for (const inst of this.instances.values()) {
      const run = inst.getActiveVerificationRun(subAgentId);
      if (run) return run;
    }
    return undefined;
  }

  /** 검증 한 건 추가. run.agentId 소속 인스턴스로 라우팅, 없으면 primary 폴백(루프와 같은 규칙). */
  addVerificationRun(run: import('@vibisual/shared').VerificationRun): boolean {
    const inst = this.findInstanceByAgentId(run.agentId) ?? this.primaryInstance();
    if (!inst) return false;
    inst.addVerificationRun(run);
    return true;
  }

  /** id 로 찾기 — REST 는 subAgentId 를 모르고 들어온다. */
  findVerificationRun(runId: string): import('@vibisual/shared').VerificationRun | undefined {
    for (const inst of this.instances.values()) {
      const hit = inst.findVerificationRun(runId);
      if (hit) return hit;
    }
    return undefined;
  }

  /** 검증 부분 갱신(상태·판정·증거). 대상이 없으면 undefined. */
  updateVerificationRun(
    runId: string,
    patch: Partial<import('@vibisual/shared').VerificationRun>,
  ): import('@vibisual/shared').VerificationRun | undefined {
    for (const inst of this.instances.values()) {
      const next = inst.updateVerificationRun(runId, patch);
      if (next) return next;
    }
    return undefined;
  }

  /** 검증 한 줄 삭제. */
  deleteVerificationRun(runId: string): boolean {
    for (const inst of this.instances.values()) {
      if (inst.deleteVerificationRun(runId)) return true;
    }
    return false;
  }

  /** 한 에이전트의 검증 전부 삭제(에이전트 영구 제거). 지운 건수. */
  deleteVerificationRunsForAgent(agentId: string): number {
    let removed = 0;
    for (const inst of this.instances.values()) removed += inst.deleteVerificationRunsForAgent(agentId);
    return removed;
  }

  // §5.5 #17-35 ⑨ — 시연
  // 검증 이력과 같은 라우팅이되 지워진 레코드를 돌려준다 — 프레임 폴더는 서버(index.ts)가 지운다(그래프는 디스크를 안 만진다).

  /** 세션 탭 하나의 시연 목록(최신 우선). */
  getVerificationDemos(subAgentId: string): import('@vibisual/shared').VerificationDemo[] {
    for (const inst of this.instances.values()) {
      const list = inst.getVerificationDemos(subAgentId);
      if (list.length > 0) return list;
    }
    return [];
  }

  /** 시연 한 건 추가. 상한에 밀려난 것들을 돌려준다(그림 정리 대상). 인스턴스가 없으면 null. */
  addVerificationDemo(
    demo: import('@vibisual/shared').VerificationDemo,
  ): import('@vibisual/shared').VerificationDemo[] | null {
    const inst = this.findInstanceByAgentId(demo.agentId) ?? this.primaryInstance();
    if (!inst) return null;
    return inst.addVerificationDemo(demo);
  }

  /** id 로 찾기 — REST 는 subAgentId 를 모르고 들어온다. */
  findVerificationDemo(demoId: string): import('@vibisual/shared').VerificationDemo | undefined {
    for (const inst of this.instances.values()) {
      const hit = inst.findVerificationDemo(demoId);
      if (hit) return hit;
    }
    return undefined;
  }

  /** 시연 부분 갱신(이름·단계·기대 결과). 대상이 없으면 undefined. */
  updateVerificationDemo(
    demoId: string,
    patch: Partial<import('@vibisual/shared').VerificationDemo>,
  ): import('@vibisual/shared').VerificationDemo | undefined {
    for (const inst of this.instances.values()) {
      const next = inst.updateVerificationDemo(demoId, patch);
      if (next) return next;
    }
    return undefined;
  }

  /** 시연 한 건 삭제. 지운 레코드(그림 정리 대상) 또는 undefined. */
  deleteVerificationDemo(demoId: string): import('@vibisual/shared').VerificationDemo | undefined {
    for (const inst of this.instances.values()) {
      const gone = inst.deleteVerificationDemo(demoId);
      if (gone) return gone;
    }
    return undefined;
  }

  /** 한 에이전트의 시연 전부 삭제(에이전트 영구 제거). 지운 레코드들. */
  deleteVerificationDemosForAgent(agentId: string): import('@vibisual/shared').VerificationDemo[] {
    const removed: import('@vibisual/shared').VerificationDemo[] = [];
    for (const inst of this.instances.values()) removed.push(...inst.deleteVerificationDemosForAgent(agentId));
    return removed;
  }

  // §5.5 #17-28 — 컨텍스트 주입원 오버라이드
  // 주입 게이트가 매 턴 부르므로 싸야 한다(인스턴스 1~3개 순회 + 메모리 맵 읽기, 파일 접근 없음).

  /** 오버라이드 설정. 소유 인스턴스(에이전트 기준)로 라우팅, 없으면 primary. */
  setContextOverride(
    scope: { level: import('@vibisual/shared').ContextScopeLevel; agentId?: string; projectKey?: string; subAgentId?: string },
    sourceId: string,
    enabled: boolean | null,
  ): void {
    const inst = (scope.agentId ? this.findInstanceByAgentId(scope.agentId) : null) ?? this.primaryInstance();
    inst?.setContextOverride(scope, sourceId, enabled);
  }

  /** 한 층의 오버라이드를 통째로 비운다. 어느 인스턴스든 지운 게 있으면 true. */
  clearContextOverrides(scope: { level: import('@vibisual/shared').ContextScopeLevel; agentId?: string; projectKey?: string; subAgentId?: string }): boolean {
    let changed = false;
    for (const inst of this.instances.values()) {
      if (inst.clearContextOverrides(scope)) changed = true;
    }
    return changed;
  }

  /** 세션 탭이 닫힐 때의 정리(루프·목표와 같은 규칙). */
  deleteContextOverridesForSession(subAgentId: string): boolean {
    let changed = false;
    for (const inst of this.instances.values()) {
      if (inst.deleteContextOverridesForSession(subAgentId)) changed = true;
    }
    return changed;
  }

  /** 에이전트 버블이 사라질 때의 정리(버블 층 + 그 버블 소유 세션 층). */
  deleteContextOverridesForAgent(agentId: string): boolean {
    let changed = false;
    for (const inst of this.instances.values()) {
      if (inst.deleteContextOverridesForAgent(agentId)) changed = true;
    }
    return changed;
  }

  /**
   * 열린 인스턴스 전체의 오버라이드 합집합 — 게이트와 화면이 같은 것을 본다.
   * 인스턴스마다 키 공간(프로젝트 키·버블 id·세션 id)이 겹치지 않으므로 단순 합치기로 충분하다.
   */
  getContextOverrides(): import('@vibisual/shared').ContextOverrides | undefined {
    let out: import('@vibisual/shared').ContextOverrides | undefined;
    for (const inst of this.instances.values()) {
      const one = inst.getContextOverrides();
      if (!one) continue;
      if (!out) {
        out = { projects: { ...one.projects }, agents: { ...one.agents }, sessions: { ...one.sessions }, updatedAt: one.updatedAt };
        continue;
      }
      Object.assign(out.projects, one.projects);
      Object.assign(out.agents, one.agents);
      Object.assign(out.sessions, one.sessions);
      if (one.updatedAt > out.updatedAt) out.updatedAt = one.updatedAt;
    }
    return out;
  }

  // §5.5 #17-17 — 세션 목표
  // subAgentId 키라 루프처럼 순회한다.

  /** 세션 탭 하나의 목표. */
  getSessionGoal(subAgentId: string): import('@vibisual/shared').SessionGoal | undefined {
    for (const inst of this.instances.values()) {
      const goal = inst.getSessionGoal(subAgentId);
      if (goal) return goal;
    }
    return undefined;
  }

  /** 목표 저장(생성/문장 수정/상태 변경). goal.agentId 소속 인스턴스로 라우팅, 없으면 primary 폴백. */
  setSessionGoal(input: {
    agentId: string;
    subAgentId: string;
    text: string;
    status?: import('@vibisual/shared').SessionGoalStatus;
    steps?: { text: string; status?: import('@vibisual/shared').SessionGoalStepStatus }[];
    authoredBy?: 'session' | 'user';
    sourceCommand?: string;
  }): import('@vibisual/shared').SessionGoal | undefined {
    const inst = this.findInstanceByAgentId(input.agentId) ?? this.primaryInstance();
    if (!inst) return undefined;
    return inst.setSessionGoal(input);
  }

  /** §5.5 #17-17 — `TodoWrite` 계획을 그 세션의 목표로 옮긴다(없으면 만들고 있으면 체크리스트를 맞춘다). 소유 인스턴스로, 없으면 agentId 기준. */
  syncSessionGoalFromPlan(
    subAgentId: string,
    input: {
      agentId: string;
      command?: string;
      steps: { text: string; status?: import('@vibisual/shared').SessionGoalStepStatus }[];
    },
  ): import('@vibisual/shared').SessionGoal | undefined {
    for (const inst of this.instances.values()) {
      if (inst.getSessionGoal(subAgentId)) return inst.syncSessionGoalFromPlan(subAgentId, input);
    }
    const inst = this.findInstanceByAgentId(input.agentId) ?? this.primaryInstance();
    return inst ? inst.syncSessionGoalFromPlan(subAgentId, input) : undefined;
  }

  /** §5.5 #17-17 ⑨ — 명령이 발사되는 순간 목표 카드를 세운다(계획을 기다리지 않는다). 라우팅은 계획 경로와 같다. */
  seedSessionGoalFromCommand(
    subAgentId: string,
    input: { agentId: string; command: string },
  ): import('@vibisual/shared').SessionGoal | undefined {
    for (const inst of this.instances.values()) {
      if (inst.getSessionGoal(subAgentId)) return inst.seedSessionGoalFromCommand(subAgentId, input);
    }
    const inst = this.findInstanceByAgentId(input.agentId) ?? this.primaryInstance();
    return inst ? inst.seedSessionGoalFromCommand(subAgentId, input) : undefined;
  }

  /** 진행 갱신 (단계 체크리스트 우선 · 숫자 신고 · plan 폴백). 적용 안 됐으면 undefined. */
  noteSessionGoalProgress(
    subAgentId: string,
    input: {
      percent?: number;
      note?: string;
      steps?: { text: string; status?: import('@vibisual/shared').SessionGoalStepStatus }[];
      goal?: string;
      source: import('@vibisual/shared').SessionGoalProgressSource;
    },
  ): import('@vibisual/shared').SessionGoal | undefined {
    for (const inst of this.instances.values()) {
      if (!inst.getSessionGoal(subAgentId)) continue;
      return inst.noteSessionGoalProgress(subAgentId, input);
    }
    return undefined;
  }

  /** 목표 삭제. */
  deleteSessionGoal(subAgentId: string): boolean {
    for (const inst of this.instances.values()) {
      if (inst.deleteSessionGoal(subAgentId)) return true;
    }
    return false;
  }

  // ─── §5.5 #17-17 ⑪ 살아 있는 단계 지도 ───

  /** ⑪(d) — 사용자가 단계 목록을 다시 세운다(끼워 넣기·삭제·순서). 목표를 가진 인스턴스에만 간다. */
  setUserGoalSteps(
    subAgentId: string,
    steps: {
      text: string;
      status?: import('@vibisual/shared').SessionGoalStepStatus;
      kind?: string;
      confidence?: 'high' | 'low';
    }[],
  ): import('@vibisual/shared').SessionGoal | undefined {
    for (const inst of this.instances.values()) {
      if (!inst.getSessionGoal(subAgentId)) continue;
      return inst.setUserGoalSteps(subAgentId, steps);
    }
    return undefined;
  }

  /**
   * ⑪(i) — 한 단계의 종류만 바꾼다(소유·시각은 그대로). 목표를 가진 인스턴스에만 간다.
   */
  setGoalStepKind(
    subAgentId: string,
    stepId: string,
    kind: string | null,
  ): import('@vibisual/shared').SessionGoal | undefined {
    for (const inst of this.instances.values()) {
      if (!inst.getSessionGoal(subAgentId)) continue;
      return inst.setGoalStepKind(subAgentId, stepId, kind);
    }
    return undefined;
  }

  /** ⑪(a)(b) — 종류는 프로젝트 한 벌(세션 키 없음)이라 지금 보는 프로젝트(primary)에 만든다. */
  upsertVisualKind(input: {
    key: string;
    label?: string;
    glyph?: string;
    color?: string;
    /** (i) — 무대 배경 그림·화면 골격·미리 표현 한 줄. 검증은 그래프가 한다. */
    scene?: unknown;
    surface?: unknown;
    blurb?: unknown;
    /** (m) — 밑그림 이름. 안 낸 칸만 채운다. */
    from?: unknown;
  }): import('@vibisual/shared').VisualKindCard | undefined {
    const inst = this.primaryInstance();
    return inst ? inst.upsertVisualKind(input) : undefined;
  }

  /** (i) — 주입 블록의 종류 키(휴지통 제외). 그 세션을 담은 인스턴스 것 — primary 가 아니어도 그 세션의 지도는 자기 프로젝트 카드로 그려진다. */
  getVisualKindKeysForSession(subAgentId: string): string[] {
    for (const inst of this.instances.values()) {
      if (!inst.getSessionGoal(subAgentId)) continue;
      return inst.getVisualKindKeys();
    }
    const primary = this.primaryInstance();
    return primary ? primary.getVisualKindKeys() : [];
  }

  /** ⑪(c) — 고정·해제. 어느 프로젝트에 있든 그 키를 가진 인스턴스에 간다. */
  setVisualKindPinned(key: string, pinned: boolean): import('@vibisual/shared').VisualKindCard | undefined {
    for (const inst of this.instances.values()) {
      const card = inst.setVisualKindPinned(key, pinned);
      if (card) return card;
    }
    return undefined;
  }

  /** §5.5 #17-17 ⑫(b) — 팔레트 고정은 지금 보는 프로젝트 한 곳에만 건다 — 팔레트는 프로젝트별로 배운 것이라 다른 인스턴스에 꽂으면 유령 고정이 된다. */
  setGoalActionPinned(id: string, pinned: boolean): boolean {
    const primary = this.primaryInstance();
    return primary ? primary.setGoalActionPinned(id, pinned) : false;
  }

  /** ⑪(c) — 휴지통으로 보내거나 꺼낸다. */
  setVisualKindTrashed(key: string, trashed: boolean): import('@vibisual/shared').VisualKindCard | undefined {
    for (const inst of this.instances.values()) {
      const card = inst.setVisualKindTrashed(key, trashed);
      if (card) return card;
    }
    return undefined;
  }

  /** 한 에이전트에 속한 목표 전부. */
  getSessionGoalsForAgent(agentId: string): import('@vibisual/shared').SessionGoal[] {
    const inst = this.findInstanceByAgentId(agentId);
    return inst ? inst.getSessionGoalsForAgent(agentId) : [];
  }

  setAgentConfig(agentId: string, config: AgentConfig): void {
    const inst = this.findInstanceByAgentId(agentId);
    if (inst) { inst.setAgentConfig(agentId, config); return; }
    // 등록된 인스턴스가 없으면 primary에 설정
    this.primaryInstance()?.setAgentConfig(agentId, config);
  }

  findSessionByAgentId(agentId: string): string | null {
    return this.findInstanceByAgentId(agentId)?.findSessionByAgentId(agentId) ?? null;
  }

  updateBubbleLabel(nodeId: string, label: string): void {
    // 에이전트 탐색
    const agentInst = this.findInstanceByAgentId(nodeId);
    if (agentInst) { agentInst.updateBubbleLabel(nodeId, label); return; }
    // 노드 탐색
    const nodeInst = this.findInstanceByNodeId(nodeId);
    if (nodeInst) { nodeInst.updateBubbleLabel(nodeId, label); return; }
    logger.warn(`ProjectGraphManager.updateBubbleLabel: node not found id="${nodeId}"`);
  }

  updateBubblePosition(nodeId: string, x: number, y: number): boolean {
    // 위성 위치는 어느 인스턴스에서든 처리 가능 — 먼저 agentId, 그 다음 nodeId
    for (const inst of this.instances.values()) {
      if (inst.updateBubblePosition(nodeId, x, y)) return true;
    }
    return false;
  }

  updateBubblePositionsBatch(positions: Array<{ id: string; x: number; y: number }>): void {
    // 각 위치를 올바른 인스턴스에 분배
    // sat- 접두사는 어느 인스턴스에서든 처리 가능하므로 모든 인스턴스에 전달
    // agentId/nodeId는 해당 인스턴스에만 전달
    if (this.instances.size === 1) {
      // 빠른 경로: 인스턴스 하나
      this.primaryInstance()?.updateBubblePositionsBatch(positions);
      return;
    }

    // 인스턴스 복수: sat- 는 primary로, 나머지는 올바른 인스턴스로 라우팅
    const satPositions = positions.filter((p) => p.id.startsWith('sat-'));
    const nonSatPositions = positions.filter((p) => !p.id.startsWith('sat-'));

    if (satPositions.length > 0) {
      this.primaryInstance()?.updateBubblePositionsBatch(satPositions);
    }

    for (const pos of nonSatPositions) {
      // §5.23 접힌 웹 버블은 노드 장부에 없다 — 주인 에이전트가 사는 인스턴스로 보낸다.
      const foldAgentId = webFoldAgentId(pos.id);
      const inst =
        (foldAgentId !== null ? this.findInstanceByAgentId(foldAgentId) : null)
        ?? this.findInstanceByAgentId(pos.id) ?? this.findInstanceByNodeId(pos.id);
      inst?.updateBubblePosition(pos.id, pos.x, pos.y);
    }
  }

  removeBubble(nodeId: string, opts: { force?: boolean; purgeTaskEdges?: boolean } = {}): void {
    // 클라이언트가 위성을 렌더할 때 ID 에 'sat-' prefix 를 붙이므로 strip 후 매칭.
    const normalized = nodeId.startsWith('sat-') ? nodeId.slice(4) : nodeId;
    // §5.23 접힌 웹 버블 — 노드 장부에 없는 id 라 아래 가드를 못 지난다. 주인 에이전트의 인스턴스에서
    //   지금 접혀 보이는 호스트들로 푼다(그 에이전트만 읽은 호스트는 지우고, 함께 읽은 호스트는 화살표만).
    const foldAgentId = webFoldAgentId(normalized);
    if (foldAgentId !== null) {
      const inst = this.findInstanceByAgentId(foldAgentId);
      if (inst?.removeWebFold(normalized, opts)) return;
    }
    for (const inst of this.instances.values()) {
      if (inst.hasAgentId(normalized) || inst.hasNodeId(normalized) || inst.hasSatelliteId(normalized)) {
        inst.removeBubble(normalized, opts);
        return;
      }
    }
    logger.warn(`ProjectGraphManager.removeBubble: node not found id="${nodeId}"`);
  }

  // ─── §5.10 (J) — 커스텀 에이전트 휴지통 위임 ───

  /**
   * 버블 id(에이전트 id) 가 커스텀 에이전트면 즉시 삭제 대신 휴지통으로 이동시킨다.
   * 성공하면 true(호출부는 removeBubble 대신 이걸 쓴다). 커스텀 에이전트가 아니면 false.
   */
  tryTrashCustomAgentByBubbleId(nodeId: string): boolean {
    const normalized = nodeId.startsWith('sat-') ? nodeId.slice(4) : nodeId;
    for (const inst of this.instances.values()) {
      if (inst.trashCustomAgentByBubbleId(normalized)) return true;
    }
    return false;
  }

  /** 휴지통 복구 — 세션 키(`custom-…`) 또는 버블 id(`agent-…`) 로. 성공 시 true. */
  restoreTrashedAgent(sessionIdOrBubbleId: string): boolean {
    for (const inst of this.instances.values()) {
      if (inst.restoreTrashedAgent(sessionIdOrBubbleId)) return true;
    }
    return false;
  }

  /** 휴지통 에이전트 영구 삭제 — 세션 키 또는 버블 id 로. 개별 기억 파일 삭제 + 묘비 기록. 성공 시 true. */
  permanentlyDeleteTrashedAgent(sessionIdOrBubbleId: string): boolean {
    for (const inst of this.instances.values()) {
      if (inst.permanentlyDeleteTrashedAgent(sessionIdOrBubbleId)) return true;
    }
    return false;
  }

  toggleDisappearPause(nodeId: string, durationSec: number): boolean | null {
    for (const inst of this.instances.values()) {
      if (inst.hasAgentId(nodeId) || inst.hasNodeId(nodeId)) {
        return inst.toggleDisappearPause(nodeId, durationSec);
      }
    }
    return null;
  }

  setDisappear(nodeId: string, durationSec: number): void {
    for (const inst of this.instances.values()) {
      if (inst.hasAgentId(nodeId) || inst.hasNodeId(nodeId)) {
        inst.setDisappear(nodeId, durationSec);
        return;
      }
    }
    logger.warn(`ProjectGraphManager.setDisappear: node not found id="${nodeId}"`);
  }

  /** preserve-pin 토글(§2.4). null=대상 없음, boolean=토글 후 값. */
  togglePreservePinned(nodeId: string): boolean | null {
    // §7.11 — hasAgentId/hasNodeId 가드를 두지 않는다: iframe 위성(persistSatellites)은 agent·node 가 아니라 막힌다.
    // 인스턴스 쪽이 셋을 다 뒤지고 못 찾으면 부작용 없이 null 이라 전부 불러도 안전하다.
    for (const inst of this.instances.values()) {
      const result = inst.togglePreservePinned(nodeId);
      if (result !== null) return result;
    }
    return null;
  }

  /** preserve-pin 여부(§2.4). 대상 없으면 false. */
  isPreservePinned(nodeId: string): boolean {
    for (const inst of this.instances.values()) {
      if (inst.isPreservePinnedById(nodeId)) return true;
    }
    return false;
  }

  toggleSatellite(folderPath: string, filePath: string, show: boolean, folderAbsPath?: string | null): boolean {
    const routed = this.instanceForNodePath(folderPath, folderAbsPath);
    if (routed) return routed.toggleSatellite(folderPath, filePath, show);
    for (const inst of this.instances.values()) {
      const ok = inst.toggleSatellite(folderPath, filePath, show);
      if (ok) return true;
    }
    return false;
  }

  setFolderMaxSatellites(folderPath: string, max: number): boolean {
    for (const inst of this.instances.values()) {
      const ok = inst.setFolderMaxSatellites(folderPath, max);
      if (ok) return true;
    }
    return false;
  }

  setFileEditsUnlimited(nodePath: string, unlimited: boolean): boolean {
    for (const inst of this.instances.values()) {
      const ok = inst.setFileEditsUnlimited(nodePath, unlimited);
      if (ok) return true;
    }
    return false;
  }

  /** §5.1 명령 앱 · §7.3 — 명령 목록 체크박스. 노드 id 는 프로젝트 스코프가 섞여 유일하다. */
  setCommandHistoryUnlimited(nodeId: string, unlimited: boolean): boolean {
    for (const inst of this.instances.values()) {
      if (inst.setCommandHistoryUnlimited(nodeId, unlimited)) return true;
    }
    return false;
  }

  // ─── §5.23 도메인 버블 ───

  /** 도메인 버블별 항목 상한 편집(§7.22). 노드 ID 는 프로젝트 스코프가 섞여 유일하다. */
  setDomainMaxEntries(nodeId: string, max: number): boolean {
    for (const inst of this.instances.values()) {
      const ok = inst.setDomainMaxEntries(nodeId, max);
      if (ok) return true;
    }
    return false;
  }

  /** 체크 = 제거 — 항목 한 줄을 그 도메인 목록에서 뺀다(§5.23). */
  removeWebEntry(nodeId: string, entryId: string): boolean {
    for (const inst of this.instances.values()) {
      const ok = inst.removeWebEntry(nodeId, entryId);
      if (ok) return true;
    }
    return false;
  }

  /** 그 도메인의 항목을 통째로 비운다(버블 자체는 남는다). */
  clearWebEntries(nodeId: string): boolean {
    for (const inst of this.instances.values()) {
      const ok = inst.clearWebEntries(nodeId);
      if (ok) return true;
    }
    return false;
  }

  /**
   * 노드 키의 소속을 먼저 정한다 — "첫 non-null 인스턴스가 이긴다"의 해독제. 노드 키(`docs`)는 루트 기준 상대 경로라 두 프로젝트가 다 가지면 먼저 등록된 쪽이 답한다.
   * 힌트 순서: ① `absolutePath` 를 품는 가장 깊은 루트(워크트리 우선) ② `__root__:<프로젝트>` 의 이름. 둘 다 없으면 `null` → 호출자가 전부 훑는다.
   */
  private instanceForNodePath(nodePath: string, absolutePath?: string | null): ProjectGraph | null {
    if (typeof absolutePath === 'string' && absolutePath.length > 0) {
      let best: ProjectGraph | null = null;
      let bestLen = -1;
      for (const [rootKey, inst] of this.instances) {
        if (!isWithinRoot(absolutePath, rootKey)) continue;
        if (rootKey.length > bestLen) { best = inst; bestLen = rootKey.length; }
      }
      if (best) return best;
    }
    if (nodePath.startsWith(ROOT_NODE_KEY_PREFIX)) {
      const projName = nodePath.substring(ROOT_NODE_KEY_PREFIX.length);
      if (projName) return this.getInstanceByName(projName);
    }
    return null;
  }

  toggleFolderChild(parentPath: string, filePath: string, show: boolean, parentAbsPath?: string | null): boolean {
    const routed = this.instanceForNodePath(parentPath, parentAbsPath);
    if (routed) return routed.toggleFolderChild(parentPath, filePath, show);
    for (const inst of this.instances.values()) {
      const ok = inst.toggleFolderChild(parentPath, filePath, show);
      if (ok) return true;
    }
    return false;
  }

  /** 폴더 한 겹의 한 페이지(§7.5). 인스턴스 라우팅 규약은 `toggleFolderChild` 와 같다. */
  listFolderFilePage(
    nodePath: string,
    absolutePath?: string | null,
    opts: { subPath?: string | null; cursor?: string | null; limit?: number } = {},
  ): FolderFilePage | null {
    const routed = this.instanceForNodePath(nodePath, absolutePath);
    if (routed) return routed.listFolderFilePage(nodePath, opts);
    for (const inst of this.instances.values()) {
      const result = inst.listFolderFilePage(nodePath, opts);
      if (result !== null) return result;
    }
    return null;
  }

  resolveAbsolutePath(nodePath: string): string | null {
    const routed = this.instanceForNodePath(nodePath);
    if (routed) {
      const hit = routed.resolveAbsolutePath(nodePath);
      if (hit !== null) return hit;
    }
    for (const inst of this.instances.values()) {
      const result = inst.resolveAbsolutePath(nodePath);
      if (result !== null) return result;
    }
    return null;
  }

  /** 열기 가드용 — 어느 인스턴스든 이 절대경로를 버블로 그리고 있으면 true (§2.1 #5 외부 폴더/파일 열기). */
  hasNodeAbsolutePath(absPath: string): boolean {
    for (const inst of this.instances.values()) {
      if (inst.hasNodeAbsolutePath(absPath)) return true;
    }
    return false;
  }

  // ─── Manager 레벨 ───

  /** 숨긴 프로젝트 — 데이터 보존, 스냅샷에서만 제외 */
  hideProject(name: string): boolean {
    // 해당 인스턴스에도 위임
    const inst = this.getInstanceByName(name);
    if (!inst) return false;
    this.hiddenProjects.add(name);
    return inst.hideProject(name);
  }

  showProject(name: string): boolean {
    this.hiddenProjects.delete(name);
    return this.getInstanceByName(name)?.showProject(name) ?? false;
  }

  isProjectHidden(name: string): boolean {
    return this.hiddenProjects.has(name);
  }

  /** 전체 프로젝트 목록 집계 */
  /** §3.2.3 — 보존 정리용 읽기 전용 순회. 인스턴스를 밖에 보관하지 마라(unload 뒤 유령 참조). */
  getInstancesForRetention(): ProjectGraph[] {
    return Array.from(this.instances.values());
  }

  getProjects(): Record<string, ProjectInfo> {
    const result: Record<string, ProjectInfo> = {};
    for (const inst of this.instances.values()) {
      Object.assign(result, inst.getProjects());
    }
    return result;
  }

  /** 전체 프로젝트 이름 목록 */
  getProjectNames(): string[] {
    const names: string[] = [];
    // orphan worktree 인스턴스는 제외 (todo0417 A-3) — 같은 이름이 부모 인스턴스에 이미 있음
    for (const [key, inst] of this.instances) {
      if (this.isWorktreeInstance(key, inst)) continue;
      names.push(...inst.getProjectNames());
    }
    return [...new Set(names)];
  }

  /**
   * 탭으로 보이는(hydrate · top-level · 비hidden) 프로젝트 — 스냅샷 `visibleProjects` 와 같은 기준(`openProjects` 재조정용).
   * hidden 은 인스턴스 SSOT 로 본다(Manager 의 `hiddenProjects` 는 재시작하면 빈다).
   */
  getVisibleTopLevelProjects(): ProjectInfo[] {
    const out: ProjectInfo[] = [];
    for (const [key, inst] of this.instances) {
      if (this.isWorktreeInstance(key, inst)) continue;
      for (const info of Object.values(inst.getProjects())) {
        if (info.parentProjectPath) continue; // worktree — 부모 탭 안에서만 보임
        if (inst.isProjectHidden(info.name)) continue; // × 로 닫은 탭 제외
        out.push(info);
      }
    }
    return out;
  }

  /** 첫 번째 인스턴스의 프로젝트 이름 */
  getPrimaryProjectName(): string | null {
    return this.primaryInstance()?.getPrimaryProjectName() ?? null;
  }

  /** 첫 번째 인스턴스의 루트 경로 */
  /** §5.11 — 떠 있는 인스턴스 루트(중복 제거). provider 안에서 `getSnapshot()` 을 부르면 자기 재호출이라 루트만 모은다. */
  getProjectRoots(): string[] {
    const out = new Set<string>();
    for (const inst of this.instances.values()) {
      const root = inst.getRoot();
      if (root) out.add(root);
    }
    return [...out];
  }

  getRoot(): string | null {
    return this.primaryInstance()?.getRoot() ?? null;
  }

  /** 전체 인스턴스의 세션 ID 목록 */
  getSessionIds(): string[] {
    const ids: string[] = [];
    for (const inst of this.instances.values()) {
      ids.push(...inst.getSessionIds());
    }
    return ids;
  }

  /** 모든 프로젝트의 세션 탐색 + 시딩 */
  scanAllProjects(): boolean {
    let seeded = false;
    for (const inst of this.instances.values()) {
      if (inst.scanAllProjects()) seeded = true;
    }
    return seeded;
  }

  // ─── 집계 스냅샷 ───

  /** instance key 가 worktree cwd 패턴인지 — orphan 인스턴스 감지용 (todo0417 A-3).
   *  resolveProjectRoot 변경(A-1) 이후 신규 생성은 막히지만, 런타임 중/재기동 전 생성된 인스턴스 방어. */
  private isWorktreeInstanceKey(key: string): boolean {
    return /\/\.claude\/worktrees\/[^/]+\/?$/.test(key);
  }

  /**
   * 워크트리 인스턴스인가(부모에 흡수돼야 함) — `.claude/worktrees/` 경로 패턴이거나, 루트 ProjectInfo 에 `parentProjectPath` 가 있는
   * git-linked 워크트리(`--isolation worktree`). 이미 생긴 것(`agent-<hex>`)을 저장 순회·스냅샷에서 뺀다.
   */
  private isWorktreeInstance(key: string, inst: ProjectGraph): boolean {
    if (this.isWorktreeInstanceKey(key)) return true;
    return !!inst.getProjectInfoByPath(key)?.parentProjectPath;
  }

  /**
   * 엉뚱한 인스턴스(worktree↔primary)에 든 TaskEdge 를 소스 에이전트 쪽으로 옮긴다(기동 시 한 번)
   * — 그대로면 scoped checkpoint 필터에서 빠져 저장이 유실된다. 반환: 옮긴 수.
   */
  reassignMisroutedTaskEdges(): number {
    let moved = 0;
    for (const [, inst] of this.instances) {
      const snap = inst.getTaskEdgesSnapshot();
      for (const edge of Object.values(snap)) {
        const srcProj = this.getAgentProjectName(edge.sourceAgentId);
        const dstProj = this.getAgentProjectName(edge.targetAgentId);
        const targetProj = srcProj ?? dstProj;
        if (!targetProj) continue; // 프로젝트 미상이면 건드리지 않음
        const targetInst = this.getInstanceByName(targetProj);
        if (!targetInst || targetInst === inst) continue; // 이미 올바른 위치
        if (targetInst.acceptTaskEdge(edge)) {
          inst.deleteTaskEdge(edge.id);
          moved += 1;
          logger.info(`Task Edge relocated: ${edge.id} → ${targetProj}`);
        }
      }
    }
    return moved;
  }

  /** orphan worktree 인스턴스 제거 — 기동 시 호출. sessionRouting dead entry 도 동반 정리. */
  cleanupOrphanWorktreeInstances(): number {
    let removed = 0;
    const removedKeys = new Set<string>();
    for (const [key, inst] of [...this.instances.entries()]) {
      if (this.isWorktreeInstance(key, inst)) {
        this.instances.delete(key);
        removedKeys.add(key);
        removed += 1;
        logger.warn(`Removed orphan worktree instance: ${key}`);
      }
    }
    // sessionRouting 에 worktree key 로 매핑된 세션이 있으면 제거 — 다음 훅에서 부모로 재라우팅됨
    for (const [sid, key] of [...this.sessionRouting]) {
      if (removedKeys.has(key)) this.sessionRouting.delete(sid);
    }
    return removed;
  }

  // §9 스코프드 스냅샷 구독 — 창마다 "지금 그리는 프로젝트"를 선언하고 그 합집합만 무거운 슬라이스에 싣는다
  // (실측 2026-08-19: 탭 7개 중 1개를 볼 때 3.31MB 중 81% 가 안 보는 몫).
  // **아무도 선언하지 않았으면 전부** — 침묵을 축소로 읽으면 화면이 빈 채로 굳는다.
  /** 클라이언트(창) → 그 창이 필요한 프로젝트 표시명 집합. 키는 conn 객체 자체(창 정체성). */
  private clientScopes = new Map<object, Set<string>>();

  /**
   * §9 폴더 스코프 — 창 → 연 폴더의 내비 경로. `null` = 폴더 축 미선언(구버전 클라)이고 하나라도 있으면 합집합 전체가 `null`(전량).
   * 빈 배열(메인 뷰, 좁혀도 됨)과 뜻이 달라 별도 맵이다.
   */
  private clientFolderScopes = new Map<object, Set<string> | null>();

  /**
   * §9 슬라이스 스코프 — 창 → 읽는 슬라이스 묶음. `null`(미선언)이 하나라도 있으면 전량, 빈 집합은 좁혀도 되는 선언.
   * **창별로 다른 슬라이스를 보내지 마라** — `broadcastBus.lastSentSlices` 가 전역 기준점 하나라 증분이 틀린 값을 복원한다(`sliceScope.ts` 함정 ①). 늘 합집합 한 벌.
   */
  private clientSliceScopes = new Map<object, Set<SliceScopeGroup> | null>();

  /**
   * §9 「창이 뜬 직후의 메인 스레드」 ① — 아직 아무 창도 선언하지 않은 부팅 구간에만 싣는 프로젝트(마지막으로 보던 것).
   * 그 구간에 전부를 대화 기록 재파싱까지 하며 지으면 창이 뜬 순간 메인 스레드가 막힌다. 첫 선언이 오면 물러난다.
   */
  private bootViewPath: string | null = null;
  /** 이 세션에서 한 창이라도 범위를 선언했는가 — 그 뒤의 침묵은 종전 규칙(전량)이다. */
  private scopeEverDeclared = false;

  /** §9 배경 탭 유휴 해제 — 표시명 → 마지막으로 어떤 창의 구독 범위에 들어 있던 시각(epoch ms). */
  private lastInScopeAt = new Map<string, number>();
  /** §9 — 서버 기동 시각. "이 세션에서 한 번도 본 적 없는" 프로젝트의 유휴 기준점. */
  private readonly bootedAt = Date.now();
  /** §9 — 이 세션에서 자동 hydrate 가 실패한 프로젝트(같은 실패를 매 선언마다 되풀이하지 않는다). */
  private autoHydrateFailed = new Set<string>();

  /**
   * §9 — 한 창의 범위 갱신(빈 배열도 유효). 선언 = "지금 본다"라 유휴 기준 시각(`lastInScopeAt`)을 당기고,
   * stub 이면 자동으로 다시 올린다(§9 "탭을 누르면 되살아난다").
   */
  setClientProjectScope(client: object, projects: string[], folders?: string[], slices?: string[]): void {
    const names = projects.filter((p) => typeof p === 'string' && p.length > 0);
    this.clientScopes.set(client, new Set(names));
    this.scopeEverDeclared = true;
    // §9 폴더 스코프 — 같은 선언에 얹혀 온다. **안 보냈으면(undefined) 미선언**이라 전량으로
    //   되돌아간다(빈 배열 = "폴더 밖" 이라는 유효한 선언과 구분해야 한다).
    this.clientFolderScopes.set(
      client,
      Array.isArray(folders)
        ? new Set(folders.filter((f) => typeof f === 'string' && f.length > 0))
        : null,
    );
    // §9 슬라이스 스코프 — 셋째 축도 **같은 선언에 얹혀** 온다(한 메시지 = 한 왕복). 폴더 축과
    //   똑같이 `undefined` = 미선언(전량), `[]` = "아무 것도 안 읽는다"는 유효한 선언이다.
    //   모르는 그룹 이름은 조용히 버린다 — 전선에서 온 값을 그대로 믿지 않는다.
    this.clientSliceScopes.set(
      client,
      Array.isArray(slices)
        ? new Set(slices.filter(isSliceScopeGroup))
        : null,
    );
    const now = Date.now();
    for (const name of names) {
      this.lastInScopeAt.set(name, now);
      if (this.autoHydrateFailed.has(name)) continue;
      if (this.isProjectReadOnly(name)) continue;      // §3.2.1-4 격리된 것은 건드리지 않는다
      if (!this.isStubbed(name)) continue;
      const result = this.hydrateProject(name);
      if (!result.ok && result.reason !== 'already-hydrated') {
        this.autoHydrateFailed.add(name);
        logger.warn(`auto-hydrate on scope declaration failed for "${name}" (${result.reason ?? 'unknown'}) — not retrying this session`);
      }
    }
  }

  /**
   * §9 배경 탭 유휴 해제 — 안 보고·일 없고·`idleMs` 가 지난 프로젝트를 stub 으로 내린다(`unloadProject`).
   * `idleMs <= 0`(무제한) · 선언한 창이 없음 · 어떤 창의 범위 안 · `hasRunningWork` 면 내리지 않는다.
   * @returns 내린 프로젝트 표시명
   */
  sweepIdleBackgroundProjects(idleMs: number): string[] {
    if (idleMs <= 0) return [];
    const scope = this.getEffectiveProjectScope();
    if (scope === null) return [];

    const now = Date.now();
    const visible = this.visibleInstanceList();
    const displayNames = this.instanceDisplayNames(visible);
    const unloaded: string[] = [];

    for (const inst of visible) {
      const display = displayNames.get(inst);
      const info = inst.getPrimaryProject();
      if (!display || !info) continue;
      if (scope.has(display) || scope.has(info.name)) {
        this.lastInScopeAt.set(display, now);
        continue;
      }
      if (inst.hasRunningWork()) continue;
      const lastViewed = this.lastInScopeAt.get(display) ?? 0;
      // 한 번도 본 적 없는(이 세션에서 선언된 적 없는) 프로젝트는 부팅 시각을 기준으로 삼는다 —
      // 부팅 직후 전부 내려가 버리는 일을 막는다.
      const viewedRef = lastViewed > 0 ? lastViewed : this.bootedAt;
      if (now - viewedRef < idleMs) continue;
      if (now - inst.getLastActivityAt() < idleMs) continue;

      const result = this.unloadProject(info.path);
      if (result.ok) {
        unloaded.push(display);
        this.lastInScopeAt.delete(display);
      }
    }
    return unloaded;
  }

  /** §9 — 창이 닫히면 그 선언을 지운다. 남겨 두면 합집합이 넓어진 채로 굳고 유휴 해제도 막힌다. */
  clearClientProjectScope(client: object): void {
    this.clientScopes.delete(client);
    this.clientFolderScopes.delete(client);
    // 슬라이스 선언도 같은 수명이다 — 남겨 두면 닫힌 창 때문에 합집합이 넓어진 채로 굳는다.
    this.clientSliceScopes.delete(client);
  }

  /**
   * §9 — 슬라이스 범위 합집합, `null` = 전부 싣는다. 판정은 `resolveSliceShipSet` 한 곳.
   * 선언한 창이 없거나 축을 모르는 창이 있으면 `null` — 좁히면 화면이 깨진다.
   */
  getEffectiveSliceScope(): ReadonlySet<ScopableSliceKey> | null {
    return resolveSliceShipSet(this.clientSliceScopes.values());
  }

  /**
   * §9 — 폴더 범위 합집합, `null` = 전량. 선언한 창이 없거나 폴더 축을 모르는 창이 하나라도 있으면 `null`
   * — 그 창은 연 폴더를 말할 수 없어 좁히면 폴더 안이 영영 빈다.
   */
  getEffectiveFolderScope(): Set<string> | null {
    if (this.clientFolderScopes.size === 0) return null;
    const union = new Set<string>();
    for (const set of this.clientFolderScopes.values()) {
      if (set === null) return null;
      for (const id of set) union.add(id);
    }
    return union;
  }

  /**
   * §9 — 지금 유효한 구독 범위(모든 창 선언의 합집합).
   * `null` 이면 "제한 없음"(선언한 창이 하나도 없음) — 호출자는 전부를 대상으로 삼아야 한다.
   */
  getEffectiveProjectScope(): Set<string> | null {
    if (this.clientScopes.size === 0) return null;
    const union = new Set<string>();
    for (const set of this.clientScopes.values()) {
      for (const name of set) union.add(name);
    }
    return union;
  }

  /**
   * 탭으로 보이는(비-worktree · 비-hidden) 인스턴스. hidden 은 인스턴스 SSOT 로 본다(Manager 쪽은 재시작하면 빈다).
   * 스냅샷과 유휴 해제가 이 한 목록을 써야 "보이는 것"과 "내려도 되는 것"이 갈리지 않는다(§9).
   */
  private visibleInstanceList(): ProjectGraph[] {
    return [...this.instances.entries()]
      .filter(([key, inst]) => !this.isWorktreeInstance(key, inst))
      .map(([, inst]) => inst)
      .filter((inst) => {
        const name = inst.getPrimaryProjectName();
        return name ? !inst.isProjectHidden(name) : true;
      });
  }

  /**
   * §9 — 인스턴스 → 전역 유일 표시명. 스냅샷(머지 전 relabel)과 구독 범위 판정이 **같은 이름**을
   * 써야 한다 — 한쪽이 원본 이름, 다른 쪽이 표시명이면 같은 basename 프로젝트가 둘 열렸을 때
   * 범위 판정이 조용히 어긋난다.
   */
  private instanceDisplayNames(visibleInstances: ProjectGraph[]): Map<ProjectGraph, string> {
    const idItems: { id: string; name: string; path: string }[] = [];
    const instProj = new Map<ProjectGraph, { id: string; raw: string }>();
    for (const inst of visibleInstances) {
      const pp = inst.getPrimaryProject();
      if (!pp) continue;
      const id = normPathId(pp.path);
      idItems.push({ id, name: pp.name, path: pp.path });
      instProj.set(inst, { id, raw: pp.name });
    }
    const hydratedIds = new Set(idItems.map((it) => it.id));
    for (const meta of Object.values(this.getStubProjects())) {
      const id = normPathId(meta.project.path);
      if (hydratedIds.has(id)) continue;
      idItems.push({ id, name: meta.project.name, path: meta.project.path });
    }
    const displayNames = computeUniqueDisplayNames(idItems);
    const result = new Map<ProjectGraph, string>();
    for (const [inst, pj] of instProj) result.set(inst, displayNames.get(pj.id) ?? pj.raw);
    return result;
  }

  /**
   * 서버 내부용 전체 스냅샷 — 범위를 적용하지 않는다. REST·dispatch·로그 스트리머가 좁힌 스냅샷을 보면 배경 프로젝트의 에이전트가 "없다"가 된다
   * — 범위는 `getBroadcastSnapshot()` 에만(§9).
   */
  getSnapshot(): GraphSnapshot {
    return this.buildSnapshot(null, null, null);
  }

  /**
   * §9 — **브로드캐스트로 나갈 스냅샷**. 붙어 있는 창들의 구독 범위 합집합만 무거운 슬라이스에 싣는다.
   * 선언한 창이 없으면 전체와 같다(안전 기본값).
   */
  getBroadcastSnapshot(): GraphSnapshot {
    return this.buildSnapshot(
      this.getEffectiveProjectScope() ?? this.getBootViewScope(),
      this.getEffectiveFolderScope(),
      this.getEffectiveSliceScope(),
    );
  }

  /** §9 ① — 부팅 구간 프로젝트(`AppState.lastActiveProject` 경로). 빈 값이면 부팅 구간도 전량. */
  setBootViewProject(projectPath: string | null | undefined): void {
    this.bootViewPath = typeof projectPath === 'string' && projectPath.length > 0 ? projectPath : null;
  }

  /**
   * 부팅 구간 범위 — 범위 판정과 같은 표시명(`instanceDisplayNames`). 인스턴스를 못 찾으면 `null`(전량) — 판정 실패가 빈 화면이 되면 안 된다.
   * 유휴 해제는 이 범위를 안 본다.
   */
  private getBootViewScope(): Set<string> | null {
    if (this.scopeEverDeclared || this.bootViewPath === null) return null;
    const want = normPathId(this.bootViewPath);
    const visible = this.visibleInstanceList();
    const displayNames = this.instanceDisplayNames(visible);
    for (const inst of visible) {
      const pp = inst.getPrimaryProject();
      if (!pp || normPathId(pp.path) !== want) continue;
      const display = displayNames.get(inst);
      if (display) return new Set([display]);
    }
    return null;
  }

  private buildSnapshot(
    scope: Set<string> | null,
    folderScope: Set<string> | null,
    sliceScope: ReadonlySet<ScopableSliceKey> | null,
  ): GraphSnapshot {
    const visibleInstances = this.visibleInstanceList();

    // §3.2.2 진단 — 라이브 스냅샷은 visibleInstances 만 병합하므로
    //   커스텀 에이전트가 worktree/hidden 인스턴스에 얹히면 버블이 사라져 보인다.
    //   그런 위치를 sessionId 당 1회 경고한다.
    {
      const visibleSet = new Set(visibleInstances);
      for (const [key, inst] of this.instances) {
        if (visibleSet.has(inst)) continue;
        for (const sid of inst.getCustomAgentSessionIds()) {
          if (this.warnedHiddenCustomAgents.has(sid)) continue;
          this.warnedHiddenCustomAgents.add(sid);
          logger.warn(
            `[custom-agent-visibility] custom agent session ${sid.slice(0, 12)} lives in an ` +
            `excluded instance (key="${key}", worktree=${this.isWorktreeInstanceKey(key)}) — it will NOT ` +
            `appear in the live canvas. This is the likely cause of a "disappearing custom bubble". ` +
            `Recovery: canvas → context menu → restore previous custom agent.`,
          );
        }
      }
    }

    // 머지 전에 인스턴스마다 전역 유일 표시명으로 relabel 한다 — 아니면 같은 basename 다른 경로 둘이
    // 이름 키 맵에서 충돌해 하나가 사라진다(§3.5).
    const stubMetaRaw = this.getStubProjects();
    const idItems: { id: string; name: string; path: string }[] = [];
    const instProj = new Map<ProjectGraph, { id: string; raw: string }>();
    for (const inst of visibleInstances) {
      const pp = inst.getPrimaryProject();
      if (!pp) continue;
      const id = normPathId(pp.path);
      idItems.push({ id, name: pp.name, path: pp.path });
      instProj.set(inst, { id, raw: pp.name });
    }
    const hydratedIds = new Set(idItems.map((it) => it.id));
    for (const meta of Object.values(stubMetaRaw)) {
      const id = normPathId(meta.project.path);
      if (hydratedIds.has(id)) continue; // 같은 경로 = 동일 프로젝트, hydrated 우선 (아래서 drop)
      idItems.push({ id, name: meta.project.name, path: meta.project.path });
    }
    const displayNames = computeUniqueDisplayNames(idItems);

    // §9 스코프드 구독 — 무거운 슬라이스는 **지금 누군가 그리고 있는** 인스턴스만 만든다.
    //   범위 밖 인스턴스는 `getSnapshot()` 자체를 부르지 않으므로 그쪽 `enrichNode`·요약 재시도
    //   비용까지 함께 사라진다(전선 부피뿐 아니라 CPU 도 준다).
    const displayNameOfInstance = (inst: ProjectGraph): string | null => {
      const pj = instProj.get(inst);
      if (!pj) return null;
      return displayNames.get(pj.id) ?? pj.raw;
    };
    const scopedInstances = scope === null
      ? visibleInstances
      : visibleInstances.filter((inst) => {
          const name = displayNameOfInstance(inst);
          // 표시명을 못 구한 인스턴스는 **포함**한다 — 판정 실패가 조용한 누락이 되면 안 된다.
          return name === null ? true : scope.has(name);
        });

    const subSnaps = scopedInstances.map((inst) => {
      const pj = instProj.get(inst);
      const snap = inst.getSnapshot(folderScope);
      if (!pj) return snap;
      const to = displayNames.get(pj.id);
      return to ? relabelSubSnapshot(snap, pj.raw, to) : snap;
    });
    let snapshot = subSnaps.length === 0 ? emptySnapshot() : subSnaps[0]!;
    for (let i = 1; i < subSnaps.length; i++) {
      snapshot = mergeSnapshots(snapshot, subSnaps[i]!);
    }

    // §9 — **범위와 무관하게 항상 전량**인 것들. 여기를 빠뜨리면 배경 탭이 사라지거나(탭 목록)
    //   헤더 숫자가 줄어(전역 집계) "최적화가 아니라 기능 손상"이 된다.
    {
      const projectsAll: Record<string, ProjectInfo> = { ...snapshot.projects };
      const agentCounts: Record<string, ProjectAgentCounts> = {};
      let activeAgentCountAll = 0;
      // §9 폴더 스코프 — 상대 척도 둘도 여기서 **전량으로** 잰다. 좁힌 노드로 재면 폴더를
      //   드나들 때마다 버블 크기와 히트맵 색이 바뀐다(같은 칸의 같은 이유).
      let fileMin = Infinity;
      let fileMax = 0;
      const readMaxByProject: Record<string, number> = {};
      let readMaxUnowned = 0;
      // §5.24 축 토글 — 쓰기 축도 같은 규칙으로 전량에서 잰다(축마다 자가 따로여야 한다).
      const writeMaxByProject: Record<string, number> = {};
      let writeMaxUnowned = 0;
      // §5.24 `quantile` 곡선 — 분포도 최대값과 **같은 칸**이다(좁히면 순위가 뒤집혀 색이 통째로 바뀐다).
      //   여기서는 값을 모으기만 하고, 표본으로 요약하는 것은 인스턴스를 다 합친 뒤다.
      const readValuesByProject: Record<string, number[]> = {};
      const readValuesUnowned: number[] = [];
      const writeValuesByProject: Record<string, number[]> = {};
      const writeValuesUnowned: number[] = [];
      for (const inst of visibleInstances) {
        activeAgentCountAll += inst.getActiveAgentCount();
        {
          const extent = inst.getFileSizeExtent();
          if (extent.max > 0) {
            if (extent.min < fileMin) fileMin = extent.min;
            if (extent.max > fileMax) fileMax = extent.max;
          }
          const heat = inst.getHeatCountMaxes();
          if (heat.read.unowned > readMaxUnowned) readMaxUnowned = heat.read.unowned;
          if (heat.write.unowned > writeMaxUnowned) writeMaxUnowned = heat.write.unowned;
          const display = displayNameOfInstance(inst);
          const pj = instProj.get(inst);
          for (const [axisMaxes, out, valuesOut, unownedOut] of [
            [heat.read, readMaxByProject, readValuesByProject, readValuesUnowned],
            [heat.write, writeMaxByProject, writeValuesByProject, writeValuesUnowned],
          ] as const) {
            for (const [rawName, max] of Object.entries(axisMaxes.byProject)) {
              // 인스턴스 안의 원본 프로젝트 이름을 탭에 뜨는 표시명으로 옮겨 담는다(클라의 조회 키).
              const key = pj && display && rawName === pj.raw ? display : rawName;
              if (max > (out[key] ?? 0)) out[key] = max;
            }
            // 분포는 최대값과 **같은 키 규칙**을 탄다 — 여기서 갈리면 색과 눈금이 다른 척도를 본다.
            for (const [rawName, values] of Object.entries(axisMaxes.valuesByProject)) {
              const key = pj && display && rawName === pj.raw ? display : rawName;
              const bucket = (valuesOut[key] ??= []);
              for (const v of values) bucket.push(v);
            }
            for (const v of axisMaxes.unownedValues) unownedOut.push(v);
          }
        }
        const display = displayNameOfInstance(inst);
        const pj = instProj.get(inst);
        // 탭 목록: 범위 밖 인스턴스의 ProjectInfo 를 표시명으로 얹는다(프로젝트당 수백 바이트).
        if (pj && display && !(display in projectsAll)) {
          const info = inst.getProjectByName(pj.raw) ?? inst.getPrimaryProject();
          if (info) projectsAll[display] = { ...info, name: display };
        }
        // 탭 배지: 인스턴스 안의 프로젝트 이름(원본)을 표시명으로 옮겨 담는다.
        for (const [rawName, counts] of Object.entries(inst.getAgentCountsByProject())) {
          const key = pj && display && rawName === pj.raw ? display : rawName;
          const prev = agentCounts[key];
          agentCounts[key] = prev
            ? {
                total: prev.total + counts.total,
                active: prev.active + counts.active,
                completed: prev.completed + counts.completed,
                sessions: prev.sessions + counts.sessions,
                running: prev.running + counts.running,
                limited: prev.limited + counts.limited,
              }
            : counts;
        }
      }
      // 소유 프로젝트를 모르는 노드는 클라가 쓰던 규칙대로 **어느 프로젝트에나** 센다.
      //   그래서 마지막에 모든 프로젝트 칸에 그 바닥을 얹는다(칸이 없던 프로젝트도 만든다).
      for (const [unowned, out] of [
        [readMaxUnowned, readMaxByProject],
        [writeMaxUnowned, writeMaxByProject],
      ] as const) {
        if (unowned <= 0) continue;
        for (const name of Object.keys(projectsAll)) {
          if (unowned > (out[name] ?? 0)) out[name] = unowned;
        }
      }
      // §5.24 — 분포는 값을 다 모은 **지금** 표본으로 접는다(정렬은 프로젝트당 한 번뿐).
      //   소유를 모르는 값은 최대값과 같은 규칙으로 모든 프로젝트에 얹는다.
      const readQuantilesByProject: Record<string, number[]> = {};
      const writeQuantilesByProject: Record<string, number[]> = {};
      for (const [valuesOut, unownedValues, quantilesOut] of [
        [readValuesByProject, readValuesUnowned, readQuantilesByProject],
        [writeValuesByProject, writeValuesUnowned, writeQuantilesByProject],
      ] as const) {
        const names = new Set([...Object.keys(projectsAll), ...Object.keys(valuesOut)]);
        for (const name of names) {
          const own = valuesOut[name] ?? [];
          const merged = unownedValues.length > 0 ? own.concat(unownedValues) : own;
          const samples = heatQuantileSamples(merged);
          if (samples.length > 0) quantilesOut[name] = samples;
        }
      }
      snapshot = {
        ...snapshot,
        projects: projectsAll,
        projectAgentCounts: agentCounts,
        activeAgentCount: activeAgentCountAll,
        fileSizeRange: { min: fileMin === Infinity ? 0 : fileMin, max: fileMax },
        readCountMaxByProject: readMaxByProject,
        writeCountMaxByProject: writeMaxByProject,
        readCountQuantilesByProject: readQuantilesByProject,
        writeCountQuantilesByProject: writeQuantilesByProject,
      };
    }

    // §9 — 실제로 적용한 범위를 되돌려 준다. 클라가 "아직 안 온 것"과 "원래 빈 프로젝트"(둘 다 빈 캔버스)를 가르는 유일한 근거다.
    //   전량이면 싣지 않는다.
    if (scope !== null) {
      snapshot = { ...snapshot, scopedProjects: [...scope] };
    }
    // §9 폴더 스코프 — 같은 이유로 **적용한 폴더 범위**도 되돌려 준다. 클라는 이걸로 열어 둔
    //   폴더의 내용이 아직 안 온 것과 원래 빈 폴더를 가른다(둘 다 화면에서는 빈 내부 뷰다).
    if (folderScope !== null) {
      snapshot = { ...snapshot, scopedFolders: [...folderScope] };
    }

    // Manager 레벨 task edges 는 fallback(인스턴스 없을 때) 용도만 — overlay 하되
    // 인스턴스 소유분이 우선(...manager 먼저, ...inst 나중). 기존 로직은 매 restart 마다
    // Manager 가 stale copy 를 들고 있어 delete 후에도 overlay 가 edge 를 되살리는 버그가 있었음.
    if (this.taskEdges.size > 0) {
      snapshot = { ...snapshot, taskEdges: { ...Object.fromEntries(this.taskEdges), ...snapshot.taskEdges } };
    }

    // sessionLifecycle 데이터 주입
    if (this.lifecycleSnapshotProvider) {
      const lifecycleData = this.lifecycleSnapshotProvider();
      snapshot = {
        ...snapshot,
        sessionSources: { ...snapshot.sessionSources, ...lifecycleData.sessionSources },
        sessionStatuses: { ...snapshot.sessionStatuses, ...lifecycleData.sessionStatuses },
      };
    }

    // gitStatusService 주입 — root 버블 dirty dot 용
    if (this.gitDirtyProvider) {
      const map = this.gitDirtyProvider();
      if (Object.keys(map).length > 0) {
        snapshot = { ...snapshot, gitDirty: map };
      }
    }

    // §5.11 — 플러그인 실측은 병합 뒤에 얹는다(이미 프로젝트 키가 든 값이라
    //   `mergeSnapshots` 에 넣을 필요가 없고, 빠뜨릴 자리도 안 생긴다).
    if (this.pluginFactsProvider) {
      const facts = this.pluginFactsProvider();
      if (facts && Object.keys(facts).length > 0) {
        snapshot = { ...snapshot, pluginFacts: facts };
      }
    }

    // §5.11 정독 게이트 — 세션별 정독 상태도 **병합이 끝난 뒤** 얹는다(`SubAgent.id` 키라 병합 대상이
    //   아니며, 여기 한 곳에서 넣으므로 방송 지점 하나를 빠뜨려 값이 사라지는 부류가 생기지 않는다).
    if (this.specReadingProvider) {
      const reading = this.specReadingProvider();
      if (reading && Object.keys(reading).length > 0) {
        snapshot = { ...snapshot, specReading: reading };
      }
    }

    // stub 합성 — 충돌은 경로로 판정. 같은 경로가 hydrated 면 stub 은 버리고, 같은 basename·다른 경로는 둘 다 노출(displayNames 로 유일화).
    // stub 키·project.name 도 표시명.
    const stubMap: Record<string, ProjectMetaSnapshot> = {};
    for (const meta of Object.values(stubMetaRaw)) {
      const id = normPathId(meta.project.path);
      if (hydratedIds.has(id)) {
        logger.debug(`Snapshot: stub "${meta.project.name}" same path as hydrated — dropped`);
        continue;
      }
      const display = displayNames.get(id) ?? meta.project.name;
      stubMap[display] = { ...meta, project: { ...meta.project, name: display } };
    }
    snapshot = { ...snapshot, stubProjects: stubMap };

    // AppState 주입 — 탭 라이프사이클 (Pin/Default/LastActive/openProjects) SSOT.
    // §4 API 크레딧 — 키가 든 칸은 밖으로 내보내지 않는다(`publicAppState`).
    snapshot = { ...snapshot, appState: publicAppState(loadAppState()) };

    // §4 — 글로벌 rateLimits 주입(사용자 단위, 프로젝트 무관).
    if (this.globalRateLimits) {
      snapshot = { ...snapshot, rateLimits: this.globalRateLimits };
    }

    // §4 — 글로벌 Claude 사용량(OAuth) 주입. 한도는 사용자 단위라 프로젝트 무관.
    if (this.globalClaudeUsage) {
      snapshot = { ...snapshot, claudeUsage: this.globalClaudeUsage };
    }

    // §4 API 크레딧 — 설정·장부·지금 경로. 머신 단위 1건이고 키 본문은 없다(`getState` 가 끝 4자리만 싣는다).
    snapshot = { ...snapshot, apiCredits: apiCreditService.getState() };

    // §4 — 글로벌 Claude 로그인 상태 주입(계정은 머신 단위).
    if (this.globalClaudeAuth) {
      snapshot = { ...snapshot, claudeAuth: this.globalClaudeAuth };
    }

    // §4 (첫 실행 설치 온보딩) — CLI 설치 판정 주입. 설치도 기기 단위라 프로젝트 무관.
    if (this.globalClaudeSetup) {
      snapshot = { ...snapshot, claudeSetup: this.globalClaudeSetup };
    }

    // §5.25 — 코덱스 상태 셋 주입. 클로드 것과 같은 이유로 프로젝트 무관.
    if (this.globalCodexAuth) {
      snapshot = { ...snapshot, codexAuth: this.globalCodexAuth };
    }
    if (this.globalCodexSetup) {
      snapshot = { ...snapshot, codexSetup: this.globalCodexSetup };
    }
    if (this.globalCodexModels) {
      snapshot = { ...snapshot, codexModels: this.globalCodexModels };
    }
    if (this.globalCodexInventory) {
      snapshot = { ...snapshot, codexInventory: this.globalCodexInventory };
    }
    if (this.globalCodexReviews && this.globalCodexReviews.length > 0) {
      snapshot = { ...snapshot, codexReviews: this.globalCodexReviews };
    }
    if (this.globalCodexHooks) {
      snapshot = { ...snapshot, codexHooks: this.globalCodexHooks };
    }

    // §4 — 글로벌 진단 에러 로그 주입(런타임 캐시).
    const diagLog = diagnosticService.getLog();
    if (diagLog.length > 0) {
      snapshot = { ...snapshot, diagnosticLog: diagLog };
    }

    // §4 — 모델 레지스트리 주입(AgentConfigPopup 버전 sub-드롭다운 데이터).
    snapshot = { ...snapshot, modelRegistry: modelRegistryService.getRegistry() };

    // §5.19 — 로컬 LLM 상태 주입(엔진 설치 여부 + 받아 둔 모델 + 진행 중 내려받기).
    //   modelRegistry 와 같은 기기 전역 값이고, 진실은 디스크라 영속화하지 않는다.
    snapshot = {
      ...snapshot,
      localLlm: {
        engine: getEngineState(),
        models: listModels(),
        downloads: listDownloads(),
        loaded: listLoadedModels(),
        hardware: peekLocalHardware(),
      },
    };

    // §4 — 사용자 글로벌 옵션 주입(Options 창 데이터).
    snapshot = { ...snapshot, userDefaults: userDefaultsService.get() };

    // §9 — 범위 밖 슬라이스는 조립이 끝난 뒤 여기 한 곳에서만 지운다(주입 지점마다 빼면 하나만 빠져도 계속 실리거나 사라진다).
    //   대상은 `SCOPABLE_SLICE_KEYS` 뿐 — 전역 집계·탭·캔버스 골격은 들 수 없다(`sliceScope.ts` 두 표가 컴파일 타임에 배타).
    //   적용했으면 실은 목록을 되돌려 준다 — 없으면 클라의 `?? {}` 폴백이 데이터 소실로 보인다.
    if (sliceScope !== null) {
      const stripped = stripScopedOutSlices(snapshot, sliceScope);
      snapshot = { ...stripped.snapshot, scopedSlices: stripped.scopedSlices };
    }

    return snapshot;
  }

  // ─── 체크포인트 ───

  /** seq 증가 — 모든 인스턴스에 적용 */
  incrementSeq(): void {
    for (const inst of this.instances.values()) inst.incrementSeq();
  }

  /** 주 체크포인트 저장 (단일 프로젝트 시 사용) */
  toCheckpoint(): ProjectCheckpoint {
    const inst = this.primaryInstance();
    if (!inst) throw new Error('ProjectGraphManager.toCheckpoint: no instances registered');
    return inst.toProjectCheckpoint(inst.getPrimaryProjectName() ?? 'unknown');
  }

  /** 체크포인트 복원 — cp.project.path로 인스턴스 라우팅 */
  restoreFromCheckpoint(cp: ProjectCheckpoint): void {
    // 레거시 체크포인트에 서브디렉터리(packages/shared 등)가 프로젝트로 저장된 경우 → 루트로 승격
    const rootCwd = resolveProjectRoot(cp.project.path);
    const key = normalize(rootCwd);
    if (rootCwd !== cp.project.path) {
      cp = { ...cp, project: { ...cp.project, path: rootCwd, name: path.basename(rootCwd) } };
      logger.info(`Checkpoint promoted: "${cp.project.name}" (was subdir)`);
    }
    let inst = this.instances.get(key);
    if (!inst) {
      inst = this.createInstance(rootCwd);
      this.instances.set(key, inst);
      logger.info(`ProjectGraphManager: restoring instance for "${cp.project.name}"`);
    }
    inst.restoreFromCheckpoint(cp);
    // task edges 는 Instance 소유 — Manager 측 중복 저장 금지(삭제 시 유령 잔재 원인)
  }

  /** 체크포인트 병합 — 두 번째 이후 프로젝트 */
  mergeFromCheckpoint(cp: ProjectCheckpoint): void {
    const rootCwd = resolveProjectRoot(cp.project.path);
    const key = normalize(rootCwd);
    if (rootCwd !== cp.project.path) {
      cp = { ...cp, project: { ...cp.project, path: rootCwd, name: path.basename(rootCwd) } };
    }
    let inst = this.instances.get(key);
    if (!inst) {
      inst = this.createInstance(rootCwd);
      this.instances.set(key, inst);
      logger.info(`ProjectGraphManager: merging instance for "${cp.project.name}"`);
    }
    inst.mergeFromCheckpoint(cp);
    // task edges 는 Instance 소유 — Manager 측 중복 저장 금지(삭제 시 유령 잔재 원인)
  }

  // ─── 하우스키핑 ───

  checkFileExistence(): number {
    let total = 0;
    for (const inst of this.instances.values()) total += inst.checkFileExistence();
    return total;
  }

  pruneDisappearing(): number {
    let total = 0;
    for (const inst of this.instances.values()) total += inst.pruneDisappearing();
    return total;
  }

  getRunningServers(): ServerEntry[] {
    const result: ServerEntry[] = [];
    for (const inst of this.instances.values()) result.push(...inst.getRunningServers());
    return result;
  }

  /** §7.11 — ServerEntry id 의 owning session 을 전 인스턴스에서 찾는다. */
  findServerOwnerSession(serverId: string): { sessionId: string; cwd: string | undefined } | null {
    for (const inst of this.instances.values()) {
      const found = inst.findServerOwnerSession(serverId);
      if (found) return found;
    }
    return null;
  }

  /** §7.11 포트 인계 — 신고 전용 entry 의 기동 명령을 OS 에서 읽어 승격한다. 성공한 첫 인스턴스에서 멈춘다(serverId 는 한 곳에만 있다). */
  async takeoverServerEntry(serverId: string): Promise<boolean> {
    for (const inst of this.instances.values()) {
      if (await inst.takeoverServerEntry(serverId)) return true;
    }
    return false;
  }

  /** §7.11 / §3.5 — Stop/Restart 가 죽여도 되는 범위(주소 호스트·남의 프로젝트 여부). 아무도 없으면 null(호출부는 포트 전체). */
  async serverControlScope(serverId: string): Promise<{ host?: string; foreign: boolean } | null> {
    for (const inst of this.instances.values()) {
      const scope = await inst.serverControlScope(serverId);
      if (scope) return scope;
    }
    return null;
  }

  /**
   * §7.11 / §3.5 — 열어 둔 프리뷰 탭이 그 주소를 보여도 되나 — 그 탭을 연 프로젝트(경로 → 이름 순, 모르면 위성 주인)의 인스턴스가 답한다.
   * 아무도 없으면 `show`(판정 불가로 막지 않는다).
   */
  async checkIframeTab(projectRef: string | null, satelliteId: string | null, url: string): Promise<IframeTabVerdict> {
    let inst: ProjectGraph | null = null;
    if (projectRef) {
      inst = this.getInstanceByPath(projectRef)
        ?? [...this.instances.values()].find((i) => i.ownsProjectPath(projectRef))
        ?? this.getInstanceByName(projectRef);
    }
    if (!inst && satelliteId) {
      inst = [...this.instances.values()].find((i) => i.hasSatelliteId(satelliteId)) ?? null;
    }
    if (!inst) return { action: 'show' };
    return inst.checkIframeTab(satelliteId, url);
  }

  /** §7.11 — respawn 직후 owning-shell 분리(전 인스턴스에 idempotent). */
  noteIframeRespawnedByServerId(serverId: string): boolean {
    let changed = false;
    for (const inst of this.instances.values()) {
      if (inst.noteIframeRespawnedByServerId(serverId)) changed = true;
    }
    return changed;
  }

  /** /api/stop-server 때 iframe 위성 iframeAlive=false 를 즉시 플립(§7.11). */
  markIframeStoppedByServerId(serverId: string): boolean {
    let changed = false;
    for (const inst of this.instances.values()) {
      if (inst.markIframeStoppedByServerId(serverId)) changed = true;
    }
    return changed;
  }

  hasPendingTitles(): boolean {
    for (const inst of this.instances.values()) {
      if (inst.hasPendingTitles()) return true;
    }
    return false;
  }

  /** §5.3 #12-1 — 권한 승인 대기 진입·해제(전 인스턴스에 idempotent). */
  setPermissionWaiting(agentId: string, waiting: boolean): void {
    for (const inst of this.instances.values()) {
      inst.setPermissionWaiting(agentId, waiting);
    }
  }

  resolvePendingTitles(): number {
    let total = 0;
    for (const inst of this.instances.values()) total += inst.resolvePendingTitles();
    return total;
  }

  // ─── Task Edge (Manager 레벨) ───
  // TODO: ProjectGraph 내 task edges를 여기로 완전 이동

  /** Task Edge 전체 스냅샷 */
  getTaskEdgesSnapshot(): Record<string, TaskEdge> {
    // Manager 레벨 edges + 인스턴스 edges 병합
    const result: Record<string, TaskEdge> = {};
    for (const inst of this.instances.values()) {
      Object.assign(result, inst.getTaskEdgesSnapshot());
    }
    Object.assign(result, Object.fromEntries(this.taskEdges));
    return result;
  }

  /** agentId → project basename (소속 확인용, 못 찾으면 null) */
  getAgentProjectName(agentId: string): string | null {
    for (const inst of this.instances.values()) {
      const name = inst.getAgentProjectName(agentId);
      if (name) return name;
    }
    return null;
  }

  /** Task Edge 생성 — 소스/타겟이 다른 프로젝트면 거부(§3.5 프로젝트 독립성 · §5.7 #26 worktree 독립 세션). */
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
    // 크로스-프로젝트 엣지 차단(알 수 있는 경우만). 한쪽 프로젝트가 미상인 경우는 통과 — 기존 검증 없던 동작과 호환.
    const srcProj = this.getAgentProjectName(sourceAgentId);
    const dstProj = this.getAgentProjectName(targetAgentId);
    if (srcProj && dstProj && srcProj !== dstProj) {
      throw new Error(`Task Edge cross-project denied: source=${srcProj}, target=${dstProj}`);
    }
    // 엣지를 "소스 에이전트가 속한 인스턴스" 에 저장 — 그래야 해당 프로젝트의 scoped checkpoint
    // 필터(projectBubbleIds)가 엣지를 포함한다. 무조건 primaryInstance 로 보내면 worktree 가 primary 일
    // 때 Vibisual 엣지들이 어느 프로젝트 checkpoint 에도 안 담겨 재시작 시 전부 유실된다.
    const inst =
      (srcProj ? this.getInstanceByName(srcProj) : null) ??
      (dstProj ? this.getInstanceByName(dstProj) : null) ??
      this.primaryInstance();
    if (inst) {
      const edge = inst.createTaskEdge(sourceAgentId, targetAgentId, command, forwardMode, templateId, options);
      // 자동 자매 엣지 자기 자신은 추가 동기화 트리거 ❌ (무한 재귀 방지)
      if (edge.bundleRole !== 'auto-artifact' && edge.bundleRole !== 'auto-rework') {
        // returnFormat='both' + kind='command' 이면 artifact 자매 엣지.
        inst.syncBundleForReturnFormat(edge.id);
        // kind='critique' + critiqueAuthority='force-rework' 이면 auto-rework 자매 엣지.
        inst.syncReworkBundleForCritique(edge.id);
      }
      return edge;
    }
    // Manager 레벨 폴백
    const id = `tedge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const edge: TaskEdge = {
      id,
      sourceAgentId,
      targetAgentId,
      command,
      status: 'idle',
      forwardMode,
      templateId,
      createdAt: Date.now(),
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
    for (const inst of this.instances.values()) {
      const result = inst.updateTaskEdge(id, updates);
      if (result) {
        const isPrimary = (result.bundleRole ?? 'primary') === 'primary';
        // returnFormat·kind 가 바뀌면 artifact 번들 동기화(primary 엣지에서만).
        if (isPrimary && (updates.returnFormat !== undefined || updates.kind !== undefined)) {
          inst.syncBundleForReturnFormat(result.id);
        }
        // kind·critiqueAuthority 가 바뀌면 auto-rework 번들 동기화(primary 엣지에서만).
        if (isPrimary && (updates.kind !== undefined || updates.critiqueAuthority !== undefined)) {
          inst.syncReworkBundleForCritique(result.id);
        }
        return result;
      }
    }
    // Manager 레벨
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

  /** 번들에 속한 엣지면 자매도 함께 지운다. */
  deleteTaskEdge(id: string): boolean {
    for (const inst of this.instances.values()) {
      if (inst.deleteTaskEdgeCascade(id)) return true;
    }
    return this.taskEdges.delete(id);
  }

  getTaskEdge(id: string): TaskEdge | undefined {
    for (const inst of this.instances.values()) {
      const edge = inst.getTaskEdge(id);
      if (edge) return edge;
    }
    return this.taskEdges.get(id);
  }

  getBundleArtifact(primaryEdgeId: string): TaskEdge | undefined {
    for (const inst of this.instances.values()) {
      const a = inst.getBundleArtifact(primaryEdgeId);
      if (a) return a;
    }
    return undefined;
  }

  getBundleAutoRework(primaryEdgeId: string): TaskEdge | undefined {
    for (const inst of this.instances.values()) {
      const a = inst.getBundleAutoRework(primaryEdgeId);
      if (a) return a;
    }
    return undefined;
  }

  /** 소스 에이전트 outbound 엣지(시스템 프롬프트 주입용). */
  getOutboundTaskEdges(sourceAgentId: string): TaskEdge[] {
    const out: TaskEdge[] = [];
    for (const inst of this.instances.values()) out.push(...inst.getOutboundTaskEdges(sourceAgentId));
    return out;
  }

  /** Task Edge 상태 변경 */
  setTaskEdgeStatus(id: string, status: TaskEdgeStatus, result?: string, errorMessage?: string): void {
    for (const inst of this.instances.values()) {
      const snap = inst.getTaskEdgesSnapshot();
      if (snap[id]) {
        inst.setTaskEdgeStatus(id, status, result, errorMessage);
        return;
      }
    }
    // Manager 레벨
    const edge = this.taskEdges.get(id);
    if (!edge) return;
    edge.status = status;
    if (status === 'executing') edge.lastExecutedAt = Date.now();
    if (result !== undefined) edge.lastResult = result;
    if (errorMessage !== undefined) edge.errorMessage = errorMessage;
  }

  /** auto-forward TaskEdge 조회 (Stop 훅 후 자동 실행용) */
  getAutoForwardEdges(sourceAgentId: string): TaskEdge[] {
    const result: TaskEdge[] = [];
    for (const inst of this.instances.values()) {
      result.push(...inst.getAutoForwardEdges(sourceAgentId));
    }
    for (const edge of this.taskEdges.values()) {
      if (edge.sourceAgentId === sourceAgentId && edge.forwardMode === 'auto') {
        result.push(edge);
      }
    }
    return result;
  }

  /** `targetAgentId === agentId` 인 critique primary 엣지(타겟 완료 시 watcher 발사용). */
  getIncomingCritiqueEdges(targetAgentId: string): TaskEdge[] {
    const result: TaskEdge[] = [];
    for (const inst of this.instances.values()) {
      result.push(...inst.getIncomingCritiqueEdges(targetAgentId));
    }
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

  bumpCritiqueReworkCount(edgeId: string, mode: 'reset' | 'increment'): number {
    for (const inst of this.instances.values()) {
      if (inst.getTaskEdge(edgeId)) return inst.bumpCritiqueReworkCount(edgeId, mode);
    }
    const edge = this.taskEdges.get(edgeId);
    if (!edge) return 0;
    if (mode === 'reset') edge.reworkCount = 0;
    else edge.reworkCount = (edge.reworkCount ?? 0) + 1;
    return edge.reworkCount;
  }

  /** critique 강등(force-rework → comment-only) + 자매 auto-rework 엣지 제거. */
  downgradeCritiqueAuthority(edgeId: string): TaskEdge | undefined {
    for (const inst of this.instances.values()) {
      if (inst.getTaskEdge(edgeId)) {
        const e = inst.downgradeCritiqueAuthority(edgeId);
        if (e) inst.syncReworkBundleForCritique(edgeId);
        return e;
      }
    }
    return undefined;
  }

  // Comment Box — 프로젝트별 인스턴스에 저장

  /** 지정 projectName 소속 인스턴스에 Comment Box 생성. 인스턴스 없으면 primary 폴백. */
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
  }): CommentBox | null {
    const inst = this.getInstanceByName(input.projectName) ?? this.primaryInstance();
    if (!inst) return null;
    return inst.createCommentBox(input);
  }

  /** Comment Box 업데이트 — 모든 인스턴스 순회해 매칭되는 id 찾음. */
  updateCommentBox(
    id: string,
    updates: Partial<Omit<CommentBox, 'id' | 'projectName' | 'createdAt' | 'updatedAt'>>,
  ): CommentBox | null {
    for (const inst of this.instances.values()) {
      if (inst.getCommentBox(id)) {
        return inst.updateCommentBox(id, updates);
      }
    }
    return null;
  }

  /** Comment Box 삭제 */
  deleteCommentBox(id: string): boolean {
    for (const inst of this.instances.values()) {
      if (inst.getCommentBox(id)) {
        return inst.deleteCommentBox(id);
      }
    }
    return false;
  }

  /** Comment Box 단일 조회 */
  getCommentBox(id: string): CommentBox | undefined {
    for (const inst of this.instances.values()) {
      const b = inst.getCommentBox(id);
      if (b) return b;
    }
    return undefined;
  }

  /** 전체 Comment Box 배열 (모든 인스턴스 합) */
  getAllCommentBoxes(): CommentBox[] {
    const out: CommentBox[] = [];
    for (const inst of this.instances.values()) out.push(...inst.getCommentBoxes());
    return out;
  }

  // §5.5 #17-20 ⑩ 공통 디버그 층 — 중단점

  /** 그 프로젝트에 찍힌 중단점(인스턴스가 없으면 빈 배열). */
  getDebugBreakpoints(projectName: string): DebugBreakpoint[] {
    return this.getInstanceByName(projectName)?.getDebugBreakpoints(projectName) ?? [];
  }

  /** 중단점 전량 교체. 프로젝트 인스턴스가 없으면 null(저장할 자리가 없다). */
  setDebugBreakpoints(projectName: string, breakpoints: DebugBreakpoint[]): DebugBreakpoint[] | null {
    const inst = this.getInstanceByName(projectName);
    if (!inst) return null;
    return inst.setDebugBreakpoints(projectName, breakpoints);
  }

  // ─── §5.11 정독 게이트 — 프로젝트별 설정 (키는 **경로**다) ────────────────

  /** 그 프로젝트에 저장된 정독 설정. 아직 아무것도 안 정했으면 undefined
   *  (그때는 팀 파일 `.vibisual/spec.json` 이 이겨야 하므로 기본값으로 채우지 않는다). */
  getSpecReadingSettings(projectPath: string): SpecReadingSettings | undefined {
    return this.getInstanceByPath(projectPath)?.getSpecReadingSettings(projectPath);
  }

  /** 정독 설정 전량 교체. 프로젝트 인스턴스가 없으면 null(저장할 자리가 없다). */
  setSpecReadingSettings(projectPath: string, settings: SpecReadingSettings): SpecReadingSettings | null {
    const inst = this.getInstanceByPath(projectPath);
    if (!inst) return null;
    return inst.setSpecReadingSettings(projectPath, settings);
  }

  // ─── §5.10 자동 목표 — 프로젝트별 설정 (정독과 같은 규약: 키는 **경로**다) ───

  /**
   * 지목한 경로가 열린 프로젝트면 정본 루트, 아니면 `null`. 자동 목표 REST 는 경로를 문자열로 받으므로 이 빗장이 없으면 남의 폴더 `.vibisual/skills/` 를 읽어 간다(OWASP LLM08).
   * 쓰기(`scope`·`dismiss`)는 `setAutoGoalSettings` 가 이미 404 — 여기선 읽기·삭제 셋을 막는다.
   */
  resolveAutoGoalRoot(projectPath: string): string | null {
    const loaded: string[] = [];
    for (const inst of this.instances.values()) {
      const root = inst.getRoot();
      if (root) loaded.push(root);
    }
    return resolveAutoGoalProjectRoot(projectPath, loaded, process.platform);
  }

  /** 그 프로젝트에 저장된 자동 목표 설정. 아직 아무것도 안 정했으면 undefined(= 꺼짐). */
  getAutoGoalSettings(projectPath: string): AutoGoalSettings | undefined {
    return this.getInstanceByPath(projectPath)?.getAutoGoalSettings(projectPath);
  }

  /** 자동 목표 설정 전량 교체. 프로젝트 인스턴스가 없으면 null(저장할 자리가 없다). */
  setAutoGoalSettings(projectPath: string, settings: AutoGoalSettings): AutoGoalSettings | null {
    const inst = this.getInstanceByPath(projectPath);
    if (!inst) return null;
    return inst.setAutoGoalSettings(projectPath, settings);
  }

  // ─── §5.3 #10-4 오케스트라(지휘 모드) — 프로젝트별 설정·런 (키는 **경로**다) ───

  /** 그 프로젝트에 저장된 오케스트라 설정. 아직 아무것도 안 정했으면 undefined(= 꺼짐). */
  getOrchestraSettings(projectPath: string): OrchestraSettings | undefined {
    return this.getInstanceByPath(projectPath)?.getOrchestraSettings(projectPath);
  }

  /** 오케스트라 설정 전량 교체. 프로젝트 인스턴스가 없으면 null(저장할 자리가 없다 → REST 404). */
  setOrchestraSettings(projectPath: string, settings: OrchestraSettings): OrchestraSettings | null {
    const inst = this.getInstanceByPath(projectPath);
    if (!inst) return null;
    return inst.setOrchestraSettings(projectPath, settings);
  }

  /** 오케스트라 설정·런의 키 — 표시명이 아니라 그 에이전트를 가진 인스턴스로 정한다(이름 충돌·활성 프로젝트 오염 무관). 못 찾으면 null. */
  getOrchestraRootForAgent(agentId: string): string | null {
    return this.findInstanceByAgentId(agentId)?.getRoot() ?? null;
  }

  /** 그 프로젝트의 런 전량(오래된 것부터). 인스턴스가 없으면 빈 배열. */
  getOrchestraRuns(projectPath: string): OrchestraRun[] {
    return this.getInstanceByPath(projectPath)?.getOrchestraRuns(projectPath) ?? [];
  }

  /** 런 하나를 더한다. 런의 `projectPath` 인스턴스가 없으면 false. */
  addOrchestraRun(run: OrchestraRun): boolean {
    const inst = this.getInstanceByPath(run.projectPath);
    if (!inst) return false;
    inst.addOrchestraRun(run);
    return true;
  }

  /** runId 로 찾는다 — 어느 인스턴스가 가졌든. */
  findOrchestraRun(runId: string): OrchestraRun | undefined {
    for (const inst of this.instances.values()) {
      const found = inst.findOrchestraRun(runId);
      if (found) return found;
    }
    return undefined;
  }

  /** runId 의 런을 갈아 끼운다 — 어느 인스턴스가 가졌든. 못 찾으면 undefined. */
  updateOrchestraRun(runId: string, mutate: (run: OrchestraRun) => OrchestraRun): OrchestraRun | undefined {
    for (const inst of this.instances.values()) {
      const done = inst.updateOrchestraRun(runId, mutate);
      if (done) return done;
    }
    return undefined;
  }

  // ─── §5.3 #10-5 설정 덜어내기 — 프로젝트별 설정·기록 (키는 **경로**다) ───

  /** 그 프로젝트에 저장된 설정 덜어내기 설정. 아직 아무것도 안 정했으면 undefined(= 꺼짐). */
  getConfigTrimSettings(projectPath: string): ConfigTrimSettings | undefined {
    return this.getInstanceByPath(projectPath)?.getConfigTrimSettings(projectPath);
  }

  /** 설정 덜어내기 설정 전량 교체. 프로젝트 인스턴스가 없으면 null(저장할 자리가 없다 → REST 404). */
  setConfigTrimSettings(projectPath: string, settings: ConfigTrimSettings): ConfigTrimSettings | null {
    const inst = this.getInstanceByPath(projectPath);
    if (!inst) return null;
    return inst.setConfigTrimSettings(projectPath, settings);
  }

  /** 설정 덜어내기 설정·기록의 키 — 위와 같이 그 에이전트를 가진 인스턴스로 정한다. 못 찾으면 null. */
  getConfigTrimRootForAgent(agentId: string): string | null {
    return this.findInstanceByAgentId(agentId)?.getRoot() ?? null;
  }

  /** 그 프로젝트의 덜어내기 기록 전량(오래된 것부터). 인스턴스가 없으면 빈 배열. */
  getConfigTrimRuns(projectPath: string): ConfigTrimRun[] {
    return this.getInstanceByPath(projectPath)?.getConfigTrimRuns(projectPath) ?? [];
  }

  /** 기록 하나를 더한다. 그 경로의 인스턴스가 없으면 false. */
  addConfigTrimRun(projectPath: string, run: ConfigTrimRun): boolean {
    const inst = this.getInstanceByPath(projectPath);
    if (!inst) return false;
    inst.addConfigTrimRun(projectPath, run);
    return true;
  }

  /** 되풀이 분석 재료는 그 프로젝트 것만 — 합친 스냅샷이면 옆 프로젝트 명령이 "되풀이"로 세어져 엉뚱한 스킬이 생긴다(§3.5). 인스턴스가 없으면 빈 재료. */
  getAutoGoalMaterial(projectPath: string): {
    bashHistory: Record<string, import('@vibisual/shared').BashEntry[]>;
    sessionGoals: Record<string, import('@vibisual/shared').SessionGoal>;
  } {
    return this.getInstanceByPath(projectPath)?.getAutoGoalMaterial() ?? { bashHistory: {}, sessionGoals: {} };
  }

  /** §5.11 정독 게이트 — 세션별 정독 상태. `pluginFacts` 와 같은 provider 방식(방송 지점마다 얹으면 어딘가 빠진다). */
  private specReadingProvider: (() => Record<string, SpecReadingState> | undefined) | null = null;

  setSpecReadingProvider(fn: () => Record<string, SpecReadingState> | undefined): void {
    this.specReadingProvider = fn;
  }

  // ─── §5.9 화면/프로그램 캡처 버블 — 프로젝트별 인스턴스에 저장 ───

  /** 지정 projectName 소속 인스턴스에 캡처 버블 생성. 인스턴스 없으면 primary 폴백. */
  // §5.13 내부 앱 버블 위임

  createAppBubble(input: {
    /** §5.4 #36 (F) — 클라가 지은 id(낙관 생성). 형식이 맞고 **어느 프로젝트에도 없을 때만** 쓴다. */
    id?: unknown;
    projectName: string;
    appId: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    title?: string;
    ref?: string;
    /** §5.4 #36 (B) — 만들며 바로 잇는 에이전트들. 인스턴스가 다듬는다. */
    linkedAgentIds?: unknown;
  }): AppBubble | null {
    const inst = this.getInstanceByName(input.projectName) ?? this.primaryInstance();
    if (!inst) return null;
    const { id: proposed, ...rest } = input;
    // 다른 프로젝트에 같은 id 가 있으면 받지 않는다 — PATCH·DELETE 가 인스턴스를 훑어 id 로 찾으므로 둘이 섞인다.
    const id = isAppBubbleId(proposed) && !this.getAppBubble(proposed) ? proposed : undefined;
    return inst.createAppBubble(id === undefined ? rest : { ...rest, id });
  }

  /**
   * §5.4 #36 (C) — 결과 전달: 프로젝트 안의 존재하는 파일만 받는다(루트 밖·루트 자신·없음·폴더는 거절).
   * 안팎은 `pathKey` 규칙(`projectRelativePath`)으로 보고, 저장 경로는 입력 대소문자 그대로.
   */
  setAppBubbleOutput(
    id: string,
    file: string,
  ): { ok: true; bubble: AppBubble } | { ok: false; error: 'not-found' | 'no-project' | 'outside-project' | 'missing-file' } {
    for (const inst of this.instances.values()) {
      const bubble = inst.getAppBubble(id);
      if (!bubble) continue;
      const root = inst.getProjectByName(bubble.projectName)?.path;
      if (!root) return { ok: false, error: 'no-project' };
      const abs = path.isAbsolute(file) ? path.resolve(file) : path.resolve(root, file);
      const rel = projectRelativePath(root, abs, HOST_PLATFORM);
      if (!rel) return { ok: false, error: 'outside-project' };
      let modifiedAt: number;
      try {
        const st = fs.statSync(abs);
        if (!st.isFile()) return { ok: false, error: 'missing-file' };
        modifiedAt = Math.round(st.mtimeMs);
      } catch {
        return { ok: false, error: 'missing-file' };
      }
      // §5.4 #36 (F) — 결과 버전은 파일의 수정 시각이다. 같은 이름으로 다시 만들어 다시 보내면 값이 바뀌어
      //   노드 화면의 미리보기가 다시 구워진다(이름만 보면 같은 결과로 읽혀 옛 그림이 남는다).
      const updated = inst.setAppBubbleFile(id, rel, modifiedAt);
      return updated ? { ok: true, bubble: updated } : { ok: false, error: 'not-found' };
    }
    return { ok: false, error: 'not-found' };
  }

  /** §5.13 (L) — 노드에 앱 작업 문서 열쇠(`ref`)를 묶는다. 뜻은 몰라도 경로·스크립트가 섞이지 않은 모양만 받는다. 못 찾거나 틀리면 false. */
  setAppBubbleRef(id: string, ref: string): boolean {
    if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(ref)) return false;
    return this.updateAppBubble(id, { ref }) !== null;
  }

  /** §5.4 #36 (A) — 커스텀 에이전트의 캔버스 형태. 그 에이전트를 가진 인스턴스를 찾아 맡긴다. */
  setAgentForm(nodeId: string, form: 'card' | 'bubble'): { ok: true; form: 'card' | 'bubble' } | { ok: false; reason: 'not-found' | 'not-eligible' } {
    let notEligible = false;
    for (const inst of this.instances.values()) {
      const result = inst.setAgentForm(nodeId, form);
      if (result.ok) return result;
      if (result.reason === 'not-eligible') notEligible = true;
    }
    return { ok: false, reason: notEligible ? 'not-eligible' : 'not-found' };
  }

  /** §5.4 #36 (H) — 에이전트의 연결 보기(주변 버블·선 켜고 끄기 · 보기 전환). 그 에이전트를 가진 인스턴스를 찾아 맡긴다. */
  setAgentLinkView(
    nodeId: string,
    patch: { hidden?: boolean; bubblesHidden?: boolean; lens?: 'linked' | 'files' },
  ): { ok: true; linksHidden: boolean; linkLens: 'linked' | 'files' } | { ok: false; reason: 'not-found' | 'not-eligible' } {
    let notEligible = false;
    for (const inst of this.instances.values()) {
      const result = inst.setAgentLinkView(nodeId, patch);
      if (result.ok) return result;
      if (result.reason === 'not-eligible') notEligible = true;
    }
    return { ok: false, reason: notEligible ? 'not-eligible' : 'not-found' };
  }

  /** §5.4 #36 (H) ①-2 — 연결된 버블 고정/풀기. 풀 때 실행 중이 아니면 그 자리에서 걷는다(`purged` = 걷은 id). */
  setAgentLinksPinned(
    nodeId: string,
    pinned: boolean,
  ): { ok: true; linksPinned: boolean; purged: string[] } | { ok: false; reason: 'not-found' | 'not-eligible' } {
    let notEligible = false;
    for (const inst of this.instances.values()) {
      const result = inst.setAgentLinksPinned(nodeId, pinned);
      if (result.ok) return result;
      if (result.reason === 'not-eligible') notEligible = true;
    }
    return { ok: false, reason: notEligible ? 'not-eligible' : 'not-found' };
  }

  /** §5.4 #36 (H) ①-2 — [이전 연결 다시 보기]. 그 에이전트를 가진 인스턴스가 기억한 연결을 다시 세운다. */
  replayAgentLinks(
    nodeId: string,
  ): { ok: true; restored: number } | { ok: false; reason: 'not-found' | 'not-eligible' | 'running' | 'empty' } {
    for (const inst of this.instances.values()) {
      const result = inst.replayAgentLinks(nodeId);
      // 에이전트를 찾은 인스턴스의 답이 정답이다(실행 중·기록 없음도 그 인스턴스만 안다).
      if (result.ok || result.reason !== 'not-found') return result;
    }
    return { ok: false, reason: 'not-found' };
  }

  /** §5.1 #2-1 (B) — 묶음의 이번 턴 장부. 한 에이전트가 여러 프로젝트를 만지면 장부가 인스턴스마다 생겨 전 인스턴스에서 같이 열고 닫는다. 하나라도 비웠으면 true. */
  beginAgentTurn(agentId: string, busy: boolean): boolean {
    let changed = false;
    for (const inst of this.instances.values()) if (inst.beginAgentTurn(agentId, busy)) changed = true;
    return changed;
  }

  beginAgentPromptTurn(agentId: string, ownerSubId?: string): boolean {
    let changed = false;
    for (const inst of this.instances.values()) if (inst.beginAgentPromptTurn(agentId, ownerSubId)) changed = true;
    return changed;
  }

  endAgentPromptTurn(agentId: string): void {
    for (const inst of this.instances.values()) inst.endAgentPromptTurn(agentId);
  }

  acknowledgeAgentTurn(agentId: string): boolean {
    let changed = false;
    for (const inst of this.instances.values()) if (inst.acknowledgeAgentTurn(agentId)) changed = true;
    return changed;
  }

  /** 모든 인스턴스를 훑어 id 로 찾는다(어느 프로젝트 것인지 호출부가 모를 수 있다). */
  updateAppBubble(
    id: string,
    updates: Partial<Omit<AppBubble, 'id' | 'projectName' | 'appId' | 'createdAt'>>,
  ): AppBubble | null {
    for (const inst of this.instances.values()) {
      const updated = inst.updateAppBubble(id, updates);
      if (updated) return updated;
    }
    return null;
  }

  deleteAppBubble(id: string): boolean {
    for (const inst of this.instances.values()) {
      if (inst.getAppBubble(id) && inst.deleteAppBubble(id)) return true;
    }
    return false;
  }

  getAppBubble(id: string): AppBubble | undefined {
    for (const inst of this.instances.values()) {
      const found = inst.getAppBubble(id);
      if (found) return found;
    }
    return undefined;
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
  }): CaptureBubble | null {
    const inst = this.getInstanceByName(input.projectName) ?? this.primaryInstance();
    if (!inst) return null;
    return inst.createCaptureBubble(input);
  }

  /** 캡처 버블 업데이트 — 모든 인스턴스 순회해 매칭되는 id 찾음. */
  updateCaptureBubble(
    id: string,
    updates: Partial<Omit<CaptureBubble, 'id' | 'projectName' | 'createdAt' | 'updatedAt'>>,
  ): CaptureBubble | null {
    for (const inst of this.instances.values()) {
      if (inst.getCaptureBubble(id)) {
        return inst.updateCaptureBubble(id, updates);
      }
    }
    return null;
  }

  /** 캡처 버블 삭제 */
  deleteCaptureBubble(id: string): boolean {
    for (const inst of this.instances.values()) {
      if (inst.getCaptureBubble(id)) {
        return inst.deleteCaptureBubble(id);
      }
    }
    return false;
  }

  /** 캡처 버블 단일 조회 */
  getCaptureBubble(id: string): CaptureBubble | undefined {
    for (const inst of this.instances.values()) {
      const b = inst.getCaptureBubble(id);
      if (b) return b;
    }
    return undefined;
  }

  /** 전체 캡처 버블 배열 (모든 인스턴스 합) */
  getAllCaptureBubbles(): CaptureBubble[] {
    const out: CaptureBubble[] = [];
    for (const inst of this.instances.values()) out.push(...inst.getCaptureBubbles());
    return out;
  }

  // §5.14 — 플레이 버블 위임

  createPlayBubble(input: {
    projectName: string;
    x: number;
    y: number;
    width: number;
    height: number;
    title?: string;
    recipe?: PlayRecipe;
  }): PlayBubble | null {
    const inst = this.getInstanceByName(input.projectName) ?? this.primaryInstance();
    if (!inst) return null;
    return inst.createPlayBubble(input);
  }

  updatePlayBubble(
    id: string,
    updates: Partial<Omit<PlayBubble, 'id' | 'projectName' | 'createdAt' | 'updatedAt'>>,
  ): PlayBubble | null {
    for (const inst of this.instances.values()) {
      if (inst.getPlayBubble(id)) return inst.updatePlayBubble(id, updates);
    }
    return null;
  }

  deletePlayBubble(id: string): boolean {
    for (const inst of this.instances.values()) {
      if (inst.getPlayBubble(id)) return inst.deletePlayBubble(id);
    }
    return false;
  }

  getPlayBubble(id: string): PlayBubble | undefined {
    for (const inst of this.instances.values()) {
      const b = inst.getPlayBubble(id);
      if (b) return b;
    }
    return undefined;
  }

  getAllPlayBubbles(): PlayBubble[] {
    const out: PlayBubble[] = [];
    for (const inst of this.instances.values()) out.push(...inst.getPlayBubbles());
    return out;
  }

  // ─── §5.15 — 스펙 보드 위임 ───

  createSpecDoc(input: {
    projectName: string;
    x: number;
    y: number;
    width: number;
    height: number;
    title?: string;
    body?: string;
    items?: string[];
  }): SpecDoc | null {
    const inst = this.getInstanceByName(input.projectName) ?? this.primaryInstance();
    if (!inst) return null;
    return inst.createSpecDoc(input);
  }

  updateSpecDoc(
    id: string,
    updates: Partial<Omit<SpecDoc, 'id' | 'projectName' | 'createdAt' | 'updatedAt' | 'bodyRevision'>>,
  ): SpecDoc | null {
    for (const inst of this.instances.values()) {
      if (inst.getSpecDoc(id)) return inst.updateSpecDoc(id, updates);
    }
    return null;
  }

  addSpecItem(id: string, text: string): SpecDoc | null {
    for (const inst of this.instances.values()) {
      if (inst.getSpecDoc(id)) return inst.addSpecItem(id, text);
    }
    return null;
  }

  attachSpecTask(specId: string, itemId: string, taskAgentId: string, taskSessionId: string): SpecItem | null {
    for (const inst of this.instances.values()) {
      if (inst.getSpecDoc(specId)) return inst.attachSpecTask(specId, itemId, taskAgentId, taskSessionId);
    }
    return null;
  }

  detachSpecTask(specId: string, itemId: string): boolean {
    for (const inst of this.instances.values()) {
      if (inst.getSpecDoc(specId)) return inst.detachSpecTask(specId, itemId);
    }
    return false;
  }

  deleteSpecDoc(id: string): boolean {
    for (const inst of this.instances.values()) {
      if (inst.getSpecDoc(id)) return inst.deleteSpecDoc(id);
    }
    return false;
  }

  getSpecDoc(id: string): SpecDoc | undefined {
    for (const inst of this.instances.values()) {
      const d = inst.getSpecDoc(id);
      if (d) return d;
    }
    return undefined;
  }

  getAllSpecDocs(): SpecDoc[] {
    const out: SpecDoc[] = [];
    for (const inst of this.instances.values()) out.push(...inst.getSpecDocs());
    return out;
  }

  // ─── §5.16 — 리뷰·승인 레인 위임 ───

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
  }): ReviewRequest | null {
    const inst = this.getInstanceByName(input.projectName) ?? this.primaryInstance();
    if (!inst) return null;
    return inst.createReviewRequest(input);
  }

  getReviewRequest(id: string): ReviewRequest | undefined {
    for (const inst of this.instances.values()) {
      const r = inst.getReviewRequest(id);
      if (r) return r;
    }
    return undefined;
  }

  getAllReviewRequests(): ReviewRequest[] {
    const out: ReviewRequest[] = [];
    for (const inst of this.instances.values()) out.push(...inst.getReviewRequests());
    return out;
  }

  // ─── §5.18 — 에이전트 랩 위임 ───

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
  }): LabRun | null {
    const inst = this.getInstanceByName(input.projectName) ?? this.primaryInstance();
    if (!inst) return null;
    return inst.createLabRun(input);
  }

  updateLabRun(
    id: string,
    updates: Partial<Pick<LabRun, 'x' | 'y' | 'width' | 'height' | 'title' | 'task' | 'baseAgentId' | 'preservePinned'>>,
  ): LabRun | null {
    for (const inst of this.instances.values()) {
      if (inst.getLabRun(id)) return inst.updateLabRun(id, updates);
    }
    return null;
  }

  setLabVariants(id: string, variants: { id?: string; label?: string; config?: LabVariantConfig }[]): LabRun | null {
    for (const inst of this.instances.values()) {
      if (inst.getLabRun(id)) return inst.setLabVariants(id, variants);
    }
    return null;
  }

  addLabVariant(id: string, label: string, config?: LabVariantConfig): LabRun | null {
    for (const inst of this.instances.values()) {
      if (inst.getLabRun(id)) return inst.addLabVariant(id, label, config);
    }
    return null;
  }

  removeLabVariant(id: string, variantId: string): LabRun | null {
    for (const inst of this.instances.values()) {
      if (inst.getLabRun(id)) return inst.removeLabVariant(id, variantId);
    }
    return null;
  }

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
    for (const inst of this.instances.values()) {
      if (inst.getLabRun(id)) return inst.attachLabVariantRun(id, variantId, info);
    }
    return null;
  }

  finishLabVariant(
    id: string,
    variantId: string,
    result: Omit<LabResult, 'startedAt'> & { startedAt?: number },
  ): LabRun | null {
    for (const inst of this.instances.values()) {
      if (inst.getLabRun(id)) return inst.finishLabVariant(id, variantId, result);
    }
    return null;
  }

  markLabPromoted(id: string, variantId: string): LabRun | null {
    for (const inst of this.instances.values()) {
      if (inst.getLabRun(id)) return inst.markLabPromoted(id, variantId);
    }
    return null;
  }

  deleteLabRun(id: string): boolean {
    for (const inst of this.instances.values()) {
      if (inst.getLabRun(id)) return inst.deleteLabRun(id);
    }
    return false;
  }

  getLabRun(id: string): LabRun | undefined {
    for (const inst of this.instances.values()) {
      const r = inst.getLabRun(id);
      if (r) return r;
    }
    return undefined;
  }

  getAllLabRuns(): LabRun[] {
    const out: LabRun[] = [];
    for (const inst of this.instances.values()) out.push(...inst.getLabRuns());
    return out;
  }

  /** 변형 카드는 워크트리 인스턴스, 랩 표지는 부모 인스턴스에 있어 전 인스턴스를 훑는다. */
  findLabVariantByAgent(agentId: string): { run: LabRun; variant: LabVariant } | undefined {
    for (const inst of this.instances.values()) {
      const hit = inst.findLabVariantByAgent(agentId);
      if (hit) return hit;
    }
    return undefined;
  }

  // ─── §5.22 — 권한·감사 경계 위임 ───

  /** 그 프로젝트 인스턴스를 못 찾으면 에이전트를 든 인스턴스로 되짚는다(워크트리 이름이 표시명과 어긋나는 자리). */
  recordAuditCall(input: AuditRecordInput): string | null {
    const inst = this.getInstanceByName(input.projectName)
      ?? (input.agentId ? this.instanceForAgent(input.agentId) : null)
      ?? this.primaryInstance();
    if (!inst) return null;
    return inst.recordAuditCall(input);
  }

  /** §5.22 `outside` 경계. 인스턴스를 못 찾아도 cwd 는 돌려준다 — 워크트리 인스턴스가 서기 전 첫 호출들이 판정에서 빠지지 않게. */
  getAuditRoots(projectName: string, cwd?: string | null): string[] {
    const inst = this.getInstanceByName(projectName) ?? this.primaryInstance();
    if (inst) return inst.getAuditRoots(projectName, cwd ?? null);
    return cwd && cwd.trim() ? [cwd.trim()] : [];
  }

  /** 승인 카드가 뜬 줄에 "물었다"는 표식(어느 인스턴스가 들고 있든 찾아 적는다). */
  markAuditEscalated(projectName: string, entryId: string): void {
    for (const inst of this.instances.values()) inst.markAuditEscalated(projectName, entryId);
  }

  /** 사람(또는 정책)의 답. 그 줄을 든 인스턴스가 하나라도 적으면 true. */
  recordAuditDecision(
    projectName: string,
    entryId: string,
    decision: 'allow' | 'deny',
    source: AuditDecisionSource,
    reason?: string,
  ): boolean {
    let done = false;
    for (const inst of this.instances.values()) {
      if (inst.recordAuditDecision(projectName, entryId, decision, source, reason)) done = true;
    }
    return done;
  }

  /** 그 프로젝트의 경계 스위치(인스턴스가 없으면 shared 기본값 = §5.22 기본 꺼짐). */
  getAuditBoundary(projectName: string): AuditBoundaryConfig {
    const inst = this.getInstanceByName(projectName) ?? this.primaryInstance();
    if (inst) return inst.getAuditBoundary(projectName);
    return { escalateRisky: DEFAULT_AUDIT_BOUNDARY.escalateRisky, kinds: { ...DEFAULT_AUDIT_BOUNDARY.kinds } };
  }

  /** 경계 스위치 갱신. */
  setAuditBoundary(projectName: string, patch: Partial<AuditBoundaryConfig>): AuditBoundaryConfig | null {
    const inst = this.getInstanceByName(projectName) ?? this.primaryInstance();
    if (!inst) return null;
    return inst.setAuditBoundary(projectName, patch);
  }

  /** §3.2.3 — 보존 설정이 바뀌면 전 인스턴스 원장에 새 상한을 건다. 하나라도 잘렸으면 true. */
  applyAuditRetention(): boolean {
    let changed = false;
    for (const inst of this.instances.values()) {
      if (inst.applyAuditRetention()) changed = true;
    }
    return changed;
  }

  /** 조회용 원장 한 장(REST). */
  getAuditLog(projectName: string): ProjectAuditLog | undefined {
    for (const inst of this.instances.values()) {
      const log = inst.getAuditLog(projectName);
      if (log) return log;
    }
    return undefined;
  }

  // ─── §5.3 #12-3 — 자물쇠 ───

  /** 열린 모든 프로젝트의 자물쇠(원래 이름 키) — 경로는 프로젝트를 가리지 않아 다른 탭의 자물쇠도 집행한다. stub 탭도 넣는다(`stubPathLocks`). */
  getAllPathLocks(): Record<string, PathLock[]> {
    const out: Record<string, PathLock[]> = {};
    for (const inst of this.instances.values()) Object.assign(out, inst.getPathLocksByProject());
    for (const [key, meta] of this.stubs) {
      const entry = this.stubPathLocksFor(key, meta);
      if (entry.locks.length > 0 && !(entry.name in out)) out[entry.name] = entry.locks.map((l) => ({ ...l }));
    }
    return out;
  }

  /** stub 탭의 자물쇠 — 내릴 때 넘겨받은 것이 있으면 그것, 없으면 `identity.json` 에서 한 번 읽어 기억한다. */
  private stubPathLocksFor(key: string, meta: ProjectMetaSnapshot): { name: string; locks: PathLock[] } {
    const cached = this.stubPathLocks.get(key);
    if (cached) return cached;
    let locks: PathLock[] = [];
    try {
      if (meta.checkpointPath) {
        const identity = loadIdentityFromDir(path.dirname(meta.checkpointPath));
        locks = normalizePathLocks(identity?.pathLocks, HOST_PLATFORM);
      }
    } catch (err) {
      // 못 읽으면 빈 목록 — 다음 hydrate 가 체크포인트에서 정본을 다시 세운다.
      logger.warn(`[pathLocks] stub identity read failed for "${meta.project.name}": ${err instanceof Error ? err.message : String(err)}`);
    }
    const entry = { name: meta.project.name, locks };
    this.stubPathLocks.set(key, entry);
    return entry;
  }

  /** 자물쇠를 다룰 인스턴스와 그 안의 원래 이름. 표시명·원래 이름·경로 무엇이든 받는다(클라는 표시명을 보낸다). */
  private resolvePathLockOwner(projectRef: string): { inst: ProjectGraph; rawName: string } | null {
    if (!projectRef) return null;
    for (const inst of this.instances.values()) {
      if (inst.getProjectByName(projectRef)) return { inst, rawName: projectRef };
    }
    const resolved = this.resolveProjectRef(projectRef);
    if (!resolved) return null;
    const inst = this.getInstanceByPath(resolved.path);
    return inst ? { inst, rawName: resolved.rawName } : null;
  }

  /** 탭이 내려가 있으면 먼저 올린다 — 정본은 인스턴스이고 저장도 그 길(체크포인트 + identity)로만. 못 찾으면 `null`. */
  updatePathLocks(
    projectRef: string,
    lock: readonly PathLockTarget[],
    unlock: readonly string[],
  ): { changed: boolean; rejected: number; locks: PathLock[]; projectName: string } | null {
    let owner = this.resolvePathLockOwner(projectRef);
    if (!owner) {
      const hydrated = this.hydrateProject(projectRef);
      if (!hydrated.ok) return null;
      owner = this.resolvePathLockOwner(projectRef);
      if (!owner) return null;
    }
    const result = owner.inst.updatePathLocks(owner.rawName, lock, unlock);
    return { ...result, projectName: owner.rawName };
  }

  /** agentId 를 든 인스턴스(감사 원장이 그 인스턴스 안에 있으므로 되짚기용). */
  private instanceForAgent(agentId: string): ProjectGraph | null {
    for (const inst of this.instances.values()) {
      if (inst.getAgentProjectName(agentId)) return inst;
    }
    return null;
  }

  // ─── §5.26 — 컨텍스트 보험 위임 ───

  /** §5.26 (B) — 팀원 이름 수집. 세션 소속 인스턴스에만 적는다(모르면 전부에게 흘린다). */
  noteTeammates(sessionId: string, names: readonly string[]): void {
    const inst = this.getInstanceForSession(sessionId);
    if (inst) { inst.noteTeammates(sessionId, names); return; }
    for (const i of this.instances.values()) i.noteTeammates(sessionId, names);
  }

  /** §5.26 (B) 1단계 — 압축 직전 마커, 처음 만든 인스턴스가 임자다. 소속을 모르면 전부에게 시도해도 된다 — 프로젝트를 못 짚는 인스턴스는 `null` 로 지나간다. */
  recordCompactMarker(input: Parameters<ProjectGraph['recordCompactMarker']>[0]): CompactMarker | null {
    const inst = this.getInstanceForSession(input.sessionId);
    if (inst) return inst.recordCompactMarker(input);
    for (const i of this.instances.values()) {
      const marker = i.recordCompactMarker(input);
      if (marker) return marker;
    }
    return null;
  }

  /** §5.26 (B) — 트랜스크립트 미러(응답 뒤 비동기). 마커를 든 인스턴스가 뜬다. */
  mirrorCompactMarker(marker: CompactMarker): void {
    const inst = this.getInstanceByName(marker.projectName);
    if (inst) { inst.mirrorCompactMarker(marker); return; }
    for (const i of this.instances.values()) i.mirrorCompactMarker(marker);
  }

  /** §5.26 (E) 3단계 — 복원 브리핑을 한 번만 꺼낸다(꺼내는 순간 못 박힌다). */
  takeCompactBriefing(sessionId: string, now: number = Date.now()): CompactMarker | undefined {
    const inst = this.getInstanceForSession(sessionId);
    if (inst) return inst.takeCompactBriefing(sessionId, now);
    for (const i of this.instances.values()) {
      const marker = i.takeCompactBriefing(sessionId, now);
      if (marker) return marker;
    }
    return undefined;
  }

  /** §5.26 (E) — 못 박지 않고 고르기만(프롬프트 조립은 부작용이 없어야 한다). */
  peekCompactBriefing(sessionId: string): CompactMarker | undefined {
    const inst = this.getInstanceForSession(sessionId);
    if (inst) return inst.peekCompactBriefing(sessionId);
    for (const i of this.instances.values()) {
      const marker = i.peekCompactBriefing(sessionId);
      if (marker) return marker;
    }
    return undefined;
  }

  /** §5.26 (E) — 실제로 보낸 뒤 못 박기. 이미 찍혀 있으면 false. */
  markCompactBriefed(projectName: string, markerId: string, now: number = Date.now()): boolean {
    const inst = this.getInstanceByName(projectName);
    if (inst) return inst.markCompactBriefed(projectName, markerId, now);
    for (const i of this.instances.values()) {
      if (i.markCompactBriefed(projectName, markerId, now)) return true;
    }
    return false;
  }

  /** §5.26 (D) — `PostCompact` 를 그 세션 마커에 새긴다. 첫 성공에서 멈춘다 — 세션 id 는 프로젝트 사이에서 유일하지 않아 계속 돌면 남의 마커까지 건드린다. */
  notePostCompact(sessionId: string, now?: number): boolean {
    for (const inst of this.instances.values()) {
      if (inst.notePostCompact(sessionId, now)) return true;
    }
    return false;
  }

  /** §5.26 (G) — 되살리기 확인 걸기. 그 세션을 가진 인스턴스에서 멈춘다. */
  armResumeCheck(sessionId: string, now?: number): boolean {
    for (const inst of this.instances.values()) {
      if (inst.armResumeCheck(sessionId, now)) return true;
    }
    return false;
  }

  /** §5.26 (G) — 되살아난 세션의 문맥 확인 스윕(전 인스턴스). */
  sweepResumeChecks(now: number = Date.now()): boolean {
    let changed = false;
    for (const inst of this.instances.values()) {
      if (inst.sweepResumeChecks(now)) changed = true;
    }
    return changed;
  }

  /** §5.26 (D) 2단계 — 압축 전후 대조 스윕. 한 인스턴스라도 적었으면 true. */
  sweepCompactOutcomes(now: number = Date.now()): boolean {
    let changed = false;
    for (const inst of this.instances.values()) {
      if (inst.sweepCompactOutcomes(now)) changed = true;
    }
    return changed;
  }

  /** §3.2.3 — 보험 보존 축 적용(전 인스턴스). */
  applyInsuranceRetention(now: number = Date.now()): boolean {
    let changed = false;
    for (const inst of this.instances.values()) {
      if (inst.applyInsuranceRetention(now)) changed = true;
    }
    return changed;
  }

  /** §7.23 — 그 프로젝트의 보험 원장 전문(REST). */
  getInsuranceLedger(projectName: string): ProjectInsuranceLedger | undefined {
    for (const inst of this.instances.values()) {
      const led = inst.getInsuranceLedger(projectName);
      if (led) return led;
    }
    return undefined;
  }

  /** §7.23 `[미리보기]` — 사본 한 건 + 그 내용. */
  readInsuranceBlob(projectName: string, id: string): { preimage: FilePreimage; text: string | null } | null {
    for (const inst of this.instances.values()) {
      const found = inst.readInsuranceBlob(projectName, id);
      if (found) return found;
    }
    return null;
  }

  /** §5.26 (C) — 사본으로 되돌리기(사용자가 눌렀을 때만). */
  restoreInsuranceFile(projectName: string, id: string): { ok: boolean; undoId?: string } {
    for (const inst of this.instances.values()) {
      const out = inst.restoreInsuranceFile(projectName, id);
      if (out.ok) return out;
    }
    return { ok: false };
  }

  /** §5.26 (F) 4단계 — 자동압축 미발동 감시(전 인스턴스 합집합). */
  getCompactWatch(now: number = Date.now()): CompactWatchState[] {
    const out: CompactWatchState[] = [];
    for (const inst of this.instances.values()) out.push(...inst.getCompactWatch(now));
    return out;
  }

  /**
   * §5.26 (F)(b) — `/compact` 보냄을 전 인스턴스에 적는다(세션→인스턴스 역조회가 없다, `restoreInsuranceFile` 과 같은 패턴).
   * 판정은 감시하는 인스턴스만 하고(`getCompactWatch`) 남는 키는 인스턴스별 상한이 막는다(§3.2.4 G축).
   */
  markCompactSent(sessionId: string, at: number = Date.now()): void {
    for (const inst of this.instances.values()) inst.markCompactSent(sessionId, at);
  }

  /** §5.26 (F) — 감시 재판정(5초 대조 루프). 등급이 바뀐 인스턴스가 있으면 true. */
  refreshCompactWatch(now: number = Date.now()): boolean {
    let changed = false;
    for (const inst of this.instances.values()) {
      if (inst.refreshCompactWatch(now)) changed = true;
    }
    return changed;
  }

  // ─── §5.20 — 스크립트 선반 위임 ───

  createShelfBubble(input: {
    projectName: string;
    x: number;
    y: number;
    width: number;
    height: number;
    title?: string;
    items?: ShelfImportDraftItem[];
  }): ShelfBubble | null {
    const inst = this.getInstanceByName(input.projectName) ?? this.primaryInstance();
    if (!inst) return null;
    return inst.createShelfBubble(input);
  }

  updateShelfBubble(
    id: string,
    updates: Partial<Pick<ShelfBubble, 'x' | 'y' | 'width' | 'height' | 'title' | 'preservePinned'>>,
  ): ShelfBubble | null {
    for (const inst of this.instances.values()) {
      if (inst.getShelfBubble(id)) return inst.updateShelfBubble(id, updates);
    }
    return null;
  }

  addShelfItem(id: string, draft: ShelfImportDraftItem): ShelfBubble | null {
    for (const inst of this.instances.values()) {
      if (inst.getShelfBubble(id)) return inst.addShelfItem(id, draft);
    }
    return null;
  }

  updateShelfItem(
    id: string,
    itemId: string,
    updates: Partial<Pick<ShelfItem, 'label' | 'kind' | 'command' | 'cwd' | 'prompt' | 'targetAgentId' | 'icon' | 'color'>>,
  ): ShelfBubble | null {
    for (const inst of this.instances.values()) {
      if (inst.getShelfBubble(id)) return inst.updateShelfItem(id, itemId, updates);
    }
    return null;
  }

  removeShelfItem(id: string, itemId: string): ShelfBubble | null {
    for (const inst of this.instances.values()) {
      if (inst.getShelfBubble(id)) return inst.removeShelfItem(id, itemId);
    }
    return null;
  }

  reorderShelfItems(id: string, order: string[]): ShelfBubble | null {
    for (const inst of this.instances.values()) {
      if (inst.getShelfBubble(id)) return inst.reorderShelfItems(id, order);
    }
    return null;
  }

  importShelfItems(
    id: string,
    drafts: ShelfImportDraftItem[],
    replace: boolean,
  ): { bubble: ShelfBubble; added: number; dropped: number } | null {
    for (const inst of this.instances.values()) {
      if (inst.getShelfBubble(id)) return inst.importShelfItems(id, drafts, replace);
    }
    return null;
  }

  startShelfItemRun(id: string, itemId: string, seed?: { agentId?: string; sessionId?: string }): ShelfItem | null {
    for (const inst of this.instances.values()) {
      if (inst.getShelfBubble(id)) return inst.startShelfItemRun(id, itemId, seed);
    }
    return null;
  }

  finishShelfItemRun(
    id: string,
    itemId: string,
    result: Partial<Omit<ShelfItemRun, 'status' | 'startedAt'>> & { status: ShelfRunStatus },
  ): ShelfItem | null {
    for (const inst of this.instances.values()) {
      if (inst.getShelfBubble(id)) return inst.finishShelfItemRun(id, itemId, result);
    }
    return null;
  }

  deleteShelfBubble(id: string): boolean {
    for (const inst of this.instances.values()) {
      if (inst.getShelfBubble(id)) return inst.deleteShelfBubble(id);
    }
    return false;
  }

  getShelfBubble(id: string): ShelfBubble | undefined {
    for (const inst of this.instances.values()) {
      const b = inst.getShelfBubble(id);
      if (b) return b;
    }
    return undefined;
  }

  getAllShelfBubbles(): ShelfBubble[] {
    const out: ShelfBubble[] = [];
    for (const inst of this.instances.values()) out.push(...inst.getShelfBubbles());
    return out;
  }

  /** 선반은 부모, 카드는 워크트리 인스턴스일 수 있어 전 인스턴스를 훑는다. */
  findShelfItemByAgent(agentId: string): { bubble: ShelfBubble; item: ShelfItem } | undefined {
    for (const inst of this.instances.values()) {
      const hit = inst.findShelfItemByAgent(agentId);
      if (hit) return hit;
    }
    return undefined;
  }

  /** 그 에이전트에게 아직 결정 안 난 리뷰가 있나 — 전 인스턴스를 훑는다(에이전트는 워크트리 인스턴스 소속). */
  findOpenReviewRequestByAgent(agentId: string): ReviewRequest | undefined {
    for (const inst of this.instances.values()) {
      const r = inst.findOpenReviewRequestByAgent(agentId);
      if (r) return r;
    }
    return undefined;
  }

  recordReviewDecision(
    id: string,
    input: Omit<ReviewDecision, 'id' | 'decidedAt'> & { decidedAt?: number },
  ): ReviewRequest | null {
    for (const inst of this.instances.values()) {
      if (inst.getReviewRequest(id)) return inst.recordReviewDecision(id, input);
    }
    return null;
  }

  deleteReviewRequest(id: string): boolean {
    for (const inst of this.instances.values()) {
      if (inst.getReviewRequest(id)) return inst.deleteReviewRequest(id);
    }
    return false;
  }


  /** §5.14 4단 계단 ③ — 실제로 떠 있던 명령들(탐지기가 가장 세게 믿는 근거). `runningServers` 는 죽은 entry 도 보존한다. */
  getObservedServerCommands(projectName: string): { command: string; port?: number }[] {
    const inst = this.getInstanceByName(projectName);
    if (!inst) return [];
    const out: { command: string; port?: number }[] = [];
    const snapshot = inst.getSnapshot();
    for (const entries of Object.values(snapshot.runningServers ?? {})) {
      for (const entry of entries) {
        if (entry.reportedOnly === true) continue;
        out.push({ command: entry.command, ...(entry.port !== undefined ? { port: entry.port } : {}) });
      }
    }
    return out;
  }

  // §5.3 #28 — 콘티 위임

  /** agentId 기준으로 인스턴스 찾기. 헬퍼: agent 가 어느 ProjectGraph 에 속하는지. */
  private getInstanceByAgentId(agentId: string): ProjectGraph | null {
    for (const inst of this.instances.values()) {
      const cfgs = inst.getAgentConfigsSnapshot();
      if (cfgs[agentId]) return inst;
      // agentConfigs 미설정인 신규 에이전트 폴백 — primary 인스턴스 위임
    }
    // 폴백: agent.id 매칭 검색 (agentConfigs 가 없는 신규 에이전트 대비)
    for (const inst of this.instances.values()) {
      const snap = inst.getSnapshot();
      if (snap.agents.some((a) => a.id === agentId)) return inst;
    }
    return null;
  }

  /** contiId 가 어느 인스턴스에 있는지 찾는다. */
  private getInstanceByContiId(contiId: string): ProjectGraph | null {
    for (const inst of this.instances.values()) {
      if (inst.getConti(contiId)) return inst;
    }
    return null;
  }

  /** 모든 콘티 합본 (snapshot 보조용 — 일반 경로는 getSnapshot.contis 로 충분) */
  getAllContis(): Conti[] {
    const out: Conti[] = [];
    for (const inst of this.instances.values()) out.push(...inst.getContis());
    return out;
  }

  /** 콘티 단건 조회 */
  getConti(contiId: string): Conti | undefined {
    for (const inst of this.instances.values()) {
      const c = inst.getConti(contiId);
      if (c) return c;
    }
    return undefined;
  }

  /** agentId 의 콘티 (asc) */
  getContisByAgent(agentId: string): Conti[] {
    const inst = this.getInstanceByAgentId(agentId);
    if (!inst) return [];
    return inst.getContisByAgent(agentId);
  }

  /** 콘티 신규 추가 — 호출자가 Conti 객체를 만들고 매니저에 전달 */
  addConti(c: Conti): void {
    const inst = this.getInstanceByAgentId(c.agentId) ?? this.primaryInstance();
    if (!inst) return;
    inst.addConti(c);
  }

  deleteConti(contiId: string): boolean {
    const inst = this.getInstanceByContiId(contiId);
    return inst?.deleteConti(contiId) ?? false;
  }

  addContiFrame(contiId: string, frame: ContiFrame): ContiFrame | null {
    const inst = this.getInstanceByContiId(contiId);
    return inst?.addContiFrame(contiId, frame) ?? null;
  }

  deleteContiFrame(contiId: string, frameIndex: number): boolean {
    const inst = this.getInstanceByContiId(contiId);
    return inst?.deleteContiFrame(contiId, frameIndex) ?? false;
  }

  /** §5.3 #28 — 콘티 frame 순서 변경. */
  moveContiFrame(contiId: string, fromIndex: number, toIndex: number): boolean {
    const inst = this.getInstanceByContiId(contiId);
    return inst?.moveContiFrame(contiId, fromIndex, toIndex) ?? false;
  }

  patchContiFrame(
    contiId: string,
    frameIndex: number,
    updates: { title?: string; action?: string },
  ): ContiFrame | null {
    const inst = this.getInstanceByContiId(contiId);
    return inst?.patchContiFrame(contiId, frameIndex, updates) ?? null;
  }

  replaceContiElement(
    contiId: string,
    frameId: string,
    elementId: string,
    next: ContiElement,
  ): ContiElement | null {
    const inst = this.getInstanceByContiId(contiId);
    return inst?.replaceContiElement(contiId, frameId, elementId, next) ?? null;
  }

  findContiElement(
    contiId: string,
    frameId: string,
    elementId: string,
  ): { conti: Conti; frame: ContiFrame; element: ContiElement } | null {
    const inst = this.getInstanceByContiId(contiId);
    return inst?.findContiElement(contiId, frameId, elementId) ?? null;
  }

  /** §5.3 #28 (L) — 콘티 frames 통째 교체(수정). 콘티가 속한 인스턴스에 위임. */
  updateContiFrames(contiId: string, frames: ContiFrame[], title?: string): Conti | null {
    const inst = this.getInstanceByContiId(contiId);
    return inst?.updateContiFrames(contiId, frames, title) ?? null;
  }

  /** §5.13 (Q) — 콘티의 출력 프리셋 지정. */
  setContiPreset(contiId: string, presetId: StoryboardPresetId): Conti | null {
    const inst = this.getInstanceByContiId(contiId);
    return inst?.setContiPreset(contiId, presetId) ?? null;
  }

  /** §5.13 (Q) — 콘티를 받아 간 앱의 문서·작업 기록. */
  setContiRenderLink(contiId: string, link: ContiRenderLink): Conti | null {
    const inst = this.getInstanceByContiId(contiId);
    return inst?.setContiRenderLink(contiId, link) ?? null;
  }

  /** §5.3 #28 (L) — 진행 중인 콘티 작업 조회. */
  getActiveContiWork(agentId: string): ActiveContiWork | undefined {
    const inst = this.getInstanceByAgentId(agentId);
    return inst?.getActiveContiWork(agentId);
  }

  /** §5.3 #28 (L) — 콘티 작업 시작(workId 발급). 이미 있으면 그것을 돌려준다. */
  startContiWork(agentId: string, source: ContiWorkSource): ActiveContiWork | null {
    const inst = this.getInstanceByAgentId(agentId);
    if (!inst) return null;
    return inst.startContiWork(agentId, source);
  }

  /** §5.3 #28 (L) — 사용자가 명시한 새 콘티 — 기존 트래커 항목을 버리고 새 workId. */
  resetContiWork(agentId: string, source: ContiWorkSource): ActiveContiWork | null {
    const inst = this.getInstanceByAgentId(agentId);
    if (!inst) return null;
    return inst.resetContiWork(agentId, source);
  }

  /** §5.3 #28 (L) — 첫 응답으로 만든 Conti 의 id 를 트래커에 머지. */
  attachContiIdToWork(agentId: string, contiId: string): boolean {
    const inst = this.getInstanceByAgentId(agentId);
    return inst?.attachContiIdToWork(agentId, contiId) ?? false;
  }

  // ─── 기타 위임 메서드 ───

  agentCount(): number {
    let total = 0;
    for (const inst of this.instances.values()) total += inst.agentCount();
    return total;
  }

  getProjectByName(name: string): ProjectInfo | undefined {
    for (const inst of this.instances.values()) {
      const found = inst.getProjectByName(name);
      if (found) return found;
    }
    return undefined;
  }

  /** agentId → 소속 프로젝트 디스크 path. 스킬 목록처럼 소속이 권위일 때 쓴다 — 클라 표시명에 기대지 않아 활성 프로젝트 오염·이름 충돌과 무관하다. */
  getProjectPathForAgent(agentId: string): string | null {
    for (const inst of this.instances.values()) {
      const p = inst.getAgentProjectPath(agentId);
      if (p) return p;
    }
    return null;
  }

  /** §5.5 #17-28 — 그 에이전트 세션이 실제로 도는 폴더(주입원 계측이 지시 파일을 찾는 기준). */
  getAgentCwdByAgentId(agentId: string): string | null {
    for (const inst of this.instances.values()) {
      const p = inst.getAgentCwdByAgentId(agentId);
      if (p) return p;
    }
    return null;
  }

  /** §5.10 — 최근 참조 파일(피드 related 랭킹 ctx.files, best-effort). 없으면 빈 배열. */
  getAgentRecentFiles(agentId: string): string[] {
    for (const inst of this.instances.values()) {
      const files = inst.getFileRefsForAgent(agentId);
      if (files.length > 0) return files;
    }
    return [];
  }

  getPrimaryProject(): ProjectInfo | null {
    return this.primaryInstance()?.getPrimaryProject() ?? null;
  }

  getSeq(): number {
    return this.primaryInstance()?.getSeq() ?? 0;
  }

  getAgentConfigsSnapshot(): Record<string, AgentConfig> {
    const result: Record<string, AgentConfig> = {};
    for (const inst of this.instances.values()) {
      Object.assign(result, inst.getAgentConfigsSnapshot());
    }
    return result;
  }

  setAutoLoadSessions(enabled: boolean): void {
    for (const inst of this.instances.values()) inst.setAutoLoadSessions(enabled);
  }

  isAutoLoadSessions(): boolean {
    return this.primaryInstance()?.isAutoLoadSessions() ?? true;
  }

  discoverAndSeed(cwd: string): void {
    const rootCwd = resolveProjectRoot(cwd);
    const key = normalize(rootCwd);
    this.instances.get(key)?.discoverAndSeed(rootCwd);
  }

  expireCompletedAgents(): string[] {
    const result: string[] = [];
    for (const inst of this.instances.values()) {
      result.push(...inst.expireCompletedAgents());
    }
    return result;
  }

  sweepIdleAgents(thresholdMs: number): string[] {
    const result: string[] = [];
    for (const inst of this.instances.values()) {
      result.push(...inst.sweepIdleAgents(thresholdMs));
    }
    return result;
  }

  /**
   * §5.21 — 모든 인스턴스의 비용·토큰 지도를 훑는다(바뀌면 true).
   * 단가는 런타임 레지스트리가 SSOT 라 호출부가 넘긴다.
   */
  sweepCostMaps(registry: ModelRegistry | null, now: number = Date.now()): boolean {
    let changed = false;
    for (const inst of this.instances.values()) {
      if (inst.sweepCostMap(registry, now)) changed = true;
    }
    return changed;
  }

  findInterruptedActiveSessions(): string[] {
    const result: string[] = [];
    for (const inst of this.instances.values()) {
      result.push(...inst.findInterruptedActiveSessions());
    }
    return result;
  }

  async checkAgentLiveness(): Promise<string[]> {
    const result: string[] = [];
    for (const inst of this.instances.values()) {
      result.push(...(await inst.checkAgentLiveness()));
    }
    return result;
  }

  /** 서버 시작 시 + 주기적 — stale 에이전트 정리 (isSessionInUse 기반, async) */
  async pruneStaleRestoredAgents(): Promise<string[]> {
    const result: string[] = [];
    for (const inst of this.instances.values()) {
      result.push(...(await inst.pruneStaleRestoredAgents()));
    }
    return result;
  }

  /** sessionLifecycle onDead 콜백용 — 모든 인스턴스에서 해당 sessionId 제거 시도 */
  removeAgentBySession(sessionId: string): boolean {
    for (const inst of this.instances.values()) {
      if (inst.removeAgentBySession(sessionId)) return true;
    }
    return false;
  }

  // §5.10 — 구 "지난 커스텀 에이전트 복구"(listRecoverableCustomAgents/restoreCustomAgent)는
  //   휴지통(trash) 이 후신이 되어 제거됨. 크래시 소실 복원은 §3.2.2 mergeIdentityIntoCheckpoint 가 부팅 시 담당.

  /** §5.7 #24 — SessionStart 때 cwd 가 같은 dormant 에이전트를 전 인스턴스에서 복원하고 sessionId 를 모아 돌려준다. */
  restoreDormantForCwd(cwd: string): string[] {
    const restored: string[] = [];
    for (const inst of this.instances.values()) {
      restored.push(...inst.restoreDormantForCwd(cwd));
    }
    return restored;
  }

  /** 모든 인스턴스의 추적 세션 집계 — sessionLifecycle 초기 동기화용 */
  listTrackedSessions(): Array<{ sessionId: string; pid: number; cwd: string }> {
    const result: Array<{ sessionId: string; pid: number; cwd: string }> = [];
    for (const inst of this.instances.values()) result.push(...inst.listTrackedSessions());
    return result;
  }

  pruneExpired(): number {
    let total = 0;
    for (const inst of this.instances.values()) total += inst.pruneExpired();
    return total;
  }

  pruneDeletedFiles(): string[] {
    const result: string[] = [];
    for (const inst of this.instances.values()) {
      result.push(...inst.pruneDeletedFiles());
    }
    return result;
  }

  removeProject(name: string): boolean {
    const inst = this.getInstanceByName(name);
    return inst ? inst.removeProject(name) : false;
  }

  recordObservedTool(sessionId: string, toolName: string): void {
    const inst = this.getInstanceForSession(sessionId);
    if (inst) inst.recordObservedTool(sessionId, toolName);
  }

  toCheckpointAll(): ProjectCheckpoint[] {
    const results: ProjectCheckpoint[] = [];
    for (const inst of this.instances.values()) {
      const name = inst.getPrimaryProjectName();
      if (name) {
        results.push(inst.toProjectCheckpoint(name));
      }
    }
    return results;
  }

  /** 루트 캔버스 바운딩 박스 — 모든 인스턴스에 적용 (어느 인스턴스가 해당 프로젝트 CP 를 쓰는지 알 수 없으므로). */
  setLayoutBounds(projectName: string, hw: number, hh: number): boolean {
    let changed = false;
    for (const inst of this.instances.values()) {
      if (inst.setLayoutBounds(projectName, hw, hh)) changed = true;
    }
    return changed;
  }
}

/** 싱글턴 인스턴스 */
export const graphManager = new ProjectGraphManager();
