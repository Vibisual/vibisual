import { describe, expect, it } from 'vitest';
import { previewWarmPolicy } from './previewPolicy.js';

describe('preview warm resource limits', () => {
  it.each([
    { hardwareConcurrency: 2, deviceMemory: 16 },
    { hardwareConcurrency: 24, deviceMemory: 2 },
    { hardwareConcurrency: 4 },
    { deviceMemory: 4 },
  ])('does not let a stronger resource hide a limited one: %j', hints => {
    const policy = previewWarmPolicy(hints);
    expect(policy.aheadMax).toBe(1);
    expect(policy.keepParked).toBe(0);
    expect(policy.aheadSeconds).toBeLessThanOrEqual(3);
    expect(policy.parkedTtlMs).toBeLessThanOrEqual(5_000);
  });

  it.each([{}, { hardwareConcurrency: 32 }, { deviceMemory: 16 }, { hardwareConcurrency: 8, deviceMemory: 8 }])(
    'uses bounded defaults unless both CPU and memory support more work: %j', hints => {
      const policy = previewWarmPolicy(hints);
      expect(policy.aheadMax).toBe(1);
      expect(policy.keepParked).toBeLessThanOrEqual(1);
      expect(policy.parkedTtlMs).toBeLessThanOrEqual(15_000);
    },
  );

  it('keeps even a capable PC within a small finite warm window', () => {
    const ordinary = previewWarmPolicy({});
    const capable = previewWarmPolicy({ hardwareConcurrency: 32, deviceMemory: 16 });
    expect(capable.aheadSeconds).toBeGreaterThan(ordinary.aheadSeconds);
    expect(capable.aheadMax).toBeLessThanOrEqual(2);
    expect(capable.keepParked).toBeLessThanOrEqual(2);
    expect(capable.parkedTtlMs).toBeLessThanOrEqual(30_000);
  });
});
