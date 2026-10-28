/** §5.4 #36 (H) ③ — 소리 노드 구슬 줄 = 문서의 원본 소리(`assets`). 묶인 문서(`ref`)가 있을 때만. REST 의 `project` 는 `VibisoundShell` 과 같은 프로젝트 루트 경로. */

import type { AudioDoc } from '@vibisual/audio';

import type { AppLinkedItem, AppLinkedItemsReader } from '../../apps/registry.js';
import { readSoundDoc } from './soundApi.js';

/** 문서 → 구슬 목록(순수). 원본 소리를 문서에 들어온 차례대로. */
export function soundDocLinkedItems(doc: AudioDoc): AppLinkedItem[] {
  return Object.values(doc.assets)
    .filter((a) => !!a && typeof a.id === 'string')
    .map((a) => ({
      id: `asset:${a.id}`,
      group: 'part' as const,
      kind: 'audio' as const,
      label: a.name !== '' ? a.name : a.id,
      ...(Number.isFinite(a.duration) && a.duration > 0 ? { durationSec: a.duration } : {}),
    }));
}

/** 레지스트리 `linkedItems` 가 부르는 읽기. 문서가 작아(JSON 한 벌) 판본 질문 없이 통째로 읽는다. */
export const readVibisoundLinkedItems: AppLinkedItemsReader = async (req) => {
  const docId = req.ref;
  if (docId === undefined || docId === '' || req.projectId === '') return null;
  const { doc } = await readSoundDoc(req.projectId, docId);
  return { key: `${doc.version}:${doc.updatedAt}`, items: soundDocLinkedItems(doc) };
};
