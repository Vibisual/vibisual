import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AgentConfig, QueuedCommand } from '@vibisual/shared';
import type { LocalTurnArgs } from './localRunner.js';

/**
 * §5.5 #17-18 ⑥-5 — 부팅 reconcile(§5.3 #12-1)로 재개한 명령의 `startedAt` 은 다시 찍지 않는다
 * (찍으면 말풍선이 제 출력 아래로 내려간다 — 재개는 같은 턴의 이어달리기). 러너는 대역으로 dispatch 자리까지만 밟는다.
 */

let lastTurnArgs: LocalTurnArgs | null = null;

vi.mock('./localRunner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./localRunner.js')>();
  return {
    ...actual,
    runLocalTurn: (args: LocalTurnArgs): void => { lastTurnArgs = args; },
  };
});

const { subAgentManager } = await import('./subAgentManager.js');

const PARENT_CWD = process.cwd();

/** 끊기기 전 처음 나간 시각 / 앱을 다시 켜 재개한 시각(10분 뒤). */
const FIRST_DISPATCH = 1_700_000_000_000;
const RESUME_DISPATCH = FIRST_DISPATCH + 600_000;

function localConfig(): AgentConfig {
  return {
    model: 'opus',
    tools: [],
    permissionMode: 'bypassPermissions',
    skills: [],
    provider: { kind: 'local-llama', modelId: 'test-model.gguf' },
  } as unknown as AgentConfig;
}

function makeCmd(subAgentId: string, text = '이 영상 잘라내는 프로그램 만들어 줘'): QueuedCommand {
  return {
    id: `cmd-${Math.random().toString(36).slice(2)}`,
    text,
    status: 'queued',
    timestamp: FIRST_DISPATCH - 5_000,
    subAgentId,
  } as unknown as QueuedCommand;
}

const created: string[] = [];
function newSub(agentId: string, preferredId?: string): { id: string } {
  const sub = subAgentManager.create(agentId, preferredId);
  created.push(sub.id);
  return sub;
}

/** 앱이 내려갔다 다시 켜진 상황 — 부팅 reconcile 이 끊긴 명령에 하는 일 그대로. */
function reconcileAsRestartResume(cmd: QueuedCommand, subId: string): void {
  cmd.status = 'queued';
  cmd.restartResumed = true;
  cmd.result = undefined;
  const sub = subAgentManager.getSub(subId);
  if (sub) sub.status = 'idle';
}

let nowSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  while (created.length > 0) {
    const id = created.pop();
    if (id) subAgentManager.remove(id);
  }
  lastTurnArgs = null;
  subAgentManager.setOnSubStatusChange(() => { /* 조용히 */ });
  nowSpy = vi.spyOn(Date, 'now');
});

afterEach(() => {
  nowSpy?.mockRestore();
  nowSpy = null;
});

describe('§5.5 #17-18 ⑥-5 — 재개해도 말풍선 자리는 처음 나간 그 시각', () => {
  it('끊겼다 재개한 명령의 startedAt 은 재발급되지 않는다', () => {
    const sub = newSub('agent-restart-anchor', 'sub-restart-anchor');
    const cmd = makeCmd(sub.id);

    nowSpy!.mockReturnValue(FIRST_DISPATCH);
    subAgentManager.execute(cmd, PARENT_CWD, '', localConfig());
    expect(cmd.startedAt).toBe(FIRST_DISPATCH);

    // 여기서 앱이 강제 종료됐다 — 다시 켜면 reconcile 이 이 명령을 재개 대기로 되돌린다.
    reconcileAsRestartResume(cmd, sub.id);
    expect(cmd.restartResumed).toBe(true);

    nowSpy!.mockReturnValue(RESUME_DISPATCH);
    subAgentManager.execute(cmd, PARENT_CWD, '', localConfig());

    expect(cmd.status).toBe('executing');
    // 여기가 RESUME_DISPATCH 로 바뀌면 말풍선이 제 출력 아래로 내려간다.
    expect(cmd.startedAt).toBe(FIRST_DISPATCH);
  });

  it('여러 번 재기동해도 처음 나간 시각 하나를 지킨다', () => {
    const sub = newSub('agent-restart-anchor-2', 'sub-restart-anchor-2');
    const cmd = makeCmd(sub.id);

    nowSpy!.mockReturnValue(FIRST_DISPATCH);
    subAgentManager.execute(cmd, PARENT_CWD, '', localConfig());

    for (let n = 1; n <= 3; n += 1) {
      reconcileAsRestartResume(cmd, sub.id);
      nowSpy!.mockReturnValue(RESUME_DISPATCH + n * 60_000);
      subAgentManager.execute(cmd, PARENT_CWD, '', localConfig());
      expect(cmd.startedAt).toBe(FIRST_DISPATCH);
    }
  });

  it('처음 나가는 명령은 종전대로 그 순간 시각을 받는다(재발급 금지가 최초 발급을 막지 않는다)', () => {
    const sub = newSub('agent-restart-anchor-3', 'sub-restart-anchor-3');
    const cmd = makeCmd(sub.id);
    expect(cmd.startedAt).toBeUndefined();

    nowSpy!.mockReturnValue(RESUME_DISPATCH);
    subAgentManager.execute(cmd, PARENT_CWD, '', localConfig());

    expect(cmd.startedAt).toBe(RESUME_DISPATCH);
    expect(lastTurnArgs).not.toBeNull();
  });
});
