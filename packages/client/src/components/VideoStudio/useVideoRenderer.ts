import type { VideoMediaProvider } from './videoMediaProvider.js';
/**
 * §5.13 — 렌더 글루: 순수 층(`@vibisual/video`)과 브라우저 렌더 층(`@vibisual/video/render`)을 화면에 붙인다.
 * 미리보기·스틸·최종 렌더가 같은 경로로 그려야 결과가 어긋나지 않으므로, 백엔드 선택·인코더 조립은 여기서 한 번만 한다.
 * 백엔드 세 종이 모두 후보로 서고, 못 쓰는 것은 탐지 단계에서 이유와 함께 걸러진다 — 내려간 사실은 호출부가 화면에 알린다(조용히 느려지지 않게).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CUES_TIMEOUT_MS,
  computeFrameStats,
  cueScanLength,
  docHasCompositions,
  docTextBoxesAt,
  encodeWav,
  resolveTimeline,
  scaledSize,
  stableHash,
  type CompositionCue,
  type ExportRange,
  type CueScanError,
  type FrameProbe,
  type MediaMeasurement,
  type ProbeText,
  type ResolvedTimeline,
  type VideoAsset,
  type VideoDoc,
} from '@vibisual/video';
// 여기서 던지는 오류 문구는 호출부가 `String(err)` 로 **화면에 그대로** 찍는다. 모듈 수준 함수
// (`makeOffscreenBridge`)에서도 골라야 해서 훅이 아니라 i18n 인스턴스를 직접 쓴다(useWebSocket 선례).
import i18n from '../../i18n/index.js';
import {
  Canvas2DBackend,
  CompositionFrame,
  HtmlInCanvasBackend,
  HtmlSceneStage,
  OffscreenCaptureBackend,
  PooledCaptureBackend,
  audioLevelAt,
  autoReview,
  captureSessionCount,
  mixAudio,
  renderDoc,
  selectRenderBackend,
  withBuiltinScenes,
  type AssetBytesLoader,
  type BackendProbe,
  type BackendSelection,
  type CapturedFrame,
  type EncodeQualityLevel,
  type MediaProvider,
  type OffscreenCaptureBridge,
  type OffscreenOpenResult,
  type OffscreenText,
  type OutputContainer,
  type RenderBackend,
  type RenderProgress,
} from '@vibisual/video/render';
import { VIDEO_CAPTURE_SESSIONS } from '@vibisual/video';

import { compositionAssetSrc, makeCompositionSrc } from './compositionUrl.js';
import { createStudioMedia, studioAudioLoader } from './studioMedia.js';
import { studioBudget } from './studioBudget.js';

export interface RenderOutcome {
  readonly bytes: Uint8Array;
  readonly selection: BackendSelection | null;
  /** 소리를 실제로 실었는가. 무음으로 나갔다면 호출부가 알려야 한다. */
  readonly hasAudio: boolean;
  readonly warnings: readonly string[];
  /** §5.13 (W) 38-3 — 결과 그릇(mp4 · 투명 배경이면 webm). §5.13 (AA) 42-1 — 소리만이면 wav. */
  readonly container: OutputContainer | 'wav';
}

/** §5.13 (AA) 42 — 렌더 한 번의 그리는 방법(없는 칸은 종전 그대로). */
export interface RenderCallOptions {
  readonly onProgress?: (p: RenderProgress) => void;
  readonly signal?: AbortSignal;
  /** §5.13 (W) 38-3 — 투명 배경 WebM(알파). */
  readonly transparent?: boolean;
  readonly quality?: EncodeQualityLevel;
  /** 해상도 배율(문서 크기 기준 — 짝수로). */
  readonly scale?: number;
  readonly fps?: number | null;
  /** false = 소리 트랙 없이(내보내기 음소거). */
  readonly audio?: boolean;
  readonly range?: ExportRange | null;
  readonly container?: OutputContainer;
  /** 소리만(WAV). */
  readonly audioOnly?: boolean;
  /** 프레임 사이 관문(일시정지). */
  readonly gate?: () => Promise<void>;
}

export interface RendererHandle {
  drawPreview: (canvas: HTMLCanvasElement, t: number) => Promise<void>;
  /** §5.13 (W) 38-3 — `transparent` 면 투명 배경 WebM(알파). §5.13 (AA) 42 — 화질·해상도·프레임·구간·소리·그릇·관문. */
  render: (opts: RenderCallOptions) => Promise<RenderOutcome>;
  /** 한 장(PNG data URL). `maxEdge` 를 주면 그 안으로 줄인다(0·없음 = 문서 원본 크기). */
  still: (t: number, maxEdge?: number) => Promise<string>;
  /**
   * §5.13 (T-9) — 여러 장을 **앞에서부터 차례로** 한 무대에서 찍는다(프레임 띠). 순방향 전용 컴포지션도 처음부터 한 번만
   * 흘린다(칸마다 무대를 다시 열지 않는다). 그림 순서는 `times` 순서다. §5.13 (X) 39-4 — `imageType` 이 `webp` 면 그 형식(작은
   * 대표 프레임 — 같은 크기 png 의 몇 분의 일).
   */
  stills: (times: readonly number[], maxEdge?: number, onFrame?: (index: number) => void, imageType?: 'png' | 'webp') => Promise<string[]>;
  review: () => Promise<{ findings: readonly { code: string; level: string; message: string }[] }>;
  /**
   * §5.13 (V) 37-9 — 프레임 검수 표본: 그 시각들을 차례로 찍어 평평함(빈 화면)·글자 상자(문서 글자 + 컴포지션 안 글자)·그 둘레
   * 바탕 밝기를 잰다. 판정은 순수 함수(`reviewMotion`)가 한다 — 여기서는 재기만 한다.
   */
  probeFrames: (times: readonly number[]) => Promise<FrameProbe[]>;
  /**
   * §5.13 (T-8) — 표지 모으기: 그 컴포지션 하나를 샌드박스 프레임으로 열어 0초부터 끝까지 고정 걸음으로 한 번 흘린다(찍지 않는다).
   * 받은 표지·오류를 그대로 돌려준다 — 다듬기(겹침·순서·상한·같은 이름)는 서버의 순수 함수(`settleCues`)가 한다.
   */
  collectCues: (assetId: string) => Promise<{ cues: CompositionCue[]; errors: CueScanError[] }>;
  lastSelection: () => BackendSelection | null;
  /**
   * 미리보기용 소재 공급자 — 소재 목록이 같은 동안 하나를 계속 쓴다. §5.13 (T-7) 컴포지션 문서의 DOM 무대 미리보기도 이것을
   * 받는다(영상 프레임을 무대마다 다시 열지 않게). §5.13 (Y) 40-2 · 40-3 — 소리 조각·프레임 방식·화면 배율·놓친 프레임 수도 이 공급자에
   * 묻는다(그래서 스튜디오 공급자 형으로 낸다).
   */
  media: VideoMediaProvider | null;
}

/** 오프스크린 세션 열쇠 — 일감마다 자기 창을 쓴다(렌더 중에 찍는 스틸이 렌더의 창을 닫지 않게, §5.13 (T-4)). */
function newSessionKey(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** §5.13 (X) 39-4 — webp 로 구울 때의 품질(작은 대표 프레임 — 눈으로 차이가 안 나는 선). */
const STILL_WEBP_QUALITY = 0.86;

/**
 * 캔버스 → data URL(기본 PNG). `maxEdge` 가 있고 더 크면 그 안으로 줄인다(에이전트 확인용은 작아도 된다). `webp` 를 못 굽는 판이면
 * 브라우저가 PNG 로 돌려준다(주소 머리가 그 형식을 말한다 — 받는 쪽이 머리로 가른다).
 */
function canvasToPng(source: HTMLCanvasElement | OffscreenCanvas, maxEdge?: number, imageType: 'png' | 'webp' = 'png'): string {
  const w = source.width;
  const h = source.height;
  const scale = maxEdge !== undefined && maxEdge > 0 && Math.max(w, h) > maxEdge ? maxEdge / Math.max(w, h) : 1;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w * scale));
  out.height = Math.max(1, Math.round(h * scale));
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error(i18n.t('panel.videoStudio.errNoDoc'));
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return imageType === 'webp' ? out.toDataURL('image/webp', STILL_WEBP_QUALITY) : out.toDataURL('image/png');
}


/**
 * 소재들을 실제로 읽어 길이·크기를 잰다(§5.13 (R-3)). 못 읽은 소재는 결과에서 빠진다.
 *
 * `duration:'auto'` 는 이 값이 문서에 적혀야 풀린다 — 재지 않으면 해소기가 그 아이템을
 * 통째로 빼서 화면이 빈다.
 */
export async function measureAssets(
  project: string,
  assets: readonly VideoAsset[],
): Promise<Record<string, MediaMeasurement>> {
  const out: Record<string, MediaMeasurement> = {};
  if (assets.length === 0) return out;
  const media = createStudioMedia(project, Object.fromEntries(assets.map((a) => [a.id, a])));
  try {
    for (const asset of assets) {
      const m = await media.measure(asset.id);
      if (m) out[asset.id] = m;
    }
  } finally {
    media.dispose();
  }
  return out;
}

/** §5.13 (W) 38-3·38-7 — 오프스크린 창을 열 때 렌더 화면에 넘길 것. */
interface BridgeExtras {
  readonly revId?: string | undefined;
  /** 투명 배경(창·문서·무대 배경을 비운다). */
  readonly alpha?: boolean | undefined;
  /** 장면 정지 화면 — 그 컴포지션 하나짜리 문서로 무대를 세운다. */
  readonly frame?: string | undefined;
}

/**
 * main 프로세스의 오프스크린 창을 조종하는 다리. 앱 전용 채널을 쓰지 않는다 — 코어 통로는 `app.invoke(appId, action, payload)` 하나뿐이고,
 * 뜻은 이 앱과 `main/apps/vibistudio.ts` 만 안다(§5.13 (O)).
 * §5.13 (W) 38-1 — 찍기는 날 비트맵(`format:'raw'`)으로 받는다(main 이 PNG 를 굽지 않게). 옛 main 이 PNG 를 돌려줘도 받는다.
 */
function makeOffscreenBridge(project: string, docId: string, session: string = newSessionKey(), extras: BridgeExtras = {}): OffscreenCaptureBridge {
  const api = window.api?.app;
  const call = async <T,>(action: string, payload?: unknown): Promise<T> =>
    (await api!.invoke('vibistudio', action, payload)) as T;
  return {
    async probe() {
      if (!api) return { available: false, reason: i18n.t('panel.videoStudio.errNoOffscreen') };
      try {
        return await call<{ available: boolean; reason?: string }>('offscreen:probe');
      } catch (err) {
        return { available: false, reason: String(err) };
      }
    },
    async open({ width, height }) {
      if (!api) throw new Error(i18n.t('panel.videoStudio.errNoOffscreenBridge'));
      // §5.13 (V) 37-3 — 판 기록의 한 판이면 그 판의 문서·코드로 무대를 세운다.
      const result = await call<OffscreenOpenResult | null>('offscreen:open', {
        width, height, project, docId, session,
        ...(extras.revId ? { rev: extras.revId } : {}),
        ...(extras.alpha === true ? { alpha: true } : {}),
        ...(extras.frame ? { frame: extras.frame } : {}),
      });
      return result ?? undefined;
    },
    async captureAt(t) {
      if (!api) throw new Error(i18n.t('panel.videoStudio.errNoOffscreenBridge'));
      return call<CapturedFrame>('offscreen:capture', { t, session, format: 'raw' });
    },
    async close() {
      // §5.13 (Y) 40-7 ③ — 기기 예산이 허락하면 창을 쉬게 둔다(다음 스틸·검수가 본체를 다시 읽지 않게).
      if (api) await call<null>('offscreen:close', { session, keep: studioBudget().offscreenIdleWindows > 0 });
    },
    // §5.13 (V) 37-9 — 마지막으로 찍은 시각의 컴포지션 글자 상자(읽기 전용).
    async inspect() {
      if (!api) return [];
      return call<OffscreenText[]>('offscreen:inspect', { session });
    },
  };
}

/** 평평한 프레임으로 볼 문턱(종전 자동 검수와 같은 값). */
const FLAT_STD = 0.012;
const FLAT_VARIED = 0.01;
/** §5.13 (T-8) — 선언 길이도 놓인 구간도 없는 컴포지션을 표지 모으기로 흘릴 길이(초). */
const CUE_SCAN_FALLBACK_S = 10;
/** 일꾼이 보고에 싣는 표지·오류 상한(서버 상한 `COMPOSITION_CUES_MAX` 보다 넉넉히 — 겹침은 서버가 접는다). */
const CUE_COLLECT_MAX = 2000;
const CUE_ERRORS_MAX = 20;

/** 글자 상자 둘레에서 바탕 밝기를 재는 띠의 두께(px). */
const BG_BAND_PX = 10;

function channelLinear(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/**
 * §5.13 (V) 37-9 — 글자 상자 **둘레 띠**의 평균 상대 휘도(글자 자신은 빼고 바탕만). 화면 밖은 자른다. 잴 픽셀이 없으면 undefined.
 */
function backgroundLuminance(image: ImageData, rect: { x: number; y: number; width: number; height: number }): number | undefined {
  const W = image.width;
  const H = image.height;
  const x0 = Math.max(0, Math.floor(rect.x - BG_BAND_PX));
  const y0 = Math.max(0, Math.floor(rect.y - BG_BAND_PX));
  const x1 = Math.min(W, Math.ceil(rect.x + rect.width + BG_BAND_PX));
  const y1 = Math.min(H, Math.ceil(rect.y + rect.height + BG_BAND_PX));
  let sum = 0;
  let n = 0;
  const step = 3;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const insideText = x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
      if (insideText) continue;
      const i = (y * W + x) * 4;
      const d = image.data;
      sum += 0.2126 * channelLinear(d[i] ?? 0) + 0.7152 * channelLinear(d[i + 1] ?? 0) + 0.0722 * channelLinear(d[i + 2] ?? 0);
      n += 1;
    }
  }
  return n > 0 ? sum / n : undefined;
}

/** §5.13 (W) 38-1 — 찍힌 해상도가 문서보다 이만큼 모자라면(창을 문서 크기로 못 키운 기기) 렌더 결과에 알린다. */
const CAPTURE_RATIO_WARN = 0.99;

/**
 * @param opts.revId §5.13 (V) 37-3 — 판 기록의 한 판을 그릴 때(일꾼의 판 정지 화면). 컴포지션은 그 판의 코드로 내준다.
 * @param opts.frameChapter §5.13 (W) 38-7 — 장면 정지 화면을 그릴 때(문서는 이미 그 컴포지션 하나짜리로 바뀌어 온다 — 오프스크린
 *   렌더 화면도 같은 문서를 세우게 그 장면 id 를 넘긴다).
 */
export function useVideoRenderer(project: string, doc: VideoDoc | null, opts: { revId?: string | undefined; frameChapter?: string | undefined; previewActive?: boolean } = {}): RendererHandle {
  const revId = opts.revId;
  const frameChapter = opts.frameChapter;
  const selectionRef = useRef<BackendSelection | null>(null);
  const timeline = useMemo(() => (doc ? resolveTimeline(doc) : null), [doc]);

  /** 이 기기에서 쓸 수 있는 백엔드를 골라 하나 만든다(세 후보 전부 탐지). `transparent` 면 투명 배경으로 그린다. */
  const makeBackend = useCallback(
    async (d: VideoDoc, transparent = false): Promise<{ backend: RenderBackend; selection: BackendSelection } | null> => {
      const media = createStudioMedia(project, d.assets);
      const resolved = resolveTimeline(d);

      // html-in-canvas 는 그릴 DOM 이 있어야 의미가 있다 — 실제 무대를 세워 준다.
      //   §5.13 (T-3) — composition 은 샌드박스 iframe 으로 선다(주소는 프로젝트·문서를 아는 이쪽이 만든다).
      const stage = new HtmlSceneStage({ doc: d, timeline: resolved, media, compositionSrc: makeCompositionSrc(project, d, revId), strict: true, transparent });

      // §5.13 (W) 38-2 — 오프스크린 캡처는 세션(숨은 창) 여럿이 프레임을 나눠 찍는다(코어 수 절반 이하).
      const sessions = captureSessionCount(VIDEO_CAPTURE_SESSIONS, typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined);
      const extras: BridgeExtras = { revId, alpha: transparent, frame: frameChapter };
      const candidates: RenderBackend[] = [
        new HtmlInCanvasBackend({ stage }),
        new PooledCaptureBackend({
          bridges: Array.from({ length: sessions }, () => makeOffscreenBridge(project, d.id, undefined, extras)),
          alpha: transparent,
        }),
        // §5.13 (F)(T-4) — 컴포지션이 든 문서면 canvas2d 는 이유와 함께 빠진다(표식만 찍힌 영상이 조용히 나가지 않게).
        new Canvas2DBackend({ doc: d, timeline: resolved, media, scenes: withBuiltinScenes(), refuseCompositions: true, ...(transparent ? { background: null } : {}) }),
      ];

      const probes: BackendProbe[] = [];
      const compositions = docHasCompositions(d);
      for (const b of candidates) {
        // §5.13 (T-4) — html-in-canvas 가 교차 출처 샌드박스 iframe(컴포지션)의 안쪽까지 그린다는 보장이 없다 — 빈 칸이
        //   조용히 나가지 않게, 컴포지션 문서는 창을 통째로 찍는 오프스크린 캡처로만 렌더한다(이유는 선택 결과에 남는다).
        if (compositions && b.id === 'html-in-canvas') {
          probes.push({ id: b.id, available: false, reason: 'code compositions render through offscreen capture only (cross-origin iframes are not guaranteed to paint in html-in-canvas)' });
          continue;
        }
        probes.push(await b.probe());
      }

      const selection = selectRenderBackend(probes);
      if (!selection) {
        stage.dispose();
        media.dispose();
        return null;
      }

      const backend = candidates.find((b) => b.id === selection.chosen);
      if (!backend) {
        stage.dispose();
        media.dispose();
        return null;
      }

      // 안 고른 무대는 바로 치운다 — 화면 밖 DOM 이 남아 쌓이지 않게.
      if (selection.chosen !== 'html-in-canvas') stage.dispose();

      selectionRef.current = selection;
      return { backend, selection };
    },
    [project, revId, frameChapter],
  );

  /**
   * 미리보기 전용 소재 공급자 — 소재 목록이 같은 동안 하나를 계속 쓴다. 프레임마다 새로 만들면 매번 파일을 다시 열고(통합 앱은 IPC 로 파일 전체를 다시 받는다)
   * 키프레임부터 다시 디코딩해 재생이 사실상 멈춘다. 컷을 옮기거나 자막을 고쳐도 소재가 그대로면 연 입력을 그대로 쓴다.
   */
  const assets = opts.previewActive === false ? undefined : doc?.assets;
  const previewOn = assets !== undefined;
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  // §5.13 (Y) 40-6 — 공급자는 프로젝트 하나에 하나다. 소재 지문을 열쇠로 하면 효과음 하나만 더해도 공급자가 새로 서서 매인 무대·실사 입력이 전부 다시 열린다.
  //   소재 목록은 `setAssets` 로 갈아 끼운다(그대로인 소재의 입력·읽개는 남는다).
  const [mediaLease, setMediaLease] = useState<{ project: string; media: VideoMediaProvider } | null>(null);
  // Allocate inside the effect: StrictMode cleanup/setup must get a fresh, live provider.
  useEffect(() => {
    if (!previewOn) { setMediaLease(null); return undefined; }
    const media = createStudioMedia(project, assetsRef.current ?? {});
    setMediaLease({ project, media });
    return () => media.dispose();
  }, [project, previewOn]);
  const previewMedia = previewOn && mediaLease?.project === project ? mediaLease.media : null;
  const appliedAssets = useRef<Readonly<Record<string, VideoAsset>> | undefined>(undefined);
  if (previewMedia && assets && appliedAssets.current !== assets) {
    // 같은 판의 그리기가 새 소재를 보도록 그리기 전에 맞춘다(같은 값이면 아무 일 없다 — 되풀이해도 안전하다).
    appliedAssets.current = assets;
    previewMedia.setAssets(assets);
  }

  /**
   * §5.13 (X) 39-6 — 미리보기 그리기 판은 같은 문서·같은 소재 공급자인 동안 하나를 쓴다(프레임마다 문서 크기 캔버스를 만들면 1080×1920 기준 약 8MB씩 쓰레기가 쌓인다).
   * 그리기는 줄을 세운다 — 스틸·검수 표본도 같은 판을 쓰므로 두 요청이 한 캔버스에 섞여 그려지지 않게.
   */
  const previewBackend = useRef<{ doc: VideoDoc; timeline: ResolvedTimeline; media: MediaProvider; backend: Canvas2DBackend } | null>(null);
  const previewScope = useMemo(() => ({ active: true, queue: Promise.resolve() }), [doc, previewMedia]);
  useEffect(() => {
    previewScope.active = true;
    return () => {
      previewScope.active = false;
      previewBackend.current?.backend.dispose();
      previewBackend.current = null;
    };
  }, [previewScope]);

  const drawPreview = useCallback(
    (canvas: HTMLCanvasElement, t: number): Promise<void> => {
      const run = previewScope.queue.then(async () => {
        if (!previewScope.active || !doc || !timeline || !previewMedia) return;
        // 미리보기는 늘 canvas2d 로 그린다 — 창 안에서 즉시 반응해야 하고, 실험 API 가 흔들려도 편집 화면만은 멈추면 안 된다.
        // 보이는 캔버스에 바로 그리지 않는다 — 백엔드가 먼저 검게 지운 뒤 디코딩을 기다려 재생 중 검은 화면이 끼어 깜빡인다. 화면 밖에서 다 그린 뒤 한 번에 옮긴다.
        let held = previewBackend.current;
        if (!held || held.doc !== doc || held.timeline !== timeline || held.media !== previewMedia) {
          held?.backend.dispose();
          const backend = new Canvas2DBackend({ doc, timeline, media: previewMedia, scenes: withBuiltinScenes(), prewarmFootage: true });
          await backend.init({ width: doc.size.width, height: doc.size.height });
          if (!previewScope.active) { backend.dispose(); return; }
          held = { doc, timeline, media: previewMedia, backend };
          previewBackend.current = held;
        }
        await held.backend.drawFrame(t);
        if (!previewScope.active) return;
        const frame = held.backend.canvas;
        const ctx = canvas.getContext('2d');
        if (frame && ctx) ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
      });
      previewScope.queue = run.catch(() => undefined);
      return run;
    },
    [doc, timeline, previewMedia, previewScope],
  );

  const render = useCallback(
    async (opts: RenderCallOptions): Promise<RenderOutcome> => {
      if (!doc || !timeline) throw new Error(i18n.t('panel.videoStudio.errNoDoc'));
      const transparent = opts.transparent === true;
      const range = opts.range ?? null;

      const warnings: string[] = [];
      // 소리를 먼저 섞는다 — 프레임과 달리 구간 단위라 렌더 루프 밖에서 한 번에 만든다. 쓰는 구간의 조각만 푼다(40-2 ②).
      // §5.13 (AA) 42-3·42-4 — 내보내기 음소거면 섞지 않는다(소리 트랙 없는 영상) · 구간 렌더면 그 구간만(0 표본 = 구간 시작).
      let audio: AudioBuffer | null = null;
      if (opts.audio !== false || opts.audioOnly === true) {
        const audioMedia = createStudioMedia(project, doc.assets);
        try {
          audio = await mixAudio({
            doc,
            timeline,
            loader: studioAudioLoader(project, audioMedia),
            onWarn: (m) => warnings.push(m),
            ...(range ? { range } : {}),
            ...(opts.signal ? { signal: opts.signal } : {}),
          });
        } finally {
          audioMedia.dispose();
        }
      }

      // §5.13 (AA) 42-1 — 소리만(WAV 그릇 — 프레임을 그리지 않는다).
      if (opts.audioOnly === true) {
        const mixed = audio;
        if (!mixed) throw new Error(i18n.t('panel.videoStudio.export.noSoundToExport'));
        const channels = Array.from({ length: mixed.numberOfChannels }, (_, i) => mixed.getChannelData(i));
        return { bytes: encodeWav(channels, mixed.sampleRate), selection: null, hasAudio: true, warnings, container: 'wav' };
      }

      const made = await makeBackend(doc, transparent);
      if (!made) throw new Error(i18n.t('panel.videoStudio.errNoRenderBackend'));

      const result = await renderDoc({
        doc,
        timeline,
        backend: made.backend,
        audio,
        ...(transparent ? { alpha: true } : {}),
        ...(opts.container ? { container: opts.container } : {}),
        ...(opts.quality ? { quality: { video: opts.quality, audio: opts.quality } } : {}),
        ...(opts.scale !== undefined && opts.scale !== 1 ? { outputSize: scaledSize(doc.size, opts.scale) } : {}),
        ...(opts.fps ? { fps: opts.fps } : {}),
        ...(range ? { range } : {}),
        ...(opts.gate ? { gate: opts.gate } : {}),
        ...(opts.onProgress === undefined ? {} : { onProgress: opts.onProgress }),
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      });

      // §5.13 (W) 38-1 — 창을 문서 크기로 못 키운 기기면 찍힌 해상도가 모자란다 — 조용히 흐려지지 않게 알린다.
      const ratio = (made.backend as { captureRatio?: () => number }).captureRatio?.() ?? 1;
      if (ratio < CAPTURE_RATIO_WARN) warnings.push(i18n.t('panel.videoStudio.lowResolution', { percent: Math.round(ratio * 100) }));

      return { bytes: result.bytes, selection: made.selection, hasAudio: audio !== null, warnings, container: result.container };
    },
    [doc, timeline, project, makeBackend],
  );

  const stills = useCallback(
    async (times: readonly number[], maxEdge?: number, onFrame?: (index: number) => void, imageType: 'png' | 'webp' = 'png'): Promise<string[]> => {
      if (!doc || !timeline) throw new Error(i18n.t('panel.videoStudio.errNoDoc'));
      const last = Math.max(0, timeline.duration - 1e-6);
      const clamp = (t: number): number => Math.max(0, Math.min(Number.isFinite(t) ? t : 0, last));
      const out: string[] = [];

      if (docHasCompositions(doc)) {
        // §5.13 (T-4) — 컴포지션은 canvas2d 로 그릴 수 없다. **최종 렌더와 같은 경로**(오프스크린 창의 DOM 무대)로 찍는다.
        //   세션 하나를 열어 시각을 앞에서부터 차례로 맞춘다 — 순방향 전용 컴포지션도 처음부터 한 번만 흐른다.
        const backend = new OffscreenCaptureBackend({ bridge: makeOffscreenBridge(project, doc.id, undefined, { revId, frame: frameChapter }), url: '' });
        const probe = await backend.probe();
        if (!probe.available) throw new Error(probe.reason ?? i18n.t('panel.videoStudio.errNoRenderBackend'));
        await backend.init({ width: doc.size.width, height: doc.size.height });
        try {
          const order = times.map((t, i) => ({ t: clamp(t), i })).sort((a, b) => a.t - b.t);
          const byIndex = new Array<string>(times.length);
          let done = 0;
          for (const { t, i } of order) {
            await backend.drawFrame(t);
            const canvas = backend.canvas;
            if (!canvas) throw new Error(i18n.t('panel.videoStudio.errNoRenderBackend'));
            byIndex[i] = canvasToPng(canvas, maxEdge, imageType);
            done += 1;
            onFrame?.(done);
          }
          for (const image of byIndex) out.push(image ?? '');
        } finally {
          backend.dispose();
        }
        return out;
      }

      // 컴포지션이 없으면 미리보기와 같은 canvas2d 가 가장 빠르고 같은 그림이다.
      const canvas = document.createElement('canvas');
      canvas.width = doc.size.width;
      canvas.height = doc.size.height;
      let done = 0;
      for (const t of times) {
        await drawPreview(canvas, clamp(t));
        out.push(canvasToPng(canvas, maxEdge, imageType));
        done += 1;
        onFrame?.(done);
      }
      return out;
    },
    [doc, timeline, drawPreview, project, revId, frameChapter],
  );

  const still = useCallback(
    async (t: number, maxEdge?: number): Promise<string> => {
      const [image] = await stills([t], maxEdge);
      if (!image) throw new Error(i18n.t('panel.videoStudio.errNoDoc'));
      return image;
    },
    [stills],
  );

  const review = useCallback(async () => {
    if (!doc || !timeline) return { findings: [] };

    // 소리까지 함께 봐야 "말은 나오는데 무음" 같은 문제를 잡는다.
    const media = createStudioMedia(project, doc.assets, { decoderPreference: 'prefer-software' });
    const audio = await mixAudio({ doc, timeline, loader: studioAudioLoader(project, media) }).catch(() => null);
    const backend = new Canvas2DBackend({ doc, timeline, media, scenes: withBuiltinScenes() });
    const result = await autoReview({
      doc,
      timeline,
      backend,
      ...(audio === null ? {} : { audioLevelAt: (t: number) => audioLevelAt(audio, t) }),
    });
    media.dispose();
    return { findings: result.findings };
  }, [doc, timeline, project]);

  const probeFrames = useCallback(
    async (times: readonly number[]): Promise<FrameProbe[]> => {
      if (!doc || !timeline) throw new Error(i18n.t('panel.videoStudio.errNoDoc'));
      const W = doc.size.width;
      const H = doc.size.height;
      const last = Math.max(0, timeline.duration - 1e-6);
      const order = [...times].map((t) => Math.max(0, Math.min(Number.isFinite(t) ? t : 0, last))).sort((a, b) => a - b);
      const out: FrameProbe[] = [];
      const measure = (image: ImageData, t: number, extra: readonly ProbeText[]): FrameProbe => {
        const stats = computeFrameStats(image.data);
        const texts: ProbeText[] = [...docTextBoxesAt(doc, timeline, t), ...extra].map((box) => {
          const bg = backgroundLuminance(image, box.rect);
          return bg === undefined ? box : { ...box, bgLuminance: bg };
        });
        return { t, texts, flat: stats.stdLuma < FLAT_STD && stats.variedRatio < FLAT_VARIED };
      };
      if (docHasCompositions(doc)) {
        // 컴포지션은 최종 렌더와 같은 오프스크린 무대로 찍고, 그 무대에 컴포지션 안 글자 상자를 읽기 전용으로 묻는다.
        const backend = new OffscreenCaptureBackend({ bridge: makeOffscreenBridge(project, doc.id, undefined, { revId, frame: frameChapter }), url: '' });
        const probe = await backend.probe();
        if (!probe.available) throw new Error(probe.reason ?? i18n.t('panel.videoStudio.errNoRenderBackend'));
        await backend.init({ width: W, height: H });
        try {
          for (const t of order) {
            await backend.drawFrame(t);
            const ctx = backend.canvas?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
            if (!ctx) throw new Error(i18n.t('panel.videoStudio.errNoRenderBackend'));
            const inner = (await backend.inspectTexts()).map((x): ProbeText => ({ itemId: x.itemId, text: x.text, rect: x.rect, color: x.color, fontSize: x.fontSize }));
            out.push(measure(ctx.getImageData(0, 0, W, H), t, inner));
          }
        } finally {
          backend.dispose();
        }
        return out;
      }
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error(i18n.t('panel.videoStudio.errNoRenderBackend'));
      for (const t of order) {
        await drawPreview(canvas, t);
        out.push(measure(ctx.getImageData(0, 0, W, H), t, []));
      }
      return out;
    },
    [doc, timeline, drawPreview, project, revId, frameChapter],
  );

  const collectCues = useCallback(
    async (assetId: string): Promise<{ cues: CompositionCue[]; errors: CueScanError[] }> => {
      if (!doc) throw new Error(i18n.t('panel.videoStudio.errNoDoc'));
      const asset = doc.assets[assetId];
      if (!asset || asset.kind !== 'composition') throw new Error(i18n.t('panel.videoStudio.cueNoComposition', { id: assetId }));
      // 그 소재를 쓰는 첫 아이템의 값(props)으로 연다 — 값에 따라 표지 시각이 달라지는 코드도 문서에 놓인 그대로 잰다.
      const placed = (timeline?.items ?? []).filter((r) => r.item.kind === 'composition' && r.item.assetId === assetId);
      const first = placed[0];
      const spans = placed.map((r) => r.end - r.start + (r.item.trimStart ?? 0));
      const length = cueScanLength(asset.duration, spans, CUE_SCAN_FALLBACK_S);
      const responsiveBox = asset.responsive === true ? { width: doc.size.width, height: doc.size.height } : null;
      const src = compositionAssetSrc(project, doc, asset, first?.id ?? '', responsiveBox);
      if (!src) throw new Error(i18n.t('panel.videoStudio.cueNoComposition', { id: assetId }));

      const cues: CompositionCue[] = [];
      const errors: CueScanError[] = [];
      const frame = new CompositionFrame({
        src,
        width: responsiveBox ? responsiveBox.width : asset.width ?? doc.size.width,
        height: responsiveBox ? responsiveBox.height : asset.height ?? doc.size.height,
        label: first?.item.label ?? assetId,
        onEvent: (event) => {
          // 상한은 서버가 다시 자르지만(`settleCues`), 걸음마다 던지는 코드가 보고 한 통을 수 MB 로 부풀리지 않게 여기서도 막는다.
          if (event.kind === 'cue') { if (cues.length < CUE_COLLECT_MAX) cues.push({ name: event.name, t: event.t }); }
          else if (event.kind === 'error' && errors.length < CUE_ERRORS_MAX) {
            errors.push(event.t === undefined ? { message: event.message.slice(0, 400) } : { t: event.t, message: event.message.slice(0, 400) });
          }
        },
      });
      // 보이는 자리(창 왼쪽 위)에 투명하게 세운다 — 화면 밖 교차 출처 프레임은 브라우저가 늦게 돌린다(무대와 같은 이유).
      const host = document.createElement('div');
      host.setAttribute('aria-hidden', 'true');
      host.className = 'pointer-events-none fixed left-0 top-0 h-[180px] w-[320px] overflow-hidden opacity-0';
      host.appendChild(frame.element);
      document.body.appendChild(host);
      frame.layout(320, 180);
      try {
        const step = 1 / Math.max(1, doc.fps);
        const finished = await frame.scan(length, step, Math.max(10_000, CUES_TIMEOUT_MS - 20_000));
        if (!finished) errors.push({ message: i18n.t('panel.videoStudio.cueScanTimeout', { seconds: Math.round(length) }) });
      } finally {
        frame.dispose();
        host.remove();
      }
      return { cues, errors };
    },
    [doc, timeline, project],
  );

  return {
    drawPreview,
    render,
    still,
    stills,
    review,
    probeFrames,
    collectCues,
    lastSelection: () => selectionRef.current,
    media: previewMedia,
  };
}
