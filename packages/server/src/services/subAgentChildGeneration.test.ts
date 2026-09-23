import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueuedCommand, SubAgent } from '@vibisual/shared';
import { SubAgentManager } from './subAgentManager.js';

const mock = vi.hoisted(() => ({ spawn: vi.fn(), noteSpawnFailure: vi.fn() }));
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: mock.spawn,
}));
vi.mock('./claudeBin.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./claudeBin.js')>(),
  getClaudeBin: () => ({ binPath: 'test-claude', source: 'unknown' }),
  noteClaudeSpawnFailure: mock.noteSpawnFailure,
}));

/** 실제 스폰 콜백을 연결하되 OS 프로세스·PID 레지스트리는 건드리지 않는다. */
function fakeChild() {
  return Object.assign(new EventEmitter(), {
    pid: undefined,
    exitCode: null,
    signalCode: null,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
}
type FakeChild = ReturnType<typeof fakeChild>;
type Innards = {
  runningChildren: Map<string, FakeChild>;
  persistentInFlightCmd: Map<string, { cmd: QueuedCommand }>;
  persistentLineBuf: Map<string, string>;
  childStderrTails: Map<string, string>;
  intentionalKill: Set<string>;
  dispatchingSubs: Set<string>;
  _executeViaLegacy: (
    cmd: QueuedCommand, sub: SubAgent, cwd: string, prompt: string,
    configArgs: string[], maxTurns: number, maxBudgetUsd?: number,
  ) => void;
};

function setup(maxBudgetUsd: number) {
  const manager = new SubAgentManager();
  const priv = manager as unknown as Innards;
  const sub = manager.create('agent-child-generation');
  sub.sessionId = 'session-current';
  sub.status = 'active';
  const command = (id: string): QueuedCommand => ({
    id, text: '/compact', timestamp: Date.now(), startedAt: Date.now(),
    status: 'executing', subAgentId: sub.id,
  });
  const oldChild = fakeChild();
  const newChild = fakeChild();
  const oldCommand = command('cmd-before-sleep');
  const newCommand = command('cmd-after-resume');
  mock.spawn.mockReturnValueOnce(oldChild).mockReturnValueOnce(newChild);
  priv._executeViaLegacy(oldCommand, sub, process.cwd(), '/compact', [], 0, maxBudgetUsd);
  // 제거·복원 뒤 이전 close 가 아직 오지 않은 순서를 재현한다.
  priv.runningChildren.delete(sub.id);
  priv._executeViaLegacy(newCommand, sub, process.cwd(), '/compact', [], 0, maxBudgetUsd);
  manager.noteStreamTaskChip(sub.id, 'task_started', { id: 'bg-new', description: 'new monitor' });
  manager.noteSubagentTaskStart(sub.parentAgentId, 'hook-new', sub.id, { background: true });
  const onComplete = vi.fn();
  const onStream = vi.fn();
  manager.setOnComplete(onComplete);
  manager.setOnStreamEvent(onStream);
  return { manager, priv, sub, oldChild, newChild, oldCommand, newCommand, onComplete, onStream };
}

function expectNewWorkUntouched(state: ReturnType<typeof setup>) {
  const { manager, priv, sub, newChild, newCommand, onComplete } = state;
  expect(priv.runningChildren.get(sub.id)).toBe(newChild);
  expect(newCommand.status).toBe('executing');
  expect(sub.status).toBe('active');
  expect(sub.sessionId).toBe('session-current');
  // 두 장부를 목록으로 본다 — `bg-new` 는 셸(Monitor)이라 §5.5 #17-9 ⑰ 부터 `hasLiveBackgroundTasks`
  //   (표시 축)에는 잡히지 않는다. 장부에 남아 있는지는 백그라운드 목록이 말한다.
  const running = manager.getRunningSubagentTasks()?.[sub.parentAgentId]?.map((task) => task.id);
  expect(running).toContain('bg-new');
  expect(running).toContain('hook-new');
  expect(manager.getFinishedSubagentTasks()?.[sub.parentAgentId] ?? []).toHaveLength(0);
  expect(onComplete).not.toHaveBeenCalled();
}

beforeEach(() => { mock.spawn.mockReset(); mock.noteSpawnFailure.mockReset(); });

describe.each([
  ['persistent', 0],
  ['legacy', 1],
] as const)('%s child generation ownership', (_kind, maxBudgetUsd) => {
  it('이전 close 는 새 자식의 두 백그라운드 장부와 종료 표식을 보존한다', () => {
    const state = setup(maxBudgetUsd);
    state.priv.intentionalKill.add(state.sub.id);
    state.oldChild.emit('close', 0);

    expectNewWorkUntouched(state);
    expect(state.priv.intentionalKill.has(state.sub.id)).toBe(true);
  });

  it('이전 error 는 새 세션을 실패시키거나 큐를 다시 돌리지 않는다', () => {
    const state = setup(maxBudgetUsd);
    state.priv.dispatchingSubs.add(state.sub.id);
    state.oldChild.emit('error', Object.assign(new Error('old transport failed'), { code: 'ENOENT' }));

    expectNewWorkUntouched(state);
    expect(state.oldCommand.status).toBe('executing');
    expect(state.priv.dispatchingSubs.has(state.sub.id)).toBe(true);
    expect(mock.noteSpawnFailure).not.toHaveBeenCalled();
  });

  it('이전 stdout 은 새 sessionId·줄 버퍼·화면 출력을 바꾸지 않는다', () => {
    const state = setup(maxBudgetUsd);
    state.oldChild.stdout.emit('data', Buffer.from(
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'session-obsolete' }) + '\n'
      + JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'old answer' }] } }) + '\n'
      + 'old partial line',
    ));

    expectNewWorkUntouched(state);
    expect(state.priv.persistentLineBuf.get(state.sub.id) ?? '').toBe('');
    expect(state.onStream).not.toHaveBeenCalled();
  });

  it('이전 stderr 는 새 자식의 진단 꼬리를 오염시키지 않는다', () => {
    const state = setup(maxBudgetUsd);
    state.newChild.stderr.emit('data', Buffer.from('current failure detail'));
    state.oldChild.stderr.emit('data', Buffer.from('obsolete failure detail'));

    expectNewWorkUntouched(state);
    expect(state.priv.childStderrTails.get(state.sub.id)).toBe('current failure detail');
  });
});

it('현재 자식이 실제 종료하면 두 백그라운드 장부를 정상 정리한다', () => {
  const state = setup(0);
  state.priv.persistentInFlightCmd.delete(state.sub.id);
  state.priv.intentionalKill.add(state.sub.id);
  state.newChild.emit('close', 0);

  expect(state.manager.getRunningSubagentTasks()?.[state.sub.parentAgentId]).toBeUndefined();
  expect(state.manager.hasPendingSubagentTasks(state.sub.parentAgentId)).toBe(false);
  expect(state.priv.runningChildren.has(state.sub.id)).toBe(false);
  expect(state.onComplete).toHaveBeenCalledTimes(1);
});
