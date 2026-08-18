import { describe, expect, it } from 'vitest';
import { ProjectGraph } from './projectGraph.js';
import { mergeSnapshots } from './projectGraphManager.js';

/**
 * §5.3 #10-3 v4.98 — 검증 런의 **집행 규칙 + 영속 왕복** 회귀 테스트.
 *
 * 이 파일이 지키는 문장은 하나다 — **완료는 서버가 소유한다.**
 * 에이전트가 "통과했다"고 말하는 것과 실제로 통과한 것은 다르며, 그 구분이 무너지면
 * 화면의 초록 배지는 다시 아무것도 보장하지 않는 장식이 된다.
 *
 * 영속은 다섯 지점(선언·스냅샷·프로젝트 체크포인트·복원·병합)을 전부 손대야 하는데,
 * 앞의 둘만 채우면 **화면에는 보이는데 껐다 켜면 사라진다**. 그 실패는 조용해서 사람 눈으로
 * 거의 못 잡으므로 왕복을 테스트로 못 박는다.
 */

const PROJECT_CWD = '/tmp/example-project';
const AUTO_ID = 'auto-session-1';

function makeGraph(): { graph: ProjectGraph; projectName: string } {
  const graph = new ProjectGraph();
  // 프로젝트가 등록돼 있어야 toProjectCheckpoint 의 이름 필터를 통과한다.
  const info = graph.registerProject(PROJECT_CWD);
  return { graph, projectName: info.name };
}

describe('검증 런 — 완료 판정은 서버가 한다', () => {
  it('통과 증거가 없으면 verified 를 요청해도 escalated(no-evidence) 로 떨어진다', () => {
    const { graph } = makeGraph();
    const run = graph.createAutoAgentRun({ autoAgentId: AUTO_ID, userRequest: 'ship it' });

    const closed = graph.closeAutoAgentRun(run.runId, 'verified');

    expect(closed?.status).toBe('escalated');
    expect(closed?.escalation).toBe('no-evidence');
  });

  it('실패 증거(exitCode≠0)만 있어도 verified 가 되지 않는다', () => {
    const { graph } = makeGraph();
    const run = graph.createAutoAgentRun({ autoAgentId: AUTO_ID, userRequest: 'ship it' });
    graph.appendVerificationAttempt(run.runId, {
      kind: 'test', command: 'pnpm test', exitCode: 1, startedAt: Date.now(),
    });

    const closed = graph.closeAutoAgentRun(run.runId, 'verified');

    expect(closed?.status).toBe('escalated');
    expect(closed?.escalation).toBe('no-evidence');
  });

  it('통과 증거가 하나라도 있으면 verified 로 닫힌다', () => {
    const { graph } = makeGraph();
    const run = graph.createAutoAgentRun({ autoAgentId: AUTO_ID, userRequest: 'ship it' });
    graph.appendVerificationAttempt(run.runId, {
      kind: 'typecheck', command: 'pnpm typecheck', exitCode: 0, startedAt: Date.now(),
    });

    const closed = graph.closeAutoAgentRun(run.runId, 'verified');

    expect(closed?.status).toBe('verified');
    expect(closed?.escalation).toBeUndefined();
  });

  it('ok 는 신고받는 값이 아니라 exitCode 로 서버가 계산한다', () => {
    const { graph } = makeGraph();
    const run = graph.createAutoAgentRun({ autoAgentId: AUTO_ID, userRequest: 'ship it' });
    // 호출부가 ok 를 넘길 방법 자체가 없다(타입에서 제외). exitCode 만으로 갈린다.
    graph.appendVerificationAttempt(run.runId, { kind: 'build', command: 'pnpm build', exitCode: 0, startedAt: 1 });
    graph.appendVerificationAttempt(run.runId, { kind: 'build', command: 'pnpm build', exitCode: 2, startedAt: 2 });

    const stored = graph.getAutoAgentRun(run.runId)!;
    expect(stored.attempts.map((a) => a.ok)).toEqual([true, false]);
  });
});

describe('검증 런 — 예산은 런 단위', () => {
  it('예산을 넘기면 withinBudget=false 를 돌려준다 (호출부가 에스컬레이션한다)', () => {
    const { graph } = makeGraph();
    const run = graph.createAutoAgentRun({ autoAgentId: AUTO_ID, userRequest: 'x', reworkBudget: 2 });

    expect(graph.consumeAutoAgentRework(run.runId)?.withinBudget).toBe(true);
    expect(graph.consumeAutoAgentRework(run.runId)?.withinBudget).toBe(true);
    const third = graph.consumeAutoAgentRework(run.runId);

    expect(third?.withinBudget).toBe(false);
    // 초과 시도는 카운트를 올리지 않는다.
    expect(third?.run.reworkUsed).toBe(2);
  });

  it('같은 auto-agent 의 새 요청은 이전 런을 덮지 않는다', () => {
    const { graph } = makeGraph();
    const first = graph.createAutoAgentRun({ autoAgentId: AUTO_ID, userRequest: 'first' });
    graph.appendVerificationAttempt(first.runId, { kind: 'test', command: 'a', exitCode: 0, startedAt: 1 });
    graph.closeAutoAgentRun(first.runId, 'verified');
    const second = graph.createAutoAgentRun({ autoAgentId: AUTO_ID, userRequest: 'second' });

    const runs = graph.listAutoAgentRuns(AUTO_ID);
    expect(runs).toHaveLength(2);
    expect(runs.map((r) => r.userRequest)).toEqual(['first', 'second']);
    // 활성 런은 아직 안 닫힌 쪽 하나뿐이다.
    expect(graph.getActiveAutoAgentRun(AUTO_ID)?.runId).toBe(second.runId);
  });
});

describe('검증 런 — 영속 왕복 5지점', () => {
  it('스냅샷에 실린다', () => {
    const { graph } = makeGraph();
    graph.createAutoAgentRun({ autoAgentId: AUTO_ID, userRequest: 'x' });

    expect(graph.getSnapshot().autoAgentRuns?.[AUTO_ID]).toHaveLength(1);
  });

  it('프로젝트 체크포인트로 나갔다가 복원해도 증거가 남는다', () => {
    const { graph, projectName } = makeGraph();
    // 디스크 포맷(toProjectCheckpoint)은 **세션 소속**으로 거르므로, 런의 주인이 실제로
    // 이 프로젝트의 auto-agent 여야 한다. 그래서 버블을 실제로 만들고 그 sessionId 를 쓴다.
    const bubble = graph.createAutoAgent('Auto 1', { x: 0, y: 0 }, projectName);
    const AUTO_ID = bubble.path;
    const run = graph.createAutoAgentRun({ autoAgentId: AUTO_ID, userRequest: 'keep me' });
    graph.appendVerificationAttempt(run.runId, {
      kind: 'test', command: 'pnpm test', exitCode: 0, revision: 'abc1234', startedAt: 123,
    });
    graph.closeAutoAgentRun(run.runId, 'verified');

    const cp = graph.toProjectCheckpoint(projectName)!;
    expect(cp.autoAgentRuns?.[AUTO_ID]).toHaveLength(1);

    const revived = new ProjectGraph();
    revived.registerProject(PROJECT_CWD);
    revived.restoreFromCheckpoint(cp);

    const restored = revived.listAutoAgentRuns(AUTO_ID);
    expect(restored).toHaveLength(1);
    expect(restored[0]!.status).toBe('verified');
    expect(restored[0]!.attempts[0]!.ok).toBe(true);
    expect(restored[0]!.attempts[0]!.revision).toBe('abc1234');
  });

  it('여러 프로젝트를 합쳐도 런이 사라지지 않는다 (mergeSnapshots)', () => {
    const a = new ProjectGraph();
    a.registerProject('/tmp/project-a');
    a.createAutoAgentRun({ autoAgentId: 'auto-a', userRequest: 'a' });

    const b = new ProjectGraph();
    b.registerProject('/tmp/project-b');
    b.createAutoAgentRun({ autoAgentId: 'auto-b', userRequest: 'b' });

    const merged = mergeSnapshots(a.getSnapshot(), b.getSnapshot());

    expect(Object.keys(merged.autoAgentRuns ?? {}).sort()).toEqual(['auto-a', 'auto-b']);
  });
});
