import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionLoop, SessionLoopMode, SubAgent } from '@vibisual/shared';
import {
  SESSION_LOOP_MAX_ITERATIONS,
  SESSION_LOOP_DEFAULT_TOTAL,
  SESSION_LOOP_MAX_INTERVAL_MS,
} from '@vibisual/shared';
import { useGraphStore, selectIDEOverlay } from '../../stores/graphStore.js';
import { ScrollFade } from '../ScrollFade.js';

// §5.5 #17-11 v3.79 — 세션 반복 실행(루프) 설정 패널.
//
// 설정 단위는 **지금 열려 있는 IDE 세션 탭 하나**다. 탭을 바꾸면 그 탭의 루프가 보인다 —
// 그래서 폼 상태는 activeSessionId 가 바뀔 때마다 서버 값으로 다시 채운다.
//
// 실행·계수·정지는 전부 서버(SSOT)가 한다. 이 컴포넌트는 폼을 PUT 으로 보내고,
// 되돌아오는 graph_snapshot 의 `sessionLoops` 를 그대로 그린다(낙관적 진행 표시 ❌).

const EMPTY_SUBS: SubAgent[] = [];

/** 남은 시간 — 초/분 단위로 짧게. 1초 틱 now 를 받아 순수 계산으로 유지. */
function formatRemaining(nextRunAt: number, now: number): string {
  const sec = Math.max(0, Math.ceil((nextRunAt - now) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

interface Props {
  agentId: string;
  onClose: () => void;
}

export const IDELoopPanel = memo(function IDELoopPanel({ agentId, onClose }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const activeSessionId = useGraphStore((s) => selectIDEOverlay(s).activeSessionId);
  const loop: SessionLoop | undefined = useGraphStore((s) => (activeSessionId ? s.sessionLoops[activeSessionId] : undefined));
  const subs = useGraphStore((s) => s.subAgents[agentId]) ?? EMPTY_SUBS;
  const subLabels = useGraphStore((s) => s.subAgentLabels);
  const saveSessionLoop = useGraphStore((s) => s.saveSessionLoop);
  const endSessionLoop = useGraphStore((s) => s.endSessionLoop);

  const sessionLabel = useMemo(() => {
    if (!activeSessionId) return null;
    return subLabels[activeSessionId] ?? subs.find((s) => s.id === activeSessionId)?.label ?? activeSessionId;
  }, [activeSessionId, subs, subLabels]);

  // 폼 상태 — 서버 값이 원본, 사용자가 편집하는 동안만 로컬.
  const [command, setCommand] = useState('');
  const [mode, setMode] = useState<SessionLoopMode>('count');
  const [total, setTotal] = useState(SESSION_LOOP_DEFAULT_TOTAL);
  const [intervalSec, setIntervalSec] = useState(0);
  const [stopOnError, setStopOnError] = useState(true);

  // 탭이 바뀌면(또는 그 탭의 설정이 서버에서 바뀌면) 폼을 그 탭 값으로 다시 채운다.
  useEffect(() => {
    setCommand(loop?.command ?? '');
    setMode(loop?.mode ?? 'count');
    setTotal(loop?.total ?? SESSION_LOOP_DEFAULT_TOTAL);
    setIntervalSec(Math.round((loop?.intervalMs ?? 0) / 1000));
    setStopOnError(loop?.stopOnError ?? true);
    // loop 객체 자체가 아니라 "어느 탭이냐"가 바뀔 때만 리셋 — 타이핑 중 스냅샷이 덮지 않게.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  // 다음 회차까지 남은 시간 표시용 1초 틱 — 이 패널이 열려 있는 동안만 돈다.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const canSubmit = !!activeSessionId && command.trim().length > 0;

  const handleStart = useCallback(() => {
    if (!activeSessionId || !command.trim()) return;
    void saveSessionLoop({
      agentId,
      subAgentId: activeSessionId,
      command: command.trim(),
      mode,
      ...(mode === 'count' ? { total: Math.min(Math.max(1, total), SESSION_LOOP_MAX_ITERATIONS) } : {}),
      intervalMs: Math.min(Math.max(0, Math.round(intervalSec * 1000)), SESSION_LOOP_MAX_INTERVAL_MS),
      stopOnError,
      enabled: true,
    });
  }, [activeSessionId, agentId, command, mode, total, intervalSec, stopOnError, saveSessionLoop]);

  const handleStop = useCallback(() => {
    if (!activeSessionId) return;
    void endSessionLoop(agentId, activeSessionId, 'stop');
  }, [activeSessionId, agentId, endSessionLoop]);

  const handleDelete = useCallback(() => {
    if (!activeSessionId) return;
    void endSessionLoop(agentId, activeSessionId, 'delete');
  }, [activeSessionId, agentId, endSessionLoop]);

  const statusLabel = loop ? t(`ide.loop.status.${loop.status}`) : null;

  return (
    <div className="flex h-full w-full flex-col bg-gray-950">
      {/* 헤더 */}
      <div className="flex h-10 flex-shrink-0 items-center justify-between border-b border-gray-700 bg-gray-900/80 px-4">
        <span className="flex items-center gap-2 text-[14px] font-bold text-gray-100">
          <svg className="h-4 w-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 2l4 4-4 4" />
            <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
            <path d="M7 22l-4-4 4-4" />
            <path d="M21 13v1a4 4 0 0 1-4 4H3" />
          </svg>
          {t('ide.loop.title')}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('ide.loop.close')}
          title={t('ide.loop.close')}
          className="flex h-7 w-7 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-200"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* 대상 세션 — 루프가 "세션 단위"라는 사실을 화면이 먼저 말한다. */}
      <div className="flex-shrink-0 border-b border-gray-800 px-4 py-1.5 text-[11px] text-gray-500">
        {activeSessionId
          ? t('ide.loop.scopeSession', { label: sessionLabel ?? activeSessionId })
          : t('ide.loop.scopeNone')}
      </div>

      {!activeSessionId ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] leading-relaxed text-gray-400">
          {t('ide.loop.pickSession')}
        </div>
      ) : (
        <ScrollFade fill className="flex-1">
          <div className="flex flex-col gap-4 p-4">
            {/* 진행 상태 — 루프가 있을 때만. */}
            {loop && (
              <div className={`rounded-lg border px-4 py-3 ${loop.enabled ? 'border-amber-500/40 bg-amber-500/5' : 'border-gray-700 bg-gray-800/60'}`}>
                <div className="flex items-center gap-2">
                  {loop.enabled && <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-amber-400" />}
                  <span className="text-[13px] font-bold text-gray-100">
                    {loop.mode === 'count'
                      ? t('ide.loop.progressCount', { done: loop.completed, total: loop.total ?? 0 })
                      : t('ide.loop.progressInfinite', { done: loop.completed })}
                  </span>
                  <span className="ml-auto rounded bg-gray-700/70 px-1.5 py-0.5 text-[10px] font-semibold text-gray-200">
                    {statusLabel}
                  </span>
                </div>
                {loop.status === 'waiting' && loop.nextRunAt != null && loop.nextRunAt > now && (
                  <p className="mt-1.5 text-[11.5px] text-gray-400">
                    {t('ide.loop.nextIn', { time: formatRemaining(loop.nextRunAt, now) })}
                  </p>
                )}
                {loop.lastError && (
                  <p className="mt-1.5 break-words text-[11.5px] text-red-400">
                    {t('ide.loop.lastError', { message: loop.lastError })}
                  </p>
                )}
              </div>
            )}

            {/* 반복할 명령 */}
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                {t('ide.loop.commandLabel')}
              </span>
              <textarea
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                rows={4}
                placeholder={t('ide.loop.commandPlaceholder')}
                className="scrollbar-thin w-full resize-y rounded border border-gray-700 bg-gray-900 px-3 py-2 text-[12.5px] leading-relaxed text-gray-100 placeholder-gray-600 outline-none focus:border-amber-500/60"
              />
              <span className="text-[11px] text-gray-500">{t('ide.loop.commandHint')}</span>
            </label>

            {/* 반복 방식 */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                {t('ide.loop.modeLabel')}
              </span>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-[12.5px] text-gray-200">
                  <input
                    type="radio"
                    checked={mode === 'count'}
                    onChange={() => setMode('count')}
                    className="accent-amber-500"
                  />
                  {t('ide.loop.modeCount')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={SESSION_LOOP_MAX_ITERATIONS}
                  value={total}
                  disabled={mode !== 'count'}
                  onChange={(e) => setTotal(Number(e.target.value) || 1)}
                  className="w-20 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[12.5px] tabular-nums text-gray-100 outline-none focus:border-amber-500/60 disabled:opacity-40"
                />
                <label className="flex items-center gap-1.5 text-[12.5px] text-gray-200">
                  <input
                    type="radio"
                    checked={mode === 'infinite'}
                    onChange={() => setMode('infinite')}
                    className="accent-amber-500"
                  />
                  {t('ide.loop.modeInfinite')}
                </label>
              </div>
            </div>

            {/* 회차 간 대기 */}
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                {t('ide.loop.intervalLabel')}
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={Math.floor(SESSION_LOOP_MAX_INTERVAL_MS / 1000)}
                  value={intervalSec}
                  onChange={(e) => setIntervalSec(Math.max(0, Number(e.target.value) || 0))}
                  className="w-24 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[12.5px] tabular-nums text-gray-100 outline-none focus:border-amber-500/60"
                />
                <span className="text-[12px] text-gray-400">{t('ide.loop.intervalUnit')}</span>
              </div>
              <span className="text-[11px] text-gray-500">{t('ide.loop.intervalHint')}</span>
            </label>

            {/* 오류 시 정지 */}
            <label className="flex items-center gap-2 text-[12.5px] text-gray-200">
              <input
                type="checkbox"
                checked={stopOnError}
                onChange={(e) => setStopOnError(e.target.checked)}
                className="accent-amber-500"
              />
              {t('ide.loop.stopOnError')}
            </label>

            {/* 조작 */}
            <div className="flex flex-wrap items-center gap-2 border-t border-gray-800 pt-4">
              <button
                type="button"
                onClick={handleStart}
                disabled={!canSubmit}
                className="rounded bg-amber-600 px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loop?.enabled ? t('ide.loop.restart') : t('ide.loop.start')}
              </button>
              <button
                type="button"
                onClick={handleStop}
                disabled={!loop?.enabled}
                className="rounded border border-gray-600 px-3 py-1.5 text-[12.5px] font-semibold text-gray-200 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('ide.loop.stop')}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!loop}
                className="ml-auto rounded border border-red-500/40 px-3 py-1.5 text-[12.5px] font-semibold text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('ide.loop.delete')}
              </button>
            </div>

            <p className="text-[11px] leading-relaxed text-gray-500">{t('ide.loop.note')}</p>
          </div>
        </ScrollFade>
      )}
    </div>
  );
});
