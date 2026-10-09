/**
 * audioEdit.ts — §5.13 (R-4) Vibisound 의 **순수 편집 연산**.
 *
 * 화면도 오디오 장치도 부르지 않는다. 자르기·지우기·페이드·볼륨·WAV 쓰기는 전부 샘플 배열을
 * 다루는 계산이고, 계산은 귀로 검수하는 것보다 단위 테스트가 훨씬 촘촘히 잡는다 — 반 샘플만
 * 어긋나도 "딸깍" 소리가 나지만 그것을 화면으로는 볼 수 없다.
 *
 * 다루는 값은 `AudioBuffer` 가 아니라 **평범한 Float32Array 채널 배열**이다. `AudioBuffer` 는
 * 브라우저 객체라 테스트가 만들 수 없고, 편집 결과를 다시 그 형식으로 굳힐 이유도 없다
 * (재생 직전에 한 번만 만든다).
 */

import { AUDIO_LIMITS } from './constants.js';
export { encodeWav } from './render/wav.js';

/** 편집 중인 소리 한 벌. 채널 수·길이는 채널 배열이 그대로 말한다. */
export interface AudioClip {
  /** 채널별 샘플(-1..1). 모든 채널의 길이는 같다. */
  readonly channels: readonly Float32Array[];
  readonly sampleRate: number;
}

/** 초 → 샘플 번호(범위 밖은 잘라 맞춘다). */
export function timeToSample(clip: AudioClip, seconds: number): number {
  if (Number.isNaN(seconds)) throw new Error('Audio time must not be NaN.');
  const total = clipLength(clip);
  const raw = Math.round(seconds * clip.sampleRate);
  return Math.max(0, Math.min(total, raw));
}

/** 샘플 개수(채널 하나 기준). */
export function clipLength(clip: AudioClip): number {
  return clip.channels[0]?.length ?? 0;
}

/** 길이(초). */
export function clipDuration(clip: AudioClip): number {
  return clip.sampleRate > 0 ? clipLength(clip) / clip.sampleRate : 0;
}

/** `[start, end)` 구간만 남긴다. 구간이 비면 원본 그대로(빈 파일을 만들지 않는다). */
export function cropRange(clip: AudioClip, startSec: number, endSec: number): AudioClip {
  const from = timeToSample(clip, Math.min(startSec, endSec));
  const to = timeToSample(clip, Math.max(startSec, endSec));
  if (to - from <= 0) return clip;
  return {
    sampleRate: clip.sampleRate,
    channels: clip.channels.map((ch) => ch.slice(from, to)),
  };
}

/** `[start, end)` 구간을 지우고 앞뒤를 잇는다. 전체를 지우려 하면 원본 그대로. */
export function deleteRange(clip: AudioClip, startSec: number, endSec: number): AudioClip {
  const from = timeToSample(clip, Math.min(startSec, endSec));
  const to = timeToSample(clip, Math.max(startSec, endSec));
  const total = clipLength(clip);
  if (to - from <= 0 || to - from >= total) return clip;

  return {
    sampleRate: clip.sampleRate,
    channels: clip.channels.map((ch) => {
      const next = new Float32Array(total - (to - from));
      next.set(ch.subarray(0, from), 0);
      next.set(ch.subarray(to), from);
      return next;
    }),
  };
}

/**
 * 구간에 이득을 곱한다. `0` 이면 그 구간이 조용해진다(= 음소거).
 *
 * 구간을 지우는 것과 다르다 — 길이가 그대로라 뒤의 타이밍이 밀리지 않는다.
 */
export function applyGain(clip: AudioClip, startSec: number, endSec: number, gain: number): AudioClip {
  if (!Number.isFinite(gain)) throw new Error('Audio gain must be finite.');
  const from = timeToSample(clip, Math.min(startSec, endSec));
  const to = timeToSample(clip, Math.max(startSec, endSec));
  if (to - from <= 0) return clip;

  return {
    sampleRate: clip.sampleRate,
    channels: clip.channels.map((ch) => {
      const next = Float32Array.from(ch);
      for (let i = from; i < to; i += 1) next[i] = (next[i] ?? 0) * gain;
      return next;
    }),
  };
}

/**
 * 구간에 페이드를 건다. `in` 은 0→1, `out` 은 1→0 (선형).
 *
 * 자른 자리에 페이드를 거는 것이 "딸깍" 을 없애는 가장 흔한 손질이라 자르기와 짝으로 둔다.
 */
export function applyFade(clip: AudioClip, startSec: number, endSec: number, dir: 'in' | 'out'): AudioClip {
  const from = timeToSample(clip, Math.min(startSec, endSec));
  const to = timeToSample(clip, Math.max(startSec, endSec));
  const span = to - from;
  if (span <= 0) return clip;

  return {
    sampleRate: clip.sampleRate,
    channels: clip.channels.map((ch) => {
      const next = Float32Array.from(ch);
      for (let i = from; i < to; i += 1) {
        const p = (i - from) / span;
        next[i] = (next[i] ?? 0) * (dir === 'in' ? p : 1 - p);
      }
      return next;
    }),
  };
}

/**
 * 파형 그리기용 봉우리 — 픽셀 열마다 `[최소, 최대]`.
 *
 * 캔버스 폭이 1,000 인데 샘플이 1천만 개면 그리는 쪽에서 매 프레임 훑을 수 없다. 열 단위로
 * 한 번 접어 두면 그 뒤로는 폭이 바뀔 때만 다시 센다.
 */
export function computePeaks(clip: AudioClip, columns: number): Float32Array {
  if (!Number.isInteger(columns) || columns > AUDIO_LIMITS.maxPeakColumns) throw new Error('Invalid waveform column count.');
  const out = new Float32Array(Math.max(0, columns) * 2);
  const total = clipLength(clip);
  if (columns <= 0 || total === 0) return out;

  const step = total / columns;
  for (let c = 0; c < columns; c += 1) {
    const from = Math.floor(c * step);
    const to = Math.min(total, Math.max(from + 1, Math.floor((c + 1) * step)));
    let min = 1;
    let max = -1;
    for (const ch of clip.channels) {
      for (let i = from; i < to; i += 1) {
        const v = ch[i] ?? 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    out[c * 2] = min > max ? 0 : min;
    out[c * 2 + 1] = min > max ? 0 : max;
  }
  return out;
}

/** `mm:ss.cc` — 초를 사람이 읽는 시간으로. */
export function formatClipTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}
