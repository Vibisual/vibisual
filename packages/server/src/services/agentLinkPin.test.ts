/**
 * §5.4 #36 (H) ①-2 — 우클릭 [연결된 버블 ▸] 서버 계약.
 * 1. 고정한 에이전트의 연결(버블 + 선)은 확인 dismiss·자동 유휴·5분 TTL 이 걷지 않는다(고정 순간 끊긴 버블은 되살리지 않는다).
 * 2. 고정 풀기 — 실행 중이면 칸만 내리고, 아니면 곧바로 걷는다. 3. 걷을 때 한 벌 기억해 다시 보기가 같은 id·선 방향·완료 직후 모양으로 세운다(다음 확인 클릭까지).
 * 4. 표식·기록은 체크포인트 왕복(복원·병합)에 남고, 에이전트가 사라지면 같이 사라진다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BUBBLE_TTL, webNodeKey, type ActivityEdge, type BubbleData } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';

const T0 = Date.parse('2026-10-21T00:00:00Z');
const MIN = 60 * 1000;

let tmpRoot: string;
let extRoot: string;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-linkpin-')));
  extRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-linkpin-ext-')));
});

afterEach(() => {
  vi.useRealTimers();
  for (const dir of [tmpRoot, extRoot]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

type Internals = {
  agents: Map<string, BubbleData>;
  nodes: Map<string, BubbleData>;
  satelliteMap: Map<string, Set<string>>;
  mainEdges: { getAll(): ActivityEdge[] };
};

function internals(graph: ProjectGraph): Internals {
  return graph as unknown as Internals;
}

function makeGraph(root = tmpRoot): { graph: ProjectGraph; projectName: string } {
  const graph = new ProjectGraph();
  const info = graph.registerProject(root);
  return { graph, projectName: info.name };
}

/** 파일 하나를 도구로 만진 사후 훅 이벤트(= 에이전트가 작업 중). */
function touch(graph: ProjectGraph, sessionId: string, relPath: string, tool: 'Edit' | 'Read' = 'Edit'): void {
  const abs = path.join(tmpRoot, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (!fs.existsSync(abs)) fs.writeFileSync(abs, 'after\n', 'utf8');
  graph.processHookEvent({
    session_id: sessionId,
    hook_event_name: 'PostToolUse',
    tool_name: tool,
    tool_use_id: `toolu-${sessionId}-${relPath}-${tool}-${Date.now()}`,
    tool_input: tool === 'Edit' ? { file_path: abs, old_string: 'before', new_string: 'after' } : { file_path: abs },
    cwd: tmpRoot,
  });
}

function webFetch(graph: ProjectGraph, sessionId: string, url: string): void {
  graph.processHookEvent({
    session_id: sessionId,
    hook_event_name: 'PostToolUse',
    tool_name: 'WebFetch',
    tool_use_id: `toolu-${sessionId}-${url}`,
    tool_input: { url, prompt: 'summarize' },
    tool_response: { content: [{ type: 'text', text: 'body' }] },
    cwd: tmpRoot,
  });
}

function agentId(graph: ProjectGraph, sessionId: string): string {
  const agent = internals(graph).agents.get(sessionId);
  if (!agent) throw new Error(`agent not found: ${sessionId}`);
  return agent.id;
}

function agentOf(graph: ProjectGraph, sessionId: string): BubbleData {
  return internals(graph).agents.get(sessionId)!;
}

function nodeByLabel(graph: ProjectGraph, label: string): BubbleData | undefined {
  for (const n of internals(graph).nodes.values()) if (n.label === label) return n;
  return undefined;
}

/** 에이전트와 그 버블을 잇는 활동 선(방향 무관). */
function linkBetween(graph: ProjectGraph, agent: string, nodeId: string): ActivityEdge | undefined {
  return internals(graph).mainEdges.getAll()
    .find((e) => (e.source === agent && e.target === nodeId) || (e.source === nodeId && e.target === agent));
}

function shippedTop(graph: ProjectGraph, id: string): BubbleData | undefined {
  return graph.getSnapshot().topFolders.find((n) => n.id === id);
}

function shippedAgent(graph: ProjectGraph, id: string): BubbleData | undefined {
  return graph.getSnapshot().agents.find((a) => a.id === id);
}

describe('고정 — 확인 dismiss · 자동 유휴 · TTL 이 걷지 않는다', () => {
  it('완료된 에이전트를 눌러도 고정한 연결 버블과 선이 남는다(클릭은 그대로 확인이다)', () => {
    const { graph } = makeGraph();
    touch(graph, 'sess', 'pkg/a.ts');
    const id = agentId(graph, 'sess');
    expect(graph.setAgentLinksPinned(id, true)).toEqual({ ok: true, linksPinned: true, purged: [] });

    graph.setAgentStatus('sess', 'completed');
    expect(graph.markAgentIdle('sess', true)).toEqual([]);

    const folder = nodeByLabel(graph, 'pkg')!;
    expect(nodeByLabel(graph, 'a.ts')).toBeDefined();
    expect(linkBetween(graph, id, folder.id)).toBeDefined();
    expect(agentOf(graph, 'sess').status).toBe('idle');
  });

  it('완료 60초 뒤 자동 유휴가 와도 선을 지우지 않는다', () => {
    const { graph } = makeGraph();
    touch(graph, 'sess', 'pkg/a.ts');
    const id = agentId(graph, 'sess');
    graph.setAgentLinksPinned(id, true);
    graph.setAgentStatus('sess', 'completed');

    graph.markAgentIdle('sess');

    expect(linkBetween(graph, id, nodeByLabel(graph, 'pkg')!.id)).toBeDefined();
  });

  it('5분 TTL 이 지나도 스냅샷에서 빠지지 않는다 — 고정하지 않은 쪽은 빠진다', () => {
    const { graph } = makeGraph();
    touch(graph, 'pinned', 'keep/a.ts');
    touch(graph, 'plain', 'drop/b.ts');
    graph.setAgentLinksPinned(agentId(graph, 'pinned'), true);
    for (const sid of ['pinned', 'plain']) {
      graph.setAgentStatus(sid, 'completed');
      graph.markAgentIdle(sid);
    }

    vi.setSystemTime(T0 + BUBBLE_TTL * 3);
    const keep = nodeByLabel(graph, 'keep')!;
    const file = nodeByLabel(graph, 'a.ts')!;
    expect(shippedTop(graph, keep.id)).toBeDefined();
    expect(graph.getSnapshot().children[keep.id]?.map((n) => n.id)).toContain(file.id);
    expect(shippedTop(graph, nodeByLabel(graph, 'drop')!.id)).toBeUndefined();
  });

  it('고정하는 순간 이미 선이 끊긴 버블은 되살리지 않는다(다시 보기의 일이다)', () => {
    const { graph } = makeGraph();
    touch(graph, 'sess', 'old/a.ts');
    graph.setAgentStatus('sess', 'completed');
    graph.markAgentIdle('sess');
    vi.setSystemTime(T0 + BUBBLE_TTL + MIN);
    const folder = nodeByLabel(graph, 'old')!;
    expect(shippedTop(graph, folder.id)).toBeUndefined();

    graph.setAgentLinksPinned(agentId(graph, 'sess'), true);

    expect(shippedTop(graph, folder.id)).toBeUndefined();
  });

  it('없는 버블·에이전트가 아닌 버블은 not-found, 휴지통 안 에이전트는 not-eligible', () => {
    const { graph } = makeGraph();
    touch(graph, 'sess', 'pkg/a.ts');
    expect(graph.setAgentLinksPinned('nope', true)).toEqual({ ok: false, reason: 'not-found' });
    expect(graph.setAgentLinksPinned(nodeByLabel(graph, 'pkg')!.id, true)).toEqual({ ok: false, reason: 'not-found' });
    agentOf(graph, 'sess').trashed = true;
    expect(graph.setAgentLinksPinned(agentId(graph, 'sess'), true)).toEqual({ ok: false, reason: 'not-eligible' });
    expect(graph.replayAgentLinks(agentId(graph, 'sess'))).toEqual({ ok: false, reason: 'not-eligible' });
  });
});

describe('고정 풀기', () => {
  it('실행 중이 아니면 푸는 순간 걷고, 에이전트 상태(완료)는 건드리지 않는다', () => {
    const { graph } = makeGraph();
    touch(graph, 'sess', 'pkg/a.ts');
    const id = agentId(graph, 'sess');
    graph.setAgentLinksPinned(id, true);
    graph.setAgentStatus('sess', 'completed');
    const folderId = nodeByLabel(graph, 'pkg')!.id;

    const result = graph.setAgentLinksPinned(id, false);

    expect(result.ok && result.purged).toContain(folderId);
    expect(nodeByLabel(graph, 'pkg')).toBeUndefined();
    expect(nodeByLabel(graph, 'a.ts')).toBeUndefined();
    expect(linkBetween(graph, id, folderId)).toBeUndefined();
    expect(agentOf(graph, 'sess').status).toBe('completed');
    expect(agentOf(graph, 'sess').linksPinned).toBeUndefined();
  });

  it('실행 중이면 칸만 내린다 — 끝난 뒤의 확인 클릭은 종전대로 걷는다', () => {
    const { graph } = makeGraph();
    touch(graph, 'sess', 'pkg/a.ts');
    const id = agentId(graph, 'sess');
    graph.setAgentLinksPinned(id, true);
    expect(agentOf(graph, 'sess').status).toBe('active');

    expect(graph.setAgentLinksPinned(id, false)).toEqual({ ok: true, linksPinned: false, purged: [] });
    expect(nodeByLabel(graph, 'a.ts')).toBeDefined();

    const folderId = nodeByLabel(graph, 'pkg')!.id;
    graph.setAgentStatus('sess', 'completed');
    expect(graph.markAgentIdle('sess', true)).toContain(folderId);
    expect(nodeByLabel(graph, 'a.ts')).toBeUndefined();
  });

  it('고정돼 있지 않던 것을 푸는 요청은 아무것도 걷지 않는다(늦게 온 중복 요청)', () => {
    const { graph } = makeGraph();
    touch(graph, 'sess', 'pkg/a.ts');
    graph.setAgentStatus('sess', 'completed');

    expect(graph.setAgentLinksPinned(agentId(graph, 'sess'), false)).toEqual({ ok: true, linksPinned: false, purged: [] });
    expect(nodeByLabel(graph, 'a.ts')).toBeDefined();
  });
});

describe('이전 연결 다시 보기', () => {
  it('확인 dismiss 가 걷기 직전 연결을 기억하고, 스냅샷에 그 버블 수를 싣는다', () => {
    const { graph } = makeGraph();
    touch(graph, 'sess', 'pkg/a.ts');
    const id = agentId(graph, 'sess');
    expect(shippedAgent(graph, id)?.prevLinkCount).toBeUndefined();

    graph.setAgentStatus('sess', 'completed');
    graph.markAgentIdle('sess', true);

    expect(nodeByLabel(graph, 'a.ts')).toBeUndefined();
    expect(shippedAgent(graph, id)?.prevLinkCount).toBe(2); // pkg · pkg/a.ts
    // 이미 걷힌 뒤의 헛클릭이 기록을 빈 것으로 덮지 않는다.
    graph.markAgentIdle('sess', true);
    expect(shippedAgent(graph, id)?.prevLinkCount).toBe(2);
  });

  it('같은 id·같은 선 방향·완료 직후 모양으로 다시 세우고, 걷기 전의 횟수·자리를 되돌린다', () => {
    const { graph } = makeGraph();
    touch(graph, 'sess', 'pkg/a.ts');
    touch(graph, 'sess', 'pkg/a.ts');
    const id = agentId(graph, 'sess');
    const folder = nodeByLabel(graph, 'pkg')!;
    const file = nodeByLabel(graph, 'a.ts')!;
    file.position = { x: 120, y: -40 };
    const before = { activity: file.activity, writeCount: file.writeCount, folderActivity: folder.activity };
    const direction = linkBetween(graph, id, folder.id)!.source;
    graph.setAgentStatus('sess', 'completed');
    graph.markAgentIdle('sess', true);

    vi.setSystemTime(T0 + 10 * MIN);
    expect(graph.replayAgentLinks(id)).toEqual({ ok: true, restored: 2 });

    const folderAgain = nodeByLabel(graph, 'pkg')!;
    const fileAgain = nodeByLabel(graph, 'a.ts')!;
    expect(folderAgain.id).toBe(folder.id);
    expect(fileAgain.id).toBe(file.id);
    expect(fileAgain.status).toBe('idle');
    expect(fileAgain.position).toEqual({ x: 120, y: -40 });
    expect(fileAgain.activity).toBe(before.activity);
    expect(fileAgain.writeCount).toBe(before.writeCount);
    expect(folderAgain.activity).toBe(before.folderActivity);
    const edge = linkBetween(graph, id, folder.id)!;
    expect(edge.source).toBe(direction);
    expect(edge.isActive).toBe(false);
    // 완료로 꾸미지 않는다 — 완료음·완료 알림이 거짓으로 울린다.
    expect(agentOf(graph, 'sess').status).toBe('idle');
    expect(agentOf(graph, 'sess').linksReplay).toBe(true);
  });

  it('순서는 처음 만진 순서가 아니라 마지막으로 만진 순서다(읽기 → 고치기 → 다시 읽기면 읽기 선)', () => {
    const { graph } = makeGraph();
    touch(graph, 'sess', 'pkg/a.ts', 'Read');
    vi.setSystemTime(T0 + MIN);
    touch(graph, 'sess', 'pkg/b.ts', 'Edit');
    vi.setSystemTime(T0 + 2 * MIN);
    touch(graph, 'sess', 'pkg/a.ts', 'Read');
    const id = agentId(graph, 'sess');
    const folderId = nodeByLabel(graph, 'pkg')!.id;
    expect(linkBetween(graph, id, folderId)!.source).toBe(folderId);
    // 완료 강등이 모든 버블의 lastActivity 를 같은 시각으로 다시 찍는다 — 그래도 순서는 선의 시각이 지킨다.
    vi.setSystemTime(T0 + 3 * MIN);
    graph.setAgentStatus('sess', 'completed');
    graph.markAgentIdle('sess', true);

    graph.replayAgentLinks(id);

    expect(linkBetween(graph, id, folderId)!.source).toBe(folderId);
    expect(linkBetween(graph, id, folderId)!.label).toBe('Read');
  });

  it('마지막 도구가 읽기면 선도 읽기 방향으로 다시 선다', () => {
    const { graph } = makeGraph();
    touch(graph, 'sess', 'pkg/a.ts', 'Edit');
    vi.setSystemTime(T0 + MIN);
    touch(graph, 'sess', 'pkg/b.ts', 'Read');
    const id = agentId(graph, 'sess');
    const folderId = nodeByLabel(graph, 'pkg')!.id;
    expect(linkBetween(graph, id, folderId)!.source).toBe(folderId);
    graph.setAgentStatus('sess', 'completed');
    graph.markAgentIdle('sess', true);

    graph.replayAgentLinks(id);

    expect(linkBetween(graph, id, folderId)!.source).toBe(folderId);
  });

  it('다시 본 연결은 TTL·자동 유휴를 견디고, 다음 확인 클릭에 걷히며 기록은 다시 적힌다', () => {
    const { graph } = makeGraph();
    touch(graph, 'sess', 'pkg/a.ts');
    const id = agentId(graph, 'sess');
    graph.setAgentStatus('sess', 'completed');
    graph.markAgentIdle('sess', true);
    graph.replayAgentLinks(id);
    const folderId = nodeByLabel(graph, 'pkg')!.id;

    vi.setSystemTime(T0 + BUBBLE_TTL * 3);
    graph.markAgentIdle('sess');
    expect(shippedTop(graph, folderId)).toBeDefined();
    expect(linkBetween(graph, id, folderId)).toBeDefined();

    graph.markAgentIdle('sess', true);
    expect(nodeByLabel(graph, 'pkg')).toBeUndefined();
    expect(agentOf(graph, 'sess').linksReplay).toBeUndefined();
    expect(shippedAgent(graph, id)?.prevLinkCount).toBe(2);
  });

  it('고정과 함께면 다시 본 연결도 확인 클릭에 남는다', () => {
    const { graph } = makeGraph();
    touch(graph, 'sess', 'pkg/a.ts');
    const id = agentId(graph, 'sess');
    graph.setAgentStatus('sess', 'completed');
    graph.markAgentIdle('sess', true);
    graph.replayAgentLinks(id);
    graph.setAgentLinksPinned(id, true);

    expect(graph.markAgentIdle('sess', true)).toEqual([]);
    expect(nodeByLabel(graph, 'a.ts')).toBeDefined();
  });

  it('실행 중이면 running, 기억한 연결이 없으면 empty, 없는 버블은 not-found', () => {
    const { graph } = makeGraph();
    touch(graph, 'sess', 'pkg/a.ts');
    const id = agentId(graph, 'sess');
    expect(graph.replayAgentLinks(id)).toEqual({ ok: false, reason: 'running' });
    graph.setAgentStatus('sess', 'completed');
    expect(graph.replayAgentLinks(id)).toEqual({ ok: false, reason: 'empty' });
    expect(graph.replayAgentLinks('nope')).toEqual({ ok: false, reason: 'not-found' });
  });

  it('외부 폴더를 Grep 으로 훑어 붙었던 파일은 그 폴더 밑으로 다시 선다(직속 부모 폴더를 새로 세우지 않는다)', () => {
    const { graph } = makeGraph();
    const result = path.join(extRoot, 'sub', 'x.ts');
    fs.mkdirSync(path.dirname(result), { recursive: true });
    fs.writeFileSync(result, 'x\n', 'utf8');
    graph.processHookEvent({
      session_id: 'sess',
      hook_event_name: 'PostToolUse',
      tool_name: 'Grep',
      tool_use_id: 'toolu-grep',
      tool_input: { path: extRoot, pattern: 'x' },
      tool_response: { filenames: [result] },
      cwd: tmpRoot,
    });
    const externalIds = (): string[] => [...internals(graph).nodes.values()]
      .filter((n) => n.bubbleType === 'external_folder').map((n) => n.id).sort();
    const folderIds = externalIds();
    expect(folderIds).toHaveLength(1);
    const fileId = [...internals(graph).nodes.values()].find((n) => n.bubbleType === 'file')!.id;
    const id = agentId(graph, 'sess');
    graph.setAgentStatus('sess', 'completed');
    graph.markAgentIdle('sess', true);
    expect(externalIds()).toEqual([]);

    graph.replayAgentLinks(id);

    expect(externalIds()).toEqual(folderIds);
    const folderKey = [...internals(graph).nodes].find(([, n]) => n.id === folderIds[0])![0];
    const fileKey = [...internals(graph).nodes].find(([, n]) => n.id === fileId)![0];
    expect([...(internals(graph).satelliteMap.get(folderKey) ?? [])]).toContain(fileKey);
  });

  it('도메인 버블은 버블과 함께 사라졌던 웹 이력까지 되돌린다', () => {
    const { graph } = makeGraph();
    webFetch(graph, 'sess', 'https://example.com/docs/a');
    const id = agentId(graph, 'sess');
    const domain = internals(graph).nodes.get(webNodeKey('example.com'))!;
    graph.setAgentStatus('sess', 'completed');
    graph.markAgentIdle('sess', true);
    expect(internals(graph).nodes.has(webNodeKey('example.com'))).toBe(false);

    graph.replayAgentLinks(id);

    expect(internals(graph).nodes.get(webNodeKey('example.com'))?.id).toBe(domain.id);
    expect(graph.getSnapshot().domainEntries?.[domain.id]?.map((e) => e.url)).toEqual(['https://example.com/docs/a']);
    expect(linkBetween(graph, id, domain.id)?.source).toBe(domain.id);
  });

  it('명령 앱 버블도 같은 자리에 다시 선다', () => {
    const { graph } = makeGraph();
    graph.processHookEvent({
      session_id: 'sess', tool_name: 'Bash', tool_use_id: 'git-1', hook_event_name: 'PreToolUse',
      cwd: tmpRoot, tool_input: { command: 'git status' },
    });
    graph.processHookEvent({
      session_id: 'sess', tool_name: 'Bash', tool_use_id: 'git-1', hook_event_name: 'PostToolUse',
      cwd: tmpRoot, tool_input: { command: 'git status' }, tool_response: { stdout: 'ok', exit_code: 0 },
    });
    const app = graph.getSnapshot().topFolders.find((n) => n.commandApp)!;
    const id = agentId(graph, 'sess');
    graph.setAgentStatus('sess', 'completed');
    graph.markAgentIdle('sess', true);
    expect(graph.getSnapshot().topFolders.some((n) => n.commandApp)).toBe(false);

    graph.replayAgentLinks(id);

    const again = graph.getSnapshot().topFolders.find((n) => n.commandApp);
    expect(again?.id).toBe(app.id);
    expect(again?.status).toBe('idle');
    expect(linkBetween(graph, id, app.id)).toBeDefined();
  });
});

describe('영속 — 체크포인트 왕복', () => {
  it('고정 표식과 기록이 껐다 켠 뒤에도 남고, 다시 보기가 그대로 된다', () => {
    const { graph, projectName } = makeGraph();
    touch(graph, 'kept', 'keep/a.ts');
    touch(graph, 'gone', 'gone/b.ts');
    graph.setAgentLinksPinned(agentId(graph, 'kept'), true);
    graph.setAgentStatus('gone', 'completed');
    graph.markAgentIdle('gone', true);
    const goneId = agentId(graph, 'gone');
    const cp = structuredClone(graph.toProjectCheckpoint(projectName));
    expect(cp.agentLinkRecords?.[goneId]?.entries).toHaveLength(2);

    const revived = new ProjectGraph();
    revived.registerProject(tmpRoot);
    revived.restoreFromCheckpoint(cp);

    expect(agentOf(revived, 'kept').linksPinned).toBe(true);
    expect(shippedAgent(revived, goneId)?.prevLinkCount).toBe(2);
    expect(revived.replayAgentLinks(goneId)).toEqual({ ok: true, restored: 2 });
    expect(nodeByLabel(revived, 'b.ts')).toBeDefined();
  });

  it('껐다 켠 뒤에도 고정한 연결은 선과 함께 TTL 을 견딘다(부팅 청소도 걷지 않는다)', () => {
    const { graph, projectName } = makeGraph();
    touch(graph, 'kept', 'keep/a.ts');
    const id = agentId(graph, 'kept');
    graph.setAgentLinksPinned(id, true);
    graph.setAgentStatus('kept', 'completed');
    graph.markAgentIdle('kept', true);
    const cp = structuredClone(graph.toProjectCheckpoint(projectName));

    const revived = new ProjectGraph();
    revived.registerProject(tmpRoot);
    revived.restoreFromCheckpoint(cp);
    revived.sweepIdleAgentFileFolderEdges();

    const folderId = nodeByLabel(revived, 'keep')!.id;
    expect(linkBetween(revived, id, folderId)).toBeDefined();
    vi.setSystemTime(T0 + BUBBLE_TTL * 3);
    expect(shippedTop(revived, folderId)).toBeDefined();
  });

  it('다른 프로젝트 체크포인트를 병합해도 기록이 실린다', () => {
    const { graph, projectName } = makeGraph();
    touch(graph, 'gone', 'gone/b.ts');
    graph.setAgentStatus('gone', 'completed');
    graph.markAgentIdle('gone', true);
    const goneId = agentId(graph, 'gone');

    const other = new ProjectGraph();
    other.registerProject(extRoot);
    other.mergeFromCheckpoint(structuredClone(graph.toProjectCheckpoint(projectName)));

    expect(other.toProjectCheckpoint(projectName).agentLinkRecords?.[goneId]?.entries).toHaveLength(2);
  });

  it('기록 칸이 없는 옛 체크포인트도 빈 기록으로 복원한다', () => {
    const { graph, projectName } = makeGraph();
    touch(graph, 'sess', 'pkg/a.ts');
    const cp = structuredClone(graph.toProjectCheckpoint(projectName));
    delete cp.agentLinkRecords;
    const revived = new ProjectGraph();
    revived.registerProject(tmpRoot);
    revived.restoreFromCheckpoint(cp);
    expect(shippedAgent(revived, agentId(revived, 'sess'))?.prevLinkCount).toBeUndefined();
  });

  it('에이전트를 지우면 그 기록도 함께 사라진다', () => {
    const { graph, projectName } = makeGraph();
    touch(graph, 'gone', 'gone/b.ts');
    graph.setAgentStatus('gone', 'completed');
    graph.markAgentIdle('gone', true);
    graph.removeBubble(agentId(graph, 'gone'));
    expect(graph.toProjectCheckpoint(projectName).agentLinkRecords).toBeUndefined();
  });
});
