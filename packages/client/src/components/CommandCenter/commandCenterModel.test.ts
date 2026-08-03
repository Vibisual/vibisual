import { describe, it, expect } from 'vitest';
import type {
  AgentQuestions,
  AgentReport,
  AgentReview,
  BubbleData,
  PermissionRequest,
  QueuedCommand,
  SubAgent,
} from '@vibisual/shared';
import {
  buildCommandCenterItems,
  parseCommandCenterQuery,
  filterCommandCenterItems,
  sortCommandCenterItems,
  isAutoTidyTarget,
  groupByLane,
  contextLevel,
  isEmptyQuery,
  elapsedParts,
  type CommandCenterInput,
  type CommandCenterItem,
} from './commandCenterModel.js';

// SCENARIO.md §5.12 — 레인 우선순위·검색·정리는 전부 순수 함수라 컴포넌트 없이 고정한다.

const NOW = 1_700_000_000_000;

function agent(id: string, label: string, over: Partial<BubbleData> = {}): BubbleData {
  return {
    id,
    label,
    bubbleType: 'agent',
    path: `session-${id}`,
    status: 'idle',
    activity: 0,
    lastActivity: NOW - 1000,
    customCreated: true,
    ...over,
  } as BubbleData;
}

function sub(id: string, parentAgentId: string, over: Partial<SubAgent> = {}): SubAgent {
  return {
    id,
    sessionId: `sess-${id}`,
    label: id,
    parentAgentId,
    status: 'idle',
    createdAt: NOW - 100_000,
    lastActivityAt: NOW - 5_000,
    ...over,
  };
}

/** 정렬·자동정리처럼 항목만 필요한 테스트용 — 픽스처도 타입체크를 받게 한다(v4.41 교훈). */
function item(over: Partial<CommandCenterItem> = {}): CommandCenterItem {
  return {
    key: 'a1::main',
    agentId: 'a1',
    agentLabel: 'Alpha',
    agentColor: '#60a5fa',
    subAgentId: null,
    sessionLabel: 'Alpha',
    lane: 'done',
    laneReason: '',
    waitingSince: null,
    status: 'idle',
    lastTool: undefined,
    lastActivityAt: NOW,
    contextUsed: undefined,
    contextMax: undefined,
    queuedCount: 0,
    runningTaskCount: 0,
    unacknowledged: false,
    questionPrompts: [],
    searchText: '',
    ...over,
  };
}

function baseInput(over: Partial<CommandCenterInput> = {}): CommandCenterInput {
  return {
    projectId: 'proj',
    agents: [],
    agentProjects: {},
    agentConfigs: {},
    subAgents: {},
    queuedCommands: {},
    runningSubagentTasks: {},
    agentQuestions: {},
    agentReviews: {},
    agentReports: {},
    pendingPermissions: {},
    acknowledgedSubAgents: {},
    ...over,
  };
}

describe('buildCommandCenterItems — 프로젝트 필터', () => {
  it('다른 프로젝트의 에이전트는 담지 않는다', () => {
    const items = buildCommandCenterItems(
      baseInput({
        agents: [agent('a1', 'Alpha'), agent('a2', 'Beta')],
        agentProjects: { a1: 'proj', a2: 'other' },
      }),
    );
    expect(items.map((i) => i.agentId)).toEqual(['a1']);
  });

  it('휴지통에 들어간 에이전트는 제외한다', () => {
    const items = buildCommandCenterItems(
      baseInput({
        agents: [agent('a1', 'Alpha', { trashed: true })],
        agentProjects: { a1: 'proj' },
      }),
    );
    expect(items).toHaveLength(0);
  });

  it('메인 세션 1건 + 서브 세션 N건으로 펼친다', () => {
    const items = buildCommandCenterItems(
      baseInput({
        agents: [agent('a1', 'Alpha')],
        agentProjects: { a1: 'proj' },
        subAgents: { a1: [sub('s1', 'a1'), sub('s2', 'a1')] },
      }),
    );
    expect(items.map((i) => i.subAgentId)).toEqual([null, 's1', 's2']);
    expect(items[0]?.key).toBe('a1::main');
    expect(items[1]?.key).toBe('a1::s1');
  });
});

describe('레인 우선순위 — 위쪽이 이긴다', () => {
  const agents = [agent('a1', 'Alpha', { status: 'active' })];
  const agentProjects = { a1: 'proj' };

  it('작업 중이어도 질문이 있으면 needs-answer', () => {
    const questions: AgentQuestions[] = [
      { id: 'q1', agentId: 'a1', items: [{ question: '어느 쪽으로 갈까요?', prompts: ['A 로'] }], createdAt: NOW - 3000 },
    ];
    const items = buildCommandCenterItems(baseInput({ agents, agentProjects, agentQuestions: { a1: questions } }));
    expect(items[0]?.lane).toBe('needs-answer');
    expect(items[0]?.waitingSince).toBe(NOW - 3000);
    expect(items[0]?.questionPrompts).toEqual(['A 로']);
  });

  it('권한 대기가 질문보다 앞선다', () => {
    const permission: PermissionRequest = {
      requestId: 'r1',
      agentId: 'a1',
      agentLabel: 'Alpha',
      agentColor: '#fff',
      projectName: 'proj',
      toolName: 'Bash',
      toolInput: {},
      createdAt: NOW - 500,
      expiresAt: NOW + 60_000,
    };
    const questions: AgentQuestions[] = [
      { id: 'q1', agentId: 'a1', items: [{ question: 'Q', prompts: [] }], createdAt: NOW - 3000 },
    ];
    const items = buildCommandCenterItems(
      baseInput({ agents, agentProjects, agentQuestions: { a1: questions }, pendingPermissions: { r1: permission } }),
    );
    expect(items[0]?.lane).toBe('needs-answer');
    expect(items[0]?.laneReason).toBe('Bash');
  });

  it('검수 카드는 needs-review, 작업 신고보다 앞선다', () => {
    const reviews: AgentReview[] = [
      { id: 'v1', agentId: 'a1', changes: ['버튼 핸들러 수정'], checkpoints: ['눌러보기'], createdAt: NOW - 2000 },
    ];
    const reports: AgentReport[] = [
      { id: 'p1', agentId: 'a1', did: ['고침'], userActions: ['빌드 실행'], createdAt: NOW - 1000 },
    ];
    const items = buildCommandCenterItems(
      baseInput({ agents, agentProjects, agentReviews: { a1: reviews }, agentReports: { a1: reports } }),
    );
    expect(items[0]?.lane).toBe('needs-review');
  });

  it('userActions 가 있는 신고만 needs-action 으로 올린다', () => {
    const empty: AgentReport[] = [{ id: 'p1', agentId: 'a1', did: ['고침'], userActions: [], createdAt: NOW - 1000 }];
    const items = buildCommandCenterItems(baseInput({ agents, agentProjects, agentReports: { a1: empty } }));
    expect(items[0]?.lane).toBe('working'); // status active 라 working 으로 떨어진다
  });

  it('대기 명령만 있어도 working 이다', () => {
    const queued: QueuedCommand[] = [
      { id: 'c1', text: '테스트 돌려줘', timestamp: NOW - 100, subAgentId: null, status: 'queued' },
    ];
    const idle = [agent('a1', 'Alpha', { status: 'idle' })];
    const items = buildCommandCenterItems(baseInput({ agents: idle, agentProjects, queuedCommands: { a1: queued } }));
    expect(items[0]?.lane).toBe('working');
    expect(items[0]?.queuedCount).toBe(1);
  });

  it('아무 근거도 없으면 done 이고, 미확인 완료는 표시된다', () => {
    const done = [agent('a1', 'Alpha', { status: 'idle' })];
    const items = buildCommandCenterItems(
      baseInput({
        agents: done,
        agentProjects,
        subAgents: { a1: [sub('s1', 'a1', { status: 'completed', lastResult: '작업 끝' })] },
      }),
    );
    const subItem = items.find((i) => i.subAgentId === 's1');
    expect(subItem?.lane).toBe('done');
    expect(subItem?.unacknowledged).toBe(true);
    expect(subItem?.laneReason).toBe('작업 끝');
  });

  it('확인한 완료는 강조하지 않는다', () => {
    const items = buildCommandCenterItems(
      baseInput({
        agents: [agent('a1', 'Alpha', { status: 'idle' })],
        agentProjects,
        subAgents: { a1: [sub('s1', 'a1', { status: 'completed' })] },
        acknowledgedSubAgents: { s1: true },
      }),
    );
    expect(items.find((i) => i.subAgentId === 's1')?.unacknowledged).toBe(false);
  });
});

describe('카드의 subAgentId 귀속', () => {
  it('subAgentId 가 없는 카드는 메인 세션에 붙는다', () => {
    const items = buildCommandCenterItems(
      baseInput({
        agents: [agent('a1', 'Alpha')],
        agentProjects: { a1: 'proj' },
        subAgents: { a1: [sub('s1', 'a1')] },
        agentReviews: { a1: [{ id: 'v1', agentId: 'a1', changes: ['x'], checkpoints: [], createdAt: NOW }] },
      }),
    );
    expect(items.find((i) => i.subAgentId === null)?.lane).toBe('needs-review');
    expect(items.find((i) => i.subAgentId === 's1')?.lane).toBe('done');
  });

  it('subAgentId 가 있는 카드는 그 세션에만 붙는다', () => {
    const items = buildCommandCenterItems(
      baseInput({
        agents: [agent('a1', 'Alpha')],
        agentProjects: { a1: 'proj' },
        subAgents: { a1: [sub('s1', 'a1')] },
        agentReviews: {
          a1: [{ id: 'v1', agentId: 'a1', subAgentId: 's1', changes: ['x'], checkpoints: [], createdAt: NOW }],
        },
      }),
    );
    expect(items.find((i) => i.subAgentId === null)?.lane).toBe('done');
    expect(items.find((i) => i.subAgentId === 's1')?.lane).toBe('needs-review');
  });

  it('같은 세션에 카드가 여러 장이면 가장 최근 것을 쓴다', () => {
    const items = buildCommandCenterItems(
      baseInput({
        agents: [agent('a1', 'Alpha')],
        agentProjects: { a1: 'proj' },
        agentReviews: {
          a1: [
            { id: 'v1', agentId: 'a1', changes: ['옛것'], checkpoints: [], createdAt: NOW - 10_000 },
            { id: 'v2', agentId: 'a1', changes: ['새것'], checkpoints: [], createdAt: NOW - 100 },
          ],
        },
      }),
    );
    expect(items[0]?.laneReason).toBe('새것');
  });
});

describe('검색', () => {
  const items = buildCommandCenterItems(
    baseInput({
      agents: [agent('a1', 'Alpha', { status: 'active', lastTool: 'Bash' }), agent('a2', 'Beta', { status: 'idle' })],
      agentProjects: { a1: 'proj', a2: 'proj' },
      agentReviews: { a2: [{ id: 'v1', agentId: 'a2', changes: ['라우터 정리'], checkpoints: [], createdAt: NOW }] },
    }),
  );

  it('빈 질의는 전체를 통과시킨다', () => {
    const q = parseCommandCenterQuery('   ');
    expect(isEmptyQuery(q)).toBe(true);
    expect(filterCommandCenterItems(items, q)).toHaveLength(2);
  });

  it('자유 문자열은 카드 본문까지 훑는다', () => {
    const out = filterCommandCenterItems(items, parseCommandCenterQuery('라우터'));
    expect(out.map((i) => i.agentId)).toEqual(['a2']);
  });

  it('is: / needs: 토큰이 레인을 좁힌다', () => {
    expect(filterCommandCenterItems(items, parseCommandCenterQuery('is:working')).map((i) => i.agentId)).toEqual(['a1']);
    expect(filterCommandCenterItems(items, parseCommandCenterQuery('needs:review')).map((i) => i.agentId)).toEqual(['a2']);
  });

  it('agent: / tool: 토큰이 AND 로 걸린다', () => {
    expect(filterCommandCenterItems(items, parseCommandCenterQuery('agent:alpha')).map((i) => i.agentId)).toEqual(['a1']);
    expect(filterCommandCenterItems(items, parseCommandCenterQuery('tool:bash')).map((i) => i.agentId)).toEqual(['a1']);
    expect(filterCommandCenterItems(items, parseCommandCenterQuery('agent:alpha needs:review'))).toHaveLength(0);
  });

  it('토큰은 대소문자를 가리지 않는다', () => {
    expect(filterCommandCenterItems(items, parseCommandCenterQuery('IS:WORKING'))).toHaveLength(1);
  });
});

describe('정렬', () => {
  const a = item({ key: 'a', lastActivityAt: 100, waitingSince: 50, contextUsed: 10, contextMax: 100 });
  const b = item({ key: 'b', lastActivityAt: 300, waitingSince: 10, contextUsed: 95, contextMax: 100 });
  const list = [a, b];

  it('recent = 마지막 활동 최신순', () => {
    expect(sortCommandCenterItems(list, 'recent').map((i) => i.key)).toEqual(['b', 'a']);
  });

  it('waiting = 오래 기다린 순', () => {
    expect(sortCommandCenterItems(list, 'waiting').map((i) => i.key)).toEqual(['b', 'a']);
  });

  it('context = 잔량이 적은 순', () => {
    expect(sortCommandCenterItems(list, 'context').map((i) => i.key)).toEqual(['b', 'a']);
  });

  it('원본 배열을 건드리지 않는다', () => {
    sortCommandCenterItems(list, 'context');
    expect(list.map((i) => i.key)).toEqual(['a', 'b']);
  });
});

describe('자동 정리 — 표시 접기 전용', () => {
  const base = item({ lane: 'done', unacknowledged: false, lastActivityAt: NOW - 60 * 60_000 });

  it('문턱을 넘긴 유휴 done 세션만 대상', () => {
    expect(isAutoTidyTarget(base, NOW, 30)).toBe(true);
    expect(isAutoTidyTarget(base, NOW, 180)).toBe(false);
  });

  it('미확인 완료는 절대 접지 않는다', () => {
    expect(isAutoTidyTarget({ ...base, unacknowledged: true }, NOW, 10)).toBe(false);
  });

  it('done 이 아닌 레인은 대상이 아니다', () => {
    expect(isAutoTidyTarget({ ...base, lane: 'working' }, NOW, 10)).toBe(false);
  });
});

describe('보조', () => {
  it('groupByLane 은 비어 있는 레인도 키를 가진다', () => {
    const grouped = groupByLane([]);
    expect(Object.keys(grouped)).toEqual(['needs-answer', 'needs-review', 'needs-action', 'working', 'done']);
  });

  it('elapsedParts 는 분/시/일로 접는다', () => {
    expect(elapsedParts(30_000)).toEqual({ unit: 'now', value: 0 });
    expect(elapsedParts(5 * 60_000)).toEqual({ unit: 'min', value: 5 });
    expect(elapsedParts(3 * 60 * 60_000)).toEqual({ unit: 'hour', value: 3 });
    expect(elapsedParts(50 * 60 * 60_000)).toEqual({ unit: 'day', value: 2 });
    expect(elapsedParts(-1000)).toEqual({ unit: 'now', value: 0 });
  });

  it('contextLevel 은 80/92% 를 경계로 단계를 올린다', () => {
    expect(contextLevel(undefined, 100)).toBeNull();
    expect(contextLevel(10, undefined)).toBeNull();
    expect(contextLevel(50, 100)?.level).toBe('ok');
    expect(contextLevel(85, 100)?.level).toBe('warn');
    expect(contextLevel(95, 100)?.level).toBe('critical');
  });
});
