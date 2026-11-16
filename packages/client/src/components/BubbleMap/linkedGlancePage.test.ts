import { describe, expect, it } from 'vitest';
import type { AppLinkedItem } from '../../apps/registry.js';
import { linkedGlancePage } from './linkedGlancePage.js';

const items: AppLinkedItem[] = Array.from({ length: 149 }, (_, i) => ({
  id: String(i), group: i < 24 ? 'scene' : 'part', kind: i < 24 ? 'scene' : 'image', label: `Item ${i}`,
}));

describe('compact connected item pages', () => {
  it('keeps all 149 items reachable without increasing the six-tile budget', () => {
    const seen: string[] = [];
    for (const group of ['scene', 'part'] as const) {
      const first = linkedGlancePage(items, [], group, 0);
      for (let page = 0; page < first.pages; page++) {
        const current = linkedGlancePage(items, [], group, page);
        expect(current.items.length).toBeLessThanOrEqual(6);
        seen.push(...current.items.map((item) => item.id));
      }
    }
    expect(seen).toEqual(items.map((item) => item.id));
  });
  it('clamps a removed last page and falls back when an entire group disappears', () => {
    expect(linkedGlancePage(items.slice(0, 8), [], 'scene', 3).items.map((item) => item.id)).toEqual(['6', '7']);
    expect(linkedGlancePage(items.slice(24), [], 'scene', 3)).toMatchObject({ group: 'part', page: 0, total: 125 });
  });
  it('handles past-only and empty nodes without invalid pages', () => {
    const past = Array.from({ length: 9 }, (_, i) => ({ file: `${i}.png`, at: i }));
    expect(linkedGlancePage([], past, 'scene', 0)).toMatchObject({ group: 'past', page: 0, pages: 2 });
    expect(linkedGlancePage([], past, 'past', 20).past).toEqual(past.slice(6));
    expect(linkedGlancePage([], [], 'part', -1)).toMatchObject({ total: 0, page: 0, pages: 1, groups: [] });
  });
});
