/**
 * §5.13 (T-3) — 컴포지션 문서 주소 `…/api/app/vibistudio/content/<프로젝트>/<문서 id>/<프로젝트 기준 경로>?item=<아이템 id>&v=<판>`.
 * 패키지 앱은 `file://` 라 `vibproxy://proxy` 를 붙인다(코어 허용 목록이 앱 이름 없이 이 모양을 받는다). 경로는 세그먼트마다 인코딩(안의 상대 주소가 풀리게).
 * `v` = 코드 지문 + 시드·스타일(+ 반응형 상자) — props 는 넣지 않는다(편집마다 프레임이 다시 뜨지 않게).
 */

import { stableHash, type VideoAsset, type VideoDoc } from '@vibisual/video';
import type { DrawOp } from '@vibisual/video/render';

import { isPackagedDesktop } from '../../transport/index.js';

const CONTENT_BASE = '/api/app/vibistudio/content';

export function compositionContentPath(project: string, docId: string, assetPath: string): string {
  const rel = assetPath.replace(/\\/g, '/').split('/').filter((seg) => seg !== '').map(encodeURIComponent).join('/');
  return `${CONTENT_BASE}/${encodeURIComponent(project)}/${encodeURIComponent(docId)}/${rel}`;
}

/** 무대의 `compositionSrc`. §5.13 (V) 37-3 — `revId` 면 그 판 주소(`<docId>@<revId>`). 37-10 — 스타일도 `v` 에 접는다. */
export function makeCompositionSrc(project: string, doc: Pick<VideoDoc, 'id' | 'seed' | 'style'>, revId?: string): (op: DrawOp, asset: VideoAsset | undefined) => string | null {
  const docKey = revId ? `${doc.id}@${revId}` : doc.id;
  return (op, asset) => {
    if (!asset) return null;
    // §5.13 (V) 37-5 — props 는 판(`v`)에 넣지 않는다: 값이 바뀌면 무대가 프레임을 다시 열지 않고 `props` 데이터 메시지로
    //   바로 맞춘다(묶인 곳이 없는 컴포지션만 무대가 새 값을 실어 다시 연다 — `HtmlSceneStage`). 반응형 컴포지션은 상자 크기도 판이다.
    const box = asset.responsive === true ? { width: op.transform.width, height: op.transform.height } : null;
    return compositionAssetSrc(project, doc, asset, op.resolved.item.id, box, docKey);
  };
}

/**
 * 아이템 그리기 목록 없이 소재 하나의 주소(§5.13 (T-8) 표지 모으기 — 그 소재를 쓰는 첫 아이템의 값으로 연다). `box` 는 반응형
 * 컴포지션이 받을 상자 크기(없으면 선언 크기).
 */
export function compositionAssetSrc(
  project: string,
  doc: Pick<VideoDoc, 'id' | 'seed' | 'style'>,
  asset: VideoAsset,
  itemId: string,
  box: { width: number; height: number } | null = null,
  docKey: string = doc.id,
): string | null {
  if (asset.kind !== 'composition' || asset.source.kind !== 'file') return null;
  const boxKey = asset.responsive === true && box ? [box.width, box.height] : [];
  const version = stableHash(JSON.stringify([asset.contentHash ?? '', doc.seed ?? 0, asset.width ?? 0, asset.height ?? 0, doc.style ?? null, boxKey]));
  // §5.13 (V) 37-15 — 반응형이면 상자 크기를 실어 보낸다(심이 선언 크기 대신 그 크기를 준다).
  const boxQuery = boxKey.length === 2 ? `&bw=${Math.round(boxKey[0] ?? 0)}&bh=${Math.round(boxKey[1] ?? 0)}` : '';
  const path = `${compositionContentPath(project, docKey, asset.source.path)}?item=${encodeURIComponent(itemId)}&v=${version}${boxQuery}`;
  return isPackagedDesktop() ? `vibproxy://proxy${path}` : path;
}
