/**
 * §5.4 #36 (C) — 말풍선이 보낼 때 이어진 앱 노드마다 앱이 선언한 브리프(`agentBrief`)를 짓는다(코어는 앱 이름을 모른다, §5.13 (P-4)).
 * 공통 "결과 파일을 `/output` 으로" 문구만 쓰면 영상 노드에 작업 문서 대신 완성 mp4 가 들어온다. 선택 브리프 실패는 그 공통 문구로,
 * 필수 준비 실패(`AppAgentPreparationError`)는 실행을 멈추고 앱이 알려 준 사유를 보인다. 앱이 새로 만든 작업 문서는 `AppBubble.ref` 가 기억한다.
 */

import { AppAgentPreparationError, getInternalApp } from '../../apps/registry.js';
import { formChangeMove } from '../../apps/appNodeForm.js';
import { useGraphStore } from '../../stores/graphStore.js';
import type { LinkedOutputNode } from './agentCard.js';

export async function composeLinkedBriefs(nodes: readonly LinkedOutputNode[], request: string): Promise<LinkedOutputNode[]> {
  return Promise.all(nodes.map(async (node): Promise<LinkedOutputNode> => {
    const st = useGraphStore.getState();
    const bubble = st.appBubbles.find((b) => b.id === node.id);
    const app = bubble ? getInternalApp(bubble.appId) : undefined;
    if (!bubble || !app?.agentBrief) return node;
    const project = Object.values(st.projects).find((p) => p.name === bubble.projectName);
    if (!project?.path) return node;
    try {
      const build = await app.agentBrief();
      const brief = await build({
        request,
        projectId: project.path,
        projectName: project.name,
        bubble: { id: bubble.id, label: node.label, title: bubble.title, ref: bubble.ref, file: bubble.file },
      });
      if (!brief || brief.text.trim() === '') return node;
      if (brief.ref && brief.ref !== bubble.ref) {
        // 명패가 문서를 얻어 화면이 되면 가운데를 지킨다(이어진 노드는 이미 화면이라 그대로다).
        const at = formChangeMove(app, bubble, { linkedAgentIds: bubble.linkedAgentIds, file: bubble.file, ref: brief.ref });
        useGraphStore.getState().setAppBubbleRef(bubble.id, brief.ref, at);
      }
      return { ...node, brief: brief.text, ...(brief.executionRequirements ? { executionRequirements: brief.executionRequirements } : {}) };
    } catch (error) {
      if (error instanceof AppAgentPreparationError) throw error;
      return node;
    }
  }));
}
