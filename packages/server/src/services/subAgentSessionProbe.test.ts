import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_SESSION_PROBE_SETTINGS,
  SESSION_PROBE_BACKOFF_FACTOR,
  SESSION_PROBE_MAX_PER_HOUR,
  type QueuedCommand,
  type SessionLivenessProbeResult,
} from '@vibisual/shared';
import type { SessionProbeEvidence } from './sessionLivenessProbe.js';

/**
 * §2.4 — **도는 중으로 서 있는 세션 하나를 10분마다 물어본다.**
 *
 * 판정 자체(프롬프트 구조·답 파싱·대화록 꼬리)는 `sessionLivenessProbe.test.ts` 가 이미 굳혔다.
 * 여기서 보는 것은 **오케스트레이션**이다 — 누구에게 묻고, 답을 어떻게 반영하고, 무엇을 안 건드리나.
 *
 * 계약은 한 방향이다: **확실할 때만 손댄다.**
 *  · 기존 다섯 장치가 걷을 수 있는 자리면 묻지 않는다(`hasLivingWork` 이 거짓이면 그쪽 소관).
 *  · 답이 `working`/`unknown`/실패면 세션을 그대로 둔다.  · `finished` + 자동종료일 때만 내린다.
 */

/** 판정 1회를 가로챈다 — 진짜 모델을 부르지 않는다. */
const probeCalls: { evidence: SessionProbeEvidence; model: string }[] = [];
let probeAnswer: SessionLivenessProbeResult | null = null;
/** 대화록 조회도 가로챈다 — 테스트가 사용자의 `~/.claude/projects` 를 읽으면 안 된다. */
let transcript: { file: string; bytes: number; mtimeMs: number } | null = null;

vi.mock('./sessionLivenessProbe.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./sessionLivenessProbe.js')>();
  return {
    ...real,
    runSessionLivenessProbe: (evidence: SessionProbeEvidence, model: string) => {
      probeCalls.push({ evidence, model });
      return Promise.resolve(probeAnswer);
    },
    resolveSessionTranscript: () => transcript,
    summarizeTranscriptTail: () => 'called tool: Bash\ntool result: building…',
  };
});

const { SubAgentManager } = await import('./subAgentManager.js');

const PARENT = 'agent-sessprobe';
/**
 * 명령 큐의 키. **일부러 `sub.sessionId` 와 다른 값**을 쓴다 — 실제 서버의 `commandQueues` 는
 * 훅 세션 id(`graphManager.findSessionByAgentId`)로 키가 잡히는데 `SubAgent.sessionId` 는 CLI 가
 * 발급한 세션 UUID 라 **서로 다른 namespace** 이기 때문이다. 둘을 같게 두면 키를 잘못 짚어도
 * 테스트가 초록으로 지나간다(이 파일이 처음 잡은 결함이 정확히 그것이다).
 */
const HOOK_SESSION = 'hook-session-xyz';

let m: InstanceType<typeof SubAgentManager>;
let subId: string;
let sessionId: string;

/** 조용해진 지 `quietMinutes` 분 된 대화록이 있는 것으로 둔다. */
const seedTranscript = (quietMinutes: number, bytes = 2_464_869): void => {
  transcript = { file: `/tmp/${sessionId}.jsonl`, bytes, mtimeMs: Date.now() - quietMinutes * 60_000 };
};

/** 큐 하나짜리 맵 — 키는 훅 세션 id 다. */
const queuesWith = (...cmds: QueuedCommand[]): Map<string, QueuedCommand[]> =>
  new Map([[HOOK_SESSION, cmds]]);

const cmd = (over: Partial<QueuedCommand> & { id: string }): QueuedCommand => ({
  text: '빌드 돌려줘',
  timestamp: Date.now() - 60 * 60_000,
  subAgentId: subId,
  status: 'queued',
  ...over,
});

/** 착수 → 판정 반영 → in-flight 해제까지가 비동기다(`then → catch → finally` 사슬). */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i += 1) await new Promise((r) => { setTimeout(r, 0); });
};

beforeEach(() => {
  probeCalls.length = 0;
  probeAnswer = null;

  m = new SubAgentManager();
  m.setSessionProbeSettings(DEFAULT_SESSION_PROBE_SETTINGS);
  subId = m.create(PARENT).id;
  sessionId = randomUUID();
  const sub = m.getSub(subId)!;
  sub.sessionId = sessionId;
  sub.label = '릴리스 준비';
  sub.status = 'active';
  sub.createdAt = Date.now() - 58 * 60_000;
  // 살아 있는 일이 있어야 이 축이 쳐다본다 — 없으면 기존 다섯 장치가 걷을 자리다.
  m.markCmdSubActivity(`term:${PARENT}:${subId}`, false);
  seedTranscript(30);
});

describe('누구에게 묻나 — 기존 장치가 못 닿는 자리에만', () => {
  it('도는 중 + 살아 있는 일 + 오래 조용하면 묻는다', async () => {
    m.maybeProbeRunningSessions(queuesWith());
    await settle();

    expect(probeCalls).toHaveLength(1);
    expect(probeCalls[0]?.model).toBe(DEFAULT_SESSION_PROBE_SETTINGS.model);
    expect(probeCalls[0]?.evidence.subId).toBe(subId);
    expect(probeCalls[0]?.evidence.label).toBe('릴리스 준비');
    expect(probeCalls[0]?.evidence.quietMin).toBeGreaterThanOrEqual(29);
    expect(probeCalls[0]?.evidence.startedAgoMin).toBeGreaterThanOrEqual(57);
  });

  it('살아 있는 일이 없으면 묻지 않는다 — 그건 기존 다섯 장치 소관이다', async () => {
    m.markCmdSubActivity(`term:${PARENT}:${subId}`, true); // PTY 를 놓는다

    m.maybeProbeRunningSessions(queuesWith());
    await settle();

    expect(probeCalls).toHaveLength(0);
  });

  it('도는 중으로 서 있지 않으면 묻지 않는다', async () => {
    m.getSub(subId)!.status = 'idle';

    m.maybeProbeRunningSessions(queuesWith());
    await settle();

    expect(probeCalls).toHaveLength(0);
  });

  it('아직 조용하지 않으면 묻지 않는다 — 시간은 착수 조건이다', async () => {
    seedTranscript(1);

    m.maybeProbeRunningSessions(queuesWith());
    await settle();

    expect(probeCalls).toHaveLength(0);
  });

  it('대화록을 못 찾으면 묻지 않는다 — 판정 근거가 없다', async () => {
    transcript = null;

    m.maybeProbeRunningSessions(queuesWith());
    await settle();

    expect(probeCalls).toHaveLength(0);
  });

  it('꺼 두면 아무 것도 하지 않는다', async () => {
    m.setSessionProbeSettings({ ...DEFAULT_SESSION_PROBE_SETTINGS, enabled: false });

    m.maybeProbeRunningSessions(queuesWith());
    await settle();

    expect(probeCalls).toHaveLength(0);
  });
});

describe('증거 — 큐는 키가 아니라 소유로 찾는다', () => {
  it('큐 키가 `sub.sessionId` 와 달라도 그 세션의 대기 명령을 센다', async () => {
    m.maybeProbeRunningSessions(queuesWith(
      cmd({ id: 'c1' }),
      cmd({ id: 'c2' }),
      cmd({ id: 'c3', subAgentId: 'sub-남의탭' }), // 남의 것은 안 센다
      cmd({ id: 'c4', status: 'completed' }),      // 끝난 것도 안 센다
    ));
    await settle();

    expect(probeCalls[0]?.evidence.queuedCommandCount).toBe(2);
  });

  it('큐가 비어 있으면 0 — 없는 사실을 지어내지 않는다', async () => {
    m.maybeProbeRunningSessions(queuesWith());
    await settle();

    expect(probeCalls[0]?.evidence.queuedCommandCount).toBe(0);
  });
});

describe('답 반영 — 확실할 때만 손댄다', () => {
  it('`finished` + 자동종료면 세션을 내리고 붙들린 명령까지 푼다', async () => {
    probeAnswer = { at: Date.now(), verdict: 'finished', reason: '마무리 요약을 쓰고 멈췄다' };
    const held = cmd({ id: 'c1', status: 'executing', startedAt: Date.now() - 50 * 60_000 });

    m.maybeProbeRunningSessions(queuesWith(held));
    await settle();

    const sub = m.getSub(subId)!;
    expect(sub.status).toBe('idle');
    expect(sub.probe?.verdict).toBe('finished');
    // 상태만 내리고 명령을 안 풀면 그 탭은 "쉬는 중"인데 새 명령은 못 받는 자리에 갇힌다.
    expect(held.status).toBe('completed');
    expect(held.result).toContain('마무리 요약을 쓰고 멈췄다');
  });

  it('자동종료를 꺼 두면 판정만 붙이고 내리지는 않는다', async () => {
    probeAnswer = { at: Date.now(), verdict: 'finished', reason: '끝났다' };
    m.setSessionProbeSettings({ ...DEFAULT_SESSION_PROBE_SETTINGS, autoClose: false });
    const held = cmd({ id: 'c1', status: 'executing', startedAt: Date.now() - 50 * 60_000 });

    m.maybeProbeRunningSessions(queuesWith(held));
    await settle();

    expect(m.getSub(subId)!.status).toBe('active');
    expect(m.getSub(subId)!.probe?.verdict).toBe('finished');
    expect(held.status).toBe('executing');
  });

  it('`working` 이면 세션을 그대로 두고 판정만 남긴다', async () => {
    probeAnswer = { at: Date.now(), verdict: 'working', reason: '빌드 결과를 기다리는 중' };

    m.maybeProbeRunningSessions(queuesWith());
    await settle();

    expect(m.getSub(subId)!.status).toBe('active');
    expect(m.getSub(subId)!.probe?.verdict).toBe('working');
  });

  it('`stuck` 도 죽이지 않는다 — 사용자를 부를 뿐이다', async () => {
    probeAnswer = { at: Date.now(), verdict: 'stuck', reason: '사용자에게 질문하고 멈춰 있다' };

    m.maybeProbeRunningSessions(queuesWith());
    await settle();

    expect(m.getSub(subId)!.status).toBe('active');
    expect(m.getSub(subId)!.probe?.verdict).toBe('stuck');
  });

  it('답을 못 받으면 아무 일도 일어나지 않는다', async () => {
    probeAnswer = null;

    m.maybeProbeRunningSessions(queuesWith());
    await settle();

    expect(m.getSub(subId)!.status).toBe('active');
    expect(m.getSub(subId)!.probe).toBeUndefined();
  });

  it('묻는 동안에는 "확인 중" 이 켜지고 끝나면 꺼진다', async () => {
    probeAnswer = { at: Date.now(), verdict: 'working', reason: '도는 중' };

    m.maybeProbeRunningSessions(queuesWith());
    expect(m.getSub(subId)!.probing).toBe(true);
    await settle();
    expect(m.getSub(subId)!.probing).toBeUndefined();
  });
});

describe('예산 — 확인이 비용을 삼키면 안 된다', () => {
  it('한 번에 한 세션만 — 앞의 판정이 안 끝났으면 새로 안 띄운다', async () => {
    m.maybeProbeRunningSessions(queuesWith());
    m.maybeProbeRunningSessions(queuesWith());

    expect(probeCalls).toHaveLength(1);
    await settle();
  });

  it('`working` 이면 임계를 배수만큼 벌린다 — 같은 세션에 반복해 태우지 않는다', async () => {
    probeAnswer = { at: Date.now(), verdict: 'working', reason: '도는 중' };
    const q = DEFAULT_SESSION_PROBE_SETTINGS.quietMinutes;

    // 첫 임계(q)는 넘고, 배수가 붙은 다음 임계(q × factor)에는 못 미치는 자리.
    seedTranscript(q + 1);
    m.maybeProbeRunningSessions(queuesWith());
    await settle();
    expect(probeCalls).toHaveLength(1);

    // 조용한 시간이 그대로면 이제 임계 미달이다 — 다시 묻지 않는다.
    m.maybeProbeRunningSessions(queuesWith());
    await settle();
    expect(probeCalls).toHaveLength(1);

    // 넓어진 임계를 넘길 만큼 더 조용해지면 그때 다시 묻는다.
    seedTranscript(q * SESSION_PROBE_BACKOFF_FACTOR + 1);
    m.maybeProbeRunningSessions(queuesWith());
    await settle();
    expect(probeCalls).toHaveLength(2);
  });

  it('시간당 상한을 넘기면 멈춘다', async () => {
    probeAnswer = null; // 답이 없으면 백오프가 붙지만 상한은 그와 무관하게 먼저 막는다
    for (let i = 0; i < SESSION_PROBE_MAX_PER_HOUR + 5; i += 1) {
      seedTranscript(60 * (i + 1)); // 백오프를 넘길 만큼 조용하게 만들어 착수 조건은 늘 충족
      m.maybeProbeRunningSessions(queuesWith());
      await settle();
    }
    expect(probeCalls.length).toBeLessThanOrEqual(SESSION_PROBE_MAX_PER_HOUR);
  });
});
