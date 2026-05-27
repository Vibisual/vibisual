import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import type { QueuedCommand } from '@vibisual/shared';
import { ProjectGraph } from '../projectGraph.js';

/**
 * 사용자 보고 재현: 커스텀 에이전트로 작업 → 워크트리 안으로 이주 →
 * DetailPanel "Prompts (0)" (결과창이 사라짐).
 *
 * 실제 런타임 경로(processHookEvent → maybeMigrateAgentToWorktree →
 * buildCompletedCommandsRecord)를 그대로 태워 검증한다.
 * 워크트리는 `<parent>/.claude/worktrees/<wt>` 경로패턴으로 만들어 git 호출 불필요.
 */
describe('worktree migration — completedCommands 보존', () => {
  const PARENT = path.join(os.tmpdir(), `vib-wt-cc-${process.pid}-${Date.now()}`).replace(/\\/g, '/');
  const WT = `${PARENT}/.claude/worktrees/wt-codescan`;

  function mkCmd(id: string): QueuedCommand {
    return { id, text: `prompt ${id}`, timestamp: Date.now(), subAgentId: null, status: 'completed', result: 'done' };
  }

  let graph: ProjectGraph;
  let archive: Map<string, QueuedCommand[]>;
  let queues: Map<string, QueuedCommand[]>;

  beforeEach(() => {
    graph = new ProjectGraph();
    archive = new Map();
    queues = new Map();
    graph.setCompletedCommandArchiveRef(archive);
    graph.setCommandQueuesRef(queues);
    graph.registerProject(PARENT);
    // 워크트리 등록(경로패턴 → detectWorktree 정규식, git 불필요). parentProjectPath 부여됨.
    graph.registerProject(WT);
  });

  function snapshotPrompts(agentId: string): number {
    const snap = graph.getSnapshot();
    return (snap.completedCommands[agentId] ?? []).length;
  }

  it('이주 전: 커스텀 에이전트의 완료 명령이 agent.id 로 노출된다', () => {
    const parentName = path.basename(PARENT);
    const agent = graph.createCustomAgent('전체 코드 스캔', undefined, parentName);
    const cs = agent.path; // custom session id
    archive.set(cs, [mkCmd('c1'), mkCmd('c2')]);
    expect(snapshotPrompts(agent.id)).toBe(2);
  });

  it('워크트리 이주 후에도 completedCommands 가 agent.id 에 남는다 (LIVE)', () => {
    const parentName = path.basename(PARENT);
    const agent = graph.createCustomAgent('전체 코드 스캔', undefined, parentName);
    const cs = agent.path;
    archive.set(cs, [mkCmd('c1'), mkCmd('c2')]);
    expect(snapshotPrompts(agent.id)).toBe(2); // 이주 전 baseline

    // 워크트리 내부 파일을 Edit → maybeMigrateAgentToWorktree 가 즉시 이주.
    graph.processHookEvent({
      session_id: cs,
      cwd: WT,
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: `${WT}/src/header.ts`, old_string: 'a', new_string: 'b' },
    } as never);

    // 이주가 실제로 일어났는지 확인 (sessionCwds 가 워크트리로 바뀜).
    expect(graph.getAgentProjectName(agent.id)).toBeTruthy();

    // 핵심: 결과창이 사라지면 안 된다.
    expect(snapshotPrompts(agent.id)).toBe(2);
  });

  it('체크포인트 round-trip 후에도 completedCommands 가 보존된다', () => {
    const parentName = path.basename(PARENT);
    const agent = graph.createCustomAgent('전체 코드 스캔', undefined, parentName);
    const cs = agent.path;
    archive.set(cs, [mkCmd('c1')]);

    graph.processHookEvent({
      session_id: cs,
      cwd: WT,
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: `${WT}/src/header.ts`, old_string: 'a', new_string: 'b' },
    } as never);
    expect(snapshotPrompts(agent.id)).toBe(1);

    // 부모 탭 체크포인트(서버가 디스크에 쓰는 실제 형태) → 새 그래프 복원.
    const cp = graph.toProjectCheckpoint(parentName);

    // (a) restoreFromCheckpoint 경로
    const r1 = new ProjectGraph();
    r1.setCompletedCommandArchiveRef(new Map());
    r1.setCommandQueuesRef(new Map());
    r1.restoreFromCheckpoint(cp);
    expect((r1.getSnapshot().completedCommands[agent.id] ?? []).length).toBe(1);

    // (b) mergeFromCheckpoint 경로 (hydrate 합산 시)
    const r2 = new ProjectGraph();
    r2.setCompletedCommandArchiveRef(new Map());
    r2.setCommandQueuesRef(new Map());
    r2.mergeFromCheckpoint(cp);
    expect((r2.getSnapshot().completedCommands[agent.id] ?? []).length).toBe(1);
  });
});
