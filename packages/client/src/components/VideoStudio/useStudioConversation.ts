import { useDeferredValue, useEffect, useMemo } from 'react';
import type { QueuedCommand, SubAgentStreamEvent } from '@vibisual/shared';

import { useGraphStore } from '../../stores/graphStore.js';
import { buildBaseItems, commandAnchorTs, hasDispatched } from '../IDE/streamItems.js';
import { restoreStreamWindow } from '../IDE/streamRestore.js';
import { stripStudioContext } from './studioAgentMessage.js';

/**
 * §5.13 (V) 37-1 — AI 패널의 대화. 새로 저장하지 않는다 — IDE 가 그리는 같은 자리를 읽는다: 사용자의 말은 `queuedCommands`·`completedCommands`(그 세션),
 * AI 의 말은 `subAgentStreams[세션]`, 화면 단위는 IDE 의 `buildBaseItems`(순수 조립). 스트림이 이 창에 없으면(IDE 를 안 열었다) 서버 창을 한 번 받아
 * `restoreStreamWindow` 로 채운다. 전체 대화는 [IDE 에서 보기].
 * §5.13 (Y) 40-5 ② — ① 구독은 셸이 아니라 AI 패널 안에서 한다(셸이면 스트림 델타마다 스튜디오 전체가 다시 그려진다). ② 조립은 보이는 꼬리만: 마지막 턴 몇 개
 * (명령이 나간 시각부터)만 `buildBaseItems` 에 넘기고 40줄이 모자라면 턴을 두 배씩 늘린다. 그 자리에서 자르면 도구 결과 짝·턴의 말이 갈라지지 않는다(시험 `studioConversationTail`).
 */

export interface StudioChatLine {
  readonly id: string;
  readonly who: 'me' | 'ai';
  readonly text: string;
  readonly at: number;
  /** 내 말이면 명령 상태(queued·executing·completed·error). */
  readonly status?: string;
  /** §5.13 (V) 37-23 (I) — 그 말이 속한 바퀴: 내 말은 문맥 블록의 `Pass:` 줄, AI 말은 바로 앞 내 말의 것. 스튜디오 밖에서 한 말은 없다. */
  readonly passId?: string;
}

const PASS_LINE = /^- Pass: (\S+) /m;

/** 명령 글의 문맥 블록에서 바퀴 id 를 읽는다(`studioAgentMessage` 가 쓰는 줄 그대로). */
export function passIdOfPrompt(prompt: string): string | undefined {
  return PASS_LINE.exec(prompt)?.[1];
}

/** 패널에 보이는 마지막 줄 수 — 전체는 IDE 에서. */
export const CHAT_LINES_MAX = 40;
const EMPTY_EVENTS: SubAgentStreamEvent[] = [];
const EMPTY_COMMANDS: QueuedCommand[] = [];

function toLines(events: SubAgentStreamEvent[], commands: readonly QueuedCommand[]): { lines: StudioChatLine[]; busy: boolean } {
  const built = buildBaseItems(events, commands);
  // IDE 와 같은 자리로 세운다(`mergeCardsIntoItems` 의 정렬 열쇠 — 그 턴의 경계로 옮겨 온 출력 시각, 같은 시각이면 말풍선이 먼저).
  // 조립 순서 그대로면 패널이 "내 말 전부 → AI 말 전부" 덩어리로 선다(§5.13 (Y) 40-5 ② 꼬리 같음 시험).
  const sortKey = (item: { readonly id: string; readonly timestamp: number }): number => built.sortTimestamps?.get(item.id) ?? item.timestamp;
  const ordered = built.items
    .filter((item) => item.kind === 'command' || item.kind === 'text')
    .sort((a, b) => sortKey(a) - sortKey(b) || (a.kind === 'command' ? -1 : 0) - (b.kind === 'command' ? -1 : 0) || a.timestamp - b.timestamp);
  const lines: StudioChatLine[] = [];
  let passId: string | undefined;
  for (const item of ordered) {
    if (item.kind === 'command') {
      passId = passIdOfPrompt(item.prompt);
      const text = stripStudioContext(item.prompt).trim();
      if (text !== '') lines.push({ id: item.id, who: 'me', text, at: item.submittedAt ?? item.timestamp, status: item.status, ...(passId ? { passId } : {}) });
    } else if (item.kind === 'text' && item.content.trim() !== '') {
      lines.push({ id: item.id, who: 'ai', text: item.content.trim(), at: item.timestamp, ...(passId ? { passId } : {}) });
    }
  }
  return { lines, busy: built.agentBusy };
}

/** 시각 `ts` 이상인 첫 이벤트의 자리(이벤트는 시각 순이다). */
function firstAtOrAfter(events: readonly SubAgentStreamEvent[], ts: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((events[mid]?.timestamp ?? 0) < ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 마지막 `max` 줄(순수). 턴 경계(명령이 나간 시각)에서 잘라 꼬리만 조립하고, 줄이 모자라면 턴을 두 배씩 늘린다. 나가지 않은(대기)
 * 명령은 늘 싣는다(꼬리에 서는 말풍선이다). `keep` 을 주면 거른 **뒤에** 센다(37-23 (I) 장면별 대화).
 */
export function studioChatTail(
  events: readonly SubAgentStreamEvent[], commands: readonly QueuedCommand[], max = CHAT_LINES_MAX, keep?: (line: StudioChatLine) => boolean,
): { lines: StudioChatLine[]; busy: boolean } {
  const pick = (lines: StudioChatLine[]): StudioChatLine[] => (keep ? lines.filter(keep) : lines);
  const dispatched = commands.filter(hasDispatched).sort((a, b) => commandAnchorTs(a) - commandAnchorTs(b));
  const pending = commands.filter((c) => !hasDispatched(c));
  for (let turns = 2; turns < dispatched.length; turns *= 2) {
    const kept = dispatched.slice(-turns);
    const from = firstAtOrAfter(events, commandAnchorTs(kept[0]!));
    const tail = toLines(events.slice(from), [...kept, ...pending]);
    const shown = pick(tail.lines);
    if (shown.length >= max) return { lines: shown.slice(-max), busy: tail.busy };
  }
  const full = toLines([...events], commands);
  return { lines: pick(full.lines).slice(-max), busy: full.busy };
}

/** 장면별 대화 거르개 — 그 장면을 만진 바퀴들의 말만. 바퀴 표식이 없는 말은 '전체'에만 선다. */
export function scenePassFilter(passIds: ReadonlySet<string> | null): ((line: StudioChatLine) => boolean) | undefined {
  return passIds ? (line) => line.passId !== undefined && passIds.has(line.passId) : undefined;
}

export function useStudioConversation(
  agentId: string | null, sessionId: string | null, scenePasses: ReadonlySet<string> | null = null,
): { readonly lines: readonly StudioChatLine[]; readonly busy: boolean } {
  const liveEvents = useGraphStore((s) => (sessionId ? s.subAgentStreams?.[sessionId] : undefined)) ?? EMPTY_EVENTS;
  const queued = useGraphStore((s) => (agentId ? s.queuedCommands?.[agentId] : undefined)) ?? EMPTY_COMMANDS;
  const completed = useGraphStore((s) => (agentId ? s.completedCommands?.[agentId] : undefined)) ?? EMPTY_COMMANDS;
  // 델타가 몰려오는 동안 조립은 한 박자 늦어도 된다 — 입력·재생이 먼저다.
  const events = useDeferredValue(liveEvents);

  // 그 세션의 지난 대화가 이 창에 없으면 서버 창을 한 번 받는다(IDE 와 같은 복원 길).
  useEffect(() => {
    if (!agentId || !sessionId || liveEvents.length > 0) return;
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
    return studioChatTail(events, commands, CHAT_LINES_MAX, scenePassFilter(scenePasses));
  }, [agentId, sessionId, events, queued, completed, scenePasses]);
}
