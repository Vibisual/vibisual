import { describe, expect, it, vi } from 'vitest';
import type { OrchestraRun, OrchestraSettings, ProjectCheckpoint, WSMessage } from '@vibisual/shared';
vi.mock('./userDefaultsService.js', () => ({ userDefaultsService: { get: () => ({ updatedAt: 1 }), subscribe: () => () => {} } }));
const { ProjectGraph } = await import('./projectGraph.js');
const { broadcast, setBroadcastSink, resetSnapshotDeltaBaseline } = await import('../broadcastBus.js');

/**
 * §5.3 #10-4 — 오케스트라 설정·런의 영속 왕복.
 *
 * 영속 칸은 디스크 포맷(`toProjectCheckpoint`·`toCheckpoint`)·복원(`restoreFromCheckpoint`)·
 * 병합(`mergeFromCheckpoint`) 전부에 있어야 산다 — 하나라도 빠지면 껐다 켜면 켬/끔과 지휘 기록이 사라진다.
 * 여기서는 그 왕복과, 앱이 꺼질 때 돌던 지휘 턴(`conducting`)이 다시 켰을 때 `unreported` 로 닫히는지를 본다.
 */

function run(partial: Partial<OrchestraRun>): OrchestraRun {
  return {
    runId: 'orc-1',
    projectPath: '',
    agentId: 'conductor',
    commandId: 'cmd-1',
    userRequest: '로그인 화면을 고쳐 줘',
    engine: 'claude',
    phase: 'conducting',
    startedAt: 1000,
    memberAgentIds: [],
    inputTokens: 0,
    outputTokens: 0,
    ...partial,
  };
}

function seeded() {
  const graph = new ProjectGraph();
  const project = graph.registerProject(process.cwd());
  const conductor = graph.createCustomAgent('Orchestra conductor fixture', undefined, project.name);
  const settings: OrchestraSettings = {
    enabledProject: true,
    enabledAgents: { 'member-1': false },
    conductorClaudeModel: 'claude-opus-5[1m]',
    conductorPermission: 'inherit',
    askQuestions: true,
    memberEngine: 'auto',
    memberCodexModel: 'gpt-5.1-codex',
    maxMembers: 3,
    disabledStrategies: ['web', 'shell'],
  };
  graph.setOrchestraSettings(project.path, settings);
  graph.addOrchestraRun(
    run({
      runId: 'orc-done',
      projectPath: project.path,
      agentId: conductor.id,
      phase: 'dispatched',
      planAt: 2000,
      endedAt: 3000,
      plan: {
        intent: 'feature',
        topology: 'pipeline',
        chosen: [{ id: 'subagents', reason: '조사는 sonnet 멤버에게' }],
        skipped: [{ id: 'autoCompact', reason: '짧은 일' }],
        entryAgentId: 'member-1',
        note: '엔진은 역할마다 골랐다',
      },
      memberAgentIds: ['member-1', 'member-2'],
      createdMemberCount: 2,
      inputTokens: 12_000,
      outputTokens: 3_400,
    }),
  );
  graph.addOrchestraRun(
    run({ runId: 'orc-live', projectPath: project.path, agentId: conductor.id, commandId: 'cmd-2', startedAt: 4000 }),
  );
  return { graph, project, conductor };
}

function roundTrip(cp: ProjectCheckpoint): ProjectCheckpoint {
  return JSON.parse(JSON.stringify(cp)) as ProjectCheckpoint;
}

describe('오케스트라 영속 왕복', () => {
  it('toProjectCheckpoint → restoreFromCheckpoint — 설정·계획·만든 수·토큰이 그대로, 돌던 런은 unreported', () => {
    const { graph, project } = seeded();
    const cp = roundTrip(graph.toProjectCheckpoint(project.name));
    expect(cp.orchestraSettings?.memberEngine).toBe('auto');
    expect(cp.orchestraRuns).toHaveLength(2);

    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(cp);

    expect(restored.getOrchestraSettings(project.path)).toEqual(graph.getOrchestraSettings(project.path));
    const [done, live] = restored.getOrchestraRuns(project.path);
    expect(done).toEqual(graph.getOrchestraRuns(project.path)[0]);
    expect(done?.createdMemberCount).toBe(2);
    expect(done?.plan?.chosen).toEqual([{ id: 'subagents', reason: '조사는 sonnet 멤버에게' }]);
    expect(live?.runId).toBe('orc-live');
    expect(live?.phase).toBe('unreported');
    expect(typeof live?.endedAt).toBe('number');
  });

  it('toCheckpoint(단일 프로젝트 포맷)도 같은 칸을 싣는다', () => {
    const { graph, project } = seeded();
    const cp = roundTrip(graph.toCheckpoint());
    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(cp);
    expect(restored.getOrchestraSettings(project.path)?.disabledStrategies).toEqual(['web', 'shell']);
    expect(restored.findOrchestraRun('orc-done')?.inputTokens).toBe(12_000);
  });

  it('복원한 그래프의 스냅샷 요약이 프로젝트 이름 아래 설정과 런을 싣는다', () => {
    const { graph, project } = seeded();
    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(roundTrip(graph.toProjectCheckpoint(project.name)));
    const summary = restored.getOrchestraSummary()?.[project.name];
    expect(summary?.settings.enabledProject).toBe(true);
    expect(summary?.runs.map((r) => r.runId)).toEqual(['orc-done', 'orc-live']);
  });

  it('아무것도 정하지 않은 프로젝트는 칸을 싣지 않고, 복원해도 꺼짐이다', () => {
    const graph = new ProjectGraph();
    const project = graph.registerProject(process.cwd());
    const cp = roundTrip(graph.toProjectCheckpoint(project.name));
    expect(cp.orchestraSettings).toBeUndefined();
    expect(cp.orchestraRuns).toBeUndefined();
    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(cp);
    expect(restored.getOrchestraSettings(project.path)).toBeUndefined();
    expect(restored.getOrchestraRuns(project.path)).toEqual([]);
    expect(restored.getOrchestraSummary()).toBeUndefined();
  });

  it('손으로 고친 체크포인트의 어긋난 칸은 복원에서 버린다', () => {
    const { graph, project } = seeded();
    const cp = roundTrip(graph.toProjectCheckpoint(project.name)) as unknown as Record<string, unknown>;
    cp.orchestraSettings = { enabledProject: 'yes', memberEngine: 'gemini', conductorClaudeModel: 'opus\nrm', maxMembers: 3 };
    cp.orchestraRuns = [{ runId: '', projectPath: project.path }, ...(cp.orchestraRuns as unknown[])];
    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(cp as unknown as ProjectCheckpoint);
    expect(restored.getOrchestraSettings(project.path)).toEqual({ maxMembers: 3 });
    expect(restored.getOrchestraRuns(project.path).map((r) => r.runId)).toEqual(['orc-done', 'orc-live']);
  });
});

describe('오케스트라 mergeFromCheckpoint', () => {
  it('비어 있으면 체크포인트 값으로 채우고 돌던 런을 닫는다', () => {
    const { graph, project } = seeded();
    const cp = roundTrip(graph.toProjectCheckpoint(project.name));
    const fresh = new ProjectGraph();
    fresh.mergeFromCheckpoint(cp);
    expect(fresh.getOrchestraSettings(project.path)?.memberEngine).toBe('auto');
    expect(fresh.getOrchestraRuns(project.path).map((r) => r.phase)).toEqual(['dispatched', 'unreported']);
  });

  it('이미 든 프로젝트 값이 이긴다(설정·런 둘 다)', () => {
    const { graph, project } = seeded();
    const cp = roundTrip(graph.toProjectCheckpoint(project.name));

    const live = new ProjectGraph();
    const liveProject = live.registerProject(process.cwd());
    live.setOrchestraSettings(liveProject.path, { enabledProject: false });
    live.addOrchestraRun(run({ runId: 'orc-current', projectPath: liveProject.path }));

    live.mergeFromCheckpoint(cp);

    expect(live.getOrchestraSettings(liveProject.path)?.enabledProject).toBe(false);
    expect(live.getOrchestraSettings(liveProject.path)?.memberEngine).toBeUndefined();
    const runs = live.getOrchestraRuns(liveProject.path);
    expect(runs.map((r) => r.runId)).toEqual(['orc-current']);
    // 살아 있는 인스턴스의 런은 돌고 있는 것이다 — 병합이 닫지 않는다.
    expect(runs[0]?.phase).toBe('conducting');
  });
});

/**
 * §9 — `orchestra` 슬라이스는 증분(`DELTA_SLICE_KEYS`)을 탄다. 증분은 **참조 비교**라, 안 바뀐
 * 프로젝트의 요약이 매 스냅샷마다 새 객체면 정지 상태에서도 최근 런(요청 원문 포함)이 통째로 간다.
 */
describe('오케스트라 요약의 참조 유지', () => {
  it('아무것도 안 바뀌면 같은 객체를 돌려준다', () => {
    const { graph, project } = seeded();
    const first = graph.getOrchestraSummary()?.[project.name];
    expect(first).toBeDefined();
    expect(graph.getOrchestraSummary()?.[project.name]).toBe(first);
  });

  it('설정을 바꾸면 새 객체가 되고, 그 뒤로는 다시 같은 객체다', () => {
    const { graph, project } = seeded();
    const before = graph.getOrchestraSummary()?.[project.name];
    graph.setOrchestraSettings(project.path, { enabledProject: false });
    const after = graph.getOrchestraSummary()?.[project.name];
    expect(after).not.toBe(before);
    expect(after?.settings.enabledProject).toBe(false);
    expect(graph.getOrchestraSummary()?.[project.name]).toBe(after);
  });

  it('런을 더하거나 갈아 끼우면 새 객체가 된다 — 값이 틀린 채 굳지 않는다', () => {
    const { graph, project, conductor } = seeded();
    const s0 = graph.getOrchestraSummary()?.[project.name];
    graph.addOrchestraRun(run({ runId: 'orc-next', projectPath: project.path, agentId: conductor.id, commandId: 'cmd-3' }));
    const s1 = graph.getOrchestraSummary()?.[project.name];
    expect(s1).not.toBe(s0);
    expect(s1?.runs.map((r) => r.runId)).toContain('orc-next');

    graph.updateOrchestraRun('orc-next', (r) => ({ ...r, phase: 'dispatched', endedAt: 9000 }));
    const s2 = graph.getOrchestraSummary()?.[project.name];
    expect(s2).not.toBe(s1);
    expect(s2?.runs.find((r) => r.runId === 'orc-next')?.phase).toBe('dispatched');

    // 아무것도 안 바꾼 갱신(같은 객체를 돌려줌)은 요약도 그대로다.
    graph.updateOrchestraRun('orc-next', (r) => r);
    expect(graph.getOrchestraSummary()?.[project.name]).toBe(s2);
  });

  it('복원하면 새 객체가 된다(복원 전 요약을 들고 있지 않는다)', () => {
    const { graph, project } = seeded();
    const before = graph.getOrchestraSummary()?.[project.name];
    graph.restoreFromCheckpoint(roundTrip(graph.toProjectCheckpoint(project.name)));
    const after = graph.getOrchestraSummary()?.[project.name];
    expect(after).not.toBe(before);
    expect(after?.runs.map((r) => r.runId)).toEqual(['orc-done', 'orc-live']);
  });

  it('정지 상태의 두 번째 브로드캐스트에는 orchestra 가 전량으로 실리지 않는다', () => {
    const sent: WSMessage[] = [];
    resetSnapshotDeltaBaseline();
    setBroadcastSink((m) => { sent.push(m); });
    try {
      const { graph } = seeded();
      const push = (): Record<string, unknown> => {
        broadcast({ type: 'graph_snapshot', payload: graph.getSnapshot(), timestamp: Date.now() } as WSMessage);
        return (sent[sent.length - 1] as unknown as { payload: Record<string, unknown> }).payload;
      };
      expect(push()['orchestra'], '첫 전송은 기준점이라 전량이어야 한다').toBeDefined();
      const second = push();
      expect(second['orchestra'], '안 바뀌었는데 전량으로 실렸다(참조 유지 붕괴)').toBeUndefined();
      const delta = (second['deltas'] as Record<string, { changed: Record<string, unknown>; removed: string[] }> | undefined)?.['orchestra'];
      expect(Object.keys(delta?.changed ?? {})).toEqual([]);
      expect(delta?.removed ?? []).toEqual([]);
    } finally {
      setBroadcastSink(null);
      resetSnapshotDeltaBaseline();
    }
  });
});
