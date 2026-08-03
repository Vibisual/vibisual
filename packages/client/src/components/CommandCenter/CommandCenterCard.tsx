import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import { contextLevel, elapsedParts, type CommandCenterItem } from './commandCenterModel.js';

// SCENARIO.md §5.12 (D) — 카드 한 장 = 세션 한 개. 액션은 **둘뿐**이다:
//   (1) 그 세션으로 점프(메인 창) — vibisual:command:reveal-in-main
//   (2) 가지 않고 명령 보내기 — 기존 명령 큐(addCommand → POST /api/commands/:sessionId)
// 스트림 읽기(미니 IDE)는 이 창에 넣지 않는다(A안 결정, §5.12 (G)).

const LANE_TONE: Record<string, { dot: string; chip: string }> = {
  'needs-answer': { dot: 'bg-rose-400', chip: 'bg-rose-500/15 text-rose-200 ring-rose-400/30' },
  'needs-review': { dot: 'bg-violet-400', chip: 'bg-violet-500/15 text-violet-200 ring-violet-400/30' },
  'needs-action': { dot: 'bg-amber-400', chip: 'bg-amber-500/15 text-amber-200 ring-amber-400/30' },
  working: { dot: 'bg-sky-400', chip: 'bg-sky-500/15 text-sky-200 ring-sky-400/30' },
  done: { dot: 'bg-gray-500', chip: 'bg-white/[0.06] text-gray-300 ring-white/10' },
};

export interface CommandCenterCardProps {
  item: CommandCenterItem;
  projectId: string;
  now: number;
}

export function CommandCenterCard({ item, projectId, now }: CommandCenterCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const [commandOpen, setCommandOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tone = LANE_TONE[item.lane] ?? LANE_TONE['done']!;
  const ctx = contextLevel(item.contextUsed, item.contextMax);

  const elapsed = (at: number): string => {
    const { unit, value } = elapsedParts(now - at);
    if (unit === 'now') return t('commandCenter.time.now', { defaultValue: 'just now' });
    if (unit === 'min') return t('commandCenter.time.min', { defaultValue: '{{count}}m', count: value });
    if (unit === 'hour') return t('commandCenter.time.hour', { defaultValue: '{{count}}h', count: value });
    return t('commandCenter.time.day', { defaultValue: '{{count}}d', count: value });
  };

  // (1) 점프 — 메인 창을 앞으로 끌어올리고 그 세션 IDE 를 연다.
  const handleJump = useCallback((): void => {
    void window.api?.command?.revealInMain({
      projectId,
      agentId: item.agentId,
      subAgentId: item.subAgentId,
    });
  }, [projectId, item.agentId, item.subAgentId]);

  // (2) 가지 않고 명령 — 기존 큐 경로 그대로. 새 전송 경로를 만들지 않는다.
  const handleSend = useCallback((): void => {
    const text = draft.trim();
    if (!text) return;
    useGraphStore.getState().addCommand(item.agentId, text, item.subAgentId);
    setDraft('');
    setCommandOpen(false);
  }, [draft, item.agentId, item.subAgentId]);

  const handleDismiss = useCallback((): void => {
    setMenuOpen(false);
    void fetch('/api/dismiss-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: item.agentId }),
    }).catch(() => {});
  }, [item.agentId]);

  const handleStop = useCallback((): void => {
    setMenuOpen(false);
    const path = item.subAgentId
      ? `/api/subagents/${item.agentId}/${item.subAgentId}/stop`
      : `/api/subagents/${item.agentId}/stop-all`;
    void fetch(path, { method: 'POST' }).catch(() => {});
  }, [item.agentId, item.subAgentId]);

  const handleCloseTab = useCallback((): void => {
    setMenuOpen(false);
    if (!item.subAgentId) return;
    useGraphStore.getState().optimisticRemoveSubAgent(item.agentId, item.subAgentId);
    void fetch(`/api/subagents/${item.agentId}/${item.subAgentId}`, { method: 'DELETE' }).catch(() => {});
  }, [item.agentId, item.subAgentId]);

  // §5.12 (E) — 카드가 없어 무슨 일을 했는지 모르는 세션의 한 줄 요약.
  const handleSummarize = useCallback((): void => {
    setMenuOpen(false);
    if (!item.subAgentId || busy) return;
    setBusy(true);
    void fetch(`/api/subagents/${item.agentId}/${item.subAgentId}/summary`, { method: 'POST' })
      .then((r) => r.json() as Promise<{ ok?: boolean; text?: string }>)
      .then((data) => { setSummary(data.ok && data.text ? data.text : t('commandCenter.summaryFailed', { defaultValue: 'Could not summarize this session.' })); })
      .catch(() => { setSummary(t('commandCenter.summaryFailed', { defaultValue: 'Could not summarize this session.' })); })
      .finally(() => { setBusy(false); });
  }, [item.agentId, item.subAgentId, busy, t]);

  return (
    <div
      data-command-card={item.key}
      className={`group relative rounded-lg border bg-gray-900/70 px-3 py-2.5 transition-colors hover:bg-gray-900 ${
        item.unacknowledged ? 'border-emerald-500/40' : 'border-white/[0.07]'
      }`}
    >
      {/* 머리 — 에이전트 색 점 · 라벨 · 레인 배지 */}
      <div className="flex items-start gap-2">
        <span
          className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ring-2 ring-black/30"
          style={{ backgroundColor: item.agentColor }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-semibold text-gray-100">{item.agentLabel}</span>
            {item.subAgentId && (
              <>
                <span className="text-[10px] text-gray-600">/</span>
                <span className="truncate text-[11px] text-gray-400">{item.sessionLabel}</span>
              </>
            )}
            {!item.subAgentId && (
              <span className="rounded bg-white/[0.05] px-1 py-[1px] text-[9px] uppercase tracking-wide text-gray-500">
                {t('commandCenter.mainSession', { defaultValue: 'main' })}
              </span>
            )}
          </div>

          {item.laneReason && (
            <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-gray-400">{item.laneReason}</p>
          )}

          {/* 메타 줄 — 마지막 도구 · 경과 · 대기 · 큐 · 컨텍스트 */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-gray-500">
            <span className={`rounded px-1.5 py-[1px] ring-1 ${tone.chip}`}>
              {t(`commandCenter.lane.${item.lane}`, { defaultValue: item.lane })}
            </span>
            {item.lastTool && <span className="font-mono text-gray-400">{item.lastTool}</span>}
            {item.waitingSince !== null && (
              <span className="text-amber-300/80">
                {t('commandCenter.waitingFor', { defaultValue: 'waiting {{time}}', time: elapsed(item.waitingSince) })}
              </span>
            )}
            {item.lastActivityAt > 0 && <span>{elapsed(item.lastActivityAt)}</span>}
            {item.queuedCount > 0 && (
              <span className="text-sky-300/80">
                {t('commandCenter.queued', { defaultValue: '{{count}} queued', count: item.queuedCount })}
              </span>
            )}
            {item.runningTaskCount > 0 && (
              <span className="text-sky-300/80">
                {t('commandCenter.running', { defaultValue: '{{count}} running', count: item.runningTaskCount })}
              </span>
            )}
            {ctx && (
              <span className="flex items-center gap-1">
                <span className="h-1 w-10 overflow-hidden rounded-full bg-white/10">
                  <span
                    className={`block h-full rounded-full ${
                      ctx.level === 'critical' ? 'bg-red-400' : ctx.level === 'warn' ? 'bg-amber-400' : 'bg-emerald-400'
                    }`}
                    style={{ width: `${Math.round(ctx.ratio * 100)}%` }}
                  />
                </span>
                <span className={ctx.level === 'critical' ? 'text-red-300' : ctx.level === 'warn' ? 'text-amber-300' : ''}>
                  {Math.round(ctx.ratio * 100)}%
                </span>
              </span>
            )}
          </div>
        </div>

        {/* 액션 */}
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={handleJump}
            className="rounded px-1.5 py-1 text-[10px] text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-gray-100"
            title={t('commandCenter.jumpHint', { defaultValue: 'Open this session in the main window' })}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 4h6v6M20 4l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setCommandOpen((v) => !v)}
            className={`rounded px-1.5 py-1 text-[10px] transition-colors hover:bg-white/[0.08] hover:text-gray-100 ${
              commandOpen ? 'text-sky-300' : 'text-gray-400'
            }`}
            title={t('commandCenter.commandHint', { defaultValue: 'Send a message without leaving this window' })}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z" />
            </svg>
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded px-1.5 py-1 text-gray-500 transition-colors hover:bg-white/[0.08] hover:text-gray-100"
              title={t('commandCenter.moreHint', { defaultValue: 'More actions' })}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="5" r="1" />
                <circle cx="12" cy="12" r="1" />
                <circle cx="12" cy="19" r="1" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-7 z-20 w-44 overflow-hidden rounded-md border border-white/10 bg-gray-900 py-1 shadow-lg shadow-black/60">
                {item.unacknowledged && (
                  <MenuItem onClick={handleDismiss} label={t('commandCenter.actionDismiss', { defaultValue: 'Mark as checked' })} />
                )}
                <MenuItem onClick={handleStop} label={t('commandCenter.actionStop', { defaultValue: 'Stop this session' })} />
                {item.subAgentId && (
                  <MenuItem onClick={handleSummarize} label={t('commandCenter.actionSummarize', { defaultValue: 'Summarize in one line' })} />
                )}
                {item.subAgentId && (
                  <MenuItem onClick={handleCloseTab} label={t('commandCenter.actionCloseTab', { defaultValue: 'Close this session tab' })} danger />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {busy && (
        <p className="mt-2 text-[10px] text-gray-500">{t('commandCenter.summarizing', { defaultValue: 'Summarizing…' })}</p>
      )}
      {summary && (
        <p className="mt-2 rounded bg-white/[0.04] px-2 py-1.5 text-[11px] leading-snug text-gray-300">{summary}</p>
      )}

      {/* 질문 레인 — 제안 응답 프롬프트 칩. 누르면 입력창에 채워진다. */}
      {item.lane === 'needs-answer' && item.questionPrompts.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.questionPrompts.map((prompt, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => { setDraft(prompt); setCommandOpen(true); }}
              className="max-w-full truncate rounded-full bg-rose-500/10 px-2 py-[3px] text-[10px] text-rose-200 ring-1 ring-rose-400/25 transition-colors hover:bg-rose-500/20"
              title={prompt}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {/* 인라인 명령창 */}
      {commandOpen && (
        <div className="mt-2 flex items-end gap-1.5">
          <textarea
            autoFocus
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSend();
              }
              if (e.key === 'Escape') { e.preventDefault(); setCommandOpen(false); }
            }}
            placeholder={t('commandCenter.commandPlaceholder', { defaultValue: 'Message this session… (Enter to send)' })}
            className="min-w-0 flex-1 resize-none rounded border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-gray-100 outline-none placeholder:text-gray-600 focus:border-sky-500/50"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!draft.trim()}
            className="rounded bg-sky-600/80 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-gray-600"
          >
            {t('commandCenter.send', { defaultValue: 'Send' })}
          </button>
        </div>
      )}
    </div>
  );
}

function MenuItem({ onClick, label, danger }: { onClick: () => void; label: string; danger?: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-white/[0.08] ${
        danger ? 'text-red-300' : 'text-gray-300'
      }`}
    >
      {label}
    </button>
  );
}
