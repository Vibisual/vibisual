import { describe, expect, it } from 'vitest';
import { APP_NODE_RESIZE } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { mergeSnapshots } from './projectGraphManager.js';

/** §5.13 — 내부 앱 버블 영속 왕복(스냅샷·전역 체크포인트·프로젝트 체크포인트·복원 네 지점). 앞의 둘만 채우면 껐다 켤 때 조용히 사라진다. */

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

/** 다중 프로젝트의 방송 스냅샷은 병합본이다 — 병합에서 빠진 필드는 REST 200 인데 캔버스에 안 나온다. */
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

/** §5.4 #36 (F) — 클라가 지은 id 를 그대로 받아야 낙관본과 한 노드가 된다. `fileAt` 은 같은 이름으로 다시 보낸 결과의 미리보기를 다시 굽는 열쇠다. */
describe('AppBubble — 클라 id 와 결과 버전 (§5.4 #36 (F))', () => {
  it('비어 있는 클라 id 는 그대로 쓰고, 이미 있는 id 면 새로 짓는다', () => {
    const { graph, projectName } = makeGraph();
    const a = graph.createAppBubble({ id: 'app-mt150mku-a1b2c', projectName, appId: 'vibistudio', x: 0, y: 0 });
    expect(a.id).toBe('app-mt150mku-a1b2c');
    const b = graph.createAppBubble({ id: 'app-mt150mku-a1b2c', projectName, appId: 'vibistudio', x: 0, y: 0 });
    expect(b.id).not.toBe('app-mt150mku-a1b2c');
    expect(graph.getAppBubbles()).toHaveLength(2);
  });

  it('결과를 담으면 버전이 함께 적히고, 담긴 파일을 비우면 함께 지워진다', () => {
    const { graph, projectName } = makeGraph();
    const b = graph.createAppBubble({ projectName, appId: 'vibistudio', x: 0, y: 0 });
    graph.setAppBubbleFile(b.id, 'out/clip.mp4', 1_787_000_000_000);
    expect(graph.getAppBubble(b.id)).toMatchObject({ file: 'out/clip.mp4', fileAt: 1_787_000_000_000 });

    // 같은 이름으로 다시 만들어 다시 보내면 버전이 바뀐다.
    graph.setAppBubbleFile(b.id, 'out/clip.mp4', 1_787_000_009_000);
    expect(graph.getAppBubble(b.id)?.fileAt).toBe(1_787_000_009_000);

    // 버전을 모르면 옛 버전을 남기지 않는다(다른 결과에 옛 열쇠가 붙지 않게).
    graph.setAppBubbleFile(b.id, 'out/other.mp4');
    expect(graph.getAppBubble(b.id)?.fileAt).toBeUndefined();

    graph.setAppBubbleFile(b.id, 'out/clip.mp4', 5);
    graph.updateAppBubble(b.id, { file: null } as unknown as Record<string, never>);
    expect(graph.getAppBubble(b.id)?.file).toBeUndefined();
    expect(graph.getAppBubble(b.id)?.fileAt).toBeUndefined();
  });

  it('PATCH 로는 버전을 적을 수 없다 — 결과 전달 창구 하나뿐이다', () => {
    const { graph, projectName } = makeGraph();
    const b = graph.createAppBubble({ projectName, appId: 'vibistudio', x: 0, y: 0 });
    graph.updateAppBubble(b.id, { fileAt: 123 } as unknown as Record<string, never>);
    expect(graph.getAppBubble(b.id)?.fileAt).toBeUndefined();
  });

  it('결과 버전은 체크포인트 왕복에 남는다(앱 버블은 객체째 영속)', () => {
    const { graph, projectName } = makeGraph();
    const b = graph.createAppBubble({ projectName, appId: 'vibistudio', x: 0, y: 0 });
    graph.setAppBubbleFile(b.id, 'out/clip.mp4', 42);
    const cp = graph.toProjectCheckpoint(projectName);
    const fresh = new ProjectGraph();
    fresh.restoreFromCheckpoint(cp);
    expect(fresh.getAppBubble(b.id)).toMatchObject({ file: 'out/clip.mp4', fileAt: 42 });
  });
});

/** §5.4 #36 (G) — 크기는 형태에 붙는다(`sizedForm`): 정한 적 없는 버블의 width/height 는 생성 시 선언값이라 그리는 쪽이 믿지 않는다. */
describe('AppBubble — 크기 조절(sizedForm)', () => {
  it('크기와 정한 형태를 함께 받고, null 이면 정한 형태만 지운다', () => {
    const { graph, projectName } = makeGraph();
    const b = graph.createAppBubble({ projectName, appId: 'vibistudio', x: 0, y: 0, width: 208, height: 130 });
    graph.updateAppBubble(b.id, { width: 320, height: 200, sizedForm: 'screen' });
    expect(graph.getAppBubble(b.id)).toMatchObject({ width: 320, height: 200, sizedForm: 'screen' });

    graph.updateAppBubble(b.id, { sizedForm: null } as unknown as Record<string, never>);
    expect(graph.getAppBubble(b.id)?.sizedForm).toBeUndefined();
    expect(graph.getAppBubble(b.id)).toMatchObject({ width: 320, height: 200 }); // 크기 칸은 그대로 — 그리는 쪽이 선언값으로 돌아간다
  });

  it('두 형태 밖의 값은 무시한다(칸을 지우지도 않는다)', () => {
    const { graph, projectName } = makeGraph();
    const b = graph.createAppBubble({ projectName, appId: 'vibistudio', x: 0, y: 0 });
    graph.updateAppBubble(b.id, { sizedForm: 'nameplate' });
    graph.updateAppBubble(b.id, { sizedForm: 'circle' } as unknown as Record<string, never>);
    expect(graph.getAppBubble(b.id)?.sizedForm).toBe('nameplate');
  });

  it('크기는 유한한 양수만 받고 상한으로 자른다', () => {
    const { graph, projectName } = makeGraph();
    const b = graph.createAppBubble({ projectName, appId: 'vibistudio', x: 0, y: 0, width: 80, height: 50 });
    graph.updateAppBubble(b.id, { width: '999' as unknown as number, height: -5 });
    expect(graph.getAppBubble(b.id)).toMatchObject({ width: 80, height: 50 });
    graph.updateAppBubble(b.id, { width: Number.POSITIVE_INFINITY, height: Number.NaN });
    expect(graph.getAppBubble(b.id)).toMatchObject({ width: 80, height: 50 });
    graph.updateAppBubble(b.id, { width: 99_999, height: 99_999 });
    expect(graph.getAppBubble(b.id)).toMatchObject({ width: APP_NODE_RESIZE.maxWidth, height: APP_NODE_RESIZE.maxHeight });
  });

  it('정한 형태는 체크포인트 왕복에 남는다(앱 버블은 객체째 영속)', () => {
    const { graph, projectName } = makeGraph();
    const b = graph.createAppBubble({ projectName, appId: 'vibistudio', x: 0, y: 0 });
    graph.updateAppBubble(b.id, { width: 300, height: 180, sizedForm: 'screen' });
    const fresh = new ProjectGraph();
    fresh.restoreFromCheckpoint(graph.toProjectCheckpoint(projectName));
    expect(fresh.getAppBubble(b.id)).toMatchObject({ width: 300, height: 180, sizedForm: 'screen' });
  });
});
