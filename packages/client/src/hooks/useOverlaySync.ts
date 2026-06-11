import { useEffect } from 'react';
import { useGraphStore } from '../stores/graphStore.js';

// SCENARIO.md §5.5 #17-6 (v2.73) — desktop main 의 windowManager 가 SSOT 로 들고 있는
// 오버레이 위젯 창 목록 + 전역 토글 상태를 모든 윈도우(main + 별창 + 오버레이)의
// graphStore.overlayAgentIds / overlaysVisible 로 sync.
//
// 'vibisual:overlay:list' 푸시는:
//   - 새 오버레이 생성/닫기
//   - 펼치기/접기(expanded 변경)
//   - 전역 토글(set-visible)
//   - 첫 연결(ws-connect) 직후
// 경로에서 발생, 그때마다 모든 창에 푸시되므로 메인/별창/오버레이가 같은 상태를 본다.
//
// dev/web 모드(window.api.overlay 없음)에선 no-op — 오버레이는 packaged Electron 한정.

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
