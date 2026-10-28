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
  centsToUsd,
  checkAdminKeyShape,
  checkApiKeyShape,
  claudeCloudProviderOf,
  classifyConsoleHttpError,
  costReportUrl,
  decideCreditRoute,
  detectConsoleRefusal,
  isConsoleBlockActive,
  isSubscriptionExhausted,
  maskApiKey,
  normalizeApiCreditSettings,
  parseCostReport,
  readAnthropicErrorMessage,
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
  type ApiKeyShapeProblem,
  type ClaudeUsageLimit,
  type PlatformName,
  type SubscriptionState,
  type UsageLimitStop,
} from '@vibisual/shared';
import { appStateGetApiCredits, appStateSetApiCredits } from './appState.js';
import { logger } from '../logger.js';

/**
 * §4 API 크레딧 — 구독 한도가 막히면 Console 크레딧으로 잇는다: 경로 결정(`decide`, 판정은 shared) · Console 지출 읽기(`refreshConsole`, 메모리만) ·
 * Anthropic 거절(잔액·월 한도·키) 기억 → 새 실행을 구독으로 · 두 키를 OS 보안 저장소로 감싸기.
 * 금액을 세거나 막지 마라 — 앱이 센 숫자는 Console 과 어긋나 남은 크레딧을 막는다. 값의 원천(구독 한도 표·`claude auth status`)은 주입받는다(순환 방지).
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
  /** 이 실행을 Anthropic 이 거절했으면 그 사유. */
  refusal?: ApiCreditConsoleBlock;
}

export interface ApiCreditRunEnd {
  /** Anthropic 이 이 실행을 거절했으면 그 사유(잔액 부족·지출 한도·키 거부). */
  refusal?: ApiCreditConsoleBlock;
}

type KeySlot = 'run' | 'admin';

type JsonResponse = { ok: boolean; status: number; body: unknown } | { networkError: string };

/** 키 하나로 공식 엔드포인트를 GET 한다. 시간이 지나면 끊는다. */
async function getJson(url: string, key: string, timeoutMs: number): Promise<JsonResponse> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': key, 'anthropic-version': API_CREDIT_ANTHROPIC_VERSION, 'user-agent': API_CREDIT_USER_AGENT },
      signal: ctl.signal,
    });
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

class ApiCreditService {
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

  /** Console 이번 달 지출 — 읽어 온 값 그대로, 메모리만(앱 장부 ❌). */
  private consoleState: ApiCreditConsoleSpend = { status: 'no-key', refreshing: false, monthStart: 0 };
  private consoleInflight: Promise<void> | null = null;
  private consoleLastAttemptAt = 0;
  private afterRunTimer: NodeJS.Timeout | null = null;

  private cipher: ApiCreditCipher | null = null;
  private subscriptionSource: () => SubscriptionSource = () => ({});
  /** `claude auth status` 의 `apiProvider` — 클라우드 제공자로 도는 PC 인지의 한 근거. */
  private providerSource: () => string | undefined = () => undefined;
  private changeListener: (() => void) | null = null;
  private notifyTimer: NodeJS.Timeout | null = null;

  // ─── 주입 ───────────────────────────────────────────────────────────

  setCipher(cipher: ApiCreditCipher | null): void { this.cipher = cipher; }
  setSubscriptionSource(fn: () => SubscriptionSource): void { this.subscriptionSource = fn; }
  setProviderSource(fn: () => string | undefined): void { this.providerSource = fn; }
  setChangeListener(fn: (() => void) | null): void { this.changeListener = fn; }

  /** 이 PC 의 Claude Code 가 클라우드 제공자로 도는가(그러면 크레딧 키를 실어도 청구는 클라우드로 간다). */
  cloudProvider(): ReturnType<typeof claudeCloudProviderOf> {
    return claudeCloudProviderOf(process.env, this.providerSource());
  }

  // ─── 저장 ───────────────────────────────────────────────────────────

  /** 첫 사용 때 한 번 디스크에서 읽는다. 옛 판의 금액 칸·장부는 정규화가 이미 떨어뜨렸다. */
  private boot(): void {
    if (this.booted) return;
    this.booted = true;
    const saved = appStateGetApiCredits();
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
    appStateSetApiCredits(next);
  }

  private notifyNow(): void {
    if (this.notifyTimer) { clearTimeout(this.notifyTimer); this.notifyTimer = null; }
    try { this.changeListener?.(); } catch (err) {
      logger.warn(`[api-credit] change listener failed: ${err instanceof Error ? err.message : String(err)}`);
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
        logger.warn(`[api-credit] stored ${slot === 'run' ? 'API' : 'admin'} key could not be decrypted on this machine (${err instanceof Error ? err.message : String(err)}) — enter it again`);
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

  /** 아직 유효한 Anthropic 거절. 시도 시각이 지났으면 걷는다 — 거절된 요청은 과금되지 않아 다시 물어도 된다. */
  private activeBlock(now: number): ApiCreditConsoleBlock | undefined {
    if (!this.block) return undefined;
    if (isConsoleBlockActive(this.block, now)) return this.block;
    logger.info(`[api-credit] Anthropic refusal (${this.block.reason}) is past its retry time — credits are tried again`);
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
    const cloud = this.cloudProvider();
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
      ...(cloud ? { cloudProvider: cloud } : {}),
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
    const problem = checkApiKeyShape(raw);
    if (problem) return { problem, state: this.getState() };
    let record: ApiCreditKeyRecord;
    try {
      record = this.wrap(raw.trim());
    } catch (err) {
      // 감싸기가 실패했다고 원문으로 떨어뜨리지 않는다 — 사용자는 감싸 둔 줄로 안다.
      logger.warn(`[api-credit] key encryption failed: ${err instanceof Error ? err.message : String(err)}`);
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
    logger.info(`[api-credit] key saved (${record.hint}, ${record.scheme === 'os' ? 'OS-protected' : 'unprotected'})`);
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
    logger.info('[api-credit] key removed');
    return this.getState();
  }

  /**
   * 실행용 키 확인 — 공개 `GET /v1/models`(과금 없음). 200 이면 ok, 401·403 이면 거부(Anthropic 거절 `key-invalid` 로
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
        const res = await fetch(API_CREDIT_VERIFY_URL, {
          method: 'GET',
          headers: { 'x-api-key': key, 'anthropic-version': API_CREDIT_ANTHROPIC_VERSION, 'user-agent': API_CREDIT_USER_AGENT },
          signal: ctl.signal,
        });
        verdict = res.ok ? 'ok' : (res.status === 401 || res.status === 403) ? 'rejected' : 'unknown';
        if (verdict === 'unknown') logger.warn(`[api-credit] key check returned HTTP ${res.status} — leaving it as unknown`);
      } catch (err) {
        logger.warn(`[api-credit] key check failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        clearTimeout(timer);
      }
      // 그 사이 키가 바뀌었으면 옛 키의 판정을 새 키에 붙이지 않는다.
      if (this.key && this.key.hint === hint) {
        this.key = { ...this.key, verified: verdict, verifiedAt: Date.now() };
        if (verdict === 'rejected') {
          this.block = { reason: 'key-invalid', at: Date.now(), detail: 'GET /v1/models → 401/403' };
          logger.warn('[api-credit] Anthropic rejected the API key — new runs use the subscription until the key changes');
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

  /** 지출 읽기용 키 저장(관리자 키 `sk-ant-admin01-…` 가 정석, 워크스페이스에 안 묶인 개인 키도 받는다). 저장 즉시 이번 달 지출을 읽는다 — 그 읽기가 곧 확인이다. */
  setAdminKey(raw: string): { problem?: ApiKeyShapeProblem; state: ApiCreditState } {
    this.boot();
    const problem = checkAdminKeyShape(raw);
    if (problem) return { problem, state: this.getState() };
    let record: ApiCreditKeyRecord;
    try {
      record = this.wrap(raw.trim());
    } catch (err) {
      logger.warn(`[api-credit] admin key encryption failed: ${err instanceof Error ? err.message : String(err)}`);
      return { problem: 'empty', state: this.getState() };
    }
    this.adminKey = record;
    this.adminKeyUnreadable = false;
    this.consoleState = { status: 'pending', refreshing: false, monthStart: utcMonthStart(Date.now()) };
    this.consoleLastAttemptAt = 0;
    this.persist();
    this.notifyNow();
    logger.info(`[api-credit] admin key saved (${record.hint}, ${record.scheme === 'os' ? 'OS-protected' : 'unprotected'})`);
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
    logger.info('[api-credit] admin key removed');
    return this.getState();
  }

  /** [다시 시도] — Anthropic 거절 기억을 지금 걷는다(Console 에서 충전·한도를 바꾼 뒤). 다음 실행이 다시 크레딧을 묻는다. */
  clearBlock(): ApiCreditState {
    this.boot();
    if (this.block) {
      logger.info(`[api-credit] Anthropic refusal (${this.block.reason}) cleared by user — credits are tried again`);
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

  // ─── Console 이번 달 지출 ────────────────────────────────────────────

  /**
   * Console 지출을 공식 `cost_report` 로 읽는다(UTC 달력 월 — 지출 한도가 초기화되는 달). 읽는 중이면 함께 기다리고, `force` 가 아니면 `maxAgeMs`(기본 1분 — 공식 권장 빈도) 안엔
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
    this.consoleState = { ...this.consoleState, refreshing: true };
    this.notifySoon();
    const run = async (): Promise<void> => {
      const monthStart = utcMonthStart(now);
      const monthEnd = utcNextMonthStart(now);
      let cents = 0;
      let page: string | undefined;
      let failure: ApiCreditConsoleSpend['error'];
      for (let i = 0; i < API_CREDIT_COST_REPORT_MAX_PAGES; i++) {
        const res = await getJson(costReportUrl(monthStart, monthEnd, page), key, API_CREDIT_CONSOLE_TIMEOUT_MS);
        if ('networkError' in res) { failure = { kind: 'network', message: res.networkError.slice(0, 300) }; break; }
        if (!res.ok) {
          const message = readAnthropicErrorMessage(res.body);
          failure = { kind: classifyConsoleHttpError(res.status), status: res.status, ...(message ? { message } : {}) };
          break;
        }
        const parsed = parseCostReport(res.body);
        if (!parsed) { failure = { kind: 'other', status: res.status }; break; }
        cents += parsed.cents;
        if (!parsed.hasMore) break;
        page = parsed.nextPage;
      }
      // 그 사이 키가 바뀌었거나 지워졌으면 옛 키의 결과를 새 상태에 붙이지 않는다.
      if (this.adminKey !== owner) return;
      const prev = this.consoleState;
      let orgName = prev.orgName;
      if (!failure && orgName === undefined) {
        const org = await getJson(API_CREDIT_ORG_URL, key, API_CREDIT_CONSOLE_TIMEOUT_MS);
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
        logger.warn(`[api-credit] Console spend read failed: ${failure.kind}${failure.status ? ` HTTP ${failure.status}` : ''}${failure.message ? ` — ${failure.message.slice(0, 160)}` : ''}`);
      } else {
        this.consoleState = {
          status: 'ok',
          refreshing: false,
          monthStart,
          spendUsd: centsToUsd(cents),
          fetchedAt: Date.now(),
          ...(orgName ? { orgName } : {}),
        };
        this.markAdminVerdict('ok');
      }
      this.notifyNow();
    };
    this.consoleInflight = run()
      .catch((err) => { logger.warn(`[api-credit] Console spend read crashed: ${err instanceof Error ? err.message : String(err)}`); })
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

  /** 크레딧 경로 실행 하나가 섰다. 돌려준 id 로 줄·끝을 신고한다(금액은 세지 않는다 — Console 이 센다). */
  beginRun(subId: string, cmdId: string): string {
    this.boot();
    const now = Date.now();
    const id = `credit-${now.toString(36)}-${(++this.runSeq).toString(36)}`;
    this.live.set(id, { id, subId, cmdId, startedAt: now });
    this.notifyNow();
    logger.info(`[api-credit] run ${id} started sub=${subId} cmd=${cmdId}`);
    return id;
  }

  isLive(runId: string): boolean { return this.live.has(runId); }

  /** stream-json 한 줄 — 실패를 말한 result 줄이면 그 본문에서 Anthropic 의 거절을 읽는다. */
  noteRunLine(runId: string, obj: unknown): void {
    if (!this.live.has(runId)) return;
    const text = readResultError(obj);
    if (text) this.noteFailureText(runId, text);
  }

  /**
   * 실패 문장(결과 본문·stderr 꼬리)에서 Anthropic 의 거절(잔액 부족·지출 한도·키 거부)을 읽어 기억한다.
   * 모르는 실패는 무시한다 — 넘겨짚어 크레딧을 막지 않는다.
   */
  noteFailureText(runId: string, text: string | undefined): void {
    const refusal = detectConsoleRefusal(text, Date.now());
    if (!refusal) return;
    const run = this.live.get(runId);
    if (run?.refusal?.reason === refusal.reason) return; // 같은 거절이 결과 본문과 stderr 로 두 번 온다
    if (run) run.refusal = refusal;
    if (refusal.reason === 'key-invalid' && this.key) this.key = { ...this.key, verified: 'rejected', verifiedAt: Date.now() };
    this.block = refusal;
    this.persist();
    this.notifyNow();
    logger.warn(`[api-credit] Anthropic refused credits: ${refusal.reason}${refusal.until ? ` (credits tried again ${new Date(refusal.until).toISOString()})` : ''}${refusal.detail ? ` — ${refusal.detail.slice(0, 160)}` : ''}`);
  }

  /** 실행이 끝났다(정상·실패·중지·크래시 무엇이든). Anthropic 이 거절했으면 그 사유를 돌려준다. */
  endRun(runId: string): ApiCreditRunEnd | undefined {
    const run = this.live.get(runId);
    if (!run) return undefined;
    this.live.delete(runId);
    this.notifyNow();
    this.scheduleConsoleRefreshAfterRun();
    logger.info(`[api-credit] run ${run.id} ended sub=${run.subId}${run.refusal ? ` — refused by Anthropic (${run.refusal.reason})` : ''}`);
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

export const apiCreditService = new ApiCreditService();

/**
 * 스폰 env 에서 `ANTHROPIC_API_KEY` 를 걷는다(`keep` 이면 그 값만 정확한 이름으로). Windows 는 env 이름의 대소문자를 안 가려 `{ ...process.env }` 의
 * `anthropic_api_key` 도 자식이 같은 변수로 읽는다 — 정확한 이름만 지우면 구독 스폰이 몰래 키를 쓴다. mac·linux 는 정확한 이름만. 플랫폼은 인자로.
 */
export function withCreditKeyEnv(env: NodeJS.ProcessEnv, platform: PlatformName, keep?: string): NodeJS.ProcessEnv {
  const name = 'ANTHROPIC_API_KEY';
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    const same = platform === 'win32' ? k.toUpperCase() === name : k === name;
    if (!same) out[k] = v;
  }
  if (keep !== undefined) out[name] = keep;
  return out;
}

/** 데스크톱 main 이 부른다 — 키를 OS 보안 저장소로 감싸는 손. */
export function setApiCreditCipher(cipher: ApiCreditCipher | null): void {
  apiCreditService.setCipher(cipher);
}
