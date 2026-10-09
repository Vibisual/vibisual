import { useTranslation } from 'react-i18next';
import type { KeyboardEvent } from 'react';
import type { ResolvedItem, VideoDoc, VideoDocOp } from '@vibisual/video';
import { buildTimelineEditOps, canTrimTimelineStart, timelineFps, TIMELINE_CONFIG, type TimelineEditMode } from './videoTimelineEdit.js';
import type { useVideoTimelineDrag } from './useVideoTimelineDrag.js';

const TRACK_TONE: Record<string, string> = {
  visual: 'bg-violet-600/80 border-violet-300/50',
  audio: 'bg-emerald-600/80 border-emerald-300/50',
  caption: 'bg-sky-600/80 border-sky-300/50',
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
  return <div className={`group absolute top-1 h-9 rounded border ${TRACK_TONE[item.trackKind]} ${item.item.enabled === false ? 'opacity-40' : ''} ${selected ? 'z-10 ring-2 ring-white/80' : ''}`}
    data-timeline-item={item.id} style={{ left: `${item.start / duration * 100}%`, width: `${item.duration / duration * 100}%`, minWidth: 12 }}>
    <button type="button" className={`h-full w-full touch-none overflow-hidden rounded px-3 text-left text-[12px] text-white ${disabled ? '' : 'cursor-grab active:cursor-grabbing'}`}
      aria-label={t(`${key}moveClip`, { name: label })} aria-pressed={selected}
      title={`${label} · ${item.start.toFixed(3)}s – ${item.end.toFixed(3)}s`}
      onClick={() => onSelectItem(item.id)} {...events('move')}>
      <span className="block truncate font-medium">{label}</span>
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
