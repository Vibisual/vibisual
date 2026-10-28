import * as THREE from 'three';
import type { DrawOp } from '@vibisual/video/render';
import { CreationUiError } from '../Creation/creationErrors.js';
import { applyStudioEnvironment, releaseStudioEnvironment, renderStudioView } from '../Creation/studioLighting.js';
import type { VideoModelScene } from './videoModelScene.js';

/**
 * §5.13 (Y) 40-4 — 영상의 3D 그리기(three.js · 스튜디오 조명). 모델 소재가 있을 때만 공급자가 `import()` 로 불러온다.
 * `videoMediaProvider.ts` 에 정적으로 두면 three.js 와 모델 해독기(약 2MB)가 정적 청크에 묶여 모델 없는 문서도 그 2MB 를 해석한 뒤에야 화면이 선다(설치본 실측 — 정적 사슬 2.78MB 중 74%).
 * 시험(`studioChunkGuard`)이 스튜디오·렌더·일꾼 셸의 정적 import 닫힘에 three 가 다시 들어오지 못하게 지킨다.
 */

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
interface CanvasFactory { (width: number, height: number): AnyCanvas }
const defaultCanvas: CanvasFactory = (width, height) => {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    return canvas;
  }
  return new OffscreenCanvas(width, height);
};

/**
 * Renders model frames on one WebGL renderer and copies each result into a canvas of its own in the same synchronous step —
 * otherwise the next model render paints over a frame its caller has not drawn yet (two visible models show the second one twice).
 * A lost GL context is dropped and rebuilt.
 */
export class ModelFrameRenderer {
  private renderer: THREE.WebGLRenderer | null = null;
  constructor(
    private readonly create: () => THREE.WebGLRenderer = () => new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true }),
    private readonly canvas: CanvasFactory = defaultCanvas,
    private readonly environment: (scene: THREE.Scene, renderer: THREE.WebGLRenderer, level: number) => void = applyStudioEnvironment,
    private readonly renderView: typeof renderStudioView = renderStudioView,
  ) {}
  private current(): THREE.WebGLRenderer {
    if (this.renderer) return this.renderer;
    const renderer = this.create();
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0, 0);
    const element = renderer.domElement as HTMLCanvasElement | undefined;
    element?.addEventListener?.('webglcontextlost', (event: Event) => {
      event.preventDefault();
      if (this.renderer === renderer) this.drop();
    });
    this.renderer = renderer;
    return renderer;
  }
  draw(model: VideoModelScene, op: DrawOp): AnyCanvas {
    const width = Math.max(1, Math.round(op.transform.width));
    const height = Math.max(1, Math.round(op.transform.height));
    const renderer = this.current();
    renderer.setSize(width, height, false);
    model.renderOp(renderer, op, width, height, this.environment, this.renderView);
    const out = this.canvas(width, height);
    const ctx = out.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new CreationUiError('model-renderer-unavailable');
    ctx.drawImage(renderer.domElement, 0, 0);
    return out;
  }
  drop(): void {
    const renderer = this.renderer;
    this.renderer = null;
    if (!renderer) return;
    releaseStudioEnvironment(renderer);
    renderer.dispose();
  }
  dispose(): void {
    const renderer = this.renderer;
    this.drop();
    renderer?.forceContextLoss();
  }
}
