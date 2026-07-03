/**
 * followDecision — IDE 출력 영역의 "바닥 자동추종" 판정 (순수 함수).
 *
 * 스크롤 이벤트가 한 번 날 때마다 "지금 추종 상태를 어떻게 둘지"를 결정한다. virtuoso·실제 레이아웃 없이
 * 결정론적으로 테스트할 수 있도록, DOM 을 만지지 않고 입력값만으로 다음 followRef 값을 돌려준다
 * (IDEMainArea 의 onScroll 이 이 결과를 followRef 에 반영).
 *
 * 핵심 규칙(v3.08): 추종을 **끄는** 것은 사용자가 직접 위로 올린 제스처가 최근에 있었을 때만이다.
 * virtuoso 는 스트리밍으로 마지막 항목이 자라면 위쪽 선렌더 버퍼를 재측정하며 스스로 scrollTop 을 보정해
 * scroll 이벤트를 쏘는데, 그 순간 콘텐츠가 막 자라 dist 가 임계를 넘는다. 옛 코드는 그 dist 만 보고 추종을
 * 꺼서 화면이 "위로 말려 올라갔다". → 프로그램/측정이 만든 scroll 로는 끄지 않고, 바닥에 닿으면 항상 재무장.
 */

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
 * 다음 추종 상태를 결정한다.
 * - v3.15 — 위로-제스처 + 위로 이동 → **거리 무관 즉시 해제**. 옛 규칙은 dist≥임계일 때만 해제라,
 *   바닥 임계(80px) 안쪽의 잔잔한 휠-업이 해제 없이 재무장돼 워치독이 다음 프레임 도로 붙였다
 *   ("살짝 올리면 다시 밑에 붙고, 세게 올려야만 올라감").
 * - 바닥 임계 안 진입은 **아래로/제자리 이동일 때만** 재무장 — 위로 이동 중 임계 안 통과나 해제 직후의
 *   프로그램 보정이 사용자를 도로 바닥에 스냅백시키지 않게.
 * - 그 외(프로그램/측정으로 dist 만 변한 경우) → 직전 상태 유지(끄지 않는다 — v3.08 의 핵심 불변).
 */
export function decideFollow({ dist, threshold, prevFollow, userUpIntent, goingUp }: FollowDecisionInput): boolean {
  if (userUpIntent && goingUp) return false;
  if (dist < threshold && !goingUp) return true;
  return prevFollow;
}
