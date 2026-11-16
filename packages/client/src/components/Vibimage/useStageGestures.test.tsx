import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newImageDocument, newImageLayer, type ImageDocument, type ImageLayer } from '../Creation/imageSource.js';
import { useStageGestures, type StageGestureOptions } from './useStageGestures.js';
import type { EditorViewport } from './useEditorViewport.js';

type Handlers = ReturnType<typeof useStageGestures>['handlers'];
const mounted: ReactTestRenderer[] = [];
afterEach(() => { act(() => mounted.splice(0).forEach((r) => r.unmount())); });

function docWith(...layers: Partial<ImageLayer>[]): ImageDocument {
  const base = { ...newImageDocument(), width: 1000, height: 500 };
  return { ...base, layers: layers.map((patch, i) => ({ ...newImageLayer(base, 'shape', `L${i}`), id: `l${i}`, x: 0, y: 0, width: 100, height: 100, ...patch })) };
}
/** 문서 좌표 = 화면 좌표(배율 1) — 손짓 판단만 본다. */
function harness(initial: Partial<StageGestureOptions> & { doc: ImageDocument }) {
  let handlers!: Handlers;
  const viewport = { view: { scale: 1, x: 0, y: 0 }, set: vi.fn(), zoomStep: vi.fn() } as unknown as EditorViewport;
  const options: StageGestureOptions = {
    selection: [], tool: 'move', viewport, editable: true, onSelect: vi.fn(), onChange: vi.fn(), onDraw: vi.fn(), onEditText: vi.fn(),
    toDoc: (x, y) => ({ x, y }), toStage: (x, y) => ({ x, y }), ...initial,
  };
  function Probe(props: StageGestureOptions): null { handlers = useStageGestures(props).handlers; return null; }
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(createElement(Probe, options)); });
  mounted.push(renderer);
  const target = (attrs: Record<string, string> = {}) => ({
    getAttribute: (name: string) => attrs[name] ?? null,
    hasAttribute: (name: string) => name in attrs,
    closest: () => (attrs['data-layer-id'] ? { getAttribute: () => attrs['data-layer-id'] } : null),
  });
  const event = (x: number, y: number, attrs: Record<string, string> = {}, mods: Record<string, unknown> = {}) => ({
    pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, shiftKey: false, ctrlKey: false, metaKey: false,
    target: target(attrs), currentTarget: { setPointerCapture: vi.fn() }, preventDefault: vi.fn(), ...mods,
  }) as never;
  return {
    options, viewport,
    update(next: Partial<StageGestureOptions>) { Object.assign(options, next); act(() => renderer.update(createElement(Probe, { ...options }))); },
    down: (x: number, y: number, attrs?: Record<string, string>, mods?: Record<string, unknown>) => act(() => handlers.onPointerDown!(event(x, y, attrs, mods))),
    move: (x: number, y: number, mods?: Record<string, unknown>) => act(() => handlers.onPointerMove!(event(x, y, {}, mods))),
    up: (x: number, y: number, mods?: Record<string, unknown>) => act(() => handlers.onPointerUp!(event(x, y, {}, mods))),
    dblclick: () => act(() => handlers.onDoubleClick!({ target: target() } as never)),
  };
}

describe('stage gestures (§5.13 (R-9) 레이어 편집기 ③)', () => {
  it('selects a layer, moves it as one edit, and snaps its centre to the canvas centre', () => {
    const doc = docWith({ x: 100, y: 100 });
    const h = harness({ doc });
    h.down(150, 150, { 'data-layer-id': 'l0' });
    expect(h.options.onSelect).toHaveBeenCalledWith(['l0']);
    h.update({ selection: ['l0'] });
    h.move(250, 300); h.move(502, 300); h.up(502, 300);
    expect(h.options.onChange).toHaveBeenCalledOnce();
    // The centre lands at 502 — 2 px from the canvas centre (inside 6 px), so it snaps: left 450, centre 500.
    expect(vi.mocked(h.options.onChange!).mock.calls[0]![0].layers[0]).toMatchObject({ x: 450, y: 250 });
  });
  it('drops the drag when the source changed underneath it', () => {
    const doc = docWith({ x: 100, y: 100 });
    const h = harness({ doc, selection: ['l0'] });
    h.down(150, 150, { 'data-layer-id': 'l0' });
    h.move(300, 300);
    h.update({ doc: { ...doc } });
    h.up(300, 300);
    expect(h.options.onChange).not.toHaveBeenCalled();
  });
  it('a locked layer can be selected but not moved', () => {
    const h = harness({ doc: docWith({ locked: true }) });
    h.down(50, 50, { 'data-layer-id': 'l0' });
    h.move(200, 200); h.up(200, 200);
    expect(h.options.onSelect).toHaveBeenCalledWith(['l0']);
    expect(h.options.onChange).not.toHaveBeenCalled();
  });
  it('dragging a locked layer inside a multi-selection moves nothing', () => {
    const h = harness({ doc: docWith({ locked: true }, { x: 300 }), selection: ['l0', 'l1'] });
    h.down(50, 50, { 'data-layer-id': 'l0' }); h.move(200, 200); h.up(200, 200);
    expect(h.options.onChange).not.toHaveBeenCalled();
  });
  it('double-click opens the text layer that was pressed even when the click lands on the stage (pointer capture)', () => {
    const h = harness({ doc: docWith({ kind: 'text', text: 'hi', fontSize: 20, fontFamily: 'Arial', align: 'left' }) });
    h.down(50, 50, { 'data-layer-id': 'l0' }); h.up(50, 50);
    h.dblclick();
    expect(h.options.onEditText).toHaveBeenCalledWith('l0');
  });
  it('a corner handle keeps a picture in proportion unless Shift frees it', () => {
    const doc = docWith({ kind: 'image', source: 'a.png', width: 200, height: 100 });
    const h = harness({ doc, selection: ['l0'] });
    h.down(200, 100, { 'data-handle': 'se' }); h.move(400, 120); h.up(400, 120);
    expect(vi.mocked(h.options.onChange!).mock.calls[0]![0].layers[0]).toMatchObject({ width: 400, height: 200 });
    h.down(200, 100, { 'data-handle': 'se' }); h.move(400, 120, { shiftKey: true }); h.up(400, 120, { shiftKey: true });
    expect(vi.mocked(h.options.onChange!).mock.calls[1]![0].layers[0]).toMatchObject({ width: 400, height: 120 });
  });
  it('drags a marquee over empty canvas to select what it touches, skipping hidden layers', () => {
    const h = harness({ doc: docWith({ x: 0 }, { x: 300 }, { x: 320, visible: false }) });
    h.down(250, 50); h.move(450, 60); h.up(450, 60);
    expect(h.options.onSelect).toHaveBeenNthCalledWith(1, []);
    expect(h.options.onSelect).toHaveBeenLastCalledWith(['l1']);
  });
  it('a drawing tool hands over the dragged box, or nothing for a click', () => {
    const h = harness({ doc: docWith(), tool: 'rect' });
    h.down(10, 20); h.move(110, 70); h.up(110, 70);
    expect(h.options.onDraw).toHaveBeenLastCalledWith('rect', { x: 10, y: 20, width: 100, height: 50 }, { x: 10, y: 20 });
    h.down(500, 300); h.up(501, 300);
    expect(h.options.onDraw).toHaveBeenLastCalledWith('rect', null, { x: 500, y: 300 });
  });
  it('a read-only stage (proposal compare) pans on a plain drag and never edits', () => {
    const h = harness({ doc: docWith(), editable: false, onChange: undefined, onSelect: undefined });
    h.down(50, 50, { 'data-layer-id': 'l0' }); h.move(80, 90); h.up(80, 90);
    expect(h.viewport.set).toHaveBeenLastCalledWith({ scale: 1, x: 30, y: 40 });
  });
});
