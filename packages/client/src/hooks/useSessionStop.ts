import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * useSessionStop — §5.5 #17-10 중지 동작(세션 스코프)의 단일 창구.
 *
 * §5.5 #17-12 로 하단 상태바("지금 무엇을 하는 중" 줄)에도 [중지]가 생기면서 두 곳을 훅 하나로 묶었고,
 * v4.64 에서 그 상태바 버튼을 없애 지금 호출자는 입력창(TerminalInput) 하나다 — 중지 경로는 계속 여기 한 곳.
 *
 * 범위 규칙은 #17-10 그대로: 세션 탭이면 그 세션만(`stop-session`), 스코프를 좁힐 세션이 없는 메인 탭에서만
 * 에이전트 전체(`stop-all`).
 *
 * ⚠ **응답을 버리지 않는다.** 종전에는 `void fetch(...).catch(() => {})` 로 보내고 1.5초 뒤 무조건
 * 버튼을 되돌렸다. 그래서 서버가 "멈출 것을 하나도 못 찾았다"(`stopped=0 · cancelledQueued=0 ·
 * sealedExecuting=0`)고 답해도 화면에는 **아무 일도 일어나지 않았다** — 사용자는 실행 중이라 적힌
 * 화면을 보며 같은 버튼을 계속 누르는 수밖에 없었다(이 버그의 체감 1순위). 이제 결과를 읽어
 * `nothing`/`failed` 를 돌려주고, `nothing` 이면 **에이전트 전체 강제 마감**(`stop-all`)을 내는
 * 두 번째 손잡이를 연다. 새 API 를 만들지 않는다 — 이미 있는 두 라우트의 조합이다.
 */

/** 중지 요청에 서버가 돌려주는 계수. 두 라우트가 이름만 살짝 다르다(`loopStopped` / `loopsStopped`). */
export interface SessionStopResponse {
  ok?: boolean;
  stopped?: number | boolean;
  cancelledQueued?: number;
  sealedExecuting?: number;
  loopStopped?: number | boolean;
  loopsStopped?: number;
}

/** 이번 중지로 **실제로 멈춘 것이 몇 개인가.** 0 이면 서버에는 멈출 것이 없었다는 뜻이다. */
export function stoppedCount(r: SessionStopResponse | null | undefined): number {
  if (!r) return 0;
  const num = (v: number | boolean | undefined): number =>
    typeof v === 'number' ? v : v === true ? 1 : 0;
  return num(r.stopped) + num(r.cancelledQueued) + num(r.sealedExecuting) + num(r.loopStopped) + num(r.loopsStopped);
}

/** 중지 한 번의 결과 — 화면은 이 값 하나만 보고 무엇을 말할지 정한다. */
export type SessionStopOutcome =
  /** 아직 아무것도 안 눌렀거나, 사용자가 안내를 닫았다. */
  | { kind: 'none' }
  /** 서버가 실제로 무언가 멈췄다 — 화면이 곧 스냅샷으로 따라오므로 따로 말할 것이 없다. */
  | { kind: 'stopped'; count: number }
  /** 서버에 멈출 것이 없었다 — **화면이 실행 중이라 말하고 있다면 그 표시가 거짓이다.** */
  | { kind: 'nothing' }
  /** 요청 자체가 실패했다(네트워크·5xx). 눌렀는데 아무 일도 없던 종전 화면의 다른 원인. */
  | { kind: 'failed'; status: number | null };

/**
 * 중지 요청 경로 — **중지를 내는 모든 자리가 이 함수를 쓴다.**
 *
 * 커맨드센터(§5.12)가 한때 세션 중지에 `/:subId/stop` 을 직접 불렀는데, 그 라우트는 자식 프로세스만
 * 죽이고 **큐에 남은 명령을 비우지 않아** 다음 명령이 곧바로 다시 나갔다(§5.5 #17-10 이 IDE 에서
 * 고친 "눌러도 안 멈춘다"가 그 창에만 남아 있었다). 게다가 broadcast 도 없고 실행 중이 아니면 409 라,
 * 눌러도 화면이 그대로였다. 경로를 여기 한 곳으로 모아 같은 [중지]가 어디서든 같은 일을 하게 한다.
 */
export function sessionStopUrl(agentId: string, subAgentId: string | null): string {
  return subAgentId
    ? `/api/subagents/${agentId}/${subAgentId}/stop-session`
    : `/api/subagents/${agentId}/stop-all`;
}

/** 강제 마감 경로 — 세션 스코프로 멈출 것을 못 찾았을 때만 쓰는 **에이전트 전체** 중지. */
export function sessionForceStopUrl(agentId: string): string {
  return `/api/subagents/${agentId}/stop-all`;
}

export interface SessionStopHandle {
  /** 요청이 도는 중 — 버튼 비활성·스피너. **응답이 오면(실패해도) 반드시 풀린다.** */
  stopping: boolean;
  stop: () => void;
  /** 마지막 요청 결과. `nothing`·`failed` 만 화면에 말한다. */
  outcome: SessionStopOutcome;
  /** 안내를 닫거나 새 명령을 보냈다. 이전 중지 응답은 더 이상 현재 작업의 안내가 아니다. */
  clearOutcome: () => void;
  /** `nothing` 일 때만 여는 두 번째 손잡이 — 에이전트 전체를 끊어 남은 명령까지 마감한다. */
  forceStop: () => void;
}

/**
 * 서버 응답 한 벌 → 화면이 말할 결과 하나. **훅 밖의 순수 함수**라 DOM 없이 그대로 시험한다
 * (`sessionRunTruth.test.ts`). 판정이 훅 안에 숨어 있으면 이 네 갈래가 영영 검증되지 않는다.
 */
export function classifyStopResponse(
  ok: boolean,
  status: number | null,
  body: SessionStopResponse | null,
): SessionStopOutcome {
  if (!ok) return { kind: 'failed', status };
  // 서버가 200 을 주면서 본문으로 실패를 말하는 경우 — 200 만 보고 성공으로 읽으면 거짓이 된다.
  if (body && body.ok === false) return { kind: 'failed', status };
  const count = stoppedCount(body);
  // 0 건 = **멈출 것이 없었다.** 화면이 "실행 중"이라 말하고 있다면 그 표시가 거짓이라는 뜻이라,
  //   조용히 넘기면 사용자는 같은 버튼을 계속 누르게 된다(종전 화면).
  return count > 0 ? { kind: 'stopped', count } : { kind: 'nothing' };
}

export function useSessionStop(agentId: string, activeSessionId: string | null): SessionStopHandle {
  // A→B→A is a new view lifetime too: the old A request must not revive its hint after returning.
  const scope = useMemo(() => ({ agentId, activeSessionId }), [agentId, activeSessionId]);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const [state, setState] = useState<{ scope: typeof scope; stopping: boolean; outcome: SessionStopOutcome }>({
    scope, stopping: false, outcome: { kind: 'none' },
  });
  // 연타 방지는 state 가 아니라 ref 로 본다 — state 는 이 콜백이 다시 만들어질 때까지 갱신되지 않아
  //   같은 프레임에 두 번 눌린 중지를 못 막는다.
  const inFlight = useRef<{ scope: typeof scope } | null>(null);
  useEffect(() => () => { inFlight.current = null; }, []);

  const send = useCallback(async (url: string): Promise<void> => {
    if (inFlight.current?.scope === scope) return;
    const request = { scope };
    inFlight.current = request;
    setState({ scope, stopping: true, outcome: { kind: 'none' } });
    let outcome: SessionStopOutcome;
    try {
      const res = await fetch(url, { method: 'POST' });
      let body: SessionStopResponse | null = null;
      if (res.ok) {
        try { body = (await res.json()) as SessionStopResponse; } catch { body = null; }
      }
      outcome = classifyStopResponse(res.ok, res.status, body);
    } catch {
      outcome = { kind: 'failed', status: null };
    }
    // A delayed response belongs to the view that sent it, not the session now occupying the input.
    if (activeScope.current !== scope || inFlight.current !== request) return;
    inFlight.current = null;
    setState({ scope, stopping: false, outcome });
  }, [scope]);

  const stop = useCallback(() => {
    void send(sessionStopUrl(agentId, activeSessionId));
  }, [agentId, activeSessionId, send]);

  const forceStop = useCallback(() => {
    void send(sessionForceStopUrl(agentId));
  }, [agentId, send]);

  const clearOutcome = useCallback(() => {
    inFlight.current = null;
    setState({ scope, stopping: false, outcome: { kind: 'none' } });
  }, [scope]);

  return {
    stopping: state.scope === scope && state.stopping,
    stop,
    outcome: state.scope === scope ? state.outcome : { kind: 'none' },
    clearOutcome,
    forceStop,
  };
}
