import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Node, ReactFlowInstance } from '@xyflow/react';
import type { BubbleEdgeStyle } from '@vibisual/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskEdgeDragPreview } from './TaskEdgeDragPreview.js';
import { TaskEdgePopupPreview } from './TaskEdgePopupPreview.js';
import { bubbleEdgeAppearance } from './bubbleEdgeAppearance.js';
import { computeTaskEdgePath } from './taskEdgePath.js';

const state = vi.hoisted(() => ({
  userDefaults: { appearance: { edgeStyle: 'dash' } },
  bubbleAppearancePending: null as null | { edgeStyle: string },
  taskEdgeDrag: { sourceId: 'source', mouseX: 700, mouseY: 400 },
}));
vi.mock('../../stores/graphStore.js', () => ({ useGraphStore: (select: (s: typeof state) => unknown) => select(state) }));

const variants: BubbleEdgeStyle[] = ['wire', 'dash', 'beads', 'glow', 'rail'];
const renderers: ReactTestRenderer[] = [];
const nodes: Node[] = [
  { id: 'source', position: { x: 10, y: 20 }, measured: { width: 90, height: 90 }, data: {} },
  { id: 'target', position: { x: 310, y: 220 }, measured: { width: 90, height: 90 }, data: {} },
];
const common = {
  flowNodes: nodes,
  rfRef: { current: { getViewport: () => ({ x: 12, y: 18, zoom: 2 }) } as ReactFlowInstance },
  rfContainerRef: { current: {
    querySelector: () => ({ getBoundingClientRect: () => ({ left: 30, top: 40 }) }),
  } as unknown as HTMLDivElement },
};
const base = { stroke: '#3B82F6', strokeWidth: 5, strokeDasharray: '6 4', opacity: .95 };
beforeEach(() => {
  state.userDefaults.appearance.edgeStyle = 'dash';
  state.bubbleAppearancePending = null;
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  act(() => renderers.splice(0).forEach((renderer) => renderer.unmount()));
  vi.unstubAllGlobals();
});
function element(kind: 'drag' | 'popup') {
  return kind === 'drag'
    ? createElement(TaskEdgeDragPreview, common)
    : createElement(TaskEdgePopupPreview, { ...common, sourceId: 'source', targetId: 'target',
      parallelOffset: 1, targetAngularOffset: .1 });
}
function mount(kind: 'drag' | 'popup'): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(element(kind)); });
  renderers.push(renderer);
  return renderer;
}

describe.each(['drag', 'popup'] as const)('%s task preview appearance', (kind) => {
  it.each(variants)('%s shares the real task paint while retaining screen geometry and a single marker', (variant) => {
    state.userDefaults.appearance.edgeStyle = variant;
    const root = mount(kind).root;
    const expectedPath = computeTaskEdgePath({
      sourceX: 152, sourceY: 188, sourceRadius: 90,
      ...(kind === 'drag'
        ? { targetX: 700, targetY: 400, targetRadius: 0 }
        : { targetX: 752, targetY: 588, targetRadius: 90, offset: 1, targetAngularOffset: .1 }),
    }).path;
    const layers = root.findAllByProps({ className: 'bubble-edge-paint' });
    const expectedPaint = bubbleEdgeAppearance(variant, { semantic: 'task', base });
    expect(layers.map((p) => ({ role: p.props['data-paint-layer'], style: p.props.style }))).toEqual(expectedPaint);
    for (const p of layers) {
      expect(p.props.d).toBe(expectedPath);
      expect(p.props.pointerEvents).toBe('none');
      expect(p.props.markerEnd).toBeUndefined();
    }
    const markers = root.findAll((n) => n.type === 'path' && Boolean(n.props.markerEnd));
    expect(markers).toHaveLength(1);
    expect(markers[0]!.props.d).toBe(expectedPath);
    expect(markers[0]!.props.style).toMatchObject({ strokeWidth: 5, opacity: .95, stroke: 'transparent' });
    expect(markers[0]!.props.markerEnd).toBe(`url(#task-edge-${kind}-preview-arrow)`);
    expect(root.findByType('svg').props.className).toContain('pointer-events-none');
  });

  it('tracks the pending family then restores saved paint without a geometry change', () => {
    const renderer = mount(kind);
    const main = () => renderer.root.findByProps({ 'data-paint-layer': 'line' });
    const path = main().props.d;
    expect(main().props.style.strokeWidth).toBe(4.3);
    state.bubbleAppearancePending = { edgeStyle: 'rail' };
    act(() => renderer.update(element(kind)));
    expect(main().props.style.strokeWidth).toBe(2.4);
    expect(main().props.d).toBe(path);
    state.bubbleAppearancePending = null;
    act(() => renderer.update(element(kind)));
    expect(main().props.style.strokeWidth).toBe(4.3);
    expect(main().props.d).toBe(path);
  });
});
