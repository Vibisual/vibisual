/** §7.1 — "마지막 결과" 고르기 고정: 조용한 압축 명령 · 응답 없는 대화 · 큐 시각만 앞선 덧말은 그 자리를 못 차지한다. */
import { describe, expect, it } from 'vitest';
import type { AgentEvent, QueuedCommand, SubAgent } from '@vibisual/shared';
import { pickLatestAgentResult, stripStageBlocks } from './latestAgentResult.js';

function evt(patch: Partial<AgentEvent> = {}): AgentEvent {
  return { id: 'e1', message: '대화 명령', response: '대화 응답', timestamp: 100, source: 'user', ...patch };
}

function cmd(patch: Partial<QueuedCommand> = {}): QueuedCommand {
  return { id: 'c1', text: '큐 명령', timestamp: 100, subAgentId: 'sub-A', status: 'completed', result: '큐 결과', ...patch };
}

function sub(patch: Partial<SubAgent> = {}): SubAgent {
  return {
    id: 'sub-A',
    sessionId: 'sess-A',
    label: 'Sub A',
    parentAgentId: 'agent-1',
    status: 'idle',
    createdAt: 0,
    lastActivityAt: 0,
    ...patch,
  } as SubAgent;
}

describe('pickLatestAgentResult — 끝난 것 가운데 가장 늦게 시작한 한 건', () => {
  it('재료가 없으면 null — 칸째 그리지 않는다', () => {
    expect(pickLatestAgentResult([], [], [])).toBeNull();
  });

  it('두 재료(직접 대화 · 세션 명령)를 합쳐 가장 늦은 것 하나를 고른다', () => {
    const cmdWins = pickLatestAgentResult([evt({ id: 'e-old', timestamp: 100 })], [cmd({ id: 'c-new', timestamp: 200 })], [sub()]);
    expect(cmdWins?.id).toBe('c-new');
    expect(cmdWins?.sessionId).toBe('sub-A');

    const evtWins = pickLatestAgentResult([evt({ id: 'e-new', timestamp: 300 })], [cmd({ id: 'c-old', timestamp: 200 })], [sub()]);
    expect(evtWins?.id).toBe('e-new');
    // 세션 없는 직접 대화(훅 버블) — IDE 는 세션을 고르지 않고 연다.
    expect(evtWins?.sessionId).toBeNull();
  });

  it('명령은 큐에 넣은 시각이 아니라 실제로 나간 시각으로 견준다', () => {
    // 덧말은 앞 턴이 도는 동안 넣어 timestamp 가 앞서지만 실제로는 나중에 나갔다.
    const queuedEarlyRanLate = cmd({ id: 'ran-late', timestamp: 100, startedAt: 500 });
    const queuedLateRanEarly = cmd({ id: 'ran-early', timestamp: 300, startedAt: 400 });
    expect(pickLatestAgentResult([], [queuedLateRanEarly, queuedEarlyRanLate], [sub()])?.id).toBe('ran-late');
  });

  it('조용한 내부 명령(자동 압축)은 결과로 내밀지 않는다', () => {
    const silent = cmd({ id: 'silent', timestamp: 900, silent: true, text: '/compact' });
    const real = cmd({ id: 'real', timestamp: 100 });
    expect(pickLatestAgentResult([], [silent, real], [sub()])?.id).toBe('real');
  });

  it('응답이 아직 없는 대화와 끝나지 않은 명령은 건너뛴다', () => {
    const running: AgentEvent = { id: 'running', message: '도는 중', timestamp: 900, source: 'user' };
    const executing: QueuedCommand = { id: 'executing', text: '실행 중', timestamp: 800, subAgentId: 'sub-A', status: 'executing' };
    const done = evt({ id: 'done', timestamp: 100 });
    expect(pickLatestAgentResult([running, done], [executing], [sub()])?.id).toBe('done');
  });

  it('실패한 명령은 오류로 표시하고, 세션이 목록에 있으면 그 이름을 단다', () => {
    const r = pickLatestAgentResult([], [cmd({ status: 'error', subAgentId: 'sub-B' })], [sub({ id: 'sub-B', label: '두 번째' })]);
    expect(r?.isError).toBe(true);
    expect(r?.sessionId).toBe('sub-B');
    expect(r?.sessionLabel).toBe('두 번째');
  });

  it('세션이 목록에서 사라졌으면 이름을 달지 않는다 — IDE 에 그 세션을 세울 수 없다는 표시다', () => {
    const r = pickLatestAgentResult([], [cmd({ subAgentId: 'sub-gone' })], [sub()]);
    expect(r?.sessionId).toBe('sub-gone');
    expect(r?.sessionLabel).toBeUndefined();
  });

  it('대화의 할 일 목록은 비어 있지 않을 때만 싣는다', () => {
    const withTodos = pickLatestAgentResult([evt({ todos: [{ content: '하나', status: 'completed' }] })], [], []);
    expect(withTodos?.todos).toHaveLength(1);
    const emptyTodos = pickLatestAgentResult([evt({ todos: [] })], [], []);
    expect(emptyTodos?.todos).toBeUndefined();
  });

  it('결과 본문은 무대 블록을 걷은 글로 싣는다', () => {
    const r = pickLatestAgentResult([], [cmd({ result: '```vibisual\n- [x] 단계\n```\n결론입니다.' })], [sub()]);
    expect(r?.preview).toBe('결론입니다.');
  });
});

describe('stripStageBlocks — 진행 신고는 걷고 읽을 글만 남긴다', () => {
  it('보고 머리의 무대 블록을 걷는다', () => {
    expect(stripStageBlocks('```vibisual\n- [x] 끝난 단계\n```\n결론입니다.\n둘째 줄')).toBe('결론입니다.\n둘째 줄');
  });

  it('가운데 블록이 빠진 자리의 빈 줄은 한 줄로 접는다', () => {
    expect(stripStageBlocks('첫 문단\n\n```vibisual\ngoal: 목표\n```\n\n둘째 문단')).toBe('첫 문단\n\n둘째 문단');
  });

  it('무대 블록이 아닌 코드블록은 그대로 둔다', () => {
    const text = '```ts\nconst a = 1;\n```';
    expect(stripStageBlocks(text)).toBe(text);
  });

  it('CRLF 로 온 보고에서도 걷는다', () => {
    expect(stripStageBlocks('```vibisual\r\n- [x] 단계\r\n```\r\n결론')).toBe('결론');
  });

  it('비었거나 블록뿐이면 빈 글', () => {
    expect(stripStageBlocks(undefined)).toBe('');
    expect(stripStageBlocks('')).toBe('');
    expect(stripStageBlocks('```vibisual\n- [x] 단계\n```')).toBe('');
  });
});
