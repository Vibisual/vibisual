import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BubbleData } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { IDEContextMenu, type ContextMenuItem } from '../IDE/IDEContextMenu.js';
import { BubbleContextMenu } from './BubbleContextMenu.js';

vi.mock('../IDE/IDEContextMenu.js', () => ({ IDEContextMenu: () => null }));
vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const initialState = useGraphStore.getState();
const setAgentLinkView = vi.fn();
const setAgentLinksPinned = vi.fn();
const replayAgentLinks = vi.fn();
let renderer: ReactTestRenderer | undefined;

function agent(extra: Partial<BubbleData> = {}): BubbleData {
  return { id: 'agent-menu', label: 'Agent', bubbleType: 'agent', path: '/project', status: 'idle', activity: 0, ...extra };
}

function mount(data: BubbleData, multiple = false): ContextMenuItem[] {
  act(() => {
    useGraphStore.setState({ agents: [data], nodeMap: { [data.id]: data }, setAgentLinkView, setAgentLinksPinned, replayAgentLinks });
    const nodes = [{ id: data.id, type: 'bubble', data }];
    if (multiple) nodes.push({ id: 'another', type: 'bubble', data: agent({ id: 'another' }) });
    renderer = create(createElement(BubbleContextMenu, { nodes, edges: [], x: 0, y: 0, onClose: vi.fn() }));
  });
  return renderer!.root.findByType(IDEContextMenu).props.items as ContextMenuItem[];
}

beforeEach(() => {
  setAgentLinkView.mockReset();
  setAgentLinksPinned.mockReset();
  replayAgentLinks.mockReset();
  useGraphStore.setState(initialState, true);
  useGraphStore.setState({ interiorView: null, currentFolderId: null, activeProject: null, pathLocks: {}, appBubbles: [] });
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  useGraphStore.setState(initialState, true);
});

describe('bubble visibility submenu', () => {
  it('groups bubble and link toggles under one expandable item, ahead of deletion', () => {
    const items = mount(agent());
    expect(items[0]?.id).toBe('bubble-visibility');
    expect(items[0]?.label).toBe('canvas.bubbleMenu.visibility');
    expect(items[0]?.children?.map((item) => item.id)).toEqual(['bubble-bubbles-hide', 'bubble-links-hide']);
    expect(items.some((item) => item.id === 'bubble-links-hide')).toBe(false);
    items[0]!.onClick();
    expect(setAgentLinkView).not.toHaveBeenCalled();
  });

  it('updates only the chosen visibility preference', () => {
    const children = mount(agent())[0]!.children!;
    children[0]!.onClick();
    expect(setAgentLinkView).toHaveBeenLastCalledWith('agent-menu', { bubblesHidden: true });
    children[1]!.onClick();
    expect(setAgentLinkView).toHaveBeenLastCalledWith('agent-menu', { hidden: true });
  });

  it('offers show actions in the same submenu for hidden bubbles and links', () => {
    const children = mount(agent({ bubblesHidden: true, linksHidden: true }))[0]!.children!;
    expect(children.map((item) => item.label)).toEqual(['canvas.bubbleMenu.showBubbles', 'canvas.bubbleMenu.showLinks']);
    children[0]!.onClick();
    expect(setAgentLinkView).toHaveBeenLastCalledWith('agent-menu', { bubblesHidden: false });
    children[1]!.onClick();
    expect(setAgentLinkView).toHaveBeenLastCalledWith('agent-menu', { hidden: false });
  });

  it('keeps the view lens outside the hide submenu when an app is linked', () => {
    useGraphStore.setState({ appBubbles: [{ id: 'app', appId: 'video', projectName: 'project', linkedAgentIds: ['agent-menu'], x: 0, y: 0, width: 208, height: 130, createdAt: 1 }] });
    const items = mount(agent());
    expect(items[0]?.children).toHaveLength(2);
    expect(items[1]?.id).toBe('bubble-lens-files');
  });

  it('does not offer single-agent visibility actions for a grouped selection', () => {
    expect(mount(agent(), true).some((item) => item.id === 'bubble-visibility')).toBe(false);
  });
});

/** §5.4 #36 (H) ①-2 — [연결된 버블 ▸]: 고정 ↔ 고정 풀기 · 이전 연결 다시 보기. */
describe('linked bubbles submenu', () => {
  function linked(data: BubbleData): ContextMenuItem {
    const item = mount(data).find((i) => i.id === 'bubble-linked');
    if (!item) throw new Error('linked bubbles submenu missing');
    return item;
  }

  it('closes the view group after the hide submenu (and the lens line), ahead of deletion', () => {
    const items = mount(agent());
    expect(items.map((i) => i.id).slice(0, 2)).toEqual(['bubble-visibility', 'bubble-linked']);
    expect(items[1]?.label).toBe('canvas.bubbleMenu.linkedBubbles');
    expect(items[1]?.children?.map((i) => i.id)).toEqual(['bubble-links-pin', 'bubble-links-replay']);
    // 부모를 눌러도 아무 일도 하지 않는다 — 하위 메뉴만 연다.
    items[1]!.onClick();
    expect(setAgentLinksPinned).not.toHaveBeenCalled();
    expect(replayAgentLinks).not.toHaveBeenCalled();

    useGraphStore.setState({ appBubbles: [{ id: 'app', appId: 'video', projectName: 'project', linkedAgentIds: ['agent-menu'], x: 0, y: 0, width: 208, height: 130, createdAt: 1 }] });
    act(() => renderer?.unmount());
    expect(mount(agent()).map((i) => i.id).slice(0, 3)).toEqual(['bubble-visibility', 'bubble-lens-files', 'bubble-linked']);
  });

  it('pins, and the same row unpins once pinned — the note says whether it clears now', () => {
    const [pin] = linked(agent()).children!;
    expect(pin?.label).toBe('canvas.bubbleMenu.pinLinks');
    expect(pin?.note).toBe('canvas.bubbleMenu.pinLinksNote');
    pin!.onClick();
    expect(setAgentLinksPinned).toHaveBeenLastCalledWith('agent-menu', true);

    act(() => renderer?.unmount());
    const [unpinIdle] = linked(agent({ linksPinned: true, status: 'completed' })).children!;
    expect(unpinIdle?.id).toBe('bubble-links-unpin');
    expect(unpinIdle?.label).toBe('canvas.bubbleMenu.unpinLinks');
    expect(unpinIdle?.note).toBe('canvas.bubbleMenu.unpinLinksNote');
    unpinIdle!.onClick();
    expect(setAgentLinksPinned).toHaveBeenLastCalledWith('agent-menu', false);

    act(() => renderer?.unmount());
    const [unpinRunning] = linked(agent({ linksPinned: true, status: 'active' })).children!;
    expect(unpinRunning?.note).toBe('canvas.bubbleMenu.unpinLinksRunningNote');
  });

  it('re-show is disabled with a visible reason when nothing was cleared yet or while running', () => {
    const [, empty] = linked(agent()).children!;
    expect(empty?.disabled).toBe(true);
    expect(empty?.note).toBe('canvas.bubbleMenu.replayLinksEmpty');
    expect(empty?.disabledTitle).toBe('canvas.bubbleMenu.replayLinksEmpty');

    act(() => renderer?.unmount());
    const [, running] = linked(agent({ status: 'active', prevLinkCount: 3 })).children!;
    expect(running?.disabled).toBe(true);
    expect(running?.note).toBe('canvas.bubbleMenu.replayLinksRunning');
  });

  it('re-shows the remembered links when there is something to show', () => {
    const [, replay] = linked(agent({ status: 'idle', prevLinkCount: 3 })).children!;
    expect(replay?.disabled).toBe(false);
    expect(replay?.note).toBe('canvas.bubbleMenu.replayLinksNote');
    replay!.onClick();
    expect(replayAgentLinks).toHaveBeenCalledWith('agent-menu');
  });

  it('is single-agent only — a grouped selection does not offer it', () => {
    expect(mount(agent(), true).some((item) => item.id === 'bubble-linked')).toBe(false);
  });
});
