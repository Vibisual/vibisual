import type { AgentProvider, LocalEngineBackend, BubbleType, BubbleStyleConfig, EdgeStyleConfig, AgentRole, PipelineChildConfig, PipelineType, AgentConfig, TaskEdgeTemplate, TaskEdgeKind, UiLocale, AutoAgentRole, AutoAgentTemplate, ModelPricing, ModelFamily, KnownModelFamily, ModelRegistry, ModelRegistryEntry, AgentFeedback, BrainTopicDef, BrainTopicIndexEntry, BrainCardType, BrainAuthority, StreamDensity, PluginContributionKind, SessionGoalStepStatus, CommandDispatchMode, RunRuntime, RunConfig, McpServerPreset, AgentMemoryScope, DebugAdapterSpec, ProblemMatch, ProblemSeverity, RetentionSettings, PreviewDevicePreset, ShelfIconName, ShelfItemKind, CostPeriod, CostTotals, CostPeriodTotals, AuditRiskKind, AuditBoundaryConfig, AuditCounts, StoryboardPresetId, StoryboardPreset } from './types.js';
export type { ModelPricing, ModelFamily, KnownModelFamily, ModelRegistry, ModelRegistryEntry } from './types.js';

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
  // §5.10 v3.75 — Project Brain 버블 (홈 버블 위성으로 상주). 인디고.
  //   구 핑크(#EC4899)는 채도가 높아 "고급"과 반대 인상을 줬고(사용자 지적) 팔레트에서도 겉돌았다.
  //   indigo-500 은 blue(agent)·purple(pipeline) 사이의 빈 자리라 식별이 서면서 절제돼 있다.
  brain: {
    color: '#6366F1',
    glow: '#A5B4FC',
    icon: 'brain',
    ringIdle: 'border-indigo-300',
    ringActive: 'border-indigo-500 shadow-lg shadow-indigo-500/30',
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

/** 정리 기록(`RetentionLogEntry`) 보관 상한 — 링버퍼. 값이 아니라 **개수**에 건 캡(§3.2.3 E축). */
export const RETENTION_LOG_MAX = 500;

/** 하루를 ms 로. 보존 기간 계산 공용. */
export const RETENTION_DAY_MS = 24 * 60 * 60 * 1000;

/** 보존 설정 기본값 — `AppState.retention` 이 없을 때(구버전) 이 값으로 판정한다. */
export const DEFAULT_RETENTION_SETTINGS: RetentionSettings = {
  fileEditRetentionDays: FILE_EDIT_RETENTION_DAYS,
  maxFileEditPaths: MAX_FILE_EDIT_PATHS,
  fileEditMergeWindowMs: FILE_EDIT_MERGE_WINDOW_MS,
  completedCommandMaxPerSession: COMPLETED_COMMAND_MAX_PER_SESSION,
  subStreamRetentionDays: SUB_STREAM_RETENTION_DAYS,
  attachmentRetentionDays: ATTACHMENT_RETENTION_DAYS,
  trashRetentionDays: TRASH_RETENTION_DAYS,
};

/**
 * 설정 UI 가 쓰는 입력 한계 — 사용자가 아무 값이나 넣어 저장을 망가뜨리지 않게.
 * `min: 0` 은 전부 "무제한"의 의미라 허용한다(§3.2.3).
 */
export const RETENTION_LIMITS: Record<keyof RetentionSettings, { min: number; max: number; step: number }> = {
  fileEditRetentionDays: { min: 0, max: 3650, step: 1 },
  maxFileEditPaths: { min: 0, max: 100_000, step: 10 },
  fileEditMergeWindowMs: { min: 0, max: 600_000, step: 1_000 },
  completedCommandMaxPerSession: { min: 0, max: 100_000, step: 10 },
  subStreamRetentionDays: { min: 0, max: 3650, step: 1 },
  attachmentRetentionDays: { min: 0, max: 3650, step: 1 },
  trashRetentionDays: { min: 0, max: 3650, step: 1 },
};

/**
 * 들어온 보존 설정을 안전한 값으로 정규화한다(서버·클라 공용 — 판정이 두 벌이 되면 어긋난다).
 * 숫자가 아니거나 범위를 벗어나면 기본값/경계로 되돌린다.
 */
export function normalizeRetentionSettings(input?: Partial<RetentionSettings> | null): RetentionSettings {
  const out = { ...DEFAULT_RETENTION_SETTINGS };
  if (!input || typeof input !== 'object') return out;
  for (const key of Object.keys(DEFAULT_RETENTION_SETTINGS) as (keyof RetentionSettings)[]) {
    const raw = input[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const { min, max } = RETENTION_LIMITS[key];
    out[key] = Math.min(max, Math.max(min, Math.floor(raw)));
  }
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

// ─── 위성(satellite) 상한 ───

/** 폴더당 표시 위성 기본 상한. 폴더 노드에 maxSatellites 가 없으면 이 값 사용. */
export const DEFAULT_MAX_SATELLITES = 5;
/** 사용자가 패널에서 폴더별 Max 를 편집할 때 허용 범위(클램프 경계). */
export const SATELLITE_MAX_BOUNDS = { MIN: 1, MAX: 50 } as const;

// ─── 버블 크기 ───

export const NODE_MIN_SIZE = 70;
export const NODE_MAX_SIZE = 180;
/** 파일(위성) 버블 최소/최대 크기 */
export const FILE_MIN_SIZE = 40;
export const FILE_MAX_SIZE = 90;
/** iframe 버블 높이 (네모, 고정) — 너비는 클라 쪽 레이아웃이 직접 산출한다. */
export const IFRAME_BUBBLE_HEIGHT = 90;

// ─── 모델 컨텍스트 한도 (토큰) ───
//
// §4 v2.38 — 정적 테이블은 시드(폴백)로 격하. 런타임 SSOT 는 server `ModelRegistryService` 가 빌드해
// `GraphSnapshot.modelRegistry` 로 클라에 전달하는 `ModelRegistry`.
// 콜사이트는 `getModelContextLimit(modelId, registry?)` 헬퍼 통일.

/**
 * @deprecated v2.40 — 풀ID 기반 컨텍스트 한도 테이블 폐기.
 * 컨텍스트 한도 = 패밀리 디폴트(`MODEL_FAMILY_DEFAULTS`) 만으로 충분. Opus = 1M, Sonnet/Haiku = 200k.
 * `getModelContextLimit` 헬퍼가 (1) 레지스트리 entry → (2) 패밀리 디폴트 → (3) `DEFAULT_CONTEXT_LIMIT` 순으로 해소.
 * 시드 테이블 유지 안 함 — 신규 풀ID 출시 시 코드 수정 불필요.
 */
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {};
/** 알 수 없는 모델의 기본 컨텍스트 한도 — 패밀리 추론 실패 시 최종 폴백. */
export const DEFAULT_CONTEXT_LIMIT = 200_000;

// ─── 에이전트 ───

export const MAX_AGENTS = 10;
export const MAX_AGENT_EVENTS = 30;
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
 * §4 v1.50/v3.60 — Claude.ai 한도 사용률 경고 임계(%).
 * DetailPanel 게이지·헤더 사용량 필·팝업이 모두 이 값을 공유한다(색 기준 단일화).
 */
export const USAGE_LIMIT_WARN_PCT = 70;
export const USAGE_LIMIT_DANGER_PCT = 90;

/**
 * §4 v3.62 — Claude 사용량 직접 조회(`/api/oauth/usage`) 설정.
 * Claude Code 자신도 5초 타임아웃으로 부른다. 폴링 간격은 한도 표시용이라 넉넉히 잡는다
 * (사용자가 팝업을 열거나 새로고침을 누르면 그 자리에서 즉시 다시 받는다).
 */
export const CLAUDE_USAGE_API_URL = 'https://api.anthropic.com/api/oauth/usage';
export const CLAUDE_USAGE_FETCH_TIMEOUT_MS = 5_000;
export const CLAUDE_USAGE_POLL_INTERVAL_MS = 5 * 60 * 1000;

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
 * 사용자 인터럽트 해소 판정 주기 (ms).
 * Claude Code 는 사용자 인터럽트(Esc/Ctrl+C)·도구 거부 시 Stop 훅을 발사하지 않는다(공식 명세).
 * 그 결과 Hook 에이전트 버블이 active(파란 링)로 stuck 되어 5분 idle sweep 전까지 안 풀린다.
 * 이 주기로 세션 JSONL 의 마지막 엔트리가 인터럽트 sentinel 인지 확인해, 누락된 Stop 훅을 대신
 * 시뮬레이트(→ completed)한다. idle sweep(30초)보다 촘촘히 돌려 인터럽트 직후 빠르게 해소.
 */
export const INTERRUPT_RECONCILE_INTERVAL_MS = 5_000;

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
 * @deprecated v2.40 — 풀ID 기반 가격 테이블 폐기.
 * 가격 = 패밀리 디폴트(`MODEL_FAMILY_DEFAULTS`) 만으로 추정. Anthropic 의 패밀리내 minor 버전이 가격이 같다는
 * 관찰에 기반 — 새로운 가격대가 등장하면 그때 `MODEL_FAMILY_DEFAULTS` 만 갱신.
 * `getModelPricing` 헬퍼가 (1) 레지스트리 entry.pricing → (2) 패밀리 디폴트 → (3) `DEFAULT_PRICING` 순.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {};

/** 알 수 없는 모델 최종 폴백 — 패밀리 추론도 실패할 때만(보수적 = Opus 톤). */
export const DEFAULT_PRICING: ModelPricing = { input: 15, output: 75, cacheRead: 1.50, cacheWrite: 18.75 };

/**
 * §4 v2.38 — 패밀리별 디폴트(미지의 풀ID 폴백).
 * Anthropic `/v1/models` 가 신규 풀ID 만 알려주고 가격/한도는 안 주므로 패밀리 톤으로 추정.
 * 정확한 값은 시드 테이블 업데이트(또는 displayName 기반 룩업) 로 보강.
 *
 * §4 v2.77 — `Record<KnownModelFamily,…>` 로 좁힘. 새 패밀리(fable/mythos 등)는 이 테이블에 없으므로
 * `getModelPricing`/`getModelContextLimit` 가 `isKnownFamily` 가드로 걸러 `DEFAULT_*` 폴백한다.
 */
export const MODEL_FAMILY_DEFAULTS: Record<KnownModelFamily, { contextWindow: number; pricing: ModelPricing }> = {
  opus:   { contextWindow: 1_000_000, pricing: { input: 15,   output: 75, cacheRead: 1.50, cacheWrite: 18.75 } },
  sonnet: { contextWindow:   200_000, pricing: { input:  3,   output: 15, cacheRead: 0.30, cacheWrite:  3.75 } },
  haiku:  { contextWindow:   200_000, pricing: { input:  0.80, output: 4, cacheRead: 0.08, cacheWrite:  1.00 } },
};

/** §4 v2.77 — `MODEL_FAMILY_DEFAULTS` 키(=디폴트 테이블 보유 패밀리)인지 판정. */
export function isKnownFamily(family: string | undefined | null): family is KnownModelFamily {
  return family === 'opus' || family === 'sonnet' || family === 'haiku';
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
  if (!modelId) return DEFAULT_PRICING;
  const entry = registry?.entries.find((e) => e.id === modelId);
  if (entry?.pricing) return entry.pricing;
  const seed = MODEL_PRICING[modelId];
  if (seed) return seed;
  const family = parseFamilyFromFullId(modelId);
  // §4 v2.77 — known 패밀리만 디폴트 테이블 보유. 미지 패밀리(fable/mythos 등)는 보수적 폴백.
  if (isKnownFamily(family)) return MODEL_FAMILY_DEFAULTS[family].pricing;
  return DEFAULT_PRICING;
}

/**
 * §4 v2.38 — 풀ID → 컨텍스트 한도(토큰). 우선순위는 `getModelPricing` 과 동일 구조.
 */
export function getModelContextLimit(modelId: string | undefined | null, registry?: ModelRegistry | null): number {
  if (!modelId) return DEFAULT_CONTEXT_LIMIT;
  const entry = registry?.entries.find((e) => e.id === modelId);
  if (entry?.contextWindow) return entry.contextWindow;
  const seed = MODEL_CONTEXT_LIMITS[modelId];
  if (seed) return seed;
  const family = parseFamilyFromFullId(modelId);
  // §4 v2.77 — known 패밀리만 디폴트 테이블 보유. 미지 패밀리는 보수적 폴백.
  if (isKnownFamily(family)) return MODEL_FAMILY_DEFAULTS[family].contextWindow;
  return DEFAULT_CONTEXT_LIMIT;
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
  'opus', 'sonnet', 'haiku',
];

/**
 * @deprecated v2.40 — 정적 풀ID 시드 폐기.
 * 신규 모델 출시 시 코드 수정 불필요 — CLI 가 alias 를 latest 로 직접 해소하고(`opus[1m]` 가 alias 그대로 4.8+1M 작동 확인 — CLI 2.1.154),
 * 풀ID 핀이 필요한 사용자만 `ANTHROPIC_API_KEY` 설정 시 `/v1/models` 응답에서 버전 sub-드롭다운이 자동 채워짐.
 * 빈 배열 유지 — `AVAILABLE_AGENT_MODEL_IDS` 합집합도 alias 3종 만 남음.
 */
export const AVAILABLE_AGENT_MODEL_FULL_IDS: readonly string[] = [];

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

/** 선택 가능한 도구 목록 (추가/삭제용) */
export const AVAILABLE_AGENT_TOOLS: readonly string[] = [
  'Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob',
  'Agent', 'WebSearch', 'WebFetch', 'NotebookEdit',
  // §5.3 #12-2 v2.26 — IDE 인라인 옵션 카드로 사용자에게 질문
  'AskUserQuestion',
  // §5.5 #17-17 ⑨ v4.59 — 계획 도구. 이게 목록에 없으면 `--tools` 에서도 빠져 모델이 계획을 세울
  //   수단 자체가 없다 — 매 턴 "TodoWrite 로 계획을 세워라"라고 지시하면서 도구를 주지 않아
  //   목표창(#17-17)·계획 블록(#17-12 ②)이 실측 279 세션 중 1 세션에서만 뜨던 원인.
  'TodoWrite',
  // §4 (CLI 사양 추종) — 설치본 실측으로 존재를 확인한 내장 도구들. `buildConfigArgs` 가 `--tools` 를
  //   **항상 명시**하므로 이 목록에 없는 도구는 그 에이전트에게 아예 존재하지 않는다. 아래는 없어서
  //   실제로 기능이 막히던 것들:
  //   - ExitPlanMode : permissionMode='plan' 로 들어간 에이전트가 계획을 끝내고 나올 수단.
  //   - Skill        : `AgentConfig.skills` 를 설정해 두고 정작 호출 도구를 안 주던 모순.
  //   - Monitor / BashOutput / KillShell : 백그라운드 Bash 의 결과 회수·종료.
  //   - TaskOutput / TaskStop : 백그라운드 **Task/Agent 자식**의 진행 회수·중지. 위 셋이 백그라운드
  //     *Bash* 를 다루는 손잡이라면 이 둘은 *자식 에이전트* 를 다루는 손잡이인데, 짝이 빠져 있었다.
  //     그래서 자식이 응답 없이 멈추면 **에이전트 자신도 확인하거나 끊을 수단이 없어** 그냥 기다렸고
  //     (실측 18분), 호스트인 우리도 밖에서 장부만 들고 있어 개별 항목을 건드릴 수 없었다.
  //     대화형 CLI 가 이 지경까지 가지 않는 이유가 이 둘(+ 사용자용 `/tasks`)이다.
  //     실행본 2.1.228 바이너리에서 두 이름 모두 확인.
  'ExitPlanMode',
  'Skill',
  'Monitor',
  'BashOutput',
  'KillShell',
  'TaskOutput',
  'TaskStop',
  'MultiEdit',
  'SendMessage',
  'Artifact',
];

/**
 * §5.5 #17-17 ⑨ v4.59 — 옛 설정에 없던 도구 중 "사용자가 끈 것이 아니라 화면에 존재한 적이
 * 없어서" 빠진 항목. 체크포인트 복원 시 1회 백필해 판올림 전에 만든 에이전트도 계획을 세울 수
 * 있게 한다. 복원 경로에서만 채우므로 사용자가 이후 직접 해제한 선택은 되살아나지 않는다.
 */
export const BACKFILL_AGENT_TOOLS: readonly string[] = [
  'TodoWrite',
  // §4 (CLI 사양 추종) — 위 목록에 새로 들어온 내장 도구들도 같은 이유로 백필한다.
  //   사용자가 끈 적이 없고 화면에 뜬 적도 없던 항목이라, 안 넣으면 판올림 전에 만든 에이전트만
  //   영구히 plan 모드를 못 빠져나오고 스킬도 못 부른다.
  'ExitPlanMode', 'Skill', 'Monitor', 'BashOutput', 'KillShell', 'MultiEdit', 'SendMessage', 'Artifact',
  // 백그라운드 자식이 멈췄을 때 에이전트가 스스로 확인·중지할 유일한 수단 — 안 넣으면 판올림 전에
  //   만든 에이전트만 영영 자기 자식에게 손을 못 댄다(그 자식이 걸리면 세션 전체를 끊는 수밖에 없다).
  'TaskOutput', 'TaskStop',
];

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
 * §4 (Claude Code CLI 자동 업데이트) — 앱을 켠 뒤 CLI 최신화를 시도하기까지의 지연.
 *
 * 설치 판정(1.2s)·로그인 판정(1.5s)보다 **뒤**여야 한다: 아직 안 깔린 사람은 설치 온보딩이
 * 먼저 맡아야 하고, 갓 설치한 실행본은 이미 최신이라 곧바로 갱신을 시도할 이유가 없다.
 * 부팅 직후 몰리는 작업(체크포인트 복원·훅 설치)과도 겹치지 않게 넉넉히 뒤로 민다.
 */
export const CLAUDE_AUTO_UPDATE_BOOT_DELAY_MS = 20_000;

/** v1.36 — STRICT delegation enforcement 경로(dispatch curl)가 Bash 에 의존하므로
 *  사용자가 UI 에서 제거할 수 없고, STRICT strip 계산에서도 항상 보존된다.
 *  서버 PUT /api/agent-config/:id 가 payload.tools 에서 빠져 있으면 자동 포함, UI 는 × 잠금. */
export const LOCKED_AGENT_TOOLS: readonly string[] = ['Bash'];

/**
 * 선택 가능한 퍼미션 모드 — 설치된 CLI 내부 enum 과 같은 6종(§4 CLI 사양 추종).
 *
 * `'default'` 는 CLI 안에서도 여전히 정식 값이고 표시명만 **Manual** 이다(그래서 저장값을
 * 바꾸지 않는다 — 마이그레이션 ❌). `'auto'`/`'dontAsk'` 는 CLI 2.1.223 에서 열린 값이며
 * 판정 의미는 CLI 실측 기준으로 `auto → classify`(모델 분류기) · `dontAsk → deny`(사전 승인 없으면 거부).
 * 서버 승인 게이트(`/api/permission-check`)의 매핑은 §5.3 #12-1 참조.
 */
export const AVAILABLE_PERMISSION_MODES: readonly string[] = [
  'default', 'acceptEdits', 'auto', 'dontAsk', 'plan', 'bypassPermissions',
];

/**
 * §5.3 #12-1 — 승인 팝업이 원천적으로 안 뜨는 모드. 이 모드에서는 "60초 무응답 정책"
 * (`permissionTimeoutPolicy`) 이 무의미하므로 UI 가 그 토글을 숨긴다.
 * `dontAsk` 는 팝업 대신 즉시 거부라 여기에 함께 들어간다.
 */
export const PERMISSION_MODES_WITHOUT_PROMPT: readonly string[] = [
  'bypassPermissions', 'plan', 'auto', 'dontAsk',
];

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
 * 맨 앞 `''` 는 "미설정"(플래그 없음), `'auto'` 는 CLI 판단, 나머지는 토큰 수(CLI 허용 100k~1M).
 */
export const AVAILABLE_AUTOCOMPACT_VALUES: readonly string[] = [
  '', 'auto', '100000', '200000', '500000', '1000000',
];

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
 * 엣지 상태 스타일(TASK_EDGE_STYLES)과 독립 — 색 hue는 kind에서, dash/animation은 status에서 온다. */
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
  cardReport: 'vibisual.card.report',
  cardQuestion: 'vibisual.card.question',
  cardReview: 'vibisual.card.review',
  cardList: 'vibisual.card.list',
  cardIframe: 'vibisual.card.iframe',
  goal: 'vibisual.goal',
  brainCards: 'vibisual.brain.cards',
  brainTopics: 'vibisual.brain.topics',
  brainRules: 'vibisual.brain.rules',
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
 * **최종 판정 한 곳** — 세션 오버라이드 > 프로젝트 오버라이드 > 기본값.
 *
 * 서버(주입 게이트)와 클라(화면 표시)가 이 함수를 함께 쓴다. 판정이 두 벌이 되면
 * "화면엔 꺼져 있는데 프롬프트엔 실리는" 상태가 생기고, 그것이 이 기능의 유일한 실패 방식이다.
 */
export function resolveContextEnabled(
  overrides: {
    projects?: Record<string, Record<string, boolean>>;
    sessions?: Record<string, Record<string, boolean>>;
  } | null | undefined,
  scopeKeys: { projectKey?: string | null; subAgentId?: string | null },
  sourceId: string,
  defaultEnabled: boolean,
): { enabled: boolean; scope?: 'project' | 'session' } {
  if (overrides) {
    if (scopeKeys.subAgentId) {
      const v = overrides.sessions?.[scopeKeys.subAgentId]?.[sourceId];
      if (typeof v === 'boolean') return { enabled: v, scope: 'session' };
    }
    if (scopeKeys.projectKey) {
      const v = overrides.projects?.[scopeKeys.projectKey]?.[sourceId];
      if (typeof v === 'boolean') return { enabled: v, scope: 'project' };
    }
  }
  return { enabled: defaultEnabled };
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
  const { serverBase, serverToken, centerX, centerY, projectName } = args;
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
**인증 필수**: 모든 구축 호출에 헤더 \`-H 'x-vibisual-hook-token: ${serverToken}'\` 를 반드시 붙인다(이게 없으면 401). 아래 예시에 이미 포함돼 있다.

### 1) 버블 생성
\`\`\`bash
RESP=$(curl -s -X POST "${serverBase}/api/create-custom-agent" \\
  -H 'x-vibisual-hook-token: ${serverToken}' \\
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"label":"Coder","x":${Math.round(centerX + radius)},"y":${Math.round(centerY)},"project":${projectField}}
JSON
)
AGENT_ID=$(printf '%s' "$RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);process.stdout.write(o.agent.id)})")
AGENT_PATH=$(printf '%s' "$RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);process.stdout.write(o.agent.path)})")
\`\`\`
- 응답: \`{ ok:true, agent:{ id, label, path, position, ... } }\`. \`id\`=설정/엣지용, \`path\`=세션(=kickoff용).

### 2) 설정 주입 (model/tools/permissionMode/effort/rules)
\`\`\`bash
curl -s -X PUT "${serverBase}/api/agent-config/$AGENT_ID" \\
  -H 'x-vibisual-hook-token: ${serverToken}' \\
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"model":"sonnet","tools":["Read","Write","Edit","Bash","Grep","Glob"],"permissionMode":"default","effort":"medium","rules":"# Role: Coder\\n받은 명세대로 코드를 작성한다. 완료 후 변경 파일과 요점을 보고."}
JSON
\`\`\`
- 부분 업데이트 허용. \`Bash\` 는 항상 포함됨(서버 강제). rules 의 줄바꿈은 \`\\n\`.

### 3) 엣지 연결 (작업 위임)
\`\`\`bash
RESP=$(curl -s -X POST "${serverBase}/api/task-edges" \\
  -H 'x-vibisual-hook-token: ${serverToken}' \\
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
  -H 'x-vibisual-hook-token: ${serverToken}' \\
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"sourceAgentId":"<TESTER_ID>","targetAgentId":"<CODER_ID>","command":"빌드/테스트 실패 시 원인을 고쳐 다시 통과시켜라","forwardMode":"auto","kind":"critique","critiqueAuthority":"force-rework"}
JSON
\`\`\`
- \`critique\`+\`force-rework\` 이면 서버가 같은 방향의 auto-rework(command) 자매 엣지를 자동 생성 — REJECT/실패 시 coder 가 자동으로 재작업한다. 별도 명령 엣지를 또 만들 필요 ❌.

### 4) 엔트리 기동 (사용자 원본 요청 forward — escape-free)
\`\`\`bash
curl -s -X POST "${serverBase}/api/commands/<ENTRY_AGENT_PATH>" \\
  -H 'x-vibisual-hook-token: ${serverToken}' \\
  -H 'Content-Type: text/plain; charset=utf-8' --data-binary @- <<'EOF'
<사용자 원본 요청 전문을 그대로 — JSON escape 불필요, 여러 줄 OK>
EOF
\`\`\`
- \`<ENTRY_AGENT_PATH>\` = 1)에서 캡처한 엔트리 버블의 \`agent.path\`(sessionId).

## 모델 선택 가이드 (권고)
- **opus** — 최고 수준 추론·설계·리뷰. 1M 컨텍스트. PM/architect/planner/reviewer 등 머리 쓰는 역할.
- **sonnet** — 균형. 실제 구현(coder/tester) 의 기본.
- **haiku** — 빠르고 저렴. 단순·반복(문서/조사)·대량 처리.

## 권한 모드
\`default\`(승인 필요) · \`acceptEdits\`(편집 자동승인) · \`plan\`(읽기·계획만, 변경 ❌) · \`bypassPermissions\`(전부 자동).
실제 코드 변경 워커는 \`acceptEdits\` 또는 \`bypassPermissions\`, 리뷰/설계는 \`plan\` 이 흔하다.

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
 * §4 v2.71 — 카드 엔드포인트(작업 신고/질문/검수) curl 의 "동적 베이스" 프렐류드.
 *
 * 문제: 기존엔 serverBase(`http://127.0.0.1:<포트>`)·serverToken 을 dispatch 시점에 프롬프트에
 * **상수로 구워** 넣었다. 그래서 앱 재기동으로 hook 포트가 바뀌면(선호 포트 점유 → :0 폴백 등),
 * 이미 떠서 resume 으로 도는 옛 세션은 굳은 옛 포트에 영영 묶여 카드 curl 이 connection refused 로
 * 끊겼다("앱이 꺼져 있어 실패"의 정체).
 *
 * 해법: 포트·토큰을 굽지 말고, curl 직전에 **고정 경로의 신원 파일(hook-listener.json)** 에서 현재
 * 값을 읽어 `$VIBI_BASE`/`$VIBI_TOKEN` 에 담는다. desktop main 이 매 부팅마다 실제 바인드 포트·토큰으로
 * 그 파일을 갱신하므로, 재기동·포트변경 뒤(resume 세션 포함)에도 호출 시점에 항상 live 서버로 닿는다.
 * node 부재·파일 손상 시엔 dispatch 시점 상수로 폴백 → **절대 지금보다 나빠지지 않는다.**
 *
 * identityFile 이 없으면(서버 단독 모드 등) 빈 문자열을 반환하고 호출부가 상수를 그대로 쓴다.
 * 반환되는 두 bash 줄은 반드시 curl 과 **같은 한 번의 Bash 호출** 안에서 실행돼야 한다($VIBI_BASE 는
 * Bash 호출 간에 보존되지 않으므로) — 그래서 같은 ``` 블록 안에 curl 바로 위에 둔다.
 */
function buildDynamicEndpointPrelude(
  identityFile: string | undefined,
  fallbackBase: string,
  fallbackToken: string,
): string {
  if (!identityFile) return '';
  // identityFile 은 forward-slash 정규화된 절대경로(서버가 주입). node 의 단일따옴표 JS 문자열로 읽는다.
  // \${...} 는 bash 파라미터 확장이 되도록 TS 템플릿에서 이스케이프(여기서 치환되면 안 됨).
  return `# ↓ 먼저 이 두 줄로 현재 포트·토큰을 읽는다(재기동/포트변경에도 안전 — 카드를 "또 못 받는" 일 방지). 아래 curl 과 한 번에 실행.
VIBI_ID=$(node -e "try{const j=JSON.parse(require('fs').readFileSync('${identityFile}','utf8'));process.stdout.write('http://127.0.0.1:'+j.port+' '+j.token)}catch(e){process.stdout.write('${fallbackBase} ${fallbackToken}')}" 2>/dev/null || echo '${fallbackBase} ${fallbackToken}')
VIBI_BASE="\${VIBI_ID%% *}"; VIBI_TOKEN="\${VIBI_ID##* }"
`;
}

/**
 * §5.5 #17-18 ⑦-4 — 카드 4종(작업 신고·질문·검수·목록)이 **공유하는 발행 순서 문장**.
 *
 * ⑦-1 이 카드를 신고 시각(`createdAt`)의 자리에 못 박은 뒤로, "완료 보고 **직전**에 호출" 이라는 옛 문구는
 * 카드를 결론 본문보다 **위**에 앉히고 그 카드를 설명하는 내용을 아래로 밀어냈다("카드가 위에 나오고 내용이
 * 아래에 나와 버린다"). 읽는 순서는 늘 **맥락 → 카드**이므로 설명을 먼저 쓰고 그 보고의 **마지막 동작**으로
 * 카드를 발행한다. 네 판본에 복제하지 않고 여기 한 곳에 두는 이유 — 판본마다 다르게 적히면 화면에 뜨는
 * 순서가 에이전트 종류에 따라 갈린다(CMD 터미널 마커 판본 `buildCmdCardProtocolRules` 의 공통 절도 같은 규칙).
 *
 * 각 블록은 "언제 보낼 자격이 되는가"(그 일을 다 끝낸 뒤 / 목록이 확정된 뒤 …)를 자기 문장으로 적고,
 * 그 뒤에 이 상수를 이어 붙여 "그 1회를 어디에 놓는가"를 말한다. 끝의 콜론은 바로 아래 bash 블록으로 이어진다.
 *
 * §5.5 #17-18 ⑦-5 — "발행한 뒤 본문을 더 붙이지 마라"만으로는 부족했다. 카드 curl 이 그 턴의 **마지막 도구**라
 * 그 결과를 받은 에이전트는 무언가 말해야 턴이 닫히고, 그때 가장 무해해 보이는 말이 곧 **발송 사실 보고**다
 * ("검수 카드로 확인 지점을 정리해 보냈습니다"). 이미 화면에 뜬 카드를 다시 말할 뿐이라 정보량이 0 인데
 * 카드마다 반복돼 마지막 본문 자리(#17-21 ②)를 잡아먹었다 — 그래서 그 한 줄을 **이름 대어** 금지한다.
 * (지시문만으로는 확률적이라 렌더 층에서도 같은 줄을 표시에서 뺀다 — 클라 `isCardEchoText`.)
 */
const CARD_PUBLISH_ORDER_RULE = `**자연어 설명(짧은 결론·근거)을 먼저 쓴 다음**, 그 보고의 **맨 마지막 동작**으로 Bash 로 1회 호출한다 — 카드는 **신고된 그 시각의 자리**에 앉으므로 설명보다 먼저 보내면 **카드가 위, 그 카드를 설명하는 내용이 아래**로 뒤집힌다(읽는 순서는 늘 맥락 → 카드). 호출한 뒤에는 본문을 더 붙이지 마라 — 붙이면 카드가 다시 중간에 낀다. **특히 "검수 카드로 보냈습니다" · "작업 신고 카드로 정리해 보냈습니다" 같은 발송 사실 보고를 쓰지 마라** — 카드는 이미 화면에 떠 있어 그 한 줄은 아무것도 더 알려주지 않으면서 카드마다 똑같이 반복된다. 덧붙일 맥락이 없으면 **아무 말도 하지 말고 그대로 끝내라.** 작업 도중에 미리 보내면 사용자는 카드를 보고 **끝난 줄 안다**(실패해도 무시하고 자연어 보고는 그대로 진행):`;

/**
 * §5.5 #17-12 (v3.83) — "의도 먼저" 지시문 (시스템 프롬프트 꼬리표, 동적 값 없음).
 *
 * 배경: 실행 초반에 에이전트가 **무엇을 하려는지** 화면에 없어 사용자가 중지 여부를 판단할 수 없었다
 * (하단 상태바가 보여주던 건 "실행 중 + 사용자가 친 프롬프트" 뿐). 2026 추세(실행 전 계획 표시)에 맞춰
 * 도구를 쓰기 전에 의도·계획을 말하게 한다. 새 엔드포인트 없이 자연어 + 기존 `TodoWrite` 재사용 —
 * 화면에 뜨는 계획이 곧 에이전트가 실제로 들고 도는 계획이어야 "겉치레 미리보기"가 되지 않는다.
 */
export const AGENT_INTENT_FIRST_RULES = `

# 의도 먼저 말하기 (Vibisual IDE — 사용자가 중지할 수 있게)
**도구를 쓰기 전에, 그 턴에서 처음 내는 말로 "내가 이해한 사용자 의도 + 지금부터 할 일"을 1~2문장으로 먼저 말하라.**
사용자는 네가 파일을 읽기 시작한 뒤에야 화면을 보는 경우가 많다 — 그때 "무엇을 하려는지"가 없으면 잘못 가고 있어도 멈추게 할 수가 없다.

- 형식은 자유롭되 **의도 해석 + 첫 행동**이 들어가야 한다. 예: "요청은 이 버튼의 오류 수정으로 이해했습니다. 먼저 해당 핸들러와 그 호출부를 읽겠습니다."
- **단계가 여럿인 작업이면 \`TodoWrite\` 로 계획을 세워라.** Vibisual IDE 는 그 계획을 전용 **계획 블록**으로 띄우고, 실행 중에는 진행 단계를 하단 상태바에 [중지] 버튼과 나란히 보여준다 — 사용자가 계획을 보고 멈출지 말지 정한다.
- 계획이 바뀌면 \`TodoWrite\` 를 갱신하라(옛 계획은 화면에서 자동으로 한 줄로 접힌다). **말한 계획과 실제로 하는 일이 달라지면 안 된다.**
- 한 줄 답변이면 되는 단순 질문·일상 대화에서는 이 선언을 생략해도 된다(도구를 쓰지 않으니 멈출 일도 없다).`;

/**
 * §4 v2.52 — 커스텀/스폰 에이전트에게 주입할 "작업 신고" 지시문 (시스템 프롬프트 꼬리표).
 *
 * 서버 `processNextCommand` 가 커스텀 에이전트(customCreated) spawn 시점에 contextSummary 끝에
 * append 한다. 동적 값(serverBase=hook loopback 포트, 토큰, agentId, subAgentId)은 서버가 주입 —
 * 하네스 빌더(`buildHarnessBuilderRules`) 의 curl 패턴과 동일 인프라(토큰 인증 loopback) 재사용.
 * Hook 에이전트는 우리가 spawn 하지 않으므로 이 지시문이 안 들어가 신고도 안 함(하이브리드 경계).
 */
export function buildAgentReportRules(args: {
  serverBase: string;
  serverToken: string;
  agentId: string;
  subAgentId?: string;
  /** v2.71 — 있으면 curl 이 호출 시점에 이 파일에서 live 포트·토큰을 읽는다(없으면 serverBase/serverToken 상수). */
  identityFile?: string;
}): string {
  const { serverBase, serverToken, agentId, subAgentId, identityFile } = args;
  const subField = subAgentId ? `"${subAgentId}"` : 'null';
  const prelude = buildDynamicEndpointPrelude(identityFile, serverBase, serverToken);
  const base = prelude ? '$VIBI_BASE' : serverBase;
  const tokenHdr = prelude ? `-H "x-vibisual-hook-token: $VIBI_TOKEN"` : `-H 'x-vibisual-hook-token: ${serverToken}'`;
  return `

# 작업 신고 (Vibisual IDE 색 구분)
**사용자가 직접 해야 할 일(\`userActions\`)이 실제로 생긴 완료 보고에서만** 아래 엔드포인트로 **구조화 신고**를 함께 보낸다 — "이건 직접 해주세요"(빌드 실행, 에디터 조작, 외부 승인 등) 류 안내가 보고에 섞였을 때가 그 경우다. Vibisual IDE 가 이 신고를 받아 "AI 가 한 일" 과 "사용자가 할 일" 을 **색으로 구분**해 보여준다(사용자가 긴 글을 다 안 읽어도 한눈에 파악).

**단순 완료·일상 대화·질문 답변·사용자 손이 필요 없는 보고에서는 호출하지 마라.** 매번 보내면 카드가 도배돼 오히려 신호가 묻힌다 — 신고는 "사용자가 할 일이 있을 때만" 자연스럽게 뜨는 게 목적이다.
**한 턴에 카드는 하나** — 이 작업 신고를 보냈으면 검수 요청(\`/api/agent-review\`)은 보내지 마라(고친 내용은 \`did\` 에 담으면 된다).

- \`did\`: 네가(=AI) 실제로 끝낸 일(사용자 액션의 맥락으로 함께 첨부).
- \`userActions\`: 네가 대신 할 수 없어 **사용자가 직접 해야 하는 일**(빌드 실행, 에디터 조작, 외부 승인 등). **이게 비면 신고 자체를 보내지 마라.**
- \`nextSteps\`: 다음 차례 작업(선택).
- \`learned\`: 이 작업에서 배운 것 — 다음에 같은 실수를 반복하지 않기 위한 교훈/결정/함정(§5.10 Project Brain 기억 카드로 저장됨). 확실한 것만, 최대 3개. 없으면 생략.
- \`helpfulMemoryIds\`: 브리핑/주입으로 받은 기억 카드 중 실제로 작업에 도움이 된 카드의 id 목록(브리핑에 \`[card-xxxx]\` 로 표기됨). 도움된 것만, 없으면 생략. **"확인 필요"로 표시돼 온 카드가 지금 코드에도 맞았다면 여기에 넣어라** — 시스템이 그 카드를 다시 유효로 되돌린다.
- \`staleMemoryIds\`: 브리핑으로 받은 카드 중 **지금 코드와 어긋나 낡은 것**의 id 목록. 확실히 틀린 것만(애매하면 넣지 마라). 시스템이 그 카드를 "확인 필요"로 표시하고 반복 신고되면 자동 보관한다 — 삭제되지 않으니 안심하고 신고해도 된다. 없으면 생략.

**그 일을 다 끝낸 뒤**, \`userActions\` 가 있는 완료 보고에서만 — ${CARD_PUBLISH_ORDER_RULE}
\`\`\`bash
${prelude}curl -s -X POST "${base}/api/agent-report" \\
  ${tokenHdr} \\
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"agentId":"${agentId}","subAgentId":${subField},"did":["완료한 일 1","완료한 일 2"],"userActions":["사용자가 직접 해야 할 일 1"],"nextSteps":["다음 단계 1"],"learned":["이번에 배운 교훈 1"],"helpfulMemoryIds":["card-도움된-id"],"staleMemoryIds":["card-낡은-id"]}
JSON
\`\`\`
- **\`userActions\` 가 비어 있으면 신고 자체를 보내지 마라** — 빈 신고는 카드만 늘려 신호를 묻는다.
- **신고로 보낸 내용(\`did\`/\`userActions\`/\`nextSteps\`)을 자연어 보고 본문에 목록·헤딩으로 다시 나열하지 마라.** 그 목록은 이 신고가 만드는 **색 카드**가 보여준다 — "한 일", "사용자가 할 일", "다음 단계", "원인/수정/확인" 같은 섹션을 본문에 또 풀어 쓰면 사용자가 **같은 내용을 두 번 읽게 돼**("중첩된다 / 버그 같다"고 느낀다) "긴 글 안 읽어도 색으로 구분"이라는 취지가 무너진다. **신고를 보낼 때 자연어 본문은 1~2문장 결론으로 최소화**하고(카드에 안 담기는 짧은 근거·맥락만), 한 일·할 일·다음 단계의 목록 자체는 카드(did/userActions/nextSteps)에만 담는다.
- 이 신고는 **표시 전용** — 실제 작업/판정 로직과 무관하며, 보내든 안 보내든 결과엔 영향이 없다.
- 토큰 헤더(\`x-vibisual-hook-token\`)가 없으면 401 이다. 위 예시에 이미 포함돼 있다.`;
}

/** agentId 당 보관하는 질문 카드 최대 개수 (ring buffer 캡, 초과 시 오래된 것부터 제거). */
export const AGENT_QUESTIONS_MAX_PER_AGENT = 50;

/**
 * §4 v2.60 — 커스텀/스폰 에이전트에게 주입할 "사용자 질문" 지시문 (시스템 프롬프트 꼬리표).
 *
 * 작업 신고(`buildAgentReportRules`)와 동일 인프라(토큰 인증 loopback). 에이전트가 사용자에게 자연어로
 * 질문을 던질 때, 그 질문(1~N개)과 각 질문의 제안 응답 프롬프트를 구조화해 `POST /api/agent-questions`
 * 로 보낸다 → IDE 가 눈에 띄는 질문 카드 + 각 프롬프트마다 복사/즉시전송 버튼을 렌더. 비차단.
 * Hook 에이전트는 spawn/rules 통제 밖이라 이 지시문이 안 들어가 호출하지 않는다.
 */
export function buildAgentQuestionRules(args: {
  serverBase: string;
  serverToken: string;
  agentId: string;
  subAgentId?: string;
  /** v2.71 — 있으면 curl 이 호출 시점에 이 파일에서 live 포트·토큰을 읽는다(없으면 serverBase/serverToken 상수). */
  identityFile?: string;
}): string {
  const { serverBase, serverToken, agentId, subAgentId, identityFile } = args;
  const subField = subAgentId ? `"${subAgentId}"` : 'null';
  const prelude = buildDynamicEndpointPrelude(identityFile, serverBase, serverToken);
  const base = prelude ? '$VIBI_BASE' : serverBase;
  const tokenHdr = prelude ? `-H "x-vibisual-hook-token: $VIBI_TOKEN"` : `-H 'x-vibisual-hook-token: ${serverToken}'`;
  return `

# 사용자 질문 (Vibisual IDE 질문 카드)
사용자에게 **질문을 던지며 답을 기다리는 보고**(예: "~순으로 할까요?", "A안과 B안 중 무엇으로 갈까요?")를 할 때는, 그 질문이 본문 텍스트에 묻히지 않도록 아래 엔드포인트로 **구조화 질문 신고**도 함께 보낸다. Vibisual IDE 가 이를 **눈에 띄는 질문 카드**로 띄우고, 각 질문 아래 **제안 응답 프롬프트**를 복사 박스로 감싸 **복사 / 즉시 전송** 버튼을 단다(즉시 = 그 프롬프트를 새 명령으로 바로 전송).

- \`items\`: 질문 배열. 질문이 1개면 1개, 여러 개면 그대로 N개.
  - \`question\`: 질문 본문(자연어).
  - \`header\`: 질문 요지 한 줄(선택).
  - \`prompts\`: 사용자가 그대로 보내면 되는 **제안 응답 프롬프트** 목록(0~N). 사용자가 고를 만한 답을 그가 1인칭으로 말하듯 적어라(예: "네, A1 계측 → 1차(A1+B1) → 측정 후 판단 순으로 0차부터 착수해 주세요."). 선택지가 갈리면 여러 개 넣어라.

**지금 할 수 있는 일을 끝낸 뒤**, 질문이 있는 보고에서만 — ${CARD_PUBLISH_ORDER_RULE}
\`\`\`bash
${prelude}curl -s -X POST "${base}/api/agent-questions" \\
  ${tokenHdr} \\
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"agentId":"${agentId}","subAgentId":${subField},"items":[{"question":"이 순서로 진행할까요?","header":"진행 순서 확인","prompts":["네, 그 순서로 진행해 주세요.","아니요, B안으로 가 주세요."]}]}
JSON
\`\`\`
- **질문이 없으면(단순 완료·일상 대화) 호출하지 마라.** 질문 카드는 "사용자 답이 필요할 때만" 뜨는 게 목적이다.
- 자연어 본문에 같은 질문·제안 답을 목록으로 다시 나열하지 마라 — 그건 이 카드가 보여준다. 본문은 짧은 맥락만.
- 이 신고는 **표시 전용** — 실제 작업/판정 로직과 무관하다.
- 토큰 헤더(\`x-vibisual-hook-token\`)가 없으면 401 이다. 위 예시에 이미 포함돼 있다.`;
}

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

/** 간결에서 AI 본문(text)을 자르는 줄 수 — 초과분은 [더 보기]. 화면의 마지막 본문은 예외(자르지 않음). */
export const STREAM_COMPACT_TEXT_CLAMP_LINES = 4;

/**
 * 간결에서 AI 본문을 자르는 글자 수 — 줄 수와 **둘 다** 본다.
 * 마크다운 문단은 줄바꿈 없이 한 줄로 길게 오는 일이 잦아, 줄 수만 보면 클램프가 통째로 헛돈다.
 */
export const STREAM_COMPACT_TEXT_CLAMP_CHARS = 420;

/** 간결에서 번호 목록 카드가 보여주는 항목 수 — 나머지는 `+N` 한 줄. */
export const STREAM_COMPACT_LIST_PREVIEW = 3;

/** 간결에서 접힌 카드/본문 요약 한 줄의 최대 글자 수(넘으면 말줄임). */
export const STREAM_COMPACT_SUMMARY_CHARS = 90;

/**
 * §4 v2.70 — 커스텀/스폰 에이전트에게 주입할 "검수 요청" 지시문 (시스템 프롬프트 꼬리표).
 *
 * 작업 신고(`buildAgentReportRules`)·질문 카드(`buildAgentQuestionRules`)와 동일 인프라(토큰 인증 loopback)이지만
 * **성격이 다르다**: 사용자가 **지시한 작업**(특히 버그 수정·기능 변경)을 끝낸 뒤, 사용자가 직접 해야 할 일
 * (`userActions`)이 아니라 **결과가 맞는지 확인(검수)**해 달라고 요청하는 카드. IDE 가 보라색 검수 카드로 렌더.
 * Hook 에이전트는 spawn/rules 통제 밖이라 이 지시문이 안 들어가 호출하지 않는다.
 */
export function buildAgentReviewRules(args: {
  serverBase: string;
  serverToken: string;
  agentId: string;
  subAgentId?: string;
  /** v2.71 — 있으면 curl 이 호출 시점에 이 파일에서 live 포트·토큰을 읽는다(없으면 serverBase/serverToken 상수). */
  identityFile?: string;
}): string {
  const { serverBase, serverToken, agentId, subAgentId, identityFile } = args;
  const subField = subAgentId ? `"${subAgentId}"` : 'null';
  const prelude = buildDynamicEndpointPrelude(identityFile, serverBase, serverToken);
  const base = prelude ? '$VIBI_BASE' : serverBase;
  const tokenHdr = prelude ? `-H "x-vibisual-hook-token: $VIBI_TOKEN"` : `-H 'x-vibisual-hook-token: ${serverToken}'`;
  return `

# 검수 요청 (Vibisual IDE 검수 카드)
사용자가 **지시한 작업**(특히 "이 버튼 오류 고쳐라" 같은 버그 수정·기능 변경)을 끝내, 사용자가 **결과가 맞는지 확인(검수)**해야 의미가 있는 완료 보고에서만 아래 엔드포인트로 **검수 요청**을 함께 보낸다. Vibisual IDE 가 이를 **보라색 검수 카드**로 띄워, 사용자가 "무슨 동작을 어떻게 고쳤는지 + 무엇을 확인하면 되는지"를 한눈에 보게 한다.

작업 신고(\`/api/agent-report\` 의 \`userActions\`)와 **성격이 다르다**: 작업 신고의 \`userActions\` 는 "AI 가 못 하니 **네가 직접 해**"(빌드 실행·에디터 조작·외부 승인)인 반면, 검수 요청은 **AI 가 이미 완료한 작업의 결과를 사용자가 확인**하는 것이다.

**한 턴에 카드는 하나 — 작업 신고와 검수 요청 중 하나만 보내라(둘 다 ❌).** 사용자가 직접 손대야 할 일이 있으면 **작업 신고**(그 안에 고친 내용도 \`did\` 로 담는다), 직접 할 일 없이 결과 확인만 필요하면 **검수 요청**. 두 장이 함께 뜨면 사용자가 읽을 게 두 배로 늘고 무엇이 중요한지 묻힌다.

- \`instruction\`: 어떤 지시였는지 한 줄 맥락 (선택, 예: "이 버튼 클릭 시 X 오류 고쳐라").
- \`changes\`: 무슨 동작을 어떻게 고쳤는지 (1~N). **이게 비면 검수 요청 자체를 보내지 마라.**
- \`checkpoints\`: 사용자가 확인할 검수 포인트·방법 (0~N, 예: "그 버튼을 다시 눌러 정상 동작 확인").

**단순 완료·일상 대화·질문 답변·조사 보고에서는 호출하지 마라.** 사용자가 지시→완료→검수가 필요한 흐름일 때만 보낸다. **고칠 것을 다 고친 뒤**, 검수 요청이 있는 완료 보고에서만 — ${CARD_PUBLISH_ORDER_RULE}
\`\`\`bash
${prelude}curl -s -X POST "${base}/api/agent-review" \\
  ${tokenHdr} \\
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"agentId":"${agentId}","subAgentId":${subField},"instruction":"받은 지시 한 줄","changes":["무슨 동작을 이렇게 고쳤다 1","고친 내용 2"],"checkpoints":["사용자가 확인할 검수 포인트 1"]}
JSON
\`\`\`
- **\`changes\` 가 비어 있으면 검수 요청 자체를 보내지 마라** — 빈 신고는 카드만 늘려 신호를 묻는다.
- **검수 요청으로 보낸 내용(\`instruction\`/\`changes\`/\`checkpoints\`)을 자연어 보고 본문에 목록·헤딩으로 다시 나열하지 마라.** 그 목록은 이 카드가 보여준다 — 본문에 또 풀어 쓰면 사용자가 같은 내용을 두 번 읽게 돼 취지가 무너진다. **검수 요청을 보낼 때 자연어 본문은 1~2문장 결론으로 최소화**하고, 한 일·검수 포인트의 목록 자체는 카드(changes/checkpoints)에만 담는다.
- 이 신고는 **표시 전용** — 실제 작업/판정 로직과 무관하며, 보내든 안 보내든 결과엔 영향이 없다.
- 토큰 헤더(\`x-vibisual-hook-token\`)가 없으면 401 이다. 위 예시에 이미 포함돼 있다.`;
}

/** agentId 당 보관하는 번호 목록 정렬 카드 최대 개수 (ring buffer 캡, 초과 시 오래된 것부터 제거). */
export const AGENT_LISTS_MAX_PER_AGENT = 50;

/**
 * §4 v2.84 — 커스텀/스폰 에이전트에게 주입할 "번호 목록 정렬 카드" 지시문 (시스템 프롬프트 꼬리표).
 *
 * 작업 신고·질문·검수 카드와 동일 인프라(토큰 인증 loopback). 에이전트가 답변에 **여러 항목의
 * 번호/순서 목록**을 담을 때, 본문 텍스트로 길게 나열하지 말고 `POST /api/agent-list` 로 items 배열을
 * 보내면 IDE 가 번호를 자동으로 매겨 가지런히 정렬된 카드로 렌더한다. 번호 매김은 IDE 가 하므로
 * 에이전트는 항목 텍스트만 보낸다. Hook 에이전트는 spawn/rules 통제 밖이라 이 지시문이 안 들어간다.
 */
export function buildAgentListRules(args: {
  serverBase: string;
  serverToken: string;
  agentId: string;
  subAgentId?: string;
  /** v2.71 — 있으면 curl 이 호출 시점에 이 파일에서 live 포트·토큰을 읽는다(없으면 serverBase/serverToken 상수). */
  identityFile?: string;
}): string {
  const { serverBase, serverToken, agentId, subAgentId, identityFile } = args;
  const subField = subAgentId ? `"${subAgentId}"` : 'null';
  const prelude = buildDynamicEndpointPrelude(identityFile, serverBase, serverToken);
  const base = prelude ? '$VIBI_BASE' : serverBase;
  const tokenHdr = prelude ? `-H "x-vibisual-hook-token: $VIBI_TOKEN"` : `-H 'x-vibisual-hook-token: ${serverToken}'`;
  return `

# 번호 목록 카드 (Vibisual IDE 정렬 카드)
답변에 **여러 항목의 번호/순서 목록**(나열, 체크리스트, 단계 목록 등)을 담을 때는, 그 목록을 본문 텍스트로 길게 나열하지 말고 아래 엔드포인트로 \`items\` 배열을 보낸다. Vibisual IDE 가 **번호를 자동으로 매겨** 가지런히 정렬된 카드로 보여준다(사용자가 한눈에 파악, 번호·줄바꿈 어긋남 없음).

- \`title\`: 목록 제목 / 머리말 (선택, 예: "플레이어에게 표시할 것 전부").
- \`items\`: 목록 항목들 (2개 이상). **번호는 IDE 가 매기니 항목 텍스트만** 넣어라("1." 같은 번호를 직접 붙이지 마라). **비거나 1개면 보내지 마라.**
- \`note\`: 맥락 한 줄 (선택).

**그 목록이 확정된 뒤**(= 더 조사·수정할 게 남지 않았을 때), 번호 목록이 있는 보고에서만 — ${CARD_PUBLISH_ORDER_RULE}
\`\`\`bash
${prelude}curl -s -X POST "${base}/api/agent-list" \\
  ${tokenHdr} \\
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"agentId":"${agentId}","subAgentId":${subField},"title":"플레이어에게 표시할 것","items":["크로스헤어 (중앙 점)","인벤토리 바 (3슬롯)","현장 위험도 FieldRisk"]}
JSON
\`\`\`
- **\`items\` 가 비거나 1개면 보내지 마라** — 카드만 늘려 신호를 묻는다.
- **같은 목록을 자연어 본문에 또 번호로 나열하지 마라** — 그 목록은 이 카드가 보여준다. 본문은 짧은 맥락만.
- 이 신고는 **표시 전용** — 실제 작업/판정 로직과 무관하며, 보내든 안 보내든 결과엔 영향이 없다.
- 토큰 헤더(\`x-vibisual-hook-token\`)가 없으면 401 이다. 위 예시에 이미 포함돼 있다.`;
}

/**
 * §7.11 v2.29 — 커스텀/스폰 에이전트에게 주입할 "서버 iframe 신고" 지시문 (시스템 프롬프트 꼬리표).
 *
 * 작업 신고·질문·검수·목록 카드와 동일 인프라(토큰 인증 loopback)이지만 **표시 대상이 다르다**:
 * 에이전트가 사용자가 열어볼 서버(dev/정적/게임 프리뷰 등)를 띄웠을 때 그 URL 을 `POST /api/agent-iframe`
 * 로 신고하면, Vibisual 이 그 세션에 **iframe 위성 버블을 정확한 URL 로 직접 생성**한다(캔버스에서 클릭 →
 * 앱 안 프리뷰). 종전엔 서버를 명령어·로그에서 정규식으로 "추측"해 잡았는데, 위치 인자 포트·버퍼링된 배너 등
 * 새 기동 방식마다 놓쳤다(§7.11 v2.28). 신고는 URL 이 그대로 오므로 추측이 사라진다 — 이게 **주 경로**,
 * 정규식 감지는 외부(우리가 spawn 안 한 vscode 등) 세션용 폴백으로 남는다. Hook 에이전트는 spawn/rules
 * 통제 밖이라 이 지시문이 안 들어간다(하이브리드 경계).
 */
export function buildAgentIframeRules(args: {
  serverBase: string;
  serverToken: string;
  agentId: string;
  subAgentId?: string;
  /** v2.71 — 있으면 curl 이 호출 시점에 이 파일에서 live 포트·토큰을 읽는다(없으면 serverBase/serverToken 상수). */
  identityFile?: string;
}): string {
  const { serverBase, serverToken, agentId, subAgentId, identityFile } = args;
  const subField = subAgentId ? `"${subAgentId}"` : 'null';
  const prelude = buildDynamicEndpointPrelude(identityFile, serverBase, serverToken);
  const base = prelude ? '$VIBI_BASE' : serverBase;
  const tokenHdr = prelude ? `-H "x-vibisual-hook-token: $VIBI_TOKEN"` : `-H 'x-vibisual-hook-token: ${serverToken}'`;
  return `

# 서버 iframe 신고 (Vibisual IDE 프리뷰 버블)
**전제 — 사용자가 직접 "서버를 띄워라 / 프리뷰를 보여줘" 라고 요청했을 때만 이 신고를 한다.** 미리보기를 보여주려고 **네 판단으로 서버를 새로 기동하지 마라** — 사용자가 시키지도 않았는데 dev/정적 서버를 자발적으로 띄우는 것은 금지다(사용자가 "왜 안 시켰는데 서버가 켜졌냐"고 문제 삼은 바로 그 지점). 사용자가 **명시적으로 요청해서 띄운**(또는 작업상 반드시 실행해야 해서 이미 돌고 있는) **브라우저로 열어볼 로컬 서버**만, 그 URL 을 아래 엔드포인트로 **1회 신고**한다. Vibisual 이 그 URL 로 **iframe 프리뷰 버블**을 캔버스에 직접 띄워 사용자가 링크를 복사해 열 필요 없이 앱 안에서 바로 본다.

- \`url\`: 사용자가 열 **정확한 URL**(포트 + 경로 포함). 특정 페이지를 보여주려면 그 경로까지 넣어라(예: \`http://127.0.0.1:8777/index.html\`).

**서버가 실제로 응답하는 걸 확인한 뒤**(예: curl 로 200 확인) 신고하라 — 살아있는 서버만 버블이 뜬다. 같은 URL 을 다시 신고해도 **중복 버블은 안 생긴다**(같은 포트는 하나로 합쳐짐) — 안심하고 보내도 된다.
\`\`\`bash
${prelude}curl -s -X POST "${base}/api/agent-iframe" \\
  ${tokenHdr} \\
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"agentId":"${agentId}","subAgentId":${subField},"url":"http://127.0.0.1:8777/index.html"}
JSON
\`\`\`
- **사용자가 서버·프리뷰를 요청하지 않았으면 보내지 마라.** 일회성 명령·probe(curl/wget)·빌드, 그리고 요청 없이 네가 임의로 띄운 서버는 신고 대상이 아니다 — 사용자가 명시적으로 원한 실제 서버가 있을 때만.
- 신고 후 자연어 본문에서 "링크를 브라우저에서 여세요" 식 안내를 길게 반복하지 마라 — 버블이 그 역할을 한다. 짧은 맥락 한 줄이면 충분.
- 이 신고는 **표시 전용** — 실제 작업/판정 로직과 무관하며, 보내든 안 보내든 결과엔 영향이 없다.
- 토큰 헤더(\`x-vibisual-hook-token\`)가 없으면 401 이다. 위 예시에 이미 포함돼 있다.`;
}

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
  const { serverBase, serverToken, bubbleId, projectPath, identityFile } = args;
  const prelude = buildDynamicEndpointPrelude(identityFile, serverBase, serverToken);
  const base = prelude ? '$VIBI_BASE' : serverBase;
  const tokenHdr = prelude ? `-H "x-vibisual-hook-token: $VIBI_TOKEN"` : `-H 'x-vibisual-hook-token: ${serverToken}'`;
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
${prelude}curl -s -X POST "${base}/api/play-recipe" \\
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

/** §5.5 #17-11 ⑫(c)(f) — 진행 파일·명령 파일 경로 입력 길이 상한(경로 한 줄). */
export const SESSION_LOOP_PATH_MAX = 260;

/** §5.5 #17-11 ⑫(a) — 누적 비용 상한(USD)의 상한. 이보다 큰 값은 사실상 무제한과 같다. */
export const SESSION_LOOP_MAX_COST_USD_LIMIT = 10_000;

/** §5.5 #17-11 ⑫(a) — 벽시계 상한의 상한(ms) — 7일. */
export const SESSION_LOOP_MAX_DURATION_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;

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
 * §5.5 #17-17 v4.46 — 목표를 향해 달리게 하는 주입 블록 + 진행률 신고 지시문.
 *
 * `processNextCommand` 가 **매 턴** 다시 조립하므로, 사용자가 작업 도중 목표를 고쳐도
 * 다음 턴부터 새 문장이 들어간다(재스폰·재시작 불필요 = "수시로 바꿔도 상관없다").
 * 커스텀/스폰 에이전트에만 주입된다(훅 에이전트는 우리가 spawn 하지 않아 경로 자체가 없다).
 * 목표가 없거나 `status !== 'active'` 면 호출자가 아예 붙이지 않는다.
 */
export function buildSessionGoalRules(args: {
  serverBase: string;
  serverToken: string;
  agentId: string;
  subAgentId: string;
  /** 최종 목표 한 문장. */
  goalText: string;
  /** 지금까지의 진행률 (0~100). 단계가 있으면 `done/전체` 파생값이다. */
  percent: number;
  /** §5.5 #17-17 v4.47 — 단계 체크리스트(있으면 그대로 보여주고, 이걸 갱신하게 시킨다). */
  steps?: { text: string; status: SessionGoalStepStatus }[];
  /** §5.5 #17-17 v4.50 — 목표 문장의 주인. `user` 면 에이전트가 문장을 건드리지 않게 못 박는다. */
  authoredBy?: 'session' | 'user';
  /** 마지막 진행 신고의 한 줄 근거 (있으면 "직전에 어디까지 왔는지"를 모델이 이어받는다). */
  note?: string;
  /** 목표 문장이 바뀐 횟수 — 바뀌었다는 사실 자체가 모델에게 신호다. */
  revision: number;
  /** v2.71 — 있으면 curl 이 호출 시점에 이 파일에서 live 포트·토큰을 읽는다. */
  identityFile?: string;
}): string {
  const { serverBase, serverToken, agentId, subAgentId, goalText, percent, steps, authoredBy, note, revision, identityFile } = args;
  const prelude = buildDynamicEndpointPrelude(identityFile, serverBase, serverToken);
  const base = prelude ? '$VIBI_BASE' : serverBase;
  const tokenHdr = prelude ? `-H "x-vibisual-hook-token: $VIBI_TOKEN"` : `-H 'x-vibisual-hook-token: ${serverToken}'`;
  const revLine = revision > 0
    ? `\n(이 목표는 지금까지 ${revision}번 수정됐다 — **위에 적힌 지금 문장만이 유효**하다. 예전 판본은 잊어라.)`
    : '';
  const noteLine = note ? `\n직전 진행 메모: ${note}` : '';
  const mark: Record<SessionGoalStepStatus, string> = { done: '[x]', in_progress: '[~]', pending: '[ ]' };
  const stepsBlock = steps && steps.length > 0
    ? `\n\n**지금 목록** (퍼센트는 여기서 나온다 — 끝낸 것만 \`done\`):\n${steps.map((s) => `- ${mark[s.status]} ${s.text}`).join('\n')}`
    : `\n\n**아직 목록이 없다 — 이 턴에 목록부터 세워라.** \`TodoWrite\` 가 도구 목록에 있으면 그것으로 계획을 세우면 되고(그게 곧 이 목록이 된다, 따로 신고 ❌), **없으면 아래 신고의 \`steps\` 로 직접 세워라.** 목록이 비어 있는 동안 사용자는 네가 무엇을 하려는지 화면에서 볼 수 없다.`;
  const authorLine = authoredBy === 'user'
    ? '\n(이 목표 문장은 **사용자가 직접 고친 것**이다 — 바꾸지 말고 그대로 따르라.)'
    : '';
  return `

# 이 세션의 목표 (Vibisual IDE 목표 창 — 네가 쓰는 진행 목록)
**목표**: ${goalText}${authorLine}${revLine}
**현재 진행률**: ${percent}%${noteLine}${stepsBlock}

이 목표 창은 **네가 지금 무엇을 향해 가는지**를 사용자에게 보여주는 자리다. 사용자가 채워 주는 칸이 아니라 **네가 쓰는 칸**이다 — 사용자는 이걸 보고 "이 세션이 이 일을 하고 있고, 여기까지 왔고, 다 되면 끝나는구나"를 파악한다.

**규칙은 두 줄이다: ① 지금 할 일을 이 목록에 넣는다. ② 하나 끝낼 때마다 그 항목을 \`done\` 으로 옮긴다**(화면에서 그 줄에 취소선이 그어지고 퍼센트가 오른다). 목록이 비어 있으면 사용자 화면에는 아무것도 안 뜬다 — 그건 이 세션이 무엇을 하는지 말하지 않는 것과 같다.

- **목록을 채우고 갱신하는 것은 네 일이다 — 비워 두지 마라.** \`TodoWrite\` 로 계획을 세우거나 갱신하면 그것이 그대로 이 체크리스트가 되고, 끝낸 항목을 \`completed\` 로 옮기는 순간 퍼센트가 오른다(별도 신고 ❌). **그 도구가 네 도구 목록에 없으면 아래 신고의 \`steps\` 로 같은 일을 하라** — 수단이 무엇이든 화면의 목록은 항상 지금 상태여야 한다.
- **사용자가 방금 보낸 명령이 목표보다 우선이다.** 목표는 방향이고 명령은 지금 할 일이다 — 둘이 어긋나면 명령을 따르고, 목표 쪽을 아래 신고로 고쳐 맞춰라.
- 위 목표 문장이 지금 하는 일과 다르면 **네가 고쳐라**(아래 \`goal\`). 사용자가 직접 고친 문장이라고 표시돼 있으면 건드리지 마라.

${steps && steps.length > 0
    ? `**목표·진행 신고** — 단계를 하나 끝냈거나(→ \`done\`), 목록 자체가 바뀌었거나, 목표 문장을 다듬을 때 Bash 로 1회 호출한다(실패해도 무시하고 보고는 그대로 진행):`
    : `**목표·진행 신고 — 이번 턴에 목록부터 세워라.** \`TodoWrite\` 를 쓸 수 있으면 그것으로 충분하고(자동 반영), 없으면 아래 호출의 \`steps\` 로 지금 할 일을 넣어라. 이후 하나 끝낼 때마다 같은 호출로 그 항목을 \`done\` 으로 옮긴다:`}
\`\`\`bash
${prelude}curl -s -X POST "${base}/api/session-goal/${agentId}/${subAgentId}/progress" \\
  ${tokenHdr} \\
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"goal":"로그인 화면을 테스트까지 붙여 끝낸다","steps":[{"text":"스키마 정의","status":"done"},{"text":"서버 배선","status":"in_progress"}],"note":"스키마 끝, 서버 배선 중"}
JSON
\`\`\`
- \`goal\`: 이 세션이 향하는 목표 한 문장(네가 정한다). 안 보내면 그대로 유지된다.
- \`steps\`: **목록 전체**를 통째로. 본문이 같은 단계는 화면에서 같은 항목으로 이어지니 본문은 되도록 그대로 두고 \`status\` 만 옮겨라. \`done\` 개수가 곧 퍼센트다 — **실제로 끝난 것만** \`done\` 으로.
- \`note\`: 지금 상황 한 줄. \`percent\`: 단계로 표현할 수 없을 때만 쓰는 대안(0~100, \`steps\` 를 보내면 무시).
- **바뀐 게 없으면 보내지 마라.** 마지막 단계까지 끝나면 100% 가 되고, 목표를 닫는 것은 사용자가 한다.
- 이 신고는 **표시 전용** — 실제 작업/판정 로직과 무관하다.
- 토큰 헤더(\`x-vibisual-hook-token\`)가 없으면 401 이다. 위 예시에 이미 포함돼 있다.`;
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
**아무 말도 하지 말고 그대로 끝내라.**`;
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

/** QR 에 담기는 딥링크 경로. `?t=<token>` 을 붙여 스캔 즉시 세션 쿠키를 받는다. */
export const MOBILE_QR_PATH = '/mobile/qr';

/** QR 딥링크의 토큰 쿼리 파라미터 이름. */
export const MOBILE_QR_PARAM = 't';

// ─── §5.10 Project Brain — 상수(§3.3 매직넘버 금지) ──────────────────────────

/** 세션 1건 리플렉션이 저장할 수 있는 카드 후보 상한(적게 저장 원칙). */
export const BRAIN_SESSION_CANDIDATE_MAX = 4;

/**
 * 스폰 브리핑에서 태스크 텍스트와 검색해 주입할 상위 카드 수(top-K).
 * v3.74 — 5 → 3 축소. 주 경로가 "주제 색인 + 필요할 때 읽기"로 바뀌었으므로 top-K 는
 * "색인을 보기도 전에 눈에 띄어야 할 만큼 태스크와 딱 맞는 것" 소수만 남기는 보조 수단이다.
 */
export const BRAIN_INJECTION_TOP_K = 3;

/**
 * 스폰 브리핑에 상시 싣는 **상시 규칙**(`always: true` rule) 상한. 초과분은 최근/참조순으로 절단.
 *
 * v3.74 — 종전 `BRAIN_RULE_CARD_MAX`(=20, **모든** rule 을 관련도 심사 없이 전량 주입)를 대체한다.
 * 규칙이 쌓일수록 무관한 카드가 선형으로 늘어 브리핑이 소음이 됐기 때문(실측: 사용량 작업 브리핑
 * 13장 중 상위 6장이 무관한 rule 전량). 주제성 규칙은 주제 문서로 내려가고, 여기 남는 것은
 * "Renderer HMR 없음"처럼 **어떤 작업에서도 해당하는** 소수뿐이라 상한도 작게 잡는다.
 */
export const BRAIN_ALWAYS_RULE_MAX = 6;

/**
 * §5.10 v3.74 — 프로젝트 층 주제 축. 카드를 "무엇에 관한 기억이냐"로 가른다.
 *
 * 스폰 브리핑은 이 목록으로 만든 **색인**(주제명 + whenToRead + 문서 경로)만 싣고, 에이전트는
 * 자기 작업에 해당하는 주제 문서만 그 시점에 읽는다 — CLAUDE.md 의 "작업 유형별 참조 파일" 표와
 * 같은 문법. `match` 는 카드 제목·본문·연결 파일 경로에 대해 'i' 플래그로 컴파일해 자동 분류에 쓴다.
 * 어디에도 안 걸리면 `BRAIN_TOPIC_MISC`.
 *
 * 주제 구성은 실측 분포(프로젝트 층 82장)에 맞춰 잡았다 — 캡처·원격조작 28 / UI 7 / 워크트리 6 /
 * statusLine 5 / Stop 5 / 실행·빌드 5 / 죽은코드 4 / 영속화 3 / 브레인 3 …
 *
 * **배열 순서 = 분류 우선순위**이므로 고유 토큰이 강한 주제(`statusline`·`worktree`·`checkpoint`)를
 * 앞에, 일반어가 섞인 주제(`build`·`ui`)를 뒤에 둔다. 일반어를 앞에 두면 다른 주제의 카드를
 * 가로챈다 — 실제로 초안에서 "statusLine 은 **렌더**마다 실행된다"가 UI 로, `packages/...` 로
 * 시작하는 **모든** 파일 경로가 `package` 패턴에 걸려 실행·빌드로 빨려 들어갔다(테스트가 잡음).
 */
export const BRAIN_TOPICS: readonly BrainTopicDef[] = [
  {
    slug: 'capture-remote',
    title: '화면 캡처 · 원격 조작',
    whenToRead: '화면 캡처 버블, 원격 마우스·키보드 주입, 커서 처리, DPI·모니터 좌표 변환, 터치/마우스 모드 작업',
    match: '캡처|capture|커서|cursor|주입|inject|dpi|모니터|monitor|터치|touch|드래그|drag|안티치트|크로미움|chromium|게임 창|배경 클릭|합성 입력|반향|loopback|스냅|snap|nut\\.js|koffi|setcapture|sendinput|마우스 모드|controlmode',
  },
  {
    slug: 'worktree-isolation',
    title: '워크트리 · 격리 인스턴스 · 병행 세션',
    whenToRead: 'git 워크트리 생성·병합, 서브에이전트 격리 실행, 여러 세션이 같은 파일을 동시에 만질 때',
    match: '워크트리|worktree|격리|isolat|병행 세션|동시 세션|인스턴스 충돌|eol|merge-file|브랜치|branch',
  },
  {
    slug: 'stop-subagent',
    title: 'Stop · 서브에이전트 · 명령 대기열',
    whenToRead: '에이전트 중지·재개, 서브에이전트 스폰·추적, 명령 큐 dispatch 작업',
    match: '\\bstop\\b|중지|대기열|queue|dispatch|subagent|서브에이전트|pendingsubagent|스폰|spawn|task 도구',
  },
  {
    slug: 'usage-statusline',
    title: '사용량 · statusLine · 비용',
    whenToRead: 'Claude 플랜 한도·사용량 표시, statusLine 수집기, 토큰·비용 계산 작업',
    match: 'statusline|rate.?limit|사용량|usage|플랜 한도|토큰 비용|비용 계산|단가|과금',
  },
  {
    slug: 'persistence-checkpoint',
    title: '영속화 · 체크포인트 · 앱 상태',
    whenToRead: '체크포인트 저장·복원, identity.json, app-state·project.json, 원자적 쓰기·손실 방지 작업',
    match: '체크포인트|checkpoint|영속|persist|identity\\.json|app-state|project\\.json|원자적|atomic|복원|restore|openprojects|손실 방지',
  },
  {
    slug: 'brain-memory',
    title: '기억 시스템(Project Brain) 자체',
    whenToRead: '기억 카드 저장·주입·랭킹, 리플렉션, 주제 색인, 두뇌 피드 UI 를 손볼 때',
    match: '기억 카드|브레인|brain|리플렉션|reflection|주제 색인|두뇌|memory card|helpfulcount|refcount',
  },
  {
    slug: 'dead-code-wiring',
    title: '죽은 코드 · 미배선 점검',
    whenToRead: '미사용 export 정리, 배선 안 된 엔드포인트·컴포넌트 점검, 코드 제거 판단',
    match: '죽은 코드|dead code|미배선|미사용|unused|export.*미사용|참조 0|배선 검증',
  },
  {
    slug: 'tooling-pitfalls',
    title: '도구 · 문법 함정',
    whenToRead: '정규식·셸 이스케이프·CLI 플래그·대용량 파일 읽기처럼 도구 자체의 함정을 만났을 때',
    match: '정규식|regex|이스케이프|escape|백슬래시|curl|json 페이로드|--disallowed-tools|offset/limit|cli 플래그|grep',
  },
  // ↓ 일반어가 섞인 주제는 뒤에 — 위 주제의 카드를 가로채지 않도록.
  //   `package` 는 `packages/...` 경로 전부를 삼켜서 뺐다(패키징은 `package.json`·`패키징`으로만 잡는다).
  {
    slug: 'runapp-build',
    title: '실행 · 빌드 · 데스크톱 번들',
    whenToRead: '/runapp 실행, pnpm build, electron 번들·패키징, dist 산출물, 개발 서버 유무가 걸린 작업',
    match: 'runapp|hmr|\\bdist\\b|빌드|\\bbuild\\b|renderer|electron|번들|bundle|패키징|packaging|package\\.json|electron-vite',
  },
  // `렌더` 단독은 statusLine·스트림 등 다른 주제 문장에도 흔해서 UI 고유 표현으로 좁힌다.
  {
    slug: 'ui-client',
    title: 'UI · 클라이언트 렌더링',
    whenToRead: '클라이언트 컴포넌트, React Flow 캔버스·좌표, 버튼 노출 조건, 빈 상태·오류 표시, 스토어 배선 작업',
    match: 'react flow|reactflow|리렌더|렌더링|rerender|버튼|button|ui 레이어|ui층|컴포넌트|component|좌표|배선|노출 조건|빈 상태|오버레이|overlay|배지|badge|캔버스|canvas|tailwind|zustand',
  },
] as const;

/** §5.10 v3.74 — 어느 주제 패턴에도 안 걸린 카드의 주제 slug. */
export const BRAIN_TOPIC_MISC = 'misc';

/** §5.10 v3.74 — `BRAIN_TOPIC_MISC` 주제의 표시명/안내(색인에도 나타난다). */
export const BRAIN_TOPIC_MISC_TITLE = '기타(미분류)';
export const BRAIN_TOPIC_MISC_WHEN_TO_READ = '위 주제 어디에도 속하지 않는 기록 — 찾는 게 없으면 여기와 능동 검색을 함께 보라';

/** 카드가 "묻힘 방지" 흐림 대상이 되는 미참조 기간(ms) — 60일. */
export const BRAIN_STALE_THRESHOLD_MS = 60 * 24 * 60 * 60 * 1000;

// v3.78 — `BRAIN_CLEANUP_CARD_COUNT_THRESHOLD`(=200, "이 수를 넘으면 두뇌 정리를 제안") 삭제.
//   선언만 있고 **소비처가 0**이라 정리 장치가 사실상 없었고 삭제가 100% 수동이었다. 지금은
//   아래 예산제(`BRAIN_TOPIC_CARD_BUDGET`·`BRAIN_PROJECT_CARD_BUDGET`·`BRAIN_AGENT_CARD_BUDGET`)가
//   제안 대신 **자동 보관**으로 총량을 묶는다(삭제 ❌ — "정리됨"에서 되돌릴 수 있다).

/**
 * 스폰 브리핑 주입 토큰 예산(대략치). 문자열 길이를 `chars/4 ≈ tokens` 휴리스틱으로 환산해
 * 이 값을 넘지 않도록 카드를 담는다(정확한 토크나이저 없이 근사 — 소량 코퍼스 전제).
 */
export const BRAIN_INJECTION_TOKEN_BUDGET = 2000;

/** agentId 당 보관하는 주입 이벤트(BrainInjectionEvent) 최대 개수(런타임 ring buffer 캡). */
export const BRAIN_INJECTIONS_MAX_PER_AGENT = 20;

/** 리플렉션을 돌릴 최소 세션 이벤트 수 — 이보다 적으면 건너뛴다(잡음 방지). */
export const BRAIN_REFLECTION_MIN_EVENTS = 8;

/**
 * 세션당 리플렉션 디바운스(ms) — 활동이 있을 때마다 리셋되므로 실질적으로 "세션 idle 판정 창"이다.
 *
 * §5.10 원문은 "**세션 종료/idle 전환 시**" 1회인데 트리거가 Stop 훅에 걸려 있고 Stop 은 세션 종료가
 * 아니라 **매 턴 종료**마다 온다. v3.54 실측(24h 7,254 스폰 / 피크 1,858회·시)에서 30초 창은 턴 간격보다
 * 길지 못해 사실상 무제한 발화였다 — idle 로 굳었다고 볼 수 있는 5분으로 올려 SSOT 의미를 회복한다.
 */
export const BRAIN_REFLECTION_DEBOUNCE_MS = 300_000;

/**
 * 리플렉션 **전역** 시간당 상한(슬라이딩 1시간 윈도우). 디바운스는 세션당이라 짧은 세션이 계속
 * 새로 생기는 자동 루프에서는 아무 제약이 못 된다(v3.54 실측: 세션 10,665개 중 10,537개가 2~3요청짜리).
 * 세션 수와 무관하게 전체 발화량을 묶는 마지막 방어선.
 */
export const BRAIN_REFLECTION_MAX_PER_HOUR = 12;

/** 동시에 떠 있을 수 있는 리플렉션 자식 프로세스 수. 초과분은 큐가 아니라 폐기(밀린 발화는 어차피 중복). */
export const BRAIN_REFLECTION_MAX_CONCURRENT = 1;

/**
 * 완료음 창 간 중복 재생 차단 창(ms).
 *
 * 완료음은 WS 를 듣는 창마다 재생되는데(메인·별창·오버레이 셸이 각각 구독) 같은 완료 하나에
 * 소리가 겹쳐 두세 번 울리는 것처럼 들린다. 먼저 울린 창이 localStorage 에 시각을 남겨 이 창
 * 안의 다른 창은 건너뛴다(저장소 접근이 막히면 종전대로 재생 — fail-open).
 */
export const COMPLETION_CHIME_DEDUPE_MS = 1_500;

/**
 * 리플렉션 자식(`claude -p`) 전용 cwd 의 폴더명(`os.tmpdir()` 하위).
 *
 * 폴더명이 곧 **"이 훅 이벤트는 우리가 띄운 자식이 낸 것"** 이라는 판정 근거이므로 상수로 고정한다
 * (v3.76 — 서버가 자기 자식의 훅을 자기 입력으로 되먹던 자가 증식 차단, `isBrainReflectionCwd`).
 */
export const BRAIN_REFLECTION_CWD_DIRNAME = 'vibisual-reflect';

/**
 * 같은 세션을 다시 리플렉션하려면 직전 리플렉션 이후 이만큼의 새 JSONL 라인이 쌓여야 한다.
 * 없으면 매번 겹치는 tail 을 다시 태워 같은 입력에 같은 답을 반복한다.
 */
export const BRAIN_REFLECTION_MIN_NEW_LINES = 40;

/** 연속으로 카드 0장을 반환한 횟수가 이 값에 닿으면 그 프로젝트 루트에 지수 백오프를 건다. */
export const BRAIN_REFLECTION_EMPTY_STREAK_THRESHOLD = 3;

/** 수확 0 백오프 상한(ms). 연속 빈 결과가 계속돼도 이 이상은 안 늘어난다. */
export const BRAIN_REFLECTION_BACKOFF_MAX_MS = 4 * 60 * 60 * 1000;

/** 다이제스트에 담을 메시지 1건당 본문 최대 문자 수(assistant/user 텍스트). */
export const BRAIN_REFLECTION_TEXT_MAX_CHARS = 1_200;

/** 다이제스트에 담을 도구 결과 1건당 최대 문자 수. 정상 결과는 더 짧게, 에러는 이 값까지 남긴다. */
export const BRAIN_REFLECTION_TOOL_RESULT_MAX_CHARS = 240;

/**
 * 리플렉션 스폰이 쓸 **대체 시스템 프롬프트**(`--system-prompt`). 기본 Claude Code 시스템 프롬프트 +
 * 도구 정의는 v3.54 실측에서 스폰당 약 25.7k 토큰을 차지했는데, 리플렉션은 텍스트만 읽고 JSON 을
 * 뱉는 작업이라 그 전부가 낭비다. 도구는 `--disallowed-tools '*'` 로 함께 걷어낸다.
 */
export const BRAIN_REFLECTION_SYSTEM_PROMPT =
  '너는 텍스트 분석기다. 주어진 지시와 입력만 보고 요청된 형식으로만 답한다. '
  + '인사·설명·사과·마크다운 코드펜스를 붙이지 않고, 어떤 도구도 사용하지 않는다.';

/**
 * 리플렉션 스폰에서 걷어낼 도구 목록(공백 구분 — CLI `--disallowed-tools <tools...>`).
 *
 * **글로브 `'*'` 는 쓰지 않는다.** v3.54 실측에서 `'*'` 는 도구 정의를 컨텍스트에서 빼주지 못했고
 * (총 입력 22,894 토큰), 아래처럼 이름을 전부 나열했을 때만 실제로 빠졌다(총 입력 **8,209 토큰**).
 * 새 내장 도구가 추가되면 여기에도 더해야 절감이 유지된다.
 */
export const BRAIN_REFLECTION_DISALLOWED_TOOLS = [
  'Task', 'Agent', 'Bash', 'BashOutput', 'KillShell',
  'Glob', 'Grep', 'Read', 'Edit', 'Write', 'NotebookEdit',
  'WebFetch', 'WebSearch', 'TodoWrite', 'SlashCommand',
  'ExitPlanMode', 'AskUserQuestion', 'Skill',
  'ListMcpResources', 'ReadMcpResource',
].join(' ');

/** 참조 카운트(refCount/lastReferencedAt) 디스크 flush 디바운스(ms). 주입 폭주 시 파일 쓰기 완화. */
export const BRAIN_REF_FLUSH_MS = 5_000;

/** 파일 접근 경고를 세션+파일 조합당 1회만 낼지 여부(도배 방지). */
export const BRAIN_FILE_WARN_ONCE_PER_SESSION = true;

/** 능동 검색(`/api/brain/search`) 이 돌려주는 최대 결과 수. */
export const BRAIN_SEARCH_MAX_RESULTS = 8;

/**
 * 리플렉션 입력으로 넣을 세션 **다이제스트** tail 최대 문자 수(과금·지연 방어).
 *
 * v3.54 에서 의미가 바뀌었다 — 예전엔 원시 JSONL 24,000자였고 그 대부분이 base64 signature·도구
 * 페이로드라 실제 대화는 얼마 안 됐다. 지금은 `buildDigest` 가 대화만 추린 뒤라 같은 문자 수가
 * 훨씬 조밀하다(= 토큰도 그만큼 더 나간다). 정보량은 유지하면서 비용을 낮추려면 상한을 함께
 * 내려야 해서 8,000자로 잡는다 — 세션 끝 수십 턴이면 카드 0~4장 추출엔 충분하다.
 */
export const BRAIN_REFLECTION_INPUT_MAX_CHARS = 8_000;

/**
 * 저장 전 **동일** 판정 Jaccard 토큰 겹침 문턱 — 이 이상이면 새 카드를 만들지 않는다.
 *
 * v3.78 에서 의미가 바뀌었다. 종전에는 "기존 카드 본문에 `— 갱신(날짜):` 를 append" 였는데, 그
 * append 가 본문을 불려 Jaccard 분모를 키우는 바람에 **다음번엔 같은 지식이 문턱을 못 넘고 새
 * 카드로 분기**했다(자주 배우는 주제일수록 중복이 늘어나는 자기모순). 지금은 append 없이
 * **참조 시각만 갱신**하고 끝낸다 — 카드는 한 번 쓰이면 불변이다.
 */
export const BRAIN_DEDUP_JACCARD_THRESHOLD = 0.55;

// ─── §5.10 v3.78 수명주기 재설계 — 유효기간·앵커·예산 상수 ──────────────────────────

/**
 * **모순** 판정의 토큰 겹침 하한. 이 이상 겹치면서 부정 극성이 뒤집혔으면 "같은 대상에 대한 반대
 * 지시"로 보고 옛 카드를 닫는다. 동일 문턱(0.55)보다 낮게 잡는 이유 — "A 를 써라"와 "A 를 쓰지
 * 마라"는 부정어 몇 개만큼 토큰이 어긋나 동일 문턱에는 못 미치면서도 분명한 모순이다.
 */
export const BRAIN_CONTRADICT_JACCARD_MIN = 0.32;

/** 저장 시 동일/보완/모순 3분류를 돌릴 상위 후보 수(같은 층·에이전트 안에서 겹침 상위). */
export const BRAIN_SUPERSEDE_CANDIDATE_MAX = 3;

/**
 * **부정 극성** 감지 패턴. 두 카드 중 한쪽에만 걸리면 "극성이 뒤집혔다"로 본다.
 * 자연어 부정(한/영) + 우리 문서 관례의 금지 기호(`❌`)까지 포함한다. 'i' 플래그로 컴파일.
 *
 * 한국어 금지형은 어간이 매번 달라(붙이**지 마**라 / 하**지 마**라 / 쓰**지 마**라) 어간마다 적을 수
 * 없으므로 `…지 마…` 를 일반형으로 잡되, **뒤에 한글이 더 붙으면 제외**한다(`(?![가-힣])`) —
 * 그러지 않으면 "이미**지 마**스크" 같은 평범한 명사가 부정으로 잡힌다.
 */
export const BRAIN_NEGATION_PATTERN =
  '(❌|금지|지\\s*(?:마라|말\\s*것|마세요|마십시오|말라|마)(?![가-힣])|하지\\s*않|안\\s*된다|안된다|없다|불가|폐기|제거|삭제|중단|대신|아니라|아님|deprecat|forbid|never|don\'t|do not|must not|no longer|instead of|avoid|remove)';

/** 앵커에 저장하는 파일 내용 해시 길이(sha256 hex 앞 N 자). 충돌 위험 없이 frontmatter 를 짧게 유지. */
export const BRAIN_ANCHOR_SHA_LEN = 16;

/** 앵커를 박기 위해 읽는 파일의 최대 크기(byte). 이보다 크면 해시를 생략한다(핫패스 보호). */
export const BRAIN_ANCHOR_MAX_FILE_BYTES = 2 * 1024 * 1024;

/** `staleMemoryIds` 낡음 신고가 이 횟수 누적되면 카드를 자동 **보관**(파일 삭제 ❌). */
export const BRAIN_STALE_REPORT_ARCHIVE_MIN = 2;

/** 주제 1개(층별)가 보유할 수 있는 열린 카드 정원. 넘치면 하위부터 보관으로 강등. */
export const BRAIN_TOPIC_CARD_BUDGET = 24;

/** 프로젝트 층 전체 열린 카드 총량 상한. */
export const BRAIN_PROJECT_CARD_BUDGET = 300;

/** 커스텀 에이전트 1개의 열린 카드 총량 상한. */
export const BRAIN_AGENT_CARD_BUDGET = 60;

/** 주제 문서에 **펼쳐서** 싣는 핵심 카드 수. 나머지는 `<details>` 로 접는다(문서가 40장씩 붓지 않게). */
export const BRAIN_TOPIC_DOC_CORE_N = 12;

/** 보관 카드가 이동하는 하위 디렉터리명(`.vibisual/brain/archive/…`). 파일은 지우지 않는다. */
export const BRAIN_ARCHIVE_DIRNAME = 'archive';

/** "정리됨" 되돌림 목록이 한 번에 돌려주는 최대 카드 수(최근 보관순). */
export const BRAIN_ARCHIVE_LIST_MAX = 100;

/** 리플렉션 프롬프트에 실어 보내는 **기존 카드 제목** 최대 개수(제목만이라 토큰이 싸다). */
export const BRAIN_REFLECTION_KNOWN_TITLE_MAX = 24;

/** 예산 강등 후보를 고를 때 "장기 미참조"로 보는 기간(ms) — 30일. */
export const BRAIN_DEMOTE_UNREFERENCED_MS = 30 * 24 * 60 * 60 * 1000;

// ─── §5.10 v3.81 저장고↔SSOT 이원화 — 지식 종류 · 진실 주소 · dry-run 감사 ───

/**
 * §5.10 v3.81-D — **권위 서열.** 값이 클수록 강하다. `BRAIN_AUTHORITY_VERIFIABLE_MIN` 미만은
 * `verified` 로 승격하는 경로 자체가 없다(요건 9 — 출처 없는 AI 추론은 자동으로 진실이 되지 않는다).
 */
export const BRAIN_AUTHORITY_RANK: Readonly<Record<BrainAuthority, number>> = {
  'user-explicit': 5,
  'repository-source': 4,
  'tool-result': 3,
  'approved-doc': 2,
  'session-summary': 1,
  'ai-inference': 0,
};

/** §5.10 v3.81-D — 이 랭크 이상이어야 `verified` 가 될 수 있다(= `approved-doc` 이상). */
export const BRAIN_AUTHORITY_VERIFIABLE_MIN = 2;

/**
 * §5.10 v3.81-D — **사용자 명시 승인으로만 verified 가 되는 카드 종류.**
 * 결정·규칙은 코드와 대조해서 참·거짓을 가릴 수 있는 물건이 아니라 **정책**이므로, 출처가 온전해도
 * 자동 승격 대상이 아니다(§1.6 "결정과 정책: 사용자의 명시적 승인").
 */
export const BRAIN_POLICY_TYPES: readonly BrainCardType[] = ['decision', 'rule'] as const;

/** §5.10 v3.81-F — 카드에 남기는 최근 관찰 건수(전체 횟수는 `observedCount` 가 따로 센다). */
export const BRAIN_OBSERVATION_KEEP = 10;

/** §5.10 v3.81-E — `appliesTo` 에서 쓰는 축 이름(정렬 기준이자 허용 목록). */
export const BRAIN_SCOPE_AXES: readonly string[] = [
  'agent', 'branch', 'component', 'environment', 'platform', 'project', 'version',
] as const;

/**
 * §5.10 v3.81-H — **Canonical Knowledge 후보가 될 수 있는 카드 종류.**
 * 나머지(`mistake`·`lesson`)는 경험/증거 계층이라 그 자체로 현재 진실이 아니며 기본 브리핑에서 빠진다
 * (주제 문서·파일 접근 경고·검색으로는 그대로 읽힌다). 현재 규칙으로 쓰려면 `rule` 로 승격해야 한다.
 */
export const BRAIN_CANONICAL_TYPES: readonly BrainCardType[] = ['fact', 'rule', 'decision'] as const;

/** §5.10 v3.81-H — 경험/증거 계층(그 자체로 현재 진실 ❌). `BRAIN_CANONICAL_TYPES` 의 여집합. */
export const BRAIN_EXPERIENCE_TYPES: readonly BrainCardType[] = ['mistake', 'lesson'] as const;

/**
 * §5.10 v3.81-E — **`canonicalKey` 의 허용 area(첫 마디) 관리 목록.**
 * 목록 밖 area 는 거부가 아니라 `needs-taxonomy` 로 검토 큐에 올린다 — AI 가 임의 분류를 무한 증식하는
 * 것만 막고 저장 자체를 막지는 않는다(§3.3 하드코딩 금지 — 목록은 여기 한 곳에서만 산다).
 */
export const BRAIN_CANONICAL_AREAS: readonly string[] = [
  'project', 'build', 'architecture', 'client', 'server', 'shared', 'desktop',
  'ops', 'testing', 'security', 'workflow', 'user-preference',
] as const;

/**
 * §5.10 v3.81 — **`canonicalKey` 의 subject 마디를 뽑아도 되는 파일**(패키지 소스 모듈만).
 *
 * 실측에서 드러난 함정: 첫 연결 파일을 무조건 subject 로 쓰면 `docs/SCENARIO.md` → `scenario`,
 * `scripts/reinstall.mjs` → `reinstall` 처럼 **카드 내용과 무관한 키**가 나온다(그 파일은 지식의
 * *주제*가 아니라 *증거*이거나 그냥 함께 언급된 문서일 뿐이다). 게다가 같은 `scenario` 가 area 만
 * 달리해 `client.scenario`·`server.scenario`·`workflow.scenario` 로 갈라져 슬롯을 오염시켰다.
 * 그래서 **패키지 소스 모듈**로 좁힌다 — 문서·스크립트·설정에서는 주제를 유추하지 않는다.
 */
export const BRAIN_KEY_SUBJECT_FILE_PATTERN = '(^|/)packages/[^/]+/src/.*\\.(ts|tsx)$';

/**
 * §5.10 v3.81-E — 본문에 **적용 범위 축**(branch/environment/platform/version)이 언급된 카드를 찾는 패턴.
 * 걸리면 "이 지식은 전역이 아니라 조건부일 수 있다" → dry-run 이 `needsScopeSplit` 으로 보고한다.
 */
export const BRAIN_SCOPE_SPLIT_PATTERN =
  '워크트리|worktree|브랜치|branch|windows|win32|macos|리눅스|linux|프로덕션|production|개발 서버|dev 서버|\\bci\\b|설치본|패키징된|v[0-9]+\\.[0-9]+';

/**
 * §5.10 v3.81 — dry-run 감사 보고서의 목록당 상한(카드가 수천 장이 돼도 응답이 폭발하지 않게).
 * 잘린 경우 보고서의 `counts` 가 전체 수를 그대로 알려주므로 정보는 잃지 않는다.
 */
export const BRAIN_MIGRATION_LIST_MAX = 200;

/**
 * §5.10 v3.81 — **중복 후보 판정에 쓰는 제목 문자 bigram 문턱.**
 * 실측(184장 전수): 현행 "동일" 판정 문턱인 본문 토큰 Jaccard 0.55 는 한국어 카드에서 전 쌍 미달이라
 * 중복을 하나도 못 잡았다. 제목 bigram 으로 바꿔 문턱을 재면 **0.40·0.45 는 결과가 같고(쌍 3개 =
 * 실제 중복 2묶음), 0.50 은 같은 진실 3장 중 한 장을 놓친다**(`/runapp …` 계열의 1↔2 가 0.474).
 * 오탐은 사람이 한 번 훑으면 끝이지만 미탐은 중복을 영구화하므로 **0.45** 로 잡는다.
 */
export const BRAIN_MIGRATION_DUP_TITLE_MIN = 0.45;

// ─── §5.10 v3.49 유튜브식 랭킹/피드 상수 ──────────────────────────

/** 피드 오버레이 각 섹션(related/recent/frequent/resurface)이 표시하는 카드 상한. */
export const BRAIN_FEED_SECTION_SIZE = 8;

/**
 * 랭킹 가중치 4종(합 = 1.0). score = W_RELEVANCE·관련도 + W_HELPFUL·도움률 + W_FRESHNESS·신선도 + W_PINNED·pinned.
 * 컨텍스트 관련도(현재 태스크·파일 매칭)를 주신호로, 도움률·신선도로 보정, pinned 는 소폭 부스트.
 */
export const BRAIN_RANK_W_RELEVANCE = 0.45;
export const BRAIN_RANK_W_HELPFUL = 0.3;
export const BRAIN_RANK_W_FRESHNESS = 0.2;
export const BRAIN_RANK_W_PINNED = 0.05;

/**
 * 도움률 Laplace 스무딩 계수 — helpfulRate = (helpfulCount + α) / (refCount + β).
 * 노출 적은 카드가 우연히 100% 도움률로 튀는 것을 막고, 미노출 카드는 α/β 의 낮은 사전확률에서 출발.
 */
export const BRAIN_HELPFUL_SMOOTH_ALPHA = 1;
export const BRAIN_HELPFUL_SMOOTH_BETA = 4;

/** 신선도 반감기(ms) — 14일. freshness = 2^(-(now - max(updatedAt, lastHelpfulAt))/HALF_LIFE). */
export const BRAIN_FRESHNESS_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

/** 노출 임계 — 이 이상 노출(refCount)됐는데 helpfulCount 가 0 이면 강등 계수를 곱한다(stale 침전). */
export const BRAIN_DEMOTE_IMPRESSION_MIN = 8;

/** 위 임계 초과 + helpful 0 카드에 곱하는 강등 계수(0~1). */
export const BRAIN_DEMOTE_FACTOR = 0.5;

/** 재노출("오랜만에 다시 볼 기억") 후보 최소 미참조 기간(ms) — 21일. 이보다 오래 미참조면 후보. */
export const BRAIN_RESURFACE_MIN_AGE_MS = 21 * 24 * 60 * 60 * 1000;

/**
 * §5.10 v3.74 — 주제 색인 블록 조립. 스폰 브리핑에서 **카드를 밀어넣는 대신** 이 색인을 싣는다.
 *
 * 각 줄 = `주제명 — 언제 읽나 (N장) · 경로`. 에이전트는 자기 작업과 whenToRead 를 대조해
 * **해당 주제 문서만 그 시점에 Read** 한다 — CLAUDE.md 의 "작업 유형별 참조 파일" 표와 같은 문법.
 * 카드가 하나도 없는 주제는 호출부에서 걸러 넣는다(빈 문서로 안내하면 헛읽기가 된다).
 */
export function buildBrainTopicIndexSection(args: {
  project: BrainTopicIndexEntry[];
  /** v3.75 — 그 에이전트 자신의 주제 색인(자기 카드도 전량 주입 ❌). */
  agent?: BrainTopicIndexEntry[];
}): string {
  const line = (e: BrainTopicIndexEntry): string =>
    `- **${e.title}** (${e.cardCount}장) — ${e.whenToRead}\n  경로: \`${e.docPath}\``;
  const blocks: string[] = [];
  if (args.project.length > 0) {
    blocks.push(`### 프로젝트 기억\n${args.project.map(line).join('\n')}`);
  }
  if (args.agent && args.agent.length > 0) {
    blocks.push(`### 너 자신이 쌓은 기억\n${args.agent.map(line).join('\n')}`);
  }
  if (blocks.length === 0) return '';
  return `
## 주제별 기억 색인 — 필요한 것만 읽어라
기억은 **주제 문서**로 모여 있다. 아래에서 **지금 하는 작업에 해당하는 주제만** 골라 그 경로의 파일을
Read 해라(해당 없으면 아무것도 읽지 마라 — 무관한 기억을 읽는 것은 방해가 된다). 파일이 원본이므로
Read 로 바로 열면 되고, 특정 단어로 찾고 싶으면 아래 능동 검색을 쓰면 된다.

${blocks.join('\n\n')}`;
}

/**
 * §5.10 주입(읽기) — 커스텀/스폰 에이전트에게 주입할 "능동 검색" 지시문 + 브리핑 기억 블록.
 *
 * `cardsBlock` = 서버가 조립한 **상시 규칙 + 태스크 top-K + 자기 카드** 요약(본문 없이 title·요지).
 * `topicIndexBlock`(v3.74) = 프로젝트 층 주제 색인 — 프로젝트 카드를 전량 밀어넣던 자리를 대신한다.
 * 에이전트는 필요 시 loopback `GET /api/brain/search?q=...` 로 두 층 합산 검색을 직접 할 수 있다
 * (토큰 인증 — 작업 신고와 동일 인프라). Hook 에이전트는 spawn 통제 밖이라 이 블록이 안 들어간다.
 */
export function buildBrainRulesSection(args: {
  serverBase: string;
  serverToken: string;
  cardsBlock: string;
  topicIndexBlock?: string;
  identityFile?: string;
}): string {
  const { serverBase, serverToken, cardsBlock, topicIndexBlock, identityFile } = args;
  const prelude = buildDynamicEndpointPrelude(identityFile, serverBase, serverToken);
  const base = prelude ? '$VIBI_BASE' : serverBase;
  const tokenHdr = prelude
    ? `-H "x-vibisual-hook-token: $VIBI_TOKEN"`
    : `-H 'x-vibisual-hook-token: ${serverToken}'`;
  const memory = cardsBlock.trim()
    ? `

## 이 프로젝트의 기억(Project Brain)
아래는 **어떤 작업에서도 지켜야 하는 상시 규칙 + 이번 작업과 직접 관련된 것 + 너 자신이 쌓은 경험**이다.
**같은 실수를 반복하지 말고**, 규칙은 지켜라. (프로젝트의 나머지 기억은 아래 주제 색인으로 찾아 읽어라.)

⚠ 뒤에 \`[확인 필요 — <파일> 이 그 뒤 N회 수정됨]\` 이 붙은 카드는 **기록된 뒤 그 파일이 실제로 바뀌었다**.
버리지 말고 **지금 코드와 대조**한 다음, 여전히 맞으면 작업 신고의 \`helpfulMemoryIds\` 에, 틀렸으면
\`staleMemoryIds\` 에 그 id 를 넣어라 — 그 1비트가 다음 사람이 낡은 기억에 속지 않게 한다.

${cardsBlock.trim()}`
    : '';
  const topics = topicIndexBlock?.trim() ? `\n${topicIndexBlock.trim()}\n` : '';
  return `

# Project Brain (§5.10 장기 기억)${memory}
${topics}

## 능동 검색
작업 중 과거 결정·함정·규칙이 궁금하면 아래로 프로젝트 기억을 직접 검색할 수 있다(프로젝트+너 자신의 두 층 합산, 결과에 출처 층 표시). 실패해도 무시하고 작업은 계속한다.
\`\`\`bash
${prelude}curl -s ${tokenHdr} "${base}/api/brain/search?q=검색어"
\`\`\`
- 이 검색은 표시/참고 전용이며, 호출 여부는 작업 결과에 영향을 주지 않는다.
- 토큰 헤더(\`x-vibisual-hook-token\`)가 없으면 401 이다(위 예시에 포함).`;
}

/**
 * §5.10 리플렉션 프롬프트 — 세션 종료/idle 시 CLI(haiku) 로 그 세션 기록에서 기억 카드 후보를 추출.
 * **추출 트리거 4조건에 걸리는 것만** 후보로 삼고, 없으면 빈 배열. 파괴적 자가 수정 없음(저장은 서버가 중복 검사 경유).
 */
export const BRAIN_REFLECTION_PROMPT = `너는 아래 AI 코딩 세션 기록에서 **다음 세션에 도움이 될 장기 기억 카드**를 추출하는 분석기다.

다음 4가지 트리거에 **명확히 걸리는 것만** 카드로 뽑아라(억지로 만들지 마라 — 없으면 빈 배열):
1. 같은 실수를 반복한 흔적 (mistake)
2. 무언가를 시도했다가 되돌린 것 (lesson)
3. 사용자가 같은 교정을 다시 입력한 것 (lesson/rule)
4. 다음 세션에도 필요한 결정 (decision/fact)

규칙:
- 확실한 것만. 애매하거나 그 세션 한정인 것은 버려라.
- 각 카드: type(decision|mistake|lesson|rule|fact), title(한 줄 요지), body(왜/무엇을/어떻게, 2~5문장), files(관련 파일 경로 배열, 없으면 []).
- 최대 ${BRAIN_SESSION_CANDIDATE_MAX}개.
- 출력은 **순수 JSON 배열만**(설명·마크다운·코드펜스 금지). 없으면 \`[]\`.

출력 형식 예:
[{"type":"lesson","title":"X 는 Y 로 처리해야 함","body":"...","files":["packages/server/src/foo.ts"]}]

세션 기록:
`;

/**
 * §5.10 v3.78 — **관문을 추출 시점으로 옮긴 리플렉션 프롬프트 빌더.**
 *
 * 종전에는 세션 다이제스트만 줘서 모델이 "이건 이미 아는 것"을 판단할 수단이 아예 없었고, 그래서
 * 중복 방어가 **사후 Jaccard 하나**에 몰려 있었다(그리고 그 Jaccard 는 append 로 스스로 무력해졌다).
 * 여기서는 그 층의 **기존 카드 제목 목록을 id 와 함께** 실어 보낸다 — 제목만이라 토큰이 싸고,
 * 모델은 ① 이미 아는 것은 아예 안 뽑고 ② 뒤집는 지식이면 `contradicts` 로 대상 카드를 지목한다.
 *
 * `knownTitles` 가 비면 그 블록을 통째로 생략한다(빈 목록을 보여주면 잡음만 된다).
 */
export function buildBrainReflectionPrompt(args: {
  /** 기존 카드 `[id] 제목` 목록(상한은 호출부에서 `BRAIN_REFLECTION_KNOWN_TITLE_MAX` 로 자른다). */
  knownTitles: string[];
  /** 이 층에서 고를 수 있는 주제 slug 목록(프로젝트/에이전트 공통 — 두 층 모두 주제 축을 쓴다). */
  topicSlugs: readonly string[];
  /** §5.10 v3.81 — `canonicalKey` 의 허용 area 목록(없으면 프롬프트에 예시만 나간다). */
  areas?: readonly string[];
}): string {
  const known = args.knownTitles.length > 0
    ? `

## 이미 저장된 기억(제목만) — 여기 있는 것은 다시 뽑지 마라
${args.knownTitles.map((t) => `- ${t}`).join('\n')}

- 위 목록과 **같은 이야기**면 카드를 만들지 마라(중복이 기억을 망친다).
- 위 목록 중 어떤 것을 **뒤집는**(이제는 반대로 해야 하는) 지식이라면, 새 카드를 하나 만들고
  \`contradicts\` 에 그 카드의 id(\`card-…\`)를 정확히 적어라 — 옛 카드는 시스템이 닫는다.
- 뒤집는 게 아니라 **덧붙이는** 지식이면 \`contradicts\` 를 비워 둬라.`
    : '';
  const topics = args.topicSlugs.length > 0
    ? `\n- topic: 다음 중 하나를 골라 넣어라(모르겠으면 생략) — ${args.topicSlugs.join(', ')}`
    : '';
  return `너는 아래 AI 코딩 세션 기록에서 **다음 세션에 도움이 될 장기 기억 카드**를 추출하는 분석기다.

다음 4가지 트리거에 **명확히 걸리는 것만** 카드로 뽑아라(억지로 만들지 마라 — 없으면 빈 배열):
1. 같은 실수를 반복한 흔적 (mistake)
2. 무언가를 시도했다가 되돌린 것 (lesson)
3. 사용자가 같은 교정을 다시 입력한 것 (lesson/rule)
4. 다음 세션에도 필요한 결정 (decision/fact)
${known}

규칙:
- 확실한 것만. 애매하거나 그 세션 한정인 것은 버려라.
- 각 카드: type(decision|mistake|lesson|rule|fact), title(한 줄 요지), body(왜/무엇을/어떻게, 2~5문장), files(관련 파일 경로 배열, 없으면 []), contradicts(뒤집는 기존 카드 id, 없으면 생략).${topics}
- **canonicalKey(선택)**: 그 카드가 \`fact\`·\`rule\`·\`decision\` 이고 **"이 프로젝트에서 지금 참인 하나의 값"** 을 말한다면, 안정적인 주소를 \`<area>.<subject>[.<aspect>]\` 형식으로 붙여라(area 는 ${(args.areas ?? []).join(' / ') || 'client / server / build / workflow'} 중 하나, 예 \`build.package-manager\`). 같은 주소에는 현재 진실이 하나만 존재하므로, **같은 주소의 값이 바뀐 것이라면 value 를 새 값으로 적어라**(옛 카드는 시스템이 처리한다).
- **value(선택)**: canonicalKey 가 있고 값이 짧은 단어·경로·이름이면 그 값만 적어라(예 \`pnpm\`).
- 경험담(mistake/lesson)에는 canonicalKey 를 붙이지 마라 — 그건 증거이지 현재 규칙이 아니다.
- **files 를 최대한 채워라** — 그 지식이 매인 파일 경로가 있어야 코드가 바뀔 때 시스템이 이 카드를 "확인 필요"로 띄울 수 있다. 파일과 무관한 습관·취향이면 비워도 된다.
- 최대 ${BRAIN_SESSION_CANDIDATE_MAX}개.
- 출력은 **순수 JSON 배열만**(설명·마크다운·코드펜스 금지). 없으면 \`[]\`.

출력 형식 예:
[{"type":"lesson","title":"X 는 Y 로 처리해야 함","body":"...","files":["packages/server/src/foo.ts"],"topic":"misc","contradicts":"card-abc-1234"},
 {"type":"fact","title":"이 프로젝트의 패키지 매니저는 pnpm 이다","body":"...","files":["package.json"],"canonicalKey":"build.package-manager","value":"pnpm"}]

세션 기록:
`;
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

/** §5.19 (E) — 한 저장소에서 보여 줄 GGUF 파일(양자화) 상한. */
export const LOCAL_MODEL_FILE_LIMIT = 40;

/** §5.19 — 엔진·모델이 놓이는 폴더 이름(홈의 `.vibisual` 아래). */
export const LOCAL_ENGINE_DIR_NAME = 'engine';
export const LOCAL_MODEL_DIR_NAME = 'models';

/**
 * §5.19 (D) — 로컬 대화의 기본 컨텍스트 길이(토큰).
 * 엔진 기본값(4K 급)을 그대로 쓰면 도구를 물리거나 대화가 조금만 길어져도 즉시 막힌다.
 */
export const LOCAL_DEFAULT_CONTEXT_SIZE = 16384;

/** §5.19 (D) — 한 턴에 만들 토큰 상한. 로컬은 느려서 상한이 없으면 사람이 하염없이 기다린다. */
export const LOCAL_DEFAULT_MAX_TOKENS = 4096;

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
  };
  if (raw.kind !== 'local-llama') return undefined;
  const provider: AgentProvider = {
    kind: 'local-llama',
    modelId: typeof raw.modelId === 'string' ? raw.modelId.trim() : '',
  };
  const modelName = typeof raw.modelName === 'string' ? raw.modelName.trim() : '';
  if (modelName) provider.modelName = modelName;
  if (typeof raw.contextSize === 'number' && raw.contextSize > 0) provider.contextSize = raw.contextSize;
  if (typeof raw.temperature === 'number') provider.temperature = raw.temperature;
  return provider;
}

/**
 * §5.19 (B) — 아직 모델을 안 문 All Model 버블의 기본 라벨 모양(`All Model 3`).
 * 모델을 매는 순간 라벨이 이 모양이면 **모델명이 그 자리를 잇는다** — 사용자가 직접 바꾼
 * 이름은 이 모양이 아니므로 자연히 보존된다(이름을 지키려고 별도 플래그를 두지 않는다).
 */
export const ALL_MODEL_DEFAULT_LABEL_RE = /^All Model \d+$/;

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
  days: readonly { date: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreateTokens: number; costUsd: number }[],
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
  days: readonly { date: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreateTokens: number; costUsd: number }[],
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
export const AUDIT_RISK_KINDS: readonly AuditRiskKind[] = ['delete', 'network', 'config'] as const;

/** 프로젝트당 원장 상한(키 개수 캡 — §9). 밀려난 줄의 몫은 `retired` 합계로 접힌다. */
export const AUDIT_ENTRIES_MAX_PER_PROJECT = 500;

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
 * 스위치가 없을 때의 기본 — **꺼짐**이다(§5.22).
 *
 * 묻는 쪽이 더 안전해 보이지만 이 경계가 되무르는 것은 **사용자가 직접 고른 권한 모드**다.
 * `bypassPermissions` 를 고른 사람에게 기본값으로 승인 카드를 띄우면 그가 고른 모드가
 * 설명 없이 무효가 되고, 그 카드는 원인을 알 수 없는 팝업으로만 보인다. 되무를지는
 * **사용자가 켜서** 정하고, 꺼져 있는 동안에도 기록은 계속된다(기록을 끄는 스위치는 없다).
 *
 * 종류별 `kinds` 는 켬 그대로 둔다 — 전체를 켠 사용자가 셋을 다시 켜야 하는 일은 만들지 않는다.
 *
 * **기본값은 이 상수 하나에서만 읽는다**: 서버 fallback·체크포인트 "저장할 것 없음" 판정·
 * 클라 두 화면이 저마다 기본을 하드코딩하면, 켠 적 없는 프로젝트가 화면마다 다른 상태로 보인다.
 */
export const DEFAULT_AUDIT_BOUNDARY: AuditBoundaryConfig = {
  escalateRisky: false,
  kinds: { delete: true, network: true, config: true },
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

/**
 * §5.22 — 위험 판정. 빈 배열이면 평범한 호출이다.
 * 서버(사전 승인)와 클라(배지)가 **같은 이 함수**를 쓴다.
 */
export function classifyToolRisk(
  toolName: string,
  toolInput?: Record<string, unknown> | null,
): AuditRiskKind[] {
  const input = toolInput ?? {};
  const command = typeof input['command'] === 'string' ? input['command'] : '';
  const url = auditFirstString(input, ['url', 'endpoint']);
  const filePath = auditFirstString(input, ['file_path', 'notebook_path', 'path', 'target_file']);
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

  return AUDIT_RISK_KINDS.filter((k) => found.has(k));
}

/**
 * §5.22 — 원장 한 줄이 보여 줄 요약과 대상. 도구 입력 전문을 담지 않기 위한 접기다.
 */
export function summarizeToolCall(
  toolName: string,
  toolInput?: Record<string, unknown> | null,
): { summary: string; target?: string } {
  const input = toolInput ?? {};
  const command = typeof input['command'] === 'string' ? input['command'] : '';
  const url = auditFirstString(input, ['url', 'endpoint']);
  const filePath = auditFirstString(input, ['file_path', 'notebook_path', 'path', 'target_file']);

  if (command) {
    const urls = command.match(AUDIT_URL_PATTERN);
    const target = urls?.[0] ?? filePath;
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
