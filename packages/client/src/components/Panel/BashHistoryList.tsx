import { memo, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { BashEntry } from '@vibisual/shared';
import { ScrollFade } from '../ScrollFade.js';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';
import { COMMAND_HISTORY_VISIBLE_LIMIT, type CommandHistoryRow } from './commandAppHistory.js';

interface BashHistoryListProps {
  rows: readonly CommandHistoryRow[];
}

function CommandStatus({ entry }: { entry: BashEntry }): React.JSX.Element {
  const { t } = useTranslation();
  const status = entry.status ?? 'unknown';
  const tone = status === 'success' ? 'text-emerald-400' : status === 'error' ? 'text-rose-400' : status === 'running' ? 'text-blue-400' : 'text-gray-500';
  return <span className={`text-[12px] ${tone}`}>{t(`panel.bashHistory.status.${status}`)}</span>;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const time = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${m}/${d} ${time}`;
}

interface BashDetailPopupProps {
  entry: BashEntry;
  onClose: () => void;
}

function BashDetailPopup({ entry, onClose }: BashDetailPopupProps): React.JSX.Element {
  const { t } = useTranslation();
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const backdrop = useBackdropDismiss(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      {...backdrop}
    >
      <div
        className="mx-4 flex max-h-[80dvh] w-full max-w-2xl flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M4 17l6-5-6-5m8 10h8" />
            </svg>
            <span className="text-sm font-semibold text-gray-100">
              {t('panel.bashHistory.bashCommand')}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">
              {formatTime(entry.timestamp)}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200 pointer-coarse:h-9 pointer-coarse:w-9"
              aria-label={t('panel.bashHistory.closePopup')}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body — Input / Output — 내용 적으면 줄어들고 80dvh 초과 시 스크롤 */}
        <ScrollFade fill className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <CommandStatus entry={entry} />
              {entry.endedAt !== undefined && <span className="text-xs text-gray-500">{t('panel.bashHistory.endedAt', { time: formatTime(entry.endedAt) })}</span>}
            </div>
            {entry.apps && entry.apps.length > 0 && <p className="text-xs text-gray-300">{entry.apps.map((app) => app.name).join(' · ')}</p>}
            {entry.cwd && <p className="break-all text-xs text-gray-400">{t('panel.bashHistory.cwd')}: <code>{entry.cwd}</code></p>}
            {/* Input */}
            <div className="flex shrink-0 flex-col gap-1">
              <span className="text-[12px] font-semibold uppercase tracking-wider text-blue-400">
                {t('panel.bashHistory.input')}
              </span>
              <pre className="whitespace-pre-wrap break-all rounded border border-gray-700/50 bg-gray-800 p-3 font-mono text-xs leading-relaxed text-gray-200">
                <span className="select-none text-slate-500">$ </span>{entry.command}
              </pre>
              {entry.commandTruncated && <p className="text-xs text-amber-400">{t('panel.bashHistory.commandTruncated')}</p>}
            </div>

            {/* Output */}
            <div className="flex min-h-0 flex-col gap-1">
              <span className="shrink-0 text-[12px] font-semibold uppercase tracking-wider text-emerald-400">
                {t('panel.bashHistory.output')}
              </span>
              {entry.output ? (
                <pre className="scrollbar-terminal whitespace-pre-wrap break-all rounded border border-gray-700/50 bg-gray-800 p-3 font-mono text-xs leading-relaxed text-gray-300">
                  {entry.output}
                </pre>
              ) : (
                <p className="rounded border border-gray-700/30 bg-gray-800/40 px-3 py-2 text-xs text-gray-500">
                  {t(entry.status === 'running' ? 'panel.bashHistory.waitingForOutput' : 'panel.bashHistory.noOutput')}
                </p>
              )}
              {entry.outputTruncated && <p className="text-xs text-amber-400">{t('panel.bashHistory.outputTruncated')}</p>}
            </div>
          </div>
        </ScrollFade>
      </div>
    </div>
  );
}

export const BashHistoryList = memo(function BashHistoryList({
  rows,
}: BashHistoryListProps): React.JSX.Element {
  const { t } = useTranslation();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Derive from current records: completion/output updates must reach an open popup.
  const selectedEntry = selectedKey ? rows.find((row) => row.key === selectedKey)?.entry : undefined;

  const handleClose = useCallback(() => setSelectedKey(null), []);

  if (rows.length === 0) {
    return (
      <p className="text-xs text-gray-500">{t('panel.bashHistory.noCommandsYet')}</p>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-gray-500">
          {t('panel.bashHistory.commandsHeading', { count: rows.length })}
        </span>
        <span className="text-[12px] text-gray-500">{t('panel.bashHistory.recentLimit', { count: COMMAND_HISTORY_VISIBLE_LIMIT })}</span>
        <ScrollFade maxHeight={256}>
          <ul className="flex flex-col gap-1.5">
            {rows.map(({ entry, key }) => (
              <li
                key={key}
                className="cursor-pointer rounded border border-gray-700/50 bg-gray-800/60 px-2.5 py-1.5 transition-colors hover:border-gray-600 hover:bg-gray-700/60"
              >
                <button type="button" onClick={() => setSelectedKey(key)} className="block w-full text-left">
                {/* Input */}
                <code className="block truncate text-xs text-gray-200">
                  <span className="text-blue-400/70">$ </span>
                  {entry.command.length > 240 ? `${entry.command.slice(0, 240)}…` : entry.command}
                </code>
                {/* Output preview */}
                {entry.output && (
                  <p className="mt-0.5 truncate text-[12px] text-emerald-400/60">
                    {entry.output.slice(0, entry.output.indexOf('\n') < 0 ? 160 : Math.min(160, entry.output.indexOf('\n')))}
                  </p>
                )}
                <span className="mt-0.5 flex flex-wrap items-center justify-between gap-1 text-[12px] text-gray-500">
                  <span>{formatTime(entry.timestamp)}</span>
                  <CommandStatus entry={entry} />
                </span>
                </button>
              </li>
            ))}
          </ul>
        </ScrollFade>
      </div>

      {selectedEntry && (
        <BashDetailPopup entry={selectedEntry} onClose={handleClose} />
      )}
    </>
  );
});
