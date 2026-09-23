import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubAgent, SubAgentStreamEvent } from '@vibisual/shared';
import { STREAM_EVENTS_MAX_PER_SESSION } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { restoreStreamWindow } from './streamRestore.js';
import { resyncOpenStreams } from './streamResync.js';
import { resetStreamHistoryRequests, resyncDeepWindow } from './streamHistory.js';

const AGENT = 'restore-agent';
const SID = 'restore-session';
function event(n: number): SubAgentStreamEvent {
  return { id: `e-${n}`, parentAgentId: AGENT, subAgentId: SID, timestamp: 10_000 + n, eventType: 'text', content: `line ${n}` };
}
function range(from: number, to: number): SubAgentStreamEvent[] {
  return Array.from({ length: to - from + 1 }, (_, i) => event(from + i));
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}
function olderPage(url: string): Response {
  const query = new URL(url, 'https://fixture.invalid').searchParams;
  const end = Number(query.get('beforeId')?.slice(2));
  const start = Math.max(0, end - Number(query.get('limit')));
  return json({ events: range(start, end - 1), hasMore: start > 0 });
}
function buffer(): SubAgentStreamEvent[] {
  return useGraphStore.getState().subAgentStreams[SID] ?? [];
}
function ids(events: readonly SubAgentStreamEvent[]): string[] { return events.map((e) => e.id); }
function reconnect(): number {
  useGraphStore.getState().markStreamsStale();
  return useGraphStore.getState().streamRestoreEpoch;
}

describe('long reconnect seam restoration through existing /older pages', () => {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>();
  beforeEach(() => {
    resetStreamHistoryRequests();
    fetchMock.mockReset().mockImplementation(async (url) => olderPage(url));
    vi.stubGlobal('fetch', fetchMock);
    useGraphStore.setState({
      subAgentStreams: {}, streamLastActivity: {}, deepRestoredSessions: {}, streamHistoryExtra: {}, streamHistoryDone: {},
      streamRestoreEpoch: 0, streamReconnectAnchors: {}, ideOverlays: {}, ideSplits: {},
      activeProject: 'restore-project', subAgents: { [AGENT]: [{ id: SID }] as unknown as SubAgent[] },
    });
    useGraphStore.getState().openIDEOverlay(AGENT);
    useGraphStore.getState().setIDEActiveSession(SID);
    useGraphStore.getState().loadStreamBuffers({ [SID]: range(0, 100) }, 'deep');
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('fills 7,899 missed events, keeps delayed live output, and does not immediately trim the joined history', async () => {
    const epoch = reconnect();
    let respond!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { respond = resolve; }));
    const pending = restoreStreamWindow(AGENT, SID, range(6000, 7999), { epoch });
    useGraphStore.getState().appendStreamEvent(event(8000));
    expect(ids(buffer())).toEqual(ids([...range(0, 100), event(8000)]));
    expect(useGraphStore.getState().deepRestoredSessions[SID]).toBeUndefined();

    respond(olderPage(fetchMock.mock.calls[0]![0]));
    expect(await pending).toBe(true);
    expect(ids(buffer())).toEqual(ids(range(0, 8000)));
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(useGraphStore.getState().streamHistoryExtra[SID]).toBe(8001 - STREAM_EVENTS_MAX_PER_SESSION);
    expect(useGraphStore.getState().streamReconnectAnchors[SID]).toBeUndefined();
    useGraphStore.getState().appendStreamEvents([event(8000), event(8001)]);
    expect(ids(buffer())).toEqual(ids(range(0, 8001)));
  });

  it('joins even when all 8,000 events have the same timestamp, using ids as the page boundary', async () => {
    const sameTime = (events: SubAgentStreamEvent[]): SubAgentStreamEvent[] => events.map((e) => ({ ...e, timestamp: 100 }));
    useGraphStore.setState({ subAgentStreams: { [SID]: sameTime(range(0, 100)) } });
    const epoch = reconnect();
    fetchMock.mockImplementation(async (url) => {
      const page = await olderPage(url).json() as { events: SubAgentStreamEvent[]; hasMore: boolean };
      return json({ ...page, events: sameTime(page.events) });
    });
    useGraphStore.getState().appendStreamEvent({ ...event(8000), timestamp: 100 });
    expect(await restoreStreamWindow(AGENT, SID, sameTime(range(6000, 7999)), { epoch })).toBe(true);
    expect(ids(buffer())).toEqual(ids(range(0, 8000)));
    expect(new Set(ids(buffer())).size).toBe(8001);
  });

  it('leaves a failed page uncommitted and retries from the original seam', async () => {
    const epoch = reconnect();
    fetchMock.mockImplementationOnce(async (url) => olderPage(url)).mockResolvedValueOnce(json({}, 503));
    expect(await restoreStreamWindow(AGENT, SID, range(6000, 7999), { epoch })).toBe(false);
    expect(ids(buffer())).toEqual(ids(range(0, 100)));
    expect(useGraphStore.getState().streamReconnectAnchors[SID]?.id).toBe('e-100');
    expect(useGraphStore.getState().deepRestoredSessions[SID]).toBeUndefined();

    expect(await restoreStreamWindow(AGENT, SID, range(6000, 7999), { epoch })).toBe(true);
    expect(ids(buffer())).toEqual(ids(range(0, 7999)));
  });

  it('rejects an old delayed response after another reconnect and preserves the earliest unfinished seam', async () => {
    let respond!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { respond = resolve; }));
    const old = restoreStreamWindow(AGENT, SID, range(6000, 7999), { epoch: reconnect() });
    useGraphStore.getState().appendStreamEvent(event(8000));
    const epoch = reconnect();
    expect(useGraphStore.getState().streamReconnectAnchors[SID]?.id).toBe('e-100');
    expect(await restoreStreamWindow(AGENT, SID, range(6500, 8499), { epoch })).toBe(true);
    respond(olderPage(fetchMock.mock.calls[0]![0]));
    expect(await old).toBe(false);
    expect(ids(buffer())).toEqual(ids(range(0, 8499)));
    expect(useGraphStore.getState().deepRestoredSessions[SID]).toBe(true);
  });

  it('main-tab bulk reconnect also recovers the full middle behind its shallow tail', async () => {
    useGraphStore.getState().setIDEActiveSession(null);
    fetchMock.mockImplementation(async (url) => url.includes('/older?')
      ? olderPage(url)
      : json({ streams: { [SID]: range(7500, 7999) } }));
    resyncOpenStreams();
    useGraphStore.getState().appendStreamEvent(event(8000));
    await vi.waitFor(() => expect(buffer()).toHaveLength(8001));
    expect(ids(buffer())).toEqual(ids(range(0, 8000)));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/subagent-streams/${AGENT}`);
  });

  it('an already overlapping server window does not request older pages', async () => {
    expect(await restoreStreamWindow(AGENT, SID, range(50, 199), { epoch: reconnect() })).toBe(true);
    expect(ids(buffer())).toEqual(ids(range(0, 199)));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an unfocused split starts a new restore immediately even while the previous reconnect is pending', async () => {
    let respond!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { respond = resolve; }));
    reconnect();
    resyncDeepWindow(AGENT, SID);
    reconnect();
    fetchMock.mockResolvedValueOnce(json({ events: range(6000, 7999) }));
    resyncDeepWindow(AGENT, SID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(buffer()).toHaveLength(8000));
    respond(json({ events: range(5000, 6999) }));
    await vi.waitFor(() => expect(useGraphStore.getState().deepRestoredSessions[SID]).toBe(true));
    expect(ids(buffer())).toEqual(ids(range(0, 7999)));
  });

  it('tab restoration also verifies a seam with equal timestamps without a reconnect marker', async () => {
    const sameTime = (events: SubAgentStreamEvent[]): SubAgentStreamEvent[] => events.map((e) => ({ ...e, timestamp: 100 }));
    useGraphStore.setState({ subAgentStreams: { [SID]: sameTime(range(0, 100)) } });
    fetchMock.mockImplementation(async (url) => {
      const page = await olderPage(url).json() as { events: SubAgentStreamEvent[]; hasMore: boolean };
      return json({ ...page, events: sameTime(page.events) });
    });
    expect(await restoreStreamWindow(AGENT, SID, sameTime(range(6000, 7999)), { epoch: 0 })).toBe(true);
    expect(ids(buffer())).toEqual(ids(range(0, 7999)));
  });

  it('cancelling the owning view while a page is pending cannot commit or issue more pages', async () => {
    let respond!: (response: Response) => void;
    let cancelled = false;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { respond = resolve; }));
    const pending = restoreStreamWindow(AGENT, SID, range(6000, 7999), { epoch: reconnect(), cancelled: () => cancelled });
    cancelled = true;
    respond(olderPage(fetchMock.mock.calls[0]![0]));
    expect(await pending).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ids(buffer())).toEqual(ids(range(0, 100)));
    expect(useGraphStore.getState().streamReconnectAnchors[SID]?.id).toBe('e-100');
  });

  it('a repeated page with hasMore cannot mark an unjoined gap as restored', async () => {
    fetchMock.mockResolvedValue(json({ events: range(6000, 6999), hasMore: true }));
    expect(await restoreStreamWindow(AGENT, SID, range(6000, 7999), { epoch: reconnect() })).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ids(buffer())).toEqual(ids(range(0, 100)));
  });
});
