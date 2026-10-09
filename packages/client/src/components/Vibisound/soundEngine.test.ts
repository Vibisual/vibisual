import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundEngine } from './soundEngine.js';

class FakeSource {
  buffer: unknown; loop = false; loopStart = 0; loopEnd = 0;
  onended: (() => void) | null = null;
  connect = vi.fn(); disconnect = vi.fn(); start = vi.fn();
  stop = vi.fn(() => this.onended?.());
}
class FakeContext {
  static instances: FakeContext[] = [];
  sources: FakeSource[] = []; state = 'running'; currentTime = 5; destination = {};
  resume = vi.fn(async (): Promise<void> => undefined);
  close = vi.fn(async () => { this.state = 'closed'; });
  createBuffer = vi.fn(() => ({ copyToChannel: vi.fn() }));
  createBufferSource(): FakeSource { const source = new FakeSource(); this.sources.push(source); return source; }
  constructor() { FakeContext.instances.push(this); }
}
const pcm = { sampleRate: 10, channels: [new Float32Array(100)] };
describe('audio playback lifetime', () => {
  beforeEach(() => { FakeContext.instances = []; vi.stubGlobal('AudioContext', FakeContext); });
  afterEach(() => vi.unstubAllGlobals());
  it('stopping a native loop cannot restart it through an ended callback', async () => {
    const engine = new SoundEngine(); const ended = vi.fn();
    const state = await engine.play(pcm, 0, { start: 2, end: 4 }, true, ended);
    const context = FakeContext.instances[0]!; const source = context.sources[0]!;
    expect(state.offset).toBe(2); expect(source.loopStart).toBe(2); expect(source.loopEnd).toBe(4);
    expect(source.start).toHaveBeenCalledWith(0, 2);
    engine.stop();
    expect(source.onended).toBeNull(); expect(ended).not.toHaveBeenCalled();
    expect(context.sources).toHaveLength(1); expect(source.disconnect).toHaveBeenCalledOnce();
    engine.close();
  });
  it('a stop during suspended AudioContext resume cancels the pending play', async () => {
    const engine = new SoundEngine();
    await engine.play(pcm, 0, null, false, vi.fn()); engine.stop();
    const context = FakeContext.instances[0]!;
    let resume!: () => void;
    context.resume.mockImplementationOnce(() => new Promise<void>(resolve => { resume = resolve; }));
    const pending = engine.play(pcm, 0, null, true, vi.fn());
    engine.stop(); resume();
    await expect(pending).rejects.toThrow('canceled');
    expect(context.sources).toHaveLength(1);
    engine.close();
  });
  it('stale ended events cannot stop the replacement playback', async () => {
    const engine = new SoundEngine(); const oldEnded = vi.fn(); const newEnded = vi.fn();
    await engine.play(pcm, 8, { start: 1, end: 3 }, false, oldEnded);
    const context = FakeContext.instances[0]!; const source = context.sources[0]!; const stale = source.onended!;
    expect(source.start).toHaveBeenCalledWith(0, 1, 2);
    await engine.play(pcm, 4, null, false, newEnded); stale();
    expect(oldEnded).not.toHaveBeenCalled(); expect(newEnded).not.toHaveBeenCalled();
    context.sources[1]!.onended?.(); expect(newEnded).toHaveBeenCalledOnce();
    engine.close(); expect(context.close).toHaveBeenCalledOnce();
    await expect(engine.play(pcm, 0, null, false, vi.fn())).rejects.toThrow('closed');
  });
});
