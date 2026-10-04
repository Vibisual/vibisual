import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { EdgeProps, Position } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskEdgeComponent } from './TaskEdgeComponent.js';

vi.mock('@xyflow/react', () => ({
  BaseEdge: () => null,
  EdgeLabelRenderer: ({ children }: { children: unknown }) => children,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../stores/graphStore.js', () => ({
  useGraphStore: (select: (state: unknown) => unknown) => select({
    openTaskEdgeEdit: () => {}, selectTaskEdge: () => {}, selectedTaskEdgeId: null, debugMode: false,
  }),
}));
vi.mock('../../stores/linkFocus.js', () => ({ useLinkEdgeRole: () => 'none', useLinkFocusPhase: () => 'none' }));
vi.mock('./linkedBubbles.js', () => ({ linkFocusEdgeStyle: () => ({ opacityMul: 1, widthMul: 1 }) }));

let renderer: ReactTestRenderer;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  if (renderer) act(() => renderer.unmount());
  vi.useRealTimers();
});
function props(status: string, artifact = false): EdgeProps {
  return {
    id: 'edge', source: 'a', target: 'b', sourceX: 0, sourceY: 0, targetX: 300, targetY: 0,
    sourcePosition: 'top' as Position, targetPosition: 'top' as Position,
    data: { status, taskEdgeId: 'edge', kind: artifact ? 'artifact' : 'command',
      ...(artifact ? { bundleId: 'bundle', bundleRole: 'auto-artifact' } : {}) },
  };
}
function mount(artifact = false): void {
  act(() => { renderer = create(createElement(TaskEdgeComponent, props('idle', artifact))); });
}
function status(next: string, artifact = false): void {
  act(() => renderer.update(createElement(TaskEdgeComponent, props(next, artifact))));
}
function pulses(): string[] {
  return renderer.root.findAll((node) =>
    typeof node.props.style?.animation === 'string' && node.props.style.animation.startsWith('task-edge-travel'),
  ).map((node) => node.props.title as string);
}
function tick(ms: number): void { act(() => { vi.advanceTimersByTime(ms); }); }

describe('task edge pulse ownership', () => {
  it('keeps portal icons and traveling pulses inside the selection focus layer', () => {
    const focused = (state: string): EdgeProps => {
      const base = props(state);
      return { ...base, data: { ...base.data, selectionFocusClassName: 'opacity-[0.12]' } };
    };
    act(() => { renderer = create(createElement(TaskEdgeComponent, focused('idle'))); });
    act(() => renderer.update(createElement(TaskEdgeComponent, focused('executing'))));
    const layer = renderer.root.findByProps({ className: 'opacity-[0.12]' });
    expect(layer.findAll((node) => typeof node.props.onDoubleClick === 'function')).toHaveLength(1);
    expect(layer.findAll((node) => node.props.style?.animation?.startsWith('task-edge-travel'))).toHaveLength(1);
  });

  it.each(['completed', 'error'])('keeps the %s pulse for its full lifetime after a recent sending pulse', (outcome) => {
    mount();
    status('executing');
    tick(4000);
    status(outcome);
    tick(300); // The previous sending timer used to remove this new result here.
    expect(pulses()).toEqual([`bubbleMap.taskEdge.pulse.${outcome}`]);
    tick(3999);
    expect(pulses()).toHaveLength(1);
    tick(1);
    expect(pulses()).toEqual([]);
  });

  it.each([false, true])('keeps a repeated dispatch/result pulse (artifact=%s)', (artifact) => {
    mount(artifact);
    status(artifact ? 'completed' : 'executing', artifact);
    tick(4000);
    status(artifact ? 'executing' : 'idle', artifact);
    status(artifact ? 'completed' : 'executing', artifact);
    tick(300);
    expect(pulses()).toEqual([`bubbleMap.taskEdge.pulse.${artifact ? 'completed' : 'sending'}`]);
    tick(4000);
    expect(pulses()).toEqual([]);
  });

  it('releases the pulse timer when a project switch unmounts the edge', () => {
    mount();
    status('executing');
    expect(vi.getTimerCount()).toBe(1);
    act(() => renderer.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });
});
