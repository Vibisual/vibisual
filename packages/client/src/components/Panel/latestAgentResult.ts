/** §7.1 — 에이전트 패널의 마지막 결과 한 건을 고른다(재료 `agentEvents`·`completedCommands`). 판정은 이 파일 한 곳. */
import type { AgentEvent, QueuedCommand, SubAgent, TodoItem } from '@vibisual/shared';
import { extractStageBlocks } from '@vibisual/shared';

export interface LatestAgentResult {
  id: string;
  /** 보낸 명령(프롬프트) 원문. */
  prompt: string;
  /** 결과 본문 — 무대 블록을 걷어 낸 것. 읽을 글이 없으면 `''`. */
  preview: string;
  /** 고르고 적는 시각 — 명령은 실제로 나간 시각(`startedAt`), 없으면 큐에 넣은 시각. 대화는 보낸 시각. */
  at: number;
  isError: boolean;
  /** 이 결과를 낸 세션(`SubAgent.id`). 세션 없는 직접 대화(훅 버블)는 `null`. */
  sessionId: string | null;
  /** 세션 이름 — 그 세션이 **아직 목록에 있을 때만**. 없으면 IDE 에 그 세션을 세울 수 없다. */
  sessionLabel?: string;
  todos?: TodoItem[];
}

/** 무대 블록(```vibisual …)을 걷는다 — 진행 신고라 남기면 칸이 신고 줄로 찬다. 파서는 서버·IDE 와 같은 `extractStageBlocks`. */
export function stripStageBlocks(text: string | undefined): string {
  if (!text) return '';
  const spans = extractStageBlocks(text);
  if (spans.length === 0) return text.trim();
  let out = '';
  let at = 0;
  for (const span of spans) {
    out += text.slice(at, span.start);
    at = span.end;
  }
  out += text.slice(at);
  // 블록이 빠진 자리에 빈 줄이 겹쳐 남는다 — 두 줄 넘게 비면 한 줄로 접는다.
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 끝난 것 중 가장 늦게 시작한 한 건(없으면 `null`). 대화는 응답이 붙은 것만, 명령은 `completed`/`error` 만(`silent` 제외, §5.3 #9-1 (P)).
 * 명령은 `startedAt` 으로 견준다 — 큐 시각은 덧말이면 앞서 순서를 뒤집는다(§5.5 #17-18 ⑥). 본문 손질은 고른 한 건에만(스냅샷마다 돈다).
 */
export function pickLatestAgentResult(
  events: readonly AgentEvent[],
  completedCommands: readonly QueuedCommand[],
  subAgents: readonly SubAgent[],
): LatestAgentResult | null {
  let bestEvt: AgentEvent | null = null;
  for (const evt of events) {
    if (!evt.message || !evt.response) continue;
    if (!bestEvt || evt.timestamp > bestEvt.timestamp) bestEvt = evt;
  }

  let bestCmd: QueuedCommand | null = null;
  let bestCmdAt = 0;
  for (const cmd of completedCommands) {
    if (cmd.silent) continue;
    if (cmd.status !== 'completed' && cmd.status !== 'error') continue;
    const at = cmd.startedAt ?? cmd.timestamp;
    if (!bestCmd || at > bestCmdAt) {
      bestCmd = cmd;
      bestCmdAt = at;
    }
  }

  if (bestCmd && (!bestEvt || bestCmdAt > bestEvt.timestamp)) {
    const cmd = bestCmd;
    const subId = cmd.subAgentId;
    const sub = subId ? subAgents.find((s) => s.id === subId) : undefined;
    return {
      id: cmd.id,
      prompt: cmd.text,
      preview: stripStageBlocks(cmd.result),
      at: bestCmdAt,
      isError: cmd.status === 'error',
      sessionId: subId,
      ...(sub ? { sessionLabel: sub.label } : {}),
    };
  }

  if (bestEvt) {
    return {
      id: bestEvt.id,
      prompt: bestEvt.message,
      preview: stripStageBlocks(bestEvt.response),
      at: bestEvt.timestamp,
      isError: false,
      sessionId: null,
      ...(bestEvt.todos && bestEvt.todos.length > 0 ? { todos: bestEvt.todos } : {}),
    };
  }

  return null;
}
