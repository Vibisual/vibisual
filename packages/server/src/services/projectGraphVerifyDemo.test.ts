import { describe, it, expect } from 'vitest';
import { ProjectGraph } from './projectGraph.js';
import { VERIFICATION_DEMO_MAX_PER_SESSION } from '@vibisual/shared';
import type { VerificationDemo } from '@vibisual/shared';

/**
 * §5.5 #17-35 ⑨ — 시연(재현 절차) 보관 계층 회귀 테스트.
 *
 * 실행 이력(`projectGraphVerification.test.ts`)과 똑같은 자리에서 조용히 깨진다(§3.2 v1.59/v2.55
 * 재발 자리) — 다만 이쪽이 더 아프다: 실행 이력은 다시 돌리면 되지만 **시연은 사람이 화면 앞에
 * 앉아 직접 만든 것**이라 사라지면 다시 만드는 수밖에 없다.
 *
 * 그리고 이 레코드에는 **디스크의 그림이 딸려 있다.** 밀려나거나 지워질 때 그 레코드가 호출자에게
 * 돌아오지 않으면 그림 폴더가 영원히 남는다(§9 용량 규칙) — 아래 테스트가 그 반환을 지킨다.
 */

/** 프로젝트가 붙은 그래프 — 체크포인트 필터(`projectBubbleIds`)를 통과하려면 에이전트가 프로젝트에 귀속돼야 한다. */
function seededGraph(): { graph: ProjectGraph; projectName: string } {
  const graph = new ProjectGraph();
  const projectName = graph.registerProject(process.cwd()).name;
  return { graph, projectName };
}

function makeDemo(
  agentId: string,
  subAgentId: string,
  over: Partial<VerificationDemo> = {},
): VerificationDemo {
  const now = Date.now();
  return {
    id: `demo-${now}-${Math.random().toString(36).slice(2, 8)}`,
    agentId,
    subAgentId,
    projectName: 'proj',
    label: '로그인 후 저장',
    sourceName: 'MyApp',
    steps: [{ atMs: 3_000, text: '저장을 누른다' }],
    expected: '초록 알림이 뜬다',
    frames: [{ rel: 'demo-x/0.png', atMs: 3_000 }],
    durationMs: 15_000,
    recordedAt: now,
    ...over,
  };
}

describe('ProjectGraph — 시연(⑨)', () => {
  it('추가·조회·부분갱신·삭제가 세션(subAgentId) 단위로 동작한다', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Verifier');

    const a = makeDemo(agent.id, 'sub-a');
    graph.addVerificationDemo(a);
    graph.addVerificationDemo(makeDemo(agent.id, 'sub-b', { label: '다른 탭' }));

    expect(graph.getVerificationDemos('sub-a')).toHaveLength(1);
    expect(graph.getVerificationDemos('sub-b')[0]!.label).toBe('다른 탭');

    const updated = graph.updateVerificationDemo(a.id, { label: '이름 바꿈' });
    expect(updated?.label).toBe('이름 바꿈');
    // 한 탭을 고쳐도 다른 탭은 그대로 — 탭마다 독립이라는 게 이 축의 핵심(루프·목표와 같다).
    expect(graph.getVerificationDemos('sub-b')[0]!.label).toBe('다른 탭');

    // 지운 레코드를 돌려준다 — 호출자(서버)가 그 그림 폴더를 지울 수 있어야 하기 때문.
    const gone = graph.deleteVerificationDemo(a.id);
    expect(gone?.id).toBe(a.id);
    expect(graph.deleteVerificationDemo(a.id)).toBeUndefined();
  });

  it('상한을 넘기면 **밀려난 레코드를 돌려준다**(그림을 회수할 수 있게 — §9)', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Verifier');
    let evictedTotal = 0;
    for (let i = 0; i < VERIFICATION_DEMO_MAX_PER_SESSION + 3; i++) {
      evictedTotal += graph.addVerificationDemo(makeDemo(agent.id, 'sub-a', { label: `d${i}` })).length;
    }
    expect(graph.getVerificationDemos('sub-a')).toHaveLength(VERIFICATION_DEMO_MAX_PER_SESSION);
    // 밀려난 3건이 조용히 사라지지 않고 호출자에게 온다.
    expect(evictedTotal).toBe(3);
    // 최신이 앞.
    expect(graph.getVerificationDemos('sub-a')[0]!.label).toBe(`d${VERIFICATION_DEMO_MAX_PER_SESSION + 2}`);
  });

  it('디스크 포맷(toProjectCheckpoint)에 실려 껐다 켜도 남는다', () => {
    const { graph, projectName } = seededGraph();
    const agent = graph.createCustomAgent('Verifier', undefined, projectName);
    graph.addVerificationDemo(makeDemo(agent.id, 'sub-a', { label: '지켜야 할 절차' }));

    const cp = graph.toProjectCheckpoint(projectName);
    // 여기 빠지면 사람이 직접 녹화한 절차가 재시작 한 번에 사라진다.
    expect(cp.verificationDemos?.['sub-a']?.[0]?.label).toBe('지켜야 할 절차');
    expect(graph.toCheckpoint().verificationDemos?.['sub-a']).toBeDefined();

    const fresh = new ProjectGraph();
    fresh.restoreFromCheckpoint(cp);
    const restored = fresh.getVerificationDemos('sub-a')[0]!;
    expect(restored.label).toBe('지켜야 할 절차');
    expect(restored.steps[0]!.text).toBe('저장을 누른다');
    expect(restored.frames[0]!.rel).toBe('demo-x/0.png');
    expect(restored.expected).toBe('초록 알림이 뜬다');
  });

  it('스냅샷에도 실린다 — 실행 폼이 고를 목록을 이걸로 그린다', () => {
    const { graph, projectName } = seededGraph();
    const agent = graph.createCustomAgent('Verifier', undefined, projectName);
    graph.addVerificationDemo(makeDemo(agent.id, 'sub-a'));
    expect(graph.getSnapshot().verificationDemos?.['sub-a']).toHaveLength(1);
  });

  it('복원은 강등하지 않는다 — 시연에는 진행 상태가 없다(사람이 만들어 둔 것)', () => {
    const { graph, projectName } = seededGraph();
    const agent = graph.createCustomAgent('Verifier', undefined, projectName);
    graph.addVerificationDemo(makeDemo(agent.id, 'sub-a', {
      steps: [{ atMs: 1, text: 'a' }, { atMs: 2, text: 'b' }],
    }));
    const cp = graph.toProjectCheckpoint(projectName);

    const fresh = new ProjectGraph();
    fresh.restoreFromCheckpoint(cp);
    expect(fresh.getVerificationDemos('sub-a')[0]!.steps).toHaveLength(2);
  });

  it('병합은 메모리에 이미 있는 탭을 이기지 않는다(없는 탭만 채운다)', () => {
    const { graph, projectName } = seededGraph();
    const agent = graph.createCustomAgent('Verifier', undefined, projectName);
    graph.addVerificationDemo(makeDemo(agent.id, 'sub-live', { label: '지금 것' }));
    const cp = graph.toProjectCheckpoint(projectName);

    const other = new ProjectGraph();
    other.registerProject(process.cwd());
    const otherAgent = other.createCustomAgent('Verifier', undefined, projectName);
    other.addVerificationDemo(makeDemo(otherAgent.id, 'sub-live', { label: '메모리 것' }));
    other.mergeFromCheckpoint(cp);

    expect(other.getVerificationDemos('sub-live')[0]!.label).toBe('메모리 것');
  });

  it('구버전 체크포인트(필드 없음)와 손상된 배열에도 복원이 터지지 않는다', () => {
    const { graph, projectName } = seededGraph();
    graph.createCustomAgent('Verifier', undefined, projectName);
    const cp = graph.toProjectCheckpoint(projectName);
    delete (cp as { verificationDemos?: unknown }).verificationDemos;

    const fresh = new ProjectGraph();
    expect(() => fresh.restoreFromCheckpoint(cp)).not.toThrow();
    expect(fresh.getVerificationDemos('sub-a')).toHaveLength(0);

    const broken = {
      ...cp,
      verificationDemos: { 'sub-a': [null, 7, { id: 'x', steps: 'nope', frames: { bad: 1 } }] },
    } as unknown as typeof cp;
    const fresh2 = new ProjectGraph();
    expect(() => fresh2.restoreFromCheckpoint(broken)).not.toThrow();
    const survived = fresh2.getVerificationDemos('sub-a');
    expect(survived).toHaveLength(1);
    // 배열이 아닌 것은 빈 배열로 — 화면이 아니라 **복원이** 터지는 것을 막는다.
    expect(survived[0]!.steps).toEqual([]);
    expect(survived[0]!.frames).toEqual([]);
  });

  it('경로가 빈 프레임은 버린다(그림을 찾으러 이상한 곳으로 가지 않게)', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Verifier');
    graph.addVerificationDemo(makeDemo(agent.id, 'sub-a', {
      frames: [{ rel: 'ok/0.png', atMs: 0 }, { rel: '', atMs: 1 }],
    }));
    const cp = graph.toCheckpoint();
    const fresh = new ProjectGraph();
    fresh.restoreFromCheckpoint(cp);
    expect(fresh.getVerificationDemos('sub-a')[0]!.frames.map((f) => f.rel)).toEqual(['ok/0.png']);
  });

  it('상한을 넘긴 단계·프레임은 복원에서 잘린다(§9 개수 캡)', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Verifier');
    graph.addVerificationDemo(makeDemo(agent.id, 'sub-a', {
      steps: Array.from({ length: 50 }, (_, i) => ({ atMs: i * 100, text: `s${i}` })),
      frames: Array.from({ length: 30 }, (_, i) => ({ rel: `d/${i}.png`, atMs: i * 100 })),
    }));
    const fresh = new ProjectGraph();
    fresh.restoreFromCheckpoint(graph.toCheckpoint());
    const restored = fresh.getVerificationDemos('sub-a')[0]!;
    expect(restored.steps.length).toBeLessThanOrEqual(20);
    expect(restored.frames.length).toBeLessThanOrEqual(9);
  });

  it('에이전트를 지우면 그 에이전트의 시연도 함께 사라지고 레코드가 돌아온다', () => {
    const graph = new ProjectGraph();
    const a = graph.createCustomAgent('A');
    const b = graph.createCustomAgent('B');
    graph.addVerificationDemo(makeDemo(a.id, 'sub-a'));
    graph.addVerificationDemo(makeDemo(b.id, 'sub-b'));

    const removed = graph.deleteVerificationDemosForAgent(a.id);
    expect(removed).toHaveLength(1);
    expect(graph.getVerificationDemos('sub-a')).toHaveLength(0);
    expect(graph.getVerificationDemos('sub-b')).toHaveLength(1);
  });
});
