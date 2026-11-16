import { describe, expect, it } from 'vitest';
import type { MemoNote } from '../types.js';
import { formatBytes, groupNotes, highlight, previewText, relativeTime, tagCounts, taskProgress, textStats } from './listView.js';

function note(id: string, updatedAt: number, extra: Partial<MemoNote> = {}): MemoNote {
  return { id, owner: 'local', project: 'p', title: '', body: '', version: 1, createdAt: 1, updatedAt, pinned: false, aiExcluded: false, tags: [], tasks: [],
    context: null, attachments: [], deletedAt: null, requestId: 'req-12345678', author: 'user', ...extra };
}
const now = new Date(2026, 5, 15, 0, 5).getTime();

describe('groupNotes', () => {
  it('groups by local calendar day across midnight and keeps order', () => {
    const notes = [
      note('late', new Date(2026, 5, 14, 23, 59).getTime()),
      note('early', new Date(2026, 5, 15, 0, 1).getTime()),
      note('pin', new Date(2020, 0, 1).getTime(), { pinned: true }),
      note('week', new Date(2026, 5, 9, 12).getTime()),
      note('month', new Date(2026, 5, 1, 12).getTime()),
      note('old', new Date(2026, 3, 1).getTime()),
      note('week2', new Date(2026, 5, 10, 12).getTime()),
    ];
    const groups = groupNotes(notes, now);
    expect(groups.map(g => g.key)).toEqual(['pinned', 'today', 'yesterday', 'week', 'month', 'older']);
    expect(groups.find(g => g.key === 'week')?.notes.map(n => n.id)).toEqual(['week', 'week2']);
    expect(groups[1]?.notes[0]?.id).toBe('early');
  });
  it('omits empty groups and handles empty input', () => {
    expect(groupNotes([], now)).toEqual([]);
    expect(groupNotes([note('a', now)], now).map(g => g.key)).toEqual(['today']);
  });
});

describe('relativeTime', () => {
  it('uses seconds, minutes, hours and days', () => {
    expect(relativeTime(now - 5_000, now, 'en')).toBe('now');
    expect(relativeTime(now - 5 * 60_000, now, 'en')).toBe('5 minutes ago');
    expect(relativeTime(now - 3 * 3_600_000, now, 'en')).toBe('3 hours ago');
    expect(relativeTime(now - 2 * 86_400_000, now, 'en')).toBe('2 days ago');
  });
  it('falls back to a short date, with the year only when it differs', () => {
    const same = relativeTime(new Date(2026, 0, 2).getTime(), now, 'en');
    expect(same).toBe('Jan 2');
    expect(relativeTime(new Date(2020, 0, 2).getTime(), now, 'en')).toBe('Jan 2, 2020');
    expect(() => relativeTime(now - 1000, now)).not.toThrow();
  });
});

describe('highlight', () => {
  it('returns one piece for an empty query', () => { expect(highlight('abc', '')).toEqual([{ text: 'abc', hit: false }]); });
  it('matches case-insensitively and preserves original letters', () => {
    expect(highlight('Hello hello', 'HELLO')).toEqual([{ text: 'Hello', hit: true }, { text: ' ', hit: false }, { text: 'hello', hit: true }]);
  });
  it('matches NFC against NFD input and Korean text', () => {
    const nfd = '한글'.normalize('NFD');
    expect(highlight(`가 ${nfd} 나`, '한글').find(s => s.hit)?.text).toBe('한글');
  });
  it('keeps surrogate pairs whole', () => {
    expect(highlight('a😀b', '😀')).toEqual([{ text: 'a', hit: false }, { text: '😀', hit: true }, { text: 'b', hit: false }]);
  });
  it('returns the whole text when nothing matches', () => { expect(highlight('abc', 'z')).toEqual([{ text: 'abc', hit: false }]); });
});

describe('previewText', () => {
  it('collapses whitespace and skips the first line when the title is empty', () => {
    expect(previewText({ title: '', body: '제목줄\n\n  본문   내용\n끝' }, '')).toBe('본문 내용 끝');
  });
  it('keeps the first line when a title exists', () => {
    expect(previewText({ title: 'T', body: 'first\nsecond' }, '')).toBe('first second');
  });
  it('windows around the first match with a leading ellipsis', () => {
    const body = `x\n${'가'.repeat(100)}NEEDLE${'나'.repeat(100)}`;
    const out = previewText({ title: '', body }, 'needle', 40);
    expect(out.startsWith('…')).toBe(true);
    expect(out).toContain('NEEDLE');
    expect(Array.from(out).length).toBeLessThanOrEqual(41);
  });
  it('truncates by code points', () => {
    expect(previewText({ title: 't', body: '😀'.repeat(10) }, '', 3)).toBe('😀😀😀');
    expect(previewText({ title: '', body: '' }, 'q')).toBe('');
  });
});

describe('small helpers', () => {
  it('counts tags descending with a stable tie order', () => {
    const notes = [note('1', 1, { tags: ['b', 'a'] }), note('2', 1, { tags: ['b', 'c', 'c'] })];
    expect(tagCounts(notes)).toEqual([{ tag: 'b', count: 2 }, { tag: 'a', count: 1 }, { tag: 'c', count: 1 }]);
    expect(tagCounts([])).toEqual([]);
  });
  it('computes text stats', () => {
    expect(textStats('')).toEqual({ chars: 0, words: 0 });
    expect(textStats('한글 😀\nab')).toEqual({ chars: 6, words: 3 });
  });
  it('formats bytes', () => {
    expect(formatBytes(0, 'en')).toBe('0 B');
    expect(formatBytes(1536, 'en')).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024, 'en')).toBe('5 MB');
  });
  it('counts finished tasks', () => {
    expect(taskProgress([{ id: '1', text: 'a', checked: true }, { id: '2', text: 'b', checked: false }])).toEqual({ done: 1, total: 2 });
    expect(taskProgress([])).toEqual({ done: 0, total: 0 });
  });
});
