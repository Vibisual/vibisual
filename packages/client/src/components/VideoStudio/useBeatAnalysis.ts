import { useEffect, useRef } from 'react';
import { analyzeBeats, downmixToMono, stableHash, type VideoAsset, type VideoDoc } from '@vibisual/video';
import { loadMediabunny } from '@vibisual/video/render';

import { assetUrl } from './assetUrl.js';
import { BEAT_ANALYSIS_RATE, bpmRangeFor, downsampleMonoInto, usableBpmTag } from './beatDecode.js';
import { assetFingerprint, assetPath, studioMediaFetch } from './studioMedia.js';
import { runWhenIdle, waitStudioIdle } from './studioIdle.js';
import { writeBeatFacts } from './videoApi.js';

/**
 * §5.13 (V) 37-12 — 음악을 넣으면 비트를 잰다. 아직 안 잰(`beatsHash` 가 없는) 소리 소재를 이 창에서 한 번 재고(순수 함수
 * `analyzeBeats`), 서버가 최신 문서에 그 칸만 얹게 한다(되돌리기 이력 밖 — 길이 실측과 같은 성격). 내레이션처럼 주기가 약하면
 * 빈 비트를 적는다 — 다시 재지 않게. 같은 내용(소재 지문)이면 다른 문서에서도 다시 재지 않는다.
 *
 * §5.13 (Y) 40-2 ⑦ — 곡을 통째로 받아 통째 디코딩하지 않는다. 스트리밍 주소에서 디코더 조각을 하나씩 받아 한 갈래 · 11.025kHz 로
 * 내려 담고(`beatDecode.ts` — 3분 약 7.6MB), 파일에 BPM 태그가 있으면 그 둘레로 템포를 좁혀 잰다. 일은 배경 줄(`runWhenIdle`)에서
 * 돌고, 디코딩 도중에도 재생·끌기·입력이 오면 쉰다(`waitStudioIdle`). 이 판에서 못 푸는 코덱만 종전 길(통째 디코딩)로 물러선다.
 */

/** 실패한 소재를 다시 시도하지 않는 동안(ms). */
const RETRY_AFTER_MS = 5 * 60_000;
/** 디코딩 중 이만큼(ms) 돌면 한 번 양보한다(조각마다 양보하면 3분 곡이 수천 번 쉰다). */
const DECODE_SLICE_MS = 8;

interface BeatFacts {
  readonly beats: number[];
  readonly beatsStrong: number[];
  readonly bpm: number;
  readonly beatsHash: string;
}

/** 소재 지문 → 잰 결과(이 창이 사는 동안). */
const measured = new Map<string, BeatFacts>();
const inFlight = new Set<string>();
const failedAt = new Map<string, number>();

/** 디코더 조각을 하나씩 내려 담는다. 이 판에서 못 푸는 소리면 null. */
async function decodeMono(url: string, signal: AbortSignal): Promise<{ mono: Float32Array; bpmTag: number | null } | null> {
  signal.throwIfAborted();
  const mb = await loadMediabunny();
  signal.throwIfAborted();
  const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.UrlSource(url, { fetchFn: studioMediaFetch() }) });
  // Disposing cancels pending track reads, decoding, and the source's fetch retries too.
  const dispose = (): void => input.dispose();
  signal.addEventListener('abort', dispose, { once: true });
  try {
    const track = await input.getPrimaryAudioTrack();
    signal.throwIfAborted();
    if (!track || !(await track.canDecode().catch(() => false))) return null;
    signal.throwIfAborted();
    const tags = await input.getMetadataTags().catch(() => null);
    signal.throwIfAborted();
    const duration = await track.computeDuration();
    signal.throwIfAborted();
    if (!(duration > 0)) return null;
    const mono = new Float32Array(Math.ceil(duration * BEAT_ANALYSIS_RATE));
    const sink = new mb.AudioBufferSink(track);
    let sliceStart = performance.now();
    for await (const { buffer, timestamp } of sink.buffers()) {
      signal.throwIfAborted();
      const channels: Float32Array[] = [];
      for (let c = 0; c < buffer.numberOfChannels; c += 1) channels.push(buffer.getChannelData(c));
      downsampleMonoInto(mono, BEAT_ANALYSIS_RATE, timestamp, channels, buffer.sampleRate);
      if (performance.now() - sliceStart > DECODE_SLICE_MS) {
        await waitStudioIdle(signal);
        sliceStart = performance.now();
      }
    }
    return { mono, bpmTag: usableBpmTag(tags?.beatsPerMinute) };
  } finally {
    signal.removeEventListener('abort', dispose);
    input.dispose();
  }
}

/** 물러선 길 — 통째로 받아 낮은 표본율로 디코딩한다(이 판에서 조각으로 못 푸는 코덱만). */
async function decodeWhole(url: string, signal: AbortSignal): Promise<Float32Array | null> {
  signal.throwIfAborted();
  if (typeof OfflineAudioContext === 'undefined') return null;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const bytes = await res.arrayBuffer();
  signal.throwIfAborted();
  if (bytes.byteLength === 0) return null;
  // 문맥의 표본율로 다시 표본화해 준다(디코딩 결과는 문맥 표본율이다).
  const buffer = await new OfflineAudioContext(1, 1, BEAT_ANALYSIS_RATE).decodeAudioData(bytes);
  signal.throwIfAborted();
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c += 1) channels.push(buffer.getChannelData(c));
  return downmixToMono(channels);
}

async function measureBeats(project: string, asset: VideoAsset, signal: AbortSignal): Promise<BeatFacts | null> {
  signal.throwIfAborted();
  const url = assetUrl(project, assetPath(asset));
  const send = studioMediaFetch();
  const hash = stableHash(await assetFingerprint(url, (input, init) => send(input, { ...init, signal })));
  signal.throwIfAborted();
  const known = measured.get(hash);
  if (known) return known;
  let decoded: { mono: Float32Array; bpmTag: number | null } | null = null;
  try {
    decoded = await decodeMono(url, signal);
  } catch {
    signal.throwIfAborted();
    decoded = null; // 조각으로 못 풀었다 — 아래 물러선 길로.
  }
  if (!decoded) {
    const whole = await decodeWhole(url, signal);
    if (!whole) return null;
    decoded = { mono: whole, bpmTag: null };
  }
  signal.throwIfAborted();
  const range = bpmRangeFor(decoded.bpmTag);
  let result = analyzeBeats(decoded.mono, BEAT_ANALYSIS_RATE, range ?? {});
  // 태그가 틀렸을 수 있다(두 배·절반) — 좁힌 범위에서 못 찾으면 기본 범위로 한 번 더.
  if (range && result.bpm === 0) result = analyzeBeats(decoded.mono, BEAT_ANALYSIS_RATE);
  const facts: BeatFacts = { beats: result.beats, beatsStrong: result.strong, bpm: result.bpm, beatsHash: hash };
  measured.set(hash, facts);
  return facts;
}

function needsBeats(asset: VideoAsset): boolean {
  return asset.kind === 'audio' && asset.beatsHash === undefined && (asset.source.kind === 'file' || asset.source.kind === 'external');
}

export function useBeatAnalysis(project: string, doc: VideoDoc | null, onDoc: (doc: VideoDoc) => void): void {
  const onDocRef = useRef(onDoc);
  onDocRef.current = onDoc;
  const docId = doc?.id ?? '';
  const pendingKey = doc ? Object.values(doc.assets).filter(needsBeats).map((a) => a.id).sort().join('|') : '';
  const assetsRef = useRef<Readonly<Record<string, VideoAsset>>>({});
  assetsRef.current = doc?.assets ?? {};

  useEffect(() => {
    if (!project || docId === '' || pendingKey === '') return undefined;
    const abort = new AbortController();
    void (async () => {
      for (const assetId of pendingKey.split('|')) {
        if (abort.signal.aborted) return;
        const asset = assetsRef.current[assetId];
        if (!asset || !needsBeats(asset)) continue;
        const key = `${project}\u0000${docId}\u0000${assetId}`;
        const failed = failedAt.get(key);
        if (inFlight.has(key) || (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS)) continue;
        inFlight.add(key);
        try {
          // 40-10 ④ — 배경 줄: 재생·끌기·입력 중에는 쉬었다가 한가할 때 낮은 우선순위로.
          const facts = await runWhenIdle(() => measureBeats(project, asset, abort.signal), { signal: abort.signal });
          abort.signal.throwIfAborted();
          if (!facts) { failedAt.set(key, Date.now()); continue; }
          const next = await writeBeatFacts(project, docId, assetId, facts);
          if (!abort.signal.aborted) onDocRef.current(next);
        } catch {
          // 끊긴 것(문서를 갈아탐·창이 숨음)은 실패가 아니다 — 다음에 다시 잰다.
          if (!abort.signal.aborted) failedAt.set(key, Date.now());
        } finally {
          inFlight.delete(key);
        }
      }
    })();
    return () => abort.abort();
  }, [project, docId, pendingKey]);
}
