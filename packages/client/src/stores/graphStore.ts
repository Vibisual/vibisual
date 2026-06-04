import { create } from 'zustand';
import type { BubbleData, ActivityEdge, BashEntry, ServerEntry, AgentEvent, FileEdit, AgentPhase, ProjectInfo, QueuedCommand, SubAgent, ServerKind, PipelineType, PipelineState, AgentConfig, SubAgentStreamEvent, TaskEdge, TaskEdgeForwardMode, TaskEdgeKind, TaskEdgeMessageFormat, TaskEdgeReturnFormat, TaskEdgePriority, TaskEdgeCritiqueTiming, TaskEdgeCritiqueAuthority, TaskEdgeCommandMode, UiLocale, ProjectMetaSnapshot, AppState, AppStatePatch, CommentBox, Conti, ActiveContiWork, ToolDurationEntry, CompactCount, RateLimitInfo, DiagnosticEntry, AutoAgentSummary, ModelRegistry, UserDefaults, AgentReport, AgentQuestions, AgentReview } from '@vibisual/shared';
import { DEFAULT_UI_LOCALE } from '@vibisual/shared';
import { changeUiLocale } from '../i18n/index.js';
import { calcFileSizeRange } from '../utils/sizeCalc.js';

/**
 * §5.3 #28 v1.48 — IDE TerminalInput 세션 스코프 draft.
 * 세션 탭(`activeSessionId`) 을 넘나들 때 사용자가 치던 텍스트+첨부가 해당 세션에 매여 유지.
 * 키: `${agentId}|${sessionId ?? '__new__'}`. 값: { text, attachments }.
 * (v1.47 `agentInputDrafts` 와 별개 채널 — 그쪽은 외부 트리거 1회 prefill 용.)
 */
export interface AgentSessionInputAttachment {
  tempId: string;
  previewUrl: string;
  serverPath: string;
  uploading: boolean;
  error?: string;
}
export interface AgentSessionInputDraft {
  text: string;
  attachments: AgentSessionInputAttachment[];
}

export function agentSessionInputKey(agentId: string, sessionId: string | null): string {
  return `${agentId}|${sessionId ?? '__new__'}`;
}

/** Task Edge 생성/수정 시 고급 옵션 (v1.18, v1.41 Critique 옵션 추가). 모두 optional. */
export interface TaskEdgeOptions {
  kind?: TaskEdgeKind;
  messageFormat?: TaskEdgeMessageFormat;
  /** v1.48 — 자유 형식 스키마 본문. messageFormat='schema' 일 때 source 가 발신할 양식. */
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
  /** v1.44 — Command 위임 형태 (kind='command' 일 때만 의미). */
  commandMode?: TaskEdgeCommandMode;
}

const API_BASE = '';

const ACTIVE_PROJECT_KEY = 'vibisual:activeProject';
const DEFAULT_TABBAR_KEY = 'vibisual:defaultTabbar';
const DEFAULT_SUBAGENTS_KEY = 'vibisual:defaultSubAgents';
const TAB_PINS_KEY = 'vibisual:tabPins';
const SUBAGENT_LABELS_KEY = 'vibisual:subAgentLabels';
// 서브에이전트 완료 확인(ack) 상태 — 재시작 후에도 "확인함(회색)" 이 유지되도록 localStorage 영속.
// 없으면 부팅 시 메모리 기본값 {} 으로 시작 → idle sub 들이 전부 미확인(녹색)으로 회귀.
const ACK_SUBAGENTS_KEY = 'vibisual:ackSubAgents';

function loadSavedActiveProject(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}

function saveActiveProject(name: string | null): void {
  try {
    if (name) {
      localStorage.setItem(ACTIVE_PROJECT_KEY, name);
    } else {
      localStorage.removeItem(ACTIVE_PROJECT_KEY);
    }
  } catch { /* noop */ }
}

/** projectId 정규화 — 서버 appState(경로키)와 동일 semantics (v1.63). */
function npStore(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* noop */ }
}

// §5.3 #28 v2.69 — IDE TerminalInput 세션별 입력 텍스트 영속화.
// 사용자가 Run 안 누른 입력 텍스트를 창을 닫았다 다시 열거나 앱을 재시작해도
// 세션 키(agentSessionInputKey = `${agentId}|${sessionId}`)별로 유지한다.
// 첨부(blob URL·서버 임시 경로)는 리로드 후 못 살리므로 text 만 저장. 값 = Record<key, string>.
const SESSION_INPUT_DRAFTS_KEY = 'vibisual:sessionInputDrafts';

function loadSessionInputDrafts(): Record<string, AgentSessionInputDraft> {
  const textMap = loadJSON<Record<string, string>>(SESSION_INPUT_DRAFTS_KEY, {});
  const out: Record<string, AgentSessionInputDraft> = {};
  for (const [k, text] of Object.entries(textMap)) {
    if (typeof text === 'string' && text.length > 0) out[k] = { text, attachments: [] };
  }
  return out;
}

function saveSessionInputDrafts(drafts: Record<string, AgentSessionInputDraft>): void {
  const textMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(drafts)) {
    if (v.text.length > 0) textMap[k] = v.text;
  }
  saveJSON(SESSION_INPUT_DRAFTS_KEY, Object.keys(textMap).length > 0 ? textMap : null);
}

/**
 * 현재 사용자가 보고 있는 프로젝트 스코프.
 * worktree 버블 드릴다운(`currentFolderId`가 worktree 노드) 중이면 해당 worktree 프로젝트명,
 * 아니면 activeProject. 새 에이전트/파이프라인 생성, 파일 필터 등 "현재 캔버스에 귀속되어야 하는 동작"은 이 값을 써야 한다.
 * SSOT §3.5 프로젝트 독립성 + §5.7 #26 worktree 버블 격리.
 * 컴포넌트에서는 `useGraphStore(selectEffectiveProject)` 형태의 selector로 사용.
 */
export function selectEffectiveProject(state: { currentFolderId: string | null; worktreeProjects: Record<string, string>; activeProject: string | null }): string | null {
  const { currentFolderId, worktreeProjects, activeProject } = state;
  if (currentFolderId && worktreeProjects[currentFolderId]) return worktreeProjects[currentFolderId];
  return activeProject;
}

/** iframe 탭 정보 */
export interface IframeTab {
  id: string;
  url: string;
  label: string;
  serverKind: ServerKind;
}

/** IDE 오버레이 사이드바 뷰 타입 — §5.5 #17-4 v2.32 에서 'skills' 추가 */
export type IDEViewType = 'terminal' | 'files' | 'events' | 'skills';

/** IDE 오버레이 상태 — 프로젝트 단위로 독립적으로 보관 (ideOverlays[projectId]). */
export interface IDEOverlayState {
  /** 열려있는 에이전트 ID (null이면 닫힘) */
  agentId: string | null;
  /** 이 IDE 가 속한 프로젝트 ID. ideOverlays 의 키와 동일 — 일관성 보장용. */
  projectId: string | null;
  /** 현재 선택된 세션(SubAgent) ID (null이면 메인 세션) */
  activeSessionId: string | null;
  /** 사이드바 뷰 */
  activeView: IDEViewType;
  /** 사이드바 접힘 여부 */
  sidebarCollapsed: boolean;
  /** §5.5 #17-1 — 우측 도킹 여부. DetailPanel 좌/우 위치 결정에 사용. */
  dockedRight: boolean;
  /** §5.5 #17-1 — 도킹 폭 (px). DetailPanel 이 우측 도킹된 IDE 를 피해 좌측에 뜰 때 사용. */
  dockWidth: number;
}

/** IDE 닫힘/없음 상태 기본값. selectIDEOverlay 가 미보유 프로젝트에 대해 반환. */
export const DEFAULT_IDE_OVERLAY: IDEOverlayState = {
  agentId: null,
  projectId: null,
  activeSessionId: null,
  activeView: 'terminal',
  sidebarCollapsed: true,
  dockedRight: false,
  dockWidth: 480,
};

/** 현재 활성 프로젝트 탭의 IDE 오버레이 상태를 반환. 없으면 기본값. */
export function selectIDEOverlay(state: {
  ideOverlays: Record<string, IDEOverlayState>;
  activeProject: string | null;
}): IDEOverlayState {
  if (!state.activeProject) return DEFAULT_IDE_OVERLAY;
  return state.ideOverlays[state.activeProject] ?? DEFAULT_IDE_OVERLAY;
}

/** agentId → sessionId (agent.path に格納) */
function findSessionId(agents: BubbleData[], agentId: string): string | null {
  const agent = agents.find((a) => a.id === agentId);
  return agent?.path ?? null;
}

// AgentPhase는 @vibisual/shared에서 import (서버가 계산)
// QueuedCommand는 @vibisual/shared에서 import (서버가 관리)

interface GraphState {
  /** 등록된 프로젝트 (projectName → ProjectInfo). 전역 접근용 */
  projects: Record<string, ProjectInfo>;
  /** stub 상태 프로젝트 메타 (projectName → ProjectMetaSnapshot). hydrate 완료 시 projects로 이동 */
  stubProjects: Record<string, ProjectMetaSnapshot>;
  /** hydrate 요청 중인 프로젝트 이름 집합 — 응답 전 pending 표시용 */
  hydratingProjects: Record<string, true>;
  agents: BubbleData[];
  topFolders: BubbleData[];
  children: Record<string, BubbleData[]>;
  /**
   * 캔버스가 실제로 최상위 버블로 렌더 중인 노드 id 집합 (BubbleMap.filteredFolders 의 결과).
   * RootFileList 의 "Visible" 판정 SSOT — topFolders 멤버십이 아니라 이 집합을 기준으로 한다.
   * 캔버스 렌더 전용 파생 상태(영속 X).
   */
  canvasVisibleNodeIds: Record<string, true>;
  edges: ActivityEdge[];
  innerEdges: Record<string, ActivityEdge[]>;
  /** 폴더별 위성 파일 (folder ID → 최근 작업 파일들) */
  satellites: Record<string, BubbleData[]>;
  /** 위성 버블 저장 위치 (sat-{nodeId} → {x, y}) — 서버 동기화 */
  satellitePositions: Record<string, { x: number; y: number }>;
  /** 전체 버블 O(1) 조회 (bubble ID → BubbleData) */
  nodeMap: Record<string, BubbleData>;
  /** Bash 버블별 명령 히스토리 (bash bubble ID → 최신순 엔트리) */
  bashHistory: Record<string, BashEntry[]>;
  /** Bash 버블별 서버 목록 (bash bubble ID → 서버) */
  runningServers: Record<string, ServerEntry[]>;
  /** 에이전트별 활동 기록 (agent ID → 이벤트[]) */
  agentEvents: Record<string, AgentEvent[]>;
  /** 에이전트 → 프로젝트 이름 (agent ID → project basename) */
  agentProjects: Record<string, string>;
  /** 노드 → 프로젝트 이름 (node ID → project basename) */
  nodeProjects: Record<string, string>;
  /** 파일별 수정 기록 (file node ID → 최신순 FileEdit[]) */
  fileEdits: Record<string, FileEdit[]>;
  /** 에이전트별 명령 대기열 (agent ID → queued/executing만) */
  queuedCommands: Record<string, QueuedCommand[]>;
  /** 에이전트별 완료/에러 명령 아카이브 (agent ID → completed/error, Results 표시용) */
  completedCommands: Record<string, QueuedCommand[]>;
  /** 에이전트별 subagent 목록 (agent ID → SubAgent[]) */
  subAgents: Record<string, SubAgent[]>;
  /** 사용자가 확인(ack)한 서브에이전트 id 집합. 탭 도트 색을 녹색(완료·미확인) → 회색(확인됨) 으로 전환할 때 사용.
   *  active → idle 전이 시 자동 해제(다음 완료는 다시 녹색).
   *  탭 클릭/메인영역 클릭/타이핑 시 set. */
  acknowledgedSubAgents: Record<string, true>;
  /** 낙관적 제거 인텐트 — subId → parentAgentId. 서버 DELETE 왕복/스냅샷 전에 탭을 즉시 감춘다(파생 시 차감). */
  pendingSubAgentRemovals: Record<string, string>;
  /** 낙관적 복원 인텐트 — subId → SubAgent stub. 서버 restore 전에 탭을 즉시 띄운다(파생 시 합산). */
  pendingSubAgentRestores: Record<string, SubAgent>;
  markSubAcknowledged: (subId: string) => void;
  /** 탭 닫기 — 서버 응답 전에 즉시 제거(낙관적). full-snapshot race 에도 유지된다. */
  optimisticRemoveSubAgent: (agentId: string, subAgentId: string) => void;
  /** 히스토리 세션 다시 열기 — 서버 응답 전에 즉시 탭 추가(낙관적). full-snapshot race 에도 유지된다. */
  optimisticRestoreSubAgent: (agentId: string, subAgent: SubAgent) => void;
  /** 인텐트 정리 — 권위 스냅샷이 제거/복원을 반영했을 때 호출. */
  clearPendingSubAgentIntent: (subAgentId: string) => void;
  /** 파이프라인 부모 ID → 자식 에이전트 버블 목록 */
  pipelineChildren: Record<string, BubbleData[]>;
  /** 파이프라인 부모 ID → 파이프라인 상태 */
  pipelines: Record<string, PipelineState>;
  /** 에이전트별 설정 (agent ID → AgentConfig) */
  agentConfigs: Record<string, AgentConfig>;
  /** 에이전트 간 작업 흐름 엣지 (TaskEdge ID → TaskEdge) */
  taskEdges: Record<string, TaskEdge>;
  /** worktree 버블 ID → worktree 프로젝트명. 드릴다운 시 에이전트 필터 전환. */
  worktreeProjects: Record<string, string>;
  /** 프로젝트 이름 → git dirty 여부 (§7.6). 서버 스냅샷 수신. root 버블 dirty dot 렌더용. */
  gitDirty: Record<string, boolean>;
  /** 프로젝트 이름 → git 상태 조회 진행 중 여부 (클라 로컬). root 버블 sweep 이펙트용. */
  gitRefreshing: Record<string, boolean>;
  setGitRefreshing: (projectName: string, refreshing: boolean) => void;
  /** 캔버스가 현재 렌더 중인 최상위 노드 id 목록을 publish (변경 시에만 갱신). */
  setCanvasVisibleNodeIds: (ids: string[]) => void;
  /** v1.38 — paste 첨부 이미지 미리보기 blob URL 레지스트리. key=basename(UUID+확장자), value=blob: URL.
   *  TerminalInput 이 제출 시 등록 → StreamStatusBar 가 실행중 커맨드의 cmd.attachments basename 으로 조회해 표시.
   *  loadSnapshot 에서 active 큐에 없는 basename 은 자동 revoke + 삭제 (커맨드 완료 감지). */
  attachmentPreviews: Record<string, string>;
  registerAttachmentPreview: (basename: string, blobUrl: string) => void;
  /** 현재 보이는 파일 버블들의 크기 범위 (상대 크기 계산용) */
  fileSizeRange: { min: number; max: number };
  addCommand: (agentId: string, text: string, subAgentId?: string | null, attachments?: string[]) => void;
  removeCommand: (agentId: string, commandId: string) => void;
  reorderCommands: (agentId: string, fromIndex: number, toIndex: number) => void;
  createTaskEdge: (sourceAgentId: string, targetAgentId: string, command: string, forwardMode: TaskEdgeForwardMode, templateId: string | null, options?: TaskEdgeOptions) => void;
  updateTaskEdge: (id: string, updates: { command?: string; forwardMode?: TaskEdgeForwardMode } & TaskEdgeOptions) => void;
  deleteTaskEdge: (id: string) => void;
  /** 현재 활성 프로젝트 탭 (null이면 첫 번째) */
  activeProject: string | null;
  /** 현재 활성 프로젝트의 ProjectInfo (activeProject 기반 파생) */
  currentProject: ProjectInfo | null;
  currentFolderId: string | null;
  navStack: string[];
  selectedNodeId: string | null;
  /** 선택 하이라이트(태양 링) 전용 — DetailPanel(selectedNodeId, 더블클릭 지연) 과 분리.
   *  클릭 확정 즉시 set → 이전 선택 링이 지연 없이 바로 페이드아웃. */
  selectIntentId: string | null;
  /** 선택된 Task Edge ID — 엣지 중앙 아이콘 싱글 클릭 시 set. 노드 선택과 배타. */
  selectedTaskEdgeId: string | null;
  selectTaskEdge: (id: string | null) => void;
  /** 선택된 Comment Box ID — DetailPanel 에서 색/텍스트 옵션 편집. 노드/Task Edge 선택과 배타. v1.45 */
  selectedCommentBoxId: string | null;
  selectCommentBox: (id: string | null) => void;
  /** Comment Box 목록 (서버 스냅샷으로 채워짐). 메인 뷰에서 현재 프로젝트 필터로 렌더. */
  commentBoxes: CommentBox[];
  /** §5.3 #28 v1.47 — 콘티 데이터 (contiId → Conti). 에이전트별 패널/보드 렌더. */
  contis: Record<string, Conti>;
  /** §5.3 #28 (L) v1.58 — 콘티 인플라이트 작업 (agentId → ActiveContiWork). "Working…" 인디케이터용. */
  activeContiWork: Record<string, ActiveContiWork>;
  /** §4 v1.50 — 에이전트(session)별 최근 도구 실행 시간 (최대 5건, 최신순). */
  recentToolDurations: Record<string, ToolDurationEntry[]>;
  /** §4 v1.50 — 에이전트(session)별 컨텍스트 컴팩션 누적 카운트 + 마지막 시각. */
  compactCounts: Record<string, CompactCount>;
  /** §5.5 #17-4 v2.36 — 프로젝트별 스킬 사용 카운트 (projectName → skillName → count). SkillsView 정렬·배지. */
  skillUsageCounts: Record<string, Record<string, number>>;
  /** §5.3 #10-2 v2.37 — Auto Agent 가 spawn 한 군의 요약 메타 (autoAgentSessionId → summary). */
  autoAgentSummaries: Record<string, AutoAgentSummary>;
  /** §4 v2.52 — 에이전트 작업 신고 (agentId → AgentReport[]). IDE 색 구분 카드. */
  agentReports: Record<string, AgentReport[]>;
  /** §4 v2.60 — 에이전트 질문 카드 (agentId → AgentQuestions[]). IDE 질문 카드. */
  agentQuestions: Record<string, AgentQuestions[]>;
  /** §4 v2.70 — 에이전트 검수 요청 카드 (agentId → AgentReview[]). IDE 검수 카드. */
  agentReviews: Record<string, AgentReview[]>;
  /** §4 v2.38 — 동적 모델 레지스트리 (서버 modelRegistryService 가 시드+/v1/models 머지 후 push). */
  modelRegistry: ModelRegistry | null;
  /** §4 v2.42 — 사용자 글로벌 옵션 (Options 창 SSOT). */
  userDefaults: UserDefaults | null;
  /** §4 v1.50 — Claude.ai 한도 사용률 (글로벌, 외부 statusline 푸시). */
  rateLimits: RateLimitInfo | null;
  /** §4 v1.98 — 진단 에러 로그 (글로벌 ring buffer, append 순). DebugPanel 에러 뷰어용. */
  diagnosticLog: DiagnosticEntry[];
  /**
   * §5.3 #28 v1.47 — IDE 오버레이 입력창에 미리 채워둘 draft 텍스트 (agentId → text).
   * "새 콘티 생성" 같은 트리거가 setAgentInputDraft 로 시드 프롬프트를 넣으면
   * IDE 오버레이의 TerminalInput 이 mount/agent 변경 시 consume 한다.
   * 사용자 작성 흐름이 핵심이라 자동 send ❌ — 사용자가 직접 Send 눌러야 부모 에이전트로 dispatch.
   */
  agentInputDrafts: Record<string, string>;
  setAgentInputDraft: (agentId: string, text: string) => void;
  /** TerminalInput 이 hydrate 후 호출 — 동일 텍스트가 다시 prefill 되지 않도록 정리 */
  consumeAgentInputDraft: (agentId: string) => string | undefined;
  /**
   * §5.3 #28 v1.48 — IDE TerminalInput 세션 스코프 draft (text + attachments).
   * 세션 탭 전환 시 사용자가 치던 내용 유지. 키는 agentSessionInputKey(agentId, sessionId).
   */
  agentSessionInputs: Record<string, AgentSessionInputDraft>;
  setAgentSessionInputText: (agentId: string, sessionId: string | null, text: string) => void;
  updateAgentSessionInputAttachments: (
    agentId: string,
    sessionId: string | null,
    updater: (prev: AgentSessionInputAttachment[]) => AgentSessionInputAttachment[],
  ) => void;
  /** 특정 세션 draft 비우기 (제출 후 등). */
  clearAgentSessionInput: (agentId: string, sessionId: string | null) => void;
  /** 한 agent 의 모든 세션 draft 제거 + 제거된 attachments 반환 (cleanup 용). */
  takeAgentSessionInputs: (agentId: string) => AgentSessionInputAttachment[];
  /** 콘티 보드 패널 — 더블 클릭 시 활성 콘티 ID 설정. null=닫힘. */
  contiBoardOpen: { agentId: string; contiId: string } | null;
  openContiBoard: (agentId: string, contiId: string) => void;
  closeContiBoard: () => void;
  /** v2.61 — 첨부 이미지 라이트박스(전체화면 확대) URL. null=닫힘. 전환 상태이므로 영속화 ❌. */
  imageLightbox: string | null;
  openImageLightbox: (url: string) => void;
  closeImageLightbox: () => void;
  /** 콘티 생성 in-flight (agentId Set) — UX 스피너용. 완료 시 자동 제거. */
  contiGenerating: Record<string, true>;
  /** 사용자가 "새 콘티 생성" 버튼 누름 — 서버 POST /api/conti/generate. */
  generateConti: (agentId: string) => Promise<void>;
  /** 콘티 element patch — 서버 POST /api/conti/:id/patch-element. */
  patchContiElement: (contiId: string, frameId: string, elementId: string, prompt: string) => Promise<boolean>;
  /** 콘티 frame append — 서버 POST /api/conti/:id/frames. */
  addContiFrame: (contiId: string, title?: string, action?: string) => Promise<void>;
  /** 콘티 frame 삭제 — 서버 DELETE /api/conti/:id/frames/:idx. */
  deleteContiFrame: (contiId: string, frameIndex: number) => Promise<void>;
  /** 콘티 frame title/action patch — 서버 PATCH /api/conti/:id/frames/:idx. */
  patchContiFrame: (contiId: string, frameIndex: number, updates: { title?: string; action?: string }) => Promise<void>;
  /** §5.3 #28 v1.59 — 콘티 frame 드래그앤드롭 순서 변경 — 서버 POST /api/conti/:id/frames/reorder. */
  reorderContiFrame: (contiId: string, fromIndex: number, toIndex: number) => Promise<void>;
  /** element patch in-flight (`${cid}::${fid}::${eid}`) — 인라인 팝업 스피너용. */
  contiElementPatching: Record<string, true>;
  /**
   * 드래그/리사이즈 중인 Comment Box ID 집합 — loadSnapshot 이 이 박스들의 x/y/width/height
   * 는 클라이언트 로컬 값으로 유지하도록 보호. 서버 PATCH 가 안 가있는 진행 중 변경이 WS
   * snapshot 도착으로 옛 위치/크기로 덮어써지면 박스가 마우스 밖으로 튀는 현상 발생.
   */
  draggingCommentBoxIds: string[];
  /** 드래그/리사이즈 시작/종료 마킹. */
  setCommentBoxDragLock: (id: string, on: boolean) => void;
  /** 낙관적 업데이트 (드래그 중 위치 실시간 반영) — 서버 PATCH 후 덮어쓰기. */
  patchCommentBoxLocal: (id: string, updates: Partial<CommentBox>) => void;
  /** 서버 Comment Box 생성. 성공 시 서버 snapshot 으로 동기화. */
  createCommentBox: (input: {
    projectName: string;
    x: number;
    y: number;
    width: number;
    height: number;
    text?: string;
    color?: string;
    childNodeIds?: string[];
  }) => Promise<CommentBox | null>;
  /** 서버 Comment Box 업데이트 (PATCH). */
  updateCommentBox: (id: string, updates: Partial<Omit<CommentBox, 'id' | 'projectName' | 'createdAt' | 'updatedAt'>>) => Promise<void>;
  /** 서버 Comment Box 삭제. */
  deleteCommentBox: (id: string) => Promise<void>;
  agentPhase: AgentPhase;
  activeAgentCount: number;
  pendingFocus: boolean;
  /** 특정 버블로 공간 점프 요청 — BubbleMap이 setCenter 후 초기화 */
  focusNodeId: string | null;
  /** iframe 탭 목록 (열린 iframe 탭들) */
  iframeTabs: IframeTab[];
  /** 현재 활성 iframe 탭 ID (null이면 프로젝트 뷰) */
  activeIframeId: string | null;
  openIframeTab: (tab: IframeTab) => void;
  closeIframeTab: (id: string) => void;
  setActiveIframeTab: (id: string) => void;
  /**
   * SCENARIO.md §5.4 #14-1 (v2.29) — 별창으로 분리된 탭 키들.
   * desktop main 의 windowManager 가 SSOT, IPC 'vibisual:detached:list' 푸시로 모든 윈도우 sync.
   * 메인 TabBar 는 이 집합에 포함된 키를 렌더링에서 제외 (탭이 사라진 것처럼 보임 — 별창에서만 표시).
   * 영속화 ❌(앱 재시작 시 비움 → 모든 탭 메인 복귀).
   */
  detachedTabKeys: Record<string, 'project' | 'iframe'>;
  applyDetachedList: (list: Array<{ tabKey: string; kind: 'project' | 'iframe' }>) => void;
  /** 별창에서만 사용 — 자기 창의 단일 탭을 강제로 활성화 (서버 patchAppState 호출 ❌). */
  setActiveProjectLocal: (name: string | null) => void;
  setActiveIframeIdLocal: (id: string | null) => void;
  /**
   * 탭 Pin 상태 (localStorage 영속). 키 포맷:
   * - `project:<name>` — TabBar의 프로젝트 탭
   * - `iframe:<id>` — TabBar의 iframe 탭
   * - `subagent:<id>` — IDETabBar의 서브에이전트 세션 탭
   * Pin된 탭은 "Close Others" / "Close to the Right" / "Close All" 대상에서 제외된다.
   * 개별 Close(× / 컨텍스트 메뉴 Close)는 pin 여부 무관하게 동작.
   */
  tabPins: Record<string, true>;
  setTabPin: (key: string, pinned: boolean) => void;
  /**
   * TabBar Default 탭 (localStorage 영속). 값은 Pin 키 포맷과 동일(`project:<name>` | `iframe:<id>`).
   * 부트 시 마지막 활성 탭이 없으면 이 Default 탭을 활성화한다. null이면 없음.
   * 스코프당 유일 — 새 Default 지정 시 기존 Default는 해제된다.
   */
  defaultTabbarKey: string | null;
  setDefaultTabbar: (key: string | null) => void;
  /**
   * 에이전트 IDE의 Default 서브에이전트 (localStorage 영속). `{ [agentId]: subAgentId }`.
   * IDE 오버레이 열릴 때 `selectedSubByAgent[agentId]`(마지막 활성)가 없으면 Default로 폴백.
   */
  /** 서브에이전트 탭 사용자 지정 이름. subId → 라벨. 빈 값은 저장 안 함(기본 라벨 복귀). 클라 영속. */
  subAgentLabels: Record<string, string>;
  setSubAgentLabel: (subId: string, label: string) => void;
  defaultSubAgents: Record<string, string>;
  setDefaultSubAgent: (agentId: string, subAgentId: string | null) => void;
  /**
   * 서버가 authoritative인 탭 라이프사이클 상태 (openProjects / lastActive / default / pinned).
   * snapshot에 실려 오며, 프로젝트 스코프 Pin/Default는 이 값을 읽는다.
   * iframe/subagent Pin/Default는 local `tabPins` / `defaultSubAgents`로 분리 관리.
   */
  appState: AppState | null;
  /** snapshot의 appState를 로컬 상태에 반영 */
  applyAppState: (state: AppState | undefined) => void;
  /** 서버에 PATCH /api/app-state 요청 (fire-and-forget — 성공 시 snapshot으로 갱신됨) */
  patchAppState: (patch: AppStatePatch) => Promise<void>;
  debugMode: boolean;
  toggleDebug: () => void;
  /**
   * 프로젝트별 루트 캔버스 바운딩 박스 (LAYOUT_CENTER_X/Y 중심). 키 = projectName.
   * 미설정 항목은 클라이언트 기본값 사용. 서버 SSOT — snapshot 으로 들어오고
   * 사용자 조절 시 POST 로 서버에 반영(broadcast 후 다시 store 갱신).
   */
  layoutBoundsByProject: Record<string, { hw: number; hh: number }>;
  applyLayoutBoundsByProject: (map: Record<string, { hw: number; hh: number }> | undefined) => void;
  /** 활성 프로젝트 바운딩 박스 변경 — 로컬 옵티미스틱 only (드래그 중 호출). */
  setLayoutBoundsSize: (halfWidth: number, halfHeight: number) => void;
  /** 활성 프로젝트 바운딩 박스를 서버에 영속화 (드래그 종료 시 1회). */
  flushLayoutBoundsSize: () => void;
  /** Task Edge 연결 중인 소스 노드 ID (null이면 연결 안 함) */
  connectingFrom: string | null;
  setConnectingFrom: (id: string | null) => void;
  /**
   * 커스텀 Task Edge 연결 상태.
   * `drag` = 테두리 pointerdown 직후 마우스 버튼이 눌린 단계,
   * `follow` = 무효 드롭 이후 버튼이 떼어진 채 마우스를 따라다니는 단계 (다음 좌클릭에서 확정/취소).
   */
  taskEdgeDrag: { sourceId: string; mouseX: number; mouseY: number; phase: 'drag' | 'follow' } | null;
  startTaskEdgeDrag: (sourceId: string, mouseX: number, mouseY: number) => void;
  updateTaskEdgeDrag: (clientX: number, clientY: number) => void;
  setTaskEdgeDragFollow: () => void;
  endTaskEdgeDrag: () => void;
  /** Task Edge 편집 팝업 (아이콘 더블클릭 시 오픈) */
  taskEdgeEditPopup: { edgeId: string; screenX: number; screenY: number } | null;
  openTaskEdgeEdit: (edgeId: string, screenX: number, screenY: number) => void;
  closeTaskEdgeEdit: () => void;

  /** Task Edge 편집 중 실시간 프리뷰 — 팝업에서 필드 바꿀 때 캔버스에 즉시 반영.
   * Save 확정 시 서버 스냅샷이 덮어쓰고, Cancel/unmount 시 clear. 서버 전송 없음. */
  taskEdgePreview: { edgeId: string; overrides: Partial<TaskEdge> } | null;
  setTaskEdgePreview: (edgeId: string, overrides: Partial<TaskEdge>) => void;
  clearTaskEdgePreview: () => void;

  loadSnapshot: (
    projects: Record<string, ProjectInfo>,
    agents: BubbleData[],
    topFolders: BubbleData[],
    children: Record<string, BubbleData[]>,
    edges: ActivityEdge[],
    innerEdges: Record<string, ActivityEdge[]>,
    satellites: Record<string, BubbleData[]>,
    bashHistory: Record<string, BashEntry[]>,
    runningServers: Record<string, ServerEntry[]>,
    agentEvents: Record<string, AgentEvent[]>,
    agentProjects: Record<string, string>,
    nodeProjects: Record<string, string>,
    fileEdits: Record<string, FileEdit[]>,
    commandQueues: Record<string, QueuedCommand[]>,
    completedCommands: Record<string, QueuedCommand[]>,
    subAgents: Record<string, SubAgent[]>,
    agentPhase: AgentPhase,
    activeAgentCount: number,
    satellitePositions: Record<string, { x: number; y: number }>,
    pipelineChildren: Record<string, BubbleData[]>,
    pipelines: Record<string, PipelineState>,
    agentConfigs: Record<string, AgentConfig>,
    taskEdges: Record<string, TaskEdge>,
    worktreeProjects: Record<string, string>,
    gitDirty: Record<string, boolean>,
    commentBoxes: CommentBox[],
    contis: Record<string, Conti>,
    activeContiWork: Record<string, ActiveContiWork>,
  ) => void;
  setActiveProject: (name: string) => void;
  /** v1.63: projectId(경로) 로 닫기. name 은 로컬 활성탭 전환용 표시명(생략 시 역추론). */
  closeProject: (projectId: string, name?: string) => Promise<void>;
  /** stub 프로젝트 hydrate 요청 — WS hydrate-project 발송 + pending 상태 set */
  hydrateProject: (name: string) => void;
  /** WS send 함수 등록 — useWebSocket 훅에서 연결 후 호출 */
  _registerWsSend: (fn: (msg: import('@vibisual/shared').WSMessage) => void) => void;
  /** 내부 WS send 핸들러 */
  _wsSend: ((msg: import('@vibisual/shared').WSMessage) => void) | null;
  /** graph_snapshot.stubProjects 수신 시 호출 */
  applyStubProjects: (stubs: Record<string, ProjectMetaSnapshot>) => void;
  /** project-hydrated WS 수신 시 호출 */
  onProjectHydrated: (name: string, success: boolean, reason?: string) => void;
  /** project-unloaded WS 수신 시 호출 */
  onProjectUnloaded: (name: string) => void;
  setRunningServers: (servers: Record<string, ServerEntry[]>) => void;
  goToMain: () => void;
  enterFolder: (folderId: string) => void;
  /** 깊은 폴더 진입 — 중간 경로 전부 navStack에 쌓음 */
  enterFolderDeep: (folderId: string) => void;
  goBack: () => void;
  selectNode: (id: string | null) => void;
  /** 선택 링 의도만 즉시 갱신(패널 지연과 무관). 클릭 확정 시 호출. */
  setSelectIntent: (id: string | null) => void;
  setAgentPhase: (phase: AgentPhase) => void;
  markAllIdle: () => void;
  requestFocus: () => void;
  clearFocus: () => void;
  focusOnNode: (id: string) => void;
  clearFocusNode: () => void;
  createCustomAgent: (canvasX: number, canvasY: number) => void;
  /** §4 v2.63 — CMD(인터랙티브 터미널) 에이전트 생성. 커스텀 에이전트 기반 + executionMode baked. */
  createCmdAgent: (canvasX: number, canvasY: number) => void;
  /** §5.3 #10-2 v2.37 — Auto Agent 메타 버블 생성 */
  createAutoAgent: (canvasX: number, canvasY: number) => void;
  /** §5.3 #10-2 v2.37 — Auto Agent 에게 자연어 메시지 → 서버 spawn + dispatch */
  sendMessageToAutoAgent: (autoAgentSessionId: string, text: string) => void;
  /** §5.3 #10-2 v2.37 — Auto Agent "질문하기" 토글 */
  toggleAutoAgentQuestions: (autoAgentSessionId: string, enabled: boolean) => void;
  /** §5.3 #10-2 v2.37 — 명확화 질문에 사용자 답 전송 → spawn 재개 */
  answerAutoAgentQuestions: (
    autoAgentSessionId: string,
    answers: { questionIndex: number; selectedLabels: string[]; note?: string }[],
  ) => void;
  createPipeline: (type: PipelineType, canvasX: number, canvasY: number) => void;
  createWorktree: (canvasX: number, canvasY: number) => void;
  /** 서버 응답 대기 중 낙관적 worktree 버블 — 클라이언트 전용 placeholder */
  pendingWorktrees: BubbleData[];
  removePendingWorktree: (id: string) => void;
  setPendingWorktreeError: (id: string) => void;
  /** worktree 삭제 확인 모달 — nodeId 가 설정되면 모달이 떠서 merge 상태 조회 + 사용자 선택 대기 */
  worktreeDeleteTarget: { nodeId: string; label: string } | null;
  requestWorktreeDelete: (nodeId: string, label: string) => void;
  closeWorktreeDelete: () => void;
  /** SubAgent 스트림 이벤트 (subAgentId → events[]) — IDE 터미널 표시용 */
  subAgentStreams: Record<string, SubAgentStreamEvent[]>;
  appendStreamEvent: (event: SubAgentStreamEvent) => void;
  /** §9 — sub_agent_stream 16ms 배치 수신. 도착 순서대로 합쳐 set 1회 (구독자 재평가 1회). */
  appendStreamEvents: (events: SubAgentStreamEvent[]) => void;
  loadStreamBuffers: (buffers: Record<string, SubAgentStreamEvent[]>) => void;
  /** IDE 오버레이 상태 — 프로젝트별 독립 슬롯 (projectId → state). 활성 탭의 슬롯만 화면에 노출. */
  ideOverlays: Record<string, IDEOverlayState>;
  openIDEOverlay: (agentId: string) => void;
  closeIDEOverlay: () => void;
  setIDEActiveSession: (sessionId: string | null) => void;
  setIDEActiveView: (view: IDEViewType) => void;
  toggleIDESidebar: () => void;
  setIDEDocked: (docked: boolean, dockWidth?: number) => void;
  /** 커스텀 에이전트 버블이 표시할 "선택된 sub" 영구 맵 (agentId → subId).
   *  IDE 오버레이가 닫혀도 유지 — 버블의 context 게이지/라벨 override 소스. */
  selectedSubByAgent: Record<string, string>;
  selectSubForAgent: (agentId: string, subId: string) => void;
  /** 현재 UI 언어 (서버 SSOT — ProjectCheckpoint.uiLocale). */
  uiLocale: UiLocale;
  /** 서버 스냅샷 수신 시 호출 — 상태 갱신 + i18n 언어 전환. */
  applyUiLocale: (locale: UiLocale) => void;
  /** §4 v1.50 — graph_snapshot 수신 시 도구 시간 / 컴팩션 / 한도 메트릭 반영. */
  applyV150Metrics: (
    recentToolDurations: Record<string, ToolDurationEntry[]> | undefined,
    compactCounts: Record<string, CompactCount> | undefined,
    rateLimits: RateLimitInfo | undefined,
  ) => void;
  /** §5.5 #17-4 v2.36 — graph_snapshot 의 스킬 사용 카운트 반영. */
  applySkillUsageCounts: (counts: Record<string, Record<string, number>> | undefined) => void;
  /** §5.3 #10-2 v2.37 — graph_snapshot 의 Auto Agent 요약 메타 반영. */
  applyAutoAgentSummaries: (summaries: Record<string, AutoAgentSummary> | undefined) => void;
  /** §4 v2.52 — graph_snapshot 의 에이전트 작업 신고 반영. */
  applyAgentReports: (reports: Record<string, AgentReport[]> | undefined) => void;
  /** §4 v2.60 — graph_snapshot 의 에이전트 질문 카드 반영. */
  applyAgentQuestions: (questions: Record<string, AgentQuestions[]> | undefined) => void;
  /** §4 v2.70 — graph_snapshot 의 에이전트 검수 요청 카드 반영. */
  applyAgentReviews: (reviews: Record<string, AgentReview[]> | undefined) => void;
  /** §4 v1.98 — graph_snapshot 수신 시 진단 에러 로그 반영. */
  applyDiagnosticLog: (log: DiagnosticEntry[] | undefined) => void;
  /** §4 v2.38 — graph_snapshot 또는 model_registry_updated 수신 시 레지스트리 반영. */
  applyModelRegistry: (reg: ModelRegistry | undefined) => void;
  /** §4 v2.42 — graph_snapshot 또는 user_defaults_updated 수신 시 옵션 반영. */
  applyUserDefaults: (d: UserDefaults | undefined) => void;
  /** UI에서 언어 변경 요청 — 서버 PUT /api/ui-locale 후 성공 시 applyUiLocale 호출. */
  setUiLocale: (locale: UiLocale) => Promise<void>;

  // §5.3 #12-1 v1.43 — 권한 승인 요청 스택
  /** 대기 중인 권한 승인 요청 (requestId → PermissionRequest). 여러 개 쌓이면 스택 모달로 표시. */
  pendingPermissions: Record<string, import('@vibisual/shared').PermissionRequest>;
  /** WS permission_request 수신 시 호출 — 스택에 추가 */
  addPendingPermission: (req: import('@vibisual/shared').PermissionRequest) => void;
  /** WS permission_resolved 수신 또는 사용자 응답 후 호출 — 스택에서 제거 */
  removePendingPermission: (requestId: string) => void;
  /** 서버 재연결 시 기존 대기 요청 복구용 */
  setPendingPermissions: (list: import('@vibisual/shared').PermissionRequest[]) => void;
  /** 사용자 Allow/Deny 결정 — 서버 POST /api/permission-decide */
  respondPermission: (requestId: string, decision: 'allow' | 'deny', reason?: string) => Promise<void>;

  // §5.3 #12-2 v2.26 — AskUserQuestion 카드 큐 (IDE 인라인)
  /** 대기 중인 AskUserQuestion 요청 (requestId → AskUserQuestionRequest). IDE 안 인라인 카드. */
  pendingAskQuestions: Record<string, import('@vibisual/shared').AskUserQuestionRequest>;
  /** WS ask_user_question 수신 시 호출 — 큐에 추가 */
  addPendingAskQuestion: (req: import('@vibisual/shared').AskUserQuestionRequest) => void;
  /** WS ask_user_question_resolved 수신 또는 사용자 응답 후 호출 — 큐에서 제거 */
  removePendingAskQuestion: (requestId: string) => void;
  /** 서버 재연결 시 대기 요청 복구용 */
  setPendingAskQuestions: (list: import('@vibisual/shared').AskUserQuestionRequest[]) => void;
  /** 사용자 Send 결정 — 서버 POST /api/ask-user-question/decide. answers 는 request.items 와 1:1. */
  respondAskQuestion: (requestId: string, answers: import('@vibisual/shared').AskUserQuestionAnswer[]) => Promise<void>;

  // §5.7 #23-1 v1.59 — Claude Code 버전 체크 + 업데이트 게이트
  /** 현재 캐시된 버전 정보 — 첫 체크 전 null */
  claudeVersion: import('@vibisual/shared').ClaudeVersionInfo | null;
  /** 이번 세션에서 한 번이라도 체크 성공한 적 있는지 (lazy 1회 보장) */
  claudeVersionChecked: boolean;
  /** 이번 세션에서 사용자가 모달을 닫았으면 true — 같은 세션 동안 재오픈 금지 */
  claudeVersionDismissed: boolean;
  /** 모달 표시 여부 (outdated 면 자동 true) */
  claudeVersionModalOpen: boolean;
  /** 진행 중 설치 작업 — null 이면 idle */
  claudeInstallProgress: import('@vibisual/shared').ClaudeInstallProgress | null;
  /**
   * `addCommand` 진입 시 호출 — 첫 체크 + outdated 면 모달 띄우고 사용자 결정까지 await.
   * 사용자 결정 후 또는 outdated 가 아니면 즉시 resolve. 호출자는 await 후 정상 발사.
   */
  ensureClaudeVersionChecked: () => Promise<void>;
  /** WS `claude_install_progress` 수신 시 — 모달의 라이브 패널이 즉시 갱신됨 */
  setClaudeInstallProgress: (p: import('@vibisual/shared').ClaudeInstallProgress | null) => void;
  /** [업데이트] 버튼 — 서버에 install 요청, 진행 상황은 WS 로 받음 */
  installClaudeVersion: () => Promise<void>;
  /** [이번 세션 건너뛰기] / [이 버전 계속 쓰기] — 모달 닫고 dismissed 플래그 set */
  dismissClaudeVersion: () => void;
}

export const useGraphStore = create<GraphState>((set, get) => ({
  projects: {},
  stubProjects: {},
  hydratingProjects: {},
  _wsSend: null,
  _registerWsSend: (fn) => set({ _wsSend: fn }),
  agents: [],
  topFolders: [],
  children: {},
  canvasVisibleNodeIds: {},
  edges: [],
  innerEdges: {},
  satellites: {},
  satellitePositions: {},
  nodeMap: {},
  bashHistory: {},
  runningServers: {},
  agentEvents: {},
  agentProjects: {},
  nodeProjects: {},
  fileEdits: {},
  queuedCommands: {},
  completedCommands: {},
  subAgents: {},
  pendingSubAgentRemovals: {},
  pendingSubAgentRestores: {},
  optimisticRemoveSubAgent: (agentId, subAgentId) =>
    set((s) => {
      const nextRestores = { ...s.pendingSubAgentRestores };
      delete nextRestores[subAgentId];
      return {
        pendingSubAgentRemovals: { ...s.pendingSubAgentRemovals, [subAgentId]: agentId },
        pendingSubAgentRestores: nextRestores,
      };
    }),
  optimisticRestoreSubAgent: (agentId, subAgent) =>
    set((s) => {
      const nextRemovals = { ...s.pendingSubAgentRemovals };
      delete nextRemovals[subAgent.id];
      return {
        pendingSubAgentRestores: { ...s.pendingSubAgentRestores, [subAgent.id]: subAgent },
        pendingSubAgentRemovals: nextRemovals,
      };
    }),
  clearPendingSubAgentIntent: (subAgentId) =>
    set((s) => {
      if (!(subAgentId in s.pendingSubAgentRemovals) && !(subAgentId in s.pendingSubAgentRestores)) return s;
      const nextRemovals = { ...s.pendingSubAgentRemovals };
      const nextRestores = { ...s.pendingSubAgentRestores };
      delete nextRemovals[subAgentId];
      delete nextRestores[subAgentId];
      return { pendingSubAgentRemovals: nextRemovals, pendingSubAgentRestores: nextRestores };
    }),
  acknowledgedSubAgents: loadJSON<Record<string, true>>(ACK_SUBAGENTS_KEY, {}),
  markSubAcknowledged: (subId) => set((state) => {
    if (state.acknowledgedSubAgents[subId]) return state;
    const next: Record<string, true> = { ...state.acknowledgedSubAgents, [subId]: true };
    saveJSON(ACK_SUBAGENTS_KEY, next);
    return { acknowledgedSubAgents: next };
  }),
  pipelineChildren: {},
  pipelines: {},
  agentConfigs: {},
  taskEdges: {},
  worktreeProjects: {},
  gitDirty: {},
  gitRefreshing: {},
  setGitRefreshing: (projectName, refreshing) =>
    set((state) => {
      const next = { ...state.gitRefreshing };
      if (refreshing) next[projectName] = true;
      else delete next[projectName];
      return { gitRefreshing: next };
    }),
  attachmentPreviews: {},
  registerAttachmentPreview: (basename, blobUrl) =>
    set((state) => {
      // 동일 basename 에 이전 URL 이 있으면 revoke (재등록 케이스 — 일반적으론 없음).
      const prior = state.attachmentPreviews[basename];
      if (prior && prior !== blobUrl) URL.revokeObjectURL(prior);
      return { attachmentPreviews: { ...state.attachmentPreviews, [basename]: blobUrl } };
    }),
  fileSizeRange: { min: 0, max: 0 },
  addCommand: (agentId, text, subAgentId, attachments) => {
    const sid = findSessionId(get().agents, agentId);
    if (!sid) return;
    // §5.7 #23-1 v1.59 — 첫 명령 발사 직전에 Claude Code 버전 체크. outdated 면 모달 결정까지 보류.
    void (async () => {
      await get().ensureClaudeVersionChecked();
      try {
        const r = await fetch(`${API_BASE}/api/commands/${sid}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            subAgentId: subAgentId ?? null,
            ...(attachments && attachments.length > 0 ? { attachments } : {}),
          }),
        });
        const data = await r.json() as { command?: { subAgentId?: string } };
        // 서버가 결정한 세션으로 자동 전환
        if (data.command?.subAgentId) {
          get().setIDEActiveSession(data.command.subAgentId);
        }
      } catch { /* 서버가 snapshot broadcast → loadSnapshot 에서 queuedCommands 갱신 */ }
    })();
  },
  removeCommand: (agentId, commandId) => {
    const sid = findSessionId(get().agents, agentId);
    if (!sid) return;
    fetch(`${API_BASE}/api/commands/${sid}/${commandId}`, { method: 'DELETE' }).catch(() => {});
  },
  reorderCommands: (agentId, fromIndex, toIndex) => {
    const sid = findSessionId(get().agents, agentId);
    if (!sid) return;
    fetch(`${API_BASE}/api/commands/${sid}/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromIndex, toIndex }),
    }).catch(() => {});
  },
  createTaskEdge: (sourceAgentId, targetAgentId, command, forwardMode, templateId, options) => {
    fetch(`${API_BASE}/api/task-edges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceAgentId, targetAgentId, command, forwardMode, templateId, ...options }),
    }).catch(() => {});
  },
  updateTaskEdge: (id, updates) => {
    fetch(`${API_BASE}/api/task-edges/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }).catch(() => {});
  },
  deleteTaskEdge: (id) => {
    fetch(`${API_BASE}/api/task-edges/${id}`, { method: 'DELETE' }).catch(() => {});
  },
  patchCommentBoxLocal: (id, updates) => set((s) => ({
    commentBoxes: s.commentBoxes.map((b) => (b.id === id ? { ...b, ...updates } : b)),
  })),
  draggingCommentBoxIds: [],
  setCommentBoxDragLock: (id, on) => set((s) => {
    const has = s.draggingCommentBoxIds.includes(id);
    if (on && !has) return { draggingCommentBoxIds: [...s.draggingCommentBoxIds, id] };
    if (!on && has) return { draggingCommentBoxIds: s.draggingCommentBoxIds.filter((x) => x !== id) };
    return s;
  }),
  createCommentBox: async (input) => {
    try {
      const res = await fetch(`${API_BASE}/api/comment-boxes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) return null;
      const data = await res.json() as { ok: boolean; data?: CommentBox };
      const box = data.data ?? null;
      // WS snapshot 도착 전이라도 직후 호출자(예: recomputeBoxMembership) 가 박스를 찾을 수 있도록
      // 낙관적 로컬 삽입. 다음 snapshot 이 권위 값으로 자연스럽게 덮어쓴다.
      if (box) {
        set((s) => (s.commentBoxes.some((b) => b.id === box.id)
          ? s
          : { commentBoxes: [...s.commentBoxes, box] }));
      }
      return box;
    } catch {
      return null;
    }
  },
  updateCommentBox: async (id, updates) => {
    // 낙관적 로컬 패치 (드래그 종료 등 한방 업데이트용)
    set((s) => ({
      commentBoxes: s.commentBoxes.map((b) => (b.id === id ? { ...b, ...updates } : b)),
    }));
    try {
      await fetch(`${API_BASE}/api/comment-boxes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
    } catch { /* 서버 스냅샷이 다음 턴에 덮어씀 */ }
  },
  deleteCommentBox: async (id) => {
    // 낙관적 로컬 제거
    set((s) => ({
      commentBoxes: s.commentBoxes.filter((b) => b.id !== id),
      selectedCommentBoxId: s.selectedCommentBoxId === id ? null : s.selectedCommentBoxId,
    }));
    try {
      await fetch(`${API_BASE}/api/comment-boxes/${id}`, { method: 'DELETE' });
    } catch { /* 재연결 후 다음 snapshot 에서 동기화 */ }
  },
  activeProject: null,
  currentProject: null,
  currentFolderId: null,
  navStack: [],
  selectedNodeId: null,
  selectIntentId: null,
  selectedTaskEdgeId: null,
  selectedCommentBoxId: null,
  commentBoxes: [],
  contis: {},
  activeContiWork: {},
  recentToolDurations: {},
  compactCounts: {},
  skillUsageCounts: {},
  autoAgentSummaries: {},
  agentReports: {},
  agentQuestions: {},
  agentReviews: {},
  modelRegistry: null,
  userDefaults: null,
  rateLimits: null,
  diagnosticLog: [],
  contiBoardOpen: null,
  imageLightbox: null,
  contiGenerating: {},
  contiElementPatching: {},
  agentInputDrafts: {},
  setAgentInputDraft: (agentId, text) =>
    set((s) => ({ agentInputDrafts: { ...s.agentInputDrafts, [agentId]: text } })),
  consumeAgentInputDraft: (agentId) => {
    const cur = get().agentInputDrafts[agentId];
    if (cur === undefined) return undefined;
    set((s) => {
      const next = { ...s.agentInputDrafts };
      delete next[agentId];
      return { agentInputDrafts: next };
    });
    return cur;
  },
  // v2.69 — 부팅 시 localStorage 에 저장된 세션별 입력 텍스트로 hydrate(첨부는 항상 빈 배열).
  agentSessionInputs: loadSessionInputDrafts(),
  setAgentSessionInputText: (agentId, sessionId, text) =>
    set((s) => {
      const key = agentSessionInputKey(agentId, sessionId);
      const prev = s.agentSessionInputs[key];
      if (prev?.text === text) return s;
      const nextEntry: AgentSessionInputDraft = {
        text,
        attachments: prev?.attachments ?? [],
      };
      const agentSessionInputs = { ...s.agentSessionInputs, [key]: nextEntry };
      saveSessionInputDrafts(agentSessionInputs); // v2.69 — 키 입력마다 텍스트 영속
      return { agentSessionInputs };
    }),
  updateAgentSessionInputAttachments: (agentId, sessionId, updater) =>
    set((s) => {
      const key = agentSessionInputKey(agentId, sessionId);
      const prev = s.agentSessionInputs[key];
      const prevAttachments = prev?.attachments ?? [];
      const nextAttachments = updater(prevAttachments);
      if (nextAttachments === prevAttachments) return s;
      const nextEntry: AgentSessionInputDraft = {
        text: prev?.text ?? '',
        attachments: nextAttachments,
      };
      return { agentSessionInputs: { ...s.agentSessionInputs, [key]: nextEntry } };
    }),
  clearAgentSessionInput: (agentId, sessionId) =>
    set((s) => {
      const key = agentSessionInputKey(agentId, sessionId);
      if (!(key in s.agentSessionInputs)) return s;
      const next = { ...s.agentSessionInputs };
      delete next[key];
      saveSessionInputDrafts(next); // v2.69 — 제출/클리어 시 영속 텍스트도 제거
      return { agentSessionInputs: next };
    }),
  takeAgentSessionInputs: (agentId) => {
    const all = get().agentSessionInputs;
    const prefix = `${agentId}|`;
    const removed: AgentSessionInputAttachment[] = [];
    let changed = false;
    const next: Record<string, AgentSessionInputDraft> = {};
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith(prefix)) {
        // v2.69 — IDE 닫힘 정리: 첨부(blob/서버 임시파일)는 반환해 cleanup 하되,
        // 입력 텍스트는 보존한다 → 창을 닫았다 다시 열어도 세션별 텍스트가 유지된다.
        if (v.attachments.length > 0) {
          removed.push(...v.attachments);
          changed = true;
        }
        if (v.text.length > 0) next[k] = { text: v.text, attachments: [] };
        else changed = true; // 텍스트도 첨부도 없는 빈 항목만 제거
        continue;
      }
      next[k] = v;
    }
    if (changed) {
      set({ agentSessionInputs: next });
      saveSessionInputDrafts(next);
    }
    return removed;
  },
  openContiBoard: (agentId, contiId) => set({ contiBoardOpen: { agentId, contiId } }),
  closeContiBoard: () => set({ contiBoardOpen: null }),
  openImageLightbox: (url) => set({ imageLightbox: url }),
  closeImageLightbox: () => set({ imageLightbox: null }),
  generateConti: async (agentId) => {
    set((s) => ({ contiGenerating: { ...s.contiGenerating, [agentId]: true } }));
    try {
      await fetch(`${API_BASE}/api/conti/generate?agentId=${encodeURIComponent(agentId)}`, { method: 'POST' });
    } catch { /* snapshot 으로 동기화 */ }
    finally {
      set((s) => {
        const next = { ...s.contiGenerating };
        delete next[agentId];
        return { contiGenerating: next };
      });
    }
  },
  patchContiElement: async (contiId, frameId, elementId, prompt) => {
    const key = `${contiId}::${frameId}::${elementId}`;
    set((s) => ({ contiElementPatching: { ...s.contiElementPatching, [key]: true } }));
    try {
      const r = await fetch(`${API_BASE}/api/conti/${encodeURIComponent(contiId)}/patch-element`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frameId, elementId, prompt }),
      });
      return r.ok;
    } catch {
      return false;
    } finally {
      set((s) => {
        const next = { ...s.contiElementPatching };
        delete next[key];
        return { contiElementPatching: next };
      });
    }
  },
  addContiFrame: async (contiId, title, action) => {
    try {
      await fetch(`${API_BASE}/api/conti/${encodeURIComponent(contiId)}/frames`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, action }),
      });
    } catch { /* snapshot */ }
  },
  deleteContiFrame: async (contiId, frameIndex) => {
    try {
      await fetch(`${API_BASE}/api/conti/${encodeURIComponent(contiId)}/frames/${frameIndex}`, { method: 'DELETE' });
    } catch { /* snapshot */ }
  },
  patchContiFrame: async (contiId, frameIndex, updates) => {
    try {
      await fetch(`${API_BASE}/api/conti/${encodeURIComponent(contiId)}/frames/${frameIndex}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
    } catch { /* snapshot */ }
  },
  reorderContiFrame: async (contiId, fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    // 낙관적 로컬 업데이트 — 서버 응답 전에 화면이 즉시 튐. 다음 snapshot 으로 reconcile.
    useGraphStore.setState((state) => {
      const c = state.contis[contiId];
      if (!c) return state;
      if (fromIndex < 0 || fromIndex >= c.frames.length) return state;
      if (toIndex < 0 || toIndex >= c.frames.length) return state;
      const nextFrames = [...c.frames];
      const [moved] = nextFrames.splice(fromIndex, 1);
      if (!moved) return state;
      nextFrames.splice(toIndex, 0, moved);
      return { contis: { ...state.contis, [contiId]: { ...c, frames: nextFrames } } };
    });
    try {
      await fetch(`${API_BASE}/api/conti/${encodeURIComponent(contiId)}/frames/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromIndex, toIndex }),
      });
    } catch { /* snapshot 으로 자연 reconcile */ }
  },
  agentPhase: 'waiting',
  activeAgentCount: 0,
  pendingFocus: false,
  focusNodeId: null,

  loadSnapshot: (projects, agents, topFolders, children, edges, innerEdges, satellites, bashHistory, runningServers, agentEvents, agentProjects, nodeProjects, fileEdits, commandQueues, completedCommands, subAgents, agentPhase, activeAgentCount, satellitePositions, pipelineChildren, pipelines, agentConfigs, taskEdges, worktreeProjects, gitDirty, commentBoxes, contis, activeContiWork) => {
    // O(1) 조회용 nodeMap 빌드
    const nodeMap: Record<string, BubbleData> = {};
    for (const a of agents) nodeMap[a.id] = a;
    for (const f of topFolders) nodeMap[f.id] = f;
    for (const items of Object.values(children)) {
      for (const item of items) nodeMap[item.id] = item;
    }
    const allFiles: BubbleData[] = [];
    for (const items of Object.values(satellites)) {
      for (const item of items) {
        nodeMap[item.id] = item;
        if (item.bubbleType === 'file') allFiles.push(item);
      }
    }
    // topFolders 중 file 타입도 포함
    for (const f of topFolders) {
      if (f.bubbleType === 'file') allFiles.push(f);
    }
    const fileSizeRange = calcFileSizeRange(allFiles);

    // v1.38 — attachmentPreviews cleanup: 새 큐에 없는 basename 은 revoke + 삭제.
    //         서버가 cmd 완료 시 cmd.attachments 를 delete 한 뒤 archive 로 옮기므로
    //         queuedCommands 기준으로만 active set 계산.
    const activeBasenames = new Set<string>();
    const basenameOf = (p: string): string => {
      const parts = p.split(/[/\\]/);
      return parts[parts.length - 1] ?? '';
    };
    for (const queue of Object.values(commandQueues)) {
      for (const c of queue) {
        if (c.attachments) for (const p of c.attachments) activeBasenames.add(basenameOf(p));
      }
    }
    // v2.61 — 완료 명령도 attachments 를 보존하므로(서버가 더 이상 unlink/필드 클리어 안 함),
    //         그 blob preview 를 revoke 하지 않는다 → 전송 후에도 대화 스트림에 썸네일 유지.
    for (const queue of Object.values(completedCommands)) {
      for (const c of queue) {
        if (c.attachments) for (const p of c.attachments) activeBasenames.add(basenameOf(p));
      }
    }

    // 서브에이전트 ack 상태 diff — active → idle 전이는 ack 해제(다음 완료는 다시 녹색),
    // 스냅샷에서 사라진 sub 은 ack 집합에서도 정리.
    const prevSubStatusById: Record<string, SubAgent['status']> = {};
    set((state) => {
      for (const list of Object.values(state.subAgents)) {
        for (const s of list) prevSubStatusById[s.id] = s.status;
      }
      const currentSubIds = new Set<string>();
      for (const list of Object.values(subAgents)) {
        for (const s of list) currentSubIds.add(s.id);
      }
      let nextAck = state.acknowledgedSubAgents;
      let ackChanged = false;
      const ensureClone = (): void => {
        if (!ackChanged) { nextAck = { ...state.acknowledgedSubAgents }; ackChanged = true; }
      };
      for (const list of Object.values(subAgents)) {
        for (const s of list) {
          const prev = prevSubStatusById[s.id];
          // active → idle: 새 완료 — 다음 사용자 확인 전까진 unacked(녹색) 유지.
          if (prev === 'active' && s.status === 'idle' && nextAck[s.id]) {
            ensureClone();
            delete nextAck[s.id];
          }
        }
      }
      // "스냅샷에서 사라진 sub 은 ack 정리" — 단, **직전 상태에 있던(=우리가 인지하던) sub 이
      // 이번 스냅샷에서 빠진 경우만** 정리한다.
      // getSnapshot 의 subAgents 는 그 시점에 hydrate 된 프로젝트 인스턴스들의 합집합이라,
      // 부팅 직후(인스턴스 복원 전)나 타 프로젝트 미hydrate 상태에선 비거나 부분적이다.
      // "이번 스냅샷에 없다" 만으로 지우면 localStorage 에서 로드한, 아직 한 번도 못 본 ack 를
      // 전부 삭제 → 그 빈 값이 디스크에 덮여 "재시작하면 또 전부 녹색" 이 재발한다.
      // prevSubStatusById 에 있던 것만 = 실제로 닫혀 사라진 것만 정리해 이 오삭제를 막는다.
      for (const id of Object.keys(nextAck)) {
        if (prevSubStatusById[id] !== undefined && !currentSubIds.has(id)) {
          ensureClone();
          delete nextAck[id];
        }
      }
      // ack 변동(완료 재발생으로 해제 / 사라진 sub 정리)을 localStorage 에 반영 — 재시작 후 색 유지.
      if (ackChanged) saveJSON(ACK_SUBAGENTS_KEY, nextAck);
      const saved = loadSavedActiveProject();
      // Default Tabbar 탭 중 프로젝트 타입만 부트 폴백 후보로 사용 (iframe은 세션 한정이라 재접속 시 복원 대상 아님)
      const defaultProject = state.defaultTabbarKey?.startsWith('project:')
        ? state.defaultTabbarKey.slice('project:'.length)
        : null;
      const resolvedProject = state.activeProject
        ?? (saved && projects[saved] ? saved : null)
        ?? (defaultProject && projects[defaultProject] ? defaultProject : null)
        ?? [...new Set(Object.values(agentProjects))][0]
        ?? null;
      if (resolvedProject !== state.activeProject) saveActiveProject(resolvedProject);
      let nextPreviews = state.attachmentPreviews;
      let previewChanged = false;
      for (const [bn, url] of Object.entries(state.attachmentPreviews)) {
        if (!activeBasenames.has(bn)) {
          URL.revokeObjectURL(url);
          if (!previewChanged) { nextPreviews = { ...state.attachmentPreviews }; previewChanged = true; }
          delete nextPreviews[bn];
        }
      }

      // 드래그/리사이즈 중인 Comment Box 의 geometry(x/y/width/height) 는 서버 값으로 덮어쓰지 않는다.
      // 진행 중 변경이 PATCH 되기 전 WS snapshot 도착으로 옛 위치/크기로 회귀해 박스가 마우스
      // 밖으로 튀는 현상 방지. 다른 필드(text/color/childNodeIds 등)는 서버 권위 유지.
      let mergedCommentBoxes = commentBoxes;
      if (state.draggingCommentBoxIds.length > 0) {
        const lockedById = new Map<string, CommentBox>();
        for (const id of state.draggingCommentBoxIds) {
          const local = state.commentBoxes.find((b) => b.id === id);
          if (local) lockedById.set(id, local);
        }
        if (lockedById.size > 0) {
          mergedCommentBoxes = commentBoxes.map((b) => {
            const local = lockedById.get(b.id);
            if (!local) return b;
            return { ...b, x: local.x, y: local.y, width: local.width, height: local.height };
          });
        }
      }

      return {
        projects,
        agents,
        topFolders,
        children,
        edges,
        innerEdges,
        satellites,
        satellitePositions,
        nodeMap,
        bashHistory,
        runningServers,
        agentProjects,
        nodeProjects,
        fileEdits,
        activeProject: resolvedProject,
        currentProject: resolvedProject ? (projects[resolvedProject] ?? null) : null,
        agentEvents,
        queuedCommands: commandQueues,
        completedCommands,
        subAgents,
        ...(ackChanged ? { acknowledgedSubAgents: nextAck } : {}),
        fileSizeRange,
        agentPhase,
        activeAgentCount,
        pipelineChildren,
        pipelines,
        agentConfigs,
        taskEdges,
        worktreeProjects,
        gitDirty,
        attachmentPreviews: nextPreviews,
        commentBoxes: mergedCommentBoxes,
        contis,
        activeContiWork,
      };
    });
  },

  setCanvasVisibleNodeIds: (ids) =>
    set((state) => {
      const prev = state.canvasVisibleNodeIds;
      const prevKeys = Object.keys(prev);
      // 동일 집합이면 no-op (BubbleMap 이 매 렌더마다 호출해도 리렌더 루프 방지)
      if (prevKeys.length === ids.length && ids.every((id) => prev[id])) return state;
      const next: Record<string, true> = {};
      for (const id of ids) next[id] = true;
      return { canvasVisibleNodeIds: next };
    }),

  goToMain: () => set({ currentFolderId: null, navStack: [], selectedNodeId: null, selectIntentId: null }),

  enterFolder: (folderId) =>
    set((state) => ({
      currentFolderId: folderId,
      navStack: state.currentFolderId
        ? [...state.navStack, state.currentFolderId]
        : [],
      selectedNodeId: null,
      selectIntentId: null,
    })),

  enterFolderDeep: (folderId) =>
    set((state) => {
      // 타겟 폴더의 path에서 중간 폴더들 찾아서 스택 구성
      let targetPath: string | undefined;
      for (const items of Object.values(state.children)) {
        const found = items.find((f) => f.id === folderId);
        if (found) { targetPath = found.path; break; }
      }
      if (!targetPath) {
        const top = state.topFolders.find((f) => f.id === folderId);
        if (top) targetPath = top.path;
      }

      if (!targetPath) {
        return { currentFolderId: folderId, navStack: [], selectedNodeId: null, selectIntentId: null };
      }

      // path 세그먼트로 중간 폴더 ID 수집
      const segments = targetPath.split('/');
      const stack: string[] = [];

      for (let i = 1; i < segments.length; i++) {
        const ancestorPath = segments.slice(0, i).join('/');
        // topFolders에서 찾기
        const top = state.topFolders.find((f) => f.path === ancestorPath);
        if (top) { stack.push(top.id); continue; }
        // children에서 찾기
        for (const items of Object.values(state.children)) {
          const found = items.find((f) => f.path === ancestorPath);
          if (found) { stack.push(found.id); break; }
        }
      }

      return { currentFolderId: folderId, navStack: stack, selectedNodeId: null, selectIntentId: null };
    }),

  goBack: () =>
    set((state) => {
      const stack = [...state.navStack];
      const prev = stack.pop() ?? null;
      return {
        currentFolderId: prev,
        navStack: stack,
        selectedNodeId: null,
        selectIntentId: null,
      };
    }),

  setActiveProject: (name) => {
    saveActiveProject(name);
    // 서버 appState 는 projectId(경로) 키 (v1.63) — 표시명 → path 로 변환해 기록. fire-and-forget.
    const st = get();
    const pid = st.projects[name]?.path ?? st.stubProjects[name]?.project.path ?? null;
    if (pid) void get().patchAppState({ lastActiveProject: pid });
    return set((state) => ({
      activeProject: name,
      currentProject: state.projects[name] ?? null,
      currentFolderId: null,
      navStack: [],
      selectedNodeId: null,
      selectIntentId: null,
      activeIframeId: null,
    }));
  },
  closeProject: async (projectId, name) => {
    try {
      // 표시명(로컬 활성탭 전환용) — 생략 시 projectId 로 역추론.
      const s0 = get();
      const pk = npStore(projectId);
      const displayName = name
        ?? Object.keys(s0.projects).find((k) => npStore(s0.projects[k]!.path) === pk)
        ?? Object.keys(s0.stubProjects).find((k) => npStore(s0.stubProjects[k]!.project.path) === pk)
        ?? projectId;
      // v1.63: 식별 = projectId(경로). 서버 resolveProjectRef 가 path 를 해소.
      const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
      if (!res.ok) return;
      // 닫은 프로젝트가 활성 탭이면 다른 프로젝트로 전환
      const state = get();
      if (state.activeProject === displayName) {
        const remaining = Object.keys(state.projects).filter((p) => p !== displayName);
        // stub 프로젝트도 후보에 포함 (hydrated 없으면 stub 탭으로)
        const nextHydrated = remaining[0] ?? null;
        const nextStub = Object.keys(state.stubProjects)[0] ?? null;
        const next = nextHydrated ?? nextStub;
        saveActiveProject(next);
        set({
          activeProject: next,
          currentProject: next ? (state.projects[next] ?? null) : null,
          currentFolderId: null,
          navStack: [],
          selectedNodeId: null,
          selectIntentId: null,
        });
      }
      // unload-project WS 발송 — 서버가 인메모리 그래프 해제 + stub 강등 broadcast.
      // projectName 에 projectId(경로) 전달 — 서버 unloadProject 가 ref 해소.
      const wsSend = get()._wsSend;
      if (wsSend) {
        wsSend({ type: 'unload-project', timestamp: Date.now(), payload: { projectName: projectId } });
      }
    } catch { /* 서버 응답 후 스냅샷이 오므로 별도 처리 불필요 */ }
  },
  hydrateProject: (name) => {
    set((s) => {
      if (s.hydratingProjects[name]) return {};
      return { hydratingProjects: { ...s.hydratingProjects, [name]: true } };
    });
    const wsSend = get()._wsSend;
    if (wsSend) {
      wsSend({ type: 'hydrate-project', timestamp: Date.now(), payload: { projectName: name } });
    }
  },
  applyStubProjects: (stubs) => set({ stubProjects: stubs }),
  onProjectHydrated: (name, success, reason) => {
    set((s) => {
      const next = { ...s.hydratingProjects };
      delete next[name];
      return { hydratingProjects: next };
    });
    if (!success) {
      console.warn(`[Vibisual] hydrate-project failed: ${name}${reason ? ` (${reason})` : ''}`);
    }
    // hydrate 성공 시 activeProject 전환은 다음 graph_snapshot broadcast에서 자동 반영
  },
  onProjectUnloaded: (name) => {
    // stub 강등은 다음 graph_snapshot broadcast에서 자동 반영.
    // 닫은 프로젝트가 현재 활성 탭이면 다른 hydrated 또는 stub로 전환
    set((s) => {
      if (s.activeProject !== name) return {};
      const remaining = Object.keys(s.projects).filter((p) => p !== name);
      const nextHydrated = remaining[0] ?? null;
      const nextStub = Object.keys(s.stubProjects)[0] ?? null;
      const next = nextHydrated ?? nextStub;
      saveActiveProject(next);
      return {
        activeProject: next,
        currentProject: next ? (s.projects[next] ?? null) : null,
        currentFolderId: null,
        navStack: [],
        selectedNodeId: null,
        selectIntentId: null,
      };
    });
  },
  setRunningServers: (servers: Record<string, ServerEntry[]>) => set({ runningServers: servers }),
  selectNode: (id) => set({ selectedNodeId: id, selectIntentId: id, selectedTaskEdgeId: null, selectedCommentBoxId: null }),
  setSelectIntent: (id) => set({ selectIntentId: id }),
  selectTaskEdge: (id) => set({ selectedTaskEdgeId: id, selectedNodeId: null, selectIntentId: null, selectedCommentBoxId: null }),
  selectCommentBox: (id) => set({ selectedCommentBoxId: id, selectedNodeId: null, selectIntentId: null, selectedTaskEdgeId: null }),
  setAgentPhase: (phase) => set({ agentPhase: phase }),

  // 상태는 서버 스냅샷이 관리 — 클라이언트에서 덮어쓰지 않음
  markAllIdle: () => {},

  iframeTabs: [],
  activeIframeId: null,
  detachedTabKeys: {},
  applyDetachedList: (list) =>
    set(() => {
      const next: Record<string, 'project' | 'iframe'> = {};
      for (const e of list) next[e.tabKey] = e.kind;
      return { detachedTabKeys: next };
    }),
  setActiveProjectLocal: (name) =>
    set((state) => ({
      activeProject: name,
      currentProject: name ? state.projects[name] ?? null : null,
      currentFolderId: null,
      navStack: [],
      selectedNodeId: null,
      selectIntentId: null,
      activeIframeId: null,
    })),
  setActiveIframeIdLocal: (id) => set(() => ({ activeIframeId: id })),
  openIframeTab: (tab) => set((state) => {
    const exists = state.iframeTabs.find((t) => t.id === tab.id);
    if (exists) return { activeIframeId: tab.id };
    return { iframeTabs: [...state.iframeTabs, tab], activeIframeId: tab.id };
  }),
  closeIframeTab: (id) => set((state) => {
    const tabs = state.iframeTabs.filter((t) => t.id !== id);
    const nextActive = state.activeIframeId === id ? null : state.activeIframeId;
    return { iframeTabs: tabs, activeIframeId: nextActive };
  }),
  setActiveIframeTab: (id) => set({ activeIframeId: id }),
  tabPins: loadJSON<Record<string, true>>(TAB_PINS_KEY, {}),
  setTabPin: (key, pinned) => set((state) => {
    const next = { ...state.tabPins };
    if (pinned) next[key] = true;
    else delete next[key];
    saveJSON(TAB_PINS_KEY, next);
    return { tabPins: next };
  }),
  defaultTabbarKey: loadJSON<string | null>(DEFAULT_TABBAR_KEY, null),
  setDefaultTabbar: (key) => set(() => {
    saveJSON(DEFAULT_TABBAR_KEY, key);
    return { defaultTabbarKey: key };
  }),
  defaultSubAgents: loadJSON<Record<string, string>>(DEFAULT_SUBAGENTS_KEY, {}),
  setDefaultSubAgent: (agentId, subAgentId) => set((state) => {
    const next = { ...state.defaultSubAgents };
    if (subAgentId) next[agentId] = subAgentId;
    else delete next[agentId];
    saveJSON(DEFAULT_SUBAGENTS_KEY, next);
    return { defaultSubAgents: next };
  }),
  subAgentLabels: loadJSON<Record<string, string>>(SUBAGENT_LABELS_KEY, {}),
  setSubAgentLabel: (subId, label) => set((state) => {
    const next = { ...state.subAgentLabels };
    const trimmed = label.trim();
    // 빈 이름은 사용자 지정 해제 → 서버 기본 라벨(Sub #N)로 복귀.
    if (trimmed) next[subId] = trimmed; else delete next[subId];
    saveJSON(SUBAGENT_LABELS_KEY, next);
    return { subAgentLabels: next };
  }),
  appState: null,
  applyAppState: (appState) => set({ appState: appState ?? null }),
  patchAppState: async (patch) => {
    try {
      await fetch(`${API_BASE}/api/app-state`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      // 서버가 broadcast snapshot 하므로 별도 로컬 set 불필요 — WS로 돌아옴
    } catch {
      // offline 등 — 서버 복구 후 다음 snapshot으로 재동기화되므로 무시
    }
  },
  debugMode: false,
  toggleDebug: () => set((s) => ({ debugMode: !s.debugMode })),
  layoutBoundsByProject: {},
  applyLayoutBoundsByProject: (map) =>
    set({ layoutBoundsByProject: map ?? {} }),
  setLayoutBoundsSize: (halfWidth, halfHeight) => {
    const hw = Math.min(8000, Math.max(300, Math.round(halfWidth)));
    const hh = Math.min(8000, Math.max(300, Math.round(halfHeight)));
    const proj = get().activeProject;
    if (!proj) return;
    set((s) => ({
      layoutBoundsByProject: { ...s.layoutBoundsByProject, [proj]: { hw, hh } },
    }));
    // 드래그 중 POST 금지 — broadcast 가 되돌아오며 리렌더 스태거가 생긴다.
    // 서버 영속화는 flushLayoutBoundsSize() 가 pointerup 에서 1회만 호출.
  },
  flushLayoutBoundsSize: () => {
    const proj = get().activeProject;
    if (!proj) return;
    const cur = get().layoutBoundsByProject[proj];
    if (!cur) return;
    void fetch(`${API_BASE}/api/layout-bounds/${encodeURIComponent(proj)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hw: cur.hw, hh: cur.hh }),
    }).catch(() => { /* 서버 복구 후 다음 snapshot 으로 재동기화 */ });
  },
  connectingFrom: null,
  setConnectingFrom: (id) => set({ connectingFrom: id }),
  taskEdgeDrag: null,
  startTaskEdgeDrag: (sourceId, clientX, clientY) => set({
    taskEdgeDrag: { sourceId, mouseX: clientX, mouseY: clientY, phase: 'drag' },
    connectingFrom: sourceId,
  }),
  updateTaskEdgeDrag: (clientX, clientY) => set((s) =>
    s.taskEdgeDrag ? { taskEdgeDrag: { ...s.taskEdgeDrag, mouseX: clientX, mouseY: clientY } } : {},
  ),
  setTaskEdgeDragFollow: () => set((s) =>
    s.taskEdgeDrag ? { taskEdgeDrag: { ...s.taskEdgeDrag, phase: 'follow' } } : {},
  ),
  endTaskEdgeDrag: () => set({ taskEdgeDrag: null, connectingFrom: null }),
  taskEdgeEditPopup: null,
  openTaskEdgeEdit: (edgeId, screenX, screenY) => set({ taskEdgeEditPopup: { edgeId, screenX, screenY } }),
  closeTaskEdgeEdit: () => set({ taskEdgeEditPopup: null }),

  taskEdgePreview: null,
  setTaskEdgePreview: (edgeId, overrides) => set({ taskEdgePreview: { edgeId, overrides } }),
  clearTaskEdgePreview: () => set({ taskEdgePreview: null }),

  requestFocus: () => set({ pendingFocus: true }),
  clearFocus: () => set({ pendingFocus: false }),
  focusOnNode: (id) => set({ focusNodeId: id }),
  clearFocusNode: () => set({ focusNodeId: null }),
  createCustomAgent: (canvasX, canvasY) => {
    const project = selectEffectiveProject(get());
    fetch(`${API_BASE}/api/create-custom-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: '', x: canvasX, y: canvasY, project }),
    }).catch(() => {});
  },
  // §4 v2.63 — CMD(인터랙티브 터미널) 에이전트. 동일 엔드포인트에 executionMode 플래그만 추가.
  createCmdAgent: (canvasX, canvasY) => {
    const project = selectEffectiveProject(get());
    fetch(`${API_BASE}/api/create-custom-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: '', x: canvasX, y: canvasY, project, executionMode: 'interactive-terminal' }),
    }).catch(() => {});
  },
  // §5.3 #10-2 v2.37 — Auto Agent
  createAutoAgent: (canvasX, canvasY) => {
    const project = selectEffectiveProject(get());
    fetch(`${API_BASE}/api/create-auto-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: '', x: canvasX, y: canvasY, project }),
    }).catch(() => {});
  },
  sendMessageToAutoAgent: (autoAgentSessionId, text) => {
    fetch(`${API_BASE}/api/auto-agent/${encodeURIComponent(autoAgentSessionId)}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch(() => {});
  },
  toggleAutoAgentQuestions: (autoAgentSessionId, enabled) => {
    fetch(`${API_BASE}/api/auto-agent/${encodeURIComponent(autoAgentSessionId)}/toggle-questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }).catch(() => {});
  },
  answerAutoAgentQuestions: (autoAgentSessionId, answers) => {
    fetch(`${API_BASE}/api/auto-agent/${encodeURIComponent(autoAgentSessionId)}/answer-questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    }).catch(() => {});
  },
  createPipeline: (type, canvasX, canvasY) => {
    const project = selectEffectiveProject(get());
    fetch(`${API_BASE}/api/create-pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, label: '', x: canvasX, y: canvasY, project }),
    }).catch(() => {});
  },
  createWorktree: (canvasX, canvasY) => {
    const project = selectEffectiveProject(get());
    const tempId = `pending-wt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    // 실제 worktree 노드(activity=0, status='idle', childCount=0)와 동일한 파라미터로
    // calcBubbleSize 결과를 일치시켜 placeholder↔real 전환 시 크기 점프 방지
    const placeholder: BubbleData = {
      id: tempId,
      label: 'Creating...',
      bubbleType: 'worktree',
      path: tempId,
      status: 'idle',
      activity: 0,
      childCount: 0,
      position: { x: canvasX, y: canvasY },
      creatingStatus: 'creating',
    };
    set((s) => ({ pendingWorktrees: [...s.pendingWorktrees, placeholder] }));

    fetch(`${API_BASE}/api/create-worktree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: canvasX, y: canvasY, project }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('create-worktree failed');
        const body = await res.json().catch(() => ({})) as { nodeId?: string };
        const realId = body.nodeId;
        // 실제 worktree 노드가 스냅샷에 등장할 때까지 placeholder 유지 → 도착 즉시 제거 (seamless)
        // 5초 타임아웃: 그래도 안 오면 강제 제거 (네트워크 장애 등 안전망)
        if (realId) {
          set((s) => ({
            pendingWorktrees: s.pendingWorktrees.map((p) =>
              p.id === tempId ? { ...p, path: realId } : p,
            ),
          }));
          const deadline = Date.now() + 5000;
          const poll = (): void => {
            const topFolders = get().topFolders;
            if (topFolders.some((f) => f.id === realId)) {
              get().removePendingWorktree(tempId);
              return;
            }
            if (Date.now() > deadline) { get().removePendingWorktree(tempId); return; }
            setTimeout(poll, 80);
          };
          poll();
        } else {
          // 구버전 서버 호환 — nodeId 없으면 기존 delay 방식
          setTimeout(() => get().removePendingWorktree(tempId), 400);
        }
      })
      .catch(() => {
        get().setPendingWorktreeError(tempId);
      });
  },
  pendingWorktrees: [],
  removePendingWorktree: (id) => set((s) => ({
    pendingWorktrees: s.pendingWorktrees.filter((p) => p.id !== id),
  })),
  setPendingWorktreeError: (id) => {
    set((s) => ({
      pendingWorktrees: s.pendingWorktrees.map((p) =>
        p.id === id ? { ...p, label: 'Failed', creatingStatus: 'error' as const } : p,
      ),
    }));
    setTimeout(() => get().removePendingWorktree(id), 2200);
  },
  worktreeDeleteTarget: null,
  requestWorktreeDelete: (nodeId, label) => set({ worktreeDeleteTarget: { nodeId, label } }),
  closeWorktreeDelete: () => set({ worktreeDeleteTarget: null }),
  subAgentStreams: {},
  appendStreamEvent: (event) => set((s) => {
    const prev = s.subAgentStreams[event.subAgentId];
    const next = prev ? [...prev, event] : [event];
    return { subAgentStreams: { ...s.subAgentStreams, [event.subAgentId]: next } };
  }),
  appendStreamEvents: (events) => set((s) => {
    if (events.length === 0) return {};
    // 단건 append 와 동일 머지(prev ? [...prev, ev] : [ev])를 도착 순서대로 누적 —
    // 페어링(tool_use↔tool_result)이 의존하는 순서 보존. 객체 spread 1회 + set 1회로 묶는다.
    const nextStreams: Record<string, SubAgentStreamEvent[]> = { ...s.subAgentStreams };
    for (const event of events) {
      const prev = nextStreams[event.subAgentId];
      nextStreams[event.subAgentId] = prev ? [...prev, event] : [event];
    }
    return { subAgentStreams: nextStreams };
  }),
  loadStreamBuffers: (buffers) => set((s) => ({
    subAgentStreams: { ...s.subAgentStreams, ...buffers },
  })),
  ideOverlays: {},
  openIDEOverlay: (agentId) => set((state) => {
    // 우선순위: (1) 마지막 활성 서브에이전트 → (2) Default 서브에이전트 → (3) null
    const subAgents = state.subAgents[agentId] ?? [];
    const exists = (subId: string): boolean => subAgents.some((s) => s.id === subId);
    const lastActive = state.selectedSubByAgent[agentId];
    const defaultSub = state.defaultSubAgents[agentId];
    const initialSession =
      (lastActive && exists(lastActive) ? lastActive : null)
      ?? (defaultSub && exists(defaultSub) ? defaultSub : null);
    // IDE 를 소유하는 프로젝트 = 에이전트가 속한 프로젝트(없으면 현재 활성 프로젝트로 폴백).
    const ownerProject = state.agentProjects[agentId] ?? state.activeProject;
    if (!ownerProject) return {}; // 소속 프로젝트 미상이면 무시
    const prev = state.ideOverlays[ownerProject];
    // §5.5 #17-1 (v2.17) — 같은 프로젝트의 IDE 가 이미 우측 도킹 상태면 agentId 만 교체 + dockedRight/dockWidth 유지.
    const wasOpen = !!prev?.agentId;
    const keepDock = wasOpen && !!prev?.dockedRight;
    return {
      ideOverlays: {
        ...state.ideOverlays,
        [ownerProject]: {
          agentId,
          projectId: ownerProject,
          activeSessionId: initialSession,
          activeView: 'terminal',
          sidebarCollapsed: true,
          dockedRight: keepDock,
          dockWidth: keepDock ? (prev?.dockWidth ?? 480) : 480,
        },
      },
    };
  }),
  closeIDEOverlay: () => set((state) => {
    // 닫기는 현재 활성 프로젝트의 슬롯 대상. 슬롯 자체 제거 = 깨끗한 초기 상태로 복귀.
    const proj = state.activeProject;
    if (!proj || !state.ideOverlays[proj]) return {};
    const next = { ...state.ideOverlays };
    delete next[proj];
    return { ideOverlays: next };
  }),
  setIDEDocked: (docked, dockWidth) => set((s) => {
    const proj = s.activeProject;
    if (!proj) return {};
    const cur = s.ideOverlays[proj];
    if (!cur) return {};
    return {
      ideOverlays: {
        ...s.ideOverlays,
        [proj]: { ...cur, dockedRight: docked, dockWidth: dockWidth ?? cur.dockWidth },
      },
    };
  }),
  setIDEActiveSession: (sessionId) => set((s) => {
    const proj = s.activeProject;
    if (!proj) return {};
    const cur = s.ideOverlays[proj];
    if (!cur) return {};
    const next: Partial<GraphState> = {
      ideOverlays: {
        ...s.ideOverlays,
        [proj]: { ...cur, activeSessionId: sessionId },
      },
    };
    // sticky 선택 맵 동시 업데이트 — IDE 오버레이가 닫혀도 버블이 이 선택을 유지
    if (cur.agentId && sessionId) {
      next.selectedSubByAgent = { ...s.selectedSubByAgent, [cur.agentId]: sessionId };
    }
    // 탭 클릭 = 완료 알림 확인 — 도트가 녹색이었으면 회색으로 전환되도록 ack 마킹
    if (sessionId && !s.acknowledgedSubAgents[sessionId]) {
      next.acknowledgedSubAgents = { ...s.acknowledgedSubAgents, [sessionId]: true };
      saveJSON(ACK_SUBAGENTS_KEY, next.acknowledgedSubAgents);
    }
    return next;
  }),
  selectedSubByAgent: {},
  selectSubForAgent: (agentId, subId) => set((s) => ({
    selectedSubByAgent: { ...s.selectedSubByAgent, [agentId]: subId },
  })),
  setIDEActiveView: (view) => set((s) => {
    const proj = s.activeProject;
    if (!proj) return {};
    const cur = s.ideOverlays[proj];
    if (!cur) return {};
    return {
      ideOverlays: { ...s.ideOverlays, [proj]: { ...cur, activeView: view } },
    };
  }),
  toggleIDESidebar: () => set((s) => {
    const proj = s.activeProject;
    if (!proj) return {};
    const cur = s.ideOverlays[proj];
    if (!cur) return {};
    return {
      ideOverlays: { ...s.ideOverlays, [proj]: { ...cur, sidebarCollapsed: !cur.sidebarCollapsed } },
    };
  }),
  uiLocale: DEFAULT_UI_LOCALE,
  applyUiLocale: (locale) => {
    set({ uiLocale: locale });
    changeUiLocale(locale);
  },
  applyV150Metrics: (recentToolDurations, compactCounts, rateLimits) => set({
    recentToolDurations: recentToolDurations ?? {},
    compactCounts: compactCounts ?? {},
    rateLimits: rateLimits ?? null,
  }),
  applySkillUsageCounts: (counts) => set({ skillUsageCounts: counts ?? {} }),
  applyAutoAgentSummaries: (summaries) => set({ autoAgentSummaries: summaries ?? {} }),
  applyAgentReports: (reports) => set({ agentReports: reports ?? {} }),
  applyAgentQuestions: (questions) => set({ agentQuestions: questions ?? {} }),
  applyAgentReviews: (reviews) => set({ agentReviews: reviews ?? {} }),
  applyDiagnosticLog: (log) => set({ diagnosticLog: log ?? [] }),
  applyModelRegistry: (reg) => set({ modelRegistry: reg ?? null }),
  applyUserDefaults: (d) => set({ userDefaults: d ?? null }),
  setUiLocale: async (locale) => {
    const res = await fetch(`${API_BASE}/api/ui-locale`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale }),
    });
    if (res.ok) {
      get().applyUiLocale(locale);
    }
  },

  // §5.3 #12-1 v1.43 — 권한 승인 스택
  pendingPermissions: {},
  addPendingPermission: (req) => set((s) => ({
    pendingPermissions: { ...s.pendingPermissions, [req.requestId]: req },
  })),
  removePendingPermission: (requestId) => set((s) => {
    if (!(requestId in s.pendingPermissions)) return s;
    const next = { ...s.pendingPermissions };
    delete next[requestId];
    return { pendingPermissions: next };
  }),
  setPendingPermissions: (list) => set(() => ({
    pendingPermissions: Object.fromEntries(list.map((r) => [r.requestId, r])),
  })),
  respondPermission: async (requestId, decision, reason) => {
    // 낙관적 제거 — 서버 응답 오면 broadcast 도 removePendingPermission 호출하지만 noop.
    get().removePendingPermission(requestId);
    try {
      await fetch(`${API_BASE}/api/permission-decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, decision, reason }),
      });
    } catch {
      // 서버 끊김 — 이미 제거했으니 다음 스냅샷/재연결 시 pending 재수신
    }
  },

  // §5.3 #12-2 v2.26 — AskUserQuestion 카드 큐
  pendingAskQuestions: {},
  addPendingAskQuestion: (req) => set((s) => ({
    pendingAskQuestions: { ...s.pendingAskQuestions, [req.requestId]: req },
  })),
  removePendingAskQuestion: (requestId) => set((s) => {
    if (!(requestId in s.pendingAskQuestions)) return s;
    const next = { ...s.pendingAskQuestions };
    delete next[requestId];
    return { pendingAskQuestions: next };
  }),
  setPendingAskQuestions: (list) => set(() => ({
    pendingAskQuestions: Object.fromEntries(list.map((r) => [r.requestId, r])),
  })),
  respondAskQuestion: async (requestId, answers) => {
    get().removePendingAskQuestion(requestId);
    try {
      await fetch(`${API_BASE}/api/ask-user-question/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, answers }),
      });
    } catch {
      // 서버 끊김 — 다음 재연결 시 /api/ask-user-question/pending 복구
    }
  },

  // §5.7 #23-1 v1.59 — Claude Code 버전 체크 게이트
  claudeVersion: null,
  claudeVersionChecked: false,
  claudeVersionDismissed: false,
  claudeVersionModalOpen: false,
  claudeInstallProgress: null,

  ensureClaudeVersionChecked: async () => {
    const s = get();
    if (s.claudeVersionDismissed) return;
    if (s.claudeVersionModalOpen) {
      // 이미 모달이 떠 있다 — 사용자 결정까지 polling 으로 대기.
      await new Promise<void>((resolve) => {
        const unsub = useGraphStore.subscribe((st) => {
          if (!st.claudeVersionModalOpen) {
            unsub();
            resolve();
          }
        });
      });
      return;
    }

    let info = s.claudeVersion;
    if (!s.claudeVersionChecked) {
      try {
        const r = await fetch(`${API_BASE}/api/claude-version`);
        const data = await r.json() as { ok: boolean; info?: import('@vibisual/shared').ClaudeVersionInfo };
        if (data.ok && data.info) {
          info = data.info;
          set({ claudeVersion: data.info, claudeVersionChecked: true });
        } else {
          // 체크 자체 실패 — 게이트 통과 (사용자 작업 막지 말 것)
          set({ claudeVersionChecked: true });
          return;
        }
      } catch {
        set({ claudeVersionChecked: true });
        return;
      }
    }

    if (!info || !info.isOutdated) return;

  },

  setClaudeInstallProgress: (p) => set({ claudeInstallProgress: p }),

  installClaudeVersion: async () => {
    try {
      const r = await fetch(`${API_BASE}/api/claude-version/install`, { method: 'POST' });
      const data = await r.json() as { ok: boolean; progress?: import('@vibisual/shared').ClaudeInstallProgress };
      if (data.ok && data.progress) {
        set({ claudeInstallProgress: data.progress });
      }
    } catch {
      // WS 가 진행 push 하므로 REST 실패해도 무시
    }
  },

  dismissClaudeVersion: () => {
    set({ claudeVersionDismissed: true, claudeVersionModalOpen: false });
    void fetch(`${API_BASE}/api/claude-version/dismiss-session`, { method: 'POST' }).catch(() => {});
  },
}));
