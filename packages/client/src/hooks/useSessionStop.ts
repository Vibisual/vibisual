import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * §5.5 #17-10 중지(세션 스코프)의 단일 창구 — 세션 탭 `stop-session`, 메인 탭 `stop-all`.
 * ⚠ **응답을 버리지 않는다** — 멈출 것이 없다는 답(`stopped=0 · cancelledQueued=0 · sealedExecuting=0`)이면 `nothing`(→ `stop-all` 손잡이), 실패면 `failed` 를 돌려준다(새 API 없음).
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

/** 중지 요청 경로 — **모든 중지가 이 함수를 쓴다.** `/:subId/stop` 직접 호출 ❌ — 자식만 죽이고 큐를 안 비워 다음 명령이 나가고, broadcast 도 없고 실행 중이 아니면 409 다. */
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

/** 서버 응답 → 화면이 말할 결과 하나. 훅 밖 순수 함수라 DOM 없이 시험한다(`sessionRunTruth.test.ts`). */
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
