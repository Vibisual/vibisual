import type { Express } from 'express';
import { json } from 'express';
import { LOOPBACK_REQUEST_MAX_BYTES } from '@vibisual/shared';

/**
 * SCENARIO §3.7 「훅 입구의 본문 상한은 문의 상한과 같다」 (2026-10-22).
 *
 * 이 네 경로는 본문 크기를 **CLI 가 정한다** — 훅 페이로드는 도구가 다룬 내용을 통째로 싣는다(`Edit` 사후 신고의
 * 원본 파일 전체, `Write` 의 새 내용, `apply_patch` 본문). 루프백 문(`loopbackBody.ts`)은 `LOOPBACK_REQUEST_MAX_BYTES`
 * 까지 받아 넘기는데, 그 뒤의 전역 `express.json()` 이 기본 100KB 에서 413 으로 끊었다. 실측(2026-10-21): 지난 3주
 * 우리 훅 오류 알림 2,807건 중 2,100건이 이 413 이었고(대부분 `PostToolUse:Edit`), 거절된 신고는 캔버스 수정 이력에서
 * 빠졌다. 같은 자리에서 큰 `Write` 의 권한 문의가 막히면 `handler.mjs` 가 통과로 떨어져 자물쇠(§5.3 #12-3)를 비켜 갈
 * 수 있었다.
 *
 * 상한은 새 숫자를 짓지 않고 문의 상한을 그대로 쓴다 — 라우트 상한은 이 값에서 끌어 쓴다(§5.13 (R-10)).
 */
export const HOOK_INGRESS_JSON_PATHS: readonly string[] = [
  '/api/hook-event',
  '/api/permission-check',
  '/api/codex-tool-check',
  '/api/ask-user-question',
];

/** 전역 `express.json()` **앞에** 건다. 먼저 읽은 파서가 본문을 차지하므로 전역 파서는 이 경로를 다시 읽지 않는다. */
export function mountHookIngressBodyParser(app: Express): void {
  app.use([...HOOK_INGRESS_JSON_PATHS], json({ limit: LOOPBACK_REQUEST_MAX_BYTES }));
}
