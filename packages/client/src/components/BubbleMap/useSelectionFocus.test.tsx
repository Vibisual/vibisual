import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Edge, Node } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '../../stores/graphStore.js';
import { useLinkFocusStore } from '../../stores/linkFocus.js';
import { computeLinkGroup } from './linkedBubbles.js';
import { createBubbleSelectGesture, SELECT_DEFER_MS } from './bubbleSelectGesture.js';
import { SELECTION_FOCUS } from './constants.js';
import { useSelectionFocus } from './useSelectionFocus.js';

type Gesture = ReturnType<typeof createBubbleSelectGesture>;

const makeNode = (id: string): Node => ({ id, type: 'bubble', position: { x: 0, y: 0 }, data: {} });
const nodeAt = (emphasis: string): string => `${SELECTION_FOCUS.nodeTransition} ${emphasis}`;
const edgeAt = (emphasis: string): string => `${SELECTION_FOCUS.edgeTransition} ${emphasis}`;
const RESTORED_NODE = nodeAt(SELECTION_FOCUS.restore);
const RESTORED_EDGE = edgeAt(SELECTION_FOCUS.restore);
const PRESS = { button: 0, clientX: 10, clientY: 10 };

let nodes: Node[];
let edges: Edge[];
let result: ReturnType<typeof useSelectionFocus>;
let renderer: ReactTestRenderer;
/** Node classes of every render — a flash can live in one frame that no later assertion sees. */
let frames: (string | undefined)[][];
let gestures: Gesture[];
function Probe(): null {
  result = useSelectionFocus(nodes, edges);
  frames.push(result.nodes.map((node) => node.className));
  return null;
}
function render(): void { act(() => renderer.update(createElement(Probe))); }
function select(id: string | null): void { act(() => useGraphStore.getState().selectNode(id)); }
function nodeClass(id: string): string | undefined { return result.nodes.find((node) => node.id === id)?.className; }
const allLit = (frame: (string | undefined)[]): boolean => frame.every((className) => className === RESTORED_NODE);

/** A bubble with a double-click action, wired the way BubbleNode wires its gesture. */
function doubleClickableBubble(id: string): Gesture {
  const gesture = createBubbleSelectGesture(() => ({
    doubleClickable: true,
    select: () => useGraphStore.getState().selectNode(id),
    setIntent: (active) => useGraphStore.getState().setSelectIntent(active ? id : null),
  }));
  gestures.push(gesture);
  return gesture;
}
function click(gesture: Gesture): void { act(() => { gesture.pointerDown(PRESS); gesture.pointerUp(); }); }
function wait(ms: number): void { act(() => { vi.advanceTimersByTime(ms); }); }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  nodes = ['agent', 'folder', 'file', 'other'].map(makeNode);
  edges = [
    { id: 'direct', source: 'agent', target: 'folder', type: 'taskEdge', data: { command: 'keep' } },
    { id: 'indirect', source: 'folder', target: 'file' },
  ];
  frames = [];
  gestures = [];
  useGraphStore.setState({ selectIntentId: null, currentFolderId: null });
  useLinkFocusStore.getState().clear();
  act(() => { renderer = create(createElement(Probe)); });
});
afterEach(() => {
  // The deferred-click count is module-wide: a pending timer left behind would hold every later test.
  for (const gesture of gestures) gesture.dispose();
  act(() => renderer.unmount());
  useGraphStore.getState().selectNode(null);
  useLinkFocusStore.getState().clear();
  vi.useRealTimers();
});

describe('selection focus presentation', () => {
  it('uses immediate intent and includes the task-edge portal without mutating the graph', () => {
    act(() => useGraphStore.getState().setSelectIntent('agent'));
    expect(nodeClass('agent')).toBe(nodeAt(SELECTION_FOCUS.nodes[0]));
    expect(nodeClass('folder')).toBe(nodeAt(SELECTION_FOCUS.nodes[1]));
    expect(nodeClass('file')).toBe(nodeAt(SELECTION_FOCUS.nodes[2]));
    expect(nodeClass('other')).toBe(nodeAt(SELECTION_FOCUS.unrelatedNode));
    expect(result.edges[1]?.className).toBe(edgeAt(SELECTION_FOCUS.edges[2]));
    expect(result.edges[0]?.data?.selectionFocusClassName).toBe(edgeAt(SELECTION_FOCUS.edges[1]));
    expect(result.edges[0]?.data?.command).toBe('keep');
    expect(edges[0]?.data).toEqual({ command: 'keep' });
    expect(nodes.every((node) => node.className === undefined)).toBe(true);
  });

  it('allows a dimmed node to become the new center and restores after deselection', () => {
    select('agent');
    select('other');
    expect(nodeClass('other')).toBe(nodeAt(SELECTION_FOCUS.nodes[0]));
    expect(nodeClass('agent')).toBe(nodeAt(SELECTION_FOCUS.unrelatedNode));
    select(null);
    expect(result.nodes.every((node) => node.className === RESTORED_NODE)).toBe(true);
    expect(result.edges.every((edge) => edge.className === RESTORED_EDGE)).toBe(true);
  });

  it('recomputes new connections and clears focus when the selected node leaves the view', () => {
    select('agent');
    edges = [...edges, { id: 'new', source: 'agent', target: 'other' }];
    render();
    expect(nodeClass('other')).toBe(nodeAt(SELECTION_FOCUS.nodes[1]));
    nodes = nodes.filter((node) => node.id !== 'agent');
    render();
    expect(result.nodes.every((node) => node.className === RESTORED_NODE)).toBe(true);
  });

  it('suspends for group hover/grab and resumes the current selection afterward', () => {
    select('agent');
    act(() => useLinkFocusStore.getState().focus(computeLinkGroup('folder', edges), 'hover'));
    expect(nodeClass('other')).toBe(RESTORED_NODE);
    act(() => useLinkFocusStore.getState().promoteToGrab('folder'));
    expect(nodeClass('other')).toBe(RESTORED_NODE);
    act(() => useLinkFocusStore.getState().clear());
    expect(nodeClass('other')).toBe(nodeAt(SELECTION_FOCUS.unrelatedNode));
  });

  it('restores all nodes during native multi-selection and edge selection', () => {
    select('agent');
    nodes = nodes.map((node) => ({ ...node, selected: node.id === 'agent' || node.id === 'folder' }));
    render();
    expect(nodeClass('other')).toBe(RESTORED_NODE);
    nodes = nodes.map((node) => ({ ...node, selected: false }));
    edges = edges.map((edge) => ({ ...edge, selected: true }));
    render();
    expect(nodeClass('other')).toBe(RESTORED_NODE);
  });

  it('does not keep the previous click focus when a marquee selects another single node', () => {
    select('agent');
    nodes = nodes.map((node) => ({ ...node, selected: node.id === 'other' }));
    render();
    expect(nodeClass('agent')).toBe(RESTORED_NODE);
    expect(nodeClass('other')).toBe(RESTORED_NODE);
  });

  it('reuses unchanged node and edge objects when another item receives a physics update', () => {
    select('agent');
    const unchangedNode = result.nodes[1];
    const unchangedEdge = result.edges[1];
    nodes = nodes.map((node) => node.id === 'agent' ? { ...node, position: { x: 50, y: 50 } } : node);
    edges = edges.map((edge) => edge.id === 'direct' ? { ...edge, data: { command: 'updated' } } : edge);
    render();
    expect(result.nodes[1]).toBe(unchangedNode);
    expect(result.edges[1]).toBe(unchangedEdge);
  });

  it('keeps geometry, existing styles, and the edge presentation stable during physics frames', () => {
    nodes[0] = { ...nodes[0]!, className: 'existing-node', style: { opacity: 0.35 }, measured: { width: 80, height: 80 } };
    select('agent');
    render();
    const edgePresentation = result.edges;
    nodes = nodes.map((node) => ({ ...node, position: { x: 100, y: 200 } }));
    render();
    expect(result.edges).toBe(edgePresentation);
    expect(result.nodes[0]?.position).toEqual({ x: 100, y: 200 });
    expect(result.nodes[0]?.measured).toEqual({ width: 80, height: 80 });
    expect(result.nodes[0]?.style).toEqual({ opacity: 0.35 });
    expect(nodeClass('agent')).toBe(`existing-node ${nodeAt(SELECTION_FOCUS.nodes[0])}`);
  });
});

describe('selection focus motion', () => {
  it('gives every state exactly one duration, so no two durations race on one element', () => {
    const states = [SELECTION_FOCUS.restore, ...SELECTION_FOCUS.nodes, ...SELECTION_FOCUS.edges,
      SELECTION_FOCUS.unrelatedNode, SELECTION_FOCUS.unrelatedEdge];
    for (const state of states) expect(state.match(/(^|\s)duration-/g)).toHaveLength(1);
    expect(SELECTION_FOCUS.nodeTransition).not.toMatch(/(^|\s)duration-/);
    expect(SELECTION_FOCUS.edgeTransition).not.toMatch(/(^|\s)duration-/);
  });

  it('never dims the map for a double-click', () => {
    const agent = doubleClickableBubble('agent');
    click(agent);
    expect(useGraphStore.getState().selectIntentId).toBe('agent');
    wait(80);
    act(() => { agent.pointerDown(PRESS); agent.pointerUp(); agent.cancelPendingSelect(); });
    wait(SELECT_DEFER_MS * 4);
    expect(useGraphStore.getState().selectIntentId).toBeNull();
    expect(frames.every(allLit)).toBe(true);
  });

  it('holds the previous focus while a click waits out the double-click window, lifting the pressed bubble', () => {
    select('agent');
    const focused = frames.length;
    const other = doubleClickableBubble('other');
    click(other);
    // React Flow moves its native selection on the same click, long before the deferred select.
    nodes = nodes.map((node) => ({ ...node, selected: node.id === 'other' }));
    render();
    expect(nodeClass('agent')).toBe(nodeAt(SELECTION_FOCUS.nodes[0]));
    expect(nodeClass('file')).toBe(nodeAt(SELECTION_FOCUS.nodes[2]));
    expect(nodeClass('other')).toBe(nodeAt(SELECTION_FOCUS.nodes[0]));

    wait(SELECT_DEFER_MS);
    expect(nodeClass('other')).toBe(nodeAt(SELECTION_FOCUS.nodes[0]));
    expect(nodeClass('agent')).toBe(nodeAt(SELECTION_FOCUS.unrelatedNode));
    expect(frames.slice(focused).some(allLit)).toBe(false);
  });

  it('releases the held focus once when the second click turns the press into a double-click', () => {
    select('agent');
    const other = doubleClickableBubble('other');
    click(other);
    expect(nodeClass('agent')).toBe(nodeAt(SELECTION_FOCUS.nodes[0]));
    const pressed = frames.length;
    act(() => { other.pointerDown(PRESS); other.pointerUp(); other.cancelPendingSelect(); });
    wait(SELECT_DEFER_MS * 4);
    // The ring is gone, so the focus it anchored goes with it — in one step, never lit-dim-lit.
    const after = frames.slice(pressed);
    const litFrom = after.findIndex(allLit);
    expect(litFrom).toBeGreaterThanOrEqual(0);
    expect(after.slice(litFrom).every(allLit)).toBe(true);
  });

  it('moves from a native bubble to a store-owned bubble without an all-lit frame', () => {
    nodes = [...nodes, { id: 'app', type: 'appNode', position: { x: 0, y: 0 }, data: {} }];
    select('agent');
    nodes = nodes.map((node) => ({ ...node, selected: node.id === 'agent' }));
    render();
    const focused = frames.length;
    // The store channel takes the selection first; the canvas drops the native leftover after paint.
    act(() => useGraphStore.getState().selectAppBubble('app'));
    expect(nodeClass('app')).toBe(nodeAt(SELECTION_FOCUS.nodes[0]));
    expect(nodeClass('agent')).toBe(nodeAt(SELECTION_FOCUS.unrelatedNode));
    nodes = nodes.map((node) => ({ ...node, selected: false }));
    render();
    expect(nodeClass('app')).toBe(nodeAt(SELECTION_FOCUS.nodes[0]));
    expect(frames.slice(focused).some(allLit)).toBe(false);
  });
});
