import { USAGE_LIMIT_WARN_PCT, USAGE_LIMIT_DANGER_PCT } from '@vibisual/shared';

// SCENARIO.md §4 v1.50 / v3.60 / v3.64 — Claude.ai 한도 표시 공용 헬퍼.
//
// 헤더 사용량 필(Layout/UsagePill), 사용량 팝업(Panel/UsagePopup), DetailPanel 루트 게이지가
// 같은 정규화·색 기준을 쓰도록 여기 한 곳에 둔다. 컴포넌트끼리 직접 import 하면 순환이 생긴다.

/**
 * 한도 사용률을 0~100 으로 정리한다. **단위는 언제나 퍼센트**다.
 *
 * v3.64 — 이전에는 "0~1 이면 비율, 그 외면 퍼센트" 로 **추측**해 `used * 100` 을 하던 자리다.
 * 그 추측이 `1`(=1%)을 비율로 잘못 읽어 **100% 로 표시**했다 — Claude 앱은 1% 인데 우리 앱만
 * 빨간 100% 를 띄워 사용자를 놀라게 한 사고의 원인. 값 `1` 은 "1%" 와 "100%" 어느 쪽으로도
 * 읽히므로 추측으로는 절대 풀 수 없다. 그래서 생산자 양쪽(§4 v3.62 OAuth 조회의 `percent`,
 * §4 v3.60 statusLine 의 `used_percentage`)이 모두 0~100 을 보낸다는 사실에 맞춰 **규약을
 * 퍼센트로 고정**하고 추측을 없앴다. 범위 밖 값만 잘라낸다.
 */
export function clampUsagePct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
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
