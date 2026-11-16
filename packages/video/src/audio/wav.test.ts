import { describe, expect, it } from 'vitest';
import { WAV_HEADER_BYTES, encodePcm16, encodeWav, wavHeader } from './wav.js';

describe('WAV streaming parts', () => {
  it('header plus per-window PCM equals the one-shot encoding', () => {
    const left = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i / 7));
    const right = Float32Array.from({ length: 1000 }, (_, i) => Math.cos(i / 5) * 0.5);
    const whole = encodeWav([left, right], 48_000);
    const parts = [wavHeader(1000, 2, 48_000)];
    for (let from = 0; from < 1000; from += 300) {
      const to = Math.min(1000, from + 300);
      parts.push(encodePcm16([left.subarray(from, to), right.subarray(from, to)], to - from, 2));
    }
    const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { joined.set(p, at); at += p.length; }
    expect(joined).toEqual(whole);
    expect(whole.length).toBe(WAV_HEADER_BYTES + 1000 * 2 * 2);
  });

  it('pads missing samples with silence to the requested frame count', () => {
    expect([...encodePcm16([new Float32Array([1])], 2, 2)]).toEqual([0xff, 0x7f, 0, 0, 0, 0, 0, 0]);
  });
});
