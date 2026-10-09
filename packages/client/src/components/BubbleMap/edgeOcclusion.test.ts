import { describe, expect, it } from 'vitest';
import type { MaskCircle } from './edgeMaskGeometry.js';
import { clipCurvePath, curveBox, lineCurve, occludersFor, quadraticCurve, subCurve, visibleSpans, type CubicCurve } from './edgeOcclusion.js';
import { reuseUnchangedCircles } from './edgeOccluders.js';

const circle = (id: string, cx: number, cy: number, r: number): MaskCircle => ({ id, cx, cy, r });
const pointOn = (c: CubicCurve, t: number): [number, number] => {
  const u = 1 - t;
  return [
    u * u * u * c.x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x3,
    u * u * u * c.y0 + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y3,
  ];
};
const straight = lineCurve(0, 0, 100, 0);

describe('edge occlusion — lines are cut where they pass under bubbles (§5.4 #31 (K))', () => {
  it('raises straight lines and quadratics to the same cubic', () => {
    expect(lineCurve(0, 0, 90, 30)).toEqual({ x0: 0, y0: 0, x1: 30, y1: 10, x2: 60, y2: 20, x3: 90, y3: 30 });
    const [x, y] = pointOn(quadraticCurve(0, 0, 60, 90, 120, 0), 0.5);
    expect(x).toBeCloseTo(60, 9);
    expect(y).toBeCloseTo(45, 9);
  });

  it('only bubbles near the line can cover it, and never the bubble the line leaves from', () => {
    const circles = [circle('source', 0, 0, 20), circle('near', 50, 5, 10), circle('far', 50, 200, 10)];
    expect(occludersFor(circles, curveBox(straight), 'source').map((picked) => picked.id)).toEqual(['near']);
  });

  it('drops exactly the part inside a bubble', () => {
    const spans = visibleSpans(straight, [circle('mid', 50, 0, 10)]);
    expect(spans).toHaveLength(2);
    expect(spans[0]![0]).toBe(0);
    expect(spans[0]![1]).toBeCloseTo(0.4, 4);
    expect(spans[1]![0]).toBeCloseTo(0.6, 4);
    expect(spans[1]![1]).toBe(1);
  });

  it('hands back the original path untouched when nothing covers the line', () => {
    const full = 'M 0,0 C 33,0 67,0 100,0';
    expect(clipCurvePath(straight, [], full)).toEqual({ path: full, startVisible: true, endVisible: true });
    expect(clipCurvePath(straight, [circle('beside', 50, 40, 10)], full)).toEqual({ path: full, startVisible: true, endVisible: true });
  });

  it('hides the arrowhead when the end sits under a bubble, and draws nothing when all of it does', () => {
    const end = clipCurvePath(straight, [circle('target', 100, 0, 20)], 'full');
    expect(end.startVisible).toBe(true);
    expect(end.endVisible).toBe(false);
    expect(end.path).toMatch(/^M 0,0 C /);
    expect(clipCurvePath(straight, [circle('huge', 50, 0, 80)], 'full')).toEqual({ path: '', startVisible: false, endVisible: false });
  });

  it('keeps the cut pieces on the original curve', () => {
    const curve: CubicCurve = { x0: 0, y0: 0, x1: 30, y1: 60, x2: 70, y2: -20, x3: 100, y3: 10 };
    const piece = subCurve(curve, 0.2, 0.7);
    for (const s of [0, 0.25, 0.5, 1]) {
      const [x, y] = pointOn(piece, s);
      const [ox, oy] = pointOn(curve, 0.2 + 0.5 * s);
      expect(x).toBeCloseTo(ox, 9);
      expect(y).toBeCloseTo(oy, 9);
    }
  });

  it('reuses unchanged circles so lines touching them do not wake up', () => {
    const a = circle('a', 0, 0, 10);
    const b = circle('b', 50, 0, 10);
    const previous = [a, b];
    expect(reuseUnchangedCircles(previous, [{ ...a }, { ...b }])).toBe(previous);
    const moved = reuseUnchangedCircles(previous, [{ ...a }, { ...b, cx: 51 }]);
    expect(moved).not.toBe(previous);
    expect(moved[0]).toBe(a);
    expect(moved[1]).not.toBe(b);
  });
});
