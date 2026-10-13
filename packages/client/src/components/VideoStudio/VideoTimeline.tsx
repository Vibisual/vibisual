import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveTimeline, type VideoDoc, type VideoDocOp } from '@vibisual/video';
import { useScrollReveal } from '../../hooks/useScrollReveal.js';
import { clampTimelineSeek, lastTimelineFrame, timelineFps, timelineFrame, timelineTicks, TIMELINE_CONFIG } from './videoTimelineEdit.js';
import { useVideoTimelineDrag } from './useVideoTimelineDrag.js';
import { VideoTimelineToolbar } from './VideoTimelineToolbar.js';
import { VideoTimelineClip } from './VideoTimelineClip.js';
import { VideoTimelineSignals } from './VideoTimelineSignals.js';

export interface VideoTimelineProps {
  doc: VideoDoc;
  playhead: number;
  selectedItemId: string | null;
  onSeek: (t: number) => void;
  onSelectItem: (itemId: string | null) => void;
  onApplyOps?: (ops: readonly VideoDocOp[]) => void;
  disabled?: boolean;
  /** §5.13 (T-8) — 표지 줄의 [다시 모으기]. */
  onRecollectCues?: () => void;
  recollectingCues?: boolean;
}

/** One shared time coordinate for the ruler, every lane, and drag calculations. */
export function VideoTimeline({ doc, playhead, selectedItemId, onSeek, onSelectItem, onApplyOps, disabled = false, onRecollectCues, recollectingCues }: VideoTimelineProps): React.JSX.Element {
  const { t } = useTranslation();
  const key = 'panel.videoStudio.timelineEditor.';
  const laneRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrubPointer = useRef<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [snap, setSnap] = useState(true);
  const [laneWidth, setLaneWidth] = useState<number>(TIMELINE_CONFIG.minWidth);
  const scrollReveal = useScrollReveal();
  const resolved = useMemo(() => resolveTimeline(doc), [doc]);
  // Disabled clips remain reachable, even though they do not extend the rendered movie.
  const duration = Math.max(1, resolved.duration, ...resolved.items.map(item => item.end));
  const drag = useVideoTimelineDrag({ doc, duration, playhead, laneRef, snap, disabled: disabled || !onApplyOps, onApplyOps, onSelectItem });
  const timeline = useMemo(() => drag.preview ? resolveTimeline(drag.preview.doc) : resolved, [drag.preview, resolved]);
  const ticks = useMemo(() => timelineTicks(duration, laneWidth, doc.fps), [duration, laneWidth, doc.fps]);
  const seek = (clientX: number): void => {
    const rect = laneRef.current?.getBoundingClientRect();
    if (rect && rect.width > 0) onSeek(clampTimelineSeek((clientX - rect.left) / rect.width * duration, resolved.duration, doc.fps));
  };
  const pointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    scrubPointer.current = event.pointerId;
    seek(event.clientX);
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (scrubPointer.current === event.pointerId) seek(event.clientX);
  };
  const pointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (scrubPointer.current !== event.pointerId) return;
    seek(event.clientX); scrubPointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keyboardSeek = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = (event.shiftKey ? TIMELINE_CONFIG.largeStepFrames : 1) / timelineFps(doc.fps);
    const times: Record<string, number> = { ArrowLeft: playhead - step, ArrowRight: playhead + step,
      PageUp: playhead - 1, PageDown: playhead + 1, Home: 0, End: lastTimelineFrame(resolved.duration, doc.fps) / timelineFps(doc.fps) };
    const time = times[event.key];
    if (time === undefined) return;
    event.preventDefault(); event.stopPropagation(); onSeek(clampTimelineSeek(time, resolved.duration, doc.fps));
  };
  useEffect(() => {
    const lane = laneRef.current;
    if (!lane) return;
    const measure = (): void => { const width = lane.getBoundingClientRect().width; if (width > 0) setLaneWidth(width); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure); observer.observe(lane);
    return () => observer.disconnect();
  }, [zoom]);
  useEffect(() => { setZoom(1); if (viewportRef.current) viewportRef.current.scrollLeft = 0; }, [doc.id]);
  const grid = { gridTemplateColumns: `${TIMELINE_CONFIG.gutter}px minmax(0, 1fr)` };
  const cursor = Math.min(duration, Math.max(0, playhead)) / duration * 100;
  return <div className="flex min-w-0 flex-col gap-2 select-none" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); drag.cancel(); } }}>
    <VideoTimelineToolbar zoom={zoom} onZoom={setZoom} snap={snap} onSnap={() => setSnap(value => !value)} playhead={playhead} duration={resolved.duration} fps={doc.fps} onSeek={onSeek} />
    <div ref={viewportRef} className="scrollbar-thin overflow-x-auto rounded border border-white/10" {...scrollReveal}>
      <div style={{ width: `calc((100% - ${TIMELINE_CONFIG.gutter}px) * ${zoom} + ${TIMELINE_CONFIG.gutter}px)`, minWidth: TIMELINE_CONFIG.minWidth }}>
        <div className="grid" style={grid}>
          <div className="sticky left-0 z-20 flex items-center border-b border-r border-white/10 bg-vb-card px-3 text-[12px] text-slate-400">{t(`${key}tracks`)}</div>
          <div ref={laneRef} className="relative h-8 touch-none cursor-crosshair overflow-hidden border-b border-white/10 bg-vb-sunken outline-none focus:ring-1 focus:ring-inset focus:ring-[var(--vs-accent)]"
            role="slider" aria-label={t('panel.videoStudio.seek')} aria-valuemin={0} aria-valuemax={lastTimelineFrame(resolved.duration, doc.fps)}
            aria-valuenow={timelineFrame(clampTimelineSeek(playhead, resolved.duration, doc.fps), doc.fps)}
            aria-valuetext={t(`${key}frameValue`, { frame: timelineFrame(clampTimelineSeek(playhead, resolved.duration, doc.fps), doc.fps) })} tabIndex={0}
            onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { scrubPointer.current = null; }} onLostPointerCapture={() => { scrubPointer.current = null; }} onKeyDown={keyboardSeek}>
            {ticks.map(time => <div key={time} className="absolute top-0 h-full border-l border-white/15 pl-1 font-mono text-[12px] leading-8 text-gray-500" style={{ left: `${time / duration * 100}%` }}>{Number(time.toFixed(2))}s</div>)}
            <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-slate-100" style={{ left: `${cursor}%` }} />
          </div>
        </div>
        {doc.tracks.map(track => {
          const audio = track.kind === 'audio';
          const off = audio ? track.muted === true : track.hidden === true;
          const label = track.label ?? track.id;
          const action = audio ? (off ? 'unmuteTrack' : 'muteTrack') : (off ? 'showTrack' : 'hideTrack');
          return <div key={track.id} className="grid border-b border-white/5 last:border-b-0" style={grid}>
            <div className="sticky left-0 z-20 flex items-center gap-2 border-r border-white/10 bg-vb-card px-3">
              <span className="min-w-0 flex-1 truncate text-[12px] text-gray-300" title={label}>{label}</span>
              <button type="button" className={`rounded p-1 hover:bg-white/10 disabled:opacity-30 ${off ? 'text-amber-300' : 'text-gray-500'}`} disabled={disabled || !onApplyOps}
                aria-label={t(`${key}${action}`, { name: label })} title={t(`${key}${action}`, { name: label })} aria-pressed={off}
                onClick={() => onApplyOps?.([{ op: 'updateTrack', trackId: track.id, patch: audio ? { muted: !off } : { hidden: !off } }])}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                  {audio ? <path d="m11 5-6 4H2v6h3l6 4V5zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" /> : <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>}
                  {off && <path d="m3 3 18 18" />}
                </svg>
              </button>
            </div>
            <div className={`relative h-11 overflow-hidden bg-vb-sunken/60 ${off ? 'opacity-40' : ''}`} data-timeline-track={track.id}
              onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { scrubPointer.current = null; }} onLostPointerCapture={() => { scrubPointer.current = null; }}>
              {ticks.map(time => <div key={time} className="pointer-events-none absolute inset-y-0 border-l border-white/5" style={{ left: `${time / duration * 100}%` }} />)}
              {timeline.items.filter(item => item.trackId === track.id).map(item => <VideoTimelineClip key={item.id} item={item} doc={doc} duration={duration} selected={selectedItemId === item.id} disabled={disabled || !onApplyOps} drag={drag} onSelectItem={onSelectItem} onApplyOps={onApplyOps} />)}
              <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-slate-100" data-timeline-playhead="true" style={{ left: `${cursor}%` }} />
              {drag.preview?.snap !== null && drag.preview?.snap !== undefined && <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-amber-300" style={{ left: `${drag.preview.snap / duration * 100}%` }} />}
            </div>
          </div>;
        })}
        <VideoTimelineSignals doc={doc} timeline={timeline} duration={duration} grid={grid} playhead={playhead} selectedItemId={selectedItemId}
          disabled={disabled} onSeek={onSeek} onApplyOps={onApplyOps} onRecollect={onRecollectCues} recollecting={recollectingCues} />
      </div>
    </div>
    <p className="text-[12px] text-gray-500">{t(`${key}dragHint`)}</p>
    {timeline.diagnostics.length > 0 && <ul className="space-y-0.5 rounded bg-amber-500/10 p-2 text-[12px] text-amber-200">{timeline.diagnostics.slice(0, 6).map((diagnostic, index) => <li key={`${diagnostic.code}-${index}`}>{diagnostic.message}</li>)}</ul>}
  </div>;
}
