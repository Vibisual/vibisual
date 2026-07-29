import { USAGE_LIMIT_WARN_PCT, USAGE_LIMIT_DANGER_PCT } from '@vibisual/shared';

// SCENARIO.md §4 v1.50 / v3.60 — Claude.ai 한도 표시 공용 헬퍼.
//
// 헤더 사용량 필(Layout/UsagePill)과 사용량 팝업(Panel/UsagePopup)이 같은 정규화·색 기준을
// 쓰도록 여기 한 곳에 둔다. 컴포넌트끼리 직접 import 하면 Layout ↔ Panel 순환이 생긴다.

/** 0~1(비율) 과 0~100(퍼센트) 를 모두 받는다 — §4 v1.50 `POST /api/rate-limits` 규약. */
export function normalizeUsagePct(used: number): number {
  return used > 1 ? Math.min(100, used) : Math.min(100, used * 100);
}

/** 텍스트·링 색. 임계는 shared 상수 단일 출처(§4 v1.50 DetailPanel 게이지와 동일 기준). */
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
