/**
 * §5.13 (E) 소재 공급자. Mediabunny 는 MPL-2.0 이라 수정 없이 의존성으로만 쓴다 — 동작 변경은 이 래퍼에서(THIRD-PARTY-LICENSES.md §3).
 * (X) 39-2 — Mediabunny 는 영상·소리를 실제로 열 때만 불러온다(정적이면 컴포지션만 든 문서도 디먹서·디코더를 다 해석한 뒤에야 첫 그림이 선다).
 * (Y) 40-3 — 아이템마다 읽개가 반복자 하나를 붙들고 순서대로 받는다(판단은 `footagePlan.ts`). 소재 하나의 `Input` 을 모든 아이템·소리가 나눠 쓰고, 디코더 수는 창마다 묶는다.
 * (Y) 40-6 — `setAssets` 는 지문(종류·경로·`contentHash`)이 그대로인 소재의 입력·읽개·비트맵을 남기고 바뀌거나 빠진 것만 닫는다.
 */

import type { Input, InputAudioTrack, InputVideoTrack, VideoSample, VideoSampleSink, EncodedPacketSink } from 'mediabunny';
import { ByteBudgetCache } from '@vibisual/shared';

import type { FrameHint, MediaProvider } from './canvas2d.js';
import {
  FOOTAGE_TIME_EPSILON_S,
  effectiveFootageReaderLimit,
  footageDecoderLimit,
  footageDrawWidth,
  isDecoderReclaimError,
  readerStep,
  type FootageWarmRequest,
  type FramePlayMode,
} from './footagePlan.js';
import type { MediaMeasurement } from '../fileDoc.js';
import type { VideoAsset } from '../types.js';

/** 소재 파일을 어떻게 읽을지는 호스트가 정한다(파일 시스템·URL·메모리). */
export interface AssetBytesLoader {
  /** 소재를 읽을 수 있는 형태로. 못 읽으면 null. */
  open(asset: VideoAsset, signal?: AbortSignal): Promise<Blob | string | null>;
}

/** §5.13 (Y) 40-2 — 소재 소리의 한 조각(디코딩된 PCM). `start` = 그 버퍼 첫 표본의 소재 안 시각(초). */
export interface AudioChunk {
  readonly buffer: AudioBuffer;
  readonly start: number;
}

type MediabunnyModule = typeof import('mediabunny');
let mediabunnyModule: Promise<MediabunnyModule> | null = null;

/** Mediabunny 를 한 번만 불러온다(39-2). 실패하면 다음 요청이 다시 시도한다(조용히 굳지 않게). */
export function loadMediabunny(): Promise<MediabunnyModule> {
  if (!mediabunnyModule) {
    const loading = import('mediabunny');
    mediabunnyModule = loading;
    loading.catch(() => { if (mediabunnyModule === loading) mediabunnyModule = null; });
  }
  return mediabunnyModule;
}

/** 크기 선언이 없는 SVG 를 그릴 기본 크기. */
const SVG_FALLBACK_SIZE = 1024;
/**
 * §5.13 (R-10) — 그림 바이트를 비트맵으로. `createImageBitmap` 은 SVG 블롭을 풀지 못하므로(Chromium) SVG 는 그림 요소로
 * 한 번 그려 캔버스에서 비트맵을 뜬다 — SVG 는 그림으로만 쓰이고 문서로 실행되지 않는다.
 */
async function decodeImageBlob(blob: Blob, svgByName: boolean): Promise<ImageBitmap> {
  if (!svgByName && blob.type !== 'image/svg+xml') return createImageBitmap(blob);
  const url = URL.createObjectURL(blob.type === 'image/svg+xml' ? blob : new Blob([blob], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const width = image.naturalWidth || SVG_FALLBACK_SIZE;
    const height = image.naturalHeight || SVG_FALLBACK_SIZE;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('image-renderer-unavailable');
    ctx.drawImage(image, 0, 0, width, height);
    return canvas.transferToImageBitmap();
  } finally { URL.revokeObjectURL(url); }
}

export interface MediabunnyProviderOptions {
  readonly assets: Readonly<Record<string, VideoAsset>>;
  readonly loader: AssetBytesLoader;
  /** 디코딩 결과의 최대 가로(배율을 모를 때의 상한 — 썸네일). 원본이 4K 여도 화면에 쓸 만큼만 받는다. */
  readonly maxFrameWidth?: number;
  /**
   * URL 소재를 읽을 fetch. 생략하면 그 문맥의 fetch 다. 응답을 통째로 넘기는 호스트(데스크톱 IPC)로 떨어지는 주소에는
   * `boundedRangeFetch` 를 넘긴다(§5.4 #36 (F) · §5.13 (Y) 40-1 — 스튜디오는 공급자를 만드는 한 곳이 늘 준다).
   */
  readonly fetchFn?: typeof fetch;
  /** §5.13 (Y) 40-11 — 소재 하나의 `UrlSource` 캐시(바이트). 생략하면 Mediabunny 기본(64MiB). */
  readonly urlCacheBytes?: number;
  /**
   * §5.13 (Y) 40-3 ⑦ — 썸네일·스틸·대표 프레임은 `prefer-software` 로 하드웨어 디코더 칸을 비워 둔다(재생이 쓰게). 그 코덱을
   * 소프트웨어로 못 풀면(HEVC 등) 지정하지 않는다(`isConfigSupported` 로 먼저 묻는다).
   */
  readonly decoderPreference?: 'prefer-software';
  /** §5.13 (Y) 40-11 — 미리보기 실사의 그리기 폭 상한(px, 기기 등급). 생략하면 `FOOTAGE_PREVIEW_WIDTH_MAX`. */
  readonly previewWidthMax?: number;
  /** §5.13 (Y) 40-10 ① · 40-11 — 실사 키프레임 포스터를 둘 바이트 예산(기기 등급). 생략하면 `FOOTAGE_POSTER_BYTES`. 0 이면 두지 않는다. */
  readonly posterCacheBytes?: number;
  /** §5.13 (Z) 41-4 — `<video>` 로 흘려 틀어도 되는 주소인가(구간을 끊을 수 있는 진짜 스트림). 생략하면 아무 주소도 내주지 않는다(응답을 통째로 싣는 통로에 `<video>` 를 걸지 않게). */
  readonly streamable?: (url: string) => boolean;
}

/** §5.13 (Y) 40-10 ① — 실사 아이템 포스터(키프레임 한 장)의 폭(px). 미리보기 칸이 커도 첫 순간 한 장이라 작게 둔다. */
export const FOOTAGE_POSTER_WIDTH = 480;
/** 포스터 기본 바이트 예산 — 480×270 한 장 약 0.5MB, 24장 남짓. */
export const FOOTAGE_POSTER_BYTES = 12 * 1024 * 1024;

interface InputEntry {
  readonly input: Input;
  videoTrack?: InputVideoTrack | null;
  audioTrack?: InputAudioTrack | null;
  sink?: VideoSampleSink | null;
  packets?: EncodedPacketSink | null;
  /** 같은 소재에서 디코드가 거듭 실패하면 소프트웨어로 내린다(회수 · 드라이버 오류). */
  software: boolean;
  failures: number;
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

/** 실사 아이템 포스터의 열쇠 — 소재 + 아이템(같은 소재를 다른 구간에서 쓰면 다른 장이다). */
function posterKey(assetId: string, itemId: string | undefined): string {
  return `${assetId}\u0000${itemId ?? ''}`;
}

function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  }
  return new OffscreenCanvas(width, height);
}

/** 소재가 같은 것인지 — 바뀌면(경로·내용 지문·종류) 그 소재가 붙든 것을 닫는다(40-6). */
function assetFingerprint(asset: VideoAsset | undefined): string {
  if (!asset) return '';
  const src = asset.source.kind === 'file' ? asset.source.path : asset.source.output;
  return `${asset.kind}\u0000${src}\u0000${asset.contentHash ?? ''}`;
}

/** 이 창의 플랫폼 이름(디코더 상한 판단용 — 판단 함수는 `platform` 을 인자로 받는다). */
function rendererPlatform(): string {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { userAgentData?: { platform?: string } });
  return nav?.userAgentData?.platform || nav?.platform || '';
}

/**
 * 아이템 하나의 읽개 — 반복자 하나 · 미리 받아 둔 다음 프레임 하나 · 그리기 판 두 장. 요청은 줄을 세운다(한 읽개를 두 요청이
 * 동시에 돌리지 않는다).
 */
class FrameReader {
  iterator: AsyncGenerator<VideoSample, void, unknown> | null = null;
  /** 마지막으로 그린 프레임의 시각(초) — 없으면 null. */
  currentTs: number | null = null;
  /** 미리 받아 둔 다음 프레임(아직 그리지 않음). */
  pending: VideoSample | null = null;
  ended = false;
  /** 끄는 중 보여 준 키프레임(같은 GOP 안에서 다시 끌면 다시 풀지 않는다). */
  keyframeTs: number | null = null;
  private readonly canvases: AnyCanvas[] = [];
  private flip = 0;
  painted: AnyCanvas | null = null;
  paintedTs: number | null = null;
  paintedWidth = 0;
  lastUsed = 0;
  private chain: Promise<unknown> = Promise.resolve();
  closed = false;

  constructor(readonly owner: MediabunnyMediaProvider, readonly key: string, readonly assetId: string) {}

  /** 줄에 선 요청 수(풀고 있는가 — 포스터를 먼저 낼지 가른다). */
  private inflight = 0;

  get busy(): boolean {
    return this.inflight > 0;
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    this.inflight += 1;
    const next = this.chain.then(fn, fn).finally(() => { this.inflight -= 1; });
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** 두 장을 번갈아 쓴다 — 방금 돌려준 그림을 다음 요청이 같은 판에 덮지 않게. */
  nextCanvas(width: number, height: number): AnyCanvas {
    this.flip = (this.flip + 1) % 2;
    let canvas = this.canvases[this.flip];
    if (!canvas) {
      canvas = makeCanvas(width, height);
      this.canvases[this.flip] = canvas;
    } else if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return canvas;
  }

  /** 반복자와 붙든 프레임을 놓는다(그리기 판은 남긴다 — 다음에 같은 자리를 다시 그리면 그대로 쓴다). */
  async stop(): Promise<void> {
    const iterator = this.iterator;
    this.iterator = null;
    this.pending?.close();
    this.pending = null;
    this.ended = false;
    this.currentTs = null;
    this.keyframeTs = null;
    if (iterator) {
      try { await iterator.return(undefined); } catch { /* 이미 끝났다 */ }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.stop();
    for (const canvas of this.canvases) {
      canvas.width = 0;
      canvas.height = 0;
    }
    this.canvases.length = 0;
    this.painted = null;
  }
}

/** 창(렌더러 프로세스) 하나의 살아 있는 읽개 — 디코더 상한은 창마다다(Chromium 의 압력 상한이 프로세스 단위). */
const liveReaders = new Set<FrameReader>();
let readerLimit = footageDecoderLimit(rendererPlatform());
let readerClock = 0;

/**
 * §5.13 (Y) 40-11 — 기기 등급 예산이 실사 읽개 수를 정한다(창 하나에 하나의 값). 그 OS 의 하드웨어 디코더 상한을 넘지 않는다
 * (`effectiveFootageReaderLimit` — 둘 중 작은 쪽). 1 미만이면 1.
 */
export function setFootageReaderLimit(limit: number): void {
  readerLimit = effectiveFootageReaderLimit(limit, rendererPlatform());
}

function touchReader(reader: FrameReader): void {
  reader.lastUsed = ++readerClock;
  liveReaders.add(reader);
  if (liveReaders.size <= readerLimit) return;
  const victims = [...liveReaders].filter((r) => r !== reader).sort((a, b) => a.lastUsed - b.lastUsed);
  for (const victim of victims) {
    if (liveReaders.size <= readerLimit) break;
    liveReaders.delete(victim);
    // 그 읽개의 다음 요청이 그 자리에서 다시 연다(키프레임부터).
    void victim.run(() => victim.stop());
  }
}

/** 소재마다 입력을 한 번만 열고 재사용한다(프레임마다 다시 열면 쓸수록 느려진다). */
export class MediabunnyMediaProvider implements MediaProvider {
  private assets: Readonly<Record<string, VideoAsset>>;
  private readonly fingerprints = new Map<string, string>();
  private readonly images = new Map<string, ImageBitmap | null>();
  private readonly entries = new Map<string, InputEntry | null>();
  /** 여는 중인 것(39-8) — 겹치는 첫 열기는 같은 약속을 나눠 쓴다(따로 만들면 먼저 것이 맵에서 덮여 닫히지 않은 채 남는다). */
  private readonly openingImages = new Map<string, Promise<ImageBitmap | null>>();
  private readonly openingEntries = new Map<string, Promise<InputEntry | null>>();
  /** Includes inputs still awaiting metadata, so disposal never waits for an outstanding read. */
  private readonly inputs = new Map<Input, string>();
  private readonly readers = new Map<string, FrameReader>();
  protected readonly lifetime = new AbortController();
  /** 공급자를 닫았는가(여는 중이던 것이 열리는 즉시 스스로 닫는다). 이름은 하위 클래스의 같은 뜻 칸과 겹치지 않게 따로 둔다. */
  private released = false;
  private mode: FramePlayMode = 'exact';
  private displayScale: number | undefined;
  /** §5.13 (Y) 40-12 — 재생 중 시계보다 늦어 그리지 않고 건너뛴 실사 프레임 수(계측 한 줄이 읽는다). */
  private droppedFrames = 0;
  /**
   * §5.13 (Y) 40-10 ① — 실사 아이템마다 키프레임 한 장(작은 판). 소재를 들이거나 문서가 열린 뒤 한가할 때 만들어 두고(`preparePosters`),
   * 재생이 데우지 못한 실사 장면으로 들어가면(점프 · 반복) 읽개가 첫 프레임을 풀 동안 이것을 먼저 그린다. 바이트 예산 안에서만.
   */
  private readonly posters: ByteBudgetCache<string, AnyCanvas>;
  private readonly posterWork = new Set<string>();

  constructor(private readonly opts: MediabunnyProviderOptions) {
    this.posters = new ByteBudgetCache<string, AnyCanvas>({
      name: 'video.footagePosters',
      maxBytes: opts.posterCacheBytes ?? FOOTAGE_POSTER_BYTES,
      sizeOf: (canvas) => canvas.width * canvas.height * 4 + 64,
    });
    this.assets = opts.assets;
    for (const [id, asset] of Object.entries(opts.assets)) this.fingerprints.set(id, assetFingerprint(asset));
  }

  /** 지금 소재(하위 클래스도 이것으로 읽는다 — `setAssets` 뒤의 목록). */
  protected assetOf(assetId: string): VideoAsset | undefined {
    return this.assets[assetId];
  }

  /** §5.13 (Z) 41-4 — 영상 소재이고 받개가 주소를 주며 그 주소가 `streamable` 일 때만. 그 밖·닫힌 공급자면 null(캔버스 길). */
  async streamUrl(assetId: string): Promise<string | null> {
    const asset = this.assetOf(assetId);
    const streamable = this.opts.streamable;
    if (!asset || asset.kind !== 'video' || !streamable || this.lifetime.signal.aborted) return null;
    try {
      const opened = await this.opts.loader.open(asset, this.lifetime.signal);
      return typeof opened === 'string' && streamable(opened) ? opened : null;
    } catch {
      return null;
    }
  }

  /**
   * §5.13 (Y) 40-6 — 소재 목록을 갈아 끼운다. 지문이 그대로인 소재는 그대로 쓰고, 바뀌거나 빠진 소재가 붙든 입력·읽개·비트맵만
   * 닫는다. 바뀐 소재 id 목록을 돌려준다(하위 클래스가 자기 기억을 함께 비운다).
   */
  setAssets(assets: Readonly<Record<string, VideoAsset>>): string[] {
    if (this.released) return [];
    const changed: string[] = [];
    const ids = new Set([...Object.keys(this.assets), ...Object.keys(assets)]);
    for (const id of ids) {
      const next = assetFingerprint(assets[id]);
      if ((this.fingerprints.get(id) ?? '') === next) continue;
      changed.push(id);
      if (next === '') this.fingerprints.delete(id);
      else this.fingerprints.set(id, next);
    }
    this.assets = assets;
    for (const id of changed) this.forgetAsset(id);
    return changed;
  }

  /** 그 소재가 붙든 것을 전부 놓는다. */
  protected forgetAsset(assetId: string): void {
    for (const key of this.posters.keys()) if (key.startsWith(`${assetId}\u0000`)) this.posters.delete(key);
    const bitmap = this.images.get(assetId);
    bitmap?.close();
    this.images.delete(assetId);
    this.openingImages.delete(assetId);
    this.openingEntries.delete(assetId);
    for (const [key, reader] of this.readers) {
      if (reader.assetId !== assetId) continue;
      this.readers.delete(key);
      liveReaders.delete(reader);
      void reader.run(() => reader.close());
    }
    const entry = this.entries.get(assetId);
    this.entries.delete(assetId);
    if (entry) this.disposeInput(entry.input);
    for (const [input, id] of this.inputs) if (id === assetId) this.disposeInput(input);
  }

  /** §5.13 (Y) 40-3 — 재생(순서대로 · 늦은 프레임 건너뜀) · 끌기(키프레임 먼저) · 정확한 한 장. 미리보기 쪽이 정한다. */
  setFrameMode(mode: FramePlayMode): void {
    this.mode = mode;
  }

  /** §5.13 (Y) 40-12 — 지금까지 건너뛴 실사 프레임 수(늘기만 한다 — 계측이 두 번 읽은 차를 쓴다). */
  droppedFrameCount(): number {
    return this.droppedFrames;
  }

  /** 문서 픽셀 → 화면 실제 픽셀 배율(무대 배율 × devicePixelRatio). 모르면(렌더·스틸) 원본 크기로 푼다. */
  setDisplayScale(scale: number | undefined): void {
    this.displayScale = scale !== undefined && scale > 0 ? scale : undefined;
  }

  async getImage(assetId: string): Promise<ImageBitmap | null> {
    if (this.released) return null;
    if (this.images.has(assetId)) return this.images.get(assetId) ?? null;
    const opening = this.openingImages.get(assetId);
    if (opening) return opening;

    const asset = this.assetOf(assetId);
    if (!asset) {
      this.images.set(assetId, null);
      return null;
    }
    const fingerprint = this.fingerprints.get(assetId);

    // eslint-disable-next-line prefer-const -- 아래 닫힘 안에서 자기 자신을 가리킨다(같은 약속인지 가르려고).
    let loading!: Promise<ImageBitmap | null>;
    loading = (async (): Promise<ImageBitmap | null> => {
      let bitmap: ImageBitmap | null = null;
      try {
        const opened = await this.opts.loader.open(asset, this.lifetime.signal);
        this.lifetime.signal.throwIfAborted();
        const svg = asset.source.kind === 'file' && /\.svg$/i.test(asset.source.path);
        if (opened instanceof Blob) {
          bitmap = await decodeImageBlob(opened, svg);
        } else if (typeof opened === 'string') {
          const res = await (this.opts.fetchFn ?? fetch)(opened, { signal: this.lifetime.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          this.lifetime.signal.throwIfAborted();
          bitmap = await decodeImageBlob(blob, svg);
        }
      } catch {
        bitmap = null; // 못 읽은 소재 하나가 렌더 전체를 막지 않는다.
      }
      if (this.openingImages.get(assetId) === loading) this.openingImages.delete(assetId);
      // 여는 사이 공급자가 닫혔거나 소재가 바뀌었다 — 붙들 사람이 없으니 바로 돌려준다(GPU 메모리를 GC 에 맡기지 않는다).
      if (this.released || this.fingerprints.get(assetId) !== fingerprint) { bitmap?.close(); return null; }
      this.images.set(assetId, bitmap);
      return bitmap;
    })();
    this.openingImages.set(assetId, loading);
    return loading;
  }

  /** 소재 하나의 입력(영상·소리가 나눠 쓴다). */
  private async ensureInput(assetId: string): Promise<InputEntry | null> {
    if (this.released) return null;
    if (this.entries.has(assetId)) return this.entries.get(assetId) ?? null;
    const opening = this.openingEntries.get(assetId);
    if (opening) return opening;

    const asset = this.assetOf(assetId);
    if (!asset) {
      this.entries.set(assetId, null);
      return null;
    }
    const fingerprint = this.fingerprints.get(assetId);

    // eslint-disable-next-line prefer-const -- 아래 닫힘 안에서 자기 자신을 가리킨다(같은 약속인지 가르려고).
    let loading!: Promise<InputEntry | null>;
    loading = (async (): Promise<InputEntry | null> => {
      let entry: InputEntry | null = null;
      try {
        const opened = await this.opts.loader.open(asset, this.lifetime.signal);
        this.lifetime.signal.throwIfAborted();
        if (opened === null) throw new Error('소재를 열 수 없습니다.');
        const mb = await loadMediabunny();
        this.lifetime.signal.throwIfAborted();
        const urlOptions = {
          ...(this.opts.fetchFn ? { fetchFn: this.opts.fetchFn } : {}),
          ...(this.opts.urlCacheBytes !== undefined ? { maxCacheSize: this.opts.urlCacheBytes } : {}),
        };
        const source = opened instanceof Blob ? new mb.BlobSource(opened) : new mb.UrlSource(opened, urlOptions);
        const input = new mb.Input({ formats: mb.ALL_FORMATS, source });
        this.inputs.set(input, assetId);
        entry = { input, software: this.opts.decoderPreference === 'prefer-software', failures: 0 };
        // 메타데이터(트랙)를 한 번 읽어 둔다 — 못 읽는 파일이면 여기서 걸러진다.
        entry.videoTrack = await input.getPrimaryVideoTrack();
        this.lifetime.signal.throwIfAborted();
      } catch {
        if (entry) this.disposeInput(entry.input);
        entry = null;
      }
      if (this.openingEntries.get(assetId) === loading) this.openingEntries.delete(assetId);
      if (this.released || this.fingerprints.get(assetId) !== fingerprint) {
        if (entry) this.disposeInput(entry.input);
        return null;
      }
      this.entries.set(assetId, entry);
      return entry;
    })();
    this.openingEntries.set(assetId, loading);
    return loading;
  }

  /** 영상 표본 받개(디코더 설정을 소재마다 한 번). 소프트웨어로 내렸으면 그 설정으로 다시 만든다. */
  private async videoSink(entry: InputEntry): Promise<VideoSampleSink | null> {
    if (entry.sink !== undefined && entry.sink !== null) return entry.sink;
    const track = entry.videoTrack;
    if (!track) return null;
    const mb = await loadMediabunny();
    let hardwareAcceleration: 'prefer-software' | undefined;
    if (entry.software) {
      // 그 코덱을 소프트웨어로 풀 수 있을 때만(HEVC 는 흔히 하드웨어 전용) — 못 풀면 지정하지 않는다.
      try {
        const config = await track.getDecoderConfig();
        if (config && typeof VideoDecoder !== 'undefined') {
          const support = await VideoDecoder.isConfigSupported({ ...config, hardwareAcceleration: 'prefer-software' });
          if (support.supported) hardwareAcceleration = 'prefer-software';
        }
      } catch { /* 물을 수 없으면 기본값 */ }
    }
    entry.sink = new mb.VideoSampleSink(track, hardwareAcceleration ? { hardwareAcceleration } : {});
    return entry.sink;
  }

  private reader(assetId: string, itemId: string | undefined): FrameReader {
    const key = `${assetId}\u0000${itemId ?? ''}`;
    let reader = this.readers.get(key);
    if (!reader || reader.closed) {
      reader = new FrameReader(this, key, assetId);
      this.readers.set(key, reader);
    }
    return reader;
  }

  /** 그 표본을 읽개의 그리기 판에 칸 크기로 옮기고 곧바로 닫는다. */
  private paint(reader: FrameReader, track: InputVideoTrack, sample: VideoSample, hint: FrameHint | undefined): AnyCanvas | null {
    try {
      const displayWidth = Math.max(1, track.displayWidth);
      const displayHeight = Math.max(1, track.displayHeight);
      let width = footageDrawWidth(displayWidth, hint?.boxWidth, this.displayScale, this.opts.previewWidthMax);
      if (this.displayScale === undefined && this.opts.maxFrameWidth !== undefined) width = Math.min(width, Math.max(2, this.opts.maxFrameWidth));
      const height = Math.max(1, Math.round((width * displayHeight) / displayWidth));
      const canvas = reader.nextCanvas(width, height);
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!ctx) return null;
      ctx.imageSmoothingQuality = 'high';
      ctx.clearRect(0, 0, width, height);
      sample.drawWithFit(ctx, { fit: 'fill', rotation: track.rotation });
      reader.painted = canvas;
      reader.paintedTs = sample.timestamp;
      reader.paintedWidth = width;
      return canvas;
    } finally {
      sample.close();
    }
  }

  /** 반복자에서 다음 표본(끝이면 null). */
  private async pull(reader: FrameReader): Promise<VideoSample | null> {
    if (reader.pending) {
      const s = reader.pending;
      reader.pending = null;
      return s;
    }
    if (!reader.iterator || reader.ended) return null;
    const r = await reader.iterator.next();
    if (r.done) {
      reader.ended = true;
      return null;
    }
    return r.value;
  }

  /** 읽개가 `t` 의 그림을 내도록 한다(판단은 `readerStep`). */
  private async frameFor(reader: FrameReader, entry: InputEntry, t: number, hint: FrameHint | undefined): Promise<AnyCanvas | null> {
    const track = entry.videoTrack;
    if (!track) return null;
    const step = readerStep({ currentTs: reader.currentTs, hasIterator: reader.iterator !== null }, t, this.mode);
    if (step === 'keyframe') return this.keyframeFor(reader, entry, track, t, hint);
    if (step === 'restart') {
      await reader.stop();
      const sink = await this.videoSink(entry);
      if (!sink || this.released) return null;
      reader.iterator = sink.samples(Math.max(0, t));
      const first = await this.pull(reader);
      if (!first) return reader.painted;
      reader.currentTs = first.timestamp;
      return this.paint(reader, track, first, hint);
    }
    // advance — 시계보다 늦은 프레임은 그리지 않고 닫는다(건너뛰기). 지난 것 중 가장 가까운 한 장만 그린다.
    let latest: VideoSample | null = null;
    for (;;) {
      const next = await this.pull(reader);
      if (!next) break;
      if (next.timestamp <= t + FOOTAGE_TIME_EPSILON_S) {
        if (latest) { latest.close(); this.droppedFrames += 1; }
        latest = next;
        reader.currentTs = next.timestamp;
        continue;
      }
      reader.pending = next; // 아직 그 시각이 아니다 — 다음 요청이 쓴다.
      break;
    }
    if (latest) return this.paint(reader, track, latest, hint);
    // 같은 프레임 안 — 이미 그린 판을 그대로(폭이 달라졌으면 그 자리에서 다시 연다).
    const want = footageDrawWidth(Math.max(1, track.displayWidth), hint?.boxWidth, this.displayScale, this.opts.previewWidthMax);
    if (reader.painted && (reader.paintedWidth === want || this.displayScale === undefined)) return reader.painted;
    reader.currentTs = null;
    return this.frameFor(reader, entry, t, hint);
  }

  /** 끄는 중 — 가까운 키프레임 한 장만 먼저(그 GOP 안에서는 다시 풀지 않는다). 손을 멈추면 정확한 프레임으로 바뀐다. */
  private async keyframeFor(reader: FrameReader, entry: InputEntry, track: InputVideoTrack, t: number, hint: FrameHint | undefined): Promise<AnyCanvas | null> {
    const mb = await loadMediabunny();
    entry.packets ??= new mb.EncodedPacketSink(track);
    const key = await entry.packets.getKeyPacket(Math.max(0, t), { metadataOnly: true });
    const keyTs = key?.timestamp ?? 0;
    if (reader.keyframeTs === keyTs && reader.painted) return reader.painted;
    const sink = await this.videoSink(entry);
    if (!sink) return null;
    const sample = await sink.getSample(keyTs);
    if (!sample) return reader.painted;
    reader.keyframeTs = keyTs;
    // 이어 받던 반복자는 그 자리가 아니다 — 다음 정확한 요청이 다시 연다.
    const painted = this.paint(reader, track, sample, hint);
    reader.currentTs = null;
    if (reader.iterator) {
      const iterator = reader.iterator;
      reader.iterator = null;
      reader.pending?.close();
      reader.pending = null;
      try { await iterator.return(undefined); } catch { /* 이미 끝났다 */ }
    }
    return painted;
  }

  async getFrame(assetId: string, timeInAsset: number, hint?: FrameHint): Promise<CanvasImageSource | null> {
    const entry = await this.ensureInput(assetId);
    if (this.released || !entry?.videoTrack) return null;
    const reader = this.reader(assetId, hint?.itemId);
    touchReader(reader);
    const decode = (): Promise<CanvasImageSource | null> => reader.run(async () => {
      if (this.released || reader.closed) return null;
      const t = Math.max(0, timeInAsset);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const canvas = await this.frameFor(reader, entry, t, hint);
          if (this.released || reader.closed) return null;
          entry.failures = 0;
          return canvas;
        } catch (error) {
          if (this.released || reader.closed) return null;
          // §5.13 (Y) 40-3 ⑦ — 디코더가 회수됐다(압력 상한 · 오래 숨음) — 그 자리에서 반복자를 새로 연다. 거듭 실패하면 소프트웨어로.
          await reader.stop();
          entry.failures += 1;
          if (!isDecoderReclaimError(error) && entry.failures >= 2 && !entry.software) {
            entry.software = true;
            entry.sink = null;
          }
        }
      }
      return null;
    });
    // §5.13 (Y) 40-10 ① — 재생이 데우지 못한 실사 장면으로 들어왔다(이 읽개가 아직 아무것도 못 그렸다) — 포스터가 있으면 그것을 먼저 내고
    //   첫 프레임은 뒤에서 푼다(이미 푸는 중이면 겹쳐 걸지 않는다 — 다음 요청이 받는다). 멈춤·끌기·스틸·렌더는 늘 정확한 프레임을 기다린다.
    if (this.mode === 'play' && reader.painted === null) {
      const poster = this.posters.get(posterKey(assetId, hint?.itemId));
      if (poster) {
        if (!reader.busy) void decode().catch(() => undefined);
        return poster;
      }
    }
    return decode();
  }

  /**
   * §5.13 (Y) 40-10 ① — 실사 아이템마다 키프레임 포스터를 만들어 둔다(이미 있으면 건너뛴다 · 하나씩 · 실패는 조용히). 부르는 쪽이
   * 한가할 때(배경 줄) 부른다. 읽개를 쓰지 않는다 — 키프레임 한 장을 따로 풀어 작은 판에 옮기고 바로 닫는다.
   */
  async preparePosters(requests: readonly FootageWarmRequest[], signal?: AbortSignal): Promise<number> {
    if (this.opts.posterCacheBytes === 0) return 0;
    let made = 0;
    for (const req of requests) {
      if (this.released || signal?.aborted) break;
      const key = posterKey(req.assetId, req.itemId);
      if (this.posters.has(key) || this.posterWork.has(key)) continue;
      this.posterWork.add(key);
      try {
        const entry = await this.ensureInput(req.assetId);
        const track = entry?.videoTrack;
        if (this.released || !entry || !track) continue;
        const mb = await loadMediabunny();
        entry.packets ??= new mb.EncodedPacketSink(track);
        const keyPacket = await entry.packets.getKeyPacket(Math.max(0, req.sourceTime), { metadataOnly: true });
        const sink = await this.videoSink(entry);
        if (!sink || this.released) continue;
        const sample = await sink.getSample(keyPacket?.timestamp ?? 0);
        if (!sample) continue;
        try {
          const width = Math.max(2, Math.min(FOOTAGE_POSTER_WIDTH, track.displayWidth));
          const height = Math.max(1, Math.round((width * Math.max(1, track.displayHeight)) / Math.max(1, track.displayWidth)));
          const canvas = makeCanvas(width, height);
          const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
          if (!ctx) continue;
          sample.drawWithFit(ctx, { fit: 'fill', rotation: track.rotation });
          if (this.released || this.assetOf(req.assetId) === undefined) continue;
          this.posters.set(key, canvas);
          made += 1;
        } finally {
          sample.close();
        }
      } catch {
        // 못 만들면 포스터 없이 — 재생은 종전대로 첫 프레임을 기다린다.
      } finally {
        this.posterWork.delete(key);
      }
    }
    return made;
  }

  /** 시험·계측 — 지금 둔 포스터 수와 바이트. */
  posterStats(): { count: number; bytes: number } {
    return { count: this.posters.size, bytes: this.posters.currentBytes() };
  }

  /** §5.13 (Y) 40-3 ④ — 곧 시작할 실사 아이템의 읽개를 그 아이템의 첫 시각에 세워 둔다(기다리지 않는다 · 실패는 조용히). */
  warmFootage(requests: readonly FootageWarmRequest[]): void {
    if (this.released) return;
    for (const req of requests) {
      const existing = this.readers.get(`${req.assetId}\u0000${req.itemId}`);
      if (existing && existing.currentTs !== null) continue;
      void (async () => {
        const entry = await this.ensureInput(req.assetId);
        if (this.released || !entry?.videoTrack) return;
        const reader = this.reader(req.assetId, req.itemId);
        if (reader.currentTs !== null) return;
        touchReader(reader);
        await reader.run(async () => {
          if (this.released || reader.closed || reader.currentTs !== null) return;
          const previous = this.mode;
          try {
            this.mode = 'exact';
            await this.frameFor(reader, entry, Math.max(0, req.sourceTime), undefined);
          } finally {
            this.mode = previous;
          }
        });
      })().catch(() => undefined);
    }
  }

  /** §5.13 (Y) 40-2 ② — 소리 한 조각 `[index·chunk, (index+1)·chunk)`(초)만 디코딩한다. 소리 트랙이 없거나 못 푸는 코덱이면 null — 부르는 쪽이 통째 디코딩으로 물러선다. */
  async getAudioChunk(assetId: string, index: number, chunkSeconds: number, signal?: AbortSignal): Promise<AudioChunk | null> {
    const entry = await this.ensureInput(assetId);
    if (this.released || !entry) return null;
    if (entry.audioTrack === undefined) {
      try { entry.audioTrack = await entry.input.getPrimaryAudioTrack(); } catch { entry.audioTrack = null; }
    }
    const track = entry.audioTrack;
    if (!track) return null;
    if (!(await track.canDecode().catch(() => false))) return null;
    const mb = await loadMediabunny();
    const from = Math.max(0, index * chunkSeconds);
    const to = from + chunkSeconds;
    const sink = new mb.AudioBufferSink(track);
    const parts: { buffer: AudioBuffer; timestamp: number }[] = [];
    for await (const wrapped of sink.buffers(from, to)) {
      signal?.throwIfAborted();
      if (this.released) return null;
      parts.push({ buffer: wrapped.buffer, timestamp: wrapped.timestamp });
    }
    const first = parts[0];
    // 그 구간에 소리가 없다(트랙 끝 너머) — 못 푼 것이 아니라 비었다. 표본 하나짜리 무음 조각으로 답한다(물러서지 않게).
    if (!first) return { buffer: new AudioBuffer({ length: 1, numberOfChannels: 1, sampleRate: track.sampleRate > 0 ? track.sampleRate : 48_000 }), start: from };
    const sampleRate = first.buffer.sampleRate;
    const channels = first.buffer.numberOfChannels;
    const last = parts[parts.length - 1]!;
    const length = Math.max(1, Math.round((last.timestamp + last.buffer.duration - first.timestamp) * sampleRate));
    const out = new AudioBuffer({ length, numberOfChannels: channels, sampleRate });
    for (const part of parts) {
      const offset = Math.round((part.timestamp - first.timestamp) * sampleRate);
      if (offset >= length) continue;
      const room = length - offset;
      for (let ch = 0; ch < channels; ch += 1) {
        const data = part.buffer.getChannelData(Math.min(ch, part.buffer.numberOfChannels - 1));
        out.copyToChannel(room < data.length ? data.subarray(0, room) : data, ch, offset);
      }
    }
    return { buffer: out, start: first.timestamp };
  }

  /** 영상 소재의 실제 길이(초). `duration:'auto'` 를 채울 때 쓴다. */
  async measureDuration(assetId: string): Promise<number | null> {
    const entry = await this.ensureInput(assetId);
    if (this.released || !entry) return null;
    try {
      const duration = await entry.input.computeDuration();
      return this.released ? null : duration;
    } catch {
      return null;
    }
  }

  /** §5.13 (R-3). 소리 파일이면 크기는 null. 크기는 회전 메타데이터를 반영한 보이는 크기다 — 휴대폰 세로 영상은 가로로 저장돼 coded 크기면 판형이 눕는다. */
  async measure(assetId: string): Promise<MediaMeasurement | null> {
    if (this.released) return null;
    const asset = this.assetOf(assetId);
    if (!asset) return null;
    // Images are decoded by the browser, not a media-container demuxer. Treating
    // PNG/JPEG as video inputs makes every image import fail before insertion.
    if (asset.kind === 'image') {
      const image = await this.getImage(assetId);
      return !this.released && image ? { duration: null, width: image.width, height: image.height, hasAudio: false } : null;
    }
    const entry = await this.ensureInput(assetId);
    if (this.released || !entry) return null;
    let duration: number | null = null;
    let width: number | null = null;
    let height: number | null = null;
    let hasAudio: boolean | undefined;
    try {
      duration = await entry.input.computeDuration();
    } catch {
      duration = null;
    }
    if (this.released) return null;
    const track = entry.videoTrack;
    if (track) {
      width = track.displayWidth;
      height = track.displayHeight;
    }
    try {
      if (entry.audioTrack === undefined) entry.audioTrack = await entry.input.getPrimaryAudioTrack();
      hasAudio = entry.audioTrack !== null;
    } catch { /* A failed probe means unknown, not proven silent. */ }
    if (this.released) return null;
    return { duration, width, height, ...(hasAudio === undefined ? {} : { hasAudio }) };
  }

  /**
   * 붙든 것을 전부 돌려준다 — 비트맵은 닫고, 읽개는 반복자를 `return()` 하고, 영상 입력은 `dispose()` 로 디코더까지 닫는다
   * (39-8 · 40-3 ⑤). 메타데이터를 읽는 중인 입력도 즉시 닫는다. `FinalizationRegistry` 로 정리하지 않는다.
   */
  dispose(): void {
    if (this.released) return;
    this.released = true;
    this.lifetime.abort();
    for (const bitmap of this.images.values()) bitmap?.close();
    this.images.clear();
    for (const reader of this.readers.values()) {
      liveReaders.delete(reader);
      void reader.run(() => reader.close());
    }
    this.readers.clear();
    for (const input of [...this.inputs.keys()]) this.disposeInput(input);
    this.entries.clear();
    this.openingImages.clear();
    this.openingEntries.clear();
    this.posters.clear();
  }

  private disposeInput(input: Input | undefined): void {
    if (!input || !this.inputs.delete(input)) return;
    try { input.dispose(); } catch { /* Already closed or interrupted. */ }
  }
}
