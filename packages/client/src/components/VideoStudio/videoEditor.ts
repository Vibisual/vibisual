import {
  DEFAULT_VIDEO_FPS, anchorItemRef, rebaseKeyframes, resolveTimeline, restoreOps,
  type VideoAsset, type VideoDoc, type VideoDocOp, type VideoItem, type VideoTrackKind,
} from '@vibisual/video';

export const EDITOR_SCENE_IDS = ['title', 'lowerThird', 'bulletList', 'codeBlock', 'quote', 'solid'] as const;
export type EditorSceneId = typeof EDITOR_SCENE_IDS[number];
const DEFAULTS = { duration: 5, accent: '#3B82F6', color: '#FFFFFF', background: '#0B1120', fontRatio: 0.06, shapeRatio: 0.35 };

/** IDs are deterministic for a document snapshot; callers never need a separate mutable counter. */
export function nextEditorId(doc: VideoDoc, prefix: string): string {
  const ids = new Set([...doc.tracks.map(t => t.id), ...doc.tracks.flatMap(t => t.items.map(i => i.id)), ...Object.keys(doc.assets)]);
  let suffix = 1;
  while (ids.has(`${prefix}-${suffix}`)) suffix += 1;
  return `${prefix}-${suffix}`;
}

export function snapEditorTime(doc: VideoDoc, seconds: number): number {
  const fps = Number.isFinite(doc.fps) && doc.fps > 0 ? doc.fps : DEFAULT_VIDEO_FPS;
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * fps) / fps) : 0;
}

export function isCompatibleTrack(kind: VideoItem['kind'], trackKind: VideoTrackKind): boolean {
  return trackKind === (kind === 'audio' ? 'audio' : kind === 'caption' ? 'caption' : 'visual');
}

/** New visual layers stay below the caption track and avoid invisible/muted tracks. */
export function buildInsertItemOps(doc: VideoDoc, item: VideoItem): VideoDocOp[] {
  const kind: VideoTrackKind = item.kind === 'audio' ? 'audio' : item.kind === 'caption' ? 'caption' : 'visual';
  const track = [...doc.tracks].reverse().find(t => t.kind === kind && !t.hidden && !t.muted);
  if (track) return [{ op: 'addItem', trackId: track.id, item }];
  return [{ op: 'addTrack', track: { id: nextEditorId(doc, kind), kind, items: [item] },
    ...(kind === 'visual' ? { beforeTrackId: doc.tracks.find(t => t.kind === 'caption')?.id } : {}) }];
}

export function buildAddSceneOps(doc: VideoDoc, sceneId: string, at: number, label: string): VideoDocOp[] {
  const propsByScene: Record<EditorSceneId, Readonly<Record<string, unknown>>> = {
    title: { title: label, subtitle: '', color: DEFAULTS.color, accent: DEFAULTS.accent },
    lowerThird: { name: label, role: '', accent: DEFAULTS.accent },
    bulletList: { heading: label, items: [label], accent: DEFAULTS.accent },
    codeBlock: { lines: [label] },
    quote: { text: label, by: '', accent: DEFAULTS.accent },
    solid: { color: DEFAULTS.background },
  };
  if (!EDITOR_SCENE_IDS.some(id => id === sceneId)) return [];
  return buildInsertItemOps(doc, { id: nextEditorId(doc, 'scene'), kind: 'scene', sceneId,
    at: snapEditorTime(doc, at), duration: DEFAULTS.duration, label, props: propsByScene[sceneId as EditorSceneId] });
}

export function buildAddTextOps(doc: VideoDoc, at: number, text: string): VideoDocOp[] {
  return buildInsertItemOps(doc, { id: nextEditorId(doc, 'text'), kind: 'text', at: snapEditorTime(doc, at),
    duration: DEFAULTS.duration, label: text, props: { text, color: DEFAULTS.color, fontSize: Math.round(doc.size.height * DEFAULTS.fontRatio) } });
}

export function buildAddShapeOps(doc: VideoDoc, at: number, label: string): VideoDocOp[] {
  const side = Math.round(Math.min(doc.size.width, doc.size.height) * DEFAULTS.shapeRatio);
  return buildInsertItemOps(doc, { id: nextEditorId(doc, 'shape'), kind: 'shape', at: snapEditorTime(doc, at),
    duration: DEFAULTS.duration, label, props: { shape: 'rect', fill: DEFAULTS.accent },
    transform: { x: (doc.size.width - side) / 2, y: (doc.size.height - side) / 2, width: side, height: side } });
}

export function buildAssetItemOps(doc: VideoDoc, asset: VideoAsset, at: number, label: string): VideoDocOp[] {
  if (asset.kind === 'font') return [];
  const measured = Number.isFinite(asset.duration) && (asset.duration ?? 0) > 0;
  // §5.13 (T-1) — 컴포지션은 길이를 선언하지 않았어도 올린다(기본 길이로) — 코드를 쓰기 전의 뼈대도 타임라인에 선다.
  if (asset.kind !== 'image' && asset.kind !== 'model' && asset.kind !== 'composition' && !measured) return [];
  const duration = asset.kind === 'image' || ((asset.kind === 'composition' || asset.kind === 'model') && !measured) ? DEFAULTS.duration : 'auto';
  const item: VideoItem = { id: nextEditorId(doc, asset.kind === 'composition' ? 'comp' : 'media'), kind: asset.kind === 'video' ? 'footage' : asset.kind,
    assetId: asset.id, at: snapEditorTime(doc, at), duration, label };
  return [{ op: 'setAsset', asset }, ...buildInsertItemOps(doc, item)];
}

/** 시간 속을 흐르는 소재(앞을 잘라 낼 수 있는 것) — 영상·소리·컴포지션. 분할·트림이 `trimStart` 를 민다. */
export function isTimedSourceKind(kind: VideoItem['kind']): boolean {
  return kind === 'footage' || kind === 'audio' || kind === 'composition' || kind === 'model';
}

function duplicateId(doc: VideoDoc, itemId: string, newId?: string): string | undefined {
  const id = newId ?? nextEditorId(doc, `${itemId}-copy`);
  return id.trim() && !doc.tracks.some(t => t.items.some(i => i.id === id)) ? id : undefined;
}

export function buildDuplicateOps(doc: VideoDoc, itemId: string, newId?: string): VideoDocOp[] {
  const resolved = resolveTimeline(doc).items.find(i => i.id === itemId);
  const id = duplicateId(doc, itemId, newId);
  if (!resolved || !id) return [];
  const at = snapEditorTime(doc, resolved.end);
  const shift = at - resolved.start;
  const item = structuredClone(resolved.item);
  return [{ op: 'addItem', trackId: resolved.trackId, item: { ...item, id, at,
    ...(item.cues ? { cues: item.cues.map(cue => ({ ...cue, start: cue.start + shift, end: cue.end + shift,
      ...(cue.words ? { words: cue.words.map(word => ({ ...word, t: word.t + shift })) } : {}) })) } : {}) } }];
}

/** A split keeps the original start anchor, moves end anchors to the right half, and never ripples followers. */
export function buildSplitOps(doc: VideoDoc, itemId: string, at: number, newId?: string): VideoDocOp[] {
  const resolved = resolveTimeline(doc).items.find(i => i.id === itemId);
  const id = duplicateId(doc, itemId, newId);
  // Built-in scenes animate from localTime=0; splitting them would restart their animation.
  if (!resolved || !id || !Number.isFinite(at) || resolved.kind === 'scene') return [];
  const cut = snapEditorTime(doc, at);
  const frame = 1 / doc.fps;
  if (cut - resolved.start < frame - Number.EPSILON || resolved.end - cut < frame - Number.EPSILON) return [];
  const leftDuration = cut - resolved.start;
  const original = resolved.item;
  const cuePatch = (start: number, end: number): Partial<VideoItem> => original.cues ? {
    cues: original.cues.filter(c => c.start < end && c.end > start).map(c => ({ ...c, start: Math.max(c.start, start), end: Math.min(c.end, end) })),
  } : {};
  // 오른쪽 반은 왼쪽이 끝난 자리부터 이어 흐른다 — 컴포지션도 처음으로 되감기지 않게 `trimStart` 를 민다.
  const right: VideoItem = { ...structuredClone(original), id, at: { after: itemId }, duration: resolved.end - cut,
    ...(isTimedSourceKind(original.kind) ? { trimStart: (original.trimStart ?? 0) + leftDuration } : {}),
    // §5.13 (W) 38-4 — 오른쪽 반의 상자 곡선은 자른 자리부터 이어진다(그 자리 값에서 시작).
    ...(original.keyframes && original.keyframes.length > 0 ? { keyframes: rebaseKeyframes(original.keyframes, leftDuration) ?? [] } : {}),
    ...cuePatch(cut, resolved.end) };
  const track = doc.tracks.find(t => t.id === resolved.trackId);
  const nextItem = track?.items[(track.items.findIndex(i => i.id === itemId)) + 1];
  const ops: VideoDocOp[] = [
    { op: 'updateItem', itemId, patch: { duration: leftDuration, ...cuePatch(resolved.start, cut) } },
    { op: 'addItem', trackId: resolved.trackId, item: right, ...(nextItem ? { beforeItemId: nextItem.id } : {}) },
  ];
  for (const item of doc.tracks.flatMap(t => t.items)) {
    if (typeof item.at !== 'number' && 'after' in item.at && item.at.after === itemId) {
      ops.push({ op: 'updateItem', itemId: item.id, patch: { at: { ...item.at, after: id } } });
    }
  }
  return ops;
}

export function buildRemoveOps(doc: VideoDoc, itemId: string): VideoDocOp[] {
  const items = doc.tracks.flatMap(t => t.items);
  if (!items.some(i => i.id === itemId)) return [];
  const timeline = new Map(resolveTimeline(doc).items.map(i => [i.id, i]));
  const ops: VideoDocOp[] = [];
  for (const item of items) {
    if (anchorItemRef(item.at) !== itemId) continue;
    const resolved = timeline.get(item.id);
    // An unresolved dependency has no trustworthy absolute time; do not break it further by deleting its anchor.
    if (!resolved) return [];
    ops.push({ op: 'updateItem', itemId: item.id, patch: { at: resolved.start } });
  }
  return [...ops, { op: 'removeItem', itemId }];
}

/**
 * Content-only restoration uses existing atomic operations; server identity and version stay authoritative.
 * §5.13 (V) 37-3 — 정본은 순수 층의 `restoreOps`(판 기록의 [이 판으로 돌아가기]와 한 벌 — 장면·스타일까지).
 */
export function buildRestoreOps(current: VideoDoc, target: VideoDoc): VideoDocOp[] {
  return restoreOps(current, target);
}
