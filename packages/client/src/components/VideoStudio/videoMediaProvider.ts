import type { MediaMeasurement } from '@vibisual/video';
import { MediabunnyMediaProvider, type DrawOp, type MediabunnyProviderOptions, type PickedElement } from '@vibisual/video/render';
import { CreationUiError } from '../Creation/creationErrors.js';
import { isImageDocument, type ImageDocument, type ImageLayer } from '../Creation/imageSource.js';
import { imageSvg } from '../Creation/imageRender.js';
import type { ModelFrameRenderer } from './videoModelFrames.js';
import type { VideoModelScene } from './videoModelScene.js';
import { objectDocumentRect, objectLocalPoint } from './videoObjectCoordinates.js';
import { layerPose, readLayerMotions } from './videoLayerMotion.js';

export type { ModelFrameRenderer } from './videoModelFrames.js';

/**
 * §5.13 (Y) 40-4 — 3D 는 **모델 소재가 있을 때만** 불러온다. 이 파일은 three.js 를 정적으로 부르지 않는다(타입만) — 모델 장면·
 * WebGL 그리기는 `videoModelScene.ts`·`videoModelFrames.ts` 를 그 순간 `import()` 한다. 정적으로 묶이면 모델 없는 문서도 그 2MB 를
 * 해석한 뒤에야 화면이 섰다(시험 `studioChunkGuard` 가 지킨다).
 */

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
const defaultCanvas = (width: number, height: number): AnyCanvas => {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    return canvas;
  }
  return new OffscreenCanvas(width, height);
};

/** Model scenes kept per provider. Older ones are disposed (their GPU and animation state is rebuilt on demand). */
export const VIDEO_MODEL_SCENE_LIMIT = 8;
interface ImageSource { doc: ImageDocument; bitmap: ImageBitmap; layers?: Promise<Map<string, LayerBitmap>>; layerImages?: Map<string, LayerBitmap> }
interface LayerBitmap { bitmap: ImageBitmap; x: number; y: number }
/** 모델 그리기 판의 모양(시험이 가짜를 넣는다 — 진짜는 늦게 불러온 `ModelFrameRenderer`). */
type ModelFrames = Pick<ModelFrameRenderer, 'draw' | 'dispose'>;

export interface VideoMediaProviderOptions extends MediabunnyProviderOptions {
  frames?: ModelFrames;
}

/** Video-owned Three adapter. Reuses the existing provider for images, footage, and sound measurement. */
export class VideoMediaProvider extends MediabunnyMediaProvider {
  private readonly models = new Map<string, Promise<VideoModelScene>>();
  private framesLoad: Promise<ModelFrames> | null = null;
  /** 불러온 그리기 판(닫을 때 그 자리에서 닫으려고 — 약속을 기다리지 않는다). */
  private framesReady: ModelFrames | null = null;
  private disposed = false;
  private readonly sourceImages = new Map<string, Promise<ImageSource>>();
  private readonly imageDocs = new Map<string, Promise<ImageDocument>>();

  constructor(private readonly config: VideoMediaProviderOptions) {
    super(config);
  }

  /** 모델 그리기 판 — 처음 모델을 그릴 때만 three.js 를 불러온다. */
  private frames(): Promise<ModelFrames> {
    if (!this.framesLoad) {
      const injected = this.config.frames;
      const loading: Promise<ModelFrames> = injected
        ? Promise.resolve(injected)
        : import('./videoModelFrames.js').then(({ ModelFrameRenderer }) => new ModelFrameRenderer());
      this.framesLoad = loading;
      void loading.then((frames) => {
        if (this.disposed) frames.dispose();
        else this.framesReady = frames;
      }, () => undefined);
      loading.catch(() => { if (this.framesLoad === loading) this.framesLoad = null; });
    }
    return this.framesLoad;
  }

  /** §5.13 (Y) 40-6 — 바뀌거나 빠진 소재의 모델 장면·편집 그림 기억도 함께 놓는다(그대로인 것은 남긴다). */
  protected override forgetAsset(assetId: string): void {
    super.forgetAsset(assetId);
    for (const [key, model] of [...this.models]) {
      if (!key.includes(`:${assetId}:`)) continue;
      this.models.delete(key);
      void model.then(loaded => loaded.dispose(), () => undefined);
    }
    const image = this.sourceImages.get(assetId);
    if (image) {
      this.sourceImages.delete(assetId);
      void image.then(value => {
        value.bitmap.close();
        value.layerImages?.forEach(part => part.bitmap.close());
        value.layerImages?.clear();
      }, () => undefined);
    }
    this.imageDocs.delete(assetId);
  }

  private async openBytes(assetId: string): Promise<Blob> {
    this.lifetime.signal.throwIfAborted();
    const asset = this.assetOf(assetId);
    if (!asset) throw new CreationUiError('model-asset-missing');
    const opened = await this.config.loader.open(asset, this.lifetime.signal);
    this.lifetime.signal.throwIfAborted();
    if (opened instanceof Blob) return opened;
    if (!opened) throw new CreationUiError('model-open-failed');
    const response = await (this.config.fetchFn ?? fetch)(opened, { signal: this.lifetime.signal });
    if (!response.ok) throw new CreationUiError('model-request-failed', { status: response.status });
    return response.blob();
  }

  /** The editable image document of an asset (read once; picking needs only this, never the rasterized picture). */
  private imageDoc(assetId: string): Promise<ImageDocument> {
    this.lifetime.signal.throwIfAborted();
    let result = this.imageDocs.get(assetId);
    if (!result) {
      result = (async () => {
        const doc: unknown = JSON.parse(await (await this.openBytes(assetId)).text());
        this.lifetime.signal.throwIfAborted();
        if (!isImageDocument(doc)) throw new CreationUiError('image-source-invalid');
        // Imported editable images carry their photos inline (the sources drawer resolves them on import).
        if (doc.layers.some(layer => layer.kind === 'image' && layer.source && !layer.source.startsWith('data:image/'))) {
          throw new CreationUiError('image-source-unavailable');
        }
        return doc;
      })();
      this.imageDocs.set(assetId, result);
      result.catch(() => this.imageDocs.delete(assetId));
    }
    return result;
  }
  private imageSource(assetId: string): Promise<ImageSource> {
    this.lifetime.signal.throwIfAborted();
    let result = this.sourceImages.get(assetId);
    if (!result) {
      result = (async () => {
        const doc = await this.imageDoc(assetId);
        this.lifetime.signal.throwIfAborted();
        const bitmap = await svgBitmap(imageSvg(doc), doc.width, doc.height);
        if (this.disposed) { bitmap.close(); throw new CreationUiError('image-stage-closed'); }
        return { doc, bitmap };
      })();
      this.sourceImages.set(assetId, result);
      result.catch(() => this.sourceImages.delete(assetId));
    }
    return result;
  }
  private isEditableImage(assetId: string | undefined): boolean {
    const asset = assetId ? this.assetOf(assetId) : undefined;
    return asset?.source.kind === 'file' && /\.vibimage$/i.test(asset.source.path);
  }

  override async getImage(assetId: string): Promise<ImageBitmap | null> {
    if (this.disposed) return null;
    if (this.isEditableImage(assetId)) return (await this.imageSource(assetId)).bitmap;
    return super.getImage(assetId);
  }

  /** Each layer as its own bitmap (cropped to its box, with room for text overflow) — built once, on first motion. */
  private layerBitmaps(source: ImageSource): Promise<Map<string, LayerBitmap>> {
    source.layers ??= (async () => {
      const result = new Map<string, LayerBitmap>();
      source.layerImages = result;
      try {
        for (const layer of source.doc.layers.filter(item => item.visible)) {
          this.lifetime.signal.throwIfAborted();
          const pad = Math.ceil(Math.max(layer.width, layer.height) * 0.25);
          const x = Math.floor(layer.x - pad), y = Math.floor(layer.y - pad);
          const width = Math.max(1, Math.ceil(layer.width + pad * 2)), height = Math.max(1, Math.ceil(layer.height + pad * 2));
          const solo: ImageDocument = { ...source.doc, background: 'transparent', layers: [{ ...layer, x: layer.x - x, y: layer.y - y }], width, height };
          const bitmap = await svgBitmap(imageSvg(solo), width, height);
          if (this.disposed) { bitmap.close(); this.lifetime.signal.throwIfAborted(); }
          result.set(layer.id, { bitmap, x, y });
        }
        return result;
      } catch (error) {
        result.forEach(part => part.bitmap.close());
        result.clear();
        throw error;
      }
    })();
    return source.layers;
  }
  /** An editable image whose layers move (`props.layerMotion`) is composed per frame; otherwise the still is used. */
  async getItemFrame(op: DrawOp): Promise<CanvasImageSource | null> {
    if (this.disposed) return null;
    const assetId = op.resolved.item.assetId;
    const motions = readLayerMotions(op.resolved.item.props);
    if (op.kind !== 'image' || !this.isEditableImage(assetId) || !Object.keys(motions).length) return null;
    const source = await this.imageSource(assetId!);
    if (this.disposed) return null;
    const layers = await this.layerBitmaps(source);
    if (this.disposed) return null;
    const { doc } = source;
    const canvas = defaultCanvas(doc.width, doc.height);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return null;
    if (doc.background !== 'transparent') { ctx.fillStyle = doc.background; ctx.fillRect(0, 0, doc.width, doc.height); }
    const travel = Math.min(doc.width, doc.height) * 0.08;
    for (const layer of doc.layers) {
      const part = layers.get(layer.id);
      if (!part) continue;
      const pose = layerPose(motions[layer.id], op.localTime, travel);
      if (pose.opacity <= 0) continue;
      const cx = layer.x + layer.width / 2, cy = layer.y + layer.height / 2;
      ctx.save();
      ctx.globalAlpha = pose.opacity;
      ctx.translate(cx + pose.dx, cy + pose.dy);
      ctx.scale(pose.scale, pose.scale);
      ctx.drawImage(part.bitmap, part.x - cx, part.y - cy);
      ctx.restore();
    }
    return canvas;
  }

  private model(op: DrawOp): Promise<VideoModelScene> {
    return this.modelAsset(op.resolved.item.assetId ?? '', op.itemId);
  }
  private modelAsset(assetId: string, itemId: string): Promise<VideoModelScene> {
    this.lifetime.signal.throwIfAborted();
    const asset = this.assetOf(assetId);
    if (!asset || asset.kind !== 'model') return Promise.reject(new CreationUiError('model-asset-missing'));
    const source = asset.source.kind === 'file' ? asset.source.path : asset.source.output;
    const key = `${itemId}:${asset.id}:${asset.contentHash ?? source}`;
    const cached = this.models.get(key);
    if (cached) {
      // Least recently used goes first.
      this.models.delete(key);
      this.models.set(key, cached);
      return cached;
    }
    // The bytes live only until the scene is parsed; nothing holds a GLB in memory afterwards.
    const model = this.openBytes(assetId).then(blob => {
      this.lifetime.signal.throwIfAborted();
      return blob.arrayBuffer();
    }).then(async data => {
      this.lifetime.signal.throwIfAborted();
      const { loadVideoModel } = await import('./videoModelScene.js');
      this.lifetime.signal.throwIfAborted();
      return loadVideoModel(data, source);
    }).then(loaded => {
      if (this.disposed) { loaded.dispose(); throw new CreationUiError('model-stage-closed'); }
      return loaded;
    });
    this.models.set(key, model);
    model.catch(() => { if (this.models.get(key) === model) this.models.delete(key); });
    this.evict();
    return model;
  }
  private evict(): void {
    while (this.models.size > VIDEO_MODEL_SCENE_LIMIT) {
      const [oldest, scene] = this.models.entries().next().value as [string, Promise<VideoModelScene>];
      this.models.delete(oldest);
      void scene.then(loaded => loaded.dispose(), () => undefined);
    }
  }

  override async measure(assetId: string): Promise<MediaMeasurement | null> {
    if (this.disposed) return null;
    if (this.assetOf(assetId)?.kind !== 'model') return super.measure(assetId);
    const model = await this.modelAsset(assetId, 'measurement');
    if (this.disposed) return null;
    return { duration: model.duration > 0 ? model.duration : null, width: null, height: null, hasAudio: false };
  }

  async getModelFrame(op: DrawOp): Promise<CanvasImageSource> {
    if (this.disposed) throw new CreationUiError('model-stage-closed');
    const [model, frames] = await Promise.all([this.model(op), this.frames()]);
    this.lifetime.signal.throwIfAborted();
    // Render and copy happen in this one synchronous step: another model's render cannot slip in between.
    return frames.draw(model, op);
  }

  async pickModel(op: DrawOp, x: number, y: number): Promise<PickedElement | null> {
    if (this.disposed) return null;
    if (op.kind === 'image') return this.pickImageLayer(op, x, y);
    if (op.kind !== 'model') return null;
    const model = await this.model(op);
    if (this.disposed) return null;
    model.seek(op);
    return model.pick(op, x, y);
  }
  /** The top visible layer of an editable image under the point, in document coordinates. */
  private async pickImageLayer(op: DrawOp, x: number, y: number): Promise<PickedElement | null> {
    const assetId = op.resolved.item.assetId;
    if (!this.isEditableImage(assetId)) return null;
    const doc = await this.imageDoc(assetId!);
    if (this.disposed) return null;
    const box = op.transform;
    const scale = Math.min(box.width / doc.width, box.height / doc.height);
    const ox = (box.width - doc.width * scale) / 2, oy = (box.height - doc.height * scale) / 2;
    const local = objectLocalPoint(box, x, y);
    const px = (local.x - ox) / scale, py = (local.y - oy) / scale;
    const inside = (layer: ImageLayer): boolean => layer.visible && layer.opacity > 0
      && px >= layer.x && px <= layer.x + layer.width && py >= layer.y && py <= layer.y + layer.height;
    const layer = [...doc.layers].reverse().find(inside);
    if (!layer) return null;
    // Raster bytes belong to the source asset, never to an agent's selection metadata.
    const { source: _raster, ...properties } = layer;
    return {
      path: `layer:${layer.id}`, objectId: layer.id, adapter: 'vibimage', tag: layer.kind, text: layer.text ?? layer.name, prop: null,
      rect: objectDocumentRect(box, { x: ox + layer.x * scale, y: oy + layer.y * scale, width: layer.width * scale, height: layer.height * scale }),
      properties,
    };
  }

  override dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    super.dispose();
    this.models.forEach(model => { void model.then(loaded => loaded.dispose(), () => undefined); });
    this.models.clear();
    this.sourceImages.forEach(image => {
      void image.then(value => {
        value.bitmap.close();
        value.layerImages?.forEach(part => part.bitmap.close());
        value.layerImages?.clear();
      }, () => undefined);
    });
    this.sourceImages.clear();
    this.imageDocs.clear();
    // 그리기 판은 불러온 적이 있을 때만 — 늦게 끝난 불러오기는 열리는 즉시 닫는다(위 `frames()`).
    this.framesReady?.dispose();
    this.framesReady = null;
    this.framesLoad = null;
  }
}

/** SVG markup → bitmap through an image element (createImageBitmap cannot decode SVG blobs). */
async function svgBitmap(svg: string, width: number, height: number): Promise<ImageBitmap> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return await createImageBitmap(image, { resizeWidth: Math.max(1, Math.round(width)), resizeHeight: Math.max(1, Math.round(height)) });
  } finally { URL.revokeObjectURL(url); }
}
