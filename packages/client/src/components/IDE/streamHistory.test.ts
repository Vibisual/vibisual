import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SubAgentStreamEvent } from '@vibisual/shared';
import { STREAM_HISTORY_PAGE_EVENTS } from '@vibisual/shared';
import type { IDEOverlayState } from '../../stores/graphStore.js';
import { useGraphStore } from '../../stores/graphStore.js';
import {
  mergeDeepWindow,
  olderHistoryBoundary,
  olderHistoryUrl,
  reachesHistoryBoundary,
  requestOlderStreamHistory,
  resetStreamHistoryRequests,
} from './streamHistory.js';

/**
 * §5.5 #17-12 — 복원 창(서버 깊은 창 2,000건) 위쪽의 과거를 **거슬러 불러오는 길**을 못 박는다.
 * 종전엔 그 앞이 턴마다 저장된 답(명령 블록)만 남아, 긴 대화를 올려 보면 사이 대화가 사라진 모양이었다.
 */

const AGENT = 'agent-1';
const SID = 'sub-a';

function evt(n: number, sid = SID): SubAgentStreamEvent {
  return { id: `${sid}-${n}`, subAgentId: sid, parentAgentId: AGENT, timestamp: 1_700_000_000_000 + n, eventType: 'text', content: `line ${n}` };
}

function range(from: number, count: number): SubAgentStreamEvent[] {
  return Array.from({ length: count }, (_, i) => evt(from + i));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** 이번에 실제로 청한 요청이 끝날 때까지 기다린다. */
function request(): { wait: number; settled: Promise<void> } {
  let done!: () => void;
  const settled = new Promise<void>((r) => { done = r; });
  const wait = requestOlderStreamHistory(AGENT, SID, () => done());
  return { wait, settled };
}

describe('olderHistoryBoundary · reachesHistoryBoundary', () => {
  it('창 밖 턴의 폴백(버퍼 첫 줄보다 이른 항목) 아래 첫 항목이 윗끝이다', () => {
    const items = [{ timestamp: 5 }, { timestamp: 8 }, { timestamp: 10 }, { timestamp: 11 }];
    expect(olderHistoryBoundary(items, [{ timestamp: 10 }, { timestamp: 11 }])).toBe(2);
  });

  it('버퍼가 비었거나 창 안 항목이 없으면 -1', () => {
    expect(olderHistoryBoundary([{ timestamp: 1 }], [])).toBe(-1);
    expect(olderHistoryBoundary([{ timestamp: 1 }], [{ timestamp: 9 }])).toBe(-1);
  });

  it('그려진 첫 항목이 윗끝 이하면 닿았다', () => {
    expect(reachesHistoryBoundary(2, 2)).toBe(true);
    expect(reachesHistoryBoundary(0, 2)).toBe(true);
    expect(reachesHistoryBoundary(3, 2)).toBe(false);
    expect(reachesHistoryBoundary(0, -1)).toBe(false);
  });
});

describe('mergeDeepWindow', () => {
  it('서버 창이 비면 든 버퍼를 그대로 둔다', () => {
    const prev = range(0, 3);
    expect(mergeDeepWindow([], prev)).toEqual(prev);
  });

  it('라이브로 쌓여 서버 창보다 긴 버퍼를 줄이지 않는다(서버 창 앞은 남긴다)', () => {
    const merged = mergeDeepWindow(range(1000, 2000), range(0, 3000));
    expect(merged).toHaveLength(3000);
    expect(merged[0]?.id).toBe(`${SID}-0`);
    expect(merged[2999]?.id).toBe(`${SID}-2999`);
  });

  it('요청이 오가는 사이 도착한 라이브 줄은 뒤에 붙인다', () => {
    const merged = mergeDeepWindow(range(0, 2000), range(1500, 503));
    expect(merged).toHaveLength(2003);
    expect(merged[merged.length - 1]?.id).toBe(`${SID}-2002`);
    expect(new Set(merged.map((e) => e.id)).size).toBe(2003);
  });
});

describe('olderHistoryUrl', () => {
  it('기준 줄의 id·시각·쪽 크기를 싣고 경로 조각을 이스케이프한다', () => {
    const url = olderHistoryUrl('a/b', 's 1', evt(7), 1000);
    expect(url.startsWith('/api/subagent-streams/a%2Fb/s%201/older?')).toBe(true);
    const q = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    expect(q.get('beforeId')).toBe(`${SID}-7`);
    expect(q.get('beforeTs')).toBe(String(1_700_000_000_007));
    expect(q.get('limit')).toBe('1000');
  });
});

describe('requestOlderStreamHistory', () => {
  const fetchMock = vi.fn<(input: string) => Promise<Response>>();

  beforeEach(() => {
    resetStreamHistoryRequests();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    useGraphStore.setState({
      subAgentStreams: {},
      streamLastActivity: {},
      deepRestoredSessions: {},
      streamHistoryExtra: {},
      streamHistoryDone: {},
      ideOverlays: {},
      subAgents: {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('깊게 받은 세션은 버퍼 첫 줄 앞 한 쪽을 받아 앞에 붙인다', async () => {
    useGraphStore.setState({ subAgentStreams: { [SID]: range(1000, 2000) }, deepRestoredSessions: { [SID]: true } });
    fetchMock.mockResolvedValueOnce(json({ events: range(0, 1000), hasMore: true }));

    const { wait, settled } = request();
    expect(wait).toBe(0);
    await settled;

    const url = fetchMock.mock.calls[0]?.[0] ?? '';
    expect(url).toContain(`/older?`);
    expect(url).toContain(`beforeId=${SID}-1000`);
    expect(url).toContain(`limit=${STREAM_HISTORY_PAGE_EVENTS}`);
    const st = useGraphStore.getState();
    expect(st.subAgentStreams[SID]).toHaveLength(3000);
    expect(st.subAgentStreams[SID]?.[0]?.id).toBe(`${SID}-0`);
    expect(st.streamHistoryExtra[SID]).toBe(1000);
    expect(st.streamHistoryDone[SID]).toBeUndefined();
  });

  it('서버가 그 세션을 못 찾으면 "더 없음"으로 굳히지 않고 잠시 쉬었다 다시 묻는다', async () => {
    useGraphStore.setState({ subAgentStreams: { [SID]: range(1000, 2000) }, deepRestoredSessions: { [SID]: true } });
    fetchMock.mockResolvedValueOnce(json({ events: [], hasMore: false, unresolved: true }));

    await request().settled;

    expect(useGraphStore.getState().streamHistoryDone[SID]).toBeUndefined();
    expect(useGraphStore.getState().subAgentStreams[SID]).toHaveLength(2000);
    const again = requestOlderStreamHistory(AGENT, SID);
    expect(again).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('오류 응답·네트워크 실패도 쉬었다 다시 묻는다', async () => {
    useGraphStore.setState({ subAgentStreams: { [SID]: range(1000, 2000) }, deepRestoredSessions: { [SID]: true } });
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    await request().settled;

    expect(requestOlderStreamHistory(AGENT, SID)).toBeGreaterThan(0);
    expect(useGraphStore.getState().streamHistoryDone[SID]).toBeUndefined();
  });

  it('받는 사이 창이 교체되면 그 쪽은 버리고 곧바로 새 기준으로 다시 물을 수 있다', async () => {
    useGraphStore.setState({ subAgentStreams: { [SID]: range(1000, 2000) }, deepRestoredSessions: { [SID]: true } });
    let respond!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => { respond = r; }));

    const { settled } = request();
    // 진행 중에는 겹쳐 청하지 않는다.
    expect(requestOlderStreamHistory(AGENT, SID)).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    useGraphStore.setState({ subAgentStreams: { [SID]: range(1500, 2000) } });
    respond(json({ events: range(0, 1000), hasMore: true }));
    await settled;

    expect(useGraphStore.getState().subAgentStreams[SID]?.[0]?.id).toBe(`${SID}-1500`);
    expect(useGraphStore.getState().streamHistoryExtra[SID]).toBeUndefined();

    fetchMock.mockResolvedValueOnce(json({ events: range(500, 1000), hasMore: true }));
    const next = request();
    expect(next.wait).toBe(0);
    await next.settled;
    expect(fetchMock.mock.calls[1]?.[0]).toContain(`beforeId=${SID}-1500`);
    expect(useGraphStore.getState().subAgentStreams[SID]?.[0]?.id).toBe(`${SID}-500`);
  });

  it('깊은 복원이 안 된 세션(분할의 초점 밖 칸)은 과거보다 깊은 창부터 받는다', async () => {
    useGraphStore.setState({
      subAgentStreams: { [SID]: range(1500, 503) },
      ideOverlays: { w: { agentId: AGENT, activeSessionId: 'sub-other' } as unknown as IDEOverlayState },
    });
    fetchMock.mockResolvedValueOnce(json({ events: range(0, 2000) }));

    await request().settled;

    const url = fetchMock.mock.calls[0]?.[0] ?? '';
    expect(url).toBe(`/api/subagent-streams/${AGENT}/${SID}`);
    const st = useGraphStore.getState();
    expect(st.deepRestoredSessions[SID]).toBe(true);
    expect(st.subAgentStreams[SID]).toHaveLength(2003);
    expect(st.subAgentStreams[SID]?.[0]?.id).toBe(`${SID}-0`);
  });

  it('창의 활성 세션은 창이 깊은 복원을 끝낼 때까지 겹쳐 받지 않는다', () => {
    useGraphStore.setState({
      subAgentStreams: { [SID]: range(1500, 500) },
      ideOverlays: { w: { agentId: AGENT, activeSessionId: SID } as unknown as IDEOverlayState },
    });

    expect(requestOlderStreamHistory(AGENT, SID)).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('끝 표식이 선 세션·빈 버퍼는 묻지 않는다', () => {
    useGraphStore.setState({
      subAgentStreams: { [SID]: range(0, 10), 'sub-empty': [] },
      deepRestoredSessions: { [SID]: true, 'sub-empty': true },
      streamHistoryDone: { [SID]: true },
    });

    expect(requestOlderStreamHistory(AGENT, SID)).toBe(0);
    expect(requestOlderStreamHistory(AGENT, 'sub-empty')).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
