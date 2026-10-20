/**
 * §5.13 (V) 37-15 — 자막 큐 → SRT (순수). 내보내기의 [SRT] 와 자막 **따로 내기**(자막 트랙을 숨긴 렌더 + SRT)가 쓴다.
 *
 * 그려지는 자막만 넣는다 — 꺼 둔 아이템·숨긴 트랙·고르지 않은 갈래는 빠진다. 큐는 그 아이템이 보이는 구간으로 잘린다.
 * 시각은 문서 시각이고 `HH:MM:SS,mmm` 로 적는다(번호는 1 부터, 빈 줄로 나눈다).
 */

import { chapterMap, isUnpickedVariant } from './chapters.js';
import type { ResolvedTimeline, VideoDoc } from './types.js';

export function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${two(h)}:${two(m)}:${two(s)},${String(rest).padStart(3, '0')}`;
}

/**
 * §5.13 (AA) 42-4 — `range` 를 주면 그 구간의 큐만, 구간 시작을 0 으로 옮겨 적는다(구간 렌더 옆에 놓는 SRT 가 그 영상의 시각과
 * 맞게). 구간에 걸친 큐는 구간 안 몫만 남는다.
 */
export function buildSrt(doc: VideoDoc, timeline: ResolvedTimeline, range?: { readonly start: number; readonly end: number } | null): string {
  const hidden = new Set(doc.tracks.filter((t) => t.hidden === true).map((t) => t.id));
  const chapters = chapterMap(doc);
  const cues: Array<{ start: number; end: number; text: string }> = [];
  const from = range ? Math.max(0, range.start) : 0;
  const to = range ? Math.max(from, range.end) : Infinity;
  for (const r of timeline.items) {
    if (r.kind !== 'caption' || r.item.enabled === false || hidden.has(r.trackId) || isUnpickedVariant(chapters, r.item)) continue;
    for (const cue of r.item.cues ?? []) {
      const start = Math.max(cue.start, r.start, from);
      const end = Math.min(cue.end, r.end, to);
      const text = cue.text.trim();
      if (end - start <= 0.001 || text === '') continue;
      cues.push({ start: start - from, end: end - from, text });
    }
  }
  cues.sort((a, b) => a.start - b.start || a.end - b.end);
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
}

/** 자막 트랙을 숨긴 사본(자막 **따로 내기** 렌더). 문서 자체는 바꾸지 않는다. */
export function withoutCaptions(doc: VideoDoc): VideoDoc {
  return { ...doc, tracks: doc.tracks.map((t) => (t.kind === 'caption' ? { ...t, hidden: true } : t)) };
}
