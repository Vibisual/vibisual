import { useEffect, useRef } from 'react';
import { analyzeBeats, downmixToMono, stableHash, type VideoAsset, type VideoDoc } from '@vibisual/video';

import { makeAudioLoader } from './useVideoRenderer.js';
import { writeBeatFacts } from './videoApi.js';

/**
 * §5.13 (V) 37-12 — 음악을 넣으면 비트를 잰다. 아직 안 잰(`beatsHash` 가 없는) 소리 소재를 이 창에서 한 번 디코딩해(22.05kHz
 * 한 갈래) 순수 함수 `analyzeBeats` 로 재고, 서버가 최신 문서에 그 칸만 얹게 한다(되돌리기 이력 밖 — 길이 실측과 같은 성격).
 * 내레이션처럼 주기가 약하면 빈 비트를 적는다 — 다시 재지 않게. 같은 내용(바이트 지문)이면 다른 문서에서도 다시 디코딩하지 않는다.
 */

const ANALYSIS_RATE = 22_050;
/** 실패한 소재를 다시 시도하지 않는 동안(ms). */
const RETRY_AFTER_MS = 5 * 60_000;

interface BeatFacts {
  readonly beats: number[];
  readonly beatsStrong: number[];
  readonly bpm: number;
  readonly beatsHash: string;
}

/** 바이트 지문 → 잰 결과(이 창이 사는 동안). */
const measured = new Map<string, BeatFacts>();
const inFlight = new Set<string>();
const failedAt = new Map<string, number>();

/** 바이트 지문 — 길이 + 앞·가운데·끝 조각(통째로 해시하지 않는다 — 수십 MB 음악). */
function bytesFingerprint(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  const take = (from: number): string => Array.from(view.subarray(from, Math.min(view.length, from + 4096)), (b) => b.toString(16)).join('');
  const middle = Math.max(0, Math.floor(view.length / 2) - 2048);
  return stableHash(`${view.length}:${take(0)}:${take(middle)}:${take(Math.max(0, view.length - 4096))}`);
}

async function measureBeats(project: string, asset: VideoAsset): Promise<BeatFacts | null> {
  const bytes = await makeAudioLoader(project).fetchBytes(asset);
  if (!bytes || bytes.byteLength === 0) return null;
  const hash = bytesFingerprint(bytes);
  const known = measured.get(hash);
  if (known) return known;
  if (typeof OfflineAudioContext === 'undefined') return null;
  // 문맥의 표본율로 다시 표본화해 준다(디코딩 결과는 문맥 표본율이다).
  const ctx = new OfflineAudioContext(1, 1, ANALYSIS_RATE);
  const buffer = await ctx.decodeAudioData(bytes);
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c += 1) channels.push(buffer.getChannelData(c));
  const result = analyzeBeats(downmixToMono(channels), buffer.sampleRate);
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
    if (!project || docId === '' || pendingKey === '') return;
    let alive = true;
    void (async () => {
      for (const assetId of pendingKey.split('|')) {
        const asset = assetsRef.current[assetId];
        if (!asset || !needsBeats(asset)) continue;
        const key = `${project}\u0000${docId}\u0000${assetId}`;
        const failed = failedAt.get(key);
        if (inFlight.has(key) || (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS)) continue;
        inFlight.add(key);
        try {
          const facts = await measureBeats(project, asset);
          if (!facts) { failedAt.set(key, Date.now()); continue; }
          const next = await writeBeatFacts(project, docId, assetId, facts);
          if (alive) onDocRef.current(next);
        } catch {
          failedAt.set(key, Date.now());
        } finally {
          inFlight.delete(key);
        }
      }
    })();
    return () => { alive = false; };
  }, [project, docId, pendingKey]);
}
