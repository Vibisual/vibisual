import { createElement, type CSSProperties } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { EdgeProps, Position } from '@xyflow/react';
import { REDUCED_MOTION_LOOP_SLOWDOWN, TASK_EDGE_KIND_STYLES, type BubbleEdgeStyle, type TaskEdgeKind } from '@vibisual/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bubbleEdgeAppearance, bubbleEdgeMarkerStyle } from './bubbleEdgeAppearance.js';
import { CurvedEdge } from './CurvedEdge.js';
import { TaskEdgeComponent } from './TaskEdgeComponent.js';
import type { MaskCircle } from './edgeMaskGeometry.js';

const state = vi.hoisted(() => ({
  userDefaults: { appearance: { edgeStyle: 'dash' } },
  bubbleAppearancePending: null as null | { edgeStyle: string },
  selectedTaskEdgeId: null, debugMode: false,
  openTaskEdgeEdit: vi.fn(), selectTaskEdge: vi.fn(),
}));
const occlusion = vi.hoisted(() => ({ circles: [] as MaskCircle[] }));
vi.mock('../../stores/graphStore.js', () => ({ useGraphStore: (select: (s: typeof state) => unknown) => select(state) }));
vi.mock('../../stores/linkFocus.js', () => ({ useLinkEdgeRole: () => 'off', useLinkFocusPhase: () => 'off' }));
vi.mock('./edgeOccluders.js', () => ({ useEdgeOccluders: () => occlusion.circles }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@xyflow/react', () => ({
  useInternalNode: () => undefined,
  EdgeLabelRenderer: ({ children }: { children: unknown }) => children,
  BaseEdge: ({ path, style, markerEnd, markerStart, interactionWidth }: {
    path: string; style: CSSProperties; markerEnd?: string; markerStart?: string; interactionWidth?: number;
  }) => createElement('path', { 'data-base-edge': true, d: path, style, markerEnd, markerStart,
    'data-hit-width': interactionWidth }),
}));

const variants: BubbleEdgeStyle[] = ['wire', 'dash', 'beads', 'glow', 'rail'];
const kinds = Object.keys(TASK_EDGE_KIND_STYLES) as TaskEdgeKind[];
const mounted: ReactTestRenderer[] = [];
beforeEach(() => {
  state.userDefaults.appearance.edgeStyle = 'dash';
  state.bubbleAppearancePending = null;
  state.openTaskEdgeEdit.mockClear();
  state.selectTaskEdge.mockClear();
  occlusion.circles = [];
});
afterEach(() => { act(() => mounted.splice(0).forEach((renderer) => renderer.unmount())); });
function props(): EdgeProps {
  return {
    id: 'read-edge', source: 'file', target: 'agent', sourceX: 0, sourceY: 0, targetX: 300, targetY: 0,
    sourcePosition: 'top' as Position, targetPosition: 'top' as Position,
    style: { stroke: '#369ac5CC', strokeWidth: 2.5, opacity: .7 },
    markerEnd: 'url(#read-arrow)', markerStart: 'url(#start-arrow)', interactionWidth: 15,
    animated: true, data: { sourceRadius: 30, targetRadius: 40 },
  };
}
function mount(Component: typeof CurvedEdge | typeof TaskEdgeComponent, input = props()): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(createElement(Component, input)); });
  mounted.push(renderer);
  return renderer;
}

describe('bubble edge appearance semantics', () => {
  it.each(variants)('%s keeps kind color, dashed grammar and automatic/focus opacity', (variant) => {
    for (const kind of kinds) {
      const base = { stroke: TASK_EDGE_KIND_STYLES[kind].color, strokeWidth: kind === 'artifact' ? 3.5 : 2.5,
        strokeDasharray: '6 4', opacity: .55 * .12 };
      const paint = bubbleEdgeAppearance(variant, { semantic: 'task', base, active: true });
      expect(paint.map((p) => p.role)).not.toContain('travel');
      for (const p of paint) {
        expect(p.style.stroke).toBe(base.stroke);
        expect(p.style.strokeDasharray).toBe('6 4');
        expect(p.style.pointerEvents).toBe('none');
      }
      expect(paint.find((p) => p.role === 'line')?.style.opacity).toBe(base.opacity);
      expect(bubbleEdgeMarkerStyle(base)).toMatchObject({ strokeWidth: base.strokeWidth, opacity: base.opacity });
    }
  });

  it.each(variants)('%s leaves inactive activities neutral and motionless', (variant) => {
    const neutral = 'rgba(100,116,139,0.25)';
    const base = { stroke: neutral, strokeWidth: 1.5, opacity: .12 };
    const original = { ...base };
    const paint = bubbleEdgeAppearance(variant, { semantic: 'activity', base, active: false });
    expect(paint.map((p) => p.role)).not.toContain('travel');
    expect(paint.some((p) => p.style.stroke === neutral)).toBe(true);
    expect(paint.every((p) => p.style.animation === 'none')).toBe(true);
    expect(base).toEqual(original);
  });

  // §5.4 #31 (K) 2026-10-22 — on a PC with animation effects off (reduced motion) the travel layer used to be
  // stripped to `animation: none`, so a working edge stood as still as an idle one. It now slows down instead.
  it.each(variants)('%s keeps a working edge flowing under reduced motion: same keyframes, slower, still 24 moves a second', (variant) => {
    const paint = bubbleEdgeAppearance(variant, {
      semantic: 'activity', base: { stroke: '#369ac5CC', strokeWidth: 2.5 }, active: true,
    });
    const travel = paint.find((p) => p.role === 'travel')?.style as Record<string, unknown> | undefined;
    const flow = (value: unknown) => /^bubble-edge-(\w+)-flow ([\d.]+)s steps\((\d+), end\) infinite$/.exec(String(value));
    const reduced = flow(travel?.['--bubble-edge-flow-reduced']);
    const normal = flow(travel?.animation);
    expect(reduced?.[1]).toBe(variant);
    expect(normal?.[1]).toBe(variant);
    expect(REDUCED_MOTION_LOOP_SLOWDOWN).toBeGreaterThan(1);
    expect(Number(reduced![2])).toBeCloseTo(Number(normal![2]) * REDUCED_MOTION_LOOP_SLOWDOWN, 3);
    for (const m of [normal!, reduced!]) expect(Number(m[3]) / Number(m[2])).toBeCloseTo(24, 0);
  });

  it('retains width hierarchy instead of replacing inactive, Artifact or focus multipliers', () => {
    for (const variant of variants) {
      const width = (w: number) => bubbleEdgeAppearance(variant, {
        semantic: 'activity', base: { strokeWidth: w },
      }).find((p) => p.role === 'line')!.style.strokeWidth as number;
      expect(width(1.5) / width(2.5)).toBeCloseTo(.6);
      expect(width(2.5 * 1.7) / width(2.5)).toBeCloseTo(1.7);
    }
  });
});

describe('paint does not replace edge geometry or interaction', () => {
  it('uses identical clipped paths and exactly one unchanged marker/hit owner for every appearance', () => {
    occlusion.circles = [{ id: 'middle', cx: 150, cy: 0, r: 25 }];
    const paths: string[] = [];
    for (const variant of variants) {
      state.userDefaults.appearance.edgeStyle = variant;
      const root = mount(CurvedEdge).root;
      const base = root.findByProps({ 'data-base-edge': true });
      paths.push(base.props.d);
      expect(base.props.d.match(/M /g)).toHaveLength(2);
      expect(base.props.markerEnd).toBe('url(#read-arrow)');
      expect(base.props.markerStart).toBe('url(#start-arrow)');
      expect(base.props.style.strokeWidth).toBe(2.5);
      expect(base.props.style.opacity).toBe(.7);
      expect(base.props['data-hit-width']).toBe(15);
      const paints = root.findAllByProps({ className: 'bubble-edge-paint' });
      expect(paints.length).toBeGreaterThan(0);
      for (const p of paints) {
        expect(p.props.d).toBe(base.props.d);
        expect(p.props.pointerEvents).toBe('none');
        expect(p.props.markerEnd).toBeUndefined();
        expect(p.props.markerStart).toBeUndefined();
      }
    }
    expect(new Set(paths).size).toBe(1);
  });

  it.each(variants)('%s still hides the whole arrow when the endpoint is occluded', (variant) => {
    state.userDefaults.appearance.edgeStyle = variant;
    occlusion.circles = [{ id: 'cover-end', cx: 247, cy: 0, r: 28 }];
    const base = mount(CurvedEdge).root.findByProps({ 'data-base-edge': true });
    expect(base.props.markerEnd).toBeUndefined();
    expect(base.props.markerStart).toBe('url(#start-arrow)');
  });

  it('a mounted working edge carries its reduced-motion flow on the travel path', () => {
    const travel = mount(CurvedEdge).root.findByProps({ 'data-paint-layer': 'travel' });
    expect(travel.props.className).toBe('bubble-edge-paint');
    expect(String(travel.props.style['--bubble-edge-flow-reduced'])).toMatch(/^bubble-edge-dash-flow \S+s steps\(\d+, end\) infinite$/);
  });

  it('does not restyle a non-directional play-owner edge', () => {
    state.userDefaults.appearance.edgeStyle = 'rail';
    const input = { ...props(), id: 'play-owner-preview', animated: false, markerEnd: undefined, markerStart: undefined,
      style: { stroke: 'rgba(52,211,153,.45)', strokeWidth: 1.5, strokeDasharray: '4 4' } };
    const root = mount(CurvedEdge, input).root;
    expect(root.findAllByProps({ className: 'bubble-edge-paint' })).toHaveLength(0);
    expect(root.findByProps({ 'data-base-edge': true }).props.style).toEqual(input.style);
  });

  it('previews pending settings immediately and rolls back to the saved appearance', () => {
    const renderer = mount(CurvedEdge);
    const line = () => renderer.root.findByProps({ 'data-paint-layer': 'line' }).props.style;
    expect(line().strokeDasharray).toBe('10 6');
    state.bubbleAppearancePending = { edgeStyle: 'beads' };
    act(() => renderer.update(createElement(CurvedEdge, props())));
    expect(line().strokeDasharray).toBe('0 9.5');
    state.bubbleAppearancePending = null;
    act(() => renderer.update(createElement(CurvedEdge, props())));
    expect(line().strokeDasharray).toBe('10 6');
  });

  it.each(variants)('%s retains task selection, primary-only edit and the original hit width', (variant) => {
    state.userDefaults.appearance.edgeStyle = variant;
    const input = { ...props(), data: { ...props().data, status: 'idle', taskEdgeId: 'job', kind: 'artifact',
      bundleId: 'pair', bundleRole: 'auto-artifact' } };
    const root = mount(TaskEdgeComponent, input).root;
    const base = root.findByProps({ 'data-base-edge': true });
    expect(base.props['data-hit-width']).toBe(15);
    expect(base.props.style.strokeWidth).toBe(3.5);
    expect(base.props.style.opacity).toBe(.55);
    expect(base.props.markerEnd).toBe('url(#task-arrow-artifact)');
    for (const p of root.findAllByProps({ className: 'bubble-edge-paint' })) expect(p.props.d).toBe(base.props.d);
    const badge = root.findAll((n) => typeof n.props.onDoubleClick === 'function')[0]!;
    const event = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
    act(() => badge.props.onClick(event));
    act(() => badge.props.onDoubleClick(event));
    expect(state.selectTaskEdge).toHaveBeenCalledWith('job');
    expect(state.openTaskEdgeEdit).not.toHaveBeenCalled();
  });
});
