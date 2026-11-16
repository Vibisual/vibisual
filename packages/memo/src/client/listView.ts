import { MEMO } from '../config.js';
import type { MemoNote, MemoTask } from '../types.js';

export interface MemoQuery { q: string; view: string; from: string; until: string }
export type MemoGroupKey = 'pinned' | 'today' | 'yesterday' | 'week' | 'month' | 'older';
export interface MemoGroup { key: MemoGroupKey; notes: MemoNote[] }
export interface TextSegment { text: string; hit: boolean }

const DAY = 86_400_000;
const ORDER: MemoGroupKey[] = ['pinned', 'today', 'yesterday', 'week', 'month', 'older'];

function dayStart(at: number): number { const d = new Date(at); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

export function groupNotes(notes: readonly MemoNote[], now: number): MemoGroup[] {
  const buckets = new Map<MemoGroupKey, MemoNote[]>();
  const today = dayStart(now);
  for (const note of notes) {
    // 서머타임 날은 24시간이 아니므로 반올림으로 달력 일수를 구한다.
    const days = Math.round((today - dayStart(note.updatedAt)) / DAY);
    const key: MemoGroupKey = note.pinned ? 'pinned' : days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 7 ? 'week' : days < 30 ? 'month' : 'older';
    const list = buckets.get(key);
    if (list) list.push(note); else buckets.set(key, [note]);
  }
  return ORDER.flatMap(key => { const list = buckets.get(key); return list ? [{ key, notes: list }] : []; });
}

export function relativeTime(at: number, now: number, locale?: string): string {
  const seconds = Math.floor((now - at) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (seconds < 60) return rtf.format(0, 'second');
  if (seconds < 3600) return rtf.format(-Math.floor(seconds / 60), 'minute');
  if (seconds < 86_400) return rtf.format(-Math.floor(seconds / 3600), 'hour');
  if (seconds < 7 * 86_400) return rtf.format(-Math.floor(seconds / 86_400), 'day');
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' }).format(at);
}

/** NFC 본문에서 q 와 일치하는 [start,end) 구간들. 소문자화로 길이가 바뀌는 글자도 코드포인트 단위로 원문에 대응시킨다. */
function matchRanges(text: string, q: string): [number, number][] {
  const needle = q.normalize('NFC').toLocaleLowerCase();
  if (!needle) return [];
  let lowered = '';
  const origin: number[] = [];
  let at = 0;
  for (const ch of text) {
    const low = ch.toLocaleLowerCase();
    for (let i = 0; i < low.length; i++) origin.push(at);
    lowered += low;
    at += ch.length;
  }
  origin.push(text.length);
  const ranges: [number, number][] = [];
  for (let i = lowered.indexOf(needle); i >= 0; i = lowered.indexOf(needle, i + needle.length)) {
    const start = origin[i] ?? 0;
    let end = origin[i + needle.length] ?? text.length;
    if (end <= start) end = text.length;
    ranges.push([start, end]);
  }
  return ranges;
}

export function highlight(text: string, q: string): TextSegment[] {
  const source = text.normalize('NFC');
  const ranges = matchRanges(source, q);
  if (!ranges.length) return [{ text: source, hit: false }];
  const out: TextSegment[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) continue;
    if (start > cursor) out.push({ text: source.slice(cursor, start), hit: false });
    out.push({ text: source.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < source.length) out.push({ text: source.slice(cursor), hit: false });
  return out;
}

export function previewText(note: Pick<MemoNote, 'title' | 'body'>, q: string, max: number = MEMO.previewChars): string {
  let body = note.body;
  // 제목이 비면 첫 비지 않은 줄이 제목으로 쓰이므로 미리보기에서 중복을 피한다.
  if (!note.title) {
    const lines = body.split('\n');
    const first = lines.findIndex(line => line.trim());
    if (first >= 0) body = lines.slice(first + 1).join('\n');
  }
  const flat = body.normalize('NFC').replace(/\s+/g, ' ').trim();
  const cps = Array.from(flat);
  const hit = matchRanges(flat, q)[0];
  let from = 0;
  if (hit) from = Math.max(0, Array.from(flat.slice(0, hit[0])).length - Math.floor(max / 4));
  if (from > 0 && cps.length - from < max) from = Math.max(0, cps.length - max);
  return (from > 0 ? '…' : '') + cps.slice(from, from + max).join('');
}

export function tagCounts(notes: readonly MemoNote[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const note of notes) for (const tag of new Set(note.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function textStats(body: string): { chars: number; words: number } {
  const trimmed = body.trim();
  return { chars: Array.from(body.replace(/[\r\n]/g, '')).length, words: trimmed ? trimmed.split(/\s+/).length : 0 };
}

export function formatBytes(size: number, locale?: string): string {
  const fmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  if (size < 1024) return `${fmt.format(size)} B`;
  if (size < 1024 * 1024) return `${fmt.format(size / 1024)} KB`;
  if (size < 1024 ** 3) return `${fmt.format(size / (1024 * 1024))} MB`;
  return `${fmt.format(size / 1024 ** 3)} GB`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds)); const two = (value: number): string => String(value).padStart(2, '0');
  const hours = Math.floor(total / 3600); const minutes = Math.floor((total % 3600) / 60);
  return hours ? `${hours}:${two(minutes)}:${two(total % 60)}` : `${minutes}:${two(total % 60)}`;
}

export function taskProgress(tasks: readonly MemoTask[]): { done: number; total: number } {
  return { done: tasks.filter(task => task.checked).length, total: tasks.length };
}
