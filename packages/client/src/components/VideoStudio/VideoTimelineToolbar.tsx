import { useTranslation } from 'react-i18next';
import { clampTimelineSeek, lastTimelineFrame, timelineFps, timelineFrame, TIMELINE_CONFIG } from './videoTimelineEdit.js';

interface VideoTimelineToolbarProps {
  zoom: number;
  onZoom: (zoom: number) => void;
  snap: boolean;
  onSnap: () => void;
  playhead: number;
  duration: number;
  fps: number;
  onSeek: (time: number) => void;
}

export function VideoTimelineToolbar({ zoom, onZoom, snap, onSnap, playhead, duration, fps, onSeek }: VideoTimelineToolbarProps): React.JSX.Element {
  const { t } = useTranslation();
  const key = 'panel.videoStudio.timelineEditor.';
  const button = 'rounded px-2 py-1 text-[12px] text-gray-300 hover:bg-white/10 disabled:opacity-30';
  return <div className="flex flex-wrap items-center gap-1 border-b border-white/10 pb-2">
    <button type="button" className={button} aria-label={t(`${key}zoomOut`)} title={t(`${key}zoomOut`)} disabled={zoom <= 1} onClick={() => onZoom(Math.max(1, zoom / TIMELINE_CONFIG.zoomFactor))}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6M7 10h6" /></svg>
    </button>
    <span className="w-12 text-center font-mono text-[12px] text-gray-400">{Math.round(zoom * 100)}%</span>
    <button type="button" className={button} aria-label={t(`${key}zoomIn`)} title={t(`${key}zoomIn`)} disabled={zoom >= TIMELINE_CONFIG.maxZoom} onClick={() => onZoom(Math.min(TIMELINE_CONFIG.maxZoom, zoom * TIMELINE_CONFIG.zoomFactor))}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6M7 10h6M10 7v6" /></svg>
    </button>
    <button type="button" className={button} onClick={() => onZoom(1)}>{t(`${key}fit`)}</button>
    <button type="button" className={`${button} ml-1 ${snap ? 'bg-violet-500/20 text-violet-200' : ''}`} aria-pressed={snap} onClick={onSnap}>{t(`${key}snap`)}</button>
    <label className="ml-auto flex items-center gap-2 text-[12px] text-gray-400">
      {t(`${key}frame`)}
      <input className="w-20 rounded border border-white/10 bg-gray-950 px-2 py-1 font-mono text-gray-200" type="number" min={0} max={lastTimelineFrame(duration, fps)} step={1}
        value={timelineFrame(clampTimelineSeek(playhead, duration, fps), fps)} aria-label={t(`${key}frame`)}
        onChange={event => { if (event.target.value !== '' && Number.isFinite(event.target.valueAsNumber)) onSeek(clampTimelineSeek(event.target.valueAsNumber / timelineFps(fps), duration, fps)); }} />
      <span className="font-mono">{timelineFps(fps)} fps</span>
    </label>
  </div>;
}
