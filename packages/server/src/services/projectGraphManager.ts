/**
 * ProjectGraphManager — per-project ProjectGraph 인스턴스 라우팅 파사드
 *
 * 현재 싱글턴 ProjectGraph의 공개 API를 그대로 노출하면서,
 * 내부적으로 cwd별 독립 인스턴스를 관리한다.
 * consumers는 `projectGraph` → `graphManager` 교체만으로 마이그레이션 가능.
 *
 * TODO: task edges를 ProjectGraph → Manager 레벨로 이동
 */

import path from 'node:path';
import fs from 'node:fs';
import type {
  BubbleData,
  GraphSnapshot,
  ProjectAgentCounts,
  HookEventPayload,
  ProjectInfo,
  ProjectCheckpoint,
  ProjectMetaSnapshot,
  QueuedCommand,
  ServerEntry,
  FolderFileEntry,
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
  ExecutionMode,
  AgentProvider,
} from '@vibisual/shared';
import { DEFAULT_AUDIT_BOUNDARY, DEFAULT_UI_LOCALE } from '@vibisual/shared';
import { ProjectGraph, resolveGitWorktreeParent, type ProcessResult } from './projectGraph.js';
// §5.22 — 권한·감사 경계(승인 창구가 원장에 적을 때 쓰는 입력 모양).
import type { AuditRecordInput } from './auditLog.js';
import { loadCheckpointByMeta, writeCheckpoint, projectDirForInfo, discoverProjectMetas } from './statePersistence.js';
import { appStateAddOpenProject, loadAppState } from './appState.js';
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
import { pathKey } from './pathKey.js';

// ─── 유틸 ───

/** 경로 정규화 (슬래시 통일, trailing slash 제거, **대소문자를 실제로 무시하는 FS 에서만** 소문자)
 *  — projectGraph.ts 의 `normalize` 와 반드시 같은 규칙. 인스턴스/스텁 Map 키다.
 *  linux 에서 무조건 접으면 케이스만 다른 두 워크트리·프로젝트가 한 인스턴스로 뭉개져
 *  한쪽 등록이 다른 쪽을 에러 없이 덮어쓴다. */
function normalize(filePath: string): string {
  return pathKey(filePath);
}

/**
 * §3.2.1-4 (v3.03) — 로드 실패로 read-only 격리된 프로젝트(또는 디스크에 미하이드레이트 데이터가
 * 실재하는 경로)에 대해 `registerProject` 가 빈 인스턴스 생성을 거부할 때 던지는 에러.
 * 빈 인스턴스가 멀쩡한 디스크 checkpoint 를 빈 그래프로 덮어쓰는 손실 경로를 끊는다.
 * 호출처는 이 에러를 잡아 해당 이벤트를 드롭한다.
 */
export class ReadOnlyProjectError extends Error {
  constructor(public readonly projectPath: string) {
    super(`Project is read-only isolated (load-error) and re-hydrate failed: ${projectPath}`);
    this.name = 'ReadOnlyProjectError';
  }
}

/**
 * 프로젝트 루트 해석.
 * cwd에서 위로 올라가며 아래 마커 중 하나를 찾으면 그 폴더를 프로젝트 루트로 간주.
 * 모노레포 서브패키지(packages/shared 등)의 세션이 별도 탭으로 뜨는 걸 방지.
 * 마커 없으면 cwd 그대로 반환.
 */
const PROJECT_ROOT_MARKERS = [
  'pnpm-workspace.yaml',
  'lerna.json',
  'nx.json',
  'rush.json',
  '.git',
];

function resolveProjectRoot(cwd: string): string {
  // worktree cwd 감지 → 부모 인스턴스로 라우팅 (SSOT §5.7 #26, todo0417 A-1)
  // worktree 디렉토리도 자체 .git/package.json 을 가지므로 마커 검색이 worktree 자기 자신을 프로젝트 루트로 잘못 인식,
  // 그 결과 같은 worktree 세션이 부모 인스턴스와 worktree 인스턴스 양쪽에서 seed 되어 스냅샷 merge 시 중복 렌더됨.
  const normalized = cwd.replace(/\\/g, '/');
  const wtMatch = normalized.match(/^(.+?)\/\.claude\/worktrees\/[^/]+\/?/);
  if (wtMatch) {
    // 원본 케이스 보존 (cwd는 원본, normalized는 slash 변환본)
    return cwd.slice(0, wtMatch[1]!.length);
  }

  // git-linked 워크트리(임의 위치) → 부모 메인 워크트리로 라우팅.
  // Claude Code `--isolation worktree` 는 워크트리를 `.claude/worktrees/` 밖 임의 위치에 만들 수 있어
  // 위 경로 패턴을 벗어난다. 이 경우 부모로 승격하지 않으면 매니저가 워크트리 경로로 별도 top-level
  // 인스턴스(name=basename=`agent-<hex>`)를 만들어, 루트 노드 1개짜리 유령 프로젝트가 저장 순회에
  // 남아 checkpoint 덮어쓰기 가드 경고를 반복 유발한다(SSOT §5.7 #26 — 워크트리는 부모 캔버스에
  // 흡수, 별도 탭/프로젝트 금지). resolveGitWorktreeParent 는 cwd 단위 캐시라 첫 1회만 git 호출.
  const gitWt = resolveGitWorktreeParent(normalize(cwd));
  if (gitWt) return gitWt.parentPath;

  let dir = path.resolve(cwd);
  const { root } = path.parse(dir);
  while (dir && dir !== root) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      try {
        if (fs.existsSync(path.join(dir, marker))) return dir;
      } catch { /* ignore */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return cwd;
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

/**
 * 두 스냅샷을 병합. 배열은 이어붙이고, Record는 Object.assign으로 합친다.
 *
 * 프로젝트를 둘 이상 연 사용자에겐 **모든 방송 스냅샷이 이 함수를 통과**한다. 여기서 빠진
 * 필드는 서버에 멀쩡히 있어도 화면에는 영영 안 나타나므로, 새 필드를 추가하면 여기도 함께
 * 손대야 한다(테스트에서 직접 부르려고 export 한다).
 */
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
    commandQueues: { ...a.commandQueues, ...b.commandQueues },
    completedCommands: { ...a.completedCommands, ...b.completedCommands },
    subAgents: { ...a.subAgents, ...b.subAgents },
    // §5.5 #17-9 v3.51 — subAgentManager 가 싱글턴이라 양쪽이 같은 값을 들고 온다. agentId 1차 키
    //   단순 spread 로 충분(b 우선). 양쪽 다 없으면 필드 자체를 생략 → 클라에서 아이콘 자동 소멸.
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
    // v1.45 — Comment Box 합치기 (id 기준 dedup, 같은 id 면 b 우선 — 최근 인스턴스가 권위)
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
    // §5.14 v4.62 — 플레이 버블도 같은 규칙(위 앱 버블이 이 자리를 빠뜨려 사라졌던 전례를 따른다).
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
    // §5.13 v4.45 — 내부 앱 버블도 같은 규칙. 여기서 빠뜨리면 프로젝트를 둘 이상 연 순간
    // 앱 버블이 방송 스냅샷에서 통째로 사라진다(서버엔 만들어졌는데 캔버스에 안 뜬다).
    appBubbles: (() => {
      const map = new Map<string, AppBubble>();
      for (const c of a.appBubbles ?? []) map.set(c.id, c);
      for (const c of b.appBubbles ?? []) map.set(c.id, c);
      return Array.from(map.values());
    })(),
    // §5.5 #17-20 ⑩ v4.94 — 중단점은 projectName 1차 키라 단순 spread 로 안전하다(b 우선).
    // 여기서 빠뜨리면 프로젝트를 둘 이상 연 순간 중단점이 방송에서 통째로 사라진다.
    debugBreakpoints: (() => {
      const merged = { ...(a.debugBreakpoints ?? {}), ...(b.debugBreakpoints ?? {}) };
      return Object.keys(merged).length > 0 ? merged : undefined;
    })(),
    // 루트 캔버스 바운딩 박스 — projectName 키로 머지 (b 우선)
    layoutBoundsByProject: { ...(a.layoutBoundsByProject ?? {}), ...(b.layoutBoundsByProject ?? {}) },
    // v1.47 — 콘티 합치기 (contiId 키로 dedup, b 우선)
    contis: { ...(a.contis ?? {}), ...(b.contis ?? {}) },
    // §4 v1.50 — 도구 시간/컴팩션 카운트는 sessionId 키로 dedup (b 우선). rateLimits 는 글로벌.
    recentToolDurations: { ...(a.recentToolDurations ?? {}), ...(b.recentToolDurations ?? {}) },
    compactCounts: { ...(a.compactCounts ?? {}), ...(b.compactCounts ?? {}) },
    rateLimits: b.rateLimits ?? a.rateLimits,
    claudeUsage: b.claudeUsage ?? a.claudeUsage,
    // §4 v4.82 — 로그인 상태도 글로벌 1건(계정은 머신 단위).
    claudeAuth: b.claudeAuth ?? a.claudeAuth,
    // §4 (첫 실행 설치 온보딩) — CLI 설치 판정도 글로벌 1건(설치는 기기 단위).
    claudeSetup: b.claudeSetup ?? a.claudeSetup,
    // §5.5 #17-4 v2.36 — 스킬 사용 카운트는 projectName 1차 키 → 단순 spread 안전.
    // 같은 projectName 이 양쪽에 들어올 가능성 ❌ (각 ProjectGraph 가 primary 하나).
    skillUsageCounts: (() => {
      const av = a.skillUsageCounts;
      const bv = b.skillUsageCounts;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §5.3 #10-2 v2.37 — Auto Agent 요약 (agentId/sessionId 키, b 우선). 단일 인스턴스면 그대로 통과.
    autoAgentSummaries: (() => {
      const av = a.autoAgentSummaries;
      const bv = b.autoAgentSummaries;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §5.3 #10-3 v4.98 — 검증 런 (autoAgentId 1차 키 → 단순 spread 안전, b 우선).
    //   ⚠ 이 병합을 빠뜨리면 **여러 프로젝트를 동시에 열었을 때만** 런이 사라진다
    //   (단일 프로젝트 테스트로는 안 잡힌다 — appBubbles 에서 실제로 겪은 사고).
    autoAgentRuns: (() => {
      const av = a.autoAgentRuns;
      const bv = b.autoAgentRuns;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §4 v2.52 — 에이전트 작업 신고 (agentId 1차 키 → 단순 spread 안전, b 우선).
    agentReports: (() => {
      const av = a.agentReports;
      const bv = b.agentReports;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §4 v2.60 — 에이전트 질문 카드 (agentReports 와 동형).
    agentQuestions: (() => {
      const av = a.agentQuestions;
      const bv = b.agentQuestions;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §4 v2.70 — 에이전트 검수 요청 카드 (agentReports 와 동형).
    agentReviews: (() => {
      const av = a.agentReviews;
      const bv = b.agentReviews;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §4 v2.84 — 에이전트 번호 목록 정렬 카드 (agentReports 와 동형).
    agentLists: (() => {
      const av = a.agentLists;
      const bv = b.agentLists;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §4 v3.21 — 에이전트 피드백 (agentReports 와 동형).
    agentFeedbacks: (() => {
      const av = a.agentFeedbacks;
      const bv = b.agentFeedbacks;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §5.5 #17-11 v3.79 — 세션 루프는 subAgentId 1차 키(세션 단위로 유일) → 단순 spread 안전, b 우선.
    //   여기 빠지면 프로젝트를 2개 이상 열었을 때 병합 순간 루프 설정이 통째로 사라진다.
    sessionLoops: (() => {
      const av = a.sessionLoops;
      const bv = b.sessionLoops;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §5.5 #17-17 v4.46 — 세션 목표도 subAgentId 1차 키(루프와 동형). 여기 빠지면 프로젝트를
    //   2개 이상 열었을 때 병합 순간 목표·퍼센트가 통째로 사라진다(v3.70 brain 과 같은 결함).
    sessionGoals: (() => {
      const av = a.sessionGoals;
      const bv = b.sessionGoals;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §5.10 v3.70 — Brain 요약은 projectName 1차 키(skillUsageCounts 와 동형) → 단순 spread 안전.
    //   각 ProjectGraph 가 primary 하나뿐이라 키 충돌 ❌. **이 두 필드가 빠져 있어서** 프로젝트를
    //   2개 이상 열면 병합 순간 요약/주입 신호가 통째로 사라지고 Brain 버블이 "0장"으로 보였다
    //   (카드는 디스크에 그대로 있는 표시 전용 결함) — 새 스냅샷 필드 추가 시 여기 병합도 함께.
    brain: (() => {
      const av = a.brain;
      const bv = b.brain;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §5.10 v3.70 — 주입 이벤트는 agentId 1차 키(agentReports 와 동형, b 우선).
    brainInjections: (() => {
      const av = a.brainInjections;
      const bv = b.brainInjections;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
    // §5.5 #17-28 — 주입원 오버라이드는 층이 둘이라 **한 겹 안쪽까지** 합쳐야 한다.
    //   겉만 spread 하면 나중 스냅샷의 `projects`/`sessions` 가 앞 것을 통째로 덮어
    //   프로젝트를 2개 이상 열었을 때 한쪽의 껐던 설정이 사라진다(위 두 카드가 겪은 결함).
    contextOverrides: (() => {
      const av = a.contextOverrides;
      const bv = b.contextOverrides;
      if (!av && !bv) return undefined;
      return {
        projects: { ...(av?.projects ?? {}), ...(bv?.projects ?? {}) },
        sessions: { ...(av?.sessions ?? {}), ...(bv?.sessions ?? {}) },
        updatedAt: Math.max(av?.updatedAt ?? 0, bv?.updatedAt ?? 0),
      };
    })(),
  };
}

// ─── v1.63 전역 유일 표시명 (식별=path, 이름=표시) ───

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
    // §5.5 #17-4 v2.36 — projectName 1차 키 relabel.
    skillUsageCounts: renameKey(snap.skillUsageCounts),
    // §5.10 v3.70 — Brain 요약도 projectName 1차 키라 전역 유일 표시명으로 함께 relabel해야
    //   클라(activeProject 키 조회)가 같은 이름으로 찾을 수 있다.
    brain: renameKey(snap.brain),
  };
}

// ─── ProjectGraphManager 클래스 ───

export class ProjectGraphManager {
  /** normalized cwd → ProjectGraph 인스턴스 */
  private instances = new Map<string, ProjectGraph>();

  /** B 진단(§3.2.2) — getSnapshot 이 라이브에서 제외한 인스턴스(worktree/hidden)에서 발견한
   *  커스텀 에이전트 sessionId. 같은 sessionId 를 매 스냅샷마다 재경고하지 않도록 1회만 로깅. */
  private warnedHiddenCustomAgents = new Set<string>();

  /** §4 v1.50 — Claude.ai 한도 사용률 (글로벌 1건). 외부 statusline 스크립트가 푸시. */
  private globalRateLimits?: RateLimitInfo;

  /** §4 v3.62 — Claude 앱 `/usage` 와 같은 원천(OAuth)의 사용량 (글로벌 1건). */
  private globalClaudeUsage?: ClaudeUsageInfo;

  /** §4 v4.82 — Claude 계정 로그인 상태 (글로벌 1건, `claude auth status`). */
  private globalClaudeAuth?: ClaudeAuthStatus;

  /** §4 (첫 실행 설치 온보딩) — `claude` CLI 설치 판정 (글로벌 1건, 기기 단위). */
  private globalClaudeSetup?: ClaudeSetupState;

  /** project name → stub 메타 (hydrated 인스턴스가 없는 프로젝트) */
  private stubs = new Map<string, ProjectMetaSnapshot>();

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
   * §5.11 v4.65 — 플러그인 호스트가 주입하는 **집행 실측**(projectPath → pluginId → 값 한 벌).
   *
   * 스냅샷 브로드캐스트 지점이 스무 곳이 넘어 호출부마다 얹으면 반드시 어딘가 빠진다(빠진 곳으로 온
   * 스냅샷은 클라에서 값이 사라진 것으로 읽힌다). 그래서 `gitDirty` 와 같은 provider 방식으로 **한 곳에서**
   * 채운다 — 그래프는 플러그인을 모르는 상태로 남고, 호스트가 자기 값을 넣는다.
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

  /** project name → 인스턴스 조회. primary 일치 우선, worktree 이름처럼 primary 가 아닌 경우 인스턴스의 projects Map 포함 여부로 매치 (todo0417 B-2). */
  private getInstanceByName(name: string): ProjectGraph | null {
    for (const inst of this.instances.values()) {
      if (inst.getPrimaryProject()?.name === name) return inst;
    }
    for (const inst of this.instances.values()) {
      if (inst.getProjectByName(name)) return inst;
    }
    // v1.63: 클라가 전역 유일화된 **표시명**(예: "client (other)") 이나 **path** 를 보낼 수
    // 있다. raw name 직매칭 실패 시 path/display-name 으로 한 번 더 해소(단일 chokepoint).
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

  getUiLocale(): UiLocale {
    return this.primaryInstance()?.getUiLocale() ?? DEFAULT_UI_LOCALE;
  }

  /** primary 인스턴스에 저장 + 전 인스턴스에 전파(스냅샷 일관성). 변경이 있었으면 true. */
  setUiLocale(locale: UiLocale): boolean {
    let changed = false;
    for (const inst of this.instances.values()) {
      if (inst.setUiLocale(locale)) changed = true;
    }
    return changed;
  }

  // ─── 새 인스턴스 생성 헬퍼 ───

  private scenarioSeedCache: string | null = null;
  private scenarioSeedByRoot = new Map<string, string>();

  private createInstance(cwd: string): ProjectGraph {
    const inst = new ProjectGraph();
    inst.setPoppedCommandsRef(this.poppedCommandsRef);
    inst.setCommandQueuesRef(this.commandQueuesRef);
    inst.setCompletedCommandArchiveRef(this.completedCommandArchiveRef);
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

  // ─── Stub/Hydrate/Unload lifecycle ───
  //
  // v1.63: stub 맵·hydrate 경로는 **projectId(정규화 path)** 키. 과거 raw name 키였으나
  // 같은 basename 다른 경로 프로젝트 2개가 openProjects 에 동시에 있으면 2번째
  // registerStub 가 1번째를 덮어써 부팅 시 한 프로젝트가 통째로 소실됐다(§3.5).
  // 외부 인자(name|path ref)는 stubRefToKey 로 해소 — 클라/구코드 후방호환.

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
    // §5.4 #14 v1.34 — **사용자가 × 로 닫은 프로젝트는 강등 대상이 아니다.**
    //   탭 닫기는 `DELETE /api/projects/:name`(hide + stub 제거) 뒤에 클라의 `unload-project` 가
    //   이어지는 2단 흐름이라, 여기서 stub 으로 되돌리면 방금 닫은 탭이 그대로 되살아난다
    //   (증상: "× 를 한 번 눌러선 안 닫히고 두 번 눌러야 닫힌다"). 닫힘 SSOT 는 hidden 이므로
    //   hidden 이면 stub 을 남기지 않고, 남아 있던 stub 도 함께 지운다. 사용자가 닫지 않은
    //   배경 탭의 **유휴 해제**는 종전대로 stub 을 남긴다 — 안 그러면 열어 둔 탭이 저절로 사라진다.
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

  /**
   * stub 맵에서 특정 프로젝트 제거 — DELETE /api/projects/:name 후 탭이 stub으로 남는 걸 방지.
   * 인스턴스가 있으면(hydrated) 이 함수로는 건드리지 않음. 실제 제거 시 true.
   */
  removeStubFromMap(ref: string): boolean {
    const key = this.stubRefToKey(ref);
    return key ? this.stubs.delete(key) : false;
  }

  /**
   * §3.2.1-4 (v3.03) — stub 을 read-only 로 표시(부팅 hydrate load 실패 격리).
   * 제거하지 않으므로 디스크 데이터가 보존되고, 다음 부팅/registerProject 에서 백업 복구를 재시도한다.
   * 빈 인스턴스 생성을 막는 신호. 실제 표시 시 true.
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
   * §3.2.1-4 (v3.03) 2차 안전망 — rootCwd 가 아직 hydrate 안 됐는데 디스크에 영속 데이터가
   * 실재하는가(`.vibisual/save` 의 checkpoint/identity 또는 그 `.bak1`). true 면 빈 인스턴스로
   * 덮어쓰기 직전 상태 → registerProject 가 hydrate 재시도 후 실패 시 생성을 거부한다.
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

  /**
   * v1.63: 프로젝트 참조를 canonical {path, rawName} 으로 해소.
   * 클라는 projectId(path)를 보내는 게 표준 — 표시명이 등록 시점 raw name(basename)과
   * 다를 수 있어(전역 유일화) 이름으로는 hideProject/stub 조회가 빗나간다.
   * path 우선 매칭, 실패 시 raw name / stub key 폴백(후방호환).
   */
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

  // ─── 프로젝트 등록 ───

  /** cwd로 새 ProjectGraph 인스턴스 등록 (이미 있으면 기존 반환) */
  registerProject(cwd: string): ProjectInfo {
    // 서브디렉터리 → 프로젝트 루트로 승격 (모노레포 서브패키지가 별도 탭으로 뜨지 않게)
    const rootCwd = resolveProjectRoot(cwd);
    const key = normalize(rootCwd);
    let inst = this.instances.get(key);
    if (!inst) {
      // v1.63: stub 조회/hydrate 는 path(rootCwd) 기준 — 이름 충돌 무관.
      if (this.isStubbed(rootCwd)) {
        const wasReadOnly = this.isReadOnly(rootCwd);
        logger.info(`ProjectGraphManager: auto-hydrating stub for cwd "${rootCwd}"${wasReadOnly ? ' [read-only retry]' : ''}`);
        const result = this.hydrateProject(rootCwd);
        if (result.ok) {
          const hydratedInst = this.instances.get(key);
          if (hydratedInst) return hydratedInst.registerProject(rootCwd);
        } else if (wasReadOnly || this.hasUnhydratedDiskData(rootCwd)) {
          // §3.2.1-4 (v3.03) — 디스크에 영속 데이터가 실재하는데 hydrate 실패. 빈 인스턴스로
          // 덮어쓰면 손실이므로 read-only 유지 + 생성 거부. 호출처가 이벤트를 드롭한다.
          this.markStubReadOnly(rootCwd, 'load-error');
          throw new ReadOnlyProjectError(rootCwd);
        } else {
          logger.warn(`ProjectGraphManager: auto-hydrate failed for "${rootCwd}" (${result.reason}) — creating fresh instance`);
        }
      } else if (this.hasUnhydratedDiskData(rootCwd)) {
        // §3.2.1-4 (v3.03) 2차 안전망 — stub 은 없는데 디스크 데이터가 실재(과거 stub 이 제거됐던
        // 사고 경로). stub 재등록 후 hydrate 시도, 실패 시 read-only 격리 + 빈 인스턴스 거부.
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
    // AppState SSOT: top-level 프로젝트가 새로 등록되면 openProjects에 추가.
    // worktree는 부모 캔버스 내 버블이라 탭으로 노출 안 함 → 스킵 (SSOT §5.7 #26).
    // hook 이벤트로 자동 등록된 경우에도 이 경로를 타므로 feedback_boot_no_autoload 규칙 준수.
    if (!info.parentProjectPath) {
      // v1.63: 식별 = info.path(projectId). info.name 은 표시명 캐시로만 전달.
      const added = appStateAddOpenProject(info.path, info.name);
      if (added) logger.info(`AppState: openProjects += ${info.path} ("${info.name}")`);
    }
    return info;
  }

  // ─── 라우팅: 세션 기반 ───

  processHookEvent(payload: HookEventPayload): ProcessResult | null {
    let inst = this.getInstanceForSession(payload.session_id);
    const routedBy = inst ? 'session-routing' : 'cwd-lookup';

    if (!inst && payload.cwd) {
      // 서브디렉터리 cwd → 프로젝트 루트 키로 승격
      const key = normalize(resolveProjectRoot(payload.cwd));
      inst = this.instances.get(key) ?? null;
      if (!inst) {
        // 새 프로젝트 자동 등록 (루트 기준)
        try {
          this.registerProject(payload.cwd);
        } catch (e) {
          if (e instanceof ReadOnlyProjectError) {
            // §3.2.1-4 (v3.03) — read-only 격리 프로젝트. 빈 인스턴스로 디스크를 덮어쓰지 않도록 이벤트 드롭.
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
    // v4.67 — 이 기록의 진단 가치는 **라우팅**(이 세션의 이벤트가 어느 인스턴스로 가는가)에 있지
    // 개별 도구 호출에 있지 않다. 훅 이벤트마다 남기면 로그가 무한히 자라므로(실측 2위),
    // 세션별 라우팅 결과가 달라졌을 때만 남긴다. 오라우팅·인스턴스 이동은 signature 가 바뀌어
    // 반드시 기록되고, 같은 곳으로 계속 가는 정상 반복만 침묵한다.
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
    if (inst) return inst.getAgentBySession(sessionId);
    // fallback: 커스텀 에이전트는 sessionRouting에 등록되지 않음 → 전 인스턴스 검색
    for (const i of this.instances.values()) {
      const agent = i.getAgentBySession(sessionId);
      if (agent) return agent;
    }
    return null;
  }

  getAgentCwd(sessionId: string): string | null {
    const inst = this.getInstanceForSession(sessionId);
    if (inst) return inst.getAgentCwd(sessionId);
    // fallback: 모든 인스턴스에서 검색
    for (const i of this.instances.values()) {
      const cwd = i.getAgentCwd(sessionId);
      if (cwd) return cwd;
    }
    return null;
  }

  findAgentIdBySession(sessionId: string): string | null {
    const inst = this.getInstanceForSession(sessionId);
    if (inst) return inst.findAgentIdBySession(sessionId);
    for (const i of this.instances.values()) {
      const id = i.findAgentIdBySession(sessionId);
      if (id !== null) return id;
    }
    return null;
  }

  setAgentStatus(sessionId: string, status: 'completed'): void {
    const inst = this.getInstanceForSession(sessionId);
    if (inst) { inst.setAgentStatus(sessionId, status); return; }
    // fallback: 전체 탐색
    for (const i of this.instances.values()) {
      i.setAgentStatus(sessionId, status);
    }
  }

  /** §4 v1.49 — Notification 서브타입 시각 신호 (awaiting_permission).
   *  v1.73 — `awaiting_input`(모래시계) 제거. */
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

  /** §4 v1.50 — PostToolUse `duration_ms` 적재. 세션 소속 인스턴스에 위임. */
  recordToolDuration(sessionId: string, tool: string, durationMs: number): void {
    const inst = this.getInstanceForSession(sessionId);
    if (inst) { inst.recordToolDuration(sessionId, tool, durationMs); return; }
    for (const i of this.instances.values()) i.recordToolDuration(sessionId, tool, durationMs);
  }

  /** §4 v1.50 — PreCompact 카운터 증가. */
  recordCompact(sessionId: string): void {
    const inst = this.getInstanceForSession(sessionId);
    if (inst) { inst.recordCompact(sessionId); return; }
    for (const i of this.instances.values()) i.recordCompact(sessionId);
  }

  /** §5.5 #17-4 v2.36 — 명령 텍스트에서 `/skill-name` 매칭마다 사용 카운트 증분. */
  recordSkillUsageFromCommandText(sessionId: string, text: string): void {
    const inst = this.getInstanceForSession(sessionId);
    if (inst) { inst.recordSkillUsageFromCommandText(text); return; }
    // fallback: 어디에도 매핑 안 되면 무시 (orphan session — 보통 발생 안 함)
  }

  /** §4 v1.50 — Claude.ai 한도 사용률 갱신 (글로벌, statusline 외부 푸시). */
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

  /** §4 v3.62 — Claude 사용량(OAuth 직접 조회) 갱신. 서비스가 정규화한 값을 그대로 보관. */
  setClaudeUsage(info: ClaudeUsageInfo): void {
    this.globalClaudeUsage = info;
  }

  getClaudeUsage(): ClaudeUsageInfo | undefined {
    return this.globalClaudeUsage;
  }

  /** §4 v4.82 — Claude 로그인 상태 갱신(claudeAuthService 가 판정한 값 그대로 보관). */
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

  markAgentIdle(sessionId?: string, purgeNodes = false): void {
    if (sessionId) {
      const inst = this.getInstanceForSession(sessionId);
      if (inst) { inst.markAgentIdle(sessionId, purgeNodes); return; }
      for (const i of this.instances.values()) {
        i.markAgentIdle(sessionId, purgeNodes);
      }
    } else {
      for (const i of this.instances.values()) i.markAgentIdle();
    }
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

  createCustomAgent(
    label: string,
    position?: { x: number; y: number },
    projectName?: string | null,
    options?: { executionMode?: ExecutionMode; provider?: AgentProvider },
  ): BubbleData {
    const inst = projectName
      ? (this.getInstanceByName(projectName) ?? this.primaryInstance())
      : this.primaryInstance();
    if (!inst) {
      // 인스턴스가 없으면 임시 등록
      this.registerProject(process.cwd());
      return this.primaryInstance()!.createCustomAgent(label, position, projectName, options);
    }
    return inst.createCustomAgent(label, position, projectName, options);
  }

  /** §5.3 #10-2 v2.37 — Auto Agent 메타 버블 생성 위임. createCustomAgent 와 동일한 인스턴스 라우팅. */
  createAutoAgent(
    label: string,
    position?: { x: number; y: number },
    projectName?: string | null,
  ): BubbleData {
    const inst = projectName
      ? (this.getInstanceByName(projectName) ?? this.primaryInstance())
      : this.primaryInstance();
    if (!inst) {
      this.registerProject(process.cwd());
      return this.primaryInstance()!.createAutoAgent(label, position, projectName);
    }
    return inst.createAutoAgent(label, position, projectName);
  }

  /** §5.3 #10-2 v2.37 — auto-agent sessionId 로 인스턴스 검색해 요약 메타 조회 */
  getAutoAgentSummary(autoAgentSessionId: string): import('@vibisual/shared').AutoAgentSummary | null {
    for (const inst of this.instances.values()) {
      const s = inst.getAutoAgentSummary(autoAgentSessionId);
      if (s) return s;
    }
    return null;
  }

  /** §5.3 #10-2 v2.37 — 요약 메타 부분 갱신 */
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

  /** §5.3 #10-2 v2.37 — 어느 인스턴스가 이 auto-agent 를 소유하는지 조회 (projectName 조회용) */
  findInstanceByAutoAgentSession(autoAgentSessionId: string): ProjectGraph | null {
    for (const inst of this.instances.values()) {
      if (inst.getAutoAgentSummary(autoAgentSessionId)) return inst;
    }
    // v2.46 — summary 맵이 비어도(체크포인트 복원·인스턴스 재하이드레이션으로 ephemeral 요약 유실)
    // auto 버블이 살아있으면 그 인스턴스를 반환. 버블이 SSOT, 요약은 파생물 → 버블 기준 판정.
    // (processRequest 는 요약이 없으면 새로 만들므로 안전.)
    for (const inst of this.instances.values()) {
      const bubble = inst.getAgentBySession(autoAgentSessionId);
      if (bubble && bubble.bubbleType === 'auto') return inst;
    }
    return null;
  }

  // ── §5.3 #10-3 v4.98 — 검증 런 위임 ────────────────────────────────────────
  //
  // 런은 auto-agent 를 소유한 인스턴스에 산다. 인스턴스를 가로질러 찾는 이유는
  // 프로젝트가 여럿 열려 있을 수 있기 때문이며, 판정(ok/verified)은 전부 ProjectGraph 가 한다.

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

  createPipeline(
    type: import('@vibisual/shared').PipelineType,
    label: string,
    position?: { x: number; y: number },
    projectName?: string | null,
  ): BubbleData {
    const inst = projectName
      ? (this.getInstanceByName(projectName) ?? this.primaryInstance())
      : this.primaryInstance();
    if (!inst) {
      this.registerProject(process.cwd());
      return this.primaryInstance()!.createPipeline(type, label, position, projectName);
    }
    return inst.createPipeline(type, label, position, projectName);
  }

  toggleRootChild(projectName: string, filePath: string, show: boolean): boolean {
    const inst = this.getInstanceByName(projectName) ?? this.primaryInstance();
    return inst ? inst.toggleRootChild(projectName, filePath, show) : false;
  }

  /**
   * §9 "저장은 바뀐 프로젝트만" — `toProjectCheckpoint(name)` 이 읽어 갈 **그 인스턴스**의 변경 카운터.
   * 인스턴스를 못 찾으면 `null` → 호출자는 보수적으로 "저장 필요"로 취급해야 한다(판정 실패가
   * 조용한 미저장이 되면 안 된다).
   */
  getProjectMutationVersion(name: string): number | null {
    const inst = this.getInstanceByName(name) ?? this.primaryInstance();
    return inst ? inst.getMutationVersion() : null;
  }

  /**
   * §9 — **저장 대상 프로젝트의 인스턴스만** seq 를 올린다.
   *
   * 종전 `incrementSeq()` 는 저장할 때마다 열린 인스턴스 전부의 seq 를 올렸는데, `seq` 는 체크포인트
   * 본문에 실리므로 **아무것도 안 바뀐 프로젝트도 직렬화 결과가 매번 달라져** `SaveScheduler` 의
   * 지문 비교(변경 없으면 디스크 쓰기 생략)가 무력화됐다. 저장하는 것만 올리면 그 비교가 실제로 산다.
   */
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

  /**
   * §4 v2.52 — 에이전트 작업 신고 적재. report.agentId 소속 인스턴스로 라우팅.
   * 인스턴스를 못 찾으면(미등록) primary 폴백. 반환값으로 성공 여부 전달.
   */
  addAgentReport(report: import('@vibisual/shared').AgentReport): boolean {
    const inst = this.findInstanceByAgentId(report.agentId) ?? this.primaryInstance();
    if (!inst) return false;
    inst.addAgentReport(report);
    return true;
  }

  /** §5.10 — Brain 주입 이벤트 적재. ev.agentId 소속 인스턴스로 라우팅(addAgentReport 와 동형). */
  addBrainInjection(ev: import('@vibisual/shared').BrainInjectionEvent): boolean {
    const inst = this.findInstanceByAgentId(ev.agentId) ?? this.primaryInstance();
    if (!inst) return false;
    inst.addBrainInjection(ev);
    return true;
  }

  /** §4 v2.60 — 에이전트 질문 카드 적재. report.agentId 소속 인스턴스로 라우팅(addAgentReport 와 동형). */
  addAgentQuestions(q: import('@vibisual/shared').AgentQuestions): boolean {
    const inst = this.findInstanceByAgentId(q.agentId) ?? this.primaryInstance();
    if (!inst) return false;
    inst.addAgentQuestions(q);
    return true;
  }

  /** §4 v2.70 — 에이전트 검수 요청 카드 적재. review.agentId 소속 인스턴스로 라우팅(addAgentReport 와 동형). */
  addAgentReview(review: import('@vibisual/shared').AgentReview): boolean {
    const inst = this.findInstanceByAgentId(review.agentId) ?? this.primaryInstance();
    if (!inst) return false;
    inst.addAgentReview(review);
    return true;
  }

  /** §4 v2.84 — 에이전트 번호 목록 정렬 카드 적재. list.agentId 소속 인스턴스로 라우팅(addAgentReport 와 동형). */
  addAgentList(list: import('@vibisual/shared').AgentList): boolean {
    const inst = this.findInstanceByAgentId(list.agentId) ?? this.primaryInstance();
    if (!inst) return false;
    inst.addAgentList(list);
    return true;
  }

  /** §7.11 v2.29 — 에이전트 서버 iframe 신고. agentId 소속 인스턴스로 라우팅 후 해당 세션에 위성 생성. */
  reportAgentIframe(agentId: string, url: string): boolean {
    const inst = this.findInstanceByAgentId(agentId);
    if (!inst) return false;
    return inst.reportIframeFromAgent(agentId, url);
  }

  /** §4 v3.21 — 에이전트 피드백 upsert. feedback.agentId 소속 인스턴스로 라우팅(addAgentReport 와 동형). */
  setAgentFeedback(feedback: import('@vibisual/shared').AgentFeedback): boolean {
    const inst = this.findInstanceByAgentId(feedback.agentId) ?? this.primaryInstance();
    if (!inst) return false;
    inst.setAgentFeedback(feedback);
    return true;
  }

  /** §4 v3.21 — 에이전트 피드백 철회 (해당 target 의 기존 평가 제거). */
  removeAgentFeedback(agentId: string, targetType: string, targetId: string): boolean {
    const inst = this.findInstanceByAgentId(agentId) ?? this.primaryInstance();
    if (!inst) return false;
    return inst.removeAgentFeedback(agentId, targetType, targetId);
  }

  /** §4 v3.21 — 한 에이전트의 피드백 목록 (스폰 다이제스트 주입/distill 용). */
  getAgentFeedbacksForAgent(agentId: string): import('@vibisual/shared').AgentFeedback[] {
    const inst = this.findInstanceByAgentId(agentId);
    return inst ? inst.getAgentFeedbacksForAgent(agentId) : [];
  }

  // ─── §5.5 #17-11 v3.79 — 세션 반복 실행(루프) ───
  //
  // 키가 subAgentId(세션 탭)라 agentId 로 인스턴스를 찾을 수 없는 조회(getSessionLoop 등)는
  // 인스턴스를 순회한다 — 루프 수는 열린 탭 수 수준이라 순회 비용이 무의미하다.

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

  // ─── §5.5 #17-28 — 컨텍스트 주입원 오버라이드 ───
  //
  // 주입 게이트가 **매 턴** 부르는 자리라 조회는 싸야 한다. 인스턴스 순회는 열린 프로젝트 수(보통 1~3)
  // 수준이고 각 인스턴스 조회는 메모리 맵 읽기뿐이라 파일 접근이 없다.

  /** 오버라이드 설정. 소유 인스턴스(에이전트 기준)로 라우팅, 없으면 primary. */
  setContextOverride(
    scope: { agentId?: string; projectKey?: string; subAgentId?: string },
    sourceId: string,
    enabled: boolean | null,
  ): void {
    const inst = (scope.agentId ? this.findInstanceByAgentId(scope.agentId) : null) ?? this.primaryInstance();
    inst?.setContextOverride(scope, sourceId, enabled);
  }

  /** 한 층의 오버라이드를 통째로 비운다. 어느 인스턴스든 지운 게 있으면 true. */
  clearContextOverrides(scope: { agentId?: string; projectKey?: string; subAgentId?: string }): boolean {
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

  /**
   * 열린 인스턴스 전체의 오버라이드 합집합 — 게이트와 화면이 같은 것을 본다.
   * 인스턴스마다 키 공간(프로젝트 키·세션 id)이 겹치지 않으므로 단순 합치기로 충분하다.
   */
  getContextOverrides(): import('@vibisual/shared').ContextOverrides | undefined {
    let out: import('@vibisual/shared').ContextOverrides | undefined;
    for (const inst of this.instances.values()) {
      const one = inst.getContextOverrides();
      if (!one) continue;
      if (!out) {
        out = { projects: { ...one.projects }, sessions: { ...one.sessions }, updatedAt: one.updatedAt };
        continue;
      }
      Object.assign(out.projects, one.projects);
      Object.assign(out.sessions, one.sessions);
      if (one.updatedAt > out.updatedAt) out.updatedAt = one.updatedAt;
    }
    return out;
  }

  // ─── §5.5 #17-17 v4.46 — 세션 목표(Goal) ───
  //
  // 키가 subAgentId(세션 탭)라 agentId 로 인스턴스를 찾을 수 없는 조회는 루프와 동일하게 순회한다
  // (목표 수는 열린 탭 수 수준이라 순회 비용이 무의미하다).

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

  /**
   * §5.5 #17-17 v4.50 — 세션이 세운 `TodoWrite` 계획을 그 세션의 목표 창으로 옮긴다.
   * 목표가 없으면 그 순간 만들고, 있으면 체크리스트를 계획에 맞춰 갱신한다.
   * 키가 subAgentId 라 소유 인스턴스를 찾아 라우팅한다(없으면 agentId 기준 인스턴스).
   */
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

  /**
   * §5.5 #17-17 ⑨ v4.59 — 명령이 세션 탭으로 발사되는 순간 목표 카드를 세운다(계획 대기 ❌).
   * 라우팅 규칙은 계획 경로와 동일 — 이미 목표를 가진 인스턴스가 있으면 그쪽, 없으면 agentId 기준.
   */
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
      const inst =
        this.findInstanceByAgentId(pos.id) ?? this.findInstanceByNodeId(pos.id);
      inst?.updateBubblePosition(pos.id, pos.x, pos.y);
    }
  }

  removeBubble(nodeId: string, opts: { force?: boolean; purgeTaskEdges?: boolean } = {}): void {
    // 클라이언트가 위성을 렌더할 때 ID 에 'sat-' prefix 를 붙이므로 strip 후 매칭.
    const normalized = nodeId.startsWith('sat-') ? nodeId.slice(4) : nodeId;
    for (const inst of this.instances.values()) {
      if (inst.hasAgentId(normalized) || inst.hasNodeId(normalized) || inst.hasSatelliteId(normalized)) {
        inst.removeBubble(normalized, opts);
        return;
      }
    }
    logger.warn(`ProjectGraphManager.removeBubble: node not found id="${nodeId}"`);
  }

  // ─── §5.10 Project Brain — 커스텀 에이전트 휴지통 위임 ───

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

  // ─── §5.10 Project Brain — 카드 서비스 라우팅 ───

  /** 프로젝트명(옵션)의 브레인 루트 경로를 해소. 없으면 primary 루트. */
  resolveBrainRoot(projectName?: string): string | null {
    const inst = projectName
      ? (this.getInstanceByName(projectName) ?? this.primaryInstance())
      : this.primaryInstance();
    if (!inst) return this.getRoot();
    const info = (projectName ? inst.getProjectByName(projectName) : null) ?? inst.getPrimaryProject();
    return info?.path ?? inst.getRoot() ?? this.getRoot();
  }

  /** 브레인 카드가 REST 로 바뀌었을 때 해당 인스턴스의 스냅샷 캐시 무효화(요약 재계산 유도). */
  notifyBrainChanged(projectName?: string): void {
    const inst = projectName
      ? (this.getInstanceByName(projectName) ?? this.primaryInstance())
      : this.primaryInstance();
    inst?.notifyBrainChanged();
  }

  /** 모든 인스턴스의 스냅샷 캐시 무효화(주기 stale sweep 등 프로젝트 특정이 없을 때). */
  notifyBrainChangedAll(): void {
    for (const inst of this.instances.values()) inst.notifyBrainChanged();
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

  /** preserve-pin 토글 (§2.4 v1.28). null=대상 없음, boolean=토글 후 값. */
  togglePreservePinned(nodeId: string): boolean | null {
    // §7.11 v2.4 — hasAgentId/hasNodeId 가드 제거: iframe 위성(persistSatellites)은
    // agent 도 node 도 아니라 그 가드에서 걸러져 토글이 닿지 못했다. 인스턴스
    // togglePreservePinned 가 nodes/agents/persistSatellites 를 모두 뒤지고 미발견 시
    // null 을 부작용 없이 반환하므로, 비매칭 인스턴스 호출은 안전한 no-op 이다.
    for (const inst of this.instances.values()) {
      const result = inst.togglePreservePinned(nodeId);
      if (result !== null) return result;
    }
    return null;
  }

  /** preserve-pin 여부 조회 (§2.4 v1.28). 대상 없으면 false. */
  isPreservePinned(nodeId: string): boolean {
    for (const inst of this.instances.values()) {
      if (inst.isPreservePinnedById(nodeId)) return true;
    }
    return false;
  }

  toggleSatellite(folderPath: string, filePath: string, show: boolean): boolean {
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

  toggleFolderChild(parentPath: string, filePath: string, show: boolean): boolean {
    for (const inst of this.instances.values()) {
      const ok = inst.toggleFolderChild(parentPath, filePath, show);
      if (ok) return true;
    }
    return false;
  }

  listFolderFiles(nodePath: string): FolderFileEntry[] | null {
    for (const inst of this.instances.values()) {
      const result = inst.listFolderFiles(nodePath);
      if (result !== null) return result;
    }
    return null;
  }

  resolveAbsolutePath(nodePath: string): string | null {
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
  /**
   * §3.2.3 — 보존 정책 정리를 모든 인스턴스에 돌리기 위한 접근자.
   * 읽기 전용 순회 용도이며, 인스턴스 자체를 밖에서 보관하지 말 것(unload 시 유령 참조가 된다).
   */
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

  /** 탭으로 노출되는(=하이드레이트 + top-level + 비hidden) 프로젝트 목록.
   *  스냅샷 빌더의 `visibleProjects`(projectGraph: `!hiddenProjects.has` + `!parentProjectPath`)와
   *  동일 기준 — `openProjects` 재조정에 사용. hidden 판정은 **인스턴스 SSOT**(`inst.isProjectHidden`)
   *  로 일원화한다(Manager 의 `hiddenProjects` 는 휘발성이라 재시작 후 비어 있음). */
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
  /**
   * §5.11 v4.65 — 지금 떠 있는 인스턴스들의 루트 경로 목록(중복 제거).
   *
   * 스냅샷 provider 가 프로젝트 목록을 알아야 하는데, 그 자리에서 `getSnapshot()` 을 부르면 **자기 자신을
   * 다시 부르는 셈**이라 쓸 수 없다. 그래서 스냅샷을 만들지 않고 루트만 모아 준다.
   */
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

  /** 인스턴스가 워크트리(부모에 흡수돼야 함)인지 — orphan/유령 감지용.
   *  (1) key 가 `.claude/worktrees/` 경로 패턴이거나(기존),
   *  (2) 인스턴스 루트(key 경로)에 등록된 ProjectInfo 가 `parentProjectPath` 를 가진
   *      git-linked 워크트리(임의 위치, `--isolation worktree` 산출물)면 true.
   *  resolveProjectRoot(A-1 확장)이 신규 생성을 막지만, 확장 전 런타임에 생성된 인스턴스와
   *  git 해석 성공분(name=`agent-<hex>`)을 저장 순회·스냅샷에서 함께 제외한다. */
  private isWorktreeInstance(key: string, inst: ProjectGraph): boolean {
    if (this.isWorktreeInstanceKey(key)) return true;
    return !!inst.getProjectInfoByPath(key)?.parentProjectPath;
  }

  /** 잘못된 인스턴스에 저장된 TaskEdge 를 소스 에이전트 프로젝트의 인스턴스로 이관.
   *  과거 `createTaskEdge` 가 무조건 primaryInstance 로 라우팅하던 버그로 worktree 가 primary 일
   *  때 Vibisual 엣지가 worktree 인스턴스에 쌓이거나 그 반대가 발생함 → 해당 프로젝트의 scoped
   *  checkpoint 필터에서 탈락 → 저장 유실. 기동 시 한 번 호출해 위치를 바로잡는다.
   *  반환: 이관된 엣지 수. */
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

  // ─── §9 스코프드 스냅샷 구독 ─────────────────────────────────────────────────
  //
  // 창(renderer webContents · 모바일 소켓)마다 "지금 내가 그리는 프로젝트"를 선언하고, 서버는
  // 그 **합집합**만 무거운 슬라이스에 싣는다. 실측(2026-08-19 · 열린 탭 7개 · 보는 탭 1개):
  // 브로드캐스트 3.31MB 중 2.68MB(81%)가 아무도 안 보는 프로젝트 몫이었다.
  //
  // ⚠ **아무도 선언하지 않았으면 전부 보낸다.** 침묵(구버전 클라·부팅 직후·선언 전 첫 스냅샷)이
  //   축소로 해석되면 화면이 빈 채로 굳는다 — 최적화가 기능을 이기지 않게 하는 안전 기본값.
  /** 클라이언트(창) → 그 창이 필요한 프로젝트 표시명 집합. 키는 conn 객체 자체(창 정체성). */
  private clientScopes = new Map<object, Set<string>>();

  /** §9 배경 탭 유휴 해제 — 표시명 → 마지막으로 어떤 창의 구독 범위에 들어 있던 시각(epoch ms). */
  private lastInScopeAt = new Map<string, number>();
  /** §9 — 서버 기동 시각. "이 세션에서 한 번도 본 적 없는" 프로젝트의 유휴 기준점. */
  private readonly bootedAt = Date.now();
  /** §9 — 이 세션에서 자동 hydrate 가 실패한 프로젝트(같은 실패를 매 선언마다 되풀이하지 않는다). */
  private autoHydrateFailed = new Set<string>();

  /**
   * §9 — 한 창의 구독 범위를 갱신한다. 빈 배열도 유효한 선언("나는 지금 아무것도 안 본다").
   *
   * 선언은 곧 "지금 이걸 본다"는 신호이므로 두 가지를 함께 한다:
   *  · 유휴 해제 타이머의 기준 시각(`lastInScopeAt`)을 지금으로 당긴다.
   *  · 그 프로젝트가 stub(=내려가 있음)이면 **자동으로 다시 올린다** — §9 "탭을 클릭하면
   *    되살아난다"의 실행 지점이다(사용자가 [불러오기]를 한 번 더 누르게 하지 않는다).
   */
  setClientProjectScope(client: object, projects: string[]): void {
    const names = projects.filter((p) => typeof p === 'string' && p.length > 0);
    this.clientScopes.set(client, new Set(names));
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
   * §9 배경 탭 유휴 해제 — 아무 창도 안 보고 있고, 아무 일도 하지 않으며, 마지막으로 본 지
   * `idleMs` 가 지난 프로젝트를 stub 으로 내려놓는다(`unloadProject` = 저장 후 메모리 해제).
   *
   * 안 내리는 경우(하나라도 걸리면 그대로 둔다):
   *  · `idleMs <= 0` — 사용자가 이 정리를 껐다(§3.2.3 "0 = 무제한" 규약).
   *  · **선언한 창이 하나도 없다** — 무엇을 보고 있는지 알 수 없으면 아무것도 내리지 않는다.
   *  · 지금 어떤 창의 구독 범위 안이다 / 일하는 것이 있다(`hasRunningWork`).
   *  · 마지막 활동 또는 마지막으로 본 시각이 아직 `idleMs` 안이다.
   *
   * @returns 내려놓은 프로젝트 표시명 목록(호출자가 로그·브로드캐스트에 쓴다)
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
   * 탭으로 보이는(비-worktree · 비-hidden) 인스턴스 목록.
   *
   * v1.34: hidden 판정은 ProjectGraph 인스턴스 SSOT 기준 (체크포인트에 저장되는 쪽).
   * Manager 의 hiddenProjects 는 휘발성이라 서버 재시작 후 빈 채로 복원됨 → 인스턴스 조회로 일원화.
   *
   * §9 — 스냅샷과 배경 탭 유휴 해제가 **같은 목록**을 봐야 "화면에 있는 것"과 "내려도 되는 것"의
   * 기준이 갈리지 않는다. 그래서 한 곳에서만 만든다.
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
   * **서버 내부용 전체 스냅샷** — 구독 범위를 적용하지 않는다.
   *
   * ⚠ 이 구분이 §9 스코프드 구독의 안전선이다. REST 라우트·명령 dispatch·로그 스트리머 같은
   *   내부 소비처가 범위로 좁혀진 스냅샷에서 무언가를 찾으면, 배경 프로젝트의 에이전트를
   *   "없다"고 판정한다(= 최적화가 아니라 기능 손상). 좁히는 것은 **전선으로 나가는 것**뿐이므로
   *   범위는 `getBroadcastSnapshot()` 에만 적용한다.
   */
  getSnapshot(): GraphSnapshot {
    return this.buildSnapshot(null);
  }

  /**
   * §9 — **브로드캐스트로 나갈 스냅샷**. 붙어 있는 창들의 구독 범위 합집합만 무거운 슬라이스에 싣는다.
   * 선언한 창이 없으면 전체와 같다(안전 기본값).
   */
  getBroadcastSnapshot(): GraphSnapshot {
    return this.buildSnapshot(this.getEffectiveProjectScope());
  }

  private buildSnapshot(scope: Set<string> | null): GraphSnapshot {
    const visibleInstances = this.visibleInstanceList();

    // B 진단(§3.2.2) — 라이브 스냅샷은 visibleInstances(비-worktree · 비-hidden)만 병합하므로,
    //   커스텀 에이전트가 worktree/hidden 인스턴스에 얹혀 있으면 "작업 중 버블이 사라진" 것처럼 보인다
    //   (사용자 보고 증상). 그런 유령 위치를 발견하면 sessionId 당 1회 경고해 실제 발화 위치를 확정한다.
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

    // v1.63: 식별=path, 이름=표시. 같은 basename 다른 경로 동시 hydrate 시 mergeSnapshots
    // 의 이름 키 충돌로 한 프로젝트가 소실되던 버그(§3.5) — 머지 전에 인스턴스별로
    // 전역 유일 표시명으로 relabel 하면 이름 키 맵(projects/agentProjects/…)이 충돌-프리.
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
      const snap = inst.getSnapshot();
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
      for (const inst of visibleInstances) {
        activeAgentCountAll += inst.getActiveAgentCount();
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
              }
            : counts;
        }
      }
      snapshot = {
        ...snapshot,
        projects: projectsAll,
        projectAgentCounts: agentCounts,
        activeAgentCount: activeAgentCountAll,
      };
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

    // §5.11 v4.65 — 플러그인 집행 실측. **인스턴스 병합이 끝난 뒤** 얹는다(프로젝트 키가 이미 들어 있는
    //   값이라 병합 대상이 아니며, 여기서 넣으면 `mergeSnapshots` 에 필드를 빠뜨려 다중 프로젝트에서만
    //   조용히 사라지는 부류의 사고가 원천적으로 생기지 않는다).
    if (this.pluginFactsProvider) {
      const facts = this.pluginFactsProvider();
      if (facts && Object.keys(facts).length > 0) {
        snapshot = { ...snapshot, pluginFacts: facts };
      }
    }

    // stub 프로젝트 합성 — v1.63: 충돌 판정은 **경로(projectId)** 기준. 같은 경로가
    // hydrated 면 그 stub 은 동일 프로젝트라 drop(hydrated 우선). 같은 basename·다른 경로는
    // 충돌이 아니라 둘 다 노출(위 displayNames 로 유일화). stub 키·project.name 도 표시명으로 통일.
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
    snapshot = { ...snapshot, appState: loadAppState() };

    // §4 v1.50 — 글로벌 rateLimits 주입 (사용자 단위, 프로젝트 무관)
    if (this.globalRateLimits) {
      snapshot = { ...snapshot, rateLimits: this.globalRateLimits };
    }

    // §4 v3.62 — 글로벌 Claude 사용량(OAuth 직접 조회) 주입. 한도는 사용자 단위라 프로젝트 무관.
    if (this.globalClaudeUsage) {
      snapshot = { ...snapshot, claudeUsage: this.globalClaudeUsage };
    }

    // §4 v4.82 — 글로벌 Claude 로그인 상태 주입. 계정도 머신 단위라 프로젝트 무관.
    if (this.globalClaudeAuth) {
      snapshot = { ...snapshot, claudeAuth: this.globalClaudeAuth };
    }

    // §4 (첫 실행 설치 온보딩) — CLI 설치 판정 주입. 설치도 기기 단위라 프로젝트 무관.
    if (this.globalClaudeSetup) {
      snapshot = { ...snapshot, claudeSetup: this.globalClaudeSetup };
    }

    // §4 v1.98 — 글로벌 진단 에러 로그 주입 (프로젝트 무관, 런타임 캐시)
    const diagLog = diagnosticService.getLog();
    if (diagLog.length > 0) {
      snapshot = { ...snapshot, diagnosticLog: diagLog };
    }

    // §4 v2.38 — 모델 레지스트리 주입 (클라 AgentConfigPopup 버전 sub-드롭다운 데이터)
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

    // §4 v2.42 — 사용자 글로벌 옵션 주입 (Options 창 데이터)
    snapshot = { ...snapshot, userDefaults: userDefaultsService.get() };

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

  /** §7.11 v2.22 — 모든 인스턴스에서 ServerEntry id 의 owning session 정보 lookup. */
  findServerOwnerSession(serverId: string): { sessionId: string; cwd: string | undefined } | null {
    for (const inst of this.instances.values()) {
      const found = inst.findServerOwnerSession(serverId);
      if (found) return found;
    }
    return null;
  }

  /** §7.11 v2.23 — respawn 직후 owning-shell 분리 (모든 인스턴스에 idempotent 전파). */
  noteIframeRespawnedByServerId(serverId: string): boolean {
    let changed = false;
    for (const inst of this.instances.values()) {
      if (inst.noteIframeRespawnedByServerId(serverId)) changed = true;
    }
    return changed;
  }

  /** /api/stop-server 호출 시 iframe 위성 iframeAlive=false 즉시 플립 (§7.11 v1.29) */
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

  /** §5.3 #12-1 v1.91 — 권한 승인 대기 진입/해제 (모든 인스턴스에 idempotent 전파). */
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

  /** Task Edge 생성. SSOT §3.5 프로젝트 독립성 + §5.7 #26 worktree 독립 세션 — 소스/타겟이 다른 프로젝트면 거부. v1.18 고급 옵션 지원. */
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
        // v1.32 — returnFormat='both' + kind='command' 이면 artifact 자매 엣지 생성
        inst.syncBundleForReturnFormat(edge.id);
        // v1.54 — kind='critique' + critiqueAuthority='force-rework' 이면 auto-rework 자매 엣지 생성
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
    for (const inst of this.instances.values()) {
      const result = inst.updateTaskEdge(id, updates);
      if (result) {
        const isPrimary = (result.bundleRole ?? 'primary') === 'primary';
        // v1.32 — returnFormat 또는 kind 변경 시 artifact 번들 동기화 (primary 엣지 기준으로만)
        if (isPrimary && (updates.returnFormat !== undefined || updates.kind !== undefined)) {
          inst.syncBundleForReturnFormat(result.id);
        }
        // v1.54 — kind 또는 critiqueAuthority 변경 시 auto-rework 번들 동기화 (primary 엣지 기준으로만)
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

  /** Task Edge 삭제. v1.32 — 번들에 속한 엣지면 자매도 함께 제거. */
  deleteTaskEdge(id: string): boolean {
    for (const inst of this.instances.values()) {
      if (inst.deleteTaskEdgeCascade(id)) return true;
    }
    return this.taskEdges.delete(id);
  }

  /** v1.32 — edgeId → edge 조회 (dispatch/result 경로용) */
  getTaskEdge(id: string): TaskEdge | undefined {
    for (const inst of this.instances.values()) {
      const edge = inst.getTaskEdge(id);
      if (edge) return edge;
    }
    return this.taskEdges.get(id);
  }

  /** v1.32 — 같은 번들의 artifact 자매 엣지 조회 */
  getBundleArtifact(primaryEdgeId: string): TaskEdge | undefined {
    for (const inst of this.instances.values()) {
      const a = inst.getBundleArtifact(primaryEdgeId);
      if (a) return a;
    }
    return undefined;
  }

  /** v1.54 — 같은 번들의 auto-rework 자매 엣지 조회 */
  getBundleAutoRework(primaryEdgeId: string): TaskEdge | undefined {
    for (const inst of this.instances.values()) {
      const a = inst.getBundleAutoRework(primaryEdgeId);
      if (a) return a;
    }
    return undefined;
  }

  /** v1.32 — 소스 에이전트 outbound 엣지 (시스템 프롬프트 주입용) */
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

  /** v1.55 — `targetAgentId === agentId` 인 critique primary 엣지 조회 (타겟 완료 시 watcher 발사용) */
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

  /** v1.55 — critique 사이클 카운터 조정 */
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

  /** v1.55 — critique 강등 (force-rework → comment-only) + 자매 auto-rework 엣지 동기 제거 */
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

  // ─── Comment Box (v1.45) — 프로젝트별 인스턴스에 저장 ───

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

  // ─── §5.5 #17-20 ⑩ v4.94 공통 디버그 층 — 중단점 ─────────────────────────

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

  // ─── §5.9 화면/프로그램 캡처 버블 — 프로젝트별 인스턴스에 저장 ───

  /** 지정 projectName 소속 인스턴스에 캡처 버블 생성. 인스턴스 없으면 primary 폴백. */
  // ─── §5.13 v4.45 내부 앱 버블 위임 ───

  createAppBubble(input: {
    projectName: string;
    appId: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    title?: string;
    ref?: string;
  }): AppBubble | null {
    const inst = this.getInstanceByName(input.projectName) ?? this.primaryInstance();
    if (!inst) return null;
    return inst.createAppBubble(input);
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

  // ─── §5.14 v4.62 — 플레이 버블 위임 ───

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

  /**
   * 이 에이전트가 어느 랩의 어느 변형인지 — 전 인스턴스를 훑는다.
   * 변형 카드는 워크트리 인스턴스 소속이고 랩 표지는 부모 인스턴스에 있으므로 한쪽만 봐선 못 찾는다.
   */
  findLabVariantByAgent(agentId: string): { run: LabRun; variant: LabVariant } | undefined {
    for (const inst of this.instances.values()) {
      const hit = inst.findLabVariantByAgent(agentId);
      if (hit) return hit;
    }
    return undefined;
  }

  // ─── §5.22 — 권한·감사 경계 위임 ───

  /**
   * 승인 창구가 원장에 먼저 적는 줄. 그 프로젝트를 든 인스턴스를 찾지 못하면
   * 에이전트를 든 인스턴스로 되짚는다(워크트리 이름이 표시명과 어긋나는 자리).
   */
  recordAuditCall(input: AuditRecordInput): string | null {
    const inst = this.getInstanceByName(input.projectName)
      ?? (input.agentId ? this.instanceForAgent(input.agentId) : null)
      ?? this.primaryInstance();
    if (!inst) return null;
    return inst.recordAuditCall(input);
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

  /** 조회용 원장 한 장(REST). */
  getAuditLog(projectName: string): ProjectAuditLog | undefined {
    for (const inst of this.instances.values()) {
      const log = inst.getAuditLog(projectName);
      if (log) return log;
    }
    return undefined;
  }

  /** agentId 를 든 인스턴스(감사 원장이 그 인스턴스 안에 있으므로 되짚기용). */
  private instanceForAgent(agentId: string): ProjectGraph | null {
    for (const inst of this.instances.values()) {
      if (inst.getAgentProjectName(agentId)) return inst;
    }
    return null;
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

  /**
   * 이 에이전트가 지금 어느 선반 줄의 프롬프트를 처리 중인지 — 전 인스턴스를 훑는다.
   * 선반은 부모 인스턴스에 있고 카드는 워크트리 인스턴스일 수 있으므로 한쪽만 봐선 못 찾는다.
   */
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


  /**
   * §5.14 4단 계단 ③ — 이 프로젝트에서 **실제로 떠 있던** 명령들.
   *
   * 탐지기가 가장 세게 믿는 근거라, 여기서 주는 목록이 곧 "에이전트가 한 번 켜 준 것을
   * 우리가 기억한다"는 약속이다. `runningServers`(죽은 entry 도 보존된다)를 그대로 읽는다.
   */
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

  // ─── §5.3 #28 v1.47 — 콘티 위임 ───

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

  /** §5.3 #28 v1.59 — 콘티 frame 순서 변경. */
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

  /**
   * §5.3 #28 (L) v1.58 — 콘티 frames 통째 교체 (수정 케이스).
   * 콘티가 속한 인스턴스를 찾아 위임.
   */
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

  /** §5.3 #28 (L) v1.58 — 인플라이트 콘티 작업 조회. */
  getActiveContiWork(agentId: string): ActiveContiWork | undefined {
    const inst = this.getInstanceByAgentId(agentId);
    return inst?.getActiveContiWork(agentId);
  }

  /**
   * §5.3 #28 (L) v1.58 — 콘티 작업 시작 (workId 발급).
   * 에이전트가 속한 인스턴스에 트래커 항목 등록. 이미 있으면 기존 반환.
   */
  startContiWork(agentId: string, source: ContiWorkSource): ActiveContiWork | null {
    const inst = this.getInstanceByAgentId(agentId);
    if (!inst) return null;
    return inst.startContiWork(agentId, source);
  }

  /** §5.3 #28 (L) v1.58 — 사용자 명시 새 콘티 트리거 — 기존 트래커 항목 폐기 후 새 workId. */
  resetContiWork(agentId: string, source: ContiWorkSource): ActiveContiWork | null {
    const inst = this.getInstanceByAgentId(agentId);
    if (!inst) return null;
    return inst.resetContiWork(agentId, source);
  }

  /** §5.3 #28 (L) v1.58 — 첫 응답으로 만들어진 Conti 의 id 를 트래커에 머지. */
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

  /**
   * agentId → 소속 프로젝트의 디스크 path. 어느 인스턴스가 소유하든 찾는다.
   * 스킬 목록처럼 "이 에이전트가 속한 프로젝트" 가 권위 기준일 때 사용 — 클라가 보내는
   * 표시명에 의존하지 않아 활성 프로젝트 오염·이름 충돌·미해소에 영향받지 않는다.
   */
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

  /** §5.10 v3.49 — 에이전트가 최근 참조한 파일 경로(피드 related 랭킹 ctx.files, best-effort). 없으면 빈 배열. */
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
   * §5.21 — 열려 있는 모든 인스턴스의 비용·토큰 지도를 한 번 훑는다. 하나라도 바뀌면 true.
   * 모델 단가는 런타임 레지스트리가 SSOT 라 호출부가 넘긴다(§4 v2.38).
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

  /**
   * v1.6 SCENARIO §5.7 #24: SessionStart 훅 시점에 cwd 일치하는 dormant 에이전트를 모두 복원.
   * 모든 인스턴스에 위임 — 복원된 sessionId 목록 평탄화 반환.
   */
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
