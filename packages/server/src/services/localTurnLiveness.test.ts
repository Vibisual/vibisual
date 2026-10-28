import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AgentConfig, QueuedCommand } from '@vibisual/shared';
import type { LocalTurnArgs } from './localRunner.js';

/**
 * §5.19 (D) — 로컬 턴이 도는 동안 "실행중"이 유지되는가. 로컬 턴엔 자식 프로세스가 없어(`isSubRunning` false)
 * 5초 생존 대조(`reconcileDeadActiveSubs`)가 idle 로 내리면 완료↔동작이 되풀이된다. 고정: 대기 → active(턴 끝까지 어떤 sweep 에도 유지) → idle(한 번).
 * 러너는 대역이다 — `onDone` 을 우리가 불러 안 끝난 구간을 늘린다.
 */

/** 러너에 넘어간 인자 — `onDone` 을 뒤에서 부르려고 붙잡아 둔다. */
let lastTurnArgs: LocalTurnArgs | null = null;

vi.mock('./localRunner.js', async (importOriginal) => {
  // 나머지 export(순수 함수들 — 시스템 프롬프트 조립·슬래시 파싱)는 진짜를 그대로 쓴다.
  const actual = await importOriginal<typeof import('./localRunner.js')>();
  return {
    ...actual,
    runLocalTurn: (args: LocalTurnArgs): void => { lastTurnArgs = args; },
  };
});

const { subAgentManager } = await import('./subAgentManager.js');

const PARENT_CWD = process.cwd();

function localConfig(): AgentConfig {
  return {
    model: 'opus',
    tools: [],
    permissionMode: 'bypassPermissions',
    skills: [],
    provider: { kind: 'local-llama', modelId: 'test-model.gguf' },
  } as unknown as AgentConfig;
}

function makeCmd(subAgentId: string, text = '파일 하나 고쳐 줘'): QueuedCommand {
  return {
    id: `cmd-${Math.random().toString(36).slice(2)}`,
    text,
    status: 'queued',
    timestamp: Date.now(),
    subAgentId,
  } as unknown as QueuedCommand;
}

/** 테스트가 만든 sub 를 매번 걷어 낸다(매니저가 모듈 싱글턴이라). */
const created: string[] = [];
function newSub(agentId: string, preferredId?: string): { id: string } {
  const sub = subAgentManager.create(agentId, preferredId);
  created.push(sub.id);
  return sub;
}

beforeEach(() => {
  while (created.length > 0) {
    const id = created.pop();
    if (id) subAgentManager.remove(id);
  }
  lastTurnArgs = null;
  subAgentManager.setOnSubStatusChange(() => { /* 기본은 조용히 */ });
});

describe('로컬 턴 — 실행 → 실행중 → 실행완료', () => {
  it('이미지를 가진 기존 큐는 텍스트만 보내지 않고 명시적 실패로 끝낸다', () => {
    const sub = newSub('agent-local-image', 'sub-local-image');
    const cmd = makeCmd(sub.id, 'Describe the attached image');
    cmd.attachments = ['/fixture/image.png'];
    subAgentManager.execute(cmd, PARENT_CWD, '', localConfig());
    expect(lastTurnArgs).toBeNull();
    expect(cmd.status).toBe('error');
    expect(cmd.error).toMatchObject({ code: 'local', detail: 'local-images-unsupported' });
    expect(subAgentManager.isSubProcessingCommand(sub.id)).toBe(false);
    expect(subAgentManager.isSubRunning(sub.id)).toBe(false);
  });
  it('명령이 나가는 그 순간 실행중이 되고, 시작 시각과 상태 통지가 함께 나간다', () => {
    const agentId = 'agent-local-start';
    const sub = newSub(agentId, 'sub-local-start');
    const notified: string[] = [];
    subAgentManager.setOnSubStatusChange((pid) => notified.push(pid));

    const cmd = makeCmd(sub.id);
    subAgentManager.execute(cmd, PARENT_CWD, '', localConfig());

    expect(subAgentManager.getSub(sub.id)!.status).toBe('active');
    expect(cmd.status).toBe('executing');
    // 로컬 갈림이 이 둘보다 먼저 return 하면 시작 시각·통지가 빠진다.
    expect(cmd.startedAt).toBeTypeOf('number');
    expect(notified).toContain(agentId);
  });

  it('턴이 도는 동안 생존 대조가 와도 실행중을 유지한다 — 완료로 튀지 않는다', () => {
    const sub = newSub('agent-local-live', 'sub-local-live');
    subAgentManager.execute(makeCmd(sub.id), PARENT_CWD, '', localConfig());

    // 이 두 술어가 곧 "돌고 있다"의 유일한 근거다(자식이 없는 경로라 다른 근거가 없다).
    expect(subAgentManager.isSubRunning(sub.id)).toBe(true);
    expect(subAgentManager.isSubProcessingCommand(sub.id)).toBe(true);

    // 5초마다 도는 대조 — 여기서 idle 로 내려가면 부모 버블이 거짓 완료가 된다.
    expect(subAgentManager.reconcileDeadActiveSubs()).not.toContain(sub.id);
    expect(subAgentManager.getSub(sub.id)!.status).toBe('active');
  });

  it('몇 번을 대조해도 실행중이다 — 완료 ↔ 동작 되풀이가 없다', () => {
    const sub = newSub('agent-local-flap', 'sub-local-flap');
    subAgentManager.execute(makeCmd(sub.id), PARENT_CWD, '', localConfig());

    for (let i = 0; i < 5; i += 1) {
      subAgentManager.reconcileDeadActiveSubs();
      expect(subAgentManager.getSub(sub.id)!.status).toBe('active');
    }
  });

  it('무활동 sweep 도 도는 턴을 걷지 못한다 — 오래 생각하는 모델이 완료로 세탁되지 않는다', () => {
    const sub = newSub('agent-local-sweep', 'sub-local-sweep');
    subAgentManager.execute(makeCmd(sub.id), PARENT_CWD, '', localConfig());

    // 임계 0 = "마지막 활동이 언제였든 걷어라". 확정 진실(도는 중)이 시간 추측을 이겨야 한다.
    expect(subAgentManager.sweepIdle(0)).not.toContain(sub.id);
    expect(subAgentManager.getSub(sub.id)!.status).toBe('active');
  });

  it('러너가 끝을 알리면 그때 한 번 실행완료로 내려간다', () => {
    const sub = newSub('agent-local-done', 'sub-local-done');
    const cmd = makeCmd(sub.id);
    subAgentManager.execute(cmd, PARENT_CWD, '', localConfig());
    expect(lastTurnArgs).not.toBeNull();

    lastTurnArgs!.onDone();

    expect(subAgentManager.getSub(sub.id)!.status).toBe('idle');
    expect(cmd.status).toBe('completed');
    // 끝난 턴은 더 이상 "도는 중"이 아니다 — 표식이 남으면 버블이 영영 실행중에 머문다.
    expect(subAgentManager.isSubProcessingCommand(sub.id)).toBe(false);
    expect(subAgentManager.isSubRunning(sub.id)).toBe(false);
  });

  it('끝난 뒤의 대조는 그 세션을 다시 건드리지 않는다 — 완료가 한 번으로 끝난다', () => {
    const sub = newSub('agent-local-after', 'sub-local-after');
    subAgentManager.execute(makeCmd(sub.id), PARENT_CWD, '', localConfig());
    lastTurnArgs!.onDone();

    // 이미 idle 이라 강등 대상이 아니고(도트 깜빡임 방지), 다시 active 로 올라가지도 않는다.
    expect(subAgentManager.reconcileDeadActiveSubs()).not.toContain(sub.id);
    expect(subAgentManager.getSub(sub.id)!.status).toBe('idle');
  });

  it('실패로 끝난 턴은 실패로 남는다 — 완료로 세탁하지 않는다', () => {
    const sub = newSub('agent-local-err', 'sub-local-err');
    const cmd = makeCmd(sub.id);
    subAgentManager.execute(cmd, PARENT_CWD, '', localConfig());

    lastTurnArgs!.onDone('engine responded 400');

    expect(subAgentManager.getSub(sub.id)!.status).toBe('error');
    expect(subAgentManager.isSubProcessingCommand(sub.id)).toBe(false);
  });

  it('모델을 안 고른 버블은 도는 중으로 남지 않는다 — 그 자리에서 끝난다', () => {
    const sub = newSub('agent-local-nomodel', 'sub-local-nomodel');
    const config = localConfig();
    config.provider!.modelId = '';

    subAgentManager.execute(makeCmd(sub.id), PARENT_CWD, '', config);

    expect(subAgentManager.isSubProcessingCommand(sub.id)).toBe(false);
    expect(subAgentManager.reconcileDeadActiveSubs()).not.toContain(sub.id);
  });

  it('탭을 없애면 실행 표식도 함께 걷힌다 — 사라진 탭이 부모를 붙들지 않는다', () => {
    const sub = newSub('agent-local-remove', 'sub-local-remove');
    subAgentManager.execute(makeCmd(sub.id), PARENT_CWD, '', localConfig());
    expect(subAgentManager.isSubProcessingCommand(sub.id)).toBe(true);

    subAgentManager.remove(sub.id);
    expect(subAgentManager.isSubProcessingCommand(sub.id)).toBe(false);
    expect(subAgentManager.isSubRunning(sub.id)).toBe(false);
  });
});
