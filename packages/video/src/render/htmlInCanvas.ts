/**
 * html-in-canvas 백엔드 (SCENARIO.md §5.13 (F) 기본 경로).
 *
 * **이 앱의 차별점이 사는 자리다.** 살아 있는 DOM 을 그대로 캔버스에 그려 넣으므로
 * CSS 를 하나도 잃지 않으면서 WebCodecs 로 GPU 인코딩까지 간다. 다른 도구가 이걸
 * 못 쓰는 이유는 임의의 브라우저에서 돌아야 하기 때문이고(Firefox·Safari 는 구현
 * 의사가 없다), 우리는 Chromium 버전과 플래그를 직접 고정하는 Electron 앱이라 쓸 수 있다.
 *
 * 아직 오리진 트라이얼 단계라 **API 이름이 바뀔 수 있다.** 그래서 탐지를 넉넉하게
 * 하고(이름 후보를 여러 개 본다), 없으면 조용히 실패하는 대신 이유를 남기고 다음
 * 백엔드로 내려간다.
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

/**
 * 컨텍스트에서 요소 그리기 함수를 찾는다.
 *
 * 사양이 정착하기 전이라 이름이 흔들린다 — 지금 후보는 `drawElementImage` 이고
 * 초안 시절 `drawElement` 로 불리던 시기가 있었다. 둘 다 본다.
 */
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
