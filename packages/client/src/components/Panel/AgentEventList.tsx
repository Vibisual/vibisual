import { memo, useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentEvent, TodoItem, SubAgent, QueuedCommand } from '@vibisual/shared';
import { ScrollFade } from '../ScrollFade.js';
import { TokenUsagePopup } from './TokenUsagePopup.js';

interface AgentEventListProps {
  events: AgentEvent[];
  subAgents?: SubAgent[];
  completedCommands?: QueuedCommand[];
  /** 에이전트 세션 ID (토큰 사용량 조회용) */
  sessionId?: string;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const time = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${month}/${day} ${time}`;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatWaitTime(queuedAt: number, executedAt: number): string {
  const diff = Math.max(0, executedAt - queuedAt);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

interface PromptDetailPopupProps {
  event: AgentEvent;
  sessionId?: string;
  onClose: () => void;
}

function PromptDetailPopup({ event, sessionId, onClose }: PromptDetailPopupProps): React.JSX.Element {
  const { t } = useTranslation();
  const [showTokens, setShowTokens] = useState(false);

  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        if (showTokens) { setShowTokens(false); return; }
        onClose();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, showTokens]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span className="text-sm font-semibold text-gray-100">Prompt</span>
            {event.source === 'queue' && (
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                queue
              </span>
            )}
            {sessionId && (
              <button
                type="button"
                onClick={() => setShowTokens(true)}
                className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400 transition-colors hover:bg-amber-500/20"
              >
                Token Usage
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {event.source === 'queue' && event.queuedAt && (
              <span className="text-[10px] text-amber-400/70">
                waited {formatWaitTime(event.queuedAt, event.timestamp)}
              </span>
            )}
            <span className="text-xs text-gray-500">{formatDate(event.timestamp)}</span>
            <button
              type="button"
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200"
              aria-label="Close popup"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Token Usage Popup — 이 프롬프트만 */}
        {showTokens && sessionId && (
          <TokenUsagePopup
            sessionId={sessionId}
            eventTimestamp={event.timestamp}
            mode="turn"
            onClose={() => setShowTokens(false)}
          />
        )}

        {/* Body */}
        <ScrollFade fill className="min-h-0 flex-1 p-4">
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-200">
            {event.message}
          </p>

          {event.response && (
            <div className="mt-4 rounded-lg border border-emerald-700/40 bg-emerald-900/20 p-3">
              <div className="mb-1.5 flex items-center gap-1.5">
                <svg className="h-3.5 w-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM12 2v4m0 12v4M2 12h4m12 0h4" />
                </svg>
                <span className="text-xs font-semibold text-emerald-400">Result</span>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-emerald-200/90">
                {event.response}
              </p>
            </div>
          )}

          {/* Todos */}
          {event.todos && event.todos.length > 0 && (
            <div className="mt-4 rounded-lg border border-indigo-700/40 bg-indigo-900/20 p-3">
              <div className="mb-2 flex items-center gap-1.5">
                <svg className="h-3.5 w-3.5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                <span className="text-xs font-semibold text-indigo-400">
                  Todos ({event.todos.filter((t) => t.status === 'completed').length}/{event.todos.length})
                </span>
              </div>
              <ul className="flex flex-col gap-1">
                {event.todos.map((todo, idx) => {
                  const si = TODO_STATUS_ICON[todo.status] ?? TODO_STATUS_ICON['pending']!;
                  return (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <span className={`mt-0.5 flex-shrink-0 text-xs ${si.color}`}>{si.icon}</span>
                      <span className={`leading-relaxed ${todo.status === 'completed' ? 'text-gray-400 line-through' : 'text-indigo-200/90'}`}>
                        {todo.content}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </ScrollFade>
      </div>
    </div>
  );
}

/** 토큰 수 포맷 (1234 → "1.2K") */
function formatTokenShort(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

/** 통합 결과 항목 — AgentEvent + completedCommand 합쳐서 시간순 표시 */
interface ResultItem {
  id: string;
  message: string;
  response?: string;
  timestamp: number;
  source: 'user' | 'queue';
  sessionLabel?: string;
  queuedAt?: number;
  isError?: boolean;
  /** 이 명령에 사용된 입력 토큰 */
  inputTokens?: number;
  /** 이 명령에 사용된 출력 토큰 */
  outputTokens?: number;
  /** 해당 턴의 TodoWrite 항목 */
  todos?: TodoItem[];
  /** 서브에이전트 세션 ID (토큰 조회용, queue 소스만) */
  subAgentSessionId?: string;
}

/** Todo 상태 아이콘 */
const TODO_STATUS_ICON: Record<string, { icon: string; color: string }> = {
  completed: { icon: '\u2713', color: 'text-emerald-400' },
  in_progress: { icon: '\u25CF', color: 'text-blue-400' },
  pending: { icon: '\u25CB', color: 'text-gray-500' },
};

export const AgentEventList = memo(function AgentEventList({
  events,
  subAgents = [],
  completedCommands = [],
  sessionId,
}: AgentEventListProps): React.JSX.Element | null {
  const [selected, setSelected] = useState<AgentEvent | null>(null);
  /** 선택된 항목의 세션 ID (서브에이전트면 서브 세션, 아니면 부모 세션) */
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(undefined);
  const handleClose = useCallback(() => { setSelected(null); setSelectedSessionId(undefined); }, []);

  // subagent ID → label / sessionId 매핑
  const subLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of subAgents) map.set(s.id, s.label);
    return map;
  }, [subAgents]);

  const subSessionMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of subAgents) {
      if (s.sessionId) map.set(s.id, s.sessionId);
    }
    return map;
  }, [subAgents]);

  // AgentEvent (부모 직접 대화) + completedCommands (subagent 실행) 합치기
  const results: ResultItem[] = useMemo(() => {
    const items: ResultItem[] = [];

    // 부모 에이전트의 직접 대화 결과
    for (const evt of events) {
      if (!evt.message) continue;
      items.push({
        id: evt.id,
        message: evt.message,
        response: evt.response,
        timestamp: evt.timestamp,
        source: evt.source ?? 'user',
        queuedAt: evt.queuedAt,
        todos: evt.todos,
      });
    }

    // subagent 실행 완료/에러 결과
    for (const cmd of completedCommands) {
      items.push({
        id: cmd.id,
        message: cmd.text,
        response: cmd.result,
        timestamp: cmd.timestamp,
        source: 'queue',
        sessionLabel: cmd.subAgentId ? (subLabelMap.get(cmd.subAgentId) ?? cmd.subAgentId) : undefined,
        isError: cmd.status === 'error',
        inputTokens: cmd.inputTokens,
        outputTokens: cmd.outputTokens,
        subAgentSessionId: cmd.subAgentId ? subSessionMap.get(cmd.subAgentId) : undefined,
      });
    }

    // 최신순 정렬
    items.sort((a, b) => b.timestamp - a.timestamp);
    return items;
  }, [events, completedCommands, subLabelMap]);

  if (results.length === 0) return null;

  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-gray-500">
          Results ({results.length})
        </span>
        <ScrollFade maxHeight={256}>
          <ul className="flex flex-col gap-1.5">
            {results.map((item) => (
              <li
                key={item.id}
                className={`min-w-0 cursor-pointer overflow-hidden rounded border px-2.5 py-1.5 transition-colors hover:border-gray-600 hover:bg-gray-700/60 ${
                  item.isError ? 'border-red-500/40 bg-red-900/20' : 'border-gray-700/50 bg-gray-800/60'
                }`}
                onClick={() => { setSelected({ id: item.id, message: item.message, response: item.response, timestamp: item.timestamp, source: item.source, todos: item.todos }); setSelectedSessionId(item.subAgentSessionId ?? sessionId); }}
              >
                <p className="line-clamp-3 break-all text-xs leading-relaxed text-gray-200">
                  {item.message}
                </p>
                {/* Todo 요약 (있을 때만) */}
                {item.todos && item.todos.length > 0 && (() => {
                  const done = item.todos.filter((t) => t.status === 'completed').length;
                  return (
                    <div className="mt-1 flex items-center gap-1.5 rounded bg-indigo-500/10 px-1.5 py-0.5">
                      <svg className="h-3 w-3 flex-shrink-0 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                      </svg>
                      <span className="text-[10px] text-indigo-300/80">
                        Todos {done}/{item.todos.length}
                      </span>
                    </div>
                  );
                })()}
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[10px] text-gray-500">
                    {formatTime(item.timestamp)}
                  </span>
                  {item.sessionLabel && (
                    <span className="rounded bg-cyan-500/15 px-1 py-px text-[9px] font-semibold text-cyan-400/80">
                      {item.sessionLabel}
                    </span>
                  )}
                  {!item.sessionLabel && item.source === 'queue' && (
                    <span className="rounded bg-amber-500/15 px-1 py-px text-[9px] font-semibold text-amber-400/80">
                      queue
                    </span>
                  )}
                  {item.isError && (
                    <span className="rounded bg-red-500/20 px-1 py-px text-[9px] font-semibold text-red-400">
                      error
                    </span>
                  )}
                  {item.source === 'user' && !item.isError && (
                    <span className="rounded bg-gray-600/30 px-1 py-px text-[9px] text-gray-500">
                      direct
                    </span>
                  )}
                  {item.inputTokens != null && item.inputTokens > 0 && (
                    <span className="ml-auto rounded bg-violet-500/15 px-1 py-px text-[9px] text-violet-400/80">
                      {formatTokenShort(item.inputTokens)} in / {formatTokenShort(item.outputTokens ?? 0)} out
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </ScrollFade>
      </div>

      {selected && <PromptDetailPopup event={selected} sessionId={selectedSessionId} onClose={handleClose} />}
    </>
  );
});
