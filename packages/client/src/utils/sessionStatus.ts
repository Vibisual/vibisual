/**
 * 세션 상태 표시 규약 — **색과 라벨을 여기 한 곳에서만 정한다.**
 *
 * 종전에는 같은 도트 색표가 `IDETabBar` · `IDESidebar` · `SubAgentList` 세 벌로 복사돼 있었고
 * 세션 요약 보드(그 뒤 회수됨)가 네 번째 변형(확인 여부 반영)이었다. 게다가 `IDEStatusBar` 는 색 규약이
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

/**
 * 상태 → 도트 **색만**(Tailwind). 값을 바꾸려면 여기 한 줄만 고친다.
 *
 * 색과 움직임을 가른 이유는 아래 **여운**(`sessionDotClass`) 때문이다 — 여운은 자기 몸짓
 * (`animate-session-glow`)을 입히므로 색 위에 이미 얹힌 `animate-pulse` 를 떼야 한다. 한 요소에
 * `animation` 을 두 벌 걸면 나중에 선언된 하나만 살아남아 어느 쪽이 이길지 CSS 순서가 정한다.
 */
export const SESSION_STATUS_DOT_BG: Record<SessionRunState, string> = {
  running: 'bg-blue-400',
  error: 'bg-red-400',
  // §2.4 (한도 정지) — 끝난 것도 실패한 것도 아니고 **끊긴 것**. 실패의 빨강과 완료의 초록 사이,
  //   "손대야 다시 간다"를 말하는 주황이다. 빨강처럼 사고를 알리지 않고 초록처럼 안심시키지도 않는다.
  limited: 'bg-orange-400',
  // 끝났는데 아직 안 봤다 = 사용자를 부르는 색.
  doneUnseen: 'bg-emerald-400',
  // 확인까지 끝났다 = 배경으로 물러난다.
  done: 'bg-gray-500',
};

/** 그 색이 **스스로 뛰는가** — 지금 무슨 일이 일어나는 중인 두 상태만 참이다. */
const SESSION_STATUS_DOT_PULSE: Record<SessionRunState, boolean> = {
  running: true,
  limited: true,
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

/* ────────────────────────────────────────────────────────────────────────────
 * (판올림 번호 발급 대기) **누른 색의 여운** — 들어간 순간 색이 꺼져 알아볼 수 없던 것.
 *
 * [창과 버블] 목록에서 주황 줄을 누르면 그 세션이 창에 서는데(#17-1 `focusSessionId`), **서는 그
 * 순간 주황이 걷힌다.** 누르는 것이 곧 확인이라 `setIDEActiveSession` 이 `acknowledgeUsageLimit` ·
 * `acknowledgedSubAgents` 를 함께 찍기 때문이다(§17-47 — "그 말을 읽은 순간 불은 제 할 일을 다 한
 * 것이다"). 규약으로는 옳지만 화면에서는 **누른 색이 도착과 동시에 사라져**, 방금 무슨 색을 눌러
 * 들어왔는지 알아볼 수가 없었다(사용자 보고 — "바로 idle로 바뀌는게 아니라 한동안 색을 유지해줘야지
 * 왜냐면 인식이 안돼 … 지금은 알아보기 어려워").
 *
 * 그래서 **표식은 그대로 걷고 표시만 남긴다** — 걷는 규약(§17-47)은 한 글자도 건드리지 않는다.
 * 여운은 순수한 화면 층이다: 서버·스냅샷·체크포인트 무변경, 영속 ❌(앱을 껐다 켜면 남지 않는다 —
 * "방금 눌렀다"는 사실은 그때만 참이다).
 * ──────────────────────────────────────────────────────────────────────────── */

/** 여운이 남는 시간. 사용자가 정한 값("10초간 그 불이 깜빡") — 깜빡임 횟수도 이 길이를 따른다. */
export const SESSION_FOCUS_GLOW_MS = 10_000;

/** 눌러 들어간 자국 한 벌 — 어느 색이었나(`state`), 언제 눌렀나(`at`). */
export interface SessionFocusGlow {
  /** 누른 그 순간의 색. 이 색으로 여운이 남는다. */
  state: SessionRunState;
  /** 누른 시각(ms). `SESSION_FOCUS_GLOW_MS` 가 지나면 여운은 끝난다. */
  at: number;
}

/**
 * 지금 그 도트를 **무슨 색으로, 뛰게 할 것인가** — 여운과 실제 상태를 한 곳에서 합친다.
 *
 * 규칙은 둘뿐이다.
 *  · **여운은 조용한 자리만 덮는다.** 실제 상태가 `done`(아무 일 없음)일 때만 누른 색이 남는다.
 *    그래서 "10초 안에 뭔가 액션을 취하면 그 액션 색이 이긴다"가 조건문 하나 없이 성립한다 —
 *    명령을 보내 파랑이 켜지면 실제 상태가 `done` 이 아니게 되어 여운이 그 자리를 내준다.
 *  · **여운이 살아 있는 동안 그 색은 뛴다.** 빨강·초록처럼 평소 가만히 있는 색도 이때는 깜빡인다 —
 *    색만 남기면 "원래 그런 색"과 구별되지 않아 알아보라는 목적을 못 한다.
 */
export function resolveSessionDot(
  actual: SessionRunState,
  glow: SessionFocusGlow | undefined,
  now: number,
): { state: SessionRunState; glowing: boolean } {
  // 만료는 스토어 타이머가 걷지만 여기서도 본다 — 타이머를 놓친 프레임이 옛 색을 그리면 안 된다.
  const live = glow !== undefined && now - glow.at < SESSION_FOCUS_GLOW_MS;
  if (!live) return { state: actual, glowing: false };
  const state = actual === 'done' ? glow.state : actual;
  return { state, glowing: state === glow.state };
}

/**
 * 도트 한 점의 클래스 — 여운까지 반영한 최종값. **도트를 그리는 모든 자리가 이 함수를 쓴다.**
 * (여운을 자리마다 따로 합치면 같은 세션이 탭바에서는 주황인데 사이드바에서는 회색이 된다.)
 */
export function sessionDotClass(
  actual: SessionRunState,
  glow: SessionFocusGlow | undefined,
  now: number,
): string {
  const { state, glowing } = resolveSessionDot(actual, glow, now);
  // 여운은 제 몸짓을 입으므로 색표의 `animate-pulse` 를 떼고 색만 가져간다.
  return glowing ? `${SESSION_STATUS_DOT_BG[state]} animate-session-glow` : SESSION_STATUS_DOT[state];
}

/** 상태 → i18n 키(`panel.subAgent.status.*` 재사용 — 새 문자열 ❌). */
export const SESSION_STATUS_LABEL_KEY: Record<SessionRunState, string> = {
  running: 'panel.subAgent.status.running',
  error: 'panel.subAgent.status.error',
  // §2.4 (한도 정지) — 이 낱말은 기존 어휘로 대체할 수 없다. "오류"도 "끝남"도 사실이 아니다.
  limited: 'panel.subAgent.status.limited',
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
    // §2.4 (한도 정지) — 서버가 세워 둔 사실을 접기만 한다(여기서 만료·판정 ❌).
    usageLimited: sub.usageLimit !== undefined,
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
    // §2.4 (한도 정지) — 세션이 특정되지 않는 자리(메인 탭)는 한도를 말할 대상이 없다.
    usageLimited: src.sub?.usageLimit !== undefined,
  };
}

/**
 * §2.4 — **"실행중…" 옆에 붙는 한 마디.** 스피너만으로는 정보가 0 이라 사용자가 "아직도?"를
 * 판단할 근거가 없다(그게 이 축이 생긴 이유다). 서버가 붙여 준 판정을 낱말로 접기만 한다 —
 * 여기서 상태를 만들거나 전이시키지 않는다(§3.1 서버 = SSOT).
 *
 * `finished` 는 일부러 다루지 않는다 — 그 판정을 받은 세션은 서버가 이미 내렸으므로 화면에
 * "실행중"으로 서 있지 않다(자동 종료를 꺼 둔 경우에만 잠깐 보이고, 그때는 사유가 더 쓸모 있다).
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
