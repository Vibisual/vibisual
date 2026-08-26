import { useEffect } from 'react';
import { useGraphStore } from '../stores/graphStore.js';

// SCENARIO.md §5.5 #17-6 (G) v2.82 — 메인 윈도우 한정.
//
// 오버레이 버블의 우클릭 "본체에서 이 버블로 점프" 가 main 프로세스를 거쳐
// `vibisual:overlay:reveal` 를 메인 윈도우 렌더러로 보낸다. 그 신호를 받아 §5.4 #30 버블 북마크
// 점프와 동형으로 캔버스의 그 버블을 보여준다: 프로젝트 전환 → 직전 IDE 닫기 → 노드 포커싱+선택.
//
// 메인 윈도우(App)에서만 사용 — 오버레이 창은 OverlayShell 을 렌더하므로 이 훅을 부르지 않는다.
// dev/web 모드(window.api.overlay 없음)에선 no-op.

export function useOverlayReveal(): void {
  useEffect(() => {
    const overlay = typeof window !== 'undefined' ? window.api?.overlay : undefined;
    if (!overlay?.onReveal) return;
    const off = overlay.onReveal(({ agentId, projectId, openIde }) => {
      const store = useGraphStore.getState();
      const known = !!store.projects[projectId] || !!store.stubProjects[projectId];
      if (known) store.setActiveProject(projectId);
      if (openIde) {
        // (판올림 번호 발급 대기) 밖으로 끌어냈던 창을 **앱 안으로 되돌리는** 길 — 캔버스로 점프만
        //   하면 되돌린 게 아니다(사용자는 그 IDE 를 계속 보려고 되돌린다). 그 자리에 창을 다시 연다.
        store.focusOnNode(agentId);
        store.selectNode(agentId);
        store.openIDEOverlay(agentId, { pane: 'new' });
        return;
      }
      // 직전 세션 점프로 열린 IDE 가 캔버스를 가리지 않도록 닫고, 그 버블로 카메라 이동+선택.
      store.closeIDEOverlay();
      store.focusOnNode(agentId);
      store.selectNode(agentId);
    });
    return () => { off(); };
  }, []);
}
