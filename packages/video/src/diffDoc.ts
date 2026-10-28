/** §5.13 (V) 37-3 — 에이전트가 고친 문서에서 바뀐 것(순수). 숫자는 전부 문서에서 계산한다(에이전트가 말한 숫자 ❌). 문구는 번역 몫 — 종류와 값만(`DiffLine`). */

import type { VideoAsset, VideoChapter, VideoDoc, VideoItem } from './types.js';

export interface DiffChange {
  readonly id: string;
  /** 바뀐 칸 이름들(정렬). */
  readonly fields: readonly string[];
}

export interface DocDiff {
  readonly title?: { readonly before: string; readonly after: string };
  readonly size?: { readonly before: VideoDoc['size']; readonly after: VideoDoc['size'] };
  readonly fps?: { readonly before: number; readonly after: number };
  readonly style: boolean;
  readonly chapters: {
    readonly added: readonly string[];
    readonly removed: readonly string[];
    readonly changed: readonly DiffChange[];
    readonly reordered: boolean;
  };
  readonly items: {
    readonly added: readonly string[];
    readonly removed: readonly string[];
    readonly changed: readonly DiffChange[];
  };
  readonly assets: {
    readonly added: readonly string[];
    readonly removed: readonly string[];
    readonly changed: readonly string[];
  };
  /** 아무것도 안 바뀌었나(판본만 오른 경우). */
  readonly empty: boolean;
}

/** 값 비교 — 순서가 같은 JSON 이면 같다(문서는 우리가 직렬화하므로 키 순서가 안정적이다). */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function changedFields<T extends object>(before: T, after: T, skip: readonly string[] = []): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: string[] = [];
  for (const key of keys) {
    if (skip.includes(key)) continue;
    if (!same((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key])) out.push(key);
  }
  return out.sort();
}

function byId<T extends { readonly id: string }>(list: readonly T[]): Map<string, T> {
  return new Map(list.map((x) => [x.id, x]));
}

function allItems(doc: VideoDoc): VideoItem[] {
  return doc.tracks.flatMap((track) => track.items);
}

export function diffDoc(before: VideoDoc, after: VideoDoc): DocDiff {
  const bc = before.chapters ?? [];
  const ac = after.chapters ?? [];
  const bcMap = byId<VideoChapter>(bc);
  const acMap = byId<VideoChapter>(ac);
  const chaptersAdded = ac.filter((c) => !bcMap.has(c.id)).map((c) => c.id);
  const chaptersRemoved = bc.filter((c) => !acMap.has(c.id)).map((c) => c.id);
  const chaptersChanged: DiffChange[] = [];
  for (const c of ac) {
    const prev = bcMap.get(c.id);
    if (!prev) continue;
    const fields = changedFields(prev, c);
    if (fields.length > 0) chaptersChanged.push({ id: c.id, fields });
  }
  const keptBefore = bc.filter((c) => acMap.has(c.id)).map((c) => c.id);
  const keptAfter = ac.filter((c) => bcMap.has(c.id)).map((c) => c.id);
  const reordered = !same(keptBefore, keptAfter);

  const bi = byId(allItems(before));
  const ai = byId(allItems(after));
  const itemsAdded = [...ai.keys()].filter((id) => !bi.has(id));
  const itemsRemoved = [...bi.keys()].filter((id) => !ai.has(id));
  const itemsChanged: DiffChange[] = [];
  for (const [id, item] of ai) {
    const prev = bi.get(id);
    if (!prev) continue;
    const fields = changedFields(prev, item);
    // 트랙을 옮긴 것도 바뀐 것이다.
    const prevTrack = before.tracks.find((t) => t.items.some((x) => x.id === id))?.id;
    const nextTrack = after.tracks.find((t) => t.items.some((x) => x.id === id))?.id;
    if (prevTrack !== nextTrack) fields.push('track');
    if (fields.length > 0) itemsChanged.push({ id, fields: fields.sort() });
  }

  const ba: Readonly<Record<string, VideoAsset>> = before.assets;
  const aa: Readonly<Record<string, VideoAsset>> = after.assets;
  const assetsAdded = Object.keys(aa).filter((id) => !(id in ba));
  const assetsRemoved = Object.keys(ba).filter((id) => !(id in aa));
  // 소재의 실측값(길이·탐침)만 바뀐 것은 사람이 한 변화가 아니다 — 내용 지문이나 경로가 바뀐 것만 센다.
  const assetsChanged = Object.keys(aa).filter((id) => {
    const p = ba[id];
    const n = aa[id];
    return p !== undefined && n !== undefined && (!same(p.source, n.source) || (p.contentHash ?? '') !== (n.contentHash ?? ''));
  });

  const title = before.title !== after.title ? { before: before.title, after: after.title } : undefined;
  const size = !same(before.size, after.size) ? { before: before.size, after: after.size } : undefined;
  const fps = before.fps !== after.fps ? { before: before.fps, after: after.fps } : undefined;
  const style = !same(before.style, after.style);
  const empty = !title && !size && !fps && !style
    && chaptersAdded.length + chaptersRemoved.length + chaptersChanged.length === 0 && !reordered
    && itemsAdded.length + itemsRemoved.length + itemsChanged.length === 0
    && assetsAdded.length + assetsRemoved.length + assetsChanged.length === 0;

  return {
    ...(title ? { title } : {}),
    ...(size ? { size } : {}),
    ...(fps ? { fps } : {}),
    style,
    chapters: { added: chaptersAdded, removed: chaptersRemoved, changed: chaptersChanged, reordered },
    items: { added: itemsAdded, removed: itemsRemoved, changed: itemsChanged },
    assets: { added: assetsAdded, removed: assetsRemoved, changed: assetsChanged },
    empty,
  };
}

/** 화면이 번역해 그릴 한 줄. `target` 을 누르면 그 장면·아이템으로 간다. */
export type DiffLineKind =
  | 'title' | 'size' | 'fps' | 'style'
  | 'chapterAdded' | 'chapterRemoved' | 'chapterTitle' | 'chapterDuration' | 'chapterText' | 'chapterBrief'
  | 'chapterStatus' | 'chapterTransition' | 'chapterOther' | 'chapterOrder'
  | 'itemAdded' | 'itemRemoved' | 'itemText' | 'itemTiming' | 'itemLook' | 'itemOther' | 'itemsMany'
  | 'assetAdded' | 'assetRemoved' | 'assetChanged';

export interface DiffLine {
  readonly kind: DiffLineKind;
  /** 번역에 넣을 값(장면 번호는 1부터). */
  readonly values: Readonly<Record<string, string | number>>;
  readonly target?: { readonly chapterId?: string; readonly itemId?: string };
}

/** 한 카드에 줄을 몇 개까지 펼치나 — 넘치면 '그 밖에 n개' 로 접는다. */
export const DIFF_LINE_LIMIT = 8;

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function itemLabel(item: VideoItem | undefined, id: string): string {
  return item?.label ?? item?.sceneId ?? id;
}

/** 아이템 변화의 종류 — 글자(props 안 글자 값)·시각·보이는 모양·그 밖. */
function itemChangeKind(fields: readonly string[]): DiffLineKind {
  if (fields.includes('at') || fields.includes('duration') || fields.includes('trimStart')) return 'itemTiming';
  if (fields.includes('props') || fields.includes('cues')) return 'itemText';
  if (fields.includes('transform') || fields.includes('effects')) return 'itemLook';
  return 'itemOther';
}

/** 차이를 사람이 읽는 줄로 접는다. 장면 번호는 **새 문서**의 순서다. */
export function summarizeDiff(diff: DocDiff, before: VideoDoc, after: VideoDoc): DiffLine[] {
  const lines: DiffLine[] = [];
  const order = new Map((after.chapters ?? []).map((c, i) => [c.id, i + 1]));
  const oldOrder = new Map((before.chapters ?? []).map((c, i) => [c.id, i + 1]));
  const bChapters = byId(before.chapters ?? []);
  const aChapters = byId(after.chapters ?? []);
  if (diff.title) lines.push({ kind: 'title', values: { from: diff.title.before, to: diff.title.after } });
  if (diff.size) lines.push({ kind: 'size', values: { from: `${diff.size.before.width}×${diff.size.before.height}`, to: `${diff.size.after.width}×${diff.size.after.height}` } });
  if (diff.fps) lines.push({ kind: 'fps', values: { from: diff.fps.before, to: diff.fps.after } });
  if (diff.style) lines.push({ kind: 'style', values: {} });
  for (const id of diff.chapters.added) {
    lines.push({ kind: 'chapterAdded', values: { n: order.get(id) ?? 0, title: aChapters.get(id)?.title ?? id }, target: { chapterId: id } });
  }
  for (const id of diff.chapters.removed) {
    lines.push({ kind: 'chapterRemoved', values: { n: oldOrder.get(id) ?? 0, title: bChapters.get(id)?.title ?? id } });
  }
  for (const change of diff.chapters.changed) {
    const n = order.get(change.id) ?? 0;
    const prev = bChapters.get(change.id);
    const next = aChapters.get(change.id);
    const target = { chapterId: change.id };
    const title = next?.title ?? change.id;
    const rest = new Set(change.fields);
    if (rest.delete('title')) lines.push({ kind: 'chapterTitle', values: { n, title }, target });
    if (rest.delete('duration')) lines.push({ kind: 'chapterDuration', values: { n, title, from: round(prev?.duration ?? 0), to: round(next?.duration ?? 0) }, target });
    if (rest.delete('text')) lines.push({ kind: 'chapterText', values: { n, title }, target });
    if (rest.delete('brief')) lines.push({ kind: 'chapterBrief', values: { n, title }, target });
    if (rest.delete('status')) lines.push({ kind: 'chapterStatus', values: { n, title, status: next?.status ?? '' }, target });
    if (rest.delete('transition')) lines.push({ kind: 'chapterTransition', values: { n, title, transition: next?.transition?.kind ?? 'cut' }, target });
    if (rest.size > 0) lines.push({ kind: 'chapterOther', values: { n, title }, target });
  }
  if (diff.chapters.reordered) lines.push({ kind: 'chapterOrder', values: {} });

  const bItems = byId(allItems(before));
  const aItems = byId(allItems(after));
  const itemLines: DiffLine[] = [];
  for (const id of diff.items.added) itemLines.push({ kind: 'itemAdded', values: { label: itemLabel(aItems.get(id), id) }, target: { itemId: id } });
  for (const id of diff.items.removed) itemLines.push({ kind: 'itemRemoved', values: { label: itemLabel(bItems.get(id), id) } });
  for (const change of diff.items.changed) {
    itemLines.push({ kind: itemChangeKind(change.fields), values: { label: itemLabel(aItems.get(change.id), change.id) }, target: { itemId: change.id } });
  }
  const first = itemLines[0];
  if (itemLines.length > 4) lines.push({ kind: 'itemsMany', values: { count: itemLines.length }, ...(first?.target ? { target: first.target } : {}) });
  else lines.push(...itemLines);

  if (diff.assets.added.length > 0) lines.push({ kind: 'assetAdded', values: { count: diff.assets.added.length } });
  if (diff.assets.removed.length > 0) lines.push({ kind: 'assetRemoved', values: { count: diff.assets.removed.length } });
  if (diff.assets.changed.length > 0) lines.push({ kind: 'assetChanged', values: { count: diff.assets.changed.length } });
  return lines;
}

/** 화면에서 한 번 빛낼 것 — 바뀌거나 새로 생긴 장면·아이템 id. 소재(코드)가 바뀐 아이템도 넣는다. */
export function diffTargets(diff: DocDiff, after: VideoDoc): { readonly chapters: ReadonlySet<string>; readonly items: ReadonlySet<string> } {
  const chapters = new Set<string>([...diff.chapters.added, ...diff.chapters.changed.map((c) => c.id)]);
  const items = new Set<string>([...diff.items.added, ...diff.items.changed.map((c) => c.id)]);
  if (diff.assets.changed.length > 0) {
    const changedAssets = new Set(diff.assets.changed);
    for (const item of allItems(after)) if (item.assetId && changedAssets.has(item.assetId)) items.add(item.id);
  }
  // 아이템이 바뀐 장면도 빛난다(구슬 줄에서 보이게).
  const chapterOf = new Map<string, string>();
  for (const item of allItems(after)) {
    const at = item.at;
    const chapterId = item.chapterId ?? (typeof at !== 'number' && 'chapter' in at ? at.chapter : undefined);
    if (chapterId) chapterOf.set(item.id, chapterId);
  }
  for (const id of items) {
    const c = chapterOf.get(id);
    if (c) chapters.add(c);
  }
  return { chapters, items };
}
