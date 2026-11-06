import {
  API_CREDIT_ANTHROPIC_VERSION,
  API_CREDIT_CONSOLE_AFTER_RUN_MS,
  API_CREDIT_CONSOLE_FORCE_MIN_MS,
  API_CREDIT_CONSOLE_MIN_INTERVAL_MS,
  API_CREDIT_CONSOLE_TIMEOUT_MS,
  API_CREDIT_COST_REPORT_MAX_PAGES,
  API_CREDIT_ORG_URL,
  API_CREDIT_USER_AGENT,
  API_CREDIT_VERIFY_TIMEOUT_MS,
  API_CREDIT_VERIFY_URL,
  OPENAI_CREDIT_COSTS_MAX_PAGES,
  OPENAI_CREDIT_VERIFY_URL,
  centsToUsd,
  checkAdminKeyShape,
  checkApiKeyShape,
  checkOpenAiAdminKeyShape,
  checkOpenAiKeyShape,
  claudeCloudProviderOf,
  classifyConsoleHttpError,
  costReportUrl,
  decideCreditRoute,
  detectConsoleRefusal,
  detectOpenAiRefusal,
  isConsoleBlockActive,
  isSubscriptionExhausted,
  maskApiKey,
  normalizeApiCreditSettings,
  openaiCostsUrl,
  parseCostReport,
  parseOpenAiCosts,
  readAnthropicErrorMessage,
  readOpenAiErrorMessage,
  readResultError,
  utcMonthStart,
  utcNextMonthStart,
  type ApiCreditConsoleBlock,
  type ApiCreditConsoleSpend,
  type ApiCreditKeyRecord,
  type ApiCreditKeyVerdict,
  type ApiCreditPersisted,
  type ApiCreditRouteDecision,
  type ApiCreditSettings,
  type ApiCreditState,
  type ApiCreditVendor,
  type ApiKeyShapeProblem,
  type ClaudeUsageLimit,
  type PlatformName,
  type SubscriptionState,
  type UsageLimitStop,
} from '@vibisual/shared';
import { appStateGetApiCredits, appStateGetOpenaiCredits, appStateSetApiCredits, appStateSetOpenaiCredits } from './appState.js';
import { withOnlyEnvKey } from './envKey.js';
import { logger } from '../logger.js';

export { withOnlyEnvKey };

/**
 * §4 API 크레딧 — 구독 한도가 막히면 조직 API 크레딧으로 잇는다: 경로 결정(`decide`, 판정은 shared) · 이번 달 지출 읽기(`refreshConsole`, 메모리만) ·
 * 공급자 거절(잔액·월 한도·키) 기억 → 새 실행을 구독으로 · 두 키를 OS 보안 저장소로 감싸기. Claude 판(Console)과 OpenAI 판(Platform)이 같은 틀을 쓰고
 * 공급자마다 다른 사실(주소·키 모양·거절 문구)만 `CreditVendorSpec` 이 들고 온다.
 * 금액을 세거나 막지 마라 — 앱이 센 숫자는 공급자 화면과 어긋나 남은 크레딧을 막는다. 값의 원천(구독 한도 표·제공자 설정)은 주입받는다(순환 방지).
 */

/**
 * 키를 감싸는 손. 데스크톱 main 이 Electron `safeStorage` 로 채운다(Windows DPAPI · macOS 키체인 ·
 * Linux libsecret/kwallet). 주입이 없으면(시험·서버 단독) 원문으로 둔다 — 그 사실은 화면이 말한다.
 */
export interface ApiCreditCipher {
  /** 지금 감쌀 수 있는가(앱 ready 전에는 false 일 수 있다). */
  available(): boolean;
  /** OS 보안 저장소가 실제로 지키는가 — 키링 없는 Linux 의 `basic_text` 는 감싸도 지키지 못한다. */
  strong(): boolean;
  encrypt(plain: string): string;
  decrypt(data: string): string;
}

export interface SubscriptionSource {
  limits?: readonly ClaudeUsageLimit[];
  fetchedAt?: number;
}

interface LiveRun {
  id: string;
  subId: string;
  cmdId: string;
  startedAt: number;
  /** 이 실행을 공급자가 거절했으면 그 사유. */
  refusal?: ApiCreditConsoleBlock;
}

export interface ApiCreditRunEnd {
  /** 공급자가 이 실행을 거절했으면 그 사유(잔액 부족·지출 한도·키 거부). */
  refusal?: ApiCreditConsoleBlock;
}

type KeySlot = 'run' | 'admin';

type JsonResponse = { ok: boolean; status: number; body: unknown } | { networkError: string };

/** 공급자마다 다른 사실. 판정·저장·갱신 주기는 서비스가 한 벌로 갖는다. */
export interface CreditVendorSpec {
  vendor: ApiCreditVendor;
  /** 로그 머리. */
  tag: string;
  /** 로그에 쓰는 공급자 이름. */
  name: string;
  load(): ApiCreditPersisted;
  save(next: ApiCreditPersisted): void;
  headers(key: string): Record<string, string>;
  verifyUrl: string;
  checkRunKey(raw: string): ApiKeyShapeProblem | null;
  checkAdminKey(raw: string): ApiKeyShapeProblem | null;
  maxCostPages: number;
  costUrl(startingAt: number, endingAt: number, page?: string): string;
  /** 한 쪽의 합(공급자 단위 — Anthropic 센트 · OpenAI 달러). */
  parseCost(body: unknown): { amount: number; hasMore: boolean; nextPage?: string } | null;
  amountToUsd(total: number): number;
  /** 같은 키로 조직 이름을 읽는 공개 주소. 없으면 읽지 않는다. */
  orgUrl?: string;
  readError(body: unknown): string | undefined;
  detectRefusal(text: string | undefined, now: number): ApiCreditConsoleBlock | null;
  /** 이 PC 가 다른 제공자로 돌아 크레딧 경로를 닫아야 하면 그 이름. 인자는 주입된 제공자 원천의 값. */
  closedProvider(source: string | undefined): string | null;
  /** 화면 상태에서 그 이름을 싣는 칸. */
  providerField: 'cloudProvider' | 'customProvider';
}

/** 키 하나로 공식 엔드포인트를 GET 한다. 시간이 지나면 끊는다. */
async function getJson(url: string, headers: Record<string, string>, timeoutMs: number): Promise<JsonResponse> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: ctl.signal });
    let body: unknown = null;
    try { body = await res.json(); } catch { /* 본문 없는 응답 */ }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { networkError: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** 화면을 다시 그리게 하는 최소 간격(키를 못 푸는 것처럼 저절로 생기는 변화를 몰아서 민다). */
const NOTIFY_SOON_MS = 1_500;

export class ApiCreditService {
  private booted = false;
  /** 사용자가 바꾼 칸만(저장 모양). 판정은 `settings()` 가 기본값과 겹쳐 쓴다. */
  private savedSettings: Partial<ApiCreditSettings> = {};
  private key: ApiCreditKeyRecord | undefined;
  private adminKey: ApiCreditKeyRecord | undefined;
  private block: ApiCreditConsoleBlock | undefined;
  private live = new Map<string, LiveRun>();
  private runSeq = 0;
  private lastLimitHit: UsageLimitStop | undefined;
  private keyUnreadable = false;
  private adminKeyUnreadable = false;
  private verifying: Promise<ApiCreditKeyVerdict> | null = null;

  /** 이번 달 지출 — 읽어 온 값 그대로, 메모리만(앱 장부 ❌). */
  private consoleState: ApiCreditConsoleSpend = { status: 'no-key', refreshing: false, monthStart: 0 };
  private consoleInflight: Promise<void> | null = null;
  private consoleLastAttemptAt = 0;
  private afterRunTimer: NodeJS.Timeout | null = null;

  private cipher: ApiCreditCipher | null = null;
  private subscriptionSource: () => SubscriptionSource = () => ({});
  /** 제공자 원천 — Claude 판은 `claude auth status` 의 `apiProvider`, OpenAI 판은 코덱스 설정이 고른 `model_provider`. */
  private providerSource: () => string | undefined = () => undefined;
  private changeListener: (() => void) | null = null;
  private notifyTimer: NodeJS.Timeout | null = null;

  constructor(private readonly spec: CreditVendorSpec) {}

  get vendor(): ApiCreditVendor { return this.spec.vendor; }

  // ─── 주입 ───────────────────────────────────────────────────────────

  setCipher(cipher: ApiCreditCipher | null): void { this.cipher = cipher; }
  setSubscriptionSource(fn: () => SubscriptionSource): void { this.subscriptionSource = fn; }
  setProviderSource(fn: () => string | undefined): void { this.providerSource = fn; }
  setChangeListener(fn: (() => void) | null): void { this.changeListener = fn; }

  /** 이 PC 가 다른 제공자로 도는가(그러면 크레딧 키를 실어도 청구가 그쪽으로 가거나 설정을 덮는다). */
  cloudProvider(): string | null {
    return this.spec.closedProvider(this.providerSource());
  }

  // ─── 저장 ───────────────────────────────────────────────────────────

  /** 첫 사용 때 한 번 디스크에서 읽는다. 옛 판의 금액 칸·장부는 정규화가 이미 떨어뜨렸다. */
  private boot(): void {
    if (this.booted) return;
    this.booted = true;
    const saved = this.spec.load();
    this.savedSettings = { ...(saved.settings ?? {}) };
    this.key = saved.key;
    this.adminKey = saved.adminKey;
    this.block = saved.block;
    this.consoleState = { status: this.adminKey ? 'pending' : 'no-key', refreshing: false, monthStart: utcMonthStart(Date.now()) };
  }

  private persist(): void {
    const next: ApiCreditPersisted = {
      ...(Object.keys(this.savedSettings).length > 0 ? { settings: this.savedSettings } : {}),
      ...(this.key ? { key: this.key } : {}),
      ...(this.adminKey ? { adminKey: this.adminKey } : {}),
      ...(this.block ? { block: this.block } : {}),
    };
    this.spec.save(next);
  }

  private notifyNow(): void {
    if (this.notifyTimer) { clearTimeout(this.notifyTimer); this.notifyTimer = null; }
    try { this.changeListener?.(); } catch (err) {
      logger.warn(`${this.spec.tag} change listener failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private notifySoon(): void {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => { this.notifyTimer = null; this.notifyNow(); }, NOTIFY_SOON_MS);
    if (typeof this.notifyTimer.unref === 'function') this.notifyTimer.unref();
  }

  // ─── 키 감싸기·풀기 ──────────────────────────────────────────────────

  private wrap(plain: string): ApiCreditKeyRecord {
    const canWrap = !!this.cipher && this.cipher.available();
    return canWrap
      ? { scheme: 'os', data: this.cipher!.encrypt(plain), hint: maskApiKey(plain), savedAt: Date.now(), verified: 'unknown' }
      : { scheme: 'plain', data: plain, hint: maskApiKey(plain), savedAt: Date.now(), verified: 'unknown' };
  }

  private setUnreadable(slot: KeySlot, flag: boolean): boolean {
    const prev = slot === 'run' ? this.keyUnreadable : this.adminKeyUnreadable;
    if (prev === flag) return false;
    if (slot === 'run') this.keyUnreadable = flag; else this.adminKeyUnreadable = flag;
    this.notifySoon();
    return true;
  }

  /** 저장된 키를 푼다. 못 풀면 null(그 키는 없는 것과 같다). 본문은 로그에 남기지 않는다. */
  private unwrap(record: ApiCreditKeyRecord, slot: KeySlot): string | null {
    if (record.scheme === 'plain') return record.data;
    if (!this.cipher || !this.cipher.available()) return null;
    try {
      const plain = this.cipher.decrypt(record.data);
      this.setUnreadable(slot, false);
      return plain;
    } catch (err) {
      if (this.setUnreadable(slot, true)) {
        logger.warn(`${this.spec.tag} stored ${slot === 'run' ? 'API' : 'admin'} key could not be decrypted on this machine (${err instanceof Error ? err.message : String(err)}) — enter it again`);
      }
      return null;
    }
  }

  // ─── 읽기 ───────────────────────────────────────────────────────────

  settings(): ApiCreditSettings {
    this.boot();
    return normalizeApiCreditSettings(this.savedSettings);
  }

  isEnabled(): boolean { return this.settings().enabled; }

  /** 아직 유효한 공급자 거절. 시도 시각이 지났으면 걷는다 — 거절된 요청은 과금되지 않아 다시 물어도 된다. */
  private activeBlock(now: number): ApiCreditConsoleBlock | undefined {
    if (!this.block) return undefined;
    if (isConsoleBlockActive(this.block, now)) return this.block;
    logger.info(`${this.spec.tag} ${this.spec.name} refusal (${this.block.reason}) is past its retry time — credits are tried again`);
    this.block = undefined;
    this.persist();
    return undefined;
  }

  subscriptionState(now = Date.now()): SubscriptionState {
    const src = this.subscriptionSource();
    return isSubscriptionExhausted({
      ...(src.limits ? { limits: src.limits } : {}),
      ...(typeof src.fetchedAt === 'number' ? { fetchedAt: src.fetchedAt } : {}),
      ...(this.lastLimitHit ? { lastLimitHit: this.lastLimitHit } : {}),
    }, now);
  }

  /** 새 실행이 지금 나가면 탈 경로. 키를 이 PC 에서 못 풀면 키가 없는 것과 같다. */
  decide(now = Date.now()): ApiCreditRouteDecision {
    this.boot();
    return decideCreditRoute({
      settings: this.settings(),
      hasKey: !!this.key && !this.keyUnreadable,
      block: this.activeBlock(now) ?? null,
      subscriptionExhausted: this.subscriptionState(now).exhausted,
      cloudProvider: this.cloudProvider(),
    }, now);
  }

  /** 스폰에 실을 키. 못 풀면 null(그 실행은 구독으로 간다). */
  keyForSpawn(): string | null {
    this.boot();
    return this.key ? this.unwrap(this.key, 'run') : null;
  }

  getState(now = Date.now()): ApiCreditState {
    this.boot();
    const settings = this.settings();
    const decision = this.decide(now);
    const block = this.activeBlock(now);
    const sub = this.subscriptionState(now);
    const closed = this.cloudProvider();
    return {
      settings,
      hasKey: !!this.key,
      ...(this.key ? { keyHint: this.key.hint, keyScheme: this.key.scheme, keyReadable: !this.keyUnreadable } : {}),
      ...(this.key?.verified ? { keyVerified: this.key.verified } : {}),
      ...(this.adminKey ? {
        adminKey: {
          hint: this.adminKey.hint,
          scheme: this.adminKey.scheme,
          readable: !this.adminKeyUnreadable,
          ...(this.adminKey.verified ? { verified: this.adminKey.verified } : {}),
        },
      } : {}),
      encryptionAvailable: !!this.cipher && this.cipher.available() && this.cipher.strong(),
      route: decision.route,
      reason: decision.reason,
      liveRuns: this.live.size,
      subscriptionExhausted: sub.exhausted,
      ...(sub.resetsAt !== undefined ? { subscriptionResetsAt: sub.resetsAt } : {}),
      ...(closed ? (this.spec.providerField === 'cloudProvider'
        ? { cloudProvider: closed as NonNullable<ApiCreditState['cloudProvider']> }
        : { customProvider: closed }) : {}),
      ...(block ? { block: { ...block } } : {}),
      console: { ...this.consoleState, ...(this.consoleState.error ? { error: { ...this.consoleState.error } } : {}) },
    };
  }

  // ─── 설정·키 손잡이 ──────────────────────────────────────────────────

  updateSettings(patch: Partial<Record<keyof ApiCreditSettings, unknown>>): ApiCreditState {
    this.boot();
    const merged = normalizeApiCreditSettings({ ...this.settings(), ...patch });
    // 바꾼 칸만 저장한다 — 보낸 칸이 곧 사용자가 정한 칸이다(모르는 칸은 버린다).
    for (const k of Object.keys(patch) as (keyof ApiCreditSettings)[]) {
      if (k in merged) (this.savedSettings as Record<string, unknown>)[k] = merged[k];
    }
    this.persist();
    this.notifyNow();
    return this.getState();
  }

  /** 붙여 넣은 실행용 키를 저장한다. 모양이 틀리면 저장하지 않고 그 사유를 돌려준다. 저장 뒤 확인은 비동기로 돈다. */
  setKey(raw: string): { problem?: ApiKeyShapeProblem; state: ApiCreditState } {
    this.boot();
    const problem = this.spec.checkRunKey(raw);
    if (problem) return { problem, state: this.getState() };
    let record: ApiCreditKeyRecord;
    try {
      record = this.wrap(raw.trim());
    } catch (err) {
      // 감싸기가 실패했다고 원문으로 떨어뜨리지 않는다 — 사용자는 감싸 둔 줄로 안다.
      logger.warn(`${this.spec.tag} key encryption failed: ${err instanceof Error ? err.message : String(err)}`);
      return { problem: 'empty', state: this.getState() };
    }
    const firstKey = !this.key;
    this.key = record;
    this.keyUnreadable = false;
    // 키를 처음 넣으면 스위치를 켠다(사용자가 원하는 것은 "쓰게 해 달라"다). 한 번이라도 직접 끈 적이 있으면 그대로.
    if (firstKey && this.savedSettings.enabled === undefined) this.savedSettings.enabled = true;
    // 새 키다 — 옛 키에 대한 거절은 이 키의 것이 아니다.
    if (this.block?.reason === 'key-invalid') this.block = undefined;
    this.persist();
    this.notifyNow();
    logger.info(`${this.spec.tag} key saved (${record.hint}, ${record.scheme === 'os' ? 'OS-protected' : 'unprotected'})`);
    void this.verifyKey();
    return { state: this.getState() };
  }

  clearKey(): ApiCreditState {
    this.boot();
    this.key = undefined;
    this.keyUnreadable = false;
    if (this.block?.reason === 'key-invalid') this.block = undefined;
    this.persist();
    this.notifyNow();
    logger.info(`${this.spec.tag} key removed`);
    return this.getState();
  }

  /**
   * 실행용 키 확인 — 공개 `GET /v1/models`(과금 없음). 200 이면 ok, 401·403 이면 거부(공급자 거절 `key-invalid` 로
   * 기억), 그 밖(네트워크·5xx·시간 초과)은 모름 — 모름으로 막지 않는다.
   */
  verifyKey(): Promise<ApiCreditKeyVerdict> {
    this.boot();
    if (this.verifying) return this.verifying;
    const key = this.keyForSpawn();
    if (!key || !this.key) return Promise.resolve('unknown');
    const hint = this.key.hint;
    this.verifying = (async (): Promise<ApiCreditKeyVerdict> => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), API_CREDIT_VERIFY_TIMEOUT_MS);
      let verdict: ApiCreditKeyVerdict = 'unknown';
      try {
        const res = await fetch(this.spec.verifyUrl, { method: 'GET', headers: this.spec.headers(key), signal: ctl.signal });
        verdict = res.ok ? 'ok' : (res.status === 401 || res.status === 403) ? 'rejected' : 'unknown';
        if (verdict === 'unknown') logger.warn(`${this.spec.tag} key check returned HTTP ${res.status} — leaving it as unknown`);
      } catch (err) {
        logger.warn(`${this.spec.tag} key check failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        clearTimeout(timer);
      }
      // 그 사이 키가 바뀌었으면 옛 키의 판정을 새 키에 붙이지 않는다.
      if (this.key && this.key.hint === hint) {
        this.key = { ...this.key, verified: verdict, verifiedAt: Date.now() };
        if (verdict === 'rejected') {
          this.block = { reason: 'key-invalid', at: Date.now(), detail: 'GET /v1/models → 401/403' };
          logger.warn(`${this.spec.tag} ${this.spec.name} rejected the API key — new runs use the subscription until the key changes`);
        } else if (verdict === 'ok' && this.block?.reason === 'key-invalid') {
          this.block = undefined;
        }
        this.persist();
        this.notifyNow();
      }
      return verdict;
    })().finally(() => { this.verifying = null; });
    return this.verifying;
  }

  /** 지출 읽기용 키 저장. 저장 즉시 이번 달 지출을 읽는다 — 그 읽기가 곧 확인이다. */
  setAdminKey(raw: string): { problem?: ApiKeyShapeProblem; state: ApiCreditState } {
    this.boot();
    const problem = this.spec.checkAdminKey(raw);
    if (problem) return { problem, state: this.getState() };
    let record: ApiCreditKeyRecord;
    try {
      record = this.wrap(raw.trim());
    } catch (err) {
      logger.warn(`${this.spec.tag} admin key encryption failed: ${err instanceof Error ? err.message : String(err)}`);
      return { problem: 'empty', state: this.getState() };
    }
    this.adminKey = record;
    this.adminKeyUnreadable = false;
    this.consoleState = { status: 'pending', refreshing: false, monthStart: utcMonthStart(Date.now()) };
    this.consoleLastAttemptAt = 0;
    this.persist();
    this.notifyNow();
    logger.info(`${this.spec.tag} admin key saved (${record.hint}, ${record.scheme === 'os' ? 'OS-protected' : 'unprotected'})`);
    void this.refreshConsole({ force: true });
    return { state: this.getState() };
  }

  clearAdminKey(): ApiCreditState {
    this.boot();
    this.adminKey = undefined;
    this.adminKeyUnreadable = false;
    this.consoleState = { status: 'no-key', refreshing: false, monthStart: utcMonthStart(Date.now()) };
    this.persist();
    this.notifyNow();
    logger.info(`${this.spec.tag} admin key removed`);
    return this.getState();
  }

  /** [다시 시도] — 공급자 거절 기억을 지금 걷는다(충전·한도를 바꾼 뒤). 다음 실행이 다시 크레딧을 묻는다. */
  clearBlock(): ApiCreditState {
    this.boot();
    if (this.block) {
      logger.info(`${this.spec.tag} ${this.spec.name} refusal (${this.block.reason}) cleared by user — credits are tried again`);
      this.block = undefined;
      this.persist();
      this.notifyNow();
    }
    return this.getState();
  }

  private markAdminVerdict(verdict: ApiCreditKeyVerdict): void {
    if (!this.adminKey || this.adminKey.verified === verdict) return;
    this.adminKey = { ...this.adminKey, verified: verdict, verifiedAt: Date.now() };
    this.persist();
  }

  // ─── 이번 달 지출 ────────────────────────────────────────────────────

  /**
   * 이번 달 지출을 공급자의 공식 비용 API 로 읽는다(UTC 달력 월 — 지출 한도가 초기화되는 달). 읽는 중이면 함께 기다리고, `force` 가 아니면 `maxAgeMs`(기본 1분) 안엔
   * 다시 묻지 않는다. 실패해도 마지막 값은 남기고 사유만 바꾼다.
   */
  refreshConsole(opts: { force?: boolean; maxAgeMs?: number } = {}): Promise<void> {
    this.boot();
    if (!this.adminKey) {
      if (this.consoleState.status !== 'no-key') {
        this.consoleState = { status: 'no-key', refreshing: false, monthStart: utcMonthStart(Date.now()) };
        this.notifySoon();
      }
      return Promise.resolve();
    }
    if (this.consoleInflight) return this.consoleInflight;
    const now = Date.now();
    const floor = opts.force ? API_CREDIT_CONSOLE_FORCE_MIN_MS : (opts.maxAgeMs ?? API_CREDIT_CONSOLE_MIN_INTERVAL_MS);
    if (now - this.consoleLastAttemptAt < floor) return Promise.resolve();
    const key = this.unwrap(this.adminKey, 'admin');
    if (!key) {
      if (this.adminKeyUnreadable) {
        this.consoleState = { ...this.consoleState, status: 'error', refreshing: false, error: { kind: 'unreadable' } };
        this.notifySoon();
      }
      return Promise.resolve();
    }
    this.consoleLastAttemptAt = now;
    const owner = this.adminKey;
    const headers = this.spec.headers(key);
    this.consoleState = { ...this.consoleState, refreshing: true };
    this.notifySoon();
    const run = async (): Promise<void> => {
      const monthStart = utcMonthStart(now);
      const monthEnd = utcNextMonthStart(now);
      let total = 0;
      let page: string | undefined;
      let failure: ApiCreditConsoleSpend['error'];
      for (let i = 0; i < this.spec.maxCostPages; i++) {
        const res = await getJson(this.spec.costUrl(monthStart, monthEnd, page), headers, API_CREDIT_CONSOLE_TIMEOUT_MS);
        if ('networkError' in res) { failure = { kind: 'network', message: res.networkError.slice(0, 300) }; break; }
        if (!res.ok) {
          const message = this.spec.readError(res.body);
          failure = { kind: classifyConsoleHttpError(res.status), status: res.status, ...(message ? { message } : {}) };
          break;
        }
        const parsed = this.spec.parseCost(res.body);
        if (!parsed) { failure = { kind: 'other', status: res.status }; break; }
        total += parsed.amount;
        if (!parsed.hasMore) break;
        page = parsed.nextPage;
      }
      // 그 사이 키가 바뀌었거나 지워졌으면 옛 키의 결과를 새 상태에 붙이지 않는다.
      if (this.adminKey !== owner) return;
      const prev = this.consoleState;
      let orgName = prev.orgName;
      if (!failure && orgName === undefined && this.spec.orgUrl) {
        const org = await getJson(this.spec.orgUrl, headers, API_CREDIT_CONSOLE_TIMEOUT_MS);
        const name = !('networkError' in org) && org.ok ? (org.body as { name?: unknown } | null)?.name : undefined;
        if (typeof name === 'string' && name) orgName = name.slice(0, 120);
        if (this.adminKey !== owner) return;
      }
      if (failure) {
        // 같은 달의 마지막 값은 남긴다 — 읽기 한 번이 실패했다고 숫자가 사라지면 안 된다.
        const keep = prev.monthStart === monthStart && prev.spendUsd !== undefined;
        this.consoleState = {
          status: 'error',
          refreshing: false,
          monthStart,
          ...(keep ? { spendUsd: prev.spendUsd, ...(prev.fetchedAt !== undefined ? { fetchedAt: prev.fetchedAt } : {}) } : {}),
          ...(orgName ? { orgName } : {}),
          error: failure,
        };
        if (failure.kind === 'auth') this.markAdminVerdict('rejected');
        logger.warn(`${this.spec.tag} spend read failed: ${failure.kind}${failure.status ? ` HTTP ${failure.status}` : ''}${failure.message ? ` — ${failure.message.slice(0, 160)}` : ''}`);
      } else {
        this.consoleState = {
          status: 'ok',
          refreshing: false,
          monthStart,
          spendUsd: this.spec.amountToUsd(total),
          fetchedAt: Date.now(),
          ...(orgName ? { orgName } : {}),
        };
        this.markAdminVerdict('ok');
      }
      this.notifyNow();
    };
    this.consoleInflight = run()
      .catch((err) => { logger.warn(`${this.spec.tag} spend read crashed: ${err instanceof Error ? err.message : String(err)}`); })
      .finally(() => {
        this.consoleInflight = null;
        if (this.consoleState.refreshing) {
          this.consoleState = { ...this.consoleState, refreshing: false };
          this.notifySoon();
        }
      });
    return this.consoleInflight;
  }

  /** 크레딧 실행이 끝났다 — 자료가 반영될 틈을 두고 지출을 한 번 다시 읽는다(여럿이 끝나도 한 번). */
  private scheduleConsoleRefreshAfterRun(): void {
    if (!this.adminKey || this.afterRunTimer) return;
    this.afterRunTimer = setTimeout(() => {
      this.afterRunTimer = null;
      void this.refreshConsole({ force: true });
    }, API_CREDIT_CONSOLE_AFTER_RUN_MS);
    if (typeof this.afterRunTimer.unref === 'function') this.afterRunTimer.unref();
  }

  /** §5.5 #17-47 — 구독 경로 실행이 한도 통지를 받았다. 경로 판정이 바뀌므로 화면도 다시 그린다. */
  noteSubscriptionLimit(stop: UsageLimitStop): void {
    if (this.lastLimitHit && this.lastLimitHit.at >= stop.at) return;
    this.lastLimitHit = stop;
    if (this.isEnabled()) this.notifySoon();
  }

  // ─── 크레딧 실행 ────────────────────────────────────────────────────

  /** 크레딧 경로 실행 하나가 섰다. 돌려준 id 로 줄·끝을 신고한다(금액은 세지 않는다 — 공급자가 센다). */
  beginRun(subId: string, cmdId: string): string {
    this.boot();
    const now = Date.now();
    const id = `credit-${now.toString(36)}-${(++this.runSeq).toString(36)}`;
    this.live.set(id, { id, subId, cmdId, startedAt: now });
    this.notifyNow();
    logger.info(`${this.spec.tag} run ${id} started sub=${subId} cmd=${cmdId}`);
    return id;
  }

  isLive(runId: string): boolean { return this.live.has(runId); }

  /** stream-json 한 줄 — 실패를 말한 result 줄이면 그 본문에서 공급자의 거절을 읽는다. */
  noteRunLine(runId: string, obj: unknown): void {
    if (!this.live.has(runId)) return;
    const text = readResultError(obj);
    if (text) this.noteFailureText(runId, text);
  }

  /**
   * 실패 문장(결과 본문·stderr 꼬리·코덱스 턴 오류)에서 공급자의 거절(잔액 부족·지출 한도·키 거부)을 읽어 기억한다.
   * 모르는 실패는 무시한다 — 넘겨짚어 크레딧을 막지 않는다.
   */
  noteFailureText(runId: string, text: string | undefined): void {
    const refusal = this.spec.detectRefusal(text, Date.now());
    if (!refusal) return;
    const run = this.live.get(runId);
    if (run?.refusal?.reason === refusal.reason) return; // 같은 거절이 결과 본문과 stderr 로 두 번 온다
    if (run) run.refusal = refusal;
    if (refusal.reason === 'key-invalid' && this.key) this.key = { ...this.key, verified: 'rejected', verifiedAt: Date.now() };
    this.block = refusal;
    this.persist();
    this.notifyNow();
    logger.warn(`${this.spec.tag} ${this.spec.name} refused credits: ${refusal.reason}${refusal.until ? ` (credits tried again ${new Date(refusal.until).toISOString()})` : ''}${refusal.detail ? ` — ${refusal.detail.slice(0, 160)}` : ''}`);
  }

  /** 실행이 끝났다(정상·실패·중지·크래시 무엇이든). 공급자가 거절했으면 그 사유를 돌려준다. */
  endRun(runId: string): ApiCreditRunEnd | undefined {
    const run = this.live.get(runId);
    if (!run) return undefined;
    this.live.delete(runId);
    this.notifyNow();
    this.scheduleConsoleRefreshAfterRun();
    logger.info(`${this.spec.tag} run ${run.id} ended sub=${run.subId}${run.refusal ? ` — refused by ${this.spec.name} (${run.refusal.reason})` : ''}`);
    return run.refusal ? { refusal: run.refusal } : {};
  }

  /** 시험 전용 — 싱글턴 상태를 비운다. */
  _resetForTest(): void {
    this.booted = false;
    this.savedSettings = {};
    this.key = undefined;
    this.adminKey = undefined;
    this.block = undefined;
    this.live.clear();
    this.lastLimitHit = undefined;
    this.keyUnreadable = false;
    this.adminKeyUnreadable = false;
    this.verifying = null;
    this.consoleState = { status: 'no-key', refreshing: false, monthStart: 0 };
    this.consoleInflight = null;
    this.consoleLastAttemptAt = 0;
    if (this.afterRunTimer) { clearTimeout(this.afterRunTimer); this.afterRunTimer = null; }
    if (this.notifyTimer) { clearTimeout(this.notifyTimer); this.notifyTimer = null; }
  }
}

/** Claude 판 — Console 조직 크레딧(`cost_report` · 관리자 키 `sk-ant-admin01-…`). */
const ANTHROPIC_SPEC: CreditVendorSpec = {
  vendor: 'anthropic',
  tag: '[api-credit]',
  name: 'Anthropic',
  // 저장 손은 부를 때 찾는다 — 모듈을 읽는 순간 잡으면 AppState 를 일부만 흉내 낸 시험이 깨진다.
  load: () => appStateGetApiCredits(),
  save: (next) => appStateSetApiCredits(next),
  headers: (key) => ({ 'x-api-key': key, 'anthropic-version': API_CREDIT_ANTHROPIC_VERSION, 'user-agent': API_CREDIT_USER_AGENT }),
  verifyUrl: API_CREDIT_VERIFY_URL,
  checkRunKey: checkApiKeyShape,
  checkAdminKey: checkAdminKeyShape,
  maxCostPages: API_CREDIT_COST_REPORT_MAX_PAGES,
  costUrl: costReportUrl,
  parseCost: (body) => {
    const parsed = parseCostReport(body);
    return parsed ? { amount: parsed.cents, hasMore: parsed.hasMore, ...(parsed.nextPage ? { nextPage: parsed.nextPage } : {}) } : null;
  },
  amountToUsd: centsToUsd,
  orgUrl: API_CREDIT_ORG_URL,
  readError: readAnthropicErrorMessage,
  detectRefusal: detectConsoleRefusal,
  closedProvider: (apiProvider) => claudeCloudProviderOf(process.env, apiProvider),
  providerField: 'cloudProvider',
};

/** OpenAI 판 — Platform 조직 크레딧(Costs API · 관리자 키 `sk-admin-…`). 조직 이름은 공개 주소가 없어 읽지 않는다. */
const OPENAI_SPEC: CreditVendorSpec = {
  vendor: 'openai',
  tag: '[openai-credit]',
  name: 'OpenAI',
  load: () => appStateGetOpenaiCredits(),
  save: (next) => appStateSetOpenaiCredits(next),
  headers: (key) => ({ authorization: `Bearer ${key}`, 'user-agent': API_CREDIT_USER_AGENT }),
  verifyUrl: OPENAI_CREDIT_VERIFY_URL,
  checkRunKey: checkOpenAiKeyShape,
  checkAdminKey: checkOpenAiAdminKeyShape,
  maxCostPages: OPENAI_CREDIT_COSTS_MAX_PAGES,
  costUrl: openaiCostsUrl,
  parseCost: (body) => {
    const parsed = parseOpenAiCosts(body);
    return parsed ? { amount: parsed.usd, hasMore: parsed.hasMore, ...(parsed.nextPage ? { nextPage: parsed.nextPage } : {}) } : null;
  },
  amountToUsd: (usd) => Math.round(usd * 1_000_000) / 1_000_000,
  readError: readOpenAiErrorMessage,
  detectRefusal: detectOpenAiRefusal,
  closedProvider: (modelProvider) => {
    const id = (modelProvider ?? '').trim();
    return id && id !== 'openai' ? id : null;
  },
  providerField: 'customProvider',
};

export const apiCreditService = new ApiCreditService(ANTHROPIC_SPEC);
export const openaiCreditService = new ApiCreditService(OPENAI_SPEC);

/** 엔진의 크레딧 서비스 — 코덱스는 OpenAI 판, 나머지(Claude)는 Console 판. */
export function creditServiceFor(vendor: ApiCreditVendor): ApiCreditService {
  return vendor === 'openai' ? openaiCreditService : apiCreditService;
}

/** Claude 판 — `ANTHROPIC_API_KEY` 하나만 남기거나 걷는다(`withOnlyEnvKey`). */
export function withCreditKeyEnv(env: NodeJS.ProcessEnv, platform: PlatformName, keep?: string): NodeJS.ProcessEnv {
  return withOnlyEnvKey(env, 'ANTHROPIC_API_KEY', platform, keep);
}

/** 데스크톱 main 이 부른다 — 키를 OS 보안 저장소로 감싸는 손. 두 판이 같은 금고를 쓴다. */
export function setApiCreditCipher(cipher: ApiCreditCipher | null): void {
  apiCreditService.setCipher(cipher);
  openaiCreditService.setCipher(cipher);
}
