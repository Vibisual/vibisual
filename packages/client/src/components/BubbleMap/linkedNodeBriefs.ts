/**
 * §5.4 #36 (C) 개정 — 말풍선이 보낼 때 이어진 앱 노드마다 **앱 몫 브리프**를 짓는다(코어 쪽 조립).
 *
 * 종전에는 모든 앱 노드에 같은 문구("결과 파일을 만들어 `/output` 으로 넣어라")를 붙였다. 그래서 영상 노드에 "영상 짧은 거
 * 하나 만들어 봐"를 보내면 에이전트가 파이썬·ffmpeg 로 완성 mp4 를 구워 넣었다 — 사용자가 원한 것은 코드로 짓고 검수·편집하며
 * 다듬는 **작업 문서**였다. 이제 앱이 레지스트리 `agentBrief` 로 자기 브리프를 선언하면 그 줄이 그 노드를 말하고, 앱이 작업
 * 문서를 새로 만들었으면 노드가 그 문서를 기억한다(`AppBubble.ref`).
 *
 * **코어는 앱 이름을 모른다(§5.13 (P-4))** — 선언을 부르기만 한다. 선택 브리프 실패는 종전 문구로 남기고,
 * 필수 준비 실패(AppAgentPreparationError)는 실행을 멈춰 앱이 알려 준 사유를 보인다.
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
