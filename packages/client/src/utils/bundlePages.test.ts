import { describe, expect, it } from 'vitest';
import { BUNDLE_BUBBLE } from '@vibisual/shared';
import { bundlePageWindow } from './bundlePages.js';

describe('bundlePageWindow', () => {
  it('makes every member reachable while bounding one layout page', () => {
    const count = BUNDLE_BUBBLE.interiorMax * 2 + 7;
    const visited: number[] = [];
    for (let page = 0; page < 3; page += 1) {
      const win = bundlePageWindow(count, page);
      expect(win.pages).toBe(3);
      expect(win.end - win.start).toBeLessThanOrEqual(BUNDLE_BUBBLE.interiorMax);
      for (let i = win.start; i < win.end; i += 1) visited.push(i);
    }
    expect(visited).toEqual(Array.from({ length: count }, (_, i) => i));
  });
  it('clamps pages after members shrink or the bundle becomes empty', () => {
    expect(bundlePageWindow(0, 20)).toEqual({ page: 0, pages: 1, start: 0, end: 0 });
    expect(bundlePageWindow(5, -1)).toEqual({ page: 0, pages: 1, start: 0, end: 5 });
  });
});
