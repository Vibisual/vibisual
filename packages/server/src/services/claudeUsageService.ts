import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CLAUDE_USAGE_API_URL,
  CLAUDE_USAGE_FETCH_TIMEOUT_MS,
} from '@vibisual/shared';
import type {
  ClaudeUsageInfo,
  ClaudeUsageLimit,
  ClaudeUsageExtraCredits,
  ClaudeUsageError,
} from '@vibisual/shared';

/**
 * §4 v3.62 — Claude 사용량 직접 조회.
 *
 * Claude Code 의 `/usage` 화면이 쓰는 것과 **같은 경로**를 그대로 부른다 — CLI 바이너리의
 * `fetchUtilization` 이 `GET /api/oauth/usage` 를 로컬 OAuth 토큰으로 호출한다. statusLine
 * (§4 v3.60)과 달리 인터랙티브 세션이 없어도 즉시 값이 오고, 플랜명·모델별 주간 한도·사용
 * 크레딧까지 전부 들어 있어 이쪽이 **1차 소스**다(statusLine 은 자격증명을 파일로 두지 않는
 * 환경 — 예: macOS 키체인 — 을 위한 폴백으로 남긴다).
 *
 * **읽기 전용 원칙**: 자격증명 파일은 매 호출 시점에 다시 읽기만 하고 절대 쓰지 않는다.
 * 토큰 갱신은 Claude Code 자신이 하며(그때 파일이 갱신된다) 우리는 다음 폴링에서 자연히
 * 새 토큰을 집는다. 우리가 refresh 를 흉내 내면 사용자의 로그인 상태를 망가뜨릴 수 있다.
 */

interface Credentials {
  accessToken: string;
  subscriptionType?: string;
  rateLimitTier?: string;
}

function credentialsPath(): string {
  return path.join(os.homedir(), '.claude', '.credentials.json');
}

/** 자격증명 읽기. 없거나 형식이 다르면 null (mac 키체인 저장 환경 포함). */
function readCredentials(): Credentials | null {
  try {
    const raw = fs.readFileSync(credentialsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const oauth = parsed['claudeAiOauth'] as Record<string, unknown> | undefined;
    const token = oauth?.['accessToken'];
    if (typeof token !== 'string' || token.length === 0) return null;
    return {
      accessToken: token,
      subscriptionType: typeof oauth?.['subscriptionType'] === 'string' ? oauth['subscriptionType'] : undefined,
      rateLimitTier: typeof oauth?.['rateLimitTier'] === 'string' ? oauth['rateLimitTier'] : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * 플랜 표시명 조립 — `subscriptionType='max'` + `rateLimitTier='default_claude_max_20x'`
 * → `"Max (20x)"`. 배수 표기가 없으면 타입만("Pro"). 알 수 없으면 undefined.
 */
export function buildPlanLabel(subscriptionType?: string, rateLimitTier?: string): string | undefined {
  if (!subscriptionType) return undefined;
  const name = subscriptionType.charAt(0).toUpperCase() + subscriptionType.slice(1);
  const multiplier = rateLimitTier?.match(/(\d+x)\b/i)?.[1];
  return multiplier ? `${name} (${multiplier})` : name;
}

/** ISO 문자열 → epoch ms. 파싱 실패는 undefined. */
function toEpochMs(v: unknown): number | undefined {
  if (typeof v !== 'string' || v.length === 0) return undefined;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * 응답 → `ClaudeUsageLimit[]`.
 *
 * 서버는 `limits` 배열(kind/group/percent/severity/resets_at/scope/is_active)을 주고, 그 외에
 * `five_hour`/`seven_day` 최상위 필드도 함께 준다. 배열이 있으면 그대로 쓰고(모델별 항목까지
 * 담겨 있다), 없을 때만 최상위 필드로 합성한다 — 서버 표현을 우리가 재해석하지 않기 위함.
 */
export function normalizeLimits(body: Record<string, unknown>): ClaudeUsageLimit[] {
  const raw = body['limits'];
  if (Array.isArray(raw)) {
    const out: ClaudeUsageLimit[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const percent = num(o['percent']);
      if (typeof o['kind'] !== 'string' || percent === undefined) continue;
      const scope = o['scope'] as Record<string, unknown> | null | undefined;
      const model = scope?.['model'] as Record<string, unknown> | undefined;
      const displayName = typeof model?.['display_name'] === 'string' ? model['display_name'] : undefined;
      const resetsAt = toEpochMs(o['resets_at']);
      out.push({
        kind: o['kind'],
        group: typeof o['group'] === 'string' ? o['group'] : o['kind'],
        percent,
        severity: typeof o['severity'] === 'string' ? o['severity'] : 'normal',
        ...(resetsAt !== undefined ? { resetsAt } : {}),
        ...(displayName ? { scopeLabel: displayName } : {}),
        isActive: o['is_active'] === true,
      });
    }
    if (out.length > 0) return out;
  }

  // 폴백 — 배열이 없는 응답 형태.
  const out: ClaudeUsageLimit[] = [];
  for (const [key, kind, group] of [
    ['five_hour', 'session', 'session'],
    ['seven_day', 'weekly_all', 'weekly'],
  ] as const) {
    const w = body[key] as Record<string, unknown> | null | undefined;
    const percent = num(w?.['utilization']);
    if (percent === undefined) continue;
    const resetsAt = toEpochMs(w?.['resets_at']);
    out.push({
      kind,
      group,
      percent,
      severity: 'normal',
      ...(resetsAt !== undefined ? { resetsAt } : {}),
      isActive: true,
    });
  }
  return out;
}

function normalizeExtraCredits(body: Record<string, unknown>): ClaudeUsageExtraCredits | undefined {
  const e = body['extra_usage'] as Record<string, unknown> | null | undefined;
  if (!e || typeof e !== 'object') return undefined;
  const utilization = num(e['utilization']);
  const usedCredits = num(e['used_credits']);
  const monthlyLimit = num(e['monthly_limit']);
  return {
    enabled: e['is_enabled'] === true,
    ...(utilization !== undefined ? { utilization } : {}),
    ...(usedCredits !== undefined ? { usedCredits } : {}),
    ...(monthlyLimit !== undefined ? { monthlyLimit } : {}),
    ...(typeof e['currency'] === 'string' ? { currency: e['currency'] } : {}),
  };
}

/** 세션(5시간) / 주간 전체 한도를 골라낸다 — §4 v1.50 `RateLimitInfo` 미러링에 쓴다. */
export function pickPrimaryWindows(limits: ClaudeUsageLimit[]): {
  used5h?: number; resetAt5h?: number; used7d?: number; resetAt7d?: number;
} {
  const session = limits.find((l) => l.kind === 'session' || l.group === 'session');
  const weekly = limits.find((l) => l.kind === 'weekly_all')
    ?? limits.find((l) => l.group === 'weekly' && !l.scopeLabel);
  return {
    ...(session ? { used5h: session.percent } : {}),
    ...(session?.resetsAt !== undefined ? { resetAt5h: session.resetsAt } : {}),
    ...(weekly ? { used7d: weekly.percent } : {}),
    ...(weekly?.resetsAt !== undefined ? { resetAt7d: weekly.resetsAt } : {}),
  };
}

/**
 * 진행 중 요청을 재사용할 수 있는 최대 시간. fetch 타임아웃(5초)보다 넉넉히 길게 둔다.
 *
 * 이 상한이 없으면 어떤 이유로든 한 번 매달린 요청이 `inFlight` 에 영구히 남아 **이후 모든
 * 조회가 그 죽은 약속을 돌려받는다** — 값이 부팅 시점에 얼어붙고 새로고침 버튼도 응답하지
 * 않는다(v3.63 사용자 보고: 한도가 초기화됐는데도 100% 가 그대로였던 증상의 구조적 원인).
 */
const INFLIGHT_REUSE_MAX_MS = 12_000;

/** fetch 가 어떤 이유로도 매달리지 않도록 하는 최후 방어선. */
const HARD_DEADLINE_MS = CLAUDE_USAGE_FETCH_TIMEOUT_MS * 2;

class ClaudeUsageService {
  private cached: ClaudeUsageInfo | null = null;
  private inFlight: Promise<ClaudeUsageInfo> | null = null;
  private inFlightAt = 0;

  getCached(): ClaudeUsageInfo | null {
    return this.cached;
  }

  /** 실패해도 직전 성공값의 limits 를 유지한 채 error 만 갈아끼운다(화면이 갑자기 비지 않게). */
  private fail(error: ClaudeUsageError): ClaudeUsageInfo {
    const info: ClaudeUsageInfo = {
      ...(this.cached?.plan ? { plan: this.cached.plan } : {}),
      limits: this.cached?.limits ?? [],
      ...(this.cached?.extraCredits ? { extraCredits: this.cached.extraCredits } : {}),
      source: 'oauth',
      fetchedAt: Date.now(),
      error,
    };
    this.cached = info;
    return info;
  }

  /**
   * 동시 호출은 하나로 합친다(팝업 오픈 + 폴링이 겹쳐도 요청은 1건).
   *
   * 단 합류는 **12초까지만** — 그보다 오래된 진행 중 요청은 매달린 것으로 보고 버리고 새로
   * 시작한다. 그리고 정리(`inFlight=null`)는 **자기 자신일 때만** 수행해, 뒤늦게 끝난 옛
   * 요청이 새 요청을 지워버리지 않게 한다.
   */
  async refresh(): Promise<ClaudeUsageInfo> {
    if (this.inFlight && Date.now() - this.inFlightAt < INFLIGHT_REUSE_MAX_MS) {
      return this.inFlight;
    }
    const p = this.doRefresh();
    this.inFlight = p;
    this.inFlightAt = Date.now();
    void p.catch(() => undefined).finally(() => {
      if (this.inFlight === p) this.inFlight = null;
    });
    return p;
  }

  private async doRefresh(): Promise<ClaudeUsageInfo> {
    // fetch 가 abort 에도 반응하지 않는 극단(프록시·DNS 교착)에서도 반드시 값이 나오게 한다.
    let deadline: NodeJS.Timeout | undefined;
    const guard = new Promise<ClaudeUsageInfo>((resolve) => {
      deadline = setTimeout(() => resolve(this.fail('network')), HARD_DEADLINE_MS);
    });
    try {
      return await Promise.race([this.fetchOnce(), guard]);
    } finally {
      if (deadline) clearTimeout(deadline);
    }
  }

  private async fetchOnce(): Promise<ClaudeUsageInfo> {
    const creds = readCredentials();
    if (!creds) return this.fail('no-credentials');

    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), CLAUDE_USAGE_FETCH_TIMEOUT_MS);
      const res = await fetch(CLAUDE_USAGE_API_URL, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creds.accessToken}`,
        },
        signal: controller.signal,
      }).finally(() => clearTimeout(tid));

      if (res.status === 401 || res.status === 403) return this.fail('unauthorized');
      if (!res.ok) return this.fail('network');

      const body = await res.json() as Record<string, unknown>;
      const plan = buildPlanLabel(creds.subscriptionType, creds.rateLimitTier);
      const extraCredits = normalizeExtraCredits(body);
      const info: ClaudeUsageInfo = {
        ...(plan ? { plan } : {}),
        limits: normalizeLimits(body),
        ...(extraCredits ? { extraCredits } : {}),
        source: 'oauth',
        fetchedAt: Date.now(),
      };
      this.cached = info;
      return info;
    } catch {
      return this.fail('network');
    }
  }
}

export const claudeUsageService = new ClaudeUsageService();
