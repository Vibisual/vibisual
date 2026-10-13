/**
 * offscreen-capture 백엔드 (SCENARIO.md §5.13 (F) 확실한 폴백).
 *
 * 오프스크린 창을 띄워 화면을 찍는다. 느리지만 **CSS 가 온전하고 실험 API 에 기대지
 * 않는다.** html-in-canvas 가 막히는 날 영상이 계속 나오게 하는 자리다.
 *
 * 실제 창은 Electron main 이 들고 있으므로 여기서는 다리(bridge)만 부른다. 이 층을
 * 인터페이스로 끊어 두면 렌더러 코드가 Electron 을 직접 알지 않아도 되고, 테스트에서
 * 가짜 다리를 끼울 수 있다.
 *
 * §5.13 (W) 38-1 — 다리는 이제 **날 비트맵**(`RawFrame`)을 돌려준다(main 의 PNG 굽기 332ms → 수 ms). PNG(`ArrayBuffer`)를
 * 돌려주는 옛 다리도 그대로 받는다. 찍힌 픽셀이 문서보다 적으면(창을 문서 크기로 못 키운 기기) 그 비율을 기억해 렌더가
 * "해상도를 낮췄다"고 알린다 — 조용히 흐려지지 않게.
 */

import type { BackendProbe, RenderBackend, RenderBackendCapabilities, RenderSurface } from './backend.js';
import { RENDER_BACKEND_CAPABILITIES } from './backend.js';
import type { Ctx2D } from './canvas2d.js';
import { drawRawFrame, isRawFrame, type RawFrame } from './rawFrame.js';

/** `open` 이 돌려주는 사실 — 창을 문서 크기로 못 키웠으면 맞춤 배율(1 미만). */
export interface OffscreenOpenResult {
  readonly fit?: number;
}

/** 다리가 돌려주는 한 장 — 날 비트맵이나(새 길) PNG 바이트(옛 길). */
export type CapturedFrame = RawFrame | ArrayBuffer;

/** main 프로세스의 오프스크린 창을 조종하는 통로. */
export interface OffscreenCaptureBridge {
  probe(): Promise<{ available: boolean; reason?: string }>;
  /** 렌더 전용 페이지를 오프스크린 창에 연다. */
  open(opts: { width: number; height: number; url: string }): Promise<OffscreenOpenResult | void>;
  /** 그 페이지를 t 초로 맞추고 한 장 찍는다. */
  captureAt(t: number): Promise<CapturedFrame>;
  close(): Promise<void>;
  /**
   * §5.13 (V) 37-9 — 마지막으로 맞춘 시각에 컴포지션 안에서 보이는 글자 상자(문서 픽셀, 읽기 전용). 다리가 모르면 빈 목록.
   */
  inspect?(): Promise<readonly OffscreenText[]>;
}

/** §5.13 (V) 37-9 — 오프스크린 무대가 읽어 준 글자 상자 하나. */
export interface OffscreenText {
  readonly itemId: string;
  readonly path: string;
  readonly text: string;
  readonly color: string;
  readonly fontSize: number;
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export interface OffscreenBackendOptions {
  readonly bridge: OffscreenCaptureBridge;
  /** 오프스크린 창이 열 렌더 전용 페이지 주소. */
  readonly url: string;
  readonly createCanvas?: (w: number, h: number) => HTMLCanvasElement | OffscreenCanvas;
  /** §5.13 (W) 38-3 — 투명 배경 렌더(알파를 지켜 그린다). */
  readonly alpha?: boolean;
}

async function decodePng(bytes: ArrayBuffer): Promise<ImageBitmap> {
  const blob = new Blob([bytes], { type: 'image/png' });
  return createImageBitmap(blob);
}

/** 캔버스 하나와 그 2D 문맥을 만든다(문서 크기 — 인코더가 이 표면을 읽는다). */
export function makeSurfaceCanvas(
  surface: RenderSurface,
  create?: (w: number, h: number) => HTMLCanvasElement | OffscreenCanvas,
): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: Ctx2D } {
  const make =
    create ??
    ((w: number, h: number) => {
      if (typeof document !== 'undefined') {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
      }
      return new OffscreenCanvas(w, h);
    });
  const canvas = make(surface.width, surface.height);
  canvas.width = surface.width;
  canvas.height = surface.height;
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  if (!ctx) throw new Error('2D 컨텍스트를 얻지 못했습니다.');
  return { canvas, ctx };
}

/**
 * 찍힌 한 장을 표면에 그린다(날 비트맵·PNG 둘 다). 돌려주는 값 = 찍힌 해상도 / 문서 해상도의 작은 쪽.
 */
export async function drawCapturedFrame(ctx: Ctx2D, frame: CapturedFrame, surface: RenderSurface, alpha: boolean): Promise<number> {
  if (isRawFrame(frame)) return drawRawFrame(ctx, frame, surface.width, surface.height, alpha);
  const bitmap = await decodePng(frame);
  try {
    ctx.clearRect(0, 0, surface.width, surface.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, surface.width, surface.height);
    return Math.min(bitmap.width / Math.max(1, surface.width), bitmap.height / Math.max(1, surface.height));
  } finally {
    bitmap.close();
  }
}

export class OffscreenCaptureBackend implements RenderBackend {
  readonly id = 'offscreen-capture' as const;
  readonly capabilities: RenderBackendCapabilities = RENDER_BACKEND_CAPABILITIES['offscreen-capture'];

  private surface: RenderSurface = { width: 0, height: 0 };
  private ctx: Ctx2D | null = null;
  private _canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private opened = false;
  /** §5.13 (W) 38-1 — 지금까지 찍힌 해상도 비율의 최솟값(1 미만이면 렌더가 알린다). */
  private minRatio = Number.POSITIVE_INFINITY;

  constructor(private readonly opts: OffscreenBackendOptions) {}

  get canvas(): HTMLCanvasElement | OffscreenCanvas | null {
    return this._canvas;
  }

  async probe(): Promise<BackendProbe> {
    if (typeof createImageBitmap !== 'function') {
      return { id: this.id, available: false, reason: '이미지 디코딩을 쓸 수 없는 환경입니다.' };
    }
    try {
      const r = await this.opts.bridge.probe();
      return r.available
        ? { id: this.id, available: true }
        : { id: this.id, available: false, ...(r.reason === undefined ? {} : { reason: r.reason }) };
    } catch (err) {
      return { id: this.id, available: false, reason: `오프스크린 창을 확인하지 못했습니다: ${String(err)}` };
    }
  }

  async init(surface: RenderSurface): Promise<void> {
    this.surface = surface;
    const { canvas, ctx } = makeSurfaceCanvas(surface, this.opts.createCanvas);
    this._canvas = canvas;
    this.ctx = ctx;

    await this.opts.bridge.open({ width: surface.width, height: surface.height, url: this.opts.url });
    this.opened = true;
  }

  async drawFrame(t: number): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.opened) throw new Error('init 을 먼저 부르세요.');
    const frame = await this.opts.bridge.captureAt(t);
    const ratio = await drawCapturedFrame(ctx, frame, this.surface, this.opts.alpha === true);
    this.minRatio = Math.min(this.minRatio, ratio);
  }

  /** §5.13 (W) 38-1 — 찍힌 해상도 / 문서 해상도의 최솟값(아직 안 찍었으면 1). */
  captureRatio(): number {
    return Number.isFinite(this.minRatio) ? this.minRatio : 1;
  }

  /** §5.13 (V) 37-9 — 마지막으로 찍은 시각의 컴포지션 글자 상자(읽기 전용). */
  async inspectTexts(): Promise<readonly OffscreenText[]> {
    if (!this.opened || !this.opts.bridge.inspect) return [];
    try { return await this.opts.bridge.inspect(); } catch { return []; }
  }

  dispose(): void {
    if (this.opened) {
      // 창을 닫는 것은 비동기지만 dispose 는 동기 계약이라, 실패해도 렌더를 막지 않는다.
      void this.opts.bridge.close().catch(() => undefined);
      this.opened = false;
    }
    this.ctx = null;
    this._canvas = null;
  }
}
