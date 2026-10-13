import { useTranslation } from 'react-i18next';
import type { KeyboardEvent } from 'react';
import type { ResolvedItem, VideoDoc, VideoDocOp } from '@vibisual/video';
import { buildTimelineEditOps, canTrimTimelineStart, timelineFps, TIMELINE_CONFIG, type TimelineEditMode } from './videoTimelineEdit.js';
import type { useVideoTimelineDrag } from './useVideoTimelineDrag.js';

// §5.13 (V) 37-1 — 트랙 성격의 색(앱 색 ❌ · violet ❌). 고른 클립의 링만 앱 색이다.
const TRACK_TONE: Record<string, string> = {
  visual: 'bg-slate-600/80 border-slate-300/40',
  audio: 'bg-emerald-700/70 border-emerald-300/40',
  caption: 'bg-sky-700/70 border-sky-300/40',
};
interface VideoTimelineClipProps {
  item: ResolvedItem;
  doc: VideoDoc;
  duration: number;
  selected: boolean;
  disabled: boolean;
  drag: ReturnType<typeof useVideoTimelineDrag>;
  onSelectItem: (id: string | null) => void;
  onApplyOps?: (ops: readonly VideoDocOp[]) => void;
}

export function VideoTimelineClip({ item, doc, duration, selected, disabled, drag, onSelectItem, onApplyOps }: VideoTimelineClipProps): React.JSX.Element {
  const { t } = useTranslation();
  const key = 'panel.videoStudio.timelineEditor.';
  const label = item.item.label ?? item.item.sceneId ?? item.id;
  const keyboardEdit = (event: KeyboardEvent<HTMLButtonElement>, mode: TimelineEditMode): void => {
    if (event.key === 'Escape') { event.stopPropagation(); drag.cancel(); return; }
    if (disabled || !onApplyOps || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault(); event.stopPropagation();
    const delta = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? TIMELINE_CONFIG.largeStepFrames : 1) / timelineFps(doc.fps);
    const ops = buildTimelineEditOps(doc, item.id, mode, delta);
    if (ops.length > 0) onApplyOps(ops);
  };
  const events = (mode: TimelineEditMode) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>): void => drag.start(event, item.id, mode),
    onPointerMove: drag.move, onPointerUp: drag.finish, onPointerCancel: drag.cancel, onLostPointerCapture: drag.cancel,
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>): void => keyboardEdit(event, mode),
  });
  // §5.13 (T-7) — 코드 컴포지션은 씬과 같은 줄·같은 모양으로 서되 코드 글리프와 남색 톤으로 구별한다.
  const isComposition = item.kind === 'composition';
  const tone = isComposition ? 'bg-zinc-600/80 border-zinc-300/40' : TRACK_TONE[item.trackKind];
  return <div className={`group absolute top-1 h-9 rounded border ${tone} ${item.item.enabled === false ? 'opacity-40' : ''} ${selected ? 'z-10 ring-2 ring-[var(--vs-accent)]' : ''}`}
    data-timeline-item={item.id} style={{ left: `${item.start / duration * 100}%`, width: `${item.duration / duration * 100}%`, minWidth: 12 }}>
    <button type="button" className={`h-full w-full touch-none overflow-hidden rounded px-3 text-left text-[12px] text-white ${disabled ? '' : 'cursor-grab active:cursor-grabbing'}`}
      aria-label={t(`${key}moveClip`, { name: label })} aria-pressed={selected}
      title={`${label} · ${item.start.toFixed(3)}s – ${item.end.toFixed(3)}s`}
      onClick={() => onSelectItem(item.id)} {...events('move')}>
      <span className="flex min-w-0 items-center gap-1">
        {typeof item.item.at === 'object' && 'cue' in item.item.at ? (
          <span title={t('panel.videoStudio.signals.boundTo', { name: item.item.at.cue })} className="shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 opacity-85" aria-hidden="true">
              <circle cx="12" cy="7" r="3.5" /><path d="M12 10.5V21" />
            </svg>
          </span>
        ) : null}
        {isComposition ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0 opacity-85" aria-hidden="true">
            <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
          </svg>
        ) : null}
        <span className="block truncate font-medium">{label}</span>
      </span>
    </button>
    {(['trimStart', 'trimEnd'] as const).map(mode => {
      const supported = mode !== 'trimStart' || canTrimTimelineStart(item.item);
      const handleLabel = t(`${key}${mode}`, { name: label });
      return <button key={mode} type="button" disabled={disabled || !supported} aria-label={handleLabel}
        title={supported ? handleLabel : t(`${key}trimUnsupported`)}
        className={`absolute top-0 h-full w-2 touch-none cursor-ew-resize rounded bg-white/25 opacity-0 hover:bg-white/60 focus:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:bg-white/10 ${selected ? 'opacity-100' : ''} ${mode === 'trimStart' ? 'left-0' : 'right-0'}`}
        {...events(mode)} />;
    })}
  </div>;
}
