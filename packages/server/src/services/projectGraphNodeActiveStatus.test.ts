/**
 * §2.4 — 활동 안 하는 파일·폴더 버블이 활동 중으로 굳지 않는다: 복원·병합으로 올라온 노드는 idle(저장된 `active` 는 `isAlive`·TTL 청소를 피한다 — 실측 260개),
 * 표시는 만지는 active 에이전트가 없으면 idle. 진짜 작업 중인 버블은 active 그대로.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BubbleData } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-nodestatus-')));
});

afterEach(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
});

/** 파일 하나를 만들고 그 파일에 대한 Edit PostToolUse 훅 이벤트를 흘려보낸다(= 에이전트가 작업 중). */
function editFile(graph: ProjectGraph, sessionId: string, relPath: string): void {
  const abs = path.join(tmpRoot, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'after\n', 'utf8');
  graph.processHookEvent({
    session_id: sessionId,
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_use_id: `toolu-${relPath}`,
    tool_input: { file_path: abs, old_string: 'before', new_string: 'after' },
    cwd: tmpRoot,
  });
}

/** 스냅샷 전역에서 라벨로 버블 하나 찾기 (top/children/satellites 어디에 있든). */
function findBubble(graph: ProjectGraph, label: string): BubbleData | undefined {
  const snap = graph.getSnapshot();
  const pools: BubbleData[][] = [
    snap.topFolders,
    ...Object.values(snap.children),
    ...Object.values(snap.satellites),
  ];
  for (const pool of pools) {
    const hit = pool.find((b) => b.label === label);
    if (hit) return hit;
  }
  return undefined;
}

function makeGraph(): { graph: ProjectGraph; projectName: string } {
  const graph = new ProjectGraph();
  // 프로젝트가 등록돼 있어야 toProjectCheckpoint 의 이름 필터를 통과한다.
  const info = graph.registerProject(tmpRoot);
  return { graph, projectName: info.name };
}

describe('파일/폴더 버블의 활동중 표시 — 살아 있는 에이전트에서 파생한다', () => {
  it('에이전트가 작업 중인 동안에는 active 로 보인다', () => {
    const { graph } = makeGraph();
    editFile(graph, 'sess-live', 'packages/server/index.ts');

    expect(findBubble(graph, 'packages')?.status).toBe('active');
    expect(findBubble(graph, 'index.ts')?.status).toBe('active');
  });

  it('에이전트가 idle 로 내려가면 파일/폴더도 idle 로 보인다', () => {
    const { graph } = makeGraph();
    editFile(graph, 'sess-done', 'packages/server/index.ts');
    graph.markAgentIdle('sess-done');

    expect(findBubble(graph, 'packages')?.status).toBe('idle');
  });

  it('노드에 active 가 남아 있어도 만지는 에이전트가 없으면 idle 로 보고한다', () => {
    // dev 서버 keep-alive·dormant 부활처럼 **에이전트만 idle 로 내리고 노드 참조는 놔두는**
    // 경로를 그대로 재현한다. 표시가 저장값이 아니라 살아 있는 에이전트에서 파생돼야 한다.
    const { graph } = makeGraph();
    editFile(graph, 'sess-leak', 'packages/server/index.ts');

    const internals = graph as unknown as { agents: Map<string, BubbleData> };
    const agent = internals.agents.get('sess-leak');
    expect(agent).toBeDefined();
    agent!.status = 'idle';

    expect(findBubble(graph, 'packages')?.status).toBe('idle');
    expect(findBubble(graph, 'index.ts')?.status).toBe('idle');
  });

  it('다른 에이전트가 아직 그 파일을 쓰고 있으면 active 를 유지한다', () => {
    const { graph } = makeGraph();
    editFile(graph, 'sess-a', 'packages/server/index.ts');
    editFile(graph, 'sess-b', 'packages/server/index.ts');
    graph.markAgentIdle('sess-a');

    expect(findBubble(graph, 'packages')?.status).toBe('active');
    expect(findBubble(graph, 'index.ts')?.status).toBe('active');
  });
});

describe('체크포인트에서 올라온 파일/폴더 버블 — 재시작 직후엔 아무도 만지고 있지 않다', () => {
  it('저장 시점에 active 였던 노드는 복원 후 idle 이다', () => {
    const { graph, projectName } = makeGraph();
    editFile(graph, 'sess-1', 'packages/server/index.ts');
    const cp = graph.toProjectCheckpoint(projectName);

    // 저장분 자체는 그 시점의 진실(작업 중)이어야 한다 — 복원이 내리는 것이지 저장이 감추는 게 아니다.
    expect(Object.values(cp.graph.nodes).some((n) => n.status === 'active')).toBe(true);

    const revived = new ProjectGraph();
    revived.registerProject(tmpRoot);
    revived.restoreFromCheckpoint(cp);

    const statuses = [...Object.keys(cp.graph.nodes)].map(
      (k) => (revived as unknown as { nodes: Map<string, BubbleData> }).nodes.get(k)?.status,
    );
    expect(statuses.some((s) => s === 'active' || s === 'completed')).toBe(false);
    expect(findBubble(revived, 'packages')?.status).toBe('idle');
  });

  it('병합으로 올라온 노드도 idle 이고, 이미 있는 살아 있는 노드는 건드리지 않는다', () => {
    // 프로젝트를 둘 이상 연 사람에게만 드러나는 자리 — merge 는 restore 와 다른 함수라 따로 못 박는다.
    const { graph, projectName } = makeGraph();
    editFile(graph, 'sess-1', 'packages/server/index.ts');
    const cp = graph.toProjectCheckpoint(projectName);

    // 같은 프로젝트를 이미 라이브로 들고 있는 인스턴스에 병합 → 라이브 쪽이 이긴다.
    const live = new ProjectGraph();
    live.registerProject(tmpRoot);
    editFile(live, 'sess-live', 'packages/server/index.ts');
    live.mergeFromCheckpoint(cp);
    expect(findBubble(live, 'packages')?.status).toBe('active');

    // 빈 인스턴스에 병합 → 디스크에서 올라온 것이므로 idle.
    const fresh = new ProjectGraph();
    fresh.registerProject(tmpRoot);
    fresh.mergeFromCheckpoint(cp);
    expect(findBubble(fresh, 'packages')?.status).toBe('idle');
  });

  it('복원 후 살아난 에이전트가 다시 만지면 active 로 돌아온다', () => {
    const { graph, projectName } = makeGraph();
    editFile(graph, 'sess-1', 'packages/server/index.ts');
    const cp = graph.toProjectCheckpoint(projectName);

    const revived = new ProjectGraph();
    revived.registerProject(tmpRoot);
    revived.restoreFromCheckpoint(cp);
    expect(findBubble(revived, 'packages')?.status).toBe('idle');

    editFile(revived, 'sess-1', 'packages/server/index.ts');
    expect(findBubble(revived, 'packages')?.status).toBe('active');
  });
});
