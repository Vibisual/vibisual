import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGraphStore, countProjectBookmarks, selectProjectBookmarks } from './graphStore.js';
import type { BookmarkStore, IDEBookmark } from './graphStore.js';

/**
 * §5.5 #17-7 (프로젝트별로 갈라 담기) — IDE 북마크 보관함.
 *
 * 종전엔 전역 단일 배열이라 A 프로젝트에서 보관한 조각이 B 프로젝트 IDE 의 활동바 배지·사이드바 목록에
 * 그대로 떴다(어느 프로젝트를 봐도 같은 "4"). 이 배선이 끊기면 같은 증상이 조용히 돌아오므로,
 * **넣는 칸 · 보는 칸 · 지우는 길 · 옛 값 이관**을 여기서 못 박는다.
 */

type State = ReturnType<typeof useGraphStore.getState>;

const BOOKMARKS_KEY = 'vibisual:ideBookmarks';

/** 테스트용 localStorage — node 환경에는 없으므로 저장/이관 검증을 위해 심는다. */
function fakeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    setItem: (k: string, v: string) => { map.set(k, v); },
  } as Storage;
}

function bookmark(id: string, over: Partial<IDEBookmark> = {}): IDEBookmark {
  return {
    id,
    text: `text-${id}`,
    agentId: 'agent-1',
    sessionId: null,
    projectId: 'alpha',
    agentLabel: 'Agent 1',
    createdAt: 1,
    ...over,
  };
}

/** 화면(활동바 배지 · 사이드바 목록)이 읽는 상태 그대로. */
function scope(over: Partial<State> = {}): State {
  useGraphStore.setState({
    ideBookmarks: {},
    activeProject: 'alpha',
    agentProjects: {},
    projects: { alpha: {}, beta: {} } as unknown as State['projects'],
    stubProjects: {} as State['stubProjects'],
    ...over,
  });
  return useGraphStore.getState();
}

function saved(): BookmarkStore {
  return JSON.parse(globalThis.localStorage.getItem(BOOKMARKS_KEY) ?? '{}') as BookmarkStore;
}

describe('IDE 북마크 — 프로젝트별 보관함', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeStorage());
    scope();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('배지·목록은 보고 있는 프로젝트 칸만 본다', () => {
    scope({
      ideBookmarks: {
        alpha: [bookmark('a1'), bookmark('a2')],
        beta: [bookmark('b1', { projectId: 'beta' })],
      },
    });

    expect(countProjectBookmarks(useGraphStore.getState())).toBe(2);
    expect(selectProjectBookmarks(useGraphStore.getState()).map((b) => b.id)).toEqual(['a1', 'a2']);

    useGraphStore.setState({ activeProject: 'beta' });
    expect(countProjectBookmarks(useGraphStore.getState())).toBe(1);
    expect(selectProjectBookmarks(useGraphStore.getState()).map((b) => b.id)).toEqual(['b1']);
  });

  it('보관은 보고 있는 프로젝트 칸에 — 워크트리 에이전트(agentProjects 가 워크트리명)여도 부모 탭 칸', () => {
    scope({ agentProjects: { 'agent-1': 'alpha-wt-2' } });

    useGraphStore.getState().addBookmark({
      text: '보관할 조각',
      agentId: 'agent-1',
      sessionId: 'sub-1',
      projectId: 'alpha-wt-2', // IDEMainArea 가 넘기는 값 = agentProjects (워크트리명)
      agentLabel: 'Agent 1',
    });

    const store = useGraphStore.getState().ideBookmarks;
    expect(Object.keys(store)).toEqual(['alpha']);
    expect(store['alpha']).toHaveLength(1);
    expect(store['alpha']?.[0]?.text).toBe('보관할 조각');
    // 화면에서도 그 칸이 보이고, 저장까지 같은 모양으로 내려간다.
    expect(countProjectBookmarks(useGraphStore.getState())).toBe(1);
    expect(saved()['alpha']).toHaveLength(1);
  });

  it('최신이 앞 · 상한 200개는 프로젝트마다 따로 적용', () => {
    const many = Array.from({ length: 200 }, (_, i) => bookmark(`old-${i}`));
    scope({ ideBookmarks: { alpha: many, beta: [bookmark('b1', { projectId: 'beta' })] } });

    useGraphStore.getState().addBookmark({
      text: '새 조각',
      agentId: 'agent-1',
      sessionId: null,
      projectId: 'alpha',
      agentLabel: 'Agent 1',
    });

    const store = useGraphStore.getState().ideBookmarks;
    expect(store['alpha']).toHaveLength(200);
    expect(store['alpha']?.[0]?.text).toBe('새 조각');
    expect(store['alpha']?.at(-1)?.id).toBe('old-198'); // 가장 오래된 것만 밀려난다
    expect(store['beta']).toHaveLength(1); // 다른 프로젝트 칸은 무관
  });

  it('떠돌이 칸(프로젝트 미상 · 지금 목록에 없는 이름)은 어느 프로젝트에서도 보인다', () => {
    scope({
      ideBookmarks: {
        alpha: [bookmark('a1', { createdAt: 30 })],
        '': [bookmark('orphan', { projectId: null, createdAt: 20 })],
        'gone-project': [bookmark('stray', { projectId: 'gone-project', createdAt: 10 })],
      },
    });

    // 합쳐질 때는 최신(createdAt 내림차순)이 앞.
    expect(selectProjectBookmarks(useGraphStore.getState()).map((b) => b.id)).toEqual(['a1', 'orphan', 'stray']);
    expect(countProjectBookmarks(useGraphStore.getState())).toBe(3);

    useGraphStore.setState({ activeProject: 'beta' });
    expect(selectProjectBookmarks(useGraphStore.getState()).map((b) => b.id)).toEqual(['orphan', 'stray']);
  });

  it('프로젝트 목록을 아직 모르는 부팅 순간에는 떠돌이를 추측하지 않는다', () => {
    scope({
      projects: {} as unknown as State['projects'],
      stubProjects: {} as State['stubProjects'],
      ideBookmarks: { alpha: [bookmark('a1')], beta: [bookmark('b1', { projectId: 'beta' })] },
    });

    expect(selectProjectBookmarks(useGraphStore.getState()).map((b) => b.id)).toEqual(['a1']);
  });

  it('삭제는 어느 칸에 있든 id 로 찾아 지우고, 빈 칸은 남기지 않는다', () => {
    scope({
      ideBookmarks: {
        alpha: [bookmark('a1'), bookmark('a2')],
        beta: [bookmark('b1', { projectId: 'beta' })],
      },
    });

    // 지금 보고 있는 칸이 alpha 라도 beta 칸의 항목이 지워진다(떠돌이 정리 경로).
    useGraphStore.getState().removeBookmark('b1');
    expect(Object.keys(useGraphStore.getState().ideBookmarks)).toEqual(['alpha']);

    useGraphStore.getState().removeBookmark('a1');
    expect(useGraphStore.getState().ideBookmarks['alpha']?.map((b) => b.id)).toEqual(['a2']);
    expect(saved()['alpha']).toHaveLength(1);
  });

  it('부팅 이관 — 저장돼 있던 옛 전역 배열은 projectId 기준으로 갈라 담긴다', async () => {
    const legacy: IDEBookmark[] = [
      bookmark('a1'),
      bookmark('b1', { projectId: 'beta' }),
      bookmark('x1', { projectId: null }),
    ];
    vi.stubGlobal('localStorage', fakeStorage({ [BOOKMARKS_KEY]: JSON.stringify(legacy) }));

    vi.resetModules();
    const fresh = await import('./graphStore.js');
    const store = fresh.useGraphStore.getState().ideBookmarks;

    expect(store['alpha']?.map((b) => b.id)).toEqual(['a1']);
    expect(store['beta']?.map((b) => b.id)).toEqual(['b1']);
    expect(store['']?.map((b) => b.id)).toEqual(['x1']); // 프로젝트 미상은 떠돌이 칸으로
  });
});
