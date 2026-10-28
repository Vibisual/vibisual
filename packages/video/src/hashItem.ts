/**
 * §5.13 (E) 부분 렌더의 선언 해시 — 그대로면 지난 렌더를 다시 쓴다. 결정적이어야 한다: 키를 정렬해 직렬화한다(`JSON.stringify` 는 삽입 순서).
 * 참조 소재의 `contentHash` 를 접는다(경로가 같아도 내용이 바뀌면 무효). 32비트는 수천 아이템에서 충돌을 무시 못 해 두 해시를 이어 64비트(충돌 = 엉뚱한 프레임이 조용히).
 */

import type { VideoAsset, VideoItem } from './types.js';

/** 키를 정렬해 직렬화한다 — 의미가 같으면 문자열도 같도록. */
export function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  const t = typeof value;
  if (t === 'number') return Number.isFinite(value as number) ? String(value) : 'NaN';
  if (t === 'boolean' || t === 'bigint') return String(value);
  if (t === 'string') return JSON.stringify(value);
  if (t === 'function' || t === 'symbol') return '"[unserializable]"';

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const v = obj[key];
    if (v === undefined) continue; // 없는 것과 undefined 를 같게 본다.
    parts.push(`${JSON.stringify(key)}:${stableStringify(v)}`);
  }
  return `{${parts.join(',')}}`;
}

/** FNV-1a 계열 32비트 해시. offset basis 를 달리해 독립적인 두 값을 얻는다. */
function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // 32비트 곱셈을 오버플로 없이 — Math.imul 이 정확히 그 일을 한다.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** 문자열 → 16자리 16진수(64비트). */
export function stableHash(input: string): string {
  const a = fnv1a(input, 0x811c9dc5);
  const b = fnv1a(input, 0x9e3779b9);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** `resolvedDuration` 을 넣는다(길이에 정규화된 애니메이션은 길이가 바뀌면 그림도 바뀐다). 시작 시각은 넣지 않는다 — 통째로 미뤄도 그림은 같다. */
export function hashItem(
  item: VideoItem,
  assets: Readonly<Record<string, VideoAsset>>,
  resolvedDuration: number,
): string {
  const asset = item.assetId === undefined ? undefined : assets[item.assetId];

  const shape = {
    kind: item.kind,
    sceneId: item.sceneId,
    props: item.props,
    transform: item.transform,
    // §5.13 (W) 38-4 — 상자의 시간 곡선도 그림을 바꾼다.
    keyframes: item.keyframes,
    effects: item.effects,
    cues: item.cues,
    trimStart: item.trimStart,
    duration: Number(resolvedDuration.toFixed(6)),
    // 소재는 신원(경로·내용)만 접는다. 길이는 이미 resolvedDuration 에 반영돼 있다.
    asset: asset
      ? {
          kind: asset.kind,
          source: asset.source,
          contentHash: asset.contentHash,
          width: asset.width,
          height: asset.height,
        }
      : undefined,
  };

  return stableHash(stableStringify(shape));
}

/** 크기와 fps 도 넣는다(바뀌면 캐시를 통째로 버려야 한다). */
export function hashDocShape(
  size: { readonly width: number; readonly height: number },
  fps: number,
  itemHashes: readonly string[],
): string {
  return stableHash(stableStringify({ size, fps, items: [...itemHashes].sort() }));
}
