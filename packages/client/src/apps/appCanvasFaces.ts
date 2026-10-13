import { useCallback, useSyncExternalStore } from 'react';

import { getInternalApp, type AppCanvasFace } from './registry.js';

/**
 * §5.4 #36 (G) — 앱 위성 화면의 안쪽 그림(`canvasFace`)을 **늦게 불러 기억하는** 자리.
 *
 * 코어는 앱 이름을 모른다(§5.13 (P-4)) — `appId` 로 레지스트리 선언의 늦은 로더를 부를 뿐이다. 앱마다 한 번만 부르고
 * (그 앱의 화면이 처음 보일 때), 불러온 컴포넌트는 모듈에 남아 화면 밖에서 돌아온 노드도 바로 그린다.
 * 불러오는 동안·선언이 없는 앱·불러오기에 실패한 앱은 `null` — 노드는 정지 미리보기로 대신한다(실패를 다시 조르지 않는다).
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
