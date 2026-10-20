/**
 * §5.13 (V) 37-13 — 실사는 **대본으로** 편집한다 (순수).
 *
 * - `buildTranscript` — 자막 아이템의 큐를 문장 목록으로(문서 시각 · 그 문장 동안 나오는 영상·소리 아이템). 사람의 대본 보기와
 *   에이전트의 `GET /doc/:id/transcript` 가 같은 목록을 본다.
 * - `sentenceCutRanges` — 지운 문장들을 잘라 낼 구간으로. 이어서 지운 문장 사이의 빈틈은 함께 잘리고, 남긴 문장 옆의 쉼은 남는다.
 *   **경계는 문장(큐) 경계다** — 사람·AI 가 말한 숫자가 아니라 문서가 가진 시각으로 자른다.
 * - `buildCutOps` — 그 구간들을 실제로 잘라 내는 연산(되돌리기·판 기록이 그대로 받는다). 겹치는 영상·소리·컴포지션은 나누고
 *   잘라 내며(트림), 뒤 아이템은 상대 앵커면 따라오고(가운데 빈틈이 잘렸으면 offset 을 고친다) 절대 시각이면 그만큼 당기고,
 *   자막 큐·낱말도 옮긴다. 장면 길이도 그 장면 안에서 잘린 만큼 줄인다. 연산을 적용한 뒤의 길이를 함께 돌려준다(화면이 보인다).
 */

import { chapterMap, isUnpickedVariant } from './chapters.js';
import { rebaseKeyframes } from './keyframes.js';
import { applyPatch } from './ops.js';
import { resolveTimeline } from './resolveTimeline.js';
import type { CaptionCue, CaptionWord, ResolvedItem, ResolvedTimeline, TimeAnchor, VideoDoc, VideoDocOp, VideoItem } from './types.js';

export interface TranscriptSentence {
  /** `<자막 아이템 id>#<큐 번호>` — 지울 때 이 id 로 가리킨다. */
  readonly id: string;
  readonly itemId: string;
  readonly cueIndex: number;
  /** 문서 시각(초). */
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly words?: readonly CaptionWord[];
  /** 이 문장 동안 나오는 영상·소리 아이템. */
  readonly media: readonly string[];
}

export interface CutRange {
  readonly start: number;
  readonly end: number;
}

export interface CutPlan {
  readonly ops: VideoDocOp[];
  readonly ranges: CutRange[];
  /** 잘려 나가는 길이(초). */
  readonly removed: number;
  readonly durationBefore: number;
  /** 연산을 적용한 뒤의 길이(초 — 문서에서 계산). 적용이 실패하면 null. */
  readonly durationAfter: number | null;
}

const EPS = 1e-3;

/** 아이템 고침 한 벌(쌓는 동안 쓸 수 있어야 한다 — `VideoItem` 의 칸은 readonly 다). */
type ItemPatch = { -readonly [K in keyof Omit<VideoItem, 'id'>]?: VideoItem[K] };

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function buildTranscript(doc: VideoDoc, timeline: ResolvedTimeline): TranscriptSentence[] {
  // 고르지 않은 갈래(37-14)는 그리지 않으니 대본에도 없다.
  const chapters = chapterMap(doc);
  const live = timeline.items.filter((r) => r.item.enabled !== false && !isUnpickedVariant(chapters, r.item));
  const media = live.filter((r) => r.kind === 'footage' || r.kind === 'audio' || r.kind === 'composition' || r.kind === 'model');
  const out: TranscriptSentence[] = [];
  for (const r of live) {
    if (r.kind !== 'caption') continue;
    (r.item.cues ?? []).forEach((cue, cueIndex) => {
      const start = Math.max(cue.start, r.start);
      const end = Math.min(cue.end, r.end);
      if (end - start <= EPS || cue.text.trim() === '') return;
      out.push({
        id: `${r.id}#${cueIndex}`,
        itemId: r.id,
        cueIndex,
        start: round3(start),
        end: round3(end),
        text: cue.text,
        ...(cue.words && cue.words.length > 0 ? { words: cue.words } : {}),
        media: media.filter((m) => m.start < end - EPS && m.end > start + EPS).map((m) => m.id),
      });
    });
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** 지운 문장 → 잘라 낼 구간. 시각 순으로 이어서 지운 문장들은 사이 빈틈까지 한 구간이다. */
export function sentenceCutRanges(sentences: readonly TranscriptSentence[], deleted: ReadonlySet<string>): CutRange[] {
  const sorted = [...sentences].sort((a, b) => a.start - b.start);
  const out: CutRange[] = [];
  let run: CutRange | null = null;
  for (const s of sorted) {
    if (deleted.has(s.id)) {
      run = run ? { start: run.start, end: Math.max(run.end, s.end) } : { start: s.start, end: s.end };
    } else if (run) {
      out.push(run);
      run = null;
    }
  }
  if (run) out.push(run);
  return mergeCutRanges(out);
}

/** 구간을 정리한다(시각 순 · 겹치거나 맞닿으면 하나로 · 0 미만·`limit` 초과는 자른다). */
export function mergeCutRanges(ranges: readonly CutRange[], limit = Infinity): CutRange[] {
  const sorted = ranges
    .map((r) => ({ start: Math.max(0, r.start), end: Math.min(limit, r.end) }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end - r.start > EPS)
    .sort((a, b) => a.start - b.start);
  const out: CutRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + EPS) out[out.length - 1] = { start: last.start, end: Math.max(last.end, r.end) };
    else out.push(r);
  }
  return out;
}

/** 자른 뒤의 시각. 잘린 구간 안의 시각은 그 구간의 자리(잘린 곳)로 모인다. */
export function mapCutTime(ranges: readonly CutRange[], t: number): number {
  let removed = 0;
  for (const r of ranges) {
    if (t <= r.start) break;
    if (t < r.end) return r.start - removed;
    removed += r.end - r.start;
  }
  return t - removed;
}

/** [a, b] 에서 잘린 구간을 뺀 남는 조각들. */
export function keptSegments(ranges: readonly CutRange[], a: number, b: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let cursor = a;
  for (const r of ranges) {
    if (r.end <= cursor) continue;
    if (r.start >= b) break;
    if (r.start > cursor) out.push([cursor, Math.min(r.start, b)]);
    cursor = Math.max(cursor, r.end);
    if (cursor >= b) break;
  }
  if (cursor < b) out.push([cursor, b]);
  return out.filter(([x, y]) => y - x > EPS);
}

function overlapLength(ranges: readonly CutRange[], a: number, b: number): number {
  let sum = 0;
  for (const r of ranges) sum += Math.max(0, Math.min(b, r.end) - Math.max(a, r.start));
  return sum;
}

function usesTrim(item: VideoItem): boolean {
  return item.kind === 'footage' || item.kind === 'audio' || item.kind === 'composition' || item.kind === 'model';
}

/** 자막 큐를 자른 시각으로 옮긴다(완전히 잘린 큐는 빠진다 · 낱말도 함께). */
function cutCues(cues: readonly CaptionCue[], ranges: readonly CutRange[]): CaptionCue[] {
  const out: CaptionCue[] = [];
  for (const cue of cues) {
    const segs = keptSegments(ranges, cue.start, cue.end);
    const first = segs[0];
    const last = segs[segs.length - 1];
    if (!first || !last) continue;
    const words = cue.words
      ?.filter((w) => keptSegments(ranges, w.t, w.t + EPS * 2).length > 0)
      .map((w) => ({ ...w, t: round3(mapCutTime(ranges, w.t)) }));
    out.push({
      start: round3(mapCutTime(ranges, first[0])),
      end: round3(mapCutTime(ranges, last[1])),
      text: cue.text,
      ...(words && words.length > 0 ? { words } : {}),
    });
  }
  return out;
}

export function buildCutOps(doc: VideoDoc, timeline: ResolvedTimeline, rawRanges: readonly CutRange[]): CutPlan {
  const durationBefore = timeline.duration;
  const ranges = mergeCutRanges(rawRanges, durationBefore);
  if (ranges.length === 0) return { ops: [], ranges, removed: 0, durationBefore, durationAfter: durationBefore };
  const f = (t: number): number => mapCutTime(ranges, t);
  const byId = new Map<string, ResolvedItem>(timeline.items.map((r) => [r.id, r]));
  const allIds = new Set(doc.tracks.flatMap((track) => track.items.map((item) => item.id)));

  const removed = new Set<string>();
  const split = new Set<string>();
  const reshaped = new Set<string>();
  const newStart = new Map<string, number>();
  const patches = new Map<string, ItemPatch>();
  const adds: VideoDocOp[] = [];
  const patchOf = (id: string): ItemPatch => {
    const existing = patches.get(id);
    if (existing) return existing;
    const created: ItemPatch = {};
    patches.set(id, created);
    return created;
  };

  // ① 아이템마다 남는 조각.
  for (const r of timeline.items) {
    const item = r.item;
    const segs = keptSegments(ranges, r.start, r.end);
    const first = segs[0];
    const last = segs[segs.length - 1];
    if (!first || !last) { removed.add(r.id); continue; }
    newStart.set(r.id, f(first[0]));
    if (item.kind === 'caption') {
      // 자막은 나누지 않는다 — 한 아이템이 잘린 만큼 줄고 큐가 옮겨 간다.
      const patch = patchOf(r.id);
      patch.cues = cutCues(item.cues ?? [], ranges);
      const span = f(last[1]) - f(first[0]);
      if (Math.abs(span - r.duration) > EPS) { patch.duration = round3(span); reshaped.add(r.id); }
      continue;
    }
    const whole = segs.length === 1 && first[0] <= r.start + EPS && first[1] >= r.end - EPS;
    if (whole) continue;
    reshaped.add(r.id);
    const trim0 = item.trimStart ?? 0;
    const patch = patchOf(r.id);
    patch.duration = round3(first[1] - first[0]);
    if (usesTrim(item)) patch.trimStart = round3(trim0 + (first[0] - r.start));
    // §5.13 (W) 38-4 — 앞이 잘렸으면 상자의 시간 곡선도 그만큼 당긴다(잘린 지점의 값에서 시작).
    const lead = first[0] - r.start;
    if (lead > EPS && item.keyframes && item.keyframes.length > 0) patch.keyframes = rebaseKeyframes(item.keyframes, round3(lead));
    if (segs.length > 1) split.add(r.id);
    segs.slice(1).forEach(([a, b], k) => {
      let n = k + 1;
      let id = `${item.id}-cut${n}`;
      while (allIds.has(id)) { n += 1; id = `${item.id}-cut${n}`; }
      allIds.add(id);
      const { id: _drop, ...rest } = item;
      const keyframes = item.keyframes && item.keyframes.length > 0 ? rebaseKeyframes(item.keyframes, round3(a - r.start)) : undefined;
      const piece: VideoItem = {
        ...rest,
        id,
        at: round3(f(a)),
        duration: round3(b - a),
        ...(usesTrim(item) ? { trimStart: round3(trim0 + (a - r.start)) } : {}),
        ...(keyframes ? { keyframes } : {}),
      };
      adds.push({ op: 'addItem', trackId: r.trackId, item: piece });
    });
  }

  // ② 자리 — 상대 앵커는 그대로 따라오게 두되, 앵커와 자기 사이가 잘렸으면 offset 을 고치고, 앵커가 사라지거나 나뉘었으면 숫자로.
  const chapterStarts = new Map(timeline.chapters.map((c) => [c.id, c.start]));
  for (const r of timeline.items) {
    if (removed.has(r.id)) continue;
    const target = newStart.get(r.id);
    if (target === undefined) continue;
    const at: TimeAnchor = r.item.at;
    const numeric = (): void => {
      if (typeof at === 'number' && Math.abs(at - target) <= EPS) return;
      patchOf(r.id).at = round3(target);
    };
    if (typeof at === 'number') { numeric(); continue; }
    const offset = typeof at.offset === 'number' && Number.isFinite(at.offset) ? at.offset : 0;
    let base: number | null = null;
    if ('chapter' in at) {
      const start = chapterStarts.get(at.chapter);
      base = start === undefined ? null : f(start);
    } else {
      const refId = 'after' in at ? at.after : 'start' in at ? at.start : at.item;
      const ref = byId.get(refId);
      if (!ref || removed.has(refId)) { numeric(); continue; }
      if ('after' in at) {
        if (split.has(refId)) { numeric(); continue; }
        base = f(ref.end);
      } else if ('start' in at) {
        base = newStart.get(refId) ?? null;
      } else {
        // 표지 앵커 — 그 아이템이 모양을 바꿨으면(앞 트림) 표지 시각이 달라진다: 숫자로 푼다.
        if (reshaped.has(refId)) { numeric(); continue; }
        // 모양이 그대로면 표지는 그 아이템 시작에서 같은 거리에 있다.
        const oldBase = r.start - offset;
        base = (newStart.get(refId) ?? f(ref.start)) + (oldBase - ref.start);
      }
    }
    if (base === null) { numeric(); continue; }
    const nextOffset = target - base;
    if (Math.abs(nextOffset - offset) > EPS) patchOf(r.id).at = { ...at, offset: round3(nextOffset) };
  }

  // ③ 장면 길이 — 그 장면 안에서 잘린 만큼.
  const chapterOps: VideoDocOp[] = [];
  for (const c of timeline.chapters) {
    const cut = overlapLength(ranges, c.start, c.end);
    const patch: { duration?: number; at?: number } = {};
    if (cut > EPS) patch.duration = round3(Math.max(0.1, c.chapter.duration - cut));
    if (typeof c.chapter.at === 'number' && Math.abs(f(c.chapter.at) - c.chapter.at) > EPS) patch.at = round3(f(c.chapter.at));
    if (patch.duration !== undefined || patch.at !== undefined) chapterOps.push({ op: 'updateChapter', chapterId: c.id, patch });
  }

  const ops: VideoDocOp[] = [
    ...[...patches].filter(([id]) => !removed.has(id)).map(([itemId, patch]): VideoDocOp => ({ op: 'updateItem', itemId, patch })),
    ...chapterOps,
    ...[...removed].map((itemId): VideoDocOp => ({ op: 'removeItem', itemId })),
    ...adds,
  ];
  const applied = applyPatch(doc, { baseVersion: doc.version, ops });
  return {
    ops,
    ranges,
    removed: round3(ranges.reduce((sum, r) => sum + (r.end - r.start), 0)),
    durationBefore,
    durationAfter: applied.ok ? resolveTimeline(applied.doc).duration : null,
  };
}
