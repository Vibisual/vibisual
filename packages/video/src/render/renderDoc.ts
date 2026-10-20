/**
 * 렌더 오케스트레이션 (SCENARIO.md §5.13 (E)(F)).
 *
 * 문서 하나를 mp4 한 개로 만든다. 하는 일은 셋이다 — 시각을 풀고, 프레임마다 그리고,
 * 인코더에 넣는다. 그 사이에 **부분 렌더 캐시**와 **중단**과 **진행률**이 끼어든다.
 *
 * 중단을 처음부터 넣는 이유: 영상 렌더는 분 단위로 걸리는 유일한 작업이고, 멈출 수
 * 없는 긴 작업은 사용자가 앱을 강제 종료하게 만든다.
 *
 * §5.13 (AA) 42-4·42-5 — 구간(`range` — 프레임 시각은 문서 시각, 파일 시각은 0 부터) · 프레임 수(`fps`) · 출력 크기(`outputSize` —
 * 그린 판을 줄여 인코더에 넣는다) · 일시정지 관문(`gate` — 프레임 사이에서 기다린다)을 받는다. 계획은 순수 함수 `renderFramePlan`.
 */

import { renderFramePlan } from '../exportPlan.js';
import type { ExportRange } from '../renderSpec.js';
import { resolveTimeline } from '../resolveTimeline.js';
import type { ResolvedTimeline, VideoDoc } from '../types.js';
import type { RenderBackend } from './backend.js';
import { isPlannedBackend } from './capturePool.js';
import { frameSignature } from './frameSignature.js';
import { VideoEncoder, type EncodeQuality, type OutputContainer, type PickedCodecs } from './encode.js';

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
  /** 섞어 넣을 소리. 없으면 무음 영상. 구간 렌더면 그 구간의 소리(0 표본 = 구간 시작). */
  readonly audio?: AudioBuffer | null;
  readonly cache?: FrameCache | null;
  readonly signal?: AbortSignal;
  readonly onProgress?: (p: RenderProgress) => void;
  /** §5.13 (W) 38-3 — 투명 배경(WebM + 알파). 백엔드도 알파를 지켜 그려야 한다. */
  readonly alpha?: boolean;
  /** §5.13 (AA) 42-1 — 그릇(없으면 mp4 · 투명이면 늘 webm). */
  readonly container?: OutputContainer;
  /** §5.13 (AA) 42-4 — 그릴 구간(문서 시각). 없으면 처음~끝. */
  readonly range?: ExportRange | null;
  /** §5.13 (AA) 42-1 — 프레임 수(없으면 문서 fps). */
  readonly fps?: number | null;
  /** §5.13 (AA) 42-1 — 출력 크기(없거나 문서 크기면 그대로). */
  readonly outputSize?: { readonly width: number; readonly height: number } | null;
  /** §5.13 (AA) 42-5 — 프레임마다 지나는 관문. 일시정지면 풀릴 때까지 기다린다(중단 신호가 오면 풀어야 한다). */
  readonly gate?: () => Promise<void>;
}

export interface RenderResult {
  readonly bytes: Uint8Array;
  readonly frames: number;
  readonly reusedFrames: number;
  readonly durationSec: number;
  readonly codecs: PickedCodecs;
  /** §5.13 (W) 38-3 — 결과 그릇(mp4 · 투명이면 webm). */
  readonly container: OutputContainer;
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

/** §5.13 (AA) 42-1 — 줄여 넣을 판(출력 크기가 문서와 다를 때만). */
function scaledSurface(size: { readonly width: number; readonly height: number }): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size.width, size.height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  return canvas;
}

export async function renderDoc(opts: RenderDocOptions): Promise<RenderResult> {
  const { doc, backend } = opts;
  const timeline = opts.timeline ?? resolveTimeline(doc);
  const plan = renderFramePlan(timeline.duration, doc.fps, { fps: opts.fps ?? null, range: opts.range ?? null });
  const { fps, frames } = plan;

  if (frames === 0) throw new Error('길이가 0이라 렌더할 것이 없습니다.');

  await backend.init({ width: doc.size.width, height: doc.size.height });
  const canvas = backend.canvas;
  if (!canvas) throw new Error('백엔드가 캔버스를 만들지 못했습니다.');

  const out = opts.outputSize && (opts.outputSize.width !== doc.size.width || opts.outputSize.height !== doc.size.height) ? opts.outputSize : null;
  const surface = out ? scaledSurface(out) : canvas;
  const surfaceCtx = out ? ctx2d(surface) : null;

  const encoder = new VideoEncoder({
    width: out?.width ?? doc.size.width,
    height: out?.height ?? doc.size.height,
    fps,
    canvas: surface,
    ...(opts.quality === undefined ? {} : { quality: opts.quality }),
    withAudio: opts.audio != null,
    ...(opts.alpha === true ? { alpha: true } : {}),
    ...(opts.container === undefined ? {} : { container: opts.container }),
  });

  await encoder.start();

  const cache = opts.cache ?? null;
  const paint = cache ? ctx2d(canvas) : null;
  let reused = 0;
  // §5.13 (W) 38-2 — 나눠 찍는 백엔드에 프레임 시각을 미리 알린다(캐시가 건너뛸 프레임까지 찍지 않게 캐시 없는 렌더만).
  if (!cache && isPlannedBackend(backend)) {
    const times: number[] = [];
    for (let i = 0; i < frames; i += 1) times.push(plan.start + i / fps);
    backend.plan(times);
  }

  // 함수로 묻는다 — 관문을 기다리는 사이 바뀐 신호를 다시 읽어야 한다(속성 한 번 읽기는 그 자리 값에 묶인다).
  const aborted = (): boolean => opts.signal?.aborted === true;
  try {
    for (let i = 0; i < frames; i += 1) {
      if (aborted()) throw new RenderCanceledError();
      if (opts.gate) {
        await opts.gate();
        if (aborted()) throw new RenderCanceledError();
      }

      // 그리는 시각은 문서 시각, 파일에 적는 시각은 구간 시작부터.
      const t = plan.start + i / fps;
      const at = i / fps;

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

      if (out && surfaceCtx) {
        // 투명 배경도 지키게 비우고 그린다(줄이는 판이 지난 프레임을 남기지 않게).
        surfaceCtx.clearRect(0, 0, out.width, out.height);
        surfaceCtx.drawImage(canvas, 0, 0, out.width, out.height);
      }

      await encoder.addFrame(at);
      opts.onProgress?.({ frame: i + 1, totalFrames: frames, reusedFrames: reused, t });
    }

    if (opts.audio) await encoder.addAudio(opts.audio);

    const bytes = await encoder.finish();
    return {
      bytes,
      frames,
      reusedFrames: reused,
      durationSec: plan.end - plan.start,
      codecs: encoder.pickedCodecs,
      container: encoder.container,
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
