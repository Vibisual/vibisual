/**
 * v3.76 — 완료음 발화 대상 판정 테스트.
 *
 * "아무 명령도 안 내렸는데 5분 40초마다 완료음이 울린다" 의 클라 쪽 대책. 소리의 근거를
 * 시스템 전역 신호에서 **커스텀 에이전트의 completed 전이**로 옮긴 것이 지켜지는지 고정한다.
 *
 * §5.5 #17-11 ⑦ v3.84 — 여기에 "세션 루프가 도는 동안은 침묵, 루프 묶음이 끝날 때 한 번" 을 더한다.
 * ("동작 중인데 완료음이 계속 울린다" 재발 방지 — 루프 회차 경계마다 completed 가 성립하던 문제.)
 *
 * §5.5 #17-11 ⑦ 개정 — 그 "루프 묶음 종료"가 두 번째 발화 지점이 되어 같은 종료로 소리가 두 번
 * 나던 것을 고친 뒤의 회귀 묶음이 파일 끝에 붙는다(발화 지점은 버블 completed 전이 하나).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { BubbleData, NodeStatus, SessionLoop, SessionLoopStatus } from '@vibisual/shared';
import {
  detectCustomAgentCompletions,
  __resetCompletionChimeStateForTest,
} from './completionChime.js';

const agent = (
  id: string,
  status: NodeStatus,
  customCreated: boolean,
): BubbleData => ({
  id,
  label: id,
  bubbleType: 'agent',
  path: `/tmp/${id}`,
  status,
  activity: 0,
  customCreated,
});

/** 세션 탭 하나에 붙은 루프. `enabled` 는 status 로부터 자연스럽게 정한다(진행 중이면 켜짐). */
const loop = (
  subAgentId: string,
  agentId: string,
  status: SessionLoopStatus,
  enabled = status === 'running' || status === 'waiting',
): SessionLoop => ({
  agentId,
  subAgentId,
  command: 'run one cycle',
  mode: 'infinite',
  completed: 1,
  enabled,
  intervalMs: 0,
  stopOnError: false,
  contextMode: 'none',
  spentCostUsd: 0,
  spentTokens: 0,
  oneTaskPerRound: false,
  commitEachRound: false,
  status,
  createdAt: 0,
  updatedAt: 0,
});

const loops = (...items: SessionLoop[]): Record<string, SessionLoop> =>
  Object.fromEntries(items.map((l) => [l.subAgentId, l]));

/** 한 회차 = active → completed. 루프가 도는 동안 이 전이가 회차마다 반복된다. */
const runOneCycle = (
  id: string,
  ls?: Record<string, SessionLoop>,
): ReturnType<typeof detectCustomAgentCompletions> => {
  detectCustomAgentCompletions([agent(id, 'active', true)], ls);
  return detectCustomAgentCompletions([agent(id, 'completed', true)], ls);
};

describe('detectCustomAgentCompletions', () => {
  beforeEach(() => {
    __resetCompletionChimeStateForTest();
  });

  it('첫 스냅샷은 기준선일 뿐 — 이미 completed 인 버블로 울리지 않는다', () => {
    const done = detectCustomAgentCompletions([agent('a', 'completed', true)]);
    expect(done).toHaveLength(0);
  });

  it('커스텀 에이전트가 active → completed 로 넘어오면 1건 잡는다', () => {
    detectCustomAgentCompletions([agent('a', 'active', true)]);
    const done = detectCustomAgentCompletions([agent('a', 'completed', true)]);
    expect(done.map((d) => d.agent.id)).toEqual(['a']);
    expect(done[0]?.reason).toBe('agent');
  });

  it('completed 가 이어지는 동안 반복해서 울리지 않는다', () => {
    detectCustomAgentCompletions([agent('a', 'active', true)]);
    detectCustomAgentCompletions([agent('a', 'completed', true)]);
    const again = detectCustomAgentCompletions([agent('a', 'completed', true)]);
    expect(again).toHaveLength(0);
  });

  it('커스텀이 아닌 훅 에이전트의 완료는 무시한다(매 턴 종료마다 오는 신호)', () => {
    detectCustomAgentCompletions([agent('hook', 'active', false)]);
    const done = detectCustomAgentCompletions([agent('hook', 'completed', false)]);
    expect(done).toHaveLength(0);
  });

  it('여러 커스텀 에이전트가 같은 스냅샷에서 끝나면 전부 잡는다', () => {
    detectCustomAgentCompletions([agent('a', 'active', true), agent('b', 'active', true)]);
    const done = detectCustomAgentCompletions([
      agent('a', 'completed', true),
      agent('b', 'completed', true),
    ]);
    expect(done.map((d) => d.agent.id).sort()).toEqual(['a', 'b']);
  });

  it('idle 로 내려갔다 다시 완료되면 그때 또 울린다(다음 명령의 완료)', () => {
    detectCustomAgentCompletions([agent('a', 'active', true)]);
    detectCustomAgentCompletions([agent('a', 'completed', true)]);
    detectCustomAgentCompletions([agent('a', 'idle', true)]);
    detectCustomAgentCompletions([agent('a', 'active', true)]);
    const done = detectCustomAgentCompletions([agent('a', 'completed', true)]);
    expect(done.map((d) => d.agent.id)).toEqual(['a']);
  });

  it('사라졌던 버블이 completed 로 다시 나타나도 낡은 상태로 울리지 않는다', () => {
    detectCustomAgentCompletions([agent('a', 'active', true)]);
    detectCustomAgentCompletions([]); // 버블 제거 → 기억에서도 삭제
    const done = detectCustomAgentCompletions([agent('a', 'completed', true)]);
    expect(done).toHaveLength(0);
  });

  // ─── §5.5 #17-11 ⑦ v3.84 — 세션 루프 ───

  it('루프가 도는 동안에는 회차가 몇 번 끝나도 울리지 않는다', () => {
    const running = loops(loop('sub-1', 'a', 'running'));
    expect(runOneCycle('a', running)).toHaveLength(0);
    expect(runOneCycle('a', running)).toHaveLength(0);
    expect(runOneCycle('a', running)).toHaveLength(0);
  });

  it('회차 사이 대기(waiting) 도 진행 중으로 보고 침묵한다', () => {
    const waiting = loops(loop('sub-1', 'a', 'waiting'));
    expect(runOneCycle('a', waiting)).toHaveLength(0);
  });

  it('루프가 목표를 채워 done 이 되면 그때 한 번 울린다', () => {
    runOneCycle('a', loops(loop('sub-1', 'a', 'running')));
    const done = detectCustomAgentCompletions(
      [agent('a', 'completed', true)],
      loops(loop('sub-1', 'a', 'done')),
    );
    expect(done.map((d) => d.agent.id)).toEqual(['a']);
    expect(done[0]?.reason).toBe('loop');
  });

  it('루프 종료로 울린 뒤 같은 상태가 이어져도 다시 울리지 않는다', () => {
    runOneCycle('a', loops(loop('sub-1', 'a', 'running')));
    const finished = loops(loop('sub-1', 'a', 'done'));
    detectCustomAgentCompletions([agent('a', 'completed', true)], finished);
    const again = detectCustomAgentCompletions([agent('a', 'completed', true)], finished);
    expect(again).toHaveLength(0);
  });

  it('오류로 멈춘 루프(error)도 끝난 것이므로 한 번 울린다', () => {
    runOneCycle('a', loops(loop('sub-1', 'a', 'running')));
    const done = detectCustomAgentCompletions(
      [agent('a', 'completed', true)],
      loops(loop('sub-1', 'a', 'error')),
    );
    expect(done.map((d) => d.reason)).toEqual(['loop']);
  });

  it('사용자가 직접 멈춘 루프(stopped)는 침묵한다 — 본인이 방금 누른 것', () => {
    runOneCycle('a', loops(loop('sub-1', 'a', 'running')));
    const done = detectCustomAgentCompletions(
      [agent('a', 'completed', true)],
      loops(loop('sub-1', 'a', 'stopped')),
    );
    expect(done).toHaveLength(0);
  });

  it('루프 설정이 삭제돼 사라진 경우도 침묵한다', () => {
    runOneCycle('a', loops(loop('sub-1', 'a', 'running')));
    const done = detectCustomAgentCompletions([agent('a', 'completed', true)], {});
    expect(done).toHaveLength(0);
  });

  it('탭이 여러 개면 마지막 루프가 끝날 때 한 번만 울린다', () => {
    const both = loops(loop('sub-1', 'a', 'running'), loop('sub-2', 'a', 'running'));
    expect(runOneCycle('a', both)).toHaveLength(0);
    // 하나만 끝남 — 다른 탭이 계속 도는 중이라 아직 침묵
    const one = loops(loop('sub-1', 'a', 'done'), loop('sub-2', 'a', 'running'));
    expect(detectCustomAgentCompletions([agent('a', 'completed', true)], one)).toHaveLength(0);
    // 마지막 탭까지 끝남 → 1회
    const all = loops(loop('sub-1', 'a', 'done'), loop('sub-2', 'a', 'done'));
    const done = detectCustomAgentCompletions([agent('a', 'completed', true)], all);
    expect(done.map((d) => d.reason)).toEqual(['loop']);
  });

  it('루프가 다른 에이전트 것이면 이 에이전트의 완료를 막지 않는다', () => {
    const other = loops(loop('sub-1', 'b', 'running'));
    detectCustomAgentCompletions([agent('a', 'active', true)], other);
    const done = detectCustomAgentCompletions([agent('a', 'completed', true)], other);
    expect(done.map((d) => d.agent.id)).toEqual(['a']);
    expect(done[0]?.reason).toBe('agent');
  });

  it('루프가 끝난 뒤 사용자가 직접 내린 명령의 완료는 다시 울린다', () => {
    runOneCycle('a', loops(loop('sub-1', 'a', 'running')));
    const finished = loops(loop('sub-1', 'a', 'done'));
    detectCustomAgentCompletions([agent('a', 'completed', true)], finished); // 루프 종료 1회
    detectCustomAgentCompletions([agent('a', 'idle', true)], finished);
    const done = runOneCycle('a', finished);
    expect(done.map((d) => d.reason)).toEqual(['agent']);
  });
  /**
   * §5.5 #17-11 ⑦ 개정 — 발화 지점 단일화 회귀.
   *
   * 실제 서버 순서는 "루프가 꺼진 스냅샷에서 버블은 아직 `active`" 다. 완료 판정은 큐 정리 뒤,
   * 늦으면 10초 전체 재계산에 실려 **다음 스냅샷**에 온다. 예전에는 두 프레임이 각각 소리를 내
   * 같은 종료로 두 번 울렸다(1.5초 중복 방지 창을 한참 넘어선다).
   */
  it('루프 종료와 버블 완료가 다른 스냅샷에 실려도 한 번만 울린다', () => {
    runOneCycle('a', loops(loop('sub-1', 'a', 'running')));
    const finished = loops(loop('sub-1', 'a', 'done'));
    // 프레임 1 — 루프는 꺼졌지만 버블은 아직 돌고 있다고 표시된다. 아직 종료가 아니다.
    expect(detectCustomAgentCompletions([agent('a', 'active', true)], finished)).toHaveLength(0);
    // 프레임 2 — 뒤늦게 완료 판정이 실린다. 여기가 유일한 발화 지점.
    const done = detectCustomAgentCompletions([agent('a', 'completed', true)], finished);
    expect(done.map((d) => d.reason)).toEqual(['loop']);
    // 프레임 3 — 같은 상태가 이어져도 더 울리지 않는다.
    expect(detectCustomAgentCompletions([agent('a', 'completed', true)], finished)).toHaveLength(0);
  });

  it('정지로 끝난 루프는 버블 완료가 늦게 실려도 끝까지 침묵한다', () => {
    runOneCycle('a', loops(loop('sub-1', 'a', 'running')));
    const stopped = loops(loop('sub-1', 'a', 'stopped'));
    expect(detectCustomAgentCompletions([agent('a', 'active', true)], stopped)).toHaveLength(0);
    expect(detectCustomAgentCompletions([agent('a', 'completed', true)], stopped)).toHaveLength(0);
  });

  it('예산 소진으로 끝난 루프도 늦게 실린 완료에서 한 번 울린다', () => {
    runOneCycle('a', loops(loop('sub-1', 'a', 'running')));
    const spent = loops(loop('sub-1', 'a', 'budget'));
    detectCustomAgentCompletions([agent('a', 'active', true)], spent);
    const done = detectCustomAgentCompletions([agent('a', 'completed', true)], spent);
    expect(done.map((d) => d.reason)).toEqual(['loop']);
  });

  it('루프 종료 예고는 한 번만 쓰이고 다음 완료는 일반 완료로 울린다', () => {
    runOneCycle('a', loops(loop('sub-1', 'a', 'running')));
    const finished = loops(loop('sub-1', 'a', 'done'));
    detectCustomAgentCompletions([agent('a', 'active', true)], finished);
    detectCustomAgentCompletions([agent('a', 'completed', true)], finished);
    const done = runOneCycle('a', finished);
    expect(done.map((d) => d.reason)).toEqual(['agent']);
  });

  it('루프가 끝난 뒤 버블이 실패로 주저앉으면 침묵하고, 예고를 뒤 명령이 물려받지 않는다', () => {
    runOneCycle('a', loops(loop('sub-1', 'a', 'running')));
    const failed = loops(loop('sub-1', 'a', 'error'));
    expect(detectCustomAgentCompletions([agent('a', 'active', true)], failed)).toHaveLength(0);
    // 실패는 완료가 아니다(§2.4) — 소리도, 예고도 남기지 않는다.
    expect(detectCustomAgentCompletions([agent('a', 'error', true)], failed)).toHaveLength(0);
    const done = runOneCycle('a', failed);
    expect(done.map((d) => d.reason)).toEqual(['agent']);
  });
});
