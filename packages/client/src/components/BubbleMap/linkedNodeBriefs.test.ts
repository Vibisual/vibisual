import { beforeEach, expect, it, vi } from 'vitest';
import { AppAgentPreparationError, getInternalApp, type AppAgentBriefBuilder } from '../../apps/registry.js';
import { composeLinkedBriefs } from './linkedNodeBriefs.js';

const { state } = vi.hoisted(() => ({ state: {
  appBubbles: [{ id: 'node', appId: 'sample', projectName: 'Project', ref: 'doc' }],
  projects: { project: { name: 'Project', path: '/project' } },
  setAppBubbleRef: vi.fn(),
} }));
vi.mock('../../stores/graphStore.js', () => ({ useGraphStore: { getState: () => state } }));
vi.mock('../../apps/registry.js', async (original) => ({
  ...await original<typeof import('../../apps/registry.js')>(), getInternalApp: vi.fn(),
}));

const node = { id: 'node', appName: 'Sample', label: 'Document', accepts: [] };
const build = vi.fn<AppAgentBriefBuilder>();
beforeEach(() => {
  build.mockReset();
  // This fixture only exercises the brief capability; the registry's visual fields are unused.
  vi.mocked(getInternalApp).mockReturnValue({ agentBrief: async () => build } as unknown as ReturnType<typeof getInternalApp>);
});

it('passes the original request and retains the app execution declaration', async () => {
  const requirements = { localTransport: true, runLimits: { maxMinutes: 120 } };
  build.mockResolvedValue({ text: 'Native commands', executionRequirements: requirements });
  expect(await composeLinkedBriefs([node], 'Original request')).toEqual([{ ...node, brief: 'Native commands', executionRequirements: requirements }]);
  expect(build).toHaveBeenCalledWith(expect.objectContaining({ request: 'Original request', projectId: '/project' }));
});

it('does not dispatch generic instructions after required preparation fails', async () => {
  build.mockRejectedValue(new AppAgentPreparationError('Document owner unavailable'));
  await expect(composeLinkedBriefs([node], 'Build')).rejects.toThrow('Document owner unavailable');
  build.mockRejectedValue(new Error('Optional preview unavailable'));
  expect(await composeLinkedBriefs([node], 'Build')).toEqual([node]);
});
