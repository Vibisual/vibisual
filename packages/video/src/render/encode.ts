/**
 * 인코딩 — Mediabunny 래퍼 (SCENARIO.md §5.13 (F)).
 *
 * **프레임을 어디서 얻든 출구는 하나다.** 백엔드가 셋이어도 인코딩 경로가 갈리면
 * 방식마다 다른 파일이 나오고, 문제가 생겼을 때 어느 쪽 탓인지 알 수 없게 된다.
 *
 * 코덱은 고정하지 않고 **이 기기가 실제로 인코딩할 수 있는 것**을 물어서 고른다.
 * 특정 코덱을 박아 두면 그게 없는 환경에서 조용히 실패하거나, 내장 인코더를 손으로
 * 패치해야 하는 상태가 된다(다른 도구에서 실제로 벌어진 일이다).
 */

import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type Quality,
  type VideoCodec,
} from 'mediabunny';

/** 선호 순서. 앞에서부터 이 기기가 할 수 있는 것을 고른다. */
const VIDEO_CODEC_PREFERENCE: readonly VideoCodec[] = ['avc', 'vp9', 'av1', 'vp8'];
const AUDIO_CODEC_PREFERENCE: readonly AudioCodec[] = ['aac', 'opus'];

export interface EncodeQuality {
  readonly video: Quality;
  readonly audio: Quality;
}

export const ENCODE_QUALITY_HIGH: EncodeQuality = { video: QUALITY_HIGH, audio: QUALITY_HIGH };
export const ENCODE_QUALITY_DRAFT: EncodeQuality = { video: QUALITY_MEDIUM, audio: QUALITY_MEDIUM };

export interface PickedCodecs {
  readonly video: VideoCodec | null;
  readonly audio: AudioCodec | null;
}

/** 이 기기가 실제로 인코딩할 수 있는 코덱을 고른다. */
export async function pickCodecs(width: number, height: number, withAudio: boolean): Promise<PickedCodecs> {
  let video: VideoCodec | null = null;
  for (const codec of VIDEO_CODEC_PREFERENCE) {
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
    for (const codec of AUDIO_CODEC_PREFERENCE) {
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
}

/**
 * 캔버스를 mp4 로 뽑아내는 인코더.
 *
 * 사용 순서는 `start()` → 프레임마다 `addFrame(t)` → (선택) `addAudio(buffer)` →
 * `finish()` 이다. `addFrame` 이 돌려주는 약속을 **반드시 기다려야** 한다 — 인코더가
 * 밀릴 때 기다리지 않으면 메모리가 끝없이 늘어난다.
 */
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

  async start(): Promise<void> {
    const { width, height, canvas, fps } = this.opts;
    const quality = this.opts.quality ?? ENCODE_QUALITY_HIGH;
    const withAudio = this.opts.withAudio ?? false;

    this.codecs = await pickCodecs(width, height, withAudio);
    if (this.codecs.video === null) {
      throw new Error('이 기기에서 인코딩할 수 있는 영상 코덱을 찾지 못했습니다.');
    }

    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });

    const videoSource = new CanvasSource(canvas, {
      codec: this.codecs.video,
      quality: quality.video,
      keyFrameInterval: this.opts.keyFrameInterval ?? 2,
    });
    output.addVideoTrack(videoSource, { frameRate: fps });

    if (withAudio && this.codecs.audio !== null) {
      const audioSource = new AudioBufferSource({ codec: this.codecs.audio, quality: quality.audio });
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
