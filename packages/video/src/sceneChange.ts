/**
 * §5.13 (V) 37-23 — 바퀴가 바꾼 것을 **장면 단위**로 가르고(받기·되돌리기의 단위), 장면 하나만 시작 판으로 돌리는 연산을 만든다(순수).
 * 차이 계산은 `diffDoc` 하나다 — 여기서는 그 결과를 장면별로 나눌 뿐이다(두 벌이면 카드와 판 비교가 다른 변화를 말한다).
 */

import { anchorItemRef, chapterIdOf } from './chapters.js';
import { diffDoc, summarizeDiff, type DiffChange, type DiffLine, type DocDiff } from './diffDoc.js';
import { stableHash, stableStringify } from './hashItem.js';
import type { PassRecord, SceneDecision } from './history.js';
import { resolveTimeline } from './resolveTimeline.js';
import type { VideoChapter, VideoDoc, VideoDocOp, VideoItem } from './types.js';

export type SceneChangeState = 'added' | 'removed' | 'changed';

export interface SceneChange {
  readonly chapterId: string;
  /** 사람이 보는 번호(1부터) — 새 문서의 순서, 지워진 장면은 옛 순서. */
  readonly n: number;
  readonly title: string;
  readonly state: SceneChangeState;
  readonly lines: readonly DiffLine[];
  /** 이 장면이 쓰는 컴포지션 소재 중 코드가 바뀌었거나 새로 생긴 것 — 되돌릴 때 파일이 걸린다. */
  readonly codeAssets: readonly string[];
}

export interface SceneChangeSet {
  readonly scenes: readonly SceneChange[];
  /** 장면에 묶이지 않는 변화(제목·판형·스타일·순서·장면 없는 아이템·주인 없는 소재) — 장면 단위 손잡이가 없다. */
  readonly rest: readonly DiffLine[];
}

interface Located {
  readonly item: VideoItem;
  readonly trackId: string;
}

function located(doc: VideoDoc): Located[] {
  return doc.tracks.flatMap((track) => track.items.map((item): Located => ({ item, trackId: track.id })));
}

function itemMap(doc: VideoDoc): Map<string, VideoItem> {
  return new Map(located(doc).map((x) => [x.item.id, x.item]));
}

/** 소재 id → 그 소재를 쓰는 장면들(아이템의 소재 · 장면 정지 화면). */
function assetScenes(doc: VideoDoc): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (assetId: string | undefined, chapterId: string | undefined): void => {
    if (!assetId || !chapterId) return;
    const set = out.get(assetId) ?? new Set<string>();
    set.add(chapterId);
    out.set(assetId, set);
  };
  for (const { item } of located(doc)) add(item.assetId, chapterIdOf(item));
  for (const chapter of doc.chapters ?? []) add(chapter.frame?.assetId, chapter.id);
  return out;
}

interface Bucket {
  readonly itemsAdded: string[];
  readonly itemsRemoved: string[];
  readonly itemsChanged: DiffChange[];
  readonly assetsAdded: Set<string>;
  readonly assetsRemoved: Set<string>;
  readonly assetsChanged: Set<string>;
}

function emptyBucket(): Bucket {
  return { itemsAdded: [], itemsRemoved: [], itemsChanged: [], assetsAdded: new Set(), assetsRemoved: new Set(), assetsChanged: new Set() };
}

/** 한 장면 몫만 남긴 차이(줄 글은 `summarizeDiff` 가 그대로 짓는다). */
function bucketDiff(diff: DocDiff, chapterId: string | null, b: Bucket): DocDiff {
  const only = (ids: readonly string[]): string[] => (chapterId === null ? [] : ids.filter((id) => id === chapterId));
  return {
    style: false,
    chapters: {
      added: only(diff.chapters.added),
      removed: only(diff.chapters.removed),
      changed: chapterId === null ? [] : diff.chapters.changed.filter((c) => c.id === chapterId),
      reordered: false,
    },
    items: { added: b.itemsAdded, removed: b.itemsRemoved, changed: b.itemsChanged },
    assets: { added: [...b.assetsAdded], removed: [...b.assetsRemoved], changed: [...b.assetsChanged] },
    empty: false,
  };
}

/** `diffDoc` 의 결과를 장면별로 가른다. 장면 층이 없는 문서면 전부 `rest` 다. */
export function sceneChanges(before: VideoDoc, after: VideoDoc, diff: DocDiff = diffDoc(before, after)): SceneChangeSet {
  if (diff.empty) return { scenes: [], rest: [] };
  const bChapters = before.chapters ?? [];
  const aChapters = after.chapters ?? [];
  const bIndex = new Map(bChapters.map((c, i) => [c.id, i]));
  const aIndex = new Map(aChapters.map((c, i) => [c.id, i]));
  const known = (id: string | undefined): id is string => id !== undefined && (aIndex.has(id) || bIndex.has(id));
  const bItems = itemMap(before);
  const aItems = itemMap(after);
  const buckets = new Map<string, Bucket>();
  const bucket = (id: string): Bucket => {
    const hit = buckets.get(id);
    if (hit) return hit;
    const made = emptyBucket();
    buckets.set(id, made);
    return made;
  };
  const rest = emptyBucket();
  const sceneOf = (item: VideoItem | undefined): string | undefined => {
    const id = item ? chapterIdOf(item) : undefined;
    return known(id) ? id : undefined;
  };

  for (const id of diff.items.added) (sceneOf(aItems.get(id)) ? bucket(sceneOf(aItems.get(id)) as string) : rest).itemsAdded.push(id);
  for (const id of diff.items.removed) (sceneOf(bItems.get(id)) ? bucket(sceneOf(bItems.get(id)) as string) : rest).itemsRemoved.push(id);
  for (const change of diff.items.changed) {
    // 장면을 옮긴 아이템은 두 장면 모두의 변화다(한쪽은 잃고 한쪽은 얻었다).
    const scenes = new Set([sceneOf(aItems.get(change.id)), sceneOf(bItems.get(change.id))].filter((x): x is string => x !== undefined));
    if (scenes.size === 0) rest.itemsChanged.push(change);
    for (const scene of scenes) bucket(scene).itemsChanged.push(change);
  }

  const usersAfter = assetScenes(after);
  const usersBefore = assetScenes(before);
  const spread = (ids: readonly string[], users: (id: string) => Iterable<string>, pick: (b: Bucket) => Set<string>): void => {
    for (const id of ids) {
      const scenes = [...users(id)].filter(known);
      if (scenes.length === 0) pick(rest).add(id);
      for (const scene of scenes) pick(bucket(scene)).add(id);
    }
  };
  spread(diff.assets.added, (id) => usersAfter.get(id) ?? [], (b) => b.assetsAdded);
  spread(diff.assets.removed, (id) => usersBefore.get(id) ?? [], (b) => b.assetsRemoved);
  spread(diff.assets.changed, (id) => new Set([...(usersAfter.get(id) ?? []), ...(usersBefore.get(id) ?? [])]), (b) => b.assetsChanged);

  const ids = new Set<string>([...diff.chapters.added, ...diff.chapters.removed, ...diff.chapters.changed.map((c) => c.id), ...buckets.keys()]);
  const scenes: SceneChange[] = [];
  for (const chapterId of ids) {
    const now = aChapters[aIndex.get(chapterId) ?? -1];
    const was = bChapters[bIndex.get(chapterId) ?? -1];
    const chapter: VideoChapter | undefined = now ?? was;
    if (!chapter) continue;
    const b = buckets.get(chapterId) ?? emptyBucket();
    const lines = summarizeDiff(bucketDiff(diff, chapterId, b), before, after);
    if (lines.length === 0) continue;
    const codeAssets = [...b.assetsChanged, ...b.assetsAdded].filter((id) => (after.assets[id] ?? before.assets[id])?.kind === 'composition');
    scenes.push({
      chapterId,
      n: (now ? aIndex.get(chapterId) ?? 0 : bIndex.get(chapterId) ?? 0) + 1,
      title: chapter.title,
      state: now && was ? 'changed' : now ? 'added' : 'removed',
      lines,
      codeAssets,
    });
  }
  // 새 문서의 순서대로, 지워진 장면은 그 뒤에 옛 순서로.
  scenes.sort((x, y) => Number(x.state === 'removed') - Number(y.state === 'removed') || x.n - y.n);

  const restDiff: DocDiff = {
    ...(diff.title ? { title: diff.title } : {}),
    ...(diff.size ? { size: diff.size } : {}),
    ...(diff.fps ? { fps: diff.fps } : {}),
    style: diff.style,
    chapters: { added: [], removed: [], changed: [], reordered: diff.chapters.reordered },
    items: { added: rest.itemsAdded, removed: rest.itemsRemoved, changed: rest.itemsChanged },
    assets: { added: [...rest.assetsAdded], removed: [...rest.assetsRemoved], changed: [...rest.assetsChanged] },
    empty: false,
  };
  return { scenes, rest: summarizeDiff(restDiff, before, after) };
}

/** 그 장면이 쓰는 소재 id(아이템의 소재 · 장면 정지 화면). */
function sceneAssetIds(doc: VideoDoc, chapterId: string): string[] {
  const ids = new Set<string>();
  for (const { item } of located(doc)) if (item.assetId && chapterIdOf(item) === chapterId) ids.add(item.assetId);
  const frame = (doc.chapters ?? []).find((c) => c.id === chapterId)?.frame?.assetId;
  if (frame) ids.add(frame);
  return [...ids].sort();
}

/**
 * 장면의 **내용 지문** — 장면 자신 · 묶인 아이템(트랙 포함) · 쓰는 소재의 경로와 내용 지문. 받은 결정(`decided`)이 아직 유효한지는
 * 이 값으로 본다: 받은 뒤 AI 가 그 장면을 또 고치면 달라진다. 문서에 없는 장면도 값이 있다(지워진 장면을 받을 수 있게).
 */
export function sceneSignature(doc: VideoDoc, chapterId: string): string {
  const chapter = (doc.chapters ?? []).find((c) => c.id === chapterId) ?? null;
  const items = located(doc)
    .filter((x) => chapterIdOf(x.item) === chapterId)
    .sort((a, b) => (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0))
    .map((x) => [x.trackId, x.item]);
  const assets = sceneAssetIds(doc, chapterId).map((id) => {
    const asset = doc.assets[id];
    return asset ? [id, asset.source, asset.contentHash ?? ''] : [id, null];
  });
  return stableHash(stableStringify([chapter, items, assets]));
}

/** 그 장면에 내린 결정이 아직 유효한가 — 지문이 지금 문서와 같을 때만. */
export function sceneDecisionOf(pass: PassRecord | null | undefined, doc: VideoDoc, chapterId: string): SceneDecision | null {
  const decision = pass?.decided?.[chapterId];
  return decision && decision.signature === sceneSignature(doc, chapterId) ? decision : null;
}

/** 그 바퀴가 이 장면을 만졌다고 적혀 있나 — 이 장면만 맡긴 요청이거나 patch 의 `focus` 로 들어온 장면. */
export function passTouchesScene(pass: PassRecord, chapterId: string): boolean {
  return pass.chapterId === chapterId || pass.focus === chapterId || (pass.focuses?.includes(chapterId) ?? false);
}

/** 그 장면이 쓰는 컴포지션 HTML 경로(프로젝트 기준)와 그 밖의 것(다른 장면·장면 없는 아이템·다른 장면의 정지 화면)이 쓰는 경로. */
export function sceneCompositionPaths(doc: VideoDoc, chapterId: string): { readonly mine: readonly string[]; readonly others: readonly string[] } {
  const mine = new Set<string>();
  const others = new Set<string>();
  const add = (assetId: string | undefined, own: boolean): void => {
    const asset = assetId ? doc.assets[assetId] : undefined;
    if (!asset || asset.kind !== 'composition' || asset.source.kind !== 'file') return;
    (own ? mine : others).add(asset.source.path);
  };
  for (const { item } of located(doc)) add(item.assetId, chapterIdOf(item) === chapterId);
  for (const chapter of doc.chapters ?? []) add(chapter.frame?.assetId, chapter.id === chapterId);
  return { mine: [...mine], others: [...others] };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * 장면 `chapterId` 만 `start`(그 바퀴의 맡기기 직전 판)의 것으로 돌리는 편집 연산. 다른 장면·장면 순서·문서 칸은 지금 그대로다.
 * 평소 편집과 같은 연산이라 판본·낙관적 잠금·진단을 그대로 지난다. 그 장면이 두 판에서 같으면 빈 목록.
 */
export function sceneRestoreOps(current: VideoDoc, start: VideoDoc, chapterId: string): VideoDocOp[] {
  const curChapters = current.chapters ?? [];
  const startChapters = start.chapters ?? [];
  const was = startChapters.find((c) => c.id === chapterId);
  const now = curChapters.find((c) => c.id === chapterId);
  if (!was && !now) return [];
  if (was && now && sceneSignature(current, chapterId) === sceneSignature(start, chapterId)) return [];

  const curItems = located(current);
  const startItems = located(start);
  const curById = new Map(curItems.map((x) => [x.item.id, x]));
  const curChapterIds = new Set(curChapters.map((c) => c.id));
  const startMine = startItems.filter((x) => chapterIdOf(x.item) === chapterId);
  const startMineIds = new Set(startMine.map((x) => x.item.id));
  // 지금 이 장면에 있는 것 + 시작 판에서 이 장면 것이었는데 다른 데로 옮겨진 것.
  const doomed = new Set(curItems.filter((x) => chapterIdOf(x.item) === chapterId || startMineIds.has(x.item.id)).map((x) => x.item.id));
  // 다른 장면에서 이 장면으로 옮겨져 온 아이템은 지우지 않고 제자리(시작 판의 모양)로 돌린다 — 그 장면이 아직 있을 때만.
  const movedIn = startItems.filter((x) => {
    if (startMineIds.has(x.item.id) || !doomed.has(x.item.id)) return false;
    const home = chapterIdOf(x.item);
    return home === undefined || curChapterIds.has(home);
  });
  const toRestore = new Set([...startMine, ...movedIn].map((x) => x.item.id));
  const gone = new Set([...doomed].filter((id) => !toRestore.has(id)));
  const removingChapter = !was && !!now;

  const ops: VideoDocOp[] = [];

  // ① 남는 아이템이 사라질 아이템(또는 사라질 장면)을 앵커로 삼으면 절대 시각으로 푼다 — 뒤가 무너지지 않게.
  if (gone.size > 0 || removingChapter) {
    const timeline = resolveTimeline(current);
    for (const { item } of curItems) {
      if (doomed.has(item.id)) continue;
      const ref = anchorItemRef(item.at);
      const onChapter = typeof item.at !== 'number' && 'chapter' in item.at && item.at.chapter === chapterId;
      if (!(ref && gone.has(ref)) && !(removingChapter && onChapter)) continue;
      const at = timeline.items.find((it) => it.id === item.id)?.start;
      if (at !== undefined) ops.push({ op: 'updateItem', itemId: item.id, patch: { at: round3(at) } });
    }
  }

  // ② 소재 기록 — 이 장면만 쓰는 것만 시작 판의 것으로(다른 장면도 쓰면 건드리지 않는다. 없으면 다시 넣는다).
  const usedElsewhere = new Set<string>();
  for (const { item } of curItems) if (item.assetId && !doomed.has(item.id)) usedElsewhere.add(item.assetId);
  for (const chapter of curChapters) {
    if (chapter.id === chapterId) continue;
    if (chapter.frame?.assetId) usedElsewhere.add(chapter.frame.assetId);
    for (const id of chapter.media ?? []) usedElsewhere.add(id);
  }
  const needed = new Set<string>();
  for (const x of [...startMine, ...movedIn]) if (x.item.assetId) needed.add(x.item.assetId);
  if (was?.frame?.assetId) needed.add(was.frame.assetId);
  for (const id of was?.media ?? []) needed.add(id);
  for (const id of needed) {
    const asset = start.assets[id];
    if (!asset) continue;
    const cur = current.assets[id];
    if (!cur || (!usedElsewhere.has(id) && stableStringify(cur) !== stableStringify(asset))) ops.push({ op: 'setAsset', asset });
  }

  // ③ 장면 — 그 장면만 바꾼 목록을 통째로 적는다(`updateChapter` 는 칸을 지우지 못한다).
  let chapters: VideoChapter[];
  if (was && now) chapters = curChapters.map((c) => (c.id === chapterId ? was : c));
  else if (!was) chapters = curChapters.filter((c) => c.id !== chapterId);
  else {
    // 지워진 장면 — 시작 판에서 뒤에 있던 장면 중 지금도 있는 첫 장면 앞에 다시 세운다.
    const after = startChapters.slice(startChapters.findIndex((c) => c.id === chapterId) + 1).find((c) => curChapterIds.has(c.id));
    const at = after ? curChapters.findIndex((c) => c.id === after.id) : -1;
    chapters = curChapters.slice();
    if (at < 0) chapters.push(was);
    else chapters.splice(at, 0, was);
  }
  if (stableStringify(chapters) !== stableStringify(curChapters)) ops.push({ op: 'setChapters', chapters });

  // ④ 아이템 — 지우고 같은 id·같은 트랙·옛 이웃 앞에 다시 넣는다(`updateItem` 은 칸을 지우지 못한다).
  for (const id of doomed) ops.push({ op: 'removeItem', itemId: id });
  const curTrackIds = new Set(current.tracks.map((t) => t.id));
  start.tracks.forEach((track, index) => {
    if (!track.items.some((item) => toRestore.has(item.id))) return;
    if (!curTrackIds.has(track.id)) {
      const before = start.tracks.slice(index + 1).find((t) => curTrackIds.has(t.id));
      const { items: _items, ...shell } = track;
      ops.push({ op: 'addTrack', track: { ...shell, items: [] }, ...(before ? { beforeTrackId: before.id } : {}) });
      curTrackIds.add(track.id);
    }
    track.items.forEach((item, at) => {
      if (!toRestore.has(item.id)) return;
      const neighbor = track.items.slice(at + 1).find((next) => !doomed.has(next.id) && curById.get(next.id)?.trackId === track.id);
      ops.push({ op: 'addItem', trackId: track.id, item, ...(neighbor ? { beforeItemId: neighbor.id } : {}) });
    });
  });

  // ⑤ 바퀴가 이 장면을 위해 더한 소재 기록은 걷는다(시작 판에 없고 이제 아무도 쓰지 않는 것). 파일은 지우지 않는다.
  const dropCandidates = new Set<string>();
  for (const id of doomed) { const assetId = curById.get(id)?.item.assetId; if (assetId) dropCandidates.add(assetId); }
  if (now?.frame?.assetId) dropCandidates.add(now.frame.assetId);
  for (const id of dropCandidates) {
    if (id in start.assets || !(id in current.assets) || usedElsewhere.has(id) || needed.has(id)) continue;
    ops.push({ op: 'removeAsset', assetId: id });
  }
  return ops;
}
