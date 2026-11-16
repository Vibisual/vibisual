import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDoc } from '../ops.js';
import { resolveTimeline } from '../resolveTimeline.js';
import type { VideoDoc } from '../types.js';
import { hasAudioInRange } from './audioMix.js';
import { audioTotalFrames, audioWindowPlan, createAudioFeed, fitAudioBuffer, type AudioWindowSource } from './audioWindows.js';

class FakeAudioBuffer {
  readonly length: number; readonly numberOfChannels: number; readonly sampleRate: number;
  private readonly data: Float32Array[];
  constructor(o: { length: number; numberOfChannels: number; sampleRate: number }) {
    this.length = o.length; this.numberOfChannels = o.numberOfChannels; this.sampleRate = o.sampleRate;
    this.data = Array.from({ length: o.numberOfChannels }, () => new Float32Array(o.length));
  }
  getChannelData(c: number): Float32Array { return this.data[c]!; }
  copyToChannel(src: Float32Array, c: number): void { this.data[c]!.set(src.subarray(0, this.length)); }
}
beforeEach(() => vi.stubGlobal('AudioBuffer', FakeAudioBuffer));
afterEach(() => vi.unstubAllGlobals());

describe('render audio windows', () => {
  it('splits the total sample count into exact windows with no drift', () => {
    const total = audioTotalFrames(25.0001, 48_000);
    const plan = audioWindowPlan(total, 48_000, 10);
    expect(plan.map((w) => w.from)).toEqual([0, 480_000, 960_000]);
    expect(plan.at(-1)!.to).toBe(total);
    expect(plan.reduce((n, w) => n + w.to - w.from, 0)).toBe(total);
  });

  it('fits mixed buffers to the window length and fills silent windows', () => {
    const long = new FakeAudioBuffer({ length: 5, numberOfChannels: 1, sampleRate: 8 }) as unknown as AudioBuffer;
    long.getChannelData(0).set([1, 2, 3, 4, 5]);
    const fitted = fitAudioBuffer(long, 3, 2, 8);
    expect([...fitted.getChannelData(0)]).toEqual([1, 2, 3]);
    expect([...fitted.getChannelData(1)]).toEqual([1, 2, 3]);
    expect([...fitAudioBuffer(null, 4, 1, 8).getChannelData(0)]).toEqual([0, 0, 0, 0]);
  });

  it('feeds windows just ahead of the frame time and the rest on finish', async () => {
    const asked: { start: number; end: number }[] = [];
    const source: AudioWindowSource = { sampleRate: 10, channels: 1, mix: async (r) => { asked.push(r); return null; } };
    const pushed: number[] = [];
    const feed = createAudioFeed(source, 5, 30, async (b) => { pushed.push(b.length); });
    await feed.ensureThrough(0);
    expect(asked).toEqual([{ start: 5, end: 15 }]);
    await feed.ensureThrough(9.9);
    expect(asked).toHaveLength(1);
    await feed.ensureThrough(10);
    expect(asked).toHaveLength(2);
    await feed.finish();
    expect(asked.at(-1)).toEqual({ start: 25, end: 30 });
    expect(pushed).toEqual([100, 100, 50]);
  });

  it('knows whether a range has any sounding item', () => {
    const doc: VideoDoc = { ...createEmptyDoc('audio', 'Audio'), assets: {
      a: { id: 'a', kind: 'audio', source: { kind: 'file', path: 'a.wav' } },
    }, tracks: [{ id: 'voice', kind: 'audio', items: [{ id: 'a', kind: 'audio', at: 0, duration: 2, assetId: 'a' }] }] };
    const timeline = resolveTimeline(doc);
    expect(hasAudioInRange(doc, timeline)).toBe(true);
    expect(hasAudioInRange(doc, timeline, { start: 2.5, end: 3 })).toBe(false);
    expect(hasAudioInRange({ ...doc, assets: {} }, timeline)).toBe(false);
  });
});
