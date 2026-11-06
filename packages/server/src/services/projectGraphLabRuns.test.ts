import { describe, expect, it } from 'vitest';
import { LAB_MAX_VARIANTS, LAB_RUNS_MAX_PER_PROJECT } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';

/** §5.18 — 랩 레코드: 상한·결과 보존·상태 파생·재시작 정리·영속 왕복·고정 삭제 거절. */

const PROJECT_CWD = '/tmp/lab-project';

function makeGraph(): { graph: ProjectGraph; projectName: string } {
  const graph = new ProjectGraph();
  const info = graph.registerProject(PROJECT_CWD);
  return { graph, projectName: info.name };
}

function create(graph: ProjectGraph, projectName: string) {
  return graph.createLabRun({
    projectName, x: 0, y: 0, width: 240, height: 150, title: '모델 비교', task: 'Add a README section',
    variants: [{ label: 'opus', config: { model: 'opus' } }, { label: 'sonnet', config: { model: 'sonnet', effort: 'high' } }],
  });
}

describe('LabRun — 변형과 상한', () => {
  it('만들면 draft 이고 변형마다 id 가 붙는다', () => {
    const { graph, projectName } = makeGraph();
    const run = create(graph, projectName);
    expect(run.status).toBe('draft');
    expect(run.variants.map((v) => v.label)).toEqual(['opus', 'sonnet']);
    expect(run.variants.every((v) => /^lvar-/.test(v.id))).toBe(true);
  });

  it(`변형은 ${LAB_MAX_VARIANTS} 벌까지 — 넘치면 추가가 거절된다`, () => {
    const { graph, projectName } = makeGraph();
    const run = create(graph, projectName);
    while ((graph.getLabRun(run.id)?.variants.length ?? 0) < LAB_MAX_VARIANTS) graph.addLabVariant(run.id, 'more');
    expect(graph.addLabVariant(run.id, 'over')).toBeNull();
  });

  it(`프로젝트당 ${LAB_RUNS_MAX_PER_PROJECT} 장을 넘기면 끝난 것부터 오래된 순으로 버리고 고정한 것은 남긴다`, () => {
    const { graph, projectName } = makeGraph();
    const pinned = create(graph, projectName);
    graph.updateLabRun(pinned.id, { preservePinned: true });
    for (let i = 0; i < LAB_RUNS_MAX_PER_PROJECT + 2; i += 1) create(graph, projectName);
    const mine = graph.getLabRuns().filter((r) => r.projectName === projectName);
    expect(mine.length).toBeLessThanOrEqual(LAB_RUNS_MAX_PER_PROJECT + 1);
    expect(mine.some((r) => r.id === pinned.id)).toBe(true);
  });
});

describe('LabRun — 실행과 결과', () => {
  it('붙이면 running, 마감하면 done — 상태는 서버가 결과에서 계산한다', () => {
    const { graph, projectName } = makeGraph();
    const run = create(graph, projectName);
    const [a, b] = run.variants;
    graph.attachLabVariantRun(run.id, a!.id, { agentId: 'agent-a', sessionId: 'custom-a', startedAt: 1000 });
    graph.attachLabVariantRun(run.id, b!.id, { agentId: 'agent-b', sessionId: 'custom-b', startedAt: 1000 });
    expect(graph.getLabRun(run.id)?.status).toBe('running');
    expect(graph.findLabVariantByAgent('agent-b')?.variant.id).toBe(b!.id);
    graph.finishLabVariant(run.id, a!.id, { status: 'success', finishedAt: 4000, inputTokens: 10 });
    expect(graph.getLabRun(run.id)?.status).toBe('running');
    graph.finishLabVariant(run.id, b!.id, { status: 'failed', finishedAt: 5000, error: 'boom' });
    const done = graph.getLabRun(run.id)!;
    expect(done.status).toBe('done');
    expect(done.variants[0]?.result).toMatchObject({ status: 'success', durationMs: 3000, inputTokens: 10 });
    // 못 읽은 값은 채우지 않는다(§5.18 측정 없음 ≠ 0).
    expect(done.variants[0]?.result).not.toHaveProperty('outputTokens');
    expect(done.variants[0]?.result).not.toHaveProperty('costUsd');
  });

  it('변형 목록을 고쳐도 이미 잰 결과는 지킨다', () => {
    const { graph, projectName } = makeGraph();
    const run = create(graph, projectName);
    const a = run.variants[0]!;
    graph.attachLabVariantRun(run.id, a.id, { agentId: 'agent-a', sessionId: 'custom-a' });
    graph.finishLabVariant(run.id, a.id, { status: 'success', finishedAt: Date.now() });
    graph.setLabVariants(run.id, [{ id: a.id, label: 'opus renamed', config: { model: 'opus', effort: 'low' } }]);
    const after = graph.getLabRun(run.id)!;
    expect(after.variants).toHaveLength(1);
    expect(after.variants[0]).toMatchObject({ label: 'opus renamed', result: { status: 'success' } });
  });

  it('도는 중에는 과제를 못 바꾼다 — 표가 무엇을 비교했는지 잃지 않게', () => {
    const { graph, projectName } = makeGraph();
    const run = create(graph, projectName);
    graph.attachLabVariantRun(run.id, run.variants[0]!.id, { agentId: 'agent-a', sessionId: 'custom-a' });
    graph.updateLabRun(run.id, { task: 'something else' });
    expect(graph.getLabRun(run.id)?.task).toBe('Add a README section');
  });

  it('고정한 랩은 지워지지 않는다', () => {
    const { graph, projectName } = makeGraph();
    const run = create(graph, projectName);
    graph.updateLabRun(run.id, { preservePinned: true });
    expect(graph.deleteLabRun(run.id)).toBe(false);
    graph.updateLabRun(run.id, { preservePinned: false });
    expect(graph.deleteLabRun(run.id)).toBe(true);
  });
});

describe('LabRun — 영속', () => {
  it('체크포인트 왕복에서 변형·결과·승격 표시가 그대로 돌아오고, 돌던 변형은 stopped 로 내려온다', () => {
    const { graph, projectName } = makeGraph();
    const run = create(graph, projectName);
    const [a, b] = run.variants;
    graph.attachLabVariantRun(run.id, a!.id, { agentId: 'agent-a', sessionId: 'custom-a' });
    graph.finishLabVariant(run.id, a!.id, { status: 'success', finishedAt: Date.now() });
    graph.attachLabVariantRun(run.id, b!.id, { agentId: 'agent-b', sessionId: 'custom-b' });
    graph.markLabPromoted(run.id, a!.id);

    const fresh = new ProjectGraph();
    fresh.registerProject(PROJECT_CWD);
    fresh.restoreFromCheckpoint(graph.toProjectCheckpoint(projectName));
    const back = fresh.getLabRun(run.id)!;
    expect(back.task).toBe('Add a README section');
    expect(back.promotedVariantId).toBe(a!.id);
    expect(back.variants.map((v) => v.result?.status)).toEqual(['success', 'stopped']);
    expect(back.status).toBe('done');
  });
});
