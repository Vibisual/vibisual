/**
 * §5.13 (V) 37-3·37-17 — 이 요청은 **누가** 보냈나 (루프백 유입 판정).
 *
 * 외부 에이전트(우리가 띄운 `claude`·`codex` 자식)는 데스크톱 main 의 loopback 리스너로만 닿고, 리스너는 그 요청에
 * `x-vibisual-ingress: loopback` 을 **강제로** 붙인다(§3.7 — 호출자가 지울 수 없다). 렌더러(스튜디오·일꾼 창)의 요청은
 * IPC 로 들어와 그 표시가 없다. 그래서 이 표시 하나로 ① 판의 작성자(나/AI)를 적고 ② 사람의 결정(판 지우기·되돌리기·
 * 스타일 확정·라이브러리 들여놓기)과 일꾼 전용 경로를 에이전트에게서 막는다 — 토큰 보유 ≠ 사용자 의사.
 */
import type { Request, Response } from 'express';
import { LOOPBACK_INGRESS_HEADER, LOOPBACK_INGRESS_VALUE } from '@vibisual/shared';

import type { HistoryAuthor } from '../history.js';

/** 루프백(외부 에이전트)에서 온 요청인가. */
export function isAgentRequest(req: Request): boolean {
  return req.get(LOOPBACK_INGRESS_HEADER) === LOOPBACK_INGRESS_VALUE;
}

/** 판·메모의 작성자. */
export function requestAuthor(req: Request): HistoryAuthor {
  return isAgentRequest(req) ? 'ai' : 'user';
}

/**
 * 사람(또는 우리 창)만 할 수 있는 일이면 에이전트 요청을 403 으로 거절하고 `true` 를 돌려준다(부르는 쪽은 그대로 끝낸다).
 * 에이전트에게는 무엇을 대신 하면 되는지 한 줄로 알린다.
 */
export function rejectAgent(req: Request, res: Response, hint: string): boolean {
  if (!isAgentRequest(req)) return false;
  res.status(403).json({ ok: false, error: 'renderer-only', hint });
  return true;
}
