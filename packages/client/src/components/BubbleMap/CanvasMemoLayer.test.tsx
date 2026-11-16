import type { ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasMemoLayer } from './CanvasMemoLayer.js';
import { SessionMemoLayer } from '../IDE/SessionMemoLayer.js';
import { canvasMemoDestination } from '../IDE/canvasMemoTransfer.js';

const state = vi.hoisted(() => ({ project: 'Project', currentFolderId: null as string | null, interiorView: null }));
const viewport = vi.hoisted(() => ({ x: 120, y: -30, zoom: 2 }));
vi.mock('@xyflow/react', () => ({
  useViewport: () => viewport,
  useReactFlow: () => ({ screenToFlowPosition: (p: { x: number; y: number }) => ({
    x: (p.x - 50 - viewport.x) / viewport.zoom, y: (p.y - 80 - viewport.y) / viewport.zoom,
  }) }),
  ViewportPortal: ({ children }: { children: ReactNode }) => <div data-scaled-memo-root="">{children}</div>,
}));
vi.mock('../../stores/graphStore.js', () => ({
  useGraphStore: (selector: (value: typeof state) => unknown) => selector(state),
  selectEffectiveProject: (value: typeof state) => value.project,
}));
vi.mock('../IDE/useCanvasMemoLinks.js', () => ({ useCanvasMemoLinks: () => () => null }));
vi.mock('../IDE/SessionMemoLayer.js', () => ({ SessionMemoLayer: () => null }));

let view: ReactTestRenderer | undefined;
let hit: ReturnType<typeof vi.fn>;
beforeEach(() => {
  Object.assign(viewport, { x: 120, y: -30, zoom: 2 });
  state.currentFolderId = null;
  const canvas = { getBoundingClientRect: () => ({ left: 50, top: 80, width: 1000, height: 700 }) };
  vi.stubGlobal('window', new EventTarget());
  hit = vi.fn((x: number) => ({ closest: () => x >= 700 ? canvas : null }));
  vi.stubGlobal('document', { elementFromPoint: hit });
  act(() => { view = create(<CanvasMemoLayer />, { createNodeMock: () => ({ closest: () => canvas }) }); });
});
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.unstubAllGlobals(); });

describe('canvas memo projection', () => {
  it('renders outside the scaled viewport and follows canvas panning', () => {
    expect(view!.root.findAllByProps({ 'data-scaled-memo-root': '' })).toHaveLength(0);
    expect(view!.root.findByProps({ 'data-canvas-memo-surface': '' }).props.style).toEqual({ left: 120, top: -30 });
    Object.assign(viewport, { x: -200, y: 75, zoom: 0.5 });
    act(() => view!.update(<CanvasMemoLayer />));
    expect(view!.root.findByProps({ 'data-canvas-memo-surface': '' }).props.style).toEqual({ left: -200, top: 75 });
    expect(view!.root.findByType(SessionMemoLayer).props.canvas.scale).toBe(0.5);
  });
  it('keeps the dropped top left at the pointer offset on a panned and zoomed canvas', () => {
    hit.mockReturnValue({ closest: () => view!.root.findByType(SessionMemoLayer).props.containerRef.current.closest() });
    expect(canvasMemoDestination({ x: 450, y: 350 }, { x: 410, y: 330 })).toEqual({
      project: 'Project', folderId: null, x: 120, y: 140,
    });
  });
  it('moves a note when one third is over the canvas while the pointer is still over the IDE', () => {
    const exit = { card: { x: 500, y: 250, w: 300, h: 150 }, bounds: { x: 100, y: 100, w: 600, h: 400 } };
    expect(canvasMemoDestination({ x: 530, y: 260 }, { x: 500, y: 250 }, exit)).toEqual({
      project: 'Project', folderId: null, x: 165, y: 100,
    });
    expect(hit).toHaveBeenCalledWith(750, 325);
    expect(canvasMemoDestination({ x: 529, y: 260 }, { x: 499, y: 250 }, {
      ...exit, card: { ...exit.card, x: 499 },
    })).toBeNull();
  });
  it('does not arm through another IDE covering the exposed part', () => {
    hit.mockReturnValue({ closest: () => null });
    expect(canvasMemoDestination({ x: 530, y: 260 }, { x: 500, y: 250 }, {
      card: { x: 500, y: 250, w: 300, h: 150 }, bounds: { x: 100, y: 100, w: 600, h: 400 },
    })).toBeNull();
  });
  it('accepts the source modal backdrop when it covers the canvas', () => {
    const backdrop = Object.assign(new EventTarget(), { closest: () => null });
    hit.mockReturnValue(backdrop);
    expect(canvasMemoDestination({ x: 530, y: 260 }, { x: 500, y: 250 }, {
      card: { x: 500, y: 250, w: 300, h: 150 }, bounds: { x: 100, y: 100, w: 600, h: 400 }, backdrop,
    })).toEqual({ project: 'Project', folderId: null, x: 165, y: 100 });
  });
});
