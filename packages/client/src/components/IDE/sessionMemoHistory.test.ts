import { describe, expect, it } from 'vitest';
import { SESSION_MEMO, type SessionMemo } from '@vibisual/shared';
import {
  canAddMemo, closeMemo, closedSessionMemos, hasHiddenMemoHeaders, memoCards, mergeMemos,
  openSessionMemos, restoreMemo,
} from './sessionMemo.js';

const bounds = { w: 800, h: 600 };
function memo(id: string, extra: Partial<SessionMemo> = {}): SessionMemo {
  return { id, text: '기록', x: 80, y: 40, w: 280, h: 180, color: '#1E293B', createdAt: 1, updatedAt: 1, ...extra };
}

describe('session memo history', () => {
  it('keeps the whole memo when closing a grouped tab and repairs the remaining tab', () => {
    const a = memo('a', {
      name: '배포 절차', alpha: 0.6,
      links: [{ id: 'link-a', start: 0, end: 2, target: { kind: 'url', url: 'https://example.com' } }],
    });
    const grouped = mergeMemos([a, memo('b')], 'a', 'b', true, 2);
    const closed = closeMemo(grouped, 'a', 3);
    expect(openSessionMemos(closed)).toHaveLength(1);
    expect(openSessionMemos(closed)[0]?.groupId).toBeUndefined();
    expect(closedSessionMemos(closed)[0]).toMatchObject({ ...a, closedAt: 3, updatedAt: 3 });
    expect(closedSessionMemos(closed)[0]?.groupId).toBeUndefined();
    expect(closeMemo(closed, 'a', 4)).toBe(closed);
    expect(closeMemo(closed, 'missing', 4)).toBe(closed);
  });

  it('restores a closed memo expanded, in bounds, and above the open cards', () => {
    const old = memo('old', { closedAt: 2, collapsed: true, x: 5000, y: 5000, name: 'old note' });
    const restored = restoreMemo([old, memo('open')], old.id, bounds, 9);
    expect(restored.map((m) => m.id)).toEqual(['open', 'old']);
    expect(restored[1]).toMatchObject({ name: 'old note', text: old.text, createdAt: 1, updatedAt: 9, x: 520, y: 420 });
    expect(restored[1]?.closedAt).toBeUndefined();
    expect(restored[1]?.collapsed).toBeUndefined();
    expect(restoreMemo(restored, old.id, bounds)).toBe(restored);
  });

  it('ignores closed history for capacity and overlap and sorts history newest first', () => {
    const memos = [memo('open'), ...Array.from({ length: 40 }, (_, i) => memo(`closed-${i}`, { closedAt: i + 2 }))];
    expect(canAddMemo(memos)).toBe(true);
    expect(memoCards(memos)).toHaveLength(1);
    expect(hasHiddenMemoHeaders(memos)).toBe(false);
    expect(closedSessionMemos(memos)[0]?.id).toBe('closed-39');
    expect(closedSessionMemos(memos)).toHaveLength(40);
  });

  it('keeps a requested restore in history when the open memo limit has been reached', () => {
    const full = [...Array.from({ length: SESSION_MEMO.MAX_PER_OWNER }, (_, i) => memo(`open-${i}`)), memo('closed', { closedAt: 3 })];
    expect(restoreMemo(full, 'closed', bounds)).toBe(full);
    const freed = closeMemo(full, 'open-0', 5);
    const restored = restoreMemo(freed, 'closed', bounds, 6);
    expect(openSessionMemos(restored)).toHaveLength(SESSION_MEMO.MAX_PER_OWNER);
    expect(closedSessionMemos(restored).map((m) => m.id)).toEqual(['open-0']);
  });
});
