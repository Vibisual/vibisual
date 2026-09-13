import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { useGraphStore } from './graphStore.js';

/**
 * §5.4 #14-4 — "닫은 탭 다시 열기"의 **클라 쪽 배선**을 못 박는다.
 *
 * 서버가 목록의 SSOT 라 쌓기·꺼내기 규칙은 `server/src/closedTabs.test.ts` 가 지킨다. 여기서
 * 지키는 것은 그 결과가 화면에 앉는 두 자리다.
 *
 * ① **닫자마자 되열면 탭이 바로 보여야 한다.** 탭바는 `closingProjectPaths` 에 든 탭을 안 그리고,
 *    그 표시는 "서버 truth 에서 사라지면" 걷힌다. 그런데 되열면 서버 truth 에 **도로 실려 오므로**
 *    그 조건이 영영 안 서고, 유예 5초가 지나서야 탭이 나타난다 — 되돌리기가 주 사용례인 기능에서
 *    "눌러도 아무 반응 없음"이 그대로 재현되는 자리다.
 * ② **iframe 탭은 클라가 되살린다.** 서버는 그 탭의 존재를 모르므로 꺼내 준 항목으로 여기서
 *    다시 열어야 한다 — 안 하면 목록에서는 사라지는데 탭은 안 열리는, 되돌릴 수도 없는 상태가 된다.
 */

const ORIGINAL_FETCH = globalThis.fetch;

/** `fetch` 한 번을 이 응답으로 답하게 한다. 호출 인자도 함께 돌려준다. */
function stubFetch(status: number, body: unknown): { calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), ...(init ? { init } : {}) });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
  return { calls };
}

describe('reopenClosedTab — 되열기가 화면에 앉는 자리', () => {
  beforeEach(() => {
    useGraphStore.setState({ closingProjectPaths: {}, iframeTabs: [], activeIframeId: null });
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it('프로젝트를 되열면 **닫는 중 표시를 그 자리에서 걷는다** — 유예 5초를 기다리지 않는다', async () => {
    // 방금 닫아서 탭이 숨겨진 상태(× 를 누른 프레임과 같다).
    useGraphStore.setState({ closingProjectPaths: { 'c:/work/alpha': Date.now() } });

    stubFetch(200, {
      ok: true,
      entry: { key: 'p:alpha', kind: 'project', label: 'alpha', closedAt: 1, path: 'C:/work/alpha' },
      project: { name: 'alpha' },
    });

    const result = await useGraphStore.getState().reopenClosedTab();
    expect(result).toBe('ok');
    // 표시가 남아 있으면 탭바가 그 탭을 계속 안 그린다.
    expect(useGraphStore.getState().closingProjectPaths).toEqual({});
  });

  it('키를 주면 그 키를 그대로 서버에 싣고, 안 주면 본문을 비운다(= 가장 최근 것)', async () => {
    const a = stubFetch(200, {
      ok: true,
      entry: { key: 'p:beta', kind: 'project', label: 'beta', closedAt: 1, path: '/w/beta' },
      project: { name: 'beta' },
    });
    await useGraphStore.getState().reopenClosedTab('p:beta');
    expect(a.calls[0]?.url).toContain('/api/closed-tabs/reopen');
    expect(JSON.parse(String(a.calls[0]?.init?.body))).toEqual({ key: 'p:beta' });

    const b = stubFetch(200, {
      ok: true,
      entry: { key: 'p:beta', kind: 'project', label: 'beta', closedAt: 1, path: '/w/beta' },
      project: { name: 'beta' },
    });
    await useGraphStore.getState().reopenClosedTab();
    expect(JSON.parse(String(b.calls[0]?.init?.body))).toEqual({});
  });

  it('iframe 항목은 클라가 되살린다 — 서버는 그 탭의 존재를 모른다', async () => {
    stubFetch(200, {
      ok: true,
      entry: { key: 'i:tab-7', kind: 'iframe', label: 'Dev server', closedAt: 1, url: 'http://localhost:5173', serverKind: 'frontend' },
    });

    const result = await useGraphStore.getState().reopenClosedTab('i:tab-7');
    expect(result).toBe('ok');
    const { iframeTabs, activeIframeId } = useGraphStore.getState();
    expect(iframeTabs).toHaveLength(1);
    expect(iframeTabs[0]).toMatchObject({
      id: 'tab-7',
      url: 'http://localhost:5173',
      label: 'Dev server',
      serverKind: 'frontend',
    });
    // 되열었으면 그 탭을 보고 있어야 한다 — 열기만 하고 안 보이면 되돌린 것이 아니다.
    expect(activeIframeId).toBe('tab-7');
  });

  it('serverKind 가 없는 옛 항목도 되살아난다(기본 frontend) — 되열 수 있는 것을 버리지 않는다', async () => {
    stubFetch(200, {
      ok: true,
      entry: { key: 'i:old', kind: 'iframe', label: 'old', closedAt: 0, url: 'http://x' },
    });
    await useGraphStore.getState().reopenClosedTab('i:old');
    expect(useGraphStore.getState().iframeTabs[0]?.serverKind).toBe('frontend');
  });

  it('빈 스택(404)은 실패가 아니라 `empty` — 조용히 아무 일도 안 일어난다', async () => {
    stubFetch(404, { ok: false, error: 'no closed tab to reopen' });
    expect(await useGraphStore.getState().reopenClosedTab()).toBe('empty');
    expect(useGraphStore.getState().iframeTabs).toEqual([]);
  });

  it('폴더가 사라졌으면(410) `missing` — 서버가 항목을 버렸고 화면은 그 사실을 안다', async () => {
    stubFetch(410, {
      ok: false,
      error: 'missing',
      entry: { key: 'p:gone', kind: 'project', label: 'gone', closedAt: 1, path: '/w/gone' },
    });
    expect(await useGraphStore.getState().reopenClosedTab('p:gone')).toBe('missing');
  });

  it('요청 자체가 못 나가면 `error` — 던지지 않는다(단축키 한 번에 앱이 죽으면 안 된다)', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await useGraphStore.getState().reopenClosedTab()).toBe('error');
  });
});

describe('closeIframeTab — 닫으면 스택에 신고한다', () => {
  beforeEach(() => {
    useGraphStore.setState({
      iframeTabs: [{ id: 'tab-1', url: 'http://localhost:3000', label: 'API', serverKind: 'backend' }],
      activeIframeId: 'tab-1',
      closingProjectPaths: {},
    });
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it('탭바 키 형식(`i:<id>`) 그대로 되열 재료를 함께 보낸다', () => {
    const { calls } = stubFetch(200, { ok: true });
    useGraphStore.getState().closeIframeTab('tab-1');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/api/closed-tabs');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      key: 'i:tab-1',
      label: 'API',
      url: 'http://localhost:3000',
      serverKind: 'backend',
    });
    // 신고와 무관하게 탭은 닫힌다.
    expect(useGraphStore.getState().iframeTabs).toEqual([]);
    expect(useGraphStore.getState().activeIframeId).toBeNull();
  });

  it('신고가 실패해도 탭은 닫힌다 — 되돌리기 손잡이 하나 때문에 닫기가 막히면 안 된다', () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(() => useGraphStore.getState().closeIframeTab('tab-1')).not.toThrow();
    expect(useGraphStore.getState().iframeTabs).toEqual([]);
  });

  it('없는 탭을 닫으면 아무것도 신고하지 않는다(유령 항목을 만들지 않는다)', () => {
    const { calls } = stubFetch(200, { ok: true });
    useGraphStore.getState().closeIframeTab('does-not-exist');
    expect(calls).toHaveLength(0);
  });
});
