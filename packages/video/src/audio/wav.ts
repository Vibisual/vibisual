/**
 * §5.13 (AA) 42-1 — 섞은 소리 → WAV(PCM 16비트) 바이트(순수). WAV 는 머리 44바이트 + 표본이라 코덱 제작이 아니다((K) 밖).
 * 다른 앱의 라이터를 쓰지 않는다(앱끼리 부르면 못 뗀다 — (P-3)). 42-11 — 머리와 표본을 따로 지어 창마다 흘려 보낼 수 있다.
 */

export const WAV_HEADER_BYTES = 44;

/** 전체 표본 수를 아는 WAV 머리(44바이트). */
export function wavHeader(frames: number, channelCount: number, sampleRate: number): Uint8Array {
  const channels = Math.max(1, channelCount);
  const blockAlign = channels * 2;
  const dataSize = Math.max(0, frames) * blockAlign;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  const rate = Math.max(1, Math.round(sampleRate));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);
  return new Uint8Array(buffer);
}

/** 채널별 표본(-1~1) → 끼운 PCM 16비트. `frames` 를 넘는 표본은 버리고 모자라면 0 으로 채운다. */
export function encodePcm16(channels: readonly Float32Array[], frames: number, channelCount = Math.max(1, channels.length)): Uint8Array {
  const out = new Uint8Array(Math.max(0, frames) * channelCount * 2);
  const view = new DataView(out.buffer);
  let offset = 0;
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channelCount; c += 1) {
      const raw = channels[c]?.[i] ?? 0;
      const v = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
      view.setInt16(offset, v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff), true);
      offset += 2;
    }
  }
  return out;
}

/** 채널별 표본(-1~1)과 표본율 → WAV 바이트. 채널 길이가 다르면 가장 짧은 것에 맞춘다. */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  const channelCount = Math.max(1, channels.length);
  const frames = channels.length === 0 ? 0 : Math.min(...channels.map((c) => c.length));
  const head = wavHeader(frames, channelCount, sampleRate);
  const body = encodePcm16(channels, frames, channelCount);
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}
