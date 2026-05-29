import { useEffect } from 'react';
import { useGraphStore } from '../stores/graphStore.js';

// SCENARIO.md §5.4 #14-1 (v2.29) — desktop main 의 windowManager 가 SSOT 로 들고 있는
// detached BrowserWindow 목록을 모든 윈도우(main + 별창들)의 graphStore.detachedTabKeys 로 sync.
//
// preload 의 'vibisual:detached:list' 푸시는:
//   - 새 별창 생성 직후 (broadcastList 호출)
//   - 별창 close (closed 이벤트)
//   - redock commit
//   - 첫 연결(ws-connect) 직후 (초기 동기화)
// 4가지 경로에서 발생. 그때마다 모든 창에 푸시되므로 메인/별창 양쪽이 같은 상태를 본다.
//
// dev/web 모드(window.api 없음)에선 no-op — detach 자체가 packaged Electron 한정 기능.

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
