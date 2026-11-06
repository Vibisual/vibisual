/**
 * 세션 실행 상태 단일 판정 — "지금 돌고 있는가"를 한 곳에서. 화면마다 `SubAgent.status`·`QueuedCommand.status`·`runningSubagentTasks` 를 따로 보면
 * 한쪽만 복구될 때 갈린다(봉인 만료 뒤 깨어난 세션: 탭 점은 도는데 상태바는 "완료", [중지]는 사라진다).
 * 입력은 전부 서버 값이고 여기선 조합만 한다(§3.1 — 상태를 만들거나 전이시키지 않는다).
 */

import type { QueuedCommand, RunningSubagentTask, SubAgent, SubAgentStatus } from './types.js';

type QueueStateFields = Pick<QueuedCommand, 'status' | 'dispatchMode' | 'liveDelivery'>;

/**
 * §5.5 #17-18 ⑬ — 큐에 남았지만 다시 나가지 않는 [작업에 반영] 기록인가(전달 확인 불가로 잠김).
 * 자동 재전송·변경·삭제를 막으려고 큐에 둘 뿐 낼 일이 아니다 — 이것을 "줄 섬"으로 세면 끝난 세션이 영영 대기·활성으로 남는다.
 */
export function isLockedLiveFollowUpRecord(command: QueueStateFields): boolean {
  return command.status === 'queued' && command.dispatchMode === 'steer' && command.liveDelivery?.state === 'uncertain';
}

/** 아직 나갈(또는 나가는 중인) 줄 선 명령인가. 큐가 "낼 일"인지 물을 때 `status === 'queued'` 대신 이것을 쓴다. */
export function isPendingQueuedCommand(command: QueueStateFields): boolean {
  return command.status === 'queued' && !isLockedLiveFollowUpRecord(command);
}

/** 끝나지 않은 명령인가(도는 중 ∪ 나갈 차례를 기다림) — 같은 탭에 일을 겹쳐 쏘지 않는 직렬 잠금이 쓴다. */
export function isUnfinishedQueuedCommand(command: QueueStateFields): boolean {
  return command.status === 'executing' || isPendingQueuedCommand(command);
}

/** 화면이 그리는 세션 상태 — 색·라벨은 이 7값에만 대응한다. */
export type SessionRunState =
  /** 지금 돌고 있다. */
  | 'running'
  /** 실패로 끝났다. */
  | 'error'
  /** 요금제 한도로 끊겼다 — 실패도 끝남도 아니다(§2.4). CLI 는 합성 통지 후 정상 종료하므로 이 값이 없으면 초록 "끝남"이 된다. */
  | 'limited'
  /** 낼 일이 남았는데 안 나갔다(큐에 명령, 도는 것 없음). 없으면 "끝남"을 믿고 보낸 덧말이 큐에만 얹혀 사라진 것처럼 보인다. */
  | 'waiting'
  /** 아직 아무 일도 하지 않았다(`isPristineSession`) — 끝난 것이 없으니 "끝남"이 아니다(§5.5 #17-10 ⑦). */
  | 'fresh'
  /** 끝났고 사용자가 아직 확인하지 않았다(= 눈에 띄어야 한다). */
  | 'doneUnseen'
  /** 끝났고 확인까지 됐다(= 조용해야 한다). */
  | 'done';

/** 판정에 쓰는 사실들 — 전부 서버 스냅샷에서 그대로 온 값이다. */
export interface SessionRunInputs {
  /** `SubAgent.status`. 세션 탭이 없는 자리(메인 탭 등)는 `null`. */
  subStatus: SubAgentStatus | null;
  /** 이 세션 소유의 `QueuedCommand` 중 `executing` 이 있는가. */
  hasExecutingCommand: boolean;
  /** 이 세션의 Task/Agent 자식 수(`origin: 'hook'`). 자식이 모델을 돌리면 그 턴은 아직 "도는 중"이다(끊기는 `TaskStop`, §5.5 #17-9 ⑫). */
  runningAgentTaskCount: number;
  /**
   * 백단 셸 수(`origin: 'stream'` — `run_in_background`·`Monitor`·120초 타임아웃 승격 Bash). **실행 축에서 뺀다** — 모델이 안 돌아
   * 답은 이미 나왔다. 넣으면 셸 하나가 대화를 인질로 잡고(입력창 [중지] · 무응답 경고 · 파란 탭 점) 끝 표식이 안 오면 풀리지도 않는다.
   * 표시 전용(`hasBackgroundShells`), 끊기는 `KillShell`. **회수 축은 셸까지 본다** — `hasLivingWork`·`hasLiveBackgroundWork`
   * (휴면 회수가 셸을 죽이고 `--resume` 은 못 살린다, §2.4). ⑮의 거울: 회수용 술어를 표시에 빌려 쓰지 마라.
   */
  backgroundShellCount: number;
  /** 이 세션 소유의 나갈 명령(`isPendingQueuedCommand`)이 있는가 — "돌고 있다"가 아니라 "낼 일이 남았다". */
  hasQueuedCommand: boolean;
  /** 사용자가 이 세션의 완료를 확인했는가(`acknowledgedSubAgents`). */
  acknowledged: boolean;
  /**
   * 이 세션이 아직 아무 일도 하지 않았는가(`isPristineSession`). 참이면 `acknowledged` 와 무관하게 `doneUnseen` 이 될 수 없다 —
   * 확인 표식은 창(렌더러)마다 따로 든 사본이라, 빈 탭의 색을 거기에 맡기면 표식이 빠진 창에서 초록 "끝남"이 선다.
   */
  pristine: boolean;
  /**
   * 이 세션이 **한도로 끊긴 채 아직 다시 돌지 않았는가**(`SubAgent.usageLimit`).
   * 서버가 세우고 다음 명령이 나갈 때 서버가 걷는다 — 여기서 시간을 재거나 만료시키지 않는다(§3.1).
   */
  usageLimited: boolean;
}

/** 아무것도 모를 때의 기본값 — 호출부가 아는 것만 덮어쓰면 된다. */
export const EMPTY_SESSION_RUN_INPUTS: SessionRunInputs = {
  subStatus: null,
  hasExecutingCommand: false,
  runningAgentTaskCount: 0,
  backgroundShellCount: 0,
  hasQueuedCommand: false,
  acknowledged: false,
  pristine: false,
  usageLimited: false,
};

/**
 * §5.5 #17-10 ⑦ — 아직 아무 일도 하지 않은 세션인가: CLI 세션·명령·결과가 없고 활동 시각이 만든 시각에서 한 번도 밀리지 않았다.
 * 마지막 조건이 CMD 탭을 가른다 — 훅·바이트 신호로만 돌아 명령·세션 id 를 남기지 않지만 활동마다 `lastActivityAt` 을 민다.
 */
export function isPristineSession(
  sub: Pick<SubAgent, 'sessionId' | 'lastCommand' | 'lastResult' | 'createdAt' | 'lastActivityAt'>,
): boolean {
  return !sub.sessionId && !sub.lastCommand && !sub.lastResult && sub.lastActivityAt <= sub.createdAt;
}

/**
 * 지금 도는가 — [중지]·스피너의 유일한 근거: `subStatus === 'active'`(봉인 후 깨어나면 이것만 참) · `isSessionExecuting`(상태 모르는 세션의 dispatch)
 * · `runningAgentTaskCount > 0`. `backgroundShellCount` 는 뺀다(셸은 모델이 안 돈다 — `grep | sort` 하나가 대화를 잡는다, 셸은 `hasBackgroundShells`).
 * `hasQueuedCommand` 도 뺀다(줄 선 것은 도는 게 아니다 — 넣으면 빈 세션에 스피너가 돈다).
 */
export function isSessionRunning(inputs: SessionRunInputs): boolean {
  return inputs.subStatus === 'active'
    || isSessionExecuting(inputs)
    || inputs.runningAgentTaskCount > 0;
}

/** 종료된 세션을 큐에 남은 실행 기록만으로 되살리지 않는다. 정상 dispatch는 먼저 active를 세운다. */
export function isSessionExecuting(inputs: SessionRunInputs): boolean {
  return inputs.hasExecutingCommand && (inputs.subStatus === null || inputs.subStatus === 'active');
}

/**
 * 백단 셸이 남았는가 — 실행 축과 직교하는 표시 전용. 참이어도 세션은 끝났다(입력창 평소대로·스피너 없음).
 * 화면은 배지와 "백단에서 N개" 한 줄로 사용자가 원할 때 끊게(`KillShell`) 한다.
 */
export function hasBackgroundShells(inputs: SessionRunInputs): boolean {
  return inputs.backgroundShellCount > 0;
}

/**
 * 도는 항목이 셸인가 — 실행 축과 표시 축을 가르는 단 하나의 규칙(셸 판정은 전부 여기). `origin: 'hook'`(미지정 포함 — 구버전)은 에이전트,
 * `'stream'`(CLI `task_started` 칩)은 셸. 단 `subagentType` 이 있으면 스트림이어도 에이전트다(Task 자식 — 훅이 이미 센다, §5.5 #17-9 ⑮).
 */
export function isBackgroundShellTask(
  task: Pick<RunningSubagentTask, 'origin' | 'subagentType'>,
): boolean {
  return task.origin === 'stream' && !task.subagentType;
}

/** 줄만 서 있는가(안 도는데 낼 일이 남음). 호출부에서 `status === 'executing' || status === 'queued'` 를 다시 쓰지 마라 — 두 번째 술어가 되어 화면마다 갈린다. */
export function isSessionWaiting(inputs: SessionRunInputs): boolean {
  return !isSessionRunning(inputs) && inputs.hasQueuedCommand;
}

/**
 * 이 에이전트/세션에 **아직 낼 일이 남았는가** — 도는 중이거나, 큐에 대기 중이거나.
 * 커맨드센터 레인 ④(§5.12 (B))가 "작업 중"으로 묶는 범위가 이것이다.
 */
export function hasSessionWork(inputs: SessionRunInputs): boolean {
  return isSessionRunning(inputs) || inputs.hasQueuedCommand;
}

/* 무응답 축 — "돈다"와 "얼마나 조용한가"는 다른 사실이다(`running` 하나로는 끝남·끊김·진행을 못 가른다). 서버가 준 마지막 활동 시각과 `now` 의 차만 접는다(§3.1). */

/** 이만큼 조용하면 무응답. Task 카드(`IDERunningSubagentsCards`)의 3분과 같아야 한다 — 다르면 카드와 스트림이 다른 때 경고한다. */
export const SESSION_NO_RESPONSE_MS = 3 * 60 * 1000;

/** 실행 축 위에 얹는 생존 표시 — `running` 을 **움직이는 중**과 **끊긴 듯함**으로 쪼갠다. */
export type SessionLiveness =
  /** 돌고 있고 최근에 움직였다. */
  | 'running'
  /** 돌고 있다는데 문턱을 넘도록 아무 소식이 없다 = 사용자에게 탈출구를 줘야 한다. */
  | 'stalled'
  /** 돌지는 않고 줄만 서 있다. */
  | 'waiting'
  /** 낼 일이 없다. */
  | 'idle';

/**
 * 마지막 움직임 이후 흐른 ms. 근거가 없으면(`lastActivityAt` 이 없거나 미래면) `null` —
 * **모르는 것을 0 으로 적지 않는다**(0 이면 "방금 움직였다"는 거짓말이 된다).
 */
export function sessionSilenceMs(lastActivityAt: number | null | undefined, now: number): number | null {
  if (lastActivityAt === null || lastActivityAt === undefined) return null;
  if (!Number.isFinite(lastActivityAt) || lastActivityAt <= 0) return null;
  const delta = now - lastActivityAt;
  return delta < 0 ? null : delta;
}

/** 실행 축 + 침묵 → 생존 값. `stalled` 는 도는 중일 때만이고, 침묵 시각을 모르면(`null`) 절대 올리지 않는다. */
export function resolveSessionLiveness(
  inputs: SessionRunInputs,
  lastActivityAt: number | null | undefined,
  now: number,
  thresholdMs: number = SESSION_NO_RESPONSE_MS,
): SessionLiveness {
  if (isSessionRunning(inputs)) {
    const silence = sessionSilenceMs(lastActivityAt, now);
    return silence !== null && silence >= thresholdMs ? 'stalled' : 'running';
  }
  if (inputs.hasQueuedCommand) return 'waiting';
  return 'idle';
}

/**
 * 화면 상태 하나로 접는다. `error` 가 먼저 — 실패한 턴이 백단 자식 때문에 "도는 중"으로 세탁되면 안 된다(서버 `syncBgSubStatus` 원칙, 새 명령은 서버가 `active` 로 덮는다).
 * `limited` → `waiting` 순으로 `running` 다음·`doneUnseen` 앞(한도 사유가 더 구체적이다) — 끊긴 세션·큐가 남은 세션이 초록 "끝남"이 되면
 * 그걸 믿고 보낸 덧말이 조용히 줄만 선다. `fresh` 는 그 다음 — 도는·줄 선 첫 명령은 이기고, 빈 탭은 확인 표식과 무관하게 초록이 되지 않는다.
 */
export function resolveSessionRunState(inputs: SessionRunInputs): SessionRunState {
  if (inputs.subStatus === 'error') return 'error';
  if (isSessionRunning(inputs)) return 'running';
  if (inputs.usageLimited) return 'limited';
  if (isSessionWaiting(inputs)) return 'waiting';
  if (inputs.pristine) return 'fresh';
  if (inputs.subStatus === 'idle' && !inputs.acknowledged) return 'doneUnseen';
  return 'done';
}

/** `agentBadgeShare` 의 입력 — 버블 하나가 배지에 얹는 몫을 재는 데 필요한 사실 전부. */
export interface AgentBadgeShareInputs {
  /** 서버가 이 **버블**을 도는 중으로 보는가(`active` · 권한 승인 대기). */
  bubbleRunning: boolean;
  /** 이 버블에 달린 세션들이 각각 도는가(`isSessionRunning` 결과). 세션이 없으면 빈 배열. */
  sessionRunning: boolean[];
}

/**
 * 버블 하나가 배지 숫자에 얹는 몫(서버 집계·클라 폴백 공용). 세션 없는 버블은 자신이 한 단위(훅 버블이 숫자에서 사라지지 않게),
 * 세션이 다 조용해도 버블이 돌면 1(승인 대기·자식 Task 를 기다리는 감독관).
 */
export function agentBadgeShare(inputs: AgentBadgeShareInputs): { sessions: number; running: number } {
  const sessions = inputs.sessionRunning.length === 0 ? 1 : inputs.sessionRunning.length;
  const runningSessions = inputs.sessionRunning.filter(Boolean).length;
  return {
    sessions,
    running: runningSessions === 0 && inputs.bubbleRunning ? 1 : runningSessions,
  };
}
