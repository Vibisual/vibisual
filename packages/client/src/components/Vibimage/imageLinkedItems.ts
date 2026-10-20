import { parseCreationBlobRef } from '@vibisual/shared';

import type { AppLinkedItem, AppLinkedItemsReader } from '../../apps/registry.js';
import type { ImageLayer } from '../Creation/imageSource.js';
import { imageCandidateSummaries, readImageDoc } from './imageApi.js';

/**
 * §5.4 #36 (H) ③ · §5.1 #2-1 (F) 앱별 — Vibimage 노드 아래 **구슬 줄**(종전에는 선언이 없어 비어 있었다).
 *
 * - **제안 대기**(에이전트가 낸 아직 고르지 않은 판) — 번호 구슬, 점선 테(`proposed`). 고르는 곳은 편집기다.
 * - **레이어**(앞에 그려지는 것부터) — 그림 레이어는 구슬 안 미리보기(그 그림의 바이트는 `.vibisual/creation/blobs/` 에 산다),
 *   글은 글줄 · 도형은 도형 글리프. 숨긴 레이어는 뺀다(화면에 없는 것을 버블로 말하지 않는다).
 * - **지난 결과**는 코어가 붙인다(노드의 `pastFiles`).
 *
 * 문서가 없거나 못 읽으면 `null`(그 회차는 앞 결과를 그대로 둔다).
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
