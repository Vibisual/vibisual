/**
 * 문서 편집 연산 (SCENARIO.md §5.13 (G)).
 *
 * 에이전트가 문서를 고치는 유일한 통로다. 두 가지 규율을 코드로 강제한다:
 *
 * 1. **낙관적 잠금** — 패치는 `baseVersion` 을 들고 오고, 그 사이 문서가 바뀌었으면
 *    거절한다. 여러 에이전트가 같은 문서를 동시에 만지는 것이 이 앱의 기본 상황이라
 *    (씬마다 다른 에이전트를 붙일 수 있다) 마지막에 쓴 쪽이 조용히 이기는 구조를
 *    두면 작업이 소리 없이 사라진다.
 * 2. **안정 식별자만** — 모든 연산이 id 로 대상을 찾는다. 순번을 쓰면 에이전트가
 *    읽은 시점과 쓰는 시점 사이에 아이템 하나만 들어와도 엉뚱한 것을 고친다.
 *
 * 그리고 **전부를 적용하거나 아무것도 적용하지 않는다.** 중간에 실패한 패치가 절반만
 * 반영되면 에이전트는 자기가 무엇을 만든 건지 알 수 없게 된다.
 */

import type {
  VideoAsset,
  VideoDoc,
  VideoDocOp,
  VideoDocPatch,
  VideoDocPatchResult,
  VideoItem,
  VideoTrack,
} from './types.js';

/** 연산 하나가 실패한 이유. 성공이면 새 문서를 돌려준다. */
type OpOutcome = { ok: true; doc: VideoDoc } | { ok: false; message: string };

function findTrackIndex(doc: VideoDoc, trackId: string): number {
  return doc.tracks.findIndex((t) => t.id === trackId);
}

function findItemLocation(doc: VideoDoc, itemId: string): { trackIndex: number; itemIndex: number } | undefined {
  for (let ti = 0; ti < doc.tracks.length; ti += 1) {
    const track = doc.tracks[ti];
    if (!track) continue;
    const ii = track.items.findIndex((it) => it.id === itemId);
    if (ii >= 0) return { trackIndex: ti, itemIndex: ii };
  }
  return undefined;
}

function withTracks(doc: VideoDoc, tracks: readonly VideoTrack[]): VideoDoc {
  return { ...doc, tracks };
}

function replaceTrack(doc: VideoDoc, trackIndex: number, next: VideoTrack): VideoDoc {
  const tracks = doc.tracks.slice();
  tracks[trackIndex] = next;
  return withTracks(doc, tracks);
}

/** `beforeItemId` 가 있으면 그 앞에, 없으면 끝에 넣는다. */
function insertItem(items: readonly VideoItem[], item: VideoItem, beforeItemId?: string): VideoItem[] {
  const next = items.slice();
  if (beforeItemId === undefined) {
    next.push(item);
    return next;
  }
  const at = next.findIndex((it) => it.id === beforeItemId);
  if (at < 0) next.push(item);
  else next.splice(at, 0, item);
  return next;
}

function allItemIds(doc: VideoDoc): Set<string> {
  const ids = new Set<string>();
  for (const track of doc.tracks) for (const item of track.items) ids.add(item.id);
  return ids;
}

function applyOp(doc: VideoDoc, op: VideoDocOp): OpOutcome {
  switch (op.op) {
    case 'addTrack': {
      if (findTrackIndex(doc, op.track.id) >= 0) {
        return { ok: false, message: `트랙 '${op.track.id}' 가 이미 있습니다.` };
      }
      const clash = allItemIds(doc);
      for (const item of op.track.items) {
        if (clash.has(item.id)) {
          return { ok: false, message: `아이템 id '${item.id}' 가 이미 다른 트랙에 있습니다.` };
        }
      }
      const tracks = doc.tracks.slice();
      const at = op.beforeTrackId === undefined ? -1 : findTrackIndex(doc, op.beforeTrackId);
      if (at < 0) tracks.push(op.track);
      else tracks.splice(at, 0, op.track);
      return { ok: true, doc: withTracks(doc, tracks) };
    }

    case 'removeTrack': {
      const ti = findTrackIndex(doc, op.trackId);
      if (ti < 0) return { ok: false, message: `트랙 '${op.trackId}' 가 없습니다.` };
      const tracks = doc.tracks.slice();
      tracks.splice(ti, 1);
      return { ok: true, doc: withTracks(doc, tracks) };
    }

    case 'updateTrack': {
      const ti = findTrackIndex(doc, op.trackId);
      const track = doc.tracks[ti];
      if (ti < 0 || !track) return { ok: false, message: `트랙 '${op.trackId}' 가 없습니다.` };
      return { ok: true, doc: replaceTrack(doc, ti, { ...track, ...op.patch, id: track.id, items: track.items }) };
    }

    case 'addItem': {
      const ti = findTrackIndex(doc, op.trackId);
      const track = doc.tracks[ti];
      if (ti < 0 || !track) return { ok: false, message: `트랙 '${op.trackId}' 가 없습니다.` };
      if (allItemIds(doc).has(op.item.id)) {
        return { ok: false, message: `아이템 id '${op.item.id}' 가 이미 있습니다.` };
      }
      return {
        ok: true,
        doc: replaceTrack(doc, ti, { ...track, items: insertItem(track.items, op.item, op.beforeItemId) }),
      };
    }

    case 'removeItem': {
      const loc = findItemLocation(doc, op.itemId);
      if (!loc) return { ok: false, message: `아이템 '${op.itemId}' 가 없습니다.` };
      const track = doc.tracks[loc.trackIndex];
      if (!track) return { ok: false, message: `아이템 '${op.itemId}' 의 트랙을 찾을 수 없습니다.` };
      const items = track.items.slice();
      items.splice(loc.itemIndex, 1);
      return { ok: true, doc: replaceTrack(doc, loc.trackIndex, { ...track, items }) };
    }

    case 'updateItem': {
      const loc = findItemLocation(doc, op.itemId);
      if (!loc) return { ok: false, message: `아이템 '${op.itemId}' 가 없습니다.` };
      const track = doc.tracks[loc.trackIndex];
      const prev = track?.items[loc.itemIndex];
      if (!track || !prev) return { ok: false, message: `아이템 '${op.itemId}' 를 읽을 수 없습니다.` };
      const items = track.items.slice();
      items[loc.itemIndex] = { ...prev, ...op.patch, id: prev.id };
      return { ok: true, doc: replaceTrack(doc, loc.trackIndex, { ...track, items }) };
    }

    case 'moveItem': {
      const loc = findItemLocation(doc, op.itemId);
      if (!loc) return { ok: false, message: `아이템 '${op.itemId}' 가 없습니다.` };
      const toIndex = findTrackIndex(doc, op.toTrackId);
      if (toIndex < 0) return { ok: false, message: `트랙 '${op.toTrackId}' 가 없습니다.` };

      const fromTrack = doc.tracks[loc.trackIndex];
      const moving = fromTrack?.items[loc.itemIndex];
      if (!fromTrack || !moving) return { ok: false, message: `아이템 '${op.itemId}' 를 읽을 수 없습니다.` };

      const tracks = doc.tracks.slice();
      const fromItems = fromTrack.items.slice();
      fromItems.splice(loc.itemIndex, 1);
      tracks[loc.trackIndex] = { ...fromTrack, items: fromItems };

      const toTrack = tracks[toIndex];
      if (!toTrack) return { ok: false, message: `트랙 '${op.toTrackId}' 를 읽을 수 없습니다.` };
      tracks[toIndex] = { ...toTrack, items: insertItem(toTrack.items, moving, op.beforeItemId) };

      return { ok: true, doc: withTracks(doc, tracks) };
    }

    case 'setAsset': {
      const assets: Record<string, VideoAsset> = { ...doc.assets, [op.asset.id]: op.asset };
      return { ok: true, doc: { ...doc, assets } };
    }

    case 'removeAsset': {
      if (!(op.assetId in doc.assets)) return { ok: false, message: `소재 '${op.assetId}' 가 없습니다.` };
      const assets: Record<string, VideoAsset> = { ...doc.assets };
      delete assets[op.assetId];
      return { ok: true, doc: { ...doc, assets } };
    }

    case 'setDoc': {
      return { ok: true, doc: { ...doc, ...op.patch } };
    }

    default: {
      // 유니온이 늘었는데 여기 분기를 안 만들면 컴파일 단계에서 잡힌다.
      const exhaustive: never = op;
      return { ok: false, message: `알 수 없는 연산: ${JSON.stringify(exhaustive)}` };
    }
  }
}

/**
 * 패치를 적용한다.
 *
 * 성공하면 `version` 이 1 오르고 `updatedAt` 이 갱신된 **새 문서**를 돌려준다.
 * 원본은 건드리지 않는다(불변 — 되돌리기와 비교가 공짜가 된다).
 */
export function applyPatch(doc: VideoDoc, patch: VideoDocPatch, now = Date.now()): VideoDocPatchResult {
  if (patch.baseVersion !== doc.version) {
    return { ok: false, reason: 'version-conflict', currentVersion: doc.version };
  }

  let next = doc;
  for (let i = 0; i < patch.ops.length; i += 1) {
    const op = patch.ops[i];
    if (!op) continue;
    const outcome = applyOp(next, op);
    if (!outcome.ok) {
      // 부분 적용을 남기지 않는다 — 여기서 그냥 돌아가면 `next` 는 버려진다.
      return { ok: false, reason: 'invalid-op', opIndex: i, message: outcome.message };
    }
    next = outcome.doc;
  }

  return {
    ok: true,
    doc: { ...next, version: doc.version + 1, updatedAt: now },
    applied: patch.ops.length,
  };
}

/** 빈 문서. 새 영상을 시작할 때의 기본값. */
export function createEmptyDoc(id: string, title: string, now = Date.now()): VideoDoc {
  return {
    schemaVersion: 1,
    id,
    title,
    version: 1,
    size: { width: 1920, height: 1080 },
    fps: 30,
    tracks: [
      { id: 'visual', kind: 'visual', label: 'Visual', items: [] },
      { id: 'audio', kind: 'audio', label: 'Audio', items: [] },
      { id: 'caption', kind: 'caption', label: 'Caption', items: [] },
    ],
    assets: {},
    createdAt: now,
    updatedAt: now,
  };
}
