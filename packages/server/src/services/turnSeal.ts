/**
 * 턴 봉인 정책 — "CLI 가 `result` 를 냈다" 와 "이 명령이 끝났다" 를 분리한다.
 *
 * **왜 필요한가.** Claude Code 의 한 턴은 `result` 로 끝나지만, 그 자리에서 **다시 시작될 수 있다**.
 * 백그라운드 작업(`Bash run_in_background` · `Monitor`)이 끝나면 CLI 는 그 통지를 **다음 턴 경계에**
 * 새 user 메시지(`<task-notification>`)로 넣고 세션을 이어 돌린다. 실측(P_MPS_GPT 세션
 * `e78cf71c…`, 2026-08-07):
 *
 * ```
 * 15:00:15.526  [task_started]      bbeerj5yf   (백그라운드 빌드)
 * 15:00:30.137  [task_started]      bfl52vk5f   (Monitor)
 * 15:01:14.384  [task_notification] bbeerj5yf completed
 * 15:01:25.035  system/stop_hook_summary        ← 턴 종료(= CLI `result`)
 * 15:01:25.040  user <task-notification> …      ← 5ms 뒤 같은 세션이 다시 돌기 시작
 * 15:03:15.463  assistant "# 컴파일·자동화 실행 결과 …"  ← 진짜 끝
 * ```
 *
 * 종전 코드는 15:01:25 의 `result` 에서 곧바로 명령을 `completed` 로 봉인해, 화면에는 **1분 50초
 * 먼저** 완료가 떴다(사용자 보고: "안 끝났는데 끝나는 걸 먼저 표시하고 시간이 지난 후에 완성되고
 * 끝난다"). 이 모듈은 그 봉인을 **잠정**으로 만든다.
 *
 * **판정은 두 신호뿐이다.**
 *  - `liveTasks` — 시작(`task_started`)만 보이고 끝(`task_notification`)이 안 온 작업. 아직 살아 있으면
 *    그 작업이 끝나는 순간 세션이 다시 깨어난다.
 *  - `deliveredNotices` — 끝 통지가 이미 왔지만 **아직 세션에 전달되지 않은** 건수. CLI 는 이걸 턴
 *    경계에 밀어 넣으므로, 통지가 하나라도 밀려 있으면 이 턴 종료는 거의 확실히 재진입한다.
 *
 * 둘 다 0 이면 종전과 **완전히 같이** 즉시 봉인한다(회귀 0). 하나라도 있으면 `TURN_RESUME_GRACE_MS`
 * 만큼 봉인을 미루고, 그 사이 실제 작업 이벤트가 흐르면 "턴이 이어졌다"로 보고 봉인을 취소한다
 * (다음 `result` 가 같은 판정을 다시 받는다). 창이 조용히 지나가면 그대로 봉인한다 — **미결이 남아도
 * 봉인은 반드시 일어난다**(무한 스피너 방지).
 */

import { TASK_CHIP_START_SUBTYPE, TASK_CHIP_END_SUBTYPE, type StreamTaskInfo, type SubAgentStatus } from '@vibisual/shared';

/**
 * 잠정 종료를 붙들어 두는 시간. 실측 재진입 간격이 5ms 라 넉넉히 잡아도 사람 눈에 안 띈다.
 * 이 값이 곧 **거짓 완료의 최대 노출 시간이자, 진짜 완료의 최대 지연**이다.
 */
export const TURN_RESUME_GRACE_MS = 3000;

/** 한 sub 가 기억하는 미결 작업 수 상한 — CLI 가 끝 통지를 흘려도 저장고가 자라지 않게. */
export const MAX_TRACKED_TASKS = 64;

/**
 * **시간 만료는 두지 않는다** — 종전의 `LIVE_TASK_MAX_AGE_MS`(4시간)는 폐기했다.
 *
 * 백그라운드 작업은 몇 시간짜리 패키징이거나 끝을 정하지 않은 폴링일 수 있다. 실측(2026-08-14,
 * P_MPS_GPT 세션)에서 한 작업이 33분을 정상적으로 돌다 `exit code 0` 으로 끝났다 — 조용하다는
 * 것도, 오래됐다는 것도 죽었다는 증거가 아니다. 오래됐다는 이유로 걷으면 **도는 작업이 화면에서
 * 사라지고**, 그 사이 사용자는 끝난 줄 안다(사용자 지시: "시간으로 잡아내면 엄청난 문제가 생긴다").
 *
 * 걷는 근거는 둘뿐이다 — ① 실제 끝 통지(`task_notification`)를 받았다, ② 그 작업을 담고 있던
 * 세션 프로세스가 사라졌다(`subAgentManager.sweepOrphanedBackgroundTasks`). 저장고가 무한히
 * 자라지 않게 하는 것은 시간이 아니라 개수 상한(`MAX_TRACKED_TASKS`)이 맡는다.
 */

/**
 * **프로세스가 사라진 세션**의 시작 칩을 걷기 전에 두는 유예.
 *
 * 이 작업들은 그 세션 CLI 프로세스의 자식이라 프로세스가 죽으면 함께 죽는데, 그 죽음은
 * 끝 통지로 오지 않는다(통지를 보낼 CLI 가 이미 없다). 그래서 "프로세스가 없다"가 곧
 * "그 작업도 없다"이지만, 스폰 직전·재개 직전처럼 **잠깐 프로세스가 없는 창**이 정상적으로
 * 존재하므로 그 창을 넘긴 뒤에만 걷는다.
 *
 * **이 값은 "얼마나 조용하면 죽었다고 볼까"가 아니다** — 그런 추정은 폐기됐다(위 주석). 판정은
 * 이미 "프로세스가 없다"는 사실로 끝나 있고, 이 유예는 그 사실을 읽는 순간이 하필 프로세스 교체
 * 틈이었을 가능성만 막는다. 그래서 분·시간이 아니라 초 단위이며, 작업이 얼마나 오래 돌았는지와는
 * 아무 상관이 없다.
 */
export const LIVE_TASK_ORPHAN_GRACE_MS = 15 * 1000;

/**
 * 유예를 넘긴 시작 칩을 장부에서 **떼어 낸다** — 호출자가 그 세션에 프로세스가 없음을 이미
 * 확인했을 때만 부른다(그 판정은 프로세스를 아는 `subAgentManager` 의 몫이다).
 *
 * 떼어 낸 것을 돌려주는 이유는 소리 없이 사라지면 안 되기 때문이다 — 호출자가 "방금 끝난 것"
 * 꼬리로 옮겨, 사용자가 무엇이 얼마나 돌다 걷혔는지 볼 수 있게 한다.
 */
export function takeOrphanLiveTasks(
  state: TurnSealState,
  now: number = Date.now(),
): Array<{ id: string; info: LiveTaskInfo }> {
  const taken: Array<{ id: string; info: LiveTaskInfo }> = [];
  for (const [id, info] of state.liveTasks) {
    if (now - info.startedAt <= LIVE_TASK_ORPHAN_GRACE_MS) continue;
    state.liveTasks.delete(id);
    taken.push({ id, info });
  }
  // 남은 시작 칩이 없으면 밀려 있던 통지 셈도 함께 버린다 — 그 통지를 받아 갈 세션이 없다.
  if (state.liveTasks.size === 0) state.deliveredNotices = 0;
  return taken;
}

/**
 * 진행 중인 CLI 백그라운드 작업 한 건.
 *
 * `description`·`subagentType` 은 판정에 쓰이지 않는 **표시용**이다 — 이 대차대조가 봉인 지연에만
 * 쓰이던 것을 화면에도 내보내면서(§5.3 #12-1) 카드에 실을 이름이 필요해졌다.
 */
export interface LiveTaskInfo {
  /** 시작 시각(ms). */
  startedAt: number;
  /** 사람이 읽는 작업 이름(`task_started.description`). */
  description?: string;
  /**
   * Task/Agent 도구 서브에이전트면 그 종류. **있으면 훅 대차대조가 이미 세고 있는 건**이므로
   * 표시 목록에서는 뺀다(같은 자식이 두 번 세이면 사용자가 읽는 숫자가 틀린다).
   */
  subagentType?: string;
  /**
   * 이 작업을 **시작한 턴**(`QueuedCommand.id`). 끝 통지가 몇 턴 뒤에 도착해도 그 줄은 이 턴의
   * 것이다 — 통지가 온 시점의 턴에 붙이면 남의 명령이 한 일로 보인다(턴 세대 도장).
   */
  turnId?: string;
}

/** 한 서브에이전트의 백그라운드 작업 대차대조. 런타임 전용(영속화 ❌). */
export interface TurnSealState {
  /** 진행 중인 CLI 백그라운드 작업 — key = `task_id`. */
  liveTasks: Map<string, LiveTaskInfo>;
  /** 끝 통지가 왔지만 아직 세션에 전달되지 않은 건수. 턴이 이어지는 순간 소진된다. */
  deliveredNotices: number;
}

export function createTurnSealState(): TurnSealState {
  return { liveTasks: new Map(), deliveredNotices: 0 };
}

/**
 * 작업 칩 한 장을 대차대조에 반영한다. 우리 판정에 쓰이는 칩이 아니면 `false`.
 *
 * `task_notification` 의 `status` 는 `completed` / `failed` / `stopped` 셋 다 **끝**이다 —
 * 어느 쪽이든 세션에 통지가 전달되고 턴이 다시 돌 수 있다.
 */
export function noteTaskChip(
  state: TurnSealState,
  subtype: string,
  task: StreamTaskInfo | null,
  now: number = Date.now(),
  turnId?: string,
): boolean {
  if (!task || !task.id) return false;
  if (subtype === TASK_CHIP_START_SUBTYPE) {
    if (state.liveTasks.has(task.id)) return false;
    state.liveTasks.set(task.id, {
      startedAt: now,
      ...(task.description ? { description: task.description } : {}),
      ...(task.subagentType ? { subagentType: task.subagentType } : {}),
      ...(turnId ? { turnId } : {}),
    });
    pruneLiveTasks(state);
    return true;
  }
  if (subtype === TASK_CHIP_END_SUBTYPE) {
    // 시작을 못 본 작업의 끝도 세어야 한다 — 통지는 시작 관측 여부와 무관하게 세션으로 간다
    // (스트림 버퍼가 잘렸거나 서버가 중간에 붙은 경우).
    state.liveTasks.delete(task.id);
    state.deliveredNotices += 1;
    return true;
  }
  return false;
}

/**
 * 이 작업을 **시작한 턴**의 도장. 끝 통지를 그 턴에 돌려보내기 위한 조회 — 시작을 못 본 작업이면
 * `undefined`(그때는 도착 시점의 턴을 그대로 쓴다).
 */
export function turnIdOfLiveTask(state: TurnSealState, taskId: string): string | undefined {
  return state.liveTasks.get(taskId)?.turnId;
}

/**
 * **화면에 내보낼 백그라운드 작업** — 훅 대차대조가 이미 세는 Task/Agent 서브에이전트(`subagentType`
 * 있음)는 뺀다. 남는 것은 `Bash run_in_background` · `Monitor` 처럼 **훅으로는 보이지 않는** 작업이라,
 * 이 목록이 비어 있지 않으면 세션은 "끝난 게 아니라 백단을 기다리는 중"이다.
 *
 * 살림성(`skip_transcript`) 작업은 애초에 스트림 이벤트로 만들어지지 않아 여기 들어오지 않는다.
 */
export function listDisplayableLiveTasks(
  state: TurnSealState,
): ReadonlyArray<{ id: string; info: LiveTaskInfo }> {
  const out: { id: string; info: LiveTaskInfo }[] = [];
  for (const [id, info] of state.liveTasks) {
    if (info.subagentType) continue;
    out.push({ id, info });
  }
  return out;
}

/** 개수 상한만 — 오래된 것부터 버린다. **경과 시간으로는 걷지 않는다**(위 상수 자리 주석 참조). */
function pruneLiveTasks(state: TurnSealState): void {
  while (state.liveTasks.size > MAX_TRACKED_TASKS) {
    const oldest = state.liveTasks.keys().next();
    if (oldest.done) break;
    state.liveTasks.delete(oldest.value);
  }
}

/**
 * 이 턴 종료가 **다시 시작될 수 있는가**. `true` 면 봉인을 `TURN_RESUME_GRACE_MS` 만큼 미룬다.
 * 판정에 쓰는 것은 관측된 사실 둘뿐이라, CLI 판올림으로 재진입 방식이 바뀌어도 같은 결론이 나온다.
 */
export function mayTurnResume(state: TurnSealState): boolean {
  return state.deliveredNotices > 0 || state.liveTasks.size > 0;
}

/**
 * 턴이 실제로 이어졌다 — 밀려 있던 통지는 세션이 받아 갔다.
 * `liveTasks` 는 건드리지 않는다(그 작업들은 여전히 돌고 있다).
 */
export function noteTurnResumed(state: TurnSealState): void {
  state.deliveredNotices = 0;
}

/**
 * 명령을 봉인했다 — 이 명령이 남긴 통지 셈은 다음 명령으로 넘기지 않는다.
 * `liveTasks` 는 명령 경계를 넘어 살아 있으므로 그대로 둔다(다음 명령의 턴도 그것 때문에 깨어난다).
 */
export function noteTurnSealed(state: TurnSealState): void {
  state.deliveredNotices = 0;
}

/**
 * 이 스트림 이벤트가 "세션이 실제로 일하고 있다"는 신호인가 — 잠정 봉인을 취소할 근거.
 *
 * 상태 칩(`system`)은 제외한다. 턴이 끝난 뒤에도 CLI 살림 통지가 몇 장 더 흐를 수 있어, 그걸
 * 재진입으로 읽으면 봉인이 영원히 미뤄진다. 모델이 말하거나(text/thinking) 도구를 쓰는
 * (tool_use/tool_result) 것만이 "다시 돌기 시작했다"의 증거다.
 */
export function isTurnResumeSignal(eventType: string): boolean {
  return eventType === 'text' || eventType === 'thinking'
    || eventType === 'tool_use' || eventType === 'tool_result';
}

/** `shouldSleepResumedTurn` 이 보는 사실들 — 전부 호출 시점에 매니저가 아는 값이다. */
export interface ResumedTurnSleepInputs {
  /** 지금 세션 상태. `error` 는 보존해야 하므로 `active` 일 때만 재운다. */
  subStatus: SubAgentStatus;
  /** 이 세션이 **한 턴을 처리하는 중**인가(`isSubProcessingCommand`). */
  processingCommand: boolean;
  /** 스폰이 진행 중인가(`dispatchingSubs`) — 이제 막 뜨는 세션을 재우면 안 된다. */
  dispatching: boolean;
  /** 훅이 상태를 몰고 가는 PTY(CMD) 세션인가(`cmdDrivenSubs`). */
  cmdDriven: boolean;
}

/**
 * **되살아난 턴이 끝났을 때 세션을 재워야 하는가.**
 *
 * 백그라운드 작업 통지로 봉인 뒤 다시 돌기 시작한 턴은 그 턴을 시킨 명령이 이미 마감돼
 * `inFlight` 가 없다. 그래서 CLI 가 그 턴의 `result` 를 내도 명령 마감 경로
 * (`_finalizeLegacyCommand`)가 돌지 않아, 재진입이 올려 둔 `active` 가 **그대로 굳었다** —
 * 세션이 사용자 답을 기다리는 내내 탭 점이 파랗게 돌았다(실측: P_MPS_GPT 세션 `5c01ebc2…`,
 * 2026-08-14 09:56:37 턴 종료 후 09:59:52 다음 명령까지 3분 14초). persistent 자식은 일부러
 * 살려 두므로 생존 대조(`reconcileDeadActiveSubs`)도 이 세션을 걷지 못한다.
 *
 * 닫아 줄 명령이 없을 뿐 **턴은 분명히 끝났다** — 그 사실만으로 세션을 재운다. 시간이 아니라
 * 실제 신호(`result`)가 근거이므로, 조용히 오래 도는 작업을 잘못 걷지 않는다.
 *
 * 재우면 안 되는 경우는 생존 대조가 쓰는 제외 목록과 같다(같은 사실을 두 곳이 다르게 판정하면
 * 화면이 서로 다른 말을 한다).
 */
export function shouldSleepResumedTurn(inputs: ResumedTurnSleepInputs): boolean {
  // `error` 는 보존 — 실패한 턴을 조용한 완료로 세탁하지 않는다.
  if (inputs.subStatus !== 'active') return false;
  // 봉인 유예(`TURN_RESUME_GRACE_MS`) 사이에 다음 명령이 나갔을 수 있다 — 그 턴을 재우면 안 된다.
  if (inputs.processingCommand) return false;
  if (inputs.dispatching) return false;
  if (inputs.cmdDriven) return false;
  return true;
}
