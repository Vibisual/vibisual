import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RunningSubagentTask, SubAgent } from '@vibisual/shared';
import { useGraphStore, selectIDEOverlay } from '../../stores/graphStore.js';

// §5.5 #17-9 v3.51 — 실행 중 서브에이전트 보드.
//
// 커스텀(감독관) 에이전트가 Task/Agent 도구로 백단에 띄운 자식들이 지금 몇 개, 무슨 내용으로 도는지
// 보여준다. 데이터 출처는 §5.3 #12-1 v3.43 훅 대차대조의 스냅샷 투영(`runningSubagentTasks`) —
// 새 폴링/타이머 없이 기존 graph_snapshot 에 얹혀 온다.
//
// 세션 필터: 세션 탭이 선택돼 있으면 그 탭이 띄운 것만, 메인 탭(null)이면 그 에이전트 전부.
// 마지막 하나가 끝나면 목록이 비고, 그 순간 이 패널은 스스로 닫힌다(활동바 아이콘도 함께 사라진다).

const EMPTY_TASKS: RunningSubagentTask[] = [];
const EMPTY_SUBS: SubAgent[] = [];

/**
 * 이 에이전트에서 지금 도는 서브에이전트 목록을 세션 필터까지 적용해 돌려준다.
 * 활동바 배지와 이 패널이 **같은 산식**을 써야 "배지 3인데 목록은 1" 같은 어긋남이 안 생긴다.
 */
export function useRunningSubagentTasks(agentId: string | null): RunningSubagentTask[] {
  const all = useGraphStore((s) => (agentId ? s.runningSubagentTasks[agentId] : undefined)) ?? EMPTY_TASKS;
  const activeSessionId = useGraphStore((s) => selectIDEOverlay(s).activeSessionId);
  return useMemo(() => {
    if (activeSessionId === null) return all;
    return all.filter((t) => t.subAgentId === activeSessionId);
  }, [all, activeSessionId]);
}

/** 경과 시간 — 초/분/시간 단위로 짧게. 1초마다 갱신되는 now 를 받아 순수 계산으로 유지. */
function formatElapsed(startedAt: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

interface Props {
  agentId: string;
  onClose: () => void;
}

export const IDERunningSubagentsView = memo(function IDERunningSubagentsView({
  agentId,
  onClose,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const tasks = useRunningSubagentTasks(agentId);
  const activeSessionId = useGraphStore((s) => selectIDEOverlay(s).activeSessionId);
  const subs = useGraphStore((s) => s.subAgents[agentId]) ?? EMPTY_SUBS;

  // 경과 시간 표시용 1초 틱 — 이 패널이 열려 있는 동안만 돈다(닫히면 언마운트되며 정리).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // 마지막 자식이 끝나면 보여줄 게 없다 → 스스로 닫는다(사용자가 X 를 누를 필요 없이 "자동 사라짐").
  useEffect(() => {
    if (tasks.length === 0) onClose();
  }, [tasks.length, onClose]);

  const labelOf = useMemo(() => {
    const map = new Map(subs.map((s) => [s.id, s.label]));
    return (subId: string | undefined): string | null => (subId ? map.get(subId) ?? null : null);
  }, [subs]);

  return (
    <div className="flex h-full w-full flex-col bg-gray-950">
      {/* 헤더 */}
      <div className="flex h-10 flex-shrink-0 items-center justify-between border-b border-gray-700 bg-gray-900/80 px-4">
        <span className="flex items-center gap-2 text-[14px] font-bold text-gray-100">
          <svg className="h-4 w-4 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          {t('ide.runningSubagents.title')}
          <span className="text-gray-500">({tasks.length})</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('ide.runningSubagents.close')}
          title={t('ide.runningSubagents.close')}
          className="flex h-7 w-7 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-200"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* 필터 안내 — 지금 무슨 범위를 보고 있는지(이 세션 / 전체) 한 줄. */}
      <div className="flex-shrink-0 border-b border-gray-800 px-4 py-1.5 text-[11px] text-gray-500">
        {activeSessionId === null
          ? t('ide.runningSubagents.scopeAll')
          : t('ide.runningSubagents.scopeSession', { label: labelOf(activeSessionId) ?? activeSessionId })}
      </div>

      {/* 본문 */}
      {tasks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] leading-relaxed text-gray-400">
          {t('ide.runningSubagents.empty')}
        </div>
      ) : (
        <div className="scrollbar-thin flex flex-1 flex-col gap-2 overflow-y-auto p-4">
          {tasks.map((task) => {
            const sessionLabel = labelOf(task.subAgentId);
            return (
              <div key={task.id} className="rounded-lg border border-sky-500/30 bg-gray-800 px-4 py-3 shadow-md">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-sky-400" />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-white">
                    {task.description || task.subagentType || t('ide.runningSubagents.untitled')}
                  </span>
                  <span className="flex-shrink-0 rounded bg-gray-700/70 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-sky-200">
                    {formatElapsed(task.startedAt, now)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[10.5px]">
                  {task.subagentType && (
                    <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-semibold text-sky-300">
                      {task.subagentType}
                    </span>
                  )}
                  {sessionLabel && (
                    <span className="rounded bg-gray-700/60 px-1.5 py-0.5 font-medium text-gray-300">
                      {sessionLabel}
                    </span>
                  )}
                </div>
                {task.prompt && (
                  <p className="mt-2 line-clamp-3 break-words text-[12px] leading-relaxed text-gray-400">
                    {task.prompt}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
