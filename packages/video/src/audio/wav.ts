/**
 * §5.13 (AA) 42-1 — 소리만 내보내기: 섞은 소리 → WAV(PCM 16비트) 바이트 (순수).
 *
 * 코덱을 만드는 것이 아니다 — WAV 는 머리 44바이트 뒤에 표본을 그대로 늘어놓는 그릇이다((K) 의 "코덱 자체 제작 ❌" 밖). 다른
 * 앱의 라이터를 가져다 쓰지 않는다(앱끼리 서로를 부르면 떼어 낼 수 없다 — (P-3)).
 */

/** 채널별 표본(-1~1)과 표본율 → WAV 바이트. 채널 길이가 다르면 가장 짧은 것에 맞춘다. */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  const channelCount = Math.max(1, channels.length);
  const frames = channels.length === 0 ? 0 : Math.min(...channels.map((c) => c.length));
  const blockAlign = channelCount * 2;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
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
  view.setUint16(22, channelCount, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channelCount; c += 1) {
      const raw = channels[c]?.[i] ?? 0;
      const v = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
      view.setInt16(offset, v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff), true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}
