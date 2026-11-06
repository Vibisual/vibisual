import { USAGE_LIMIT_WARN_PCT, USAGE_LIMIT_DANGER_PCT, type ClaudeUsageLimit, type RateLimitInfo } from '@vibisual/shared';

// SCENARIO.md §4 — Claude.ai 한도 표시 공용 헬퍼. 헤더 사용량 필(Layout/UsagePill)·사용량 팝업(Panel/UsagePopup)·DetailPanel 루트 게이지가
// 같은 정규화·색 기준을 쓰도록 한 곳에 둔다(컴포넌트끼리 import 하면 순환이 생긴다).

/**
 * 한도 사용률을 0~100 으로 정리한다. **단위는 언제나 퍼센트**다 — "0~1 이면 비율" 로 추측해 ×100 하면 `1`(=1%)이 100% 로 뜬다.
 * 값 `1` 은 어느 쪽으로도 읽혀 추측으로 풀 수 없고, 생산자 양쪽(§4 OAuth 조회의 `percent`, §4 statusLine 의 `used_percentage`)이 0~100 을 보낸다. 범위 밖 값만 자른다.
 */
export function clampUsagePct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

/** 텍스트·링 색. 임계는 shared 상수 단일 출처(§4 DetailPanel 게이지와 같은 기준). */
export function usageTextToneClass(pct: number): string {
  if (pct >= USAGE_LIMIT_DANGER_PCT) return 'text-red-400';
  if (pct >= USAGE_LIMIT_WARN_PCT) return 'text-amber-400';
  return 'text-emerald-400';
}

/** 채움 바 색. */
export function usageBarToneClass(pct: number): string {
  if (pct >= USAGE_LIMIT_DANGER_PCT) return 'bg-red-500';
  if (pct >= USAGE_LIMIT_WARN_PCT) return 'bg-amber-500';
  return 'bg-emerald-500';
}

export function isSessionLimit(l: ClaudeUsageLimit): boolean {
  return l.kind === 'session' || l.group === 'session';
}

/** 계정 전체 주간 한도(모든 모델). 모델별 줄(`scopeLabel`)은 그 모델만 막으므로 아니다. */
export function isWeeklyAllLimit(l: ClaudeUsageLimit): boolean {
  return l.kind === 'weekly_all' || (l.group === 'weekly' && !l.scopeLabel && l.kind !== 'weekly_scoped');
}

export interface PillLimit {
  kind: 'fiveHour' | 'weekly';
  percent: number;
}

/**
 * 헤더 필이 보일 Claude 한도 — 5시간 한도가 있으면 그것, 없으면(인증된 Ultra) 주간(모든 모델).
 * 서버가 조립한 표가 먼저이고, 표가 비었을 때만 statusLine 원본을 본다. 아무것도 없으면 null(`-`).
 */
export function pickClaudePillLimit(
  limits: readonly ClaudeUsageLimit[] | undefined,
  rateLimits: Pick<RateLimitInfo, 'used5h' | 'used7d'> | null | undefined,
): PillLimit | null {
  const list = limits ?? [];
  const session = list.find(isSessionLimit);
  if (session) return { kind: 'fiveHour', percent: session.percent };
  const weekly = list.find(isWeeklyAllLimit);
  if (weekly) return { kind: 'weekly', percent: weekly.percent };
  if (list.length > 0) return null;
  if (typeof rateLimits?.used5h === 'number') return { kind: 'fiveHour', percent: rateLimits.used5h };
  if (typeof rateLimits?.used7d === 'number') return { kind: 'weekly', percent: rateLimits.used7d };
  return null;
}
