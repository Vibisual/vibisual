import type { NodeStatus } from '@vibisual/shared';

/** §2.4 확인 dismiss 판정 — 두 손짓의 규칙이 서로 달라 한 파일에 나란히 둔다(갈라 두면 한쪽만 고쳐진다). */

/**
 * 싱글 클릭 확인 dismiss 대상: `completed` · `error`(idle sweep 에서 일부러 빠져 이 길이 없으면 영영 남는다) ·
 * `idle`(§2.4 재시작 강등의 잔상 — 걷을 게 없으면 서버 no-op). `active` 는 ❌ — 지금 쓰는 세션의 작업 지도를 지우게 된다.
 */
export function shouldDismissOnSelect(status: NodeStatus | undefined): boolean {
  return status === 'completed' || status === 'error' || status === 'idle';
}

/** 더블클릭은 `completed` 만(§6) — `idle` 을 넣지 않는다: 잔상을 걷지 않고 열어 볼 손이 남아야 한다. */
export function shouldDismissOnOpen(status: NodeStatus | undefined): boolean {
  return status === 'completed';
}
