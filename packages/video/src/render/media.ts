/**
 * 소재 공급자 — Mediabunny 기반 (SCENARIO.md §5.13 (E)).
 *
 * **푸티지 병목을 푸는 자리다.** 다른 도구에서 실사 영상이 느린 이유는 원하는 시각의
 * 프레임을 얻으려고 앞부분을 순차로 디코딩하기 때문이고, 그래서 렌더가 진행될수록
 * 초당 프레임이 떨어진다. Mediabunny 의 `CanvasSink.getCanvas(t)` 는 그 시각으로
 * 직접 찾아가므로 이 형태의 감속이 생기지 않는다.
 *
 * 라이선스 — Mediabunny 는 MPL-2.0 이라 **수정하지 않고 의존성으로만** 쓴다.
 * 동작을 바꿔야 하면 이 래퍼에서 한다(THIRD-PARTY-LICENSES.md §3).
 */

import { ALL_FORMATS, BlobSource, CanvasSink, Input, UrlSource } from 'mediabunny';

import type { MediaProvider } from './canvas2d.js';
import type { VideoAsset } from '../types.js';

/** 소재 파일을 어떻게 읽을지는 호스트가 정한다(파일 시스템·URL·메모리). */
export interface AssetBytesLoader {
  /** 소재를 읽을 수 있는 형태로. 못 읽으면 null. */
  open(asset: VideoAsset): Promise<Blob | string | null>;
}

interface VideoEntry {
  input: Input;
  sink: CanvasSink | null;
}

export interface MediabunnyProviderOptions {
  readonly assets: Readonly<Record<string, VideoAsset>>;
  readonly loader: AssetBytesLoader;
  /** 디코딩 결과 캔버스의 최대 가로. 원본이 4K 여도 화면에 쓸 만큼만 받는다. */
  readonly maxFrameWidth?: number;
}

/**
 * 이미지와 영상 프레임을 내주는 공급자.
 *
 * 소재마다 입력을 한 번만 열고 재사용한다 — 프레임마다 파일을 다시 여는 것이
 * "쓸수록 느려지는" 전형적인 형태라 처음부터 막는다.
 */
export class MediabunnyMediaProvider implements MediaProvider {
  private readonly images = new Map<string, ImageBitmap | null>();
  private readonly videos = new Map<string, VideoEntry | null>();

  constructor(private readonly opts: MediabunnyProviderOptions) {}

  private asset(assetId: string): VideoAsset | undefined {
    return this.opts.assets[assetId];
  }

  async getImage(assetId: string): Promise<CanvasImageSource | null> {
    if (this.images.has(assetId)) return this.images.get(assetId) ?? null;

    const asset = this.asset(assetId);
    if (!asset) {
      this.images.set(assetId, null);
      return null;
    }

    let bitmap: ImageBitmap | null = null;
    try {
      const opened = await this.opts.loader.open(asset);
      if (opened instanceof Blob) {
        bitmap = await createImageBitmap(opened);
      } else if (typeof opened === 'string') {
        const res = await fetch(opened);
        bitmap = await createImageBitmap(await res.blob());
      }
    } catch {
      bitmap = null; // 못 읽은 소재 하나가 렌더 전체를 막지 않는다.
    }

    this.images.set(assetId, bitmap);
    return bitmap;
  }

  private async ensureVideo(assetId: string): Promise<VideoEntry | null> {
    if (this.videos.has(assetId)) return this.videos.get(assetId) ?? null;

    const asset = this.asset(assetId);
    if (!asset) {
      this.videos.set(assetId, null);
      return null;
    }

    let entry: VideoEntry | null = null;
    try {
      const opened = await this.opts.loader.open(asset);
      if (opened === null) throw new Error('소재를 열 수 없습니다.');

      const source = opened instanceof Blob ? new BlobSource(opened) : new UrlSource(opened);
      const input = new Input({ formats: ALL_FORMATS, source });
      const track = await input.getPrimaryVideoTrack();
      const sink =
        track === null
          ? null
          : new CanvasSink(
              track,
              this.opts.maxFrameWidth === undefined ? {} : { width: this.opts.maxFrameWidth },
            );
      entry = { input, sink };
    } catch {
      entry = null;
    }

    this.videos.set(assetId, entry);
    return entry;
  }

  async getFrame(assetId: string, timeInAsset: number): Promise<CanvasImageSource | null> {
    const entry = await this.ensureVideo(assetId);
    if (!entry?.sink) return null;
    try {
      const wrapped = await entry.sink.getCanvas(Math.max(0, timeInAsset));
      return wrapped?.canvas ?? null;
    } catch {
      return null;
    }
  }

  /** 영상 소재의 실제 길이(초). `duration:'auto'` 를 채울 때 쓴다. */
  async measureDuration(assetId: string): Promise<number | null> {
    const entry = await this.ensureVideo(assetId);
    if (!entry) return null;
    try {
      return await entry.input.computeDuration();
    } catch {
      return null;
    }
  }

  dispose(): void {
    for (const bitmap of this.images.values()) bitmap?.close();
    this.images.clear();
    this.videos.clear();
  }
}
