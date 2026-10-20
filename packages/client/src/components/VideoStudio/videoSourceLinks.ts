import type { VideoAsset, VideoDoc, VideoDocOp } from '@vibisual/video';

export function sourceConsumers(doc: VideoDoc, assetId: string): { id: string; label: string; chapterId?: string }[] {
  return doc.tracks.flatMap(track => track.items.flatMap(item => item.assetId === assetId
    ? [{ id: item.id, label: item.label ?? item.id, ...(item.chapterId ? { chapterId: item.chapterId } : {}) }] : []));
}

/** A new immutable asset is assigned only to chosen items. Timing, text, audio, effects, and all old assets survive. */
export function applySourceRevisionOps(doc: VideoDoc, previous: string, next: VideoAsset, targets: readonly string[]): VideoDocOp[] {
  const chosen = new Set(targets);
  const edits: VideoDocOp[] = sourceConsumers(doc, previous).filter(item => chosen.has(item.id))
    .map(item => ({ op: 'updateItem', itemId: item.id, patch: { assetId: next.id } }));
  return edits.length ? [{ op: 'setAsset', asset: next }, ...edits] : [];
}
