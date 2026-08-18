/**
 * 세션 실행 상태 단일 판정 — "이 세션이 지금 돌고 있는가"를 **한 곳에서** 정한다.
 *
 * **왜 필요한가.** 같은 사실("이 세션 탭이 실행 중이다")을 화면마다 따로 판정하고 있었다:
 *  - 탭 점·사이드바·패널 목록·세션 요약 → `SubAgent.status`
 *  - 스트림 하단 상태바·[중지] 버튼 → `QueuedCommand.status`
 *  - [중지] 보조 조건 → `runningSubagentTasks`(백그라운드 Task 대차대조)
 *  - 커맨드센터 레인 → 위 셋을 또 다른 식으로 조합
 *
 * 축이 갈라져 있으면 **한쪽만 복구되는 순간 화면이 서로 다른 말을 한다.** 실제로 그랬다 —
 * 턴 봉인(`server/services/turnSeal.ts`)이 만료된 뒤 세션이 다시 깨어나면 `SubAgent.status` 는
 * `active` 로 되돌아오지만 이미 아카이브로 옮겨진 `QueuedCommand` 는 `completed` 로 굳는다.
 * 그 결과 탭 점은 파랗게 도는데 하단 상태바는 초록 "완료"를 띄우고, 명령 상태만 보던
 * [중지] 버튼은 **아직 돌고 있는 세션에서 사라졌다.**
 *
 * 그래서 판정을 여기 하나로 모은다. 입력은 전부 **서버가 준 값**이고 이 모듈은 그것을 조합만
 * 한다(§3.1 서버 = SSOT, 클라 = View — 여기서 상태를 만들거나 전이시키지 않는다).
 */

import type { SubAgentStatus } from './types.js';

/** 화면이 그리는 세션 상태 — 색·라벨은 이 4값에만 대응한다. */
export type SessionRunState =
  /** 지금 돌고 있다. */
  | 'running'
  /** 실패로 끝났다. */
  | 'error'
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
  /** 이 세션이 띄운 백그라운드 Task 서브에이전트 수(`runningSubagentTasks`). */
  runningTaskCount: number;
  /** 이 세션 소유의 `queued` 명령이 있는가 — "돌고 있다"가 아니라 "낼 일이 남았다". */
  hasQueuedCommand: boolean;
  /** 사용자가 이 세션의 완료를 확인했는가(`acknowledgedSubAgents`). */
  acknowledged: boolean;
}

/** 아무것도 모를 때의 기본값 — 호출부가 아는 것만 덮어쓰면 된다. */
export const EMPTY_SESSION_RUN_INPUTS: SessionRunInputs = {
  subStatus: null,
  hasExecutingCommand: false,
  runningTaskCount: 0,
  hasQueuedCommand: false,
  acknowledged: false,
};

/**
 * **지금 돌고 있는가** — [중지]를 띄울지, 스피너를 돌릴지의 유일한 근거.
 *
 * 세 근거를 OR 로 묶는 이유는 셋 중 **어느 하나만 살아 있어도 사용자에게는 "도는 중"** 이기 때문이다:
 *  - `subStatus === 'active'` : 서버가 이 세션을 실행 중으로 본다(봉인 후 깨어난 경우 이것만 참이다).
 *  - `hasExecutingCommand`    : 이 세션의 명령이 dispatch 돼 있다.
 *  - `runningTaskCount > 0`   : 이 세션이 띄운 백그라운드 Task 가 아직 안 끝났다.
 *
 * `hasQueuedCommand` 는 **일부러 뺀다** — 큐에 줄 서 있는 것은 "낼 일이 남았다"이지 "돌고 있다"가
 * 아니다. 그것까지 running 으로 치면 아무것도 안 도는 세션에 스피너가 돈다.
 */
export function isSessionRunning(inputs: SessionRunInputs): boolean {
  return inputs.subStatus === 'active'
    || inputs.hasExecutingCommand
    || inputs.runningTaskCount > 0;
}

/**
 * 이 에이전트/세션에 **아직 낼 일이 남았는가** — 도는 중이거나, 큐에 대기 중이거나.
 * 커맨드센터 레인 ④(§5.12 (B))가 "작업 중"으로 묶는 범위가 이것이다.
 */
export function hasSessionWork(inputs: SessionRunInputs): boolean {
  return isSessionRunning(inputs) || inputs.hasQueuedCommand;
}

/**
 * 화면이 그릴 상태 하나로 접는다.
 *
 * `error` 를 **가장 먼저** 본다 — 실패한 턴은 자식이 백단에 남아 있다는 이유로 "도는 중"으로
 * 세탁되면 안 된다(서버 `syncBgSubStatus` 가 지키는 원칙과 같다). 실제로 새 명령이 나가면 서버가
 * dispatch 에서 `status` 를 `active` 로 덮으므로, 여기서 error 를 앞세워도 다음 실행을 가리지 않는다.
 */
export function resolveSessionRunState(inputs: SessionRunInputs): SessionRunState {
  if (inputs.subStatus === 'error') return 'error';
  if (isSessionRunning(inputs)) return 'running';
  if (inputs.subStatus === 'idle' && !inputs.acknowledged) return 'doneUnseen';
  return 'done';
}
