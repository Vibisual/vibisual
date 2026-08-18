/**
 * 렌더 오케스트레이션 (SCENARIO.md §5.13 (E)(F)).
 *
 * 문서 하나를 mp4 한 개로 만든다. 하는 일은 셋이다 — 시각을 풀고, 프레임마다 그리고,
 * 인코더에 넣는다. 그 사이에 **부분 렌더 캐시**와 **중단**과 **진행률**이 끼어든다.
 *
 * 중단을 처음부터 넣는 이유: 영상 렌더는 분 단위로 걸리는 유일한 작업이고, 멈출 수
 * 없는 긴 작업은 사용자가 앱을 강제 종료하게 만든다.
 */

import { resolveTimeline } from '../resolveTimeline.js';
import type { ResolvedTimeline, VideoDoc } from '../types.js';
import type { RenderBackend } from './backend.js';
import { frameSignature, totalFrames } from './frameSignature.js';
import { VideoEncoder, type EncodeQuality, type PickedCodecs } from './encode.js';

/** 그려 둔 프레임을 보관하는 곳. 메모리든 디스크든 호스트가 정한다. */
export interface FrameCache {
  get(signature: string): Promise<ImageBitmap | null>;
  set(signature: string, bitmap: ImageBitmap): Promise<void>;
}

export interface RenderProgress {
  readonly frame: number;
  readonly totalFrames: number;
  /** 캐시로 건너뛴 프레임 수. 부분 렌더가 실제로 먹었는지 보여 준다. */
  readonly reusedFrames: number;
  readonly t: number;
}

export interface RenderDocOptions {
  readonly doc: VideoDoc;
  /** 이미 풀어 둔 타임라인이 있으면 재사용한다(스틸과 렌더가 같은 것을 보게). */
  readonly timeline?: ResolvedTimeline;
  readonly backend: RenderBackend;
  readonly quality?: EncodeQuality;
  /** 섞어 넣을 소리. 없으면 무음 영상. */
  readonly audio?: AudioBuffer | null;
  readonly cache?: FrameCache | null;
  readonly signal?: AbortSignal;
  readonly onProgress?: (p: RenderProgress) => void;
}

export interface RenderResult {
  readonly bytes: Uint8Array;
  readonly frames: number;
  readonly reusedFrames: number;
  readonly durationSec: number;
  readonly codecs: PickedCodecs;
}

export class RenderCanceledError extends Error {
  constructor() {
    super('렌더를 중단했습니다.');
    this.name = 'RenderCanceledError';
  }
}

function ctx2d(canvas: HTMLCanvasElement | OffscreenCanvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('2D 컨텍스트를 얻지 못했습니다.');
  return ctx;
}

export async function renderDoc(opts: RenderDocOptions): Promise<RenderResult> {
  const { doc, backend } = opts;
  const timeline = opts.timeline ?? resolveTimeline(doc);
  const fps = doc.fps;
  const frames = totalFrames(timeline.duration, fps);

  if (frames === 0) throw new Error('길이가 0이라 렌더할 것이 없습니다.');

  await backend.init({ width: doc.size.width, height: doc.size.height });
  const canvas = backend.canvas;
  if (!canvas) throw new Error('백엔드가 캔버스를 만들지 못했습니다.');

  const encoder = new VideoEncoder({
    width: doc.size.width,
    height: doc.size.height,
    fps,
    canvas,
    ...(opts.quality === undefined ? {} : { quality: opts.quality }),
    withAudio: opts.audio != null,
  });

  await encoder.start();

  const cache = opts.cache ?? null;
  const paint = cache ? ctx2d(canvas) : null;
  let reused = 0;

  try {
    for (let i = 0; i < frames; i += 1) {
      if (opts.signal?.aborted === true) throw new RenderCanceledError();

      const t = i / fps;

      let painted = false;
      if (cache && paint) {
        const sig = frameSignature(doc, timeline, t, fps);
        const hit = await cache.get(sig);
        if (hit) {
          paint.clearRect(0, 0, doc.size.width, doc.size.height);
          paint.drawImage(hit, 0, 0);
          hit.close();
          reused += 1;
          painted = true;
        } else {
          await backend.drawFrame(t);
          // 그린 김에 보관해 둔다 — 다음 렌더에서 이 프레임은 공짜가 된다.
          try {
            const bitmap = await createImageBitmap(canvas);
            await cache.set(sig, bitmap);
          } catch {
            // 캐시는 최적화일 뿐이라 실패해도 렌더는 계속한다.
          }
          painted = true;
        }
      }

      if (!painted) await backend.drawFrame(t);

      await encoder.addFrame(t);
      opts.onProgress?.({ frame: i + 1, totalFrames: frames, reusedFrames: reused, t });
    }

    if (opts.audio) await encoder.addAudio(opts.audio);

    const bytes = await encoder.finish();
    return {
      bytes,
      frames,
      reusedFrames: reused,
      durationSec: timeline.duration,
      codecs: encoder.pickedCodecs,
    };
  } catch (err) {
    await encoder.cancel();
    throw err;
  } finally {
    backend.dispose();
  }
}

/**
 * 한 장만 뽑는다 (SCENARIO.md §5.13 (G) 스틸 피드백 루프).
 *
 * **에이전트가 자기 편집 결과를 눈으로 확인하는 통로다.** 전체 렌더를 돌리지 않고
 * 그 시각 한 장만 그리므로 왕복이 짧고, 그래서 스스로 고치는 루프가 성립한다.
 */
export async function renderStill(
  doc: VideoDoc,
  backend: RenderBackend,
  t: number,
  timeline?: ResolvedTimeline,
): Promise<ImageBitmap> {
  const resolved = timeline ?? resolveTimeline(doc);
  await backend.init({ width: doc.size.width, height: doc.size.height });
  try {
    await backend.drawFrame(Math.max(0, Math.min(t, Math.max(0, resolved.duration - 1e-6))));
    const canvas = backend.canvas;
    if (!canvas) throw new Error('백엔드가 캔버스를 만들지 못했습니다.');
    return await createImageBitmap(canvas);
  } finally {
    backend.dispose();
  }
}
