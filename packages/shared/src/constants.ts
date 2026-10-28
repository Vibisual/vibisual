import type { AgentProvider, AgentEngineKind, LocalEngineBackend, BubbleType, BubbleStyleConfig, EdgeStyleConfig, AgentRole, PipelineChildConfig, PipelineType, AgentConfig, AgentDefinition, TaskEdgeTemplate, TaskEdgeKind, UiLocale, AutoAgentRole, AutoAgentTemplate, ModelPricing, ModelFamily, KnownModelFamily, ModelRegistry, ModelRegistryEntry, AgentFeedback, StreamDensity, PluginContributionKind, SessionGoalStep, SessionGoalStepStatus, CommandDispatchMode, CommandErrorCode, RunRuntime, RunConfig, McpServerPreset, AgentMemoryScope, DebugAdapterSpec, ProblemMatch, ProblemSeverity, RetentionSettings, TokenSaverSettings, TokenSaverPreset, BackgroundTaskProbeSettings, SessionLivenessProbeSettings, ProcessGuardSettings, PreviewDevicePreset, ShelfIconName, ShelfItemKind, CostPeriod, CostTotals, CostPeriodTotals, AuditRiskKind, AuditBoundaryConfig, AuditCounts, PermissionChoice, PermissionCancelReason, StoryboardPresetId, StoryboardPreset, LocalModelCatalogSort, WorkspacePathKind, CmdPaneNode, BuiltinSlashCommand, SessionMemo, SessionMemoLink, SessionMemoLinkKind, SessionMemoLinkTarget, ContextScopeLevel, TidyBand, TidySort, TidyGeometry, VisualKindSurface, AppThemeFamily, AppThemeShade, AppThemeToken, FileFaceKind, FileFaceFamily, WebGroupSettings, WebOpenTarget, WebKind } from './types.js';
export type { ModelPricing, ModelFamily, KnownModelFamily, ModelRegistry, ModelRegistryEntry } from './types.js';
// 경로 대소문자 정책 SSOT — win32/darwin 만 접고 linux 는 접지 않는다(`pathCase.ts`).
import { normalizePathShape, pathKey, type PlatformName } from './pathCase.js';
// §2.1 #3 쓰기 축 — Bash 줄의 `target`(어느 파일을 고쳤나)을 그래프와 **같은 추출기**에서 뽑는다.
import { extractBashWritePaths, shellDialectOfTool } from './bashCommandPaths.js';
import { normalizeCodexToolPolicy } from './codexToolPolicy.js';
import { harnessBuilderPowershellBlocks } from './harnessBuilderApi.js';
import { AGENT_AUTH_POSIX, agentPowershellRequest, type AgentRuleShell } from './agentRuleShell.js';

// ─── UI 다국어 (i18n) ───

/** 지원 UI 로케일 목록 — 메뉴 표시 순서와 동일 (Claude 공식 언어 스위처 기준) */
export const SUPPORTED_UI_LOCALES: readonly UiLocale[] = [
  'en',
  'fr',
  'de',
  'hi',
  'id',
  'it',
  'ja',
  'ko',
  'pt-BR',
  'es-419',
  'es',
  'zh-CN',
] as const;

/** 로케일별 메타데이터 */
export const LOCALE_META: Record<UiLocale, { nativeName: string }> = {
  en: { nativeName: 'English' },
  fr: { nativeName: 'Français' },
  de: { nativeName: 'Deutsch' },
  hi: { nativeName: 'हिन्दी' },
  id: { nativeName: 'Indonesia' },
  it: { nativeName: 'Italiano' },
  ja: { nativeName: '日本語' },
  ko: { nativeName: '한국어' },
  'pt-BR': { nativeName: 'Português' },
  'es-419': { nativeName: 'Español (LatAm)' },
  es: { nativeName: 'Español' },
  'zh-CN': { nativeName: '中文' },
};

/** 기본 UI 언어 (미설정 체크포인트·첫 페인트 기준 — 영어 고정) */
export const DEFAULT_UI_LOCALE: UiLocale = 'en';

// ─── 네트워크 ───

export const DEFAULT_PORT = 4800;
export const WS_PATH = '/ws';
export const MAX_RECONNECT_ATTEMPTS = 10;
export const RECONNECT_BASE_DELAY = 1000;
export const WS_BATCH_INTERVAL = 16;

/**
 * 스트림 이벤트 전용 클라 반영 주기(ms, 스냅샷 16ms 와 별개). StreamRenderer 는 반영마다 버퍼 전체(최대 4000)를 다시 파싱해 16ms 면 프레임 예산을 넘긴다
 * — 묶어서 빈도를 ~3배 낮춘다(20Hz 도 라이브로 보인다).
 */
export const WS_STREAM_BATCH_INTERVAL = 50;

/** §9 — 부하 적응형 배치 창 상한(ms). 다음 창 = 직전 flush 실측 비용 × `WS_BATCH_BACKOFF_FACTOR`(이 값이 상한 — 폭주 중에도 4Hz). 폭주 땐 스냅샷 생성·반영이 16ms 를 넘겨 입력·렌더가 굶는다. */
export const WS_BATCH_INTERVAL_MAX = 250;

/**
 * 적응 배수 — 다음 배치 창 = clamp(기본주기, 직전 flush 비용 × 이 값, 상한).
 * 4 ⇒ 스냅샷 경로가 해당 스레드 시간의 ~1/5 이상을 점유하지 못한다.
 */
export const WS_BATCH_BACKOFF_FACTOR = 4;

/**
 * §9 — 훅 도구 이벤트 경로만 체크포인트 저장을 trailing 창으로 코얼레스한다(ms). 저장은 메인 스레드 동기(stringify+fsync)라 이벤트당 저장이면 앱이 언다.
 * 다른 저장은 즉시(#4 내구성), 종료 땐 process 'exit' 동기 flush.
 */
export const CHECKPOINT_BATCH_INTERVAL = 500;

/** 체크포인트 배치 창 상한(ms) — 폭주 중에도 0.2Hz 저장, 비정상 종료 때 잃는 그래프 상태를 5초 분량으로 묶는다. */
export const CHECKPOINT_BATCH_INTERVAL_MAX = 5000;

/**
 * §9 — 조용한 프로젝트도 이 주기(ms)마다 한 번은 무조건 재구축한다. 저장은 `mutationVersion` 이 바뀐 프로젝트만 하는데(실측 2026-08-19: 7탭 21.8ms → 1탭 3.8ms)
 * 인스턴스 밖 싱글턴(서브에이전트·카드류) 변경은 버전을 안 올린다. 키우면 그 반영이 늦어진다(종료 flush 는 전량).
 */
export const CHECKPOINT_QUIET_SWEEP_MS = 10_000;

// ─── 버블 스타일 Config 테이블 ───
// 새 BubbleType 추가 시 여기 한 줄만 추가하면 전체 반영

export const BUBBLE_STYLES: Record<BubbleType, BubbleStyleConfig> = {
  agent: {
    color: '#3B82F6',
    glow: '#93C5FD',
    icon: 'agent',
    ringIdle: 'border-blue-300',
    ringActive: 'border-blue-500 shadow-lg shadow-blue-500/30',
  },
  internal_folder: {
    color: '#F59E0B',
    glow: '#FCD34D',
    icon: 'folder',
    ringIdle: 'border-amber-300',
    ringActive: 'border-amber-500 shadow-lg shadow-amber-500/30',
  },
  external_folder: {
    color: '#10B981',
    glow: '#6EE7B7',
    icon: 'folder',
    ringIdle: 'border-emerald-300',
    ringActive: 'border-emerald-500 shadow-lg shadow-emerald-500/30',
  },
  file: {
    color: '#8B5CF6',
    glow: '#C4B5FD',
    icon: 'file',
    ringIdle: 'border-violet-300',
    ringActive: 'border-violet-500 shadow-lg shadow-violet-500/30',
  },
  bash: {
    color: '#1E293B',
    glow: '#475569',
    icon: 'terminal',
    ringIdle: 'border-slate-500',
    ringActive: 'border-slate-300 shadow-lg shadow-slate-400/30',
  },
  root: {
    color: '#C6C8D6',
    glow: '#E2E4EE',
    icon: 'root',
    ringIdle: 'border-gray-400',
    ringActive: 'border-gray-300 shadow-lg shadow-gray-300/30',
  },
  back: {
    color: '#475569',
    glow: '#94A3B8',
    icon: 'back',
    ringIdle: 'border-slate-400',
    ringActive: 'border-slate-300 shadow-lg shadow-slate-400/30',
  },
  ghost: {
    color: '#6B7280',
    glow: '#9CA3AF',
    icon: 'ghost',
    ringIdle: 'border-gray-500 border-dashed',
    ringActive: 'border-gray-400 border-dashed shadow-lg shadow-gray-400/20',
  },
  iframe: {
    color: '#0EA5E9',
    glow: '#7DD3FC',
    icon: 'iframe',
    ringIdle: 'border-sky-400',
    ringActive: 'border-sky-300 shadow-lg shadow-sky-400/30',
  },
  pipeline: {
    color: '#A855F7',
    glow: '#C084FC',
    icon: 'pipeline',
    ringIdle: 'border-purple-400',
    ringActive: 'border-purple-500 shadow-lg shadow-purple-500/30',
  },
  worktree: {
    color: '#84CC16',
    glow: '#BEF264',
    icon: 'folder',
    ringIdle: 'border-lime-300',
    ringActive: 'border-lime-500 shadow-lg shadow-lime-500/30',
  },
  // §5.3 #28 — 콘티모드 버블(커스텀 에이전트와 dashed inner edge 로 1:1 연결)
  conti: {
    color: '#059669',
    glow: '#6EE7B7',
    icon: 'conti',
    ringIdle: 'border-emerald-300 border-dashed',
    ringActive: 'border-emerald-500 border-dashed shadow-lg shadow-emerald-500/30',
  },
  // §5.3 #10-2 — Auto Agent(메타 에이전트). 커스텀 에이전트(#3B82F6)보다 어두운 다크블루.
  auto: {
    color: '#1E3A8A',
    glow: '#3B82F6',
    icon: 'auto',
    ringIdle: 'border-blue-900',
    ringActive: 'border-blue-700 shadow-lg shadow-blue-900/40',
  },
  // §5.10 — 커스텀 에이전트 휴지통 버블(홈 버블 위성). 스톤 그레이.
  trash: {
    color: '#57534E',
    glow: '#A8A29E',
    icon: 'trash',
    ringIdle: 'border-stone-400',
    ringActive: 'border-stone-300 shadow-lg shadow-stone-400/30',
  },
  // §5.13 — 영상 버블(그레이파이트 + 실버 엣지). 앱 버블(`apps/registry.tsx`)과 같은 색 한 벌이다.
  video: {
    color: '#2C3446',
    glow: '#A8B4CC',
    icon: 'video',
    ringIdle: 'border-slate-400',
    ringActive: 'border-slate-200 shadow-lg shadow-slate-300/30',
  },
  // §5.15 — 스펙 보드. 팔레트에서 emerald(외부 폴더)와 sky(iframe) 사이가 비어 있어 식별이 서고,
  //   "합의된 문서"라는 은유에 맞게 채도를 절제한 teal 로 간다.
  spec: {
    color: '#0D9488',
    glow: '#5EEAD4',
    icon: 'spec',
    ringIdle: 'border-teal-300',
    ringActive: 'border-teal-500 shadow-lg shadow-teal-500/30',
  },
  // §5.18 — 에이전트 랩. amber-500(내부 폴더)보다 붉고 rose 계열보다 따뜻한 자리라 캔버스에서
  //   바로 갈린다. "같은 과제를 여러 벌 태워 본다"는 은유에 맞는 온도.
  lab: {
    color: '#EA580C',
    glow: '#FDBA74',
    icon: 'lab',
    ringIdle: 'border-orange-300',
    ringActive: 'border-orange-500 shadow-lg shadow-orange-500/30',
  },
  shelf: {
    color: '#0891B2',
    glow: '#67E8F9',
    icon: 'shelf',
    ringIdle: 'border-cyan-300',
    ringActive: 'border-cyan-500 shadow-lg shadow-cyan-500/30',
  },
  // §5.23 도메인 버블 — iframe(sky-500)과 같은 계열이되 두 단계 어둡다.
  // 둘 다 "웹"이라 계열을 나누는 쪽이 오히려 읽히고, 명도로 갈린다.
  domain: {
    color: '#0369A1',
    glow: '#7DD3FC',
    icon: 'globe',
    ringIdle: 'border-sky-300',
    ringActive: 'border-sky-600 shadow-lg shadow-sky-600/30',
  },
  // §2.2 · §5.1 #2-1 (B) — 묶음 버블(화면 전용). 파일 보라와 갈리는 남회색 + 점선 테 — 파일 한 장으로 읽히지 않게.
  bundle: {
    color: '#3F3F66',
    glow: '#A5B4FC',
    icon: 'bundle',
    ringIdle: 'border-indigo-300/70 border-dashed',
    ringActive: 'border-indigo-300 border-dashed shadow-lg shadow-indigo-400/30',
  },
};

/**
 * §2.2 (C안) — Hook 에이전트(`customCreated=false`) 본체 색. Custom 파랑(#3B82F6) 계열에서 명도만 낮춘다 — `bubbleType` 은 'agent' 그대로,
 * `BubbleNode` 가 `!customCreated` 일 때만 바꾼다(새 BubbleType ❌). Auto(#1E3A8A)와는 별 아이콘·`Auto:` 라벨로 가른다. 활성 glow 는 Custom 파랑.
 */
export const HOOK_AGENT_STYLE: BubbleStyleConfig = {
  color: '#1E3A6B',
  glow: '#3B82F6',
  icon: 'agent',
  ringIdle: 'border-blue-900',
  ringActive: 'border-blue-700 shadow-lg shadow-blue-900/40',
};

/** 편의 접근자 — BUBBLE_STYLES[type].color */
export const BUBBLE_COLORS: Record<BubbleType, string> = Object.fromEntries(
  Object.entries(BUBBLE_STYLES).map(([k, v]) => [k, v.color]),
) as Record<BubbleType, string>;

// ─── 엣지 방향 (Read=파일→폴더→에이전트, Write=에이전트→폴더→파일) ───

/** Read 계열 도구 — 데이터가 파일→폴더→에이전트 방향으로 흐름 */
export const READ_TOOLS: ReadonlySet<string> = new Set(['Read', 'Grep', 'Glob']);

/** §5.24 — 쓰기로 확실한 도구(`READ_TOOLS` 짝, 히트 카운터용 — Bash 는 §2.1 #3 이 `Read`/`Write` 로 정규화해 온다). 표 밖(`manual` 등)은 세지 않는다. */
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
]);

// ─── 엣지 스타일 Config ───

export const EDGE_STYLE: EdgeStyleConfig = {
  activeOpacity: 'CC',
  inactiveColor: 'rgba(100,116,139,0.25)',
  activeWidth: 2.5,
  inactiveWidth: 1.5,
  ttl: 30_000,
};

// ─── 히스토리 ───

export const MAX_BASH_HISTORY = 50;
/** 파일 버블당 보관하는 diff 엔트리 상한(초과 시 오래된 것부터 drop). 노드별 `unlimitedFileEdits=true` 면 미적용(무한 저장) */
export const MAX_FILE_EDITS = 20;
/** §5.1 명령 앱 · §7.3 — 패널이 보이는 명령 수. 파일 수정 기록과 같은 `마지막 20개만 유지` 규칙이라 따로 수를 두지 않는다. `unlimitedCommandHistory` 면 전부(보관 상한과 별개). */
export const MAX_COMMAND_APP_HISTORY = MAX_FILE_EDITS;
/** Write diff 합성 시 old/new 본문 한 쪽당 최대 보관 길이(문자). 초과분은 잘라 표식 추가 — 스냅샷/메모리 폭증 방지 */
export const MAX_WRITE_DIFF_BYTES = 100_000;
/** §2.1 #3 — Bash diff 사전 스냅샷을 붙드는 `tool_use_id` 수 상한. 사후가 오면 곧 소비되니, 사후가 영영 안 올 때(중단·크래시)의 안전망이다(§3.2.4 F′축). */
export const BASH_WRITE_PENDING_MAX = 64;
/** §5.25 (F) — 코덱스 `apply_patch` 적용 전 덩어리(sub × 파일) 상한. `file_change` 완료·턴 시작 때 비워지니, 완료가 안 올 때의 안전망이다(F′축). */
export const CODEX_PATCH_PENDING_MAX = 64;

// ─── 보존 정책 (§3.2.3) ───
// 캡이 값 길이에만 있고 키 개수엔 없었다(실측 2026-08-13: 경로 키 597개, `fileEdits` 5.77MB) — 아래가 빠진 축(A 시간·D 병합창·E 키 개수).
// ⚠ 0 = 그 축 끔(무제한). 여기 값은 `DEFAULT_RETENTION_SETTINGS` 기본값일 뿐, 판정은 늘 사용자 설정값으로.

/**
 * 파일 편집 이력 보존 기간(일). 이보다 오래된 `FileEdit` 은 버린다.
 * 30 = Claude Code `cleanupPeriodDays` 기본값과 같은 값(업계 관행 정렬).
 */
export const FILE_EDIT_RETENTION_DAYS = 30;

/** 편집 이력을 든 파일 경로 키 수 상한(LRU — 마지막 편집이 오래된 경로부터). 파일당 항목 수 상한의 짝. */
export const MAX_FILE_EDIT_PATHS = 300;

/** 같은 파일 연속 편집을 마지막 항목에 합치는 창(ms) — 없으면 연달아 고치는 에이전트가 `MAX_FILE_EDITS`(20)를 한 턴에 채운다. */
export const FILE_EDIT_MERGE_WINDOW_MS = 10_000;

/** 세션당 완료 명령(사용자 말풍선) 상한. ⚠ 자르는 것이 다시 만들 수 없는 타이핑 원문이라 넉넉히 — 200 은 실측(2026-08-19) 232건 세션에서 모자랐다. */
export const COMPLETED_COMMAND_MAX_PER_SESSION = 1000;

/**
 * `sub-streams/<agentId>/<subId>.jsonl` 보존 기간(일). 부팅 시 1회 정리.
 * ⚠ **살아있는 서브에이전트의 파일은 나이와 무관하게 보존**한다(§3.2.3 — 화면에 떠 있는 대화를 지우지 않는다).
 */
export const SUB_STREAM_RETENTION_DAYS = 30;

/**
 * §3.2.3 — 스트림 컴팩션 때 앞부분을 옮겨 두는 보관 파일 꼬리(IDE 가 위쪽을 거슬러 읽는다). 파일명으로 접힌 세션 id 엔 점이 없어 겹치지 않는다.
 * 보존 정리는 주인 세션의 일부로 본다.
 */
export const SUB_STREAM_ARCHIVE_SUFFIX = '.archive.jsonl';

/** 첨부 보존 기간(일, 부팅 1회). ⚠ 고아(참조 0)에만 — 체크포인트 노드·완료 명령이 가리키면 나이와 무관하게 남긴다(mtime 만 보면 참조 중인 파일이 지워진다). */
export const ATTACHMENT_RETENTION_DAYS = 30;

/** 휴지통 보존(일, 0 = 영구). 만료가 없으면 정리해도 용량이 그대로, 유예가 없으면 못 되돌린다 — 14일. */
export const TRASH_RETENTION_DAYS = 14;

/** 프로젝트당 원장 상한(§3.2.3 B축, 밀린 몫은 `retired` 로 접힌다) — `auditEntryMaxPerProject` 기본값(0 = 무제한). 200 이어도 전선 몫 `AUDIT_SNAPSHOT_ENTRIES`(120)를 덮는다. */
export const AUDIT_ENTRIES_MAX_PER_PROJECT = 200;

/** §5.26 (H) A축 — 압축 마커·파일 사본 보존 일수(기본값). 담는 것이 바이트라 편집 이력(30일)보다 짧다. ⚠ 살아 있는 세션의 마커·참조되는 blob 은 무관하게 보존(§3.2.3 규칙 2·3). */
export const INSURANCE_RETENTION_DAYS = 14;

/** §5.26 (H) E축 — 프로젝트당 보험 저장고 바이트 예산(MB, 기본값). 넘치면 미러부터 LRU 로 버리고 마커는 남긴다(실측 2026-08-13: `.vibisual` 20곳 합 216MB). */
export const INSURANCE_VAULT_MAX_MB = 256;

/** §5.26 (H) B축 — 프로젝트당 압축 마커 상한. 밀려난 몫은 `retired` 로 접힌다. */
export const INSURANCE_MARKERS_MAX_PER_PROJECT = 100;

/** §5.26 (H) B축 — 프로젝트당 파일 사본 줄 상한. 밀려난 몫은 `retired` 로 접힌다. */
export const INSURANCE_PREIMAGES_MAX_PER_PROJECT = 500;

/** 정리 기록(`RetentionLogEntry`) 보관 상한 — 링버퍼. 값이 아니라 **개수**에 건 캡(§3.2.3 E축). */
export const RETENTION_LOG_MAX = 500;

/** 하루를 ms 로. 보존 기간 계산 공용. */
export const RETENTION_DAY_MS = 24 * 60 * 60 * 1000;

/** 보존 설정 기본값 — `AppState.retention` 이 없을 때(구버전) 이 값으로 판정한다. */
/** §5.5 #17-9 ⑭ — 표식 없이 조용한 작업을 묻는 판정의 예산. 대상이 드물어(실측 2026-09-01: 셸 17건 중 2건) 모델 호출을 쓸 수 있다 — ⚠ 항목마다 반복 호출하면 자기증식이다. */

/** 이만큼 출력이 없으면 조사 착수. **시간은 착수 조건일 뿐 판정 근거가 아니다**(§5.5 #17-9 ⑩). */
export const BG_TASK_QUIET_PROBE_MINUTES = 10;

/** 판정 1회의 제한 시간. 넘기면 판정 없음(= 항목은 그대로) — 실측 4~15초라 넉넉하다. */
export const BG_TASK_PROBE_TIMEOUT_MS = 90_000;

/** 증거로 싣는 출력 꼬리 바이트. 프롬프트를 부풀리지 않으면서 마지막 상황을 담는 선. */
export const BG_TASK_PROBE_TAIL_BYTES = 800;

/** 명령에서 뽑아 상태를 조회할 경로 개수 상한 — 글롭 하나가 수천 건을 훑지 않게. */
export const BG_TASK_PROBE_MAX_PATHS = 6;

/** 한 경로가 글롭일 때 세어 볼 파일 수 상한. 개수만 알면 되므로 더 볼 이유가 없다. */
export const BG_TASK_PROBE_GLOB_SCAN_MAX = 500;

/** 모델이 쓴 사유를 화면·저장에 남길 때의 길이 상한. */
export const BG_TASK_PROBE_REASON_MAX = 160;

/** 앱 전체 시간당 판정 상한 — 자기증식을 막는 마지막 벽(선례: anthropics/claude-code#55151). 넘치면 미룰 뿐 항목은 남는다. */
export const BG_TASK_PROBE_MAX_PER_HOUR = 12;

/** 동시에 도는 판정 수. 1 = 한 번에 하나 — 줄 세우면 상한과 함께 총량이 예측 가능해진다. */
export const BG_TASK_PROBE_CONCURRENCY = 1;

/**
 * 같은 항목을 다시 물어보기까지의 배수. `alive` 로 나온 항목은 조용한 시간이 이 배수만큼
 * 더 길어져야 다시 묻는다 — 그래야 몇 시간짜리 대기 하나가 판정을 반복해서 태우지 않는다.
 */
export const BG_TASK_PROBE_BACKOFF_FACTOR = 3;

/** 백오프 상한(조용 임계의 배수). 이 이상으로는 간격이 벌어지지 않는다. */
export const BG_TASK_PROBE_BACKOFF_MAX = 24;

/** 판정 기본 모델. 실측(2026-09-01) 5/5 정확 · 건당 $0.013 으로 sonnet($0.022)보다 싸고 같은 답을 냈다. */
export const BG_TASK_PROBE_MODEL = 'haiku';

/** 판정 설정 기본값 — `AppState.bgTaskProbe` 가 없을 때(구버전) 이 값으로 동작한다. */
export const DEFAULT_BG_TASK_PROBE_SETTINGS: BackgroundTaskProbeSettings = {
  enabled: true,
  quietMinutes: BG_TASK_QUIET_PROBE_MINUTES,
  autoClose: true,
  killProcess: true,
  model: BG_TASK_PROBE_MODEL,
};
// ─── §2.4 세션 생존 판정 ("실행중…"이 진짜인가) ───
// `isSessionRunning` 근거는 전부 자기 신고 깃발이라 이 축만 에이전트가 직접 답한다. 구조·예산은 §5.5 #17-9 ⑭ 를 따른다(두 벌 ❌).

/** 판정 주기 — 사용자 지정 값. 돌고 있다고 표시되는 세션을 이 간격으로 훑는다. */
export const SESSION_PROBE_INTERVAL_MS = 10 * 60 * 1000;

/**
 * 대화록이 이만큼 조용해야 판정 착수. **조용함은 판정 근거가 아니라 착수 조건일 뿐이다** —
 * 방금 출력한 세션은 답이 뻔하므로 묻지 않는다(토큰 절약이 유일한 목적).
 */
export const SESSION_PROBE_QUIET_MINUTES = 3;

/** 판정 1회의 제한 시간. 넘기면 판정 없음(= 세션 그대로). */
export const SESSION_PROBE_TIMEOUT_MS = 90_000;

/** 증거로 싣는 대화록 꼬리 바이트. 프롬프트를 부풀리지 않으면서 마지막 상황을 담는 선. */
export const SESSION_PROBE_TAIL_BYTES = 1_200;

/** 꼬리 창 — 뒤에서 거슬러 읽어 증거 줄(대화·코덱스 항목)이 이만큼 차면 멈춘다. 요약엔 끝 `SESSION_PROBE_TAIL_BYTES` 만. */
export const SESSION_PROBE_TAIL_WINDOW_BYTES = 256 * 1024;

/** 거슬러 읽는 전체 상한. CLI 2.1.300 부터 대화록에 요청마다 수백 KB 줄(시스템 프롬프트·도구 정의)이 있어 고정 창이면 그 줄로만 찬다. */
export const SESSION_PROBE_TAIL_SCAN_BYTES = 8 * 1024 * 1024;

/** 이보다 긴 줄은 머리만 보고 증거 줄(대화·코덱스 항목)이 아니면 담지 않는다 — 통째로 파싱하지 않는다. */
export const SESSION_PROBE_TAIL_BULK_LINE_BYTES = 64 * 1024;

/** 모델이 쓴 사유·대기 대상을 화면·저장에 남길 때의 길이 상한. */
export const SESSION_PROBE_REASON_MAX = 160;

/** 앱 전체 시간당 세션 판정 상한 — 자기증식을 막는 마지막 벽. 넘치면 미룰 뿐. */
export const SESSION_PROBE_MAX_PER_HOUR = 12;

/** 동시에 도는 세션 판정 수. 1 = 한 번에 하나 — 총량이 예측 가능해진다. */
export const SESSION_PROBE_CONCURRENCY = 1;

/**
 * 같은 세션을 다시 묻기까지의 배수. `working` 으로 나온 세션은 조용한 시간이 이 배수만큼 더
 * 길어져야 다시 묻는다 — 몇 시간짜리 정당한 작업 하나가 판정을 반복해서 태우지 않게.
 */
export const SESSION_PROBE_BACKOFF_FACTOR = 3;

/** 백오프 상한(조용 임계의 배수). */
export const SESSION_PROBE_BACKOFF_MAX = 24;

/** 판정 기본 모델 — 값싼 쪽. 질문을 쪼개 물으면 haiku 로 충분하다는 것이 ⑭ 의 실측 결과다. */
export const SESSION_PROBE_MODEL = 'haiku';

/** 판정 설정 기본값 — `AppState.sessionProbe` 가 없을 때(구버전) 이 값으로 동작한다. */
export const DEFAULT_SESSION_PROBE_SETTINGS: SessionLivenessProbeSettings = {
  enabled: true,
  quietMinutes: SESSION_PROBE_QUIET_MINUTES,
  autoClose: true,
  model: SESSION_PROBE_MODEL,
};

/** 설정 UI 입력 한계. `quietMinutes: 0` 은 "조용함과 무관하게 물음"이라 허용한다. */
export const SESSION_PROBE_LIMITS = { quietMinutes: { min: 0, max: 1440, step: 1 } } as const;

/** 판정에 쓸 수 있는 모델 별칭 — 목록 밖 값은 기본값으로(임의 문자열이 CLI 로 새지 않게). */
export const SESSION_PROBE_MODELS = ['haiku', 'sonnet', 'opus'] as const;

/** 들어온 세션 판정 설정을 안전한 값으로 정규화한다(서버·클라 공용). */
export function normalizeSessionProbeSettings(
  input?: Partial<SessionLivenessProbeSettings> | null,
): SessionLivenessProbeSettings {
  const out = { ...DEFAULT_SESSION_PROBE_SETTINGS };
  if (!input || typeof input !== 'object') return out;
  if (typeof input.enabled === 'boolean') out.enabled = input.enabled;
  if (typeof input.autoClose === 'boolean') out.autoClose = input.autoClose;
  if (typeof input.quietMinutes === 'number' && Number.isFinite(input.quietMinutes)) {
    const { min, max } = SESSION_PROBE_LIMITS.quietMinutes;
    out.quietMinutes = Math.min(max, Math.max(min, Math.floor(input.quietMinutes)));
  }
  if (typeof input.model === 'string' && (SESSION_PROBE_MODELS as readonly string[]).includes(input.model)) {
    out.model = input.model;
  }
  return out;
}

// ─── §5.3 #9-2 에이전트가 띄운 프로세스의 보호 (묶음 · 메모리 상한 · 정리) ───
// Claude Code 는 Windows 에서 bash.exe 만 끊어 자손이 고아로 남고(#76353) Node 묶음은 직계만 묶는다 — 손자까지 우리가 책임진다(실측 2026-10-12: grep 둘이 커밋 97GB).

/** 감시 주기. 평소 비용은 묶음·그룹 조회 몇 번이다(우리 것만 잰다). */
export const PROCESS_GUARD_TICK_MS = 15_000;

/** Windows 에서 묶음 없이(바인딩 실패) PowerShell 로 목록을 뜰 때의 주기 — 그 조회가 무겁다. */
export const PROCESS_GUARD_FALLBACK_TICK_MS = 60_000;

/** 프로세스 하나의 상한의 하한 — 정당한 큰 작업(언리얼 쿡·빌드)을 막지 않을 만큼 넉넉히. */
export const PROCESS_MEMORY_CAP_FLOOR_BYTES = 16 * 1024 ** 3;

/** 프로세스 하나의 상한 기본값 — 실메모리의 백분율. */
export const PROCESS_MEMORY_CAP_DEFAULT_PERCENT = 50;

/** 시스템 압박 바닥 — 여유가 전체의 이 비율 아래로 떨어지면 압박이다. */
export const MEMORY_PRESSURE_FLOOR_RATIO = 0.05;

/** 시스템 압박 바닥의 하한 — 작은 기계에서도 이만큼은 남긴다. */
export const MEMORY_PRESSURE_FLOOR_MIN_BYTES = 2 * 1024 ** 3;

/** 압박 때 끊을 후보의 최소 크기 — 작은 것을 끊어 봐야 여유가 돌아오지 않는다. */
export const PRESSURE_VICTIM_MIN_BYTES = 1024 ** 3;

/** 에이전트 본체(claude·codex)를 압박 후보로 삼는 최소 크기 — 본체를 끊으면 세션이 통째로 멈춘다. */
export const PRESSURE_ROOT_VICTIM_MIN_BYTES = 8 * 1024 ** 3;

/** 본체가 내려간 뒤 남은 자손을 정리하기까지의 유예 — 스스로 끝나는 중인 것을 기다린다. */
export const SESSION_END_REAP_GRACE_MS = 3_000;

/** 알림 줄의 머리. 하이픈이 칩 패턴(`[a-z0-9_]+`) 밖이라 표준·간결 밀도에서도 숨지 않는다. */
export const PROCESS_GUARD_NOTICE_TAG = '[process-guard]';

/** 보호 설정 기본값 — `AppState.processGuard` 가 없을 때(구버전) 이 값으로 동작한다. */
export const DEFAULT_PROCESS_GUARD_SETTINGS: ProcessGuardSettings = {
  enabled: true,
  memoryCapPercent: PROCESS_MEMORY_CAP_DEFAULT_PERCENT,
  pressureKill: true,
  reapOnSessionEnd: true,
};

/** 설정 UI 입력 한계. `memoryCapPercent: 0` 은 "상한 없음"이라 허용한다. */
export const PROCESS_GUARD_LIMITS = { memoryCapPercent: { min: 0, max: 100, step: 5 } } as const;

/** 들어온 보호 설정을 안전한 값으로 정규화한다(서버·클라 공용 — 판정이 두 벌이 되면 어긋난다). */
export function normalizeProcessGuardSettings(
  input?: Partial<ProcessGuardSettings> | null,
): ProcessGuardSettings {
  const out = { ...DEFAULT_PROCESS_GUARD_SETTINGS };
  if (!input || typeof input !== 'object') return out;
  if (typeof input.enabled === 'boolean') out.enabled = input.enabled;
  if (typeof input.pressureKill === 'boolean') out.pressureKill = input.pressureKill;
  if (typeof input.reapOnSessionEnd === 'boolean') out.reapOnSessionEnd = input.reapOnSessionEnd;
  if (typeof input.memoryCapPercent === 'number' && Number.isFinite(input.memoryCapPercent)) {
    const { min, max } = PROCESS_GUARD_LIMITS.memoryCapPercent;
    out.memoryCapPercent = Math.min(max, Math.max(min, Math.round(input.memoryCapPercent)));
  }
  return out;
}

export const DEFAULT_RETENTION_SETTINGS: RetentionSettings = {
  fileEditRetentionDays: FILE_EDIT_RETENTION_DAYS,
  maxFileEditPaths: MAX_FILE_EDIT_PATHS,
  fileEditMergeWindowMs: FILE_EDIT_MERGE_WINDOW_MS,
  completedCommandMaxPerSession: COMPLETED_COMMAND_MAX_PER_SESSION,
  subStreamRetentionDays: SUB_STREAM_RETENTION_DAYS,
  attachmentRetentionDays: ATTACHMENT_RETENTION_DAYS,
  auditEntryMaxPerProject: AUDIT_ENTRIES_MAX_PER_PROJECT,
  trashRetentionDays: TRASH_RETENTION_DAYS,
  insuranceRetentionDays: INSURANCE_RETENTION_DAYS,
  insuranceVaultMaxMB: INSURANCE_VAULT_MAX_MB,
  insuranceMirror: true,
};

/** `RETENTION_LIMITS` — 설정 UI 입력 한계. `min: 0` = 무제한이라 허용(§3.2.3). */
/**
 * 숫자 축만 골라낸 키 — 스위치(boolean) 축은 min/max/step 이 뜻을 갖지 않는다.
 * 이렇게 파생시켜야 새 축을 넣을 때 **컴파일러가 빠뜨림을 잡아 준다**(손으로 나열하면 조용히 샌다).
 */
export type NumericRetentionKey = {
  [K in keyof RetentionSettings]: RetentionSettings[K] extends number ? K : never;
}[keyof RetentionSettings];

export const RETENTION_LIMITS: Record<NumericRetentionKey, { min: number; max: number; step: number }> = {
  fileEditRetentionDays: { min: 0, max: 3650, step: 1 },
  maxFileEditPaths: { min: 0, max: 100_000, step: 10 },
  fileEditMergeWindowMs: { min: 0, max: 600_000, step: 1_000 },
  completedCommandMaxPerSession: { min: 0, max: 100_000, step: 10 },
  subStreamRetentionDays: { min: 0, max: 3650, step: 1 },
  attachmentRetentionDays: { min: 0, max: 3650, step: 1 },
  auditEntryMaxPerProject: { min: 0, max: 100_000, step: 50 },
  trashRetentionDays: { min: 0, max: 3650, step: 1 },
  insuranceRetentionDays: { min: 0, max: 3650, step: 1 },
  // 저장고 예산은 GB 단위로 올리는 일이 잦아 step 을 크게 잡는다(0 = 무제한 — §3.2.3).
  insuranceVaultMaxMB: { min: 0, max: 1_000_000, step: 64 },
};

/** §5.5 #17-9 ⑭(g) — 판정 설정의 입력 한계. `quietMinutes: 0` 은 "끔"이라 허용한다. */
export const BG_TASK_PROBE_LIMITS = { quietMinutes: { min: 0, max: 1440, step: 1 } } as const;

/** 판정에 쓸 수 있는 모델 별칭 — 목록 밖 값은 기본값으로 되돌린다(임의 문자열이 CLI 로 새지 않게). */
export const BG_TASK_PROBE_MODELS = ['haiku', 'sonnet', 'opus'] as const;

/**
 * 들어온 판정 설정을 안전한 값으로 정규화한다(서버·클라 공용 — 판정이 두 벌이 되면 어긋난다).
 * 모르는 값·범위 밖·목록 밖 모델은 전부 기본값으로 되돌린다.
 */
export function normalizeBgTaskProbeSettings(
  input?: Partial<BackgroundTaskProbeSettings> | null,
): BackgroundTaskProbeSettings {
  const out = { ...DEFAULT_BG_TASK_PROBE_SETTINGS };
  if (!input || typeof input !== 'object') return out;
  if (typeof input.enabled === 'boolean') out.enabled = input.enabled;
  if (typeof input.autoClose === 'boolean') out.autoClose = input.autoClose;
  if (typeof input.killProcess === 'boolean') out.killProcess = input.killProcess;
  if (typeof input.quietMinutes === 'number' && Number.isFinite(input.quietMinutes)) {
    const { min, max } = BG_TASK_PROBE_LIMITS.quietMinutes;
    out.quietMinutes = Math.min(max, Math.max(min, Math.floor(input.quietMinutes)));
  }
  if (typeof input.model === 'string' && (BG_TASK_PROBE_MODELS as readonly string[]).includes(input.model)) {
    out.model = input.model;
  }
  return out;
}

/**
 * 들어온 보존 설정을 안전한 값으로 정규화한다(서버·클라 공용 — 판정이 두 벌이 되면 어긋난다).
 * 숫자가 아니거나 범위를 벗어나면 기본값/경계로 되돌린다.
 */
export function normalizeRetentionSettings(input?: Partial<RetentionSettings> | null): RetentionSettings {
  const out = { ...DEFAULT_RETENTION_SETTINGS };
  if (!input || typeof input !== 'object') return out;
  for (const key of Object.keys(RETENTION_LIMITS) as NumericRetentionKey[]) {
    const raw = input[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const { min, max } = RETENTION_LIMITS[key];
    out[key] = Math.min(max, Math.max(min, Math.floor(raw)));
  }
  // 스위치 축은 범위가 아니라 참/거짓이다 — 값이 안 왔으면 기본값을 그대로 둔다(끔으로 넘겨짚지 않는다).
  if (typeof input.insuranceMirror === 'boolean') out.insuranceMirror = input.insuranceMirror;
  return out;
}

/**
 * 보존 기간 판정 한 곳 — `0`(무제한)을 여기서만 해석한다.
 * 여러 곳에서 `days > 0 && age > days*DAY` 를 각자 쓰면 한 곳이 빠졌을 때 조용히 무제한이 된다.
 */
export function isExpiredByDays(timestampMs: number, days: number, now: number = Date.now()): boolean {
  if (!Number.isFinite(days) || days <= 0) return false; // 0 = 무제한
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return false; // 시각 미상은 건드리지 않는다
  return now - timestampMs > days * RETENTION_DAY_MS;
}

// ─── 토큰 절약 (§5.3 #9-1 · 토큰 축 J~P) ───

/** §5.3 #9-1 (P축) — 켠(0 아닌) 턴 예산의 하한. 압축 자체가 큰 요청이라 너무 자주 부르면 오히려 더 쓴다. */
export const TOKEN_SAVER_TURN_BUDGET_FLOOR = 40;

/**
 * §5.3 #9-1 (K축) — 생성 상한의 **하한**. 0(끔)이 아닌 값은 이 아래로 못 내려간다.
 * 너무 낮게 잡으면 답이 문장 중간에서 잘려 같은 일을 다시 시키게 된다(= 절약이 아니다).
 */
export const TOKEN_SAVER_OUTPUT_FLOOR = 1024;

/** 전 축이 꺼진 기본값 — `AppState.tokenSaver` 가 없을 때(구버전) 이 값으로 판정한다. */
export const DEFAULT_TOKEN_SAVER_SETTINGS: TokenSaverSettings = {
  preset: 'off',
  bashMaxOutputChars: 0,
  mcpMaxOutputTokens: 0,
  maxOutputTokens: 0,
  maxThinkingTokens: 0,
  autoCompactPct: 0,
  disableNonEssentialModelCalls: false,
  autoCompactWindow: '',
  maxConcurrentAgents: 0,
  spawnStaggerMs: 0,
  sessionTurnBudget: 0,
};

/** `NumericRetentionKey` 와 같은 수법 — 숫자 축만 파생(빠뜨림을 컴파일러가 잡는다). */
export type NumericTokenSaverKey = {
  [K in keyof TokenSaverSettings]: TokenSaverSettings[K] extends number ? K : never;
}[keyof TokenSaverSettings];

/** 설정 UI 가 쓰는 입력 한계. `min: 0` 은 전부 "그 축 끄기"라 허용한다. */
export const TOKEN_SAVER_LIMITS: Record<NumericTokenSaverKey, { min: number; max: number; step: number }> = {
  // CLI 상한이 150,000자다(그 위는 CLI 가 자른다) — 그보다 크게 받을 이유가 없다.
  bashMaxOutputChars: { min: 0, max: 150_000, step: 1_000 },
  mcpMaxOutputTokens: { min: 0, max: 200_000, step: 1_000 },
  maxOutputTokens: { min: 0, max: 64_000, step: 1_000 },
  maxThinkingTokens: { min: 0, max: 64_000, step: 1_000 },
  // CLI 가 받는 값이 1~100 이고 **기본보다 낮추는 쪽만** 실제로 먹는다.
  autoCompactPct: { min: 0, max: 100, step: 5 },
  maxConcurrentAgents: { min: 0, max: 64, step: 1 },
  spawnStaggerMs: { min: 0, max: 60_000, step: 500 },
  sessionTurnBudget: { min: 0, max: 2_000, step: 10 },
};

/** §5.3 #9-1 프리셋 — 값을 채우는 손일 뿐 판정은 값으로. `off` = 기능 전과 바이트 단위로 같은 env · `balanced` = 문맥 증가만 늦춤 · `saver` = 생성 상한·조기 압축까지(긴 답이 잘릴 수 있다). */
export const TOKEN_SAVER_PRESET_VALUES: Record<Exclude<TokenSaverPreset, 'custom'>, TokenSaverSettings> = {
  off: { ...DEFAULT_TOKEN_SAVER_SETTINGS, preset: 'off' },
  balanced: {
    preset: 'balanced',
    bashMaxOutputChars: 20_000,
    mcpMaxOutputTokens: 10_000,
    maxOutputTokens: 0,
    maxThinkingTokens: 0,
    autoCompactPct: 0,
    disableNonEssentialModelCalls: true,
    // 실측: 400k → 200k 로 내리면 3일치 입력이 2,815M → 2,048M (-27%).
    autoCompactWindow: '200000',
    maxConcurrentAgents: 4,
    spawnStaggerMs: 1_500,
    sessionTurnBudget: 200,
  },
  saver: {
    preset: 'saver',
    bashMaxOutputChars: 8_000,
    mcpMaxOutputTokens: 4_000,
    maxOutputTokens: 8_000,
    maxThinkingTokens: 4_000,
    autoCompactPct: 60,
    disableNonEssentialModelCalls: true,
    // 실측: 100k 면 1,143M (-59%). 대신 압축이 거의 매 턴 걸리므로 그 비용을 감수하는 자리다.
    autoCompactWindow: '100000',
    maxConcurrentAgents: 2,
    spawnStaggerMs: 3_000,
    sessionTurnBudget: 80,
  },
};

/** 값 → 프리셋 역판정. 어느 벌과도 값이 다르면 `custom`(프리셋을 지어내지 않는다). */
export function detectTokenSaverPreset(input: TokenSaverSettings): TokenSaverPreset {
  for (const name of ['off', 'balanced', 'saver'] as const) {
    const preset = TOKEN_SAVER_PRESET_VALUES[name];
    const same = (Object.keys(TOKEN_SAVER_LIMITS) as NumericTokenSaverKey[]).every((k) => input[k] === preset[k])
      && input.disableNonEssentialModelCalls === preset.disableNonEssentialModelCalls
      && input.autoCompactWindow === preset.autoCompactWindow;
    if (same) return name;
  }
  return 'custom';
}

/** `normalizeTokenSaverSettings` 설명 — 절약 설정 정규화(서버·클라 공용). 켠 값은 `TOKEN_SAVER_TURN_BUDGET_FLOOR`·`TOKEN_SAVER_OUTPUT_FLOOR` 아래로 못 간다. `preset` 은 값에서 다시 판정한다. */
/**
 * §5.3 #9-1 (Q축) — 압축 창 최종 값: 3층(에이전트 → 설정 창 → 내장) 결과에 절약을 조이는 쪽으로만 얹는다(작은 창이 이긴다). 절약 `''` = 3층 그대로,
 * 3층이 꺼짐이면 절약이 켜고, `'auto'` 면 숫자가 이긴다. 명령 사이 압축만 본다 — 스폰은 `--autocompact` 를 싣지 않아 작업 도중 CLI 압축선은 모델 창 끝이다.
 */
export function resolveEffectiveAutoCompact(
  agentValue: string | undefined,
  userDefaultValue: string | undefined,
  saverWindow?: string,
): string {
  const base = resolveAutoCompact(agentValue, userDefaultValue);
  const saver = saverWindow?.trim();
  if (!saver || saver === 'off' || !AVAILABLE_AUTOCOMPACT_VALUES.includes(saver)) return base;
  if (!isAutoCompactOn(base)) return saver;      // 꺼져 있던 자리를 절약이 켠다
  if (base === 'auto') return saver;             // 숫자가 'auto' 보다 조인다
  if (saver === 'auto') return base;             // 절약이 'auto' 면 조이는 값이 아니다
  const a = Number(base), b = Number(saver);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return base;
  return b < a ? saver : base;                   // 더 작은 창이 이긴다
}

export function normalizeTokenSaverSettings(input?: Partial<TokenSaverSettings> | null): TokenSaverSettings {
  const out: TokenSaverSettings = { ...DEFAULT_TOKEN_SAVER_SETTINGS };
  if (input && typeof input === 'object') {
    for (const key of Object.keys(TOKEN_SAVER_LIMITS) as NumericTokenSaverKey[]) {
      const raw = input[key];
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      const { min, max } = TOKEN_SAVER_LIMITS[key];
      out[key] = Math.min(max, Math.max(min, Math.floor(raw)));
    }
    if (typeof input.disableNonEssentialModelCalls === 'boolean') {
      out.disableNonEssentialModelCalls = input.disableNonEssentialModelCalls;
    }
    // (Q) CLI 가 받는 눈금 밖이면 '' 로 되돌린다 — 목록 밖 값은 `--autocompact` 파싱에서
    //     즉시 종료를 부르고, 그러면 그 에이전트가 영영 못 뜬다(실측 2.1.252).
    if (typeof input.autoCompactWindow === 'string') {
      const v = input.autoCompactWindow.trim();
      out.autoCompactWindow = (v && v !== 'off' && AVAILABLE_AUTOCOMPACT_VALUES.includes(v)) ? v : '';
    }
  }
  if (out.sessionTurnBudget > 0) out.sessionTurnBudget = Math.max(TOKEN_SAVER_TURN_BUDGET_FLOOR, out.sessionTurnBudget);
  if (out.maxOutputTokens > 0) out.maxOutputTokens = Math.max(TOKEN_SAVER_OUTPUT_FLOOR, out.maxOutputTokens);
  if (out.maxThinkingTokens > 0) out.maxThinkingTokens = Math.max(TOKEN_SAVER_OUTPUT_FLOOR, out.maxThinkingTokens);
  out.preset = detectTokenSaverPreset(out);
  return out;
}

/** §5.3 #9-1 — 에이전트 값 → 전역 값 → 미설정. 에이전트 `0`/미설정 = 전역을 따른다(`bashDefaultTimeoutMs` 규약) — 조일 수는 있어도 풀 수는 없다. 결과 `0` 이면 env 키를 만들지 않는다. */
export function resolveTokenSaverNumber(agentValue: number | undefined, globalValue: number): number {
  if (typeof agentValue === 'number' && Number.isFinite(agentValue) && agentValue > 0) return Math.floor(agentValue);
  return globalValue;
}

/**
 * §5.3 #9-1 (J~M) — 절약 축 → 스폰 env. ⚠ 켜지 않은 축은 키를 넣지 않는다(전부 꺼지면 기능 전과 바이트 단위로 같다).
 * `DISABLE_NON_ESSENTIAL_MODEL_CALLS` 는 값을 보므로 끌 때 키를 뺀다(빈 문자열은 판본에 따라 참).
 */
export function buildTokenSaverEnv(
  agent: {
    bashMaxOutputChars?: number;
    mcpMaxOutputTokens?: number;
    maxOutputTokens?: number;
    maxThinkingTokens?: number;
    autoCompactPct?: number;
    disableNonEssentialModelCalls?: boolean;
  } | undefined,
  global: TokenSaverSettings = DEFAULT_TOKEN_SAVER_SETTINGS,
): Record<string, string> {
  const env: Record<string, string> = {};
  const bash = resolveTokenSaverNumber(agent?.bashMaxOutputChars, global.bashMaxOutputChars);
  if (bash > 0) env['BASH_MAX_OUTPUT_LENGTH'] = String(Math.min(TOKEN_SAVER_LIMITS.bashMaxOutputChars.max, bash));
  const mcp = resolveTokenSaverNumber(agent?.mcpMaxOutputTokens, global.mcpMaxOutputTokens);
  if (mcp > 0) env['MAX_MCP_OUTPUT_TOKENS'] = String(mcp);
  const out = resolveTokenSaverNumber(agent?.maxOutputTokens, global.maxOutputTokens);
  if (out > 0) env['CLAUDE_CODE_MAX_OUTPUT_TOKENS'] = String(Math.max(TOKEN_SAVER_OUTPUT_FLOOR, out));
  const think = resolveTokenSaverNumber(agent?.maxThinkingTokens, global.maxThinkingTokens);
  if (think > 0) env['MAX_THINKING_TOKENS'] = String(Math.max(TOKEN_SAVER_OUTPUT_FLOOR, think));
  const pct = resolveTokenSaverNumber(agent?.autoCompactPct, global.autoCompactPct);
  if (pct > 0) env['CLAUDE_AUTOCOMPACT_PCT_OVERRIDE'] = String(Math.min(100, pct));
  // 스위치도 숫자 축과 같은 방향이다 — 에이전트는 **더 끌 수만** 있고 전역이 끈 것을 되살리지 못한다.
  const noExtra = agent?.disableNonEssentialModelCalls === true || global.disableNonEssentialModelCalls;
  if (noExtra) env['DISABLE_NON_ESSENTIAL_MODEL_CALLS'] = '1';
  return env;
}

// ─── 런타임 메모리 자정작용 (§3.2.4) ───
// 실측 2026-08-14: 10.9시간 가동 메인 3,050MB — 개수로 묶은 세션 캐시가 26MB·4KB 를 같은 칸으로 세 같은 파일을 일곱 번 넘게 다시 읽었다. 0 = 그 축 끔.

/**
 * 세션 JSONL 파생 캐시 전체가 함께 쓰는 바이트 예산. ⚠ 기준은 가장 큰 파일이 아니라 작업 집합(스냅샷 한 바퀴의 세션 전체) — 작으면 LRU 스래싱으로 적중률 0
 * (실측 2026-08-16: 48MB 로 도구 이벤트마다 832MB 재파싱). 파생 상태라 트랜스크립트보다 작고, 밀려날 때 재파싱 피크가 4~5배라 넉넉한 쪽이 최대 점유가 낮다. 상한은 I축.
 */
export const SESSION_CACHE_BYTE_BUDGET = 256 * 1024 * 1024;

/** 같은 캐시의 항목 수 보조 상한(먼저 걸리는 쪽이 이긴다). ⚠ 캐시마다 몫으로 쪼개져(최소 8%) 작업 집합보다 넉넉해야 한다 — 512 는 개수만으로 스래싱했다. */
export const SESSION_CACHE_MAX_ENTRIES = 4096;

/** JSONL 을 훑을 때 한 번에 올리는 바이트(§3.2.4 G축). 통째 버퍼+`toString()`+`split` 은 피크가 파일의 4~5배 — 청크로 읽어도 결과는 같다. */
export const JSONL_SCAN_CHUNK_BYTES = 1024 * 1024;

/** 세션·에이전트 id 키 파생 Map 의 키 수 상한(§3.2.4 F축 경량판 — 값엔 캡이 있어도 키엔 없던 자리). 1,000 은 화면에 영향이 없는 선. */
export const SESSION_KEYED_MAP_MAX = 1_000;

/** 힙 표본 주기(ms) — §3.2.4 H축. 너무 잦으면 그 자체가 부하라 30초. */
export const MEMORY_SAMPLE_INTERVAL_MS = 30_000;

/** 진단 화면이 추이를 그릴 수 있게 보관하는 표본 개수(30초 × 120 = 1시간). */
export const MEMORY_SAMPLE_HISTORY = 120;

/**
 * 힙 사용률(`heapUsed / heap_size_limit`)이 이 값을 넘으면 캐시를 **절반** 버린다(§3.2.4 I축).
 * 0.75 = V8 이 노후 공간을 크게 늘리기 시작하는 지점보다 앞 — 늘어난 뒤에 버리면 이미 늦다.
 */
export const MEMORY_PRESSURE_HIGH_RATIO = 0.75;

/** 이 값을 넘으면 등록된 캐시를 **전부** 버린다. OOM 직전의 마지막 자정작용. */
export const MEMORY_PRESSURE_CRITICAL_RATIO = 0.88;

/** 고압(HIGH) 상태에서 한 번에 버리는 비율. */
export const MEMORY_PRESSURE_EVICT_FRACTION = 0.5;

/** 압력 대응 재실행 최소 간격(ms) — 축출 직후엔 GC 전이라 `heapUsed` 가 그대로라, 없으면 매번 캐시를 비워 재파싱이 는다. */
export const MEMORY_PRESSURE_COOLDOWN_MS = 120_000;

// ─── IDE 워크스페이스 탐색기 (§5.5 #17-19) ───

/** 한 겹에서 넘기는 엔트리 상한(`node_modules` 가 사이드바를 얼리지 않게). 넘치면 자르고 `truncated`(가상화 ❌). */
export const WORKSPACE_DIR_ENTRY_MAX = 500;

// ─── IDE 내장 편집창 (§5.5 #17-27) ───

/**
 * 편집창이 통째로 읽어 들이는 파일 크기 상한(bytes).
 * 넘으면 앞부분만 담아 **읽기 전용**으로 열고 잘렸다는 사실을 그 자리에 적는다 —
 * 잘린 본문을 저장하면 원본 뒷부분이 사라지기 때문이다.
 */
export const WORKSPACE_FILE_MAX_BYTES = 2_000_000;

/**
 * 편집창에 동시에 열어 두는 탭 상한.
 * 넘으면 **저장할 것이 없는(= 안 고친) 가장 오래된 탭**부터 밀어낸다(고치던 파일은 밀리지 않는다).
 */
export const IDE_EDITOR_MAX_TABS = 12;

/** §5.5 #17-27 ⑯ — 편집창이 접어 두는 세션 수 상한(키 개수 캡). 넘치면 가장 오래전에 떠난 세션부터 버린다. */
export const IDE_EDITOR_TAB_SCOPE_MAX = 12;

/** 편집창 폭(px) — 기본값과 드래그 허용 범위. */
export const IDE_EDITOR_WIDTH = { DEFAULT: 520, MIN: 280, MAX: 1400 } as const;

// ─── §5.5 #17-27 ⑭ · #17-25 ④-1 — 편집창이 그림으로 여는 파일 ───

/** 편집창이 그림으로 여는 확장자(소문자·마침표 포함). 스니핑 없이 확장자로 — 틀려도 "안 그려짐"뿐. */
export const WORKSPACE_IMAGE_EXTENSIONS: readonly string[] = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.avif',
  '.ico',
  // §5.1 #2-1 (G) ⑦ — 브라우저가 그대로 푸는 이름만 다른 형식(JPEG 의 다른 확장자 · 움직이는 PNG).
  '.jfif',
  '.jpe',
  '.apng',
];

/** §5.5 #17-25 ④-1 — 주석을 구워 덮어쓸 수 있는 확장자 = `canvas.toBlob` 이 실제로 인코딩하는 것만(나머지는 조용히 PNG 가 돼 확장자와 내용이 어긋난다). */
export const WORKSPACE_IMAGE_BAKEABLE_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg', '.webp'];

/** 미리보기 이미지 상한(bytes). 텍스트 상한과 따로 — 읽기 전용이라 위험이 없고 4K 스크린샷은 예사로 5MB 다. */
export const WORKSPACE_IMAGE_MAX_BYTES = 32_000_000;

/** 확장자 → MIME. 미리보기 응답의 `Content-Type` 과 굽기 대상 형식이 같은 표를 본다. */
export const WORKSPACE_IMAGE_MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.jfif': 'image/jpeg',
  '.jpe': 'image/jpeg',
  '.apng': 'image/apng',
};

/** 경로에서 소문자 확장자를 뽑는다(마침표 포함, 없으면 빈 문자열). 구분자는 `/`·`\` 둘 다. */
export function workspaceFileExt(filePath: string): string {
  const name = filePath.split(/[/\\]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

/** 그림으로 열 수 있는 확장자인가. */
export function isWorkspaceImagePath(filePath: string): boolean {
  return WORKSPACE_IMAGE_EXTENSIONS.includes(workspaceFileExt(filePath));
}

/** 주석본을 **같은 형식으로 구워** 덮어쓸 수 있는가(§5.5 #17-25 ④-1). */
export function isWorkspaceImageBakeable(filePath: string): boolean {
  return WORKSPACE_IMAGE_BAKEABLE_EXTENSIONS.includes(workspaceFileExt(filePath));
}

/** 확장자에 맞는 MIME. 표에 없으면 `application/octet-stream`. */
export function workspaceImageMime(filePath: string): string {
  return WORKSPACE_IMAGE_MIME_BY_EXT[workspaceFileExt(filePath)] ?? 'application/octet-stream';
}

// ─── §5.13 (R) — 워크스페이스 파일 하나를 무엇으로 여는가 ───
// 클릭 지점마다 판정하면 같은 파일이 다르게 열린다 — 갈림은 아래 함수 하나. 확장자→앱 표는 코어가 들지 않고 앱 선언을 인자로 받는다(§5.13 (R-1)·(P)).

/** 파일·폴더 하나를 눌렀을 때 갈리는 일곱 갈래. */
export type WorkspaceOpenAction =
  /** 내장 텍스트 편집창(§5.5 #17-27 ②). */
  | 'editor'
  /** 내장 그림 미리보기(⑭). */
  | 'image'
  /** 내장 PDF 뷰어(Chromium 이 싣고 다니는 것을 그대로 쓴다). */
  | 'pdf'
  /** 내부 앱 창(§5.13 — 영상·음악·3D). */
  | 'app'
  /** 변환한 뒤 내부 앱 창((R-8) — 우리 엔진이 못 읽는 영상·소리). */
  | 'convert'
  /** 실행 세션(⑬ (h)). */
  | 'run'
  /** OS 연결 프로그램(⑬ (i) · §5.13 (R-6)). */
  | 'external'
  /** 시스템 탐색기 — 폴더. */
  | 'folder';

/** 앱이 스스로 선언하는 "내가 여는 확장자"(소문자, 마침표 포함). */
export interface WorkspaceOpenAppClaim {
  readonly appId: string;
  readonly opens: readonly string[];
}

/** 어디로 보낼지 + (앱이면) 어느 앱인지. */
export interface WorkspaceOpenPlan {
  readonly action: WorkspaceOpenAction;
  /** `action === 'app'` 일 때만 있다. */
  readonly appId?: string;
  /** `action === 'convert'` 일 때 — 변환 결과가 영상인지 소리인지((R-8)). */
  readonly convertTo?: MediaConvertKind;
}

/** 내장 PDF 뷰어가 받는 확장자. */
export const WORKSPACE_PDF_EXTENSIONS: readonly string[] = ['.pdf'];

/** OS 연결 프로그램으로 넘기는 확장자(§5.13 (R-6)) — 우리가 흉내 내지 않는 것(압축·폰트 등). **`.ts` 는 없다** — 영상 컨테이너보다 TypeScript 다. */
export const WORKSPACE_EXTERNAL_EXTENSIONS: readonly string[] = [
  // 압축·패키지
  '.zip', '.7z', '.rar', '.tar', '.gz', '.tgz', '.bz2', '.tbz2', '.xz', '.txz', '.zst', '.lz', '.lz4', '.lzma',
  '.cab', '.iso', '.dmg', '.deb', '.rpm', '.apk', '.jar', '.war', '.whl', '.nupkg', '.msix', '.msi', '.pkg', '.xpi', '.crx', '.zipx',
  // 폰트
  '.ttf', '.otf', '.ttc', '.woff', '.woff2', '.eot', '.fon', '.fnt',
  // 오피스·전자책 — 우리가 그리지 않는 문서
  '.doc', '.docx', '.docm', '.odt', '.rtf', '.hwp', '.hwpx', '.pages', '.wpd', '.wps', '.msg',
  '.xls', '.xlsx', '.xlsm', '.ods', '.numbers', '.ppt', '.pptx', '.pptm', '.odp', '.key',
  '.epub', '.mobi', '.azw3', '.djvu', '.xps', '.one',
  // 데이터·DB
  '.db', '.sqlite', '.sqlite3', '.mdb', '.accdb', '.parquet', '.pdb', '.dbf',
  // 영상·소리는 여기 없다 — (R-8) 이 가져갔다(변환하면 우리 안에서 열리므로).
  //   단 **mid·midi 만 예외**로 남는다: 악보라서 변환으로도 소리가 되지 않는다(신시사이저가 필요).
  '.mid', '.midi',
  // 디자인 원본·우리가 안 그리는 이미지
  '.psd', '.psb', '.ai', '.eps', '.tif', '.tiff', '.heic', '.heif', '.raw', '.cr2', '.cr3', '.nef', '.arw',
  '.dng', '.orf', '.rw2', '.xcf', '.sketch', '.fig', '.dds', '.tga', '.exr', '.hdr',
  // 엔진·3D 저작 원본(뷰어가 못 읽는 것)
  '.uasset', '.umap', '.ubulk', '.uexp', '.blend', '.max', '.ma', '.mb', '.c4d', '.bank', '.upk',
  // 바로가기
  '.lnk', '.appref-ms', '.jnlp',
];

/** 미디어 스트리밍 응답의 Content-Type. 표에 없으면 application/octet-stream. */
export const WORKSPACE_MEDIA_MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/opus',
  '.weba': 'audio/webm',
  // §5.1 #2-1 (G) ⑦ — mp4 소리의 다른 이름(오디오북 · 벨소리). 엔진이 m4a 와 똑같이 푼다.
  '.m4b': 'audio/mp4',
  '.m4r': 'audio/mp4',
  '.pdf': 'application/pdf',
  '.glb': 'model/gltf-binary',
  // §5.1 #2-1 (G) ⑦ — VRM 은 glb 그릇이다(같은 로더가 읽는다).
  '.vrm': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.obj': 'text/plain',
  '.mtl': 'text/plain',
  '.stl': 'application/octet-stream',
  '.ply': 'application/octet-stream',
  '.fbx': 'application/octet-stream',
  '.dae': 'model/vnd.collada+xml',
  '.3mf': 'model/3mf',
  // §5.4 #36 (F) — 그림 결과도 이 창구로 받는다(앱 위성 화면·그림 앱). blob 의 타입이 이 값이라 SVG 는 맞아야 그려진다.
  //   표는 그림 창구의 것 한 벌을 그대로 펼친다(두 벌이면 한쪽만 고쳐진다).
  ...WORKSPACE_IMAGE_MIME_BY_EXT,
};

/** 편집 결과를 프로젝트에 쓸 때의 상한(bytes) — 쓰기는 본문이 통째로 메모리를 지난다(읽기는 구간 요청이라 무제한). WAV 한 시간분이 든다. */
export const WORKSPACE_MEDIA_MAX_BYTES = 768_000_000;

/** 확장자에 맞는 미디어 MIME. */
export function workspaceMediaMime(filePath: string): string {
  return WORKSPACE_MEDIA_MIME_BY_EXT[workspaceFileExt(filePath)] ?? 'application/octet-stream';
}

/** §5.13 40-1 — `vibproxy://proxy/api/workspace-media` 가 낼 수 있는 파일 = 미디어 표의 형식만. 같은 출처 프리뷰 페이지도 닿으므로 코드·설정·키는 내지 않는다. 화면도 이 표로 가른다. */
export function isWorkspaceMediaFile(filePath: string): boolean {
  return Object.prototype.hasOwnProperty.call(WORKSPACE_MEDIA_MIME_BY_EXT, workspaceFileExt(filePath));
}

// ─── §5.13 (R-8) — 못 읽는 영상·소리는 변환해서 우리 안에서 연다 ───
// Chromium 은 시스템 코덱을 안 써 코덱팩은 소용없다(실측 `.avi` → `DEMUXER_ERROR_COULD_NOT_OPEN`) — ffmpeg 리먹스(`-c copy`)가 먼저(실측 25MB 0.073초).

/** 변환해야 열리는 컨테이너(데먹서가 빠진 것). mkv 는 동봉 ffmpeg 로 그냥 열려 없다(실측). */
export const WORKSPACE_CONVERT_VIDEO_EXTENSIONS: readonly string[] = [
  '.avi', '.divx', '.wmv', '.asf', '.flv', '.f4v', '.mpg', '.mpeg', '.mpe', '.m2v',
  '.m2ts', '.vob', '.rm', '.rmvb', '.mxf', '.ogm',
  // **.ts·.mts 는 일부러 없다** — MPEG 전송 스트림이기도 하지만 이 저장소에서는 TypeScript 다.
  //   영상 하나를 살리려고 소스 파일 전부를 변환기로 보낼 수는 없다(테스트가 이 자리를 지킨다).
];

/** 변환하면 음악 편집기가 여는 형식(WAV 로 뽑는다). mid·midi 는 없다 — 악보라 신시사이저가 필요하다. */
export const WORKSPACE_CONVERT_AUDIO_EXTENSIONS: readonly string[] = [
  '.wma', '.aiff', '.aif', '.au', '.ape', '.amr', '.dsf', '.dff', '.ra', '.mka', '.wv', '.tta', '.mpc',
];

/** 변환 결과가 어느 앱으로 가는가. */
export type MediaConvertKind = 'video' | 'audio';

/** 변환 산출물이 놓이는 폴더(프로젝트 루트 기준). 지워도 안전한 파생물이다. */
export const MEDIA_CACHE_DIR = '.vibisual/media-cache';

/** 문자열 → 32비트 해시(FNV-1a). 캐시 이름을 만드는 데만 쓰므로 암호학적 강도가 필요 없다. */
function mediaHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** §5.13 (R-8) (d) — 변환 결과 자리. 키에 크기·수정 시각이 들어 원본이 바뀌면 캐시가 저절로 빗나간다. */
export function mediaCacheRelPath(
  relPath: string,
  size: number,
  mtimeMs: number,
  kind: MediaConvertKind,
): string {
  const name = relPath.replace(/\\/g, '/').split('/').filter((p) => p.length > 0).pop() ?? 'media';
  const base = (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name)
    // 파일 이름에 쓸 수 없는 글자만 걷어낸다(한글·공백은 그대로 둔다 — 사람이 찾을 수 있어야 한다).
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 60);
  const key = mediaHash(`${relPath.replace(/\\/g, '/')}|${size}|${Math.round(mtimeMs)}`);
  return `${MEDIA_CACHE_DIR}/${base}-${key}${kind === 'video' ? '.mp4' : '.wav'}`;
}

/**
 * §5.13 (R-1) — 클릭 지점 전부의 유일한 갈림길. 순서에 뜻이 있다: ① 실행(macOS `.app` 은 폴더이기도 해 먼저) ② 폴더 ③ 앱이 선언한 확장자
 * ④ 그림·PDF(`.svg` 는 편집창) ⑤ 연결 프로그램 ⑥ 나머지는 편집창(모르는 확장자는 텍스트일 가능성이 가장 크다).
 */
export function resolveWorkspaceOpen(args: {
  readonly relPath: string;
  readonly kind: WorkspacePathKind;
  readonly executable?: boolean;
  readonly apps?: readonly WorkspaceOpenAppClaim[];
}): WorkspaceOpenPlan {
  if (args.executable === true) return { action: 'run' };
  if (args.kind === 'directory') return { action: 'folder' };

  const ext = workspaceFileExt(args.relPath);
  for (const claim of args.apps ?? []) {
    if (claim.opens.includes(ext)) return { action: 'app', appId: claim.appId };
  }
  if (ext !== '.svg' && WORKSPACE_IMAGE_EXTENSIONS.includes(ext)) return { action: 'image' };
  if (WORKSPACE_PDF_EXTENSIONS.includes(ext)) return { action: 'pdf' };
  // (R-8) — 변환하면 우리 안에서 열리는 것들. 연결 프로그램보다 먼저 본다.
  if (WORKSPACE_CONVERT_VIDEO_EXTENSIONS.includes(ext)) return { action: 'convert', convertTo: 'video' };
  if (WORKSPACE_CONVERT_AUDIO_EXTENSIONS.includes(ext)) return { action: 'convert', convertTo: 'audio' };
  if (WORKSPACE_EXTERNAL_EXTENSIONS.includes(ext)) return { action: 'external' };
  return { action: 'editor' };
}

// ─── 위성(satellite) 상한 ───

/** 폴더당 표시 위성 기본 상한. 폴더 노드에 maxSatellites 가 없으면 이 값 사용. */
export const DEFAULT_MAX_SATELLITES = 2;
/** 사용자가 패널에서 폴더별 Max 를 편집할 때 허용 범위(클램프 경계). */
export const SATELLITE_MAX_BOUNDS = { MIN: 1, MAX: 50 } as const;

// ─── 외부 폴더 표시 규약 (§2.1 — 요약 · 예산 · 접기 · 이름) ───

/** 외부 노드 키 표식(`<워크트리 접두>__ext__<절대경로>`). 서버 `EXT_KEY_MARK` 와 §5.1 #2-1 (B) `kindBundle.ts` 가 이 값 하나로 조립·해체한다. */
export const EXTERNAL_NODE_KEY_MARK = '__ext__';

/** (A) 접합 버블이 보이는 자손 이름 칩 수(라벨이 경로뿐이라 안을 말해 준다). 넘치면 `+N`. */
export const EXTERNAL_SUMMARY_CHIPS = 3;

/** (B) 최상위 외부 폴더 예산 기본값 — 개수는 이 값, 무엇이 보일지는 활동이 정한다. 핀(`preservePinned`)은 세지 않는다. */
export const EXTERNAL_TOP_BUDGET_DEFAULT = 12;

/** (B) 사용자가 옵션창에서 예산을 조절할 때의 허용 범위(클램프 경계). */
export const EXTERNAL_TOP_BUDGET_BOUNDS = { MIN: 1, MAX: 40 } as const;

/** (B) 한 부모에서 꺼낼 자식 수 — 없으면 같은 성격의 형제들이 예산을 다 먹어 접합 트리가 무너진다. 남은 예산은 다른 가지로 간다(여러 자리를 넓게). */
export const EXTERNAL_PROMOTION_PER_PARENT = 3;

/**
 * (B) 승격 점수의 최근성 **반감기**. 이 시간이 지날 때마다 같은 접촉 횟수의 무게가 절반이 된다.
 * 계단이 아니라 연속 감쇠라 경계에서 순위가 튀지 않는다(튀면 같은 폴더가 나타났다 사라진다).
 */
export const EXTERNAL_PROMOTION_HALF_LIFE_MS = 30 * 60 * 1000;

/**
 * (C) 살아 있을 수 있는 `external_folder` 총량. 넘치면 **가장 식은 것부터** 걷는다.
 * 핀·활성 에이전트 참조가 있는 폴더는 대상이 아니다(§2.4 TTL 소멸과 같은 성격).
 */
export const EXTERNAL_FOLDER_MAX = 60;

/** (D) 알려진 자리 사전의 한 줄. 화면 문구가 아니라 **i18n 키**를 돌려주기 위한 표다. */
export interface ExternalPlacePattern {
  /** i18n 키 접미사 — 화면 문구는 클라이언트가 `canvas.externalPlace.<key>` 로 고른다. */
  readonly key: string;
  /** 어느 기준 경로에 상대인가. `any` 는 절대경로 전체에서 찾는다. */
  readonly base: 'home' | 'temp' | 'any';
  /** 기준 경로로부터의 상대 경로(또는 `any` 면 절대경로)에 대한 판정. */
  readonly test: RegExp;
}

/** (D) 알려진 자리 사전 — slug·UUID 대신 자리 이름을 라벨로(경로·노드 키는 그대로). 순서가 우선순위. 이 표가 정본이다 — 코드에 자리 이름을 박지 않는다(§3.3). */
export const EXTERNAL_PLACE_PATTERNS: readonly ExternalPlacePattern[] = [
  { key: 'claudeMemory', base: 'home', test: /^\.claude\/projects\/[^/]+\/memory$/ },
  { key: 'claudeProject', base: 'home', test: /^\.claude\/projects\/[^/]+$/ },
  { key: 'claudeProjects', base: 'home', test: /^\.claude\/projects$/ },
  { key: 'claudeSkills', base: 'home', test: /^\.claude\/skills(\/.*)?$/ },
  { key: 'claudeAgents', base: 'home', test: /^\.claude\/agents(\/.*)?$/ },
  { key: 'claudeCache', base: 'home', test: /^\.claude\/cache(\/.*)?$/ },
  { key: 'claudeHome', base: 'home', test: /^\.claude$/ },
  { key: 'codexHome', base: 'home', test: /^\.codex(\/.*)?$/ },
  { key: 'vibisualRules', base: 'home', test: /^\.vibisual\/rules(\/.*)?$/ },
  // 자동 목표의 절차 저장고(`.vibisual/skills`)는 **프로젝트 밑**이라 여기 오지 않는다 — 이 표의
  // 기준은 홈·임시·절대경로뿐이다. 폐기된 홈 `\.vibisual/brain` 자리는 §5.5 ⑲ 에서 뺐다.
  { key: 'vibisualHome', base: 'home', test: /^\.vibisual$/ },
  { key: 'claudeTemp', base: 'temp', test: /^claude(\/.*)?$/ },
  { key: 'tempRoot', base: 'temp', test: /^$/ },
  // `any` — 홈·임시 기준으로는 못 잡는 자리(설치 위치·앱 로그는 OS 마다 경로가 다르다).
  { key: 'appLogs', base: 'any', test: /\/@vibisual\/desktop\/logs$/ },
  { key: 'appInstall', base: 'any', test: /\/(programs\/vibisual|vibisual\.app|opt\/vibisual)(\/.*)?$/i },
];

// ─── 폴더 목록 지연 로딩 (§7.5) ───

/** `GET /api/folder-files` 한 쪽 크기 — 바닥에 닿으면 다음 장. 통째 재귀는 홈 폴더가 61만 항목·83MB 라 창이 멈춘다(§7.5). */
export const FOLDER_FILES_PAGE_SIZE = 100;

/**
 * 클라이언트가 `limit` 을 직접 줄 때 서버가 잘라 내는 상한.
 * 한 번의 요청이 페이지 개념을 무력화하고 통째 열거로 되돌아가는 것을 막는다.
 */
export const FOLDER_FILES_PAGE_MAX = 500;

// ─── 도메인 버블 상한 (§5.23) ───

/** 도메인 버블당 쌓이는 항목 기본 상한. 노드에 `maxWebEntries` 가 없으면 이 값. */
export const DEFAULT_MAX_WEB_ENTRIES = 20;
/** 사용자가 패널에서 도메인별 최대 개수를 편집할 때 허용 범위(클램프 경계). */
export const WEB_ENTRY_MAX_BOUNDS = { MIN: 1, MAX: 100 } as const;
/** 한 항목이 들고 있는 문자열(결과 요약·물음·검색어) 한 칸의 상한 — §3.2.3 C축. */
export const WEB_ENTRY_TEXT_MAX = 2000;
/** 한 검색 항목이 기억하는 결과 호스트 수 상한 — 칩이 줄을 넘기지 않게. */
export const WEB_ENTRY_RESULT_HOSTS_MAX = 8;
/**
 * `WebSearch` 를 모으는 의사 호스트. 검색은 특정 사이트를 부르는 일이 아니라 호스트가 없다 —
 * 결과에 나온 도메인으로 버블을 만들면 캔버스가 검색 결과 목록이 된다(§5.23).
 */
export const WEB_SEARCH_HOST = 'web-search';
/** 도메인 노드 키의 표식 — `__web__<host>`. 키 조립·해체가 한 자리에서 나오게 한다. */
export const WEB_KEY_MARK = '__web__';
/** 도메인 버블을 만드는 도구들. 이 집합 밖은 이 축이 보지 않는다. */
export const WEB_TOOLS: ReadonlySet<string> = new Set(['WebFetch', 'WebSearch']);

// ─── 웹 버블 묶기 (§5.23) ───

/** 묶기 기본값(같은 사이트·비슷한 종류·에이전트마다 6개) — 기본 켬(안 묶으면 버블이 너무 많다). 끄면 호스트마다 하나. */
export const WEB_GROUP_DEFAULTS: Readonly<WebGroupSettings> = { sameSite: true, byKind: true, maxPerAgent: 6 };
/** 묶지 않음 — 그래프 엔진의 씨앗. 앱 기본값은 부팅 때 밀어 넣는다(엔진 시험이 앱 기본값에 끌려가지 않게). */
export const WEB_GROUP_OFF: Readonly<WebGroupSettings> = { sameSite: false, byKind: false, maxPerAgent: 0 };
/** (C) 에이전트마다 따로 세울 웹 버블 수의 범위. `0` = 상한 없음, `1` = 에이전트마다 하나. */
export const WEB_GROUP_MAX_BOUNDS = { MIN: 0, MAX: 40 } as const;

// ─── 웹 버블 더블클릭 (§5.23 「더블클릭」) ───

/** 더블클릭이 고를 수 있는 열 곳 — 옵션창 고르기 칸이 이 순서로 그린다. */
export const WEB_OPEN_TARGETS: readonly WebOpenTarget[] = ['external', 'iframe'];
/** 기본 선택은 바깥 브라우저다. */
export const WEB_OPEN_TARGET_DEFAULT: WebOpenTarget = 'external';
/** 도메인 버블이 여는 iframe 탭의 id 접두 — `web-<버블 id>`. 버블마다 탭 하나(다시 누르면 같은 탭이 옮겨 간다). */
export const WEB_PAGE_TAB_PREFIX = 'web-';
/**
 * 인터넷 페이지 격리 웹뷰 partition. `persist:` ❌ — 쿠키·저장소가 메모리에만 산다. 기본 세션(`vibproxy://`·전부 허락 권한 처리기)과 갈라 두는 것이 격리의 핵심.
 * 렌더러 `<webview partition>`·main `will-attach-webview` 가 같이 쓴다.
 */
export const WEB_PAGE_PARTITION = 'vibisual-web';

/** (A) 끝 두 칸이 사이트가 아닌 접미사(`co.uk`·`github.io` 류) — 한 칸 더 붙여 사이트로 본다. 호스팅을 빼면 남남의 `*.github.io` 가 한 버블에 묶인다. */
export const WEB_SITE_SUFFIXES: ReadonlySet<string> = new Set([
  // 나라별 두 칸 접미사
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk', 'ltd.uk', 'plc.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au',
  'co.nz', 'org.nz', 'net.nz', 'ac.nz', 'govt.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'gr.jp', 'ed.jp', 'lg.jp',
  'co.kr', 'or.kr', 'ne.kr', 'go.kr', 'ac.kr', 're.kr', 'pe.kr', 'hs.kr', 'sc.kr', 'es.kr', 'ms.kr', 'kg.kr',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'com.tw', 'org.tw', 'net.tw', 'edu.tw', 'gov.tw', 'idv.tw',
  'com.hk', 'org.hk', 'net.hk', 'edu.hk', 'gov.hk',
  'com.sg', 'org.sg', 'net.sg', 'edu.sg', 'gov.sg',
  'co.in', 'net.in', 'org.in', 'ac.in', 'gov.in', 'firm.in', 'gen.in', 'ind.in',
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
  'com.mx', 'org.mx', 'gob.mx', 'edu.mx', 'net.mx',
  'com.ar', 'org.ar', 'gob.ar', 'net.ar',
  'co.za', 'org.za', 'gov.za', 'ac.za', 'net.za',
  'com.tr', 'org.tr', 'gov.tr', 'edu.tr', 'net.tr',
  'co.id', 'or.id', 'ac.id', 'go.id', 'web.id', 'my.id',
  'com.my', 'org.my', 'net.my', 'edu.my', 'gov.my',
  'com.ph', 'org.ph', 'net.ph', 'gov.ph', 'edu.ph',
  'com.vn', 'net.vn', 'org.vn', 'edu.vn', 'gov.vn',
  'co.th', 'or.th', 'ac.th', 'go.th', 'in.th',
  'co.il', 'org.il', 'ac.il', 'gov.il',
  'com.sa', 'com.eg', 'com.pk', 'com.ng', 'com.ua', 'com.co', 'com.pe', 'com.uy', 'com.ec', 'co.ke', 'com.bd',
  // 칸마다 주인이 다른 호스팅
  'github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com',
  'herokuapp.com', 'readthedocs.io', 'blogspot.com', 'azurewebsites.net', 'azurestaticapps.net', 'cloudfront.net',
  'appspot.com', 'glitch.me', 'surge.sh', 'fly.dev', 'onrender.com', 'deno.dev', 'replit.app', 'repl.co',
  'ngrok.io', 'ngrok-free.app', 'csb.app', 'stackblitz.io', 'gitbook.io', 'notion.site', 'neocities.org',
]);

/** (B) 종류의 정본 순서 — 같은 크기의 묶음은 이 순서로 선다(스냅샷마다 흔들리지 않게). */
export const WEB_KINDS: readonly WebKind[] = ['search', 'docs', 'code', 'package', 'qa', 'spec', 'article', 'video'];

/**
 * (B) **호스트 그대로**의 종류 — 같은 사이트 안에서도 하는 일이 다른 호스트(`pkg.go.dev` 는 패키지, `go.dev` 는
 * 문서)와 검색 엔진처럼 **사이트로 넓히면 틀리는** 것만 둔다(`cloud.google.com` 은 검색이 아니다).
 */
export const WEB_KIND_HOSTS: Readonly<Record<string, WebKind>> = {
  'google.com': 'search', 'www.google.com': 'search', 'bing.com': 'search', 'www.bing.com': 'search',
  'duckduckgo.com': 'search', 'html.duckduckgo.com': 'search', 'lite.duckduckgo.com': 'search',
  'search.brave.com': 'search', 'kagi.com': 'search', 'search.yahoo.com': 'search', 'search.naver.com': 'search',
  'www.baidu.com': 'search', 'yandex.com': 'search', 'perplexity.ai': 'search', 'www.perplexity.ai': 'search',
  'www.ecosia.org': 'search', 'www.startpage.com': 'search', 'startpage.com': 'search',
  'pkg.go.dev': 'package', 'cdnjs.cloudflare.com': 'package', 'repo.maven.apache.org': 'package',
  'search.maven.org': 'package', 'central.sonatype.com': 'package',
  'news.ycombinator.com': 'qa', 'groups.google.com': 'qa',
  'html.spec.whatwg.org': 'spec', 'datatracker.ietf.org': 'spec',
};

/** (B) 하위 도메인 머리의 종류(`docs.`·`blog.`, `www` 는 건너뜀). 모호한 머리(`api.`·`code.`·`dev.`)는 일부러 뺐다 — `code.claude.com` 은 문서다(경로 판정이 맡는다). */
export const WEB_KIND_SUBDOMAINS: Readonly<Record<string, WebKind>> = {
  docs: 'docs', doc: 'docs', developer: 'docs', developers: 'docs', learn: 'docs', reference: 'docs',
  manual: 'docs', guide: 'docs', guides: 'docs', documentation: 'docs', devdocs: 'docs', help: 'docs',
  support: 'docs', wiki: 'docs', kb: 'docs', tutorial: 'docs', tutorials: 'docs',
  blog: 'article', blogs: 'article', news: 'article', engineering: 'article', press: 'article',
  forum: 'qa', forums: 'qa', discuss: 'qa', discussion: 'qa', discourse: 'qa', community: 'qa', answers: 'qa',
  ask: 'qa', bugs: 'qa', issues: 'qa', bugzilla: 'qa', tracker: 'qa',
  spec: 'spec', specs: 'spec', standards: 'spec', drafts: 'spec',
  git: 'code', gitlab: 'code', raw: 'code', gist: 'code', svn: 'code', hg: 'code',
  registry: 'package', pkg: 'package', packages: 'package', repo: 'package',
  video: 'video', videos: 'video',
};

/**
 * (B) **사이트(와 그 위 접미사)**의 종류 — 사이트 전체가 한 가지 일을 하는 곳. 사이트에서 시작해 접미사로
 * 올라가며 찾는다(`x.readthedocs.io` → `readthedocs.io`).
 */
export const WEB_KIND_SITES: Readonly<Record<string, WebKind>> = {
  // 코드 저장소·놀이터
  'github.com': 'code', 'githubusercontent.com': 'code', 'gitlab.com': 'code', 'bitbucket.org': 'code',
  'codeberg.org': 'code', 'sourceforge.net': 'code', 'sourcegraph.com': 'code', 'googlesource.com': 'code',
  'sr.ht': 'code', 'gitee.com': 'code', 'gitea.com': 'code', 'launchpad.net': 'code', 'codepen.io': 'code',
  'jsfiddle.net': 'code', 'codesandbox.io': 'code', 'stackblitz.com': 'code', 'replit.com': 'code',
  'glitch.com': 'code', 'huggingface.co': 'code',
  // 패키지
  'npmjs.com': 'package', 'npmjs.org': 'package', 'yarnpkg.com': 'package', 'pypi.org': 'package',
  'crates.io': 'package', 'rubygems.org': 'package', 'packagist.org': 'package', 'nuget.org': 'package',
  'mvnrepository.com': 'package', 'maven.org': 'package', 'jsdelivr.com': 'package', 'jsdelivr.net': 'package',
  'unpkg.com': 'package', 'bundlephobia.com': 'package', 'packagephobia.com': 'package', 'libraries.io': 'package',
  'deno.land': 'package', 'jsr.io': 'package', 'hex.pm': 'package', 'pub.dev': 'package', 'cocoapods.org': 'package',
  'anaconda.org': 'package', 'conda-forge.org': 'package', 'chocolatey.org': 'package', 'brew.sh': 'package',
  'snapcraft.io': 'package', 'flathub.org': 'package', 'socket.dev': 'package', 'npmtrends.com': 'package',
  'skypack.dev': 'package', 'esm.sh': 'package', 'cdnjs.com': 'package',
  // 질문·토론
  'stackoverflow.com': 'qa', 'stackexchange.com': 'qa', 'superuser.com': 'qa', 'serverfault.com': 'qa',
  'askubuntu.com': 'qa', 'mathoverflow.net': 'qa', 'reddit.com': 'qa', 'redd.it': 'qa', 'quora.com': 'qa',
  'lobste.rs': 'qa',
  // 표준·명세
  'w3.org': 'spec', 'whatwg.org': 'spec', 'tc39.es': 'spec', 'ietf.org': 'spec', 'rfc-editor.org': 'spec',
  'ecma-international.org': 'spec', 'unicode.org': 'spec', 'iso.org': 'spec', 'khronos.org': 'spec',
  'json-schema.org': 'spec', 'semver.org': 'spec', 'commonmark.org': 'spec', 'csswg.org': 'spec',
  'webassembly.org': 'spec', 'opengroup.org': 'spec', 'iana.org': 'spec', 'chromestatus.com': 'spec',
  'caniuse.com': 'spec',
  // 글·위키·논문
  'wikipedia.org': 'article', 'wikimedia.org': 'article', 'wikiwand.com': 'article', 'medium.com': 'article',
  'dev.to': 'article', 'substack.com': 'article', 'hashnode.com': 'article', 'hashnode.dev': 'article',
  'velog.io': 'article', 'tistory.com': 'article', 'brunch.co.kr': 'article', 'zenn.dev': 'article',
  'qiita.com': 'article', 'note.com': 'article', 'freecodecamp.org': 'article', 'smashingmagazine.com': 'article',
  'css-tricks.com': 'article', 'infoq.com': 'article', 'thenewstack.io': 'article', 'hackernoon.com': 'article',
  'baeldung.com': 'article', 'geeksforgeeks.org': 'article', 'arxiv.org': 'article', 'acm.org': 'article',
  'ieee.org': 'article', 'techcrunch.com': 'article', 'theverge.com': 'article', 'arstechnica.com': 'article',
  // 영상
  'youtube.com': 'video', 'youtu.be': 'video', 'vimeo.com': 'video', 'twitch.tv': 'video', 'bilibili.com': 'video',
  'loom.com': 'video',
  // 문서
  'readthedocs.io': 'docs', 'readthedocs.org': 'docs', 'gitbook.io': 'docs', 'github.io': 'docs', 'devdocs.io': 'docs',
  'docs.rs': 'docs', 'go.dev': 'docs', 'nodejs.org': 'docs', 'nodejs.dev': 'docs', 'python.org': 'docs',
  'react.dev': 'docs', 'reactjs.org': 'docs', 'vuejs.org': 'docs', 'angular.dev': 'docs', 'angular.io': 'docs',
  'svelte.dev': 'docs', 'nextjs.org': 'docs', 'vitejs.dev': 'docs', 'vite.dev': 'docs', 'vitest.dev': 'docs',
  'webpack.js.org': 'docs', 'rollupjs.org': 'docs', 'typescriptlang.org': 'docs', 'electronjs.org': 'docs',
  'electron.build': 'docs', 'tailwindcss.com': 'docs', 'web.dev': 'docs', 'v8.dev': 'docs', 'chromium.org': 'docs',
  'webkit.org': 'docs', 'rust-lang.org': 'docs', 'cppreference.com': 'docs', 'cplusplus.com': 'docs',
  'man7.org': 'docs', 'gnu.org': 'docs', 'ss64.com': 'docs', 'w3schools.com': 'docs', 'tutorialspoint.com': 'docs',
  'javatpoint.com': 'docs', 'swift.org': 'docs', 'kotlinlang.org': 'docs', 'dart.dev': 'docs', 'flutter.dev': 'docs',
  'php.net': 'docs', 'ruby-lang.org': 'docs', 'postgresql.org': 'docs', 'sqlite.org': 'docs', 'redis.io': 'docs',
  'kubernetes.io': 'docs', 'nginx.org': 'docs', 'expressjs.com': 'docs', 'nestjs.com': 'docs', 'fastify.dev': 'docs',
  'bun.sh': 'docs', 'pnpm.io': 'docs', 'eslint.org': 'docs', 'prettier.io': 'docs', 'jestjs.io': 'docs',
  'playwright.dev': 'docs', 'testing-library.com': 'docs', 'reactflow.dev': 'docs', 'xyflow.com': 'docs',
  'tanstack.com': 'docs', 'redux.js.org': 'docs', 'threejs.org': 'docs', 'd3js.org': 'docs', 'motion.dev': 'docs',
  'gsap.com': 'docs', 'remotion.dev': 'docs', 'pixijs.com': 'docs', 'babylonjs.com': 'docs',
  'godotengine.org': 'docs',
};

/** (B) 주소 경로의 종류(표에 없는 사이트용). 순서가 우선순위 — 넓은 문서 판정이 맨 뒤라야 `/blog/` 가 글로 남는다. 한 호스트의 주소들은 다수결, 같으면 최근 것. */
export const WEB_KIND_PATHS: readonly { readonly kind: WebKind; readonly test: RegExp }[] = [
  // `/TR/` 는 W3C 의 대문자 경로라 대소문자를 가린다(`/tr/` 는 터키어 로케일 경로다).
  { kind: 'spec', test: /\/(?:specs?|rfcs?|standards?)(?:[/.?#]|$)|\/TR\// },
  { kind: 'qa', test: /\/(?:questions|discussions?|forums?|threads?|issues|community|t)(?:[/?#]|$)/i },
  { kind: 'code', test: /\/(?:blob|tree|commits?|pull|compare|raw)\//i },
  { kind: 'package', test: /\/(?:package|packages|crates?|gems?)\//i },
  { kind: 'video', test: /\/(?:watch|videos?|embed)(?:[/?#]|$)/i },
  { kind: 'article', test: /\/(?:blogs?|posts?|articles?|news|stories|story|@[^/]+)(?:[/?#]|$)/i },
  {
    kind: 'docs',
    test: /\/(?:docs?|documentation|reference|references|api|apis|manuals?|man|guides?|learn|tutorials?|handbook|how-?to|cookbook|getting-started|quickstart|library|sdk|kb|help|wiki)(?:[/.?#]|$)/i,
  },
];

// ─── 버블 크기 ───

export const NODE_MIN_SIZE = 70;
export const NODE_MAX_SIZE = 180;
/** 파일(위성) 버블 최소/최대 크기 */
export const FILE_MIN_SIZE = 40;
export const FILE_MAX_SIZE = 90;

/** §2.3 · §5.1 #2-1 (A) — 파일 지름의 용량 눈금(로그). 정비례면 큰 파일 하나가 `FILE_MAX_SIZE` 를 먹고 나머지가 바닥에 눌린다(실측 57MB wav). */
export const FILE_SIZE_SCALE = {
  /** 눈금 폭 하한(배) — 몇 바이트 차이가 지름 차이가 되지 않게(실측 184~186B 그림이 56~90px 로 갈렸다). */
  minSpread: 16,
} as const;

/** §2.2 · §5.1 #2-1 (B) — 묶음 버블(화면 전용): 한 버블 위성 무리의 같은 미디어 종류(하위 폴더 무관). 파일은 묶음의 부모로 서지 않고, 묶음엔 그 종류만 든다. */
export const BUNDLE_BUBBLE = {
  /** 지름(px) — 파일 범위의 가운데보다 조금 커서 무리의 중심으로 읽히되 구성 파일을 덮지 않는다. 용량·활동과 무관하게 고정. */
  size: 64,
  /** 같은 종류 묶음이 서는 최소 구성 수 — 하나는 묶음이 아니라 파일이다(`planKindBundles`). */
  minMembers: 2,
  /** 묶음 안(더블클릭)에 세우는 구성 파일 상한 — 연속 번호는 수백 장일 수 있다. 넘치면 최근 것부터 이만큼. */
  interiorMax: 120,
  /** 툴팁에 이름을 적는 구성 수 상한 — 넘치면 "외 N개". */
  tooltipNameMax: 12,
  /** 묶음 안 지름 상한(px) — 넓이가 사용 횟수에 비례(하한 `FILE_FACE.mediaMinSize`). 이름 줄이 12px 고정이라 키우면 화면 맞춤이 줌을 내린다 — `NODE_MAX_SIZE` 보다 작게. */
  interiorMaxSize: 140,
  /**
   * 묶음 안 이웃 사이 틈(px) — 원과 원 · 원과 이름 줄 · 이름 줄끼리. 물리의 원끼리 틈(`PHYSICS_MAGNET_GAP` 12)보다 넉넉해 앉은 뒤
   * 겹침 풀기로 밀리지 않는다.
   */
  interiorGap: 18,
  /** 묶음 안 무리의 가로/세로 비 — 가운데까지의 거리를 이 비의 타원으로 잰다(화면이 가로로 길다). */
  interiorAspect: 1.35,
  /** 이미 앉은 버블 둘레에서 맞닿는 자리 후보를 고르는 방향 수 — 많을수록 촘촘하지만 느리다(구성 120 개에서도 한 번에 수 ms). */
  interiorSeatDirections: 24,
} as const;

// ─── §5.24 읽기 히트맵 ───

/** 히트맵 모드에서 파일·폴더·도메인이 **함께 쓰는** 지름 범위(한 자여야 서로 비교된다). */
export const HEAT_MIN_SIZE = 44;
export const HEAT_MAX_SIZE = 150;

/** 히트 램프 7칸(남색 → 빨강). 명도는 노랑(index 4)까지 단조 증가, 위 두 칸은 색상으로 — 색각 이상에서도 가장 뜨거운 쪽이 뭉개지지 않는다. */
export const HEATMAP_RAMP: readonly string[] = [
  '#312E81', // indigo-900 — 거의 안 읽음
  '#1D4ED8', // blue-700
  '#0891B2', // cyan-600
  '#65A30D', // lime-600
  '#FACC15', // yellow-400 — 명도 정점
  '#F97316', // orange-500
  '#DC2626', // red-600 — 가장 뜨겁다
];

/**
 * **한 번도 안 읽은** 버블의 색. 램프의 최저온과 **일부러 다르다** —
 * "가장 차갑다"와 "아직 안 읽었다"는 다른 사실이고, 섞으면 안 읽은 것이 조금 읽은 것처럼 보인다.
 */
export const HEATMAP_ZERO_COLOR = '#374151'; // gray-700

/**
 * §5.24 히트 곡선(순서 = 범례 버튼 순서). 접촉 횟수가 롱테일이라 선형이면 극단값이 나머지를 첫 칸에 누른다(실측 2026-09-09: 97.8%) — 곡선은 사용자가 고른다.
 * `log` 기본(최대가 10배 자라도 1.3배만) · `linear` · `sqrt` · `cbrt` · `quantile`(순위 — 가장 고르지만 없는 차이를 만들 수 있어 기본이 아니다).
 */
export const HEAT_CURVES = ['log', 'linear', 'sqrt', 'cbrt', 'quantile'] as const;

/** 기본 곡선은 로그(실측 첫 칸 쏠림 97.8% → 46.2% — 나머지는 실제로 1~2회라 어떤 곡선으로도 못 나눈다). */
export const DEFAULT_HEAT_CURVE = 'log';

/**
 * `quantile` 곡선이 읽는 분포 표본의 칸 수(경계는 +1 개). 값 전체를 전선에 싣지 않기 위한 요약이라
 * 프로젝트·축마다 숫자 33개면 족하다(§9 전선 부피 규약).
 */
export const HEAT_QUANTILE_BINS = 32;

/** 범례 램프 위에 세우는 중간 눈금 개수(양 끝 `0`·`최대 N회` 는 범례가 따로 적는다). */
export const HEAT_LEGEND_TICKS = 3;
/** iframe 버블 높이 (네모, 고정) — 너비는 클라 쪽 레이아웃이 직접 산출한다. */
export const IFRAME_BUBBLE_HEIGHT = 90;

// ─── 모델 컨텍스트 한도 (토큰) ───
// §4 — 정적 표는 시드(폴백)다. 런타임 SSOT 는 `ModelRegistry`(서버가 짓고 `GraphSnapshot.modelRegistry` 로). 조회는 `getModelContextLimit` 로.

/**
 * 풀ID → 컨텍스트 한도 시드. 같은 패밀리도 값이 갈려(Sonnet 4.6 1M · 4.5 200K) 아는 ID 는 여기 적는다 — 패밀리 디폴트는 처음 보는 ID 폴백일 뿐.
 * 출처: 공개 모델 개요표 Context window 행(확인 2026-09-02, Sonnet 5.5·Haiku 5.5 는 2026-10-15). 키가 있으면 `/v1/models` 의 `max_input_tokens` 가 덮는다.
 */
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // 1M 세대 — 4.6 이후는 1M 이 표준가에 포함된다(장문 프리미엄 ❌). Haiku 5.5 만 예외로 길이 구간 요금이다(`MODEL_PRICING`).
  'claude-fable-5-1': 1_000_000,
  'claude-fable-5': 1_000_000,
  'claude-opus-5-5': 1_000_000,
  'claude-opus-5': 1_000_000,
  'claude-opus-4-8': 1_000_000,
  'claude-opus-4-7': 1_000_000,
  'claude-opus-4-6': 1_000_000,
  'claude-sonnet-5-5': 1_000_000,
  'claude-sonnet-5': 1_000_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-haiku-5-5': 1_000_000,
  // 200K 세대 — 4.5 이하. 은퇴 모델도 남긴다(지난 세션 JSONL 에 그 ID 가 그대로 남아 조회된다).
  'claude-opus-4-5': 200_000,
  'claude-opus-4-1': 200_000,
  'claude-opus-4-0': 200_000,
  'claude-sonnet-4-5': 200_000,
  'claude-sonnet-4-0': 200_000,
  'claude-haiku-4-5': 200_000,
};
/** 모르는 모델의 컨텍스트 한도 — 낮게 둔다: 작으면 게이지가 일찍 찰 뿐, 크면 넘치기 직전까지 경고가 없다. */
export const DEFAULT_CONTEXT_LIMIT = 200_000;

// ─── 에이전트 ───

export const MAX_AGENTS = 10;
export const MAX_AGENT_EVENTS = 30;

/**
 * §5.3 #10 — 프로젝트당 커스텀 에이전트 정원. `POST /api/create-custom-agent` 는 loopback 토큰으로 닿아 상한이 없으면 "끝나면 둘 더 만들어라" 한 줄로 자기증식한다.
 * 40 = 빌더 오케스트라(실측 5~8개)는 안 건드리는 값. 캔버스에서 만드는 것도 같은 정원 — 예외가 곧 우회로다.
 */
export const CUSTOM_AGENT_MAX_PER_PROJECT = 40;

/** §5.3 #9 — 세션 명령 대기열 상한. 에이전트가 자기 세션에 명령을 넣고 Stop 훅이 다시 띄우는 고리를 끊는다(사람은 실측 한 자릿수). */
export const COMMAND_QUEUE_MAX_PER_SESSION = 50;
/** 초기 로딩 시 띄울 최근 세션 수 */
export const INITIAL_AGENT_COUNT = 3;

/** 버블/에이전트 유지 시간 (ms) — 신호 올 때마다 리셋 */
export const BUBBLE_TTL = 5 * 60 * 1000;
/** stopping/completed 상태 유지 후 사라지는 시간 (ms) */
export const AGENT_FADE_DURATION = 60 * 1000;
/** Ghost 버블 소멸까지 시간 (ms) — pinned가 아닐 때 ghostedAt부터 카운트 */
export const GHOST_FADE_DURATION = 60 * 1000;

/** 세션 스캔 주기 (ms) */
export const SESSION_SCAN_INTERVAL = 10_000;

/** Cowork 설정 홈 재탐색 간격(ms, §3.6 · §5.7 #24 공유) — 3겹 `readdir` 을 세션 스캔(10초)마다 하지 않게 캐시한다. */
export const COWORK_HOME_CACHE_MS = 15_000;

/** Cowork 세션 홈 상한(최근 것부터) — 쌓이기만 해 상한이 없으면 훅 주입·스캔 대상이 무한히 는다(오래된 세션엔 훅이 발화하지 않는다). */
export const COWORK_HOME_SCAN_MAX = 48;

/** 자동 idle 전환 임계값(ms) — 부모/서브, active/completed 모두. 수동 dismiss·좀비 제거와 별개 축. */
export const AGENT_IDLE_THRESHOLD_MS = 5 * 60 * 1000;

/** §2.4 (잠듦) — 이만큼 명령이 없던 세션의 claude 자식을 회수한다. 대화는 JSONL 에 남아 다음 명령이 `--resume` 으로 잇는다. */
export const SUBAGENT_DORMANT_IDLE_MS = 5 * 60 * 1000;
/** 자동 idle 전환 판정 주기 (ms) */
export const AGENT_IDLE_SWEEP_INTERVAL_MS = 30_000;

/** §9 — 배경 탭 유휴 해제(ms): 구독 밖에서 이만큼 조용한 프로젝트를 `unloadProject`(stub)로 내려놓는다(탭은 남는다). 0 = 끔(§3.2.3). */
export const PROJECT_IDLE_UNLOAD_MS = 15 * 60 * 1000;

/** 배경 탭 유휴 해제 판정 주기 (ms). 판정 자체가 부하가 되면 안 되므로 넉넉히 잡는다. */
export const PROJECT_IDLE_UNLOAD_SWEEP_MS = 60_000;

/** 힙 압력(§3.2.4 I축) 때의 낮춘 유휴 임계값. `PROJECT_IDLE_UNLOAD_MS` 가 0 이면 쓰지 않는다 — 끈 것은 끈 것이다. */
export const PROJECT_IDLE_UNLOAD_PRESSURE_MS = 3 * 60 * 1000;

/** §9 — 탭 전환 뒤 "불러오는 중"을 띄우기까지(ms). 원격에선 스냅샷 왕복 동안 캔버스가 비고, 즉시 띄우면 빠른 전환마다 깜빡인다. */
export const PROJECT_LOAD_HINT_DELAY_MS = 400;

/** §9 — 이만큼 지나도 스냅샷이 없으면 문구를 "회선이 느립니다"로 — 같은 말만 계속되면 멈춘 것처럼 보인다. */
export const PROJECT_LOAD_HINT_SLOW_MS = 6_000;

/** §4 — Claude.ai 한도 사용률 경고 임계(%). 게이지·헤더 필·팝업이 함께 쓴다. */
export const USAGE_LIMIT_WARN_PCT = 70;
export const USAGE_LIMIT_DANGER_PCT = 90;

/** §4 — 사용량 갱신 주기 = 공식 CLI `/usage` print probe 간격(모델 0턴, 과금 없음 — 실측). 문서에 없는 `/api/oauth/usage` 를 OAuth 토큰으로 부르지 않는다 — 약관에 걸린다. */
export const CLAUDE_USAGE_POLL_INTERVAL_MS = 5 * 60 * 1000;

/** §4 — `claude -p "/usage"` probe 타임아웃(실측 2.3초). 못 받으면 `cli-unavailable` 을 말해야 해 무한정 기다리지 않는다. */
export const CLAUDE_USAGE_PROBE_TIMEOUT_MS = 30_000;

/** §4 — 앱 안 Claude 로그인: `claude auth status --json` spawn 으로 판정(수백 ms). 로그인 팝업 동안엔 `LOGIN_POLL` 간격 재조회가 성공 판정의 1차 근거다(CLI 문구 파싱은 보조). */
export const CLAUDE_AUTH_PROBE_TIMEOUT_MS = 8_000;
/** `claude auth logout` 은 네트워크 왕복이 있어 조금 더 길게. */
export const CLAUDE_AUTH_LOGOUT_TIMEOUT_MS = 20_000;
export const CLAUDE_AUTH_POLL_INTERVAL_MS = 10 * 60 * 1000;
/** 로그인 진행 중 상태 재조회 주기(클라). */
export const CLAUDE_AUTH_LOGIN_POLL_INTERVAL_MS = 3_000;
/**
 * 로그인 PTY 의 termId. 에이전트에 속하지 않는 유일한 터미널이라 고정 id 를 쓴다
 * (`term:<agentId>:<session>` 규약의 agentId 자리에 예약어 `auth`).
 */
export const CLAUDE_AUTH_LOGIN_TERM_ID = 'term:auth:login';
/** OAuth URL 을 이 시간 안에 못 찾으면 로그인 팝업이 터미널을 자동으로 펼친다(폴백). */
export const CLAUDE_AUTH_TERMINAL_REVEAL_MS = 6_000;

/**
 * `BUILTIN_SLASH_COMMANDS` 설명 — `/` 자동완성용 CLI 내장 명령. 출처는 공개 문서 `code.claude.com/docs/en/commands`(실행본 추출 ❌ — 약관 §3 역설계 금지).
 * 표시 전용 — 없는 명령은 CLI 가 거절한다.
 */
/**
 * §4 — 헤드리스에선 안 도는 내장 명령(대화형 패널을 여는 부류): `"/<name> isn't available in this environment."` 한 줄로 끝난다(실측 turns=0).
 * 공개 동작이 근거라 낡아도 배지만 틀린다(실행 경로 불변, §3.3). CMD 버블(진짜 REPL)에선 다 되므로 `slashCommandNeedsTerminal` 이 실행 모드와 함께 본다.
 */
const TERMINAL_ONLY_SLASH_COMMANDS: ReadonlySet<string> = new Set([
  'add-dir', 'advisor', 'artifacts', 'autofix-pr', 'background', 'branch', 'btw', 'bug', 'cd',
  'copy', 'design-login', 'desktop', 'diff', 'export', 'feedback', 'focus', 'fork', 'help',
  'hooks', 'ide', 'install-github-app', 'login', 'logout', 'memory', 'mobile', 'passes',
  'permissions', 'plan', 'plugin', 'powerup', 'privacy-settings', 'rate-limit-options',
  'remote-control', 'remote-env', 'resume', 'scroll-speed', 'setup-bedrock', 'setup-vertex',
  'skills', 'status', 'subtask', 'tasks', 'teleport', 'terminal-setup', 'theme', 'tui',
  'upgrade', 'web-setup', 'workflows',
]);

/** §4 — 이 명령이 이 에이전트에선 안 도는가(터미널이 필요한가). 진짜 REPL(`interactiveTerminal`)이면 늘 false — 이름만 보면 CMD 버블에 거짓말한다. */
export function slashCommandNeedsTerminal(name: string, interactiveTerminal: boolean): boolean {
  if (interactiveTerminal) return false;
  return TERMINAL_ONLY_SLASH_COMMANDS.has(name.toLowerCase());
}

export const BUILTIN_SLASH_COMMANDS: readonly BuiltinSlashCommand[] = [
  { name: "add-dir", description: "Add a working directory for file access during the current session", aliases: [] },
  { name: "advisor", description: "Enable or disable the advisor tool, which consults a second model for guidance at key moments during a task", aliases: [] },
  { name: "agents", description: "As of v2.1.198, running /agents prints a reminder to ask Claude to create or manage subagents, or to edit .claude/agents/ or ~/.claude/ag...", aliases: [] },
  { name: "artifacts", description: "List the artifacts you own or that are shared with you, then attach one to the session, open it in your browser, or copy its link", aliases: [] },
  { name: "auto-mode-setup", description: "Draft autoMode.environment entries from your project and recent sessions, then review the draft and save it to your user settings", aliases: [] },
  { name: "autocompact", description: "Set the auto-compact window: how full the context window gets before Claude Code compacts automatically", aliases: [] },
  { name: "autofix-pr", description: "Spawn a Claude Code on the web session that watches the current branch's PR and pushes fixes when CI fails or reviewers leave comments", aliases: [] },
  { name: "background", description: "Detach the current session to run as a background agent and free this terminal", aliases: ["bg"] },
  { name: "batch", description: "Orchestrate large-scale changes across a codebase in parallel", aliases: [] },
  { name: "branch", description: "Create a branch of the current conversation at this point, so you can try a different direction without losing the conversation as it stands", aliases: [] },
  { name: "btw", description: "Ask a side question about the current session without adding to the conversation", aliases: [] },
  { name: "bug", description: "Report a bug or share your conversation", aliases: ["share"] },
  { name: "cd", description: "Move this session to a new working directory, keeping the conversation and its prompt cache", aliases: [] },
  { name: "chrome", description: "Configure Claude in Chrome settings", aliases: [] },
  { name: "claude-api", description: "Load Claude API and Managed Agents reference material for your project's language", aliases: [] },
  { name: "clear", description: "Start a new conversation with empty context", aliases: ["reset", "new"] },
  { name: "code-review", description: "Review the current diff, or a PR number, branch, or path you pass, for correctness bugs and cleanup opportunities", aliases: ["review"] },
  { name: "color", description: "Set the prompt bar color for the current session", aliases: [] },
  { name: "compact", description: "Free up context by summarizing the conversation so far", aliases: [] },
  { name: "config", description: "Open the Settings interface to adjust theme, model, output style, and other preferences", aliases: ["settings"] },
  { name: "context", description: "Visualize current context usage as a colored grid", aliases: [] },
  { name: "copy", description: "Copy the last assistant response to clipboard", aliases: [] },
  { name: "dataviz", description: "Design guidance for charts, graphs, and dashboards", aliases: [] },
  { name: "debug", description: "Enable debug logging for the current session and troubleshoot issues by reading the session debug log", aliases: [] },
  { name: "deep-research", description: "Fan out web searches on a question, fetch and cross-check sources, and synthesize a cited report", aliases: [] },
  { name: "design-login", description: "Authorize design-system access for /design-sync with your claude.ai account", aliases: [] },
  { name: "design-sync", description: "Convert your repo's React design system and upload it to Claude Design, so designs it produces use your real components", aliases: [] },
  { name: "desktop", description: "Continue the current session in the Claude Code Desktop app", aliases: ["app"] },
  { name: "diff", description: "Open an interactive diff viewer showing uncommitted changes and per-turn diffs", aliases: [] },
  { name: "doctor", description: "Run a setup checkup that diagnoses issues and can fix them", aliases: ["checkup"] },
  { name: "effort", description: "Set the effort level: low to xhigh, max, ultracode, or auto; status prints it", aliases: [] },
  { name: "exit", description: "Exit the CLI", aliases: ["quit"] },
  { name: "export", description: "Export the current conversation as plain text", aliases: [] },
  { name: "fast", description: "Toggle fast mode on or off", aliases: [] },
  { name: "feedback", description: "Send product feedback about Claude Code", aliases: [] },
  { name: "fewer-permission-prompts", description: "Scan your transcripts for common read-only Bash and MCP tool calls, then add a prioritized allowlist to project .claude/settings.json to...", aliases: [] },
  { name: "focus", description: "Toggle the focus view, which shows only your last prompt, a one-line tool-call summary with edit diffstats, and the final response", aliases: [] },
  { name: "fork", description: "Copy the current conversation into a new background session and keep working here", aliases: [] },
  { name: "goal", description: "Set a goal: Claude keeps working across turns until the condition is met or the goal clears for another reason", aliases: [] },
  { name: "heapdump", description: "Write a JavaScript heap snapshot and a memory breakdown to ~/Desktop, or your home directory on Linux without a Desktop folder, for diagn...", aliases: [] },
  { name: "help", description: "Show help and available commands", aliases: [] },
  { name: "hooks", description: "View hook configurations for tool events", aliases: [] },
  { name: "ide", description: "Manage IDE integrations and show status", aliases: [] },
  { name: "import", description: "Bring configuration from other coding agents on your machine, currently OpenAI Codex and Google Gemini CLI, into Claude Code, including i...", aliases: [] },
  { name: "init", description: "Initialize project with a CLAUDE.md guide", aliases: [] },
  { name: "insights", description: "Generate an HTML report analyzing your recent sessions on this machine: which projects you work in, how you use Claude Code, where things...", aliases: [] },
  { name: "install-github-app", description: "Install the Claude GitHub App for a repository, with an optional step to set up GitHub Actions workflows and secrets", aliases: [] },
  { name: "install-slack-app", description: "Install the Claude Slack app", aliases: [] },
  { name: "keybindings", description: "Open your keyboard shortcuts file", aliases: [] },
  { name: "list-agents", description: "List the subagents, agent team teammates, and other Claude Code sessions Claude can message, with the name to use for each", aliases: [] },
  { name: "login", description: "Sign in to your Anthropic account", aliases: [] },
  { name: "logout", description: "Sign out from your Anthropic account", aliases: [] },
  { name: "loop", description: "Run a prompt repeatedly while the session stays open", aliases: ["proactive"] },
  { name: "mcp", description: "Manage MCP server connections and OAuth authentication", aliases: [] },
  { name: "memory", description: "Edit CLAUDE.md files, enable or disable auto memory, and view auto memory entries", aliases: [] },
  { name: "mobile", description: "Show QR code to download the Claude mobile app", aliases: ["ios", "android"] },
  { name: "model", description: "Switch the AI model and save it as your default for new sessions", aliases: [] },
  { name: "passes", description: "Share a free week of Claude Code with friends", aliases: [] },
  { name: "permissions", description: "Manage allow, ask, and deny rules for tool permissions", aliases: ["allowed-tools"] },
  { name: "plan", description: "Enter plan mode directly from the prompt", aliases: [] },
  { name: "plugin", description: "Manage Claude Code plugins", aliases: [] },
  { name: "powerup", description: "Discover Claude Code features through quick interactive lessons with animated demos", aliases: [] },
  { name: "privacy-settings", description: "View and update your privacy settings", aliases: [] },
  { name: "radio", description: "Open Claude FM lo-fi radio in your browser", aliases: [] },
  { name: "rate-limit-options", description: "Show ways to keep working when a claude.ai usage limit blocks a request: wait and continue automatically when the limit resets, add usage...", aliases: [] },
  { name: "recap", description: "Generate a one-line summary of the current session on demand", aliases: [] },
  { name: "release-notes", description: "View the changelog in an interactive version picker", aliases: [] },
  { name: "reload-plugins", description: "Reload all active plugins to apply pending changes without restarting", aliases: [] },
  { name: "reload-skills", description: "Re-scan skill and command directories so skills added or changed on disk during the session become available without restarting", aliases: [] },
  { name: "remote-control", description: "Make this session available for Remote Control from claude.ai", aliases: ["rc"] },
  { name: "remote-env", description: "Choose the default environment for cloud agents", aliases: [] },
  { name: "rename", description: "Rename the current session and show the name on the prompt bar", aliases: [] },
  { name: "resume", description: "Resume a conversation by ID or name, or open the session picker", aliases: ["continue"] },
  { name: "rewind", description: "Rewind the conversation and/or code to a previous point, or summarize from a selected message", aliases: ["checkpoint", "undo"] },
  { name: "run", description: "Launch and drive your project's app to see a change working, not only passing tests", aliases: [] },
  { name: "run-skill-generator", description: "Teach /run and /verify how to build, launch, and drive your project's app from a clean environment by writing a per-project skill", aliases: [] },
  { name: "sandbox", description: "Toggle sandbox mode", aliases: [] },
  { name: "schedule", description: "Create, update, list, or run routines, which execute in the cloud", aliases: ["routines"] },
  { name: "scroll-speed", description: "Adjust mouse wheel scroll speed interactively, with a ruler you can scroll while the dialog is open to preview the change", aliases: [] },
  { name: "security-review", description: "Analyze the changes on your current branch for security vulnerabilities", aliases: [] },
  { name: "setup-bedrock", description: "Configure Amazon Bedrock authentication, region, and model pins through an interactive wizard", aliases: [] },
  { name: "setup-vertex", description: "Configure Google Cloud's Agent Platform authentication, project, region, and model pins through an interactive wizard", aliases: [] },
  { name: "simplify", description: "Review the changed code for cleanup opportunities and apply the fixes", aliases: [] },
  { name: "skills", description: "List available skills", aliases: [] },
  { name: "status", description: "Open the Settings interface on the Status tab, showing version, model, account, and connectivity", aliases: [] },
  { name: "statusline", description: "Configure Claude Code's status line", aliases: [] },
  { name: "stickers", description: "Order Claude Code stickers", aliases: [] },
  { name: "stop", description: "Stop the current background session", aliases: [] },
  { name: "subtask", description: "Spawn a forked subagent: a background subagent that inherits the full conversation and works on the task while you keep working", aliases: [] },
  { name: "tasks", description: "View and manage background work in the current session, including subagents that have finished", aliases: [] },
  { name: "team-onboarding", description: "Generate a team onboarding guide from your Claude Code usage history", aliases: [] },
  { name: "teleport", description: "Pull a Claude Code on the web session into this terminal", aliases: [] },
  { name: "terminal-setup", description: "Configure terminal keybindings for Shift+Enter and other shortcuts", aliases: [] },
  { name: "theme", description: "Change the color theme", aliases: [] },
  { name: "tui", description: "Set the terminal UI renderer and relaunch into it with your conversation intact", aliases: [] },
  { name: "ultrareview", description: "Run a deep, multi-agent code review in a cloud sandbox with ultrareview", aliases: [] },
  { name: "upgrade", description: "Open the upgrade page in your browser to switch to a higher plan tier", aliases: [] },
  { name: "usage", description: "Show session cost, plan usage limits, and activity stats", aliases: ["cost", "stats"] },
  { name: "usage-credits", description: "Configure usage credits, or request them from your admin, when you hit a limit", aliases: [] },
  { name: "verify", description: "Confirm a code change does what it should by building your project's app, running it, and observing the result, rather than relying on te...", aliases: [] },
  { name: "voice", description: "Toggle voice dictation, or enable it in a specific mode", aliases: [] },
  { name: "web-setup", description: "Connect your GitHub account to Claude Code on the web using your local gh CLI credentials", aliases: [] },
  { name: "workflows", description: "Open the workflow progress view to watch, pause, resume, or save running and completed workflows", aliases: [] },
];


/** 인터럽트 해소 주기(ms). Claude Code 는 인터럽트·도구 거부 때 Stop 훅을 안 내(공식 명세) Hook 버블이 active 로 굳는다 — JSONL 끝이 인터럽트 sentinel 이면 Stop 을 대신 낸다. */
export const INTERRUPT_RECONCILE_INTERVAL_MS = 5_000;

/**
 * 좀비 `executing` 봉합 유예(ms) — 이만큼 살아 있는 일감이 없으면 끊긴 것으로 본다(완료 신호 유실로 탭이 `busy` 에 잠기는 것을 푼다).
 * 넉넉히 둔다 — dispatch→spawn 사이 빈 창에서 걷으면 정상 명령을 죽인다. PTY·백그라운드 작업·봉인 유예도 살아있음이다(`sealZombieExecutingCommands`).
 */
export const ZOMBIE_EXECUTING_GRACE_MS = 60_000;

/**
 * "살아 있다"와 "일한다"를 가르는 시한(ms). in-flight 표식으로 늘 일감이 있어 좀비 후보에 못 오르는 턴을, `lastActivityAt` 이 이만큼 멎으면 일하지 않는다고 본다.
 * 코덱스 워치독(20분)·세션 생존 판정(10분 주기)이 다 실패했을 때의 마지막 그물이라 둘보다 길어야 한다(늦게 걷는 쪽이 안전).
 */
export const TURN_STREAM_STALL_MS = 30 * 60_000;

/**
 * 코덱스 턴 워치독 점검 주기 (ms). 자식이 살아 있는 한 `close`·`exit` 가 오지 않는 턴은 타이머가
 * 하나도 돌지 않아(마감 타이머는 종료·중지에만 걸린다) **영영 아무도 보지 않는다.** 이 주기로 본다.
 */
export const CODEX_TURN_IDLE_CHECK_MS = 15_000;

/** 코덱스 턴 1단계(5분) — 끊기면 알리기만 한다(긴 도구가 조용한 것과 구분이 안 된다). 걷는 판단은 2단계. */
export const CODEX_TURN_IDLE_NOTICE_MS = 5 * 60_000;

/** 코덱스 턴 2단계 — 이만큼 끊기면 마감(트리 종료 + `onDone`). 실측 2026-09-20: MCP 가 `CONNECT_TIMEOUT` 으로 죽자 자식은 살아 `close`/`exit` 없이 `executing` 에 굳었다. */
export const CODEX_TURN_IDLE_SETTLE_MS = 20 * 60_000;

/**
 * 짝 없는 코덱스 MCP 호출 시한(ms) — 지나면 합성 실패 `tool_result` 로 카드를 닫는다(§5.25 (F)). MCP 는 자체 전송 시한이 있어 10분을 정상으로 도는 호출이 없다
 * (Bash `tool_timeout_sec=3600` 과 달리 여기만 걸 수 있다).
 */
export const CODEX_MCP_CALL_DEADLINE_MS = 10 * 60_000;

/** 파일 존재 확인 주기 (ms) — 삭제된 파일 버블 자동 제거 */
export const FILE_EXISTENCE_CHECK_INTERVAL = 30_000;

/** ghost(삭제 추정) 전환 전 연속 miss 횟수 — atomic-save·git·빌드툴이 찰나 치운 파일을 지우지 않게. 1 = 디바운스 없음. */
export const FILE_EXISTENCE_MISS_THRESHOLD = 2;

// ─── 레이아웃 ───

/** 에이전트 클러스터 (멀티 에이전트일 때 중앙 배치) */
export const AGENT_CLUSTER_BASE_RADIUS = 50;
export const AGENT_CLUSTER_RADIUS_PER_AGENT = 15;

/** 폴더 공전 궤도 */
export const ORBIT_BASE_RADIUS = 180;
export const ORBIT_RADIUS_PER_ITEM = 20;

/**
 * 위성 궤도 틈(px, §5.1 #2-2 (J)). 20 이면 미디어 위성의 이름 줄(17px)이 부모에 닿고 위성선이 안 보여 "붙은 것"으로 읽힌다 — 이름 줄 뒤에도 선이 보이게 둔다.
 * 등장 첫 고리·스프링 평형점·놓기·정리(§5.4 #33)·묶음 점선·앱 작업 궤도가 이 값 하나를 본다 — 따로 들면 서로 당겨 궤도가 풀린다.
 */
export const SATELLITE_ORBIT_GAP = 48;

/** §5.1 #2-2 (J) — 위성 고리의 이웃·고리 사이 틈(px). 이름 줄(지름의 1.8배 폭)을 달아 최상위 간격(`TIDY_LAYOUT`)보다 넓다. 등장 격자·물리·정리(§5.4 #33 (F))가 같이 쓴다. */
export const SATELLITE_RING_SPACING = {
  NEIGHBOR_GAP: 44,
  ROW_GAP: 40,
} as const;

/** 위성으로 허용되는 버블 타입 */
export const SATELLITE_TYPES: ReadonlySet<BubbleType> = new Set<BubbleType>(['file', 'bash', 'ghost', 'iframe']);

// ─── §5.1 #2-1 — 파일 버블 얼굴 · 작업물 별자리 ───

/** 미디어 MIME 표에서 그 갈래(`video/`·`audio/`·`model/`)의 확장자만 — 표를 두 벌로 들지 않게 펼쳐 쓴다. */
function mediaExtsWithMime(prefix: string): string[] {
  return Object.entries(WORKSPACE_MEDIA_MIME_BY_EXT)
    .filter(([, mime]) => mime.startsWith(prefix))
    .map(([ext]) => ext);
}

/** (A) 파일 얼굴 종류 표(판정은 `fileFaceKindOf`) — 확장자→앱 표가 아니다(앱은 레지스트리 선언, §5.13 (R-1)). 미디어는 기존 표를 펼친다(두 벌 ❌). 앞 갈래가 이긴다. `.ts` 는 코드다. */
export const FILE_FACE_EXTENSIONS: Readonly<Record<Exclude<FileFaceKind, 'other'>, readonly string[]>> = {
  video: [
    ...mediaExtsWithMime('video/'), '.mkv', '.3gp', '.3g2', ...WORKSPACE_CONVERT_VIDEO_EXTENSIONS,
    // §5.1 #2-1 (G) ⑥ — 날 스트림 · 카메라 RAW · 모션 그래픽 · 편집 원본(미리보기 없이 갈래 아이콘).
    '.y4m', '.h264', '.h265', '.hevc', '.ivf', '.braw', '.r3d', '.lottie', '.riv',
    '.prproj', '.aep', '.aepx', '.drp', '.veg', '.mogrt',
  ],
  audio: [
    ...mediaExtsWithMime('audio/'), ...WORKSPACE_CONVERT_AUDIO_EXTENSIONS, '.mid', '.midi',
    // §5.1 #2-1 (G) ⑥ — 그 밖의 소리 · 트래커 · 사운드폰트 · DAW 원본 · 악보 앱 원본.
    '.caf', '.aifc', '.w64', '.rf64', '.bwf', '.mp2', '.ac3', '.eac3', '.spx', '.gsm', '.voc', '.snd',
    '.xm', '.it', '.s3m', '.sf2', '.sf3', '.sfz',
    '.als', '.flp', '.logicx', '.rpp', '.cpr', '.song', '.band', '.aup3', '.sesx', '.mmp', '.mscz', '.gp5', '.gpx',
  ],
  image: [
    ...WORKSPACE_IMAGE_EXTENSIONS,
    // 우리가 그리지 못하는 사진·디자인 원본도 "사진"이다 — 미리보기 없이 얼굴(색·글리프)만 쓴다.
    '.tif', '.tiff', '.heic', '.heif', '.psd', '.psb', '.tga', '.exr', '.hdr', '.dds', '.raw', '.cr2', '.cr3',
    '.nef', '.arw', '.dng', '.orf', '.rw2', '.xcf', '.ai', '.eps', '.sketch', '.fig', '.kra',
    // §5.1 #2-1 (G) ⑥ — 그 밖의 그림 · GPU 텍스처 · 재질 그래프 · 그림 원본.
    '.jxl', '.jp2', '.j2k', '.qoi', '.ppm', '.pgm', '.pbm', '.pnm', '.pcx', '.icns', '.cur', '.svgz',
    '.ktx', '.ktx2', '.basis', '.sbs', '.sbsar',
    '.ora', '.pdn', '.clip', '.procreate', '.afphoto', '.afdesign', '.cdr', '.aseprite',
  ],
  model: [
    ...mediaExtsWithMime('model/'), '.obj', '.stl', '.ply', '.fbx', '.usd', '.usda', '.usdc', '.usdz', '.abc',
    '.blend', '.max', '.ma', '.mb', '.c4d', '.3ds', '.x3d', '.vrm',
    // §5.1 #2-1 (G) ⑥ — 저작 원본 · CAD · 건축 · 아바타 · 점구름 · 가우시안 스플랫.
    '.blend1', '.step', '.stp', '.iges', '.igs', '.skp', '.ifc', '.wrl', '.pmx', '.pmd', '.lwo',
    '.hip', '.hiplc', '.hipnc', '.hda', '.ztl', '.zpr', '.spp', '.splat', '.ksplat', '.spz', '.las', '.laz', '.e57', '.pcd',
  ],
  subtitle: [
    '.srt', '.vtt', '.ass', '.ssa', '.sbv', '.lrc', '.ttml', '.dfxp',
    // §5.1 #2-1 (G) ⑥ — 국내에서 흔한 SAMI · 디스크 자막 · 방송·애플 자막.
    '.smi', '.sami', '.sub', '.sup', '.scc', '.itt',
  ],
  font: ['.ttf', '.otf', '.ttc', '.woff', '.woff2', '.eot', '.fon', '.fnt'],
  code: [
    '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.php', '.go', '.rs', '.java', '.kt',
    '.kts', '.scala', '.swift', '.m', '.mm', '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.cs', '.fs', '.vb',
    '.lua', '.dart', '.r', '.jl', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1', '.bat', '.cmd', '.html', '.htm',
    '.css', '.scss', '.sass', '.less', '.styl', '.vue', '.svelte', '.astro', '.glsl', '.hlsl', '.wgsl', '.vert',
    '.frag', '.comp', '.shader', '.cginc', '.gd', '.gdshader', '.sql', '.graphql', '.gql', '.ex', '.exs', '.erl',
    '.hs', '.clj', '.elm', '.zig', '.nim', '.sol', '.asm', '.wat', '.ipynb',
    // §5.1 #2-1 (G) ⑥ — 셰이더 · 3D 툴 스크립트 · 크리에이티브 코딩 · 소리 코딩.
    '.osl', '.metal', '.geom', '.tesc', '.tese', '.mel', '.ms', '.mcr', '.vex', '.scad', '.pde', '.ino',
    '.sc', '.scd', '.ck', '.csd', '.orc', '.sco', '.ly', '.tidal',
  ],
  data: [
    '.json', '.jsonc', '.json5', '.jsonl', '.ndjson', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env',
    '.xml', '.csv', '.tsv', '.plist', '.properties', '.lock', '.mtl', '.proto', '.prisma',
    // §5.1 #2-1 (G) ⑥ — 배열·표 · DB · 색 보정 LUT · 편집 타임라인 · 악보 · 동작 · 3D 출력 · 재질 · 곁 정보 · 모델 가중치.
    '.npy', '.npz', '.h5', '.hdf5', '.parquet', '.db', '.sqlite', '.sqlite3', '.xlsx', '.xls', '.ods', '.numbers',
    '.cube', '.3dl', '.edl', '.otio', '.fcpxml', '.kdenlive', '.mlt', '.musicxml', '.mxl', '.bvh', '.vmd', '.gcode',
    '.mtlx', '.xmp', '.safetensors', '.ckpt', '.pt', '.pth', '.onnx', '.gguf',
  ],
  doc: [
    '.md', '.mdx', '.markdown', '.txt', '.rst', '.adoc', '.org', '.tex', '.pdf', '.rtf', '.doc', '.docx', '.odt',
    '.hwp', '.hwpx', '.pages', '.epub', '.log',
    // §5.1 #2-1 (G) ⑥ — 대본 · Typst · 슬라이드.
    '.fountain', '.fdx', '.typ', '.pptx', '.ppt', '.odp',
  ],
};

/**
 * §5.1 #2-1 (G) ⑤ — 종류마다의 **기본 갈래**. 아래 갈래 표에 없는 확장자는 이 갈래(그 종류의 종전 글리프)다.
 */
export const FILE_FACE_BASE_FAMILY: Readonly<Record<FileFaceKind, FileFaceFamily>> = {
  video: 'video',
  image: 'image',
  audio: 'audio',
  model: 'model',
  code: 'code',
  data: 'data',
  doc: 'doc',
  subtitle: 'subtitle',
  font: 'font',
  other: 'other',
};

/**
 * §5.1 #2-1 (G) ⑤ — **갈래 표**(소문자, 마침표 포함). 판정은 `fileFaceFamilyOf` 한 곳이고 앞 갈래가 이긴다.
 * 갈래는 아이콘만 정한다 — 종류(`FILE_FACE_EXTENSIONS`)와 다른 축이라 `.musicxml`(데이터 종류)도 악보 아이콘이다.
 * 기본 갈래(종류와 같은 이름)는 적지 않는다.
 */
export const FILE_FACE_FAMILY_EXTENSIONS: Readonly<Partial<Record<FileFaceFamily, readonly string[]>>> = {
  // 영상
  videoRaw: ['.braw', '.r3d', '.y4m', '.h264', '.h265', '.hevc', '.ivf'],
  motion: ['.lottie', '.riv'],
  videoProject: ['.prproj', '.aep', '.aepx', '.drp', '.veg', '.mogrt'],
  // 그림
  vector: ['.svg', '.svgz', '.ai', '.eps', '.cdr', '.afdesign'],
  photoRaw: ['.raw', '.cr2', '.cr3', '.nef', '.arw', '.dng', '.orf', '.rw2'],
  hdr: ['.exr', '.hdr'],
  texture: ['.ktx', '.ktx2', '.basis', '.dds', '.tga'],
  material: ['.sbs', '.sbsar', '.mtlx'],
  layered: ['.psd', '.psb', '.xcf', '.kra', '.ora', '.pdn', '.clip', '.procreate', '.afphoto', '.sketch', '.fig', '.aseprite'],
  icon: ['.ico', '.icns', '.cur'],
  // 소리
  sequence: ['.mid', '.midi', '.xm', '.it', '.s3m'],
  soundfont: ['.sf2', '.sf3', '.sfz'],
  daw: ['.als', '.flp', '.logicx', '.rpp', '.cpr', '.song', '.band', '.aup3', '.sesx', '.mmp'],
  score: ['.mscz', '.gp5', '.gpx', '.musicxml', '.mxl', '.ly'],
  // 3D
  scene: ['.usd', '.usda', '.usdc', '.usdz', '.abc'],
  modelSource: ['.blend', '.blend1', '.max', '.ma', '.mb', '.c4d', '.hip', '.hiplc', '.hipnc', '.hda', '.ztl', '.zpr', '.spp', '.skp'],
  cad: ['.step', '.stp', '.iges', '.igs', '.ifc'],
  avatar: ['.vrm', '.pmx', '.pmd'],
  pointCloud: ['.las', '.laz', '.e57', '.pcd'],
  splat: ['.splat', '.ksplat', '.spz'],
  motionData: ['.bvh', '.vmd'],
  // 자막
  lyrics: ['.lrc'],
  // 코드
  shader: ['.glsl', '.hlsl', '.wgsl', '.vert', '.frag', '.comp', '.shader', '.cginc', '.gdshader', '.osl', '.metal', '.geom', '.tesc', '.tese'],
  shell: ['.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1', '.bat', '.cmd'],
  notebook: ['.ipynb'],
  web: ['.html', '.htm', '.css', '.scss', '.sass', '.less', '.styl', '.vue', '.svelte', '.astro'],
  // 데이터
  table: ['.csv', '.tsv', '.xlsx', '.xls', '.ods', '.numbers', '.parquet', '.npy', '.npz', '.h5', '.hdf5'],
  database: ['.db', '.sqlite', '.sqlite3'],
  config: ['.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env', '.properties', '.plist'],
  lut: ['.cube', '.3dl'],
  timeline: ['.edl', '.otio', '.fcpxml', '.kdenlive', '.mlt'],
  weights: ['.safetensors', '.ckpt', '.pt', '.pth', '.onnx', '.gguf'],
  // 문서
  pdf: ['.pdf'],
  slides: ['.pptx', '.ppt', '.odp'],
  screenplay: ['.fountain', '.fdx'],
  log: ['.log'],
  // 기타 — 종류 표에는 없는 것(얼굴은 `other`)도 갈래는 말한다.
  archive: ['.zip', '.7z', '.rar', '.tar', '.gz', '.tgz', '.bz2', '.tbz2', '.xz', '.txz', '.zst', '.lz', '.lz4', '.lzma', '.zipx'],
};

/** (A) 버블 안에 미리보기를 굽는 **미디어** 얼굴 — 이 넷만 렌즈가 된다. */
export const FILE_FACE_MEDIA_KINDS: ReadonlySet<FileFaceKind> = new Set<FileFaceKind>(['video', 'image', 'audio', 'model']);

/** (A) 얼굴 기본색 — 미디어는 그 확장자를 선언한 앱의 색이 이기고 이 값은 선언이 없을 때(psd 등)만. 그 밖은 §2.2 파일 보라 계열에서 명도만 가른다. */
export const FILE_FACE_STYLES: Readonly<Record<FileFaceKind, { readonly color: string; readonly glow: string }>> = {
  video: { color: '#2B3243', glow: '#9FB0CF' },
  image: { color: '#3A3024', glow: '#E2C08F' },
  audio: { color: '#1F3A3C', glow: '#86D0C4' },
  model: { color: '#2E2944', glow: '#B6A4E6' },
  code: { color: '#8B5CF6', glow: '#C4B5FD' },
  data: { color: '#7C5CE0', glow: '#BFB0F5' },
  doc: { color: '#6B63B5', glow: '#C2BCEB' },
  subtitle: { color: '#5E6AB0', glow: '#B7BFE9' },
  font: { color: '#8A5CC9', glow: '#D2B8F0' },
  other: { color: '#8B5CF6', glow: '#C4B5FD' },
};

/** (A) 얼굴 기하 — 크기 하한은 `calcBubbleSize` 한 곳이 읽어 렌더·배치·선 끝점이 같은 자를 쓴다. */
export const FILE_FACE = {
  /** 미디어 얼굴 지름 하한(px) — 그림이 읽혀야 한다. */
  mediaMinSize: 56,
  /** 영상 렌즈 둘레의 네모 구멍 수(필름 퍼포레이션을 원으로 감은 것). */
  sprocketCount: 12,
  /** 소리 방사형 파형의 막대 수(구운 파형을 이 수로 다시 뽑는다). */
  radialBars: 40,
  /** 이름 줄을 원 아래로 띄우는 거리(px). */
  captionGap: 3,
  /** 원 아래 이름 줄의 높이(px) — `FileFaceRim` 의 `leading-[14px]` 와 같은 값(묶음 안 배치가 이 줄까지 몸으로 친다). */
  captionLineHeight: 14,
  /** 원 아래 이름 줄의 최대 폭 — 지름의 `ratio` 배, 작은 원이라도 `min` px(`FileFaceRim` 과 묶음 안 배치가 같은 값을 읽는다). */
  captionMaxWidth: { ratio: 1.8, min: 96 },
  /** 중심 둘레 궤도 점선의 투명도. */
  orbitOpacity: 0.32,
} as const;

/** (B) 미디어 중심의 순위 — 한 파일이 둘 이상의 중심에 걸리면 높은 쪽으로 간다. */
export const CONSTELLATION_HUB_RANK: Readonly<Record<'video' | 'model' | 'audio' | 'image', number>> = {
  video: 4,
  model: 3,
  audio: 2,
  image: 1,
};

/** (B) 재료 미디어 — 이 종류는 저 종류 중심의 재료로 들어갈 수 있다(순위가 높은 쪽으로만). */
export const CONSTELLATION_INGREDIENT_OF: Readonly<Record<'image' | 'audio' | 'model', readonly ('video' | 'model')[]>> = {
  image: ['video', 'model'],
  audio: ['video'],
  model: ['video'],
};

/** (B) **같은 폴더만으로** 묶이는 곁 파일 종류. 코드는 여기 없다 — `src/` 의 로고 하나가 컴포넌트 전부를 삼키지 않게. */
export const CONSTELLATION_SIDECAR_KINDS: ReadonlySet<FileFaceKind> = new Set<FileFaceKind>(['data', 'doc', 'subtitle', 'font']);

/**
 * (B) 이름 갈래·같은 이름 판정에서 빼는 흔한 낱말. 이것들이 같다고 같은 작업물은 아니다
 * (`index.html` 과 `index.png`, `main.ts` 와 `main.wav`).
 */
export const CONSTELLATION_STOP_TOKENS: ReadonlySet<string> = new Set([
  'index', 'main', 'app', 'test', 'tests', 'spec', 'src', 'lib', 'util', 'utils', 'file', 'files', 'new', 'old',
  'copy', 'temp', 'tmp', 'out', 'output', 'input', 'default', 'final', 'draft', 'the', 'and', 'readme', 'style',
  'styles', 'image', 'img', 'asset', 'assets', 'data', 'config', 'types', 'common', 'base', 'untitled',
]);

/** (C) 내용 언급을 읽는 글 파일 중 종류가 3D 인 것(텍스트로 된 모델·재질 형식). 나머지 3D 는 바이너리라 읽지 않는다. */
export const CONSTELLATION_SCAN_MODEL_EXTENSIONS: readonly string[] = ['.gltf', '.obj', '.dae'];

/** (C) 글 종류여도 읽지 않는 것 — 바이너리 문서(앞부분이 압축·이진이다)와 잠금 파일(크고 남의 이름만 가득하다). */
export const CONSTELLATION_SCAN_SKIP_EXTENSIONS: readonly string[] = [
  '.pdf', '.doc', '.docx', '.odt', '.hwp', '.hwpx', '.pages', '.epub', '.lock',
];

/** (B)(C)(D) 작업물 별자리의 수치 — 점수는 `ConstellationReason` 의 근거별 세기다. */
export const CONSTELLATION = {
  /** 한 중심이 거느리는 위성 상한. 넘치는 것은 원래 부모 곁에 남는다(화면) · 오래된 것부터 뺀다(서버 위성 상한). */
  moonMax: 8,
  /** 이 점수 아래면 묶지 않는다. */
  minScore: 20,
  /** 이름 갈래로 치는 낱말의 최소 글자 수(라틴·숫자). */
  familyTokenMin: 3,
  /** 한글·한자·가나가 든 낱말은 한 글자에 뜻이 더 담겨 두 글자부터 친다(영상·배경·로고). */
  familyTokenMinCjk: 2,
  score: {
    appResult: 140,
    /**
     * (F) ④ — 그 앱 노드의 작업 중에 생긴 파일(앱 작업 보기에서만 넘어온다). 앱 결과 아래 · 소재 위 —
     * 다른 노드가 결과로 선언한 파일은 그 노드에 남고, 언급·이름 같은 약한 근거는 작업 귀속을 이기지 못한다.
     */
    appWork: 135,
    appPart: 120,
    appPartFolder: 110,
    mention: 100,
    sameStem: 60,
    chain: 50,
    stemFamily: 30,
    sameFolder: 20,
  },
  /** 한 번에 판정하는 파일 수 상한 — 넘으면 최근 것만 본다(판정 비용이 파일 수의 제곱으로 자라지 않게). */
  planMaxFiles: 600,
  /** (C) 글 파일에서 읽는 앞부분 크기(bytes). */
  scanMaxBytes: 262_144,
  /** (C) 동시에 읽는 파일 수. */
  scanConcurrency: 2,
  /** (C) 기억해 두는 파일 수(§3.2.4 F′ — 다시 만들 수 있는 파생물). */
  scanCacheMax: 2_000,
  /** (C) 한 파일에서 뽑는 이름 낱말 상한. */
  scanTokenMax: 256,
  /** (C) 한 파일이 가리키는 파일 수 상한(스냅샷에 싣는 id). */
  mentionMax: 32,
} as const;

/**
 * §5.1 #2-1 (F) · §5.4 #36 (I) — **앱 작업물**(앱과 연결해 한 일의 파일)의 수치. 귀속은 서버(`appWork` 꼬리표),
 * 보기는 클라(`appWorkView.ts`)가 하고 둘 다 이 표를 본다.
 */
export const APP_WORK = {
  /** 명령 한 건이 싣는 앱 노드 수 상한(`QueuedCommand.appNodeIds`). */
  commandNodeMax: 8,
  /** 파일 노드 하나가 드는 앱 꼬리표 수 상한 — 넘으면 오래된 것부터 뺀다. */
  nodeTagMax: 4,
  /** (F) ⑦ — 이름 끝 번호만 다른 같은 확장자 파일이 이 수 이상이면 위성 하나로 묶는다. */
  sequenceMin: 3,
  /** (F) ③ 작업 폴더 훑기 — Bash 가 끝나고 이만큼 기다렸다가 훑는다(이어 도는 명령을 한 번에). */
  scanDelayMs: 400,
  /** (F) ③ — 한 번에 훑는 폴더 수 · 파일 수 · 깊이(시작 폴더가 0). */
  scanFolderMax: 8,
  scanFileMax: 200,
  scanDepthMax: 3,
  /** (F) ③ — 명령 글에서 폴더 후보로 보는 경로 낱말 수 상한. */
  scanCommandPathMax: 4,
  /** (F) ③ — 훑지 않는 폴더 이름(정확히 같은 이름 · 대소문자 그대로). */
  scanSkipDirs: [
    '.git', 'node_modules', '.vibisual', '__pycache__', '.venv', 'venv', '.next', '.turbo', '.cache', '.idea', '.vscode',
    '.svn', '.hg', 'bower_components', '.pnpm-store', '.yarn',
  ] as readonly string[],
  /** (F) ⑤ — 위성이 앉는 위쪽 반원(라디안 · 화면 좌표: 0 = 3시, π/2 = 6시). 9시(π) → 12시(1.5π) → 3시(2π). */
  seatArcFrom: Math.PI,
  seatArcTo: Math.PI * 2,
  /** (F) ⑤ — 앱 노드 둘레 타원 궤도의 불투명도. */
  orbitOpacity: 0.3,
  /** (F) ⑥ — 작업 위성 테(앱 색)의 두께(캔버스 px). */
  ringWidth: 2,
  /** (F) ⑦⑧ · (I) — 툴팁에 적는 이름 목록 상한(넘치면 "…외 N"). */
  tooltipNameMax: 12,
} as const;

/**
 * §5.1 #2-1 (G) — **미리보기 성능 기준**. 앱을 무겁게 하는 미리보기는 굽지 않고 갈래 아이콘으로 둔다.
 * 판정은 shared `previewPolicy.ts`(파일·크기) 와 클라 `previewBudget.ts`(화면·한눈·시각) 둘이 이 표 하나를 본다.
 */
export const PREVIEW_POLICY = {
  /** ① 파일 기준 — 종류별 크기 상한(bytes). 영상은 구간 읽기라 상한이 없다(표에 없다). */
  maxBytes: {
    /** 래스터 그림 — 통째로 받아 해독한다. */
    image: 16_000_000,
    /** 벡터 그림 — 그리는 비용이 메인 스레드다. */
    svg: 1_000_000,
    /** 압축 소리(mp3·m4a·ogg·opus…) ≈ 16분. */
    audioCompressed: 16_000_000,
    /** PCM·무손실 소리(wav·flac·aiff…). */
    audioPcm: 48_000_000,
    /** 3D 정지 화면 — 읽기·파싱·GPU 올리기가 메인 스레드다. 끌어 돌려 보기는 `APP_THUMB.modelMaxBytes`. */
    model: 8_000_000,
  },
  /** ① — PCM·무손실로 보는 소리 확장자. 나머지 소리는 압축으로 본다(더 작은 상한). */
  audioPcmExtensions: ['.wav', '.flac', '.aiff', '.aif', '.aifc', '.w64', '.rf64', '.bwf', '.caf'] as readonly string[],
  /** ① — 그림 크기를 알려고 머리만 읽는 바이트(구간 요청). */
  headerBytes: 65_536,
  /** ① — 그림 픽셀 상한(가로×세로). 넘으면 아이콘 — 해독 메모리가 픽셀 × 4 바이트다. */
  imageMaxPixels: 40_000_000,
  /** ① — 소리 파형을 푸는 표본률(Hz). 48칸 파형에는 충분하고 해독 메모리가 44.1kHz 의 약 1/15 이다. */
  audioDecodeSampleRate: 3000,
  /** ② 화면 기준 — 화면에서 이 지름(px)보다 작으면 굽지도 그리지도 않는다. */
  minScreenPx: 28,
  /** ② — 아이콘이던 것을 다시 미리보기로 켜는 문턱(깜빡임 방지). */
  showScreenPx: 34,
  /** ② — 구슬 안 미리보기(지름 `APP_LINKED_ITEMS.beadSize` − 2)의 문턱 — 제 크기에 맞춘다(배율 1 에서 보인다). */
  beadMinScreenPx: 15,
  beadShowScreenPx: 19,
  /** ③ 한눈 기준 — 한 화면에 동시에 그리는 미리보기 수 상한. */
  maxOnScreen: 24,
  /** ④ 시각 기준 — 캔버스가 멈추고 이만큼 지나야 새로 굽기 시작한다(ms). */
  idleAfterMotionMs: 250,
  /** ④ — 종류별 동시 굽기 수(전체 상한은 `APP_THUMB.concurrency`). */
  laneConcurrency: { image: 2, video: 1, audio: 1, model: 1 },
  /** ④ — 줄에 서고 이만큼 지나도록 아무도 보지 않으면 시작 전에 버린다(ms). */
  staleQueuedMs: 1_500,
} as const;

/**
 * §5.13 (R-9) — 그림 **보기 창**이 필요한 만큼만 풀고 안 보면 내려놓는 기준. 판단은 클라 `imageViewPlan.ts`(순수) 한 곳이다.
 * 너비는 전부 **장치 픽셀**(CSS px × 화면 배율)로 비교한다.
 */
export const IMAGE_VIEW = {
  /** 미리보기(창에 맞춘 저화질) 너비를 이 단위로 올려 잡는다 — 창을 조금씩 키울 때마다 다시 풀지 않게. */
  previewStepPx: 256,
  /** 원본 너비가 미리보기 너비의 이 배 이하면 미리보기 없이 원본을 바로 푼다(두 번 풀 이득이 없다). */
  directMaxRatio: 1.5,
  /** 보이는 배율이 미리보기보다 이 배 넘게 촘촘해야 하면 원본을 푼다. */
  fullAboveRatio: 1.1,
  /** 미리보기로 충분해진 뒤(필요 너비 ≤ 미리보기 너비) 이만큼 지나면 원본을 놓는다(ms) — 확대·축소를 오가며 다시 풀지 않게. */
  fullReleaseDelayMs: 1_500,
  /** 창이 숨은(다른 탭 · 최소화) 지 이만큼 지나면 받은 바이트 · 미리보기 · 원본을 다 놓는다(ms). 다시 보이면 다시 받는다. */
  hiddenReleaseMs: 5_000,
  /** 창이 커져 미리보기를 다시 풀기 전에 기다리는 시간(ms) — 창 가장자리를 끄는 동안 매 프레임 풀지 않게. */
  regrowDebounceMs: 200,
} as const;

/** 안에 들어갈 수 있는 폴더 버블 타입 — §9 폴더 스코프드 스냅샷이 한 칸 앞 `children` 까지 실어 드릴다운이 즉시 열린다. `pipeline` 은 `pipelineChildren` 으로 그려 뺀다. */
export const FOLDER_BUBBLE_TYPES: ReadonlySet<BubbleType> = new Set<BubbleType>([
  'internal_folder',
  'external_folder',
  'worktree',
]);

// ─── 네트워크 (서버 유틸) ───

/** TCP 연결 확인 타임아웃 (ms) */
export const TCP_TIMEOUT = 1000;

// ─── 디테일 패널 ───

/** 디테일 패널 기본 너비 (px) */
export const PANEL_DEFAULT_WIDTH = 320;
/** 디테일 패널 최소 너비 (px) */
export const PANEL_MIN_WIDTH = 240;
/** 디테일 패널 최대 너비 (px) */
export const PANEL_MAX_WIDTH = 720;

// ─── 상태 저장 ───

/** 물리 엔진 위치 자동 저장 주기 (ms) */
export const POSITION_SAVE_INTERVAL = 30_000;

/** §3.2.1 — checkpoint.json / identity.json 백업 세대 수(`.bak1…N` 회전, 빈/급감 저장을 수동 복구). */
export const CHECKPOINT_BACKUP_GENERATIONS = 3;

/** §3.2.1 — `app-state.json`(열린 프로젝트 목록 SSOT) 백업 세대 수. checkpoint 와 같은 손실방지를 쓴다 — 크래시로 잘리면 탭 0개로 부팅해 다음 저장이 손상을 확정한다. */
export const APP_STATE_BACKUP_GENERATIONS = 3;

/** §5.4 #14-4 — 닫은 탭 스택 최대 건수(§3.2.3 축 E). 보존 설정으로 빼지 않는다 — 밀려난 것도 폴더 열기로 다시 열 수 있어 잃는 게 없다(Chrome 과 같은 25). */
export const MAX_RECENTLY_CLOSED_TABS = 25;

/** §5.4 #14-2 (C-1) — 탭 순서 저장(`PATCH /api/projects/order`, SSOT = `openProjects` 순서). PATCH 전에 떠난 스냅샷이 옛 순서로 되돌리지 않게 클라가 놓은 순서를 붙든다. */
export const PROJECT_TAB_ORDER = {
  /**
   * 놓은 순서를 화면이 붙드는 최대 시간(ms). 보낸 PATCH 가 다 답한 뒤 서버 순서가 그것을 따르면 그 전에 놓는다 —
   * 이 값은 서버가 끝내 다른 순서를 말할 때(다른 창이 다시 옮겼다)의 안전망이다. `LINK_VIEW.pendingMs` 와 같은 창.
   */
  pendingMs: 8000,
  /** 한 번에 받는 경로 수 상한(입력 검증). 넘는 것은 언급하지 않은 것으로 보아 제자리에 둔다. */
  maxEntries: 1000,
} as const;

/** §3.2.1-3 — 삭제 에이전트 묘비 상한(지운 sessionId 의 부활 차단). 안전한 prune 기준이 없어 상한만 — 넘치면 오래된 묘비부터. */
export const DELETED_AGENT_TOMBSTONE_MAX = 1000;

/**
 * §3.2.1-3 — checkpoint 빈/급감 덮어쓰기 거부(크래시 뒤 빈 인스턴스가 덮지 않게, `agents + nodes` 합계). 직전 합계가 `EMPTY_GUARD_MIN_PRIOR` 이상이면 통째-0 저장을 거부한다.
 * 급감 가드(`SHRINK_GUARD_*`)는 정상 만료 오탐이라 기본 꺼짐(`CHECKPOINT_SHRINK_GUARD_ENABLED=false`).
 * ⚠ 직전 합계에서 루트 노드(`ROOT_NODE_KEY_PREFIX`)는 뺀다 — 안 빼면 루트뿐인 디스크 vs 빈 인스턴스가 매번 거부돼 같은 판정이 영원히 반복된다.
 */
export const CHECKPOINT_EMPTY_GUARD_MIN_PRIOR = 1;
export const CHECKPOINT_SHRINK_GUARD_MIN_PRIOR = 8;
export const CHECKPOINT_SHRINK_GUARD_RATIO = 0.34;
export const CHECKPOINT_SHRINK_GUARD_ENABLED = false;

/**
 * 프로젝트 루트 폴더 노드의 키 접두사 — 실제 키는 `__root__:<프로젝트명>`.
 * 그래프 계층(노드 생성·정리)과 영속 계층(빈 체크포인트 판정)이 **같은 기준**을 써야 하므로 공유 상수로 둔다.
 */
export const ROOT_NODE_KEY_PREFIX = '__root__:';
/** 프로젝트별 루트 키 도입 이전의 단일 루트 키(하위 호환 — 복원 시 접두사 키로 승격된다). */
export const LEGACY_ROOT_NODE_KEY = '__root__';

// ─── 버블 렌더링 ───

/** 텍스트 라벨 최대 너비 = size * TEXT_WIDTH_RATIO */
export const BUBBLE_TEXT_WIDTH_RATIO = 0.7;
/** 텍스트 스케일 기준 버블 크기 — 이 크기에서 기본 폰트 비율 1.0 */
export const BUBBLE_TEXT_REF_SIZE = 150;

// ─── 기본 레이아웃 중심 좌표 ───

/** 방사형 레이아웃 기본 중심 X */
export const LAYOUT_CENTER_X = 500;
/** 방사형 레이아웃 기본 중심 Y */
export const LAYOUT_CENTER_Y = 400;

/**
 * 캔버스 사각 바운딩 박스의 기본 반치수(사용자가 프로젝트마다 조절, `layoutBoundsByProject`).
 * 물리 클램프·바운딩 박스 표시·§5.4 #33 정리 배치가 **같은 기본값**을 봐야 한다 —
 * 따로 들면 한쪽만 고쳐져 정리한 고리가 상자 밖에 앉는다.
 */
export const LAYOUT_BOUNDS_DEFAULT = { hw: 1500, hh: 1100 } as const;

// ─── 물리 엔진 (위성 버블 반발/스프링) ───

/** 버블 간 최소 간격 (px) */
export const PHYSICS_MAGNET_GAP = 12;
/** 근거리 반발력 강도 */
export const PHYSICS_REPULSION_STRENGTH = 800;
/** 반발력 적용 범위 (px) */
export const PHYSICS_REPULSION_RANGE = 120;
/** 속도 감쇠 (매 프레임 × DAMPING) */
export const PHYSICS_DAMPING = 0.88;
/** 최대 속도 상한 (px/frame) */
export const PHYSICS_MAX_VELOCITY = 4;
/** 랜덤 미세 진동 강도 */
export const PHYSICS_JITTER = 0.05;
/** 물리 엔진 목표 FPS */
export const PHYSICS_FPS = 30;
/** 자동 슬립 판정 운동에너지 임계값 */
export const PHYSICS_SLEEP_THRESHOLD = 0.1;
/** 자동 슬립 필요 연속 프레임 수 */
export const PHYSICS_SLEEP_FRAMES = 15;

// ─── 모델 가격 ($ per 1M tokens) ───
// §4 — `MODEL_PRICING` 은 시드(폴백), 런타임 SSOT 는 `ModelRegistry`. 조회는 `getModelPricing` 로.

/**
 * 단가 한 벌 — 캐시 값은 입력가에서 파생(쓰기 ×1.25, 읽기 ×0.1). 예외 `cacheReadMultiplier`: Fable 5.1·Mythos 5.1 0.025×, Opus 5.5·Sonnet 5.5 0.05×.
 * `longPrompt` 캐시도 같은 배수, 부동소수 꼬리는 6자리에서 끊는다.
 */
function makePricing(
  input: number,
  output: number,
  cacheReadMultiplier = 0.1,
  longPrompt?: { aboveTokens: number; input: number; output: number },
): ModelPricing {
  const round = (v: number): number => Math.round(v * 1e6) / 1e6;
  const tier = (i: number, o: number): Omit<ModelPricing, 'longPrompt'> => ({
    input: i,
    output: o,
    cacheRead: round(i * cacheReadMultiplier),
    cacheWrite: round(i * 1.25),
  });
  const base = tier(input, output);
  if (!longPrompt) return base;
  return { ...base, longPrompt: { aboveTokens: longPrompt.aboveTokens, ...tier(longPrompt.input, longPrompt.output) } };
}

/** Haiku 5.5 길이 구간 요금 — 프롬프트가 10만 토큰을 넘는 요청은 전체가 $0.50/$2.50(이하 $0.10/$0.50, 확인 2026-10-15). 시드·패밀리 디폴트가 같이 쓴다. */
const HAIKU_5_5_PRICING: ModelPricing = makePricing(0.1, 0.5, 0.1, { aboveTokens: 100_000, input: 0.5, output: 2.5 });

/**
 * 풀ID → 가격 시드. 같은 패밀리도 값이 갈려(Sonnet 5 $2/$10 · 4.6 $3/$15) 아는 ID 는 여기 적는다. 출처: 공개 가격표 Model pricing(확인 2026-09-02, Sonnet 5.5·Haiku 5.5 는 2026-10-15).
 * 은퇴 모델도 남긴다 — 지난 세션 JSONL 의 ID 로 조회된다. 순서: 레지스트리 → 시드 → 패밀리 → `DEFAULT_PRICING`.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-fable-5-1': makePricing(10, 50, 0.025),
  'claude-fable-5': makePricing(10, 50),
  'claude-opus-5-5': makePricing(4, 20, 0.05), // 캐시 읽기만 0.05× — 가격표 각주 2(확인 2026-10-01)
  'claude-opus-5': makePricing(5, 25),
  'claude-opus-4-8': makePricing(5, 25),
  'claude-opus-4-7': makePricing(5, 25),
  'claude-opus-4-6': makePricing(5, 25),
  'claude-opus-4-5': makePricing(5, 25),
  'claude-opus-4-1': makePricing(15, 75),
  'claude-opus-4-0': makePricing(15, 75),
  'claude-sonnet-5-5': makePricing(2, 10, 0.05), // 캐시 읽기만 0.05× — 가격표 각주 2(확인 2026-10-15)
  'claude-sonnet-5': makePricing(2, 10),
  'claude-sonnet-4-6': makePricing(3, 15),
  'claude-sonnet-4-5': makePricing(3, 15),
  'claude-sonnet-4-0': makePricing(3, 15),
  'claude-haiku-5-5': HAIKU_5_5_PRICING, // 길이 구간 요금 — 10만 토큰 초과 요청은 5배
  'claude-haiku-4-5': makePricing(1, 5),
  // OpenAI Standard API rates per 1M tokens, checked 2026-10-13: https://developers.openai.com/api/docs/pricing
  // (older Codex models: https://developers.openai.com/api/docs/models/<model-id>). Token-cost equivalent, not a ChatGPT subscription charge.
  // No separate cache-write billing → 0 (uncached input covers it).
  'gpt-6-astra': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  'gpt-6.1-sol': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'gpt-6-sol': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'gpt-6-luna': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'gpt-5.6-sol': { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
  'gpt-5.6-terra': { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 },
  'gpt-5.6-luna': { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
  'gpt-5.5': { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
  'gpt-5.4': { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
  'gpt-5.4-mini': { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
  'gpt-5.4-nano': { input: 0.2, output: 1.25, cacheRead: 0.02, cacheWrite: 0 },
  'gpt-5.3-codex': { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
  'gpt-5.2-codex': { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
  'gpt-5.2': { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
  'gpt-5.1-codex-max': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  'gpt-5.1-codex-mini': { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 },
  'gpt-5.1-codex': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  'gpt-5.1': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  'gpt-5-codex': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  'gpt-5': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
};

/** 모르는 모델의 최종 폴백 = 현행 최고가 티어(Fable $10/$50 — 은퇴 모델 단가는 현행보다 비싸 부풀린다). 캐시 읽기는 표준 0.1×(할인 배수면 과소계상). */
export const DEFAULT_PRICING: ModelPricing = makePricing(10, 50);

/**
 * §4 — 패밀리 디폴트(처음 보는 ID 폴백). `/v1/models` 는 가격을 주지 않아 그 패밀리의 현재 latest 단가로 추정한다 — latest 가 아니면 시드가 놓친 세션의 비용·컨텍스트가 몇 배씩 틀린다(§4 ⑧).
 * fable/mythos 도 채운다 — 빠지면 `DEFAULT_*` 로 떨어져 컨텍스트가 5배 과소로 잡힌다.
 */
export const MODEL_FAMILY_DEFAULTS: Record<KnownModelFamily, { contextWindow: number; pricing: ModelPricing }> = {
  fable:  { contextWindow: 1_000_000, pricing: makePricing(10, 50, 0.025) },
  mythos: { contextWindow: 1_000_000, pricing: makePricing(10, 50, 0.025) },
  opus:   { contextWindow: 1_000_000, pricing: makePricing(4, 20, 0.05) },
  sonnet: { contextWindow: 1_000_000, pricing: makePricing(2, 10, 0.05) },
  haiku:  { contextWindow: 1_000_000, pricing: HAIKU_5_5_PRICING },
};

/** §4 — 표에서 직접 읽는다(손으로 적은 목록은 패밀리 추가 때 잊혀 조용히 폴백된다). */
export function isKnownFamily(family: string | undefined | null): family is KnownModelFamily {
  return !!family && Object.prototype.hasOwnProperty.call(MODEL_FAMILY_DEFAULTS, family);
}

/** §4 — 풀ID 에서 패밀리 추론(임의 패밀리 수용). 패밀리 뒤에 숫자가 와야 한다 — `claude-code-…` 같은 비모델 문자열을 거른다. */
export function parseFamilyFromFullId(id: string | undefined | null): ModelFamily | undefined {
  if (!id) return undefined;
  const m = /^claude-([a-z]+)-\d/.exec(id);
  return m?.[1] as ModelFamily | undefined;
}

/** §4 — 풀ID 의 (major, minor), minor 없으면 0. latest 선정·드롭다운 정렬의 공통 정규식(클라/서버가 갈라지지 않게). */
export function parseModelSemver(id: string): [number, number] {
  const m = /^claude-[a-z]+-(\d+)(?:-(\d{1,2}))?$/.exec(id);
  if (!m) return [0, 0];
  return [Number(m[1]), m[2] ? Number(m[2]) : 0];
}

/** §4 — 풀ID → 가격(순서는 `resolveModelPricing`). registry 없이도 부른다. */
export function getModelPricing(modelId: string | undefined | null, registry?: ModelRegistry | null): ModelPricing {
  return resolveModelPricing(modelId, registry).pricing;
}

/**
 * §4 — 조회용 정규화: 날짜형(`claude-haiku-4-5-20251001` — 트랜스크립트에 그대로 남는다, 실측 2026-09-02)·`[1m]` 꼬리를 뗀다.
 * 안 떼면 시드를 빗나가 패밀리 디폴트로 떨어진다. 그래도 못 찾으면 "추정" 표식.
 */
export function normalizeModelId(id: string): string {
  const base = id.replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '');
  // OpenAI snapshots use YYYY-MM-DD (for example, gpt-5.1-2025-11-13).
  return base.startsWith('gpt-') ? base.replace(/-\d{4}-\d{2}-\d{2}$/, '') : base;
}

/** §4 — 단가 출처(화면 "추정" 표식이 쓴다). `registry`/`seed` = 아는 값, `family`/`default` = 폴백 환산(자릿수가 틀릴 수 있다). */
export type ModelPricingSource = 'registry' | 'seed' | 'family' | 'default';

/** 단가 + 출처 — 해소 순서는 이 한 벌(`getModelPricing` 은 껍데기). 레지스트리·시드는 정규화한 ID 로도 한 번 더 찾는다. */
export function resolveModelPricing(
  modelId: string | undefined | null,
  registry?: ModelRegistry | null,
): { pricing: ModelPricing; source: ModelPricingSource } {
  if (!modelId) return { pricing: DEFAULT_PRICING, source: 'default' };
  const base = normalizeModelId(modelId);
  const entry = registry?.entries.find((e) => e.id === modelId || e.id === base);
  if (entry?.pricing) return { pricing: entry.pricing, source: 'registry' };
  const seed = MODEL_PRICING[modelId] ?? MODEL_PRICING[base];
  if (seed) return { pricing: seed, source: 'seed' };
  const family = parseFamilyFromFullId(base);
  if (isKnownFamily(family)) return { pricing: MODEL_FAMILY_DEFAULTS[family].pricing, source: 'family' };
  return { pricing: DEFAULT_PRICING, source: 'default' };
}

/** "추정"으로 표시할 금액인가 — 폴백 환산이거나 모델 이름이 없는 턴(표식 없이 그리면 사실로 읽힌다). */
export function isPricingEstimated(modelId: string | undefined | null, registry?: ModelRegistry | null): boolean {
  const source = resolveModelPricing(modelId, registry).source;
  return source === 'family' || source === 'default';
}

/** §4 — 풀ID → 컨텍스트 한도(토큰). 순서는 `getModelPricing` 과 같다. */
export function getModelContextLimit(modelId: string | undefined | null, registry?: ModelRegistry | null): number {
  return resolveModelContextLimit(modelId, registry).contextWindow;
}

/**
 * 컨텍스트 한도 + 그 출처. `resolveModelPricing` 과 **같은 골격**이다 — 한쪽만 정규화를 타면
 * 같은 ID 가 단가는 맞고 한도는 틀리는, 화면에서 절대 못 알아챌 어긋남이 생긴다.
 */
export function resolveModelContextLimit(
  modelId: string | undefined | null,
  registry?: ModelRegistry | null,
): { contextWindow: number; source: ModelPricingSource } {
  if (!modelId) return { contextWindow: DEFAULT_CONTEXT_LIMIT, source: 'default' };
  const base = normalizeModelId(modelId);
  const entry = registry?.entries.find((e) => e.id === modelId || e.id === base);
  if (entry?.contextWindow) return { contextWindow: entry.contextWindow, source: 'registry' };
  const seed = MODEL_CONTEXT_LIMITS[modelId] ?? MODEL_CONTEXT_LIMITS[base];
  if (seed) return { contextWindow: seed, source: 'seed' };
  const family = parseFamilyFromFullId(base);
  if (isKnownFamily(family)) return { contextWindow: MODEL_FAMILY_DEFAULTS[family].contextWindow, source: 'family' };
  return { contextWindow: DEFAULT_CONTEXT_LIMIT, source: 'default' };
}

/** §4 — alias → 레지스트리 latest 풀ID. UI 라벨("Latest = X") 전용 — CLI 인자엔 alias 를 그대로 넘긴다(CLI 가 해소). 시드 폴백 ❌. */
export function resolveAliasToLatest(alias: string | undefined | null, registry?: ModelRegistry | null): string | undefined {
  if (!alias) return undefined;
  // 레지스트리가 찾은 미지 패밀리도 해소된다. 없으면 undefined(UI 는 "Latest" 만).
  return registry?.entries.find((e) => e.family === alias && e.isLatestOfFamily)?.id;
}

/**
 * 한 요청의 프롬프트 길이(입력 + 캐시 읽기 + 캐시 쓰기)로 단가 한 벌을 고른다.
 * 구간 요금(`longPrompt`)이 없거나 문턱 **이하**면 기본 단가 그대로다 — 가격표는 "over 100,000 tokens" 만 장문이다.
 */
export function pricingForPromptTokens(pricing: ModelPricing, promptTokens: number): ModelPricing {
  const long = pricing.longPrompt;
  if (!long || !(promptTokens > long.aboveTokens)) return pricing;
  return { input: long.input, output: long.output, cacheRead: long.cacheRead, cacheWrite: long.cacheWrite };
}

/** 토큰 → 비용($). `singleRequest` = API 요청 한 번의 토큰일 때만 길이 구간 요금을 가른다 — 합친 값에 문턱을 대면 짧은 요청들이 모여 전부 장문 단가(5배)가 된다. */
export function calculateTokenCost(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreateTokens: number,
  model?: string,
  registry?: ModelRegistry | null,
  opts?: { singleRequest?: boolean },
): { total: number; input: number; output: number; cacheRead: number; cacheWrite: number } {
  const base: ModelPricing = getModelPricing(model, registry);
  const p: ModelPricing = opts?.singleRequest
    ? pricingForPromptTokens(base, inputTokens + cacheReadTokens + cacheCreateTokens)
    : base;
  const input = (inputTokens / 1_000_000) * p.input;
  const output = (outputTokens / 1_000_000) * p.output;
  const cacheRead = (cacheReadTokens / 1_000_000) * p.cacheRead;
  const cacheWrite = (cacheCreateTokens / 1_000_000) * p.cacheWrite;
  return { total: input + output + cacheRead + cacheWrite, input, output, cacheRead, cacheWrite };
}

// ─── 에이전트 설정 ───

/** 선택 가능한 모델 패밀리 (드롭다운 · JSONL ID 파싱 기준). CLI `--model`도 이 값을 그대로 받음. */
export const AVAILABLE_AGENT_MODELS: readonly string[] = [
  'opus', 'sonnet', 'haiku', 'fable',
];

/**
 * 버전 드롭다운 풀ID 시드 — 출처는 공개 문서(모델 개요표·Claude Code 모델 설정 문서). 실행본 스캔 ❌(약관 §3 역설계 금지). 비면 패밀리 목록·드롭다운이 빈다.
 * 키가 있으면 `/v1/models` 가 덮고, 없으면 여기가 전부라 새 모델이 나오면 갱신한다(날짜형 변형 ❌).
 * ⚠ alias 해소에도 쓰인다 — CLI 가 모르는 bare alias(fable 등)는 `subAgentManager` 가 여기 latest 로 바꾼다. 뒤처지면 최신을 골라도 구모델이 뜬다.
 */
export const AVAILABLE_AGENT_MODEL_FULL_IDS: readonly string[] = [
  'claude-fable-5-1',
  'claude-fable-5',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
  'claude-sonnet-5',
  'claude-haiku-5-5',
  'claude-haiku-4-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
];

/** §4 — 시드 → `ModelRegistryEntry[]`(`ModelRegistryService` 가 부팅 때 먼저 적재). */
export const MODEL_SEED_ENTRIES: readonly ModelRegistryEntry[] = AVAILABLE_AGENT_MODEL_FULL_IDS.map((id): ModelRegistryEntry => {
  const family = parseFamilyFromFullId(id);
  return {
    id,
    family: family ?? 'opus',
    contextWindow: MODEL_CONTEXT_LIMITS[id],
    pricing: MODEL_PRICING[id],
    source: 'seed',
  };
});

/** §4 (상태바 모델 칸 ③(나)) — `/v1/models` 가 낡았다고 보는 나이(ms). 부팅 캐시 신선도와 켜 둔 동안의 재조회 주기가 같이 쓴다. */
export const MODEL_REGISTRY_API_TTL_MS = 6 * 60 * 60 * 1000;

/** §4 (상태바 모델 칸 ③(나)) — `/v1/models` 가 실패했을 때 다시 두드리기까지 기다리는 시간(ms). */
export const MODEL_REGISTRY_RETRY_MS = 15 * 60 * 1000;

/**
 * §4 (상태바 모델 칸 ③) — 모델 창을 열 때의 "한 번 더 확인" 하한(ms).
 * 창을 연달아 열고 닫아도 API 는 이 간격 안에서 한 번만 부른다(실행본 확인은 싸서 매번 한다).
 */
export const MODEL_REGISTRY_MANUAL_REFRESH_FLOOR_MS = 5 * 60 * 1000;

/**
 * §4 (상태바 모델 칸 ③(다)) — 대화록에서 배운 모델 ID 를 캐시에 남기는 개수 상한.
 * 한 번 본 모델은 낡지 않아 시간 만료를 두지 않으므로 **개수**로 막는다(§9 — 키 개수엔 캡이 없다).
 */
export const MODEL_REGISTRY_OBSERVED_MAX = 64;

/** §4 — alias ∪ 풀ID(`--model` 가드). 시드 한정 — `buildConfigArgs` 는 런타임 레지스트리를 먼저 본다. */
export const AVAILABLE_AGENT_MODEL_IDS: readonly string[] = [
  ...AVAILABLE_AGENT_MODELS,
  ...AVAILABLE_AGENT_MODEL_FULL_IDS,
];

/** §4 — Opus 패밀리인가(1M 토글 노출/적용 가드). */
export function isOpusModel(modelId: string | undefined | null): boolean {
  if (!modelId) return false;
  if (modelId === 'opus') return true;
  return /^claude-opus-/.test(modelId);
}

/**
 * §4 — Effort 칸이 열리는 패밀리. 공식 개요표(2026-10-15)가 넷 다 effort 기본값을 적고 2.1.300 실측에서 옛 Sonnet/Haiku 4.5 도 `--effort` 를 받았다.
 * 레지스트리가 새로 알린 패밀리는 열기로 정하기 전엔 넣지 않는다.
 */
export const EFFORT_MODEL_FAMILIES: readonly string[] = ['opus', 'fable', 'sonnet', 'haiku'];

/** Effort 칸을 열어도 되는 모델인가(alias·풀ID 모두, 풀ID 는 패밀리로 접는다). 로컬·코덱스 버블은 부르는 쪽이 가린다. */
export function supportsEffortSelection(modelId: string | undefined | null): boolean {
  if (!modelId) return false;
  if (EFFORT_MODEL_FAMILIES.includes(modelId)) return true;
  const family = parseFamilyFromFullId(modelId);
  return family !== undefined && EFFORT_MODEL_FAMILIES.includes(family);
}

/** §4 (스트림 3종 ①) — 중첩 서브에이전트 텍스트 전달. 기본 켬이라 명시 `false` 만 끔 — 서버 인자와 클라 체크박스가 이 함수 하나를 본다. */
export function isForwardSubagentTextEnabled(value: boolean | undefined): boolean {
  return value !== false;
}

/** §4 — 확장 사고가 켜져 있는가: 명시 `false` 만 끔(설치본 스키마 `alwaysThinkingEnabled` 의 "absent or true → enabled"). 서버 설정 조립·클라 체크박스가 같이 쓴다. */
export function isThinkingEnabled(value: boolean | undefined): boolean {
  return value !== false;
}

/**
 * §4 — 사고를 끌 수 없는 모델(공개 문서 근거 있는 ID 만): 개요표 "Adaptive (always on)" 인 Opus 5.5·Fable 5.1 과 Fable 5. API 가 `thinking: disabled` 를 400 으로 거부한다(확인 2026-10-15).
 * 끌 수 있는 Sonnet 5.5(`between_tools`)·근거 없는 Haiku 5.5 는 넣지 않는다 — 모르는 것을 잠그지 않는다.
 */
export const THINKING_ALWAYS_ON_MODEL_IDS: readonly string[] = [
  'claude-fable-5-1',
  'claude-fable-5',
  'claude-opus-5-5',
];

/** §4 — 이 모델은 사고를 끌 수 없는가(설정창 잠금·상태바 「확장 사고 꺼짐」 칸이 같이 쓴다). alias 는 지금 가리키는 최신 풀ID 로 본다(레지스트리 latest, 없으면 시드). */
export function isThinkingAlwaysOnModel(modelId: string | undefined | null, registry?: ModelRegistry | null): boolean {
  if (!modelId) return false;
  let full = modelId;
  if (AVAILABLE_AGENT_MODELS.includes(modelId)) {
    const latest = resolveAliasToLatest(modelId, registry)
      ?? AVAILABLE_AGENT_MODEL_FULL_IDS
        .filter((id) => parseFamilyFromFullId(id) === modelId)
        .sort((a, b) => {
          const [aMaj, aMin] = parseModelSemver(a);
          const [bMaj, bMin] = parseModelSemver(b);
          return bMaj - aMaj || bMin - aMin;
        })[0];
    if (!latest) return false;
    full = latest;
  }
  return THINKING_ALWAYS_ON_MODEL_IDS.includes(normalizeModelId(full));
}

/**
 * §4 (Fast 모드) — 설치본 CLI 판정을 옮겼다: capability `fast_mode` 거나 ID 에 `opus-4-8`/`opus-5` 가 있을 때만, 그 밖은 사유 없이 `off`(실측). 최종 판정은 CLI.
 * bare `'opus'` 는 true(CLI 가 latest 로 해소), 핀한 옛 판은 false, `[1m]` 은 그대로(실측).
 */
export function supportsFastMode(modelId: string | undefined | null): boolean {
  if (!modelId) return false;
  const id = modelId.toLowerCase();
  if (id === 'opus') return true;
  return id.includes('opus-4-8') || id.includes('opus-5');
}

/** JSONL model ID → 패밀리(임의 패밀리 수용 — 새 패밀리 세션도 버블에 뜬다). 실패 시 undefined. */
export function parseModelFamily(modelId: string | undefined | null): string | undefined {
  return parseFamilyFromFullId(modelId);
}

/** §4 — 드롭다운 패밀리 = 레지스트리 패밀리 ∪ 기본 3종(opus/sonnet/haiku 먼저, 나머지 알파벳순). 레지스트리가 비어도 기본 3종은 있다. */
export function listModelFamilies(registry?: ModelRegistry | null): string[] {
  const found = new Set<string>(AVAILABLE_AGENT_MODELS);
  for (const e of registry?.entries ?? []) {
    if (e.family) found.add(e.family);
  }
  const known = AVAILABLE_AGENT_MODELS.filter((f) => found.has(f));
  const extra = [...found].filter((f) => !AVAILABLE_AGENT_MODELS.includes(f)).sort();
  return [...known, ...extra];
}

/** §4 — 공식 도구 표(`code.claude.com/docs/en/tools-reference`, 2.1.278) 46종 대조본. `AVAILABLE_AGENT_TOOLS` 에서 빠진 도구는 어느 검사에도 안 걸려 회귀로 고정한다. */
export const CLI_BUILTIN_TOOLS: readonly string[] = [
  'Agent', 'Artifact', 'AskUserQuestion', 'Bash', 'CronCreate', 'CronDelete', 'CronList',
  'Edit', 'EndConversation', 'EnterPlanMode', 'EnterWorktree', 'ExitPlanMode', 'ExitWorktree',
  'Glob', 'Grep', 'ListAgents', 'ListMcpResourcesTool', 'LSP', 'Monitor', 'NotebookEdit',
  'PowerShell', 'PushNotification', 'Read', 'ReadMcpResourceTool', 'RemoteTrigger',
  'ReportFindings', 'ScheduleWakeup', 'SendFeedback', 'SendMessage', 'SendUserFile',
  'ShareOnboardingGuide', 'Skill', 'SubagentHandback', 'TaskCreate', 'TaskGet',
  'TaskList', 'TaskOutput', 'TaskStop', 'TaskUpdate', 'TodoWrite', 'ToolSearch',
  'WaitForMcpServers', 'WebFetch', 'WebSearch', 'Workflow', 'Write',
];

/**
 * §4 — 공식 표에서 사라졌지만 계속 보내는 이름(`Bash`·`Monitor`·`Task*`·`Edit` 으로 갈렸다). CLI 가 모르는 이름을 거부하지 않아(실측) 남겨도 잃는 게 없고,
 * 살아 있는 별칭이면 지울 때 능력을 뺏는다. 제거가 확인되면 이 배열만 비운다.
 */
export const LEGACY_AGENT_TOOLS: readonly string[] = ['BashOutput', 'KillShell', 'MultiEdit'];

/** §4 규약 (3) — 선택 가능한 내장 도구. `--tools` 를 늘 명시하므로 여기 없는 도구는 에이전트에게 없다(능력의 상한). ⚠ 새 도구를 넣으면 `AGENT_TOOLS_BACKFILL_GEN` 을 올린다. */
export const AVAILABLE_AGENT_TOOLS: readonly string[] = [
  // ── 파일·검색 ──
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit',
  // ── 실행 ──
  //   `PowerShell` 은 Windows 네이티브 셸 도구다. 우리 주력 플랫폼인데 목록에 없어서, 윈도우
  //   에이전트가 PowerShell 을 쓰려면 `Bash` 안에서 우회하는 수밖에 없었다.
  'Bash', 'PowerShell',
  // ── 코드 인텔리전스 ──
  //   정의로 점프·참조 찾기·타입 오류 보고. IDE(§5.5)를 얹어 놓고 정작 에이전트에게는 이 도구가
  //   없어서, 우리 에이전트는 텍스트 검색으로만 코드를 읽었다.
  'LSP',
  // ── 위임·오케스트레이션 ──
  // `SubagentHandback` 을 빼면 위임받은 자식이 부모 대화에 결과를 건넬 길이 없다.
  'Agent', 'Workflow', 'ListAgents', 'SendMessage', 'SubagentHandback', 'TaskOutput', 'TaskStop',
  // ── 작업(Task) 장부 ──
  //   `TaskCreated`/`TaskCompleted` 훅이 발화하는 바로 그 도구들이다(§3.6). 이게 없으면 훅을
  //   등록해도 영영 한 건도 오지 않는다 — 목표 창(§5.5 #17-17)과 한 쌍으로 다룬다.
  'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'TodoWrite',
  // ── 모드·워크트리 ──
  // 들어가는 쪽(`EnterPlanMode`·`EnterWorktree`)이 없으면 세션 도중엔 들어갈 수단이 없다.
  'EnterPlanMode', 'ExitPlanMode', 'EnterWorktree', 'ExitWorktree',
  // ── 사용자에게 닿는 것 ──
  //   `PushNotification` 은 데스크톱 알림 + Remote Control 연결 시 폰 푸시까지 간다.
  'AskUserQuestion', 'PushNotification', 'SendUserFile', 'RemoteTrigger',
  'SendFeedback', 'ShareOnboardingGuide', 'ReportFindings', 'EndConversation',
  // ── 예약 실행 ──
  'ScheduleWakeup', 'CronCreate', 'CronList', 'CronDelete',
  // ── 웹·산출물 ──
  'WebSearch', 'WebFetch', 'Artifact',
  // ── 스킬 ──
  'Skill',
  // ── 배경 관찰 ──
  'Monitor',
  // ── MCP ──
  'ToolSearch', 'ListMcpResourcesTool', 'ReadMcpResourceTool', 'WaitForMcpServers',
  // ── 공식 표에서 내려갔지만 계속 실어 보내는 이름 (위 주석 참고) ──
  ...LEGACY_AGENT_TOOLS,
];

/**
 * §5.5 #17-17 ⑨ — 복원 때 한 번 채우는 도구 = 전체 목록(옛 설정엔 화면에 없어서 빠진 도구가 있다). 복원 경로에서만 채운다(이후 해제는 되살리지 않는다).
 * 손으로 나열하지 마라 — 새 도구 때 잊으면 옛 에이전트만 영영 못 갖는다.
 */
export const BACKFILL_AGENT_TOOLS: readonly string[] = [...AVAILABLE_AGENT_TOOLS];

/**
 * §4 — 백필 세대: 이보다 낮은 설정에만 한 번 돈다(없으면 매 복원마다 해제한 도구를 되살린다). ⚠ 새 도구를 넣으면 1 올려라 — 안 올리면 기존 에이전트는 새 도구를 못 갖는다.
 * 세대: 1 `TodoWrite` · 2 공식 표 45종 · 3 `SubagentHandback`.
 */
export const AGENT_TOOLS_BACKFILL_GEN = 3;

/**
 * §4 — 세대 도장 전 한 번만 새 도구를 채운다. 대상 셋(오버라이드·옛 저장분·전역 프리셋 `UserDefaults.agentConfig`) — 프리셋을 빼면 새 에이전트 전부의 상한이 되고 회복되지 않는다.
 * `tools` 가 없으면 그대로 — "고르지 않았다"이지 "비워 뒀다"가 아니다.
 */
export function backfillAgentTools<T extends Partial<AgentConfig>>(config: T): T {
  if (!Array.isArray(config.tools)) return config;
  if ((config.toolsBackfillGen ?? 0) >= AGENT_TOOLS_BACKFILL_GEN) return config;
  const missing = BACKFILL_AGENT_TOOLS.filter((t) => !config.tools!.includes(t));
  // 채울 게 없어도 도장은 찍는다 — 안 그러면 다음 복원에서 또 판정하러 들어온다.
  return { ...config, tools: [...config.tools, ...missing], toolsBackfillGen: AGENT_TOOLS_BACKFILL_GEN };
}

/** §5.3 #12-2 — AskUserQuestion 요청 타임아웃(60s, permissionBroker 와 같은 창) */
export const ASK_USER_QUESTION_TIMEOUT_MS = 60_000;

/** §4 — 옵션창 Version 탭: 설치본 하나당 `--version` probe 타임아웃(정상 응답 수십 ms) */
export const CLAUDE_VERSION_PROBE_TIMEOUT_MS = 2_500;

/** §4 — 옵션창 Version 탭: 다중 설치본 스캔 때 probe 할 최대 후보 수(폭주 가드) */
export const CLAUDE_INSTALL_SCAN_MAX = 24;

// ─── 앱 전용 엔진 (§4) ───
// 클로드·코덱스 실행본을 공식 배포처에서 받아 `~/.vibisual/cli-engines/<엔진>` 에 깐다. 인스톨러 동봉 ❌ — Claude Code 는 재배포 허락이 없고, 받는 곳은 문서의 공식 배포처뿐이다.
// 출처: https://code.claude.com/docs/en/setup · https://github.com/openai/codex/releases (Apache-2.0)

/** 앱 전용 엔진 폴더 이름(`~/.vibisual/<이름>/<엔진>`). 올모델 엔진(`~/.vibisual/engine`)과 같은 층이다. */
export const MANAGED_ENGINE_DIR_NAME = 'cli-engines';
/** 판 폴더 안 설치 메타 — 올모델 엔진(§5.19)의 같은 이름 메타와 같은 규약. */
export const MANAGED_ENGINE_META_NAME = '.vibisual-engine.json';
/** 사용자가 [이전 판으로] 로 물린 판의 표식 파일 — 상태 JSON 을 따로 두지 않고 폴더를 훑어 안다. */
export const MANAGED_ENGINE_ROLLBACK_MARK = '.vibisual-rolled-back';
/** 남겨 둘 판 수 — 지금 쓰는 판 + 바로 앞 판(되돌릴 자리). */
export const MANAGED_ENGINE_KEEP_VERSIONS = 2;
/** 켜 둔 동안 새 판을 확인하는 간격(6시간). 켤 때 한 번은 따로 돈다. */
export const MANAGED_ENGINE_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 플래그 점검 한 번의 상한 — 프롬프트 없이 인자 검증에서 끝나는 실행이라 정상은 몇 초다. */
export const MANAGED_ENGINE_PROBE_TIMEOUT_MS = 20_000;
/** 동시에 띄우는 점검 수 — 판 하나에 수십 번 띄우므로 한꺼번에 띄우지 않는다. */
export const MANAGED_ENGINE_PROBE_CONCURRENCY = 4;
/** 받기 전에 남아 있어야 하는 디스크 — 받을 크기의 이 배수(받은 파일 + 풀거나 옮기는 몫). */
export const MANAGED_ENGINE_DISK_HEADROOM_RATIO = 2;
/** 배포처 조회(포인터 · manifest · 릴리스 API)의 상한. 받기 자체에는 걸지 않는다(수백 MB). */
export const MANAGED_ENGINE_LOOKUP_TIMEOUT_MS = 15_000;
/** 받는 동안 진행을 화면에 미는 간격 — 청크마다 보내면 전선이 진행률로 도배된다. */
export const MANAGED_ENGINE_PROGRESS_PUSH_MS = 250;
/** 진행 줄 누적 상한 — 기존 설치 진행 칸과 같은 크기로 자른다. */
export const MANAGED_ENGINE_OUTPUT_MAX_CHARS = 20_000;
/** 받기 오류 뒤 재시도 간격 — 그 뒤로는 6시간 확인에 맡긴다. 점검 탈락은 다시 받아도 같은 판이라 재시도하지 않는다. */
export const MANAGED_ENGINE_RETRY_BACKOFF_MS: readonly number[] = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];
/** 받기가 이만큼 한 바이트도 못 받으면 끊고 실패로 적는다 — 없으면 멎은 받기가 그 엔진을 영영 "받는 중"으로 막는다. */
export const HELPER_DOWNLOAD_STALL_MS = 60_000;

/** Claude Code 공식 릴리스 저장소 — `latest` 포인터 · `<판>/manifest.json` · `<판>/<플랫폼>/<binary>`. */
export const CLAUDE_RELEASES_BASE_URL = 'https://downloads.claude.ai/claude-code-releases';
/** 코덱스 최신 릴리스 조회 — GitHub REST(공개 문서 API). prerelease 는 이 자리에 오지 않는다. */
export const CODEX_RELEASES_LATEST_API = 'https://api.github.com/repos/openai/codex/releases/latest';
/** 코덱스 릴리스 태그 접두사(`rust-v0.164.0`). */
export const CODEX_RELEASE_TAG_PREFIX = 'rust-v';
/** 코덱스 패키지 자산 이름 앞부분(`codex-package-<타깃>.tar.gz`). */
export const CODEX_PACKAGE_ASSET_PREFIX = 'codex-package-';
/** 코덱스 패키지 SHA-256 목록 자산 — 자산 `digest` 가 없을 때 이것으로 대조한다. */
export const CODEX_PACKAGE_CHECKSUM_ASSET = 'codex-package_SHA256SUMS';

/**
 * 앱 전용 claude 에만 얹어 엔진 자체 갱신을 전부 막는다(공식 문서가 자체 채널 배포용으로 지정한 값). 판은 앱이 바꾼다.
 * Version 탭에서 고른 자기 설치본에는 얹지 않는다 — 그 갱신은 그 주인의 것이다.
 */
export const CLAUDE_MANAGED_SPAWN_ENV: Readonly<Record<string, string>> = { DISABLE_UPDATES: '1' };
/** 앱 전용 코덱스 TUI 에 붙여 시작 시 업데이트 확인을 끈다 — 안 끄면 npm·brew 갱신을 권해 설치본을 따로 만들게 한다(`exec`·`app-server` 는 확인 안 함). */
export const CODEX_MANAGED_TUI_ARGS: readonly string[] = ['-c', 'check_for_update_on_startup=false'];

// §4 첫 실행 설치 온보딩 — 공식 네이티브 인스톨러로 `claude` CLI 를 깐다(Node 불필요 — npm 경로는 Node 가 있는 사람에게만 통한다).
// 출처: https://code.claude.com/docs/en/setup

/**
 * `irm | iex` 는 PowerShell 문법이라 명시 호출한다. `-NoProfile` = 프로필 스크립트의 방해 차단,
 * `-ExecutionPolicy Bypass` = 기본 정책(RemoteSigned)의 원격 스크립트 차단 회피(레지스트리 정책은 안 건드림).
 */
export const CLAUDE_SETUP_INSTALL_COMMAND_WIN =
  'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"';

/** macOS / Linux / WSL 네이티브 설치 명령. */
export const CLAUDE_SETUP_INSTALL_COMMAND_POSIX = 'curl -fsSL https://claude.ai/install.sh | bash';

/** 자동 설치가 막혔을 때의 탈출구 — 공식 설치 문서. */
export const CLAUDE_SETUP_DOCS_URL = 'https://code.claude.com/docs/en/setup';

/**
 * 인스톨러 실행 타임아웃. 바이너리 다운로드(수십 MB)가 느린 회선에서 오래 걸릴 수 있어
 * `claudeVersionService` 의 npm 설치 상한(5분)보다 넉넉하게 잡는다.
 */
export const CLAUDE_SETUP_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 설치 직후 재판정 재시도 간격/횟수. 인스톨러가 종료해도 PATH 반영·파일 flush 가 한 박자
 * 늦을 수 있어, 바로 실패로 단정하지 않고 짧게 몇 번 더 확인한다.
 */
export const CLAUDE_SETUP_VERIFY_RETRY_INTERVAL_MS = 1_500;
export const CLAUDE_SETUP_VERIFY_RETRY_MAX = 4;

/** 누적 출력 상한 — 인스톨러가 진행률을 대량으로 찍어도 메모리·전선이 부풀지 않게 자른다. */
export const CLAUDE_SETUP_OUTPUT_MAX_CHARS = 20_000;

/** 설치 뒤 게이트가 "준비 완료"를 보이고 스스로 닫히기까지 — 보고 있던 사람에게 확인만 남기므로 짧다. [계속]이면 즉시 로그인 단계로. */
export const CLAUDE_SETUP_READY_HOLD_MS = 1_600;

/** §4 — 앱을 켠 뒤 CLI 자동 업데이트까지의 지연. 설치(1.2s)·로그인(1.5s) 판정 뒤여야 하고(설치 온보딩이 먼저), 부팅 작업과도 겹치지 않게 민다. */
export const CLAUDE_AUTO_UPDATE_BOOT_DELAY_MS = 20_000;

/**
 * §3.6 — 부팅 후 훅 전송 경로(HTTP 승격) 재판정 지연. 설치 판정(1.2s) 뒤·자동 업데이트(20s) 앞 — 지금 판올림으로 먼저 승격하고
 * 업데이트 뒤 `onClaudeInstallSettled` 가 다시 판정한다.
 */
export const HOOK_TRANSPORT_REFRESH_DELAY_MS = 4_000;

/**
 * §3.7 · §9 「창이 뜬 직후의 메인 스레드」 ② — 부팅 확인들은 본체 창이 처음 보인 뒤 한 칸씩 돈다(위 지연값은 순서만 정한다).
 * 부팅 기준이면 느린 부팅에서 창이 뜨는 순간 한꺼번에 터져 창이 제목줄로 안 움직인다. 창 소식이 없으면 `STARTUP_JOB_RELEASE_CAP_MS` 뒤 풀린다.
 */
export const STARTUP_JOB_SETTLE_MS = 1_500;
export const STARTUP_JOB_GAP_MS = 750;
export const STARTUP_JOB_RELEASE_CAP_MS = 20_000;

/**
 * §3.7 · §9 「시작 화면(스플래시)」 — 스플래시가 있으면 위 확인들을 그 뒤에서 먼저 돌리고 본체 창은 줄이 다 돈 뒤 보인다
 * (실측: 창이 뜬 뒤 +1.5s·+2.1s·+2.6s 멈춤이 사라진다). 간격은 0.3초(설치 1.2s → 로그인 1.5s)보다 좁히지 않는다.
 */
export const STARTUP_JOB_SPLASH_SETTLE_MS = 300;
export const STARTUP_JOB_SPLASH_GAP_MS = 400;

/** §3.7 · §9 — 본체 창이 main 에 "첫 화면을 그렸다"고 알리는 조건: 지금 탭이 칠해진 뒤 긴 작업(50ms+)이 QUIET 동안 없을 때, 늦어도 CAP 뒤(창이 영영 숨으면 안 된다). */
export const MAIN_WINDOW_READY_QUIET_MS = 300;
export const MAIN_WINDOW_READY_CAP_MS = 2_500;

/** STRICT 위임 집행(dispatch curl)이 Bash 에 의존해 잠근다 — UI 에서 못 빼고, strip 계산에서도 보존되며, 서버 PUT 은 빠지면 자동 포함한다. */
export const LOCKED_AGENT_TOOLS: readonly string[] = ['Bash'];

/**
 * 퍼미션 모드 — 설치된 CLI enum 과 같은 6종(§4). `'default'` 는 저장값, 표시명은 Manual(옛 체크포인트 호환이라 바꾸지 않는다).
 * `auto` = 모델 분류기 · `dontAsk` = 사전 승인 없으면 거부(CLI 2.1.223 실측). 승인 게이트 매핑은 §5.3 #12-1.
 * ⚠ 저장값을 그대로 CLI 에 넘기지 마라 — 변환은 `toCliPermissionMode` 한 곳.
 */
export const AVAILABLE_PERMISSION_MODES: readonly string[] = [
  'default', 'acceptEdits', 'auto', 'dontAsk', 'plan', 'bypassPermissions',
];

/**
 * §4 — 저장값 → CLI `--permission-mode` 값. 모든 모드를 명시한다 — CLI 무플래그 기본이 2026-08-14 부터 `auto`(자동 승인)라
 * 빼면 Manual 로 보이는 에이전트가 자동 승인으로 돈다(`manual` 은 CLI 2.1.251 `--help` 에 실재). `bypassPermissions` 는 전용 플래그라 표에 없다.
 */
export const PERMISSION_MODE_CLI_VALUES: Readonly<Record<string, string>> = {
  default: 'manual',
  acceptEdits: 'acceptEdits',
  auto: 'auto',
  dontAsk: 'dontAsk',
  plan: 'plan',
};

/** 표에 없으면 `null` — `bypassPermissions`(전용 플래그)이거나 모르는 값이라 플래그를 흘리지 않는다. */
export function toCliPermissionMode(mode: string | undefined | null): string | null {
  if (!mode) return PERMISSION_MODE_CLI_VALUES['default'] ?? null;
  return PERMISSION_MODE_CLI_VALUES[mode] ?? null;
}

/** §4 — 서브에이전트 이름 규칙(공식 문서): 소문자·숫자·하이픈, 하이픈 시작·`:` ❌. CLI 가 거부하면 그 에이전트가 통째로 못 뜨므로 미리 다듬는다. */
export function normalizeAgentDefinitionName(raw: string | undefined | null): string {
  if (!raw) return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')   // 공백·언더스코어·콜론·한글 전부 하이픈으로
    .replace(/-{2,}/g, '-')          // 연달아 생긴 하이픈은 하나로
    .replace(/^-+|-+$/g, '')         // 앞뒤 하이픈 제거(선두 하이픈은 CLI 가 거부)
    .slice(0, AGENT_DEFINITION_NAME_MAX)
    .replace(/-+$/g, '');            // 자른 자리에 남은 끝 하이픈도 뗀다
}

/** §4 — 서브에이전트 이름 상한. CLI 2.1.292 부터 최대 256자(공식 변경 기록 — 더 긴 `name` 은 무시된다). 이름 칸·정규화가 같은 값을 쓴다. */
export const AGENT_DEFINITION_NAME_MAX = 256;

/**
 * §4 — `AgentDefinition[]` → `--agents` 의 이름 키 객체 JSON. 넘길 게 없으면 `null`(플래그를 안 붙인다 — `{}` 는 판본에 따라 파일 기반 에이전트를 가린다).
 * 빈 칸이 있는 항목과 앞엣것과 이름이 겹치는 항목은 버린다(객체 키라 조용히 덮어쓴다).
 */
export function buildAgentsFlagJson(defs: readonly AgentDefinition[] | undefined | null): string | null {
  if (!Array.isArray(defs) || defs.length === 0) return null;
  const out: Record<string, Record<string, unknown>> = {};
  for (const def of defs) {
    if (!def || typeof def !== 'object') continue;
    const name = normalizeAgentDefinitionName(def.name);
    const description = typeof def.description === 'string' ? def.description.trim() : '';
    const prompt = typeof def.prompt === 'string' ? def.prompt.trim() : '';
    if (!name || !description || !prompt) continue;
    if (Object.prototype.hasOwnProperty.call(out, name)) continue;
    const entry: Record<string, unknown> = { description, prompt };
    const tools = def.tools?.filter((t: string) => typeof t === 'string' && t.trim().length > 0);
    if (tools && tools.length > 0) entry['tools'] = tools;
    const model = typeof def.model === 'string' ? def.model.trim() : '';
    if (model) entry['model'] = model;
    out[name] = entry;
  }
  return Object.keys(out).length > 0 ? JSON.stringify(out) : null;
}

/** §4 — `--plugin-dir` 목록 정리(공백·빈 줄·중복 제거 — 중복이면 두 번 로드). 경로는 손대지 않는다 — 대소문자·구분자를 바꾸면 리눅스에서 다른 폴더다. */
export function normalizePluginDirs(dirs: readonly string[] | undefined | null): string[] {
  if (!Array.isArray(dirs)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of dirs) {
    if (typeof raw !== 'string') continue;
    const dir = raw.trim();
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  return out;
}/**
 * §5.3 #12-1 — 승인 팝업이 원천적으로 안 뜨는 모드. 이 모드에서는 "60초 무응답 정책"
 * (`permissionTimeoutPolicy`) 이 무의미하므로 UI 가 그 토글을 숨긴다.
 * `dontAsk` 는 팝업 대신 즉시 거부라 여기에 함께 들어간다.
 */
export const PERMISSION_MODES_WITHOUT_PROMPT: readonly string[] = [
  'bypassPermissions', 'plan', 'auto', 'dontAsk',
];

/**
 * §5.3 #12-1-A — 승인 팝업이 뜰 수 있는가(`permissionTimeoutPolicy` 토글 표시). `askTools` 가 있으면 `bypassPermissions`·`auto` 에서도 뜬다 —
 * 그때 숨기면 60초 무응답 정책을 고칠 수 없다. `plan`·`dontAsk` 는 늘 숨긴다(실행 없음·즉시 거부, 서버와 같은 규칙).
 */
export function canPromptForPermission(
  permissionMode: string | undefined,
  askTools: readonly string[] | undefined,
): boolean {
  const mode = permissionMode || 'default';
  if (mode === 'plan' || mode === 'dontAsk') return false;
  if (askTools && askTools.length > 0) return true;
  return !PERMISSION_MODES_WITHOUT_PROMPT.includes(mode);
}

/** 선택 가능한 격리 모드 */
export const AVAILABLE_ISOLATION_MODES: readonly string[] = [
  'none', 'worktree',
];

/**
 * §4 (CLI 사양 추종) — `--setting-sources` 가 받는 설정 계층. 부분집합을 골라 전달한다.
 * 빈 목록 = 플래그 미전달 = CLI 기본(전부 로드).
 */
export const AVAILABLE_SETTING_SOURCES: readonly string[] = ['user', 'project', 'local'];

/** §4 — 자동 압축 드롭다운 값: `''` 미설정(위층), `'off'` 꺼짐, `'auto'` 창 전체, 나머지 토큰 수. 눈금은 CLI 가 받는 100k~1M — 스폰엔 안 싣지만 창 하한이 이 눈금에서 고른다. */
export const AVAILABLE_AUTOCOMPACT_VALUES: readonly string[] = [
  '', 'off', 'auto', '100000', '200000', '400000', '500000', '1000000',
];

/**
 * §4 — "접지 않는다"의 우리 값. ⚠ CLI 에 보내지 마라 — `--autocompact off`·`0` 이면 즉시 종료한다(실측 2.1.252).
 * 스폰은 `--autocompact` 를 안 실어, 꺼짐/켜짐은 명령 사이 압축(턴 경계 발동선) 유무만 가른다. 비교는 이 상수로.
 */
export const AUTOCOMPACT_OFF = 'off';

/** `resolveAutoCompact` 가 돌려준 값이 "접는다"는 뜻인가. 꺼짐/빈 값이면 false. */
export function isAutoCompactOn(resolved: string): boolean {
  const v = resolved.trim();
  return v !== '' && v !== AUTOCOMPACT_OFF;
}

/**
 * §4 — 비용 확인 팝업이 인용하는 압축 1회 실측 표본(트랜스크립트 `compact_boundary` `runs` 회 집계). 숫자가 없으면 경고를 그냥 넘긴다.
 * ⚠ 팝업은 "실측 예"로 소개해야 한다 — 자기 환경의 확정 비용으로 읽히면 거짓이다.
 */
export const AUTOCOMPACT_COST_SAMPLE = {
  /** 집계한 압축 횟수 */
  runs: 23,
  /** 요약에 먹인 대화 크기(=입력 토큰) 평균 */
  avgInputTokens: 364_566,
  /** 접은 뒤 남은 컨텍스트 평균 */
  avgAfterTokens: 10_386,
  /** 1회가 멈춰 있던 시간(초) 평균 */
  avgSeconds: 150,
} as const;

/**
 * §4 — 비용 확인 팝업에서 켤 때 앉힐 권장 시작 창(내장 기본은 꺼짐). 실측 세션 최고점 213k·231k·255k·349k 바로 위라 평범한 세션은 안 걸린다.
 * 명령 사이 압축의 기준 창이다 — 접히는 자리는 `turnCompactTriggerTokens`.
 */
export const DEFAULT_AUTOCOMPACT_TOKENS = '400000';

/** §4 — 내장 기본 = 꺼짐. 압축은 대화 전체를 다시 먹이는 모델 호출이라(실측 23회: 회당 입력 평균 364,566 토큰·150초 정지) 비용 확인 팝업의 명시 선택으로만 켠다. */
export const DEFAULT_AUTOCOMPACT = AUTOCOMPACT_OFF;

/** §4 — 턴 경계·에이전트 요청 압축 명령. `SESSION_LOOP_COMPACT_COMMAND` 와 글자는 같지만 축이 다르다. 입력창에 치는 것과 같은 길(큐의 `QueuedCommand` 한 건). */
export const AGENT_COMPACT_COMMAND = '/compact';

/** `displayCommands` 가 읽는 최소 모양 — 서버 `QueuedCommand` 를 통째로 알 필요가 없다. */
export interface DisplayCommandLike {
  silent?: boolean;
  status?: string;
  subAgentId?: string | null;
  startedAt?: number;
}

/**
 * §5.3 #9-1 (P)(b) — 도는 조용한 압축의 진행 표시를 물려받는 명령(세션의 첫 대기 명령 하나) → 시작 시각. 압축이 대기 중이면 없다.
 * 화면(`displayCommands`)과 서버 두 중지 라우트가 이 규칙을 같이 써야 실행 중으로 보인 명령과 중지된 명령이 같다.
 */
export function silentPreCompactHeirs<T extends DisplayCommandLike>(list: readonly T[]): Map<T, number | undefined> {
  // 키는 **그 명령 객체**다 — id 를 몰라도 되고, 같은 배열을 도는 호출자가 그대로 `has` 로 묻는다.
  const heirs = new Map<T, number | undefined>();
  const runningSilent = new Map<string, number | undefined>();
  for (const c of list) {
    if (c.silent && c.status === 'executing' && typeof c.subAgentId === 'string') {
      runningSilent.set(c.subAgentId, c.startedAt);
    }
  }
  if (runningSilent.size === 0) return heirs;
  for (const c of list) {
    if (c.silent || c.status !== 'queued' || typeof c.subAgentId !== 'string') continue;
    if (!runningSilent.has(c.subAgentId)) continue;
    heirs.set(c, runningSilent.get(c.subAgentId));
    runningSilent.delete(c.subAgentId);
  }
  return heirs;
}

/**
 * §5.3 #9-1 (P)(b) — [즉시] 덧말이 끊을 도는 턴이 물려받은 명령이면 그것(아니면 `null`). CLI 인터럽트는 압축만 끊어, 안 그러면 압축 뒤 그 명령이 그대로 돈다.
 * 서버는 이 명령을 실행 중에 멈춘 명령처럼 봉합한다. `cmd` 가 바로 그 명령이면 압축만 비켜선다(`planSilentPreCompact` 와 같은 규율).
 */
export function heirCutByImmediate<T extends DisplayCommandLike>(
  list: readonly T[],
  cmd: T,
): { heir: T; startedAt: number | undefined } | null {
  if (typeof cmd.subAgentId !== 'string') return null;
  for (const [heir, startedAt] of silentPreCompactHeirs(list)) {
    if (heir.subAgentId !== cmd.subAgentId) continue;
    return heir === cmd ? null : { heir, startedAt };
  }
  return null;
}

/**
 * §5.3 #9-1 (P) — 화면용 명령 목록: 조용한 압축을 감추고 그 진행을 세션의 첫 대기 명령에 넘겨 실행 중으로 그린다(안 넘기면 멈춘 듯 "대기 중").
 * 사본만 바꾼다(§3.1). ⚠ `isSessionRunning` 계열에는 쓰지 마라 — 감춘 명령도 도는 명령이다.
 */
export function displayCommands<T extends DisplayCommandLike>(list: readonly T[] | undefined): readonly T[] {
  if (!list || list.length === 0) return list ?? [];
  // 대부분의 큐에는 조용한 명령이 하나도 없다 — 그때는 **같은 배열 참조를 그대로** 돌려줘
  //   구조적 공유(§9)로 안정화해 둔 참조를 매 스냅샷마다 새 배열로 깨뜨리지 않는다.
  if (!list.some((c) => c.silent)) return list;

  // 지금 도는 조용한 압축의 진행 표시를 물려받을 명령과, 물려줄 시작 시각 — 규칙은 한 곳이다.
  const heirs = silentPreCompactHeirs(list);

  const out: T[] = [];
  for (const c of list) {
    if (c.silent) continue;
    if (heirs.has(c)) {
      const startedAt = heirs.get(c);
      out.push({ ...c, status: 'executing', ...(c.startedAt === undefined && startedAt !== undefined ? { startedAt } : {}) });
      continue;
    }
    out.push(c);
  }
  return out;
}

/**
 * §4 — `agentCanCompact` 에이전트에게 매 턴 싣는 창구 안내. `SlashCommand` 도구는 헤드리스에 안 나와(실측 2.1.247) 서버에 신고하고,
 * 서버가 다음 명령 바로 앞에서 접는다(§5.3 #9-1 (P)). 토큰·주소는 스폰 env 에 있어 여기에 박지 않는다.
 */
export function buildAgentSelfCompactRule(agentId: string, subAgentId: string, shell: AgentRuleShell = 'posix'): string {
  const request = shell === 'powershell'
    ? agentPowershellRequest({ serverBase: '', endpoint: '/api/agent-compact', body: JSON.stringify({ agentId, subAgentId, reason: '왜 지금인지 한 줄' }) })
    : `\`\`\`bash
curl -s -X POST "\${VIBISUAL_BASE}/api/agent-compact" -H "x-vibisual-hook-token: ${AGENT_AUTH_POSIX}" \\
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
${JSON.stringify({ agentId, subAgentId, reason: '왜 지금인지 한 줄' })}
JSON
\`\`\``;
  return `

# 컨텍스트 압축 요청 (네가 판단해서 부른다)
대화가 길어져 컨텍스트가 무겁다고 느끼면, **일이 한 단락 끝난 안전한 자리에서** 아래를 1회 호출해라.
서버가 **다음 명령이 나가기 직전에** \`${AGENT_COMPACT_COMMAND}\` 를 돌려 대화를 요약으로 접는다 — 작업 도중에 잘리지 않는다.

${request}
- **압축은 세부를 잃는다.** 파일·git 에 남지 않은 결정은 부르기 전에 적어 둬라.
- 한 턴에 한 번이면 충분하다(여러 번 불러도 한 번만 돈다). 호출 사실은 사용자에게 보고하지 마라.
- 실패해도 무시하고 하던 일을 계속해라 — 표시·편의용이라 결과에 영향이 없다.`;
}

/**
 * §4 — 자동 압축 창의 단 하나의 판정(명령 사이 압축의 기준, 스폰엔 안 실린다). 에이전트 설정 → 설정 창 전역 기본 → 내장 기본 3층이라
 * `''` 는 꺼짐이 아니라 "위층을 따름"이다. 목록 밖 값은 내장 기본으로 — 발동선과 창 하한이 같은 눈금을 전제한다.
 */
export function resolveAutoCompact(agentValue?: string, userDefaultValue?: string): string {
  for (const raw of [agentValue, userDefaultValue]) {
    const v = raw?.trim();
    if (v && AVAILABLE_AUTOCOMPACT_VALUES.includes(v)) return v;
  }
  return DEFAULT_AUTOCOMPACT;
}

/**
 * §4 — 자동 압축 창 값을 토큰 수로(창 크기이지 접는 지점이 아니다 — 발동선은 `turnCompactTriggerTokens`). `'auto'` = 모델 창(`contextMax`).
 * 모르면 `null` = "아직 판정 불가"(모르는 채로 쏘면 매 턴 압축이 된다).
 */
export function autoCompactThresholdTokens(resolved: string, contextMax?: number): number | null {
  // 꺼짐이면 선 자체가 없다 — **가장 먼저 걸러야 한다.** `Number('off')` 는 NaN 이라
  // 아래 `contextMax` 폴백으로 굴러떨어지고, 그러면 꺼 둔 에이전트가 창 크기를 발동선으로
  // 삼아 접기 시작한다(끈 적이 없는 압축이 도는 자리다).
  if (!isAutoCompactOn(resolved)) return null;
  const n = Number(resolved);
  if (Number.isFinite(n) && n > 0) return n;
  return typeof contextMax === 'number' && contextMax > 0 ? contextMax : null;
}

/**
 * §4 — 턴 경계 발동선 = 자동 압축 값 × 비율(400k → 320k). 바꾸지 마라 — 명령 사이 압축 자리와 창 하한 산식(`minAutoCompactWindowTokens`)이 여기에 선다.
 * 한 지시 안에서는 접지 않는다(작업 도중 안전망은 모델 창 끝의 CLI 압축).
 */
export const TURN_COMPACT_TRIGGER_RATIO = 0.8;

/** §4 — 턴이 끝났을 때 접기 시작하는 토큰 수(화면 숫자도 이것). 자동 압축 값 하나에서 파생된다. 모르면 `null` = "아직 판정 불가". */
export function turnCompactTriggerTokens(resolved: string, contextMax?: number): number | null {
  const window = autoCompactThresholdTokens(resolved, contextMax);
  if (window === null) return null;
  return Math.round(window * TURN_COMPACT_TRIGGER_RATIO);
}

/**
 * §4 (5) 창 하한 — 압축 뒤 시작 문맥 위로 다시 얹히는 몫(요약·다시 읽는 파일·스킬 본문 — 공식: 파일 5개·각 5k, 스킬 25k)의 어림.
 * 2026-10-04 실측: 200k 창·시작 문맥 70.6k 세션의 압축 24회 직후 "문맥 − 시작 문맥" 중앙값 약 28k.
 */
export const COMPACT_RESTART_ALLOWANCE_TOKENS = 30_000;

/** §4 (5) 창 하한 — 새 세션의 창을 미리 적을 때 시작 문맥을 빌려 올 같은 에이전트 최근 세션 수. 턴 경계 판정은 늘 그 세션 자신의 값. */
export const COMPACT_FLOOR_SIBLING_SCAN = 3;

/**
 * §4 (5) 창 하한 — 압축이 일보다 잦아지지 않을 최소 창. R = 시작 문맥 + 다시 얹히는 몫, 일할 몫 = 창 × 비율 − R ≥ R ⇔ 창 ≥ 2R ÷ 비율.
 * 2026-10-04 실측: 200k 창에서 일할 몫 약 70k·압축이 세션 시간의 47%. 시작 문맥을 모르면 `null`(올리지 않는다).
 */
export function minAutoCompactWindowTokens(startupFloor: number | null | undefined): number | null {
  if (typeof startupFloor !== 'number' || !Number.isFinite(startupFloor) || startupFloor <= 0) return null;
  const restart = startupFloor + COMPACT_RESTART_ALLOWANCE_TOKENS;
  return Math.ceil((2 * restart) / TURN_COMPACT_TRIGGER_RATIO);
}

/** 창 하한이 고를 수 있는 눈금 — CLI 가 받는 숫자 값만, 작은 것부터(`AVAILABLE_AUTOCOMPACT_VALUES` 파생). */
const AUTOCOMPACT_WINDOW_LADDER: readonly number[] = AVAILABLE_AUTOCOMPACT_VALUES
  .map(Number)
  .filter((n) => Number.isFinite(n) && n > 0)
  .sort((a, b) => a - b);

/** `applyAutoCompactFloor` 의 답 — 실제로 실을 값과, 올렸다면 그 사실. */
export interface AutoCompactFloorResult {
  /** 발동선을 잡을 창 값(눈금 값·`'auto'`). 꺼짐·미설정이면 받은 값 그대로다. */
  value: string;
  /** 하한 때문에 올렸으면 원래 값. 안 올렸으면 키 자체가 없다. */
  raisedFrom?: string;
}

/**
 * §4 (5) 창 하한 — 해소된 창에 하한을 건다(턴 경계 판정과 화면이 같은 시작 문맥 출처로 부른다). 숫자 창만, 올리기만, 눈금 중 하한 이상 최소값으로.
 * 모델 창(`contextMax`)을 넘기지 않는다 — 넘기면 발동선(창 × 0.8)이 영영 안 닿는다.
 */
export function applyAutoCompactFloor(
  resolved: string,
  startupFloor?: number | null,
  contextMax?: number | null,
): AutoCompactFloorResult {
  const current = Number(resolved);
  if (!isAutoCompactOn(resolved) || !Number.isFinite(current) || current <= 0) return { value: resolved };
  const need = minAutoCompactWindowTokens(startupFloor);
  if (need === null || current >= need) return { value: resolved };
  const cap = typeof contextMax === 'number' && Number.isFinite(contextMax) && contextMax > 0 ? contextMax : Infinity;
  const ladder = AUTOCOMPACT_WINDOW_LADDER.filter((n) => n <= cap);
  if (ladder.length === 0) return { value: resolved };
  const target = ladder.find((n) => n >= need) ?? ladder[ladder.length - 1]!;
  if (target <= current) return { value: resolved };
  return { value: String(target), raisedFrom: resolved };
}

/** `shouldCompactAfterTurn` 이 받는 것 — 판정에 필요한 사실만. 서버 객체를 통째로 넘기지 않는다. */
export interface CompactAfterTurnInput {
  /** 이번 턴에 에이전트가 스스로 요청했나(`agentCanCompact` 창구). 요청은 발동선을 묻지 않는다. */
  requested: boolean;
  /** `AgentConfig.autoCompact` — 이 에이전트가 따로 정한 값. */
  autoCompact?: string;
  /** 설정 창(Agent Defaults)의 전역 기본값. */
  userAutoCompact?: string;
  /** 턴이 끝난 지금 컨텍스트가 몇 토큰 차 있나. 모르면 undefined. */
  contextUsed?: number;
  /** 그 모델의 창 크기. `'auto'` 일 때만 쓰인다. */
  contextMax?: number;
  /** §5.3 #9-1 (P축) — 마지막 압축 이후 턴 수(컨텍스트 축과 직교). 1M 창은 수백 턴에도 안 접히는데 비용의 96.5%가 `cache_read` 라(실측) 턴 누적 자체가 N² 비용이다. */
  turnsSinceCompact?: number;
  /** §5.3 #9-1 (P축) — 그 턴 수의 상한. 0/undefined = 이 축 끔(종전과 같은 판정). */
  turnBudget?: number;
  /** §5.3 #9-1 (Q축) — 토큰 절약이 조인 압축 창(`''`/undefined = 미설정). 명령 사이 압축의 발동선만 조인다. */
  tokenSaverAutoCompact?: string;
  /** §4 (5) — 이 세션의 시작 문맥(첫 응답 문맥 크기, 모르면 undefined = 하한 없음). 화면(`SubAgent.contextFloor`)과 같은 출처(`readContextInfo().firstContextUsed`)여야 한다. */
  startupFloor?: number;
}

/**
 * §4 — 턴이 끝났다, 지금 접어야 하는가. 참은 예약이다 — 압축은 다음 명령 직전에 조용히 실린다(§5.3 #9-1 (P), 턴 끝은 아무도 안 기다린다).
 * 참: 에이전트 요청(`agentCanCompact`, 발동선 아래여도) 또는 발동선을 넘긴 채 턴 끝. 꺼짐이면 발동선이 없지만 에이전트 요청은 돈다(직교 축).
 * ⚠ 컨텍스트를 못 재면 거짓 — 참이면 매 턴 압축으로 조용히 되돌아간다.
 */
export function shouldCompactAfterTurn(input: CompactAfterTurnInput): boolean {
  if (input.requested) return true;
  // §5.3 #9-1 (P축) — 턴 예산. 컨텍스트를 못 재는 세션에서도 걸리는 **유일한** 조건이라
  //   아래 "못 재면 거짓" 규칙보다 **먼저** 본다(뒤에 두면 창을 못 재는 세션에서 영영 안 걸린다).
  const budget = input.turnBudget ?? 0;
  if (budget > 0 && (input.turnsSinceCompact ?? 0) >= budget) return true;
  const used = input.contextUsed;
  if (typeof used !== 'number' || !Number.isFinite(used) || used <= 0) return false;
  // §4 (CLI 사양 추종) (5) 창 하한 — 절약이 조인 뒤 하한으로 올린 창으로 선을 잡는다.
  const trigger = turnCompactTriggerTokens(
    applyAutoCompactFloor(
      resolveEffectiveAutoCompact(input.autoCompact, input.userAutoCompact, input.tokenSaverAutoCompact),
      input.startupFloor,
      input.contextMax,
    ).value,
    input.contextMax,
  );
  if (trigger === null) return false;
  return used >= trigger;
}

/** §4 — effort 폴백 목록. UI 는 `listEffortLevels(registry)`(설치본 `--help`)를 먼저 쓴다. 서버는 문자열을 그대로 넘긴다. */
export const AVAILABLE_EFFORT_LEVELS: readonly string[] = [
  'default', 'low', 'medium', 'high', 'xhigh', 'max',
];

/**
 * §4 — `--help` 에 없는 effort 후보. CLI 는 도움말 밖 값도 받는다(실측 2.1.259: `ultracode` 무경고, `zzzbogus` 는 `Warning: Unknown --effort value`).
 * 부팅 때 probe 해 받아들여지는 것만 더한다(`effortLevelProbe.ts`) — 값 검증을 안 하는 판이면(보정 probe 실패) 통째로 버린다.
 */
export const EFFORT_LEVEL_PROBE_CANDIDATES: readonly string[] = ['ultracode'];

/** §4 — Effort 드롭다운: `registry.effortLevels` 먼저, 비면 `AVAILABLE_EFFORT_LEVELS`. 맨 앞에 늘 `'default'`(오버라이드 없음). */
export function listEffortLevels(registry?: ModelRegistry | null): string[] {
  const fromCli = registry?.effortLevels?.filter((v) => typeof v === 'string' && v.trim().length > 0);
  const base = (fromCli && fromCli.length > 0)
    ? fromCli
    : AVAILABLE_EFFORT_LEVELS.filter((v) => v !== 'default');
  const out: string[] = ['default'];
  for (const v of base) {
    if (v !== 'default' && !out.includes(v)) out.push(v);
  }
  return out;
}

/** §5.3 #28 — Custom Mode 옵션('conti' 만 동작, 나머지는 placeholder). */
export const AVAILABLE_CUSTOM_MODES = [
  { value: 'conti', enabled: true },
  { value: 'review', enabled: false },
  { value: 'debug', enabled: false },
] as const;

/** §4 — 실행 모드: 'headless' = `claude -p` 스폰(프로그래매틱 과금), 'interactive-terminal' = IDE 안 PTY 의 `claude` REPL(구독 과금). */
export const AVAILABLE_EXECUTION_MODES = [
  { value: 'headless', enabled: true },
  { value: 'interactive-terminal', enabled: true },
] as const;

/** §4 (CMD ⑧) — CMD 버블이 띄울 CLI 표(새 CLI 는 한 줄, §3.3). `bin` 빈 문자열 = 순수 셸. `managed` 일 때만 rules·`--resume`·소유자 태그·카드 토큰 env 를 붙인다. */
export const CMD_CLI_KINDS = [
  { value: 'claude', bin: 'claude', managed: true, label: 'Claude Code' },
  { value: 'codex', bin: 'codex', managed: false, label: 'Codex CLI' },
  { value: 'gemini', bin: 'gemini', managed: false, label: 'Gemini CLI' },
  { value: 'cursor', bin: 'cursor-agent', managed: false, label: 'Cursor Agent' },
  { value: 'opencode', bin: 'opencode', managed: false, label: 'OpenCode' },
  { value: 'aider', bin: 'aider', managed: false, label: 'Aider' },
  { value: 'shell', bin: '', managed: false, label: 'Shell only' },
] as const;

/** `CMD_CLI_KINDS` 에서 한 줄을 꺼낸다. 미지 값이면 `claude`(기본) 행. */
export function resolveCmdCliKind(value: string | undefined): (typeof CMD_CLI_KINDS)[number] {
  return CMD_CLI_KINDS.find((k) => k.value === value) ?? CMD_CLI_KINDS[0];
}

/** §4 (CMD ③) — scrollback 줄 수. xterm 과 PTY 링버퍼의 단일 출처(어긋나면 Ctrl+F 로 못 찾는 구간이 생긴다). */
export const TERMINAL_SCROLLBACK_LINES = 5000;
/** 옵션창 Advanced 가 허용하는 scrollback 하한. */
export const TERMINAL_SCROLLBACK_MIN = 500;
/** 옵션창 Advanced 가 허용하는 scrollback 상한(§3.2.3 — 쓸수록 커지는 것에 상한). */
export const TERMINAL_SCROLLBACK_MAX = 100000;
/** scrollback 줄 수 → PTY 링버퍼 바이트 상한 환산에 쓰는 줄당 평균 바이트. */
export const TERMINAL_SCROLLBACK_BYTES_PER_LINE = 160;

/** scrollback 줄 수를 허용 범위로 clamp. 미설정/비정상 값은 기본값. */
export function clampTerminalScrollback(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : TERMINAL_SCROLLBACK_LINES;
  return Math.max(TERMINAL_SCROLLBACK_MIN, Math.min(TERMINAL_SCROLLBACK_MAX, v));
}

/** §4 (CMD ③) — 리사이즈 트레일링 디바운스(ms): 멎은 뒤 1회만 PTY 에 알린다(폰트 확대/축소도 같은 창구). */
export const TERMINAL_RESIZE_DEBOUNCE_MS = 150;

/**
 * §4 (CMD ③) — 리사이즈 직후 리페인트를 replay 버퍼에서 거르는 창(ms). Windows ConPTY 는 리사이즈마다 화면을 통째로 다시 내보내
 * (실측: 6회 = 배너 6벌) 재부착 때 그만큼 되살아난다.
 */
export const CMD_RESIZE_REPAINT_MS = 400;

const CONSOLE_ESC = String.fromCharCode(27);

/**
 * 리사이즈 리페인트 실측 시그니처: `ESC[?25l` `ESC[8;<rows>;<cols>t` 등을 지나 커서 home(`CSI H`·`CSI 1;1H`)으로 시작한다.
 * 화면 지우기 `J` 는 일부러 뺀다 — `cls` 같은 정상 출력을 삼키지 않게.
 */
const CONSOLE_REPAINT_RE = new RegExp(
  `^(?:${CONSOLE_ESC}\\[(?:\\?[0-9;]*[hl]|[0-9;]*m|8;[0-9]+;[0-9]+t))*${CONSOLE_ESC}\\[(?:1;1)?H`,
);

/** 이 PTY 청크가 콘솔의 **화면 전체 재출력**으로 시작하는가(= 리사이즈 리페인트 후보). */
export function isConsoleRepaintChunk(data: string): boolean {
  return CONSOLE_REPAINT_RE.test(data);
}

/** §4 (CMD ③) — replay 버퍼에 쌓을 청크인가. 리사이즈 직후의 리페인트만 `false`(화면에는 그대로 흘린다). `resizedAt=0` = 직전 리사이즈 없음. */
export function shouldBufferPtyChunk(data: string, resizedAt: number, now: number): boolean {
  if (!resizedAt || now - resizedAt > CMD_RESIZE_REPAINT_MS) return true;
  return !isConsoleRepaintChunk(data);
}

/**
 * §4 (CMD) — 셸이 프롬프트를 그릴 틈을 준 뒤 입력줄에 명령을 채우기까지의 시간(ms).
 * 0 이면 배너보다 먼저 써 넣어 글자가 배너 사이에 끼어 보인다.
 */
export const CMD_PREFILL_DELAY_MS = 350;

/** §4 (CMD) — 입력줄 채우기를 리사이즈로 미룰 총 한도(ms). ConPTY 리페인트가 입력줄 글자를 새 폭에 재배치하며 잘라 크기가 멎은 뒤 채우되, 끝없이 미루지 않는다. */
export const CMD_PREFILL_MAX_DEFER_MS = 2000;

/** 지금 예약할 채우기 지연(ms) — 평소 `CMD_PREFILL_DELAY_MS`, 한도(`deadline`)가 가까우면 남은 시간만큼(음수면 0). */
export function cmdPrefillDelay(now: number, deadline: number): number {
  return Math.max(0, Math.min(CMD_PREFILL_DELAY_MS, deadline - now));
}

/** §4 (CMD ①) — 상태 판정 타이머 주기(ms). */
export const CMD_STATE_TICK_MS = 1000;
/** §4 (CMD ①) — 이 시간(ms) 이상 무출력 + 화면 꼬리가 프롬프트 패턴이면 `blocked`. */
export const CMD_BLOCKED_IDLE_MS = 3000;
/** §4 (CMD ①) — 이 시간(ms) 이상 무출력인데 프롬프트 패턴이 아니면 `idle`. */
export const CMD_IDLE_MS = 15000;
/** §4 (CMD ①) — blocked 판정에 쓸 화면 꼬리 줄 수(빈 줄 제외). */
export const CMD_BLOCK_TAIL_LINES = 3;
/** §4 (CMD ①) — `blockedReason` 으로 올릴 근거 문자열 최대 길이. */
export const CMD_BLOCK_REASON_MAX = 120;

/** §4 (CMD ②) — PTY 전경 프로세스명 표본 주기(ms). */
export const CMD_PROCESS_POLL_MS = 5000;

/**
 * §4 (CMD 2차 0) — 훅이 CMD 탭의 `working`/`idle` 권위를 쥐는 시간(ms) — 그동안 화면 감지는 `blocked` 만. 훅 없는 CLI 는 화면 감지가 단독 권위.
 * 짧으면 조용한 턴 사이 도트가 튀고 길면 CLI 를 바꾼 탭이 상태를 못 받는다 — 세션 유휴 판정(5분)과 같은 눈금.
 */
export const CMD_HOOK_AUTHORITY_TTL_MS = 300000;

/** §4 (CMD ⑥) — `/api/cmd/wait` 최대 대기(ms). 무한 대기 금지. */
export const CMD_WAIT_MAX_MS = 120000;
/** §4 (CMD ⑥) — `/api/cmd/wait` 폴링 주기(ms). */
export const CMD_WAIT_POLL_MS = 250;
/** §4 (CMD ⑥) — `/api/cmd/read` 가 한 번에 돌려주는 최대 줄 수. */
export const CMD_READ_MAX_LINES = 2000;
/** §4 (CMD ⑥) — `/api/cmd/send` 가 한 번에 받는 prefill 최대 길이. */
export const CMD_SEND_MAX_CHARS = 8000;

/**
 * §4 (⑥) — prefill 에서 C0 제어문자·DEL 을 전부 공백으로 바꾼다(지킬 성질: 사람이 누르기 전에는 실행되지 않는다).
 * 개행만 거르면 안 된다 — `\x04`(EOF)·`\x03`(SIGINT)·`\x1a`(Windows EOF)·`\x1b`(키 시퀀스)·`\x00` 도 그 성질을 깬다.
 */
export const CMD_SEND_CONTROL_CHARS = /[\u0000-\u001F\u007F]+/gu;

/** prefill 로 보낼 수 있는 모양으로 접는다. **순수 함수** — 테스트가 직접 부른다. */
export function sanitizeCmdPrefill(text: string, max = CMD_SEND_MAX_CHARS): string {
  return text.replace(CMD_SEND_CONTROL_CHARS, ' ').slice(0, max);
}

/** §4 (CMD ⑤) — pane 분할 비율 하한/상한(드래그 리사이즈 clamp). */
export const CMD_PANE_RATIO_MIN = 0.15;
export const CMD_PANE_RATIO_MAX = 0.85;
/** §4 (CMD ⑤) — 한 세션 탭이 가질 수 있는 pane 최대 개수(§3.2.3 상한 원칙). */
export const CMD_PANE_MAX = 8;
/** §4 (CMD ⑤) — pane termId 구분자. `:` 를 쓰면 `parseTermId` 의 sessionToken 해석이 깨진다. */
export const CMD_PANE_SEPARATOR = '#';

/** §4 (CMD ⑤) — 신뢰할 수 없는 입력에서 pane 트리 복원(어긋나면 `null` = 단일 pane). `ratio` clamp, leaf 상한 초과·중복 pane id 는 거부(한 PTY 를 두 xterm 이 다툰다). */
export function sanitizeCmdPaneTree(input: unknown): CmdPaneNode | null {
  const seen = new Set<string>();
  let leaves = 0;

  const walk = (node: unknown, depth: number): CmdPaneNode | null => {
    if (!node || typeof node !== 'object' || depth > CMD_PANE_MAX) return null;
    const n = node as Record<string, unknown>;
    if (n['type'] === 'leaf') {
      const id = typeof n['id'] === 'string' ? n['id'].trim() : '';
      if (!id || !/^[\w-]{1,32}$/.test(id) || seen.has(id)) return null;
      seen.add(id);
      leaves += 1;
      if (leaves > CMD_PANE_MAX) return null;
      return { type: 'leaf', id };
    }
    if (n['type'] !== 'split') return null;
    const dir = n['dir'] === 'column' ? 'column' : 'row';
    const rawRatio = typeof n['ratio'] === 'number' && Number.isFinite(n['ratio']) ? n['ratio'] : 0.5;
    const ratio = Math.max(CMD_PANE_RATIO_MIN, Math.min(CMD_PANE_RATIO_MAX, rawRatio));
    const kids = Array.isArray(n['children']) ? n['children'] : null;
    if (!kids || kids.length !== 2) return null;
    const a = walk(kids[0], depth + 1);
    const b = walk(kids[1], depth + 1);
    if (!a || !b) return null;
    return { type: 'split', dir, ratio, children: [a, b] };
  };

  const out = walk(input, 0);
  // 잎이 하나뿐인 트리는 단일 pane 과 같으므로 표현을 하나로 모은다(비교·저장 안정).
  if (out && out.type === 'leaf' && out.id === '0') return null;
  return out;
}

/** §4 (⑤) — pane 트리의 모든 leaf id 를 왼쪽/위 순서로 모은다. */
export function collectCmdPaneIds(node: CmdPaneNode | null | undefined): string[] {
  if (!node) return ['0'];
  if (node.type === 'leaf') return [node.id];
  return [...collectCmdPaneIds(node.children[0]), ...collectCmdPaneIds(node.children[1])];
}

/** §4 (⑤) — `term:<agentId>:<session>` + paneId → 그 pane 의 termId. pane `'0'` 은 접미사 없음(하위호환). */
export function cmdPaneTermId(baseTermId: string, paneId: string): string {
  return paneId === '0' ? baseTermId : `${baseTermId}${CMD_PANE_SEPARATOR}${paneId}`;
}

/** §4 (⑤) — pane 을 둘로 쪼갠 새 트리(원본 불변). 대상을 못 찾으면 원본 그대로. */
export function splitCmdPane(
  tree: CmdPaneNode | null | undefined,
  targetPaneId: string,
  newPaneId: string,
  dir: 'row' | 'column',
): CmdPaneNode {
  const root: CmdPaneNode = tree ?? { type: 'leaf', id: '0' };
  const walk = (node: CmdPaneNode): CmdPaneNode => {
    if (node.type === 'leaf') {
      if (node.id !== targetPaneId) return node;
      return { type: 'split', dir, ratio: 0.5, children: [node, { type: 'leaf', id: newPaneId }] };
    }
    return { ...node, children: [walk(node.children[0]), walk(node.children[1])] };
  };
  return walk(root);
}

/**
 * §4 (⑤) — 지정한 pane 을 트리에서 뺀다. 형제가 그 자리를 물려받는다(tmux 와 같은 접힘).
 * 마지막 하나까지 지우면 `null`(= 단일 pane 으로 복귀).
 */
export function closeCmdPane(tree: CmdPaneNode | null | undefined, targetPaneId: string): CmdPaneNode | null {
  if (!tree) return null;
  const walk = (node: CmdPaneNode): CmdPaneNode | null => {
    if (node.type === 'leaf') return node.id === targetPaneId ? null : node;
    const a = walk(node.children[0]);
    const b = walk(node.children[1]);
    if (a && b) return { ...node, children: [a, b] };
    return a ?? b;
  };
  const out = walk(tree);
  if (out && out.type === 'leaf') return null; // 잎 하나 = 단일 pane
  return out;
}

/**
 * §4 (⑤) — split 비율을 갈아 끼운 새 트리. split 은 둘째 자식의 첫 잎 id 로 식별한다(`secondChildHeadPaneId`).
 * ⚠ 첫째 자식의 첫 잎으로 바꾸지 마라 — 유일하지 않아 `row[ col[leaf0, leaf2], leaf1 ]` 에서 경계선 둘이 함께 움직인다.
 */
export function resizeCmdPane(
  tree: CmdPaneNode | null | undefined,
  secondChildHeadPaneId: string,
  ratio: number,
): CmdPaneNode | null {
  if (!tree) return null;
  const clamped = Math.max(CMD_PANE_RATIO_MIN, Math.min(CMD_PANE_RATIO_MAX, ratio));
  const walk = (node: CmdPaneNode): CmdPaneNode => {
    if (node.type === 'leaf') return node;
    const children: [CmdPaneNode, CmdPaneNode] = [walk(node.children[0]), walk(node.children[1])];
    const head = collectCmdPaneIds(node.children[1])[0];
    if (head === secondChildHeadPaneId) return { ...node, ratio: clamped, children };
    return { ...node, children };
  };
  return walk(tree);
}

/** §4 (CMD ①) — `blocked` 판정 패턴 표(새 CLI 는 한 줄, §3.3). 화면 꼬리 `CMD_BLOCK_TAIL_LINES` 줄만, 무출력 `CMD_BLOCKED_IDLE_MS` 뒤에 본다 — 산문의 물음표 오탐을 막는다. */
export const CMD_BLOCK_PATTERNS: readonly RegExp[] = [
  // 예/아니오 확인 — claude·codex·gemini·aider·git 공통 골격.
  /\(\s*y\s*\/\s*n\s*\)/i,
  /\[\s*y\s*\/\s*n\s*\]/i,
  /\byes\s*\/\s*no\b/i,
  // Claude Code 권한/선택 프롬프트.
  /\bdo you want to\b/i,
  /\bwould you like to\b/i,
  /\bselect an option\b/i,
  // 번호 선택지가 화면 꼬리에 떠 있다(= 고르기를 기다리는 중).
  //   커서 마커가 붙었거나 연속 번호 두 줄일 때만 — 로그 속 "1) passed" 한 줄을 줍지 않기 위해.
  /^\s*[❯>]\s*[1-9][).]\s+\S/m,
  /^\s*[1-9][).]\s+\S[^\n]*\n\s*[2-9][).]\s+\S/m,
  // 진행 대기.
  /\bpress\s+(?:enter|any key|return)\b/i,
  /\b(?:continue|proceed|overwrite|approve|allow|confirm|retry)\s*\?/i,
  // 도구가 스스로 밝히는 대기 상태.
  /\bwaiting for\b[^\n]{0,40}\b(?:input|approval|confirmation|response)\b/i,
  // 자격증명·값 입력 대기(줄 끝 콜론).
  /\b(?:password|passphrase|api[ _-]?key|token|username|email)\b[^\n]{0,24}:\s*$/i,
  // CLI 질문형 한 줄. ⚠ 맨 물음표 규칙(`/\?\s*$/`)을 되살리지 마라 — "~할까요?"로 끝나는 답은 `idle` 인데 매 턴 앰버 링·OS 알림이 뜬다(실측 오탐).
  /\b(?:which|what|where|who|how many|select|choose|pick|enter)\b[^\n]{0,60}\?\s*$/i,
  // 한국어 입력 요청(같은 이유로 평서형 질문은 제외하고 "입력/선택 요청"만).
  /(?:선택|입력|골라)[^\n]{0,12}(?:하세요|해\s*주세요|하시겠|해라)[^\n]{0,4}[?:]?\s*$/,
];

/** §4 · §2.2 — CMD 에이전트 버블 색(teal-600 에서 채도만 낮춤). 생성 때 agentConfig.color 에 구워지고 사용자가 바꾼 색이 우선(기능 표식은 executionMode). */
export const CMD_AGENT_COLOR = '#4e8e88';
/** 옛 CMD 색들(소문자 `#rrggbb`). 색이 설정에 구워져 상수만 바꾸면 기존 버블은 옛 색으로 남는다 — 복원 때 `migrateCmdAgentColor` 가 갈아 끼운다. */
export const CMD_AGENT_LEGACY_COLORS: readonly string[] = ['#0d9488'];
/** 옛 CMD 색으로 구워진 CMD 설정만 옮긴다 — 사용자가 고른 다른 색이나 같은 teal 을 쓰는 헤드리스 프리셋은 그대로 둔다. */
export function migrateCmdAgentColor<T extends Partial<AgentConfig>>(config: T): T {
  if (config.executionMode !== 'interactive-terminal' || typeof config.color !== 'string') return config;
  if (!CMD_AGENT_LEGACY_COLORS.includes(config.color.toLowerCase())) return config;
  return { ...config, color: CMD_AGENT_COLOR };
}
/** §5.19 (C) — 로컬 LLM 버블 색. 원색을 더 들이면 캔버스가 탁해져 무채색을 쓰고, 무엇을 물었는지는 라벨(모델명)이 말한다. */
export const LOCAL_AGENT_COLOR = '#3F4658';
/**
 * §5.25 (B) — Codex CLI 에이전트 버블 본체 색.
 * 프로바이더 배지만이 아니라 캔버스에서도 Claude/로컬 에이전트와 즉시 구별되게 한다.
 */
export const CODEX_AGENT_COLOR = '#047857';

/** §5.3 #28 (K) — 콘티 모드 진입 때 `AgentConfig.rules` 에 들어가는 강제 룰셋(응답은 콘티 JSON 으로만). */
export const CONTI_AGENT_RULES = `# Conti Mode (Vibisual) — STRICT

이 에이전트는 **콘티(스토리보드) 전용** 입니다. 사용자가 무엇을 입력하든, 답변은 **항상 아래 스키마의 ONE JSON object** 로만 출력합니다. 마크다운, 산문, 코드펜스, 설명, 사과 문장 일체 금지.

## 출력 규칙
- 응답 전체 = 단일 JSON object (선두 \`{\` ~ 말미 \`}\`).
- 코드펜스(\\\`\\\`\\\`) 사용 금지. JSON 외 텍스트 0바이트.
- 4~8 frame 권장 (1~16 frame 허용). One frame = one beat.
- 사용자가 묻는 모든 의도(질문/명령/잡담)를 frame 시퀀스로 변환해 답변.

## STAMP 우선 원칙 (v1.60) — 가독성을 위한 강제 규칙
**UI 컴포넌트는 \`stamp\` 로만 그립니다.** rect/circle/line 으로 버튼·창·입력 박스·아바타를 좌표 합성하지 마세요 — 매번 모양이 달라져 알아볼 수 없습니다.

**우선순위**:
1. **stamp** — 모든 UI 컴포넌트(창/버튼/입력/아바타/아이콘/말풍선/화살표). \`stampName\` 으로 카탈로그 항목 지정.
2. **text** — stamp 안의 라벨이 부족할 때 추가 캡션·주석으로만.
3. **rect/circle/line** — stamp 로 표현 안 되는 잔여(배경 면, 구분선, 작은 점 마커)에만. 한 frame 에 합쳐서 4개를 넘지 마세요.

stamp 좌표는 좌상단 \`x,y\` 와 박스 크기 \`w,h\` 입니다. \`w,h\` 미지정 시 카탈로그 기본값 사용.

## 밀도 원칙 (v1.60) — frame 을 채우세요
**한 frame 에 최소 5개 stamp.** 빈 캔버스에 stamp 2~3개만 떠 있으면 허접해 보입니다.

권장 구성:
- **hero stamp 1개** — 주연(\`browser-window\`/\`app-window\`/\`modal-dialog\` 등 큰 컨테이너). frame 의 60-80% 영역.
- **보조 stamp 3~6개** — hero 안/주변의 맥락. 창 안의 버튼들, 옆의 아바타, 커서, 화살표, 말풍선 등.
- **캡션 0~3개** — 짧은 라벨 또는 주석. rect/circle/line 합계 ≤ 4.

**Frame skeleton 예시** (beat 별로 골라서 응용):
- "사용자가 버튼 클릭" → \`browser-window\` (hero) + 안에 \`button-primary\` + \`cursor-pointer\` + 아래 캡션 text.
- "에이전트가 생각" → \`app-window\` (hero) + \`agent-avatar\`(variant=\`thinking\`) + \`spinner\` + \`chat-bubble\`(agent).
- "설정 패널 오픈" → \`app-window\` (hero) + 안에 \`modal-dialog\` 또는 \`side-panel\` + \`dropdown\`/\`text-input\`/\`toggle-switch\` 2~3행 + \`button-primary\`/\`button-secondary\` 한 쌍.
- "파일 흐름" → \`file-card\` + \`arrow\`(right) + \`terminal\` 또는 \`code-block\` + \`badge-pill\` 상태.
- "양쪽 대화" → \`user-avatar\` + \`chat-bubble\`(user) + \`agent-avatar\` + \`chat-bubble\`(agent).

**stamp 2개 이하 + 단일 라벨로 끝나는 frame 은 거부됩니다.** 카탈로그에서 맥락을 채울 보조 stamp 를 골라 반드시 5개 이상 채우세요.

## Schema
\`\`\`
{
  "workId": "",
  "title": "short title under 70 chars",
  "frames": [
    {
      "title": "frame title (under 100 chars)",
      "action": "one-sentence action description (under 200 chars)",
      "elements": [
        { "type": "stamp", "stampName": "browser-window", "stampVariant": "with-modal", "x": 20, "y": 20, "w": 280, "h": 140, "label": "vibisual.app" },
        { "type": "text", "x": 160, "y": 100, "label": "캡션 짧게", "fontSize": 12, "fill": "#6b7280" },
        { "type": "rect", "x": 0, "y": 0, "w": 320, "h": 180, "fill": "#f9fafb", "stroke": "none" }
      ],
      "badges": [ { "kind": "add|mod|evt", "text": "..." } ]
    }
  ]
}
\`\`\`

## STAMP_CATALOG — 사용 가능한 stamp 목록 (v1.60)
**아래 이름 외 stamp 는 서버가 거부합니다.** variants 는 \`stampVariant\` 필드에 적습니다 (미지정 = 첫 항목).

**Windows & Containers**:
- \`browser-window\` (260×140) variants: \`default\`, \`with-modal\` — Chrome URL bar + 탭 포함 브라우저 창. label = URL 또는 사이트 이름.
- \`app-window\` (240×140) variants: \`default\`, \`dark\` — 데스크탑 앱 창 (titlebar + body). label = 앱 이름.
- \`modal-dialog\` (180×120) — 중앙 모달 (제목 + 본문 + 하단 버튼 슬롯). label = 제목.
- \`side-panel\` (140×160) variants: \`right\`, \`left\` — 슬라이드 패널. label = 패널 제목.
- \`card\` (160×100) — 단순 카드 (정돈된 톤, rect 보다 우선).

**Inputs**:
- \`text-input\` (140×28) variants: \`empty\`, \`filled\`, \`focused\` — 단일행 입력. label = placeholder 또는 입력값.
- \`textarea\` (180×60) — 여러 행 입력. label = 첫 줄 텍스트.
- \`dropdown\` (140×28) variants: \`closed\`, \`open\` — 드롭다운. \`open\` 은 펼친 메뉴 3 항목 포함. label = 선택값.
- \`checkbox\` (16×16) variants: \`checked\`, \`unchecked\` — 체크박스.
- \`toggle-switch\` (32×18) variants: \`on\`, \`off\` — 토글.

**Buttons**:
- \`button-primary\` (80×32) variants: \`default\`, \`active\`, \`disabled\` — 파란 액션 버튼. label = 버튼 텍스트(<10자).
- \`button-secondary\` (80×32) — 회색 보조 버튼. label = 버튼 텍스트.
- \`button-danger\` (80×32) — 빨간 위험 버튼. label = 버튼 텍스트.
- \`icon-button\` (28×28) variants: \`circle\`, \`square\` — 아이콘만. label = 영문 1글자 (예: \`+\`, \`X\`, \`?\`).

**Actors**:
- \`user-avatar\` (40×40) variants: \`default\`, \`active\` — 사용자. label = 이름.
- \`agent-avatar\` (40×40) variants: \`idle\`, \`active\`, \`thinking\` — AI 에이전트. label = 라벨.
- \`cursor-pointer\` (16×20) — 마우스 포인터.

**Content Blocks**:
- \`code-block\` (180×80) — 코드 블록 (행 번호 + 회색 fill). label = 첫 줄 코드.
- \`terminal\` (200×80) — 터미널 (검정 배경 + prompt). label = 명령.
- \`file-card\` (60×72) variants: \`default\`, \`folder\` — 파일/폴더. label = 파일명.
- \`chat-bubble\` (140×40) variants: \`user\`, \`agent\` — 채팅 말풍선. label = 메시지(짧게).

**Indicators**:
- \`arrow\` (40×20) variants: \`right\`, \`down\`, \`left\`, \`up\`, \`curved-right\` — 화살표. label = 캡션(선택).
- \`checkmark\` (20×20) — check 아이콘 (성공/완료 표시). label 불필요.
- \`x-mark\` (20×20) — close 아이콘 (실패/취소 표시). label 불필요.
- \`spinner\` (24×24) — 3-도트 로딩. label 불필요.
- \`progress-bar\` (140×8) variants: \`p25\`, \`p50\`, \`p75\`, \`p100\` — 진행률.
- \`badge-pill\` (auto) — 작은 라벨. label = 텍스트(<15자).

## workId (작업 ID)
- 이 응답이 **직전에 만들던 콘티의 연속**(=수정/추가)이라면 그 콘티의 \`workId\` 값을 그대로 적습니다.
- **새 콘티**라면 \`workId\` 를 빈 문자열 \`""\` 로 둡니다 (서버가 새로 발급).
- 모르면 빈 문자열로 두십시오 — 서버가 최종 권위입니다.

## Geometry — 16:9 표준 스토리보드
- viewBox 320×180 기준 (16:9). \`x\` ∈ 0..320, \`y\` ∈ 0..180.
- \`rect\` 는 \`w\`/\`h\` 사용. 권장 최소 크기 \`w≥40, h≥24\` — 너무 작으면 식별 안됨.
- \`circle\` 은 \`w\` 를 반지름으로 사용 (중심=\`x,y\`). 권장 \`w≥12\`.
- \`line\` 은 \`w\`/\`h\` 를 끝점 dx/dy 로 사용 (시작=\`x,y\`).
- \`text\` 는 \`x,y\` 를 anchor 로 사용. 권장 \`fontSize 12~20\` (기본 14). 라벨 길이 짧게 — 잘리면 비참.
- 한 frame 에 element **6~12 개** 권장. 50 개 넘으면 wireframe 의 의도 상실.

## Badges
- \`add\` = 새 산출물, \`mod\` = 수정, \`evt\` = 사용자 이벤트(클릭/저장 등).

## Design System (v1.61) — 톤매너 필수 준수
콘티는 **빠른 wireframe** 이지만 톤매너는 정돈되어야 합니다. 다크 3-레이어 + 의미 컬러 2종(action/result) 시스템을 그대로 사용하세요.

### Color Palette (정확한 HEX 사용, 변형 금지)
**3-layer dark** (배경 → 카드 → 데모):
- \`#0F1117\` — bg_outer (frame 외피, 캔버스 배경)
- \`#1A1D26\` — bg_card (konti card)
- \`#242833\` — bg_demo (UI 데모 영역, wireframe 안쪽)
- \`#2D3140\` — bg_chrome (윈도우 크롬/타이틀바)

**Semantic colors** (의미 일관성 핵심):
- \`#A78BFA\` — **action** (보라): 사용자 액션/트리거. click, drag, type, Agent 버블, 사용자 chat-bubble, button-primary, cursor-pointer
- \`#00E5A0\` — **result** (민트): 시스템 결과/생성. new agent, new edge, committed, saved, 흐름 화살표의 도착점, badge-pill 'result' 타입

**Text** (3단 위계):
- \`#E8E8E8\` — text_primary
- \`#9CA3AF\` — text_secondary / caption
- \`#4B5563\` — text_tertiary / disabled

**Border**:
- \`rgba(255,255,255,0.06)\` — border_subtle (카드)
- \`rgba(255,255,255,0.05)\` — border_faint (데모/창)

### Typography
- Title/Header: \`fontSize 16~22\`, weight 500, color text_primary
- Body/라벨: \`fontSize 12~13\`, color text_primary
- Caption: \`fontSize 11~12\`, color text_secondary
- Annotation: \`fontSize 10\`, color text_tertiary
- Tag/Mono: \`fontSize 11\`, monospace, color = action 또는 result

### Semantic Rules (시청자가 무의식적으로 학습하게)
- **보라(action) 은 언제**: 사용자가 직접 하는 행동(click/drag/type), 트리거 대상(Agent 버블/버튼), "원인" 요소.
- **민트(result) 는 언제**: 시스템이 생성한 결과(new agent/new edge), 자동 실행(auto-layout/save), "결과" 요소.
- **한 프레임에 절대 하지 말 것**:
  - 보라/민트를 의미 없이 섞기.
  - 3색 이상 포인트 컬러 추가 (보라 + 민트 외 다른 액센트 금지).
  - text_primary 외의 색으로 본문 쓰기.
- **시선 흐름**: 좌상 → 우하. 포인트 컬러는 최대 2개 위치 (트리거 + 결과).

### Stroke Width
- 미세 chrome(grid/guide): \`0.5\`
- 기본 외곽선: \`1.5\` (CONTI_DEFAULTS.defaultStrokeWidth)
- 강조(active/focus): \`2\`
- Agent/대상 강조용 점선: \`1.5\` dashed

### Composition Rules
- 한 frame 에 **hero 1 개(action 컬러 강조) + 보조 3~6 개 + 캡션 0~3**. 빈 캔버스 금지.
- 외곽 margin 최소 16. 가장자리에 element 붙이지 말 것.
- 관련 요소는 30 이내로 묶고, 무관한 요소는 60+ 떨어뜨릴 것.
- 라벨은 짧게(15자 내). 잘리면 의미 상실.
- **흐름 캡션**: frame 의 우하단에 \`"<액션 text_secondary> → <결과 result>"\` 패턴으로 한 줄 박기. 화살표는 \`arrow\` stamp + variant=right.

### 잔여 rect/text/line 사용 예시 (stamp 로 표현 안 되는 경우만)
**배경 면** — 캔버스 전체 톤(반드시 첫 element):
\`{ "type":"rect","x":0,"y":0,"w":320,"h":180,"fill":"#242833","stroke":"none" }\`

**구분선** — 영역 분할:
\`{ "type":"line","x":0,"y":40,"w":320,"h":0,"stroke":"rgba(255,255,255,0.05)","strokeWidth":0.5 }\`

**캡션 (액션 부분)** — stamp 옆 짧은 설명:
\`{ "type":"text","x":200,"y":170,"label":"클릭","fontSize":11,"fill":"#9CA3AF" }\`

**캡션 (결과 부분, 민트)**:
\`{ "type":"text","x":260,"y":170,"label":"버블 생성","fontSize":11,"fill":"#00E5A0" }\`

### 금지 사항
- 금지: 라이트 톤(#ffffff, #f9fafb 등) 배경 — 다크 3-레이어만.
- 금지: blue/red/yellow/green 등 보라/민트 외 액센트 색.
- 금지: rect + text 합성으로 버튼/창/아바타 만들기 — 해당 stamp 사용.
- 금지: 카탈로그에 없는 \`stampName\` 사용 — 서버가 element 통째로 drop.
- 금지: 검정 두꺼운 외곽선(\`#000000\` + strokeWidth ≥ 3)으로 두르기.
- 금지: 라벨에 의미없는 영문 transliteration. 모르면 영문 그대로.
- 금지: 한 frame 에 50+ element 또는 stamp 2개 이하의 빈 frame.
- 금지: 보라와 민트를 의미 없이 섞기. 트리거 = 보라, 결과 = 민트 일관 유지.

이 룰은 Vibisual 콘티모드에서 자동 주입되었습니다. 콘티모드를 끄면 자동 제거되고, 직전 룰은 히스토리에서 복원할 수 있습니다.
`;

/**
 * §5.3 #28 — LLM 이 UI 를 좌표로 매번 새로 그리지 않게 정한 stamp 집합. 서버 `coerceElement` 는 없는 `stampName` 의 element 를 버리고 클라 `StampSvg` 가 그린다.
 * `CONTI_AGENT_RULES` 의 STAMP_CATALOG 섹션과 1:1 — 함께 고칠 것.
 */
export interface StampSpec {
  /** 카테고리 (디버그/문서용) */
  category: 'window' | 'input' | 'button' | 'actor' | 'content' | 'indicator';
  /** stamp 기본 폭 (viewBox 320×180 기준). w 미지정 시 사용. */
  defaultW: number;
  /** stamp 기본 높이. h 미지정 시 사용. */
  defaultH: number;
  /** 허용 variant 키 목록. 첫 항목 = 기본. variants 없는 stamp 는 빈 배열. */
  variants: readonly string[];
  /** 한 줄 요약 (디버그/툴팁용) */
  summary: string;
}

export const STAMP_CATALOG = {
  // Windows & Containers
  'browser-window':   { category: 'window',    defaultW: 260, defaultH: 140, variants: ['default', 'with-modal'], summary: 'Chrome URL bar + 탭 포함 브라우저 창' },
  'app-window':       { category: 'window',    defaultW: 240, defaultH: 140, variants: ['default', 'dark'],       summary: '데스크탑 앱 창 (titlebar + body)' },
  'modal-dialog':     { category: 'window',    defaultW: 180, defaultH: 120, variants: [],                         summary: '중앙 모달 (제목 + 본문 + 버튼 슬롯)' },
  'side-panel':       { category: 'window',    defaultW: 140, defaultH: 160, variants: ['right', 'left'],          summary: '슬라이드 패널' },
  'card':             { category: 'window',    defaultW: 160, defaultH: 100, variants: [],                         summary: '단순 카드 (정돈된 톤)' },

  // Inputs
  'text-input':       { category: 'input',     defaultW: 140, defaultH: 28,  variants: ['empty', 'filled', 'focused'], summary: '단일행 텍스트 입력' },
  'textarea':         { category: 'input',     defaultW: 180, defaultH: 60,  variants: [],                         summary: '여러 행 입력' },
  'dropdown':         { category: 'input',     defaultW: 140, defaultH: 28,  variants: ['closed', 'open'],         summary: '드롭다운 (open=메뉴 펼침)' },
  'checkbox':         { category: 'input',     defaultW: 16,  defaultH: 16,  variants: ['checked', 'unchecked'],   summary: '체크박스' },
  'toggle-switch':    { category: 'input',     defaultW: 32,  defaultH: 18,  variants: ['on', 'off'],              summary: '토글 스위치' },

  // Buttons
  'button-primary':   { category: 'button',    defaultW: 80,  defaultH: 32,  variants: ['default', 'active', 'disabled'], summary: '파란 액션 버튼' },
  'button-secondary': { category: 'button',    defaultW: 80,  defaultH: 32,  variants: [],                         summary: '회색 보조 버튼' },
  'button-danger':    { category: 'button',    defaultW: 80,  defaultH: 32,  variants: [],                         summary: '빨간 위험 버튼' },
  'icon-button':      { category: 'button',    defaultW: 28,  defaultH: 28,  variants: ['circle', 'square'],       summary: '아이콘만 들어가는 버튼' },

  // Actors
  'user-avatar':      { category: 'actor',     defaultW: 40,  defaultH: 40,  variants: ['default', 'active'],      summary: '사용자 아바타 (사람 실루엣)' },
  'agent-avatar':     { category: 'actor',     defaultW: 40,  defaultH: 40,  variants: ['idle', 'active', 'thinking'], summary: 'AI 에이전트 아바타' },
  'cursor-pointer':   { category: 'actor',     defaultW: 16,  defaultH: 20,  variants: [],                         summary: '마우스 포인터' },

  // Content
  'code-block':       { category: 'content',   defaultW: 180, defaultH: 80,  variants: [],                         summary: '코드 블록 (행 번호 포함)' },
  'terminal':         { category: 'content',   defaultW: 200, defaultH: 80,  variants: [],                         summary: '터미널 (검정 배경 + prompt)' },
  'file-card':        { category: 'content',   defaultW: 60,  defaultH: 72,  variants: ['default', 'folder'],      summary: '파일/폴더 카드' },
  'chat-bubble':      { category: 'content',   defaultW: 140, defaultH: 40,  variants: ['user', 'agent'],          summary: '채팅 말풍선' },

  // Indicators
  'arrow':            { category: 'indicator', defaultW: 40,  defaultH: 20,  variants: ['right', 'down', 'left', 'up', 'curved-right'], summary: '화살표 (방향별)' },
  'checkmark':        { category: 'indicator', defaultW: 20,  defaultH: 20,  variants: [],                         summary: '체크 (성공/완료)' },
  'x-mark':           { category: 'indicator', defaultW: 20,  defaultH: 20,  variants: [],                         summary: '엑스 (실패/취소)' },
  'spinner':          { category: 'indicator', defaultW: 24,  defaultH: 24,  variants: [],                         summary: '3-도트 로딩' },
  'progress-bar':     { category: 'indicator', defaultW: 140, defaultH: 8,   variants: ['p25', 'p50', 'p75', 'p100'], summary: '진행률 바' },
  'badge-pill':       { category: 'indicator', defaultW: 60,  defaultH: 18,  variants: [],                         summary: '작은 pill 라벨' },
} as const satisfies Readonly<Record<string, StampSpec>>;

/** §5.3 #28 (K) — `rulesHistory` 최대 항목 수(넘으면 오래된 것부터 버린다). */
export const RULES_HISTORY_MAX = 20;

/** §5.3 #28 — 콘티 LLM 호출 기본값. viewBox 는 16:9 320×180(더 작으면 식별이 안 된다). */
export const CONTI_DEFAULTS = {
  /** 콘티 1건 의 frame 표준 개수 (LLM 에 권고) */
  defaultFrameCount: 6,
  /** frame 의 wire viewBox 폭 (16:9 표준) */
  viewBoxWidth: 320,
  /** frame 의 wire viewBox 높이 (16:9 표준) */
  viewBoxHeight: 180,
  /** 텍스트 기본 fontSize (viewBox 단위) — 약 14 = 480px 표시폭에서 21px 디스플레이 */
  defaultFontSize: 14,
  /** rect/circle/line 기본 strokeWidth (viewBox 단위) */
  defaultStrokeWidth: 2,
  /** generateConti LLM 모델 (Haiku 1차) */
  primaryModel: 'claude-haiku-4-5-20251001',
  /** 빈 결과/스키마 위반 시 fallback (Sonnet) */
  fallbackModel: 'claude-sonnet-4-6',
  /** 입력 컨텍스트 머리/꼬리 길이 */
  contextHeadTurns: 4,
  contextTailTurns: 4,
  /** in-flight 1 agent 동시 1건 제한 */
  inflightTimeoutMs: 60_000,
} as const;

// ─── §5.13 (Q) 대본 → 콘티 → 렌더 ───

/** 출력 프리셋 표(§3.3) — 출력 판형만 정한다. 컷 좌표계(`CONTI_DEFAULTS.viewBox*`)는 고정 — 프리셋마다 갈면 그려 둔 콘티가 어긋난다. */
export const STORYBOARD_PRESETS = {
  landscape: {
    id: 'landscape',
    output: { width: 1920, height: 1080 },
    fps: 30,
    secondsPerFrame: 3.0,
    stacked: false,
    labelKey: 'panel.contiBoard.preset.landscape',
  },
  portrait: {
    id: 'portrait',
    output: { width: 1080, height: 1920 },
    fps: 30,
    secondsPerFrame: 2.5,
    stacked: false,
    labelKey: 'panel.contiBoard.preset.portrait',
  },
  webtoon: {
    id: 'webtoon',
    output: { width: 1080, height: 1920 },
    fps: 30,
    secondsPerFrame: 4.0,
    stacked: true,
    labelKey: 'panel.contiBoard.preset.webtoon',
  },
} as const satisfies Readonly<Record<StoryboardPresetId, StoryboardPreset>>;

/** 드롭다운이 그리는 순서. 가로 → 세로 → 웹툰. */
export const STORYBOARD_PRESET_IDS: readonly StoryboardPresetId[] = ['landscape', 'portrait', 'webtoon'] as const;

/** 프리셋을 안 고른 콘티(= 기존 콘티 전부)가 쓰는 값. */
export const DEFAULT_STORYBOARD_PRESET_ID: StoryboardPresetId = 'landscape';

/** 모르는 값은 기본 프리셋으로 떨어뜨린다 — REST body·옛 체크포인트 공용. */
export function resolveStoryboardPreset(id: unknown): StoryboardPreset {
  const key = typeof id === 'string' && id in STORYBOARD_PRESETS ? (id as StoryboardPresetId) : DEFAULT_STORYBOARD_PRESET_ID;
  return STORYBOARD_PRESETS[key];
}

/** 프리셋 id 로만 정규화한다(표 전체가 필요 없을 때). */
export function normalizeStoryboardPresetId(id: unknown): StoryboardPresetId {
  return typeof id === 'string' && id in STORYBOARD_PRESETS ? (id as StoryboardPresetId) : DEFAULT_STORYBOARD_PRESET_ID;
}

/** 한 번에 넘길 수 있는 대본 길이 상한(자). 넘으면 서버가 앞에서 자른다. */
export const CONTI_SCRIPT_MAX_CHARS = 12_000;

/** 콘티에 남기는 대본 발췌 상한(자) — 체크포인트가 대본 전문으로 부풀지 않게. */
export const CONTI_SCRIPT_EXCERPT_MAX = 2_000;

/** 대본에서 뽑을 컷 수의 상한·하한. 사용자가 비우면 모델이 `CONTI_DEFAULTS.defaultFrameCount` 근처로 정한다. */
export const CONTI_SCRIPT_FRAME_MIN = 2;
export const CONTI_SCRIPT_FRAME_MAX = 16;

/** 에이전트 기본 설정 — 새 에이전트 생성 시 / 설정이 없을 때. 도구는 전체 허용,
 *  maxTurns 0=무제한이 기본(subAgentManager 의 `maxTurns>0` 가드가 0을 무제한 처리).
 *  사용자가 AgentConfigPopup 에서 양수 지정 시에만 턴 제한이 걸린다. */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  model: 'opus',
  tools: [...AVAILABLE_AGENT_TOOLS],
  permissionMode: 'default',
  skills: [],
  maxTurns: 0,
  // 갓 만든 설정은 이미 현행 목록 전체를 갖고 있으므로 백필이 다시 돌 이유가 없다.
  //   도장을 안 찍으면, 사용자가 도구 하나를 끄고 앱을 다시 켰을 때 백필이 그 선택을 되돌린다.
  toolsBackfillGen: AGENT_TOOLS_BACKFILL_GEN,
};
// §5.3 자기 기억 범위 · 중첩 깊이

/** 드롭다운이 그리는 순서. 맨 앞이 "지정 안 함"(= 레포 공용 기억). */
export const AGENT_MEMORY_SCOPES: readonly AgentMemoryScope[] = ['off', 'user', 'project', 'local'] as const;

/** 알 수 없는 값은 undefined(기본)로 떨어뜨린다 — REST body 검증 공용. */
export function normalizeAgentMemoryScope(value: unknown): AgentMemoryScope | undefined {
  return AGENT_MEMORY_SCOPES.includes(value as AgentMemoryScope) ? (value as AgentMemoryScope) : undefined;
}

/** 중첩 깊이 하한 — 1 이면 "이 에이전트는 서브에이전트를 못 만든다". */
export const SUBAGENT_DEPTH_MIN = 1;

/** 중첩 깊이 상한. CLI 기본은 3층이며, 그보다 깊게 파는 것은 사고에 가깝다. */
export const SUBAGENT_DEPTH_MAX = 5;

/** 이 칸을 비워 두었을 때(0) CLI 가 쓰는 중첩 깊이. 설정 창이 "0 = 3층"을 숫자로 적을 때 쓴다(§5.25 (G-2)). */
export const SUBAGENT_DEPTH_CLI_DEFAULT = 3;

/**
 * 범위를 벗어나거나 정수가 아니면 undefined(= CLI 기본 3층 유지).
 * 0 을 "중첩 없음"으로 오해해 넣는 경우가 있어 하한을 1 로 잡고 그 아래는 버린다.
 */
export function normalizeSubagentDepth(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  if (value < SUBAGENT_DEPTH_MIN || value > SUBAGENT_DEPTH_MAX) return undefined;
  return value;
}

// ─── §4 (CLI 사양 추종) Bash 도구 타임아웃 ───

/** Bash 타임아웃 하한(ms). 1초 미만은 오타로 본다. */
export const BASH_TIMEOUT_MS_MIN = 1_000;

/** Bash 타임아웃 상한(ms) = 24시간. 이보다 길면 사실상 무제한이라 값으로서 의미가 없다. */
export const BASH_TIMEOUT_MS_MAX = 86_400_000;

/** CLI 가 `timeout` 미지정 명령에 쓰는 기본 제한(ms). 우리 UI 의 "미설정" 안내용. */
export const BASH_DEFAULT_TIMEOUT_MS_CLI_DEFAULT = 120_000;

/** CLI 가 허용하는 `timeout` 상한(ms). "600초에서 걸린다"의 정체 — 이 값을 넘기려면 설정이 필요하다. */
export const BASH_MAX_TIMEOUT_MS_CLI_DEFAULT = 600_000;

/**
 * 범위를 벗어나거나 정수가 아니면 undefined(= 미설정 = CLI 기본 유지).
 * 0/음수를 "무제한"으로 오해해 넣는 경우가 있어 하한 아래는 저장하지 않는다.
 */
export function normalizeBashTimeoutMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const ms = Math.round(value);
  if (ms < BASH_TIMEOUT_MS_MIN || ms > BASH_TIMEOUT_MS_MAX) return undefined;
  return ms;
}

// §5.5 #17-18 덧말 처리 방식

/** 큐 항목 UI 가 그리는 순서(대기 → 합치기 → 즉시). */
export const COMMAND_DISPATCH_MODES: readonly CommandDispatchMode[] = ['wait', 'merge', 'immediate'] as const;

/** 방식 없이 넣은 명령의 기본 = 합치기 — 연달은 덧말은 대개 한 생각이라 한 턴에 간다(쪼개면 앞 지시가 뒤집히고 보고 카드만 는다). */
export const DEFAULT_COMMAND_DISPATCH_MODE: CommandDispatchMode = 'merge';

/** 합치기로 한 프롬프트에 이어 붙일 때 쓰는 구분자. */
export const COMMAND_MERGE_SEPARATOR = '\n\n';

/** 알 수 없는 값이 들어와도 기본값으로 떨어뜨리는 좁힘 함수(REST body 검증 공용). */
export function normalizeCommandDispatchMode(value: unknown): CommandDispatchMode {
  return COMMAND_DISPATCH_MODES.includes(value as CommandDispatchMode)
    ? (value as CommandDispatchMode)
    : DEFAULT_COMMAND_DISPATCH_MODE;
}

// ─── §5.5 #17-12 ③ 명령 실패 사유 코드 ───

/**
 * `CommandErrorCode` 런타임 목록 — 화면이 "아는 코드인가"를 이것으로 판정한다. 클라에 따로 두지 마라(빠진 코드가 엉뚱하게 "CLI 종료"로 말한다).
 * 코드를 늘릴 때는 유니언·이 목록·`ide.cmdError.<code>` 를 함께(클라 테스트가 확인한다).
 */
export const COMMAND_ERROR_CODES = [
  'spawn', 'stdin', 'exit', 'crash', 'cli', 'maxTurns', 'agentView', 'orphaned', 'local', 'dispatchResult',
  'usageLimit', 'creditCap',
] as const satisfies readonly CommandErrorCode[];

/** 종료 코드 유무로 문장이 갈리는 코드 — 코드가 없으면 `<code>Unknown` 문장을 쓴다. */
export const COMMAND_ERROR_CODES_WITH_EXIT = ['exit', 'crash'] as const satisfies readonly CommandErrorCode[];

/** §5.5 #17-12 ③-7 — 실패 문장이 부를 엔진 이름(번역하지 않는다). 문장에 박지 마라 — 같은 사유 코드의 다른 엔진이 남의 이름으로 불린다. */
export const AGENT_ENGINE_CLI_LABEL: Record<AgentEngineKind, string> = {
  claude: 'Claude CLI',
  codex: 'Codex CLI',
  // 로컬 엔진은 CLI 를 띄우지 않는다(자기 사유 코드 `local` 을 쓴다). CLI 문장에 닿는 길은 없지만,
  //   엔진이 늘 때 이 표가 비어 조용히 빈 이름이 뜨는 일이 없도록 채워 둔다.
  local: 'Local engine',
};

/** 엔진을 모르는 사유(옛 명령·세션이 사라진 봉합분)가 쓰는 이름 — **클로드로 단정하지 않는다**. */
export const UNKNOWN_ENGINE_CLI_LABEL = 'CLI';

/** §2.4 — 한도 정지로 고쳐 적어도 되는 실패 사유(엔진이 신고한 실패만). 나머지는 원인이 이미 분명하고, `local` 엔 요금제 한도가 없다. */
export const USAGE_LIMIT_PROMOTABLE_ERROR_CODES: ReadonlySet<CommandErrorCode> = new Set<CommandErrorCode>([
  'cli', 'exit', 'agentView',
]);

// ─── 훅 버블 읽기 전용 경계 (§5.5 #17 / #17-29) ───

/**
 * 훅 버블인가 = 읽기 전용인가. 외부에서 연 세션의 시각화라 스폰 주입(컨텍스트·카드 지시문·목표·집행)도 완료 신고도 없어 명령을 넣으면 매달린다.
 * 못 찾으면(`null`/`undefined`) 훅으로 본다. 서버 REST 가드와 클라 UI 가 같은 함수를 쓴다.
 */
export function isReadOnlyHookAgent(agent: { customCreated?: boolean } | null | undefined): boolean {
  return !agent?.customCreated;
}

/** 훅 버블에 쓰기를 시도했을 때 서버가 돌려주는 사유 코드(REST 403 공용). */
export const READ_ONLY_HOOK_AGENT_ERROR = 'read-only-hook-agent';

// ─── 파이프라인 에이전트 ───

/** 파이프라인 자식 에이전트 역할별 설정 */
export const PIPELINE_CHILD_CONFIGS: Record<AgentRole, PipelineChildConfig> = {
  explore: {
    role: 'explore',
    model: 'haiku',
    readOnly: true,
    tools: ['Read', 'Grep', 'Glob'],
    maxTurns: 15,
    color: '#3B82F6',
  },
  architect: {
    role: 'architect',
    model: 'sonnet',
    readOnly: true,
    tools: ['Read', 'Grep', 'Glob'],
    maxTurns: 10,
    color: '#8B5CF6',
  },
  implementer: {
    role: 'implementer',
    model: 'sonnet',
    readOnly: false,
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
    maxTurns: 30,
    color: '#10B981',
  },
  verifier: {
    role: 'verifier',
    model: 'sonnet',
    readOnly: false,
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    maxTurns: 15,
    color: '#F97316',
  },
};

/** 파이프라인 타입별 메뉴 정보 (label + 장단점) */
export const PIPELINE_TYPE_INFO: Record<PipelineType, {
  label: string;
  description: string;
  pros: string[];
  cons: string[];
}> = {
  'pipeline-subagent': {
    label: 'Pipeline: Subagent',
    description: 'Sequential chaining: explore \u2192 architect \u2192 implementer \u2192 verifier',
    pros: ['Simple and predictable', 'Minimal token usage', 'Stable (production-ready)'],
    cons: ['No direct agent-to-agent communication', 'Limited parallel execution'],
  },
  'pipeline-teams': {
    label: 'Pipeline: Teams',
    description: 'Multiple agents work simultaneously with direct discussion',
    pros: ['True parallel execution', 'Direct agent-to-agent discussion', 'Excellent for competing hypothesis testing'],
    cons: ['Experimental feature', '3\u20135x token increase', 'Possible file edit conflicts'],
  },
  'pipeline-hybrid': {
    label: 'Pipeline: Hybrid',
    description: 'Sequential explore/design, parallel implement/verify',
    pros: ['Cost-optimized (cheap exploration)', 'Maximized implementation speed', 'Verification runs alongside implementation'],
    cons: ['Requires understanding both systems', 'Most configuration needed'],
  },
};

/** 파이프라인 내부 뷰 Parents 버블 특수 ID */
export const PIPELINE_PARENT_BUBBLE_ID = '__pipeline_parent__';

// ─── Task Edge 템플릿 (newAgents 파이프라인 프리셋) ───

/** Task Edge 템플릿 — 드래그 연결 때 역할 조합의 프리셋. `default*` 는 고급 옵션 채움(없으면 `TASK_EDGE_DEFAULTS`). */
export const TASK_EDGE_TEMPLATES: TaskEdgeTemplate[] = [
  {
    id: 'explore-to-architect',
    label: 'Explore → Architect',
    defaultCommand: 'Write an ADR based on the exploration results. Include implementation strategy, alternatives, and risks.',
    sourceRole: 'explore',
    targetRole: 'architect',
    defaultForwardMode: 'auto',
    defaultKind: 'command',
    defaultMessageFormat: 'schema',
    defaultReturnFormat: 'artifact',
    defaultPriority: 'normal',
  },
  {
    id: 'architect-to-implementer',
    label: 'Architect → Implement',
    // §5.3 #12-4 — 기본 문구도 현재 검증 정책의 켬/끔과 사용자 직접 지시를 따른다.
    defaultCommand: 'Write code following the ADR implementation plan. When Vibisual verification policy is enabled, run tests only within the current verification grant. When disabled, this instruction adds no separate verification-request requirement. Always follow the user\'s direct instructions and scope, and report tests not run.',
    sourceRole: 'architect',
    targetRole: 'implementer',
    defaultForwardMode: 'auto',
    defaultKind: 'command',
    defaultMessageFormat: 'free',
    defaultReturnFormat: 'both',
    defaultPriority: 'normal',
  },
  {
    id: 'implementer-to-verifier',
    label: 'Implement → Verify',
    defaultCommand: 'Independently review the implementation. When Vibisual verification policy is enabled, run builds and tests only within the current verification grant. When disabled, this instruction adds no separate verification-request requirement. Always follow the user\'s direct instructions and scope, and report what was not run.',
    sourceRole: 'implementer',
    targetRole: 'verifier',
    defaultForwardMode: 'auto',
    defaultKind: 'command',
    defaultMessageFormat: 'schema',
    defaultReturnFormat: 'artifact',
    defaultPriority: 'normal',
  },
  {
    id: 'verifier-to-implementer',
    label: 'Verify → Fix',
    defaultCommand: 'Review the verification failures and fix them. When Vibisual verification policy is enabled, re-run failing tests only within the current verification grant. When disabled, this instruction adds no separate verification-request requirement. Always follow the user\'s direct instructions and scope.',
    sourceRole: 'verifier',
    targetRole: 'implementer',
    defaultForwardMode: 'manual',
    defaultKind: 'request',
    defaultMessageFormat: 'schema',
    defaultReturnFormat: 'artifact',
    defaultPriority: 'high',
  },
  {
    id: 'generic',
    label: 'Custom',
    defaultCommand: '',
    sourceRole: null,
    targetRole: null,
    // Custom 엣지 기본값: Gate=auto · 반환=둘 다 · Command 모드=tool-delegation · 위임 정책=auto.
    defaultForwardMode: 'auto',
    defaultKind: 'command',
    defaultMessageFormat: 'free',
    defaultReturnFormat: 'both',
    defaultPriority: 'normal',
    defaultCommandMode: 'tool-delegation',
    defaultDelegationPolicy: 'auto',
  },
];

/** 템플릿·필드가 비었을 때의 Task Edge 폴백. */
export const TASK_EDGE_DEFAULTS = {
  kind: 'command' as TaskEdgeKind,
  messageFormat: 'free' as const,
  returnFormat: 'summary' as const,
  forwardMode: 'manual' as const,
  retryCount: 0,
  cacheEnabled: false,
  priority: 'normal' as const,
  delegationPolicy: 'strict' as const,
  // kind='critique' 일 때만 의미.
  critiqueTiming: 'intermediate' as const,
  critiqueAuthority: 'force-rework' as const,
  maxReworkCount: 3,
  // kind='command' 일 때만 의미. 'shared' = 부모 도구 박탈 ❌(박탈은 'tool-delegation' 을 고를 때만).
  commandMode: 'shared' as const,
};

/** Critique 재작업 횟수 UI 상한(무한 루프 방지). */
export const TASK_EDGE_CRITIQUE_MAX_REWORK_LIMIT = 10;

/** §5.3 #10-3 — autoAgentId 당 검증 런 보관 상한(오래된 것부터 밀려난다). */
export const AUTO_AGENT_RUN_MAX_PER_AGENT = 50;

/** §5.3 #10-3 — 런 전체 합산 재작업 예산(엣지마다 세면 reviewer·tester 각 3번 = 6번이 된다). 소진은 에스컬레이션. */
export const AUTO_AGENT_RUN_DEFAULT_REWORK_BUDGET = 3;

/** §5.3 #10-3 — 검수자 구조화 판정 형식. 어긋나거나 증거 없는 approve 는 `held` — 해석 실패를 승인으로 흘리면 fail-open 이다. */
export const VERIFICATION_VERDICT_SCHEMA_GUIDE = `
=== Verdict format (structured — required) ===
Reply with a fenced JSON block exactly like this:
\`\`\`json
{
  "verdict": "approve" | "reject",
  "reason": "one line",
  "attempts": [
    { "kind": "build|typecheck|test|run|custom", "command": "pnpm typecheck", "exitCode": 0, "revision": "<git sha, optional>", "detail": "<optional>" }
  ]
}
\`\`\`
Rules:
- "approve" REQUIRES at least one attempt you actually ran, with its real exitCode. Do not invent numbers.
- If you could not run anything, use "reject" or omit the verdict — an approve without evidence is held, not accepted.
- exitCode is the real process exit code. The server decides pass/fail from it; your own opinion of "it looks fine" is not evidence.
`.trim();

/** `bundleRole='auto-rework'` 자동 엣지의 command 라벨(critique force-rework 의 자동 본문, 편집 불가). */
export const TASK_EDGE_AUTO_REWORK_COMMAND_LABEL = 'Rework on critique reject';

/** Task Edge dispatch 기본 타임아웃(ms, 엣지 `timeoutMs` 가 없거나 0 일 때). 0 = 무제한(타이머 없이 완료까지). */
export const TASK_EDGE_DISPATCH_DEFAULT_TIMEOUT_MS = 0;

/**
 * kind 별 시각 스타일(상태 스타일 `TASK_EDGE_STYLES` 와 독립). ⚠ `label`·`description` 을 화면에 그리지 마라 — 한국어라 전 로케일에 한국어로 나간다.
 * 화면 정본은 `bubbleMap.taskEdgeKind.<kind>.{label,description}`.
 */
export const TASK_EDGE_KIND_STYLES: Record<TaskEdgeKind, {
  color: string;
  label: string;
  description: string;
  icon: string;
}> = {
  command: {
    color: '#3B82F6', // blue-500
    label: 'Command',
    description: '지시/명령 — "이 일을 해달라"',
    icon: '▶',
  },
  artifact: {
    color: '#10B981', // emerald-500
    label: 'Artifact',
    description: '결과물 전달 — 파일/diff 자체를 넘김',
    // 비이모지 기하 글리프 — <option> 안에서도 stroke color 적용·텍스트 렌더 가능
    // (command ▶ / request ↩ / critique ◉ 와 동일 정책). 캔버스는 inline SVG 로 렌더.
    icon: '▤',
  },
  request: {
    color: '#F59E0B', // amber-500
    label: 'Request',
    description: '역요청 — "막혔으니 도와달라"',
    icon: '↩',
  },
  critique: {
    color: '#A78BFA', // violet-400 — 비평은 위협이 아니라 관찰이다.
    label: 'Critique',
    description: '비평/리뷰 — 감사·레드팀 역할 (감시자)',
    // 이모지 대신 Unicode 기호라야 stroke color 가 먹는다.
    icon: '◉', // ◉ — 동공이 응시하는 눈
  },
};

/** Task Edge 상태별 엣지 시각 스타일 */
export const TASK_EDGE_STYLES: Record<string, {
  color: string;
  strokeDasharray: string;
  animated: boolean;
}> = {
  idle: { color: '#6B7280', strokeDasharray: '6 4', animated: false },
  executing: { color: '#3B82F6', strokeDasharray: '0', animated: true },
  completed: { color: '#10B981', strokeDasharray: '0', animated: false },
  error: { color: '#EF4444', strokeDasharray: '0', animated: false },
};

// ─── iframe 프록시 ───

/** 프록시 경로 — IframeView에서 cross-origin 페이지를 same-origin으로 로드 */
export const IFRAME_PROXY_PATH = '/iframe-proxy';

// ─── iframe 서버 감지 ───

/** 프론트엔드 dev server 판별 패턴 (명령어에 포함 시 frontend) */
export const FRONTEND_SERVER_PATTERNS: readonly string[] = [
  'vite', 'next dev', 'next start', 'nuxt dev', 'nuxt start',
  'webpack-dev-server', 'webpack serve', 'react-scripts start',
  'ng serve', 'angular', 'astro dev', 'remix dev', 'gatsby develop',
  'parcel', 'snowpack dev', 'turbopack',
];

/** §7.11 — 끝난 Bash 하나에서 프리뷰 후보로 삼을 루프백 주소의 상한. 한 명령이 주소를 수십 개
 *  뱉어도(테스트 로그·접근로그) 그만큼 probe 를 날리지 않게 막는다. */
export const LOOPBACK_SNIFF_URLS_PER_BASH = 4;

/** §7.11 — 같은 (세션, 포트)를 다시 probe 하기까지의 최소 간격(ms). 에이전트는 Bash 를 수백 번
 *  돌리므로 이 문이 없으면 같은 주소에 매번 TCP+HTTP 를 날린다. */
export const LOOPBACK_SNIFF_PROBE_TTL_MS = 60_000;

// §7.11 iframe 서버 로그 스트리밍

/** 서버 측 port 당 ring buffer 최대 라인 수 */
export const IFRAME_LOG_SERVER_BUFFER_MAX = 200;
/** 클라이언트 측 ring buffer 최대 라인 수 (팝업 렌더) */
export const IFRAME_LOG_CLIENT_BUFFER_MAX = 1000;
/** outputFile tail polling 간격 (ms) — BackgroundShellWatcher 와 동일 */
export const IFRAME_LOG_POLL_INTERVAL_MS = 1500;
/** 델타 push 마이크로배치 간격 (ms) — 폭주 보호 */
export const IFRAME_LOG_BATCH_MS = 50;
/** 구독 시작 시 tail read 최대 바이트 */
export const IFRAME_LOG_TAIL_BYTES = 64 * 1024;

// §7.11 죽은 iframe 위성 자동 제거

/** 죽은 iframe 위성이 자동으로 걷히기까지의 grace(ms) — 그동안 dim 으로 남아 Restart 로 되살릴 수 있다. */
export const IFRAME_DEAD_GRACE_MS = 60_000;

// ─── 이미지 붙여넣기 ───

/** 이미지 1장 최대 크기 (bytes) — 10MB */
export const IMAGE_MAX_SIZE = 10 * 1024 * 1024;
/** 한 번에 붙여넣기 가능한 최대 이미지 수 */
export const IMAGE_MAX_COUNT = 20;
/** 허용 MIME 타입 */
export const IMAGE_ALLOWED_TYPES: readonly string[] = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
];
/** 이미지 저장 디렉토리 이름 (save/ 하위) */
export const IMAGE_SAVE_DIR = 'images';

// ─── 토큰 추정 ───

/** 혼합 텍스트 (한글+영어) 바이트당 토큰 추정 비율 */
export const TOKEN_BYTES_RATIO = 0.35;

/**
 * §3.2.4 ② — 서브에이전트 토큰 조회 동시 개수(커스텀은 서브 세션을 모두 합산한다). 순서는 `mapWithConcurrency` 가 보존한다.
 * 무제한 ❌ — 서버가 로컬 단일 프로세스라 메인 스레드가 막힌다.
 */
export const TOKEN_SUBAGENT_FETCH_CONCURRENCY = 4;
/** 시스템 프롬프트 추정 토큰 (도구 사용법, 코딩 규칙 등 내장 지침) */
export const SYSTEM_PROMPT_ESTIMATE = 5_000;
/** 도구 스키마 추정 토큰 (Bash, Read, Edit, Grep 등) */
export const TOOL_SCHEMA_ESTIMATE = 4_000;
/** Git 상태 추정 토큰 */
export const GIT_STATUS_ESTIMATE = 800;
/** 기본 고정 오버헤드 카테고리 목록 (동적 감지 전 기본값) */
export const TOKEN_FIXED_CATEGORIES: { key: string; label: string; estimate: number }[] = [
  { key: 'system_prompt', label: 'System Prompt', estimate: SYSTEM_PROMPT_ESTIMATE },
  { key: 'tool_schemas', label: 'Tool Schemas', estimate: TOOL_SCHEMA_ESTIMATE },
  { key: 'git_status', label: 'Git Status', estimate: GIT_STATUS_ESTIMATE },
];

/** §5.5 #17-28 — 텍스트의 추정 토큰(어림값). 서버 계측과 클라 합계가 같은 산식을 쓴다. 바이트 기준(한글 UTF-8 3바이트가 토큰에 가깝다)·`TOKEN_BYTES_RATIO`. */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  // TextEncoder 는 Node 18+/브라우저 공통. 없으면 문자 수 기반으로 물러난다(테스트 환경 보호).
  const bytes = typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(text).length
    : text.length;
  return Math.round(bytes * TOKEN_BYTES_RATIO);
}

// ─── §5.5 #17-28 컨텍스트 주입원 통제 ───

/** 주입원 안정 키 — 저장되는 값이라 바꾸지 마라(꺼 둔 것이 되살아난다). 실리는지·얼마인지는 매번 읽어서 정한다. */
export const CONTEXT_SOURCE_IDS = {
  // ① Vibisual 이 프롬프트에 직접 조립하는 블록 — 그 자리에서 뺄 수 있다(control: 'session').
  skillsPrefix: 'vibisual.skills-prefix',
  agentRules: 'vibisual.agent-rules',
  edges: 'vibisual.edges',
  feedback: 'vibisual.feedback',
  intentFirst: 'vibisual.intent-first',
  /**
   * §4 (CLI 사양 추종) — 에이전트가 스스로 압축을 요청하는 창구 안내.
   * `AgentConfig.agentCanCompact` 를 켠 에이전트에게만 실리므로, 끄면 이 줄의 바이트도 0 이다.
   */
  compactSelf: 'vibisual.compact-self',
  /** §5.5 #17-28 ⑧(a) — 카드 5종이 공유하는 규칙 한 벌. 카드가 하나라도 켜져 있을 때만 실린다. */
  cardCommon: 'vibisual.card.common',
  cardReport: 'vibisual.card.report',
  cardQuestion: 'vibisual.card.question',
  cardReview: 'vibisual.card.review',
  goal: 'vibisual.goal',
  /** §5.10 — 자동 목표가 싣는 줄. 이름·한 줄 설명뿐인 색인이라 얇다(본문은 에이전트가 필요할 때 연다). 꺼져 있으면 0자. */
  autoGoalSkills: 'vibisual.auto-goal.skills',
  /** §5.26 (E) — 압축 뒤 한 턴만 실리는 복원 브리핑. 평소 0바이트지만 표에 세운다 — 싣는 것이 표에서 빠지면 표가 거짓이다. */
  compactRecovery: 'vibisual.compact-recovery',
  /**
   * §5.3 #12-4 — 검증 정책 문단(시스템 프롬프트) + 이번 명령의 검증 권한(매 턴 앞말). 이 스위치는 안내 문구만 다룬다 —
   * 검증 제한·실행 전 차단은 `permissions.verificationGate` 가 켜져 있을 때만, 꺼져 있으면 제한 문구도 싣지 않는다.
   */
  verificationPolicy: 'vibisual.verification-policy',
  /** 훅으로 붙은 외부 세션에 매 턴 실리는 집행 블록(§5.11). */
  hookEnforcement: 'vibisual.hook-enforcement',
  /** §5.11 집행 플러그인 전체 — 개별 플러그인은 `plugin:<id>` 로 따로 선다. */
  plugins: 'plugins.all',

  // ② Claude Code 쪽 — CLI 인자·환경변수로만 끌 수 있다(control: 'spawn').
  claudeMd: 'cc.claude-md',
  autoMemory: 'cc.auto-memory',
  slashCommands: 'cc.slash-commands',
  bundledSkills: 'cc.bundled-skills',
  workflows: 'cc.workflows',
  gitInstructions: 'cc.git-instructions',

  // ③ 계측만 — 여기서 끌 수 없다(control: 'external' | 'none').
  subagentDefs: 'cc.subagent-defs',
  systemPrompt: 'cc.system-prompt',
  toolSchemas: 'cc.tool-schemas',
  mcp: 'cc.mcp',
  hooks: 'cc.hooks',

  // Codex native sources use their own keys: Claude switches never control Codex.
  codexInstructions: 'codex.instructions',
  codexGlobalInstructions: 'codex.global-instructions',
  codexCollaborationInstructions: 'codex.collaboration-instructions',
  codexSkills: 'codex.skills',
  codexDeveloperInstructions: 'codex.developer-instructions',
  codexMcp: 'codex.mcp',
  codexRuntimeMcp: 'codex.runtime-mcp',
  codexPlugins: 'codex.plugins',
  codexRuntimePlugins: 'codex.runtime-plugins',
  codexHooks: 'codex.hooks',
  codexSystemPrompt: 'codex.system-prompt',
} as const;

/** 개별 플러그인 줄의 id 접두어 — `plugin:ssot-drift` 처럼 선다. */
export const CONTEXT_PLUGIN_ID_PREFIX = 'plugin:';

/** §5.5 #17-28 ⑦ — 상세창 본문 상한(글자, 지시 파일 전문이면 창이 멎는다). 글자·토큰 숫자는 자르기 전 기준(표 합계와 맞게). */
export const CONTEXT_PREVIEW_MAX_CHARS = 60_000;

/** 위 상수의 값 목록(검증·테스트용). */
export const CONTEXT_SOURCE_ID_LIST: string[] = Object.values(CONTEXT_SOURCE_IDS);

/** `control: 'spawn'` 줄을 끄는 인자·환경변수. 헤드리스는 매 턴 새 spawn 이라 다음 프롬프트부터 먹는다. 이름은 CLI 2.1.223 기준 — 모르는 환경변수는 무시돼 스폰이 안 깨진다. */
export const CONTEXT_SPAWN_SWITCHES: Record<string, { env?: string; flag?: string }> = {
  [CONTEXT_SOURCE_IDS.claudeMd]: { env: 'CLAUDE_CODE_DISABLE_CLAUDE_MDS' },
  [CONTEXT_SOURCE_IDS.autoMemory]: { env: 'CLAUDE_CODE_DISABLE_AUTO_MEMORY' },
  [CONTEXT_SOURCE_IDS.slashCommands]: { flag: '--disable-slash-commands' },
  [CONTEXT_SOURCE_IDS.bundledSkills]: { env: 'CLAUDE_CODE_DISABLE_BUNDLED_SKILLS' },
  [CONTEXT_SOURCE_IDS.workflows]: { env: 'CLAUDE_CODE_DISABLE_WORKFLOWS' },
  [CONTEXT_SOURCE_IDS.gitInstructions]: { env: 'CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS' },
};

/** 통제 층 순서(넓음 → 좁음). 상속 사슬을 도는 코드는 이 배열만 본다. */
export const CONTEXT_SCOPE_LEVELS: readonly ContextScopeLevel[] = ['project', 'agent', 'session'];

/** `resolveContextEnabled` 가 보는 오버라이드 묶음의 최소 모양(디스크에서 온 옛 값도 받도록 전부 선택). */
export interface ContextOverrideLayers {
  projects?: Record<string, Record<string, boolean>>;
  agents?: Record<string, Record<string, boolean>>;
  sessions?: Record<string, Record<string, boolean>>;
}

/** 한 판정에 필요한 층 키들. 없는 키(예: 세션 탭이 없을 때)는 그 층을 건너뛴다는 뜻이다. */
export interface ContextScopeKeys {
  projectKey?: string | null;
  agentId?: string | null;
  subAgentId?: string | null;
}

/** 층 → 그 층의 키를 어디서 꺼내고 어느 맵에서 찾는가. 사슬을 도는 유일한 표다. */
const CONTEXT_SCOPE_LOOKUP: Record<
  ContextScopeLevel,
  { key: (k: ContextScopeKeys) => string | null | undefined; map: (o: ContextOverrideLayers) => Record<string, Record<string, boolean>> | undefined }
> = {
  session: { key: (k) => k.subAgentId, map: (o) => o.sessions },
  agent: { key: (k) => k.agentId, map: (o) => o.agents },
  project: { key: (k) => k.projectKey, map: (o) => o.projects },
};

/**
 * 최종 판정 한 곳 — 세션 > 에이전트 > 프로젝트 > 기본값. 서버와 클라가 함께 쓴다(두 벌이면 화면과 프롬프트가 갈린다).
 * `level` 을 주면 그 층 아래는 보지 않는다 — 아래층을 섞어 그리면 위층 스위치가 안 움직이는 것처럼 보인다.
 */
export function resolveContextEnabled(
  overrides: ContextOverrideLayers | null | undefined,
  scopeKeys: ContextScopeKeys,
  sourceId: string,
  defaultEnabled: boolean,
  level: ContextScopeLevel = 'session',
): { enabled: boolean; scope?: ContextScopeLevel } {
  if (overrides) {
    // 좁은 층부터 — 먼저 걸리는 명시값이 이긴다. `level` 보다 좁은 층은 아예 보지 않는다.
    const from = CONTEXT_SCOPE_LEVELS.indexOf(level); // 0=project, 1=agent, 2=session
    for (let i = from; i >= 0; i--) {
      const lv = CONTEXT_SCOPE_LEVELS[i]!;
      const look = CONTEXT_SCOPE_LOOKUP[lv];
      const key = look.key(scopeKeys);
      if (!key) continue;
      const v = look.map(overrides)?.[key]?.[sourceId];
      if (typeof v === 'boolean') return { enabled: v, scope: lv };
    }
  }
  return { enabled: defaultEnabled };
}

/** 그 층에 명시적으로 걸린 값(undefined = 물려받는 중). 화면이 되돌리기·아래층 별도 설정을 가르는 근거 — 판정은 `resolveContextEnabled` 뿐. */
export function contextOverrideAt(
  overrides: ContextOverrideLayers | null | undefined,
  scopeKeys: ContextScopeKeys,
  sourceId: string,
  level: ContextScopeLevel,
): boolean | undefined {
  if (!overrides) return undefined;
  const look = CONTEXT_SCOPE_LOOKUP[level];
  const key = look.key(scopeKeys);
  if (!key) return undefined;
  const v = look.map(overrides)?.[key]?.[sourceId];
  return typeof v === 'boolean' ? v : undefined;
}

/** 명시값을 지웠을 때 물려받을 값 — 토글이 이것과 같아지면 명시값을 지운다. `defaultEnabled` 로 재지 마라 — 프로젝트에서 끈 줄을 세션에서 켜면 도로 꺼진다. */
export function contextInheritedAt(
  overrides: ContextOverrideLayers | null | undefined,
  scopeKeys: ContextScopeKeys,
  sourceId: string,
  defaultEnabled: boolean,
  level: ContextScopeLevel,
): boolean {
  const idx = CONTEXT_SCOPE_LEVELS.indexOf(level);
  if (idx <= 0) return defaultEnabled; // 프로젝트 층 위에는 기본값뿐이다.
  return resolveContextEnabled(overrides, scopeKeys, sourceId, defaultEnabled, CONTEXT_SCOPE_LEVELS[idx - 1]!).enabled;
}

/** 층마다 "여기서 보면 켜져 있나" 한 벌 — 화면이 고른 층의 스위치를 이 값으로 그린다. */
export function contextScopeStates(
  overrides: ContextOverrideLayers | null | undefined,
  scopeKeys: ContextScopeKeys,
  sourceId: string,
  defaultEnabled: boolean,
): Record<ContextScopeLevel, boolean> {
  return {
    project: resolveContextEnabled(overrides, scopeKeys, sourceId, defaultEnabled, 'project').enabled,
    agent: resolveContextEnabled(overrides, scopeKeys, sourceId, defaultEnabled, 'agent').enabled,
    session: resolveContextEnabled(overrides, scopeKeys, sourceId, defaultEnabled, 'session').enabled,
  };
}


// ─── Git Status (§7.6 GitStatusCard) ───

export const GIT_STATUS_CONFIG = {
  /** 서버 캐시 TTL (ms). 동일 projectName 재조회 시 이 시간 내면 캐시 반환. */
  CACHE_TTL_MS: 3_000,
  /** 최근 커밋 리스트 길이 */
  COMMIT_LIST_SIZE: 3,
  /** git 명령 타임아웃 (ms) */
  COMMAND_TIMEOUT_MS: 5_000,
  /** root 버블 dirty dot 색상 (amber-500) */
  DIRTY_DOT_COLOR: '#F59E0B',
  /** Claude 생성 커밋 감지용 Co-Authored-By 문자열 (소문자 비교) */
  CLAUDE_COAUTHOR_MARKER: 'co-authored-by: claude',
} as const;

// Comment Box (언리얼 블프 스타일 주석)

/** Comment Box 기본값 — 크기·색·폰트·LOD 임계치는 여기서만(§3.3). */
export const COMMENT_BOX_DEFAULTS = {
  /** 새 박스 생성 시 선택된 버블 bbox 에 덧붙일 padding (px). */
  PADDING: 40,
  /** 선택 없이 빈 캔버스에서 생성했을 때 초기 크기 (px). */
  EMPTY_WIDTH: 320,
  EMPTY_HEIGHT: 200,
  /** 리사이즈 최소 크기. */
  MIN_WIDTH: 160,
  MIN_HEIGHT: 100,
  /** 텍스트 헤더 높이 (자식 영역 상단 여백). */
  HEADER_HEIGHT: 32,
  /** 기본 배경/텍스트. */
  FONT_SIZE: 14,
  OPACITY: 0.35,
  /** 기본 색 — 어두운 회색(slate-700). 사용자가 새 코멘트를 만들 때의 차분한 출발점. */
  DEFAULT_COLOR: '#334155',
  /** 기본 텍스트. i18n key 를 직접 넣지 않고 클라이언트에서 생성. */
  DEFAULT_TEXT: 'Comment',
  /** 자식이 떨어진 위치가 Comment 영역을 벗어나면 membership 에서 자동 제외 (px margin). */
  MEMBERSHIP_MARGIN: 8,
  /** 단축키 — 캔버스에 다중 선택이 있을 때 이 키로 생성. */
  CREATE_HOTKEY: 'KeyC',
} as const;

/** 라벨 LOD — 줌 < BALLOON_BELOW 면 박스 밖 위에 큰 풍선 라벨, 그 위로는 박스 안 헤더. */
export const COMMENT_BOX_LOD = {
  /** 이 zoom 미만이면 외부 풍선 라벨 표시. */
  BALLOON_BELOW: 0.55,
  /** 풍선 폰트는 zoom 이 작을수록 상대적으로 커짐 — 스크린 고정 사이즈로 렌더하기 위해 1/zoom 비율 사용. */
  BALLOON_SCREEN_FONT_PX: 18,
  /** 풍선 최대 글자 수 (넘으면 ellipsis). */
  BALLOON_MAX_CHARS: 80,
} as const;

/** §4 가시성 LOD — 안 보이면(화면 밖·전면 오버레이에 가림) 안 그린다. 줌아웃은 멀리서 보는 것이라 이펙트·정보를 빼지 마라. */
export const CANVAS_LOD = {
  /** 뷰포트 밖 노드·엣지를 아예 렌더하지 않는다(React Flow onlyRenderVisibleElements). */
  CULL_OFFSCREEN: true,
} as const;

/**
 * §5.4 #31 연결 무리 강조(Ctrl/Cmd + 버블 잡기). 색을 새로 칠하지 않는다 — 카테고리 색 사이에서 새 색은 "종류"로 읽힌다. 밝기와 흰 빛으로만.
 * scale 은 건드리지 마라 — 엣지 끝점은 `measured` 기준이라 화살표가 어긋난다.
 */
export const LINK_FOCUS = {
  /** 무리 밖 버블이 물러나는 불투명도(곱). 0 이면 사라지므로 "거기 있다"는 것은 남긴다. */
  DIM_OPACITY: 0.22,
  /** 물러난 것에서 색기를 뺀다 — 투명도만 낮추면 원색이 그대로 눈에 걸린다. */
  DIM_SATURATE: 0.4,
  /** 무리 안 버블을 살짝 올려 주는 밝기(곱). */
  LIT_BRIGHTNESS: 1.12,
  /**
   * 빛의 색 — 흰빛 하나로 고정한다(`R,G,B`). 알파는 아래 값들이 따로 정하므로 문자열이 아니라
   * 성분으로 둔다: 미리보기와 확정 사이를 **알파로 보간**해야 세기가 한 축으로 이어진다.
   */
  TINT_RGB: '255,255,255',
  /** 무리 안 버블의 테두리 — 어떤 카테고리 색 위에서도 대비가 선다. */
  RING_ALPHA: 0.55,
  RING_WIDTH: 2,
  GLOW_ALPHA: 0.16,
  GLOW_BLUR: 16,
  /** 중심(잡은 버블) — 같은 모양을 한 단계 강하게. */
  FOCUS_RING_ALPHA: 0.92,
  FOCUS_RING_WIDTH: 3,
  FOCUS_GLOW_ALPHA: 0.3,
  FOCUS_GLOW_BLUR: 26,
  /** 강조가 켜지고 꺼지는 시간(ms) — 손끝 반응이라 짧게. */
  TRANSITION_MS: 150,
  /** 미리보기(Ctrl 만 쥐고 올림) 세기(곱) — 확정과 같으면 "이미 일어났다"로 읽힌다. */
  HOVER_STRENGTH: 0.55,
  /** 무리 밖 엣지의 불투명도(곱). 버블보다 더 물러난다 — 선이 남아 있으면 시야가 어지럽다. */
  EDGE_DIM_OPACITY: 0.12,
  /** 무리 안 엣지 굵기(곱)와 불투명도. */
  EDGE_LIT_WIDTH: 1.7,
  EDGE_LIT_OPACITY: 1,
} as const;

/** §5.4 #33 — 정리 띠 순서 = 지금 봐야 하는 급한 정도(종류가 아니라 상태). 새 띠는 한 줄 추가로만(배치 함수는 이름을 모른다, §3.3). */
export const TIDY_BAND_ORDER: readonly TidyBand[] = ['running', 'attention', 'waiting', 'folder', 'other'];

/** §5.4 #33 정리 배치 값 — 간격은 물리(`MAGNET_GAP`·`REPULSION_RANGE`)보다 넉넉해야 한다(물리가 다시 밀면 곧 풀린다). */
export const TIDY_LAYOUT = {
  /** 이웃 간격(px). `RING_GAP` < `ROW_GAP` < `BAND_GAP` 의 크기 차이가 이웃 / 다음 줄 / 다른 칸으로 읽힌다(§5.4 #33 (C)). */
  RING_GAP: 34,
  /** 한 칸이 여러 줄(또는 여러 고리)로 접혔을 때 줄과 줄 사이 간격(px). */
  ROW_GAP: 30,
  /** 칸과 칸 사이 간격(px) — 여기서 "무리가 갈렸다"가 읽힌다. 줄 사이보다 확실히 넓다. */
  BAND_GAP: 96,
  /** 가장 안쪽 고리의 최소 반경(px). 하나뿐이어도 다음 띠가 코앞에 붙지 않게. */
  MIN_RADIUS: 150,
  /**
   * 세로 눌림의 하한(0<a≤1). 캔버스 바운딩 박스의 세로/가로 비를 그대로 쓰되 이보다 납작해지지
   * 않게 막는다 — 너무 납작하면 고리가 띠처럼 보여 "동심"이라는 뜻이 사라진다.
   */
  MIN_ASPECT: 0.62,
  /** 타원 호 길이를 재는 표본 수. 자리 나눔이 각도가 아니라 **호 길이** 기준이라 필요하다. */
  ARC_SAMPLES: 720,
  /** 옮겨 가는 시간(ms). */
  DURATION_MS: 720,
  /** 띠마다 늦게 출발하는 간격(ms) — 안쪽부터 차례로 앉아 한꺼번에 뒤엉키지 않는다. */
  BAND_STAGGER_MS: 70,
  /** 이만큼도 안 움직이는 버블은 목록에서 뺀다(px) — 이미 제자리다. */
  SETTLED_EPSILON: 1,
  /** §5.4 #33 (I) 무리 사이 간격(px) — `BAND_GAP` 보다 넓다(덩어리는 빈 자리 말고 경계가 없다). */
  CLUSTER_GAP: 130,
  /** §5.4 #33 (I-2) 연속값을 자르는 분위 수 — 절대 기준이면 한 칸에 몰린다(§5.24 `quantile`). `TIDY_BAND_ORDER` 수와 맞춰 지도 크기가 안 튀게 한다. */
  QUANTILE_BUCKETS: 5,
  /**
   * §5.4 #33 (I-5) 줄 세우기 — 한 줄이 캔버스 바운딩 박스(§3.3 `layoutBounds`)의 이 비율까지만
   * 쓴다. 상자를 넘겨 앉히면 (B) 가 말한 물리 클램프에 도로 눌려 정리한 모양이 앉자마자 망가진다.
   */
  LANE_FILL: 0.92,
} as const;

/**
 * §5.1 #2-2 등장 영역 — 새 버블의 첫 자리(주인 둘레 동심 고리의 빈칸, 붐비면 바깥). 간격은 정리(§5.4 #33)와 같은 `TIDY_LAYOUT`·`SATELLITE_*` 값을 쓴다
 * — 같아야 물리가 다시 밀지 않는다(§5.1 #2-2 (J)).
 */
export const SPAWN_ZONE = {
  /** 고리 첫 칸 방향(라디안) = 12시, 각이 커지면 시계 방향(화면 y 가 아래로). 시작점이 없으면 순서가 안 읽힌다. */
  START_ANGLE: -Math.PI / 2,
  /** 위성 칸 기준 지름(px, 파일 위성 범위의 가운데). 한 부모의 위성이 한 격자를 나눠 써야 고리로 보인다(큰 위성은 겹침 판정이 거른다). */
  SATELLITE_SLOT: (FILE_MIN_SIZE + FILE_MAX_SIZE) / 2,
  /** 사각 창·말풍선이 원판에 든 넓이를 재는 표본 수(N×N). 식 대신 표본으로 어림한다 — 붐빔을 칸 단위로 묻는 데 충분하다. */
  AREA_SAMPLES: 8,
  /** 상자가 없을 때(시험·폴백) 훑는 고리 수의 상한 — 탐색이 끝나는 자리. */
  MAX_RINGS: 24,
} as const;

/** §5.23 큰 원(`radialLayout`)에서 빼는 타입 — 반지름이 개수에 비례해 수십 개가 들면 원이 물리 상자를 넘어 이웃까지 벽으로 민다. 새 타입은 한 줄로. */
export const WEB_ORBIT_TYPES: ReadonlySet<BubbleType> = new Set<BubbleType>(['domain']);

/**
 * §5.4 #33 (I) 정리 기준(순서 = 패널 순서). `geometry` 는 별개 축이다 — 순위 있는 기준은 줄 세우기, 순위 없는 분류는 덩어리(뜻 없는 서열 ❌).
 * 새 기준은 한 줄 추가로만(§3.3).
 */
export const TIDY_SORTS: readonly { readonly id: TidySort; readonly geometry: TidyGeometry }[] = [
  /** (A) 의 띠 순서 — 도는 것이 맨 윗 줄. */
  { id: 'status', geometry: 'rows' },
  /** 같은 종류끼리 한 덩어리 — "이 파일들이 다 어디 있더라". */
  { id: 'kind', geometry: 'clusters' },
  /** 많이 만진 순 — 축(읽기/쓰기)은 §5.24 히트맵이 정한다. */
  { id: 'heat', geometry: 'rows' },
  /** 최근에 만진 순 — 방금 만진 것이 맨 윗 줄 왼쪽. */
  { id: 'recent', geometry: 'rows' },
  /** 에이전트 무리끼리 한 덩어리 — "이 에이전트가 건드린 게 뭐뭐지". 주인이 덩어리 가운데. */
  { id: 'lineage', geometry: 'clusters' },
];

/** §5.4 #33 (I-4) 정리 기준 기본값 — 종전 동작 그대로라 이 기능이 아무것도 빼앗지 않는다. */
export const DEFAULT_TIDY_SORT: TidySort = 'status';

/** 알 수 없는 값이 들어와도 화면이 비지 않게 — 기본값으로 접는다(`normalizeHeatCurve` 선례). */
export function normalizeTidySort(value: unknown): TidySort {
  return TIDY_SORTS.some((s) => s.id === value) ? (value as TidySort) : DEFAULT_TIDY_SORT;
}

/** 이 기준이 어떤 기하로 앉는가. 표 밖의 값이면 줄 세우기(기본 기하). */
export function tidyGeometryOf(sort: TidySort): TidyGeometry {
  return TIDY_SORTS.find((s) => s.id === sort)?.geometry ?? 'rows';
}

/** §5.9 캡처 버블 기본값(캔버스 독립 요소라 절대좌표, 16:9). 크롬은 무채색 — 채도 높은 색면은 라이브 영상과 싸운다. 색은 라이브 도트·선택 링·조작 링에만. */
export const CAPTURE_BUBBLE_DEFAULTS = {
  /** 새 캡처 버블 초기 크기 (px, 16:9). */
  DEFAULT_WIDTH: 320,
  DEFAULT_HEIGHT: 180,
  /** 리사이즈 최소 크기. */
  MIN_WIDTH: 160,
  MIN_HEIGHT: 90,
  /** 라벨 헤더 높이(px). */
  HEADER_HEIGHT: 26,
  /** 정체성/선택 액센트 — sky-400. 링·아이콘 등 얇은 선에만 쓴다(색면 ❌). */
  ACCENT_COLOR: '#38BDF8',
  /** 라이브(녹화등) 도트 — 옛 rose 는 여기 6px 점으로만 남는다. */
  LIVE_COLOR: '#FB7185',
  /** 조작 중 링 — 기존 emerald 규칙 유지. */
  CONTROL_COLOR: '#10B981',
  /** 크롬(헤더·타이틀바) 유리면. */
  CHROME_BG: 'rgba(14,17,23,0.88)',
  /** 크롬 테두리 헤어라인. */
  CHROME_BORDER: 'rgba(255,255,255,0.10)',
  /** 영상 배경(레터박스). */
  STAGE_BG: '#07090D',
} as const;

/** §5.9 캡처 버블 자석 스냅 값. 임계값은 화면 px — 판정 때 줌으로 나눈다(줌과 무관하게 손끝 감각이 같게). */
export const CAPTURE_SNAP = {
  /** 이 거리(화면 px) 안으로 들어오면 변을 붙인다. */
  THRESHOLD_PX: 12,
  /**
   * 맞대기(변끼리 이어 붙이기) 후보에 주는 우선 가중치(화면 px). 같은 거리에서 "정렬"과
   * "붙이기"가 경합하면 붙이기가 이긴다 — 사용자가 원하는 건 대개 이어 붙이기다.
   */
  BUTT_BONUS_PX: 5,
  /**
   * 맞대기로 인정할 최소 겹침(캔버스 px). 옆을 스치듯 지나가는 먼 버블에 변이 빨려가는
   * 착시를 막는다(세로로 거의 안 겹치는데 좌우 변이 붙는 현상).
   */
  MIN_OVERLAP: 24,
  /** 스냅이 걸린 축을 보여 주는 가이드선 색 — 맞대기(이어 붙임). */
  GUIDE_BUTT_COLOR: '#38BDF8',
  /** 가이드선 색 — 정렬(변 맞춤, 붙지는 않음). */
  GUIDE_ALIGN_COLOR: '#A78BFA',
  /** 가이드선 두께(화면 px) — 렌더 시 줌으로 나눠 캔버스 단위로 환산. */
  GUIDE_WIDTH_PX: 1.5,
} as const;

/** §5.9 캡처 플레이테스트(녹화 + 구간 프레임 첨부). 영상은 렌더러 메모리(Blob)에만 살아 길이·개수 상한이 곧 안전장치다. */
export const CAPTURE_PLAYTEST = {
  /** 한 클립 최대 길이(초). 넘으면 녹화가 스스로 멈춘다(누르고 잊어도 메모리가 자라지 않게). */
  MAX_CLIP_SECONDS: 180,
  /** 버블당 보관 클립 수. 넘치면 가장 오래된 것부터 버린다(Blob URL 도 함께 되돌린다). */
  MAX_CLIPS_PER_BUBBLE: 6,
  /** 구간에서 뽑을 프레임 장수 선택지(세그먼트 피커). */
  FRAME_COUNT_OPTIONS: [1, 2, 4, 6, 9],
  /** 기본 프레임 장수 — 한 장은 맥락이 없고 열 장은 입력창을 덮는다. */
  DEFAULT_FRAME_COUNT: 4,
  /** 한 번에 붙일 수 있는 최대 프레임 장수. */
  MAX_FRAME_COUNT: 9,
  /** 구간 최소 길이(ms). 손잡이가 이보다 좁아지지 않는다(프레임이 전부 같은 그림이 되는 것 방지). */
  MIN_RANGE_MS: 200,
  /** MediaRecorder 조각 주기(ms). 조각이 있어야 중간에 멈춰도 앞부분이 살아 있다. */
  TIMESLICE_MS: 1000,
  /** 녹화 컨테이너 후보 — 앞에서부터 이 환경이 지원하는 첫 번째를 쓴다(Chromium/Electron 기준). */
  MIME_CANDIDATES: ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"],
  /** 프레임 한 장을 뽑을 때 seek 를 기다리는 상한(ms). 못 받으면 그 장은 건너뛴다(무한 대기 ❌). */
  SEEK_TIMEOUT_MS: 4000,
  /** 첨부 프레임 가로 상한(px). 4K 원본이어도 이 폭으로 줄여 붙인다(업로드·토큰 절감). */
  FRAME_MAX_WIDTH: 1280,
  /** 녹화 중 표시색 — 라이브 도트(LIVE_COLOR)와 구분되는 진한 붉음(red-500). */
  RECORD_COLOR: "#EF4444",
} as const;

/** UE 블프 풍 팔레트 — CommentBoxDetail 색 버튼 소스. */
export const COMMENT_BOX_PALETTE: readonly { id: string; label: string; color: string }[] = [
  { id: 'amber', label: 'Amber', color: '#F59E0B' },
  { id: 'rose', label: 'Rose', color: '#F43F5E' },
  { id: 'emerald', label: 'Emerald', color: '#10B981' },
  { id: 'sky', label: 'Sky', color: '#0EA5E9' },
  { id: 'violet', label: 'Violet', color: '#8B5CF6' },
  { id: 'pink', label: 'Pink', color: '#EC4899' },
  { id: 'teal', label: 'Teal', color: '#14B8A6' },
  { id: 'slate', label: 'Slate', color: '#64748B' },
] as const;


// ─── 세션 스티키 메모 (§5.5 #17-36) ───

/** 스티키 메모 기본값·상한(§3.3). 글자 길이·장수 상한을 함께 둔다 — 하나만 막으면 다른 축으로 자란다(§3.2.3). */
export const SESSION_MEMO = {
  /** 새 메모 기본 크기 (px). */
  DEFAULT_W: 260,
  DEFAULT_H: 190,
  /** 리사이즈 하한/상한 (px). */
  MIN_W: 168,
  MIN_H: 96,
  MAX_W: 1200,
  MAX_H: 900,
  /** 제목줄 높이 (px) — 접으면 이만큼만 남는다. 12px 글자 + 손잡이가 들어가는 최소치(§9). */
  HEADER_H: 28,
  /** 본문 상한 (자). 넘치면 잘라 저장한다. */
  TEXT_MAX: 4000,
  /** 이름 상한(자) — 화면은 `…` 로 줄지만 저장값도 상한이 있어야 한다(§3.2.3). */
  NAME_MAX: 60,
  /** 한 세션(또는 메인 탭)에서 열 수 있는 메모 장수 상한. 닫은 기록은 포함하지 않는다. */
  MAX_PER_OWNER: 24,
  /** 좌표 상한 (px) — 창 밖 좌표가 들어와도 여기서 멈춘다(복원 시 화면 밖 실종 방지). */
  MAX_COORD: 20000,
  /** 같은 자리에 겹쳐 만들 때 계단식으로 밀어 놓는 간격 (px). [펼치기]가 자리를 찾는 격자도 이 눈금이다. */
  CASCADE_STEP: 18,
  /** 손이 올라간 카드를 잠시 맨 앞으로 올리는 z(판 `z-[15]` 안이라 IDE 크롬은 안 가린다). 저장하지 않는다 — 겹친 순서는 두고 보기만 바꾼다. */
  PEEK_Z: 1000,
  /**
   * [겹친 메모 펼치기]가 빈자리를 찾을 때 넓혀 가는 고리의 최대 수(고리 하나 = `CASCADE_STEP`).
   * 유한한 이유는 판이 꽉 찼을 때 **못 찾는 것이 정상**이기 때문이다 — 그때는 제자리에 둔다.
   */
  SPREAD_MAX_RING: 48,
  /** 컨테이너 밖으로 나가지 않게 남겨 두는 최소 여백 (px) — 제목줄은 항상 잡을 수 있어야 한다. */
  EDGE_KEEP: 24,
  /**
   * 종이의 불투명도 기본값. 1 이 아닌 것이 의도다 — 메모는 **대화 위에 뜬 유리판**이라
   * 아래 글이 비쳐야 "무엇을 가리고 있는지"가 보인다(뒤는 `backdrop-filter` 로 흐린다).
   */
  DEFAULT_ALPHA: 0.82,
  /** 불투명도 하한/상한. 하한이 0 이 아닌 것도 의도 — 완전 투명이면 잡을 수 없는 유령이 된다. */
  MIN_ALPHA: 0.2,
  MAX_ALPHA: 1,
  /** 불투명도 슬라이더 눈금. 저장은 소수 둘째 자리까지만(왕복 비교가 부동소수로 흔들리지 않게). */
  ALPHA_STEP: 0.01,
  /** §5.5 #17-36 ⑫ — 메모 한 장의 링크 수 상한(§3.2.3). */
  LINK_MAX: 32,
  /** 세션 글 위치 링크가 기억하는 **그 자리의 글** 상한(자) — 도착해 칠할 글자이자 링크 상자의 요약. */
  LINK_TEXT_MAX: 200,
  /** 눌러서 고른 항목이 남기는 글 머리 길이(자) — 본문이 수천 자일 수 있어 첫머리만(드래그로 고른 글은 `LINK_TEXT_MAX` 까지). */
  LINK_HEAD_MAX: 80,
  /** 다른 세션 링크가 기억하는 탭 이름 상한(자) — 탭이 닫힌 뒤에도 무엇을 가리켰는지 말하려고 둔다. */
  LINK_LABEL_MAX: 80,
  /** 파일 링크 경로 상한(자) — 본문 경로 링크(#17-27 ⑬ `MAX_LINK_PATH_LEN`)와 같은 값. */
  LINK_PATH_MAX: 1024,
  /** 웹 주소 링크 상한(자). */
  LINK_URL_MAX: 2048,
  /** 스트림 항목 id 상한(자). */
  LINK_ANCHOR_MAX: 200,
  /** [세션 글 위치 ▸] 목록에 세우는 **내 입력** 수(최근 것부터). 더 오래된 것은 대화에서 직접 고른다. */
  LINK_PROMPT_MAX: 12,
} as const;

/** §5.5 #17-36 ⑫ — 메모 링크 종류와 목록 순서(첫 자리는 세션 글 위치). [링크 ▸] 목록이 이 표를 돈다. */
export const SESSION_MEMO_LINK_KINDS: readonly SessionMemoLinkKind[] = ['stream', 'session', 'file', 'url'] as const;

/** 메모 팔레트 — `COMMENT_BOX_PALETTE` 계열의 깊은 판(어두운 IDE 위에서 파스텔은 튄다). 글자색은 알파를 섞어 실제로 보이는 색으로 판정한다(`memoSurface`). */
export const SESSION_MEMO_PALETTE: readonly { id: string; label: string; color: string }[] = [
  { id: 'slate', label: 'Slate', color: '#334155' },
  { id: 'sky', label: 'Sky', color: '#075985' },
  { id: 'teal', label: 'Teal', color: '#115E59' },
  { id: 'emerald', label: 'Emerald', color: '#065F46' },
  { id: 'amber', label: 'Amber', color: '#92400E' },
  { id: 'rose', label: 'Rose', color: '#9F1239' },
  { id: 'violet', label: 'Violet', color: '#5B21B6' },
  { id: 'paper', label: 'Paper', color: '#E2E8F0' },
] as const;

/** 새 메모의 기본색 — 팔레트 첫 칸과 같아야 한다(`sessionMemo.test.ts` 가 지킨다). */
export const SESSION_MEMO_DEFAULT_COLOR = '#334155';

/** 옛 파스텔 → 새 팔레트 이관표(키는 대문자 `#RRGGBB`). 색이 메모에 저장돼 정화 때 갈아 끼운다 — 옛 8칸은 스와치 전용이라 자유색을 덮지 않는다. */
export const SESSION_MEMO_LEGACY_COLOR_MAP: Readonly<Record<string, string>> = {
  '#FDE68A': '#92400E', // yellow → amber
  '#FED7AA': '#92400E', // orange → amber
  '#FBCFE8': '#9F1239', // pink   → rose
  '#BBF7D0': '#065F46', // green  → emerald
  '#99F6E4': '#115E59', // teal   → teal
  '#BFDBFE': '#075985', // blue   → sky
  '#DDD6FE': '#5B21B6', // violet → violet
  '#F1F5F9': '#E2E8F0', // white  → paper
};

/** `#RRGGBB` 만 통과. 임의 문자열이 style 속성으로 새어 들어가는 것을 막는다. */
const SESSION_MEMO_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.round(Math.max(min, Math.min(max, v)));
}

/**
 * 불투명도를 `ALPHA_STEP` 눈금에 맞춘다 — 나눗셈으로. `Math.round(0.82 / 0.01) * 0.01 === 0.8200000000000001` 이라
 * 곱하면 기본값이 "다르다"로 판정돼 기본값 생략·저장 왕복 비교가 무너진다.
 */
function clampMemoAlpha(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return SESSION_MEMO.DEFAULT_ALPHA;
  const clamped = Math.max(SESSION_MEMO.MIN_ALPHA, Math.min(SESSION_MEMO.MAX_ALPHA, v));
  const scale = Math.round(1 / SESSION_MEMO.ALPHA_STEP);
  return Math.round(clamped * scale) / scale;
}

/**
 * 메모 이름 정화 — 줄바꿈·탭을 공백으로 접고(제목줄은 한 줄) 다듬어 상한까지. 빈 값이면 `''`.
 * ⚠ 화면과 서버가 같은 함수를 쓴다 — 다르면 낙관 왕복 비교(`SessionMemoLayer.pushedRef`)가 영영 안 맞는다. 클라에 복제하지 마라.
 */
export function normalizeMemoName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  return oneLine.length > SESSION_MEMO.NAME_MAX ? oneLine.slice(0, SESSION_MEMO.NAME_MAX).trim() : oneLine;
}

// §5.5 #17-36 ⑫ 메모 링크 정화 — 화면과 서버가 같은 함수를 쓴다(낙관 왕복 비교).

/** id·세션 id 모양 — 메모 id 와 같은 규칙(임의 문자열이 키·DOM 속성으로 새지 않게). */
const SESSION_MEMO_ID_RE = /^[\w-]{1,64}$/;
/** 제어 문자 — 경로·주소·항목 id 에 들어오면 그 링크는 버린다. */
const SESSION_MEMO_LINK_CONTROL_RE = /[\u0000-\u001f\u007f]/;
/** 스트림 항목 id — 공백·따옴표·역슬래시·꺾쇠 ❌. 화면이 이 값으로 항목을 찾으므로 선택자·속성 문자열을 깨뜨리면 안 된다. */
const SESSION_MEMO_LINK_ANCHOR_RE = /^[^\s"'`\\<>]+$/;
/**
 * 웹 주소 — **http(s) 만**. 링크를 누르면 바깥 브라우저로 가는 길(`window.open`)을 타므로
 * `javascript:`·`file:`·`data:` 가 그 길로 새면 안 된다. 호스트 자리가 비어 있어도 버린다.
 */
const SESSION_MEMO_LINK_URL_RE = /^https?:\/\/[^\s/?#"'<>\\][^\s"'<>\\]*$/i;

/** 링크가 기억하는 글 정화 — 제어 문자·공백을 한 칸으로 접어 상한까지. 화면도 칠할 때도(`findTextRangeInContainer`) 공백을 접어 견준다. */
export function normalizeMemoLinkText(raw: unknown, max: number = SESSION_MEMO.LINK_TEXT_MAX): string {
  if (typeof raw !== 'string') return '';
  const folded = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return folded.length > max ? folded.slice(0, max).trim() : folded;
}

/** 웹 주소 정화 — 앞뒤 공백만 다듬고, 규칙에 안 맞으면 `''`(= 그 링크는 버린다). */
export function normalizeMemoLinkUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const url = raw.trim();
  if (url.length === 0 || url.length > SESSION_MEMO.LINK_URL_MAX) return '';
  return SESSION_MEMO_LINK_URL_RE.test(url) ? url : '';
}

/** 파일 링크 경로 정화 — 앞뒤 공백만 다듬는다. 제어 문자가 있거나 상한을 넘으면 `''`. */
export function normalizeMemoLinkPath(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const p = raw.trim();
  if (p.length === 0 || p.length > SESSION_MEMO.LINK_PATH_MAX) return '';
  return SESSION_MEMO_LINK_CONTROL_RE.test(p) ? '' : p;
}

/** 세션 id — null(메인 탭)은 그대로, 문자열은 모양이 맞을 때만. 안 맞으면 `undefined`(= 버린다). */
function sanitizeMemoLinkSessionId(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const id = v.trim();
  return SESSION_MEMO_ID_RE.test(id) ? id : undefined;
}

/**
 * 링크가 가리키는 곳 한 개 정화. 모양이 어긋나면 `null`(= 그 링크는 버린다).
 * 키 순서를 **종류마다 고정**해 돌려준다 — 저장 왕복 비교는 직렬화한 글자로 견주기 때문이다.
 */
export function sanitizeMemoLinkTarget(input: unknown): SessionMemoLinkTarget | null {
  if (!input || typeof input !== 'object') return null;
  const n = input as Record<string, unknown>;
  switch (n['kind']) {
    case 'stream': {
      const sessionId = sanitizeMemoLinkSessionId(n['sessionId']);
      if (sessionId === undefined) return null;
      const rawAnchor = typeof n['anchorId'] === 'string' ? n['anchorId'].trim() : '';
      const anchorId = rawAnchor.length > 0
        && rawAnchor.length <= SESSION_MEMO.LINK_ANCHOR_MAX
        && SESSION_MEMO_LINK_ANCHOR_RE.test(rawAnchor)
        && !SESSION_MEMO_LINK_CONTROL_RE.test(rawAnchor)
        ? rawAnchor
        : '';
      const text = normalizeMemoLinkText(n['text']);
      // 갈 곳이 하나도 없으면(항목도 글도 없다) 링크가 아니다.
      if (!anchorId && !text) return null;
      return { kind: 'stream', sessionId, ...(anchorId ? { anchorId } : {}), text };
    }
    case 'session': {
      const sessionId = sanitizeMemoLinkSessionId(n['sessionId']);
      if (sessionId === undefined) return null;
      const label = normalizeMemoLinkText(n['label'], SESSION_MEMO.LINK_LABEL_MAX);
      return { kind: 'session', sessionId, ...(label ? { label } : {}) };
    }
    case 'file': {
      const path = normalizeMemoLinkPath(n['path']);
      return path ? { kind: 'file', path } : null;
    }
    case 'url': {
      const url = normalizeMemoLinkUrl(n['url']);
      return url ? { kind: 'url', url } : null;
    }
    default:
      return null;
  }
}

/** 링크 한 개 정화 — 범위가 본문 밖이거나 비었거나 정수가 아니면 `null`. */
function sanitizeMemoLink(input: unknown, textLength: number): SessionMemoLink | null {
  if (!input || typeof input !== 'object') return null;
  const n = input as Record<string, unknown>;
  const id = typeof n['id'] === 'string' ? n['id'].trim() : '';
  if (!SESSION_MEMO_ID_RE.test(id)) return null;
  const start = n['start'];
  const end = n['end'];
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end <= start || end > textLength) return null;
  const target = sanitizeMemoLinkTarget(n['target']);
  return target ? { id, start, end, target } : null;
}

/**
 * 메모 링크 목록 정화(멱등): 어긋난 것·id 겹침·범위 겹침(시작 순, 앞의 것만 — 한 글자가 두 곳을 가리키면 안 된다)을 버리고 `LINK_MAX` 까지.
 * @param textLength 정화된 본문 길이 — 잘린 본문 뒤의 링크도 사라진다.
 */
export function sanitizeMemoLinks(input: unknown, textLength: number): SessionMemoLink[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const candidates: SessionMemoLink[] = [];
  // 거대한 배열이 들어와도 일을 묶는다 — 상한의 몇 배까지만 본다(겹침으로 버려질 몫까지 여유를 둔다).
  for (const raw of input.slice(0, SESSION_MEMO.LINK_MAX * 4)) {
    const link = sanitizeMemoLink(raw, textLength);
    if (!link || seen.has(link.id)) continue;
    seen.add(link.id);
    candidates.push(link);
  }
  candidates.sort((a, b) => a.start - b.start || a.end - b.end);
  const out: SessionMemoLink[] = [];
  let lastEnd = -1;
  for (const link of candidates) {
    if (link.start < lastEnd) continue;
    out.push(link);
    lastEnd = link.end;
    if (out.length >= SESSION_MEMO.LINK_MAX) break;
  }
  return out;
}

/** §5.5 #17-36 — 신뢰할 수 없는 입력에서 메모 1장 복원. 어긋나면 `null`(버린다). */
export function sanitizeSessionMemo(input: unknown): SessionMemo | null {
  if (!input || typeof input !== 'object') return null;
  const n = input as Record<string, unknown>;
  const id = typeof n['id'] === 'string' ? n['id'].trim() : '';
  if (!id || !/^[\w-]{1,64}$/.test(id)) return null;
  const rawText = typeof n['text'] === 'string' ? n['text'] : '';
  const text = rawText.length > SESSION_MEMO.TEXT_MAX ? rawText.slice(0, SESSION_MEMO.TEXT_MAX) : rawText;
  const rawColor = typeof n['color'] === 'string' && SESSION_MEMO_COLOR_RE.test(n['color'])
    ? n['color']
    : SESSION_MEMO_DEFAULT_COLOR;
  // 옛 파스텔 8칸은 새 팔레트로 갈아 끼운다(위 이관표 주석 참고).
  const color = SESSION_MEMO_LEGACY_COLOR_MAP[rawColor.toUpperCase()] ?? rawColor;
  const alpha = clampMemoAlpha(n['alpha']);
  const name = normalizeMemoName(n['name']);
  const closedAt = typeof n['closedAt'] === 'number' && Number.isFinite(n['closedAt']) && n['closedAt'] >= 0
    ? clampNumber(n['closedAt'], 0, Number.MAX_SAFE_INTEGER, 0)
    : undefined;
  // 묶음 이름표는 id 와 같은 모양만 통과 — 임의 문자열이 그룹 키·DOM 속성으로 새지 않게.
  const rawGroup = typeof n['groupId'] === 'string' ? n['groupId'].trim() : '';
  const groupId = closedAt === undefined && /^[\w-]{1,64}$/.test(rawGroup) ? rawGroup : '';
  // ⑫ 링크는 **잘린 뒤의 본문**을 기준으로 거른다 — 상한 밖으로 밀려난 글자에 걸린 링크는 갈 글자가 없다.
  const links = sanitizeMemoLinks(n['links'], text.length);
  const now = Date.now();
  const createdAt = clampNumber(n['createdAt'], 0, Number.MAX_SAFE_INTEGER, now);
  return {
    id,
    text,
    x: clampNumber(n['x'], 0, SESSION_MEMO.MAX_COORD, 0),
    y: clampNumber(n['y'], 0, SESSION_MEMO.MAX_COORD, 0),
    w: clampNumber(n['w'], SESSION_MEMO.MIN_W, SESSION_MEMO.MAX_W, SESSION_MEMO.DEFAULT_W),
    h: clampNumber(n['h'], SESSION_MEMO.MIN_H, SESSION_MEMO.MAX_H, SESSION_MEMO.DEFAULT_H),
    color,
    // 기본값은 남기지 않는다(`collapsed` 와 같은 규약) — 옛 체크포인트가 새 필드로 부풀지 않고,
    //   낙관 표시의 왕복 비교(`pushedRef`)도 판본 사이에서 흔들리지 않는다.
    //   이름도 같다 — 빈 이름은 "이름 없음"이지 "빈 문자열을 붙였다"가 아니다.
    ...(name ? { name } : {}),
    ...(alpha !== SESSION_MEMO.DEFAULT_ALPHA ? { alpha } : {}),
    ...(n['collapsed'] === true ? { collapsed: true } : {}),
    ...(closedAt !== undefined ? { closedAt } : {}),
    ...(groupId ? { groupId } : {}),
    ...(groupId && n['groupActive'] === true ? { groupActive: true } : {}),
    // 링크도 같은 규약 — 하나도 없으면 필드를 남기지 않는다.
    ...(links.length > 0 ? { links } : {}),
    createdAt,
    updatedAt: clampNumber(n['updatedAt'], 0, Number.MAX_SAFE_INTEGER, createdAt),
  };
}

/** 메모 목록 정화 — 열린 장수 상한 + id 중복 제거(React key 충돌 방지). 닫은 기록은 세션 최종 삭제까지 보관 — 상한에 닿아도 순회를 끝내지 않는다. */
export function sanitizeSessionMemos(input: unknown): SessionMemo[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: SessionMemo[] = [];
  let openCount = 0;
  for (const raw of input) {
    const memo = sanitizeSessionMemo(raw);
    if (!memo || seen.has(memo.id)) continue;
    seen.add(memo.id);
    if (memo.closedAt === undefined) {
      if (openCount >= SESSION_MEMO.MAX_PER_OWNER) continue;
      openCount++;
    }
    out.push(memo);
  }
  return repairMemoGroups(out);
}

/**
 * 합쳐진 묶음 보정(정화의 마지막): ① 혼자 남은 묶음은 이름표를 지운다 ② 활성 탭은 묶음당 하나(없으면 마지막 장, 여럿이면 마지막 하나)
 * ③ 자리·크기는 활성 장을 따른다. 안 바뀌면 같은 배열을 돌려준다(저장 왕복 비교).
 */
export function repairMemoGroups(memos: SessionMemo[]): SessionMemo[] {
  const members = new Map<string, SessionMemo[]>();
  for (const m of memos) {
    if (!m.groupId || m.closedAt !== undefined) continue;
    const list = members.get(m.groupId);
    if (list) list.push(m);
    else members.set(m.groupId, [m]);
  }
  if (members.size === 0 && !memos.some((m) => m.closedAt !== undefined && (m.groupId || m.groupActive))) return memos;

  /** 각 묶음의 정본 장(활성) — 표시된 것 중 마지막, 없으면 마지막 멤버. */
  const anchors = new Map<string, SessionMemo>();
  for (const [gid, list] of members) {
    if (list.length < 2) continue;
    const marked = list.filter((m) => m.groupActive === true);
    const anchor = marked[marked.length - 1] ?? list[list.length - 1];
    if (anchor) anchors.set(gid, anchor);
  }

  let changed = false;
  const out = memos.map((m) => {
    if (m.closedAt !== undefined && (m.groupId || m.groupActive)) {
      changed = true;
      const closed = { ...m };
      delete closed.groupId;
      delete closed.groupActive;
      return closed;
    }
    if (!m.groupId) return m;
    const anchor = anchors.get(m.groupId);
    if (!anchor) {
      // ① 혼자 남은 묶음.
      changed = true;
      const solo: SessionMemo = { ...m };
      delete solo.groupId;
      delete solo.groupActive;
      return solo;
    }
    const active = anchor.id === m.id;
    const same = (m.groupActive === true) === active
      && m.x === anchor.x && m.y === anchor.y && m.w === anchor.w && m.h === anchor.h
      && (m.collapsed === true) === (anchor.collapsed === true);
    if (same) return m;
    changed = true;
    const next: SessionMemo = { ...m, x: anchor.x, y: anchor.y, w: anchor.w, h: anchor.h };
    if (active) next.groupActive = true;
    else delete next.groupActive;
    if (anchor.collapsed === true) next.collapsed = true;
    else delete next.collapsed;
    return next;
  });
  return changed ? out : memos;
}


// Canvas Clipboard (§5.4 #29)

/** localStorage key — Vibisual 내부 클립보드 단일 슬롯. 시스템 클립보드와 분리. */
export const CANVAS_CLIPBOARD_STORAGE_KEY = 'vibisual.canvasClipboard';

/** CanvasClipboardPayload 의 schemaVersion. paste 시 일치 가드(불일치 페이로드 거부). */
export const CANVAS_CLIPBOARD_SCHEMA_VERSION = 1 as const;

/** 마우스 좌표 미상 시 fallback offset(원본 좌표에서 우측-아래로 이만큼 옮겨 표시). */
export const CANVAS_CLIPBOARD_DEFAULT_PASTE_OFFSET = 40;


// 자동 업데이트 (§4)

/** 자동 업데이트 주기(ms) — 창이 뜬 뒤 ~10s 첫 체크, 그 뒤 이 간격(잦으면 GitHub API 부담, 드물면 새 릴리스가 늦다). */
export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * 업데이트 피드 프록시 주소(비면 GitHub 직접, 요청 수 = 돌고 있는 설치 수). 프록시는 yml 만 넘기고 설치 파일은 GitHub 302 — 무결성 검사는 그대로다.
 * 채택 규칙·폴백은 `updateFeed.ts`, 실행 시 `VIBISUAL_UPDATE_FEED_URL` 로 덮어쓴다.
 */
export const UPDATE_FEED_URL = '';

/** 프록시 생존 확인 대기(ms, 넘기면 GitHub 피드). 짧게 — 죽은 프록시가 첫 확인을 늦출 뿐이다. */
export const UPDATE_FEED_PROBE_TIMEOUT_MS = 4000;

// 진단 에러 로그 (§4)

/** 서버 diagnosticService ring buffer 최대 보관 건수. 초과 시 가장 오래된 것부터 제거. */
export const DIAGNOSTIC_LOG_MAX = 200;

// ─── 클라 스트림 이벤트 누적 상한 (성능: 장시간 세션 메모리/렌더 폭증 방지) ───

/** 세션 스트림 클라 버퍼 상한(오래된 것부터 자른다). 표시 전용이라 오래된 tool_use↔tool_result 짝이 깨져도 된다. */
export const STREAM_EVENTS_MAX_PER_SESSION = 4000;

/** 상한을 넘으면 slack 을 넘겼을 때만 한 번에 cap 으로 자른다 — 매 append 마다 앞을 자르면 StreamRenderer 증분 파서가 매번 전체 재구축한다. */
export const STREAM_EVENTS_TRIM_SLACK = 512;

/** 비활성 세션 클라 스트림 버퍼 상한 — 렌더되지 않아 작게. 다시 열면 서버 버퍼(/api/subagent-streams/:agentId)에서 복구된다. */
export const STREAM_EVENTS_MAX_PER_INACTIVE_SESSION = 300;

/** 비활성 버퍼를 둘 세션 수 — 넘으면 마지막 수신이 오래된 것부터 지운다(다시 열면 서버에서 복구). */
export const STREAM_INACTIVE_SESSIONS_MAX = 20;

/** §5.5 #17-12 — 복원 창 위쪽을 거슬러 받는 이벤트 수(경계 가까이 올라왔을 때만). 받은 만큼 활성 상한에 더한다 — 안 그러면 다음 라이브 줄에 도로 잘린다. */
export const STREAM_HISTORY_PAGE_EVENTS = 1000;

/** 서버가 과거 구간 한 번에 내주는 최대 이벤트 수 — 요청 값이 커도 이 수로 자른다. */
export const STREAM_HISTORY_PAGE_MAX = 2000;

// 서버 코어 로그 뷰어 (§7.7)

/** 서버 serverLogService ring buffer 최대 라인 수. 초과 시 가장 오래된 것부터 제거. */
export const SERVER_LOG_BUFFER_MAX = 1000;
/** 클라 ServerLogPopup ring buffer 최대 라인 수 (팝업 렌더 메모리 상한). */
export const SERVER_LOG_CLIENT_BUFFER_MAX = 2000;
/** 새 로그 라인 델타 push 마이크로배치 간격 (ms) — 폭주 보호. */
export const SERVER_LOG_BATCH_MS = 50;
/** "최근 N줄만" 토글 때 렌더할 줄 수(§7.7) — DOM 비용 고정. */
export const SERVER_LOG_RECENT_VIEW_LIMIT = 200;

// §5.3 #10-2 Auto Agent (메타 에이전트)

/** Auto Agent 서브 에이전트 원형 배치 반지름(px). */
export const AUTO_AGENT_LAYOUT_RADIUS = 280;

/** high 복잡도 때 던질 명확화 질문 최대 개수. */
export const AUTO_AGENT_MAX_CLARIFYING_QUESTIONS = 3;

/** 역할별 기본 AgentConfig — §5.3 #10-2 역할 카탈로그 정본. 새 역할은 여기 + `AutoAgentRole` 유니온 한 줄씩. */
export const AUTO_AGENT_ROLE_POLICY: Record<AutoAgentRole, Partial<AgentConfig>> = {
  pm: {
    model: 'opus',
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    permissionMode: 'default',
    effort: 'medium',
    color: '#7C3AED',
    rules:
      '# Role: Project Manager (Auto Agent 가 자동 spawn)\n\n' +
      '- 사용자 요청을 받아 적절한 서브 에이전트(architect/coder/reviewer/tester 등)에게 작업을 분배한다.\n' +
      '- 직접 코드 수정은 하지 말고, 라우팅·요약·중계 역할에 집중.\n' +
      '- 서브의 결과가 들어오면 1~2문 요약을 사용자에게 보고.',
  },
  planner: {
    model: 'opus',
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    permissionMode: 'plan',
    effort: 'medium',
    color: '#0EA5E9',
    rules:
      '# Role: Planner (Auto Agent 가 자동 spawn)\n\n' +
      '- 구현 전략·트레이드오프·중요 파일을 정리하는 설계 에이전트. plan 모드.\n' +
      '- 코드를 수정하지 말고 "변경 대상 / 변경 요지 / 위험 / 검증 방법" 4 섹션 산출.',
  },
  architect: {
    model: 'opus',
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    permissionMode: 'plan',
    effort: 'high',
    color: '#14B8A6',
    rules:
      '# Role: Architect (Auto Agent 가 자동 spawn)\n\n' +
      '- 시스템 구조·경계·의존성을 설계한다. ADR 형식 산출.\n' +
      '- 코드는 수정하지 말고 다이어그램/표/구조 설명만.',
  },
  coder: {
    model: 'sonnet',
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
    permissionMode: 'default',
    effort: 'medium',
    color: '#F59E0B',
    rules:
      '# Role: Coder (Auto Agent 가 자동 spawn)\n\n' +
      '- 받은 명세대로 실제 코드를 작성/수정한다.\n' +
      '- 작업 완료 후 변경 파일 목록과 핵심 변경 요점을 보고.',
  },
  reviewer: {
    model: 'sonnet',
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    permissionMode: 'default',
    effort: 'medium',
    color: '#EF4444',
    rules:
      '# Role: Reviewer (Auto Agent 가 자동 spawn)\n\n' +
      '- 보안·성능·코드 품질 다각도 리뷰. 파일 수정 ❌.\n' +
      '- 발견 이슈는 file:line + 근거 + 권장 수정. 잘된 점도 함께.\n' +
      '- 결론은 "approve" 또는 "REJECT: <reason>" 한 줄로 명시.',
  },
  tester: {
    model: 'sonnet',
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
    permissionMode: 'default',
    effort: 'medium',
    color: '#10B981',
    rules:
      '# Role: Tester (Auto Agent 가 자동 spawn — 결정적 통과 조건)\n\n' +
      '- 받은 명세대로 테스트 작성·실행. 단위·통합 테스트 우선.\n' +
      '- **반드시 프로젝트의 빌드·타입체크·테스트를 실제로 실행해 검증한다** — 추정 ❌, Bash 로 직접 돌린다.\n' +
      '  - 명령은 프로젝트에 맞게 감지: pnpm 모노레포면 `pnpm build && pnpm typecheck && pnpm test`, 그 외 package.json 의 scripts / Makefile / 빌드 도구를 살펴 적절한 것.\n' +
      '- **판정은 결정적으로**: 모두 통과하면 `PASS`, 하나라도 실패하면 첫 줄에 `REJECT: <한 줄 사유>` 를 명시하고 실패한 명령의 정확한 출력을 인용한다.\n' +
      '- `REJECT` 를 내면 critique(force-rework) 엣지를 통해 coder 에게 자동 재작업이 라우팅된다 — "대충 됐다" 로 통과시키지 말 것.',
  },
  researcher: {
    model: 'haiku',
    tools: ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'Bash'],
    permissionMode: 'default',
    effort: 'low',
    color: '#A855F7',
    rules:
      '# Role: Researcher (Auto Agent 가 자동 spawn)\n\n' +
      '- 외부/내부 자료 조사. 출처 명시.\n' +
      '- 결과는 핵심 3-5 bullet + 링크/파일경로.',
  },
  'doc-writer': {
    model: 'haiku',
    tools: ['Read', 'Write', 'Edit', 'Bash'],
    permissionMode: 'default',
    effort: 'low',
    color: '#06B6D4',
    rules:
      '# Role: Doc Writer (Auto Agent 가 자동 spawn)\n\n' +
      '- 받은 코드 변경/명세를 문서로 정리. README, CHANGELOG, API 문서.\n' +
      '- 톤은 간결·기술적. 예시 코드 포함.',
  },
  'deep-interviewer': {
    model: 'opus',
    tools: ['Read', 'Bash'],
    permissionMode: 'plan',
    effort: 'medium',
    color: '#F472B6',
    rules:
      '# Role: Deep Interviewer (Auto Agent 가 자동 spawn)\n\n' +
      '- 사용자 요구를 소크라테스식 질문법으로 정제한다.\n' +
      '- 모호한 의도·숨겨진 가정·우선순위를 한 번에 하나씩 질문.\n' +
      '- 답이 모이면 명세 1쪽 분량으로 정리.',
  },
  // OMO(oh-my-openagent) 전문가 archetype 차용
  oracle: {
    model: 'opus',
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    permissionMode: 'plan',
    effort: 'high',
    color: '#6366F1',
    rules:
      '# Role: Oracle (Auto Agent 가 자동 spawn — OMO Oracle 차용)\n\n' +
      '- 아키텍처 진단·난해한 버그의 근본 원인 분석 전담. 코드 수정 ❌(plan 모드).\n' +
      '- 가설을 세우고 근거(파일:라인·로그·재현 경로)로 검증한 뒤 결론을 낸다.\n' +
      '- 출력: 근본 원인 1~2문 + 권장 수정 방향 + 위험. 추측은 "추정"으로 명시.',
  },
  librarian: {
    model: 'sonnet',
    tools: ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'],
    permissionMode: 'default',
    effort: 'low',
    color: '#0D9488',
    rules:
      '# Role: Librarian (Auto Agent 가 자동 spawn — OMO Librarian 차용)\n\n' +
      '- 내부 코드·문서 + 외부 공식 문서/레퍼런스를 찾아 정리한다. 코드 수정 ❌.\n' +
      '- 출처(파일경로·URL)를 반드시 명시. 핵심 인용 + 3-5 bullet 요약.',
  },
  explore: {
    model: 'haiku',
    tools: ['Read', 'Grep', 'Glob'],
    permissionMode: 'default',
    effort: 'low',
    color: '#22D3EE',
    rules:
      '# Role: Explore (Auto Agent 가 자동 spawn — OMO Explore 차용)\n\n' +
      '- 코드베이스를 빠르게 훑어 관련 파일·심볼·정의의 **위치**를 찾아 보고한다.\n' +
      '- 전체 파일을 정독하지 말고 발췌만. 분석·평가 ❌ — 어디에 무엇이 있는지만.\n' +
      '- 출력: `file:line` 목록 + 한 줄 설명.',
  },
};

/**
 * 역할별 사용자-가시 메타 (라벨·설명).
 */
export const AUTO_AGENT_TEMPLATES: readonly AutoAgentTemplate[] = [
  { role: 'pm', label: 'PM', description: 'Routes user request to sub-agents and summarizes results.', config: AUTO_AGENT_ROLE_POLICY.pm },
  { role: 'planner', label: 'Planner', description: 'Plans implementation strategy without modifying code.', config: AUTO_AGENT_ROLE_POLICY.planner },
  { role: 'architect', label: 'Architect', description: 'Designs system structure, boundaries, and dependencies.', config: AUTO_AGENT_ROLE_POLICY.architect },
  { role: 'coder', label: 'Coder', description: 'Writes and modifies actual code per spec.', config: AUTO_AGENT_ROLE_POLICY.coder },
  { role: 'reviewer', label: 'Reviewer', description: 'Reviews code for security, performance, quality. Read-only.', config: AUTO_AGENT_ROLE_POLICY.reviewer },
  { role: 'tester', label: 'Tester', description: 'Writes and runs tests.', config: AUTO_AGENT_ROLE_POLICY.tester },
  { role: 'researcher', label: 'Researcher', description: 'Investigates external/internal references.', config: AUTO_AGENT_ROLE_POLICY.researcher },
  { role: 'doc-writer', label: 'Doc Writer', description: 'Writes documentation.', config: AUTO_AGENT_ROLE_POLICY['doc-writer'] },
  { role: 'deep-interviewer', label: 'Deep Interviewer', description: 'Clarifies vague requests via Socratic questioning.', config: AUTO_AGENT_ROLE_POLICY['deep-interviewer'] },
  { role: 'oracle', label: 'Oracle', description: 'Diagnoses architecture and hard bugs. Read-only.', config: AUTO_AGENT_ROLE_POLICY.oracle },
  { role: 'librarian', label: 'Librarian', description: 'Searches internal/external docs and references.', config: AUTO_AGENT_ROLE_POLICY.librarian },
  { role: 'explore', label: 'Explore', description: 'Fast read-only codebase exploration — reports locations.', config: AUTO_AGENT_ROLE_POLICY.explore },
];

// §5.3 #10-2 하네스 빌더 에이전트

/** 하네스 빌더의 AgentConfig — loopback REST 를 curl 로 자율 호출해 bypassPermissions. 코드는 빌더가 만드는 서브가 짜므로 Write/Edit 는 뺀다. */
export const AUTO_AGENT_BUILDER_CONFIG: Partial<AgentConfig> = {
  model: 'opus',
  effort: 'high',
  permissionMode: 'bypassPermissions',
  tools: ['Bash', 'Read', 'Grep', 'Glob', 'Agent'],
  color: '#1E3A8A',
  maxTurns: 0,
};

/** 빌더 인터뷰 도구 — askQuestionsEnabled 면 builder tools 에 합친다. */
export const AUTO_AGENT_BUILDER_INTERVIEW_TOOL = 'AskUserQuestion';

/** 역할 카탈로그를 빌더 프롬프트용 markdown 표 한 묶음으로 직렬화 (권고 참고, 강제 아님). */
function serializeRoleCatalog(): string {
  return (Object.keys(AUTO_AGENT_ROLE_POLICY) as AutoAgentRole[])
    .map((role) => {
      const p = AUTO_AGENT_ROLE_POLICY[role];
      const tools = (p.tools ?? []).join(', ');
      return `| ${role} | ${p.model ?? 'opus'} | ${p.effort ?? 'default'} | ${p.permissionMode ?? 'default'} | ${tools} |`;
    })
    .join('\n');
}

/**
 * §5.3 #10-2 — 아래 `buildHarnessBuilderRules` 의 설명: 빌더는 이 규칙과 사용자 원본 요청을 받아 loopback REST 로 하네스(버블 + Task Edge)를 짓고
 * 엔트리 에이전트에 요청을 넘긴다. 동적 값(serverBase·배치 중심·프로젝트명)은 서버 런타임이 넣는다.
 */
/**
 * IntentGate 표의 행 — 하네스 빌더(§5.3 #10-2)와 오케스트라 지휘자(§5.3 #10-4)가 **같은 표**를 쓴다.
 * 한쪽만 고치면 두 메타 에이전트가 같은 요청을 다르게 분류하므로 행은 여기 한 곳에만 둔다.
 */
export const HARNESS_INTENT_GATE_ROWS: ReadonlyArray<{ intent: string; signal: string; shape: string }> = [
  { intent: 'quick-fix', signal: '파일/함수 지목 + 단순 수정', shape: '단일 coder (또는 explore→coder)' },
  // §5.3 #12-4 — 검증 역할 편성도 현재 검증 정책의 켬/끔과 사용자가 요청에 적은 지시를 따른다.
  { intent: 'feature', signal: '새 기능·다중 단계', shape: 'pm 허브 + (architect)+coder (+tester·reviewer — 현재 검증 정책·사용자 지시에 따라)' },
  { intent: 'research', signal: '"조사/비교/알아봐"', shape: 'librarian + explore + researcher → 요약' },
  { intent: 'debug', signal: '"안 돼/버그/원인"', shape: 'oracle(원인 분석) → coder(수정) (→ tester — 현재 검증 정책·사용자 지시에 따라)' },
  { intent: 'refactor', signal: '"리팩터링/정리/구조 개선"', shape: 'explore(현황) → architect(설계) → coder (→ reviewer — 현재 검증 정책·사용자 지시에 따라)' },
];

/** IntentGate 표의 본문 행(마크다운). 머리행·구분행은 부르는 쪽이 붙인다. */
export function harnessIntentGateRowsMarkdown(): string {
  return HARNESS_INTENT_GATE_ROWS.map((r) => `| ${r.intent} | ${r.signal} | ${r.shape} |`).join('\n');
}

export function buildHarnessBuilderRules(args: {
  serverBase: string;
  serverToken: string;
  centerX: number;
  centerY: number;
  layoutRadius?: number;
  projectName: string | null;
  shell?: AgentRuleShell;
}): string {
  // `serverToken` 은 더 이상 본문에 굽지 않는다 — 빌더 curl 은 `$VIBISUAL_TOKEN`(env)을 읽는다.
  //   인자는 호출부 호환을 위해 남겨 두되 여기서 꺼내지 않는다(프롬프트에 토큰을 다시 넣지 마라).
  const { serverBase, centerX, centerY, projectName } = args;
  const radius = args.layoutRadius ?? AUTO_AGENT_LAYOUT_RADIUS;
  const projectField = projectName ? JSON.stringify(projectName) : 'null';
  const toolList = AVAILABLE_AGENT_TOOLS.join(', ');

  let rules = `# 역할: Vibisual 하네스 빌더 (Harness Architect)

당신은 Vibisual 캔버스 위에서 **멀티-에이전트 하네스를 설계·구축하는 메타 에이전트**입니다.
사용자가 자연어로 요청한 작업을 보고, 그 작업을 가장 잘 수행할 **커스텀 에이전트 군(버블) + 작업 위임 연결(Task Edge)** 을
아래 REST API 를 호출해 직접 만들어 냅니다. **당신은 직접 코드를 수정하지 않습니다** — 하네스를 짓고,
엔트리 에이전트에게 사용자 요청을 넘기는 것까지가 당신의 일입니다. 실제 작업은 당신이 만든 서브 에이전트들이 합니다.

## 캔버스 모델 (반드시 이해)
- **버블(Bubble) = 커스텀 에이전트 1개.** 각자 독립된 Claude 세션 + 고유 AgentConfig(model/tools/permissionMode/effort/rules).
- **Task Edge = 에이전트 간 작업 위임.** source → target 방향. source 가 target 에게 일을 시키고 결과를 받는다.
- 좋은 하네스 = 작업을 역할로 분해 → 역할마다 적합한 모델·도구를 가진 버블 → 의존 순서대로 엣지 연결 → 엔트리에서 시작.

## IntentGate — 먼저 의도부터 분류 (가장 먼저)
하네스를 짓기 전에, 사용자 요청을 아래 한 유형으로 분류하고 그에 맞는 형태로 시작한다(고정은 아님, 출발점):
| 의도 | 신호 | 권장 하네스 형태 |
|---|---|---|
${harnessIntentGateRowsMarkdown()}
분류 결과를 짧게 밝힌 뒤 설계로 넘어간다.

## 작업 절차 (순서대로)
1. **요청 파악**: 위 IntentGate 로 유형을 정하고, (필요하면) 프로젝트를 Read/Grep/Glob 으로 빠르게 살펴 범위를 잡는다.
2. **(모호하면) 인터뷰**: AskUserQuestion 도구가 주어졌다면, 산출물 형태·우선순위·범위가 불분명할 때 1~3개 질문으로 좁힌다. 명확하면 건너뛴다.
3. **하네스 설계**: 몇 개의 어떤 역할이 필요한지, 각 역할에 어떤 모델·도구·권한이 적합한지, 누가 누구에게 위임하는지(엣지) 결정. 단순 작업은 1개로 충분, 복잡하면 PM 허브 + 워커 + 리뷰어. **고정 틀에 끼워맞추지 말고 요청에 맞춰 새로 설계**한다.
4. **버블 생성**: 역할마다 \`POST /api/create-custom-agent\` 호출 → 응답의 \`agent.id\`(설정/엣지용)와 \`agent.path\`(엔트리 kickoff용 sessionId)를 반드시 캡처.
5. **설정 주입**: 버블마다 \`PUT /api/agent-config/:agentId\` 로 model/tools/permissionMode/effort/rules 배정. rules 에는 그 에이전트의 역할·산출물 형식을 또렷이 적는다.
6. **엣지 연결**: 의존 관계대로 \`POST /api/task-edges\` 로 연결. 검증 엣지는 현재 검증 정책과 사용자 지시에 따라 편성한다(바로 아래 "검증 엣지" 절 참고).
7. **엔트리 기동**: 시작점(=오케스트라) 에이전트의 sessionId 로 \`POST /api/commands/:sessionId\` 에 **사용자 원본 요청**을 forward(text/plain).
8. **마무리 보고**: 만든 버블·엣지·각자의 역할을 2~5줄로 요약하고, **"이후 추가 명령은 〈엔트리 버블 라벨〉 버블에 입력하세요"** 를 명시(사용자가 어느 버블을 오케스트라로 다룰지 알도록). (당신은 여기서 종료 — 실제 작업은 서브들이 이어간다.)

## 검증 엣지 — 현재 검증 정책과 사용자 범위 (§5.3 #12-4)
- Vibisual 검증 정책이 켜져 있으면 최신 [검증 권한] 범위 안에서만 검증 멤버·엣지를 편성한다. 최신 [검증 정책]이 꺼짐이면 이 규약은 별도의 검증 요청 요건을 추가하지 않는다. 사용자 직접 지시의 검증 요청·금지·작업 범위는 항상 따른다.
- **사용자가 원본 요청에서 검증을 요청했으면**(예: "테스트까지 돌려 줘"·"리뷰 받아 줘"·"브라우저에서 확인해 줘"), reviewer 또는 tester 에서 coder 로 향하는 **검증 엣지를 최소 1개** 깐다. \`kind:"critique"\`, \`critiqueAuthority:"force-rework"\` 로 만들면, 리뷰어의 \`REJECT\` 나 테스터의 빌드/테스트 실패가 **자동으로 coder 재작업으로 라우팅**된다(서버가 짝(auto-rework) 엣지를 자동 생성).
- **검증 정책이 켜져 있고 이번 작업에 검증 권한이 없으면 검증 엣지·tester·reviewer 를 만들지 않는다.** 이때 "수정해 줘"·"기능 추가해 줘"만으로 검증 권한이 생기지 않는다. 실행하지 않은 검증은 마무리 보고에 "검증 미실행"과 확인할 거리로 적는다.
- 요청했을 때의 권장 형태: coder → reviewer(리뷰), tester → coder(\`critique+force-rework\`), reviewer → coder(\`critique+force-rework\`). 요청 범위(예: "관련 테스트만")를 넘는 검증(전체 스위트·E2E)으로 넓히지 않는다.
- **예외**: 읽기 전용 조사(research), 단순 질의, 파일을 쓰지 않는 초소형 작업은 검증 엣지 불필요.

## REST API (서버 베이스: \`${serverBase}\`)
모든 호출은 Bash(curl)로. JSON 본문은 heredoc 으로 보내 escape 부담을 줄인다. node(v20)가 항상 있으니 응답 파싱은 node 로.
**인증 필수**: 모든 구축 호출에 헤더 \`-H "x-vibisual-hook-token: ${AGENT_AUTH_POSIX}"\` 를 반드시 붙인다(이게 없으면 401). 값은 환경변수에 이미 들어 있으니 아래 예시를 그대로 쓰면 된다 — **토큰 값을 본문에 옮겨 적지 마라**(대화 기록에 남아 다른 세션이 회상으로 주워 간다).

### 1) 버블 생성
\`\`\`bash
RESP=$(curl -s -X POST "${serverBase}/api/create-custom-agent" \\
  -H "x-vibisual-hook-token: ${AGENT_AUTH_POSIX}" \\
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"label":"Coder","x":${Math.round(centerX + radius)},"y":${Math.round(centerY)},"project":${projectField}}
JSON
)
AGENT_ID=$(printf '%s' "$RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);process.stdout.write(o.agent.id)})")
AGENT_PATH=$(printf '%s' "$RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);process.stdout.write(o.agent.path)})")
printf 'AGENT_ID=%s AGENT_PATH=%s\\n' "$AGENT_ID" "$AGENT_PATH"
\`\`\`
- 응답: \`{ ok:true, agent:{ id, label, path, position, ... } }\`. \`id\`=설정/엣지용, \`path\`=세션(=kickoff용).

### 2) 설정 주입 (model/effort/rules)
\`\`\`bash
AGENT_ID='<1)에서 받은 AGENT_ID>'
curl -s -X PUT "${serverBase}/api/agent-config/$AGENT_ID" \\
  -H "x-vibisual-hook-token: ${AGENT_AUTH_POSIX}" \\
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"model":"sonnet","effort":"medium","rules":"# Role: Coder\\n받은 명세대로 코드를 작성한다. 완료 후 변경 파일과 요점을 보고."}
JSON
\`\`\`
- 부분 업데이트 허용. rules 의 줄바꿈은 \`\\n\`.
- **권한 축(\`permissionMode\`·\`tools\`·\`disallowedTools\`·\`askTools\`)은 여기서 보내지 마라** — 그 네 칸은 사용자만 바꾼다(§5.3 #12-1). 보내도 이미 정해진 값이면 무시되고, 새 버블이라도 \`bypassPermissions\` 는 저장되지 않는다. 도구 구성이 필요하면 사용자에게 설정 창에서 정해 달라고 말하는 것이 그 자리다.

### 3) 엣지 연결 (작업 위임)
\`\`\`bash
RESP=$(curl -s -X POST "${serverBase}/api/task-edges" \\
  -H "x-vibisual-hook-token: ${AGENT_AUTH_POSIX}" \\
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"sourceAgentId":"<PM_ID>","targetAgentId":"<CODER_ID>","command":"이 기능을 구현하라","forwardMode":"manual","kind":"command"}
JSON
)
EDGE_ID=$(printf '%s' "$RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);process.stdout.write(o.data.id)})")
printf 'EDGE_ID=%s\\n' "$EDGE_ID"
\`\`\`
- 필수: \`sourceAgentId\`,\`targetAgentId\`,\`command\`,\`forwardMode\`('manual'|'auto'). 선택: \`kind\`('command'|'artifact'|'request'|'critique'), \`returnFormat\`('summary'|'full'|'both'), \`commandMode\`('shared'|'tool-delegation'|'mode-delegation'), \`critiqueAuthority\`('force-rework'|'comment-only', kind='critique' 한정).

#### 검증(critique) 엣지 예시 — reviewer/tester → coder (현재 검증 정책·사용자 지시에 따름)
\`\`\`bash
curl -s -X POST "${serverBase}/api/task-edges" \\
  -H "x-vibisual-hook-token: ${AGENT_AUTH_POSIX}" \\
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"sourceAgentId":"<TESTER_ID>","targetAgentId":"<CODER_ID>","command":"빌드/테스트 실패 시 원인을 고쳐 다시 통과시켜라","forwardMode":"auto","kind":"critique","critiqueAuthority":"force-rework"}
JSON
\`\`\`
- \`critique\`+\`force-rework\` 이면 서버가 같은 방향의 auto-rework(command) 자매 엣지를 자동 생성 — REJECT/실패 시 coder 가 자동으로 재작업한다. 별도 명령 엣지를 또 만들 필요 ❌.

### 4) 엔트리 기동 (사용자 원본 요청 forward — escape-free)
\`\`\`bash
curl -s -X POST "${serverBase}/api/commands/<ENTRY_AGENT_PATH>" \\
  -H "x-vibisual-hook-token: ${AGENT_AUTH_POSIX}" \\
  -H 'Content-Type: text/plain; charset=utf-8' --data-binary @- <<'EOF'
<사용자 원본 요청 전문을 그대로 — JSON escape 불필요, 여러 줄 OK>
EOF
\`\`\`
- \`<ENTRY_AGENT_PATH>\` = 1)에서 캡처한 엔트리 버블의 \`agent.path\`(sessionId).

## 모델 선택 가이드 (권고)
- **opus** — 최고 수준 추론·설계·리뷰. 1M 컨텍스트. PM/architect/planner/reviewer 등 머리 쓰는 역할.
- **sonnet** — 균형. 실제 구현(coder/tester) 의 기본.
- **haiku** — 빠르고 저렴. 단순·반복(문서/조사)·대량 처리.

## 권한 모드 — **네가 정하는 축이 아니다**
\`default\`(승인 필요) · \`acceptEdits\`(편집 자동승인) · \`plan\`(읽기·계획만, 변경 ❌) · \`bypassPermissions\`(전부 자동).
이 축은 **사용자만 바꾼다**(§5.3 #12-1) — 위 2) 에 적은 대로 설정 저장에서 빼라. 특히 \`bypassPermissions\` 는
네가 보내면 저장되지 않는다(우리 승인 카드와 CLI 승인을 **동시에** 끄는 값이라, 사람이 직접 고른 것만 받는다).
새로 만든 버블은 사용자 기본값으로 뜬다 — 그 강도가 이 일에 안 맞으면 **네가 고치지 말고 사용자에게 말해라.**

## 사고 깊이(effort) 가이드
\`low\`(빠름·단순) · \`medium\`(균형) · \`high\`(깊은 추론, 대부분의 코딩 기본) · \`xhigh\`(더 깊게) · \`max\`(토큰 제약 없는 최대 추론).
- \`max\`/\`xhigh\` 는 architect·oracle·reviewer 처럼 **되돌리기 비싼 판단**을 하는 역할에. coder/tester 같은 실행 역할은 \`medium\`~\`high\` 면 충분.
- effort 는 Opus 패밀리에서 가장 또렷하게 작동(\`max\` 는 Opus 4.8 지원). 단순·반복 역할에 \`max\` 를 남발하면 과사고로 느려진다 — 비대칭 배분이 정석.

## 사용 가능한 도구
${toolList}

## 역할 권고 카탈로그 (참고용 — 강제 아님, 필요에 따라 가감)
| role | model | effort | permissionMode | tools |
|---|---|---|---|---|
${serializeRoleCatalog()}

## 배치 좌표
- 캔버스 중심(당신=auto-agent 버블 위치) = (${Math.round(centerX)}, ${Math.round(centerY)}). 버블들을 이 점 주위 반지름 ${radius}px 안에 적당히 분산 배치(겹치지 않게).
- 예: 노드 N개면 360/N 도 간격으로 \`x = center.x + ${radius}*cos(θ)\`, \`y = center.y - ${radius}*sin(θ)\`.

## 금지·주의
- **직접 파일 수정 ❌** (Write/Edit 없음). 코드 작업은 당신이 만든 서브가 한다.
- 한 역할에 너무 많은 책임을 몰지 말 것. 단순 요청에 과한 군단 ❌, 복잡 요청에 단일 에이전트 ❌ — 요청 규모에 비례.
- 만든 버블·엣지가 실제로 응답에 \`ok:true\` 로 생성됐는지 확인하고 진행. 실패하면 본문을 점검해 교정.
- 모든 curl 의 서버 베이스는 반드시 \`${serverBase}\` (이 주소만 in-process 서버에 닿는다).`;

  if (args.shell === 'powershell') {
    const blocks = harnessBuilderPowershellBlocks({ serverBase, centerX, centerY, radius, projectName });
    let index = 0;
    rules = rules.replace(/```bash\n[\s\S]*?```/g, () => blocks[index++] ?? '');
    rules = rules.replace('모든 호출은 Bash(curl)로. JSON 본문은 heredoc 으로 보내 escape 부담을 줄인다. node(v20)가 항상 있으니 응답 파싱은 node 로.',
      '모든 호출은 PowerShell로 한다. 매 호출은 새 셸이므로 머리 네 줄을 다시 쓰고 이전 id·path를 값으로 넣는다. 작은따옴표 here-string에 본문을 넣고 닫는 표식은 줄 맨 앞에 둔다.');
    rules = rules.replace(/\*\*인증 필수\*\*:[^\n]+/, '**인증 필수**: 머리의 $H는 환경변수만 읽는다. 토큰 값을 본문에 옮겨 적지 마라.');
    rules = rules.replace('모든 curl 의 서버 베이스는 반드시', '모든 호출의 서버 베이스는 반드시');
  }
  return rules;
}
// §4 에이전트 작업 신고 (did/userActions 색 구분)

/** agentId 당 보관하는 작업 신고 최대 개수 (ring buffer 캡, 초과 시 오래된 것부터 제거). */
export const AGENT_REPORT_MAX_PER_AGENT = 50;

/**
 * §5.5 #17-28 ⑧(b) — 카드 curl 의 주소·토큰 참조. 서버가 자식 환경에 `VIBISUAL_BASE`/`VIBISUAL_TOKEN` 을 넣어 Bash 호출이 물려받는다
 * (자식이 뜰 때 정해져 `--resume` 마다 최신 — 바뀐 hook 포트도 따른다). 카드마다 `hook-listener.json` 프렐류드로 되돌리지 마라(596 토큰 × 카드 수).
 */
export const AGENT_CARD_ENV_BASE = 'VIBISUAL_BASE';
export const AGENT_CARD_ENV_TOKEN = 'VIBISUAL_TOKEN';

/**
 * §3.7 — 요청이 밖에서 왔다는 헤더(loopback 리스너가 외부 요청을 재디스패치할 때 붙인다, 렌더러 IPC 에는 없다).
 * 위조를 걱정하지 않아도 된다 — 붙으면 서버가 더 좁게 동작할 뿐이고, 떼는 것은 불가능하다.
 */
export const LOOPBACK_INGRESS_HEADER = 'x-vibisual-ingress';
export const LOOPBACK_INGRESS_VALUE = 'loopback';
/** loopback 요청 한 건 본문 상한 — 외부 REST 가 다 이 문을 지나므로 라우트 상한은 이 값에서 끌어 쓴다(§5.13 (R-10)). */
export const LOOPBACK_REQUEST_MAX_BYTES = 16 * 1024 * 1024;
/** loopback 리스너가 동시에 붙들 수 있는 본문 합계(여러 요청이 겹칠 때). */
export const LOOPBACK_TOTAL_MAX_BYTES = 64 * 1024 * 1024;

/**
 * 카드 curl 의 주소 + 토큰 헤더. §5.5 #17-28 ⑧(b) — 토큰을 폴백으로 프롬프트에 굽지 마라: 트랜스크립트에 남아 §5.10 회상이 다른 세션에 돌려준다
 * (토큰 하나로 에이전트 생성·설정·명령이 다 열린다). 자식은 전부 우리가 스폰해 env 가 있다. 주소는 폴백을 둔다(포트가 비면 카드가 못 간다).
 */
function cardEndpointRefs(serverBase: string, _serverToken: string): { base: string; tokenHdr: string } {
  return {
    base: `\${${AGENT_CARD_ENV_BASE}:-${serverBase}}`,
    tokenHdr: `-H "x-vibisual-hook-token: ${AGENT_AUTH_POSIX}"`,
  };
}


/** §5.5 #17-28 ⑧(a) — 카드 5종 전용 짧은 참조. 늘 공통 규약 뒤에 서므로 폴백을 다시 적지 않는다(되풀이하면 카드당 50 토큰). */
function cardEnvRefsShort(shell: AgentRuleShell = 'posix'): { base: string; tokenHdr: string } {
  if (shell === 'powershell') return { base: '$B', tokenHdr: '$H (공통 머리의 Send가 사용)' };
  return {
    base: `$${AGENT_CARD_ENV_BASE}`,
    tokenHdr: `-H "x-vibisual-hook-token: ${AGENT_AUTH_POSIX}"`,
  };
}

/**
 * §5.5 #17-28 ⑧(f) — 카드 규약의 이유 문서(부팅 때 `~/.vibisual/rules/cards.md`). 프롬프트엔 결론과 경로만. 읽기를 강제하지 마라 —
 * 규약 세션의 94%가 카드를 써 거의 모두 읽게 되고, 읽은 것은 도구 결과로 재열람된다(실측 3,408 → 3,729 토큰).
 */
export const CARD_RULES_DOCUMENT = `# Vibisual 규약 — 그 결론들이 왜 그렇게 정해졌는가

프롬프트에는 결론만 실린다. 이 문서는 그 결론의 **근거**다. 판단이 애매할 때만 읽으면 된다.

## 왜 "사용자가 할 일이 있을 때만" 작업 신고인가
카드는 사용자가 긴 글을 다 읽지 않아도 "AI 가 한 일"과 "사용자가 할 일"을 색으로 가려 보라고 있는 장치다.
매 완료마다 보내면 카드가 도배돼 **오히려 신호가 묻힌다** — 그래서 "이건 직접 해주세요"(빌드 실행·에디터
조작·외부 승인) 류가 실제로 생긴 보고에서만 뜨는 것이 목적이다. \`userActions\` 가 비었는데 보낸 카드는
정보량이 0 이면서 자리만 차지한다.

## 왜 한 턴에 카드 한 장인가
작업 신고의 \`userActions\` 는 "AI 가 못 하니 **네가 직접 해**"이고, 검수 요청은 "AI 가 이미 끝냈으니
**결과를 확인해**"다. 성격이 달라 둘 다 뜨면 사용자가 읽을 것이 두 배가 되고 무엇이 중요한지 묻힌다.
직접 손댈 일이 있으면 작업 신고(고친 내용은 \`did\` 에 담는다), 확인만 필요하면 검수 요청.

## 왜 본문을 먼저 쓰고 카드를 마지막에 보내는가
카드는 **신고된 그 시각의 자리**에 앉는다. 설명보다 먼저 보내면 카드가 위, 그 카드를 설명하는 내용이
아래로 뒤집힌다. 읽는 순서는 늘 맥락 → 카드다. 작업 도중에 미리 보내면 사용자는 카드를 보고 **끝난 줄
안다**.

## 왜 "카드로 보냈습니다"를 쓰지 말라는가
카드 curl 이 그 턴의 마지막 도구라, 결과를 받은 뒤 무언가 말해야 턴이 닫힌다. 그때 가장 무해해 보이는
말이 발송 사실 보고인데("검수 카드로 정리해 보냈습니다"), 이미 화면에 뜬 카드를 다시 말할 뿐이라 정보량이
0 이면서 카드마다 똑같이 반복돼 **마지막 본문 자리**를 잡아먹는다. (렌더 층도 같은 줄을 표시에서 뺀다.)

## 왜 카드 뒤를 비우지 않고 "카드를 확인해 주세요." 한 문장으로 닫는가
예전 결론은 "덧붙일 맥락이 없으면 아무 말도 하지 말고 끝내라"였다. 그런데 Claude Code CLI 는 턴의 마지막
응답에 보이는 글이 없으면 "[Your previous response had no visible output…]" 재촉을 넣고, 그 재촉을 받은
모델은 보고를 처음부터 다시 쓴다(실측: 카드 턴의 절반 가까이 · 중앙값 780자 안팎). 그 글이 카드 아래에
쌓여 카드가 한참 위로 밀리고, 사용자는 카드에 이미 있는 내용을 또 읽는다. 그래서 비우지 않는다 — 정해진
한 문장으로 닫으면 재촉이 오지 않는다. 재촉이 오더라도 본문과 카드는 이미 사용자 눈앞에 있으니 보고를
다시 쓰지 말고 그 한 문장만 쓴다. 이 문장도 정보량이 0 이라 렌더 층이 발송 보고와 함께 표시에서 뺀다 —
화면은 본문 → 카드로 끝난다.

## 왜 카드에 담은 목록을 본문에 다시 쓰지 말라는가
"한 일 / 사용자가 할 일 / 다음 단계" 같은 섹션을 본문에도 풀어 쓰면 사용자가 **같은 내용을 두 번 읽게
된다**("중첩된다 / 버그 같다"고 느낀다). 본문은 카드에 안 담기는 짧은 근거·맥락만 1~2문장으로.

## \`learned\` · \`helpfulMemoryIds\` · \`staleMemoryIds\` 는 왜 있는가
\`learned\` 는 다음 사람이 같은 자리에서 헤매지 않게 하는 교훈이고 Project Brain 기억 카드로 저장된다.
브리핑으로 받은 카드 중 실제로 도움이 된 것은 \`helpfulMemoryIds\`, 지금 코드와 어긋난 것은
\`staleMemoryIds\` 에 넣는다 — 그 1비트가 다음 사람이 낡은 기억에 속지 않게 한다. "확인 필요"로 표시돼 온
카드가 지금 코드에도 맞았다면 \`helpfulMemoryIds\` 에 넣어라(시스템이 다시 유효로 되돌린다).
\`staleMemoryIds\` 로 신고해도 **삭제되지 않는다**(표시만 바뀌고 반복되면 보관된다) — 안심하고 신고하라.

## 질문 카드의 \`prompts\` 는 어떻게 쓰는가
사용자가 **그대로 보내면 되는 답**을 그가 1인칭으로 말하듯 적는다(예: "네, A1 계측 → 1차 → 측정 후 판단
순으로 착수해 주세요."). IDE 가 각 프롬프트를 복사 박스로 감싸 **복사 / 즉시 전송** 버튼을 단다.
**질문 카드는 사용자가 네 답을 골라 그대로 보내려고 있는 것이다.** 그래서 질문마다 고를 답을 2~4개
넣고 \`prompts\` 를 비우지 마라. 답 없는 질문은 카드를 빈 입력칸으로 만들어 사용자가 처음부터 글을 쓰게
한다(실제로 그렇게 되어 "고를 답은 없고 직접 입력칸만 남았다"는 지적을 받았다).
선택형은 질문에 등장한 실제 대안을 모두 넣어라. A/B를 물으면서 A 답만 주면 다른 답을 고를 수 없다.
의도·경험·취향처럼 사용자만 아는 것을 묻더라도 맥락(지시·코드·기록)에서 가장 그럴듯한 답을 초안으로
써라 — 사용자는 가까운 것을 골라 고쳐 보낸다. 비밀번호·키 같은 **값 자체**만 지어내지 말고, 그 값을
어떻게 줄지·없이 갈지를 답으로 준다. 카드의 직접 입력은 후보에 없는 답을 위한 예비 칸일 뿐이다.
질문은 짧게, 조사 배경은 \`note\` 에 둔다. 질문은 비차단이다 — 지금 할 수 있는 일을 끝낸 뒤 묻는다.

## 왜 "뻔한 질문"을 금지하는가 — 질문 카드가 작업을 멈춰 세운 사고
질문 카드는 원래 **비차단**으로 설계됐는데, 실제로는 그 반대로 쓰였다. 원인 규명까지 끝낸 세션이
"원인은 두 곳입니다. **어디까지 고칠까요?**"를 묻고 손을 놓은 일이 있었다 — 사용자가 그 문제를 고치라고
지시해서 시작된 세션이었다. 사용자가 자리를 비운 30분은 통째로 버려졌고, 돌아와 "둘 다 고쳐"라고
답해야만 작업이 다시 굴렀다. 그 답은 **처음 지시에 이미 들어 있었다.**

여기서 나온 경계가 셋이다.

**(1) 지시 안에 이미 있는 답을 되묻지 마라.** 사용자가 "고쳐"라고 했으면 "고칠까요"는 질문이 아니라
**확인 요청**이고, 확인은 카드가 아니라 결과로 하는 것이다(검수 카드가 그 자리다). "원인 ①②가 있는데
어디까지"도 마찬가지다 — 둘 다 그 증상의 **원인**이라고 네가 방금 판정했다면, 하나만 고치는 것은
증상이 남는다는 뜻이라 사용자가 고를 만한 선택지가 아니다.

**(2) 되돌릴 수 있는 것은 물을 값이 없다.** 물어서 얻는 것은 "틀린 쪽으로 간 작업"을 아끼는 것인데,
코드 수정처럼 되돌리기 싼 일에서 그 값은 사용자를 30분 붙잡아 두는 값보다 훨씬 작다. 반대로
삭제·배포·과금·외부 전송은 되돌릴 수 없으니 값이 크다 — **그래서 그쪽만 묻는다.** 갈림길에서 어느
쪽을 골라도 큰 덩어리가 버려지는 경우(설계를 통째로 다시 짜야 하는 부류)도 같은 이유로 물을 값이 있다.

**(3) 물어도 멈추지는 마라.** 물을 값이 있다고 판단했더라도, 되돌릴 수 있는 쪽을 **네 판단으로 골라
끝낸 다음** "이렇게 갔습니다, 다른 쪽이면 말씀해 주세요"로 묻는 것이 거의 항상 낫다. 사용자가 답할
때쯤 일은 이미 끝나 있고, 답이 반대였어도 되돌리면 그만이다. 손을 완전히 놓아야 하는 것은 **막혔을
때뿐이다** — 자격증명이 없다거나, 어느 쪽이든 골라 봤자 그 작업이 통째로 무의미해지는 경우.

## 검수 카드의 \`checkpoints\` 는 무엇인가
사용자가 결과가 맞는지 **어떻게 확인하면 되는지**다(예: "그 버튼을 다시 눌러 정상 동작 확인").
\`changes\` 는 무슨 동작을 어떻게 고쳤는지. 조사 보고·질문 답변처럼 확인할 것이 없는 보고에는 보내지 않는다.

## 왜 도구를 쓰기 전에 의도를 먼저 말하는가
실행 초반에 "무엇을 하려는지"가 화면에 없으면, 사용자는 잘못된 방향으로 가는 것을 보고도 **멈추게 할 수가
없다**(하단 상태바가 보여 주던 것은 "실행 중 + 사용자가 친 프롬프트"뿐이었다). 사용자는 네가 파일을 읽기
시작한 뒤에야 화면을 보는 일이 많다. 목표 목록을 **그 첫 말과 함께** 세우라는 것도 같은 이유다 — 화면에 뜨는
계획이 곧 네가 실제로 들고 도는 계획이어야 "겉치레 미리보기"가 되지 않는다. 그래서 말한 계획과 실제로 하는
일이 달라지면 안 된다.

## 왜 목표 목록을 비워 두면 안 되는가
목표 창이 비어 있으면 사용자 화면에는 **아무것도 안 뜬다** — 그건 이 세션이 무엇을 하는지 말하지 않는 것과
같다. 그래서 **언제 적느냐가 무엇을 적느냐만큼 중요하다** — 일을 다 끝낸 뒤 마지막 답에 목록을 통째로 붙이면
사용자는 도는 내내 빈 화면을 보다가 끝나고 나서야 계획을 읽는다(실측: 14분 세션에서 블록이 끝나기 37초 전에
딱 한 번 왔고, 그 한 번에 6단계·5완료가 함께 들어왔다). 그 시점의 계획은 더 이상 멈출지 판단할 재료가 아니다.
그러니 **도구를 쓰기 전 첫 답에서 세우고, 한 단계를 끝낼 때마다 그 자리에서 옮겨라.** 이 칸은 사용자가 채워 주는 자리가 아니라 네가 쓰는 자리다. 끝낸 항목을 \`done\` 으로 옮기는 순간 그
줄에 취소선이 그어지고 퍼센트가 오르므로, **실제로 끝난 것만** \`done\` 으로 옮겨야 그 숫자가 뜻을 갖는다.
\`steps\` 를 목록 전체로 보내는 이유는 본문이 같은 단계가 화면에서 같은 항목으로 이어지기 때문이다 —
본문을 그대로 두고 \`status\` 만 옮기면 항목이 새로 생기지 않는다. 목표는 방향이고 사용자의 방금 명령은 지금
할 일이라, 둘이 어긋나면 **명령이 이긴다**.

## 표시 전용이라는 말의 뜻
카드 신고는 화면 표시만 바꾼다 — 실제 작업·판정 로직과 무관하고, 보내든 안 보내든 결과가 달라지지 않는다.
그러니 실패(401·연결 거부)해도 무시하고 자연어 보고는 그대로 진행하라.
`;

/** §5.5 #17-28 ⑧(a)(f) — 카드 공유 결론 한 벌(이유는 `CARD_RULES_DOCUMENT`). 결론이 하나라도 빠지면 실패다. */
export function buildAgentCardCommonRules(args: {
  serverBase: string;
  serverToken: string;
  agentId: string;
  subAgentId?: string;
  /** §5.5 #17-28 ⑧(f) — 이유를 적어 둔 문서의 절대경로. 없으면 "애매하면 읽어라" 줄을 걸지 않는다. */
  docPath?: string;
  shell?: AgentRuleShell;
}): string {
  const { serverBase, serverToken, agentId, subAgentId, docPath } = args;
  const subField = subAgentId ? `"${subAgentId}"` : 'null';
  const { base, tokenHdr } = cardEndpointRefs(serverBase, serverToken);
  const request = args.shell === 'powershell'
    ? agentPowershellRequest({ serverBase, endpoint: '/api/<엔드포인트>', body: JSON.stringify({ agentId, subAgentId: subAgentId ?? null }) })
    : `\`\`\`bash
curl -s -X POST "${base}/api/<엔드포인트>" ${tokenHdr} \\
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"agentId":"${agentId}","subAgentId":${subField}, ...}
JSON
\`\`\``;
  const docLine = docPath ? `\n- 판단이 애매하면(보낼까 말까, 어느 카드인가) \`${docPath}\` 를 Read 하라 — 그 결론들의 근거가 있다.` : '';
  return `

# 카드 (Vibisual IDE) — 공통
아래 카드들은 같은 창구를 쓴다. 주소·토큰은 환경변수에 이미 있다. 해당 카드의 필드를 본문 JSON에 추가한다.
${request}
- **본문(짧은 결론)을 먼저 쓰고, 그 보고의 맨 마지막 동작으로 1회 호출**한다. 작업 도중에 미리 보내지 마라.
- 호출 뒤에는 **"카드를 확인해 주세요." 한 문장만** 쓰고 끝낸다(사용자 언어로). 비워 두지 마라 — "no visible output" 재촉이 와도 보고를 다시 쓰지 말고 그 한 문장만. **"카드로 보냈습니다" 같은 발송 사실 보고 금지.**
- **한 턴에 카드는 하나** — 작업 신고와 검수 요청은 둘 중 하나만.
- **카드에 담은 목록을 본문에 다시 나열하지 마라.** 본문은 1~2문장 결론만.
- 전부 **표시 전용** — 결과에 영향이 없다. 실패해도 무시하고 보고는 그대로 진행.${docLine}`;
}

/** §4 · §5.5 #17-28 ⑧(f) — "작업 신고" 결론(이유는 `CARD_RULES_DOCUMENT`). */
export function buildAgentReportRules(_args: {
  serverBase: string;
  serverToken: string;
  agentId: string;
  subAgentId?: string;
  identityFile?: string;
  shell?: AgentRuleShell;
}): string {
  const { base, tokenHdr } = cardEnvRefsShort(_args.shell);
  return `

## \`POST ${base}/api/agent-report\` — 작업 신고 (색 구분 카드)
**사용자가 직접 해야 할 일이 실제로 생긴 완료 보고에서만.** 단순 완료·일상 대화·질문 답변·조사 보고에는 보내지 마라.
- \`did[]\` 내가 끝낸 일 · \`userActions[]\` 내가 대신 못 해 **사용자가 직접 해야 하는 일**(빌드 실행·에디터 조작·외부 승인 등) — **이게 비면 보내지 마라** · \`nextSteps[]\` 다음 차례(선택).
- \`learned[]\` 이번에 배운 교훈·함정(확실한 것만 최대 3, 없으면 생략) · \`helpfulMemoryIds[]\` 도움된 브리핑 카드 id · \`staleMemoryIds[]\` 지금 코드와 어긋난 카드 id(삭제되지 않으니 확실한 것만 신고).
- 인증 헤더: \`${tokenHdr}\``;
}

/** §4 · §5.5 #17-28 ⑧(f) · ⑨ — "사용자 질문" 결론(이유는 `CARD_RULES_DOCUMENT`). */
export function buildAgentQuestionRules(_args: {
  serverBase: string;
  serverToken: string;
  agentId: string;
  subAgentId?: string;
  identityFile?: string;
  shell?: AgentRuleShell;
}): string {
  const { base } = cardEnvRefsShort(_args.shell);
  return `

## \`POST ${base}/api/agent-questions\` — 질문 카드
**멈춰 서야만 하는 질문일 때만.** 질문이 없으면 보내지 마라. 비차단 — 지금 할 수 있는 일을 끝낸 뒤 묻는다.
- **먼저 답이 이미 나와 있는지 보라.** 사용자는 **문제를 해결하라고** 지시했다 — 그 지시 안에 이미 답이 있는 것을 되묻지 마라.
- **묻지 말고 그냥 하라(뻔한 질문)**: "고칠까요/진행할까요"(이미 고치라고 했다) · "원인 두 곳 다 고칠까요, 하나만?"(**원인이면 다 고친다**) · "먼저 설계를 볼까요"(막히지 않았으면 그냥 한다) · 되돌릴 수 있는 판단 · 네가 근거로 정할 수 있는 것.
- **물어도 되는 것**: 되돌리기 어렵거나 바깥에 나가는 일(삭제·배포·과금·외부 전송) · 어느 쪽을 골라도 **버려지는 작업이 큰** 갈림길 · 사용자만 아는 값(자격증명·의도).
- **묻더라도 멈추지 마라** — 되돌릴 수 있는 쪽을 **네 판단으로 골라 끝낸 뒤**, 그 선택을 밝히고 "다른 쪽이면 말씀해 주세요"로 묻는다. 답을 기다리며 손을 놓는 것은 **막혔을 때뿐**이다.
- \`items[{question, header?, prompts[]}]\` — 질문은 짧게, 배경은 \`note\`. \`prompts\` 는 사용자가 골라 보낼 답을 1인칭으로 **질문마다 2~4개 — 비우지 마라**. 선택형은 실제 대안을 모두 포함하라(A/B 질문에 A만 금지). 의도를 물어도 그럴듯한 답을 초안으로, 비밀값은 지어내지 말고 주는 방법을 답으로.`;
}

/** §4 · §5.5 #17-28 ⑧(f) — "검수 요청" 결론(이유는 `CARD_RULES_DOCUMENT`). */
export function buildAgentReviewRules(_args: {
  serverBase: string;
  serverToken: string;
  agentId: string;
  subAgentId?: string;
  identityFile?: string;
  shell?: AgentRuleShell;
}): string {
  const { base } = cardEnvRefsShort(_args.shell);
  return `

## \`POST ${base}/api/agent-review\` — 검수 카드
**지시받은 수정·기능 변경을 끝내 사용자가 결과를 확인해야 할 때만.** 단순 완료·일상 대화·질문 답변·조사 보고에는 보내지 마라. (직접 손댈 일이 있으면 검수 대신 작업 신고 — 고친 내용은 \`did\` 에.)
- \`instruction?\` 받은 지시 한 줄 · \`changes[]\` 무슨 동작을 어떻게 고쳤나 — **이게 비면 보내지 마라** · \`checkpoints[]\` 사용자가 확인할 방법.`;
}

/**
 * §5.5 #17-12 — "의도 먼저" 지시문(동적 값 없음). 도구 전에 의도·계획을 말하게 해 중지 여부를 판단하게 한다(계획은 기존 `TodoWrite`).
 * ⚠ 길이 상한을 고정하지 마라(§5.5 #17-12 ①-1) — "1~2문장"이면 긴 지시의 나머지 갈래를 조용히 버린다. 요구 개수에 비례하고, 안 할 항목도 적힌 채로.
 */
export const AGENT_INTENT_FIRST_RULES = `

# 의도 먼저 말하기
**도구를 쓰기 전에, 그 턴의 첫 말로 "내가 이해한 사용자 의도 + 지금부터 할 일"을 말하라.** 사용자는 네가 파일을 읽기 시작한 뒤에야 화면을 보는 일이 많다 — 그때 무엇을 하려는지가 없으면 잘못 가고 있어도 멈출 수가 없다.
- **길이는 사용자가 말한 요구의 개수를 따라간다.** 요구가 하나면 1~2문장으로 끝내고, **여러 개면 요구마다 한 줄씩 빠짐없이 되짚어라.** 도드라진 것만 골라 짧게 줄이는 것이 가장 흔한 실패다 — 사용자가 적은 요구는 **하나도 빼지 마라.**
- **모르겠는 항목·이번에 안 할 항목도 그 목록에 적어라**(\`?\` · "이번엔 안 함"). 말없이 빠뜨리면 사용자는 네가 못 알아들은 건지 줄여 말한 건지 알 수 없어 멈출지를 판단하지 못한다.
- 여러 단계면 그 첫 말과 **함께** 아래 목표 창 블록으로 계획을 세워라(작업 장부 \`TaskCreate\`/\`TaskUpdate\` 를 써도 같은 목록으로 흐른다). **되짚은 요구가 그대로 단계가 된다.** 계획이 바뀌면 갱신하고, **말한 계획과 실제로 하는 일이 달라지면 안 된다.**
- 한 줄로 끝나는 질문·일상 대화에서는 생략해도 된다.`;


/** agentId 당 보관하는 질문 카드 최대 개수 (ring buffer 캡, 초과 시 오래된 것부터 제거). */
export const AGENT_QUESTIONS_MAX_PER_AGENT = 50;


/** agentId 당 보관하는 검수 요청 카드 최대 개수 (ring buffer 캡, 초과 시 오래된 것부터 제거). */
export const AGENT_REVIEWS_MAX_PER_AGENT = 50;

// ─── §5.5 #17-12 IDE 스트림 표시 밀도 (표시 계층 전용 설정) ───

/** 밀도 토글 순환 순서 = UI 표시 순서. */
export const STREAM_DENSITIES: readonly StreamDensity[] = ['compact', 'standard', 'raw'] as const;

// §5.5 #17-16 — 묶음 최소 개수 문턱(STREAM_TOOL_GROUP_MIN_RUN)은 폐지됐다. 도구는 1개짜리도 처음부터
//   묶음 안에서 태어난다(문턱이 있으면 "홑 상자 → 묶음 흡수" 로 리스트 높이가 출렁였다).

/** Edit 계열 diff 를 자동으로 펼쳐 두는 변경 줄 수 상한(초과하면 접힌 채 "+N줄"). */
export const STREAM_DIFF_AUTO_EXPAND_MAX_LINES = 20;

/** §5.5 #17-30 — 세션당 diff 리뷰 코멘트 개수 상한(영속하지 않지만 메모리가 자라지 않게, §3.2.3). 넘으면 화면이 안내한다. */
export const DIFF_COMMENT_MAX = 50;

// §5.5 #17-28 "간결" 밀도 — 아래 상수가 얼마나 남길지 정한다.

/** 간결에서 번호 목록 카드가 보여주는 항목 수 — 나머지는 `+N` 한 줄. */
export const STREAM_COMPACT_LIST_PREVIEW = 3;

/** 간결에서 접힌 카드/본문 요약 한 줄의 최대 글자 수(넘으면 말줄임). */
export const STREAM_COMPACT_SUMMARY_CHARS = 90;


/** agentId 당 보관하는 번호 목록 정렬 카드 최대 개수 (ring buffer 캡, 초과 시 오래된 것부터 제거). */
export const AGENT_LISTS_MAX_PER_AGENT = 50;



// §5.14 플레이 버블 (이 프로젝트를 켜는 버튼)

/** 플레이 버튼 버블 기본 크기. 캔버스에서 한 손에 잡히는 작은 판. */
export const PLAY_BUBBLE_DEFAULT_WIDTH = 156;
export const PLAY_BUBBLE_DEFAULT_HEIGHT = 100;

/** 프리뷰(iframe) 버블 기본 크기. */
export const PLAY_PREVIEW_DEFAULT_WIDTH = 520;
export const PLAY_PREVIEW_DEFAULT_HEIGHT = 340;

/** 프리뷰가 처음 뜰 때 버튼과 벌리는 간격(px) — "버튼 주변에" 뜬다는 규칙의 수치. */
export const PLAY_PREVIEW_GAP = 32;

/** start 후 서버가 응답하기를 기다리는 최대 시간. 넘기면 `failed` + 사유 표시. */
export const PLAY_START_TIMEOUT_MS = 40_000;

/** 기동 대기 중 포트/URL 을 확인하는 간격. */
export const PLAY_PROBE_INTERVAL_MS = 500;

/** running 버블의 생사를 확인하는 스윕 간격(§7.11 checkIframesAlive 와 같은 주기). */
export const PLAY_ALIVE_SWEEP_MS = 5_000;

/** 정적 서빙(kind='static') 후보로 볼 index 파일 이름. 앞에서부터 먼저 찾는다. */
export const PLAY_STATIC_INDEX_FILES: readonly string[] = ['index.html', 'index.htm'];

/** 정적 서빙 루트 후보 폴더(프로젝트 루트 기준). 빈 문자열 = 루트 자신. */
export const PLAY_STATIC_ROOT_DIRS: readonly string[] = ['', 'public', 'dist', 'build', 'docs', 'src', 'web', 'www'];

/** §5.14 ④ — 실행법을 못 찾았을 때 에이전트에게 보내는 명령(기존 큐, 답은 `POST /api/play-recipe`). 서버를 띄우지 마라 — 켜는 법만 등록한다. */
export function buildPlayRecipeAskPrompt(args: {
  serverBase: string;
  serverToken: string;
  bubbleId: string;
  projectPath: string;
  identityFile?: string;
}): string {
  const { serverBase, serverToken, bubbleId, projectPath } = args;
  const { base, tokenHdr } = cardEndpointRefs(serverBase, serverToken);
  return `이 프로젝트(\`${projectPath}\`)를 **어떻게 실행하는지**만 알아내서 아래 엔드포인트로 등록해 주세요.

**서버를 띄우지 마세요.** 실행은 사용자가 캔버스의 플레이 버튼을 누를 때 Vibisual 이 합니다. 당신이 할 일은 조사와 등록뿐입니다.

1. \`package.json\` 의 scripts, vite/next/astro 설정, python(app.py·main.py·manage.py), go/cargo, 또는 그냥 열면 되는 \`index.html\` 이 있는지 확인하세요.
2. 사용자가 "플레이"를 눌렀을 때 열려야 할 **한 가지**를 고르세요(여러 개면 사용자가 눈으로 볼 화면 쪽).
3. 아래 curl 을 **1회** 실행해 등록하세요.

- \`kind\`: 명령 없이 정적 파일만 열면 되면 \`"static"\`, 셸 명령이 필요하면 \`"command"\`.
- \`command\`: (\`kind="command"\`) 실제 기동 명령. 포트를 인자로 받으면 \`{port}\` 토큰을 써도 됩니다.
- \`cwd\`: 명령을 실행할 절대 경로(대개 프로젝트 루트).
- \`root\`: (\`kind="static"\`) 서빙할 폴더의 절대 경로.
- \`port\`: 알고 있으면 숫자로. 모르면 생략.
- \`openPath\`: 열 경로(예: \`/index.html\`). 루트면 생략.
- \`label\`: 사람이 읽을 한 줄(예: \`pnpm dev (vite)\`).

\`\`\`bash
curl -s -X POST "${base}/api/play-recipe" \\
  ${tokenHdr} \\
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"bubbleId":"${bubbleId}","kind":"command","command":"pnpm dev","cwd":"${projectPath.replace(/\\/g, '/')}","port":5173,"openPath":"/","label":"pnpm dev"}
JSON
\`\`\`

등록이 끝나면 한 줄로만 알려 주세요("실행법을 등록했습니다: <label>"). 서버 기동·빌드·설치는 하지 마세요.`;
}

// ─── §5.15 — 스펙 보드 (요구사항 → 수용 기준 → 작업 카드 → 실행) ───

/** 스펙 표지 버블 기본 크기. 캔버스에서는 표지만 보이고 본문은 보드 패널에서 읽는다. */
export const SPEC_BUBBLE_DEFAULT_WIDTH = 220;
export const SPEC_BUBBLE_DEFAULT_HEIGHT = 140;

/** 스펙 제목·수용 기준 한 줄의 길이 상한 — 한 줄이 문단이 되면 목록이 읽히지 않는다. */
export const SPEC_TITLE_MAX = 120;
export const SPEC_ITEM_TEXT_MAX = 400;

/** 스펙 본문(마크다운) 길이 상한. 넘으면 서버가 잘라서 저장한다(무한 성장 차단). */
export const SPEC_BODY_MAX = 20_000;

/** 스펙 한 장이 가질 수 있는 수용 기준 개수 상한. */
export const SPEC_MAX_ITEMS = 60;

// ─── §5.16 — 리뷰·승인 레인 ───

/**
 * 리뷰 한 건에 실을 diff 본문 바이트 상한. 넘으면 자르고 `diffTruncated` 로 말한다.
 * 체크포인트에 함께 저장되므로(§5.16 영속) 이 값이 곧 리뷰 한 건의 최대 무게다.
 */
export const REVIEW_DIFF_MAX_BYTES = 120_000;

/** 리뷰 한 건에 실을 변경 파일 개수 상한. 넘으면 자르고 `filesTruncated` 로 말한다. */
export const REVIEW_FILES_MAX = 200;

/** 프로젝트당 리뷰 개수 상한(§9). 넘으면 오래된 것부터 버리되 pending 은 남긴다. */
export const REVIEW_REQUESTS_MAX_PER_PROJECT = 40;

/** 리뷰 한 건이 보관할 결정 이력 개수 상한. 넘으면 오래된 것부터 버린다. */
export const REVIEW_DECISIONS_MAX = 20;

/** 반려 사유 길이 상한. 그대로 다음 프롬프트가 되므로 한 명령에 실릴 만큼만 받는다. */
export const REVIEW_REASON_MAX = 2_000;

/** 반려 명령에 실을 변경 파일 수 상한 — 넘으면 잘라 내고 "+N" 으로 말한다. */
export const REVIEW_REJECT_FILES_MAX = 40;


/** 작업 카드(커스텀 에이전트) 라벨로 쓸 수용 기준 앞머리 길이. */
export const SPEC_TASK_LABEL_MAX = 40;

/** 작업 카드를 놓을 자리 — 스펙 표지 오른쪽으로 이만큼 띄우고, 세로로 이 간격씩 쌓는다. */
export const SPEC_TASK_OFFSET_X = 320;
export const SPEC_TASK_GAP_Y = 150;

/** §5.15 — 작업 카드의 `AgentConfig.rules` 앞에 붙는 자동 섹션(새 주입 경로 ❌). 손으로 고친 rules 에서 이 블록만 갈아 끼우려고 표식을 둔다. */
export const SPEC_RULES_BEGIN = '<!-- vibisual:spec-task:begin -->';
export const SPEC_RULES_END = '<!-- vibisual:spec-task:end -->';

/** 작업 카드 규칙 블록 본문 조립. 스펙 본문은 길 수 있으므로 앞부분만 싣는다. */
export function buildSpecTaskRules(args: {
  specTitle: string;
  specBody: string;
  itemText: string;
  itemIndex: number;
  itemTotal: number;
  bodyExcerptMax?: number;
}): string {
  const { specTitle, specBody, itemText, itemIndex, itemTotal } = args;
  const max = args.bodyExcerptMax ?? 2_000;
  const body = specBody.length > max ? `${specBody.slice(0, max)}\n…(생략)` : specBody;
  return [
    SPEC_RULES_BEGIN,
    `# 스펙 작업 카드 (자동 — 스펙 보드 §5.15)`,
    '',
    `이 카드는 스펙 **"${specTitle}"** 의 수용 기준 ${itemIndex + 1}/${itemTotal} 에서 나왔습니다.`,
    '',
    `## 이 카드가 만족시켜야 할 수용 기준`,
    `- ${itemText}`,
    '',
    `## 스펙 본문`,
    body.trim().length > 0 ? body : '(본문 없음)',
    '',
    `수용 기준을 벗어나는 변경은 하지 말고, 스펙과 어긋나는 점을 발견하면 고치지 말고 보고하세요.`,
    SPEC_RULES_END,
  ].join('\n');
}


// ─── §5.18 — 에이전트 랩 (같은 과제를 설정만 바꿔 N벌) ───

/** 랩 표지 버블 기본 크기. 캔버스에서는 표지만 보이고 비교 표는 보드 패널에서 읽는다. */
export const LAB_BUBBLE_DEFAULT_WIDTH = 240;
export const LAB_BUBBLE_DEFAULT_HEIGHT = 150;

/** 랩 제목·변형 이름 길이 상한 — 한 줄이 문단이 되면 표가 읽히지 않는다. */
export const LAB_TITLE_MAX = 120;
export const LAB_VARIANT_LABEL_MAX = 60;

/** 과제 프롬프트 길이 상한. 그대로 명령 큐로 나가므로 한 명령에 실릴 만큼만 받는다. */
export const LAB_TASK_MAX = 8_000;

/** 변형 덧말(`rulesAppend`) 길이 상한 — 기준 rules 앞에 붙는 실험용 문장. */
export const LAB_RULES_APPEND_MAX = 2_000;

/** 표에 싣는 결과 요약(마지막 응답 앞머리) 길이 상한. */
export const LAB_SUMMARY_MAX = 300;

/** 랩당 변형 수 상한(§9) — 변형 하나 = 워크트리 + 에이전트 + CLI 라 한 번에 태우는 프로세스 수다. */
export const LAB_MAX_VARIANTS = 8;

/** 프로젝트당 보관할 랩 개수 상한. 넘으면 오래된 것부터 버리되 도는 랩은 남긴다. */
export const LAB_RUNS_MAX_PER_PROJECT = 20;

/** 변형 워크트리 이름 앞머리 — `.claude/worktrees/lab-<랩id끝자리>-<변형순번>`. */
export const LAB_WORKTREE_PREFIX = 'lab';

/** §7.10 — 트리째 죽인 뒤 폴더 삭제 전 대기(ms). `taskkill /T /F`·`kill(-pgid)` 는 신호만 보내 핸들이 남아, 곧바로 `rmSync` 하면 반만 지워진다. */
export const WORKTREE_REAP_SETTLE_MS = 700;

/** 변형 카드를 놓을 자리 — 랩 표지 오른쪽으로 이만큼 띄우고, 세로로 이 간격씩 쌓는다. */
export const LAB_CARD_OFFSET_X = 320;
export const LAB_CARD_GAP_Y = 150;

/** §5.18 — 변형 에이전트의 `AgentConfig.rules` 앞에 붙는 자동 섹션(§5.15 와 같은 문법). */
export const LAB_RULES_BEGIN = '<!-- vibisual:lab-variant:begin -->';
export const LAB_RULES_END = '<!-- vibisual:lab-variant:end -->';

/** 변형 규칙 블록 본문 조립. 덧말이 없으면 안내 줄만 남는다. */
export function buildLabVariantRules(args: {
  labTitle: string;
  variantLabel: string;
  variantIndex: number;
  variantTotal: number;
  rulesAppend?: string;
}): string {
  const { labTitle, variantLabel, variantIndex, variantTotal } = args;
  const append = (args.rulesAppend ?? '').trim();
  return [
    LAB_RULES_BEGIN,
    `# 에이전트 랩 변형 (자동 — 에이전트 랩 §5.18)`,
    '',
    `이 카드는 랩 **"${labTitle}"** 의 변형 ${variantIndex + 1}/${variantTotal}("${variantLabel}") 입니다.`,
    `같은 과제를 설정만 바꿔 여러 벌 돌려 비교하는 중이므로, **주어진 과제 범위만** 처리하고`,
    `다른 변형의 작업 공간을 건드리지 마세요.`,
    ...(append ? ['', '## 이 변형에만 적용되는 지시', append] : []),
    LAB_RULES_END,
  ].join('\n');
}

/** §5.18 — 추정 비용(USD). 단가를 모르면 `undefined`(0 이면 "공짜"로 읽힌다). 입력은 input 단가 하나로 — 변형끼리 상대 비교라 충분하다. */
export function estimateLabCostUsd(args: {
  inputTokens?: number;
  outputTokens?: number;
  pricing?: { input: number; output: number } | undefined;
}): number | undefined {
  const { pricing } = args;
  if (!pricing) return undefined;
  const input = args.inputTokens ?? 0;
  const output = args.outputTokens ?? 0;
  if (input === 0 && output === 0) return undefined;
  const usd = (input / 1_000_000) * pricing.input + (output / 1_000_000) * pricing.output;
  return Math.round(usd * 10_000) / 10_000;
}

// §4 에이전트 피드백 학습 루프 (좋아요/싫어요 → 규칙 되먹임)

/** agentId 당 보관하는 피드백 최대 개수 (ring buffer 캡, 초과 시 오래된 것부터 제거). */
export const AGENT_FEEDBACK_MAX_PER_AGENT = 200;

/** 스폰 프롬프트에 주입하는 피드백 다이제스트 최대 건수 (최근순). */
export const AGENT_FEEDBACK_DIGEST_MAX = 12;

/** distill 증류 제안에 넣는 싫어요 최대 건수 (최근순 — 프롬프트 비대 방지). */
export const AGENT_FEEDBACK_DISTILL_MAX = 30;

/** 피드백 summary 한 항목의 최대 길이 (result 본문 발췌 캡). */
export const AGENT_FEEDBACK_SUMMARY_ITEM_MAX = 200;

// §5.5 #17-11 세션 반복 실행(루프)

/** `mode='count'` 루프의 목표 횟수 상한 (실수로 수만 회를 걸어 세션이 폭주하는 것 차단). */
export const SESSION_LOOP_MAX_ITERATIONS = 999;

/** 루프 폼의 기본 반복 횟수. */
export const SESSION_LOOP_DEFAULT_TOTAL = 5;

/** 회차 사이 기본 대기(ms). 0 = 직전 회차가 끝나는 즉시 다음 회차. */
export const SESSION_LOOP_DEFAULT_INTERVAL_MS = 0;

/** 회차 사이 대기 상한(ms) — 1시간. 이보다 긴 주기는 루프가 아니라 스케줄러의 영역. */
export const SESSION_LOOP_MAX_INTERVAL_MS = 60 * 60 * 1000;

/** 반복 명령 본문 최대 길이 (체크포인트 비대 방지). */
export const SESSION_LOOP_COMMAND_MAX = 8000;

/**
 * §5.5 #17-11 ⑪ — `contextMode='compact'` 루프가 회차 사이에 보내는 압축 명령 본문.
 * CLI 내장 슬래시 명령(§5.5 #17-2)이라 사용자가 입력창에 직접 치는 것과 같은 길을 탄다.
 */
export const SESSION_LOOP_COMPACT_COMMAND = '/compact';

/** §5.5 #17-11 ⑫(b) — `contextMode='clear'` 루프가 회차 사이에 보내는 초기화 명령 본문. */
export const SESSION_LOOP_CLEAR_COMMAND = '/clear';

/**
 * §5.5 #17-28 ⑩ (c) — 우리가 내부적으로 쏘는 슬래시 명령인가. `--disable-slash-commands` 는 내장 명령까지 막아(실측 2.1.263)
 * 그 줄을 끄면 `/compact` 셋(턴 경계·자율·루프)이 조용히 죽는다. 사용자가 친 슬래시는 해당 없음 — 끈 스위치를 우리가 무력화하면 안 된다.
 */
export function isInternalSlashCommand(text: string): boolean {
  const t = text.trim();
  return t === AGENT_COMPACT_COMMAND
    || t === SESSION_LOOP_COMPACT_COMMAND
    || t === SESSION_LOOP_CLEAR_COMMAND;
}

/** §5.5 #17-28 ⑩ (c) — 스폰 인자에서 슬래시 차단 플래그만 뺀다(다른 주입 스위치는 그대로 — 명령 등록만 되살린다). 플래그 이름은 `CONTEXT_SPAWN_SWITCHES` 를 따른다. */
export function withoutSlashCommandFlag(args: readonly string[]): string[] {
  const flag = CONTEXT_SPAWN_SWITCHES[CONTEXT_SOURCE_IDS.slashCommands]?.flag;
  if (!flag) return [...args];
  return args.filter((a) => a !== flag);
}

/** §5.5 #17-11 ⑫(c)(f) — 진행 파일·명령 파일 경로 입력 길이 상한(경로 한 줄). */
export const SESSION_LOOP_PATH_MAX = 260;

/** §5.5 #17-11 ⑫(a) — 누적 비용 상한(USD)의 상한. 이보다 큰 값은 사실상 무제한과 같다. */
export const SESSION_LOOP_MAX_COST_USD_LIMIT = 10_000;

/** §5.5 #17-11 ⑫(a) — 벽시계 상한의 상한(ms) — 7일. */
export const SESSION_LOOP_MAX_DURATION_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;

// ─── §5.5 #17-35 — 검증(Verify) ───

/** 세션 탭당 검증 이력 상한(§9). */
export const VERIFICATION_RUNS_MAX_PER_SESSION = 20;

/** "무엇을 확인할지" 한 줄의 최대 길이 (프롬프트·체크포인트 비대 방지). */
export const VERIFICATION_FOCUS_MAX = 2000;

/** 한 검증이 보관하는 시도(attempts) 최대 건수. */
export const VERIFICATION_ATTEMPTS_MAX = 12;

/** 판정 사유 한 줄의 최대 길이. */
export const VERIFICATION_REASON_MAX = 500;

/** 시도 한 줄의 `command`/`detail` 최대 길이. */
export const VERIFICATION_ATTEMPT_TEXT_MAX = 300;

// §5.5 #17-35 ⑨ 시연 상한 — 디스크에 PNG 를 남기는 유일한 검증 데이터라 개수 상한이 폴더 크기 상한이다(§9).

/** 세션 탭 하나가 보관하는 시연 최대 건수. 넘치면 가장 오래된 것부터 지운다(프레임 폴더째). */
export const VERIFICATION_DEMO_MAX_PER_SESSION = 6;

/** 시연 하나의 단계 최대 개수. */
export const VERIFICATION_DEMO_STEPS_MAX = 20;

/** 단계 한 줄의 최대 길이. */
export const VERIFICATION_DEMO_STEP_TEXT_MAX = 200;

/** 시연 이름 한 줄의 최대 길이. */
export const VERIFICATION_DEMO_LABEL_MAX = 80;

/** 기대 결과 한 줄의 최대 길이. */
export const VERIFICATION_DEMO_EXPECTED_MAX = 300;

/** 시연 하나의 프레임 상한 — `CAPTURE_PLAYTEST.MAX_FRAME_COUNT` 와 같은 수·이유(입력창을 그림으로 덮지 않는다). 매 검증 토큰에도 든다. */
export const VERIFICATION_DEMO_FRAMES_MAX = 9;

/** 시연 프레임이 사는 곳 — 프로젝트 `.vibisual/` 아래 폴더 이름(첨부 폴더와 **다른** 자리). */
export const VERIFICATION_DEMO_DIR = 'verify-demos';

/**
 * §5.5 #17-35 ③ — 그 탭 큐에 실제로 나가는 명령의 머리.
 * Claude Code 번들 스킬이라 우리가 실행 로직을 갖지 않는다 — 부르기만 한다.
 */
export const VERIFY_SLASH_COMMAND = '/verify';

/**
 * §5.5 #17-35 ④(b) — `/verify` 가 스스로 적어 두는 레시피 파일(리포 루트 기준 상대 경로).
 * 있으면 "그대로 따르라"고 알릴 뿐 **우리가 쓰지도 고치지도 않는다** — 그건 `/verify` 자신의 자리다.
 */
export const VERIFY_RECORDED_SKILL_PATH = '.claude/skills/verify/SKILL.md';


// §5.5 #17-17 세션 목표(Goal)

/** 목표 본문 최대 길이 (체크포인트·프롬프트 비대 방지). */
export const SESSION_GOAL_TEXT_MAX = 2000;

/** 진행 신고 한 줄 근거의 최대 길이. */
export const SESSION_GOAL_NOTE_MAX = 200;

/** 진행 이력 ring buffer 크기 — 넘치면 오래된 것부터 버린다. */
export const SESSION_GOAL_HISTORY_MAX = 40;

/** §5.5 #17-17 — 목표 단계 최대 개수(넘으면 잘린다). */
export const SESSION_GOAL_STEPS_MAX = 30;

/** 단계 본문 최대 길이 — 사이드바 한 줄에 들어갈 정도로 짧게 쓰게 한다. */
export const SESSION_GOAL_STEP_TEXT_MAX = 200;

/** §5.5 #17-17 ⑰(c) — 목표 변천 기록(`pastTexts`) 상한(오래된 것부터 버린다). */
export const SESSION_GOAL_PAST_TEXT_MAX = 5;

/** §5.5 #17-17 ⑰(d) — 단계가 가리키는 두뇌 스킬을 그 턴에 더 싣는 상한(`BRAIN_SKILL_INJECTION_TOP_K` 예산 밖 — 명령과 안 맞아도 보게 하되 짧게). */
export const SESSION_GOAL_STEP_SKILLS_MAX = 2;

// ─── §5.5 #17-17 ⑪ 살아 있는 단계 지도 ───

/** ⑪(b) — 글리프 path 최대 길이. 아이콘 하나는 이 안에 들어간다(넘으면 글리프만 버린다). */
export const SVG_PATH_MAX = 512;

/** ⑪(a) — 시각 종류 카드 최대 개수. 넘으면 가장 식은 것부터 휴지통으로 간다. */
export const VISUAL_KIND_MAX = 40;

/** ⑪(c) — 이만큼 노출됐는데 `helpfulCount` 가 0이면 침전(`dormant`)시킨다. */
export const VISUAL_KIND_DORMANT_REF = 8;

/** ⑪(c) — 침전한 채 이 일수를 넘기면 휴지통으로 보낸다. */
export const VISUAL_KIND_TRASH_DAYS = 14;

/** ⑪(i) — 장면 그림 path 최대 개수. 넘는 것은 버린다(카드는 남는다). */
export const VISUAL_SCENE_PATHS_MAX = 8;

/** ⑪(i) — 장면 그림이 서는 좌표계. 목록·노드용 `glyph`(24)와 **다른 그림**이다. */
export const VISUAL_SCENE_VIEWBOX = '0 0 96 96';

/** ⑪(i) — "미리 표현하는 한 줄" 최대 길이. 무대 머리에 한 줄로 들어갈 만큼만. */
export const VISUAL_KIND_BLURB_MAX = 120;

// ─── §5.5 #17-17 ⑫ 무대 팔레트 — 배운 행동이 노드로 선다 ───

/** ⑫(a) — 팔레트에 서는 최소 반복 횟수(1~2회면 최근 목록이 된다). 스킬은 `GOAL_ACTION_SKILL_MIN_REPEAT`. */
export const GOAL_ACTION_MIN_REPEAT = 3;

/**
 * ⑫(a) — 스킬 카드의 문턱. 스킬은 이름 자체가 이미 "이 프로젝트에서 하는 일"이라
 * 한 번만 불려도 팔레트에 설 값이 있다(명령·단계와 달리 우연히 반복되지 않는다).
 */
export const GOAL_ACTION_SKILL_MIN_REPEAT = 1;

/** ⑫(a) — 팔레트 최대 칸 수. 넘어가면 그것은 "자주 쓰는 것"이 아니라 목록이다. */
export const GOAL_ACTION_MAX = 24;

/** ⑫(b) — 카드 이름 최대 길이(서랍 한 줄에 들어갈 만큼). */
export const GOAL_ACTION_LABEL_MAX = 48;

/** ⑫(b) — 떨궜을 때 단계 본문이 될 글의 최대 길이. 단계 본문 상한과 같은 자를 쓴다. */
export const GOAL_ACTION_PAYLOAD_MAX = SESSION_GOAL_STEP_TEXT_MAX;

/** ⑪(i) — 화면 골격 전부(종류는 무한, 골격은 유한). 없는 값은 `none`. */
export const VISUAL_KIND_SURFACES: readonly VisualKindSurface[] = [
  'source',
  'log',
  'diff',
  'web',
  'terminal',
  'docs',
  // ㉒(a) — 산출물 넷. 무대가 **내부 앱**(§5.13)을 자기 몸 안에서 펴는 자리다(새 뷰어 ❌).
  'image',
  'model3d',
  'video',
  'audio',
  'none',
];

/**
 * ㉒(a) — 산출물 골격이 펴는 내부 앱 id(§5.13 `INTERNAL_APPS`). 무대가 앱 이름을 코드에 안 적게 표로 모은다. 없는 골격(`image` 등)은 기존 조각으로.
 * ⚠ 앱 id 만 — 여는 확장자는 앱이 선언하고(`InternalApp.opens`) 무대는 `workspaceOpenClaims()` 로 받는다(§5.13 (R-1)).
 */
export const STAGE_SURFACE_APPS: Readonly<Partial<Record<VisualKindSurface, string>>> = {
  model3d: 'vibi3d',
  video: 'vibistudio',
  audio: 'vibisound',
};

/** ㉒(c) — 앞 단계가 없을 때 실황 구간을 뒤로 여는 폭(ms, 없으면 첫 단계가 늘 빈 화면). */
export const STAGE_WINDOW_FALLBACK_MS = 10 * 60 * 1000;

/** ⑪(a)(i) — 카드 씨앗·시작 카드가 공유하는 모양. */
export interface VisualKindPreset {
  key: string;
  label: string;
  /** 목록·노드용 24px stroke path. */
  glyph: string;
  color: string;
  /** 무대 배경용 96px stroke path 들(⑪(i)). */
  scene?: string[];
  /** 이 종류가 펴는 화면 골격(⑪(i)). */
  surface?: VisualKindSurface;
}

/** ⑪(a) — 뿌리 씨앗 셋(시들지도 지워지지도 않는다). `blurb` 는 비운다 — 로케일을 모르는 자리라 화면이 `ide.stage.surfaceBlurb.*` 로 채운다. */
export const VISUAL_KIND_SEEDS: readonly VisualKindPreset[] = [
  // 찾기·읽기·설계 — 돋보기
  {
    key: 'locate',
    label: 'Locate',
    glyph: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.35-4.35',
    color: '#38BDF8',
    surface: 'source',
    scene: [
      'M42 18a24 24 0 1 0 0 48 24 24 0 0 0 0-48z',
      'M59 59 80 80',
      'M31 35h22M31 43h16M31 51h20',
    ],
  },
  // 쓰기·고치기 — 펜
  {
    key: 'change',
    label: 'Change',
    glyph: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
    color: '#F59E0B',
    surface: 'source',
    scene: [
      'M18 78h14L78 32a9 9 0 0 0-13-13L19 65z',
      'M62 22 75 35',
      'M18 78 32 78',
      'M14 88h68',
    ],
  },
  // 빌드·검사·실행 — 체크
  {
    key: 'verify',
    label: 'Verify',
    glyph: 'M20 6 9 17l-5-5',
    color: '#10B981',
    surface: 'log',
    scene: [
      'M48 10 80 22v24c0 20-13 32-32 40C29 78 16 66 16 46V22z',
      'M34 46 44 56 63 36',
    ],
  },
];

/** ⑪(i) — 시작 카드. 씨앗과 달리 보통 카드처럼 시들고 휴지통으로 간다. 상표·로고 ❌ — 우리가 그린 중립 도형만. */
export const VISUAL_KIND_STARTERS: readonly VisualKindPreset[] = [
  // 브랜치 — 갈라졌다 합쳐지는 선.
  {
    key: 'git',
    label: 'Git',
    glyph: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a9 9 0 0 0 9-9',
    color: '#F97316',
    surface: 'diff',
    scene: [
      'M28 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
      'M28 90a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
      'M72 52a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
      'M28 22v52',
      'M28 44h16a20 20 0 0 0 20-8',
    ],
  },
  // 원격 — 올려 보내는 화살표가 걸린 상자.
  {
    key: 'github',
    label: 'Remote',
    glyph: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9v6a3 3 0 0 0 3 3h6M13 15l3 3-3 3',
    color: '#A78BFA',
    surface: 'web',
    scene: [
      'M20 26a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
      'M20 26v28a12 12 0 0 0 12 12h28',
      'M76 78a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
      'M52 56 62 66 52 76',
    ],
  },
  // 소스 — 꺾쇠.
  {
    key: 'source',
    label: 'Source',
    glyph: 'M8 6 2 12l6 6M16 6l6 6-6 6',
    color: '#60A5FA',
    surface: 'source',
    scene: [
      'M32 26 10 48l22 22',
      'M64 26 86 48 64 70',
      'M56 18 40 78',
    ],
  },
  // 로그 — 줄글이 흐르는 화면(언리얼 로그도 이 골격이다).
  {
    key: 'log',
    label: 'Log',
    glyph: 'M4 5h16M4 10h10M4 15h13M4 20h7',
    color: '#94A3B8',
    surface: 'log',
    scene: [
      'M12 14h72v68H12z',
      'M12 28h72',
      'M22 40h52M22 52h34M22 64h44',
    ],
  },
  // 빌드 — 쌓이는 상자.
  {
    key: 'build',
    label: 'Build',
    glyph: 'M3 8 12 3l9 5v8l-9 5-9-5z M12 12l9-4M12 12v10M12 12 3 8',
    color: '#FBBF24',
    surface: 'terminal',
    scene: [
      'M48 8 84 26v36L48 80 12 62V26z',
      'M48 44 84 26',
      'M48 44v36',
      'M48 44 12 26',
    ],
  },
  // 검사 — 플라스크.
  {
    key: 'test',
    label: 'Test',
    glyph: 'M9 3h6M10 3v6L5 19a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-10V3M8 15h8',
    color: '#34D399',
    surface: 'log',
    scene: [
      'M36 10h24',
      'M40 10v26L20 74a8 8 0 0 0 7 12h42a8 8 0 0 0 7-12L56 36V10',
      'M30 60h36',
    ],
  },
  // ㉒(b) 산출물 넷 — 규약이 `surface` 를 가르치지 않아(㉑) 이 카드들이 에이전트가 골격을 고르는 길이다. 색은 그 골격이 여는 앱의 `glow` 를 빌린다.
  // 그림 — 여는 곳이 편집창 그림 칸이라 빌릴 앱 색이 없어 따뜻한 종이 톤.
  {
    key: 'art',
    label: 'Art',
    glyph: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
    color: '#FDBA74',
    surface: 'image',
    scene: [
      'M18 14h60v44H18z',
      'M28 46 42 30 52 42 62 34 70 46',
      'M18 58 8 88',
      'M78 58 88 88',
      'M48 58v22',
    ],
  },
  // 3D — 정육면체. `cube` 템플릿과 **같은 그림**이다(같은 뜻에 두 그림을 두지 않는다).
  {
    key: 'model',
    label: '3D',
    glyph: 'M12 2 21 7v10l-9 5-9-5V7zM12 12l9-5M12 12v10M12 12 3 7',
    color: '#B9A8E0',
    surface: 'model3d',
    scene: ['M48 6 86 26v44L48 90 10 70V26z', 'M48 48 86 26', 'M48 48v42', 'M48 48 10 26'],
  },
  // 영상 — 필름 프레임 + 재생 삼각형. 가로가 긴 것 자체가 "영상"이라는 신호다(§5.13 (M) 와 같은 판단).
  {
    key: 'media',
    label: 'Video',
    glyph: 'M3 5h18v14H3zM7 5v14M17 5v14M3 12h4M17 12h4',
    color: '#A8B4CC',
    surface: 'video',
    scene: [
      'M10 24h76v48H10z',
      'M10 36h12M10 60h12M74 36h12M74 60h12',
      'M28 24v48M68 24v48',
      'M42 38 58 48 42 58z',
    ],
  },
  // 소리 — 파형. 막대 높이가 다른 것이 곧 "소리"다.
  {
    key: 'sound',
    label: 'Audio',
    glyph: 'M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4',
    color: '#8FD3C7',
    surface: 'audio',
    scene: [
      'M14 40v16',
      'M26 30v36',
      'M38 18v60',
      'M50 26v44',
      'M62 34v28',
      'M74 42v12',
      'M86 46v4',
    ],
  },
];

// ─── §5.5 #17-17 ⑪(m) 기본 템플릿 — "스스로 진화"의 출발점 ───

/**
 * ⑪(m) — 장면 템플릿: 새 종류 그림의 출발점(`from: wave` 한 줄로 장면·글리프·골격·색). 그 위에 자기 path 를 얹는다 — 시작점이지 울타리가 아니다.
 * 상표·로고 ❌ — 우리가 그린 중립 도형만.
 */
export interface VisualSceneTemplate {
  /** `from: <이름>` 또는 `scene: @<이름>` 으로 지목한다. */
  name: string;
  /** 24 좌표계 글리프 — 카드가 자기 글리프를 안 냈을 때 이것이 쓰인다. */
  glyph: string;
  /** 96 좌표계 장면 path 들. */
  scene: string[];
  /** 이 그림에 어울리는 화면 골격 — 카드가 `surface` 를 안 냈을 때만 쓰인다. */
  surface?: VisualKindSurface;
  /** 이 그림에 어울리는 색 — 카드가 `color` 를 안 냈을 때만 쓰인다. */
  color?: string;
}

export const VISUAL_SCENE_TEMPLATES: readonly VisualSceneTemplate[] = [
  {
    name: 'window',
    glyph: 'M3 5h18v14H3zM3 9h18',
    scene: ['M12 18h72v60H12z', 'M12 34h72', 'M22 26h6M34 26h6', 'M24 48h34M24 60h48'],
    surface: 'source',
    color: '#60A5FA',
  },
  {
    name: 'branch',
    glyph: 'M6 3v12M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a9 9 0 0 0 9-9',
    scene: [
      'M26 24a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
      'M26 90a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
      'M70 54a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
      'M26 24v48',
      'M26 45h18a17 17 0 0 0 17-9',
    ],
    surface: 'diff',
    color: '#F97316',
  },
  {
    name: 'flow',
    glyph: 'M4 7h6v6H4zM14 11h6v6h-6zM10 10h4',
    scene: ['M10 20h28v22H10z', 'M58 54h28v22H58z', 'M38 31h10a10 10 0 0 1 10 10v14', 'M52 59l6 6-6 6'],
    color: '#A78BFA',
  },
  {
    name: 'stack',
    glyph: 'M3 7l9-4 9 4-9 4zM3 12l9 4 9-4M3 17l9 4 9-4',
    scene: ['M48 10 86 28 48 46 10 28z', 'M10 48l38 18 38-18', 'M10 68l38 18 38-18'],
    surface: 'terminal',
    color: '#FBBF24',
  },
  {
    name: 'terminal',
    glyph: 'M4 5h16v14H4zM8 10l3 2-3 2M13 14h4',
    scene: ['M10 16h76v64H10z', 'M10 32h76', 'M24 46l10 8-10 8', 'M42 62h26'],
    surface: 'terminal',
    color: '#34D399',
  },
  {
    name: 'doc',
    glyph: 'M6 3h8l4 4v14H6zM14 3v4h4',
    scene: ['M22 8h34l18 18v62H22z', 'M56 8v18h18', 'M34 44h30M34 56h30M34 68h20'],
    surface: 'docs',
    color: '#22D3EE',
  },
  {
    name: 'gear',
    glyph: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
    scene: [
      'M48 34a14 14 0 1 0 0 28 14 14 0 0 0 0-28z',
      'M48 8v14M48 74v14M8 48h14M74 48h14',
      'M20 20l10 10M66 66l10 10M76 20 66 30M30 66l-10 10',
    ],
    color: '#94A3B8',
  },
  {
    name: 'wave',
    glyph: 'M2 12h3l3-7 4 14 3-7h7',
    scene: ['M8 52h14l12-30 16 56 12-38 8 12h18'],
    surface: 'log',
    color: '#F472B6',
  },
  {
    name: 'grid',
    glyph: 'M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18',
    scene: ['M12 12h72v72H12z', 'M36 12v72M60 12v72', 'M12 36h72M12 60h72'],
    surface: 'source',
    color: '#818CF8',
  },
  {
    name: 'target',
    glyph: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    scene: [
      'M48 10a38 38 0 1 0 0 76 38 38 0 0 0 0-76z',
      'M48 26a22 22 0 1 0 0 44 22 22 0 0 0 0-44z',
      'M48 40a8 8 0 1 0 0 16 8 8 0 0 0 0-16z',
    ],
    color: '#FB7185',
  },
  {
    name: 'shield',
    glyph: 'M12 2 20 5v6c0 5-3 8-8 10-5-2-8-5-8-10V5z',
    scene: ['M48 8 84 22v26c0 22-15 34-36 40C27 82 12 70 12 48V22z', 'M32 46l12 12 22-22'],
    surface: 'log',
    color: '#10B981',
  },
  {
    name: 'cube',
    glyph: 'M12 2 21 7v10l-9 5-9-5V7zM12 12l9-5M12 12v10M12 12 3 7',
    scene: ['M48 6 86 26v44L48 90 10 70V26z', 'M48 48 86 26', 'M48 48v42', 'M48 48 10 26'],
    // ㉒(b) — 정육면체 그림에 터미널이 열리던 것을 고친다. 이미 만들어진 카드는 생성 시점에
    //   자기 `surface` 를 저장하므로 바뀌지 않는다(템플릿은 **다음** 카드부터 관여한다).
    surface: 'model3d',
    color: '#B9A8E0',
  },
  {
    name: 'bug',
    glyph: 'M9 4h6v3a3 3 0 0 1-6 0zM6 9h12v4a6 6 0 0 1-12 0zM3 11h3M18 11h3M4 17l3-2M20 17l-3-2',
    scene: [
      'M36 14h24v12a12 12 0 0 1-24 0z',
      'M24 36h48v18a24 24 0 0 1-48 0z',
      'M8 44h16M72 44h16',
      'M12 72l14-8M84 72l-14-8',
    ],
    surface: 'log',
    color: '#EF4444',
  },
  {
    name: 'globe',
    glyph: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 4 3 14 0 18M12 3c-3 4-3 14 0 18',
    scene: [
      'M48 10a38 38 0 1 0 0 76 38 38 0 0 0 0-76z',
      'M10 48h76',
      'M48 10c12 16 12 60 0 76',
      'M48 10c-12 16-12 60 0 76',
    ],
    surface: 'web',
    color: '#38BDF8',
  },
  {
    name: 'store',
    glyph: 'M12 3c5 0 8 1 8 3s-3 3-8 3-8-1-8-3 3-3 8-3zM4 6v12c0 2 3 3 8 3s8-1 8-3V6',
    scene: [
      'M48 10c17 0 28 5 28 11s-11 11-28 11-28-5-28-11 11-11 28-11z',
      'M20 21v54c0 6 11 11 28 11s28-5 28-11V21',
      'M20 48c0 6 11 11 28 11s28-5 28-11',
    ],
    surface: 'source',
    color: '#A3E635',
  },
  {
    name: 'spark',
    glyph: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
    scene: ['M48 8l10 26 26 10-26 10-10 26-10-26-26-10 26-10z', 'M20 14l4 8 8 4-8 4-4 8-4-8-8-4 8-4z'],
    color: '#FACC15',
  },
];

/** ⑪(m) — 이름으로 장면 템플릿을 찾는다. 대소문자·앞의 `@` 는 무시한다(모델이 어느 쪽으로 적든 통하게). */
export function findSceneTemplate(name: unknown): VisualSceneTemplate | undefined {
  if (typeof name !== 'string') return undefined;
  const want = name.trim().replace(/^@/u, '').toLowerCase();
  if (!want) return undefined;
  return VISUAL_SCENE_TEMPLATES.find((tpl) => tpl.name === want);
}

/** ⑪(m) — 흐름 템플릿: 빈 무대에 자주 하는 일의 뼈대를 깐다. 본문은 i18n(`ide.stage.flow.<id>.title`·`.steps.<key>`), `kind` 는 씨앗·시작 카드 중에서만. */
export interface GoalFlowTemplateStep {
  /** i18n 키 조각. */
  key: string;
  /** 이 단계에 기본으로 붙는 종류(⑪(a)). */
  kind: string;
}

export interface GoalFlowTemplate {
  id: string;
  /** 목록에 세우는 24px 글리프. */
  glyph: string;
  color: string;
  steps: readonly GoalFlowTemplateStep[];
}

export const GOAL_FLOW_TEMPLATES: readonly GoalFlowTemplate[] = [
  {
    id: 'feature',
    glyph: 'M12 5v14M5 12h14',
    color: '#38BDF8',
    steps: [
      { key: 'survey', kind: 'locate' },
      { key: 'design', kind: 'locate' },
      { key: 'implement', kind: 'change' },
      { key: 'build', kind: 'build' },
      { key: 'test', kind: 'test' },
    ],
  },
  {
    id: 'bugfix',
    glyph: 'M9 4h6v3a3 3 0 0 1-6 0zM6 9h12v4a6 6 0 0 1-12 0zM3 11h3M18 11h3',
    color: '#EF4444',
    steps: [
      { key: 'reproduce', kind: 'verify' },
      { key: 'cause', kind: 'locate' },
      { key: 'fix', kind: 'change' },
      { key: 'regress', kind: 'test' },
    ],
  },
  {
    id: 'refactor',
    glyph: 'M4 7h6v6H4zM14 11h6v6h-6zM10 10h4',
    color: '#A78BFA',
    steps: [
      { key: 'scope', kind: 'locate' },
      { key: 'move', kind: 'change' },
      { key: 'build', kind: 'build' },
      { key: 'test', kind: 'test' },
    ],
  },
  {
    id: 'release',
    glyph: 'M6 3v12M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a9 9 0 0 0 9-9',
    color: '#F97316',
    steps: [
      { key: 'changelog', kind: 'change' },
      { key: 'bump', kind: 'change' },
      { key: 'build', kind: 'build' },
      { key: 'publish', kind: 'github' },
    ],
  },
  {
    id: 'investigate',
    glyph: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.35-4.35',
    color: '#22D3EE',
    steps: [
      { key: 'sweep', kind: 'locate' },
      { key: 'read', kind: 'source' },
      { key: 'summarize', kind: 'change' },
    ],
  },
];

/**
 * §5.5 #17-17 ⑪(b) — 글리프 path 검증: 에이전트 문자열이 SVG 속성으로 그대로 들어가는 길을 막는다. path 문법 문자만 통과, 아니면 글리프를 버린다(카드는 남는다).
 * 서버 저장과 클라 그리기가 같은 답을 내야 한다.
 */
export function sanitizeGlyphPath(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > SVG_PATH_MAX) return undefined;
  if (!/^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]+$/.test(trimmed)) return undefined;
  // 명령 문자가 하나도 없으면 path 가 아니다(숫자만 늘어놓은 문자열 방어).
  if (!/[MmLlHhVvCcSsQqTtAaZz]/.test(trimmed)) return undefined;
  return trimmed;
}

/** §5.5 #17-17 ⑪(i) — 장면 path 마다 같은 검사. 깨진 path 만 버린다(통째로 버리면 매번 다시 그린다). 남은 게 없으면 `undefined`. */
export function sanitizeScenePaths(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const item of raw) {
    if (out.length >= VISUAL_SCENE_PATHS_MAX) break;
    const path = sanitizeGlyphPath(item);
    if (path) out.push(path);
  }
  return out.length > 0 ? out : undefined;
}

/** §5.5 #17-17 ⑪(i) — 골격 정규화. 목록 밖은 `undefined`(무대가 `none` 으로 읽는다 — `'none'` 과 같은 그림이라 가르지 않는다). */
export function normalizeKindSurface(raw: unknown): VisualKindSurface | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim() as VisualKindSurface;
  if (v === 'none') return undefined;
  return VISUAL_KIND_SURFACES.includes(v) ? v : undefined;
}

/** §5.5 #17-17 ⑪(i) — 미리 표현하는 한 줄. 줄바꿈은 한 칸으로 접고 `VISUAL_KIND_BLURB_MAX` 로 자른다. */
export function sanitizeKindBlurb(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const flat = raw.replace(/\s+/gu, ' ').trim();
  return flat ? flat.slice(0, VISUAL_KIND_BLURB_MAX) : undefined;
}

/** §5.5 #17-17 ⑪(m) — `from` 템플릿을 밑칠로 깐다 — 카드가 낸 값이 이긴다(덮어쓰면 템플릿 위에 얹은 자기 그림을 잃는다). 서버·클라가 같은 답을 내야 한다. */
export interface SceneTemplateMerge {
  glyph?: string | undefined;
  color?: string | undefined;
  scene?: readonly string[] | undefined;
  surface?: VisualKindSurface | undefined;
}

export function applySceneTemplate(input: SceneTemplateMerge, from: unknown): SceneTemplateMerge {
  const tpl = findSceneTemplate(from);
  if (!tpl) return input;
  const own = input.scene ?? [];
  return {
    glyph: input.glyph ?? tpl.glyph,
    color: input.color ?? tpl.color,
    // 자기 path 가 있으면 템플릿 **위에** 얹는다(템플릿이 배경, 자기 것이 앞).
    scene: own.length > 0 ? [...tpl.scene, ...own] : tpl.scene,
    surface: input.surface ?? tpl.surface,
  };
}

/** §5.5 #17-17 ⑪(d) — 세션 단계 목록에 사용자 단계를 합친다. `authoredBy==='user'` 는 목록에 없어도 지우지 않는다 — 앞 이웃 뒤에, 없으면 꼬리에. */
export function mergeGoalSteps(
  incoming: SessionGoalStep[],
  existing: SessionGoalStep[],
): SessionGoalStep[] {
  // §5.5 #17-17 ⑰(b) — 세션이 사용자 단계까지 **통째로** 다시 신고하면(규약 "목록 전체를 통째로") 본문 일치로
  //   같은 id 가 `incoming` 에 이미 실려 온다. 그 단계는 incoming 쪽(갱신된 상태·행 표식)이 진실이라 여기서
  //   다시 꽂지 않는다 — 안 그러면 사용자 단계가 신고마다 한 벌씩 더 붙어 목록이 두 배로 는다(⑪(d) 정정).
  const incomingIds = new Set(incoming.map((s) => s.id));
  const userSteps = existing.filter((s) => s.authoredBy === 'user' && !incomingIds.has(s.id));
  if (userSteps.length === 0) return incoming.slice(0, SESSION_GOAL_STEPS_MAX);

  // 사용자 단계가 원래 어느 단계 **뒤**에 있었는지 기억한다(본문 기준 — id 는 재발급될 수 있다).
  const anchorOf = new Map<string, string | null>();
  for (const step of userSteps) {
    const idx = existing.findIndex((s) => s.id === step.id);
    let anchor: string | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      const prev = existing[i];
      if (prev && prev.authoredBy !== 'user') {
        anchor = prev.text;
        break;
      }
    }
    anchorOf.set(step.id, anchor);
  }

  const merged: SessionGoalStep[] = [];
  const placed = new Set<string>();
  // 맨 앞(앵커 없음)에 있던 사용자 단계 먼저.
  for (const step of userSteps) {
    if (anchorOf.get(step.id) === null) {
      merged.push(step);
      placed.add(step.id);
    }
  }
  for (const step of incoming) {
    merged.push(step);
    for (const userStep of userSteps) {
      if (!placed.has(userStep.id) && anchorOf.get(userStep.id) === step.text) {
        merged.push(userStep);
        placed.add(userStep.id);
      }
    }
  }
  // 앵커가 사라진 것은 꼬리에(사라지게 두지 않는다).
  for (const step of userSteps) {
    if (!placed.has(step.id)) merged.push(step);
  }
  return merged.slice(0, SESSION_GOAL_STEPS_MAX);
}

/**
 * §5.5 #17-28 ⑧(c) · #17-17 ㉑ — 목표 블록의 변하는 절반(매 턴 앞). 지금 값만 — 규칙은 `buildSessionGoalProtocol` 에(여기 두면 이력에 N벌 쌓인다).
 * 목록은 블록 문법 그대로 적어 세션이 옮기게 한다(`[사용자 추가]` 표지는 `stageBlock.ts` 가 버린다). `**목표**:` 줄은 `sessionTitle.ts` 의 닻이라 모양을 지키고 표지는 다음 줄에.
 */
export function buildSessionGoalState(args: {
  /** 최종 목표 한 문장. */
  goalText: string;
  /** 지금까지의 진행률 (0~100). 단계가 있으면 `done/전체` 파생값이다. */
  percent: number;
  /** §5.5 #17-17 — 단계 체크리스트. `kind`·`parallel`·`authoredBy` 를 보여야 모델이 키를 바꿔 붙이거나 행을 풀거나 사용자 단계를 덮지 않는다. */
  steps?: { text: string; status: SessionGoalStepStatus; authoredBy?: 'session' | 'user'; kind?: string; parallel?: boolean }[];
  /** §5.5 #17-17 — 목표 문장의 주인(`user` 면 에이전트가 건드리지 못한다). */
  authoredBy?: 'session' | 'user';
  /** 마지막 진행 신고의 한 줄 근거 (있으면 "직전에 어디까지 왔는지"를 모델이 이어받는다). */
  note?: string;
  /** 목표 문장이 바뀐 횟수 — 바뀌었다는 사실 자체가 모델에게 신호다. */
  revision: number;
  /**
   * §5.5 #17-17 ⑪(i) — 이 프로젝트에 **지금 있는 종류 키**(무대가 그릴 줄 아는 것들). 키만 이어 붙인
   * 한 줄이라 매 턴 실어도 싸다. 없으면 모델은 매번 새 키를 지어내 카드가 흩어진다.
   */
  kinds?: string[];
}): string {
  const { goalText, percent, steps, authoredBy, note, revision, kinds } = args;
  const mark: Record<SessionGoalStepStatus, string> = { done: '[x]', in_progress: '[~]', pending: '[ ]' };
  // 문장의 주인·개정 횟수는 괄호 한 줄로 — 뜻("바꾸지 마라"·"예전 판본은 잊어라")은 규약이 말한다.
  const tags = [
    authoredBy === 'user' ? '사용자가 고친 문장 — 그대로' : '',
    revision > 0 ? `${revision}번 바뀜 — 지금 문장만 유효` : '',
  ].filter(Boolean);
  const tagLine = tags.length > 0 ? `\n(${tags.join(' · ')})` : '';
  const progressLine = `진행률: ${percent}%${note ? ` · 메모: ${note}` : ''}`;
  const list = steps && steps.length > 0
    ? steps
      .map((s, i) => `- ${mark[s.status]} ${i > 0 && s.parallel ? '∥ ' : ''}${s.text}${s.kind ? ` @${s.kind}` : ''}${s.authoredBy === 'user' ? ' [사용자 추가]' : ''}`)
      .join('\n')
    : '(목록 없음 — 도구 쓰기 전에 지금 세워라)';
  const kindsLine = kinds && kinds.length > 0 ? `\n종류: ${kinds.join(' · ')}` : '';
  return `

# 목표 창 (규약은 시스템 프롬프트에)
**목표**: ${goalText}${tagLine}
${progressLine}
${list}${kindsLine}`;
}

/**
 * §5.5 #17-28 ⑧(c)(f) · #17-17 ㉑ — 목표 블록의 안 변하는 절반(규약, `--append-system-prompt` 한 벌 — 사용자 메시지는 압축에 쓸린다).
 * 블록 문법과 규칙 몇 줄만 가르친다(파서 `stageBlock.ts` 는 `glyph`·`scene`·`surface`·`color` 도 받는다).
 * ㉓ 시점을 못 박는다 — "이 턴에"면 턴 끝에 붙여도 된다(2026-09-10 실측: 14분 세션에서 끝나기 37초 전에 한 번).
 * 면제를 특정 도구에 걸지 마라 — 설치본에서 `TodoWrite` 는 발화하지 않는다(실측: 40 세션 0건).
 */
export function buildSessionGoalProtocol(args: {
  serverBase: string;
  serverToken: string;
  agentId: string;
  subAgentId: string;
}): string {
  // 서명은 지킨다(호출부 · 주입원 표가 같은 인자를 넘긴다). REST 폴백 줄은 ㉑ 로 걷어 인자를 쓰지 않는다 —
  // 블록은 `percent:` 까지 말할 수 있어 `/progress` 가 프롬프트에 설 이유가 없다(엔드포인트 자체는 남는다).
  void args;
  return `

# 목표 창
사용자 화면에 이 세션의 목표와 진행 목록이 떠 있고, 매 턴 프롬프트 앞에 그 상태가 붙는다. **목록은 도구를 쓰기 전에 이 턴 첫 답에서 세우고, 단계를 끝낼 때마다 그 자리에서 옮겨라** — 다 끝내고 마지막에 한 번 적는 것은 적지 않은 것과 같다. 작업 장부(\`TaskCreate\`/\`TaskUpdate\`)를 써도 같은 목록으로 흐른다. 갱신은 답 안에 코드블록으로:
\`\`\`vibisual
goal: 한 문장 (바꿀 때만)
- [x] 끝난 단계 @locate
- [~] 하는 중 @change ?
- [~] ∥ 앞 단계와 같은 행 = 병렬(갈라 돌리고, 행이 다 끝나면 한 번에 보고)
- [ ] 아직 @build
note: 한 줄
\`\`\`
- 목록은 통째로 적고 본문·표식(\`∥\`·\`@키\`)은 그대로 옮긴다(같은 본문 = 같은 항목). 실제로 끝난 것만 \`[x]\`, 꼬리 \`?\` 는 확신 낮음. 바뀐 게 없으면 적지 마라 — 표시 전용이다.
- 사용자가 방금 보낸 명령이 목표보다 우선이다. "사용자가 고친 문장"과 \`[사용자 추가]\` 단계는 지우지 말고 그대로 따르라.
- \`@키\` 는 있는 종류(상태의 \`종류:\` 줄)를 먼저 쓴다. 없으면 같은 블록에 \`kind 키: 이름\` 과 들여쓴 \`from: 밑그림\`(${VISUAL_SCENE_TEMPLATES.map((t) => t.name).join('·')}) · \`blurb: 들어설 때 뜨는 한 줄\` 을 적어 만든다.`;
}

/** §5.5 #17-17 — 목표 블록 전량(주입원 표 계측용). 실제로는 상태는 매 턴, 규약은 `--append-system-prompt` 로 갈라 나간다. */
export function buildSessionGoalRules(args: {
  serverBase: string;
  serverToken: string;
  agentId: string;
  subAgentId: string;
  goalText: string;
  percent: number;
  steps?: { text: string; status: SessionGoalStepStatus; authoredBy?: 'session' | 'user'; kind?: string; parallel?: boolean }[];
  authoredBy?: 'session' | 'user';
  note?: string;
  revision: number;
  identityFile?: string;
  /** §5.5 #17-17 ⑪(i) — 지금 있는 종류 키(무대가 그릴 줄 아는 것들). */
  kinds?: string[];
}): string {
  return buildSessionGoalState(args) + buildSessionGoalProtocol(args);
}

/** §4 — 좋아요/싫어요를 `# Past User Feedback` 블록으로 매 턴 contextSummary 에 붙인다(싫어요+사유가 먼저). 없으면 빈 문자열. */
export function buildAgentFeedbackBlock(feedbacks: AgentFeedback[]): string {
  if (feedbacks.length === 0) return '';
  const recent = [...feedbacks]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, AGENT_FEEDBACK_DIGEST_MAX);
  const downs = recent.filter((f) => f.verdict === 'down');
  const ups = recent.filter((f) => f.verdict === 'up');
  const lines: string[] = [];
  if (downs.length > 0) {
    lines.push('사용자가 **싫어요**를 준 과거 작업 (같은 실수를 반복하지 마라):');
    for (const f of downs) {
      const what = f.summary.slice(0, 3).join(' / ');
      lines.push(`- ${what}${f.reason ? ` — 사유: ${f.reason}` : ''}`);
    }
  }
  if (ups.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('사용자가 **좋아요**를 준 과거 작업 (이런 방식을 유지하라):');
    for (const f of ups) {
      const what = f.summary.slice(0, 3).join(' / ');
      lines.push(`- ${what}${f.reason ? ` — ${f.reason}` : ''}`);
    }
  }
  return `\n\n# Past User Feedback\n이 프로젝트에서 사용자가 너(이 에이전트)의 과거 작업 결과에 남긴 평가다. 작업 방식 선택에 반영하라.\n${lines.join('\n')}`;
}

/**
 * §4 — CMD 에이전트 카드 신고 마커. 인터랙티브 claude 는 loopback 포트/토큰을 몰라, 이 마커 줄을 찍으면 IDE 터미널 뷰가 카드 엔드포인트로 보낸다.
 * 마커가 있어야 평소 출력의 JSON 을 카드로 오인하지 않는다.
 */
export const VIBISUAL_CARD_SENTINEL = '::VIBISUAL-CARD::';

/** §4 — CMD 에이전트 카드 신고 지시문(`prepareInteractiveRulesDir` 가 CLAUDE.md 에 붙인다). 보내는 조건은 curl 판본과 같게 유지한다. */
export function buildCmdCardProtocolRules(): string {
  const S = VIBISUAL_CARD_SENTINEL;
  return `

# Vibisual 카드 신고 (터미널 한 줄 — 인터랙티브 CMD 전용)
너는 Vibisual IDE 안의 인터랙티브 터미널에서 돈다. 사용자에게 **작업 신고 / 질문 / 검수 요청** 카드를 띄우려면
**터미널 stdout 에 \`${S}\` 로 시작하는 한 줄을 인쇄**하면 된다(예: Bash 도구로 \`echo\`). 그 줄은 IDE 가 캡처해
**카드로 보여준다**(원문 마커 줄은 터미널에서 숨긴다 — 터미널 옆 카드 패널에 색 카드로 렌더) — curl·포트·토큰·agentId 가
필요 없다. **반드시 JSON 은 한 줄**(개행 없이)이어야 하고, 마커 뒤에 곧바로 \`{\` 가 와야 한다.

네 종류 모두 \`kind\` 로 구분한다(발생 조건은 아래를 지켜라 — 매번 보내면 카드가 도배돼 신호가 묻힌다):

1) 작업 신고 — **사용자가 직접 해야 할 일(\`userActions\`: 빌드 실행·에디터 조작·외부 승인 등)이 실제로 생긴 완료**에서만.
\`\`\`bash
echo '${S}{"kind":"report","did":["완료한 일 1","완료한 일 2"],"userActions":["사용자가 직접 해야 할 일 1"],"nextSteps":["다음 단계 1"]}'
\`\`\`
- \`userActions\` 가 비면 보내지 마라. \`did\`/\`userActions\`/\`nextSteps\` 목록을 자연어 본문에 다시 나열하지 마라(카드가 보여준다).

2) 사용자 질문 — 사용자만 아는 값·의도로 막혔을 때만. 질문은 짧게, 배경은 \`note\`. \`prompts\` 는 사용자가 골라 보낼 답을 1인칭으로 **질문마다 2~4개 — 비우지 마라**. 선택형은 실제 대안을 모두 포함하라(A/B 질문에 A만 금지). 의도를 물어도 그럴듯한 답을 초안으로, 비밀값은 지어내지 말고 주는 방법을 답으로.
\`\`\`bash
echo '${S}{"kind":"questions","items":[{"question":"여기서 배포는 테스트 환경인가요, 운영 환경인가요?","header":"대상 환경","prompts":["나는 테스트 환경을 뜻했어.","나는 운영 환경을 뜻했어."]}]}'
\`\`\`

3) 검수 요청 — 사용자가 **지시한 작업(버그 수정·기능 변경 등)을 완료**해, 결과 검수가 필요한 보고에서만.
\`\`\`bash
echo '${S}{"kind":"review","instruction":"받은 지시 한 줄","changes":["무슨 동작을 이렇게 고쳤다 1"],"checkpoints":["사용자가 확인할 검수 포인트 1"]}'
\`\`\`
- \`changes\` 가 비면 보내지 마라.

4) 번호 목록 — 답변에 **여러 항목의 번호/순서 목록**(나열·체크리스트·단계 목록)을 담을 때만. 번호는 IDE 가 매기니 항목 텍스트만.
\`\`\`bash
echo '${S}{"kind":"list","title":"플레이어에게 표시할 것","items":["크로스헤어","인벤토리 바","현장 위험도"]}'
\`\`\`
- \`items\` 가 비거나 1개면 보내지 마라.

5) 서버 iframe — 사용자가 **브라우저로 열어볼 로컬 서버**(dev/정적/게임 프리뷰 등)를 띄웠을 때만. \`url\` 은 포트+경로 포함 정확한 주소. IDE 가 그 URL 로 프리뷰 버블을 띄운다.
\`\`\`bash
echo '${S}{"kind":"iframe","url":"http://127.0.0.1:8777/index.html"}'
\`\`\`
- 서버가 실제로 응답하는 걸 확인한 뒤 보내라(살아있는 서버만 버블이 뜬다). 같은 URL 재신고해도 중복 버블은 안 생긴다.

공통: **단순 완료·일상 대화·조사 답변 등 사용자 손이 필요 없는 보고에선 인쇄하지 마라.** 이 신고는 표시 전용이라
보내든 안 보내든 실제 작업 결과엔 영향이 없다. 카드에 담은 목록을 자연어 본문에 헤딩·목록으로 다시 풀어 쓰지 마라.
**인쇄 순서 — 자연어 설명(짧은 결론·근거)을 먼저 쓴 다음**, 그 보고의 **맨 마지막 동작**으로 1회 인쇄한다. 카드는
**신고된 그 시각의 자리**에 앉으므로 설명보다 먼저 인쇄하면 **카드가 위, 그 카드를 설명하는 내용이 아래**로 뒤집힌다
(읽는 순서는 늘 맥락 → 카드). 인쇄한 뒤에는 **"카드를 확인해 주세요." 한 문장만** 쓰고 끝내라(사용자 언어로) — 설명을
더 붙이면 카드가 다시 중간에 낀다. **그렇다고 비워 두지도 마라**(§5.5 #17-18 ⑦-6) — 비우면 CLI 가 "no visible output"
재촉을 넣고, 그 재촉에 보고를 처음부터 다시 쓰면 카드가 한참 위로 밀린다. 재촉이 와도 보고를 다시 쓰지 말고 그 한 문장만.
**특히 "검수 카드로 보냈습니다" · "작업 신고 카드로 정리해 보냈습니다" 같은 발송 사실 보고를 쓰지 마라**(§5.5 #17-18 ⑦-5) —
카드는 이미 화면에 떠 있어 그 한 줄은 아무것도 더 알려주지 않으면서 카드마다 똑같이 반복된다.

## 더 나은 경로 — 환경변수가 있으면 curl 로 보내라 (§4 CMD 업그레이드 ⑦)
이 터미널에는 Vibisual 이 **loopback 신원**을 환경변수로 실어 준다. \`VIBISUAL_HOOK_TOKEN\` 이 있으면 위 마커 인쇄 대신
**헤드리스 에이전트와 똑같은 카드 엔드포인트**를 직접 호출하는 쪽이 낫다(마커가 화면 리셋·리플로우와 얽히지 않고,
\`agentId\`/\`subAgentId\` 도 환경변수로 이미 정확하다). 발생 조건·순서 규칙은 위와 **완전히 동일**하다.

\`\`\`bash
curl -s -X POST "http://127.0.0.1:$VIBISUAL_HOOK_PORT/api/agent-report" \\
  -H "x-vibisual-hook-token: $VIBISUAL_HOOK_TOKEN" -H 'Content-Type: application/json' --data-binary @- <<JSON
{"agentId":"$VIBISUAL_AGENT_ID","subAgentId":"$VIBISUAL_SUB_AGENT_ID","did":["완료한 일"],"userActions":["사용자가 할 일"]}
JSON
\`\`\`
- 엔드포인트는 \`/api/agent-report\` · \`/api/agent-questions\` · \`/api/agent-review\` · \`/api/agent-list\` · \`/api/agent-iframe\` 다(본문 형식은 위 \`kind\` 별 JSON 에서 \`kind\` 만 뺀 것).
- \`VIBISUAL_HOOK_TOKEN\` 이 **없으면**(구버전·모바일 브리지) 위의 \`${S}\` 마커 인쇄를 그대로 쓴다 — 둘 다 같은 카드를 띄운다.
- 토큰 헤더가 없으면 401 이다. 실패해도 무시하고 자연어 보고는 그대로 진행하라(표시 전용).`;
}

/** Auto Agent 기본 rules(덮어쓸 수 있다) — 직접 작업하지 않고 생성·디스패치·요약 수령만. */
export const AUTO_AGENT_DEFAULT_RULES = `# Role: Auto Agent (Vibisual 메타 에이전트)

이 에이전트는 **다른 커스텀 에이전트들을 자동 생성·연결·디스패치하는 메타 역할**입니다.

## 책임
- 사용자 자연어 요청을 받아 적절한 토폴로지(pipeline/team/ralph/autopilot)를 선택
- 역할 카탈로그(planner/architect/coder/reviewer/tester/...)에서 필요한 에이전트들을 spawn
- 노드 간 Task Edge 자동 연결
- 사용자 메시지를 엔트리 노드에 forward
- 서브 군 작업 완료 시 1~2문 요약을 사용자에게 보고

## 금지
- 자신은 코드를 직접 수정·탐색하지 않습니다 (메타 역할만)
- 서브 에이전트들이 만든 산출물을 임의로 수정하지 않습니다
- 사용자 명시 승인 없이 서브 군을 삭제·재구성하지 않습니다
`;

// §4 모바일 웹 접속 모드

/** 페어링 코드 자릿수 — 데스크톱 모달에 표시되고 폰 브라우저 첫 접속 시 입력한다. */
export const MOBILE_PAIR_CODE_LENGTH = 6;

/** 페어링 실패 허용 횟수 — 초과 시 코드 재생성 전까지 페어링 잠금(무차별 대입 방지). */
export const MOBILE_PAIR_MAX_ATTEMPTS = 10;

/** 동시 유지되는 페어링 세션(기기) 수 상한 — 초과 시 가장 오래된 세션부터 밀어낸다. */
export const MOBILE_SESSION_MAX = 5;

/** 페어링 성공 시 폰 브라우저에 심는 HttpOnly 세션 쿠키 이름. */
export const MOBILE_SESSION_COOKIE = 'vibisual_mobile_session';

// §4 UPnP 외부 개방 + 보안 강화

/** 외부 개방 때 페어링 코드 길이(영숫자) — 공인망이라 무차별 대입 내성이 필요하다. */
export const MOBILE_EXTERNAL_PAIR_CODE_LENGTH = 12;

/** 한 IP 가 페어링 실패 한도를 넘겼을 때 차단하는 시간(ms). 소유자 lockout 없이 공격자만 격리. */
export const MOBILE_PAIR_BAN_MS = 10 * 60 * 1000;

/** UPnP 포트 매핑 임대 시간(초). 이 절반 주기로 갱신해 공유기가 매핑을 지우지 않게 한다. */
export const MOBILE_UPNP_LEASE_S = 3600;

// §4 QR 페어링 티켓

/**
 * QR 페어링 티켓 수명(ms). 발급 후 이 시간이 지나면 스캔해도 무효 —
 * 화면에 잠깐 띄우는 용도라 짧게 잡는다(사진에 찍혀 남아도 곧 죽는다).
 */
export const MOBILE_QR_TICKET_TTL_MS = 3 * 60 * 1000;

/** QR 티켓 토큰 바이트 수(hex 인코딩 전) — 3분 안에 맞힐 수 없는 수준. */
export const MOBILE_QR_TOKEN_BYTES = 24;

/** QR 한 장의 페어링 기기 수 상한 — QR 은 화면 공유·사진으로 새기 쉽다. 닿으면 티켓을 즉시 폐기한다(남기면 만료까지 시도할 수 있다). */
export const MOBILE_QR_MAX_USES = 3;

/** QR 에 담기는 딥링크 경로. `?t=<token>` 을 붙여 스캔 즉시 세션 쿠키를 받는다. */
export const MOBILE_QR_PATH = '/mobile/qr';

/** QR 딥링크의 토큰 쿼리 파라미터 이름. */
export const MOBILE_QR_PARAM = 't';

// ─── §4 (판올림 번호 발급 대기) 접속 주소의 정체 ──────────────────────────────

/**
 * 어댑터 이름 사전의 한 줄. `label` 은 i18n 키가 아니라 제품 이름 그대로(사용자가 본 글자와 같아야 한다).
 * `test` 는 소문자 이름에 맞추고, OS 마다 다른 이름(Windows `Tailscale` · macOS `utun3` · Linux `tailscale0`)을 한 줄에 모은다.
 */
export interface MobileAdapterPattern {
  /** 어댑터 이름(소문자)에 대한 판정. */
  readonly test: RegExp;
  /** 화면에 그대로 띄울 제품 이름. */
  readonly label: string;
}

/** VPN 어댑터 사전(폰이 같은 망이면 열린다). 순서 = 우선순위. 끝의 `utun`/`tun` 은 macOS·Linux 공용 이름이라 `label` 을 비운다(종류만 말한다). */
export const MOBILE_VPN_ADAPTERS: readonly MobileAdapterPattern[] = [
  { test: /tailscale/, label: 'Tailscale' },
  { test: /zerotier|^zt[0-9a-z]{6,}$/, label: 'ZeroTier' },
  { test: /wireguard|^wg\d+$/, label: 'WireGuard' },
  { test: /nordlynx|nordvpn/, label: 'NordVPN' },
  { test: /protonvpn|proton vpn/, label: 'Proton VPN' },
  { test: /mullvad/, label: 'Mullvad' },
  { test: /twingate/, label: 'Twingate' },
  { test: /zscaler/, label: 'Zscaler' },
  { test: /anyconnect|cisco secure client/, label: 'Cisco AnyConnect' },
  { test: /globalprotect/, label: 'GlobalProtect' },
  { test: /hamachi/, label: 'Hamachi' },
  { test: /radmin/, label: 'Radmin VPN' },
  { test: /openvpn|tap-windows/, label: 'OpenVPN' },
  { test: /^(?:utun|tun|ppp|ipsec)\d*$/, label: '' },
];

/** 가상 어댑터 사전(VM·컨테이너·WSL) — 폰에서는 안 열린다. 감추지 않고(진짜로 되는 경우까지 사라진다) "안 됩니다" 쪽으로 접는다. */
export const MOBILE_VIRTUAL_ADAPTERS: readonly MobileAdapterPattern[] = [
  { test: /\bwsl\b/, label: 'WSL' },
  { test: /vethernet|hyper-v|default switch/, label: 'Hyper-V' },
  { test: /vmware|^vmnet\d*$|^vmenet\d*$/, label: 'VMware' },
  { test: /virtualbox|^vboxnet\d*$/, label: 'VirtualBox' },
  { test: /parallels|^prl_/, label: 'Parallels' },
  { test: /^docker\d*$|^br-[0-9a-f]{12}$/, label: 'Docker' },
  { test: /^virbr\d*|libvirt/, label: 'libvirt' },
  { test: /^(?:veth|cni|flannel|podman|lxcbr|cali)/, label: 'Container' },
  { test: /^bridge\d+$/, label: '' },
  { test: /^(?:npcap|loopback)/, label: '' },
  { test: /bluetooth/, label: 'Bluetooth' },
];

/** 완료음 창 간 중복 차단(ms) — WS 를 듣는 창마다 울리므로 먼저 울린 창이 localStorage 에 시각을 남긴다(막히면 재생, fail-open). */
export const COMPLETION_CHIME_DEDUPE_MS = 1_500;

/**
 * §5.10 v2 (C) — 회상 발췌에서 가리는 것(다른 세션 모델에게 가므로 안 가리면 시크릿 배포 경로가 된다). 오탐이 더 나빠 셋만:
 * ① 헤더 이름 뒤 값 ② 48자 이상 연속 hex(토큰 = `randomBytes(24)`, 커밋 해시 40자는 일부러 통과) ③ 접두사가 뚜렷한 API 키.
 */
export const SECRET_REDACTION_PATTERNS: readonly RegExp[] = [
  /(x-vibisual-hook-token\s*:\s*)[^\s"'\\]+/gi,
  /\b[0-9a-f]{48,}\b/gi,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
];

/** 가린 자리에 남기는 표시 — 지워진 것이 아니라 가려진 것임을 읽는 쪽이 알아야 한다. */
export const SECRET_REDACTION_MASK = '[redacted]';

/** 위 패턴을 가린다(순수 함수). 헤더는 이름을 남기고 값만 — 무엇이 가려졌는지 알아야 한다. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_REDACTION_PATTERNS) {
    // 전역 플래그가 붙은 정규식은 `lastIndex` 가 남으므로 매번 초기화한다(같은 배열을 재사용한다).
    re.lastIndex = 0;
    // 그룹 없는 정규식이면 `String.replace` 의 둘째 인자는 일치 위치(number)다 — 문자열일 때만 접두로 쓴다(아니면 `token=6[redacted]`).
    out = out.replace(re, (_match: string, prefix: unknown) =>
      typeof prefix === 'string' ? `${prefix}${SECRET_REDACTION_MASK}` : SECRET_REDACTION_MASK);
  }
  return out;
}

// 플러그인 커널 (§5.11)

/** 호스트가 슬롯을 연 기여 종류. 목록 밖 기여는 거부가 아니라 "미지원" 표시다. 슬롯을 열 때 여기 한 줄 추가. */
export const PLUGIN_SUPPORTED_CONTRIBUTIONS: readonly PluginContributionKind[] = [
  'bubbleBadge',
  'panelSection',
  'settingsSection',
  // 헤더 기여 — 동작을 가질 수 있는 슬롯이며, 동작은 호스트가 연 `PluginActions` 만.
  'headerItem',
  // 집행 슬롯 — 보여 주기가 아니라 에이전트가 실제로 그렇게 일하게 하는 자리(매 턴 프롬프트 블록).
  'agentPrompt',
];

/** 플러그인 id 규약 — kebab-case. 네임스페이스 4종(REST·WS·버블타입·설정키)의 공통 키. */
export const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** 플러그인 REST 기여의 유일한 마운트 지점 — `/api/plugins/<id>/*` 밖으로 나갈 수 없다. */
export const PLUGIN_API_PREFIX = '/api/plugins';

/** §5.13 (P) — 내부 앱 REST 네임스페이스(`/api/app/<앱id>/…`, 플러그인과 같은 규약). 코어가 앱 이름 없이 앱 경로를 판정한다. */
export const APP_API_PREFIX = '/api/app';

/**
 * §5.13 (T-3)(T-11) ② — 내부 앱 iframe 정적 콘텐츠 경로. 패키지 앱은 `file://` 출처라 iframe 의 `/api/…` 가 깨져 `vibproxy://proxy` 로 낸다.
 * vibproxy 허용 목록·프레임 이동 금지가 이 판정 하나를 쓴다. API 는 이 길로 내지 않는다.
 */
export const APP_CONTENT_SEGMENT = 'content';

const APP_CONTENT_PATH_RE = /^\/api\/app\/[a-z0-9][a-z0-9-]{0,40}\/content\//;

/** 경로(pathname)가 내부 앱의 정적 콘텐츠인가. 쿼리·해시는 떼고 준다. */
export function isAppContentPath(pathname: string): boolean {
  return APP_CONTENT_PATH_RE.test(pathname);
}

// ─── §5.4 #36 전환과 연결 — 에이전트 말풍선 · 위성줄 · 꽃잎 고르기 ─────────────

/**
 * §5.4 #31 (K) · #36 (A)(B) — 움직임 줄이기에서 도는 움직임(선 흐름·궤도·구슬)을 끄지 않고 이만큼 느리게 — 끄면 일하는 선이 쉬는 선과 같아진다.
 * CSS 로만 도는 `.agent-orbit-spin`·`.ref-bead-flow` 는 곱한 값을 `*ReducedMs` 와 `index.css` 에 함께 적는다.
 */
export const REDUCED_MOTION_LOOP_SLOWDOWN = 1.5;

/**
 * §5.4 #36 (A) — 에이전트 말풍선 기하(캔버스 px). 원은 제자리, 왼쪽에 말풍선. 고정 크기다 — 물리·선 끝점·원 중심이 이 값으로 계산돼 자라면 흔들린다.
 * 원 중심 = `(balloonWidth + balloonGap + discSize/2, height/2)`, `width` = 중심 + 궤도 반지름 + 위성 손 자리 반(`agentCardDiscCenter` — 어긋나면 위성이 잘린다).
 */
export const AGENT_CARD = {
  /** 노드 전체 = 말풍선 236 + 틈 20 + 원 60 + (궤도 − 원 반지름 10) + 위성 손 자리 반 12. */
  width: 338,
  /** 노드 전체 높이 = 말풍선 높이. 원은 세로 가운데. */
  height: 200,
  /** 말풍선 판의 폭 — 노드 왼쪽 끝부터. */
  balloonWidth: 236,
  /** 말풍선 모서리 반경. */
  balloonRadius: 18,
  /** 말풍선·꼬리의 바탕 — 꼬리가 말풍선 테두리를 덮어 한 몸으로 보이려면 불투명해야 한다. */
  balloonFill: '#0A0C12',
  /** 말풍선 오른쪽 끝과 원 사이의 틈 — 꼬리가 이 틈을 건너 원을 가리킨다. */
  balloonGap: 20,
  /** 말풍선 꼬리(45° 돌린 정사각)의 한 변. 끝이 궤도에 닿을 만큼. */
  tailSize: 12,
  /** 원(접혀 남은 버블)의 지름. */
  discSize: 60,
  /** 궤도 반지름(원 중심에서). 위성 손잡이와 이어진 앱 점이 이 위에 앉는다. */
  orbitRadius: 40,
  /** 위성 손잡이 — 보이는 점의 지름과 누르는 자리의 지름. */
  satelliteSize: 12,
  satelliteHitSize: 24,
  /** 위성 손잡이가 앉는 궤도 각(도, 화면 좌표 — 0 = 오른쪽, 음수 = 위). */
  satelliteAngleDeg: -40,
  /** 이어진 앱 노드를 궤도에 찍는 점 — 지름·최대 개수·첫 각·간격(도). 손잡이 아래쪽으로 늘어선다. */
  orbitDotSize: 6,
  orbitDotMax: 5,
  orbitDotStartDeg: 14,
  orbitDotStepDeg: 17,
  /** 에이전트가 도는 동안 궤도가 한 바퀴 도는 시간(ms). `index.css` 의 `.agent-orbit-spin` 과 같은 값. */
  orbitSpinMs: 14000,
  /** 움직임 줄이기에서 궤도가 한 바퀴 도는 시간(ms) — 멈추지 않고 `REDUCED_MOTION_LOOP_SLOWDOWN` 배 느리게. `index.css` 와 같은 값. */
  orbitSpinReducedMs: 14000 * REDUCED_MOTION_LOOP_SLOWDOWN,
  /** 이름이 궤도 아래로 떨어지는 간격. */
  labelGap: 4,
  /** 위성을 누른 뒤 이만큼(px) 움직여야 끌기다 — 못 넘으면 "누름"(그 자리에 꽃). 손떨림이 줄이 되지 않게. */
  handleDragThreshold: 4,
  /** 위성을 눌러 만든 노드가 노드 오른쪽 끝에서 떨어지는 거리(캔버스 px). */
  spawnGap: 72,
  /** 같은 말풍선에서 거듭 눌러 만든 노드끼리 세로로 띄우는 간격(캔버스 px). */
  spawnStackGap: 16,
  /** 말풍선이 원 쪽에서 펴지는 시간(ms). `prefers-reduced-motion` 이면 0. */
  morphMs: 240,
} as const;

/** §5.4 #36 (B) — 앱 노드 하나가 참조할 수 있는 에이전트 수 상한. */
export const APP_BUBBLE_LINK_MAX = 8;

/** §5.13 (L) — 앱 노드가 가리키는 작업 문서 열쇠(`AppBubble.ref`) 길이 상한. 앱이 짓는 id 라 이 안에 든다. */
export const APP_BUBBLE_REF_MAX = 200;

/** §5.4 #36 (B) — 위성줄 모양(파일 선·Task Edge 와 일부러 다르다). 구슬은 `stroke-dasharray` 로 path 하나 — 원 요소·필터·마스크 ❌(#31 (K)). 처짐 = 길이 × `sagRatio`. */
export const REF_LINK_STYLE = {
  /** 구슬 지름과 구슬 중심 사이 간격. 흐름 애니메이션 한 칸이 이 간격이다(`index.css` `.ref-bead-flow`). */
  beadSize: 4,
  beadGap: 10,
  /** 구슬 불투명도 — 평시 · 손을 올렸거나 끄는 중. */
  beadOpacity: 0.85,
  beadActiveOpacity: 1,
  /** 구슬을 꿴 실의 두께·불투명도. */
  threadWidth: 1.25,
  threadOpacity: 0.3,
  threadActiveOpacity: 0.55,
  /** 손을 올릴 자리(보이지 않는 넓은 선)의 두께 — 가는 줄만으로는 [연결 끊기]를 부르기 어렵다. */
  hitWidth: 16,
  /** 처짐 비율·하한·상한(px). */
  sagRatio: 0.12,
  sagMin: 6,
  sagMax: 56,
  /** 도는 동안 구슬이 한 칸(beadGap) 흐르는 시간(ms). `index.css` 의 `.ref-bead-flow` 와 같은 값. */
  flowMs: 600,
  /** 움직임 줄이기에서 구슬이 한 칸 흐르는 시간(ms) — 멈추지 않고 `REDUCED_MOTION_LOOP_SLOWDOWN` 배 느리게. `index.css` 와 같은 값. */
  flowReducedMs: 600 * REDUCED_MOTION_LOOP_SLOWDOWN,
  /** 앱 쪽 끝의 도킹 고리 — 반지름·두께. 끄는 중 앱 노드 위에 있으면 `dockActiveRadius`. */
  dockRadius: 4.5,
  dockActiveRadius: 7,
  dockStroke: 1.5,
  /** 고리 속 색(캔버스 바탕과 같은 어둠 — 고리가 구멍처럼 보이게). */
  dockFill: '#0A0C12',
  /** 출발 색을 모를 때(에이전트 색 미상). */
  fallbackColor: '#60A5FA',
} as const;

/**
 * §5.4 #36 (B) — 꽃잎 고르기. 위성을 빈 곳에 놓거나 눌렀을 때 앱들이 그 자리를 가운데로 부채꼴로 핀다.
 * 꽃잎은 끌어온 방향 **앞쪽**으로 펴진다(돌아오는 쪽 ❌ — 줄과 겹친다). 값은 화면 px 다(줌과 무관하게 같은 크기).
 */
export const REF_BLOOM = {
  /** 가운데에서 꽃잎 중심까지. */
  radius: 64,
  /** 꽃잎(원형 단추) 지름. */
  seedSize: 40,
  /** 꽃잎 사이 각(도). 앱이 많으면 `maxSpreadDeg` 안에서 좁아진다. */
  stepDeg: 40,
  maxSpreadDeg: 160,
  /** 화면 가장자리와 띄우는 여백. */
  margin: 12,
  /** 꽃잎이 차례로 피는 간격(ms). */
  staggerMs: 28,
  /** 가운데 고리와 그 아래(꽃잎이 아래로 피면 위) 이름 한 줄 사이. */
  captionGap: 12,
  /** 눌러서 연 꽃의 가운데가 궤도 바깥에서 떨어지는 거리. */
  besideGap: 36,
  /** §5.4 #36 (F) — 고른 노드가 화면 밖으로 삐져 서면 카메라를 밀어 들일 때 화면 가장자리와 띄우는 여백(px). */
  revealMargin: 24,
  /** 그 밀어 들이기의 이동 시간(ms). 줌은 그대로다. */
  revealMs: 240,
} as const;

/** §5.4 #36 (F) — 낙관 생성 노드를 붙드는 시간(ms) — 먼저 출발한 스냅샷에 없어 한 프레임 사라지지 않게. 지나도 없으면 걷는다. */
export const APP_BUBBLE_PENDING_MS = 8000;

/**
 * §5.4 #36 (F) — 앱 위성 화면의 미리보기. 앱이 레지스트리 `thumbnail` 로 굽고 코어가 기억한다.
 * 비용은 "보이는 화면만 · 한 번 굽고 캐시 · 동시 건수 상한" 셋으로 묶는다.
 */
export const APP_THUMB = {
  /** 미리보기 LRU 수(밀려나면 blob URL 회수). 파일 버블 얼굴도 함께 쓴다(§5.1 #2-1 (A)) — 작게 구워 상한을 넉넉히 둬도 된다. */
  cacheMax: 120,
  /** 동시에 굽는 수 — 영상 디코더·WebGL 문맥이 한꺼번에 뜨지 않게. */
  concurrency: 2,
  /** 화면 크기에 곱해 굽는 배율의 상한(고해상 화면에서 흐리지 않게, 그 이상은 낭비). */
  pixelRatioMax: 2,
  /** 소리 파형을 그리려고 통째로 받는 파일의 상한(bytes). 넘으면 파형 없이 아이콘. */
  audioMaxBytes: 48_000_000,
  /** 3D 정지 화면을 찍으려고 통째로 받는 모델의 상한(bytes). */
  modelMaxBytes: 64_000_000,
  /** 파형 막대 수. */
  peakColumns: 48,
  /** 영상 대표 프레임 시각 = 길이 × 이 비율, 최대 `videoSeekMaxSec` 초(첫 프레임은 검은 화면이 흔하다). */
  videoSeekRatio: 0.1,
  videoSeekMaxSec: 1,
  /** 영상 읽기 구간(bytes). 디코더가 끝이 열린 구간(`bytes=N-`)을 청하는데 패키지 앱 fetch 는 응답을 IPC 한 번에 싣는다 — 묶지 않으면 파일 전체가 건너온다. */
  videoChunkBytes: 1_048_576,
  /** 한 장을 굽는 시간 상한(ms). 넘으면 못 구운 것으로 치고 줄을 비운다(멈춘 디코더가 자리를 영영 쥐지 않게). */
  renderTimeoutMs: 20_000,
  /**
   * §5.4 #36 (G) — 굽는 크기를 이 단위(캔버스 px)로 올려 잡는다. 노드 크기를 바꿀 때마다 1px 단위로 다시 굽지 않게 —
   * 같은 칸 안에서 바꾼 크기는 앞서 구운 한 장을 그대로 늘려 쓴다.
   */
  bakeStep: 64,
} as const;

/** §5.13 (X) 39-3 — 늦은 화면(동적 청크)을 기다리는 동안의 뼈대. `delayMs` 를 넘길 때만 띄운다(바로 뜨는 화면 앞에서 번쩍이지 않게). */
export const APP_SHELL_SKELETON = {
  delayMs: 120,
} as const;

/** §5.4 #36 (G) — 앱 노드 크기 하한(형태마다)·상한(캔버스 px). 서버도 상한으로 자른다(PATCH 가 캔버스를 덮는 노드를 만들지 않게). */
export const APP_NODE_RESIZE = {
  nameplateMinWidth: 64,
  nameplateMinHeight: 40,
  screenMinWidth: 176,
  screenMinHeight: 120,
  maxWidth: 1280,
  maxHeight: 960,
} as const;

/**
 * §5.4 #36 (G) — 앱 위성 화면 안에서 바로 하는 조작(재생·돌려 보기·맞춤). 무엇을 하는지는 앱이 레지스트리 `canvasFace` 로
 * 선언하고, 비용의 한도는 여기 한 곳에 둔다.
 */
export const APP_CANVAS_FACE = {
  /**
   * 캔버스에서 바로 틀려고 **통째로 받는** 영상·소리 파일의 상한(bytes). 엘리먼트의 `/api` 요청은 패키지 앱에서 비므로
   * (§5.13 (R-5)) fetch 로 받아 blob URL 로 건다 — 넘으면 받지 않고 "에디터에서 여세요"로 안내한다.
   */
  playMaxBytes: 200_000_000,
  /** 3D 를 돌려 본 뒤 손을 떼고 이만큼(ms) 지나면 WebGL 문맥을 돌려주고 그 각도의 한 장을 정지 화면으로 남긴다. */
  liveIdleMs: 6000,
  /** 끌어 돌리는 감도(도/px — **화면** px 기준이라 캔버스를 키우거나 줄여도 같은 손맛이다). */
  orbitDegPerPx: 0.6,
  /** 위아래로 돌릴 수 있는 한계(도). 넘으면 위아래가 뒤집혀 보인다. */
  orbitPitchLimitDeg: 85,
  /** 자동 회전 속도(도/초). */
  spinDegPerSec: 36,
  /** 이미지 복사가 끝났다는 표시(✓)를 남기는 시간(ms). */
  copiedFlashMs: 1400,
  /** §5.13 (R-10) — 편집 원본을 비추는 노드가 원본 머리(판 번호)만 묻는 간격(ms). 본문은 판이 바뀔 때만 읽는다. */
  sourcePollMs: 5000,
} as const;

/** §5.4 #36 (H) ② — "연결된 것 위주" 보기에서 에이전트 활동 선을 흐리는 배율. 지우지 않는다("만"이 아니다). #31 강조 배율과 곱해진다. */
export const LINK_VIEW = {
  dimOpacity: 0.18,
  /** 누른 칸을 화면이 붙드는 최대 시간(ms). PATCH 답 뒤 스냅샷이 같은 값을 실으면 먼저 놓는다 — 서버가 끝내 다른 값을 말할 때의 안전망(`APP_BUBBLE_PENDING_MS` 와 같은 창). */
  pendingMs: 8000,
} as const;

/** §5.4 #36 (H) ①-2 — [이전 연결 다시 보기]가 기억하는 연결 한도(§3.2.3). 에이전트마다 한 벌, 넘치면 오래 안 만진 것부터 버린다. */
export const AGENT_LINK_RECORD = {
  /** 한 에이전트가 기억하는 버블 수 — 파일 하나는 그 폴더 사슬까지 몇 장이다. */
  maxEntries: 300,
  /** 도메인 버블 하나가 같이 기억하는 웹 이력 수(버블의 기본 상한과 같다). */
  maxWebEntries: 20,
} as const;

/** §5.4 #36 (H) ③ — 결과 전달로 바뀌기 전 파일을 노드에 남기는 수(지난 결과, 최근 것부터). */
export const APP_BUBBLE_PAST_FILE_MAX = 6;

/** §5.4 #36 (H) ③ — 앱 노드 아래 구슬 줄(연결된 것). 무엇을 띄울지는 앱의 `linkedItems`, 크기·간격·주기 한도는 여기. 길이는 캔버스 px. */
export const APP_LINKED_ITEMS = {
  /** 구슬 지름. */
  beadSize: 22,
  /** 구슬 사이(테두리 사이) 간격. */
  beadGap: 6,
  /** 묶음(장면 · 소재 · 지난 결과) 사이에 더 띄우는 간격. */
  groupGap: 10,
  /** 노드 아래 가장자리에서 구슬 줄(구슬 중심선)까지. */
  dropY: 24,
  /** 한 줄에 보이는 구슬 수 상한 — 넘치면 마지막 자리가 `+N` 이다. */
  maxVisible: 10,
  /** 노드가 마운트된 동안 앱에 다시 묻는 주기(ms). 영상은 판본만 묻고 바뀔 때만 문서를 읽는다. */
  pollMs: 5000,
  /** 한 번 묻는 시간 상한(ms) — 넘으면 그 회차는 건너뛰고 앞 결과를 그대로 둔다. */
  readTimeoutMs: 8000,
  /** 읽은 결과를 기억하는 노드 수(화면 밖에서 돌아오면 바로 보이게 — 넘치면 오래 안 본 것부터). */
  cacheMax: 64,
  /** 구슬을 꿴 실의 불투명도. */
  threadOpacity: 0.35,
} as const;

// §5.5 #17-20 디버그·실행 런처

/** 한 프로젝트에서 목록에 올릴 실행 구성 상한(스캔 폭주 가드). */
export const RUN_CONFIG_MAX = 60;

/** 실패한 실행을 에이전트에게 넘길 때 함께 보낼 스크롤백 꼬리 줄 수. */
export const RUN_FAILURE_TAIL_LINES = 80;

/** 출력 패널이 보여 줄 수 있는 최대 줄 수(이보다 오래된 줄은 앞에서 버린다). */
export const RUN_OUTPUT_BUFFER_LINES = 2000;

/** 출력이 쏟아질 때 화면 갱신 간격(ms) — 바이트마다 리렌더하지 않기 위한 목. */
export const RUN_OUTPUT_FLUSH_MS = 150;

/** 디버거가 붙을 포트를 고르기 시작하는 자리. 쓰는 중이면 하나씩 올린다. */
export const DEBUG_PORT_BASE = 9229;

/** `DEBUG_PORT_BASE` 부터 이 개수까지만 훑는다(무한 탐색 방지). */
export const DEBUG_PORT_SCAN_MAX = 40;

/** §5.5 #17-20 ③ — 런타임별 디버그 실행 변환 규칙(`match` 로 알아보고 `apply` 가 인자를 얹는다). 런타임 추가는 한 줄(§3.3). */
export interface DebugLaunchRecipe {
  runtime: RunRuntime;
  /** 명령 문자열을 보고 이 런타임인지 판정. */
  match: (command: string) => boolean;
  /**
   * 디버그로 켜는 방법. 얹을 수 없으면 null(그대로 실행하고 화면에 그 사실을 적는다).
   * 환경변수는 셸 문법 대신 `env` 로 돌려준다(PTY spawn env 라 Windows·POSIX 공통). shared 라 `process.platform` 을 읽지 않는다.
   */
  apply: (command: string, port: number) => { command?: string; env?: Record<string, string> } | null;
  /** 화면에 뜨는 설명 i18n 키. */
  noteKey: string;
}

/** 첫 토큰(실행 파일) 바로 뒤에 인자를 끼워 넣는다 — `node app.js` → `node --inspect app.js`. */
function insertAfterFirstToken(command: string, injected: string): string {
  const trimmed = command.trimStart();
  const lead = command.slice(0, command.length - trimmed.length);
  const spaceAt = trimmed.search(/\s/);
  if (spaceAt < 0) return `${lead}${trimmed} ${injected}`;
  return `${lead}${trimmed.slice(0, spaceAt)} ${injected}${trimmed.slice(spaceAt)}`;
}

export const DEBUG_LAUNCH_RECIPES: readonly DebugLaunchRecipe[] = [
  {
    runtime: 'node',
    // `node x.js` 는 물론 npm/pnpm/yarn 스크립트도 포함 — 후자는 NODE_OPTIONS 로 자식까지 닿는다.
    match: (c) => /\b(node|npm|pnpm|yarn|bun|npx|tsx|vite|next|nest)\b/i.test(c),
    apply: (c, port) => {
      if (/^\s*node\b/i.test(c)) return { command: insertAfterFirstToken(c, `--inspect-brk=${port}`) };
      // 패키지 매니저 경유는 실행 파일이 우리 손에 없으므로 환경변수로 자식 node 에 건다.
      return { env: { NODE_OPTIONS: `--inspect-brk=${port}` } };
    },
    noteKey: 'ide.debug.note.node',
  },
  {
    runtime: 'python',
    match: (c) => /\b(python|python3|py|uvicorn|flask|manage\.py)\b/i.test(c),
    apply: (c, port) => {
      if (!/^\s*(python3?|py)\b/i.test(c)) return null;
      return { command: insertAfterFirstToken(c, `-m debugpy --listen ${port} --wait-for-client`) };
    },
    noteKey: 'ide.debug.note.python',
  },
  {
    runtime: 'go',
    match: (c) => /\bgo\s+(run|test|build)\b/i.test(c),
    apply: (c, port) => {
      const target = c.replace(/^\s*go\s+(run|test|build)\s*/i, '').trim();
      return { command: `dlv debug --headless --listen=:${port} --api-version=2 ${target}`.trim() };
    },
    noteKey: 'ide.debug.note.go',
  },
  {
    runtime: 'rust',
    match: (c) => /\bcargo\s+(run|test)\b/i.test(c),
    // rust 는 실행 파일을 먼저 만들어야 디버거가 붙는다 — 명령 변환으로는 못 하므로 위임한다.
    apply: () => null,
    noteKey: 'ide.debug.note.rust',
  },
  {
    runtime: 'dotnet',
    match: (c) => /\bdotnet\b/i.test(c),
    apply: () => null,
    noteKey: 'ide.debug.note.dotnet',
  },
  {
    runtime: 'java',
    match: (c) => /\b(java|gradlew?|mvn)\b/i.test(c),
    apply: (c, port) => {
      if (!/^\s*java\b/i.test(c)) return null;
      return { command: insertAfterFirstToken(c, `-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=${port}`) };
    },
    noteKey: 'ide.debug.note.java',
  },
  {
    runtime: 'unreal',
    match: (c) => /(UnrealEditor|UE4Editor|\.uproject|UnrealBuildTool|Build\.bat|RunUAT)/i.test(c),
    /**
     * `cppvsdbg` 는 재배포 불가(⑦) — 붙을 수 있게 띄우기까지만 하고, 붙이기는 서버가 에디터 pid 를 JIT 디버거에 넘긴다(`port` 없음).
     * `-WaitForDebugger` = 붙을 때까지 초기화 직전 대기(시작 코드 중단점용) · `-stdout -FullStdOutLogOutput` = 로그를 우리 출력 패널로.
     */
    apply: (c) => {
      const flags = ['-WaitForDebugger', '-stdout', '-FullStdOutLogOutput', '-log'];
      const missing = flags.filter((f) => !new RegExp(`\\s${f}\\b`, 'i').test(c));
      return { command: missing.length > 0 ? `${c} ${missing.join(' ')}` : c };
    },
    noteKey: 'ide.debug.note.unreal',
  },
];

/** 명령을 보고 런타임을 고른다. 표에 없으면 'other'. */
export function detectRunRuntime(command: string): RunRuntime {
  for (const recipe of DEBUG_LAUNCH_RECIPES) {
    if (recipe.match(command)) return recipe.runtime;
  }
  return 'other';
}

/** §5.5 #17-20 ③ — `config.debugCommand`(사용자·launch.json)가 최우선. 변환 못 하면 `note: 'unsupported'` 로 원본을 돌려주고 화면이 그렇게 적는다(디버그인 척하지 않는다). */
export function buildDebugCommand(
  config: Pick<RunConfig, 'command' | 'debugCommand' | 'runtime'>,
  port: number,
): { command: string; env?: Record<string, string>; noteKey: string | null; applied: boolean } {
  const explicit = config.debugCommand?.trim();
  if (explicit) return { command: explicit, noteKey: null, applied: true };
  const recipe = DEBUG_LAUNCH_RECIPES.find((r) => r.runtime === config.runtime);
  if (!recipe) return { command: config.command, noteKey: 'ide.debug.note.unsupported', applied: false };
  const applied = recipe.apply(config.command, port);
  if (!applied) return { command: config.command, noteKey: recipe.noteKey, applied: false };
  return {
    command: applied.command ?? config.command,
    ...(applied.env ? { env: applied.env } : {}),
    noteKey: recipe.noteKey,
    applied: true,
  };
}

// ─── §5.5 #17-20 ⑩ — 공통 디버그 층: 런타임 → 붙는 법 ───
// 띄우는 표(`DEBUG_LAUNCH_RECIPES`, 셸 명령)와 축이 달라(프로토콜) 갈라 둔다. 한 줄 더하면 그 런타임이 같은 디버그 화면을 얻는다.

/** DAP 어댑터 인자의 자리 표시자 — 매니저가 실제로 고른 포트로 바꿔 넣는다. */
export const DEBUG_ADAPTER_PORT_TOKEN = '{{adapterPort}}';

/** TCP 어댑터를 띄울 때 포트를 고르기 시작하는 자리(디버기 포트대와 겹치지 않게 위쪽). */
export const DEBUG_ADAPTER_PORT_BASE = 9430;

/** 어댑터가 응답할 때까지 기다리는 한계(ms). 넘으면 "어댑터가 뜨지 않았다"고 그대로 적는다. */
export const DEBUG_ADAPTER_READY_TIMEOUT_MS = 8_000;

/** 요청 한 건(DAP/CDP 공통)의 응답 대기 한계(ms). */
export const DEBUG_REQUEST_TIMEOUT_MS = 10_000;

/** §5.5 #17-20 ⑩ — 런타임별 연결법. 상업적 사용이 가능한 어댑터만 올린다(`vsdbg`·`cppvsdbg` 는 MS IDE 전용 → `delegated`, ⑦). */
export const DEBUG_ADAPTERS: readonly DebugAdapterSpec[] = [
  {
    // Node 는 런타임 자체가 인스펙터를 갖고 있다 — 설치할 것이 없고 라이선스 위험이 0.
    runtime: 'node',
    backend: 'cdp',
    attach: 'port',
    licence: 'Node.js (MIT)',
    installKey: 'ide.debug.adapter.node',
    docsUrl: 'https://nodejs.org/api/debugger.html',
  },
  {
    runtime: 'python',
    backend: 'dap',
    adapter: { command: 'python', args: ['-m', 'debugpy.adapter'], transport: 'stdio' },
    attach: 'port',
    licence: 'debugpy (MIT)',
    installKey: 'ide.debug.adapter.python',
    docsUrl: 'https://github.com/microsoft/debugpy',
  },
  {
    runtime: 'go',
    backend: 'dap',
    adapter: { command: 'dlv', args: ['dap', `--listen=127.0.0.1:${DEBUG_ADAPTER_PORT_TOKEN}`], transport: 'tcp' },
    attach: 'port',
    licence: 'Delve (MIT)',
    installKey: 'ide.debug.adapter.go',
    docsUrl: 'https://github.com/go-delve/delve',
  },
  {
    // .NET 은 Microsoft `vsdbg` 가 막힌 것이지 .NET 디버깅이 막힌 게 아니다 — netcoredbg 는 MIT.
    runtime: 'dotnet',
    backend: 'dap',
    adapter: { command: 'netcoredbg', args: ['--interpreter=vscode'], transport: 'stdio' },
    attach: 'pid',
    licence: 'netcoredbg (MIT)',
    installKey: 'ide.debug.adapter.dotnet',
    docsUrl: 'https://github.com/Samsung/netcoredbg',
  },
  {
    runtime: 'rust',
    backend: 'dap',
    adapter: { command: 'codelldb', args: ['--port', DEBUG_ADAPTER_PORT_TOKEN], transport: 'tcp' },
    attach: 'pid',
    licence: 'CodeLLDB (MIT)',
    installKey: 'ide.debug.adapter.rust',
    docsUrl: 'https://github.com/vadimcn/codelldb',
  },
  {
    // JDWP 로 멈춰 세우는 것까지는 ③ 이 하고, 그 포트에 붙는 어댑터는 사용자 것을 쓴다.
    runtime: 'java',
    backend: 'dap',
    attach: 'port',
    licence: 'java-debug (EPL-1.0)',
    installKey: 'ide.debug.adapter.java',
    docsUrl: 'https://github.com/microsoft/java-debug',
  },
  {
    // 유일하게 라이선스로 막힌 자리 — 흉내 내지 않고 ⑦ 로 넘긴다.
    runtime: 'unreal',
    backend: 'delegated',
    attach: 'pid',
    licence: 'cppvsdbg (재배포 불가)',
    installKey: 'ide.debug.adapter.unreal',
    docsUrl: 'https://dev.epicgames.com/documentation/en-us/unreal-engine/debugging-unreal-engine',
  },
];

/** 이 런타임을 어떻게 붙이는지. 표에 없으면 null(화면이 "붙는 법을 모른다"고 적는다). */
export function findDebugAdapter(runtime: RunRuntime): DebugAdapterSpec | null {
  return DEBUG_ADAPTERS.find((a) => a.runtime === runtime) ?? null;
}

// ─── §5.5 #17-20 ⑪ — 출력 한 줄에서 문제를 뽑는 공통 매처(런타임마다 한 줄) ───
// 안 걸리면 `null` — 평문으로 둔다(모르는 것을 칠하지 않는다).

/** 매처 한 개. 캡처 그룹 번호로 무엇을 뽑을지 지정한다(정규식마다 그룹 순서가 다르므로). */
export interface ProblemMatcher {
  id: string;
  pattern: RegExp;
  /** 고정 심각도. `null` 이면 `groups.severity` 가 가리키는 캡처에서 읽는다. */
  severity: ProblemSeverity | null;
  groups: {
    file?: number;
    line?: number;
    column?: number;
    message?: number;
    severity?: number;
  };
}

/** 캡처한 단어 → 심각도. 모르는 말이면 error 로 올리지 않고 info 로 둔다. */
function toSeverity(word: string | undefined): ProblemSeverity {
  const w = (word ?? '').toLowerCase();
  if (w.startsWith('fatal') || w.startsWith('error') || w.startsWith('err')) return 'error';
  if (w.startsWith('warn')) return 'warning';
  return 'info';
}

/**
 * 위에서부터 첫 일치가 이긴다 — **구체적인 것을 먼저** 둔다.
 * (예: `a.ts(3,5): error TS2304:` 는 tsc 와 MSVC 모양이 같으므로 tsc 가 위에 있어야 한다.)
 */
export const PROBLEM_MATCHERS: readonly ProblemMatcher[] = [
  {
    // TypeScript — `src/a.ts(3,5): error TS2304: Cannot find name 'x'.`
    id: 'tsc',
    pattern: /^\s*(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+TS\d+:\s*(.+)$/,
    severity: null,
    groups: { file: 1, line: 2, column: 3, severity: 4, message: 5 },
  },
  {
    // MSVC(언리얼 C++ 빌드 포함) — `Foo.cpp(12): error C2065: ...`
    id: 'msvc',
    pattern: /^\s*(.+?)\((\d+)(?:,\d+)?\)\s*:\s*(fatal error|error|warning)\s+([A-Z]+\d+\s*:\s*.+)$/,
    severity: null,
    groups: { file: 1, line: 2, severity: 3, message: 4 },
  },
  {
    // gcc/clang — `src/a.c:12:5: error: expected ';'`
    id: 'gcc-clang',
    pattern: /^\s*(.+?):(\d+):(\d+):\s*(fatal error|error|warning|note):\s*(.+)$/,
    severity: null,
    groups: { file: 1, line: 2, column: 3, severity: 4, message: 5 },
  },
  {
    // Go — `./main.go:10:2: undefined: foo` (심각도 단어가 없다)
    id: 'go',
    pattern: /^\s*(\S+\.go):(\d+):(\d+):\s*(.+)$/,
    severity: 'error',
    groups: { file: 1, line: 2, column: 3, message: 4 },
  },
  {
    // Rust 진단 머리 — `error[E0425]: cannot find value` / `warning: unused variable`
    id: 'rust-head',
    pattern: /^(error|warning)(?:\[[A-Z]\d+\])?:\s*(.+)$/,
    severity: null,
    groups: { severity: 1, message: 2 },
  },
  {
    // Rust 위치 줄 — `  --> src/main.rs:5:9`
    id: 'rust-loc',
    pattern: /^\s*-->\s+(.+?):(\d+):(\d+)\s*$/,
    severity: 'info',
    groups: { file: 1, line: 2, column: 3, message: 1 },
  },
  {
    // ESLint stylish 본문 — `  3:5  error  'x' is not defined  no-undef` (파일은 위 줄에 있다)
    id: 'eslint',
    pattern: /^\s+(\d+):(\d+)\s+(error|warning)\s{2,}(.+?)\s{2,}\S+\s*$/,
    severity: null,
    groups: { line: 1, column: 2, severity: 3, message: 4 },
  },
  {
    // Node 스택 프레임 — `    at foo (C:/p/a.js:12:5)` / `    at C:/p/a.js:12:5`
    id: 'node-stack',
    pattern: /^\s*at\s+(?:.*?\()?(.+?):(\d+):(\d+)\)?\s*$/,
    severity: 'info',
    groups: { file: 1, line: 2, column: 3, message: 1 },
  },
  {
    // Python 트레이스백 프레임 — `  File "app.py", line 12, in <module>`
    id: 'python-frame',
    pattern: /^\s*File\s+"(.+?)",\s*line\s+(\d+)/,
    severity: 'info',
    groups: { file: 1, line: 2, message: 1 },
  },
  {
    // Java 스택 프레임 — `\tat com.foo.Bar.run(Bar.java:42)`
    id: 'java-frame',
    pattern: /^\s*at\s+[\w.$]+\((\w+\.java):(\d+)\)\s*$/,
    severity: 'info',
    groups: { file: 1, line: 2, message: 1 },
  },
  {
    // 언리얼 로그 — `[2026.08.06-12.00.00:000][ 0]LogTemp: Error: 메시지` / `LogTemp: Warning: 메시지`
    id: 'unreal-log',
    pattern: /^(?:\[[^\]]*\])*\s*([A-Za-z]\w*):\s*(Error|Warning|Fatal):\s*(.+)$/,
    severity: null,
    groups: { severity: 2, message: 3 },
  },
  {
    // 예외 이름으로 끝나는 마지막 줄 — `TypeError: x is not a function`
    id: 'exception',
    pattern: /^\s*([A-Z]\w*(?:Error|Exception))(?::\s*(.+))?\s*$/,
    severity: 'error',
    groups: { message: 2 },
  },
  {
    // 마지막 그물 — 어느 형식도 아니지만 심각도 단어가 분명한 줄.
    id: 'bare-severity',
    pattern: /(?:^|[\s[(])(FATAL|ERROR|WARN(?:ING)?)(?:[\s\]):]|$)/,
    severity: null,
    groups: { severity: 1 },
  },
];

/**
 * 출력 한 줄 → 문제 하나(없으면 null). **순수 함수** 라 클라·서버·테스트가 같은 답을 본다.
 * 빈 줄과 아주 긴 줄은 보지 않는다(로그 폭주 시 정규식 비용이 곱해지는 것을 막는다).
 */
export function matchProblemLine(line: string): ProblemMatch | null {
  if (!line || line.length > 2000) return null;
  for (const matcher of PROBLEM_MATCHERS) {
    const m = matcher.pattern.exec(line);
    if (!m) continue;
    const pick = (idx: number | undefined): string | undefined =>
      idx === undefined ? undefined : m[idx];
    const severity = matcher.severity ?? toSeverity(pick(matcher.groups.severity));
    const lineNo = Number(pick(matcher.groups.line));
    const colNo = Number(pick(matcher.groups.column));
    const message = pick(matcher.groups.message)?.trim() ?? line.trim();
    const file = pick(matcher.groups.file)?.trim();
    return {
      severity,
      ...(file ? { file } : {}),
      ...(Number.isFinite(lineNo) && lineNo > 0 ? { line: lineNo } : {}),
      ...(Number.isFinite(colNo) && colNo > 0 ? { column: colNo } : {}),
      message,
      matcher: matcher.id,
    };
  }
  return null;
}

/** §5.5 #17-20 ⑥ — MCP 서버 프리셋(남이 만든 것, 실행법만 안다). 한 줄 더하면 체크박스가 되고, 켜면 `--mcp-config` 로 스폰 세션에 실린다. */
export const MCP_SERVER_PRESETS: readonly McpServerPreset[] = [
  {
    id: 'debugger',
    labelKey: 'ide.debug.mcp.debugger',
    name: '@debugmcp/mcp-debugger',
    command: 'npx',
    args: ['-y', '@debugmcp/mcp-debugger'],
    category: 'debug',
    docsUrl: 'https://github.com/debugmcp/mcp-debugger',
  },
  {
    id: 'chrome-devtools',
    labelKey: 'ide.debug.mcp.chromeDevtools',
    name: 'chrome-devtools-mcp',
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@latest'],
    category: 'browser',
    docsUrl: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
    requiresKey: 'ide.debug.mcp.chromeDevtoolsRequires',
  },
  {
    id: 'unreal',
    labelKey: 'ide.debug.mcp.unreal',
    name: 'mcp-unreal',
    command: 'npx',
    args: ['-y', 'mcp-unreal'],
    category: 'engine',
    docsUrl: 'https://github.com/remiphilippe/mcp-unreal',
    requiresKey: 'ide.debug.mcp.unrealRequires',
  },
  {
    id: 'lldb',
    labelKey: 'ide.debug.mcp.lldb',
    name: 'lldb (MCP)',
    command: 'lldb',
    args: ['--mcp'],
    category: 'native',
    docsUrl: 'https://lldb.llvm.org/use/mcp.html',
    requiresKey: 'ide.debug.mcp.lldbRequires',
  },
];

/** id → 프리셋. 알 수 없는 id 는 무시(설정에 남은 옛 id 가 스폰을 깨뜨리지 않게). */
export function findMcpPreset(id: string): McpServerPreset | undefined {
  return MCP_SERVER_PRESETS.find((p) => p.id === id);
}

// ─── §7.11 프리뷰 조작 (판올림 번호 발급 대기) ───

/** 프리뷰 ↔ 주입 스크립트 메시지 표식 — 페이지 자신의 `postMessage` 와 가르려고, 이게 없는 메시지는 양쪽 다 무시한다. */
export const PREVIEW_PICK_SOURCE = 'vibisual-preview';

/** 집은 요소에서 가져올 텍스트 길이 상한. */
export const PREVIEW_PICK_TEXT_MAX = 80;

/**
 * §7.11 (G) — 프리뷰 안 Alt 를 부모로 넘기는 메시지 종류(`{ source, type, down, shift }`).
 * 주입 스크립트·`usePreviewPicker`·`useInspector` 가 이 한 곳을 본다 — 각자 적으면 한쪽만 고쳐져 다리가 끊긴다.
 */
export const PREVIEW_ALT_MESSAGE = 'alt';

/** 부모 → 프리뷰: Alt 를 우리가 가져갈지(`on`). 헤더 토글이 이 메시지를 보낸다. */
export const PREVIEW_ALT_CAPTURE_MESSAGE = 'alt-capture';

/** §7.16 — 프리뷰 → 부모: 마우스가 프레임 안에 있나(`on`). iframe 위에선 바깥 스크롤 상자가 `:hover` 를 못 받아 스크롤바가 안 뜬다 — 안에서 알려 hover 를 대신 세운다. */
export const PREVIEW_HOVER_MESSAGE = 'hover';

/**
 * §7.11 (G) — Alt 를 우리가 먼저 가진다(기본 `true` — 인스펙터는 프리뷰 안에서도 같은 손짓이어야 한다).
 * 안의 앱이 Alt 를 쓰면 헤더 토글로 양보한다(끄면 이 다리가 쉬고 키는 페이지 몫).
 */
export const PREVIEW_ALT_CAPTURE_DEFAULT = true;

/** 프리뷰 폭 프리셋. `transform: scale()` 로 줄이지 마라 — 미디어쿼리가 실제 폭을 못 본다. */
export const PREVIEW_DEVICE_PRESETS: readonly PreviewDevicePreset[] = [
  { id: 'auto', labelKey: 'common.preview.deviceAuto', width: null },
  { id: 'mobile', labelKey: 'common.preview.deviceMobile', width: 390 },
  { id: 'tablet', labelKey: 'common.preview.deviceTablet', width: 820 },
  { id: 'desktop', labelKey: 'common.preview.deviceDesktop', width: 1280 },
  // §5.17 (A) — 한 칸이지만 폭이 하나가 아니다. 고르면 아래 `resolveCompareWidths()` 가 준 폭을
  //   **모두** 나란히 그린다(그래서 `width` 는 null — 이 칸 자체의 폭이라는 게 없다).
  { id: 'compare', labelKey: 'common.preview.deviceCompare', width: null },
] as const;

/** §5.17 (A) — `compare` 가 나란히 놓는 폭 한 칸. */
export interface PreviewCompareWidth {
  id: PreviewDevicePreset['id'];
  labelKey: string;
  width: number;
}

/** §5.17 (A) — `compare` 칸이 나란히 놓을 폭 = 위 표에서 폭이 있는 칸 전부(§3.3 — 따로 적지 않는다). */
export function resolveCompareWidths(
  presets: readonly PreviewDevicePreset[] = PREVIEW_DEVICE_PRESETS,
): readonly PreviewCompareWidth[] {
  const out: PreviewCompareWidth[] = [];
  for (const preset of presets) {
    if (preset.width === null) continue;
    out.push({ id: preset.id, labelKey: preset.labelKey, width: preset.width });
  }
  return out;
}

/** §5.17 (B) — 가로·세로 둘 다 이보다 작게 그은 사각형은 오조작(무심코 한 클릭)으로 보고 버린다. */
export const PREVIEW_SNIP_MIN_PX = 8;

// ─── §5.19 All Model — 로컬 LLM ───

/** §5.19 (B) — All Model 설치 식별자(`UserDefaults.installedApps` — 새 영속 필드 ❌). 이건 의사일 뿐, 켜짐 판정은 디스크의 실물이 한다. */
export const ALL_MODEL_INSTALL_ID = 'allmodel';

/** §5.19 (D) — llama.cpp 최신 릴리스 조회. **빌드 번호를 코드에 박지 않는다.** */
export const LLAMA_RELEASE_LATEST_API = 'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest';

/**
 * §5.19 (D) — 릴리스 목록 조회. `/releases/latest` 를 쓰지 마라 — llama.cpp 바이너리는 prerelease `b#####` 태그에만 붙는다
 * (2026-08-26 실측: latest 는 자산 1개 → 전 플랫폼 설치 실패). 자산을 가진 가장 최근 릴리스를 고른다.
 */
export const LLAMA_RELEASES_LIST_API = 'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=20';

/**
 * §5.19 (B) — 받은 엔진 압축파일이 발행처의 것인가. 릴리스 자산엔 `.sha256` 이 없고(2026-09-08 실측) 자산 JSON 의 `digest` 를 대조한다(추가 요청 없음).
 * 모양이 다르거나 비면 `null` — "검증 못 함"과 "불일치"를 가른다.
 */
export function parseAssetSha256(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^sha256:([0-9a-f]{64})$/i.exec(value.trim());
  return m?.[1] ? m[1].toLowerCase() : null;
}

/** §5.19 (D) — 기본 설치 백엔드. Vulkan 한 벌이 NVIDIA·AMD·Intel 을 덮고 CPU 는 폴백. CUDA 는 크고 `cudart` 가 더 필요해 선택이다. */
export const LOCAL_ENGINE_DEFAULT_BACKENDS: readonly LocalEngineBackend[] = ['vulkan', 'cpu'];

/** §5.19 (F) — 동시에 메모리에 올려 두는 모델 수 상한. 넘는 요청은 거절이 아니라 줄을 선다. */
export const LOCAL_MODEL_MAX_LOADED = 1;

/** §5.19 (F) — 이만큼 안 쓰이면 모델을 내린다(ms). */
export const LOCAL_MODEL_IDLE_UNLOAD_MS = 5 * 60 * 1000;

/** §5.19 (D) — 로컬 엔진 HTTP 포트 탐색 시작점. 잡혀 있으면 1씩 올려 가며 빈 자리를 찾는다. */
export const LOCAL_ENGINE_PORT_BASE = 51500;

/** §5.19 (D) — 엔진이 응답할 때까지 기다리는 상한(ms). 큰 모델은 로드가 길다. */
export const LOCAL_ENGINE_BOOT_TIMEOUT_MS = 180_000;

/** §5.19 (E) — Hugging Face 모델 검색·조회 API(카탈로그는 코드가 아니라 조회로 만든다). */
export const HF_MODEL_API = 'https://huggingface.co/api/models';

/** §5.19 (E) — 검색 결과 상한. */
export const LOCAL_MODEL_SEARCH_LIMIT = 20;

/**
 * §5.19 (E) — 대화용이 아니라고 스스로 밝힌 작업 태그(음성인식·임베딩·이미지 생성 등) — 목록에서 뺀다. 모르면 막지 않는다.
 * 화이트리스트(`text-generation`)로 바꾸지 마라 — 2026-08-21 실측: 인기 GGUF 40건 중 6건만 그 태그였고, 대화 모델이 태그 없음·멀티모달 태그로 사라졌다.
 */
export const LOCAL_MODEL_NON_CHAT_PIPELINE_TAGS: readonly string[] = [
  'automatic-speech-recognition', 'audio-classification', 'audio-to-audio',
  'text-to-speech', 'text-to-audio', 'voice-activity-detection',
  'feature-extraction', 'sentence-similarity', 'text-ranking', 'fill-mask',
  'token-classification', 'text-classification', 'zero-shot-classification',
  'text-to-image', 'image-to-image', 'image-to-video', 'text-to-video',
  'image-classification', 'object-detection', 'image-segmentation', 'depth-estimation',
  'video-classification', 'unconditional-image-generation',
];

/** §5.19 (E) — 받기 목록에 올릴 저장소인가. 태그가 없으면 올린다. 판정은 여기 한 곳(서버와 화면이 같은 답). */
export function isChatCapablePipelineTag(pipelineTag: string | null | undefined): boolean {
  if (!pipelineTag) return true;
  return !LOCAL_MODEL_NON_CHAT_PIPELINE_TAGS.includes(pipelineTag);
}

/** §5.19 (E) — 한 저장소에서 보여 줄 GGUF 파일(양자화) 상한. */
export const LOCAL_MODEL_FILE_LIMIT = 40;

/** §5.19 (E) — 펼쳤을 때 먼저 서는 양자화 수(흔한 것 + 한 단계 위·아래). 나머지는 접힐 뿐 누르면 다 보인다. */
export const LOCAL_MODEL_TOP_QUANT_COUNT = 3;

/**
 * §5.19 (E) — 양자화 통용 순위(작을수록 앞). 카탈로그엔 파일별 내려받기 수가 없어(2026-08-24 확인) llama.cpp 통용 순서를 쓴다(`Q4_K_M` 기본).
 * 표에 없는 이름은 뒤로 갈 뿐 빠지지 않는다. 5씩 띄운 것은 새 양자화를 끼우기 위함이다.
 */
export const QUANT_POPULARITY: Readonly<Record<string, number>> = {
  // 가장 흔한 한 벌 — 대부분이 이 셋 안에서 고른다.
  Q4_K_M: 10, Q5_K_M: 20, Q8_0: 30,
  // 같은 계열의 이웃(_S 는 조금 작고 _L·_XL 은 조금 크다).
  Q6_K: 40, Q4_K_S: 50, Q4_K_XL: 55, Q5_K_S: 60, Q5_K_XL: 65, Q6_K_L: 70, Q6_K_XL: 75,
  // 자리가 모자랄 때 내려가는 층.
  Q3_K_M: 80, Q3_K_L: 85, Q3_K_XL: 88, IQ4_XS: 90, IQ4_NL: 95, Q3_K_S: 100,
  Q2_K: 110, Q2_K_L: 115, Q2_K_XL: 118,
  // i-quant — 같은 크기에서 더 낫지만 느리고, 그만큼 덜 쓰인다.
  IQ3_M: 120, IQ3_S: 125, IQ3_XS: 130, IQ3_XXS: 135,
  IQ2_M: 140, IQ2_S: 145, IQ2_XS: 150, IQ2_XXS: 155, IQ1_M: 160, IQ1_S: 165,
  // 옛 방식(K-quant 이전). 아직 올라오지만 새로 고를 이유는 거의 없다.
  Q4_0: 200, Q4_1: 205, Q5_0: 210, Q5_1: 215,
  // 양자화하지 않은 원본 — 크기가 대개 이 PC 로는 무리다.
  F16: 300, BF16: 305, F32: 310,
};

/** §5.19 (E) — 표에 없는 양자화의 자리. 옛 방식·원본보다는 앞이다(모르는 것을 맨 뒤로 밀지 않는다). */
export const QUANT_RANK_UNKNOWN = 190;

/** §5.19 (E) — 목록 순위(판정은 여기 한 곳). 대소문자 무시, unsloth `UD-` 접두는 `parseQuant` 가 이미 뗀다. */
export function quantRank(quant: string | null | undefined): number {
  if (!quant) return QUANT_RANK_UNKNOWN;
  return QUANT_POPULARITY[quant.toUpperCase()] ?? QUANT_RANK_UNKNOWN;
}

/** §5.19 (E) — 정렬 축은 카탈로그에 그대로 넘긴다 — 받아 온 스무 건을 다시 정렬하면 실제 순위와 갈린다. */
export const LOCAL_MODEL_CATALOG_SORTS: readonly LocalModelCatalogSort[] = ['downloads', 'likes', 'trending', 'recent'];

/** §5.19 (E) — 우리 정렬 축 → 카탈로그(허깅페이스) 필드 이름. */
export const HF_SORT_FIELD: Readonly<Record<LocalModelCatalogSort, string>> = {
  downloads: 'downloads',
  likes: 'likes',
  trending: 'trendingScore',
  recent: 'lastModified',
};

/**
 * §5.19 (E) — 목록에 함께 실어 달라고 카탈로그에 명시하는 필드들.
 * 기본 응답에는 **트렌딩 점수가 없다**(2026-08-24 실측) — 달라고 해야 온다.
 */
export const HF_EXPAND_FIELDS: readonly string[] = ['downloads', 'likes', 'trendingScore', 'pipeline_tag', 'lastModified'];

/** §5.19 — 엔진·모델이 놓이는 폴더 이름(홈의 `.vibisual` 아래). */
export const LOCAL_ENGINE_DIR_NAME = 'engine';
export const LOCAL_MODEL_DIR_NAME = 'models';

/** §5.19 (E) — 가중치 외 자리(문맥 캐시·작업 버퍼)로 파일 크기에 얹는 비율. 후하게 잡는다("된다고 했는데 안 되는" 쪽보다 낫다). */
export const LOCAL_MODEL_OVERHEAD_RATIO = 1.2;
/** 위 비율에 더해 붙는 고정 여유(문맥 16K 기준 대략치). */
export const LOCAL_MODEL_OVERHEAD_BYTES = 1_500_000_000;
/** 시스템 메모리는 다 쓸 수 없다 — OS·앱이 쓸 몫을 남긴다. */
export const LOCAL_MODEL_RAM_USABLE_RATIO = 0.7;

/** §5.19 (E) — 판정 규칙은 여기 한 곳(서버와 화면이 같은 답). 잴 수 없으면 `unknown` — 넘겨짚어 "돌아갑니다"라 하지 않는다. */
export function classifyModelFit(
  sizeBytes: number,
  hardware?: { vramFreeBytes: number; totalRamBytes: number; measuredAt: number } | null,
): 'gpu' | 'ram' | 'too-big' | 'unknown' {
  if (!hardware || hardware.measuredAt === 0 || sizeBytes <= 0) return 'unknown';
  const need = sizeBytes * LOCAL_MODEL_OVERHEAD_RATIO + LOCAL_MODEL_OVERHEAD_BYTES;
  if (hardware.vramFreeBytes > 0 && need <= hardware.vramFreeBytes) return 'gpu';
  if (hardware.totalRamBytes > 0 && need <= hardware.totalRamBytes * LOCAL_MODEL_RAM_USABLE_RATIO) return 'ram';
  return 'too-big';
}

/**
 * §5.19 (D) — 로컬 대화의 기본 컨텍스트 길이(토큰).
 * 엔진 기본값(4K 급)을 그대로 쓰면 도구를 물리거나 대화가 조금만 길어져도 즉시 막힌다.
 */
export const LOCAL_DEFAULT_CONTEXT_SIZE = 16384;

/** §5.19 (D) — 대화 창 아래·위 끝(토큰). 아래는 도구 정의가 들어갈 만큼, 위는 학습 길이까지(모델 학습 문맥이 작으면 그 값으로 낮춰 뜬다). */
export const LOCAL_CONTEXT_MIN = 2048;
export const LOCAL_CONTEXT_MAX = 262_144;

/**
 * §5.19 (D) — 답 길이 상한의 문맥 비율(문맥을 늘리면 답도 늘게). 고정값으로 되돌리지 마라 —
 * 2026-08-21 실측: 4,096 고정이면 긴 생각이 상한을 다 써 빈 답(`finish_reason=length`). 상한 자체는 둔다(로컬은 느리다).
 */
export const LOCAL_ANSWER_BUDGET_RATIO = 0.75;

/** 그래도 이만큼은 준다 — 문맥을 아주 작게 잡아도 답이 통째로 잘리면 안 된다. */
export const LOCAL_ANSWER_BUDGET_MIN = 1024;

/**
 * §5.19 (D) — 창 끝에 남겨 두는 여유(토큰). 프롬프트 토큰 수를 알고 예산을 역산할 때,
 * 딱 맞게 채우면 채팅 서식이 붙이는 몇 토큰에 밀려 생성이 곧장 끝난다.
 */
export const LOCAL_ANSWER_BUDGET_RESERVE = 256;

/**
 * §5.19 (D) — 한 턴 생성 토큰 상한(판정은 여기 한 곳). `promptTokens`(직전 `usage`)가 있으면 남은 자리 안에서 잡는다 —
 * 고정 비율이면 엔진은 거절하지 않고(400 은 프롬프트만 본다) 생성 도중 창 끝에서 답을 자른다.
 */
export function localAnswerBudget(contextSize: number, promptTokens?: number): number {
  const ctx = contextSize > 0 ? contextSize : LOCAL_DEFAULT_CONTEXT_SIZE;
  const byRatio = Math.floor(ctx * LOCAL_ANSWER_BUDGET_RATIO);
  const byRoom =
    promptTokens !== undefined && promptTokens > 0
      ? ctx - promptTokens - LOCAL_ANSWER_BUDGET_RESERVE
      : byRatio;
  return Math.max(LOCAL_ANSWER_BUDGET_MIN, Math.min(byRatio, byRoom));
}

/**
 * §5.19 (D) — 그중 생각 몫. 엔진 `--reasoning-budget` 로 끊는다 — 예산을 키워도 생각은 스스로 멈추지 않는다
 * (2026-08-21 실측: 답 예산 12,288 에도 빈 답, 사고 3,072 상한이면 `finish_reason=stop`). 생각 없는 모델엔 영향 없음.
 */
export const LOCAL_THINKING_BUDGET_RATIO = 0.25;

/** §5.19 (D) — 이 문맥에서 생각에 허용할 토큰. **판정은 여기 한 곳에서만.** */
export function localThinkingBudget(contextSize: number): number {
  const ctx = contextSize > 0 ? contextSize : LOCAL_DEFAULT_CONTEXT_SIZE;
  return Math.max(LOCAL_ANSWER_BUDGET_MIN, Math.floor(ctx * LOCAL_THINKING_BUDGET_RATIO));
}

// ─── §5.19 (H) 도구 — 로컬 모델이 파일을 읽고 고친다 ───

/** §5.19 (H) — 한 턴의 도구 왕복 상한. 없으면 같은 도구를 무한히 부른다([중지]가 있어도 기본값에 끝을 둔다). */
export const LOCAL_TOOL_MAX_ROUNDS = 24;

/** 한 파일에서 읽어 모델에게 줄 최대 바이트. 넘으면 앞부분만 주고 잘렸다고 말한다. */
export const LOCAL_TOOL_READ_MAX_BYTES = 256 * 1024;

/** 도구 결과 한 건이 모델에게 갈 때의 글자 상한. 문맥을 한 번에 삼키지 않게. */
export const LOCAL_TOOL_RESULT_MAX_CHARS = 24_000;

/** §5.19 (D)(H) — 문맥 예산용 글자/토큰 환산비(토크나이저 아님). 한글 ≈ 1, 영문·코드 3~4 사이에서 적게 잡는다 — 크게 잡으면 예산을 넘겨 400 을 맞는다. */
export const LOCAL_CHARS_PER_TOKEN = 3;

/**
 * §5.19 (H) — 도구 결과 한 건의 문맥 몫(창의 4분의 1). 고정 글자 수로 두지 마라 —
 * 2026-08-21 실측: 24,000자 고정이면 기본 문맥(16,384 토큰)에서 웹 결과 하나가 창을 먹어 다음 요청이 400 으로 거절됐다.
 */
export const LOCAL_TOOL_RESULT_CONTEXT_RATIO = 0.25;

/** §5.19 (H) — 이 문맥에서 도구 결과 한 건에 허용할 글자. **판정은 여기 한 곳에서만.** */
export function localToolResultBudget(contextSize: number): number {
  const ctx = contextSize > 0 ? contextSize : LOCAL_DEFAULT_CONTEXT_SIZE;
  const byContext = Math.floor(ctx * LOCAL_TOOL_RESULT_CONTEXT_RATIO * LOCAL_CHARS_PER_TOKEN);
  return Math.max(2_000, Math.min(LOCAL_TOOL_RESULT_MAX_CHARS, byContext));
}

/** §5.19 (D) — 지난 이력의 문맥 몫. 이력은 스스로 줄지 않아 상한이 없으면 언젠가 그 버블은 무엇을 쳐도 400 이 된다. */
export const LOCAL_HISTORY_CONTEXT_RATIO = 0.5;

/** §5.19 (D) — 이 문맥에서 지난 이력에 허용할 글자. **판정은 여기 한 곳에서만.** */
export function localHistoryBudget(contextSize: number): number {
  const ctx = contextSize > 0 ? contextSize : LOCAL_DEFAULT_CONTEXT_SIZE;
  return Math.max(4_000, Math.floor(ctx * LOCAL_HISTORY_CONTEXT_RATIO * LOCAL_CHARS_PER_TOKEN));
}
/**
 * §5.19 (H) — 같은 도구·같은 인자를 실제로 돌릴 횟수(작은 모델은 같은 호출을 되풀이한다).
 * 1 이면 편집 뒤 같은 테스트 재실행까지 막힌다 — 넘으면 실행 대신 "방금 같은 호출"을 결과로 준다.
 */
export const LOCAL_TOOL_REPEAT_LIMIT = 3;

/** §5.19 (D) — 대화 접기 요약의 토큰(400 낱말 안팎). 넉넉하면 두 번째 대화가, 인색하면 결정·파일 경로가 잘린다. */
export const LOCAL_COMPACT_MAX_TOKENS = 800;

/** §5.19 (D) — KV 조각 재사용 최소 단위(llama.cpp 통용값). 이력 앞을 잘라 프리픽스가 바뀌어도 프롬프트 전체 재평가(로컬 수십 초)를 피한다. */
export const LOCAL_ENGINE_CACHE_REUSE = 256;
/** 목록·검색이 한 번에 돌려줄 최대 항목 수. */
export const LOCAL_TOOL_LIST_MAX_ENTRIES = 400;

/** §5.19 (H) — 검색 한 번이 모델에게 줄 최대 결과 수. 열 개를 넘겨도 고르는 일은 같다. */
export const LOCAL_WEB_SEARCH_MAX_HITS = 8;

/**
 * §5.19 (H) — 로컬 `WebSearch` 창구. 결과 화면 HTML 파싱(DDG)으로 되돌리지 마라 — 약관이 금지하는 자동 조회다.
 * 무료·키 불필요·약관 허용·일반 웹 결과를 다 만족한 것은 이것뿐이다(실측: DDG Instant Answer 0건 · Mojeek 403 · Marginalia 상업 금지 · 나머지는 사용자별 키).
 * Firecrawl 키 없는 접근은 공식 기능(2026-06-16~, IP 단위 일일 상한, 넘으면 429). `FIRECRAWL_API_KEY` 를 두면 자기 키로 올라간다.
 */
export const LOCAL_WEB_SEARCH_API_URL = 'https://api.firecrawl.dev/v2/search';
/** 검색 한 번의 상한(ms). 모델이 기다리는 시간이라 길게 잡지 않는다. */
export const LOCAL_WEB_SEARCH_TIMEOUT_MS = 20_000;

/** 명령 실행 도구의 상한(ms). 넘으면 죽이고 그 사실을 결과로 알린다. */
export const LOCAL_TOOL_COMMAND_TIMEOUT_MS = 120_000;

/**
 * §5.19 (H) — 셸도 루트 안에 둔다. 파일 도구 루트 가드는 `Bash` 에 안 걸린다(`cd ~` 면 나가고, 로컬엔 판정해 줄 CLI 가 없다).
 * 명령을 파싱하지 않는다(파서가 곧 우회 대상) — 눈에 띄는 이탈 신호만 거절해 결과로 알린다. 샌드박스가 아니다 — 진짜 봉인은 §5.22 경계.
 */
export const LOCAL_BASH_ESCAPE_PATTERNS: readonly RegExp[] = [
  // 홈 확장 — `cd ~`, `cat ~/.claude/.credentials.json`
  /(^|[\s=:'"(])~[/\\]?/,
  // POSIX 절대경로 중 홈·시스템 자리(프로젝트가 `/home/<user>/p` 여도 `/home/<user>/.ssh` 는 이탈이다)
  /(^|[\s=:'"(])\/(etc|root|home|Users|var\/root)(\/|\s|$)/,
  // Windows 사용자 프로필·드라이브 루트 이동
  /(^|[\s=:'"(])[A-Za-z]:[/\\](Users|Windows)(\/|\\|\s|$)/i,
  // 상위로 두 칸 이상 거슬러 올라가는 상대경로
  /\.\.[/\\]\.\.[/\\]/,
  // 홈·프로필 환경변수 참조
  /\$HOME\b|\$\{HOME\}|%USERPROFILE%|\$env:USERPROFILE/i,
];

/**
 * 위 신호가 하나라도 보이면 그 이름을 돌려준다(없으면 `null`). **순수 함수** — 테스트가 직접 부른다.
 */
export function detectLocalBashEscape(command: string): string | null {
  for (const re of LOCAL_BASH_ESCAPE_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(command);
    if (m) return m[0].trim();
  }
  return null;
}

/** §5.19 (H) — 로컬 도구 정의(OpenAI 함수 호출 서식 — llama-server 가 받는다). 이름은 클로드 경로와 같게 — 권한·감사·도구 카드가 이름으로 갈린다. */
export const LOCAL_TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'Read',
      description: 'Read a text file from the project. Returns the file content with 1-based line numbers.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path, relative to the project root (or absolute inside it).' },
          offset: { type: 'integer', description: 'Optional 1-based line to start from.' },
          limit: { type: 'integer', description: 'Optional number of lines to read.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Write',
      description: 'Create a file or replace its entire content. Use Edit for partial changes.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path, relative to the project root.' },
          content: { type: 'string', description: 'The full new content of the file.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Edit',
      description:
        'Replace an exact string in a file. old_string must appear exactly once unless replace_all is true.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path, relative to the project root.' },
          old_string: { type: 'string', description: 'Exact text to replace, including indentation.' },
          new_string: { type: 'string', description: 'Replacement text.' },
          replace_all: { type: 'boolean', description: 'Replace every occurrence instead of requiring one.' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Glob',
      description: 'List project files matching a glob pattern, e.g. "src/**/*.ts".',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern relative to the project root.' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Grep',
      description: 'Search project file contents with a regular expression. Returns matching lines with paths.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regular expression to search for.' },
          glob: { type: 'string', description: 'Optional glob to narrow which files are searched.' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Bash',
      description: 'Run a shell command in the project root and return its output.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command line to run.' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'TodoWrite',
      description:
        'Record or update your plan for this task as a checklist. The user sees it as a plan block and a progress list, and can stop you if the plan is wrong. Call this before starting multi-step work, and again each time a step is finished. Always send the WHOLE list, not just the changed item.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'The complete checklist, in order.',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: 'What this step does, in one short line.' },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed'],
                  description: 'Mark a step completed only when it is actually done.',
                },
              },
              required: ['content', 'status'],
            },
          },
          goal: { type: 'string', description: 'Optional one-sentence goal for this session.' },
        },
        required: ['todos'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'AskUserQuestion',
      description:
        'Ask the user a question and offer suggested answers. The user sees a question card with one-click replies. Use this when you need a decision you cannot make yourself. This does not block: finish what you can, then ask, and the user answers in their next message.',
      parameters: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            description: 'One or more questions.',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string', description: 'The question, in the user\'s language.' },
                header: { type: 'string', description: 'Optional one-line summary of what is being decided.' },
                options: {
                  type: 'array',
                  description: 'Suggested answers, written as the user would say them.',
                  items: { type: 'string' },
                },
              },
              required: ['question'],
            },
          },
        },
        required: ['questions'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ExitPlanMode',
      description:
        'Call this when you are in plan mode and your plan is ready. It shows the plan to the user for approval; if they approve, editing is unlocked and you can start doing the work. Do not call it before the plan is complete.',
      parameters: {
        type: 'object',
        properties: {
          plan: { type: 'string', description: 'The plan you want approved, as a short numbered list.' },
        },
        required: ['plan'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'WebFetch',
      description:
        'Fetch a web page and read it as text. Use this for documentation, release notes, issue pages — anything you need to read but cannot find on disk. HTML is stripped; you get the readable text.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL including https://' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'WebSearch',
      description:
        'Search the web and get back titles, URLs and short snippets. Use it to find pages worth fetching. Your training data has a cutoff; this does not.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for.' },
        },
        required: ['query'],
      },
    },
  },
] as const;

/** 위 목록의 도구 이름들 — 모델이 없는 도구를 부를 때 걸러내는 근거. */
export const LOCAL_TOOL_NAMES: readonly string[] = LOCAL_TOOL_DEFS.map((t) => t.function.name);

/** §5.19 (H) — 읽기 전용 도구(묻지 않는다 — `READ_TOOLS` 와 같은 규율). 여기 없는 것은 전부 바꾸는 도구로 본다. */
export const LOCAL_READ_ONLY_TOOLS: readonly string[] = ['Read', 'Glob', 'Grep'];

/** §5.19 (H) — 파일을 고치는 도구(권한 모드 `acceptEdits` 가 자동 승인하는 범위). */
export const LOCAL_EDIT_TOOLS: readonly string[] = ['Write', 'Edit'];

/** §5.19 (H) — 서버가 대신 처리하는 도구(화면·설정을 움직인다) — 러너가 호스트 처리기로 넘긴다. */
export const LOCAL_HOST_TOOLS: readonly string[] = ['TodoWrite', 'AskUserQuestion', 'ExitPlanMode'];

/** §5.19 (H) — `TodoWrite` 의 `completed`(모델이 배운 낱말)를 목표창 `done` 으로. 없으면 단계가 완료로 안 넘어가 퍼센트가 0에 머문다. */
export function normalizeTodoStatus(raw: unknown): 'pending' | 'in_progress' | 'done' | undefined {
  if (raw === 'completed' || raw === 'done') return 'done';
  if (raw === 'in_progress' || raw === 'active') return 'in_progress';
  if (raw === 'pending' || raw === 'todo') return 'pending';
  return undefined;
}

/** 계획을 적고 사용자에게 묻는 도구 — 프로젝트를 건드리지 않아 어떤 권한 모드에서도 통과한다. */
export const LOCAL_PLANNING_TOOLS: readonly string[] = ['TodoWrite', 'AskUserQuestion'];

/** 계획 모드를 끝내는 도구. 이름을 한 곳에 둔다(게이트와 처리기가 같은 문자열을 봐야 한다). */
export const LOCAL_EXIT_PLAN_TOOL = 'ExitPlanMode';

/** 바깥으로 나가는 도구 — 밖에서 받아 오는 일이라 사람이 한 번 본다. */
export const LOCAL_NETWORK_TOOLS: readonly string[] = ['WebFetch', 'WebSearch'];

/**
 * §5.3 #12-1-A — 사용자가 지목한 "물어볼 도구"인가(모드는 도구 하나를 못 붙잡는다).
 * 판정은 여기 한 곳 — 훅 경로(`/api/permission-check`)와 로컬 `requestTool` 이 같이 부른다. 정확한 이름 일치(대소문자 접기 ❌). 목록이 없으면 `false`.
 */
export function shouldAskForTool(askTools: readonly string[] | undefined, toolName: string): boolean {
  if (!askTools || askTools.length === 0) return false;
  if (!toolName) return false;
  return askTools.includes(toolName);
}

/** §5.3 #12-1-B — 금지 목록에 있나. `--disallowedTools` 는 스폰 때만 실려 오래 사는 자식이 [항상 거절] 뒤에도 그 도구를 가진다 — 두 판정 자리가 모드보다 먼저 본다. */
export function isToolDisallowed(disallowedTools: readonly string[] | undefined, toolName: string): boolean {
  if (!disallowedTools || disallowedTools.length === 0) return false;
  if (!toolName) return false;
  return disallowedTools.includes(toolName);
}

/** §5.3 #12-1-B — 카드가 보낼 수 있는 답 넷(요청 본문 검증용). */
export const PERMISSION_CHOICES: readonly PermissionChoice[] = ['allow_once', 'allow_always', 'reject_once', 'reject_always'];

/** §5.3 #12-1-B — 답 넷을 훅이 알아듣는 두 낱말로 접는다. */
export function foldPermissionChoice(choice: PermissionChoice): 'allow' | 'deny' {
  return choice === 'allow_once' || choice === 'allow_always' ? 'allow' : 'deny';
}

/**
 * §5.3 #12-1-B · §5.22 — 브로커에서 풀린 결정 한 건이 원장에 **어느 출처로** 적히는가.
 * 취소는 `reason` 이 아니라 서버만 싣는 `cancelled` 로 가른다 — 창구가 보낸 낱말로 출처를 꾸미지 못하게.
 */
export function permissionDecisionSource(decision: { reason?: string; cancelled?: PermissionCancelReason }): 'user' | 'timeout' | 'cancelled' {
  if (decision.cancelled) return 'cancelled';
  return decision.reason === 'timeout' ? 'timeout' : 'user';
}

/**
 * §5.22 · §5.3 #12-1-B — 거부 수에 드는 줄인가. 취소(`cancelled`)는 `deny` 로 적혀도 거부가 아니다(세면 멈춘 에이전트가 "거부 증가"로 읽힌다).
 * 서버 집계와 타임라인 거부 탭이 함께 쓴다.
 */
export function isAuditEntryDenied(entry: { decision?: 'allow' | 'deny'; decisionSource?: string }): boolean {
  return entry.decision === 'deny' && entry.decisionSource !== 'cancelled';
}

/** §5.3 #12-1-B — 세션 기억(이 세션에선 허용) 상한. 세션이 계속 생겨 키가 늘므로 넘치면 오래된 것부터 잊는다(다시 물을 뿐). */
export const PERMISSION_SESSION_GRANTS_MAX = 500;

/**
 * §5.3 #12-1-B — [항상 허용]/[항상 거절] 뒤의 목록(순수 — 원본 불변, 없던 칸은 만들지 않는다).
 * 허용 = 확인 목록에서 뺌. 거절 = 금지 목록에 넣고(중복 ❌) 확인 목록에서 뺌(둘에 함께 있으면 안 된다).
 */
export function applyToolListAlways(
  lists: { askTools: readonly string[] | undefined; disallowedTools: readonly string[] | undefined },
  toolName: string,
  choice: 'allow_always' | 'reject_always',
): { askTools: string[] | undefined; disallowedTools: string[] | undefined } {
  const askTools = lists.askTools ? lists.askTools.filter((t) => t !== toolName) : undefined;
  if (choice === 'allow_always') {
    return { askTools, disallowedTools: lists.disallowedTools ? [...lists.disallowedTools] : undefined };
  }
  const current = lists.disallowedTools ?? [];
  const disallowedTools = current.includes(toolName) ? [...current] : [...current, toolName];
  return { askTools, disallowedTools };
}

/** §5.3 #12-1 — 승인 게이트를 결정하는 칸들. 이 네 개만 유입 출처를 따진다. */
export interface AgentPermissionAxes {
  permissionMode: string;
  tools: string[];
  disallowedTools: string[] | undefined;
  askTools: string[] | undefined;
}

/** `applyIngressPermissionGuard` 의 답. `frozen`·`downgraded` 는 호출부가 로그로 남긴다. */
export interface IngressPermissionGuardResult extends AgentPermissionAxes {
  /** 유입이 바꾸려 했지만 이전 값으로 되돌린 칸 이름. 비어 있으면 아무것도 막지 않았다. */
  frozen: string[];
  /** `bypassPermissions` 요청을 낮춰 저장했는가. */
  downgraded: boolean;
}

/**
 * §5.3 #12-1 — 권한 축은 사용자만 올린다. loopback 토큰은 스폰 에이전트 env·프롬프트에 실려 나가 사용자 의사가 아니다(심긴 한 줄이 입력이 된다).
 * 첫 구성(`prev === undefined`)은 통과, 정해진 값은 달라진 칸만 되돌려 `frozen` 에 남긴다(전체 거절 ❌ — 나머지 칸까지 죽는다).
 * `bypassPermissions` 는 첫 구성에서도 `acceptEdits` 로 낮춘다(팝업과 CLI 확인을 함께 끈다). 모르는 모드는 저장 ❌ — 플래그가 빠지면 CLI 기본이 `auto`(2026-08-14~)다.
 * 사용자 창구(렌더러 IPC·페어링 모바일)는 `fromLoopback=false` 라 제한이 없다.
 */
export function applyIngressPermissionGuard(
  requested: AgentPermissionAxes,
  prev: AgentPermissionAxes | undefined,
  fromLoopback: boolean,
): IngressPermissionGuardResult {
  const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean => {
    const x = a ?? [];
    const y = b ?? [];
    return x.length === y.length && x.every((v, i) => v === y[i]);
  };

  // 모드 검증은 유입과 무관하다 — 사용자 창구로 들어온 오타도 저장하지 않는다.
  const fallbackMode = prev?.permissionMode ?? 'default';
  const mode = AVAILABLE_PERMISSION_MODES.includes(requested.permissionMode)
    ? requested.permissionMode
    : fallbackMode;

  if (!fromLoopback) {
    return { ...requested, permissionMode: mode, frozen: [], downgraded: false };
  }

  if (prev === undefined) {
    // 첫 구성 — 다 받되 bypass 만 낮춘다.
    const downgraded = mode === 'bypassPermissions';
    return {
      ...requested,
      permissionMode: downgraded ? 'acceptEdits' : mode,
      frozen: [],
      downgraded,
    };
  }

  const frozen: string[] = [];
  if (mode !== prev.permissionMode) frozen.push('permissionMode');
  if (!sameList(requested.tools, prev.tools)) frozen.push('tools');
  if (!sameList(requested.disallowedTools, prev.disallowedTools)) frozen.push('disallowedTools');
  if (!sameList(requested.askTools, prev.askTools)) frozen.push('askTools');

  return {
    permissionMode: prev.permissionMode,
    tools: [...prev.tools],
    disallowedTools: prev.disallowedTools ? [...prev.disallowedTools] : undefined,
    askTools: prev.askTools ? [...prev.askTools] : undefined,
    frozen,
    downgraded: false,
  };
}

/** 도구 한 건을 어떻게 처리할지. `ask` 만 사람에게 팝업이 뜬다. */
export type LocalToolGate = 'allow' | 'ask' | 'deny';

/**
 * §5.19 (H) — 권한 모드 × 도구 판정(여기 한 곳). 로컬엔 CLI 가 없어 CLI 가 하던 차단·분류를 우리가 진다.
 * `bypassPermissions` 안 묻기 · `plan` 바꾸기 막기 · `dontAsk` 묻지 않고 거절 · `acceptEdits` 편집만 자동 승인 · 그 밖은 가변 도구를 묻는다.
 */
export function resolveLocalToolGate(permissionMode: string | undefined, toolName: string): LocalToolGate {
  if (LOCAL_READ_ONLY_TOOLS.includes(toolName)) return 'allow';
  // 계획을 적고 사용자에게 묻는 일은 프로젝트를 한 글자도 건드리지 않는다 — 어떤 모드에서도
  //   막을 이유가 없고, 막으면 `plan` 모드가 **계획을 세울 수단조차 없는** 모드가 된다.
  if (LOCAL_PLANNING_TOOLS.includes(toolName)) return 'allow';
  const mode = permissionMode || 'default';
  // 계획을 끝내는 것은 권한을 푸는 일이라 사람이 승인한다. 여기서 `plan` 을 deny 로 떨구면
  //   그 모드에 들어간 에이전트는 **나올 길이 없다**(클로드 경로의 ExitPlanMode 와 같은 자리).
  if (toolName === LOCAL_EXIT_PLAN_TOOL) return mode === 'bypassPermissions' ? 'allow' : 'ask';
  if (mode === 'bypassPermissions') return 'allow';
  if (mode === 'dontAsk') return 'deny';
  // 바깥으로 나가는 호출은 파일을 고치지 않으므로 `plan` 에서도 막지 않는다(계획에는 조사가 든다).
  //   다만 밖으로 나가는 일이라 사람이 한 번 본다.
  if (LOCAL_NETWORK_TOOLS.includes(toolName)) return 'ask';
  if (mode === 'plan') return 'deny';
  if (mode === 'acceptEdits' && LOCAL_EDIT_TOOLS.includes(toolName)) return 'allow';
  return 'ask';
}

/**
 * §5.19 (B) — 요청 본문 `provider` 좁히기(생성·저장 두 입구 공통 — 저장 한 번에 정체를 잃지 않게).
 * `modelId === ''` 도 통과 — 버블이 먼저 생기고 모델은 뒤에 매인다(거르면 All Model 버블이 클로드 버블이 된다).
 */
export function normalizeAgentProvider(value: unknown): AgentProvider | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as {
    kind?: unknown; modelId?: unknown; modelName?: unknown; contextSize?: unknown; temperature?: unknown;
    toolSupport?: unknown; contextUsed?: unknown; contextLimit?: unknown;
    tokensIn?: unknown; tokensOut?: unknown; reasoningEffort?: unknown;
    webSearch?: unknown; networkAccess?: unknown; modelVerbosity?: unknown; codexTools?: unknown;
    reasoningSummary?: unknown; personality?: unknown; serviceTier?: unknown; autoCompactTokenLimit?: unknown;
  };
  if (raw.kind !== 'local-llama' && raw.kind !== 'codex-cli') return undefined;
  const provider: AgentProvider = {
    kind: raw.kind,
    modelId: typeof raw.modelId === 'string' ? raw.modelId.trim() : '',
  };
  // §5.25 (G) — 코덱스 추론 강도. **값을 검증하지 않는다** — 유효한 단계 목록은 모델마다 다르고
  //   그 목록은 CLI 의 모델 캐시가 들고 있다(우리가 표를 들면 새 단계가 생긴 날 거짓이 된다).
  //   빈 문자열만 떨어뜨려 "안 고름"과 구별한다.
  if (typeof raw.reasoningEffort === 'string' && raw.reasoningEffort.trim()) {
    provider.reasoningEffort = raw.reasoningEffort.trim();
  }
  const modelName = typeof raw.modelName === 'string' ? raw.modelName.trim() : '';
  if (raw.kind === 'codex-cli') {
    if (raw.reasoningSummary === 'auto' || raw.reasoningSummary === 'concise' || raw.reasoningSummary === 'detailed' || raw.reasoningSummary === 'none') provider.reasoningSummary = raw.reasoningSummary;
    if (raw.personality === 'none' || raw.personality === 'friendly' || raw.personality === 'pragmatic') provider.personality = raw.personality;
    if (typeof raw.serviceTier === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(raw.serviceTier.trim())) provider.serviceTier = raw.serviceTier.trim();
    if (typeof raw.autoCompactTokenLimit === 'number' && Number.isSafeInteger(raw.autoCompactTokenLimit) && raw.autoCompactTokenLimit > 0) provider.autoCompactTokenLimit = raw.autoCompactTokenLimit;
    const codexTools = normalizeCodexToolPolicy(raw.codexTools);
    if (codexTools) provider.codexTools = codexTools;
    if (raw.webSearch === 'disabled' || raw.webSearch === 'cached' || raw.webSearch === 'live') provider.webSearch = raw.webSearch;
    if (typeof raw.networkAccess === 'boolean') provider.networkAccess = raw.networkAccess;
    if (raw.modelVerbosity === 'low' || raw.modelVerbosity === 'medium' || raw.modelVerbosity === 'high') provider.modelVerbosity = raw.modelVerbosity;
  }
  if (modelName) provider.modelName = modelName;
  if (typeof raw.contextSize === 'number' && raw.contextSize > 0) provider.contextSize = raw.contextSize;
  if (typeof raw.temperature === 'number') provider.temperature = raw.temperature;
  // §5.19 (H) — 도구 지원 판정은 **실제로 물어봐서** 얻은 값이라, 설정 저장 한 번에 날아가면
  //   매 턴 다시 물어보게 된다(그리고 못 쓰는 모델에 매번 도구를 실어 보낸다). 여기서 태워 보낸다.
  if (raw.toolSupport === 'ok' || raw.toolSupport === 'none' || raw.toolSupport === 'unknown') {
    provider.toolSupport = raw.toolSupport;
  }
  // 문맥 사용량도 같은 이유로 태워 보낸다 — 설정을 한 번 저장했다고 게이지가 빈칸이 되면
  //   사용자는 그걸 "안 재고 있다"로 읽는다(다음 왕복까지 기다려야 다시 찬다).
  if (typeof raw.contextUsed === 'number' && raw.contextUsed >= 0) provider.contextUsed = raw.contextUsed;
  if (typeof raw.contextLimit === 'number' && raw.contextLimit > 0) provider.contextLimit = raw.contextLimit;
  if (typeof raw.tokensIn === 'number' && raw.tokensIn >= 0) provider.tokensIn = raw.tokensIn;
  if (typeof raw.tokensOut === 'number' && raw.tokensOut >= 0) provider.tokensOut = raw.tokensOut;
  return provider;
}

/** §5.19 (B) — 모델을 아직 안 문 All Model 버블의 기본 라벨 모양. 모델을 매면 이 모양일 때만 모델명이 잇는다(바꾼 이름은 별도 플래그 없이 보존). */
export const ALL_MODEL_DEFAULT_LABEL_RE = /^All Model \d+$/;

// ─── §5.25 Codex — 같은 지도 위의 두 번째 엔진 ───
// 클로드 쪽(`CLAUDE_SETUP_*`·`CLAUDE_AUTH_*`)과 같은 모양 · 클로드 경로는 여기 값을 읽지 않는다.

/** §5.25 (D) — 공식 standalone 설치 명령. 화면 안내와 서버 spawn 문자열이 같아야 한다. 실행본은 재배포하지 않는다(동봉 ❌). */
export const CODEX_SETUP_INSTALL_COMMAND_WIN = 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"';
export const CODEX_SETUP_INSTALL_COMMAND_POSIX = 'curl -fsSL https://chatgpt.com/codex/install.sh | sh';

/** 자동 설치가 막혔을 때의 탈출구 — 공식 설치 문서. */
export const CODEX_SETUP_DOCS_URL = 'https://developers.openai.com/codex/cli';

/** `codex --version` 판정 타임아웃. 짧게 — 이 값이 길면 부팅이 그만큼 늦어진다. */
export const CODEX_SETUP_PROBE_TIMEOUT_MS = 8_000;

/** 공식 설치본 다운로드는 네트워크 왕복이라 넉넉히. */
export const CODEX_SETUP_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

/** 설치 직후 `--version` 재확인 간격/횟수 — 파일 flush·shim 배치가 한 박자 늦을 수 있다. */
export const CODEX_SETUP_VERIFY_RETRY_INTERVAL_MS = 1_500;
export const CODEX_SETUP_VERIFY_RETRY_MAX = 4;

/** 설치 로그 보관 상한(꼬리). 넘으면 앞을 버린다 — 진행 화면은 최근 줄만 읽는다. */
export const CODEX_SETUP_OUTPUT_MAX_CHARS = 20_000;

/** `codex login status` 판정 타임아웃. */
export const CODEX_AUTH_PROBE_TIMEOUT_MS = 8_000;

/** `codex logout` 타임아웃 — 네트워크 왕복이 있어 조금 길게. */
export const CODEX_AUTH_LOGOUT_TIMEOUT_MS = 20_000;

/** 주기 재조회 간격(로그인 상태). 클로드와 같은 간격. */
export const CODEX_AUTH_POLL_INTERVAL_MS = 10 * 60 * 1000;

/** 로그인 창이 떠 있는 동안의 재조회 간격 — 성공 판정의 1차 근거. */
export const CODEX_AUTH_LOGIN_POLL_INTERVAL_MS = 3_000;

/**
 * 코덱스 로그인 PTY 의 termId 접두사. 각 시도에 고유 suffix를 붙여
 * 클로드 로그인이나 이전 로그인 시도의 늦은 응답이 현재 터미널을 건드리지 않는다.
 */
export const CODEX_AUTH_LOGIN_TERM_ID = 'term:codex:login';

/** 로그인 URL/코드를 이 시간 안에 못 찾으면 창이 터미널을 자동으로 펼친다(폴백). */
export const CODEX_AUTH_TERMINAL_REVEAL_MS = 6_000;

/** §5.25 (E) — 코덱스 홈 위치를 바꾸는 환경변수. 없으면 홈 아래 기본 폴더. */
export const CODEX_HOME_ENV = 'CODEX_HOME';

/** §5.25 (E) — 홈 아래 코덱스 폴더 이름(세 OS 공통 — 코덱스는 OS별 설정 폴더를 쓰지 않는다). */
export const CODEX_HOME_DIRNAME = '.codex';

/** §5.25 (G) — 모델 목록 캐시 파일 이름. 우리는 **읽기만** 한다. */
export const CODEX_MODELS_CACHE_FILENAME = 'models_cache.json';

/** §5.25 (G) — 모델 목록 자동 조회 간격. 서버 TTL과 클라이언트 재조회가 같은 주기를 쓴다. */
export const CODEX_MODELS_REFRESH_INTERVAL_MS = 5 * 60_000;

/** §5.25 (I) — 훅 정의 파일 이름(사용자 전역). */
export const CODEX_HOOKS_FILENAME = 'hooks.json';

/** §5.25 (I) — 우리 훅 블록 표식(우리 것만 골라 지운다 — `hookInstaller` 와 같은 규약). */
export const CODEX_HOOK_MARKER = '_vibisual';

/** §5.25 (I) — 설치하는 코덱스 훅 이벤트(클로드 캔버스가 쓰는 다섯). 안 쓰는 것은 남의 전역 설정에 심지 않는다 — 더하면 `/api/hook-event` 분기도 본다. */
export const CODEX_HOOK_EVENTS: readonly string[] = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
];

/**
 * §5.25 (H) — 권한 모드 → 코덱스 두 축(`--sandbox`·`--ask-for-approval`). 표로 둔다(§3.3 — 스폰과 화면 설명이 같은 답).
 * `--dangerously-bypass-approvals-and-sandbox` 는 어느 모드에도 매핑하지 않는다.
 */
export const CODEX_PERMISSION_MAP: Readonly<Record<string, { sandbox: string; approval: string }>> = {
  /** 위험한 동작마다 확인 — 코덱스가 스스로 판단해 물어보는 정책. */
  default: { sandbox: 'workspace-write', approval: 'on-request' },
  /** 편집은 통과. 코덱스에서는 작업공간 쓰기 허용이 곧 그 뜻이다. */
  acceptEdits: { sandbox: 'workspace-write', approval: 'on-request' },
  /** 자동 승인 — 묻지 않고 작업공간 안에서 일한다. */
  auto: { sandbox: 'workspace-write', approval: 'never' },
  /**
   * 묻지 않는다 = 우리 쪽에서는 **승인이 필요한 일을 하지 않는다**는 뜻이라(즉시 거부),
   * 코덱스에서 가장 가까운 값은 읽기 전용 + 안 묻기다. 쓰기를 열어 두면 뜻이 뒤집힌다.
   */
  dontAsk: { sandbox: 'read-only', approval: 'never' },
  /** 계획만 — 실행이 없는 모드라 읽기 전용. */
  plan: { sandbox: 'read-only', approval: 'never' },
  /** 전부 허용. 그래도 CLI 가 위험하다고 이름 붙인 우회 플래그는 쓰지 않는다. */
  bypassPermissions: { sandbox: 'danger-full-access', approval: 'never' },
};

/** §5.25 (H) — 표에 없는 모드가 오면 가장 보수적인 값으로 떨어진다(모르는 것을 열지 않는다). */
export const CODEX_PERMISSION_FALLBACK = { sandbox: 'read-only', approval: 'on-request' } as const;

/**
 * §5.25 (H) — 권한 모드 → 코덱스 인자 두 개. 스폰과 화면 설명이 **같은 함수**를 본다.
 */
export function resolveCodexPermission(mode: string | undefined): { sandbox: string; approval: string } {
  // 없는 값과 모르는 값을 가른다 — 미설정은 앱 전체처럼 `default`, 모르는 문자열은 넓게 읽지 않는다(새 모드가 조용히 전면 허용이 되지 않게).
  const key = mode === undefined || mode === '' ? 'default' : mode;
  const hit = CODEX_PERMISSION_MAP[key];
  return hit ?? { ...CODEX_PERMISSION_FALLBACK };
}

/** §5.25 (H) — 이 모드의 코덱스 버블이 승인 카드를 띄울 수 있나(`on-request` 일 때만 묻는다 — 60초 무응답 정책의 뜻). 클로드 `askTools` 는 코덱스에 없어 보지 않는다. */
export function canCodexPromptForPermission(mode: string | undefined): boolean {
  return resolveCodexPermission(mode).approval === 'on-request';
}

/** §5.25 (B) — 모델을 안 문 Codex 버블의 기본 라벨 모양(All Model 과 같은 규약). `Agent` 는 선택 — 옛 기본 이름 `Codex 3` 버블도 받는다. */
export const CODEX_DEFAULT_LABEL_RE = /^Codex (?:Agent )?\d+$/;

/** §5.25 (C) — 엔진 → 새 에이전트 `provider` 초깃값. 클로드는 `undefined`(기존 경로 그대로). 엔진 이름과 프로바이더를 잇는 곳은 여기 하나다. */
export function providerForEngine(engine: AgentEngineKind): AgentProvider | undefined {
  if (engine === 'codex') return { kind: 'codex-cli', modelId: '' };
  if (engine === 'local') return { kind: 'local-llama', modelId: '' };
  return undefined;
}

/** §5.25 (C) — 반대 방향. `provider` 가 없으면 클로드다. */
export function engineForProvider(provider: AgentProvider | undefined): AgentEngineKind {
  if (provider?.kind === 'codex-cli') return 'codex';
  if (provider?.kind === 'local-llama') return 'local';
  return 'claude';
}

/**
 * §5.25 (B-1)·(M-1) — 실제로 도는 엔진(스킬을 읽고 세션 기록을 남기는 쪽). 판정은 여기 한 곳.
 * CMD 버블은 셸에 채우는 CLI 가 엔진이다. `cliKind` 는 CMD 에서만 읽는다(헤드리스로 되돌린 버블에 옛 값이 남는다).
 */
export function agentEngineOf(
  config: { provider?: AgentProvider; executionMode?: string; cliKind?: string } | null | undefined,
): AgentEngineKind {
  if (config?.executionMode === 'interactive-terminal' && resolveCmdCliKind(config.cliKind).value === 'codex') return 'codex';
  return engineForProvider(config?.provider);
}

/**
 * §5.25 (J) — 이 버블의 모델 라벨을 답하는 한 곳(새 엔진은 `engineForProvider` 에 갈래만 더한다).
 * `AgentConfig.model` 은 클로드 칸(기본 `opus`)이라 엔진을 안 보고 적으면 코덱스·로컬 버블에 `opus` 가 뜬다.
 * CMD 는 셸에 채울 CLI 가 먼저(§5.25 (B-1)) — 클로드 아닌 CLI 는 CLI 이름을 적고, `cliKind` 는 CMD 에서만 읽는다.
 * @param fallbacks 프로바이더가 모델을 아직 안 물었을 때 적을 엔진 이름(i18n 문구).
 * @returns `null` 이면 적을 것이 없다(훅 버블처럼 설정이 없거나 아직 안 읽힌 자리).
 */
export function agentModelLabelOf(
  config: { model?: string; provider?: AgentProvider; executionMode?: string; cliKind?: string } | null | undefined,
  fallbacks?: { codex?: string; local?: string },
): string | null {
  if (config?.executionMode === 'interactive-terminal') {
    const cli = resolveCmdCliKind(config.cliKind);
    if (!cli.managed) return cli.bin ? cli.label : null;
  }
  const provider = config?.provider;
  const engine = engineForProvider(provider);
  if (engine === 'claude') return config?.model || null;
  // 문 모델이 있으면 그 이름, 아직이면 그 사실이 곧 상태라 제품 이름만 적는다.
  //   (자세한 것은 그 버블이 여는 설치·로그인 창이 말한다 — §5.19 (G) · §5.25 (J) 와 같은 규약.)
  const fallback = engine === 'codex' ? fallbacks?.codex : fallbacks?.local;
  return provider?.modelName || provider?.modelId || fallback || null;
}

// ─── §5.20 — 스크립트 선반 (Shelf) ───

/** 선반 버블 기본 크기 — 항목 4~5줄이 보이는 크기. */
export const SHELF_BUBBLE_DEFAULT_WIDTH = 260;
export const SHELF_BUBBLE_DEFAULT_HEIGHT = 220;

/**
 * 선반 한 장이 가질 수 있는 항목 개수 상한 — **키 개수에 두는 캡**(§9).
 * 값 길이만 자르고 개수를 안 막으면 체크포인트가 조용히 부푼다.
 */
export const SHELF_MAX_ITEMS = 40;

/** 프로젝트당 보관할 선반 개수 상한. 넘으면 오래된 것부터 버린다. */
export const SHELF_BUBBLES_MAX_PER_PROJECT = 20;

/** 선반 이름·항목 이름의 글자 상한. */
export const SHELF_TITLE_MAX = 60;
export const SHELF_LABEL_MAX = 48;

/** 명령·프롬프트 본문 길이 상한. */
export const SHELF_COMMAND_MAX = 2_000;
export const SHELF_PROMPT_MAX = 8_000;

/** 셸 항목 한 번의 실행에 주는 시간. 넘으면 프로세스 트리를 정리하고 `failed` 로 적는다. */
export const SHELF_RUN_TIMEOUT_MS = 120_000;

/** 결과에 남기는 출력 꼬리 길이. 넘으면 앞을 버리고 `outputTruncated=true`. */
export const SHELF_RUN_OUTPUT_MAX_CHARS = 8_000;

/** 프롬프트 항목이 새로 만드는 카드를 놓을 자리 — 선반 오른쪽으로 이만큼 띄운다. */
export const SHELF_CARD_OFFSET_X = 320;

/** 내보내기 파일 스키마 버전. 모르는 버전은 가져오기에서 거절한다. */
export const SHELF_EXPORT_VERSION = 1;

/**
 * §5.20 — 항목 글리프 고정 목록. 클라이언트가 이 이름과 1:1로 인라인 stroke SVG 를 그린다.
 * 여기 없는 이름은 저장 단계에서 기본값으로 되돌린다(이모지·임의 문자열 차단).
 */
export const SHELF_ICONS: readonly ShelfIconName[] = [
  'terminal',
  'play',
  'rocket',
  'wrench',
  'bug',
  'sparkles',
  'refresh',
  'package',
  'database',
  'search',
  'doc',
  'shield',
] as const;

/** 항목 기본 글리프 — 셸은 터미널, 프롬프트는 반짝임. */
export const SHELF_DEFAULT_ICON: Record<ShelfItemKind, ShelfIconName> = {
  command: 'terminal',
  prompt: 'sparkles',
};

/**
 * §5.20 — 항목 색 팔레트. 캔버스 버블 색과 부딪히지 않도록 **채도를 한 단계 낮춘 600 계열**만 쓴다.
 * 여기 없는 값은 저장 단계에서 기본값으로 되돌린다.
 */
export const SHELF_ITEM_COLORS: readonly string[] = [
  '#0891B2', // cyan-600 — 선반 기본
  '#2563EB', // blue-600
  '#7C3AED', // violet-600
  '#059669', // emerald-600
  '#CA8A04', // yellow-600
  '#EA580C', // orange-600
  '#475569', // slate-600
  '#BE123C', // rose-700
] as const;

/** 항목 기본 색 — 선반 자신의 색과 같다. */
export const SHELF_DEFAULT_ITEM_COLOR = SHELF_ITEM_COLORS[0]!;

/** 내보내기 파일이 담을 수 있는 항목 수 — 가져오기에서 이 개수까지만 받는다. */
export const SHELF_IMPORT_MAX_ITEMS = SHELF_MAX_ITEMS;

/** 목록 밖 글리프 이름이면 기본값으로 되돌린다. */
export function normalizeShelfIcon(icon: unknown, kind: ShelfItemKind): ShelfIconName {
  return typeof icon === 'string' && (SHELF_ICONS as readonly string[]).includes(icon)
    ? (icon as ShelfIconName)
    : SHELF_DEFAULT_ICON[kind];
}

/** 팔레트 밖 색이면 기본값으로 되돌린다(대소문자만 다른 값은 받아 준다). */
export function normalizeShelfColor(color: unknown): string {
  if (typeof color !== 'string') return SHELF_DEFAULT_ITEM_COLOR;
  const upper = color.trim().toUpperCase();
  const hit = SHELF_ITEM_COLORS.find((c) => c.toUpperCase() === upper);
  return hit ?? SHELF_DEFAULT_ITEM_COLOR;
}

/** §5.20 — 가져오기가 만들어 내는 항목 초안(서버가 id·시각을 붙인다). */
export interface ShelfImportDraftItem {
  label: string;
  kind: ShelfItemKind;
  command?: string;
  prompt?: string;
  icon: ShelfIconName;
  color: string;
}

/** §5.20 — 가져오기 판정 결과. 거절도 값으로 돌려준다(던지지 않는다 — 화면이 사유를 보여야 한다). */
export interface ShelfImportResult {
  ok: boolean;
  /** 거절 사유(사람이 읽는 한 줄). `ok=false` 일 때만. */
  error?: string;
  /** 파일이 말한 선반 이름 — 새 선반을 만들 때 제안값으로만 쓴다. */
  title?: string;
  items: ShelfImportDraftItem[];
  /** 상한·빈 본문에 걸려 버린 항목 수. 0 이면 전부 받았다. */
  dropped: number;
}

/**
 * §5.20 — 가져온 JSON 을 믿지 않는다(클라·서버 공용): 모르는 스키마 버전 거절 · 런타임 필드(id·lastRun·에이전트 id·`cwd`) 무시 ·
 * 아이콘·색은 고정 목록으로 · 본문 길이 상한 · 개수는 `SHELF_IMPORT_MAX_ITEMS` 까지.
 */
export function normalizeShelfImport(raw: unknown): ShelfImportResult {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, error: 'not a shelf file', items: [], dropped: 0 };
  }
  const obj = raw as Record<string, unknown>;
  const version = typeof obj['version'] === 'number' ? obj['version'] : 0;
  if (version !== SHELF_EXPORT_VERSION) {
    return { ok: false, error: `unsupported version: ${version}`, items: [], dropped: 0 };
  }
  const rawItems = Array.isArray(obj['items']) ? obj['items'] : null;
  if (!rawItems) {
    return { ok: false, error: 'items must be an array', items: [], dropped: 0 };
  }

  const items: ShelfImportDraftItem[] = [];
  let dropped = 0;
  for (const entry of rawItems) {
    if (entry === null || typeof entry !== 'object') {
      dropped += 1;
      continue;
    }
    const it = entry as Record<string, unknown>;
    const kind: ShelfItemKind = it['kind'] === 'prompt' ? 'prompt' : 'command';
    const label = typeof it['label'] === 'string' ? it['label'].trim().slice(0, SHELF_LABEL_MAX) : '';
    const command = typeof it['command'] === 'string' ? it['command'].trim().slice(0, SHELF_COMMAND_MAX) : '';
    const prompt = typeof it['prompt'] === 'string' ? it['prompt'].trim().slice(0, SHELF_PROMPT_MAX) : '';
    // 실행 내용이 비어 있으면 눌러도 아무 일도 없는 줄이다 — 받지 않는다.
    const body = kind === 'command' ? command : prompt;
    if (!body || items.length >= SHELF_IMPORT_MAX_ITEMS) {
      dropped += 1;
      continue;
    }
    items.push({
      label: label || body.split('\n')[0]!.slice(0, SHELF_LABEL_MAX),
      kind,
      ...(kind === 'command' ? { command } : { prompt }),
      icon: normalizeShelfIcon(it['icon'], kind),
      color: normalizeShelfColor(it['color']),
    });
  }

  const title = typeof obj['title'] === 'string' ? obj['title'].trim().slice(0, SHELF_TITLE_MAX) : '';
  return { ok: true, ...(title ? { title } : {}), items, dropped };
}

// ─── §5.21 — 비용·토큰 지도 (Cost Map) ───

/** 지도 스윕 주기(ms). 훅 이벤트마다 재파싱하지 마라(전수 재파싱이 프리즈를 부른다) — 활성 세션만, mtime·size 가 그대로면 열지도 않는다. */
export const COST_MAP_SWEEP_INTERVAL_MS = 20_000;

/**
 * 이 시간보다 오래 조용한 세션은 스윕에서 건너뛴다 — 이미 원장에 있는 세션은 값이 변할 수 없다.
 * (원장에 아직 없는 세션은 조용하더라도 한 번은 읽는다.)
 */
export const COST_MAP_ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 세션 원장 상한(키 개수 캡 — §9). 넘치면 오래된 순으로 빠지고 그 몫은 `retired` 로 접힌다. */
export const COST_MAP_SESSIONS_MAX = 400;

/** 에이전트 합계 상한(키 개수 캡). 비용 내림차순으로 남긴다. */
export const COST_MAP_AGENTS_MAX = 200;

/** 날짜 버킷 보관 일수(키 개수 캡). 최신 순으로 남긴다. */
export const COST_MAP_DAYS_MAX = 180;

/** 툴팁에 이름을 대 줄 단가 미상 모델 수 상한(§9) — 길면 소음이다. */
export const COST_MAP_UNSEEDED_MODELS_MAX = 8;

/** 이 금액을 넘으면 배지·표가 경고 색으로 바뀐다(USD). */
export const COST_WARN_USD = 5;

/** 이 금액을 넘으면 위험 색(USD). */
export const COST_DANGER_USD = 20;

/** 팝업 기간 탭 순서. */
export const COST_PERIODS: readonly CostPeriod[] = ['today', 'week', 'month', 'all'] as const;

/** 0 으로 채운 합계 한 벌(새 객체 — 공유 참조를 돌려주지 않는다). */
export function emptyCostTotals(): CostTotals {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0 };
}

/** 합계 둘을 더한 **새** 객체. 어느 쪽도 변형하지 않는다. */
export function addCostTotals(a: CostTotals, b: CostTotals): CostTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreateTokens: a.cacheCreateTokens + b.cacheCreateTokens,
    costUsd: a.costUsd + b.costUsd,
    // 추정은 **전염된다** — 한쪽이라도 단가 미상의 몫을 담고 있으면 합계도 추정이다.
    // 접는 자리(날짜·기간·에이전트·프로젝트)가 전부 이 함수를 지나므로 여기서 한 번만 OR 한다.
    ...(a.estimated || b.estimated ? { estimated: true } : {}),
  };
}

/** 합계의 토큰 총량(4종 합) — 표에서 "토큰" 한 칸에 쓰는 값. */
export function costTokenTotal(t: CostTotals): number {
  return t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheCreateTokens;
}

/** 이 합계가 실제로 무언가를 담고 있는가(토큰이든 비용이든). */
export function hasCostActivity(t: CostTotals): boolean {
  return costTokenTotal(t) > 0 || t.costUsd > 0;
}

/**
 * epoch ms → **로컬** 날짜 키(`YYYY-MM-DD`).
 * UTC 로 접으면 사용자가 보는 달력과 하루가 어긋난다(밤에 돌린 세션이 내일로 넘어감).
 */
export function costDayKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 기간의 시작 시각(epoch ms). 주는 **월요일 시작**, 달은 1일 0시.
 * `all` 은 0(=전부).
 */
export function costPeriodStart(period: CostPeriod, now: number): number {
  if (period === 'all') return 0;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === 'today') return d.getTime();
  if (period === 'week') {
    // getDay(): 0=일요일 → 월요일 기준으로 되돌리려면 (day+6)%7 일만큼 뺀다.
    const back = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - back);
    return d.getTime();
  }
  d.setDate(1);
  return d.getTime();
}

/** 날짜 키가 그 기간 안인가. 키 자체가 로컬 날짜라 시작일 키와 문자열 비교로 충분하다. */
export function isCostDayInPeriod(date: string, period: CostPeriod, now: number): boolean {
  if (period === 'all') return true;
  return date >= costDayKey(costPeriodStart(period, now));
}

/** 날짜 버킷들에서 한 기간의 합을 접는다. */
export function sumCostDays(
  days: readonly (CostTotals & { date: string })[],
  period: CostPeriod,
  now: number,
): CostTotals {
  let acc = emptyCostTotals();
  for (const d of days) {
    if (!isCostDayInPeriod(d.date, period, now)) continue;
    acc = addCostTotals(acc, d);
  }
  return acc;
}

/** 기간 프리셋 4종을 한 번에 접는다. */
export function buildCostPeriodTotals(
  days: readonly (CostTotals & { date: string })[],
  now: number,
): CostPeriodTotals {
  return {
    today: sumCostDays(days, 'today', now),
    week: sumCostDays(days, 'week', now),
    month: sumCostDays(days, 'month', now),
    all: sumCostDays(days, 'all', now),
  };
}

/** §5.21 — 금액 색조. 배지와 표가 같은 함수를 통과해야 같은 금액이 두 화면에서 같은 색이 된다. */
export type CostTone = 'none' | 'normal' | 'warn' | 'danger';

/**
 * 금액 → 색조. `measured:false`(턴을 못 읽음)는 `none` 이고 화면은 0 이 아니라 "측정 없음"을 쓴다.
 */
export function costTone(costUsd: number | undefined, measured = true): CostTone {
  if (!measured || costUsd === undefined) return 'none';
  if (costUsd >= COST_DANGER_USD) return 'danger';
  if (costUsd >= COST_WARN_USD) return 'warn';
  return 'normal';
}

/**
 * 금액 표기. 아주 작은 값이 `$0.00` 으로 뭉개지지 않게 1센트 미만은 소수 3자리까지 쓴다.
 * 표시 전용 — 계산에 되먹이지 않는다.
 */
export function formatCostUsd(costUsd: number): string {
  if (costUsd > 0 && costUsd < 0.01) return `$${costUsd.toFixed(3)}`;
  if (costUsd >= 1000) return `$${Math.round(costUsd).toLocaleString('en-US')}`;
  return `$${costUsd.toFixed(2)}`;
}

/** 토큰 수 표기(1.2M / 34.5K / 812). 표 칸이 좁아 자리수를 고정한다. */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(Math.round(tokens));
}

// ─── 권한·감사 경계 (§5.22) ───
// 판정은 여기 한 곳 — 서버(사전 승인)와 클라(배지)가 같은 답을 말해야 한다. 패턴은 아래 테이블에서만(§3.3).

/** 위험 종류 표시 순서(배지·스위치 공용). */
export const AUDIT_RISK_KINDS: readonly AuditRiskKind[] = ['delete', 'network', 'config', 'outside'] as const;

// 프로젝트당 원장 상한(`AUDIT_ENTRIES_MAX_PER_PROJECT`)은 이 파일 위쪽 **보존 정책(§3.2.3)** 블록에
// 산다 — 못박힌 상한이 아니라 `RetentionSettings.auditEntryMaxPerProject` 의 기본값이라
// `DEFAULT_RETENTION_SETTINGS` 가 초기화되는 시점에 이미 선언돼 있어야 한다.

/** 요약 한 줄 길이 상한 — 원장이 두 번째 트랜스크립트가 되지 않게. */
export const AUDIT_SUMMARY_MAX_CHARS = 200;

/** 대상(경로·호스트) 길이 상한. */
export const AUDIT_TARGET_MAX_CHARS = 160;

/** 거부 사유 보관 길이 상한. */
export const AUDIT_REASON_MAX_CHARS = 200;

/** 타임라인 팝업이 한 번에 그리는 줄 수(더 보기로 늘린다). */
export const AUDIT_TIMELINE_PAGE_SIZE = 60;

/** 전선에 싣는 감사 줄 수(§9) — 원장 전량(프로젝트당 500)은 체크포인트와 `GET /api/audit-log` 에. */
export const AUDIT_SNAPSHOT_ENTRIES = 120;

// ─── 컨텍스트 보험 (§5.26) ───
// 보존 축은 위쪽 보존 정책(§3.2.3)의 `RetentionSettings` 기본값이다. 여기는 조절하지 않는 판정·형식 상수.

/** 저장고 폴더 이름 — `<projectPath>/.vibisual/insurance/`. */
export const INSURANCE_DIR = 'insurance';

/** 내용 주소 지정 blob 이 사는 하위 폴더. */
export const INSURANCE_BLOBS_DIR = 'blobs';

/** 트랜스크립트 미러가 사는 하위 폴더. */
export const INSURANCE_TRANSCRIPTS_DIR = 'transcripts';

/**
 * 트랜스크립트가 **갈아치워졌는지** 판정하려고 해시하는 앞부분 바이트 수.
 * 크기·mtime 만으로는 "같은 경로에 다른 세션 파일이 앉은 경우"를 가리지 못한다.
 */
export const INSURANCE_HEAD_HASH_BYTES = 64 * 1024;

/** 마커에 담는 마지막 assistant 텍스트 꼬리 길이 — 원장이 두 번째 트랜스크립트가 되지 않게. */
export const INSURANCE_TAIL_MAX_CHARS = 400;

/** `workingSet` 의 배열 축 하나가 담는 최대 항목 수(파일·작업·단계·팀원 공통). */
export const INSURANCE_WORKING_SET_MAX = 40;

/**
 * §5.26 (C) — 사본을 뜨는 파일 크기 상한. 넘으면 `skipped: 'too-large'` 로 **남긴다**.
 * 조용히 건너뛰면 화면은 되돌릴 수 있다고 말하는데 실제로는 없다.
 */
export const INSURANCE_PREIMAGE_MAX_BYTES = 2 * 1024 * 1024;

/** §5.26 (D) — 압축 증거(`compact_boundary`·`PostCompact`)는 있고 요약만 못 읽을 때 미루는 시간(요약은 곧 온다). 증거가 없을 때는 `INSURANCE_COMPACT_VERDICT_MS`. */
export const INSURANCE_COMPACT_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * §5.26 (D) — 증거가 없을 때 교착으로 적기까지의 시간. 줄이지 마라 — 2026-09-23 실측: 3분이면 실패 10건 중 7건이 오탐(요약 +2·+9·+28분 도착).
 * 진짜 막힌 세션은 그대로라 늦게 알려도 된다.
 */
export const INSURANCE_COMPACT_VERDICT_MS = 30 * 60 * 1000;

/** §5.26 (D) — 한 스윕의 요약 찾기 총 바이트 상한(§3.2.4 G축) — 마커별 상한만이면 마커 수만큼 곱해진다. 예산이 떨어진 마커는 다음 스윕이 이어 읽는다. */
export const INSURANCE_SCAN_BUDGET_BYTES = 4 * 1024 * 1024;

/** §5.26 (D) — 요약 구간을 읽을 때 한 번에 훑는 최대 바이트(§3.2.4 G축 — 읽기 피크 상한). */
export const INSURANCE_SUMMARY_SCAN_MAX_BYTES = 512 * 1024;
/** §7.23 — 세션 제목용 JSONL 앞 읽기 상한. 서브에이전트 프롬프트는 카드 규약 때문에 7KB 를 넘기 일쑤라(실측) `Task:` 줄까지 들게 32KB. */
export const INSURANCE_TITLE_SCAN_MAX_BYTES = 32 * 1024;

/**
 * §5.26 (F) — 넘었는데 압축이 안 오면 `overdue`. ⚠ 분모는 창이 아니라 접기로 한 선이다((F)(a)) — 창으로 재면 1M 창·자동압축 400k 세션이 무보험이 된다.
 * `stalled` 분모는 창이 맞다(CLI 는 창에 닿을 때 멈춘다).
 */
export const INSURANCE_OVERDUE_RATIO = 0.95;

/**
 * §5.26 (F)(b) — `/compact` 뒤 `PreCompact` 대기. 넘으면 `rejected` — CLI 는 거절도 `is_error: false` 라(실측 2.1.263) 시간 초과가 유일한 증거다.
 * 90초는 앞 턴 뒤 큐 대기를 덮는 폭.
 */
export const INSURANCE_COMPACT_SEND_TIMEOUT_MS = 90 * 1000;

/** §5.26 (F) — 이 비율을 넘으면 `stalled`(CLI 가 곧 스스로 멈춘다 — #66144 계열). */
export const INSURANCE_STALL_RATIO = 0.99;

/** §5.26 (F) — 마지막 압축 이후 이만큼 지나야 `overdue` 를 띄운다(막 지난 압축을 고장으로 읽지 않게). */
export const INSURANCE_OVERDUE_MS = 3 * 60 * 1000;

/**
 * §5.26 (F) — 마지막 압축 이후 트랜스크립트가 이만큼 자랐어야 "아직 일하는 중"으로 본다.
 * 이 조건이 없으면 **멈춰 서서 꽉 찬 채로 놀고 있는 세션**까지 경고가 뜬다.
 */
export const INSURANCE_OVERDUE_GROWTH_BYTES = 32 * 1024;

/** §5.26 (E) — 복원 브리핑 블록 길이 상한. 넘치면 최근 것부터 남기고 접는다. */
export const INSURANCE_BRIEF_MAX_CHARS = 1200;

/** §5.26 (E) — 같은 파일이 이 횟수를 넘게 압축에서 떨어지면 Brain 후보로 올린다(자동 등록 ❌). */
export const INSURANCE_LESSON_REPEAT = 3;

/** §5.26 (G) — 이 크기를 넘는 트랜스크립트는 `--resume` 이 깨진다는 보고가 있다(#30302). */
export const INSURANCE_RESUME_RISK_BYTES = 8 * 1024 * 1024;

/**
 * §5.26 (G) — 부활 후 첫 턴 입력이 죽기 전 컨텍스트의 이 비율 미만이면 **문맥이 안 실린 것**으로 본다(#43696).
 * `--resume` 은 성공한 얼굴로 빈 문맥을 주므로 성공/실패 코드로는 가릴 수 없다.
 */
export const INSURANCE_RESUME_SHORTFALL_RATIO = 0.3;

/** §5.26 — 전선에 싣는 마커 줄 수(§9). 전량은 체크포인트와 `GET /api/insurance` 에. */
export const INSURANCE_SNAPSHOT_MARKERS = 30;

/** §5.26 — 전선에 싣는 파일 사본 줄 수(§9). */
export const INSURANCE_SNAPSHOT_PREIMAGES = 60;

/** §5.26 (I) — 보험 팝업이 한 번에 그리는 줄 수(더 보기로 늘린다). */
export const INSURANCE_LIST_PAGE_SIZE = 40;

/** 파일 경로를 입력으로 받는 쓰기 도구 — 이 도구가 설정 파일을 향하면 `config` 위험. */
export const AUDIT_WRITE_TOOLS: ReadonlySet<string> = new Set([
  'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
]);

/** 이름만으로 바깥과 말한다고 볼 수 있는 도구. */
export const AUDIT_NETWORK_TOOLS: ReadonlySet<string> = new Set([
  'WebFetch', 'WebSearch',
]);

/** 지우는 명령(셸 명령 문자열 대상). */
export const AUDIT_DELETE_PATTERNS: readonly RegExp[] = [
  /\brm\s+-\w*[rf]/i,
  /\brm\s+["'./~$\\]/i,
  /\brmdir\b/i,
  /\bunlink\s+\S/i,
  /\bshred\b/i,
  /\btruncate\s+-s\s*0/i,
  /\bRemove-Item\b/i,
  /\bdel\s+\/[a-z]/i,
  /\bgit\s+clean\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+checkout\s+--\s/i,
  /\bgit\s+branch\s+-D\b/i,
  /\bgit\s+push\s+.*--force\b/i,
  /\bdd\s+if=/i,
  /\bmkfs\b/i,
  /\bdrop\s+(table|database)\b/i,
];

/** 바깥과 말하는 명령(셸 명령 문자열 대상). 루프백만 가리키면 아래 예외가 걷어낸다. */
export const AUDIT_NETWORK_PATTERNS: readonly RegExp[] = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bInvoke-WebRequest\b/i,
  /\bInvoke-RestMethod\b/i,
  /\bssh\b\s+\S/i,
  /\bscp\b\s+\S/i,
  /\brsync\b\s+\S/i,
  /\bnc\s+-\w*\s*\S/i,
  /\btelnet\b/i,
  /\bftp\b/i,
  /\bgit\s+(push|clone|fetch|pull|remote\s+add)\b/i,
  /\bnpm\s+publish\b/i,
  /\bpnpm\s+publish\b/i,
  /\bgh\s+(pr|release|repo|api|issue)\b/i,
  /\bdocker\s+push\b/i,
];

/** 명령·URL 에서 http(s) 주소를 뽑는 패턴(루프백 예외 판정용). */
export const AUDIT_URL_PATTERN = /https?:\/\/[^\s'"`)\\]+/gi;

/** 우리 자신에게 가는 호출은 "바깥으로 나간 것"이 아니다(작업 신고 카드 curl 이 매번 걸리는 것을 막는다). */
export const AUDIT_LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  'localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]',
]);

/** 설정 파일 경로(파일 경로 또는 명령 문자열 대상). */
export const AUDIT_CONFIG_PATH_PATTERNS: readonly RegExp[] = [
  /(^|[\\/])\.claude[\\/]/i,
  /(^|[\\/])settings(\.local)?\.json$/i,
  /(^|[\\/])settings(\.local)?\.json\b/i,
  /(^|[\\/])\.env(\.[\w-]+)?$/i,
  /(^|[\\/])\.env(\.[\w-]+)?\b/i,
  /(^|[\\/])\.mcp\.json\b/i,
  /(^|[\\/])CLAUDE\.md\b/i,
  /(^|[\\/])package\.json\b/i,
  /(^|[\\/])tsconfig([\w.-]+)?\.json\b/i,
  /(^|[\\/])pnpm-workspace\.yaml\b/i,
  /(^|[\\/])\.npmrc\b/i,
  /(^|[\\/])\.gitignore\b/i,
  /(^|[\\/])\.git[\\/]config\b/i,
  /(^|[\\/])\.vscode[\\/]/i,
  /(^|[\\/])hosts$/i,
];

/** 설정을 바꾸는 손짓 — 명령이 설정 경로를 **건드릴 때만** `config` 로 본다(읽기만 하는 grep 은 제외). */
export const AUDIT_CONFIG_MUTATION_PATTERNS: readonly RegExp[] = [
  />>?\s*\S/,
  /\bsed\s+-i\b/i,
  /\b(cp|mv|copy|move)\b/i,
  /\btee\b/i,
  /\bSet-Content\b/i,
  /\bAdd-Content\b/i,
  /\bOut-File\b/i,
  /\b(npm|pnpm|yarn|git)\s+config\s+set\b/i,
  /\bclaude\s+config\b/i,
  /\bsetx?\b\s+\w+=/i,
];

/** 경로 입력 도구 — `outside` 는 읽기도 본다(§5.22 — `AUDIT_WRITE_TOOLS` 와 일부러 따로). 이름 아는 도구로 한정한다(MCP 의 `path` 는 파일 경로가 아닐 수 있다). */
export const AUDIT_PATH_INPUT_TOOLS: ReadonlySet<string> = new Set([
  'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'NotebookRead', 'Glob', 'Grep', 'LS',
]);

/** 경로가 담겨 오는 입력 칸(도구마다 이름이 다르다). 요약·판정이 같은 목록을 본다. */
export const AUDIT_PATH_INPUT_KEYS: readonly string[] = [
  'file_path', 'notebook_path', 'path', 'target_file',
];

/** §5.22 · §5.25 (H) — 입력이 패치 본문인 도구(코덱스 `apply_patch` — 훅은 `command` 칸에 싣는다). 명령으로 읽으면 본문의 `rm -rf` 가 위험으로 찍힌다. */
export const AUDIT_PATCH_TOOLS: ReadonlySet<string> = new Set(['apply_patch']);

/** 패치 본문이 담겨 오는 입력 칸. */
export const AUDIT_PATCH_INPUT_KEYS: readonly string[] = ['command', 'input', 'patch'];

/** 패치 머리줄 — `*** Add File: <path>` · `*** Update File: <path>` · `*** Delete File: <path>`. */
export const AUDIT_PATCH_FILE_HEADER_PATTERN = /^\*\*\* (Add|Update|Delete) File: (.+)$/;

/** 패치의 이름 바꾸기 머리줄 — `*** Move to: <path>`. */
export const AUDIT_PATCH_MOVE_HEADER_PATTERN = /^\*\*\* Move to: (.+)$/;

/** 절대경로처럼 생긴 낱말(명령에서 뽑은 토큰 하나를 검사한다). */
export const AUDIT_ABSOLUTE_PATH_PATTERNS: readonly RegExp[] = [
  /^[A-Za-z]:[\\/]/,   // C:\… · C:/…
  /^[\\/]{2}[^\\/]/,   // \\server\share (UNC)
  /^[\\/][^\\/]/,      // /etc/hosts
  /^~[\\/]/,           // ~/.claude/… (홈을 모르면 밖으로 본다)
];

/** `~` 앞머리 — 홈으로 편다(`homeDir` 를 받았을 때만). */
export const AUDIT_HOME_PREFIX_PATTERN = /^~[\\/]/;

/**
 * win32 의 msys 경로(`/c/Users/…`)를 드라이브 경로로 되돌린다.
 * Git Bash 로 도는 Bash 도구가 이 모양을 쓰므로, 안 되돌리면 프로젝트 안 경로가 전부 밖으로 찍힌다.
 */
export const AUDIT_MSYS_PATH_PATTERN = /^\/([A-Za-z])(\/|$)/;

/** `..` 로 위를 향하는 상대경로(`cd ..` · `../../other/x`). 절대경로가 아니어도 밖일 수 있다. */
export const AUDIT_RELATIVE_ESCAPE_PATTERN = /(^|[\\/])\.\.([\\/]|$)/;

/** 장치·의사 경로 — 밖으로 세지 않는다(`> /dev/null` 마다 배지가 서면 뜻을 잃는다). */
export const AUDIT_OUTSIDE_IGNORE_PATTERNS: readonly RegExp[] = [
  /^\/dev\//i,
  /^\/proc\//i,
  /^\/sys\//i,
];

/** 명령 낱말에서 경로만 남기려고 걷어내는 껍데기(리다이렉션 앞머리·따옴표·꼬리 문장부호). */
export const AUDIT_TOKEN_WRAPPER_PATTERNS: readonly RegExp[] = [
  /^[0-9]*[<>|&;(]+/,
  /^["'`]+/,
  /["'`,;)]+$/,
];

/** `--out=/tmp/x` 처럼 플래그 값으로 붙어 온 경로. */
export const AUDIT_TOKEN_FLAG_VALUE_PATTERN = /^-[^\s=]*=(.+)$/;

/** 플랫폼을 모를 때 경로 비교에 쓰는 값 — **접는 쪽**이다(`pathCase.ts` 규약: 모르면 안전하게 접는다). */
export const AUDIT_FALLBACK_PATH_PLATFORM: PlatformName = 'win32';

/**
 * 기본은 꺼짐(§5.22) — 이 경계는 사용자가 고른 권한 모드를 되무르므로 기본으로 켜면 `bypassPermissions` 가 설명 없이 무효가 된다. 꺼져도 기록은 계속된다.
 * `kinds` 는 켬 그대로. 기본값은 이 상수에서만 읽는다(서버·체크포인트·클라가 각자 들면 화면마다 달라진다).
 */
export const DEFAULT_AUDIT_BOUNDARY: AuditBoundaryConfig = {
  escalateRisky: false,
  kinds: { delete: true, network: true, config: true, outside: true },
};

function auditClip(value: string, max: number): string {
  const s = value.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function auditFirstString(input: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function auditMatches(value: string, patterns: readonly RegExp[]): boolean {
  // 전역 플래그가 없는 패턴만 담으므로 lastIndex 오염 없음.
  return patterns.some((re) => re.test(value));
}

/** URL·호스트 문자열이 우리 자신(루프백)을 가리키는가. */
export function isAuditLoopbackTarget(value: string): boolean {
  const m = value.match(/^(?:[a-z][\w+.-]*:\/\/)?(?:[^@\s/]*@)?([^\s/:?#]+)/i);
  const host = (m?.[1] ?? value).toLowerCase();
  if (AUDIT_LOOPBACK_HOSTS.has(host)) return true;
  return host.endsWith('.localhost');
}

/** 명령 안의 http(s) 주소가 **하나 이상 있고 전부** 루프백인가. */
function auditLoopbackOnly(command: string): boolean {
  const urls = command.match(AUDIT_URL_PATTERN);
  if (!urls || urls.length === 0) return false;
  return urls.every((u) => isAuditLoopbackTarget(u));
}

// ─── `outside` — 고른 폴더 밖인가 (§5.22) ───
// 정규식은 위 테이블에서만(§3.3). 플랫폼은 인자 — shared 는 브라우저에서도 로드되고, 그래야 세 OS 를 시험한다.

/** 경로의 앞머리(드라이브 루트·UNC·POSIX 루트)를 가려내는 모양 — 위험 패턴이 아니라 경로 구조다. */
const AUDIT_DRIVE_ROOT_SHAPE = /^[A-Za-z]:\//;

/** 절대경로인가(플랫폼 무관 — 세 OS 의 모양을 전부 안다). */
function auditIsAbsolutePath(p: string): boolean {
  return auditMatches(p, AUDIT_ABSOLUTE_PATH_PATTERNS);
}

/** `~` 를 홈으로 편다. 홈을 모르면 그대로 두어 밖으로 남는다(모르는 값을 지어내지 않는다). */
function auditExpandHome(p: string, homeDir?: string): string {
  if (!homeDir) return p;
  if (p === '~') return homeDir;
  if (AUDIT_HOME_PREFIX_PATTERN.test(p)) return `${homeDir}/${p.slice(2)}`;
  return p;
}

/** win32 에서만 msys 경로(`/c/Users/…`)를 드라이브 경로로 되돌린다. */
function auditFromMsysPath(p: string, platform: PlatformName): string {
  if (platform !== 'win32') return p;
  const m = p.match(AUDIT_MSYS_PATH_PATTERN);
  if (!m || !m[1]) return p;
  return `${m[1]}:/${p.slice(3)}`;
}

/** `.`/`..` 를 접어 비교할 수 있는 한 모양으로 만든다. 루트 위로는 올라가지 않는다. */
function auditCollapsePath(p: string): string {
  const shaped = normalizePathShape(p);
  let prefix = '';
  let rest = shaped;
  const drive = shaped.match(AUDIT_DRIVE_ROOT_SHAPE);
  if (drive) {
    prefix = drive[0];
    rest = shaped.slice(drive[0].length);
  } else if (shaped.startsWith('//')) {
    prefix = '//';
    rest = shaped.slice(2);
  } else if (shaped.startsWith('/')) {
    prefix = '/';
    rest = shaped.slice(1);
  }
  const out: string[] = [];
  for (const seg of rest.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return `${prefix}${out.join('/')}`;
}

/** §5.22 — 경계 전부의 밖인가. `roots` 가 비면 false(등록 전 호출이 다 밖이 되지 않게), 하나에라도 들면 안. 상대경로는 각 root 에 붙여 접는다. */
export function isAuditPathOutside(
  rawPath: string,
  roots: readonly string[],
  platform: PlatformName,
  homeDir?: string,
): boolean {
  if (roots.length === 0) return false;
  const trimmed = rawPath.trim();
  if (!trimmed) return false;
  const expanded = auditFromMsysPath(auditExpandHome(trimmed, homeDir), platform);
  const shaped = normalizePathShape(expanded);
  if (!shaped) return false;
  if (auditMatches(shaped, AUDIT_OUTSIDE_IGNORE_PATTERNS)) return false;

  const absolute = auditIsAbsolutePath(shaped);
  for (const root of roots) {
    if (!root || !root.trim()) continue;
    const rootShaped = normalizePathShape(auditFromMsysPath(root.trim(), platform));
    const rootKey = pathKey(auditCollapsePath(rootShaped), platform);
    if (!rootKey) continue;
    const resolved = absolute ? shaped : `${rootShaped}/${shaped}`;
    const key = pathKey(auditCollapsePath(resolved), platform);
    const prefix = rootKey.endsWith('/') ? rootKey : `${rootKey}/`;
    if (key === rootKey || key.startsWith(prefix)) return false;
  }
  return true;
}

/** 명령 낱말 하나에서 껍데기를 걷어내 경로만 남긴다. */
function auditStripToken(raw: string): string {
  let s = raw.trim();
  const flagValue = s.match(AUDIT_TOKEN_FLAG_VALUE_PATTERN);
  if (flagValue && flagValue[1]) s = flagValue[1];
  for (const re of AUDIT_TOKEN_WRAPPER_PATTERNS) s = s.replace(re, '');
  return s.trim();
}

/** 명령 문자열의 경로 후보. URL 을 먼저 걷는다 — `https://` 의 `//` 가 POSIX 절대경로로 읽혀 모든 curl 이 밖이 된다. */
function auditCommandPathCandidates(command: string): string[] {
  const withoutUrls = command.replace(AUDIT_URL_PATTERN, ' ');
  const out: string[] = [];
  for (const raw of withoutUrls.split(/\s+/)) {
    const token = auditStripToken(raw);
    if (!token) continue;
    if (auditIsAbsolutePath(token) || AUDIT_RELATIVE_ESCAPE_PATTERN.test(token)) out.push(token);
  }
  return out;
}

/** 패치 머리줄에서 뽑은 파일 조작 한 건. `move` 는 `Update File` 뒤에 붙는 새 이름이다. */
export interface AuditPatchFileOp {
  op: 'add' | 'update' | 'delete' | 'move';
  path: string;
}

/**
 * §5.22 · §5.25 (H) — 패치 본문의 머리줄만 읽어 파일 조작을 뽑는다. 본문(`+`·`-`·문맥 줄)은
 * 보지 않는다 — 거기 적힌 명령이나 경로는 **파일 내용**이지 이 호출이 한 일이 아니다.
 */
export function extractPatchFileOps(patch: string): AuditPatchFileOp[] {
  const out: AuditPatchFileOp[] = [];
  for (const rawLine of patch.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const file = line.match(AUDIT_PATCH_FILE_HEADER_PATTERN);
    if (file && file[1] && file[2]?.trim()) {
      out.push({ op: file[1].toLowerCase() as AuditPatchFileOp['op'], path: file[2].trim() });
      continue;
    }
    const moved = line.match(AUDIT_PATCH_MOVE_HEADER_PATTERN);
    if (moved && moved[1]?.trim()) out.push({ op: 'move', path: moved[1].trim() });
  }
  return out;
}

/**
 * 패치 도구 입력에서 본문을 꺼낸다. 패치 도구가 아니면 undefined.
 * §5.25 (F) 코덱스 패치 장부도 이 한 곳에서 본문을 꺼낸다 — 실리는 칸(`AUDIT_PATCH_INPUT_KEYS`)을 두 벌로 두지 않는다.
 */
export function auditPatchText(toolName: string, input: Record<string, unknown>): string | undefined {
  if (!AUDIT_PATCH_TOOLS.has(toolName)) return undefined;
  return auditFirstString(input, AUDIT_PATCH_INPUT_KEYS) ?? '';
}

/** §5.22 — `outside` 판정에 넘기는 경계. 서버가 프로젝트 루트와 세션 cwd 를 실어 준다. */
export interface AuditRiskOptions {
  /** 이 호출이 머물러야 할 경계들. 비면 `outside` 를 판정하지 않는다. */
  roots?: readonly string[];
  /** 경로 대소문자 규칙을 정하는 플랫폼(shared 는 `process.platform` 을 읽지 않는다). */
  platform?: PlatformName;
  /** `~` 를 펴는 홈 디렉터리. 없으면 `~` 로 시작하는 경로는 밖으로 본다. */
  homeDir?: string;
}

/**
 * §5.22 — 위험 판정. 빈 배열이면 평범한 호출이다.
 * 서버(사전 승인)와 클라(배지)가 **같은 이 함수**를 쓴다.
 */
export function classifyToolRisk(
  toolName: string,
  toolInput?: Record<string, unknown> | null,
  options?: AuditRiskOptions,
): AuditRiskKind[] {
  const input = toolInput ?? {};
  const patch = auditPatchText(toolName, input);
  if (patch !== undefined) return classifyPatchRisk(extractPatchFileOps(patch), options);
  const command = typeof input['command'] === 'string' ? input['command'] : '';
  const url = auditFirstString(input, ['url', 'endpoint']);
  const filePath = auditFirstString(input, AUDIT_PATH_INPUT_KEYS);
  const found = new Set<AuditRiskKind>();

  // ① 바깥과 말하는가 — 루프백(우리 자신)은 바깥이 아니다.
  if (AUDIT_NETWORK_TOOLS.has(toolName) && !(url && isAuditLoopbackTarget(url))) found.add('network');
  if (url && /^https?:/i.test(url) && !isAuditLoopbackTarget(url)) found.add('network');
  if (command && auditMatches(command, AUDIT_NETWORK_PATTERNS) && !auditLoopbackOnly(command)) found.add('network');

  // ② 지우는가.
  if (command && auditMatches(command, AUDIT_DELETE_PATTERNS)) found.add('delete');

  // ③ 설정을 바꾸는가 — 쓰기 도구가 설정 파일을 향하거나, 명령이 설정 경로를 **건드릴 때**.
  if (filePath && AUDIT_WRITE_TOOLS.has(toolName) && auditMatches(filePath, AUDIT_CONFIG_PATH_PATTERNS)) {
    found.add('config');
  }
  if (
    command
    && auditMatches(command, AUDIT_CONFIG_PATH_PATTERNS)
    && auditMatches(command, AUDIT_CONFIG_MUTATION_PATTERNS)
  ) {
    found.add('config');
  }

  // ④ 고른 폴더 **밖**인가 — `config` 와 달리 **읽기도 본다**(§5.22).
  //    경계를 모르면(roots 가 비면) 판정 자체를 하지 않는다 — 없는 근거로 위험을 지어내지 않는다.
  const roots = options?.roots ?? [];
  if (roots.length > 0) {
    const platform = options?.platform ?? AUDIT_FALLBACK_PATH_PLATFORM;
    const home = options?.homeDir;
    const candidates: string[] = [];
    if (AUDIT_PATH_INPUT_TOOLS.has(toolName)) {
      for (const k of AUDIT_PATH_INPUT_KEYS) {
        const v = input[k];
        if (typeof v === 'string' && v.trim()) candidates.push(v.trim());
      }
    }
    if (command) candidates.push(...auditCommandPathCandidates(command));
    if (candidates.some((p) => isAuditPathOutside(p, roots, platform, home))) found.add('outside');
  }

  return AUDIT_RISK_KINDS.filter((k) => found.has(k));
}

/**
 * §5.22 — 패치의 위험. 머리줄의 조작과 경로만 본다: 지우기는 `delete`, 설정 경로를 만들거나
 * 고치거나 지우면 `config`, 경계 밖 경로는 `outside`. 패치는 바깥과 말하지 않으므로 `network` 는 없다.
 */
function classifyPatchRisk(ops: readonly AuditPatchFileOp[], options?: AuditRiskOptions): AuditRiskKind[] {
  const found = new Set<AuditRiskKind>();
  if (ops.some((o) => o.op === 'delete')) found.add('delete');
  if (ops.some((o) => auditMatches(o.path, AUDIT_CONFIG_PATH_PATTERNS))) found.add('config');
  const roots = options?.roots ?? [];
  if (roots.length > 0) {
    const platform = options?.platform ?? AUDIT_FALLBACK_PATH_PLATFORM;
    if (ops.some((o) => isAuditPathOutside(o.path, roots, platform, options?.homeDir))) found.add('outside');
  }
  return AUDIT_RISK_KINDS.filter((k) => found.has(k));
}

/**
 * §5.22 — 원장 한 줄이 보여 줄 요약과 대상. 도구 입력 전문을 담지 않기 위한 접기다.
 */
export function summarizeToolCall(
  toolName: string,
  toolInput?: Record<string, unknown> | null,
  options?: { platform?: PlatformName },
): { summary: string; target?: string } {
  const input = toolInput ?? {};
  const patch = auditPatchText(toolName, input);
  if (patch !== undefined) {
    // 패치 본문 전문 대신 "무엇을 어디에" 한 줄 — `update a.ts · delete b.ts`.
    const ops = extractPatchFileOps(patch);
    if (ops.length === 0) return { summary: toolName };
    return {
      summary: auditClip(ops.map((o) => `${o.op} ${o.path}`).join(' · '), AUDIT_SUMMARY_MAX_CHARS),
      target: auditClip(ops[0]!.path, AUDIT_TARGET_MAX_CHARS),
    };
  }
  const command = typeof input['command'] === 'string' ? input['command'] : '';
  const url = auditFirstString(input, ['url', 'endpoint']);
  const filePath = auditFirstString(input, AUDIT_PATH_INPUT_KEYS);

  if (command) {
    const urls = command.match(AUDIT_URL_PATTERN);
    // §2.1 #3 쓰기 축 — 셸로 고친 줄은 명령만 있고 **어느 파일인지가 비어 있었다**.
    // 그래프가 쓰기 화살표를 세우는 것과 같은 추출기로 그 칸을 채운다(첫 경로 하나면 족하다).
    // §5.1 #1-1 — PowerShell 도구의 명령은 PowerShell 말씨로 자른다(따옴표·here-string·주석 규칙이 다르다).
    const written = extractBashWritePaths(command, 1, { platform: options?.platform, dialect: shellDialectOfTool(toolName) })[0];
    const target = urls?.[0] ?? filePath ?? written;
    return {
      summary: auditClip(command, AUDIT_SUMMARY_MAX_CHARS),
      ...(target ? { target: auditClip(target, AUDIT_TARGET_MAX_CHARS) } : {}),
    };
  }
  if (url) {
    return {
      summary: auditClip(url, AUDIT_SUMMARY_MAX_CHARS),
      target: auditClip(url, AUDIT_TARGET_MAX_CHARS),
    };
  }
  if (filePath) {
    return {
      summary: auditClip(filePath, AUDIT_SUMMARY_MAX_CHARS),
      target: auditClip(filePath, AUDIT_TARGET_MAX_CHARS),
    };
  }
  const fallback = auditFirstString(input, ['query', 'pattern', 'description', 'prompt', 'subagent_type']);
  return { summary: fallback ? auditClip(fallback, AUDIT_SUMMARY_MAX_CHARS) : toolName };
}

/** 그 종류를 지금 물어야 하는가. 스위치가 아예 없으면 **기본값 하나**(`DEFAULT_AUDIT_BOUNDARY`)를 따른다. */
export function isAuditRiskEnabled(boundary: AuditBoundaryConfig | undefined, kind: AuditRiskKind): boolean {
  const b = boundary ?? DEFAULT_AUDIT_BOUNDARY;
  if (!b.escalateRisky) return false;
  return b.kinds?.[kind] !== false;
}

/** 이 호출을 실행 전에 붙잡아야 하는가(위험 종류 중 하나라도 켜져 있으면). */
export function shouldEscalateRisk(
  boundary: AuditBoundaryConfig | undefined,
  kinds: readonly AuditRiskKind[],
): boolean {
  return kinds.some((k) => isAuditRiskEnabled(boundary, k));
}

/** 외부(REST 바디·옛 체크포인트)에서 온 스위치를 안전한 모양으로 되돌린다. */
export function normalizeAuditBoundary(input: unknown): AuditBoundaryConfig {
  const raw = (input ?? {}) as Partial<AuditBoundaryConfig>;
  const kinds: Partial<Record<AuditRiskKind, boolean>> = {};
  for (const k of AUDIT_RISK_KINDS) {
    const v = (raw.kinds ?? {})[k];
    kinds[k] = v === undefined ? DEFAULT_AUDIT_BOUNDARY.kinds[k] !== false : v !== false;
  }
  return {
    escalateRisky: raw.escalateRisky === undefined
      ? DEFAULT_AUDIT_BOUNDARY.escalateRisky
      : raw.escalateRisky !== false,
    kinds,
  };
}

/** 아직 손대지 않은 기본 상태인가 — 체크포인트가 기본값을 직접 비교하면 기본이 바뀔 때 켜 둔 경계가 사라진다(판정은 여기 한 곳). */
export function isDefaultAuditBoundary(boundary: AuditBoundaryConfig | undefined): boolean {
  const b = boundary ?? DEFAULT_AUDIT_BOUNDARY;
  if (b.escalateRisky !== DEFAULT_AUDIT_BOUNDARY.escalateRisky) return false;
  return AUDIT_RISK_KINDS.every(
    (k) => (b.kinds?.[k] !== false) === (DEFAULT_AUDIT_BOUNDARY.kinds[k] !== false),
  );
}

/** 빈 집계(원장이 비었을 때). */
export function emptyAuditCounts(): AuditCounts {
  return { total: 0, risky: 0, denied: 0, escalated: 0, todayRisky: 0 };
}

// ─── §5.3 #12-3 자물쇠 ───
// 판정(`pathLock.ts`)은 이 표만 읽는다(§3.3). 표는 넓히는 쪽이 안전하다(놓치면 "잠갔는데 열림", 더 물으면 카드 한 장).

/** 프로젝트당 자물쇠 상한. 넘치면 새로 걸지 않는다 — 오래된 자물쇠를 말없이 푸는 일은 하지 않는다. */
export const PATH_LOCK_MAX_PER_PROJECT = 200;

/** 승인 카드·거부 사유에 싣는 자물쇠 접촉 수(나머지는 수로만 말한다). */
export const PATH_LOCK_CARD_HITS_MAX = 3;

/** 화면 이름(버블 라벨) 상한 — 저장되는 글이라 길이를 묶는다. */
export const PATH_LOCK_LABEL_MAX_CHARS = 200;

/**
 * 경로 칸에 **쓰는** 도구. 그 밖의 도구가 경로 칸으로 잠긴 곳을 가리키면 읽기로 센다 —
 * 도구 이름을 몰라도(MCP) 경로 칸은 본다.
 */
export const PATH_LOCK_WRITE_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** 이름만 훑는 도구 — 잠긴 폴더 **안**을 가리킬 때만 센다(상위 폴더를 훑는 것은 이름뿐이다). */
export const PATH_LOCK_LIST_TOOLS: ReadonlySet<string> = new Set(['Glob', 'LS']);

/** 내용을 검색하는 도구 — 범위가 자물쇠를 **덮어도** 센다(내용을 읽는다). 경로가 없으면 cwd 가 범위다. */
export const PATH_LOCK_SEARCH_TOOLS: ReadonlySet<string> = new Set(['Grep']);

/**
 * URL 이 담겨 오는 입력 칸 — 도구 이름과 무관하게 본다(`WebFetch` · 모르는 MCP 도구의 `url`).
 * 셸 명령(`command` 칸 — 클로드 `Bash`·`PowerShell`, 코덱스도 훅에서 `Bash`)도 이름과 무관하게 본다.
 */
export const PATH_LOCK_URL_INPUT_KEYS: readonly string[] = ['url', 'endpoint'];

/** 경로 없이 부르면 **cwd 트리의 내용**을 읽는 셸 명령(첫 인자는 검색어). */
export const PATH_LOCK_TREE_READ_COMMANDS: ReadonlySet<string> = new Set(['rg', 'ag', 'ack', 'ugrep']);

/** 재귀 플래그가 붙을 때만 트리의 내용을 읽는 셸 명령(첫 인자는 검색어). 경로가 없으면 cwd. */
export const PATH_LOCK_RECURSIVE_READ_COMMANDS: ReadonlySet<string> = new Set([
  'grep', 'egrep', 'fgrep', 'zgrep', 'select-string', 'sls', 'findstr',
]);

/** 위 명령의 재귀 플래그(`-r` · `-nri` · `--recursive` · PowerShell `-Recurse` · findstr `/s`). */
export const PATH_LOCK_RECURSIVE_FLAG_PATTERNS: readonly RegExp[] = [
  /^-[A-Za-z]*[rR][A-Za-z]*$/,
  /^--(dereference-)?recursive$/,
  /^-recurse$/i,
  /^\/s$/i,
];

/** `find` 가 이름을 넘어 **내용·파일 자체**를 다루는 동작 — 있으면 경로(없으면 cwd) 트리를 센다. */
export const PATH_LOCK_FIND_ACTION_FLAGS: ReadonlySet<string> = new Set([
  '-exec', '-execdir', '-ok', '-okdir', '-delete',
]);

/** 인자로 받은 폴더를 **통째로** 지우고·묶고·권한을 바꾸는 명령 — 인자가 자물쇠를 덮으면 센다. */
export const PATH_LOCK_TREE_ALL_ARGS_COMMANDS: ReadonlySet<string> = new Set([
  'rm', 'rmdir', 'rd', 'del', 'erase', 'remove-item', 'ri',
  'chmod', 'chown', 'chgrp', 'icacls', 'attrib',
  'tar', 'zip', '7z', 'cpio', 'robocopy', 'xcopy',
]);

/** 원본(앞 인자)·목적지(마지막) 복사·이동 명령 — 원본이 자물쇠를 덮으면 센다. 목적지가 자물쇠의 상위 폴더면 세지 않는다(자물쇠 안 목적지는 직접 접촉으로 이미 잡힌다). */
export const PATH_LOCK_TREE_SOURCE_DEST_COMMANDS: ReadonlySet<string> = new Set([
  'cp', 'mv', 'rsync', 'scp', 'ditto', 'copy', 'move', 'copy-item', 'move-item', 'cpi', 'mi',
]);

// ─── §4 메신저 원격제어 브리지 ───
// 아웃바운드 전용 — 여는 포트는 없고, 부르는 주소와 그 왕복 상한만 있다.

/** 딥링크 페어링 티켓 수명(ms) — §4 QR 티켓처럼 짧게(사진에 찍혀도 곧 죽는다). */
export const CHAT_PAIR_TICKET_TTL_MS = 3 * 60 * 1000;

/** 페어링 티켓 토큰 바이트 수(hex 인코딩 전) — 3분 안에 맞힐 수 없는 수준. */
export const CHAT_PAIR_TOKEN_BYTES = 24;

/** 페어링 시도 실패 허용 횟수 — 초과 시 `CHAT_PAIR_BAN_MS` 동안 그 발신자를 차단. */
export const CHAT_PAIR_MAX_ATTEMPTS = 10;

/** 페어링 실패 한도를 넘긴 발신자를 격리하는 시간(ms). 소유자 lockout 없이 공격자만 막는다. */
export const CHAT_PAIR_BAN_MS = 10 * 60 * 1000;

/** 동시에 페어링해 둘 수 있는 대화(기기) 수 상한 — 초과 시 가장 오래된 것부터 밀어낸다. */
export const CHAT_PEER_MAX = 5;

/** 미페어링 발신자 안내 간격(ms). 침묵이 원칙이지만(§4 ⑤) `/start`·만료 뒤 페어링 시도엔 안내한다 — 간격이 없으면 아무나 반복해 rate limit 을 소진시킨다. */
export const CHAT_UNPAIRED_NOTICE_MS = 10 * 60 * 1000;

/** 대기 버튼(권한·질문) 레지스트리 키 상한 — 누를 때만 짝을 거둬 만료돼도 남는다. 넘치면 만료된 것 → 오래된 것 순으로 버린다. */
export const CHAT_PENDING_ACTION_MAX = 500;

/** `/log` 원문 버퍼를 들고 있을 에이전트 수 상한. 줄 수(`CHAT_LOG_BUFFER_LINES`)와 짝이다. */
export const CHAT_LOG_AGENT_MAX = 32;

/** 페어링 실패 누적 맵의 키 개수 상한 — 미페어링 발신자가 많아져도 무한히 자라지 않게. */
export const CHAT_PAIR_ATTEMPT_MAX = 200;

/** 텔레그램 Bot API 베이스. 토큰은 경로에 실리므로 로그에 URL 을 그대로 남기지 않는다. */
export const CHAT_TELEGRAM_API_BASE = 'https://api.telegram.org';

/** 텔레그램 `getUpdates` long-poll 대기 시간(초). 이 시간만큼 서버가 붙잡고 있다가 응답한다. */
export const CHAT_TELEGRAM_POLL_S = 30;

/** 텔레그램 한 메시지 최대 길이(공식 4096) — 여유를 두고 자른다. */
export const CHAT_TELEGRAM_MESSAGE_MAX = 3800;

/** 디스코드 REST 베이스(v10). */
export const CHAT_DISCORD_API_BASE = 'https://discord.com/api/v10';

/** 디스코드 Gateway intents — GUILD_MESSAGES·DIRECT_MESSAGES·MESSAGE_CONTENT. 평문 명령을 읽으려면 Developer Portal 에서 "Message Content Intent" 를 켜야 IDENTIFY 가 통과한다. */
export const CHAT_DISCORD_INTENTS = (1 << 9) | (1 << 12) | (1 << 15);

/** 하트비트 ACK(op 11) 없이 넘길 횟수(1 = 한 번 놓치면 끊고 재연결 — 디스코드 문서 요구). 안 보면 반쯤 죽은 소켓이 `online` 인 채 아무것도 안 받는다. */
export const CHAT_DISCORD_HEARTBEAT_MISS_MAX = 1;

/** 좀비 커넥션을 우리가 끊을 때 쓰는 close code(1000 이 아니어야 RESUME 가능 범위로 다뤄진다). */
export const CHAT_DISCORD_ZOMBIE_CLOSE_CODE = 4009;

/** 디스코드 한 메시지 최대 길이(공식 2000) — 여유를 두고 자른다. */
export const CHAT_DISCORD_MESSAGE_MAX = 1900;

/** 슬래시 없는 명령 접두어(`!vibisual <명령>` = `/<명령>`). 디스코드 클라이언트가 `/` 를 가로채고 application command 는 등록하지 않으므로, 이게 없으면 `/projects` 를 칠 수 없다. */
export const CHAT_TEXT_COMMAND_PREFIX = '!vibisual';

/** 디스코드 페어링 명령 접두어. DM 딥링크가 없어 평문 한 줄로 같은 결과를 만든다. */
export const CHAT_DISCORD_PAIR_COMMAND = `${CHAT_TEXT_COMMAND_PREFIX} pair`;

/** 연결 실패 후 재시도 간격(ms) — 최소/최대. 지수 백오프로 이 사이를 오간다. */
export const CHAT_RECONNECT_MIN_MS = 2_000;
export const CHAT_RECONNECT_MAX_MS = 60_000;

/** 버튼(승인/거부 등) 하나가 유효한 시간(ms). 지나면 눌러도 "만료됨" 으로 답한다. */
export const CHAT_ACTION_TTL_MS = 10 * 60 * 1000;

/** `/log` 가 인자 없이 왔을 때 보내는 줄 수. */
export const CHAT_LOG_DEFAULT_LINES = 30;

/** `/log n` 으로 요청할 수 있는 줄 수 상한 — 제3자 서버로 나가는 양의 하드 캡. */
export const CHAT_LOG_MAX_LINES = 200;

/** 원문 버퍼에 붙들어 두는 스트림 줄 수(peer 무관, 세션별). `/log` 가 여기서 잘라 간다. */
export const CHAT_LOG_BUFFER_LINES = 400;

/** 브리지 설정·페어링 목록을 담는 userData 파일 이름(봇 토큰 포함 — 체크포인트 미관여). */
export const CHAT_BRIDGE_FILE = 'chat-bridge.json';

/** 선택 카드 한 장의 버튼 수 상한(인라인 키보드 한계). 넘치면 "+N" 한 줄 — 나머지는 상위 단계에서 좁힌다. */
export const CHAT_PICK_MAX = 20;

/** 선택 버튼 하나에 쓸 글자 수 상한 — 넘으면 잘린다(라벨이 길면 버튼이 줄바꿈으로 뭉개진다). */
export const CHAT_PICK_LABEL_MAX = 40;

/** 선택 버튼 토큰의 hex 길이 — 텔레그램 `callback_data` 64바이트 상한이라 표시명 대신 해시를 싣고, 눌렸을 때 그 시점 목록에서 되찾는다(사라진 항목은 안내로). */
export const CHAT_PICK_TOKEN_HEX = 10;

/** "세션을 고르지 않고 서버에 맡긴다"를 뜻하는 선택 토큰(새 대화 / 정규 세션 재사용). */
export const CHAT_PICK_AUTO_SESSION = '*';

/** 명령 대상 목록(`listChatCommandTargets`) 재생성 최소 간격(ms) — 전량 스냅샷인데 카드 라벨 경로는 초당 여러 번 돈다. 클릭 간격보다 짧아 사실상 늘 최신이다. */
export const CHAT_TARGETS_TTL_MS = 1_000;

/**
 * 기본 전송량. `'cards'` = 카드/요약만 나간다(스트림 원문·diff·bash 출력 ❌).
 * 메신저는 제3자 서버를 통과하는 경로라 기본값을 좁게 잡고, 원문은 `/log` 로 명시 요청할 때만.
 */
export const DEFAULT_CHAT_VERBOSITY = 'cards';

// ─── §5.11 정독 게이트 · §5.5 #17-44 ────────────────────────────────────────────
//
// §3.3 — 여기 있는 값은 전부 설정이다. 로직 안에 숫자를 박지 않는다.

/** 기획 문서 뿌리 후보(권위 순서). `.vibisual/spec.json` 의 `roots` 가 있으면 통째로 대신한다. `docs/` 는 맨 뒤(API 문서·노트가 섞여 절이 폭증). */
export const SPEC_DOC_ROOT_CANDIDATES: readonly string[] = [
  '.kiro/specs',
  'specs',
  'spec',
  '기획',
  'docs/scenario',
  'docs',
];

/** 색인이 훑는 확장자. 마크다운만 본다 — 헤딩으로 절을 자를 수 있는 것이 이 기능의 전제다. */
export const SPEC_DOC_EXTENSIONS: readonly string[] = ['.md', '.markdown', '.mdx'];

/** 뿌리에서 내려가는 최대 깊이. 깊은 트리 전체를 훑으면 색인 한 번이 곧 UI 정지다. */
export const SPEC_DOC_SCAN_MAX_DEPTH = 4;

/** 한 번의 색인에서 읽는 문서 수 상한. */
export const SPEC_DOC_FILE_MAX = 120;

/** 절 id 토큰 기본 정규식(`REQ-14` 류 — 요구사항 ID 역추적 관행). 없으면 헤딩 슬러그. */
export const SPEC_ID_PATTERN_DEFAULT = '(?:REQ|SPEC|FR|NFR)-[A-Za-z0-9_.-]+';

/**
 * 절 본문에서 "요구사항 문장"으로 세는 표지. 절의 무게를 재 라우팅 우선순위를 정한다.
 * 로직 분기 ❌ — 세는 대상은 이 표 하나에서만 온다.
 */
export const SPEC_REQUIREMENT_MARKERS: readonly string[] = [
  'SHALL', 'MUST', 'SHOULD NOT', 'MUST NOT',
  '해야', '한다.', '금지', '하지 마', '필수', '반드시',
];

/** 한 턴 필수 절 상한(§5.5 #17-28 — 전집 요구는 실패한다). 넘치면 요구사항 수가 많은 절부터 자르고 잘린 사실을 프롬프트·화면에 적는다. */
export const SPEC_REQUIRED_MAX = 8;

/** 색인 절 수 상한 — 넘으면 최근 수정 순으로 자르고 `truncated`. 절은 얕은 객체라 4,000개도 싸고 전선엔 개수만 실린다. */
export const SPEC_UNIT_MAX = 4000;

/**
 * 절 하나의 토큰 상한(`estimateTokens`). 헤딩 하나가 27만 토큰인 문서가 있다(실측 2026-09-10).
 * 넘으면 항목·문단에서 다시 자르고, 그래도 넘으면 `oversized`(Grep 으로 좁힌다).
 */
export const SPEC_UNIT_TOKEN_MAX = 2000;

/** 헤딩 없는 긴 절을 자르는 항목 줄(척추 §5 목차 찾기 정규식과 같은 꼴 — `17-44.`·`1)`·`(a)`·`①` 등, 앞의 `- `·`**` 은 건너뜀). 줄 단위로 검사한다(`m` ❌). */
export const SPEC_ITEM_PATTERN_DEFAULT =
  '^\\s{0,8}(?:[-*+]\\s+)?(?:\\*\\*)?(?:\\d+(?:[.\\-]\\d+)*[.)]|\\([A-Za-z0-9]{1,3}\\)|[\u2460-\u2473\u3251-\u325F])(?=[\\s*\\-]|$)';

/** 재분할이 내려가는 최대 깊이(항목 → 하위 항목 → …). 그 아래는 문단으로 묶는다. */
export const SPEC_RESPLIT_DEPTH_MAX = 4;

/**
 * 재분할 절 제목의 항목 표지 길이(표시용). 헤딩은 검색 낱말이 꼬리에 있어 낱말 경계에서 자르고, 매칭은 자르지 않은 `SpecUnit.matchText` 로 한다
 * (실측: 40자일 때 `정독` 이 `정` 으로 잘려 그 절을 못 찾았다).
 */
export const SPEC_ITEM_LABEL_MAX = 60;

/**
 * 제목 겹침 문턱(점수). 개수가 아니라 무게를 센다 — 접착제 0 · 드문 낱말 `SPEC_RARE_TITLE_HIT_WEIGHT` · 나머지 1
 * (실측: 1 이면 무관한 절 8개, 개수로 세면 접착제 둘로 섰다). id·문서 경로 직접 지목은 문턱과 무관.
 */
export const SPEC_TITLE_MIN_HITS = 2;

/** 드문 낱말 하나가 대신하는 겹침 수 — 기능 이름을 정확히 부른 프롬프트가 짝이 없어 떨어지지 않게. */
export const SPEC_RARE_TITLE_HIT_WEIGHT = 2;

/**
 * 드문 낱말의 df 비율 상한(고정 개수면 색인 크기마다 뜻이 바뀐다). 부모 제목이 조각에 이어져 df 가 부풀어 넉넉히 잡는다
 * (실측 2026-09-11, 절 1,038: 도메인 낱말 df 10~46, 흔한 낱말 56~375).
 */
export const SPEC_RARE_TITLE_DF_RATIO = 0.05;

/**
 * 희귀도를 재기 시작하는 색인 크기(df 는 모집단이 있어야 뜻이 있다). df 바닥값으로 바꾸지 마라 —
 * 작은 색인에선 모든 낱말이 드물어 문턱이 사라진다(실측: 절 2개에서 한 낱말이 절을 세웠다).
 */
export const SPEC_RARE_TITLE_MIN_UNITS = 20;

/**
 * 드문 낱말이 혼자 절을 세우려면 제목 사슬 앞 이만큼 안에서 맞아야 한다 — df 로는 도메인 낱말과 동사가 안 갈린다(실측 2026-09-11: `오늘` df 4).
 * 절의 주제 낱말은 절 제목에, 지나가는 말은 말단 표지에 선다. 말단에서만 맞으면 1 로 센다.
 */
export const SPEC_TITLE_HEAD_PARTS = 2;

/** 제목 겹침에서 세지 않는 낱말(언어 표 — `KO_PARTICLES` 와 같은 규율). 작은 저장소에서 접착제가 드문 낱말이 되는 것을 막는다. 명사만 — 기능 이름이 될 낱말은 넣지 마라. */
export const SPEC_TITLE_STOPWORDS: readonly string[] = [
  // 한국어 — 지시·시점·수량·정도
  '지금', '이번', '다음', '처음', '나중', '먼저', '아까', '여기', '거기', '저기',
  '이것', '그것', '저것', '하나', '둘째', '전부', '모두', '각각', '따로', '함께',
  // 한국어 — 문장 접착제
  '기능', '내용', '경우', '부분', '때문', '사실', '정말', '그냥', '조금', '아주',
  '우리', '너가', '내가', '대로', '만큼', '정도', '이상', '이하', '위에', '아래',
  '새로', '기존', '종전', '다시', '계속', '이제', '아직', '역시', '물론', '혹시',
  // 영어 — 지시·전치사·잡동사니
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'when', 'what',
  'how', 'why', 'use', 'using', 'add', 'fix', 'make', 'new', 'old', 'all',
];

/** 색인에서 빼는 폴더 이름(소문자 견줌 — 이름 판정이라 안전). 없으면 백업 사본이 원본을 상한 밖으로 민다(실측: 349장 중 229장 탈락). */
export const SPEC_DOC_SKIP_SEGMENTS: readonly string[] = [
  'backup', 'backups', 'bak', 'archive', 'archives', 'archived', '_archive', '_backup',
  'old', 'temp', 'tmp', 'trash', 'deprecated',
];

/** 색인에서 빼는 **파일 이름** 꼴(소문자로 견줌) — `x.bak.md`·`x_old.md`·`x-copy.md`·`x (copy).md`. */
export const SPEC_DOC_SKIP_FILE_PATTERN = '(?:[-_.](?:backup|bak|old|orig|copy)|\\s\\(copy\\))\\.(?:md|markdown|mdx)$';

/** 뿌리마다 후보로 모으는 문서 수 — 최근 수정 순으로 고르려면 상한(`SPEC_DOC_FILE_MAX`)보다 넉넉히 봐야 한다. */
export const SPEC_DOC_LIST_MAX = 500;

/** 상태에 싣는 "못 실은 문서" 목록 길이(수는 따로 센다 — 목록은 화면용, 수는 판정용). */
export const SPEC_INDEX_SKIPPED_LIST_MAX = 20;

/** 인용 대조 결과에 붙이는 파일 원문 길이 — 나란히 보기(§5.5 #17-44 ③(b))의 재료. */
export const SPEC_CITATION_ACTUAL_MAX = 300;

/** 이 줄 수를 넘는 파일의 `offset` 없는 통째 Read 는 부분 열람으로 강등한다(도구가 앞부분만 돌려준다). */
export const SPEC_FULL_READ_LINE_MAX = 4000;

/** `Grep` 매치 한 건이 덮는 것으로 치는 줄 수(문맥 인자가 없을 때). */
export const SPEC_GREP_CONTEXT_LINES = 4;

/** 절이 `satisfied` 가 되기 위한 최소 구간 커버 비율. */
export const SPEC_COVER_SATISFIED_RATIO = 0.8;

/** 기본 `Stop` 되돌림 횟수(세션당). */
export const SPEC_STOP_RETRY_DEFAULT = 1;

/** 되돌림 횟수 상한 — 사용자가 올려도 여기까지다. 막힌 채 끝나는 것이 최악이다. */
export const SPEC_STOP_RETRY_LIMIT = 3;

/** 히트맵이 파일당 들고 있는 열람 구간 수(§3.2.4 F′ — 키 개수 캡). */
export const SPEC_SPANS_PER_FILE_MAX = 200;

/** 원장이 드는 세션 수 상한. 넘으면 가장 오래 안 만진 세션부터 버린다. */
export const SPEC_LEDGER_SESSION_MAX = 200;

/** 세션당 게이트 이력 줄 수. */
export const SPEC_GATE_EVENT_MAX = 50;

/** 세션당 히트맵이 드는 파일 수. */
export const SPEC_LEDGER_FILE_MAX = 60;

/** 원장이 드는 프롬프트 앞부분 길이(할 일은 앞머리에 있다). 통째로 들면 붙여넣은 로그가 세션 수만큼 곱해진다(§3.2.4). */
export const SPEC_PROMPT_KEEP_CHARS = 4_000;

/** 세션당 기억하는 "건드린 경로" 수 — 경로 축 라우팅의 재료라 최근 것만 있으면 된다. */
export const SPEC_TOUCHED_PATH_MAX = 60;

/** 세션당 들고 있는 인용 대조 결과 수. 넘으면 오래된 것부터 버린다. */
export const SPEC_CITATION_SESSION_MAX = 120;

/** 전선에 싣는 히트맵 파일 수(원장의 `SPEC_LEDGER_FILE_MAX` 와 다르다 — §9 전선 예산). 필수 절이 가리키는 파일은 늘 싣는다. */
export const SPEC_WIRE_FILE_MAX = 24;

/** 전선에 싣는 파일당 구간 수. 겹친 구간은 원장에서 이미 합쳐져 있어 이 수면 한 문서를 다 그린다. */
export const SPEC_WIRE_SPANS_PER_FILE = 40;

/** 색인 캐시 수명 — 실시간 append 문서는 mtime 만으로 매 턴 빗나가 동기 읽기가 반복된다(§5.11). */
export const SPEC_INDEX_TTL_MS = 30_000;

/** 인용으로 인정하는 최소 글자 수 — 너무 짧으면 아무 문장에나 걸린다. */
export const SPEC_CITATION_MIN_CHARS = 12;

/** 인용 대조에서 한 번에 보는 최대 글자 수(긴 인용은 앞부분만 대조). */
export const SPEC_CITATION_MAX_CHARS = 600;

/** 프로젝트가 직접 지정하는 설정 파일(팀이 git 으로 공유할 수 있는 자리). */
export const SPEC_SETTINGS_FILE = '.vibisual/spec.json';

/** 화면 드롭다운이 쓰는 강도 목록 — 순서가 곧 강해지는 순서다. */
export const SPEC_GATE_STRENGTHS = ['observe', 'warn', 'enforce'] as const;

/** §5.5 #17-44 ⑧ — 층별 덮어쓰기 맵 칸 상한(세션이 사라져도 칸이 남아 늘기만 한다 — §3.2.4). 넘치면 먼저 적힌 칸부터 버린다. */
export const SPEC_SCOPE_ENTRY_MAX = 200;

// ─── §5.10 자동 목표 — 되풀이를 스킬로 굳히는 문턱 ───────────────────────

/** 스킬로 굳히는 되풀이 문턱. 2 면 우연이 스킬이 되고 5 면 안 생긴다. `GOAL_ACTION_MIN_REPEAT` 와 같은 값이라 "되풀이"의 뜻이 하나다. */
export const AUTO_GOAL_MIN_RUNS = 3;

/** 절차 한 벌로 인정하는 **최소 단계 수** — 한 줄짜리는 절차가 아니라 명령이다(팔레트의 몫). */
export const AUTO_GOAL_SEQUENCE_MIN = 2;

/** 절차 최대 단계 수. 올리지 마라 — 길수록 같은 순서가 안 되풀이돼 아무것도 안 잡힌다. */
export const AUTO_GOAL_SEQUENCE_MAX = 6;

/** 한 절차로 묶는 시간 창 — 어제 명령과 오늘 명령을 가르는 증거는 시간뿐이다. */
export const AUTO_GOAL_WINDOW_MS = 15 * 60 * 1000;

/** 화면에 세우는 후보 수 상한 — 넘으면 "자주 하는 일"이 아니라 목록이 된다(팔레트와 같은 규율). */
export const AUTO_GOAL_CANDIDATE_MAX = 12;

/** 후보 제목 길이 상한 — 한 줄에 들어가야 목록으로 읽힌다. */
export const AUTO_GOAL_TITLE_MAX = 56;

/** 단계 한 줄의 길이 상한 — 원문을 지우지 않되 화면과 frontmatter 가 감당할 만큼만. */
export const AUTO_GOAL_STEP_MAX = 200;

/** Store execution text losslessly; reject oversized observations instead of truncating. */
export const AUTO_GOAL_COMMAND_MAX = 16_384;
export const AUTO_GOAL_EVIDENCE_FILE_MAX = 16;
export const AUTO_GOAL_EVIDENCE_FILE_BYTES = 2 * 1024 * 1024;
export const AUTO_GOAL_ASSESSMENT_TTL_MS = 30 * 60 * 1000;
export const AUTO_GOAL_ASSESSMENT_MAX = 256;
export const AUTO_GOAL_COMPLETION_MAX = 16;
/** 한 턴 검토 대기 절차 수(§5.10 (R)ⓑ) — 자리가 모자라면 규약이 검토를 지시해도 안 실린다. 관련도 순위(`autoGoalRelevanceScore`)로 골라 무관한 것은 안 늘린다. */
export const AUTO_GOAL_REVIEW_QUEUE_MAX = 6;
/** 한 턴에 실을 검토 통과 절차 수 — 검토 대기와 합쳐 한 턴의 주입 총량이 된다. */
export const AUTO_GOAL_ACTIVE_QUEUE_MAX = 8;
/** 승인 뒤 이만큼 안 쓰인 절차는 걷을 후보로 규약문에 적는다(§5.10 (R)ⓒ — 지우지 않는다). 30일 = 릴리스·점검 같은 절차가 한 번은 돌아올 길이. */
export const AUTO_GOAL_STALE_REVIEW_MS = 30 * 24 * 60 * 60 * 1000;
export const AUTO_GOAL_REFRESH_MS = 15_000;

/**
 * @deprecated 호환용 옛 상수. 제외 기록은 사용자 결정이므로 개수 제한으로 버리지 않는다.
 * §5.10 (Q): 오래된 제외 기록이 사라지면 동일 절차가 다시 제안되므로 저장·정규화에 사용 금지.
 */
export const AUTO_GOAL_DISMISSED_MAX = 200;

/** 훑는 행동 이력 꼬리 길이(에이전트당) — 전량을 매번 세면 쓸수록 느려진다(§9). */
export const AUTO_GOAL_SCAN_TAIL = 400;

/** 자동으로 굳히는 스킬 수의 총량 상한 — 넘으면 더 짓지 않는다(디스크·주입 둘 다 지킨다). */
export const AUTO_GOAL_SKILL_BUDGET = 40;

/** 기본은 알림(막기는 사용자가 켠다) — 오탐으로 매 턴 막히면 기능을 꺼 버린다. */
export const DEFAULT_SPEC_READING_SETTINGS = {
  strength: 'observe' as const,
  maxRequired: SPEC_REQUIRED_MAX,
  stopRetries: SPEC_STOP_RETRY_DEFAULT,
};

// ─── §5.5 #17-33 ⑦ — Claude Code 플러그인 자동 갱신 ───
// 마켓 클론은 `claude plugin marketplace update` 를 부르기 전까지 그대로다(실측 2026-09-09: 공식 클론이 36일 낡아 있었다) — 그래서 주기를 둔다.

/** 기본은 둘 다 켬 — 끌 자리를 주는 편이 켤 자리를 못 찾아 멈춰 있는 것보다 낫다. */
export const CLAUDE_PLUGIN_REFRESH_DEFAULTS = {
  market: true,
  plugins: true,
  intervalHours: 24,
};

/** 주기 하한 — 이보다 자주 부르면 매번 git 을 타 사용자 회선만 축낸다. */
export const CLAUDE_PLUGIN_REFRESH_MIN_INTERVAL_HOURS = 1;

/** 주기 상한 2주 — 이보다 길면 "자동" 이라 부를 수 없다. */
export const CLAUDE_PLUGIN_REFRESH_MAX_INTERVAL_HOURS = 24 * 14;

/** 기동 후 첫 확인 유예 — 부팅 직후(복원·체크포인트 읽기)에 git 스폰을 얹으면 첫 화면이 늦는다. */
export const CLAUDE_PLUGIN_REFRESH_STARTUP_DELAY_MS = 45_000;

/** "할 때가 됐나" 판정 간격(갱신 자체가 아니다) — 시각 비교뿐이라 값이 0 에 가깝고 며칠 켜 둬도 주기를 놓치지 않는다. */
export const CLAUDE_PLUGIN_REFRESH_TICK_MS = 30 * 60_000;

/** 갱신 뒤 화면에 적어 두는 "이번에 올라간 것" 최대 개수(그 이상은 수로만 적는다). */
export const CLAUDE_PLUGIN_REFRESH_UPDATED_KEEP = 12;

/** 한 번에 올릴 설치본 상한 — 하나에 최대 180초라 한꺼번에 하면 몇 시간이다. 남은 것은 다음 주기에. */
export const CLAUDE_PLUGIN_REFRESH_MAX_PER_RUN = 8;

// ─── §5.3 #10-4 — 오케스트라(지휘 모드) ───
// 켜 둔 커스텀 에이전트가 요청을 받은 그 턴만 지휘자가 되어 `ORCHESTRA_STRATEGIES` 중 맞는 방안만 골라 편성하고 이유를 신고한다(자동 적용 ❌).

/** 한 런에서 새로 만들 수 있는 멤버 수 기본값 — 분석 1번("머릿수는 비싸다")이 상한의 이유다. */
export const ORCHESTRA_DEFAULT_MAX_MEMBERS = 6;

/** `maxMembers` 설정 상한. 프로젝트 전체 상한(`CUSTOM_AGENT_MAX_PER_PROJECT`)이 따로 한 번 더 막는다. */
export const ORCHESTRA_MAX_MEMBERS_LIMIT = 12;

/** 프로젝트당 보관하는 런 수(ring) — 넘치면 가장 오래된 런부터 버린다(§3.2.4 단조 증가 방지). */
export const ORCHESTRA_RUN_MAX_PER_PROJECT = 100;

/** 스냅샷에 싣는 최근 런 수 — 나머지는 체크포인트에만 있다(전선 무게). */
export const ORCHESTRA_RUN_SNAPSHOT_MAX = 20;

/** 런 기록용 요청 원문 길이 상한(글자) — 명령 본문은 자르지 않는다. */
export const ORCHESTRA_RUN_REQUEST_MAX = 4000;

/** 계획 신고의 방안별 이유 길이 상한(글자) — 넘으면 400. */
export const ORCHESTRA_PLAN_REASON_MAX = 300;

/** 계획 신고의 note 길이 상한(글자) — 넘으면 400. */
export const ORCHESTRA_PLAN_NOTE_MAX = 1000;

/** 지휘 턴 도구 — #10-2 빌더(`AUTO_AGENT_BUILDER_CONFIG.tools`)와 같은 벌(loopback REST 는 Bash(curl), 나머지는 읽기). `askQuestions` 면 `AUTO_AGENT_BUILDER_INTERVIEW_TOOL` 을 더한다. */
export const ORCHESTRA_CONDUCTOR_TOOLS: readonly string[] = ['Bash', 'Read', 'Grep', 'Glob', 'Agent'];

/** 지휘 턴에서 막는 도구 — 지휘자는 코드를 고치지 않는다(고치는 것은 멤버다). */
export const ORCHESTRA_CONDUCTOR_DISALLOWED_TOOLS: readonly string[] = ['Write', 'Edit', 'NotebookEdit'];

// ─── §5.3 #10-5 — 설정 덜어내기(Config Trim) ──────────────────────────────────
// 왜 있는가: 켜 둔 자리의 턴만, `AgentConfig` 에서 이 모델/CLI 가 받지 않거나 기본값과 같거나
// 본체가 없는 칸을 **사본에서만** 떼고 돈다. 저장된 설정은 그대로다. 기본은 꺼짐이다.

/** 프로젝트당 보관하는 덜어내기 기록 수(ring) — 넘치면 가장 오래된 것부터 버린다. */
export const CONFIG_TRIM_RUN_MAX_PER_PROJECT = 100;

/** 스냅샷에 싣는 최근 기록 수 — 나머지는 체크포인트에만 있다(전선 무게). */
export const CONFIG_TRIM_RUN_SNAPSHOT_MAX = 20;

/** Bounds for user-started, app-owned verification tool sessions. */
export const VERIFICATION_AUTOMATION = {
  maxEvents: 80,
  maxEvidence: 80,
  maxDurationMs: 10 * 60 * 1000,
  actionTimeoutMs: 30_000,
  maxWaitMs: 5_000,
  maxText: 2_000,
  maxSelector: 500,
  maxUrl: 2_000,
  maxElements: 80,
  maxImageBytes: 16 * 1024 * 1024,
  maxScroll: 4_000,
  imageWidth: 1280,
  imageHeight: 720,
  screenshotMaxDifference: 0.12,
  evidenceDirectory: 'verify-runs',
} as const;

// ─── §4 앱 테마 ───
// 본체는 Tailwind 팔레트 변수(`--color-<계열>-<칸>`) 교체, 클래스로 못 칠하는 자리만 의미 토큰. 해석 `appThemeResolve.ts`, 목록 `appThemeCatalog.ts`.

/** 기본 테마 — 종전 화면 그대로다. 고른 테마를 못 찾을 때도 여기로 떨어진다. */
export const DEFAULT_APP_THEME_ID = 'vibisual-dark';

/** `kind: "light"` 인데 `extends` 가 없는 사용자 테마의 출발점. */
export const DEFAULT_LIGHT_APP_THEME_ID = 'light';

/** 테마 파일 형식 판수. 이보다 큰 판수의 파일은 읽지 않는다(모르는 형식을 넘겨짚지 않는다). */
export const APP_THEME_SCHEMA_VERSION = 1;

/** 사용자 테마 id 접두 — 기본 테마 id 를 가리지 못하게 이름 공간을 가른다. */
export const CUSTOM_APP_THEME_PREFIX = 'custom:';

/** 팔레트 계열 — 이 앱이 싣는 Tailwind 기본 색 이름(`TAILWIND_DEFAULT_PALETTE` 와 같은 순서). */
export const APP_THEME_FAMILIES: readonly AppThemeFamily[] = [
  'slate', 'gray', 'zinc', 'neutral', 'stone',
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan',
  'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
];

/** 팔레트 칸 — 밝은 쪽부터. 뒤집기(50↔950)는 이 배열의 양끝을 맞바꾼다. */
export const APP_THEME_SHADES: readonly AppThemeShade[] = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];

/** 사용자 테마 폴더를 읽을 때의 상한 — 부팅·창 생성 경로에서 동기로 읽으므로 작게 묶는다. */
export const APP_THEME_LIMITS = {
  maxFiles: 64,
  maxFileBytes: 256 * 1024,
  maxIdLength: 48,
  maxNameLength: 60,
  maxDescriptionLength: 240,
  maxAuthorLength: 60,
  /** `extends` 사슬 깊이 — 넘으면 거기서 끊는다(순환은 따로 잡는다). */
  maxExtendsDepth: 8,
  /** 문제 목록에 원문을 실을 때 자르는 길이. */
  maxIssueDetailLength: 80,
} as const;

/** 마지막 칠한 테마의 표시 캐시(localStorage). 권위는 `UserDefaults.appearance.themeId` — 첫 칠 깜빡임을 막고 스냅샷을 안 받는 창이 따라오게 한다. */
export const APP_THEME_BOOT_CACHE_KEY = 'vibisual.appTheme.v1';

/** 어두운 판 고정 속성 — 고정 어두운 바탕 전제의 화면(내부 앱·미디어 무대)에 붙인다(라이트에서 글자만 뒤집혀 사라지지 않게). */
export const APP_THEME_LOCK_ATTR = 'data-vb-theme-lock';

/**
 * 의미 토큰 — Tailwind 클래스로 못 칠하는 자리. `default` 는 기본 테마 값(기본 테마는 한 픽셀도 달라지면 안 된다), `{gray.950}` 은 팔레트 참조.
 * `cssVar` 가 있는 것만 CSS 변수로 나간다(`bg-vb-*`), 없는 것은 JS(xterm)만 읽는다. 터미널 16색은 Catppuccin Mocha(MIT).
 */
export const APP_THEME_TOKEN_SPECS: Readonly<Record<AppThemeToken, { readonly default: string; readonly cssVar?: string }>> = {
  'window.background': { default: '{gray.950}', cssVar: '--color-vb-window' },
  'titleBar.background': { default: '#334155', cssVar: '--color-vb-titlebar' },
  'titleBar.foreground': { default: '#cbd5e1', cssVar: '--color-vb-titlebar-fg' },
  'canvas.background': { default: '{gray.950}', cssVar: '--color-vb-canvas' },
  'canvas.dots': { default: '#1e293b', cssVar: '--color-vb-canvas-dots' },
  'surface.raised': { default: '#1f2937', cssVar: '--color-vb-raised' },
  'surface.card': { default: '#1a1d26', cssVar: '--color-vb-card' },
  'surface.inset': { default: '#242833', cssVar: '--color-vb-inset' },
  'surface.sunken': { default: '#0f1117', cssVar: '--color-vb-sunken' },
  'ide.titleBar': { default: '#1a2236', cssVar: '--color-vb-ide-titlebar' },
  'ide.tabBar': { default: '#15192a', cssVar: '--color-vb-ide-tabbar' },
  'code.background': { default: '#1a1c20', cssVar: '--color-vb-code' },
  'code.foreground': { default: '#e6e8ec', cssVar: '--color-vb-code-fg' },
  'code.border': { default: 'rgb(255 255 255 / 0.06)', cssVar: '--color-vb-code-border' },
  'code.inlineBackground': { default: 'rgb(140 149 165 / 0.24)', cssVar: '--color-vb-code-inline' },
  'code.inlineForeground': { default: '#eceef1', cssVar: '--color-vb-code-inline-fg' },
  'find.match': { default: '#2563eb', cssVar: '--color-vb-find' },
  'find.matchForeground': { default: '#f8fafc', cssVar: '--color-vb-find-fg' },
  'find.matchAll': { default: 'rgb(37 99 235 / 0.28)', cssVar: '--color-vb-find-all' },
  'terminal.background': { default: '#11111b', cssVar: '--color-vb-terminal' },
  'terminal.panel': { default: '#181825', cssVar: '--color-vb-terminal-panel' },
  'terminal.foreground': { default: '#cdd6f4' },
  'terminal.cursor': { default: '#94e2d5' },
  'terminal.cursorAccent': { default: '#11111b' },
  'terminal.selection': { default: 'rgb(203 166 247 / 0.3)' },
  'terminal.black': { default: '#45475a' },
  'terminal.red': { default: '#f38ba8' },
  'terminal.green': { default: '#a6e3a1' },
  'terminal.yellow': { default: '#f9e2af' },
  'terminal.blue': { default: '#89b4fa' },
  'terminal.magenta': { default: '#f5c2e7' },
  'terminal.cyan': { default: '#94e2d5' },
  'terminal.white': { default: '#bac2de' },
  'terminal.brightBlack': { default: '#585b70' },
  'terminal.brightRed': { default: '#f38ba8' },
  'terminal.brightGreen': { default: '#a6e3a1' },
  'terminal.brightYellow': { default: '#f9e2af' },
  'terminal.brightBlue': { default: '#89b4fa' },
  'terminal.brightMagenta': { default: '#f5c2e7' },
  'terminal.brightCyan': { default: '#94e2d5' },
  'terminal.brightWhite': { default: '#a6adc8' },
};
