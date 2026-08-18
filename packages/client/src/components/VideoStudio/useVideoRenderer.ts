/**
 * §5.13 Vibistudio — 렌더 글루.
 *
 * 순수 층(`@vibisual/video`)과 브라우저 렌더 층(`@vibisual/video/render`)을 화면에
 * 붙인다. 화면 컴포넌트가 백엔드 선택이나 인코더를 직접 알지 않게 여기서 한 번만
 * 조립한다 — 미리보기와 스틸과 최종 렌더가 **같은 경로로 그려야** 미리보기와 결과가
 * 어긋나지 않기 때문이다.
 *
 * 백엔드 세 종이 모두 여기서 후보로 선다. 못 쓰는 것은 탐지 단계에서 이유와 함께
 * 걸러지고, 내려갔다는 사실은 호출부가 화면에 알린다(조용히 느려지지 않게).
 */

import { useCallback, useMemo, useRef } from 'react';
import { resolveTimeline, type VideoAsset, type VideoDoc } from '@vibisual/video';
import {
  Canvas2DBackend,
  HtmlInCanvasBackend,
  HtmlSceneStage,
  MediabunnyMediaProvider,
  OffscreenCaptureBackend,
  audioLevelAt,
  autoReview,
  mixAudio,
  renderDoc,
  selectRenderBackend,
  withBuiltinScenes,
  type AssetBytesLoader,
  type BackendProbe,
  type BackendSelection,
  type OffscreenCaptureBridge,
  type RenderBackend,
  type RenderProgress,
} from '@vibisual/video/render';

import { assetUrl } from './videoApi.js';

export interface RenderOutcome {
  readonly bytes: Uint8Array;
  readonly selection: BackendSelection | null;
  /** 소리를 실제로 실었는가. 무음으로 나갔다면 호출부가 알려야 한다. */
  readonly hasAudio: boolean;
  readonly warnings: readonly string[];
}

export interface RendererHandle {
  drawPreview: (canvas: HTMLCanvasElement, t: number) => Promise<void>;
  render: (opts: { onProgress?: (p: RenderProgress) => void; signal?: AbortSignal }) => Promise<RenderOutcome>;
  still: (t: number) => Promise<string>;
  review: () => Promise<{ findings: readonly { code: string; level: string; message: string }[] }>;
  lastSelection: () => BackendSelection | null;
}

/** 프로젝트 안의 파일을 주소로 바꿔 주는 로더. 경로 검사는 서버가 한다. */
function assetPath(asset: VideoAsset): string {
  const source = asset.source;
  // 외부 명령으로 만드는 소재는 **결과 파일이 이미 있을 때만** 읽는다. 여기서 명령을
  // 실행하지 않는다(§5.13 (H) — 앱은 소재를 만들지 않는다).
  return source.kind === 'file' ? source.path : source.output;
}

function makeLoader(project: string): AssetBytesLoader {
  return {
    async open(asset: VideoAsset): Promise<Blob | string | null> {
      return assetUrl(project, assetPath(asset));
    },
  };
}

function makeAudioLoader(project: string): { fetchBytes: (asset: VideoAsset) => Promise<ArrayBuffer | null> } {
  return {
    async fetchBytes(asset: VideoAsset): Promise<ArrayBuffer | null> {
      const res = await fetch(assetUrl(project, assetPath(asset)));
      if (!res.ok) return null;
      return res.arrayBuffer();
    },
  };
}

/**
 * main 프로세스의 오프스크린 창을 조종하는 다리.
 *
 * 앱 전용 채널을 쓰지 않는다 — 코어가 여는 통로는 `app.invoke(appId, action, payload)`
 * 하나뿐이고, 뜻은 이 앱과 `main/apps/vibistudio.ts` 만 안다(§5.13 (O)).
 */
function makeOffscreenBridge(project: string, docId: string): OffscreenCaptureBridge {
  const api = window.api?.app;
  const call = async <T,>(action: string, payload?: unknown): Promise<T> =>
    (await api!.invoke('vibistudio', action, payload)) as T;
  return {
    async probe() {
      if (!api) return { available: false, reason: '이 실행 형태에서는 오프스크린 창을 쓸 수 없습니다.' };
      try {
        return await call<{ available: boolean; reason?: string }>('offscreen:probe');
      } catch (err) {
        return { available: false, reason: String(err) };
      }
    },
    async open({ width, height }) {
      if (!api) throw new Error('오프스크린 다리가 없습니다.');
      await call<null>('offscreen:open', { width, height, project, docId });
    },
    async captureAt(t) {
      if (!api) throw new Error('오프스크린 다리가 없습니다.');
      return call<ArrayBuffer>('offscreen:capture', { t });
    },
    async close() {
      if (api) await call<null>('offscreen:close');
    },
  };
}

export function useVideoRenderer(project: string, doc: VideoDoc | null): RendererHandle {
  const selectionRef = useRef<BackendSelection | null>(null);
  const timeline = useMemo(() => (doc ? resolveTimeline(doc) : null), [doc]);

  /** 이 기기에서 쓸 수 있는 백엔드를 골라 하나 만든다(세 후보 전부 탐지). */
  const makeBackend = useCallback(
    async (d: VideoDoc): Promise<{ backend: RenderBackend; selection: BackendSelection } | null> => {
      const media = new MediabunnyMediaProvider({ assets: d.assets, loader: makeLoader(project) });
      const resolved = resolveTimeline(d);

      // html-in-canvas 는 그릴 DOM 이 있어야 의미가 있다 — 실제 무대를 세워 준다.
      const stage = new HtmlSceneStage({ doc: d, timeline: resolved, media });

      const candidates: RenderBackend[] = [
        new HtmlInCanvasBackend({ stage }),
        new OffscreenCaptureBackend({ bridge: makeOffscreenBridge(project, d.id), url: '' }),
        new Canvas2DBackend({ doc: d, timeline: resolved, media, scenes: withBuiltinScenes() }),
      ];

      const probes: BackendProbe[] = [];
      for (const b of candidates) probes.push(await b.probe());

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
    [project],
  );

  const drawPreview = useCallback(
    async (canvas: HTMLCanvasElement, t: number): Promise<void> => {
      if (!doc || !timeline) return;
      // 미리보기는 늘 canvas2d 로 그린다 — 창 안에서 즉시 반응해야 하고, 실험 API 가
      // 흔들려도 편집 화면만은 멈추면 안 된다.
      const media = new MediabunnyMediaProvider({ assets: doc.assets, loader: makeLoader(project) });
      const backend = new Canvas2DBackend({
        doc,
        timeline,
        media,
        scenes: withBuiltinScenes(),
        createCanvas: () => canvas,
      });
      await backend.init({ width: doc.size.width, height: doc.size.height });
      await backend.drawFrame(t);
      media.dispose();
    },
    [doc, timeline, project],
  );

  const render = useCallback(
    async (opts: { onProgress?: (p: RenderProgress) => void; signal?: AbortSignal }): Promise<RenderOutcome> => {
      if (!doc || !timeline) throw new Error('문서가 없습니다.');

      const warnings: string[] = [];
      // 소리를 먼저 섞는다 — 프레임과 달리 구간 단위라 렌더 루프 밖에서 한 번에 만든다.
      const audio = await mixAudio({
        doc,
        timeline,
        loader: makeAudioLoader(project),
        onWarn: (m) => warnings.push(m),
      });

      const made = await makeBackend(doc);
      if (!made) throw new Error('이 기기에서 쓸 수 있는 렌더 방식이 없습니다.');

      const result = await renderDoc({
        doc,
        timeline,
        backend: made.backend,
        audio,
        ...(opts.onProgress === undefined ? {} : { onProgress: opts.onProgress }),
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      });

      return { bytes: result.bytes, selection: made.selection, hasAudio: audio !== null, warnings };
    },
    [doc, timeline, project, makeBackend],
  );

  const still = useCallback(
    async (t: number): Promise<string> => {
      if (!doc || !timeline) throw new Error('문서가 없습니다.');
      const canvas = document.createElement('canvas');
      canvas.width = doc.size.width;
      canvas.height = doc.size.height;
      await drawPreview(canvas, t);
      return canvas.toDataURL('image/png');
    },
    [doc, timeline, drawPreview],
  );

  const review = useCallback(async () => {
    if (!doc || !timeline) return { findings: [] };

    // 소리까지 함께 봐야 "말은 나오는데 무음" 같은 문제를 잡는다.
    const audio = await mixAudio({ doc, timeline, loader: makeAudioLoader(project) }).catch(() => null);

    const media = new MediabunnyMediaProvider({ assets: doc.assets, loader: makeLoader(project) });
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

  return {
    drawPreview,
    render,
    still,
    review,
    lastSelection: () => selectionRef.current,
  };
}
