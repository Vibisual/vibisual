import { describe, expect, it } from 'vitest';
import { boxBounds, boxFromDrag, handleCursor, handlePoint, normalizeAngle, resizeBox, rotateDrag, snapMove } from './imageGeometry.js';
import { centred, fitView, stepZoom, toDoc, viewBoxOf, zoomAround } from './editorViewport.js';

const close = (a: object, b: Record<string, number>): void => {
  for (const key of Object.keys(b)) expect((a as Record<string, number>)[key]).toBeCloseTo(b[key]!, 6);
};

describe('resizeBox', () => {
  const box = { x: 0, y: 0, width: 100, height: 50 };
  it('keeps the opposite corner in place', () => {
    close(resizeBox(box, 'se', { x: 150, y: 80 }, false), { x: 0, y: 0, width: 150, height: 80 });
    close(resizeBox(box, 'nw', { x: -20, y: -10 }, false), { x: -20, y: -10, width: 120, height: 60 });
  });
  it('edge handles change one axis only', () => {
    close(resizeBox(box, 'e', { x: 140, y: 999 }, false), { x: 0, y: 0, width: 140, height: 50 });
    close(resizeBox(box, 'n', { x: 999, y: -30 }, false), { x: 0, y: -30, width: 100, height: 80 });
  });
  it('keeps the ratio from the larger pull, and grows the other axis around the centre on an edge', () => {
    close(resizeBox(box, 'se', { x: 150, y: 80 }, true), { width: 160, height: 80 });
    close(resizeBox(box, 'e', { x: 200, y: 0 }, true), { x: 0, y: -25, width: 200, height: 100 });
  });
  it('never flips; stops at the minimum', () => {
    close(resizeBox(box, 'se', { x: -500, y: -500 }, false), { x: 0, y: 0, width: 1, height: 1 });
  });
  it('resizes a rotated box along its own axes and keeps the fixed corner where it was on the page', () => {
    const rotated = { ...box, rotation: 90 };
    const fixed = handlePoint(rotated, 'nw');
    const pulled = handlePoint(rotated, 'se');
    const next = resizeBox(rotated, 'se', { x: pulled.x - 10, y: pulled.y + 20 }, false);
    close(next, { width: 120, height: 60 });
    const after = handlePoint({ ...next, rotation: 90 }, 'nw');
    close(after, { ...fixed });
  });
});

describe('rotation', () => {
  it('normalizes into (-180, 180]', () => {
    expect(normalizeAngle(190)).toBe(-170);
    expect(normalizeAngle(-180)).toBe(180);
    expect(normalizeAngle(360)).toBe(0);
  });
  it('turns by the pointer difference and snaps to 15 degrees', () => {
    expect(rotateDrag(10, -90, -80, false)).toBe(20);
    expect(rotateDrag(0, 0, 37, true)).toBe(30);
  });
  it('covers the rotated corners in the bounds', () => {
    close(boxBounds({ x: 0, y: 0, width: 100, height: 50, rotation: 90 }), { x: 25, y: -25, width: 50, height: 100 });
  });
  it('turns the resize cursor with the layer', () => {
    expect(handleCursor('e', 0)).toBe('ew');
    expect(handleCursor('e', 90)).toBe('ns');
    expect(handleCursor('se', 0)).toBe('nwse');
    expect(handleCursor('ne', 0)).toBe('nesw');
    expect(handleCursor('se', 90)).toBe('nesw');
  });
});

describe('drawing and snapping', () => {
  it('draws boxes in any direction; square keeps the drag direction', () => {
    close(boxFromDrag({ x: 50, y: 50 }, { x: 10, y: 20 }, false), { x: 10, y: 20, width: 40, height: 30 });
    close(boxFromDrag({ x: 50, y: 50 }, { x: 10, y: 40 }, true), { x: 10, y: 10, width: 40, height: 40 });
  });
  it('snaps to the canvas centre and to other layers, with guides for every matching line', () => {
    const snap = snapMove({ x: 448, y: 10, width: 100, height: 40 }, [{ x: 0, y: 200, width: 30, height: 30 }], { width: 1000, height: 500 }, 5);
    expect(snap.dx).toBe(2);
    expect(snap.guides.some((g) => g.axis === 'x' && g.at === 500)).toBe(true);
    const edge = snapMove({ x: 33, y: 100, width: 50, height: 50 }, [{ x: 0, y: 200, width: 30, height: 30 }], { width: 1000, height: 500 }, 5);
    expect(edge.dx).toBe(-3);
    expect(edge.guides.find((g) => g.axis === 'x' && g.at === 30)).toMatchObject({ from: 100, to: 230 });
  });
  it('does not move past the threshold', () => {
    expect(snapMove({ x: 120, y: 120, width: 10, height: 10 }, [], { width: 1000, height: 1000 }, 5)).toEqual({ dx: 0, dy: 0, guides: [] });
  });
});

describe('editor viewport', () => {
  it('fits the canvas inside the padding without enlarging small canvases', () => {
    const view = fitView({ width: 1000, height: 500 }, { width: 580, height: 580 }, 40);
    expect(view.scale).toBeCloseTo(0.5);
    close(view, { x: 40, y: 165 });
    expect(fitView({ width: 100, height: 100 }, { width: 800, height: 600 }).scale).toBe(1);
  });
  it('zooms around the pointer — the document point under it stays', () => {
    const view = centred({ width: 1000, height: 500 }, { width: 800, height: 600 }, 0.5);
    const at = { x: 300, y: 200 };
    const before = toDoc(view, at);
    const after = toDoc(zoomAround(view, 2, at), at);
    close(after, before);
  });
  it('steps through the zoom ladder', () => {
    expect(stepZoom(1, 1)).toBe(1.5);
    expect(stepZoom(1, -1)).toBe(0.6667);
    expect(stepZoom(0.7, -1)).toBe(0.6667);
  });
  it('maps the whole stage to document coordinates', () => {
    expect(viewBoxOf({ scale: 0.5, x: 40, y: 20 }, { width: 400, height: 300 })).toBe('-80 -40 800 600');
  });
});
