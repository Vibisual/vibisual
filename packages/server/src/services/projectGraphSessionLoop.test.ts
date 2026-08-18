import { describe, it, expect } from 'vitest';
import { ProjectGraph } from './projectGraph.js';
import type { SessionLoop } from '@vibisual/shared';

/**
 * §5.5 #17-11 v3.79 — 세션 반복 실행(루프)의 보관 계층 회귀 테스트.
 *
 * 이 기능에서 조용히 깨지기 쉬운 곳은 실행 로직이 아니라 **영속화**다(§3.2 v1.59/v2.55 재발 자리):
 * `getSnapshot` 에만 넣고 디스크 포맷인 `toProjectCheckpoint` 를 빠뜨리면 화면엔 잘 보이다가
 * 껐다 켜면 루프가 사라진다. 그리고 서버가 죽는 동안 걸려 있던 회차(`running`)를 그대로 복원하면
 * 죽은 명령 id 를 영원히 기다려 "켜져 있는데 아무 일도 안 하는" 루프가 된다.
 */

/**
 * 프로젝트가 붙은 그래프 — 체크포인트 필터(`projectBubbleIds`)를 통과하려면 에이전트가
 * 실제 프로젝트에 귀속돼야 한다. 실행 중인 저장소 루트를 그대로 프로젝트로 시드한다.
 */
function seededGraph(): { graph: ProjectGraph; projectName: string } {
  const graph = new ProjectGraph();
  const projectName = graph.registerProject(process.cwd()).name;
  return { graph, projectName };
}

function makeLoop(agentId: string, subAgentId: string, over: Partial<SessionLoop> = {}): SessionLoop {
  const now = Date.now();
  return {
    agentId,
    subAgentId,
    command: 'run the tests',
    mode: 'count',
    total: 5,
    completed: 0,
    enabled: true,
    intervalMs: 0,
    stopOnError: true,
    contextMode: 'none',
    spentCostUsd: 0,
    spentTokens: 0,
    oneTaskPerRound: false,
    commitEachRound: false,
    status: 'waiting',
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe('ProjectGraph — 세션 반복 실행(루프)', () => {
  it('저장·조회·부분갱신·삭제가 세션(subAgentId) 단위로 동작한다', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Looper');

    graph.setSessionLoop(makeLoop(agent.id, 'sub-a'));
    graph.setSessionLoop(makeLoop(agent.id, 'sub-b', { mode: 'infinite', total: undefined }));

    expect(graph.getSessionLoop('sub-a')?.mode).toBe('count');
    expect(graph.getSessionLoop('sub-b')?.mode).toBe('infinite');
    expect(graph.getSessionLoopsForAgent(agent.id)).toHaveLength(2);

    // 한 탭만 전진해도 다른 탭은 그대로 — 탭마다 독립이라는 게 이 기능의 핵심.
    const updated = graph.updateSessionLoop('sub-a', { completed: 3, status: 'running' });
    expect(updated?.completed).toBe(3);
    expect(graph.getSessionLoop('sub-b')?.completed).toBe(0);

    expect(graph.deleteSessionLoop('sub-a')).toBe(true);
    expect(graph.getSessionLoop('sub-a')).toBeUndefined();
    expect(graph.deleteSessionLoop('sub-a')).toBe(false);
  });

  it('스냅샷과 프로젝트 체크포인트(디스크 포맷) 양쪽에 실린다', () => {
    const { graph, projectName } = seededGraph();
    const agent = graph.createCustomAgent('Looper', undefined, projectName);
    graph.setSessionLoop(makeLoop(agent.id, 'sub-a', { completed: 2 }));

    expect(graph.getSnapshot().sessionLoops?.['sub-a']?.completed).toBe(2);

    const cp = graph.toProjectCheckpoint(projectName);
    // 여기 빠지면 "화면엔 보이는데 껐다 켜면 사라지는" 고전적 결함이 된다.
    expect(cp.sessionLoops?.['sub-a']?.completed).toBe(2);
    expect(graph.toCheckpoint().sessionLoops?.['sub-a']).toBeDefined();
  });

  it('복원 시 걸려 있던 회차(running)는 대기로 되돌리고 대조 id 를 비운다', () => {
    const { graph, projectName } = seededGraph();
    const agent = graph.createCustomAgent('Looper', undefined, projectName);
    graph.setSessionLoop(makeLoop(agent.id, 'sub-a', {
      status: 'running', pendingCommandId: 'cmd-dead', completed: 1,
    }));
    const cp = graph.toProjectCheckpoint(projectName);

    const revived = new ProjectGraph();
    revived.restoreFromCheckpoint(cp);
    const loop = revived.getSessionLoop('sub-a');
    expect(loop?.completed).toBe(1);          // 진행 카운트는 이어진다
    expect(loop?.status).toBe('waiting');     // 죽은 회차를 기다리지 않는다
    expect(loop?.pendingCommandId).toBeUndefined();
  });

  it('복원 시 꺼져 있던 루프는 저절로 살아나지 않는다', () => {
    const { graph, projectName } = seededGraph();
    const agent = graph.createCustomAgent('Looper', undefined, projectName);
    graph.setSessionLoop(makeLoop(agent.id, 'sub-a', {
      enabled: false, status: 'running', pendingCommandId: 'cmd-dead',
    }));

    const revived = new ProjectGraph();
    revived.restoreFromCheckpoint(graph.toProjectCheckpoint(projectName));
    const loop = revived.getSessionLoop('sub-a');
    expect(loop?.enabled).toBe(false);
    expect(loop?.status).toBe('stopped');
  });

  it('병합은 메모리에 이미 있는(지금 도는) 설정을 덮지 않는다', () => {
    const { graph, projectName } = seededGraph();
    const agent = graph.createCustomAgent('Looper', undefined, projectName);
    graph.setSessionLoop(makeLoop(agent.id, 'sub-a', { command: 'from disk', completed: 9 }));
    const cp = graph.toProjectCheckpoint(projectName);

    const live = new ProjectGraph();
    const liveAgent = live.createCustomAgent('Looper');
    live.setSessionLoop(makeLoop(liveAgent.id, 'sub-a', { command: 'live one', completed: 1 }));
    live.setSessionLoop(makeLoop(liveAgent.id, 'sub-c', { command: 'only live' }));
    live.mergeFromCheckpoint(cp);

    expect(live.getSessionLoop('sub-a')?.command).toBe('live one'); // 덮이지 않음
    expect(live.getSessionLoop('sub-c')?.command).toBe('only live');
  });

  it('§5.5 #17-11 ⑪·⑫ — 컨텍스트 처리·예산·규약 설정이 디스크를 왕복해도 살아남는다', () => {
    const { graph, projectName } = seededGraph();
    const agent = graph.createCustomAgent('Looper', undefined, projectName);
    graph.setSessionLoop(makeLoop(agent.id, 'sub-a', {
      contextMode: 'clear',
      maxCostUsd: 5, maxTokens: 200_000, maxDurationMs: 3_600_000,
      spentCostUsd: 1.25, spentTokens: 42_000, cycleStartedAt: 1_700_000_000_000,
      progressFile: 'PROGRESS.md', oneTaskPerRound: true, commitEachRound: true, commandFile: 'PROMPT.md',
    }));

    const cp = graph.toProjectCheckpoint(projectName);
    expect(cp.sessionLoops?.['sub-a']?.contextMode).toBe('clear');
    expect(cp.sessionLoops?.['sub-a']?.maxCostUsd).toBe(5);

    const revived = new ProjectGraph();
    revived.restoreFromCheckpoint(cp);
    const loop = revived.getSessionLoop('sub-a');
    expect(loop?.contextMode).toBe('clear');
    expect(loop?.maxTokens).toBe(200_000);
    expect(loop?.maxDurationMs).toBe(3_600_000);
    // 누적도 이어진다 — 재시작했다고 예산이 리셋되면 상한이 의미를 잃는다.
    expect(loop?.spentCostUsd).toBe(1.25);
    expect(loop?.spentTokens).toBe(42_000);
    expect(loop?.cycleStartedAt).toBe(1_700_000_000_000);
    expect(loop?.progressFile).toBe('PROGRESS.md');
    expect(loop?.commandFile).toBe('PROMPT.md');
    expect(loop?.oneTaskPerRound).toBe(true);
    expect(loop?.commitEachRound).toBe(true);
  });

  it('§5.5 #17-11 ⑪ — 정리 대조 id 는 복원 시 비운다(죽은 압축을 영원히 기다리지 않는다)', () => {
    const { graph, projectName } = seededGraph();
    const agent = graph.createCustomAgent('Looper', undefined, projectName);
    graph.setSessionLoop(makeLoop(agent.id, 'sub-a', {
      contextMode: 'compact', status: 'running', pendingCompactCommandId: 'cmd-dead-compact', completed: 2,
    }));

    const revived = new ProjectGraph();
    revived.restoreFromCheckpoint(graph.toProjectCheckpoint(projectName));
    const loop = revived.getSessionLoop('sub-a');
    expect(loop?.completed).toBe(2);
    expect(loop?.status).toBe('waiting');
    expect(loop?.pendingCompactCommandId).toBeUndefined();
  });

  it('§5.5 #17-11 ⑫ — 새 필드가 없는 구버전 체크포인트는 전부 꺼짐으로 복원된다', () => {
    const { graph, projectName } = seededGraph();
    const agent = graph.createCustomAgent('Looper', undefined, projectName);
    graph.setSessionLoop(makeLoop(agent.id, 'sub-a'));
    const cp = graph.toProjectCheckpoint(projectName);
    // 구버전 디스크 포맷 재현 — 필드 자체가 없다.
    const raw = cp.sessionLoops!['sub-a'] as Partial<SessionLoop>;
    delete raw.contextMode;
    delete raw.spentCostUsd;
    delete raw.spentTokens;
    delete raw.oneTaskPerRound;
    delete raw.commitEachRound;

    const revived = new ProjectGraph();
    revived.restoreFromCheckpoint(cp);
    const loop = revived.getSessionLoop('sub-a');
    expect(loop?.contextMode).toBe('none');
    expect(loop?.spentCostUsd).toBe(0);
    expect(loop?.spentTokens).toBe(0);
    expect(loop?.oneTaskPerRound).toBe(false);
    expect(loop?.commitEachRound).toBe(false);
  });

  it('§5.5 #17-11 ⑫(b) — 잠깐 쓰였던 `autoCompact:true` 는 `contextMode:"compact"` 로 승계된다', () => {
    const { graph, projectName } = seededGraph();
    const agent = graph.createCustomAgent('Looper', undefined, projectName);
    graph.setSessionLoop(makeLoop(agent.id, 'sub-a'));
    const cp = graph.toProjectCheckpoint(projectName);
    // 직전 형태 재현 — contextMode 는 없고 autoCompact 만 있다.
    const raw = cp.sessionLoops!['sub-a'] as Partial<SessionLoop> & { autoCompact?: boolean };
    delete raw.contextMode;
    raw.autoCompact = true;

    const revived = new ProjectGraph();
    revived.restoreFromCheckpoint(cp);
    const loop = revived.getSessionLoop('sub-a') as (SessionLoop & { autoCompact?: boolean }) | undefined;
    expect(loop?.contextMode).toBe('compact');
    // 낡은 필드는 남기지 않는다 — 두 개가 공존하면 다음 사람이 어느 쪽을 믿을지 모른다.
    expect(loop?.autoCompact).toBeUndefined();
  });

  it('에이전트를 지우면 그 에이전트의 루프도 함께 사라진다(좀비 루프 차단)', () => {
    const graph = new ProjectGraph();
    const a = graph.createCustomAgent('A');
    const b = graph.createCustomAgent('B');
    graph.setSessionLoop(makeLoop(a.id, 'sub-a1'));
    graph.setSessionLoop(makeLoop(a.id, 'sub-a2'));
    graph.setSessionLoop(makeLoop(b.id, 'sub-b1'));

    expect(graph.deleteSessionLoopsForAgent(a.id).sort()).toEqual(['sub-a1', 'sub-a2']);
    expect(graph.getSessionLoop('sub-a1')).toBeUndefined();
    expect(graph.getSessionLoop('sub-b1')).toBeDefined();
  });
});
