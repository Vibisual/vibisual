/**
 * 세션 상태 표시 규약 — **색과 라벨을 여기 한 곳에서만 정한다**(화면마다 색표를 따로 두면 같은 세션이 화면마다 다른 색이 된다).
 * 상태 판정 자체는 `@vibisual/shared` 의 `resolveSessionRunState`(서버·클라 공용) — 이 파일은 그 결과를 어떤 색·낱말로 그릴지만 갖는다.
 */

import { EMPTY_SESSION_RUN_INPUTS, isBackgroundShellTask, resolveSessionRunState } from '@vibisual/shared';
import type {
  NodeStatus,
  QueuedCommand,
  RunningSubagentTask,
  SessionRunInputs,
  SessionRunState,
  SubAgent,
  SubAgentStatus,
} from '@vibisual/shared';

/**
 * 상태 → 도트 **색만**(Tailwind). 움직임을 따로 두는 것은 여운(`sessionDotClass`) 때문이다 — 여운은 자기 몸짓(`animate-session-glow`)을
 * 입히므로 `animate-pulse` 를 떼야 한다. 한 요소에 `animation` 을 두 벌 걸면 CSS 순서로 하나만 산다.
 */
export const SESSION_STATUS_DOT_BG: Record<SessionRunState, string> = {
  running: 'bg-blue-400',
  error: 'bg-red-400',
  // §2.4 (한도 정지) — 끝난 것도 실패한 것도 아니고 **끊긴 것**. 실패의 빨강과 완료의 초록 사이,
  //   "손대야 다시 간다"를 말하는 주황이다. 빨강처럼 사고를 알리지 않고 초록처럼 안심시키지도 않는다.
  limited: 'bg-orange-400',
  // §5.5 #17-18 (대기) — **낼 일이 남았다.** 다섯 색 어디에도 섞이면 안 된다: 파랑이면 "돌고
  //   있다"는 거짓말이고, 초록이면 사용자가 그 "끝남"을 믿고 덧말을 또 보낸다(이 축이 생긴 사고).
  //   주황(한도)과도 갈라야 한다 — 저쪽은 손대야 가고 이쪽은 앞이 비면 저절로 간다.
  waiting: 'bg-violet-400',
  // 끝났는데 아직 안 봤다 = 사용자를 부르는 색.
  doneUnseen: 'bg-emerald-400',
  // 확인까지 끝났다 = 배경으로 물러난다.
  done: 'bg-gray-500',
};

/** 그 색이 **스스로 뛰는가** — 아직 끝나지 않은(= 화면이 사용자를 붙드는) 상태만 참이다. */
const SESSION_STATUS_DOT_PULSE: Record<SessionRunState, boolean> = {
  running: true,
  limited: true,
  // 줄 서 있는 것도 **끝난 것이 아니다.** 멈춘 색으로 그리면 옆의 회색 완료들과 섞여,
  //   "보낸 말이 아직 안 나갔다"는 사실이 화면에서 통째로 사라진다.
  waiting: true,
  error: false,
  doneUnseen: false,
  done: false,
};

/** 상태 → 도트 클래스(색 + 제 몸짓). 종전 소비자가 그대로 쓰는 조합값 — 위 두 표에서 파생한다. */
export const SESSION_STATUS_DOT: Record<SessionRunState, string> = Object.fromEntries(
  (Object.keys(SESSION_STATUS_DOT_BG) as SessionRunState[]).map((s) => [
    s,
    SESSION_STATUS_DOT_PULSE[s] ? `${SESSION_STATUS_DOT_BG[s]} animate-pulse` : SESSION_STATUS_DOT_BG[s],
  ]),
) as Record<SessionRunState, string>;

/*
 * **누른 색의 여운** — [창과 버블] 목록에서 줄을 누르면 그 세션이 창에 서고(#17-1 `focusSessionId`), 누름이 곧 확인이라
 * `setIDEActiveSession` 이 `acknowledgeUsageLimit`·`acknowledgedSubAgents` 를 함께 찍어 누른 색이 도착과 동시에 걷힌다(§17-47).
 * 그래서 표식은 그대로 걷고 **표시만 남긴다** — 걷는 규약(§17-47)은 건드리지 않는다.
 * 순수한 화면 층이다: 서버·스냅샷·체크포인트 무변경, 영속 ❌("방금 눌렀다"는 그때만 참이다).
 */

/** 여운이 남는 시간. 사용자가 정한 값("10초간 그 불이 깜빡") — 깜빡임 횟수도 이 길이를 따른다. */
export const SESSION_FOCUS_GLOW_MS = 10_000;

/**
 * **확인한 그 자리에 남는 여운** — 세션 탭에서 완료를 확인해 초록이 회색으로 내려앉을 때(없으면 한 프레임 만에 회색이 된다).
 * [창과 버블] 줄은 "무슨 색을 눌러 들어왔나"를 알려야 해 10초지만, 탭을 확인하는 손은 이미 그 탭을 보고 있어 "방금 확인됐다"만 짧게 말한다.
 */
export const SESSION_ACK_GLOW_MS = 5_000;

/** 눌러 들어간 자국 한 벌 — 어느 색이었나(`state`), 언제 눌렀나(`at`). */
export interface SessionFocusGlow {
  /** 누른 그 순간의 색. 이 색으로 여운이 남는다. */
  state: SessionRunState;
  /** 누른 시각(ms). 아래 수명이 지나면 여운은 끝난다. */
  at: number;
  /**
   * 이 자국만의 수명(ms). 없으면 `SESSION_FOCUS_GLOW_MS`(10초). 확인 여운은 `SESSION_ACK_GLOW_MS` 를 담는다 — 깜빡임 횟수도 이 값이 정한다(1초에 한 번).
   * 수명이 자국에 붙어 있어야 두 여운이 같은 스토어·같은 함수를 쓰면서 서로의 길이를 잘라먹지 않는다.
   */
  ms?: number;
}

/** 이 자국이 몇 ms 사는가 — 담긴 값이 없으면 기본 여운 길이. */
export function sessionGlowLifespan(glow: SessionFocusGlow): number {
  return glow.ms ?? SESSION_FOCUS_GLOW_MS;
}

/**
 * 수명 → 몸짓 클래스(`index.css`). CSS 는 반복 횟수(= 수명)를 변수로 받지 못해 길이마다 유틸리티가 하나씩 있다 —
 * 새 길이는 여기 한 줄과 `index.css` 의 `@utility` 한 벌을 함께 늘린다.
 */
const SESSION_GLOW_ANIM: Record<number, string> = {
  [SESSION_FOCUS_GLOW_MS]: 'animate-session-glow',
  [SESSION_ACK_GLOW_MS]: 'animate-session-glow-brief',
};

/**
 * 도트를 무슨 색으로, 뛰게 할 것인가 — 여운과 실제 상태를 한 곳에서 합친다.
 * · 여운은 실제 상태가 `done` 일 때만 덮는다 — 명령을 보내 실제 상태가 바뀌면 그 색이 조건문 없이 이긴다.
 * · 여운이 사는 동안 그 색은 뛴다 — 빨강·초록처럼 평소 가만한 색도 깜빡여야 "원래 그런 색"과 구별된다.
 */
export function resolveSessionDot(
  actual: SessionRunState,
  glow: SessionFocusGlow | undefined,
  now: number,
): { state: SessionRunState; glowing: boolean } {
  // 만료는 스토어 타이머가 걷지만 여기서도 본다 — 타이머를 놓친 프레임이 옛 색을 그리면 안 된다.
  const live = glow !== undefined && now - glow.at < sessionGlowLifespan(glow);
  if (!live) return { state: actual, glowing: false };
  const state = actual === 'done' ? glow.state : actual;
  return { state, glowing: state === glow.state };
}

/** 도트 한 점의 최종 클래스(여운 반영). **도트를 그리는 모든 자리가 이 함수를 쓴다** — 자리마다 따로 합치면 탭바와 사이드바 색이 갈린다. */
export function sessionDotClass(
  actual: SessionRunState,
  glow: SessionFocusGlow | undefined,
  now: number,
): string {
  const { state, glowing } = resolveSessionDot(actual, glow, now);
  if (!glowing || glow === undefined) return SESSION_STATUS_DOT[state];
  // 여운은 제 몸짓을 입으므로 색표의 `animate-pulse` 를 떼고 색만 가져간다.
  //   몸짓의 길이는 **그 자국이 정한다** — 누른 색은 10초, 확인 여운은 5초.
  const anim = SESSION_GLOW_ANIM[sessionGlowLifespan(glow)] ?? 'animate-session-glow';
  return `${SESSION_STATUS_DOT_BG[state]} ${anim}`;
}

/** 상태 → i18n 키(`panel.subAgent.status.*` 재사용 — 새 문자열 ❌). */
export const SESSION_STATUS_LABEL_KEY: Record<SessionRunState, string> = {
  running: 'panel.subAgent.status.running',
  error: 'panel.subAgent.status.error',
  // §2.4 (한도 정지) — 이 낱말은 기존 어휘로 대체할 수 없다. "오류"도 "끝남"도 사실이 아니다.
  limited: 'panel.subAgent.status.limited',
  // §5.5 #17-18 (대기) — "대기"는 기존 어휘로 못 덮는다. `idle`("대기")과 낱말이 겹쳐 보이지만
  //   그쪽은 **할 일이 없어 쉬는 것**이고 이쪽은 **할 일이 있는데 못 나간 것**이라 정반대다.
  waiting: 'panel.subAgent.status.waiting',
  // 미확인이든 확인이든 사실은 "끝남" 하나다 — 그 차이는 색이 말한다.
  doneUnseen: 'panel.subAgent.status.done',
  done: 'panel.subAgent.status.done',
};

/**
 * 버블 상태(`NodeStatus`) → 같은 표시 어휘. 값 집합은 다르지만(`awaiting_permission` 은 버블에만, `queued/executing` 은 명령에만)
 * 화면이 쓰는 낱말은 하나여야 한다. 새 `NodeStatus` 는 여기 한 줄만 늘린다.
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
 * 버블 상태를 세션 축으로 정규화 — 버블(메인 탭)과 세션(sub 탭)을 한 목록에 섞는 자리(커맨드센터)에서 쓴다. 세션 축에 없는 값은 `null`(판정에 기여 안 함).
 * `SubAgentStatus` 는 `NodeStatus` 의 부분집합이라 이 표 하나로 두 축을 받는다.
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
 * 명령 큐도 판정에 넣는다 — 앞 턴의 좀비 `executing` 이 자물쇠를 쥐면 뒤 명령은 `queued` 로 멈추는데 `sub.status` 는 `idle` 이라,
 * 큐를 안 보면 화면이 "완료"라고 말하고 그걸 믿고 보낸 덧말은 또 줄만 선다. 리렌더 비용은 `serializePendingSubIds` 로 접어 막는다.
 */
export function sessionRunStateOf(
  sub: SubAgent,
  acknowledged: boolean,
  /**
   * 이 세션이 띄운 백그라운드 서브에이전트·작업이 도는 중인가.
   * `sub.status` 만 믿으면 안 된다 — 훅이 자식을 띄운 탭을 못 풀면(`PreToolUse` 소유 세션 역조회 실패) 부모 버블만 active 가 되고 탭 status 는 idle 로 남아,
   * 자식이 도는 내내 도트가 꺼진다. 여기 오는 것은 `serializeBusySubIds` 가 거른 에이전트 자식뿐이다 — 백단 셸은 도트를 켜지 않는다
   * (`isBackgroundShellTask`; 셸은 모델을 돌리지 않아 켜면 끝난 대화가 영영 파랗게 남는다).
   */
  hasBackgroundWork = false,
  /**
   * 이 세션 앞에 아직 나가지 않은 명령(`queued`)이 있는가 — `serializePendingSubIds` 집합에서 온다. 빠지면 그 세션은 `doneUnseen`(초록 "끝남")으로 내려앉는다.
   * 기본 `false` 는 넘기지 않은 호출부의 답을 그대로 두기 위함이고, 도트를 그리는 자리는 전부 넘긴다.
   */
  hasQueuedCommand = false,
): SessionRunState {
  return resolveSessionRunState({
    ...EMPTY_SESSION_RUN_INPUTS,
    subStatus: sub.status,
    runningAgentTaskCount: hasBackgroundWork ? 1 : 0,
    // **`hasExecutingCommand` 로 올리지 않는다.** 좀비 `executing`(자식이 사라졌는데 상태만
    //   남은 것)이 바로 이 사고의 시작이라, 그것을 "도는 중"으로 세탁하면 파란불이 영영 켜진
    //   채로 남는다. 나갈 차례를 못 받고 있다는 사실은 `queued` 쪽이 이미 말한다.
    hasQueuedCommand,
    acknowledged,
    // §2.4 (한도 정지) — 서버가 세워 둔 사실을 접기만 한다(여기서 만료·판정 ❌).
    usageLimited: sub.usageLimit !== undefined,
  });
}

/**
 * 아직 나가지 않은 명령을 가진 세션 id 들을 정렬된 문자열 하나로 접는다(`serializeBusySubIds` 와 같은 수법, 재료만 명령 큐) —
 * `queuedCommands` 를 그대로 구독하면 스냅샷마다 새 참조라 매번 리렌더한다.
 * `executing` 은 **일부러 뺀다** — `sub.status` 가 이미 말하고, 좀비 `executing` 까지 주우면 끝난 세션이 영영 도는 중으로 보인다.
 */
export function serializePendingSubIds(commands: QueuedCommand[] | undefined): string {
  if (!commands || commands.length === 0) return '';
  const ids = new Set<string>();
  for (const c of commands) {
    if (c.status === 'queued' && c.subAgentId) ids.add(c.subAgentId);
  }
  return [...ids].sort().join(',');
}

/**
 * 백그라운드 작업을 가진 세션 id 들을 정렬된 문자열 하나로 접는다 — `runningSubagentTasks` 를 그대로 구독하면 스냅샷마다 새 참조라 매번 리렌더한다.
 * 켜짐/꺼짐이 실제로 바뀔 때만 값이 달라진다(`sessionLoopIndicator` 와 같은 수법).
 */
export function serializeBusySubIds(tasks: RunningSubagentTask[] | undefined): string {
  if (!tasks || tasks.length === 0) return '';
  const ids = new Set<string>();
  // **셸은 빼고 센다** — 도트는 실행 축이고 셸은 그 축에 없다(`isBackgroundShellTask`). 넣으면 `grep | sort` 하나가 탭 도트를 영영 파랗게 붙든다.
  for (const t of tasks) { if (t.subAgentId && !isBackgroundShellTask(t)) ids.add(t.subAgentId); }
  return [...ids].sort().join(',');
}

/** 같은 접기의 **셸 쪽** — 표시 축(활동바 점등·"백단에서 N개" 한 줄)이 쓴다. 실행 축과 직교한다: 여기 이름이 올라도 그 세션은 끝난 것으로 그린다. */
export function serializeShellSubIds(tasks: RunningSubagentTask[] | undefined): string {
  if (!tasks || tasks.length === 0) return '';
  const ids = new Set<string>();
  for (const t of tasks) { if (t.subAgentId && isBackgroundShellTask(t)) ids.add(t.subAgentId); }
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
  /** 메인 탭의 서버 버블 상태. 세션이 있으면 그 세션의 상태가 우선한다. */
  agentStatus?: NodeStatus;
  /** 이 에이전트의 명령 큐 전체(세션 필터는 이 함수가 한다). */
  commands: QueuedCommand[] | undefined;
  /** 이 에이전트가 띄운 백그라운드 Task 전체(세션 필터는 이 함수가 한다). */
  runningTasks: RunningSubagentTask[] | undefined;
  /** 사용자가 이 세션의 완료를 확인했는가. */
  acknowledged: boolean;
}

/**
 * store 조각들을 판정 입력으로 접는다 — **세션 소유 필터가 여기 한 번만 산다.**
 * `sub` 가 `null`(메인 탭)이면 이 에이전트 전체를 본다(§5.5 #17-10 스코프 규칙: 세션 탭이면 그 세션만, 메인 탭이면 에이전트 전체).
 */
export function buildSessionRunInputs(src: SessionRunInputSources): SessionRunInputs {
  const subId = src.sub?.id ?? null;
  const owned = (cmd: QueuedCommand): boolean => subId === null || cmd.subAgentId === subId;
  const cmds = src.commands ?? [];
  const ownedTasks = (src.runningTasks ?? []).filter((t) => subId === null || t.subAgentId === subId);
  return {
    subStatus: src.sub?.status ?? (src.agentStatus === undefined ? null
      : src.agentStatus === 'awaiting_permission' ? 'active'
        : NODE_STATUS_AS_SUB_STATUS[src.agentStatus] ?? 'idle'),
    hasExecutingCommand: cmds.some((c) => c.status === 'executing' && owned(c)),
    hasQueuedCommand: cmds.some((c) => c.status === 'queued' && owned(c)),
    // 두 축을 **여기서 한 번** 가른다 — 호출부가 다시 origin 을 비교하지 않도록.
    runningAgentTaskCount: ownedTasks.filter((t) => !isBackgroundShellTask(t)).length,
    backgroundShellCount: ownedTasks.filter((t) => isBackgroundShellTask(t)).length,
    acknowledged: src.acknowledged,
    // §2.4 (한도 정지) — 세션이 특정되지 않는 자리(메인 탭)는 한도를 말할 대상이 없다.
    usageLimited: src.sub?.usageLimit !== undefined,
  };
}

/**
 * §2.4 — "실행중…" 옆에 붙는 한 마디(스피너만으로는 "아직도?"를 판단할 근거가 없다). 서버 판정을 낱말로 접기만 한다 —
 * 여기서 상태를 만들거나 전이시키지 않는다(§3.1 서버 = SSOT).
 * `finished` 는 다루지 않는다 — 그 세션은 서버가 이미 내려 "실행중"으로 서 있지 않다(자동 종료를 꺼 둔 경우만 잠깐 보이고, 그때는 사유가 더 쓸모 있다).
 */
export function sessionProbeNote(sub: SubAgent | null | undefined): {
  /** i18n 키. */
  key: string;
  /** 경고 색으로 그릴지 — `stuck` 하나뿐이다(사용자를 부르는 자리). */
  warn: boolean;
  /** 모델이 쓴 사유. 있으면 툴팁으로 붙인다. */
  detail?: string;
} | null {
  if (!sub) return null;
  if (sub.probing) return { key: 'panel.subAgent.probe.checking', warn: false };
  const probe = sub.probe;
  if (!probe) return null;
  switch (probe.verdict) {
    case 'stuck':
      return { key: 'panel.subAgent.probe.stuck', warn: true, ...(probe.reason ? { detail: probe.reason } : {}) };
    case 'working':
      return { key: 'panel.subAgent.probe.working', warn: false, ...(probe.reason ? { detail: probe.reason } : {}) };
    case 'finished':
      return { key: 'panel.subAgent.probe.finished', warn: false, ...(probe.reason ? { detail: probe.reason } : {}) };
    default:
      return null; // unknown = 할 말이 없다. 아무것도 안 적는 편이 낫다.
  }
}

/**
 * §2.4 (잠듦) — 이 에이전트가 지금 claude 자식 프로세스를 하나도 들고 있지 않은가. 판정·전환은 서버(`sweepDormantIdleSubs`)가 하고 여기서는 `SubAgent.dormant` 를 접기만 한다.
 * 세션이 여럿이면 **전부 잠들었을 때만** 잠든 것 — 하나라도 자식을 들고 있으면 메모리를 쓰고 있어 '잠듦'은 거짓이 된다.
 */
export function isAgentDormant(subs: readonly SubAgent[] | undefined): boolean {
  if (!subs || subs.length === 0) return false;
  return subs.every((s) => s.dormant === true);
}
