import { API_CREDIT_BALANCE_RECHECK_MS, creditFailureDetail, type ApiCreditConsoleBlock, type ApiKeyShapeProblem } from './apiCredit.js';
import type { ProviderUsageWindow } from './providerUsage.js';
import type { ClaudeUsageLimit, CodexEffectiveConfig } from './types.js';

/**
 * §4 OpenAI 비즈니스 크레딧 — 코덱스가 구독(ChatGPT 플랜) 한도에 막히면 OpenAI Platform 조직의 API 크레딧으로 잇는다.
 * 경로 판정·설정 모양은 Claude 판(`apiCredit.ts`)을 그대로 쓰고, 여기는 OpenAI 쪽 사실(주소·키 모양·거절 문구·코덱스 한도 표)만 둔다.
 * 판정만 한다(파일·네트워크·프로세스 ❌).
 */

/** 실행용 키 확인 — 공개 `GET /v1/models`(과금 없음). */
export const OPENAI_CREDIT_VERIFY_URL = 'https://api.openai.com/v1/models';
/** 이번 달 지출의 출처 — 공식 Costs API(관리자 키 전용). Platform 사용량 화면과 같은 자료이고 일 단위 버킷이다. */
export const OPENAI_CREDIT_COSTS_URL = 'https://api.openai.com/v1/organization/costs';
/** 크레딧 경로 코덱스 턴이 부르는 API 주소. */
export const OPENAI_CREDIT_API_BASE_URL = 'https://api.openai.com/v1';
/** 크레딧 경로에만 싣는 사용자 정의 제공자 id. 코덱스가 예약한 id(`openai` 등)는 덮을 수 없다(공식 고급 설정 문서). */
export const OPENAI_CREDIT_PROVIDER_ID = 'vibisual_openai_api';
/** 그 제공자가 키를 읽는 env 이름. 키 본문은 이 스폰의 env 에만 있다. */
export const OPENAI_CREDIT_KEY_ENV = 'VIBISUAL_OPENAI_API_KEY';
/** 한 달은 31 버킷 한 쪽에 들어간다. 다음 쪽이 와도 이만큼만 따라간다. */
export const OPENAI_CREDIT_COSTS_MAX_PAGES = 4;

const objOf = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);

/**
 * 크레딧 경로 코덱스 턴의 설정 덮어쓰기. `--config` 값은 TOML 이고 CLI 덮어쓰기가 모든 설정 겹보다 앞선다(공식 Config basics).
 * `account/login/start type=apiKey` 는 키를 코덱스가 저장해 ChatGPT 로그인을 덮고, `CODEX_API_KEY` 는 exec·review 전용이라 쓰지 않는다.
 */
export function openaiCreditConfigArgs(): string[] {
  const id = OPENAI_CREDIT_PROVIDER_ID;
  const q = (v: string): string => JSON.stringify(v);
  return [
    '-c', `model_provider=${q(id)}`,
    '-c', `model_providers.${id}.name=${q('OpenAI API')}`,
    '-c', `model_providers.${id}.base_url=${q(OPENAI_CREDIT_API_BASE_URL)}`,
    '-c', `model_providers.${id}.env_key=${q(OPENAI_CREDIT_KEY_ENV)}`,
    '-c', `model_providers.${id}.wire_api=${q('responses')}`,
  ];
}

/**
 * 코덱스가 쓸 모델 제공자가 기본(`openai`)이 아니면 그 id. 프로젝트 겹은 보지 않는다 — 코덱스는 프로젝트 설정의 제공자 키를
 * 무시한다(공식 고급 설정 문서). 가장 이기는 겹(프로필 → 사용자 → 시스템)의 값 하나만 본다.
 */
export function codexCustomModelProvider(config: Pick<CodexEffectiveConfig, 'layers'> | null | undefined): string | null {
  for (const layer of config?.layers ?? []) {
    if (layer.source === 'project') continue;
    const id = layer.values.modelProvider?.trim();
    if (!id) continue;
    return id === 'openai' ? null : id;
  }
  return null;
}

/**
 * 코덱스 사용량 창 → 구독 소진 판정이 읽는 한도 표. 플랜 전체를 막는 것은 `codex` 묶음뿐이다(다른 묶음은 그 모델만 막는다).
 * 하루보다 긴 창은 주간, 나머지는 세션 창으로 둔다 — 둘 다 플랜 전체 한도라 판정은 같다.
 */
export function codexWindowsAsLimits(windows: readonly ProviderUsageWindow[] | undefined): ClaudeUsageLimit[] {
  const out: ClaudeUsageLimit[] = [];
  for (const w of windows ?? []) {
    if (!w.id.startsWith('codex:')) continue;
    if (!Number.isFinite(w.usedPercent)) continue;
    const weekly = (w.windowDurationMins ?? 0) >= 24 * 60;
    out.push({
      kind: weekly ? 'weekly_all' : 'session',
      group: weekly ? 'weekly' : 'session',
      percent: w.usedPercent,
      severity: '',
      ...(typeof w.resetsAt === 'number' && Number.isFinite(w.resetsAt) ? { resetsAt: w.resetsAt } : {}),
      isActive: true,
    });
  }
  return out;
}

/**
 * 한 달치 Costs 주소. 시각은 유닉스 초이고 끝은 다음 달 1일(그 전에 끝나는 버킷만 온다 — 오늘 버킷까지 들어오게).
 * `bucket_width` 는 지금 `1d` 만 받는다(공식 사용량 쿡북).
 */
export function openaiCostsUrl(startingAt: number, endingAt: number, page?: string): string {
  const q = new URLSearchParams({
    start_time: String(Math.floor(startingAt / 1000)),
    end_time: String(Math.floor(endingAt / 1000)),
    bucket_width: '1d',
    limit: '31',
  });
  if (page) q.set('page', page);
  return `${OPENAI_CREDIT_COSTS_URL}?${q.toString()}`;
}

/**
 * Costs 한 쪽을 합한다 — `data[].results[].amount.value` 는 **달러 실수**다(Anthropic 의 센트 문자열과 다르다).
 * 통화가 USD 가 아닌 항목은 더하지 않는다. 모양이 다르면 null.
 */
export function parseOpenAiCosts(body: unknown): { usd: number; hasMore: boolean; nextPage?: string } | null {
  const o = objOf(body);
  if (!o || !Array.isArray(o['data'])) return null;
  let usd = 0;
  for (const bucket of o['data'] as unknown[]) {
    const results = objOf(bucket)?.['results'];
    if (!Array.isArray(results)) continue;
    for (const item of results) {
      const amount = objOf(objOf(item)?.['amount']);
      if (!amount) continue;
      const currency = amount['currency'];
      if (typeof currency === 'string' && currency.toLowerCase() !== 'usd') continue;
      const value = amount['value'];
      const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
      if (Number.isFinite(n)) usd += n;
    }
  }
  const next = o['next_page'];
  const nextPage = typeof next === 'string' && next ? next : undefined;
  // 문서 예시는 `has_more` 없이 `next_page` 만 싣는다 — 다음 쪽 커서가 있으면 따라간다.
  const hasMore = nextPage !== undefined && o['has_more'] !== false;
  return { usd, hasMore, ...(nextPage ? { nextPage } : {}) };
}

/** OpenAI 오류 본문(`{"error":{"message":…}}`)의 문장. 없으면 undefined. */
export function readOpenAiErrorMessage(body: unknown): string | undefined {
  const message = objOf(objOf(body)?.['error'])?.['message'];
  return typeof message === 'string' && message ? message.slice(0, 300) : undefined;
}

/**
 * 실행용 키 모양 — 프로젝트(`sk-proj-`)·서비스 계정(`sk-svcacct-`)·옛 사용자 키(`sk-`). 관리자 키는 모델을 못 부르고,
 * Anthropic 키는 다른 지갑이라 저장 전에 돌려보낸다. 확인은 결국 `/v1/models` 가 한다.
 */
export function checkOpenAiKeyShape(raw: string): ApiKeyShapeProblem | null {
  const k = raw.trim();
  if (!k) return 'empty';
  if (/\s/.test(k)) return 'whitespace';
  if (k.startsWith('sk-ant-') || !k.startsWith('sk-')) return 'not-openai';
  if (k.startsWith('sk-admin-')) return 'admin-key';
  return null;
}

/** 지출 읽기 칸 — Costs API 는 관리자 키(`sk-admin-…`)만 받는다(조직 Owner 가 만든다). */
export function checkOpenAiAdminKeyShape(raw: string): ApiKeyShapeProblem | null {
  const k = raw.trim();
  if (!k) return 'empty';
  if (/\s/.test(k)) return 'whitespace';
  if (k.startsWith('sk-ant-') || !k.startsWith('sk-')) return 'not-openai';
  if (!k.startsWith('sk-admin-')) return 'not-admin-key';
  return null;
}

/**
 * 크레딧 턴이 남긴 실패 문장에서 **OpenAI 의 거절**을 읽는다. 모르는 실패는 null — 넘겨짚어 막지 않는다.
 * - 잔액·한도: `insufficient_quota` · `You exceeded your current quota…` · 코덱스 `Quota exceeded…` → 1시간 뒤 다시
 *   (잔액 부족과 프로젝트·조직 한도가 같은 코드로 와 둘을 가르지 않는다)
 * - 키 거부: `invalid_api_key` · `Incorrect API key provided` · 401 Unauthorized → 키를 바꿀 때까지
 */
export function detectOpenAiRefusal(text: string | undefined, now: number): ApiCreditConsoleBlock | null {
  if (!text) return null;
  const s = text.slice(0, 4000);
  if (/insufficient_quota|exceeded your current quota|quota exceeded|billing_hard_limit_reached|billing_not_active/i.test(s)) {
    return { reason: 'balance-empty', at: now, until: now + API_CREDIT_BALANCE_RECHECK_MS, detail: creditFailureDetail(s) };
  }
  if (/invalid_api_key|incorrect api key|\b401\b[^\n]*unauthori[sz]ed|unauthori[sz]ed[^\n]*\b401\b/i.test(s)) {
    return { reason: 'key-invalid', at: now, detail: creditFailureDetail(s) };
  }
  return null;
}
