import type { ClaudeUsageLimit } from './types.js';
import type { UsageLimitStop } from './usageLimitStop.js';

/**
 * §4 API 크레딧 — 구독이 막히면 Console 크레딧으로 잇는다. 월 크레딧은 조직 API 키로 띄운 `claude -p` 에만 쓰인다(공식 `api-credits-for-subscribers`) — 헤드리스 버블이 대상.
 * 앱은 금액을 세지도 막지도 않는다 — 지출은 공식 `cost_report`, 한도·잔액은 Anthropic 의 거절을 따른다(공개 API 없음 — 2026-10-27 확인).
 * 판정만 한다(파일·네트워크·프로세스 ❌) — 서버 여러 자리가 같은 답을 내야 한다.
 */

/** 기본 = 구독을 먼저 다 쓰고 막히면 크레딧. 옵션 = 크레딧 먼저, Anthropic 이 거절하면 구독. */
export type ApiCreditMode = 'subscription-first' | 'credits-first';

export const API_CREDIT_MODES: readonly ApiCreditMode[] = ['subscription-first', 'credits-first'];

/** 사용자가 정하는 칸. 머신 단위라 AppState 에 산다(`retention` 과 같은 결). 금액 칸은 없다 — Console 이 정한다. */
export interface ApiCreditSettings {
  /** 크레딧 사용 스위치. 꺼져 있으면 실행 경로는 이 기능이 생기기 전과 같다. */
  enabled: boolean;
  mode: ApiCreditMode;
  /** 한도로 멈춘 헤드리스 명령을 다른 경로로 한 번 자동으로 잇는다. */
  autoContinue: boolean;
}

export const API_CREDIT_DEFAULTS: Readonly<ApiCreditSettings> = Object.freeze({
  enabled: false,
  mode: 'subscription-first',
  autoContinue: true,
});

/** 리셋 시각 없는 한도 통지를 믿는 최대 시간(5시간 = 세션 창 한 바퀴). 그 사이 더 새로운 `/usage` 가 100% 미만이면 풀린다. */
export const API_CREDIT_UNKNOWN_RESET_HOLD_MS = 5 * 60 * 60 * 1000;
/** 실행용 키 확인 — 공개 `GET /v1/models`(과금 없음). */
export const API_CREDIT_VERIFY_URL = 'https://api.anthropic.com/v1/models?limit=1';
export const API_CREDIT_ANTHROPIC_VERSION = '2023-06-01';
export const API_CREDIT_VERIFY_TIMEOUT_MS = 8_000;
/**
 * 자동 이어가기 지시. 모델이 읽는 문장이라 영어로 둔다(답하는 말은 세션 규칙을 따른다). 원래 명령을 다시
 * 보내지 않는다 — 같은 지시가 대화에 두 번 쌓이면 이미 한 일을 처음부터 다시 할 수 있다.
 */
export const API_CREDIT_CONTINUE_PROMPT =
  'Continue the previous task from exactly where it stopped. The last turn was cut off by a usage limit, '
  + 'not by you — do not restart or repeat work that is already done.';

// ─── Console 지출 읽기 — 공식 Usage and Cost API ──────────────────────────────

/**
 * 이번 달 지출의 출처 — `GET /v1/organizations/cost_report`. Console 비용(Cost) 화면과 같은 자료이고 일 단위·센트
 * 문자열이다. 관리자 키(`sk-ant-admin01-…`) 또는 워크스페이스에 묶이지 않은 개인·서비스 계정 키만 통한다.
 */
export const API_CREDIT_COST_REPORT_URL = 'https://api.anthropic.com/v1/organizations/cost_report';
/** 같은 키로 조직 이름을 읽는다 — 어느 조직의 숫자인지 화면이 말하게(`GET /v1/organizations/me`). */
export const API_CREDIT_ORG_URL = 'https://api.anthropic.com/v1/organizations/me';
/** 주기 갱신 간격. 자료는 보통 5분 안에 반영된다(공식 FAQ). */
export const API_CREDIT_CONSOLE_REFRESH_MS = 5 * 60 * 1000;
/** 페이지를 열 때의 갱신은 이보다 자주 하지 않는다 — 공식 권장 빈도가 "꾸준히 쓸 때 1분에 한 번"이다. */
export const API_CREDIT_CONSOLE_MIN_INTERVAL_MS = 60 * 1000;
/** [새로고침]을 연달아 눌러도 이보다 자주 묻지 않는다(짧은 몰림은 문서상 허용). */
export const API_CREDIT_CONSOLE_FORCE_MIN_MS = 5 * 1000;
/** 크레딧 실행이 끝나고 지출을 다시 읽는 지연 — 자료가 반영될 틈을 둔다. */
export const API_CREDIT_CONSOLE_AFTER_RUN_MS = 2 * 60 * 1000;
export const API_CREDIT_CONSOLE_TIMEOUT_MS = 10_000;
/** 한 달은 31 버킷 한 쪽에 들어간다. 다음 쪽이 와도 이만큼만 따라간다(무한 반복 방지). */
export const API_CREDIT_COST_REPORT_MAX_PAGES = 4;
/** 통합 앱임을 밝힌다 — 공식 문서가 연동 앱에 User-Agent 를 권한다. */
export const API_CREDIT_USER_AGENT = 'Vibisual (+https://github.com/Vibisual/vibisual)';

export type ApiCreditConsoleStatus = 'no-key' | 'pending' | 'ok' | 'error';
export type ApiCreditConsoleErrorKind = 'auth' | 'forbidden' | 'not-found' | 'rate-limited' | 'network' | 'unreadable' | 'other';

/** Console 이번 달 지출 — 서버가 읽어 온 값 그대로(메모리만 · 저장 ❌). */
export interface ApiCreditConsoleSpend {
  status: ApiCreditConsoleStatus;
  /** 지금 읽는 중인가(값은 그대로 두고 표시만 바꾼다). */
  refreshing: boolean;
  /** 이 값이 센 달 — UTC 달력 월 1일 00:00(Console 지출 한도가 초기화되는 달). */
  monthStart: number;
  /** 그 달의 지출 합(USD). 한 번이라도 읽었으면 있다 — 다음 읽기가 실패해도 마지막 값을 남긴다. */
  spendUsd?: number;
  /** `spendUsd` 를 읽은 시각. */
  fetchedAt?: number;
  /** 키가 가리키는 Console 조직 이름. */
  orgName?: string;
  /** 마지막 읽기가 실패했으면 그 사유(Anthropic 원문은 번역하지 않는다). */
  error?: { kind: ApiCreditConsoleErrorKind; status?: number; message?: string };
}

// ─── Anthropic 의 거절 — 앱 잠금 대신 ────────────────────────────────────────

/** Anthropic 이 크레딧 실행을 거절한 사유. 앱이 정한 한도가 아니라 Console 쪽 사실이다. */
export type ApiCreditBlockReason = 'balance-empty' | 'spend-limit' | 'key-invalid';

/**
 * Anthropic 이 크레딧 실행을 거절했다는 기억. 새 실행을 구독으로 돌리는 데만 쓴다. 문구에 재개 시각이 있으면 그때,
 * 없으면 사유마다 정한 때(`consoleBlockUntil`) 저절로 다시 크레딧을 시도한다 — 거절된 요청은 과금되지 않는다.
 */
export interface ApiCreditConsoleBlock {
  reason: ApiCreditBlockReason;
  at: number;
  /** 다시 크레딧을 시도할 때. 없으면(키 거부) 키를 바꾸거나 확인이 통과할 때까지다. */
  until?: number;
  /** Anthropic 원문 한 줄(번역 ❌). */
  detail?: string;
}

/** 잔액 부족은 재개 시각을 말해 주지 않는다 — 이만큼 뒤에 다시 시도한다(새 크레딧·충전을 따라잡는다). */
export const API_CREDIT_BALANCE_RECHECK_MS = 60 * 60 * 1000;

const BLOCK_REASONS: ReadonlySet<string> = new Set<ApiCreditBlockReason>(['balance-empty', 'spend-limit', 'key-invalid']);

/** 저장된 키 한 벌. 본문은 OS 보안 저장소로 암호화된 것(`os`) 또는 그것을 못 쓰는 환경의 원문(`plain`). */
export interface ApiCreditKeyRecord {
  scheme: 'os' | 'plain';
  data: string;
  /** 화면·로그에 쓰는 끝 4자리. */
  hint: string;
  savedAt: number;
  verified?: ApiCreditKeyVerdict;
  verifiedAt?: number;
}

export type ApiCreditKeyVerdict = 'ok' | 'rejected' | 'unknown';

/** AppState 에 그대로 앉는 모양. 옛 칸(`ledger`·`pending`·`capUsd`…)은 읽을 때 버린다. */
export interface ApiCreditPersisted {
  settings?: Partial<ApiCreditSettings>;
  /** 실행용 Console API 키. */
  key?: ApiCreditKeyRecord;
  /** 지출 읽기용 관리자 키(또는 워크스페이스에 묶이지 않은 개인 키). 모델을 돌리지 못한다. */
  adminKey?: ApiCreditKeyRecord;
  /** Anthropic 거절 기억 — 앱을 다시 켜도 같은 거절을 한 번 더 겪지 않게. */
  block?: ApiCreditConsoleBlock;
}

export type ApiCreditRoute = 'subscription' | 'credits';

/**
 * 왜 그 경로인가. 화면이 이 값으로 한 줄을 고른다(번역 키 `panel.usage.apiCredit.reason.<값>`).
 */
export type ApiCreditRouteReason =
  | 'off'
  | 'cloud-provider'
  | 'no-key'
  | 'blocked'
  | 'subscription-ok'
  | 'subscription-exhausted'
  | 'credits-first';

export interface ApiCreditRouteDecision {
  route: ApiCreditRoute;
  reason: ApiCreditRouteReason;
}

/** 화면으로 가는 키 정보 — 본문 없이 끝 4자리만. */
export interface ApiCreditKeyInfo {
  hint: string;
  scheme: 'os' | 'plain';
  /** 이 PC 에서 풀 수 있는가(다른 PC 에서 옮겨 온 AppState 면 못 푼다 → 다시 넣어야 한다). */
  readable: boolean;
  verified?: ApiCreditKeyVerdict;
}

/** 스냅샷으로 가는 모양 — 키 본문은 절대 싣지 않는다. */
export interface ApiCreditState {
  settings: ApiCreditSettings;
  hasKey: boolean;
  keyHint?: string;
  keyScheme?: 'os' | 'plain';
  keyVerified?: ApiCreditKeyVerdict;
  /** 저장된 키를 이 PC 에서 풀 수 있는가(다른 PC 에서 옮겨 온 AppState 면 못 푼다 → 키를 다시 넣어야 한다). */
  keyReadable?: boolean;
  /** 지출 읽기용 관리자 키. 없으면 이번 달 지출을 읽지 못한다. */
  adminKey?: ApiCreditKeyInfo;
  /** 이 PC 에서 OS 보안 저장소로 암호화할 수 있는가(못 하면 화면이 그렇게 말한다). */
  encryptionAvailable: boolean;
  /** 지금 새 명령이 나가면 탈 경로와 그 이유. */
  route: ApiCreditRoute;
  reason: ApiCreditRouteReason;
  /** 지금 크레딧으로 도는 실행 수. */
  liveRuns: number;
  subscriptionExhausted: boolean;
  subscriptionResetsAt?: number;
  /** 이 PC 의 Claude Code 가 클라우드 제공자로 설정돼 있으면 그 이름(bedrock·vertex·foundry). 그때 크레딧 경로는 닫힌다. */
  cloudProvider?: ClaudeCloudProvider;
  /** 아직 유효한 Anthropic 거절. 풀렸으면 없다. */
  block?: ApiCreditConsoleBlock;
  /** Console 이번 달 지출. */
  console: ApiCreditConsoleSpend;
}

/** Claude Code 가 Anthropic 대신 청구를 넘기는 클라우드 제공자. */
export type ClaudeCloudProvider = 'bedrock' | 'vertex' | 'foundry';

const truthyEnv = (v: string | undefined): boolean => !!v && !/^(0|false|no|off)$/i.test(v.trim());

/**
 * 이 PC 의 Claude Code 가 클라우드 제공자로 도는가. 근거는 둘 — `claude auth status` 의 `apiProvider`(설정 파일의
 * env 까지 반영된 CLI 의 판정)와 앱 프로세스 env 의 `CLAUDE_CODE_USE_BEDROCK`·`_VERTEX`·`_FOUNDRY`(우리 스폰이 그대로
 * 물려받는다). 공식 인증 우선순위상 클라우드 설정은 API 키보다 앞서므로, 이때 크레딧 키를 실어도 청구는 클라우드로 간다.
 */
export function claudeCloudProviderOf(
  env: Readonly<Record<string, string | undefined>>,
  apiProvider?: string,
): ClaudeCloudProvider | null {
  const p = (apiProvider ?? '').trim().toLowerCase();
  if (p === 'bedrock' || p === 'vertex' || p === 'foundry') return p;
  if (truthyEnv(env['CLAUDE_CODE_USE_BEDROCK'])) return 'bedrock';
  if (truthyEnv(env['CLAUDE_CODE_USE_VERTEX'])) return 'vertex';
  if (truthyEnv(env['CLAUDE_CODE_USE_FOUNDRY'])) return 'foundry';
  return null;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const objOf = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' ? v as Record<string, unknown> : null);
/** 돈은 센트 아래를 버리지 않는다 — 표시만 줄인다. */
const roundMicro = (v: number): number => Math.round(v * 1_000_000) / 1_000_000;

export function normalizeApiCreditSettings(raw: unknown): ApiCreditSettings {
  const r = (objOf(raw) ?? {}) as Partial<Record<keyof ApiCreditSettings, unknown>>;
  const d = API_CREDIT_DEFAULTS;
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    mode: r.mode === 'credits-first' || r.mode === 'subscription-first' ? r.mode : d.mode,
    autoContinue: typeof r.autoContinue === 'boolean' ? r.autoContinue : d.autoContinue,
  };
}

/** 저장된 키 한 벌 정규화 — 본문·끝자리가 없으면 키가 없는 것이다. */
export function normalizeApiCreditKeyRecord(raw: unknown): ApiCreditKeyRecord | undefined {
  const r = objOf(raw) as Partial<Record<keyof ApiCreditKeyRecord, unknown>> | null;
  if (!r) return undefined;
  if ((r.scheme !== 'os' && r.scheme !== 'plain') || typeof r.data !== 'string' || !r.data) return undefined;
  const verified = r.verified === 'ok' || r.verified === 'rejected' || r.verified === 'unknown' ? r.verified : undefined;
  return {
    scheme: r.scheme,
    data: r.data,
    hint: typeof r.hint === 'string' ? r.hint.slice(0, 8) : '…',
    savedAt: finite(r.savedAt) ? r.savedAt : 0,
    ...(verified ? { verified } : {}),
    ...(finite(r.verifiedAt) ? { verifiedAt: r.verifiedAt } : {}),
  };
}

/** 저장된 거절 기억 정규화 — 모르는 사유는 버린다. */
export function normalizeConsoleBlock(raw: unknown, now: number): ApiCreditConsoleBlock | undefined {
  const r = objOf(raw);
  if (!r || typeof r['reason'] !== 'string' || !BLOCK_REASONS.has(r['reason'])) return undefined;
  const detail = r['detail'];
  return {
    reason: r['reason'] as ApiCreditBlockReason,
    at: finite(r['at']) ? r['at'] : now,
    ...(finite(r['until']) ? { until: r['until'] } : {}),
    ...(typeof detail === 'string' && detail ? { detail: detail.slice(0, 300) } : {}),
  };
}

/** AppState 값 정규화 — 설정은 바꾼 칸만 남긴다(`retention` 규약). 옛 금액 칸·장부·실행 추정(`capUsd`·`safetyMarginUsd`·`ledger`·`pending`)은 버린다. */
export function normalizeApiCreditPersisted(raw: unknown, now: number): ApiCreditPersisted | undefined {
  const r = objOf(raw);
  if (!r) return undefined;
  const settingsRaw = objOf(r['settings']) ?? undefined;
  const full = normalizeApiCreditSettings(settingsRaw);
  const settings: Partial<ApiCreditSettings> = {};
  if (settingsRaw) {
    for (const k of Object.keys(full) as (keyof ApiCreditSettings)[]) {
      if (settingsRaw[k] !== undefined) (settings as Record<string, unknown>)[k] = full[k];
    }
  }
  const key = normalizeApiCreditKeyRecord(r['key']);
  const adminKey = normalizeApiCreditKeyRecord(r['adminKey']);
  const block = normalizeConsoleBlock(r['block'], now);
  return {
    ...(Object.keys(settings).length > 0 ? { settings } : {}),
    ...(key ? { key } : {}),
    ...(adminKey ? { adminKey } : {}),
    ...(block ? { block } : {}),
  };
}

/** 거절 기억이 아직 유효한가 — 다시 시도할 때가 지났으면 풀린 것이다. */
export function isConsoleBlockActive(block: ApiCreditConsoleBlock | null | undefined, now: number): boolean {
  if (!block) return false;
  return block.until === undefined || now < block.until;
}

export interface SubscriptionStateInput {
  /** `/usage` probe·statusLine 이 준 한도 표(`ClaudeUsageInfo.limits`). */
  limits?: readonly ClaudeUsageLimit[];
  /** 그 표를 받은 시각. */
  fetchedAt?: number;
  /** 가장 최근의 한도 통지(§5.5 #17-47). */
  lastLimitHit?: UsageLimitStop;
}

export interface SubscriptionState {
  exhausted: boolean;
  resetsAt?: number;
}

/** 이 한도 행이 "구독 전체가 막혔다"를 말하는가 — 모델별 주간 한도는 그 모델만 막으므로 세지 않는다. */
function isWholePlanLimit(l: ClaudeUsageLimit): boolean {
  if (l.scopeLabel) return false;
  return l.kind === 'session' || l.kind === 'weekly_all' || l.group === 'session' || (l.group === 'weekly' && l.kind !== 'weekly_scoped');
}

/**
 * 구독이 지금 막혔는가 — `/usage` 세션·주간 한도 100% 이고 리셋 전, 또는 한도 통지가 리셋 전.
 * 리셋 시각 없는 통지는 `API_CREDIT_UNKNOWN_RESET_HOLD_MS` 까지만, 그보다 새로운 `/usage` 가 100% 미만이면 풀린다.
 */
export function isSubscriptionExhausted(input: SubscriptionStateInput, now: number): SubscriptionState {
  let resetsAt: number | undefined;
  let exhausted = false;
  const whole = (input.limits ?? []).filter(isWholePlanLimit);
  for (const l of whole) {
    if (!(l.percent >= 100)) continue;
    if (finite(l.resetsAt) && l.resetsAt <= now) continue;
    exhausted = true;
    if (finite(l.resetsAt)) resetsAt = resetsAt === undefined ? l.resetsAt : Math.max(resetsAt, l.resetsAt);
  }
  const hit = input.lastLimitHit;
  if (hit) {
    if (finite(hit.resetsAt)) {
      if (hit.resetsAt > now) {
        exhausted = true;
        resetsAt = resetsAt === undefined ? hit.resetsAt : Math.max(resetsAt, hit.resetsAt);
      }
    } else if (now - hit.at < API_CREDIT_UNKNOWN_RESET_HOLD_MS) {
      const fresherProbeSaysOpen = finite(input.fetchedAt) && input.fetchedAt > hit.at
        && whole.length > 0 && whole.every((l) => l.percent < 100);
      if (!fresherProbeSaysOpen) exhausted = true;
    }
  }
  return resetsAt !== undefined ? { exhausted, resetsAt } : { exhausted };
}

export interface CreditRouteInput {
  settings: ApiCreditSettings;
  hasKey: boolean;
  /** Anthropic 거절 기억(유효한 것만 넘겨도, 지난 것을 넘겨도 된다 — 여기서 다시 본다). */
  block?: ApiCreditConsoleBlock | null;
  subscriptionExhausted: boolean;
  /** 클라우드 제공자로 설정된 PC 면 그 이름 — 크레딧 경로를 열지 않는다. */
  cloudProvider?: ClaudeCloudProvider | null;
}

/**
 * 새 실행이 탈 경로. **키가 없거나 Anthropic 이 막 거절했으면 구독**이다 — 크레딧을 못 쓸 때 실행을 막지 않는다
 * (구독도 막혀 있으면 CLI 가 한도 통지로 0원에 멈추고 §5.5 #17-47 주황이 그것을 말한다). 금액 판정은 없다 —
 * 한도·잔액은 Anthropic 이 직접 지킨다.
 */
export function decideCreditRoute(input: CreditRouteInput, now: number): ApiCreditRouteDecision {
  const { settings, hasKey, subscriptionExhausted } = input;
  if (!settings.enabled) return { route: 'subscription', reason: 'off' };
  if (input.cloudProvider) return { route: 'subscription', reason: 'cloud-provider' };
  if (!hasKey) return { route: 'subscription', reason: 'no-key' };
  if (isConsoleBlockActive(input.block, now)) return { route: 'subscription', reason: 'blocked' };
  if (settings.mode === 'credits-first') return { route: 'credits', reason: 'credits-first' };
  if (subscriptionExhausted) return { route: 'credits', reason: 'subscription-exhausted' };
  return { route: 'subscription', reason: 'subscription-ok' };
}

// ─── Anthropic 거절 문구 읽기 ────────────────────────────────────────────────

/** UTC 달력 월의 1일 00:00 — Console 지출 한도가 초기화되는 경계. */
export function utcMonthStart(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** 다음 UTC 달력 월의 1일 00:00. */
export function utcNextMonthStart(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/** 문구가 말한 재개 시각 — `You will regain access on 2026-09-01 at 00:00 UTC.` 시각이 없으면 그날 00:00 UTC. */
export function readRegainAccessAt(text: string): number | undefined {
  const m = /regain access on (\d{4})-(\d{2})-(\d{2})(?:\s+at\s+(\d{1,2}):(\d{2}))?/i.exec(text);
  if (!m) return undefined;
  const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0);
  return Number.isFinite(at) ? at : undefined;
}

/** 실패 문장에서 사람이 읽을 한 줄 — JSON 오류 본문이면 그 `message`, 아니면 마지막 줄. */
function failureDetail(text: string): string {
  const m = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
  const picked = m ? m[1]!.replace(/\\"/g, '"').replace(/\\n/g, ' ') : (text.trim().split('\n').filter((l) => l.trim()).pop() ?? '');
  return picked.trim().slice(0, 300);
}

/**
 * 크레딧 실행이 남긴 실패 문장에서 **Anthropic 의 거절**을 읽는다. 모르는 실패는 null — 넘겨짚어 막지 않는다.
 * - 잔액 부족: API `Your credit balance is too low…` · CLI `Credit balance too low · Add funds…` → 1시간 뒤 다시
 * - 지출 한도: 사용자가 정한 한도 400 `You have reached your specified (workspace) API usage limits…` · 등급 상한
 *   429 `You have reached your API usage limits…` + `enforced_spend_limit_reached` → 문구의 재개 시각, 없으면 다음 달 1일 UTC
 * - 키 거부: 401 · `invalid x-api-key` · `Invalid API key` → 키를 바꿀 때까지
 */
export function detectConsoleRefusal(text: string | undefined, now: number): ApiCreditConsoleBlock | null {
  if (!text) return null;
  const s = text.slice(0, 4000);
  if (/credit balance (is )?too low/i.test(s)) {
    return { reason: 'balance-empty', at: now, until: now + API_CREDIT_BALANCE_RECHECK_MS, detail: failureDetail(s) };
  }
  if (/reached your (?:specified )?(?:workspace )?API usage limits|enforced_spend_limit_reached/i.test(s)) {
    const regain = readRegainAccessAt(s);
    return { reason: 'spend-limit', at: now, until: regain !== undefined && regain > now ? regain : utcNextMonthStart(now), detail: failureDetail(s) };
  }
  if (/invalid x-api-key|invalid api key|authentication_error|\b401\b.*(api key|unauthori[sz]ed)/i.test(s)) {
    return { reason: 'key-invalid', at: now, detail: failureDetail(s) };
  }
  return null;
}

/** result 줄이 실패를 말했으면 그 본문(없으면 subtype). 실패가 아니면 undefined. */
export function readResultError(obj: unknown): string | undefined {
  const line = objOf(obj);
  if (!line || line['type'] !== 'result' || line['is_error'] !== true) return undefined;
  if (typeof line['result'] === 'string' && line['result']) return line['result'] as string;
  return typeof line['subtype'] === 'string' ? line['subtype'] as string : undefined;
}

// ─── 비용 보고(cost_report) ──────────────────────────────────────────────────

const rfc3339 = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * 한 달치 비용 보고 주소. 끝은 다음 달 1일이다 — `ending_at` 은 "그 전에 끝나는 버킷"이라 지금으로 두면 오늘 버킷이
 * (내일 0시에 끝나므로) 빠진다. 아직 오지 않은 날은 빈 버킷으로 온다.
 */
export function costReportUrl(startingAt: number, endingAt: number, page?: string): string {
  const q = new URLSearchParams({
    starting_at: rfc3339(startingAt),
    ending_at: rfc3339(endingAt),
    bucket_width: '1d',
    limit: '31',
  });
  if (page) q.set('page', page);
  return `${API_CREDIT_COST_REPORT_URL}?${q.toString()}`;
}

/**
 * 비용 보고 한 쪽을 합한다 — `data[].results[].amount` 는 **센트 단위 소수 문자열**이다(`"123.45"` = $1.2345).
 * 통화가 USD 가 아닌 항목은 더하지 않는다(문서상 지금은 늘 USD). 모양이 다르면 null.
 */
export function parseCostReport(body: unknown): { cents: number; hasMore: boolean; nextPage?: string } | null {
  const o = objOf(body);
  if (!o || !Array.isArray(o['data'])) return null;
  let cents = 0;
  for (const bucket of o['data'] as unknown[]) {
    const results = objOf(bucket)?.['results'];
    if (!Array.isArray(results)) continue;
    for (const item of results) {
      const r = objOf(item);
      if (!r) continue;
      const currency = r['currency'];
      if (typeof currency === 'string' && currency.toUpperCase() !== 'USD') continue;
      const amount = r['amount'];
      const n = typeof amount === 'string' ? Number(amount) : finite(amount) ? amount : Number.NaN;
      if (Number.isFinite(n)) cents += n;
    }
  }
  const next = o['next_page'];
  const nextPage = typeof next === 'string' && next ? next : undefined;
  return { cents, hasMore: o['has_more'] === true && nextPage !== undefined, ...(nextPage ? { nextPage } : {}) };
}

/** 센트 합 → USD(소수 여섯째 자리까지). */
export function centsToUsd(cents: number): number {
  return roundMicro(cents / 100);
}

/** HTTP 상태 → 화면이 고르는 사유. */
export function classifyConsoleHttpError(status: number): ApiCreditConsoleErrorKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 429) return 'rate-limited';
  return 'other';
}

/** Anthropic 오류 본문(`{"type":"error","error":{"message":…}}`)의 문장. 없으면 undefined. */
export function readAnthropicErrorMessage(body: unknown): string | undefined {
  const message = objOf(objOf(body)?.['error'])?.['message'];
  return typeof message === 'string' && message ? message.slice(0, 300) : undefined;
}

// ─── 키 ──────────────────────────────────────────────────────────────────────

/** 화면·로그용 끝 4자리. 짧은 값은 통째로 가린다. */
export function maskApiKey(key: string): string {
  const k = key.trim();
  return k.length >= 12 ? `…${k.slice(-4)}` : '…';
}

export type ApiKeyShapeProblem = 'empty' | 'not-anthropic' | 'admin-key' | 'oauth-token' | 'whitespace';

/**
 * 붙여 넣은 값이 Console API 키 모양인가. 확인은 결국 `/v1/models` 가 하지만, 관리자 키·OAuth 토큰처럼
 * **모양만 봐도 메시지를 못 보내는 값**은 저장 전에 돌려보낸다(관리자 키는 조직 관리 전용이다).
 */
export function checkApiKeyShape(raw: string): ApiKeyShapeProblem | null {
  const k = raw.trim();
  if (!k) return 'empty';
  if (/\s/.test(k)) return 'whitespace';
  if (!k.startsWith('sk-ant-')) return 'not-anthropic';
  if (k.startsWith('sk-ant-admin')) return 'admin-key';
  if (k.startsWith('sk-ant-oat')) return 'oauth-token';
  return null;
}

/**
 * 지출 읽기 칸에 붙여 넣은 값의 모양. 관리자 키(`sk-ant-admin01-…`)가 정석이고, 워크스페이스에 묶이지 않은 개인·서비스
 * 계정 키(`sk-ant-api…`)도 공식 문서상 통하므로 받는다(묶인 키면 Anthropic 이 거절하고 그 원문이 화면에 뜬다).
 * OAuth 토큰은 돌려보낸다.
 */
export function checkAdminKeyShape(raw: string): Exclude<ApiKeyShapeProblem, 'admin-key'> | null {
  const k = raw.trim();
  if (!k) return 'empty';
  if (/\s/.test(k)) return 'whitespace';
  if (!k.startsWith('sk-ant-')) return 'not-anthropic';
  if (k.startsWith('sk-ant-oat')) return 'oauth-token';
  return null;
}
