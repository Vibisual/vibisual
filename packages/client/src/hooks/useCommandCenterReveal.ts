import { useEffect } from 'react';
import { useGraphStore } from '../stores/graphStore.js';

// §5.12 (D) — 메인 윈도우 전용. 지휘통제실 [이동] 의 `vibisual:command:reveal` 를 §5.4 #30 (C) `session` 점프와 **같은 순서**로 처리한다:
// 프로젝트 전환 → 포커싱 → IDE 열기 → 그 세션 탭(없으면 메인 탭). window.api.command 가 없으면 no-op.

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
      // 그 세션이 아직 살아 있을 때만 탭을 옮긴다 — 없으면 여는 길의 기본(마지막에 보던 세션)에 둔다.
      const live = subAgentId && (useGraphStore.getState().subAgents[agentId] ?? []).some((s) => s.id === subAgentId)
        ? subAgentId
        : null;
      // §5.5 #17-6 (H-27) ⑦ 세션은 여는 길에 **실어** 보낸다. 연 다음에 키 없이 세우면 그 에이전트의
      //   IDE 가 밖에 나가 있는 판에 앱 안의 **남의 창**이 그 세션으로 바뀌고, 밖의 창은 그대로다.
      store.openIDEOverlay(agentId, live ? { focus: { sessionId: live } } : undefined);
    });
    return () => { off(); };
  }, []);
}
