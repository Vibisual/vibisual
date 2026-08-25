import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FinishedSubagentTask, RunningSubagentTask, SubAgent } from '@vibisual/shared';
import { useGraphStore, selectIDEPane } from '../../stores/graphStore.js';
import { useIDEPaneValue, useIDEPaneKey } from './idePane.js';
import { selectSessionTasks, selectSessionFinished, countSessionTasks, countOtherTasks } from './runningSubagents.js';
import { RunningTaskRow, FinishedTaskRow } from './IDERunningSubagentsCards.js';
import { ScrollFade } from '../ScrollFade.js';

// §5.5 #17-9 v3.51 / ③ v4.95 — 실행 중 서브에이전트 뷰.
//
// 커스텀(감독관) 에이전트가 Task/Agent 도구로 백단에 띄운 자식들이 지금 몇 개, 무슨 내용으로 도는지
// 보여준다. 데이터 출처는 §5.3 #12-1 v3.43 훅 대차대조의 스냅샷 투영(`runningSubagentTasks`) —
// 새 폴링/타이머 없이 기존 graph_snapshot 에 얹혀 온다.
//
// v4.95 — 세션창을 덮던 패널을 벗고 **사이드바 뷰**(`IDEViewType='subagents'`)가 됐다. 스킬·목표·루프·
// 북마크와 같은 자리·같은 규약(같은 항목 재클릭 = 접힘)이고, 여닫는 상태가 `activeView` 로 들어가
// **프로젝트(창)마다 독립**이다(종전 전역 boolean `subagentPanelOpen` 은 폐지).
//
// 범위는 **지금 보고 있는 탭** 하나로 통일한다(`runningSubagents.ts` 산식) — 세션 탭이면 그 탭이 띄운
// 것만, 메인 탭이면 그 에이전트 전부. 이 탭 밖에서 도는 것은 발치 한 줄로만 알린다.
//
// ⑥ v5.07 — 여기 실리는 것은 **백단에서 도는 것뿐**이다. 지금 사용자와 나누고 있는 대화(세션 탭 자신의
// 실행)는 바로 옆 스트림이 이미 보여 주므로 세지 않는다 — 그것까지 세면 대화 중에는 늘 1건이 잡혀
// "백단에 몇 개?"라는 이 화면의 유일한 질문이 오염된다(v5.03 ④(a) 합류 철회).

const EMPTY_SUBS: SubAgent[] = [];

/**
 * 이 에이전트에서 지금 도는 서브에이전트 목록을 **현재 탭 기준**으로 돌려준다.
 * 활동바 항목과 이 뷰가 같은 산식을 쓰게 하는 단일 입구.
 */
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

/**
 * 실행 중 서브에이전트 뷰 — `IDESidebar` 의 `VIEW_MAP['subagents']`.
 * 활동바 항목을 누르면 여기로 바뀌고, 같은 항목을 다시 누르면 사이드바가 접힌다.
 */
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

  // 응답 없는 자식 하나만 실행 목록에서 내린다 — 프로세스를 끊는 게 아니라 **장부에서 내리는 것**이라,
  //   그 세션이 완료로 갈 수 있게 된다(종전에는 세션 전체 중지 말고는 방법이 없었다).
  const dismissTask = useCallback((taskId: string) => {
    void fetch(`/api/subagents/${agentId}/running-task/${encodeURIComponent(taskId)}`, { method: 'DELETE' })
      .catch(() => { /* 스냅샷이 권위 — 실패하면 다음 스냅샷에서 그대로 남는다 */ });
  }, [agentId]);

  // §5.5 #17-9 ④(c) v5.03 — **스스로 물러나지 않는다.** 종전엔 개수가 0 이 되면 `terminal` 로
  // 자동 복귀했는데, 그 규칙 탓에 사용자가 직접 연 뷰가 눈앞에서 닫히고(그 순간 도는 게 없으면
  // 아예 열리지 않는 것처럼 보였다) v4.95 가 잡으려던 "눌러도 안 뜬다"가 다른 입구로 재발했다.
  // 사용자가 연 사이드바 뷰는 사용자가 접을 때까지 남고, 도는 게 없으면 빈 상태 문구로 말한다
  // (활동바 항목은 `activeView==='subagents'` 동안 회색으로 남아 접을 손잡이가 유지된다).

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
          // §5.5 #17-9 ⑤ v5.06 — 항목이 상시 노출이라 **도는 게 없을 때 눌러 들어오는 것이 정상**이다.
          //   그 경우 빈칸이 아니라 "여기가 무엇을 보여 주는 자리인지"를 설명한다(사용자 지시).
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
