import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { applyPatch, resolveTimeline, type VideoDoc, type VideoDocOp } from '@vibisual/video';
import { buildTimelineEditOps, snapTimelineDelta, timelineSnapPoints, withCaptionTimingOps, TIMELINE_CONFIG, type TimelineEditMode } from './videoTimelineEdit.js';

interface DragState {
  doc: VideoDoc;
  itemId: string;
  mode: TimelineEditMode;
  pointerId: number;
  startX: number;
  laneX: number;
  pixelsPerSecond: number;
  points: readonly number[];
  start: number;
  end: number;
}
interface Preview { doc: VideoDoc; base: VideoDoc; snap: number | null }
interface VideoTimelineDragOptions {
  doc: VideoDoc;
  duration: number;
  playhead: number;
  laneRef: RefObject<HTMLDivElement>;
  snap: boolean;
  disabled: boolean;
  onApplyOps?: (ops: readonly VideoDocOp[]) => void;
  onSelectItem: (itemId: string | null) => void;
}

export function useVideoTimelineDrag({ doc, duration, playhead, laneRef, snap, disabled, onApplyOps, onSelectItem }: VideoTimelineDragOptions) {
  const drag = useRef<DragState | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  useEffect(() => { drag.current = null; setPreview(null); }, [doc, disabled]);

  const cancel = (): void => { drag.current = null; setPreview(null); };
  const start = (event: PointerEvent<HTMLButtonElement>, itemId: string, mode: TimelineEditMode): void => {
    if (event.button !== 0) return;
    event.stopPropagation();
    onSelectItem(itemId);
    if (disabled || !onApplyOps) return;
    const rect = laneRef.current?.getBoundingClientRect();
    const item = resolveTimeline(doc).items.find(value => value.id === itemId);
    if (!rect || rect.width <= 0 || !item) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { doc, itemId, mode, pointerId: event.pointerId, startX: event.clientX, laneX: event.clientX - rect.left,
      pixelsPerSecond: rect.width / duration, points: timelineSnapPoints(doc, itemId, playhead), start: item.start, end: item.end };
  };
  const calculate = (event: PointerEvent<HTMLButtonElement>): { ops: readonly VideoDocOp[]; snap: number | null } => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId || state.doc !== doc || disabled) return { ops: [], snap: null };
    if (Math.abs(event.clientX - state.startX) < TIMELINE_CONFIG.dragPixels) return { ops: [], snap: null };
    const left = laneRef.current?.getBoundingClientRect().left;
    if (left === undefined) return { ops: [], snap: null };
    const delta = (event.clientX - left - state.laneX) / state.pixelsPerSecond;
    const result = snap && !event.altKey
      ? snapTimelineDelta(state.start, state.end, delta, state.mode, state.points, TIMELINE_CONFIG.snapPixels / state.pixelsPerSecond)
      : { delta, snap: null };
    return { ops: buildTimelineEditOps(doc, state.itemId, state.mode, result.delta), snap: result.snap };
  };
  const move = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!drag.current) return;
    event.stopPropagation();
    const next = calculate(event);
    const result = applyPatch(doc, { baseVersion: doc.version, ops: withCaptionTimingOps(doc, next.ops) }, doc.updatedAt);
    if (result.ok) setPreview({ doc: result.doc, base: doc, snap: next.snap });
  };
  const finish = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const next = calculate(event);
    cancel();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (next.ops.length > 0) onApplyOps?.(next.ops);
  };
  return { preview: preview?.base === doc && !disabled ? preview : null, start, move, finish, cancel };
}
