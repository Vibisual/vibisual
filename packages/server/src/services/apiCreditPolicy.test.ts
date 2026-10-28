/**
 * §4 API 크레딧 — shared `apiCredit.ts` 판정: 경로 판정에 금액이 없다(한도·잔액은 Anthropic 이 거절하고 앱은 그 거절만 따른다) ·
 * 거절 문구로 다시 시도할 때를 정한다 · Console 지출은 `cost_report` 를 UTC 달력 월로 합한다(센트 문자열) · 옛 금액 칸·장부는 버린다.
 * 시각은 인자로 넘긴다 — 함수가 `Date.now()` 를 읽으면 이 시험이 성립하지 않는다.
 */
import { describe, it, expect } from 'vitest';
import {
  API_CREDIT_BALANCE_RECHECK_MS,
  API_CREDIT_DEFAULTS,
  API_CREDIT_UNKNOWN_RESET_HOLD_MS,
  centsToUsd,
  checkAdminKeyShape,
  checkApiKeyShape,
  classifyConsoleHttpError,
  costReportUrl,
  decideCreditRoute,
  detectConsoleRefusal,
  isConsoleBlockActive,
  isSubscriptionExhausted,
  maskApiKey,
  normalizeApiCreditPersisted,
  normalizeApiCreditSettings,
  parseCostReport,
  readAnthropicErrorMessage,
  readRegainAccessAt,
  readResultError,
  utcMonthStart,
  utcNextMonthStart,
  type ApiCreditSettings,
  type ClaudeUsageLimit,
} from '@vibisual/shared';

const NOW = Date.UTC(2026, 9, 27, 3, 0, 0); // 2026-10-27 03:00 UTC
const on = (patch: Partial<ApiCreditSettings> = {}): ApiCreditSettings =>
  normalizeApiCreditSettings({ ...API_CREDIT_DEFAULTS, enabled: true, ...patch });
const limit = (patch: Partial<ClaudeUsageLimit>): ClaudeUsageLimit => ({
  kind: 'session', group: 'session', percent: 10, severity: 'normal', isActive: true, ...patch,
});

describe('설정 정규화 — 금액 칸은 없다', () => {
  it('없거나 깨진 값은 기본값(꺼짐·구독 먼저·자동 이어가기 켬)이다', () => {
    expect(normalizeApiCreditSettings(undefined)).toEqual(API_CREDIT_DEFAULTS);
    expect(normalizeApiCreditSettings({ mode: 'weird', enabled: 1 })).toEqual(API_CREDIT_DEFAULTS);
  });

  it('옛 판의 한도·여유·장부·도는 실행 추정은 읽을 때 떨어진다 — 키와 켬은 남는다', () => {
    const old = {
      settings: { enabled: true, capUsd: 400, safetyMarginUsd: 0.5 },
      ledger: { spentUsd: 123.45, since: 1, runs: 20, lock: { reason: 'cap-reached', at: 1 } },
      pending: { 'credit-x': { estimateUsd: 1.79, startedAt: 1 } },
      key: { scheme: 'os', data: 'enc', hint: '…TEST', savedAt: 1, verified: 'ok' },
    };
    expect(normalizeApiCreditPersisted(old, NOW)).toEqual({
      settings: { enabled: true },
      key: { scheme: 'os', data: 'enc', hint: '…TEST', savedAt: 1, verified: 'ok' },
    });
  });

  it('관리자 키와 Anthropic 거절 기억은 남고, 모르는 거절 사유는 버린다', () => {
    const p = normalizeApiCreditPersisted({
      adminKey: { scheme: 'plain', data: 'sk-ant-admin01-x', hint: '…XXXX', savedAt: 2 },
      block: { reason: 'spend-limit', at: 5, until: 9, detail: 'You have reached your specified API usage limits.' },
    }, NOW);
    expect(p?.adminKey?.hint).toBe('…XXXX');
    expect(p?.block).toEqual({ reason: 'spend-limit', at: 5, until: 9, detail: 'You have reached your specified API usage limits.' });
    expect(normalizeApiCreditPersisted({ block: { reason: 'cap-reached', at: 1 } }, NOW)).toEqual({});
  });
});

describe('decideCreditRoute — 금액 판정 없이 경로만', () => {
  const base = { hasKey: true, subscriptionExhausted: false };

  it('기본은 구독 먼저 — 구독이 살아 있으면 구독, 막히면 크레딧', () => {
    expect(decideCreditRoute({ ...base, settings: on() }, NOW)).toEqual({ route: 'subscription', reason: 'subscription-ok' });
    expect(decideCreditRoute({ ...base, settings: on(), subscriptionExhausted: true }, NOW))
      .toEqual({ route: 'credits', reason: 'subscription-exhausted' });
  });

  it('크레딧 먼저 옵션이면 구독이 살아 있어도 크레딧', () => {
    expect(decideCreditRoute({ ...base, settings: on({ mode: 'credits-first' }) }, NOW)).toEqual({ route: 'credits', reason: 'credits-first' });
  });

  it('꺼짐·키 없음·클라우드 제공자는 구독(실행을 막지 않는다)', () => {
    expect(decideCreditRoute({ ...base, settings: on({ enabled: false }), subscriptionExhausted: true }, NOW).reason).toBe('off');
    expect(decideCreditRoute({ ...base, hasKey: false, settings: on(), subscriptionExhausted: true }, NOW).reason).toBe('no-key');
    expect(decideCreditRoute({ ...base, settings: on(), subscriptionExhausted: true, cloudProvider: 'bedrock' }, NOW))
      .toEqual({ route: 'subscription', reason: 'cloud-provider' });
  });

  it('Anthropic 이 막 거절했으면 다시 시도할 때까지 구독 — 그때가 지나면 다시 크레딧', () => {
    const block = { reason: 'balance-empty' as const, at: NOW, until: NOW + 60_000 };
    const input = { ...base, settings: on({ mode: 'credits-first' }), block };
    expect(decideCreditRoute(input, NOW)).toEqual({ route: 'subscription', reason: 'blocked' });
    expect(decideCreditRoute(input, NOW + 60_000)).toEqual({ route: 'credits', reason: 'credits-first' });
  });

  it('재개 시각이 없는 거절(키 거부)은 키가 바뀔 때까지 유효하다', () => {
    expect(isConsoleBlockActive({ reason: 'key-invalid', at: NOW }, NOW + 365 * 86_400_000)).toBe(true);
    expect(isConsoleBlockActive(undefined, NOW)).toBe(false);
  });
});

describe('isSubscriptionExhausted', () => {
  it('세션 한도 100% + 리셋 전 = 막힘, 리셋이 지났으면 풀림', () => {
    expect(isSubscriptionExhausted({ limits: [limit({ percent: 100, resetsAt: NOW + 1000 })] }, NOW))
      .toEqual({ exhausted: true, resetsAt: NOW + 1000 });
    expect(isSubscriptionExhausted({ limits: [limit({ percent: 100, resetsAt: NOW - 1 })] }, NOW).exhausted).toBe(false);
  });
  it('모델별 주간 한도 100% 는 구독 전체가 막힌 것이 아니다', () => {
    const scoped = limit({ kind: 'weekly_scoped', group: 'weekly', percent: 100, scopeLabel: 'Opus', resetsAt: NOW + 1000 });
    expect(isSubscriptionExhausted({ limits: [scoped] }, NOW).exhausted).toBe(false);
  });
  it('한도 통지는 리셋 시각 전까지 막힘', () => {
    const hit = { kind: 'session' as const, at: NOW - 1000, resetsAt: NOW + 60_000 };
    expect(isSubscriptionExhausted({ lastLimitHit: hit }, NOW)).toEqual({ exhausted: true, resetsAt: NOW + 60_000 });
    expect(isSubscriptionExhausted({ lastLimitHit: hit }, NOW + 61_000).exhausted).toBe(false);
  });
  it('리셋 시각을 모르는 통지 — 더 새로운 /usage 가 100% 미만이면 풀리고, 아니면 보류 시간까지 막힘', () => {
    const hit = { kind: 'usage' as const, at: NOW - 1000 };
    expect(isSubscriptionExhausted({ lastLimitHit: hit }, NOW).exhausted).toBe(true);
    expect(isSubscriptionExhausted({ lastLimitHit: hit, limits: [limit({ percent: 20 })], fetchedAt: NOW - 10 }, NOW).exhausted).toBe(false);
    // probe 가 통지보다 **옛것**이면 풀어 주지 않는다.
    expect(isSubscriptionExhausted({ lastLimitHit: hit, limits: [limit({ percent: 20 })], fetchedAt: NOW - 5000 }, NOW).exhausted).toBe(true);
    expect(isSubscriptionExhausted({ lastLimitHit: hit }, hit.at + API_CREDIT_UNKNOWN_RESET_HOLD_MS + 1).exhausted).toBe(false);
  });
});

describe('detectConsoleRefusal — Anthropic 의 거절 문구(공식 문서 원문)', () => {
  it('잔액 부족(API·CLI 두 문구) — 재개 시각을 말하지 않으니 1시간 뒤 다시 시도', () => {
    for (const text of [
      'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}',
      'Credit balance too low · Add funds: https://platform.claude.com/settings/billing',
    ]) {
      const b = detectConsoleRefusal(text, NOW);
      expect(b?.reason).toBe('balance-empty');
      expect(b?.until).toBe(NOW + API_CREDIT_BALANCE_RECHECK_MS);
    }
    // JSON 오류 본문이면 사람이 읽을 문장만 남긴다.
    expect(detectConsoleRefusal('API Error: 400 {"error":{"message":"Your credit balance is too low to access the Anthropic API."}}', NOW)?.detail)
      .toBe('Your credit balance is too low to access the Anthropic API.');
  });

  it('등급 상한(429 enforced_spend_limit_reached) — 문구의 재개 시각까지', () => {
    const text = '{"type":"error","error":{"type":"rate_limit_error","message":"You have reached your API usage limits: your organization has crossed its monthly API usage threshold, set based on your organization\'s API tier. You will regain access on 2026-11-01 at 00:00 UTC.","details":{"error_code":"enforced_spend_limit_reached"}}}';
    const b = detectConsoleRefusal(text, NOW);
    expect(b?.reason).toBe('spend-limit');
    expect(b?.until).toBe(Date.UTC(2026, 10, 1));
  });

  it('사용자가 정한 한도(400 · 조직·워크스페이스) — 재개 시각이 없으면 다음 달 1일 00:00 UTC', () => {
    for (const text of ['You have reached your specified API usage limits.', 'You have reached your specified workspace API usage limits.']) {
      const b = detectConsoleRefusal(text, NOW);
      expect(b?.reason).toBe('spend-limit');
      expect(b?.until).toBe(Date.UTC(2026, 10, 1));
    }
  });

  it('키 거부는 재개 시각 없이 · 모르는 실패는 null(넘겨짚어 막지 않는다)', () => {
    const k = detectConsoleRefusal('API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}', NOW);
    expect(k?.reason).toBe('key-invalid');
    expect(k?.until).toBeUndefined();
    expect(detectConsoleRefusal('Overloaded', NOW)).toBeNull();
    expect(detectConsoleRefusal(undefined, NOW)).toBeNull();
  });

  it('재개 시각 읽기 — 시각이 없으면 그날 00:00 UTC', () => {
    expect(readRegainAccessAt('You will regain access on 2026-09-01 at 13:30 UTC.')).toBe(Date.UTC(2026, 8, 1, 13, 30));
    expect(readRegainAccessAt('You will regain access on 2026-09-01.')).toBe(Date.UTC(2026, 8, 1));
    expect(readRegainAccessAt('nothing here')).toBeUndefined();
  });

  it('result 줄의 실패 본문만 읽는다', () => {
    expect(readResultError({ type: 'result', is_error: true, result: 'Credit balance too low' })).toBe('Credit balance too low');
    expect(readResultError({ type: 'result', is_error: true, subtype: 'error_during_execution' })).toBe('error_during_execution');
    expect(readResultError({ type: 'result', is_error: false, result: 'ok' })).toBeUndefined();
    expect(readResultError({ type: 'assistant' })).toBeUndefined();
  });
});

describe('Console 이번 달 지출 — 공식 cost_report', () => {
  it('달은 UTC 달력 월 — 한국 시각 11월 1일 새벽도 UTC 로는 아직 10월이다', () => {
    const kstNov1Dawn = Date.UTC(2026, 9, 31, 20, 0); // 2026-11-01 05:00 KST
    expect(utcMonthStart(kstNov1Dawn)).toBe(Date.UTC(2026, 9, 1));
    expect(utcNextMonthStart(kstNov1Dawn)).toBe(Date.UTC(2026, 10, 1));
    expect(utcNextMonthStart(Date.UTC(2026, 11, 15))).toBe(Date.UTC(2027, 0, 1));
  });

  it('주소 — 끝은 다음 달 1일(오늘 버킷이 빠지지 않게) · 일 단위 · 31 버킷 · 다음 쪽', () => {
    const url = new URL(costReportUrl(utcMonthStart(NOW), utcNextMonthStart(NOW)));
    expect(url.origin + url.pathname).toBe('https://api.anthropic.com/v1/organizations/cost_report');
    expect(url.searchParams.get('starting_at')).toBe('2026-10-01T00:00:00Z');
    expect(url.searchParams.get('ending_at')).toBe('2026-11-01T00:00:00Z');
    expect(url.searchParams.get('bucket_width')).toBe('1d');
    expect(url.searchParams.get('limit')).toBe('31');
    expect(new URL(costReportUrl(1, 2, 'page_abc')).searchParams.get('page')).toBe('page_abc');
  });

  it('합산 — amount 는 센트 소수 문자열 · 빈 버킷은 0 · USD 가 아니면 더하지 않는다', () => {
    const body = {
      data: [
        { starting_at: '2026-10-25T00:00:00Z', ending_at: '2026-10-26T00:00:00Z', results: [] },
        { starting_at: '2026-10-26T00:00:00Z', ending_at: '2026-10-27T00:00:00Z', results: [{ amount: '6000.5', currency: 'USD' }] },
        { starting_at: '2026-10-27T00:00:00Z', ending_at: '2026-10-28T00:00:00Z', results: [{ amount: '1499.5', currency: 'USD' }, { amount: '999', currency: 'EUR' }] },
      ],
      has_more: false,
      next_page: null,
    };
    const parsed = parseCostReport(body);
    expect(parsed).toEqual({ cents: 7500, hasMore: false });
    expect(centsToUsd(parsed!.cents)).toBe(75);
  });

  it('다음 쪽 표식 · 모양이 다르면 null', () => {
    expect(parseCostReport({ data: [], has_more: true, next_page: 'page_2' })).toEqual({ cents: 0, hasMore: true, nextPage: 'page_2' });
    expect(parseCostReport({ data: [], has_more: true, next_page: null })).toEqual({ cents: 0, hasMore: false });
    expect(parseCostReport({ nope: true })).toBeNull();
    expect(parseCostReport(null)).toBeNull();
  });

  it('HTTP 상태 → 사유 · Anthropic 오류 문장 읽기', () => {
    expect(classifyConsoleHttpError(401)).toBe('auth');
    expect(classifyConsoleHttpError(403)).toBe('forbidden');
    expect(classifyConsoleHttpError(404)).toBe('not-found');
    expect(classifyConsoleHttpError(429)).toBe('rate-limited');
    expect(classifyConsoleHttpError(500)).toBe('other');
    expect(readAnthropicErrorMessage({ type: 'error', error: { type: 'permission_error', message: 'The Admin API is unavailable for individual accounts.' } }))
      .toBe('The Admin API is unavailable for individual accounts.');
    expect(readAnthropicErrorMessage({})).toBeUndefined();
  });
});

describe('키 모양·가리기', () => {
  it('실행용 칸 — 관리자 키·OAuth 토큰·남의 키는 저장 전에 돌려보낸다', () => {
    expect(checkApiKeyShape('sk-ant-api03-abc')).toBeNull();
    expect(checkApiKeyShape('sk-ant-admin01-abc')).toBe('admin-key');
    expect(checkApiKeyShape('sk-ant-oat01-abc')).toBe('oauth-token');
    expect(checkApiKeyShape('sk-proj-abc')).toBe('not-anthropic');
    expect(checkApiKeyShape('  ')).toBe('empty');
    expect(checkApiKeyShape('sk-ant-api03 abc')).toBe('whitespace');
  });
  it('지출 읽기 칸 — 관리자 키가 정석, 워크스페이스에 묶이지 않은 개인 키도 받는다 · OAuth 토큰은 아니다', () => {
    expect(checkAdminKeyShape('sk-ant-admin01-abc')).toBeNull();
    expect(checkAdminKeyShape('sk-ant-api03-abc')).toBeNull();
    expect(checkAdminKeyShape('sk-ant-oat01-abc')).toBe('oauth-token');
    expect(checkAdminKeyShape('sk-proj-abc')).toBe('not-anthropic');
    expect(checkAdminKeyShape('sk-ant-admin01 abc')).toBe('whitespace');
  });
  it('끝 4자리만 남긴다', () => {
    expect(maskApiKey('sk-ant-api03-ABCDEFGHWXYZ')).toBe('…WXYZ'); // privacy-ok — 가림 테스트용 가짜 키
    expect(maskApiKey('short')).toBe('…');
  });
});

describe('withCreditKeyEnv — 스폰 env 의 키 이름(세 OS)', () => {
  it('Windows 는 대소문자가 다른 이름까지 걷는다 — 자식은 그것을 같은 변수로 읽는다', async () => {
    const { withCreditKeyEnv } = await import('./apiCreditService.js');
    const env = { PATH: 'x', ANTHROPIC_API_KEY: 'sk-ant-old', anthropic_api_key: 'sk-ant-lower' }; // privacy-ok — 가짜 키
    expect(withCreditKeyEnv(env, 'win32')).toEqual({ PATH: 'x' });
    expect(withCreditKeyEnv(env, 'win32', 'sk-ant-new')).toEqual({ PATH: 'x', ANTHROPIC_API_KEY: 'sk-ant-new' });
  });
  it('mac·linux 는 이름이 대소문자를 가리므로 정확한 이름만 본다', async () => {
    const { withCreditKeyEnv } = await import('./apiCreditService.js');
    const env = { PATH: 'x', ANTHROPIC_API_KEY: 'sk-ant-old', anthropic_api_key: 'other' };
    for (const platform of ['darwin', 'linux'] as const) {
      expect(withCreditKeyEnv(env, platform)).toEqual({ PATH: 'x', anthropic_api_key: 'other' });
      expect(withCreditKeyEnv(env, platform, 'sk-ant-new')).toEqual({ PATH: 'x', anthropic_api_key: 'other', ANTHROPIC_API_KEY: 'sk-ant-new' });
    }
  });
});

describe('클라우드 제공자로 도는 PC — 크레딧 경로를 열지 않는다', () => {
  it('apiProvider 나 env 가 클라우드면 그 이름, 아니면 null', async () => {
    const { claudeCloudProviderOf } = await import('@vibisual/shared');
    expect(claudeCloudProviderOf({}, 'firstParty')).toBeNull();
    expect(claudeCloudProviderOf({}, 'Bedrock')).toBe('bedrock');
    expect(claudeCloudProviderOf({ CLAUDE_CODE_USE_VERTEX: '1' })).toBe('vertex');
    expect(claudeCloudProviderOf({ CLAUDE_CODE_USE_FOUNDRY: 'true' })).toBe('foundry');
    expect(claudeCloudProviderOf({ CLAUDE_CODE_USE_BEDROCK: '0' })).toBeNull();
  });
});
