/**
 * 헤더 배지 집계 — 화면과 같은 기준: ① 휴지통 제외(`BubbleMap` 의 `!a.trashed`) ② 세는 단위는 버블이 아니라 세션(IDE 탭·sub 버블)
 * ③ 판정은 `isSessionRunning`(shared) 한 곳 — 새 판정을 만들지 않는다(§3.1).
 */

import { agentBadgeShare, isSessionRunning, resolveSessionRunState } from '@vibisual/shared';
import type {
  BubbleData,
  ProjectAgentCounts,
  QueuedCommand,
  RunningSubagentTask,
  SessionRunInputs,
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
  /**
   * §2.4 (한도 정지) — 그중 **요금제 한도로 끊긴 채 다시 돌지 않은** 세션 수.
   * 도는 것이 하나도 없는데 이 수가 0 이 아니면 배지는 주황이다(끝난 게 아니라 멈춘 것이다).
   */
  limited: number;
}

export const EMPTY_HEADER_AGENT_COUNTS: HeaderAgentCounts = {
  agents: 0,
  sessions: 0,
  running: 0,
  completed: 0,
  limited: 0,
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
    // §2.4 (한도 정지) — 서버 집계(`getAgentCountsByProject`)와 **같은 규칙**이다:
    //   한도 표식이 서 있고 지금 돌지 않는 세션만 센다(주황과 파랑이 같은 세션을 두고 다투지 않게).
    counts.limited += subs.filter((sub, i) => sub.usageLimit !== undefined && !sessionRunning[i]).length;
  }

  return counts;
}

/** 서버 프로젝트 집계 → 배지 값. 있으면 이것이 SSOT(§3.1) — 배경 탭은 `agents` 가 안 실려 와 직접 세면 0 이다. */
export function headerCountsFromServed(served: ProjectAgentCounts): HeaderAgentCounts {
  return {
    agents: served.total,
    sessions: served.sessions,
    running: served.running,
    completed: served.completed,
    // 이 축이 생기기 전 스냅샷에는 없다 — 없으면 "멈춘 것이 없다"로 읽는다(§3.2.1-5 하위 호환).
    limited: served.limited ?? 0,
  };
}

/** 서버 집계 우선, 없으면 직접 센다. `sessions`/`running` 없는 옛 스냅샷은 통째로 폴백한다(섞으면 분자·분모 축이 갈린다). */
export function resolveHeaderAgentCounts(
  served: ProjectAgentCounts | undefined,
  src: HeaderAgentCountSources,
): HeaderAgentCounts {
  if (served && typeof served.sessions === 'number' && typeof served.running === 'number') {
    return headerCountsFromServed(served);
  }
  return computeHeaderAgentCounts(src);
}

/*
 * 에이전트 **한 줄**의 실행 요약 — [창과 버블] 메뉴 목록이 쓰는 값.
 * 목록도 실행 상태를 그린다 — 창 유무 도트만 그리면 창 없이 도는 에이전트가 꺼진 것으로 보인다.
 * 판정은 배지와 같은 입력·같은 함수로 — 목록이 따로 세면 배지는 `4/52` 인데 목록에 도는 줄이 없는 식으로 갈라진다.
 */

/** 목록 한 줄이 그리는 값 — 색은 `state`, 숫자는 `running/sessions`. */
export interface AgentRunSummary {
  /** 도트 색·라벨 어휘(세션 탭·사이드바와 **같은 표**를 쓴다). */
  state: SessionRunState;
  /** 이 에이전트의 세션 수(세션이 없으면 자기 자신을 1로 친다 — 배지와 같은 규칙). */
  sessions: number;
  /** 그중 지금 도는 수. */
  running: number;
  /** §2.4 (한도 정지) — 그중 한도로 끊긴 채 다시 돌지 않은 수. 줄에 "N개 멈춤"으로 적는다. */
  limited: number;
  /**
   * 원문에 적힌 리셋 표기(`10pm (Asia/Seoul)`) — **번역하지 않는다**(사용자가 CLI 에서 본 그 글자다).
   * 카운트다운으로 바꾸지 않는 이유: 1분마다 돌아야 하는 시계를 헤더 메뉴에 들이지 않기 위해서다.
   */
  limitLabel?: string;
  /** 한도 통지 원문 한 줄 — 툴팁에 그대로 붙인다. */
  limitMessage?: string;
  /**
   * 이 줄을 누르면 창에 세울 세션 — 색과 같은 계산에서 낸다: 그 색을 만든 세션 중 가장 최근(`lastActivityAt`).
   * `null` = 짚을 세션 없음(`done` 회색 · 색이 버블 상태에서만 온 경우: 권한 대기 버블·`error` 버블) → 마지막에 보던 세션을 연다.
   */
  focusSessionId: string | null;
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
 * 버블 하나의 표시 상태. 우선순위: 도는 것 → 한도 정지(§2.4, 실패보다 구체적) → 실패 → 끝났는데 안 봄 → 조용함.
 * ⚠ 숫자(`running`)는 `isSessionRunning`, 색은 `resolveSessionRunState` — 후자는 `error` 를 먼저 봐 숫자에 쓰면 배지와 분자가 갈린다. 입력은 한 번만 만든다.
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
    : sessionStates.includes('limited')
      ? 'limited'
      : bubbleState === 'error' || sessionStates.includes('error')
        ? 'error'
        // §5.5 #17-18 (대기) — **완료보다 먼저 본다.** 줄 선 명령이 하나라도 있으면 그 버블은
        //   끝난 것이 아니다. 여기서 빠뜨리면 헤더 배지만 초록 "끝남"으로 앞서 나가, 정작 탭
        //   도트는 보라로 켜져 있는데 위쪽 한 줄이 사용자를 안심시킨다.
        : sessionStates.includes('waiting')
          ? 'waiting'
          : agent.status === 'completed' || sessionStates.includes('doneUnseen')
            ? 'doneUnseen'
            : 'done';

  // §2.4 (한도 정지) — 표시 재료는 **끊긴 것으로 판정된 세션**에서만 꺼낸다(다시 돌린 세션에
  //   남아 있는 옛 표식을 주워 오면 도는 줄에 "멈춤"이 붙는다).
  const limitedSubs = subs.filter((_, i) => sessionStates[i] === 'limited');
  const notice = limitedSubs.map((s) => s.usageLimit).find((u) => u !== undefined);

  return {
    state,
    sessions: share.sessions,
    running: share.running,
    limited: limitedSubs.length,
    focusSessionId: pickFocusSession(subs, inputs, sessionStates, state),
    ...(notice?.resetsLabel ? { limitLabel: notice.resetsLabel } : {}),
    ...(notice?.message ? { limitMessage: notice.message } : {}),
  };
}

/**
 * `focusSessionId` 산식 — 그 색을 만든 세션 중 가장 최근. `running` 만은 색표가 아니라 `isSessionRunning`(줄이 파란 근거)으로 맞춘다 —
 * 실패 표식이 남은 채 도는 세션은 세션 색이 빨강이라 색표로는 못 찾는다. `done` 은 고르지 않고, 동점이면 먼저 선 세션(`>` — 흔들리지 않게).
 */
function pickFocusSession(
  subs: readonly SubAgent[],
  inputs: readonly SessionRunInputs[],
  sessionStates: readonly SessionRunState[],
  state: SessionRunState,
): string | null {
  if (state === 'done') return null;
  const matches = (i: number): boolean => (
    state === 'running' ? isSessionRunning(inputs[i]!) : sessionStates[i] === state
  );
  let best: SubAgent | null = null;
  for (let i = 0; i < subs.length; i += 1) {
    if (!matches(i)) continue;
    const sub = subs[i]!;
    if (best === null || sub.lastActivityAt > best.lastActivityAt) best = sub;
  }
  return best?.id ?? null;
}
