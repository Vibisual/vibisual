import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AgentConfig, QueuedCommand } from '@vibisual/shared';
import type { LocalTurnArgs } from './localRunner.js';

/**
 * §5.5 #17-18 ⑥-5 — **앱이 내려갔다 재개한 명령의 시작 시각은 재발급되지 않는다.**
 *
 * 2026-08-26 사용자 보고: 강제 종료 후 멈춰 있던 에이전트를 다시 열었더니 *"내가 명령 내린 텍스트가
 * 아래로 내려와 있다 — 위치가 뒤죽박죽"*. 화면 정렬 버그가 아니라 **값**이 바뀌어 있었다.
 *
 * 부팅 reconcile(§5.3 #12-1)은 끊긴 `executing` 명령을 보존된 세션으로 이어 돌리려고 `queued` 로
 * 되돌린다. 그런데 dispatch 자리(`execute`)가 `cmd.startedAt = Date.now()` 를 **무조건** 찍고 있어서,
 * 재개하는 순간 그 값이 *재개한 시각* 으로 갈아 끼워졌다. 말풍선은 이 값으로 자리를 잡으므로
 * (#17-18 ⑥-2), 그 명령이 끊기기 전에 이미 뱉어 놓은 출력보다 **아래**로 내려앉는다 —
 * 사용자에겐 자기 명령이 제 결과 밑에 있는 화면이 된다.
 *
 * 재개는 **같은 턴의 이어달리기**지 새 턴이 아니다. 그래서 시작 시각은 한 명령에 한 번만 찍는다.
 *
 * 러너는 `localTurnLiveness.test.ts` 와 같은 방식으로 대역을 세운다 — 엔진도 CLI 도 띄우지 않고
 * dispatch 자리까지만 밟는 것이 이 시험의 요지다.
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
    // 종전에는 여기가 RESUME_DISPATCH 로 갈아 끼워져 말풍선이 제 출력 아래로 내려갔다.
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
