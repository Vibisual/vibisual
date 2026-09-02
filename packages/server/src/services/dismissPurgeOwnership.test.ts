/**
 * §2.4 "확인 dismiss → 전유 file/folder 즉시 소멸"(v1.82) 이 **실제로 걷어 내는지** 못 박는다.
 *
 * 배경: v1.82 는 "그 에이전트가 전유하던 file/folder 버블을 즉시 제거" 라고 약속하지만, 그
 * 판정의 유일한 근거인 `nodeAgentRefs`(누가 이 버블을 만졌나) 를 **그 지점에 닿기 전에**
 * 지우고 있었다. 세션이 끝나면 `setAgentStatus('completed')` → `removeAgentRefs` 가 활성 참조가
 * 없는 노드의 ref 집합을 통째로 `clear()` 했고, 사용자가 그 버블을 눌러 dismiss 할 때 도는
 * `removeAgentRefsPurging` 은 `refs.has(agentId)` 가 false 라 **한 장도 걷지 못하고 지나갔다**.
 * 즉 소유 기록을 지우는 쪽이 소유 기록을 읽는 쪽보다 항상 먼저 도는 순서 문제다.
 *
 * 그 결과가 "종료·크래시 뒤에도 남는 버블"이다 — 껐다 켜면 에이전트는 idle 로 내려오는데,
 * 그 에이전트가 만졌던 파일/폴더 버블은 **주인이 없는 고아**가 되어 어떤 클릭으로도 걷히지
 * 않는다(실측: 살아 있는 checkpoint.json 에서 `nodeAgentRefs` 2,425칸 중 2,409칸이 빈 배열).
 *
 * 여기서 잠그는 계약 넷:
 *  1. 상태 강등(active→completed→idle)은 **소유 기록을 지우지 않는다**. 지우는 것은 활성 표시뿐.
 *  2. 그래서 세션이 끝난 뒤 눌러도, **앱을 껐다 켠 뒤 눌러도** 전유 버블이 걷힌다.
 *  3. 다른 **active** 에이전트가 아직 쓰는 버블은 남는다(v1.82 원문).
 *  4. 에이전트 버블을 **영구 삭제**하면 그 소유 기록도 함께 사라진다(죽은 id 누적 ❌).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BubbleData } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-dismisspurge-')));
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
    tool_use_id: `toolu-${sessionId}-${relPath}`,
    tool_input: { file_path: abs, old_string: 'before', new_string: 'after' },
    cwd: tmpRoot,
  });
}

type Internals = {
  agents: Map<string, BubbleData>;
  nodes: Map<string, BubbleData>;
  nodeAgentRefs: Map<string, Set<string>>;
};

function internals(graph: ProjectGraph): Internals {
  return graph as unknown as Internals;
}

/** 라벨로 노드가 아직 서버 메모리에 있는지 — 즉시 제거(removeBubble)를 확인하는 잣대. */
function hasNode(graph: ProjectGraph, label: string): boolean {
  for (const n of internals(graph).nodes.values()) {
    if (n.label === label) return true;
  }
  return false;
}

function agentBubbleId(graph: ProjectGraph, sessionId: string): string {
  const agent = internals(graph).agents.get(sessionId);
  if (!agent) throw new Error(`agent not found: ${sessionId}`);
  return agent.id;
}

function makeGraph(): { graph: ProjectGraph; projectName: string } {
  const graph = new ProjectGraph();
  const info = graph.registerProject(tmpRoot);
  return { graph, projectName: info.name };
}

describe('확인 dismiss — 소유 기록이 강등에서 살아남는다', () => {
  it('세션이 completed 로 내려가도 "누가 만졌나" 기록은 남는다', () => {
    const { graph } = makeGraph();
    editFile(graph, 'sess-done', 'packages/server/index.ts');
    const bubbleId = agentBubbleId(graph, 'sess-done');

    graph.setAgentStatus('sess-done', 'completed');

    const owned = [...internals(graph).nodeAgentRefs.values()].filter((refs) => refs.has(bubbleId));
    expect(owned.length).toBeGreaterThan(0);
  });

  it('completed 버블을 눌러 확인하면 전유 file/folder 가 즉시 사라진다', () => {
    const { graph } = makeGraph();
    editFile(graph, 'sess-done', 'packages/server/index.ts');
    expect(hasNode(graph, 'index.ts')).toBe(true);
    expect(hasNode(graph, 'packages')).toBe(true);

    graph.setAgentStatus('sess-done', 'completed');
    graph.markAgentIdle('sess-done', true);

    expect(hasNode(graph, 'index.ts')).toBe(false);
    expect(hasNode(graph, 'packages')).toBe(false);
  });

  it('앱을 껐다 켠 뒤(체크포인트 왕복) 눌러도 전유 file/folder 가 사라진다', () => {
    const { graph, projectName } = makeGraph();
    editFile(graph, 'sess-crash', 'packages/server/index.ts');
    // 종료 직전 상태 그대로 저장 → 재시작 → 복원(에이전트·노드 모두 idle 로 강등된다).
    const cp = graph.toProjectCheckpoint(projectName);

    const revived = new ProjectGraph();
    revived.registerProject(tmpRoot);
    revived.restoreFromCheckpoint(cp);

    expect(hasNode(revived, 'index.ts')).toBe(true);
    expect(internals(revived).agents.get('sess-crash')?.status).toBe('idle');

    revived.markAgentIdle('sess-crash', true);

    expect(hasNode(revived, 'index.ts')).toBe(false);
    expect(hasNode(revived, 'packages')).toBe(false);
  });
});

describe('확인 dismiss — 남겨야 할 것은 남긴다', () => {
  it('다른 active 에이전트가 아직 쓰는 버블은 걷지 않는다', () => {
    const { graph } = makeGraph();
    editFile(graph, 'sess-a', 'packages/server/index.ts');
    editFile(graph, 'sess-b', 'packages/server/index.ts');

    graph.markAgentIdle('sess-a', true);

    expect(hasNode(graph, 'index.ts')).toBe(true);
    expect(hasNode(graph, 'packages')).toBe(true);
  });

  it('preserve-pin 된 버블은 걷지 않는다 (§2.4 v1.28)', () => {
    const { graph } = makeGraph();
    editFile(graph, 'sess-pin', 'packages/server/index.ts');
    for (const n of internals(graph).nodes.values()) {
      if (n.label === 'packages') n.preservePinned = true;
    }

    graph.markAgentIdle('sess-pin', true);

    expect(hasNode(graph, 'packages')).toBe(true);
  });

  it('에이전트 버블을 지우면 그 소유 기록도 함께 사라진다', () => {
    const { graph } = makeGraph();
    editFile(graph, 'sess-gone', 'packages/server/index.ts');
    const bubbleId = agentBubbleId(graph, 'sess-gone');

    graph.removeBubble(bubbleId);

    const leaked = [...internals(graph).nodeAgentRefs.values()].some((refs) => refs.has(bubbleId));
    expect(leaked).toBe(false);
  });

  it('복원 때 사라진 에이전트의 소유 id 는 걷어 낸다 (죽은 id 누적 ❌)', () => {
    const { graph, projectName } = makeGraph();
    editFile(graph, 'sess-live', 'packages/server/index.ts');
    const liveId = agentBubbleId(graph, 'sess-live');
    const cp = graph.toProjectCheckpoint(projectName);

    // 옛 저장분·수동 편집처럼 `removeBubble` 을 안 지나고 사라진 에이전트를 흉내낸다 —
    // 노드 소유 기록에는 남아 있지만 그 버블은 어디에도 없다(눌러도 못 여는 id).
    for (const refs of Object.values(cp.graph.refs.nodeAgentRefs)) refs.push('agent-vanished');

    const revived = new ProjectGraph();
    revived.registerProject(tmpRoot);
    revived.restoreFromCheckpoint(cp);

    const all = [...internals(revived).nodeAgentRefs.values()];
    expect(all.some((refs) => refs.has('agent-vanished'))).toBe(false);
    // 살아 있는 소유 기록은 그대로 — 이게 없으면 재시작 뒤 확인 dismiss 가 다시 헛손질이 된다.
    expect(all.some((refs) => refs.has(liveId))).toBe(true);
  });
});
