import { useEffect } from 'react';
import { useGraphStore } from '../stores/graphStore.js';

// SCENARIO.md §5.12 (D) — 메인 윈도우 한정.
//
// 지휘통제실 카드의 [이동] 이 main 프로세스를 거쳐 `vibisual:command:reveal` 를 메인 윈도우
// 렌더러로 보낸다. 그 신호를 §5.4 #30 (C) `session` 북마크 점프와 **같은 순서**로 처리한다:
//   프로젝트 전환 → 노드 포커싱 → IDE 열기 → 그 세션 탭 활성(사라졌으면 메인 탭 폴백).
//
// 메인 윈도우(App)에서만 사용 — 지휘통제실 창은 CommandCenterShell 을 렌더하므로 이 훅을
// 부르지 않는다. dev/web 모드(window.api.command 없음)에선 no-op.

export function useCommandCenterReveal(): void {
  useEffect(() => {
    const command = typeof window !== 'undefined' ? window.api?.command : undefined;
    if (!command?.onReveal) return;
    const off = command.onReveal(({ projectId, agentId, subAgentId }) => {
      const store = useGraphStore.getState();
      const known = !!store.projects[projectId] || !!store.stubProjects[projectId];
      if (known) store.setActiveProject(projectId);
      store.focusOnNode(agentId);
      store.selectNode(agentId);
      store.openIDEOverlay(agentId);
      if (subAgentId) {
        // 그 세션이 아직 살아 있을 때만 탭을 옮긴다 — 없으면 메인 탭(null)에 머문다.
        const alive = (useGraphStore.getState().subAgents[agentId] ?? []).some((s) => s.id === subAgentId);
        if (alive) store.setIDEActiveSession(subAgentId);
      }
    });
    return () => { off(); };
  }, []);
}
