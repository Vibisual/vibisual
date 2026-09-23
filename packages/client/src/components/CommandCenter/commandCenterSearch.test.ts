import { describe, expect, it } from 'vitest';
import type { BubbleData, QueuedCommand, SubAgent, SubAgentStreamEvent } from '@vibisual/shared';
import {
  buildCommandCenterItems,
  filterCommandCenterItems,
  parseCommandCenterQuery,
  type CommandCenterInput,
  type CommandCenterItem,
} from './commandCenterModel.js';

const NOW = 1_700_000_000_000;

function agent(id: string, over: Partial<BubbleData> = {}): BubbleData {
  return {
    id,
    label: id === 'a1' ? 'Alpha' : 'Beta',
    bubbleType: 'agent',
    path: `session-${id}`,
    status: 'idle',
    activity: 0,
    lastActivity: NOW,
    customCreated: true,
    ...over,
  };
}

function sub(id: string, parentAgentId = 'a1', over: Partial<SubAgent> = {}): SubAgent {
  return {
    id,
    sessionId: `session-${id}`,
    label: id,
    parentAgentId,
    status: 'idle',
    createdAt: NOW - 100_000,
    lastActivityAt: NOW,
    lastCommand: '가장 최근의 다른 요청',
    lastResult: '가장 최근의 다른 답변',
    ...over,
  };
}

function command(id: string, text: string, over: Partial<QueuedCommand> = {}): QueuedCommand {
  return { id, text, timestamp: NOW - 10_000, subAgentId: 's1', status: 'completed', ...over };
}

function stream(id: string, content: string, over: Partial<SubAgentStreamEvent> = {}): SubAgentStreamEvent {
  return { id, content, subAgentId: 's1', parentAgentId: 'a1', timestamp: NOW - 10_000, eventType: 'text', ...over };
}

function input(over: Partial<CommandCenterInput> = {}): CommandCenterInput {
  return {
    projectId: 'proj',
    agents: [agent('a1')],
    agentProjects: { a1: 'proj' },
    agentConfigs: {},
    subAgents: { a1: [sub('s1'), sub('s2')] },
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

function keys(
  items: CommandCenterItem[],
  raw: string,
  historyMatches?: Readonly<Record<string, readonly string[]>>,
): string[] {
  return filterCommandCenterItems(items, parseCommandCenterQuery(raw), historyMatches).map((item) => item.key);
}

describe('CommandCenter 대화 본문 검색', () => {
  it('마지막 명령으로 덮인 이전 사용자 입력과 완료 응답도 찾는다', () => {
    const items = buildCommandCenterItems(input({
      completedCommands: { a1: [
        command('old', '시간경화 현상을 조사해 줘', { result: '냉각주기가 원인입니다' }),
        command('new', '이제 다른 작업을 해 줘', { timestamp: NOW, result: '다른 작업을 마쳤습니다' }),
      ] },
    }));

    expect(keys(items, '시간경화')).toEqual(['a1::main', 'a1::s1']);
    expect(keys(items, '냉각주기')).toEqual(['a1::main', 'a1::s1']);
    expect(items.find((item) => item.key === 'a1::s1')?.detail.lastCommand).toBe('가장 최근의 다른 요청');
  });

  it('이력 색인을 끈 목록에서는 긴 대화 본문을 생략하고 마지막 명령은 유지한다', () => {
    const items = buildCommandCenterItems(input({
      includeHistoryText: false,
      subAgents: { a1: [sub('s1', 'a1', { lastCommand: '현재요청고유어' })] },
      completedCommands: { a1: [command('old', `${'긴 이전 입력 '.repeat(500)} 과거입력고유어`, {
        result: `${'긴 이전 응답 '.repeat(500)} 과거응답고유어`,
      })] },
      subAgentStreams: { s1: [stream('old-stream', `${'긴 대화 본문 '.repeat(500)} 스트림고유어`)] },
    }));

    expect(keys(items, '과거입력고유어')).toEqual([]);
    expect(keys(items, '과거응답고유어')).toEqual([]);
    expect(keys(items, '스트림고유어')).toEqual([]);
    expect(keys(items, '현재요청고유어')).toEqual(['a1::s1']);
  });

  it.each(['text', 'result'] as const)('AI %s 스트림의 미리보기 길이를 넘긴 뒷부분도 찾는다', (eventType) => {
    const items = buildCommandCenterItems(input({
      subAgentStreams: { s1: [stream('long', `${'앞부분 설명 '.repeat(150)} 열처리분석완료`, { eventType })] },
    }));

    expect(keys(items, '열처리분석완료')).toEqual(['a1::main', 'a1::s1']);
  });

  it('한 응답에서 나뉘어 도착한 연속 텍스트 조각을 이어 검색한다', () => {
    const items = buildCommandCenterItems(input({
      subAgentStreams: { s1: [
        stream('chunk-1', '시간', { turnId: 'turn-1' }),
        stream('chunk-2', '경화', { turnId: 'turn-1' }),
      ] },
    }));

    expect(keys(items, '시간경화 ')).toEqual(['a1::main', 'a1::s1']);
  });

  it.each([
    ['명시된 같은 턴', 'command-1', ['a1::main', 'a1::s1']],
    ['턴 식별자 없는 옛 기록', undefined, []],
  ] as const)('%s에서는 다음 명령의 시작 시각을 올바르게 해석한다', (_case, turnId, expected) => {
    const items = buildCommandCenterItems(input({
      completedCommands: { a1: [
        command('command-1', '첫 요청', { timestamp: 10, startedAt: 50 }),
        command('command-2', '다음 요청', { timestamp: 80, startedAt: 200 }),
      ] },
      subAgentStreams: { s1: [
        stream('chunk-1', '시간', { timestamp: 100, turnId }),
        stream('chunk-2', '경화', { timestamp: 300, turnId }),
      ] },
    }));

    expect(keys(items, '시간경화')).toEqual(expected);
    expect(keys(items, '시간 경화')).toEqual(['a1::main', 'a1::s1']);
  });

  it.each<[string, Partial<SubAgentStreamEvent>]>([
    ['다른 턴', { turnId: 'turn-2' }],
    ['다른 세션', { subAgentId: 's2' }],
    ['다른 에이전트', { parentAgentId: 'a2', subAgentId: 's3' }],
    ['별개 결과 이벤트', { eventType: 'result' }],
    ['중첩 도구 응답', { nestedUnderToolUseId: 'tool-1' }],
  ])('%s의 조각을 이어 실제로 없는 단어를 만들지 않는다', (_boundary, over) => {
    const items = buildCommandCenterItems(input({
      agents: [agent('a1'), agent('a2')],
      agentProjects: { a1: 'proj', a2: 'proj' },
      subAgents: { a1: [sub('s1'), sub('s2')], a2: [sub('s3', 'a2')] },
      subAgentStreams: { s1: [
        stream('chunk-1', '시간', { turnId: 'turn-1' }),
        stream('chunk-2', '경화', { turnId: 'turn-1', ...over }),
      ] },
    }));

    expect(keys(items, '시간경화')).toEqual([]);
  });

  it('서로 다른 세션 버퍼나 도구 이벤트를 건너뛰어 조각을 연결하지 않는다', () => {
    const items = buildCommandCenterItems(input({
      subAgentStreams: {
        s1: [
          stream('chunk-1', '시간', { turnId: 'turn-1' }),
          stream('tool', '실행', { turnId: 'turn-1', eventType: 'tool_use' }),
          stream('chunk-2', '경화', { turnId: 'turn-1' }),
        ],
        s2: [stream('other-buffer', '경화', { subAgentId: 's2', turnId: 'turn-1' })],
      },
    }));

    expect(keys(items, '시간경화')).toEqual([]);
  });

  it('메인은 같은 에이전트의 모든 세션을 찾고 개별 세션은 자기 대화만 찾는다', () => {
    const items = buildCommandCenterItems(input({
      completedCommands: { a1: [
        command('main', '메인전용기록', { subAgentId: null }),
        command('first', '첫세션입력'),
        command('second', '둘째세션입력', { subAgentId: 's2' }),
      ] },
      subAgentStreams: {
        s1: [stream('first-answer', '첫세션응답')],
        s2: [stream('second-answer', '둘째세션응답', { subAgentId: 's2' })],
      },
    }));

    expect(keys(items, '메인전용기록')).toEqual(['a1::main']);
    expect(keys(items, '첫세션입력 첫세션응답')).toEqual(['a1::main', 'a1::s1']);
    expect(keys(items, '둘째세션입력 둘째세션응답')).toEqual(['a1::main', 'a1::s2']);
    expect(keys(items, '첫세션입력 둘째세션응답')).toEqual(['a1::main']);
  });

  it('다른 에이전트나 프로젝트의 명령·응답을 섞지 않는다', () => {
    const items = buildCommandCenterItems(input({
      agents: [agent('a1'), agent('a2'), agent('outside')],
      agentProjects: { a1: 'proj', a2: 'proj', outside: 'other-project' },
      subAgents: { a1: [sub('s1')], a2: [sub('s3', 'a2')], outside: [sub('s4', 'outside')] },
      completedCommands: {
        a2: [command('peer', '다른에이전트입력', { subAgentId: 's3' })],
        outside: [command('outside', '다른프로젝트입력', { subAgentId: 's4' })],
      },
      subAgentStreams: {
        s3: [stream('peer-answer', '다른에이전트응답', { parentAgentId: 'a2', subAgentId: 's3' })],
        s4: [stream('outside-answer', '다른프로젝트응답', { parentAgentId: 'outside', subAgentId: 's4' })],
      },
    }));

    expect(keys(items, '다른에이전트입력 다른에이전트응답')).toEqual(['a2::main', 'a2::s3']);
    expect(keys(items, '다른프로젝트입력')).toEqual([]);
    expect(keys(items, '다른프로젝트응답')).toEqual([]);
  });

  it.each([
    ['시간경화', '시간경화   \t\n'],
    ['시간경화'.normalize('NFD'), '시간경화 '],
    ['시간경화', '시간경화'.normalize('NFD') + ' '],
    ['ThermalAGEING', 'thermalageing '],
  ])('본문 %j와 검색어 %j를 정규화하여 비교한다', (content, query) => {
    const items = buildCommandCenterItems(input({
      completedCommands: { a1: [command('normalized', content)] },
    }));

    expect(keys(items, query)).toEqual(['a1::main', 'a1::s1']);
  });

  it('여러 검색어가 서로 다른 대화 턴에 있어도 모두 있는 세션을 찾는다', () => {
    const items = buildCommandCenterItems(input({
      completedCommands: { a1: [command('prompt', '시간경화 문제')] },
      subAgentStreams: { s1: [stream('answer', '재현검증을 마쳤습니다')] },
    }));

    expect(keys(items, '시간경화 재현검증')).toEqual(['a1::main', 'a1::s1']);
    expect(keys(items, '시간경화 없는단어')).toEqual([]);
  });
});

describe('CommandCenter 이전 카드 검색', () => {
  const items = buildCommandCenterItems(input({
    completedCommands: { a1: [command('answered', '계속 진행해 줘', { timestamp: NOW })] },
    agentQuestions: { a1: [
      {
        id: 'old-question', agentId: 'a1', subAgentId: 's1', createdAt: NOW - 10_000,
        items: [{ header: '질문제목', question: '질문본문', prompts: ['제안응답'] }], note: '질문메모',
      },
    ] },
    agentReviews: { a1: [
      {
        id: 'old-review', agentId: 'a1', subAgentId: 's1', createdAt: NOW - 9_000,
        instruction: '검수지시', changes: ['검수변경'], checkpoints: ['검수확인'], note: '검수메모',
      },
    ] },
    agentReports: { a1: [
      {
        id: 'old-report', agentId: 'a1', subAgentId: 's1', createdAt: NOW - 8_000,
        did: ['완료내용'], userActions: ['사용자작업'], nextSteps: ['다음단계'], learned: ['배운교훈'], note: '신고메모',
      },
      {
        id: 'without-action', agentId: 'a1', subAgentId: 's1', createdAt: NOW - 7_000,
        did: ['추가완료내용'], userActions: [],
      },
    ] },
  }));

  it('이미 답한 카드가 검색되어도 세션을 다시 응답·검수·작업 대기로 만들지 않는다', () => {
    const session = items.find((item) => item.key === 'a1::s1');
    expect(session?.lane).toBe('done');
    expect(session?.detail.question).toBeNull();
    expect(session?.detail.review).toBeNull();
    expect(session?.detail.report).toBeNull();
    expect(keys(items, '질문본문 is:done')).toEqual(['a1::main', 'a1::s1']);
    expect(keys(items, '검수변경 needs:review')).toEqual([]);
  });

  it.each([
    '질문제목', '질문본문', '제안응답', '질문메모',
    '검수지시', '검수변경', '검수확인', '검수메모',
    '완료내용', '사용자작업', '다음단계', '배운교훈', '신고메모', '추가완료내용',
  ])('현재 대기 카드가 아닌 과거 본문 %s도 찾는다', (term) => {
    expect(keys(items, term)).toEqual(['a1::main', 'a1::s1']);
  });
});

describe('CommandCenter 서버 이력 검색 결과 병합', () => {
  const items = buildCommandCenterItems(input({
    agents: [agent('a1', { status: 'active', lastTool: 'Bash' }), agent('a2')],
    agentProjects: { a1: 'proj', a2: 'proj' },
    subAgents: { a1: [sub('s1'), sub('s2')] },
    agentReviews: { a2: [
      { id: 'review', agentId: 'a2', changes: ['현재검수'], checkpoints: [], createdAt: NOW },
    ] },
  }));

  it('검색어마다 로컬 본문 또는 서버 이력에서 찾되 모든 검색어가 있어야 한다', () => {
    const historyMatches = { 'a1::main': ['시간경화'] } as const;

    expect(keys(items, 'alpha 시간경화', historyMatches)).toEqual(['a1::main']);
    expect(keys(items, 'alpha 시간경화 없는단어', historyMatches)).toEqual([]);
    expect(keys(items, 'alpha 시간경화', {})).toEqual([]);
  });

  it('서버에서 찾은 이력도 레인·에이전트·도구 필터를 모두 통과해야 한다', () => {
    const historyMatches = { 'a1::main': ['시간경화'], 'a2::main': ['시간경화'] } as const;

    expect(keys(items, '시간경화 is:working agent:alpha tool:bash', historyMatches)).toEqual(['a1::main']);
    expect(keys(items, '시간경화 needs:review', historyMatches)).toEqual(['a2::main']);
    expect(keys(items, '시간경화 needs:review agent:alpha', historyMatches)).toEqual([]);
    expect(keys(items, '시간경화 agent:beta tool:bash', historyMatches)).toEqual([]);
    expect(keys(items, '시간경화 tool:read', historyMatches)).toEqual([]);
  });

  it('서버 이력 일치 항목은 같은 에이전트의 다른 세션이나 없는 프로젝트 항목으로 번지지 않는다', () => {
    expect(keys(items, '시간경화', {
      'a1::s1': ['시간경화'],
      'outside::s4': ['시간경화'],
    })).toEqual(['a1::s1']);
  });

  it('서버가 반환한 정규화 검색어와 한글 분해형·뒤 공백이 있는 입력도 일치한다', () => {
    expect(keys(items, '시간경화'.normalize('NFD') + ' ', {
      'a1::main': ['시간경화'],
    })).toEqual(['a1::main']);
  });
});
