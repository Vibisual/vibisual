import { describe, expect, it, vi } from 'vitest';
import { buildSessionGoalState, type SessionGoal } from '@vibisual/shared';

vi.mock('./userDefaultsService.js', () => ({
  userDefaultsService: { get: () => ({ updatedAt: 1 }), subscribe: () => () => {} },
}));

const { ProjectGraph } = await import('./projectGraph.js');

function promptState(goal: SessionGoal): string {
  return buildSessionGoalState({
    goalText: goal.text,
    percent: goal.percent,
    steps: goal.steps,
    authoredBy: goal.authoredBy,
    note: goal.note,
    revision: goal.revision,
  });
}

describe('session work continuity across prompt assembly', () => {
  it('keeps the task through a status question and plan update, while allowing an explicit replacement', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Continuity');
    const subAgentId = 'continuity-session';
    const task = 'Repair the export flow and verify the result';
    graph.seedSessionGoalFromCommand(subAgentId, { agentId: agent.id, command: task });
    graph.noteSessionGoalProgress(subAgentId, {
      source: 'agent',
      steps: [
        { text: 'Find the faulty path', status: 'done' },
        { text: 'Repair the export flow', status: 'in_progress' },
        { text: 'Verify exported output', status: 'pending' },
      ],
      note: 'The failure is isolated; implementation remains',
    });
    const before = graph.getSessionGoal(subAgentId)!;

    const question = 'Has the fix been applied yet?';
    graph.seedSessionGoalFromCommand(subAgentId, { agentId: agent.id, command: question });
    const resumed = graph.getSessionGoal(subAgentId)!;
    expect(resumed.text).toBe(task);
    expect(resumed.steps).toEqual(before.steps);
    expect(resumed.note).toBe(before.note);
    expect(resumed.percent).toBe(33);
    expect(resumed.revision).toBe(before.revision);
    expect(promptState(resumed)).toContain(task);
    expect(promptState(resumed)).toContain('- [~] Repair the export flow');
    expect(promptState(resumed)).toContain('- [ ] Verify exported output');
    expect(promptState(resumed)).not.toContain(question);

    graph.syncSessionGoalFromPlan(subAgentId, {
      agentId: agent.id,
      command: question,
      steps: [
        { text: 'Find the faulty path', status: 'done' },
        { text: 'Repair the export flow', status: 'done' },
        { text: 'Verify exported output', status: 'in_progress' },
      ],
    });
    const afterPlan = graph.getSessionGoal(subAgentId)!;
    expect(afterPlan.text).toBe(task);
    expect(afterPlan.percent).toBe(67);
    expect(afterPlan.steps.map((step) => step.id)).toEqual(before.steps.map((step) => step.id));
    expect(promptState(afterPlan)).toContain('- [~] Verify exported output');

    graph.noteSessionGoalProgress(subAgentId, {
      source: 'agent',
      goal: 'Build the explicitly requested import flow',
      steps: [{ text: 'Implement import', status: 'in_progress' }],
      note: 'The requested scope has changed',
    });
    const replacement = graph.getSessionGoal(subAgentId)!;
    expect(replacement.text).toBe('Build the explicitly requested import flow');
    expect(replacement.steps.map((step) => step.text)).toEqual(['Implement import']);
    expect(replacement.percent).toBe(0);
    expect(replacement.revision).toBe(before.revision + 1);
    graph.seedSessionGoalFromCommand(subAgentId, { agentId: agent.id, command: 'How is the import progressing?' });
    expect(promptState(graph.getSessionGoal(subAgentId)!)).toContain('Build the explicitly requested import flow');
    expect(promptState(graph.getSessionGoal(subAgentId)!)).not.toContain('Verify exported output');
  });
});
