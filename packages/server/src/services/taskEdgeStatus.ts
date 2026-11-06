import type { TaskEdge, TaskEdgeStatus } from '@vibisual/shared';

export interface TaskEdgeStatusOptions {
  /** 같은 회차를 이어 가는 재진입(오케스트라 entry 턴이 끝난 뒤 검증 대기)은 회차를 올리지 않는다 — 올리면 새 송신 펄스가 한 번 더 뜬다. */
  sameRun?: boolean;
}

/**
 * §5.3 #12 — TaskEdge 상태 전이 한 벌. 그래프 인스턴스와 매니저 폴백 setter 가 같이 쓴다(갈라 두면 한쪽만 고쳐진다).
 * - `lastExecutedAt` 은 실행 회차 식별자다. 스냅샷 배치가 `completed→executing→completed` 를 접어도 클라가 새 회차를 알아보게 단조 증가로 박는다.
 * - `errorMessage` 는 지금의 실패만 담는다 — `error` 가 아닌 전이에서 걷는다(재시도 성공 뒤 옛 오류가 현재 오류로 남던 것).
 */
export function applyTaskEdgeStatus(
  edge: TaskEdge,
  status: TaskEdgeStatus,
  result?: string,
  errorMessage?: string,
  options: TaskEdgeStatusOptions = {},
): void {
  edge.status = status;
  if (status === 'executing' && !options.sameRun) {
    edge.lastExecutedAt = Math.max(Date.now(), (edge.lastExecutedAt ?? 0) + 1);
  }
  if (result !== undefined) edge.lastResult = result;
  if (status !== 'error') delete edge.errorMessage;
  else if (errorMessage !== undefined) edge.errorMessage = errorMessage;
}
