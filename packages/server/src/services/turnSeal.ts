/**
 * 턴 봉인 정책 — "CLI 가 `result` 를 냈다"와 "명령이 끝났다"를 가른다. 백그라운드 작업이 끝나면 CLI 는 그 통지를 다음 턴 경계에
 * `<task-notification>` 으로 넣고 다시 돈다(실측 2026-08-07: `result` 5ms 뒤 재진입, 1분 50초 뒤 진짜 끝).
 * 신호 둘 — `liveTasks`(끝이 안 온 작업) · `deliveredNotices`(아직 안 들어간 끝 통지). 둘 다 0 이면 즉시 봉인, 아니면 `TURN_RESUME_GRACE_MS` 만큼 미루고
 * 그 사이 작업 이벤트가 흐르면 취소한다. **미결이 남아도 봉인은 반드시 일어난다**(무한 스피너 방지).
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
 * **시간 만료는 두지 않는다** — 조용함도 오래됨도 죽음이 아니다(실측 2026-08-14: 33분 뒤 `exit code 0`). 시간으로 걷으면 도는 작업이 사라진다.
 * 걷는 근거는 실제 끝 통지와 세션 프로세스 소멸(`sweepOrphanedBackgroundTasks`) 둘뿐, 크기는 `MAX_TRACKED_TASKS` 가 막는다.
 */

/**
 * **프로세스가 사라진 세션**의 시작 칩을 걷기 전 유예 — 작업은 프로세스와 함께 죽으니 "프로세스 없음" = "작업 없음"이다.
 * 스폰·재개 틈만 넘기는 값이라 초 단위다("얼마나 조용하면 죽었나" 추정이 아니다).
 */
export const LIVE_TASK_ORPHAN_GRACE_MS = 15 * 1000;

/** 유예를 넘긴 시작 칩을 떼어 낸다 — 프로세스 없음을 확인한 호출자(`subAgentManager`)만 부른다. 돌려준 것은 "방금 끝난 것" 꼬리로 옮긴다. */
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

/** 진행 중인 CLI 백그라운드 작업. `description`·`subagentType` 은 봉인 판정에 안 쓰는 화면용이다. */
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
 * `hasLiveTasks` — 아직 도는 백그라운드 작업이 있나, 생존 판정 전용(§5.5 #17-9 ⑮). 표시 목록과 일부러 답이 다르다 —
 * 훅 장부에 소유 탭 없이 오르는 손자 자식(③(c))이 있어 겹침을 빼면 도는 세션이 "완료"로 굳는다(실측 `idle` + `probe:'working'`).
 */
/**
 * **모델 자식이 도는가**(§5.5 #17-9 ⑰) — `subagentType` 항목만 센다: "실행 중이라 말할까"의 답(회수는 `hasLiveTasks`).
 * 셸은 모델이 안 돌아 답이 이미 나왔다 — 세면 끝 표식이 안 오는 셸(`grep … | sort`) 하나가 탭을 영영 붙든다.
 * 훅 장부와의 겹침은 빼지 않는다 — 훅이 소유를 못 푼 자식엔 이 신호가 유일한 증인이다.
 */
export function hasLiveAgentTasks(state: TurnSealState): boolean {
  for (const info of state.liveTasks.values()) { if (info.subagentType) return true; }
  return false;
}

/** 지금 남아 있는 **셸** 수 — 표시·로그용(실행 축에 넣지 마라). */
export function countLiveShells(state: TurnSealState): number {
  let n = 0;
  for (const info of state.liveTasks.values()) { if (!info.subagentType) n += 1; }
  return n;
}

/** ⑰ — **회수 판정 전용**(셸까지 센다). **표시에 빌려 쓰지 마라** — 참은 "죽이면 백단이 함께 죽는다"이지 "실행 중"이 아니다. 화면은 `hasLiveAgentTasks`. */
export function hasLiveTasks(state: TurnSealState): boolean {
  return state.liveTasks.size > 0;
}

/**
 * **화면용 백그라운드 작업** — 훅이 세는 Task/Agent 는 빼고 `Bash run_in_background`·`Monitor` 만 남긴다.
 * **생존 판정엔 쓰지 마라 — `hasLiveTasks` 다**(⑮). 셀 때만 쓴다.
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

/** 잠정 봉인을 취소할 근거인가 — text/thinking/tool_use/tool_result 만. `system` 칩은 턴 뒤에도 흘러 넣으면 봉인이 영영 밀린다. */
export function isTurnResumeSignal(eventType: string): boolean {
  return eventType === 'text' || eventType === 'thinking'
    || eventType === 'tool_use' || eventType === 'tool_result';
}

/**
 * §5.5 #17-18 — 활동 없이 온 `result` 를 **이 명령의 끝으로 읽지 않고** 기다려 주는 최대 시간.
 *
 * 그 `result` 가 정말 이 명령의 것(예: 훅이 프롬프트를 막아 모델이 한 마디도 안 한 턴)이면 이 시간이
 * 지나 봉인된다 — 무한 스피너는 없다. 첫 토큰까지 수십 초 걸리는 큰 문맥도 넉넉히 덮도록 분 단위로 잡는다.
 */
export const EARLY_RESULT_SAFETY_MS = 90 * 1000;

/**
 * 본 대화의 모델 줄인가(`assistant` 또는 `stream_event`, `parent_tool_use_id` 가 문자열인 곁가지 ❌). `isTurnResumeSignal` 보다 이르다 —
 * persistent 의 `stream_event`·빈 thinking 은 이벤트가 안 돼 첫 글자까지 수 초를 놓친다.
 */
export function isMainThreadModelLine(obj: Record<string, unknown>): boolean {
  const type = obj['type'];
  if (type !== 'assistant' && type !== 'stream_event') return false;
  return typeof obj['parent_tool_use_id'] !== 'string';
}

/** `isResultBeforeOwnTurn` 이 보는 사실들 — 그 명령을 보낸 뒤 매니저가 모은 것이다. */
export interface InFlightResultFacts {
  /** 이 명령을 보낸 뒤 본 대화의 모델 줄(`isMainThreadModelLine`)이 하나라도 왔는가. */
  mainActivity: boolean;
  /** §5.5 #17-18 ⑩-1 — 이 `result` 의 턴 도장이 남의 것인가. `mainActivity` 는 래치라 누가 말했는지 못 가린다 — 도장이 다르면 남의 끝이다. */
  foreignTurn?: boolean;
  /** CLI 가 이 `result` 를 실패(`is_error`)로 신고했는가. */
  cliError: boolean;
  /** 우리가 최대 턴 수로 자식을 끊었는가. */
  killed: boolean;
  /** 우리가 이 명령에 인터럽트(`control_request`)를 보냈는가. */
  interrupted: boolean;
  /** 슬래시 명령인가 — 로컬 명령(`/compact`·`/cost` …)은 모델 줄 없이 `result` 만 낸다. */
  slashCommand: boolean;
}

/**
 * §5.5 #17-18 — **이 명령의 답이 시작되기 전에 온 남의 끝**인가. `--resume` 자식은 밀린 통지를 먼저 처리하고 `result` 를 낸다 —
 * 끝으로 읽으면 답 없이 완료음이 난다(실측 2026-09-18). 판정: ① 보낸 뒤 본 대화가 말이 없다 ② 도장이 남의 것(`foreignTurn`, ① 이 래치라 필요).
 * 실패 신고·우리가 끊은 턴·슬래시 로컬 명령은 그대로 봉인한다.
 */
export function isResultBeforeOwnTurn(facts: InFlightResultFacts): boolean {
  // 예외가 먼저다 — 우리가 끊었거나 CLI 가 실패를 신고했거나 슬래시 로컬 명령이면, 도장이
  //   무엇이든 이 `result` 는 이 명령의 끝이다(그 사실들은 우리가 이 명령에 대해 아는 것이다).
  if (facts.cliError || facts.killed || facts.interrupted || facts.slashCommand) return false;
  // §5.5 #17-18 ⑩-1 — **남의 턴 도장이 찍힌 끝은 이 명령의 끝이 아니다.** 이 명령이 이미 말을
  //   했더라도(`mainActivity`) 마찬가지다 — 말한 것과 끝난 것은 다른 사실이다.
  if (facts.foreignTurn === true) return true;
  return !facts.mainActivity;
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
 * **되살아난 턴이 끝나면 세션을 재울까** — 명령이 이미 마감돼 `inFlight` 가 없으니 안 재우면 `active` 가 굳는다(실측 3분 14초).
 * 근거는 시간이 아니라 실제 `result` 다. 제외 목록은 생존 대조와 같다(다르면 화면이 엇갈린다).
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

/**
 * §5.5 #17-9 ⑱ — 끝 통지 받은 쉬는 세션을 "곧 다시 돈다"로 붙드는 최대 시간(CLI 는 3ms 만에 새 턴을 열지만 첫 모델 줄은 실측 24초).
 * #17-18 안전 마감과 같은 질문이라 같은 값. 넘으면 붙듦을 푼다.
 */
export const NOTICE_RESUME_WINDOW_MS = EARLY_RESULT_SAFETY_MS;

/** `shouldHoldForNoticeResume` 이 보는 사실들 — 끝 칩이 도착한 순간 매니저가 아는 값이다. */
export interface NoticeResumeHoldInputs {
  /** 백단 자식 덕에 떠 있던 탭인가(`bgPromotedSubs`) — 아니면 이 칩으로 내려갈 것도 없다. */
  bgPromoted: boolean;
  /** 지금 세션 상태. `error` 는 보존해야 하므로 `active` 일 때만 붙든다. */
  subStatus: SubAgentStatus;
  /** 이 세션이 **한 턴을 처리하는 중**인가(`isSubProcessingCommand`) — 그러면 그 명령의 봉인이 끝을 정한다. */
  processingCommand: boolean;
  /** persistent 자식이 **살아서 쉬는 중**인가(`persistentChildReady === true`) — 통지로 새 턴을 열 주체. */
  childIdleAlive: boolean;
  /** 스폰이 진행 중인가(`dispatchingSubs`). */
  dispatching: boolean;
  /** 훅이 상태를 몰고 가는 PTY(CMD) 세션인가(`cmdDrivenSubs`). */
  cmdDriven: boolean;
}

/**
 * **끝 통지로 탭을 내리지 말고 붙들까**(§5.5 #17-9 ⑱) — 쉬는 세션에 끝 칩이 오면 CLI 는 이미 새 턴을 연다(내리면 거짓 완료음).
 * 붙든 탭은 첫 모델 줄이 풀고 그 `result` 에서 `shouldSleepResumedTurn` 이 재운다. 제외 목록은 그 함수와 같다.
 */
export function shouldHoldForNoticeResume(inputs: NoticeResumeHoldInputs): boolean {
  if (!inputs.bgPromoted) return false;
  // `error` 는 보존 — 실패한 턴을 "곧 돈다"로 세탁하지 않는다. 이미 내려간 탭은 붙들 것이 없다.
  if (inputs.subStatus !== 'active') return false;
  // 명령이 도는 중이면 그 명령의 봉인(`sealTurn`)이 끝을 정하고, 강등도 `isSubProcessingCommand` 가 막는다.
  if (inputs.processingCommand) return false;
  // 통지를 받아 턴을 열 자식이 없다(legacy `--print` · 죽은 자식) — "곧 다시 돈다"가 성립하지 않는다.
  if (!inputs.childIdleAlive) return false;
  if (inputs.dispatching) return false;
  if (inputs.cmdDriven) return false;
  return true;
}
