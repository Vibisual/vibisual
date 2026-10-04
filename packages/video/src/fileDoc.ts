/**
 * 파일 한 개 → 문서 (SCENARIO.md §5.13 (R-3)).
 *
 * IDE 에서 영상 파일을 눌러 스튜디오가 열리면, 그 파일은 `footage` 아이템 한 개짜리
 * 문서가 된다. 이 파일은 그 문서를 채울 §5.13 (G) 편집 연산만 만드는 순수 함수다 —
 * 문서를 직접 쓰지 않으므로 낙관적 잠금·검증이 평소 경로 그대로 걸린다(`storyboard.ts` 와 같은 판단).
 *
 * 지키는 것 둘:
 *
 * 1. **"손대지 않은 문서"는 트랙 수가 아니라 아이템 수로 판정한다.** 새 문서는 빈 트랙
 *    셋(visual·audio·caption)을 달고 태어난다(`createEmptyDoc`). 트랙 수로 판정하면 새 문서도
 *    "이미 편집된 문서"로 읽혀 영상이 영영 실리지 않는다 — 실제로 그래서 화면이 비어 있었다.
 * 2. **`duration:'auto'` 는 실측 길이가 있어야 풀린다.** 소재에 길이를 적지 않고 아이템만
 *    얹으면 해소기가 그 아이템을 빼 버린다(`auto-without-duration`). 그래서 실측값을
 *    받아 소재에 함께 적고, 문서 판형도 그 영상의 크기로 맞춘다.
 */

import type { VideoAsset, VideoDoc, VideoDocOp } from './types.js';

/** 파일로 연 문서에서 그 파일을 가리키는 소재·아이템 id. 경로가 아니라 고정 id 다(§5.13 (D)). */
export const FILE_DOC_ASSET_ID = 'src';
export const FILE_DOC_ITEM_ID = 'clip1';

/** 파일을 실제로 읽어 잰 값. 못 잰 축은 null. */
export interface MediaMeasurement {
  readonly duration: number | null;
  readonly width: number | null;
  readonly height: number | null;
}

/** 아이템이 하나도 없는 문서 — 사람도 에이전트도 아직 손대지 않았다. */
export function isUntouchedDoc(doc: VideoDoc): boolean {
  return doc.tracks.every((track) => track.items.length === 0);
}

/**
 * 판형 한 변. H.264 인코더는 4:2:0 이라 홀수 변을 받지 않으므로 짝수로 내린다.
 * 원본보다 커지지 않게 내림으로 맞춘다(늘리면 가장자리 한 줄이 비어 보인다).
 */
export function evenSide(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2);
}

function positive(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** 잰 값을 소재에 덧입힌다. 이미 적힌 값은 덮지 않는다(사람·에이전트가 고친 값이 이긴다). */
function withMeasurement(asset: VideoAsset, m: MediaMeasurement): VideoAsset {
  return {
    ...asset,
    ...(asset.duration === undefined && positive(m.duration) ? { duration: m.duration } : {}),
    ...(asset.width === undefined && positive(m.width) ? { width: m.width } : {}),
    ...(asset.height === undefined && positive(m.height) ? { height: m.height } : {}),
  };
}

/**
 * 손대지 않은 문서에 그 영상 파일을 담는 연산.
 *
 * 길이를 못 쟀으면 빈 배열이다 — 풀리지 않을 `'auto'` 아이템을 얹어 두면 문서가 "편집된
 * 문서"가 되어 다음에 다시 눌러도 재지 않게 된다. 비워 두면 다음 클릭이 다시 시도한다.
 */
export function buildFileDocOps(
  doc: VideoDoc,
  file: { readonly path: string; readonly label: string },
  measured: MediaMeasurement,
): VideoDocOp[] {
  if (!positive(measured.duration)) return [];

  const asset = withMeasurement(
    { id: FILE_DOC_ASSET_ID, kind: 'video', source: { kind: 'file', path: file.path } },
    measured,
  );
  const ops: VideoDocOp[] = [{ op: 'setAsset', asset }];

  if (positive(measured.width) && positive(measured.height)) {
    ops.push({ op: 'setDoc', patch: { size: { width: evenSide(measured.width), height: evenSide(measured.height) } } });
  }

  // 새 문서가 이미 가진 visual 트랙에 얹는다. 없을 때만 만든다(트랙이 둘로 갈리지 않게).
  const item = {
    id: FILE_DOC_ITEM_ID,
    kind: 'footage' as const,
    at: 0,
    // 길이는 'auto' — 소재의 실측 길이가 곧 클립 길이다(§5.13 (D) "오디오가 시간의 주인").
    duration: 'auto' as const,
    assetId: FILE_DOC_ASSET_ID,
    label: file.label,
  };
  const visual = doc.tracks.find((track) => track.kind === 'visual');
  if (visual) {
    ops.push({ op: 'addItem', trackId: visual.id, item });
  } else {
    ops.push({ op: 'addTrack', track: { id: 'visual', kind: 'visual', label: file.label, items: [item] } });
  }
  return ops;
}

/** 길이를 재야 `'auto'` 가 풀리는 소재 — 영상·소리 중 길이가 비어 있는 것. */
export function assetsNeedingMeasurement(doc: VideoDoc): VideoAsset[] {
  return Object.values(doc.assets).filter(
    (asset) => (asset.kind === 'video' || asset.kind === 'audio') && asset.duration === undefined,
  );
}

/**
 * 잰 값을 문서 소재에 적는 연산. 에이전트가 길이 없이 `'auto'` 로 쓴 문서도 이걸로 풀린다.
 * 새로 알게 된 값이 없으면 빈 배열이다(버전만 올리는 헛패치를 만들지 않는다).
 */
export function buildMeasurementOps(
  doc: VideoDoc,
  measured: Readonly<Record<string, MediaMeasurement>>,
): VideoDocOp[] {
  const ops: VideoDocOp[] = [];
  for (const asset of assetsNeedingMeasurement(doc)) {
    const m = measured[asset.id];
    if (!m) continue;
    const next = withMeasurement(asset, m);
    if (next.duration === undefined) continue;
    ops.push({ op: 'setAsset', asset: next });
  }
  return ops;
}
