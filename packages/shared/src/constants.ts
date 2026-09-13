import type { AgentProvider, AgentEngineKind, LocalEngineBackend, BubbleType, BubbleStyleConfig, EdgeStyleConfig, AgentRole, PipelineChildConfig, PipelineType, AgentConfig, AgentDefinition, TaskEdgeTemplate, TaskEdgeKind, UiLocale, AutoAgentRole, AutoAgentTemplate, ModelPricing, ModelFamily, KnownModelFamily, ModelRegistry, ModelRegistryEntry, AgentFeedback, StreamDensity, PluginContributionKind, SessionGoalStep, SessionGoalStepStatus, CommandDispatchMode, CommandErrorCode, RunRuntime, RunConfig, McpServerPreset, AgentMemoryScope, DebugAdapterSpec, ProblemMatch, ProblemSeverity, RetentionSettings, TokenSaverSettings, TokenSaverPreset, BackgroundTaskProbeSettings, SessionLivenessProbeSettings, PreviewDevicePreset, ShelfIconName, ShelfItemKind, CostPeriod, CostTotals, CostPeriodTotals, AuditRiskKind, AuditBoundaryConfig, AuditCounts, StoryboardPresetId, StoryboardPreset, LocalModelCatalogSort, WorkspacePathKind, CmdPaneNode, BuiltinSlashCommand, SessionMemo, ContextScopeLevel, TidyBand, TidySort, TidyGeometry, VisualKindSurface } from './types.js';
export type { ModelPricing, ModelFamily, KnownModelFamily, ModelRegistry, ModelRegistryEntry } from './types.js';
// 경로 대소문자 정책 SSOT — win32/darwin 만 접고 linux 는 접지 않는다(`pathCase.ts`).
import { normalizePathShape, pathKey, type PlatformName } from './pathCase.js';
// §2.1 #3 쓰기 축 — Bash 줄의 `target`(어느 파일을 고쳤나)을 그래프와 **같은 추출기**에서 뽑는다.
import { extractBashWritePaths } from './bashCommandPaths.js';

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
 * 스트림 이벤트(sub_agent_stream / _batch) 전용 클라 반영 주기(ms) — 스냅샷(16ms)과 분리.
 *
 * 성능: StreamRenderer 는 store 에 이벤트가 반영될 때마다 활성 세션 버퍼 전체(최대
 * STREAM_EVENTS_MAX_PER_SESSION=4000)를 처음부터 다시 파싱(buildBaseItems 3패스 + 정렬 +
 * identity 재조정 + Virtuoso 재대조)한다. 새 이벤트가 1개든 200개든 재구축 비용은 버퍼 크기에
 * 비례하므로, 멀티에이전트 폭주로 버퍼가 4000 에 근접하면 16ms 주기 재구축이 프레임 예산을 넘겨
 * 창 전체가 멈칫거린다. 스트림 반영을 이 주기로 묶어 무거운 재구축 빈도를 ~3배 낮춘다(추가 지연
 * 수십 ms — 스트림 텍스트는 20Hz 로도 라이브로 보인다). 스냅샷·스크롤·가상화 로직은 불변.
 */
export const WS_STREAM_BATCH_INTERVAL = 50;

/**
 * 부하 적응형 배치 창 상한(ms) — §9 v3.40.
 *
 * 전수조사급 다중 세션에서는 graph_snapshot 의 생성(서버=Electron 메인 스레드의
 * getSnapshot+IPC 직렬화)과 반영(클라 loadSnapshot 풀 재구축) 비용이 각각 고정 16ms
 * 배치 창을 넘겨, 스레드가 스냅샷 처리만 하느라 입력·렌더가 굶는다(프레임드랍).
 * 서버·클라 양쪽 flush 는 직전 실측 비용 × WS_BATCH_BACKOFF_FACTOR 로 다음 창을
 * 늘리되 이 값을 상한으로 한다 — 폭주 중에도 최소 4Hz 갱신은 보장.
 * 유휴·경부하에선 비용이 작아 항상 기본 주기(16/50ms)로 즉시 복귀한다.
 */
export const WS_BATCH_INTERVAL_MAX = 250;

/**
 * 적응 배수 — 다음 배치 창 = clamp(기본주기, 직전 flush 비용 × 이 값, 상한).
 * 4 ⇒ 스냅샷 경로가 해당 스레드 시간의 ~1/5 이상을 점유하지 못한다.
 */
export const WS_BATCH_BACKOFF_FACTOR = 4;

/**
 * hook-event 도구 이벤트 경로 전용 체크포인트 저장 배치 창(ms) — §9 v3.45.
 *
 * saveCheckpoint() 는 체크포인트 build + 전체 stringify + fsync 원자쓰기(+백업 rotate,
 * identity 한 벌 더)를 Electron 메인 스레드에서 동기로 수행한다. 빠른 모델 전수조사처럼
 * 도구 이벤트가 초당 수~수십 건 도착하면 이벤트당 저장이 스레드를 포화시켜 앱 전체가
 * 동결되므로, 이 경로만 trailing 창으로 코얼레스한다. 사용자 조작·설정·정체성 변경 등
 * 나머지 저장 지점은 종전대로 동기 즉시 저장(#4 내구성 원칙 유지), 정상 종료 시 pending
 * 창은 process 'exit' 동기 flush 로 보장.
 */
export const CHECKPOINT_BATCH_INTERVAL = 500;

/**
 * 체크포인트 배치 창 상한(ms) — 다음 창 = clamp(기본, 직전 실측 저장 비용 ×
 * WS_BATCH_BACKOFF_FACTOR, 이 값). 폭주 중에도 최소 0.2Hz 저장은 보장하고,
 * 비정상 종료 시 잃을 수 있는 휘발성 그래프 상태를 최대 5초 분량으로 묶는다.
 */
export const CHECKPOINT_BATCH_INTERVAL_MAX = 5000;

/**
 * §9 "저장은 바뀐 프로젝트만" — **조용한 프로젝트를 그래도 한 번은 재구축하는 주기(ms)**.
 *
 * `saveCheckpoint()` 는 인스턴스 `mutationVersion` 이 지난 저장 이후 바뀐 프로젝트만 다시
 * 만든다(실측 2026-08-19: 열린 탭 7개 직렬화만 21.8ms → 활성 1개면 3.8ms). 그런데 체크포인트에는
 * 인스턴스 **밖** 싱글턴(서브에이전트·파이프라인·신고/검수/질문 카드류)에서 오는 값이 함께 담기고
 * 그쪽 변경은 `mutationVersion` 을 올리지 않는다 — 그래서 조용해 보이는 프로젝트도 이 주기마다
 * 한 번은 **무조건** 재구축한다.
 *
 * ⚠ 이 값을 키우면 "인스턴스는 안 바뀌었지만 싱글턴만 바뀐" 변경의 디스크 반영이 그만큼 늦어진다
 *   (유실이 아니라 지연 — 종료 시 `process 'exit'` 동기 flush 는 항상 전 프로젝트 전량).
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
  // §5.3 #28 v1.47 — 콘티모드 버블 (커스텀 에이전트와 dashed inner edge 로 1:1 연결)
  conti: {
    color: '#059669',
    glow: '#6EE7B7',
    icon: 'conti',
    ringIdle: 'border-emerald-300 border-dashed',
    ringActive: 'border-emerald-500 border-dashed shadow-lg shadow-emerald-500/30',
  },
  // §5.3 #10-2 v2.37 — Auto Agent (메타 에이전트). 커스텀 에이전트(#3B82F6)보다 어두운 다크블루.
  auto: {
    color: '#1E3A8A',
    glow: '#3B82F6',
    icon: 'auto',
    ringIdle: 'border-blue-900',
    ringActive: 'border-blue-700 shadow-lg shadow-blue-900/40',
  },
  // §5.10 v3.46 — 커스텀 에이전트 휴지통 버블 (홈 버블 위성). 스톤 그레이.
  trash: {
    color: '#57534E',
    glow: '#A8A29E',
    icon: 'trash',
    ringIdle: 'border-stone-400',
    ringActive: 'border-stone-300 shadow-lg shadow-stone-400/30',
  },
  // §5.13 v4.66 — Vibistudio 영상 버블. 필름 스톡 그레이파이트 + 실버 엣지.
  //   구 푸시아(#D946EF)는 채도가 높아 팔레트에서 겉돌았다(사용자 지적 — Brain 버블의
  //   핑크 #EC4899 → 인디고 와 같은 이유). 앱 버블(`apps/registry.tsx` 의 Vibistudio)과
  //   **같은 색 한 벌**이라, 영상 도구가 어디에 뜨든 같은 정체로 읽힌다.
  //   bash(#1E293B) 도 어두운 무채색이지만 아이콘·모양이 달라 섞이지 않는다.
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
};

/**
 * §2.2 (v2.67, C안) — Hook 에이전트(외부 Claude Code 훅 캡처, `customCreated=false`) 전용 본체 스타일.
 * Custom/CMD(우리가 오케스트레이션, `BUBBLE_STYLES.agent`=#3B82F6)와 **같은 파랑 계열**이되 더 어둡고 탁한
 * 네이비로 **명도만** 구분한다. `bubbleType` 은 그대로 'agent' — `BubbleNode` 가 `!customCreated` 일 때만
 * `baseStyle` 을 이 상수로 치환한다(새 BubbleType 추가 ❌). Auto(#1E3A8A, `bubbleType='auto'`)와는 한 톤 더
 * 죽인 색(#1E3A6B) + 별 아이콘/`Auto:` 라벨로 구분. glow 는 활성 시 Custom 파랑(#3B82F6)으로 살아남는다.
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

/**
 * §5.24 — **쓰기로 확실한** 도구. 읽기(`READ_TOOLS`)의 짝이며 히트 카운터를 가르는 데 쓴다.
 * Bash 로 읽고/쓴 것은 §2.1 #3 이 이미 `Read`/`Write` 로 정규화해 보내므로 이 표를 그대로 탄다.
 * **표 밖은 세지 않는다** — `manual`(사용자 고정) 같은 비-도구 이름을 쓰기로 넘겨짚지 않기 위함.
 */
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
/** Write diff 합성 시 old/new 본문 한 쪽당 최대 보관 길이(문자). 초과분은 잘라 표식 추가 — 스냅샷/메모리 폭증 방지 */
export const MAX_WRITE_DIFF_BYTES = 100_000;
/**
 * §2.1 #3 쓰기 축 — Bash diff 합성용 **사전 스냅샷**을 붙들어 두는 `tool_use_id` 개수 상한.
 *
 * 사전(Pre)에 뜬 본문은 사후(Post)가 오면 곧바로 소비돼 지워지므로 정상 흐름에서는 한 자릿수다.
 * 이 상한은 사후가 영영 오지 않는 경우(중단·크래시·훅 유실)에만 쓰이는 안전망이다
 * (§3.2.4 F′축 — 키가 늘 수 있는 자리는 다시 만들 수 있는 파생물에만 캡을 건다).
 */
export const BASH_WRITE_PENDING_MAX = 64;

// ─── 보존 정책 (§3.2.3) ───
//
// 실측(2026-08-13)에서 드러난 것 한 줄: **캡이 "키 하나당 값의 길이"에만 있고 "키 개수"엔 없다.**
// `MAX_FILE_EDITS`(20) · `MAX_WRITE_DIFF_BYTES`(100KB) 는 파일 하나를 지켰지만 경로 키가 597개까지
// 늘어 `activity.fileEdits` 만 5.77MB 였다. 아래 상수들이 그 빠진 축(A 시간 · D 병합창 · E 키 개수)이다.
//
// ⚠ 전부 **0 이면 그 축은 정리하지 않는다**(무제한) — 사용자가 설정에서 끌 수 있어야 한다는 §3.2.3 요구.
//   여기 값은 `DEFAULT_RETENTION_SETTINGS` 의 기본값이고, 실제 판정은 항상 사용자 설정을 통과한 값으로 한다.

/**
 * 파일 편집 이력 보존 기간(일). 이보다 오래된 `FileEdit` 은 버린다.
 * 30 = Claude Code `cleanupPeriodDays` 기본값과 같은 값(업계 관행 정렬).
 */
export const FILE_EDIT_RETENTION_DAYS = 30;

/**
 * 편집 이력을 들고 있는 **파일 경로 키 개수** 상한(LRU — 마지막 편집이 가장 오래된 경로부터 버림).
 *
 * 우리에게 없던 바로 그 축이다. VS Code Local History 가 `maxFileEntries`(50)로 **파일당 항목 수**를
 * 자르는 것과 짝이 되는, **파일 개수** 쪽 상한.
 */
export const MAX_FILE_EDIT_PATHS = 300;

/**
 * 같은 파일의 연속 편집을 마지막 항목에 합치는 창(ms).
 * VS Code `workbench.localHistory.mergeWindow`(10초)와 같은 개념 — 에이전트는 한 파일을 연달아
 * 고치는 일이 잦아, 이게 없으면 `MAX_FILE_EDITS`(20)가 한 턴 만에 차서 그 파일의 이력이 통째로 밀린다.
 */
export const FILE_EDIT_MERGE_WINDOW_MS = 10_000;

/**
 * 세션 하나가 보관하는 완료 명령(사용자 말풍선) 상한.
 *
 * 종전엔 `archive.push(...)` 에 상한 검사가 **아예 없었다**. IDE 스트림 복원이 2,000 이벤트인데
 * 말풍선만 무제한이라 짝이 맞지 않았다.
 *
 * ⚠ 처음 값은 200 이었으나 **실측에서 이미 232건인 세션이 나왔다**(2026-08-19). 이 축이 자르는 것은
 * 파생물이 아니라 **사용자가 직접 타이핑한 원문**이라 재생성할 방법이 없고(Claude Code 쪽 트랜스크립트도
 * 같은 30일에 만료된다), 나이 축이 아니라 개수 축이라 "많이 쓴 세션"에서 바로 발동한다.
 * 1,000 이면 한 세션을 몇 달 써도 닿지 않으면서 IDE 복원 창(2,000 이벤트)보다 여전히 촘촘하다.
 */
export const COMPLETED_COMMAND_MAX_PER_SESSION = 1000;

/**
 * `sub-streams/<agentId>/<subId>.jsonl` 보존 기간(일). 부팅 시 1회 정리.
 * ⚠ **살아있는 서브에이전트의 파일은 나이와 무관하게 보존**한다(§3.2.3 — 화면에 떠 있는 대화를 지우지 않는다).
 */
export const SUB_STREAM_RETENTION_DAYS = 30;

/**
 * `.vibisual/attachments/<sessionId>/` 첨부 보존 기간(일). 부팅 시 1회 정리.
 *
 * ⚠ 이 값은 **고아(참조 0)에만** 적용된다. 체크포인트 그래프 노드·완료 명령 보관분이 아직 그 파일을
 * 가리키고 있으면 나이와 무관하게 남긴다 — 종전에는 그 검사가 없어 세션 폴더를 mtime 만으로 통째
 * 삭제했고, 실측에서 위성 노드 89개와 완료 명령(최고령 37일)이 그 파일들을 참조하고 있었다.
 * 30 을 유지하는 근거는 git 이 unreachable 을 30일에 지우는 것과 같은 갈래라는 점이다.
 */
export const ATTACHMENT_RETENTION_DAYS = 30;

/**
 * 휴지통 보존 기간(일). 정리로 옮겨진 파일을 이만큼 두고 나서 영구 삭제한다. 0=영구 보관.
 *
 * 휴지통 자체에 만료가 없으면 "정리"가 이름만 남고 용량은 그대로다(Cursor 가 만료를 안 걸어
 * 25~30GB 가 된 그 자리). 반대로 만료만 있고 유예가 없으면 Claude Code 처럼 되돌릴 수단이 없다 —
 * 14일이면 "지난주에 뭐였지"가 닿는 창이면서 용량이 두 배로 눌러앉지 않는다.
 */
export const TRASH_RETENTION_DAYS = 14;

/**
 * 프로젝트당 원장 상한(§3.2.3 B축 = 키 개수 캡). 밀려난 줄의 몫은 `retired` 합계로 접힌다.
 *
 * ⚠ 이것은 못박힌 상한이 아니라 **`RetentionSettings.auditEntryMaxPerProject` 의 기본값**이다.
 * 사용자가 설정에서 올리거나 `0`(무제한)으로 끌 수 있다 — 실제 판정은 항상 그 설정을 통과한 값으로.
 *
 * 500 → 200 으로 내린 근거: 전선에 싣는 몫이 `AUDIT_SNAPSHOT_ENTRIES`(120)라 화면이 도달하는
 * 범위보다 여전히 넉넉하다(§3.2.3 — 읽는 쪽 상한보다 남기는 쪽이 크면 소비자에게 no-op).
 */
export const AUDIT_ENTRIES_MAX_PER_PROJECT = 200;

/**
 * §5.26 (H) A축 — 압축 마커·파일 사본 보존 일수. `RetentionSettings.insuranceRetentionDays` 의 기본값.
 *
 * 30일(파일 편집 이력)보다 짧게 잡는 이유는 담는 것이 **바이트**이기 때문이다. 보험이 값을 갖는
 * 구간은 "방금 압축됐는데 뭘 잃었지"·"방금 sed 로 날렸는데 되돌리자" 라서 14일이면 충분히 넉넉하다.
 * ⚠ 살아 있는 세션의 마커와 참조되는 blob 은 이 값과 무관하게 보존한다(§3.2.3 규칙 2·3).
 */
export const INSURANCE_RETENTION_DAYS = 14;

/**
 * §5.26 (H) E축 — 프로젝트당 보험 저장고 총 바이트 예산(MB). `insuranceVaultMaxMB` 의 기본값.
 *
 * 실측(§3.2.3, 2026-08-13) `.vibisual` 20곳 합이 216MB 였다. 보험은 우리가 프로젝트 폴더에 쓰는 것 중
 * **가장 커질 수 있는 물건**이라 예산을 명시하고 저장소 사용량 화면에 띄운다.
 * 넘치면 **미러부터** LRU 로 버리고 마커는 남긴다(마커는 수백 바이트다).
 */
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
/**
 * §5.5 #17-9 ⑭ — **표식 없이 조용한 작업**을 한 번 물어보는 판정의 예산과 한계.
 *
 * ⑬ 이 끝난 것을 걷고 나면 남는 회색지대는 실측에서 **드물다** — 살아 있는 셸 17건 중 15건이
 * 종료 표식을 갖고 있었고, 표식이 없던 2건이 전부 정당하게 대기 중인 폴링 루프였다
 * (2026-09-01). 그래서 모델 호출이라는 비싼 수단을 쓸 수 있다: 대상이 하루 몇 건 수준이다.
 * 반대로 이 값을 잘못 잡아 **매 항목마다 반복해서** 부르면 그 순간 자기증식이 된다.
 */

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

/**
 * 앱 전체에서 **한 시간에** 낼 수 있는 판정 횟수. 이 상한이 자기증식을 막는 마지막 벽이다
 * (선례: 매 Stop 마다 haiku 를 스폰해 토큰을 태운 리플렉션 · 90분에 Monitor 를 309번 띄운
 * anthropics/claude-code#55151). 넘치면 조사를 미룰 뿐 항목은 그대로 남는다.
 */
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
//
// `isSessionRunning` 의 근거 셋은 전부 자기 신고 깃발이라 끄는 쪽이 실패하면 영영 도는 것처럼
// 보인다. 이 축만 **에이전트가 직접** 답한다. 구조·예산은 §5.5 #17-9 ⑭ 백그라운드 작업 판정을
// 그대로 따른다(두 벌이 되면 한쪽만 고쳐져 어긋난다).

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

/** 모델이 쓴 사유·대기 대상을 화면·저장에 남길 때의 길이 상한. */
export const SESSION_PROBE_REASON_MAX = 160;

/**
 * 앱 전체에서 **한 시간에** 낼 수 있는 세션 판정 횟수. 자기증식을 막는 마지막 벽이다
 * (선례: 매 Stop 마다 haiku 를 스폰해 토큰을 태운 브레인 리플렉션). 넘치면 미룰 뿐 세션은 그대로.
 */
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

/**
 * 설정 UI 가 쓰는 입력 한계 — 사용자가 아무 값이나 넣어 저장을 망가뜨리지 않게.
 * `min: 0` 은 전부 "무제한"의 의미라 허용한다(§3.2.3).
 */
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

/**
 * §5.3 #9-1 (P축) — 세션 턴 예산의 **하한**. 0(끔)이 아닌 값은 이 아래로 못 내려간다.
 *
 * 압축은 그 자체로 문맥 전체를 읽는 큰 요청이라 자주 부르면 아끼는 것보다 쓰는 것이 많아진다.
 * 이 바닥이 "절약하려다 더 쓰는" 자리를 막는 유일한 벽이다.
 */
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

/**
 * 숫자 축만 골라낸 키 — 스위치(boolean)·프리셋(문자열) 축은 min/max/step 이 뜻을 갖지 않는다.
 * 파생시켜야 새 축을 넣을 때 **컴파일러가 빠뜨림을 잡아 준다**(`NumericRetentionKey` 와 같은 수법).
 */
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

/**
 * §5.3 #9-1 — 프리셋 세 벌. **값을 채우는 손일 뿐** 판정 근거가 아니다(진실은 항상 값이다).
 *
 * - `off` — 이 기능이 생기기 전과 **바이트 단위로 같은 스폰**(env 키를 하나도 안 넣는다).
 * - `balanced` — 문맥이 자라는 속도만 늦춘다. 답의 길이·사고 깊이는 건드리지 않는다.
 * - `saver` — 위에 더해 생성 상한·압축 조기화까지 건다. 긴 답이 잘릴 수 있다는 대가가 있다.
 */
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

/**
 * 들어온 절약 설정을 안전한 값으로 정규화한다(서버·클라 공용 — 판정이 두 벌이 되면 화면과 실제가 어긋난다).
 *
 * **바닥이 둘 있다**: 켠 상태(0 초과)의 세션 턴 예산은 `TOKEN_SAVER_TURN_BUDGET_FLOOR` 아래로,
 * 생성/사고 상한은 `TOKEN_SAVER_OUTPUT_FLOOR` 아래로 못 내려간다 — 그 아래는 절약이 아니라 손해다.
 * `preset` 은 입력을 믿지 않고 **값에서 다시 판정**한다(둘이 어긋난 저장분이 와도 화면이 거짓말하지 않게).
 */
/**
 * §5.3 #9-1 (Q축) — **압축 창의 최종 값.** 기존 3층(에이전트 → 설정 창 → 내장 기본) 위에
 * 토큰 절약을 **조이는 방향으로만** 얹는다.
 *
 * 규칙은 하나다 — **더 작은 창이 이긴다.** 창이 작을수록 일찍 접히고, 일찍 접힐수록 매 턴
 * 다시 읽는 양이 준다. 그래서 절약 값이 더 크면 아무 일도 하지 않는다(느슨하게 푸는 일은 없다).
 *
 * - 절약이 미설정(`''`)이면 **종전 결과 그대로**다(이 축이 생기기 전과 바이트 단위로 같다).
 * - 종전 결과가 꺼짐이면 절약 값이 그 자리를 **켠다** — 절약을 켠 것 자체가 "접어라"는 뜻이다.
 * - 종전 결과가 `'auto'`(CLI 가 창을 정함)면 숫자 쪽이 조이는 값이라 절약이 이긴다.
 *
 * 이 함수를 **두 곳이 함께 본다**(`buildConfigArgs` 의 `--autocompact`, 턴 경계 압축 판정).
 * 한쪽만 고치면 CLI 는 200k 에서 접는데 우리는 400k 기준으로 쏘게 되어 둘이 어긋난다.
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

/**
 * §5.3 #9-1 — 3층 해소(**에이전트 값 → 전역 값 → 미설정**). `--autocompact` 가 쓰는 3층 그대로다.
 *
 * 에이전트 칸의 `0`/미설정은 **"전역을 따른다"** 는 뜻이다(`bashDefaultTimeoutMs` 와 같은 규약 —
 * 숫자 입력칸에 "미설정"을 따로 표현할 자리가 없어 둘을 같은 뜻으로 묶었다). 그래서 에이전트가
 * 전역 절약을 **더 조일 수는 있어도 풀 수는 없다** — 절약 축에서는 안전한 방향이다.
 * 최종 결과가 `0` 이면 env 키를 만들지 않는다.
 */
export function resolveTokenSaverNumber(agentValue: number | undefined, globalValue: number): number {
  if (typeof agentValue === 'number' && Number.isFinite(agentValue) && agentValue > 0) return Math.floor(agentValue);
  return globalValue;
}

/**
 * §5.3 #9-1 (J~M) — 절약 축을 **스폰 env** 로 조립한다.
 *
 * ⚠ **켜지 않은 축은 키 자체를 넣지 않는다.** 이것이 무변경의 근거다 — 전 축이 꺼진 사용자의
 * env 는 이 기능이 생기기 전과 바이트 단위로 같다(§4 "`provider` 가 undefined 면 클로드 경로 그대로").
 *
 * 값이 아니라 **문자열**로 나가는 이유는 env 규약이고, `DISABLE_NON_ESSENTIAL_MODEL_CALLS` 는
 * CLI 가 존재 여부가 아니라 값을 보므로 끌 때는 키를 안 넣는다(빈 문자열 ❌ — 판본에 따라 참으로 읽힌다).
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
//
// 실측(2026-08-14): 가동 10.9시간 앱의 **메인 프로세스 3,050MB**. 디스크 영속분은 73MB 뿐인데
// 누적 읽기는 15,949MB(읽을 대상 전체는 2,173MB) — 같은 파일을 일곱 번 넘게 다시 읽었다.
// 원인은 세션 캐시가 **"파일 몇 개"** 로만 묶여 있던 것(64개). 26MB 와 4KB 가 같은 한 칸을
// 차지하니 트랜스크립트가 수천 개인 기계에서 캐시가 끊임없이 교체되고 그때마다 전량 재파싱이 돈다.
//
// ⚠ 여기 값들도 §3.2.3 과 같은 규약 — **0 이면 그 축은 끈다**(무제한).

/**
 * 세션 JSONL 파생 캐시(제목·마지막 응답·사용자 메시지·컨텍스트 스캔·토큰 스캔)가 **다 함께**
 * 쓰는 총 바이트 예산.
 *
 * 개수가 아니라 바이트인 이유는 `byteBudgetCache.ts` 머리말 참조.
 *
 * ⚠ 예산의 기준은 "가장 큰 파일 하나"가 아니라 **작업 집합**(스냅샷 한 바퀴가 만지는 세션 전체)이다.
 * 종전 48MB 는 앞의 기준으로 잡혀 있었는데, 그러면 세션이 늘어난 기계에서 한 바퀴를 도는 동안에도
 * 방금 채운 항목이 다시 밀려나 적중률이 0 으로 수렴한다(LRU 스래싱). 실측 2026-08-16: 체크포인트가
 * 참조하는 세션 178개 · 트랜스크립트 합 228MB 인 기계에서 도구 이벤트 1회마다 832MB 를 재파싱하고
 * 코어 하나를 5초씩 잡았다 — 읽은 총량이 대상 총량의 3.6배였다.
 *
 * 캐시가 담는 것은 파일이 아니라 **파생 상태**(턴 배열·이벤트 텍스트·누적 숫자)라 트랜스크립트
 * 총량보다 훨씬 작다. 반대로 한 번 밀려났을 때 치르는 재파싱 피크는 파일 크기의 4~5배(§3.2.4 G축)라,
 * 예산을 작업 집합 위로 올리는 것이 오히려 최대 점유를 낮춘다. 상한 자체는 I축(압력 축출)이 지킨다.
 */
export const SESSION_CACHE_BYTE_BUDGET = 256 * 1024 * 1024;

/**
 * 같은 캐시의 **항목 개수** 보조 상한. 바이트 예산과 둘 다 적용되고 먼저 걸리는 쪽이 이긴다.
 * 작은 파일 수천 개가 들어와 엔트리 오버헤드만으로 부푸는 경우를 막는 자리(값이 작아 바이트
 * 예산에는 안 걸리는 구간).
 *
 * ⚠ 이 값은 **몫으로 쪼개져** 캐시마다 나뉘므로(가장 작은 몫이 8%), 작업 집합보다 넉넉해야 한다.
 * 512 일 때 실제 상한은 userMessages 153 · contextScan 61 · lastAssistant 51 · paths 40 이었고,
 * 세션 178개인 기계에서는 넷 다 작업 집합보다 작아 바이트 예산과 무관하게 개수만으로 스래싱했다.
 */
export const SESSION_CACHE_MAX_ENTRIES = 4096;

/**
 * JSONL 을 훑을 때 **한 번에 메모리로 올리는 최대 바이트**(§3.2.4 G축).
 *
 * 종전엔 `Buffer.allocUnsafe(구간 전체)` 라 26MB 파일이면 버퍼 26MB + `toString()` 문자열
 * (UTF-16 이라 최대 52MB) + `split('\n')` 조각 배열이 한꺼번에 잡혀 피크가 파일 크기의 4~5배였다.
 * 청크로 끊어 읽으면 같은 줄을 같은 순서로 한 번씩 먹이므로 **결과는 동일**하고 피크만 상수가 된다.
 */
export const JSONL_SCAN_CHUNK_BYTES = 1024 * 1024;

/**
 * 세션·에이전트 id 를 키로 쓰는 **파생 Map** 의 키 개수 상한(§3.2.4 F축 경량판).
 *
 * 값이 작아 바이트 예산까지는 필요 없지만, 키가 세션 수만큼 늘어나면 오래 켜 둔 앱에서 계속 자란다
 * (`brainInjections`·`recentToolDurations` 처럼 값에는 링버퍼 캡이 있는데 **키에는 없던** 자리들).
 * 1,000 은 한 프로젝트에서 동시에 의미 있게 다룰 세션 수보다 훨씬 크다 — 화면에 영향이 없는 선.
 */
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

/**
 * 압력 대응을 다시 실행하기까지의 최소 간격(ms).
 *
 * 축출 직후에는 GC 가 아직 안 돌아 `heapUsed` 가 그대로라, 이 간격이 없으면 매 표본마다
 * 캐시를 비워 "캐시가 영영 비어 있는" 상태가 된다 — 그러면 재파싱이 오히려 늘어난다.
 */
export const MEMORY_PRESSURE_COOLDOWN_MS = 120_000;

// ─── IDE 워크스페이스 탐색기 (§5.5 #17-19 v4.71) ───

/**
 * 디렉터리 한 겹에서 클라이언트로 넘기는 엔트리 최대 개수.
 * `node_modules` 처럼 수천 개가 든 폴더를 펼쳤을 때 사이드바 한 칸이 통째로 얼어붙는 것을 막는다
 * (넘치면 앞에서 자르고 `truncated` 로 알린다 — 가상화 ❌, 탐색기는 곁눈 자리다).
 */
export const WORKSPACE_DIR_ENTRY_MAX = 500;

// ─── IDE 내장 편집창 (§5.5 #17-27 v4.87) ───

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

/**
 * §5.5 #17-27 ⑯ — 그 창이 **접어 두는 세션 수** 상한(지금 보고 있는 세션은 여기 안 든다).
 *
 * 탭 묶음은 세션마다 따로 서므로 세션을 오갈수록 키가 는다 — 값 길이만 재고 키 개수는 안 재는 캡은
 * 캡이 아니다. 넘으면 **가장 오래전에 떠난 세션**부터 버린다(그 세션으로 돌아가면 빈 편집창이다).
 */
export const IDE_EDITOR_TAB_SCOPE_MAX = 12;

/** 편집창 폭(px) — 기본값과 드래그 허용 범위. */
export const IDE_EDITOR_WIDTH = { DEFAULT: 520, MIN: 280, MAX: 1400 } as const;

// ─── §5.5 #17-27 ⑭ · #17-25 ④-1 — 편집창이 그림으로 여는 파일 ───

/**
 * 편집창이 **텍스트가 아니라 그림으로** 여는 확장자(소문자, 마침표 포함).
 *
 * 판정을 확장자로 하는 이유는 바이트를 한 번 더 훑지 않기 위해서다 — 형식별 매직 넘버 스니핑은
 * 형식마다 다른 규칙을 우리가 떠안는 일이고, 여기서 틀렸을 때의 대가는 "안 그려짐" 하나뿐이다.
 */
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
];

/**
 * §5.5 #17-25 ④-1 — 주석을 구워 **원본 형식 그대로 덮어쓸 수 있는** 확장자.
 *
 * `canvas.toBlob` 이 실제로 인코딩하는 세 가지뿐이다. 나머지(svg·gif·ico·bmp·avif)에 저장하면
 * 브라우저가 조용히 PNG 를 뱉어 **확장자와 내용이 어긋난 파일**이 되므로 그 자리는 아예 막는다.
 */
export const WORKSPACE_IMAGE_BAKEABLE_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg', '.webp'];

/**
 * 미리보기로 통째로 읽어 보내는 이미지 크기 상한(bytes).
 *
 * 텍스트 상한(`WORKSPACE_FILE_MAX_BYTES`)과 갈라 두는 이유는 성격이 다르기 때문이다 — 텍스트는
 * "잘리면 저장이 위험해서" 막는 값이고, 이미지는 읽기 전용이라 위험이 없고 대신 **4K 스크린샷 한 장이
 * 예사로 5MB** 라 같은 상한을 쓰면 정작 볼 것을 못 본다. 넘으면 미리보기 없이 종전 안내로 떨어진다.
 */
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

// ─── §5.13 (R) — 워크스페이스 파일 하나를 **무엇으로 여는가** ───────────────────
//
// 클릭 지점은 여럿이다(스트림 본문의 경로 손잡이 · 탐색기 · 편집한 파일 목록). 그 자리마다
// 자기 판정을 들면 같은 파일이 자리마다 다르게 열린다 — 그래서 갈림은 아래 함수 **하나**다.
//
// 그리고 **확장자와 앱의 대응표를 코어가 들지 않는다**(§5.13 (R-1) · (P) 독립 규약). 표를
// 여기 적으면 앱이 늘 때마다 코어가 바뀐다. 앱이 "나는 이 확장자를 연다"고 선언한 것을
// 인자로 받아 훑을 뿐이라, 앱이 몇 개로 늘어도 이 파일은 그대로다.

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

/**
 * **우리가 흉내 내지 않는 것들** — OS 연결 프로그램으로 넘긴다(§5.13 (R-6)).
 *
 * 압축을 우리 안에서 풀어 보여 주거나 폰트 미리보기를 그리는 일은 이 앱이 할 일이 아니다.
 * 브라우저가 디코드하지 못하는 미디어(mkv·avi·wma…)도 여기 있다 — 우리 창에서 못 여는 것을
 * 우리 창으로 보내면 "눌렀더니 검은 화면"이 되므로, 열 수 있는 프로그램에게 그대로 넘긴다.
 *
 * **`.ts` 는 여기 없다** — 영상 컨테이너이기도 하지만 이 저장소에서는 압도적으로 TypeScript 다.
 */
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
  '.pdf': 'application/pdf',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.obj': 'text/plain',
  '.mtl': 'text/plain',
  '.stl': 'application/octet-stream',
  '.ply': 'application/octet-stream',
  '.fbx': 'application/octet-stream',
  '.dae': 'model/vnd.collada+xml',
  '.3mf': 'model/3mf',
};

/**
 * 편집 결과(음악 내보내기 등)를 프로젝트 안에 쓸 때의 상한(bytes).
 *
 * 읽기(스트리밍)에는 상한이 없다 — 구간 요청이라 파일이 아무리 커도 메모리에 다 올라오지 않는다.
 * 쓰기만 막는 이유는 본문이 통째로 메모리를 지나기 때문이다. WAV 는 분당 약 10MB 이므로 이 값이면
 * 한 시간짜리도 들어간다.
 */
export const WORKSPACE_MEDIA_MAX_BYTES = 768_000_000;

/** 확장자에 맞는 미디어 MIME. */
export function workspaceMediaMime(filePath: string): string {
  return WORKSPACE_MEDIA_MIME_BY_EXT[workspaceFileExt(filePath)] ?? 'application/octet-stream';
}

// ─── §5.13 (R-8) — 못 읽는 영상·소리는 **변환해서** 우리 안에서 연다 ─────────────
//
// 코덱을 받는 것이 아니다. Chromium 은 시스템 코덱을 쓰지 않으므로(실측: `.avi` 는
// `DEMUXER_ERROR_COULD_NOT_OPEN`) 코덱팩을 깔아도 우리 창에서는 아무 일도 일어나지 않는다.
// 대신 **ffmpeg 으로 포장을 바꿔** 우리 엔진이 읽는 형식으로 만든다 — 영상은 리먹스(`-c copy`)가
// 먼저라 25MB 가 0.073초에 끝나고 화질도 그대로다(실측).

/**
 * 변환하면 우리 영상 앱이 여는 컨테이너.
 *
 * **mkv 는 여기 없다** — 동봉 ffmpeg 에 Matroska 데먹서가 있어 그냥 열린다(H.264-in-MKV 실측 확인).
 * 여기 있는 것들은 데먹서 자체가 빠져 있어 포장을 바꿔야 하는 것들이다.
 */
export const WORKSPACE_CONVERT_VIDEO_EXTENSIONS: readonly string[] = [
  '.avi', '.divx', '.wmv', '.asf', '.flv', '.f4v', '.mpg', '.mpeg', '.mpe', '.m2v',
  '.m2ts', '.vob', '.rm', '.rmvb', '.mxf', '.ogm',
  // **.ts·.mts 는 일부러 없다** — MPEG 전송 스트림이기도 하지만 이 저장소에서는 TypeScript 다.
  //   영상 하나를 살리려고 소스 파일 전부를 변환기로 보낼 수는 없다(테스트가 이 자리를 지킨다).
];

/**
 * 변환하면 우리 음악 편집기가 여는 소리 형식.
 *
 * WAV(PCM)로 뽑으므로 편집기가 그대로 받아 자르고 다시 내보낸다. **mid·midi 는 여기 없다** —
 * 악보라서 디코딩이 아니라 신시사이저가 필요하고, ffmpeg 도 소리를 만들지 못한다.
 */
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

/**
 * §5.13 (R-8) (d) — 변환 결과의 자리.
 *
 * 키에 **크기와 수정 시각**을 넣는 이유는 원본이 바뀌면 캐시가 저절로 빗나가야 하기 때문이다.
 * 같은 파일을 다시 누르면 같은 이름이 나오므로 두 번째부터는 변환 없이 즉시 열린다.
 */
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
 * §5.13 (R-1) — 이 파일을 **어디로 보낼 것인가**. 클릭 지점 전부의 유일한 갈림길.
 *
 * 순서에 뜻이 있다:
 *   ① 실행할 수 있으면 실행이 먼저다 — macOS `.app` 은 폴더이면서 실행이라 폴더 판정보다 앞서야 한다.
 *   ② 폴더는 탐색기.
 *   ③ **앱이 받겠다고 선언한 확장자**는 그 앱으로(코어는 어떤 앱인지 모른다).
 *   ④ 그림 · PDF 는 우리 안에서 본다. `.svg` 는 예외 — 텍스트라 편집창에서 여는 것이 종전이자 더 쓸모 있다.
 *   ⑤ 우리가 다룰 이유가 없는 것은 연결 프로그램.
 *   ⑥ 나머지는 전부 편집창(모르는 확장자를 바깥으로 던지지 않는다 — 텍스트일 가능성이 가장 크다).
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
export const DEFAULT_MAX_SATELLITES = 5;
/** 사용자가 패널에서 폴더별 Max 를 편집할 때 허용 범위(클램프 경계). */
export const SATELLITE_MAX_BOUNDS = { MIN: 1, MAX: 50 } as const;

// ─── 외부 폴더 표시 규약 (§2.1 — 요약 · 예산 · 접기 · 이름) ───

/**
 * (A) 접합 버블이 요약으로 보여 줄 **자손 이름 칩** 개수.
 * 접합은 스스로 만져진 적이 없어 라벨이 경로 하나뿐이었고, 그래서 25곳을 삼킨 채 아무 말도
 * 하지 않았다. 이 칩이 "그 안에 무엇이 있나"를 대신 말한다. 넘치는 수는 `+N` 으로 접는다.
 */
export const EXTERNAL_SUMMARY_CHIPS = 3;

/**
 * (B) 최상위에 동시에 세울 외부 폴더 **예산** 기본값.
 * 개수는 이 값이 고정하고 무엇이 보일지는 활동이 정한다 — 그래서 폭발과 식별 불가가 한 장치로
 * 함께 풀린다. **핀(`preservePinned`)은 이 수에 들지 않는다**(사용자 결정).
 */
export const EXTERNAL_TOP_BUDGET_DEFAULT = 12;

/** (B) 사용자가 옵션창에서 예산을 조절할 때의 허용 범위(클램프 경계). */
export const EXTERNAL_TOP_BUDGET_BOUNDS = { MIN: 1, MAX: 40 } as const;

/**
 * (B) **한 부모에서 꺼낼 수 있는 자식 수.**
 *
 * 이 상한이 없으면 승격이 접합 트리를 무너뜨린다 — `…/claude/<프로젝트>` 아래 형제 12개가
 * 예산을 통째로 먹고 최상위에 우르르 서면, 그것은 접합 트리가 막으려던 바로 그 그림이다
 * (형제 12개는 전부 같은 성격이라 펼쳐도 사용자가 아는 것이 늘지 않는다).
 *
 * 반대로 **서로 다른 가지**(`.claude` · `.vibisual` · `.codex`)는 펼칠수록 정보가 는다. 그래서
 * 부모당 몇 개까지만 꺼내고, 남은 예산은 다른 부모에게 돌아간다 — 결과적으로 화면은 "한 자리를
 * 깊게"가 아니라 **"여러 자리를 넓게"** 보여 준다.
 */
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

/**
 * (D) **알려진 자리 사전** — 경로가 아니라 정체를 말한다.
 *
 * `c--users-dev-work-my-app` 같은 slug 와 세션 UUID 는 사람이 읽을 수
 * 없다. 이 표에 걸리면 라벨을 그 자리의 **이름**으로 바꾼다. **경로를 지우지 않는다** —
 * 바뀌는 것은 라벨뿐이고 `absolutePath`·노드 키는 그대로라 탐색기 열기·위성 매칭은 불변이다.
 *
 * 순서가 우선순위다(구체적인 것이 먼저). 표에 없는 자리는 종전 라벨 그대로 — §3.3 대로
 * 이 표가 정본이고 코드에 자리 이름을 박지 않는다.
 */
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

/**
 * `GET /api/folder-files` 가 **한 겹**에서 한 번에 돌려주는 엔트리 수.
 *
 * 종전에는 폴더를 통째로 재귀해 전부 실어 보냈다 — 사용자 홈이 외부 폴더 버블로 뜨면
 * 61만 항목·83MB 가 되고, 서버가 메인 프로세스와 한 몸이라 창이 통째로 멈췄다(§7.5).
 * 이제 이 값만큼 끊어 보내고 목록 바닥에 닿을 때마다 다음 장을 부른다.
 */
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

// ─── 버블 크기 ───

export const NODE_MIN_SIZE = 70;
export const NODE_MAX_SIZE = 180;
/** 파일(위성) 버블 최소/최대 크기 */
export const FILE_MIN_SIZE = 40;
export const FILE_MAX_SIZE = 90;

// ─── §5.24 읽기 히트맵 ───

/** 히트맵 모드에서 파일·폴더·도메인이 **함께 쓰는** 지름 범위(한 자여야 서로 비교된다). */
export const HEAT_MIN_SIZE = 44;
export const HEAT_MAX_SIZE = 150;

/**
 * 히트 램프 7칸 — 거의 검은 남색에서 **빨강까지** 간다(불꽃의 관습적 순서). 사이 값은 선형 보간한다.
 *
 * 명도는 **노랑(index 4)까지 단조 증가**하고, 그 위 두 칸은 밝기 대신 **색상**으로 말한다
 * (노랑 → 주황 → 빨강). 밝기만으로 순서를 읽는 층이 램프의 5/7 을 덮고, 남은 뜨거운 구간은
 * 초록 성분이 단조로 빠지며 갈리므로 색각 이상에서도 "가장 뜨거운 쪽"이 뭉개지지 않는다
 * (차가운 끝의 파랑과 뜨거운 끝의 빨강은 명도가 비슷해도 색상이 정반대라 서로 섞이지 않는다).
 */
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
 * §5.24 히트 척도 곡선 목록 — **횟수를 램프 위 자리로 옮기는 방식**. 순서가 곧 범례의 버튼 순서다.
 *
 * 파일 접촉 횟수는 거의 언제나 롱테일이라, 선형 하나만 두면 극단값 하나가 나머지를 램프 첫 칸에
 * 통째로 눌러 앉힌다(실측 2026-09-09 · 읽기 대상 502개 중 **491개(97.8%)** 가 첫 칸 · 중앙값 4회
 * 대 최대 2,471회). 그래서 곡선을 **사용자가 고르는 축**으로 연다 — 어느 것이 맞는지는 지금 보고
 * 있는 분포가 정하지, 우리가 미리 정할 수 없다.
 *
 * - `log`     — 기본. `log1p(v)/log1p(max)`. 최대값이 10배로 자라도 로그는 1.3배만 자라 **지도가
 *               다시 눌리지 않는다**. 단조성을 지키면서 절대 크기도 보존한다.
 * - `linear`  — 종전 동작(`v/max`). 값의 비율을 그대로 본다.
 * - `sqrt`    — 로그와 선형 사이. 낮은 쪽을 덜 들어올린다.
 * - `cbrt`    — 세제곱근. `sqrt` 보다 더 들어올리고 로그보다 덜하다.
 * - `quantile`— 값이 아니라 **순위**로 칠한다. 램프를 가장 고르게 쓰지만 3회와 5회를 크게 벌려
 *               없는 차이를 만들 수 있어 기본으로 두지 않는다.
 */
export const HEAT_CURVES = ['log', 'linear', 'sqrt', 'cbrt', 'quantile'] as const;

/**
 * 켜면 시작하는 곡선. **로그다** — 지금 살아 있는 분포에서 첫 칸 쏠림이 97.8% → 46.2% 로 내려가고,
 * 남은 46% 는 실제로 1~2회짜리라 어떤 곡선으로도 나눌 수 없는 데이터의 진실이다.
 */
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
//
// §4 v2.38 — 정적 테이블은 시드(폴백)로 격하. 런타임 SSOT 는 server `ModelRegistryService` 가 빌드해
// `GraphSnapshot.modelRegistry` 로 클라에 전달하는 `ModelRegistry`.
// 콜사이트는 `getModelContextLimit(modelId, registry?)` 헬퍼 통일.

/**
 * 풀ID → 컨텍스트 한도(토큰) **시드**.
 *
 * v2.40 이 이 테이블을 비우며 "패밀리 디폴트만으로 충분(Opus=1M, Sonnet/Haiku=200k)"이라고 적었는데,
 * 그 전제는 깨졌다 — 같은 sonnet 안에서 **Sonnet 5/4.6 은 1M, Sonnet 4.5 는 200K** 다. 패밀리 하나에
 * 한 값만 두면 둘 중 하나는 반드시 틀린다. 그래서 **아는 풀ID 는 여기 정확히 적고**, 패밀리 디폴트는
 * §4 v2.38 이 준 원래 역할("처음 보는 풀ID 폴백")로 되돌린다.
 *
 * 출처는 Anthropic 공개 문서 — 모델 개요표(`platform.claude.com/docs/en/about-claude/models/overview`)
 * 의 Context window 행 + 가격표의 long-context 주석("Claude 4.6 and later models ... include the full
 * 1M token context window"). 확인 2026-09-02.
 *
 * 해소 순서는 `getModelContextLimit` — (1) 레지스트리 entry → (2) 이 시드 → (3) 패밀리 디폴트 → (4) `DEFAULT_CONTEXT_LIMIT`.
 * `ANTHROPIC_API_KEY` 가 있으면 `/v1/models` 의 `max_input_tokens` 가 (1) 에서 이 시드를 덮어 최신을 따라간다.
 */
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // 1M 세대 — 4.6 이후는 1M 이 표준가에 포함된다(장문 프리미엄 ❌).
  'claude-fable-5-1': 1_000_000,
  'claude-fable-5': 1_000_000,
  'claude-opus-5': 1_000_000,
  'claude-opus-4-8': 1_000_000,
  'claude-opus-4-7': 1_000_000,
  'claude-opus-4-6': 1_000_000,
  'claude-sonnet-5': 1_000_000,
  'claude-sonnet-4-6': 1_000_000,
  // 200K 세대 — 4.5 이하. 은퇴 모델도 남긴다(지난 세션 JSONL 에 그 ID 가 그대로 남아 조회된다).
  'claude-opus-4-5': 200_000,
  'claude-opus-4-1': 200_000,
  'claude-opus-4-0': 200_000,
  'claude-sonnet-4-5': 200_000,
  'claude-sonnet-4-0': 200_000,
  'claude-haiku-4-5': 200_000,
};
/**
 * 알 수 없는 모델의 기본 컨텍스트 한도 — 패밀리 추론까지 실패할 때만.
 *
 * **낮은 쪽으로 둔다.** 실제보다 작게 잡으면 게이지가 일찍 차서 성가신 정도지만, 크게 잡으면
 * 넘치기 직전까지 아무 경고도 못 준다. 현행 모델의 실제 하한(Haiku 4.5)과도 같은 값이다.
 */
export const DEFAULT_CONTEXT_LIMIT = 200_000;

// ─── 에이전트 ───

export const MAX_AGENTS = 10;
export const MAX_AGENT_EVENTS = 30;

/**
 * §5.3 #10 (판올림 번호 발급 대기) — **커스텀 에이전트 정원(프로젝트당).**
 *
 * `POST /api/create-custom-agent` 는 §3.7 빌더 구축 경로라 loopback 토큰만 있으면 닿는데 **개수
 * 제한이 한 곳도 없었다**(`MAX_AGENTS` 는 이름과 달리 이 축이 아니고, 유일한 사용처도 주석 처리된
 * 상태다). 그래서 "작업이 끝나면 새 에이전트를 둘 만들어라" 한 줄이면 버블·자식 프로세스가
 * 기하급수로 늘고, 각 자식이 다시 그 규칙을 물려받아 자기증식이 성립했다 — §5.10 리플렉션이
 * 전체 토큰의 76.9% 를 태웠던 그 계열의 사고이고, 그쪽은 시간당 상한·동시 상한·백오프로 막았는데
 * 스폰 축에는 그 세 장치가 없었다.
 *
 * 값은 **막으려는 것과 지키려는 것 사이**에서 골랐다 — 빌더가 짜는 오케스트라는 실측 5~8개라
 * 40 이면 정상 사용을 한 번도 건드리지 않고, 자기증식은 두 세대 안에 벽을 만난다.
 * 사용자가 캔버스에서 직접 만드는 것도 같은 정원을 쓴다(창구가 하나라 예외를 두면 그 예외가
 * 곧 우회로가 된다 — 정원이 찼다는 것은 화면에 40개가 이미 있다는 뜻이고, 그때는 사람도 지운다).
 */
export const CUSTOM_AGENT_MAX_PER_PROJECT = 40;

/**
 * §5.3 #9 (판올림 번호 발급 대기) — **한 세션 명령 대기열의 길이 상한.**
 *
 * 위 정원이 "몇 개나 뜨나"를 막는다면 이쪽은 "한 놈이 몇 번이나 자기를 다시 부르나"를 막는다.
 * 에이전트는 `POST /api/commands/:sessionId` 로 **자기 세션에** 명령을 넣을 수 있고, 턴이 끝나면
 * Stop 훅이 큐에서 다음 것을 꺼내 다시 띄운다 — 큐에 상한이 없으면 그 고리는 끊기지 않는다.
 * 사용자가 손으로 쌓는 명령은 실측 한 자릿수라 이 값이 사람의 사용을 막을 일은 없다.
 */
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

/**
 * Cowork 설정 홈 재탐색 간격 (ms) — §3.6 훅 설치처 · §5.7 #24 세션 스캔이 공유한다.
 *
 * Cowork 세션 홈은 `<userData>/claude-code-sessions/<org>/<user>/<session>` 3겹이라 열거에
 * `readdir` 이 세 번 중첩된다. 세션 스캔(10초)마다 그걸 다시 훑으면 세션이 수백 개인 기계에서
 * 같은 디렉터리를 하루 8,640번 읽는다 — 디렉터리 구성은 그만큼 자주 바뀌지 않으므로 캐시한다.
 * 새 세션이 뜨고 이 간격 안에 훅이 깔리면 그 세션은 첫 턴부터 잡힌다.
 */
export const COWORK_HOME_CACHE_MS = 15_000;

/**
 * 한 번에 다루는 Cowork 세션 홈 개수 상한 — **최근 것부터**.
 *
 * Cowork 세션 디렉터리는 대화를 할수록 쌓이기만 하고 스스로 줄지 않는다(실측: 이 기계에
 * 7월 한 주에만 8개). 상한이 없으면 훅 주입 대상과 세션 스캔 대상이 함께 무한히 는다 —
 * "키 개수엔 캡이 없다"가 만든 용량 폭증과 같은 자리다. 오래된 세션은 이미 끝난 대화라
 * 훅을 깔아 봐야 발화하지 않으므로, 최근 것만 본다.
 */
export const COWORK_HOME_SCAN_MAX = 48;

/**
 * 에이전트 자동 idle 전환 임계값 (ms) — 부모/서브 모두 적용.
 * 마지막 이벤트 timestamp로부터 이 시간을 넘기면 서버가 status='idle'로 전환.
 * active/completed 양쪽 모두 대상. 수동 dismiss·좀비 제거와 별개 축.
 */
export const AGENT_IDLE_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * §2.4 (잠듦) — 이 시간을 넘겨 아무 명령도 처리하지 않은 세션의 claude 자식 프로세스를 회수한다.
 * Anthropic 자사 Claude Desktop 의 WarmLifecycle(idleTimeoutMs: 900_000)과 같은 값.
 * 대화는 디스크 JSONL 에 남아 있어 다음 명령이 --resume 으로 그대로 이어 간다.
 */
export const SUBAGENT_DORMANT_IDLE_MS = 15 * 60 * 1000;
/** 자동 idle 전환 판정 주기 (ms) */
export const AGENT_IDLE_SWEEP_INTERVAL_MS = 30_000;

/**
 * §9 "열려 있어도 오래 안 보면 내려놓는다" — **배경 탭 유휴 해제 임계값(ms)**.
 *
 * 어떤 창의 구독 범위(§9 스코프드 구독)에도 들어 있지 않고, 이 시간 동안 아무 일도 하지 않은
 * 프로젝트를 `unloadProject`(stub 강등)로 내려놓는다. 탭은 그대로 보이고 클릭하면 되살아난다.
 *
 * **0 이면 이 정리를 하지 않는다**(§3.2.3 "전부 사용자 조절 가능 · 0 = 무제한" 규약과 동일).
 */
export const PROJECT_IDLE_UNLOAD_MS = 15 * 60 * 1000;

/** 배경 탭 유휴 해제 판정 주기 (ms). 판정 자체가 부하가 되면 안 되므로 넉넉히 잡는다. */
export const PROJECT_IDLE_UNLOAD_SWEEP_MS = 60_000;

/**
 * 힙 압력(§3.2.4 I축)이 걸렸을 때 적용하는 **낮춘** 유휴 임계값(ms).
 * 압력 상황에서는 "15분은 기다려 보자"가 사치라 3분으로 좁혀 먼저 내려놓는다.
 * `PROJECT_IDLE_UNLOAD_MS` 가 0(끔)이면 이 값도 적용하지 않는다 — 끈 것은 끈 것이다.
 */
export const PROJECT_IDLE_UNLOAD_PRESSURE_MS = 3 * 60 * 1000;

/**
 * §9 "탭을 옮긴 직후의 빈 캔버스는 빈 프로젝트가 아니다" — **불러오는 중 표시를 띄우기까지 기다리는 시간(ms)**.
 *
 * 탭 전환은 `set-project-scope` 선언 → 서버가 그 자리에서 스냅샷 1벌 회신, 이라는 **왕복**이다.
 * 같은 기기에서는 눈에 띄지 않지만 원격(느린 회선)에서는 몇 초씩 걸리고 그동안 캔버스가 비어
 * 보인다. 그렇다고 즉시 띄우면 빠른 전환마다 표시가 깜빡여 오히려 거슬리므로, **이 시간을
 * 넘겨 기다릴 때만** 조용히 나타난다(도착하면 사라진다).
 */
export const PROJECT_LOAD_HINT_DELAY_MS = 400;

/**
 * §9 — 이 시간을 넘겨서도 스냅샷이 안 오면 **문구를 바꾼다**("불러오는 중" → "회선이 느립니다").
 *
 * 같은 말을 계속 띄우면 멈춘 것처럼 보이고, 사용자는 앱이 죽었는지 회선이 느린지 알 길이 없다
 * (원격 접속에서 실제로 나온 신고다). 상태는 그대로이고 **말만 정확해진다.**
 */
export const PROJECT_LOAD_HINT_SLOW_MS = 6_000;

/**
 * §4 v1.50/v3.60 — Claude.ai 한도 사용률 경고 임계(%).
 * DetailPanel 게이지·헤더 사용량 필·팝업이 모두 이 값을 공유한다(색 기준 단일화).
 */
export const USAGE_LIMIT_WARN_PCT = 70;
export const USAGE_LIMIT_DANGER_PCT = 90;

/**
 * §4 — 사용량 표시값을 다시 조립하는 주기.
 *
 * 종전(구 v3.62)에는 이 자리에 `/api/oauth/usage` 직접 호출용 URL·타임아웃이 함께 있었다.
 * 그 호출은 문서화되지 않은 내부 엔드포인트를 OAuth 토큰으로 자동 조회하는 것이라 약관에
 * 걸려 걷어냈다(`claudeUsageService` 주석 참고). 그 자리를 대신하는 지금의 1차 원천은 **공식
 * CLI 의 `/usage` print 실행**(`claudeUsageProbe`)이라, 이 주기는 그 probe 를 도는 간격이기도
 * 하다 — 모델 호출이 0턴이라 과금이 없고(실측), 부르는 것은 공개 인터페이스(CLI)뿐이다.
 */
export const CLAUDE_USAGE_POLL_INTERVAL_MS = 5 * 60 * 1000;

/**
 * §4 — `claude -p "/usage"` probe 1회 타임아웃.
 *
 * 실측 2.3초(모델 호출 0턴)라 넉넉히 잡아도 안전하다. 값을 못 받으면 화면이 "실행 경로 문제"
 * 라고 말해야 하므로(`ClaudeUsageError.cli-unavailable`) 무한정 기다리지 않는다.
 */
export const CLAUDE_USAGE_PROBE_TIMEOUT_MS = 30_000;

/**
 * §4 v4.82 — 앱 안 Claude 로그인 설정.
 *
 * 상태 판정은 `claude auth status --json` 한 번 spawn(정상 응답 수백 ms). 폴링은 "밖에서
 * 로그아웃했는데 앱만 모르는" 구간을 없애기 위한 것이라 넉넉히 잡고, 로그인 팝업이 떠 있는
 * 동안에는 클라가 `LOGIN_POLL` 간격으로 직접 재조회한다(성공 판정의 1차 근거 — CLI 출력
 * 문구 파싱은 보조).
 */
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
 * Claude Code CLI 내장(built-in) 슬래시 명령 목록 — `/` 자동완성 드롭다운(§5.5 #17-2)이 읽는다.
 *
 * **출처는 Anthropic 공개 문서**(`https://code.claude.com/docs/en/commands`)의 명령 표다.
 * 종전에는 CLI 실행본을 latin1 로 읽어 minified 객체 리터럴을 정규식으로 뜯어냈는데(구 v3.19),
 * 그 방식은 Anthropic 소비자 약관 §3 이 금지하는 "역설계 … 사람이 판독 가능한 형태로 축소"에
 * 닿을 소지가 있어 공개 인터페이스로 옮겼다. 부수 효과로 **커버리지가 늘었다** — 스캔이
 * 놓치던 `/init` `/login` `/memory` `/code-review` `/verify` 등 사용자가 실제로 치는 명령이
 * 들어왔고(+29), 빠진 것은 대부분 문서에 없는 내부용(`/daemon` `/pro-trial-expired` 등)이다.
 *
 * **갱신 방법**: 위 문서의 표가 바뀌면 이 목록을 다시 뽑는다. CLI 업데이트만으로 자동
 * 추종하던 성질은 잃었으므로, 없는 명령을 사용자가 치면 CLI 가 그대로 거절한다(표시 전용
 * 목록이라 실행 경로는 불변 — 서버는 텍스트를 그대로 세션에 넘긴다).
 */
/**
 * §4 (슬래시 명령 가용성) — **헤드리스 세션에서는 실행되지 않는 내장 명령**.
 *
 * Vibisual 의 기본 실행 경로(`executionMode: 'headless'`)는 화면이 없다. 이 목록의 명령은 CLI 안에서
 * 대화형 패널을 여는 부류라, 헤드리스로 보내면 예외 없이 아래 한 줄만 돌아오고 턴이 끝난다:
 *   `"/<name> isn't available in this environment."`  (실측: `turns=0`, `cost=$0` — API 호출도 없다)
 *
 * 종전에는 이 사실을 화면이 전혀 말해 주지 않아, 사용자가 `/` 드롭다운에서 고른 명령이 왜 죽는지
 * 알 방법이 없었다(Fast 모드와 같은 뿌리 — 우리가 헤드리스라서 CLI 가 거절한다).
 *
 * **판정 근거는 공개 동작이다** — 그 명령을 한 번 쳐 보면 누구나 같은 답을 받는다. 목록이 낡아도
 * 위험하지 않다: 여기 없는데 실제로는 안 되는 명령은 종전처럼 CLI 가 직접 거절하고, 여기 있는데
 * 되는 명령은 배지 하나가 더 붙을 뿐 실행 경로는 손대지 않는다(§3.3 표시와 로직 분리).
 *
 * ⚠ `executionMode: 'interactive-terminal'`(CMD 버블)에서는 **전부 정상 동작한다** — 그쪽은 진짜
 * REPL 이다. 그래서 판정은 명령 이름만으로 하지 않고 `slashCommandNeedsTerminal` 이 실행 모드와 함께 본다.
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

/**
 * §4 (슬래시 명령 가용성) — 이 명령을 **지금 이 에이전트에서** 보내면 실제로 도는가.
 *
 * `interactiveTerminal` 이 true 면 그 버블은 진짜 REPL 이라 무엇이든 된다 — 이름만 보고 배지를 달면
 * CMD 버블에서 멀쩡히 되는 명령에 "안 된다"고 거짓말을 하게 된다.
 */
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


/**
 * 사용자 인터럽트 해소 판정 주기 (ms).
 * Claude Code 는 사용자 인터럽트(Esc/Ctrl+C)·도구 거부 시 Stop 훅을 발사하지 않는다(공식 명세).
 * 그 결과 Hook 에이전트 버블이 active(파란 링)로 stuck 되어 5분 idle sweep 전까지 안 풀린다.
 * 이 주기로 세션 JSONL 의 마지막 엔트리가 인터럽트 sentinel 인지 확인해, 누락된 Stop 훅을 대신
 * 시뮬레이트(→ completed)한다. idle sweep(30초)보다 촘촘히 돌려 인터럽트 직후 빠르게 해소.
 */
export const INTERRUPT_RECONCILE_INTERVAL_MS = 5_000;

/**
 * 좀비 `executing` 봉합 유예 (ms) — 이 시간이 지나도 살아 있는 일감이 하나도 없으면 끊긴 것으로 본다.
 *
 * 턴이 실제로 끝났는데 완료 신호가 유실되면 명령이 `executing` 에 굳고, 그 탭은 `busy` 로 잠겨
 * **새 명령을 영영 못 받는다**(앞 명령이 안 끝났으니 다음이 안 나간다). 종전에 이 굳음을 푸는 길은
 * 앱 재기동(restore reconcile)이나 사용자가 [중지]를 누르는 것뿐이었다 — 런타임 자동 회수가 없었다.
 *
 * 유예를 넉넉히 두는 이유: `dispatch → 자식 spawn` 사이에는 "아직 아무것도 안 도는" 짧은 창이 있고,
 * 그 창에서 걷어 내면 **정상 명령을 죽인다.** 과거에 자식 없는 실행 경로를 죽은 것으로 읽어 버블이
 * 완료↔동작을 되풀이한 사고가 있었으므로(2026-08-25), 오탐보다 늦게 걷는 쪽을 택한다.
 * 판정 자체도 자식 유무만 보지 않는다 — PTY 탭·백그라운드 작업·봉인 유예까지 전부 살아있음으로 친다
 * (`SubAgentManager.sealZombieExecutingCommands`).
 */
export const ZOMBIE_EXECUTING_GRACE_MS = 60_000;

/** 파일 존재 확인 주기 (ms) — 삭제된 파일 버블 자동 제거 */
export const FILE_EXISTENCE_CHECK_INTERVAL = 30_000;

/**
 * 파일 노드를 ghost(삭제 추정)로 전환하기 전 요구하는 연속 "존재 안 함" 관측 횟수.
 * 에디터 atomic-save(temp+rename)·git·빌드툴이 파일을 찰나 치우는 동안 1회 fs.existsSync
 * miss로 실재 파일이 소멸되던 버그 방지. 연속 miss가 이 값에 도달해야 진짜 삭제로 판정.
 * 1이면 디바운스 없음(레거시 동작).
 */
export const FILE_EXISTENCE_MISS_THRESHOLD = 2;

// ─── 레이아웃 ───

/** 에이전트 클러스터 (멀티 에이전트일 때 중앙 배치) */
export const AGENT_CLUSTER_BASE_RADIUS = 50;
export const AGENT_CLUSTER_RADIUS_PER_AGENT = 15;

/** 폴더 공전 궤도 */
export const ORBIT_BASE_RADIUS = 180;
export const ORBIT_RADIUS_PER_ITEM = 20;

/** 위성(파일) 궤도 간격 — 부모 원 둘레로부터의 갭 */
export const SATELLITE_ORBIT_GAP = 20;

/** 위성으로 허용되는 버블 타입 */
export const SATELLITE_TYPES: ReadonlySet<BubbleType> = new Set<BubbleType>(['file', 'bash', 'ghost', 'iframe']);

/**
 * **안에 들어갈 수 있는** 폴더 버블 타입 — 더블클릭하면 `children` 을 펼쳐 내부 뷰가 되는 것들.
 *
 * §9 폴더 스코프드 스냅샷이 "한 칸 앞"을 계산할 때 쓴다: 지금 그리는 폴더 안에서 사용자가
 * 다음에 누를 수 있는 것이 이 타입의 자식이므로, 그 자식들의 `children` 까지 미리 실어야
 * 드릴다운이 왕복 없이 즉시 열린다.
 *
 * `pipeline` 은 뺀다 — 내부를 `pipelineChildren` 이라는 **다른 슬라이스**로 그리므로 이 축과
 * 무관하다(여기 넣으면 쓰지도 않을 `children` 을 실어 나른다).
 */
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

/**
 * §3.2.1 v2.62 — 영속 파일(checkpoint.json / identity.json) 다세대 백업 보관 수.
 * 저장 직전 기존 파일을 `<file>.bak1 → .bak2 → ... → .bak<N>` 로 회전 보관한다.
 * 논리적 실수(빈/급감 저장)·사용자 실수를 N 세대 전까지 수동 복구 가능.
 */
export const CHECKPOINT_BACKUP_GENERATIONS = 3;

/**
 * §3.2.1 v3.29 — `~/.vibisual/app-state.json`(머신 단위 "열린 프로젝트 목록" SSOT) 다세대 백업 수.
 * app-state 는 "어떤 프로젝트 탭이 뜨는가"의 유일한 SSOT 인데도 과거엔 checkpoint 와 달리
 * fsync·백업·백업복구가 전무했다. 크래시로 이 파일이 truncate 되면 부팅 시 빈 목록 → 탭 0개 →
 * 이후 저장이 손상 파일을 영구 확정하는 손실 경로가 있었다. 같은 손실방지 인프라를 적용한다.
 */
export const APP_STATE_BACKUP_GENERATIONS = 3;

/**
 * §5.4 #14-4 — "닫은 탭 다시 열기" 스택에 남길 최대 건수(§3.2.3 축 E — 키 개수 캡).
 *
 * 보존 설정(`RetentionSettings`)으로 빼지 않는 이유: 저 축들이 지키는 것은 **잃으면 되살릴 수
 * 없는 기록**(편집 이력·타이핑한 명령 원문)이라 사용자가 상한을 쥐어야 하지만, 이 스택은 이미
 * 디스크에 그대로 있는 프로젝트를 가리키는 **되돌리기 손잡이**다. 25건이 넘어 밀려난 항목도
 * File → 폴더 열기로 언제든 다시 열 수 있어 잃는 것이 없다. 브라우저(Chrome 최근 닫은 항목)도
 * 같은 크기를 쓴다.
 */
export const MAX_RECENTLY_CLOSED_TABS = 25;

/**
 * §3.2.1-3 v2.63 — 명시 삭제 커스텀 에이전트 묘비(deletedCustomAgents) 최대 보관 수.
 * 묘비는 "이미 삭제된 sessionId 의 부활 차단" 신호. sessionId 가 전역 유니크(시간+카운터)라
 * 절대 재생성되지 않아 안전하게 prune 할 길이 없으므로, 단조 증가를 막는 상한만 둔다.
 * 한도 초과 시 가장 오래된 묘비부터 버린다(최근 삭제분이 부활 차단에 더 중요).
 */
export const DELETED_AGENT_TOMBSTONE_MAX = 1000;

/**
 * §3.2.1-3 v3.03 — checkpoint.json 빈/급감 덮어쓰기 거부 가드.
 * 크래시 후 재시작 시 빈 인스턴스가 멀쩡한 checkpoint 를 빈 그래프로 덮어쓰는 손실을 막는다.
 * 판정은 `graph.agents + graph.nodes` 합계 기준.
 *
 * - `EMPTY_GUARD_MIN_PRIOR`: 디스크 직전 합계가 이 값 이상이면 "통째-0 저장"을 거부 대상으로 본다(1=무엇이든 있었으면).
 * - `SHRINK_GUARD_MIN_PRIOR` / `SHRINK_GUARD_RATIO`: 급감 비율 가드(2차) — 직전 합계가 MIN_PRIOR 이상인데
 *   새 합계가 `직전 * RATIO` 미만이고 묘비로 설명 안 되는 에이전트 소멸이 있을 때 거부. 정상 대량 만료
 *   오탐 위험이 있어 **기본 비활성**(`CHECKPOINT_SHRINK_GUARD_ENABLED=false`); 통째-0 가드만 1차 운용.
 *
 * ⚠ 직전 합계에서 **프로젝트 루트 노드는 빼고** 센다(`ROOT_NODE_KEY_PREFIX`). 루트 노드는 프로젝트를
 *   등록하면 자동 생성되는 골격이라 "지켜야 할 사용자 데이터" 가 아니고, 워크트리처럼 화면 표현이
 *   부모 캔버스로 옮겨간 프로젝트는 정상적으로 0개가 되기 때문. 이 예외가 없으면 "루트 노드 하나뿐인
 *   디스크 vs 비어 있는 정상 인스턴스" 가 매 저장마다 거부되고, 거부되면 디스크도 캐시도 갱신되지
 *   않아 같은 판정이 영원히 반복된다(가드가 자기를 발화시키는 파일을 스스로 보존하는 고착 상태).
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
//
// §4 v2.38 — `MODEL_PRICING` 정적 테이블은 시드(폴백)로 격하. 런타임 SSOT 는 `ModelRegistry`.
// 콜사이트는 `getModelPricing(modelId, registry?)` 헬퍼 통일.

/**
 * 단가 한 벌 만들기 — **캐시 두 값은 기본 입력가에서 파생한다**(손으로 옮겨 적지 않는다).
 *
 * Anthropic 공개 가격표의 배수: 5분 캐시 쓰기 = 입력가 × 1.25, 캐시 읽기 = 입력가 × 0.1.
 * 예외가 하나 있어 `cacheReadMultiplier` 를 열어 둔다 — **Fable 5.1 / Mythos 5.1 만 캐시 읽기가 0.025×** 다
 * (가격표 각주: "All other models use the standard 0.1x multiplier").
 * 부동소수 꼬리(3 × 0.1 = 0.30000000000000004)는 6자리에서 끊는다.
 */
function makePricing(input: number, output: number, cacheReadMultiplier = 0.1): ModelPricing {
  const round = (v: number): number => Math.round(v * 1e6) / 1e6;
  return {
    input,
    output,
    cacheRead: round(input * cacheReadMultiplier),
    cacheWrite: round(input * 1.25),
  };
}

/**
 * 풀ID → 가격 **시드**.
 *
 * v2.40 이 이 테이블을 비운 근거는 "패밀리 내 minor 버전은 가격이 같다"는 관찰이었는데, 그 관찰은
 * 깨졌다 — 같은 sonnet 안에서 **Sonnet 5 는 $2/$10, Sonnet 4.6 은 $3/$15** 다. 패밀리 하나에 한 값만
 * 두면 둘 중 하나는 반드시 틀리므로, **아는 풀ID 는 여기 정확히 적는다**(컨텍스트 시드와 같은 규율).
 *
 * 출처는 Anthropic 공개 가격표(`platform.claude.com/docs/en/about-claude/pricing`) 의 Model pricing 표.
 * 확인 2026-09-02. 은퇴 모델(Opus 4.1 등)도 남겨 둔다 — 드롭다운에는 없지만 **지난 세션의 JSONL 에**
 * 그 ID 가 남아 있어 `getModelPricing(view.lastModel)` 이 그대로 조회하기 때문이다.
 *
 * 해소 순서는 `getModelPricing` — (1) 레지스트리 entry.pricing → (2) 이 시드 → (3) 패밀리 디폴트 → (4) `DEFAULT_PRICING`.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-fable-5-1': makePricing(10, 50, 0.025),
  'claude-fable-5': makePricing(10, 50),
  'claude-opus-5': makePricing(5, 25),
  'claude-opus-4-8': makePricing(5, 25),
  'claude-opus-4-7': makePricing(5, 25),
  'claude-opus-4-6': makePricing(5, 25),
  'claude-opus-4-5': makePricing(5, 25),
  'claude-opus-4-1': makePricing(15, 75),
  'claude-opus-4-0': makePricing(15, 75),
  'claude-sonnet-5': makePricing(2, 10),
  'claude-sonnet-4-6': makePricing(3, 15),
  'claude-sonnet-4-5': makePricing(3, 15),
  'claude-sonnet-4-0': makePricing(3, 15),
  'claude-haiku-4-5': makePricing(1, 5),
};

/**
 * 알 수 없는 모델 최종 폴백 — 패밀리 추론까지 실패할 때만.
 *
 * **현행 최고가 티어**(Fable = $10/$50)로 둔다. 종전 값 $15/$75 는 은퇴한 Opus 4.1 의 단가라
 * 지금은 **어떤 현행 모델보다도 비싸서**, 모르는 모델의 비용을 최소 1.5배 부풀렸다.
 * 캐시 읽기는 보수적으로 표준 0.1× 를 쓴다(0.025× 는 Fable 5.1 계열 전용 할인이라 폴백에 쓰면 과소계상).
 */
export const DEFAULT_PRICING: ModelPricing = makePricing(10, 50);

/**
 * §4 v2.38 — 패밀리별 디폴트(**처음 보는 풀ID** 폴백).
 * Anthropic `/v1/models` 는 신규 풀ID·컨텍스트는 주지만 **가격은 주지 않으므로**, 시드에도 없는 ID 는
 * 그 패밀리의 **현재 latest** 단가로 추정한다(처음 보는 ID 는 새로 나온 것일 확률이 높다).
 *
 * §4 v2.77 — `Record<KnownModelFamily,…>` 로 좁힘.
 * (판올림 번호 발급 대기) — fable/mythos 를 실제로 채운다. 종전에는 이 둘이 표에 없어 `isKnownFamily` 가
 * 걸러내고 `DEFAULT_*` 로 떨어졌는데, 그 폴백이 $15/$75 · 200K 라 **Fable 에이전트의 비용이 1.5배 과대,
 * 컨텍스트가 5배 과소**로 나왔다(문맥 게이지가 실제 20% 지점에서 100% 로 보임).
 */
export const MODEL_FAMILY_DEFAULTS: Record<KnownModelFamily, { contextWindow: number; pricing: ModelPricing }> = {
  fable:  { contextWindow: 1_000_000, pricing: makePricing(10, 50, 0.025) },
  mythos: { contextWindow: 1_000_000, pricing: makePricing(10, 50, 0.025) },
  opus:   { contextWindow: 1_000_000, pricing: makePricing(5, 25) },
  sonnet: { contextWindow: 1_000_000, pricing: makePricing(2, 10) },
  haiku:  { contextWindow:   200_000, pricing: makePricing(1, 5) },
};

/**
 * §4 v2.77 — `MODEL_FAMILY_DEFAULTS` 키(=디폴트 테이블 보유 패밀리)인지 판정.
 * **표에서 직접 읽는다** — 손으로 적은 `===` 목록은 표에 패밀리를 추가할 때 같이 고치는 것을 잊으면
 * 조용히 어긋난다(fable 이 표에 없어서가 아니라 이 목록에 없어서 폴백되는 사고가 실제로 있었다).
 */
export function isKnownFamily(family: string | undefined | null): family is KnownModelFamily {
  return !!family && Object.prototype.hasOwnProperty.call(MODEL_FAMILY_DEFAULTS, family);
}

/**
 * §4 v2.38 — 풀ID prefix 에서 패밀리 추론.
 * 예: `claude-opus-4-8` → `'opus'`, `claude-sonnet-4-6` → `'sonnet'`, `claude-fable-5` → `'fable'`.
 *
 * §4 v2.77 — opus/sonnet/haiku 화이트리스트 제거. `claude-<family>-<digit>…` 형태의 임의 패밀리를 수용한다
 * (family 뒤에 숫자가 와야 진짜 버전ID — `claude-code-…` 류 비모델 문자열 회피). 매칭 실패 시 undefined.
 */
export function parseFamilyFromFullId(id: string | undefined | null): ModelFamily | undefined {
  if (!id) return undefined;
  const m = /^claude-([a-z]+)-\d/.exec(id);
  return m?.[1] as ModelFamily | undefined;
}

/**
 * §4 v2.77 — 풀ID 의 (major, minor) 추출. minor 가 없으면 0.
 * `claude-opus-4-8` → [4,8], `claude-fable-5` → [5,0]. 임의 패밀리 수용.
 * 패밀리 내 latest 선정·버전 sub-드롭다운 정렬의 공통 SSOT (클라/서버 정규식 드리프트 방지).
 */
export function parseModelSemver(id: string): [number, number] {
  const m = /^claude-[a-z]+-(\d+)(?:-(\d{1,2}))?$/.exec(id);
  if (!m) return [0, 0];
  return [Number(m[1]), m[2] ? Number(m[2]) : 0];
}

/**
 * §4 v2.38 — 풀ID → 가격. 우선순위:
 * (1) registry 에 entry.pricing 정의 → 그대로
 * (2) 시드 `MODEL_PRICING[id]` → 그대로
 * (3) 패밀리 추론 → `MODEL_FAMILY_DEFAULTS[family].pricing`
 * (4) `DEFAULT_PRICING`
 *
 * registry 가 없으면 (1) 건너뛰고 (2)~(4) 만 평가 — 클라/서버 어느 쪽에서도 호출 가능.
 */
export function getModelPricing(modelId: string | undefined | null, registry?: ModelRegistry | null): ModelPricing {
  return resolveModelPricing(modelId, registry).pricing;
}

/**
 * §4 — **조회용 정규화.** Anthropic 은 같은 모델을 두 모양으로 부른다: 별칭형 `claude-haiku-4-5` 와
 * 날짜형 `claude-haiku-4-5-20251001`. 트랜스크립트에는 **날짜형이 그대로** 남는다(실측 2026-09-02:
 * 로컬 대화록 135,150 턴 중 1,225 턴이 날짜형 haiku, 캐시읽기만 10.2M 토큰).
 *
 * 표는 별칭형 한 벌만 들고 있으므로 날짜형은 시드를 **빗나가 패밀리 디폴트로 떨어진다.** haiku 는
 * 우연히 값이 같아 티가 안 났지만 `claude-opus-4-5-<날짜>` 였다면 컨텍스트가 200K 대신 1M(5배)로
 * 잡혔다 — 직전 라운드에 fable 에서 고친 것과 **같은 종류의 사고**다.
 *
 * 꼬리의 `[1m]` 같은 변형 표기도 함께 뗀다(`claude-opus-5[1m]` → `claude-opus-5`).
 * 여기까지 접고도 못 찾으면 그때가 **정말 모르는 모델**이고, 그 자리가 "추정" 표식이 뜨는 자리다.
 */
export function normalizeModelId(id: string): string {
  return id.replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '');
}

/**
 * §4 — 단가가 **어디서 왔나**. 화면의 "추정" 표식과 `scripts/model-table-check.mjs` 가 같은 판정을 쓴다.
 *
 * - `registry` / `seed` = 그 모델의 값을 **우리가 안다**(공개 가격표에서 옮겨 둔 값).
 * - `family` / `default` = **모르는 모델**이라 폴백으로 환산했다 — 자릿수가 틀릴 수 있다.
 */
export type ModelPricingSource = 'registry' | 'seed' | 'family' | 'default';

/**
 * 단가 + 그 출처. `getModelPricing` 은 이것의 얇은 껍데기다 — 해소 순서를 **한 벌만** 두기 위해서다
 * (두 벌이면 한쪽만 고쳐 놓고 못 알아채는 드리프트가 생긴다. `isKnownFamily` 가 그렇게 어긋나
 *  fable 이 통째로 폴백을 탔다).
 *
 * 순서: (1) 레지스트리 entry.pricing → (2) 시드 `MODEL_PRICING` → (3) 패밀리 디폴트 → (4) `DEFAULT_PRICING`.
 * (1)(2) 는 **정규화한 ID 로도** 한 번 더 찾는다.
 */
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
  // §4 v2.77 — known 패밀리만 디폴트 테이블 보유. 미지 패밀리는 보수적 폴백.
  if (isKnownFamily(family)) return { pricing: MODEL_FAMILY_DEFAULTS[family].pricing, source: 'family' };
  return { pricing: DEFAULT_PRICING, source: 'default' };
}

/**
 * 이 모델의 금액을 **"추정"으로 표시해야 하는가** — 폴백으로 환산했으면 true.
 *
 * 모델 이름 자체가 없는 턴도 추정이다. 그때 `DEFAULT_PRICING`(현행 최상위 티어)으로 환산하는데,
 * 아무 표식 없이 그리면 그 숫자를 사실로 읽게 된다.
 */
export function isPricingEstimated(modelId: string | undefined | null, registry?: ModelRegistry | null): boolean {
  const source = resolveModelPricing(modelId, registry).source;
  return source === 'family' || source === 'default';
}

/**
 * §4 v2.38 — 풀ID → 컨텍스트 한도(토큰). 우선순위는 `getModelPricing` 과 동일 구조.
 */
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
  // §4 v2.77 — known 패밀리만 디폴트 테이블 보유. 미지 패밀리는 보수적 폴백.
  if (isKnownFamily(family)) return { contextWindow: MODEL_FAMILY_DEFAULTS[family].contextWindow, source: 'family' };
  return { contextWindow: DEFAULT_CONTEXT_LIMIT, source: 'default' };
}

/**
 * §4 v2.40 — alias(`'opus'`/`'sonnet'`/`'haiku'`) → 현재 latest 풀ID.
 *
 * 레지스트리 entry 의 `isLatestOfFamily=true` 만 사용. 시드 폴백 ❌ — 코드 측 alias 해소를 폐기했으므로
 * 레지스트리가 비어 있으면 그냥 undefined 반환. 호출 측은 alias 그대로 CLI 에 넘김(CLI 가 latest 해소).
 *
 * 이 함수의 의미가 UI 라벨용("Latest = X" 표시) 으로 좁혀짐 — 실제 CLI 인자 빌드엔 사용 ❌.
 */
export function resolveAliasToLatest(alias: string | undefined | null, registry?: ModelRegistry | null): string | undefined {
  if (!alias) return undefined;
  // §4 v2.77 — opus/sonnet/haiku 가드 제거. 레지스트리에 그 패밀리(alias)의 latest entry 가 있으면 해소.
  // 미지 패밀리도 CLI-scan/`/v1/models` 가 발견했으면 자동 동작. 없으면 undefined → UI 는 "Latest" 만 표시.
  return registry?.entries.find((e) => e.family === alias && e.isLatestOfFamily)?.id;
}

/** 토큰 수 → 비용($) 계산 — v2.38: registry 우선 가격 조회. */
export function calculateTokenCost(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreateTokens: number,
  model?: string,
  registry?: ModelRegistry | null,
): { total: number; input: number; output: number; cacheRead: number; cacheWrite: number } {
  const p: ModelPricing = getModelPricing(model, registry);
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
 * 버전 sub-드롭다운을 채우는 풀ID 시드.
 *
 * **출처는 Anthropic 공개 문서** — 현행 4종은 모델 개요표(`docs.claude.com/en/docs/about-claude/
 * models/overview`)의 "Claude API ID / alias" 행, 이전 세대는 Claude Code 모델 설정 문서
 * (`code.claude.com/docs/en/model-config`)가 `availableModels`·`/model` 값으로 문서화한 것들이다.
 *
 * 내력: v2.40 이 정적 시드를 비웠고(빈 배열), v2.41 이 그 자리를 **CLI 실행본 raw scan** 으로
 * 메웠다. 그 스캔은 Anthropic 소비자 약관 §3 의 역설계 금지에 닿을 소지가 있어 걷어냈는데,
 * 시드가 비어 있으면 **패밀리 목록과 버전 드롭다운이 통째로 빈다**(`ANTHROPIC_API_KEY` 를 둔
 * 사용자만 `/v1/models` 로 채워졌다). 그래서 공개 문서를 출처로 시드를 되살린다.
 *
 * `ANTHROPIC_API_KEY` 가 있으면 `/v1/models`(공식 API)가 이 시드를 덮어써 최신을 따라간다.
 * 없으면 여기가 목록의 전부이므로, 새 모델이 나오면 이 배열을 갱신한다.
 * 날짜 붙은 변형(`…-20251001`)은 UI 노이즈라 넣지 않는다(구 cli-scan 의 필터와 같은 기준).
 *
 * **이 배열은 alias 해소에도 쓰인다** — CLI 가 bare alias 로 모르는 패밀리(fable 등)는
 * `subAgentManager` 가 여기서 나온 latest 풀ID 로 치환해서 넘긴다. 그래서 한 세대 뒤처지면
 * "최신을 골랐는데 구모델이 뜨는" 조용한 오작동이 된다 — 실제로 `claude-fable-5-1` 이 나온 뒤에도
 * 이 배열에 `claude-fable-5` 만 있어서 `fable` 이 구 5.0 으로 해소되고 있었다(2026-09-02 확인).
 */
export const AVAILABLE_AGENT_MODEL_FULL_IDS: readonly string[] = [
  'claude-fable-5-1',
  'claude-fable-5',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-4-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
];

/**
 * §4 v2.38 — 시드 풀ID 들을 `ModelRegistryEntry[]` 형태로 빌드.
 * 서버 `ModelRegistryService` 가 부팅 시 첫 번째로 적재.
 */
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

/**
 * §4 v1.53 — alias 와 풀ID 합집합. CLI `--model` 가드용.
 *
 * v2.38 주의 — 이 정적 합집합은 시드 한정. 서버 `subAgentManager.buildConfigArgs` 는 런타임 레지스트리
 * (`modelRegistryService.getRegistry().entries`) 를 우선 조회하고 시드는 폴백.
 */
export const AVAILABLE_AGENT_MODEL_IDS: readonly string[] = [
  ...AVAILABLE_AGENT_MODELS,
  ...AVAILABLE_AGENT_MODEL_FULL_IDS,
];

/** §4 v1.53 — 모델 ID(alias 또는 풀ID)가 Opus 패밀리인지 판정. 1M 토글 노출/적용 가드용. */
export function isOpusModel(modelId: string | undefined | null): boolean {
  if (!modelId) return false;
  if (modelId === 'opus') return true;
  return /^claude-opus-/.test(modelId);
}

/**
 * §4 (스트림 3종 ①) — 중첩 서브에이전트 텍스트 전달이 켜져 있는가.
 *
 * **기본이 켬**이라 판정이 단순 truthy 가 아니다 — `undefined`(한 번도 안 만짐)와 `true` 는 켬,
 * 명시 `false` 만 끔이다. 서버 인자 조립과 클라 체크박스가 **같은 함수**를 봐야 화면과 실제가
 * 어긋나지 않는다(§5.5 컨텍스트 주입원 통제에서 배운 규율).
 */
export function isForwardSubagentTextEnabled(value: boolean | undefined): boolean {
  return value !== false;
}

/**
 * §4 (Thinking on/off) — 이 에이전트의 확장 사고가 켜져 있는가.
 *
 * `isForwardSubagentTextEnabled` 와 **같은 규율**이다 — `undefined`(한 번도 안 만짐)와 `true` 는 켬,
 * 명시 `false` 만 끔. 설치본 설정 스키마의 `alwaysThinkingEnabled`("absent or true → enabled")를
 * 그대로 옮긴 것이라, 우리 판정과 CLI 판정이 어긋나지 않는다. 서버의 설정 파일 조립과 클라
 * 체크박스가 이 함수 하나를 봐야 화면과 실제가 갈라지지 않는다.
 */
export function isThinkingEnabled(value: boolean | undefined): boolean {
  return value !== false;
}

/**
 * §4 (Fast 모드) — 이 모델에서 Fast 모드가 실제로 켜지는가.
 *
 * 설치된 CLI 의 판정을 그대로 옮긴 것이다 — CLI 는 모델 capability 에 `fast_mode` 가 있거나
 * 모델 ID 에 `opus-4-8`/`opus-5` 가 들어 있을 때만 Fast 를 허용하고, **그 밖에서는 사유 문자열도
 * 없이 조용히 `off` 로 떨어뜨린다**(sonnet·haiku 실측). 우리 레지스트리에는 capability 필드가
 * 없으므로 이름 규칙만 옮기고, 최종 판정권은 CLI 에 둔다.
 *
 * bare alias `'opus'` 는 CLI 가 현재 latest Opus 로 해소하므로 true(실측: `claude-opus-5` → on).
 * 풀ID 를 핀했다면 그 ID 로 판정하므로 `claude-opus-4-7` 같은 옛 판은 false 가 된다.
 * `[1m]` 변형은 접미사일 뿐이라 `claude-opus-5[1m]` 도 그대로 true(실측 확인).
 */
export function supportsFastMode(modelId: string | undefined | null): boolean {
  if (!modelId) return false;
  const id = modelId.toLowerCase();
  if (id === 'opus') return true;
  return id.includes('opus-4-8') || id.includes('opus-5');
}

/**
 * JSONL model ID → AgentConfig.model 패밀리 추출.
 * 예: `claude-opus-4-6` → `opus`, `claude-sonnet-4-5-20250414` → `sonnet`, `claude-fable-5` → `fable`.
 *
 * §4 v2.77 — `AVAILABLE_AGENT_MODELS`(3종) 화이트리스트 제거. `claude-<family>-<digit>…` 형태의
 * 임의 패밀리를 그대로 반환(라이브 세션 모델명이 신규 패밀리여도 버블에 정상 표기). 매칭 실패 시 undefined.
 */
export function parseModelFamily(modelId: string | undefined | null): string | undefined {
  return parseFamilyFromFullId(modelId);
}

/**
 * §4 v2.77 — UI Model 드롭다운에 노출할 패밀리 목록.
 * 레지스트리(CLI-scan/`/v1/models`)에서 발견된 모든 패밀리 ∪ 기본 alias 3종.
 * 정렬: 기본 3종(opus/sonnet/haiku 순) 먼저, 그 외 신규 패밀리는 알파벳순.
 * 레지스트리가 비어도 기본 3종은 항상 포함 → 신규 모델 미발견 시에도 기존 UX 보존.
 */
export function listModelFamilies(registry?: ModelRegistry | null): string[] {
  const found = new Set<string>(AVAILABLE_AGENT_MODELS);
  for (const e of registry?.entries ?? []) {
    if (e.family) found.add(e.family);
  }
  const known = AVAILABLE_AGENT_MODELS.filter((f) => found.has(f));
  const extra = [...found].filter((f) => !AVAILABLE_AGENT_MODELS.includes(f)).sort();
  return [...known, ...extra];
}

/**
 * §4 (CLI 사양 추종) — 공식 도구 표(`code.claude.com/docs/en/tools-reference`, 2.1.251) 그대로 45종.
 *
 * `AVAILABLE_AGENT_TOOLS` 가 이 표를 **전부 담고 있는지** 회귀로 고정하기 위한 대조본이다.
 * 목록에 넣는 것을 잊으면 그 도구는 우리 에이전트에게 존재하지 않게 되는데, 화면·타입·저장은
 * 전부 멀쩡해서 어느 검사에도 걸리지 않는다 — 그래서 대조본을 따로 둔다.
 */
export const CLI_BUILTIN_TOOLS: readonly string[] = [
  'Agent', 'Artifact', 'AskUserQuestion', 'Bash', 'CronCreate', 'CronDelete', 'CronList',
  'Edit', 'EndConversation', 'EnterPlanMode', 'EnterWorktree', 'ExitPlanMode', 'ExitWorktree',
  'Glob', 'Grep', 'ListAgents', 'ListMcpResourcesTool', 'LSP', 'Monitor', 'NotebookEdit',
  'PowerShell', 'PushNotification', 'Read', 'ReadMcpResourceTool', 'RemoteTrigger',
  'ReportFindings', 'ScheduleWakeup', 'SendFeedback', 'SendMessage', 'SendUserFile',
  'ShareOnboardingGuide', 'Skill', 'TaskCreate', 'TaskGet', 'TaskList', 'TaskOutput',
  'TaskStop', 'TaskUpdate', 'TodoWrite', 'ToolSearch', 'WaitForMcpServers', 'WebFetch',
  'WebSearch', 'Workflow', 'Write',
];

/**
 * §4 (CLI 사양 추종) — **공식 도구 표에서 사라졌지만 우리가 계속 실어 보내는 이름.**
 *
 * `BashOutput`·`KillShell` 은 백그라운드 Bash 의 결과 회수·종료였고 지금은 `Bash`(백그라운드 실행)
 * + `Monitor` + `TaskOutput`/`TaskStop` 으로 갈렸다. `MultiEdit` 은 `Edit` 에 흡수됐다.
 * 셋 다 2.1.251 공식 표에도 설정 스키마에도 없다.
 *
 * **그래도 지우지 않는다** — CLI 는 모르는 도구 이름을 인자 파싱 단계에서 거부하지 않으므로
 * (실측: `--tools NotAToolXyz` 가 플래그 오류를 내지 않는다) 남겨서 잃는 것이 없고, 반대로 이
 * 이름들이 아직 살아 있는 별칭이라면 지우는 순간 그 능력을 조용히 뺏는다. 문서에서 사라진 사실만
 * 여기 적어 두고, 실제로 제거된 것이 확인되면 그때 이 배열만 비우면 된다.
 */
export const LEGACY_AGENT_TOOLS: readonly string[] = ['BashOutput', 'KillShell', 'MultiEdit'];

/**
 * §4 (CLI 사양 추종) 규약 (3) — **선택 가능한 내장 도구 목록.**
 *
 * `buildConfigArgs` 가 `--tools` 를 **항상 명시**하므로 이 목록에 없는 내장 도구는 그 에이전트에게
 * **존재하지 않는다.** 즉 이 배열은 UI 체크박스 목록이기 전에 **에이전트가 가질 수 있는 능력의 상한**이다.
 *
 * 종전에는 22종만 올라 있어 **공식 표 45종 중 26종이 우리 에이전트에게 아예 없었다** — IDE 를
 * 표방하면서 코드 인텔리전스(`LSP`)가 없었고, 목표 창을 REST 로 흉내 내면서 정작 그 원본인 작업
 * 도구(`Task*`)가 없었으며, 윈도우가 주력인데 네이티브 셸(`PowerShell`)이 없었다.
 *
 * ⚠ 새 도구를 넣을 때는 `BACKFILL_AGENT_TOOLS` 에도 넣어라 — 판올림 전에 만들어진 에이전트는
 *   "사용자가 끈 것"이 아니라 "화면에 존재한 적이 없어서" 빠진 상태라 복원 1회 백필이 필요하다.
 */
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
  //   `Workflow` 는 서브에이전트를 스크립트로 대량 지휘하는 축이라 캔버스 모델과 정면으로 맞는다.
  //   `ListAgents` 는 세션 간 발견(§5.12 Command Center 와 같은 갈래).
  'Agent', 'Workflow', 'ListAgents', 'SendMessage', 'TaskOutput', 'TaskStop',
  // ── 작업(Task) 장부 ──
  //   `TaskCreated`/`TaskCompleted` 훅이 발화하는 바로 그 도구들이다(§3.6). 이게 없으면 훅을
  //   등록해도 영영 한 건도 오지 않는다 — 목표 창(§5.5 #17-17)과 한 쌍으로 다룬다.
  'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'TodoWrite',
  // ── 모드·워크트리 ──
  //   종전에는 나가는 쪽(`ExitPlanMode`)만 있고 들어가는 쪽이 없었다. 워크트리도 마찬가지로,
  //   `isolation: 'worktree'` 는 스폰 시점에만 정해지고 세션 도중에는 손댈 수단이 없었다.
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
 * §5.5 #17-17 ⑨ v4.59 — 옛 설정에 없던 도구 중 "사용자가 끈 것이 아니라 화면에 존재한 적이
 * 없어서" 빠진 항목. 체크포인트 복원 시 1회 백필해 판올림 전에 만든 에이전트도 계획을 세울 수
 * 있게 한다. 복원 경로에서만 채우므로 사용자가 이후 직접 해제한 선택은 되살아나지 않는다.
 *
 * §4 (CLI 사양 추종) — 공식 표 45종을 통째로 받은 뒤로는 **`AVAILABLE_AGENT_TOOLS` 전체**가
 * 백필 대상이다. 항목을 손으로 다시 나열하면 새 도구를 넣을 때마다 여기를 잊게 되고, 그러면
 * 판올림 전에 만든 에이전트만 영영 그 도구를 못 갖는다(화면·타입·저장은 멀쩡해 아무 데도 안 걸린다).
 */
export const BACKFILL_AGENT_TOOLS: readonly string[] = [...AVAILABLE_AGENT_TOOLS];

/**
 * §4 (CLI 사양 추종) — **백필 세대.** 이 숫자보다 낮은(또는 없는) 설정에만 백필이 한 번 돈다.
 *
 * 종전 백필은 세대 표식이 없어 **복원·병합 때마다** 돌았다. 목록이 `TodoWrite` 하나뿐일 때는
 * 티가 안 났지만 실제로는 그때도 "사용자가 끈 도구가 재시작마다 되살아나는" 동작이었고, 목록이
 * 공식 표 45종으로 커지는 순간 그것이 **모든 해제 선택을 매번 되돌리는** 동작이 된다.
 * 세대 표식을 두면 "화면에 존재한 적 없어서 빠진 것"은 한 번 채우고, 그 뒤의 해제는 사용자 뜻으로 남는다.
 *
 * 새 도구를 `AVAILABLE_AGENT_TOOLS` 에 넣을 때 이 숫자를 **1 올려라** — 안 올리면 이미 백필을
 * 받은 설정(= 지금 쓰는 거의 모든 에이전트)은 새 도구를 영영 못 갖는다.
 *
 * - 세대 1 — v4.59 `TodoWrite` 외 (세대 표식이 없던 시절. 표식 없는 설정 = 세대 0 취급)
 * - 세대 2 — 공식 도구 표 45종 전체 수용
 */
export const AGENT_TOOLS_BACKFILL_GEN = 2;

/**
 * §4 (설정 3층) — 도구 목록에 **세대 도장이 찍히기 전 한 번만** 새 내장 도구를 채운다.
 *
 * 받는 것이 `Partial<AgentConfig>` 인 이유는 대상이 셋이기 때문이다 — 에이전트 오버라이드,
 * 옛 저장분의 전체 설정, 그리고 **설정 창의 전역 프리셋**(`UserDefaults.agentConfig`).
 * 종전에는 전역 프리셋만 이 백필을 못 받았고, 그 목록이 신규 에이전트의 씨앗이라
 * **판올림 전에 정해 둔 목록이 앞으로 만들 모든 에이전트의 상한**이 됐다(실측 11/48).
 * 게다가 씨앗을 받은 에이전트에는 `DEFAULT_AGENT_CONFIG` 의 현행 세대 도장이 함께 찍혀
 * 백필이 "이미 돌았다"고 판단하므로, 그 누락은 어느 복원에서도 회복되지 않았다.
 *
 * `tools` 가 없는 설정은 **그대로 돌려준다** — 목록을 갖지 않은 것은 "고르지 않았다"이지
 * "비워 뒀다"가 아니며, 여기서 채우면 위층을 따르던 설정이 자기 목록을 갖게 된다.
 */
export function backfillAgentTools<T extends Partial<AgentConfig>>(config: T): T {
  if (!Array.isArray(config.tools)) return config;
  if ((config.toolsBackfillGen ?? 0) >= AGENT_TOOLS_BACKFILL_GEN) return config;
  const missing = BACKFILL_AGENT_TOOLS.filter((t) => !config.tools!.includes(t));
  // 채울 게 없어도 도장은 찍는다 — 안 그러면 다음 복원에서 또 판정하러 들어온다.
  return { ...config, tools: [...config.tools, ...missing], toolsBackfillGen: AGENT_TOOLS_BACKFILL_GEN };
}

/** §5.3 #12-2 v2.26 — AskUserQuestion 요청 타임아웃 (60s, permissionBroker 와 동일 윈도우) */
export const ASK_USER_QUESTION_TIMEOUT_MS = 60_000;

/** §4 v2.43 — 옵션창 Version 탭: 설치본 하나당 `--version` probe 타임아웃 (정상 응답 수십 ms) */
export const CLAUDE_VERSION_PROBE_TIMEOUT_MS = 2_500;

/** §4 v2.43 — 옵션창 Version 탭: 다중 설치본 스캔 시 probe 할 최대 후보 수 (폭주 가드) */
export const CLAUDE_INSTALL_SCAN_MAX = 24;

// ─── 첫 실행 설치 온보딩 (§4) ───
//
// 앱만 내려받은 사람에게 `claude` CLI 를 깔아 주는 경로. 명령은 **공식 네이티브 인스톨러**다
// (Node 불필요 — npm 경로는 Node/npm 이 이미 있는 사람 전용이라 신규 사용자에게 통하지 않는다).
// 출처: https://code.claude.com/docs/en/setup

/**
 * Windows 네이티브 설치 명령. `irm | iex` 는 PowerShell 문법이라 PowerShell 을 명시 호출한다.
 * `-NoProfile` = 사용자 프로필 스크립트가 설치를 방해하지 않게, `-ExecutionPolicy Bypass` =
 * 기본 정책(RemoteSigned)에서 원격 스크립트가 막히는 것을 피한다(레지스트리 정책은 안 건드림).
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

/**
 * 설치가 끝난 뒤 게이트가 "준비 완료" 를 보여주고 스스로 닫히기까지의 시간.
 *
 * 게이트를 **보고 있던 사람**에게만 확인을 남기기 위한 값이라 짧다 — 이 시간이 지나면 게이트는
 * 닫히고 다음 단계(로그인)로 넘어간다. 사용자가 [계속]을 누르면 기다리지 않고 즉시 넘어간다.
 */
export const CLAUDE_SETUP_READY_HOLD_MS = 1_600;

/**
 * §4 (Claude Code CLI 자동 업데이트) — 앱을 켠 뒤 CLI 최신화를 시도하기까지의 지연.
 *
 * 설치 판정(1.2s)·로그인 판정(1.5s)보다 **뒤**여야 한다: 아직 안 깔린 사람은 설치 온보딩이
 * 먼저 맡아야 하고, 갓 설치한 실행본은 이미 최신이라 곧바로 갱신을 시도할 이유가 없다.
 * 부팅 직후 몰리는 작업(체크포인트 복원·훅 설치)과도 겹치지 않게 넉넉히 뒤로 민다.
 */
export const CLAUDE_AUTO_UPDATE_BOOT_DELAY_MS = 20_000;

/**
 * §3.6 (판올림 번호 발급 대기) — 부팅 후 **훅 전송 경로(HTTP 승격)** 를 다시 판정하기까지의 지연.
 *
 * 설치 판정(1.2s)보다 뒤여야 갓 설치된 실행본의 판올림이 잡힌다. 자동 업데이트(20s)보다는
 * **앞**이다 — 지금 깔려 있는 판올림으로 먼저 승격해 두고, 업데이트가 끝나면
 * `onClaudeInstallSettled` 가 한 번 더 판정한다(인스톨러가 idempotent 라 헛일이 아니다).
 */
export const HOOK_TRANSPORT_REFRESH_DELAY_MS = 4_000;
/** v1.36 — STRICT delegation enforcement 경로(dispatch curl)가 Bash 에 의존하므로
 *  사용자가 UI 에서 제거할 수 없고, STRICT strip 계산에서도 항상 보존된다.
 *  서버 PUT /api/agent-config/:id 가 payload.tools 에서 빠져 있으면 자동 포함, UI 는 × 잠금. */
export const LOCKED_AGENT_TOOLS: readonly string[] = ['Bash'];

/**
 * 선택 가능한 퍼미션 모드 — 설치된 CLI 내부 enum 과 같은 6종(§4 CLI 사양 추종).
 *
 * `'default'` 는 **우리 저장값**이고 표시명은 **Manual** 이다(마이그레이션 ❌ — 옛 체크포인트가
 * 그대로 읽힌다). `'auto'`/`'dontAsk'` 는 CLI 2.1.223 에서 열린 값이며 판정 의미는 CLI 실측 기준으로
 * `auto → classify`(모델 분류기) · `dontAsk → deny`(사전 승인 없으면 거부).
 * 서버 승인 게이트(`/api/permission-check`)의 매핑은 §5.3 #12-1 참조.
 *
 * ⚠ 저장값을 그대로 CLI 에 넘기지 마라 — 변환은 아래 `toCliPermissionMode` 한 곳이다.
 */
export const AVAILABLE_PERMISSION_MODES: readonly string[] = [
  'default', 'acceptEdits', 'auto', 'dontAsk', 'plan', 'bypassPermissions',
];

/**
 * §4 (CLI 사양 추종) — 우리 저장값 → CLI `--permission-mode` 값.
 *
 * **왜 표가 필요한가**: 종전에는 `'default'` 일 때 플래그를 아예 붙이지 않고 "CLI 기본이 곧 Manual"
 * 이라고 가정했다. 그 가정이 2026-08-14 에 깨졌다 — 그날부터 **CLI 무플래그 기본은 `auto`**(모델
 * 분류기가 스스로 승인) 이고, Pro/Max/Team 새 세션에 순차 적용된다. 그래서 화면에는 "Manual —
 * 위험한 동작마다 확인" 이라고 적혀 있는 에이전트가 **실제로는 자동 승인으로 돌 수 있었다.**
 * 사용자가 고른 승인 강도가 조용히 약해지는 것이라 표시 오류가 아니라 안전 문제다.
 *
 * CLI 2.1.251 `--help` 의 `--permission-mode` 선택지에 `manual` 이 실재하므로, 이제 **모든 모드를
 * 명시**한다(무플래그 = CLI 기본에 맡기는 자리를 없앤다). 플랜·조직 정책·판올림으로 기본값이 또
 * 바뀌어도 우리가 고른 값은 그대로 간다.
 *
 * `bypassPermissions` 만 예외다 — 전용 플래그(`--dangerously-skip-permissions`)로 나가므로
 * 이 표에 넣지 않는다(넣으면 두 경로가 같은 뜻을 두 벌로 들게 된다).
 */
export const PERMISSION_MODE_CLI_VALUES: Readonly<Record<string, string>> = {
  default: 'manual',
  acceptEdits: 'acceptEdits',
  auto: 'auto',
  dontAsk: 'dontAsk',
  plan: 'plan',
};

/**
 * 저장값을 CLI `--permission-mode` 값으로 옮긴다. 표에 없으면 `null`
 * (= `bypassPermissions` 전용 플래그 경로, 또는 우리가 모르는 값이라 플래그를 흘리지 않는다).
 */
export function toCliPermissionMode(mode: string | undefined | null): string | null {
  if (!mode) return PERMISSION_MODE_CLI_VALUES['default'] ?? null;
  return PERMISSION_MODE_CLI_VALUES[mode] ?? null;
}

/**
 * §4 (CLI 사양 추종) — 서브에이전트 **이름** 규칙: 소문자 영문·숫자·하이픈만, 하이픈으로 시작 ❌,
 * `:` 금지. 공식 문서가 못 박은 규칙이라 우리가 먼저 다듬어 보낸다 — CLI 가 거부하면 그 에이전트가
 * 통째로 못 뜨기 때문이다(`--isolation` 이 그렇게 죽었던 자리와 같은 성질).
 */
export function normalizeAgentDefinitionName(raw: string | undefined | null): string {
  if (!raw) return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')   // 공백·언더스코어·콜론·한글 전부 하이픈으로
    .replace(/-{2,}/g, '-')          // 연달아 생긴 하이픈은 하나로
    .replace(/^-+|-+$/g, '');        // 앞뒤 하이픈 제거(선두 하이픈은 CLI 가 거부)
}

/**
 * §4 (CLI 사양 추종) — `AgentDefinition[]` → `--agents` 가 받는 **JSON 문자열**.
 *
 * 우리는 순서 있는 배열로 들고 CLI 는 이름을 키로 하는 객체를 받으므로 여기서 뒤집는다.
 * 넘길 게 없으면 `null` — 그래야 호출부가 **플래그 자체를 안 붙인다**(빈 객체 `{}` 를 넘기면
 * "정의 0개"가 아니라 "정의를 준다"는 뜻이 되어 CLI 판본에 따라 파일 기반 에이전트를 가릴 수 있다).
 *
 * 버리는 것: 이름/설명/프롬프트 중 하나라도 빈 항목, 그리고 **먼저 나온 것과 이름이 겹치는 항목**
 * (객체 키라 뒤엣것이 앞엣것을 조용히 덮어써 사용자가 적은 정의 하나가 사라진다).
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

/**
 * §4 (CLI 사양 추종) — `--plugin-dir` 로 나갈 경로 목록 정리.
 *
 * 줄 단위로 받은 입력을 다듬는다: 앞뒤 공백 제거, 빈 줄 제거, **중복 제거**(같은 폴더를 두 번
 * 얹으면 CLI 가 같은 플러그인을 두 번 로드한다). 경로 문자열은 손대지 않는다 — 대소문자를
 * 접거나 구분자를 바꾸면 리눅스에서 다른 폴더가 되기 때문이다(멀티플랫폼 규칙 1).
 */
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
 * §5.3 #12-1-A — **이 설정에서 승인 팝업이 뜰 수 있는가.** `permissionTimeoutPolicy` 토글을
 * 보일지 결정하는 자리이고, 판정이 두 벌이 되지 않게 여기 한 곳에 둔다.
 *
 * 종전에는 `PERMISSION_MODES_WITHOUT_PROMPT` 하나로 끝났지만, 도구별 확인 목록(`askTools`)이
 * 생기면서 그 목록이 비어 있지 않으면 **`bypassPermissions`·`auto` 에서도 팝업이 뜬다** —
 * 그때 토글을 숨기면 사용자는 60초 무응답 정책을 **볼 수도 고칠 수도 없는데** 카드는 뜨는
 * 상태가 된다.
 *
 * `plan`·`dontAsk` 는 목록과 무관하게 그대로 숨긴다 — 전자는 실행 자체가 없고 후자는 팝업
 * 대신 즉시 거부라, 확인 목록이 그 둘을 되돌리지 않는다(서버 판정도 같은 규칙이다).
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

/**
 * §4 (CLI 사양 추종) — `--autocompact` 드롭다운이 그리는 값.
 * 맨 앞 `''` 는 "미설정"(=위층을 따름), `'off'` 는 **꺼짐**, `'auto'` 는 CLI 판단,
 * 나머지는 토큰 수(CLI 허용 100k~1M).
 */
export const AVAILABLE_AUTOCOMPACT_VALUES: readonly string[] = [
  '', 'off', 'auto', '100000', '200000', '400000', '500000', '1000000',
];

/**
 * §4 (CLI 사양 추종) — "접지 않는다"를 뜻하는 우리 축 값.
 *
 * ⚠ **CLI 에 보내는 값이 아니다.** 설치본은 `--autocompact` 에 `auto` 또는 100k~1M 만 받고,
 * `off`·`0` 을 주면 `argument 'off' is invalid` 로 **즉시 종료**한다(실측 2.1.252 —
 * `--help` + `--print` probe). 꺼짐은 **플래그를 아예 싣지 않는 것**으로 표현하며, 그러면
 * CLI 기본(창 전체)이라 Opus `[1m]` 에서는 사실상 압축이 없고 창에 닿을 때 한 번 접는
 * 최후 안전망만 남는다 — 그것이 우리가 파는 "꺼짐"의 정확한 의미다.
 *
 * 문자열을 여기저기 흩뿌리면 한 곳만 고쳐져 어긋나므로 비교는 전부 이 상수를 쓴다.
 */
export const AUTOCOMPACT_OFF = 'off';

/** `resolveAutoCompact` 가 돌려준 값이 "접는다"는 뜻인가. 꺼짐/빈 값이면 false. */
export function isAutoCompactOn(resolved: string): boolean {
  const v = resolved.trim();
  return v !== '' && v !== AUTOCOMPACT_OFF;
}

/**
 * §4 (CLI 사양 추종) — 비용 확인 팝업이 인용하는 **압축 1회의 실측 표본**.
 *
 * "토큰이 든다"는 말만으로는 크기 감각이 안 서고, 감각이 없으면 경고는 그냥 클릭해 넘기는 관문이
 * 된다. 그래서 숫자를 함께 보인다 — 이 저장소 트랜스크립트의 `compact_boundary` 기록
 * `runs` 회를 그대로 집계한 값이다(추정치가 아니다).
 *
 * ⚠ 사용자 환경마다 다르므로 팝업 문구는 이것을 **"실측 예"** 로 소개해야 한다. 자기 환경의
 * 확정 비용으로 읽히면 그것은 거짓말이 된다.
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
 * §4 (CLI 사양 추종) — 아무도 정하지 않았을 때 실릴 `--autocompact` 내장 기본값.
 *
 * CLI 기본은 "모델 창 전체"다. 우리는 Opus 에 `[1m]` 을 붙여 띄우므로 그 기본을 그대로 두면
 * 압축이 **100만 토큰에서야** 걸리는데, 실측상 세션 대부분은 그 근처도 못 가고 끝난다
 * (= 사실상 압축이 없다).
 *
 * 400k 로 두는 이유 — 실측한 세션 최고점이 213k·231k·255k·349k 였다. 200k 면 **웬만한 세션이
 * 작업 도중 한 번은 잘리고**, 1M 이면 아무 일도 일어나지 않는다. 400k 는 그 분포 바로 위라
 * 평범한 세션은 끝까지 온전히 가고 길어지는 세션만 걸린다.
 *
 * ⚠ 이 값은 **`--autocompact` 에 실리는 창 크기이자 우리 턴 경계 압축의 기준**이다 — 사용자가 고르는
 * 숫자는 이것 하나뿐이고(설정 창에 체크박스가 따로 없다), 실제로 접히는 자리는
 * `turnCompactTriggerTokens` 가 정한다.
 *
 * ⚠ **더 이상 "아무도 정하지 않았을 때"의 값이 아니다**(2026-09-02 사용자 지시). 내장 기본은
 * `DEFAULT_AUTOCOMPACT`(=꺼짐)로 옮겼고, 이 상수는 **사용자가 비용 확인 팝업에서 "켜기"를
 * 눌렀을 때 앉힐 권장 시작값**으로 남는다. 위 400k 근거(실측 세션 최고점 분포)는 그대로 유효하다.
 */
export const DEFAULT_AUTOCOMPACT_TOKENS = '400000';

/**
 * §4 (CLI 사양 추종) — 아무도 정하지 않았을 때의 내장 기본 = **꺼짐**(2026-09-02 사용자 지시).
 *
 * 종전 기본은 400k 였다. 압축은 공짜 정리가 아니라 **대화 전체를 다시 먹여 요약을 만드는 모델
 * 호출 1회**라 접을 때마다 토큰과 플랜 한도를 쓴다(이 저장소 실측 23회: 회당 입력 평균 364,566
 * 토큰 · 평균 150초 정지). 돈이 나가는 축이 사용자가 고른 적 없는 채로 켜져 있으면 안 되므로
 * 기본을 끄고, 켜는 것은 **비용 확인 팝업을 거친 명시 선택**으로만 되게 한다.
 */
export const DEFAULT_AUTOCOMPACT = AUTOCOMPACT_OFF;

/**
 * §4 (CLI 사양 추종) — 턴 경계·에이전트 요청으로 보내는 압축 명령.
 *
 * 문자열은 `SESSION_LOOP_COMPACT_COMMAND` 와 같지만 **축이 다르다**(그건 루프 회차 경계,
 * 이건 일반 턴 경계·에이전트 자율 요청). 사용자가 입력창에 직접 치는 것과 완전히 같은 길이며
 * 새 실행 레일이 아니다 — 그 세션 명령 큐에 `QueuedCommand` 한 건으로 얹힌다.
 */
export const AGENT_COMPACT_COMMAND = '/compact';

/** `displayCommands` 가 읽는 최소 모양 — 서버 `QueuedCommand` 를 통째로 알 필요가 없다. */
export interface DisplayCommandLike {
  silent?: boolean;
  status?: string;
  subAgentId?: string | null;
  startedAt?: number;
}

/**
 * §5.3 #9-1 (P) — **화면이 그릴 명령 목록.** 두 가지를 한 번에 한다.
 *
 * **① 조용한 압축을 감춘다.** 자동 압축은 사용자가 넣은 명령이 아니라 우리가 그 앞에 끼운
 * 것이라, 말풍선·대기열·명령 센터·탭 배지 어디에도 나오지 않는다.
 *
 * **② 그 진행 표시를 뒤에 선 명령에게 넘긴다.** ① 만 하면 압축이 도는 내내 사용자가 방금 넣은
 * 명령이 **"대기 중"** 으로 앉아 있다 — 아무것도 안 하는 것처럼 보이는데 실제로는 그 명령을
 * 위해 도는 중이라, 감춘 보람 없이 "왜 멈췄지"가 된다. 그래서 조용한 압축이 도는 동안 그
 * 세션의 **첫 대기 명령을 실행 중으로 그린다** — 사용자 눈에는 자기가 넣은 명령이 그냥
 * 진행 중이고, 압축은 그 대기 안에 숨는다(이 축이 원한 그림 그대로다).
 *
 * 바꾸는 것은 **화면에 건네는 사본 하나뿐**이다 — 서버가 준 값은 그대로 두고(§3.1 서버 = SSOT)
 * 여기서 상태를 만들거나 전이시키지 않는다. 실제로 그 명령이 나가면 서버가 같은 자리를
 * `executing` 으로 덮으므로 표시가 튀지 않는다.
 *
 * 규칙이 화면마다 따로 적히면 한 곳만 고쳐져 어긋나므로 **판정은 여기 한 곳**이 소유한다.
 *
 * ⚠ `isSessionRunning` 계열(돌고 있는가)에는 **쓰지 마라** — 그쪽은 서버가 준 진짜 큐를 봐야
 * 한다(감춘 명령도 도는 명령이다).
 */
export function displayCommands<T extends DisplayCommandLike>(list: readonly T[] | undefined): readonly T[] {
  if (!list || list.length === 0) return list ?? [];
  // 대부분의 큐에는 조용한 명령이 하나도 없다 — 그때는 **같은 배열 참조를 그대로** 돌려줘
  //   구조적 공유(§9)로 안정화해 둔 참조를 매 스냅샷마다 새 배열로 깨뜨리지 않는다.
  if (!list.some((c) => c.silent)) return list;

  // 지금 도는 조용한 압축들 — 그 진행 표시를 물려받을 세션과, 물려줄 시작 시각.
  const runningSilent = new Map<string, number | undefined>();
  for (const c of list) {
    if (c.silent && c.status === 'executing' && typeof c.subAgentId === 'string') {
      runningSilent.set(c.subAgentId, c.startedAt);
    }
  }

  const out: T[] = [];
  for (const c of list) {
    if (c.silent) continue;
    const sub = typeof c.subAgentId === 'string' ? c.subAgentId : null;
    if (sub !== null && c.status === 'queued' && runningSilent.has(sub)) {
      // 그 세션의 **첫** 대기 명령만 물려받는다(뒤엣것까지 실행 중으로 그리면 거짓이 된다).
      const startedAt = runningSilent.get(sub);
      runningSilent.delete(sub);
      out.push({ ...c, status: 'executing', ...(c.startedAt === undefined && startedAt !== undefined ? { startedAt } : {}) });
      continue;
    }
    out.push(c);
  }
  return out;
}

/**
 * §4 (CLI 사양 추종) — `agentCanCompact` 가 켜진 에이전트에게 매 턴 실리는 창구 안내.
 *
 * CLI 의 `SlashCommand` 도구는 `--tools` 로 켜도 헤드리스 세션에 나오지 않는다(실측 2.1.247)
 * — 그래서 에이전트가 `/compact` 를 직접 부를 방법이 없고, 서버에 신고하면 서버가 **다음 명령이
 * 나가기 직전에** 큐에서 돌린다. 토큰·주소는 스폰 env 에 이미 있으므로 여기에 비밀을 박지 않는다.
 *
 * §5.3 #9-1 (P) — 종전에는 "턴이 끝난 직후"였다. 그 자리는 사용자가 결과를 받아 든 다음이라
 * **아무도 기다리지 않는 시간에 화면이 다시 도는 것**으로 보였다. 이제 접는 자리는 다음 명령
 * 바로 앞이고, 그 명령은 어차피 사용자가 기다리는 턴이라 압축이 그 대기 안으로 숨는다.
 */
export function buildAgentSelfCompactRule(agentId: string, subAgentId: string): string {
  return `

# 컨텍스트 압축 요청 (네가 판단해서 부른다)
대화가 길어져 컨텍스트가 무겁다고 느끼면, **일이 한 단락 끝난 안전한 자리에서** 아래를 1회 호출해라.
서버가 **다음 명령이 나가기 직전에** \`${AGENT_COMPACT_COMMAND}\` 를 돌려 대화를 요약으로 접는다 — 작업 도중에 잘리지 않는다.

\`\`\`bash
curl -s -X POST "\${VIBISUAL_BASE}/api/agent-compact" -H "x-vibisual-hook-token: \${VIBISUAL_TOKEN}" \\
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"agentId":"${agentId}","subAgentId":"${subAgentId}","reason":"왜 지금인지 한 줄"}
JSON
\`\`\`
- **압축은 세부를 잃는다.** 파일·git 에 남지 않은 결정은 부르기 전에 적어 둬라.
- 한 턴에 한 번이면 충분하다(여러 번 불러도 한 번만 돈다). 호출 사실은 사용자에게 보고하지 마라.
- 실패해도 무시하고 하던 일을 계속해라 — 표시·편의용이라 결과에 영향이 없다.`;
}

/**
 * §4 (CLI 사양 추종) — 실제로 `--autocompact` 에 실을 값을 정하는 **단 하나의 판정**.
 *
 * 3층으로 내려온다: **에이전트 설정 → 설정 창(Agent Defaults) 전역 기본 → 내장 기본**.
 * 그래서 `''`(미설정)은 "플래그 없음"이 아니라 **"위층을 따름"** 이다 — 종전처럼 CLI 판단에
 * 맡기려면 `'auto'` 를 고른다(명시값이라 그대로 실린다). 이 계층이 있어야 **이미 만들어져
 * 돌던 에이전트**도 설정 창에서 바꾼 값을 따른다.
 *
 * ⚠ 목록 밖의 값은 내장 기본으로 떨어뜨린다. CLI 는 범위 밖 값을 무시하지 않고
 * `argument … is invalid` 로 **즉시 종료**하므로(실측 2.1.247 — `--autocompact 50000`),
 * 저장분이 오염돼 있으면 그 에이전트는 영영 뜨지 못한다.
 */
export function resolveAutoCompact(agentValue?: string, userDefaultValue?: string): string {
  for (const raw of [agentValue, userDefaultValue]) {
    const v = raw?.trim();
    if (v && AVAILABLE_AUTOCOMPACT_VALUES.includes(v)) return v;
  }
  return DEFAULT_AUTOCOMPACT;
}

/**
 * §4 (CLI 사양 추종) — `--autocompact` 값을 **토큰 수**로 읽는다. CLI 에게 이 숫자는 **창 크기**이지
 * 자르는 지점이 아니다(설치본 2.1.251 `--help`: "Auto-compact window size"). 요약을 돌릴 여유가
 * 있어야 하므로 CLI 는 이 선에 **닿기 전에** 접는다 — 그래서 이 숫자를 우리 발동선으로 그대로 쓰면
 * CLI 가 항상 먼저 도달해 턴 경계 압축이 **영영 걸리지 않는다**(실제로 그렇게 만들어 봤다).
 * 우리 선은 `turnCompactTriggerTokens` 가 이 값에서 한 단 낮춰 잡는다.
 *
 * `'auto'` 는 숫자가 아니다 — CLI 가 창 크기를 정하겠다는 뜻이므로, 그 모델의 창(`contextMax`)을
 * 선으로 삼는다. 창 크기를 모르면 `null` 을 돌려주고, 부르는 쪽은 그것을 **"아직 판정 불가"**로
 * 다뤄야 한다(모르는 채로 쏘면 종전의 매 턴 압축으로 되돌아간다).
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
 * §4 (CLI 사양 추종) — 우리가 **턴 경계에서** 접는 선을 자동 압축 값의 몇 배로 잡는가.
 *
 * 1.0 이면 안 된다 — CLI 는 그 값을 창 크기로 보고 그보다 **먼저** 접으므로, 같은 숫자를 쓰면
 * 우리 차례가 오지 않는다. 0.8 은 400k 설정에서 320k 다: 한 턴이 대략 그 위 여백(약 8만 토큰)을
 * 통째로 뚫지 않는 한 우리가 먼저 도달해 **안전한 자리**에서 접고, 뚫는 예외에서는 CLI 가 도중에
 * 접는 최후 안전망이 그대로 남는다. 둘 중 무엇이 걸려도 압축은 일어난다 — 이 숫자가 정하는 것은
 * "어디서 잘리는가"이지 "잘리는가"가 아니다.
 */
export const TURN_COMPACT_TRIGGER_RATIO = 0.8;

/**
 * §4 (CLI 사양 추종) — **턴이 끝났을 때 접기 시작하는 토큰 수.** 화면에 적히는 숫자도 이것이다.
 *
 * 자동 압축 값 하나에서 파생되므로 사용자가 고르는 숫자는 여전히 하나뿐이다(설정 창의 체크박스를
 * 없앤 이유 — 같은 일을 하는 손잡이가 둘이면 헷갈리기만 한다). 값을 모르면 `null` 이고, 부르는
 * 쪽은 그것을 **"아직 판정 불가"**로 다뤄야 한다.
 */
export function turnCompactTriggerTokens(resolved: string, contextMax?: number): number | null {
  const window = autoCompactThresholdTokens(resolved, contextMax);
  if (window === null) return null;
  return Math.round(window * TURN_COMPACT_TRIGGER_RATIO);
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
  /**
   * §5.3 #9-1 (P축) — 마지막 압축 이후 이 세션이 돈 턴 수.
   *
   * 컨텍스트 축(위 둘)과 **직교**한다. 큰 창(1M)에서는 발동선이 아주 멀어 수백 턴을 돌아도
   * 한 번도 안 접히는데, 실측상 비용의 96.5%가 `cache_read`(매 턴 전체를 다시 읽는 값)라
   * **턴이 쌓이는 것 자체가 N² 로 돈이 된다** — 그 자리를 재는 것이 이 축이다.
   */
  turnsSinceCompact?: number;
  /** §5.3 #9-1 (P축) — 그 턴 수의 상한. 0/undefined = 이 축 끔(종전과 같은 판정). */
  turnBudget?: number;
  /**
   * §5.3 #9-1 (Q축) — 토큰 절약이 조인 압축 창. `''`/undefined = 미설정(종전 판정 그대로).
   *
   * ⚠ 스폰(`--autocompact`)과 **같은 값**이어야 한다 — 한쪽만 조이면 CLI 는 200k 에서 접는데
   * 우리는 400k 기준으로 쏘게 되어, 우리 차례가 영영 오지 않거나 두 벌로 접힌다.
   */
  tokenSaverAutoCompact?: string;
}

/**
 * §4 (CLI 사양 추종) — **턴이 끝났다. 지금 접어야 하는가.**
 *
 * 켜고 끄는 스위치가 없다. 자동 압축 값을 고른 순간 "그 근처에서 접는다"는 뜻이고, 판정하는 자리는
 * 언제나 **턴 경계**다 — 손잡이 둘(창 크기 + 턴 경계 체크박스)이 같은 일을 하며 헷갈리게 하던 것을
 * 하나로 합친 결과다. 사용자가 고르는 숫자 하나가 "얼마나 차면"과 "언제 접는가"를 함께 정한다.
 *
 * ⚠ §5.3 #9-1 (P) — **여기서 참이 나와도 그 자리에서 접지 않는다.** 참은 "다음 명령 앞에서 접어라"는
 * 예약이고, 실제 압축은 그 세션에 다음 명령이 나가기 직전에 조용히(`QueuedCommand.silent`) 실린다.
 * 판정과 실행을 가른 이유는 하나다 — 턴이 끝난 자리는 **아무도 기다리지 않는 시간**이라 거기서
 * 도는 압축은 순수한 추가 대기로 보이는 반면, 다음 명령 앞은 어차피 사용자가 기다리는 구간이다.
 *
 * ⚠ **꺼짐(`AUTOCOMPACT_OFF`)이면 발동선이 없다** — `autoCompactThresholdTokens` 가 null 을 주므로
 * 아래 둘째 조건은 영영 걸리지 않는다. 다만 `agentCanCompact` 는 **직교 축**이라 꺼짐에서도
 * 에이전트 요청은 그대로 돈다 — 그 스위치도 켤 때 같은 비용 확인을 거치므로 몰래 도는 것이 아니다.
 *
 * 발동 조건 둘:
 *  - **에이전트 요청**(`agentCanCompact`) — 무조건 참. 판단을 맡긴 축이라 우리가 되묻지 않으며,
 *    발동선 아래(예: 120k)에서도 "이 일 끝났고 앞 맥락은 이제 필요 없다"고 부를 수 있다.
 *  - **발동선 도달** — `turnCompactTriggerTokens` 를 넘긴 채 턴이 끝났을 때.
 *
 * ⚠ **컨텍스트를 못 재면 거짓**이다(`contextUsed` 없음/0). 모르는 채로 참을 돌려주면 매 턴 압축으로
 * 조용히 되돌아간다 — 안 접히는 쪽이 사용자가 알아채고 고칠 수 있는 실패다(CLI 안전망도 남아 있다).
 */
export function shouldCompactAfterTurn(input: CompactAfterTurnInput): boolean {
  if (input.requested) return true;
  // §5.3 #9-1 (P축) — 턴 예산. 컨텍스트를 못 재는 세션에서도 걸리는 **유일한** 조건이라
  //   아래 "못 재면 거짓" 규칙보다 **먼저** 본다(뒤에 두면 창을 못 재는 세션에서 영영 안 걸린다).
  const budget = input.turnBudget ?? 0;
  if (budget > 0 && (input.turnsSinceCompact ?? 0) >= budget) return true;
  const used = input.contextUsed;
  if (typeof used !== 'number' || !Number.isFinite(used) || used <= 0) return false;
  const trigger = turnCompactTriggerTokens(
    resolveEffectiveAutoCompact(input.autoCompact, input.userAutoCompact, input.tokenSaverAutoCompact),
    input.contextMax,
  );
  if (trigger === null) return false;
  return used >= trigger;
}

/**
 * 선택 가능한 사고 깊이 (effort) — **폴백 전용**.
 *
 * §4 v1.49 — Opus 4.7 신규 등급 `xhigh` 추가.
 * §4 v2.48 — Opus 4.8 은 low/medium/high/xhigh/max 5등급을 모두 별개로 지원(공식 문서 2026-05).
 *   v1.49 에서 빠졌던 `'max'`(토큰 제약 없는 최대 추론, per-spawn 세션 단위)를 최상단으로 재도입.
 * 서버는 string 패스스루이므로 SDK/CLI 가 인식하는 신규 값을 즉시 사용 가능.
 *
 * §4 — 더 이상 UI 의 1차 소스가 아니다. AgentConfigPopup / OptionsWindow 는 `listEffortLevels(registry)`
 * (=설치된 `claude --help` 에서 파싱한 실제 `--effort` 값)를 우선 쓰고, 그게 비었을 때만 이 상수로 폴백한다.
 * CLI 가 새 등급을 추가하면 코드 수정 없이 자동 노출 — Model 드롭다운의 registry 기반 동적화와 동일 철학.
 */
export const AVAILABLE_EFFORT_LEVELS: readonly string[] = [
  'default', 'low', 'medium', 'high', 'xhigh', 'max',
];

/**
 * §4 — `claude --help` 가 **적어 두지 않은** effort 등급 후보.
 *
 * CLI 는 도움말의 `--effort <level> (…)` 괄호에 5등급만 적지만, 그 목록 밖 값을 전부 거부하지는 않는다.
 * `ultracode`(xhigh + 동적 워크플로우 자동 편성 · 2026-05 Opus 4.8 동시 출시)가 그 자리다 —
 * 도움말에 없으면서 **경고 없이 수락**된다(실측 2.1.259: `--effort ultracode --version` 은 무경고,
 * `--effort zzzbogus --version` 은 `Warning: Unknown --effort value …`). 도움말만 믿으면
 * **CLI 가 받는데 사용자는 고를 수 없는 등급**이 생기므로, 여기 적힌 후보는 부팅 시 한 번씩
 * 실측 probe 해서 **받아들여지는 것만** 목록에 더한다(`effortLevelProbe.ts`).
 *
 * §4 규약 (4) 의 "판정 근거는 추측이 아니라 설치본 실측" 을 **값** 축으로 넓힌 것이다 —
 * 종전 probe 는 "플래그가 있는가" 였고 이쪽은 "그 플래그가 이 값을 받는가" 다.
 * ⚠ 이 목록에 이름을 적는 것만으로는 아무것도 켜지지 않는다 — CLI 가 거부하면 그대로 빠지고,
 * CLI 가 값 검증 자체를 안 하는 판올림이면(보정 probe 실패) 후보를 통째로 버린다.
 */
export const EFFORT_LEVEL_PROBE_CANDIDATES: readonly string[] = ['ultracode'];

/**
 * §4 — Effort(사고 깊이) 드롭다운의 **동적** 옵션 목록.
 *
 * 우선순위:
 *  (1) `registry.effortLevels` (서버가 `claude --help` 의 `--effort <level> (...)` 에서 파싱) — 설치된 CLI 진실.
 *  (2) 비었으면 `AVAILABLE_EFFORT_LEVELS` (하드코딩 폴백).
 * 어느 경우든 맨 앞에 `'default'`(오버라이드 없음)를 항상 붙인다(중복 제거).
 *
 * Model 드롭다운의 `listModelFamilies` 와 대칭 — 클라 하드코딩 `EFFORT_VALUES` 를 대체한다.
 */
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

/** §5.3 #28 v1.47 — Vibisual Custom Mode 옵션. 'conti' 만 본 라운드에서 동작, 나머지는 placeholder. */
export const AVAILABLE_CUSTOM_MODES = [
  { value: 'conti', enabled: true },
  { value: 'review', enabled: false },
  { value: 'debug', enabled: false },
] as const;

/**
 * §4 v2.63 — 선택 가능한 실행(스폰) 모드. `AgentConfig.executionMode` 축.
 * 'headless'(기본) = 서버가 `claude -p` 헤드리스 스폰(프로그래매틱 과금).
 * 'interactive-terminal' = IDE 창 안 임베디드 PTY 로 인터랙티브 `claude` REPL(구독 과금, 6/15 대응).
 */
export const AVAILABLE_EXECUTION_MODES = [
  { value: 'headless', enabled: true },
  { value: 'interactive-terminal', enabled: true },
] as const;

/**
 * §4 (CMD 터미널 업그레이드 ⑧) — CMD 버블이 띄울 수 있는 에이전트 CLI 표.
 *
 * `bin` = 셸에 prefill 될 실행 파일명(빈 문자열 = 아무것도 넣지 않는 순수 셸),
 * `managed` = **우리 훅의 자식으로 다루는지** — true 일 때만 rules `--add-dir`·`--resume`·
 * 소유자 태그·카드 토큰 env 를 붙인다. 새 CLI 지원은 이 표에 한 줄 추가로 끝난다(§3.3).
 */
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

/**
 * §4 (CMD 터미널 업그레이드 ③) — 임베디드 터미널 scrollback 줄 수.
 * xterm 의 `scrollback` 옵션과 desktop PTY 링버퍼가 **같은 값**을 쓰게 하는 단일 출처.
 * 종전에는 링버퍼 256KB 와 xterm 기본 1000줄이 어긋나 Ctrl+F 로 못 찾는 구간이 있었다.
 */
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

/**
 * §4 (CMD ③) — 클라 리사이즈 트레일링 디바운스(ms).
 * 드래그 중 매 픽셀 SIGWINCH 를 쏘지 않고 **멎은 뒤 1회**만 PTY 에 통지한다.
 * 폰트 확대/축소도 같은 창구를 타므로 "+"를 세 번 연타해도 리사이즈는 한 번이다.
 */
export const TERMINAL_RESIZE_DEBOUNCE_MS = 150;

/**
 * §4 (CMD ③) — 리사이즈 직후 **화면 전체 리페인트**를 replay 링버퍼에서 걸러 낼 시간 창(ms).
 *
 * Windows ConPTY 는 `ResizePseudoConsole` 마다 보이는 화면을 통째로 다시 내보낸다(실측: 리사이즈
 * 6회 = cmd 배너 6벌 추가, 배너 사이 간격이 그때의 rows 와 일치). 그대로 링버퍼에 쌓으면 재부착
 * replay 때 같은 배너·프롬프트가 리사이즈 횟수만큼 되살아난다("cmd 창이 같은 걸 계속 출력").
 */
export const CMD_RESIZE_REPAINT_MS = 400;

const CONSOLE_ESC = String.fromCharCode(27);

/**
 * 리사이즈 리페인트의 실측 시그니처 — 커서 숨김/창크기 보고/속성 리셋 몇 개를 지나 **커서 home**
 * (`CSI H` 또는 `CSI 1;1H`)으로 시작한다: `ESC[?25l` `ESC[8;<rows>;<cols>t` `ESC[H` `…화면 전체…`.
 * 화면을 지우는 `J` 는 일부러 빼 둔다 — `cls` 같은 정상 출력까지 삼키지 않게(못 걸러도 종전 동작).
 */
const CONSOLE_REPAINT_RE = new RegExp(
  `^(?:${CONSOLE_ESC}\\[(?:\\?[0-9;]*[hl]|[0-9;]*m|8;[0-9]+;[0-9]+t))*${CONSOLE_ESC}\\[(?:1;1)?H`,
);

/** 이 PTY 청크가 콘솔의 **화면 전체 재출력**으로 시작하는가(= 리사이즈 리페인트 후보). */
export function isConsoleRepaintChunk(data: string): boolean {
  return CONSOLE_REPAINT_RE.test(data);
}

/**
 * §4 (CMD ③) — 이 PTY 청크를 replay 링버퍼에 **쌓아야 하는가**.
 *
 * 리사이즈 직후(`CMD_RESIZE_REPAINT_MS` 안)에 오는 화면 전체 리페인트만 `false` 다. 그런 청크도
 * 화면(sink)에는 그대로 흘려보내야 하지만(현재 화면이 곧 그 리페인트다), 버퍼에 쌓으면 재부착
 * replay 가 리사이즈 횟수만큼 같은 화면을 되풀이한다. `resizedAt=0` 은 "직전 리사이즈 없음".
 */
export function shouldBufferPtyChunk(data: string, resizedAt: number, now: number): boolean {
  if (!resizedAt || now - resizedAt > CMD_RESIZE_REPAINT_MS) return true;
  return !isConsoleRepaintChunk(data);
}

/**
 * §4 (CMD) — 셸이 프롬프트를 그릴 틈을 준 뒤 입력줄에 명령을 채우기까지의 시간(ms).
 * 0 이면 배너보다 먼저 써 넣어 글자가 배너 사이에 끼어 보인다.
 */
export const CMD_PREFILL_DELAY_MS = 350;

/**
 * §4 (CMD) — 입력줄 채우기를 리사이즈 때문에 미룰 수 있는 **총 한도**(ms).
 *
 * ConPTY 는 리사이즈마다 보이는 화면을 통째로 다시 그리는데(`CMD_RESIZE_REPAINT_MS`), 그때 셸
 * 입력줄에 글자가 들어 있으면 새 폭에 맞춰 다시 배치되며 잘려 나간다 — 사용자 눈에는 "자동으로
 * 적어 둔 명령이 지워진다"로 보인다. 그래서 크기가 멎은 뒤에 채우되, 창을 계속 끌고 있는 동안
 * 영영 안 채워지지는 않게 이 한도에서 끊는다.
 */
export const CMD_PREFILL_MAX_DEFER_MS = 2000;

/**
 * 지금 예약할 입력줄 채우기 지연(ms). 평소에는 `CMD_PREFILL_DELAY_MS`, 위 한도가 가까우면 그
 * 남은 시간만큼만(음수면 0 = 지금 당장).
 *
 * @param now 현재 시각(ms)
 * @param deadline 최초 예약 때 정해진 한도 시각(ms)
 */
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
 * §4 (CMD 2차 0) — 훅이 그 CMD 탭의 `working`/`idle` 권위를 쥐는 시간(ms).
 *
 * 이 안에 훅이 그 탭을 한 번이라도 몰았으면 화면 감지는 `blocked` 만 기여한다. 훅이 없는
 * CLI(codex·gemini·순수 셸)는 이 표에 오르지 않으므로 화면 감지가 단독 권위로 남는다.
 * 값이 너무 짧으면 조용한 턴 사이에 권위가 풀려 도트가 다시 튀고, 너무 길면 claude 를 끄고
 * 다른 CLI 를 띄운 탭이 한동안 상태를 못 받는다 — 세션 유휴 판정(5분)과 같은 눈금으로 맞춘다.
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
 * §4 (⑥) (판올림 번호 발급 대기) — **prefill 에서 걷어내는 것.**
 *
 * 종전 필터는 `/[\r\n]+/` 두 글자뿐이었다. 그런데 "개행을 붙이지 않는다"가 지키려는 것은 *글자 두 개*가
 * 아니라 **사람이 누르기 전에는 실행되지 않는다**는 성질이고, PTY 에서 그 성질을 건드리는 바이트는
 * 개행 말고도 있다 — `\x04`(EOF: 정규 모드에서 대기 중인 줄을 읽는 쪽에 그대로 넘긴다) · `\x03`(SIGINT) ·
 * `\x1a`(Windows EOF) · `\x1b`(ESC: 터미널 앱의 키 시퀀스로 해석된다) · `\x00`.
 *
 * 그래서 **차단 목록을 허용 목록으로 뒤집는다** — C0 제어문자와 DEL 을 전부 공백으로 바꾸고 나머지는
 * 그대로 둔다(탭도 제어문자라 함께 접힌다 — prefill 한 줄에 탭이 필요한 경우는 없다). 이렇게 하면
 * "무엇이 위험한가"를 매번 다시 세지 않아도 되고, 새 제어문자가 문제가 되는 날에도 이 함수는 이미 막고 있다.
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

/**
 * §4 (CMD 터미널 업그레이드 ⑤) — 신뢰할 수 없는 입력(REST body·옛 체크포인트)에서 pane 트리를
 * 안전하게 복원한다. 형태가 어긋나면 `null`(= 단일 pane)로 떨어뜨린다.
 *
 * - `ratio` 는 `CMD_PANE_RATIO_MIN`~`MAX` 로 clamp,
 * - leaf 총 개수가 `CMD_PANE_MAX` 를 넘으면 거부(§3.2.3 — 쓸수록 커지는 것에 상한),
 * - 중복 pane id 도 거부(같은 termId 를 두 자리에 그리면 PTY 하나를 두 xterm 이 다툰다).
 */
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

/**
 * §4 (⑤) — 지정한 pane 을 둘로 쪼갠 새 트리를 돌려준다(원본 불변).
 * `newPaneId` 는 호출자가 발급한 미사용 id. 대상 pane 을 못 찾으면 원본을 그대로 돌려준다.
 */
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
 * §4 (⑤) — 지정한 split 노드의 비율을 갈아 끼운 새 트리(원본 불변).
 *
 * split 노드는 **둘째 자식의 첫 잎 id** 로 식별한다(`secondChildHeadPaneId`).
 *
 * ⚠ 예전에는 *첫째* 자식의 첫 잎으로 식별했는데 그 키는 **유일하지 않다** — 잎 `L` 에서 루트로
 * 올라가며 "부모의 children[0] 인 동안" 만나는 조상 split 이 **전부 같은 키**를 갖는다.
 * 그래서 `row[ col[leaf0, leaf2], leaf1 ]`(첫 pane 을 한 번 더 분할한 흔한 모양)에서 키가 둘 다
 * `'0'` 이 되어, 경계선 하나를 끌면 **두 경계선이 함께 움직이고** 그 값이 서버에 저장까지 됐다.
 *
 * 둘째 자식의 첫 잎은 유일하다: 잎 `L` 을 첫 잎으로 갖는 `children[1]` 은 트리 전체에서 하나뿐이다
 * (`L` 에서 위로 올라갈 때 "처음으로 children[1] 쪽에서 온" 지점이 정확히 한 곳이다).
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

/**
 * §4 (CMD ①) — `blocked` 판정용 프롬프트/질문 패턴 표.
 *
 * 화면 **꼬리 `CMD_BLOCK_TAIL_LINES` 줄**(ANSI 제거·빈 줄 제외)에 대해서만 검사한다 —
 * 본문 산문에서 물음표를 주워 오탐하지 않게 하기 위한 제약이며, 검사 시점 자체가
 * "무출력 `CMD_BLOCKED_IDLE_MS` 경과" 뒤라 지나가는 출력은 애초에 걸리지 않는다.
 * 새 CLI 의 확인 문구는 이 표에 한 줄 추가로 지원한다(§3.3 하드코딩 금지).
 */
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
  // 무엇을 고를지 묻는 **CLI 질문형** 한 줄.
  //   ⚠ 종전의 맨 물음표 규칙(`/\?\s*$/`)은 폐기했다 — 에이전트가 답을 "~할까요?"로 끝내는 것은
  //   herdr 정의상 `idle`(다음 프롬프트를 받을 준비)이지 `blocked`(입력을 기다려 멈춤)가 아닌데,
  //   그 규칙이 매 턴 끝마다 앰버 링과 OS 알림을 띄웠다(실측 오탐).
  /\b(?:which|what|where|who|how many|select|choose|pick|enter)\b[^\n]{0,60}\?\s*$/i,
  // 한국어 입력 요청(같은 이유로 평서형 질문은 제외하고 "입력/선택 요청"만).
  /(?:선택|입력|골라)[^\n]{0,12}(?:하세요|해\s*주세요|하시겠|해라)[^\n]{0,4}[?:]?\s*$/,
];

/**
 * §4 v2.63 — CMD(인터랙티브 터미널) 에이전트 버블의 구분 색(teal-600).
 * 우클릭 "CMD Agent" 로 생성 시 agentConfig.color 에 baked → 일반 커스텀 에이전트(blue)와 한눈에 구별.
 * 사용자가 이후 색을 바꾸면 그 값이 우선(기능 표식은 executionMode 가 전담, 색은 cosmetic).
 */
export const CMD_AGENT_COLOR = '#0d9488';
/**
 * §5.19 (C) — All Model(로컬 LLM) 버블 본체 색.
 * 채도 높은 원색을 하나 더 들이면 캔버스가 탁해진다 — 앱 버블이 푸시아를 걷어내고 그레이파이트로
 * 간 것과 같은 이유로 무채색을 쓰고, 무엇을 물고 있는지는 라벨(모델명)이 말한다.
 */
export const LOCAL_AGENT_COLOR = '#3F4658';
/**
 * §5.25 (B) — Codex CLI 에이전트 버블 본체 색.
 * 프로바이더 배지만이 아니라 캔버스에서도 Claude/로컬 에이전트와 즉시 구별되게 한다.
 */
export const CODEX_AGENT_COLOR = '#047857';

/**
 * §5.3 #28 (K) v1.48 — 콘티 모드 진입 시 자동으로 `AgentConfig.rules` 에 박히는 강제 룰셋.
 * "사용자 입력이 무엇이든 응답은 콘티 JSON 으로만" 을 룰 + 스키마 양쪽으로 강제.
 * 이 상수가 들어 있는 동안 모델은 다른 형식으로 응답하기 어렵다.
 */
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
 * §5.3 #28 v1.60 — STAMP_CATALOG.
 *
 * LLM 이 좌표 합성으로 UI 컴포넌트를 매번 새로 그리지 않도록 미리 정의된
 * stamp 집합을 강제. 서버 \`coerceElement\` 가 \`stampName\` 이 이 카탈로그의 키에
 * 없으면 element 통째로 drop, 클라 \`StampSvg\` 가 같은 카탈로그를 보고 prebuilt SVG 렌더.
 *
 * 카탈로그 항목은 LLM 룰셋(\`CONTI_AGENT_RULES\`) 의 STAMP_CATALOG 섹션과 1:1 동기화.
 * 항목 추가/제거 시 양쪽 함께 갱신.
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

/** §5.3 #28 (K) v1.48 — `AgentConfig.rulesHistory` 가 보관하는 최대 항목 수. 초과 시 가장 오래된 항목 FIFO drop. */
export const RULES_HISTORY_MAX = 20;

/**
 * §5.3 #28 v1.47 — 콘티 패치/생성 시 LLM 호출 기본 설정.
 * v1.59 — viewBox 200×110 (작아서 식별 안됨) → 표준 스토리보드 16:9 비율 **320×180** 로 확대.
 * 디스플레이 wireframe 영역도 280×140 → 480×270 으로 1.7× 키움 (FrameCard 폭 280→520).
 * 기본 fontSize/strokeWidth 도 같이 키워 LLM 결과물이 한눈에 읽히도록.
 */
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

/**
 * 출력 프리셋 표 — **이 표가 유일한 출처다**(§3.3 하드코딩 금지).
 *
 * 컷의 좌표계는 여기 없다. `CONTI_DEFAULTS.viewBoxWidth/Height`(320×180)는 프리셋과
 * 무관하게 고정이며, 프리셋은 *출력* 판형(화면 크기·컷 길이·배치)만 정한다. 좌표계를
 * 프리셋마다 갈면 이미 그려 둔 콘티가 프리셋을 바꾸는 순간 전부 어긋난다.
 */
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
// ─── §5.3 v4.89 자기 기억 범위 · 중첩 깊이 ───

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

// ─── §5.5 #17-18 v4.68 덧말 처리 방식 ───

/** 큐 항목 UI 가 그리는 순서(대기 → 합치기 → 즉시). */
export const COMMAND_DISPATCH_MODES: readonly CommandDispatchMode[] = ['wait', 'merge', 'immediate'] as const;

/** 방식을 지정하지 않고 넣은 명령의 기본값.
 *  합치기 — 연달아 넣은 덧말은 대개 "하나의 생각을 나눠 적은 것"이라 한 턴에 함께 가야 한다
 *  (쪼개면 앞 지시가 뒤 지시에 뒤집히고 완료 보고 카드만 늘어난다). */
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
 * `CommandErrorCode` 전량의 **런타임 목록**. 화면이 "이 코드를 아는가"를 이 목록으로 판정한다.
 *
 * 목록을 여기 한 벌만 두는 이유: 클라가 자기 집합을 따로 들고 있던 동안 `local`(§5.19) 이 유니언에만
 * 추가돼, 로컬 모델 실패가 "알 수 없는 이유" 로 떨어지고 스트림 쪽은 `exit` 로 폴백해 **CLI 를 쓰지도
 * 않는 실패를 "Claude CLI 가 종료됐다"** 로 말했다(2026-08-20 사용자 보고). 코드를 늘릴 때는
 * 유니언과 이 목록, 그리고 `ide.cmdError.<code>` 문자열까지 한 번에 늘린다(클라 테스트가 확인한다).
 */
export const COMMAND_ERROR_CODES = [
  'spawn', 'stdin', 'exit', 'crash', 'cli', 'maxTurns', 'agentView', 'orphaned', 'local',
] as const satisfies readonly CommandErrorCode[];

/** 종료 코드 유무로 문장이 갈리는 코드 — 코드가 없으면 `<code>Unknown` 문장을 쓴다. */
export const COMMAND_ERROR_CODES_WITH_EXIT = ['exit', 'crash'] as const satisfies readonly CommandErrorCode[];

// ─── 훅 버블 읽기 전용 경계 (§5.5 #17 / #17-29) ───

/**
 * 훅으로 태어난 에이전트 버블인가 = **읽기 전용인가.**
 *
 * 훅 버블은 사용자가 외부(VS Code 등)에서 직접 연 Claude Code 세션의 **시각화**다. 우리가 spawn 하지
 * 않았으므로 스폰 시 실리는 것(컨텍스트 요약·카드 지시문·목표·집행 플러그인)이 하나도 없고, 완료 신고
 * 경로도 없다. 거기에 명령을 넣으면 그 자식은 아무것도 주입받지 못한 채 매달린다 — 그래서 관측만 한다.
 *
 * 버블을 못 찾은 경우(`null`/`undefined`)도 훅으로 본다 — 모르면 쓰지 않는다.
 * 서버 REST 가드와 클라 UI 가 **같은 함수**를 쓰기 때문에 "화면에선 막혔는데 서버는 받는" 어긋남이 없다.
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

/** Task Edge 템플릿 — 드래그 연결 시 역할 조합에 맞는 프리셋 자동 제안.
 * `default*`는 v1.18 고급 옵션 자동 채움용(모두 optional — 미설정 시 `TASK_EDGE_DEFAULTS` 적용). */
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
    defaultCommand: 'Write code following the ADR implementation plan. Run tests after each change.',
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
    defaultCommand: 'Independently verify the implementation. Run builds, tests, and edge cases yourself.',
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
    defaultCommand: 'Review the verification failures and fix them. Re-run tests after fixing.',
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
    // v1.83 — 사용자 지정 Custom 엣지 기본값(메시지 본문 제외): Gate=auto, 반환=둘 다,
    // Command 모드=도구 위임(tool-delegation), 위임 정책=auto.
    defaultForwardMode: 'auto',
    defaultKind: 'command',
    defaultMessageFormat: 'free',
    defaultReturnFormat: 'both',
    defaultPriority: 'normal',
    defaultCommandMode: 'tool-delegation',
    defaultDelegationPolicy: 'auto',
  },
];

/** Task Edge 옵션 기본값 — 템플릿·필드 미설정 시 폴백. v1.18 */
export const TASK_EDGE_DEFAULTS = {
  kind: 'command' as TaskEdgeKind,
  messageFormat: 'free' as const,
  returnFormat: 'summary' as const,
  forwardMode: 'manual' as const,
  retryCount: 0,
  cacheEnabled: false,
  priority: 'normal' as const,
  delegationPolicy: 'strict' as const, // v1.33 — 엣지별 위임 정책. 기본 강제.
  // v1.41 — Critique 엣지 전용 기본값 (kind='critique' 일 때만 의미).
  critiqueTiming: 'intermediate' as const,
  critiqueAuthority: 'force-rework' as const,
  maxReworkCount: 3,
  // v1.44 — Command 엣지 전용 기본값 (kind='command' 일 때만 의미).
  // 'shared' 기본 — 부모 도구 박탈 ❌. v1.37 이전 + auto 정책 거동.
  // 박탈을 원하면 사용자가 명시적으로 'tool-delegation' 선택.
  commandMode: 'shared' as const,
};

/** v1.41 — Critique 재작업 횟수 입력 UI 상한. 무한 루프 방지 목적이므로 관용 상한 10. */
export const TASK_EDGE_CRITIQUE_MAX_REWORK_LIMIT = 10;

/**
 * §5.3 #10-3 v4.98 — 검증 런 보관 상한 (autoAgentId 당, ring buffer).
 * 넘으면 가장 오래된 런부터 밀려난다.
 */
export const AUTO_AGENT_RUN_MAX_PER_AGENT = 50;

/**
 * §5.3 #10-3 v4.98 — 런 하나가 쓸 수 있는 재작업 예산(기본값).
 * 종전에는 엣지마다 따로 셌기 때문에 reviewer·tester 가 각각 3번씩 = 실제 6번이 됐다.
 * 이제 런 전체 합산이며, 소진 시 조용한 강등이 아니라 에스컬레이션이다.
 */
export const AUTO_AGENT_RUN_DEFAULT_REWORK_BUDGET = 3;

/**
 * §5.3 #10-3 v4.98 — 검수자에게 요구하는 **구조화 판정 형식**.
 *
 * 종전에는 자유 텍스트를 정규식으로 긁어 판정했고, 해석에 실패하면 `unknown` 이 되어
 * 승인과 같은 길로 흘렀다(fail-open). 이제 이 형식을 요구하고, 어긋나면 `held`(보류)다.
 * 증거 없는 approve 도 `held` 로 떨어진다 — "봤더니 괜찮다"는 증거가 아니다.
 */
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

/** v1.54 — `bundleRole='auto-rework'` 자동 엣지의 표준 command 라벨.
 *  critique force-rework 가 발사하는 rework 지시 채널의 자동 본문. 사용자 편집 불가. */
export const TASK_EDGE_AUTO_REWORK_COMMAND_LABEL = 'Rework on critique reject';

/** v1.32 — Task Edge dispatch 기본 타임아웃 (ms). 엣지 `timeoutMs` 미설정/0 시 적용.
 *  v1.84 — 기본 0 = 무제한(dispatch 가 타이머를 아예 설치하지 않고 타겟 완료까지 홀드).
 *  사용자가 팝업 Timeout 입력에 양수를 넣은 엣지에서만 그 ms 로 제한이 걸린다. */
export const TASK_EDGE_DISPATCH_DEFAULT_TIMEOUT_MS = 0;

/** Task Edge 의미(kind)별 시각 스타일. v1.18
 * 엣지 상태 스타일(TASK_EDGE_STYLES)과 독립 — 색 hue는 kind에서, dash/animation은 status에서 온다.
 *
 * ⚠️ `label`·`description` 을 **화면에 그리지 마라.** 여기 값은 한국어라 12개 로케일 전부에
 * 한국어로 나갔었다(i18n 규칙 "다른 곳에서 문자열 import 해서 JSX 에 꽂기" 금지 항목).
 * 사람이 읽는 두 칸의 정본은 `bubbleMap.taskEdgeKind.<kind>.{label,description}` 이다.
 * 여기 남겨 두는 것은 코드에서 kind 를 식별할 때 쓰는 개발자용 이름 · 그리고 `color`/`icon` 때문이다. */
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
    color: '#A78BFA', // violet-400 — v1.41: 빨간 경고 → 보라 감시자로 변경 (비평은 위협이 아니라 관찰)
    label: 'Critique',
    description: '비평/리뷰 — 감사·레드팀 역할 (감시자)',
    // v1.41 — fisheye 기호. 이모지 대신 Unicode 기호를 써야 stroke color(violet-400)가 적용된다.
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

// ─── §7.11 v1.44 iframe 서버 로그 스트리밍 ───

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

// ─── §7.11 v2.1 죽은 iframe 위성 자동 제거 ───

/**
 * iframe 위성이 죽은(`iframeAlive===false`) 뒤 캔버스에서 자동 제거되기까지의 grace(ms).
 * checkIframesAlive 가 `Date.now() - BubbleData.iframeDeadAt` 이 이 값을 넘으면 위성을 제거.
 * 죽은 직후 잠깐은 dim 으로 남겨 사용자가 Restart 로 되살릴 여지를 준다.
 */
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
 * §3.2.4 ② — 서브에이전트 토큰 조회를 **동시에 몇 개까지** 겹칠지.
 *
 * 자체 턴이 비는 에이전트(커스텀이 그렇다)는 `/api/tokens` 가 서브 세션을 모두 뒤져 합산하는데,
 * 종전엔 그 조회가 순차라 서브가 20개면 갱신 한 번에 왕복이 20번 줄줄이 일어났다. 결과는 그대로
 * 두고 왕복만 겹친다(`mapWithConcurrency` 가 입력 순서를 보존한다).
 *
 * 무제한으로 풀지 않는 이유는 서버가 로컬 단일 프로세스라, 한꺼번에 쏟으면 오히려 메인 스레드가
 * 통째로 막히기 때문이다.
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

/**
 * §5.5 #17-28 — 텍스트 한 덩이의 추정 토큰. 서버(주입원 계측)와 클라(합계 표시)가 **같은 산식**을
 * 써야 화면과 프롬프트가 다른 숫자를 말하지 않는다.
 *
 * 바이트 기준인 것은 한글이 UTF-8 3바이트라 문자 수보다 바이트가 실제 토큰에 가깝기 때문이며,
 * 비율은 이미 쓰던 `TOKEN_BYTES_RATIO` 를 그대로 쓴다(새 산식을 들이면 화면마다 숫자가 갈린다).
 * 정확한 토크나이저가 아니라 **어림값**이다 — 화면은 `~` 를 붙여 그렇게 말한다.
 */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  // TextEncoder 는 Node 18+/브라우저 공통. 없으면 문자 수 기반으로 물러난다(테스트 환경 보호).
  const bytes = typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(text).length
    : text.length;
  return Math.round(bytes * TOKEN_BYTES_RATIO);
}

// ─── §5.5 #17-28 컨텍스트 주입원 통제 ───

/**
 * 주입원 안정 키. **저장되는 값**이므로 한 번 정하면 바꾸지 않는다(바꾸면 사용자가 꺼 둔 것이 되살아난다).
 * 목록 자체는 하드코딩이지만 **각 줄이 실제로 실리는지·얼마나 되는지는 매번 읽어서** 정한다 —
 * 고정된 것은 "무엇을 끌 수 있는가"의 어휘뿐이다.
 */
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
  /**
   * §5.10 — **자동 목표**가 싣는 줄. 폐기된 브레인 네 줄(카드·주제·규칙·스킬)을 이 한 줄이
   * 대신한다 — 네 갈래로 밀어넣던 것이 색인 하나로 접혔으니 끄는 스위치도 하나면 된다.
   *
   * 카드 본문을 밀어넣던 브레인과 달리 여기 실리는 것은 **이름과 한 줄 설명뿐**이라, 절차가 스무
   * 장이 있어도 프롬프트가 얇다(에이전트는 필요할 때 그 파일을 연다 — v3.74 가 "밀어넣기 ❌
   * 색인 ⭕" 로 옮겨간 그 결론을 스킬에 그대로 적용한 것). 자동 목표가 꺼져 있으면 0자다.
   */
  autoGoalSkills: 'vibisual.auto-goal.skills',
  /**
   * §5.26 (E) — 압축 뒤 **딱 한 턴만** 실리는 복원 브리핑(요약이 안 실은 것).
   *
   * 상시 블록이 아니라 사건 뒤 1회라서 평소 이 줄의 바이트는 0 이다. 그래도 표에 세운다 —
   * 우리가 프롬프트에 싣는 것 중 이 표에 없는 것이 있으면 그 표는 그 순간 거짓말을 시작한다.
   */
  compactRecovery: 'vibisual.compact-recovery',
  /** 훅으로 붙은 외부 세션에 매 턴 실리는 집행 블록(§5.11 v4.67). */
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
} as const;

/** 개별 플러그인 줄의 id 접두어 — `plugin:ssot-drift` 처럼 선다. */
export const CONTEXT_PLUGIN_ID_PREFIX = 'plugin:';

/**
 * §5.5 #17-28 ⑦ — 상세창이 한 번에 받는 본문의 상한(글자).
 *
 * 지시 파일은 수십 KB 가 예사라 전문을 그대로 실어 보내면 창이 멎는다. 잘린 것은 화면이 말해 주고
 * (`truncated`), 글자·토큰 숫자는 **자르기 전 전체 기준**으로 준다 — 표의 합계와 어긋나지 않게.
 */
export const CONTEXT_PREVIEW_MAX_CHARS = 60_000;

/** 위 상수의 값 목록(검증·테스트용). */
export const CONTEXT_SOURCE_ID_LIST: string[] = Object.values(CONTEXT_SOURCE_IDS);

/**
 * `control: 'spawn'` 인 줄을 실제로 끄는 수단.
 *
 * 헤드리스 경로는 **매 턴 새 프로세스**를 띄우므로(`--resume` 도 새 spawn 이다) 여기 적힌 인자·환경변수는
 * 다음 프롬프트부터 곧바로 먹는다 — "끄면 다음 프롬프트에 안 실린다"가 성립하는 근거다.
 *
 * 값은 Claude Code CLI 가 실제로 읽는 이름이다(`claude --help` + 배포 바이너리 확인, 2.1.223 기준).
 * 판본이 바뀌어 이름이 사라져도 **모르는 환경변수는 무시**되므로 스폰이 깨지지 않는다.
 */
export const CONTEXT_SPAWN_SWITCHES: Record<string, { env?: string; flag?: string }> = {
  [CONTEXT_SOURCE_IDS.claudeMd]: { env: 'CLAUDE_CODE_DISABLE_CLAUDE_MDS' },
  [CONTEXT_SOURCE_IDS.autoMemory]: { env: 'CLAUDE_CODE_DISABLE_AUTO_MEMORY' },
  [CONTEXT_SOURCE_IDS.slashCommands]: { flag: '--disable-slash-commands' },
  [CONTEXT_SOURCE_IDS.bundledSkills]: { env: 'CLAUDE_CODE_DISABLE_BUNDLED_SKILLS' },
  [CONTEXT_SOURCE_IDS.workflows]: { env: 'CLAUDE_CODE_DISABLE_WORKFLOWS' },
  [CONTEXT_SOURCE_IDS.gitInstructions]: { env: 'CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS' },
};

/**
 * 통제 층의 정본 순서 — **위(넓음) → 아래(좁음)**. 상속 사슬을 도는 코드는 전부 이 배열만 본다
 * (층이 또 늘면 여기 한 줄과 아래 표만 고치면 된다).
 */
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
 * **최종 판정 한 곳** — 세션 > 에이전트 > 프로젝트 > 기본값.
 *
 * 서버(주입 게이트)와 클라(화면 표시)가 이 함수를 함께 쓴다. 판정이 두 벌이 되면
 * "화면엔 꺼져 있는데 프롬프트엔 실리는" 상태가 생기고, 그것이 이 기능의 유일한 실패 방식이다.
 *
 * `level` 은 **어느 층에서 내려다본 값인가**다. 기본값 `'session'` 은 실제로 프롬프트에 실리는
 * 최종값이고, `'project'`/`'agent'` 를 주면 그 층보다 **아래는 보지 않는다** — 화면이 "프로젝트
 * 층에서 이 줄은 켜져 있다"를 그릴 때 쓰는 값이 그것이다. 아래층을 섞어 그리면 위층 스위치를
 * 눌러도 안 움직이는 것처럼 보인다.
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

/**
 * 그 층에 **명시적으로** 걸린 값(없으면 undefined = 위에서 물려받는 중).
 *
 * "이 층에서 되돌리면 명시값을 지운다"(설정이 쌓이지 않게)와 "위층을 보는 동안 아래층이 따로
 * 정해 뒀다"를 화면이 판정하는 근거다. 판정 자체는 하지 않는다 — 판정은 위 한 함수뿐이다.
 */
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

/**
 * 이 층에서 명시값을 지웠을 때 **물려받게 될 값** — 곧 "여기서 아무것도 안 정했을 때의 값"이다.
 *
 * 토글이 이 값과 같아지는 순간 명시값을 저장하지 않고 지운다(되돌리기 = 삭제). 이걸 `defaultEnabled`
 * 로 대신 재던 것이 종전 결함이었다 — 프로젝트에서 끈 줄을 세션에서 다시 켜면 "기본값과 같다"는
 * 이유로 세션 명시값이 지워져, 도로 프로젝트의 끔으로 굴러떨어졌다(= 아래층이 위층을 못 이겼다).
 */
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

// ─── Comment Box (언리얼 블프 스타일 주석) v1.45 ───

/**
 * Comment Box 기본값 / 동작 파라미터.
 * SSOT §3.3 — 매직넘버 금지. 크기·색·폰트·풍선 LOD 임계치는 여기서만.
 */
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

/**
 * LOD — React Flow zoom 값에 따라 라벨 렌더 모드 전환.
 * 줌아웃(< BALLOON_BELOW) 시 박스 외부 상단에 풍선(pill) 라벨을 크게 띄워 읽기 보존.
 * 줌인(≥ NORMAL_ABOVE) 시 박스 내부 헤더 텍스트 정상 표시.
 * 중간 구간은 헤더 그대로 표시(풍선 없음).
 */
export const COMMENT_BOX_LOD = {
  /** 이 zoom 미만이면 외부 풍선 라벨 표시. */
  BALLOON_BELOW: 0.55,
  /** 풍선 폰트는 zoom 이 작을수록 상대적으로 커짐 — 스크린 고정 사이즈로 렌더하기 위해 1/zoom 비율 사용. */
  BALLOON_SCREEN_FONT_PX: 18,
  /** 풍선 최대 글자 수 (넘으면 ellipsis). */
  BALLOON_MAX_CHARS: 80,
} as const;

/**
 * §4 v3.71 가시성 LOD — "안 보이면 안 그린다".
 *
 * 여기서 말하는 '안 보임'은 **화면 밖(뷰포트 이탈)과 전면 오버레이에 가려짐** 두 가지뿐이다.
 * 줌아웃은 '안 보이는' 게 아니라 '멀리서 보는' 것이므로 이펙트·정보를 빼지 않는다
 * (줌 티어로 장식을 생략하던 초안은 사용자 정정으로 철회 — 줌아웃해도 보이던 건 그대로 보여야 한다).
 */
export const CANVAS_LOD = {
  /** 뷰포트 밖 노드·엣지를 아예 렌더하지 않는다(React Flow onlyRenderVisibleElements). */
  CULL_OFFSCREEN: true,
} as const;

/**
 * §5.4 #31 **연결 무리 강조** — Ctrl/Cmd 를 쥔 채 에이전트 버블을 잡았을 때의 표시 값.
 *
 * **색을 새로 칠하지 않는다.** 캔버스에는 이미 카테고리 색이 15종 있어서(§2.2) 강조에 또 하나를
 * 들이면 그 색이 "무슨 종류인가"로 읽힌다 — 무리는 종류가 아니라 **지금 잡은 것**이라 오래 남지
 * 않는 표시다. 그래서 위계를 **밝기와 흰 빛**으로만 만든다: 무리 밖은 물러나고(투명도·탈색),
 * 무리 안은 흰 테두리로 떠오르며, 중심은 같은 모양을 한 단계 강하게 쓴다.
 *
 * **크기(scale)는 건드리지 않는다** — 엣지 끝점이 노드의 실측 지오메트리(`measured`)로 계산되는데
 * transform 은 그 값을 바꾸지 않아서, 버블만 커지고 화살표는 제자리에 남아 어긋난다.
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
  /**
   * 미리보기(Ctrl 만 쥐고 위에 올려 둔 상태)의 세기(곱).
   *
   * 아직 아무것도 잡지 않았으므로 확정과 같은 세기로 번쩍이면 "이미 뭔가 일어났다"로 읽힌다.
   * 물러나는 쪽은 덜 물러나고, 떠오르는 쪽은 덜 떠오른다.
   */
  HOVER_STRENGTH: 0.55,
  /** 무리 밖 엣지의 불투명도(곱). 버블보다 더 물러난다 — 선이 남아 있으면 시야가 어지럽다. */
  EDGE_DIM_OPACITY: 0.12,
  /** 무리 안 엣지 굵기(곱)와 불투명도. */
  EDGE_LIT_WIDTH: 1.7,
  EDGE_LIT_OPACITY: 1,
} as const;

/**
 * §5.4 #33 **버블 정리** — 위에서 아래로 앉는 띠(칸)의 순서.
 *
 * 순서의 뜻은 "지금 봐야 하는 급한 정도"다 — 도는 것이 맨 윗 줄, 손이 가야 하는 것이 그다음,
 * 쉬는 것과 자리(폴더)가 아래. 종류가 아니라 **상태**가 앞자리를 정하는 이유는, 캔버스를 보는
 * 이유가 "무엇이 있나"가 아니라 "무엇이 지금 움직이나"이기 때문이다.
 *
 * **새 띠는 여기 한 줄 추가로만.** 배치 함수는 이 배열을 순회할 뿐 띠 이름을 알지 못한다(§3.3).
 */
export const TIDY_BAND_ORDER: readonly TidyBand[] = ['running', 'attention', 'waiting', 'folder', 'other'];

/**
 * §5.4 #33 **버블 정리** 배치 값.
 *
 * 간격은 물리(`MAGNET_GAP`=12 · `REPULSION_RANGE`=120)보다 넉넉해야 한다 — 물리가 다시 밀어내면
 * 정리한 모양이 손을 떼자마자 풀린다. 정리는 물리를 끄는 것이 아니라 **물리가 할 일이 없는 자리**에
 * 놓아 두는 일이다.
 */
export const TIDY_LAYOUT = {
  /**
   * 이웃 버블 사이에 두는 간격(px) — 같은 고리에서든 **같은 줄에서든** 같은 값이다.
   * 세 간격(`RING_GAP` < `ROW_GAP` … < `BAND_GAP`)의 크기 차이가 곧 "이건 이웃 / 이건 같은 칸의
   * 다음 줄 / 이건 다른 칸"이라는 세 단계로 읽힌다(§5.4 #33 (C)).
   */
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
  /**
   * §5.4 #33 (I) 덩어리 기하 — 무리와 무리 사이에 두는 간격(px). 띠 간격(`BAND_GAP`)보다
   * 넓다. 동심 띠는 고리라는 모양 자체가 "여기서 갈렸다"를 말해 주지만, 덩어리는 빈 자리
   * 말고는 경계를 말할 것이 없기 때문이다.
   */
  CLUSTER_GAP: 130,
  /**
   * §5.4 #33 (I-2) 연속값(열·최근)을 자를 분위 수. 절대 기준으로 자르면 프로젝트마다 전부
   * 한 칸에 몰린다 — 순위로 자르면 어떤 분포가 와도 다섯 칸이 고르게 찬다(§5.24 `quantile`
   * 곡선과 같은 논리). `TIDY_BAND_ORDER` 가 다섯인 것과 우연히 같은 수가 아니다: 기준을
   * 바꿔도 칸 수가 같아야 지도의 크기가 튀지 않는다.
   */
  QUANTILE_BUCKETS: 5,
  /**
   * §5.4 #33 (I-5) 줄 세우기 — 한 줄이 캔버스 바운딩 박스(§3.3 `layoutBounds`)의 이 비율까지만
   * 쓴다. 상자를 넘겨 앉히면 (B) 가 말한 물리 클램프에 도로 눌려 정리한 모양이 앉자마자 망가진다.
   */
  LANE_FILL: 0.92,
} as const;

/**
 * §5.4 #33 (I) **버블 정리 — 기준 다섯.** 순서가 곧 패널에 서는 순서다.
 *
 * `geometry` 가 `TidySort` 와 별개 축인 것이 이 표의 핵심이다 — 순위가 있는 기준(`status`·
 * `heat`·`recent`)은 **줄 세우기**로 "위·왼쪽이 더 급한/뜨거운/최근"을 말하고, 순위가 없는 분류
 * (`kind`·`lineage`)는 덩어리로 앉아 뜻 없는 서열을 만들지 않는다. 자세한 근거는 SSOT
 * §5.4 #33 (I-1).
 *
 * **새 기준은 여기 한 줄 추가로만.** 배치 함수는 이 표를 읽을 뿐 기준 이름을 알지 못한다(§3.3).
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

/**
 * §5.9 화면/프로그램 캡처 버블 기본값. CommentBox 처럼 캔버스 독립 요소이므로 절대좌표 배치.
 * 16:9 비율의 네모난 라이브 영상 본체가 기본.
 *
 * v3.56 색 개편 — 종전엔 rose-500(#F43F5E) 한 색이 "캡처 정체성"이라며 **테두리 2px + 헤더 전체 +
 * 창 타이틀바**를 통째로 칠했다. 라이브 영상 위에 채도 높은 분홍 색면이 얹혀 화면과 색이 싸우고
 * 값싸 보이던 원인. 이제 크롬(테두리·헤더·타이틀바)은 **무채색 그래파이트 글라스**로 물러나 영상이
 * 주인공이 되고, 색은 **의미 있는 최소 단위에만** 쓴다 — 라이브 도트(붉은 녹화등) / 선택 링(스카이) /
 * 조작 중 링(에메랄드, 기존 규칙 유지).
 */
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

/**
 * §5.9 캡처 버블 **이어 붙이기(자석 스냅)** — 화면 버블 2~3개를 듀얼/트리플 모니터처럼
 * 나란히 붙여 쓰기 위한 값들. 임계값은 **화면 픽셀** 기준이라 실제 판정 때 줌으로 나눠
 * 캔버스 단위로 바꾼다(줌을 당겨도 손끝 감각이 같게).
 */
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

/**
 * §5.9 캡처 버블 **플레이테스트(녹화 + 구간 프레임 첨부)** — 만든 빌드를 앱 안에서 직접 플레이해
 * 보다가, 버그가 난 그 구간을 프레임째 에이전트에게 넘기기 위한 값들.
 *
 * 영상은 렌더러 메모리(Blob)에만 살고 서버·WS·체크포인트를 타지 않는다(§5.9 렌더러 전용 원칙).
 * 그래서 상한이 곧 안전장치다 — 길이(자동 정지)와 개수(오래된 것부터 폐기) 둘 다 여기서 온다.
 */
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

/**
 * UE 블프 풍 팔레트 — CommentBoxDetail 색 버튼 소스.
 * hex 는 태그 구분 색(Amber/Rose/Emerald/Blue/Violet/Pink/Teal/Slate) 으로 시각 다양성 확보.
 */
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

/**
 * 스티키 메모 기본값 / 상한. SSOT §3.3 — 매직넘버 금지. 크기·글자수·장수는 여기서만.
 *
 * 상한이 둘인 이유(§3.2.3 "쓸수록 커지는 것에 상한") — **글자 길이**(`TEXT_MAX`)만 막으면 장수로,
 * **장수**(`MAX_PER_OWNER`)만 막으면 길이로 무한히 자란다. 두 축을 함께 막아야 체크포인트가 붓지 않는다.
 */
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
  /**
   * 이름 상한 (자). 제목줄에 들어가는 한 줄이라 본문과 상한이 다르다 — 화면에서는 폭에 맞춰
   * `…` 로 줄지만(CSS), **저장까지 무한히 길어지면 안 된다**(§3.2.3 "쓸수록 커지는 것에 상한").
   */
  NAME_MAX: 60,
  /** 한 세션(또는 메인 탭)이 가질 수 있는 메모 장수 상한. */
  MAX_PER_OWNER: 24,
  /** 좌표 상한 (px) — 창 밖 좌표가 들어와도 여기서 멈춘다(복원 시 화면 밖 실종 방지). */
  MAX_COORD: 20000,
  /** 같은 자리에 겹쳐 만들 때 계단식으로 밀어 놓는 간격 (px). [펼치기]가 자리를 찾는 격자도 이 눈금이다. */
  CASCADE_STEP: 18,
  /**
   * 손이 올라간 카드를 **잠시** 맨 앞으로 올릴 때 쓰는 z. 장수 상한(24)보다 한참 위라 어떤 카드보다
   * 앞에 서고, 판(`z-[15]`) 안에서만 유효하므로 IDE 크롬(검색바·줌 배지)을 가리지 않는다.
   * 저장되는 값이 아니다 — **겹쳐 둔 순서는 그대로 두고 보기만 바꾸는** 것이 이 값의 요점이다.
   */
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
} as const;

/**
 * 스티키 메모 팔레트 — **앱과 같은 색 언어**다. IDE 본문이 `bg-gray-950` 인 어두운 화면이라
 * 밝은 파스텔 종이는 그 위에서 혼자 튀는 이물이었다. 지금은
 * `COMMENT_BOX_PALETTE` 와 **같은 색상 계열의 깊은 판**이고, 불투명도(`SessionMemo.alpha`)를
 * 얹어 아래 대화가 비치는 유리로 읽힌다. 글자색은 여전히 자동이다 — 다만 판정 기준이 색 자체가
 * 아니라 **알파를 섞어 실제로 보이는 색**이라(`memoSurface`), 밝은 종이 한 칸(`paper`)을
 * 골라도 대비가 무너지지 않는다.
 */
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

/**
 * 옛 파스텔 팔레트 → 새 팔레트 이관표.
 *
 * 색을 갈아엎으면 **이미 붙여 둔 메모만 옛 색으로 남는다** — 사용자에게는 "고쳤다더니 내 메모는
 * 그대로"로 보이고, 되돌릴 방법도 한 장씩 다시 고르는 것뿐이다. 그래서 정화 단계에서 한 번
 * 갈아 끼운다(옛 8칸은 스와치로만 고를 수 있었으므로 **이 8개 값은 전부 우리가 넣은 것**이다 —
 * 사용자가 손으로 고른 자유색을 덮어쓸 위험이 없다). 키는 대문자 `#RRGGBB`.
 */
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
 * 불투명도 정화 — 눈금(`ALPHA_STEP`)에 맞춘다. 좌표(`clampNumber`)와 달리 **정수로 반올림하면
 * 안 되고**, 눈금을 곱해서도 안 된다: `Math.round(0.82 / 0.01) * 0.01 === 0.8200000000000001` 이라
 * 기본값과 같은 값이 "다르다"로 판정돼, 기본값을 생략하는 규약이 조용히 무너진다(저장 왕복 비교도
 * 영영 안 맞는다). 그래서 **나눗셈으로** 자릿수를 맞춘다.
 */
function clampMemoAlpha(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return SESSION_MEMO.DEFAULT_ALPHA;
  const clamped = Math.max(SESSION_MEMO.MIN_ALPHA, Math.min(SESSION_MEMO.MAX_ALPHA, v));
  const scale = Math.round(1 / SESSION_MEMO.ALPHA_STEP);
  return Math.round(clamped * scale) / scale;
}

/**
 * 메모 이름 정화 — **한 줄로 접고**, 앞뒤 공백을 떼고, 상한까지 자른다. 빈 값이면 `''`(= 필드 없음).
 *
 * ⚠ 화면과 서버가 **같은 함수**를 써야 한다. 카드가 올린 이름과 서버가 정화한 이름이 한 글자라도
 * 다르면 낙관 표시의 왕복 비교(`SessionMemoLayer.pushedRef`)가 영영 안 맞아, 그 판의 메모가
 * 다른 창의 변경을 다시는 따라가지 못한다. 그래서 이 규칙은 클라에 복제하지 않고 여기 하나만 둔다.
 *
 * 줄바꿈·탭을 공백 하나로 접는 것도 의도다 — 제목줄은 한 줄이라, 개행이 들어오면 저장값과 보이는
 * 값이 어긋난다(붙여넣기 한 번으로 쉽게 들어온다).
 */
export function normalizeMemoName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  return oneLine.length > SESSION_MEMO.NAME_MAX ? oneLine.slice(0, SESSION_MEMO.NAME_MAX).trim() : oneLine;
}

/**
 * §5.5 #17-36 — 신뢰할 수 없는 입력(REST body·옛 체크포인트)에서 메모 1장을 안전하게 복원한다.
 * 모양이 어긋나면 `null`(= 그 장은 버린다). `sanitizeCmdPaneTree` 와 같은 자리·같은 규약이다.
 */
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
  // 묶음 이름표는 id 와 같은 모양만 통과 — 임의 문자열이 그룹 키·DOM 속성으로 새지 않게.
  const rawGroup = typeof n['groupId'] === 'string' ? n['groupId'].trim() : '';
  const groupId = /^[\w-]{1,64}$/.test(rawGroup) ? rawGroup : '';
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
    ...(groupId ? { groupId } : {}),
    ...(groupId && n['groupActive'] === true ? { groupActive: true } : {}),
    createdAt,
    updatedAt: clampNumber(n['updatedAt'], 0, Number.MAX_SAFE_INTEGER, createdAt),
  };
}

/**
 * 메모 목록 정화 — 장수 상한 + id 중복 제거. 배열이 아니면 빈 목록.
 * 중복 id 를 남기면 한 장을 지웠는데 다른 장이 사라지는 것처럼 보인다(React key 충돌).
 */
export function sanitizeSessionMemos(input: unknown): SessionMemo[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: SessionMemo[] = [];
  for (const raw of input) {
    const memo = sanitizeSessionMemo(raw);
    if (!memo || seen.has(memo.id)) continue;
    seen.add(memo.id);
    out.push(memo);
    if (out.length >= SESSION_MEMO.MAX_PER_OWNER) break;
  }
  return repairMemoGroups(out);
}

/**
 * 합쳐진 묶음의 **무결성 보정** — 정화의 마지막 단계다. 고치는 것 셋.
 *  ① **혼자 남은 묶음은 묶음이 아니다** — 이름표를 지운다. 탭이 하나뿐인 탭 줄은 화면에서
 *    "왜 여기만 다르게 생겼지"가 되고, 마지막 장이 빠진 뒤 그 상태로 저장되는 일이 실제로 생긴다
 *    (장수 상한에 걸려 뒷장이 잘렸을 때 · 옛 판본이 저장했을 때 · 다른 창이 동시에 지웠을 때).
 *  ② **활성 탭은 묶음당 정확히 하나** — 없으면 마지막 장을 세우고(빈 카드 ❌), 여럿이면 마지막
 *    하나만 남긴다. 이 보정이 없으면 "탭은 3개인데 본문이 안 보이는 카드"가 나오는데, 화면에는
 *    고장으로 보이고 원인은 파일 안에 있다.
 *  ③ **묶음 안의 자리·크기는 활성 장을 따른다** — 한 카드로 그려지므로 멤버끼리 좌표가 다르면
 *    어느 것을 믿을지 규칙이 없다. 활성 장 하나를 정본으로 삼아 나머지를 맞춘다.
 *
 * 값이 하나도 안 바뀌면 **같은 배열**을 돌려준다(저장 왕복 비교가 흔들리지 않게).
 */
export function repairMemoGroups(memos: SessionMemo[]): SessionMemo[] {
  const members = new Map<string, SessionMemo[]>();
  for (const m of memos) {
    if (!m.groupId) continue;
    const list = members.get(m.groupId);
    if (list) list.push(m);
    else members.set(m.groupId, [m]);
  }
  if (members.size === 0) return memos;

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


// ─── Canvas Clipboard (§5.4 #29 v1.51) ───

/** localStorage key — Vibisual 내부 클립보드 단일 슬롯. 시스템 클립보드와 분리. */
export const CANVAS_CLIPBOARD_STORAGE_KEY = 'vibisual.canvasClipboard';

/** CanvasClipboardPayload 의 schemaVersion. paste 시 일치 가드(불일치 페이로드 거부). */
export const CANVAS_CLIPBOARD_SCHEMA_VERSION = 1 as const;

/** 마우스 좌표 미상 시 fallback offset(원본 좌표에서 우측-아래로 이만큼 옮겨 표시). */
export const CANVAS_CLIPBOARD_DEFAULT_PASTE_OFFSET = 40;


// ─── 자동 업데이트 (§4 v2.44) ───

/**
 * 자동 업데이트 주기 체크 간격 (ms). desktop main 의 updaterManager 는 부팅 직후(윈도우가
 * 뜬 뒤 ~10s)에 첫 체크를 1회 하고, 그 다음부터 이 간격으로 반복 체크한다. 4시간 — 너무
 * 잦으면 GitHub API 부담·네트워크 노이즈, 너무 드물면 새 릴리스 인지가 늦다.
 */
export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * 업데이트 피드를 우리 프록시로 받을 주소. **비어 있으면 종전대로 GitHub 을 직접 본다.**
 *
 * 프록시(`infra/update-proxy/`)를 배포한 뒤 그 주소를 여기 한 줄 적으면, 다음 빌드부터
 * 앱이 그쪽으로 업데이트를 묻는다 — 그 요청 수가 곧 "돌고 있는 설치 수"다. 받는 파일과
 * 무결성 검사는 그대로다(프록시는 yml 을 넘겨주고 설치 파일은 GitHub 으로 302).
 *
 * 채택 규칙과 안전장치(https 강제·닿지 않으면 GitHub 폴백)는 `updateFeed.ts` 에 있다.
 * 실행 시 `VIBISUAL_UPDATE_FEED_URL` 로 덮어쓸 수 있다(자체 호스팅·시험용).
 */
export const UPDATE_FEED_URL = '';

/**
 * 프록시가 살아 있는지 확인할 때 기다리는 시간 (ms). 넘기면 GitHub 기본 피드로 간다.
 * 짧게 잡는다 — 이 대기는 첫 업데이트 확인을 그만큼 늦추는데, 업데이트 확인은 급한 일이
 * 아니지만 **프록시가 죽었을 때 사용자를 기다리게 하는 것**은 그냥 손해다.
 */
export const UPDATE_FEED_PROBE_TIMEOUT_MS = 4000;

// ─── 진단 에러 로그 (§4 v1.98) ───

/** 서버 diagnosticService ring buffer 최대 보관 건수. 초과 시 가장 오래된 것부터 제거. */
export const DIAGNOSTIC_LOG_MAX = 200;

// ─── 클라 스트림 이벤트 누적 상한 (성능: 장시간 세션 메모리/렌더 폭증 방지) ───

/**
 * 한 서브에이전트 세션의 subAgentStreams[sessionId] 가 클라 메모리에 보관하는 최대 이벤트 수.
 * 장시간 세션에서 토큰 단위 스트림이 무한 누적되면 메모리 + 빌드/렌더 비용이 선형으로 커진다.
 * 초과분은 가장 오래된 이벤트(화면 최상단, 스크롤 위쪽)부터 잘라 항상 최근 N개만 유지한다.
 * (표시 전용 버퍼 — tool_use↔tool_result 페어링은 화면 표시용이라 오래된 잔여물 손실 허용.)
 */
export const STREAM_EVENTS_MAX_PER_SESSION = 4000;

/**
 * 활성 세션 버퍼를 상한(STREAM_EVENTS_MAX_PER_SESSION) 초과 시 **매번 앞을 1개씩** 미는 대신,
 * 이 여유(slack)를 넘겼을 때만 한 번에 cap 으로 되돌린다(히스테리시스).
 *
 * 성능(v3.10): StreamRenderer 의 증분 파서는 "직전 소비분의 순수 꼬리-확장"일 때만 신규 이벤트만
 * 처리한다. 상한에 도달한 뒤 append 마다 앞을 1개씩 잘라내면 배열이 매 틱 앞으로 밀려(순수 append 가
 * 아니게 되어) 증분이 깨지고 매번 전체 재구축으로 폴백 → 긴 세션에서 다시 O(전체)가 된다. slack 만큼
 * 여유를 두면 절단은 slack 개마다 1회(그때만 전체 재구축) → 그 사이 slack 개는 순수 append 로 증분이
 * 살아난다. 절단 1회 비용을 slack 개 이벤트에 분산 → 평균 O(1). (여유분 만큼만 메모리 소폭 증가.)
 */
export const STREAM_EVENTS_TRIM_SLACK = 512;

/**
 * 현재 IDE 에서 보고 있지 않은 비활성 세션의 클라 스트림 버퍼 상한.
 * 비활성 세션은 화면에 렌더되지 않으므로 메모리 절약을 위해 훨씬 작게 유지한다.
 * 세션 수가 많을 때 4000×N 으로 무한 누적되던 것을 차단한다.
 * 사용자가 세션을 다시 열면 서버 버퍼(/api/subagent-streams/:agentId)에서 복구되므로 표시 손실 없음(서버=SSOT).
 */
export const STREAM_EVENTS_MAX_PER_INACTIVE_SESSION = 300;

/**
 * 클라 메모리에 비활성 스트림 버퍼를 통째로 유지할 세션 수 상한.
 * 이 수를 넘는 비활성 세션(마지막 수신 기준 가장 오래된 것부터)은 버퍼를 통째로 삭제한다.
 * 해당 세션을 다시 열면 서버 버퍼(/api/subagent-streams/:agentId)에서 자동 복구.
 */
export const STREAM_INACTIVE_SESSIONS_MAX = 20;

// ─── 서버 코어 로그 뷰어 (§7.7 v1.99) ───

/** 서버 serverLogService ring buffer 최대 라인 수. 초과 시 가장 오래된 것부터 제거. */
export const SERVER_LOG_BUFFER_MAX = 1000;
/** 클라 ServerLogPopup ring buffer 최대 라인 수 (팝업 렌더 메모리 상한). */
export const SERVER_LOG_CLIENT_BUFFER_MAX = 2000;
/** 새 로그 라인 델타 push 마이크로배치 간격 (ms) — 폭주 보호. */
export const SERVER_LOG_BATCH_MS = 50;
/** ServerLogPopup "최근 N줄만" 토글 ON 시 렌더할 최근 라인 수 (§7.7 v2.3) — DOM 비용 고정. */
export const SERVER_LOG_RECENT_VIEW_LIMIT = 200;

// ─── §5.3 #10-2 v2.37 — Auto Agent (메타 에이전트) ───

/**
 * Auto Agent 가 spawn 한 서브 커스텀 에이전트들을 본인 주변에 원형 배치할 때의 반지름 (px).
 * 너무 좁으면 겹치고, 너무 넓으면 화면 밖. 일반 캔버스 viewBox 가정.
 */
export const AUTO_AGENT_LAYOUT_RADIUS = 280;

/**
 * Auto Agent 가 high 복잡도 판정 시 발사할 명확화 질문 최대 개수.
 * 너무 많으면 사용자 인내심 소진, 너무 적으면 정보 부족.
 */
export const AUTO_AGENT_MAX_CLARIFYING_QUESTIONS = 3;

/**
 * 역할별 기본 AgentConfig 정책 — SCENARIO §5.3 #10-2 의 "역할 카탈로그" 테이블 SSOT.
 * Auto Agent 가 서브 에이전트 spawn 시 이 값을 `setAgentConfig` 로 즉시 적용.
 * 새 역할 추가 시 여기 한 줄 + `AutoAgentRole` 유니온 한 줄.
 */
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
  // ── v2.46 — OMO(oh-my-openagent) 전문가 archetype 차용 ──
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

// ─── §5.3 #10-2 v2.45 — 하네스 빌더 에이전트 ───

/**
 * Auto Agent 가 "하네스 빌더"로 스폰될 때 자신에게 적용하는 AgentConfig.
 * - 빌더는 loopback REST 를 Bash(curl) 로 자율 호출해야 하므로 bypassPermissions.
 * - 프로젝트를 살펴 최적 하네스를 설계하기 위해 Read/Grep/Glob, 필요 시 Agent.
 * - 직접 코드 작업은 하지 않으므로 Write/Edit 는 제외(빌더가 *만드는* 서브가 수행).
 * - 모호 요청 인터뷰가 필요하면 런타임이 tools 에 'AskUserQuestion' 을 추가한다(askQuestionsEnabled).
 */
export const AUTO_AGENT_BUILDER_CONFIG: Partial<AgentConfig> = {
  model: 'opus',
  effort: 'high',
  permissionMode: 'bypassPermissions',
  tools: ['Bash', 'Read', 'Grep', 'Glob', 'Agent'],
  color: '#1E3A8A',
  maxTurns: 0,
};

/**
 * 빌더가 인터뷰(명확화 질문)를 할 수 있도록 추가하는 도구.
 * 런타임이 askQuestionsEnabled 면 builder tools 에 합친다.
 */
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
 * §5.3 #10-2 v2.45 — 스폰된 하네스 빌더 에이전트에게 주입할 시스템 규칙(rules).
 *
 * 빌더는 이 규칙 + 사용자 원본 요청(별도 task 본문)을 받아, 아래 loopback REST API 를
 * Bash(curl) 로 호출해 사용자 의도에 맞는 멀티-에이전트 하네스(버블 + Task Edge)를
 * 캔버스에 직접 구축하고, 엔트리 에이전트에 사용자 요청을 forward 한다.
 *
 * 동적 값(serverBase=hook loopback 포트, 배치 중심 좌표, 프로젝트명)은 서버 런타임이 주입.
 */
export function buildHarnessBuilderRules(args: {
  serverBase: string;
  serverToken: string;
  centerX: number;
  centerY: number;
  layoutRadius?: number;
  projectName: string | null;
}): string {
  // `serverToken` 은 더 이상 본문에 굽지 않는다 — 빌더 curl 은 `$VIBISUAL_TOKEN`(env)을 읽는다.
  //   인자는 호출부 호환을 위해 남겨 두되 여기서 꺼내지 않는다(프롬프트에 토큰을 다시 넣지 마라).
  const { serverBase, centerX, centerY, projectName } = args;
  const radius = args.layoutRadius ?? AUTO_AGENT_LAYOUT_RADIUS;
  const projectField = projectName ? `"${projectName}"` : 'null';
  const toolList = AVAILABLE_AGENT_TOOLS.join(', ');

  return `# 역할: Vibisual 하네스 빌더 (Harness Architect)

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
| quick-fix | 파일/함수 지목 + 단순 수정 | 단일 coder (또는 explore→coder) |
| feature | 새 기능·다중 단계 | pm 허브 + (architect)+coder+tester+reviewer |
| research | "조사/비교/알아봐" | librarian + explore + researcher → 요약 |
| debug | "안 돼/버그/원인" | oracle(원인 분석) → coder(수정) → tester |
| refactor | "리팩터링/정리/구조 개선" | explore(현황) → architect(설계) → coder → reviewer |
분류 결과를 짧게 밝힌 뒤 설계로 넘어간다.

## 작업 절차 (순서대로)
1. **요청 파악**: 위 IntentGate 로 유형을 정하고, (필요하면) 프로젝트를 Read/Grep/Glob 으로 빠르게 살펴 범위를 잡는다.
2. **(모호하면) 인터뷰**: AskUserQuestion 도구가 주어졌다면, 산출물 형태·우선순위·범위가 불분명할 때 1~3개 질문으로 좁힌다. 명확하면 건너뛴다.
3. **하네스 설계**: 몇 개의 어떤 역할이 필요한지, 각 역할에 어떤 모델·도구·권한이 적합한지, 누가 누구에게 위임하는지(엣지) 결정. 단순 작업은 1개로 충분, 복잡하면 PM 허브 + 워커 + 리뷰어. **고정 틀에 끼워맞추지 말고 요청에 맞춰 새로 설계**한다.
4. **버블 생성**: 역할마다 \`POST /api/create-custom-agent\` 호출 → 응답의 \`agent.id\`(설정/엣지용)와 \`agent.path\`(엔트리 kickoff용 sessionId)를 반드시 캡처.
5. **설정 주입**: 버블마다 \`PUT /api/agent-config/:agentId\` 로 model/tools/permissionMode/effort/rules 배정. rules 에는 그 에이전트의 역할·산출물 형식을 또렷이 적는다.
6. **엣지 연결**: 의존 관계대로 \`POST /api/task-edges\` 로 연결. **코드를 변경하는 작업이면 검증 엣지를 반드시 포함**(바로 아래 "검증 엣지" 절 참고).
7. **엔트리 기동**: 시작점(=오케스트라) 에이전트의 sessionId 로 \`POST /api/commands/:sessionId\` 에 **사용자 원본 요청**을 forward(text/plain).
8. **마무리 보고**: 만든 버블·엣지·각자의 역할을 2~5줄로 요약하고, **"이후 추가 명령은 〈엔트리 버블 라벨〉 버블에 입력하세요"** 를 명시(사용자가 어느 버블을 오케스트라로 다룰지 알도록). (당신은 여기서 종료 — 실제 작업은 서브들이 이어간다.)

## 검증 엣지 — 코드 변경 시 필수 (v2.48)
- **코드를 변경하는 의도**(feature / refactor / debug / 파일 쓰기를 동반하는 quick-fix)면, reviewer 또는 tester 에서 coder 로 향하는 **검증 엣지를 최소 1개** 반드시 깐다. \`kind:"critique"\`, \`critiqueAuthority:"force-rework"\` 로 만들면, 리뷰어의 \`REJECT\` 나 테스터의 빌드/테스트 실패가 **자동으로 coder 재작업으로 라우팅**된다(서버가 짝(auto-rework) 엣지를 자동 생성).
- 권장 형태: coder → reviewer(리뷰), tester → coder(\`critique+force-rework\`), reviewer → coder(\`critique+force-rework\`). 즉 "만들고 → 검증하고 → 실패하면 되돌아가 고친다" 루프를 엣지로 구성.
- **예외**: 읽기 전용 조사(research), 단순 질의, 파일을 쓰지 않는 초소형 작업은 검증 엣지 불필요.

## REST API (서버 베이스: \`${serverBase}\`)
모든 호출은 Bash(curl)로. JSON 본문은 heredoc 으로 보내 escape 부담을 줄인다. node(v20)가 항상 있으니 응답 파싱은 node 로.
**인증 필수**: 모든 구축 호출에 헤더 \`-H "x-vibisual-hook-token: $${AGENT_CARD_ENV_TOKEN}"\` 를 반드시 붙인다(이게 없으면 401). 값은 환경변수에 이미 들어 있으니 아래 예시를 그대로 쓰면 된다 — **토큰 값을 본문에 옮겨 적지 마라**(대화 기록에 남아 다른 세션이 회상으로 주워 간다).

### 1) 버블 생성
\`\`\`bash
RESP=$(curl -s -X POST "${serverBase}/api/create-custom-agent" \\
  -H "x-vibisual-hook-token: $${AGENT_CARD_ENV_TOKEN}" \\
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"label":"Coder","x":${Math.round(centerX + radius)},"y":${Math.round(centerY)},"project":${projectField}}
JSON
)
AGENT_ID=$(printf '%s' "$RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);process.stdout.write(o.agent.id)})")
AGENT_PATH=$(printf '%s' "$RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);process.stdout.write(o.agent.path)})")
\`\`\`
- 응답: \`{ ok:true, agent:{ id, label, path, position, ... } }\`. \`id\`=설정/엣지용, \`path\`=세션(=kickoff용).

### 2) 설정 주입 (model/effort/rules)
\`\`\`bash
curl -s -X PUT "${serverBase}/api/agent-config/$AGENT_ID" \\
  -H "x-vibisual-hook-token: $${AGENT_CARD_ENV_TOKEN}" \\
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"model":"sonnet","effort":"medium","rules":"# Role: Coder\\n받은 명세대로 코드를 작성한다. 완료 후 변경 파일과 요점을 보고."}
JSON
\`\`\`
- 부분 업데이트 허용. rules 의 줄바꿈은 \`\\n\`.
- **권한 축(\`permissionMode\`·\`tools\`·\`disallowedTools\`·\`askTools\`)은 여기서 보내지 마라** — 그 네 칸은 사용자만 바꾼다(§5.3 #12-1). 보내도 이미 정해진 값이면 무시되고, 새 버블이라도 \`bypassPermissions\` 는 저장되지 않는다. 도구 구성이 필요하면 사용자에게 설정 창에서 정해 달라고 말하는 것이 그 자리다.

### 3) 엣지 연결 (작업 위임)
\`\`\`bash
RESP=$(curl -s -X POST "${serverBase}/api/task-edges" \\
  -H "x-vibisual-hook-token: $${AGENT_CARD_ENV_TOKEN}" \\
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"sourceAgentId":"<PM_ID>","targetAgentId":"<CODER_ID>","command":"이 기능을 구현하라","forwardMode":"manual","kind":"command"}
JSON
)
EDGE_ID=$(printf '%s' "$RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);process.stdout.write(o.data.id)})")
\`\`\`
- 필수: \`sourceAgentId\`,\`targetAgentId\`,\`command\`,\`forwardMode\`('manual'|'auto'). 선택: \`kind\`('command'|'artifact'|'request'|'critique'), \`returnFormat\`('summary'|'full'|'both'), \`commandMode\`('shared'|'tool-delegation'|'mode-delegation'), \`critiqueAuthority\`('force-rework'|'comment-only', kind='critique' 한정).

#### 검증(critique) 엣지 예시 — reviewer/tester → coder
\`\`\`bash
curl -s -X POST "${serverBase}/api/task-edges" \\
  -H "x-vibisual-hook-token: $${AGENT_CARD_ENV_TOKEN}" \\
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"sourceAgentId":"<TESTER_ID>","targetAgentId":"<CODER_ID>","command":"빌드/테스트 실패 시 원인을 고쳐 다시 통과시켜라","forwardMode":"auto","kind":"critique","critiqueAuthority":"force-rework"}
JSON
\`\`\`
- \`critique\`+\`force-rework\` 이면 서버가 같은 방향의 auto-rework(command) 자매 엣지를 자동 생성 — REJECT/실패 시 coder 가 자동으로 재작업한다. 별도 명령 엣지를 또 만들 필요 ❌.

### 4) 엔트리 기동 (사용자 원본 요청 forward — escape-free)
\`\`\`bash
curl -s -X POST "${serverBase}/api/commands/<ENTRY_AGENT_PATH>" \\
  -H "x-vibisual-hook-token: $${AGENT_CARD_ENV_TOKEN}" \\
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
}

// ─── §4 v2.52 — 에이전트 작업 신고 (did/userActions 색 구분) ───

/** agentId 당 보관하는 작업 신고 최대 개수 (ring buffer 캡, 초과 시 오래된 것부터 제거). */
export const AGENT_REPORT_MAX_PER_AGENT = 50;

/**
 * §5.5 #17-28 ⑧(b) — 카드 엔드포인트 curl 이 쓰는 **주소·토큰 참조**.
 *
 * 종전에는 카드 블록마다 `hook-listener.json` 을 읽어 `$VIBI_BASE`/`$VIBI_TOKEN` 을 채우는 bash
 * 두 줄(프렐류드)을 앞세웠다. 이유는 옳았다 — 앱 재기동으로 hook 포트가 바뀌면 dispatch 시점에 구워
 * 둔 상수는 죽은 포트를 가리킨다. 그런데 그 두 줄은 **596 토큰**이고 카드 5종 + 목표 + 브레인 +
 * 레시피 8벌에 통째로 복제돼 규약의 3분의 1을 먹었다(실측: 여분만 2,980 토큰).
 *
 * 같은 보장을 훨씬 싸게 얻는 길이 있다 — **그 값은 스폰하는 우리가 이미 알고 있다.** 서버가 자식
 * 프로세스 환경에 `VIBISUAL_BASE`/`VIBISUAL_TOKEN` 을 넣어 주면(§5.5 #17-28 ③ spawn 스위치와 같은
 * 통로) 그 자식이 띄우는 모든 Bash 호출이 그것을 물려받는다. 프렐류드도, 호출마다의 node 실행도
 * 필요 없고, 환경은 **자식이 뜰 때** 정해지므로 `--resume` 재스폰마다 최신값이라 dispatch 시점에
 * 구워 둔 상수보다 늘 새롭다.
 *
 * 환경이 비어 있을 때를 위해 bash 기본값(`${VAR:-<상수>}`)으로 종전 상수를 남긴다 — 옛 자식이 아직
 * 살아 있는 동안에도 **절대 지금보다 나빠지지 않는다**(프렐류드가 갖고 있던 폴백과 같은 값).
 */
export const AGENT_CARD_ENV_BASE = 'VIBISUAL_BASE';
export const AGENT_CARD_ENV_TOKEN = 'VIBISUAL_TOKEN';

/**
 * §3.7 (판올림 번호 발급 대기) — **이 요청이 밖에서 왔는가**를 말하는 한 줄.
 *
 * loopback 리스너가 외부 `claude` 프로세스의 요청을 in-process Express 로 재디스패치할 때 붙인다.
 * 렌더러(사용자 UI)는 IPC 로 곧장 오므로 이 표식이 없다 — 그래서 서버는 "사용자가 눌렀다"와
 * "에이전트가 curl 했다"를 구분할 수 있다.
 *
 * **위조를 걱정하지 않아도 되는 헤더다.** 이 표식이 붙으면 서버는 **더 좁게** 동작할 뿐이라
 * (권한 축을 못 바꾼다), 밖에서 일부러 붙여 봐야 스스로를 제한하는 것 말고는 얻는 것이 없다.
 * 반대 방향(표식을 떼서 사용자인 척)은 애초에 loopback 리스너가 붙이므로 뗄 수 없다.
 */
export const LOOPBACK_INGRESS_HEADER = 'x-vibisual-ingress';
export const LOOPBACK_INGRESS_VALUE = 'loopback';

/**
 * 카드 curl 한 줄이 쓰는 베이스 주소 + 토큰 헤더.
 *
 * §5.5 #17-28 ⑧(b) (판올림 번호 발급 대기 — **토큰 폴백 제거**) — 종전에는 환경변수가 비었을 때를
 * 대비해 `\${VIBISUAL_TOKEN:-<48자 원문>}` 으로 **토큰 값을 프롬프트에 구워** 넣었다. 그 한 줄의
 * 대가가 컸다: 프롬프트는 트랜스크립트(`~/.claude/projects/**.jsonl`)에 그대로 남고, 그 파일은
 * §5.10 회상(`/api/brain/recall`)이 발췌해서 **다른 세션의 모델에게 돌려준다**. 즉 이 제어 평면의
 * 열쇠가 대화 기록을 타고 계속 번졌다. 토큰 하나면 `create-custom-agent`·`agent-config`·
 * `commands`·`cmd/send` 가 전부 열리므로 폴백의 값어치보다 유출면이 훨씬 크다.
 *
 * **폴백을 지워도 지금보다 나빠지지 않는다** — 이 값을 쓰는 자식은 전부 우리가 스폰하고
 * (`execute` 의 `cardEnv`), 스폰 시점에 환경이 정해진다. 비어 있을 수 있는 경우는 앱이 아직
 * 리스너 토큰을 못 받은 부팅 순간뿐이고, 그때는 폴백 상수도 어차피 죽은 값이다.
 *
 * 주소(`serverBase`)는 시크릿이 아니라 폴백을 그대로 둔다 — 포트가 비면 카드가 아예 못 간다.
 */
function cardEndpointRefs(serverBase: string, _serverToken: string): { base: string; tokenHdr: string } {
  return {
    base: `\${${AGENT_CARD_ENV_BASE}:-${serverBase}}`,
    tokenHdr: `-H "x-vibisual-hook-token: \$${AGENT_CARD_ENV_TOKEN}"`,
  };
}


/**
 * §5.5 #17-28 ⑧(a) — **카드 5종 전용** 짧은 참조. 이 블록들은 언제나 「카드 공통 규약」 뒤에 서고,
 * 그 공통 블록이 폴백까지 갖춘 온전한 형태를 이미 한 벌 보여 준다. 그래서 여기서는 폴백을 다시
 * 적지 않는다 — 같은 48자 토큰 상수를 카드마다 되풀이하면 그것만으로 카드당 50 토큰이 샌다.
 */
function cardEnvRefsShort(): { base: string; tokenHdr: string } {
  return {
    base: `$${AGENT_CARD_ENV_BASE}`,
    tokenHdr: `-H "x-vibisual-hook-token: $${AGENT_CARD_ENV_TOKEN}"`,
  };
}

/**
 * §5.5 #17-28 ⑧(f) — 카드 규약의 **이유**를 담는 문서. 서버가 부팅 때 `~/.vibisual/rules/cards.md`
 * 로 한 장 써 두고, 프롬프트의 요약은 그 경로만 가리킨다.
 *
 * 프롬프트에는 **결론만** 남는다(언제 보내는가·무엇을 담는가·언제 보내지 마라). 그 결론이 왜 그렇게
 * 정해졌는지는 여기 있다 — 읽지 않아도 규약은 성립하고, 판단이 애매할 때만 읽으면 된다. 강제하지
 * 않는 이유는 실측이다: 규약이 실린 271 세션 중 255(94%)가 카드를 쓰므로 "필요할 때 읽어라"를 강제하면
 * 거의 모든 세션이 문서를 읽고, 읽어 온 내용은 도구 결과로 대화에 남아 **주입한 것과 똑같이 재열람된다**
 * (3,408 → 3,729 토큰, 게다가 읽을지 판단하는 모델 턴이 하나 더 붙는다).
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
0 이면서 카드마다 똑같이 반복돼 **마지막 본문 자리**를 잡아먹는다. 덧붙일 맥락이 없으면 아무 말도 하지
말고 끝내라. (렌더 층도 같은 줄을 표시에서 뺀다.)

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
선택지가 갈리면 여러 개 넣어라. 질문은 비차단이다 — 지금 할 수 있는 일을 끝낸 뒤 묻고, 사용자는 다음
메시지로 답한다.

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

/**
 * §5.5 #17-28 ⑧(a)(f) — 카드들이 **공유하는 결론 한 벌**.
 *
 * 종전 판본은 같은 규칙을 카드마다 되풀이했고(⑧(a) 에서 한 벌로 모았다), 그 위에 **왜 그런가**를
 * 문단으로 달고 있었다. 이제 이유는 `CARD_RULES_DOCUMENT` 로 내리고 여기에는 결론만 남긴다 —
 * 줄인 것은 문장의 길이이지 규칙의 수가 아니다(결론이 하나라도 빠지면 실패다).
 */
export function buildAgentCardCommonRules(args: {
  serverBase: string;
  serverToken: string;
  agentId: string;
  subAgentId?: string;
  /** §5.5 #17-28 ⑧(f) — 이유를 적어 둔 문서의 절대경로. 없으면 "애매하면 읽어라" 줄을 걸지 않는다. */
  docPath?: string;
}): string {
  const { serverBase, serverToken, agentId, subAgentId, docPath } = args;
  const subField = subAgentId ? `"${subAgentId}"` : 'null';
  const { base, tokenHdr } = cardEndpointRefs(serverBase, serverToken);
  const docLine = docPath ? `\n- 판단이 애매하면(보낼까 말까, 어느 카드인가) \`${docPath}\` 를 Read 하라 — 그 결론들의 근거가 있다.` : '';
  return `

# 카드 (Vibisual IDE) — 공통
아래 카드들은 같은 창구를 쓴다. 주소·토큰은 환경변수에 이미 있다.
\`\`\`bash
curl -s -X POST "${base}/api/<엔드포인트>" ${tokenHdr} \\
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"agentId":"${agentId}","subAgentId":${subField}, ...}
JSON
\`\`\`
- **본문(짧은 결론)을 먼저 쓰고, 그 보고의 맨 마지막 동작으로 1회 호출**한다. 호출 뒤에는 본문을 더 붙이지 마라. **"카드로 보냈습니다" 같은 발송 사실 보고 금지** — 덧붙일 맥락이 없으면 아무 말 없이 끝내라. 작업 도중에 미리 보내지 마라.
- **한 턴에 카드는 하나** — 작업 신고와 검수 요청은 둘 중 하나만.
- **카드에 담은 목록을 본문에 다시 나열하지 마라.** 본문은 1~2문장 결론만.
- 전부 **표시 전용** — 결과에 영향이 없다. 실패해도 무시하고 보고는 그대로 진행.${docLine}`;
}

/**
 * §4 v2.52 · §5.5 #17-28 ⑧(f) — "작업 신고" 결론.
 * 이유(왜 도배가 문제인가·`learned` 는 무엇인가)는 `CARD_RULES_DOCUMENT` 에 있다.
 */
export function buildAgentReportRules(_args: {
  serverBase: string;
  serverToken: string;
  agentId: string;
  subAgentId?: string;
  identityFile?: string;
}): string {
  const { base, tokenHdr } = cardEnvRefsShort();
  return `

## \`POST ${base}/api/agent-report\` — 작업 신고 (색 구분 카드)
**사용자가 직접 해야 할 일이 실제로 생긴 완료 보고에서만.** 단순 완료·일상 대화·질문 답변·조사 보고에는 보내지 마라.
- \`did[]\` 내가 끝낸 일 · \`userActions[]\` 내가 대신 못 해 **사용자가 직접 해야 하는 일**(빌드 실행·에디터 조작·외부 승인 등) — **이게 비면 보내지 마라** · \`nextSteps[]\` 다음 차례(선택).
- \`learned[]\` 이번에 배운 교훈·함정(확실한 것만 최대 3, 없으면 생략) · \`helpfulMemoryIds[]\` 도움된 브리핑 카드 id · \`staleMemoryIds[]\` 지금 코드와 어긋난 카드 id(삭제되지 않으니 확실한 것만 신고).
- 인증 헤더: \`${tokenHdr}\``;
}

/**
 * §4 v2.60 · §5.5 #17-28 ⑧(f) · ⑨ — "사용자 질문" 결론.
 * `prompts` 를 어떻게 쓰는가·"뻔한 질문"의 경계는 `CARD_RULES_DOCUMENT` 에 있다.
 */
export function buildAgentQuestionRules(_args: {
  serverBase: string;
  serverToken: string;
  agentId: string;
  subAgentId?: string;
  identityFile?: string;
}): string {
  const { base } = cardEnvRefsShort();
  return `

## \`POST ${base}/api/agent-questions\` — 질문 카드
**멈춰 서야만 하는 질문일 때만.** 질문이 없으면 보내지 마라. 비차단 — 지금 할 수 있는 일을 끝낸 뒤 묻는다.
- **먼저 답이 이미 나와 있는지 보라.** 사용자는 **문제를 해결하라고** 지시했다 — 그 지시 안에 이미 답이 있는 것을 되묻지 마라.
- **묻지 말고 그냥 하라(뻔한 질문)**: "고칠까요/진행할까요"(이미 고치라고 했다) · "원인 두 곳 다 고칠까요, 하나만?"(**원인이면 다 고친다**) · "먼저 설계를 볼까요"(막히지 않았으면 그냥 한다) · 되돌릴 수 있는 판단 · 네가 근거로 정할 수 있는 것.
- **물어도 되는 것**: 되돌리기 어렵거나 바깥에 나가는 일(삭제·배포·과금·외부 전송) · 어느 쪽을 골라도 **버려지는 작업이 큰** 갈림길 · 사용자만 아는 값(자격증명·의도).
- **묻더라도 멈추지 마라** — 되돌릴 수 있는 쪽을 **네 판단으로 골라 끝낸 뒤**, 그 선택을 밝히고 "다른 쪽이면 말씀해 주세요"로 묻는다. 답을 기다리며 손을 놓는 것은 **막혔을 때뿐**이다.
- \`items[{question, header?, prompts[]}]\` — \`prompts\` 는 사용자가 **그대로 보내면 되는 답**을 1인칭으로(선택지가 갈리면 여러 개). IDE 가 복사·즉시 전송 버튼을 단다.`;
}

/**
 * §4 v2.70 · §5.5 #17-28 ⑧(f) — "검수 요청" 결론.
 * 작업 신고와의 성격 차이는 `CARD_RULES_DOCUMENT` 에 있다.
 */
export function buildAgentReviewRules(_args: {
  serverBase: string;
  serverToken: string;
  agentId: string;
  subAgentId?: string;
  identityFile?: string;
}): string {
  const { base } = cardEnvRefsShort();
  return `

## \`POST ${base}/api/agent-review\` — 검수 카드
**지시받은 수정·기능 변경을 끝내 사용자가 결과를 확인해야 할 때만.** 단순 완료·일상 대화·질문 답변·조사 보고에는 보내지 마라. (직접 손댈 일이 있으면 검수 대신 작업 신고 — 고친 내용은 \`did\` 에.)
- \`instruction?\` 받은 지시 한 줄 · \`changes[]\` 무슨 동작을 어떻게 고쳤나 — **이게 비면 보내지 마라** · \`checkpoints[]\` 사용자가 확인할 방법.`;
}

/**
 * §5.5 #17-12 (v3.83) — "의도 먼저" 지시문 (시스템 프롬프트 꼬리표, 동적 값 없음).
 *
 * 배경: 실행 초반에 에이전트가 **무엇을 하려는지** 화면에 없어 사용자가 중지 여부를 판단할 수 없었다
 * (하단 상태바가 보여주던 건 "실행 중 + 사용자가 친 프롬프트" 뿐). 2026 추세(실행 전 계획 표시)에 맞춰
 * 도구를 쓰기 전에 의도·계획을 말하게 한다. 새 엔드포인트 없이 자연어 + 기존 `TodoWrite` 재사용 —
 * 화면에 뜨는 계획이 곧 에이전트가 실제로 들고 도는 계획이어야 "겉치레 미리보기"가 되지 않는다.
 *
 * ⚠ 길이 상한을 **고정으로 두지 마라** (§5.5 #17-12 ①-1 정정). 종전 문구는 입력 길이와 무관하게 "1~2문장"을
 * 못박았고, 그래서 요구가 여러 갈래인 긴 지시가 오면 모델이 가장 도드라진 한두 갈래만 남기고
 * 나머지를 **조용히** 버렸다(사용자 지적 — "내가 설명한 것의 30% 만 쓰고 나머지 70% 는 무시한다").
 * 버렸다는 사실이 화면에 남지 않으므로 사용자는 **못 알아들은 것**과 **줄여 말한 것**을 구분할 수
 * 없고, 그러면 이 규칙의 존재 이유(중지 여부 판단)가 통째로 무너진다. 상한은 **요구의 개수에
 * 비례**해야 하고, 모르겠는 항목·이번에 안 할 항목도 **적힌 채로** 남아야 한다.
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

/**
 * §5.5 #17-30 — 한 세션이 모아 둘 수 있는 diff 리뷰 코멘트 상한.
 *
 * 코멘트는 보내면 사라지는 작업 메모라 영속화하지 않지만, "보내지 않고 계속 다는" 사용에도
 * 메모리가 무한히 늘지 않도록 **개수**에 상한을 건다(§3.2.3 — 캡이 값 길이에만 있고 키 개수에
 * 없어서 터진 전례를 반복하지 않는다). 초과분은 더 담지 않고 화면이 안내한다.
 */
export const DIFF_COMMENT_MAX = 50;

// ─── §5.5 #17-28 "간결" 밀도 = 핵심만 남기는 밀도 (v4.75) ───
// 종전 간결은 표준과 같은 분기를 타서 사실상 차이가 없었다. 아래 상수들이 "얼마나 남길지"를 정한다.

/** 간결에서 AI 본문(text)의 **머리**로 남기는 줄 수. 화면의 마지막 본문·여는 본문은 예외(자르지 않음). */
export const STREAM_COMPACT_TEXT_CLAMP_LINES = 4;

/**
 * 간결에서 AI 본문의 머리로 남기는 글자 수 — 줄 수와 **둘 다** 본다.
 * 마크다운 문단은 줄바꿈 없이 한 줄로 길게 오는 일이 잦아, 줄 수만 보면 클램프가 통째로 헛돈다.
 */
export const STREAM_COMPACT_TEXT_CLAMP_CHARS = 420;

/**
 * §5.5 #17-46 ① — 간결에서 AI 본문의 **꼬리**로 남기는 줄 수. 접히는 것은 가운데뿐이다.
 *
 * 한 문단에서 사용자가 가장 읽어야 하는 줄은 앞이 아니라 끝이다(무엇을 찾았는지·무엇이 막혔는지·
 * 다음에 무엇을 물어야 하는지). 앞만 남기던 종전 클램프는 그 결론을 매번 잘라 냈다.
 * 머리(4줄)보다 짧게 두는 이유는 꼬리가 "요점 확인"이지 "다시 읽기"가 아니기 때문이다.
 */
export const STREAM_COMPACT_TEXT_TAIL_LINES = 3;

/** §5.5 #17-46 ① — 꼬리의 글자 수 상한. 머리와 같은 이유로 줄 수와 **둘 다** 본다. */
export const STREAM_COMPACT_TEXT_TAIL_CHARS = 240;

/**
 * §5.5 #17-46 ② — 가운데를 접어서 **감추는 양이 이보다 적으면 아예 접지 않는다**(줄바꿈 없는 긴 문단용).
 *
 * 접기 버튼 자체가 한 줄을 먹으므로, 한 줄을 감추려고 버튼 한 줄을 쓰는 자리는 순이득이 0이고
 * 화면에 손잡이만 하나 더 생긴다. 줄 수로는 `hiddenLines >= 2` 가 같은 판정을 하고, 이 상수는
 * **줄바꿈 없이 길게 오는 마크다운 문단**(줄 수로는 1줄이지만 실제로는 여러 줄로 접히는 글)을 위한 쪽이다.
 */
export const STREAM_COMPACT_TEXT_MIN_HIDDEN_CHARS = 120;

/** 간결에서 번호 목록 카드가 보여주는 항목 수 — 나머지는 `+N` 한 줄. */
export const STREAM_COMPACT_LIST_PREVIEW = 3;

/** 간결에서 접힌 카드/본문 요약 한 줄의 최대 글자 수(넘으면 말줄임). */
export const STREAM_COMPACT_SUMMARY_CHARS = 90;


/** agentId 당 보관하는 번호 목록 정렬 카드 최대 개수 (ring buffer 캡, 초과 시 오래된 것부터 제거). */
export const AGENT_LISTS_MAX_PER_AGENT = 50;



// ─── §5.14 v4.62 — 플레이 버블 (이 프로젝트를 켜는 버튼) ───

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

/**
 * §5.14 4단 계단 ④ — 실행법을 끝내 못 찾았을 때 에이전트에게 보내는 명령.
 *
 * **새 통신 레이어를 만들지 않는다** — 기존 명령 큐로 보내고, 답은 `/api/agent-iframe` 과 같은
 * loopback + 토큰 경로(`POST /api/play-recipe`)로 받는다. 핵심 제약은 하나다: **서버를 띄우지 마라.**
 * 켜는 것은 사용자가 버튼을 누를 때의 일이고, 에이전트가 할 일은 "어떻게 켜는가"를 알아내 등록하는 것뿐이다.
 */
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

/**
 * 프로젝트(워크트리)당 보관할 리뷰 개수 상한 — **키 개수에 두는 캡**.
 * 값 길이만 자르고 개수를 안 막으면 체크포인트가 무한히 자란다(§9 최적화 규약).
 * 넘으면 오래된 것부터 버리되 **결정 안 난(pending) 리뷰는 남긴다**(사람이 아직 판단해야 하는 것).
 */
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

/**
 * §5.15 — 작업 카드 한 장에 얹는 자동 규칙 섹션.
 *
 * 카드는 **기존 `createCustomAgent` 경로**로 만들어지고, 그 에이전트의 `AgentConfig.rules` 앞에
 * 이 블록이 붙는다(§7.9 v1.33 의 "연결된 위임 엣지(자동)" 섹션과 같은 문법 — 새 주입 경로 ❌).
 * 사용자가 rules 를 손으로 고쳐도 이 블록만 갈아 끼울 수 있도록 시작·끝 표식을 둔다.
 */
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

/**
 * 랩 한 장이 가질 수 있는 변형 개수 상한 — **키 개수에 두는 캡**(§9).
 * 변형 하나가 워크트리 하나 + 에이전트 하나 + 도는 CLI 하나이므로, 이 숫자는 곧 한 번에
 * 태울 수 있는 프로세스 수다. 값 길이만 자르고 개수를 안 막으면 디스크와 CPU가 함께 터진다.
 */
export const LAB_MAX_VARIANTS = 8;

/** 프로젝트당 보관할 랩 개수 상한. 넘으면 오래된 것부터 버리되 도는 랩은 남긴다. */
export const LAB_RUNS_MAX_PER_PROJECT = 20;

/** 변형 워크트리 이름 앞머리 — `.claude/worktrees/lab-<랩id끝자리>-<변형순번>`. */
export const LAB_WORKTREE_PREFIX = 'lab';

/**
 * §7.10 — 워크트리 안 프로세스를 트리째 죽인 뒤 **폴더를 지우기 전에 기다리는 시간(ms)**.
 *
 * `taskkill /T /F`(Windows)·`kill(-pgid)`(POSIX)는 신호를 보내고 바로 돌아온다 — 그 순간에는
 * 아직 열린 파일 핸들이 남아 있어, 곧바로 `rmSync` 하면 방금 죽인 프로세스 탓에 폴더가 또
 * 반만 지워진다. 사람이 기다렸다고 느끼지 않으면서 핸들이 풀리기에 충분한 값으로 잡았다.
 */
export const WORKTREE_REAP_SETTLE_MS = 700;

/** 변형 카드를 놓을 자리 — 랩 표지 오른쪽으로 이만큼 띄우고, 세로로 이 간격씩 쌓는다. */
export const LAB_CARD_OFFSET_X = 320;
export const LAB_CARD_GAP_Y = 150;

/**
 * §5.18 — 변형 한 벌에 얹는 자동 규칙 섹션.
 *
 * 카드는 **기존 `createCustomAgent` 경로**로 만들어지고, 그 에이전트의 `AgentConfig.rules` 앞에
 * 이 블록이 붙는다(§5.15 스펙 작업 카드와 같은 문법 — 새 주입 경로 ❌).
 */
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

/**
 * §5.18 — 토큰 × 단가로 추정 비용(USD)을 낸다. **단가를 모르면 `undefined`** 를 돌려준다 —
 * 0 을 돌려주면 화면이 "공짜로 끝났다"고 말하게 된다(§5.18 "측정 없음과 0 을 구분한다").
 *
 * 입력 토큰은 캐시 읽기·생성이 뒤섞여 들어오므로 여기서는 input 단가 하나로 뭉뚱그린다 —
 * 랩의 목적은 변형끼리의 **상대 비교**이고, 같은 셈법을 모든 변형에 똑같이 적용하면 순위는 선다.
 */
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

// ─── §4 v3.21 — 에이전트 피드백 학습 루프 (좋아요/싫어요 → 규칙 되먹임) ───

/** agentId 당 보관하는 피드백 최대 개수 (ring buffer 캡, 초과 시 오래된 것부터 제거). */
export const AGENT_FEEDBACK_MAX_PER_AGENT = 200;

/** 스폰 프롬프트에 주입하는 피드백 다이제스트 최대 건수 (최근순). */
export const AGENT_FEEDBACK_DIGEST_MAX = 12;

/** distill 증류 제안에 넣는 싫어요 최대 건수 (최근순 — 프롬프트 비대 방지). */
export const AGENT_FEEDBACK_DISTILL_MAX = 30;

/** 피드백 summary 한 항목의 최대 길이 (result 본문 발췌 캡). */
export const AGENT_FEEDBACK_SUMMARY_ITEM_MAX = 200;

// ─── §5.5 #17-11 v3.79 — 세션 반복 실행(루프) ───

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
 * §5.5 #17-28 ⑩ (c) — 이 턴에 실리는 것이 **우리가 내부적으로 쏘는** 슬래시 명령인가.
 *
 * 주입원 통제에서 `cc.slash-commands` 를 끄면 스폰에 `--disable-slash-commands` 가 붙는데,
 * 그 플래그는 사용자 스킬만이 아니라 **CLI 내장 명령의 등록까지** 막는다(실측 2.1.263 —
 * `Unknown command:` 가 아니라 `"…isn't available in this environment."` 로 떨어지므로
 * 문구만 보고는 두 원인을 가를 수 없다). 그래서 그 줄을 끈 프로젝트에서는 턴 경계 압축·
 * 에이전트 자율 압축·세션 루프 압축이 **셋 다** 조용히 죽었다 — 셋의 본문이 전부 `/compact`
 * 라 같은 자리에서 함께 막힌다(실측: 24시간·컨텍스트 322k 세션에서 `compact_boundary` 0건,
 * 발사 2회가 모두 거절. 같은 시기 슬래시가 켜진 프로젝트는 59건/42세션).
 *
 * **사용자가 직접 친 슬래시 명령은 여기 해당하지 않는다.** 그것까지 열어 주면 사용자가 끈
 * 스위치를 우리가 통째로 무력화하는 것이 되어, 이 예외가 고치려던 것보다 나쁜 거짓말이 된다.
 */
export function isInternalSlashCommand(text: string): boolean {
  const t = text.trim();
  return t === AGENT_COMPACT_COMMAND
    || t === SESSION_LOOP_COMPACT_COMMAND
    || t === SESSION_LOOP_CLEAR_COMMAND;
}

/**
 * §5.5 #17-28 ⑩ (c) — 스폰 인자에서 **슬래시 차단 플래그 하나만** 걷어 낸다.
 *
 * 나머지 스위치(CLAUDE.md·자동 기억·번들 스킬·워크플로·git 지시)는 **그대로 둔다** — 이 예외는
 * "명령이 등록되게" 하는 것이지 주입을 되살리는 것이 아니다. 그 턴에 실리는 것은 명령 한 줄뿐이라
 * 사용자 스킬이 낄 자리도 없다. 인자를 문자열로 비교하므로 표(`CONTEXT_SPAWN_SWITCHES`)에서
 * 플래그 이름이 바뀌어도 이 함수는 그 표를 따라간다.
 */
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

/**
 * 세션 탭 하나가 보관하는 검증 이력의 최대 건수.
 * 값 길이만 자르고 **개수를 안 막으면 체크포인트가 무한히 자란다**(§9).
 */
export const VERIFICATION_RUNS_MAX_PER_SESSION = 20;

/** "무엇을 확인할지" 한 줄의 최대 길이 (프롬프트·체크포인트 비대 방지). */
export const VERIFICATION_FOCUS_MAX = 2000;

/** 한 검증이 보관하는 시도(attempts) 최대 건수. */
export const VERIFICATION_ATTEMPTS_MAX = 12;

/** 판정 사유 한 줄의 최대 길이. */
export const VERIFICATION_REASON_MAX = 500;

/** 시도 한 줄의 `command`/`detail` 최대 길이. */
export const VERIFICATION_ATTEMPT_TEXT_MAX = 300;

// ─── §5.5 #17-35 ⑨ — 시연(재현 절차) 상한 ───
//
// 값 길이만이 아니라 **개수에도** 캡을 둔다(§9). 시연은 디스크에 PNG 를 남기는 유일한 검증
// 데이터라, 개수 상한이 곧 그 폴더의 크기 상한이다.

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

/**
 * 시연 하나가 남기는 프레임 최대 장수.
 * §5.9 플레이테스트 첨부 상한(`CAPTURE_PLAYTEST.MAX_FRAME_COUNT`)과 같은 수 — 같은 이유(입력창을
 * 그림으로 덮지 않는다)이고, 여기서는 매 검증마다 다시 실리므로 토큰에도 그대로 영향을 준다.
 */
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


// ─── §5.5 #17-17 v4.46 — 세션 목표(Goal) ───

/** 목표 본문 최대 길이 (체크포인트·프롬프트 비대 방지). */
export const SESSION_GOAL_TEXT_MAX = 2000;

/** 진행 신고 한 줄 근거의 최대 길이. */
export const SESSION_GOAL_NOTE_MAX = 200;

/** 진행 이력 ring buffer 크기 — 넘치면 오래된 것부터 버린다. */
export const SESSION_GOAL_HISTORY_MAX = 40;

/** §5.5 #17-17 v4.47 — 목표 단계(체크리스트) 최대 개수. 넘는 항목은 잘린다. */
export const SESSION_GOAL_STEPS_MAX = 30;

/** 단계 본문 최대 길이 — 사이드바 한 줄에 들어갈 정도로 짧게 쓰게 한다. */
export const SESSION_GOAL_STEP_TEXT_MAX = 200;

/**
 * §5.5 #17-17 ⑰(c) — 목표 변천 기록(`SessionGoal.pastTexts`) 상한. 넘으면 오래된 것부터 버린다.
 * 목표 문장은 `SESSION_GOAL_TEXT_MAX`(2,000자)까지라 다섯 벌이면 체크포인트 한 목표에 최대 10KB —
 * "어디서 왔는가"를 답하는 데는 최근 몇 판이면 족하다.
 */
export const SESSION_GOAL_PAST_TEXT_MAX = 5;

/**
 * §5.5 #17-17 ⑰(d) — 단계 본문이 가리키는 두뇌 스킬을 그 턴의 스킬 선택에 **더** 싣는 상한.
 * `BRAIN_SKILL_INJECTION_TOP_K`(명령 본문 매칭) 예산 밖이다 — 사용자가 노드로 세운 절차는 명령과
 * 안 맞아도 보게 하되, 목록이 길어지지 않게 두 건까지만.
 */
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

/**
 * ⑫(a) — 되풀이로 **인정하는 최소 횟수.** 이 미만은 팔레트에 서지 않는다.
 *
 * 1~2회를 "자주 쓰는 것"으로 세면 팔레트는 곧 최근 목록이 되고, 그러면 사용자는 거기서
 * 자기 습관을 알아볼 수 없다. 스킬은 한 번 부르는 데 드는 값이 커서 이 문턱을 따로 두지 않는다
 * (아래 `GOAL_ACTION_SKILL_MIN_REPEAT`).
 */
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

/**
 * ⑪(i) — 종류 카드가 펴는 **화면 골격**의 전부.
 *
 * 종류(`key`)는 에이전트가 무한히 늘리지만 그리는 골격은 우리가 만든 수만큼이라 여기는 유한하다.
 * 목록이 곧 검증이다 — 여기 없는 값은 `none` 으로 접힌다(모르는 것을 아는 척 그리지 않는다).
 */
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
 * ㉒(a) — 산출물 골격이 **어느 내부 앱**의 화면을 펴는가 (§5.13 `INTERNAL_APPS` 의 `id`).
 *
 * 무대가 앱 이름을 코드에 적지 않도록 표 하나로 모은다 — 여기 없는 골격(`image` 를 포함해)은
 * 앱이 아니라 우리가 이미 가진 조각으로 그린다(`image` = 편집창의 그림 칸).
 *
 * ⚠ 이 표는 **앱 id 만** 든다. 무슨 확장자를 여는지는 앱이 스스로 선언하고(`InternalApp.opens`)
 * 무대는 `workspaceOpenClaims()` 로 그것을 받는다 — §5.13 (R-1) 의 "코어가 표를 들지 않는다".
 */
export const STAGE_SURFACE_APPS: Readonly<Partial<Record<VisualKindSurface, string>>> = {
  model3d: 'vibi3d',
  video: 'vibistudio',
  audio: 'vibisound',
};

/**
 * ㉒(c) — 앞 단계가 없을 때 실황 구간을 뒤로 여는 폭(ms).
 *
 * 첫 단계는 "이전 단계의 끝"이 없어 구간이 한 점이 된다 — 그러면 첫 단계에서는 늘 빈 화면이다.
 */
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

/**
 * ⑪(a) — **뿌리 씨앗** 셋. 시들지도 지워지지도 않는다(전부 사라지면 지도가 백지가 되므로).
 *
 * ⑪(i) 로 `scene`·`surface` 가 붙었다 — 씨앗도 무대를 갖는다. `blurb` 는 **일부러 비운다**:
 * 그 한 줄은 사용자의 언어로 쓰여야 하는데 여기는 로케일을 모르는 자리다. 비어 있으면 화면이
 * 골격별 기본 문장(`ide.stage.surfaceBlurb.*`)으로 채우고, 에이전트가 쓰면 그것이 이긴다.
 */
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

/**
 * ⑪(i) — **시작 카드.** 처음 한 번 함께 심어 주지만 씨앗과 달리 **보통 카드처럼 시들고 휴지통으로
 * 간다** — 언리얼만 만드는 사용자에게 `github` 카드가 영원히 남아 있을 이유가 없다.
 *
 * 사용자 지시의 "초반에 몇 가지는 우리가 제공하지만 사용자가 쓰는 대로 진화한다"가 이 층이다.
 * 상표·로고는 쓰지 않는다(§ 법적 안전선) — 전부 우리가 그린 중립 도형이다.
 */
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
  // ─── ㉒(b) 산출물 넷 — 에이전트가 **만든 것**을 무대 안에서 보는 종류들 ───
  //
  // ㉑ 이 정한 대로 규약은 `surface` 를 가르치지 않는다(파서만 읽는다). 그래서 골격만 늘리면
  // 에이전트는 그것을 고를 길이 없다 — 이 카드 넷이 그 길이다(상태 블록의 `종류:` 줄에 키가 실린다).
  // 색은 새로 만들지 않고 **그 골격이 여는 앱의 엣지 색**을 빌린다(§5.13 registry 의 `glow`).
  //
  // 그림 — 이젤에 걸린 캔버스. 여는 곳이 앱이 아니라 편집창의 그림 칸이라 빌릴 앱 색이 없어
  //   종이·물감의 따뜻한 톤을 쓴다.
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
 * ⑪(m) — **장면 템플릿.** 새 종류가 그림을 갖는 가장 싼 길.
 *
 * (b) 는 "그림은 에이전트가 그린다"고 정했고 그 규율은 그대로다. 문제는 **출발점이 없다는 것**이었다 —
 * 종류 하나를 만들 때마다 96 좌표계 path 를 여덟 줄까지 맨손으로 써야 하니, 실제로는 대부분
 * `glyph` 한 줄만 내고 장면은 비운 채 지나갔다(무대는 24px 글리프를 키운 그림으로 시작한다).
 *
 * 그래서 **몇 개를 미리 그려 둔다.** `from: wave` 한 줄이면 장면·글리프·어울리는 골격·색까지 딸려 온다.
 * 그 위에 자기 path 를 얹어 고쳐 그리는 것은 종전대로다 — 템플릿은 **시작점이지 울타리가 아니다**.
 * (c) 의 생애(침전·휴지통)도 그대로 적용된다: 템플릿에서 태어난 카드도 안 쓰이면 시든다.
 *
 * 전부 우리가 그린 중립 도형이다(상표·로고 ❌ — § 법적 안전선).
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

/**
 * ⑪(m) — **흐름 템플릿.** 빈 무대에서 첫 목록을 세우는 손잡이.
 *
 * (d) 는 "사용자가 단계를 끼워 넣는다"를 열었지만, 실제로 사용자가 마주치는 첫 화면은 **아무것도 없는
 * 지도 + [단계 끼워넣기] 버튼 하나**였다 — 한 줄씩 스무 번 치라는 뜻이 되어 아무도 쓰지 않았다.
 * 흐름 템플릿은 그 자리에 **자주 하는 일의 뼈대**를 한 번에 깔아 준다. 깔린 뒤로는 보통 단계와 똑같다:
 * 세션이 이어서 고치고 늘리고, 사용자는 지우거나 순서를 바꾼다.
 *
 * 본문은 **여기 두지 않는다** — 12 로케일이 있는 자리라 영어 문장을 상수로 박으면 그 순간 굳는다.
 * 클라가 `ide.stage.flow.<id>.title` · `ide.stage.flow.<id>.steps.<key>` 로 읽는다.
 * `kind` 는 씨앗·시작 카드 중에서만 고른다(없는 카드를 가리키면 중립 점이 되므로).
 */
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
 * §5.5 #17-17 ⑪(b) — 글리프 path 검증. **에이전트가 쓴 문자열이 SVG 속성으로 그대로 들어가는 길을 막는다.**
 *
 * SVG path 문법에 실제로 쓰이는 것만 통과시킨다 — 명령 문자(MmLlHhVvCcSsQqTtAaZz)·숫자·부호·
 * 소수점·지수(e/E)·공백·쉼표. 그 밖의 문자가 하나라도 있으면 **글리프를 버린다**(카드는 만든다 —
 * 중립 점으로 그려질 뿐이다). 길이는 `SVG_PATH_MAX` 로 자른다.
 *
 * 순수 함수 — 서버가 저장할 때와 클라가 그릴 때가 같은 답을 내야 한다(두 벌이 되면 한쪽만 고쳐져 어긋난다).
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

/**
 * §5.5 #17-17 ⑪(i) — **장면 그림 검증.** 글리프와 같은 문법 검사를 path 마다 돌린다.
 *
 * 통과 못 한 path 는 **그것만** 버리고 나머지는 살린다 — 여덟 줄짜리 그림에서 한 줄이 깨졌다고
 * 그림 전체를 버리면, 에이전트는 무엇이 잘못됐는지 모른 채 매번 통째로 다시 그리게 된다.
 * 배열이 아니거나 살아남은 path 가 하나도 없으면 `undefined`(카드는 그대로 만들어진다 — (b) 와 같은 규율).
 */
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

/**
 * §5.5 #17-17 ⑪(i) — 화면 골격 정규화. 목록에 없는 값은 `undefined`(= 무대가 `none` 으로 읽는다).
 *
 * `'none'` 을 명시적으로 보낸 것과 아예 안 보낸 것을 굳이 가르지 않는다 — 둘 다 "펼 화면이 없다"로
 * 같은 그림이 되므로, 저장 자리를 하나 아끼는 편이 낫다.
 */
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

/**
 * §5.5 #17-17 ⑪(m) — **템플릿을 펼친다.** 카드가 `from`(장면 템플릿 이름)을 냈으면 그 그림·색·골격을
 * 기본값으로 깔고, **카드가 직접 낸 값이 언제나 이긴다.**
 *
 * 덮어쓰기가 아니라 밑칠인 이유는 하나다 — 템플릿은 시작점이지 울타리가 아니다(⑪(m)). `from: wave` 로
 * 파형을 깔고 자기 path 두 줄을 얹는 것이 이 기능이 노리는 사용법이고, 그때 템플릿이 얹은 그림을
 * 지워 버리면 모델은 템플릿을 쓰는 순간 자기 그림을 잃는다.
 *
 * 순수 함수다 — 서버가 저장할 때와 클라가 대화에 미리 그릴 때가 같은 답을 내야 한다.
 */
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

/**
 * §5.5 #17-17 ⑪(d) — 세션이 보낸 단계 목록과 **사용자가 끼워 넣은 단계**를 합친다.
 *
 * ⑧ 의 "본문이 같은 기존 단계의 id 재사용"은 그대로 두되, `authoredBy==='user'` 인 단계는
 * 세션 목록에 없어도 **지우지 않고 원래 자리에 남긴다** — 사용자가 작업 도중 끼워 넣은 일을
 * 에이전트가 자기 목록으로 덮어 지우면 안 되기 때문이다.
 *
 * 자리는 **앞 이웃의 본문**으로 잡는다(그 단계 바로 뒤에 다시 꽂는다). 앞 이웃이 사라졌으면
 * 꼬리에 붙인다 — 사용자가 넣은 일이 조용히 사라지는 것보다 순서가 밀리는 편이 낫다.
 *
 * 순수 함수 — 서버가 소유하지만 테스트가 이 함수 하나만 보면 규칙 전체를 고정할 수 있다.
 */
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
 * §5.5 #17-28 ⑧(c) · #17-17 ㉑ — 목표 블록의 **변하는 절반**(상태). 매 턴 새로 조립돼 프롬프트 앞에 선다.
 *
 * ㉑ 로 **목록만 남겼다.** 종전에는 여기에 세션 내내 같은 규칙 문장이 셋이나 더 실렸다 — `[사용자 추가]`
 * 단계를 지우지 말라는 문단, `∥` 행을 갈라 돌리라는 문단, "이 턴에 목록부터 세워라"는 지시 — 그것이
 * 매 턴 대화 이력에 N벌 쌓였다(실측: 빈 목록 317자 · 단계 넷 690자). 규칙은 규약(아래
 * `buildSessionGoalProtocol` — 시스템 프롬프트 한 벌)이 말하고, 여기는 **지금 값**만 적는다:
 * 목표 문장 · 진행률 · 목록 · 쓸 수 있는 종류 키.
 *
 * 목록은 **블록 문법 그대로** 적는다(`- [~] ∥ 본문 @종류`) — 세션이 목록을 다시 낼 때 이 줄을 그대로
 * 옮기면 되고, 옮기다 표식(`∥`·`@종류`)을 떨어뜨릴 자리가 없다. `[사용자 추가]` 표지만은 파서가 읽고
 * 버린다(`stageBlock.ts` — 본문에 섞이면 같은 단계가 다른 항목으로 갈린다). `**목표**:` 줄은
 * `sessionTitle.ts` 가 덧말 턴의 제목으로 뽑는 닻이라 그 모양을 지키고, 표지는 그 다음 줄에 둔다.
 */
export function buildSessionGoalState(args: {
  /** 최종 목표 한 문장. */
  goalText: string;
  /** 지금까지의 진행률 (0~100). 단계가 있으면 `done/전체` 파생값이다. */
  percent: number;
  /**
   * §5.5 #17-17 v4.47 — 단계 체크리스트(있으면 그대로 보여주고, 이걸 갱신하게 시킨다).
   *
   * ⑪(i) `kind` · ⑰(b) `parallel` · ⑪(d) `authoredBy` 를 함께 보여 준다 — 못 보면 모델은 같은 일에
   * 매번 다른 키를 붙이고(`git`→`vcs`→`scm`), 사용자가 나란히 놓은 행을 풀고, 사용자 단계를 제 목록으로 덮는다.
   */
  steps?: { text: string; status: SessionGoalStepStatus; authoredBy?: 'session' | 'user'; kind?: string; parallel?: boolean }[];
  /** §5.5 #17-17 v4.50 — 목표 문장의 주인. `user` 면 에이전트가 문장을 건드리지 않게 못 박는다. */
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
 * §5.5 #17-28 ⑧(c)(f) · #17-17 ㉑ — 목표 블록의 **안 변하는 절반**(규약). `--append-system-prompt` 로
 * 세션에 한 벌만 실린다.
 *
 * ㉑ 로 세 절(「목표 창 규약」·「나란히 놓인 행」·「단계의 종류」, 1,956자)을 **한 절**로 줄였다. 목표 창이
 * 동작하는 데 필요한 것은 블록 문법 한 벌과 규칙 몇 줄뿐이었다 — 예시 블록 둘, 표식 풀이, 글리프·장면을
 * 직접 그리는 법, 화면 골격 목록, REST 폴백은 전부 걷었다. 파서는 그대로라 아는 세션이 `glyph`·`scene`·
 * `surface`·`color` 를 적으면 종전처럼 받는다(`stageBlock.ts`) — 가르치지 않을 뿐이다.
 *
 * 시스템 프롬프트에 두는 이유는 그대로다 — 사용자 메시지에 있는 규칙은 **압축(compact)에 쓸려 나갈 수
 * 있고**, 그러면 세션 중반부터 목록을 갱신하는 방법을 아무도 말해 주지 않는 상태가 된다.
 *
 * ㉓ 로 **시점**을 못 박았다. ㉑ 이 남긴 "이 턴에 세우고"는 **턴 끝도 이 턴이라** 모델이 규약을 하나도 어기지
 * 않고 늘 늦을 수 있었다 — 상태 블록을 최종 보고 옆에 붙이는 것이 자연스럽기 때문이다(카드 규약이 "보고의
 * 맨 마지막 동작"이라 말하는 그 자리). 실측(2026-09-10 · `sub-mtutwato-wu2ffu`): 14분 세션에서 블록이
 * 스트림 154줄 중 150번째, **끝나기 37초 전**에 딱 한 번 왔고 그 한 번에 6단계·5완료가 통째로 들어왔다.
 * 목표 창은 "도는 동안 보고 멈추라"고 있는 것이라, 끝나고 켜지는 불은 없는 것과 같다.
 *
 * 같은 이유로 **면제를 특정 도구 이름에 걸지 않는다.** ㉑ 이 남겼던 "`TodoWrite` 가 있으면 그것으로 충분하다"는
 * 지금 거짓이다 — 설치본 CLI 에서 그 도구는 발화하지 않는다(실측: 최근 40 세션 `tool_use` 0건 · `--tools` 에
 * 이름을 실어 스폰한 세션의 도구 목록에도 없다). ⑨ 가 고쳤던 "계획할 수단 없이 계획하라고 시킨다"가 도구가
 * 사라지는 쪽으로 재발한 것이라, 이제 살아 있는 승계 도구(작업 장부)를 **덤으로만** 적는다.
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

/**
 * §5.5 #17-17 — 목표 블록 **전량**(상태 + 규약). §5.5 #17-28 의 주입원 표가 "이 세션에 목표 때문에
 * 얼마가 실리는가"를 한 줄로 재는 데 쓴다. 실제 발송은 둘로 갈라 나간다 — 상태는 매 턴 프롬프트로,
 * 규약은 스폰의 `--append-system-prompt` 로.
 */
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

/**
 * §4 v3.21 — 스폰 프롬프트 주입용 피드백 다이제스트 블록 생성.
 *
 * 사용자가 이 에이전트의 과거 작업에 남긴 좋아요/싫어요를 `# Past User Feedback` 블록으로
 * 만들어 매 턴 contextSummary 에 붙인다(Agent Rules 블록과 같은 자리 — 즉효 학습 경로).
 * 싫어요+사유가 학습 재료의 핵심이라 싫어요를 먼저, 좋아요는 "이런 방식은 좋았다" 보조로.
 * 피드백이 없으면 빈 문자열(블록 자체를 만들지 않음).
 */
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
 * §4 v2.83 — CMD(인터랙티브 터미널) 에이전트 카드 신고용 **터미널 한 줄 마커**.
 *
 * 헤드리스/스폰 에이전트는 loopback `curl` 로 카드 엔드포인트를 직접 친다(토큰 인증). 하지만 인터랙티브
 * 터미널 claude 는 그 loopback 포트/토큰을 모르고(셸 prefill 경로), curl 한 줄 구성도 번거롭다. 대신
 * **터미널 stdout 에 이 마커로 시작하는 한 줄을 인쇄**하면, 이미 PTY 출력을 받고 있는 IDE 터미널 뷰
 * (`IDETerminalView` → `TerminalCardSniffer`)가 그 줄을 스니핑 → JSON 파싱 → 기존 카드 엔드포인트로 POST 한다.
 * 즉 "cmd 창에 JSON 을 뿌리면 IDE 가 캡처해 카드로 재작성"하는 경로. 마커를 두는 이유: claude 가 평소
 * 출력하는 임의 JSON·코드블록·파일 내용을 카드로 오인하지 않게(마커 없는 줄은 그냥 터미널 텍스트).
 */
export const VIBISUAL_CARD_SENTINEL = '::VIBISUAL-CARD::';

/**
 * §4 v2.83 — CMD 에이전트에게 주입할 "카드 신고(터미널 한 줄)" 프로토콜 지시문.
 *
 * `prepareInteractiveRulesDir` 가 CMD 에이전트의 `~/.vibisual/cmd-agents/<id>/CLAUDE.md` 에 항상 붙여,
 * 인터랙티브 claude 가 작업 신고/질문/검수 카드를 **터미널 한 줄 인쇄**로 띄울 수 있게 한다. 동적 포트·토큰·
 * agentId 가 필요 없다(IDE 가 그 줄을 캡처할 때 agentId·subAgentId 를 문맥에서 주입) → 헤드리스 curl 지시문
 * (`buildAgentReportRules` 등)보다 단순. 발생 조건(언제 보내는지)은 curl 판본과 동일하게 유지한다.
 */
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

2) 사용자 질문 — 사용자에게 **질문을 던지며 답을 기다리는 보고**에서만. 각 질문에 제안 응답 프롬프트(0~N)를 단다.
\`\`\`bash
echo '${S}{"kind":"questions","items":[{"question":"이 순서로 진행할까요?","header":"진행 순서 확인","prompts":["네, 그 순서로 진행해 주세요.","아니요, B안으로 가 주세요."]}]}'
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
(읽는 순서는 늘 맥락 → 카드). 인쇄한 뒤에는 본문을 더 붙이지 마라 — 붙이면 카드가 다시 중간에 낀다.
**특히 "검수 카드로 보냈습니다" · "작업 신고 카드로 정리해 보냈습니다" 같은 발송 사실 보고를 쓰지 마라**(§5.5 #17-18 ⑦-5) —
카드는 이미 화면에 떠 있어 그 한 줄은 아무것도 더 알려주지 않으면서 카드마다 똑같이 반복된다. 덧붙일 맥락이 없으면


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
- 토큰 헤더가 없으면 401 이다. 실패해도 무시하고 자연어 보고는 그대로 진행하라(표시 전용).**아무 말도 하지 말고 그대로 끝내라.**`;
}

/**
 * Auto Agent 본체에 자동 박히는 기본 rules (사용자가 AgentConfigPopup 에서 덮어쓰기 가능).
 * 본인은 작업하지 않고 메타 동작(생성·디스패치·요약 수령)만 한다는 책임 분리 명시.
 */
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

// ─── §4 v3.16 모바일 웹 접속 모드 ────────────────────────────────────────────

/** 페어링 코드 자릿수 — 데스크톱 모달에 표시되고 폰 브라우저 첫 접속 시 입력한다. */
export const MOBILE_PAIR_CODE_LENGTH = 6;

/** 페어링 실패 허용 횟수 — 초과 시 코드 재생성 전까지 페어링 잠금(무차별 대입 방지). */
export const MOBILE_PAIR_MAX_ATTEMPTS = 10;

/** 동시 유지되는 페어링 세션(기기) 수 상한 — 초과 시 가장 오래된 세션부터 밀어낸다. */
export const MOBILE_SESSION_MAX = 5;

/** 페어링 성공 시 폰 브라우저에 심는 HttpOnly 세션 쿠키 이름. */
export const MOBILE_SESSION_COOKIE = 'vibisual_mobile_session';

// ─── §4 v3.20 UPnP 외부 개방 + 보안 강화 ─────────────────────────────────────

/**
 * 외부(인터넷) 개방이 켜졌을 때 승격되는 페어링 코드 길이(영숫자).
 * LAN 전용 6자리 숫자와 달리 공인망 노출이라 무차별 대입 내성이 필요 — 12자 영숫자.
 */
export const MOBILE_EXTERNAL_PAIR_CODE_LENGTH = 12;

/** 한 IP 가 페어링 실패 한도를 넘겼을 때 차단하는 시간(ms). 소유자 lockout 없이 공격자만 격리. */
export const MOBILE_PAIR_BAN_MS = 10 * 60 * 1000;

/** UPnP 포트 매핑 임대 시간(초). 이 절반 주기로 갱신해 공유기가 매핑을 지우지 않게 한다. */
export const MOBILE_UPNP_LEASE_S = 3600;

// ─── §4 v3.66 QR 페어링 티켓 ─────────────────────────────────────────────────

/**
 * QR 페어링 티켓 수명(ms). 발급 후 이 시간이 지나면 스캔해도 무효 —
 * 화면에 잠깐 띄우는 용도라 짧게 잡는다(사진에 찍혀 남아도 곧 죽는다).
 */
export const MOBILE_QR_TICKET_TTL_MS = 3 * 60 * 1000;

/** QR 티켓 토큰 바이트 수(hex 인코딩 전) — 3분 안에 맞힐 수 없는 수준. */
export const MOBILE_QR_TOKEN_BYTES = 24;

/**
 * QR 한 장으로 페어링할 수 있는 **기기 수 상한**.
 *
 * 종전에는 횟수를 세기만 하고 막지 않아, 3분 창 안에서는 몇 대든 붙을 수 있었다. QR 은 화면에
 * 띄우는 물건이라 어깨너머·화면 공유·사진으로 새기 쉽고, 그 순간 남은 시간 전체가 열린 문이 된다.
 * 내 폰 한 대 + 태블릿 정도를 넉넉히 덮으면서 "새면 몇 대든"을 끊는 자리로 3 을 잡는다.
 * 상한에 닿으면 티켓은 즉시 폐기된다 — 남겨 두면 만료까지 계속 시도할 수 있다.
 */
export const MOBILE_QR_MAX_USES = 3;

/** QR 에 담기는 딥링크 경로. `?t=<token>` 을 붙여 스캔 즉시 세션 쿠키를 받는다. */
export const MOBILE_QR_PATH = '/mobile/qr';

/** QR 딥링크의 토큰 쿼리 파라미터 이름. */
export const MOBILE_QR_PARAM = 't';

// ─── §4 (판올림 번호 발급 대기) 접속 주소의 정체 ──────────────────────────────

/**
 * 네트워크 어댑터 이름 사전의 한 줄 — 이름만 보고 그 랜카드가 무엇인지 말한다.
 *
 * `label` 은 i18n 키가 아니라 **제품 이름 그대로**다(`EXTERNAL_PLACE_PATTERNS` 와 다른 점).
 * Tailscale·Docker 는 어느 언어에서도 그 이름이라 번역 대상이 아니고, 화면에는 사용자가
 * 자기 PC 의 어댑터 목록에서 본 것과 **같은 글자**가 떠야 정체가 연결된다.
 *
 * `test` 는 어댑터 이름을 소문자로 접어 맞춘다. 같은 제품이라도 이름이 OS 마다 전혀
 * 다르므로(Windows `Tailscale` · macOS `utun3` · Linux `tailscale0`) 별칭을 한 줄에 모은다.
 */
export interface MobileAdapterPattern {
  /** 어댑터 이름(소문자)에 대한 판정. */
  readonly test: RegExp;
  /** 화면에 그대로 띄울 제품 이름. */
  readonly label: string;
}

/**
 * **가상 사설망(VPN) 어댑터 사전** — 이 주소는 폰이 *같은 망에 들어와 있으면* 실제로 열린다.
 *
 * 순서가 우선순위다(구체적인 것이 먼저). 맨 끝의 `utun`/`tun` 은 macOS·Linux 의 **공용**
 * 터널 이름이라 어느 제품인지 알 수 없다 — 그래서 `label` 을 비워 두고, 화면은 제품 이름
 * 대신 "가상 사설망" 이라는 종류만 말한다(모르는 것을 넘겨짚지 않는다).
 */
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

/**
 * **가상 어댑터 사전** — 이 주소는 이 PC 안에서만 뜻이 있어서 **폰에서는 절대 안 열린다**.
 *
 * 가상머신·컨테이너·WSL 이 만든 랜카드다. 지우지 않고 목록에 남기되(감추면 진짜로 되는
 * 경우까지 사라진다) "안 됩니다" 쪽으로 접어 둔다 — 종전에는 이것들이 진짜 랜 주소와
 * 구별 없이 나란히 떠서 사용자가 무엇을 찍어야 하는지 알 수 없었다.
 */
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

/**
 * 완료음 창 간 중복 재생 차단 창(ms).
 *
 * 완료음은 WS 를 듣는 창마다 재생되는데(메인·별창·오버레이 셸이 각각 구독) 같은 완료 하나에
 * 소리가 겹쳐 두세 번 울리는 것처럼 들린다. 먼저 울린 창이 localStorage 에 시각을 남겨 이 창
 * 안의 다른 창은 건너뛴다(저장소 접근이 막히면 종전대로 재생 — fail-open).
 */
export const COMPLETION_CHIME_DEDUPE_MS = 1_500;

/**
 * §5.10 v2 (C) (판올림 번호 발급 대기) — **회상이 돌려주는 대목에서 가리는 것.**
 *
 * 회상은 카드가 아니라 **그때 실제로 오간 대화**를 발췌한다. 그 대화에는 우리가 프롬프트로 실어
 * 보냈던 loopback 토큰·API 키가 그대로 남아 있고, 발췌는 **다른 세션의 모델 컨텍스트로 간다** —
 * 즉 마스킹이 없으면 회상이 시크릿 배포 경로가 된다. 세 가지만 가린다(오탐이 정보를 지우는 쪽이
 * 더 나쁘다):
 *
 * ① 헤더 이름 뒤의 값 — 길이와 무관하게 그 자리는 언제나 시크릿이다.
 * ② **48자 이상** 연속 hex — loopback 토큰이 `randomBytes(24)`(=48자)라 여기 걸린다.
 *    git 커밋 해시(40자)는 **일부러 통과시킨다** — 회상에서 해시는 실제로 쓸모가 있다.
 * ③ 발행처 접두사가 뚜렷한 API 키.
 */
export const SECRET_REDACTION_PATTERNS: readonly RegExp[] = [
  /(x-vibisual-hook-token\s*:\s*)[^\s"'\\]+/gi,
  /\b[0-9a-f]{48,}\b/gi,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
];

/** 가린 자리에 남기는 표시 — 지워진 것이 아니라 가려진 것임을 읽는 쪽이 알아야 한다. */
export const SECRET_REDACTION_MASK = '[redacted]';

/**
 * 위 패턴에 걸리는 자리를 가린다. **순수 함수** — 서버·클라 어디서 불러도 같은 답이고 테스트가 직접 부른다.
 * 헤더 패턴은 이름을 남기고 값만 가린다(무엇이 가려졌는지 읽는 쪽이 알아야 한다).
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_REDACTION_PATTERNS) {
    // 전역 플래그가 붙은 정규식은 `lastIndex` 가 남으므로 매번 초기화한다(같은 배열을 재사용한다).
    re.lastIndex = 0;
    // 첫 인자(전체 일치)는 쓰지 않지만 `prefix` 를 받으려면 자리를 비워 둘 수 없다.
    //
    // **두 번째 인자가 캡처 그룹이라는 보장이 없다.** `String.replace` 는 그룹이 없는 정규식에서는
    // 그 자리에 **일치 위치(number)** 를 넘긴다 — 위 배열은 그룹이 있는 패턴(헤더)과 없는 패턴
    // (hex·sk-)이 섞여 있어, `undefined` 만 걸러 내면 없는 쪽에서 숫자가 그대로 결과에 붙었다
    // (`token=6[redacted]`). 그래서 **문자열일 때만** 접두로 인정한다.
    out = out.replace(re, (_match: string, prefix: unknown) =>
      typeof prefix === 'string' ? `${prefix}${SECRET_REDACTION_MASK}` : SECRET_REDACTION_MASK);
  }
  return out;
}

// ─── 플러그인 커널 (§5.11 v3.88) ───

/**
 * v1 에서 호스트가 실제로 슬롯을 연 기여 종류.
 *
 * 매니페스트가 이 목록 밖의 기여를 선언하면 **거부가 아니라 "미지원" 표시**다 — 플러그인은 등록되고
 * 지원되는 기여만 렌더된다. 슬롯을 새로 열 때 이 배열에 한 줄 추가하는 것이 개통 절차.
 */
export const PLUGIN_SUPPORTED_CONTRIBUTIONS: readonly PluginContributionKind[] = [
  'bubbleBadge',
  'panelSection',
  'settingsSection',
  // v4.01 — 헤더 기여 개통. 버블·패널과 달리 **동작**을 가질 수 있는 유일한 슬롯이며,
  // 그 동작도 호스트가 이름 붙여 연 것(`PluginActions`)만 쓸 수 있다.
  'headerItem',
  // v4.57 — 집행 슬롯 개통. 위 4종이 "보여 주는" 자리라면 이것은 **에이전트가 실제로 그렇게 일하게 하는**
  // 자리다(매 턴 프롬프트 블록). 사용자 지시 — "켜면 화면 한 칸 느는 게 전부면 만든 게 아니다".
  'agentPrompt',
];

/** 플러그인 id 규약 — kebab-case. 네임스페이스 4종(REST·WS·버블타입·설정키)의 공통 키. */
export const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** 플러그인 REST 기여의 유일한 마운트 지점 — `/api/plugins/<id>/*` 밖으로 나갈 수 없다. */
export const PLUGIN_API_PREFIX = '/api/plugins';

/**
 * §5.13 (P) v4.49 — 내부 앱 REST 네임스페이스.
 *
 * 앱의 모든 경로는 `/api/app/<앱id>/…` 아래로 들어간다(플러그인의 `/api/plugins/<id>/…`
 * 와 같은 규약). 그래야 코어가 앱 이름을 모른 채로도 "앱 경로인가"를 한 줄로 판정할 수
 * 있다 — loopback 화이트리스트에 앱 이름이 박히던 것이 이 규칙이 없어서 생긴 일이다.
 */
export const APP_API_PREFIX = '/api/app';

// ─── §5.5 #17-20 v4.74 디버그·실행 런처 ────────────────────────────────────

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

/**
 * §5.5 #17-20 ③ — 런타임별 "평범한 실행 → 디버거가 붙을 수 있는 실행" 변환 규칙.
 *
 * `match` 로 명령을 알아보고 `apply` 가 같은 명령에 디버그 인자를 얹는다. 하드코딩된 분기 대신
 * 표로 두는 이유는 §3.3(설정과 로직 분리) — 런타임을 하나 더 지원하려면 여기 한 줄이면 된다.
 */
export interface DebugLaunchRecipe {
  runtime: RunRuntime;
  /** 명령 문자열을 보고 이 런타임인지 판정. */
  match: (command: string) => boolean;
  /**
   * 디버그로 켜는 방법. 얹을 수 없으면 null(그대로 실행하고 화면에 그 사실을 적는다).
   *
   * 셸 문법(`set X=… &&` 대 `X=… cmd`)으로 갈리지 않도록 **환경변수는 `env` 로 돌려준다** —
   * 이 값은 PTY spawn 의 env 에 실리므로 Windows·POSIX 어느 쪽에서도 같은 코드가 통한다.
   * (shared 는 브라우저에서도 로드되므로 `process.platform` 을 읽어서는 안 된다.)
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
     * 언리얼 C++ 를 멈춰 세우는 `cppvsdbg` 는 재배포할 수 없다(⑦). 그래서 우리가 하는 일은
     * **에디터를 디버거가 붙을 수 있는 상태로 띄우는 것**까지다:
     *
     *   - `-WaitForDebugger` — 디버거가 붙을 때까지 엔진이 초기화 직전에 멈춰 선다. 이것이
     *     있어야 "붙이기" 를 누를 시간이 생기고, 시작 코드에 건 중단점도 놓치지 않는다.
     *   - `-stdout -FullStdOutLogOutput` — 로그가 별창이 아니라 **우리 출력 패널**로 흐른다.
     *
     * 붙이는 일 자체는 서버가 실행 중인 에디터 pid 를 찾아 JIT 디버거에 넘긴다.
     * (포트를 쓰지 않는 유일한 런타임이라 `port` 를 받지 않는다 — 네이티브는 pid 로 붙는다.)
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

/**
 * §5.5 #17-20 ③ — 실행 구성 + 포트 → 디버그 명령.
 *
 * `config.debugCommand` 가 있으면 그것이 최우선(사용자·launch.json 이 직접 쓴 것). 변환할 수
 * 없으면 `{ command: 원본, note: 'unsupported' }` 를 돌려주고 **화면이 그 사실을 그대로 적는다** —
 * 조용히 평범하게 실행해 놓고 디버그인 척하지 않는다.
 */
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

// ─── §5.5 #17-20 ⑩ v4.94 — 공통 디버그 층: 런타임 → 실제로 붙는 법 ─────────────
//
// `DEBUG_LAUNCH_RECIPES`(③)가 "붙을 수 있게 띄우는" 표라면 이 표는 "붙는" 표다. 둘을 갈라 둔
// 이유는 축이 다르기 때문이다 — 띄우는 것은 셸 명령이고, 붙는 것은 프로토콜이다.
// **여기 한 줄을 더하면 그 런타임이 같은 화면(중단점·스텝·콜스택·변수)을 얻는다.**

/** DAP 어댑터 인자의 자리 표시자 — 매니저가 실제로 고른 포트로 바꿔 넣는다. */
export const DEBUG_ADAPTER_PORT_TOKEN = '{{adapterPort}}';

/** TCP 어댑터를 띄울 때 포트를 고르기 시작하는 자리(디버기 포트대와 겹치지 않게 위쪽). */
export const DEBUG_ADAPTER_PORT_BASE = 9430;

/** 어댑터가 응답할 때까지 기다리는 한계(ms). 넘으면 "어댑터가 뜨지 않았다"고 그대로 적는다. */
export const DEBUG_ADAPTER_READY_TIMEOUT_MS = 8_000;

/** 요청 한 건(DAP/CDP 공통)의 응답 대기 한계(ms). */
export const DEBUG_REQUEST_TIMEOUT_MS = 10_000;

/**
 * §5.5 #17-20 ⑩ — 런타임별 연결법.
 *
 * **상업적 사용이 가능한 것만 올린다.** Microsoft `vsdbg`·`cppvsdbg` 는 자사 IDE 전용이라
 * 이 표에 들어오지 못하고 `delegated`(⑦ 외부 디버거로 넘김)로 남는다. 그 한 줄을 빼면
 * 주요 런타임의 디버그 어댑터는 전부 permissive 라 우리 앱이 그대로 쓸 수 있다.
 */
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

// ─── §5.5 #17-20 ⑪ v4.94 — 출력 한 줄에서 문제를 뽑는 공통 매처 ────────────────
//
// 언리얼을 위한 표가 아니다. 같은 표에 node·tsc·eslint·python·go·rust·MSVC·gcc/clang·java 가
// **각각 한 줄**로 들어 있고 언리얼도 그중 한 줄일 뿐이다. 어느 줄에도 안 걸리면 `null` 이고
// 그 출력은 평문 그대로 남는다 — 모르는 것을 아는 척 칠하지 않는다.

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

/**
 * §5.5 #17-20 ⑥ — 에이전트에 꽂아 줄 MCP 서버 프리셋.
 *
 * 전부 **남이 만든 것**이고 우리는 실행법만 안다. 여기 한 줄을 더하면 그 서버가 화면의
 * 체크박스로 나타나고, 켜는 순간 `--mcp-config` 파일에 실려 스폰되는 세션이 그 도구를 갖는다.
 */
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

/**
 * 프리뷰 ↔ 주입 스크립트가 주고받는 메시지의 출처 표식.
 *
 * 프리뷰 안의 페이지가 자기 목적으로 `postMessage` 를 쓰는 일은 흔하므로, 이 문자열이 없는
 * 메시지는 양쪽 모두 무시한다(남의 메시지를 우리 것으로 오인하지 않는다).
 */
export const PREVIEW_PICK_SOURCE = 'vibisual-preview';

/** 집은 요소에서 가져올 텍스트 길이 상한. */
export const PREVIEW_PICK_TEXT_MAX = 80;

/**
 * §7.11 (G) — 프리뷰 안에서 누른 **Alt** 를 부모(우리 창)에게 넘기는 메시지의 종류.
 *
 * `{ source: PREVIEW_PICK_SOURCE, type: PREVIEW_ALT_MESSAGE, down: boolean, shift: boolean }`.
 * 세 곳(주입 스크립트·`usePreviewPicker`·`useInspector`)이 같은 낱말을 봐야 하므로 여기 한 곳에 둔다 —
 * 문자열을 각자 적어 두면 한쪽만 고쳐져 다리가 조용히 끊긴다.
 */
export const PREVIEW_ALT_MESSAGE = 'alt';

/** 부모 → 프리뷰: Alt 를 우리가 가져갈지(`on`). 헤더 토글이 이 메시지를 보낸다. */
export const PREVIEW_ALT_CAPTURE_MESSAGE = 'alt-capture';

/**
 * §7.16 — 프리뷰 → 부모: **마우스가 이 프레임 안에 있다/없다**(`on`).
 *
 * `{ source: PREVIEW_PICK_SOURCE, type: PREVIEW_HOVER_MESSAGE, on: boolean }`.
 *
 * 프리뷰를 담은 우리 스크롤 상자는 마우스가 iframe 위로 들어간 순간 **아무 것도 받지 못한다**
 * (인스펙터가 켜질 때 iframe 의 `pointer-events` 를 일부러 끄는 것도 같은 이유다). 그래서 상자의
 * `:hover` 가 서지 않고, 기본 숨김인 스크롤바가 **굴릴 때만** 떴다 — 마우스를 대도 "여기 더 있다"가
 * 아무 데도 안 보인다. Alt 와 같은 까닭·같은 다리라, 안에서 들고 남을 알려 그 hover 를 대신 세운다.
 */
export const PREVIEW_HOVER_MESSAGE = 'hover';

/**
 * §7.11 (G) — Alt 를 **우리가 먼저 가진다**(기본 `true`).
 *
 * Alt 인스펙터는 앱 어디서나 같은 손짓이어야 하는데, 프리뷰 안은 오리진이 달라 그 자리만 죽어
 * 있었다("여기선 왜 안 되냐"). 그래서 기본은 우리 것이 강제고, 안에서 도는 앱이 Alt 를 쓰는
 * 경우를 위해 프리뷰 헤더의 토글로 **양보**한다 — 끄면 이 다리가 통째로 쉬고 키는 페이지 몫이다.
 */
export const PREVIEW_ALT_CAPTURE_DEFAULT = true;

/**
 * 프리뷰 폭 프리셋 — Auto / 모바일 / 태블릿 / 데스크톱.
 *
 * `transform: scale()` 로 줄이지 않고 **실제 폭**으로 렌더한다(축소하면 미디어쿼리가 실제 폭을
 * 못 보고, "모바일에서 어떻게 보이나"를 확인하려던 목적 자체가 무너진다).
 */
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

/**
 * §5.17 (A) — `compare` 칸이 나란히 놓을 폭들.
 *
 * 목록을 따로 적지 않고 **위 표에서 폭이 있는 칸 전부**로 파생한다 — 프리셋을 한 줄 더 넣으면
 * 비교 줄도 함께 늘어난다(§3.3 하드코딩 ❌). `auto`/`compare` 는 폭이 없어 자연히 빠진다.
 */
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

/**
 * §5.17 (B) — 이보다 작게 그은 사각형은 오조작으로 보고 버린다(가로·세로 둘 다 이 값 이상이어야 한다).
 * 캡처 모드를 켠 채 무심코 클릭한 것과 "여기를 찍겠다" 를 가르는 선이다.
 */
export const PREVIEW_SNIP_MIN_PX = 8;

// ─── §5.19 All Model — 로컬 LLM ───

/**
 * §5.19 (B) — All Model 설치 식별자.
 * `UserDefaults.installedApps` 에 이 id 가 들어가면 "설치했다"는 뜻이다(새 영속 필드 발명 ❌).
 * 다만 이 플래그는 사용자의 의사일 뿐이고, **실제로 켜지는 판정은 디스크의 실물**이 한다.
 */
export const ALL_MODEL_INSTALL_ID = 'allmodel';

/** §5.19 (D) — llama.cpp 최신 릴리스 조회. **빌드 번호를 코드에 박지 않는다.** */
export const LLAMA_RELEASE_LATEST_API = 'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest';

/**
 * §5.19 (D) — 릴리스 **목록** 조회.
 *
 * `/releases/latest` 는 prerelease 가 아닌 것만 돌려주는데, llama.cpp 가 릴리스 체계를 바꿔
 * 그 자리에 자산이 `nightly-tag.txt` 하나뿐인 태그(`v0.3.0`)가 앉았다. 플랫폼별 실제 바이너리
 * (win/macos/ubuntu × cpu/vulkan/cuda)는 전부 `b#####` 형태의 **prerelease 태그**에만 붙는다.
 * 그래서 목록을 받아 **자산을 실제로 가진 가장 최근 릴리스**를 골라야 한다.
 * (2026-08-26 실측: `/releases/latest` → assets 1개(zip 0개) → 전 플랫폼 설치 실패.)
 */
export const LLAMA_RELEASES_LIST_API = 'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=20';

/**
 * §5.19 (B) (판올림 번호 발급 대기) — **내려받은 엔진 압축파일이 발행처가 올린 그것인가.**
 *
 * GitHub 릴리스 자산은 `.sha256` 사이드카를 따로 올리지 않는다(2026-09-08 실측) — 대신 자산
 * JSON 에 `digest: "sha256:<64 hex>"` 가 들어 있다. 우리는 그 목록을 **이미 TLS 로** 받아 자산을
 * 고르고 있으므로, 별도 요청 없이 그 값을 그대로 대조하면 된다(요청을 하나 더 늘리지 않는다).
 *
 * 모양이 다르거나 비어 있으면 `null` — 부르는 쪽이 "검증 못 함"과 "불일치"를 가를 수 있게 한다.
 */
export function parseAssetSha256(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^sha256:([0-9a-f]{64})$/i.exec(value.trim());
  return m?.[1] ? m[1].toLowerCase() : null;
}

/**
 * §5.19 (D) — 기본 설치 백엔드.
 * Vulkan 한 벌이 NVIDIA·AMD·Intel 을 함께 덮고(33MB 급), CPU(18MB 급)는 폴백이다.
 * CUDA 는 빌드가 크고 런타임이 없으면 `cudart` 를 더 받아야 해서 **기본이 아니라 선택**이다.
 */
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
 * §5.19 (E) — **대화용이 아니라고 스스로 밝힌** 저장소의 작업 태그. 목록에서 뺀다.
 *
 * **왜 화이트리스트가 아닌가 (2026-08-21 실측)**: `pipeline_tag=text-generation` 만 남기는
 * 반대 방향을 먼저 재 봤더니, 인기 GGUF 40건 중 그 태그를 단 것은 **6건뿐**이었다. 정작
 * 대화가 되는 `unsloth/Qwen3.8-27B-GGUF`(태그 없음) · `unsloth/Qwen3.6-35B-A3B-GGUF`
 * (`image-text-to-text`) · `unsloth/gemma-4-12B-it-qat-GGUF`(`any-to-any`) 가 통째로 사라졌다 —
 * 좋은 저장소일수록 태그를 안 달거나 멀티모달 태그를 단다.
 *
 * 그래서 판정을 뒤집는다. **모르면 막지 않고**(태그가 없으면 통과), 음성인식·임베딩·이미지
 * 생성처럼 **애초에 대화가 아닌 것**만 뺀다. 사용자가 1.18GB 음성인식 모델(`parakeet-ctc`)을
 * 받아 놓고 프롬프트를 친 뒤에야 알게 되던 그 자리가 여기다.
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

/**
 * §5.19 (E) — 이 저장소를 받기 목록에 올릴 것인가. **태그가 없으면 올린다**(모르면 막지 않는다).
 * 판정은 여기 한 곳에서만 — 서버가 거르고 화면이 다르게 말하면 사용자는 둘 다 안 믿는다.
 */
export function isChatCapablePipelineTag(pipelineTag: string | null | undefined): boolean {
  if (!pipelineTag) return true;
  return !LOCAL_MODEL_NON_CHAT_PIPELINE_TAGS.includes(pipelineTag);
}

/** §5.19 (E) — 한 저장소에서 보여 줄 GGUF 파일(양자화) 상한. */
export const LOCAL_MODEL_FILE_LIMIT = 40;

/**
 * §5.19 (E) — 저장소를 펼쳤을 때 **먼저 서는** 양자화 개수. 나머지는 한 줄 뒤로 접힌다.
 *
 * 스무 갈래를 한꺼번에 늘어놓는 것은 고르라는 말이 아니라 알아서 공부하라는 말이다.
 * 셋인 이유는 "가장 많이 쓰는 것 + 한 단계 위 + 한 단계 아래"가 대개 그 안에 들어오기
 * 때문이다 — 그보다 아래는 접어 두되, 누르면 전부 보인다(숨기는 것이 아니라 미뤄 두는 것).
 */
export const LOCAL_MODEL_TOP_QUANT_COUNT = 3;

/**
 * §5.19 (E) — 양자화가 **얼마나 많이 쓰이는가**의 순위(작을수록 앞에 선다).
 *
 * **왜 표를 드는가**: 카탈로그는 저장소 단위 내려받기 수만 준다 — 같은 저장소 안에서
 * `Q4_K_M` 과 `IQ1_S` 중 무엇이 더 받혔는지는 어디에도 없다(2026-08-24 확인). 그래서 파일
 * 순서만은 우리가 정해야 하고, 근거는 llama.cpp 진영에서 굳어진 통용 순서다 — `Q4_K_M` 이
 * 기본, 여유가 있으면 `Q5_K_M`·`Q8_0`, 모자라면 `Q3`·`IQ` 로 내려간다. 올라마가 태그 없는
 * 저장소에서 `Q4_K_M` 을 집는 것도 같은 순서를 따른 것이다.
 *
 * **순위는 숨기는 장치가 아니다** — 표에 없는 이름은 뒤로 갈 뿐 목록에서 빠지지 않는다.
 * 값을 5씩 띄운 것은 새 양자화가 나왔을 때 사이에 끼워 넣기 위함이다.
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

/**
 * §5.19 (E) — 이 양자화가 목록에서 몇 번째로 설 것인가. 판정은 여기 한 곳에서만 한다.
 * 대소문자를 가리지 않으며(`q4_k_m` 도 같다), unsloth 의 `UD-` 접두는 파일명을 읽는 쪽
 * (`parseQuant`)이 이미 떼고 넘겨 준다.
 */
export function quantRank(quant: string | null | undefined): number {
  if (!quant) return QUANT_RANK_UNKNOWN;
  return QUANT_POPULARITY[quant.toUpperCase()] ?? QUANT_RANK_UNKNOWN;
}

/**
 * §5.19 (E) — 카탈로그를 어떤 축으로 줄 세울 것인가.
 *
 * 이 값은 **카탈로그에 그대로 넘긴다** — 받아 온 스무 건을 우리가 다시 정렬하면 "하트순
 * 1위"가 그 스무 건 안에서만 1위가 되어, 사용자가 보는 순위와 실제 순위가 갈린다.
 */
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

/**
 * §5.19 (E) — 가중치 말고도 자리가 든다(문맥 캐시·작업 버퍼). 파일 크기에 이만큼 얹어
 * 잡는다. 후하게 잡아 "된다고 했는데 안 되는" 쪽보다 "된다고 안 했는데 됐다" 쪽으로 튄다.
 */
export const LOCAL_MODEL_OVERHEAD_RATIO = 1.2;
/** 위 비율에 더해 붙는 고정 여유(문맥 16K 기준 대략치). */
export const LOCAL_MODEL_OVERHEAD_BYTES = 1_500_000_000;
/** 시스템 메모리는 다 쓸 수 없다 — OS·앱이 쓸 몫을 남긴다. */
export const LOCAL_MODEL_RAM_USABLE_RATIO = 0.7;

/**
 * §5.19 (E) — 이 모델이 이 PC 에서 어떻게 돌지 판정한다.
 *
 * **판정 규칙은 한 곳에만 둔다** — 서버가 고르고 화면이 다르게 말하면 그 순간부터
 * 사용자는 둘 다 안 믿는다. 잴 수 없으면 `unknown` 으로 정직하게 물러난다(넘겨짚어
 * "돌아갑니다"라고 말하는 것이 가장 나쁘다).
 */
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

/**
 * §5.19 (D) — 사용자가 고를 수 있는 대화 창의 아래·위 끝.
 *
 * 아래는 도구 정의만으로도 차 버리지 않을 만큼, 위는 요즘 모델이 실제로 학습된 길이까지.
 * 위 끝을 넘겨 잡아도 소용이 없다 — 모델의 학습 문맥이 더 작으면 그 값으로 낮춰서 뜬다.
 */
export const LOCAL_CONTEXT_MIN = 2048;
export const LOCAL_CONTEXT_MAX = 262_144;

/**
 * §5.19 (D) — 답 길이 상한이 문맥에서 차지하는 몫. 나머지는 프롬프트·이력이 쓴다.
 *
 * **왜 고정값이 아닌가 (2026-08-21 실측)**: 종전에는 4,096 고정이었다. 그런데 생각을 길게
 * 하는 모델은 그 상한을 **생각으로만** 다 써 버리고 답을 한 글자도 못 쓴다 — Qwen3.8-27B 에
 * debounce 구현을 시키자 16,950자를 생각하다 4,096 토큰을 소진하고 빈 답으로 끝났다
 * (`finish_reason=length`). 사용자에게는 "105초를 돌더니 아무 말도 안 한" 것으로 보인다.
 * 문맥을 늘린 사용자는 답 길이도 함께 늘어나야 한다.
 *
 * 상한 자체를 없애지는 않는다 — 로컬은 느려서 끝을 모르면 사람이 하염없이 기다린다.
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
 * §5.19 (D) — 이 문맥에서 한 턴에 만들 토큰 상한. **판정은 여기 한 곳에서만.**
 *
 * `promptTokens` 를 주면 **남은 자리 안에서** 잡는다. 종전에는 창의 75% 고정이라, 이력이
 * 길어져 프롬프트가 창의 절반을 먹은 뒤에도 여전히 75% 를 달라고 했다 — 엔진은 그걸 거절하지
 * 않고(400 은 프롬프트만 본다) 대신 **생성 도중 창 끝에 닿아 답을 자른다**. 사용자에게는
 * "말하다 만 답"으로 보인다. 프롬프트 토큰 수는 직전 왕복의 `usage` 로 공짜로 알 수 있다.
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
 * §5.19 (D) — 그중 **생각**이 쓸 수 있는 몫. 나머지가 실제 답이 된다.
 *
 * **왜 사고에 상한이 필요한가 (2026-08-21 실측)**: 답 예산을 4,096 → 12,288 으로 늘려도
 * Qwen3.8-27B 은 debounce 구현 하나에 48,352자를 생각하다 **예산을 통째로 소진하고 빈 답**
 * 으로 끝났다(5분 19초). 예산을 더 키우는 것은 답이 아니다 — 생각이 스스로 멈추지 않는다.
 * 엔진의 `--reasoning-budget` 로 여기서 끊으면 모델은 결론을 내고 답을 쓴다(같은 과제,
 * 사고 3,072 상한 → `finish_reason=stop`, 1,931자짜리 정상 구현).
 *
 * 생각이 없는 모델에는 아무 영향이 없다 — 쓸 일이 없는 몫이다.
 */
export const LOCAL_THINKING_BUDGET_RATIO = 0.25;

/** §5.19 (D) — 이 문맥에서 생각에 허용할 토큰. **판정은 여기 한 곳에서만.** */
export function localThinkingBudget(contextSize: number): number {
  const ctx = contextSize > 0 ? contextSize : LOCAL_DEFAULT_CONTEXT_SIZE;
  return Math.max(LOCAL_ANSWER_BUDGET_MIN, Math.floor(ctx * LOCAL_THINKING_BUDGET_RATIO));
}

// ─── §5.19 (H) 도구 — 로컬 모델이 파일을 읽고 고친다 ───

/**
 * §5.19 (H) — 한 턴에서 도구를 돌 수 있는 **최대 왕복 수**.
 *
 * 도구 대화는 "모델이 부른다 → 우리가 실행한다 → 결과를 돌려준다 → 모델이 또 부른다" 의
 * 되풀이라, 끝을 안 정하면 모델이 같은 도구를 무한히 부르는 동안 사람이 못 끊는다
 * ([중지]가 있지만 기본값에 끝이 있어야 한다 — 사고 예산과 같은 규율).
 */
export const LOCAL_TOOL_MAX_ROUNDS = 24;

/** 한 파일에서 읽어 모델에게 줄 최대 바이트. 넘으면 앞부분만 주고 잘렸다고 말한다. */
export const LOCAL_TOOL_READ_MAX_BYTES = 256 * 1024;

/** 도구 결과 한 건이 모델에게 갈 때의 글자 상한. 문맥을 한 번에 삼키지 않게. */
export const LOCAL_TOOL_RESULT_MAX_CHARS = 24_000;

/**
 * §5.19 (D)(H) — 토큰을 글자로 어림잡는 환산비. **문맥 예산을 글자로 재기 위한 것**이지
 * 정확한 토크나이저 대체물이 아니다(모델마다 다르다). 한글은 한 자에 한 토큰 가까이 가고
 * 영문·코드는 서너 자에 한 토큰이라, 그 사이에서 **적게 잡는 쪽**을 고른다 — 넘겨짚어 크게
 * 잡으면 예산을 넘긴 채로 엔진에 보내 400 을 맞고, 그쪽이 사용자에게 더 나쁘다.
 */
export const LOCAL_CHARS_PER_TOKEN = 3;

/**
 * §5.19 (H) — 도구 결과 **한 건**이 이 문맥에서 차지해도 되는 몫.
 *
 * **왜 고정 24,000자로는 안 되나 (2026-08-21 실측)**: 기본 문맥은 16,384 토큰인데 고정
 * 상한 24,000자는 그 절반을 훌쩍 넘게 삼킨다. 웹 페이지 한 장을 받아 온 도구 결과 하나가
 * 창을 다 먹고, 그다음 왕복에서 엔진이
 * `request (N tokens) exceeds the available context size (M tokens)` 로 **요청 자체를**
 * **400 으로 거절**했다. 한 건이 창의 4분의 1을 넘지 못하게 한다.
 */
export const LOCAL_TOOL_RESULT_CONTEXT_RATIO = 0.25;

/** §5.19 (H) — 이 문맥에서 도구 결과 한 건에 허용할 글자. **판정은 여기 한 곳에서만.** */
export function localToolResultBudget(contextSize: number): number {
  const ctx = contextSize > 0 ? contextSize : LOCAL_DEFAULT_CONTEXT_SIZE;
  const byContext = Math.floor(ctx * LOCAL_TOOL_RESULT_CONTEXT_RATIO * LOCAL_CHARS_PER_TOKEN);
  return Math.max(2_000, Math.min(LOCAL_TOOL_RESULT_MAX_CHARS, byContext));
}

/**
 * §5.19 (D) — 지난 이력이 문맥에서 차지해도 되는 몫. 나머지는 이번 턴의 질문·도구 왕복·답이 쓴다.
 *
 * **왜 상한이 필요한가**: 이력은 턴마다 이어 붙기만 하고 스스로 줄지 않는다. 상한이 없으면
 * 어느 세션이든 언젠가 문맥을 넘고, 그때부터 **그 버블은 무엇을 쳐도 400** 이 된다 — 되돌릴
 * 손잡이가 화면에 없으므로 사용자에게는 버블이 죽은 것과 같다.
 */
export const LOCAL_HISTORY_CONTEXT_RATIO = 0.5;

/** §5.19 (D) — 이 문맥에서 지난 이력에 허용할 글자. **판정은 여기 한 곳에서만.** */
export function localHistoryBudget(contextSize: number): number {
  const ctx = contextSize > 0 ? contextSize : LOCAL_DEFAULT_CONTEXT_SIZE;
  return Math.max(4_000, Math.floor(ctx * LOCAL_HISTORY_CONTEXT_RATIO * LOCAL_CHARS_PER_TOKEN));
}
/**
 * §5.19 (H) — 한 턴에서 **같은 도구를 같은 인자로** 몇 번까지 실제로 돌려줄 것인가.
 *
 * 작은 모델은 결과를 못 읽고 같은 호출을 되풀이한다. 왕복 상한(24)만 있으면 그 24번을 전부
 * 헛돌리며 사람은 몇 분을 기다린다. 그렇다고 한 번만 허용하면 **고친 뒤 다시 돌려 보는**
 * 정당한 재실행(편집 → 같은 테스트 명령)까지 막힌다 — 그래서 몇 번은 허용하고 그 뒤로는
 * 실행 대신 "방금 같은 호출을 했다"를 결과로 돌려준다.
 */
export const LOCAL_TOOL_REPEAT_LIMIT = 3;

/**
 * §5.19 (D) — 대화를 접을 때 요약이 쓸 수 있는 토큰.
 *
 * 넉넉하면 요약이 아니라 두 번째 대화가 되고, 인색하면 결정·파일 경로가 잘려 접은 값이
 * 쓸모없어진다. 400 낱말 안팎을 담을 만큼만 준다.
 */
export const LOCAL_COMPACT_MAX_TOKENS = 800;

/**
 * §5.19 (D) — 엔진에게 KV 조각을 이어 쓰게 할 최소 단위(토큰).
 *
 * 우리는 문맥이 넘치면 이력 **앞**을 잘라 낸다(§5.19 (D)). 그런데 앞이 바뀌면 토큰 프리픽스가
 * 달라져 엔진이 프롬프트를 **통째로 다시 평가**한다 — 로컬에서 그건 곧 수십 초다. 이 값을 주면
 * 엔진이 어긋난 앞부분만 버리고 뒤쪽 조각을 이어 쓴다. 256 은 llama.cpp 쪽에서 통용되는 크기.
 */
export const LOCAL_ENGINE_CACHE_REUSE = 256;
/** 목록·검색이 한 번에 돌려줄 최대 항목 수. */
export const LOCAL_TOOL_LIST_MAX_ENTRIES = 400;

/** §5.19 (H) — 검색 한 번이 모델에게 줄 최대 결과 수. 열 개를 넘겨도 고르는 일은 같다. */
export const LOCAL_WEB_SEARCH_MAX_HITS = 8;

/**
 * §5.19 (H) — 로컬 모델의 `WebSearch` 가 쓰는 검색 창구.
 *
 * **왜 여기로 왔나**: 종전에는 `html.duckduckgo.com` 의 결과 화면을 받아 HTML 을 파싱했다.
 * 키가 필요 없다는 장점 하나로 골랐지만, 그건 DDG 이용약관이 금지하는 자동 조회였다 —
 * 배포되는 제품이라 우리 사용자들이 차단 대상이 된다.
 *
 * **왜 이것인가**: 대안을 실측으로 훑은 결과 조건(무료 · 키 불필요 · 약관이 허용 · 일반 웹
 * 결과)을 다 만족하는 것은 이 하나였다.
 *  · DDG 공식 Instant Answer API — 키는 필요 없으나 즉답 전용이라 웹 결과가 **0건**(실측).
 *  · Mojeek — 자동 질의라며 **403** 으로 거절(실측).
 *  · Marginalia 공개 API — 동작하지만 공개 키는 **상업적 사용 금지**이고 결과가
 *    CC-BY-NC-SA 라, 제품에 실으면 지금보다 나쁜 자리로 간다.
 *  · Brave · Serper · Exa · Google CSE — 품질은 되지만 **사용자마다 키 발급**이 필요하다.
 *
 * Firecrawl 은 2026-06-16 자로 **키 없는 접근을 공식 기능으로 열었다**(월 1,000 크레딧,
 * IP 단위 일일 상한, 넘으면 429). 상한이 IP 단위라는 점이 배포 제품에 오히려 맞는다 —
 * 사용자마다 자기 할당량을 쓰고 우리 쪽으로 몰리지 않는다.
 *
 * 더 쓰려는 사용자는 `FIRECRAWL_API_KEY` 를 환경변수로 두면 자기 키로 올라간다(선택).
 */
export const LOCAL_WEB_SEARCH_API_URL = 'https://api.firecrawl.dev/v2/search';
/** 검색 한 번의 상한(ms). 모델이 기다리는 시간이라 길게 잡지 않는다. */
export const LOCAL_WEB_SEARCH_TIMEOUT_MS = 20_000;

/** 명령 실행 도구의 상한(ms). 넘으면 죽이고 그 사실을 결과로 알린다. */
export const LOCAL_TOOL_COMMAND_TIMEOUT_MS = 120_000;

/**
 * §5.19 (H) (판올림 번호 발급 대기) — **셸도 루트 안에 둔다.**
 *
 * `localTools.ts` 머리말은 경계 셋 중 첫째로 "프로젝트 루트 밖으로 못 나간다"를 선언하는데, 그 가드는
 * 파일 도구(`Read`/`Write`/`Edit`/`Glob`/`Grep`)에만 걸려 있고 **`Bash` 에는 없었다.** `cwd` 가 루트일
 * 뿐이라 `cd ~` 한 번이면 나가고, 그 자리는 모델 출력이 검사 없이 `/bin/sh -c` 로 가는 곳이다
 * (클로드 경로는 CLI 가 이 판정을 대신 해 주지만 로컬에는 그 CLI 가 없다 — `resolveLocalToolGate` 가
 * 세운 규율과 같은 자리다).
 *
 * **명령을 해석하지 않는다** — 셸 문법을 우리가 다시 파싱하기 시작하면 그 파서가 곧 우회 대상이 된다.
 * 대신 **눈에 띄는 이탈 신호**만 거절하고 그 사실을 모델에게 결과로 알린다(던지지 않는다). 통과한
 * 명령이 그래도 밖으로 나갈 수 있다는 것은 사실이고, 이 목록은 "사고로 나가는 것"과 "한 줄 주입으로
 * 나가는 것"을 막는 자리이지 샌드박스가 아니다 — 진짜 봉인은 §5.22 경계를 켜는 것이다.
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

/**
 * §5.19 (H) — 이 모델에게 주는 도구들. **OpenAI 함수 호출 서식** 그대로다
 * (llama-server 의 `/v1/chat/completions` 가 그 서식을 받는다 — 새 규약 발명 ❌).
 *
 * 이름은 클로드 경로의 도구와 **같은 이름**을 쓴다(`Read`·`Write`·`Edit`·`Glob`·`Grep`·`Bash`).
 * 권한 팝업·감사 기록·도구 카드가 전부 도구 **이름**으로 갈라지므로, 여기서 다른 이름을 쓰면
 * 같은 일을 하는 호출이 화면에서 남남이 된다.
 */
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

/**
 * §5.19 (H) — 읽기만 하는 도구. 이것들은 **묻지 않는다**(클로드 경로의 `READ_TOOLS` 와 같은 규율).
 * 여기 없는 것은 전부 "무언가를 바꾸는" 도구로 본다 — 모르는 도구를 안전한 쪽으로 넘겨짚지 않는다.
 */
export const LOCAL_READ_ONLY_TOOLS: readonly string[] = ['Read', 'Glob', 'Grep'];

/** §5.19 (H) — 파일을 고치는 도구(권한 모드 `acceptEdits` 가 자동 승인하는 범위). */
export const LOCAL_EDIT_TOOLS: readonly string[] = ['Write', 'Edit'];

/**
 * §5.19 (H) — **서버가 대신 처리하는** 도구들. 파일이 아니라 우리 화면·설정을 움직인다.
 * 러너는 이 이름들을 보고 파일 도구 대신 호스트 쪽 처리기로 넘긴다.
 */
export const LOCAL_HOST_TOOLS: readonly string[] = ['TodoWrite', 'AskUserQuestion', 'ExitPlanMode'];

/**
 * §5.19 (H) — `TodoWrite` 가 쓰는 낱말을 목표창의 낱말로 옮긴다.
 *
 * 도구 스키마는 클로드의 `TodoWrite` 와 **같은 낱말**(`completed`)을 쓴다 — 모델들이 그 이름으로
 * 배웠기 때문에 여기서 우리 낱말을 강요하면 모델이 자꾸 틀린다. 반대로 목표창은 `done` 을 쓴다.
 * 이 함수가 그 사이를 잇는다. **없으면 단계가 영영 완료로 안 넘어가고 퍼센트가 0에 머문다**
 * (조용히 틀리는 부류라 눈에 안 띈다).
 */
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
 * §5.3 #12-1-A — **이 호출이 사용자가 지목한 "물어봐야 하는 도구"인가.**
 *
 * `permissionMode` 는 모드 단위라 한 도구만 붙잡을 방법이 없다. 사용자가 `bypassPermissions` 를
 * 고른 뜻은 "읽고 찾고 고치는 것을 매번 묻지 말라"이지 "무엇이든 말없이 하라"가 아니다 —
 * 걱정되는 것은 그중 몇 가지뿐인데, 그 몇 가지 때문에 모드 전체를 내려야 했다. 이 함수가 그 한 칸이다.
 *
 * **판정은 여기 한 곳에서만.** 훅 경로(`POST /api/permission-check`)와 로컬 경로
 * (`subAgentManager` 의 `requestTool`)가 같은 함수를 부른다 — 두 벌이 되면 헤드리스에서는
 * 물어보고 로컬 모델에서는 안 묻는 상태가 생기고, 사용자에게는 "켰는데 안 먹는다"로만 보인다.
 *
 * 비교는 **정확한 이름 일치**다(대소문자 접기 ❌ — 도구 이름은 CLI 가 정한 식별자이고
 * `Read` 와 `read` 는 같은 것이 아니다). 목록이 비었거나 없으면 `false` = 종전과 완전히 동일.
 */
export function shouldAskForTool(askTools: readonly string[] | undefined, toolName: string): boolean {
  if (!askTools || askTools.length === 0) return false;
  if (!toolName) return false;
  return askTools.includes(toolName);
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
 * §5.3 #12-1 — **권한 축은 사용자만 올린다.**
 *
 * `PUT /api/agent-config/:id` 는 §3.7 빌더 구축 경로라 loopback 토큰만 있으면 닿는데, 그 토큰은
 * 우리가 스폰한 에이전트의 env(`VIBISUAL_TOKEN`)와 프롬프트 본문에 실려 나간다 — 즉 **토큰을 들고
 * 있다는 것이 사용자 의사라는 뜻이 아니다.** 그 에이전트가 읽는 것은 프로젝트 파일·웹 문서라,
 * 거기 심긴 한 줄이 그대로 이 창구의 입력이 된다. 감시받는 쪽이 감시 장치를 끌 수 있으면
 * 그것은 게이트가 아니므로, loopback 유입이 이 네 칸에 할 수 있는 일을 좁힌다.
 *
 * - **첫 구성은 통과**(`prev === undefined`) — 빌더가 방금 만든 빈 버블을 설정하는 정상 흐름이다.
 * - **이미 정해진 값은 못 바꾼다** — 달라진 칸만 이전 값으로 되돌리고 이름을 `frozen` 에 남긴다.
 *   요청 전체를 거절하지 않는 이유는, 빌더가 같은 PUT 으로 보내는 모델·도구 설명 같은 나머지
 *   칸까지 함께 죽이면 기능이 조용히 망가지기 때문이다.
 * - **`bypassPermissions` 는 첫 구성에서도 못 켠다** — 그 한 값이 우리 팝업과 CLI
 *   `--dangerously-skip-permissions` 를 동시에 끈다. `acceptEdits` 로 낮춰 저장한다.
 * - **모르는 모드는 저장하지 않는다**(유입과 무관) — 저장되면 `toCliPermissionMode` 가 `null` 을
 *   내 플래그가 통째로 빠지고, 무플래그 CLI 기본은 2026-08-14 부터 `auto`(자동 승인)다.
 *
 * 사용자 창구(렌더러 IPC · 페어링된 모바일)는 `fromLoopback=false` 로 들어와 종전 그대로 동작한다.
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
 * §5.19 (H) — 이 권한 모드에서 이 도구를 어떻게 할 것인가. **판정은 여기 한 곳에서만.**
 *
 * 클로드 경로의 매핑을 그대로 따르되, **CLI 가 대신 해 주던 몫은 우리가 진다** — 거기서는
 * `plan` 과 `auto` 를 CLI 에 넘기고 통과시켰지만(실행 차단·분류를 CLI 가 한다), 로컬에는
 * 그 CLI 가 없다. 여기서 통과시키면 아무도 안 막는다.
 *
 * - `bypassPermissions` — 묻지 않는다(사용자가 그렇게 골랐다).
 * - `plan` — 계획만 세우는 모드. 읽기는 되고 **바꾸는 것은 막는다**(CLI 가 하던 차단을 우리가).
 * - `dontAsk` — 묻지 않고 거절한다(사람 없는 무인 실행).
 * - `acceptEdits` — 파일 편집은 자동 승인, 나머지 가변 도구는 묻는다.
 * - `auto`·`default`·그 밖 — 가변 도구는 **묻는다**(분류기가 없으니 사람이 판정한다).
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
 * §5.19 (B) — 요청 본문에서 온 `provider` 를 좁힌다. 생성(create-custom-agent)과 저장
 * (PUT /api/agent-config) 두 입구가 **같은 규칙**을 써야, 한 쪽에서 만든 버블이 다른 쪽 저장
 * 한 번에 정체를 잃지 않는다.
 *
 * **모델이 없어도 통과시킨다.** 진입 순서가 뒤집혀(§5.19 (B)) 버블이 먼저 생기고 모델은
 * 그 뒤에 매이므로, `modelId` 가 빈 문자열인 "아직 준비 중인 버블"이 정상 상태다 — 여기서
 * 그것을 걸러 내면 우클릭으로 만든 All Model 버블이 조용히 클로드 버블이 된다.
 */
export function normalizeAgentProvider(value: unknown): AgentProvider | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as {
    kind?: unknown; modelId?: unknown; modelName?: unknown; contextSize?: unknown; temperature?: unknown;
    toolSupport?: unknown; contextUsed?: unknown; contextLimit?: unknown;
    tokensIn?: unknown; tokensOut?: unknown; reasoningEffort?: unknown;
    webSearch?: unknown; networkAccess?: unknown; modelVerbosity?: unknown;
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

/**
 * §5.19 (B) — 아직 모델을 안 문 All Model 버블의 기본 라벨 모양(`All Model 3`).
 * 모델을 매는 순간 라벨이 이 모양이면 **모델명이 그 자리를 잇는다** — 사용자가 직접 바꾼
 * 이름은 이 모양이 아니므로 자연히 보존된다(이름을 지키려고 별도 플래그를 두지 않는다).
 */
export const ALL_MODEL_DEFAULT_LABEL_RE = /^All Model \d+$/;

// ─── §5.25 Codex — 같은 지도 위의 두 번째 엔진 ───
//
// 클로드 쪽 상수(`CLAUDE_SETUP_*`·`CLAUDE_AUTH_*`)와 **같은 모양**을 의도한 것이다.
// 여기 있는 값 중 어느 것도 클로드 경로가 읽지 않는다.

/**
 * §5.25 (D) — 설치 명령. **세 OS 가 같다**(npm 전역 설치) — 클로드처럼 플랫폼별 인스톨러
 * 스크립트가 갈리지 않으므로 문자열 하나면 된다. 화면의 "직접 설치" 안내와 서버가 실제로
 * spawn 하는 문자열이 **같아야** 하므로 조립은 여기 한 곳뿐이다.
 *
 * 실행본을 우리가 동봉하지 않는 이유는 §5.25 (D) — 남의 배포물을 재배포하지 않는다.
 */
export const CODEX_SETUP_INSTALL_COMMAND = 'npm install -g @openai/codex';

/** 자동 설치가 막혔을 때의 탈출구 — 공식 설치 문서. */
export const CODEX_SETUP_DOCS_URL = 'https://developers.openai.com/codex/cli';

/** `codex --version` 판정 타임아웃. 짧게 — 이 값이 길면 부팅이 그만큼 늦어진다. */
export const CODEX_SETUP_PROBE_TIMEOUT_MS = 8_000;

/** npm 전역 설치는 네트워크 왕복이라 넉넉히. */
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
 * 코덱스 로그인 PTY 의 termId. 클로드 로그인(`term:auth:login`)과 **다른 고정 id** 여야
 * 두 로그인 창이 같은 터미널을 뺏어 쓰지 않는다.
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

/** §5.25 (I) — 훅 정의 파일 이름(사용자 전역). */
export const CODEX_HOOKS_FILENAME = 'hooks.json';

/**
 * §5.25 (I) — 우리가 넣은 훅 블록에 붙이는 표식.
 *
 * 이게 있어야 나중에 **우리 것만** 골라 지울 수 있다(사용자가 직접 넣은 훅을 건드리면 안 된다).
 * `hookInstaller` 가 클로드 `settings.json` 에 대해 쓰는 방식과 같은 규약.
 */
export const CODEX_HOOK_MARKER = '_vibisual';

/**
 * §5.25 (I) — 우리가 설치하는 코덱스 훅 이벤트.
 *
 * 클로드 쪽에서 캔버스를 그리는 데 실제로 쓰는 것과 **같은 다섯**이다. 코덱스가 더 많은 이벤트를
 * 갖고 있어도(`PreCompact`·`Interrupt` 등) 우리가 안 쓰는 것을 남의 전역 설정에 심지 않는다 —
 * 새 이벤트를 넣을 때는 서버 분기(`/api/hook-event`)를 함께 본다.
 */
export const CODEX_HOOK_EVENTS: readonly string[] = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
];

/**
 * §5.25 (H) — 우리 권한 모드 → 코덱스의 두 축(`--sandbox`, `--ask-for-approval`).
 *
 * **표로 두는 이유**(§3.3): 코덱스는 "무엇을 만질 수 있나"(sandbox)와 "언제 사람에게 묻나"
 * (approval)를 갈라 말하는데 우리 모드는 그 둘을 한 값에 담고 있다. 분기문으로 흩어 놓으면
 * 스폰 자리와 화면 설명이 서로 다른 답을 하게 된다.
 *
 * `--dangerously-bypass-approvals-and-sandbox` 는 어떤 모드에도 매핑하지 않는다 — CLI 자신이
 * 위험하다고 이름 붙인 자리이고, `bypassPermissions` 가 원하는 것은 거기까지가 아니다.
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
  // **없는 값과 모르는 값을 가른다.** 미설정은 앱 전체가 `permissionMode || 'default'` 로 읽으므로
  //   여기서만 읽기 전용으로 떨어뜨리면, 설정을 한 적 없는 사용자는 코덱스가 파일을 못 고치는
  //   이유를 화면 어디에서도 볼 수 없다. 반대로 **모르는 문자열**은 우리가 뜻을 모르는 값이라
  //   넓은 쪽으로 읽지 않는다(나중에 추가될 모드가 조용히 전면 허용이 되는 사고를 막는다).
  const key = mode === undefined || mode === '' ? 'default' : mode;
  const hit = CODEX_PERMISSION_MAP[key];
  return hit ?? { ...CODEX_PERMISSION_FALLBACK };
}

/**
 * §5.25 (B) — 아직 모델을 안 문 Codex 버블의 기본 라벨 모양(`Codex Agent 3`).
 * All Model 과 같은 규약 — 이 모양이면 모델명이 그 자리를 잇고, 사용자가 바꾼 이름은 보존된다.
 *
 * **`Agent` 는 선택이다.** (B-2) 에서 기본 이름을 `Codex 3` → `Codex Agent 3` 으로 고쳤는데,
 * 그때 이 정규식을 같이 안 고쳐서 **이미 놓인 옛 버블**이 이름 잇기에서 조용히 빠졌다.
 * 두 모양을 다 받아 옛 버블도 새 버블도 같은 규약을 탄다.
 */
export const CODEX_DEFAULT_LABEL_RE = /^Codex (?:Agent )?\d+$/;

/**
 * §5.25 (C) — 엔진 → 그 엔진으로 만드는 새 에이전트의 `provider` 초깃값.
 *
 * **클로드는 `undefined` 다** — 그게 "지금까지의 경로 그대로"라는 §5.19 (C) 의 무변경 근거이고,
 * 엔진 이름과 프로바이더 유니온을 잇는 곳은 이 함수 하나뿐이다.
 */
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
 * §5.25 (J) — **"이 버블은 어느 모델로 도는가"를 답하는 한 곳.**
 *
 * `AgentConfig.model` 은 **클로드 칸**이다. 기본값이 `opus` 라서, 엔진을 안 보고 그대로 적으면
 * 코덱스·로컬 버블이 **자기를 클로드로 말한다** — GPT 버블 아래에 `opus` 가 뜬 그 사고다.
 * `config.model` 은 코덱스·로컬 턴이 읽지도 않는 칸이라 거짓이 아니라 **남의 값**이다.
 *
 * 종전에는 화면마다 `localProviderOf`·`codexProviderOf` 를 각자 부르고, 그 둘을 부르는 것을
 * **잊은 자리**(버블 하단 idle 줄 · IDE 상태바)가 그대로 `opus` 를 적었다. 엔진이 늘 때마다
 * 화면 수만큼 고쳐야 하는 구조라 또 빠진다 — 그래서 판정을 여기 하나로 모은다.
 * 새 엔진은 `engineForProvider` 에 갈래를 더하면 부르는 쪽은 손대지 않아도 따라온다.
 *
 * @param config    이 에이전트의 설정(없으면 아직 안 읽힌 것 — `null` 을 돌려준다).
 * @param fallbacks 프로바이더가 모델을 아직 안 물었을 때 적을 **엔진 이름**(i18n 문구).
 * @returns `null` 이면 적을 것이 없다(훅 버블처럼 설정이 없는 자리).
 */
export function agentModelLabelOf(
  config: { model?: string; provider?: AgentProvider } | null | undefined,
  fallbacks?: { codex?: string; local?: string },
): string | null {
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
 * §5.20 — 가져온 JSON 한 장을 **믿지 않고** 훑어 우리 항목 초안으로 바꾼다.
 *
 * 남이 준 파일이 우리 상태를 그대로 밀어 넣는 통로가 되면 안 되므로 여기서 —
 * ① 모르는 스키마 버전은 통째로 거절하고, ② 런타임 필드(id·lastRun·에이전트 id·절대 경로 `cwd`)는
 * 애초에 읽지 않으며, ③ 아이콘·색은 고정 목록 안으로 강제하고, ④ 본문은 길이 상한으로 자르고,
 * ⑤ 개수는 `SHELF_IMPORT_MAX_ITEMS` 까지만 받는다. **클라이언트와 서버가 같은 함수를 쓴다.**
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

/**
 * 지도 스윕 주기(ms). 훅 이벤트마다 재파싱하는 형태는 금지 — 전수 재파싱이 프리즈를 부른 전례가 둘이다.
 * 이 주기로 **활성 세션만** 훑고, JSONL 스캐너가 mtime·size 로 먼저 걸러 변화 없으면 파일을 열지도 않는다.
 */
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

/**
 * "추정" 툴팁에 이름을 대 줄 **단가 미상 모델** 개수 상한(§9 키 개수 캡).
 * 목록이 길어질수록 정보가 아니라 소음이 된다 — 몇 개만 보여도 무엇을 고칠지는 충분히 안다.
 */
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
//
// 판정은 **여기 한 곳**이다. 서버(사전 승인 판단)와 클라(타임라인 배지·승인 카드 배지)가 같은
// 함수를 통과해야 두 화면이 같은 답을 말한다 — 어긋나는 순간 감사는 믿을 수 없는 화면이 된다.
// 패턴은 전부 아래 테이블에서만 오고 분류 함수 안에 정규식을 박아 넣지 않는다(§3.3).

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

/**
 * **전선에 싣는** 줄 수(§9). 원장은 프로젝트당 500 줄까지 들고 있지만 그 전량을 브로드캐스트마다
 * 실으면 스냅샷이 통째로 무거워진다 — §5.21 이 세션 `days` 를 전선에서 뺀 것과 같은 이유다.
 * 화면이 필요로 하는 것은 최근 몫이고, 전량은 체크포인트와 `GET /api/audit-log` 에 있다.
 */
export const AUDIT_SNAPSHOT_ENTRIES = 120;

// ─── 컨텍스트 보험 (§5.26) ───
//
// 보존 축(일수·바이트 예산·줄 수)은 이 파일 위쪽 **보존 정책(§3.2.3)** 블록에 산다 —
// 못박힌 상한이 아니라 `RetentionSettings` 의 기본값이라 그쪽에서 먼저 선언돼야 한다.
// 여기 있는 것은 사용자가 조절하지 않는 **판정·형식 상수**다.

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

/** §5.26 (D) — `PreCompact` 뒤 이만큼 지나도 `PostCompact` 도 성장도 없으면 압축 실패로 본다. */
export const INSURANCE_COMPACT_TIMEOUT_MS = 3 * 60 * 1000;

/** §5.26 (D) — 요약 구간을 읽을 때 한 번에 훑는 최대 바이트(§3.2.4 G축 — 읽기 피크 상한). */
export const INSURANCE_SUMMARY_SCAN_MAX_BYTES = 512 * 1024;
/**
 * §7.23 — 세션 제목을 찾으려고 JSONL 앞에서 읽는 상한.
 *
 * 첫 사용자 프롬프트는 파일 맨 앞에 앉는데, 서브에이전트 프롬프트는 카드 규약 블록 때문에
 * 7KB 를 넘는 경우가 흔하다(실측). 32KB 면 그 뒤의 `Task:` 줄까지 넉넉히 들어오고, 수백 개
 * 세션을 훑어도 읽기 총량이 한 자릿수 MB 에 머문다 — 전량 파싱과 갈리는 자리다.
 */
export const INSURANCE_TITLE_SCAN_MAX_BYTES = 32 * 1024;

/**
 * §5.26 (F) — 이 비율을 넘었는데 압축이 안 오면 `overdue`.
 *
 * ⚠ **분모는 모델 창이 아니라 "접기로 한 선"** 이다((F)(a) 2026-09-09 정정). 오래 `contextUsed /
 * contextMax` 로 재 왔는데, 1M 창 모델에 자동압축을 400k 로 걸어 둔 세션에서 322k 는 창 대비
 * 32% 라 여기 한참 못 미친다 — 사용자가 정해 둔 선을 보험이 **아예 보지 않아** 400k~950k 가
 * 통째로 무보험이었다. `stalled` 쪽 분모는 종전대로 창이 맞다(CLI 가 멈추는 것은 창에 닿을 때다).
 */
export const INSURANCE_OVERDUE_RATIO = 0.95;

/**
 * §5.26 (F)(b) — 우리가 `/compact` 를 보낸 뒤 `PreCompact` 를 이만큼 기다린다.
 *
 * 넘으면 `rejected` — 명령이 **실행되지 않았다**는 뜻이다. CLI 는 거절을 `is_error: false` 로
 * 돌려주므로(실측 2.1.263) 이 시간 초과가 우리가 가진 유일한 사실 증거다. 압축 자체는 몇 초면
 * `PreCompact` 가 오지만, 앞선 턴이 길게 물려 있으면 큐에서 대기하는 시간이 붙는다 — 90초는
 * 그 대기를 넉넉히 덮으면서 사용자가 "안 되네"를 알아채기 전에 화면이 먼저 말할 수 있는 폭이다.
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

/**
 * 경로를 입력으로 받는 도구 — `outside` 는 **읽기도 본다**(§5.22).
 *
 * `AUDIT_WRITE_TOOLS`(설정 파일 수정 판정용)와 일부러 따로 둔다. `config` 가 묻는 것은
 * "고쳤는가"이고 `outside` 가 묻는 것은 "사용자가 그은 선을 넘었는가"라, 고른 폴더 밖은
 * 읽기만 해도 대상이다.
 *
 * 이름을 아는 도구로 한정한다 — 아무 도구의 `path` 나 집으면 그 칸이 파일 경로가 아닌
 * 도구(예: 요청 경로 `/api/x` 를 `path` 로 받는 MCP 도구)에서 없는 위험을 지어낸다.
 */
export const AUDIT_PATH_INPUT_TOOLS: ReadonlySet<string> = new Set([
  'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'NotebookRead', 'Glob', 'Grep', 'LS',
]);

/** 경로가 담겨 오는 입력 칸(도구마다 이름이 다르다). 요약·판정이 같은 목록을 본다. */
export const AUDIT_PATH_INPUT_KEYS: readonly string[] = [
  'file_path', 'notebook_path', 'path', 'target_file',
];

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

/**
 * 파일이 아니라 장치·의사 경로 — 밖으로 세지 않는다.
 * `> /dev/null` 이 매번 걸리면 배지가 뜻을 잃는다(믿을 수 없는 화면이 되는 첫 걸음).
 */
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
 * 스위치가 없을 때의 기본 — **꺼짐**이다(§5.22).
 *
 * 묻는 쪽이 더 안전해 보이지만 이 경계가 되무르는 것은 **사용자가 직접 고른 권한 모드**다.
 * `bypassPermissions` 를 고른 사람에게 기본값으로 승인 카드를 띄우면 그가 고른 모드가
 * 설명 없이 무효가 되고, 그 카드는 원인을 알 수 없는 팝업으로만 보인다. 되무를지는
 * **사용자가 켜서** 정하고, 꺼져 있는 동안에도 기록은 계속된다(기록을 끄는 스위치는 없다).
 *
 * 종류별 `kinds` 는 켬 그대로 둔다 — 전체를 켠 사용자가 넷을 다시 켜야 하는 일은 만들지 않는다.
 *
 * **기본값은 이 상수 하나에서만 읽는다**: 서버 fallback·체크포인트 "저장할 것 없음" 판정·
 * 클라 두 화면이 저마다 기본을 하드코딩하면, 켠 적 없는 프로젝트가 화면마다 다른 상태로 보인다.
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
//
// 여기의 정규식은 전부 위 테이블에서 오고(§3.3), **플랫폼은 인자로 받는다** — shared 는
// 브라우저에서도 로드되므로 `process.platform` 을 읽을 수 없고, 인자로 받아야 개발기 한 대에서
// 세 OS 를 다 시험할 수 있다(멀티플랫폼 1축).

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

/**
 * §5.22 — 이 경로가 경계 **전부**의 밖인가.
 *
 * `roots` 가 비면 **항상 false** — 근거가 없을 때 위험을 지어내면 프로젝트 등록 전 몇 초의
 * 호출이 전부 밖으로 찍힌다. 여러 root 중 **하나에라도 들어가면 안**이다(우리가 띄운 워크트리·
 * 별도 cwd 세션이 통째로 빨개지지 않게).
 *
 * 상대경로는 각 root 에 붙여 접은 뒤 판정하므로 `src/a.ts` 는 안, `../../other/x` 는 밖이다.
 */
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

/**
 * 명령 문자열에서 경로 후보를 뽑는다.
 *
 * **URL 을 먼저 걷어낸다** — 그 자리는 `network` 가 이미 보고 있고, 안 걷어내면 `https://` 의
 * `//` 가 POSIX 절대경로로 오독되어 모든 curl 이 "폴더 밖"이 된다.
 */
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
 * §5.22 — 원장 한 줄이 보여 줄 요약과 대상. 도구 입력 전문을 담지 않기 위한 접기다.
 */
export function summarizeToolCall(
  toolName: string,
  toolInput?: Record<string, unknown> | null,
  options?: { platform?: PlatformName },
): { summary: string; target?: string } {
  const input = toolInput ?? {};
  const command = typeof input['command'] === 'string' ? input['command'] : '';
  const url = auditFirstString(input, ['url', 'endpoint']);
  const filePath = auditFirstString(input, AUDIT_PATH_INPUT_KEYS);

  if (command) {
    const urls = command.match(AUDIT_URL_PATTERN);
    // §2.1 #3 쓰기 축 — 셸로 고친 줄은 명령만 있고 **어느 파일인지가 비어 있었다**.
    // 그래프가 쓰기 화살표를 세우는 것과 같은 추출기로 그 칸을 채운다(첫 경로 하나면 족하다).
    const written = extractBashWritePaths(command, 1, { platform: options?.platform })[0];
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

/**
 * 사용자가 아직 손대지 않은 기본 상태인가.
 *
 * "저장할 것이 없다"를 판정하는 자리(체크포인트)가 종전 기본값을 직접 비교하면, 기본이 뒤집힌
 * 순간 **사용자가 켜 둔 경계가 저장되지 않고 사라진다**. 판정은 여기 한 곳에서만 한다.
 */
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

// ─── §4 메신저 원격제어 브리지 (판올림 번호 발급 대기) ─────────────────────────
//
// 아웃바운드 전용이라 여기 상수에는 "우리가 여는 포트" 가 없다 — 전부 **우리가 나가서
// 부르는 주소**와 그 왕복의 상한이다. 인바운드(§4 v3.16)와 대비되는 지점이 이 목록이다.

/** 딥링크 페어링 티켓 수명(ms). §4 v3.66 QR 티켓과 같은 근거로 짧게 — 사진에 찍혀도 곧 죽는다. */
export const CHAT_PAIR_TICKET_TTL_MS = 3 * 60 * 1000;

/** 페어링 티켓 토큰 바이트 수(hex 인코딩 전) — 3분 안에 맞힐 수 없는 수준. */
export const CHAT_PAIR_TOKEN_BYTES = 24;

/** 페어링 시도 실패 허용 횟수 — 초과 시 `CHAT_PAIR_BAN_MS` 동안 그 발신자를 차단. */
export const CHAT_PAIR_MAX_ATTEMPTS = 10;

/** 페어링 실패 한도를 넘긴 발신자를 격리하는 시간(ms). 소유자 lockout 없이 공격자만 막는다. */
export const CHAT_PAIR_BAN_MS = 10 * 60 * 1000;

/** 동시에 페어링해 둘 수 있는 대화(기기) 수 상한 — 초과 시 가장 오래된 것부터 밀어낸다. */
export const CHAT_PEER_MAX = 5;

/**
 * 페어링 안 된 발신자에게 안내를 보낼 수 있는 간격(ms).
 *
 * 화이트리스트 밖은 원칙적으로 침묵이지만(§4 ⑤) 예외가 둘 있다 — 텔레그램이 봇을 처음 열 때
 * 자동으로 보내는 `/start`, 그리고 티켓이 만료된 뒤 도착한 페어링 시도. 여기까지 침묵하면
 * 사용자는 봇이 고장난 줄 안다. **다만 상한이 없으면 그 친절이 곧 무제한 답장**이 된다 —
 * 아무나 `/start` 를 반복해 봇의 존재를 확인하고 메신저 rate limit 을 소진시킬 수 있다.
 */
export const CHAT_UNPAIRED_NOTICE_MS = 10 * 60 * 1000;

/**
 * 대기 중인 버튼(권한·질문) 레지스트리의 키 개수 상한.
 *
 * 권한 요청 하나가 [허용]/[거부] 두 건을 넣는데, **폰에서 누르지 않으면 지워지지 않는다**
 * (누른 순간에만 짝을 거둔다). 만료돼도 남으므로 오래 켜 둔 앱에서 계속 자란다.
 * 값이 아니라 **키 개수**에 걸리는 상한이다 — 넘으면 만료된 것부터, 그래도 넘으면 오래된 것부터.
 */
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

/**
 * 디스코드 Gateway intents — GUILD_MESSAGES(1<<9) + DIRECT_MESSAGES(1<<12) +
 * MESSAGE_CONTENT(1<<15). 평문 명령을 읽어야 하므로 MESSAGE_CONTENT 가 필요하다
 * (Developer Portal 에서 "Message Content Intent" 를 켜야 IDENTIFY 가 통과한다).
 */
export const CHAT_DISCORD_INTENTS = (1 << 9) | (1 << 12) | (1 << 15);

/**
 * 하트비트를 보내고 ACK(op 11) 없이 넘어가도 되는 횟수.
 *
 * 디스코드 문서는 "ACK 이 안 오면 비정상 코드로 끊고 재연결" 을 요구한다. 이걸 안 보면
 * 소켓이 `close` 이벤트 없이 반쯤 죽었을 때 상태는 `online` 인 채 **영원히 아무것도 받지
 * 않는다** — 밖에서 권한 승인을 기다리다 60초 자동 결정을 맞게 되는, 이 축이 막으려던 바로
 * 그 상황이다. 1 = 한 번 놓치면 바로 끊고 다시 붙는다.
 */
export const CHAT_DISCORD_HEARTBEAT_MISS_MAX = 1;

/** 좀비 커넥션을 우리가 끊을 때 쓰는 close code(1000 이 아니어야 RESUME 가능 범위로 다뤄진다). */
export const CHAT_DISCORD_ZOMBIE_CLOSE_CODE = 4009;

/** 디스코드 한 메시지 최대 길이(공식 2000) — 여유를 두고 자른다. */
export const CHAT_DISCORD_MESSAGE_MAX = 1900;

/** 디스코드 페어링 명령 접두어. DM 딥링크가 없어 평문 한 줄로 같은 결과를 만든다. */
export const CHAT_DISCORD_PAIR_COMMAND = '!vibisual pair';

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

/**
 * 선택 카드 한 장에 실을 버튼 수 상한(프로젝트·에이전트·세션 공통).
 *
 * 두 메신저 모두 인라인 키보드 크기에 한계가 있고, 폰 화면에서 스무 칸이 넘어가면 고르는 것이
 * 아니라 훑는 것이 된다. 넘치면 카드가 "+N" 한 줄로 알리고 나머지는 상위 단계에서 좁혀 들어온다.
 */
export const CHAT_PICK_MAX = 20;

/** 선택 버튼 하나에 쓸 글자 수 상한 — 넘으면 잘린다(라벨이 길면 버튼이 줄바꿈으로 뭉개진다). */
export const CHAT_PICK_LABEL_MAX = 40;

/**
 * 선택 버튼이 실어 보내는 **짧은 토큰**의 hex 길이.
 *
 * 텔레그램 `callback_data` 는 **64바이트 상한**이라 프로젝트 표시명을 그대로 실을 수 없다
 * (한글 한 자가 UTF-8 3바이트라 스무 자면 이미 넘친다). 그래서 값을 이 길이의 해시로 접고,
 * 눌렸을 때 **그 시점 목록에서 되찾는다** — 사라진 항목은 자연히 못 찾아 안내로 떨어진다.
 */
export const CHAT_PICK_TOKEN_HEX = 10;

/** "세션을 고르지 않고 서버에 맡긴다"를 뜻하는 선택 토큰(새 대화 / 정규 세션 재사용). */
export const CHAT_PICK_AUTO_SESSION = '*';

/**
 * 명령 대상 목록(`listChatCommandTargets`)을 다시 만들기까지의 최소 간격(ms).
 *
 * 그 조회는 **범위 미적용 전량 스냅샷**을 만든다 — 고를 목록이 집 PC 의 탭 상태로 달라지지
 * 않게 하려면 그래야 하지만, 카드 라벨을 붙이는 자리는 스트림처럼 초당 여러 번 도는 뜨거운
 * 경로다. 사람의 클릭 간격보다 훨씬 짧으므로 고르는 흐름에서는 사실상 늘 최신이고,
 * 사라진 항목 판정은 어차피 서버가 최종적으로 한다.
 */
export const CHAT_TARGETS_TTL_MS = 1_000;

/**
 * 기본 전송량. `'cards'` = 카드/요약만 나간다(스트림 원문·diff·bash 출력 ❌).
 * 메신저는 제3자 서버를 통과하는 경로라 기본값을 좁게 잡고, 원문은 `/log` 로 명시 요청할 때만.
 */
export const DEFAULT_CHAT_VERBOSITY = 'cards';

// ─── §5.11 정독 게이트 · §5.5 #17-44 ────────────────────────────────────────────
//
// §3.3 — 여기 있는 값은 전부 설정이다. 로직 안에 숫자를 박지 않는다.

/**
 * 기획 문서를 찾을 뿌리 후보 — **권위 순서**다. 사용자가 `.vibisual/spec.json` 의 `roots` 를 적으면
 * 그것이 이 목록을 통째로 대신한다(자동 탐색은 "적지 않았을 때"의 기본값일 뿐이다).
 *
 * `docs/` 를 뒤에 두는 이유: 앞의 셋은 명세 전용 폴더라 잡히면 그것이 답이지만, `docs/` 에는
 * API 문서·개발 노트가 섞여 있어 절 수가 폭증한다.
 */
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

/**
 * 절 id 로 쓸 토큰의 기본 정규식.
 *
 * 본문에 `REQ-14` 같은 토큰이 있으면 그것을 id 로 삼는다 — 업계의 역추적 관행(요구사항 ID 를 명세·
 * 테스트·PR 에 심고 CI 가 `REQ-\d+` 로 검사)과 그대로 맞물리기 때문이다. 없으면 헤딩 슬러그로 떨어진다.
 */
export const SPEC_ID_PATTERN_DEFAULT = '(?:REQ|SPEC|FR|NFR)-[A-Za-z0-9_.-]+';

/**
 * 절 본문에서 "요구사항 문장"으로 세는 표지. 절의 무게를 재 라우팅 우선순위를 정한다.
 * 로직 분기 ❌ — 세는 대상은 이 표 하나에서만 온다.
 */
export const SPEC_REQUIREMENT_MARKERS: readonly string[] = [
  'SHALL', 'MUST', 'SHOULD NOT', 'MUST NOT',
  '해야', '한다.', '금지', '하지 마', '필수', '반드시',
];

/**
 * 한 턴에 필수로 지목하는 절 수 상한.
 *
 * 전집을 읽으라는 요구는 실패한다(서두가 이미 2만 토큰이다 — §5.5 #17-28). 넘치면 요구사항 수가
 * 많은 절부터 자르고, 잘렸다는 사실을 프롬프트와 화면 양쪽에 적는다.
 */
export const SPEC_REQUIRED_MAX = 8;

/**
 * 색인이 드는 절 수 상한. 넘으면 최근 수정 순으로 자르고 `truncated` 를 세운다.
 *
 * 2,000 → 4,000 — 절 크기 상한(`SPEC_UNIT_TOKEN_MAX`)으로 큰 절을 다시 자르면서 절이 잘게 늘었다.
 * 절 하나는 얕은 객체 하나라 4,000개여도 메모리·라우팅 비용은 미미하고, 전선에는 개수만 실린다.
 */
export const SPEC_UNIT_MAX = 4000;

/**
 * 절 하나의 토큰 상한(추정 — `estimateTokens`).
 *
 * 헤딩 하나가 27만 토큰을 품는 문서가 실재한다(실측 2026-09-10). 그 절에 "줄 범위 전체를 열어라"를
 * 시키면 그 한 번이 컨텍스트를 삼킨다. 업계 실측(서술문 청크 512~1,024 토큰이 최적)의 위쪽에 두고,
 * 넘는 절은 항목·문단 경계에서 다시 자르며 그래도 넘으면 `oversized` 로 표시해 Grep 으로 좁히게 한다.
 */
export const SPEC_UNIT_TOKEN_MAX = 2000;

/**
 * 헤딩 없는 긴 절을 다시 자르는 **항목 줄** — 척추 §5 목차의 찾기 정규식과 같은 꼴이다.
 *
 * `17-44.`·`3.2.1.`·`1)`·`(a)`·`①` 로 시작하는 줄(앞의 목록 표식 `- `·굵게 표식 `**` 은 건너뛴다).
 * 줄 하나에 대고 검사한다(`m` 플래그 없이 줄 단위 호출).
 */
export const SPEC_ITEM_PATTERN_DEFAULT =
  '^\\s{0,8}(?:[-*+]\\s+)?(?:\\*\\*)?(?:\\d+(?:[.\\-]\\d+)*[.)]|\\([A-Za-z0-9]{1,3}\\)|[\u2460-\u2473\u3251-\u325F])(?=[\\s*\\-]|$)';

/** 재분할이 내려가는 최대 깊이(항목 → 하위 항목 → …). 그 아래는 문단으로 묶는다. */
export const SPEC_RESPLIT_DEPTH_MAX = 4;

/**
 * 재분할한 절 제목에 붙이는 항목 표지 길이(`부모 › 표지`) — **표시용 상한이다.**
 *
 * 40 자였을 때 한글 헤딩이 꼬리에서 잘렸다(실측: `— 활동바 정독` 이 `— 활동바 정` 으로 잘려 §5.5 #17-44 의
 * 조각 54 개 전부가 제목에 `정독` 을 잃었고, 그래서 「정독 기능 고쳐줘」가 자기 기획 절을 못 찾았다).
 * 우리 헤딩은 "번호. 무엇을 왜 — **어디**" 꼴이라 가장 검색되는 낱말이 늘 꼬리에 있다.
 * 길이를 늘리는 것만으로는 또 잘릴 뿐이므로 **낱말 경계에서 자르고**, 매칭은 자르지 않은
 * `SpecUnit.matchText` 로 한다 — 표시가 짧아도 찾기는 온전해야 한다.
 */
export const SPEC_ITEM_LABEL_MAX = 60;

/**
 * 제목 겹침으로 절이 걸리려면 **겹침 점수가 이만큼** 돼야 한다.
 *
 * 하나면 `정독`·`문서` 같은 낱말에 온 제목이 걸린다(실측: 두 프로젝트 모두 무관한 절 8개가 매 턴 섰다).
 * 그렇다고 낱말 **개수**만 세면 `지금`+`기능` 같은 산문 접착제 둘로 문턱이 뚫린다(실측 2026-09-11:
 * 「지금 정독 기능을 개선했는데…」에 무관한 `세션 목표` 절이 그 둘로 섰고, 정작 `정독` 절은 1 개라 떨어졌다).
 * 그래서 세는 것은 개수가 아니라 **무게**다 — 접착제는 0, 드문 낱말은 `SPEC_RARE_TITLE_HIT_WEIGHT`,
 * 나머지는 1. id·문서 경로를 직접 부른 것은 이 문턱과 무관하게 걸린다.
 */
export const SPEC_TITLE_MIN_HITS = 2;

/**
 * **드문 낱말 하나면 절이 선다** — 그 낱말이 대신하는 겹침 수.
 *
 * `정독`처럼 온 색인에서 몇 절에만 있는 낱말은 그 자체로 "이 절을 말한 것"이다. 짝을 요구하면
 * 기능 이름을 정확히 부른 프롬프트가 도리어 떨어진다(위 실측이 그 경우다).
 */
export const SPEC_RARE_TITLE_HIT_WEIGHT = 2;

/**
 * 낱말이 **이 비율 이하의 절 제목**에만 나오면 드문 낱말이다(문서 빈도 = df).
 *
 * 고정 개수로 두면 색인 크기에 따라 뜻이 달라진다(절 30 개짜리 저장소의 20 절 ≠ 절 1,000 개의 20 절).
 * 부모 제목이 자식 조각에 그대로 이어지므로 큰 절 하나가 df 를 수십까지 밀어 올린다 — 그래서 넉넉히 잡는다.
 * 실측(2026-09-11, 절 1,038 개): `정독` 23 · `인용` 10 · `개선` 14 · `색인` 40 · `배지` 46 이 도메인 낱말이고,
 * `드래그` 56 · `퍼센트` 91 · `버블` 145 · `활동바` 220 · `세션` 375 부터는 어디에나 있다. 5% 가 그 사이다.
 */
export const SPEC_RARE_TITLE_DF_RATIO = 0.05;

/**
 * 희귀도를 **재기 시작하는** 색인 크기 — 절이 이보다 적으면 드문 낱말을 아예 안 센다.
 *
 * df 는 모집단이 있어야 뜻이 생긴다. "절 다섯 중 하나에 나오는 낱말"은 드문 것이 아니라 20% 다.
 * 바닥값(예전 `SPEC_RARE_TITLE_DF_MIN = 3`)으로 깔아 두면 **작은 색인에서는 모든 낱말이 드문 낱말이 되어**
 * 문턱이 통째로 사라진다 — 실측으로 절 2 개짜리 색인에서 `게이트` 한 낱말이 절을 세웠다.
 * 절이 적은 저장소는 목록을 통째로 볼 수 있으니, 그때는 낱말 둘을 요구하는 종전 문턱이 옳다.
 */
export const SPEC_RARE_TITLE_MIN_UNITS = 20;

/**
 * 드문 낱말이 **혼자 절을 세우려면** 제목 사슬(`문서 › 절 › 항목 › …`)의 앞 이만큼 안에서 맞아야 한다.
 *
 * df 만으로는 **도메인 낱말과 우리말 동사가 안 갈린다** — 실측(2026-09-11)에서 `정독` df 23,
 * `오늘` df 4, `고치고` df 2, `먹는다` df 10 으로 뒤엣것들이 오히려 더 드물었다. 「안녕 오늘 뭐 할까」가
 * 무관한 절 4 개를 세운 것이 그 탓이다. 가르는 것은 빈도가 아니라 **자리**다 — 절이 그 낱말에 대한
 * 것이면 낱말은 **절 제목**에 서고(`17-44. … 활동바 정독`), 지나가는 말이면 말단 항목 표지에만 선다
 * (`⑧-2 날짜를 숨기지 않는다 — 오늘 것도 …`). 말단에서만 맞은 드문 낱말은 가중 없이 1 로 센다.
 */
export const SPEC_TITLE_HEAD_PARTS = 2;

/**
 * 제목 겹침에서 **아예 세지 않는 낱말** — 어느 절 제목에나 있어 절을 가리지 못한다.
 *
 * 로직 분기가 아니라 **언어 표**다(`KO_PARTICLES` 와 같은 규율 — 사용자 설정으로 바꿀 값이 아니다).
 * df 만으로도 대부분 걸러지지만, 문서가 몇 장 없는 저장소에서는 접착제가 "드문 낱말"로 올라선다.
 * 그 자리를 이 표가 막는다. **명사만 넣는다** — 기능 이름이 될 수 있는 낱말은 여기 두지 마라.
 */
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

/**
 * 색인에서 빼는 **폴더 이름**(경로의 어느 칸이든, 소문자로 견줌 — 키 비교가 아니라 이름 판정이라 접어도 안전).
 * 백업·아카이브 사본이 원본 자리를 차지하고 원본이 상한 밖으로 밀리던 실측(349장 중 229장 탈락).
 */
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

/**
 * 이 줄 수를 넘는 파일을 `offset` 없이 통째로 Read 하면 **부분 열람으로 강등**한다.
 *
 * 통째 Read 는 도구가 앞부분만 돌려주고 나머지는 잘리므로, "열었다"를 그대로 인정하면 이 게이트가
 * 막으려는 바로 그 동작(중간 유실)을 통과시키게 된다.
 */
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

/**
 * 원장이 들고 있는 이번 턴 프롬프트의 앞부분 길이.
 *
 * 필수 절을 고르는 데 필요한 것은 "무슨 일을 하려는가"이고 그것은 앞머리에 있다. 통째로 들면 붙여넣은
 * 로그·스택트레이스가 그대로 원장에 남아 세션 200개만큼 곱해진다(§3.2.4 — 키 개수엔 캡이 없다).
 */
export const SPEC_PROMPT_KEEP_CHARS = 4_000;

/** 세션당 기억하는 "건드린 경로" 수 — 경로 축 라우팅의 재료라 최근 것만 있으면 된다. */
export const SPEC_TOUCHED_PATH_MAX = 60;

/** 세션당 들고 있는 인용 대조 결과 수. 넘으면 오래된 것부터 버린다. */
export const SPEC_CITATION_SESSION_MAX = 120;

/**
 * **전선에 싣는** 히트맵 파일 수 — 원장이 드는 수(`SPEC_LEDGER_FILE_MAX`)와 다르다.
 *
 * 원장은 판정 재료라 넉넉히 들어야 하지만, 화면이 한 번에 보여줄 수 있는 것은 몇십 줄이다.
 * 세션 200개가 각자 60개 파일의 구간을 매 브로드캐스트마다 실으면 그 자체가 §9 전선 예산을
 * 삼킨다. 필수 절이 가리키는 파일은 이 상한과 무관하게 **항상** 실린다(그것이 사용자가 보려는 것이다).
 */
export const SPEC_WIRE_FILE_MAX = 24;

/** 전선에 싣는 파일당 구간 수. 겹친 구간은 원장에서 이미 합쳐져 있어 이 수면 한 문서를 다 그린다. */
export const SPEC_WIRE_SPANS_PER_FILE = 40;

/**
 * 색인 캐시 수명. mtime 두 겹 캐시와 함께 쓴다 — 실시간으로 append 되는 문서에서 mtime 만으로는
 * 매 턴 캐시가 빗나가 동기 읽기가 반복된다(§5.11 v4.65 가 배운 그대로).
 */
export const SPEC_INDEX_TTL_MS = 30_000;

/** 인용으로 인정하는 최소 글자 수 — 너무 짧으면 아무 문장에나 걸린다. */
export const SPEC_CITATION_MIN_CHARS = 12;

/** 인용 대조에서 한 번에 보는 최대 글자 수(긴 인용은 앞부분만 대조). */
export const SPEC_CITATION_MAX_CHARS = 600;

/** 프로젝트가 직접 지정하는 설정 파일(팀이 git 으로 공유할 수 있는 자리). */
export const SPEC_SETTINGS_FILE = '.vibisual/spec.json';

/** 화면 드롭다운이 쓰는 강도 목록 — 순서가 곧 강해지는 순서다. */
export const SPEC_GATE_STRENGTHS = ['observe', 'warn', 'enforce'] as const;

/**
 * §5.5 #17-44 ⑧ — 층별 덮어쓰기 맵의 칸 수 상한.
 *
 * 에이전트·세션 id 는 그 세션이 사라져도 이 맵에 **잔칸**으로 남아 단조 증가한다(§3.2.4 "키 개수엔
 * 캡이 없다"가 잡아 온 그 모양). 넘치면 가장 먼저 적힌 칸부터 버린다 — 최근에 정한 것이 지금 쓰는
 * 것이기 때문이다.
 */
export const SPEC_SCOPE_ENTRY_MAX = 200;

// ─── §5.10 자동 목표 — 되풀이를 스킬로 굳히는 문턱 ───────────────────────

/**
 * **스킬이 되는 문턱** — 같은 절차를 이만큼 되풀이하면 자동으로 굳힌다.
 *
 * 2 로 두면 "우연히 두 번 같은 순서"가 전부 스킬이 되고, 5 로 두면 며칠을 써도 한 장도 안 생겨
 * 사용자가 켠 결과를 못 본다. 3 은 `GOAL_ACTION_MIN_REPEAT` 이 팔레트에서 이미 쓰던 값이라
 * 같은 프로젝트 안에서 "되풀이"의 뜻이 두 개가 되지 않는다.
 */
export const AUTO_GOAL_MIN_RUNS = 3;

/** 절차 한 벌로 인정하는 **최소 단계 수** — 한 줄짜리는 절차가 아니라 명령이다(팔레트의 몫). */
export const AUTO_GOAL_SEQUENCE_MIN = 2;

/**
 * 절차 한 벌의 **최대 단계 수**.
 *
 * 길수록 정확히 같은 순서가 되풀이될 확률이 급격히 떨어져, 상한을 올리면 후보가 늘기는커녕
 * 아무것도 안 잡힌다. 긴 작업은 짧은 묶음 여럿으로 잡히는 편이 다시 쓰기도 쉽다.
 */
export const AUTO_GOAL_SEQUENCE_MAX = 6;

/**
 * 한 절차로 묶는 **시간 창**. 이보다 멀리 떨어진 두 명령은 이어진 일로 보지 않는다.
 *
 * 없으면 어제 친 `git status` 와 오늘 친 `pnpm build` 가 한 절차가 된다 — 시간이 그 둘을
 * 갈라 주는 유일한 증거다.
 */
export const AUTO_GOAL_WINDOW_MS = 15 * 60 * 1000;

/** 화면에 세우는 후보 수 상한 — 넘으면 "자주 하는 일"이 아니라 목록이 된다(팔레트와 같은 규율). */
export const AUTO_GOAL_CANDIDATE_MAX = 12;

/** 후보 제목 길이 상한 — 한 줄에 들어가야 목록으로 읽힌다. */
export const AUTO_GOAL_TITLE_MAX = 56;

/** 단계 한 줄의 길이 상한 — 원문을 지우지 않되 화면과 frontmatter 가 감당할 만큼만. */
export const AUTO_GOAL_STEP_MAX = 200;

/**
 * 물린 후보 id 보관 상한.
 *
 * "다시 제안하지 마라"는 사용자의 결정이라 지우면 안 되지만, 이 목록도 단조 증가한다
 * (§3.2.4). 넘치면 가장 먼저 물린 것부터 버린다 — 오래전에 물린 절차는 이미 관찰에서도
 * 사라졌을 가능성이 높다.
 */
export const AUTO_GOAL_DISMISSED_MAX = 200;

/**
 * 훑는 행동 이력의 **꼬리 길이**(에이전트당).
 *
 * 전량을 매번 다시 세면 이력이 쌓일수록 분석이 느려진다(§9 "쓸수록 느려진다"가 잡아 온 모양).
 * 되풀이는 최근 습관이라 꼬리만 봐도 답이 같다.
 */
export const AUTO_GOAL_SCAN_TAIL = 400;

/** 자동으로 굳히는 스킬 수의 총량 상한 — 넘으면 더 짓지 않는다(디스크·주입 둘 다 지킨다). */
export const AUTO_GOAL_SKILL_BUDGET = 40;

/**
 * 기본 설정 — **기본은 알림이다.**
 *
 * 오탐으로 매 턴 막히면 사용자는 이 기능을 꺼 버린다. 그것이 이 기능의 유일한 실패 방식이라
 * 기본값은 아무것도 막지 않는 쪽이고, 막는 것은 사용자가 켠다.
 */
export const DEFAULT_SPEC_READING_SETTINGS = {
  strength: 'observe' as const,
  maxRequired: SPEC_REQUIRED_MAX,
  stopRetries: SPEC_STOP_RETRY_DEFAULT,
};

// ─── §5.5 #17-33 ⑦ — Claude Code 플러그인 자동 갱신 ───
//
// 왜 있는가: 마켓 클론은 `claude plugin marketplace update` 를 누가 부르기 전까지 **영영 그대로**다.
// 실측(2026-09-09) 공식 마켓 클론은 2026-08-04 에 멈춰 36일 낡아 있었고, 그동안 Anthropic 이 낸
// 스킬은 화면에 한 개도 나타나지 않았다. 부를 자리가 없던 것이 원인이라 주기를 여기 못 박는다.

/**
 * 기본 설정 — **기본은 둘 다 켬.**
 *
 * 플러그인 갱신은 도는 코드가 바뀌는 일이라 조심스럽지만, 끌 자리를 주는 것과 켤 자리를 못 찾아
 * 36일 멈춰 있는 것 중에서는 앞이 낫다(§5.10 브레인 v2 가 기본 off 로 겪은 함정의 반대편).
 */
export const CLAUDE_PLUGIN_REFRESH_DEFAULTS = {
  market: true,
  plugins: true,
  intervalHours: 24,
};

/** 주기 하한 — 이보다 자주 부르면 매번 git 을 타 사용자 회선만 축낸다. */
export const CLAUDE_PLUGIN_REFRESH_MIN_INTERVAL_HOURS = 1;

/** 주기 상한 2주 — 이보다 길면 "자동" 이라 부를 수 없다. */
export const CLAUDE_PLUGIN_REFRESH_MAX_INTERVAL_HOURS = 24 * 14;

/**
 * 기동 후 첫 확인까지의 유예.
 *
 * 부팅 직후는 프로젝트 복원·체크포인트 읽기로 가장 바쁜 구간이라, 여기에 git 을 타는 스폰을
 * 얹으면 첫 화면이 늦는다. 사용자가 눈치채지 못할 만큼만 미룬다.
 */
export const CLAUDE_PLUGIN_REFRESH_STARTUP_DELAY_MS = 45_000;

/**
 * "지금 할 때가 됐나" 를 보는 간격 — 실제 갱신이 아니라 **판정만** 이 간격으로 한다.
 * 30분마다 시각 하나를 견주는 것뿐이라 값이 0 에 가깝고, 앱을 며칠 켜 둔 사용자도 주기를 놓치지 않는다.
 */
export const CLAUDE_PLUGIN_REFRESH_TICK_MS = 30 * 60_000;

/** 갱신 뒤 화면에 적어 두는 "이번에 올라간 것" 최대 개수(그 이상은 수로만 적는다). */
export const CLAUDE_PLUGIN_REFRESH_UPDATED_KEEP = 12;

/**
 * 한 번의 훑기에서 올릴 설치본 최대 개수.
 *
 * 뒤처진 것이 수십 개면 하나에 최대 180초를 잡아 두었으므로 한 번에 다 하려다 몇 시간을 문다.
 * 남은 것은 다음 주기에 이어 간다 — **끝내지 못하는 것보다 나눠서 끝내는 편이 낫다.**
 */
export const CLAUDE_PLUGIN_REFRESH_MAX_PER_RUN = 8;
