import { useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResolvedTimeline, VideoDoc, VideoDocOp } from '@vibisual/video';

import { StudioPopover, PopoverItem } from './StudioPopover.js';
import { StudioIcon } from './studioIcons.js';
import { bindToCueOps, collectTimelineSignals, unbindFromCueOps, type CueMark } from './timelineSignals.js';

/** §5.13 (T-8) — 표지 줄: 컴포지션 표지(위 구슬)와 음악 비트(아래 눈금)를 한 줄에. 표지를 누르면 고른 아이템을 묶거나 뗀다(떼면 그 자리 숫자 시각으로 풀린다). */
export interface VideoTimelineSignalsProps {
  readonly doc: VideoDoc;
  readonly timeline: ResolvedTimeline;
  readonly duration: number;
  readonly grid: CSSProperties;
  readonly playhead: number;
  readonly selectedItemId: string | null;
  readonly disabled: boolean;
  readonly onSeek: (t: number) => void;
  readonly onApplyOps?: ((ops: readonly VideoDocOp[]) => void) | undefined;
  /** [다시 모으기] — 없으면 버튼을 세우지 않는다. */
  readonly onRecollect?: (() => void) | undefined;
  readonly recollecting?: boolean | undefined;
}

export function VideoTimelineSignals(p: VideoTimelineSignalsProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const key = 'panel.videoStudio.signals.';
  const signals = useMemo(() => collectTimelineSignals(p.doc, p.timeline), [p.doc, p.timeline]);
  const [open, setOpen] = useState<{ mark: CueMark; el: HTMLElement } | null>(null);
  const anchor = useMemo(() => ({ current: open?.el ?? null }), [open]);
  if (!signals.hasCueSources && signals.beats.length === 0) return null;

  const label = (id: string): string => {
    for (const track of p.doc.tracks) {
      const item = track.items.find((candidate) => candidate.id === id);
      if (item) return item.label ?? item.sceneId ?? item.id;
    }
    return id;
  };
  const apply = (ops: readonly VideoDocOp[]): void => { if (ops.length > 0) p.onApplyOps?.(ops); };
  const cursor = Math.min(p.duration, Math.max(0, p.playhead)) / p.duration * 100;
  const selectable = p.selectedItemId !== null && open !== null && p.selectedItemId !== open.mark.itemId && !open.mark.bound.includes(p.selectedItemId);

  return (
    <div className="grid border-t border-white/10" style={p.grid}>
      <div className="sticky left-0 z-20 flex items-center gap-1.5 border-r border-white/10 bg-vb-card px-3">
        <StudioIcon name="cue" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 truncate text-[12px] text-gray-300" title={signals.collecting ? t(`${key}collecting`) : t(`${key}title`)}>
          {signals.collecting ? t(`${key}collecting`) : t(`${key}title`)}
        </span>
        {p.onRecollect && signals.hasCueSources && (
          <button type="button" className="shrink-0 rounded p-1 text-gray-500 hover:bg-white/10 hover:text-gray-200 disabled:opacity-30 pointer-coarse:p-2" disabled={p.disabled || p.recollecting === true}
            aria-label={t(`${key}recollect`)} title={t(`${key}recollect`)} onClick={p.onRecollect}>
            <StudioIcon name="restore" className={`h-3.5 w-3.5 ${p.recollecting === true ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>
      <div className="relative h-12 overflow-hidden bg-vb-sunken/60" role="group" aria-label={t(`${key}title`)}>
        {signals.beats.map((beat) => (
          <span key={beat.key} className={`pointer-events-none absolute bottom-0 w-px bg-emerald-300/50 ${beat.strong ? 'h-5' : 'h-2.5'}`}
            style={{ left: `${beat.t / p.duration * 100}%` }} aria-hidden="true" />
        ))}
        {signals.cues.map((mark) => (
          <button key={mark.key} type="button"
            // 터치에서는 좌우·아래로 누름 자리를 넓힌다(구슬·이름의 자리는 그대로 — 위쪽 끝에 붙어 있다).
            className={`absolute top-0 flex -translate-x-1/2 flex-col items-center gap-0.5 rounded px-0.5 text-[12px] leading-none outline-none focus-visible:ring-1 focus-visible:ring-[var(--vs-accent)] pointer-coarse:px-2 pointer-coarse:pb-3 ${mark.stale ? 'opacity-40' : ''} ${open?.mark.key === mark.key ? 'text-slate-100' : 'text-slate-300 hover:text-slate-100'}`}
            style={{ left: `${mark.t / p.duration * 100}%` }}
            aria-label={t(`${key}mark`, { name: mark.name, t: mark.t.toFixed(2) })}
            title={`${mark.name} · ${mark.t.toFixed(2)}s${mark.stale ? ` · ${t(`${key}collecting`)}` : ''}${mark.bound.length > 0 ? ` · ${t(`${key}boundCount`, { count: mark.bound.length })}` : ''}`}
            onClick={(event) => { p.onSeek(mark.t); setOpen({ mark, el: event.currentTarget }); }}>
            <span className={`h-2 w-2 rounded-full border ${mark.bound.length > 0 ? 'border-slate-100 bg-slate-100' : 'border-slate-300 bg-transparent'}`} aria-hidden="true" />
            <span className="h-2 w-px bg-slate-400" aria-hidden="true" />
            <span className="max-w-24 truncate">{mark.name}</span>
          </button>
        ))}
        <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-slate-100" style={{ left: `${cursor}%` }} />
      </div>
      {open && (
        <StudioPopover anchor={anchor} open onClose={() => setOpen(null)} side="above" label={t(`${key}menu`)} className="w-64">
          <p className="truncate px-2.5 pb-1 pt-0.5 text-[12px] font-semibold text-slate-400">
            {`${open.mark.name} · ${open.mark.t.toFixed(2)}s`}
          </p>
          {open.mark.stale && <p className="px-2.5 pb-1 text-[12px] text-amber-200">{t(`${key}staleHint`)}</p>}
          <PopoverItem disabled={p.disabled || !p.onApplyOps || !selectable}
            onClick={() => {
              if (p.selectedItemId) apply(bindToCueOps(p.doc, p.selectedItemId, open.mark));
              setOpen(null);
            }}>
            <span className="flex items-center gap-2"><StudioIcon name="link" />
              {selectable && p.selectedItemId ? t(`${key}bind`, { name: label(p.selectedItemId) }) : t(`${key}bindHint`)}
            </span>
          </PopoverItem>
          {open.mark.bound.length > 0 && <div className="my-1 border-t border-white/10" />}
          {open.mark.bound.map((id) => (
            <PopoverItem key={id} disabled={p.disabled || !p.onApplyOps}
              onClick={() => { apply(unbindFromCueOps(p.timeline, id, open.mark.t)); setOpen(null); }}>
              <span className="flex items-center gap-2"><StudioIcon name="unlink" />{t(`${key}unbind`, { name: label(id) })}</span>
            </PopoverItem>
          ))}
        </StudioPopover>
      )}
    </div>
  );
}
