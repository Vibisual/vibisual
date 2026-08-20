import { describe, it, expect } from 'vitest';
import {
  EMPTY_SESSION_RUN_INPUTS,
  isSessionRunning,
  hasSessionWork,
  resolveSessionRunState,
  type SessionRunInputs,
  type QueuedCommand,
  type RunningSubagentTask,
  type SubAgent,
} from '@vibisual/shared';
import {
  NODE_STATUS_AS_SUB_STATUS,
  NODE_STATUS_RUN_STATE,
  SESSION_STATUS_DOT,
  SESSION_STATUS_LABEL_KEY,
  buildSessionRunInputs,
  sessionRunStateOf,
  serializeBusySubIds,
  parseBusySubIds,
  isAgentDormant,
} from './sessionStatus.js';

function inputs(patch: Partial<SessionRunInputs>): SessionRunInputs {
  return { ...EMPTY_SESSION_RUN_INPUTS, ...patch };
}

function sub(patch: Partial<SubAgent> = {}): SubAgent {
  return {
    id: 'sub-1',
    sessionId: 'sess-1',
    label: 'Sub #1',
    parentAgentId: 'agent-1',
    status: 'idle',
    createdAt: 0,
    lastActivityAt: 0,
    ...patch,
  } as SubAgent;
}

function cmd(patch: Partial<QueuedCommand> = {}): QueuedCommand {
  return {
    id: 'c1',
    text: 'do it',
    status: 'queued',
    timestamp: 0,
    ...patch,
  } as QueuedCommand;
}

function task(patch: Partial<RunningSubagentTask> = {}): RunningSubagentTask {
  return { id: 't1', parentAgentId: 'agent-1', startedAt: 0, ...patch };
}

describe('isSessionRunning — 세 근거를 OR', () => {
  it('아무 근거도 없으면 안 돈다', () => {
    expect(isSessionRunning(EMPTY_SESSION_RUN_INPUTS)).toBe(false);
  });

  it('세션이 active 면 명령이 없어도 도는 것으로 본다 (봉인 후 깨어난 경우)', () => {
    expect(isSessionRunning(inputs({ subStatus: 'active' }))).toBe(true);
  });

  it('명령이 executing 이면 돈다', () => {
    expect(isSessionRunning(inputs({ hasExecutingCommand: true }))).toBe(true);
  });

  it('백그라운드 Task 가 남아 있으면 돈다', () => {
    expect(isSessionRunning(inputs({ runningTaskCount: 1 }))).toBe(true);
  });

  it('큐 대기만으로는 돌지 않는다 — 스피너가 헛돌면 안 된다', () => {
    expect(isSessionRunning(inputs({ hasQueuedCommand: true }))).toBe(false);
  });
});

describe('hasSessionWork — 커맨드센터 레인 ④의 범위', () => {
  it('큐 대기도 "낼 일이 남았다"에는 포함된다', () => {
    expect(hasSessionWork(inputs({ hasQueuedCommand: true }))).toBe(true);
  });

  it('아무것도 없으면 일이 없다', () => {
    expect(hasSessionWork(EMPTY_SESSION_RUN_INPUTS)).toBe(false);
  });
});

describe('resolveSessionRunState — 화면이 그릴 한 값', () => {
  it('봉인 후 깨어난 세션(sub active + 명령은 completed)은 running 이다', () => {
    // 이 조합이 곧 버그 재현 조건이었다: 명령 상태만 보면 "완료"가 뜬다.
    expect(resolveSessionRunState(inputs({ subStatus: 'active', hasExecutingCommand: false })))
      .toBe('running');
  });

  it('실패는 자식이 남아 있어도 running 으로 세탁되지 않는다', () => {
    expect(resolveSessionRunState(inputs({ subStatus: 'error', runningTaskCount: 2 })))
      .toBe('error');
  });

  it('끝났고 미확인이면 doneUnseen', () => {
    expect(resolveSessionRunState(inputs({ subStatus: 'idle', acknowledged: false })))
      .toBe('doneUnseen');
  });

  it('끝났고 확인했으면 done', () => {
    expect(resolveSessionRunState(inputs({ subStatus: 'idle', acknowledged: true })))
      .toBe('done');
  });

  it('completed 는 미확인 강조 대상이 아니다', () => {
    expect(resolveSessionRunState(inputs({ subStatus: 'completed' }))).toBe('done');
  });
});

describe('표시 규약 — 네 상태 전부 색·라벨이 있다', () => {
  const states = ['running', 'error', 'doneUnseen', 'done'] as const;

  it('색표에 빠진 상태가 없다', () => {
    for (const s of states) expect(SESSION_STATUS_DOT[s]).toBeTruthy();
  });

  it('라벨 키에 빠진 상태가 없다', () => {
    for (const s of states) expect(SESSION_STATUS_LABEL_KEY[s]).toMatch(/^panel\.subAgent\.status\./);
  });

  it('미확인 완료만 초록으로 강조된다', () => {
    expect(SESSION_STATUS_DOT.doneUnseen).toContain('emerald');
    expect(SESSION_STATUS_DOT.done).not.toContain('emerald');
  });
});

describe('두 축 정규화 — 버블(NodeStatus)과 세션(SubAgentStatus)이 같은 낱말을 쓴다', () => {
  it('버블 상태도 같은 표시 어휘로 접힌다', () => {
    expect(NODE_STATUS_RUN_STATE.active).toBe('running');
    expect(NODE_STATUS_RUN_STATE.error).toBe('error');
    expect(NODE_STATUS_RUN_STATE.completed).toBe('done');
  });

  it('권한 대기는 "블록된 활성" — 사용자에게는 도는 중이다', () => {
    expect(NODE_STATUS_RUN_STATE.awaiting_permission).toBe('running');
  });

  it('세션 축에 없는 버블 상태는 판정에 기여하지 않는다', () => {
    expect(NODE_STATUS_AS_SUB_STATUS.awaiting_permission).toBeNull();
    expect(NODE_STATUS_AS_SUB_STATUS.disappearing).toBeNull();
  });

  it('겹치는 네 값은 그대로 통과한다 — SubAgentStatus 는 NodeStatus 의 부분집합', () => {
    expect(NODE_STATUS_AS_SUB_STATUS.idle).toBe('idle');
    expect(NODE_STATUS_AS_SUB_STATUS.active).toBe('active');
    expect(NODE_STATUS_AS_SUB_STATUS.completed).toBe('completed');
    expect(NODE_STATUS_AS_SUB_STATUS.error).toBe('error');
  });
});

describe('sessionRunStateOf — 도트를 그리는 모든 화면의 공통 입구', () => {
  it('확인 여부가 완료·미확인과 완료를 가른다', () => {
    const s = sub({ status: 'idle' });
    expect(sessionRunStateOf(s, false)).toBe('doneUnseen');
    expect(sessionRunStateOf(s, true)).toBe('done');
  });

  it('실행 중은 확인 여부와 무관하다', () => {
    const s = sub({ status: 'active' });
    expect(sessionRunStateOf(s, true)).toBe('running');
  });
});

describe('buildSessionRunInputs — 세션 소유 필터', () => {
  it('세션 탭은 자기 명령만 센다', () => {
    const built = buildSessionRunInputs({
      sub: sub({ id: 'sub-1', status: 'idle' }),
      commands: [
        cmd({ id: 'a', status: 'executing', subAgentId: 'sub-2' }),
        cmd({ id: 'b', status: 'queued', subAgentId: 'sub-1' }),
      ],
      runningTasks: [task({ subAgentId: 'sub-2' })],
      acknowledged: false,
    });
    expect(built.hasExecutingCommand).toBe(false); // 옆 탭 명령은 내 것이 아니다
    expect(built.hasQueuedCommand).toBe(true);
    expect(built.runningTaskCount).toBe(0);
  });

  it('메인 탭(sub=null)은 에이전트 전체를 본다', () => {
    const built = buildSessionRunInputs({
      sub: null,
      commands: [cmd({ status: 'executing', subAgentId: 'sub-2' })],
      runningTasks: [task({ subAgentId: 'sub-9' })],
      acknowledged: false,
    });
    expect(built.hasExecutingCommand).toBe(true);
    expect(built.runningTaskCount).toBe(1);
    expect(built.subStatus).toBeNull();
  });

  it('빈 store 조각도 안전하다', () => {
    const built = buildSessionRunInputs({
      sub: null, commands: undefined, runningTasks: undefined, acknowledged: false,
    });
    expect(built).toEqual(EMPTY_SESSION_RUN_INPUTS);
  });
});

describe('백단 작업이 있으면 세션 도트가 켜진다 — 귀속이 늦어도 화면은 진실을 말한다', () => {
  it('세션 status 가 idle 이어도 그 세션의 백단 작업이 있으면 running', () => {
    const s = sub({ status: 'idle' });
    expect(sessionRunStateOf(s, false)).toBe('doneUnseen');
    expect(sessionRunStateOf(s, false, /*hasBackgroundWork=*/true)).toBe('running');
  });

  it('확인한 세션이어도 백단이 돌면 켜진다', () => {
    expect(sessionRunStateOf(sub({ status: 'idle' }), true, true)).toBe('running');
  });

  it('실패한 세션은 백단이 남아 있어도 실패로 남는다', () => {
    expect(sessionRunStateOf(sub({ status: 'error' }), false, true)).toBe('error');
  });
});

describe('serializeBusySubIds — 켜짐이 바뀔 때만 값이 달라진다', () => {
  const task = (subAgentId?: string): RunningSubagentTask =>
    ({ id: 't' + Math.random(), parentAgentId: 'agent-1', startedAt: 0, ...(subAgentId ? { subAgentId } : {}) });

  it('세션 순서가 달라도 같은 문자열 — 헛리렌더 방지', () => {
    expect(serializeBusySubIds([task('b'), task('a')]))
      .toBe(serializeBusySubIds([task('a'), task('b')]));
  });

  it('같은 세션의 작업이 여럿이어도 한 번만 센다', () => {
    expect(serializeBusySubIds([task('a'), task('a')])).toBe('a');
  });

  it('소유 미상 작업은 어느 도트도 켜지 않는다', () => {
    expect(serializeBusySubIds([task(undefined)])).toBe('');
  });

  it('빈 목록은 빈 문자열', () => {
    expect(serializeBusySubIds(undefined)).toBe('');
    expect(parseBusySubIds('').size).toBe(0);
  });

  it('왕복해도 같은 집합', () => {
    const set = parseBusySubIds(serializeBusySubIds([task('a'), task('b')]));
    expect([...set].sort()).toEqual(['a', 'b']);
  });
});

describe('isAgentDormant — 자식 프로세스를 하나도 안 들고 있는가(§2.4 잠듦)', () => {
  const sub = (id: string, dormant?: boolean): SubAgent => ({
    id,
    sessionId: `session-${id}`,
    label: id,
    parentAgentId: 'agent-1',
    status: 'idle',
    createdAt: 0,
    lastActivityAt: 0,
    ...(dormant === undefined ? {} : { dormant }),
  });

  it('세션이 없으면 잠든 것이 아니다(갓 만든 버블에 잠듦이 붙으면 안 된다)', () => {
    expect(isAgentDormant(undefined)).toBe(false);
    expect(isAgentDormant([])).toBe(false);
  });

  it('모든 세션이 잠들었을 때만 잠든 것으로 본다', () => {
    expect(isAgentDormant([sub('a', true), sub('b', true)])).toBe(true);
  });

  it('하나라도 자식을 들고 있으면 잠든 것이 아니다 — 그 버블은 여전히 메모리를 쓴다', () => {
    expect(isAgentDormant([sub('a', true), sub('b')])).toBe(false);
  });
});
