/**
 * §5.23 도메인 버블 · §2.4 노드 TTL — "유휴 버블은 제 시계대로 5분 뒤 화면에서 걷힌다"를 못 박는다.
 *
 * 배경: WebFetch/WebSearch 도메인 버블이 쌓이기만 했다. 원인은 둘이었다.
 *  ① 스냅샷 생존 필터 `isAlive` 와 표시 강등(`enrichNode`)의 대상 목록에 `domain` 이 빠져,
 *     §5.23 "TTL 은 일반 버블 경로 그대로" 와 달리 유휴 도메인 버블이 영영 남았다.
 *  ② `removeAgentRefs` 가 턴이 끝날 때마다 소유 기록이 남은 **모든** 유휴 노드의 `lastActivity` 를
 *     다시 찍어, 프로젝트 어디선가 턴이 끝나기만 하면 오래전에 사라졌어야 할 버블이 5분씩 되살아났다
 *     (실측: 유휴 file/folder/domain 1,876장 중 1,592장이 같은 ms 를 달고 있었다).
 *
 * 여기서 잠그는 계약:
 *  1. 에이전트가 끝나 유휴가 된 도메인 버블은 BUBBLE_TTL 이 지나면 스냅샷에서 빠진다.
 *  2. 작업 중(active)인 도메인 버블 · 고정한 도메인 버블은 오래돼도 남는다.
 *  3. 도는 에이전트가 없는 도메인 버블은 저장값이 active 여도 화면에는 idle 로 나간다.
 *  4. 다른 에이전트의 턴 종료(completed · idle 두 길)는 이미 유휴인 버블의 시계를 다시 감지 않는다 —
 *     file 버블도 같다. 이번에 내려가는 노드만 그 순간부터 5분을 받는다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BUBBLE_TTL, webNodeKey, type BubbleData } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';

const T0 = Date.parse('2026-09-14T00:00:00Z');
const MIN = 60 * 1000;

let tmpRoot: string;

beforeEach(() => {
  // 시계만 가짜로 돌린다 — 스냅샷 캐시(판 + 200ms)도 같은 시계를 보므로 분 단위로 옮기면 저절로 무효가 된다.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-domainttl-')));
});

afterEach(() => {
  vi.useRealTimers();
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
});

type Internals = {
  agents: Map<string, BubbleData>;
  nodes: Map<string, BubbleData>;
  bumpMutationVersion(): void;
};

function internals(graph: ProjectGraph): Internals {
  return graph as unknown as Internals;
}

function makeGraph(): ProjectGraph {
  const graph = new ProjectGraph();
  graph.registerProject(tmpRoot);
  return graph;
}

/** 에이전트가 웹 페이지 하나를 읽은 사후 훅 이벤트(§5.23 — 도메인 버블은 사후에만 선다). */
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

/** 파일 하나를 고친 사후 훅 이벤트 — `dismissPurgeOwnership.test.ts` 와 같은 모양. */
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

function domainNode(graph: ProjectGraph, host: string): BubbleData {
  const node = internals(graph).nodes.get(webNodeKey(host));
  if (!node) throw new Error(`domain node not found: ${host}`);
  return node;
}

function nodeByLabel(graph: ProjectGraph, label: string): BubbleData {
  for (const n of internals(graph).nodes.values()) {
    if (n.label === label) return n;
  }
  throw new Error(`node not found: ${label}`);
}

/** 스냅샷 최상위에 실린 버블 — 도메인 버블은 여기로 나간다. */
function shipped(graph: ProjectGraph, id: string): BubbleData | undefined {
  return graph.getSnapshot().topFolders.find((n) => n.id === id);
}

describe('§5.23 도메인 버블 — TTL 이 걸린다', () => {
  it('에이전트가 끝나 유휴가 된 도메인 버블은 5분이 지나면 스냅샷에서 빠진다', () => {
    const graph = makeGraph();
    webFetch(graph, 'sess-a', 'https://platform.claude.com/docs/en/hooks');
    const id = domainNode(graph, 'platform.claude.com').id;

    graph.setAgentStatus('sess-a', 'completed');
    expect(domainNode(graph, 'platform.claude.com').status).toBe('idle');

    vi.setSystemTime(T0 + BUBBLE_TTL - MIN);
    expect(shipped(graph, id)).toBeDefined();

    vi.setSystemTime(T0 + BUBBLE_TTL + 1000);
    expect(shipped(graph, id)).toBeUndefined();
    // 화면의 자리만 회수한다 — 서버 메모리의 노드(항목 이력의 주인)는 그대로다.
    expect(internals(graph).nodes.has(webNodeKey('platform.claude.com'))).toBe(true);
  });

  it('작업 중인 도메인 버블은 오래돼도 남는다', () => {
    const graph = makeGraph();
    webFetch(graph, 'sess-a', 'https://platform.claude.com/docs');
    const id = domainNode(graph, 'platform.claude.com').id;

    vi.setSystemTime(T0 + BUBBLE_TTL * 3);
    expect(shipped(graph, id)?.status).toBe('active');
  });

  it('고정한 도메인 버블은 유휴여도 남는다 (§2.4 preserve-pin)', () => {
    const graph = makeGraph();
    webFetch(graph, 'sess-a', 'https://platform.claude.com/docs');
    const node = domainNode(graph, 'platform.claude.com');
    node.preservePinned = true;
    graph.setAgentStatus('sess-a', 'completed');

    vi.setSystemTime(T0 + BUBBLE_TTL * 3);
    expect(shipped(graph, node.id)).toBeDefined();
  });

  it('도는 에이전트가 없으면 저장값이 active 여도 화면에는 idle 로 나간다', () => {
    const graph = makeGraph();
    webFetch(graph, 'sess-a', 'https://platform.claude.com/docs');
    const node = domainNode(graph, 'platform.claude.com');
    // 에이전트만 내려가고 노드는 못 내린 경로(체크포인트 복원 · keep-alive 등)를 흉내낸다.
    internals(graph).agents.get('sess-a')!.status = 'idle';
    internals(graph).bumpMutationVersion();

    expect(node.status).toBe('active');
    expect(shipped(graph, node.id)?.status).toBe('idle');
  });
});

describe('§2.4 — 다른 에이전트의 턴 종료가 유휴 버블의 시계를 다시 감지 않는다', () => {
  const finishers: [string, (graph: ProjectGraph, sessionId: string) => void][] = [
    ['턴 완료(setAgentStatus)', (graph, sessionId) => { graph.setAgentStatus(sessionId, 'completed'); }],
    ['유휴 전환(markAgentIdle)', (graph, sessionId) => { graph.markAgentIdle(sessionId); }],
  ];

  it.each(finishers)('도메인 버블 — %s', (_name, finish) => {
    const graph = makeGraph();
    webFetch(graph, 'sess-a', 'https://platform.claude.com/docs');
    finish(graph, 'sess-a');
    const early = domainNode(graph, 'platform.claude.com');
    expect(early.lastActivity).toBe(T0);

    // 4분 뒤 다른 에이전트가 다른 사이트를 읽고 끝난다.
    vi.setSystemTime(T0 + 4 * MIN);
    webFetch(graph, 'sess-b', 'https://code.claude.com/docs');
    finish(graph, 'sess-b');
    const late = domainNode(graph, 'code.claude.com');

    expect(early.lastActivity).toBe(T0);
    expect(late.lastActivity).toBe(T0 + 4 * MIN);

    // 6분째 — 먼저 끝난 쪽만 걷힌다. 종전에는 4분째에 시계가 다시 감겨 둘 다 남았다.
    vi.setSystemTime(T0 + 6 * MIN);
    expect(shipped(graph, early.id)).toBeUndefined();
    expect(shipped(graph, late.id)).toBeDefined();
  });

  it.each(finishers)('파일 버블도 같다 — %s', (_name, finish) => {
    const graph = makeGraph();
    editFile(graph, 'sess-a', 'alpha/a.ts');
    finish(graph, 'sess-a');
    expect(nodeByLabel(graph, 'a.ts').status).toBe('idle');
    expect(nodeByLabel(graph, 'a.ts').lastActivity).toBe(T0);

    vi.setSystemTime(T0 + 4 * MIN);
    editFile(graph, 'sess-b', 'beta/b.ts');
    finish(graph, 'sess-b');

    expect(nodeByLabel(graph, 'a.ts').lastActivity).toBe(T0);
    expect(nodeByLabel(graph, 'b.ts').lastActivity).toBe(T0 + 4 * MIN);
  });

  it('이번에 내려가는 노드는 그 순간부터 5분을 받는다', () => {
    const graph = makeGraph();
    webFetch(graph, 'sess-a', 'https://platform.claude.com/docs');

    // 오래 작업하다 끝난다 — 마지막으로 읽은 시각이 아니라 끝난 시각부터 센다.
    vi.setSystemTime(T0 + 10 * MIN);
    graph.setAgentStatus('sess-a', 'completed');
    const node = domainNode(graph, 'platform.claude.com');
    expect(node.status).toBe('idle');
    expect(node.lastActivity).toBe(T0 + 10 * MIN);

    vi.setSystemTime(T0 + 14 * MIN);
    expect(shipped(graph, node.id)).toBeDefined();
  });
});
