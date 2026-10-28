import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FinishedSubagentTask, RunningSubagentTask, SubAgent } from '@vibisual/shared';
import { useGraphStore, selectIDEPane } from '../../stores/graphStore.js';
import { useIDEPaneValue, useIDEPaneKey } from './idePane.js';
import { selectSessionTasks, selectSessionFinished, countSessionTasks, countOtherTasks } from './runningSubagents.js';
import { RunningTaskRow, FinishedTaskRow } from './IDERunningSubagentsCards.js';
import { ScrollFade } from '../ScrollFade.js';

// §5.5 #17-9 ③ — 실행 중 서브에이전트 사이드바 뷰. 데이터는 §5.3 #12-1 훅 대차대조의 스냅샷 투영(`runningSubagentTasks`) — 새 폴링 ❌. 여닫음은 `activeView`(창마다 독립).
// 범위는 지금 보는 탭 하나(`runningSubagents.ts`) — 세션 탭이면 그 탭이 띄운 것, 메인 탭이면 에이전트 전부.
// ⑥ — 백단 것만 센다. 세션 탭 자신의 실행까지 세면 대화 중 늘 1건이 잡힌다.

const EMPTY_SUBS: SubAgent[] = [];

/** 현재 탭 기준 목록 — 활동바 항목과 뷰가 같은 산식을 쓰게 하는 단일 입구. */
export function useRunningSubagentTasks(agentId: string | null): RunningSubagentTask[] {
  const all = useGraphStore((s) => (agentId ? s.runningSubagentTasks[agentId] : undefined));
  const activeSessionId = useIDEPaneValue((o) => o.activeSessionId);
  return useMemo(() => selectSessionTasks(all, activeSessionId), [all, activeSessionId]);
}

/** 현재 탭 기준 개수만 필요할 때(활동바 점등·아래 숫자). 원시값이라 배열 참조 변화에 흔들리지 않는다. */
export function useRunningSubagentCount(agentId: string | null): number {
  const paneKey = useIDEPaneKey();
  return useGraphStore((s) =>
    countSessionTasks(agentId ? s.runningSubagentTasks[agentId] : undefined, selectIDEPane(s, paneKey).activeSessionId));
}

/** 이 탭 밖(다른 세션 탭 + 소유 탭 미상)에서 도는 수. */
export function useOtherRunningSubagentCount(agentId: string | null): number {
  const paneKey = useIDEPaneKey();
  return useGraphStore((s) =>
    countOtherTasks(agentId ? s.runningSubagentTasks[agentId] : undefined, selectIDEPane(s, paneKey).activeSessionId));
}

/** §5.5 #17-9 ⑦(b) — 이 탭이 띄웠다가 방금 끝난 자식들(새 것이 앞). 개수 산식에는 관여하지 않는다. */
export function useFinishedSubagentTasks(agentId: string | null): FinishedSubagentTask[] {
  const all = useGraphStore((s) => (agentId ? s.finishedSubagentTasks[agentId] : undefined));
  const activeSessionId = useIDEPaneValue((o) => o.activeSessionId);
  return useMemo(() => selectSessionFinished(all, activeSessionId), [all, activeSessionId]);
}

export const IDERunningSubagentsView = memo(function IDERunningSubagentsView({
  agentId,
}: { agentId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const tasks = useRunningSubagentTasks(agentId);
  const finished = useFinishedSubagentTasks(agentId);
  const others = useOtherRunningSubagentCount(agentId);
  const activeSessionId = useIDEPaneValue((o) => o.activeSessionId);
  const subs = useGraphStore((s) => s.subAgents[agentId]) ?? EMPTY_SUBS;

  // 경과 시간 표시용 1초 틱 — 이 뷰가 떠 있는 동안만 돈다(사이드바가 접히면 언마운트되며 정리).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // 응답 없는 자식을 장부에서만 내린다(프로세스는 그대로) — 그래야 세션이 완료로 갈 수 있다.
  const dismissTask = useCallback((taskId: string) => {
    void fetch(`/api/subagents/${agentId}/running-task/${encodeURIComponent(taskId)}`, { method: 'DELETE' })
      .catch(() => { /* 스냅샷이 권위 — 실패하면 다음 스냅샷에서 그대로 남는다 */ });
  }, [agentId]);

  // §5.5 #17-9 ④(c) — 개수가 0 이 돼도 스스로 닫지 않는다(자동 복귀하면 "눌러도 안 뜬다"로 보인다). 비면 빈 상태 문구, 활동바 항목은 열린 동안 남아 접을 손잡이가 된다.

  const labelOf = useMemo(() => {
    const map = new Map(subs.map((s) => [s.id, s.label]));
    return (subId: string | undefined): string | null => (subId ? map.get(subId) ?? null : null);
  }, [subs]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 p-2">
      <div className="flex items-center gap-1.5 px-1">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
          {t('ide.runningSubagents.title')}
        </span>
        {tasks.length > 0 && (
          <span className="rounded bg-sky-500/20 px-1 text-[12px] font-semibold tabular-nums text-sky-300">
            {tasks.length}
          </span>
        )}
      </div>

      {/* 지금 무슨 범위를 보고 있는지 한 줄 — 세션마다 다른 기능이라 범위를 늘 밝힌다. */}
      <p className="px-1 text-[12px] leading-snug text-gray-600">
        {activeSessionId === null
          ? t('ide.runningSubagents.scopeAll')
          : t('ide.runningSubagents.scopeSession', { label: labelOf(activeSessionId) ?? activeSessionId })}
      </p>

      {/* §5.5 #17-9 ⑦ — 위는 도는 것, 아래는 방금 끝난 것. 스크롤러는 하나라 두 구역이 함께 밀린다. */}
      <ScrollFade fill className="flex-1">
        {tasks.length === 0 ? (
          // §5.5 #17-9 ⑤ — 항목이 상시 노출이라 빈 상태가 정상이다 — 빈칸 대신 이 자리의 쓰임을 설명한다.
          <div className="flex flex-col gap-1.5 px-2 py-4 text-center">
            <p className="text-[12px] leading-relaxed text-gray-500">
              {activeSessionId === null ? t('ide.runningSubagents.empty') : t('ide.runningSubagents.emptySession')}
            </p>
            <p className="text-[12px] leading-relaxed text-gray-600">
              {t('ide.runningSubagents.hint')}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {tasks.map((task) => (
              <RunningTaskRow key={task.id} task={task} now={now} sessionLabel={labelOf(task.subAgentId)}
                onDismiss={dismissTask} />
            ))}
          </ul>
        )}

        {finished.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 px-1">
              <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-600">
                {t('ide.runningSubagents.finishedTitle')}
              </span>
              <span className="rounded bg-gray-700/60 px-1 text-[12px] font-semibold tabular-nums text-gray-400">
                {finished.length}
              </span>
            </div>
            <ul className="flex flex-col gap-1">
              {finished.map((task) => (
                <FinishedTaskRow key={`${task.id}-${task.endedAt}`} task={task} sessionLabel={labelOf(task.subAgentId)} />
              ))}
            </ul>
          </div>
        )}
      </ScrollFade>

      {others > 0 && (
        <p className="flex-shrink-0 border-t border-gray-800 px-1 pt-1 text-[12px] text-gray-500">
          {t('ide.runningSubagents.othersRunning', { count: others })}
        </p>
      )}
    </div>
  );
});
