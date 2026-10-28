import { useCallback, useEffect, useMemo, useRef } from 'react';
import { resolveTimeline, type ResolvedTimeline, type VideoDoc } from '@vibisual/video';
import { mixAudio, type MediabunnyMediaProvider } from '@vibisual/video/render';

import type { PlaybackAudio } from './useStudioPlayback.js';
import { studioAudioLoader } from './studioMedia.js';

/**
 * §5.13 (Y) 40-2 · 40-9 — 미리보기 소리. 렌더와 같은 믹서(`mixAudio`)를 쓴다(트림·볼륨·페이드·음소거·덕킹의 뜻이 같다 — 37-12).
 * - 1초 창(`AUDIO_PREVIEW_WINDOW_S`)을 재생 머리 앞 약 1초(`AUDIO_SCHEDULE_AHEAD_S`)까지만 섞어 이어 예약한다(판마다 문서 전체를 섞지 않는다). 조각은 소재 지문 열쇠로 기억돼 창 하나는 가볍다.
 * - 재생은 기다리지 않는다 — 첫 창이 준비되면 그 시각에 짧게(`AUDIO_ATTACH_FADE_S`) 붙는다. 그 전까지 `now()` 는 null(벽시계가 몬다), 붙은 뒤로는 귀에 들리는 시각(`getOutputTimestamp` — 출력 지연 보정)으로 재생 시계의 주인이 된다.
 * - 재생 중 판이 바뀌면 끊지 않는다 — 울리는 창은 두고 시작 안 한 창은 걷어 새 판으로 섞어 짧게(`AUDIO_CROSSFADE_S`) 교차 페이드로 잇는다.
 * - 어긋났다고 다시 틀지 않는다(다시 틀면 끊김이 들린다) — 그림 쪽이 소리를 따른다.
 */

export const AUDIO_PREVIEW_WINDOW_S = 1;
export const AUDIO_SCHEDULE_AHEAD_S = 1;
/** 첫 창을 지금보다 이만큼 뒤에 건다(섞는 사이 시각이 지나가지 않게). */
const AUDIO_START_LEAD_S = 0.06;
export const AUDIO_ATTACH_FADE_S = 0.015;
export const AUDIO_CROSSFADE_S = 0.03;
/** 예약을 살피는 간격(ms). */
const SCHEDULE_TICK_MS = 120;

interface ScheduledWindow {
  /** 펼친(반복을 펴서 이은) 재생 위치 — 이 창의 시작. */
  readonly startAccum: number;
  readonly endAccum: number;
  readonly startCtx: number;
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly version: number;
}

interface Session {
  readonly ctx: AudioContext;
  readonly loop: boolean;
  readonly duration: number;
  /** 펼친 위치 `startAccum` 이 문맥 시각 `startCtx` 에 울린다. */
  readonly originAccum: number;
  readonly originCtx: number;
  nextAccum: number;
  readonly windows: ScheduledWindow[];
  abort: AbortController;
  mixing: boolean;
  /** 첫 창이 울리기 시작했는가(그 전엔 벽시계가 몬다). */
  attached: boolean;
  held: boolean;
}

export interface StudioAudio extends PlaybackAudio {
  /** 사용자 몸짓 안에서 — AudioContext 를 열고 깨운다(잠금 해제). */
  readonly resume: () => void;
  /** 한가할 때 — 그 시각 앞 소리 조각을 미리 풀어 둔다(섞지 않는다). */
  readonly warm: (at: number) => Promise<void>;
  /**
   * §5.13 (AA) 42-3 — 미리보기 음소거·크기(0~1). 마스터 크기만 바꾼다 — 소리는 계속 섞이고 울려 **재생 시계는 그대로** 소리가
   * 주인이다(40-9). 짧게 이어 바꿔 딸깍 소리가 나지 않게.
   */
  readonly setOutput: (muted: boolean, volume: number) => void;
}

/** 마스터 크기를 바꿀 때 따라가는 시간 상수(초) — 딸깍 없이 바로. */
const MASTER_GAIN_TIME_S = 0.015;

/** 펼친 위치 → 그 판의 시각(반복이면 길이로 접는다). */
function folded(accum: number, loop: boolean, duration: number): number {
  return loop && duration > 0 ? ((accum % duration) + duration) % duration : accum;
}

/** 지금 귀에 들리는 문맥 시각 — 출력 지연을 뺀다(`getOutputTimestamp` 가 있으면 그 측정에서 지금까지를 더해 늘린다). */
export function heardContextTime(ctx: Pick<AudioContext, 'currentTime' | 'baseLatency'> & Partial<Pick<AudioContext, 'getOutputTimestamp' | 'outputLatency'>>, nowMs: number): number {
  try {
    const ts = ctx.getOutputTimestamp?.();
    if (ts && typeof ts.contextTime === 'number' && typeof ts.performanceTime === 'number' && ts.performanceTime > 0) {
      return ts.contextTime + Math.max(0, nowMs - ts.performanceTime) / 1000;
    }
  } catch { /* 이 판에 없다 */ }
  const latency = (ctx.outputLatency ?? 0) || (ctx.baseLatency ?? 0);
  return ctx.currentTime - latency;
}

export function useVideoAudio(
  project: string,
  doc: VideoDoc | null,
  opts: { readonly media: MediabunnyMediaProvider | null; readonly onError: (message: string) => void },
): StudioAudio {
  const context = useRef<AudioContext | null>(null);
  const session = useRef<Session | null>(null);
  /** §5.13 (AA) 42-3 — 문맥마다 마스터 게인 하나(창마다의 게인이 여기로 모인다). */
  const master = useRef<GainNode | null>(null);
  const masterCtx = useRef<BaseAudioContext | null>(null);
  const output = useRef({ muted: false, volume: 1 });
  const masterFor = (ctx: BaseAudioContext): AudioNode => {
    if (!master.current || masterCtx.current !== ctx) {
      master.current?.disconnect();
      const gain = ctx.createGain();
      gain.gain.value = output.current.muted ? 0 : output.current.volume;
      gain.connect(ctx.destination);
      master.current = gain;
      masterCtx.current = ctx;
    }
    return master.current;
  };
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const alive = useRef(true);
  const version = useRef(0);
  const timeline = useMemo<ResolvedTimeline | null>(() => (doc ? resolveTimeline(doc) : null), [doc]);
  const latest = useRef({ project, doc, timeline, media: opts.media, onError: opts.onError });
  latest.current = { project, doc, timeline, media: opts.media, onError: opts.onError };
  const reported = useRef(new Set<string>());

  const report = useCallback((message: string): void => {
    if (reported.current.has(message)) return;
    reported.current.add(message);
    latest.current.onError(message);
  }, []);

  const dropWindow = (w: ScheduledWindow): void => {
    w.source.onended = null;
    try { w.source.stop(); } catch { /* 이미 끝났다 */ }
    w.source.disconnect();
    w.source.buffer = null;
    w.gain.disconnect();
  };

  const stop = useCallback((): void => {
    const s = session.current;
    session.current = null;
    if (timer.current !== null) { clearInterval(timer.current); timer.current = null; }
    if (!s) return;
    s.abort.abort();
    for (const w of s.windows.splice(0)) dropWindow(w);
    if (s.held && s.ctx.state === 'suspended') void s.ctx.resume().catch(() => undefined);
  }, []);

  /** 다음 창 하나를 섞어 건다(겹쳐 섞지 않는다). */
  const scheduleNext = useCallback(async (s: Session): Promise<void> => {
    if (s.mixing || session.current !== s) return;
    const cur = latest.current;
    if (!cur.doc || !cur.timeline) return;
    const heard = heardContextTime(s.ctx, performance.now());
    const heardAccum = s.originAccum + (heard - s.originCtx);
    if (s.nextAccum - heardAccum > AUDIO_SCHEDULE_AHEAD_S) return;
    if (!s.loop && s.nextAccum >= s.duration) return;
    s.mixing = true;
    const startAccum = s.nextAccum;
    const pos = folded(startAccum, s.loop, s.duration);
    // 반복이면 창이 끝을 넘지 않게 자른다(다음 창이 0 에서 잇는다).
    const len = Math.min(AUDIO_PREVIEW_WINDOW_S, Math.max(0.01, s.duration - pos));
    const myVersion = version.current;
    try {
      const buffer = await mixAudio({
        doc: cur.doc, timeline: cur.timeline, loader: studioAudioLoader(cur.project, cur.media),
        range: { start: pos, end: pos + len }, signal: s.abort.signal, sampleRate: s.ctx.sampleRate,
        onWarn: report,
      });
      if (session.current !== s || s.abort.signal.aborted) return;
      const startCtx = s.originCtx + (startAccum - s.originAccum);
      s.nextAccum = startAccum + len;
      if (!buffer) return; // 이 창은 무음 — 다음 창으로.
      const gain = s.ctx.createGain();
      const source = s.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(masterFor(s.ctx));
      const at = Math.max(s.ctx.currentTime, startCtx);
      const offset = Math.max(0, at - startCtx);
      // 첫 창·교차 페이드 자리는 짧게 올리고, 그 밖은 그대로 잇는다(창 경계는 표본 단위로 맞물린다).
      const first = s.windows.length === 0;
      if (first) {
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(1, at + AUDIO_ATTACH_FADE_S);
      } else {
        gain.gain.setValueAtTime(1, at);
      }
      source.start(at, offset);
      const win: ScheduledWindow = { startAccum, endAccum: startAccum + len, startCtx, source, gain, version: myVersion };
      source.onended = (): void => {
        const i = s.windows.indexOf(win);
        if (i >= 0) s.windows.splice(i, 1);
        source.disconnect(); gain.disconnect(); source.buffer = null;
      };
      s.windows.push(win);
      if (first) s.attached = true;
    } catch (error) {
      if (!s.abort.signal.aborted && session.current === s) report(String(error));
      s.nextAccum = Math.max(s.nextAccum, startAccum + len);
    } finally {
      s.mixing = false;
    }
  }, [report]);

  const play = useCallback((at: number, loop: boolean, duration: number): void => {
    stop();
    const ctx = context.current;
    if (!alive.current || !ctx || ctx.state === 'closed' || duration <= 0) return;
    const originCtx = ctx.currentTime + AUDIO_START_LEAD_S;
    const s: Session = {
      ctx, loop, duration, originAccum: at + AUDIO_START_LEAD_S, originCtx, nextAccum: at + AUDIO_START_LEAD_S,
      windows: [], abort: new AbortController(), mixing: false, attached: false, held: false,
    };
    session.current = s;
    const pump = (): void => { void scheduleNext(s).then(() => { if (session.current === s && !s.mixing) void scheduleNext(s); }); };
    pump();
    timer.current = setInterval(pump, SCHEDULE_TICK_MS);
  }, [scheduleNext, stop]);

  const now = useCallback((): number | null => {
    const s = session.current;
    if (!s || !s.attached || s.held) return null;
    const heard = heardContextTime(s.ctx, performance.now());
    const first = s.windows[0];
    if (!first || heard < s.originCtx) return null;
    return folded(s.originAccum + (heard - s.originCtx), s.loop, s.duration);
  }, []);

  const hold = useCallback((on: boolean): void => {
    const s = session.current;
    if (!s || s.held === on) return;
    s.held = on;
    if (on) void s.ctx.suspend().catch(() => undefined);
    else void s.ctx.resume().catch(() => undefined);
  }, []);

  // This method must run synchronously inside the user's play gesture to unlock Web Audio.
  const resume = useCallback((): void => {
    if (!alive.current || typeof AudioContext === 'undefined') return;
    try {
      if (!context.current || context.current.state === 'closed') context.current = new AudioContext();
      const current = context.current;
      void current.resume().catch((error: unknown) => { if (alive.current && context.current === current) report(String(error)); });
    } catch (error) { if (alive.current) report(String(error)); }
  }, [report]);

  /** 판이 바뀌었다 — 아직 시작 안 한 창을 걷고 새 판으로 다시 섞어 교차 페이드로 잇는다(울리는 창은 그대로). */
  useEffect(() => {
    version.current += 1;
    reported.current.clear();
    const s = session.current;
    if (!s) return;
    const nowCtx = s.ctx.currentTime;
    const keep = s.windows.filter((w) => w.startCtx <= nowCtx + AUDIO_CROSSFADE_S);
    const drop = s.windows.filter((w) => !keep.includes(w));
    if (drop.length === 0) return;
    for (const w of drop) dropWindow(w);
    s.windows.splice(0, s.windows.length, ...keep);
    const last = keep[keep.length - 1];
    if (last) {
      // 울리는 창의 끝을 짧게 내린다 — 새 판 창이 그 자리에서 올라온다.
      const endCtx = s.originCtx + (last.endAccum - s.originAccum);
      try {
        last.gain.gain.setValueAtTime(1, Math.max(nowCtx, endCtx - AUDIO_CROSSFADE_S));
        last.gain.gain.linearRampToValueAtTime(0, endCtx);
      } catch { /* 지난 시각 — 이미 지나갔다 */ }
      s.nextAccum = last.endAccum;
    } else {
      s.nextAccum = Math.max(s.originAccum, s.originAccum + (heardContextTime(s.ctx, performance.now()) - s.originCtx) + AUDIO_START_LEAD_S);
    }
    void scheduleNext(s);
  }, [doc, scheduleNext]);

  // 다른 문서·프로젝트로 갈아타면 멈춘다(그 판의 조각 기억은 지문 열쇠라 남아도 섞이지 않는다).
  const docId = doc?.id ?? '';
  useEffect(() => { stop(); }, [docId, project, stop]);

  const warm = useCallback(async (at: number): Promise<void> => {
    const cur = latest.current;
    if (!cur.doc || !cur.timeline || !cur.media || typeof OfflineAudioContext === 'undefined') return;
    // 조각만 풀어 둔다 — 섞지 않는다(가장 작은 창 하나를 섞으면 그 창의 조각이 모두 풀린다).
    try {
      await mixAudio({ doc: cur.doc, timeline: cur.timeline, loader: studioAudioLoader(cur.project, cur.media), range: { start: Math.max(0, at), end: Math.max(0, at) + AUDIO_PREVIEW_WINDOW_S * 2 }, sampleRate: 8_000, channels: 1 });
    } catch { /* 데우기 실패는 재생 때 다시 — 알리지 않는다 */ }
  }, []);

  const setOutput = useCallback((muted: boolean, volume: number): void => {
    const v = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
    output.current = { muted, volume: v };
    const gain = master.current;
    if (!gain) return;
    try {
      gain.gain.setTargetAtTime(muted ? 0 : v, masterCtx.current?.currentTime ?? 0, MASTER_GAIN_TIME_S);
    } catch {
      gain.gain.value = muted ? 0 : v;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop();
      const previous = context.current; context.current = null;
      master.current?.disconnect();
      master.current = null;
      masterCtx.current = null;
      // Teardown failures cannot affect a mounted player or be shown in a different document.
      if (previous && previous.state !== 'closed') void previous.close().catch(() => undefined);
    };
  }, [stop]);

  return useMemo(() => ({ resume, play, stop, now, hold, warm, setOutput }), [resume, play, stop, now, hold, warm, setOutput]);
}
