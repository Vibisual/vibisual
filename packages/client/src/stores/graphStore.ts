import { create } from 'zustand';
// §5.5 #17-20 ⑩ v4.94 — 중단점을 켜고 끄면 붙어 있는 세션에도 바로 밀어 넣는다(단방향: graphStore → debugSessions).
import { useDebugSessions, pushBreakpointsToSession } from './debugSessions.js';
import type { BubbleData, ActivityEdge, BashEntry, ServerEntry, AgentEvent, FileEdit, AgentPhase, ProjectInfo, QueuedCommand, SubAgent, RunningSubagentTask, FinishedSubagentTask, ServerKind, PipelineType, PipelineState, AgentConfig, SubAgentStreamEvent, TaskEdge, TaskEdgeForwardMode, TaskEdgeKind, TaskEdgeMessageFormat, TaskEdgeReturnFormat, TaskEdgePriority, TaskEdgeCritiqueTiming, TaskEdgeCritiqueAuthority, TaskEdgeCommandMode, UiLocale, ProjectMetaSnapshot, AppState, AppStatePatch, CommentBox, CaptureBubble, DebugBreakpoint, AppBubble, PlayBubble, PlayRecipeCandidate, SpecDoc, LabRun, LabVariantConfig, ShelfBubble, ShelfItem, ShelfItemKind, ProjectCostMap, ProjectAuditLog, AuditBoundaryConfig, Conti, ActiveContiWork, ContiRenderStatus, StoryboardPresetId, ToolDurationEntry, CompactCount, RateLimitInfo,
  ClaudeUsageInfo, ClaudeAuthStatus, ClaudeSetupState, ClaudeSetupProgress, DiagnosticEntry, AutoAgentSummary, AutoAgentRun, ModelRegistry, LocalLlmState, LocalEngineProgress, LocalModelDownloadProgress, UserDefaults, AgentReport, AgentQuestions, AgentReview, ReviewRequest, AgentList, AgentFeedback, AgentFeedbackTargetType, AgentFeedbackVerdict, BrainSummary, BrainInjectionEvent, BrainCard, BrainCardType, BrainCardScope, BrainCardStatus, PluginFactMap, VerificationRun, VerificationDemo, SessionLoop, SessionLoopMode, SessionLoopContextMode, SessionGoal, SessionGoalStatus, SessionGoalStepStatus } from '@vibisual/shared';
import type { StreamDensity, CommandDispatchMode, ProjectAgentCounts, SessionMemo } from '@vibisual/shared';
import { isReadOnlyHookAgent } from '@vibisual/shared';
// §4 (첫 실행 온보딩) ③ — 서버가 "고른 폴더가 없다"로 돌려보낸 409 를 알아본다.
import { isNoProjectFolderError } from '@vibisual/shared';
import { DEFAULT_UI_LOCALE, STREAM_EVENTS_MAX_PER_SESSION, STREAM_EVENTS_TRIM_SLACK, STREAM_EVENTS_MAX_PER_INACTIVE_SESSION, STREAM_INACTIVE_SESSIONS_MAX, DIAGNOSTIC_LOG_MAX, STREAM_DENSITIES, IDE_EDITOR_MAX_TABS, IDE_EDITOR_WIDTH, DIFF_COMMENT_MAX } from '@vibisual/shared';
import { changeUiLocale } from '../i18n/index.js';
import { calcFileSizeRange } from '../utils/sizeCalc.js';
import { clientPathKey } from '../utils/platform.js';
import { structuralShare } from './structuralShare.js';
import { diffSubAcknowledgements } from './subAckDiff.js';
import type { ReadingSettings } from '../components/IDE/reading/readingModel.js';
import {
  DEFAULT_READING_SETTINGS, DEFAULT_IDE_STREAM_DENSITY, DEFAULT_IDE_TEXT_ZOOM, normalizeReadingSettings,
} from '../components/IDE/reading/readingModel.js';
import { recordCommandHistory, dropSessionCommandHistory } from '../components/IDE/commandHistory.js';
import { insertEventInTurnOrder } from '../components/IDE/turnOrder.js';
import {
  IDE_DOCK,
  IDE_MAX_PANES,
  cascadeFloatGeoms,
  clampDockSize,
  clampFloatGeom,
  defaultDockSize,
  tileFloatGeoms,
  type DockedPane,
  type FloatGeom,
  type IDEDockSide,
  type Viewport,
} from '../components/IDE/ideDockLayout.js';
// §5.5 #17-6 (H) — 앱 안 ↔ 독립 창을 오갈 때 창이 들고 가는 짐(순수 함수·타입만).
import { handoffPanePatch, type HandoffTarget, type IDEPaneHandoff } from './idePaneHandoff.js';
import {
  switchEditorTabScope,
  setEditorTabsPinned,
  pruneEditorTabScopes,
  type EditorTabStash,
} from './editorTabScope.js';
// §5.5 #17-34 — 창 **안**의 화면 분할. 트리 연산은 전부 순수 모듈이 하고 스토어는 그 결과만 앉힌다.
import {
  adjacentCellId, cellIdForSession, closeCell, dropOnCell, findCell, listCells, makeCell, pruneCells,
  type SplitNode,
} from '../components/IDE/splitLayout.js';
import type { SplitDropSide } from '../components/IDE/splitDrop.js';
import type { FollowSkipReason } from '../components/IDE/editorFollow.js';
import type { DiffComment } from '../components/IDE/diffCommentPrompt.js';
import { clearCapturePlaytest } from './capturePlaytest.js';
import { resolveLocalEntry } from '../components/LocalModel/localModelEntry.js';

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

/**
 * §5.5 #17-25 v4.80 — 라이트박스가 연 이미지가 **아직 보내지 않은 입력창 첨부**일 때 그 자리.
 * 주석본을 저장하면 새 첨부를 붙이는 대신 이 항목을 교체한다(옛 파일은 지운다).
 * 이미 보낸 이미지(대화·상태바 썸네일)를 열었으면 undefined — 지난 기록은 손대지 않는다.
 */
export interface ImageLightboxAttachment {
  agentId: string;
  sessionId: string | null;
  tempId: string;
}
/**
 * §5.5 #17-25 ④-1 — 라이트박스가 연 이미지가 **디스크의 진짜 파일**일 때 그 자리.
 *
 * 첨부(`ImageLightboxAttachment`)와 갈라 두는 이유는 저장이 가는 곳이 다르기 때문이다 —
 * 첨부는 입력창으로, 이쪽은 그 파일 자체로 간다(`PUT /api/workspace-image`).
 */
export interface ImageLightboxWorkspaceFile {
  /** 프로젝트 루트 절대 경로 */
  root: string;
  /** 루트 기준 상대 경로 */
  path: string;
  /** 읽을 때 본 수정 시각 — 저장할 때 되돌려 보내 그 사이 변경을 판정 */
  mtimeMs: number;
  /** 원본 형식 그대로 구워 덮어쓸 수 있는가(png·jpeg·webp 만) */
  bakeable: boolean;
  /** 구울 MIME — `canvas.toBlob` 의 두 번째 인자 */
  mime: string;
}
export interface ImageLightboxState {
  url: string;
  attachment?: ImageLightboxAttachment;
  workspace?: ImageLightboxWorkspaceFile;
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
// IDE 본문(스트림/대화) 텍스트 줌 배율 — Ctrl+휠로 조절, 캔버스·창 UI 와 무관한 순수 클라 표시 환경설정.
//   localStorage 영속(앱·창 재시작 후에도 유지) + storage 이벤트로 다중 창 동기화. 캔버스 zoom 과 별개.
const IDE_TEXT_ZOOM_KEY = 'vibisual:ideTextZoom';
// §5.5 #17-27 — 내장 편집창 폭(px). 줌·밀도와 동형인 순수 클라 표시 환경설정(서버 미전달).
const IDE_EDITOR_WIDTH_KEY = 'vibisual:ideEditorWidth';
function clampIdeEditorWidth(w: number): number {
  if (!Number.isFinite(w)) return IDE_EDITOR_WIDTH.DEFAULT;
  return Math.min(IDE_EDITOR_WIDTH.MAX, Math.max(IDE_EDITOR_WIDTH.MIN, Math.round(w)));
}
// §5.5 #17-27 ⑪ — 편집창이 에이전트가 고치는 파일을 따라가는가([추종] 토글). 폭·밀도와 동형인
//   순수 클라 표시 환경설정(서버 미전달). 기본은 꺼짐 — 켜기 전까지 화면은 종전과 같아야 한다(#17-27 ①).
//   (g) 켜짐은 **세션마다** 따로다 — 값은 "켜진 세션키의 집합"(꺼면 키를 지운다)이라 저절로 작게 유지된다.
const IDE_EDITOR_FOLLOW_KEY = 'vibisual:ideEditorFollow';
/** 세션은 계속 새로 생기므로 켜 둔 기록이 무한히 쌓이지 않도록 상한을 둔다(오래된 것부터 정리). */
const IDE_FOLLOW_MAX_KEYS = 60;
/** localStorage 에서 읽어 온 켜짐 집합 정규화 — 옛 판(전역 boolean)이 남아 있어도 조용히 버린다. */
function normalizeFollowMap(raw: unknown): Record<string, true> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, true> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === true) out[key] = true;
  }
  return out;
}
const IDE_TEXT_ZOOM_MIN = 0.6;
const IDE_TEXT_ZOOM_MAX = 2.4;
function clampIdeTextZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(IDE_TEXT_ZOOM_MAX, Math.max(IDE_TEXT_ZOOM_MIN, z));
}
// §5.5 #17-12 — IDE 스트림 표시 밀도(간결/표준/원문). 줌과 동형인 순수 클라 표시 환경설정(서버 미전달).
const IDE_STREAM_DENSITY_KEY = 'vibisual:ideStreamDensity';
function normalizeStreamDensity(value: string | null | undefined): StreamDensity {
  return STREAM_DENSITIES.includes(value as StreamDensity) ? (value as StreamDensity) : 'standard';
}
// §5.5 — IDE 읽기 설정(폭 안·읽기 폭·행간·자간·어간·문단 간격·글꼴·모바일 자동 변형).
//   밀도·줌과 동형인 순수 클라 표시 환경설정(서버 미전달). 값 검증은 readingModel 이 전담한다.
const IDE_READING_KEY = 'vibisual:ideReading';
const DEFAULT_SUBAGENTS_KEY = 'vibisual:defaultSubAgents';
const TAB_PINS_KEY = 'vibisual:tabPins';
const SUBAGENT_LABELS_KEY = 'vibisual:subAgentLabels';
// 서브에이전트 완료 확인(ack) 상태 — 재시작 후에도 "확인함(회색)" 이 유지되도록 localStorage 영속.
// 없으면 부팅 시 메모리 기본값 {} 으로 시작 → idle sub 들이 전부 미확인(녹색)으로 회귀.
const ACK_SUBAGENTS_KEY = 'vibisual:ackSubAgents';
// IDE 북마크 — 사용자가 IDE 출력에서 선택한 텍스트를 보관(말풍선 카드). 재시작 후에도 유지되도록
// localStorage 영속(서버 비관여 — 순수 클라 기능).
// §5.5 #17-7 (프로젝트별로 갈라 담기) — 값 = BookmarkStore(프로젝트 표시명 → IDEBookmark[]).
//   종전의 전역 단일 배열도 같은 키에 남아 있으므로 loadBookmarks 가 읽을 때 한 번 갈라 담는다.
const IDE_BOOKMARKS_KEY = 'vibisual:ideBookmarks';
// §5.5 #17-4 v2.93 — SkillsView "본 적 있는 스킬" 집합(키=`source:name`). 미클릭 신규 스킬을
// 다른 색으로 표시하기 위함. localStorage 영속(순수 클라). initialized=false 면 첫 로드 시 현재
// 보이는 전 스킬을 시드(전체 깜빡임 방지), 이후 추가분만 신규로 취급.
const SKILLS_SEEN_KEY = 'vibisual:skillsSeenSkills';

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

/**
 * projectId 정규화 — 서버 appState(경로키)와 동일 semantics (v1.63).
 * 대소문자는 **그 OS 의 파일시스템이 실제로 무시할 때만** 접는다 — Linux 에서 무조건 접으면
 * 케이스만 다른 두 프로젝트가 한 탭 키로 뭉개진다(판정 utils/platform.ts · 규칙 shared pathCase).
 */
function npStore(p: string): string {
  return clientPathKey(p);
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

/**
 * §5.5 #17-20 ⑩ / #17-27 ⑨ — 중단점 목록을 확정한다: 화면 먼저 → 서버 저장 → 붙어 있는 세션에 주입.
 * 한 줄을 켜고 끄는 일(`toggleBreakpoint`)과 파일 단위로 지우는 일(`clearBreakpointsInFile`)이
 * **같은 뒤처리**를 쓰도록 여기 한 곳에 둔다 — 저장 경로가 둘이면 그중 하나는 반드시 뒤처진다.
 */
function commitBreakpoints(
  set: (updater: (s: GraphState) => Partial<GraphState>) => void,
  get: () => GraphState,
  projectName: string,
  next: DebugBreakpoint[],
): void {
  // 화면에 먼저 반영 — 클릭이 서버 왕복만큼 늦게 보이면 "안 눌렸다" 로 느껴진다.
  set((s) => ({ debugBreakpoints: { ...s.debugBreakpoints, [projectName]: next } }));
  void fetch('/api/debug/breakpoints', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectName, breakpoints: next }),
  }).catch(() => { /* 스냅샷이 진실 — 실패하면 다음 방송에서 원래 값으로 돌아온다 */ });
  // 붙어 있는 세션에는 **지금 바로** 밀어 넣는다 — 저장만 하면 다음에 붙을 때부터 걸린다.
  const projectPath = get().projects[projectName]?.path;
  for (const session of Object.values(useDebugSessions.getState().sessions)) {
    if (session.status === 'ended') continue;
    if (projectPath && session.projectPath !== projectPath) continue;
    void pushBreakpointsToSession(session.sessionId, next);
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

// v2.x perf — 입력 영속화 debounce.
//   기존엔 setAgentSessionInputText 가 키 입력마다 동기 localStorage.setItem 을 호출했다.
//   draft 텍스트가 길어질수록 JSON.stringify 비용이 키당 O(n) → 긴 명령 타이핑이 O(n²) 로
//   점점 느려지고(IME 합성 프레임 사이를 디스크 I/O 가 막아) "버버버벅" 끊겼다.
//   in-memory store(=controlled textarea 의 즉시 echo)는 동기로 두고, localStorage 쓰기만
//   trailing debounce 로 미뤄 타이핑 핫패스에서 동기 I/O 를 제거한다.
//   clear/take(제출·정리)도 같은 스케줄러를 거쳐 "마지막 맵이 이긴다" — 타이핑 debounce 가
//   뒤늦게 발화해 이미 비운 draft 를 되살리는 race 를 막는다. 탭 숨김/종료 시 즉시 flush.
let pendingDraftSave: Record<string, AgentSessionInputDraft> | null = null;
let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;

function flushSessionInputDrafts(): void {
  if (draftSaveTimer !== null) {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
  }
  if (pendingDraftSave !== null) {
    saveSessionInputDrafts(pendingDraftSave);
    pendingDraftSave = null;
  }
}

function scheduleSaveSessionInputDrafts(drafts: Record<string, AgentSessionInputDraft>): void {
  pendingDraftSave = drafts;
  if (draftSaveTimer !== null) return;
  draftSaveTimer = setTimeout(() => {
    draftSaveTimer = null;
    if (pendingDraftSave !== null) {
      saveSessionInputDrafts(pendingDraftSave);
      pendingDraftSave = null;
    }
  }, 400);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushSessionInputDrafts);
  window.addEventListener('beforeunload', flushSessionInputDrafts);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSessionInputDrafts();
  });
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

/**
 * §4 (첫 실행 온보딩) ③ — 캔버스에서 무언가를 **만들기 전에** 프로젝트 폴더를 확인한다.
 *
 * 폴더가 없으면 요청을 보내지 않고 그 자리에서 폴더 선택 게이트를 연다. 예전에는 그냥 보냈고,
 * 서버는 `process.cwd()` 를 임시 프로젝트로 등록해 **이름이 빈 탭 하나와 파일시스템 루트에 매인
 * 에이전트**를 만들어 줬다 — 사용자에게는 "폴더를 고른 적도 없는데 빈 것이 생성됐다" 로 보인다.
 *
 * 화면 쪽 확인은 **왕복 없이 즉시 안내하기 위한 것**이고, 진짜 방어는 서버의 409 다(아래 `postCreate`).
 * 둘 다 있어야 캔버스 밖 경로(모바일 웹·원격조작)로 들어와도 같은 답을 본다.
 */
function requireProjectFolder(get: () => GraphState): boolean {
  const s = get();
  if (Object.keys(s.projects).length > 0 || Object.keys(s.stubProjects).length > 0) return true;
  s.setProjectGate({ forced: true, dismissed: false, reason: 'create-blocked' });
  return false;
}

/**
 * 생성 REST 공통 전송 — 서버가 "폴더부터 고르라"(409)로 돌려보내면 폴더 게이트를 연다.
 *
 * 화면 판정(`requireProjectFolder`)을 통과하고도 여기서 막힐 수 있다: 클라의 프로젝트 목록은
 * 스냅샷이라 방금 닫은 탭이 아직 남아 있을 수 있고, 그 사이 서버는 이미 비어 있다. 그 어긋남을
 * 사용자에게 "아무 일도 안 일어남" 으로 보여 주지 않으려면 실패도 같은 창으로 데려가야 한다.
 */
async function postCreate(path: string, body: unknown, get: () => GraphState): Promise<Response | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 409) {
      const data = await res.json().catch(() => null);
      if (isNoProjectFolderError(data)) {
        get().setProjectGate({ forced: true, dismissed: false, reason: 'create-blocked' });
      }
      return res;
    }
    return res;
  } catch {
    // 서버 끊김 — 종전처럼 조용히 넘긴다(연결 상태는 헤더가 이미 보여 준다).
    return null;
  }
}

/**
 * §5.10 v3.70 — 활성 프로젝트의 두뇌 요약(없으면 null).
 * 카드는 `<projectPath>/.vibisual/brain/` 로 프로젝트별로 갈라져 저장되고 Brain 버블은 최상위 캔버스에
 * 활성 프로젝트 것 1개만 상주하므로(폴더 내부 표시 ❌), 요약도 activeProject 키로만 읽는다.
 * 다른 프로젝트 카드까지 합산해 보여주면 프로젝트를 전환해도 숫자가 안 변하는 오표시가 된다.
 */
export function selectActiveBrainSummary(state: { brain: Record<string, BrainSummary>; activeProject: string | null }): BrainSummary | null {
  return (state.activeProject ? state.brain[state.activeProject] : null) ?? null;
}

/**
 * §5.11 v4.54 — 플러그인 켬/끔을 매달 **프로젝트 키**(= 루트 절대경로).
 *
 * `activeProject` 는 표시명이라 basename 충돌 시 세션 간 바뀔 수 있어 영속 키로 못 쓴다. 그래서 여기서
 * 한 번만 `ProjectInfo.path` 로 바꿔 주고, 창·호스트가 **모두 이 값**을 쓴다(둘이 다른 키를 쓰면
 * 창에서 켠 것이 캔버스에 안 나타난다). stub 프로젝트(아직 hydrate 전)도 경로는 알고 있으므로 함께 본다.
 *
 * 워크트리 드릴다운(`selectEffectiveProject`)을 쓰지 않는 이유: 워크트리는 같은 프로젝트의 격리 사본이라
 * 폴더 안으로 들어갔다고 켠 카드가 달라지면 사용자가 이유를 알 수 없다.
 */
export function selectActivePluginProjectPath(state: {
  activeProject: string | null;
  projects: Record<string, ProjectInfo>;
  stubProjects: Record<string, ProjectMetaSnapshot>;
}): string | null {
  const name = state.activeProject;
  if (!name) return null;
  return state.projects[name]?.path ?? state.stubProjects[name]?.project.path ?? null;
}

/**
 * §5.10 v2 (H) — 두뇌 활성화(마스터·축·1회 안내 기록)를 매달 **프로젝트 키**(= 루트 절대경로).
 *
 * 플러그인 켬/끔과 **같은 규약**을 쓴다. `UserDefaults.brainByProject` 의 키는 서버가 적는 절대경로인데
 * `activeProject` 는 표시명이라, 표시명으로 조회하면 서버가 적어 둔 `enabled`·`promptedAt` 을 화면이
 * 영영 못 찾는다 — 켜도 두뇌 버블이 안 뜨고, "지금은 그만"으로 거절해도 안내 배너가 매번 다시 떴다.
 * 판정 키는 여기 한 곳에서만 만든다.
 */
export function selectActiveBrainProjectPath(state: {
  activeProject: string | null;
  projects: Record<string, ProjectInfo>;
  stubProjects: Record<string, ProjectMetaSnapshot>;
}): string | null {
  return selectActivePluginProjectPath(state);
}

/**
 * §5.11 v4.65 — 활성 프로젝트에서 집행이 실제로 측정한 값(pluginId → 실측 한 벌). 없으면 `undefined`.
 *
 * 키 비교를 정규화하는 이유: 켬/끔 키와 마찬가지로 같은 폴더가 대소문자·구분자만 달리 적힐 수 있고,
 * 그러면 값이 있는데도 카드가 "아직 측정 전"으로 보인다. 없음(`undefined`)과 빈 값은 **구분해서** 넘긴다 —
 * 카드가 "측정 전"과 "SSOT 없음"을 다르게 그려야 하기 때문이다.
 */
export function selectActivePluginFacts(state: {
  activeProject: string | null;
  projects: Record<string, ProjectInfo>;
  stubProjects: Record<string, ProjectMetaSnapshot>;
  pluginFacts: Record<string, Record<string, PluginFactMap>>;
}): Record<string, PluginFactMap> | undefined {
  const path = selectActivePluginProjectPath(state);
  if (!path) return undefined;
  // 케이스 접기는 플랫폼이 정한다 — Linux 에서 접으면 다른 폴더의 실측이 서로 섞인다.
  const norm = clientPathKey;
  const want = norm(path);
  const direct = state.pluginFacts[path];
  if (direct) return direct;
  for (const [k, v] of Object.entries(state.pluginFacts)) {
    if (norm(k) === want) return v;
  }
  return undefined;
}

/** iframe 탭 정보 */
export interface IframeTab {
  id: string;
  url: string;
  label: string;
  serverKind: ServerKind;
}

/** IDE 오버레이 사이드바 뷰 타입 — §5.5 #17-4 v2.32 에서 'skills', #17-11 ⑨ v4.51 에서 'loop'(덮개 패널 → 사이드바 뷰) 추가 */
// §5.5 #17-20 v4.74 — 'debug' = 디버그·실행 런처(실행 구성 목록 + MCP 연결 + 외부 디버거 위임).
// §5.5 #17-7·#17-8 v4.93 — 'bookmarks'·'summary' 도 루프(v4.51)와 같은 길로 왔다: 세션창을 덮던
//   패널을 폐지하고 활동바의 다른 항목과 같은 사이드바 뷰가 된다(덮개 토글 상태 2종 제거).
// §5.5 #17-28 v4.96 — 'events'(훅 이벤트 목록) 는 **'context'(컨텍스트 주입원 통제)** 로 대체됐다.
//   이벤트는 스트림·카드·목표창이 이미 보여 주고 있었고, 정작 볼 수 없던 것은 "이 프롬프트에 무엇이
//   얼마나 붙어 나가는가" 였다. 저장된 옛 값('events')은 부팅 시 'context' 로 이관한다(아래 selectIDEOverlay).
// §5.5 #17-9 ③ v4.95 — 'subagents'(실행 중 서브에이전트) 가 마지막 덮개였다. 같은 길로 보내면서
//   여닫는 상태가 이 프로젝트 슬롯의 activeView 로 들어가 **프로젝트·창마다 독립**이 된다.
// §5.5 #17-31 — 'terminal'(세션 목록) 은 **'mcp'(이 프로젝트에서 쓸 수 있는 MCP)** 로 대체됐다.
//   세션 목록은 탭 바(#17-5)·세션 요약(#17-8)이 이미 두 벌로 보여 주고 있었고, 앱 안에서 볼 길이
//   전혀 없던 것은 "무엇이 붙어 있고 무엇이 켜져 있는가" 였다. 저장된 옛 값('terminal')은 이관한다.
export type IDEViewType = 'mcp' | 'hooks' | 'plugins' | 'files' | 'context' | 'skills' | 'goal' | 'loop' | 'verify' | 'debug' | 'bookmarks' | 'summary' | 'subagents';

/** §5.5 #17-28 v4.96 · #17-31 — localStorage 에 남은 옛 뷰 id 를 지금 쓰는 것으로 옮긴다(모르는 값은 mcp). */
export function migrateIDEViewType(v: unknown): IDEViewType {
  if (v === 'events') return 'context';
  // #17-31 — 세션 목록 자리가 MCP 인벤토리로 바뀌었다. 이미 열려 있던 IDE 도 같은 칸을 본다.
  if (v === 'terminal') return 'mcp';
  const known: IDEViewType[] = ['mcp', 'hooks', 'plugins', 'files', 'context', 'skills', 'goal', 'loop', 'verify', 'debug', 'bookmarks', 'summary', 'subagents'];
  return known.includes(v as IDEViewType) ? (v as IDEViewType) : 'mcp';
}

/**
 * §5.5 #17-27 v4.87 — 내장 편집창에 열어 둔 파일 한 개(탭 하나).
 *
 * 여는 손잡이가 세 곳(탐색기 트리 · 편집한 파일 구역 · 스트림의 Edit 도구 헤더)이라
 * 절대 경로와 상대 경로를 **여는 쪽에서** 함께 실어 준다 — 편집창은 자기가 경로를 유추하지 않는다.
 */
export interface IDEEditorFile {
  /** 프로젝트 루트 기준 상대 경로 — 탭의 식별자 */
  relPath: string;
  /** 절대 경로 (외부 편집기로 열 때 그대로 쓴다) */
  absPath: string;
  /** 탭에 적는 이름(경로 마지막 조각) */
  name: string;
  /** 저장하지 않은 편집이 있는가 — 편집창이 신고한다(탭 점 표시 + 탭 밀어내기 예외 판정). */
  dirty?: boolean;
}

/**
 * §5.5 #17-27 ⑪ — "이 파일이 방금 이렇게 고쳐졌다" 는 편집창행 신호 한 건.
 *
 * 편집 신고(`fileEdits`)에서 편집창이 필요한 것만 뽑은 모양이다 — 어떤 탭을 다시 읽고(relPath),
 * 어느 줄로 스크롤할지 찾을 실마리(newString), 그리고 같은 편집을 두 번 처리하지 않기 위한 시각(at).
 */
export interface EditorFollowSignal {
  /** §5.5 #17-27 ⑪ (g) — 이 신호를 낸 세션. 다른 세션을 보고 있으면 편집창은 이 신호를 따르지 않는다. */
  sessionKey: string;
  relPath: string;
  absPath: string;
  /** 그 편집으로 파일에 들어간 글자 — 다시 읽은 본문에서 이걸 찾아 줄 번호를 낸다. */
  newString: string;
  /** 편집 완료(결과) 시각(ms) — 신호의 신원. 같은 값이면 이미 처리한 편집이다. */
  at: number;
}

/**
 * §5.5 #17-27 ⑪ (h) — 방금 따라간 자국. 강조가 꺼진 뒤에도 "무엇을 따라갔는지" 를 화면이 계속 말한다.
 * 줄 번호가 없으면(본문에서 새 글자를 못 찾은 경우) 파일만 열고 움직이지 않았다는 뜻이다.
 */
export interface EditorFollowMark {
  sessionKey: string;
  relPath: string;
  absPath: string;
  /** 탭에 적히는 짧은 이름(경로 마지막 조각). */
  name: string;
  startLine: number | null;
  endLine: number | null;
  /** 이미 열려 있던 탭을 **자동으로 다시 읽었는가** — "내가 안 건드렸는데 내용이 바뀌었다" 를 화면이 설명한다. */
  reloaded: boolean;
  at: number;
  /**
   * §5.5 #17-27 ⑪ (h) — **끝까지 못 간 이유**(끝까지 갔으면 `null`).
   * 조용히 넘어가면 "고장" 과 "따라갈 것이 없음" 이 사용자에게 같은 그림이 된다.
   */
  skip: FollowSkipReason | null;
}

/**
 * §5.5 #17-27 ⑪ (h) — 추종이 **꺼져 있는 동안** 그 세션이 마지막으로 고친, 따라갈 수 있었던 편집.
 *
 * **화면에 상주하지 않는다** — 켜는 순간 그리로 데려가기 위한 기억일 뿐이다(옛 판은 이 자리를 건수
 * 배지로 드러냈는데, 그 수가 스캔 창 밖으로 밀릴 때마다 줄어 흔들렸다). 켜는 행위가 곧 "저기로 가자"
 * 이므로 (e) 의 "자동으로 과거를 거슬러 오르지 ❌" 는 그대로다 — 방아쇠가 사용자다.
 */
export interface EditorFollowPending {
  sessionKey: string;
  relPath: string;
  absPath: string;
  name: string;
  /** 그 편집으로 들어간 글자 — 켜는 순간 곧바로 신호로 옮겨 담는다. */
  newString: string;
  /** 마지막 편집의 완료 시각(ms). */
  at: number;
}

/**
 * (판올림 번호 발급 대기) 창 여러 개를 한 번에 정리하는 방식.
 *
 * `tile`·`cascade` 는 전부 떼어 늘어놓고, `tabRight`·`splitLeftRight` 는 붙여 모은다.
 * `undockAll` 은 자리를 그대로 둔 채 떼기만 한다(사용자가 잡아 둔 배치를 지우지 않는다).
 */
export type IDEWindowLayoutKind =
  | 'tile'
  | 'cascade'
  | 'tabRight'
  | 'splitLeftRight'
  | 'undockAll'
  | 'collapseAll'
  | 'expandAll';

/**
 * IDE 창 하나의 상태 — **팬 키** 단위로 보관한다(`ideOverlays[paneKey]`).
 *
 * §5.5 #17-1 (판올림 번호 발급 대기) 이전에는 키가 곧 `projectId` 라 프로젝트당 창이 하나였고,
 * 다른 버블을 열면 그 자리에서 내용만 바뀌었다. 이제 **주 창의 키는 종전대로 `projectId`** 이고
 * (이관·마이그레이션 ❌) 두 번째부터 `<projectId>::ide-N` 이 선다. 한 프로젝트의 창을 모으는
 * 기준은 키 문자열 파싱이 아니라 아래 `projectId` 필드다.
 */
export interface IDEOverlayState {
  /** 열려있는 에이전트 ID (null이면 닫힘) */
  agentId: string | null;
  /** 이 창의 슬롯 키(= ideOverlays 의 키). 주 창은 projectId 와 같다. */
  paneKey: string;
  /** 이 IDE 가 속한 프로젝트 ID. ideOverlays 의 키와 동일 — 일관성 보장용. */
  projectId: string | null;
  /** 현재 선택된 세션(SubAgent) ID (null이면 메인 세션) */
  activeSessionId: string | null;
  /** 사이드바 뷰 */
  activeView: IDEViewType;
  /** 사이드바 접힘 여부 */
  sidebarCollapsed: boolean;
  /**
   * §5.5 #17-1 — 붙어 있는 변. null 이면 안 붙어 있다(모달/플로팅).
   * 종전 `dockedRight: boolean` 을 네 변으로 넓힌 자리다.
   */
  dockSide: IDEDockSide | null;
  /** §5.5 #17-1 — 붙은 변 기준 두께(px). 좌/우는 폭, 상/하는 높이(종전 `dockWidth`). */
  dockSize: number;
  /** §5.5 #17-1 — 같은 변에 여러 창이 붙었을 때의 순서(작을수록 위/왼쪽). */
  dockOrder: number;
  /**
   * §5.5 #17-1 — 같은 변에서 이 창이 가져갈 **몫**(가중치, 기본 1).
   * 픽셀이 아니라 비율이라 앱 창 크기가 바뀌어도 사용자가 잡아 둔 배분이 유지된다.
   */
  dockSpan: number;
  /**
   * §5.5 #17-1 — 마지막으로 앞에 온 시각의 도장(단조 증가). 겹칠 때 앞뒤 순서이자
   * 창이 상한을 넘었을 때 **가장 오래 안 만진 창**을 고르는 기준이다(절대 z-index 가 아니다 —
   * 화면에 쓰는 값은 이 도장으로 매긴 **순위**라 헤더보다 위로 자라지 않는다).
   */
  z: number;
  /**
   * §5.5 #17-1 — 안 붙어 있을 때(모달/플로팅) 이 창이 놓인 자리·크기. null 이면 아직 자리를 정한 적이 없다.
   *
   * 종전에는 컴포넌트 로컬 상태뿐이라 **언마운트마다 초기화**됐다 — 접었다 펴거나 프로젝트 탭을
   * 옮겼다 돌아오면 사용자가 옮겨 둔 창이 화면 한가운데로 되돌아갔다. 자리는 사용자가 만든 배치다.
   */
  float: FloatGeom | null;
  /**
   * §5.5 #17-1 — 접어 둔 창. 접히면 **그리지도 않고 자리도 먹지 않는다**(캔버스가 그만큼 돌아온다).
   * 닫기와 다르다 — 붙어 있던 변·두께·열어 둔 파일이 그대로 남아 펴면 그 자리로 돌아온다.
   * 접힌 창을 잃어버리지 않도록 헤더 [창] 메뉴가 개수와 목록을 계속 들고 있다.
   */
  collapsed: boolean;
  /**
   * §5.5 #17-1 — 이 창이 처음 뜰 때의 모양. 프로젝트의 **첫 창**은 종전대로 중앙 모달이고,
   * 이미 창이 있는데 새로 여는 창은 곧바로 **플로팅**으로 뜬다(모달은 캔버스를 통째로 덮어
   * "옆에 놓고 같이 본다"는 목적과 정면으로 어긋난다).
   */
  openMode: 'modal' | 'floating';
  /**
   * §5.5 #17-27 — 내장 편집창에 열어 둔 파일들(탭 순서, 왼→오른쪽).
   * 파일을 여는 곳(사이드바·스트림)과 그리는 곳(우측 패널)이 서로 멀어 컴포넌트 로컬로는 이을 수 없어
   * `activeView`·`dockWidth` 와 같은 자리에 둔다(디스크 내용은 여기 없다 — 경로만 있다).
   */
  editorFiles: IDEEditorFile[];
  /** §5.5 #17-27 — 지금 보고 있는 탭의 relPath. null 이면 편집창이 닫혀 있다. */
  activeEditorPath: string | null;
  /**
   * §5.5 #17-27 ⑯ — [고정]. 켜져 있는 동안 탭 줄은 **세션을 따라 바뀌지 않는다**(지금 탭이 따라간다).
   * 꺼져 있으면 탭 묶음은 그 세션의 것이라 세션을 옮길 때마다 접히고 펴진다.
   */
  editorPinned: boolean;
  /**
   * §5.5 #17-27 ⑯ — 세션별로 **접어 둔** 탭 묶음(키 = 세션 id, 전체 보기는 `'main'`).
   * 지금 보고 있는 세션 것은 여기 없다 — 그것은 `editorFiles`/`activeEditorPath` 다.
   */
  editorTabsBySession: Record<string, EditorTabStash>;
}

/** IDE 닫힘/없음 상태 기본값. selectIDEOverlay 가 미보유 프로젝트에 대해 반환. */
export const DEFAULT_IDE_OVERLAY: IDEOverlayState = {
  agentId: null,
  paneKey: '',
  projectId: null,
  activeSessionId: null,
  activeView: 'mcp',
  sidebarCollapsed: true,
  dockSide: null,
  dockSize: IDE_DOCK.DEFAULT_SIZE.x,
  dockOrder: 0,
  dockSpan: 1,
  z: 0,
  float: null,
  collapsed: false,
  openMode: 'modal',
  editorFiles: [],
  activeEditorPath: null,
  editorPinned: false,
  editorTabsBySession: {},
};

/**
 * §5.5 #17-34 — 한 IDE 창 **안**의 분할 상태. `ideSplits[슬롯키]` 에 산다.
 *
 * 항목 자체가 없으면 "분할 없음"이고, 그때 화면은 이 기능이 생기기 전과 픽셀 단위로 같다.
 * **두 칸 이상일 때만 존재한다** — 닫다가 한 칸만 남으면 항목을 지우고 그 세션을 창의 활성 세션으로
 * 돌려준다(칸이 하나뿐인데 칸 머리띠가 남아 있으면 "분할을 껐는데 안 꺼졌다"로 읽힌다).
 */
export interface IDESplitState {
  /** 이 분할이 붙어 있는 에이전트. 창이 다른 버블로 갈아 끼워지면 남은 분할은 무시된다(자가 치유). */
  agentId: string;
  layout: SplitNode;
  /** 초점 칸 — 창 단위 단축키와 탭바 선택이 이 칸을 따라간다. */
  focusedCellId: string | null;
}

/**
 * §5.5 #17-34 — 분할 트리를 앉히는 **유일한 창구**(모든 변형이 여기를 지난다).
 * 한 칸 이하로 줄면 분할을 접고, 마지막 칸이 보던 세션을 창이 그대로 이어받는다.
 */
function commitIDESplit(
  state: { ideSplits: Record<string, IDESplitState>; ideOverlays: Record<string, IDEOverlayState> },
  slotKey: string,
  agentId: string,
  layout: SplitNode | null,
  focusedCellId: string | null,
): Partial<GraphState> {
  const splits = { ...state.ideSplits };
  const cells = layout ? listCells(layout) : [];
  if (!layout || cells.length <= 1) {
    delete splits[slotKey];
    const slot = state.ideOverlays[slotKey];
    const only = cells[0];
    if (slot && only) {
      // §5.5 #17-27 ⑯ — 창의 세션이 바뀌는 자리는 여기도 마찬가지다. 탭 줄을 함께 갈지 않으면
      //   분할을 접는 순간 **남의 세션 탭**이 그대로 남는다(세션 탭으로 옮길 때와 다른 화면이 된다).
      const scoped = switchEditorTabScope(slot, slot.activeSessionId, only.sessionId);
      return {
        ideSplits: splits,
        ideOverlays: {
          ...state.ideOverlays,
          [slotKey]: { ...slot, ...scoped, activeSessionId: only.sessionId },
        },
      };
    }
    return { ideSplits: splits };
  }
  const focus = focusedCellId && cells.some((c) => c.id === focusedCellId)
    ? focusedCellId
    : (cells[0]?.id ?? null);
  splits[slotKey] = { agentId, layout, focusedCellId: focus };
  return { ideSplits: splits };
}

/**
 * §5.5 #17-1 — 지금 활성 프로젝트에서 **맨 앞에 있는** IDE 창.
 *
 * 창이 하나뿐이던 시절에는 "그 프로젝트의 슬롯"이 곧 답이었다. 창이 여럿이 된 뒤로 컨텍스트 밖
 * (북마크 점프·지휘통제실·클립보드 가드·디버그 계기판)에서 "그 IDE" 라고 말할 때 가리켜야 하는 것은
 * **마지막으로 앞에 온 창**이다. 주 창이 닫히고 둘째 창만 남은 상태에서 종전 산식은 아무것도 못 찾아
 * (슬롯 키가 프로젝트명이 아니므로) 세션 선택 같은 뒤따르는 동작이 조용히 아무 일도 안 했다.
 */
function frontPaneOf(state: {
  ideOverlays: Record<string, IDEOverlayState>;
  activeProject: string | null;
}): IDEOverlayState | undefined {
  const proj = state.activeProject;
  if (!proj) return undefined;
  let best: IDEOverlayState | undefined;
  for (const o of Object.values(state.ideOverlays)) {
    if (o.projectId !== proj || !o.agentId) continue;
    if (!best || o.z > best.z) best = o;
  }
  return best ?? state.ideOverlays[proj];
}

/**
 * 액션이 손댈 슬롯 키. 키를 명시하면 그 창, 안 주면 **맨 앞 창**(컨텍스트 밖 호출의 뜻).
 * 열린 창이 하나도 없으면 프로젝트명(=주 창 자리)으로 떨어진다.
 */
export function resolvePaneKey(
  state: { ideOverlays: Record<string, IDEOverlayState>; activeProject: string | null },
  paneKey?: string | null,
): string | null {
  if (paneKey) return paneKey;
  return frontPaneOf(state)?.paneKey || state.activeProject;
}

/** 현재 활성 프로젝트 탭에서 맨 앞에 있는 IDE 창의 상태를 반환. 없으면 기본값. */
export function selectIDEOverlay(state: {
  ideOverlays: Record<string, IDEOverlayState>;
  activeProject: string | null;
}): IDEOverlayState {
  if (!state.activeProject) return DEFAULT_IDE_OVERLAY;
  const cur = frontPaneOf(state);
  if (!cur) return DEFAULT_IDE_OVERLAY;
  // §5.5 #17-28 v4.96 — 저장돼 있던 옛 뷰 id('events')를 여기서 한 번 옮긴다. 읽는 길이 이 함수
  //   하나라 여기만 손보면 활동바·사이드바가 동시에 새 뷰를 가리킨다(빈 화면이 뜨지 않는다).
  const migrated = migrateIDEViewType(cur.activeView);
  return migrated === cur.activeView ? cur : { ...cur, activeView: migrated };
}

/** 팬 키로 그 창의 슬롯을 읽는다. 키가 없으면(컨텍스트 밖) 종전대로 활성 프로젝트의 주 창. */
export function selectIDEPane(
  state: { ideOverlays: Record<string, IDEOverlayState>; activeProject: string | null },
  paneKey: string | null | undefined,
): IDEOverlayState {
  if (!paneKey) return selectIDEOverlay(state);
  const cur = state.ideOverlays[paneKey];
  if (!cur) return DEFAULT_IDE_OVERLAY;
  const migrated = migrateIDEViewType(cur.activeView);
  return migrated === cur.activeView ? cur : { ...cur, activeView: migrated };
}

/**
 * §5.7 #26 — 이 IDE 창의 **내용이 딛고 선 프로젝트**(= 그 안 에이전트의 소속 프로젝트).
 *
 * `IDEOverlayState.projectId` 와 **뜻이 다르다**. `projectId` 는 창이 어느 탭의 캔버스에 매달려
 * 그려지는가(슬롯 주소)이고, 워크트리로 드릴다운해도 `activeProject` 는 부모 그대로이므로
 * `openIDEOverlay` 는 그 자리를 일부러 부모로 잡는다(안 그러면 창이 아예 안 보인다).
 * 그런데 탐색기 뿌리·실행 구성 스캔·실행 cwd·중단점 키까지 그 값을 쓰면, **워크트리 안에서 만든
 * 버블이 워크트리 밖 부모 트리를 읽고 그 트리에서 명령을 돌린다** — 격리가 통째로 무너진다.
 *
 * 그래서 "어디에 그리는가"(`projectId`)와 "무엇을 다루는가"(이 함수)를 갈라 둔다. 판정 기준은
 * 터미널(`IDETerminalView` 의 cwd)·사이드바가 이미 쓰는 것과 같은 `agentProjects[agentId]` 하나다.
 * 그 프로젝트를 아직 모르면(스냅샷 공백) 종전 산식으로 떨어져 화면이 비지 않게 한다.
 */
export function selectPaneProjectName(
  state: {
    ideOverlays: Record<string, IDEOverlayState>;
    activeProject: string | null;
    agentProjects: Record<string, string>;
    projects: Record<string, ProjectInfo>;
    stubProjects: Record<string, ProjectMetaSnapshot>;
  },
  paneKey: string | null | undefined,
): string | null {
  const pane = selectIDEPane(state, paneKey);
  const own = pane.agentId ? state.agentProjects[pane.agentId] : undefined;
  // 경로를 아는 프로젝트일 때만 채택한다 — 이름만 있고 경로가 없으면 뿌리를 못 만들어
  //   탐색기·편집창이 통째로 빈 화면이 된다(종전 폴백이 그 자리를 메운다).
  if (own && (state.projects[own] || state.stubProjects[own])) return own;
  return pane.projectId ?? state.activeProject;
}

/** 위 프로젝트의 **절대 경로**. 탐색기 뿌리·실행 cwd·파일 열기의 `root` 가 전부 이 값 하나를 쓴다. */
export function selectPaneProjectPath(
  state: {
    ideOverlays: Record<string, IDEOverlayState>;
    activeProject: string | null;
    agentProjects: Record<string, string>;
    projects: Record<string, ProjectInfo>;
    stubProjects: Record<string, ProjectMetaSnapshot>;
  },
  paneKey: string | null | undefined,
): string | null {
  const name = selectPaneProjectName(state, paneKey);
  if (!name) return null;
  return state.projects[name]?.path ?? state.stubProjects[name]?.project.path ?? null;
}

/** 지금 보고 있는 프로젝트에 열려 있는 IDE 창들 — 앞에 온 순서(z 오름차순, 마지막이 맨 앞). */
export function selectProjectIDEPanes(state: {
  ideOverlays: Record<string, IDEOverlayState>;
  activeProject: string | null;
}): IDEOverlayState[] {
  const proj = state.activeProject;
  if (!proj) return [];
  return Object.values(state.ideOverlays)
    .filter((o) => o.projectId === proj && !!o.agentId)
    .sort((a, b) => a.z - b.z);
}

/** 그 창들의 팬 키만 — 배열 신원이 매번 바뀌는 것을 피하려 화면은 이 키 목록만 구독한다. */
export function selectProjectIDEPaneKeys(state: {
  ideOverlays: Record<string, IDEOverlayState>;
  activeProject: string | null;
}): string[] {
  return selectProjectIDEPanes(state).map((o) => o.paneKey);
}

/** 지금 **화면에 그려지는** 창들(접힌 창 제외) — 겹침 순서·모달 강등 판정이 함께 읽는다. */
export function selectRenderedIDEPanes(state: {
  ideOverlays: Record<string, IDEOverlayState>;
  activeProject: string | null;
}): IDEOverlayState[] {
  return selectProjectIDEPanes(state).filter((o) => !o.collapsed);
}

/** 그 창들의 팬 키만 — `IDEPaneHost` 가 이 목록만큼만 그린다. */
export function selectRenderedIDEPaneKeys(state: {
  ideOverlays: Record<string, IDEOverlayState>;
  activeProject: string | null;
}): string[] {
  return selectRenderedIDEPanes(state).map((o) => o.paneKey);
}

/**
 * 슬롯은 살아 있는데 그 **에이전트가 스냅샷에 없는** 창들(삭제·휴지통·스냅샷 공백).
 *
 * `AgentIDEOverlay` 가 `null` 을 반환해 화면에는 아무것도 안 뜨는데 슬롯은 남는다 — 슬롯을
 * 자동으로 지우지는 않는다(스냅샷이 잠깐 비었다 돌아오면 IDE 도 돌아와야 하는 기존 규약).
 * 대신 헤더 [창] 메뉴가 이 목록을 함께 보여 **사용자가 직접 닫을 수 있게** 한다 — 안 그러면
 * 배지 숫자만 오른 채 어디서도 손댈 수 없는 유령 창이 남는다.
 */
export function selectOrphanIDEPanes(state: {
  ideOverlays: Record<string, IDEOverlayState>;
  activeProject: string | null;
  nodeMap: Record<string, BubbleData>;
}): IDEOverlayState[] {
  return selectProjectIDEPanes(state).filter((o) => !o.agentId || !state.nodeMap[o.agentId]);
}

/**
 * 지금 캔버스에 서 있는 **에이전트 버블 목록**(휴지통 제외).
 *
 * 판정은 캔버스(`BubbleMap`)와 **같은 산식**이다 — 워크트리로 드릴다운했으면 그 워크트리 프로젝트,
 * 아니면 활성 탭. 헤더 [창] 메뉴가 "붙인 창이 화면을 덮어 버블에 손이 안 닿을 때" 같은 목록을
 * 보여 주려면 두 곳이 갈라지면 안 된다.
 */
export function selectCanvasAgentBubbles(state: {
  agents: BubbleData[];
  agentProjects: Record<string, string>;
  currentFolderId: string | null;
  worktreeProjects: Record<string, string>;
  activeProject: string | null;
}): BubbleData[] {
  const proj = selectEffectiveProject(state);
  return state.agents.filter((a) => !a.trashed && (!proj || state.agentProjects[a.id] === proj));
}

/**
 * §5.5 #17-1 — 도킹이 **실제로 화면을 차지하는** 창들(캔버스를 그만큼 줄일 것인가).
 *
 * `AgentIDEOverlay` 는 슬롯의 에이전트가 스냅샷에 없으면(`nodeMap[agentId]` 부재 — 에이전트 삭제·
 * 휴지통·스냅샷 공백·사라진 대상으로의 북마크 점프) `null` 을 반환한다. 그래서 도킹 비트만 보고
 * 자리를 비우면 **IDE 는 안 그려지는데 캔버스만 잘린 빈 도크**가 남는다(사용자 보고: 북마크
 * 숫자키 점프 뒤 우측이 빈 칸으로 화면을 가림). 자리를 비우는 쪽(App `main` 여백 · DetailPanel
 * 좌/우 미러링)과 그리는 쪽이 **같은 산식**을 읽도록 판정을 여기 하나로 모은다.
 *
 * 슬롯 자체는 지우지 않는다 — 스냅샷이 잠깐 비었다가 돌아오면 IDE 도 그대로 돌아와야 한다.
 */
export function selectVisibleDockedPanes(state: {
  ideOverlays: Record<string, IDEOverlayState>;
  activeProject: string | null;
  nodeMap: Record<string, BubbleData>;
}): DockedPane[] {
  const out: DockedPane[] = [];
  for (const o of selectProjectIDEPanes(state)) {
    if (o.collapsed) continue; // 접힌 창은 안 그리므로 자리도 안 먹는다(캔버스가 그만큼 돌아온다).
    if (!o.dockSide || !o.agentId || !state.nodeMap[o.agentId]) continue;
    out.push({ paneKey: o.paneKey, side: o.dockSide, size: o.dockSize, order: o.dockOrder, span: o.dockSpan });
  }
  return out;
}

/**
 * 그 에이전트를 **띄우고 있는 창**의 활성 세션(없으면 null).
 * 창이 여럿이 된 뒤로 "IDE 의 활성 세션"은 하나가 아니다 — 버블은 자기를 띄운 창의 것을 봐야 한다.
 */
export function selectIDEActiveSessionForAgent(
  state: { ideOverlays: Record<string, IDEOverlayState>; activeProject: string | null },
  agentId: string,
): string | null {
  const proj = state.activeProject;
  if (!proj) return null;
  let best: IDEOverlayState | undefined;
  for (const o of Object.values(state.ideOverlays)) {
    if (o.projectId !== proj || o.agentId !== agentId) continue;
    if (!best || o.z > best.z) best = o;
  }
  return best?.activeSessionId ?? null;
}

/**
 * 지금 그려지는 도크들의 **지문**(원시 문자열). 화면은 이것만 구독하고 목록은 지문이 바뀔 때만 다시 만든다.
 *
 * `selectVisibleDockedPanes` 를 그대로 구독하면 매 호출 새 배열이라 zustand v5 가 "캐시되지 않은
 * 스냅샷"으로 보고, 원시 조각으로 나눠 구독하면 `nodeMap`(스냅샷마다 새 객체) 때문에 **App 전체가
 * 매 스냅샷 다시 그려진다**. 지문 한 줄이면 실제로 자리가 달라졌을 때만 다시 그린다.
 */
export function selectDockSignature(state: {
  ideOverlays: Record<string, IDEOverlayState>;
  activeProject: string | null;
  nodeMap: Record<string, BubbleData>;
}): string {
  let out = '';
  for (const p of selectVisibleDockedPanes(state)) out += `${p.paneKey}|${p.side}|${p.size}|${p.order}|${p.span};`;
  return out;
}

/** 그 변에 실제로 그려지는 도크가 있는가 — DetailPanel 좌/우 미러링 판정. */
export function selectDockSideOccupied(
  state: { ideOverlays: Record<string, IDEOverlayState>; activeProject: string | null; nodeMap: Record<string, BubbleData> },
  side: IDEDockSide,
): boolean {
  return selectVisibleDockedPanes(state).some((p) => p.side === side);
}

/**
 * 팬 키에 박힌 **열린 순번** — 탭 줄에서 창 순서를 고정하는 데 쓴다.
 *
 * 앞뒤 도장(`z`)은 누를 때마다 바뀌므로 탭 순서로 쓰면 탭이 손 밑에서 자리를 옮긴다.
 * 주 창(키=프로젝트명)은 늘 맨 앞(-1)이고, 나머지는 `::ide-N` 의 N 을 그대로 쓴다.
 */
export function idePaneKeySeq(paneKey: string): number {
  const at = paneKey.lastIndexOf('::ide-');
  if (at < 0) return -1;
  const n = Number(paneKey.slice(at + 6));
  return Number.isFinite(n) ? n : -1;
}

/**
 * (판올림 번호 발급 대기) **한 칸을 나눠 쓰는 창들**(언리얼식 탭 도킹) — 같은 변 + 같은 `dockOrder`.
 * 열린 순번으로 정렬해 돌려주므로 탭 줄이 앞뒤 도장 때문에 흔들리지 않는다.
 */
export function selectDockSlotPanes(
  state: { ideOverlays: Record<string, IDEOverlayState>; activeProject: string | null; nodeMap: Record<string, BubbleData> },
  paneKey: string,
): IDEOverlayState[] {
  const cur = state.ideOverlays[paneKey];
  if (!cur?.dockSide) return cur ? [cur] : [];
  return selectProjectIDEPanes(state)
    .filter((o) => !o.collapsed
      && o.dockSide === cur.dockSide
      && o.dockOrder === cur.dockOrder
      && !!o.agentId
      && !!state.nodeMap[o.agentId])
    .sort((a, b) => idePaneKeySeq(a.paneKey) - idePaneKeySeq(b.paneKey));
}

/**
 * 그 창이 속한 칸에서 **지금 앞에 있는(=그려지는) 창**의 키.
 *
 * 한 칸에 여러 창이 겹치면 보이는 것은 하나다. 그리는 쪽과 탭 강조가 이 함수 하나를 읽어야
 * "탭은 A 가 켜져 있는데 내용은 B" 같은 어긋남이 생기지 않는다.
 */
export function selectDockSlotFrontKey(
  state: { ideOverlays: Record<string, IDEOverlayState>; activeProject: string | null; nodeMap: Record<string, BubbleData> },
  paneKey: string,
): string {
  const mates = selectDockSlotPanes(state, paneKey);
  if (mates.length <= 1) return paneKey;
  let best = mates[0]!;
  for (const o of mates) if (o.z > best.z) best = o;
  return best.paneKey;
}

/** 그 칸의 탭 줄 **지문**(원시 문자열) — 배열을 직접 구독하지 않기 위한 규약(선택자 캐시 함정). */
export function selectDockSlotSignature(
  state: { ideOverlays: Record<string, IDEOverlayState>; activeProject: string | null; nodeMap: Record<string, BubbleData> },
  paneKey: string,
): string {
  const mates = selectDockSlotPanes(state, paneKey);
  if (mates.length <= 1) return '';
  const front = selectDockSlotFrontKey(state, paneKey);
  // 이름까지 지문에 실어 탭 줄이 `nodeMap` 을 따로 구독하지 않게 한다(그러면 스냅샷마다 창이 다시 그려진다).
  //   구분자와 부딪히지 않도록 조각마다 인코딩한다 — 프로젝트명·버블 이름에는 무엇이든 들어올 수 있다.
  return mates
    .map((o) => {
      const label = (o.agentId ? state.nodeMap[o.agentId]?.label : '') ?? '';
      return `${encodeURIComponent(o.paneKey)}|${encodeURIComponent(label)}|${o.paneKey === front ? '1' : '0'}`;
    })
    .join(';');
}

// ─── 스트림 메모리 관리 (성능: 비활성 세션 차등 cap + 오래된 세션 pruning) ───

/**
 * 지금 IDE 로 "보고 있는" 세션 집합. 열린 IDE 오버레이(agentId≠null)의 에이전트에 속한
 * 모든 세션을 활성으로 본다 — 사용자가 같은 IDE 안에서 세션을 전환해도 전체 버퍼가 보존되도록.
 */
function computeActiveSessionIds(
  ideOverlays: Record<string, IDEOverlayState>,
  subAgents: Record<string, SubAgent[]>,
): Set<string> {
  const active = new Set<string>();
  for (const ov of Object.values(ideOverlays)) {
    if (!ov.agentId) continue;
    if (ov.activeSessionId) active.add(ov.activeSessionId);
    for (const sub of subAgents[ov.agentId] ?? []) active.add(sub.id);
  }
  return active;
}

/**
 * 비활성 세션 버퍼를 (1) 작은 상한으로 축소하고 (2) 비활성 세션 수가 상한을 넘으면
 * 마지막 수신이 가장 오래된 것부터 통째로 제거한다. streams/lastActivity/deepRestored 를
 * **제자리 수정**(호출자가 항상 fresh 복사본을 넘긴다).
 *
 * ⚠ 여기서 깎인 세션은 **깊은 복원 표식을 반드시 함께 지운다**. "다시 열면 서버 버퍼에서
 *   복구되므로 표시 손실 없음"이 성립하려면 그 복구가 실제로 다시 일어나야 하는데, 표식을
 *   남겨 두면 IDE 가 "이 세션은 이미 깊게 받았다"로 읽어 재요청을 걸지 않는다 — 그러면 이
 *   300 컷이 그대로 화면의 상한이 되어, 말풍선·카드만 남고 사이 대화가 빈 채로 굳는다.
 */
function pruneInactiveStreams(
  streams: Record<string, SubAgentStreamEvent[]>,
  lastActivity: Record<string, number>,
  active: Set<string>,
  deepRestored: Record<string, true>,
): void {
  const inactive = Object.keys(streams).filter((sid) => !active.has(sid));
  if (inactive.length === 0) return;
  for (const sid of inactive) {
    const arr = streams[sid]!;
    if (arr.length > STREAM_EVENTS_MAX_PER_INACTIVE_SESSION) {
      streams[sid] = arr.slice(arr.length - STREAM_EVENTS_MAX_PER_INACTIVE_SESSION);
      delete deepRestored[sid];
    }
  }
  if (inactive.length > STREAM_INACTIVE_SESSIONS_MAX) {
    inactive.sort((a, b) => (lastActivity[a] ?? 0) - (lastActivity[b] ?? 0));
    const removeCount = inactive.length - STREAM_INACTIVE_SESSIONS_MAX;
    for (let i = 0; i < removeCount; i++) {
      const sid = inactive[i]!;
      delete streams[sid];
      delete lastActivity[sid];
      delete deepRestored[sid];
    }
  }
}

/**
 * IDE 북마크 — IDE 출력에서 우클릭→"북마크"로 보관한 텍스트 조각.
 * §5.5 #17-7 (프로젝트별로 갈라 담기) — 보관함은 **프로젝트가 소유**한다(BookmarkStore). "이동" 시
 * 출처 세션으로 복귀하기 위해 출처 agentId/sessionId/projectId 를 항목에도 함께 보관한다.
 */
export interface IDEBookmark {
  id: string;
  /** 보관한 본문(선택 텍스트 그대로). 매우 긴 선택은 저장 시 상한으로 잘린다. */
  text: string;
  /** 출처 에이전트 ID(IDE). 이동 시 openIDEOverlay 대상. */
  agentId: string;
  /** 출처 세션(SubAgent) ID. null = 메인 탭. */
  sessionId: string | null;
  /** 출처 프로젝트(표시명) — 다른 프로젝트의 북마크로 이동 시 탭 전환에 사용. */
  projectId: string | null;
  /** 표시용 출처 에이전트 라벨 스냅샷. */
  agentLabel: string;
  /** 출처 스트림/타임라인 항목 id(`data-stream-item-id`) — 이동 시 가상 리스트를 그 항목으로 직접 스크롤. */
  anchorId?: string;
  createdAt: number;
}

/** §5.5 #17-8 v2.95 — 세션 자기요약 캐시 항목. 카드 없는 세션의 CLI 요약 텍스트 + 닫힌 세션 잔류용 메타. */
export interface SessionSummaryEntry {
  /** 세션(SubAgent) ID. */
  subId: string;
  /** 부모 에이전트 ID. */
  agentId: string;
  /** 표시용 세션 라벨 스냅샷(닫혀도 보드에 이름이 남게). */
  label: string;
  /** CLI 자기요약 텍스트. */
  text: string;
  /** 생성 시각. */
  at: number;
  /** 세션 탭이 닫혔는지 — true 면 요약만 보드에 잔류("요약해서 건네주고 닫기"). */
  closed?: boolean;
}

/** 세션 요약 캐시 localStorage 키 + 상한. */
const SESSION_SUMMARIES_KEY = 'vibisual:sessionSummaries';
const SESSION_SUMMARY_MAX = 200;

/** 북마크 본문 저장 상한(localStorage 비대화 방지). 표시도 이 길이까지. */
const BOOKMARK_TEXT_MAX = 8000;
/** **프로젝트 한 칸당** 보관 가능한 북마크 최대 개수(오래된 것부터 밀어냄). */
const BOOKMARK_MAX = 200;

/**
 * §5.5 #17-7 (프로젝트별로 갈라 담기) — 북마크 보관함. 프로젝트 표시명 → 그 프로젝트에서 보관한 조각(최신 앞).
 * 종전의 전역 단일 배열이 프로젝트를 가리지 않고 모든 IDE 에 뜨던 것을 프로젝트가 소유하는 칸으로 나눈다.
 */
export type BookmarkStore = Record<string, IDEBookmark[]>;

/** 소속 프로젝트를 알 수 없는 항목이 들어가는 칸. 프로젝트 표시명은 비어 있을 수 없어 실제 칸과 겹치지 않는다. */
const UNKNOWN_BOOKMARK_PROJECT = '';

/** 안정 참조용 빈 목록 — 선택자가 매번 새 배열을 만들면 구독이 매 갱신마다 다시 그린다. */
const EMPTY_BOOKMARKS: IDEBookmark[] = [];

/**
 * 보관함 읽기 — 값이 **배열**(v2.90 이래의 전역 단일 목록)이면 여기서 한 번 `projectId` 기준으로 갈라 담는다.
 * 읽는 길이 이 함수 하나라 여기만 손보면 배지·목록이 동시에 새 모양을 본다(`selectIDEOverlay` 의 옛 뷰 id
 * 이관과 같은 규약). 이관된 값은 다음 저장 때 새 모양으로 덮인다.
 */
function loadBookmarks(): BookmarkStore {
  const raw = loadJSON<BookmarkStore | IDEBookmark[] | null>(IDE_BOOKMARKS_KEY, {});
  if (!raw || typeof raw !== 'object') return {};
  if (!Array.isArray(raw)) return raw;
  const out: BookmarkStore = {};
  for (const bm of raw) {
    if (!bm || typeof bm !== 'object') continue;
    const key = bm.projectId ?? UNKNOWN_BOOKMARK_PROJECT;
    const bucket = out[key];
    if (bucket) bucket.push(bm);
    else out[key] = [bm];
  }
  return out;
}

/** 북마크를 프로젝트로 가르는 데 필요한 상태만 추린 것(활동바·사이드바·테스트가 함께 쓴다). */
export interface BookmarkScope {
  ideBookmarks: BookmarkStore;
  activeProject: string | null;
  projects: Record<string, unknown>;
  stubProjects: Record<string, unknown>;
}

/**
 * 지금 보고 있는 프로젝트 화면이 봐야 할 칸 이름들 — 자기 칸 + **떠돌이 칸**.
 * 떠돌이 = 프로젝트 미상(`''`) 이거나 지금 프로젝트 목록에 없는 이름(옛 워크트리명 등). 감추면 사용자가
 * 그 항목을 지울 수도 없으므로 어느 프로젝트에서도 보이게 남긴다. 아직 프로젝트 목록을 모르는 부팅
 * 순간에는 떠돌이를 가려낼 근거가 없으므로 추측하지 않는다(자기 칸 + `''` 만).
 */
function visibleBookmarkKeys(state: BookmarkScope): string[] {
  const knowsProjects = Object.keys(state.projects).length > 0 || Object.keys(state.stubProjects).length > 0;
  const keys: string[] = [];
  for (const key of Object.keys(state.ideBookmarks)) {
    if ((state.ideBookmarks[key]?.length ?? 0) === 0) continue;
    if (key === state.activeProject || key === UNKNOWN_BOOKMARK_PROJECT) keys.push(key);
    else if (knowsProjects && !state.projects[key] && !state.stubProjects[key]) keys.push(key);
  }
  return keys;
}

/**
 * 활동바 배지 개수 — 원시값이라 그대로 구독해도 안전하다(`useGraphStore(countProjectBookmarks)`).
 * 목록(`selectProjectBookmarks`)과 **같은 산식**을 쓰도록 칸 고르기는 한 곳(`visibleBookmarkKeys`)만 둔다.
 */
export function countProjectBookmarks(state: BookmarkScope): number {
  let n = 0;
  for (const key of visibleBookmarkKeys(state)) n += state.ideBookmarks[key]?.length ?? 0;
  return n;
}

/**
 * 지금 프로젝트에서 보이는 북마크(최신 앞).
 * ⚠ 칸이 둘 이상이면 합쳐 새 배열을 만들므로 **zustand 선택자로 직접 쓰지 말고** `useMemo` 로 감싼다
 * (매번 새 참조를 돌려주면 구독이 갱신마다 다시 그린다).
 */
export function selectProjectBookmarks(state: BookmarkScope): IDEBookmark[] {
  const keys = visibleBookmarkKeys(state);
  if (keys.length === 0) return EMPTY_BOOKMARKS;
  // 한 칸이면 저장 순서(최신 앞)가 그대로 답이고, 참조도 그대로 유지된다.
  if (keys.length === 1) return state.ideBookmarks[keys[0]!] ?? EMPTY_BOOKMARKS;
  const out: IDEBookmark[] = [];
  for (const key of keys) out.push(...(state.ideBookmarks[key] ?? []));
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** 이동 직후 본문 위치로 스크롤하기 위한 1회성 타깃(IDEMainArea 가 소비 후 clear). */
export interface BookmarkScrollTarget {
  sessionId: string | null;
  text: string;
  /** 출처 항목 id — 가상 리스트 scrollToIndex 용. 없으면 텍스트 검색 폴백. */
  anchorId?: string;
  /** 소비 측이 매번 새 타깃으로 인식하도록 하는 nonce(같은 북마크를 연속 이동해도 effect 재실행). */
  nonce: number;
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
  /** §5.5 #17-18 v4.68 — 대기 중인 덧말의 처리 방식(대기/합치기/즉시) 변경. */
  setCommandDispatchMode: (agentId: string, commandId: string, mode: CommandDispatchMode) => void;
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
  /** §5.3 #10-3 v4.98 — 검증 런 (autoAgentSessionId → AutoAgentRun[], 최신이 뒤).
   *  서버가 소유한 완료 근거라 클라는 스냅샷을 그대로 표시만 한다(클라 판정 ❌). */
  autoAgentRuns: Record<string, AutoAgentRun[]>;
  /** §5.5 #17-9 v3.51 — 지금 백단에서 도는 서브에이전트 (agentId → RunningSubagentTask[]).
   *  서버 런타임 전용 값이라 클라도 영속화 ❌ — 스냅샷마다 통째 교체(끝나면 자동으로 빈다). */
  runningSubagentTasks: Record<string, RunningSubagentTask[]>;
  /** §5.5 #17-9 ⑦(b) — 방금 끝난 서브에이전트 (agentId → FinishedSubagentTask[], 새 것이 앞).
   *  결과가 늦게 붙으므로 항목이 같아도 내용이 갱신된다. 같은 이유로 영속화 ❌. */
  finishedSubagentTasks: Record<string, FinishedSubagentTask[]>;
  /** §4 v2.52 — 에이전트 작업 신고 (agentId → AgentReport[]). IDE 색 구분 카드. */
  agentReports: Record<string, AgentReport[]>;
  /**
   * §5.5 #17-36 — **메인 탭** 스티키 메모 (agentId → SessionMemo[]).
   * 세션 탭 메모는 그 세션의 소지품이라 `subAgents[].memos` 로 온다 — 여기 있는 것은 붙일 세션이
   * 없는 메인 탭 몫뿐이다. 서버가 SSOT 라 클라는 그대로 그린다(가공 ❌).
   */
  agentMemos: Record<string, SessionMemo[]>;
  /** §4 v2.60 — 에이전트 질문 카드 (agentId → AgentQuestions[]). IDE 질문 카드. */
  agentQuestions: Record<string, AgentQuestions[]>;
  /** §4 v2.70 — 에이전트 검수 요청 카드 (agentId → AgentReview[]). IDE 검수 카드. */
  agentReviews: Record<string, AgentReview[]>;
  /**
   * §5.16 — 리뷰·승인 레인 목록(서버 스냅샷 전량). 검수 카드가 `reviewRequestId` 로 이 목록을
   * 조회해 파일 목록·diff·승인/반려/보류 구획을 그린다. 판정·상태 전이는 전부 서버(§3.1).
   */
  reviewRequests: ReviewRequest[];
  /** §4 v2.84 — 에이전트 번호 목록 정렬 카드 (agentId → AgentList[]). IDE 정렬 카드. */
  agentLists: Record<string, AgentList[]>;
  /** §4 v3.21 — 에이전트 피드백 (agentId → AgentFeedback[]). 좋아요/싫어요 → 규칙 되먹임. */
  agentFeedbacks: Record<string, AgentFeedback[]>;
  /** §5.5 #17-11 v3.79 — 세션 반복 실행(루프) 설정 (subAgentId → SessionLoop). 서버 SSOT, 클라는 표시·전송만. */
  sessionLoops: Record<string, SessionLoop>;
  /**
   * §5.5 #17-35 — 검증 실행 이력 (subAgentId → VerificationRun[], 최신 우선).
   * 서버가 매 스냅샷에 전량을 싣는다 — 클라는 그대로 그릴 뿐 판정도 정리도 하지 않는다(§3.1).
   */
  verificationRuns: Record<string, VerificationRun[]>;
  /**
   * §5.5 #17-35 ⑨ — 시연(재현 절차) 목록 (subAgentId → VerificationDemo[], 최신 우선).
   * 검증 이력과 같은 규약 — 서버가 매 스냅샷에 전량을 싣고 클라는 그리기만 한다.
   * 영상은 여기 없다(⑨-2) — 단계 문장과 프레임 경로뿐이고, 클립 Blob 은 `capturePlaytest` 에 산다.
   */
  verificationDemos: Record<string, VerificationDemo[]>;
  /** §5.5 #17-17 v4.46 — 세션 목표 (subAgentId → SessionGoal). 서버 SSOT, 클라는 표시·전송만. */
  sessionGoals: Record<string, SessionGoal>;
  /** §4 v2.38 — 동적 모델 레지스트리 (서버 modelRegistryService 가 시드+/v1/models 머지 후 push). */
  modelRegistry: ModelRegistry | null;
  /** §5.19 — 로컬 LLM(엔진 설치 상태·받아 둔 모델·내려받기). 서버가 디스크를 읽어 싣는다. */
  localLlm: LocalLlmState | null;
  /** §4 v2.42 — 사용자 글로벌 옵션 (Options 창 SSOT). */
  userDefaults: UserDefaults | null;
  /** §4 v1.50 — Claude.ai 한도 사용률 (글로벌, 외부 statusline 푸시). */
  rateLimits: RateLimitInfo | null;
  /** §4 v3.62 — Claude 앱 /usage 와 같은 원천(OAuth)의 사용량. 글로벌, 비영속. */
  claudeUsage: ClaudeUsageInfo | null;
  /**
   * §4 v4.82 — Claude 계정 로그인 상태(`claude auth status`). 글로벌, 비영속.
   * `loggedIn === false && !error` 일 때만 로그인 팝업이 뜬다(error = 판정 불가 = "모름").
   */
  claudeAuth: ClaudeAuthStatus | null;
  /** 서버 스냅샷/REST 응답으로 받은 로그인 상태 반영. */
  applyClaudeAuth: (auth: ClaudeAuthStatus | undefined) => void;
  /**
   * 로그인 상태 즉시 재조회(`POST /api/auth/status/refresh`) + 반영.
   * 서버 폴링은 10분 주기라, 상태가 방금 바뀐 것을 아는 자리(설치 완료·로그인 진행 중·[다시 확인])
   * 에서는 기다리지 않고 이 창구로 확인한다. 실패하면 `null` — 다음 스냅샷이 따라온다.
   */
  refreshClaudeAuth: () => Promise<ClaudeAuthStatus | null>;
  /** 사용자가 로그인 팝업을 "나중에"로 닫았는가 — 이 앱 실행 동안 다시 자동으로 뜨지 않게. */
  loginGateDismissed: boolean;
  /** 팝업 강제 열기(옵션창 Account 의 [로그인]) / 닫기. null = 사용자 요청 없음(자동 판정에 맡김). */
  loginGateForced: boolean;
  setLoginGate: (state: { forced?: boolean; dismissed?: boolean }) => void;
  /**
   * §4 (첫 실행 설치 온보딩) — `claude` CLI 설치 판정. 글로벌, 비영속.
   * `phase === 'missing' | 'failed'` 이면 설치 게이트가 뜬다(**로그인 게이트보다 앞 단계**).
   */
  claudeSetup: ClaudeSetupState | null;
  /** 서버 스냅샷/REST 응답으로 받은 설치 판정 반영. */
  applyClaudeSetup: (setup: ClaudeSetupState | undefined) => void;
  /** 네이티브 인스톨러 진행 상황(WS `claude_setup_progress`). 설치를 누르기 전엔 null. */
  claudeSetupProgress: ClaudeSetupProgress | null;
  setClaudeSetupProgress: (p: ClaudeSetupProgress) => void;
  /**
   * 사용자가 설치 게이트를 "나중에"로 닫았는가.
   * **권장형**이라 닫으면 모달만 사라지고 상단 배너가 남는다(배너를 누르면 다시 열린다).
   */
  setupGateDismissed: boolean;
  /** 게이트 강제 열기(상단 배너 클릭) / 닫기. */
  setupGateForced: boolean;
  setSetupGate: (state: { forced?: boolean; dismissed?: boolean }) => void;
  /** [설치하기] — 서버가 공식 네이티브 인스톨러를 실행한다. 진행은 WS 로 온다. */
  installClaudeSetup: () => Promise<void>;
  /** 설치 판정 재조회(수동 설치한 뒤 [다시 확인]). */
  refreshClaudeSetup: () => Promise<void>;
  /**
   * §4 (첫 실행 온보딩) ③ — 프로젝트 폴더 게이트. 설치·로그인 다음 **마지막 칸**이다.
   *
   * 이 칸이 없던 동안, 폴더를 한 번도 고르지 않은 사용자가 캔버스 우클릭으로 커스텀 에이전트를
   * 만들면 서버가 `process.cwd()` 를 임시 프로젝트로 등록해 **이름이 빈 탭 하나와 파일시스템
   * 루트에 매인 에이전트**가 조용히 생겼다. 이제 서버는 그 요청을 409 로 돌려보내고, 클라는
   * 그 자리에서 이 게이트를 열어 폴더 선택으로 데려간다.
   */
  projectGateForced: boolean;
  /** [나중에] 로 닫았는가 — 자동으로는 다시 뜨지 않고 상단 배너만 남는다(권장형). */
  projectGateDismissed: boolean;
  /**
   * 게이트가 왜 떠 있는가 — 창의 첫 문장이 갈린다.
   *  - `'onboarding'` = 순서상 이 칸(설치·로그인 다음).
   *  - `'create-blocked'` = 무언가를 만들려다 막혔다. 그 사람에게는 "폴더부터"가 답이므로
   *    안내문이 그 사정을 그대로 말해야 한다("폴더를 고르지 않아 만들지 않았습니다").
   */
  projectGateReason: 'onboarding' | 'create-blocked';
  setProjectGate: (state: { forced?: boolean; dismissed?: boolean; reason?: 'onboarding' | 'create-blocked' }) => void;
  /**
   * 폴더 선택 대화상자를 연다(`POST /api/projects/open-folder`) — **창구는 이 하나뿐**이다.
   * File 메뉴와 폴더 게이트가 각자 fetch 를 들면 "고른 뒤에 무엇을 하는가"(탭 활성화·게이트
   * 닫기)가 두 벌로 갈라진다. 고르면 true, 취소·실패면 false.
   */
  openProjectFolder: () => Promise<boolean>;
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
  /** v2.61 — 첨부 이미지 라이트박스(전체화면 확대). null=닫힘. 전환 상태이므로 영속화 ❌.
   *  §5.5 #17-25 v4.80 — URL 하나에서 `{ url, attachment? }` 로 넓혔다. 주석본을 저장할 때
   *  **어느 첨부를 열었는지** 알아야 그 자리를 교체할 수 있다(모르면 새 첨부로만 붙는다). */
  imageLightbox: ImageLightboxState | null;
  openImageLightbox: (url: string, attachment?: ImageLightboxAttachment, workspace?: ImageLightboxWorkspaceFile) => void;
  closeImageLightbox: () => void;
  /**
   * §5.5 #17-25 ④-1 — 라이트박스가 워크스페이스 이미지를 덮어쓴 시각(상대 경로별).
   * 편집창은 이 값이 바뀌면 그 파일을 다시 읽어 방금 그린 표시를 화면에 올린다.
   */
  workspaceImageSavedAt: Record<string, number>;
  markWorkspaceImageSaved: (relPath: string) => void;
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
  /**
   * §5.13 (Q) — 대본에서 콘티 생성 — 서버 POST /api/conti/from-script.
   * 성공하면 새 콘티, 실패하면 사유 한 줄을 돌려준다(화면이 그대로 보여 준다).
   */
  generateContiFromScript: (
    agentId: string,
    script: string,
    presetId: StoryboardPresetId,
    frameCount?: number,
  ) => Promise<{ ok: true; contiId: string } | { ok: false; error: string }>;
  /** §5.13 (Q) — 대본 콘티 생성 진행 중인 에이전트(버튼 스피너용). */
  contiScriptGenerating: Record<string, true>;
  /** §5.13 (Q) — 출력 프리셋 지정 — 서버 PATCH /api/conti/:id. */
  setContiPreset: (contiId: string, presetId: StoryboardPresetId) => Promise<void>;
  /** §5.13 (Q) — 콘티를 받아 간 앱의 산출물 기록 — 서버 POST /api/conti/:id/render-link. */
  linkContiRender: (
    contiId: string,
    link: { appId: string; docId: string; jobId?: string; presetId: StoryboardPresetId; status?: ContiRenderStatus; error?: string },
  ) => Promise<void>;
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
  /** §5.9 선택된 캡처 버블 ID — 삭제/이동 대상. 노드/Task Edge/Comment Box 선택과 배타. */
  selectedCaptureBubbleId: string | null;
  selectCaptureBubble: (id: string | null) => void;
  /** §5.9 캡처 버블 목록 (서버 스냅샷). 현재 프로젝트 필터로 렌더. */
  captureBubbles: CaptureBubble[];
  /**
   * §5.5 #17-20 ⑩ v4.94 — 프로젝트별 중단점(projectName → 목록). 서버 스냅샷이 진실이고
   * 화면은 그대로 그린다. 세션이 없어도 존재하므로 편집창 gutter 는 이 값만 보면 된다.
   */
  debugBreakpoints: Record<string, DebugBreakpoint[]>;
  /** 스냅샷에서 받은 중단점을 반영(별도 액션 — loadSnapshot 위치 인자 ❌). */
  applyDebugBreakpoints: (record: Record<string, DebugBreakpoint[]>) => void;
  /** 한 줄을 켜고 끈다. 화면에 먼저 반영하고 서버에 저장을 보낸다(스냅샷이 곧 덮어쓴다). */
  toggleBreakpoint: (projectName: string, file: string, line: number) => void;
  /** §5.5 #17-27 ⑨ v4.97 — 한 파일에 찍힌 중단점을 모두 지운다(편집창 줄 번호 우클릭). */
  clearBreakpointsInFile: (projectName: string, file: string) => void;
  /**
   * §9 스코프드 구독 — 프로젝트별 에이전트 집계 (projectName → 수).
   * **구독 범위 밖(=지금 안 보는) 프로젝트도 들어 있다** — 탭 배지가 배경 탭에서 0 으로 보이지
   * 않게 하려고 서버가 항상 전량을 싣는 유일한 에이전트 슬라이스다.
   */
  projectAgentCounts: Record<string, ProjectAgentCounts>;
  /** 스냅샷에서 받은 프로젝트별 집계를 반영(별도 액션 — loadSnapshot 위치 인자 ❌). */
  applyProjectAgentCounts: (counts: Record<string, ProjectAgentCounts>) => void;
  /**
   * §9 — **마지막 스냅샷이 실어 온 구독 범위**(표시명 배열). `null` = 범위 미적용(전량).
   *
   * "지금 탭의 버블이 아직 안 온 것"과 "원래 비어 있는 것"을 가르는 값 — 판정은
   * `components/BubbleMap/canvasLoading.ts` 가 단독 소유한다.
   */
  snapshotScope: string[] | null;
  /** 이 창이 서버 스냅샷을 한 번이라도 받았는가. 부팅 첫 화면과 "빈 프로젝트"를 구분한다. */
  snapshotReceived: boolean;
  /** 스냅샷에서 받은 구독 범위를 반영(별도 액션 — loadSnapshot 위치 인자 ❌). */
  applySnapshotScope: (scope: string[] | undefined) => void;
  /**
   * WebSocket 연결 상태. `useWebSocket` 이 소유하지만 **캔버스도 읽어야** "연결이 끊겨 비어
   * 있는 것"을 "불러오는 중"으로 잘못 말하지 않는다(헤더 인디케이터와 같은 값).
   */
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
  setConnectionStatus: (status: 'connecting' | 'connected' | 'disconnected') => void;
  /** §5.13 v4.45 — 내부 앱 버블(범용). 앱이 늘어도 이 배열 하나. */
  appBubbles: AppBubble[];
  /** 스냅샷에서 받은 앱 버블을 반영. loadSnapshot 의 긴 인자 목록을 더 늘리지 않는다. */
  applyAppBubbles: (list: AppBubble[]) => void;
  /** 드래그 중 위치를 화면에만 먼저 반영(서버 왕복 전). */
  patchAppBubbleLocal: (id: string, updates: Partial<AppBubble>) => void;
  /** 드래그 중인 앱 버블 ID 집합 — applyAppBubbles 가 이 버블들의 geometry 를 로컬 값으로 보호. */
  draggingAppBubbleIds: string[];
  setAppBubbleDragLock: (id: string, on: boolean) => void;
  /** §5.13 선택된 앱 버블 ID — Delete 키의 대상. 노드/Task Edge/Comment Box/캡처 선택과 배타. */
  selectedAppBubbleId: string | null;
  selectAppBubble: (id: string | null) => void;
  /**
   * 앱 버블 삭제. 우클릭 메뉴와 Delete 키가 **같은 이 경로**를 쓴다.
   *
   * 핀(preservePinned)이 걸려 있으면 서버가 409 로 거절하므로(§2.4) 낙관 제거를 먼저 하지
   * 않는다 — 화면에서 지웠다가 다음 스냅샷에 되살아나는 깜빡임을 막기 위함. 거절되면 false.
   */
  deleteAppBubble: (id: string) => Promise<boolean>;
  /**
   * 앱 버블 이름 바꾸기. 빈 문자열이면 앱 기본 이름으로 되돌아간다.
   *
   * 우클릭 메뉴와 우측 옵션 패널이 **같은 이 경로**를 쓴다(v4.68) — 각자 fetch 를 쓰면
   * 낙관 반영 규칙이 갈라져 한쪽에서만 "바꿨는데 다시 열면 옛 이름"이 된다.
   */
  renameAppBubble: (id: string, title: string) => void;
  /** §2.4 preserve-pin 토글. 우클릭 메뉴·옵션 패널 공용. */
  setAppBubblePin: (id: string, pinned: boolean) => void;
  /** 드래그/리사이즈 중인 캡처 버블 ID 집합 — loadSnapshot 이 이 버블들의 geometry 를 로컬 값으로 보호. */
  draggingCaptureBubbleIds: string[];
  setCaptureBubbleDragLock: (id: string, on: boolean) => void;
  /** 낙관적 업데이트 (드래그 중 위치 실시간 반영). */
  patchCaptureBubbleLocal: (id: string, updates: Partial<CaptureBubble>) => void;
  /** 서버 캡처 버블 생성. */
  createCaptureBubble: (input: {
    projectName: string;
    x: number;
    y: number;
    width: number;
    height: number;
    sourceId: string;
    sourceName: string;
    sourceKind: CaptureBubble['sourceKind'];
  }) => Promise<CaptureBubble | null>;
  /** 서버 캡처 버블 업데이트 (PATCH). */
  updateCaptureBubble: (id: string, updates: Partial<Omit<CaptureBubble, 'id' | 'projectName' | 'createdAt' | 'updatedAt'>>) => Promise<void>;
  /** 서버 캡처 버블 삭제. */
  deleteCaptureBubble: (id: string) => Promise<void>;

  // ─── §5.14 v4.62 — 플레이 버블 (이 프로젝트를 켜는 버튼) ───
  /** 플레이 버블 목록 (서버 스냅샷). 현재 프로젝트 필터로 렌더. */
  playBubbles: PlayBubble[];
  /** 스냅샷 반영. 드래그 중인 버블의 좌표는 로컬 값으로 보호한다(앱 버블과 같은 규칙). */
  applyPlayBubbles: (list: PlayBubble[]) => void;
  /** 드래그 중 좌표를 화면에만 먼저 반영(서버 왕복 전). */
  patchPlayBubbleLocal: (id: string, updates: Partial<PlayBubble>) => void;
  draggingPlayBubbleIds: string[];
  setPlayBubbleDragLock: (id: string, on: boolean) => void;
  /** 선택된 플레이 버블 ID — Delete 키 대상. 다른 선택과 배타. */
  selectedPlayBubbleId: string | null;
  selectPlayBubble: (id: string | null) => void;
  createPlayBubble: (input: { projectName: string; x: number; y: number }) => Promise<PlayBubble | null>;
  updatePlayBubble: (id: string, updates: Partial<Omit<PlayBubble, 'id' | 'projectName' | 'createdAt' | 'updatedAt'>>) => Promise<void>;
  /** 핀이면 서버가 409 로 거절한다 — 낙관 제거 없이 결과를 돌려준다(앱 버블과 같은 규칙). */
  deletePlayBubble: (id: string) => Promise<boolean>;
  /** 버튼 누름 — 서버가 띄우고, 진행은 스냅샷으로 흘러온다. */
  startPlayBubble: (id: string) => Promise<void>;
  stopPlayBubble: (id: string) => Promise<void>;
  /** 실행법 다시 찾기(4단 계단 1~3단). apply=true 면 1등 후보를 바로 확정. */
  detectPlayRecipe: (id: string, apply: boolean) => Promise<PlayRecipeCandidate[]>;
  /** 4단 계단 ④ — 에이전트에게 실행법 조사를 맡긴다(기존 명령 큐). */
  askAgentForPlayRecipe: (id: string, agentId: string) => Promise<boolean>;

  // ─── §5.15 — 스펙 보드 (요구사항 → 수용 기준 → 작업 카드 → 실행) ───
  /** 스펙 목록 (서버 스냅샷). 현재 프로젝트 필터로 렌더. */
  specDocs: SpecDoc[];
  /** 스냅샷 반영. 드래그 중인 스펙의 좌표는 로컬 값으로 보호한다(플레이 버블과 같은 규칙). */
  applySpecDocs: (list: SpecDoc[]) => void;
  patchSpecDocLocal: (id: string, updates: Partial<SpecDoc>) => void;
  draggingSpecDocIds: string[];
  setSpecDocDragLock: (id: string, on: boolean) => void;
  /** 선택된 스펙 ID — Delete 키 대상. 다른 선택과 배타. */
  selectedSpecDocId: string | null;
  selectSpecDoc: (id: string | null) => void;
  /** 스펙 보드 패널(전체 화면)에서 열려 있는 스펙 ID. null 이면 닫힘. */
  specBoardOpenId: string | null;
  openSpecBoard: (id: string) => void;
  closeSpecBoard: () => void;
  createSpecDoc: (input: { projectName: string; x: number; y: number; title?: string }) => Promise<SpecDoc | null>;
  updateSpecDoc: (
    id: string,
    updates: Partial<Omit<SpecDoc, 'id' | 'projectName' | 'createdAt' | 'updatedAt' | 'bodyRevision'>>,
  ) => Promise<void>;
  addSpecItem: (id: string, text: string) => Promise<void>;
  /** 핀이면 서버가 409 로 거절한다 — 낙관 제거 없이 결과를 돌려준다. */
  deleteSpecDoc: (id: string) => Promise<boolean>;
  /** 수용 기준 → 작업 카드. `itemIds` 를 주면 그 항목만, 없으면 카드 없는 전부. */
  generateSpecTasks: (id: string, itemIds?: string[], regenerate?: boolean) => Promise<boolean>;
  /** 항목에서 카드 연결만 끊는다(에이전트 버블은 남는다). */
  detachSpecTask: (id: string, itemId: string) => Promise<void>;

  // ─── §5.18 — 에이전트 랩 (같은 과제를 설정만 바꿔 N벌 → 비교 표 → 승격) ───
  /** 랩 목록 (서버 스냅샷). 현재 프로젝트 필터로 렌더. */
  labRuns: LabRun[];
  /** 스냅샷 반영. 드래그 중인 랩의 좌표는 로컬 값으로 보호한다(스펙 보드와 같은 규칙). */
  applyLabRuns: (list: LabRun[]) => void;
  patchLabRunLocal: (id: string, updates: Partial<LabRun>) => void;
  draggingLabRunIds: string[];
  setLabRunDragLock: (id: string, on: boolean) => void;
  /** 선택된 랩 ID — Delete 키 대상. 다른 선택과 배타. */
  selectedLabRunId: string | null;
  selectLabRun: (id: string | null) => void;
  /** 랩 보드 패널(전체 화면)에서 열려 있는 랩 ID. null 이면 닫힘. */
  labPanelOpenId: string | null;
  openLabPanel: (id: string) => void;
  closeLabPanel: () => void;
  createLabRun: (input: { projectName: string; x: number; y: number; title?: string }) => Promise<LabRun | null>;
  updateLabRun: (
    id: string,
    updates: Partial<Pick<LabRun, 'x' | 'y' | 'width' | 'height' | 'title' | 'task' | 'baseAgentId' | 'preservePinned'>>,
  ) => Promise<void>;
  /** 변형 목록 통째 교체(패널 편집 결과). 이미 측정된 결과는 서버가 지킨다. */
  setLabVariants: (id: string, variants: { id?: string; label?: string; config?: LabVariantConfig }[]) => Promise<void>;
  addLabVariant: (id: string, label?: string, config?: LabVariantConfig) => Promise<void>;
  removeLabVariant: (id: string, variantId: string) => Promise<void>;
  /** 변형마다 워크트리 + 카드 + 과제 발사. `variantIds` 를 주면 그 줄만. */
  startLabRun: (id: string, variantIds?: string[]) => Promise<boolean>;
  /** 이긴 줄의 설정을 그 에이전트의 기본값으로. */
  promoteLabVariant: (id: string, variantId: string, targetAgentId?: string) => Promise<boolean>;
  /** 핀이면 서버가 409 로 거절한다 — 낙관 제거 없이 결과를 돌려준다. */
  deleteLabRun: (id: string) => Promise<boolean>;

  // ─── §5.21 비용·토큰 지도 ───
  /**
   * 서버가 접어 실어 준 프로젝트별 비용·토큰 지도. **여기서 다시 더하지 않는다**(§3.1) —
   * 배지·필·팝업이 읽는 값은 전부 이 배열 안에 이미 접혀 있다.
   */
  costMaps: ProjectCostMap[];
  applyCostMaps: (list: ProjectCostMap[]) => void;

  // ─── §5.22 권한·감사 경계 ───
  /**
   * 서버가 접어 실어 준 프로젝트별 감사 원장. 집계(`counts`)도 서버가 접어 주므로
   * **여기서 원장을 다시 세지 않는다**(§3.1).
   */
  auditLogs: ProjectAuditLog[];
  applyAuditLogs: (list: ProjectAuditLog[]) => void;
  /** 감사 타임라인 팝업이 열려 있는가(헤더 방패 필이 토글). */
  auditPopupOpen: boolean;
  setAuditPopupOpen: (open: boolean) => void;
  /** 경계 스위치 갱신(서버가 SSOT — 낙관 반영 없이 응답을 기다린다). */
  setAuditBoundary: (projectName: string, patch: Partial<AuditBoundaryConfig>) => Promise<void>;

  // ─── §5.20 스크립트 선반 (Shelf) ───
  /** 서버 스냅샷이 준 선반 목록. 렌더는 `projectName === activeProject` 로 거른다. */
  shelfBubbles: ShelfBubble[];
  applyShelfBubbles: (list: ShelfBubble[]) => void;
  /** 드래그 중 낙관 patch — 서버 왕복을 기다리면 버블이 손끝에서 뒤처진다. */
  patchShelfBubbleLocal: (id: string, updates: Partial<ShelfBubble>) => void;
  draggingShelfBubbleIds: string[];
  setShelfBubbleDragLock: (id: string, on: boolean) => void;
  selectedShelfBubbleId: string | null;
  selectShelfBubble: (id: string | null) => void;
  /** 전체 화면 선반 패널이 열려 있는 선반 id. */
  shelfPanelOpenId: string | null;
  openShelfPanel: (id: string) => void;
  closeShelfPanel: () => void;
  createShelfBubble: (input: { projectName: string; x: number; y: number; title?: string }) => Promise<ShelfBubble | null>;
  updateShelfBubble: (
    id: string,
    updates: Partial<Pick<ShelfBubble, 'x' | 'y' | 'width' | 'height' | 'title' | 'preservePinned'>>,
  ) => Promise<void>;
  addShelfItem: (id: string, draft: { label: string; kind: ShelfItemKind; command?: string; prompt?: string; icon?: string; color?: string }) => Promise<void>;
  updateShelfItem: (
    id: string,
    itemId: string,
    updates: Partial<Pick<ShelfItem, 'label' | 'kind' | 'command' | 'cwd' | 'prompt' | 'targetAgentId' | 'icon' | 'color'>>,
  ) => Promise<void>;
  removeShelfItem: (id: string, itemId: string) => Promise<void>;
  reorderShelfItems: (id: string, order: string[]) => Promise<void>;
  /** 클릭 한 번 = 이 줄 실행. 셸이면 출력이, 프롬프트면 그 카드가 결과로 붙는다. */
  runShelfItem: (id: string, itemId: string) => Promise<boolean>;
  /** 가져온 JSON 원문을 서버로 넘긴다(서버가 `normalizeShelfImport` 로 훑는다). */
  importShelfItems: (id: string, payload: unknown, replace: boolean) => Promise<{ added: number; dropped: number } | null>;
  deleteShelfBubble: (id: string) => Promise<boolean>;

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
  /**
   * SCENARIO.md §5.5 #17-6 (v2.73) — 오버레이 위젯 창으로 분리된 에이전트 id 집합 + 전역 토글 상태.
   * desktop main 의 windowManager 가 SSOT, IPC 'vibisual:overlay:list' 푸시로 모든 윈도우 sync.
   * 버블 본체는 그대로 유지(미러). 영속화 ❌. dev/web 모드(window.api 없음)에선 항상 빈 집합.
   */
  overlayAgentIds: string[];
  overlaysVisible: boolean;
  applyOverlayList: (payload: { overlays: Array<{ agentId: string }>; userVisible: boolean }) => void;
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

  // ─── §5.10 Project Brain — 2단 기억 + 커스텀 에이전트 휴지통 ───
  /**
   * projectName → 두뇌 요약(스냅샷 탑재). Brain 버블 본체/배지 렌더용.
   * v3.70 — 카드가 프로젝트별로 갈라져 저장되므로 요약도 프로젝트 키. 조회는 `selectActiveBrainSummary`.
   */
  brain: Record<string, BrainSummary>;
  /** agentId → 최근 주입 이벤트 목록(스냅샷 런타임 신호, 영속 X). IDE "기억 N장 참조" 칩 + Brain 엣지 연출. */
  brainInjections: Record<string, BrainInjectionEvent[]>;
  /**
   * §5.11 v4.65 — projectPath → pluginId → 집행 실측(스냅샷 런타임 신호, 영속 X).
   *
   * 집행은 서버에서 프로젝트 파일을 훑어 판단하는데 카드는 파일을 볼 수 없다. 이 값이 그 판단 근거를
   * 카드까지 실어 오므로, 화면이 프롬프트와 **같은 숫자**를 말할 수 있다. 조회는 `selectActivePluginFacts`.
   */
  pluginFacts: Record<string, Record<string, PluginFactMap>>;
  /**
   * §5.10 v3.49 — 휴지통 내부 진입 상태 — currentFolderId/navStack 과 독립. null=일반 캔버스.
   * 기억(brain/agentMemory)은 v3.49 에서 버블 산개 폐기 → `brainFeed` 오버레이가 담당.
   * 휴지통(버려진 에이전트 나열)만 기존 버블 진입 방식을 유지한다.
   */
  interiorView: { kind: 'trash' } | null;
  /**
   * §5.10 v3.49 — 우더블클릭(또는 __brain__ 좌더블클릭) 시 뜨는 유튜브식 기억 피드 오버레이 상태.
   * null=닫힘. scope='project' → Brain 전체, scope='agent' → 그 커스텀 에이전트 개별 기억.
   * 피드 데이터(sections/검색/로딩)는 오버레이 컴포넌트가 자체 fetch(BrainFeed) 로 보유 — 스토어엔 여는 스코프만.
   */
  brainFeed: { scope: BrainCardScope; agentId?: string } | null;
  /**
   * §5.10 — 사용법 가이드(File > Guide) 를 **어느 화면에서든** 여는 자리.
   * 값이 곧 열 항목(GuideWindow 의 카테고리 키)이고 null 이면 닫힘이다 — 가이드를 여는 문이
   * File 메뉴 하나뿐이면 정작 그 기능을 보고 있는 사람이 설명을 못 찾는다.
   */
  guideCategory: string | null;
  /** DetailPanel 에서 선택된 기억 카드 id(다른 선택과 배타). */
  selectedBrainCardId: string | null;
  /** 선택된 기억 카드 본문(REST 로 fetch — 본문은 스냅샷에 없음). */
  selectedBrainCard: BrainCard | null;
  /** §5.10 — 가이드를 그 항목으로 연다(인자 없으면 첫 항목). */
  openGuide: (category?: string) => void;
  /** 가이드 닫기. */
  closeGuide: () => void;
  /** 휴지통 내부 진입 — 선택 초기화(카드 fetch 없음). */
  enterInterior: (view: { kind: 'trash' }) => void;
  /** 내부 뷰 종료(캔버스 복귀). */
  exitInterior: () => void;
  /** §5.10 v3.49 — 기억 피드 오버레이 열기(scope 지정). 내부뷰/선택 초기화. */
  openBrainFeed: (view: { scope: BrainCardScope; agentId?: string }) => void;
  /** §5.10 v3.49 — 기억 피드 오버레이 닫기(선택 카드 해제). */
  closeBrainFeed: () => void;
  /** 기억 카드 선택(본문 fetch). id=null 이면 선택 해제. */
  selectBrainCard: (id: string | null, opts?: { agentId?: string }) => void;
  /** 개별 카드 → 프로젝트 두뇌 승격(이동). */
  promoteBrainCard: (id: string) => Promise<void>;
  /** 카드 pin 토글. */
  setBrainCardPinned: (id: string, pinned: boolean) => Promise<void>;
  /** 카드 제목/본문/타입 편집. */
  updateBrainCard: (id: string, patch: { title?: string; body?: string; type?: BrainCardType; status?: BrainCardStatus; topic?: string; always?: boolean }) => Promise<void>;
  /** 카드 삭제. */
  deleteBrainCard: (id: string) => Promise<void>;
  /** 카드 확인(seen) 신고. */
  markBrainCardSeen: (id: string) => void;
  /** §5.10 v3.78 — "지금도 맞음": 앵커를 현재 코드 기준으로 다시 박고 확인 필요를 해제. */
  verifyBrainCard: (id: string) => Promise<void>;
  /** §5.10 v3.78 — "낡음": 대체 후보로 적립(누적되면 자동 보관 — 삭제 ❌). */
  markBrainCardStale: (id: string) => Promise<void>;
  /** §5.10 v3.78 — "정리됨" 되돌리기: 보관 카드를 원래 자리로 복구. */
  restoreBrainCard: (id: string) => Promise<void>;
  /** §5.10 v3.81 — "현재 진실로 확인": 후보를 SSOT 로 승격(같은 슬롯의 옛 진실은 서버가 닫는다). */
  confirmBrainCard: (id: string) => Promise<void>;
  /** §5.10 v3.81 — "아니오": 사용자 거부(파일은 남고 주입·검색에서만 빠진다). */
  rejectBrainCard: (id: string) => Promise<void>;
  /** IDE 스트림 우클릭 "두뇌에 기억" — 선택 텍스트를 fact 카드로 저장. */
  saveBrainCardFromText: (text: string, agentId: string, sourceSessionId?: string | null) => Promise<void>;
  /** 휴지통 커스텀 에이전트 복구. */
  restoreTrashedAgent: (sessionId: string) => Promise<void>;
  /** 휴지통 커스텀 에이전트 영구 삭제(기억 카드 포함). */
  purgeTrashedAgent: (sessionId: string) => Promise<void>;
  /** §5.10 v4.84 — 휴지통 일괄 영구 삭제(배치 1회 = 스냅샷 1회). 확인 팝업을 거친 뒤에만 호출. */
  purgeTrashedAgents: (sessionIds: string[]) => Promise<void>;
  /** §5.10 v4.84 — 휴지통 영구 삭제 확인 팝업 대상([모두 삭제]·Delete 키 공용). null 이면 안 뜬다. */
  trashPurgeTarget: { ids: string[] } | null;
  /**
   * §5.19 (B) — All Model 설치 창. **그 버블에 매인다**(좌표 ❌ — 버블은 이미 캔버스에 있다).
   * 엔진 받기 → 모델 받기 → 고르기를 차례로 흘려보내고, 끝나면 그 버블의 IDE 를 연다.
   */
  localModelWindow: { agentId: string } | null;
  openLocalModelWindow: (agentId: string) => void;
  closeLocalModelWindow: () => void;
  requestTrashPurge: (ids: string[]) => void;
  closeTrashPurge: () => void;

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
    captureBubbles: CaptureBubble[],
    contis: Record<string, Conti>,
    activeContiWork: Record<string, ActiveContiWork>,
    brain: Record<string, BrainSummary>,
    brainInjections: Record<string, BrainInjectionEvent[]>,
  ) => void;
  /**
   * §5.11 v4.65 — 집행 실측 반영. `loadSnapshot` 의 위치 인자를 늘리지 않는 이유는 그 목록이 이미
   * 서른 개가 넘어 **한 자리만 어긋나도 조용히 다른 값이 들어가기** 때문이다(appBubbles·playBubbles 전례).
   */
  applyPluginFacts: (facts: Record<string, Record<string, PluginFactMap>>) => void;
  setActiveProject: (name: string) => void;
  /** v1.63: projectId(경로) 로 닫기. name 은 로컬 활성탭 전환용 표시명(생략 시 역추론). */
  closeProject: (projectId: string, name?: string) => Promise<void>;
  /**
   * SCENARIO.md §5.4 #14 v1.34 — **닫는 중인 프로젝트 경로**(정규화 키). 탭바가 이 집합의 탭을
   * 렌더에서 제외해, 사용자가 × 를 누른 **그 프레임에** 탭이 사라진다(서버 왕복·스냅샷 배치 창을
   * 기다리지 않는다 — `detachedTabKeys` 와 같은 방식). 서버 truth 에서 그 프로젝트가 실제로
   * 빠지면 표시를 해제하고(`applyStubProjects`), 서버가 닫기를 거절하면 즉시 해제해 탭을 되돌린다.
   * 값은 표시를 세운 시각(ms) — 서버가 끝내 그 프로젝트를 계속 실어 보내면(닫기 실패) 유예가 지난 뒤
   * 표시를 걷어 **서버 truth 를 보여준다**. 탭이 영영 안 보이는 상태로 갇히지 않게 하는 안전판이다.
   * 영속화 ❌(왕복 동안만 사는 표시).
   */
  closingProjectPaths: Record<string, number>;
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
  /**
   * store 채널 선택(앱·캡처·플레이·스펙·랩·선반 버블, 메모 상자, 작업 엣지)만 내린다.
   * `selectedNodeId`(일반 버블 선택)는 **건드리지 않는다** — 캔버스에서 버블을 박스로 다중
   * 선택했을 때, 방금 켜진 버블 선택은 남기고 반대편 채널만 비우는 자리이기 때문이다
   * (`canvasSelectionChannel` 참고).
   */
  clearElementSelection: () => void;
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
  /**
   * §5.19 (B) — All Model(로컬 LLM) 에이전트 생성. 커스텀 에이전트 기반 + provider baked.
   * **모델 없이 먼저 놓는다** — 우클릭으로 고른 순간 버블이 생기고, 엔진·모델 준비는 그 버블을
   * 눌렀을 때 판정한다(진입 순서 역전).
   */
  createLocalAgent: (canvasX: number, canvasY: number) => void;
  /**
   * §5.19 (B) — 이 버블이 물 모델을 정한다(설치 창에서 고르거나, 받아 둔 게 있으면 자동으로).
   * 성공하면 그 버블의 IDE 가 열린다 — 준비의 끝이 곧 대화의 시작이다.
   */
  bindLocalModel: (agentId: string, modelId: string, modelName: string) => void;
  /**
   * §5.19 (D) — 이 버블이 쓸 **대화 창 크기**(토큰). 종전에는 타입과 서버에만 있고 사람이
   * 바꿀 자리가 없어 사실상 기본값 고정이었다 — 대화가 길어져 창이 넘칠 때 사용자가 쓸 수 있는
   * 유일한 손잡이가 이것이다.
   */
  setLocalContextSize: (agentId: string, contextSize: number) => void;
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
  /**
   * §5.7 #26 — 워크트리 **생성 실패** 표식(클라이언트 전용, 2.2초 뒤 자동 소멸).
   * 성공 경로엔 아무 표식도 없다 — 다 만들어진 실물 버블이 그냥 나타난다(생성 연출 폐기).
   */
  failedWorktrees: BubbleData[];
  reportWorktreeCreateFailure: (canvasX: number, canvasY: number) => void;
  /** worktree 삭제 확인 모달 — nodeId 가 설정되면 모달이 떠서 merge 상태 조회 + 사용자 선택 대기 */
  worktreeDeleteTarget: { nodeId: string; label: string } | null;
  requestWorktreeDelete: (nodeId: string, label: string) => void;
  closeWorktreeDelete: () => void;
  /** SubAgent 스트림 이벤트 (subAgentId → events[]) — IDE 터미널 표시용 */
  subAgentStreams: Record<string, SubAgentStreamEvent[]>;
  /** 세션별 마지막 스트림 수신 시각 (ms) — 비활성 세션 pruning(가장 오래된 것부터 제거)에 사용. */
  streamLastActivity: Record<string, number>;
  /**
   * 지금 **깊은 복원분**(단건 경로 `GET /api/subagent-streams/:agentId/:subId`, 상한 전체)을
   * 들고 있는 세션 표식. 비활성 컷(300)·세션 통째 제거로 그 깊은 창이 깎이면 여기서 지워지고,
   * IDE 가 그것을 보고 **다시 받아 온다**. 이 표식이 없으면 "한 번 깎인 세션은 영영 얕은 채로"가
   * 된다 — 말풍선·카드만 남고 사이가 빈 화면의 정체가 그것이었다.
   */
  deepRestoredSessions: Record<string, true>;
  appendStreamEvent: (event: SubAgentStreamEvent) => void;
  /** §9 — sub_agent_stream 16ms 배치 수신. 도착 순서대로 합쳐 set 1회 (구독자 재평가 1회). */
  appendStreamEvents: (events: SubAgentStreamEvent[]) => void;
  /**
   * 서버 버퍼 적재. `depth='deep'` 은 보고 있는 세션의 상한 전체 복원분이라 표식을 세우고,
   * 기본값 `'shallow'`(에이전트 전체 얕은 조회)는 **이미 깊은 복원분이 있는 세션을 줄이지 않는다**.
   */
  loadStreamBuffers: (buffers: Record<string, SubAgentStreamEvent[]>, depth?: 'deep' | 'shallow') => void;
  /** IDE 오버레이 상태 — 프로젝트별 독립 슬롯 (projectId → state). 활성 탭의 슬롯만 화면에 노출. */
  ideOverlays: Record<string, IDEOverlayState>;
  /**
   * §5.5 #17-1 — 창 순번·앞뒤 도장 발급기(단조 증가). 팬 키(`<projectId>::ide-N`)와
   * 앞뒤 도장(`z`)을 같은 자리에서 받아 두 값이 어긋나지 않게 한다.
   */
  idePaneSeq: number;
  /**
   * IDE 창을 연다. `pane: 'new'` 면 **새 창**(캔버스 버블 더블클릭 — 나란히 보려는 진입점),
   * 그 밖(기본)은 종전대로 열려 있는 창의 **자리를 재사용**한다(북마크 점프처럼 창이 쌓이면 안 되는 곳).
   * 어느 쪽이든 그 에이전트를 이미 띄운 창이 있으면 새로 만들지 않고 그 창을 앞으로 올린다.
   */
  openIDEOverlay: (
    agentId: string,
    opts?: {
      pane?: 'new' | 'reuse';
      /**
       * §5.5 #17-6 (H) — 다른 창에서 **건너온 창 상태**(열어 둔 편집 탭·보던 뷰·고른 세션·
       * 붙어 있던 변). 있으면 첫 화면이 아니라 그 상태로 연다 — 앱 안 ↔ 독립 창을 오갈 때
       * 같은 창이 자리만 옮긴 것처럼 이어지게 하는 값이다.
       */
      handoff?: IDEPaneHandoff | null;
      /** 그 짐 중 무엇을 물려받을지 — 독립 창은 붙은 변·창 안 좌표를 물려받지 않는다. */
      handoffTarget?: HandoffTarget;
    },
  ) => void;
  /** 창 하나를 닫는다. 키를 안 주면 종전대로 활성 프로젝트의 주 창. */
  closeIDEOverlay: (paneKey?: string | null) => void;
  /** 그 창을 맨 앞으로(겹칠 때 앞뒤 + 상한 초과 시 재사용 대상 판정에 함께 쓰인다). */
  focusIDEPane: (paneKey: string) => void;
  /**
   * §5.5 #17-1 — 창 접기/펴기. 접으면 안 그리고 자리도 안 먹는다(캔버스가 돌아온다).
   * 펴면 붙어 있던 변으로 그대로 돌아오고, 펴는 김에 맨 앞으로 올린다.
   *
   * 접을 때는 **돌려받은 캔버스에서 그 창의 버블로 카메라도 함께 옮긴다**(focusNodeId) —
   * 접기는 "이 창을 내리고 캔버스로 돌아간다"는 손짓이라, 어디로 돌아가는지까지가 한 동작이다.
   */
  setIDEPaneCollapsed: (paneKey: string, collapsed: boolean) => void;
  /**
   * §5.5 #17-1 — 떠 있는 창의 자리·크기를 적어 둔다(드래그·리사이즈가 끝날 때 한 번).
   * 매 프레임 쓰면 창 수만큼 리렌더가 붙으므로 **끝났을 때만** 부른다.
   */
  setIDEPaneFloat: (paneKey: string | null | undefined, geom: FloatGeom) => void;
  setIDEActiveSession: (sessionId: string | null, paneKey?: string | null) => void;
  setIDEActiveView: (view: IDEViewType, paneKey?: string | null) => void;
  toggleIDESidebar: (paneKey?: string | null) => void;
  /** §5.5 #17-1 — 그 창을 어느 변에 붙일지(null 이면 뗀다). 같은 변 안 자리는 `order` 로 정한다. */
  setIDEPaneDock: (paneKey: string | null | undefined, dock: { side: IDEDockSide; size: number; order: number } | null) => void;
  /**
   * (판올림 번호 발급 대기) **창 여러 개를 한 번에 정리한다**(언리얼 Window ▸ 레이아웃 관용).
   * 창을 서넛 띄우면 겹쳐 쌓여 아래 것을 찾을 수 없다 — 그때 한 번에 늘어놓거나 한 칸에 모은다.
   */
  applyIDEWindowLayout: (kind: IDEWindowLayoutKind, viewport: Viewport) => void;
  /**
   * (판올림 번호 발급 대기) 레이아웃이 **밖에서** 바뀐 세대. 창 컴포넌트는 이 값이 오르면
   * 자기 모양(도킹/플로팅/자리)을 스토어에서 다시 읽는다 — 모양은 컴포넌트 로컬 상태라
   * 이 신호가 없으면 프리셋이 스토어만 바꾸고 화면은 그대로 있는다.
   */
  ideLayoutEpoch: number;
  /** (판올림 번호 발급 대기) 다음(+1)/이전(-1) 창을 앞으로 — 겹쳐 쌓인 창을 키보드로 훑는 자리. */
  cycleIDEPaneFocus: (dir: 1 | -1) => void;
  /** §5.5 #17-1 — 도크 두께. 같은 변에 붙은 창들은 한 칸을 나눠 쓰므로 **함께** 바뀐다. */
  setIDEDockSize: (paneKey: string | null | undefined, size: number) => void;
  /**
   * §5.5 #17-1 — 같은 변에 쌓인 창들의 **몫**(가중치). 이웃한 두 칸을 한 번에 바꾸므로
   * 맵으로 받는다(둘을 따로 부르면 그 사이 한 프레임 동안 합이 어긋난다).
   */
  setIDEDockSpans: (spans: Record<string, number>) => void;
  /** §5.5 #17-27 — 파일을 내장 편집창에 연다(이미 열려 있으면 그 탭을 활성화). 여는 손잡이 3곳의 공통 창구. */
  openIDEEditorFile: (file: IDEEditorFile, paneKey?: string | null) => void;
  /** §5.5 #17-27 — 탭 하나 닫기. 활성 탭이었으면 옆 탭으로 넘어가고, 마지막이면 편집창이 닫힌다. */
  closeIDEEditorFile: (relPath: string, paneKey?: string | null) => void;
  /** §5.5 #17-27 — 탭 전환. null 이면 편집창 자체를 접는다(탭 목록은 남는다). */
  setActiveIDEEditorFile: (relPath: string | null, paneKey?: string | null) => void;
  /** §5.5 #17-27 — 편집창 통째로 닫기(탭 목록도 비운다). */
  closeIDEEditor: (paneKey?: string | null) => void;
  /** §5.5 #17-27 — 그 탭에 저장하지 않은 편집이 있는지 신고(탭 점 + 밀어내기 예외). */
  setIDEEditorFileDirty: (relPath: string, dirty: boolean, paneKey?: string | null) => void;
  /**
   * §5.5 #17-27 ⑯ — [고정] 토글. 켜면 세션을 옮겨도 지금 탭 줄이 그대로 따라간다.
   * 끄면 지금 탭이 **그 세션의 것**이 되고(입양), 그 세션이 접어 두고 있던 탭은 뒤에 이어 붙는다.
   */
  setIDEEditorTabsPinned: (pinned: boolean, paneKey?: string | null) => void;
  /**
   * §5.5 #17-34 — 창 **안**의 화면 분할. 키 = 그 IDE 창의 슬롯 키(= `ideOverlays` 의 키라 창마다 따로 선다).
   * 항목이 없으면 분할이 없다는 뜻이며, 그때 본문은 종전 그대로 한 화면이다.
   */
  ideSplits: Record<string, IDESplitState>;
  /**
   * §5.5 #17-34 — 세션을 칸의 한 변(또는 가운데)에 떨군다.
   * `cellId=null` 이면 아직 안 나뉜 창 전체가 대상(첫 분할 — 지금 보던 세션이 반대쪽 칸이 된다).
   * `fromCellId` 를 주면 그 칸을 **옮기는** 것이라 칸 수가 늘지 않는다(원본 칸은 함께 닫힌다).
   */
  dropSessionOnIDECell: (
    slotKey: string,
    cellId: string | null,
    side: SplitDropSide,
    sessionId: string | null,
    fromCellId?: string | null,
  ) => void;
  /** §5.5 #17-34 — 칸 하나 닫기. 세션은 그대로 살아 있고 화면에서만 물러난다(탭바에 그대로 남는다). */
  closeIDESplitCell: (slotKey: string, cellId: string) => void;
  /** §5.5 #17-34 — 초점 칸 지정. 창 단위 단축키(Ctrl+F·Ctrl+휠)와 탭바 선택이 이 칸을 따라간다. */
  focusIDESplitCell: (slotKey: string, cellId: string) => void;
  /** §5.5 #17-34 — 손잡이 드래그 결과를 그대로 앉힌다(비율 계산은 `splitLayout` 순수 모듈이 한다). */
  setIDESplitLayout: (slotKey: string, layout: SplitNode) => void;
  /** §5.5 #17-34 — 사라진 세션을 문 칸을 걷어낸다. 바뀐 게 없으면 아무 일도 하지 않는다(되풀이 ❌). */
  syncIDESplitCells: (slotKey: string, validSessionIds: readonly string[]) => void;
  /** §5.5 #17-34 — 분할 해제. 초점 칸이 보던 세션 한 화면으로 되돌아간다. */
  resetIDESplit: (slotKey: string) => void;
  /** §5.5 #17-27 — 편집창 폭(px). 좌측 손잡이 드래그로 조절. localStorage 영속. */
  ideEditorWidth: number;
  setIdeEditorWidth: (w: number) => void;
  /**
   * §5.5 #17-27 ⑪ (g) — [추종]이 켜진 **세션키의 집합**(`에이전트::세션id`). 켜져 있으면 그 세션이
   * 고친 파일을 편집창이 따라 연다. 밀도(`ideStreamDensity`)와 **다른 축**이고, 세션마다 따로다 —
   * 옆 세션에서 켰다고 이 세션이 따라가지 않는다. localStorage 영속(상한 초과 시 오래된 키부터 정리).
   */
  ideEditorFollow: Record<string, true>;
  setIdeEditorFollow: (sessionKey: string, on: boolean) => void;
  /**
   * §5.5 #17-30 — 그 세션에서 **아직 보내지 않은** diff 리뷰 코멘트(세션키 → 목록).
   *
   * 보내면 사라지는 작업 메모라 서버·체크포인트·localStorage 어디에도 남기지 않는다(휘발).
   * 세션당 `DIFF_COMMENT_MAX` 개까지만 담는다 — 캡을 값 길이에만 걸고 **개수**에 안 걸어
   * 터졌던 전례(§3.2.3)를 반복하지 않기 위함.
   */
  diffComments: Record<string, DiffComment[]>;
  addDiffComment: (sessionKey: string, comment: DiffComment) => void;
  removeDiffComment: (sessionKey: string, commentId: string) => void;
  clearDiffComments: (sessionKey: string) => void;
  /**
   * §5.5 #17-27 ⑪ — 방금 도착한 편집을 편집창에 알리는 **일회성 신호**(영속 ❌ · 체크포인트 ❌).
   * 여는 쪽(`useEditorFollow`)과 그리는 쪽(`IDEEditorPane`)이 서로 멀어, 탭 목록과 같은 축으로 건넨다.
   * 편집창이 다시 읽기·스크롤·강조를 끝내면 스스로 비운다.
   */
  ideEditorFollowSignal: EditorFollowSignal | null;
  setIdeEditorFollowSignal: (signal: EditorFollowSignal) => void;
  clearIdeEditorFollowSignal: () => void;
  /**
   * §5.5 #17-27 ⑪ (h) — **방금 따라간 것**(어느 세션이 · 어느 파일 · 몇 번째 줄 · 언제).
   * 강조는 1.8초면 사라지지만 이 자국은 남아 상태바 칩·편집창 추종 띠가 같은 것을 말한다.
   * 표시 전용 · 영속 ❌(창을 닫으면 사라진다).
   */
  ideEditorFollowLast: EditorFollowMark | null;
  setIdeEditorFollowLast: (mark: EditorFollowMark) => void;
  /**
   * §5.5 #17-27 ⑪ (h) — 추종이 **꺼져 있는 동안** 그 세션이 마지막으로 고친 "따라갈 수 있었던 편집".
   * 화면에 상주하지 않는 **속기억** · 영속 ❌. 켜는 순간 소진된다.
   */
  ideEditorFollowPending: EditorFollowPending | null;
  setIdeEditorFollowPending: (pending: EditorFollowPending | null) => void;
  /**
   * §5.5 #17-27 ⑪ (h) — **켜면서 마지막 편집으로 곧바로 따라간다**(토글을 켜는 유일한 경로).
   * 켜기 + 열기 + 신호를 한 걸음으로 묶어, "켰는데 다음 편집이 올 때까지 아무 일도 없는" 빈 시간을 없앤다.
   * 기억해 둔 편집이 없으면 그냥 켜기만 한다.
   */
  followPendingEditNow: (sessionKey: string) => void;
  /** 커스텀 에이전트 버블이 표시할 "선택된 sub" 영구 맵 (agentId → subId).
   *  IDE 오버레이가 닫혀도 유지 — 버블의 context 게이지/라벨 override 소스. */
  selectedSubByAgent: Record<string, string>;
  selectSubForAgent: (agentId: string, subId: string) => void;
  /** IDE 북마크 — 프로젝트별 보관함(프로젝트 표시명 → 조각 목록, localStorage 영속). §5.5 #17-7. */
  ideBookmarks: BookmarkStore;
  /** 선택 텍스트를 지금 보고 있는 프로젝트 칸에 북마크로 추가(최신이 앞). 빈 텍스트는 무시. */
  addBookmark: (input: { text: string; agentId: string; sessionId: string | null; projectId: string | null; agentLabel: string; anchorId?: string }) => void;
  /** 북마크 1개 제거. */
  removeBookmark: (id: string) => void;
  /** 북마크 출처 세션으로 이동(필요 시 프로젝트 탭 전환 + IDE 오버레이 + 세션 선택) + 본문 스크롤 타깃 설정. */
  jumpToBookmark: (bookmark: IDEBookmark) => void;
  /** 이동 직후 본문 위치 스크롤용 1회성 타깃. IDEMainArea 가 소비 후 clear. */
  bookmarkScrollTarget: BookmarkScrollTarget | null;
  /** bookmarkScrollTarget 소비 완료 처리. */
  clearBookmarkScrollTarget: () => void;
  // §5.5 #17-7·#17-8 v4.93 — 북마크·세션 요약의 덮개 토글(`bookmarkPanelOpen`/`summaryPanelOpen`)은
  //   폐지됐다. 두 화면은 `IDEViewType` 의 'bookmarks'/'summary' 사이드바 뷰이므로 여닫는 상태는
  //   다른 항목과 똑같이 `ideOverlays[proj].activeView` + `sidebarCollapsed` 하나로 표현된다.
  // §5.5 #17-9 ③ v4.95 — "실행 중 서브에이전트" 의 덮개 토글(`subagentPanelOpen` + 2 액션)도 폐지됐다.
  //   그 화면은 `IDEViewType` 의 'subagents' 사이드바 뷰이므로 여닫는 상태는 다른 항목과 똑같이
  //   `ideOverlays[proj].activeView` + `sidebarCollapsed` 하나로 표현된다(= IDE 에 남은 덮개는 실행 출력뿐).
  /** §5.5 #17-8 v2.95 — 세션 자기요약 캐시(subId → 항목). 카드 없는 세션의 CLI 요약 텍스트 보관 + 닫힌 세션도 보드에 남김. localStorage 영속. */
  sessionSummaries: Record<string, SessionSummaryEntry>;
  /** 자기요약 텍스트 저장(없으면 추가, 있으면 갱신). */
  setSessionSummary: (entry: SessionSummaryEntry) => void;
  /** 한 세션 요약 항목 제거. */
  removeSessionSummary: (subId: string) => void;
  /** 세션을 닫을 때 그 요약 항목을 closed=true 로 마킹(보드에 잔류, 없으면 무시). */
  markSessionSummaryClosed: (subId: string) => void;
  /** §5.5 #17-4 v2.93 — SkillsView 에서 사용자가 본(클릭한) 스킬 키 집합(`source:name`). 미클릭 신규 스킬 색 구분용. localStorage 영속. */
  seenSkills: { initialized: boolean; keys: Record<string, true> };
  /** 최초 1회 — 현재 보이는 전 스킬을 "본 것"으로 시드(첫 로드 전체 신규 깜빡임 방지). 이미 initialized 면 무시. */
  seedSeenSkills: (keys: string[]) => void;
  /** 스킬을 본 것으로 표시(클릭 시). 이미 본 것이면 무변경. */
  markSkillSeen: (key: string) => void;
  /** IDE 본문(스트림/대화) 텍스트 줌 배율(1 = 100%). Ctrl+휠로 조절. 캔버스·창 UI 와 무관. localStorage 영속. */
  ideTextZoom: number;
  /** IDE 본문 텍스트 줌 배율 설정(0.6~2.4 로 클램프 + 영속). */
  setIdeTextZoom: (z: number) => void;
  /** §5.5 #17-12 — IDE 스트림 표시 밀도(간결/표준/원문). 하단 상태바 토글로 전환. localStorage 영속. */
  ideStreamDensity: StreamDensity;
  /** 표시 밀도 설정(+영속). */
  setIdeStreamDensity: (d: StreamDensity) => void;
  /** §5.5 — IDE 읽기 설정(폭·행간·자간·글꼴 등). 상단 바 [읽기] 패널로 조절. localStorage 영속. */
  ideReading: ReadingSettings;
  /** 읽기 설정 부분 갱신(+정규화·영속). 바뀐 게 없으면 상태를 그대로 둔다. */
  setIdeReading: (patch: Partial<ReadingSettings>) => void;
  /** 읽기 설정을 연구 기본값으로 되돌린다. */
  resetIdeReading: () => void;
  /** 현재 UI 언어 (서버 SSOT — ProjectCheckpoint.uiLocale). */
  uiLocale: UiLocale;
  /** 서버 스냅샷 수신 시 호출 — 상태 갱신 + i18n 언어 전환. */
  applyUiLocale: (locale: UiLocale) => void;
  /** §4 v1.50 — graph_snapshot 수신 시 도구 시간 / 컴팩션 / 한도 메트릭 반영. */
  applyV150Metrics: (
    recentToolDurations: Record<string, ToolDurationEntry[]> | undefined,
    compactCounts: Record<string, CompactCount> | undefined,
    rateLimits: RateLimitInfo | undefined,
    claudeUsage: ClaudeUsageInfo | undefined,
  ) => void;
  /** §5.5 #17-4 v2.36 — graph_snapshot 의 스킬 사용 카운트 반영. */
  applySkillUsageCounts: (counts: Record<string, Record<string, number>> | undefined) => void;
  /** §5.3 #10-2 v2.37 — graph_snapshot 의 Auto Agent 요약 메타 반영. */
  applyAutoAgentSummaries: (summaries: Record<string, AutoAgentSummary> | undefined) => void;
  /** §5.3 #10-3 v4.98 — graph_snapshot 의 검증 런 반영. */
  applyAutoAgentRuns: (runs: Record<string, AutoAgentRun[]> | undefined) => void;
  /** §5.5 #17-9 v3.51 — graph_snapshot 의 "실행 중 서브에이전트" 반영. */
  applyRunningSubagentTasks: (tasks: Record<string, RunningSubagentTask[]> | undefined) => void;
  /** §5.5 #17-9 ⑦(b) — graph_snapshot 의 "방금 끝난 서브에이전트" 반영. */
  applyFinishedSubagentTasks: (tasks: Record<string, FinishedSubagentTask[]> | undefined) => void;
  /** §4 v2.52 — graph_snapshot 의 에이전트 작업 신고 반영. */
  applyAgentReports: (reports: Record<string, AgentReport[]> | undefined) => void;
  /** §5.5 #17-36 — graph_snapshot 의 메인 탭 스티키 메모 반영. */
  applyAgentMemos: (memos: Record<string, SessionMemo[]> | undefined) => void;
  /** §4 v2.60 — graph_snapshot 의 에이전트 질문 카드 반영. */
  applyAgentQuestions: (questions: Record<string, AgentQuestions[]> | undefined) => void;
  /** §4 v2.70 — graph_snapshot 의 에이전트 검수 요청 카드 반영. */
  applyAgentReviews: (reviews: Record<string, AgentReview[]> | undefined) => void;
  /** §5.16 — graph_snapshot 의 리뷰·승인 레인 반영(서버가 매 스냅샷에 전량을 싣는다). */
  applyReviewRequests: (list: ReviewRequest[] | undefined) => void;
  /** §4 v2.84 — graph_snapshot 의 에이전트 번호 목록 정렬 카드 반영. */
  applyAgentLists: (lists: Record<string, AgentList[]> | undefined) => void;
  /** §4 v3.21 — graph_snapshot 의 에이전트 피드백 반영. */
  applyAgentFeedbacks: (feedbacks: Record<string, AgentFeedback[]> | undefined) => void;
  /**
   * §4 v3.21 — 좋아요/싫어요 평가 전송 (targetId 별 upsert, verdict null = 철회).
   * 서버가 broadcast 로 되돌려주는 graph_snapshot 이 SSOT — 클라는 전송만.
   */
  setFeedback: (input: {
    agentId: string;
    subAgentId?: string | null;
    targetType: AgentFeedbackTargetType;
    targetId: string;
    verdict: AgentFeedbackVerdict | null;
    reason?: string;
    summary: string[];
  }) => void;
  /** §5.5 #17-11 v3.79 — graph_snapshot 의 세션 루프 설정 반영. */
  applySessionLoops: (loops: Record<string, SessionLoop> | undefined) => void;
  /** §5.5 #17-35 — 스냅샷의 검증 이력을 통째로 받는다. */
  applyVerificationRuns: (runs: Record<string, VerificationRun[]> | undefined) => void;
  /** 검증 시작 — 그 탭 큐에 `/verify` 한 건이 나간다. 실패 사유 문자열(성공이면 null). */
  /**
   * §5.5 #17-35 — 검증 시작. 성공하면 그 검증의 id 를 함께 돌려준다 — ⑩ 화면 녹화가 **어느 줄에**
   * 붙을지를 그 id 로 정하기 때문이다(실패는 사유 문자열).
   */
  startVerification: (input: { agentId: string; subAgentId: string; focus?: string; demoId?: string }) => Promise<{ ok: true; runId: string } | { ok: false; error: string }>;
  /** §5.5 #17-35 ⑨ — 스냅샷의 시연 목록을 그대로 받는다(전량 교체 — 삭제도 곧 사라짐으로 반영). */
  applyVerificationDemos: (demos: Record<string, VerificationDemo[]> | undefined) => void;
  /**
   * 시연 레코드를 만든다(그림 없이). 성공하면 그 시연, 실패하면 사유 문자열.
   * 그림은 이어서 `uploadVerificationDemoFrame` 이 한 장씩 붙인다(⑨ REST 규약).
   */
  createVerificationDemo: (input: {
    agentId: string;
    subAgentId: string;
    label: string;
    sourceName: string;
    steps: { atMs: number; text: string }[];
    expected?: string;
    durationMs: number;
  }) => Promise<VerificationDemo | string>;
  /** 시연에 프레임 한 장 추가. 붙었으면 true. */
  uploadVerificationDemoFrame: (demoId: string, file: File, atMs: number) => Promise<boolean>;
  /** 시연 한 건 삭제(레코드+그림). */
  deleteVerificationDemo: (demoId: string) => Promise<void>;
  /** 도는 검증을 목록에서 닫는다(그 턴 자체의 중지는 기존 [중지] 버튼). */
  stopVerification: (runId: string) => Promise<void>;
  /** 실패·보류 사유를 그대로 그 탭의 다음 프롬프트로 보낸다. */
  reworkVerification: (runId: string) => Promise<void>;
  /** 검증 한 줄 삭제. */
  deleteVerificationRun: (runId: string) => Promise<void>;
  /**
   * §5.5 #17-11 v3.79 — 세션 루프 저장 (PUT). `enabled:true` 면 서버가 즉시 1회차를 발사한다.
   * 결과는 서버 broadcast(graph_snapshot)가 SSOT — 클라는 낙관적 갱신 ❌.
   */
  saveSessionLoop: (input: {
    agentId: string;
    subAgentId: string;
    command: string;
    mode: SessionLoopMode;
    total?: number;
    intervalMs: number;
    stopOnError: boolean;
    /** §5.5 #17-11 ⑪·⑫(b) — 회차 사이 컨텍스트 처리(없음/압축/초기화). */
    contextMode: SessionLoopContextMode;
    /** §5.5 #17-11 ⑫(a) — 누적 예산 상한. 0·미설정이면 무제한. */
    maxCostUsd?: number;
    maxTokens?: number;
    maxDurationMs?: number;
    /** §5.5 #17-11 ⑫(c)(d)(e)(f) — 회차 프롬프트 규약. */
    progressFile?: string;
    oneTaskPerRound: boolean;
    commitEachRound: boolean;
    commandFile?: string;
    enabled: boolean;
  }) => Promise<void>;
  /** §5.5 #17-11 v3.79 — 루프 정지(설정 유지) 또는 삭제. */
  endSessionLoop: (agentId: string, subAgentId: string, mode: 'stop' | 'delete') => Promise<void>;
  /** §5.5 #17-17 v4.46 — graph_snapshot 의 세션 목표 반영. */
  applySessionGoals: (goals: Record<string, SessionGoal> | undefined) => void;
  /**
   * §5.5 #17-17 v4.46 — 목표 저장 (PUT). 문장 수정·상태 변경 모두 이 문으로 간다.
   * 서버가 revision·textChangedAt 을 판정하므로 클라는 낙관적 갱신 ❌(broadcast 가 SSOT).
   */
  saveSessionGoal: (input: {
    agentId: string;
    subAgentId: string;
    text: string;
    status?: SessionGoalStatus;
  }) => Promise<void>;
  /**
   * §5.5 #17-17 v4.47 — 사용자 진행 갱신 (POST …/progress, `source:'user'`).
   * 체크박스 토글·단계 추가·삭제는 **목록 전체**를 `steps` 로 보낸다(서버가 본문 일치로 id 를 잇는다).
   * 단계가 없는 목표에서만 `percent` 숫자 보정이 의미를 갖는다.
   */
  setSessionGoalProgress: (input: {
    agentId: string;
    subAgentId: string;
    percent?: number;
    steps?: { text: string; status: SessionGoalStepStatus }[];
    note?: string;
  }) => Promise<void>;
  /** §5.5 #17-17 v4.46 — 목표 해제(삭제). */
  endSessionGoal: (agentId: string, subAgentId: string) => Promise<void>;
  /** §4 v1.98 — graph_snapshot 수신 시 진단 에러 로그 반영. */
  applyDiagnosticLog: (log: DiagnosticEntry[] | undefined) => void;
  /** §4 v2.38 — graph_snapshot 또는 model_registry_updated 수신 시 레지스트리 반영. */
  applyModelRegistry: (reg: ModelRegistry | undefined) => void;
  /** §5.19 — 스냅샷의 로컬 LLM 상태 반영. */
  applyLocalLlm: (state: LocalLlmState | undefined) => void;
  /** §5.19 — WS 진행 push 를 같은 슬라이스에 얹는다(스냅샷을 기다리지 않고 막대가 움직이게). */
  applyLocalEngineProgress: (p: LocalEngineProgress) => void;
  applyLocalModelProgress: (p: LocalModelDownloadProgress) => void;
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

/**
 * §5.21 — 비용 지도가 실제로 달라졌는지 판별하는 지문.
 * 프로젝트별 갱신 시각과 줄 수만 보면 충분하다 — 값이 바뀌면 서버가 updatedAt 을 올린다.
 */
/**
 * §5.22 — 감사 원장 지문. 프로젝트별 갱신 시각과 줄 수·집계만 보면 충분하다
 * (결정이 적히면 `counts` 가 움직이고, 줄이 늘면 길이가 움직인다).
 */
function auditLogFingerprint(list: readonly ProjectAuditLog[]): string {
  return list
    .map((l) => `${l.projectName}:${l.updatedAt}:${l.entries.length}:${l.counts.denied}:${l.counts.escalated}:${l.boundary.escalateRisky ? 1 : 0}`)
    .join('|');
}

function costMapFingerprint(list: readonly ProjectCostMap[]): string {
  return list.map((m) => `${m.projectName}:${m.updatedAt}:${m.sessions.length}:${m.agents.length}`).join('|');
}

/**
 * §5.4 #14 v1.34 — 닫는 중 표시(`closingProjectPaths`)를 서버 truth 로 정리한다(순수 함수).
 * 규칙은 둘뿐이다:
 *   ① 서버 목록에서 **사라졌으면** 닫힌 것이니 표시를 걷는다(이후엔 서버 truth 가 곧 화면).
 *   ② 유예(`CLOSING_TAB_GRACE_MS`)가 지나도 **여전히 실려 오면** 닫기가 안 먹은 것이므로 표시를 걷어
 *      탭을 되돌린다 — 표시를 붙든 채로 두면 실재하는 탭이 영영 안 보이는 상태로 갇힌다.
 * 바뀐 게 없으면 **원래 참조를 그대로** 돌려준다(스냅샷마다 새 객체를 만들면 구독이 헛돈다).
 */
export const CLOSING_TAB_GRACE_MS = 5000;

export function pruneClosingProjects(
  closing: Record<string, number>,
  presentPaths: readonly string[],
  now: number = Date.now(),
): Record<string, number> {
  const keys = Object.keys(closing);
  if (keys.length === 0) return closing;
  const present = new Set(presentPaths.map(npStore));
  let changed = false;
  const next: Record<string, number> = {};
  for (const key of keys) {
    const at = closing[key]!;
    if (!present.has(key) || now - at > CLOSING_TAB_GRACE_MS) { changed = true; continue; }
    next[key] = at;
  }
  return changed ? next : closing;
}

/**
 * 이 id 가 **store 채널**(앱·캡처·플레이·스펙·랩·선반 버블 + 메모 상자 + 작업 엣지) 선택인가.
 *
 * `selectIntentId`(=선택 링 한 칸)는 네이티브 버블과 store 채널이 함께 쓴다. "지금 링을 들고
 * 있는 것이 어느 채널이냐"를 물어야 하는 자리가 한 곳 있어서(`clearElementSelection`) 그 판정을
 * 여기 한 번만 적어 둔다 — 채널이 늘면 이 배열에 한 줄 더한다.
 */
export function isStoreChannelSelection(
  state: Pick<
    GraphState,
    | 'selectedTaskEdgeId' | 'selectedCommentBoxId' | 'selectedCaptureBubbleId' | 'selectedAppBubbleId'
    | 'selectedPlayBubbleId' | 'selectedSpecDocId' | 'selectedLabRunId' | 'selectedShelfBubbleId'
  >,
  id: string | null,
): boolean {
  if (id === null) return false;
  return (
    state.selectedTaskEdgeId === id
    || state.selectedCommentBoxId === id
    || state.selectedCaptureBubbleId === id
    || state.selectedAppBubbleId === id
    || state.selectedPlayBubbleId === id
    || state.selectedSpecDocId === id
    || state.selectedLabRunId === id
    || state.selectedShelfBubbleId === id
  );
}

export const useGraphStore = create<GraphState>((set, get) => ({
  projects: {},
  stubProjects: {},
  closingProjectPaths: {},
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
      // §5.5 #17-23 ③ — 세션이 지워지면 그 세션의 명령 히스토리도 함께 지운다.
      //   세션 제거의 단일 창구(탭바·세션 요약·지휘통제실이 모두 이 액션을 지난다)라 여기 한 곳이면 된다.
      dropSessionCommandHistory(agentId, subAgentId);
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
    // §5.5 #17-29 — 훅 버블은 읽기 전용. 여기가 클라의 **유일한 전송 창구**라, 화면 어딘가에서
    //   손잡이를 지우는 걸 놓쳐도 명령은 나가지 않는다(서버도 같은 술어로 403 — 이중 방어).
    //   판정 원천은 `sid` 를 찾은 것과 같은 `agents` 배열이라 둘이 어긋나지 않는다.
    if (isReadOnlyHookAgent(get().agents.find((a) => a.id === agentId))) return;
    // §5.5 #17-23 — 사용자가 **보낸** 프롬프트를 그 세션의 명령 히스토리(↑/↓)에 적재.
    //   여기가 클라의 유일한 전송 창구(입력창·지휘통제실 카드·상세 패널 큐가 모두 지난다)라
    //   기록도 여기 한 곳에서 한다. 서버 큐는 완료된 명령을 빼 가므로 큐를 되읽는 방식으로는
    //   보낸 명령이 끝나는 순간 히스토리에서 사라졌다.
    //   키는 **사용자가 친 자리**(subAgentId, 메인 탭이면 null)다 — 서버가 새 세션을 배정하기
    //   전이므로 여기서 알 수 있는 세션이자, 사용자가 다음에 ↑ 를 누를 그 입력창이기도 하다.
    recordCommandHistory(agentId, subAgentId ?? null, text);
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
  setCommandDispatchMode: (agentId, commandId, mode) => {
    const sid = findSessionId(get().agents, agentId);
    if (!sid) return;
    // 서버가 SSOT — 성공하면 broadcast 로 돌아온 스냅샷이 칩을 갱신한다(낙관 반영 없음:
    // 즉시(immediate)는 서버가 실제로 끊었는지까지 판정하므로 화면이 앞서가면 거짓이 된다).
    fetch(`${API_BASE}/api/commands/${sid}/${commandId}/mode`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dispatchMode: mode }),
    }).catch(() => {});
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
  // ─── §5.13 v4.45 내부 앱 버블 ───
  // ─── §5.5 #17-20 ⑩ v4.94 공통 디버그 층 — 중단점 ───────────────────────────

  applyDebugBreakpoints: (record) => set((s) => {
    // 참조가 같으면 리렌더를 일으키지 않는다(대부분의 스냅샷에서 이 값은 안 바뀐다).
    const prev = s.debugBreakpoints;
    const prevKeys = Object.keys(prev);
    const nextKeys = Object.keys(record);
    if (prevKeys.length === nextKeys.length && prevKeys.every((k) => {
      const a = prev[k];
      const b = record[k];
      return !!a && !!b && a.length === b.length
        && a.every((bp, i) => bp.file === b[i]!.file && bp.line === b[i]!.line
          && bp.enabled === b[i]!.enabled && bp.verified === b[i]!.verified);
    })) {
      return s;
    }
    return { debugBreakpoints: record };
  }),

  toggleBreakpoint: (projectName, file, line) => {
    const current = get().debugBreakpoints[projectName] ?? [];
    const at = current.findIndex((bp) => bp.file === file && bp.line === line);
    const next = at >= 0
      ? current.filter((_, i) => i !== at)
      : [...current, { file, line, enabled: true }];
    commitBreakpoints(set, get, projectName, next);
  },

  // §5.5 #17-27 ⑨ v4.97 — 편집창 줄 번호 우클릭의 "이 파일 중단점 모두 제거".
  //   저장·세션 주입은 toggleBreakpoint 와 **같은 함수**를 쓴다(경로가 둘이면 한쪽이 뒤처진다).
  clearBreakpointsInFile: (projectName, file) => {
    const current = get().debugBreakpoints[projectName] ?? [];
    const next = current.filter((bp) => bp.file !== file);
    if (next.length === current.length) return;
    commitBreakpoints(set, get, projectName, next);
  },

  projectAgentCounts: {},
  applyProjectAgentCounts: (counts) => set((s) => ({
    // 내용이 그대로면 이전 참조를 유지한다(v3.72 구조적 공유 재사용) — 탭바가 스냅샷 주기마다
    // 헛되이 다시 그리지 않게 한다.
    projectAgentCounts: structuralShare(s.projectAgentCounts, counts),
  })),

  snapshotScope: null,
  snapshotReceived: false,
  applySnapshotScope: (scope) => set((s) => {
    const next = scope ?? null;
    // 같은 범위면 참조를 유지한다 — 이 값을 구독하는 쪽이 스냅샷 주기마다 깨어나지 않게.
    const same = next === null
      ? s.snapshotScope === null
      : s.snapshotScope !== null
        && s.snapshotScope.length === next.length
        && s.snapshotScope.every((n, i) => n === next[i]);
    if (same && s.snapshotReceived) return {};
    return { ...(same ? {} : { snapshotScope: next }), snapshotReceived: true };
  }),

  connectionStatus: 'connecting',
  setConnectionStatus: (status) => set((s) => (s.connectionStatus === status ? {} : { connectionStatus: status })),
  applyAppBubbles: (list) => set((s) => {
    // 드래그 중인 버블의 geometry 는 서버 값으로 덮지 않는다(CommentBox·CaptureBubble 과 동일 규칙).
    // 손이 움직이는 도중 WS 스냅샷이 도착하면 옛 좌표로 회귀해 버블이 마우스 뒤로 튄다.
    // 다른 창·다른 인스턴스에서 지워졌으면 선택도 함께 놓는다(없는 것을 고른 채로 두지 않는다).
    const keepSelected = s.selectedAppBubbleId !== null && list.some((b) => b.id === s.selectedAppBubbleId)
      ? s.selectedAppBubbleId
      : null;
    if (s.draggingAppBubbleIds.length === 0) return { appBubbles: list, selectedAppBubbleId: keepSelected };
    const locked = new Map<string, AppBubble>();
    for (const id of s.draggingAppBubbleIds) {
      const local = s.appBubbles.find((b) => b.id === id);
      if (local) locked.set(id, local);
    }
    if (locked.size === 0) return { appBubbles: list, selectedAppBubbleId: keepSelected };
    return {
      appBubbles: list.map((b) => {
        const local = locked.get(b.id);
        return local ? { ...b, x: local.x, y: local.y, width: local.width, height: local.height } : b;
      }),
      selectedAppBubbleId: keepSelected,
    };
  }),
  patchAppBubbleLocal: (id, updates) => set((s) => ({
    appBubbles: s.appBubbles.map((b) => (b.id === id ? { ...b, ...updates } : b)),
  })),
  // §5.11 v4.65 — 서버 권위 런타임 값이라 매 스냅샷 통째 교체다(영속 X → 스냅샷 정리 함정 무관).
  //   빈 맵도 정상값이다 — 마지막 집행 플러그인을 끈 직후 카드가 옛 실측을 계속 보여 주면 안 된다.
  //   신원이 같으면 그대로 둔다(모든 버블의 플러그인 컨텍스트가 재계산되는 것을 막는다).
  applyPluginFacts: (facts) => set((s) => {
    const prev = s.pluginFacts;
    const sameKeys = Object.keys(prev).length === Object.keys(facts).length
      && Object.keys(facts).every((k) => prev[k] === facts[k]);
    return sameKeys ? {} : { pluginFacts: facts };
  }),
  draggingAppBubbleIds: [],
  setAppBubbleDragLock: (id, on) => set((s) => {
    const has = s.draggingAppBubbleIds.includes(id);
    if (on && !has) return { draggingAppBubbleIds: [...s.draggingAppBubbleIds, id] };
    if (!on && has) return { draggingAppBubbleIds: s.draggingAppBubbleIds.filter((x) => x !== id) };
    return s;
  }),
  deleteAppBubble: async (id) => {
    try {
      const res = await fetch(`${API_BASE}/api/app-bubbles/${id}`, { method: 'DELETE' });
      if (!res.ok) return false; // 409 = 핀으로 보호됨, 404 = 이미 없음
    } catch {
      return false; // 연결이 끊겼으면 지운 척하지 않는다 — 다음 스냅샷이 진실이다.
    }
    set((s) => ({
      appBubbles: s.appBubbles.filter((b) => b.id !== id),
      selectedAppBubbleId: s.selectedAppBubbleId === id ? null : s.selectedAppBubbleId,
    }));
    return true;
  },
  // 이름·핀은 화면 먼저(낙관), 서버는 뒤따른다 — 실패해도 다음 스냅샷이 진실을 되돌린다.
  //   삭제와 달리 되돌아와도 사용자가 잃는 것이 없어 즉시 반영이 낫다.
  renameAppBubble: (id, title) => {
    const next = title.trim();
    get().patchAppBubbleLocal(id, { title: next });
    void fetch(`${API_BASE}/api/app-bubbles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: next }),
    }).catch(() => undefined);
  },
  setAppBubblePin: (id, pinned) => {
    get().patchAppBubbleLocal(id, { preservePinned: pinned });
    void fetch(`${API_BASE}/api/app-bubbles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preservePinned: pinned }),
    }).catch(() => undefined);
  },
  // ─── §5.9 캡처 버블 (CommentBox 패턴) ───
  patchCaptureBubbleLocal: (id, updates) => set((s) => ({
    captureBubbles: s.captureBubbles.map((b) => (b.id === id ? { ...b, ...updates } : b)),
  })),
  draggingCaptureBubbleIds: [],
  setCaptureBubbleDragLock: (id, on) => set((s) => {
    const has = s.draggingCaptureBubbleIds.includes(id);
    if (on && !has) return { draggingCaptureBubbleIds: [...s.draggingCaptureBubbleIds, id] };
    if (!on && has) return { draggingCaptureBubbleIds: s.draggingCaptureBubbleIds.filter((x) => x !== id) };
    return s;
  }),
  createCaptureBubble: async (input) => {
    try {
      const res = await fetch(`${API_BASE}/api/capture-bubbles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) return null;
      const data = await res.json() as { ok: boolean; data?: CaptureBubble };
      const bubble = data.data ?? null;
      if (bubble) {
        set((s) => (s.captureBubbles.some((b) => b.id === bubble.id)
          ? s
          : { captureBubbles: [...s.captureBubbles, bubble] }));
      }
      return bubble;
    } catch {
      return null;
    }
  },
  updateCaptureBubble: async (id, updates) => {
    set((s) => ({
      captureBubbles: s.captureBubbles.map((b) => (b.id === id ? { ...b, ...updates } : b)),
    }));
    try {
      await fetch(`${API_BASE}/api/capture-bubbles/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
    } catch { /* 서버 스냅샷이 다음 턴에 덮어씀 */ }
  },
  deleteCaptureBubble: async (id) => {
    set((s) => ({
      captureBubbles: s.captureBubbles.filter((b) => b.id !== id),
      selectedCaptureBubbleId: s.selectedCaptureBubbleId === id ? null : s.selectedCaptureBubbleId,
    }));
    // §5.9 플레이테스트 — 이 버블의 녹화 클립(렌더러 메모리 Blob)을 함께 반납한다.
    clearCapturePlaytest(id);
    try {
      await fetch(`${API_BASE}/api/capture-bubbles/${id}`, { method: 'DELETE' });
    } catch { /* 재연결 후 다음 snapshot 에서 동기화 */ }
  },

  // ─── §5.14 v4.62 플레이 버블 (앱 버블 패턴 — 낙관 반영 + 드래그 락이 한 쌍) ───
  playBubbles: [],
  applyPlayBubbles: (list) => set((s) => {
    const keepSelected = s.selectedPlayBubbleId !== null && list.some((b) => b.id === s.selectedPlayBubbleId)
      ? s.selectedPlayBubbleId
      : null;
    if (s.draggingPlayBubbleIds.length === 0) return { playBubbles: list, selectedPlayBubbleId: keepSelected };
    // 드래그 중인 버블의 좌표만 로컬 값으로 지킨다(실행 상태·레시피는 서버가 권위).
    const locked = new Map<string, PlayBubble>();
    for (const id of s.draggingPlayBubbleIds) {
      const local = s.playBubbles.find((b) => b.id === id);
      if (local) locked.set(id, local);
    }
    if (locked.size === 0) return { playBubbles: list, selectedPlayBubbleId: keepSelected };
    return {
      playBubbles: list.map((b) => {
        const local = locked.get(b.id);
        if (!local) return b;
        return {
          ...b,
          x: local.x, y: local.y, width: local.width, height: local.height,
          previewX: local.previewX, previewY: local.previewY,
          previewWidth: local.previewWidth, previewHeight: local.previewHeight,
        };
      }),
      selectedPlayBubbleId: keepSelected,
    };
  }),
  patchPlayBubbleLocal: (id, updates) => set((s) => ({
    playBubbles: s.playBubbles.map((b) => (b.id === id ? { ...b, ...updates } : b)),
  })),
  draggingPlayBubbleIds: [],
  setPlayBubbleDragLock: (id, on) => set((s) => {
    const has = s.draggingPlayBubbleIds.includes(id);
    if (on && !has) return { draggingPlayBubbleIds: [...s.draggingPlayBubbleIds, id] };
    if (!on && has) return { draggingPlayBubbleIds: s.draggingPlayBubbleIds.filter((x) => x !== id) };
    return s;
  }),
  selectedPlayBubbleId: null,
  // 다른 선택과 배타 — 캔버스의 선택은 언제나 하나여야 Delete 키가 무엇을 지울지 헷갈리지 않는다.
  selectPlayBubble: (id) => set({
    selectedPlayBubbleId: id,
    selectedNodeId: null,
    selectIntentId: id,
    selectedTaskEdgeId: null,
    selectedCommentBoxId: null,
    selectedCaptureBubbleId: null,
    selectedAppBubbleId: null,
    selectedSpecDocId: null,
    selectedLabRunId: null,
    selectedShelfBubbleId: null,
  }),
  createPlayBubble: async (input) => {
    try {
      const res = await fetch(`${API_BASE}/api/play-bubbles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) return null;
      const data = await res.json() as { ok: boolean; data?: PlayBubble };
      const bubble = data.data ?? null;
      if (bubble) {
        set((s) => (s.playBubbles.some((b) => b.id === bubble.id) ? s : { playBubbles: [...s.playBubbles, bubble] }));
      }
      return bubble;
    } catch {
      return null;
    }
  },
  updatePlayBubble: async (id, updates) => {
    set((s) => ({ playBubbles: s.playBubbles.map((b) => (b.id === id ? { ...b, ...updates } : b)) }));
    try {
      await fetch(`${API_BASE}/api/play-bubbles/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
    } catch { /* 다음 스냅샷이 진실 */ }
  },
  deletePlayBubble: async (id) => {
    try {
      const res = await fetch(`${API_BASE}/api/play-bubbles/${id}`, { method: 'DELETE' });
      if (!res.ok) return false; // 409 = 핀으로 보호됨, 404 = 이미 없음
    } catch {
      return false;
    }
    set((s) => ({
      playBubbles: s.playBubbles.filter((b) => b.id !== id),
      selectedPlayBubbleId: s.selectedPlayBubbleId === id ? null : s.selectedPlayBubbleId,
    }));
    return true;
  },
  startPlayBubble: async (id) => {
    // 낙관 반영 — 누른 즉시 버튼이 반응해야 한다(기동은 수십 초까지 걸린다).
    set((s) => ({ playBubbles: s.playBubbles.map((b) => (b.id === id ? { ...b, status: 'starting' as const, error: undefined } : b)) }));
    try {
      await fetch(`${API_BASE}/api/play-bubbles/${id}/start`, { method: 'POST' });
    } catch { /* 실패는 서버가 status='failed' 로 알려 준다 */ }
  },
  stopPlayBubble: async (id) => {
    set((s) => ({ playBubbles: s.playBubbles.map((b) => (b.id === id ? { ...b, status: 'idle' as const, url: undefined } : b)) }));
    try {
      await fetch(`${API_BASE}/api/play-bubbles/${id}/stop`, { method: 'POST' });
    } catch { /* 다음 스냅샷이 진실 */ }
  },
  detectPlayRecipe: async (id, apply) => {
    try {
      const res = await fetch(`${API_BASE}/api/play-bubbles/${id}/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply }),
      });
      if (!res.ok) return [];
      const data = await res.json() as { candidates?: PlayRecipeCandidate[]; data?: PlayBubble };
      if (data.data) {
        const updated = data.data;
        set((s) => ({ playBubbles: s.playBubbles.map((b) => (b.id === id ? updated : b)) }));
      }
      return data.candidates ?? [];
    } catch {
      return [];
    }
  },
  askAgentForPlayRecipe: async (id, agentId) => {
    try {
      const res = await fetch(`${API_BASE}/api/play-bubbles/${id}/ask-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  // ─── §5.15 스펙 보드 (플레이 버블 패턴 — 낙관 반영 + 드래그 락이 한 쌍) ───
  specDocs: [],
  applySpecDocs: (list) => set((s) => {
    const keepSelected = s.selectedSpecDocId !== null && list.some((d) => d.id === s.selectedSpecDocId)
      ? s.selectedSpecDocId
      : null;
    // 패널이 열려 있던 스펙이 사라졌으면 패널도 닫는다(빈 오버레이가 남지 않게).
    const keepOpen = s.specBoardOpenId !== null && list.some((d) => d.id === s.specBoardOpenId)
      ? s.specBoardOpenId
      : null;
    if (s.draggingSpecDocIds.length === 0) {
      return { specDocs: list, selectedSpecDocId: keepSelected, specBoardOpenId: keepOpen };
    }
    const locked = new Map<string, SpecDoc>();
    for (const id of s.draggingSpecDocIds) {
      const local = s.specDocs.find((d) => d.id === id);
      if (local) locked.set(id, local);
    }
    if (locked.size === 0) {
      return { specDocs: list, selectedSpecDocId: keepSelected, specBoardOpenId: keepOpen };
    }
    return {
      specDocs: list.map((d) => {
        const local = locked.get(d.id);
        if (!local) return d;
        return { ...d, x: local.x, y: local.y, width: local.width, height: local.height };
      }),
      selectedSpecDocId: keepSelected,
      specBoardOpenId: keepOpen,
    };
  }),
  patchSpecDocLocal: (id, updates) => set((s) => ({
    specDocs: s.specDocs.map((d) => (d.id === id ? { ...d, ...updates } : d)),
  })),
  draggingSpecDocIds: [],
  setSpecDocDragLock: (id, on) => set((s) => {
    const has = s.draggingSpecDocIds.includes(id);
    if (on && !has) return { draggingSpecDocIds: [...s.draggingSpecDocIds, id] };
    if (!on && has) return { draggingSpecDocIds: s.draggingSpecDocIds.filter((x) => x !== id) };
    return s;
  }),
  selectedSpecDocId: null,
  // 다른 선택과 배타 — 캔버스의 선택은 언제나 하나여야 Delete 키가 무엇을 지울지 헷갈리지 않는다.
  selectSpecDoc: (id) => set({
    selectedSpecDocId: id,
    selectedNodeId: null,
    selectIntentId: id,
    selectedTaskEdgeId: null,
    selectedCommentBoxId: null,
    selectedCaptureBubbleId: null,
    selectedAppBubbleId: null,
    selectedPlayBubbleId: null,
    selectedLabRunId: null,
    selectedShelfBubbleId: null,
  }),
  specBoardOpenId: null,
  openSpecBoard: (id) => set({ specBoardOpenId: id }),
  closeSpecBoard: () => set({ specBoardOpenId: null }),
  createSpecDoc: async (input) => {
    try {
      const res = await fetch(`${API_BASE}/api/spec-docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) return null;
      const data = await res.json() as { ok: boolean; data?: SpecDoc };
      const doc = data.data ?? null;
      if (doc) {
        set((s) => (s.specDocs.some((d) => d.id === doc.id) ? s : { specDocs: [...s.specDocs, doc] }));
      }
      return doc;
    } catch {
      return null;
    }
  },
  updateSpecDoc: async (id, updates) => {
    set((s) => ({ specDocs: s.specDocs.map((d) => (d.id === id ? { ...d, ...updates } : d)) }));
    try {
      const res = await fetch(`${API_BASE}/api/spec-docs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) return;
      // 개정 번호·항목 id 는 서버가 발급한다 — 응답으로 덮어 로컬 낙관값을 진실로 되돌린다.
      const data = await res.json() as { ok: boolean; data?: SpecDoc };
      const doc = data.data;
      if (doc) set((s) => ({ specDocs: s.specDocs.map((d) => (d.id === id ? doc : d)) }));
    } catch { /* 다음 스냅샷이 진실 */ }
  },
  addSpecItem: async (id, text) => {
    try {
      const res = await fetch(`${API_BASE}/api/spec-docs/${id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return;
      const data = await res.json() as { ok: boolean; data?: SpecDoc };
      const doc = data.data;
      if (doc) set((s) => ({ specDocs: s.specDocs.map((d) => (d.id === id ? doc : d)) }));
    } catch { /* 다음 스냅샷이 진실 */ }
  },
  deleteSpecDoc: async (id) => {
    try {
      const res = await fetch(`${API_BASE}/api/spec-docs/${id}`, { method: 'DELETE' });
      if (!res.ok) return false; // 409 = 핀으로 보호됨, 404 = 이미 없음
    } catch {
      return false;
    }
    set((s) => ({
      specDocs: s.specDocs.filter((d) => d.id !== id),
      selectedSpecDocId: s.selectedSpecDocId === id ? null : s.selectedSpecDocId,
      specBoardOpenId: s.specBoardOpenId === id ? null : s.specBoardOpenId,
    }));
    return true;
  },
  generateSpecTasks: async (id, itemIds, regenerate) => {
    try {
      const res = await fetch(`${API_BASE}/api/spec-docs/${id}/generate-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(itemIds ? { itemIds } : {}),
          ...(regenerate === true ? { regenerate: true } : {}),
        }),
      });
      if (!res.ok) return false;
      const data = await res.json() as { ok: boolean; data?: SpecDoc };
      const doc = data.data;
      if (doc) set((s) => ({ specDocs: s.specDocs.map((d) => (d.id === id ? doc : d)) }));
      return true;
    } catch {
      return false;
    }
  },
  detachSpecTask: async (id, itemId) => {
    try {
      const res = await fetch(`${API_BASE}/api/spec-docs/${id}/items/${itemId}/task`, { method: 'DELETE' });
      if (!res.ok) return;
    } catch { return; }
    set((s) => ({
      specDocs: s.specDocs.map((d) => (d.id === id
        ? {
          ...d,
          items: d.items.map((it) => {
            if (it.id !== itemId) return it;
            const { taskAgentId: _a, taskSessionId: _s, generatedRevision: _r, ...rest } = it;
            return rest;
          }),
        }
        : d)),
    }));
  },

  // ─── §5.18 에이전트 랩 (스펙 보드 패턴 — 낙관 반영 + 드래그 락이 한 쌍) ───
  labRuns: [],
  applyLabRuns: (list) => set((s) => {
    const keepSelected = s.selectedLabRunId !== null && list.some((r) => r.id === s.selectedLabRunId)
      ? s.selectedLabRunId
      : null;
    // 패널이 열려 있던 랩이 사라졌으면 패널도 닫는다(빈 오버레이가 남지 않게).
    const keepOpen = s.labPanelOpenId !== null && list.some((r) => r.id === s.labPanelOpenId)
      ? s.labPanelOpenId
      : null;
    if (s.draggingLabRunIds.length === 0) {
      return { labRuns: list, selectedLabRunId: keepSelected, labPanelOpenId: keepOpen };
    }
    const locked = new Map<string, LabRun>();
    for (const id of s.draggingLabRunIds) {
      const local = s.labRuns.find((r) => r.id === id);
      if (local) locked.set(id, local);
    }
    if (locked.size === 0) {
      return { labRuns: list, selectedLabRunId: keepSelected, labPanelOpenId: keepOpen };
    }
    return {
      labRuns: list.map((r) => {
        const local = locked.get(r.id);
        if (!local) return r;
        return { ...r, x: local.x, y: local.y, width: local.width, height: local.height };
      }),
      selectedLabRunId: keepSelected,
      labPanelOpenId: keepOpen,
    };
  }),
  patchLabRunLocal: (id, updates) => set((s) => ({
    labRuns: s.labRuns.map((r) => (r.id === id ? { ...r, ...updates } : r)),
  })),
  draggingLabRunIds: [],
  setLabRunDragLock: (id, on) => set((s) => {
    const has = s.draggingLabRunIds.includes(id);
    if (on && !has) return { draggingLabRunIds: [...s.draggingLabRunIds, id] };
    if (!on && has) return { draggingLabRunIds: s.draggingLabRunIds.filter((x) => x !== id) };
    return s;
  }),
  selectedLabRunId: null,
  // 다른 선택과 배타 — 캔버스의 선택은 언제나 하나여야 Delete 키가 무엇을 지울지 헷갈리지 않는다.
  selectLabRun: (id) => set({
    selectedLabRunId: id,
    selectedNodeId: null,
    selectIntentId: id,
    selectedTaskEdgeId: null,
    selectedCommentBoxId: null,
    selectedCaptureBubbleId: null,
    selectedAppBubbleId: null,
    selectedPlayBubbleId: null,
    selectedSpecDocId: null,
  }),
  labPanelOpenId: null,
  openLabPanel: (id) => set({ labPanelOpenId: id }),
  closeLabPanel: () => set({ labPanelOpenId: null }),
  createLabRun: async (input) => {
    try {
      const res = await fetch(`${API_BASE}/api/lab-runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) return null;
      const data = await res.json() as { ok: boolean; data?: LabRun };
      const run = data.data ?? null;
      if (run) {
        set((s) => (s.labRuns.some((r) => r.id === run.id) ? s : { labRuns: [...s.labRuns, run] }));
      }
      return run;
    } catch {
      return null;
    }
  },
  updateLabRun: async (id, updates) => {
    set((s) => ({ labRuns: s.labRuns.map((r) => (r.id === id ? { ...r, ...updates } : r)) }));
    try {
      const res = await fetch(`${API_BASE}/api/lab-runs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) return;
      // 도는 중에는 서버가 과제 변경을 거절한다 — 응답으로 덮어 로컬 낙관값을 진실로 되돌린다.
      const data = await res.json() as { ok: boolean; data?: LabRun };
      const run = data.data;
      if (run) set((s) => ({ labRuns: s.labRuns.map((r) => (r.id === id ? run : r)) }));
    } catch { /* 다음 스냅샷이 진실 */ }
  },
  setLabVariants: async (id, variants) => {
    try {
      const res = await fetch(`${API_BASE}/api/lab-runs/${id}/variants`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variants }),
      });
      if (!res.ok) return;
      const data = await res.json() as { ok: boolean; data?: LabRun };
      const run = data.data;
      if (run) set((s) => ({ labRuns: s.labRuns.map((r) => (r.id === id ? run : r)) }));
    } catch { /* 다음 스냅샷이 진실 */ }
  },
  addLabVariant: async (id, label, config) => {
    try {
      const res = await fetch(`${API_BASE}/api/lab-runs/${id}/variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(label ? { label } : {}), ...(config ? { config } : {}) }),
      });
      if (!res.ok) return;
      const data = await res.json() as { ok: boolean; data?: LabRun };
      const run = data.data;
      if (run) set((s) => ({ labRuns: s.labRuns.map((r) => (r.id === id ? run : r)) }));
    } catch { /* 다음 스냅샷이 진실 */ }
  },
  removeLabVariant: async (id, variantId) => {
    try {
      const res = await fetch(`${API_BASE}/api/lab-runs/${id}/variants/${variantId}`, { method: 'DELETE' });
      if (!res.ok) return;
      const data = await res.json() as { ok: boolean; data?: LabRun };
      const run = data.data;
      if (run) set((s) => ({ labRuns: s.labRuns.map((r) => (r.id === id ? run : r)) }));
    } catch { /* 다음 스냅샷이 진실 */ }
  },
  startLabRun: async (id, variantIds) => {
    try {
      const res = await fetch(`${API_BASE}/api/lab-runs/${id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(variantIds ? { variantIds } : {}),
      });
      if (!res.ok) return false;
      const data = await res.json() as { ok: boolean; data?: LabRun };
      const run = data.data;
      if (run) set((s) => ({ labRuns: s.labRuns.map((r) => (r.id === id ? run : r)) }));
      return true;
    } catch {
      return false;
    }
  },
  promoteLabVariant: async (id, variantId, targetAgentId) => {
    try {
      const res = await fetch(`${API_BASE}/api/lab-runs/${id}/variants/${variantId}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(targetAgentId ? { targetAgentId } : {}),
      });
      if (!res.ok) return false;
      const data = await res.json() as { ok: boolean; data?: LabRun };
      const run = data.data;
      if (run) set((s) => ({ labRuns: s.labRuns.map((r) => (r.id === id ? run : r)) }));
      return true;
    } catch {
      return false;
    }
  },
  deleteLabRun: async (id) => {
    try {
      const res = await fetch(`${API_BASE}/api/lab-runs/${id}`, { method: 'DELETE' });
      if (!res.ok) return false; // 409 = 핀으로 보호됨, 404 = 이미 없음
    } catch {
      return false;
    }
    set((s) => ({
      labRuns: s.labRuns.filter((r) => r.id !== id),
      selectedLabRunId: s.selectedLabRunId === id ? null : s.selectedLabRunId,
      labPanelOpenId: s.labPanelOpenId === id ? null : s.labPanelOpenId,
    }));
    return true;
  },

  // ─── §5.21 비용·토큰 지도 ───
  costMaps: [],
  applyCostMaps: (list) => set((s) => {
    // 스냅샷은 매 브로드캐스트마다 새 배열을 싣지만 지도는 20초마다만 바뀐다. 참조를 그대로
    // 갈아 끼우면 모든 버블이 브로드캐스트마다 다시 그려지므로, 내용이 같으면 손대지 않는다.
    if (costMapFingerprint(s.costMaps) === costMapFingerprint(list)) return s;
    return { costMaps: list };
  }),

  // ─── §5.22 권한·감사 경계 ───
  auditLogs: [],
  applyAuditLogs: (list) => set((s) => {
    // 원장은 도구 호출이 있을 때만 바뀐다. 내용이 같으면 참조를 갈아 끼우지 않는다
    // (비용 지도와 같은 이유 — 브로드캐스트마다 헤더·팝업이 다시 그려지는 것을 막는다).
    if (auditLogFingerprint(s.auditLogs) === auditLogFingerprint(list)) return s;
    return { auditLogs: list };
  }),
  auditPopupOpen: false,
  setAuditPopupOpen: (open) => set({ auditPopupOpen: open }),
  setAuditBoundary: async (projectName, patch) => {
    try {
      const res = await fetch(`${API_BASE}/api/audit-boundary/${encodeURIComponent(projectName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return;
      // 서버가 broadcastSnapshot 하므로 여기서 상태를 직접 만지지 않는다(§3.1).
    } catch {
      // 서버 끊김 — 다음 스냅샷에서 실제 상태가 온다.
    }
  },

  // ─── §5.20 스크립트 선반 (Shelf) ───
  shelfBubbles: [],
  applyShelfBubbles: (list) => set((s) => {
    const keepSelected = s.selectedShelfBubbleId !== null && list.some((b) => b.id === s.selectedShelfBubbleId)
      ? s.selectedShelfBubbleId
      : null;
    // 패널이 열려 있던 선반이 사라졌으면 패널도 닫는다(빈 오버레이가 남지 않게).
    const keepOpen = s.shelfPanelOpenId !== null && list.some((b) => b.id === s.shelfPanelOpenId)
      ? s.shelfPanelOpenId
      : null;
    if (s.draggingShelfBubbleIds.length === 0) {
      return { shelfBubbles: list, selectedShelfBubbleId: keepSelected, shelfPanelOpenId: keepOpen };
    }
    // 드래그 중인 선반은 좌표만 손끝 값을 지킨다(항목·결과는 서버 값이 진실).
    const locked = new Map<string, ShelfBubble>();
    for (const id of s.draggingShelfBubbleIds) {
      const local = s.shelfBubbles.find((b) => b.id === id);
      if (local) locked.set(id, local);
    }
    if (locked.size === 0) {
      return { shelfBubbles: list, selectedShelfBubbleId: keepSelected, shelfPanelOpenId: keepOpen };
    }
    return {
      shelfBubbles: list.map((b) => {
        const local = locked.get(b.id);
        if (!local) return b;
        return { ...b, x: local.x, y: local.y, width: local.width, height: local.height };
      }),
      selectedShelfBubbleId: keepSelected,
      shelfPanelOpenId: keepOpen,
    };
  }),
  patchShelfBubbleLocal: (id, updates) => set((s) => ({
    shelfBubbles: s.shelfBubbles.map((b) => (b.id === id ? { ...b, ...updates } : b)),
  })),
  draggingShelfBubbleIds: [],
  setShelfBubbleDragLock: (id, on) => set((s) => {
    const has = s.draggingShelfBubbleIds.includes(id);
    if (on && !has) return { draggingShelfBubbleIds: [...s.draggingShelfBubbleIds, id] };
    if (!on && has) return { draggingShelfBubbleIds: s.draggingShelfBubbleIds.filter((x) => x !== id) };
    return s;
  }),
  selectedShelfBubbleId: null,
  // 다른 선택과 배타 — 캔버스의 선택은 언제나 하나여야 Delete 키가 무엇을 지울지 헷갈리지 않는다.
  selectShelfBubble: (id) => set({
    selectedShelfBubbleId: id,
    selectedNodeId: null,
    selectIntentId: id,
    selectedTaskEdgeId: null,
    selectedCommentBoxId: null,
    selectedCaptureBubbleId: null,
    selectedAppBubbleId: null,
    selectedPlayBubbleId: null,
    selectedSpecDocId: null,
    selectedLabRunId: null,
  }),
  shelfPanelOpenId: null,
  openShelfPanel: (id) => set({ shelfPanelOpenId: id }),
  closeShelfPanel: () => set({ shelfPanelOpenId: null }),
  createShelfBubble: async (input) => {
    try {
      const res = await fetch(`${API_BASE}/api/shelf-bubbles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) return null;
      const data = await res.json() as { ok: boolean; data?: ShelfBubble };
      const bubble = data.data ?? null;
      if (bubble) {
        set((s) => (s.shelfBubbles.some((b) => b.id === bubble.id) ? s : { shelfBubbles: [...s.shelfBubbles, bubble] }));
      }
      return bubble;
    } catch {
      return null;
    }
  },
  updateShelfBubble: async (id, updates) => {
    set((s) => ({ shelfBubbles: s.shelfBubbles.map((b) => (b.id === id ? { ...b, ...updates } : b)) }));
    try {
      const res = await fetch(`${API_BASE}/api/shelf-bubbles/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) return;
      const data = await res.json() as { ok: boolean; data?: ShelfBubble };
      const bubble = data.data;
      if (bubble) set((s) => ({ shelfBubbles: s.shelfBubbles.map((b) => (b.id === id ? bubble : b)) }));
    } catch { /* 다음 스냅샷이 진실 */ }
  },
  addShelfItem: async (id, draft) => {
    try {
      const res = await fetch(`${API_BASE}/api/shelf-bubbles/${id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) return;
      const data = await res.json() as { ok: boolean; data?: ShelfBubble };
      const bubble = data.data;
      if (bubble) set((s) => ({ shelfBubbles: s.shelfBubbles.map((b) => (b.id === id ? bubble : b)) }));
    } catch { /* 다음 스냅샷이 진실 */ }
  },
  updateShelfItem: async (id, itemId, updates) => {
    try {
      const res = await fetch(`${API_BASE}/api/shelf-bubbles/${id}/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) return;
      const data = await res.json() as { ok: boolean; data?: ShelfBubble };
      const bubble = data.data;
      if (bubble) set((s) => ({ shelfBubbles: s.shelfBubbles.map((b) => (b.id === id ? bubble : b)) }));
    } catch { /* 다음 스냅샷이 진실 */ }
  },
  removeShelfItem: async (id, itemId) => {
    try {
      const res = await fetch(`${API_BASE}/api/shelf-bubbles/${id}/items/${itemId}`, { method: 'DELETE' });
      if (!res.ok) return;
      const data = await res.json() as { ok: boolean; data?: ShelfBubble };
      const bubble = data.data;
      if (bubble) set((s) => ({ shelfBubbles: s.shelfBubbles.map((b) => (b.id === id ? bubble : b)) }));
    } catch { /* 다음 스냅샷이 진실 */ }
  },
  reorderShelfItems: async (id, order) => {
    try {
      const res = await fetch(`${API_BASE}/api/shelf-bubbles/${id}/items/order`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order }),
      });
      if (!res.ok) return;
      const data = await res.json() as { ok: boolean; data?: ShelfBubble };
      const bubble = data.data;
      if (bubble) set((s) => ({ shelfBubbles: s.shelfBubbles.map((b) => (b.id === id ? bubble : b)) }));
    } catch { /* 다음 스냅샷이 진실 */ }
  },
  runShelfItem: async (id, itemId) => {
    try {
      const res = await fetch(`${API_BASE}/api/shelf-bubbles/${id}/items/${itemId}/run`, { method: 'POST' });
      if (!res.ok) return false;
      const data = await res.json() as { ok: boolean; data?: ShelfBubble };
      const bubble = data.data;
      if (bubble) set((s) => ({ shelfBubbles: s.shelfBubbles.map((b) => (b.id === id ? bubble : b)) }));
      return true;
    } catch {
      return false;
    }
  },
  importShelfItems: async (id, payload, replace) => {
    try {
      const res = await fetch(`${API_BASE}/api/shelf-bubbles/${id}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload, replace }),
      });
      if (!res.ok) return null;
      const data = await res.json() as { ok: boolean; data?: ShelfBubble; added?: number; dropped?: number };
      const bubble = data.data;
      if (bubble) set((s) => ({ shelfBubbles: s.shelfBubbles.map((b) => (b.id === id ? bubble : b)) }));
      return { added: data.added ?? 0, dropped: data.dropped ?? 0 };
    } catch {
      return null;
    }
  },
  deleteShelfBubble: async (id) => {
    try {
      const res = await fetch(`${API_BASE}/api/shelf-bubbles/${id}`, { method: 'DELETE' });
      if (!res.ok) return false; // 409 = 핀으로 보호됨, 404 = 이미 없음
    } catch {
      return false;
    }
    set((s) => ({
      shelfBubbles: s.shelfBubbles.filter((b) => b.id !== id),
      selectedShelfBubbleId: s.selectedShelfBubbleId === id ? null : s.selectedShelfBubbleId,
      shelfPanelOpenId: s.shelfPanelOpenId === id ? null : s.shelfPanelOpenId,
    }));
    return true;
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
  selectedCaptureBubbleId: null,
  captureBubbles: [],
  debugBreakpoints: {},
  appBubbles: [],
  selectedAppBubbleId: null,
  contis: {},
  activeContiWork: {},
  // §5.10 Project Brain
  brain: {},
  brainInjections: {},
  pluginFacts: {},
  interiorView: null,
  brainFeed: null,
  guideCategory: null,
  selectedBrainCardId: null,
  selectedBrainCard: null,
  recentToolDurations: {},
  compactCounts: {},
  skillUsageCounts: {},
  autoAgentSummaries: {},
  autoAgentRuns: {},
  runningSubagentTasks: {},
  finishedSubagentTasks: {},
  agentReports: {},
  agentMemos: {},
  agentQuestions: {},
  agentReviews: {},
  reviewRequests: [],
  agentLists: {},
  agentFeedbacks: {},
  sessionLoops: {},
  verificationRuns: {},
  verificationDemos: {},
  sessionGoals: {},
  modelRegistry: null,
  localLlm: null,
  userDefaults: null,
  rateLimits: null,
  claudeUsage: null,
  claudeAuth: null,
  diagnosticLog: [],
  contiBoardOpen: null,
  imageLightbox: null,
  workspaceImageSavedAt: {},
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
      scheduleSaveSessionInputDrafts(agentSessionInputs); // v2.x — 키 입력은 in-memory 즉시, 영속화는 debounce
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
      scheduleSaveSessionInputDrafts(next); // v2.x — 같은 스케줄러로 last-write-wins(되살아남 방지)
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
      scheduleSaveSessionInputDrafts(next);
    }
    return removed;
  },
  openContiBoard: (agentId, contiId) => set({ contiBoardOpen: { agentId, contiId } }),
  closeContiBoard: () => set({ contiBoardOpen: null }),
  openImageLightbox: (url, attachment, workspace) =>
    set({
      imageLightbox: {
        url,
        ...(attachment ? { attachment } : {}),
        ...(workspace ? { workspace } : {}),
      },
    }),
  closeImageLightbox: () => set({ imageLightbox: null }),
  markWorkspaceImageSaved: (relPath) =>
    set((s) => ({ workspaceImageSavedAt: { ...s.workspaceImageSavedAt, [relPath]: Date.now() } })),
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
  contiScriptGenerating: {},
  generateContiFromScript: async (agentId, script, presetId, frameCount) => {
    set((s) => ({ contiScriptGenerating: { ...s.contiScriptGenerating, [agentId]: true } }));
    try {
      const r = await fetch(`${API_BASE}/api/conti/from-script`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, script, presetId, ...(frameCount ? { frameCount } : {}) }),
      });
      const body = (await r.json()) as { ok?: boolean; error?: string; conti?: { id: string } };
      if (!r.ok || !body.ok || !body.conti) {
        return { ok: false as const, error: body.error ?? `실패 (${r.status})` };
      }
      return { ok: true as const, contiId: body.conti.id };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    } finally {
      set((s) => {
        const next = { ...s.contiScriptGenerating };
        delete next[agentId];
        return { contiScriptGenerating: next };
      });
    }
  },
  setContiPreset: async (contiId, presetId) => {
    // 낙관적 로컬 반영 — 셀렉터가 즉시 바뀌고 다음 snapshot 으로 reconcile.
    set((s) => {
      const c = s.contis[contiId];
      if (!c) return s;
      return { contis: { ...s.contis, [contiId]: { ...c, presetId } } };
    });
    try {
      await fetch(`${API_BASE}/api/conti/${encodeURIComponent(contiId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetId }),
      });
    } catch { /* snapshot 으로 자연 reconcile */ }
  },
  linkContiRender: async (contiId, link) => {
    try {
      await fetch(`${API_BASE}/api/conti/${encodeURIComponent(contiId)}/render-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(link),
      });
    } catch { /* 표시용 기록이라 실패해도 렌더 자체는 이미 걸렸다 */ }
  },
  agentPhase: 'waiting',
  activeAgentCount: 0,
  pendingFocus: false,
  focusNodeId: null,

  loadSnapshot: (projects, agents, topFolders, children, edges, innerEdges, satellites, bashHistory, runningServers, agentEvents, agentProjects, nodeProjects, fileEdits, commandQueues, completedCommands, subAgents, agentPhase, activeAgentCount, satellitePositions, pipelineChildren, pipelines, agentConfigs, taskEdges, worktreeProjects, gitDirty, commentBoxes, captureBubbles, contis, activeContiWork, brain, brainInjections) => {
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

    // 서브에이전트 ack 상태 diff — 규칙은 `stores/subAckDiff.ts` 가 단독 소유한다(순수 함수 + 테스트).
    //   ① active → idle 전이 = 새 완료 → ack 해제(다시 녹색).
    //   ② **실제로 닫힌** 세션만 집합에서 정리 — 스코프드 스냅샷(§9)에서 배경 프로젝트가 통째로
    //      빠지는 침묵을 "닫혔다"로 읽으면 확인해 둔 세션이 저절로 녹색으로 되돌아간다.
    set((state) => {
      const nextAckResult = diffSubAcknowledgements({
        prevSubAgents: state.subAgents,
        nextSubAgents: subAgents,
        presentAgentIds: agents.map((a) => a.id),
        acknowledged: state.acknowledgedSubAgents,
      });
      const ackChanged = nextAckResult !== null;
      const nextAck = nextAckResult ?? state.acknowledgedSubAgents;
      // ack 변동(완료 재발생으로 해제 / 닫힌 sub 정리)을 localStorage 에 반영 — 재시작 후 색 유지.
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

      // §5.9 — 캡처 버블 드래그/리사이즈 중 geometry 보호 (CommentBox 와 동일).
      let mergedCaptureBubbles = captureBubbles;
      if (state.draggingCaptureBubbleIds.length > 0) {
        const lockedById = new Map<string, CaptureBubble>();
        for (const id of state.draggingCaptureBubbleIds) {
          const local = state.captureBubbles.find((b) => b.id === id);
          if (local) lockedById.set(id, local);
        }
        if (lockedById.size > 0) {
          mergedCaptureBubbles = captureBubbles.map((b) => {
            const local = lockedById.get(b.id);
            if (!local) return b;
            return { ...b, x: local.x, y: local.y, width: local.width, height: local.height };
          });
        }
      }

      // §4 v3.72 — 구조적 공유. 서버는 **전체 그래프**를 매 스냅샷 실어 보내므로 내용이 그대로여도
      //   참조는 항상 새것이었다 → 400+ 스토어 구독이 전부 깨어나 앱 전체가 스냅샷 주기(16ms 코얼레스)
      //   로 리렌더됐고, IDE 는 그때마다 세션 전체를 재구축했다. 같은 메인스레드를 쓰는 타이핑이
      //   밀린 근본 원인. 값이 같은 가지는 이전 참조를 그대로 돌려 구독자를 조용히 있게 한다.
      //   ⚠ 아래는 전부 서버 권위 순수 데이터여야 한다(자세한 조건은 structuralShare.ts 주석).
      const share = <T,>(prevValue: unknown, nextValue: T): T => structuralShare(prevValue, nextValue);

      return {
        projects: share(state.projects, projects),
        agents: share(state.agents, agents),
        topFolders: share(state.topFolders, topFolders),
        children: share(state.children, children),
        edges: share(state.edges, edges),
        innerEdges: share(state.innerEdges, innerEdges),
        satellites: share(state.satellites, satellites),
        satellitePositions: share(state.satellitePositions, satellitePositions),
        nodeMap: share(state.nodeMap, nodeMap),
        bashHistory: share(state.bashHistory, bashHistory),
        runningServers: share(state.runningServers, runningServers),
        agentProjects: share(state.agentProjects, agentProjects),
        nodeProjects: share(state.nodeProjects, nodeProjects),
        fileEdits: share(state.fileEdits, fileEdits),
        activeProject: resolvedProject,
        currentProject: resolvedProject ? (projects[resolvedProject] ?? null) : null,
        agentEvents: share(state.agentEvents, agentEvents),
        queuedCommands: share(state.queuedCommands, commandQueues),
        completedCommands: share(state.completedCommands, completedCommands),
        subAgents: share(state.subAgents, subAgents),
        ...(ackChanged ? { acknowledgedSubAgents: nextAck } : {}),
        fileSizeRange: share(state.fileSizeRange, fileSizeRange),
        agentPhase: share(state.agentPhase, agentPhase),
        activeAgentCount,
        pipelineChildren: share(state.pipelineChildren, pipelineChildren),
        pipelines: share(state.pipelines, pipelines),
        agentConfigs: share(state.agentConfigs, agentConfigs),
        taskEdges: share(state.taskEdges, taskEdges),
        worktreeProjects: share(state.worktreeProjects, worktreeProjects),
        gitDirty: share(state.gitDirty, gitDirty),
        attachmentPreviews: nextPreviews,
        commentBoxes: share(state.commentBoxes, mergedCommentBoxes),
        captureBubbles: share(state.captureBubbles, mergedCaptureBubbles),
        contis: share(state.contis, contis),
        activeContiWork: share(state.activeContiWork, activeContiWork),
        // §5.10 — brain 요약/주입 신호는 서버 권위(런타임, localStorage 미영속)라 매 스냅샷 교체.
        //   cleanup-trap 대상 아님(부팅 hydrate 로 복원할 클라 상태가 아니다).
        //   v3.70 — 프로젝트 키 맵이라 서버가 매번 전체를 싣는다. 빈 맵도 정상값(카드 전부 삭제)이므로
        //   그대로 교체해야 지운 카드가 숫자에 남지 않는다.
        //   v3.72 — 구조적 공유를 적용해도 이 규칙은 지켜진다: 빈 맵은 키 개수가 달라 "다름" 으로
        //   판정돼 그대로 교체된다(structuralShare.test 의 "빈 맵으로 교체" 케이스).
        brain: share(state.brain, brain),
        brainInjections: share(state.brainInjections, brainInjections),
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

  // §5.10 v3.73 — "메인 캔버스로" 는 내부 뷰(휴지통)에서도 빠져나오는 뜻이다.
  //   interiorView 를 안 지우면 홈으로 갔는데 휴지통 안이 그대로 그려진다.
  goToMain: () => set({ currentFolderId: null, navStack: [], interiorView: null, selectedNodeId: null, selectIntentId: null }),

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
      // §5.10 — 프로젝트 전환 시 내부(휴지통) 뷰·기억 피드·선택 카드는 리셋(전역 전이 상태, 영속 X).
      interiorView: null,
      brainFeed: null,
      selectedBrainCardId: null,
      selectedBrainCard: null,
    }));
  },
  closeProject: async (projectId, name) => {
    // 표시명(로컬 활성탭 전환용) — 생략 시 projectId 로 역추론.
    const s0 = get();
    const pk = npStore(projectId);
    const displayName = name
      ?? Object.keys(s0.projects).find((k) => npStore(s0.projects[k]!.path) === pk)
      ?? Object.keys(s0.stubProjects).find((k) => npStore(s0.stubProjects[k]!.project.path) === pk)
      ?? projectId;

    // §5.4 #14 v1.34 — **× 를 누른 즉시 탭이 사라진다.** 종전엔 DELETE 응답 + 스냅샷 배치 창
    //   (§9 부하 적응형, 최대 250ms)을 기다린 뒤에야 목록이 갱신돼 "눌렀는데 그대로"로 보였다.
    //   닫는 중 표시를 먼저 세워 탭바에서 빼고, 활성 탭이었다면 옆 탭으로 그 자리에서 옮긴다.
    set((state) => {
      const closing: Record<string, number> = { ...state.closingProjectPaths, [pk]: Date.now() };
      if (state.activeProject !== displayName) return { closingProjectPaths: closing };
      // 다음 활성 탭 — 닫는 중인 것들은 후보에서 뺀다(연속으로 닫아도 사라진 탭으로 넘어가지 않게).
      const alive = (p: string, path: string | undefined): boolean =>
        p !== displayName && !!path && !closing[npStore(path)];
      const nextHydrated = Object.keys(state.projects).find((p) => alive(p, state.projects[p]?.path)) ?? null;
      const nextStub = Object.keys(state.stubProjects).find((p) => alive(p, state.stubProjects[p]?.project.path)) ?? null;
      const next = nextHydrated ?? nextStub;
      saveActiveProject(next);
      return {
        closingProjectPaths: closing,
        activeProject: next,
        currentProject: next ? (state.projects[next] ?? null) : null,
        currentFolderId: null,
        navStack: [],
        selectedNodeId: null,
        selectIntentId: null,
      };
    });

    // 닫는 중 표시 해제 — 서버가 닫기를 받아주지 않았을 때 탭을 되돌리는 유일한 경로.
    const unmark = (): void => set((state) => {
      if (!state.closingProjectPaths[pk]) return {};
      const next = { ...state.closingProjectPaths };
      delete next[pk];
      return { closingProjectPaths: next };
    });

    try {
      // v1.63: 식별 = projectId(경로). 서버 resolveProjectRef 가 path 를 해소.
      const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
      // 404 = 서버가 이미 모르는 프로젝트 = 닫힌 것이므로 표시를 걷지 않는다(같은 탭을 두 번
      // 닫는 요청이 겹쳐도 탭이 도로 나타나지 않게). 그 밖의 실패만 되돌린다.
      if (!res.ok) { if (res.status !== 404) unmark(); return; }
      // unload-project WS 발송 — 서버가 인메모리 그래프 해제 + broadcast.
      // projectName 에 projectId(경로) 전달 — 서버 unloadProject 가 ref 해소.
      const wsSend = get()._wsSend;
      if (wsSend) {
        wsSend({ type: 'unload-project', timestamp: Date.now(), payload: { projectName: projectId } });
      }
    } catch {
      // 요청 자체가 못 나갔으면 서버는 아무것도 모른다 — 감춘 탭을 되돌린다.
      unmark();
    }
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
  // ⚠ 이 액션은 `loadSnapshot`(= 서버가 준 hydrated `projects`) **다음에** 불린다(useWebSocket).
  //   닫는 중 표시를 그 두 목록의 합집합으로 정리하는 자리가 여기인 이유다 — stub 만 보고 판정하면
  //   hydrated 로 살아 있는 프로젝트를 "사라졌다"로 읽는다.
  applyStubProjects: (stubs) => set((state) => {
    const closing = pruneClosingProjects(state.closingProjectPaths, [
      ...Object.values(state.projects).map((p) => p.path),
      ...Object.values(stubs).map((m) => m.project.path),
    ]);
    return closing === state.closingProjectPaths
      ? { stubProjects: stubs }
      : { stubProjects: stubs, closingProjectPaths: closing };
  }),
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
  selectNode: (id) => set({ selectedNodeId: id, selectIntentId: id, selectedTaskEdgeId: null, selectedCommentBoxId: null, selectedCaptureBubbleId: null, selectedAppBubbleId: null, selectedPlayBubbleId: null, selectedSpecDocId: null, selectedLabRunId: null, selectedShelfBubbleId: null, selectedBrainCardId: null, selectedBrainCard: null }),
  setSelectIntent: (id) => set({ selectIntentId: id }),
  // 작업 엣지는 버블이 아니라 선(線)이라 선택 링을 쓰지 않는다 — 고른 순간 버블 쪽 링은 내려간다.
  selectTaskEdge: (id) => set({ selectedTaskEdgeId: id, selectedNodeId: null, selectIntentId: null, selectedCommentBoxId: null, selectedCaptureBubbleId: null, selectedAppBubbleId: null, selectedPlayBubbleId: null, selectedSpecDocId: null, selectedLabRunId: null, selectedShelfBubbleId: null }),
  // ⚠ 아래 store 채널 선택들은 `selectIntentId` 를 **자기 id 로 채운다**(종전에는 null 이었다).
  //   `selectIntentId` 는 캔버스 전체가 나눠 쓰는 "지금 고른 것 한 칸"이고, 그 한 칸이 곧 선택 링이다.
  //   비워 두면 더블클릭 지연(`bubbleSelectGesture`) 동안 링이 안 뜨고, 지연이 끝난 뒤에도 이 버블의
  //   링만 다른 규칙(자기 `selectedXxxId`)으로 켜져 에이전트 버블과 손버릇이 갈린다.
  selectCommentBox: (id) => set({ selectedCommentBoxId: id, selectedNodeId: null, selectIntentId: id, selectedTaskEdgeId: null, selectedCaptureBubbleId: null, selectedAppBubbleId: null, selectedPlayBubbleId: null, selectedSpecDocId: null, selectedLabRunId: null, selectedShelfBubbleId: null }),
  selectCaptureBubble: (id) => set({ selectedCaptureBubbleId: id, selectedNodeId: null, selectIntentId: id, selectedTaskEdgeId: null, selectedCommentBoxId: null, selectedAppBubbleId: null, selectedPlayBubbleId: null, selectedSpecDocId: null, selectedLabRunId: null, selectedShelfBubbleId: null }),
  // §5.13 (M) v4.61 — 앱 버블 선택. 다른 선택(노드·엣지·코멘트·캡처)과 배타 — 캔버스에서
  //   선택은 언제나 하나이고, 그래야 Delete 키가 무엇을 지울지 헷갈리지 않는다.
  selectAppBubble: (id) => set({ selectedAppBubbleId: id, selectedNodeId: null, selectIntentId: id, selectedTaskEdgeId: null, selectedCommentBoxId: null, selectedCaptureBubbleId: null, selectedPlayBubbleId: null, selectedSpecDocId: null, selectedLabRunId: null, selectedShelfBubbleId: null }),
  // 선택 채널 조정용 — store 채널만 비운다(`selectedNodeId` 는 그대로 둔다). 위 selectXxx 들과
  //   달리 "무엇을 골랐다"가 아니라 "반대편 채널을 내린다"는 뜻이라, 네이티브 버블이 들고 있는
  //   `selectIntentId` 는 건드리지 않는다. 다만 **지금 내리는 store 채널 자신이 그 한 칸을 들고
  //   있었다면** 함께 비운다 — 안 그러면 선택이 사라진 버블에 링만 남는다(박스 드래그 선택 때 실제로).
  clearElementSelection: () => set((s) => ({
    selectIntentId: isStoreChannelSelection(s, s.selectIntentId) ? null : s.selectIntentId,
    selectedTaskEdgeId: null,
    selectedCommentBoxId: null,
    selectedCaptureBubbleId: null,
    selectedAppBubbleId: null,
    selectedPlayBubbleId: null,
    selectedSpecDocId: null,
    selectedLabRunId: null,
    selectedShelfBubbleId: null,
  })),
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
  overlayAgentIds: [],
  overlaysVisible: true,
  applyOverlayList: (payload) =>
    set(() => ({
      overlayAgentIds: payload.overlays.map((o) => o.agentId),
      overlaysVisible: payload.userVisible,
    })),
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
  ideTextZoom: clampIdeTextZoom(loadJSON<number>(IDE_TEXT_ZOOM_KEY, DEFAULT_IDE_TEXT_ZOOM)),
  setIdeTextZoom: (z) => set((state) => {
    const next = clampIdeTextZoom(z);
    if (state.ideTextZoom === next) return state;
    saveJSON(IDE_TEXT_ZOOM_KEY, next);
    return { ideTextZoom: next };
  }),
  ideStreamDensity: normalizeStreamDensity(loadJSON<string>(IDE_STREAM_DENSITY_KEY, DEFAULT_IDE_STREAM_DENSITY)),
  setIdeStreamDensity: (d) => set((state) => {
    if (state.ideStreamDensity === d) return state;
    saveJSON(IDE_STREAM_DENSITY_KEY, d);
    return { ideStreamDensity: d };
  }),
  ideReading: normalizeReadingSettings(loadJSON<unknown>(IDE_READING_KEY, null)),
  setIdeReading: (patch) => set((state) => {
    const next = normalizeReadingSettings({ ...state.ideReading, ...patch });
    // 정규화 후 값이 같으면(범위 밖 입력이 같은 값으로 잘린 경우 등) 리렌더를 만들지 않는다.
    const same = (Object.keys(next) as (keyof ReadingSettings)[]).every((k) => next[k] === state.ideReading[k]);
    if (same) return state;
    saveJSON(IDE_READING_KEY, next);
    return { ideReading: next };
  }),
  resetIdeReading: () => set(() => {
    const next = { ...DEFAULT_READING_SETTINGS };
    saveJSON(IDE_READING_KEY, next);
    return { ideReading: next };
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
    if (!requireProjectFolder(get)) return;
    const project = selectEffectiveProject(get());
    void postCreate('/api/create-custom-agent', { label: '', x: canvasX, y: canvasY, project }, get);
  },
  // ─── §5.10 Project Brain 액션 ───
  enterInterior: (view) => {
    // v3.49 — 휴지통 전용(기억은 brainFeed 오버레이). 카드 fetch 없음.
    set({ interiorView: view, brainFeed: null, selectedNodeId: null, selectIntentId: null, selectedBrainCardId: null, selectedBrainCard: null });
  },
  exitInterior: () => set({ interiorView: null, selectedBrainCardId: null, selectedBrainCard: null, selectedNodeId: null, selectIntentId: null }),
  openBrainFeed: (view) => {
    // v3.49 — 기억 피드 오버레이. 내부(휴지통) 뷰·다른 선택과 배타.
    set({ brainFeed: view, interiorView: null, selectedBrainCardId: null, selectedBrainCard: null, selectedNodeId: null, selectIntentId: null });
  },
  closeBrainFeed: () => set({ brainFeed: null, selectedBrainCardId: null, selectedBrainCard: null }),
  openGuide: (category) => set({ guideCategory: category ?? 'start' }),
  closeGuide: () => set({ guideCategory: null }),
  selectBrainCard: (id, opts) => {
    if (!id) { set({ selectedBrainCardId: null, selectedBrainCard: null }); return; }
    // 노드/코멘트박스/캡처/태스크엣지 선택과 배타.
    set({ selectedBrainCardId: id, selectedNodeId: null, selectIntentId: null, selectedTaskEdgeId: null, selectedCommentBoxId: null, selectedCaptureBubbleId: null });
    // v3.49 — 카드 본문은 REST 로 조회(memory 버블 interiorCards 캐시 폐기).
    set({ selectedBrainCard: null });
    const project = selectEffectiveProject(get());
    if (!project) return;
    void (async () => {
      try {
        // project 층 + (agentId 있으면) 그 에이전트 층을 합쳐 id 로 찾는다.
        const found: BrainCard[] = [];
        const scopes: Array<{ scope: string; agentId?: string }> = [{ scope: 'project' }];
        if (opts?.agentId) scopes.push({ scope: 'agent', agentId: opts.agentId });
        for (const s of scopes) {
          const p = new URLSearchParams({ scope: s.scope, project });
          if (s.agentId) p.set('agentId', s.agentId);
          const res = await fetch(`${API_BASE}/api/brain/cards?${p.toString()}`);
          if (!res.ok) continue;
          const data = await res.json() as { cards?: BrainCard[] };
          for (const c of data.cards ?? []) found.push(c);
        }
        const card = found.find((c) => c.id === id);
        if (card && get().selectedBrainCardId === id) set({ selectedBrainCard: card });
        // 확인(seen) 신고.
        if (card && card.seen === false) void fetch(`${API_BASE}/api/brain/cards/${id}/seen`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project }),
        }).catch(() => {});
      } catch { /* noop */ }
    })();
  },
  promoteBrainCard: async (id) => {
    const project = selectEffectiveProject(get());
    try {
      await fetch(`${API_BASE}/api/brain/cards/${id}/promote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project }),
      });
    } catch { /* noop */ }
    // v3.49 — 승격 후 선택 해제(피드 오버레이가 selectedBrainCardId→null 을 감지해 자체 재조회).
    get().selectBrainCard(null);
  },
  setBrainCardPinned: async (id, pinned) => {
    const project = selectEffectiveProject(get());
    try {
      await fetch(`${API_BASE}/api/brain/cards/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned, project }),
      });
    } catch { /* noop */ }
    set((s) => ({
      selectedBrainCard: s.selectedBrainCard?.id === id ? { ...s.selectedBrainCard, pinned } : s.selectedBrainCard,
    }));
  },
  updateBrainCard: async (id, patch) => {
    const project = selectEffectiveProject(get());
    try {
      await fetch(`${API_BASE}/api/brain/cards/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...patch, project }),
      });
    } catch { /* noop */ }
    set((s) => ({
      selectedBrainCard: s.selectedBrainCard?.id === id ? { ...s.selectedBrainCard, ...patch } : s.selectedBrainCard,
    }));
  },
  deleteBrainCard: async (id) => {
    const project = selectEffectiveProject(get());
    const q = project ? `?project=${encodeURIComponent(project)}` : '';
    try {
      await fetch(`${API_BASE}/api/brain/cards/${id}${q}`, { method: 'DELETE' });
    } catch { /* noop */ }
    get().selectBrainCard(null);
  },
  markBrainCardSeen: (id) => {
    const project = selectEffectiveProject(get());
    void fetch(`${API_BASE}/api/brain/cards/${id}/seen`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project }),
    }).catch(() => {});
  },
  // §5.10 v3.78 — 재검증 1비트(사용자 채널). 셋 다 서버가 SSOT — 클라는 신고만 하고 재조회에 맡긴다.
  verifyBrainCard: async (id) => {
    const project = selectEffectiveProject(get());
    try {
      await fetch(`${API_BASE}/api/brain/cards/${id}/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project }),
      });
    } catch { /* noop */ }
  },
  markBrainCardStale: async (id) => {
    const project = selectEffectiveProject(get());
    try {
      await fetch(`${API_BASE}/api/brain/cards/${id}/stale`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project }),
      });
    } catch { /* noop */ }
  },
  restoreBrainCard: async (id) => {
    const project = selectEffectiveProject(get());
    try {
      await fetch(`${API_BASE}/api/brain/cards/${id}/restore`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project }),
      });
    } catch { /* noop */ }
  },
  // §5.10 v3.81 — 사용자 명시 승인/거부. 후보를 현재 진실로 올리는 **유일한 수동 경로**이며,
  //   같은 슬롯의 옛 진실은 서버가 닫는다(클라는 상태를 계산하지 않는다 — §3.1).
  confirmBrainCard: async (id) => {
    const project = selectEffectiveProject(get());
    try {
      await fetch(`${API_BASE}/api/brain/cards/${id}/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project }),
      });
    } catch { /* noop */ }
  },
  rejectBrainCard: async (id) => {
    const project = selectEffectiveProject(get());
    try {
      await fetch(`${API_BASE}/api/brain/cards/${id}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project }),
      });
    } catch { /* noop */ }
  },
  saveBrainCardFromText: async (text, agentId, sourceSessionId) => {
    const project = selectEffectiveProject(get());
    const trimmed = text.trim();
    if (!trimmed) return;
    const title = trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
    try {
      await fetch(`${API_BASE}/api/brain/cards`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'fact', scope: 'agent', agentId, title, body: trimmed, files: [],
          sourceSessionId: sourceSessionId ?? undefined, project,
        }),
      });
    } catch { /* noop */ }
  },
  // §5.10 — 인자는 세션 키(`custom-…`)·버블 id(`agent-…`) 둘 다 허용(서버가 해소). 실패(404 등)면
  //   선택을 유지해 패널이 닫히지 않게 한다 — "눌렀는데 아무 일도 없다"를 조용히 성공처럼 보이지 않도록.
  restoreTrashedAgent: async (sessionId) => {
    try {
      const res = await fetch(`${API_BASE}/api/trash/restore`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) { console.warn('[trash] restore failed', res.status, sessionId); return; }
    } catch { return; }
    set({ selectedNodeId: null, selectIntentId: null });
  },
  purgeTrashedAgent: async (sessionId) => {
    try {
      const res = await fetch(`${API_BASE}/api/trash/agent/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      if (!res.ok) { console.warn('[trash] purge failed', res.status, sessionId); return; }
    } catch { return; }
    set({ selectedNodeId: null, selectIntentId: null });
  },
  // §5.10 v4.84 — [모두 삭제] / Delete 키(단일·다중) 공용. 개별 DELETE 를 N 번 쏘면 스냅샷이 N 번
  //   와서 버블이 여러 번 나눠 사라지므로 서버 배치 경로로 한 번에 보낸다.
  purgeTrashedAgents: async (sessionIds) => {
    const ids = sessionIds.filter(Boolean);
    if (ids.length === 0) return;
    try {
      const res = await fetch(`${API_BASE}/api/trash/purge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds: ids }),
      });
      if (!res.ok) { console.warn('[trash] batch purge failed', res.status, ids.length); return; }
    } catch { return; }
    set({ selectedNodeId: null, selectIntentId: null });
  },
  trashPurgeTarget: null,
  localModelWindow: null,
  requestTrashPurge: (ids) => {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return;
    set({ trashPurgeTarget: { ids: unique } });
  },
  closeTrashPurge: () => set({ trashPurgeTarget: null }),
  openLocalModelWindow: (agentId) => set({ localModelWindow: { agentId } }),
  closeLocalModelWindow: () => set({ localModelWindow: null }),
  // §4 v2.63 — CMD(인터랙티브 터미널) 에이전트. 동일 엔드포인트에 executionMode 플래그만 추가.
  // §5.19 (B) — All Model. CMD 와 같은 엔드포인트에 provider 만 실어 보낸다(새 REST 발명 ❌).
  //   모델은 아직 없다 — 빈 modelId 가 "아직 준비 중인 버블"이라는 정상 상태다.
  createLocalAgent: (canvasX, canvasY) => {
    if (!requireProjectFolder(get)) return;
    const project = selectEffectiveProject(get());
    void postCreate('/api/create-custom-agent', {
      label: '',
      x: canvasX,
      y: canvasY,
      project,
      provider: { kind: 'local-llama', modelId: '' },
    }, get);
  },
  // §5.19 (B) — 모델 매기. 기존 `PUT /api/agent-config` 를 그대로 탄다(새 REST ❌).
  //   ⚠ 이 PUT 은 body 로 config **전량을 재구축**한다 — 한 필드만 보내면 tools 가 [] 로 날아간다.
  //   그래서 지금 설정을 통째로 스프레드한 위에 provider 만 얹는다.
  setLocalContextSize: (agentId, contextSize) => {
    const prev = get().agentConfigs[agentId];
    if (!prev?.provider) return;
    const provider = { ...prev.provider, contextSize };
    // 설정 저장은 **설정 전체**를 실어 보낸다 — 한 필드만 보내면 서버가 body 로 config 를
    //   통째로 다시 세우면서 tools 같은 다른 칸이 빈 값으로 덮인다.
    fetch(`${API_BASE}/api/agent-config/${encodeURIComponent(agentId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...prev, provider }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        set((s) => ({
          agentConfigs: { ...s.agentConfigs, [agentId]: { ...(s.agentConfigs[agentId] ?? prev), provider } },
        }));
      })
      .catch(() => undefined);
  },
  bindLocalModel: (agentId, modelId, modelName) => {
    const prev = get().agentConfigs[agentId];
    if (!prev) return;
    const provider = { ...(prev.provider ?? {}), kind: 'local-llama' as const, modelId, modelName };
    fetch(`${API_BASE}/api/agent-config/${encodeURIComponent(agentId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...prev, provider }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        // 낙관 반영 — 서버 스냅샷을 기다리면 아래 openIDEOverlay 의 진입 판정이 아직 옛 설정을
        // 보고 다시 'bind' 로 떨어져 같은 자리를 맴돈다(서버가 곧 같은 값을 덮어쓴다).
        set((s) => ({
          agentConfigs: { ...s.agentConfigs, [agentId]: { ...(s.agentConfigs[agentId] ?? prev), provider } },
        }));
        set({ localModelWindow: null });
        get().openIDEOverlay(agentId);
      })
      // 매지 못했으면 **아무 일도 안 일어난 것처럼 두지 않는다** — 버블을 눌렀는데 조용한 화면이
      // 남으면 사용자는 기능이 죽은 줄 안다. 설치 창을 열어 지금 상태를 그대로 보여 준다.
      .catch(() => set({ localModelWindow: { agentId } }));
  },
  createCmdAgent: (canvasX, canvasY) => {
    if (!requireProjectFolder(get)) return;
    const project = selectEffectiveProject(get());
    void postCreate('/api/create-custom-agent', { label: '', x: canvasX, y: canvasY, project, executionMode: 'interactive-terminal' }, get);
  },
  // §5.3 #10-2 v2.37 — Auto Agent
  createAutoAgent: (canvasX, canvasY) => {
    if (!requireProjectFolder(get)) return;
    const project = selectEffectiveProject(get());
    void postCreate('/api/create-auto-agent', { label: '', x: canvasX, y: canvasY, project }, get);
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
    if (!requireProjectFolder(get)) return;
    const project = selectEffectiveProject(get());
    void postCreate('/api/create-pipeline', { type, label: '', x: canvasX, y: canvasY, project }, get);
  },
  createWorktree: (canvasX, canvasY) => {
    // 워크트리는 **부모 프로젝트의 사본**이라, 부모가 없으면 만들 것 자체가 없다(§4 온보딩 ③).
    if (!requireProjectFolder(get)) return;
    const project = selectEffectiveProject(get());
    // §5.7 #26 — **생성 연출 없음.** 예전에는 요청과 동시에 `Creating...` 물결 버블(스탠드인)을 그
    //   자리에 세워 두고 실물이 오면 바꿔치웠는데, 스탠드인과 실물이 같은 좌표를 두고 잠시
    //   공존하는 구간이 구조적으로 남아 새 버블이 옆으로 튀어 보였다. 이제 만드는 동안 캔버스는
    //   그대로 있고, 다 만들어진 워크트리 버블이 우클릭한 그 자리에 그냥 나타난다 —
    //   좌표는 서버가 실어 준다(`createWorktreeUnder` → `updateBubblePosition`).
    void postCreate('/api/create-worktree', { x: canvasX, y: canvasY, project }, get)
      // 폴더가 없어 막힌 것(409)은 게이트가 이미 설명하고 있다 — 그 위에 붉은 실패 표식까지
      // 겹치면 "무언가 고장났다"로 읽힌다. 그때는 표식을 내지 않는다.
      .then((res) => {
        if (!res || res.ok || res.status === 409) return;
        get().reportWorktreeCreateFailure(canvasX, canvasY);
      })
      .catch(() => { get().reportWorktreeCreateFailure(canvasX, canvasY); });
  },
  failedWorktrees: [],
  reportWorktreeCreateFailure: (canvasX, canvasY) => {
    // 성공 경로엔 아무것도 안 뜨지만 **실패는 반드시 보여야 한다** — 아무 반응이 없으면 사용자는
    // 만들어졌는지 아닌지 알 길이 없다. 그 자리에 붉은 표식 하나가 2.2초 떴다 사라진다.
    const id = `failed-wt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const marker: BubbleData = {
      id,
      label: 'Failed',
      bubbleType: 'worktree',
      path: id,
      status: 'idle',
      activity: 0,
      childCount: 0,
      position: { x: canvasX, y: canvasY },
      creatingStatus: 'error',
    };
    set((s) => ({ failedWorktrees: [...s.failedWorktrees, marker] }));
    setTimeout(() => {
      set((s) => ({ failedWorktrees: s.failedWorktrees.filter((p) => p.id !== id) }));
    }, 2200);
  },
  worktreeDeleteTarget: null,
  requestWorktreeDelete: (nodeId, label) => set({ worktreeDeleteTarget: { nodeId, label } }),
  closeWorktreeDelete: () => set({ worktreeDeleteTarget: null }),
  subAgentStreams: {},
  streamLastActivity: {},
  deepRestoredSessions: {},
  appendStreamEvent: (event) => set((s) => {
    const prev = s.subAgentStreams[event.subAgentId];
    // §5.3 #12-1 — 턴 세대 도장으로 **제 턴 자리**에 넣는다. 앞 턴이 띄운 백단 작업이 뒤늦게
    //   뱉는 줄이 새 명령 블록 아래로 들어가던 것을 여기서 막는다(평소 흐름은 그냥 꼬리 추가).
    const merged = prev ? insertEventInTurnOrder([...prev], event).buffer : [event];
    // 성능: 보고 있는(활성) 세션은 큰 상한, 안 보는 세션은 작은 상한으로 차등 절단.
    // 활성 세션은 slack 여유를 둬 상한 도달 후에도 대부분 순수 append 를 유지(증분 파서 유효).
    const active = computeActiveSessionIds(s.ideOverlays, s.subAgents);
    const isActive = active.has(event.subAgentId);
    const cap = isActive ? STREAM_EVENTS_MAX_PER_SESSION : STREAM_EVENTS_MAX_PER_INACTIVE_SESSION;
    const slack = isActive ? STREAM_EVENTS_TRIM_SLACK : 0;
    const next = merged.length > cap + slack ? merged.slice(merged.length - cap) : merged;
    const streams = { ...s.subAgentStreams, [event.subAgentId]: next };
    const lastActivity = { ...s.streamLastActivity, [event.subAgentId]: Date.now() };
    const deepRestored = { ...s.deepRestoredSessions };
    pruneInactiveStreams(streams, lastActivity, active, deepRestored);
    return { subAgentStreams: streams, streamLastActivity: lastActivity, deepRestoredSessions: deepRestored };
  }),
  appendStreamEvents: (events) => set((s) => {
    if (events.length === 0) return {};
    // 단건 append 와 동일 머지(prev ? [...prev, ev] : [ev])를 도착 순서대로 누적 —
    // 페어링(tool_use↔tool_result)이 의존하는 순서 보존. 객체 spread 1회 + set 1회로 묶는다.
    const nextStreams: Record<string, SubAgentStreamEvent[]> = { ...s.subAgentStreams };
    const nextLast: Record<string, number> = { ...s.streamLastActivity };
    const touched = new Set<string>();
    const now = Date.now();
    for (const event of events) {
      const prev = nextStreams[event.subAgentId];
      // 단건 경로와 같은 규칙 — 도장이 가리키는 제 턴 자리에 꽂는다.
      nextStreams[event.subAgentId] = prev ? insertEventInTurnOrder([...prev], event).buffer : [event];
      nextLast[event.subAgentId] = now;
      touched.add(event.subAgentId);
    }
    // 성능: 이번 배치로 늘어난 세션만 활성/비활성 차등 상한 적용(초과 시 오래된 것부터 절단).
    // 활성 세션은 slack 여유를 둬 상한 도달 후에도 대부분 순수 append 를 유지(증분 파서 유효).
    const active = computeActiveSessionIds(s.ideOverlays, s.subAgents);
    for (const sid of touched) {
      const isActive = active.has(sid);
      const cap = isActive ? STREAM_EVENTS_MAX_PER_SESSION : STREAM_EVENTS_MAX_PER_INACTIVE_SESSION;
      const slack = isActive ? STREAM_EVENTS_TRIM_SLACK : 0;
      const arr = nextStreams[sid]!;
      if (arr.length > cap + slack) nextStreams[sid] = arr.slice(arr.length - cap);
    }
    const nextDeep = { ...s.deepRestoredSessions };
    pruneInactiveStreams(nextStreams, nextLast, active, nextDeep);
    return { subAgentStreams: nextStreams, streamLastActivity: nextLast, deepRestoredSessions: nextDeep };
  }),
  loadStreamBuffers: (buffers, depth = 'shallow') => set((s) => {
    // 서버 스냅샷 버퍼도 무한 누적일 수 있으니 합류 시 동일 차등 상한 적용.
    // 이제 막 불러온 세션은 lastActivity=now 라 pruning 의 "가장 오래된" 후보가 되지 않는다.
    const streams = { ...s.subAgentStreams };
    const lastActivity = { ...s.streamLastActivity };
    const deepRestored = { ...s.deepRestoredSessions };
    const active = computeActiveSessionIds(s.ideOverlays, s.subAgents);
    const now = Date.now();
    for (const sid of Object.keys(buffers)) {
      const arr = buffers[sid]!;
      // 얕은 조회(에이전트 전체, 세션당 `MAX_STREAM_BUFFER_BULK`)는 **이미 들고 있는 것을 줄이지
      // 않는다**. 두 조회는 IDE 를 열 때 나란히 날아가는데, 응답 순서는 정해져 있지 않아 얕은
      // 쪽이 나중에 도착하면 방금 받은 깊은 복원분을 통째로 덮어 화면이 다시 500 창으로 되돌아간다
      // (그 세션은 다시 요청될 일이 없으므로 그대로 굳는다). 겹치지 않는 꼬리만 이어 붙인다.
      const prev = streams[sid];
      if (depth === 'shallow' && prev && prev.length >= arr.length) {
        const seen = new Set(prev.map((e) => e.id));
        const extra = arr.filter((e) => !seen.has(e.id));
        if (extra.length > 0) streams[sid] = [...prev, ...extra];
        lastActivity[sid] = now;
        continue;
      }
      // 깊은 복원분은 **사용자가 지금 열어 놓은 그 세션**이라 활성 상한으로 받는다. 스냅샷이
      // 아직 안 닿아 `active` 에 안 잡힌 찰나에 비활성 상한(300)으로 깎이면, 표식만 서고 창은
      // 깎인 채 굳어 "다시 받아 오는 길"이 도로 막힌다 — 그래서 이번 호출 한정으로 활성 취급한다.
      if (depth === 'deep') active.add(sid);
      const cap = active.has(sid) ? STREAM_EVENTS_MAX_PER_SESSION : STREAM_EVENTS_MAX_PER_INACTIVE_SESSION;
      streams[sid] = arr.length > cap ? arr.slice(arr.length - cap) : arr;
      lastActivity[sid] = now;
      // 상한 전체를 받아 온 세션만 표식을 세운다 — 그래야 다음에 깎였을 때 다시 받아 온다.
      if (depth === 'deep') deepRestored[sid] = true;
    }
    pruneInactiveStreams(streams, lastActivity, active, deepRestored);
    return { subAgentStreams: streams, streamLastActivity: lastActivity, deepRestoredSessions: deepRestored };
  }),
  ideOverlays: {},
  idePaneSeq: 0,
  ideLayoutEpoch: 0,
  openIDEOverlay: (agentId, opts) => {
    // §5.19 (B) — All Model 버블은 **여기서** 준비됐는지 갈린다. 여는 손잡이(캔버스 더블클릭·
    //   북마크 점프·카드에서 열기)가 전부 이 함수로 모이므로, 갈림도 손잡이마다가 아니라 이 한 곳에.
    //   준비가 안 됐으면 빈 IDE 대신 그 버블에 매인 설치 창이 뜨고, 쓸 모델이 있는데 아직 안 물었으면
    //   매고 나서(= bindLocalModel 이 다시 이 함수를 부른다) 들어간다.
    const entryConfig = get().agentConfigs[agentId];
    const isLocalAgent = !!entryConfig?.provider;
    if (isLocalAgent) {
      const decision = resolveLocalEntry(entryConfig, get().localLlm);
      if (decision.kind === 'setup') {
        set({ localModelWindow: { agentId } });
        return;
      }
      if (decision.kind === 'bind') {
        get().bindLocalModel(agentId, decision.model.id, decision.model.name);
        return;
      }
    }
    // §5.5 #17-6 (H) — 다른 창에서 건너온 짐을 **슬롯을 세우기 전에** 조각으로 편다.
    //   뷰 이름은 여기서 한 번 가린다(`migrateIDEViewType`) — 건너온 값이라 아는 뷰라는 보장이 없고,
    //   모르는 뷰를 그대로 넣으면 활동바가 아무것도 안 고른 빈 화면이 된다.
    const handoffPatch = opts?.handoff
      ? handoffPanePatch(opts.handoff, opts.handoffTarget ?? 'app')
      : null;
    const handoffView = opts?.handoff ? migrateIDEViewType(opts.handoff.activeView) : null;
    set((state) => {
      // 우선순위: (1) 마지막 활성 서브에이전트 → (2) Default 서브에이전트 → (3) null
      const subAgents = state.subAgents[agentId] ?? [];
      const exists = (subId: string): boolean => subAgents.some((s) => s.id === subId);
      const lastActive = state.selectedSubByAgent[agentId];
      const defaultSub = state.defaultSubAgents[agentId];
      const initialSession =
        (lastActive && exists(lastActive) ? lastActive : null)
        ?? (defaultSub && exists(defaultSub) ? defaultSub : null);
      // IDE 오버레이는 "지금 보고 있는 창/탭"(activeProject) 슬롯에 산다. 다른 모든 IDE 오버레이
      // 변경자(closeIDEOverlay/setIDEActiveSession/setIDEDocked/setIDEActiveView/toggleIDESidebar)가
      // activeProject 를 쓰므로 open 도 반드시 일치해야 slot 이 맞물린다.
      //   버그: 워크트리 버블로 이동(migration)한 커스텀 에이전트는 agentProjects[agentId] 가 워크트리
      //   프로젝트명이 된다. 워크트리로 드릴다운해도 activeProject 는 부모 프로젝트 그대로이고
      //   currentFolderId 만 바뀌므로, 종전처럼 agentProjects 기준(워크트리명) 슬롯에 쓰면
      //   부모 탭을 읽는 selectIDEOverlay 가 그 슬롯을 못 봐 IDE 가 안 열렸다.
      //   교차 프로젝트 열기(jumpToBookmark 등)는 openIDEOverlay 전에 이미 setActiveProject 로 탭을
      //   전환하므로 activeProject 기준으로도 동일하게 동작한다.
      const ownerProject = state.activeProject ?? state.agentProjects[agentId];
      if (!ownerProject) return {}; // 소속 프로젝트 미상이면 무시

      const panes = Object.values(state.ideOverlays).filter((o) => o.projectId === ownerProject && !!o.agentId);
      const seq = state.idePaneSeq + 1;

      // 그 에이전트를 이미 띄운 창이 있으면 **두 벌로 만들지 않는다** — 앞으로 올리기만.
      //   (같은 버블을 두 번 더블클릭했을 때 똑같은 창이 둘 서면 어느 쪽이 진짜인지 알 수 없다.)
      const already = panes.find((o) => o.agentId === agentId);
      if (already) {
        // 접혀 있던 창이면 펴서 보여 준다 — 안 그러면 눌렀는데 아무 일도 안 일어난 것처럼 보인다.
        //   §5.5 #17-6 (H) — 짐을 지고 왔으면 **그 자리에서** 이어 붙인다(밖에서 돌아온 창이
        //   이미 서 있던 슬롯을 만났을 때. 안 그러면 되돌아온 창만 옛 상태로 남는다).
        return {
          idePaneSeq: seq,
          ideOverlays: {
            ...state.ideOverlays,
            [already.paneKey]: {
              ...already,
              ...(handoffPatch ?? {}),
              ...(handoffView ? { activeView: handoffView } : {}),
              z: seq,
              collapsed: false,
            },
          },
        };
      }

      // 어느 자리에 열 것인가:
      //   ① 주 창(키=projectId)이 비어 있으면 그 자리 — 프로젝트의 첫 창은 종전과 한 픽셀도 다르지 않다.
      //   ② `pane:'new'`(캔버스 더블클릭) 면 새 창. 상한을 넘으면 **가장 오래 안 만진 창**을 재사용한다
      //      (§3.2.3 — 캡은 값 길이가 아니라 **개수**에 건다).
      //   ③ 그 밖(북마크 점프·지휘통제실 [이동]·콘티 이력)은 종전대로 **맨 앞 창의 자리를 교체**한다.
      const primary = state.ideOverlays[ownerProject];
      let targetKey: string;
      let prev: IDEOverlayState | undefined;
      if (!primary?.agentId) {
        targetKey = ownerProject;
        prev = primary;
      } else if (opts?.pane === 'new' && panes.length < IDE_MAX_PANES) {
        targetKey = `${ownerProject}::ide-${seq}`;
        prev = undefined;
      } else if (opts?.pane === 'new') {
        const lru = [...panes].sort((a, b) => a.z - b.z)[0]!;
        targetKey = lru.paneKey;
        prev = lru;
      } else {
        const mru = [...panes].sort((a, b) => b.z - a.z)[0] ?? primary;
        targetKey = mru.paneKey;
        prev = mru;
      }

      // §5.5 #17-1 (v2.17) — 자리를 재사용할 때는 붙어 있던 변·두께·순서를 그대로 이어받는다
      //   (우측에 붙여 둔 창에서 에이전트만 갈아 끼우는 종전 패턴).
      const keepDock = !!prev?.agentId && !!prev.dockSide;
      // 새로 서는 창이 프로젝트의 첫 창이 아니면 **플로팅**으로 뜬다 — 모달은 캔버스를 통째로 덮어
      //   "옆에 놓고 같이 본다"는 목적과 정면으로 어긋난다.
      const openMode: 'modal' | 'floating' = keepDock || panes.length > 0 ? 'floating' : 'modal';
      return {
        idePaneSeq: seq,
        ideOverlays: {
          ...state.ideOverlays,
          [targetKey]: {
            agentId,
            paneKey: targetKey,
            projectId: ownerProject,
            activeSessionId: initialSession,
            // §5.19 (G) — 로컬 버블의 IDE 에는 MCP 항목 자체가 없다(클로드 CLI 에 매인 자리라 뺐다).
            //   첫 화면은 프로바이더와 무관하게 뜻이 통하는 파일 탐색기다.
            activeView: isLocalAgent ? 'files' : 'mcp',
            sidebarCollapsed: true,
            dockSide: keepDock ? prev!.dockSide : null,
            dockSize: keepDock ? prev!.dockSize : IDE_DOCK.DEFAULT_SIZE.x,
            dockOrder: keepDock ? prev!.dockOrder : 0,
            dockSpan: keepDock ? prev!.dockSpan : 1,
            z: seq,
            float: keepDock ? prev?.float ?? null : null,
            collapsed: false,
            openMode,
            // §5.5 #17-27 — 편집창은 IDE 를 새로 열 때(=에이전트 교체) 빈 상태에서 시작한다.
            editorFiles: [],
            activeEditorPath: null,
            // §5.5 #17-27 ⑯ — 접어 둔 탭 묶음은 **그 에이전트의 세션들** 것이다. 버블이 갈리면 남의
            //   것이므로 함께 비운다(고정도 그 탭 묶음에 대한 결정이라 같이 풀린다).
            editorPinned: false,
            editorTabsBySession: {},
            // §5.5 #17-6 (H) — 짐을 지고 온 창은 **위 초기값 대신** 그 상태로 선다(맨 끝에 덮는다).
            //   창을 연 다음에 고치면 첫 프레임에 빈 창이 한 번 보였다가 바뀐다.
            ...(handoffPatch ?? {}),
            ...(handoffView ? { activeView: handoffView } : {}),
          },
        },
      };
    });
  },
  closeIDEOverlay: (paneKey) => set((state) => {
    // 닫기는 그 창 하나만. 키를 안 주면 종전대로 활성 프로젝트의 주 창.
    //   슬롯 자체 제거 = 깨끗한 초기 상태로 복귀(다른 창은 그대로 남는다).
    const key = resolvePaneKey(state, paneKey);
    if (!key || !state.ideOverlays[key]) return {};
    const next = { ...state.ideOverlays };
    delete next[key];
    return { ideOverlays: next };
  }),
  focusIDEPane: (paneKey) => set((s) => {
    const cur = s.ideOverlays[paneKey];
    if (!cur) return {};
    // 이미 맨 앞이면 도장을 새로 찍지 않는다 — 클릭마다 상태가 바뀌면 리렌더만 늘어난다.
    const front = Object.values(s.ideOverlays).reduce((m, o) => (o.projectId === cur.projectId && o.z > m ? o.z : m), -1);
    if (cur.z >= front) return {};
    const seq = s.idePaneSeq + 1;
    return { idePaneSeq: seq, ideOverlays: { ...s.ideOverlays, [paneKey]: { ...cur, z: seq } } };
  }),
  cycleIDEPaneFocus: (dir) => set((s) => {
    // 순서는 **열린 순번**으로 고정한다 — 앞뒤 도장으로 돌면 누를 때마다 두 창 사이만 오간다.
    const list = selectRenderedIDEPanes(s)
      .filter((o) => !!o.agentId && !!s.nodeMap[o.agentId!])
      .sort((a, b) => idePaneKeySeq(a.paneKey) - idePaneKeySeq(b.paneKey));
    if (list.length <= 1) return {};
    let frontIdx = 0;
    let bestZ = Number.NEGATIVE_INFINITY;
    list.forEach((o, i) => { if (o.z > bestZ) { bestZ = o.z; frontIdx = i; } });
    const target = list[(frontIdx + (dir > 0 ? 1 : list.length - 1)) % list.length]!;
    const seq = s.idePaneSeq + 1;
    return { idePaneSeq: seq, ideOverlays: { ...s.ideOverlays, [target.paneKey]: { ...target, z: seq } } };
  }),
  applyIDEWindowLayout: (kind, vp) => set((state) => {
    const all = selectProjectIDEPanes(state).filter((o) => !!o.agentId);
    if (all.length === 0) return {};
    const epoch = state.ideLayoutEpoch + 1;
    const next = { ...state.ideOverlays };
    const write = (paneKey: string, patch: Partial<IDEOverlayState>): void => {
      const cur = next[paneKey];
      if (cur) next[paneKey] = { ...cur, ...patch };
    };

    if (kind === 'collapseAll' || kind === 'expandAll') {
      // 여기서는 카메라를 옮기지 않는다(창 하나를 접는 setIDEPaneCollapsed 와 다른 점) —
      //   한꺼번에 접는 창이 여럿이면 "그 창의 버블"이 하나로 정해지지 않는다.
      const collapsed = kind === 'collapseAll';
      for (const o of all) write(o.paneKey, { collapsed });
      return { ideOverlays: next, ideLayoutEpoch: epoch };
    }

    // 정리 대상은 **펴져 있는 창**뿐이다 — 접어 둔 창을 몰래 펴지 않는다(접기는 사용자의 뜻).
    const open = all
      .filter((o) => !o.collapsed)
      .sort((a, b) => idePaneKeySeq(a.paneKey) - idePaneKeySeq(b.paneKey));
    if (open.length === 0) return {};

    if (kind === 'undockAll') {
      // 자리는 그대로 두고 떼기만 한다 — 사용자가 잡아 둔 배치를 지우지 않는다.
      for (const o of open) write(o.paneKey, { dockSide: null, openMode: 'floating' });
      return { ideOverlays: next, ideLayoutEpoch: epoch };
    }

    if (kind === 'tile' || kind === 'cascade') {
      const bounds = { x: 0, y: IDE_DOCK.HEADER_H, w: vp.w, h: Math.max(1, vp.h - IDE_DOCK.HEADER_H) };
      const geoms = kind === 'tile'
        ? tileFloatGeoms(open.length, bounds)
        : cascadeFloatGeoms(open.length, bounds);
      open.forEach((o, i) => {
        const g = geoms[i];
        if (!g) return;
        write(o.paneKey, { dockSide: null, openMode: 'floating', float: clampFloatGeom(g, vp) });
      });
      return { ideOverlays: next, ideLayoutEpoch: epoch };
    }

    if (kind === 'tabRight') {
      // 전부 오른쪽 **한 칸**에 겹친다(같은 order = 탭). 화면은 한 번만 잘리고 창은 탭으로 오간다.
      const size = clampDockSize('right', open[0]!.dockSide === 'right' ? open[0]!.dockSize : defaultDockSize('right'), vp, []);
      for (const o of open) write(o.paneKey, { dockSide: 'right', dockSize: size, dockOrder: 0, dockSpan: 1 });
      return { ideOverlays: next, ideLayoutEpoch: epoch };
    }

    // splitLeftRight — 앞 절반은 왼쪽 한 칸, 뒤 절반은 오른쪽 한 칸(각 칸 안에서는 탭).
    const each = Math.max(
      IDE_DOCK.MIN_SIZE,
      Math.min(defaultDockSize('left'), Math.floor((vp.w - IDE_DOCK.KEEP_CANVAS.w) / 2)),
    );
    const half = Math.ceil(open.length / 2);
    open.forEach((o, i) => {
      write(o.paneKey, {
        dockSide: i < half ? 'left' : 'right',
        dockSize: each,
        dockOrder: 0,
        dockSpan: 1,
      });
    });
    return { ideOverlays: next, ideLayoutEpoch: epoch };
  }),
  setIDEPaneCollapsed: (paneKey, collapsed) => set((s) => {
    const cur = s.ideOverlays[paneKey];
    if (!cur || cur.collapsed === collapsed) return {};
    // 펴는 김에 맨 앞으로 — 접었다 편 창이 다른 창 뒤에 숨어 "안 펴졌다"로 보이지 않게.
    const seq = collapsed ? s.idePaneSeq : s.idePaneSeq + 1;
    // 접기 = **캔버스를 돌려주는 것**이다. 그런데 창이 화면을 덮고 있던 동안 카메라는 딴 데
    //   가 있을 수 있어, 자리만 비워 주면 방금 접은 것이 어느 버블이었는지 화면에서 찾을 수가
    //   없다(사용자 지시 — "접기 누르면 창은 내려가고 캔버스의 버블에 포커싱"). 그래서 접는
    //   동작에 **그 창의 버블로 카메라 이동**을 한 벌로 묶는다. 고르는 것은 카메라뿐 —
    //   선택(selectNode)까지 하면 상세 패널이 열려 방금 돌려준 캔버스를 도로 덮는다.
    //   던지는 대상은 **지금 살아 있는 버블**뿐이다: 삭제·휴지통으로 사라진 버블(유령 창 —
    //   selectOrphanIDEPanes)로 보내면 캔버스가 못 찾아 focusNodeId 만 남고, 나중에 엉뚱한
    //   순간(그 id 가 다시 그려질 때) 카메라가 튄다.
    const focusTarget = collapsed ? cur.agentId : null;
    const focusNode = focusTarget ? s.nodeMap[focusTarget] : undefined;
    const focus = focusNode && !focusNode.trashed ? focusTarget : null;
    return {
      idePaneSeq: seq,
      ideOverlays: { ...s.ideOverlays, [paneKey]: { ...cur, collapsed, z: collapsed ? cur.z : seq } },
      ...(focus ? { focusNodeId: focus } : {}),
    };
  }),
  setIDEPaneFloat: (paneKey, geom) => set((s) => {
    const key = resolvePaneKey(s, paneKey);
    if (!key) return {};
    const cur = s.ideOverlays[key];
    if (!cur) return {};
    const prev = cur.float;
    if (prev && prev.x === geom.x && prev.y === geom.y && prev.w === geom.w && prev.h === geom.h) return {};
    return { ideOverlays: { ...s.ideOverlays, [key]: { ...cur, float: geom } } };
  }),
  setIDEPaneDock: (paneKey, dock) => set((s) => {
    const key = resolvePaneKey(s, paneKey);
    if (!key) return {};
    const cur = s.ideOverlays[key];
    if (!cur) return {};
    const nextSide = dock?.side ?? null;
    if (cur.dockSide === nextSide && (!dock || (cur.dockSize === dock.size && cur.dockOrder === dock.order))) return {};
    return {
      ideOverlays: {
        ...s.ideOverlays,
        [key]: dock
          ? { ...cur, dockSide: dock.side, dockSize: dock.size, dockOrder: dock.order }
          : { ...cur, dockSide: null },
      },
    };
  }),
  setIDEDockSpans: (spans) => set((s) => {
    let changed = false;
    const next = { ...s.ideOverlays };
    for (const [key, span] of Object.entries(spans)) {
      const cur = next[key];
      if (!cur || cur.dockSpan === span) continue;
      next[key] = { ...cur, dockSpan: span };
      changed = true;
    }
    return changed ? { ideOverlays: next } : {};
  }),
  setIDEDockSize: (paneKey, size) => set((s) => {
    const key = resolvePaneKey(s, paneKey);
    if (!key) return {};
    const cur = s.ideOverlays[key];
    if (!cur?.dockSide || cur.dockSize === size) return {};
    // 같은 변에 붙은 창들은 한 칸을 나눠 쓴다 — 두께는 그 변 전체의 성질이라 함께 바뀐다.
    //   (한 창만 바꾸면 레이아웃이 `max` 를 집어 손잡이가 "가끔 안 먹는" 것처럼 보인다.)
    const next = { ...s.ideOverlays };
    for (const o of Object.values(s.ideOverlays)) {
      if (o.projectId === cur.projectId && o.dockSide === cur.dockSide) next[o.paneKey] = { ...o, dockSize: size };
    }
    return { ideOverlays: next };
  }),
  // ─── §5.5 #17-27 내장 편집창 ───
  // 모든 변경자는 IDE 오버레이와 같은 슬롯 규약(activeProject 기준)을 따른다 — 여는 손잡이가
  // 사이드바·스트림 어디든 결국 "지금 보고 있는 탭의 IDE" 로 모여야 하기 때문이다.
  openIDEEditorFile: (file, paneKey) => set((s) => {
    const key = resolvePaneKey(s, paneKey);
    if (!key) return {};
    const cur = s.ideOverlays[key];
    if (!cur) return {};
    const already = cur.editorFiles.some((f) => f.relPath === file.relPath);
    let files = already ? cur.editorFiles : [...cur.editorFiles, file];
    // 상한을 넘으면 **저장할 것이 없는 가장 오래된 탭**부터 밀어낸다(고치던 파일은 남는다).
    if (!already && files.length > IDE_EDITOR_MAX_TABS) {
      const victim = files.find((f) => !f.dirty && f.relPath !== file.relPath);
      if (victim) files = files.filter((f) => f.relPath !== victim.relPath);
    }
    return {
      ideOverlays: {
        ...s.ideOverlays,
        [key]: { ...cur, editorFiles: files, activeEditorPath: file.relPath },
      },
    };
  }),
  closeIDEEditorFile: (relPath, paneKey) => set((s) => {
    const key = resolvePaneKey(s, paneKey);
    if (!key) return {};
    const cur = s.ideOverlays[key];
    if (!cur) return {};
    const idx = cur.editorFiles.findIndex((f) => f.relPath === relPath);
    if (idx < 0) return {};
    const files = cur.editorFiles.filter((f) => f.relPath !== relPath);
    // 활성 탭을 닫았으면 오른쪽 이웃 → 없으면 왼쪽 이웃으로. 마지막 탭이면 편집창이 닫힌다.
    const nextActive = cur.activeEditorPath === relPath
      ? (files[idx]?.relPath ?? files[idx - 1]?.relPath ?? null)
      : cur.activeEditorPath;
    return {
      ideOverlays: {
        ...s.ideOverlays,
        [key]: { ...cur, editorFiles: files, activeEditorPath: nextActive },
      },
    };
  }),
  setActiveIDEEditorFile: (relPath, paneKey) => set((s) => {
    const key = resolvePaneKey(s, paneKey);
    if (!key) return {};
    const cur = s.ideOverlays[key];
    if (!cur || cur.activeEditorPath === relPath) return {};
    return {
      ideOverlays: { ...s.ideOverlays, [key]: { ...cur, activeEditorPath: relPath } },
    };
  }),
  closeIDEEditor: (paneKey) => set((s) => {
    const key = resolvePaneKey(s, paneKey);
    if (!key) return {};
    const cur = s.ideOverlays[key];
    if (!cur) return {};
    return {
      ideOverlays: { ...s.ideOverlays, [key]: { ...cur, editorFiles: [], activeEditorPath: null } },
    };
  }),
  setIDEEditorFileDirty: (relPath, dirty, paneKey) => set((s) => {
    const key = resolvePaneKey(s, paneKey);
    if (!key) return {};
    const cur = s.ideOverlays[key];
    if (!cur) return {};
    const target = cur.editorFiles.find((f) => f.relPath === relPath);
    if (!target || !!target.dirty === dirty) return {};
    return {
      ideOverlays: {
        ...s.ideOverlays,
        [key]: {
          ...cur,
          editorFiles: cur.editorFiles.map((f) => (f.relPath === relPath ? { ...f, dirty } : f)),
        },
      },
    };
  }),
  setIDEEditorTabsPinned: (pinned, paneKey) => set((s) => {
    const key = resolvePaneKey(s, paneKey);
    if (!key) return {};
    const cur = s.ideOverlays[key];
    if (!cur) return {};
    const scoped = setEditorTabsPinned(cur, pinned, cur.activeSessionId);
    if (scoped === cur) return {};
    return { ideOverlays: { ...s.ideOverlays, [key]: { ...cur, ...scoped } } };
  }),
  ideEditorWidth: clampIdeEditorWidth(loadJSON<number>(IDE_EDITOR_WIDTH_KEY, IDE_EDITOR_WIDTH.DEFAULT)),
  setIdeEditorWidth: (w) => set((s) => {
    const next = clampIdeEditorWidth(w);
    if (s.ideEditorWidth === next) return s;
    saveJSON(IDE_EDITOR_WIDTH_KEY, next);
    return { ideEditorWidth: next };
  }),
  // ─── §5.5 #17-27 ⑪ [추종] — 켜짐도 신호도 세션마다 따로 ───
  ideEditorFollow: normalizeFollowMap(loadJSON<unknown>(IDE_EDITOR_FOLLOW_KEY, {})),
  setIdeEditorFollow: (sessionKey, on) => set((s) => {
    const already = s.ideEditorFollow[sessionKey] === true;
    if (already === on) return s;
    const next: Record<string, true> = { ...s.ideEditorFollow };
    if (on) {
      next[sessionKey] = true;
      // 키 순서 = 켠 순서. 상한을 넘으면 **가장 오래 전에 켠 세션부터** 버린다(방금 켠 것은 남는다).
      const keys = Object.keys(next);
      for (let i = 0; i < keys.length - IDE_FOLLOW_MAX_KEYS; i += 1) {
        const victim = keys[i]!;
        if (victim !== sessionKey) delete next[victim];
      }
    } else {
      delete next[sessionKey];
    }
    saveJSON(IDE_EDITOR_FOLLOW_KEY, next);
    // 켤 때는 그 세션의 속기억을 비운다 — `followPendingEditNow` 가 그 한 건을 이미 신호로 옮겨 담았고,
    //   남겨 두면 다음에 껐다 켤 때 **옛 편집으로** 한 번 더 끌려간다.
    if (on) {
      return s.ideEditorFollowPending?.sessionKey === sessionKey
        ? { ideEditorFollow: next, ideEditorFollowPending: null }
        : { ideEditorFollow: next };
    }
    // 끌 때는 아직 처리되지 않은 신호·자국도 함께 버린다 — 끈 뒤에 화면이 한 번 더 움직이면 안 된다.
    return {
      ideEditorFollow: next,
      ideEditorFollowSignal: s.ideEditorFollowSignal?.sessionKey === sessionKey ? null : s.ideEditorFollowSignal,
      ideEditorFollowLast: s.ideEditorFollowLast?.sessionKey === sessionKey ? null : s.ideEditorFollowLast,
    };
  }),
  // ─── §5.5 #17-30 diff 리뷰 코멘트 — 세션마다 따로, 보내면 비운다(휘발) ───
  diffComments: {},
  addDiffComment: (sessionKey, comment) => set((s) => {
    const cur = s.diffComments[sessionKey] ?? [];
    // 상한을 넘으면 **더 담지 않는다**(오래된 것을 조용히 버리면 사용자가 적은 문장이 사라진다 —
    //   화면이 "N건까지" 라고 말하고 사용자가 보내거나 지워서 자리를 만든다).
    if (cur.length >= DIFF_COMMENT_MAX) return s;
    return { diffComments: { ...s.diffComments, [sessionKey]: [...cur, comment] } };
  }),
  removeDiffComment: (sessionKey, commentId) => set((s) => {
    const cur = s.diffComments[sessionKey];
    if (!cur) return s;
    const next = cur.filter((c) => c.id !== commentId);
    if (next.length === cur.length) return s;
    const map = { ...s.diffComments };
    if (next.length === 0) delete map[sessionKey];
    else map[sessionKey] = next;
    return { diffComments: map };
  }),
  clearDiffComments: (sessionKey) => set((s) => {
    if (!s.diffComments[sessionKey]) return s;
    const map = { ...s.diffComments };
    delete map[sessionKey];
    return { diffComments: map };
  }),
  ideEditorFollowSignal: null,
  setIdeEditorFollowSignal: (signal) => set((s) => (
    s.ideEditorFollowSignal?.at === signal.at && s.ideEditorFollowSignal.relPath === signal.relPath
      ? s
      : { ideEditorFollowSignal: signal }
  )),
  clearIdeEditorFollowSignal: () => set((s) => (s.ideEditorFollowSignal ? { ideEditorFollowSignal: null } : s)),
  ideEditorFollowLast: null,
  setIdeEditorFollowLast: (mark) => set(() => ({ ideEditorFollowLast: mark })),
  ideEditorFollowPending: null,
  setIdeEditorFollowPending: (pending) => set((s) => {
    const cur = s.ideEditorFollowPending;
    // 매 스트림 틱마다 같은 값을 다시 심지 않는다 — 추종이 꺼진 세션에서도 이 계산은 계속 돌기 때문이다.
    if (cur === pending) return s;
    if (cur && pending
      && cur.sessionKey === pending.sessionKey
      && cur.at === pending.at) return s;
    return { ideEditorFollowPending: pending };
  }),
  followPendingEditNow: (sessionKey) => {
    const s = get();
    const pending = s.ideEditorFollowPending;
    s.setIdeEditorFollow(sessionKey, true);
    if (!pending || pending.sessionKey !== sessionKey) return;
    // 켜는 그 손짓이 곧 "저 편집을 보여 달라" 이므로, 여는 것도 알리는 것도 여기서 한 번에 한다.
    s.openIDEEditorFile({ relPath: pending.relPath, absPath: pending.absPath, name: pending.name });
    s.setIdeEditorFollowSignal({
      sessionKey,
      relPath: pending.relPath,
      absPath: pending.absPath,
      newString: pending.newString,
      at: pending.at,
    });
    s.setIdeEditorFollowPending(null);
  },
  setIDEActiveSession: (sessionId, paneKey) => set((s) => {
    const key = resolvePaneKey(s, paneKey);
    if (!key) return {};
    const cur = s.ideOverlays[key];
    if (!cur) return {};
    // §5.5 #17-27 ⑯ — 세션이 바뀌면 탭 줄도 함께 간다(고정이 켜져 있으면 지금 탭이 따라간다).
    //   여는 손잡이가 사이드바·스트림·북마크로 여럿이라 여기 한 곳에서 갈아야 어긋나지 않는다.
    const scoped = switchEditorTabScope(cur, cur.activeSessionId, sessionId);
    // 사라진 세션이 접어 둔 탭은 다시는 펴지지 않는다 — 세션 목록을 아는 이 자리에서 걷는다.
    //   목록이 아직 안 온 찰나(빈 배열)에는 손대지 않는다(멀쩡한 묶음을 통째로 날리지 않게).
    const live = cur.agentId ? (s.subAgents[cur.agentId] ?? []) : [];
    const editorTabsBySession = live.length > 0
      ? pruneEditorTabScopes(scoped.editorTabsBySession, live.map((x) => x.id))
      : scoped.editorTabsBySession;
    const next: Partial<GraphState> = {
      ideOverlays: {
        ...s.ideOverlays,
        [key]: { ...cur, ...scoped, editorTabsBySession, activeSessionId: sessionId },
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
  // ─── §5.5 #17-34 창 안 화면 분할 ───
  // 모든 변형은 순수 모듈(`splitLayout`)이 트리를 만들고 `commitIDESplit` 이 앉힌다 —
  // "두 칸 이상일 때만 분할이 존재한다"는 규칙이 한 곳에만 있어야 화면이 어긋나지 않는다.
  ideSplits: {},
  dropSessionOnIDECell: (slotKey, cellId, side, sessionId, fromCellId) => set((s) => {
    const slot = s.ideOverlays[slotKey];
    if (!slot?.agentId) return {};
    // **이 창의 세션인가.** 창이 여럿이면 옆 창의 탭이 끌려 들어올 수 있는데, 그 칸은 다음 정리
    //   (`syncIDESplitCells`)에서 곧바로 걷혀 사용자 눈에는 "떨궜는데 사라졌다"로만 보인다.
    //   화면이 그 사실을 미리 말하고(미리보기 호박색), 스토어가 여기서 한 번 더 막는다.
    if (sessionId !== null && !(s.subAgents[slot.agentId] ?? []).some((x) => x.id === sessionId)) return {};
    const cur = s.ideSplits[slotKey];
    // 창이 다른 에이전트로 갈아 끼워졌으면 남아 있던 분할은 남의 것이다 — 새로 시작한다.
    const existing = cur && cur.agentId === slot.agentId ? cur : null;
    // 아직 안 나뉜 창이면 **지금 보고 있는 세션**이 첫 칸이 된다(떨군 세션이 그 옆에 선다).
    const base: SplitNode = existing?.layout ?? makeCell(slot.activeSessionId);
    const targetId = cellId ?? existing?.focusedCellId ?? listCells(base)[0]?.id ?? '';
    // 이미 다른 칸에 떠 있는 세션을 떨구면 **복제가 아니라 옮기기**다. 같은 세션을 두 칸에 띄워
    //   얻는 것은 없고(같은 스트림 두 벌), CMD 세션이면 한 PTY 에 두 화면이 붙어 입력이 갈린다.
    //   아직 안 나뉜 창도 마찬가지다 — 지금 보고 있는 그 세션을 본문에 떨구면 같은 것이 두 칸에 뜬다.
    const dupCellId = cellIdForSession(base, sessionId);
    const from = fromCellId ?? dupCellId;
    if (from && from === targetId) return {}; // 제자리 드롭 — 아무 일도 없다.
    let layout = base;
    if (from && side !== 'center') {
      // 옮기기 — 원본을 **먼저** 닫아 칸 수가 늘지 않게 한다(상한에도 걸리지 않는다).
      const without = closeCell(layout, from);
      if (without && findCell(without, targetId)) layout = without;
    }
    const res = dropOnCell(layout, targetId, side, sessionId);
    if (!res) return {}; // 칸 상한 도달 — 화면이 그 사실을 따로 알린다.
    let next = res.layout;
    if (from && side === 'center') {
      const closed = closeCell(next, from);
      if (closed) next = closed;
    }
    return commitIDESplit(s, slotKey, slot.agentId, next, res.focusCellId);
  }),
  closeIDESplitCell: (slotKey, cellId) => set((s) => {
    const cur = s.ideSplits[slotKey];
    if (!cur) return {};
    const inherit = cur.focusedCellId === cellId ? adjacentCellId(cur.layout, cellId) : cur.focusedCellId;
    return commitIDESplit(s, slotKey, cur.agentId, closeCell(cur.layout, cellId), inherit);
  }),
  focusIDESplitCell: (slotKey, cellId) => set((s) => {
    const cur = s.ideSplits[slotKey];
    if (!cur || cur.focusedCellId === cellId) return {};
    if (!findCell(cur.layout, cellId)) return {};
    return { ideSplits: { ...s.ideSplits, [slotKey]: { ...cur, focusedCellId: cellId } } };
  }),
  setIDESplitLayout: (slotKey, layout) => set((s) => {
    const cur = s.ideSplits[slotKey];
    if (!cur) return {};
    return commitIDESplit(s, slotKey, cur.agentId, layout, cur.focusedCellId);
  }),
  syncIDESplitCells: (slotKey, validSessionIds) => set((s) => {
    const cur = s.ideSplits[slotKey];
    if (!cur) return {};
    const valid = new Set(validSessionIds);
    const pruned = pruneCells(cur.layout, (id) => valid.has(id));
    // `pruneCells` 는 걷어낸 게 없어도 새 객체를 돌려준다 — 참조로 비교하면 effect 가 서로를 깨워
    // 무한히 돈다. **무엇이 남았는가**로 비교한다.
    const before = listCells(cur.layout).map((c) => c.id).join('|');
    const after = pruned ? listCells(pruned).map((c) => c.id).join('|') : '';
    if (before === after) return {};
    return commitIDESplit(s, slotKey, cur.agentId, pruned, cur.focusedCellId);
  }),
  resetIDESplit: (slotKey) => set((s) => {
    const cur = s.ideSplits[slotKey];
    if (!cur) return {};
    const keep = (cur.focusedCellId ? findCell(cur.layout, cur.focusedCellId) : null) ?? listCells(cur.layout)[0] ?? null;
    return commitIDESplit(s, slotKey, cur.agentId, keep, keep?.id ?? null);
  }),
  selectedSubByAgent: {},
  selectSubForAgent: (agentId, subId) => set((s) => ({
    selectedSubByAgent: { ...s.selectedSubByAgent, [agentId]: subId },
  })),
  ideBookmarks: loadBookmarks(),
  addBookmark: (input) => set((s) => {
    const text = input.text.trim();
    if (!text) return {};
    const bookmark: IDEBookmark = {
      id: `bm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      text: text.length > BOOKMARK_TEXT_MAX ? text.slice(0, BOOKMARK_TEXT_MAX) : text,
      agentId: input.agentId,
      sessionId: input.sessionId,
      projectId: input.projectId,
      agentLabel: input.agentLabel,
      anchorId: input.anchorId,
      createdAt: Date.now(),
    };
    // 들어갈 칸은 **보고 있는 프로젝트 우선** — openIDEOverlay 와 같은 순서다(워크트리로 드릴다운해도
    // activeProject 는 부모 그대로이고 agentProjects 만 워크트리명이 되므로, agentProjects 를 앞세우면
    // 부모 탭을 읽는 화면이 그 칸을 영영 못 본다).
    const key = s.activeProject ?? input.projectId ?? s.agentProjects[input.agentId] ?? UNKNOWN_BOOKMARK_PROJECT;
    const next: BookmarkStore = {
      ...s.ideBookmarks,
      [key]: [bookmark, ...(s.ideBookmarks[key] ?? [])].slice(0, BOOKMARK_MAX),
    };
    saveJSON(IDE_BOOKMARKS_KEY, next);
    return { ideBookmarks: next };
  }),
  removeBookmark: (id) => set((s) => {
    // 어느 칸에 있든 id 로 찾아 지운다(떠돌이 칸의 옛 항목도 지워진다).
    const next: BookmarkStore = {};
    let removed = false;
    for (const [key, list] of Object.entries(s.ideBookmarks)) {
      const kept = list.filter((b) => b.id !== id);
      if (kept.length !== list.length) removed = true;
      if (kept.length > 0) next[key] = kept.length === list.length ? list : kept;
    }
    if (!removed) return {};
    saveJSON(IDE_BOOKMARKS_KEY, next);
    return { ideBookmarks: next };
  }),
  seenSkills: loadJSON<{ initialized: boolean; keys: Record<string, true> }>(SKILLS_SEEN_KEY, { initialized: false, keys: {} }),
  seedSeenSkills: (keys) => set((s) => {
    if (s.seenSkills.initialized) return {};
    const seeded: Record<string, true> = {};
    for (const k of keys) seeded[k] = true;
    const next = { initialized: true, keys: seeded };
    saveJSON(SKILLS_SEEN_KEY, next);
    return { seenSkills: next };
  }),
  markSkillSeen: (key) => set((s) => {
    if (s.seenSkills.keys[key]) return {};
    const next = { initialized: true, keys: { ...s.seenSkills.keys, [key]: true as const } };
    saveJSON(SKILLS_SEEN_KEY, next);
    return { seenSkills: next };
  }),
  jumpToBookmark: (bookmark) => {
    const s = get();
    // 다른 프로젝트의 북마크면 그 프로젝트 탭으로 먼저 전환(hydrated/stub 존재 시에만).
    const proj = s.agentProjects[bookmark.agentId] ?? bookmark.projectId ?? s.activeProject;
    if (proj && proj !== s.activeProject && (s.projects[proj] || s.stubProjects[proj])) {
      get().setActiveProject(proj);
    }
    get().openIDEOverlay(bookmark.agentId);
    get().setIDEActiveSession(bookmark.sessionId);
    set((s) => ({
      bookmarkScrollTarget: {
        sessionId: bookmark.sessionId,
        text: bookmark.text,
        anchorId: bookmark.anchorId,
        nonce: (s.bookmarkScrollTarget?.nonce ?? 0) + 1,
      },
    }));
  },
  bookmarkScrollTarget: null,
  clearBookmarkScrollTarget: () => set((s) => (s.bookmarkScrollTarget ? { bookmarkScrollTarget: null } : {})),
  sessionSummaries: loadJSON<Record<string, SessionSummaryEntry>>(SESSION_SUMMARIES_KEY, {}),
  setSessionSummary: (entry) => set((s) => {
    const next = { ...s.sessionSummaries, [entry.subId]: entry };
    // 상한 — 가장 오래된 것부터 밀어냄(at 오름차순).
    const keys = Object.keys(next);
    if (keys.length > SESSION_SUMMARY_MAX) {
      const sorted = keys.sort((a, b) => (next[a]!.at) - (next[b]!.at));
      for (const k of sorted.slice(0, keys.length - SESSION_SUMMARY_MAX)) delete next[k];
    }
    saveJSON(SESSION_SUMMARIES_KEY, next);
    return { sessionSummaries: next };
  }),
  removeSessionSummary: (subId) => set((s) => {
    if (!s.sessionSummaries[subId]) return {};
    const next = { ...s.sessionSummaries };
    delete next[subId];
    saveJSON(SESSION_SUMMARIES_KEY, Object.keys(next).length > 0 ? next : null);
    return { sessionSummaries: next };
  }),
  markSessionSummaryClosed: (subId) => set((s) => {
    const cur = s.sessionSummaries[subId];
    if (!cur || cur.closed) return {};
    const next = { ...s.sessionSummaries, [subId]: { ...cur, closed: true } };
    saveJSON(SESSION_SUMMARIES_KEY, next);
    return { sessionSummaries: next };
  }),
  setIDEActiveView: (view, paneKey) => set((s) => {
    const key = resolvePaneKey(s, paneKey);
    if (!key) return {};
    const cur = s.ideOverlays[key];
    if (!cur) return {};
    return {
      ideOverlays: { ...s.ideOverlays, [key]: { ...cur, activeView: view } },
    };
  }),
  toggleIDESidebar: (paneKey) => set((s) => {
    const key = resolvePaneKey(s, paneKey);
    if (!key) return {};
    const cur = s.ideOverlays[key];
    if (!cur) return {};
    return {
      ideOverlays: { ...s.ideOverlays, [key]: { ...cur, sidebarCollapsed: !cur.sidebarCollapsed } },
    };
  }),
  uiLocale: DEFAULT_UI_LOCALE,
  applyUiLocale: (locale) => {
    set({ uiLocale: locale });
    changeUiLocale(locale);
  },
  applyV150Metrics: (recentToolDurations, compactCounts, rateLimits, claudeUsage) => set({
    recentToolDurations: recentToolDurations ?? {},
    compactCounts: compactCounts ?? {},
    rateLimits: rateLimits ?? null,
    claudeUsage: claudeUsage ?? null,
  }),
  // §4 v4.82 — 로그인 상태. 서버가 판정 전이면 필드가 없어 null 로 남고, 그동안 팝업은 뜨지 않는다.
  applyClaudeAuth: (auth) => set((s) => {
    if (!auth) return s.claudeAuth === null ? {} : { claudeAuth: null };
    const prev = s.claudeAuth;
    // 로그아웃 → 로그인으로 바뀌면 "나중에" 기억을 푼다(다음에 로그아웃되면 다시 물어야 하므로).
    const dismissed = prev?.loggedIn === false && auth.loggedIn ? false : s.loginGateDismissed;
    return { claudeAuth: auth, loginGateDismissed: dismissed, ...(auth.loggedIn ? { loginGateForced: false } : {}) };
  }),
  refreshClaudeAuth: async () => {
    try {
      const r = await fetch(`${API_BASE}/api/auth/status/refresh`, { method: 'POST' });
      if (!r.ok) return null;
      const next = await r.json() as ClaudeAuthStatus;
      if (typeof next?.loggedIn !== 'boolean') return null;
      get().applyClaudeAuth(next);
      return next;
    } catch {
      return null;
    }
  },
  loginGateDismissed: false,
  loginGateForced: false,
  setLoginGate: (state) => set((s) => ({
    loginGateForced: state.forced ?? s.loginGateForced,
    loginGateDismissed: state.dismissed ?? s.loginGateDismissed,
  })),

  // §4 (첫 실행 설치 온보딩) — CLI 설치 판정. 서버가 판정 전이면 null 이라 게이트는 뜨지 않는다.
  claudeSetup: null,
  applyClaudeSetup: (setup) => set((s) => {
    if (!setup) return s.claudeSetup === null ? {} : { claudeSetup: null };
    const prev = s.claudeSetup;
    // 없다 → 있다(설치 성공/수동 설치 감지)로 바뀌면 "나중에" 기억을 푼다. 나중에 실행본이
    // 사라져 다시 missing 이 되면 그때는 사용자에게 다시 물어야 하기 때문이다.
    const becameReady = prev?.phase !== 'ready' && setup.phase === 'ready';
    return {
      claudeSetup: setup,
      ...(becameReady ? { setupGateDismissed: false, setupGateForced: false } : {}),
    };
  }),
  claudeSetupProgress: null,
  setClaudeSetupProgress: (p) => set({ claudeSetupProgress: p }),
  setupGateDismissed: false,
  setupGateForced: false,
  setSetupGate: (state) => set((s) => ({
    setupGateForced: state.forced ?? s.setupGateForced,
    setupGateDismissed: state.dismissed ?? s.setupGateDismissed,
  })),
  installClaudeSetup: async () => {
    try {
      const r = await fetch(`${API_BASE}/api/claude-setup/install`, { method: 'POST' });
      const data = await r.json() as { ok: boolean; progress?: ClaudeSetupProgress };
      if (data.progress) set({ claudeSetupProgress: data.progress });
    } catch {
      // WS 가 진행을 push 하므로 REST 실패는 무시한다(설치 자체는 서버에서 이미 시작됐을 수 있다).
    }
  },
  refreshClaudeSetup: async () => {
    try {
      const r = await fetch(`${API_BASE}/api/claude-setup/refresh`, { method: 'POST' });
      const data = await r.json() as ClaudeSetupState;
      if (data && typeof data.phase === 'string') get().applyClaudeSetup(data);
    } catch {
      // 서버 끊김 — 다음 스냅샷에서 따라온다.
    }
  },

  // §4 (첫 실행 온보딩) ③ — 프로젝트 폴더 게이트.
  projectGateForced: false,
  projectGateDismissed: false,
  projectGateReason: 'onboarding',
  setProjectGate: (state) => set((s) => ({
    projectGateForced: state.forced ?? s.projectGateForced,
    projectGateDismissed: state.dismissed ?? s.projectGateDismissed,
    projectGateReason: state.reason ?? s.projectGateReason,
  })),
  openProjectFolder: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/projects/open-folder`, { method: 'POST' });
      const data = await res.json() as { ok?: boolean; cancelled?: boolean; project?: { name: string } };
      if (!data.ok || !data.project) return false;
      // 스냅샷 broadcast 로 프로젝트가 등록된다 — 여기서는 그 탭을 활성으로 세우고(탭 전환의
      // 부수 효과까지 같이 타도록 `setActiveProject` 를 그대로 쓴다), 게이트가 열려 있었다면
      // 목적을 이뤘으니 닫는다(다음 스냅샷을 기다리지 않는다).
      get().setActiveProject(data.project.name);
      set({ projectGateForced: false, projectGateDismissed: false });
      return true;
    } catch {
      // 서버 연결 실패 — 게이트는 그대로 두어 사용자가 다시 시도할 수 있게 한다.
      return false;
    }
  },
  applySkillUsageCounts: (counts) => set({ skillUsageCounts: counts ?? {} }),
  applyAutoAgentSummaries: (summaries) => set({ autoAgentSummaries: summaries ?? {} }),
  applyAutoAgentRuns: (runs) => set({ autoAgentRuns: runs ?? {} }),
  // §5.5 #17-9 v3.51 — 서버가 매 스냅샷에 전량을 싣는다. 비면(=다 끝남) 빈 맵으로 교체 →
  //   활동바 아이콘/배지가 사라지고, 열려 있던 패널은 컴포넌트 쪽 가드가 닫는다.
  applyRunningSubagentTasks: (tasks) => set((s) => {
    const next = tasks ?? {};
    const prevKeys = Object.keys(s.runningSubagentTasks);
    if (prevKeys.length === 0 && Object.keys(next).length === 0) return {};
    return { runningSubagentTasks: next };
  }),
  // §5.5 #17-9 ⑦(b) — 도는 것과 같은 규약(서버가 매 스냅샷에 전량). 빈 스냅샷이 반복될 때만 no-op.
  applyFinishedSubagentTasks: (tasks) => set((s) => {
    const next = tasks ?? {};
    if (Object.keys(s.finishedSubagentTasks).length === 0 && Object.keys(next).length === 0) return {};
    return { finishedSubagentTasks: next };
  }),
  applyAgentReports: (reports) => set({ agentReports: reports ?? {} }),
  applyAgentMemos: (memos) => set({ agentMemos: memos ?? {} }),
  applyAgentQuestions: (questions) => set({ agentQuestions: questions ?? {} }),
  applyAgentReviews: (reviews) => set({ agentReviews: reviews ?? {} }),
  applyReviewRequests: (list) => set({ reviewRequests: list ?? [] }),
  applyAgentLists: (lists) => set({ agentLists: lists ?? {} }),
  applyAgentFeedbacks: (feedbacks) => set({ agentFeedbacks: feedbacks ?? {} }),
  // §5.5 #17-11 v3.79 — 서버가 매 스냅샷에 전량을 싣는다(삭제도 곧 사라짐으로 반영).
  applySessionLoops: (loops) => set({ sessionLoops: loops ?? {} }),
  // §5.5 #17-35 — 검증 이력도 서버가 매 스냅샷에 전량을 싣는다(삭제도 곧 사라짐으로 반영).
  applyVerificationRuns: (runs) => set({ verificationRuns: runs ?? {} }),
  applyVerificationDemos: (demos) => set({ verificationDemos: demos ?? {} }),
  createVerificationDemo: async (input) => {
    // §5.5 #17-29 — 시연은 그 버블에 명령을 실어 보내기 위한 재료다. 훅 버블에는 만들지 않는다.
    if (isReadOnlyHookAgent(get().agents.find((a) => a.id === input.agentId))) return 'read-only';
    try {
      const res = await fetch(`${API_BASE}/api/verification-demos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; demo?: VerificationDemo };
      if (!data.ok || !data.demo) return data.error ?? 'failed';
      return data.demo;
    } catch {
      return 'network';
    }
  },
  uploadVerificationDemoFrame: async (demoId, file, atMs) => {
    try {
      const fd = new FormData();
      fd.append('image', file);
      // multer 는 파일 뒤의 텍스트 필드를 문자열로 준다 — 서버가 Number() 로 되돌린다.
      fd.append('atMs', String(Math.max(0, Math.round(atMs))));
      const res = await fetch(`${API_BASE}/api/verification-demos/${encodeURIComponent(demoId)}/frames`, {
        method: 'POST',
        body: fd,
      });
      const data = (await res.json()) as { ok?: boolean };
      return data.ok === true;
    } catch {
      return false;
    }
  },
  deleteVerificationDemo: async (demoId) => {
    await fetch(`${API_BASE}/api/verification-demos/${encodeURIComponent(demoId)}`, { method: 'DELETE' }).catch(() => {});
  },
  startVerification: async (input) => {
    // §5.5 #17-29 — 검증은 그 탭 큐에 명령을 넣는 입력구다. 훅 버블에는 걸지 않는다
    //   (서버도 같은 술어로 거절 — 화면이 앞서가 "시작된 것처럼" 보이지 않게 여기서 먼저 끊는다).
    if (isReadOnlyHookAgent(get().agents.find((a) => a.id === input.agentId))) return { ok: false, error: 'read-only' };
    try {
      const res = await fetch(`${API_BASE}/api/verification-runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: input.agentId,
          subAgentId: input.subAgentId,
          ...(input.focus ? { focus: input.focus } : {}),
          ...(input.demoId ? { demoId: input.demoId } : {}),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; run?: { id?: string } };
      // 조용한 무동작 ❌ — 왜 안 됐는지를 호출자가 화면에 적을 수 있게 사유를 돌려준다.
      if (!data.ok || !data.run?.id) return { ok: false, error: data.error ?? 'failed' };
      return { ok: true, runId: data.run.id };
    } catch {
      return { ok: false, error: 'network' };
    }
  },
  stopVerification: async (runId) => {
    await fetch(`${API_BASE}/api/verification-runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' }).catch(() => {});
  },
  reworkVerification: async (runId) => {
    await fetch(`${API_BASE}/api/verification-runs/${encodeURIComponent(runId)}/rework`, { method: 'POST' }).catch(() => {});
  },
  deleteVerificationRun: async (runId) => {
    await fetch(`${API_BASE}/api/verification-runs/${encodeURIComponent(runId)}`, { method: 'DELETE' }).catch(() => {});
  },
  saveSessionLoop: async (input) => {
    // §5.5 #17-29 — 루프는 회차마다 큐에 명령을 넣는 또 하나의 입력구다. 훅 버블에는 걸지 않는다
    //   (서버도 같은 술어로 403 — 화면이 앞서가 "켜진 것처럼" 보이지 않게 여기서 먼저 끊는다).
    if (isReadOnlyHookAgent(get().agents.find((a) => a.id === input.agentId))) return;
    await fetch(`${API_BASE}/api/session-loop/${encodeURIComponent(input.agentId)}/${encodeURIComponent(input.subAgentId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: input.command,
        mode: input.mode,
        ...(input.mode === 'count' ? { total: input.total } : {}),
        intervalMs: input.intervalMs,
        stopOnError: input.stopOnError,
        contextMode: input.contextMode,
        maxCostUsd: input.maxCostUsd ?? 0,
        maxTokens: input.maxTokens ?? 0,
        maxDurationMs: input.maxDurationMs ?? 0,
        progressFile: input.progressFile ?? '',
        oneTaskPerRound: input.oneTaskPerRound,
        commitEachRound: input.commitEachRound,
        commandFile: input.commandFile ?? '',
        enabled: input.enabled,
      }),
    }).catch(() => {});
  },
  endSessionLoop: async (agentId, subAgentId, mode) => {
    await fetch(`${API_BASE}/api/session-loop/${encodeURIComponent(agentId)}/${encodeURIComponent(subAgentId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stopOnly: mode === 'stop' }),
    }).catch(() => {});
  },
  // §5.5 #17-17 v4.46 — 서버가 매 스냅샷에 전량을 싣는다(삭제도 곧 사라짐으로 반영).
  applySessionGoals: (goals) => set({ sessionGoals: goals ?? {} }),
  saveSessionGoal: async (input) => {
    await fetch(`${API_BASE}/api/session-goal/${encodeURIComponent(input.agentId)}/${encodeURIComponent(input.subAgentId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: input.text, ...(input.status ? { status: input.status } : {}) }),
    }).catch(() => {});
  },
  setSessionGoalProgress: async (input) => {
    await fetch(`${API_BASE}/api/session-goal/${encodeURIComponent(input.agentId)}/${encodeURIComponent(input.subAgentId)}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(input.percent !== undefined ? { percent: input.percent } : {}),
        ...(input.steps ? { steps: input.steps } : {}),
        ...(input.note ? { note: input.note } : {}),
        source: 'user',
      }),
    }).catch(() => {});
  },
  endSessionGoal: async (agentId, subAgentId) => {
    await fetch(`${API_BASE}/api/session-goal/${encodeURIComponent(agentId)}/${encodeURIComponent(subAgentId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {});
  },
  setFeedback: (input) => {
    fetch(`${API_BASE}/api/agent-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: input.agentId,
        ...(input.subAgentId ? { subAgentId: input.subAgentId } : {}),
        targetType: input.targetType,
        targetId: input.targetId,
        verdict: input.verdict,
        ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
        summary: input.summary,
      }),
    }).catch(() => {});
  },
  applyDiagnosticLog: (log) => {
    const arr = log ?? [];
    // 서버가 이미 ring buffer 로 trim 하지만, 클라에서도 동일 상한을 방어적으로 적용.
    set({ diagnosticLog: arr.length > DIAGNOSTIC_LOG_MAX ? arr.slice(arr.length - DIAGNOSTIC_LOG_MAX) : arr });
  },
  applyModelRegistry: (reg) => set({ modelRegistry: reg ?? null }),
  applyLocalLlm: (state) => set({ localLlm: state ?? null }),
  applyLocalEngineProgress: (p) => {
    const cur = get().localLlm;
    if (!cur) return;
    set({ localLlm: { ...cur, engine: { ...cur.engine, progress: p } } });
  },
  applyLocalModelProgress: (p) => {
    const cur = get().localLlm;
    if (!cur) return;
    const rest = cur.downloads.filter((d) => d.downloadId !== p.downloadId);
    set({ localLlm: { ...cur, downloads: [...rest, p] } });
  },
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

// IDE 텍스트 줌 다중 창 동기화 — 별창/메인이 각자 렌더러(독립 store)라, 한 창에서 Ctrl+휠로 바꾼 배율을
//   다른 창도 즉시 따라오도록 localStorage `storage` 이벤트로 반영(다른 탭/창에서의 변경만 발화).
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== IDE_TEXT_ZOOM_KEY) return;
    let z = 1;
    try { z = e.newValue ? (JSON.parse(e.newValue) as number) : 1; } catch { z = 1; }
    useGraphStore.setState({ ideTextZoom: clampIdeTextZoom(z) });
  });
}
