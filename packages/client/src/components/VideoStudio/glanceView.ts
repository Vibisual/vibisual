import {
  CHAPTER_THUMB_AT,
  buildDrawList,
  opRect,
  type ResolvedChapter,
  type ResolvedTimeline,
  type VideoDoc,
} from '@vibisual/video';

import type { VideoGlance } from './videoGlance.js';

/**
 * §5.4 #36 (J) — 훑어보기 화면의 판정(순수, DOM 없음): 포스터로 보일 장면(③ 바뀐 곳부터) · 훑는 시각과 그 그림(②) · 바뀐 아이템
 * 상자(④ 문서 기하 — 픽셀 비교 ❌) · 결과 칸 안 맞춤 상자.
 */

export interface StageBox {
  readonly width: number;
  readonly height: number;
}

export interface StageRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** 종전 포스터 시각 — 길이의 35%(첫 프레임은 검은 화면·등장 전이 흔하다), 마지막 프레임 앞까지. */
export function posterTime(duration: number): number {
  if (!(duration > 0)) return 0;
  return Math.max(0, Math.min(duration * 0.35, duration - 1 / 30));
}

/** 장면 대표 프레임의 시각(§5.13 39-4 — 장면 길이의 `CHAPTER_THUMB_AT`). */
export function chapterThumbTime(c: ResolvedChapter): number {
  return c.start + c.duration * CHAPTER_THUMB_AT;
}

/**
 * ③ 포스터 후보 장면 차례 — 마지막 바퀴의 장면(`chapterId`) → 그 바퀴가 만진 것(`focus` 가 장면이면) → 이번에 바뀐 것의 첫 장면 줄 →
 * 첫 `done` 장면. 같은 장면은 한 번만.
 */
export function posterCandidates(glance: Pick<VideoGlance, 'pass' | 'lines' | 'timeline'>): string[] {
  const ids = new Set(glance.timeline.chapters.map((c) => c.id));
  const out: string[] = [];
  const add = (id: string | undefined): void => {
    if (id && ids.has(id) && !out.includes(id)) out.push(id);
  };
  add(glance.pass?.chapterId);
  add(glance.pass?.focus);
  add(glance.lines.find((l) => l.target?.chapterId)?.target?.chapterId);
  add(glance.timeline.chapters.find((c) => c.chapter.status === 'done')?.id);
  return out;
}

export interface PosterPick {
  /** 그림이 선 장면(없으면 `null` — 종전 35% 정지 화면을 쓴다). */
  readonly chapterId: string | null;
  readonly t: number;
  readonly image: string | null;
}

/** ③ 포스터 — 그림이 있는 첫 후보. 후보에 그림이 아직 없으면 그림 없이 첫 후보의 시각(굽는 중), 후보가 없으면 35% 지점. */
export function pickPoster(
  glance: Pick<VideoGlance, 'pass' | 'lines' | 'timeline'>,
  thumbs: Readonly<Record<string, string | null>>,
): PosterPick {
  const byId = new Map(glance.timeline.chapters.map((c) => [c.id, c]));
  const order = posterCandidates(glance);
  for (const id of order) {
    const image = thumbs[id];
    const c = byId.get(id);
    if (image && c) return { chapterId: id, t: chapterThumbTime(c), image };
  }
  const first = order[0] !== undefined ? byId.get(order[0]) : undefined;
  return first ? { chapterId: first.id, t: chapterThumbTime(first), image: null } : { chapterId: null, t: posterTime(glance.timeline.duration), image: null };
}

/** ② 결과 칸 x 비율 → 시각(마지막 프레임 앞까지). */
export function scrubTime(fraction: number, duration: number, fps = 30): number {
  if (!(duration > 0) || !Number.isFinite(fraction)) return 0;
  const f = Math.min(1, Math.max(0, fraction));
  return Math.min(f * duration, Math.max(0, duration - 1 / Math.max(1, fps)));
}

/** 그 시각의 장면(겹치는 전환 구간이면 뒤 장면). 장면 밖이면 `null`. */
export function chapterAt(timeline: ResolvedTimeline, t: number): ResolvedChapter | null {
  let hit: ResolvedChapter | null = null;
  for (const c of timeline.chapters) if (c.start <= t && t < c.end) hit = c;
  return hit;
}

/** 장면이 없는 문서를 훑을 정지 화면 시각들 — 구간마다 가운데(`APP_CANVAS_FACE.scrubStills` 장). */
export function scrubStillTimes(duration: number, count: number): number[] {
  const n = Math.max(1, Math.floor(count));
  if (!(duration > 0)) return [];
  return Array.from({ length: n }, (_, i) => Math.min(duration - 1 / 30, ((i + 0.5) / n) * duration));
}

/**
 * ② 훑는 시각의 그림 — 그 시각 장면의 대표 프레임, 없으면 가장 가까운 장면의 것. 장면이 없는 문서는 가장 가까운 정지 화면
 * (`stills` — `scrubStillTimes` 순서, 못 구운 칸은 `null`). 아무것도 없으면 `null`(포스터 그대로).
 */
export function scrubImageAt(
  timeline: ResolvedTimeline,
  thumbs: Readonly<Record<string, string | null>>,
  stills: readonly (string | null)[],
  t: number,
): string | null {
  if (timeline.chapters.length > 0) {
    const at = chapterAt(timeline, t);
    const own = at ? thumbs[at.id] : null;
    if (own) return own;
    let best: { d: number; image: string } | null = null;
    for (const c of timeline.chapters) {
      const image = thumbs[c.id];
      if (!image) continue;
      const d = t < c.start ? c.start - t : t >= c.end ? t - c.end : 0;
      if (!best || d < best.d) best = { d, image };
    }
    return best?.image ?? null;
  }
  const times = scrubStillTimes(timeline.duration, stills.length);
  let pick: string | null = null;
  let pickD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < times.length; i += 1) {
    const image = stills[i];
    const at = times[i];
    if (!image || at === undefined) continue;
    const d = Math.abs(at - t);
    if (d < pickD) { pick = image; pickD = d; }
  }
  return pick;
}

/** 문서 판형을 결과 칸 안에 맞춘 상자(가운데 · 비율 그대로). */
export function containRect(box: StageBox, size: { readonly width: number; readonly height: number }): StageRect {
  if (!(box.width > 0) || !(box.height > 0) || !(size.width > 0) || !(size.height > 0)) return { left: 0, top: 0, width: 0, height: 0 };
  const scale = Math.min(box.width / size.width, box.height / size.height);
  const width = size.width * scale;
  const height = size.height * scale;
  return { left: (box.width - width) / 2, top: (box.height - height) / 2, width, height };
}

/** 한 화면에 두르는 테 상한 — 아이템이 많은 바퀴에서 화면이 테로 덮이지 않게. */
export const OUTLINE_MAX = 12;

/**
 * ④ 그 시각에 보이는 "바뀐 아이템" 상자(결과 칸 px). 문서 기하(`buildDrawList` 상자 + 크기 배율)를 맞춤 상자에 옮긴다 — 회전은 무시,
 * 자막·덧그림은 뺀다, 맞춤 상자 밖은 자른다.
 */
export function outlineRects(
  doc: VideoDoc,
  timeline: ResolvedTimeline,
  t: number,
  itemIds: ReadonlySet<string>,
  box: StageBox,
): StageRect[] {
  if (itemIds.size === 0) return [];
  const frame = containRect(box, doc.size);
  if (frame.width <= 0) return [];
  const sx = frame.width / doc.size.width;
  const sy = frame.height / doc.size.height;
  const out: StageRect[] = [];
  for (const op of buildDrawList(doc, timeline, t)) {
    if (out.length >= OUTLINE_MAX) break;
    if (!itemIds.has(op.itemId) || op.kind === 'caption' || op.synthetic === true) continue;
    const r = opRect(op);
    const left = Math.max(frame.left, frame.left + r.x * sx);
    const top = Math.max(frame.top, frame.top + r.y * sy);
    const right = Math.min(frame.left + frame.width, frame.left + (r.x + r.width) * sx);
    const bottom = Math.min(frame.top + frame.height, frame.top + (r.y + r.height) * sy);
    if (right - left < 2 || bottom - top < 2) continue;
    out.push({ left, top, width: right - left, height: bottom - top });
  }
  return out;
}

/** ③ 멈춘 동안의 "바뀐 것 한 줄" — 바퀴 보고 요약의 첫 줄, 없으면 이번에 바뀐 것의 앞 줄들(번역은 화면 몫). 둘 다 없으면 `null`. */
export function changeNote(glance: Pick<VideoGlance, 'pass' | 'lines'>): { readonly kind: 'report'; readonly text: string } | { readonly kind: 'lines' } | null {
  const summary = glance.pass?.report?.summary?.split('\n').map((s) => s.trim()).find((s) => s !== '');
  if (summary) return { kind: 'report', text: summary };
  return glance.lines.length > 0 ? { kind: 'lines' } : null;
}

/** ⑤ 구슬 줄이 고른 장면(`scene:<id>`)의 장면 id. 장면 구슬이 아니면 `null`. */
export function focusChapterId(itemId: string): string | null {
  return itemId.startsWith('scene:') ? itemId.slice('scene:'.length) : null;
}
