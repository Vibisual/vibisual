import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppBubble, BubbleData } from '@vibisual/shared';
import { useGraphStore } from './graphStore.js';

function agent(id: string, patch: Partial<BubbleData> = {}): BubbleData {
  return { id, label: id, bubbleType: 'agent', path: id, status: 'idle', activity: 0, ...patch };
}

function app(id: string, patch: Partial<AppBubble> = {}): AppBubble {
  return { id, projectName: 'p', appId: 'video', x: 0, y: 0, width: 200, height: 120, createdAt: 1, ...patch };
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);
  useGraphStore.setState({
    agents: [agent('owner', { linksHidden: true, linkLens: 'files' }), agent('other')],
    agentLinkViewHolds: {},
    appBubbleLinkViewHolds: {},
  });
});

/** 서버 스냅샷 한 건 — 에이전트만 싣고 나머지는 빈 칸(위치 인자 순서는 `loadSnapshot` 선언 그대로). */
function snapshot(agents: BubbleData[]): void {
  const s = useGraphStore.getState();
  s.loadSnapshot({}, agents, [], {}, [], {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {},
    s.agentPhase, 0, {}, {}, {}, {}, {}, {}, {}, [], [], {}, {}, {});
}

/** 답을 우리가 정하는 PATCH 하나 — 서버가 아직 받지 않은 사이를 재현한다. 부르면 답하고 그 처리까지 기다린다. */
function deferPatch(): (ok: boolean) => Promise<void> {
  let resolve: (res: Response) => void = () => undefined;
  fetchMock.mockReturnValueOnce(new Promise<Response>((r) => { resolve = r; }));
  return async (ok) => {
    resolve(new Response('{}', { status: ok ? 200 : 409 }));
    await new Promise((r) => setTimeout(r, 0));
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('agent bubble visibility', () => {
  it('버블만 숨기면 연결선·보기 상태를 보존하고 해당 에이전트만 즉시 갱신한다', () => {
    const before = useGraphStore.getState().agents;
    useGraphStore.getState().setAgentLinkView('owner', { bubblesHidden: true });
    const after = useGraphStore.getState().agents;

    expect(after[0]).toMatchObject({ bubblesHidden: true, linksHidden: true, linkLens: 'files' });
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/bubble/owner/link-view'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bubblesHidden: true }),
    });
  });

  it('연결선 상태를 바꿔도 버블 숨김은 유지되고 버블을 보이면 기본값 칸이 사라진다', () => {
    useGraphStore.getState().setAgentLinkView('owner', { bubblesHidden: true });
    useGraphStore.getState().setAgentLinkView('owner', { hidden: false, lens: 'linked' });
    expect(useGraphStore.getState().agents[0]).toMatchObject({ bubblesHidden: true });
    expect(useGraphStore.getState().agents[0]?.linksHidden).toBeUndefined();

    useGraphStore.getState().setAgentLinkView('owner', { bubblesHidden: false });
    expect(useGraphStore.getState().agents[0]?.bubblesHidden).toBeUndefined();
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('/api/bubble/owner/link-view'),
      expect.objectContaining({ body: JSON.stringify({ bubblesHidden: false }) }));
  });

  it('같은 표시 값을 반복 적용해도 에이전트 배열 참조는 바뀌지 않는다', () => {
    useGraphStore.getState().setAgentLinkView('owner', { bubblesHidden: true });
    const before = useGraphStore.getState().agents;
    useGraphStore.getState().setAgentLinkView('owner', { bubblesHidden: true });
    expect(useGraphStore.getState().agents).toBe(before);
  });
});

describe('§5.4 #36 (H) — PATCH 전에 떠난 스냅샷이 누른 값을 되돌리지 않는다(2026-10-18 [연결선 보이기] 깜빡임)', () => {
  it('[연결선 보이기] 직후 옛 스냅샷이 와도 선은 숨김으로 돌아가지 않고, 서버가 받아들이면 붙들기를 놓는다', async () => {
    const answer = deferPatch();
    useGraphStore.getState().setAgentLinkView('owner', { hidden: false });
    const shown = useGraphStore.getState().agents;
    expect(shown[0]?.linksHidden).toBeUndefined();

    // 서버가 PATCH 를 받기 전에 떠난 스냅샷 — 서버 쪽은 아직 숨김이다.
    snapshot([agent('owner', { linksHidden: true, linkLens: 'files' }), agent('other')]);
    expect(useGraphStore.getState().agents[0]?.linksHidden).toBeUndefined();
    expect(useGraphStore.getState().agents).toBe(shown); // 다시 그릴 것도 없다
    expect(useGraphStore.getState().nodeMap['owner']?.linksHidden).toBeUndefined(); // 메뉴가 읽는 자리도 같은 값

    await answer(true);
    snapshot([agent('owner', { linkLens: 'files' }), agent('other')]);
    expect(useGraphStore.getState().agentLinkViewHolds).toEqual({});

    // 놓은 뒤로는 서버가 권위다 — 다른 창이 다시 숨기면 그대로 따른다.
    snapshot([agent('owner', { linksHidden: true, linkLens: 'files' }), agent('other')]);
    expect(useGraphStore.getState().agents[0]?.linksHidden).toBe(true);
  });

  it('[연결선 숨기기]도 같다 — 옛 스냅샷(보임)이 선을 다시 켜지 못한다', () => {
    useGraphStore.setState({ agents: [agent('owner', { linkLens: 'files' }), agent('other')] });
    deferPatch();
    useGraphStore.getState().setAgentLinkView('owner', { hidden: true });
    snapshot([agent('owner', { linkLens: 'files' }), agent('other')]);
    expect(useGraphStore.getState().agents[0]?.linksHidden).toBe(true);
  });

  it('[버블 숨기기]·보기 전환도 누른 칸만 붙든다 — 다른 칸은 서버 값 그대로', () => {
    deferPatch();
    useGraphStore.getState().setAgentLinkView('owner', { bubblesHidden: true });
    snapshot([agent('owner', { linksHidden: true, linkLens: 'files', label: '새 이름' }), agent('other')]);
    expect(useGraphStore.getState().agents[0]).toMatchObject({ bubblesHidden: true, linksHidden: true, label: '새 이름' });
  });

  it('PATCH 가 실패하면 곧바로 놓는다 — 다음 스냅샷의 서버 값(숨김)이 그대로 보인다', async () => {
    const answer = deferPatch();
    useGraphStore.getState().setAgentLinkView('owner', { hidden: false });
    await answer(false);
    expect(useGraphStore.getState().agentLinkViewHolds).toEqual({});
    snapshot([agent('owner', { linksHidden: true, linkLens: 'files' }), agent('other')]);
    expect(useGraphStore.getState().agents[0]?.linksHidden).toBe(true);
  });

  it('서버에 닿지 못해도(네트워크 오류) 붙들기를 놓는다', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    useGraphStore.getState().setAgentLinkView('owner', { hidden: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(useGraphStore.getState().agentLinkViewHolds).toEqual({});
  });

  it('§5.4 #36 (H) ①-2 [고정]도 같은 붙들기다 — 화면이 먼저 고정을 보이고, PATCH 전의 옛 스냅샷이 풀지 못한다', async () => {
    const answer = deferPatch();
    useGraphStore.getState().setAgentLinksPinned('owner', true);
    expect(useGraphStore.getState().agents[0]).toMatchObject({ linksPinned: true, linksHidden: true, linkLens: 'files' });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/bubble/owner/link-pin'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: true }),
    });

    snapshot([agent('owner', { linksHidden: true, linkLens: 'files' }), agent('other')]);
    expect(useGraphStore.getState().agents[0]?.linksPinned).toBe(true);

    await answer(true);
    snapshot([agent('owner', { linksHidden: true, linkLens: 'files', linksPinned: true }), agent('other')]);
    expect(useGraphStore.getState().agentLinkViewHolds).toEqual({});
  });

  it('[고정 풀기]는 칸을 지워서 적는다(서버와 같은 모양) — 다른 연결 보기 칸은 그대로', () => {
    useGraphStore.setState({ agents: [agent('owner', { linksPinned: true, linksHidden: true }), agent('other')] });
    useGraphStore.getState().setAgentLinksPinned('owner', false);
    const owner = useGraphStore.getState().agents[0];
    expect(owner?.linksPinned).toBeUndefined();
    expect(owner?.linksHidden).toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('/api/bubble/owner/link-pin'),
      expect.objectContaining({ body: JSON.stringify({ pinned: false }) }));
  });

  it('[이전 연결 다시 보기]는 서버에 다시 세우기를 부탁만 한다 — 화면은 다음 스냅샷이 그린다', () => {
    const before = useGraphStore.getState().agents;
    useGraphStore.getState().replayAgentLinks('owner');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/bubble/owner/link-replay'), { method: 'POST' });
    expect(useGraphStore.getState().agents).toBe(before);
  });

  it('앱 노드의 [연결선 보이기]도 같은 규칙이다 — 옛 스냅샷이 위성줄을 다시 숨기지 못한다', async () => {
    useGraphStore.setState({ appBubbles: [app('n1', { linksHidden: true })] });
    const answer = deferPatch();
    useGraphStore.getState().setAppBubbleLinksHidden('n1', false);
    const shown = useGraphStore.getState().appBubbles[0];
    expect(shown?.linksHidden).toBeUndefined();

    useGraphStore.getState().applyAppBubbles([app('n1', { linksHidden: true })]);
    expect(useGraphStore.getState().appBubbles[0]?.linksHidden).toBeUndefined();
    expect(useGraphStore.getState().appBubbles[0]).toBe(shown); // 붙드는 동안 노드를 다시 그리지 않는다

    await answer(true);
    useGraphStore.getState().applyAppBubbles([app('n1')]);
    expect(useGraphStore.getState().appBubbleLinkViewHolds).toEqual({});
    useGraphStore.getState().applyAppBubbles([app('n1', { linksHidden: true })]);
    expect(useGraphStore.getState().appBubbles[0]?.linksHidden).toBe(true);
  });
});
