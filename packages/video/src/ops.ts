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

import { VIDEO_SCHEMA_VERSION } from './constants.js';
import type {
  VideoAsset,
  VideoChapter,
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

/** `beforeChapterId` 가 있으면 그 앞에, 없으면(또는 못 찾으면) 끝에. */
function insertChapter(chapters: readonly VideoChapter[], chapter: VideoChapter, beforeChapterId?: string): VideoChapter[] {
  const next = chapters.slice();
  const at = beforeChapterId === undefined ? -1 : next.findIndex((c) => c.id === beforeChapterId);
  if (at < 0) next.push(chapter);
  else next.splice(at, 0, chapter);
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
      // `style: null` = 스타일을 걷는다(JSON 은 undefined 를 보낼 수 없다).
      const { style, ...rest } = op.patch;
      const next: VideoDoc = { ...doc, ...rest };
      if (style === null) {
        const { style: _drop, ...without } = next;
        return { ok: true, doc: without };
      }
      return { ok: true, doc: style === undefined ? next : { ...next, style } };
    }

    // ─── §5.13 (V) 37-4 장면 층 ───

    case 'addChapter': {
      const chapters = doc.chapters ?? [];
      if (chapters.some((c) => c.id === op.chapter.id)) {
        return { ok: false, message: `장면 '${op.chapter.id}' 가 이미 있습니다.` };
      }
      return { ok: true, doc: { ...doc, chapters: insertChapter(chapters, op.chapter, op.beforeChapterId) } };
    }

    case 'updateChapter': {
      const chapters = doc.chapters ?? [];
      const at = chapters.findIndex((c) => c.id === op.chapterId);
      const prev = chapters[at];
      if (at < 0 || !prev) return { ok: false, message: `장면 '${op.chapterId}' 가 없습니다.` };
      const next = chapters.slice();
      next[at] = { ...prev, ...op.patch, id: prev.id };
      return { ok: true, doc: { ...doc, chapters: next } };
    }

    case 'removeChapter': {
      const chapters = doc.chapters ?? [];
      if (!chapters.some((c) => c.id === op.chapterId)) return { ok: false, message: `장면 '${op.chapterId}' 가 없습니다.` };
      return { ok: true, doc: { ...doc, chapters: chapters.filter((c) => c.id !== op.chapterId) } };
    }

    case 'moveChapter': {
      const chapters = doc.chapters ?? [];
      const moving = chapters.find((c) => c.id === op.chapterId);
      if (!moving) return { ok: false, message: `장면 '${op.chapterId}' 가 없습니다.` };
      if (op.beforeChapterId === op.chapterId) return { ok: true, doc };
      const rest = chapters.filter((c) => c.id !== op.chapterId);
      return { ok: true, doc: { ...doc, chapters: insertChapter(rest, moving, op.beforeChapterId) } };
    }

    case 'setChapters': {
      const seen = new Set<string>();
      for (const c of op.chapters) {
        if (seen.has(c.id)) return { ok: false, message: `장면 id '${c.id}' 가 두 번 나옵니다.` };
        seen.add(c.id);
      }
      if (op.chapters.length === 0) {
        const { chapters: _drop, ...without } = doc;
        return { ok: true, doc: without };
      }
      return { ok: true, doc: { ...doc, chapters: op.chapters.slice() } };
    }

    default: {
      // 유니온이 늘었는데 여기 분기를 안 만들면 컴파일 단계에서 잡힌다.
      const exhaustive: never = op;
      return { ok: false, message: `알 수 없는 연산: ${JSON.stringify(exhaustive)}` };
    }
  }
}

/**
 * 이 문서를 읽으려면 앱이 알아야 하는 스키마 판 — 쓰는 기능에서 정한다(§5.13 (I) — 판을 올리는 까닭은 옛 앱이 모르는
 * 것을 조용히 버리지 않고 "앱을 업데이트하세요"로 말하게 하려는 것이다). 3 = 장면 층·장면/표지 앵커·갈래·문서 스타일·파생
 * (§5.13 (V)), 2 = 코드 컴포지션(§5.13 (T-1)).
 */
export function requiredSchemaVersion(doc: VideoDoc): number {
  if ((doc.chapters?.length ?? 0) > 0 || doc.style !== undefined || doc.derivedFrom !== undefined) return 3;
  let need = 1;
  for (const track of doc.tracks) {
    for (const item of track.items) {
      if (item.chapterId !== undefined || item.variantId !== undefined) return 3;
      if (typeof item.at !== 'number' && ('chapter' in item.at || 'cue' in item.at)) return 3;
      if (item.kind === 'composition') need = 2;
    }
  }
  if (Object.values(doc.assets).some((a) => a.kind === 'composition')) need = Math.max(need, 2);
  return need;
}

/**
 * 패치를 적용한다.
 *
 * 성공하면 `version` 이 1 오르고 `updatedAt` 이 갱신된 **새 문서**를 돌려준다.
 * 원본은 건드리지 않는다(불변 — 되돌리기와 비교가 공짜가 된다). 새 기능을 쓰기 시작한 문서는 스키마 판이 따라 오른다
 * (내리지는 않는다 — 한 번 오른 판은 그 문서가 거쳐 온 기록이다).
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

  const schemaVersion = Math.max(next.schemaVersion, Math.min(VIDEO_SCHEMA_VERSION, requiredSchemaVersion(next)));
  return {
    ok: true,
    doc: { ...next, schemaVersion, version: doc.version + 1, updatedAt: now },
    applied: patch.ops.length,
  };
}

/** 빈 문서. 새 영상을 시작할 때의 기본값. */
export function createEmptyDoc(id: string, title: string, now = Date.now()): VideoDoc {
  return {
    schemaVersion: VIDEO_SCHEMA_VERSION,
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
