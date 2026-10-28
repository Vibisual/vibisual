import { ByteBudgetCache } from '@vibisual/shared';
import type { VideoAsset } from '@vibisual/video';
import { boundedRangeFetch, setFootageReaderLimit, type AudioBytesLoader, type AudioChunk, type MediabunnyMediaProvider } from '@vibisual/video/render';

import { assetUrl, isStreamingAssetUrl } from './assetUrl.js';
import { studioBudget, urlCacheBytesFor } from './studioBudget.js';
import { VideoMediaProvider } from './videoMediaProvider.js';

/**
 * §5.13 (Y) 40-1 · 40-2 · 40-11 — 스튜디오가 소재 공급자를 만드는 한 곳과 소리 조각 기억.
 * - 모든 Mediabunny 공급자(미리보기·스틸·검수·렌더·`measureAssets`·소리)는 여기서 선다. 패키지 앱 소재 주소는 스트리밍(`vibproxy://`)이라
 *   끝이 열린 구간을 끊으면 멈춘다. IPC 로 떨어지는 주소(상대 `/api…`)는 구간을 묶어 보낸다(`boundedRangeFetch`) — 응답을 통째로 싣는 IPC 로 파일 끝까지 건너오지 않게(시험이 생성 자리를 지킨다).
 * - 소리 조각은 소재 지문(ETag = 크기 + 수정 시각) + 조각 번호 열쇠의 바이트 예산 LRU 에 둔다(판이 바뀌어도 다시 풀지 않는다).
 */

/** IPC 로 떨어지는 주소에서 한 번에 청할 구간(바이트). 조각마다 메인을 거치므로 너무 잘게 쪼개지 않는다. */
export const STUDIO_IPC_RANGE_CHUNK_BYTES = 4 * 1024 * 1024;
/** 소리를 푸는 조각 길이(초) — 짧은 효과음은 제 길이만, 긴 음악은 쓰는 조각만. */
export const AUDIO_DECODE_CHUNK_S = 8;
/** 소재 지문을 다시 묻지 않는 동안(ms) — 한 번 섞는 사이 같은 파일을 여러 번 HEAD 하지 않게. */
const FINGERPRINT_TTL_MS = 5_000;

/** 소재 파일 경로(외부 명령으로 만드는 소재는 결과 파일 — 여기서 명령을 실행하지 않는다, §5.13 (H)). */
export function assetPath(asset: VideoAsset): string {
  return asset.source.kind === 'file' ? asset.source.path : asset.source.output;
}

/** 주소마다 고른다 — 스트리밍이면 그대로, IPC 로 떨어지면 구간을 묶어 보낸다. */
export function studioMediaFetch(base?: typeof fetch): typeof fetch {
  const bounded = boundedRangeFetch(STUDIO_IPC_RANGE_CHUNK_BYTES, base);
  const send = base ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  return ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return isStreamingAssetUrl(url) ? send(input, init) : bounded(input, init);
  }) as typeof fetch;
}

export interface StudioMediaOptions {
  /** 썸네일·스틸·렌더 — 하드웨어 디코더 칸을 비워 둔다(재생이 쓰게, 40-3 ⑦). */
  readonly decoderPreference?: 'prefer-software';
}

/** 스튜디오의 소재 공급자 — 이 함수로만 만든다(구간 안전망 · 예산을 빠뜨리지 않게). */
export function createStudioMedia(project: string, assets: Readonly<Record<string, VideoAsset>>, opts: StudioMediaOptions = {}): VideoMediaProvider {
  const budget = studioBudget();
  setFootageReaderLimit(budget.footageReaders);
  return new VideoMediaProvider({
    assets,
    loader: { open: async (asset) => assetUrl(project, assetPath(asset)) },
    fetchFn: studioMediaFetch(),
    // §5.13 (Z) 41-4 — 재생 중 실사를 `<video>` 로 흘려 틀 수 있는 주소(구간을 끊을 수 있는 진짜 스트림)만 내준다.
    streamable: isStreamingAssetUrl,
    urlCacheBytes: urlCacheBytesFor(budget, Object.keys(assets).length),
    previewWidthMax: budget.footageWidthMax,
    posterCacheBytes: budget.footagePosterBytes,
    ...(opts.decoderPreference ? { decoderPreference: opts.decoderPreference } : {}),
  });
}

// ─── 소리 조각 기억(창마다 한 벌) ───

const chunkCache = new ByteBudgetCache<string, AudioChunk>({
  name: 'vibistudio.audioChunks',
  maxBytes: studioBudget().audioChunkBytes,
  sizeOf: (chunk) => chunk.buffer.length * chunk.buffer.numberOfChannels * 4 + 64,
});
const wholeCache = new ByteBudgetCache<string, AudioBuffer>({
  name: 'vibistudio.audioWhole',
  maxBytes: studioBudget().audioChunkBytes,
  sizeOf: (buffer) => buffer.length * buffer.numberOfChannels * 4 + 64,
});
const inflight = new Map<string, Promise<AudioChunk | null>>();
const fingerprints = new Map<string, { value: string; at: number }>();

/** 소재 지문 — 응답의 ETag(크기 + 수정 시각). 못 물으면 주소 자체(같은 경로를 덮어쓰면 놓친다 — 그때만). */
export async function assetFingerprint(url: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const known = fingerprints.get(url);
  if (known && Date.now() - known.at < FINGERPRINT_TTL_MS) return known.value;
  let value = url;
  try {
    const res = await fetchFn(url, { method: 'HEAD' });
    const tag = res.headers.get('etag') ?? '';
    const length = res.headers.get('content-length') ?? '';
    const modified = res.headers.get('last-modified') ?? '';
    if (res.ok && (tag || length)) value = `${url}\u0000${tag}\u0000${length}\u0000${modified}`;
  } catch { /* 지문 없이 주소로 */ }
  fingerprints.set(url, { value, at: Date.now() });
  return value;
}

/**
 * 믹서(`mixAudio`)에 줄 소리 받개 — 쓰는 구간의 조각만 공급자가 풀고(파일 통째 디코딩 ❌), 조각은 소재 지문 열쇠로 기억한다.
 * 공급자가 없거나 조각을 못 풀면(코덱) 통째 디코딩으로 물러서고, 그것도 지문 열쇠로 기억한다.
 */
export function studioAudioLoader(project: string, media: MediabunnyMediaProvider | null): AudioBytesLoader {
  const wholeKey = (asset: VideoAsset): string => `${project}\u0000${assetPath(asset)}\u0000${asset.contentHash ?? ''}`;
  return {
    async fetchBytes(asset) {
      const res = await fetch(assetUrl(project, assetPath(asset)));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    },
    ...(media ? {
      async loadRange(asset: VideoAsset, from: number, to: number, signal?: AbortSignal): Promise<readonly AudioChunk[] | null> {
        const fingerprint = await assetFingerprint(assetUrl(project, assetPath(asset)));
        const first = Math.max(0, Math.floor(from / AUDIO_DECODE_CHUNK_S));
        const last = Math.max(first, Math.floor(Math.max(from, to - 1e-6) / AUDIO_DECODE_CHUNK_S));
        const out: AudioChunk[] = [];
        for (let index = first; index <= last; index += 1) {
          signal?.throwIfAborted();
          const key = `${fingerprint}\u0000${index}\u0000${AUDIO_DECODE_CHUNK_S}`;
          let chunk: AudioChunk | null | undefined = chunkCache.get(key);
          if (!chunk) {
            let pending = inflight.get(key);
            if (!pending) {
              pending = media.getAudioChunk(asset.id, index, AUDIO_DECODE_CHUNK_S);
              inflight.set(key, pending);
              void pending.then(() => inflight.delete(key), () => inflight.delete(key));
            }
            chunk = await pending;
            if (chunk === null) return null; // 이 판에서 못 푸는 소리 — 통째 디코딩으로 물러선다.
            chunkCache.set(key, chunk);
          }
          out.push(chunk);
        }
        return out;
      },
    } : {}),
    wholeCache: {
      get: (asset) => wholeCache.get(wholeKey(asset)),
      set: (asset, buffer) => wholeCache.set(wholeKey(asset), buffer),
    },
  };
}

/** §5.13 (X) 39-8 · (Y) 40-11 — 숨으면 소리 조각 기억부터 내려놓는다(다시 보이면 쓰는 구간만 다시 푼다). */
export function releaseStudioAudioMemory(): void {
  chunkCache.clear();
  wholeCache.clear();
  fingerprints.clear();
}

let audioMemoryHolders = 0;

/**
 * §5.13 (X) 39-8 · (Y) 40-11 — 이 창에서 소리 조각 기억을 쓰는 스튜디오 하나가 붙든다. 돌려받은 함수로 놓고, **모두** 놓으면(숨은 채
 * 오래 지나 무대를 내려놓은 때) 조각 기억을 비운다 — 같은 창의 다른 스튜디오가 쓰는 동안에는 비우지 않는다.
 */
export function retainStudioAudioMemory(): () => void {
  audioMemoryHolders += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    audioMemoryHolders = Math.max(0, audioMemoryHolders - 1);
    if (audioMemoryHolders === 0) releaseStudioAudioMemory();
  };
}

/** 지금 기억한 소리 조각(바이트) — 계측 한 줄용. */
export function studioAudioMemoryBytes(): number {
  return chunkCache.currentBytes() + wholeCache.currentBytes();
}
