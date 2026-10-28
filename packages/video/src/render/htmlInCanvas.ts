/**
 * §5.13 (F) html-in-canvas(기본 경로) — 살아 있는 DOM 을 캔버스에 그려 CSS 를 잃지 않고 GPU 인코딩까지 간다(Chromium 을 고정하는 Electron 이라 쓸 수 있다).
 * 오리진 트라이얼이라 API 이름이 바뀔 수 있다 — 후보를 여럿 보고, 없으면 이유를 남기고 다음 백엔드로 내려간다.
 */

import type { BackendProbe, RenderBackend, RenderBackendCapabilities, RenderSurface } from './backend.js';
import { RENDER_BACKEND_CAPABILITIES } from './backend.js';

/** 시각 t 의 화면을 DOM 으로 만들어 두는 쪽(React 등). */
export interface DomStage {
  /** t 초의 상태로 DOM 을 맞춘다. 폰트·이미지 로드까지 끝난 뒤 resolve 해야 한다. */
  seek(t: number): Promise<void>;
  /** 캔버스에 그릴 루트 엘리먼트. */
  readonly element: HTMLElement;
}

/** 사양 정착 전이라 이름이 흔들린다 — 지금 `drawElementImage`, 초안 때 `drawElement`. 둘 다 본다. */
function findDrawElement(ctx: CanvasRenderingContext2D): ((el: Element) => void) | null {
  const bag = ctx as unknown as Record<string, unknown>;
  for (const name of ['drawElementImage', 'drawElement']) {
    const fn = bag[name];
    if (typeof fn === 'function') return (el: Element) => (fn as (e: Element) => void).call(ctx, el);
  }
  return null;
}

/** 요소를 그리기 전에 레이아웃을 확정시키는 호출. 없으면 건너뛴다(있으면 정확해진다). */
function layoutSubtree(el: Element): void {
  const bag = el as unknown as Record<string, unknown>;
  const fn = bag['layoutSubtree'];
  if (typeof fn === 'function') (fn as () => void).call(el);
}

export interface HtmlInCanvasBackendOptions {
  readonly stage: DomStage;
  readonly createCanvas?: (w: number, h: number) => HTMLCanvasElement;
  readonly background?: string;
}

export class HtmlInCanvasBackend implements RenderBackend {
  readonly id = 'html-in-canvas' as const;
  readonly capabilities: RenderBackendCapabilities = RENDER_BACKEND_CAPABILITIES['html-in-canvas'];

  private surface: RenderSurface = { width: 0, height: 0 };
  private ctx: CanvasRenderingContext2D | null = null;
  private draw: ((el: Element) => void) | null = null;
  private _canvas: HTMLCanvasElement | null = null;

  constructor(private readonly opts: HtmlInCanvasBackendOptions) {}

  get canvas(): HTMLCanvasElement | null {
    return this._canvas;
  }

  async probe(): Promise<BackendProbe> {
    if (typeof document === 'undefined') {
      return { id: this.id, available: false, reason: '문서가 없는 환경입니다.' };
    }
    const probe = document.createElement('canvas');
    const ctx = probe.getContext('2d');
    if (!ctx) return { id: this.id, available: false, reason: '2D 컨텍스트를 얻지 못했습니다.' };
    if (!findDrawElement(ctx)) {
      return {
        id: this.id,
        available: false,
        reason: 'HTML-in-Canvas 가 꺼져 있습니다 (Chromium 플래그 canvas-draw-element 필요).',
      };
    }
    return { id: this.id, available: true };
  }

  async init(surface: RenderSurface): Promise<void> {
    this.surface = surface;
    const canvas = this.opts.createCanvas?.(surface.width, surface.height) ?? document.createElement('canvas');
    canvas.width = surface.width;
    canvas.height = surface.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D 컨텍스트를 얻지 못했습니다.');
    const draw = findDrawElement(ctx);
    if (!draw) throw new Error('HTML-in-Canvas 를 쓸 수 없습니다. probe 를 먼저 확인하세요.');

    // 이 캔버스가 요소를 그릴 수 있음을 선언한다(사양의 opt-in 속성).
    canvas.setAttribute('layoutsubtree', '');

    this._canvas = canvas;
    this.ctx = ctx;
    this.draw = draw;
  }

  async drawFrame(t: number): Promise<void> {
    const ctx = this.ctx;
    const draw = this.draw;
    if (!ctx || !draw) throw new Error('init 을 먼저 부르세요.');

    await this.opts.stage.seek(t);

    const { width, height } = this.surface;
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = this.opts.background ?? '#000000';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    const el = this.opts.stage.element;
    layoutSubtree(el);
    draw(el);
  }

  dispose(): void {
    this.ctx = null;
    this.draw = null;
    this._canvas = null;
  }
}
