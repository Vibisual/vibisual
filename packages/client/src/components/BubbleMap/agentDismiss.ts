import type { NodeStatus } from '@vibisual/shared';

/**
 * 에이전트 버블의 **확인 dismiss** 판정 한 벌 (§2.4 "확인 dismiss → 전유 file/folder 즉시 소멸").
 *
 * 규칙이 두 손짓에 걸쳐 있고 **서로 다르기** 때문에 한 파일에 나란히 둔다 — 갈라 두면 한쪽만
 * 고쳐져 "클릭하면 걷히는데 더블클릭하면 안 걷힌다"가 설명 없는 변덕으로 보인다.
 */

/**
 * 싱글 클릭(선택)으로 확인 dismiss 를 발동할 상태인가.
 *
 *  - `completed` — 원래의 확인 대상(v1.82).
 *  - `error` — 실패 버블은 idle sweep 에서 **일부러 제외**돼(거짓 idle 세탁 금지) 자동으로
 *    사라지지 않는다. 사용자가 눌러 내리는 이 길이 없으면 캔버스에 영영 남는다.
 *  - `idle` — 앱을 종료하거나 튕긴 뒤 다시 켜면 살아 있던 세션이 **전부 idle 로 복원된다**
 *    (§2.4 재시작 강등). 종전 조건은 `completed`/`error` 뿐이라 그 잔상을 걷을 클릭이 아예
 *    없었고, 죽은 세션이 만졌던 파일·폴더 버블이 주인 없이 쌓였다. 걷을 것이 없으면(전유 버블 0)
 *    서버가 조용히 no-op 으로 끝내므로 헛클릭이 되지 않는다.
 *
 * `active` 는 대상이 아니다 — 지금 그 버블을 쓰고 있는 세션의 작업 지도를 지우는 일이 된다.
 */
export function shouldDismissOnSelect(status: NodeStatus | undefined): boolean {
  return status === 'completed' || status === 'error' || status === 'idle';
}

/**
 * 더블클릭(IDE 열기)으로 확인 dismiss 를 함께 발동할 상태인가 — `completed` 뿐이다(§6 v2.74).
 *
 * `idle` 을 여기에 넣지 않는 것이 의도다. 잔상 버블을 **걷지 않고 열어 보는 손**이 하나는
 * 남아 있어야, 지난 세션의 기록을 확인하려다 캔버스가 함께 지워지는 일이 없다.
 */
export function shouldDismissOnOpen(status: NodeStatus | undefined): boolean {
  return status === 'completed';
}
