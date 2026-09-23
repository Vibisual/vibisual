import { describe, expect, it, vi } from 'vitest';
import type { ProjectCheckpoint } from '@vibisual/shared';

vi.mock('./userDefaultsService.js', () => ({
  userDefaultsService: { get: () => ({ updatedAt: 1 }), subscribe: () => () => {} },
}));

const { ProjectGraph } = await import('./projectGraph.js');

function seed(): {
  graph: InstanceType<typeof ProjectGraph>;
  projectName: string;
  agent: ReturnType<InstanceType<typeof ProjectGraph>['createCustomAgent']>;
} {
  const graph = new ProjectGraph();
  const projectName = graph.registerProject(process.cwd()).name;
  const agent = graph.createCustomAgent('Checkpoint owner');
  return { graph, projectName, agent };
}

function diskCopy(cp: ProjectCheckpoint): ProjectCheckpoint {
  return JSON.parse(JSON.stringify(cp)) as ProjectCheckpoint;
}

describe('ProjectGraph checkpoint state continuity', () => {
  it('두 번째 프로젝트도 영구 삭제 묘비를 보존해 다음 저장에 넘긴다', () => {
    const { graph, projectName, agent } = seed();
    graph.removeBubble(agent.id, { purgeTaskEdges: true });
    const cp = diskCopy(graph.toProjectCheckpoint(projectName));
    expect(cp.deletedCustomAgentIds).toContain(agent.path);

    const merged = new ProjectGraph();
    merged.mergeFromCheckpoint(cp);
    merged.mergeFromCheckpoint(diskCopy(cp));

    expect(merged.toProjectCheckpoint(projectName).deletedCustomAgentIds).toEqual([agent.path]);
    expect(merged.toProjectCheckpoint(projectName).graph.agents[agent.path]).toBeUndefined();
  });

  it('병합한 삭제 묘비는 메모리에 이미 있는 다른 삭제 기록을 지우지 않는다', () => {
    const { graph, projectName, agent } = seed();
    const cp = diskCopy(graph.toProjectCheckpoint(projectName));
    graph.removeBubble(agent.id, { purgeTaskEdges: true });
    cp.graph.agents = {};
    cp.deletedCustomAgentIds = ['custom-previously-deleted'];

    graph.mergeFromCheckpoint(cp);

    expect(graph.toProjectCheckpoint(projectName).deletedCustomAgentIds).toEqual([
      agent.path, 'custom-previously-deleted',
    ]);
  });

  it('설정 없는 체크포인트를 같은 인스턴스에 복원하면 이전 오버라이드를 남기지 않는다', () => {
    const { graph, projectName, agent } = seed();
    const cp = diskCopy(graph.toProjectCheckpoint(projectName));
    const configured = diskCopy(cp);
    configured.agentConfigOverrides = { [agent.id]: { permissionMode: 'plan' } };
    graph.restoreFromCheckpoint(configured);
    expect(graph.getAgentConfigOverrides(agent.id)?.permissionMode).toBe('plan');

    delete cp.agentConfigOverrides;
    delete cp.agentConfigs;
    graph.restoreFromCheckpoint(cp);

    expect(graph.getAgentConfigOverrides(agent.id)).toBeUndefined();
    expect(graph.toProjectCheckpoint(projectName).agentConfigOverrides).toBeUndefined();
  });

  it('목표 진행률과 설정은 저장 왕복하고 오래된 병합이 현재 값을 덮지 않는다', () => {
    const { graph, projectName, agent } = seed();
    graph.setSessionGoal({ agentId: agent.id, subAgentId: 'sub-checkpoint', text: '저장 안정화' });
    graph.noteSessionGoalProgress('sub-checkpoint', { percent: 40, note: '확인', source: 'agent' });
    const cp = diskCopy(graph.toProjectCheckpoint(projectName));
    cp.agentConfigOverrides = { [agent.id]: { permissionMode: 'plan' } };

    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(diskCopy(cp));
    expect(restored.getSessionGoal('sub-checkpoint')).toEqual(cp.sessionGoals?.['sub-checkpoint']);
    expect(restored.getAgentConfigOverrides(agent.id)?.permissionMode).toBe('plan');

    restored.noteSessionGoalProgress('sub-checkpoint', { percent: 80, note: '진행', source: 'agent' });
    const newer = diskCopy(restored.toProjectCheckpoint(projectName));
    newer.agentConfigOverrides = { [agent.id]: { permissionMode: 'acceptEdits' } };
    restored.restoreFromCheckpoint(newer);
    restored.mergeFromCheckpoint(diskCopy(cp));

    expect(restored.getSessionGoal('sub-checkpoint')?.percent).toBe(80);
    expect(restored.getSessionGoal('sub-checkpoint')?.history).toHaveLength(2);
    expect(restored.getAgentConfigOverrides(agent.id)?.permissionMode).toBe('acceptEdits');
  });
});
