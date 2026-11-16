import { describe, expect, it } from 'vitest';
import { canvasMemoExitPoint } from './canvasMemoTransfer.js';

const bounds = { x: 100, y: 100, w: 600, h: 400 };
const canvas = { x: 0, y: 0, w: 1600, h: 1000 };

describe('memo canvas exit threshold', () => {
  it.each([
    { card: { x: 0, y: 200, w: 300, h: 150 }, point: { x: 50, y: 275 } },
    { card: { x: 500, y: 200, w: 300, h: 150 }, point: { x: 750, y: 275 } },
    { card: { x: 200, y: 50, w: 300, h: 150 }, point: { x: 350, y: 75 } },
    { card: { x: 200, y: 400, w: 300, h: 150 }, point: { x: 350, y: 525 } },
  ])('arms at one third outside an IDE edge, $point', ({ card, point }) => {
    expect(canvasMemoExitPoint({ card, bounds }, canvas)).toEqual(point);
  });
  it.each([
    { x: 1, y: 200, w: 300, h: 150 },
    { x: 499, y: 200, w: 300, h: 150 },
    { x: 200, y: 51, w: 300, h: 150 },
    { x: 200, y: 399, w: 300, h: 150 },
  ])('stays in the IDE below the threshold, $x $y', (card) => {
    expect(canvasMemoExitPoint({ card, bounds }, canvas)).toBeNull();
  });
  it('probes the visible part of the canvas when the note also extends past the application edge', () => {
    const card = { x: 500, y: 200, w: 300, h: 150 };
    expect(canvasMemoExitPoint({ card, bounds }, { x: 700, y: 100, w: 60, h: 400 })).toEqual({ x: 730, y: 275 });
    expect(canvasMemoExitPoint({ card, bounds }, { x: 800, y: 100, w: 60, h: 400 })).toBeNull();
  });
  it('rejects unavailable card or IDE dimensions', () => {
    expect(canvasMemoExitPoint({ card: { x: 0, y: 0, w: 0, h: 150 }, bounds }, canvas)).toBeNull();
    expect(canvasMemoExitPoint({ card: { x: 0, y: 0, w: 300, h: 150 }, bounds: { ...bounds, w: 0 } }, canvas)).toBeNull();
  });
});
