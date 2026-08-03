/**
 * 완료음 발화 대상 판정 — **사용자가 커스텀 에이전트에 내린 명령이 끝났을 때만** 울린다.
 *
 * v3.76. 종전에는 WS `agent_status(isActive:false)` 를 그대로 완료로 받아 울렸는데, 그 신호는
 * "시스템 전체 활성 세션 0" 전이일 뿐이라 ① 두뇌 리플렉션 자식 세션 ② Vibisual 밖 다른 폴더에서
 * 돌린 claude 세션 ③ 훅 세션의 매 턴 종료까지 전부 완료로 잡혀, 사용자가 아무 명령도 내리지 않은
 * 유휴 상태에서 소리가 났다. 완료의 근거를 **커스텀 에이전트 버블의 completed 전이**로 옮긴다.
 *
 * §5.5 #17-11 ⑦ v3.84. 그 completed 전이는 "이 버블 밑에서 도는 것이 지금 0" 일 때마다 일어나므로
 * **매 턴·매 루프 회차마다** 성립한다. `SESSION_LOOP_DEFAULT_INTERVAL_MS=0` 인 세션 루프에서는
 * 회차가 끝나자마자 다음 회차가 붙어, 에이전트가 멀쩡히 일하는 중에 완료음이 계속 울렸다
 * (사용자 보고). 그래서 **진행 중 루프를 가진 에이전트는 침묵**시키고, 그 에이전트의 **루프 묶음이
 * 끝나는 순간 한 번만** 울린다.
 */
import type { BubbleData, NodeStatus, SessionLoop } from '@vibisual/shared';

/** 버블 id → 직전 스냅샷에서의 상태. 전이(≠completed → completed)만 집어내기 위한 최소 상태. */
const lastStatusById = new Map<string, NodeStatus>();

/** 에이전트 id → 직전 스냅샷에서 **진행 중 루프를 갖고 있었는가**. true→false 가 "루프 묶음 종료". */
const lastLoopRunningById = new Map<string, boolean>();

/** 첫 스냅샷은 기준선으로만 삼는다 — 부팅 시점에 이미 completed 인 버블로 소리가 나면 안 된다. */
let seeded = false;

/** 완료음이 울린 이유 — 알림 문구를 가른다. */
export type CompletionReason = 'agent' | 'loop';

export interface CompletionEvent {
  agent: BubbleData;
  reason: CompletionReason;
}

/** 진행 중 = 다음 회차를 계속 낼 것이고, 지금 돌거나 회차 사이 대기 중. */
function isLoopRunning(loop: SessionLoop): boolean {
  return loop.enabled && (loop.status === 'running' || loop.status === 'waiting');
}

/**
 * 알릴 가치가 있는 종료인가 — 목표 도달(`done`)·오류 정지(`error`) 만.
 *
 * `stopped` 는 사용자가 방금 [정지]를 누른 결과라 소리가 정보를 주지 못하고("왜 지금 울려?"),
 * 설정이 삭제돼 루프 자체가 사라진 경우도 마찬가지다 — 둘 다 침묵.
 */
function isLoopFinished(loop: SessionLoop): boolean {
  return loop.status === 'done' || loop.status === 'error';
}

/**
 * 이번 스냅샷에서 **새로 완료된 커스텀 에이전트**만 돌려준다.
 *
 * 커스텀 에이전트의 `completed` 는 서버가 서브에이전트 대차대조까지 반영해 매기므로
 * (`recomputeCustomAgentStatus`), 배경 서브가 남아 있는 동안에는 여기로 오지 않는다.
 *
 * `sessionLoops` 는 스냅샷에 실려 오는 서버 SSOT 를 그대로 받는다(키 = subAgentId).
 * 루프는 세션 탭 단위지만 소리의 단위는 **에이전트**라, 한 에이전트의 루프들을 묶어서 본다.
 */
export function detectCustomAgentCompletions(
  agents: BubbleData[],
  sessionLoops?: Record<string, SessionLoop>,
): CompletionEvent[] {
  // 에이전트 단위로 접은 루프 상태 — 탭이 여러 개면 루프도 여러 개다.
  const loopRunningAgents = new Set<string>();
  const loopFinishedAgents = new Set<string>();
  for (const loop of Object.values(sessionLoops ?? {})) {
    if (isLoopRunning(loop)) loopRunningAgents.add(loop.agentId);
    if (isLoopFinished(loop)) loopFinishedAgents.add(loop.agentId);
  }

  const done: CompletionEvent[] = [];
  const seen = new Set<string>();

  for (const agent of agents) {
    seen.add(agent.id);
    const prevStatus = lastStatusById.get(agent.id);
    lastStatusById.set(agent.id, agent.status);

    const loopRunning = loopRunningAgents.has(agent.id);
    const prevLoopRunning = lastLoopRunningById.get(agent.id) ?? false;
    lastLoopRunningById.set(agent.id, loopRunning);

    if (!seeded) continue;
    if (!agent.customCreated) continue;

    // 루프 묶음 종료 — 마지막 진행 중 루프가 꺼진 순간 한 번. 이 패스의 버블 completed 전이는
    // 같은 사건의 다른 얼굴이므로 여기서 소비하고 흘린다(중복 발화 ❌).
    if (prevLoopRunning && !loopRunning) {
      if (loopFinishedAgents.has(agent.id)) done.push({ agent, reason: 'loop' });
      continue;
    }

    // 루프가 도는 동안에는 회차 경계마다 오는 완료 전이를 울리지 않는다.
    if (loopRunning) continue;

    if (agent.status === 'completed' && prevStatus !== undefined && prevStatus !== 'completed') {
      done.push({ agent, reason: 'agent' });
    }
  }

  // 사라진 버블은 기억에서 지운다 — 같은 id 가 나중에 되살아나도 낡은 상태로 오판하지 않게.
  for (const id of lastStatusById.keys()) {
    if (!seen.has(id)) lastStatusById.delete(id);
  }
  for (const id of lastLoopRunningById.keys()) {
    if (!seen.has(id)) lastLoopRunningById.delete(id);
  }

  seeded = true;
  return done;
}

/** 테스트 전용 — 모듈 전역 상태 초기화. */
export function __resetCompletionChimeStateForTest(): void {
  lastStatusById.clear();
  lastLoopRunningById.clear();
  seeded = false;
}
