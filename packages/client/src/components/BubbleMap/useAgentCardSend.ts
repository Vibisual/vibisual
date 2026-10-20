import { useCallback, useRef, useState } from 'react';
import { agentSessionInputKey, useGraphStore } from '../../stores/graphStore.js';
import { withLinkedOutputBrief, type LinkedOutputNode } from './agentCard.js';
import { composeLinkedBriefs } from './linkedNodeBriefs.js';
import { appCommandOptions } from '../../apps/appExecutionRequirements.js';
import { recordCardTaskSend } from './agentCardTaskFlow.js';
import { cardTaskKey, useCardTaskStore } from './agentCardTaskState.js';

/** Covers both app-brief preparation and the existing command transport. */
export function useAgentCardSend(
  agentId: string,
  sessionId: string | null,
  draft: string,
  outputNodes: readonly LinkedOutputNode[],
  task?: { projectId: string; taskId?: string },
): { send: (live?: string) => void; sending: boolean; preparationFailed: boolean } {
  const inFlight = useRef(false);
  const [sending, setSending] = useState(false);
  const [failedSession, setFailedSession] = useState<{ id: string | null } | null>(null);
  const send = useCallback((live?: string): void => {
    const text = (live ?? draft).trim();
    // A ref also guards two Enter events before React has rendered the disabled button.
    if (!text || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setFailedSession(null);
    const store = useGraphStore.getState();
    const subExisted = store.subAgents[agentId]?.some((sub) => sub.id === sessionId);
    store.setAgentSessionInputText(agentId, sessionId, '');
    void (async (): Promise<void> => {
      try {
        if (task?.taskId && sessionId && !subExisted) throw new Error('task-session-unavailable');
        const nodes = await composeLinkedBriefs(outputNodes, text);
        const options = appCommandOptions(nodes);
        const command = withLinkedOutputBrief(text, nodes);
        // §5.1 #2-1 (F) ① — 넣은 앱 노드를 명령에 싣는다. 서버가 이 명령 중 쓴 파일을 그 노드의 작업물로 단다(확장자 무관).
        const appNodeIds = nodes.map((node) => node.id);
        const withNodes = appNodeIds.length > 0 ? { appNodeIds } : {};
        const receipt = task
          ? await useGraphStore.getState().addCommand(agentId, command, sessionId, undefined, { ...options, ...withNodes, draftText: text })
          : options || appNodeIds.length > 0
            ? await useGraphStore.getState().addCommand(agentId, command, sessionId, undefined, { ...options, ...withNodes })
            : await useGraphStore.getState().addCommand(agentId, command, sessionId);
        if (task && receipt?.subAgentId) {
          try { await recordCardTaskSend(task.projectId, agentId, task.taskId, receipt.subAgentId, text, nodes.map((node) => node.id)); }
          catch { useCardTaskStore.getState().patch(cardTaskKey(task.projectId, agentId), { error: 'history-save-failed' }); }
        }
      } catch {
        // Transport failures are restored by addCommand. Preparation failures must
        // also preserve the request, without overwriting text entered meanwhile.
        const current = useGraphStore.getState();
        if (!current.agents.some((agent) => agent.id === agentId)
          || (subExisted && !current.subAgents[agentId]?.some((sub) => sub.id === sessionId))) return;
        const nextText = current.agentSessionInputs[agentSessionInputKey(agentId, sessionId)]?.text ?? '';
        current.setAgentSessionInputText(agentId, sessionId,
          !nextText || nextText === text ? text : `${text}\n\n${nextText}`);
        setFailedSession({ id: sessionId });
      } finally {
        inFlight.current = false;
        setSending(false);
      }
    })();
  }, [agentId, sessionId, draft, outputNodes, task?.projectId, task?.taskId]);
  return { send, sending, preparationFailed: failedSession !== null && failedSession.id === sessionId };
}
