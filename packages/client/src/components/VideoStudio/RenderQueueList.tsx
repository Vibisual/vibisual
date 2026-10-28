import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { renderTiming } from '@vibisual/video';

import { StudioIcon, type StudioIconName } from './studioIcons.js';
import { fileNameOf, formatDuration, formatWhen } from './exportLabels.js';
import type { RenderJobAction, VideoJob } from './videoApi.js';

/**
 * §5.13 (AA) 42-5 — 렌더 대기열 줄(내보내기 판·[대기열] 탭 공용). 남은 시간에서 멈춘 시간은 빼고, 단추는 그 상태에서 뜻 있는 것만.
 * 터치에선 툴팁이 없어 상태 글을 말줄임 대신 줄바꿈으로 끝까지 보인다.
 */
export interface RenderQueueListProps {
  readonly jobs: readonly VideoJob[];
  /** 판 안의 요약이면 끝난 것은 빼고 위에서 몇 줄만. */
  readonly compact?: boolean;
  readonly limit?: number;
  /** OS 기능(폴더에서 보기·열기)을 쓸 수 있는가. */
  readonly host: boolean;
  readonly onControl: (jobId: string, action: RenderJobAction) => void;
  readonly onReveal: (job: VideoJob) => void;
  readonly onOpen: (job: VideoJob) => void;
  readonly onRetry: (job: VideoJob) => void;
}

/** 판 안에서 쓰는 작은 단추 — 툴팁은 OS 의 `title`(떠 있는 판 위에서도 가리지 않는다). */
function RowButton({ icon, label, onClick, disabled }: { readonly icon: StudioIconName; readonly label: string; readonly onClick: () => void; readonly disabled?: boolean }): React.JSX.Element {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 transition-colors duration-150 ease-out hover:bg-white/10 hover:text-slate-100 disabled:opacity-35 pointer-coarse:h-9 pointer-coarse:w-9">
      <StudioIcon name={icon} className="h-3.5 w-3.5" />
    </button>
  );
}

function statusIcon(job: VideoJob): StudioIconName {
  if (job.status === 'running') return job.paused ? 'pause' : 'export';
  if (job.status === 'queued') return job.held ? 'stop' : job.notBefore !== undefined ? 'clock' : 'queue';
  if (job.status === 'done') return 'check';
  if (job.status === 'error') return 'warn';
  return 'close';
}

/** 1초마다 다시 그린다(경과·남은 시간) — 도는 렌더가 있을 때만. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function RenderQueueList(p: RenderQueueListProps): React.JSX.Element {
  const { t } = useTranslation();
  const list = (p.compact ? p.jobs.filter((j) => j.status === 'running' || j.status === 'queued') : p.jobs).slice(0, p.limit ?? p.jobs.length);
  const now = useNow(list.some((j) => j.status === 'running'));
  const pending = p.jobs.filter((j) => j.status === 'queued');

  const statusText = (job: VideoJob): string => {
    const timing = renderTiming({
      status: job.status, progress: job.progress,
      ...(job.startedAt !== undefined ? { startedAt: job.startedAt } : {}),
      ...(job.finishedAt !== undefined ? { finishedAt: job.finishedAt } : {}),
      ...(job.pausedMs !== undefined ? { pausedMs: job.pausedMs } : {}),
      ...(job.pausedAt !== undefined ? { pausedAt: job.pausedAt } : {}),
      ...(job.frame !== undefined ? { frame: job.frame } : {}),
    }, now);
    const percent = Math.round(Math.max(0, Math.min(1, job.progress)) * 100);
    switch (job.status) {
      case 'running': {
        if (job.paused) return t('panel.videoStudio.export.queue.paused', { percent });
        if (job.waitingFor === 'cues') return t('panel.videoStudio.export.queue.cues');
        const parts = [`${percent}%`];
        if (timing.elapsedMs !== null) parts.push(t('panel.videoStudio.export.queue.elapsed', { time: formatDuration(timing.elapsedMs) }));
        if (timing.etaMs !== null) parts.push(t('panel.videoStudio.export.queue.eta', { time: formatDuration(timing.etaMs) }));
        if (timing.fps !== null) parts.push(t('panel.videoStudio.export.queue.fps', { fps: timing.fps.toFixed(1) }));
        return parts.join(' · ');
      }
      case 'queued':
        // 누를 단추 이름은 그 단추의 라벨에서 받아 적는다(라벨 번역이 바뀌어도 안내가 따라온다 — i18n 규칙).
        if (job.held) return t(`panel.videoStudio.export.queue.held_${job.heldReason ?? 'user'}`, { start: t('panel.videoStudio.export.queue.startNow') });
        if (job.notBefore !== undefined && job.notBefore > now) return t('panel.videoStudio.export.queue.scheduled', { time: formatWhen(job.notBefore) });
        return t('panel.videoStudio.export.queue.waiting', { n: pending.findIndex((j) => j.id === job.id) + 1 });
      case 'done':
        return [
          t('panel.videoStudio.export.queue.done', { name: fileNameOf(job.exported ?? job.result ?? '') }),
          ...(timing.elapsedMs !== null ? [formatDuration(timing.elapsedMs)] : []),
        ].join(' · ');
      case 'error':
        return t('panel.videoStudio.export.queue.failed', { reason: (job.error ?? '').slice(0, 160) });
      default:
        return t('panel.videoStudio.export.queue.canceled');
    }
  };

  if (list.length === 0) {
    return <p className="px-2.5 py-2 text-[12px] text-slate-500">{t('panel.videoStudio.export.queue.empty')}</p>;
  }

  return (
    <ul className="flex flex-col gap-1" aria-label={t('panel.videoStudio.export.queue.title')}>
      {list.map((job) => {
        const pendingIndex = pending.findIndex((j) => j.id === job.id);
        const terminal = job.status === 'done' || job.status === 'error' || job.status === 'canceled';
        const file = job.exported ?? job.result;
        return (
          <li key={job.id} className="flex flex-col gap-1 rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className={`shrink-0 ${job.status === 'error' ? 'text-rose-300' : job.status === 'running' && !job.paused ? 'text-[var(--vs-accent)]' : 'text-slate-400'}`}>
                <StudioIcon name={statusIcon(job)} className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-slate-100" title={job.title ?? job.docId}>
                {job.title ?? job.docId}
                {job.label ? <span className="font-normal text-slate-500"> · {job.label}</span> : null}
              </span>
              {job.status === 'running' ? (
                <>
                  <RowButton icon={job.paused ? 'play' : 'pause'} label={job.paused ? t('panel.videoStudio.export.queue.resume') : t('panel.videoStudio.export.queue.pause')}
                    onClick={() => p.onControl(job.id, job.paused ? 'resume' : 'pause')} />
                  <RowButton icon="close" label={t('panel.videoStudio.export.queue.cancel')} onClick={() => p.onControl(job.id, 'cancel')} />
                </>
              ) : job.status === 'queued' ? (
                <>
                  {!p.compact ? <RowButton icon="arrowUp" label={t('panel.videoStudio.export.queue.up')} disabled={pendingIndex <= 0} onClick={() => p.onControl(job.id, 'move-up')} /> : null}
                  {!p.compact ? <RowButton icon="arrowDown" label={t('panel.videoStudio.export.queue.down')} disabled={pendingIndex < 0 || pendingIndex >= pending.length - 1} onClick={() => p.onControl(job.id, 'move-down')} /> : null}
                  {job.held || job.notBefore !== undefined
                    ? <RowButton icon="play" label={t('panel.videoStudio.export.queue.startNow')} onClick={() => p.onControl(job.id, 'start-now')} />
                    : <RowButton icon="pause" label={t('panel.videoStudio.export.queue.hold')} onClick={() => p.onControl(job.id, 'hold')} />}
                  <RowButton icon="close" label={t('panel.videoStudio.export.queue.cancel')} onClick={() => p.onControl(job.id, 'cancel')} />
                </>
              ) : (
                <>
                  {job.status === 'done' && file && p.host ? <RowButton icon="folder" label={t('panel.videoStudio.export.reveal')} onClick={() => p.onReveal(job)} /> : null}
                  {job.status === 'done' && file && p.host ? <RowButton icon="play" label={t('panel.videoStudio.export.open')} onClick={() => p.onOpen(job)} /> : null}
                  {terminal ? <RowButton icon="retry" label={t('panel.videoStudio.export.queue.retry')} onClick={() => p.onRetry(job)} /> : null}
                </>
              )}
            </div>
            {job.status === 'running' ? (
              <div className="h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                <div className={`h-full rounded-full transition-[width] duration-300 ease-out ${job.paused ? 'bg-slate-400' : 'bg-[var(--vs-accent)]'}`} style={{ width: `${Math.round(Math.max(0, Math.min(1, job.progress)) * 100)}%` }} />
              </div>
            ) : null}
            <p className={`truncate text-[12px] tabular-nums box-narrow:whitespace-normal box-narrow:break-words pointer-coarse:whitespace-normal pointer-coarse:break-words ${job.status === 'error' ? 'text-rose-300' : 'text-slate-400'}`} title={statusText(job)}>{statusText(job)}</p>
            {job.exportNote ? (
              <p className="break-words text-[12px] text-amber-300" title={job.exportNote.detail}>{t(`panel.videoStudio.export.note_${job.exportNote.code === 'export-failed' ? 'exportFailed' : 'overwriteFallback'}`)}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
