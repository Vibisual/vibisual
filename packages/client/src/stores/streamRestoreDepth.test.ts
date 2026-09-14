import { beforeEach, describe, expect, it } from 'vitest';

import type { SubAgent, SubAgentStreamEvent } from '@vibisual/shared';
import { STREAM_EVENTS_MAX_PER_INACTIVE_SESSION, STREAM_EVENTS_MAX_PER_SESSION } from '@vibisual/shared';
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
      streamHistoryExtra: {},
      streamHistoryDone: {},
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

  // ── 그 세션 **자신에게** 이벤트가 계속 도착하는 경우 (2026-09-08 사용자 보고) ──
  //
  // 위 케이스는 남의 세션(SUB_B)이 도착해 `pruneInactiveStreams` 가 SUB_A 를 깎는 길이다. 실제로
  // 사용자가 겪는 것은 그 반대다 — **보다가 자리를 뜬 바로 그 세션**이 계속 말을 한다. 그러면
  // append 경로의 인라인 컷이 먼저 300 으로 깎아 버려, 뒤이어 도는 pruning 은 `300 > 300` 이 거짓이라
  // 표식을 지울 기회를 못 얻는다. 표식이 남으면 IDE 가 "이미 깊게 받았다"로 읽어 재요청을 걸지 않고,
  // 그 세션은 300 창에 갇혀 **말풍선과 카드만 남고 사이 대화가 빈 채로 굳는다**
  // (실측: P_MPS_GPT `sub-mtsf7fl7-7apuai` — 디스크 1,622건이 멀쩡한데 화면은 마지막 300건 언저리만).
  it('비활성 세션 자신에게 이벤트가 도착해 깎여도 표식이 지워진다', () => {
    openIDE();
    useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, 2000) }, 'deep');
    expect(useGraphStore.getState().deepRestoredSessions[SUB_A]).toBe(true);

    // 자리를 뜬 뒤에도 그 세션은 계속 돈다 — 도착하는 줄은 남이 아니라 **자기 자신**의 것이다.
    useGraphStore.getState().closeIDEOverlay();
    useGraphStore.getState().appendStreamEvent(evt(SUB_A, 5000));

    expect(useGraphStore.getState().subAgentStreams[SUB_A]).toHaveLength(STREAM_EVENTS_MAX_PER_INACTIVE_SESSION);
    expect(useGraphStore.getState().deepRestoredSessions[SUB_A]).toBeUndefined();
  });

  it('비활성 세션 자신에게 배치로 도착해 깎여도 표식이 지워진다', () => {
    openIDE();
    useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, 2000) }, 'deep');
    useGraphStore.getState().closeIDEOverlay();
    // WS 배치 경로(`appendStreamEvents`)도 같은 인라인 컷을 들고 있다 — 한쪽만 고치면 반쪽이다.
    useGraphStore.getState().appendStreamEvents(stream(SUB_A, 30, 5000));

    expect(useGraphStore.getState().subAgentStreams[SUB_A]).toHaveLength(STREAM_EVENTS_MAX_PER_INACTIVE_SESSION);
    expect(useGraphStore.getState().deepRestoredSessions[SUB_A]).toBeUndefined();
  });

  it('비활성 세션에 얕은 적재가 들어와 깎여도 표식이 지워진다', () => {
    openIDE();
    useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, 400) }, 'deep');
    useGraphStore.getState().closeIDEOverlay();
    // 자리를 뜬 뒤 도착한 얕은 조회(세션당 500)가 400 창을 500 으로 늘렸다가 300 으로 깎는 길.
    useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, 500) }, 'shallow');

    expect(useGraphStore.getState().subAgentStreams[SUB_A]).toHaveLength(STREAM_EVENTS_MAX_PER_INACTIVE_SESSION);
    expect(useGraphStore.getState().deepRestoredSessions[SUB_A]).toBeUndefined();
  });

  it('보고 있는 세션의 활성 컷(4000)은 표식을 지우지 않는다', () => {
    // 활성 컷은 깊은 복원분(2,000)보다 **큰** 창을 깎는 것이라, 여기서 표식을 지우면 재요청이
    // 4,000 창을 2,000 으로 되돌린다 — 고치려던 것과 정반대가 된다.
    openIDE();
    useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, 2000) }, 'deep');
    useGraphStore.getState().appendStreamEvents(stream(SUB_A, 3000, 5000));

    expect(useGraphStore.getState().subAgentStreams[SUB_A]).toHaveLength(STREAM_EVENTS_MAX_PER_SESSION);
    expect(useGraphStore.getState().deepRestoredSessions[SUB_A]).toBe(true);
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

  // ── §5.5 #17-12 — 복원 창 위쪽 과거를 거슬러 불러온 장부 ──
  //
  // 서버의 깊은 창(2,000)보다 앞은 턴마다 저장된 답만 남아 긴 대화를 올려 보면 사이 대화가 비어 보였다.
  // 그 앞을 한 쪽씩 불러와 붙이는데, 붙인 과거가 다음 줄 도착에 도로 잘리거나 "더 없음" 표식이 남아
  // 재요청을 막으면 같은 증상이 되살아난다. 여기서 장부의 규칙을 못 박는다.
  describe('과거 불러오기 장부 (§5.5 #17-12)', () => {
    it('앞에 붙이며 겹친 줄은 버리고 늘어난 만큼 상한을 넓힌다', () => {
      openIDE();
      useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, 2000, 1000) }, 'deep');
      // 기준 줄(1000)이 경계라 한 번 더 딸려 온 경우 — 중복으로 두 번 그리면 안 된다.
      useGraphStore.getState().prependStreamHistory(SUB_A, [...stream(SUB_A, 1000, 0), evt(SUB_A, 1000)], true);

      const st = useGraphStore.getState();
      const buf = st.subAgentStreams[SUB_A] ?? [];
      expect(buf).toHaveLength(3000);
      expect(buf[0]?.id).toBe(`${SUB_A}-0`);
      expect(buf[1000]?.id).toBe(`${SUB_A}-1000`);
      expect(new Set(buf.map((e) => e.id)).size).toBe(3000);
      expect(st.streamHistoryExtra[SUB_A]).toBe(1000);
      expect(st.streamHistoryDone[SUB_A]).toBeUndefined();
    });

    it('서버가 더 없다고 하면 붙인 뒤 끝 표식을 세운다', () => {
      openIDE();
      useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, 2000, 1000) }, 'deep');
      useGraphStore.getState().prependStreamHistory(SUB_A, stream(SUB_A, 1000, 0), false);

      expect(useGraphStore.getState().subAgentStreams[SUB_A]).toHaveLength(3000);
      expect(useGraphStore.getState().streamHistoryDone[SUB_A]).toBe(true);
    });

    it('"더 있다"면서 새 줄이 없으면 끝으로 친다 — 같은 기준점으로 끝없이 묻지 않게', () => {
      openIDE();
      useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, 2000, 1000) }, 'deep');
      const before = useGraphStore.getState().subAgentStreams[SUB_A];
      useGraphStore.getState().prependStreamHistory(SUB_A, [evt(SUB_A, 1000)], true);

      expect(useGraphStore.getState().subAgentStreams[SUB_A]).toBe(before);
      expect(useGraphStore.getState().streamHistoryExtra[SUB_A]).toBeUndefined();
      expect(useGraphStore.getState().streamHistoryDone[SUB_A]).toBe(true);
    });

    it('불러온 과거는 다음 줄 도착의 활성 컷에 잘리지 않는다', () => {
      openIDE();
      useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, STREAM_EVENTS_MAX_PER_SESSION, 10_000) }, 'deep');
      useGraphStore.getState().prependStreamHistory(SUB_A, stream(SUB_A, 1000, 9000), true);
      // 넓힌 상한이 없으면 4,000 + 1,000 + 30 이 4,512 를 넘어 곧장 4,000 으로 되깎인다.
      useGraphStore.getState().appendStreamEvents(stream(SUB_A, 30, 20_000));

      const buf = useGraphStore.getState().subAgentStreams[SUB_A] ?? [];
      expect(buf).toHaveLength(STREAM_EVENTS_MAX_PER_SESSION + 1030);
      expect(buf[0]?.id).toBe(`${SUB_A}-9000`);
    });

    it('넓힌 상한도 넘겨 앞이 잘리면 끝 표식만 내린다(다시 거슬러 오를 수 있게)', () => {
      openIDE();
      useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, STREAM_EVENTS_MAX_PER_SESSION, 10_000) }, 'deep');
      useGraphStore.getState().prependStreamHistory(SUB_A, stream(SUB_A, 1000, 9000), false);
      expect(useGraphStore.getState().streamHistoryDone[SUB_A]).toBe(true);

      useGraphStore.getState().appendStreamEvents(stream(SUB_A, 600, 20_000));

      const st = useGraphStore.getState();
      expect(st.subAgentStreams[SUB_A]).toHaveLength(STREAM_EVENTS_MAX_PER_SESSION + 1000);
      expect(st.streamHistoryDone[SUB_A]).toBeUndefined();
      expect(st.streamHistoryExtra[SUB_A]).toBe(1000);
    });

    it('단건 경로도 같은 넓힌 상한을 쓴다', () => {
      openIDE();
      useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, STREAM_EVENTS_MAX_PER_SESSION, 10_000) }, 'deep');
      useGraphStore.getState().prependStreamHistory(SUB_A, stream(SUB_A, 1000, 9000), true);
      useGraphStore.getState().appendStreamEvent(evt(SUB_A, 20_000));

      expect(useGraphStore.getState().subAgentStreams[SUB_A]).toHaveLength(STREAM_EVENTS_MAX_PER_SESSION + 1001);
    });

    it('비활성 컷이 깎으면 장부를 비운다', () => {
      openIDE();
      useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, 2000, 1000) }, 'deep');
      useGraphStore.getState().prependStreamHistory(SUB_A, stream(SUB_A, 1000, 0), false);
      useGraphStore.getState().closeIDEOverlay();
      useGraphStore.getState().appendStreamEvent(evt(SUB_B, 1));

      const st = useGraphStore.getState();
      expect(st.subAgentStreams[SUB_A]).toHaveLength(STREAM_EVENTS_MAX_PER_INACTIVE_SESSION);
      expect(st.streamHistoryExtra[SUB_A]).toBeUndefined();
      expect(st.streamHistoryDone[SUB_A]).toBeUndefined();
    });

    it('깊은 창이 같은 첫 줄로 다시 얹히면 장부를 두고, 다른 첫 줄로 교체되면 비운다', () => {
      openIDE();
      useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, 2000, 1000) }, 'deep');
      useGraphStore.getState().prependStreamHistory(SUB_A, stream(SUB_A, 1000, 0), true);
      // 과거를 이어 둔 버퍼 위에 깊은 창을 얹은 결과(mergeDeepWindow) — 첫 줄이 그대로다.
      useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, 3000, 0) }, 'deep');
      expect(useGraphStore.getState().streamHistoryExtra[SUB_A]).toBe(1000);

      // 앞을 모르는 새 창으로 통째 교체 — 불러온 과거는 이 창에 없다.
      useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, 2000, 1200) }, 'deep');
      expect(useGraphStore.getState().subAgentStreams[SUB_A]?.[0]?.id).toBe(`${SUB_A}-1200`);
      expect(useGraphStore.getState().streamHistoryExtra[SUB_A]).toBeUndefined();
    });
  });

  // ── §5.5 #17-12 — 프로젝트 왕복 ──
  //
  // 스코프드 스냅샷은 `subAgents` 에 지금 보는 프로젝트의 에이전트만 싣는다. 다른 프로젝트로 옮기면 열어 둔 IDE 의
  // 에이전트가 목록에서 빠져, 그 창의 세션이(탭에서 고른 하나만 빼고) 전부 비활성으로 떨어져 300 으로 깎였다.
  it('프로젝트를 옮겨 목록에서 에이전트가 빠져도 열어 둔 창의 세션은 깎이지 않는다', () => {
    openIDE();
    useGraphStore.getState().loadStreamBuffers({ [SUB_A]: stream(SUB_A, 2000) }, 'deep');
    useGraphStore.getState().loadStreamBuffers({ [SUB_B]: stream(SUB_B, 2000) }, 'deep');
    // 다른 프로젝트로 옮긴 뒤의 스냅샷 — 이 에이전트는 목록에 없다.
    useGraphStore.setState({ subAgents: {} });
    useGraphStore.getState().appendStreamEvent({ ...evt('sub-other', 1), parentAgentId: 'agent-other' });

    const st = useGraphStore.getState();
    expect(st.subAgentStreams[SUB_A]).toHaveLength(2000);
    expect(st.subAgentStreams[SUB_B]).toHaveLength(2000);
    expect(st.deepRestoredSessions[SUB_B]).toBe(true);
  });

  it('창을 닫으면 부모 id 로 되짚던 세션도 비활성으로 돌아간다', () => {
    openIDE();
    useGraphStore.getState().loadStreamBuffers({ [SUB_B]: stream(SUB_B, 2000) }, 'deep');
    useGraphStore.setState({ subAgents: {} });
    useGraphStore.getState().closeIDEOverlay();
    useGraphStore.getState().appendStreamEvent({ ...evt('sub-other', 1), parentAgentId: 'agent-other' });

    expect(useGraphStore.getState().subAgentStreams[SUB_B]).toHaveLength(STREAM_EVENTS_MAX_PER_INACTIVE_SESSION);
  });
});
