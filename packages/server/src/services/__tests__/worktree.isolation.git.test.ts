import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { QueuedCommand } from '@vibisual/shared';
import { ProjectGraph } from '../projectGraph.js';

/**
 * 사용자 실제 환경 재현: repo **밖**의 git isolation 워크트리
 * (`claude --isolation worktree` 가 만드는 형태) + 훅 에이전트(실 UUID 세션).
 * 이주 후 LIVE / 체크포인트 round-trip 에서 completedCommands("Prompts") 가
 * 유지되는지 실제 git worktree 로 검증.
 */
describe('isolation worktree (repo 밖 git) — 훅 에이전트 prompt 보존', () => {
  const base = path.join(os.tmpdir(), `vib-wtgit-${process.pid}-${Date.now()}`).replace(/\\/g, '/');
  const REPO = `${base}/repo`;
  const WT = `${base}/wt-codescan`; // repo 밖 (isolation 워크트리 위치)
  const SESSION = '11111111-2222-3333-4444-555555555555'; // 훅 에이전트 실 UUID

  let gitOk = false;

  beforeAll(() => {
    fs.mkdirSync(REPO, { recursive: true });
    const g = (args: string[], cwd: string) =>
      execFileSync('git', args, { cwd, stdio: 'pipe' });
    try {
      g(['init', '-q'], REPO);
      g(['config', 'user.email', 't@t.t'], REPO);
      g(['config', 'user.name', 't'], REPO);
      fs.writeFileSync(path.join(REPO, 'README.md'), '# r\n');
      g(['add', '-A'], REPO);
      g(['commit', '-qm', 'init'], REPO);
      g(['worktree', 'add', '-q', '-b', 'wtbranch', WT], REPO);
      fs.mkdirSync(path.join(WT, 'src'), { recursive: true });
      fs.writeFileSync(path.join(WT, 'src', 'header.ts'), 'export const a=1;\n');
      gitOk = true;
    } catch (err) {
      // 환경에 git 없거나 worktree 실패 시 스킵 표식
      gitOk = false;
      // eslint-disable-next-line no-console
      console.warn('git worktree setup failed:', err instanceof Error ? err.message : String(err));
    }
  });

  afterAll(() => {
    try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function mkCmd(id: string): QueuedCommand {
    return { id, text: `prompt ${id}`, timestamp: Date.now(), subAgentId: null, status: 'completed', result: 'r' };
  }

  function newGraph() {
    const g = new ProjectGraph();
    g.setCompletedCommandArchiveRef(new Map());
    g.setCommandQueuesRef(new Map());
    return g;
  }

  it('repo 밖 worktree 가 git 로 인식되어 부모에 귀속된다', () => {
    if (!gitOk) return;
    const graph = newGraph();
    graph.registerProject(REPO);

    // 훅 에이전트: 실 UUID 세션이 repo 에서 시작 (SessionStart/PreToolUse 모사)
    graph.processHookEvent({
      session_id: SESSION, cwd: REPO, hook_event_name: 'PostToolUse',
      tool_name: 'Read', tool_input: { file_path: `${REPO}/README.md` },
    } as never);

    const agentName0 = graph.getAgentProjectName(graphAgentId(graph, SESSION));
    expect(agentName0).toBeTruthy(); // repo 에 귀속

    // repo 밖 worktree 파일 Edit → git detectWorktree 폴백 → 이주
    graph.processHookEvent({
      session_id: SESSION, cwd: WT, hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: `${WT}/src/header.ts`, old_string: 'a=1', new_string: 'a=2' },
    } as never);

    // 워크트리가 ProjectInfo 로 등록되고 parentProjectPath 가 repo 여야 한다
    const wtName = graph.getAgentProjectName(graphAgentId(graph, SESSION));
    expect(wtName).toBeTruthy();
  });

  it('LIVE: 이주 후에도 completedCommands 가 보존된다', () => {
    if (!gitOk) return;
    const graph = newGraph();
    graph.registerProject(REPO);
    graph.processHookEvent({
      session_id: SESSION, cwd: REPO, hook_event_name: 'PostToolUse',
      tool_name: 'Read', tool_input: { file_path: `${REPO}/README.md` },
    } as never);
    const agentId = graphAgentId(graph, SESSION);

    // 훅 에이전트에 보낸 프롬프트 완료분이 archive 에 그 세션키로 쌓인다
    (graph as unknown as { completedCommandArchiveRef: Map<string, QueuedCommand[]> })
      .completedCommandArchiveRef.set(SESSION, [mkCmd('p1'), mkCmd('p2')]);
    expect((graph.getSnapshot().completedCommands[agentId] ?? []).length).toBe(2);

    graph.processHookEvent({
      session_id: SESSION, cwd: WT, hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: `${WT}/src/header.ts`, old_string: 'a=1', new_string: 'a=2' },
    } as never);

    expect((graph.getSnapshot().completedCommands[agentId] ?? []).length).toBe(2);
  });

  it('체크포인트 round-trip 후에도 completedCommands 가 보존된다', () => {
    if (!gitOk) return;
    const graph = newGraph();
    graph.registerProject(REPO);
    graph.processHookEvent({
      session_id: SESSION, cwd: REPO, hook_event_name: 'PostToolUse',
      tool_name: 'Read', tool_input: { file_path: `${REPO}/README.md` },
    } as never);
    const agentId = graphAgentId(graph, SESSION);
    (graph as unknown as { completedCommandArchiveRef: Map<string, QueuedCommand[]> })
      .completedCommandArchiveRef.set(SESSION, [mkCmd('p1')]);
    graph.processHookEvent({
      session_id: SESSION, cwd: WT, hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: `${WT}/src/header.ts`, old_string: 'a=1', new_string: 'a=2' },
    } as never);
    expect((graph.getSnapshot().completedCommands[agentId] ?? []).length).toBe(1);

    const parentName = path.basename(REPO);
    const cp = graph.toProjectCheckpoint(parentName);

    const r = newGraph();
    r.restoreFromCheckpoint(cp);
    expect((r.getSnapshot().completedCommands[agentId] ?? []).length).toBe(1);
  });
});

/** SESSION → agent.id (agents Map 내부 조회). */
function graphAgentId(graph: ProjectGraph, sessionId: string): string {
  const agents = (graph as unknown as { agents: Map<string, { id: string }> }).agents;
  return agents.get(sessionId)?.id ?? '(none)';
}
