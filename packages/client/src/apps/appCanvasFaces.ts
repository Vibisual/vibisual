import { useCallback, useSyncExternalStore } from 'react';

import { getInternalApp, type AppCanvasFace } from './registry.js';

/**
 * §5.4 #36 (G) — 앱 위성 안쪽 그림(`canvasFace`)을 앱마다 한 번 늦게 불러 모듈에 기억한다(화면 밖에서 돌아온 노드도 바로 그린다).
 * 불러오는 중·선언 없음·실패는 `null` — 정지 미리보기로 대신하고 다시 조르지 않는다.
 */

type Slot = { readonly status: 'loading' } | { readonly status: 'ready'; readonly face: AppCanvasFace | null };

const slots = new Map<string, Slot>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function ensure(appId: string): void {
  if (slots.has(appId)) return;
  const loader = getInternalApp(appId)?.canvasFace;
  if (!loader) {
    slots.set(appId, { status: 'ready', face: null });
    return;
  }
  slots.set(appId, { status: 'loading' });
  void loader().then(
    (face) => {
      slots.set(appId, { status: 'ready', face });
      notify();
    },
    () => {
      slots.set(appId, { status: 'ready', face: null });
      notify();
    },
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 그 앱의 화면 안쪽 그림. `appId` 가 `null` 이면(담긴 결과가 없으면) 부르지 않는다. */
export function useAppCanvasFace(appId: string | null): AppCanvasFace | null {
  const getSnapshot = useCallback((): AppCanvasFace | null => {
    if (appId === null) return null;
    const slot = slots.get(appId);
    return slot?.status === 'ready' ? slot.face : null;
  }, [appId]);
  const subscribeAndLoad = useCallback(
    (listener: () => void): (() => void) => {
      const off = subscribe(listener);
      if (appId !== null) ensure(appId);
      return off;
    },
    [appId],
  );
  return useSyncExternalStore(subscribeAndLoad, getSnapshot);
}
