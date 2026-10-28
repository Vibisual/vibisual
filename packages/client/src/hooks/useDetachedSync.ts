import { useEffect } from 'react';
import { useGraphStore } from '../stores/graphStore.js';

// §5.4 #14-1 — desktop main windowManager 가 정본으로 든 detached 창 목록을 모든 창의 graphStore.detachedTabKeys 로 맞춘다('vibisual:detached:list' 푸시). window.api 가 없으면 no-op.

export function useDetachedSync(): void {
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!api?.window) return;
    // 초기 1회 명시 fetch — onDetachedList 리스너가 부착되기 전에 push 가 오면 놓칠 수 있어 보강.
    void api.window.listDetached().then((list) => {
      useGraphStore.getState().applyDetachedList(list);
    });
    const off = api.window.onDetachedList((list) => {
      useGraphStore.getState().applyDetachedList(list);
    });
    return () => { off(); };
  }, []);
}
