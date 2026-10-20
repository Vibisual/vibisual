import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_MEMO, type SessionMemo } from '@vibisual/shared';
import { SessionMemoHistory } from './SessionMemoHistory.js';
import { IDEContextMenu, type ContextMenuItem } from './IDEContextMenu.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, vars?: { n?: number; max?: number }) => `${key}${vars ? `:${vars.n ?? vars.max}` : ''}` }),
}));
// Dismissal, keyboard navigation and viewport placement are covered by IDEContextMenu.test.tsx.
vi.mock('./IDEContextMenu.js', () => ({ IDEContextMenu: () => null }));

let view: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => view?.unmount());
  view = undefined;
  vi.useRealTimers();
});

function memo(id: string, text: string, name?: string): SessionMemo {
  return { id, text, name, x: 0, y: 0, w: 220, h: 140, color: '#334155', createdAt: 1, updatedAt: 1 };
}
function mount(closedMemos: SessionMemo[], restoreDisabled = false): ReturnType<typeof vi.fn> {
  const restore = vi.fn();
  act(() => {
    view = create(<SessionMemoHistory closedMemos={closedMemos} onRestore={restore} restoreDisabled={restoreDisabled} />, {
      createNodeMock: () => ({ getBoundingClientRect: () => ({ left: 120, bottom: 80 }) }),
    });
  });
  return restore;
}
function open(): void { act(() => view!.root.findByType('button').props.onClick()); }
function menu(): { items: ContextMenuItem[]; onClose: () => void; x: number; y: number } {
  return view!.root.findByType(IDEContextMenu).props;
}

describe('closed session memo history', () => {
  it('keeps an empty header control discoverable without opening an empty menu', () => {
    mount([]);
    const button = view!.root.findByType('button');
    expect(button.props.disabled).toBe(true);
    expect(button.props.title).toContain('ide.memo.history.empty');
    expect(button.props['aria-haspopup']).toBe('menu');
    open();
    expect(button.props['aria-expanded']).toBe(false);
    expect(view!.root.findAllByType(IDEContextMenu)).toHaveLength(0);
  });

  it('uses supplied newest-first history and restores only the chosen memo', () => {
    const restore = mount([memo('named', 'Body', 'Named memo'), memo('first-line', 'First line\nSecond line'), memo('blank', '')]);
    open();
    const popup = menu();
    expect(popup.x).toBe(120);
    expect(popup.y).toBe(84);
    expect(popup.items.map((item) => item.label)).toEqual([
      'ide.memo.history.title', 'Named memo', 'First line', 'ide.memo.title',
    ]);
    expect(popup.items[0].note).toBe('ide.memo.history.help');
    expect(view!.root.findByType('button').props['aria-label']).toBe('ide.memo.history.count:3');
    act(() => { popup.items[2].onClick(); popup.onClose(); });
    expect(restore).toHaveBeenCalledExactlyOnceWith('first-line');
    expect(view!.root.findAllByType(IDEContextMenu)).toHaveLength(0);
  });

  it('keeps history readable at the open-memo cap and explains why restoration is disabled', () => {
    const restore = mount([memo('closed', 'Saved memo')], true);
    open();
    const items = menu().items;
    const reason = `ide.memo.history.limit:${SESSION_MEMO.MAX_PER_OWNER}`;
    expect(items[0].note).toBe(reason);
    expect(items[1].disabled).toBe(true);
    expect(items[1].disabledTitle).toBe(reason);
    act(() => items[1].onClick());
    expect(restore).not.toHaveBeenCalled();
  });

  it('does not reopen from the same trigger click that dismissed the menu', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    mount([memo('closed', 'Saved memo')]);
    open();
    act(() => menu().onClose());
    open();
    expect(view!.root.findAllByType(IDEContextMenu)).toHaveLength(0);
    vi.advanceTimersByTime(201);
    open();
    expect(view!.root.findAllByType(IDEContextMenu)).toHaveLength(1);
  });

  it('keeps history gestures out of card dragging and the conversation menu or acknowledgement', () => {
    mount([memo('closed', 'Saved memo')]);
    const boundary = view!.root.findAllByType('span').find((span) => span.props.className === 'contents')!;
    const stopPropagation = vi.fn();
    const preventDefault = vi.fn();
    boundary.props.onPointerDown({ stopPropagation });
    boundary.props.onDoubleClick({ stopPropagation });
    boundary.props.onClick({ stopPropagation });
    boundary.props.onContextMenu({ stopPropagation, preventDefault });
    expect(stopPropagation).toHaveBeenCalledTimes(4);
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('forgets its open popup when history becomes empty', () => {
    const restore = mount([memo('closed', 'Saved memo')]);
    open();
    act(() => view!.update(<SessionMemoHistory closedMemos={[]} onRestore={restore} />));
    act(() => view!.update(<SessionMemoHistory closedMemos={[memo('new', 'Newly closed')]} onRestore={restore} />));
    expect(view!.root.findAllByType(IDEContextMenu)).toHaveLength(0);
  });
});
