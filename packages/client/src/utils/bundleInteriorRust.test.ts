import { describe, expect, it } from 'vitest';
import { createCompute, packBundleGeometry } from '@vibisual/compute';
import { BUNDLE_BUBBLE, type BubbleData, type HeatScale } from '@vibisual/shared';
import { packBundleInterior, prepareBundleInterior } from './bundleInteriorLayout.js';
import { packBundleInteriorReference } from './bundleInteriorLayout.reference.js';
import { withBundleUsageRange } from './sizeCalc.js';

const back: BubbleData = { id: 'back', label: 'Back', bubbleType: 'back', path: '', status: 'idle', activity: 1 };
const files = (count: number, offset: number): BubbleData[] => Array.from({ length: count }, (_, i) => ({
  id: `file-${offset}-${i}`, label: i % 3 === 0 ? `한글 名称 가나 ${i}.png` : `long-name-${i}.png`,
  path: `assets/${i}.png`, bubbleType: 'file', status: 'idle', activity: 1,
  readCount: (i * 13 + offset) % 19, lastActivity: i % 4,
}));

describe('compiled Rust bundle packing', () => {
  it('runs the compiled geometry export and rejects malformed numeric buffers', () => {
    expect(typeof createCompute().exports.bundle_pack).toBe('function');
    expect(() => packBundleGeometry(new Float64Array(1), 1, 48)).toThrow(RangeError);
    const plan = prepareBundleInterior([], null, { x: 0, y: 0 }, undefined);
    const invalid = plan.input.slice();
    invalid[0] = Number.NaN;
    expect(() => packBundleGeometry(invalid, 0, plan.directions)).toThrow('Rust bundle packing failed');
  });

  for (const count of [0, 1, 2, 9, 24, BUNDLE_BUBBLE.interiorMax]) {
    it(`matches reference coordinates and order exactly for ${count} members`, () => {
      const members = withBundleUsageRange(files(count, count));
      const original = members.map((member) => ({ ...member }));
      const center = { x: count % 2 === 0 ? 500 : -17.25, y: 400.125 };
      const expected = packBundleInteriorReference(members, back, center, undefined);
      expect(packBundleInterior(members, back, center, undefined)).toEqual(expected);
      expect(members).toEqual(original);
    });
  }

  it('preserves heat scaling, ties, reverse input, and cached results', () => {
    const members = withBundleUsageRange(files(12, 99));
    const heat: HeatScale = { max: 20, axis: 'read', curve: 'linear' };
    const center = { x: -15.5, y: -24 };
    const expected = packBundleInteriorReference(members, null, center, heat);
    const first = packBundleInterior(members, null, center, heat);
    expect(first).toEqual(expected);
    expect(packBundleInterior([...members].reverse(), null, center, heat)).toBe(first);
  });
});
