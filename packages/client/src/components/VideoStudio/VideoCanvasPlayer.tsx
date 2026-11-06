import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hitTest, resolveTimeline, type VideoDoc } from '@vibisual/video';

import { useInspectorPicker } from '../../hooks/useInspectorPicker.js';
import { previewInspectPicker } from './previewInspect.js';
import { previewHitOptions, previewInspectLevels } from './usePreviewInteraction.js';
import { createPreviewQueue } from './previewQueue.js';
import { docNeedsStage } from './previewPolicy.js';
import { previewFrameLag, usePreviewDrawLoop } from './previewDrawLoop.js';
import { retainStudioAudioMemory } from './studioMedia.js';
import { useStagePreview } from './useStagePreview.js';
import { useStudioPlayback } from './useStudioPlayback.js';
import { useVideoAudio } from './useVideoAudio.js';
import { useVideoRenderer } from './useVideoRenderer.js';
import { containRect } from './glanceView.js';
import type { PlayheadClock } from './playheadClock.js';

/**
 * §5.4 #36 (J) ⑦ — 캔버스 노드의 재생: 렌더 없이 지금 문서를 그 자리에서 튼다. 스튜디오 미리보기와 같은 부품(렌더러 · 재생 시계 ·
 * 소리 · DOM 무대 · 그리기 줄)을 읽기 전용으로 묶은 것이다 — 엔진 두 벌 ❌. 누를 때만 늦게 온다(동적 import).
 * 첫 그림이 서면 그 자리부터 튼다. 언마운트되면 각 부품이 자기 자원(소리 문맥 · 샌드박스 프레임 · 소재 주소 · RAF)을 돌려준다.
 * 판(그림·무대)은 누름을 받지 않는다 — 결과 칸 누름은 노드 선택이다((G) 불변). 렌더는 시키지 않는다((T-15)).
 */

export interface CanvasPlayerControl {
  readonly clock: PlayheadClock;
  readonly duration: number;
  readonly play: () => void;
  readonly pause: () => void;
  /** 그 시각으로. 재생 중이었으면 `resume` 에서 이어 튼다(끄는 동안은 멈춰 있다). */
  readonly seek: (t: number) => void;
  readonly resume: () => void;
}

export interface CanvasPlayerState {
  readonly playing: boolean;
  /** 첫 그림이 섰다(그 전엔 노드 포스터가 그대로 보인다). */
  readonly ready: boolean;
  /** 그림이 시계를 못 따라와 기다리는 중. */
  readonly preparing: boolean;
}

export interface VideoCanvasPlayerProps {
  readonly project: string;
  readonly doc: VideoDoc;
  /** 처음 틀 자리(초). */
  readonly startAt: number;
  readonly muted: boolean;
  /** 결과 칸 크기(캔버스 px) — 그림판을 이 크기에 맞춘다. */
  readonly width: number;
  readonly height: number;
  readonly onControl: (control: CanvasPlayerControl | null) => void;
  readonly onState: (state: CanvasPlayerState) => void;
  /** 끝까지 갔다 — 노드는 처음으로 돌아가 멈춘다(반복 ❌). */
  readonly onEnded: () => void;
  readonly onError: (message: string) => void;
}

/** 그림판 해상도를 이 단위(px)로 올려 잡는다 — 노드 크기를 바꿀 때마다 판을 새로 만들지 않게(`APP_THUMB.bakeStep` 과 같은 생각). */
const CANVAS_STEP = 64;

export function VideoCanvasPlayer(p: VideoCanvasPlayerProps): React.JSX.Element {
  const { project, doc } = p;
  const callbacks = useRef(p);
  callbacks.current = p;
  const report = useCallback((message: string): void => { if (message) callbacks.current.onError(message); }, []);
  const timeline = useMemo(() => resolveTimeline(doc), [doc]);
  const renderer = useVideoRenderer(project, doc);
  const audio = useVideoAudio(project, doc, { media: renderer.media, onError: report });
  const frameLag = useRef<(at: number) => number>(() => 0);
  const playback = useStudioPlayback(doc, {
    scope: project, onStart: audio.resume, audio, frameLag: (at) => frameLag.current(at), onError: (e) => report(String(e)),
  });
  const needsStage = useMemo(() => docNeedsStage(doc), [doc]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageHostRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const stage = useStagePreview({
    enabled: needsStage, project, doc, media: renderer.media, host: stageHostRef,
    onEvent: (_itemId, event) => { if (event.kind === 'error') report(event.message); },
  });

  // §5.13 (Y) 40-11 — 소리 조각 기억은 이 판이 살아 있는 동안만 붙든다(같은 창의 스튜디오가 쓰면 그쪽이 붙든다).
  useEffect(() => retainStudioAudioMemory(), []);
  useEffect(() => { audio.setOutput(p.muted, 1); }, [audio, p.muted]);

  const frame = containRect({ width: p.width, height: p.height }, doc.size);
  const ratio = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1);
  const canvasW = Math.min(doc.size.width, Math.max(CANVAS_STEP, Math.ceil((frame.width * ratio) / CANVAS_STEP) * CANVAS_STEP));
  const canvasH = Math.max(1, Math.round((canvasW * doc.size.height) / Math.max(1, doc.size.width)));

  const [canvasReady, setCanvasReady] = useState(false);
  const canvasQueue = useRef<ReturnType<typeof createPreviewQueue> | null>(null);
  const drawPreview = renderer.drawPreview;
  const previewMedia = renderer.media;
  useEffect(() => {
    if (needsStage) return undefined;
    setCanvasReady(false);
    const queue = createPreviewQueue(async (at) => {
      const canvas = canvasRef.current;
      if (!canvas || !previewMedia) return false;
      await drawPreview(canvas, at);
    }, () => setCanvasReady(true));
    canvasQueue.current = queue;
    return () => { queue.dispose(); if (canvasQueue.current === queue) canvasQueue.current = null; };
  }, [needsStage, drawPreview, previewMedia, canvasW, canvasH]);

  const stageSeek = stage.seek;
  const requestDraw = useCallback((at: number): Promise<boolean> => (
    needsStage ? stageSeek(at) : canvasQueue.current?.request(at) ?? Promise.resolve(false)
  ), [needsStage, stageSeek]);
  const stageDrawnAt = stage.drawnAt;
  const stageBusy = stage.busy;
  frameLag.current = (at: number): number => previewFrameLag(needsStage ? { drawnAt: stageDrawnAt, busy: stageBusy } : canvasQueue.current, at);
  const clock = playback.clock;
  const playingRef = useRef(playback.playing);
  playingRef.current = playback.playing;
  // 스튜디오 미리보기와 같은 그리기 고리 — 그림판 크기가 바뀌면(판을 다시 만들면 비워진다) 그 자리를 다시 그린다.
  usePreviewDrawLoop({
    enabled: true,
    clock,
    playing: playback.playing,
    stage: needsStage,
    syncPlay: stage.syncPlay,
    timing: playback.timing,
    requestDraw,
    media: previewMedia,
    onError: (error) => report(String(error)),
    redraw: [doc, canvasW, canvasH],
  });

  // 한 번 선 그림은 판본이 바뀌어 그리기 판을 다시 지어도 걷지 않는다(포스터로 깜빡이지 않게).
  const [shown, setShown] = useState(false);
  const readyNow = needsStage ? stage.ready : canvasReady;
  useEffect(() => { if (readyNow) setShown(true); }, [readyNow]);
  const ready = shown || readyNow;
  const { seek, setPlaying } = playback;
  // 처음 그릴 자리를 먼저 잡고(재생 시계의 초기화 뒤), 첫 그림이 서면 그 자리부터 튼다. `seek` 는 길이가 바뀌면 새로 생기므로
  //   의존성에 넣지 않는다 — 넣으면 AI 가 고칠 때마다 시작 자리로 되감긴다.
  const seekRef = useRef(seek);
  seekRef.current = seek;
  useEffect(() => { seekRef.current(Math.max(0, p.startAt)); }, [p.startAt]);
  const started = useRef(false);
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    setPlaying(true);
  }, [ready, setPlaying]);

  // 끝까지 갔다 — 재생 시계는 마지막 프레임에 멈춘다(반복 ❌). 노드가 처음으로 돌린다.
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (playback.playing) { wasPlaying.current = true; return; }
    const ended = wasPlaying.current && clock.get() >= playback.lastFrameAt - 1e-3;
    wasPlaying.current = false;
    if (ended) callbacks.current.onEnded();
  }, [playback.playing, playback.lastFrameAt, clock]);

  useEffect(() => {
    callbacks.current.onState({ playing: playback.playing, ready, preparing: playback.preparing });
  }, [playback.playing, playback.preparing, ready]);

  const resumeAfterSeek = useRef(false);
  useEffect(() => {
    const control: CanvasPlayerControl = {
      clock,
      duration: playback.duration,
      play: () => setPlaying(true),
      pause: () => setPlaying(false),
      seek: (t) => {
        if (playingRef.current) resumeAfterSeek.current = true;
        seek(t);
      },
      resume: () => {
        if (!resumeAfterSeek.current) return;
        resumeAfterSeek.current = false;
        setPlaying(true);
      },
    };
    callbacks.current.onControl(control);
    return () => callbacks.current.onControl(null);
  }, [clock, playback.duration, seek, setPlaying]);

  // §5.4 #15 (C) — Alt 인스펙터: 스튜디오 미리보기와 같은 판정(문서 기하 · 지금 시각)으로 그 아이템을 답한다.
  const picker = useMemo(() => previewInspectPicker(doc.size, (x, y) => {
    const hit = hitTest(doc, timeline, clock.get(), x, y, previewHitOptions(needsStage ? 'stage' : 'canvas'));
    return hit ? previewInspectLevels({ projectName: project, duration: timeline.duration, t: clock.get() }, doc, hit, null) : [];
  }), [doc, timeline, clock, needsStage, project]);
  useInspectorPicker(layerRef, picker);

  const frameStyle: React.CSSProperties = { left: frame.left, top: frame.top, width: frame.width, height: frame.height };
  return (
    <div className={`absolute inset-0 transition-opacity duration-150 ${ready ? 'opacity-100' : 'opacity-0'}`}>
      <div className="pointer-events-none absolute inset-0 bg-black [&_iframe]:pointer-events-none">
        {needsStage ? (
          <div ref={stageHostRef} className="absolute inset-0 overflow-hidden" />
        ) : (
          <canvas ref={canvasRef} width={canvasW} height={canvasH} className="absolute" style={frameStyle} />
        )}
      </div>
      {/* 집기 판 — 누름은 그대로 노드로 올라간다(선택·끌기·더블클릭 열기). */}
      <div ref={layerRef} className="absolute" style={frameStyle} />
    </div>
  );
}
