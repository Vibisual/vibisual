/**
 * §5.13 (E-1)(E-3) 구간 인코더와 패킷 먹서 — 출구는 Mediabunny 공개 API 뿐이다(`CanvasSource`+`onEncodedPacket`+`NullTarget` → `EncodedVideoPacketSource`).
 * 구간마다 인코더를 새로 세운다 — 이어 쓰면 비트 배분 상태가 앞 구간에서 넘어와 다시 쓴 조각과 새로 구운 조각이 달라진다.
 */

import type { AudioBufferSource, AudioCodec, BufferTarget, EncodedVideoPacketSource, Output, VideoCodec } from 'mediabunny';

import { RENDER_SEGMENT_SECONDS } from '../constants.js';
import { ENCODE_QUALITY_HIGH, openOutput, qualityOf, type EncodeQuality, type OutputContainer, type OutputSink } from './encode.js';
import { loadMediabunny } from './media.js';
import { decoderConfigFromText, decoderConfigText, type EncodedSegment, type SegmentPacket } from './segmentPack.js';

type Surface = HTMLCanvasElement | OffscreenCanvas;

/** 구간 하나의 인코더. `addFrame(j)` = 지금 캔버스에 그려진 것을 구간 안 j 번째 프레임으로. */
export interface SegmentEncoderSession {
  addFrame(j: number): Promise<void>;
  finish(): Promise<EncodedSegment>;
  cancel(): Promise<void>;
}

/** 구간 인코더를 세우는 쪽. 시험은 이 자리에 결정적인 가짜를 끼운다(Node 에는 WebCodecs 가 없다). */
export interface SegmentEncoderLayer {
  /** (E-8) ① — 같은 설정으로 빈 프레임 한 장을 넣어 받은 디코더 설정 글. */
  probe(): Promise<string>;
  open(): Promise<SegmentEncoderSession>;
}

export interface SegmentEncoderOptions {
  readonly codec: VideoCodec;
  readonly canvas: Surface;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly quality?: EncodeQuality;
  readonly alpha?: boolean;
  readonly container: OutputContainer;
}

async function openSession(opts: SegmentEncoderOptions, canvas: Surface): Promise<SegmentEncoderSession> {
  const mb = await loadMediabunny();
  const quality = opts.quality ?? ENCODE_QUALITY_HIGH;
  const packets: SegmentPacket[] = [];
  let decoder: string | null = null;
  let frames = 0;
  let closed = false;
  // 임시 출력은 버린다. 그릇은 최종 파일과 같은 것 — 패킷 모양(서술 바이트 유무)이 그릇을 따른다.
  const format = opts.container === 'webm' ? new mb.WebMOutputFormat() : new mb.Mp4OutputFormat({ fastStart: false });
  const output = new mb.Output({ format, target: new mb.NullTarget() });
  const source = new mb.CanvasSource(canvas, {
    codec: opts.codec,
    quality: qualityOf(mb, quality.video),
    // 구간의 마지막 프레임 시각은 늘 이 값 안쪽이라 키프레임은 첫 프레임 하나다(`segmentFrameCount`).
    keyFrameInterval: RENDER_SEGMENT_SECONDS,
    ...(opts.alpha === true ? { alpha: 'keep' as const } : {}),
    onEncodedPacket: (packet, meta) => {
      if (decoder === null && meta?.decoderConfig) decoder = decoderConfigText(meta.decoderConfig);
      packets.push({
        frame: Math.round(packet.timestamp * opts.fps),
        key: packet.type === 'key',
        data: packet.data,
        alpha: packet.sideData.alpha ?? null,
      });
    },
  });
  output.addVideoTrack(source, { frameRate: opts.fps });
  await output.start();
  return {
    async addFrame(j) {
      await source.add(j / opts.fps, 1 / opts.fps);
      frames = Math.max(frames, j + 1);
    },
    async finish() {
      source.close();
      await output.finalize();
      closed = true;
      if (decoder === null) throw new Error('인코더가 디코더 설정을 내지 않았습니다.');
      return { frames, decoder, packets };
    },
    async cancel() {
      if (closed) return;
      closed = true;
      await output.cancel();
    },
  };
}

function scratchSurface(width: number, height: number, alpha: boolean): Surface {
  const canvas: Surface = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('2D 컨텍스트를 얻지 못했습니다.');
  if (alpha) ctx.clearRect(0, 0, width, height);
  else ctx.fillRect(0, 0, width, height);
  return canvas;
}

export function createSegmentEncoderLayer(opts: SegmentEncoderOptions): SegmentEncoderLayer {
  return {
    async probe() {
      // 렌더 표면을 건드리지 않게 따로 만든 판에서(같은 크기·같은 설정 — 디코더 설정은 내용이 아니라 설정을 따른다).
      const session = await openSession(opts, scratchSurface(opts.width, opts.height, opts.alpha === true));
      try {
        await session.addFrame(0);
        return (await session.finish()).decoder;
      } catch (err) {
        await session.cancel().catch(() => undefined);
        throw err;
      }
    },
    open: () => openSession(opts, opts.canvas),
  };
}

export interface PacketMuxerOptions {
  readonly codec: VideoCodec;
  /** 소리 트랙을 세울 코덱(없으면 영상만). */
  readonly audioCodec: AudioCodec | null;
  readonly fps: number;
  readonly container: OutputContainer;
  /** 이번 렌더의 디코더 설정 글 — 첫 패킷에만 준다(mp4 는 표본 서술이 트랙에 하나뿐). */
  readonly decoder: string;
  readonly quality?: EncodeQuality;
  readonly sink?: OutputSink | null;
}

/** 최종 파일: 영상은 패킷을 그대로(재인코딩 없이), 소리는 인코더 하나로 처음부터 끝까지((E-4)). */
export class PacketMuxer {
  private output: Output | null = null;
  private video: EncodedVideoPacketSource | null = null;
  private audio: AudioBufferSource | null = null;
  private written = 0;
  private sequence = 0;
  private finished = false;

  constructor(private readonly opts: PacketMuxerOptions) {}

  get bytesWritten(): number {
    return this.written;
  }

  get hasAudio(): boolean {
    return this.audio !== null;
  }

  async start(): Promise<void> {
    const mb = await loadMediabunny();
    const output = openOutput(mb, this.opts.container, this.opts.sink ?? null, (end) => { this.written = Math.max(this.written, end); });
    const video = new mb.EncodedVideoPacketSource(this.opts.codec);
    output.addVideoTrack(video, { frameRate: this.opts.fps });
    if (this.opts.audioCodec !== null) {
      const audio = new mb.AudioBufferSource({ codec: this.opts.audioCodec, quality: qualityOf(mb, (this.opts.quality ?? ENCODE_QUALITY_HIGH).audio) });
      output.addAudioTrack(audio);
      this.audio = audio;
    }
    await output.start();
    this.output = output;
    this.video = video;
  }

  /** @param frame 파일 안 프레임 번호(구간 첫 프레임 + 구간 안 번호) — 시각은 여기서 한 번만 나눈다(한 번에 구운 것과 같은 값). */
  async addPacket(frame: number, packet: SegmentPacket): Promise<void> {
    const video = this.video;
    if (!video) throw new Error('start 를 먼저 부르세요.');
    const mb = await loadMediabunny();
    const first = this.sequence === 0;
    const encoded = new mb.EncodedPacket(
      packet.data, packet.key ? 'key' : 'delta', frame / this.opts.fps, 1 / this.opts.fps, this.sequence,
      undefined, packet.alpha ? { alpha: packet.alpha } : undefined,
    );
    this.sequence += 1;
    if (!first) { await video.add(encoded); return; }
    const config = decoderConfigFromText(this.opts.decoder);
    if (!config) throw new Error('디코더 설정을 읽지 못했습니다.');
    await video.add(encoded, { decoderConfig: config as unknown as VideoDecoderConfig });
  }

  async addAudio(buffer: AudioBuffer): Promise<void> {
    if (this.audio) await this.audio.add(buffer);
  }

  /** 마무리하고 파일 바이트를 돌려준다. 흘려 보냈으면 null(크기는 `bytesWritten`). */
  async finish(): Promise<Uint8Array | null> {
    const output = this.output;
    if (!output) throw new Error('start 를 먼저 부르세요.');
    this.video?.close();
    this.audio?.close();
    await output.finalize();
    this.finished = true;
    if (this.opts.sink) {
      if (this.written === 0) throw new Error('인코딩 결과가 비어 있습니다.');
      return null;
    }
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error('인코딩 결과가 비어 있습니다.');
    this.written = buffer.byteLength;
    return new Uint8Array(buffer);
  }

  async cancel(): Promise<void> {
    if (this.finished || !this.output) return;
    try {
      await this.output.cancel();
    } finally {
      this.output = null;
      this.video = null;
      this.audio = null;
    }
  }
}
