import { useEffect } from 'react';
import { useGraphStore } from '../stores/graphStore.js';

// §5.5 #17-6 — desktop main windowManager 가 정본으로 든 오버레이 목록 + 전역 토글을 모든 창의 graphStore.overlayAgentIds / overlaysVisible 로 맞춘다('vibisual:overlay:list' 푸시). window.api.overlay 가 없으면 no-op.

export function useOverlaySync(): void {
  useEffect(() => {
    const overlay = typeof window !== 'undefined' ? window.api?.overlay : undefined;
    if (!overlay) return;
    // 초기 1회 명시 fetch — onList 리스너 부착 전에 push 가 오면 놓칠 수 있어 보강.
    void overlay.list().then((payload) => {
      useGraphStore.getState().applyOverlayList(payload);
    });
    const off = overlay.onList((payload) => {
      useGraphStore.getState().applyOverlayList(payload);
    });
    return () => { off(); };
  }, []);
}
