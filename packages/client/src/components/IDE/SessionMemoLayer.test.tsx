import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionMemo } from '@vibisual/shared';
import { SessionMemoLayer } from './SessionMemoLayer.js';
import { SessionMemoCard } from './SessionMemoCard.js';
import { SessionMemoHistory } from './SessionMemoHistory.js';
import { IDEContextMenu, type ContextMenuItem } from './IDEContextMenu.js';
import { MemoLinkUrlEditor } from './MemoLinkEditors.js';
import type { MemoLinkHost } from './useMemoLinkHost.js';

const state = vi.hoisted(() => ({
  memos: [] as SessionMemo[],
  sessions: {} as Record<string, SessionMemo[]>,
  t: (key: string) => key,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: state.t }) }));
vi.mock('../../stores/graphStore.js', () => ({
  useGraphStore: (selector: (value: unknown) => unknown) => selector({
    agentMemos: { agent: state.memos },
    subAgents: { agent: Object.entries(state.sessions).map(([id, memos]) => ({ id, memos })) },
  }),
}));
vi.mock('./SessionMemoCard.js', () => ({ SessionMemoCard: () => null }));
vi.mock('./SessionMemoHistory.js', () => ({ SessionMemoHistory: () => null }));
vi.mock('./IDEContextMenu.js', () => ({ IDEContextMenu: () => null }));
vi.mock('./MemoLinkEditors.js', () => ({ MemoLinkFileEditor: () => null, MemoLinkUrlEditor: () => null }));
vi.mock('./bookmarkScroll.js', () => ({ resolveAnchorIdFromSelection: () => 'evt-selected' }));

class TestElement extends EventTarget {
  style: Record<string, string> = {};
  clientWidth = 900;
  clientHeight = 600;
  textContent = 'A conversation entry';
  constructor(readonly kind: 'board' | 'item' | 'memo' | 'control', readonly parentElement: TestElement | null = null) { super(); }
  contains(node: TestElement | null): boolean {
    return node === this || !!node?.parentElement && this.contains(node.parentElement);
  }
  closest(selector: string): TestElement | null {
    if (selector === '[data-stream-item-id]') return this.kind === 'item' ? this : this.parentElement?.closest(selector) ?? null;
    if (selector.includes('[data-session-memo]')) return this.kind === 'memo' ? this : this.parentElement?.closest(selector) ?? null;
    return this.kind === 'control' ? this : this.parentElement?.closest(selector) ?? null;
  }
  getAttribute(name: string): string | null { return name === 'data-stream-item-id' && this.kind === 'item' ? 'evt-entry' : null; }
  querySelector(): null { return null; }
}

let view: ReactTestRenderer | undefined;
let board: TestElement;
let item: TestElement;
let doc: EventTarget & { activeElement: null };
let browser: EventTarget & { getSelection: ReturnType<typeof vi.fn> };
let host: MemoLinkHost;
let put: ReturnType<typeof vi.fn>;
const noop = () => {};

beforeEach(() => {
  vi.useFakeTimers();
  state.memos = [{ id: 'memo-one', text: 'build log', x: 0, y: 0, w: 280, h: 180, color: '#1E293B', createdAt: 1, updatedAt: 1 }];
  state.sessions = {};
  board = new TestElement('board');
  item = new TestElement('item', board);
  doc = Object.assign(new EventTarget(), { activeElement: null });
  browser = Object.assign(new EventTarget(), { getSelection: vi.fn(() => null) });
  host = {
    prompts: () => [{ id: 'cmd-build', text: 'Run a build', at: 1 }],
    sessions: () => [],
    sessionInfo: () => ({ alive: true, label: 'Session' }),
    formatTime: () => '12:00',
    rootPath: () => '/workspace',
    open: vi.fn(async () => true),
  };
  put = vi.fn(async (_url: string, init: RequestInit) => ({
    json: async () => ({ ok: true, memos: JSON.parse(String(init.body)).memos }),
  }));
  vi.stubGlobal('fetch', put);
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('Element', TestElement);
  vi.stubGlobal('HTMLElement', TestElement);
  vi.stubGlobal('HTMLTextAreaElement', TestElement);
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 16));
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  act(() => {
    view = create(<SessionMemoLayer agentId="agent" sessionId={null} containerRef={{ current: board as unknown as HTMLDivElement }}
      spawnAt={null} onSpawnConsumed={noop} spreadRequest={null} onSpreadConsumed={noop} linkHost={host} />);
  });
});
afterEach(() => {
  act(() => view?.unmount());
  view = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function card() { return view!.root.findByType(SessionMemoCard); }
function openMenu(start = 0, end = 5): ContextMenuItem[] {
  act(() => card().props.onTextMenu('memo-one', {
    x: 10, y: 10, el: { value: card().props.memo.text, readOnly: false }, sel: { start, end },
  }));
  return view!.root.findByType(IDEContextMenu).props.items as ContextMenuItem[];
}
function choose(id: string, items = openMenu()): void {
  const find = (rows: ContextMenuItem[]): ContextMenuItem | undefined => {
    for (const row of rows) {
      if (row.id === id) return row;
      const nested = row.children && find(row.children);
      if (nested) return nested;
    }
  };
  const action = find(items)!;
  expect(action).toBeDefined();
  act(() => action.onClick());
}
function mouse(type: string, target = item): Event {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, { target: { value: target }, button: { value: 0 } });
  act(() => { doc.dispatchEvent(event); });
  return event;
}
function flushPick(): void { act(() => { vi.advanceTimersByTime(0); }); }
function saved(): SessionMemo { return JSON.parse(String(put.mock.calls.at(-1)![1].body)).memos[0]; }

function renderSession(sessionId: string | null): void {
  act(() => {
    view!.update(<SessionMemoLayer agentId="agent" sessionId={sessionId} containerRef={{ current: board as unknown as HTMLDivElement }}
      spawnAt={null} onSpawnConsumed={noop} spreadRequest={null} onSpreadConsumed={noop} linkHost={host} />);
  });
}

function savedList(): SessionMemo[] { return JSON.parse(String(put.mock.calls.at(-1)![1].body)).memos; }

describe('closed memo history in the real layer', () => {
  it('keeps the last closed memo and exposes a restore control even with no open card', () => {
    const original = card().props.memo;
    act(() => card().props.onDelete('memo-one'));
    expect(view!.root.findAllByType(SessionMemoCard)).toHaveLength(0);
    expect(savedList()).toEqual([expect.objectContaining({ ...original, updatedAt: expect.any(Number), closedAt: expect.any(Number) })]);
    const history = view!.root.findByType(SessionMemoHistory);
    expect(history.props.closedMemos[0].id).toBe('memo-one');
    act(() => history.props.onRestore('memo-one'));
    expect(card().props.memo.text).toBe(original.text);
    expect(card().props.autoFocus).toBe(true);
    expect(card().props.closedMemos).toHaveLength(0);
    expect(savedList()[0]?.closedAt).toBeUndefined();
  });

  it('preserves archived content when another open memo is edited and reloaded', () => {
    const archived = { ...state.memos[0]!, id: 'closed', text: 'closed content', closedAt: 10 };
    state.memos = [...state.memos, archived];
    renderSession(null);
    const history = card().props.closedMemos;
    act(() => card().props.onPatch('memo-one', { text: 'updated' }, 'now'));
    expect(card().props.closedMemos).toBe(history);
    expect(savedList()).toEqual([expect.objectContaining({ text: 'updated' }), archived]);
    state.memos = savedList();
    act(() => view!.unmount());
    act(() => {
      view = create(<SessionMemoLayer agentId="agent" sessionId={null} containerRef={{ current: board as unknown as HTMLDivElement }}
        spawnAt={null} onSpawnConsumed={noop} spreadRequest={null} onSpreadConsumed={noop} />);
    });
    expect(card().props.closedMemos).toEqual([archived]);
    act(() => card().props.onRestore('closed'));
    expect(view!.root.findAllByType(SessionMemoCard).map((c) => c.props.memo.text)).toEqual(['updated', 'closed content']);
    expect(savedList()).toHaveLength(2);
    expect(savedList().every((m) => m.closedAt === undefined)).toBe(true);
  });

  it('uses only the current session history and sends the restore to its owner', () => {
    const memo = state.memos[0]!;
    state.sessions = {
      first: [{ ...memo, id: 'first-closed', closedAt: 10 }],
      second: [{ ...memo, id: 'second-closed', closedAt: 20 }],
    };
    renderSession('first');
    expect(view!.root.findByType(SessionMemoHistory).props.closedMemos.map((m: SessionMemo) => m.id)).toEqual(['first-closed']);
    renderSession('second');
    const history = view!.root.findByType(SessionMemoHistory);
    expect(history.props.closedMemos.map((m: SessionMemo) => m.id)).toEqual(['second-closed']);
    act(() => history.props.onRestore('second-closed'));
    expect(JSON.parse(String(put.mock.calls.at(-1)![1].body)).subAgentId).toBe('second');
    expect(savedList().map((m) => m.id)).toEqual(['second-closed']);
    expect(card().props.memo.id).toBe('second-closed');
    renderSession('first');
    expect(view!.root.findByType(SessionMemoHistory).props.closedMemos.map((m: SessionMemo) => m.id)).toEqual(['first-closed']);
  });
});

describe('memo link interactions in the real layer', () => {
  it('adds the first target kind from the prompt list, retargets it, and removes only the link', () => {
    const items = openMenu();
    expect(items.find((row) => row.id === 'link')?.children?.[0]?.id).toBe('link-kind-stream');
    choose('link-prompt-cmd-build', items);
    const link = saved().links![0]!;
    expect(link).toMatchObject({ start: 0, end: 5, target: { kind: 'stream', sessionId: null, anchorId: 'cmd-build', text: 'Run a build' } });
    choose('link-kind-url');
    act(() => view!.root.findByType(MemoLinkUrlEditor).props.onApply({ kind: 'url', url: 'https://example.com' }));
    expect(saved().links).toEqual([{ ...link, target: { kind: 'url', url: 'https://example.com' } }]);
    choose('link-remove');
    expect(saved().text).toBe('build log');
    expect(saved().links).toBeUndefined();
  });

  it('picks a conversation entry while suppressing its original click action', () => {
    choose('link-pick');
    mouse('mouseup');
    expect(mouse('click').defaultPrevented).toBe(true);
    expect(put).not.toHaveBeenCalled();
    flushPick();
    expect(saved().links![0]!.target).toEqual({ kind: 'stream', sessionId: null, anchorId: 'evt-entry', text: 'A conversation entry' });
    expect(mouse('click').defaultPrevented).toBe(false);
  });

  it('does not save a pending pick after the layer has unmounted', () => {
    choose('link-pick');
    mouse('mouseup');
    act(() => view!.unmount());
    view = undefined;
    flushPick();
    expect(put).not.toHaveBeenCalled();
  });

  it('cancels the scheduled pick with Escape and leaves the original text intact', () => {
    choose('link-pick');
    mouse('mouseup');
    const escape = new Event('keydown', { cancelable: true });
    Object.defineProperty(escape, 'key', { value: 'Escape' });
    act(() => { browser.dispatchEvent(escape); });
    flushPick();
    expect(escape.defaultPrevented).toBe(true);
    expect(put).not.toHaveBeenCalled();
    expect(card().props.memo.text).toBe('build log');
  });

  it.each(['other pane', 'memo'] as const)('does not capture a selection extending into %s', (end) => {
    choose('link-pick');
    browser.getSelection.mockReturnValue({
      isCollapsed: false, anchorNode: item,
      focusNode: end === 'memo' ? new TestElement('memo', board) : new TestElement('item'),
      toString: () => 'Conversation plus unrelated content', removeAllRanges: vi.fn(),
    });
    mouse('mouseup');
    flushPick();
    expect(put).not.toHaveBeenCalled();
    expect(card().props.pickRange).toEqual({ start: 0, end: 5 });
  });

  it('records a selected conversation passage with its anchor', () => {
    choose('link-pick');
    browser.getSelection.mockReturnValue({ isCollapsed: false, anchorNode: item, focusNode: item,
      toString: () => 'Selected passage', removeAllRanges: vi.fn() });
    mouse('mouseup');
    flushPick();
    expect(saved().links![0]!.target).toEqual({ kind: 'stream', sessionId: null, anchorId: 'evt-selected', text: 'Selected passage' });
  });

  it.each([0, 4])('tracks the exact repeated-text selection while choosing a target (start %s)', (start) => {
    act(() => card().props.onPatch('memo-one', { text: 'foo foo' }, 'defer'));
    choose('link-pick', openMenu(start, start + 3));
    act(() => card().props.onPatch('memo-one', { text: 'foo' }, 'defer', { start: 0, end: 4, inputType: 'deleteContentBackward' }));
    expect(card().props.pickRange).toEqual(start === 0 ? null : { start: 0, end: 3 });
    mouse('mouseup');
    flushPick();
    if (start === 0) expect(put).not.toHaveBeenCalled();
    else expect(saved().links![0]).toMatchObject({ start: 0, end: 3, target: { kind: 'stream', anchorId: 'evt-entry' } });
  });

  it('reports a rejected navigation as failure without losing the link', async () => {
    choose('link-prompt-cmd-build');
    const link = saved().links![0]!;
    vi.mocked(host.open).mockRejectedValueOnce(new Error('offline'));
    await expect(card().props.onLinkFollow('memo-one', link.id)).resolves.toBe(false);
    expect(card().props.memo.links).toHaveLength(1);
  });
});
