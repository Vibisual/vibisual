import type { IncomingMessage, ServerResponse } from 'node:http';

/** 주입 대상 — light-my-request 의 `DispatchFunc` 와 같은 모양. */
export type InjectDispatch = (req: IncomingMessage, res: ServerResponse) => void;

/** 바깥 응답에서 이 helper 가 쓰는 부분만. 시험에서 EventEmitter 로 흉내 낼 수 있게 좁힌다. */
export interface OuterResponseLike {
  readonly writableFinished: boolean;
  once(event: 'close', listener: () => void): unknown;
  off(event: 'close', listener: () => void): unknown;
}

/**
 * §5.3 #10-2 — 결과를 붙들고 기다리는 경로(위임 dispatch·조회). 바깥 연결 끊김을 안쪽 응답에 넘길 곳은 이 경로들뿐이다 —
 * 다른 경로의 끊김 처리는 바꾸지 않는다.
 *
 * §5.3 #12-1-B — 권한 카드를 붙드는 두 창구도 여기다. 빠지면 훅이 CLI 와 함께 죽어도 안쪽 응답은 모르고,
 * 카드는 dev 서버에서만 취소되고 사용자 앱에서는 종전처럼 60초를 채운 뒤 타임아웃 정책으로 풀린다.
 */
export function isHoldPath(path: string): boolean {
  if (path === '/api/task-edges/dispatch' || path.startsWith('/api/task-edges/dispatch/')) return true;
  return path === '/api/permission-check' || path === '/api/codex-tool-check';
}

/**
 * §3.7 loopback 리스너는 요청을 in-process 로 다시 주입한다. 그대로 두면 바깥 호출자(curl·MCP 다리)가 끊겨도 안쪽 응답은
 * 모른 채 결과가 날 때까지 붙들고, 끝나면 **아무도 받지 않은 결과를 건넸다고** 적는다.
 * 바깥 응답이 다 나가기 전에 닫히면 안쪽 응답을 끊어(`destroy` → 다음 틱 `close`) 서버가 대기만 걷게 한다 — 작업은 그대로 돈다.
 */
export function followOuterDisconnect(outer: OuterResponseLike, dispatch: InjectDispatch): InjectDispatch {
  return (innerReq, innerRes) => {
    const onOuterClose = (): void => {
      if (outer.writableFinished || innerRes.writableEnded || innerRes.destroyed) return;
      innerRes.destroy();
    };
    const detach = (): void => { outer.off('close', onOuterClose); };
    outer.once('close', onOuterClose);
    innerRes.once('finish', detach);
    innerRes.once('close', detach);
    dispatch(innerReq, innerRes);
  };
}
