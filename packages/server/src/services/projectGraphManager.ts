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
  Conti,
  ContiFrame,
  ContiElement,
  ActiveContiWork,
  ContiWorkSource,
  RateLimitInfo,
} from '@vibisual/shared';
import { DEFAULT_UI_LOCALE } from '@vibisual/shared';
import { ProjectGraph, type ProcessResult } from './projectGraph.js';
import { loadCheckpointByMeta, writeCheckpoint, projectDirForInfo } from './statePersistence.js';
import { appStateAddOpenProject, loadAppState } from './appState.js';
import { diagnosticService } from './diagnosticService.js';
import { logger } from '../logger.js';
import { dbg } from './debugLog.js';

// ─── 유틸 ───

/** 경로 정규화 (대소문자 무시, 슬래시 통일, trailing slash 제거) — projectGraph.ts 49행과 동일 */
function normalize(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
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
    contis: {},
  };
}

/** 두 스냅샷을 병합. 배열은 이어붙이고, Record는 Object.assign으로 합친다. */
function mergeSnapshots(a: GraphSnapshot, b: GraphSnapshot): GraphSnapshot {
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
    // 루트 캔버스 바운딩 박스 — projectName 키로 머지 (b 우선)
    layoutBoundsByProject: { ...(a.layoutBoundsByProject ?? {}), ...(b.layoutBoundsByProject ?? {}) },
    // v1.47 — 콘티 합치기 (contiId 키로 dedup, b 우선)
    contis: { ...(a.contis ?? {}), ...(b.contis ?? {}) },
    // §4 v1.50 — 도구 시간/컴팩션 카운트는 sessionId 키로 dedup (b 우선). rateLimits 는 글로벌.
    recentToolDurations: { ...(a.recentToolDurations ?? {}), ...(b.recentToolDurations ?? {}) },
    compactCounts: { ...(a.compactCounts ?? {}), ...(b.compactCounts ?? {}) },
    rateLimits: b.rateLimits ?? a.rateLimits,
    // §5.5 #17-4 v2.36 — 스킬 사용 카운트는 projectName 1차 키 → 단순 spread 안전.
    // 같은 projectName 이 양쪽에 들어올 가능성 ❌ (각 ProjectGraph 가 primary 하나).
    skillUsageCounts: (() => {
      const av = a.skillUsageCounts;
      const bv = b.skillUsageCounts;
      if (!av && !bv) return undefined;
      return { ...(av ?? {}), ...(bv ?? {}) };
    })(),
  };
}

// ─── v1.63 전역 유일 표시명 (식별=path, 이름=표시) ───

/** projectId 정규화 — appState.normPath / projectGraph.normalize 와 동일 semantics. */
function normPathId(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
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
    // §5.5 #17-4 v2.36 — projectName 1차 키 relabel.
    skillUsageCounts: renameKey(snap.skillUsageCounts),
  };
}

// ─── ProjectGraphManager 클래스 ───

export class ProjectGraphManager {
  /** normalized cwd → ProjectGraph 인스턴스 */
  private instances = new Map<string, ProjectGraph>();

  /** §4 v1.50 — Claude.ai 한도 사용률 (글로벌 1건). 외부 statusline 스크립트가 푸시. */
  private globalRateLimits?: RateLimitInfo;

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
        logger.info(`ProjectGraphManager: auto-hydrating stub for cwd "${rootCwd}"`);
        const result = this.hydrateProject(rootCwd);
        if (result.ok) {
          const hydratedInst = this.instances.get(key);
          if (hydratedInst) return hydratedInst.registerProject(rootCwd);
        } else {
          logger.warn(`ProjectGraphManager: auto-hydrate failed for "${rootCwd}" (${result.reason}) — creating fresh instance`);
        }
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
        this.registerProject(payload.cwd);
        inst = this.instances.get(key) ?? null;
      }
      this.sessionRouting.set(payload.session_id, key);
    }

    if (!inst) {
      logger.warn(`ProjectGraphManager.processHookEvent: no instance for session=${payload.session_id}`);
      dbg('manager.processHookEvent.noInstance', { sessionId: payload.session_id, cwd: payload.cwd, tool: payload.tool_name });
      return null;
    }
    dbg('manager.processHookEvent', {
      sessionId: payload.session_id,
      cwd: payload.cwd,
      tool: payload.tool_name,
      event: payload.hook_event_name,
      routedBy,
      instanceRoot: inst.getRoot(),
    });
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
  ): BubbleData {
    const inst = projectName
      ? (this.getInstanceByName(projectName) ?? this.primaryInstance())
      : this.primaryInstance();
    if (!inst) {
      // 인스턴스가 없으면 임시 등록
      this.registerProject(process.cwd());
      return this.primaryInstance()!.createCustomAgent(label, position, projectName);
    }
    return inst.createCustomAgent(label, position, projectName);
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
      if (this.isWorktreeInstanceKey(key)) continue;
      names.push(...inst.getProjectNames());
    }
    return [...new Set(names)];
  }

  /** 첫 번째 인스턴스의 프로젝트 이름 */
  getPrimaryProjectName(): string | null {
    return this.primaryInstance()?.getPrimaryProjectName() ?? null;
  }

  /** 첫 번째 인스턴스의 루트 경로 */
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
    for (const key of [...this.instances.keys()]) {
      if (this.isWorktreeInstanceKey(key)) {
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

  getSnapshot(): GraphSnapshot {
    // v1.34: hidden 판정은 ProjectGraph 인스턴스 SSOT 기준 (체크포인트에 저장되는 쪽).
    // Manager 의 hiddenProjects 는 휘발성이라 서버 재시작 후 빈 채로 복원됨 → 인스턴스 조회로 일원화.
    const visibleInstances = [...this.instances.entries()]
      .filter(([key]) => !this.isWorktreeInstanceKey(key))
      .map(([, inst]) => inst)
      .filter((inst) => {
        const name = inst.getPrimaryProjectName();
        return name ? !inst.isProjectHidden(name) : true;
      });

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

    const subSnaps = visibleInstances.map((inst) => {
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

    // §4 v1.98 — 글로벌 진단 에러 로그 주입 (프로젝트 무관, 런타임 캐시)
    const diagLog = diagnosticService.getLog();
    if (diagLog.length > 0) {
      snapshot = { ...snapshot, diagnosticLog: diagLog };
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
