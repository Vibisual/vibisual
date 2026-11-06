import { useCallback } from 'react';
import { APP_BUBBLE_PENDING_MS } from '@vibisual/shared';

import { useGraphStore } from '../stores/graphStore.js';
import { getInternalApp } from './registry.js';
import { appNodeForm, normalizeStageAspect, sameStageAspect, stageAspectMove } from './appNodeForm.js';

/**
 * §5.4 #36 (J) ① — 앱 화면이 알린 결과 칸 비율을 노드에 적는다. 코어는 앱 이름을 모르고 비율 하나만 본다 — 저장값과 다를 때만
 * 한 번 PATCH 하고 가운데를 지킨다(`stageAspectMove`).
 */

interface Sent {
  readonly aspect: number | null;
  readonly at: number;
}

/** 노드 id → 마지막으로 보낸 비율. PATCH 전에 떠난 스냅샷이 칸을 되돌려 와도 같은 값을 `APP_BUBBLE_PENDING_MS` 안에 다시 보내지 않는다. */
const sent = new Map<string, Sent>();
const SENT_MAX = 256;

/** 보낼 값(지울 때 `null`) — 보낼 것이 없으면 `undefined`. */
export function stageAspectToSend(
  stored: number | undefined,
  reported: number | null,
  last: Sent | undefined,
  now: number,
): number | null | undefined {
  const next = reported === null ? null : normalizeStageAspect(reported);
  if (reported !== null && next === null) return undefined;
  if (sameStageAspect(stored, next)) return undefined;
  if (last && sameStageAspect(last.aspect, next) && now - last.at < APP_BUBBLE_PENDING_MS) return undefined;
  return next;
}

function remember(id: string, aspect: number | null, at: number): void {
  sent.delete(id);
  sent.set(id, { aspect, at });
  while (sent.size > SENT_MAX) {
    const oldest = sent.keys().next().value;
    if (oldest === undefined) break;
    sent.delete(oldest);
  }
}

/** 그 노드의 앱 화면에 넘길 `onStageAspect`. 끄는 중(크기 조절·옮기기)이면 건너뛴다 — 앱 화면은 다음 갱신에 다시 알린다. */
export function useStageAspectReporter(bubbleId: string): (aspect: number | null) => void {
  return useCallback((aspect: number | null): void => {
    const store = useGraphStore.getState();
    if (store.draggingAppBubbleIds.includes(bubbleId)) return;
    const bubble = store.appBubbles.find((b) => b.id === bubbleId);
    if (!bubble || appNodeForm(bubble) !== 'screen') return;
    const now = Date.now();
    const next = stageAspectToSend(bubble.stageAspect, aspect, sent.get(bubbleId), now);
    if (next === undefined) return;
    remember(bubbleId, next, now);
    store.setAppBubbleStageAspect(bubbleId, next, stageAspectMove(getInternalApp(bubble.appId), bubble, next));
  }, [bubbleId]);
}
