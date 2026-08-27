import { describe, it, expect } from 'vitest';
import { ProjectGraph } from './projectGraph.js';
import { VERIFICATION_RUNS_MAX_PER_SESSION } from '@vibisual/shared';
import type { VerificationRun } from '@vibisual/shared';

/**
 * §5.5 #17-35 — 검증(Verify) 보관 계층 회귀 테스트.
 *
 * 이 기능에서 조용히 깨지는 곳은 판정 로직이 아니라 **영속화**다(§3.2 v1.59/v2.55 재발 자리):
 * `getSnapshot` 에만 넣고 디스크 포맷인 `toProjectCheckpoint` 를 빠뜨리면 화면엔 잘 보이다가
 * 껐다 켜면 검증 이력이 통째로 사라진다. 그리고 서버가 죽는 동안 돌던 검증(`running`)을 그대로
 * 복원하면 죽은 명령 id 를 영원히 기다려 그 탭에서 새 검증을 영영 시작할 수 없게 된다.
 */

/** 프로젝트가 붙은 그래프 — 체크포인트 필터(`projectBubbleIds`)를 통과하려면 에이전트가 프로젝트에 귀속돼야 한다. */
function seededGraph(): { graph: ProjectGraph; projectName: string } {
  const graph = new ProjectGraph();
  const projectName = graph.registerProject(process.cwd()).name;
  return { graph, projectName };
}

function makeRun(
  agentId: string,
  subAgentId: string,
  over: Partial<VerificationRun> = {},
): VerificationRun {
  const now = Date.now();
  return {
    id: `ver-${now}-${Math.random().toString(36).slice(2, 8)}`,
    agentId,
    subAgentId,
    projectName: 'proj',
    recipeSource: 'play-recipe',
    recipeLabel: 'pnpm dev · http://127.0.0.1:5173',
    status: 'done',
    verdict: 'pass',
    attempts: [{ kind: 'run', command: 'pnpm dev', exitCode: 0 }],
    startedAt: now,
    finishedAt: now + 1000,
    durationMs: 1000,
    ...over,
  };
}

describe('ProjectGraph — 검증(Verify)', () => {
  it('추가·조회·부분갱신·삭제가 세션(subAgentId) 단위로 동작한다', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Verifier');

    const a = graph.addVerificationRun(makeRun(agent.id, 'sub-a', { verdict: 'fail' }));
    graph.addVerificationRun(makeRun(agent.id, 'sub-b'));

    expect(graph.getVerificationRuns('sub-a')).toHaveLength(1);
    expect(graph.getVerificationRuns('sub-b')[0]!.verdict).toBe('pass');

    const updated = graph.updateVerificationRun(a.id, { verdict: 'pass', reason: '다시 돌려 보니 된다' });
    expect(updated?.verdict).toBe('pass');
    // 한 탭을 고쳐도 다른 탭은 그대로 — 탭마다 독립이라는 게 이 축의 핵심(루프·목표와 같다).
    expect(graph.getVerificationRuns('sub-b')[0]!.reason).toBeUndefined();

    expect(graph.deleteVerificationRun(a.id)).toBe(true);
    expect(graph.getVerificationRuns('sub-a')).toHaveLength(0);
    expect(graph.deleteVerificationRun(a.id)).toBe(false);
  });

  it('최신이 앞에 오고 세션당 상한에서 잘린다(개수 캡 — §9)', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Verifier');
    for (let i = 0; i < VERIFICATION_RUNS_MAX_PER_SESSION + 7; i++) {
      graph.addVerificationRun(makeRun(agent.id, 'sub-a', { reason: `run-${i}` }));
    }
    const list = graph.getVerificationRuns('sub-a');
    expect(list).toHaveLength(VERIFICATION_RUNS_MAX_PER_SESSION);
    expect(list[0]!.reason).toBe(`run-${VERIFICATION_RUNS_MAX_PER_SESSION + 6}`);
  });

  it('진행 중인 검증 하나만 active 로 잡힌다(겹쳐 쏘지 않기 위한 판정)', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Verifier');
    graph.addVerificationRun(makeRun(agent.id, 'sub-a'));
    expect(graph.getActiveVerificationRun('sub-a')).toBeUndefined();

    const live = graph.addVerificationRun(
      makeRun(agent.id, 'sub-a', { status: 'running', verdict: 'unknown', pendingCommandId: 'cmd-1' }),
    );
    expect(graph.getActiveVerificationRun('sub-a')?.id).toBe(live.id);
  });

  it('스냅샷과 프로젝트 체크포인트(디스크 포맷) 양쪽에 실린다', () => {
    const { graph, projectName } = seededGraph();
    const agent = graph.createCustomAgent('Verifier', undefined, projectName);
    const run = graph.addVerificationRun(makeRun(agent.id, 'sub-a', { verdict: 'fail', reason: '흰 화면' }));

    expect(graph.getSnapshot().verificationRuns?.['sub-a']?.[0]?.id).toBe(run.id);

    const cp = graph.toProjectCheckpoint(projectName);
    // 여기 빠지면 "화면엔 보이는데 껐다 켜면 사라지는" 고전적 결함이 된다.
    expect(cp.verificationRuns?.['sub-a']?.[0]?.reason).toBe('흰 화면');
    expect(graph.toCheckpoint().verificationRuns?.['sub-a']).toBeDefined();
  });

  it('복원 시 돌던 검증(running/queued)은 stopped 로 내리고 대조 id 를 비운다', () => {
    const { graph, projectName } = seededGraph();
    const agent = graph.createCustomAgent('Verifier', undefined, projectName);
    graph.addVerificationRun(
      makeRun(agent.id, 'sub-a', { status: 'running', verdict: 'unknown', pendingCommandId: 'cmd-dead' }),
    );
    const cp = graph.toProjectCheckpoint(projectName);

    const fresh = new ProjectGraph();
    fresh.restoreFromCheckpoint(cp);
    const restored = fresh.getVerificationRuns('sub-a')[0]!;
    expect(restored.status).toBe('stopped');
    expect(restored.pendingCommandId).toBeUndefined();
    // 그래야 그 탭에서 새 검증을 바로 시작할 수 있다.
    expect(fresh.getActiveVerificationRun('sub-a')).toBeUndefined();
  });

  it('병합은 메모리에 이미 있는 탭을 이기지 않는다(없는 탭만 채운다)', () => {
    const { graph, projectName } = seededGraph();
    const agent = graph.createCustomAgent('Verifier', undefined, projectName);
    graph.addVerificationRun(makeRun(agent.id, 'sub-live', { reason: '지금 것' }));
    const cp = graph.toProjectCheckpoint(projectName);

    const other = new ProjectGraph();
    other.registerProject(process.cwd());
    const otherAgent = other.createCustomAgent('Verifier', undefined, projectName);
    other.addVerificationRun(makeRun(otherAgent.id, 'sub-live', { reason: '메모리 것' }));
    other.mergeFromCheckpoint(cp);

    expect(other.getVerificationRuns('sub-live')[0]!.reason).toBe('메모리 것');
  });

  it('구버전 체크포인트(필드 없음)와 손상된 배열에도 복원이 터지지 않는다', () => {
    const { graph, projectName } = seededGraph();
    graph.createCustomAgent('Verifier', undefined, projectName);
    const cp = graph.toProjectCheckpoint(projectName);
    delete (cp as { verificationRuns?: unknown }).verificationRuns;

    const fresh = new ProjectGraph();
    expect(() => fresh.restoreFromCheckpoint(cp)).not.toThrow();
    expect(fresh.getVerificationRuns('sub-a')).toHaveLength(0);

    const broken = { ...cp, verificationRuns: { 'sub-a': [null, 3, { id: 'x' }] } } as unknown as typeof cp;
    const fresh2 = new ProjectGraph();
    expect(() => fresh2.restoreFromCheckpoint(broken)).not.toThrow();
    // 모양이 아닌 항목은 버리고, 살아남은 것은 안전한 기본값을 갖는다.
    const survived = fresh2.getVerificationRuns('sub-a');
    expect(survived).toHaveLength(1);
    expect(survived[0]!.verdict).toBe('unknown');
    expect(survived[0]!.attempts).toEqual([]);
  });

  it('에이전트를 지우면 그 에이전트의 검증도 함께 사라진다', () => {
    const graph = new ProjectGraph();
    const a = graph.createCustomAgent('A');
    const b = graph.createCustomAgent('B');
    graph.addVerificationRun(makeRun(a.id, 'sub-a'));
    graph.addVerificationRun(makeRun(b.id, 'sub-b'));

    expect(graph.deleteVerificationRunsForAgent(a.id)).toBe(1);
    expect(graph.getVerificationRuns('sub-a')).toHaveLength(0);
    expect(graph.getVerificationRuns('sub-b')).toHaveLength(1);
  });
});
