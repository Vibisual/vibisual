/**
 * canvas2d 백엔드 (SCENARIO.md §5.13 (F)).
 *
 * 셋 중 가장 빠르고 가장 확실하다 — 실험 API 도 오프스크린 창도 쓰지 않고 캔버스에
 * 직접 그린다. 대가는 CSS 가 없다는 것이라, 씬은 **등록된 그리기 함수**로 표현한다.
 *
 * 이 백엔드가 있는 이유는 두 가지다. 하나는 대량 반복 컷(같은 틀에 데이터만 바뀌는
 * 영상)에서 가장 빠르기 때문이고, 다른 하나는 **나머지 둘이 모두 막혔을 때 마지막으로
 * 남는 자리**이기 때문이다. 여기까지 못 오면 렌더 자체가 불가능하다.
 */

import type { DrawOp } from './drawList.js';
import { buildDrawList } from './drawList.js';
import type { BackendProbe, RenderBackend, RenderBackendCapabilities, RenderSurface } from './backend.js';
import { RENDER_BACKEND_CAPABILITIES } from './backend.js';
import type { ResolvedTimeline, VideoDoc } from '../types.js';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** 소재를 그릴 수 있는 형태로 내주는 쪽. 파일 접근을 백엔드가 직접 하지 않게 가른다. */
export interface MediaProvider {
  getImage(assetId: string): Promise<CanvasImageSource | null>;
  /** 영상 소재의 특정 시각 프레임. 순차 디코딩이 아니라 직접 탐색이어야 한다. */
  getFrame(assetId: string, timeInAsset: number): Promise<CanvasImageSource | null>;
}

export interface SceneEnv {
  readonly doc: VideoDoc;
  readonly size: { readonly width: number; readonly height: number };
}

/** 씬 하나를 그리는 함수. 변환과 투명도는 호출 전에 이미 적용돼 있다. */
export type SceneDrawFn = (ctx: Ctx2D, op: DrawOp, env: SceneEnv) => void;

export type SceneRegistry = Readonly<Record<string, SceneDrawFn>>;

function num(props: Readonly<Record<string, unknown>> | undefined, key: string, fallback: number): number {
  const v = props?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(props: Readonly<Record<string, unknown>> | undefined, key: string, fallback: string): string {
  const v = props?.[key];
  return typeof v === 'string' ? v : fallback;
}

/**
 * 페이드 계수.
 *
 * 아이템마다 `fadeIn`/`fadeOut`(초)만 적어 두면 들어오고 나가는 것이 부드러워진다.
 * 이걸 기본으로 두는 이유는, 없으면 모든 컷이 딱딱 끊겨 "값싸 보이는" 결과가
 * 기본값이 되기 때문이다.
 */
export function fadeFactor(op: DrawOp): number {
  const inSec = num(op.resolved.item.props, 'fadeIn', 0);
  const outSec = num(op.resolved.item.props, 'fadeOut', 0);
  const dur = op.resolved.duration;
  let f = 1;
  if (inSec > 0) f = Math.min(f, Math.min(1, op.localTime / inSec));
  if (outSec > 0) f = Math.min(f, Math.min(1, (dur - op.localTime) / outSec));
  return Math.max(0, Math.min(1, f));
}

/** `object-fit: contain` 과 같은 배치를 계산한다(레터박스 포함). */
export function containRect(
  srcW: number,
  srcH: number,
  boxW: number,
  boxH: number,
): { x: number; y: number; width: number; height: number } {
  if (srcW <= 0 || srcH <= 0) return { x: 0, y: 0, width: boxW, height: boxH };
  const scale = Math.min(boxW / srcW, boxH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, width: w, height: h };
}

/** 글자를 폭에 맞춰 줄로 나눈다. 줄바꿈 문자도 존중한다. */
export function wrapText(ctx: Ctx2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = words[0] ?? '';
    for (let i = 1; i < words.length; i += 1) {
      const word = words[i] ?? '';
      const candidate = `${line} ${word}`;
      if (ctx.measureText(candidate).width <= maxWidth) line = candidate;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

function sourceSize(src: CanvasImageSource): { w: number; h: number } {
  const anyimg = src as { width?: number; height?: number; videoWidth?: number; videoHeight?: number };
  const w = anyimg.videoWidth ?? anyimg.width ?? 0;
  const h = anyimg.videoHeight ?? anyimg.height ?? 0;
  return { w: typeof w === 'number' ? w : 0, h: typeof h === 'number' ? h : 0 };
}

export interface Canvas2DBackendOptions {
  readonly doc: VideoDoc;
  readonly timeline: ResolvedTimeline;
  readonly media: MediaProvider;
  readonly scenes?: SceneRegistry;
  /** 캔버스를 만드는 쪽. 창이 있으면 document, 워커면 OffscreenCanvas. */
  readonly createCanvas?: (w: number, h: number) => HTMLCanvasElement | OffscreenCanvas;
  readonly background?: string;
}

function defaultCreateCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

export class Canvas2DBackend implements RenderBackend {
  readonly id = 'canvas2d' as const;
  readonly capabilities: RenderBackendCapabilities = RENDER_BACKEND_CAPABILITIES.canvas2d;

  private surface: RenderSurface = { width: 0, height: 0 };
  private ctx: Ctx2D | null = null;
  private _canvas: HTMLCanvasElement | OffscreenCanvas | null = null;

  constructor(private readonly opts: Canvas2DBackendOptions) {}

  get canvas(): HTMLCanvasElement | OffscreenCanvas | null {
    return this._canvas;
  }

  async probe(): Promise<BackendProbe> {
    const hasCanvas = typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined';
    return hasCanvas
      ? { id: this.id, available: true }
      : { id: this.id, available: false, reason: '캔버스를 만들 수 없는 환경입니다.' };
  }

  async init(surface: RenderSurface): Promise<void> {
    this.surface = surface;
    const make = this.opts.createCanvas ?? defaultCreateCanvas;
    const canvas = make(surface.width, surface.height);
    canvas.width = surface.width;
    canvas.height = surface.height;
    const ctx = canvas.getContext('2d') as Ctx2D | null;
    if (!ctx) throw new Error('2D 컨텍스트를 얻지 못했습니다.');
    this._canvas = canvas;
    this.ctx = ctx;
  }

  async drawFrame(t: number): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) throw new Error('init 을 먼저 부르세요.');

    const { width, height } = this.surface;
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = this.opts.background ?? '#000000';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    const ops = buildDrawList(this.opts.doc, this.opts.timeline, t);
    const env: SceneEnv = { doc: this.opts.doc, size: this.opts.doc.size };

    for (const op of ops) {
      await this.drawOne(ctx, op, env);
    }
  }

  private async drawOne(ctx: Ctx2D, op: DrawOp, env: SceneEnv): Promise<void> {
    const { transform } = op;
    const alpha = transform.opacity * fadeFactor(op);
    if (alpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    // 회전은 사각형 가운데를 축으로 — 사람이 기대하는 방향.
    const cx = transform.x + transform.width / 2;
    const cy = transform.y + transform.height / 2;
    ctx.translate(cx, cy);
    if (transform.rotation !== 0) ctx.rotate((transform.rotation * Math.PI) / 180);
    if (transform.scale !== 1) ctx.scale(transform.scale, transform.scale);
    ctx.translate(-transform.width / 2, -transform.height / 2);

    try {
      switch (op.kind) {
        case 'shape':
          this.drawShape(ctx, op);
          break;
        case 'text':
          this.drawText(ctx, op);
          break;
        case 'caption':
          this.drawCaption(ctx, op);
          break;
        case 'image':
          await this.drawMedia(ctx, op, 'image');
          break;
        case 'footage':
          await this.drawMedia(ctx, op, 'footage');
          break;
        case 'scene':
          this.drawScene(ctx, op, env);
          break;
        case 'audio':
          break; // 화면에 그릴 것이 없다.
        default:
          break;
      }
    } finally {
      ctx.restore();
    }
  }

  private drawShape(ctx: Ctx2D, op: DrawOp): void {
    const p = op.resolved.item.props;
    const { width, height } = op.transform;
    const fill = str(p, 'fill', '#3B82F6');
    const stroke = str(p, 'stroke', '');
    const strokeWidth = num(p, 'strokeWidth', 0);
    const radius = num(p, 'radius', 0);
    const shape = str(p, 'shape', 'rect');

    ctx.beginPath();
    if (shape === 'ellipse') {
      ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    } else if (shape === 'line') {
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
    } else if (radius > 0 && typeof ctx.roundRect === 'function') {
      ctx.roundRect(0, 0, width, height, radius);
    } else {
      ctx.rect(0, 0, width, height);
    }

    if (shape !== 'line' && fill !== 'none') {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (strokeWidth > 0 && stroke !== '') {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  private drawText(ctx: Ctx2D, op: DrawOp): void {
    const p = op.resolved.item.props;
    const text = str(p, 'text', '');
    if (text === '') return;

    const size = num(p, 'fontSize', 64);
    const family = str(p, 'fontFamily', 'sans-serif');
    const weight = str(p, 'fontWeight', '700');
    const color = str(p, 'color', '#FFFFFF');
    const align = str(p, 'align', 'center');
    const lineHeight = num(p, 'lineHeight', 1.3);
    const { width, height } = op.transform;

    ctx.font = `${weight} ${size}px ${family}`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center';

    const lines = wrapText(ctx, text, width);
    const step = size * lineHeight;
    const total = step * lines.length;
    const x = align === 'left' ? 0 : align === 'right' ? width : width / 2;
    let y = height / 2 - total / 2 + step / 2;

    for (const line of lines) {
      ctx.fillText(line, x, y);
      y += step;
    }
  }

  private drawCaption(ctx: Ctx2D, op: DrawOp): void {
    if (op.cues.length === 0) return;
    const p = op.resolved.item.props;
    const size = num(p, 'fontSize', 48);
    const family = str(p, 'fontFamily', 'sans-serif');
    const color = str(p, 'color', '#FFFFFF');
    const boxColor = str(p, 'boxColor', 'rgba(0,0,0,0.62)');
    const padding = num(p, 'padding', 18);
    const bottom = num(p, 'bottom', 96);
    const { width, height } = op.transform;

    ctx.font = `600 ${size}px ${family}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    const maxWidth = width * 0.86;
    const lines = op.cues.flatMap((c) => wrapText(ctx, c.text, maxWidth));
    if (lines.length === 0) return;

    const step = size * 1.32;
    const blockH = step * lines.length;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const boxW = Math.min(width, widest + padding * 2);
    const boxH = blockH + padding * 1.2;
    const boxX = (width - boxW) / 2;
    const boxY = height - bottom - boxH;

    ctx.fillStyle = boxColor;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(boxX, boxY, boxW, boxH, 12);
    else ctx.rect(boxX, boxY, boxW, boxH);
    ctx.fill();

    ctx.fillStyle = color;
    let y = boxY + boxH / 2 - blockH / 2 + step / 2;
    for (const line of lines) {
      ctx.fillText(line, width / 2, y);
      y += step;
    }
  }

  private async drawMedia(ctx: Ctx2D, op: DrawOp, kind: 'image' | 'footage'): Promise<void> {
    const assetId = op.resolved.item.assetId;
    if (assetId === undefined) return;
    const src =
      kind === 'image'
        ? await this.opts.media.getImage(assetId)
        : await this.opts.media.getFrame(assetId, op.sourceTime);
    if (!src) return;

    const { w, h } = sourceSize(src);
    const box = containRect(w, h, op.transform.width, op.transform.height);
    ctx.drawImage(src, box.x, box.y, box.width, box.height);
  }

  private drawScene(ctx: Ctx2D, op: DrawOp, env: SceneEnv): void {
    const sceneId = op.resolved.item.sceneId;
    const fn = sceneId === undefined ? undefined : this.opts.scenes?.[sceneId];
    if (!fn) {
      // 조용히 빈 화면을 내지 않는다 — 없는 씬은 눈에 보이게 알린다.
      this.drawMissingScene(ctx, op, sceneId);
      return;
    }
    fn(ctx, op, env);
  }

  private drawMissingScene(ctx: Ctx2D, op: DrawOp, sceneId: string | undefined): void {
    const { width, height } = op.transform;
    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 4;
    ctx.setLineDash([16, 12]);
    ctx.strokeRect(2, 2, width - 4, height - 4);
    ctx.setLineDash([]);
    ctx.fillStyle = '#F59E0B';
    ctx.font = '600 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`등록되지 않은 씬: ${sceneId ?? '(없음)'}`, width / 2, height / 2);
  }

  dispose(): void {
    this.ctx = null;
    this._canvas = null;
  }
}
