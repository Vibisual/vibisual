/**
 * §5.1 #3-4 — 세션끼리 건넨 말과 같은 파일 겹침(관찰만).
 * (A) `SendMessage` 사후 훅만 링크가 되고, `main`·하위 에이전트 id 는 한 세션 안이라 빠진다. 받는 이는 글자가 같을 때만 버블로 잇는다.
 *     `live` 는 서버가 찍고, 만료는 스윕이 다시 민다(클라는 시계를 보지 않는다).
 * (B) 서로 다른 에이전트가 가장 최근 쓰기로부터 10분 안에 같은 파일을 쓰면 스냅샷 사본에 겹침이 실린다(체크포인트 ❌).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SESSION_MESSAGE_LINK_LIVE_MS, type BubbleData, type GraphSnapshot } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';

const T0 = Date.parse('2026-11-04T00:00:00Z');
const MIN = 60_000;
let tmpRoot: string;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-msg-overlap-')));
});

afterEach(() => {
  vi.useRealTimers();
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
});

function makeGraph(): ProjectGraph {
  const graph = new ProjectGraph();
  graph.registerProject(tmpRoot);
  return graph;
}

let seq = 0;
function edit(graph: ProjectGraph, sessionId: string, rel: string): void {
  const abs = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `v${seq}\n`, 'utf8');
  graph.processHookEvent({
    session_id: sessionId,
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_use_id: `toolu-edit-${++seq}`,
    tool_input: { file_path: abs, old_string: 'a', new_string: 'b' },
    cwd: tmpRoot,
  });
}

function send(graph: ProjectGraph, sessionId: string, to: string, message = '확인 부탁\n둘째 줄', event = 'PostToolUse'): void {
  graph.processHookEvent({
    session_id: sessionId,
    hook_event_name: event,
    tool_name: 'SendMessage',
    tool_use_id: `toolu-msg-${++seq}`,
    tool_input: { to, message, summary: 'ask' },
    cwd: tmpRoot,
  });
}

function agentOf(graph: ProjectGraph, sessionId: string): BubbleData {
  const a = (graph as unknown as { agents: Map<string, BubbleData> }).agents.get(sessionId);
  if (!a) throw new Error(`no agent ${sessionId}`);
  return a;
}

function fileNode(snap: GraphSnapshot, label: string): BubbleData | undefined {
  const all = [
    ...snap.topFolders,
    ...Object.values(snap.children).flat(),
    ...Object.values(snap.satellites ?? {}).flat(),
  ];
  return all.find((n) => n.bubbleType === 'file' && n.label === label);
}

describe('§5.1 #3-4 (B) 같은 파일 겹침', () => {
  it('서로 다른 두 에이전트가 10분 안에 같은 파일을 쓰면 겹침이 실린다', () => {
    const graph = makeGraph();
    edit(graph, 'sess-a', 'src/shared.ts');
    vi.setSystemTime(T0 + 3 * MIN);
    edit(graph, 'sess-b', 'src/shared.ts');
    const node = fileNode(graph.getSnapshot(), 'shared.ts');
    expect(node?.writeOverlap?.agentIds).toEqual([agentOf(graph, 'sess-a').id, agentOf(graph, 'sess-b').id]);
    expect(node?.writeOverlap?.lastAt).toBe(T0 + 3 * MIN);
  });

  it('같은 에이전트가 여러 번 쓰거나 창 밖이면 겹침이 아니다', () => {
    const graph = makeGraph();
    edit(graph, 'sess-a', 'one.ts');
    edit(graph, 'sess-a', 'one.ts');
    edit(graph, 'sess-a', 'two.ts');
    vi.setSystemTime(T0 + 20 * MIN);
    edit(graph, 'sess-b', 'two.ts');
    const snap = graph.getSnapshot();
    expect(fileNode(snap, 'one.ts')).toBeDefined();
    expect(fileNode(snap, 'two.ts')).toBeDefined();
    expect(fileNode(snap, 'one.ts')?.writeOverlap).toBeUndefined();
    expect(fileNode(snap, 'two.ts')?.writeOverlap).toBeUndefined();
  });

  it('겹침은 저장하지 않는다(체크포인트 노드에 없다)', () => {
    const graph = makeGraph();
    edit(graph, 'sess-a', 'x.ts');
    edit(graph, 'sess-b', 'x.ts');
    expect(fileNode(graph.getSnapshot(), 'x.ts')?.writeOverlap?.agentIds).toHaveLength(2);
    const cp = JSON.stringify(graph.toProjectCheckpoint(tmpRoot));
    expect(cp).not.toContain('writeOverlap');
  });
});

describe('§5.1 #3-4 (A) 세션 간 메시지', () => {
  it('받는 이 이름이 버블 표시명과 같으면 그 버블로 잇고, 모르면 바깥 세션', () => {
    const graph = makeGraph();
    edit(graph, 'sess-a', 'a.ts');
    edit(graph, 'sess-b', 'b.ts');
    const b = agentOf(graph, 'sess-b');
    send(graph, 'sess-a', `${b.label} [3fa9c1]`);
    send(graph, 'sess-a', 'someone-else');
    const links = graph.getSnapshot().sessionMessages ?? [];
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ fromAgentId: agentOf(graph, 'sess-a').id, toAgentId: b.id, preview: '확인 부탁', live: true });
    expect(links[1]!.toAgentId).toBeUndefined();
  });

  it('main·하위 에이전트 id·사전 훅·빈 받는 이는 남기지 않는다', () => {
    const graph = makeGraph();
    edit(graph, 'sess-a', 'a.ts');
    send(graph, 'sess-a', 'main');
    send(graph, 'sess-a', 'a1b2c3d4-e5f6');
    send(graph, 'sess-a', 'peer', 'x', 'PreToolUse');
    send(graph, 'sess-a', '   ');
    expect(graph.getSnapshot().sessionMessages).toBeUndefined();
  });

  it('살아 있는 동안만 선이고, 만료되면 스윕이 다시 밀게 한다', () => {
    const graph = makeGraph();
    edit(graph, 'sess-a', 'a.ts');
    send(graph, 'sess-a', 'peer');
    expect(graph.getSnapshot().sessionMessages?.[0]!.live).toBe(true);
    expect(graph.sweepSessionMessages(T0 + 1000)).toBe(false);
    vi.setSystemTime(T0 + SESSION_MESSAGE_LINK_LIVE_MS + 1);
    expect(graph.sweepSessionMessages()).toBe(true);
    expect(graph.getSnapshot().sessionMessages?.[0]!.live).toBeUndefined();
    expect(graph.sweepSessionMessages()).toBe(false);
  });
});
