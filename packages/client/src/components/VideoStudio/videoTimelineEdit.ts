import { anchorItemRef, applyPatch, rebaseKeyframes, resolveTimeline, strongBeatsInDoc, type TimeAnchor, type VideoDoc, type VideoDocOp, type VideoItem } from '@vibisual/video';

export const TIMELINE_CONFIG = {
  gutter: 176, minWidth: 440, maxZoom: 16, zoomFactor: 2, snapPixels: 8,
  dragPixels: 3, largeStepFrames: 10, tickPixels: 80, defaultFps: 30,
  /** 640px 미만 창(box-narrow) — 트랙 이름 칸이 좁은 판의 레인을 다 덮지 않게 줄이고, 레인 최소 폭도 낮춘다. */
  compactGutter: 96, compactMinWidth: 320,
} as const;
export type TimelineEditMode = 'move' | 'trimStart' | 'trimEnd';

export function timelineFps(fps: number): number {
  return Number.isFinite(fps) && fps > 0 ? fps : TIMELINE_CONFIG.defaultFps;
}

export function timelineFrame(seconds: number, fps: number): number {
  return Math.round(seconds * timelineFps(fps));
}

/** The exclusive end of a clip is not a displayable frame. */
export function lastTimelineFrame(duration: number, fps: number): number {
  return Math.max(0, Math.ceil(duration * timelineFps(fps) - 1e-8) - 1);
}

export function clampTimelineSeek(seconds: number, duration: number, fps: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.max(0, Math.min(lastTimelineFrame(duration, fps), timelineFrame(seconds, fps))) / timelineFps(fps);
}

export function offsetTimelineAnchor(at: TimeAnchor, delta: number): TimeAnchor {
  return typeof at === 'number' ? at + delta : { ...at, offset: (at.offset ?? 0) + delta };
}

/** Scenes restart their animation at localTime=0; their leading edge cannot be source-trimmed. */
export function canTrimTimelineStart(item: VideoItem): boolean {
  return item.kind === 'audio' || item.kind === 'footage' || item.kind === 'image' || item.kind === 'caption' || item.kind === 'composition';
}

export function buildTimelineEditOps(doc: VideoDoc, itemId: string, mode: TimelineEditMode, deltaSeconds: number): readonly VideoDocOp[] {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds === 0) return [];
  const resolved = resolveTimeline(doc).items.find(item => item.id === itemId);
  if (!resolved) return [];
  const { item, start, end, duration } = resolved;
  const fps = timelineFps(doc.fps);
  const frame = 1 / fps;
  const boundary = mode === 'trimEnd' ? end : start;
  const requested = timelineFrame(boundary + deltaSeconds, fps) / fps - boundary;
  let patch: Partial<Omit<VideoItem, 'id'>>;
  if (mode === 'move') {
    const delta = Math.max(-start, requested);
    if (Math.abs(delta) < 1e-8) return [];
    patch = { at: offsetTimelineAnchor(item.at, delta) };
  } else if (mode === 'trimStart') {
    if (!canTrimTimelineStart(item) || duration < frame) return [];
    // §5.13 (T-1) — 컴포지션도 시간 속을 흐르는 소재다 — 앞을 자르면 그만큼 안쪽 시각(`trimStart`)이 밀린다.
    const media = item.kind === 'audio' || item.kind === 'footage' || item.kind === 'composition';
    const lower = media ? Math.max(-start, -(item.trimStart ?? 0)) : -start;
    const delta = Math.max(lower, Math.min(duration - frame, requested));
    if (Math.abs(delta) < 1e-8) return [];
    patch = { at: offsetTimelineAnchor(item.at, delta), duration: duration - delta };
    if (media) patch = { ...patch, trimStart: Math.max(0, (item.trimStart ?? 0) + delta) };
    // §5.13 (W) 38-4 — 앞을 자르면(늘리면) 상자의 시간 곡선도 그만큼 당긴다(밀린다) — 움직임이 내용에 붙어 있게.
    if (item.keyframes && item.keyframes.length > 0) patch = { ...patch, keyframes: rebaseKeyframes(item.keyframes, delta) ?? [] };
    // Cropping captions must leave absolute cue positions unchanged.
    if (item.kind === 'caption') patch = { ...patch, cues: item.cues };
  } else {
    const asset = item.assetId ? doc.assets[item.assetId] : undefined;
    const media = item.kind === 'audio' || item.kind === 'footage' || item.kind === 'composition';
    const available = media && asset?.duration !== undefined ? Math.max(frame, asset.duration - (item.trimStart ?? 0)) : Infinity;
    const nextDuration = Math.max(frame, Math.min(available, duration + requested));
    if (Math.abs(nextDuration - duration) < 1e-8) return [];
    patch = { duration: nextDuration };
  }
  return [{ op: 'updateItem', itemId, patch }];
}

/** Keep absolute caption cues in step with start/after anchors, including indirect descendants. */
export function withCaptionTimingOps(doc: VideoDoc, ops: readonly VideoDocOp[]): VideoDocOp[] {
  if (ops.length === 0) return [];
  const result = applyPatch(doc, { baseVersion: doc.version, ops }, doc.updatedAt);
  if (!result.ok) return [...ops];
  const explicit = new Set(ops.flatMap(op => op.op === 'updateItem' && Object.prototype.hasOwnProperty.call(op.patch, 'cues') ? [op.itemId] : []));
  const before = new Map(resolveTimeline(doc).items.map(item => [item.id, item]));
  const adjustments: VideoDocOp[] = [];
  for (const next of resolveTimeline(result.doc).items) {
    const previous = before.get(next.id);
    if (!previous || next.kind !== 'caption' || explicit.has(next.id) || !next.item.cues) continue;
    const delta = next.start - previous.start;
    if (Math.abs(delta) < 1e-8) continue;
    adjustments.push({ op: 'updateItem', itemId: next.id, patch: { cues: next.item.cues.map(cue => ({
      ...cue, start: cue.start + delta, end: cue.end + delta,
      ...(cue.words ? { words: cue.words.map(word => ({ ...word, t: word.t + delta })) } : {}),
    })) } });
  }
  return [...ops, ...adjustments];
}

/** Descendants move with their anchor, so they cannot be fixed snap destinations. */
export function timelineSnapPoints(doc: VideoDoc, itemId: string, playhead: number): number[] {
  const timeline = resolveTimeline(doc);
  const excluded = new Set([itemId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const { item } of timeline.items) {
      if (excluded.has(item.id) || typeof item.at === 'number') continue;
      const anchor = anchorItemRef(item.at);
      if (anchor !== undefined && excluded.has(anchor)) { excluded.add(item.id); changed = true; }
    }
  }
  // §5.13 (V) 37-12 · (T-8) — 강한 비트와 컴포지션 표지에도 붙는다(Alt 로 끄는 규칙은 같다).
  const cues = timeline.items.filter(item => item.kind === 'composition' && !excluded.has(item.id)).flatMap(item => {
    const asset = item.item.assetId === undefined ? undefined : doc.assets[item.item.assetId];
    const trim = item.item.trimStart ?? 0;
    return (asset?.cues ?? []).map(cue => item.start + (cue.t - trim)).filter(t => t >= item.start && t <= item.end);
  });
  return [...new Set([0, playhead, ...timeline.items.filter(item => !excluded.has(item.id)).flatMap(item => [item.start, item.end]), ...strongBeatsInDoc(doc, timeline), ...cues])];
}

export function snapTimelineDelta(start: number, end: number, delta: number, mode: TimelineEditMode, points: readonly number[], threshold: number): { delta: number; snap: number | null } {
  const edges = mode === 'move' ? [start, end] : [mode === 'trimStart' ? start : end];
  let adjustment = Infinity;
  let snap: number | null = null;
  for (const edge of edges) {
    for (const point of points) {
      const distance = point - (edge + delta);
      if (Math.abs(distance) <= threshold && Math.abs(distance) < Math.abs(adjustment)) { adjustment = distance; snap = point; }
    }
  }
  return { delta: snap === null ? delta : delta + adjustment, snap };
}

export function timelineTicks(duration: number, width: number, fps: number): number[] {
  const wanted = duration / Math.max(1, width / TIMELINE_CONFIG.tickPixels);
  const steps = [1 / timelineFps(fps), 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  const step = steps.find(value => value >= wanted) ?? Math.ceil(wanted / 3600) * 3600;
  return Array.from({ length: Math.ceil(duration / step) }, (_, index) => index * step);
}
