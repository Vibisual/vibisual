/**
 * §5.4 #36 (H) ①-1 — 버블 숨기기는 버블마다 "연결된 에이전트"를 본다. 활동 중인 소유자(`activeAgentIds`)만으로는
 * 완료된 에이전트의 위성을 가르지 못하므로, 스냅샷 사본에 만진 에이전트 전부(`ownerAgentIds`)를 싣는다.
 * 사본에만 싣고(저장 노드 ❌), 소유 기록에 남은 옛 id·휴지통 에이전트는 뺀다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BubbleData } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';

const T0 = Date.parse('2026-11-06T00:00:00Z');

let tmpRoot: string;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-owners-')));
});

afterEach(() => {
  vi.useRealTimers();
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
});

type Internals = {
  agents: Map<string, BubbleData>;
  nodes: Map<string, BubbleData>;
  nodeAgentRefs: Map<string, Set<string>>;
};

function internals(graph: ProjectGraph): Internals {
  return graph as unknown as Internals;
}

function touch(graph: ProjectGraph, sessionId: string, relPath: string): void {
  const abs = path.join(tmpRoot, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (!fs.existsSync(abs)) fs.writeFileSync(abs, 'x\n', 'utf8');
  graph.processHookEvent({
    session_id: sessionId,
    hook_event_name: 'PostToolUse',
    tool_name: 'Read',
    tool_use_id: `toolu-${sessionId}-${relPath}`,
    tool_input: { file_path: abs },
    cwd: tmpRoot,
  });
}

/** 스냅샷에 실린 사본 — 폴더·자식·위성 어디에 앉았든 라벨로 찾는다. */
function shipped(graph: ProjectGraph, label: string): BubbleData[] {
  const snap = graph.getSnapshot();
  return [...snap.topFolders, ...Object.values(snap.children).flat(), ...Object.values(snap.satellites).flat()]
    .filter((n) => n.label === label);
}

function agentId(graph: ProjectGraph, sessionId: string): string {
  return internals(graph).agents.get(sessionId)!.id;
}

function makeGraph(): ProjectGraph {
  const graph = new ProjectGraph();
  graph.registerProject(tmpRoot);
  return graph;
}

describe('ownerAgentIds — 스냅샷 사본의 소유 에이전트', () => {
  it('만진 에이전트 전부를 싣고, 완료돼 활동 목록에서 빠져도 남긴다', () => {
    const graph = makeGraph();
    touch(graph, 'alpha', 'src/shared.ts');
    touch(graph, 'beta', 'src/shared.ts');
    touch(graph, 'alpha', 'src/mine.ts');
    const alpha = agentId(graph, 'alpha');
    const beta = agentId(graph, 'beta');

    const shared = shipped(graph, 'shared.ts');
    expect(shared.length).toBeGreaterThan(0);
    for (const copy of shared) expect([...(copy.ownerAgentIds ?? [])].sort()).toEqual([alpha, beta].sort());
    for (const copy of shipped(graph, 'mine.ts')) expect(copy.ownerAgentIds).toEqual([alpha]);

    graph.setAgentStatus('alpha', 'completed');
    vi.setSystemTime(T0 + 1000);
    const mine = shipped(graph, 'mine.ts');
    expect(mine.length).toBeGreaterThan(0);
    for (const copy of mine) {
      expect(copy.activeAgentIds ?? []).not.toContain(alpha);
      expect(copy.ownerAgentIds).toEqual([alpha]);
    }
  });

  it('옛 id·휴지통 에이전트는 빼고, 저장 노드에는 싣지 않는다', () => {
    const graph = makeGraph();
    touch(graph, 'alpha', 'src/a.ts');
    touch(graph, 'beta', 'src/a.ts');
    const { nodes, nodeAgentRefs, agents } = internals(graph);
    const key = [...nodes.entries()].find(([, n]) => n.label === 'a.ts')![0];
    nodeAgentRefs.get(key)!.add('agent-gone');
    agents.get('beta')!.trashed = true;
    vi.setSystemTime(T0 + 1000);

    const copies = shipped(graph, 'a.ts');
    expect(copies.length).toBeGreaterThan(0);
    for (const copy of copies) expect(copy.ownerAgentIds).toEqual([agentId(graph, 'alpha')]);
    expect(nodes.get(key)!.ownerAgentIds).toBeUndefined();
    expect(JSON.stringify(graph.toCheckpoint())).not.toContain('ownerAgentIds');
  });
});
