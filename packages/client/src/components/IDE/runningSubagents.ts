import type { FinishedSubagentTask, RunningSubagentTask } from '@vibisual/shared';

/**
 * §5.5 #17-9 ③(a) v4.95 / ⑥ v5.07 — "실행 중 서브에이전트" 산식 한 벌.
 *
 * 활동바 항목(점등·아래 숫자)과 사이드바 뷰(목록·머리말)가 **반드시 같은 수**를 봐야 한다.
 * v3.51 은 나타남을 에이전트 전체 개수로, 배지를 세션 필터 결과로 계산해 두 산식이 갈렸고,
 * 그 틈에서 **"아이콘은 있는데 배지는 `(0)`"** 상태가 났다(눌러도 목록이 비어 창이 열리자마자
 * 닫히니 "눌러도 아무것도 안 뜬다"로 보였다). 산식을 여기 한 곳에 두고 양쪽이 함께 쓴다.
 *
 * 범위 규칙: **세션 탭이 선택돼 있으면 그 탭이 띄운 것만**, 메인 탭(null)이면 그 에이전트 전부.
 * 소유 탭이 미상(`subAgentId` 없음)인 항목은 어느 탭 것이라고 단정할 수 없으므로 세션 탭 목록에
 * 넣지 않는다 — 대신 `countOtherTasks` 로 "다른 곳에서 N개 더" 라고만 알린다.
 *
 * **모집단은 하나 — 백단에서 도는 것뿐이다**(⑥ v5.07). v5.03 ④(a) 는 세션 탭 자신의 실행
 * (`sub.status==='active'` = 지금 사용자와 나누고 있는 대화)까지 합쳐 셌는데, 그러면 대화가
 * 도는 동안 늘 1건이 잡혀 이 화면이 답해야 할 단 하나의 질문("백단에 몇 개?")이 오염된다.
 * 지금 하는 대화는 바로 옆 스트림이 이미 보여 주므로 여기서는 세지 않는다.
 */

const EMPTY: RunningSubagentTask[] = [];

/** 지금 보고 있는 탭 기준 목록. 전부가 대상이면 원본 배열을 그대로 돌려준다(불필요한 리렌더 방지). */
export function selectSessionTasks(
  all: RunningSubagentTask[] | undefined,
  activeSessionId: string | null,
): RunningSubagentTask[] {
  if (!all || all.length === 0) return EMPTY;
  if (activeSessionId === null) return all;
  const mine = all.filter((t) => t.subAgentId === activeSessionId);
  return mine.length === all.length ? all : mine;
}

/** 지금 보고 있는 탭 기준 개수 — 항목 점등·아래 숫자·목록이 모두 이 수 하나를 쓴다. */
export function countSessionTasks(
  all: RunningSubagentTask[] | undefined,
  activeSessionId: string | null,
): number {
  return selectSessionTasks(all, activeSessionId).length;
}

const EMPTY_FINISHED: FinishedSubagentTask[] = [];

/**
 * §5.5 #17-9 ⑦(b) — "방금 끝난 것" 도 **같은 범위 규칙**으로 거른다(도는 것과 다른 잣대를 쓰면
 * 같은 화면에서 두 구역의 소속이 어긋난다). 소유 탭 미상 항목은 세션 탭에서 제외하는 것도 동일하다.
 *
 * 개수 산식(`countSessionTasks`)에는 **관여하지 않는다** — ⑦(c) 활동바 점등·배지는 도는 것만 센다.
 */
export function selectSessionFinished(
  all: FinishedSubagentTask[] | undefined,
  activeSessionId: string | null,
): FinishedSubagentTask[] {
  if (!all || all.length === 0) return EMPTY_FINISHED;
  if (activeSessionId === null) return all;
  const mine = all.filter((t) => t.subAgentId === activeSessionId);
  return mine.length === all.length ? all : mine;
}

/** 이 탭 밖(다른 세션 탭 + 소유 미상)에서 도는 수. 메인 탭은 전부가 이미 목록에 있으므로 0. */
export function countOtherTasks(
  all: RunningSubagentTask[] | undefined,
  activeSessionId: string | null,
): number {
  if (!all || all.length === 0) return 0;
  if (activeSessionId === null) return 0;
  return all.length - countSessionTasks(all, activeSessionId);
}
