/**
 * §5.13 (V) 37-3·37-17 — 루프백 유입 판정. 외부 에이전트(띄운 `claude`·`codex`)는 main 의 loopback 리스너로만 닿고, 리스너가 `x-vibisual-ingress: loopback` 을
 * 강제로 붙인다(§3.7 — 호출자가 못 지운다). IPC 로 오는 렌더러 요청엔 없다. 이 표시로 판 작성자(나/AI)를 적고 사람의 결정·일꾼 전용 경로를 에이전트에게서 막는다
 * — 토큰 보유 ≠ 사용자 의사.
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

/** 에이전트 요청이면 403 으로 거절하고 `true`(부르는 쪽은 그대로 끝낸다). `hint` = 에이전트가 대신 할 일 한 줄. */
export function rejectAgent(req: Request, res: Response, hint: string): boolean {
  if (!isAgentRequest(req)) return false;
  res.status(403).json({ ok: false, error: 'renderer-only', hint });
  return true;
}
