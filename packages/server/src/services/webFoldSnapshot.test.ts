/**
 * §5.23 접어 보기 · §7.22 — 서버가 **스냅샷에 싣는 모양**과, 접힌 버블을 누른 손길이 어디로 풀리는지를 못 박는다.
 *
 * 접는 규칙 자체는 `webFoldView.test.ts` 가 잠근다. 여기서는 그 함수를 부르는 서버 쪽 배선을 본다:
 *  1. 옵션은 기본 꺼짐이고, 켜고 끄는 즉시 다음 스냅샷이 바뀐다(판을 안 올리면 200ms 캐시가 옛 모양을 준다).
 *  2. 기록(`domainEntries`)은 접히지 않는다 — 접힌 호스트도 제 노드 id 로 실린다.
 *  3. 고정한 호스트는 접히지 않는다.
 *  4. 접힌 버블 지우기 — 그 에이전트만 읽은 호스트는 지우고, 다른 에이전트도 읽은 호스트는 화살표·소유 기록만
 *     걷는다. 스냅샷에 안 실린 에이전트도 "다른 에이전트"로 센다.
 *  5. 접힌 버블의 자리는 노드 장부 밖에 따로 들고, 끄거나 주인이 사라지면 버린다.
 *  6. 호스트가 만료되면(§2.4 TTL) 접힌 버블도 함께 걷힌다.
 *  7. 매니저 — 켜 둔 값이 나중에 여는 프로젝트에도 걸리고, 지우기·자리 저장이 주인 에이전트의 인스턴스로 간다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BUBBLE_TTL,
  webFoldId,
  webNodeKey,
  type ActivityEdge,
  type BubbleData,
  type GraphSnapshot,
} from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { ProjectGraphManager } from './projectGraphManager.js';

// ⚠ 매니저의 `registerProject` 는 사용자 홈의 `~/.vibisual/app-state.json` 에 열린 프로젝트를 실제로 적는다 — 그 쓰기만 막는다.
vi.mock('./appState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./appState.js')>();
  return { ...actual, appStateAddOpenProject: () => false };
});

const T0 = Date.parse('2026-09-14T00:00:00Z');
const MIN = 60 * 1000;

const tmpDirs: string[] = [];

beforeEach(() => {
  // 시계만 가짜로 돌린다 — 스냅샷 캐시(판 + 200ms)도 같은 시계를 보므로 1초만 옮겨도 캐시가 풀린다.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  for (const dir of tmpDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

type Internals = {
  agents: Map<string, BubbleData>;
  nodes: Map<string, BubbleData>;
  nodeAgentRefs: Map<string, Set<string>>;
  webFoldPositions: Map<string, { x: number; y: number }>;
  mainEdges: { getAll(): ActivityEdge[] };
  bumpMutationVersion(): void;
};

function internals(graph: ProjectGraph): Internals {
  return graph as unknown as Internals;
}

function makeDir(tag: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `vibi-webfold-${tag}-`)));
  tmpDirs.push(dir);
  return dir;
}

function makeGraph(): { graph: ProjectGraph; root: string } {
  const root = makeDir('graph');
  const graph = new ProjectGraph();
  graph.registerProject(root);
  return { graph, root };
}

/** 에이전트가 웹 페이지 하나를 읽은 사후 훅 이벤트(§5.23 — 도메인 버블은 사후에만 선다). */
function webFetchPayload(cwd: string, sessionId: string, url: string) {
  return {
    session_id: sessionId,
    hook_event_name: 'PostToolUse',
    tool_name: 'WebFetch',
    tool_use_id: `toolu-${sessionId}-${url}`,
    tool_input: { url, prompt: 'summarize' },
    tool_response: { content: [{ type: 'text', text: 'body' }] },
    cwd,
  };
}

function agentId(graph: ProjectGraph, sessionId: string): string {
  const agent = internals(graph).agents.get(sessionId);
  if (!agent) throw new Error(`agent not found: ${sessionId}`);
  return agent.id;
}

function domainId(graph: ProjectGraph, host: string): string {
  const node = internals(graph).nodes.get(webNodeKey(host));
  if (!node) throw new Error(`domain node not found: ${host}`);
  return node.id;
}

function foldOf(snapshot: GraphSnapshot, agent: string): BubbleData | undefined {
  return snapshot.topFolders.find((n) => n.id === webFoldId(agent));
}

const topIds = (snapshot: GraphSnapshot): string[] => snapshot.topFolders.map((n) => n.id);

/** 두 끝이 a·b 인 엣지가 있는가(방향 무관). */
function linked(edges: ActivityEdge[], a: string, b: string): boolean {
  return edges.some((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a));
}

describe('§5.23 접어 보기 — 켜고 끄기', () => {
  it('기본은 꺼짐 — 호스트마다 버블 하나로 나간다', () => {
    const { graph, root } = makeGraph();
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://platform.claude.com/docs'));
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://code.claude.com/docs'));

    const snap = graph.getSnapshot();
    expect(graph.isWebFoldPerAgent()).toBe(false);
    expect(topIds(snap)).toEqual(expect.arrayContaining([domainId(graph, 'platform.claude.com'), domainId(graph, 'code.claude.com')]));
    expect(snap.topFolders.some((n) => n.webFold)).toBe(false);
  });

  it('켜는 즉시 한 에이전트의 호스트들이 버블 하나로 접히고, 끄는 즉시 돌아온다 — 캐시가 옛 모양을 주지 않는다', () => {
    const { graph, root } = makeGraph();
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://platform.claude.com/docs'));
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://code.claude.com/docs'));
    const a = agentId(graph, 'sess-a');
    const platform = domainId(graph, 'platform.claude.com');
    const code = domainId(graph, 'code.claude.com');
    graph.getSnapshot(); // 캐시를 채워 둔다

    graph.setWebFoldPerAgent(true);
    const on = graph.getSnapshot();
    const fold = foldOf(on, a);
    expect(fold?.webFold?.hosts.map((h) => h.id).sort()).toEqual([code, platform].sort());
    expect(topIds(on)).not.toContain(platform);
    expect(topIds(on)).not.toContain(code);
    expect(on.edges.filter((e) => e.target === a || e.source === a).map((e) => e.id)).toEqual([`${a}-${webFoldId(a)}-read`]);

    graph.setWebFoldPerAgent(false);
    const off = graph.getSnapshot();
    expect(foldOf(off, a)).toBeUndefined();
    expect(topIds(off)).toEqual(expect.arrayContaining([platform, code]));
    expect(linked(off.edges, platform, a)).toBe(true);
  });

  it('기록은 접히지 않는다 — 접힌 호스트도 제 노드 id 로 항목이 실리고, 칸의 항목 수가 그 길이와 같다', () => {
    const { graph, root } = makeGraph();
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://platform.claude.com/docs'));
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://platform.claude.com/hooks'));
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://code.claude.com/docs'));
    const a = agentId(graph, 'sess-a');
    const before = graph.getSnapshot().domainEntries;

    graph.setWebFoldPerAgent(true);
    const snap = graph.getSnapshot();
    expect(snap.domainEntries).toEqual(before);
    for (const h of foldOf(snap, a)?.webFold?.hosts ?? []) {
      expect(h.entryCount).toBe(snap.domainEntries[h.id]?.length ?? 0);
    }
    expect(foldOf(snap, a)?.webFold?.hosts.find((h) => h.host === 'platform.claude.com')?.entryCount).toBe(2);
  });

  it('고정한 호스트는 접히지 않고 제 버블로 남는다', () => {
    const { graph, root } = makeGraph();
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://platform.claude.com/docs'));
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://code.claude.com/docs'));
    const a = agentId(graph, 'sess-a');
    internals(graph).nodes.get(webNodeKey('platform.claude.com'))!.preservePinned = true;
    internals(graph).bumpMutationVersion();

    graph.setWebFoldPerAgent(true);
    const snap = graph.getSnapshot();
    expect(topIds(snap)).toContain(domainId(graph, 'platform.claude.com'));
    expect(foldOf(snap, a)?.webFold?.hosts.map((h) => h.host)).toEqual(['code.claude.com']);
  });
});

describe('§5.23 접어 보기 — 접힌 버블 지우기', () => {
  it('옵션이 꺼져 있으면 접힌 id 는 모르는 id 다', () => {
    const { graph, root } = makeGraph();
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://platform.claude.com/docs'));
    const fold = webFoldId(agentId(graph, 'sess-a'));

    expect(graph.hasWebFoldId(fold)).toBe(false);
    expect(graph.removeWebFold(fold)).toBe(false);
    expect(internals(graph).nodes.has(webNodeKey('platform.claude.com'))).toBe(true);
  });

  it('그 에이전트만 읽은 호스트는 지우고, 함께 읽은 호스트는 화살표·소유 기록만 걷는다 — 옆 접힌 버블은 줄지 않는다', () => {
    const { graph, root } = makeGraph();
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://platform.claude.com/docs'));
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://code.claude.com/docs'));
    graph.processHookEvent(webFetchPayload(root, 'sess-b', 'https://platform.claude.com/hooks'));
    const a = agentId(graph, 'sess-a');
    const b = agentId(graph, 'sess-b');
    const platform = domainId(graph, 'platform.claude.com');
    const code = domainId(graph, 'code.claude.com');
    graph.setWebFoldPerAgent(true);
    expect(foldOf(graph.getSnapshot(), b)?.webFold?.hosts.map((h) => h.id)).toEqual([platform]);

    expect(graph.removeWebFold(webFoldId(a))).toBe(true);

    // 단독 호스트 — 노드·기록째 사라진다.
    expect(internals(graph).nodes.has(webNodeKey('code.claude.com'))).toBe(false);
    // 함께 읽은 호스트 — 노드는 남고 a 와의 끈만 끊긴다.
    expect(internals(graph).nodes.has(webNodeKey('platform.claude.com'))).toBe(true);
    const edges = internals(graph).mainEdges.getAll();
    expect(linked(edges, platform, a)).toBe(false);
    expect(linked(edges, platform, b)).toBe(true);
    expect(internals(graph).nodeAgentRefs.get(webNodeKey('platform.claude.com'))?.has(a) ?? false).toBe(false);

    const snap = graph.getSnapshot();
    expect(foldOf(snap, a)).toBeUndefined();
    expect(foldOf(snap, b)?.webFold?.hosts.map((h) => h.id)).toEqual([platform]);
    expect(snap.domainEntries[code]).toBeUndefined();
    expect(snap.domainEntries[platform]?.length).toBeGreaterThan(0);
  });

  it('스냅샷에 안 실린 에이전트도 다른 독자로 센다 — 그 에이전트가 읽은 흔적이 지워지지 않는다', () => {
    const { graph, root } = makeGraph();
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://platform.claude.com/docs'));
    graph.processHookEvent(webFetchPayload(root, 'sess-b', 'https://platform.claude.com/hooks'));
    const a = agentId(graph, 'sess-a');
    const b = agentId(graph, 'sess-b');
    const platform = domainId(graph, 'platform.claude.com');
    // 파이프라인 자식은 최상위 에이전트로 실리지 않는다 — 숨긴 탭의 에이전트와 같은 처지다.
    internals(graph).agents.get('sess-b')!.pipelineParentId = 'pipeline-parent';
    internals(graph).bumpMutationVersion();
    graph.setWebFoldPerAgent(true);
    const before = graph.getSnapshot();
    expect(before.agents.map((x) => x.id)).not.toContain(b);
    expect(foldOf(before, a)?.webFold?.hosts.map((h) => h.id)).toEqual([platform]);

    expect(graph.removeWebFold(webFoldId(a))).toBe(true);

    expect(internals(graph).nodes.has(webNodeKey('platform.claude.com'))).toBe(true);
    expect(linked(internals(graph).mainEdges.getAll(), platform, b)).toBe(true);
    expect(linked(internals(graph).mainEdges.getAll(), platform, a)).toBe(false);
  });
});

describe('§5.23 접어 보기 — 자리', () => {
  it('접힌 버블의 자리는 한 장·일괄 저장 모두 받아 다음 스냅샷에 입힌다', () => {
    const { graph, root } = makeGraph();
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://platform.claude.com/docs'));
    const a = agentId(graph, 'sess-a');
    const fold = webFoldId(a);
    graph.setWebFoldPerAgent(true);

    expect(graph.updateBubblePosition(fold, 10, 20)).toBe(true);
    vi.setSystemTime(T0 + 1000);
    expect(foldOf(graph.getSnapshot(), a)?.position).toEqual({ x: 10, y: 20 });

    graph.updateBubblePositionsBatch([{ id: fold, x: 30, y: 40 }]);
    vi.setSystemTime(T0 + 2000);
    expect(foldOf(graph.getSnapshot(), a)?.position).toEqual({ x: 30, y: 40 });
    // 호스트 노드의 자리는 건드리지 않는다 — 끄면 호스트가 제자리로 돌아와야 한다.
    expect(internals(graph).nodes.get(webNodeKey('platform.claude.com'))?.position).toBeUndefined();
  });

  it('끄면 접힌 자리를 버린다 — 다시 켜면 최신 호스트의 자리를 물려받는다', () => {
    const { graph, root } = makeGraph();
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://platform.claude.com/docs'));
    const a = agentId(graph, 'sess-a');
    const fold = webFoldId(a);
    graph.setWebFoldPerAgent(true);
    graph.updateBubblePosition(fold, 10, 20);

    graph.setWebFoldPerAgent(false);
    expect(internals(graph).webFoldPositions.size).toBe(0);
    expect(graph.updateBubblePosition(fold, 1, 1)).toBe(false);

    internals(graph).nodes.get(webNodeKey('platform.claude.com'))!.position = { x: 500, y: 600 };
    internals(graph).bumpMutationVersion();
    graph.setWebFoldPerAgent(true);
    expect(foldOf(graph.getSnapshot(), a)?.position).toEqual({ x: 500, y: 600 });
  });

  it('주인 에이전트가 사라지면 그 접힌 자리도 다음 스냅샷에서 버린다', () => {
    const { graph, root } = makeGraph();
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://platform.claude.com/docs'));
    const a = agentId(graph, 'sess-a');
    graph.setWebFoldPerAgent(true);
    graph.updateBubblePosition(webFoldId(a), 10, 20);
    expect(internals(graph).webFoldPositions.has(webFoldId(a))).toBe(true);

    graph.removeBubble(a);
    vi.setSystemTime(T0 + 1000);
    graph.getSnapshot();
    expect(internals(graph).webFoldPositions.has(webFoldId(a))).toBe(false);
  });
});

describe('§5.23 접어 보기 — 만료', () => {
  it('호스트들이 TTL 로 걷히면 접힌 버블도 함께 걷힌다(§2.4)', () => {
    const { graph, root } = makeGraph();
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://platform.claude.com/docs'));
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://code.claude.com/docs'));
    const a = agentId(graph, 'sess-a');
    graph.setWebFoldPerAgent(true);
    graph.setAgentStatus('sess-a', 'completed');

    vi.setSystemTime(T0 + BUBBLE_TTL - MIN);
    expect(foldOf(graph.getSnapshot(), a)?.webFold?.hosts).toHaveLength(2);

    vi.setSystemTime(T0 + BUBBLE_TTL + 1000);
    const snap = graph.getSnapshot();
    expect(foldOf(snap, a)).toBeUndefined();
    expect(snap.topFolders.some((n) => n.bubbleType === 'domain')).toBe(false);
  });
});

describe('§5.23 접어 보기 — 매니저', () => {
  function findFold(snapshot: GraphSnapshot): BubbleData | undefined {
    return snapshot.topFolders.find((n) => n.webFold);
  }

  it('켜 둔 뒤에 여는 프로젝트에도 걸린다', () => {
    const manager = new ProjectGraphManager();
    manager.setWebFoldPerAgent(true);
    const dir = makeDir('late');
    manager.registerProject(dir);
    manager.processHookEvent(webFetchPayload(dir, 'sess-late', 'https://platform.claude.com/docs'));

    expect(manager.isWebFoldPerAgent()).toBe(true);
    expect(findFold(manager.getSnapshot())?.webFold?.hosts.map((h) => h.host)).toEqual(['platform.claude.com']);
  });

  it('이미 열린 프로젝트도 켜고 끄는 대로 따라간다', () => {
    const manager = new ProjectGraphManager();
    const dir = makeDir('early');
    manager.registerProject(dir);
    manager.processHookEvent(webFetchPayload(dir, 'sess-early', 'https://platform.claude.com/docs'));
    expect(findFold(manager.getSnapshot())).toBeUndefined();

    manager.setWebFoldPerAgent(true);
    vi.setSystemTime(T0 + 1000);
    expect(findFold(manager.getSnapshot())).toBeDefined();

    manager.setWebFoldPerAgent(false);
    vi.setSystemTime(T0 + 2000);
    expect(findFold(manager.getSnapshot())).toBeUndefined();
  });

  it('프로젝트가 여럿이어도 지우기·자리 저장이 주인 에이전트의 인스턴스로 간다', () => {
    const manager = new ProjectGraphManager();
    const first = makeDir('first');
    const second = makeDir('second');
    manager.registerProject(first);
    manager.registerProject(second);
    manager.setWebFoldPerAgent(true);
    manager.processHookEvent(webFetchPayload(second, 'sess-second', 'https://code.claude.com/docs'));

    const fold = findFold(manager.getSnapshot());
    expect(fold).toBeDefined();
    const foldId = fold!.id;

    manager.updateBubblePositionsBatch([{ id: foldId, x: 7, y: 8 }]);
    vi.setSystemTime(T0 + 1000);
    expect(manager.getSnapshot().topFolders.find((n) => n.id === foldId)?.position).toEqual({ x: 7, y: 8 });

    manager.removeBubble(foldId);
    vi.setSystemTime(T0 + 2000);
    const after = manager.getSnapshot();
    expect(after.topFolders.find((n) => n.id === foldId)).toBeUndefined();
    expect(after.topFolders.some((n) => n.bubbleType === 'domain')).toBe(false);
  });
});
