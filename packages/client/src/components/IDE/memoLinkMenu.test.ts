import { describe, it, expect, vi } from 'vitest';
import { SESSION_MEMO, SESSION_MEMO_LINK_KINDS, type SessionMemoLink } from '@vibisual/shared';
import type { ContextMenuItem } from './IDEContextMenu.js';
import type { PromptRailEntry } from './promptRail.js';
import {
  buildMemoLinkKindItems,
  buildMemoLinkMenuItems,
  type MemoLinkKindContext,
  type MemoLinkKindHandlers,
  type MemoLinkMenuHandlers,
} from './memoLinkMenu.js';

/** §5.5 #17-36 ⑫ — 메모 우클릭 링크 목록 시험(글자 고르고 우클릭 → [링크], 첫 자리는 세션 글 위치, 다시 고르기·추가). */

/** 키를 그대로 돌려주는 t — 라벨이 어느 키에서 왔는지 확인한다. */
const t = (key: string, opts?: Record<string, unknown>): string => (opts ? `${key}:${JSON.stringify(opts)}` : key);

function find(items: ContextMenuItem[], id: string): ContextMenuItem {
  const found = items.find((i) => i.id === id);
  if (!found) throw new Error(`메뉴에 ${id} 가 없다 — ${items.map((i) => i.id).join(',')}`);
  return found;
}

function kindHandlers(): MemoLinkKindHandlers {
  return { pick: vi.fn(), prompt: vi.fn(), session: vi.fn(), file: vi.fn(), url: vi.fn() };
}

function prompts(n: number): PromptRailEntry[] {
  return Array.from({ length: n }, (_, i) => ({ id: `cmd-${i}`, text: `입력 ${i}`, at: 1000 + i }));
}

function ctx(over: Partial<MemoLinkKindContext> = {}): MemoLinkKindContext {
  return {
    prompts: prompts(3),
    sessions: [{ id: null, label: 'Agent' }, { id: 'sub-2', label: '두 번째 세션' }],
    formatTime: (at) => `T${at}`,
    ...over,
  };
}

describe('종류 목록 — 첫 자리는 세션 글 위치', () => {
  it('표(`SESSION_MEMO_LINK_KINDS`)의 순서 그대로, 첫 자리가 세션 글 위치다', () => {
    const items = buildMemoLinkKindItems(ctx(), kindHandlers(), t);
    expect(SESSION_MEMO_LINK_KINDS[0]).toBe('stream');
    expect(items.map((i) => i.id)).toEqual(SESSION_MEMO_LINK_KINDS.map((k) => `link-kind-${k}`));
    expect(items[0]?.label).toBe('ide.memo.link.kind.stream');
  });

  it('세션 글 위치 ▸ — [대화에서 직접 고르기] 다음에 내 입력이 최근 것부터 선다', () => {
    const h = kindHandlers();
    const stream = buildMemoLinkKindItems(ctx(), h, t)[0]!;
    const ids = stream.children?.map((c) => c.id);
    expect(ids).toEqual(['link-pick', 'link-prompt-cmd-2', 'link-prompt-cmd-1', 'link-prompt-cmd-0']);
    // 내 입력 묶음 앞에 구분선 — 고르기 모드와 바로 가는 줄은 성격이 다르다.
    expect(find(stream.children!, 'link-prompt-cmd-2').separatorBefore).toBe(true);
    expect(find(stream.children!, 'link-prompt-cmd-2').hint).toBe('T1002');
    find(stream.children!, 'link-pick').onClick();
    expect(h.pick).toHaveBeenCalledTimes(1);
    find(stream.children!, 'link-prompt-cmd-1').onClick();
    expect(h.prompt).toHaveBeenCalledWith(expect.objectContaining({ id: 'cmd-1' }));
  });

  it('내 입력은 상한까지만 — 더 오래된 것은 대화에서 직접 고른다', () => {
    const stream = buildMemoLinkKindItems(ctx({ prompts: prompts(SESSION_MEMO.LINK_PROMPT_MAX + 7) }), kindHandlers(), t)[0]!;
    expect(stream.children).toHaveLength(SESSION_MEMO.LINK_PROMPT_MAX + 1);
  });

  it('내 입력이 없어도 [대화에서 직접 고르기] 는 늘 있다', () => {
    const stream = buildMemoLinkKindItems(ctx({ prompts: [] }), kindHandlers(), t)[0]!;
    expect(stream.children?.map((c) => c.id)).toEqual(['link-pick']);
  });

  it('다른 세션 ▸ — 갈 탭이 없으면 이유를 달아 흐린다(있다가 없어지는 줄 ❌)', () => {
    const h = kindHandlers();
    const session = find(buildMemoLinkKindItems(ctx(), h, t), 'link-kind-session');
    expect(session.children?.map((c) => c.label)).toEqual(['Agent', '두 번째 세션']);
    find(session.children!, 'link-session-sub-2').onClick();
    expect(h.session).toHaveBeenCalledWith({ id: 'sub-2', label: '두 번째 세션' });

    const none = find(buildMemoLinkKindItems(ctx({ sessions: [] }), kindHandlers(), t), 'link-kind-session');
    expect(none.disabled).toBe(true);
    expect(none.disabledTitle).toBe('ide.memo.link.noSessions');
    expect(none.children).toBeUndefined();
  });

  it('파일…·웹 주소… 는 더 묻는 창을 연다', () => {
    const h = kindHandlers();
    const items = buildMemoLinkKindItems(ctx(), h, t);
    find(items, 'link-kind-file').onClick();
    find(items, 'link-kind-url').onClick();
    expect(h.file).toHaveBeenCalledTimes(1);
    expect(h.url).toHaveBeenCalledTimes(1);
    expect(find(items, 'link-kind-file').label).toBe('ide.memo.link.addFile');
    expect(find(items, 'link-kind-url').label).toBe('ide.memo.link.addUrl');
  });
});

describe('우클릭 링크 항목 — 새로 걸기 / 이미 걸린 링크 위', () => {
  const kinds: ContextMenuItem[] = [{ id: 'k', label: 'k', onClick: () => {} }];
  function handlers(): MemoLinkMenuHandlers {
    return { follow: vi.fn(), remove: vi.fn(), kinds, followHint: 'Ctrl+클릭' };
  }
  const LINK: SessionMemoLink = { id: 'l', start: 0, end: 3, target: { kind: 'url', url: 'https://a.dev' } };

  it('고른 글자가 있으면 [링크 ▸] 가 종류 목록을 펼친다(글자 항목과는 구분선으로 갈린다)', () => {
    const [item] = buildMemoLinkMenuItems({ link: null, range: { start: 0, end: 3 }, replaces: false, atLimit: false }, handlers(), t);
    expect(item?.id).toBe('link');
    expect(item?.separatorBefore).toBe(true);
    expect(item?.disabled).toBeFalsy();
    expect(item?.children).toBe(kinds);
    expect(item?.note).toBeUndefined();
  });

  it('고른 글자가 없으면 흐리고 이유를 단다', () => {
    const [item] = buildMemoLinkMenuItems({ link: null, range: null, replaces: false, atLimit: false }, handlers(), t);
    expect(item?.disabled).toBe(true);
    expect(item?.disabledTitle).toBe('ide.editor.ctx.needSelection');
    expect(item?.children).toBeUndefined();
  });

  it('상한이면 흐리고 상한을 말한다', () => {
    const [item] = buildMemoLinkMenuItems({ link: null, range: { start: 0, end: 3 }, replaces: false, atLimit: true }, handlers(), t);
    expect(item?.disabled).toBe(true);
    expect(item?.disabledTitle).toBe(`ide.memo.link.limit:${JSON.stringify({ max: SESSION_MEMO.LINK_MAX })}`);
  });

  it('겹친 링크를 갈아 치우면 그 사실을 줄 아래에 적는다', () => {
    const [item] = buildMemoLinkMenuItems({ link: null, range: { start: 0, end: 3 }, replaces: true, atLimit: false }, handlers(), t);
    expect(item?.note).toBe('ide.memo.link.replacesNote');
  });

  it('링크 위에서는 [이동]·[다시 고르기 ▸]·[해제] — 다시 고르기는 같은 종류 목록을 연다', () => {
    const h = handlers();
    const items = buildMemoLinkMenuItems({ link: LINK, range: null, replaces: false, atLimit: false }, h, t);
    expect(items.map((i) => i.id)).toEqual(['link-follow', 'link-repick', 'link-remove']);
    expect(find(items, 'link-follow').hint).toBe('Ctrl+클릭');
    expect(find(items, 'link-repick').children).toBe(kinds);
    find(items, 'link-follow').onClick();
    find(items, 'link-remove').onClick();
    expect(h.follow).toHaveBeenCalledTimes(1);
    expect(h.remove).toHaveBeenCalledTimes(1);
  });
});
