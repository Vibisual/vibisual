import { describe, expect, it, vi } from 'vitest';
import { CONTEXT_SOURCE_IDS } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { ProjectGraphManager } from './projectGraphManager.js';

vi.mock('./userDefaultsService.js', () => ({ userDefaultsService: { get: () => ({ updatedAt: 1 }), subscribe: () => () => {} } }));

function setup() {
  const graph = new ProjectGraph();
  const agent = graph.createCustomAgent('Goal scope');
  const manager = new ProjectGraphManager();
  const instances = (manager as unknown as { instances: Map<string, ProjectGraph> }).instances;
  instances.clear();
  instances.set('fixture', graph);
  return { graph, agent, manager };
}

describe('goal activation uses the context switch for automatic goal tracking', () => {
  it('does not create goals from commands or plans by default', () => {
    const { agent, manager } = setup();
    expect(manager.isSessionGoalEnabled(agent.id, 'sub')).toBe(false);
    expect(manager.seedSessionGoalFromCommand('sub', { agentId: agent.id, command: 'Build a feature' })).toBeUndefined();
    expect(manager.syncSessionGoalFromPlan('sub', { agentId: agent.id, command: 'Build a feature', steps: [{ text: 'Implement it' }] })).toBeUndefined();
    expect(manager.getSessionGoal('sub')).toBeUndefined();
  });

  it('respects agent and session overrides and retains previous goals after disabling', () => {
    const { graph, agent, manager } = setup();
    graph.setContextOverride({ level: 'agent', agentId: agent.id }, CONTEXT_SOURCE_IDS.goal, true);
    expect(manager.isSessionGoalEnabled(agent.id, 'sub')).toBe(true);
    expect(manager.seedSessionGoalFromCommand('sub', { agentId: agent.id, command: 'Build a feature' })).toBeDefined();
    graph.setContextOverride({ level: 'session', agentId: agent.id, subAgentId: 'sub' }, CONTEXT_SOURCE_IDS.goal, false);
    expect(manager.isSessionGoalEnabled(agent.id, 'sub')).toBe(false);
    expect(manager.isSessionGoalEnabled(agent.id, 'other')).toBe(true);
    expect(manager.syncSessionGoalFromPlan('sub', { agentId: agent.id, steps: [{ text: 'Should not be recorded' }] })).toBeUndefined();
    expect(manager.getSessionGoal('sub')?.steps).toEqual([]);
    expect(manager.getSessionGoal('sub')?.text).toBe('Build a feature');
    graph.setContextOverride({ level: 'session', agentId: agent.id, subAgentId: 'sub' }, CONTEXT_SOURCE_IDS.goal, null);
    expect(manager.isSessionGoalEnabled(agent.id, 'sub')).toBe(true);
  });

  it.each(['default', 'disabled'] as const)('%s-off rejects automatic progress for existing goals but allows user edits', (mode) => {
    const { graph, agent, manager } = setup();
    if (mode === 'disabled') {
      graph.setContextOverride({ level: 'agent', agentId: agent.id }, CONTEXT_SOURCE_IDS.goal, true);
    }
    manager.setSessionGoal({ agentId: agent.id, subAgentId: 'sub', text: 'Existing goal' });
    if (mode === 'disabled') {
      expect(manager.noteSessionGoalProgress('sub', { percent: 20, source: 'agent' })?.percent).toBe(20);
      graph.setContextOverride({ level: 'session', agentId: agent.id, subAgentId: 'sub' }, CONTEXT_SOURCE_IDS.goal, false);
    }
    const before = manager.getSessionGoal('sub');
    expect(manager.noteSessionGoalProgress('sub', { percent: 90, goal: 'Replacement', source: 'agent' })).toBeUndefined();
    expect(manager.noteSessionGoalProgress('sub', { steps: [{ text: 'Automatic step', status: 'done' }], source: 'plan' })).toBeUndefined();
    expect(manager.getSessionGoal('sub')).toEqual(before);
    expect(manager.noteSessionGoalProgress('sub', { percent: 50, source: 'user' })?.percent).toBe(50);
    expect(manager.setUserGoalSteps('sub', [{ text: 'Manual step', status: 'pending' }])?.steps.map((step) => step.text)).toEqual(['Manual step']);
  });
});
