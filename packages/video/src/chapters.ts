/**
 * §5.13 (V) 37-4 — 장면 층(순수). 배열 순서가 곧 시간 순서 — 앞 장면 끝에서 들어오는 전환 길이만큼 겹치고 `offset` 만큼 밀린다(`at` 숫자면 절대 시각).
 * 그래서 순서 바꾸기는 배열 이동 하나다. 던지지 않는다 — 길이가 숫자가 아닌 장면은 0초로 서고 진단이 남는다.
 */

import type {
  ChapterVariant,
  ResolveDiagnostic,
  ResolvedChapter,
  ResolvedTimeline,
  TimeAnchor,
  VideoChapter,
  VideoDoc,
  VideoDocOp,
  VideoItem,
} from './types.js';

/** 겹침이 장면 길이의 이 비율을 넘지 않게 묶는다 — 전환이 장면 전체를 삼키지 않게. */
const MAX_OVERLAP_RATIO = 0.9;

function finiteOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** 들어오는 전환이 실제로 겹치는 길이. `cut`·없음은 0. */
export function transitionOverlap(prev: { duration: number } | undefined, chapter: VideoChapter, duration: number): number {
  const tr = chapter.transition;
  if (!prev || !tr || tr.kind === 'cut') return 0;
  const want = Math.max(0, finiteOr(tr.duration, 0));
  return Math.min(want, prev.duration * MAX_OVERLAP_RATIO, duration * MAX_OVERLAP_RATIO);
}

/** 장면들을 시각으로 푼다. 문서 순서 그대로 돌려준다. */
export function resolveChapters(doc: VideoDoc, push: (d: ResolveDiagnostic) => void): ResolvedChapter[] {
  const out: ResolvedChapter[] = [];
  const chapters = doc.chapters ?? [];
  let prev: ResolvedChapter | undefined;
  chapters.forEach((chapter, index) => {
    let duration = finiteOr(chapter.duration, Number.NaN);
    if (!Number.isFinite(duration) || duration < 0) {
      push({
        level: 'error',
        code: 'chapter-bad-duration',
        message: `장면 '${chapter.id}' 의 길이 ${String(chapter.duration)} 는 유효하지 않아 0초로 둡니다.`,
      });
      duration = 0;
    }
    // §5.13 (W) 38-7 — 정지 화면은 그 문서의 컴포지션 소재여야 그려진다(문서는 그대로 — 카드에 그림이 안 설 뿐).
    if (chapter.frame !== undefined) {
      const asset = doc.assets[chapter.frame.assetId];
      if (!asset || asset.kind !== 'composition') {
        push({
          level: 'warn',
          code: 'chapter-frame-asset',
          message: `장면 '${chapter.id}' 의 정지 화면 소재 '${chapter.frame.assetId}' 가 ${asset ? '컴포지션이 아닙니다' : '없습니다'}.`,
        });
      }
    }
    const overlapIn = transitionOverlap(prev, chapter, duration);
    const base = typeof chapter.at === 'number' && Number.isFinite(chapter.at)
      ? chapter.at
      : (prev ? prev.end - overlapIn : 0);
    const start = Math.max(0, base + finiteOr(chapter.offset, 0));
    const resolved: ResolvedChapter = { id: chapter.id, index, start, end: start + duration, duration, overlapIn, chapter };
    out.push(resolved);
    prev = resolved;
  });
  return out;
}

/** §5.13 (W) 38-7 — 정지 화면 문서의 아이템 id(무대·내주기가 이 이름으로 그 컴포지션을 연다). */
export const CHAPTER_FRAME_ITEM_ID = '__chapter-frame';

/**
 * §5.13 (W) 38-7 — 장면 `chapterId` 의 **정지 화면만 그리는 문서**(순수). 같은 크기·스타일·소재에 그 컴포지션 아이템 하나 —
 * 장면·다른 트랙은 없다. 일꾼(스틸)과 렌더 화면이 같은 함수로 무대를 세운다. 정지 화면이 없거나 컴포지션이 아니면 null.
 */
export function chapterFrameDoc(doc: VideoDoc, chapterId: string): VideoDoc | null {
  const chapter = (doc.chapters ?? []).find((c) => c.id === chapterId);
  const frame = chapter?.frame;
  if (!chapter || !frame) return null;
  const asset = doc.assets[frame.assetId];
  if (!asset || asset.kind !== 'composition') return null;
  const length = Math.max(
    1 / Math.max(1, doc.fps),
    finiteOr(asset.duration, 0),
    finiteOr(frame.t, 0) + 1 / Math.max(1, doc.fps),
    finiteOr(chapter.duration, 0),
  );
  const item: VideoItem = { id: CHAPTER_FRAME_ITEM_ID, kind: 'composition', at: 0, duration: length, assetId: asset.id, label: chapter.title };
  const { chapters: _chapters, ...rest } = doc;
  return { ...rest, tracks: [{ id: 'frame', kind: 'visual', items: [item] }] };
}

/** §5.13 (W) 38-7 — 정지 화면을 보여 줄 시각(초) — 적힌 `t`, 없으면 0. */
export function chapterFrameTime(doc: VideoDoc, chapterId: string): number {
  const frame = (doc.chapters ?? []).find((c) => c.id === chapterId)?.frame;
  return Math.max(0, finiteOr(frame?.t, 0));
}

/** 이 장면에서 지금 보이는 갈래 — 고른 것, 없으면 첫 갈래. 갈래가 없으면 undefined. */
export function effectivePick(chapter: VideoChapter | undefined): string | undefined {
  if (!chapter?.variants || chapter.variants.length === 0) return undefined;
  if (chapter.pick && chapter.variants.some((v: ChapterVariant) => v.id === chapter.pick)) return chapter.pick;
  return chapter.variants[0]?.id;
}

/** 장면 id → 장면. */
export function chapterMap(doc: VideoDoc): Map<string, VideoChapter> {
  return new Map((doc.chapters ?? []).map((c) => [c.id, c]));
}

/** 이 아이템이 속한 장면 id — `chapterId` 가 먼저, 없으면 `{chapter}` 앵커. */
export function chapterIdOf(item: VideoItem): string | undefined {
  if (item.chapterId) return item.chapterId;
  const at = item.at;
  return typeof at !== 'number' && 'chapter' in at ? at.chapter : undefined;
}

/** 고르지 않은 갈래의 아이템인가 — 그렇다면 그리지도 소리 내지도 않는다(문서에는 남는다). */
export function isUnpickedVariant(chapters: Map<string, VideoChapter>, item: VideoItem): boolean {
  if (!item.variantId) return false;
  const chapterId = chapterIdOf(item);
  const chapter = chapterId ? chapters.get(chapterId) : undefined;
  const pick = effectivePick(chapter);
  return pick !== undefined && pick !== item.variantId;
}

/** 앵커가 가리키는 **아이템** id(`after`·`start`·`cue` 의 item). 장면 앵커·절대 시각이면 없다. */
export function anchorItemRef(at: TimeAnchor): string | undefined {
  if (typeof at === 'number') return undefined;
  if ('after' in at) return at.after;
  if ('start' in at) return at.start;
  if ('cue' in at) return at.item;
  return undefined;
}

/** 앵커의 offset(절대 시각이면 0). */
export function anchorOffset(at: TimeAnchor): number {
  return typeof at === 'number' ? 0 : finiteOr(at.offset, 0);
}

/** 앵커에 offset 을 더한 새 앵커. */
export function offsetAnchor(at: TimeAnchor, delta: number): TimeAnchor {
  return typeof at === 'number' ? at + delta : { ...at, offset: anchorOffset(at) + delta };
}

/**
 * 장면 하나를 지우는 연산 — 그 장면의 아이템도 함께 지운다(사람이 [장면 지우기]를 누른 뜻). 다른 장면의 아이템이 그
 * 아이템들을 앵커로 삼고 있으면 지우기 전에 절대 시각으로 풀어 둔다(뒤가 무너지지 않게).
 */
export function buildRemoveChapterOps(doc: VideoDoc, chapterId: string, resolvedStart: (itemId: string) => number | undefined): VideoDocOp[] {
  const items = doc.tracks.flatMap((t) => t.items);
  const doomed = new Set(items.filter((i) => chapterIdOf(i) === chapterId).map((i) => i.id));
  const ops: VideoDocOp[] = [];
  for (const item of items) {
    if (doomed.has(item.id)) continue;
    const ref = anchorItemRef(item.at);
    if (ref && doomed.has(ref)) {
      const start = resolvedStart(item.id);
      if (start !== undefined) ops.push({ op: 'updateItem', itemId: item.id, patch: { at: start } });
    }
  }
  for (const id of doomed) ops.push({ op: 'removeItem', itemId: id });
  ops.push({ op: 'removeChapter', chapterId });
  return ops;
}

/** 새 장면 id — 문서 안에서 겹치지 않게. */
export function nextChapterId(doc: VideoDoc, prefix = 'ch'): string {
  const ids = new Set((doc.chapters ?? []).map((c) => c.id));
  let n = (doc.chapters ?? []).length + 1;
  while (ids.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

/** 소수 셋째 자리까지(문서에 적는 시각이 부동소수 꼬리를 달지 않게). */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * §5.13 (V) 37-4 — [장면으로 나누기]: 첫 화면 트랙의 컷 경계로 장면을 짓는 편집 연산(되돌릴 수 있다). 장면은 빈틈 없이 선다.
 * 그림은 한 프레임도 움직이지 않는다 — 절대 시각 아이템은 `{ chapter, offset }` 로 같은 시각을 다시 적고, 따라가는 아이템(`after`·`start`·`cue`)은 소속만 적는다.
 * 컷이 하나 이하면 아무것도 하지 않는다.
 */
export function deriveChapterOps(
  doc: VideoDoc,
  timeline: ResolvedTimeline,
  titleFor: (index: number, label: string | undefined) => string,
): VideoDocOp[] {
  if ((doc.chapters?.length ?? 0) > 0) return [];
  const visual = doc.tracks.find((track) => track.kind === 'visual' && timeline.items.some((it) => it.trackId === track.id));
  if (!visual) return [];
  const cuts = timeline.items
    .filter((it) => it.trackId === visual.id && it.item.enabled !== false)
    .sort((a, b) => a.start - b.start);
  // 같은 시각에 시작하는 컷은 한 경계다.
  const starts: { t: number; label: string | undefined }[] = [];
  for (const cut of cuts) {
    const last = starts[starts.length - 1];
    if (last && Math.abs(last.t - cut.start) < 1e-6) continue;
    starts.push({ t: cut.start, label: cut.item.label });
  }
  if (starts.length < 2) return [];
  const first = starts[0];
  if (first) first.t = 0;
  const end = Math.max(timeline.duration, starts[starts.length - 1]?.t ?? 0);
  const chapters: VideoChapter[] = starts.map((s, i) => {
    const next = starts[i + 1]?.t ?? end;
    return { id: `ch-${i + 1}`, title: titleFor(i, s.label), duration: round3(Math.max(0, next - s.t)), status: 'done' };
  });
  const chapterAt = (t: number): number => {
    let at = 0;
    for (let i = 0; i < starts.length; i += 1) if ((starts[i]?.t ?? 0) <= t + 1e-6) at = i;
    return at;
  };
  const ops: VideoDocOp[] = [{ op: 'setChapters', chapters }];
  for (const resolved of timeline.items) {
    const index = chapterAt(resolved.start);
    const chapter = chapters[index];
    const chapterStart = starts[index]?.t ?? 0;
    if (!chapter) continue;
    const patch: Partial<Omit<VideoItem, 'id'>> = typeof resolved.item.at === 'number'
      ? { chapterId: chapter.id, at: { chapter: chapter.id, offset: round3(resolved.start - chapterStart) } }
      : { chapterId: chapter.id };
    ops.push({ op: 'updateItem', itemId: resolved.id, patch });
  }
  return ops;
}

/**
 * §5.13 (V) 37-8 — 장면 **나누기**: 재생 머리 `t` 에서 그 장면을 둘로 가른다. 뒤쪽은 새 장면이 되고, 그 장면에 묶인 아이템 중
 * `t` 뒤에서 시작하는 것은 새 장면으로 옮긴다(시각은 그대로 — `{chapter}` 앵커면 새 장면 기준 offset 으로 다시 적는다).
 * 장면 안쪽이 아니면(경계·밖) 아무것도 하지 않는다.
 */
export function buildSplitChapterOps(doc: VideoDoc, timeline: ResolvedTimeline, chapterId: string, t: number, newTitle: string): VideoDocOp[] {
  const resolved = timeline.chapters.find((c) => c.id === chapterId);
  if (!resolved || t <= resolved.start + 1e-3 || t >= resolved.end - 1e-3) return [];
  const id = nextChapterId(doc);
  const headDuration = round3(t - resolved.start);
  const after = doc.chapters?.[resolved.index + 1];
  const ops: VideoDocOp[] = [
    { op: 'updateChapter', chapterId, patch: { duration: headDuration } },
    {
      op: 'addChapter',
      chapter: { id, title: newTitle, duration: round3(resolved.end - t), status: resolved.chapter.status === 'plan' ? 'plan' : 'done' },
      ...(after ? { beforeChapterId: after.id } : {}),
    },
  ];
  // 뒤 장면이 쓰던 들어오는 전환은 그대로 남는다(뒤 장면의 것이다). 새 장면은 자르기로 들어온다.
  for (const item of timeline.items) {
    if (chapterIdOf(item.item) !== chapterId || item.start < t - 1e-6) continue;
    const at = item.item.at;
    const patch: Partial<Omit<VideoItem, 'id'>> = typeof at !== 'number' && 'chapter' in at
      ? { chapterId: id, at: { chapter: id, offset: round3(item.start - t) } }
      : { chapterId: id };
    ops.push({ op: 'updateItem', itemId: item.id, patch });
  }
  return ops;
}

/**
 * §5.13 (V) 37-8 — **다음 장면과 합치기**: 다음 장면의 길이를 이 장면에 더하고, 다음 장면의 아이템을 이 장면으로 옮긴다(시각은
 * 그대로). 다음 장면이 없으면 아무것도 하지 않는다.
 */
export function buildMergeChapterOps(_doc: VideoDoc, timeline: ResolvedTimeline, chapterId: string): VideoDocOp[] {
  const resolved = timeline.chapters.find((c) => c.id === chapterId);
  const next = resolved ? timeline.chapters[resolved.index + 1] : undefined;
  if (!resolved || !next) return [];
  const ops: VideoDocOp[] = [{ op: 'updateChapter', chapterId, patch: { duration: round3(next.end - resolved.start) } }];
  for (const item of timeline.items) {
    if (chapterIdOf(item.item) !== next.id) continue;
    const at = item.item.at;
    const patch: Partial<Omit<VideoItem, 'id'>> = typeof at !== 'number' && 'chapter' in at
      ? { chapterId, at: { chapter: chapterId, offset: round3(item.start - resolved.start) } }
      : { chapterId };
    ops.push({ op: 'updateItem', itemId: item.id, patch });
  }
  ops.push({ op: 'removeChapter', chapterId: next.id });
  return ops;
}

/**
 * §5.13 (V) 37-4 — 이 장면의 **내용 지문**(장면 자신 + 묶인 아이템 + 그 아이템의 소재). 기획 카드·구슬의 대표 프레임은 이
 * 지문마다 한 번만 굽는다(바뀌지 않은 장면은 다시 찍지 않는다).
 */
export function chapterFingerprint(doc: VideoDoc, timeline: ResolvedTimeline, chapterId: string): string {
  const resolved = timeline.chapters.find((c) => c.id === chapterId);
  const parts: unknown[] = [resolved?.chapter ?? null, resolved ? [resolved.start, resolved.end] : null, doc.size, doc.style ?? null];
  for (const item of timeline.items) {
    if (chapterIdOf(item.item) !== chapterId) continue;
    const asset = item.item.assetId ? doc.assets[item.item.assetId] : undefined;
    parts.push([item.item, item.start, item.end, asset?.contentHash ?? asset?.id ?? null]);
  }
  return JSON.stringify(parts);
}
