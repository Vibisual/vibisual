import type { AudioClip } from '../audioEdit.js';
import { assertRenderSize, clipSample, validatePcm } from './pcm.js';

/** PCM16 WAV without external encoders. The mixer already applies output clipping. */
export function encodeWav(clip: AudioClip): Uint8Array {
  const channels = clip.channels.length > 0 ? clip.channels : [new Float32Array(0)];
  const frames = validatePcm({ ...clip, channels });
  const channelCount = channels.length;
  assertRenderSize(frames, channelCount);
  const blockAlign = channelCount * 2;
  const dataBytes = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, clip.sampleRate, true);
  view.setUint32(28, clip.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    for (const channel of channels) {
      const sample = clipSample(channel[i] ?? 0);
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}
