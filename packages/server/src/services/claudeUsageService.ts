import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { USAGE_LIMIT_WARN_PCT, USAGE_LIMIT_DANGER_PCT } from '@vibisual/shared';
import type {
  ClaudeUsageInfo,
  ClaudeUsageLimit,
  RateLimitInfo,
} from '@vibisual/shared';

/**
 * §4 — Claude 사용량 표시값 조립.
 *
 * **원천은 statusLine 이다.** Claude Code 가 플랜 한도를 외부에 노출하는 공식 경로는 statusLine
 * 명령의 stdin JSON(`rate_limits.five_hour|seven_day` 의 `used_percentage`·`resets_at`) 하나뿐이고,
 * 그 값은 `hooks/handler.mjs --statusline` → `POST /api/rate-limits` → `graphManager.rateLimits`
 * 로 들어온다. 이 모듈은 그 값을 팝업이 쓰는 `ClaudeUsageInfo` 모양으로 **옮겨 담기만** 한다.
 *
 * **왜 직접 조회를 걷어냈나** — 종전(구 v3.62)에는 `~/.claude/.credentials.json` 의 OAuth
 * accessToken 으로 `GET https://api.anthropic.com/api/oauth/usage` 를 5분마다 직접 호출했다.
 * 문서화되지 않은 내부 엔드포인트를 공식 클라이언트용 토큰으로 자동 조회하는 것이라, Anthropic
 * 소비자 약관 §3 "API 키를 통하거나 명시적으로 허용된 경우를 제외한 자동화된 접속 금지" 에
 * 정면으로 걸린다. 배포되는 제품이므로 그 위험은 사용자 계정 전체에 걸린다 — 그래서 네트워크
 * 호출을 없애고 공식 경로 하나만 남겼다.
 *
 * **그래서 잃은 것** — 모델별 주간 한도(`weekly_scoped`)와 사용 크레딧(`extra_usage`)은
 * statusLine 이 주지 않으므로 더 이상 표시하지 않는다. 남는 것은 5시간·7일 두 창의 사용률과
 * 리셋 시각, 그리고 플랜 표시명이다.
 *
 * **자격증명 파일 취급** — 플랜 표시명(`Max (20x)`)을 만들려면 `subscriptionType`·`rateLimitTier`
 * 두 값이 필요해 파일을 읽지만, **accessToken 은 읽지도 실어 보내지도 않는다**. 쓰기는 절대 하지
 * 않는다(토큰 갱신은 Claude Code 자신의 일이다).
 */

/** 플랜 표시명 재료 — 자격증명 파일에서 **토큰이 아닌** 두 값만 집는다. */
interface PlanHints {
  subscriptionType?: string;
  rateLimitTier?: string;
}

function credentialsPath(): string {
  return path.join(os.homedir(), '.claude', '.credentials.json');
}

/**
 * 플랜 표시명 재료 읽기. 없거나 형식이 다르면 null(mac 키체인 저장 환경 포함).
 * `accessToken` 은 의도적으로 건드리지 않는다 — 이 앱은 그 토큰을 쓸 일이 없다.
 */
function readPlanHints(): PlanHints | null {
  try {
    const raw = fs.readFileSync(credentialsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const oauth = parsed['claudeAiOauth'] as Record<string, unknown> | undefined;
    if (!oauth) return null;
    const hints: PlanHints = {};
    if (typeof oauth['subscriptionType'] === 'string') hints.subscriptionType = oauth['subscriptionType'];
    if (typeof oauth['rateLimitTier'] === 'string') hints.rateLimitTier = oauth['rateLimitTier'];
    return hints.subscriptionType || hints.rateLimitTier ? hints : null;
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

/** 사용률 → 심각도. 임계는 화면과 같은 shared 상수를 쓴다(자체 하드코딩 ❌). */
export function severityForPercent(percent: number): string {
  if (percent >= USAGE_LIMIT_DANGER_PCT) return 'critical';
  if (percent >= USAGE_LIMIT_WARN_PCT) return 'warning';
  return 'normal';
}

/** 창 하나를 `ClaudeUsageLimit` 로. 리셋 시각이 이미 지났으면 그 창은 새로 시작됐다고 본다. */
function toLimit(
  kind: string,
  group: string,
  percent: number | undefined,
  resetsAt: number | undefined,
  now: number,
): ClaudeUsageLimit | null {
  if (percent === undefined || !Number.isFinite(percent)) return null;
  // 리셋 시각을 지난 값은 **옛 창의 값**이다. 그대로 두면 "시간이 지났는데 화면은 아직 100%"
  // 가 되므로(v3.63 사용자 보고와 같은 증상) 0 으로 본다 — 다음 statusLine 갱신이 실제 값을
  // 덮어쓴다. 값을 지어내는 것이 아니라 **만료를 반영**하는 것이다.
  const expired = resetsAt !== undefined && resetsAt <= now;
  const pct = expired ? 0 : Math.max(0, Math.min(100, percent));
  return {
    kind,
    group,
    percent: pct,
    severity: severityForPercent(pct),
    ...(resetsAt !== undefined && !expired ? { resetsAt } : {}),
    isActive: true,
  };
}

/**
 * statusLine 이 보고한 창들(`RateLimitInfo`) → 팝업이 읽는 `ClaudeUsageInfo`.
 *
 * 값이 하나도 없으면 `error: 'no-credentials'` 로 돌려준다 — 화면은 이 오류를 보고 수집기
 * (statusLine) 설치 스위치를 노출하므로, 사용자가 값을 받으려면 무엇을 켜야 하는지 알게 된다.
 */
export function buildClaudeUsage(rate: RateLimitInfo | undefined, now: number): ClaudeUsageInfo {
  const limits: ClaudeUsageLimit[] = [];
  const session = toLimit('session', 'session', rate?.used5h, rate?.resetAt5h, now);
  if (session) limits.push(session);
  const weekly = toLimit('weekly_all', 'weekly', rate?.used7d, rate?.resetAt7d, now);
  if (weekly) limits.push(weekly);

  const hints = readPlanHints();
  const plan = buildPlanLabel(hints?.subscriptionType, hints?.rateLimitTier);

  return {
    ...(plan ? { plan } : {}),
    limits,
    source: 'statusline',
    fetchedAt: now,
    ...(limits.length === 0 ? { error: 'no-credentials' as const } : {}),
  };
}
