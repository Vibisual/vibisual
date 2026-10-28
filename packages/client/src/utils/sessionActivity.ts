import { SESSION_NO_RESPONSE_MS, isBackgroundShellTask, sessionSilenceMs } from '@vibisual/shared';
import type { QueuedCommand, RunningSubagentTask, SubAgent, SubAgentStreamEvent } from '@vibisual/shared';

/** Activity uses server timestamps, never the time a history page was downloaded. */
export function sessionLastActivityAt(
  subs: readonly SubAgent[],
  streams: Readonly<Record<string, readonly SubAgentStreamEvent[]>>,
  commands: readonly QueuedCommand[],
  sessionId: string | null,
): number | null {
  let last = 0;
  const note = (at: number | undefined): void => {
    if (typeof at === 'number' && Number.isFinite(at) && at > last) last = at;
  };
  for (const sub of subs) {
    if (sessionId !== null && sub.id !== sessionId) continue;
    note(sub.lastActivityAt);
    // Events are grouped by turn, so the final array entry need not be the newest.
    for (const event of streams[sub.id] ?? []) {
      if (event.subAgentId === sub.id) note(event.timestamp);
    }
  }
  for (const command of commands) {
    if (command.status !== 'executing') continue;
    if (sessionId !== null && command.subAgentId !== sessionId) continue;
    note(command.startedAt ?? command.timestamp);
  }
  return last > 0 ? last : null;
}

/**
 * §5.3 #9-1 (P)(a) — 이 세션에서 **감춘 턴**(조용한 사전 압축)이 도는 중인가. 서버는 그 턴의 줄을
 * 일부러 보내지 않으므로 그동안의 움직임은 클라에 닿지 않는다. 원본 큐를 줘야 한다 —
 * `displayCommands` 사본은 silent 명령을 이미 감췄다.
 */
export function sessionHiddenTurnRunning(commands: readonly QueuedCommand[], sessionId: string | null): boolean {
  return commands.some((c) => c.silent === true && c.status === 'executing'
    && (sessionId === null || c.subAgentId === sessionId));
}

/**
 * §5.5 #17-24 ⑥ ⑦ — 라이브 1줄의 세 모습. `working` 작동 중 · `waiting` 줄만 섬 · `compacting` CLI 가 대화를 접는 중.
 * ⑦ — `thinking`(생각 중)은 두지 않는다. 마지막 이벤트가 사고라고 지금 사고 중인 것이 아니다(도구 사이 안내가 사고로 오고, 큰 `Write` 입력을 만드는
 * 수십 초는 줄이 없다). 그 라벨이 턴 시계와 붙으면 `생각 중… 53m 59s` 처럼 일하는 세션이 멈춘 것으로 읽힌다.
 */
export type LiveLineMode = 'working' | 'waiting' | 'compacting';

/**
 * §5.5 #17-24 ⑥ — 이 세션(메인 탭이면 에이전트의 세션 전부)이 접는 중이면 그 시작 시각, 모르면 `null`.
 * 근거는 서버가 세우고 걷는 `SubAgent.compactingSince` 하나(스트림 `status:"compacting"`·`PreCompact` 훅). 감춘 턴(조용한 사전 압축, §5.3 #9-1 (P))이 도는
 * 세션은 거른다 — 그 압축은 물려받은 명령이 평소처럼 "작업 중"으로 보이는 것이 계약이다((P)(b) · §5.5 #17-10 ⑥-6).
 * 원본 큐를 줘야 한다(`displayCommands` 사본은 silent 를 감췄다). 여럿이면(메인 탭) 가장 먼저 시작한 것 — 가장 오래 접고 있는 쪽이다.
 */
export function sessionCompactingSince(
  subs: readonly SubAgent[],
  commands: readonly QueuedCommand[],
  sessionId: string | null,
): number | null {
  let earliest = Infinity;
  for (const sub of subs) {
    if (sessionId !== null && sub.id !== sessionId) continue;
    const at = sub.compactingSince;
    if (!usableAt(at) || at >= earliest) continue;
    if (sessionHiddenTurnRunning(commands, sub.id)) continue;
    earliest = at;
  }
  return earliest < Infinity ? earliest : null;
}

/**
 * §5.5 #17-24 ⑥ ⑦ — 라이브 1줄의 모습을 고르는 단 한 곳. 메인 탭(`IDEMainArea`)·Sub 탭(`computeThinkingLive`)이 같이 부른다(다르게 고르면 탭을 옮길 때마다 말이 바뀐다).
 * 우선순위: 대기 > 압축 > 작업. 줄만 서 있으면 접을 것도 없다(§5.5 #17-18 ⑪). 마지막 이벤트 종류는 고르지 않는다(⑦) — 작동 중이면 `작업 중`이다.
 */
export function liveLineMode(waiting: boolean, compacting: boolean): LiveLineMode {
  if (waiting) return 'waiting';
  if (compacting) return 'compacting';
  return 'working';
}

/**
 * §2.4 (무응답) — 라이브 1줄("작업 중…")이 경과를 재는 시각. 메인 탭·Sub 탭이 같은 함수를 쓴다.
 * 마지막으로 보인 줄만 재면 안 된다 — 조용한 사전 압축(§5.3 #9-1 (P))은 줄을 감춰, 막 나간 명령이 앞 턴 끝부터 잰 "마지막 업데이트 8분 전"으로 시작한다.
 * 그래서 세션 활동 시각(명령 시작 포함) 중 늦은 쪽을 잰다. 감춘 턴이 도는 동안에도 같다 — 경과는 입력한 순간부터 센다(§5.5 #17-10 ⑥-6).
 * 무응답으로 뒤집을지는 이 시각이 아니라 `liveLineStalled` 가 정한다.
 */
export function liveLineActivityAt(
  lastEventAt: number | null | undefined,
  sessionActivityAt: number | null | undefined,
): number | null {
  let last = 0;
  for (const at of [lastEventAt, sessionActivityAt]) {
    if (typeof at === 'number' && Number.isFinite(at) && at > last) last = at;
  }
  return last > 0 ? last : null;
}

/**
 * §2.4 (무응답) — 라이브 1줄을 "마지막 업데이트 N 전"(무응답)으로 뒤집을 것인가. 메인·Sub 탭이 `ThinkingLiveLine` 한 곳에서 부른다.
 *  - 줄만 서 있으면(`waiting`) 뒤집지 않는다 — 턴이 아직 시작되지 않았다(§5.5 #17-18 ⑪).
 *  - 감춘 턴이 도는 중이면 뒤집지 않는다 — 그 줄은 서버가 일부러 안 보내고(§5.3 #9-1 (P) ⚠ ②) 압축은 3분을 넘기기도 한다(§5.5 #17-10 ⑥-6).
 *  - 접는 중(`compacting`)이면 뒤집지 않는다 — CLI 가 턴 도중 접는 2.4~6분은 줄이 안 오는 것이 정상이다(§5.5 #17-24 ⑥).
 *  - 그 밖에는 조용한 시간이 문턱(`SESSION_NO_RESPONSE_MS`)에 닿았을 때만.
 */
export function liveLineStalled(
  mode: LiveLineMode,
  silenceMs: number | null,
  hiddenTurn = false,
): boolean {
  if (mode === 'waiting' || mode === 'compacting' || hiddenTurn) return false;
  return silenceMs !== null && silenceMs >= SESSION_NO_RESPONSE_MS;
}

/** 근거로 쓸 수 있는 시각인가 — 없거나 0 이하·무한·NaN 이면 치지 않는다(0 을 "방금"으로 읽지 않는다). */
function usableAt(at: number | undefined): at is number {
  return typeof at === 'number' && Number.isFinite(at) && at > 0;
}

/**
 * §5.5 #17-10 ⑥-6 (턴 시계) — 라이브 1줄 경과의 시작점 = 지금 보는 일이 시작된 시각(메인·Sub 탭 공용 `useSessionLivenessFacts().turnStartedAt`).
 * 마지막 활동 시각으로 재지 마라 — 줄마다 0 으로 되감긴다(그 시각은 무응답 판정 `liveLineStalled` 에만). `waiting` 이 거짓이면 작동 중으로 본다.
 * 대기 → 가장 먼저 줄 선 `commands`(원본 큐 — 감춘 압축도 센다)의 `timestamp` · 도는 중 → 도는 명령 중 가장 늦게 나간 것의 `startedAt ?? timestamp`(좀비가 시계를 끌지 않게)
 * · 도는 명령이 없으면 `archived` 까지 가장 최근에 나간 명령 · 나간 명령도 없으면(훅 에이전트) 셸 아닌 도는 `tasks` 중 가장 먼저 시작한 것 · 근거가 없으면 `null`(0 ❌).
 */
export function sessionTurnStartedAt(
  commands: readonly QueuedCommand[],
  archived: readonly QueuedCommand[],
  sessionId: string | null,
  waiting: boolean,
  tasks: readonly RunningSubagentTask[] = [],
): number | null {
  const mine = (c: QueuedCommand): boolean => sessionId === null || c.subAgentId === sessionId;
  if (waiting) {
    let first = Infinity;
    for (const c of commands) {
      if (c.status === 'queued' && mine(c) && usableAt(c.timestamp) && c.timestamp < first) first = c.timestamp;
    }
    return first < Infinity ? first : null;
  }
  let latest = 0;
  for (const c of commands) {
    if (c.status !== 'executing' || !mine(c)) continue;
    const at = c.startedAt ?? c.timestamp;
    if (usableAt(at) && at > latest) latest = at;
  }
  if (latest > 0) return latest;
  for (const list of [commands, archived]) {
    for (const c of list) {
      if (c.status === 'queued' || !mine(c)) continue;
      const at = c.startedAt ?? c.timestamp;
      if (usableAt(at) && at > latest) latest = at;
    }
  }
  if (latest > 0) return latest;
  let earliest = Infinity;
  for (const t of tasks) {
    if (isBackgroundShellTask(t) || (sessionId !== null && t.subAgentId !== sessionId)) continue;
    if (usableAt(t.startedAt) && t.startedAt < earliest) earliest = t.startedAt;
  }
  return earliest < Infinity ? earliest : null;
}

/**
 * §5.5 #17-10 ⑥-6 (턴 시계) — 라이브 1줄이 어느 시각부터 잴 것인가(모르면 `null` — 적지 않는다). 메인·Sub 탭이 `ThinkingLiveLine` 에서 부른다.
 *  - 무응답(`stalled`)이면 마지막 업데이트 — "마지막 업데이트 N 전"이 말하는 그 시각.
 *  - 접는 중이면(`compactingSince` — 넷째 모드에서만 넘긴다) 압축 시작 시각 — 턴 시계로는 압축이 몇 분째인지 모른다(§5.5 #17-24 ⑥). 끝나면 턴 시계로 돌아간다.
 *  - 그 밖에는 이 턴(대기면 줄 선) 시작(`sessionTurnStartedAt`) — 줄이 와도 되감기지 않는다.
 * 쓸 수 있는 시각인지는 무응답 시계와 같은 규율로 가린다(`sessionSilenceMs` — 없음·0·미래는 모름).
 */
export function liveLineClockFrom(
  stalled: boolean,
  turnStartedAt: number | null | undefined,
  lastActivityAt: number | null | undefined,
  now: number,
  compactingSince?: number | null,
): number | null {
  const from = stalled ? lastActivityAt : (compactingSince ?? turnStartedAt);
  if (from === null || from === undefined || sessionSilenceMs(from, now) === null) return null;
  return from;
}
