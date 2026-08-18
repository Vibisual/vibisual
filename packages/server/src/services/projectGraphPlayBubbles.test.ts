import { describe, expect, it } from 'vitest';
import type { PlayRecipe } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { mergeSnapshots } from './projectGraphManager.js';

/**
 * §5.14 v4.62 — 플레이 버블의 **영속 왕복** 회귀 테스트.
 *
 * 앱 버블(§5.13)에서 이미 두 번 데인 자리를 그대로 못 박는다 — ① 영속 5지점 중 앞의 둘만
 * 채우면 화면엔 보이는데 껐다 켜면 사라지고, ② `mergeSnapshots` 를 빠뜨리면 프로젝트를
 * 둘 이상 연 사람에게만 사라진다(REST 는 200 이라 클라 버그로 오진하기 딱 좋다).
 *
 * 여기에 이 기능 고유의 계약이 하나 더 있다: **실행 상태는 복원되지 않는다.** 버튼과
 * 레시피는 사용자의 것이라 살아나야 하지만, `running` 은 앱과 함께 죽은 프로세스의 잔상이다.
 */

const PROJECT_CWD = '/tmp/play-project';

function makeGraph(): { graph: ProjectGraph; projectName: string } {
  const graph = new ProjectGraph();
  // 프로젝트가 등록돼 있어야 toProjectCheckpoint 의 이름 필터를 통과한다.
  const info = graph.registerProject(PROJECT_CWD);
  return { graph, projectName: info.name };
}

const RECIPE: PlayRecipe = {
  kind: 'command',
  command: 'pnpm dev',
  cwd: PROJECT_CWD,
  port: 5173,
  label: 'pnpm dev',
  source: 'detected',
};

function create(graph: ProjectGraph, projectName: string, recipe?: PlayRecipe) {
  return graph.createPlayBubble({
    projectName,
    x: 10,
    y: 20,
    width: 156,
    height: 100,
    ...(recipe ? { recipe } : {}),
  });
}

describe('PlayBubble — 생성과 조회', () => {
  it('만들면 목록과 스냅샷에 함께 나타난다', () => {
    const { graph, projectName } = makeGraph();
    const bubble = create(graph, projectName, RECIPE);

    expect(bubble.status).toBe('idle');
    expect(bubble.recipe?.command).toBe('pnpm dev');
    expect(graph.getPlayBubbles().map((b) => b.id)).toEqual([bubble.id]);
    expect(graph.getSnapshot().playBubbles?.map((b) => b.id)).toEqual([bubble.id]);
  });

  it('레시피 없이도 만들어진다 (실행법을 아직 모르는 상태)', () => {
    const { graph, projectName } = makeGraph();
    const bubble = create(graph, projectName);
    expect(bubble.recipe).toBeUndefined();
    expect(bubble.status).toBe('idle');
  });
});

describe('PlayBubble — 수정과 삭제', () => {
  it('좌표·상태·프리뷰 기하를 부분 갱신한다', () => {
    const { graph, projectName } = makeGraph();
    const b = create(graph, projectName, RECIPE);

    const updated = graph.updatePlayBubble(b.id, {
      status: 'running',
      url: 'http://127.0.0.1:5173/',
      port: 5173,
      previewOpen: true,
      previewX: 300,
    });
    expect(updated?.status).toBe('running');
    expect(updated?.url).toBe('http://127.0.0.1:5173/');
    expect(updated?.previewX).toBe(300);
    expect(updated?.x).toBe(10); // 안 준 것은 그대로
  });

  it('undefined 를 주면 그 필드를 지운다 (stop 이 url·port 를 비우는 경로)', () => {
    const { graph, projectName } = makeGraph();
    const b = create(graph, projectName, RECIPE);
    graph.updatePlayBubble(b.id, { status: 'running', url: 'http://127.0.0.1:5173/', port: 5173 });

    const stopped = graph.updatePlayBubble(b.id, { status: 'idle', url: undefined, port: undefined });
    expect(stopped?.status).toBe('idle');
    expect(stopped?.url).toBeUndefined();
    expect('port' in (stopped as object)).toBe(false);
  });

  it('없는 id 는 null 을 준다 (조용히 만들어 내지 않는다)', () => {
    const { graph } = makeGraph();
    expect(graph.updatePlayBubble('play-nope', { status: 'running' })).toBeNull();
  });

  it('핀이 걸려 있으면 삭제를 거절한다 (§2.4 preserve-pin)', () => {
    const { graph, projectName } = makeGraph();
    const b = create(graph, projectName, RECIPE);
    graph.updatePlayBubble(b.id, { preservePinned: true });

    expect(graph.deletePlayBubble(b.id)).toBe(false);
    expect(graph.getPlayBubbles()).toHaveLength(1);
  });
});

describe('PlayBubble — 영속 왕복 (껐다 켜도 남는가)', () => {
  it('프로젝트 체크포인트에 실리고 버튼·레시피가 그대로 복원된다', () => {
    const { graph, projectName } = makeGraph();
    const b = create(graph, projectName, RECIPE);
    graph.updatePlayBubble(b.id, { title: '내 앱', previewX: 400, previewY: 20, previewWidth: 520, previewHeight: 340 });

    const cp = graph.toProjectCheckpoint(projectName);
    expect(cp.playBubbles?.map((x) => x.id)).toEqual([b.id]);

    const fresh = new ProjectGraph();
    fresh.restoreFromCheckpoint(cp);

    const restored = fresh.getPlayBubbles();
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      id: b.id,
      title: '내 앱',
      x: 10,
      y: 20,
      previewX: 400,
      previewWidth: 520,
    });
    expect(restored[0]?.recipe?.command).toBe('pnpm dev');
  });

  it('실행 중이던 상태는 복원되지 않는다 (프로세스는 앱과 함께 죽었다)', () => {
    const { graph, projectName } = makeGraph();
    const b = create(graph, projectName, RECIPE);
    graph.updatePlayBubble(b.id, {
      status: 'running',
      url: 'http://127.0.0.1:5173/',
      port: 5173,
      previewOpen: true,
      error: 'stale',
    });

    const fresh = new ProjectGraph();
    fresh.restoreFromCheckpoint(graph.toProjectCheckpoint(projectName));

    const restored = fresh.getPlayBubble(b.id);
    expect(restored?.status).toBe('idle');
    expect(restored?.url).toBeUndefined();
    expect(restored?.port).toBeUndefined();
    expect(restored?.error).toBeUndefined();
    expect(restored?.previewOpen).toBe(false);
  });

  it('다른 프로젝트의 버블은 그 프로젝트 체크포인트에 실리지 않는다', () => {
    const { graph, projectName } = makeGraph();
    create(graph, projectName, RECIPE);
    create(graph, 'other-project', RECIPE);

    const cp = graph.toProjectCheckpoint(projectName);
    expect(cp.playBubbles).toHaveLength(1);
    expect(cp.playBubbles?.[0]?.projectName).toBe(projectName);
  });

  it('버블이 없으면 체크포인트에 빈 배열을 남기지 않는다', () => {
    const { graph, projectName } = makeGraph();
    expect(graph.toProjectCheckpoint(projectName).playBubbles).toBeUndefined();
  });

  it('머지 복원은 있던 것을 덮지 않는다 (합집합)', () => {
    const { graph, projectName } = makeGraph();
    const mine = create(graph, projectName, RECIPE);
    graph.updatePlayBubble(mine.id, { title: '지금 것' });

    const other = new ProjectGraph();
    const otherName = other.registerProject('/tmp/second-play-project').name;
    const theirs = create(other, otherName, RECIPE);

    graph.mergeFromCheckpoint(other.toProjectCheckpoint(otherName));

    expect(graph.getPlayBubble(mine.id)?.title).toBe('지금 것');
    expect(graph.getPlayBubble(theirs.id)).toBeDefined();
  });
});

/**
 * 프로젝트를 둘 이상 연 사용자에겐 방송 스냅샷이 인스턴스별 스냅샷의 **병합본**이다.
 * 앱 버블이 바로 이 자리를 빠뜨려 "서버엔 있는데 캔버스엔 없는" 상태가 됐었다.
 */
describe('PlayBubble — 여러 프로젝트 병합 (캔버스에 실제로 도달하는가)', () => {
  it('다른 프로젝트 인스턴스와 합쳐도 살아남는다', () => {
    const { graph: a, projectName: nameA } = makeGraph();
    const bubble = create(a, nameA, RECIPE);

    const b = new ProjectGraph();
    b.registerProject('/tmp/other-play-project');

    expect(mergeSnapshots(a.getSnapshot(), b.getSnapshot()).playBubbles?.map((x) => x.id)).toEqual([bubble.id]);
    expect(mergeSnapshots(b.getSnapshot(), a.getSnapshot()).playBubbles?.map((x) => x.id)).toEqual([bubble.id]);
  });

  it('같은 id 는 한 번만 실린다', () => {
    const { graph, projectName } = makeGraph();
    const bubble = create(graph, projectName, RECIPE);
    expect(mergeSnapshots(graph.getSnapshot(), graph.getSnapshot()).playBubbles?.map((x) => x.id)).toEqual([bubble.id]);
  });
});

/** 스냅샷 캐시(mutationVersion + TTL) 함정 — bump 를 빠뜨리면 생성 직후 방송에 안 실린다. */
describe('PlayBubble — 스냅샷 캐시 무효화', () => {
  it('직전에 스냅샷을 떴어도 생성·수정·삭제가 곧바로 실린다', () => {
    const { graph, projectName } = makeGraph();
    graph.getSnapshot();
    const b = create(graph, projectName, RECIPE);
    expect(graph.getSnapshot().playBubbles?.map((x) => x.id)).toEqual([b.id]);

    graph.updatePlayBubble(b.id, { status: 'running' });
    expect(graph.getSnapshot().playBubbles?.[0]?.status).toBe('running');

    expect(graph.deletePlayBubble(b.id)).toBe(true);
    expect(graph.getSnapshot().playBubbles ?? []).toHaveLength(0);
  });
});
