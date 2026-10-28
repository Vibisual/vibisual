import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveTimeline, type VideoDoc } from '@vibisual/video';

import { createPlayheadClock, type PlayheadClock } from './playheadClock.js';
import { setStudioBusy } from './studioIdle.js';
import { notePlayMove, notePlayPress } from './studioPerf.js';

/**
 * §5.13 (V) 37-1 — 미리보기 재생 머리·재생·반복. 끝에 닿으면 마지막 프레임에 멈춘다. AI 가 몇 초마다 고치므로 다른 문서로 갈아탈 때만 멈추고, 같은 문서의 판본이 바뀌면 재생 머리만 새 길이 안으로 당긴다.
 * §5.13 (X) 39-6 — 재생 머리는 두 벌: 시계(`clock`)는 프레임마다 가고 미리보기 그림·선·시간 글자가 구독한다. 상태(`playhead`)는 멈출 때·옮길 때만 바뀐다(재생 중 갱신은 스튜디오 전체를 다시 그린다) — 재생 중 시각은 그 순간 `clock.get()` 으로 읽는다.
 * §5.13 (Y) 40-9 — 시계는 소리가 주인: `audio.now()` 가 수를 내면 그 시각을 따르고, 아직이면 벽시계로 출발했다가 붙는 순간 넘긴다(튀지 않는다). 어긋났다고 소리를 다시 틀지 않는다.
 * §5.13 (Y) 40-10 ① — 재생은 누르는 순간 움직인다. `frameLag` 가 `PLAYBACK_BUFFER_LAG_S` 를 넘으면 시계를 잠깐 세우고 소리도 쉰다.
 * 기다림 표시(`preparing`)는 `PLAYBACK_BUFFER_SHOW_MS` 뒤에 보이고 보이면 `PLAYBACK_BUFFER_MIN_MS` 는 머문다(1초 미만 대기에 번쩍이지 않게).
 */
export interface StudioPlayback {
  /** 멈춰 있을 때의 재생 머리(재생 중에는 시작한 자리 — 지금 시각은 `clock`). */
  readonly playhead: number;
  /** 프레임마다 가는 재생 머리(구독용). */
  readonly clock: PlayheadClock;
  readonly playing: boolean;
  /** 기다림 표시(버퍼 상태가 `PLAYBACK_BUFFER_SHOW_MS` 넘게 이어질 때만 — 최소 `PLAYBACK_BUFFER_MIN_MS`). */
  readonly preparing: boolean;
  readonly loop: boolean;
  readonly duration: number;
  readonly fps: number;
  readonly lastFrameAt: number;
  readonly seek: (at: number) => void;
  readonly setPlaying: (playing: boolean) => void;
  readonly togglePlay: () => void;
  readonly toggleLoop: () => void;
  /**
   * §5.13 (Z) 41-2 — 재생 중이면 마지막 박자의 **이어진** 시각(프레임 격자로 접기 전 — 초)과 그때의 `performance.now()`. 무대가
   * 컴포지션의 스스로 재생 기준으로 쓴다(이 직선과 반 프레임 넘게 어긋날 때만 다시 보낸다). 멈춰 있으면 null.
   */
  readonly timing: () => PlaybackTiming | null;
}

/** §5.13 (Z) 41-2 — 재생 시계의 한 박자(이어진 시각 · 그때의 performance.now()). */
export interface PlaybackTiming {
  readonly t: number;
  readonly perfMs: number;
}

/** 재생이 기대는 소리(없으면 벽시계만). */
export interface PlaybackAudio {
  /** 그 시각부터 튼다 — 소리는 준비되는 대로 그 시각에 맞춰 붙는다(기다리지 않는다). */
  readonly play: (at: number, loop: boolean, duration: number) => void;
  readonly stop: () => void;
  /** 소리가 붙어 있으면 지금 귀에 들리는 재생 시각(초), 아니면 null. */
  readonly now: () => number | null;
  /** 버퍼 상태 — 그림이 못 따라오는 동안 소리도 쉰다. */
  readonly hold: (on: boolean) => void;
}

export interface PlaybackPreparation {
  /** 사용자 몸짓 안에서 부른다(소리 잠금 해제는 그 안이어야 한다). */
  readonly onStart?: () => void;
  readonly audio?: PlaybackAudio;
  /** 그린 시각이 시계보다 얼마나 뒤인가(초 — 그리는 중이 아니면 0). 넘으면 버퍼 상태. */
  readonly frameLag?: (at: number) => number;
  readonly onError?: (error: unknown) => void;
  readonly scope?: string;
}

/** 그림이 이만큼(초) 넘게 뒤처지면 시계를 세운다. */
export const PLAYBACK_BUFFER_LAG_S = 0.3;
/** 기다림이 이만큼(ms) 이어져야 표시한다. */
export const PLAYBACK_BUFFER_SHOW_MS = 500;
/** 한 번 보인 기다림 표시는 이만큼(ms) 머문다. */
export const PLAYBACK_BUFFER_MIN_MS = 200;
/** 소리가 붙는 순간 벽시계와 소리 시각의 차(출력 지연만큼)를 이 시간(ms)에 걸쳐 녹인다 — 한 프레임 뒤로 튀지 않게. */
export const PLAYBACK_AUDIO_SLEW_MS = 250;

export function useStudioPlayback(doc: VideoDoc | null, preparation: PlaybackPreparation = {}): StudioPlayback {
  const [playhead, setPlayheadState] = useState(0);
  const [playing, setPlayingState] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [loop, setLoop] = useState(false);
  const clock = useMemo(() => createPlayheadClock(0), []);
  const duration = useMemo(() => (doc ? resolveTimeline(doc).duration : 0), [doc]);
  const fps = doc?.fps && doc.fps > 0 ? doc.fps : 30;
  const lastFrameAt = doc ? Math.max(0, duration - 1 / fps) : 0;
  const docId = doc?.id ?? '';
  const scope = preparation.scope ?? '';
  const callbacks = useRef(preparation);
  callbacks.current = preparation;
  /** §5.13 (Z) 41-2 — 마지막 박자의 이어진 시각(재생 중에만). */
  const timingRef = useRef<PlaybackTiming | null>(null);
  // 효과·손잡이가 지금 값을 읽는 자리(갱신 함수 안에서 다른 상태를 바꾸지 않으려고).
  const now = useRef({ playing, duration, lastFrameAt, loop });
  now.current = { playing, duration, lastFrameAt, loop };

  /** 시계와 상태를 함께 옮긴다(멈춤·옮김·맞춤 — 정확한 자리가 필요한 때). */
  const setPlayhead = useCallback((next: number | ((at: number) => number)): void => {
    const value = typeof next === 'function' ? next(clock.get()) : next;
    clock.set(value);
    setPlayheadState(value);
  }, [clock]);

  const setPlaying = useCallback((next: boolean): void => {
    if (!next) {
      if (!now.current.playing) return;
      now.current.playing = false;
      callbacks.current.audio?.stop();
      setPlayheadState(clock.get());
      setPlayingState(false);
      return;
    }
    if (now.current.playing || now.current.duration <= 0) return;
    callbacks.current.onStart?.(); // Audio unlock must stay inside the user's gesture.
    if (clock.get() >= now.current.lastFrameAt) setPlayhead(0);
    notePlayPress();
    now.current.playing = true;
    // 누르는 순간 출발한다 — 소리는 그 시각에 맞춰 뒤에 붙는다(기다리지 않는다).
    callbacks.current.audio?.play(clock.get(), now.current.loop, now.current.duration);
    setPlayingState(true);
  }, [clock, setPlayhead]);

  useEffect(() => {
    setPlaying(false);
    setPlayhead(0);
  }, [docId, scope, setPlaying, setPlayhead]);
  useEffect(() => { setPlayhead((at) => Math.min(at, lastFrameAt)); }, [lastFrameAt, setPlayhead]);

  // §5.13 (Y) 40-10 ④ — 재생 중에는 배경 일(대표 프레임 굽기·비트 재기·소리 데우기)이 쉰다.
  useEffect(() => {
    if (!playing) return undefined;
    setStudioBusy('playing', true);
    return () => setStudioBusy('playing', false);
  }, [playing]);

  useEffect(() => {
    if (!playing || duration <= 0) return undefined;
    let wallStart = performance.now();
    let from = clock.get();
    let raf = 0;
    let buffering = false;
    let bufferSince = 0;
    let shownAt = 0;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    let heardBefore = false;
    let slew = 0;
    let slewStart = 0;
    const showPreparing = (on: boolean): void => {
      if (on) {
        if (hideTimer !== null) { clearTimeout(hideTimer); hideTimer = null; }
        if (shownAt === 0) { shownAt = performance.now(); setPreparing(true); }
        return;
      }
      if (shownAt === 0) return;
      const left = PLAYBACK_BUFFER_MIN_MS - (performance.now() - shownAt);
      if (left <= 0) { shownAt = 0; setPreparing(false); return; }
      if (hideTimer === null) hideTimer = setTimeout(() => { hideTimer = null; shownAt = 0; setPreparing(false); }, left);
    };
    const tick = (): void => {
      const nowMs = performance.now();
      const audio = callbacks.current.audio;
      const heard = audio?.now() ?? null;
      let next: number;
      if (buffering) {
        next = clock.get();
      } else if (heard !== null) {
        if (!heardBefore) {
          // 소리가 막 붙었다 — 벽시계와의 차를 잠깐에 걸쳐 녹인다(넘기는 순간 튀지 않게).
          heardBefore = true;
          slew = from + (nowMs - wallStart) / 1000 - heard;
          slewStart = nowMs;
        }
        const k = Math.max(0, 1 - (nowMs - slewStart) / PLAYBACK_AUDIO_SLEW_MS);
        next = heard + slew * k;
        // 소리가 시계다 — 벽시계는 소리 자리에 맞춰 둔다(소리가 끊겨도 그 자리에서 이어 가게).
        wallStart = nowMs;
        from = next;
      } else {
        heardBefore = false;
        next = from + (nowMs - wallStart) / 1000;
      }
      const span = now.current.duration;
      if (now.current.loop && span > 0) next %= span;
      if (!now.current.loop && next >= now.current.lastFrameAt) {
        clock.set(now.current.lastFrameAt);
        now.current.playing = false;
        timingRef.current = null;
        audio?.stop();
        setPlayheadState(now.current.lastFrameAt);
        setPlayingState(false);
        return;
      }
      // §5.13 (Z) 41-2 — 무대가 읽을 이어진 시각(버퍼 상태면 세운 자리 — 다시 흐르면 그 자리부터).
      timingRef.current = { t: buffering ? clock.get() : next, perfMs: nowMs };
      const at = Math.min(now.current.lastFrameAt, Math.floor(next * fps) / fps);
      // §5.13 (Y) 40-9 — 그림이 따라오지 못하면 시계를 잠깐 세운다(소리도 쉰다).
      const lag = callbacks.current.frameLag?.(at) ?? 0;
      if (!buffering && lag > PLAYBACK_BUFFER_LAG_S) {
        buffering = true;
        bufferSince = nowMs;
        audio?.hold(true);
      } else if (buffering && lag <= PLAYBACK_BUFFER_LAG_S / 3) {
        buffering = false;
        audio?.hold(false);
        wallStart = nowMs;
        from = clock.get();
        showPreparing(false);
      }
      if (buffering && nowMs - bufferSince >= PLAYBACK_BUFFER_SHOW_MS) showPreparing(true);
      if (!buffering) {
        const before = clock.get();
        clock.set(at);
        if (clock.get() !== before) notePlayMove(); // 40-12 — 누름 뒤 첫 움직임만 센다(그 뒤는 바로 돌아간다).
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      timingRef.current = null;
      if (hideTimer !== null) clearTimeout(hideTimer);
      if (buffering) callbacks.current.audio?.hold(false);
      setPreparing(false);
    };
    // 재생 머리를 의존성에 넣으면 매 프레임 다시 걸린다 — 시작점만 잡는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, docId, scope, duration, fps, clock]);

  // 반복을 바꾸면 도는 소리도 새 규칙으로(재생 중일 때만).
  useEffect(() => {
    if (!now.current.playing) return;
    const audio = callbacks.current.audio;
    audio?.stop();
    audio?.play(clock.get(), loop, now.current.duration);
  }, [loop, clock]);

  const seek = useCallback((at: number): void => {
    setPlaying(false);
    setPlayhead(Math.max(0, Math.min(lastFrameAt, Math.round(at * fps) / fps)));
  }, [fps, lastFrameAt, setPlayhead, setPlaying]);

  /** 끝에서 다시 누르면 처음부터. */
  const togglePlay = useCallback((): void => {
    setPlaying(!now.current.playing);
  }, [setPlaying]);

  const toggleLoop = useCallback((): void => setLoop((v) => !v), []);
  const timing = useCallback((): PlaybackTiming | null => (now.current.playing ? timingRef.current : null), []);
  return { playhead, clock, playing, preparing, loop, duration, fps, lastFrameAt, seek, setPlaying, togglePlay, toggleLoop, timing };
}
