/**
 * §5.13 (R-3) — 영상 파일 하나 → `footage` 아이템 하나짜리 문서의 편집 연산(순수 — 낙관적 잠금·검증이 평소 경로로 걸린다).
 * "손대지 않은 문서"는 아이템 수로 판정한다(새 문서도 빈 트랙 셋이 있어 트랙 수로 보면 영상이 영영 안 실린다).
 * `duration:'auto'` 는 실측 길이가 있어야 풀리므로(`auto-without-duration`) 실측값을 소재에 적고 판형도 영상 크기로 맞춘다.
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
  readonly hasAudio?: boolean;
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
    ...(asset.hasAudio === undefined && typeof m.hasAudio === 'boolean' ? { hasAudio: m.hasAudio } : {}),
  };
}

/** 길이를 못 쟀으면 빈 배열 — 풀리지 않을 `'auto'` 아이템을 얹으면 "편집된 문서"가 되어 다음 클릭이 다시 재지 않는다. */
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

/** Measure missing duration and detect embedded audio on older video assets. */
export function assetsNeedingMeasurement(doc: VideoDoc): VideoAsset[] {
  return Object.values(doc.assets).filter(
    (asset) => (asset.kind === 'video' && (asset.duration === undefined || asset.hasAudio === undefined)) ||
      (asset.kind === 'audio' && asset.duration === undefined),
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
    if (next.duration === asset.duration && next.width === asset.width && next.height === asset.height && next.hasAudio === asset.hasAudio) continue;
    ops.push({ op: 'setAsset', asset: next });
  }
  return ops;
}
