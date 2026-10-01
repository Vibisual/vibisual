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
 * §2.4 (무응답) — 라이브 1줄("작업 중…")이 경과를 재는 시각. 메인 탭·Sub 탭이 **같은 함수**를 쓴다.
 *
 * **마지막으로 보인 줄**만 재면 안 된다 — 조용한 사전 압축(§5.3 #9-1 (P))은 줄을 감추므로, 그 뒤에
 * 막 나간 명령이 앞 턴 끝부터 잰 "마지막 업데이트 8분 전"으로 시작해 멈춘 세션처럼 보였다.
 * 그래서 세션 활동 시각(명령 시작 포함) 중 늦은 쪽을 잰다. 감춘 턴이 도는 동안에도 같다 — 그 턴이
 * 나간 순간(= 사용자가 명령을 넣은 순간)이 세션 활동이라, 경과는 입력한 순간부터 센다
 * (§5.5 #17-10 ⑥-6 — 물려받은 명령은 실행 중인 명령과 똑같이 보여야 한다). 무응답으로 뒤집을지는
 * 이 시각이 아니라 `liveLineStalled` 가 정한다.
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
 * §2.4 (무응답) — 라이브 1줄을 "마지막 업데이트 N 전"(무응답)으로 뒤집을 것인가. 메인 탭·Sub 탭이
 * `ThinkingLiveLine` 한 곳에서 이 함수를 부른다.
 *
 *  - 줄만 서 있으면(`waiting`) 뒤집지 않는다 — 말할 턴이 아직 시작되지 않았다(§5.5 #17-18 ⑪).
 *  - **감춘 턴이 도는 중이면 뒤집지 않는다** — 그 턴의 줄은 서버가 일부러 보내지 않으므로
 *    (§5.3 #9-1 (P) ⚠ ②) "업데이트가 없다"고 말할 근거가 없고, 압축은 3분을 넘기기도 한다.
 *    물려받은 명령은 그동안 평소처럼 "작업 중"이어야 한다(§5.5 #17-10 ⑥-6).
 *  - 그 밖에는 조용한 시간이 문턱(`SESSION_NO_RESPONSE_MS`)에 닿았을 때만.
 */
export function liveLineStalled(
  mode: 'thinking' | 'working' | 'waiting',
  silenceMs: number | null,
  hiddenTurn = false,
): boolean {
  if (mode === 'waiting' || hiddenTurn) return false;
  return silenceMs !== null && silenceMs >= SESSION_NO_RESPONSE_MS;
}

/** 근거로 쓸 수 있는 시각인가 — 없거나 0 이하·무한·NaN 이면 치지 않는다(0 을 "방금"으로 읽지 않는다). */
function usableAt(at: number | undefined): at is number {
  return typeof at === 'number' && Number.isFinite(at) && at > 0;
}

/**
 * §5.5 #17-10 ⑥-6 (턴 시계) — 라이브 1줄이 **평소** 적는 경과의 시작점 = 지금 보고 있는 일이 시작된
 * 시각. 메인 탭·Sub 탭이 같은 사실을 쓴다(`useSessionLivenessFacts().turnStartedAt`).
 *
 * 종전 시계는 마지막 활동 시각이라 줄이 올 때마다 0 으로 되감겼다. 줄이 끊임없이 오는 도는 턴에서는
 * `0s`·`1s` 만 번갈아 뜨거나 0 에 붙어 있었다(사용자 보고 "같은 시간이 반복되거나 0만"). 마지막 활동
 * 시각은 이제 무응답 판정(`liveLineStalled`)과 그 문구에만 쓴다.
 *
 *  - **대기**(`waiting`) → 가장 먼저 줄 선 명령이 줄에 선 시각(`timestamp`) — 줄 선 지 얼마나 됐는가.
 *  - **도는 중** → 도는 명령이 나간 시각(`startedAt`, 없으면 `timestamp`). 원본 큐라 감춘 압축도 센다 —
 *    압축이 도는 동안은 그 압축이 나간 순간(= 사용자가 명령을 넣은 순간)부터 센다. 여럿이면(메인 탭의
 *    여러 세션) **가장 늦게 나간 것**이 지금 턴이다 — 오래 남은 좀비가 시계를 끌고 가지 않게.
 *  - **도는 명령 없이 도는 중**(봉인 뒤 되살아난 턴 · 백단 자식만 남음) → 큐·보관분 중 가장 최근에
 *    나간 명령의 시각. 새 명령 없이 그 일이 이어지는 것이라 시계도 이어진다.
 *  - **나간 명령이 하나도 없는데 도는 중**(명령 큐를 쓰지 않는 훅 에이전트 — 백단 자식만으로 돈다)
 *    → 도는 자식(셸 제외 — 셸은 실행 축에 없다) 중 가장 먼저 시작한 것. 이게 없으면 그 줄은 평소
 *    시간을 통째로 잃는다.
 *  - 근거가 없으면 `null` — 0 으로 적지 않는다.
 *
 * @param commands  원본 큐(`queuedCommands[agentId]`). 표시 사본은 감춘 압축을 이미 지웠다.
 * @param archived  완료 보관분(`completedCommands[agentId]`). 도는 명령이 없을 때만 읽는다.
 * @param waiting   줄만 서 있는가(`isSessionWaiting`). 거짓이면 작동 중으로 본다 — 부르는 쪽이
 *                  낼 일이 있을 때만 부른다.
 * @param tasks     도는 백단 자식(`runningSubagentTasks[agentId]`). 명령 근거가 전혀 없을 때만 읽는다.
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
 * §5.5 #17-10 ⑥-6 (턴 시계) — 라이브 1줄이 **어느 시각부터** 잴 것인가. 모르면 `null`(아무것도
 * 적지 않는다). 메인 탭·Sub 탭이 `ThinkingLiveLine` 한 곳에서 이 함수를 부른다.
 *
 *  - 무응답(`stalled`)이면 **마지막 업데이트** — "마지막 업데이트 N 전"이 말하는 바로 그 시각이다.
 *  - 그 밖에는 **이 턴(대기면 줄 선) 시작**(`sessionTurnStartedAt`) — 줄이 와도 되감기지 않는다.
 *
 * 쓸 수 있는 시각인지는 무응답 시계와 **같은 규율**로 가린다(`sessionSilenceMs` — 없음·0·미래는 모름).
 */
export function liveLineClockFrom(
  stalled: boolean,
  turnStartedAt: number | null | undefined,
  lastActivityAt: number | null | undefined,
  now: number,
): number | null {
  const from = stalled ? lastActivityAt : turnStartedAt;
  if (from === null || from === undefined || sessionSilenceMs(from, now) === null) return null;
  return from;
}
