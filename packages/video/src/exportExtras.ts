/**
 * §5.13 (AA) 42-13 — 영상과 함께 내는 딸림 파일의 계산(순수): 챕터 목록 글 · 썸네일 시각 · 어떤 파일이 나오는가.
 * 구간 렌더는 SRT 와 같은 규칙 — 그 구간에 걸친 것만, 구간 시작을 0 으로 옮긴다.
 */

import { CHAPTER_THUMB_AT } from './chapterThumbs.js';
import { docPosterTime } from './docPoster.js';
import type { ExportCaptions, ExportExtras } from './exportSettings.js';
import type { ExportRange } from './renderSpec.js';
import type { ResolvedTimeline } from './types.js';

/** 딸림 파일의 종류(이름 꼬리는 `EXPORT_COMPANION_SUFFIX`). */
export type CompanionKind = keyof ExportExtras;

/** 켰지만 나오지 않은 까닭 — 화면이 사람 말로 옮긴다. */
export type CompanionNote = 'thumbnail-failed' | 'chapters-empty' | 'subtitles-empty';
export const COMPANION_NOTES: readonly CompanionNote[] = ['thumbnail-failed', 'chapters-empty', 'subtitles-empty'];

/** 이 렌더가 SRT 를 내는가 — 자막 [따로 내기]는 늘 함께 낸다(같은 파일 하나). */
export function wantsSubtitleFile(extras: ExportExtras | null | undefined, captions: ExportCaptions | null | undefined): boolean {
  return captions === 'separate' || extras?.subtitles === true;
}

/** 목록 한 줄의 시각 — `MM:SS`, `hours` 면 `H:MM:SS`. 초는 내림(장면 시작을 지나치지 않게). */
export function chapterClock(seconds: number, hours: boolean): string {
  const total = Math.max(0, Math.floor(seconds + 1e-6));
  const two = (n: number): string => String(n).padStart(2, '0');
  const s = total % 60;
  if (!hours) return `${two(Math.floor(total / 60))}:${two(s)}`;
  return `${Math.floor(total / 3600)}:${two(Math.floor((total % 3600) / 60))}:${two(s)}`;
}

/** 목록에 서는 한 줄(시각은 파일 시각 — 구간 시작이 0). */
export interface ChapterListEntry {
  readonly start: number;
  readonly title: string;
}

/**
 * 장면 → 목록 줄. 길이 0 인 장면은 빠지고, 제목이 비면 이름틀(`{n}` = 순번, 틀이 없으면 `#n`)로 부른다.
 * 줄바꿈이 든 제목은 한 줄로 편다(한 줄 = 한 장면이 깨지지 않게).
 */
export function chapterListEntries(timeline: ResolvedTimeline, range?: ExportRange | null, label?: string | null): ChapterListEntry[] {
  const from = range ? Math.max(0, range.start) : 0;
  const to = range ? Math.max(from, range.end) : Infinity;
  const template = label && label.includes('{n}') ? label : '#{n}';
  const out: ChapterListEntry[] = [];
  for (const c of timeline.chapters) {
    const start = Math.max(c.start, from);
    const end = Math.min(c.end, to);
    if (end - start <= 0.001) continue;
    const title = c.chapter.title.replace(/\s+/g, ' ').trim() || template.replace('{n}', String(c.index + 1));
    out.push({ start: start - from, title });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 챕터 목록 글(`시각 제목` 한 줄씩, 줄 끝 `\n`). 장면이 없으면 빈 글 — 빈 파일은 만들지 않는다. */
export function buildChapterList(timeline: ResolvedTimeline, range?: ExportRange | null, label?: string | null): string {
  const entries = chapterListEntries(timeline, range, label);
  const hours = entries.some((e) => e.start >= 3600);
  return entries.map((e) => `${chapterClock(e.start, hours)} ${e.title}\n`).join('');
}

/**
 * 썸네일을 찍을 문서 시각. 고른 시각이 없으면 문서 갤러리 포스터와 같은 자리, 구간 렌더에서 그 구간 밖이면 구간의 대표
 * 시각으로 옮긴다(그 파일에 없는 장면이 표지가 되지 않게). 마지막 프레임을 넘지 않는다.
 */
export function thumbnailTime(at: number | null | undefined, duration: number, range?: ExportRange | null): number {
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const last = Math.max(0, total - 1 / 30);
  const wanted = typeof at === 'number' && Number.isFinite(at) && at >= 0 ? at : null;
  if (range) {
    const start = Math.max(0, Math.min(range.start, total));
    const end = Math.max(start, Math.min(range.end, total));
    const t = wanted !== null && wanted >= start && wanted < end ? wanted : start + (end - start) * CHAPTER_THUMB_AT;
    return Math.max(0, Math.min(t, last));
  }
  return Math.max(0, Math.min(wanted ?? docPosterTime(total), last));
}
