/**
 * §5.13 (AA) 42-11 — 소리를 창 단위로 섞어 흘려 넣는다. 문서 전체를 한 버퍼로 섞으면 길이에 비례해 메모리를 잡고,
 * 맨 끝에 한꺼번에 넣으면 그릇(WebM)이 시간순 끼우기 때문에 인코딩된 영상 전체를 붙잡는다.
 * 창 경계는 표본 번호로 정한다 — 초로 자르면 창마다 올림이 쌓여 소리가 영상보다 밀린다.
 */

/** 렌더 창 길이(초). 창 하나 = 48kHz 스테레오 float 기준 약 3.8MB. */
export const RENDER_AUDIO_WINDOW_S = 10;
/** 렌더 소리 판(`mixAudio` 기본값과 같다). */
export const RENDER_AUDIO_SAMPLE_RATE = 48_000;
export const RENDER_AUDIO_CHANNELS = 2;

/** 창 하나를 섞어 주는 쪽. null = 그 창은 무음. */
export interface AudioWindowSource {
  readonly sampleRate: number;
  readonly channels: number;
  /** 문서 시각 `[start, end)` 의 소리(0 표본 = `start`). 길이는 렌더가 표본 수로 맞춘다. */
  mix(range: { readonly start: number; readonly end: number }): Promise<AudioBuffer | null>;
}

export interface AudioWindow {
  /** 구간 시작부터 센 표본 번호 `[from, to)`. */
  readonly from: number;
  readonly to: number;
}

/** 구간 길이(초)의 전체 표본 수 — 한 번에 섞을 때(`mixAudio`)와 같은 올림. */
export function audioTotalFrames(durationSec: number, sampleRate: number): number {
  return Math.max(1, Math.ceil(Math.max(0, durationSec) * sampleRate));
}

/** 전체 표본을 `windowSec` 창으로 나눈다(마지막 창은 남은 만큼). */
export function audioWindowPlan(totalFrames: number, sampleRate: number, windowSec = RENDER_AUDIO_WINDOW_S): AudioWindow[] {
  const step = Math.max(1, Math.round(windowSec * sampleRate));
  const out: AudioWindow[] = [];
  for (let from = 0; from < totalFrames; from += step) out.push({ from, to: Math.min(totalFrames, from + step) });
  return out;
}

/** 섞은 버퍼를 정확히 `length` 표본·`channels` 채널로 맞춘다(같으면 그대로, 없으면 무음). */
export function fitAudioBuffer(buffer: AudioBuffer | null, length: number, channels: number, sampleRate: number): AudioBuffer {
  if (buffer && buffer.length === length && buffer.numberOfChannels === channels && buffer.sampleRate === sampleRate) return buffer;
  const out = new AudioBuffer({ length: Math.max(1, length), numberOfChannels: channels, sampleRate });
  if (buffer) {
    for (let c = 0; c < channels; c += 1) {
      const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
      out.copyToChannel(src.subarray(0, Math.min(src.length, length)), c);
    }
  }
  return out;
}

/**
 * 구간 `[start, end)`(문서 초)의 소리를 창마다 섞어 `push` 로 넘긴다. `ensureThrough(t)` 는 구간 시각 `t`(파일 시각)까지 덮을 만큼만
 * 앞서 넣는다 — 영상 프레임을 넣기 전에 부르면 소리가 늘 한 창 안쪽으로만 앞선다. `finish()` 는 남은 창을 다 넣는다.
 */
export function createAudioFeed(source: AudioWindowSource, start: number, end: number, push: (buffer: AudioBuffer) => Promise<void>): {
  ensureThrough(t: number): Promise<void>;
  finish(): Promise<void>;
} {
  const sr = source.sampleRate;
  const windows = audioWindowPlan(audioTotalFrames(end - start, sr), sr);
  let next = 0;
  const feedOne = async (): Promise<void> => {
    const w = windows[next]!;
    next += 1;
    const mixed = await source.mix({ start: start + w.from / sr, end: start + w.to / sr });
    await push(fitAudioBuffer(mixed, w.to - w.from, source.channels, sr));
  };
  return {
    async ensureThrough(t: number): Promise<void> {
      while (next < windows.length && windows[next]!.from / sr <= t) await feedOne();
    },
    async finish(): Promise<void> {
      while (next < windows.length) await feedOne();
    },
  };
}
