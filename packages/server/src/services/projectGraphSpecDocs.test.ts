import { describe, expect, it } from 'vitest';
import { ProjectGraph } from './projectGraph.js';
import { mergeSnapshots } from './projectGraphManager.js';

/**
 * §5.15 — 스펙 보드의 **영속 왕복 + 개정 번호** 회귀 테스트.
 *
 * 앱 버블(§5.13)·플레이 버블(§5.14)에서 이미 데인 두 자리를 그대로 못 박는다 — ① 영속 5지점 중
 * 앞의 둘만 채우면 화면엔 보이는데 껐다 켜면 사라지고, ② `mergeSnapshots` 를 빠뜨리면
 * 프로젝트를 둘 이상 연 사람에게만 사라진다.
 *
 * 여기에 이 기능 고유의 계약이 하나 더 있다: **개정 번호는 스펙 내용이 달라질 때만 오른다.**
 * 버블을 옮겼다는 이유로 하위 작업 카드가 전부 "스펙 변경됨"이 되면 그 배지는 아무 뜻도 없어진다.
 */

const PROJECT_CWD = '/tmp/spec-project';

function makeGraph(): { graph: ProjectGraph; projectName: string } {
  const graph = new ProjectGraph();
  // 프로젝트가 등록돼 있어야 toProjectCheckpoint 의 이름 필터를 통과한다.
  const info = graph.registerProject(PROJECT_CWD);
  return { graph, projectName: info.name };
}

function create(graph: ProjectGraph, projectName: string, items: string[] = ['첫 기준', '둘째 기준']) {
  return graph.createSpecDoc({
    projectName,
    x: 10,
    y: 20,
    width: 220,
    height: 140,
    title: '로그인 화면',
    body: '# 로그인\n이메일과 비밀번호로 들어간다.',
    items,
  });
}

describe('SpecDoc — 생성과 조회', () => {
  it('만들면 목록과 스냅샷에 함께 나타난다', () => {
    const { graph, projectName } = makeGraph();
    const doc = create(graph, projectName);

    expect(doc.bodyRevision).toBe(0);
    expect(doc.items).toHaveLength(2);
    expect(doc.items[0]?.id).toMatch(/^sitem-/);
    expect(graph.getSpecDocs().map((d) => d.id)).toEqual([doc.id]);
    expect(graph.getSnapshot().specDocs?.map((d) => d.id)).toEqual([doc.id]);
  });

  it('수용 기준 없이도 만들어진다 (본문부터 쓰는 흐름)', () => {
    const { graph, projectName } = makeGraph();
    const doc = create(graph, projectName, []);
    expect(doc.items).toEqual([]);
  });
});

describe('SpecDoc — 개정 번호는 내용이 달라질 때만 오른다', () => {
  it('좌표·크기·제목·done 토글로는 오르지 않는다', () => {
    const { graph, projectName } = makeGraph();
    const doc = create(graph, projectName);

    graph.updateSpecDoc(doc.id, { x: 999, y: 999, width: 300, height: 200, title: '다른 제목' });
    expect(graph.getSpecDoc(doc.id)?.bodyRevision).toBe(0);

    const items = graph.getSpecDoc(doc.id)!.items.map((it) => ({ ...it, done: true }));
    graph.updateSpecDoc(doc.id, { items });
    expect(graph.getSpecDoc(doc.id)?.bodyRevision).toBe(0);
    expect(graph.getSpecDoc(doc.id)?.items.every((it) => it.done === true)).toBe(true);
  });

  it('본문이 달라지면 오르고, 같은 값을 다시 써도 오르지 않는다', () => {
    const { graph, projectName } = makeGraph();
    const doc = create(graph, projectName);

    graph.updateSpecDoc(doc.id, { body: '# 로그인\n소셜 로그인도 지원한다.' });
    expect(graph.getSpecDoc(doc.id)?.bodyRevision).toBe(1);

    graph.updateSpecDoc(doc.id, { body: '# 로그인\n소셜 로그인도 지원한다.' });
    expect(graph.getSpecDoc(doc.id)?.bodyRevision).toBe(1);
  });

  it('항목 텍스트 수정·추가·삭제는 모두 내용 변경이다', () => {
    const { graph, projectName } = makeGraph();
    const doc = create(graph, projectName);

    const edited = graph.getSpecDoc(doc.id)!.items.map((it, i) => (i === 0 ? { ...it, text: '고친 기준' } : it));
    graph.updateSpecDoc(doc.id, { items: edited });
    expect(graph.getSpecDoc(doc.id)?.bodyRevision).toBe(1);

    graph.addSpecItem(doc.id, '셋째 기준');
    expect(graph.getSpecDoc(doc.id)?.bodyRevision).toBe(2);
    expect(graph.getSpecDoc(doc.id)?.items).toHaveLength(3);

    graph.updateSpecDoc(doc.id, { items: graph.getSpecDoc(doc.id)!.items.slice(0, 1) });
    expect(graph.getSpecDoc(doc.id)?.bodyRevision).toBe(3);
  });

  it('id 를 모르는 항목이 들어오면 서버가 새 id 를 발급한다', () => {
    const { graph, projectName } = makeGraph();
    const doc = create(graph, projectName, []);

    graph.updateSpecDoc(doc.id, { items: [{ id: 'client-made-up', text: '클라가 지은 id' }] });
    const item = graph.getSpecDoc(doc.id)?.items[0];
    expect(item?.id).toMatch(/^sitem-/);
    expect(item?.id).not.toBe('client-made-up');
  });
});

describe('SpecDoc — 작업 카드 연결과 "스펙 변경됨"', () => {
  it('카드를 매달면 그 시점의 개정 번호가 박힌다', () => {
    const { graph, projectName } = makeGraph();
    const doc = create(graph, projectName);
    graph.updateSpecDoc(doc.id, { body: '바뀐 본문' }); // rev 1

    const itemId = graph.getSpecDoc(doc.id)!.items[0]!.id;
    const item = graph.attachSpecTask(doc.id, itemId, 'agent-1', 'custom-1');

    expect(item?.taskAgentId).toBe('agent-1');
    expect(item?.generatedRevision).toBe(1);
  });

  it('그 뒤 본문이 바뀌면 카드가 낡은 것으로 판정된다', () => {
    const { graph, projectName } = makeGraph();
    const doc = create(graph, projectName);
    const itemId = doc.items[0]!.id;
    graph.attachSpecTask(doc.id, itemId, 'agent-1', 'custom-1');

    graph.updateSpecDoc(doc.id, { body: '요구사항이 바뀌었다' });

    const after = graph.getSpecDoc(doc.id)!;
    const stale = after.items.find((it) => it.id === itemId)!;
    expect(stale.generatedRevision).toBe(0);
    expect(after.bodyRevision).toBe(1);
    // 표시만 바뀔 뿐 카드 연결은 살아 있다 — 자동 삭제·자동 재생성 ❌.
    expect(stale.taskAgentId).toBe('agent-1');
  });

  it('연결을 끊으면 카드 정보만 사라진다', () => {
    const { graph, projectName } = makeGraph();
    const doc = create(graph, projectName);
    const itemId = doc.items[0]!.id;
    graph.attachSpecTask(doc.id, itemId, 'agent-1', 'custom-1');

    expect(graph.detachSpecTask(doc.id, itemId)).toBe(true);
    const item = graph.getSpecDoc(doc.id)!.items.find((it) => it.id === itemId)!;
    expect(item.taskAgentId).toBeUndefined();
    expect(item.generatedRevision).toBeUndefined();
    expect(item.text).toBe('첫 기준');
  });
});

describe('SpecDoc — 삭제', () => {
  it('preserve-pin 이 걸려 있으면 지워지지 않는다', () => {
    const { graph, projectName } = makeGraph();
    const doc = create(graph, projectName);
    graph.updateSpecDoc(doc.id, { preservePinned: true });

    expect(graph.deleteSpecDoc(doc.id)).toBe(false);
    expect(graph.getSpecDocs()).toHaveLength(1);
  });
});

describe('SpecDoc — 영속 왕복 (껐다 켜도 남는가)', () => {
  it('프로젝트 체크포인트에 실리고 본문·항목·카드 연결이 그대로 복원된다', () => {
    const { graph, projectName } = makeGraph();
    const doc = create(graph, projectName);
    const itemId = doc.items[0]!.id;
    graph.attachSpecTask(doc.id, itemId, 'agent-1', 'custom-1');
    graph.updateSpecDoc(doc.id, { body: '고친 본문' });

    const cp = graph.toProjectCheckpoint(projectName);
    expect(cp.specDocs?.map((d) => d.id)).toEqual([doc.id]);

    const fresh = new ProjectGraph();
    fresh.restoreFromCheckpoint(cp);

    const restored = fresh.getSpecDoc(doc.id);
    expect(restored).toMatchObject({ id: doc.id, title: '로그인 화면', body: '고친 본문', bodyRevision: 1, x: 10, y: 20 });
    expect(restored?.items).toHaveLength(2);
    expect(restored?.items[0]).toMatchObject({ id: itemId, taskAgentId: 'agent-1', generatedRevision: 0 });
  });

  it('다른 프로젝트의 스펙은 그 프로젝트 체크포인트에 실리지 않는다', () => {
    const { graph, projectName } = makeGraph();
    create(graph, projectName);
    create(graph, 'other-project');

    const cp = graph.toProjectCheckpoint(projectName);
    expect(cp.specDocs).toHaveLength(1);
    expect(cp.specDocs?.[0]?.projectName).toBe(projectName);
  });

  it('스펙이 없으면 체크포인트에 빈 배열을 남기지 않는다', () => {
    const { graph, projectName } = makeGraph();
    expect(graph.toProjectCheckpoint(projectName).specDocs).toBeUndefined();
  });

  it('머지 복원은 있던 것을 덮지 않는다 (합집합)', () => {
    const { graph, projectName } = makeGraph();
    const mine = create(graph, projectName);
    graph.updateSpecDoc(mine.id, { title: '지금 것' });

    const other = new ProjectGraph();
    other.registerProject(PROJECT_CWD);
    const theirs = create(other, projectName);

    graph.mergeFromCheckpoint(other.toProjectCheckpoint(projectName));

    const ids = graph.getSpecDocs().map((d) => d.id).sort();
    expect(ids).toEqual([mine.id, theirs.id].sort());
    expect(graph.getSpecDoc(mine.id)?.title).toBe('지금 것');
  });

  it('구버전 체크포인트(항목·개정 번호 없음)도 에러 없이 복원된다', () => {
    const { graph, projectName } = makeGraph();
    const doc = create(graph, projectName);
    const cp = graph.toProjectCheckpoint(projectName);
    // 구버전 디스크 포맷 흉내 — 필드가 통째로 빠져 있다.
    const legacy = { ...cp, specDocs: [{ ...doc, items: undefined, bodyRevision: undefined } as never] };

    const fresh = new ProjectGraph();
    expect(() => fresh.restoreFromCheckpoint(legacy)).not.toThrow();
    expect(fresh.getSpecDoc(doc.id)?.items).toEqual([]);
    expect(fresh.getSpecDoc(doc.id)?.bodyRevision).toBe(0);
  });
});

describe('SpecDoc — 스냅샷 병합 (프로젝트를 둘 이상 열었을 때)', () => {
  it('두 스냅샷의 스펙이 모두 살아남는다', () => {
    const a = new ProjectGraph();
    a.registerProject(PROJECT_CWD);
    const mine = create(a, 'spec-project');

    const b = new ProjectGraph();
    b.registerProject('/tmp/other-spec-project');
    const theirs = create(b, 'other-spec-project');

    const merged = mergeSnapshots(a.getSnapshot(), b.getSnapshot());
    expect(merged.specDocs?.map((d) => d.id).sort()).toEqual([mine.id, theirs.id].sort());
  });

  it('같은 스냅샷을 두 번 합쳐도 중복되지 않는다', () => {
    const { graph, projectName } = makeGraph();
    const doc = create(graph, projectName);
    expect(mergeSnapshots(graph.getSnapshot(), graph.getSnapshot()).specDocs?.map((d) => d.id)).toEqual([doc.id]);
  });
});
