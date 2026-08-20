/**
 * 헤더 에이전트 배지 집계 — **"지금 몇 개가 돌고 있나"를 화면과 같은 기준으로 센다.**
 *
 * 종전 `Header` 는 두 가지를 자기 식으로 셌다. (a) 전체 수에 **휴지통에 넣은 에이전트까지** 넣고,
 * (b) 실행 여부를 **버블 상태 하나**로만 봤다. 그래서 세션 12개 중 5개가 도는 커스텀 에이전트 1개 +
 * 휴지통 17개인 프로젝트가 `1/20` 으로 보였다 — 사용자가 세는 것(도는 세션 5개)과도, 캔버스에 실제로
 * 있는 것(살아 있는 버블 3개)과도 맞지 않는 숫자다("동작중인 에이전트를 정상적으로 안 보여준다").
 *
 * 그래서 세 축을 캔버스·세션과 맞춘다.
 *  1. **휴지통 제외** — `BubbleMap` 이 `!a.trashed` 로 거르는 것과 같은 기준. 화면에 없는 버블은
 *     숫자에도 없어야 한다.
 *  2. **세션 축** — 사용자가 "동작 중"으로 세는 단위는 에이전트 버블이 아니라 **세션**(IDE 탭 ·
 *     내부 뷰의 sub 버블)이다. 한 버블 안에서 다섯 세션이 돌면 그것은 사용자에게 다섯이다.
 *  3. **판정은 공용 규약 재사용** — `isSessionRunning`(shared) 한 곳. 여기서 새 판정을 만들지 않는다
 *     (§3.1 서버 = SSOT, 클라 = View).
 */

import { agentBadgeShare, isSessionRunning } from '@vibisual/shared';
import type {
  BubbleData,
  ProjectAgentCounts,
  QueuedCommand,
  RunningSubagentTask,
  SubAgent,
} from '@vibisual/shared';
import { NODE_STATUS_RUN_STATE, buildSessionRunInputs } from '../../utils/sessionStatus.js';

/** 집계에 필요한 store 조각들 — 전부 서버가 준 값이다. */
export interface HeaderAgentCountSources {
  /** 스냅샷의 에이전트 버블 전체(전 프로젝트). */
  agents: BubbleData[];
  /** 버블 id → 프로젝트명. */
  agentProjects: Record<string, string>;
  /** 지금 보고 있는 프로젝트(worktree 드릴다운 중이면 그 worktree). null 이면 전부. */
  project: string | null;
  /** 에이전트 id → 세션 목록. */
  subAgents: Record<string, SubAgent[]>;
  /** 에이전트 id → 명령 큐. */
  queuedCommands: Record<string, QueuedCommand[]>;
  /** 에이전트 id → 지금 도는 백그라운드 Task. */
  runningSubagentTasks: Record<string, RunningSubagentTask[]>;
}

/** 배지가 그리는 값 — 숫자는 `running/sessions`, 색은 `running`·`completed` 가 정한다. */
export interface HeaderAgentCounts {
  /** 이 프로젝트에서 살아 있는(휴지통 아닌) 에이전트 버블 수 = 캔버스에 보이는 수. */
  agents: number;
  /** 그 버블들이 가진 세션 수(세션이 하나도 없는 버블은 자기 자신을 1로 친다). */
  sessions: number;
  /** 그중 지금 돌고 있는 수. */
  running: number;
  /** 방금 끝난(`completed`) 버블 수 — 도트 색 판정용. */
  completed: number;
}

export const EMPTY_HEADER_AGENT_COUNTS: HeaderAgentCounts = {
  agents: 0,
  sessions: 0,
  running: 0,
  completed: 0,
};

/**
 * 이 **버블**이 도는 중인가 — `active` 와 권한 승인 대기(훅이 동기 hold 중인 "블록된 활성").
 * 버블 상태를 세션 표시 어휘로 정규화한 표(`NODE_STATUS_RUN_STATE`)를 그대로 쓴다 — 같은 말을
 * 두 번 정의하지 않는다.
 */
function bubbleRunning(agent: BubbleData): boolean {
  return NODE_STATUS_RUN_STATE[agent.status] === 'running';
}

/**
 * 헤더 배지 숫자를 센다. 순수 함수 — store 를 직접 읽지 않으므로 단위 테스트로 고정할 수 있다.
 */
export function computeHeaderAgentCounts(src: HeaderAgentCountSources): HeaderAgentCounts {
  const counts: HeaderAgentCounts = { ...EMPTY_HEADER_AGENT_COUNTS };

  for (const agent of src.agents) {
    // 캔버스와 같은 필터 — 프로젝트가 다르거나 휴지통에 있으면 화면에 없으니 숫자에도 없다.
    if (src.project !== null && src.agentProjects[agent.id] !== src.project) continue;
    if (agent.trashed) continue;

    counts.agents += 1;
    if (agent.status === 'completed') counts.completed += 1;

    const subs = src.subAgents[agent.id] ?? [];
    const commands = src.queuedCommands[agent.id];
    const runningTasks = src.runningSubagentTasks[agent.id];
    const sessionRunning = subs.map((sub) => isSessionRunning(
      buildSessionRunInputs({ sub, commands, runningTasks, acknowledged: false }),
    ));
    // 세션 없는 버블 = 1 단위, 세션이 조용해도 버블이 돌면 1 — 규칙은 shared 가 갖는다.
    const share = agentBadgeShare({ bubbleRunning: bubbleRunning(agent), sessionRunning });
    counts.sessions += share.sessions;
    counts.running += share.running;
  }

  return counts;
}

/**
 * 서버가 준 프로젝트 집계를 배지 값으로 옮긴다 — **있으면 이것이 SSOT**(§3.1).
 *
 * 구독 범위 밖 프로젝트(배경 탭)는 클라에 `agents` 자체가 안 실려 오므로 직접 세면 0 이 된다.
 * 그래서 탭 배지와 헤더 배지는 둘 다 서버 집계를 우선하고, 없을 때만 손으로 센다.
 */
export function headerCountsFromServed(served: ProjectAgentCounts): HeaderAgentCounts {
  return {
    agents: served.total,
    sessions: served.sessions,
    running: served.running,
    completed: served.completed,
  };
}

/**
 * 서버 집계 우선, 없으면(구버전 스냅샷 · 아직 안 받은 첫 프레임) 직접 센다.
 *
 * `sessions`/`running` 이 없는 옛 스냅샷은 **부분 신뢰하지 않고** 통째로 폴백한다 —
 * 절반만 서버 값을 쓰면 분자와 분모가 서로 다른 축이 되어(도는 세션 수 / 버블 수) 숫자가 거짓말한다.
 */
export function resolveHeaderAgentCounts(
  served: ProjectAgentCounts | undefined,
  src: HeaderAgentCountSources,
): HeaderAgentCounts {
  if (served && typeof served.sessions === 'number' && typeof served.running === 'number') {
    return headerCountsFromServed(served);
  }
  return computeHeaderAgentCounts(src);
}
