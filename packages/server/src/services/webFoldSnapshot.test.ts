/**
 * §5.23 접어 보기·웹 버블 묶기 · §7.22 — 서버가 **스냅샷에 싣는 모양**과, 접힌 버블을 누른 손길이 어디로 풀리는지를 못 박는다.
 *
 * 묶는 규칙 자체는 `webFoldView.test.ts` 가 잠근다. 여기서는 그 함수를 부르는 서버 쪽 배선을 본다:
 *  1. 엔진 씨앗은 묶지 않음이고, 설정을 바꾸는 즉시 다음 스냅샷이 바뀐다(판을 안 올리면 200ms 캐시가 옛 모양을 준다).
 *  2. 기록(`domainEntries`)은 묶이지 않는다 — 묶인 호스트도 제 노드 id 로 실린다.
 *  3. 고정한 호스트는 묶이지 않는다.
 *  4. 접힌 버블 지우기 — 그 에이전트만 읽은 호스트는 지우고, 다른 에이전트도 읽은 호스트는 화살표·소유 기록만
 *     걷는다. 스냅샷에 안 실린 에이전트도 "다른 에이전트"로 센다.
 *  5. 접힌 버블의 자리는 노드 장부 밖에 따로 들고, 설정이 바뀌거나 주인이 사라지거나 묶음이 풀리면 버린다.
 *  6. 호스트가 만료되면(§2.4 TTL) 접힌 버블도 함께 걷힌다.
 *  7. 기본값(같은 사이트 · 비슷한 종류 · 최대 6개)으로 많이 읽으면 종류 묶음으로 선다 — 종류는 기록의 주소로도 가른다.
 *  8. 매니저 — 설정이 나중에 여는 프로젝트에도 걸리고, 지우기·자리 저장이 주인 에이전트의 인스턴스로 간다(`~` id 포함).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BUBBLE_TTL,
  WEB_GROUP_DEFAULTS,
  WEB_GROUP_OFF,
  webFoldId,
  webNodeKey,
  type ActivityEdge,
  type BubbleData,
  type GraphSnapshot,
  type WebGroupSettings,
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

/** 종전 접어 보기 — 에이전트마다 하나(같은 사이트·종류 없이). */
const ONE: WebGroupSettings = { sameSite: false, byKind: false, maxPerAgent: 1 };

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

describe('§5.23 묶기 — 켜고 끄기', () => {
  it('엔진 씨앗은 묶지 않음 — 호스트마다 버블 하나로 나간다(앱의 기본값은 부팅 때 밀어 넣는다)', () => {
    const { graph, root } = makeGraph();
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://platform.claude.com/docs'));
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://code.claude.com/docs'));

    const snap = graph.getSnapshot();
    expect(graph.getWebGroupSettings()).toEqual(WEB_GROUP_OFF);
    expect(topIds(snap)).toEqual(expect.arrayContaining([domainId(graph, 'platform.claude.com'), domainId(graph, 'code.claude.com')]));
    expect(snap.topFolders.some((n) => n.webFold)).toBe(false);
  });

  it('켜는 즉시 한 에이전트의 호스트들이 버블 하나로 묶이고, 끄는 즉시 돌아온다 — 캐시가 옛 모양을 주지 않는다', () => {
    const { graph, root } = makeGraph();
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://platform.claude.com/docs'));
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://code.claude.com/docs'));
    const a = agentId(graph, 'sess-a');
    const platform = domainId(graph, 'platform.claude.com');
    const code = domainId(graph, 'code.claude.com');
    graph.getSnapshot(); // 캐시를 채워 둔다

    graph.setWebGroupSettings(ONE);
    const on = graph.getSnapshot();
    const fold = foldOf(on, a);
    expect(fold?.webFold?.hosts.map((h) => h.id).sort()).toEqual([code, platform].sort());
    expect(topIds(on)).not.toContain(platform);
    expect(topIds(on)).not.toContain(code);
    expect(on.edges.filter((e) => e.target === a || e.source === a).map((e) => e.id)).toEqual([`${a}-${webFoldId(a)}-read`]);

    graph.setWebGroupSettings(WEB_GROUP_OFF);
    const off = graph.getSnapshot();
    expect(foldOf(off, a)).toBeUndefined();
    expect(topIds(off)).toEqual(expect.arrayContaining([platform, code]));
    expect(linked(off.edges, platform, a)).toBe(true);
  });

  it('같은 사이트(A)만 켜도 하위 도메인이 사이트 하나로 묶인다', () => {
    const { graph, root } = makeGraph();
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://platform.claude.com/docs'));
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://code.claude.com/docs'));
    const a = agentId(graph, 'sess-a');

    graph.setWebGroupSettings({ sameSite: true, byKind: false, maxPerAgent: 0 });
    const snap = graph.getSnapshot();
    const site = snap.topFolders.find((n) => n.id === webFoldId(a, { site: 'claude.com' }));
    expect(site?.webFold).toMatchObject({ scope: 'site', site: 'claude.com' });
    expect(site?.label).toBe('claude.com');
    expect(snap.topFolders.filter((n) => n.bubbleType === 'domain')).toHaveLength(1);
  });

  it('기록은 묶이지 않는다 — 묶인 호스트도 제 노드 id 로 항목이 실리고, 칸의 항목 수가 그 길이와 같다', () => {
    const { graph, root } = makeGraph();
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://platform.claude.com/docs'));
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://platform.claude.com/hooks'));
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://code.claude.com/docs'));
    const a = agentId(graph, 'sess-a');
    const before = graph.getSnapshot().domainEntries;

    graph.setWebGroupSettings(ONE);
    const snap = graph.getSnapshot();
    expect(snap.domainEntries).toEqual(before);
    for (const h of foldOf(snap, a)?.webFold?.hosts ?? []) {
      expect(h.entryCount).toBe(snap.domainEntries[h.id]?.length ?? 0);
    }
    expect(foldOf(snap, a)?.webFold?.hosts.find((h) => h.host === 'platform.claude.com')?.entryCount).toBe(2);
  });

  it('고정한 호스트는 묶이지 않고 제 버블로 남는다', () => {
    const { graph, root } = makeGraph();
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://platform.claude.com/docs'));
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://code.claude.com/docs'));
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://www.anthropic.com/news'));
    const a = agentId(graph, 'sess-a');
    internals(graph).nodes.get(webNodeKey('platform.claude.com'))!.preservePinned = true;
    internals(graph).bumpMutationVersion();

    graph.setWebGroupSettings(ONE);
    const snap = graph.getSnapshot();
    expect(topIds(snap)).toContain(domainId(graph, 'platform.claude.com'));
    // 호스트 추출기는 `www.` 를 뗀다(§5.23 — `www.anthropic.com` 과 `anthropic.com` 은 한 호스트다).
    expect(foldOf(snap, a)?.webFold?.hosts.map((h) => h.host).sort()).toEqual(['anthropic.com', 'code.claude.com']);
  });
});

describe('§5.23 묶기 — 접힌 버블 지우기', () => {
  it('묶기가 꺼져 있으면 접힌 id 는 모르는 id 다', () => {
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
    graph.processHookEvent(webFetchPayload(root, 'sess-b', 'https://docs.anthropic.com/en/home'));
    const a = agentId(graph, 'sess-a');
    const b = agentId(graph, 'sess-b');
    const platform = domainId(graph, 'platform.claude.com');
    const anthropic = domainId(graph, 'docs.anthropic.com');
    graph.setWebGroupSettings(ONE);
    expect(foldOf(graph.getSnapshot(), b)?.webFold?.hosts.map((h) => h.id).sort()).toEqual([anthropic, platform].sort());

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
    expect(foldOf(snap, b)?.webFold?.hosts.map((h) => h.id).sort()).toEqual([anthropic, platform].sort());
    expect(snap.domainEntries[platform]?.length).toBeGreaterThan(0);
  });

  it('스냅샷에 안 실린 에이전트도 다른 독자로 센다 — 그 에이전트가 읽은 흔적이 지워지지 않는다', () => {
    const { graph, root } = makeGraph();
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://platform.claude.com/docs'));
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://code.claude.com/docs'));
    graph.processHookEvent(webFetchPayload(root, 'sess-b', 'https://platform.claude.com/hooks'));
    const a = agentId(graph, 'sess-a');
    const b = agentId(graph, 'sess-b');
    const platform = domainId(graph, 'platform.claude.com');
    // 파이프라인 자식은 최상위 에이전트로 실리지 않는다 — 숨긴 탭의 에이전트와 같은 처지다.
    internals(graph).agents.get('sess-b')!.pipelineParentId = 'pipeline-parent';
    internals(graph).bumpMutationVersion();
    graph.setWebGroupSettings(ONE);
    const before = graph.getSnapshot();
    expect(before.agents.map((x) => x.id)).not.toContain(b);
    expect(foldOf(before, a)?.webFold?.hosts.map((h) => h.id)).toContain(platform);

    expect(graph.removeWebFold(webFoldId(a))).toBe(true);

    expect(internals(graph).nodes.has(webNodeKey('platform.claude.com'))).toBe(true);
    expect(internals(graph).nodes.has(webNodeKey('code.claude.com'))).toBe(false);
    expect(linked(internals(graph).mainEdges.getAll(), platform, b)).toBe(true);
    expect(linked(internals(graph).mainEdges.getAll(), platform, a)).toBe(false);
  });
});

describe('§5.23 묶기 — 자리', () => {
  /** 두 곳을 차례로 읽는다 — 나중 것이 최신 호스트다. */
  function readTwo(graph: ProjectGraph, root: string): void {
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://platform.claude.com/docs'));
    vi.setSystemTime(T0 + 100);
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://code.claude.com/docs'));
  }

  it('접힌 버블의 자리는 한 장·일괄 저장 모두 받아 다음 스냅샷에 입힌다', () => {
    const { graph, root } = makeGraph();
    readTwo(graph, root);
    const a = agentId(graph, 'sess-a');
    const fold = webFoldId(a);
    graph.setWebGroupSettings(ONE);

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
    readTwo(graph, root);
    const a = agentId(graph, 'sess-a');
    const fold = webFoldId(a);
    graph.setWebGroupSettings(ONE);
    graph.updateBubblePosition(fold, 10, 20);

    graph.setWebGroupSettings(WEB_GROUP_OFF);
    expect(internals(graph).webFoldPositions.size).toBe(0);
    expect(graph.updateBubblePosition(fold, 1, 1)).toBe(false);

    internals(graph).nodes.get(webNodeKey('code.claude.com'))!.position = { x: 500, y: 600 };
    internals(graph).bumpMutationVersion();
    graph.setWebGroupSettings(ONE);
    expect(foldOf(graph.getSnapshot(), a)?.position).toEqual({ x: 500, y: 600 });
  });

  it('같은 설정을 다시 주면 자리를 지키고, 다른 설정이면 비운다', () => {
    const { graph, root } = makeGraph();
    readTwo(graph, root);
    const fold = webFoldId(agentId(graph, 'sess-a'));
    graph.setWebGroupSettings(ONE);
    graph.updateBubblePosition(fold, 10, 20);

    graph.setWebGroupSettings({ ...ONE });
    expect(internals(graph).webFoldPositions.get(fold)).toEqual({ x: 10, y: 20 });

    graph.setWebGroupSettings({ ...ONE, maxPerAgent: 2 });
    expect(internals(graph).webFoldPositions.size).toBe(0);
  });

  it('주인 에이전트가 사라지면 그 접힌 자리도 다음 스냅샷에서 버린다', () => {
    const { graph, root } = makeGraph();
    readTwo(graph, root);
    const a = agentId(graph, 'sess-a');
    graph.setWebGroupSettings(ONE);
    graph.updateBubblePosition(webFoldId(a), 10, 20);
    expect(internals(graph).webFoldPositions.has(webFoldId(a))).toBe(true);

    graph.removeBubble(a);
    vi.setSystemTime(T0 + 1000);
    graph.getSnapshot();
    expect(internals(graph).webFoldPositions.has(webFoldId(a))).toBe(false);
  });

  it('묶음이 풀리면(구성원이 하나 남으면) 그 자리를 다음 스냅샷에서 버린다', () => {
    const { graph, root } = makeGraph();
    readTwo(graph, root);
    const a = agentId(graph, 'sess-a');
    graph.setWebGroupSettings(ONE);
    graph.updateBubblePosition(webFoldId(a), 10, 20);

    graph.removeBubble(domainId(graph, 'code.claude.com'));
    vi.setSystemTime(T0 + 1000);
    const snap = graph.getSnapshot();
    expect(foldOf(snap, a)).toBeUndefined();
    expect(topIds(snap)).toContain(domainId(graph, 'platform.claude.com'));
    expect(internals(graph).webFoldPositions.has(webFoldId(a))).toBe(false);
  });
});

describe('§5.23 묶기 — 만료', () => {
  it('호스트들이 TTL 로 걷히면 접힌 버블도 함께 걷힌다(§2.4)', () => {
    const { graph, root } = makeGraph();
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://platform.claude.com/docs'));
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://code.claude.com/docs'));
    const a = agentId(graph, 'sess-a');
    graph.setWebGroupSettings(ONE);
    graph.setAgentStatus('sess-a', 'completed');

    vi.setSystemTime(T0 + BUBBLE_TTL - MIN);
    expect(foldOf(graph.getSnapshot(), a)?.webFold?.hosts).toHaveLength(2);

    vi.setSystemTime(T0 + BUBBLE_TTL + 1000);
    const snap = graph.getSnapshot();
    expect(foldOf(snap, a)).toBeUndefined();
    expect(snap.topFolders.some((n) => n.bubbleType === 'domain')).toBe(false);
  });
});

describe('§5.23 묶기 — 기본값(같은 사이트 · 비슷한 종류 · 최대 6개)', () => {
  const RESEARCH = [
    'https://react.dev/reference/react/useState',
    'https://electronjs.org/docs/latest/api/browser-window',
    'https://nodejs.org/api/fs.html',
    'https://web.dev/articles/vitals',
    'https://vitejs.dev/guide/',
    'https://github.com/electron/electron/issues/1',
    'https://gitlab.com/x/y',
    'https://stackoverflow.com/questions/1/x',
    'https://pypi.org/project/x/',
    'https://example.org/about',
  ];

  it('웹을 많이 읽으면 에이전트 둘레의 웹 버블이 최대 6개로 줄고, 문서들은 종류 묶음 하나에 든다', () => {
    const { graph, root } = makeGraph();
    for (const url of RESEARCH) graph.processHookEvent(webFetchPayload(root, 'sess-a', url));
    const a = agentId(graph, 'sess-a');
    expect(graph.getSnapshot().topFolders.filter((n) => n.bubbleType === 'domain')).toHaveLength(RESEARCH.length);

    graph.setWebGroupSettings(WEB_GROUP_DEFAULTS);
    const snap = graph.getSnapshot();
    const web = snap.topFolders.filter((n) => n.bubbleType === 'domain');
    expect(web.length).toBeLessThanOrEqual(WEB_GROUP_DEFAULTS.maxPerAgent);
    const docs = web.find((n) => n.id === webFoldId(a, { kind: 'docs' }));
    expect(docs?.webFold?.kind).toBe('docs');
    expect(docs?.webFold?.hosts.length ?? 0).toBeGreaterThanOrEqual(2);
    // 묶음이 품은 호스트 + 제 이름으로 선 호스트 = 읽은 호스트 전부(하나도 사라지지 않는다).
    const covered = web.reduce((n, b) => n + (b.webFold ? b.webFold.hosts.length : 1), 0);
    expect(covered).toBe(RESEARCH.length);
    // 에이전트로 가는 웹 화살표도 버블 수만큼만.
    expect(snap.edges.filter((e) => e.target === a && web.some((b) => b.id === e.source))).toHaveLength(web.length);
  });

  it('표에 없는 사이트는 기록의 주소 경로로 종류를 가른다', () => {
    const { graph, root } = makeGraph();
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://alpha.example/docs/start'));
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://beta.example/guide/intro'));
    graph.processHookEvent(webFetchPayload(root, 'sess-a', 'https://gamma.example/about'));
    const a = agentId(graph, 'sess-a');

    graph.setWebGroupSettings({ sameSite: true, byKind: true, maxPerAgent: 2 });
    const snap = graph.getSnapshot();
    const docs = snap.topFolders.find((n) => n.id === webFoldId(a, { kind: 'docs' }));
    expect(docs?.webFold?.hosts.map((h) => h.host).sort()).toEqual(['alpha.example', 'beta.example']);
    expect(topIds(snap)).toContain(domainId(graph, 'gamma.example'));
  });
});

describe('§5.23 묶기 — 매니저', () => {
  function findFold(snapshot: GraphSnapshot): BubbleData | undefined {
    return snapshot.topFolders.find((n) => n.webFold);
  }

  it('설정해 둔 뒤에 여는 프로젝트에도 걸린다', () => {
    const manager = new ProjectGraphManager();
    manager.setWebGroupSettings(ONE);
    const dir = makeDir('late');
    manager.registerProject(dir);
    manager.processHookEvent(webFetchPayload(dir, 'sess-late', 'https://platform.claude.com/docs'));
    manager.processHookEvent(webFetchPayload(dir, 'sess-late', 'https://code.claude.com/docs'));

    expect(manager.getWebGroupSettings()).toEqual(ONE);
    expect(findFold(manager.getSnapshot())?.webFold?.hosts.map((h) => h.host).sort()).toEqual(['code.claude.com', 'platform.claude.com']);
  });

  it('이미 열린 프로젝트도 설정을 바꾸는 대로 따라간다', () => {
    const manager = new ProjectGraphManager();
    const dir = makeDir('early');
    manager.registerProject(dir);
    manager.processHookEvent(webFetchPayload(dir, 'sess-early', 'https://platform.claude.com/docs'));
    manager.processHookEvent(webFetchPayload(dir, 'sess-early', 'https://code.claude.com/docs'));
    expect(findFold(manager.getSnapshot())).toBeUndefined();

    manager.setWebGroupSettings(ONE);
    vi.setSystemTime(T0 + 1000);
    expect(findFold(manager.getSnapshot())).toBeDefined();

    manager.setWebGroupSettings(WEB_GROUP_OFF);
    vi.setSystemTime(T0 + 2000);
    expect(findFold(manager.getSnapshot())).toBeUndefined();
  });

  it('프로젝트가 여럿이어도 지우기·자리 저장이 주인 에이전트의 인스턴스로 간다', () => {
    const manager = new ProjectGraphManager();
    const first = makeDir('first');
    const second = makeDir('second');
    manager.registerProject(first);
    manager.registerProject(second);
    manager.setWebGroupSettings(ONE);
    manager.processHookEvent(webFetchPayload(second, 'sess-second', 'https://code.claude.com/docs'));
    manager.processHookEvent(webFetchPayload(second, 'sess-second', 'https://platform.claude.com/docs'));

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

  it('종류 묶음 id(`~`)도 자리 저장·지우기가 주인 인스턴스로 간다 — 그 종류의 호스트만 지워진다', () => {
    const manager = new ProjectGraphManager();
    const first = makeDir('kind-first');
    const second = makeDir('kind-second');
    manager.registerProject(first);
    manager.registerProject(second);
    manager.setWebGroupSettings({ sameSite: true, byKind: true, maxPerAgent: 2 });
    for (const url of [
      'https://react.dev/learn',
      'https://electronjs.org/docs/latest',
      'https://github.com/a/b',
      'https://gitlab.com/c/d',
    ]) manager.processHookEvent(webFetchPayload(second, 'sess-kind', url));

    const snap = manager.getSnapshot();
    const docs = snap.topFolders.find((n) => n.webFold?.kind === 'docs');
    expect(docs).toBeDefined();
    expect(docs!.id).toContain('~kind~docs');

    manager.updateBubblePositionsBatch([{ id: docs!.id, x: 3, y: 4 }]);
    vi.setSystemTime(T0 + 1000);
    expect(manager.getSnapshot().topFolders.find((n) => n.id === docs!.id)?.position).toEqual({ x: 3, y: 4 });

    manager.removeBubble(docs!.id);
    vi.setSystemTime(T0 + 2000);
    const after = manager.getSnapshot();
    const hosts = after.topFolders.flatMap((n) => (n.webFold ? n.webFold.hosts.map((h) => h.host) : n.bubbleType === 'domain' ? [n.label] : []));
    expect(hosts.sort()).toEqual(['github.com', 'gitlab.com']);
  });
});
