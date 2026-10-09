import { AUDIO_LIMITS, type AudioClip } from '@vibisual/audio';
import type { SoundRange } from './soundConfig.js';

/** Owns audio nodes independently of React renders. A stopped source can never restart a loop. */
export class SoundEngine {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private generation = 0;
  private closed = false;
  private ctx(): AudioContext {
    if (this.closed) throw new Error('Audio editor is closed');
    this.context ??= new AudioContext({ sampleRate: AUDIO_LIMITS.defaultSampleRate });
    return this.context;
  }
  async decode(bytes: ArrayBuffer): Promise<AudioClip> {
    const buffer = await this.ctx().decodeAudioData(bytes);
    return { sampleRate: buffer.sampleRate, channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)) };
  }
  async play(pcm: AudioClip, from: number, range: SoundRange | null, loop: boolean, ended: () => void): Promise<{ at: number; offset: number; end: number; loopStart: number; looping: boolean }> {
    this.stop();
    const generation = this.generation;
    const ctx = this.ctx();
    await ctx.resume();
    if (this.closed || generation !== this.generation) throw new Error('Playback was canceled');
    const duration = (pcm.channels[0]?.length ?? 0) / pcm.sampleRate;
    const low = Math.max(0, Math.min(range?.start ?? 0, duration));
    const end = Math.max(low, Math.min(range?.end ?? duration, duration));
    if (end <= low) throw new Error('No audio in this range');
    const offset = from >= low && from < end ? from : low;
    const buffer = ctx.createBuffer(pcm.channels.length, pcm.channels[0]?.length ?? 0, pcm.sampleRate);
    pcm.channels.forEach((ch, i) => buffer.copyToChannel(Float32Array.from(ch), i));
    const source = ctx.createBufferSource();
    source.buffer = buffer; source.connect(ctx.destination);
    source.loop = loop; source.loopStart = low; source.loopEnd = end;
    source.onended = () => {
      if (this.source !== source) return;
      source.disconnect(); this.source = null; ended();
    };
    this.source = source;
    if (loop) source.start(0, offset); else source.start(0, offset, end - offset);
    return { at: ctx.currentTime, offset, end, loopStart: low, looping: loop };
  }
  get currentTime(): number { return this.context?.currentTime ?? 0; }
  stop(): void {
    this.generation += 1;
    const source = this.source; this.source = null;
    if (!source) return;
    source.onended = null;
    try { source.stop(); } catch { /* A naturally completed source is already stopped. */ }
    source.disconnect();
  }
  close(): void {
    this.closed = true; this.stop();
    const context = this.context; this.context = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }
}
