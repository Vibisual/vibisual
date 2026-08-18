/**
 * 소리 섞기 (SCENARIO.md §5.13 (E)).
 *
 * 타임라인의 오디오 아이템들을 **하나의 `AudioBuffer`** 로 합친다. 인코더는 프레임과
 * 달리 소리를 구간 단위로 한 번에 받으므로, 렌더 루프 안에서 프레임마다 물어볼 필요가
 * 없다.
 *
 * `OfflineAudioContext` 를 쓰는 이유는 **실시간보다 빠르게** 렌더되기 때문이다. 4분짜리
 * 영상의 소리를 섞는 데 4분을 기다릴 수는 없다.
 *
 * 여기서 처리하는 것: 배치 시각, 트림, 볼륨, 페이드 인·아웃, 음소거 트랙 제외.
 * 여기서 처리하지 않는 것: 소재 생성(§5.13 (H) — 앱은 소리를 만들지 않는다).
 */

import type { ResolvedItem, ResolvedTimeline, VideoAsset, VideoDoc } from '../types.js';
import { audioItemsAt } from './drawList.js';

/** 오디오 소재의 원본 바이트를 내주는 쪽. 파일 접근 방식은 호스트가 정한다. */
export interface AudioBytesLoader {
  fetchBytes(asset: VideoAsset): Promise<ArrayBuffer | null>;
}

export interface MixAudioOptions {
  readonly doc: VideoDoc;
  readonly timeline: ResolvedTimeline;
  readonly loader: AudioBytesLoader;
  readonly sampleRate?: number;
  readonly channels?: number;
  /** 못 읽은 소재를 알리는 통로. 조용히 빠뜨리지 않기 위해 있다. */
  readonly onWarn?: (message: string) => void;
}

function num(props: Readonly<Record<string, unknown>> | undefined, key: string, fallback: number): number {
  const v = props?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * 아이템 하나를 오프라인 문맥에 붙인다.
 *
 * 페이드를 램프로 거는 이유는, 소리가 딱 끊기면 **팝 잡음**이 생기기 때문이다. 이건
 * 자동 검수가 잡아내는 항목이기도 해서 애초에 만들지 않는 편이 낫다.
 */
function scheduleItem(
  ctx: OfflineAudioContext,
  buffer: AudioBuffer,
  item: ResolvedItem,
  destination: AudioNode,
): void {
  const props = item.item.props;
  const volume = Math.max(0, num(props, 'volume', 1));
  const fadeIn = Math.max(0, num(props, 'fadeIn', 0));
  const fadeOut = Math.max(0, num(props, 'fadeOut', 0));
  const trimStart = Math.max(0, item.item.trimStart ?? 0);

  // 소재에 실제로 남아 있는 만큼만 쓴다 — 넘겨 달라고 하면 뒤가 무음으로 채워진다.
  const available = Math.max(0, buffer.duration - trimStart);
  const playDuration = Math.min(item.duration, available);
  if (playDuration <= 0) return;

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const gain = ctx.createGain();
  const start = item.start;
  const end = start + playDuration;

  gain.gain.setValueAtTime(fadeIn > 0 ? 0 : volume, start);
  if (fadeIn > 0) {
    gain.gain.linearRampToValueAtTime(volume, start + Math.min(fadeIn, playDuration));
  }
  if (fadeOut > 0) {
    const fadeStart = Math.max(start, end - Math.min(fadeOut, playDuration));
    gain.gain.setValueAtTime(volume, fadeStart);
    gain.gain.linearRampToValueAtTime(0, end);
  }

  source.connect(gain);
  gain.connect(destination);
  source.start(start, trimStart, playDuration);
}

/**
 * 타임라인의 소리를 하나로 섞는다.
 *
 * 오디오 아이템이 없으면 `null` — 그때는 무음 트랙조차 만들지 않는다(빈 오디오 트랙이
 * 붙은 파일은 일부 재생기에서 오히려 문제를 만든다).
 */
export async function mixAudio(opts: MixAudioOptions): Promise<AudioBuffer | null> {
  const { doc, timeline, loader } = opts;
  const items = audioItemsAt(doc, timeline);
  if (items.length === 0) return null;
  if (timeline.duration <= 0) return null;

  const sampleRate = opts.sampleRate ?? 48_000;
  const channels = opts.channels ?? 2;
  const frames = Math.ceil(timeline.duration * sampleRate);

  const ctx = new OfflineAudioContext(channels, frames, sampleRate);

  // 소재는 한 번만 디코딩한다 — 같은 음성을 여러 컷에서 쓰는 것이 흔하다.
  const decoded = new Map<string, AudioBuffer | null>();
  let scheduled = 0;

  for (const item of items) {
    const assetId = item.item.assetId;
    if (assetId === undefined) continue;

    if (!decoded.has(assetId)) {
      const asset = doc.assets[assetId];
      if (!asset) {
        decoded.set(assetId, null);
        opts.onWarn?.(`오디오 소재 '${assetId}' 가 문서에 없습니다.`);
      } else {
        try {
          const bytes = await loader.fetchBytes(asset);
          decoded.set(assetId, bytes === null ? null : await ctx.decodeAudioData(bytes));
        } catch (err) {
          decoded.set(assetId, null);
          opts.onWarn?.(`오디오 소재 '${assetId}' 를 읽지 못했습니다: ${String(err)}`);
        }
      }
    }

    const buffer = decoded.get(assetId);
    if (!buffer) continue;
    scheduleItem(ctx, buffer, item, ctx.destination);
    scheduled += 1;
  }

  // 하나도 못 붙였으면 무음 버퍼를 내놓지 않는다 — 소리가 있다고 착각하게 만들 뿐이다.
  if (scheduled === 0) return null;

  return ctx.startRendering();
}

/**
 * 특정 시각의 소리 크기(0~1).
 *
 * 자동 검수의 "소리가 있어야 하는데 무음" 판정이 쓰는 값이다. 짧은 창의 제곱평균으로
 * 재는 이유는 순간값 하나로는 파형이 0을 지나는 순간을 무음으로 오해하기 때문이다.
 */
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
