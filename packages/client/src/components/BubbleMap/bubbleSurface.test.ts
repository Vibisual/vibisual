import { describe, expect, it } from 'vitest';
import { BUBBLE_SKINS } from '@vibisual/shared';
import { bubbleSurface } from './bubbleSurface.js';

describe('bubble surface semantic priority', () => {
  it.each(BUBBLE_SKINS)('$id leaves status and connection borders authoritative', ({ id }) => {
    for (const status of ['active', 'completed', 'error', 'awaiting_permission'] as const) {
      for (const options of [{}, { heatmap: true }]) {
        const paint = bubbleSurface(id, '#5795e8', '#a9ceff', status, options);
        expect(paint.body.borderColor).toBeUndefined();
        expect(paint.body.boxShadow).toBeUndefined();
        expect(paint.body.borderWidth).toBe(2);
      }
    }
    const target = bubbleSurface(id, '#5795e8', '#a9ceff', 'active', { highlighted: true, heatmap: true });
    expect(target.body.borderColor).toBeUndefined();
    expect(target.body.boxShadow).toBeUndefined();
    expect(target.body.borderWidth).toBe(4);
  });

  it.each(BUBBLE_SKINS)('$id preserves creation failure and never returns layout or event styling', ({ id }) => {
    const paint = bubbleSurface(id, '#5795e8', '#a9ceff', 'idle', { creatingError: true, heatmap: true });
    expect(paint.body.background).toContain('#ef4444');
    expect(paint.inner.opacity).toBe(0);
    for (const key of Object.keys(paint.body)) expect(['background', 'borderColor', 'borderWidth', 'boxShadow']).toContain(key);
    expect(paint.contextOpacity).toBeGreaterThan(0);
    expect(paint.contextOpacity).toBeLessThanOrEqual(1);
  });

  it('retains custom and heat colors in all surfaces without sharing mutable state', () => {
    for (const { id } of BUBBLE_SKINS) {
      const base = bubbleSurface(id, '#de713a', '#f1bc89', 'idle');
      expect(base.inner.borderColor).toBe('#de713a');
      bubbleSurface(id, '#de713a', '#f1bc89', 'error');
      expect(bubbleSurface(id, '#de713a', '#f1bc89', 'idle')).toEqual(base);
    }
  });

  it.each(BUBBLE_SKINS)('$id keeps the chosen outer rim and removes interior line decorations from the heat material', ({ id }) => {
    const normal = bubbleSurface(id, '#de713a', '#f1bc89', 'idle');
    const heat = bubbleSurface(id, '#de713a', '#f1bc89', 'idle', { heatmap: true });
    expect(heat.body.background).not.toBe(normal.body.background);
    expect(heat.body.borderColor).toBe(normal.body.borderColor);
    expect(heat.body.borderWidth).toBe(normal.body.borderWidth);
    expect(heat.body.boxShadow).toBe(normal.body.boxShadow);
    expect(heat.inner.borderWidth).toBe(normal.inner.borderWidth);
    expect(heat.inner.opacity).toBe(0);
    expect(heat.specular).toBe(false);
    expect(bubbleSurface(id, '#de713a', '#f1bc89', 'idle')).toEqual(normal);
  });
});
