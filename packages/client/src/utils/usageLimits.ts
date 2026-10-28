import { USAGE_LIMIT_WARN_PCT, USAGE_LIMIT_DANGER_PCT } from '@vibisual/shared';

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
