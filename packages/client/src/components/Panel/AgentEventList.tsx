import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentEvent, SubAgent, QueuedCommand } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { formatSince } from '../../formatSince.js';
import { pickLatestAgentResult } from './latestAgentResult.js';

interface AgentEventListProps {
  /** 이 패널의 에이전트 — 칸을 누르면 이 에이전트의 IDE 가 열린다. */
  agentId: string;
  events: AgentEvent[];
  subAgents?: SubAgent[];
  completedCommands?: QueuedCommand[];
}

const EMPTY_SUB_AGENTS: SubAgent[] = [];
const EMPTY_COMMANDS: QueuedCommand[] = [];

/**
 * §7.1 (판올림 번호 발급 대기, 사용자 지시 2026-10-12) — 에이전트의 **마지막 결과 한 건**.
 *
 * 종전에는 명령/응답 기록 전부를 최신순 목록으로 그리고, 항목을 누르면 전문 모달을 띄웠다. 그 목록은
 * 사실상 프롬프트 목록이었고(결과는 모달 안에만), 모달은 이어 말할 수도 그 대화로 갈 수도 없는 막다른
 * 길이었다 — 같은 글을 IDE 스트림·지휘통제실 검색에 이어 세 번째로 그린 것이기도 했다.
 * 이제 "방금 끝낸 것" 하나만 보여 주고, 누르면 IDE 의 그 세션으로 간다.
 *
 * **목록을 되살리지 마라** — 전체 기록은 IDE 와 지휘통제실이 맡는다. 턴별 토큰 수는 [청구 토큰] 팝업의
 * 토큰 로그에 있다. 무엇이 그 한 건인지는 `latestAgentResult.ts` 가 정한다.
 * 이름(`AgentEventList`)은 SSOT §7.1 이 이 이름으로 가리키므로 그대로 둔다.
 */
export const AgentEventList = memo(function AgentEventList({
  agentId,
  events,
  subAgents = EMPTY_SUB_AGENTS,
  completedCommands = EMPTY_COMMANDS,
}: AgentEventListProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const openIDEOverlay = useGraphStore((s) => s.openIDEOverlay);
  const latest = useMemo(
    () => pickLatestAgentResult(events, completedCommands, subAgents),
    [events, completedCommands, subAgents],
  );

  const handleOpen = useCallback(() => {
    if (!latest) return;
    // 그 세션이 아직 목록에 있을 때만 세운다(이름이 달렸다 = 목록에 있다). `setIDEActiveSession` 은 세션이
    //   있는지 보지 않고 세우므로, 닫힌 세션 id 를 넘기면 목록에 없는 세션이 앞에 선다.
    //   세션 없는 직접 대화(훅 버블)도 고르지 않고 연다 — 마지막에 보던 자리.
    if (latest.sessionId !== null && latest.sessionLabel !== undefined) {
      openIDEOverlay(agentId, { focus: { sessionId: latest.sessionId } });
    } else {
      openIDEOverlay(agentId);
    }
  }, [agentId, latest, openIDEOverlay]);

  if (!latest) return null;
  const todos = latest.todos;
  const doneTodos = todos ? todos.filter((todo) => todo.status === 'completed').length : 0;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        {/* Task Edge 패널의 「마지막 결과」와 같은 키 — 같은 말을 두 키로 두지 않는다. */}
        <span className="text-xs text-gray-500">{t('panel.taskEdgeDetail.lastResult')}</span>
        <span
          className="flex-shrink-0 whitespace-nowrap text-[12px] text-gray-600"
          title={new Date(latest.at).toLocaleString()}
        >
          {formatSince(latest.at, t)}
        </span>
      </div>
      {/* `items-stretch` 를 빼지 마라 — 브라우저 기본 스타일이 <button> 에 `align-items: flex-start` 를 준다. 세로 flex
          버튼에 그 값이 남으면 안쪽 줄이 카드 폭이 아니라 제 글자 길이만큼 넓어져, `truncate` 가 듣지 않고 명령 줄·결과
          줄이 테두리 밖으로 샌다(세션 목록 행 `SubAgentList` 도 같은 사정). */}
      <button
        type="button"
        onClick={handleOpen}
        title={t('commandCenter.jump')}
        className={`flex w-full min-w-0 flex-col items-stretch gap-1 rounded border px-2.5 py-1.5 text-left transition-colors hover:border-gray-600 hover:bg-gray-700/60 ${
          latest.isError ? 'border-red-500/40 bg-red-900/20' : 'border-gray-700/50 bg-gray-800/60'
        }`}
      >
        {/* 보낸 말 — 무엇에 대한 결과인지만 알면 되므로 한 줄. 전문은 IDE 에서. */}
        <span className="block truncate text-[12px] text-gray-500">{latest.prompt}</span>
        {/* 결과 앞 세 줄 — 이 칸의 본체다. */}
        {latest.preview && (
          <span className="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-200">
            {latest.preview}
          </span>
        )}
        {(latest.sessionLabel !== undefined || latest.isError || todos) && (
          <span className="flex flex-wrap items-center gap-1">
            {latest.sessionLabel !== undefined && (
              <span className="max-w-full truncate rounded bg-cyan-500/15 px-1 py-px text-[12px] font-semibold text-cyan-400/80">
                {latest.sessionLabel}
              </span>
            )}
            {/* 세션 목록과 같은 낱말("오류") — 같은 사실을 두 칸이 다른 말로 하지 않게. */}
            {latest.isError && (
              <span className="rounded bg-red-500/20 px-1 py-px text-[12px] font-semibold text-red-400">
                {t('panel.subAgent.status.error')}
              </span>
            )}
            {todos && (
              <span className="flex items-center gap-1 rounded bg-indigo-500/10 px-1.5 py-px text-[12px] text-indigo-300/80">
                <svg
                  className="h-3 w-3 flex-shrink-0 text-indigo-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                {t('panel.agentEventList.todosCompact', { done: doneTodos, total: todos.length })}
              </span>
            )}
          </span>
        )}
      </button>
    </div>
  );
});
