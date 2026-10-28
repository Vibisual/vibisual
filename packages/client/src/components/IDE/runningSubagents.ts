import { isBackgroundShellTask } from '@vibisual/shared';
import type { FinishedSubagentTask, RunningSubagentTask } from '@vibisual/shared';

/**
 * §5.5 #17-9 ③(a)/⑥ — "실행 중 서브에이전트" 산식 한 벌. 활동바(점등·숫자)와 사이드바 뷰가 함께 써야 "아이콘은 있는데 `(0)`"이 안 난다.
 * 범위: 세션 탭이면 그 탭이 띄운 것만, 메인 탭(null)이면 전부. 소유 탭 미상(`subAgentId` 없음)은 세션 탭에 넣지 않고 `countOtherTasks` 로만 알린다.
 * 모집단은 백단에서 도는 것뿐 — 세션 자신의 실행(`sub.status==='active'`)은 세지 않는다(대화 중엔 늘 1건이 잡힌다).
 */

const EMPTY: RunningSubagentTask[] = [];

/**
 * AI 자식인가 셸인가 — 종류 칩의 판정 한 곳. 서브에이전트(`Task`/`Agent`)는 토큰을 쓰고 `TaskStop`, 셸(`Bash run_in_background`·`Monitor`)은 `KillShell`.
 * 근거는 서버가 싣는 `origin`(미지정 = `'hook'`). §5.5 #17-9 ⑰ — 실행 축과 같은 술어 `isBackgroundShellTask` 를 쓴다
 * (`origin === 'stream'` 만 보면 백그라운드 자식 안에서 스폰된 모델 자식을 셸로 적고, 두 벌이면 붙드는 쪽과 화면이 갈린다).
 */
export function taskKindKey(
  task: Pick<RunningSubagentTask, 'origin' | 'subagentType'>,
): 'kindAgent' | 'kindShell' {
  return isBackgroundShellTask(task) ? 'kindShell' : 'kindAgent';
}

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

/** §5.5 #17-9 ⑦(b) — "방금 끝난 것"도 같은 범위 규칙으로 거른다(잣대가 다르면 두 구역 소속이 어긋난다). 개수 산식에는 넣지 않는다(⑦(c)). */
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
