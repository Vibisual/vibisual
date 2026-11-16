import { describe, expect, it } from 'vitest';
import { COMPOSITION_LOAD_TIMEOUT_MS, COMPOSITION_SEEK_TIMEOUT_MS, JOB_LEASE_MS, OFFSCREEN_FRAME_TIMEOUT_MS } from './constants.js';

describe('offscreen frame timeout', () => {
  it('outlasts a first composition load plus one seek so the inner, specific failure surfaces first', () => {
    expect(OFFSCREEN_FRAME_TIMEOUT_MS).toBeGreaterThan(COMPOSITION_LOAD_TIMEOUT_MS + COMPOSITION_SEEK_TIMEOUT_MS);
  });
  it('stays inside the render job lease', () => {
    expect(OFFSCREEN_FRAME_TIMEOUT_MS).toBeLessThan(JOB_LEASE_MS);
  });
});
