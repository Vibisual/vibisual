import { parseCreationBlobRef } from '@vibisual/shared';

import type { AppLinkedItem, AppLinkedItemsReader } from '../../apps/registry.js';
import type { ImageLayer } from '../Creation/imageSource.js';
import { imageCandidateSummaries, readImageDoc } from './imageApi.js';

/**
 * §5.4 #36 (H) ③ · §5.1 #2-1 (F) — Vibimage 노드 구슬 줄: 제안 대기(번호·점선 `proposed`) · 레이어(앞부터 — 그림 미리보기·글줄·도형, 숨긴 것은 뺀다).
 * 지난 결과는 코어가 붙인다(`pastFiles`). 문서를 못 읽으면 `null`(앞 결과 유지).
 */
const CREATION_BLOB_DIR = '.vibisual/creation/blobs';

function layerItem(layer: ImageLayer): AppLinkedItem {
  const blob = layer.kind === 'image' ? parseCreationBlobRef(layer.source) : null;
  const label = layer.name.trim() || (layer.kind === 'text' ? (layer.text ?? '').trim().slice(0, 40) : '') || layer.kind;
  return {
    id: `layer:${layer.id}`,
    group: 'part',
    kind: layer.kind === 'image' ? 'image' : layer.kind === 'text' ? 'text' : 'shape',
    label,
    ...(blob ? { file: `${CREATION_BLOB_DIR}/${blob.name}` } : {}),
  };
}

export const readVibimageLinkedItems: AppLinkedItemsReader = async ({ projectId, ref }) => {
  if (!ref) return null;
  const doc = await readImageDoc(projectId, ref);
  let pending: Awaited<ReturnType<typeof imageCandidateSummaries>> = [];
  try {
    pending = await imageCandidateSummaries(projectId, ref);
  } catch {
    pending = []; // 제안 목록을 못 읽어도 레이어는 보인다.
  }
  const candidates = [...pending].sort((a, b) => a.createdAt - b.createdAt).map((c, i): AppLinkedItem => ({
    id: `candidate:${c.id}`,
    group: 'scene',
    kind: 'image',
    label: c.label.trim() || c.input.trim().slice(0, 40),
    index: i + 1,
    numbered: 'proposal',
    stage: 'proposed',
  }));
  const layers = [...doc.payload.layers].reverse().filter((layer) => layer.visible).map(layerItem);
  return {
    key: JSON.stringify([doc.revision, pending.map((c) => c.id)]),
    items: [...candidates, ...layers],
  };
};
