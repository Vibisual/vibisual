import { describe, expect, it } from 'vitest';
import { normalizeShelfImport, SHELF_MAX_ITEMS } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { mergeSnapshots } from './projectGraphManager.js';

/**
 * §5.20 — 스크립트 선반의 **영속 왕복 + 가져오기 방어** 회귀 테스트.
 *
 * 앱 버블(§5.13)·플레이 버블(§5.14)·스펙 보드(§5.15)에서 이미 데인 두 자리를 그대로 못 박는다 —
 * ① 영속 5지점 중 앞의 둘만 채우면 화면엔 보이는데 껐다 켜면 사라지고, ② `mergeSnapshots` 를
 * 빠뜨리면 프로젝트를 둘 이상 연 사람에게만 사라진다.
 *
 * 여기에 이 기능 고유의 계약이 둘 더 있다: **남이 준 파일을 믿지 않는다**(아이콘·색·개수·본문),
 * 그리고 **재시작 뒤에 도는 항목은 없다**(running 잔상을 내리지 않으면 화면이 거짓말한다).
 */

const PROJECT_CWD = '/tmp/shelf-project';

function makeGraph(): { graph: ProjectGraph; projectName: string } {
  const graph = new ProjectGraph();
  // 프로젝트가 등록돼 있어야 toProjectCheckpoint 의 이름 필터를 통과한다.
  const info = graph.registerProject(PROJECT_CWD);
  return { graph, projectName: info.name };
}

function create(graph: ProjectGraph, projectName: string) {
  return graph.createShelfBubble({
    projectName,
    x: 10,
    y: 20,
    width: 260,
    height: 220,
    title: '자주 쓰는 것',
  });
}

describe('ShelfBubble — 생성과 항목', () => {
  it('만들면 목록과 스냅샷에 함께 나타난다', () => {
    const { graph, projectName } = makeGraph();
    const shelf = create(graph, projectName);

    expect(shelf.items).toEqual([]);
    expect(graph.getShelfBubbles().map((b) => b.id)).toEqual([shelf.id]);
    expect(graph.getSnapshot().shelfBubbles?.map((b) => b.id)).toEqual([shelf.id]);
  });

  it('항목 종류에 따라 기본 글리프가 갈리고, 모르는 아이콘·색은 기본값으로 되돌아간다', () => {
    const { graph, projectName } = makeGraph();
    const shelf = create(graph, projectName);

    graph.addShelfItem(shelf.id, { label: '테스트', kind: 'command', command: 'pnpm test', icon: 'terminal', color: '#0891B2' });
    graph.addShelfItem(shelf.id, {
      label: '리뷰',
      kind: 'prompt',
      prompt: '이 변경 검토해줘',
      // 이모지·팔레트 밖 색은 저장 단계에서 걸러진다(§5.20).
      icon: '\u{1F600}' as never,
      color: '#FF00FF',
    });

    const items = graph.getShelfBubble(shelf.id)!.items;
    expect(items[0]).toMatchObject({ kind: 'command', command: 'pnpm test', icon: 'terminal' });
    expect(items[1]?.icon).toBe('sparkles');
    expect(items[1]?.color).toBe('#0891B2');
  });

  it('항목 상한을 넘기면 더 받지 않는다 (§9 키 개수 캡)', () => {
    const { graph, projectName } = makeGraph();
    const shelf = create(graph, projectName);
    for (let i = 0; i < SHELF_MAX_ITEMS; i += 1) {
      expect(graph.addShelfItem(shelf.id, { label: `c${i}`, kind: 'command', command: 'echo hi', icon: 'terminal', color: '#0891B2' })).not.toBeNull();
    }
    expect(graph.addShelfItem(shelf.id, { label: 'over', kind: 'command', command: 'echo hi', icon: 'terminal', color: '#0891B2' })).toBeNull();
    expect(graph.getShelfBubble(shelf.id)?.items).toHaveLength(SHELF_MAX_ITEMS);
  });

  it('이름을 고쳐도 마지막 실행 결과는 남고, 종류를 바꾸면 비운다', () => {
    const { graph, projectName } = makeGraph();
    const shelf = create(graph, projectName);
    graph.addShelfItem(shelf.id, { label: '테스트', kind: 'command', command: 'pnpm test', icon: 'terminal', color: '#0891B2' });
    const itemId = graph.getShelfBubble(shelf.id)!.items[0]!.id;

    graph.startShelfItemRun(shelf.id, itemId);
    graph.finishShelfItemRun(shelf.id, itemId, { status: 'success', exitCode: 0, output: 'ok' });
    expect(graph.getShelfBubble(shelf.id)?.items[0]?.lastRun?.status).toBe('success');

    graph.updateShelfItem(shelf.id, itemId, { label: '다른 이름' });
    expect(graph.getShelfBubble(shelf.id)?.items[0]?.lastRun?.status).toBe('success');

    graph.updateShelfItem(shelf.id, itemId, { kind: 'prompt' });
    expect(graph.getShelfBubble(shelf.id)?.items[0]?.lastRun).toBeUndefined();
  });

  it('순서 바꾸기는 목록에 있는 id 만 옮기고 빠진 것은 뒤에 남긴다', () => {
    const { graph, projectName } = makeGraph();
    const shelf = create(graph, projectName);
    for (const label of ['a', 'b', 'c']) {
      graph.addShelfItem(shelf.id, { label, kind: 'command', command: 'echo hi', icon: 'terminal', color: '#0891B2' });
    }
    const ids = graph.getShelfBubble(shelf.id)!.items.map((i) => i.id);

    graph.reorderShelfItems(shelf.id, [ids[2]!, ids[0]!, 'sitem-does-not-exist']);
    expect(graph.getShelfBubble(shelf.id)?.items.map((i) => i.label)).toEqual(['c', 'a', 'b']);
  });

  it('도는 항목은 그 에이전트로 되찾을 수 있고, 마감한 뒤에는 안 잡힌다', () => {
    const { graph, projectName } = makeGraph();
    const shelf = create(graph, projectName);
    graph.addShelfItem(shelf.id, { label: '리뷰', kind: 'prompt', prompt: '검토해줘', icon: 'sparkles', color: '#0891B2' });
    const itemId = graph.getShelfBubble(shelf.id)!.items[0]!.id;

    graph.startShelfItemRun(shelf.id, itemId, { agentId: 'agent-7', sessionId: 'custom-7' });
    expect(graph.findShelfItemByAgent('agent-7')?.item.id).toBe(itemId);

    graph.finishShelfItemRun(shelf.id, itemId, { status: 'success' });
    expect(graph.findShelfItemByAgent('agent-7')).toBeUndefined();
  });
});

describe('ShelfBubble — 가져오기는 파일을 믿지 않는다', () => {
  it('모르는 스키마 버전은 통째로 거절한다', () => {
    expect(normalizeShelfImport({ version: 99, items: [] }).ok).toBe(false);
    expect(normalizeShelfImport('not an object').ok).toBe(false);
  });

  it('런타임 필드는 읽지 않고 아이콘·색은 목록 안으로 강제한다', () => {
    const parsed = normalizeShelfImport({
      version: 1,
      title: '남의 선반',
      items: [
        {
          id: 'sitem-attacker',
          label: '빌드',
          kind: 'command',
          command: 'pnpm build',
          cwd: 'C:/Users/someone-else/secret', // privacy-ok (합성 픽스처 경로)
          icon: '\u26A1',
          color: '#FF00FF',
          lastRun: { status: 'success', startedAt: 1 },
          targetAgentId: 'agent-not-mine',
        },
      ],
    });

    expect(parsed.ok).toBe(true);
    expect(parsed.items).toHaveLength(1);
    const item = parsed.items[0]!;
    expect(item).toMatchObject({ label: '빌드', kind: 'command', command: 'pnpm build', icon: 'terminal', color: '#0891B2' });
    expect(item).not.toHaveProperty('id');
    expect(item).not.toHaveProperty('cwd');
    expect(item).not.toHaveProperty('lastRun');
    expect(item).not.toHaveProperty('targetAgentId');
  });

  it('실행 내용이 빈 줄과 상한 초과분은 버리고 몇 개를 버렸는지 말한다', () => {
    const items = [{ label: '빈 줄', kind: 'command', command: '   ' }];
    for (let i = 0; i < SHELF_MAX_ITEMS + 3; i += 1) items.push({ label: `c${i}`, kind: 'command', command: 'echo hi' });

    const parsed = normalizeShelfImport({ version: 1, items });
    expect(parsed.items).toHaveLength(SHELF_MAX_ITEMS);
    expect(parsed.dropped).toBe(4);
  });

  it('덧붙이기가 기본이고 통째 교체는 선택이다', () => {
    const { graph, projectName } = makeGraph();
    const shelf = create(graph, projectName);
    graph.addShelfItem(shelf.id, { label: '원래 있던 것', kind: 'command', command: 'echo hi', icon: 'terminal', color: '#0891B2' });

    const drafts = normalizeShelfImport({ version: 1, items: [{ label: '가져온 것', kind: 'command', command: 'pnpm test' }] }).items;

    const appended = graph.importShelfItems(shelf.id, drafts, false);
    expect(appended?.added).toBe(1);
    expect(graph.getShelfBubble(shelf.id)?.items.map((i) => i.label)).toEqual(['원래 있던 것', '가져온 것']);

    const replaced = graph.importShelfItems(shelf.id, drafts, true);
    expect(replaced?.added).toBe(1);
    expect(graph.getShelfBubble(shelf.id)?.items.map((i) => i.label)).toEqual(['가져온 것']);
  });
});

describe('ShelfBubble — 영속 5지점', () => {
  it('체크포인트를 왕복해도 항목과 마지막 결과가 살아남는다', () => {
    const { graph, projectName } = makeGraph();
    const shelf = create(graph, projectName);
    graph.addShelfItem(shelf.id, { label: '테스트', kind: 'command', command: 'pnpm test', icon: 'terminal', color: '#0891B2' });
    const itemId = graph.getShelfBubble(shelf.id)!.items[0]!.id;
    graph.startShelfItemRun(shelf.id, itemId);
    graph.finishShelfItemRun(shelf.id, itemId, { status: 'success', exitCode: 0, output: '933 passed' });

    const cp = graph.toProjectCheckpoint(projectName);
    expect(cp.shelfBubbles?.map((b) => b.id)).toEqual([shelf.id]);

    const fresh = new ProjectGraph();
    fresh.restoreFromCheckpoint(cp);

    const restored = fresh.getShelfBubble(shelf.id);
    expect(restored).toMatchObject({ id: shelf.id, title: '자주 쓰는 것', x: 10, y: 20 });
    expect(restored?.items[0]).toMatchObject({ id: itemId, label: '테스트', command: 'pnpm test' });
    expect(restored?.items[0]?.lastRun).toMatchObject({ status: 'success', exitCode: 0, output: '933 passed' });
  });

  it('재시작 직후에 도는 항목은 없다 — running 잔상을 내린다', () => {
    const { graph, projectName } = makeGraph();
    const shelf = create(graph, projectName);
    graph.addShelfItem(shelf.id, { label: '테스트', kind: 'command', command: 'pnpm test', icon: 'terminal', color: '#0891B2' });
    const itemId = graph.getShelfBubble(shelf.id)!.items[0]!.id;
    graph.startShelfItemRun(shelf.id, itemId);

    const fresh = new ProjectGraph();
    fresh.restoreFromCheckpoint(graph.toProjectCheckpoint(projectName));
    expect(fresh.getShelfBubble(shelf.id)?.items[0]?.lastRun?.status).toBe('failed');
  });

  it('다른 프로젝트의 선반은 그 프로젝트 체크포인트에 실리지 않는다', () => {
    const { graph, projectName } = makeGraph();
    create(graph, projectName);
    create(graph, 'other-project');

    const cp = graph.toProjectCheckpoint(projectName);
    expect(cp.shelfBubbles).toHaveLength(1);
    expect(cp.shelfBubbles?.[0]?.projectName).toBe(projectName);
  });

  it('선반이 없으면 체크포인트에 빈 배열을 남기지 않는다', () => {
    const { graph, projectName } = makeGraph();
    expect(graph.toProjectCheckpoint(projectName).shelfBubbles).toBeUndefined();
  });

  it('머지 복원은 있던 것을 덮지 않는다 (합집합)', () => {
    const { graph, projectName } = makeGraph();
    const mine = create(graph, projectName);
    graph.updateShelfBubble(mine.id, { title: '지금 쓰는 이름' });

    const stale = { ...mine, title: '디스크에 남은 옛 이름' };
    graph.mergeFromCheckpoint({ ...graph.toProjectCheckpoint(projectName), shelfBubbles: [stale, { ...mine, id: 'shelf-other' }] });

    expect(graph.getShelfBubble(mine.id)?.title).toBe('지금 쓰는 이름');
    expect(graph.getShelfBubble('shelf-other')).toBeDefined();
  });

  it('프로젝트를 둘 이상 열어도 방송 스냅샷에서 사라지지 않는다 (mergeSnapshots)', () => {
    const { graph: a, projectName: nameA } = makeGraph();
    const shelfA = create(a, nameA);

    const b = new ProjectGraph();
    const infoB = b.registerProject('/tmp/shelf-project-b');
    const shelfB = create(b, infoB.name);

    const merged = mergeSnapshots(a.getSnapshot(), b.getSnapshot());
    expect(merged.shelfBubbles?.map((s) => s.id).sort()).toEqual([shelfA.id, shelfB.id].sort());
  });

  it('고정된 선반은 삭제를 거절한다 (§2.4 preserve-pin)', () => {
    const { graph, projectName } = makeGraph();
    const shelf = create(graph, projectName);
    graph.updateShelfBubble(shelf.id, { preservePinned: true });

    expect(graph.deleteShelfBubble(shelf.id)).toBe(false);
    expect(graph.getShelfBubble(shelf.id)).toBeDefined();

    graph.updateShelfBubble(shelf.id, { preservePinned: false });
    expect(graph.deleteShelfBubble(shelf.id)).toBe(true);
  });
});
