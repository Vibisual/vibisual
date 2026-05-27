import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { ProjectGraph } from '../projectGraph.js';

/**
 * v1.76 — 워크트리 재이주(단방향 락 해제) 회귀.
 *
 * 사용자 보고: 메인/부모 → 워크트리 A 이주 후, A 에서 만든 워크트리 B 안에서 작업하면
 * 버블이 B 로 이동해야 하는데 단방향 락(`maybeMigrateAgentToWorktree` 의
 * `currentProject.parentProjectPath` return)에 막혀 A 에 그대로 머물던 버그.
 *
 * 워크트리는 `<parent>/.claude/worktrees/<wt>` 경로패턴으로 만들어 git 호출 불필요.
 */
describe('worktree 재이주 — 부모→A→B (단방향 락 해제, v1.76)', () => {
  const PARENT = path.join(os.tmpdir(), `vib-wt-remig-${process.pid}-${Date.now()}`).replace(/\\/g, '/');
  const WT_A = `${PARENT}/.claude/worktrees/wt-a`;
  const WT_B = `${PARENT}/.claude/worktrees/wt-b`;
  const A_NAME = path.basename(WT_A); // 'wt-a'
  const B_NAME = path.basename(WT_B); // 'wt-b'

  let graph: ProjectGraph;

  beforeEach(() => {
    graph = new ProjectGraph();
    graph.setCompletedCommandArchiveRef(new Map());
    graph.setCommandQueuesRef(new Map());
    graph.registerProject(PARENT);
    graph.registerProject(WT_A); // parentProjectPath = PARENT
    graph.registerProject(WT_B); // parentProjectPath = PARENT
  });

  function edit(sessionId: string, cwd: string, file: string): void {
    graph.processHookEvent({
      session_id: sessionId,
      cwd,
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: file, old_string: 'a', new_string: 'b' },
    } as never);
  }

  function read(sessionId: string, cwd: string, file: string): void {
    graph.processHookEvent({
      session_id: sessionId,
      cwd,
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_input: { file_path: file },
    } as never);
  }

  it('부모→A 이주 후 A→B 로 재이주한다 (write/edit 즉시)', () => {
    const parentName = path.basename(PARENT);
    const agent = graph.createCustomAgent('재이주 테스트', undefined, parentName);
    const cs = agent.path;

    // 1단계: 부모 → 워크트리 A (기존 동작 — 회귀 방지)
    edit(cs, WT_A, `${WT_A}/src/a.ts`);
    expect(graph.getAgentProjectName(agent.id)).toBe(A_NAME);

    // 2단계: A → 워크트리 B (v1.76 핵심 — 구버전은 단방향 락에 막혀 A 유지 → FAIL)
    edit(cs, WT_B, `${WT_B}/src/b.ts`);
    expect(graph.getAgentProjectName(agent.id)).toBe(B_NAME);
  });

  it('read 누적 임계치로도 A→B 재이주한다', () => {
    const parentName = path.basename(PARENT);
    const agent = graph.createCustomAgent('재이주 read', undefined, parentName);
    const cs = agent.path;

    edit(cs, WT_A, `${WT_A}/src/a.ts`); // 부모→A
    expect(graph.getAgentProjectName(agent.id)).toBe(A_NAME);

    // WORKTREE_READ_MIGRATION_THRESHOLD(=3) 회 누적되면 B 로 재이주
    read(cs, WT_B, `${WT_B}/r1.ts`);
    read(cs, WT_B, `${WT_B}/r2.ts`);
    expect(graph.getAgentProjectName(agent.id)).toBe(A_NAME); // 아직 임계치 미만
    read(cs, WT_B, `${WT_B}/r3.ts`);
    expect(graph.getAgentProjectName(agent.id)).toBe(B_NAME); // 임계치 도달 → 재이주
  });

  it('자기 워크트리 내부 작업은 재이주(thrash) 안 함', () => {
    const parentName = path.basename(PARENT);
    const agent = graph.createCustomAgent('thrash 방지', undefined, parentName);
    const cs = agent.path;

    edit(cs, WT_A, `${WT_A}/src/a.ts`); // 부모→A
    expect(graph.getAgentProjectName(agent.id)).toBe(A_NAME);

    // 자기 워크트리(A) 내부 read/edit 를 반복해도 A 유지 — 가드의 self-worktree 분기
    for (let i = 0; i < 5; i += 1) read(cs, WT_A, `${WT_A}/self${i}.ts`);
    edit(cs, WT_A, `${WT_A}/src/a.ts`);
    expect(graph.getAgentProjectName(agent.id)).toBe(A_NAME);
  });

  it('워크트리에서 부모(non-worktree) 파일 접근은 부모로 끌려가지 않음 (external 유지)', () => {
    const parentName = path.basename(PARENT);
    const agent = graph.createCustomAgent('external 유지', undefined, parentName);
    const cs = agent.path;

    edit(cs, WT_B, `${WT_B}/src/b.ts`); // 부모→B
    expect(graph.getAgentProjectName(agent.id)).toBe(B_NAME);

    // 부모 repo 파일은 워크트리가 아니라 이주 트리거가 아님 → B 유지
    edit(cs, WT_B, `${PARENT}/README.md`);
    read(cs, WT_B, `${PARENT}/package.json`);
    expect(graph.getAgentProjectName(agent.id)).toBe(B_NAME);
  });
});
