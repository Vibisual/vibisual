/**
 * 선언 해시 (SCENARIO.md §5.13 (E) 부분 렌더).
 *
 * 아이템 하나가 "무엇을 그리는지"를 문자열 하나로 요약한다. 이 값이 그대로면 지난번
 * 렌더 결과를 다시 쓸 수 있고, 바뀌면 그 구간만 다시 그린다. 4분짜리 영상에서 자막
 * 한 줄을 고쳤는데 4분을 다시 기다리는 일을 없애는 장치다.
 *
 * 만족해야 하는 성질:
 *
 * - **결정적** — 같은 입력이면 언제 어느 기기에서 돌려도 같은 값. 그래서 키 순서에
 *   의존하지 않도록 직렬화 단계에서 정렬한다(`JSON.stringify` 는 삽입 순서를 따르므로
 *   그대로 쓰면 의미가 같은 두 객체가 다른 해시를 낸다).
 * - **소재 내용까지 반영** — 파일 경로만 같고 내용이 바뀐 경우에도 무효가 되어야 한다.
 *   그래서 참조하는 소재의 `contentHash` 를 함께 접는다.
 * - **충돌이 실질적으로 없어야** — 캐시 충돌은 "엉뚱한 프레임이 조용히 나오는" 형태로
 *   드러나서 가장 찾기 어렵다. 32비트는 아이템이 수천 개일 때 무시할 수 없는 확률이라
 *   서로 다른 두 해시를 이어 붙여 64비트로 쓴다.
 */

import type { VideoAsset, VideoItem } from './types.js';

/** 키를 정렬해 직렬화한다 — 의미가 같으면 문자열도 같도록. */
function stableStringify(value: unknown): string {
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

/**
 * 아이템의 렌더 캐시 키.
 *
 * `resolvedDuration` 을 함께 받는 이유는 애니메이션이 길이에 정규화되는 경우
 * (0%~100% 진행) 길이가 바뀌면 같은 지역 시각의 그림도 달라지기 때문이다.
 * 반면 **시작 시각은 넣지 않는다** — 아이템을 통째로 뒤로 미뤄도 그려지는 그림
 * 자체는 같으므로, 넣으면 재사용할 수 있는 캐시를 버리게 된다.
 */
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

/**
 * 문서 전체의 그림 해시.
 *
 * 아이템 해시를 모아 접되 **크기와 fps 도 포함**한다 — 해상도나 프레임률이 바뀌면
 * 모든 프레임이 달라지므로 캐시를 통째로 버려야 한다.
 */
export function hashDocShape(
  size: { readonly width: number; readonly height: number },
  fps: number,
  itemHashes: readonly string[],
): string {
  return stableHash(stableStringify({ size, fps, items: [...itemHashes].sort() }));
}
