import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CodexInventory } from '@vibisual/shared';
import { DEFAULT_IDE_OVERLAY, useGraphStore } from './graphStore.js';
import { codexInventoryScopeKey } from './codexInventoryClient.js';
import { CODEX_INVENTORY_RECENT_SCOPES } from './codexInventoryCache.js';

const fetchMock = vi.fn<typeof fetch>();
const inventory = (name: string): CodexInventory => ({
  skills: [{ name, path: `/${name}/SKILL.md` }], mcpServers: [], plugins: [], hooks: [], agentsDocs: [], checkedAt: 1,
});
const response = (name: string): Response => new Response(JSON.stringify(inventory(name)));
const stored = (agentId: string): CodexInventory | undefined => {
  const state = useGraphStore.getState();
  return state.codexInventories[codexInventoryScopeKey(state, agentId)];
};
function deferResponse(): { promise: Promise<Response>; finish: (response: Response) => void } {
  let finish!: (response: Response) => void;
  const promise = new Promise<Response>((resolve) => { finish = resolve; });
  return { promise, finish };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  useGraphStore.setState({
    codexInventory: null, codexInventories: {}, activeProject: '/a', ideOverlays: {},
    agentProjects: { a: '/a', b: '/b' },
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

it('keeps simultaneous panes separate when their responses arrive in reverse order', async () => {
  const a = deferResponse();
  const b = deferResponse();
  fetchMock.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const state = useGraphStore.getState();
  const pendingA = state.refreshCodexInventory('a', false);
  const pendingB = state.refreshCodexInventory('b', false);
  b.finish(response('b-only'));
  await pendingB;
  expect(stored('a')).toBeUndefined();
  expect(stored('b')).toEqual(inventory('b-only'));
  a.finish(response('a-only'));
  await pendingA;
  expect(stored('a')).toEqual(inventory('a-only'));
  expect(stored('b')).toEqual(inventory('b-only'));
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    '/api/codex-inventory/refresh?agentId=a', '/api/codex-inventory/refresh?agentId=b',
  ]);
});

it('does not apply an unscoped snapshot to either project inventory', async () => {
  fetchMock.mockResolvedValueOnce(response('a-only'));
  await useGraphStore.getState().refreshCodexInventory('a');
  useGraphStore.getState().applyCodexInventory(inventory('another-window'));
  expect(stored('a')).toEqual(inventory('a-only'));
  expect(stored('b')).toBeUndefined();
});

it('an agent moving projects cannot receive its old project’s delayed inventory', async () => {
  const old = deferResponse();
  fetchMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response('new-project'));
  const pendingOld = useGraphStore.getState().refreshCodexInventory('a', false);
  useGraphStore.setState({ agentProjects: { a: '/new-a', b: '/b' } });
  expect(stored('a')).toBeUndefined();
  await useGraphStore.getState().refreshCodexInventory('a', false);
  old.finish(response('old-project'));
  await pendingOld;
  expect(stored('a')).toEqual(inventory('new-project'));
});

it('cancels a queued reload when its agent moves and never caches new-project data under the old scope', async () => {
  const old = deferResponse();
  fetchMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response('new-project'));
  const { refreshCodexInventory } = useGraphStore.getState();
  const oldScope = codexInventoryScopeKey(useGraphStore.getState(), 'a');
  const pendingOld = refreshCodexInventory('a', false);
  const queuedOld = refreshCodexInventory('a');
  useGraphStore.setState({ agentProjects: { a: '/new-a', b: '/b' } });
  await refreshCodexInventory('a', false);
  old.finish(response('old-project'));
  await Promise.all([pendingOld, queuedOld]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(stored('a')).toEqual(inventory('new-project'));
  expect(useGraphStore.getState().codexInventories[oldScope]).toBeUndefined();
  useGraphStore.setState({ agentProjects: { a: '/a', b: '/b' } });
  expect(stored('a')).toBeUndefined();
});

it('an A-to-B-to-A move invalidates in-flight ownership and allows an independent fresh A query', async () => {
  const old = deferResponse();
  fetchMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response('fresh-a'));
  const { refreshCodexInventory } = useGraphStore.getState();
  const pendingOld = refreshCodexInventory('a', false);
  const queuedOld = refreshCodexInventory('a');
  useGraphStore.setState({ agentProjects: { a: '/new-a', b: '/b' } });
  useGraphStore.setState({ agentProjects: { a: '/a', b: '/b' } });
  const fresh = refreshCodexInventory('a', false);
  const callsBeforeOldCompletes = fetchMock.mock.calls.length;
  old.finish(response('stale-a'));
  await Promise.all([fresh, pendingOld, queuedOld]);
  expect(callsBeforeOldCompletes).toBe(2);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(stored('a')).toEqual(inventory('fresh-a'));
});

it.each([false, true])('preserves a post-import reload while an earlier read is pending (forced: %s)', async (force) => {
  const first = deferResponse();
  fetchMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(response('new-skill'));
  const { refreshCodexInventory } = useGraphStore.getState();
  const read = refreshCodexInventory('a', force);
  const otherPane = refreshCodexInventory('a', false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const reload = refreshCodexInventory('a');
  first.finish(response('before-import'));
  await Promise.all([read, otherPane, reload]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(stored('a')).toEqual(inventory('new-skill'));
});

it('keeps a queued refresh reserved while subscribers receive the initial result', async () => {
  const first = deferResponse();
  fetchMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(response('new-skill'));
  const { refreshCodexInventory } = useGraphStore.getState();
  const read = refreshCodexInventory('a', false);
  const reload = refreshCodexInventory('a');
  const followups: Promise<void>[] = [];
  const unsubscribe = useGraphStore.subscribe((state) => {
    if (!followups.length && stored('a')?.skills[0]?.name === 'before-import') {
      followups.push(state.refreshCodexInventory('a'));
    }
  });
  try {
    first.finish(response('before-import'));
    await Promise.all([read, reload]);
    await Promise.all(followups);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stored('a')).toEqual(inventory('new-skill'));
  } finally { unsubscribe(); }
});

it('a failed reload retains only that scope’s last inventory', async () => {
  fetchMock.mockResolvedValueOnce(response('a-only')).mockResolvedValueOnce(new Response('error', { status: 500 }));
  await useGraphStore.getState().refreshCodexInventory('a');
  await useGraphStore.getState().refreshCodexInventory('a');
  expect(stored('a')).toEqual(inventory('a-only'));
  expect(stored('b')).toBeUndefined();
});

it('inventory churn cannot evict another open pane or grow closed scope retention without bound', async () => {
  useGraphStore.setState({ ideOverlays: { pinned: { ...DEFAULT_IDE_OVERLAY, agentId: 'a', projectId: '/a', paneKey: 'pinned' } } });
  fetchMock.mockImplementation(async () => response('fixture'));
  await useGraphStore.getState().refreshCodexInventory('a', false);
  for (let i = 0; i < CODEX_INVENTORY_RECENT_SCOPES * 3; i++) {
    const agentId = `visited-${i}`;
    useGraphStore.setState({ agentProjects: { a: '/a', [agentId]: `/visited-${i}` } });
    await useGraphStore.getState().refreshCodexInventory(agentId, false);
  }
  expect(stored('a')).toEqual(inventory('fixture'));
  expect(Object.keys(useGraphStore.getState().codexInventories)).toHaveLength(CODEX_INVENTORY_RECENT_SCOPES + 1);
});
