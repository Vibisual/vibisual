import type { BubbleType, BubbleStyleConfig, EdgeStyleConfig, AgentRole, PipelineChildConfig, PipelineType, AgentConfig, AgentPreset, TaskEdgeTemplate, TaskEdgeKind, UiLocale, AutoAgentRole, AutoAgentTopology, AutoAgentTemplate, AutoAgentTopologyPreset, ModelPricing, ModelFamily, KnownModelFamily, ModelRegistry, ModelRegistryEntry } from './types.js';
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
/** iframe 버블 크기 (네모, 고정) */
export const IFRAME_BUBBLE_WIDTH = 140;
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
/** 에이전트 완료 요약 최대 길이 (자) */
export const MAX_SUMMARY_LENGTH = 500;
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

/** 자동 idle 전환 판정 주기 (ms) */
export const AGENT_IDLE_SWEEP_INTERVAL_MS = 30_000;

/**
 * 세션이 "활성"으로 간주되는 JSONL mtime 임계값 (ms).
 * JSONL 파일이 이 시간 내에 쓰여졌으면 사용 중으로 판정.
 * Windows에서 파일 락 테스트가 불가능하므로 mtime이 최선의 활성 신호.
 */
export const SESSION_ACTIVE_WINDOW_MS = 30 * 60 * 1000;

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

/** 체크포인트 갱신 주기 (액션 수) */
export const CHECKPOINT_INTERVAL = 500;
/** 물리 엔진 위치 자동 저장 주기 (ms) */
export const POSITION_SAVE_INTERVAL = 30_000;

/**
 * §3.2.1 v2.62 — 영속 파일(checkpoint.json / identity.json) 다세대 백업 보관 수.
 * 저장 직전 기존 파일을 `<file>.bak1 → .bak2 → ... → .bak<N>` 로 회전 보관한다.
 * 논리적 실수(빈/급감 저장)·사용자 실수를 N 세대 전까지 수동 복구 가능.
 */
export const CHECKPOINT_BACKUP_GENERATIONS = 3;

/**
 * §3.2.1-3 v2.63 — 명시 삭제 커스텀 에이전트 묘비(deletedCustomAgents) 최대 보관 수.
 * 묘비는 "이미 삭제된 sessionId 의 부활 차단" 신호. sessionId 가 전역 유니크(시간+카운터)라
 * 절대 재생성되지 않아 안전하게 prune 할 길이 없으므로, 단조 증가를 막는 상한만 둔다.
 * 한도 초과 시 가장 오래된 묘비부터 버린다(최근 삭제분이 부활 차단에 더 중요).
 */
export const DELETED_AGENT_TOMBSTONE_MAX = 1000;

// ─── 버블 렌더링 ───

/** 텍스트 라벨 최대 너비 = size * TEXT_WIDTH_RATIO */
export const BUBBLE_TEXT_WIDTH_RATIO = 0.7;
/** 아이콘/라벨 간 gap이 0이 되는 작은 버블 크기 기준 (px) */
export const BUBBLE_SMALL_THRESHOLD = 60;
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
];

/** §5.3 #12-2 v2.26 — AskUserQuestion 요청 타임아웃 (60s, permissionBroker 와 동일 윈도우) */
export const ASK_USER_QUESTION_TIMEOUT_MS = 60_000;

/** §4 v2.43 — 옵션창 Version 탭: 설치본 하나당 `--version` probe 타임아웃 (정상 응답 수십 ms) */
export const CLAUDE_VERSION_PROBE_TIMEOUT_MS = 2_500;

/** §4 v2.43 — 옵션창 Version 탭: 다중 설치본 스캔 시 probe 할 최대 후보 수 (폭주 가드) */
export const CLAUDE_INSTALL_SCAN_MAX = 24;

/** v1.36 — STRICT delegation enforcement 경로(dispatch curl)가 Bash 에 의존하므로
 *  사용자가 UI 에서 제거할 수 없고, STRICT strip 계산에서도 항상 보존된다.
 *  서버 PUT /api/agent-config/:id 가 payload.tools 에서 빠져 있으면 자동 포함, UI 는 × 잠금. */
export const LOCKED_AGENT_TOOLS: readonly string[] = ['Bash'];

/** 선택 가능한 퍼미션 모드 */
export const AVAILABLE_PERMISSION_MODES: readonly string[] = [
  'default', 'acceptEdits', 'plan', 'bypassPermissions',
];

/** 선택 가능한 격리 모드 */
export const AVAILABLE_ISOLATION_MODES: readonly string[] = [
  'none', 'worktree',
];

/**
 * 선택 가능한 사고 깊이 (effort) — Opus 4.8+ (2026-05~)
 *
 * §4 v1.49 — Opus 4.7 신규 등급 `xhigh` 추가.
 * §4 v2.48 — Opus 4.8 은 low/medium/high/xhigh/max 5등급을 모두 별개로 지원(공식 문서 2026-05).
 *   v1.49 에서 빠졌던 `'max'`(토큰 제약 없는 최대 추론, per-spawn 세션 단위)를 최상단으로 재도입.
 * 서버는 string 패스스루이므로 SDK/CLI 가 인식하는 신규 값을 즉시 사용 가능.
 * ⚠️ 클라 하드코딩 `EFFORT_VALUES`(AgentConfigPopup / OptionsWindow)와 값이 일치해야 한다 — 드리프트 주의.
 */
export const AVAILABLE_EFFORT_LEVELS: readonly string[] = [
  'default', 'low', 'medium', 'high', 'xhigh', 'max',
];

/** 선택 가능한 메모리 모드 */
export const AVAILABLE_MEMORY_MODES: readonly string[] = [
  'none', 'project', 'user',
];

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

/** §5.3 #28 v1.60 — 카탈로그 키 union type. 코드에서 stamp 이름 비교 시 사용. */
export type StampName = keyof typeof STAMP_CATALOG;

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

/**
 * §4 v1.53 — 에이전트 프리셋 카탈로그.
 * Claude Code 본체의 `subagent_type`(Explore/Plan/code-reviewer/general-purpose) 를 미러링.
 * AgentConfigPopup 상단 드롭다운에서 선택 시 폼에 즉시 적용되고, 사용자가 이후 자유 편집 가능.
 *
 * 적용된 결과는 평범한 `AgentConfig` — 별도 런타임 분기 ❌. `presetId` 는 트레이스용 메타만.
 * `tools` 에 `'Bash'` 포함 여부는 v1.36 LOCKED_AGENT_TOOLS 규칙(서버 PUT 가 자동 보존)으로 강제.
 */
export const AGENT_PRESETS: readonly AgentPreset[] = [
  {
    id: 'explore',
    config: {
      model: 'sonnet',
      tools: ['Read', 'Grep', 'Glob', 'Bash'],
      permissionMode: 'default',
      effort: 'default',
      rules:
        '# Role: Explore\n\n' +
        '- 빠르게 코드를 탐색해서 위치·구조·관련 파일을 찾는 read-only 에이전트.\n' +
        '- 파일을 수정하지 마라(Write/Edit 도구 없음). Bash 는 검색·라우팅 보조용으로만.\n' +
        '- 결과는 파일 경로 + 라인 번호 + 1-2 문장 요약으로.',
    },
  },
  {
    id: 'plan',
    config: {
      model: 'sonnet',
      tools: ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'Bash'],
      permissionMode: 'plan',
      effort: 'default',
      rules:
        '# Role: Plan\n\n' +
        '- 구현 전략·트레이드오프·중요 파일을 정리하는 설계 에이전트.\n' +
        '- 코드를 수정하지 말고 단계별 계획만 산출. plan 모드라 ExitPlanMode 까지 가는 흐름.\n' +
        '- 산출물 = "변경 대상 파일 / 변경 요지 / 위험 / 검증 방법" 4 섹션.',
    },
  },
  {
    id: 'code-reviewer',
    config: {
      model: 'sonnet',
      tools: ['Read', 'Grep', 'Glob', 'Bash'],
      permissionMode: 'default',
      effort: 'high',
      rules:
        '# Role: Code Reviewer\n\n' +
        '- 보안·성능·코드 품질을 다각도로 리뷰하는 read-only 에이전트.\n' +
        '- 파일을 수정하지 마라. 발견한 이슈는 file:line 형식 + 1-2 문장 근거 + 권장 수정.\n' +
        '- "이건 잘했다"도 같이 적어라 — 회고용.',
    },
  },
  {
    id: 'general-purpose',
    config: {
      model: 'sonnet',
      tools: [...AVAILABLE_AGENT_TOOLS],
      permissionMode: 'default',
      effort: 'default',
      rules: undefined,
    },
  },
];

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

/**
 * 토폴로지 프리셋 카탈로그 — 어떤 role 들을 어떻게 엣지로 연결할지.
 * 새 토폴로지 추가 시 여기 한 항목 + `AutoAgentTopology` 유니온 한 줄 + `selectTopology` 분기 한 줄.
 *
 * `offsetAngleDeg`: auto-agent 버블 기준 각도(도, 0=오른쪽, 시계 반대 — 표준 수학 각도).
 *   원형 배치를 위해 노드 수에 따라 균등 분포.
 * `entry`: 정확히 1개의 노드만 true. 사용자 메시지 forward 대상.
 */
export const AUTO_AGENT_TOPOLOGY_PRESETS: Record<Exclude<AutoAgentTopology, 'custom'>, AutoAgentTopologyPreset> = {
  pipeline: {
    topology: 'pipeline',
    label: 'Pipeline',
    description: 'Linear chain: planner → coder → reviewer. Each stage passes artifact to next.',
    nodes: [
      { role: 'planner', offsetAngleDeg: 150, entry: true },
      { role: 'coder', offsetAngleDeg: 30 },
      { role: 'reviewer', offsetAngleDeg: 270 },
    ],
    edges: [
      { from: 'planner', to: 'coder', kind: 'artifact', returnFormat: 'artifact' },
      { from: 'coder', to: 'reviewer', kind: 'artifact', returnFormat: 'summary' },
    ],
  },
  team: {
    topology: 'team',
    label: 'Team (PM hub + workers)',
    description: 'PM routes user request to architect/coder/tester, collects via reviewer, summarizes back.',
    nodes: [
      { role: 'pm', offsetAngleDeg: 90, entry: true },
      { role: 'architect', offsetAngleDeg: 180 },
      { role: 'coder', offsetAngleDeg: 30 },
      { role: 'tester', offsetAngleDeg: 330 },
      { role: 'reviewer', offsetAngleDeg: 270 },
    ],
    edges: [
      { from: 'pm', to: 'architect', kind: 'command', commandMode: 'shared', returnFormat: 'summary' },
      { from: 'pm', to: 'coder', kind: 'command', commandMode: 'shared', returnFormat: 'both' },
      { from: 'pm', to: 'tester', kind: 'command', commandMode: 'shared', returnFormat: 'summary' },
      { from: 'coder', to: 'reviewer', kind: 'artifact', returnFormat: 'summary' },
      { from: 'tester', to: 'reviewer', kind: 'artifact', returnFormat: 'summary' },
      { from: 'reviewer', to: 'pm', kind: 'artifact', returnFormat: 'summary' },
    ],
  },
  ralph: {
    topology: 'ralph',
    label: 'Ralph (Team + critique loop)',
    description: 'Team topology + reviewer can reject (force-rework) coder via critique edge. Up to 5 cycles.',
    nodes: [
      { role: 'pm', offsetAngleDeg: 90, entry: true },
      { role: 'architect', offsetAngleDeg: 180 },
      { role: 'coder', offsetAngleDeg: 30 },
      { role: 'tester', offsetAngleDeg: 330 },
      { role: 'reviewer', offsetAngleDeg: 270 },
    ],
    edges: [
      { from: 'pm', to: 'architect', kind: 'command', commandMode: 'shared', returnFormat: 'summary' },
      { from: 'pm', to: 'coder', kind: 'command', commandMode: 'shared', returnFormat: 'both' },
      { from: 'pm', to: 'tester', kind: 'command', commandMode: 'shared', returnFormat: 'summary' },
      { from: 'coder', to: 'reviewer', kind: 'artifact', returnFormat: 'summary' },
      { from: 'tester', to: 'reviewer', kind: 'artifact', returnFormat: 'summary' },
      { from: 'reviewer', to: 'pm', kind: 'artifact', returnFormat: 'summary' },
      // critique primary — 서버가 force-rework 면 자매 auto-rework command 엣지 자동 생성
      { from: 'reviewer', to: 'coder', kind: 'critique', critiqueAuthority: 'force-rework' },
    ],
  },
  autopilot: {
    topology: 'autopilot',
    label: 'Autopilot (single super agent)',
    description: 'A single general-purpose agent that handles everything end-to-end.',
    nodes: [
      { role: 'coder', offsetAngleDeg: 0, entry: true },
    ],
    edges: [],
  },
};

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

- \`did\`: 네가(=AI) 실제로 끝낸 일(사용자 액션의 맥락으로 함께 첨부).
- \`userActions\`: 네가 대신 할 수 없어 **사용자가 직접 해야 하는 일**(빌드 실행, 에디터 조작, 외부 승인 등). **이게 비면 신고 자체를 보내지 마라.**
- \`nextSteps\`: 다음 차례 작업(선택).

\`userActions\` 가 있는 완료 보고 직전에만 Bash 로 1회 호출한다(실패해도 무시하고 자연어 보고는 그대로 진행):
\`\`\`bash
${prelude}curl -s -X POST "${base}/api/agent-report" \\
  ${tokenHdr} \\
  -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"agentId":"${agentId}","subAgentId":${subField},"did":["완료한 일 1","완료한 일 2"],"userActions":["사용자가 직접 해야 할 일 1"],"nextSteps":["다음 단계 1"]}
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

질문이 있는 보고 직전에만 Bash 로 1회 호출한다(실패해도 무시하고 자연어 보고는 그대로 진행):
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

작업 신고(\`/api/agent-report\` 의 \`userActions\`)와 **성격이 다르다**: 작업 신고의 \`userActions\` 는 "AI 가 못 하니 **네가 직접 해**"(빌드 실행·에디터 조작·외부 승인)인 반면, 검수 요청은 **AI 가 이미 완료한 작업의 결과를 사용자가 확인**하는 것이다. 사용자가 직접 손대야 할 일이 있으면 작업 신고를, 완료한 작업의 검수만 필요하면 검수 요청을 보낸다(둘 다 해당하면 둘 다 보내도 된다).

- \`instruction\`: 어떤 지시였는지 한 줄 맥락 (선택, 예: "이 버튼 클릭 시 X 오류 고쳐라").
- \`changes\`: 무슨 동작을 어떻게 고쳤는지 (1~N). **이게 비면 검수 요청 자체를 보내지 마라.**
- \`checkpoints\`: 사용자가 확인할 검수 포인트·방법 (0~N, 예: "그 버튼을 다시 눌러 정상 동작 확인").

**단순 완료·일상 대화·질문 답변·조사 보고에서는 호출하지 마라.** 사용자가 지시→완료→검수가 필요한 흐름일 때만 보낸다. 검수 요청이 있는 완료 보고 직전에만 Bash 로 1회 호출한다(실패해도 무시하고 자연어 보고는 그대로 진행):
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

/**
 * §4 v2.76 — CMD(인터랙티브 터미널) 에이전트 카드 신고용 **터미널 한 줄 마커**.
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
 * §4 v2.76 — CMD 에이전트에게 주입할 "카드 신고(터미널 한 줄)" 프로토콜 지시문.
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
**터미널 stdout 에 \`${S}\` 로 시작하는 한 줄을 인쇄**하면 된다(예: Bash 도구로 \`echo\`). 그 줄을 IDE 가 캡처해
색 카드로 재작성한다 — curl·포트·토큰·agentId 가 필요 없다(IDE 가 문맥에서 자동으로 채운다). **반드시 JSON 은
한 줄**(개행 없이)이어야 하고, 마커 뒤에 곧바로 \`{\` 가 와야 한다.

세 종류 모두 \`kind\` 로 구분한다(발생 조건은 아래를 지켜라 — 매번 보내면 카드가 도배돼 신호가 묻힌다):

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

공통: **단순 완료·일상 대화·조사 답변 등 사용자 손이 필요 없는 보고에선 인쇄하지 마라.** 이 신고는 표시 전용이라
보내든 안 보내든 실제 작업 결과엔 영향이 없다. 카드에 담은 목록을 자연어 본문에 헤딩·목록으로 다시 풀어 쓰지 마라.`;
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
