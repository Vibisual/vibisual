import type { ShelfItem } from '@vibisual/shared';

/** §7.18 — 펼친 줄의 글자 칸 초안. 종류를 바꿔도 반대쪽 본문을 잃지 않게 명령·프롬프트를 둘 다 든다. */
export interface ShelfItemDraft {
  itemId: string;
  label: string;
  command: string;
  prompt: string;
  cwd: string;
}

export type ShelfDraftChanges = Partial<Pick<ShelfItem, 'label' | 'command' | 'prompt' | 'cwd'>>;

export function shelfDraftOf(item: ShelfItem): ShelfItemDraft {
  return { itemId: item.id, label: item.label, command: item.command ?? '', prompt: item.prompt ?? '', cwd: item.cwd ?? '' };
}

/** 서버 값과 다른 칸만. 같으면 `null` — 저장 왕복(스냅샷 방송·체크포인트)을 아예 내지 않는다. */
export function shelfDraftChanges(item: ShelfItem, draft: ShelfItemDraft): ShelfDraftChanges | null {
  if (draft.itemId !== item.id) return null;
  const out: ShelfDraftChanges = {};
  if (draft.label !== item.label) out.label = draft.label;
  if (draft.command !== (item.command ?? '')) out.command = draft.command;
  if (draft.prompt !== (item.prompt ?? '')) out.prompt = draft.prompt;
  if (draft.cwd !== (item.cwd ?? '')) out.cwd = draft.cwd;
  return Object.keys(out).length > 0 ? out : null;
}
