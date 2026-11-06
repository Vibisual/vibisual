import { describe, expect, it } from 'vitest';
import type { BubbleData } from '@vibisual/shared';
import { buildPreviewInventory, orderPreviewKeys } from './previewBundleInventory.js';

function node(key: string, lastActivity: number): BubbleData {
  return { id: key, path: key, label: key, bubbleType: 'file', activity: 1, status: 'idle', lastActivity };
}

describe('compiled preview ordering', () => {
  it('matches recent activity and UTF-16 lexical ties including non-BMP names', () => {
    const keys = ['A/가.png', 'A/𐐀.png', 'A/\uffff.png', 'A/a.png', 'A/B.png', 'A/z.png'];
    const nodes = new Map(keys.map((key, i) => [key, node(key, i < 4 ? 9 : 11)]));
    const reference = [...keys].sort((a, b) => nodes.get(b)!.lastActivity! - nodes.get(a)!.lastActivity!
      || (a < b ? -1 : a > b ? 1 : 0));
    expect(orderPreviewKeys(keys, nodes)).toEqual(reference);
    expect(orderPreviewKeys([], nodes)).toEqual([]);
    expect(orderPreviewKeys(keys.slice(0, 1), nodes)).toEqual(keys.slice(0, 1));
  });

  it('groups every preview by kind across sessions and keeps session groups beside them', () => {
    const keys = ['assets/a.png', 'assets/b.png', 'assets/shared.png', 'assets/page.html', 'assets/unknown.png'];
    const nodes = new Map(keys.map((key, i) => [key, node(key, i)]));
    const sessions = new Map<string, string[]>([
      [keys[0]!, ['alpha']], [keys[1]!, ['beta']], [keys[2]!, ['alpha', 'beta']], [keys[3]!, ['alpha']], [keys[4]!, []],
    ]);
    const groups = buildPreviewInventory(keys, nodes, sessions);
    expect(groups.get('image')?.keys).toEqual(['assets/unknown.png', 'assets/shared.png', 'assets/b.png', 'assets/a.png']);
    expect(groups.get('image:alpha')?.keys).toEqual(['assets/shared.png', 'assets/a.png']);
    expect(groups.get('image:beta')?.keys).toEqual(['assets/shared.png', 'assets/b.png']);
    expect(groups.get('code')?.keys).toEqual(['assets/page.html']);
    expect(groups.get('code:alpha')?.keys).toEqual(['assets/page.html']);
    expect([...groups.values()].every((group) => group.dir === 'assets')).toBe(true);
  });

  it('matches the reference for a large deterministic input with tied timestamps', () => {
    const keys = Array.from({ length: 10000 }, (_, i) => `media/${(i * 7919) % 10007}/shot-${i}.png`);
    const nodes = new Map(keys.map((key, i) => [key, node(key, (i * 13) % 97)]));
    const reference = [...keys].sort((a, b) => nodes.get(b)!.lastActivity! - nodes.get(a)!.lastActivity!
      || (a < b ? -1 : a > b ? 1 : 0));
    expect(orderPreviewKeys(keys, nodes)).toEqual(reference);
  });
});
