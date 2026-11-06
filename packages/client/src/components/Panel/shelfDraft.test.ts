import { describe, expect, it } from 'vitest';
import type { ShelfItem } from '@vibisual/shared';
import { shelfDraftChanges, shelfDraftOf } from './shelfDraft.js';

const item: ShelfItem = {
  id: 'sitem-1', label: 'Test', kind: 'command', command: 'pnpm test', icon: 'terminal',
  color: '#0891B2', createdAt: 1, updatedAt: 1,
};

describe('§7.18 선반 편집 초안', () => {
  it('손대지 않았으면 저장할 것이 없다 — 칸을 떠날 때마다 서버를 두드리지 않는다', () => {
    expect(shelfDraftChanges(item, shelfDraftOf(item))).toBeNull();
  });

  it('없는 값은 빈 칸으로 읽어 "비어 있음 → 비어 있음" 을 바뀐 것으로 치지 않는다', () => {
    const draft = shelfDraftOf(item);
    expect(draft.cwd).toBe('');
    expect(draft.prompt).toBe('');
    expect(shelfDraftChanges(item, draft)).toBeNull();
  });

  it('바뀐 칸만 보낸다', () => {
    const draft = { ...shelfDraftOf(item), command: 'pnpm lint', cwd: 'packages/client' };
    expect(shelfDraftChanges(item, draft)).toEqual({ command: 'pnpm lint', cwd: 'packages/client' });
  });

  it('지운 것도 바뀐 것이다 — 빈 문자열로 보낸다', () => {
    expect(shelfDraftChanges(item, { ...shelfDraftOf(item), command: '' })).toEqual({ command: '' });
  });

  it('다른 줄의 초안은 이 줄에 쓰지 않는다', () => {
    const other = { ...shelfDraftOf(item), itemId: 'sitem-2', label: 'Other' };
    expect(shelfDraftChanges(item, other)).toBeNull();
  });
});
