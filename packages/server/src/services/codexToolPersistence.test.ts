import { expect, it, vi } from 'vitest';
vi.mock('./userDefaultsService.js', () => ({ userDefaultsService: { get: () => ({ updatedAt: 1 }), subscribe: () => () => {} } }));
const { ProjectGraph } = await import('./projectGraph.js');

it('preserves Codex tool decisions through saving, checkpoint restoration and explicit reset', () => {
  const graph = new ProjectGraph();
  const project = graph.registerProject(process.cwd());
  const agent = graph.createCustomAgent('Tool permission fixture', undefined, project.name);
  const provider = { kind: 'codex-cli' as const, modelId: 'test', reasoningSummary: 'detailed' as const, personality: 'pragmatic' as const, serviceTier: 'fast', autoCompactTokenLimit: 80000, networkAccess: false, codexTools: { shell: 'deny' as const, edit: 'ask' as const } };
  graph.setAgentConfig(agent.id, { ...graph.getAgentConfig(agent.id)!, provider });
  const restored = new ProjectGraph();
  restored.restoreFromCheckpoint(JSON.parse(JSON.stringify(graph.toProjectCheckpoint(project.name))));
  expect(restored.getAgentConfig(agent.id)?.provider?.codexTools).toEqual(provider.codexTools);
  expect(restored.getAgentConfig(agent.id)?.provider).toMatchObject(provider);
  const saved = restored.getAgentConfig(agent.id)!;
  restored.setAgentConfig(agent.id, { ...saved, provider: { ...saved.provider!, codexTools: {} } });
  expect(restored.getAgentConfig(agent.id)?.provider?.codexTools).toEqual({});
});
