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
let renderer: ReactTestRenderer | undefined;

function agent(extra: Partial<BubbleData> = {}): BubbleData {
  return { id: 'agent-menu', label: 'Agent', bubbleType: 'agent', path: '/project', status: 'idle', activity: 0, ...extra };
}

function mount(data: BubbleData, multiple = false): ContextMenuItem[] {
  act(() => {
    useGraphStore.setState({ agents: [data], nodeMap: { [data.id]: data }, setAgentLinkView });
    const nodes = [{ id: data.id, type: 'bubble', data }];
    if (multiple) nodes.push({ id: 'another', type: 'bubble', data: agent({ id: 'another' }) });
    renderer = create(createElement(BubbleContextMenu, { nodes, edges: [], x: 0, y: 0, onClose: vi.fn() }));
  });
  return renderer!.root.findByType(IDEContextMenu).props.items as ContextMenuItem[];
}

beforeEach(() => {
  setAgentLinkView.mockReset();
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
