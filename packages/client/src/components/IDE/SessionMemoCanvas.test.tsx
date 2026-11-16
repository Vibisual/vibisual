import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sanitizeSessionMemos, type SessionMemo } from '@vibisual/shared';
import { SessionMemoLayer } from './SessionMemoLayer.js';
import { SessionMemoCard } from './SessionMemoCard.js';
import { CanvasMemoBubble } from './CanvasMemoBubble.js';
import { IDEContextMenu } from './IDEContextMenu.js';
import { canvasMemoDestination } from './canvasMemoTransfer.js';

const state = vi.hoisted(() => ({
  canvasMemos: {} as Record<string, SessionMemo[]>, agentMemos: {} as Record<string, SessionMemo[]>,
  agentProjects: { agent: 'Project' }, agents: [{ id: 'agent', trashed: false }],
  subAgents: { agent: [{ id: 'sub', memos: [] as SessionMemo[] }] },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../stores/graphStore.js', () => ({ useGraphStore: Object.assign(
  (selector: (value: typeof state) => unknown) => selector(state), { getState: () => state },
) }));
vi.mock('./SessionMemoCard.js', () => ({ SessionMemoCard: () => null }));
vi.mock('./IDEContextMenu.js', () => ({ IDEContextMenu: () => null }));
vi.mock('./canvasMemoTransfer.js', async (original) => ({ ...await original<typeof import('./canvasMemoTransfer.js')>(), canvasMemoDestination: vi.fn() }));

const home = { agentId: 'agent', subAgentId: 'sub', x: 40, y: 60, folderId: null };
function note(id: string, patch: Partial<SessionMemo> = {}): SessionMemo {
  return { id, text: 'Note', x: -300, y: 200, w: 280, h: 180, color: '#1E293B', createdAt: 1, updatedAt: 1, canvas: home, ...patch };
}
let view: ReactTestRenderer | undefined;
let put: ReturnType<typeof vi.fn>;
const board = { clientWidth: 900, clientHeight: 600 } as HTMLDivElement;
const noop = (): void => {};
beforeEach(() => {
  state.canvasMemos = { Project: [note('open'), note('closed', { closedAt: 10 }), note('other-folder', { canvas: { ...home, folderId: 'folder' } })] };
  state.agentMemos = {};
  state.agents = [{ id: 'agent', trashed: false }];
  state.subAgents.agent = [{ id: 'sub', memos: [] }];
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} });
  vi.stubGlobal('requestAnimationFrame', (f: () => void) => { f(); return 1; });
  put = vi.fn(async (url: string, init: RequestInit) => ({ ok: true, json: async () => ({ ok: true, memos: url.endsWith('/move') ? [] : JSON.parse(String(init.body)).memos ?? [] }) }));
  vi.stubGlobal('fetch', put);
});
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.unstubAllGlobals(); vi.clearAllMocks(); });

function mount(canvas = true): void {
  act(() => { view = create(<SessionMemoLayer agentId="agent" sessionId={canvas ? null : 'sub'} containerRef={{ current: board }}
    spawnAt={null} onSpawnConsumed={noop} spreadRequest={null} onSpreadConsumed={noop}
    {...(canvas ? { canvas: { project: 'Project', folderId: null, scale: 2 } } : {})} />); });
}

describe('canvas memo interactions', () => {
  it('shows open notes and closed bubbles only in the current canvas folder', () => {
    mount();
    const cards = view!.root.findAllByType(SessionMemoCard);
    expect(cards.map((c) => c.props.memo.id)).toEqual(['open']);
    expect(cards[0]?.props.memo.x).toBe(-300);
    expect(cards[0]?.props.bounds).toMatchObject({ unbounded: true, scale: 2 });
    expect(view!.root.findAllByType(CanvasMemoBubble).map((b) => b.props.memo.id)).toEqual(['closed']);
  });
  it('closes a card into a bubble and reopens the same memo', async () => {
    mount();
    await act(async () => { view!.root.findByType(SessionMemoCard).props.onDelete('open'); });
    expect(view!.root.findAllByType(SessionMemoCard)).toHaveLength(0);
    expect(view!.root.findAllByType(CanvasMemoBubble)).toHaveLength(2);
    await act(async () => { view!.root.findAllByType(CanvasMemoBubble).find((b) => b.props.memo.id === 'open')!.props.onRestore('open'); });
    expect(view!.root.findByType(SessionMemoCard).props.memo).toMatchObject({ id: 'open', x: -300, y: 200 });
    expect(view!.root.findByType(SessionMemoCard).props.memo.closedAt).toBeUndefined();
  });
  it('hides return when the origin is in trash or its session no longer exists', () => {
    state.agents[0]!.trashed = true;
    mount();
    act(() => view!.root.findByType(SessionMemoCard).props.onCardMenu('open', { x: 10, y: 10 }));
    expect(view!.root.findByType(IDEContextMenu).props.items.map((i: { label: string }) => i.label)).toEqual(['ide.memo.close']);
    state.agents[0]!.trashed = false; state.subAgents.agent = [];
    act(() => view!.root.findByType(SessionMemoCard).props.onCardMenu('open', { x: 20, y: 20 }));
    expect(view!.root.findByType(IDEContextMenu).props.items.map((i: { label: string }) => i.label)).toEqual(['ide.memo.close']);
  });
  it('offers return and permanent deletion on a closed bubble', () => {
    mount();
    act(() => view!.root.findByType(CanvasMemoBubble).props.onMenu('closed', { x: 10, y: 10 }));
    expect(view!.root.findByType(IDEContextMenu).props.items.map((i: { label: string }) => i.label)).toEqual(['ide.memo.returnToSession', 'ide.memo.deleteForever']);
  });
  it('uses the server home check to offer return for a closed session kept in the archive', async () => {
    state.subAgents.agent = [];
    put.mockResolvedValue({ ok: true, json: async () => ({ returnAvailable: true }) });
    mount();
    await act(async () => { view!.root.findByType(SessionMemoCard).props.onCardMenu('open', { x: 10, y: 10 }); });
    expect(view!.root.findByType(IDEContextMenu).props.items.map((i: { label: string }) => i.label)).toContain('ide.memo.returnToSession');
    expect(put.mock.calls[0]![0]).toBe('/api/canvas-memos/home');
  });
  it('moves with the current draft text and leaves the source only after server acknowledgement', async () => {
    const source = note('source', { x: 40, y: 60 }); delete source.canvas;
    state.subAgents.agent = [{ id: 'sub', memos: [source] }];
    vi.mocked(canvasMemoDestination).mockReturnValue({ project: 'Project', folderId: null, x: -100, y: 300 });
    mount(false);
    act(() => view!.root.findByType(SessionMemoCard).props.onPatch('source', { text: 'Newest text' }, 'defer'));
    await act(async () => { expect(view!.root.findByType(SessionMemoCard).props.onCanvasDrop('source', true, { x: 10, y: 10 }, { x: 0, y: 0 })).toBe(true); });
    expect(view!.root.findAllByType(SessionMemoCard)).toHaveLength(0);
    expect(put).toHaveBeenCalledTimes(1);
    expect(JSON.parse(put.mock.calls[0]![1].body).memos[0].text).toBe('Newest text');
  });
  it('retains the source and its text if moving fails', async () => {
    const source = note('source'); delete source.canvas;
    state.subAgents.agent = [{ id: 'sub', memos: [source] }];
    vi.mocked(canvasMemoDestination).mockReturnValue({ project: 'Project', folderId: null, x: -100, y: 300 });
    put.mockResolvedValue({ ok: false });
    mount(false);
    await act(async () => { view!.root.findByType(SessionMemoCard).props.onCanvasDrop('source', true, { x: 0, y: 0 }, { x: 0, y: 0 }); });
    expect(view!.root.findByType(SessionMemoCard).props.memo.text).toBe('Note');
    expect(view!.root.findByProps({ role: 'alert' })).toBeDefined();
  });
  it.each([true, false])('transfers the visible size from a narrow session and preserves unrelated sizes, whole card %s', async (wholeCard) => {
    const source = note('source', { x: 40, y: 60, w: 1100, h: 800, groupId: 'group', groupActive: true });
    const sibling = note('sibling', { x: 40, y: 60, w: 1100, h: 800, groupId: 'group' });
    const other = note('other', { w: 1000, h: 700 });
    for (const memo of [source, sibling, other]) delete memo.canvas;
    state.subAgents.agent = [{ id: 'sub', memos: [source, sibling, other] }];
    vi.mocked(canvasMemoDestination).mockReturnValue({ project: 'Project', folderId: null, x: -100, y: 300 });
    mount(false);
    const card = view!.root.findAllByType(SessionMemoCard).find((c) => c.props.memo.id === 'source')!;
    expect(card.props.memo).toMatchObject({ w: 900, h: 600 });
    await act(async () => { card.props.onCanvasDrop('source', wholeCard, { x: 0, y: 0 }, { x: 0, y: 0 }); });
    const sent = sanitizeSessionMemos(JSON.parse(put.mock.calls[0]![1].body).memos);
    expect(sent.find((m) => m.id === 'source')).toMatchObject({ w: 900, h: 600 });
    expect(sent.find((m) => m.id === 'sibling')).toMatchObject(wholeCard ? { w: 900, h: 600 } : { w: 1100, h: 800 });
    expect(sent.find((m) => m.id === 'other')).toMatchObject({ w: 1000, h: 700 });
  });
  it.each([0.5, 1.25, 2])('keeps closed bubbles fixed size and saves world movement at zoom %s', (scale) => {
    const onMove = vi.fn();
    const memo = note('bubble');
    act(() => { view = create(<CanvasMemoBubble memo={memo} scale={scale} onMove={onMove}
      onRestore={noop} onDelete={noop} onMenu={noop} />); });
    const button = view!.root.findByType('button');
    expect(button.props.style).toMatchObject({ left: memo.x * scale, top: memo.y * scale });
    expect(button.props.className).toContain('h-12 w-12');
    const target = { style: { transform: '' }, setPointerCapture: vi.fn(), focus: vi.fn(), hasPointerCapture: () => false };
    const event = (x: number, y: number): object => ({ button: 0, pointerId: 1, clientX: x, clientY: y, stopPropagation: noop, currentTarget: target });
    act(() => button.props.onPointerDown(event(100, 100)));
    act(() => button.props.onPointerMove(event(140, 160)));
    expect(target.style.transform).toBe('translate(40px, 60px)');
    act(() => button.props.onPointerUp(event(140, 160)));
    expect(onMove).toHaveBeenCalledWith('bubble', memo.x + 40 / scale, memo.y + 60 / scale);
    expect(target.style.transform).toBe('');
  });
});
