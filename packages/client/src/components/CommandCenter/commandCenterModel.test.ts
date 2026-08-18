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
  LANE_SETTLE_MS,
  buildCommandCenterItems,
  parseCommandCenterQuery,
  filterCommandCenterItems,
  sortCommandCenterItems,
  isAutoTidyTarget,
  groupByLane,
  contextLevel,
  isEmptyQuery,
  elapsedParts,
  activeLaneOf,
  flattenLanes,
  laneCounts,
  laneRank,
  stabilizeLanes,
  toggleLaneToken,
  waitingLevel,
  type CommandCenterInput,
  type CommandCenterItem,
  type LaneMemory,
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
    laneSince: 0,
    startedAt: 0,
    status: 'idle',
    lastTool: undefined,
    lastActivityAt: NOW,
    contextUsed: undefined,
    contextMax: undefined,
    queuedCount: 0,
    runningTaskCount: 0,
    unacknowledged: false,
    readOnly: false,
    questionPrompts: [],
    detail: {
      question: null,
      review: null,
      report: null,
      permission: null,
      queuedTexts: [],
      lastCommand: undefined,
      lastResult: undefined,
    },
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
    completedCommands: {},
    runningSubagentTasks: {},
    agentQuestions: {},
    agentReviews: {},
    agentReports: {},
    pendingPermissions: {},
    acknowledgedSubAgents: {},
    ...over,
  };
}

describe('훅 버블은 읽기 전용으로 표시된다 (§5.5 #17-29)', () => {
  it('customCreated 가 아닌 에이전트의 카드는 readOnly=true', () => {
    const items = buildCommandCenterItems(
      baseInput({
        agents: [agent('a1', 'Hook', { customCreated: false })],
        agentProjects: { a1: 'proj' },
        subAgents: { a1: [sub('s1', 'a1')] },
      }),
    );
    // 메인 탭과 세션 탭 **모두** 읽기 전용 — 세션 탭에서만 열리던 것이 #17-29 의 결함이었다.
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.readOnly)).toBe(true);
  });

  it('커스텀 에이전트의 카드는 readOnly=false', () => {
    const items = buildCommandCenterItems(
      baseInput({
        agents: [agent('a1', 'Alpha')],
        agentProjects: { a1: 'proj' },
        subAgents: { a1: [sub('s1', 'a1')] },
      }),
    );
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.readOnly)).toBe(false);
  });
});

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

describe('살아 있는 카드만 대기로 센다 (§5.12 (B) v4.55)', () => {
  // "지금 나를 기다리는가" 의 자 = IDE 스트림이 카드를 놓는 자리(`turnEndSortTs`).
  // 카드 뒤에 프롬프트가 있으면 그 카드는 스트림 중간으로 밀린 것 = 이미 답한 것.
  const agents = [agent('a1', 'Alpha', { status: 'idle' })];
  const agentProjects = { a1: 'proj' };
  const subAgents = { a1: [sub('s1', 'a1')] };

  const question = (createdAt: number, subAgentId?: string): AgentQuestions => ({
    id: `q${createdAt}`,
    agentId: 'a1',
    subAgentId,
    items: [{ question: '어느 쪽으로 갈까요?', prompts: ['A 로'] }],
    createdAt,
  });
  const prompt = (timestamp: number, status: QueuedCommand['status'] = 'completed'): QueuedCommand => ({
    id: `c${timestamp}`,
    text: 'A 로 가 주세요',
    timestamp,
    subAgentId: 's1',
    status,
  });

  it('질문 뒤에 프롬프트가 왔으면 답 대기가 아니다', () => {
    const items = buildCommandCenterItems(
      baseInput({
        agents,
        agentProjects,
        subAgents,
        agentQuestions: { a1: [question(NOW - 10_000, 's1')] },
        completedCommands: { a1: [prompt(NOW - 5_000)] },
      }),
    );
    const s1 = items.find((i) => i.subAgentId === 's1');
    expect(s1?.lane).toBe('done');
    expect(s1?.waitingSince).toBeNull();
    // 상세 패널도 지나간 카드를 들고 있지 않는다 — 레인과 근거가 어긋나면 안 된다.
    expect(s1?.detail.question).toBeNull();
  });

  it('프롬프트 뒤에 온 질문은 그대로 답 대기다', () => {
    const items = buildCommandCenterItems(
      baseInput({
        agents,
        agentProjects,
        subAgents,
        agentQuestions: { a1: [question(NOW - 1_000, 's1')] },
        completedCommands: { a1: [prompt(NOW - 5_000)] },
      }),
    );
    expect(items.find((i) => i.subAgentId === 's1')?.lane).toBe('needs-answer');
  });

  it('답한 뒤 새 질문이 오면 그 새 질문으로 다시 답 대기가 된다', () => {
    const items = buildCommandCenterItems(
      baseInput({
        agents,
        agentProjects,
        subAgents,
        agentQuestions: { a1: [question(NOW - 10_000, 's1'), question(NOW - 1_000, 's1')] },
        completedCommands: { a1: [prompt(NOW - 5_000)] },
      }),
    );
    const s1 = items.find((i) => i.subAgentId === 's1');
    expect(s1?.lane).toBe('needs-answer');
    expect(s1?.waitingSince).toBe(NOW - 1_000);
  });

  it('아직 실행 전인 대기 명령도 "답이 갔다"로 친다', () => {
    const items = buildCommandCenterItems(
      baseInput({
        agents,
        agentProjects,
        subAgents,
        agentQuestions: { a1: [question(NOW - 10_000, 's1')] },
        queuedCommands: { a1: [prompt(NOW - 5_000, 'queued')] },
      }),
    );
    const s1 = items.find((i) => i.subAgentId === 's1');
    expect(s1?.lane).toBe('working');
    expect(s1?.waitingSince).toBeNull();
  });

  it('검수·신고 카드에도 같은 자를 댄다', () => {
    const items = buildCommandCenterItems(
      baseInput({
        agents,
        agentProjects,
        subAgents,
        agentReviews: {
          a1: [{ id: 'v1', agentId: 'a1', subAgentId: 's1', changes: ['고침'], checkpoints: [], createdAt: NOW - 10_000 }],
        },
        agentReports: {
          a1: [{ id: 'p1', agentId: 'a1', subAgentId: 's1', did: ['고침'], userActions: ['빌드 실행'], createdAt: NOW - 9_000 }],
        },
        completedCommands: { a1: [prompt(NOW - 5_000)] },
      }),
    );
    const s1 = items.find((i) => i.subAgentId === 's1');
    expect(s1?.lane).toBe('done');
    expect(s1?.detail.review).toBeNull();
    expect(s1?.detail.report).toBeNull();
  });

  it('메인 탭은 그 에이전트 전 세션의 프롬프트를 자로 쓴다', () => {
    // IDE 메인 타임라인이 전 세션을 합쳐 보이므로, sub 로 간 프롬프트도 메인 카드를 위로 민다.
    const items = buildCommandCenterItems(
      baseInput({
        agents,
        agentProjects,
        subAgents,
        agentQuestions: { a1: [question(NOW - 10_000)] },
        completedCommands: { a1: [prompt(NOW - 5_000)] },
      }),
    );
    expect(items.find((i) => i.subAgentId === null)?.lane).toBe('done');
  });

  it('권한 대기는 프롬프트가 뒤에 와도 유지된다 — 그 자체가 살아 있는 상태다', () => {
    const permission: PermissionRequest = {
      requestId: 'r1',
      agentId: 'a1',
      subAgentId: 's1',
      agentLabel: 'Alpha',
      agentColor: '#fff',
      projectName: 'proj',
      toolName: 'Bash',
      toolInput: {},
      createdAt: NOW - 10_000,
      expiresAt: NOW + 60_000,
    };
    const items = buildCommandCenterItems(
      baseInput({
        agents,
        agentProjects,
        subAgents,
        pendingPermissions: { r1: permission },
        completedCommands: { a1: [prompt(NOW - 5_000)] },
      }),
    );
    expect(items.find((i) => i.subAgentId === 's1')?.lane).toBe('needs-answer');
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

// §5.12 (H) v4.44 — 분류 막대·키보드 이동·긴급도. 화면 없이 검증할 수 있게 전부 순수 함수다.
describe('분류 막대(§5.12 (H))', () => {
  it('토글은 그 레인만 남기고 다른 레인 토큰을 걷어낸다 — 알약은 라디오처럼 동작해야 한다', () => {
    expect(toggleLaneToken('', 'needs-review')).toBe('needs:review');
    expect(toggleLaneToken('is:working', 'needs-review')).toBe('needs:review');
    expect(toggleLaneToken('is:done is:idle', 'working')).toBe('is:working');
  });

  it('같은 레인을 다시 누르면 꺼진다(= 전체로 복귀)', () => {
    expect(toggleLaneToken('needs:review', 'needs-review')).toBe('');
    expect(toggleLaneToken('needs:review foo', 'needs-review')).toBe('foo');
  });

  it('자유 낱말은 보존한다 — 검색해 둔 것을 알약이 지우면 안 된다', () => {
    expect(toggleLaneToken('agent:alpha 로그인', 'working')).toBe('is:working agent:alpha 로그인');
    expect(toggleLaneToken('', null)).toBe('');
    expect(toggleLaneToken('is:working agent:alpha', null)).toBe('agent:alpha');
  });

  it('activeLaneOf 는 레인이 정확히 하나일 때만 알약을 켠다', () => {
    expect(activeLaneOf(parseCommandCenterQuery('needs:review'))).toBe('needs-review');
    expect(activeLaneOf(parseCommandCenterQuery(''))).toBeNull();
    expect(activeLaneOf(parseCommandCenterQuery('needs:review is:working'))).toBeNull();
    // is:idle / is:completed 는 done 레인의 부분집합이라 "done 알약 켜짐"으로 보이면 거짓말이 된다.
    expect(activeLaneOf(parseCommandCenterQuery('is:idle'))).toBeNull();
  });

  it('laneCounts 는 레인별로 세고 빈 레인도 0 을 낸다', () => {
    const counts = laneCounts([
      item({ key: 'a', lane: 'working' }),
      item({ key: 'b', lane: 'working' }),
      item({ key: 'c', lane: 'needs-answer' }),
    ]);
    expect(counts).toEqual({ 'needs-answer': 1, 'needs-review': 0, 'needs-action': 0, working: 2, done: 0 });
  });
});

describe('키보드 이동 순서 · 대기 긴급도(§5.12 (H))', () => {
  it('flattenLanes 는 화면에 보이는 레인 우선순위 순서로 평탄화한다', () => {
    const grouped = groupByLane([
      item({ key: 'done1', lane: 'done' }),
      item({ key: 'ans1', lane: 'needs-answer' }),
      item({ key: 'work1', lane: 'working' }),
      item({ key: 'rev1', lane: 'needs-review' }),
    ]);
    expect(flattenLanes(grouped).map((i) => i.key)).toEqual(['ans1', 'rev1', 'work1', 'done1']);
  });

  it('waitingLevel 은 30분/2시간을 경계로 색을 올린다', () => {
    expect(waitingLevel(null, NOW)).toBeNull();
    expect(waitingLevel(NOW - 5 * 60_000, NOW)).toEqual({ minutes: 5, level: 'fresh' });
    expect(waitingLevel(NOW - 45 * 60_000, NOW)).toEqual({ minutes: 45, level: 'warn' });
    expect(waitingLevel(NOW - 3 * 60 * 60_000, NOW)?.level).toBe('critical');
  });
});

// §5.12 (I) v4.47 — "작업 중 카드가 엎치락뒤치락한다"의 근본 원인은 정렬 키가 **작업 중에 변하는 값**
// (lastActivityAt)이었다는 것. 아래 테스트가 그 회귀를 막는다.
describe('우선순위 기준 고정(§5.12 (I))', () => {
  it('laneRank 는 표의 급한 순 그대로다', () => {
    expect(laneRank('needs-answer')).toBe(0);
    expect(laneRank('working')).toBeLessThan(laneRank('done'));
    expect(laneRank('needs-review')).toBeLessThan(laneRank('needs-action'));
  });

  it('레인 순위가 언제나 먼저다', () => {
    const busy = item({ key: 'busy', lane: 'working', laneSince: NOW - 600_000 });
    const asking = item({ key: 'ask', lane: 'needs-answer', waitingSince: NOW - 1_000 });
    expect(sortCommandCenterItems([busy, asking], 'priority').map((i) => i.key)).toEqual(['ask', 'busy']);
  });

  it('작업 중 레인은 마지막 활동이 아니라 작업 진입 시각으로 줄 세운다 — 도구를 더 써도 자리가 그대로다', () => {
    const first = item({ key: 'a::main', lane: 'working', laneSince: NOW - 60_000, lastActivityAt: NOW - 30_000 });
    const second = item({ key: 'b::main', lane: 'working', laneSince: NOW - 10_000, lastActivityAt: NOW - 20_000 });
    const before = sortCommandCenterItems([first, second], 'priority').map((i) => i.key);
    // 나중에 시작한 세션이 도구를 하나 더 써서 마지막 활동이 앞서게 돼도 순서는 바뀌지 않는다.
    const after = sortCommandCenterItems([first, { ...second, lastActivityAt: NOW }], 'priority').map((i) => i.key);
    expect(before).toEqual(['a::main', 'b::main']);
    expect(after).toEqual(before);
  });

  it('①②③ 은 오래 기다린 것이 위, ⑤ 는 미확인 완료가 위', () => {
    const old = item({ key: 'old', lane: 'needs-review', waitingSince: NOW - 600_000 });
    const fresh = item({ key: 'fresh', lane: 'needs-review', waitingSince: NOW - 1_000 });
    expect(sortCommandCenterItems([fresh, old], 'priority').map((i) => i.key)).toEqual(['old', 'fresh']);

    const unack = item({ key: 'unack', lane: 'done', unacknowledged: true, lastActivityAt: NOW - 600_000 });
    const idle = item({ key: 'idle', lane: 'done', lastActivityAt: NOW });
    expect(sortCommandCenterItems([idle, unack], 'priority').map((i) => i.key)).toEqual(['unack', 'idle']);
  });

  it('동점이 남지 않는다 — 넣은 순서가 달라도 결과가 같다', () => {
    const x = item({ key: 'x::main', lane: 'working', startedAt: 0 });
    const y = item({ key: 'y::main', lane: 'working', startedAt: 0 });
    expect(sortCommandCenterItems([x, y], 'priority').map((i) => i.key)).toEqual(['x::main', 'y::main']);
    expect(sortCommandCenterItems([y, x], 'priority').map((i) => i.key)).toEqual(['x::main', 'y::main']);
  });

  it('recent 는 1분 칸 안쪽 차이로 자리를 바꾸지 않는다', () => {
    const bucket = 10 * 60_000;
    const a = item({ key: 'a', lane: 'working', laneSince: 1_000, lastActivityAt: bucket + 1_000 });
    const b = item({ key: 'b', lane: 'working', laneSince: 5_000, lastActivityAt: bucket + 50_000 });
    // 같은 1분 칸이면 우선순위(작업 진입 시각)를 따른다 — 초 단위 갱신으로 뒤집히지 않는다.
    expect(sortCommandCenterItems([a, b], 'recent').map((i) => i.key)).toEqual(['a', 'b']);
    // 칸이 달라지면(1분 이상 차이) 그때는 최신 것이 위로 온다.
    expect(
      sortCommandCenterItems([a, { ...b, lastActivityAt: bucket + 61_000 }], 'recent').map((i) => i.key),
    ).toEqual(['b', 'a']);
  });

  it('waiting·context 도 동점이면 우선순위 순서로 떨어진다', () => {
    const a = item({ key: 'a', lane: 'working', laneSince: 1_000, waitingSince: null, contextUsed: 10, contextMax: 100 });
    const b = item({ key: 'b', lane: 'working', laneSince: 2_000, waitingSince: null, contextUsed: 10, contextMax: 100 });
    expect(sortCommandCenterItems([b, a], 'waiting').map((i) => i.key)).toEqual(['a', 'b']);
    expect(sortCommandCenterItems([b, a], 'context').map((i) => i.key)).toEqual(['a', 'b']);
  });

  it('세션 생성 시각을 담는다 — 메인 탭은 0, 서브는 createdAt', () => {
    const items = buildCommandCenterItems(
      baseInput({
        agents: [agent('a1', 'Alpha')],
        agentProjects: { a1: 'proj' },
        subAgents: { a1: [sub('s1', 'a1', { createdAt: NOW - 7_000 })] },
      }),
    );
    expect(items.find((i) => i.subAgentId === null)?.startedAt).toBe(0);
    expect(items.find((i) => i.subAgentId === 's1')?.startedAt).toBe(NOW - 7_000);
  });

  it('작업 중 본문은 도구 이름보다 명령·결과를 먼저 쓴다 — 도구마다 글자가 바뀌지 않게', () => {
    const items = buildCommandCenterItems(
      baseInput({
        agents: [agent('a1', 'Alpha', { status: 'active', lastTool: 'Bash', summary: '라우터를 고쳤습니다' })],
        agentProjects: { a1: 'proj' },
      }),
    );
    expect(items[0]?.lane).toBe('working');
    expect(items[0]?.laneReason).toBe('라우터를 고쳤습니다');
  });
});

describe('레인 정착(§5.12 (I))', () => {
  it('덜 급한 레인으로 내려갈 때는 정착 시간을 기다린다', () => {
    const memory: LaneMemory = new Map();
    const working = item({ key: 'k', lane: 'working' });
    expect(stabilizeLanes([working], memory, 1_000)[0]?.lane).toBe('working');

    const done = item({ key: 'k', lane: 'done' });
    expect(stabilizeLanes([done], memory, 2_000)[0]?.lane).toBe('working'); // 아직 붙잡는다
    expect(stabilizeLanes([done], memory, 2_000 + LANE_SETTLE_MS + 1)[0]?.lane).toBe('done');
  });

  it('더 급한 레인으로는 즉시 올린다 — 내 답을 기다리는 것이 늦게 보이면 안 된다', () => {
    const memory: LaneMemory = new Map();
    stabilizeLanes([item({ key: 'k', lane: 'working' })], memory, 1_000);
    expect(stabilizeLanes([item({ key: 'k', lane: 'needs-answer' })], memory, 1_100)[0]?.lane).toBe('needs-answer');
  });

  it('laneSince 는 그 레인에 들어온 시각으로 고정된다', () => {
    const memory: LaneMemory = new Map();
    const working = item({ key: 'k', lane: 'working' });
    expect(stabilizeLanes([working], memory, 1_000)[0]?.laneSince).toBe(1_000);
    expect(stabilizeLanes([working], memory, 99_000)[0]?.laneSince).toBe(1_000);
  });

  it('잠깐 내려갔다 돌아오면 원래 진입 시각을 지킨다', () => {
    const memory: LaneMemory = new Map();
    stabilizeLanes([item({ key: 'k', lane: 'working' })], memory, 1_000);
    stabilizeLanes([item({ key: 'k', lane: 'done' })], memory, 2_000);
    const back = stabilizeLanes([item({ key: 'k', lane: 'working' })], memory, 3_000)[0];
    expect(back?.lane).toBe('working');
    expect(back?.laneSince).toBe(1_000);
  });

  it('사라진 세션의 기억은 지운다', () => {
    const memory: LaneMemory = new Map();
    stabilizeLanes([item({ key: 'k', lane: 'working' })], memory, 1_000);
    stabilizeLanes([], memory, 2_000);
    expect(memory.size).toBe(0);
  });

  it('원본 항목을 건드리지 않는다', () => {
    const memory: LaneMemory = new Map();
    const source = item({ key: 'k', lane: 'working' });
    stabilizeLanes([source], memory, 1_000);
    expect(source.laneSince).toBe(0);
  });
});
