import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CodexModelCatalog } from '@vibisual/shared';
import { useGraphStore } from './graphStore.js';

const fetchMock = vi.fn<typeof fetch>();
const catalog: CodexModelCatalog = {
  checkedAt: 1,
  models: [{ slug: 'old-model', displayName: 'Old', reasoningLevels: ['ultra'] }],
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  useGraphStore.setState({
    codexModels: catalog,
    userDefaults: { updatedAt: 1, engineConfigs: { codex: { provider: { kind: 'codex-cli', modelId: 'saved-model', reasoningEffort: 'ultra' } } } },
    agentConfigs: { saved: { model: '', tools: [], permissionMode: 'default', skills: [], provider: { kind: 'codex-cli', modelId: 'saved-model', reasoningEffort: 'ultra' } } },
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

it.each([
  { name: 'auth invalidation', models: [] },
  { name: 'websocket catalog', models: [{ slug: 'new-account-model', displayName: 'New', reasoningLevels: ['max'] }] },
])(
  'a delayed HTTP catalog cannot overwrite a newer $name',
  async ({ models }) => {
    let finish!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = useGraphStore.getState().refreshCodexModels(false);
    const newer: CodexModelCatalog = { models, checkedAt: 3 };
    useGraphStore.getState().applyCodexModels(newer);
    finish(new Response(JSON.stringify({ ...catalog, checkedAt: 2 })));
    await pending;
    expect(useGraphStore.getState().codexModels).toEqual(newer);
  },
);

it('a newer catalog updates choices without writing agent or global defaults', async () => {
  const { agentConfigs, userDefaults } = useGraphStore.getState();
  const next = { models: [], checkedAt: 2 };
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(next)));
  await useGraphStore.getState().refreshCodexModels(false);
  expect(useGraphStore.getState().codexModels).toEqual(next);
  expect(useGraphStore.getState().agentConfigs).toBe(agentConfigs);
  expect(useGraphStore.getState().userDefaults).toBe(userDefaults);
});
