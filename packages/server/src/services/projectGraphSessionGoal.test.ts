import { describe, it, expect, vi } from 'vitest';

// §4 (설정 3층) — 에이전트 설정이 이제 전역 옵션 위에서 해소되므로, 이 파일이 실제
//   `~/.vibisual/user-defaults.json`(사용자 기기마다 다르다)을 읽으면 도구 단언이 기기에 따라
//   갈린다. 여기서는 "전역 기본값이 비어 있는" 상태를 고정한다.
vi.mock('./userDefaultsService.js', () => ({
  userDefaultsService: { get: () => ({ updatedAt: 1 }), subscribe: () => () => {} },
}));

const { ProjectGraph } = await import('./projectGraph.js');

/**
 * §5.5 #17-17 v4.46 — 세션 목표(Goal) 회귀 테스트.
 *
 * 조용히 깨지는 자리가 둘이다:
 *  (1) **영속화** — `getSnapshot` 에만 넣고 디스크 포맷인 `toProjectCheckpoint` 를 빠뜨리면
 *      화면엔 보이다가 껐다 켜면 목표가 사라진다(§3.2 v1.59/v2.55 재발 자리).
 *  (2) **출처 우선순위(③)** — 에이전트가 신고를 시작한 뒤에도 계획 폴백(plan)이 퍼센트를 덮으면
 *      사용자가 보는 숫자가 제멋대로 오르내린다. 목표 문장을 바꿨을 때는 반대로 폴백이 **다시**
 *      열려야 한다(새 목표엔 아직 아무도 신고한 적이 없으므로).
 */

function seededGraph(): { graph: InstanceType<typeof ProjectGraph>; projectName: string } {
  const graph = new ProjectGraph();
  const projectName = graph.registerProject(process.cwd()).name;
  return { graph, projectName };
}

describe('ProjectGraph — 세션 목표(Goal)', () => {
  it('저장·조회·삭제가 세션(subAgentId) 단위로 동작한다', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Goalie');

    graph.setSessionGoal({ agentId: agent.id, subAgentId: 'sub-a', text: '로그인 화면 완성' });
    graph.setSessionGoal({ agentId: agent.id, subAgentId: 'sub-b', text: '테스트 커버리지 80%' });

    expect(graph.getSessionGoal('sub-a')?.text).toBe('로그인 화면 완성');
    expect(graph.getSessionGoal('sub-b')?.text).toBe('테스트 커버리지 80%');
    expect(graph.getSessionGoalsForAgent(agent.id)).toHaveLength(2);

    expect(graph.deleteSessionGoal('sub-a')).toBe(true);
    expect(graph.getSessionGoal('sub-a')).toBeUndefined();
    expect(graph.deleteSessionGoal('sub-a')).toBe(false);
  });

  it('목표 문장을 고쳐도 진행률·이력은 보존되고 revision 만 오른다', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Goalie');
    graph.setSessionGoal({ agentId: agent.id, subAgentId: 'sub-a', text: '1차 목표' });
    graph.noteSessionGoalProgress('sub-a', { percent: 40, note: 'A 끝', source: 'agent' });

    const edited = graph.setSessionGoal({ agentId: agent.id, subAgentId: 'sub-a', text: '2차 목표' });
    expect(edited.percent).toBe(40);        // 문장을 다듬는 것과 진행을 되감는 것은 다른 일
    expect(edited.history).toHaveLength(1);
    expect(edited.revision).toBe(1);

    // 같은 문장으로 다시 저장하면 revision 은 그대로(상태만 바꾸는 저장이 카운터를 올리지 않게).
    const resaved = graph.setSessionGoal({ agentId: agent.id, subAgentId: 'sub-a', text: '2차 목표', status: 'achieved' });
    expect(resaved.revision).toBe(1);
    expect(resaved.status).toBe('achieved');
  });

  it('퍼센트는 0~100 정수로 조여지고 이력에 출처가 남는다', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Goalie');
    graph.setSessionGoal({ agentId: agent.id, subAgentId: 'sub-a', text: '목표' });

    expect(graph.noteSessionGoalProgress('sub-a', { percent: 142.6, source: 'agent' })?.percent).toBe(100);
    expect(graph.noteSessionGoalProgress('sub-a', { percent: -5, source: 'user' })?.percent).toBe(0);
    expect(graph.noteSessionGoalProgress('sub-a', { percent: 33.4, source: 'user' })?.percent).toBe(33);

    const goal = graph.getSessionGoal('sub-a');
    expect(goal?.history.map((h) => h.source)).toEqual(['agent', 'user', 'user']);
  });

  it('명시 신고가 오면 계획(plan) 폴백은 더 이상 퍼센트를 덮지 않는다', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Goalie');
    graph.setSessionGoal({ agentId: agent.id, subAgentId: 'sub-a', text: '목표' });

    // 아직 아무 신고도 없으면 계획이 채운다.
    expect(graph.noteSessionGoalProgress('sub-a', { percent: 25, source: 'plan' })?.percent).toBe(25);
    // 같은 값의 계획 갱신은 이력만 늘리므로 무시.
    expect(graph.noteSessionGoalProgress('sub-a', { percent: 25, source: 'plan' })).toBeUndefined();

    // 에이전트가 신고를 시작하면 그 뒤 계획은 무시된다.
    expect(graph.noteSessionGoalProgress('sub-a', { percent: 60, source: 'agent' })?.percent).toBe(60);
    expect(graph.noteSessionGoalProgress('sub-a', { percent: 30, source: 'plan' })).toBeUndefined();
    expect(graph.getSessionGoal('sub-a')?.percent).toBe(60);
  });

  it('목표 문장을 바꾸면 계획 폴백이 다시 열린다', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Goalie');
    graph.setSessionGoal({ agentId: agent.id, subAgentId: 'sub-a', text: '1차 목표' });
    graph.noteSessionGoalProgress('sub-a', { percent: 70, source: 'agent' });
    expect(graph.noteSessionGoalProgress('sub-a', { percent: 10, source: 'plan' })).toBeUndefined();

    graph.setSessionGoal({ agentId: agent.id, subAgentId: 'sub-a', text: '완전히 다른 목표' });
    // 새 목표엔 아직 아무도 신고한 적이 없으므로 계획이 다시 채울 수 있다.
    expect(graph.noteSessionGoalProgress('sub-a', { percent: 10, source: 'plan' })?.percent).toBe(10);
  });

  it('세션이 계획을 세우는 순간 목표가 자동으로 생긴다(사용자 입력 ❌)', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Worker');
    expect(graph.getSessionGoal('sub-a')).toBeUndefined();

    graph.syncSessionGoalFromPlan('sub-a', {
      agentId: agent.id,
      command: '로그인 화면 만들어줘',
      steps: [
        { text: '스키마 정의', status: 'done' },
        { text: '서버 배선', status: 'in_progress' },
        { text: '화면 연결', status: 'pending' },
        { text: '테스트', status: 'pending' },
      ],
    });

    const goal = graph.getSessionGoal('sub-a');
    expect(goal?.text).toBe('로그인 화면 만들어줘');   // 목표 문장 = 그 세션이 받은 명령
    expect(goal?.authoredBy).toBe('session');
    expect(goal?.steps).toHaveLength(4);
    expect(goal?.percent).toBe(25);
    expect(goal?.status).toBe('active');
  });

  it('세션이 새 명령을 받으면 목표가 새 것으로 갈아탄다(옛 단계는 안 끌고 온다)', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Worker');
    graph.syncSessionGoalFromPlan('sub-a', {
      agentId: agent.id,
      command: '첫 번째 일',
      steps: [{ text: 'A', status: 'done' }, { text: 'B', status: 'done' }],
    });
    expect(graph.getSessionGoal('sub-a')?.percent).toBe(100);

    graph.syncSessionGoalFromPlan('sub-a', {
      agentId: agent.id,
      command: '두 번째 일',
      steps: [{ text: 'C', status: 'pending' }, { text: 'D', status: 'pending' }],
    });
    const goal = graph.getSessionGoal('sub-a');
    expect(goal?.text).toBe('두 번째 일');
    expect(goal?.steps.map((s) => s.text)).toEqual(['C', 'D']);   // 옛 단계 잔류 ❌
    expect(goal?.percent).toBe(0);
  });

  it('사용자가 문장을 고치면 세션이 덮어쓰지 않는다', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Worker');
    graph.syncSessionGoalFromPlan('sub-a', {
      agentId: agent.id, command: '첫 번째 일', steps: [{ text: 'A', status: 'pending' }],
    });
    // 사용자가 방향을 손본다 → 주인이 바뀐다.
    graph.setSessionGoal({ agentId: agent.id, subAgentId: 'sub-a', text: '내가 정한 진짜 목표', authoredBy: 'user' });
    expect(graph.getSessionGoal('sub-a')?.authoredBy).toBe('user');

    // 새 명령이 와도 문장은 그대로, 체크리스트만 따라간다.
    graph.syncSessionGoalFromPlan('sub-a', {
      agentId: agent.id, command: '두 번째 일', steps: [{ text: 'B', status: 'done' }],
    });
    const goal = graph.getSessionGoal('sub-a');
    expect(goal?.text).toBe('내가 정한 진짜 목표');
    expect(goal?.steps.map((s) => s.text)).toEqual(['B']);

    // 에이전트의 명시 목표 신고도 사용자 문장을 못 덮는다.
    graph.noteSessionGoalProgress('sub-a', { goal: '에이전트가 바꾼 문장', source: 'agent' });
    expect(graph.getSessionGoal('sub-a')?.text).toBe('내가 정한 진짜 목표');
  });

  it('세션이 쓴 목표는 에이전트가 스스로 다듬을 수 있다', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Worker');
    graph.syncSessionGoalFromPlan('sub-a', {
      agentId: agent.id, command: '대충 적은 명령', steps: [{ text: 'A', status: 'pending' }],
    });
    const updated = graph.noteSessionGoalProgress('sub-a', {
      goal: '로그인 화면을 테스트까지 붙여 끝낸다',
      source: 'agent',
    });
    expect(updated?.text).toBe('로그인 화면을 테스트까지 붙여 끝낸다');
    expect(updated?.authoredBy).toBe('session');
    expect(updated?.revision).toBe(1);
  });

  it('단계가 있으면 퍼센트는 체크리스트에서만 나온다(done/전체)', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Goalie');
    graph.setSessionGoal({ agentId: agent.id, subAgentId: 'sub-a', text: '로그인 화면 완성' });

    graph.noteSessionGoalProgress('sub-a', {
      steps: [
        { text: '스키마', status: 'done' },
        { text: '서버', status: 'in_progress' },
        { text: '화면', status: 'pending' },
        { text: '테스트', status: 'pending' },
      ],
      source: 'agent',
    });
    expect(graph.getSessionGoal('sub-a')?.percent).toBe(25);

    // 숫자만 보내는 신고는 단계가 있는 동안 퍼센트를 못 건드린다.
    graph.noteSessionGoalProgress('sub-a', { percent: 90, source: 'agent' });
    expect(graph.getSessionGoal('sub-a')?.percent).toBe(25);

    // 계획(TodoWrite) 폴백도 마찬가지.
    expect(graph.noteSessionGoalProgress('sub-a', { percent: 80, source: 'plan' })).toBeUndefined();

    // 한 단계 더 체크하면 퍼센트가 오른다 — 사용자가 보는 상승은 오직 이 경로다.
    const cur = graph.getSessionGoal('sub-a')!;
    graph.noteSessionGoalProgress('sub-a', {
      steps: cur.steps.map((s) => ({ text: s.text, status: s.text === '서버' ? 'done' as const : s.status })),
      source: 'user',
    });
    expect(graph.getSessionGoal('sub-a')?.percent).toBe(50);

    // 전부 체크하면 100%.
    const cur2 = graph.getSessionGoal('sub-a')!;
    graph.noteSessionGoalProgress('sub-a', {
      steps: cur2.steps.map((s) => ({ text: s.text, status: 'done' as const })),
      source: 'agent',
    });
    expect(graph.getSessionGoal('sub-a')?.percent).toBe(100);
  });

  it('같은 본문의 단계는 id 를 이어받는다(목록을 다시 보내도 화면이 튀지 않게)', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Goalie');
    graph.setSessionGoal({ agentId: agent.id, subAgentId: 'sub-a', text: '목표' });
    graph.noteSessionGoalProgress('sub-a', {
      steps: [{ text: 'A', status: 'pending' }, { text: 'B', status: 'pending' }],
      source: 'agent',
    });
    const first = graph.getSessionGoal('sub-a')!.steps.map((s) => s.id);

    // 에이전트가 같은 목록을 상태만 바꿔 다시 보낸다 + 새 단계 하나 추가.
    graph.noteSessionGoalProgress('sub-a', {
      steps: [{ text: 'A', status: 'done' }, { text: 'B', status: 'in_progress' }, { text: 'C', status: 'pending' }],
      source: 'agent',
    });
    const after = graph.getSessionGoal('sub-a')!.steps;
    expect(after.slice(0, 2).map((s) => s.id)).toEqual(first);   // 기존 두 항목은 같은 id
    expect(after[2]?.id).not.toBe(first[0]);                     // 새 항목만 새 id
    expect(after.map((s) => s.status)).toEqual(['done', 'in_progress', 'pending']);
  });

  it('바뀐 게 없는 단계 신고는 이력을 늘리지 않는다', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Goalie');
    graph.setSessionGoal({ agentId: agent.id, subAgentId: 'sub-a', text: '목표' });
    const steps = [{ text: 'A', status: 'done' as const }, { text: 'B', status: 'pending' as const }];
    graph.noteSessionGoalProgress('sub-a', { steps, source: 'agent' });
    expect(graph.getSessionGoal('sub-a')?.history).toHaveLength(1);

    expect(graph.noteSessionGoalProgress('sub-a', { steps, source: 'agent' })).toBeUndefined();
    expect(graph.getSessionGoal('sub-a')?.history).toHaveLength(1);
  });

  it('스냅샷과 프로젝트 체크포인트(디스크 포맷) 양쪽에 실리고 그대로 복원된다', () => {
    const { graph, projectName } = seededGraph();
    const agent = graph.createCustomAgent('Goalie', undefined, projectName);
    graph.setSessionGoal({ agentId: agent.id, subAgentId: 'sub-a', text: '목표' });
    graph.noteSessionGoalProgress('sub-a', { percent: 45, note: 'A·B 끝', source: 'agent' });

    expect(graph.getSnapshot().sessionGoals?.['sub-a']?.percent).toBe(45);

    const cp = graph.toProjectCheckpoint(projectName);
    // 여기 빠지면 "화면엔 보이는데 껐다 켜면 사라지는" 고전적 결함이 된다.
    expect(cp.sessionGoals?.['sub-a']?.percent).toBe(45);
    expect(graph.toCheckpoint().sessionGoals?.['sub-a']).toBeDefined();

    const revived = new ProjectGraph();
    revived.restoreFromCheckpoint(cp);
    const goal = revived.getSessionGoal('sub-a');
    expect(goal?.text).toBe('목표');
    expect(goal?.percent).toBe(45);
    expect(goal?.note).toBe('A·B 끝');
    expect(goal?.history).toHaveLength(1);
    expect(goal?.steps).toEqual([]);
  });

  it('단계 체크리스트도 체크포인트를 왕복하고, 구버전(steps 없음) 파일도 깨지지 않는다', () => {
    const { graph, projectName } = seededGraph();
    const agent = graph.createCustomAgent('Goalie', undefined, projectName);
    graph.setSessionGoal({ agentId: agent.id, subAgentId: 'sub-a', text: '목표' });
    graph.noteSessionGoalProgress('sub-a', {
      steps: [{ text: 'A', status: 'done' }, { text: 'B', status: 'pending' }],
      source: 'agent',
    });

    const cp = graph.toProjectCheckpoint(projectName);
    expect(cp.sessionGoals?.['sub-a']?.steps).toHaveLength(2);

    const revived = new ProjectGraph();
    revived.restoreFromCheckpoint(cp);
    expect(revived.getSessionGoal('sub-a')?.steps.map((s) => s.status)).toEqual(['done', 'pending']);
    expect(revived.getSessionGoal('sub-a')?.percent).toBe(50);

    // v4.46 판본(steps 필드 자체가 없는 체크포인트)도 그대로 열려야 한다.
    const legacyCp = JSON.parse(JSON.stringify(cp)) as typeof cp;
    delete (legacyCp.sessionGoals!['sub-a'] as { steps?: unknown }).steps;
    legacyCp.sessionGoals!['sub-a']!.percent = 45;
    const legacy = new ProjectGraph();
    legacy.restoreFromCheckpoint(legacyCp);
    expect(legacy.getSessionGoal('sub-a')?.steps).toEqual([]);
    expect(legacy.getSessionGoal('sub-a')?.percent).toBe(45);
  });

  it('병합은 메모리에 이미 있는(지금 향하는) 목표를 덮지 않는다', () => {
    const { graph, projectName } = seededGraph();
    const agent = graph.createCustomAgent('Goalie', undefined, projectName);
    graph.setSessionGoal({ agentId: agent.id, subAgentId: 'sub-a', text: 'from disk' });
    const cp = graph.toProjectCheckpoint(projectName);

    const live = new ProjectGraph();
    const liveAgent = live.createCustomAgent('Goalie');
    live.setSessionGoal({ agentId: liveAgent.id, subAgentId: 'sub-a', text: 'live one' });
    live.setSessionGoal({ agentId: liveAgent.id, subAgentId: 'sub-c', text: 'only live' });
    live.mergeFromCheckpoint(cp);

    expect(live.getSessionGoal('sub-a')?.text).toBe('live one');
    expect(live.getSessionGoal('sub-c')?.text).toBe('only live');
  });

  // ─── §5.5 #17-17 ⑨ v4.59 — 목표는 계획을 기다리지 않는다 ───
  //
  // v4.50 은 카드 출생을 `TodoWrite` 훅 하나에 묶었고, 스폰 세션에는 그 도구가 아예 없어서
  // (AVAILABLE_AGENT_TOOLS 누락 → `--tools` 에서 제외) 목표가 **한 번도 태어난 적이 없었다**.
  // 실측 279 세션 중 계획을 세운 세션 1개, 저장된 목표 0개. 아래는 그 회귀를 고정한다.

  it('명령이 발사되면 계획 없이도 목표 카드가 태어난다', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Goalie');

    const goal = graph.seedSessionGoalFromCommand('sub-a', { agentId: agent.id, command: '로그인 화면을 끝낸다' });
    expect(goal?.text).toBe('로그인 화면을 끝낸다');
    expect(goal?.authoredBy).toBe('session');
    expect(goal?.status).toBe('active');
    expect(goal?.steps).toEqual([]);
    expect(goal?.percent).toBe(0);

    // 같은 명령이 다시 와도 아무 일도 일어나지 않는다(이력·revision 을 더럽히지 않게).
    expect(graph.seedSessionGoalFromCommand('sub-a', { agentId: agent.id, command: '로그인 화면을 끝낸다' })).toBeUndefined();
  });

  it('명령으로 태어난 목표에 계획이 오면 단계가 붙고 퍼센트가 체크리스트에서 나온다', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Goalie');
    graph.seedSessionGoalFromCommand('sub-a', { agentId: agent.id, command: '로그인 화면을 끝낸다' });

    graph.syncSessionGoalFromPlan('sub-a', {
      agentId: agent.id,
      command: '로그인 화면을 끝낸다',
      steps: [{ text: '폼', status: 'done' }, { text: '검증', status: 'in_progress' }, { text: '테스트', status: 'pending' }],
    });

    const goal = graph.getSessionGoal('sub-a');
    expect(goal?.text).toBe('로그인 화면을 끝낸다'); // 명령으로 세운 문장이 계획 때문에 바뀌지 않는다
    expect(goal?.steps.map((s) => s.status)).toEqual(['done', 'in_progress', 'pending']);
    expect(goal?.percent).toBe(33);
  });

  it('새 명령은 새 목표로 갈아타며 옛 단계·퍼센트·메모를 물려받지 않는다', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Goalie');
    graph.seedSessionGoalFromCommand('sub-a', { agentId: agent.id, command: '첫 번째 일' });
    graph.noteSessionGoalProgress('sub-a', {
      steps: [{ text: 'A', status: 'done' }, { text: 'B', status: 'done' }],
      note: '거의 끝',
      source: 'agent',
    });
    expect(graph.getSessionGoal('sub-a')?.percent).toBe(100);

    const next = graph.seedSessionGoalFromCommand('sub-a', { agentId: agent.id, command: '두 번째 일' });
    expect(next?.text).toBe('두 번째 일');
    expect(next?.steps).toEqual([]);
    expect(next?.percent).toBe(0);   // 0% 여야 할 새 일이 100% 로 보이면 게이지가 거짓말을 한다
    expect(next?.note).toBeUndefined();
  });

  it('사용자가 고친 목표는 새 명령이 덮지 않는다', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Goalie');
    // 사용자가 직접 쓴 문장(authoredBy='user')
    graph.setSessionGoal({ agentId: agent.id, subAgentId: 'sub-a', text: '내가 정한 방향' });

    expect(graph.seedSessionGoalFromCommand('sub-a', { agentId: agent.id, command: '다른 명령' })).toBeUndefined();
    expect(graph.getSessionGoal('sub-a')?.text).toBe('내가 정한 방향');
  });

  it('판올림 전 설정에도 계획 도구가 백필돼 목표가 태어날 수 있다', () => {
    const { graph, projectName } = seededGraph();
    const agent = graph.createCustomAgent('Goalie', undefined, projectName);
    // v4.59 이전 설정 — 화면에 체크박스가 없어서 TodoWrite 가 빠져 있다(사용자가 끈 것이 아니다).
    //   §4 (설정 3층) 이후로 그 모양은 **디스크에서만** 온다: 지금 창으로 저장하면 "직접 고른
    //   목록"이라는 세대 도장이 함께 찍히기 때문이다(그래서 setAgentConfig 로는 재현되지 않는다).
    const legacy = {
      ...graph.toProjectCheckpoint(projectName)!,
      agentConfigOverrides: undefined,
      agentConfigs: {
        [agent.id]: {
          model: 'opus',
          tools: ['Read', 'Write', 'Edit', 'Bash'],
          permissionMode: 'default',
          skills: [],
          maxTurns: 0,
        },
      },
    };

    const revived = new ProjectGraph();
    revived.restoreFromCheckpoint(legacy);
    const tools = revived.getAgentConfig(agent.id)?.tools ?? [];
    expect(tools).toContain('TodoWrite');
    expect(tools).toContain('Bash'); // 기존 선택은 그대로 보존
    expect(tools.filter((t) => t === 'TodoWrite')).toHaveLength(1); // 두 번 복원해도 중복되지 않는다

    const twice = new ProjectGraph();
    twice.restoreFromCheckpoint(revived.toProjectCheckpoint(projectName));
    expect((twice.getAgentConfig(agent.id)?.tools ?? []).filter((t) => t === 'TodoWrite')).toHaveLength(1);
  });

  it('빈 명령으로는 카드를 만들지 않는다', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Goalie');
    expect(graph.seedSessionGoalFromCommand('sub-a', { agentId: agent.id, command: '   ' })).toBeUndefined();
    expect(graph.getSessionGoal('sub-a')).toBeUndefined();
  });

  it('에이전트를 지우면 그 에이전트의 목표도 함께 사라진다(좀비 목표 차단)', () => {
    const graph = new ProjectGraph();
    const a = graph.createCustomAgent('A');
    const b = graph.createCustomAgent('B');
    graph.setSessionGoal({ agentId: a.id, subAgentId: 'sub-a1', text: 'x' });
    graph.setSessionGoal({ agentId: a.id, subAgentId: 'sub-a2', text: 'y' });
    graph.setSessionGoal({ agentId: b.id, subAgentId: 'sub-b1', text: 'z' });

    expect(graph.deleteSessionGoalsForAgent(a.id).sort()).toEqual(['sub-a1', 'sub-a2']);
    expect(graph.getSessionGoal('sub-a1')).toBeUndefined();
    expect(graph.getSessionGoal('sub-b1')).toBeDefined();
  });
});
