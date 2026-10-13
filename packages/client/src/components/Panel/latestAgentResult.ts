/**
 * §7.1 (판올림 번호 발급 대기, 사용자 지시 2026-10-12) — 에이전트 패널의 **마지막 결과 한 건**을 고른다.
 *
 * 종전 `AgentEventList` 는 두 재료(부모 직접 대화 `agentEvents` · 세션 완료 명령 `completedCommands`)를
 * **전부** 최신순 목록으로 그렸다. 패널은 이제 "방금 끝낸 것" 하나만 들고, 전체 기록은 IDE 스트림과
 * 지휘통제실 검색이 맡는다. 무엇이 그 한 건인지는 이 파일 한 곳이 정한다(화면은 그리기만 한다).
 */
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

/**
 * 결과 본문에서 무대 블록(```vibisual …)을 걷는다. 그 블록은 진행 신고라 읽을 글이 아니고,
 * 보고가 대개 그 블록으로 시작하므로 그대로 앞 줄을 자르면 칸이 신고 줄로만 찬다.
 * 판정은 서버·IDE 와 같은 파서(`extractStageBlocks`) 한 벌을 쓴다.
 */
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
 * 끝난 것 가운데 가장 늦게 시작한 한 건. 없으면 `null`(칸째 그리지 않는다).
 *
 * - 대화는 **응답이 붙은 것만** 끝난 것이다 — 도는 중인 것은 버블 상태와 IDE 가 말한다.
 * - 명령은 `completed`/`error` 만. 우리가 끼운 조용한 내부 명령(`silent` — 자동 압축)은 사용자가 보낸
 *   명령이 아니라 어느 화면에도 그리지 않는다(§5.3 #9-1 (P)).
 * - 명령에는 끝난 시각이 없다. 실제로 나간 시각(`startedAt`)으로 견준다 — 큐에 넣은 시각은 덧말이면
 *   몇 분씩 앞서 있어 순서를 뒤집는다(§5.5 #17-18 ⑥).
 * - 시각이 같으면 대화가, 같은 재료 안에서는 배열의 앞쪽이 이긴다.
 *
 * 본문 손질(`stripStageBlocks`)은 **고른 한 건에만** 한다 — 완료 명령은 세션당 1000건까지 보관되고
 * 이 함수는 스냅샷마다 다시 돈다. 후보마다 본문을 훑으면 큰 결과 글을 수백 번 줄 단위로 쪼갠다.
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
