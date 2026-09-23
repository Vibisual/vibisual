import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DEFAULT_SESSION_PROBE_SETTINGS, type QueuedCommand, type SessionLivenessProbeResult } from '@vibisual/shared';

/**
 * §5.3 #10-2 — **띄운 위임의 결과를 받지 못한 턴은 완료로 끝나지 않는다.**
 *
 * 반환 엣지가 있는 dispatch 는 대기가 풀려도(제한시간·조회 거절·연결 끊김) 작업이 계속 돈다. 그 자리에서 턴이 끝나면
 * 부모는 초록 "완료"로 서서 결과를 받지 않고 끝난 것이 가려졌다. 여기서는 턴 끝 경로 하나(세션 판정 자동 종료)를
 * 실제로 돌려 가드가 사유와 cmdId 를 남기는지 본다 — 나머지 끝 경로의 배선은 `taskEdgeDispatchJobs.test.ts` 가 소스로 고정한다.
 */

let probeAnswer: SessionLivenessProbeResult | null = null;

vi.mock('./sessionLivenessProbe.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./sessionLivenessProbe.js')>();
  return {
    ...real,
    runSessionLivenessProbe: () => Promise.resolve(probeAnswer),
    // 사용자의 `~/.claude/projects` 를 읽지 않는다.
    resolveSessionTranscript: () => ({ file: '/tmp/guard.jsonl', bytes: 1_000, mtimeMs: Date.now() - 30 * 60_000 }),
    summarizeTranscriptTail: () => 'assistant: done',
  };
});

const { SubAgentManager } = await import('./subAgentManager.js');

const PARENT = 'agent-dispatch-guard';
const HOOK_SESSION = 'hook-session-guard';

let m: InstanceType<typeof SubAgentManager>;
let subId: string;

const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i += 1) await new Promise((r) => { setTimeout(r, 0); });
};

/** 모델이 턴을 마쳐 세션 판정이 "끝났다"고 내리는 자리까지 돌린다. */
const endTurn = async (): Promise<QueuedCommand> => {
  const held: QueuedCommand = { id: 'cmd-parent-turn', text: '작업 맡기고 결과 받아와', timestamp: Date.now() - 60 * 60_000, subAgentId: subId, status: 'executing', startedAt: Date.now() - 50 * 60_000 };
  probeAnswer = { at: Date.now(), verdict: 'finished', reason: '요약을 쓰고 멈췄다' };
  m.maybeProbeRunningSessions(new Map([[HOOK_SESSION, [held]]]));
  await settle();
  return held;
};

beforeEach(() => {
  probeAnswer = null;
  m = new SubAgentManager();
  m.setSessionProbeSettings(DEFAULT_SESSION_PROBE_SETTINGS);
  subId = m.create(PARENT).id;
  const sub = m.getSub(subId)!;
  sub.sessionId = randomUUID();
  sub.status = 'active';
  sub.createdAt = Date.now() - 58 * 60_000;
  m.markCmdSubActivity(`term:${PARENT}:${subId}`, false);
});

describe('§5.3 #10-2 — 결과를 받지 못한 턴의 끝', () => {
  it('fails the turn with the cmdIds and states to resume when a dispatch result has not reached it', async () => {
    const asked: string[] = [];
    m.setPendingDispatchResultsProvider((id) => {
      asked.push(id);
      return [{ cmdId: 'cmd-slow-edge1', status: 'executing' }, { cmdId: 'cmd-failed-edge2', status: 'error' }];
    });

    const held = await endTurn();

    expect(asked).toEqual([subId]);
    expect(held.status).toBe('error');
    // `engine` 은 §5.5 #17-12 ③-7 로 모든 사유에 함께 실린다 — 화면 문장이 제 엔진 이름을 부르기 위함이다.
    //   이 시험에는 설정 해석기가 없어 기본 엔진(`claude`)으로 떨어진다.
    expect(held.error).toEqual({
      code: 'dispatchResult',
      detail: 'cmd-slow-edge1 (executing), cmd-failed-edge2 (error)',
      engine: 'claude',
    });
    expect(m.getSub(subId)!.status).toBe('error');
  });

  it('finishes as completed once every result was received', async () => {
    m.setPendingDispatchResultsProvider(() => []);

    const held = await endTurn();

    expect(held.status).toBe('completed');
    expect(held.error).toBeUndefined();
    expect(m.getSub(subId)!.status).toBe('idle');
  });

  it('changes nothing when no dispatch ledger is wired', async () => {
    const held = await endTurn();

    expect(held.status).toBe('completed');
    expect(held.error).toBeUndefined();
  });
});
