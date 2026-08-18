import { beforeEach, describe, expect, it } from 'vitest';

import type { SubAgent, SubAgentStreamEvent } from '@vibisual/shared';
import { STREAM_EVENTS_MAX_PER_INACTIVE_SESSION } from '@vibisual/shared';
import { useGraphStore } from './graphStore.js';

/**
 * §5.5 v4.92 ④ — "보고 있는 세션만 상한 전체를 받는다"가 **실제로 효력이 나는지** 못 박는다.
 *
 * 그 라운드는 단건 경로(`GET /api/subagent-streams/:agentId/:subId`)를 만들어 두었지만, 받아 온
 * 깊은 창을 지켜 주는 것이 없었다 — 나란히 날아간 얕은 조회가 나중에 도착하면 통째로 덮었고,
 * 비활성 컷(300)이 깎고 나면 다시 받아 오는 길이 없었다. 그러면 그 세션은 얕은 채로 굳고 화면은
 * **말풍선과 카드만 남고 사이 대화가 빈** 모양이 된다(실측: 디스크 2,527건 · 서버 2,000건이 멀쩡한데
 * 화면은 마지막 500건 언저리만).
 *
 * 여기서 잠그는 것은 넷이다 — 깊은 적재는 창을 보존하고 표식을 세운다 · 늦게 온 얕은 적재는 그 창을
 * 줄이지 않는다 · 얕은 적재가 가져온 새 꼬리는 잃지 않는다 · 깎이면 표식이 지워져 **다시 받아 온다**.
 */

const AGENT = 'agent-1';
const SUB_A = 'sub-a';
const SUB_B = 'sub-b';

function evt(subAgentId: string, n: number): SubAgentStreamEvent {
  return {
    id: `${subAgentId}-${n}`,
    subAgentId,
    parentAgentId: AGENT,
    timestamp: 1_700_000_000_000 + n,
    eventType: 'text',
    content: `line ${n}`,
  };
}

/** 같은 스트림의 앞에서 뒤로 이어지는 `count` 개 — 얕은 응답은 이 배열의 꼬리다. */
function stream(subAgentId: string, count: number, from = 0): SubAgentStreamEvent[] {
  return Array.from({ length: count }, (_, i) => evt(subAgentId, from + i));
}

/** IDE 로 그 에이전트를 열어 둔 상태 — 그 에이전트의 세션은 전부 '보고 있는' 세션이 된다. */
function openIDE(): void {
  useGraphStore.setState({
    activeProject: 'proj',
    subAgents: { [AGENT]: [{ id: SUB_A }, { id: SUB_B }] as unknown as SubAgent[] },
  });
  useGraphStore.getState().openIDEOverlay(AGENT);
  useGraphStore.getState().setIDEActiveSession(SUB_A);
}

describe('스트림 복원 깊이 (§5.5 v4.92 ④)', () => {
  beforeEach(() => {
    useGraphStore.setState({
      subAgentStreams: {},
      streamLastActivity: {},
      deepRestoredSessions: {},
      ideOverlays: {},
      subAgents: {},
      activeProject: null,
    });
  });

  it('깊은 적재는 상한 전체를 그대로 보존하고 표식을 세운다', () => {
    openIDE();
    useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, 2000) }, 'deep');

    expect(useGraphStore.getState().subAgentStreams[SUB_A]).toHaveLength(2000);
    expect(useGraphStore.getState().deepRestoredSessions[SUB_A]).toBe(true);
  });

  it('스냅샷이 아직 안 닿아 활성으로 안 잡혀도 깊은 적재는 깎이지 않는다', () => {
    // 오버레이를 열지 않은 찰나(= computeActiveSessionIds 가 빈 집합)에도 깊은 복원분은 살아야
    // 한다. 여기서 300 으로 깎이면 표식만 서고 창은 깎인 채 굳어 재요청 길이 도로 막힌다.
    useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, 2000) }, 'deep');

    expect(useGraphStore.getState().subAgentStreams[SUB_A]).toHaveLength(2000);
    expect(useGraphStore.getState().deepRestoredSessions[SUB_A]).toBe(true);
  });

  it('늦게 도착한 얕은 적재가 깊은 창을 줄이지 않는다', () => {
    openIDE();
    useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, 2000) }, 'deep');
    // 에이전트 전체 조회(세션당 얕은 꼬리 500)가 뒤늦게 도착 — 종전엔 이게 2,000 을 통째로 덮었다.
    useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, 500, 1500) }, 'shallow');

    const buf = useGraphStore.getState().subAgentStreams[SUB_A] ?? [];
    expect(buf).toHaveLength(2000);
    expect(buf[0]?.id).toBe(`${SUB_A}-0`);
    expect(useGraphStore.getState().deepRestoredSessions[SUB_A]).toBe(true);
  });

  it('얕은 적재가 물고 온 새 꼬리는 잃지 않고 이어 붙인다', () => {
    openIDE();
    useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, 2000) }, 'deep');
    // 깊은 응답이 오가는 사이 흘러온 2줄이 얕은 응답에만 들어 있는 경우.
    useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, 502, 1500) }, 'shallow');

    const buf = useGraphStore.getState().subAgentStreams[SUB_A] ?? [];
    expect(buf).toHaveLength(2002);
    expect(buf[buf.length - 1]?.id).toBe(`${SUB_A}-2001`);
  });

  it('얕은 적재는 아직 아무것도 없는 세션은 종전대로 그대로 싣는다', () => {
    openIDE();
    useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, 120) }, 'shallow');

    expect(useGraphStore.getState().subAgentStreams[SUB_A]).toHaveLength(120);
    // 얕은 적재는 표식을 세우지 않는다 — 세워 두면 깊은 복원을 영영 안 받는다.
    expect(useGraphStore.getState().deepRestoredSessions[SUB_A]).toBeUndefined();
  });

  it('비활성 컷이 창을 깎으면 표식이 지워진다 — 그래야 다시 받아 온다', () => {
    openIDE();
    useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, 2000) }, 'deep');
    expect(useGraphStore.getState().deepRestoredSessions[SUB_A]).toBe(true);

    // IDE 를 닫으면 그 에이전트의 세션은 전부 비활성이 된다. 이후 아무 스트림이나 도착하면
    // pruning 이 돌며 이 세션의 창을 300 으로 깎는다.
    useGraphStore.getState().closeIDEOverlay();
    useGraphStore.getState().appendStreamEvent(evt(SUB_B, 1));

    expect(useGraphStore.getState().subAgentStreams[SUB_A]).toHaveLength(STREAM_EVENTS_MAX_PER_INACTIVE_SESSION);
    expect(useGraphStore.getState().deepRestoredSessions[SUB_A]).toBeUndefined();
  });

  it('깎였다가 다시 깊게 받으면 창과 표식이 함께 돌아온다', () => {
    openIDE();
    useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, 2000) }, 'deep');
    useGraphStore.getState().closeIDEOverlay();
    useGraphStore.getState().appendStreamEvent(evt(SUB_B, 1));
    expect(useGraphStore.getState().deepRestoredSessions[SUB_A]).toBeUndefined();

    openIDE();
    useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, 2000) }, 'deep');

    expect(useGraphStore.getState().subAgentStreams[SUB_A]).toHaveLength(2000);
    expect(useGraphStore.getState().deepRestoredSessions[SUB_A]).toBe(true);
  });
});
