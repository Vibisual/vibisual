import { CODEX_MCP_CALL_DEADLINE_MS } from '@vibisual/shared';
import type { CodexMappedEvent } from './codexStreamMap.js';

/**
 * §5.25 (F) — 짝을 못 찾은 코덱스 도구 호출의 미결 원장.
 * MCP 서버가 죽으면(`CONNECT_TIMEOUT`) 코덱스는 `item.started` 만 남기고 조용해져, 도구 카드가 영원히 "도는 중"으로 남는다.
 * 판정은 매퍼 밖 여기에 둔다 — `codexStreamMap` 은 줄 하나만 보는 순수 함수로 남아야 시험이 값싸고, 상태 수명은 턴 하나(`attachCodexTurn`)와 같다.
 * 시한은 `awaitsResult` 가 선 호출에만 건다 — 완료 줄이 없는 도구(`web_search`)나 한 시간 도는 도구(`command_execution`)에 걸면 멀쩡한 호출이 실패로 물든다.
 */
export interface CodexPendingCallLedger {
  /** 흘러가는 이벤트를 한 번씩 보여 준다 — `tool_use` 는 등록, `tool_result` 는 해제. */
  note(event: CodexMappedEvent, now?: number): void;
  /** 시한이 지난 미결 호출을 닫는 합성 `tool_result` 들. 돌려준 것은 원장에서 빠진다. */
  overdue(now?: number): CodexMappedEvent[];
  /** 턴이 끝난다 — 남은 미결을 전부 닫는다. 돌려준 것은 원장에서 빠진다. */
  flush(reason: string, now?: number): CodexMappedEvent[];
  /** 지금 몇 건이 미결인가(진단·테스트용). */
  size(): number;
}

interface PendingCall {
  toolName: string;
  startedAt: number;
}

/** 원장 하나가 들 수 있는 미결 상한 — 한 턴이 수만 건을 부르는 일은 없지만 축은 늘 막아 둔다. */
const MAX_PENDING = 256;

export function createCodexPendingCallLedger(
  deadlineMs: number = CODEX_MCP_CALL_DEADLINE_MS,
): CodexPendingCallLedger {
  const pending = new Map<string, PendingCall>();

  const close = (toolUseId: string, call: PendingCall, content: string): CodexMappedEvent => {
    pending.delete(toolUseId);
    return { eventType: 'tool_result', content, toolName: call.toolName, toolUseId };
  };

  return {
    note(event, now = Date.now()): void {
      const id = event.toolUseId;
      if (!id) return;
      if (event.eventType === 'tool_use') {
        if (!event.awaitsResult) return;
        pending.set(id, { toolName: event.toolName ?? 'mcp', startedAt: now });
        // 오래된 것부터 버린다 — 상한에 닿았다는 것은 이미 원장이 제 일을 못 하고 있다는 뜻이다.
        while (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value!);
        return;
      }
      if (event.eventType === 'tool_result') pending.delete(id);
    },

    overdue(now = Date.now()): CodexMappedEvent[] {
      const out: CodexMappedEvent[] = [];
      for (const [id, call] of [...pending]) {
        const waited = now - call.startedAt;
        if (waited < deadlineMs) continue;
        out.push(close(id, call, `no result after ${Math.round(waited / 1000)}s - closed by timeout`));
      }
      return out;
    },

    flush(reason, now = Date.now()): CodexMappedEvent[] {
      const out: CodexMappedEvent[] = [];
      for (const [id, call] of [...pending]) {
        out.push(close(id, call, `no result after ${Math.round((now - call.startedAt) / 1000)}s - ${reason}`));
      }
      return out;
    },

    size(): number {
      return pending.size;
    },
  };
}
