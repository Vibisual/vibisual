import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import { sessionStopUrl } from '../../hooks/useSessionStop.js';
import { contextLevel, elapsedParts, waitingLevel, type CommandCenterItem } from './commandCenterModel.js';

// SCENARIO.md §5.12 (D)(H) — 카드 한 장 = 세션 한 개. 액션은 **둘뿐**이다:
//   (1) 그 세션으로 점프(메인 창) — vibisual:command:reveal-in-main
//   (2) 가지 않고 명령 보내기 — 기존 명령 큐(addCommand → POST /api/commands/:sessionId)
// 스트림 읽기(미니 IDE)는 이 창에 넣지 않는다(A안 결정, §5.12 (G)).
//
// v4.44 (H): 카드는 **선택 가능**해졌다 — 고르면 오른쪽 상세 패널이 근거 원문을 펼친다.
// 왼쪽 레인 색 띠는 스크롤 중에도 종류를 구분하기 위한 것(글자를 읽지 않아도 보이게).

const LANE_TONE: Record<string, { dot: string; chip: string; strip: string }> = {
  'needs-answer': { dot: 'bg-rose-400', chip: 'bg-rose-500/15 text-rose-200 ring-rose-400/30', strip: 'bg-rose-400/70' },
  'needs-review': { dot: 'bg-violet-400', chip: 'bg-violet-500/15 text-violet-200 ring-violet-400/30', strip: 'bg-violet-400/70' },
  'needs-action': { dot: 'bg-amber-400', chip: 'bg-amber-500/15 text-amber-200 ring-amber-400/30', strip: 'bg-amber-400/70' },
  working: { dot: 'bg-sky-400', chip: 'bg-sky-500/15 text-sky-200 ring-sky-400/30', strip: 'bg-sky-400/70' },
  done: { dot: 'bg-gray-500', chip: 'bg-white/[0.06] text-gray-300 ring-white/10', strip: 'bg-gray-600/70' },
};

export interface CommandCenterCardProps {
  item: CommandCenterItem;
  projectId: string;
  now: number;
  /** §5.12 (I) — 화면에 보이는 순서 번호(1 부터). 정리된 항목처럼 순서 밖이면 생략. */
  rank?: number;
  selected?: boolean;
  onSelect?: (item: CommandCenterItem) => void;
  /** 상세 패널이 켜져 있으면 카드 안 인라인 명령창은 감춘다(같은 입력창이 두 개일 이유가 없다). */
  inlineComposer?: boolean;
}

export function CommandCenterCard({
  item,
  projectId,
  now,
  rank,
  selected = false,
  onSelect,
  inlineComposer: inlineComposerProp = true,
}: CommandCenterCardProps): React.JSX.Element {
  const { t } = useTranslation();
  // §5.5 #17-29 — 훅 버블의 세션이면 카드는 그대로 보이되 명령 손잡이(토글·제안 칩·인라인 입력창)를
  //   전부 닫는다. 이 한 줄이 세 자리를 함께 막는다.
  const inlineComposer = inlineComposerProp && !item.readOnly;
  const [commandOpen, setCommandOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tone = LANE_TONE[item.lane] ?? LANE_TONE['done']!;
  const ctx = contextLevel(item.contextUsed, item.contextMax);
  const waiting = waitingLevel(item.waitingSince, now);

  const elapsed = (at: number): string => {
    const { unit, value } = elapsedParts(now - at);
    if (unit === 'now') return t('commandCenter.time.now');
    if (unit === 'min') return t('commandCenter.time.min', { count: value });
    if (unit === 'hour') return t('commandCenter.time.hour', { count: value });
    return t('commandCenter.time.day', { count: value });
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
    // §5.5 #17-10 — 중지 경로는 IDE 입력창과 같은 한 곳(`sessionStopUrl`)에서 나온다.
    //   종전의 `/:subId/stop` 은 자식만 죽이고 큐를 비우지 않아 다음 명령이 바로 재개됐다.
    void fetch(sessionStopUrl(item.agentId, item.subAgentId ?? null), { method: 'POST' }).catch(() => {});
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
      .then((data) => { setSummary(data.ok && data.text ? data.text : t('commandCenter.summaryFailed')); })
      .catch(() => { setSummary(t('commandCenter.summaryFailed')); })
      .finally(() => { setBusy(false); });
  }, [item.agentId, item.subAgentId, busy, t]);

  const stop = (e: React.MouseEvent): void => e.stopPropagation();

  // §5.12 (D) v4.53 — 카드 아무 데나 더블클릭 = [IDE 로 이동] 버튼과 같은 동작.
  // 캔버스 버블 더블클릭이 IDE 를 여는 것과 같은 손버릇이라, 작은 화살표 버튼을 조준하지 않아도 된다.
  // 더블클릭이 남기는 단어 선택 하이라이트는 지워 준다(창이 넘어간 뒤 파란 선택만 남는 것 방지).
  const handleCardDoubleClick = useCallback((e: React.MouseEvent): void => {
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    handleJump();
  }, [handleJump]);

  return (
    <div
      data-command-card={item.key}
      onClick={() => onSelect?.(item)}
      onDoubleClick={handleCardDoubleClick}
      className={`group relative cursor-default overflow-hidden rounded-lg border pl-3 pr-2.5 py-2.5 transition-colors ${
        selected
          ? 'border-sky-400/50 bg-sky-500/[0.07] ring-1 ring-sky-400/30'
          : item.unacknowledged
            ? 'border-emerald-500/40 bg-gray-900/70 hover:bg-gray-900'
            : 'border-white/[0.07] bg-gray-900/70 hover:bg-gray-900'
      }`}
    >
      {/* 레인 색 띠 — 글자를 읽기 전에 종류가 보이게. */}
      <span className={`absolute inset-y-0 left-0 w-[3px] ${tone.strip}`} aria-hidden="true" />

      {/* 머리 — 순서 번호 · 에이전트 색 점 · 라벨 · 액션 */}
      <div className="flex items-start gap-2">
        {rank !== undefined && (
          <span
            className={`mt-[1px] w-4 flex-shrink-0 text-right text-[12px] tabular-nums ${
              rank <= 3 ? 'font-semibold text-gray-300' : 'text-gray-600'
            }`}
            title={t('commandCenter.rankHint', { rank })}
          >
            {rank}
          </span>
        )}
        <span
          className="mt-[3px] h-2.5 w-2.5 flex-shrink-0 rounded-full ring-2 ring-black/30"
          style={{ backgroundColor: item.agentColor }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-gray-100">{item.agentLabel}</span>
            {item.subAgentId ? (
              <>
                <span className="text-[12px] text-gray-600">/</span>
                <span className="truncate text-[12px] text-gray-400">{item.sessionLabel}</span>
              </>
            ) : (
              <span className="rounded bg-white/[0.05] px-1 py-[1px] text-[12px] uppercase tracking-wide text-gray-500">
                {t('commandCenter.mainSession')}
              </span>
            )}
          </div>

          {item.laneReason && (
            <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-gray-300">{item.laneReason}</p>
          )}

          {/* 메타 줄 — 레인 · 도구 · 대기 · 경과 · 큐 · 컨텍스트 */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-gray-500">
            <span className={`rounded px-1.5 py-[1px] ring-1 ${tone.chip}`}>
              {t(`commandCenter.lane.${item.lane}`)}
            </span>
            {item.lastTool && <span className="font-mono text-gray-400">{item.lastTool}</span>}
            {waiting && item.waitingSince !== null && (
              <span
                className={`tabular-nums ${
                  waiting.level === 'critical'
                    ? 'font-semibold text-red-300'
                    : waiting.level === 'warn'
                      ? 'text-amber-300'
                      : 'text-amber-300/70'
                }`}
              >
                {t('commandCenter.waitingFor', { time: elapsed(item.waitingSince) })}
              </span>
            )}
            {item.lastActivityAt > 0 && <span className="tabular-nums">{elapsed(item.lastActivityAt)}</span>}
            {item.queuedCount > 0 && (
              <span className="tabular-nums text-sky-300/80">
                {t('commandCenter.queued', { count: item.queuedCount })}
              </span>
            )}
            {item.runningTaskCount > 0 && (
              <span className="tabular-nums text-sky-300/80">
                {t('commandCenter.running', { count: item.runningTaskCount })}
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
                <span className={`tabular-nums ${ctx.level === 'critical' ? 'text-red-300' : ctx.level === 'warn' ? 'text-amber-300' : ''}`}>
                  {Math.round(ctx.ratio * 100)}%
                </span>
              </span>
            )}
          </div>
        </div>

        {/* 액션 */}
        <div className="flex flex-shrink-0 items-center gap-0.5" onClick={stop} onDoubleClick={stop}>
          <button
            type="button"
            onClick={handleJump}
            className="rounded px-1.5 py-1 text-gray-500 transition-colors hover:bg-white/[0.08] hover:text-gray-100"
            title={t('commandCenter.jumpHint')}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 4h6v6M20 4l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
            </svg>
          </button>
          {inlineComposer && (
            <button
              type="button"
              onClick={() => setCommandOpen((v) => !v)}
              className={`rounded px-1.5 py-1 transition-colors hover:bg-white/[0.08] hover:text-gray-100 ${
                commandOpen ? 'text-sky-300' : 'text-gray-500'
              }`}
              title={t('commandCenter.commandHint')}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z" />
              </svg>
            </button>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded px-1.5 py-1 text-gray-600 transition-colors hover:bg-white/[0.08] hover:text-gray-100"
              title={t('commandCenter.moreHint')}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="5" r="1" />
                <circle cx="12" cy="12" r="1" />
                <circle cx="12" cy="19" r="1" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-7 z-20 w-48 overflow-hidden rounded-md border border-white/10 bg-gray-900 py-1 shadow-lg shadow-black/60">
                {item.unacknowledged && (
                  <MenuItem onClick={handleDismiss} label={t('commandCenter.actionDismiss')} />
                )}
                <MenuItem onClick={handleStop} label={t('commandCenter.actionStop')} />
                {item.subAgentId && (
                  <MenuItem onClick={handleSummarize} label={t('commandCenter.actionSummarize')} />
                )}
                {item.subAgentId && (
                  <MenuItem onClick={handleCloseTab} label={t('commandCenter.actionCloseTab')} danger />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {busy && (
        <p className="mt-2 text-[12px] text-gray-500">{t('commandCenter.summarizing')}</p>
      )}
      {summary && (
        <p className="mt-2 rounded bg-white/[0.04] px-2 py-1.5 text-[12px] leading-snug text-gray-300">{summary}</p>
      )}

      {/* 질문 레인 — 제안 응답 프롬프트 칩. 누르면 입력창에 채워진다. */}
      {inlineComposer && item.lane === 'needs-answer' && item.questionPrompts.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1" onClick={stop} onDoubleClick={stop}>
          {item.questionPrompts.map((prompt, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => { setDraft(prompt); setCommandOpen(true); }}
              className="max-w-full truncate rounded-full bg-rose-500/10 px-2 py-[3px] text-[12px] text-rose-200 ring-1 ring-rose-400/25 transition-colors hover:bg-rose-500/20"
              title={prompt}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {/* 인라인 명령창 */}
      {inlineComposer && commandOpen && (
        <div className="mt-2 flex items-end gap-1.5" onClick={stop} onDoubleClick={stop}>
          <textarea
            autoFocus
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSend();
              }
              if (e.key === 'Escape') { e.preventDefault(); setCommandOpen(false); }
            }}
            placeholder={t('commandCenter.commandPlaceholder')}
            className="min-w-0 flex-1 resize-none rounded border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-gray-100 outline-none placeholder:text-gray-600 focus:border-sky-500/50"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!draft.trim()}
            className="rounded bg-sky-600/80 px-2.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-gray-600"
          >
            {t('commandCenter.send')}
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
      className={`block w-full px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-white/[0.08] ${
        danger ? 'text-red-300' : 'text-gray-300'
      }`}
    >
      {label}
    </button>
  );
}
