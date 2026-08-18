import { describe, expect, it } from 'vitest';
import { ProjectGraph } from './projectGraph.js';
import { mergeSnapshots } from './projectGraphManager.js';

/**
 * §5.13 v4.45 — 내부 앱 버블의 **영속 왕복** 회귀 테스트.
 *
 * 이 프로젝트에서 영속 필드는 네 지점(스냅샷·전역 체크포인트·프로젝트 체크포인트·복원)에
 * 전부 손대야 하는데, 앞의 두 곳만 채우면 **화면에는 보이는데 껐다 켜면 사라지는** 상태가
 * 된다. 그 실패는 조용하고 재현이 느려서 사람 눈으로는 거의 못 잡는다 — 그래서 왕복을
 * 테스트로 못 박는다.
 */

const PROJECT_CWD = '/tmp/example-project';

function makeGraph(): { graph: ProjectGraph; projectName: string } {
  const graph = new ProjectGraph();
  // 프로젝트가 등록돼 있어야 toProjectCheckpoint 의 이름 필터를 통과한다.
  const info = graph.registerProject(PROJECT_CWD);
  return { graph, projectName: info.name };
}

describe('AppBubble — 생성과 조회', () => {
  it('만들면 목록과 스냅샷에 함께 나타난다', () => {
    const { graph, projectName } = makeGraph();
    const bubble = graph.createAppBubble({ projectName, appId: 'vibistudio', x: 10, y: 20 });

    expect(bubble.appId).toBe('vibistudio');
    expect(bubble.width).toBeGreaterThan(0);
    expect(graph.getAppBubbles().map((b) => b.id)).toEqual([bubble.id]);
    expect(graph.getSnapshot().appBubbles?.map((b) => b.id)).toEqual([bubble.id]);
  });

  it('제목과 열쇠는 준 것만 실린다', () => {
    const { graph, projectName } = makeGraph();
    const bare = graph.createAppBubble({ projectName, appId: 'vibistudio', x: 0, y: 0 });
    expect(bare.title).toBeUndefined();
    expect(bare.ref).toBeUndefined();

    const named = graph.createAppBubble({
      projectName,
      appId: 'vibistudio',
      x: 0,
      y: 0,
      title: '오프닝',
      ref: 'vid-1',
    });
    expect(named.title).toBe('오프닝');
    expect(named.ref).toBe('vid-1');
  });
});

describe('AppBubble — 수정과 삭제', () => {
  it('위치와 제목을 부분 갱신한다', () => {
    const { graph, projectName } = makeGraph();
    const b = graph.createAppBubble({ projectName, appId: 'vibistudio', x: 10, y: 20 });

    const updated = graph.updateAppBubble(b.id, { x: 99, title: '바뀐 이름' });
    expect(updated?.x).toBe(99);
    expect(updated?.y).toBe(20); // 안 준 것은 그대로
    expect(updated?.title).toBe('바뀐 이름');
  });

  it('없는 id 는 null 을 준다 (조용히 만들어 내지 않는다)', () => {
    const { graph } = makeGraph();
    expect(graph.updateAppBubble('app-nope', { x: 1 })).toBeNull();
  });

  it('삭제된다', () => {
    const { graph, projectName } = makeGraph();
    const b = graph.createAppBubble({ projectName, appId: 'vibistudio', x: 0, y: 0 });
    expect(graph.deleteAppBubble(b.id)).toBe(true);
    expect(graph.getAppBubbles()).toHaveLength(0);
  });

  it('핀이 걸려 있으면 삭제를 거절한다 (§2.4 preserve-pin)', () => {
    const { graph, projectName } = makeGraph();
    const b = graph.createAppBubble({ projectName, appId: 'vibistudio', x: 0, y: 0 });
    graph.updateAppBubble(b.id, { preservePinned: true });

    expect(graph.deleteAppBubble(b.id)).toBe(false);
    expect(graph.getAppBubbles()).toHaveLength(1);
  });
});

describe('AppBubble — 영속 왕복 (껐다 켜도 남는가)', () => {
  it('프로젝트 체크포인트에 실리고 복원된다', () => {
    const { graph, projectName } = makeGraph();
    const b = graph.createAppBubble({
      projectName,
      appId: 'vibistudio',
      x: 123,
      y: 456,
      title: '오프닝',
      ref: 'vid-1',
    });

    const cp = graph.toProjectCheckpoint(projectName);
    expect(cp.appBubbles?.map((x) => x.id)).toEqual([b.id]);

    // 새 인스턴스로 복원 — 재시작을 흉내낸다.
    const fresh = new ProjectGraph();
    fresh.restoreFromCheckpoint(cp);

    const restored = fresh.getAppBubbles();
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ id: b.id, appId: 'vibistudio', x: 123, y: 456, title: '오프닝', ref: 'vid-1' });
  });

  it('다른 프로젝트의 버블은 그 프로젝트 체크포인트에 실리지 않는다', () => {
    const { graph, projectName } = makeGraph();
    graph.createAppBubble({ projectName, appId: 'vibistudio', x: 0, y: 0 });
    graph.createAppBubble({ projectName: 'other-project', appId: 'vibistudio', x: 0, y: 0 });

    const cp = graph.toProjectCheckpoint(projectName);
    expect(cp.appBubbles).toHaveLength(1);
    expect(cp.appBubbles?.[0]?.projectName).toBe(projectName);
  });

  it('버블이 없으면 체크포인트에 빈 배열을 남기지 않는다', () => {
    const { graph, projectName } = makeGraph();
    expect(graph.toProjectCheckpoint(projectName).appBubbles).toBeUndefined();
  });

  it('복원은 이전 상태를 갈아엎는다 (남은 유령이 없다)', () => {
    const { graph, projectName } = makeGraph();
    const stale = graph.createAppBubble({ projectName, appId: 'vibistudio', x: 0, y: 0 });

    const empty = new ProjectGraph().toProjectCheckpoint('anything');
    graph.restoreFromCheckpoint(empty);

    expect(graph.getAppBubble(stale.id)).toBeUndefined();
  });

  it('같은 id 를 다시 수용하지 않는다 (머지 중복 방지)', () => {
    const { graph, projectName } = makeGraph();
    const b = graph.createAppBubble({ projectName, appId: 'vibistudio', x: 0, y: 0 });
    expect(graph.acceptAppBubble(b)).toBe(false);
    expect(graph.getAppBubbles()).toHaveLength(1);
  });
});

/**
 * 프로젝트를 둘 이상 연 사용자에겐 방송 스냅샷이 인스턴스별 스냅샷의 **병합본**이다.
 * 병합에서 빠진 필드는 서버에 멀쩡히 있어도 화면엔 영영 안 나온다 — 만든 순간엔 성공처럼
 * 보이고(REST 200) 캔버스만 비어 있어, 클라 버그로 오진하기 딱 좋다. 그래서 못 박는다.
 */
describe('AppBubble — 여러 프로젝트 병합 (캔버스에 실제로 도달하는가)', () => {
  it('다른 프로젝트 인스턴스와 합쳐도 살아남는다', () => {
    const { graph: a, projectName: nameA } = makeGraph();
    const bubble = a.createAppBubble({ projectName: nameA, appId: 'vibistudio', x: 10, y: 20 });

    const b = new ProjectGraph();
    b.registerProject('/tmp/other-project');

    const merged = mergeSnapshots(a.getSnapshot(), b.getSnapshot());
    expect(merged.appBubbles?.map((x) => x.id)).toEqual([bubble.id]);

    // 순서가 반대여도(뒤쪽 인스턴스가 주인이어도) 마찬가지.
    const flipped = mergeSnapshots(b.getSnapshot(), a.getSnapshot());
    expect(flipped.appBubbles?.map((x) => x.id)).toEqual([bubble.id]);
  });

  it('세 인스턴스를 연달아 접어도 각자의 버블이 모두 남는다', () => {
    const { graph: a, projectName: nameA } = makeGraph();
    const ba = a.createAppBubble({ projectName: nameA, appId: 'vibistudio', x: 0, y: 0 });

    const b = new ProjectGraph();
    const nameB = b.registerProject('/tmp/second-project').name;
    const bb = b.createAppBubble({ projectName: nameB, appId: 'vibistudio', x: 0, y: 0 });

    const c = new ProjectGraph();
    c.registerProject('/tmp/third-project');

    const merged = mergeSnapshots(mergeSnapshots(a.getSnapshot(), b.getSnapshot()), c.getSnapshot());
    expect(merged.appBubbles?.map((x) => x.id).sort()).toEqual([ba.id, bb.id].sort());
  });

  it('같은 id 는 한 번만 실린다', () => {
    const { graph: a, projectName } = makeGraph();
    const bubble = a.createAppBubble({ projectName, appId: 'vibistudio', x: 0, y: 0 });

    const merged = mergeSnapshots(a.getSnapshot(), a.getSnapshot());
    expect(merged.appBubbles?.map((x) => x.id)).toEqual([bubble.id]);
  });
});

/**
 * 스냅샷 캐시(mutationVersion + 200ms TTL) 함정 — Map 을 직접 만지고 bump 를 빠뜨리면
 * 생성 직후의 방송이 **버블 없는 캐시본**을 내보내, 다음 활동이 있을 때까지 안 뜬다.
 */
describe('AppBubble — 스냅샷 캐시 무효화', () => {
  it('직전에 스냅샷을 떴어도 생성한 버블이 곧바로 실린다', () => {
    const { graph, projectName } = makeGraph();
    graph.getSnapshot(); // 캐시를 데운다(TTL 200ms 안)
    const b = graph.createAppBubble({ projectName, appId: 'vibistudio', x: 0, y: 0 });

    expect(graph.getSnapshot().appBubbles?.map((x) => x.id)).toEqual([b.id]);
  });

  it('삭제도 곧바로 반영된다', () => {
    const { graph, projectName } = makeGraph();
    const b = graph.createAppBubble({ projectName, appId: 'vibistudio', x: 0, y: 0 });
    graph.getSnapshot();

    expect(graph.deleteAppBubble(b.id)).toBe(true);
    expect(graph.getSnapshot().appBubbles ?? []).toHaveLength(0);
  });
});
