/**
 * useSessionRunning — "이 세션 탭이 지금 돌고 있는가"를 **화면 어디서든 같은 답으로** 얻는 훅.
 *
 * 판정 자체는 `@vibisual/shared` 의 `isSessionRunning` 이 하고(서버·클라 공용 규약), 이 훅은 그
 * 판정에 필요한 조각을 store 에서 집어 오는 일만 한다. IDE 본문(하단 상태바)과 입력창([중지] 토글)이
 * **같은 값**을 봐야 하므로 두 곳이 각자 store 를 뒤지지 않고 여기로 모인다.
 *
 * §3.1 서버 = SSOT — 여기서 상태를 만들거나 전이시키지 않는다. 서버가 준 값의 조합일 뿐이다.
 */

import { isSessionRunning } from '@vibisual/shared';
import { useGraphStore } from '../stores/graphStore.js';
import { buildSessionRunInputs } from '../utils/sessionStatus.js';

/**
 * @param agentId          이 IDE 가 보고 있는 에이전트.
 * @param activeSessionId  열린 세션 탭. `null`(메인 탭)이면 스코프를 좁힐 세션이 없으므로
 *                         **에이전트 전체**를 본다(§5.5 #17-10 의 stop 범위 규칙과 같은 감각).
 */
export function useSessionRunning(agentId: string, activeSessionId: string | null): boolean {
  return useGraphStore((s) => {
    const sub = activeSessionId === null
      ? null
      : s.subAgents[agentId]?.find((x) => x.id === activeSessionId) ?? null;
    // 세션 탭인데 그 sub 를 아직 못 받았으면(스냅샷 지연) 판단 근거가 없다 — 조용히 false.
    if (activeSessionId !== null && !sub) return false;
    return isSessionRunning(buildSessionRunInputs({
      sub,
      commands: s.queuedCommands[agentId],
      runningTasks: s.runningSubagentTasks[agentId],
      acknowledged: activeSessionId !== null && !!s.acknowledgedSubAgents[activeSessionId],
    }));
  });
}
