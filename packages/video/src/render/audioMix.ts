/**
 * §5.13 (E) 소리 섞기 — 오디오 아이템을 `AudioBuffer` 하나로(인코더는 소리를 구간 단위로 받는다). `OfflineAudioContext` 라 실시간보다 빠르다.
 * (V) 37-12 덕킹은 `duckEnvelope`. (Y) 40-2 — 실효 이득 0 은 받기 전에 빼고(`audioItemsAt`), 소재는 쓰는 구간만 조각으로 푼다(`loadRange`).
 * `range` 를 받아 미리보기는 짧은 창을 잇는다 — `envelopeForWindow` 로 이어 붙인 소리가 한 번에 섞은 것과 같다(시험 고정). 미리보기와 렌더는 이 한 함수다.
 */

import type { ResolvedItem, ResolvedTimeline, VideoAsset, VideoDoc } from '../types.js';
import { audioItemsAt } from './drawList.js';
import { DUCK_DEFAULT_DB, duckEnvelope, type DuckPoint } from '../audio/duck.js';
import type { AudioChunk } from './media.js';

/** 오디오 소재의 원본 바이트를 내주는 쪽. 파일 접근 방식은 호스트가 정한다. */
export interface AudioBytesLoader {
  fetchBytes(asset: VideoAsset): Promise<ArrayBuffer | null>;
  /**
   * §5.13 (Y) 40-2 ② — 소재 안 `[from, to)`(초)를 덮는 디코딩된 조각들. 호스트가 조각 단위로 기억한다(판이 바뀌어도 다시 풀지
   * 않는다). null 이면(소리 트랙 없음 · 이 판에서 못 푸는 코덱) 통째 디코딩으로 물러선다.
   */
  loadRange?(asset: VideoAsset, from: number, to: number, signal?: AbortSignal): Promise<readonly AudioChunk[] | null>;
  /** 통째 디코딩한 결과를 기억하는 자리(물러선 길에서도 판마다 다시 풀지 않게). */
  readonly wholeCache?: {
    get(asset: VideoAsset): AudioBuffer | undefined;
    set(asset: VideoAsset, buffer: AudioBuffer): void;
  };
}

export interface MixAudioOptions {
  readonly doc: VideoDoc;
  readonly timeline: ResolvedTimeline;
  readonly loader: AudioBytesLoader;
  readonly sampleRate?: number;
  readonly channels?: number;
  /** §5.13 (Y) 40-2 ③ — 섞을 구간(타임라인 초). 없으면 처음~끝. 결과 버퍼의 0 표본이 `range.start` 다. */
  readonly range?: { readonly start: number; readonly end: number };
  /** Stop queued decode/scheduling when a preview is closed or its document changes. */
  readonly signal?: AbortSignal;
  /** 못 읽은 소재를 알리는 통로. 조용히 빠뜨리지 않기 위해 있다. */
  readonly onWarn?: (message: string) => void;
}

function num(props: Readonly<Record<string, unknown>> | undefined, key: string, fallback: number): number {
  const v = props?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** 곡선의 점(타임라인 초, 값). 점 사이는 직선이다(Web Audio `linearRampToValueAtTime` 과 같은 뜻). */
export interface EnvelopePoint {
  readonly t: number;
  readonly v: number;
}

/** 페이드를 램프로 거는 것은 딱 끊기면 팝 잡음이 나서다(자동 검수 항목). `playDuration` = 실제로 울리는 길이(소재 끝에서 잘린다). */
export function gainEnvelope(item: ResolvedItem, playDuration: number): EnvelopePoint[] {
  const props = item.item.props;
  const volume = Math.max(0, num(props, 'volume', 1));
  const fadeIn = Math.max(0, num(props, 'fadeIn', 0));
  const fadeOut = Math.max(0, num(props, 'fadeOut', 0));
  const start = item.start;
  const end = start + playDuration;
  const points: EnvelopePoint[] = [{ t: start, v: fadeIn > 0 ? 0 : volume }];
  if (fadeIn > 0) points.push({ t: start + Math.min(fadeIn, playDuration), v: volume });
  if (fadeOut > 0) {
    const fadeStart = Math.max(start, end - Math.min(fadeOut, playDuration));
    const last = points[points.length - 1]!;
    if (fadeStart > last.t) points.push({ t: fadeStart, v: volume });
    points.push({ t: end, v: 0 });
  }
  return points;
}

/** 곡선의 `t` 시각 값(첫 점 앞은 첫 값, 끝 점 뒤는 끝 값). */
export function envelopeValueAt(points: readonly EnvelopePoint[], t: number): number {
  const first = points[0];
  if (!first) return 1;
  if (t <= first.t) return first.v;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (t <= b.t) return b.t === a.t ? b.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
  }
  return points[points.length - 1]!.v;
}

/**
 * §5.13 (Y) 40-2 ③ — 창 `[winStart, winEnd)` 에 걸 곡선(창 기준 초): 창 시작의 값 하나 + 그 뒤의 꺾임들. 창 끝 너머의 첫 점도
 * 넣는다(그 점이 창 안 마지막 램프의 기울기를 정한다 — 넣지 않으면 창 끝에서 곡선이 꺾인다). 창을 이어 붙이면 한 번에 건 곡선과
 * 같다.
 */
export function envelopeForWindow(points: readonly EnvelopePoint[], winStart: number, winEnd: number): { initial: number; ramps: EnvelopePoint[] } {
  const initial = envelopeValueAt(points, winStart);
  const ramps: EnvelopePoint[] = [];
  for (const p of points) {
    if (p.t <= winStart) continue;
    ramps.push({ t: p.t - winStart, v: p.v });
    if (p.t >= winEnd) break;
  }
  // 끝에 남은 같은 값 점은 곡선을 바꾸지 않는다 — 걸지 않는다(가운데의 평평한 점은 다음 램프의 출발점이라 남긴다).
  while (ramps.length > 0 && ramps[ramps.length - 1]!.v === (ramps.length > 1 ? ramps[ramps.length - 2]!.v : initial)) ramps.pop();
  return { initial, ramps };
}

function applyEnvelope(param: AudioParam, points: readonly EnvelopePoint[], winStart: number, winEnd: number): void {
  const { initial, ramps } = envelopeForWindow(points, winStart, winEnd);
  param.setValueAtTime(initial, 0);
  for (const r of ramps) param.linearRampToValueAtTime(r.v, r.t);
}

/** 아이템의 소리 역할(`props.role`). */
function roleOf(item: ResolvedItem): string | undefined {
  const role = item.item.props?.['role'];
  return typeof role === 'string' ? role : undefined;
}

/**
 * §5.13 (V) 37-12 — 음악 아이템 하나에 걸 덕킹 곡선. `props.duckDb`(0 이하 dB — 0 이면 끔)로 깊이를 바꾼다. 목소리가 없으면 빈 곡선.
 */
export function duckCurveFor(item: ResolvedItem, voice: readonly { start: number; end: number }[]): DuckPoint[] {
  if (roleOf(item) !== 'music' || voice.length === 0) return [];
  const depth = num(item.item.props, 'duckDb', DUCK_DEFAULT_DB);
  return duckEnvelope(voice, { depthDb: Math.min(0, depth) });
}

/**
 * §5.13 (Y) 40-2 ③ — 아이템이 창 안에서 울리는 몫: 창 기준 시작(`when`) · 소재 안 시각(`from`) · 길이. 창 밖이면 null.
 * `playDuration` = 그 아이템이 실제로 울리는 길이(소재 끝에서 잘린다).
 */
export function itemWindowSpan(item: ResolvedItem, playDuration: number, winStart: number, winEnd: number): { when: number; from: number; duration: number } | null {
  const trimStart = Math.max(0, item.item.trimStart ?? 0);
  const s = Math.max(item.start, winStart);
  const e = Math.min(item.start + playDuration, winEnd);
  if (e - s <= 1e-6) return null;
  return { when: s - winStart, from: trimStart + (s - item.start), duration: e - s };
}

/** 오디오 아이템이 없으면 `null` — 무음 트랙도 만들지 않는다(빈 오디오 트랙은 일부 재생기에서 문제를 만든다). */
export async function mixAudio(opts: MixAudioOptions): Promise<AudioBuffer | null> {
  opts.signal?.throwIfAborted();
  const { doc, timeline, loader } = opts;
  const items = audioItemsAt(doc, timeline);
  if (items.length === 0) return null;
  if (timeline.duration <= 0) return null;

  const winStart = Math.max(0, opts.range?.start ?? 0);
  const winEnd = Math.min(timeline.duration, opts.range?.end ?? timeline.duration);
  if (winEnd - winStart <= 1e-6) return null;
  const sampleRate = opts.sampleRate ?? 48_000;
  const channels = opts.channels ?? 2;
  const frames = Math.max(1, Math.ceil((winEnd - winStart) * sampleRate));

  // 창에 걸리는 아이템만 — 그 밖은 풀 일도 걸 일도 없다.
  const windowed = items.filter((it) => it.end > winStart && it.start < winEnd);
  if (windowed.length === 0) return null;

  const ctx = new OfflineAudioContext(channels, frames, sampleRate);

  // §5.13 (V) 37-12 — 목소리 구간(덕킹의 기준 — 창 밖 목소리도 곡선을 정하므로 전체에서). 음악 아이템마다 같은 곡선을 건다.
  const voice = items.filter((it) => roleOf(it) === 'voice').map((it) => ({ start: it.start, end: it.end }));

  // 통째 디코딩(물러선 길)은 소재당 한 번 — 같은 음성을 여러 컷에서 쓰는 것이 흔하다.
  const decoded = new Map<string, AudioBuffer | null>();
  let scheduled = 0;
  const scheduledCleanup: (() => void)[] = [];
  const release = (): void => {
    for (const cleanup of scheduledCleanup.splice(0)) cleanup();
    decoded.clear();
  };
  opts.signal?.addEventListener('abort', release, { once: true });

  const warnedAssets = new Set<string>();
  const warn = (assetId: string, message: string): void => {
    if (warnedAssets.has(assetId)) return;
    warnedAssets.add(assetId);
    opts.onWarn?.(message);
  };

  const wholeBuffer = async (asset: VideoAsset): Promise<AudioBuffer | null> => {
    if (decoded.has(asset.id)) return decoded.get(asset.id) ?? null;
    const cached = loader.wholeCache?.get(asset);
    if (cached) { decoded.set(asset.id, cached); return cached; }
    const bytes = await loader.fetchBytes(asset);
    opts.signal?.throwIfAborted();
    const buffer = bytes === null ? null : await ctx.decodeAudioData(bytes);
    opts.signal?.throwIfAborted();
    decoded.set(asset.id, buffer);
    if (buffer) loader.wholeCache?.set(asset, buffer);
    return buffer;
  };

  /** 소스 하나를 아이템 게인에 잇는다(창 기준 `when` 에, 버퍼 안 `offset` 부터 `duration` 만큼). */
  const connectSource = (buffer: AudioBuffer, destination: AudioNode, when: number, offset: number, duration: number): void => {
    if (duration <= 1e-6 || offset >= buffer.duration) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);
    source.start(Math.max(0, when), Math.max(0, offset), Math.min(duration, buffer.duration - offset));
    scheduledCleanup.push(() => {
      try { source.stop(); } catch { /* A completed offline source may already be stopped. */ }
      source.disconnect(); source.buffer = null;
    });
  };

  try {
    for (const item of windowed) {
      opts.signal?.throwIfAborted();
      const assetId = item.item.assetId;
      if (assetId === undefined) continue;
      const asset = doc.assets[assetId];
      if (!asset) {
        warn(assetId, `오디오 소재 '${assetId}' 가 문서에 없습니다.`);
        continue;
      }
      const trimStart = Math.max(0, item.item.trimStart ?? 0);
      // 소재에 실제로 남아 있는 만큼만 쓴다 — 넘겨 달라고 하면 뒤가 무음으로 채워진다(길이를 모르면 아이템 길이).
      const knownAvailable = typeof asset.duration === 'number' && asset.duration > 0 ? Math.max(0, asset.duration - trimStart) : Infinity;
      let playDuration = Math.min(item.duration, knownAvailable);
      let span = itemWindowSpan(item, playDuration, winStart, winEnd);
      if (!span) continue;

      let chunks: readonly AudioChunk[] | null = null;
      let whole: AudioBuffer | null = null;
      try {
        chunks = loader.loadRange ? await loader.loadRange(asset, span.from, span.from + span.duration, opts.signal) : null;
        opts.signal?.throwIfAborted();
        if (!chunks) {
          whole = await wholeBuffer(asset);
          if (whole) {
            playDuration = Math.min(item.duration, Math.max(0, whole.duration - trimStart));
            span = itemWindowSpan(item, playDuration, winStart, winEnd);
            if (!span) continue;
          }
        }
      } catch (err) {
        opts.signal?.throwIfAborted();
        warn(assetId, `오디오 소재 '${assetId}' 를 읽지 못했습니다: ${String(err)}`);
        continue;
      }
      if (!whole && (!chunks || chunks.length === 0)) continue;

      // 아이템마다 게인 둘 — 볼륨·페이드와 덕킹을 따로 건다(두 곡선이 한 게인에서 서로를 지우지 않게).
      const gain = ctx.createGain();
      applyEnvelope(gain.gain, gainEnvelope(item, playDuration), winStart, winEnd);
      const duck = duckCurveFor(item, voice).map((p): EnvelopePoint => ({ t: p.t, v: p.gain }));
      let ducker: GainNode | null = null;
      if (duck.length > 0) {
        ducker = ctx.createGain();
        applyEnvelope(ducker.gain, duck, winStart, winEnd);
        gain.connect(ducker);
        ducker.connect(ctx.destination);
      } else {
        gain.connect(ctx.destination);
      }
      scheduledCleanup.push(() => { gain.disconnect(); ducker?.disconnect(); });

      const active = span;
      if (whole) {
        connectSource(whole, gain, active.when, active.from, active.duration);
      } else if (chunks) {
        // 조각마다 그 조각이 덮는 몫만 — 이어진 조각은 표본 단위로 맞물린다.
        for (const chunk of chunks) {
          const cStart = chunk.start;
          const cEnd = chunk.start + chunk.buffer.duration;
          const a = Math.max(active.from, cStart);
          const b = Math.min(active.from + active.duration, cEnd);
          if (b - a <= 1e-6) continue;
          connectSource(chunk.buffer, gain, active.when + (a - active.from), a - cStart, b - a);
        }
      }
      scheduled += 1;
    }

    // 하나도 못 붙였으면 무음 버퍼를 내놓지 않는다 — 소리가 있다고 착각하게 만들 뿐이다.
    if (scheduled === 0) return null;

    opts.signal?.throwIfAborted();
    const rendered = await ctx.startRendering();
    opts.signal?.throwIfAborted();
    return rendered;
  } finally {
    opts.signal?.removeEventListener('abort', release);
    release();
  }
}

/** 소리 크기(0~1, 자동 검수의 무음 판정용). 짧은 창의 제곱평균으로 잰다 — 순간값은 파형이 0 을 지날 때 무음으로 읽힌다. */
export function audioLevelAt(buffer: AudioBuffer, t: number, windowSec = 0.05): number {
  if (t < 0 || t >= buffer.duration) return 0;
  const sr = buffer.sampleRate;
  const from = Math.floor(t * sr);
  const to = Math.min(buffer.length, from + Math.max(1, Math.floor(windowSec * sr)));
  if (to <= from) return 0;

  let sumSq = 0;
  let count = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
    const data = buffer.getChannelData(ch);
    for (let i = from; i < to; i += 1) {
      const v = data[i] ?? 0;
      sumSq += v * v;
      count += 1;
    }
  }
  return count === 0 ? 0 : Math.sqrt(sumSq / count);
}
