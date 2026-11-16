/**
 * §5.1 #3-5 — 훅으로 들어온 쓰임이 스냅샷의 최근 사용 순위로 나온다: 가장 최근이 0, 에이전트가 정한 개수 밖은 링이 없다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_AGENT_CONFIG, type BubbleData, type GraphSnapshot } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';

function allBubbles(snap: GraphSnapshot): BubbleData[] {
  return [...snap.topFolders, ...Object.values(snap.children).flat(), ...Object.values(snap.satellites).flat()];
}

function rankOf(snap: GraphSnapshot, label: string): number | undefined {
  const node = allBubbles(snap).find((b) => b.label === label);
  return node?.recentUse?.[0]?.rank;
}

describe('ProjectGraph — 최근 사용 순위(§5.1 #3-5)', () => {
  let root: string;
  let clock = 1_800_000_000_000;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-recent-use-')));
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  function read(graph: ProjectGraph, relPath: string): void {
    clock += 1000;
    vi.setSystemTime(clock);
    const abs = path.join(root, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (!fs.existsSync(abs)) fs.writeFileSync(abs, 'x\n', 'utf8');
    graph.processHookEvent({
      session_id: 'sess-recent-use',
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_use_id: `toolu-${clock}`,
      tool_input: { file_path: abs },
      cwd: root,
    });
  }

  it('가장 최근이 0, 기본 개수(5) 밖은 순위가 없다', () => {
    const graph = new ProjectGraph();
    graph.registerProject(root);
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) read(graph, `${name}.md`);
    const snap = graph.getSnapshot();
    expect(rankOf(snap, 'g.md')).toBe(0);
    expect(rankOf(snap, 'c.md')).toBe(4);
    expect(rankOf(snap, 'b.md')).toBeUndefined();
    expect(rankOf(snap, 'a.md')).toBeUndefined();
  });

  it('다시 쓰면 맨 앞으로 오고, 폴더는 그 안의 쓰임과 같은 순위다', () => {
    const graph = new ProjectGraph();
    graph.registerProject(root);
    read(graph, 'docs/one.md');
    read(graph, 'x.md');
    read(graph, 'docs/one.md');
    const snap = graph.getSnapshot();
    expect(rankOf(snap, 'docs')).toBe(0);
    expect(rankOf(snap, 'x.md')).toBe(1);
  });

  it('에이전트 설정의 개수를 따른다(0 = 끔)', () => {
    const graph = new ProjectGraph();
    graph.registerProject(root);
    for (const name of ['a', 'b', 'c']) read(graph, `${name}.md`);
    const agentId = graph.getSnapshot().agents[0]!.id;
    graph.setAgentConfig(agentId, { ...DEFAULT_AGENT_CONFIG, recentUseRings: 2 });
    let snap = graph.getSnapshot();
    expect(rankOf(snap, 'c.md')).toBe(0);
    expect(rankOf(snap, 'b.md')).toBe(1);
    expect(rankOf(snap, 'a.md')).toBeUndefined();
    expect(allBubbles(snap).find((b) => b.label === 'c.md')?.recentUse?.[0]?.limit).toBe(2);

    graph.setAgentConfig(agentId, { ...DEFAULT_AGENT_CONFIG, recentUseRings: 0 });
    snap = graph.getSnapshot();
    expect(allBubbles(snap).some((b) => (b.recentUse?.length ?? 0) > 0)).toBe(false);
  });

  it('순위는 체크포인트에 실리지 않는다', () => {
    const graph = new ProjectGraph();
    graph.registerProject(root);
    read(graph, 'a.md');
    const projectName = Object.values(graph.getSnapshot().projects)[0]!.name;
    const nodes = Object.values(graph.toProjectCheckpoint(projectName).graph.nodes) as BubbleData[];
    expect(nodes.some((n) => n.recentUse !== undefined)).toBe(false);
  });
});
