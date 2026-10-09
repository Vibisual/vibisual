import type { Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { IFRAME_BUBBLE_HEIGHT } from '@vibisual/shared';
import { edgeMaskCircles } from './edgeMaskGeometry.js';

const bubble = (id: string, x: number, y: number, size = 80): Node => ({
  id, type: 'bubble', position: { x, y }, data: { id, bubbleType: 'file' }, measured: { width: size, height: size },
});

describe('edge occluder circles (§5.4 #31 (K))', () => {
  it('cuts each bubble just inside its measured circle, falling back to the rendered size', () => {
    const unmeasured: Node = { id: 'preview', type: 'bubble', position: { x: 10, y: 20 }, data: { id: 'preview', bubbleType: 'iframe' } };
    const [measured, fallback] = edgeMaskCircles([bubble('agent', 0, 0), unmeasured], undefined);
    expect(measured).toEqual({ id: 'agent', cx: 40, cy: 40, r: 36 });
    const half = IFRAME_BUBBLE_HEIGHT / 2;
    expect(fallback).toEqual({ id: 'preview', cx: 10 + half, cy: 20 + half, r: half - 4 });
  });
});
