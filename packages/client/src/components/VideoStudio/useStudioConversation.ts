import { useEffect, useMemo } from 'react';
import type { QueuedCommand, SubAgentStreamEvent } from '@vibisual/shared';

import { useGraphStore } from '../../stores/graphStore.js';
import { buildBaseItems } from '../IDE/streamItems.js';
import { restoreStreamWindow } from '../IDE/streamRestore.js';
import { stripStudioContext } from './studioAgentMessage.js';

/**
 * §5.13 (V) 37-1 — AI 패널의 대화. **새로 저장하지 않는다** — IDE 가 그리는 같은 자리를 읽는다:
 * 사용자의 말은 `queuedCommands`·`completedCommands`(그 세션의 것), AI 의 말은 `subAgentStreams[세션]`, 화면 단위는
 * IDE 의 `buildBaseItems`(부작용 없는 순수 조립). 그 세션의 스트림이 아직 이 창에 없으면(IDE 를 안 열었다) 서버의 창을 한 번
 * 받아 IDE 와 같은 `restoreStreamWindow` 로 채운다. 전체 대화는 [IDE 에서 보기]가 연다.
 */

export interface StudioChatLine {
  readonly id: string;
  readonly who: 'me' | 'ai';
  readonly text: string;
  readonly at: number;
  /** 내 말이면 명령 상태(queued·executing·completed·error). */
  readonly status?: string;
}

/** 패널에 보이는 마지막 줄 수 — 전체는 IDE 에서. */
const CHAT_LINES_MAX = 40;
const EMPTY_EVENTS: SubAgentStreamEvent[] = [];
const EMPTY_COMMANDS: QueuedCommand[] = [];

export function useStudioConversation(agentId: string | null, sessionId: string | null): { readonly lines: readonly StudioChatLine[]; readonly busy: boolean } {
  const events = useGraphStore((s) => (sessionId ? s.subAgentStreams?.[sessionId] : undefined)) ?? EMPTY_EVENTS;
  const queued = useGraphStore((s) => (agentId ? s.queuedCommands?.[agentId] : undefined)) ?? EMPTY_COMMANDS;
  const completed = useGraphStore((s) => (agentId ? s.completedCommands?.[agentId] : undefined)) ?? EMPTY_COMMANDS;

  // 그 세션의 지난 대화가 이 창에 없으면 서버 창을 한 번 받는다(IDE 와 같은 복원 길).
  useEffect(() => {
    if (!agentId || !sessionId || events.length > 0) return;
    let cancelled = false;
    const epoch = useGraphStore.getState().streamRestoreEpoch;
    fetch(`/api/subagent-streams/${encodeURIComponent(agentId)}/${encodeURIComponent(sessionId)}`)
      .then((r) => r.json() as Promise<{ events?: SubAgentStreamEvent[] }>)
      .then((data) => {
        if (cancelled || !data.events || data.events.length === 0) return;
        void restoreStreamWindow(agentId, sessionId, data.events, { epoch, cancelled: () => cancelled });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
    // 세션이 바뀔 때만 — 스트림이 차오르는 동안 다시 받지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, sessionId]);

  return useMemo(() => {
    if (!agentId || !sessionId) return { lines: [], busy: false };
    const commands = [...queued, ...completed].filter((c) => c.subAgentId === sessionId);
    const built = buildBaseItems(events, commands);
    const lines: StudioChatLine[] = [];
    for (const item of built.items) {
      if (item.kind === 'command') {
        const text = stripStudioContext(item.prompt).trim();
        if (text !== '') lines.push({ id: item.id, who: 'me', text, at: item.submittedAt ?? item.timestamp, status: item.status });
      } else if (item.kind === 'text' && item.content.trim() !== '') {
        lines.push({ id: item.id, who: 'ai', text: item.content.trim(), at: item.timestamp });
      }
    }
    return { lines: lines.slice(-CHAT_LINES_MAX), busy: built.agentBusy };
  }, [agentId, sessionId, events, queued, completed]);
}
