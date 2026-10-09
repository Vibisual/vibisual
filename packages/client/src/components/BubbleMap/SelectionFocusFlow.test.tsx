import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Node, ReactFlowProps } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '../../stores/graphStore.js';
import { useLinkFocusStore } from '../../stores/linkFocus.js';
import { SELECTION_FOCUS } from './constants.js';
import { cancelDeferredBubbleSelect, createBubbleSelectGesture, isSelectDeferred, SELECT_DEFER_MS } from './bubbleSelectGesture.js';
import { SelectionFocusFlow } from './SelectionFocusFlow.js';

vi.mock('@xyflow/react', () => ({
  ReactFlow: (props: ReactFlowProps) => createElement('div', props),
}));

let renderer: ReactTestRenderer;
const nodes: Node[] = ['agent', 'other'].map((id) => ({
  id, type: 'bubble', position: { x: 0, y: 0 }, data: {}, selected: id === 'agent',
}));
const selectionEvent = {} as Parameters<NonNullable<ReactFlowProps['onSelectionStart']>>[0];
const paneEvent = {} as Parameters<NonNullable<ReactFlowProps['onPaneClick']>>[0];
const dragEvent = {} as Parameters<NonNullable<ReactFlowProps['onNodeDragStart']>>[0];
type KeyEvent = Parameters<NonNullable<ReactFlowProps['onKeyDownCapture']>>[0];
function flow(): ReactFlowProps { return renderer.root.findByType('div').props as ReactFlowProps; }

beforeEach(() => {
  vi.useFakeTimers();
  useGraphStore.setState({ selectIntentId: 'agent', currentFolderId: null });
  useLinkFocusStore.getState().clear();
});
afterEach(() => {
  if (renderer) act(() => renderer.unmount());
  cancelDeferredBubbleSelect();
  useGraphStore.setState({ selectIntentId: null });
  vi.useRealTimers();
});

describe('selection focus gesture ownership', () => {
  it('clears focus when marquee starts, before forwarding the caller event and measured-node callback', () => {
    const onNodesChange = vi.fn();
    const onSelectionStart = vi.fn(() => expect(useGraphStore.getState().selectIntentId).toBeNull());
    act(() => { renderer = create(createElement(SelectionFocusFlow, { nodes, onNodesChange, onSelectionStart })); });
    expect(flow().nodes?.find((node) => node.id === 'other')?.className).toContain(SELECTION_FOCUS.unrelatedNode);

    act(() => flow().onSelectionStart?.(selectionEvent));

    expect(onSelectionStart).toHaveBeenCalledExactlyOnceWith(selectionEvent);
    expect(flow().onNodesChange).toBe(onNodesChange);
    expect(flow().nodes?.every((node) => node.className === SELECTION_FOCUS.nodeTransition)).toBe(true);
  });

  it('keeps a new click focus across stale native selection, then releases it for a marquee without a caller callback', () => {
    act(() => { renderer = create(createElement(SelectionFocusFlow, { nodes, onNodesChange: vi.fn() })); });
    act(() => useGraphStore.getState().setSelectIntent('other'));
    expect(flow().nodes?.find((node) => node.id === 'agent')?.className).toContain(SELECTION_FOCUS.unrelatedNode);
    expect(flow().nodes?.find((node) => node.id === 'other')?.className).toBe(SELECTION_FOCUS.nodeTransition);

    act(() => flow().onSelectionStart?.(selectionEvent));
    expect(useGraphStore.getState().selectIntentId).toBeNull();
    expect(flow().nodes?.every((node) => node.className === SELECTION_FOCUS.nodeTransition)).toBe(true);
  });

  it('cancels a deferred click when marquee starts so its timer cannot restore the old focus', () => {
    const select = vi.fn(() => useGraphStore.getState().selectNode('other'));
    const gesture = createBubbleSelectGesture(() => ({
      doubleClickable: true,
      select,
      setIntent: (active) => useGraphStore.getState().setSelectIntent(active ? 'other' : null),
    }));
    act(() => { renderer = create(createElement(SelectionFocusFlow, { nodes, onNodesChange: vi.fn() })); });
    act(() => {
      gesture.pointerDown({ button: 0, clientX: 10, clientY: 10 });
      gesture.pointerUp();
    });
    expect(isSelectDeferred()).toBe(true);

    act(() => flow().onSelectionStart?.(selectionEvent));
    expect(isSelectDeferred()).toBe(false);
    act(() => { vi.advanceTimersByTime(SELECT_DEFER_MS * 2); });
    expect(select).not.toHaveBeenCalled();
    expect(useGraphStore.getState().selectIntentId).toBeNull();
    expect(flow().nodes?.every((node) => node.className === SELECTION_FOCUS.nodeTransition)).toBe(true);
    gesture.dispose();
  });

  it('releases an old focus when another bubble is dragged and forwards the complete drag event', () => {
    const onNodeDragStart = vi.fn();
    act(() => { renderer = create(createElement(SelectionFocusFlow, { nodes, onNodesChange: vi.fn(), onNodeDragStart })); });
    act(() => flow().onNodeDragStart?.(dragEvent, nodes[1]!, [nodes[1]!]));
    expect(useGraphStore.getState().selectIntentId).toBeNull();
    expect(flow().nodes?.every((node) => node.className === SELECTION_FOCUS.nodeTransition)).toBe(true);
    expect(onNodeDragStart).toHaveBeenCalledExactlyOnceWith(dragEvent, nodes[1], [nodes[1]]);
  });

  it.each([
    { id: 'agent', type: 'bubble' },
    { id: 'sat-agent', type: 'bubble' },
    { id: 'agent__preview', type: 'playPreviewNode' },
  ])('keeps focus when its own $id representation is dragged', ({ id, type }) => {
    const dragged = { ...nodes[0]!, id, type };
    act(() => { renderer = create(createElement(SelectionFocusFlow, { nodes, onNodesChange: vi.fn() })); });
    act(() => flow().onNodeDragStart?.(dragEvent, dragged, [dragged]));
    expect(useGraphStore.getState().selectIntentId).toBe('agent');
    expect(flow().nodes?.find((node) => node.id === 'other')?.className).toContain(SELECTION_FOCUS.unrelatedNode);
  });

  it.each(['pane', 'drag'] as const)('a %s gesture cancels the previous deferred click without letting it reselect', (gestureKind) => {
    const select = vi.fn(() => useGraphStore.getState().selectNode('agent'));
    const pending = createBubbleSelectGesture(() => ({
      doubleClickable: true,
      select,
      setIntent: (active) => useGraphStore.getState().setSelectIntent(active ? 'agent' : null),
    }));
    const onPaneClick = vi.fn();
    act(() => { renderer = create(createElement(SelectionFocusFlow, { nodes, onNodesChange: vi.fn(), onPaneClick })); });
    act(() => {
      pending.pointerDown({ button: 0, clientX: 10, clientY: 10 });
      pending.pointerUp();
    });
    act(() => {
      if (gestureKind === 'pane') flow().onPaneClick?.(paneEvent);
      else flow().onNodeDragStart?.(dragEvent, nodes[1]!, [nodes[1]!]);
    });
    expect(isSelectDeferred()).toBe(false);
    if (gestureKind === 'pane') expect(onPaneClick).toHaveBeenCalledExactlyOnceWith(paneEvent);
    act(() => { vi.advanceTimersByTime(SELECT_DEFER_MS * 2); });
    expect(select).not.toHaveBeenCalled();
    expect(useGraphStore.getState().selectIntentId).toBeNull();
    pending.dispose();
  });

  it.each(['Enter', ' ', 'Escape'])('releases click focus for native keyboard selection (%s)', (key) => {
    const onKeyDownCapture = vi.fn();
    const event = { key, target: { matches: (selector: string) => selector === '.react-flow__node.selectable' } } as unknown as KeyEvent;
    act(() => { renderer = create(createElement(SelectionFocusFlow, { nodes, onNodesChange: vi.fn(), onKeyDownCapture })); });
    act(() => flow().onKeyDownCapture?.(event));
    expect(useGraphStore.getState().selectIntentId).toBeNull();
    expect(onKeyDownCapture).toHaveBeenCalledExactlyOnceWith(event);
  });

  it.each([
    { key: 'ArrowRight', nativeNode: true, disabled: false, prevented: false },
    { key: 'Enter', nativeNode: false, disabled: false, prevented: false },
    { key: 'Enter', nativeNode: true, disabled: true, prevented: false },
    { key: 'Enter', nativeNode: true, disabled: false, prevented: true },
  ])('preserves focus when a key does not select a native node (%j)', ({ key, nativeNode, disabled, prevented }) => {
    const event = { key, defaultPrevented: prevented, target: { matches: () => nativeNode } } as unknown as KeyEvent;
    act(() => { renderer = create(createElement(SelectionFocusFlow, { nodes, onNodesChange: vi.fn(), disableKeyboardA11y: disabled })); });
    act(() => flow().onKeyDownCapture?.(event));
    expect(useGraphStore.getState().selectIntentId).toBe('agent');
  });
});
