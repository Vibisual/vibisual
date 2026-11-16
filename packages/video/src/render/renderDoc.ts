/**
 * §5.13 (E)(F) 렌더 오케스트레이션 — 중단이 필수다(분 단위 작업을 멈출 수 없으면 사용자가 앱을 강제 종료한다).
 * (AA) 42-11 — `sink` 로 결과를 흘려 보내고 `audioStream` 으로 소리를 창마다 프레임과 나란히 넣는다(메모리가 길이에 비례하지 않게).
 * (AA) 42-4·42-5 — `range`(프레임 시각 = 문서 시각, 파일 시각은 0 부터)·`fps`·`outputSize`(줄여 넣는다)·`gate`(프레임 사이 일시정지). 계획은 `renderFramePlan`.
 */

import { renderFramePlan } from '../exportPlan.js';
import type { ExportRange } from '../renderSpec.js';
import { resolveTimeline } from '../resolveTimeline.js';
import type { ResolvedTimeline, VideoDoc } from '../types.js';
import type { RenderBackend } from './backend.js';
import { isPlannedBackend } from './capturePool.js';
import { VideoEncoder, type EncodeQuality, type OutputContainer, type OutputSink, type PickedCodecs } from './encode.js';
import { createAudioFeed, type AudioWindowSource } from './audioWindows.js';

export interface RenderProgress {
  readonly frame: number;
  readonly totalFrames: number;
  /** 구간 캐시((E))로 건너뛴 프레임 수. 부분 렌더가 실제로 먹었는지 보여 준다. */
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
  /** §5.13 (AA) 42-11 — 창마다 섞어 줄 소리(`audio` 대신). 있으면 소리 트랙을 세운다. */
  readonly audioStream?: AudioWindowSource | null;
  /** §5.13 (AA) 42-11 — 결과를 흘려 보낼 곳. 있으면 `bytes` 는 null 이다. */
  readonly sink?: OutputSink | null;
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
  /** 메모리 버퍼로 만든 결과. 흘려 보냈으면 null. */
  readonly bytes: Uint8Array | null;
  /** 결과 파일 크기(바이트). */
  readonly size: number;
  readonly frames: number;
  readonly reusedFrames: number;
  readonly durationSec: number;
  readonly codecs: PickedCodecs;
  /** §5.13 (W) 38-3 — 결과 그릇(mp4 · 투명이면 webm). */
  readonly container: OutputContainer;
  /** §5.13 (E-7) — 구간 길로 구웠을 때만: 구간 수와 다시 쓴 구간 수. */
  readonly segments?: { readonly total: number; readonly reused: number };
}

export class RenderCanceledError extends Error {
  constructor() {
    super('렌더를 중단했습니다.');
    this.name = 'RenderCanceledError';
  }
}

export function ctx2d(canvas: HTMLCanvasElement | OffscreenCanvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('2D 컨텍스트를 얻지 못했습니다.');
  return ctx;
}

/** §5.13 (AA) 42-1 — 줄여 넣을 판(출력 크기가 문서와 다를 때만). */
export function scaledSurface(size: { readonly width: number; readonly height: number }): HTMLCanvasElement | OffscreenCanvas {
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
    withAudio: opts.audio != null || opts.audioStream != null,
    ...(opts.alpha === true ? { alpha: true } : {}),
    ...(opts.container === undefined ? {} : { container: opts.container }),
    ...(opts.sink ? { sink: opts.sink } : {}),
  });

  await encoder.start();
  // 소리 트랙이 실제로 섰을 때만 먹인다(이 기기에 소리 코덱이 없으면 영상만).
  const audioFeed = opts.audioStream && !opts.audio && encoder.pickedCodecs.audio !== null
    ? createAudioFeed(opts.audioStream, plan.start, plan.end, (buffer) => encoder.addAudio(buffer))
    : null;

  // §5.13 (W) 38-2 — 나눠 찍는 백엔드에 프레임 시각을 미리 알린다.
  if (isPlannedBackend(backend)) {
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

      await backend.drawFrame(t);
      // 이 프레임 시각을 덮는 소리 창을 먼저 — 그릇이 영상 조각을 붙잡아 두지 않게.
      if (audioFeed) {
        await audioFeed.ensureThrough(at);
        if (aborted()) throw new RenderCanceledError();
      }

      if (out && surfaceCtx) {
        // 투명 배경도 지키게 비우고 그린다(줄이는 판이 지난 프레임을 남기지 않게).
        surfaceCtx.clearRect(0, 0, out.width, out.height);
        surfaceCtx.drawImage(canvas, 0, 0, out.width, out.height);
      }

      await encoder.addFrame(at);
      opts.onProgress?.({ frame: i + 1, totalFrames: frames, reusedFrames: 0, t });
    }

    if (opts.audio) await encoder.addAudio(opts.audio);
    if (audioFeed) await audioFeed.finish();

    const bytes = await encoder.finish();
    return {
      bytes,
      size: encoder.bytesWritten,
      frames,
      reusedFrames: 0,
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

/** §5.13 (G) 스틸 — 에이전트가 자기 편집 결과를 보는 통로. 한 장만 그려 왕복이 짧아 스스로 고치는 루프가 선다. */
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
