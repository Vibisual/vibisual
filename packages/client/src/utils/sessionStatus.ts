/**
 * 세션 상태 표시 규약 — **색과 라벨을 여기 한 곳에서만 정한다.**
 *
 * 종전에는 같은 도트 색표가 `IDETabBar` · `IDESidebar` · `SubAgentList` 세 벌로 복사돼 있었고
 * `IDESessionSummaryView` 가 네 번째 변형(확인 여부 반영)이었다. 게다가 `IDEStatusBar` 는 색 규약이
 * **정반대로 뒤집혀** 있었다 — 나머지 넷은 `idle`(=완료·미확인)을 초록으로 강조하고 `completed` 를
 * 회색으로 죽였는데, 그 바만 `idle` 을 회색으로 죽이고 `completed` 를 시안으로 강조했다.
 * 그래서 같은 세션이 화면마다 다른 색으로 보였다.
 *
 * 상태 판정 자체는 `@vibisual/shared` 의 `resolveSessionRunState` 가 한다(서버·클라 공용).
 * 이 파일은 그 결과를 **어떤 색·어떤 낱말로 그릴지**만 갖는다.
 */

import { EMPTY_SESSION_RUN_INPUTS, resolveSessionRunState } from '@vibisual/shared';
import type {
  NodeStatus,
  QueuedCommand,
  RunningSubagentTask,
  SessionRunInputs,
  SessionRunState,
  SubAgent,
  SubAgentStatus,
} from '@vibisual/shared';

/** 상태 → 도트 색(Tailwind). 값을 바꾸려면 여기 한 줄만 고친다. */
export const SESSION_STATUS_DOT: Record<SessionRunState, string> = {
  running: 'bg-blue-400 animate-pulse',
  error: 'bg-red-400',
  // 끝났는데 아직 안 봤다 = 사용자를 부르는 색.
  doneUnseen: 'bg-emerald-400',
  // 확인까지 끝났다 = 배경으로 물러난다.
  done: 'bg-gray-500',
};

/** 상태 → i18n 키(`panel.subAgent.status.*` 재사용 — 새 문자열 ❌). */
export const SESSION_STATUS_LABEL_KEY: Record<SessionRunState, string> = {
  running: 'panel.subAgent.status.running',
  error: 'panel.subAgent.status.error',
  // 미확인이든 확인이든 사실은 "끝남" 하나다 — 그 차이는 색이 말한다.
  doneUnseen: 'panel.subAgent.status.done',
  done: 'panel.subAgent.status.done',
};

/**
 * 버블 상태(`NodeStatus`) → 같은 표시 어휘. 버블과 세션은 값 집합이 다르지만(`awaiting_permission`
 * 은 버블에만, `queued/executing` 은 명령에만) **화면이 쓰는 낱말은 하나여야 한다.**
 * 새 `NodeStatus` 가 생기면 여기 한 줄만 늘린다(Open-Closed).
 */
export const NODE_STATUS_RUN_STATE: Record<NodeStatus, SessionRunState> = {
  active: 'running',
  // 권한 승인 대기 = "훅이 동기 hold 중인 블록된 활성" — 사용자에게는 여전히 도는 중이다.
  awaiting_permission: 'running',
  error: 'error',
  completed: 'done',
  idle: 'done',
  disappearing: 'done',
};

/**
 * 버블 상태를 **세션 축으로 정규화** — 커맨드센터처럼 버블(메인 탭)과 세션(sub 탭)을 한 목록에
 * 섞어 놓는 자리에서 쓴다. 세션 축에 없는 값은 `null`(= 판정에 기여하지 않음).
 *
 * `SubAgentStatus` 는 `NodeStatus` 의 부분집합이라 이 표 하나로 두 축을 모두 받는다.
 */
export const NODE_STATUS_AS_SUB_STATUS: Record<NodeStatus, SubAgentStatus | null> = {
  idle: 'idle',
  active: 'active',
  completed: 'completed',
  error: 'error',
  // 버블에만 있는 상태 — 세션에는 대응하는 값이 없다.
  awaiting_permission: null,
  disappearing: null,
};

/**
 * 세션 탭 하나의 표시 상태 — **도트를 그리는 모든 화면이 이 함수를 쓴다.**
 *
 * 도트는 `SubAgent.status` + 확인 여부만으로 답이 나온다(명령·백그라운드 Task 는 서버가 이미
 * `sub.status` 에 반영해 둔다). 그래서 여기서는 store 를 더 뒤지지 않는다 — 탭바처럼 자주 다시
 * 그려지는 자리가 명령 큐까지 구독하면 리렌더만 늘고 답은 같다.
 */
export function sessionRunStateOf(
  sub: SubAgent,
  acknowledged: boolean,
  /**
   * 이 세션이 띄운 백그라운드 서브에이전트·작업이 도는 중인가.
   *
   * `sub.status` 만 믿으면 안 된다 — 훅이 그 자식을 **어느 탭이 띄웠는지** 못 풀면
   * (`PreToolUse` 의 소유 세션 역조회 실패) 서버가 부모 버블만 active 로 올리고 **그 탭의
   * status 는 idle 로 남는다.** 그러면 자식이 도는 내내 탭 도트가 꺼져 있다(사용자 보고:
   * "서브 에이전트가 동작중인데 왜 세션은 동작 불이 꺼져버리냐"). 화면은 귀속이 풀리든 말든
   * 실행 목록에 그 세션의 작업이 있으면 켜져 있어야 한다.
   */
  hasBackgroundWork = false,
): SessionRunState {
  return resolveSessionRunState({
    ...EMPTY_SESSION_RUN_INPUTS,
    subStatus: sub.status,
    runningTaskCount: hasBackgroundWork ? 1 : 0,
    acknowledged,
  });
}

/**
 * 백그라운드 작업을 가진 세션 id 들을 **문자열 하나로** 접는다.
 *
 * 도트를 그리는 자리(탭바 등)는 자주 다시 그려지므로 `runningSubagentTasks` 객체를 그대로 구독하면
 * 스냅샷마다 새 참조라 매번 리렌더한다. 켜짐/꺼짐이 실제로 바뀔 때만 값이 달라지도록 정렬된
 * 문자열로 만들어 구독한다(`sessionLoopIndicator` 가 루프에 쓰는 것과 같은 수법).
 */
export function serializeBusySubIds(tasks: RunningSubagentTask[] | undefined): string {
  if (!tasks || tasks.length === 0) return '';
  const ids = new Set<string>();
  for (const t of tasks) { if (t.subAgentId) ids.add(t.subAgentId); }
  return [...ids].sort().join(',');
}

/** `serializeBusySubIds` 결과를 다시 집합으로 — `useMemo` 로 감싸 쓴다. */
export function parseBusySubIds(serialized: string): ReadonlySet<string> {
  return new Set(serialized ? serialized.split(',') : []);
}

/** `buildSessionRunInputs` 인자 — 호출부가 store 에서 집어 오는 조각들. */
export interface SessionRunInputSources {
  /** 이 세션 탭의 SubAgent. 세션이 특정되지 않는 자리(메인 탭)는 `null`. */
  sub: SubAgent | null;
  /** 이 에이전트의 명령 큐 전체(세션 필터는 이 함수가 한다). */
  commands: QueuedCommand[] | undefined;
  /** 이 에이전트가 띄운 백그라운드 Task 전체(세션 필터는 이 함수가 한다). */
  runningTasks: RunningSubagentTask[] | undefined;
  /** 사용자가 이 세션의 완료를 확인했는가. */
  acknowledged: boolean;
}

/**
 * store 조각들을 판정 입력으로 접는다 — **세션 소유 필터가 여기 한 번만 산다.**
 *
 * `sub` 가 `null`(메인 탭)이면 세션으로 좁힐 수 없으므로 이 에이전트의 **전체**를 본다.
 * §5.5 #17-10 이 정한 스코프 규칙("세션 탭이면 그 세션만, 메인 탭이면 에이전트 전체")과 같은 감각이다.
 */
export function buildSessionRunInputs(src: SessionRunInputSources): SessionRunInputs {
  const subId = src.sub?.id ?? null;
  const owned = (cmd: QueuedCommand): boolean => subId === null || cmd.subAgentId === subId;
  const cmds = src.commands ?? [];
  return {
    subStatus: src.sub?.status ?? null,
    hasExecutingCommand: cmds.some((c) => c.status === 'executing' && owned(c)),
    hasQueuedCommand: cmds.some((c) => c.status === 'queued' && owned(c)),
    runningTaskCount: (src.runningTasks ?? []).filter(
      (t) => subId === null || t.subAgentId === subId,
    ).length,
    acknowledged: src.acknowledged,
  };
}

/**
 * §2.4 (잠듦) — 이 에이전트가 **지금 claude 자식 프로세스를 하나도 들고 있지 않은가**.
 *
 * 판정·전환은 전부 서버가 한다(`sweepDormantIdleSubs`). 여기서는 시간을 재지도, 상태를 바꾸지도
 * 않고 서버가 세워 둔 `SubAgent.dormant` 사실을 **접기만** 한다.
 *
 * 세션이 여럿이면 **전부 잠들었을 때만** 잠든 것으로 본다 — 하나라도 자식을 들고 있으면 그 버블은
 * 여전히 메모리를 쓰고 있고, 거기에 '잠듦'을 붙이면 화면이 거짓말이 된다.
 */
export function isAgentDormant(subs: readonly SubAgent[] | undefined): boolean {
  if (!subs || subs.length === 0) return false;
  return subs.every((s) => s.dormant === true);
}
