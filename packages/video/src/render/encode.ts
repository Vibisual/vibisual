/**
 * §5.13 (F) Mediabunny 인코딩 래퍼 — 프레임을 어디서 얻든 출구는 하나다(갈리면 방식마다 다른 파일이 나온다).
 * 코덱은 박지 않고 이 기기가 실제로 인코딩할 수 있는 것을 물어 고른다(박으면 없는 환경에서 조용히 실패). (X) 39-2 — 인코딩을 시작할 때 불러온다(`loadMediabunny`).
 */

import type {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Output,
  AudioCodec,
  Quality,
  VideoCodec,
} from 'mediabunny';

import { loadMediabunny } from './media.js';

/** 선호 순서. 앞에서부터 이 기기가 할 수 있는 것을 고른다. */
const VIDEO_CODEC_PREFERENCE: readonly VideoCodec[] = ['avc', 'vp9', 'av1', 'vp8'];
const AUDIO_CODEC_PREFERENCE: readonly AudioCodec[] = ['aac', 'opus'];
/**
 * §5.13 (W) 38-3 — 투명 배경(WebM). 알파를 곁 데이터로 싣는 코덱만(실측: Mediabunny 1.52.2 + VP9 `alpha:'keep'` → 디코딩에서
 * 투명 0·반투명 128·불투명 255 유지). 소리는 WebM 이 받는 Opus.
 */
const ALPHA_VIDEO_CODEC_PREFERENCE: readonly VideoCodec[] = ['vp9', 'vp8'];
const WEBM_AUDIO_CODEC_PREFERENCE: readonly AudioCodec[] = ['opus'];

/** 출력 그릇 — 보통은 mp4, 투명 배경이면 webm. */
export type OutputContainer = 'mp4' | 'webm';

/** 품질 이름 — 실제 값(Mediabunny `Quality`)은 인코딩을 시작할 때 꺼낸다(39-2). */
export type EncodeQualityLevel = 'very-low' | 'low' | 'medium' | 'high' | 'very-high';

export interface EncodeQuality {
  readonly video: EncodeQualityLevel;
  readonly audio: EncodeQualityLevel;
}

export const ENCODE_QUALITY_HIGH: EncodeQuality = { video: 'high', audio: 'high' };
export const ENCODE_QUALITY_DRAFT: EncodeQuality = { video: 'medium', audio: 'medium' };

function qualityOf(mb: typeof import('mediabunny'), level: EncodeQualityLevel): Quality {
  switch (level) {
    case 'very-low': return mb.QUALITY_VERY_LOW;
    case 'low': return mb.QUALITY_LOW;
    case 'medium': return mb.QUALITY_MEDIUM;
    case 'very-high': return mb.QUALITY_VERY_HIGH;
    default: return mb.QUALITY_HIGH;
  }
}

export interface PickedCodecs {
  readonly video: VideoCodec | null;
  readonly audio: AudioCodec | null;
}

/**
 * 이 기기가 실제로 인코딩할 수 있는 코덱을 고른다. `alpha` 면 알파를 싣는 코덱(WebM)만 본다. §5.13 (AA) 42-1 — 그릇이 `webm` 이면
 * (투명이 아니어도) WebM 이 받는 코덱(VP9·VP8 + Opus)만 본다.
 */
export async function pickCodecs(width: number, height: number, withAudio: boolean, alpha = false, container: OutputContainer = alpha ? 'webm' : 'mp4'): Promise<PickedCodecs> {
  const webm = alpha || container === 'webm';
  const videoPreference = webm ? ALPHA_VIDEO_CODEC_PREFERENCE : VIDEO_CODEC_PREFERENCE;
  const audioPreference = webm ? WEBM_AUDIO_CODEC_PREFERENCE : AUDIO_CODEC_PREFERENCE;
  const { canEncodeAudio, canEncodeVideo } = await loadMediabunny();
  let video: VideoCodec | null = null;
  for (const codec of videoPreference) {
    try {
      if (await canEncodeVideo(codec, { width, height })) {
        video = codec;
        break;
      }
    } catch {
      // 이 코덱은 물어보는 것조차 실패했다 — 다음 후보로.
    }
  }

  let audio: AudioCodec | null = null;
  if (withAudio) {
    for (const codec of audioPreference) {
      try {
        if (await canEncodeAudio(codec)) {
          audio = codec;
          break;
        }
      } catch {
        // 다음 후보로.
      }
    }
  }

  return { video, audio };
}

export interface VideoEncoderOptions {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly quality?: EncodeQuality;
  readonly withAudio?: boolean;
  /** 키프레임 간격(초). 잦으면 탐색이 빨라지고 파일이 커진다. */
  readonly keyFrameInterval?: number;
  /** §5.13 (W) 38-3 — 투명 배경: WebM + 알파를 싣는 코덱(`alpha:'keep'`). */
  readonly alpha?: boolean;
  /** §5.13 (AA) 42-1 — 그릇(없으면 mp4 · 투명이면 늘 webm). */
  readonly container?: OutputContainer;
}

/** `start()` → `addFrame(t)`… → (선택) `addAudio` → `finish()`. `addFrame` 의 약속을 반드시 기다린다 — 안 기다리면 인코더가 밀릴 때 메모리가 끝없이 는다. */
export class VideoEncoder {
  private output: Output | null = null;
  private videoSource: CanvasSource | null = null;
  private audioSource: AudioBufferSource | null = null;
  private codecs: PickedCodecs = { video: null, audio: null };
  private finished = false;

  constructor(private readonly opts: VideoEncoderOptions) {}

  get pickedCodecs(): PickedCodecs {
    return this.codecs;
  }

  /** 이 출력의 그릇(mp4 · 투명이면 webm). */
  get container(): OutputContainer {
    return this.opts.alpha === true ? 'webm' : this.opts.container ?? 'mp4';
  }

  async start(): Promise<void> {
    const { width, height, canvas, fps } = this.opts;
    const quality = this.opts.quality ?? ENCODE_QUALITY_HIGH;
    const withAudio = this.opts.withAudio ?? false;
    const alpha = this.opts.alpha === true;

    const container = this.container;
    this.codecs = await pickCodecs(width, height, withAudio, alpha, container);
    if (this.codecs.video === null) {
      // §5.13 (W) 38-3 — 투명 배경을 시켰는데 알파 코덱이 없으면 불투명 영상으로 조용히 내보내지 않는다.
      throw new Error(alpha
        ? '이 기기에서 투명 배경(VP9/VP8 알파)을 인코딩할 수 없습니다.'
        : '이 기기에서 인코딩할 수 있는 영상 코덱을 찾지 못했습니다.');
    }

    const mb = await loadMediabunny();
    const output = new mb.Output({ format: container === 'webm' ? new mb.WebMOutputFormat() : new mb.Mp4OutputFormat(), target: new mb.BufferTarget() });

    const videoSource = new mb.CanvasSource(canvas, {
      codec: this.codecs.video,
      quality: qualityOf(mb, quality.video),
      keyFrameInterval: this.opts.keyFrameInterval ?? 2,
      ...(alpha ? { alpha: 'keep' as const } : {}),
    });
    output.addVideoTrack(videoSource, { frameRate: fps });

    if (withAudio && this.codecs.audio !== null) {
      const audioSource = new mb.AudioBufferSource({ codec: this.codecs.audio, quality: qualityOf(mb, quality.audio) });
      output.addAudioTrack(audioSource);
      this.audioSource = audioSource;
    }

    await output.start();
    this.output = output;
    this.videoSource = videoSource;
  }

  /** 지금 캔버스에 그려져 있는 것을 한 프레임으로 넣는다. */
  async addFrame(timestamp: number): Promise<void> {
    const source = this.videoSource;
    if (!source) throw new Error('start 를 먼저 부르세요.');
    await source.add(timestamp, 1 / this.opts.fps);
  }

  /** 소리를 통째로 넣는다. 프레임과 달리 구간 단위라 한 번에 준다. */
  async addAudio(buffer: AudioBuffer): Promise<void> {
    const source = this.audioSource;
    if (!source) return; // 오디오 트랙이 없는 출력이면 조용히 건너뛴다.
    await source.add(buffer);
  }

  /** 마무리하고 파일 바이트를 돌려준다. */
  async finish(): Promise<Uint8Array> {
    const output = this.output;
    if (!output) throw new Error('start 를 먼저 부르세요.');
    this.videoSource?.close();
    this.audioSource?.close();
    await output.finalize();
    this.finished = true;

    const target = output.target as BufferTarget;
    const buffer = target.buffer;
    if (!buffer) throw new Error('인코딩 결과가 비어 있습니다.');
    return new Uint8Array(buffer);
  }

  /** 도중에 그만둔다. 이미 끝난 뒤에는 아무 일도 하지 않는다. */
  async cancel(): Promise<void> {
    if (this.finished || !this.output) return;
    try {
      await this.output.cancel();
    } finally {
      this.output = null;
      this.videoSource = null;
      this.audioSource = null;
    }
  }
}
