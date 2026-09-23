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

import type { RunningSubagentTask, SubAgentStatus } from './types.js';

/** 화면이 그리는 세션 상태 — 색·라벨은 이 6값에만 대응한다. */
export type SessionRunState =
  /** 지금 돌고 있다. */
  | 'running'
  /** 실패로 끝났다. */
  | 'error'
  /**
   * **요금제 한도에 닿아 하던 일이 끊겼다** — 실패도, 끝남도 아니다(§2.4 한도 정지).
   *
   * CLI 는 이때 실패하지 않는다. 합성 통지 한 줄을 적고 정상 종료하므로, 이 값이 없으면 그
   * 세션은 `doneUnseen`(초록 "끝남")으로 내려앉아 **멈춘 사실이 화면 어디에도 남지 않는다.**
   */
  | 'limited'
  /**
   * **낼 일이 남았는데 아직 나가지 않았다** — 큐에 줄 선 명령이 있고 도는 것은 없다.
   *
   * 이 값이 없으면 그 세션은 `doneUnseen`(초록 "끝남")으로 내려앉는다. 사용자는 그 "끝남"을
   * 믿고 덧말을 보내고, 덧말은 큐에 얹히기만 한 채 화면은 계속 "끝남"이라고 말한다 — 보낸
   * 사람 눈에는 **말이 통째로 사라진 것**이 된다. 큐가 비어야 비로소 끝난 것이다.
   */
  | 'waiting'
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
  /**
   * 이 세션이 띄운 **Task/Agent 서브에이전트** 수(`runningSubagentTasks` 중 `origin: 'hook'`).
   *
   * 자식이 **모델을 돌려 토큰을 태우고 있다** = 그 턴의 답이 아직 완성되지 않았다. 그래서 이것
   * 하나만으로도 세션은 "도는 중"이고, 끊는 손잡이는 `TaskStop` 이다(§5.5 #17-9 ⑫).
   */
  runningAgentTaskCount: number;
  /**
   * 이 세션이 백단에 띄워 둔 **셸** 수(`runningSubagentTasks` 중 `origin: 'stream'` —
   * `Bash run_in_background` · `Monitor` · 120초 타임아웃으로 승격된 전경 Bash).
   *
   * **실행 축에서 일부러 뺐다.** 셸은 명령이 돌 뿐 모델이 돌지 않는다 — 에이전트는 이미 답을
   * 내놨고 사용자는 다음 말을 할 수 있어야 한다. 그런데 종전에는 이 수가 서브에이전트와 한
   * 칸(`runningTaskCount`)에 얹혀 `isSessionRunning` 을 참으로 붙들었고, 그래서 **셸 하나가
   * 대화 전체를 인질로 잡았다**: 입력창이 [중지]+[덧말]로 바뀌고, 3분 무응답 경고가 서고,
   * 탭 점이 영영 파랬다. `sort` 처럼 stdin 이 닫힐 때까지 한 글자도 안 찍는 명령이면 끝
   * 표식(⑬)도 영영 안 와서 그 인질 상태가 스스로 풀리지도 않는다.
   *
   * 이 수는 **표시 전용**이다 — 활동바 배지와 안내 한 줄이 쓴다(`hasBackgroundShells`).
   * 끊는 손잡이도 다르다(`KillShell`). **회수(reclaim) 축은 이 분리를 따르지 않는다** —
   * 서버의 `hasLivingWork` · `hasLiveBackgroundWork` 는 셸까지 **안 거른 채** 봐야 한다
   * (§2.4 휴면 회수가 그 셸을 죽인다. `--resume` 은 백그라운드 Bash 를 되살리지 않는다).
   * ⑮가 "표시용 목록을 생존 판정에 빌려 쓰지 마라"였다면, 이쪽은 그 거울이다 —
   * **회수용 술어를 표시에 빌려 쓰지 마라.**
   */
  backgroundShellCount: number;
  /** 이 세션 소유의 `queued` 명령이 있는가 — "돌고 있다"가 아니라 "낼 일이 남았다". */
  hasQueuedCommand: boolean;
  /** 사용자가 이 세션의 완료를 확인했는가(`acknowledgedSubAgents`). */
  acknowledged: boolean;
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
  usageLimited: false,
};

/**
 * **지금 돌고 있는가** — [중지]를 띄울지, 스피너를 돌릴지의 유일한 근거.
 *
 * 세 근거를 OR 로 묶는 이유는 셋 중 **어느 하나만 살아 있어도 사용자에게는 "도는 중"** 이기 때문이다:
 *  - `subStatus === 'active'`     : 서버가 이 세션을 실행 중으로 본다(봉인 후 깨어난 경우 이것만 참이다).
 *  - `hasExecutingCommand`        : 이 세션의 명령이 dispatch 돼 있다.
 *  - `runningAgentTaskCount > 0`  : 이 세션이 띄운 **Task/Agent 자식**이 아직 모델을 돌리고 있다.
 *
 * **`backgroundShellCount` 는 일부러 뺀다.** 백단 셸은 명령이 돌 뿐 모델이 돌지 않아, 그 턴의 답은
 * 이미 나와 있다. 그것까지 running 으로 치면 `grep | sort` 하나가 대화를 인질로 잡는다 — 입력창이
 * [중지]로 바뀌고 3분 무응답 경고가 서며, 끝 표식이 안 오는 명령이면 그 상태가 영영 안 풀린다.
 * 셸은 `hasBackgroundShells` 로 **따로 보여 주고 따로 끊는다**(§5.5 #17-9 ⑫의 갈라 적기를 생존
 * 축까지 끌고 온 것 — ⑮의 폐기가 아니라 확장이다).
 *
 * `hasQueuedCommand` 도 **일부러 뺀다** — 큐에 줄 서 있는 것은 "낼 일이 남았다"이지 "돌고 있다"가
 * 아니다. 그것까지 running 으로 치면 아무것도 안 도는 세션에 스피너가 돈다.
 */
export function isSessionRunning(inputs: SessionRunInputs): boolean {
  return inputs.subStatus === 'active'
    || inputs.hasExecutingCommand
    || inputs.runningAgentTaskCount > 0;
}

/**
 * **백단에 셸이 남아 있는가** — 실행 축과 **직교하는** 표시 전용 축.
 *
 * 참이어도 세션은 끝난 것이다(입력창은 평소대로, 스피너 없음, 무응답 경고 없음). 화면은 이 값으로
 * 활동바 배지를 켜고 "백단에서 N개가 돌고 있습니다" 한 줄을 세워, 사용자가 **원할 때** 그 목록을
 * 열어 끊게(`KillShell`) 한다. 끝내는 주체가 세션이 아니라 사용자라는 것이 요점이다.
 */
export function hasBackgroundShells(inputs: SessionRunInputs): boolean {
  return inputs.backgroundShellCount > 0;
}

/**
 * 도는 항목 하나가 **셸인가**(≠ Task/Agent 서브에이전트) — 실행 축과 표시 축을 가르는 단 하나의 규칙.
 *
 * 서버가 이미 답을 실어 보낸다: 훅 대차대조에서 온 것은 `origin: 'hook'`(미지정도 같다, 구버전
 * 호환), CLI 스트림의 `task_started` 칩에서 온 것은 `origin: 'stream'` 이다. 후자가 곧 셸이다 —
 * `Bash run_in_background` · `Monitor` · 120초 타임아웃으로 승격된 전경 Bash.
 *
 * `subagentType` 이 붙어 있으면 스트림에서 왔더라도 **에이전트로 본다.** 그 값이 있다는 것은 Task
 * 도구로 띄운 모델 자식이라는 뜻이고, 그런 항목은 훅 대차대조가 이미 세고 있다(§5.5 #17-9 ⑮).
 *
 * 규칙을 화면마다 손으로 적으면 또 갈라진다 — 셸 판정이 필요한 곳은 전부 이 함수를 부른다.
 */
export function isBackgroundShellTask(
  task: Pick<RunningSubagentTask, 'origin' | 'subagentType'>,
): boolean {
  return task.origin === 'stream' && !task.subagentType;
}

/**
 * **줄만 서 있는가** — 돌고 있지는 않은데 낼 일이 남은 상태.
 *
 * `isSessionRunning` 이 `hasQueuedCommand` 를 일부러 빼면서 생긴 구멍을 이 술어가 메운다. 종전에는
 * 호출부가 제각기 `status === 'executing' || status === 'queued'` 를 손으로 적었고, 그 손글씨가 곧
 * **두 번째 술어 벌**이 되어 화면마다 다른 답을 냈다. 나눠야 할 곳은 나누되 **이름 붙인 술어를 골라
 * 쓰게** 한다 — 호출부에서 명령 상태 문자열을 다시 비교하지 마라.
 */
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

/* ────────────────────────────────────────────────────────────────────────────
 * **무응답 축** — "돌고 있다"와 "얼마나 조용한가"는 서로 다른 사실이다.
 *
 * 화면이 `running` 하나만 그리면 사용자는 **끝난 것인지, 끊긴 것인지, 이어서 하는 것인지** 구별할
 * 수단이 전혀 없다(사용자 보고 — "실행 중"만 떠 있고 얼마나 멈춰 있는지도, 어떻게 빠져나가는지도
 * 알려주지 않는다). 그래서 실행 축 위에 **마지막 움직임으로부터 흐른 시간**을 한 겹 얹는다.
 *
 * 여기서도 상태를 만들지 않는다(§3.1) — 마지막 활동 시각은 서버가 준 사실이고, 이 모듈은 그것과
 * `now` 의 차를 접기만 한다.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 이만큼 조용하면 **무응답**으로 본다. 백그라운드 Task 카드
 * (`IDERunningSubagentsCards`)가 쓰던 3분과 **같은 값**이다 — 같은 뜻의 문턱이 두 벌이면 카드와
 * 스트림이 서로 다른 때에 경고해 사용자가 어느 쪽을 믿어야 할지 알 수 없게 된다.
 */
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

/**
 * 실행 축 + 침묵 시간 → 화면이 그릴 생존 값 하나.
 *
 * `stalled` 는 **도는 중일 때만** 나온다 — 줄 서 있는 세션이 조용한 것은 당연한 일이라 경고할 것이
 * 없다. 침묵 시각을 모르면(`null`) 절대 `stalled` 로 올리지 않는다(근거 없는 경고 ❌).
 */
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
 * 화면이 그릴 상태 하나로 접는다.
 *
 * `error` 를 **가장 먼저** 본다 — 실패한 턴은 자식이 백단에 남아 있다는 이유로 "도는 중"으로
 * 세탁되면 안 된다(서버 `syncBgSubStatus` 가 지키는 원칙과 같다). 실제로 새 명령이 나가면 서버가
 * dispatch 에서 `status` 를 `active` 로 덮으므로, 여기서 error 를 앞세워도 다음 실행을 가리지 않는다.
 *
 * **`limited` 는 `running` 다음, `doneUnseen` 앞이다.** 사용자가 한도를 무시하고 그 세션을 다시
 * 돌렸으면 그것은 도는 중이고(파랑이 이긴다), 아직 안 돌렸으면 그 세션은 **끝난 것이 아니라 끊긴
 * 것**이라 초록 "끝남"으로 내려가면 안 된다 — 그 강등이 바로 이 축이 생긴 이유다.
 *
 * **`waiting` 은 `limited` 다음, `doneUnseen` 앞이다.** 한도로 끊긴 세션은 큐가 남아 있어도
 * 사유가 "한도"라 그쪽이 더 구체적이고, 반대로 **큐가 남은 세션이 "끝남"으로 내려가는 것**은
 * 그 자체가 결함이다 — 사용자가 그 "끝남"을 믿고 보낸 덧말이 조용히 줄만 서기 때문이다.
 */
export function resolveSessionRunState(inputs: SessionRunInputs): SessionRunState {
  if (inputs.subStatus === 'error') return 'error';
  if (isSessionRunning(inputs)) return 'running';
  if (inputs.usageLimited) return 'limited';
  if (isSessionWaiting(inputs)) return 'waiting';
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
 * 에이전트 버블 하나가 **배지 숫자에 얹는 몫** — 세션 축 집계 규칙을 여기 한 곳에 둔다.
 *
 * 같은 규칙을 서버(탭·헤더 집계)와 클라(서버 집계가 없을 때의 폴백)가 각각 쓴다. 두 벌로 적으면
 * 어느 한쪽만 고쳐졌을 때 배지가 화면마다 다른 수를 말한다 — 이 함수가 그 갈라짐을 막는다.
 *
 * 규칙은 둘이다.
 *  · **세션이 없는 버블은 자기 자신이 한 단위다.** 훅 에이전트처럼 세션 목록이 비는 버블을
 *    세션 축으로만 세면 숫자에서 통째로 사라진다.
 *  · **세션이 전부 조용해도 버블이 도는 중이면 1 이다.** 권한 승인 대기(훅이 동기 hold)나 자식
 *    Task 를 기다리는 감독관이 그렇다 — 사용자에게는 그것도 "하나가 도는 중"이다.
 */
export function agentBadgeShare(inputs: AgentBadgeShareInputs): { sessions: number; running: number } {
  const sessions = inputs.sessionRunning.length === 0 ? 1 : inputs.sessionRunning.length;
  const runningSessions = inputs.sessionRunning.filter(Boolean).length;
  return {
    sessions,
    running: runningSessions === 0 && inputs.bubbleRunning ? 1 : runningSessions,
  };
}
