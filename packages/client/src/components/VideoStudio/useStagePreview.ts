import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  resolveTimeline,
  type VideoDoc,
} from '@vibisual/video';
import { HtmlSceneStage, STAGE_WARM_LONG_FRAMES, adaptWarm, type CompositionFrameEvent, type MediaProvider, type StagePick, type StageText } from '@vibisual/video/render';

import { makeCompositionSrc } from './compositionUrl.js';
import { createPreviewQueue } from './previewQueue.js';
import { previewWarmPolicy } from './previewPolicy.js';
import type { PlaybackTiming } from './useStudioPlayback.js';

/**
 * §5.13 (T-4)(T-7) — 코드 컴포지션이 든 문서의 **미리보기 = 같은 DOM 무대를 줄여 띄운 것**.
 *
 * 미리보기는 즉시성 때문에 canvas2d 로 그려 왔지만 canvas2d 는 HTML 을 그릴 수 없다. 그래서 컴포지션이 있으면 렌더 무대와
 * 같은 `HtmlSceneStage`(샌드박스 iframe 포함)를 미리보기 칸 안에 세우고 칸 크기에 맞춰 줄인다 — 사람이 보는 것과 일꾼이
 * 찍는 것이 같은 무대다. 문서가 바뀔 때마다 무대를 새로 세우지 않는다(`setDoc` — 같은 코드·같은 데이터의 프레임은 그대로).
 *
 * 컴포지션은 **보이는 자리**에 있어야 한다 — 화면 밖의 교차 출처 프레임은 브라우저가 그리기를 멈춘다(무대 머리말 ⚠).
 *
 * §5.13 (X) 39-5 — 미리보기 무대는 **데운다**(다가오는 장면을 미리 열고 지나간 장면을 잠시 보관 — 장면이 넘어갈 때 새 문서를
 * 처음부터 불러오며 멈추지 않게). 39-3 — 무대를 새로 세우면 첫 그림이 서기 전까지 `ready` 가 false 다(그동안 화면은 포스터를 띄운다).
 */
export interface StagePreview {
  /** t 초의 모습으로 맞춘다. 도는 동안 들어온 요청은 마지막 하나만 남겼다가 그린다(앞뒤로 튀지 않게). */
  readonly seek: (t: number) => Promise<boolean>;
  /**
   * §5.13 (V) 37-6 — 문서 픽셀 (x, y) 아래 맨 위의 것. 컴포지션이면 샌드박스에 읽기 전용으로 그 자리 요소를 묻는다(1.5초 상한 —
   * 답이 없으면 아이템 단위). 무대가 없으면 null.
   */
  readonly pickAt: (x: number, y: number) => Promise<StagePick | null>;
  /** §5.13 (V) 37-9 — 지금 시각에 컴포지션들 안에서 보이는 글자 상자(문서 픽셀). */
  readonly inspectTexts: () => Promise<StageText[]>;
  /** §5.13 (X) 39-3 — 지금 무대의 첫 그림이 섰는가(새로 세운 직후·무대가 없으면 false). */
  readonly ready: boolean;
  /** §5.13 (Y) 40-9 — 마지막으로 맞춘 시각(없으면 null) · 맞추는 중인가(재생 시계의 버퍼 판정). */
  readonly drawnAt: () => number | null;
  readonly busy: () => boolean;
  /**
   * §5.13 (Z) 41-2 — 재생 박자를 무대에 맞춘다(시계가 갈 때마다 부른다). 재생 중이면 컴포지션의 스스로 재생 기준을 걸고, 그 직선과
   * 재생 시계가 반 프레임 넘게 어긋날 때만 새 기준을 보낸다. `null` 이면 재생을 끝내고 그 자리를 정확한 한 장으로 다시 맞춘다.
   */
  readonly syncPlay: (timing: PlaybackTiming | null) => void;
  /** §5.13 (Z) 41-5 ② — 재생 중 보여야 할 컴포지션이 아직 첫 그림을 못 냈는가(그동안 화면이 가벼운 판을 깐다). */
  readonly cold: boolean;
}

/** §5.13 (Z) 41-6 — 흘려 트는 재생의 계측 손잡이(셸이 넘긴다 — 이 훅은 계측 모듈을 직접 부르지 않는다). */
export interface StagePreviewPerf {
  readonly cold?: (cold: boolean) => void;
  readonly plan?: () => void;
  readonly reanchor?: () => void;
}

/** §5.13 (Z) 41-2 — 보낸 기준과 재생 시계가 이만큼(프레임) 넘게 어긋나면 새 기준을 보낸다. */
const REANCHOR_FRAMES = 0.5;

/** §5.13 (Y) 40-8 ⑤ — 긴 프레임을 세는 창(ms)과 그 문턱(ms). */
const LONG_FRAME_WINDOW_MS = 3_000;
const LONG_FRAME_MS = 50;

export function useStagePreview(opts: {
  readonly enabled: boolean;
  readonly project: string;
  readonly doc: VideoDoc | null;
  readonly media: MediaProvider | null | undefined;
  readonly host: RefObject<HTMLDivElement>;
  readonly onEvent?: (itemId: string, event: CompositionFrameEvent) => void;
  /** §5.13 (Z) 41-6 — 계측(켜져 있을 때만 센다 — 셸이 `studioPerf` 를 넘긴다). */
  readonly perf?: StagePreviewPerf;
}): StagePreview {
  const { enabled, project, doc, media, host } = opts;
  const stageRef = useRef<HtmlSceneStage | null>(null);
  const appliedDoc = useRef<VideoDoc | null>(null);
  const onEventRef = useRef(opts.onEvent);
  onEventRef.current = opts.onEvent;
  const perfRef = useRef(opts.perf);
  perfRef.current = opts.perf;
  const queueRef = useRef<ReturnType<typeof createPreviewQueue> | null>(null);
  /** 마지막으로 요청받은 시각 — 무대를 새로 세운 직후 그 자리를 바로 그린다. */
  const lastWanted = useRef(0);
  const documentKey = useRef('');
  const docRef = useRef(doc);
  docRef.current = doc;
  const [ready, setReady] = useState(false);
  const [cold, setCold] = useState(false);
  /** §5.13 (Z) 41-2 — 지금 무대에 걸린 재생 기준(재생이 아니면 null). 무대를 새로 세우면 비운다(다음 박자에 다시 건다). */
  const sentPlay = useRef<PlaybackTiming | null>(null);

  const seek = useCallback((t: number): Promise<boolean> => {
    lastWanted.current = t;
    return queueRef.current?.request(t).catch(() => false) ?? Promise.resolve(false);
  }, []);

  /** 무대를 칸에 맞춘다 — 가운데 두고 비율을 지켜 줄인다(레터박스). */
  const fit = useCallback((): void => {
    const stage = stageRef.current;
    const box = host.current;
    const current = docRef.current;
    if (!stage || !box || !current) return;
    const bw = box.clientWidth;
    const bh = box.clientHeight;
    const { width, height } = current.size;
    if (bw <= 0 || bh <= 0 || width <= 0 || height <= 0) return;
    const scale = Math.min(bw / width, bh / height);
    const left = (bw - width * scale) / 2;
    const top = (bh - height * scale) / 2;
    const el = stage.element;
    el.style.position = 'absolute';
    el.style.left = '0';
    el.style.top = '0';
    el.style.transformOrigin = '0 0';
    el.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
  }, [host]);

  const docId = doc?.id ?? '';
  // 무대는 문서(id)·소재 공급자·프로젝트가 바뀔 때만 새로 세운다.
  useEffect(() => {
    const box = host.current;
    const current = docRef.current;
    if (!enabled || !box || !current || !media) return;
    const key = `${project}\u0000${docId}`;
    if (documentKey.current !== key) { documentKey.current = key; lastWanted.current = 0; }
    setReady(false);
    sentPlay.current = null;
    const baseWarm = previewWarmPolicy();
    const stage = new HtmlSceneStage({
      doc: current,
      timeline: resolveTimeline(current),
      media,
      container: box,
      compositionSrc: makeCompositionSrc(project, current),
      onCompositionEvent: (itemId, event) => onEventRef.current?.(itemId, event),
      warm: baseWarm,
      preview: true,
      // §5.13 (Z) 41-5 ② · 41-6 — 첫 그림을 못 낸 장면 자리(가벼운 판) · 예약을 다시 짠 수(계측).
      onCold: (value) => { if (stageRef.current === stage) { setCold(value); perfRef.current?.cold?.(value); } },
      onPlan: () => perfRef.current?.plan?.(),
    });
    // §5.13 (Y) 40-8 ⑤ — 데우기 수는 기기 등급에서 시작해 실측 프레임 시간으로 조절한다(긴 프레임이 이어지면 줄이고, 조용하면 되돌린다).
    const longFrames: number[] = [];
    let observer: PerformanceObserver | null = null;
    let applied = 0;
    const adapt = (): void => {
      const now = performance.now();
      while (longFrames.length > 0 && now - longFrames[0]! > LONG_FRAME_WINDOW_MS) longFrames.shift();
      const level = longFrames.length >= STAGE_WARM_LONG_FRAMES ? longFrames.length : 0;
      if (level === applied) return;
      applied = level;
      stage.setWarm(adaptWarm(baseWarm, level));
    };
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (entry.duration > LONG_FRAME_MS) longFrames.push(entry.startTime + entry.duration);
        adapt();
      });
      observer.observe({ type: 'long-animation-frame', buffered: false } as PerformanceObserverInit);
    } catch { observer = null; }
    const quiet = setInterval(adapt, LONG_FRAME_WINDOW_MS);
    stageRef.current = stage;
    appliedDoc.current = current;
    const queue = createPreviewQueue(async (at) => {
      try { await stage.seek(at); }
      catch (error) {
        if (stageRef.current === stage) {
          onEventRef.current?.('', { kind: 'error', message: error instanceof Error ? error.message : String(error) });
        }
        throw error;
      }
    }, () => {
      if (stageRef.current === stage) setReady(true);
    });
    queueRef.current = queue;
    fit();
    void seek(lastWanted.current).catch(() => undefined);
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fit()) : null;
    resizeObserver?.observe(box);
    return () => {
      observer?.disconnect();
      resizeObserver?.disconnect();
      clearInterval(quiet);
      queue.dispose();
      if (queueRef.current === queue) queueRef.current = null;
      if (stageRef.current === stage) stageRef.current = null;
      stage.dispose();
      setReady(false);
      setCold(false);
      perfRef.current?.cold?.(false);
    };
    // 문서 내용이 바뀌는 것은 아래 효과가 `setDoc` 으로 받는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, docId, media, project, fit, host, seek]);

  useEffect(() => {
    if (!doc) return;
    const stage = stageRef.current;
    if (!stage) return;
    if (appliedDoc.current === doc) return;
    appliedDoc.current = doc;
    stage.setDoc(doc, resolveTimeline(doc));
    queueRef.current?.invalidate();
    fit();
    void seek(lastWanted.current).catch(() => undefined);
  }, [doc, fit, seek]);

  const pickAt = useCallback(async (x: number, y: number): Promise<StagePick | null> => {
    const stage = stageRef.current;
    if (!stage) return null;
    try { return await stage.pickAt(x, y); } catch { return null; }
  }, []);

  const inspectTexts = useCallback(async (): Promise<StageText[]> => {
    const stage = stageRef.current;
    if (!stage) return [];
    try { return await stage.inspectTexts(); } catch { return []; }
  }, []);

  const drawnAt = useCallback((): number | null => queueRef.current?.drawnAt() ?? null, []);
  const busy = useCallback((): boolean => queueRef.current?.busy() ?? false, []);

  const syncPlay = useCallback((timing: PlaybackTiming | null): void => {
    const stage = stageRef.current;
    if (!stage) { sentPlay.current = null; return; }
    if (!timing) {
      if (!stage.playing) return;
      sentPlay.current = null;
      stage.stopPlay();
      // 멈춘 자리를 정확한 한 장으로 — 시계가 그대로면 아무도 그리라고 하지 않는다(재생 중 그림은 스스로 재생이 그렸다).
      queueRef.current?.invalidate();
      void seek(lastWanted.current).catch(() => undefined);
      return;
    }
    const fps = docRef.current?.fps && docRef.current.fps > 0 ? docRef.current.fps : 30;
    const sent = sentPlay.current;
    if (sent && stage.playing) {
      const predicted = sent.t + (timing.perfMs - sent.perfMs) / 1000;
      if (Math.abs(predicted - timing.t) <= REANCHOR_FRAMES / fps) return;
      perfRef.current?.reanchor?.();
    }
    sentPlay.current = timing;
    stage.play({ t: timing.t, perfMs: timing.perfMs });
  }, [seek]);

  return { seek, pickAt, inspectTexts, ready, drawnAt, busy, syncPlay, cold };
}
