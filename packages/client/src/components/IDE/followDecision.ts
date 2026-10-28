/** followDecision — 바닥 자동추종 판정(순수). 끄는 것은 최근 사용자 위로-제스처가 있을 때만 — virtuoso 는 스트리밍 중 스스로 scrollTop 을 보정해 dist 가 임계를 넘는다(그걸로 끄면 위로 말린다). */

export interface FollowDecisionInput {
  /** 바닥까지 남은 거리 = scrollHeight - scrollTop - clientHeight. */
  dist: number;
  /** 바닥으로 간주하는 임계(px). dist < threshold 면 바닥. */
  threshold: number;
  /** 직전 추종 상태(followRef.current). */
  prevFollow: boolean;
  /** 이 scroll 직전 최근(짧은 창) 사용자가 직접 위로 올린 제스처(휠 위로/터치/스크롤바 드래그/PageUp 등)가 있었는가. */
  userUpIntent: boolean;
  /** 이 scroll 이벤트가 위로 이동(scrollTop 감소)이었는가. */
  goingUp: boolean;
}

/**
 * - 위로-제스처 + 위로 이동 → 거리 무관 즉시 해제(임계 안쪽 휠-업이 재무장돼 도로 붙지 않게).
 * - 바닥 임계 안 재무장은 아래로/제자리 이동일 때만. 그 외(프로그램·측정으로 dist 만 변함)는 직전 상태 유지.
 */
export function decideFollow({ dist, threshold, prevFollow, userUpIntent, goingUp }: FollowDecisionInput): boolean {
  if (userUpIntent && goingUp) return false;
  if (dist < threshold && !goingUp) return true;
  return prevFollow;
}
