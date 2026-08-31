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

import { agentBadgeShare, isSessionRunning, resolveSessionRunState } from '@vibisual/shared';
import type {
  BubbleData,
  ProjectAgentCounts,
  QueuedCommand,
  RunningSubagentTask,
  SessionRunState,
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

/* ────────────────────────────────────────────────────────────────────────────
 * 에이전트 **한 줄**의 실행 요약 — [창과 버블] 메뉴 목록이 쓰는 값.
 *
 * 배지(위 집계)는 프로젝트 전체를 하나의 숫자로 접는다. 그런데 그 배지를 눌러 열리는 목록은
 * 종전에 **실행 상태를 아예 그리지 않았다** — 왼쪽 도트가 "이 에이전트에 IDE 창이 떠 있는가"만
 * 말했고, 하필 그 색이 세션 도트의 "도는 중"과 **같은 파랑**이었다. 그래서 세션이 파랗게 도는
 * 에이전트라도 창이 없으면 목록에서는 불이 꺼진 것으로 보였다(사용자 보고: "분명 파란불로 세션
 * 동작중인게 있는데 여기선 불이 꺼져있어").
 *
 * 판정은 **배지와 같은 입력·같은 함수**를 쓴다. 목록이 자기 식으로 다시 세면 배지가 `4/52` 인데
 * 목록에는 도는 줄이 하나도 없는 식으로 둘이 갈라진다.
 * ──────────────────────────────────────────────────────────────────────────── */

/** 목록 한 줄이 그리는 값 — 색은 `state`, 숫자는 `running/sessions`. */
export interface AgentRunSummary {
  /** 도트 색·라벨 어휘(세션 탭·사이드바와 **같은 표**를 쓴다). */
  state: SessionRunState;
  /** 이 에이전트의 세션 수(세션이 없으면 자기 자신을 1로 친다 — 배지와 같은 규칙). */
  sessions: number;
  /** 그중 지금 도는 수. */
  running: number;
}

/** `resolveAgentRunSummary` 가 store 에서 집어 오는 조각들. */
export interface AgentRunSummarySources {
  subAgents: Record<string, SubAgent[]>;
  queuedCommands: Record<string, QueuedCommand[]>;
  runningSubagentTasks: Record<string, RunningSubagentTask[]>;
  /** 사용자가 완료를 확인한 세션들(`acknowledgedSubAgents`) — 초록(미확인)/회색(확인)을 가른다. */
  acknowledged: Record<string, true>;
}

/**
 * 에이전트 버블 하나의 표시 상태를 접는다.
 *
 * 우선순위는 **도는 것이 먼저**다 — 지난 턴이 실패했든 예전에 끝났든, 지금 도는 세션이 하나라도
 * 있으면 사용자에게 그 줄은 "도는 중"이다(배지의 `running > 0 → 파랑` 과 같은 감각). 그다음이
 * 실패, 그다음이 "끝났는데 아직 안 봤다", 마지막이 조용함이다.
 *
 * ⚠ `running` 숫자는 `isSessionRunning` 으로, 색은 `resolveSessionRunState` 로 각각 낸다 —
 *   후자는 `error` 를 먼저 보므로(실패한 턴이 자식 때문에 "도는 중"으로 세탁되면 안 된다) 그것으로
 *   숫자까지 세면 배지와 목록의 분자가 갈라진다. 입력(`buildSessionRunInputs`)은 한 번만 만든다.
 */
export function resolveAgentRunSummary(
  agent: BubbleData,
  src: AgentRunSummarySources,
): AgentRunSummary {
  const subs = src.subAgents[agent.id] ?? [];
  const commands = src.queuedCommands[agent.id];
  const runningTasks = src.runningSubagentTasks[agent.id];
  const inputs = subs.map((sub) => buildSessionRunInputs({
    sub,
    commands,
    runningTasks,
    acknowledged: src.acknowledged[sub.id] === true,
  }));
  const share = agentBadgeShare({
    bubbleRunning: bubbleRunning(agent),
    sessionRunning: inputs.map(isSessionRunning),
  });
  const sessionStates = inputs.map(resolveSessionRunState);
  const bubbleState = NODE_STATUS_RUN_STATE[agent.status];

  const state: SessionRunState = share.running > 0
    ? 'running'
    : bubbleState === 'error' || sessionStates.includes('error')
      ? 'error'
      : agent.status === 'completed' || sessionStates.includes('doneUnseen')
        ? 'doneUnseen'
        : 'done';

  return { state, sessions: share.sessions, running: share.running };
}
