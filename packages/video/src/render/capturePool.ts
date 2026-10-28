/**
 * §5.13 (W) 38-2 — 병렬 캡처: 프레임 i 를 세션 `i % N` 이 맡아 시각 맞추기를 겹쳐 돌린다. 세션 안에선 줄을 서 시각이 앞으로만 간다(순방향 전용 컴포지션도 한 번만 흐른다).
 * `drawFrame(t)` 는 시각 순서로 오고 미리 찍은 그 프레임을 기다린다. 앞질러 찍기는 세션 × `lookaheadPerSession` 장까지(날 비트맵 한 장이 수 MB). 한 장이라도 실패하면 렌더 실패.
 */

import { VIDEO_CAPTURE_LOOKAHEAD_PER_SESSION } from '../constants.js';
import type { BackendProbe, RenderBackend, RenderBackendCapabilities, RenderSurface } from './backend.js';
import { RENDER_BACKEND_CAPABILITIES } from './backend.js';
import type { Ctx2D } from './canvas2d.js';
import { drawCapturedFrame, makeSurfaceCanvas, type CapturedFrame, type OffscreenCaptureBridge } from './offscreen.js';

export interface PooledCaptureOptions {
  /** 세션마다 하나(각자 자기 숨은 창을 연다). 하나뿐이면 종전 단일 창과 같다. */
  readonly bridges: readonly OffscreenCaptureBridge[];
  /** 투명 배경 렌더(알파를 지켜 그린다). */
  readonly alpha?: boolean;
  readonly lookaheadPerSession?: number;
  readonly createCanvas?: (w: number, h: number) => HTMLCanvasElement | OffscreenCanvas;
  /** 찍힌 한 장을 표면에 그리는 쪽(기본 `drawCapturedFrame`). 시험이 화면 없이 순서·병렬만 보게 바꿔 끼운다. */
  readonly draw?: (ctx: Ctx2D, frame: CapturedFrame, surface: RenderSurface, alpha: boolean) => Promise<number>;
}

/** 렌더가 프레임 시각 목록을 미리 알려 줄 수 있는 백엔드. */
export interface PlannedRenderBackend extends RenderBackend {
  plan(times: readonly number[]): void;
}

export function isPlannedBackend(b: RenderBackend): b is PlannedRenderBackend {
  return typeof (b as Partial<PlannedRenderBackend>).plan === 'function';
}

/** 이 기기에서 쓸 세션 수 — 상한과 논리 코어 절반 중 작은 것(최소 1). */
export function captureSessionCount(max: number, hardwareConcurrency: number | undefined): number {
  const cores = typeof hardwareConcurrency === 'number' && Number.isFinite(hardwareConcurrency) && hardwareConcurrency > 0 ? hardwareConcurrency : 2;
  return Math.max(1, Math.min(Math.floor(max), Math.floor(cores / 2)));
}

export class PooledCaptureBackend implements PlannedRenderBackend {
  readonly id = 'offscreen-capture' as const;
  readonly capabilities: RenderBackendCapabilities = RENDER_BACKEND_CAPABILITIES['offscreen-capture'];

  private surface: RenderSurface = { width: 0, height: 0 };
  private ctx: Ctx2D | null = null;
  private _canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private sessions: OffscreenCaptureBridge[] = [];
  /** 세션마다 마지막 일(그 뒤에 줄을 선다). */
  private chains: Promise<unknown>[] = [];
  private times: number[] | null = null;
  private nextIndex = 0;
  private consumed = 0;
  private readonly pending = new Map<number, Promise<CapturedFrame>>();
  private minRatio = Number.POSITIVE_INFINITY;
  private disposed = false;

  constructor(private readonly opts: PooledCaptureOptions) {
    if (opts.bridges.length === 0) throw new Error('캡처 세션이 하나도 없습니다.');
  }

  get canvas(): HTMLCanvasElement | OffscreenCanvas | null {
    return this._canvas;
  }

  /** 열린 세션 수(시험·진단용). */
  get sessionCount(): number {
    return this.sessions.length;
  }

  async probe(): Promise<BackendProbe> {
    if (typeof createImageBitmap !== 'function') {
      return { id: this.id, available: false, reason: '이미지 디코딩을 쓸 수 없는 환경입니다.' };
    }
    try {
      const r = await this.opts.bridges[0]!.probe();
      return r.available ? { id: this.id, available: true } : { id: this.id, available: false, ...(r.reason === undefined ? {} : { reason: r.reason }) };
    } catch (err) {
      return { id: this.id, available: false, reason: `오프스크린 창을 확인하지 못했습니다: ${String(err)}` };
    }
  }

  async init(surface: RenderSurface): Promise<void> {
    this.surface = surface;
    const { canvas, ctx } = makeSurfaceCanvas(surface, this.opts.createCanvas);
    this._canvas = canvas;
    this.ctx = ctx;
    const opened = await Promise.allSettled(
      this.opts.bridges.map(async (b) => {
        await b.open({ width: surface.width, height: surface.height, url: '' });
        return b;
      }),
    );
    this.sessions = opened.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (this.sessions.length === 0) {
      const first = opened.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      throw first?.reason instanceof Error ? first.reason : new Error(String(first?.reason ?? '캡처 창을 열지 못했습니다.'));
    }
    this.chains = this.sessions.map(() => Promise.resolve());
  }

  plan(times: readonly number[]): void {
    this.times = [...times];
    this.nextIndex = 0;
    this.consumed = 0;
    this.pending.clear();
    this.schedule();
  }

  private enqueue(session: number, t: number): Promise<CapturedFrame> {
    const bridge = this.sessions[session]!;
    const run = this.chains[session]!.then(() => {
      if (this.disposed) throw new Error('렌더를 중단했습니다.');
      return bridge.captureAt(t);
    });
    // 줄은 실패해도 이어진다(다음 프레임의 실패는 그 프레임이 따로 알린다). 기다리는 쪽이 없을 때의 거부는 삼킨다.
    this.chains[session] = run.catch(() => undefined);
    run.catch(() => undefined);
    return run;
  }

  private schedule(): void {
    const times = this.times;
    if (!times || this.disposed) return;
    const limit = this.sessions.length * Math.max(1, this.opts.lookaheadPerSession ?? VIDEO_CAPTURE_LOOKAHEAD_PER_SESSION);
    while (this.nextIndex < times.length && this.nextIndex - this.consumed < limit) {
      const index = this.nextIndex;
      this.nextIndex += 1;
      this.pending.set(index, this.enqueue(index % this.sessions.length, times[index]!));
    }
  }

  async drawFrame(t: number): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) throw new Error('init 을 먼저 부르세요.');
    let frame: CapturedFrame;
    const times = this.times;
    if (times && this.consumed < times.length && Math.abs(times[this.consumed]! - t) < 1e-9) {
      const index = this.consumed;
      if (!this.pending.has(index)) this.schedule();
      const job = this.pending.get(index) ?? this.enqueue(index % this.sessions.length, t);
      this.pending.delete(index);
      this.consumed += 1;
      this.schedule();
      frame = await job;
    } else {
      // 계획 밖의 한 장(스틸 등) — 첫 세션의 줄 뒤에서.
      frame = await this.enqueue(0, t);
    }
    const ratio = await (this.opts.draw ?? drawCapturedFrame)(ctx, frame, this.surface, this.opts.alpha === true);
    this.minRatio = Math.min(this.minRatio, ratio);
  }

  /** 찍힌 해상도 / 문서 해상도의 최솟값(아직 안 찍었으면 1). */
  captureRatio(): number {
    return Number.isFinite(this.minRatio) ? this.minRatio : 1;
  }

  dispose(): void {
    this.disposed = true;
    this.pending.clear();
    for (const s of this.sessions) void s.close().catch(() => undefined);
    this.sessions = [];
    this.chains = [];
    this.ctx = null;
    this._canvas = null;
  }
}
