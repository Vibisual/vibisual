/**
 * §5.23 접어 보기 — `foldWebBubblesPerAgent`(shared 순수 함수)의 계약을 못 박는다.
 *
 * 서버 `getSnapshot` 이 실어 보내기 직전에 이 함수로 한 에이전트가 읽은 호스트 버블들을 버블 하나로
 * 접는다. 바꾸는 것은 **실어 보내는 모양뿐**이라, 여기서 잠그는 것도 모양의 규칙이다.
 *
 * 여기서 잠그는 계약:
 *  1. 접을 것이 없으면 입력 배열을 그대로 돌려준다(새 배열 ❌ — 캐시된 스냅샷 참조가 흔들리지 않게).
 *  2. 누구의 것인가는 화살표가 정한다 — 이번에 실리는 에이전트와 이어진, 고정하지 않은 도메인만 접는다.
 *  3. 접힌 버블은 첫 구성원이 있던 자리에 서고, 에이전트마다 읽기 화살표 **하나**만 남는다.
 *  4. 두 에이전트가 함께 읽은 호스트는 두 접힌 버블에 다 들어간다.
 *  5. 상태·척도·자리는 구성원에서 정해진 규칙대로 모은다(합 ❌ · 최댓값).
 *  6. 입력 배열과 객체를 고치지 않는다 — 서버가 200ms 동안 같은 객체를 되돌려 준다.
 */
import { describe, it, expect } from 'vitest';
import {
  WEB_FOLD_ID_PREFIX,
  WEB_KEY_MARK,
  foldWebBubblesPerAgent,
  webFoldAgentId,
  webFoldId,
  webFoldNodePath,
  type ActivityEdge,
  type BubbleData,
  type WebFoldInput,
} from '@vibisual/shared';

const T0 = Date.parse('2026-09-14T00:00:00Z');

function host(id: string, label: string, extra: Partial<BubbleData> = {}): BubbleData {
  return { id, label, bubbleType: 'domain', path: label, status: 'idle', activity: 1, ...extra };
}

function folder(id: string, label: string): BubbleData {
  return { id, label, bubbleType: 'internal_folder', path: label, status: 'idle', activity: 1 };
}

/** 읽기 화살표는 호스트 → 에이전트다(§5.23). */
function read(hostId: string, agentId: string, timestamp: number, extra: Partial<ActivityEdge> = {}): ActivityEdge {
  return { id: `${agentId}-${hostId}-read`, source: hostId, target: agentId, label: 'WebFetch', timestamp, isActive: false, ...extra };
}

function input(topFolders: BubbleData[], edges: ActivityEdge[], agents: string[], extra: Partial<WebFoldInput> = {}): WebFoldInput {
  return { topFolders, edges, agentIds: new Set(agents), entryCount: () => 0, ...extra };
}

const ids = (nodes: BubbleData[]): string[] => nodes.map((n) => n.id);

describe('§5.23 접어 보기 — id 조립과 해체', () => {
  it('접힌 버블 id 는 머리 + 에이전트 id 이고, 되꺼내면 같은 에이전트 id 가 나온다', () => {
    expect(webFoldId('agent-1')).toBe(`${WEB_FOLD_ID_PREFIX}agent-1`);
    expect(webFoldAgentId(webFoldId('agent-1'))).toBe('agent-1');
  });

  it('머리가 없거나 머리뿐인 id 는 접힌 버블 id 가 아니다', () => {
    expect(webFoldAgentId('domain-123')).toBeNull();
    expect(webFoldAgentId(WEB_FOLD_ID_PREFIX)).toBeNull();
  });

  it('경로는 웹 표식 + `/` + 에이전트 id 라 어떤 호스트 키와도 같아질 수 없다', () => {
    expect(webFoldNodePath('agent-1')).toBe(`${WEB_KEY_MARK}/agent-1`);
    expect(webFoldNodePath('agent-1')).toContain('/');
  });
});

describe('§5.23 접어 보기 — 접을 것이 없으면 입력 그대로', () => {
  it('도메인 버블이 없으면 두 배열 모두 같은 참조를 돌려준다', () => {
    const topFolders = [folder('f1', 'src')];
    const edges = [read('f1', 'agent-a', T0)];
    const out = foldWebBubblesPerAgent(input(topFolders, edges, ['agent-a']));
    expect(out.topFolders).toBe(topFolders);
    expect(out.edges).toBe(edges);
    expect(out.folds.size).toBe(0);
  });

  it('고정한 도메인뿐이면 접지 않는다 — pinned · preservePinned 둘 다', () => {
    const topFolders = [host('h1', 'a.com', { pinned: true }), host('h2', 'b.com', { preservePinned: true })];
    const edges = [read('h1', 'agent-a', T0), read('h2', 'agent-a', T0)];
    const out = foldWebBubblesPerAgent(input(topFolders, edges, ['agent-a']));
    expect(out.topFolders).toBe(topFolders);
    expect(out.edges).toBe(edges);
  });

  it('실리지 않는 에이전트와만 이어진 도메인은 접지 않는다', () => {
    const topFolders = [host('h1', 'a.com')];
    const edges = [read('h1', 'agent-hidden', T0)];
    const out = foldWebBubblesPerAgent(input(topFolders, edges, ['agent-a']));
    expect(out.topFolders).toBe(topFolders);
    expect(out.edges).toBe(edges);
  });

  it('화살표가 없는 도메인은 접지 않는다', () => {
    const topFolders = [host('h1', 'a.com')];
    const out = foldWebBubblesPerAgent(input(topFolders, [], ['agent-a']));
    expect(out.topFolders).toBe(topFolders);
  });
});

describe('§5.23 접어 보기 — 에이전트마다 버블 하나', () => {
  it('한 에이전트가 읽은 호스트들이 첫 구성원 자리에 버블 하나로 선다 — 옆 버블 순서는 그대로', () => {
    const topFolders = [
      folder('f1', 'src'),
      host('h1', 'a.com', { lastActivity: T0 }),
      folder('f2', 'docs'),
      host('h2', 'b.com', { lastActivity: T0 + 1000 }),
    ];
    const edges = [read('h1', 'agent-a', T0), read('h2', 'agent-a', T0 + 1000)];
    const out = foldWebBubblesPerAgent(input(topFolders, edges, ['agent-a']));

    expect(ids(out.topFolders)).toEqual(['f1', webFoldId('agent-a'), 'f2']);
    const fold = out.topFolders[1]!;
    expect(fold.bubbleType).toBe('domain');
    expect(fold.path).toBe(webFoldNodePath('agent-a'));
    expect(fold.webFold?.agentId).toBe('agent-a');
    expect(out.folds.get(webFoldId('agent-a'))).toEqual({ agentId: 'agent-a', hostIds: ['h2', 'h1'] });
  });

  it('구성원에 닿는 화살표는 빠지고 에이전트마다 읽기 화살표 하나가 선다 — 최신 라벨·시각, 하나라도 켜지면 켜짐', () => {
    const topFolders = [folder('f1', 'src'), host('h1', 'a.com'), host('h2', 'b.com')];
    const other: ActivityEdge = { id: 'agent-a-f1-edit', source: 'agent-a', target: 'f1', label: 'Edit', timestamp: T0, isActive: true };
    const edges = [
      other,
      read('h1', 'agent-a', T0 + 5000, { label: 'WebSearch', isActive: false }),
      read('h2', 'agent-a', T0, { label: 'WebFetch', isActive: true }),
    ];
    const out = foldWebBubblesPerAgent(input(topFolders, edges, ['agent-a']));
    const foldId = webFoldId('agent-a');

    expect(out.edges).toEqual([
      other,
      { id: `agent-a-${foldId}-read`, source: foldId, target: 'agent-a', label: 'WebSearch', timestamp: T0 + 5000, isActive: true },
    ]);
  });

  it('화살표 방향은 가리지 않는다 — 에이전트 → 호스트 모양도 접는다', () => {
    const topFolders = [host('h1', 'a.com')];
    const edges: ActivityEdge[] = [{ id: 'e1', source: 'agent-a', target: 'h1', label: 'WebFetch', timestamp: T0, isActive: false }];
    const out = foldWebBubblesPerAgent(input(topFolders, edges, ['agent-a']));
    expect(ids(out.topFolders)).toEqual([webFoldId('agent-a')]);
    expect(out.edges.map((e) => e.id)).toEqual([`agent-a-${webFoldId('agent-a')}-read`]);
  });

  it('고정한 호스트는 제 버블과 제 화살표로 남고, 나머지만 접힌다', () => {
    const topFolders = [host('h1', 'a.com'), host('h2', 'b.com', { preservePinned: true })];
    const pinnedEdge = read('h2', 'agent-a', T0);
    const edges = [read('h1', 'agent-a', T0), pinnedEdge];
    const out = foldWebBubblesPerAgent(input(topFolders, edges, ['agent-a']));

    expect(ids(out.topFolders)).toEqual([webFoldId('agent-a'), 'h2']);
    expect(out.edges).toContain(pinnedEdge);
    expect(out.topFolders[0]!.webFold?.hosts.map((h) => h.id)).toEqual(['h1']);
  });

  it('두 에이전트가 함께 읽은 호스트는 두 접힌 버블에 다 들어가고, 화살표는 에이전트마다 하나다', () => {
    const topFolders = [host('shared', 'docs.com', { lastActivity: T0 + 9000 }), host('onlyA', 'a.com', { lastActivity: T0 })];
    const edges = [read('shared', 'agent-a', T0), read('onlyA', 'agent-a', T0), read('shared', 'agent-b', T0)];
    const out = foldWebBubblesPerAgent(input(topFolders, edges, ['agent-a', 'agent-b']));

    expect(ids(out.topFolders)).toEqual([webFoldId('agent-a'), webFoldId('agent-b')]);
    expect(out.folds.get(webFoldId('agent-a'))?.hostIds).toEqual(['shared', 'onlyA']);
    expect(out.folds.get(webFoldId('agent-b'))?.hostIds).toEqual(['shared']);
    expect(out.edges.map((e) => e.target).sort()).toEqual(['agent-a', 'agent-b']);
  });
});

describe('§5.23 접어 보기 — 구성원에서 모으는 규칙', () => {
  it('호스트 목록은 최신이 앞이고, 같은 시각이면 라벨 순이다 — 항목 수·상태·시각·상한을 싣는다', () => {
    const topFolders = [
      host('h-old', 'old.com', { lastActivity: T0 }),
      host('h-z', 'z.com', { lastActivity: T0 + 1000, maxWebEntries: 7 }),
      host('h-b', 'b.com', { lastActivity: T0 + 1000, status: 'active' }),
    ];
    const edges = topFolders.map((h) => read(h.id, 'agent-a', T0));
    const counts: Record<string, number> = { 'h-old': 3, 'h-z': 1, 'h-b': 12 };
    const out = foldWebBubblesPerAgent(input(topFolders, edges, ['agent-a'], { entryCount: (id) => counts[id] ?? 0 }));

    expect(out.topFolders[0]!.webFold?.hosts).toEqual([
      { id: 'h-b', host: 'b.com', entryCount: 12, status: 'active', lastActivity: T0 + 1000 },
      { id: 'h-z', host: 'z.com', entryCount: 1, status: 'idle', lastActivity: T0 + 1000, maxWebEntries: 7 },
      { id: 'h-old', host: 'old.com', entryCount: 3, status: 'idle', lastActivity: T0 },
    ]);
  });

  it('하나라도 작업 중이면 active 이고, 사라지는 중 표식은 싣지 않는다', () => {
    const topFolders = [
      host('h1', 'a.com', { lastActivity: T0 + 1000, status: 'idle', fadeStartedAt: T0 }),
      host('h2', 'b.com', { lastActivity: T0, status: 'active' }),
    ];
    const edges = [read('h1', 'agent-a', T0), read('h2', 'agent-a', T0)];
    const fold = foldWebBubblesPerAgent(input(topFolders, edges, ['agent-a'])).topFolders[0]!;
    expect(fold.status).toBe('active');
    expect(fold.fadeStartedAt).toBeUndefined();
  });

  it('모두 쉬고 있으면 최신 구성원의 상태와 사라지는 중 표식을 따른다', () => {
    const topFolders = [
      host('h1', 'a.com', { lastActivity: T0 + 1000, status: 'completed', fadeStartedAt: T0 + 2000 }),
      host('h2', 'b.com', { lastActivity: T0, status: 'idle' }),
    ];
    const edges = [read('h1', 'agent-a', T0), read('h2', 'agent-a', T0)];
    const fold = foldWebBubblesPerAgent(input(topFolders, edges, ['agent-a'])).topFolders[0]!;
    expect(fold.status).toBe('completed');
    expect(fold.fadeStartedAt).toBe(T0 + 2000);
    expect(fold.label).toBe('a.com');
  });

  it('척도는 합이 아니라 최댓값 — 합하면 접힌 버블 하나가 척도를 넘어 색이 포화된다(§5.24)', () => {
    const topFolders = [
      host('h1', 'a.com', { activity: 4, readCount: 10, writeCount: 1, activeAgentIds: ['agent-a'] }),
      host('h2', 'b.com', { activity: 9, readCount: 3, activeAgentIds: ['agent-a', 'agent-x'] }),
    ];
    const edges = [read('h1', 'agent-a', T0), read('h2', 'agent-a', T0)];
    const fold = foldWebBubblesPerAgent(input(topFolders, edges, ['agent-a'])).topFolders[0]!;
    expect(fold.activity).toBe(9);
    expect(fold.readCount).toBe(10);
    expect(fold.writeCount).toBe(1);
    expect([...(fold.activeAgentIds ?? [])].sort()).toEqual(['agent-a', 'agent-x']);
  });

  it('자리는 사용자가 옮겨 둔 자리가 이기고, 없으면 최신 구성원의 자리를 물려받는다', () => {
    const topFolders = [
      host('h1', 'a.com', { lastActivity: T0 + 1000, position: { x: 100, y: 200 } }),
      host('h2', 'b.com', { lastActivity: T0, position: { x: -5, y: -5 } }),
    ];
    const edges = [read('h1', 'agent-a', T0), read('h2', 'agent-a', T0)];

    const inherited = foldWebBubblesPerAgent(input(topFolders, edges, ['agent-a'])).topFolders[0]!;
    expect(inherited.position).toEqual({ x: 100, y: 200 });

    const moved = foldWebBubblesPerAgent(input(topFolders, edges, ['agent-a'], {
      positionOf: (foldId) => (foldId === webFoldId('agent-a') ? { x: 1, y: 2 } : undefined),
    })).topFolders[0]!;
    expect(moved.position).toEqual({ x: 1, y: 2 });
  });
});

describe('§5.23 접어 보기 — 입력을 고치지 않는다', () => {
  it('접은 뒤에도 입력 배열·노드·엣지는 글자 하나 바뀌지 않는다', () => {
    const topFolders = [
      folder('f1', 'src'),
      host('h1', 'a.com', { lastActivity: T0, position: { x: 1, y: 1 }, activeAgentIds: ['agent-a'] }),
      host('h2', 'b.com', { lastActivity: T0 + 1, pinned: true }),
      host('h3', 'c.com', { lastActivity: T0 + 2 }),
    ];
    const edges = [read('h1', 'agent-a', T0), read('h2', 'agent-a', T0), read('h3', 'agent-b', T0), read('h1', 'agent-b', T0)];
    const before = JSON.stringify({ topFolders, edges });

    const out = foldWebBubblesPerAgent(input(topFolders, edges, ['agent-a', 'agent-b']));

    expect(JSON.stringify({ topFolders, edges })).toBe(before);
    expect(out.topFolders).not.toBe(topFolders);
    expect(out.edges).not.toBe(edges);
  });
});
