/**
 * offscreen-capture 백엔드 (SCENARIO.md §5.13 (F) 확실한 폴백).
 *
 * 오프스크린 창을 띄워 화면을 찍는다. 느리지만 **CSS 가 온전하고 실험 API 에 기대지
 * 않는다.** html-in-canvas 가 막히는 날 영상이 계속 나오게 하는 자리다.
 *
 * 실제 창은 Electron main 이 들고 있으므로 여기서는 다리(bridge)만 부른다. 이 층을
 * 인터페이스로 끊어 두면 렌더러 코드가 Electron 을 직접 알지 않아도 되고, 테스트에서
 * 가짜 다리를 끼울 수 있다.
 */

import type { BackendProbe, RenderBackend, RenderBackendCapabilities, RenderSurface } from './backend.js';
import { RENDER_BACKEND_CAPABILITIES } from './backend.js';

/** main 프로세스의 오프스크린 창을 조종하는 통로. */
export interface OffscreenCaptureBridge {
  probe(): Promise<{ available: boolean; reason?: string }>;
  /** 렌더 전용 페이지를 오프스크린 창에 연다. */
  open(opts: { width: number; height: number; url: string }): Promise<void>;
  /** 그 페이지를 t 초로 맞추고 한 장 찍는다. PNG 바이트. */
  captureAt(t: number): Promise<ArrayBuffer>;
  close(): Promise<void>;
}

export interface OffscreenBackendOptions {
  readonly bridge: OffscreenCaptureBridge;
  /** 오프스크린 창이 열 렌더 전용 페이지 주소. */
  readonly url: string;
  readonly createCanvas?: (w: number, h: number) => HTMLCanvasElement | OffscreenCanvas;
}

async function decodePng(bytes: ArrayBuffer): Promise<ImageBitmap> {
  const blob = new Blob([bytes], { type: 'image/png' });
  return createImageBitmap(blob);
}

export class OffscreenCaptureBackend implements RenderBackend {
  readonly id = 'offscreen-capture' as const;
  readonly capabilities: RenderBackendCapabilities = RENDER_BACKEND_CAPABILITIES['offscreen-capture'];

  private surface: RenderSurface = { width: 0, height: 0 };
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  private _canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private opened = false;

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

    const make =
      this.opts.createCanvas ??
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
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('2D 컨텍스트를 얻지 못했습니다.');

    this._canvas = canvas;
    this.ctx = ctx;

    await this.opts.bridge.open({ width: surface.width, height: surface.height, url: this.opts.url });
    this.opened = true;
  }

  async drawFrame(t: number): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.opened) throw new Error('init 을 먼저 부르세요.');

    const png = await this.opts.bridge.captureAt(t);
    const bitmap = await decodePng(png);
    try {
      ctx.clearRect(0, 0, this.surface.width, this.surface.height);
      ctx.drawImage(bitmap, 0, 0, this.surface.width, this.surface.height);
    } finally {
      bitmap.close();
    }
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
