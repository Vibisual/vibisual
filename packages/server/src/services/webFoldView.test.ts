/**
 * §5.23 접어 보기 · 웹 버블 묶기 — `groupWebBubbles`(shared 순수 함수)의 계약을 못 박는다.
 *
 * 서버 `getSnapshot` 이 실어 보내기 직전에 이 함수로 한 에이전트가 읽은 호스트 버블들을 묶는다. 바꾸는 것은
 * **실어 보내는 모양뿐**이라, 여기서 잠그는 것도 모양의 규칙이다.
 *
 * 여기서 잠그는 계약:
 *  1. 묶을 것이 없으면 입력 배열을 그대로 돌려준다(새 배열 ❌ — 캐시된 스냅샷 참조가 흔들리지 않게).
 *  2. 누구의 것인가는 화살표가 정한다 — 이번에 실리는 에이전트와 이어진, 고정하지 않은 도메인만 묶는다.
 *  3. 접힌 버블은 첫 구성원이 있던 자리에 서고, 접힌 버블마다 읽기 화살표 **하나**만 남는다.
 *  4. 두 에이전트가 함께 읽은 호스트는 **에이전트마다 따로** 판정한다 — 모두가 묶었을 때만 화면에서 빠진다.
 *  5. (A) 같은 사이트는 하나 · (B) 넘치면 비슷한 종류끼리 · (C) 에이전트마다 최대 N개(1 = 종전 접어 보기).
 *  6. 구성원이 하나뿐인 묶음은 묶지 않는다 — 그 호스트가 제 이름으로 선다.
 *  7. 상태·척도·자리는 구성원에서 정해진 규칙대로 모은다(합 ❌ · 최댓값).
 *  8. 입력 배열과 객체를 고치지 않는다 — 서버가 200ms 동안 같은 객체를 되돌려 준다.
 */
import { describe, it, expect } from 'vitest';
import {
  WEB_FOLD_ID_PREFIX,
  WEB_GROUP_DEFAULTS,
  WEB_GROUP_MAX_BOUNDS,
  WEB_GROUP_OFF,
  WEB_KEY_MARK,
  groupWebBubbles,
  isWebGroupActive,
  normalizeWebGroupSettings,
  webFoldAgentId,
  webFoldId,
  webFoldNodePath,
  webNodeKey,
  type ActivityEdge,
  type BubbleData,
  type WebFoldInput,
  type WebGroupSettings,
} from '@vibisual/shared';

const T0 = Date.parse('2026-09-14T00:00:00Z');

/** 종전 접어 보기 — 에이전트마다 하나(같은 사이트·종류 없이). */
const ONE: WebGroupSettings = { sameSite: false, byKind: false, maxPerAgent: 1 };

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

/** 한 에이전트가 차례로 읽은 호스트들 — 뒤의 것일수록 최근이다. */
function readAll(agent: string, labels: string[]): { topFolders: BubbleData[]; edges: ActivityEdge[] } {
  const topFolders = labels.map((label, i) => host(`h-${label}`, label, { lastActivity: T0 + i * 1000 }));
  const edges = topFolders.map((h, i) => read(h.id, agent, T0 + i * 1000));
  return { topFolders, edges };
}

const ids = (nodes: BubbleData[]): string[] => nodes.map((n) => n.id);

describe('§5.23 묶기 — id 조립과 해체', () => {
  it('나머지 묶음 id 는 종전 접힌 id 그대로 — 머리 + 에이전트 id', () => {
    expect(webFoldId('agent-1')).toBe(`${WEB_FOLD_ID_PREFIX}agent-1`);
    expect(webFoldAgentId(webFoldId('agent-1'))).toBe('agent-1');
  });

  it('사이트·종류 묶음 id 도 에이전트 id 로 되꺼내진다', () => {
    const site = webFoldId('agent-1', { site: 'github.com' });
    const kind = webFoldId('agent-1', { kind: 'docs' });
    expect(site).toBe(`${WEB_FOLD_ID_PREFIX}agent-1~site~github.com`);
    expect(kind).toBe(`${WEB_FOLD_ID_PREFIX}agent-1~kind~docs`);
    expect(webFoldAgentId(site)).toBe('agent-1');
    expect(webFoldAgentId(kind)).toBe('agent-1');
  });

  it('id 에 `/` 가 없다 — 단일 지우기 경로(`/api/bubble/:id`)가 id 를 인코딩하지 않아도 한 칸에 실린다', () => {
    expect(webFoldId('agent-1', { site: 'github.com' })).not.toContain('/');
    expect(webFoldId('agent-1', { kind: 'qa' })).not.toContain('/');
  });

  it('머리가 없거나 에이전트 칸이 빈 id 는 접힌 버블 id 가 아니다', () => {
    expect(webFoldAgentId('domain-123')).toBeNull();
    expect(webFoldAgentId(WEB_FOLD_ID_PREFIX)).toBeNull();
    expect(webFoldAgentId(`${WEB_FOLD_ID_PREFIX}~kind~docs`)).toBeNull();
  });

  it('경로는 웹 표식 + `/` + 머리를 뗀 id 라 어떤 호스트 키와도 같아질 수 없다', () => {
    expect(webFoldNodePath('agent-1')).toBe(`${WEB_KEY_MARK}/agent-1`);
    expect(webFoldNodePath(webFoldId('agent-1'))).toBe(`${WEB_KEY_MARK}/agent-1`);
    const kindPath = webFoldNodePath(webFoldId('agent-1', { kind: 'docs' }));
    expect(kindPath.startsWith(`${WEB_KEY_MARK}/`)).toBe(true);
    expect(kindPath).toContain('/');
  });
});

describe('§5.23 묶기 — 설정 정규화', () => {
  it('없거나 모양이 틀린 칸은 기본값(켬)으로', () => {
    expect(normalizeWebGroupSettings(undefined)).toEqual(WEB_GROUP_DEFAULTS);
    expect(normalizeWebGroupSettings({ sameSite: 'yes', byKind: 1, maxPerAgent: null })).toEqual(WEB_GROUP_DEFAULTS);
    expect(normalizeWebGroupSettings({ sameSite: false })).toEqual({ ...WEB_GROUP_DEFAULTS, sameSite: false });
  });

  it('최대 개수는 범위 안 정수로 접힌다 — 숫자 글자도 읽는다', () => {
    expect(normalizeWebGroupSettings({ maxPerAgent: -3 }).maxPerAgent).toBe(WEB_GROUP_MAX_BOUNDS.MIN);
    expect(normalizeWebGroupSettings({ maxPerAgent: 999 }).maxPerAgent).toBe(WEB_GROUP_MAX_BOUNDS.MAX);
    expect(normalizeWebGroupSettings({ maxPerAgent: 2.7 }).maxPerAgent).toBe(2);
    expect(normalizeWebGroupSettings({ maxPerAgent: '5' }).maxPerAgent).toBe(5);
  });

  it('셋 다 꺼지면 묶지 않는다 — 기본값은 묶는다', () => {
    expect(isWebGroupActive(WEB_GROUP_OFF)).toBe(false);
    expect(isWebGroupActive(WEB_GROUP_DEFAULTS)).toBe(true);
    expect(isWebGroupActive({ sameSite: false, byKind: false, maxPerAgent: 3 })).toBe(true);
    expect(isWebGroupActive({ sameSite: false, byKind: true, maxPerAgent: 0 })).toBe(true);
  });
});

describe('§5.23 묶기 — 묶을 것이 없으면 입력 그대로', () => {
  it('도메인 버블이 없으면 두 배열 모두 같은 참조를 돌려준다', () => {
    const topFolders = [folder('f1', 'src')];
    const edges = [read('f1', 'agent-a', T0)];
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a']), ONE);
    expect(out.topFolders).toBe(topFolders);
    expect(out.edges).toBe(edges);
    expect(out.folds.size).toBe(0);
  });

  it('묶기를 끄면(0 · 끔 · 끔) 호스트가 아무리 많아도 그대로다', () => {
    const { topFolders, edges } = readAll('agent-a', ['a.com', 'b.com', 'c.com', 'docs.c.com']);
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a']), WEB_GROUP_OFF);
    expect(out.topFolders).toBe(topFolders);
    expect(out.edges).toBe(edges);
  });

  it('고정한 도메인뿐이면 묶지 않는다 — pinned · preservePinned 둘 다', () => {
    const topFolders = [host('h1', 'a.com', { pinned: true }), host('h2', 'b.com', { preservePinned: true })];
    const edges = [read('h1', 'agent-a', T0), read('h2', 'agent-a', T0)];
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a']), ONE);
    expect(out.topFolders).toBe(topFolders);
    expect(out.edges).toBe(edges);
  });

  it('실리지 않는 에이전트와만 이어진 도메인은 묶지 않는다', () => {
    const { topFolders, edges } = readAll('agent-hidden', ['a.com', 'b.com']);
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a']), ONE);
    expect(out.topFolders).toBe(topFolders);
    expect(out.edges).toBe(edges);
  });

  it('화살표가 없는 도메인은 묶지 않는다', () => {
    const topFolders = [host('h1', 'a.com'), host('h2', 'b.com')];
    const out = groupWebBubbles(input(topFolders, [], ['agent-a']), ONE);
    expect(out.topFolders).toBe(topFolders);
  });

  it('한 곳뿐이면 최대 1개여도 묶지 않는다 — 그 호스트가 제 이름으로 선다', () => {
    const { topFolders, edges } = readAll('agent-a', ['a.com']);
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a']), ONE);
    expect(out.topFolders).toBe(topFolders);
    expect(out.edges).toBe(edges);
  });

  it('기본값에서 서로 다른 사이트가 N 이하면 묶지 않는다 — 가볍게 찾는 에이전트의 화면은 종전과 같다', () => {
    const { topFolders, edges } = readAll('agent-a', ['a.com', 'b.org', 'react.dev']);
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a']), WEB_GROUP_DEFAULTS);
    expect(out.topFolders).toBe(topFolders);
    expect(out.edges).toBe(edges);
  });
});

describe('§5.23 묶기 — 최대 1개 = 에이전트마다 버블 하나(종전 접어 보기)', () => {
  it('한 에이전트가 읽은 호스트들이 첫 구성원 자리에 버블 하나로 선다 — 옆 버블 순서는 그대로', () => {
    const topFolders = [
      folder('f1', 'src'),
      host('h1', 'a.com', { lastActivity: T0 }),
      folder('f2', 'docs'),
      host('h2', 'b.com', { lastActivity: T0 + 1000 }),
    ];
    const edges = [read('h1', 'agent-a', T0), read('h2', 'agent-a', T0 + 1000)];
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a']), ONE);

    expect(ids(out.topFolders)).toEqual(['f1', webFoldId('agent-a'), 'f2']);
    const fold = out.topFolders[1]!;
    expect(fold.bubbleType).toBe('domain');
    expect(fold.path).toBe(webFoldNodePath('agent-a'));
    expect(fold.webFold?.agentId).toBe('agent-a');
    expect(fold.webFold?.scope).toBe('agent');
    expect(out.folds.get(webFoldId('agent-a'))).toEqual({ agentId: 'agent-a', hostIds: ['h2', 'h1'], scope: 'agent' });
  });

  it('구성원에 닿는 화살표는 빠지고 접힌 버블마다 읽기 화살표 하나가 선다 — 최신 라벨·시각, 하나라도 켜지면 켜짐', () => {
    const topFolders = [folder('f1', 'src'), host('h1', 'a.com'), host('h2', 'b.com')];
    const other: ActivityEdge = { id: 'agent-a-f1-edit', source: 'agent-a', target: 'f1', label: 'Edit', timestamp: T0, isActive: true };
    const edges = [
      other,
      read('h1', 'agent-a', T0 + 5000, { label: 'WebSearch', isActive: false }),
      read('h2', 'agent-a', T0, { label: 'WebFetch', isActive: true }),
    ];
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a']), ONE);
    const foldId = webFoldId('agent-a');

    expect(out.edges).toEqual([
      other,
      { id: `agent-a-${foldId}-read`, source: foldId, target: 'agent-a', label: 'WebSearch', timestamp: T0 + 5000, isActive: true },
    ]);
  });

  it('화살표 방향은 가리지 않는다 — 에이전트 → 호스트 모양도 묶는다', () => {
    const topFolders = [host('h1', 'a.com'), host('h2', 'b.com')];
    const edges: ActivityEdge[] = [
      { id: 'e1', source: 'agent-a', target: 'h1', label: 'WebFetch', timestamp: T0, isActive: false },
      { id: 'e2', source: 'agent-a', target: 'h2', label: 'WebFetch', timestamp: T0, isActive: false },
    ];
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a']), ONE);
    expect(ids(out.topFolders)).toEqual([webFoldId('agent-a')]);
    expect(out.edges.map((e) => e.id)).toEqual([`agent-a-${webFoldId('agent-a')}-read`]);
  });

  it('고정한 호스트는 제 버블과 제 화살표로 남고 개수에도 세지 않는다 — 나머지만 묶인다', () => {
    const topFolders = [host('h1', 'a.com'), host('h2', 'b.com', { preservePinned: true }), host('h3', 'c.com')];
    const pinnedEdge = read('h2', 'agent-a', T0);
    const edges = [read('h1', 'agent-a', T0), pinnedEdge, read('h3', 'agent-a', T0)];
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a']), ONE);

    expect(ids(out.topFolders)).toEqual([webFoldId('agent-a'), 'h2']);
    expect(out.edges).toContain(pinnedEdge);
    expect(out.topFolders[0]!.webFold?.hosts.map((h) => h.id).sort()).toEqual(['h1', 'h3']);
  });

  it('두 에이전트가 함께 읽은 호스트는 에이전트마다 따로 판정한다 — 한쪽이 따로 세우면 호스트는 남는다', () => {
    const topFolders = [host('shared', 'docs.com', { lastActivity: T0 + 9000 }), host('onlyA', 'a.com', { lastActivity: T0 })];
    const edges = [read('shared', 'agent-a', T0), read('onlyA', 'agent-a', T0), read('shared', 'agent-b', T0)];
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a', 'agent-b']), ONE);

    // a 는 둘을 묶고, b 는 한 곳뿐이라 묶지 않는다 — 공유 호스트는 b 에게 제 버블로 남는다.
    expect(ids(out.topFolders)).toEqual(['shared', webFoldId('agent-a')]);
    expect(out.folds.get(webFoldId('agent-a'))?.hostIds).toEqual(['shared', 'onlyA']);
    expect(out.folds.has(webFoldId('agent-b'))).toBe(false);
    expect(out.edges.map((e) => e.id).sort()).toEqual([`agent-a-${webFoldId('agent-a')}-read`, 'agent-b-shared-read'].sort());
  });

  it('두 에이전트가 모두 묶으면 공유 호스트는 두 접힌 버블에 다 들고 화면에서 빠진다', () => {
    const topFolders = [host('shared', 'docs.com', { lastActivity: T0 + 9000 }), host('onlyA', 'a.com'), host('onlyB', 'b.com')];
    const edges = [
      read('shared', 'agent-a', T0), read('onlyA', 'agent-a', T0),
      read('shared', 'agent-b', T0), read('onlyB', 'agent-b', T0),
    ];
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a', 'agent-b']), ONE);

    expect(ids(out.topFolders)).toEqual([webFoldId('agent-a'), webFoldId('agent-b')]);
    expect(out.folds.get(webFoldId('agent-a'))?.hostIds).toEqual(['shared', 'onlyA']);
    expect(out.folds.get(webFoldId('agent-b'))?.hostIds).toEqual(['shared', 'onlyB']);
    expect(out.edges.map((e) => e.target).sort()).toEqual(['agent-a', 'agent-b']);
  });
});

describe('§5.23 묶기 (A) — 같은 사이트는 버블 하나', () => {
  it('하위 도메인이 같은 사이트로 묶이고 제목은 사이트다 — 다른 사이트는 제 버블로 남는다', () => {
    const { topFolders, edges } = readAll('agent-a', ['docs.github.com', 'example.org', 'github.com', 'gist.github.com']);
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a']), WEB_GROUP_DEFAULTS);
    const siteId = webFoldId('agent-a', { site: 'github.com' });

    expect(ids(out.topFolders)).toEqual([siteId, 'h-example.org']);
    const fold = out.topFolders[0]!;
    expect(fold.label).toBe('github.com');
    expect(fold.webFold).toMatchObject({ scope: 'site', site: 'github.com' });
    expect(fold.webFold?.hosts.map((h) => h.host)).toEqual(['gist.github.com', 'github.com', 'docs.github.com']);
  });

  it('주인이 다른 호스팅(`*.github.io`)은 같은 사이트가 아니다', () => {
    const { topFolders, edges } = readAll('agent-a', ['alice.github.io', 'bob.github.io']);
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a']), WEB_GROUP_DEFAULTS);
    expect(out.topFolders).toBe(topFolders);
  });

  it('(A) 를 끄면 하위 도메인도 제 버블이다', () => {
    const { topFolders, edges } = readAll('agent-a', ['docs.github.com', 'github.com']);
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a']), { ...WEB_GROUP_DEFAULTS, sameSite: false });
    expect(out.topFolders).toBe(topFolders);
  });

  it('사용자가 라벨을 바꿔도 노드 키의 호스트로 묶는다', () => {
    const topFolders = [
      host('h1', 'GitHub 문서', { path: webNodeKey('docs.github.com'), lastActivity: T0 }),
      host('h2', 'github.com', { path: webNodeKey('github.com'), lastActivity: T0 + 1000 }),
    ];
    const edges = [read('h1', 'agent-a', T0), read('h2', 'agent-a', T0)];
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a']), WEB_GROUP_DEFAULTS);
    expect(ids(out.topFolders)).toEqual([webFoldId('agent-a', { site: 'github.com' })]);
  });
});

describe('§5.23 묶기 (C) — 에이전트마다 최대 N개', () => {
  it('(B) 를 끄면 최근 N−1 곳이 따로 서고 나머지가 "그 밖의 웹" 하나다', () => {
    const { topFolders, edges } = readAll('agent-a', ['a.com', 'b.com', 'c.com', 'd.com', 'e.com']);
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a']), { sameSite: true, byKind: false, maxPerAgent: 3 });

    // 따로 서는 것은 가장 최근 둘(e, d) — 나머지 셋이 묶인다.
    expect(ids(out.topFolders)).toEqual([webFoldId('agent-a'), 'h-d.com', 'h-e.com']);
    expect(out.topFolders[0]!.webFold).toMatchObject({ scope: 'rest' });
    expect(out.folds.get(webFoldId('agent-a'))?.hostIds).toEqual(['h-c.com', 'h-b.com', 'h-a.com']);
  });

  it('고정한 호스트는 N 에 세지 않는다', () => {
    const topFolders = [
      host('h1', 'a.com', { lastActivity: T0 }),
      host('h2', 'b.com', { lastActivity: T0 + 1000 }),
      host('pin', 'pinned.com', { lastActivity: T0 + 2000, preservePinned: true }),
    ];
    const edges = topFolders.map((h) => read(h.id, 'agent-a', T0));
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a']), { sameSite: true, byKind: false, maxPerAgent: 2 });
    // 고정한 곳을 빼면 둘 — N=2 안이라 아무것도 묶이지 않는다.
    expect(out.topFolders).toBe(topFolders);
  });
});

describe('§5.23 묶기 (B) — 넘치면 비슷한 종류끼리', () => {
  it('종류 묶음과 "그 밖의 웹" 이 N 을 넘지 않는다 — 작은 종류는 "그 밖" 으로 간다', () => {
    const { topFolders, edges } = readAll('agent-a', [
      'react.dev', 'electronjs.org', 'nodejs.org', // 문서 셋
      'github.com', 'gitlab.com', // 코드 둘
      'stackoverflow.com', // 질문 하나
      'example.org', // 모름
    ]);
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a']), { sameSite: true, byKind: true, maxPerAgent: 3 });
    const docs = webFoldId('agent-a', { kind: 'docs' });
    const code = webFoldId('agent-a', { kind: 'code' });
    const rest = webFoldId('agent-a');

    expect(ids(out.topFolders).sort()).toEqual([code, docs, rest].sort());
    expect(out.folds.get(docs)).toMatchObject({ scope: 'kind', hostIds: ['h-nodejs.org', 'h-electronjs.org', 'h-react.dev'] });
    expect(out.folds.get(code)).toMatchObject({ scope: 'kind', hostIds: ['h-gitlab.com', 'h-github.com'] });
    expect(out.folds.get(rest)).toMatchObject({ scope: 'rest', hostIds: ['h-example.org', 'h-stackoverflow.com'] });
    expect(out.topFolders.find((n) => n.id === docs)?.webFold).toMatchObject({ scope: 'kind', kind: 'docs' });
    // 에이전트에게 가는 화살표는 묶음마다 하나 — 셋.
    expect(out.edges.filter((e) => e.target === 'agent-a')).toHaveLength(3);
  });

  it('자리가 남으면 가장 최근 단위부터 따로 서고, 구성원이 하나 남은 묶음은 그 단위로 선다', () => {
    // 문서 셋 · 코드 둘 · 질문 하나 = 단위 여섯, N=5 — 종류 묶음 셋(질문은 하나뿐) + 자리 둘.
    const { topFolders, edges } = readAll('agent-a', [
      'react.dev', 'github.com', 'electronjs.org', 'stackoverflow.com', 'gitlab.com', 'nodejs.org',
    ]);
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a']), { sameSite: true, byKind: true, maxPerAgent: 5 });
    const docs = webFoldId('agent-a', { kind: 'docs' });

    // 최근 순: nodejs(문서) → gitlab(코드) 가 꺼내진다. 코드는 github 하나가 남아 그 호스트로 서고,
    // 질문은 원래 하나라 stackoverflow 로 선다. 문서는 react·electron 둘이 남아 묶음이다.
    expect(new Set(ids(out.topFolders))).toEqual(new Set([
      docs, 'h-github.com', 'h-stackoverflow.com', 'h-gitlab.com', 'h-nodejs.org',
    ]));
    expect(out.folds.get(docs)?.hostIds).toEqual(['h-electronjs.org', 'h-react.dev']);
    expect(out.folds.size).toBe(1);
  });

  it('많이 읽은 종류가 자리를 지킨다 — 단위 수가 아니라 읽은 양으로 센다', () => {
    // 문서 셋(각 1건) · 코드 사이트 하나(호스트 셋, 각 1건) · 검색 한 곳(10건) · 질문 하나(1건), N=3.
    const { topFolders, edges } = readAll('agent-a', [
      'react.dev', 'electronjs.org', 'nodejs.org', 'github.com', 'docs.github.com', 'gist.github.com', 'web-search', 'stackoverflow.com',
    ]);
    const reads: Record<string, number> = { 'h-web-search': 10 };
    const out = groupWebBubbles(
      input(topFolders, edges, ['agent-a'], { entryCount: (id) => reads[id] ?? 1 }),
      { sameSite: true, byKind: true, maxPerAgent: 3 },
    );

    // 검색(10건)과 코드(3건 · 호스트 셋, 문서보다 최근)가 남고, 문서·질문은 "그 밖의 웹"으로 간다.
    // 둘 다 구성원이 한 단위라 묶음이 아니라 제 모양(검색 호스트 · 사이트 묶음)으로 선다.
    expect(new Set(ids(out.topFolders))).toEqual(new Set([
      'h-web-search', webFoldId('agent-a', { site: 'github.com' }), webFoldId('agent-a'),
    ]));
    expect(out.folds.get(webFoldId('agent-a'))).toMatchObject({ scope: 'rest' });
    expect(out.folds.get(webFoldId('agent-a'))?.hostIds).toEqual(['h-stackoverflow.com', 'h-nodejs.org', 'h-electronjs.org', 'h-react.dev']);
  });

  it('최대 1개면 종류가 여럿이어도 에이전트의 전부가 "웹" 하나다', () => {
    const { topFolders, edges } = readAll('agent-a', ['react.dev', 'github.com', 'stackoverflow.com']);
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a']), { sameSite: true, byKind: true, maxPerAgent: 1 });
    expect(ids(out.topFolders)).toEqual([webFoldId('agent-a')]);
    expect(out.topFolders[0]!.webFold?.scope).toBe('agent');
  });

  it('최대 1개에 종류가 하나뿐이면 그 종류 묶음이다', () => {
    const { topFolders, edges } = readAll('agent-a', ['react.dev', 'electronjs.org', 'nodejs.org']);
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a']), { sameSite: true, byKind: true, maxPerAgent: 1 });
    expect(ids(out.topFolders)).toEqual([webFoldId('agent-a', { kind: 'docs' })]);
  });

  it('표에 없는 사이트는 읽은 주소의 경로로 가른다', () => {
    const { topFolders, edges } = readAll('agent-a', ['alpha.example', 'beta.example', 'gamma.example']);
    const urls: Record<string, string[]> = {
      'h-alpha.example': ['https://alpha.example/docs/start'],
      'h-beta.example': ['https://beta.example/guide/intro', 'https://beta.example/'],
      'h-gamma.example': ['https://gamma.example/about'],
    };
    const out = groupWebBubbles(
      input(topFolders, edges, ['agent-a'], { urlsOf: (id) => urls[id] ?? [] }),
      { sameSite: true, byKind: true, maxPerAgent: 2 },
    );
    // 문서 둘(alpha·beta) 이 한 묶음, 모르는 gamma 는 남은 자리에 제 이름으로 선다.
    expect(new Set(ids(out.topFolders))).toEqual(new Set([webFoldId('agent-a', { kind: 'docs' }), 'h-gamma.example']));
  });

  it('상한 없음(0)에 (B) 만 켜 두면 개수와 무관하게 구성원 둘 이상인 종류를 묶는다', () => {
    const { topFolders, edges } = readAll('agent-a', ['react.dev', 'electronjs.org', 'github.com']);
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a']), { sameSite: false, byKind: true, maxPerAgent: 0 });
    expect(new Set(ids(out.topFolders))).toEqual(new Set([webFoldId('agent-a', { kind: 'docs' }), 'h-github.com']));
  });
});

describe('§5.23 묶기 — 구성원에서 모으는 규칙', () => {
  it('호스트 목록은 최신이 앞이고, 같은 시각이면 라벨 순이다 — 항목 수·상태·시각·상한을 싣는다', () => {
    const topFolders = [
      host('h-old', 'old.com', { lastActivity: T0 }),
      host('h-z', 'z.com', { lastActivity: T0 + 1000, maxWebEntries: 7 }),
      host('h-b', 'b.com', { lastActivity: T0 + 1000, status: 'active' }),
    ];
    const edges = topFolders.map((h) => read(h.id, 'agent-a', T0));
    const counts: Record<string, number> = { 'h-old': 3, 'h-z': 1, 'h-b': 12 };
    const out = groupWebBubbles(input(topFolders, edges, ['agent-a'], { entryCount: (id) => counts[id] ?? 0 }), ONE);

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
    const fold = groupWebBubbles(input(topFolders, edges, ['agent-a']), ONE).topFolders[0]!;
    expect(fold.status).toBe('active');
    expect(fold.fadeStartedAt).toBeUndefined();
  });

  it('모두 쉬고 있으면 최신 구성원의 상태와 사라지는 중 표식을 따른다', () => {
    const topFolders = [
      host('h1', 'a.com', { lastActivity: T0 + 1000, status: 'completed', fadeStartedAt: T0 + 2000 }),
      host('h2', 'b.com', { lastActivity: T0, status: 'idle' }),
    ];
    const edges = [read('h1', 'agent-a', T0), read('h2', 'agent-a', T0)];
    const fold = groupWebBubbles(input(topFolders, edges, ['agent-a']), ONE).topFolders[0]!;
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
    const fold = groupWebBubbles(input(topFolders, edges, ['agent-a']), ONE).topFolders[0]!;
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

    const inherited = groupWebBubbles(input(topFolders, edges, ['agent-a']), ONE).topFolders[0]!;
    expect(inherited.position).toEqual({ x: 100, y: 200 });

    const moved = groupWebBubbles(input(topFolders, edges, ['agent-a'], {
      positionOf: (foldId) => (foldId === webFoldId('agent-a') ? { x: 1, y: 2 } : undefined),
    }), ONE).topFolders[0]!;
    expect(moved.position).toEqual({ x: 1, y: 2 });
  });
});

describe('§5.23 묶기 — 입력을 고치지 않는다', () => {
  it('묶은 뒤에도 입력 배열·노드·엣지는 글자 하나 바뀌지 않는다', () => {
    const topFolders = [
      folder('f1', 'src'),
      host('h1', 'a.com', { lastActivity: T0, position: { x: 1, y: 1 }, activeAgentIds: ['agent-a'] }),
      host('h2', 'b.com', { lastActivity: T0 + 1, pinned: true }),
      host('h3', 'c.com', { lastActivity: T0 + 2 }),
      host('h4', 'docs.c.com', { lastActivity: T0 + 3 }),
    ];
    const edges = [
      read('h1', 'agent-a', T0), read('h2', 'agent-a', T0), read('h3', 'agent-b', T0),
      read('h1', 'agent-b', T0), read('h4', 'agent-b', T0),
    ];
    const before = JSON.stringify({ topFolders, edges });

    const out = groupWebBubbles(input(topFolders, edges, ['agent-a', 'agent-b']), { ...WEB_GROUP_DEFAULTS, maxPerAgent: 1 });

    expect(JSON.stringify({ topFolders, edges })).toBe(before);
    expect(out.topFolders).not.toBe(topFolders);
    expect(out.edges).not.toBe(edges);
  });
});
